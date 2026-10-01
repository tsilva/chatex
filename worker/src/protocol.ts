export const SAMPLE_RATE = 24000;
export const MAX_PARTICIPANTS = 6;
export const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{10}$/;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export type Caption = { id: string; participantId: string; name: string; text: string; final: boolean; typed: boolean; time: number };
export type Participant = { id: string; name: string; host: boolean; tokenHash: string; joined: number };
export type RoomData = { code: string; status: 'waiting' | 'live'; expires: number; participants: Participant[]; captions: Caption[] };
export type ProviderConfig = { provider: string; model: string; key: string; url?: string; token?: string };
export function newCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), n => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}
export function cleanName(value: unknown) {
  if (typeof value !== 'string') throw new Error('Indica o teu nome.');
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40);
  if (!name) throw new Error('Indica o teu nome.');
  return name;
}
export function pcmRms(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.byteLength; i += 2) sum += (view.getInt16(i, true) / 32768) ** 2;
  return Math.sqrt(sum / (buffer.byteLength / 2));
}
export function base64(buffer: ArrayBuffer) {
  return btoa(Array.from(new Uint8Array(buffer), n => String.fromCharCode(n)).join(''));
}
export function sessionUpdate(model: string) {
  return { type: 'session.update', session: { type: 'transcription', audio: { input: {
    format: { type: 'audio/pcm', rate: SAMPLE_RATE },
    transcription: { model, delay: 'low', prompt: 'A conversation between friends. Portuguese, when spoken, is European Portuguese as spoken in Portugal. Other languages and code-switching are possible.' },
    turn_detection: null
  } } } };
}
export async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
export function sameHash(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Pedido vazio.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new Error('Pedido demasiado grande.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pedido inválido.');
  return value as Record<string, unknown>;
}
