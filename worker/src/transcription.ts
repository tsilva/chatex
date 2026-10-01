import { base64, pcmRms, SAMPLE_RATE, sessionUpdate, type ProviderConfig } from './protocol';
type Update = { item: string; text: string; final: boolean; time: number };
/** Provider boundary: all adapters accept PCM24 and emit complete caption upserts. */
export class Transcription {
  socket: WebSocket | null = null;
  closed = false;
  seconds = 0;
  turnStart = Date.now();
  bufferSeconds = 0;
  lastVoice = 0;
  hasVoice = false;
  turns = new Map<string, { text: string; time: number }>();
  pending: number[] = [];
  constructor(private config: ProviderConfig, private update: (event: Update) => void, private failure: () => void) {}
  async open() {
    const config = this.config;
    // Compatible services can expose this same streaming protocol without changing room/client code.
    const url = config.provider === 'openai' ? 'https://api.openai.com/v1/realtime?intent=transcription' : config.url;
    if (!url || (config.provider !== 'openai' && config.provider !== 'compatible')) throw new Error('Transcription provider is not configured');
    const target = new URL(url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'));
    if (target.protocol !== 'https:' && target.hostname !== '127.0.0.1') throw new Error('Provider must use HTTPS');
    const headers: Record<string, string> = { Upgrade: 'websocket' };
    const key = config.provider === 'openai' ? config.key : config.token;
    if (key) headers.Authorization = `Bearer ${key}`;
    if (config.provider === 'openai' && !key) throw new Error('Missing OpenAI key');
    const response = await fetch(target, { headers, signal: AbortSignal.timeout(12000) });
    const ws = response.webSocket;
    if (!ws) throw new Error(`Transcription connection failed (${response.status})`);
    if (this.closed) { ws.accept(); ws.close(); throw new Error('Session cancelled'); }
    this.socket = ws;
    ws.accept();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Transcription setup timed out')); this.close(); }, 10000);
      const setup = (event: MessageEvent) => {
        try {
          const data = JSON.parse(String(event.data));
          if (data.type === 'session.updated') { clearTimeout(timer); ws.removeEventListener('message', setup); resolve(); }
          else if (data.type === 'error') { clearTimeout(timer); reject(new Error('Transcription setup rejected')); this.close(); }
        } catch { clearTimeout(timer); reject(new Error('Invalid provider response')); this.close(); }
      };
      ws.addEventListener('message', setup);
      ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('Transcription disconnected')); if (!this.closed) this.failure(); });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Transcription connection failed')); if (!this.closed) this.failure(); });
      ws.send(JSON.stringify(sessionUpdate(config.model)));
    });
    ws.addEventListener('message', event => this.receive(String(event.data)));
  }
  append(audio: ArrayBuffer) {
    if (this.closed || !this.socket) return;
    const duration = audio.byteLength / 2 / SAMPLE_RATE;
    const speech = pcmRms(audio) >= 0.008;
    // Clear silent audio periodically: avoid an unbounded provider input buffer between turns.
    this.seconds += duration;
    this.bufferSeconds += duration;
    if (speech) {
      if (!this.hasVoice) this.turnStart = Date.now() - duration * 1000;
      this.hasVoice = true;
      this.lastVoice = this.seconds;
    }
    this.socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64(audio) }));
    if (this.hasVoice && (this.seconds - this.lastVoice >= 0.7 || this.bufferSeconds >= 8)) this.commit();
    else if (!this.hasVoice && this.bufferSeconds >= 2) {
      this.socket.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
      this.bufferSeconds = 0;
    }
  }
  commit() {
    if (!this.hasVoice || !this.socket || this.closed) return;
    if (this.bufferSeconds < 0.1) this.socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64(new ArrayBuffer(Math.ceil((0.1 - this.bufferSeconds) * SAMPLE_RATE) * 2)) }));
    this.pending.push(this.turnStart);
    this.socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    this.hasVoice = false;
    this.bufferSeconds = 0;
  }
  receive(raw: string) {
    if (this.closed || raw.length > 100000) return;
    try {
      const event = JSON.parse(raw);
      if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') { this.failure(); this.close(); return; }
      if (typeof event.item_id !== 'string') return;
      const id = event.item_id;
      let turn = this.turns.get(id);
      if (!turn) { turn = { text: '', time: this.turnStart }; this.turns.set(id, turn); }
      if (event.type === 'input_audio_buffer.committed') { turn.time = this.pending.shift() ?? turn.time; }
      else if (event.type === 'conversation.item.input_audio_transcription.delta' && typeof event.delta === 'string') {
        turn.text = (turn.text + event.delta).slice(0, 8000);
        this.update({ item: id, text: turn.text, time: turn.time, final: false });
      } else if (event.type === 'conversation.item.input_audio_transcription.completed' && typeof event.transcript === 'string') {
        this.update({ item: id, text: event.transcript.slice(0, 8000), time: turn.time, final: true });
        this.turns.delete(id);
      }
      if (this.turns.size > 20 || this.pending.length > 20) { this.failure(); this.close(); }
    } catch { this.failure(); this.close(); }
  }
  async finish() {
    this.commit();
    const deadline = Date.now() + 5000;
    while (!this.closed && (this.pending.length || this.turns.size) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    this.close();
  }
  close() {
    this.closed = true;
    try { this.socket?.close(1000, 'Session finished'); } catch { /* already closed */ }
    this.socket = null;
  }
}
