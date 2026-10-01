import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
const backend = process.env.CHATEX_API_URL || 'http://127.0.0.1:8787';
const url = new URL(backend);
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('CHATEX_API_URL must use HTTPS');
await mkdir('dist', { recursive: true });
await cp('web', 'dist', { recursive: true });
await cp('node_modules/qrcode-generator/dist/qrcode.mjs', 'dist/qr.mjs');
await writeFile('dist/config.js', `window.CHATEX_CONFIG = ${JSON.stringify({ api: url.origin })};\n`);
console.log(`Frontend built for ${url.origin}`);
