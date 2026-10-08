import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
const faults = [];
const http = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/fail-next') { response.writeHead(404).end(); return; }
  let body = '';
  request.on('data', chunk => body += chunk);
  request.on('end', () => {
    const { count = 1, kind = 'close' } = JSON.parse(body || '{}');
    for (let i = 0; i < count; i++) faults.push(kind);
    response.writeHead(204).end();
  });
});
const server = new WebSocketServer({ server: http });
http.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${http.address().port}`));
server.on('connection', socket => {
  const fault = faults.shift();
  let item = 1; let appended = false;
  socket.on('message', raw => {
    const event = JSON.parse(raw);
    if (event.type === 'session.update') {
      if (fault === 'setup') {
        socket.send(JSON.stringify({ type: 'error', error: { code: 'server_error' } }));
        return;
      }
      socket.send(JSON.stringify({ type: 'session.updated' }));
      if (fault === 'close') setTimeout(() => socket.close(1011, 'Temporary provider failure'), 50);
    }
    if (event.type === 'input_audio_buffer.append' && !appended) {
      appended = true;
      socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: `turn-${item}`, delta: 'Olá, ' }));
    }
    if (event.type === 'input_audio_buffer.commit') {
      socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: `turn-${item}` }));
      socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: `turn-${item++}`, transcript: 'Olá, estamos a conversar.' }));
      appended = false;
    }
  });
});
