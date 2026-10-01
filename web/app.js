import qrcode from './qr.mjs';
const $ = selector => document.querySelector(selector);
const api = window.CHATEX_CONFIG.api;
const state = { page: 'home', code: '', membership: null, socket: null, room: null, captions: new Map(), mic: false, desiredMic: false, capture: null, captureGeneration: 0, retry: 0, timer: null, intentional: false, atLive: true, busy: false, wake: null };
const colors = ['#759876', '#755094', '#b2975b', '#39718c', '#aa5962', '#647fa4'];
function color(id) { let hash = 0; for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0; return colors[hash % colors.length]; }
function notice(text) { $('#notice').textContent = text; $('#notice').hidden = !text; }
function show(page) {
  state.page = page;
  document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== page);
  scheduleNameViewport();
  if (page === 'room') void keepAwake();
  else if (state.wake) { void state.wake.release(); state.wake = null; }
}
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(el => el.close()); }
async function keepAwake() {
  if (!navigator.wakeLock || document.visibilityState !== 'visible' || state.wake) return;
  try { state.wake = await navigator.wakeLock.request('screen'); state.wake.addEventListener('release', () => state.wake = null); } catch { /* captioning continues without a wake lock */ }
}
document.addEventListener('visibilitychange', () => { if (state.page === 'room') void keepAwake(); });
async function request(path, body) {
  const response = await fetch(api + path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível ligar à sala.');
  return result;
}
function codeInput(value) { return value.toUpperCase().replace(/[\s-]/g, ''); }
async function joinScreen(code) {
  state.code = code; notice('');
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code)) throw new Error('Verifica o código da sala.');
  await request(`/rooms/${code}`);
  $('#invited-room').textContent = `Sala ${code}`;
  $('#invited-room').hidden = false;
  $('#join-code').textContent = 'Entrar na sala';
  show('home'); $('#name').focus();
}
function personName() { return $('#name').value.replace(/[\u0000-\u001f\u007f]/g, '').trim(); }
function nameUI() {
  const disabled = state.busy || !personName();
  $('#create').disabled = disabled;
  $('#join-code').disabled = disabled;
}
function busy(value) { state.busy = value; nameUI(); }
let nameViewportHeight = 0;
let nameViewportFrame = 0;
function scheduleNameViewport() {
  cancelAnimationFrame(nameViewportFrame);
  nameViewportFrame = requestAnimationFrame(() => {
    const home = $('#home');
    const viewport = window.visualViewport;
    const keyboardOpen = viewport && viewport.height < nameViewportHeight - 100;
    const editing = !home.hidden && window.matchMedia('(max-width: 649px)').matches &&
      (document.activeElement === $('#name') || (home.classList.contains('name-editing') && keyboardOpen));
    home.classList.toggle('name-editing', editing);
    if (editing) {
      // Mobile keyboards can shrink and pan the visual viewport without changing 100dvh.
      home.style.setProperty('--name-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      home.style.setProperty('--name-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    } else {
      home.style.removeProperty('--name-viewport-height');
      home.style.removeProperty('--name-viewport-top');
    }
  });
}
window.visualViewport?.addEventListener('resize', scheduleNameViewport);
window.visualViewport?.addEventListener('scroll', scheduleNameViewport);
window.addEventListener('resize', scheduleNameViewport);
async function prepareCapture() {
  if (state.capture) { await state.capture.context.resume(); return; }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('O microfone precisa de uma ligação HTTPS. Podes ler e escrever.');
  const generation = state.captureGeneration;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
  if (generation !== state.captureGeneration) { stream.getTracks().forEach(t => t.stop()); throw new Error('Captura cancelada.'); }
  const context = new AudioContext({ sampleRate: 24000 });
  try {
    await context.resume();
    await context.audioWorklet.addModule('/audio-worklet.js');
    if (generation !== state.captureGeneration) throw new Error('Captura cancelada.');
    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, 'pcm-capture');
    const silence = context.createGain(); silence.gain.value = 0;
    source.connect(worklet); worklet.connect(silence); silence.connect(context.destination);
    const capture = { stream, context, source, worklet, seq: 0 };
    state.capture = capture;
    worklet.port.onmessage = event => {
      if (event.data?.type === 'flushed') { capture.flushResolve?.(); return; }
      if (!state.mic || state.socket?.readyState !== WebSocket.OPEN || state.page !== 'room') return;
      if (state.socket.bufferedAmount > 48000) {
        void disableMic(false); notice('A ligação está lenta. Liga o microfone para tentar novamente.'); return;
      }
      const frame = new Uint8Array(4 + event.data.byteLength);
      new DataView(frame.buffer).setUint32(0, capture.seq++);
      frame.set(new Uint8Array(event.data), 4);
      state.socket.send(frame.buffer);
    };
    for (const track of stream.getTracks()) track.addEventListener('ended', () => { void disableMic(false); notice('O microfone foi interrompido. Liga-o novamente.'); });
  } catch (error) { stream.getTracks().forEach(t => t.stop()); await context.close(); throw error; }
}
function releaseCapture() {
  state.captureGeneration++;
  const c = state.capture; state.capture = null;
  if (!c) return;
  c.worklet.port.onmessage = null; c.source.disconnect(); c.worklet.disconnect();
  c.stream.getTracks().forEach(t => t.stop()); void c.context.close();
}
function micUI() {
  $('#mic').setAttribute('aria-pressed', String(state.mic));
  $('#mic').setAttribute('aria-label', state.mic ? 'Silenciar microfone' : 'Ligar microfone');
  $('#mic-slash').hidden = state.mic;
}
function send(event) {
  if (state.socket?.readyState !== WebSocket.OPEN) return false;
  state.socket.send(JSON.stringify(event)); return true;
}
async function disableMic(flush = true) {
  state.desiredMic = false;
  const capture = state.capture;
  $('#mic').disabled = true;
  if (flush && state.mic && capture) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 250);
      capture.flushResolve = () => { clearTimeout(timer); resolve(); };
      capture.worklet.port.postMessage({ type: 'flush' });
    });
  }
  if (state.capture === capture) {
    state.mic = false; send({ type: 'mic', active: false }); releaseCapture(); micUI();
  }
  $('#mic').disabled = false;
}
async function enableMic() {
  if (state.socket?.readyState !== WebSocket.OPEN) { notice('Espera pela ligação à sala.'); return; }
  $('#mic').disabled = true;
  try {
    await prepareCapture();
    if (state.page !== 'room') { releaseCapture(); return; }
    state.desiredMic = true;
    send({ type: 'mic', active: true });
  } catch { await disableMic(false); notice('Não foi possível usar o microfone. Permite o acesso no navegador ou escreve uma resposta.'); }
  finally { $('#mic').disabled = false; }
}
async function enter(event, options = {}) {
  event?.preventDefault(); if (state.busy) return;
  const name = personName();
  if (!name) { nameUI(); $('#name').focus(); return; }
  busy(true); notice('');
  const code = options.code ?? state.code;
  state.desiredMic = true;
  let microphoneNotice = '';
  let joined = false;
  const generation = state.captureGeneration;
  // Request permission from the click, but let room creation proceed immediately.
  void prepareCapture().then(() => {
    if (generation !== state.captureGeneration) return;
    if (!state.desiredMic) { releaseCapture(); return; }
    if (state.page === 'room') send({ type: 'mic', active: true });
  }).catch(() => {
    if (generation !== state.captureGeneration) return;
    state.desiredMic = false;
    microphoneNotice = 'Sem microfone. Podes ler e escrever; liga-o mais tarde para falar.';
    if (joined) notice(microphoneNotice);
  });
  try {
    const result = await request(code ? `/rooms/${code}/join` : '/rooms', { name });
    state.membership = result; state.code = result.code;
    joined = true;
    sessionStorage.setItem('chatex-membership', JSON.stringify(result));
    history.replaceState(null, '', `?room=${state.code}`);
    show('waiting'); connect();
    if (microphoneNotice) notice(microphoneNotice);
  } catch (error) { state.desiredMic = false; releaseCapture(); notice(error.message || 'Não foi possível entrar.'); }
  finally { busy(false); }
}
function connect() {
  clearTimeout(state.timer); state.intentional = false; state.mic = false; micUI();
  $('#connection').textContent = state.retry ? 'A voltar a ligar…' : 'A ligar…';
  const url = new URL(`/rooms/${state.code}/socket`, api); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url, ['chatex', state.membership.token]);
  state.socket = ws;
  ws.onmessage = event => {
    if (state.socket !== ws) return;
    try { receive(JSON.parse(event.data)); } catch { notice('Não foi possível atualizar as legendas.'); }
  };
  ws.onopen = () => { if (state.socket === ws) { state.retry = 0; $('#connection').textContent = 'Em direto'; $('#reply').disabled = false; } };
  ws.onclose = event => {
    if (state.socket !== ws || state.intentional) return;
    state.mic = false; micUI(); $('#reply').disabled = true;
    if (event.code === 4001) { clearSession(); show('home'); notice('Esta sessão foi aberta noutro separador.'); return; }
    if (event.code === 4003 || event.code === 1000) { ended(); return; }
    $('#connection').textContent = 'A voltar a ligar…';
    const delay = Math.min(10000, 500 * 2 ** Math.min(state.retry++, 5));
    // Check for an ended room instead of repeatedly reconnecting to an expired invitation.
    state.timer = setTimeout(async () => {
      try { await request(`/rooms/${state.code}`); if (!state.intentional) connect(); }
      catch (error) { if (/terminou|não existe/.test(error.message)) ended(); else if (!state.intentional) connect(); }
    }, delay);
  };
}
function renderRoster() {
  const room = state.room;
  $('#waiting-count').textContent = `${room.participants.length} / 6`;
  const list = $('#roster'); list.replaceChildren();
  for (const person of room.participants) {
    const li = document.createElement('li'); li.style.setProperty('--speaker', color(person.id));
    const dot = document.createElement('span'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.textContent = person.name + (person.id === state.membership.participantId ? ' · tu' : '');
    const status = document.createElement('small'); status.textContent = person.connected ? 'Pronto' : 'A ligar…'; li.append(dot, name, status); list.append(li);
  }
  const host = room.participants.find(p => p.host);
  $('#start').hidden = !state.membership.host;
  $('#start').disabled = room.participants.filter(p => p.connected).length < 2;
  $('#waiting-status').textContent = state.membership.host ? ($('#start').disabled ? 'À espera de mais uma pessoa.' : '') : `À espera de ${host?.name || 'quem criou a sala'}.`;
}
function invitation() { return `${location.origin}/?room=${state.code}`; }
function qr(target) { const code = qrcode(0, 'M'); code.addData(invitation()); code.make(); $(target).innerHTML = code.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
function renderCaption(caption) {
  state.captions.set(caption.id, caption);
  let article = document.getElementById(`caption-${caption.id}`);
  if (!caption.text.trim()) { article?.remove(); return; }
  if (!article) {
    article = document.createElement('article'); article.id = `caption-${caption.id}`; article.className = 'caption';
    article.style.setProperty('--speaker', color(caption.participantId));
    const name = document.createElement('div'); name.className = 'name'; name.textContent = caption.name;
    if (caption.typed) { const typed = document.createElement('small'); typed.textContent = ' · escrito'; name.append(typed); }
    const p = document.createElement('p'); article.append(name, p);
  }
  article.querySelector('p').textContent = caption.text;
  article.dataset.time = caption.time;
  const target = caption.final ? $('#history') : $('#live');
  if (article.parentNode !== target) {
    const next = [...target.children].find(node => Number(node.dataset.time) > caption.time);
    target.insertBefore(article, next || null);
  }
  if (caption.final && state.atLive) $('#history').scrollTop = $('#history').scrollHeight;
  $('#return-live').hidden = state.atLive;
  if (state.captions.size > 200) {
    const oldest = [...state.captions.values()].sort((a, b) => a.time - b.time)[0];
    state.captions.delete(oldest.id); document.getElementById(`caption-${oldest.id}`)?.remove();
  }
}
function receive(event) {
  if (event.type === 'welcome' || event.type === 'room') {
    const first = event.type === 'welcome';
    const wasLive = state.room?.status === 'live';
    state.room = event; renderRoster();
    $('#room-code').textContent = state.code;
    $('#waiting-code').textContent = state.code;
    if (first) {
      qr('#waiting-qr');
      state.captions.clear(); $('#history').replaceChildren(); $('#live').replaceChildren();
      for (const caption of event.captions || []) renderCaption(caption);
    }
    show(event.status === 'live' ? 'room' : 'waiting');
    if (event.status === 'live' && (first || !wasLive) && state.desiredMic && state.capture) send({ type: 'mic', active: true });
    $('#exit').textContent = state.membership.host ? 'Terminar sala' : 'Sair da sala';
  } else if (event.type === 'caption') renderCaption(event.caption);
  else if (event.type === 'mic') {
    state.mic = event.active;
    if (state.capture && event.active) state.capture.seq = 0;
    micUI();
  } else if (event.type === 'error') {
    notice(event.message); if (!state.mic) { state.desiredMic = false; releaseCapture(); }
  } else if (event.type === 'ended') ended();
}
function clearSession() {
  state.intentional = true; clearTimeout(state.timer); state.socket?.close(); state.socket = null;
  state.mic = false; state.desiredMic = false; releaseCapture(); micUI();
  state.captions.clear(); $('#history').replaceChildren(); $('#live').replaceChildren();
  state.room = null; state.membership = null; sessionStorage.removeItem('chatex-membership');
  state.code = ''; $('#invited-room').hidden = true; $('#join-code').textContent = 'Entrar numa sala';
  history.replaceState(null, '', '/'); closeDialogs(); notice('');
}
function ended() { clearSession(); show('ended'); }
function confirmExit() {
  closeDialogs();
  $('#exit-title').textContent = state.membership?.host ? 'Terminar para todos?' : 'Sair da sala?';
  $('#exit-description').textContent = state.membership?.host ? 'As legendas serão apagadas.' : '';
  $('#confirm-exit').textContent = state.membership?.host ? 'Terminar' : 'Sair';
  $('#exit-dialog').showModal();
}
$('#name').oninput = nameUI;
$('#name').onchange = nameUI;
$('#name').onfocus = () => {
  if (!$('#home').classList.contains('name-editing')) nameViewportHeight = window.visualViewport?.height ?? window.innerHeight;
  scheduleNameViewport();
};
$('#name').onblur = event => {
  // Keep buttons in place through the click that dismisses the keyboard.
  if (!event.relatedTarget?.closest('#home')) scheduleNameViewport();
};
$('#create').onclick = event => void enter(event, { code: '' });
$('#join-code').onclick = event => {
  if (!personName() || state.busy) return;
  if (state.code) void enter(event);
  else $('#code-dialog').showModal();
};
$('#code-form').onsubmit = event => {
  event.preventDefault(); const code = codeInput($('#code-input').value);
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code)) { notice('Verifica o código da sala.'); return; }
  closeDialogs(); void enter(event, { code });
};
document.querySelectorAll('.home-button').forEach(button => button.onclick = () => { clearSession(); show('home'); });
document.querySelectorAll('[data-close]').forEach(button => button.onclick = closeDialogs);
$('#start').onclick = () => send({ type: 'start' });
$('#mic').onclick = () => { notice(''); if (state.mic || state.desiredMic) void disableMic(); else void enableMic(); };
$('#composer').onsubmit = event => { event.preventDefault(); const text = $('#reply').value.trim(); if (text && send({ type: 'text', text, id: crypto.randomUUID() })) $('#reply').value = ''; };
$('#room-menu').onclick = () => $('#menu-dialog').showModal();
$('#larger').onclick = () => { document.body.classList.toggle('larger'); closeDialogs(); };
function openInvite() { closeDialogs(); qr('#invite-qr'); $('#invite-code').textContent = state.code; $('#invite-dialog').showModal(); }
$('#invite').onclick = openInvite; $('#waiting-invite').onclick = openInvite;
$('#share').onclick = async () => {
  try {
    if (navigator.share) await navigator.share({ title: 'chatex', url: invitation() });
    else { await navigator.clipboard.writeText(invitation()); closeDialogs(); notice('Convite copiado.'); }
  } catch (error) { if (error.name !== 'AbortError') notice('Partilha o código da sala.'); }
};
$('#exit').onclick = confirmExit; $('#leave-waiting').onclick = confirmExit;
$('#confirm-exit').onclick = () => {
  if (!send({ type: state.membership.host ? 'end' : 'leave' })) { notice('Espera pela ligação para sair da sala.'); return; }
  if (!state.membership.host) { clearSession(); show('home'); }
};
$('#history').onscroll = () => { const h = $('#history'); state.atLive = h.scrollHeight - h.scrollTop - h.clientHeight < 40; $('#return-live').hidden = state.atLive; };
$('#return-live').onclick = () => { state.atLive = true; $('#history').scrollTop = $('#history').scrollHeight; $('#return-live').hidden = true; };
setInterval(() => send({ type: 'ping' }), 25000);
window.addEventListener('pagehide', () => { state.desiredMic = false; state.mic = false; releaseCapture(); state.socket?.close(); });
window.addEventListener('pageshow', event => { if (event.persisted && state.membership) connect(); });
async function init() {
  nameUI();
  const code = codeInput(new URL(location.href).searchParams.get('room') || '');
  let saved; try { saved = JSON.parse(sessionStorage.getItem('chatex-membership')); } catch { sessionStorage.removeItem('chatex-membership'); }
  if (saved?.code && (!code || code === saved.code)) {
    try { await request(`/rooms/${saved.code}`); state.membership = saved; state.code = saved.code; show('waiting'); connect(); return; }
    catch { sessionStorage.removeItem('chatex-membership'); }
  }
  if (code) await joinScreen(code); else show('home');
}
void init().catch(error => notice(error.message));
