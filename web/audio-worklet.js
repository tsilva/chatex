/* Audio capture stays off the UI thread. The browser stream is resampled to mono PCM24. */
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Int16Array(4800); this.count = 0; this.index = 0; this.nextTime = 0; this.previous = 0;
    this.port.onmessage = event => {
      if (event.data.type !== 'flush') return;
      if (this.count) {
        const bytes = this.buffer.slice(0, this.count).buffer;
        this.port.postMessage(bytes, [bytes]); this.count = 0;
      }
      this.port.postMessage({ type: 'flushed' });
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      while (this.nextTime <= this.index) {
        const fraction = this.index ? this.nextTime - (this.index - 1) : 1;
        const value = this.previous + fraction * (sample - this.previous);
        this.nextTime += sampleRate / 24000;
        this.buffer[this.count++] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
        if (this.count === this.buffer.length) {
          const bytes = this.buffer.buffer;
          this.port.postMessage(bytes, [bytes]);
          this.buffer = new Int16Array(4800); this.count = 0;
        }
      }
      this.previous = sample;
      this.index++;
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
