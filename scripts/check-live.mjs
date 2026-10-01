import WebSocket from 'ws';
import { readFile, writeFile } from 'node:fs/promises';
const api = process.env.CHATEX_API_URL;
const origin = process.env.CHATEX_FRONTEND_URL;
if (!api || !origin || process.argv.length < 4) throw new Error('Set CHATEX_API_URL and CHATEX_FRONTEND_URL; pass two PCM24 files');
async function post(path, body) {
  const response = await fetch(api + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
}
async function connect(member) {
  const ws = new WebSocket(api.replace(/^https:/, 'wss:') + `/rooms/${member.code}/socket`, ['chatex', member.token], { headers: { Origin: origin } });
  const events = []; const callbacks = [];
  ws.on('message', raw => { const event = JSON.parse(raw); events.push(event); for (const cb of [...callbacks]) cb(); });
  const next = predicate => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Live event timed out')); }, 25000);
    const cleanup = () => { clearTimeout(timeout); const i = callbacks.indexOf(check); if (i >= 0) callbacks.splice(i, 1); };
    const check = () => {
      const error = events.find(e => e.type === 'error');
      if (error) { cleanup(); reject(new Error(error.message)); return; }
      const i = events.findIndex(predicate); if (i >= 0) { const event = events.splice(i, 1)[0]; cleanup(); resolve(event); }
    };
    callbacks.push(check); check();
  });
  ws.on('error', error => console.error('WebSocket:', error.message));
  await next(e => e.type === 'welcome');
  return { ws, next, send: event => ws.send(JSON.stringify(event)), events };
}
const host = await post('/rooms', { name: 'Ana (teste)' });
const guest = await post(`/rooms/${host.code}/join`, { name: 'João (teste)' });
const clients = [];
try {
  clients.push(await connect(host), await connect(guest));
  clients[0].send({ type: 'start' });
  await Promise.all(clients.map(c => c.next(e => e.type === 'room' && e.status === 'live')));
  for (const c of clients) c.send({ type: 'mic', active: true });
  await Promise.all(clients.map(c => c.next(e => e.type === 'mic' && e.active)));
  const start = Date.now(); const first = {};
  for (const c of clients) c.ws.on('message', raw => { const e = JSON.parse(raw); if (e.type === 'caption' && e.caption.text && !first[e.caption.participantId]) first[e.caption.participantId] = Date.now() - start; });
  await Promise.all(clients.map(async (client, index) => {
    const pcm = await readFile(process.argv[index + 2]);
    const audio = Buffer.concat([pcm, Buffer.alloc(48000)]);
    let seq = 0;
    for (let offset = 0; offset < audio.length; offset += 9600) {
      const chunk = audio.subarray(offset, offset + 9600); const frame = Buffer.alloc(4 + chunk.length); frame.writeUInt32BE(seq++); chunk.copy(frame, 4); client.ws.send(frame);
      await new Promise(resolve => setTimeout(resolve, chunk.length / 48));
    }
    client.send({ type: 'mic', active: false });
  }));
  const finals = [];
  for (const member of [host, guest]) finals.push((await clients[0].next(e => e.type === 'caption' && e.caption.final && e.caption.participantId === member.participantId)).caption);
  const report = { checked: new Date().toISOString(), api, frontend: origin, input: 'Two synthesized voices streamed concurrently as separate PCM24 microphones; Portuguese (Portugal) and English', captions: finals.map(c => ({ name: c.name, text: c.text })), firstCaptionMs: Object.values(first), source: 'Live OpenAI API through deployed Cloudflare Worker' };
  await writeFile('docs/live-room-check.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  clients[0].send({ type: 'end' }); await clients[0].next(e => e.type === 'ended');
  const ended = await fetch(api + `/rooms/${host.code}`, { headers: { Origin: origin } });
  if (ended.status !== 410) throw new Error('Room did not expire after end');
  console.log('Room ended; public endpoint returns 410.');
} finally { clients.forEach(c => c.ws.terminate()); }
