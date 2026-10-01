import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const api = process.env.CHATEX_TEST_API;
const origin = process.env.CHATEX_TEST_ORIGIN || 'http://127.0.0.1:50894';
async function request(path, body, from = origin) {
  const response = await fetch(api + path, { method: body ? 'POST' : 'GET', headers: { Origin: from, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
async function connection(member) {
  const ws = new WebSocket(api.replace(/^http/, 'ws') + `/rooms/${member.code}/socket`, ['chatex', member.token], { headers: { Origin: origin } });
  const events = [];
  const waiters = [];
  ws.on('message', raw => { const event = JSON.parse(raw); events.push(event); for (const notify of [...waiters]) notify(); });
  ws.on('error', () => {});
  function next(match, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('Event timed out: ' + match.toString())); }, timeout);
      const cleanup = () => { clearTimeout(timer); const i = waiters.indexOf(check); if (i >= 0) waiters.splice(i, 1); };
      const check = () => { const index = events.findIndex(match); if (index >= 0) { const event = events.splice(index, 1)[0]; cleanup(); resolve(event); } };
      waiters.push(check); check();
    });
  }
  await next(e => e.type === 'welcome');
  return { ws, next, send: data => ws.send(JSON.stringify(data)) };
}
function frame(seq, voiced = true) {
  const bytes = new Uint8Array(9604); const data = new DataView(bytes.buffer); data.setUint32(0, seq);
  for (let i = 4; i < bytes.length; i += 2) data.setInt16(i, voiced ? 3000 * Math.sin(i / 10) : 0, true);
  return bytes;
}
test('six-person room: identity, audio relay, reconnect, permissions, bounded capacity and deletion', { skip: !api }, async t => {
  assert.equal((await request('/rooms', { name: 'Intruder' }, 'https://untrusted.example')).status, 403);
  const created = await request('/rooms', { name: 'Ana' }); assert.equal(created.status, 201);
  const members = [created.body];
  const people = [];
  t.after(() => people.forEach(p => p.ws.close()));
  people.push(await connection(members[0]));
  for (const name of ['João', 'Maria', 'Rui', 'Inês', 'Pedro']) {
    const joined = await request(`/rooms/${members[0].code}/join`, { name }); assert.equal(joined.status, 201);
    members.push(joined.body); people.push(await connection(joined.body));
  }
  assert.equal((await request(`/rooms/${members[0].code}/join`, { name: 'Seventh' })).status, 409);
  const info = await request(`/rooms/${members[0].code}`); assert.equal(info.body.count, 6); assert.equal(info.body.captions, undefined); assert.equal(info.body.participants, undefined);
  people[1].send({ type: 'start' }); assert.equal((await people[1].next(e => e.type === 'error')).type, 'error');
  people[0].send({ type: 'start' });
  await Promise.all(people.map(p => p.next(e => e.type === 'room' && e.status === 'live')));
  const typedId = crypto.randomUUID();
  people[1].send({ type: 'text', text: '<script>alert(1)</script>', id: typedId });
  const typed = await people[0].next(e => e.type === 'caption' && e.caption.typed);
  assert.equal(typed.caption.name, 'João'); assert.equal(typed.caption.text, '<script>alert(1)</script>');
  for (const p of people.slice(0, 2)) p.send({ type: 'mic', active: true });
  await Promise.all(people.slice(0, 2).map(p => p.next(e => e.type === 'mic' && e.active)));
  for (let seq = 0; seq < 5; seq++) {
    for (const p of people.slice(0, 2)) p.ws.send(frame(seq, seq === 0));
  }
  const finals = [];
  for (let i = 0; i < 2; i++) finals.push((await people[2].next(e => e.type === 'caption' && e.caption.final && !e.caption.typed)).caption);
  assert.deepEqual(new Set(finals.map(c => c.name)), new Set(['Ana', 'João']));
  assert.equal(new Set(finals.map(c => c.id)).size, 2);
  people[1].send({ type: 'mic', active: false });
  people[1].ws.close();
  const reconnected = await connection(members[1]); people.push(reconnected);
  reconnected.send({ type: 'text', text: '<script>alert(1)</script>', id: typedId });
  reconnected.send({ type: 'end' }); await reconnected.next(e => e.type === 'error');
  // A replayed welcome restores finalized captions without leaking another member's token.
  const reconnectAgain = new WebSocket(api.replace(/^http/, 'ws') + `/rooms/${members[1].code}/socket`, ['chatex', members[1].token], { headers: { Origin: origin } });
  const snapshot = await new Promise((resolve, reject) => { reconnectAgain.once('error', reject); reconnectAgain.on('message', raw => { const event = JSON.parse(raw); if (event.type === 'welcome') resolve(event); }); });
  reconnectAgain.close();
  assert.equal(snapshot.captions.filter(c => c.typed).length, 1);
  assert.ok(snapshot.participants.every(p => !p.tokenHash && !p.token));
  people[0].send({ type: 'end' });
  await people[0].next(e => e.type === 'ended');
  assert.equal((await request(`/rooms/${members[0].code}`)).status, 410);
});
