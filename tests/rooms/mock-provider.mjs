import { WebSocketServer } from 'ws';
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
server.on('listening', () => console.log(`http://127.0.0.1:${server.address().port}`));
server.on('connection', socket => {
  let item = 1; let appended = false;
  socket.on('message', raw => {
    const event = JSON.parse(raw);
    if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
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
