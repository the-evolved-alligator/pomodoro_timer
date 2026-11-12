/* eslint-disable */
// @ts-nocheck
const TEMPLATE = `<div class="mb" data-phase="idle">
  <header>
    <h1 class="mb-h1">Pomodoro <span>music breaks</span></h1>
    <p class="mb-sub">Focus music while you work. Your own songs on your break.</p>
  </header>

  <section class="mb-timer mb-card" aria-live="polite">
    <div class="mb-phase" id="phaseLabel">Ready</div>
    <div class="mb-clock" id="clock">25:00</div>
    <div class="mb-bar"><div class="mb-barfill" id="barFill"></div></div>
    <div class="mb-round" id="roundLabel">Session 1</div>
    <div class="mb-controls">
      <button id="startBtn" class="mb-primary">Start</button>
      <button id="skipBtn" title="Skip to next phase">Skip phase</button>
      <button id="resetBtn">Reset</button>
    </div>
    <p class="mb-hint" id="tapHint" hidden>Music was blocked by the browser. Tap below to start it.
      <button id="tapBtn">Play music</button></p>
  </section>

  <section class="mb-player mb-card">
    <div class="mb-nowrow">
      <div class="mb-now" id="nowPlaying">Nothing playing yet</div>
      <div class="mb-pcontrols">
        <button id="prevBtn" title="Previous song" aria-label="Previous song">&#9198;</button>
        <button id="playBtn" title="Play / pause" aria-label="Play or pause">&#9199;</button>
        <button id="nextBtn" title="Next song" aria-label="Next song">&#9197;</button>
      </div>
    </div>
    <div class="mb-vol" id="volRow"><label for="vol">Volume</label><input id="vol" type="range" min="0" max="100" value="70"></div>
    <div class="mb-ytwrap" id="ytwrap"><div id="yt"></div></div>
    <div class="mb-spwrap" id="spwrap" hidden><div id="sp"></div></div>
    <p class="mb-small">The player must stay visible. Keep this tab open while the timer runs. Spotify embeds play full songs only if you are logged in to Spotify in this browser (otherwise 30 s previews), and volume/skip are in the Spotify player.</p>
  </section>

  <section class="mb-card mb-settings">
    <h2>Music</h2>
    <label>Focus music <small>(YouTube or Spotify link)</small>
      <input id="focusUrl" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off">
    </label>
    <div class="mb-presets" id="presets"></div>
    <label>Break songs <small>(your YouTube or Spotify playlist link)</small>
      <input id="breakUrl" type="url" inputmode="url" placeholder="https://www.youtube.com/playlist?list=..." autocomplete="off">
    </label>
    <div class="mb-msg" id="urlMsg"></div>
    <label class="mb-check"><input type="checkbox" id="shuffleBreak"> Shuffle break playlist</label>
    <label class="mb-check"><input type="checkbox" id="shuffleFocus"> Shuffle focus playlist</label>
    <label class="mb-check"><input type="checkbox" id="wholeSongs"> Let the song finish: end the break when the current song ends (after the break time is up)</label>
    <label class="mb-check"><input type="checkbox" id="resumeFocus"> Resume focus music where it left off (same focus video)</label>

    <h2>Timer</h2>
    <div class="mb-grid">
      <label>Focus (min)<input id="focusMin" type="number" min="1" max="180" inputmode="numeric"></label>
      <label>Break (min)<input id="breakMin" type="number" min="1" max="60" inputmode="numeric"></label>
      <label>Long break (min)<input id="longMin" type="number" min="1" max="90" inputmode="numeric"></label>
      <label>Long break every<input id="everyN" type="number" min="2" max="12" inputmode="numeric"></label>
    </div>
    <label class="mb-check"><input type="checkbox" id="autoNext" checked> Start next phase automatically</label>
    <label class="mb-check"><input type="checkbox" id="chime" checked> Chime at phase change</label>
    <label class="mb-check"><input type="checkbox" id="notify"> Browser notification at phase change</label>
  </section>

  <footer>No account, no backend. Settings stay in this browser.</footer>
</div>`;
// Music-breaks mode: port of the standalone demo (github: pomodoro-music-breaks). Mounts into `root`, returns a cleanup function.
export function mountMusicBreaks(root: HTMLElement, profile: { key?: string; defaults?: Record<string, unknown> } = {}): () => void {
root.innerHTML = TEMPLATE;
const $ = id => root.querySelector('#' + id);
let dead = false;
const wrap = root.querySelector('.mb');
const prevTitle = document.title;
const DEFAULTS = {
  focusUrl: 'https://www.youtube.com/watch?v=rFZHOHl-L8A', breakUrl: '',
  focusMin: 25, breakMin: 5, longMin: 15, everyN: 4,
  shuffleBreak: true, shuffleFocus: false, wholeSongs: false, resumeFocus: true,
  autoNext: true, chime: true, notify: false, vol: 70
};
const PRESETS = [
  ['Synthwave radio', 'https://www.youtube.com/watch?v=4xDzrJKXOOY'],
  ['Lofi hip hop radio', 'https://www.youtube.com/watch?v=rFZHOHl-L8A'],
  ['Spotify: chill lofi', 'https://open.spotify.com/playlist/37i9dQZF1DX8Uebhn9wzrS'],
  ['Spotify: peaceful piano', 'https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO']
];
const LABEL = { idle: 'Ready', focus: 'Focus', break: 'Break', longbreak: 'Long break' };

const PROFILE = profile || {};
const KEY = PROFILE.key || 'pmb.cfg';
let cfg = Object.assign({}, DEFAULTS, PROFILE.defaults || {});
try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };

// ---------- state ----------
const S = { phase: 'idle', running: false, endAt: 0, remaining: cfg.focusMin * 60000, total: cfg.focusMin * 60000,
  done: 0, finishing: false, finishSince: 0, focusSaved: null, current: null, loadedKey: null, pendingShuffle: false };

// ---------- helpers ----------
function parseYT(input) {
  input = (input || '').trim();
  if (!input) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return { video: input, key: 'v:' + input };
  if (/^(PL|UU|OL|FL|LL)[A-Za-z0-9_-]{10,}$/.test(input)) return { list: input, key: 'l:' + input };
  let u; try { u = new URL(/^https?:\/\//.test(input) ? input : 'https://' + input); } catch (e) { return null; }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
  if (!/(^|\.)youtube\.com$|^youtu\.be$|^youtube-nocookie\.com$/.test(host)) return null;
  const list = u.searchParams.get('list');
  if (list) return { list, key: 'l:' + list };
  let v = u.searchParams.get('v');
  if (!v && host === 'youtu.be') v = u.pathname.slice(1);
  const m = u.pathname.match(/^\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
  if (!v && m) v = m[2];
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v.slice(0, 11))) { v = v.slice(0, 11); return { video: v, key: 'v:' + v }; }
  return null;
}
function parseSpotify(input) {
  input = (input || '').trim();
  let m = input.match(/^spotify:(playlist|album|track|episode|show|artist):([A-Za-z0-9]{22})$/);
  if (!m) {
    let u; try { u = new URL(/^https?:\/\//.test(input) ? input : 'https://' + input); } catch (e) { return null; }
    if (u.hostname !== 'open.spotify.com') return null;
    m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track|episode|show|artist)\/([A-Za-z0-9]{22})/);
    if (!m) return null;
  }
  const uri = 'spotify:' + m[1] + ':' + m[2];
  return { type: 'spotify', kind: m[1], uri, key: 's:' + uri };
}
const parseSrc = input => parseSpotify(input) || parseYT(input);
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const phaseMs = p => (p === 'focus' ? cfg.focusMin : p === 'break' ? cfg.breakMin : cfg.longMin) * 60000;

// ---------- chime / notify ----------
let actx;
function chime() {
  if (!cfg.chime) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    [0, .22, .44].forEach((t, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = [660, 880, 1100][i]; o.connect(g); g.connect(actx.destination);
      const n = actx.currentTime + t;
      g.gain.setValueAtTime(.0001, n); g.gain.exponentialRampToValueAtTime(.25, n + .02); g.gain.exponentialRampToValueAtTime(.0001, n + .2);
      o.start(n); o.stop(n + .22);
    });
  } catch (e) {}
}
function notify(text) {
  if (!cfg.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification('Pomodoro', { body: text }); } catch (e) {}
}

// ---------- YouTube ----------
let player = null, ytReady = false, queue = null;
function createPlayer() {
  if (dead || player) return;
  player = new YT.Player($('yt'), {
    width: '100%', height: '100%',
    host: 'https://www.youtube.com',
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, enablejsapi: 1, origin: location.origin },
    events: { onReady: () => { ytReady = true; player.setVolume(cfg.vol); if (queue) { const q = queue; queue = null; q(); } }, onStateChange: onYTState, onError: onYTError }
  });
}
if (window.YT && window.YT.Player) createPlayer();
else {
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { if (prev) prev(); createPlayer(); };
  if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) { const tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag); }
}

// ---------- Spotify (embed IFrame API; no volume/next/prev control from outside) ----------
let sp = null, spCreating = false, spQueue = null, spSt = { paused: true, pos: 0, dur: 0 };
let spWanted = null;
function ensureSpotify(uri) {
  if (dead) return;
  spWanted = uri;
  const w = window;
  if (!w.__pmbSpApi) {
    w.__pmbSpCbs = w.__pmbSpCbs || [];
    w.__pmbSpCbs.push(() => ensureSpotify(spWanted));
    if (!w.__pmbSpTag) { w.__pmbSpTag = true; w.onSpotifyIframeApiReady = api => { w.__pmbSpApi = api; w.__pmbSpCbs.splice(0).forEach(f => f()); }; const t = document.createElement('script'); t.src = 'https://open.spotify.com/embed/iframe-api/v1'; t.async = true; document.head.appendChild(t); }
    return;
  }
  if (sp || spCreating) return;
  spCreating = true;
  w.__pmbSpApi.createController($('sp'), { uri, width: '100%', height: 152 }, ctrl => {
    sp = ctrl; spCreating = false;
    ctrl.addListener('playback_update', e => {
      const d = e.data || {}; spSt = { paused: !!d.isPaused, pos: d.position || 0, dur: d.duration || 0 };
      if (S.current && S.current.type === 'spotify' && !d.isPaused) { $('tapHint').hidden = true; $('nowPlaying').textContent = 'Spotify: playing'; }
    });
    ctrl.addListener('ready', () => { if (spQueue) { const q = spQueue; spQueue = null; q(); } });
    setTimeout(() => { if (spQueue) { const q = spQueue; spQueue = null; q(); } }, 1500);
  });
}
function spotifyPlay(src, resumeOnly) {
  $('prevBtn').hidden = $('nextBtn').hidden = true; $('volRow').hidden = true;
  $('ytwrap').hidden = true; $('spwrap').hidden = false;
  const go = () => { try { if (!resumeOnly) sp.loadUri(src.uri); sp.play(); } catch (x) {} setTimeout(checkBlocked, 2500); };
  if (sp) go(); else { spQueue = go; ensureSpotify(src.uri); }
  $('nowPlaying').textContent = 'Spotify: loading...';
}
function stopOther(active) {
  if (active !== 'yt' && player && ytReady) try { player.pauseVideo(); } catch (x) {}
  if (active !== 'spotify' && sp) try { sp.pause(); } catch (x) {}
  if (active !== 'spotify') { $('spwrap').hidden = true; }
  if (active !== 'yt') { $('ytwrap').hidden = active === 'spotify'; }
  if (active === 'yt') { $('prevBtn').hidden = $('nextBtn').hidden = false; $('volRow').hidden = false; $('ytwrap').hidden = false; }
}
const isSp = () => S.current && S.current.type === 'spotify';
function curPause() { try { if (isSp()) { if (sp) sp.pause(); } else if (player && ytReady) player.pauseVideo(); } catch (x) {} }
function curPlay() { try { if (isSp()) { if (sp) sp.resume(); } else if (player && ytReady) player.playVideo(); } catch (x) {} }
function whenReady(fn) { if (ytReady) fn(); else queue = fn; }

function loadSource(src, shuffle, resume) {
  if (!src) return false;
  stopOther('yt');
  whenReady(() => {
    const start = resume && resume.key === src.key ? resume : null;
    S.loadedKey = src.key; S.pendingShuffle = !!shuffle;
    if (src.list) {
      player.loadPlaylist({ listType: 'playlist', list: src.list, index: start ? start.index : 0, startSeconds: start ? start.time : 0 });
    } else {
      player.loadPlaylist({ playlist: [src.video], index: 0, startSeconds: start ? start.time : 0 });
    }
    player.setLoop(true);
    player.setVolume(cfg.vol);
    setTimeout(checkBlocked, 2500);
  });
  return true;
}
function onYTState(e) {
  const st = e.data;
  if (st === YT.PlayerState.PLAYING) {
    $('tapHint').hidden = true;
    if (S.pendingShuffle) { S.pendingShuffle = false; try { player.setShuffle(true); } catch (x) {} }
    try { const d = player.getVideoData(); $('nowPlaying').textContent = d && d.title ? d.title : 'Playing'; } catch (x) {}
  }
  if (st === YT.PlayerState.ENDED && S.finishing) finishBreakNow();
}
function onYTError(e) {
  // errors from the empty, not-yet-loaded player are meaningless: only report once a link was requested
  if (!S.current || S.phase === 'idle') return;
  const why = { 2: 'YouTube rejected the link parameters (invalid video/playlist id)', 5: 'player error (HTML5 playback failed)', 100: 'video or playlist not found or private', 101: 'the owner blocked embedding', 150: 'the owner blocked embedding' }[e.data] || ('playback error ' + e.data);
  const which = (S.phase === 'focus' ? 'Focus' : 'Break') + ' link ' + (S.current.list ? 'playlist ' + S.current.list : 'video ' + S.current.video);
  $('nowPlaying').textContent = which + ' failed: ' + why + '.' + (S.current.list ? ' Skipping.' : '');
  if (S.current.list && e.data !== 2) setTimeout(() => { try { player.nextVideo(); } catch (x) {} }, 800);
}
function checkBlocked() {
  if (!S.running || S.phase === 'idle') return;
  if (!isSp() && !player) return;
  if (S.phase !== 'focus' && !S.current) return;
  if (isSp()) { if (spSt.paused) $('tapHint').hidden = false; return; }
  try { const st = player.getPlayerState(); if (st !== 1 && st !== 3) $('tapHint').hidden = false; } catch (x) {}
}

function saveFocusPosition() {
  if (!player || !ytReady || S.phase !== 'focus' || !S.loadedKey || (S.current && S.current.type === 'spotify')) return;
  try { S.focusSaved = { key: S.loadedKey, index: Math.max(0, player.getPlaylistIndex()), time: player.getCurrentTime() || 0 }; } catch (x) {}
}
function startMusicFor(phase) {
  const isFocus = phase === 'focus';
  const src = parseSrc(isFocus ? cfg.focusUrl : cfg.breakUrl);
  S.current = src;
  if (!src) {
    stopOther('none');
    const raw = (isFocus ? cfg.focusUrl : cfg.breakUrl);
    $('nowPlaying').textContent = raw ? (isFocus ? 'Focus' : 'Break') + ' link not recognised as a YouTube or Spotify link: "' + raw.slice(0, 60) + '"' : (isFocus ? 'No focus music set' : 'No break playlist set');
    return;
  }
  if (src.type === 'spotify') { stopOther('spotify'); S.loadedKey = src.key; spotifyPlay(src); return; }
  loadSource(src, isFocus ? cfg.shuffleFocus : cfg.shuffleBreak, isFocus && cfg.resumeFocus ? S.focusSaved : null);
}

// ---------- timer ----------
function setPhase(p, auto) {
  if (S.phase === 'focus') saveFocusPosition();
  S.phase = p; S.finishing = false;
  S.total = phaseMs(p); S.remaining = S.total; S.endAt = Date.now() + S.total;
  wrap.dataset.phase = p;
  startMusicFor(p);
  if (auto && !cfg.autoNext) { S.running = false; curPause(); }
  render();
}
function nextPhase() {
  if (S.phase === 'focus') {
    S.done++;
    const long = S.done % cfg.everyN === 0;
    chime(); notify(long ? 'Long break. Enjoy your songs.' : 'Break time. Enjoy your songs.');
    setPhase(long ? 'longbreak' : 'break', true);
  } else {
    chime(); notify('Back to focus.');
    setPhase('focus', true);
  }
}
function finishBreakNow() { S.finishing = false; nextPhase(); }

function tick() {
  if (S.running) {
    S.remaining = S.endAt - Date.now();
    if (S.remaining <= 0 && S.phase !== 'idle') {
      if (S.phase !== 'focus' && cfg.wholeSongs && S.current && (isSp() || (player && ytReady))) {
        let left = 0, playing = false;
        try { if (isSp()) { playing = !spSt.paused; left = spSt.dur - spSt.pos; } else { playing = player.getPlayerState() === 1; left = (player.getDuration() - player.getCurrentTime()) * 1000; } } catch (x) {}
        if (!S.finishing && playing && left > 1500 && left < 15 * 60000) { S.finishing = true; S.finishSince = Date.now(); S.finishCap = Date.now() + left + 8000; }
        if (S.finishing) {
          if (Date.now() > S.finishCap) finishBreakNow();
          S.remaining = 0; render(); return;
        }
      }
      nextPhase();
    }
  }
  render();
}

function render() {
  $('phaseLabel').textContent = S.finishing ? 'Break: finishing song' : LABEL[S.phase] + (S.running || S.phase === 'idle' ? '' : ' (paused)');
  $('clock').textContent = mmss(S.remaining);
  $('barFill').style.width = (S.phase === 'idle' ? 0 : (1 - Math.max(0, S.remaining) / S.total) * 100) + '%';
  const nth = S.phase === 'focus' ? S.done + 1 : Math.max(1, S.done);
  $('roundLabel').textContent = 'Session ' + nth + ' · ' + S.done + ' done · long break every ' + cfg.everyN;
  $('startBtn').textContent = S.running ? 'Pause' : (S.phase === 'idle' ? 'Start' : 'Resume');
  document.title = (S.phase === 'idle' ? '' : mmss(S.remaining) + ' ' + LABEL[S.phase] + ' · ') + 'Pomodoro Music Breaks';
}

function start() {
  if (S.phase === 'idle') {
    // user gesture: unlock audio contexts + start music inside the click
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (x) {}
    S.running = true; setPhase('focus');
  } else if (S.running) {
    S.running = false; S.remaining = S.endAt - Date.now();
    curPause();
  } else {
    S.running = true; S.endAt = Date.now() + S.remaining;
    curPlay();
  }
  render();
}
function reset() {
  S.running = false; S.phase = 'idle'; S.done = 0; S.finishing = false; S.focusSaved = null; S.current = null;
  S.total = S.remaining = cfg.focusMin * 60000; wrap.dataset.phase = 'idle';
  if (player && ytReady) try { player.stopVideo(); } catch (x) {}
  if (sp) try { sp.pause(); } catch (x) {}
  $('nowPlaying').textContent = 'Nothing playing yet'; $('tapHint').hidden = true;
  render();
}
function skip() {
  if (S.phase === 'idle') return;
  S.running = true; S.finishing = false;
  if (S.phase === 'focus') { S.phase = 'focus'; }
  nextPhase(); S.running = true; render();
}

// ---------- UI wiring ----------
function bindSettings() {
  const text = ['focusUrl', 'breakUrl'], nums = ['focusMin', 'breakMin', 'longMin', 'everyN'],
        checks = ['shuffleBreak', 'shuffleFocus', 'wholeSongs', 'resumeFocus', 'autoNext', 'chime', 'notify'];
  text.forEach(k => { $(k).value = cfg[k]; $(k).addEventListener('change', () => { cfg[k] = $(k).value.trim(); save(); validate(); { const ps = parseSpotify(cfg[k]); if (ps) { if (!sp) ensureSpotify(ps.uri); } } if (S.running) { const cur = S.phase === 'focus' ? 'focusUrl' : 'breakUrl'; if (k === cur) startMusicFor(S.phase); } }); $(k).addEventListener('input', validate); });
  nums.forEach(k => { $(k).value = cfg[k]; $(k).addEventListener('change', () => {
    let v = Math.round(+$(k).value); const lim = $(k).min ? [+$(k).min, +$(k).max] : [1, 999];
    if (!(v >= lim[0])) v = DEFAULTS[k]; v = Math.min(v, lim[1]); $(k).value = v; cfg[k] = v; save();
    if (S.phase === 'idle') { S.total = S.remaining = cfg.focusMin * 60000; } render();
  }); });
  checks.forEach(k => { $(k).checked = !!cfg[k]; $(k).addEventListener('change', () => {
    cfg[k] = $(k).checked; save();
    if (k === 'notify' && cfg.notify && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }); });
  PRESETS.forEach(([name, url]) => { const b = document.createElement('button'); b.textContent = name; b.onclick = () => { $('focusUrl').value = url; cfg.focusUrl = url; save(); validate(); if (S.running && S.phase === 'focus') startMusicFor('focus'); }; $('presets').appendChild(b); });
  $('vol').value = cfg.vol; $('vol').addEventListener('input', () => { cfg.vol = +$('vol').value; save(); if (player && ytReady) player.setVolume(cfg.vol); });
}
function validate() {
  const m = $('urlMsg'); const f = $('focusUrl').value.trim(), b = $('breakUrl').value.trim(); const bad = [];
  if (f && !parseSrc(f)) bad.push('focus link'); if (b && !parseSrc(b)) bad.push('break link');
  const mix = [f, b].some(x => /[?&]list=RD/.test(x));
  m.className = 'mb-msg' + (bad.length || mix ? ' mb-err' : '');
  m.textContent = bad.length ? 'Not a YouTube or Spotify link: ' + bad.join(', ') + '.' : mix ? 'Auto-generated Mix playlists (RD...) cannot be played by embeds. Use a regular playlist.' : (b ? '' : 'Tip: paste a break playlist to hear your own songs on breaks.');
}

$('startBtn').onclick = start; $('resetBtn').onclick = reset; $('skipBtn').onclick = skip;
$('tapBtn').onclick = () => { curPlay(); $('tapHint').hidden = true; };
$('playBtn').onclick = () => { try { if (isSp()) { sp.togglePlay(); } else player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo(); } catch (x) {} };
$('nextBtn').onclick = () => { try { player.nextVideo(); } catch (x) {} };
$('prevBtn').onclick = () => { try { player.previousVideo(); } catch (x) {} };
document.addEventListener('visibilitychange', tick);
bindSettings(); validate(); render();
// pre-create the Spotify player at load so the Start click can play inside the user gesture
{ const pre = [parseSpotify(cfg.focusUrl), parseSpotify(cfg.breakUrl)].filter(Boolean)[0]; if (pre) { spWanted = pre.uri; ensureSpotify(pre.uri); $('spwrap').hidden = true; } }
const tickId = setInterval(tick, 250);
return () => {
  dead = true; clearInterval(tickId);
  document.removeEventListener('visibilitychange', tick);
  try { if (player && player.destroy) player.destroy(); } catch (x) {}
  try { if (sp && sp.destroy) sp.destroy(); } catch (x) {}
  document.title = prevTitle;
};

}
