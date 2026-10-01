import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const temporary = await mkdtemp(join(tmpdir(), 'chatex-tests-'));
const owned = [];
function launch(command, args) {
  const child = spawn(command, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }); owned.push(child); return child;
}
function ready(child, pattern) {
  return new Promise((resolve, reject) => {
    let log = ''; const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 30000);
    child.stdout.on('data', chunk => { log += chunk; const match = pattern.exec(log); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.stderr.on('data', chunk => log += chunk);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited (${code}): ${log.slice(-2000)}`)); });
  });
}
try {
  const provider = launch(process.execPath, ['tests/rooms/mock-provider.mjs']);
  const url = await ready(provider, /(http:\/\/127\.0\.0\.1:\d+)/);
  const config = JSON.parse(await readFile('worker/wrangler.jsonc', 'utf8'));
  config.main = resolve('worker/src/index.ts'); config.vars = { ...config.vars, TRANSCRIPTION_PROVIDER: 'compatible', ALLOWED_ORIGINS: 'http://test.local', MAX_ROOMS_PER_DAY: '100' };
  delete config.account_id;
  await writeFile(join(temporary, 'wrangler.json'), JSON.stringify(config));
  await writeFile(join(temporary, '.dev.vars'), `OPENAI_API_KEY="test-only"\nTRANSCRIPTION_URL=${JSON.stringify(url)}\nTRANSCRIPTION_TOKEN=""\n`);
  const backend = launch(resolve('node_modules/.bin/wrangler'), ['dev', '--config', join(temporary, 'wrangler.json'), '--port', '0', '--ip', '127.0.0.1', '--inspector-port', '0']);
  const api = await ready(backend, /Ready on (http:\/\/[^\s]+)/);
  console.log(`Testing isolated Workers runtime at ${api}`);
  const test = spawn(process.execPath, ['--test', 'tests/rooms/audio.test.mjs', 'tests/rooms/room.test.mjs'], { stdio: 'inherit', env: { ...process.env, CHATEX_TEST_API: api, CHATEX_TEST_ORIGIN: 'http://test.local' } });
  process.exitCode = await new Promise(resolve => test.on('exit', code => resolve(code ?? 1)));
} finally {
  for (const child of owned) child.kill('SIGTERM');
  await rm(temporary, { recursive: true, force: true });
}
