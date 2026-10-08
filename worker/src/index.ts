import { DurableObject } from 'cloudflare:workers';
import { cleanName, CODE_PATTERN, hashToken, MAX_PARTICIPANTS, newCode, readJson, sameHash, type Caption, type Participant, type RoomData } from './protocol';
import { Transcription } from './transcription';

type Attachment = { participantId: string; mic: boolean; seq: number; bytes: number; window: number; messages: number };
type TranscriptionSession = { adapter: Transcription; epoch: string; ready: boolean; seq: number; audio: number; retries: number; recovering: boolean };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const problem = (message: string, status = 400) => json({ error: message }, status);

export class Usage extends DurableObject<Env> {
  async reserve() {
    const day = new Date().toISOString().slice(0, 10);
    const count = await this.ctx.storage.get<{ day: string; count: number }>('quota');
    const used = count?.day === day ? count.count : 0;
    const max = Math.max(1, Math.min(100, Number(this.env.MAX_ROOMS_PER_DAY) || 3));
    if (used >= max) return false;
    await this.ctx.storage.put('quota', { day, count: used + 1 });
    return true;
  }
}

export class Room extends DurableObject<Env> {
  data: RoomData | null = null;
  sessions = new Map<WebSocket, TranscriptionSession>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
    const row = this.ctx.storage.sql.exec<{ payload: string }>('SELECT payload FROM room_state WHERE id = 1').toArray()[0];
    if (row) this.data = JSON.parse(row.payload);
    // Provider sockets do not survive eviction. Persisted memberships do; clients explicitly restart capture.
    for (const ws of this.ctx.getWebSockets()) {
      const a: Attachment = ws.deserializeAttachment();
      a.mic = false; ws.serializeAttachment(a);
      this.send(ws, { type: 'mic', active: false });
    }
  }
  private save(next: RoomData) {
    const stored = { ...next, captions: next.captions.filter(c => c.final).slice(-200) };
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room_state VALUES (1, ?)', JSON.stringify(stored));
    this.data = next;
  }
  async create(code: string, name: string) {
    if (this.data) throw new Error('Room already exists');
    const token = crypto.randomUUID() + crypto.randomUUID();
    const member: Participant = { id: crypto.randomUUID(), name: cleanName(name), host: true, tokenHash: await hashToken(token), joined: Date.now() };
    const minutes = Math.max(1, Math.min(120, Number(this.env.ROOM_MAX_MINUTES) || 60));
    const next: RoomData = { code, status: 'waiting', expires: Date.now() + minutes * 60000, participants: [member], captions: [] };
    this.save(next);
    await this.ctx.storage.setAlarm(next.expires);
    return { code, token, participantId: member.id, host: true };
  }
  private valid() { return this.data && this.data.expires > Date.now(); }
  info() {
    if (!this.valid()) return null;
    return this.snapshot();
  }
  async join(name: string) {
    const token = crypto.randomUUID() + crypto.randomUUID();
    const tokenHash = await hashToken(token);
    if (!this.valid() || !this.data) return { error: 'Esta sala terminou ou não existe.', status: 410 };
    if (this.data.participants.length >= MAX_PARTICIPANTS) return { error: 'A sala está cheia.', status: 409 };
    const member: Participant = { id: crypto.randomUUID(), name: cleanName(name), host: false, tokenHash, joined: Date.now() };
    this.save({ ...this.data, participants: [...this.data.participants, member] });
    this.roster();
    return { code: this.data.code, token, participantId: member.id, host: false };
  }
  private snapshot() {
    const data = this.data;
    if (!data) return null;
    return { code: data.code, status: data.status, expires: data.expires,
      participants: data.participants.map(p => ({ id: p.id, name: p.name, host: p.host,
        connected: this.ctx.getWebSockets().some(ws => this.attachment(ws)?.participantId === p.id),
        mic: this.ctx.getWebSockets().some(ws => this.attachment(ws)?.participantId === p.id && this.attachment(ws)?.mic)
      })), captions: data.captions.slice(-200) };
  }
  private attachment(ws: WebSocket): Attachment | null { return ws.deserializeAttachment(); }
  private send(ws: WebSocket, event: unknown) { try { ws.send(JSON.stringify(event)); } catch { /* disconnected */ } }
  private broadcast(event: unknown) { for (const ws of this.ctx.getWebSockets()) this.send(ws, event); }
  private roster() { const s = this.snapshot(); if (s) this.broadcast({ type: 'room', ...s }); }
  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return problem('WebSocket required', 426);
    const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(s => s.trim()) ?? [];
    const token = protocols[0] === 'chatex' ? protocols[1] : '';
    if (!token || token.length > 100) return problem('Convite inválido.', 401);
    const digest = await hashToken(token);
    if (!this.valid() || !this.data) return problem('Esta sala terminou ou não existe.', 410);
    const member = this.data.participants.find(p => sameHash(p.tokenHash, digest));
    if (!member) return problem('Sessão inválida. Volta a entrar.', 401);
    // Reconnecting or opening the same identity in another tab replaces the previous socket.
    for (const ws of this.ctx.getWebSockets()) if (this.attachment(ws)?.participantId === member.id) { this.stop(ws); ws.close(4001, 'Replaced'); }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ participantId: member.id, mic: false, seq: 0, bytes: 0, window: Date.now(), messages: 0 } satisfies Attachment);
    this.send(pair[1], { type: 'welcome', participantId: member.id, ...this.snapshot() });
    this.roster();
    return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'chatex' } });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const attachment = this.attachment(ws);
    if (!attachment || !this.valid() || !this.data) { await this.end(); return; }
    const member = this.data.participants.find(p => p.id === attachment.participantId);
    if (!member) { ws.close(4003, 'Membership ended'); return; }
    if (Date.now() - attachment.window >= 1000) { attachment.window = Date.now(); attachment.messages = 0; attachment.bytes = 0; }
    attachment.messages++;
    if (attachment.messages > 30) { this.stop(ws); ws.close(4008, 'Rate limit'); return; }
    ws.serializeAttachment(attachment);
    try {
      if (typeof message !== 'string') {
        const session = this.sessions.get(ws);
        if (!session?.ready || this.data.status !== 'live') return;
        if (message.byteLength < 8 || message.byteLength > 24004 || message.byteLength % 2 !== 0) throw new Error('Áudio inválido.');
        attachment.bytes += message.byteLength;
        if (attachment.bytes > 100000) throw new Error('Áudio demasiado rápido.');
        ws.serializeAttachment(attachment);
        const seq = new DataView(message).getUint32(0);
        if (seq !== session.seq) throw new Error('Ligação de áudio interrompida. Liga o microfone novamente.');
        session.seq++;
        session.audio += message.byteLength - 4;
        // A sustained healthy stream gets a fresh retry budget for later outages.
        if (session.audio >= 48000 * 10) session.retries = 0;
        if (session.audio > 48000 * 60 * 120) throw new Error('Limite de áudio atingido.');
        session.adapter.append(message.slice(4));
        return;
      }
      if (message.length > 4096) throw new Error('Mensagem demasiado grande.');
      const event = JSON.parse(message);
      switch (event.type) {
        case 'ping': this.send(ws, { type: 'pong' }); break;
        case 'start':
          if (!member.host) throw new Error('Só o anfitrião pode começar.');
          if (this.snapshot()!.participants.filter(p => p.connected).length < 2) throw new Error('É preciso mais uma pessoa.');
          this.save({ ...this.data, status: 'live' }); this.roster(); break;
        case 'mic':
          if (event.active === true) await this.start(ws, member);
          else { this.stop(ws, true); this.roster(); }
          break;
        case 'text': {
          if (this.data.status !== 'live') throw new Error('A conversa ainda não começou.');
          const text = typeof event.text === 'string' ? event.text.trim().slice(0, 2000) : '';
          if (!text) break;
          const id = typeof event.id === 'string' && /^[a-f0-9-]{36}$/.test(event.id) ? event.id : crypto.randomUUID();
          // Idempotent retries after reconnect must not duplicate typed responses.
          if (this.data.captions.some(c => c.id === `${member.id}:typed:${id}`)) break;
          this.caption({ id: `${member.id}:typed:${id}`, participantId: member.id, name: member.name, text, final: true, typed: true, time: Date.now() });
          break;
        }
        case 'end': if (!member.host) throw new Error('Só o anfitrião pode terminar.'); await this.end(); break;
        case 'leave':
          if (member.host) { await this.end(); break; }
          this.stop(ws);
          this.save({ ...this.data, participants: this.data.participants.filter(p => p.id !== member.id) });
          ws.close(1000, 'Left'); this.roster(); break;
        default: throw new Error('Mensagem inválida.');
      }
    } catch {
      if (typeof message !== 'string') this.stop(ws);
      this.send(ws, { type: 'error', message: 'Não foi possível concluir. Tenta novamente.' });
    }
  }
  private caption(caption: Caption) {
    if (!this.data || !this.valid()) return;
    const old = this.data.captions.find(c => c.id === caption.id);
    if (old?.final && !caption.final) return;
    const captions = this.data.captions.filter(c => c.id !== caption.id);
    captions.push(caption);
    captions.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    const next = { ...this.data, captions: captions.slice(-200) };
    if (caption.final) this.save(next); else this.data = next;
    this.broadcast({ type: 'caption', caption });
  }
  private async start(ws: WebSocket, member: Participant, retries = 0) {
    if (this.data?.status !== 'live') throw new Error('A conversa ainda não começou.');
    this.stop(ws);
    const epoch = crypto.randomUUID();
    const adapter = new Transcription({ provider: this.env.TRANSCRIPTION_PROVIDER, model: this.env.OPENAI_MODEL,
      key: this.env.OPENAI_API_KEY ?? '', url: this.env.TRANSCRIPTION_URL, token: this.env.TRANSCRIPTION_TOKEN },
      update => {
        if (this.sessions.get(ws)?.epoch !== epoch) return;
        this.caption({ id: `${member.id}:${epoch}:${update.item}`, participantId: member.id, name: member.name,
          text: update.text, final: update.final, typed: false, time: update.time });
      }, () => {
        this.recover(ws, member, session, 'A transcrição foi interrompida. Liga o microfone para tentar novamente.');
      });
    const session = { adapter, epoch, ready: false, seq: 0, audio: 0, retries, recovering: false };
    this.sessions.set(ws, session);
    try {
      await adapter.open();
      if (this.sessions.get(ws) !== session || session.recovering || !this.valid()) { adapter.close(); return; }
      session.ready = true;
      const attachment = this.attachment(ws);
      if (attachment) { attachment.mic = true; ws.serializeAttachment(attachment); }
      this.send(ws, { type: 'mic', active: true, epoch }); this.roster();
    } catch {
      this.recover(ws, member, session, 'Não foi possível ligar a transcrição. Tenta novamente.');
    }
  }
  private recover(ws: WebSocket, member: Participant, session: TranscriptionSession, message: string) {
    if (this.sessions.get(ws) !== session || session.recovering) return;
    session.recovering = true;
    session.ready = false;
    session.adapter.close();
    if (session.retries >= 2) {
      this.stop(ws); this.send(ws, { type: 'error', message }); this.roster();
      return;
    }
    const attachment = this.attachment(ws);
    if (attachment) { attachment.mic = false; ws.serializeAttachment(attachment); }
    this.send(ws, { type: 'mic', active: false }); this.roster();
    // Keep capture available during a brief outage. Muting, leaving or a newer
    // session removes this identity and cancels the delayed restart.
    this.ctx.waitUntil((async () => {
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** session.retries));
      if (this.sessions.get(ws) !== session || !this.valid()) return;
      await this.start(ws, member, session.retries + 1);
    })());
  }
  private stop(ws: WebSocket, flush = false) {
    const session = this.sessions.get(ws);
    if (session) {
      session.ready = false;
      if (flush) this.ctx.waitUntil(session.adapter.finish().finally(() => {
        if (this.sessions.get(ws) === session) this.sessions.delete(ws);
      }));
      else { session.adapter.close(); this.sessions.delete(ws); }
      // A failed stream can leave unfinished text; it must never be represented as a final transcript.
    }
    const attachment = this.attachment(ws);
    if (attachment) { attachment.mic = false; ws.serializeAttachment(attachment); }
    this.send(ws, { type: 'mic', active: false });
  }
  async webSocketClose(ws: WebSocket) { this.stop(ws); this.roster(); }
  async webSocketError(ws: WebSocket) { this.stop(ws); this.roster(); }
  private async end() {
    this.data = null;
    for (const [ws] of this.sessions) this.stop(ws);
    await this.ctx.storage.deleteAll();
    this.broadcast({ type: 'ended' });
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'Room ended');
  }
  async alarm() { await this.end(); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, provider: env.TRANSCRIPTION_PROVIDER, configured: env.TRANSCRIPTION_PROVIDER === 'openai' ? Boolean(env.OPENAI_API_KEY) : Boolean(env.TRANSCRIPTION_URL) });
    if (!allowed.includes(origin)) return problem('Origem não autorizada.', 403);
    const cors = (response: Response) => {
      if (response.status === 101) return response;
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Vary', 'Origin');
      return new Response(response.body, { status: response.status, headers });
    };
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (!(await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'local' })).success) return cors(problem('Demasiados pedidos. Espera um pouco.', 429));
    try {
      if (url.pathname === '/rooms' && request.method === 'POST') {
        const body = await readJson(request);
        const name = cleanName(body.name);
        if (!(await env.USAGE.getByName('daily-room-quota').reserve())) return cors(problem('Limite diário de salas atingido. Tenta amanhã.', 429));
        const code = newCode();
        const result = await env.ROOMS.getByName(code).create(code, name);
        return cors(json(result, 201));
      }
      const match = /^\/rooms\/([A-Z2-9]{10})(?:\/(join|socket))?$/.exec(url.pathname);
      if (!match || !CODE_PATTERN.test(match[1])) return cors(problem('Código de sala inválido.', 404));
      const room = env.ROOMS.getByName(match[1]);
      if (match[2] === 'socket' && request.method === 'GET') return cors(await room.fetch(request));
      if (match[2] === 'join' && request.method === 'POST') {
        const body = await readJson(request);
        const result = await room.join(cleanName(body.name));
        return cors('error' in result ? problem(result.error ?? 'Não foi possível entrar.', result.status) : json(result, 201));
      }
      if (!match[2] && request.method === 'GET') {
        const result = await room.info();
        return cors(result ? json({ code: result.code, status: result.status, count: result.participants.length }) : problem('Esta sala terminou ou não existe.', 410));
      }
      return cors(problem('Pedido inválido.', 405));
    } catch { return cors(problem('Não foi possível concluir o pedido. Verifica os dados e tenta novamente.')); }
  }
} satisfies ExportedHandler<Env>;
