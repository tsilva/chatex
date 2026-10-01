import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile('web/audio-worklet.js', 'utf8');
for (const rate of [24000, 44100, 48000]) {
  test(`capture produces exactly PCM24 at ${rate} Hz and flushes a short tail`, () => {
    const frames = []; let Processor;
    class Base { port = { onmessage: null, postMessage: value => frames.push(value) }; }
    vm.runInNewContext(source, { AudioWorkletProcessor: Base, sampleRate: rate, registerProcessor: (_name, Class) => Processor = Class });
    const processor = new Processor();
    for (let i = 0; i < rate; i += 128) {
      const samples = new Float32Array(Math.min(128, rate - i)).fill(0.25);
      processor.process([[samples]]);
    }
    assert.equal(frames.length, 5); assert.equal(frames.reduce((total, frame) => total + frame.byteLength, 0), 48000);
    assert.equal(new Int16Array(frames[0])[100], Math.round(0.25 * 32767));
    processor.process([[new Float32Array(128).fill(2)]]);
    processor.port.onmessage({ data: { type: 'flush' } });
    assert.ok(frames[5].byteLength > 0 && frames[5].byteLength < 9600);
    assert.equal(frames[6].type, 'flushed');
    assert.ok([...new Int16Array(frames[5])].every(n => n <= 32767 && n >= -32767));
  });
}
