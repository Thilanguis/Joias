const SIZE = 8;
const GEM_TYPES = Object.freeze([
  { icon: '💎', name: 'Diamante', slug: 'diamante' },
  { icon: '🔶', name: 'Laranja', slug: 'laranja' },
  { icon: '⭐', name: 'Estrela', slug: 'estrela' },
  { icon: '🟣', name: 'Roxo', slug: 'roxo' },
  { icon: '🟢', name: 'Verde', slug: 'verde' },
  { icon: '❤️', name: 'Rubi', slug: 'rubi' },
]);
const GEMS = GEM_TYPES.map((gem) => gem.icon);
const POWER_MARK = Object.freeze({ crown: '👑', devil: '😈', cash: '💸', clock: '⏳' });
const POWER_NAME = Object.freeze({ crown: 'Coroa', devil: 'Diabinho', cash: 'Grana extra', clock: 'Congela-tempo' });
const POWER_TYPE = Object.freeze({ crown: 2, devil: 3, cash: 1, clock: 4 });
const SCORE_BY_SIZE = { 3: 30, 4: 70, 5: 120 };
const BOT_PROFILES = Object.freeze({
  luna: { name: 'Luna', pool: 8, think: [1450, 2500], between: [850, 1450] },
  jade: { name: 'Jade', pool: 4, think: [900, 1650], between: [650, 1100] },
  ruby: { name: 'Ruby', pool: 2, think: [600, 1150], between: [480, 820] },
});
const SPECIAL_MARK = Object.freeze({ row: '↔', col: '↕', bomb: '💣', prism: '◆' });
const SPECIAL_NAME = Object.freeze({ row: 'Seta horizontal', col: 'Seta vertical', bomb: 'Bomba 3×3', prism: 'Arco-íris' });
const SPECIAL_PRIORITY = Object.freeze({ row: 1, col: 1, bomb: 2, prism: 3 });
const ANIM = Object.freeze({ swap: 250, invalid: 340, matchPrime: 90, match: 340, cascadePause: 150, specialBorn: 520 });
const CREATION_MOMENT = Object.freeze({ moves: 1400, special: 1100 });
const MATCH_AUDIO_SRC = './audio/gem-match.mp3';
const BOMB_AUDIO_SRC = './audio/bomb.mp3';
const POWER_AUDIO = Object.freeze({
  // Original tick transients at ~0.7s and ~1.7s; stop before the third (~2.7s).
  clock: { src: './audio/clock.mp3', volume: 1, duration: 2.1, originalEnvelope: true },
  // Speech ends around 1.2s; retain its tail, omit only the remaining silence.
  moves: { src: './audio/extra-move.mp3', volume: 0.75, duration: 1.35, voice: true },
  crown: { src: './audio/crown.mp3', volume: 0.48 },
  cash: { src: './audio/cash.mp3', volume: 0.6 },
  devil: { src: './audio/devil.mp3', volume: 0.65, voice: true },
});
const MATCH_AUDIO_RATE = Object.freeze([1, 1.07, 1.14, 1.21, 1.26]);
const DEFAULT_POINT_VALUE = 0.01; // 100 pontos = R$ 1,00
const CROWN_BASE_SECONDS = 8;
const CROWN_STEP_SECONDS = 2;
const CROWN_BASE_MOVES = 2;
const DIRECT_CASH_BONUS = 3;
const CLOCK_FREEZE_SECONDS = 10;
const DEVIL_RACE_PENALTY_SECONDS = 2;
const DEVIL_TURN_PENALTY_SECONDS = 5;
const TURN_SECONDS = 90;
const MIN_TURN_SECONDS = 30;


const $ = (id) => document.getElementById(id);
const screens = ['menuScreen', 'gameScreen', 'resultScreen'];
let nextCellId = 1;
let state = null;
let timerId = null;
let botTimerId = null;
let botTurnToken = 0;
let busy = { player: false, rival: false };
let selected = { player: null, rival: null };
let pointerGesture = { player: null, rival: null };
let suppressNextClick = { player: false, rival: false };
let resolveExternalChallenge = null;
let matchAudioContext = null;
let matchAudioBuffer = null;
let matchAudioLoadPromise = null;
let bombAudioBuffer = null;
let bombAudioLoadPromise = null;
let commonAudioGain = null;
const powerAudioLoads = new Map();
const powerAudioDurations = new Map();
const powerAudioQueue = [];
const activePowerAudio = new Set();
let powerAudioTimer = null;
let powerAudioEpoch = 0;
let lastPowerAudioAt = -Infinity;
let scoreDisplay = { player: 0, rival: 0 };
let scoreTarget = { player: 0, rival: 0 };
let scoreAnimationFrame = { player: null, rival: null };
// Presentation only: rules and online snapshots always use the real state.
// Read at the match → travel → hover before landing → impact → count → fade.
const HUD_REWARD = Object.freeze({ read: 360, approach: 980, land: 1120, arrival: 1300, update: 1420, fade: 1840, end: 2040, stagger: 160 });
const hudHolds = new Set();
const hudLanes = new Map();
const hudTimers = new Set();
const rewardFlights = new Set();
let rewardGeometryRevision = 0;
window.addEventListener('scroll', () => { rewardGeometryRevision += 1; }, { passive: true, capture: true });
window.addEventListener('resize', () => { rewardGeometryRevision += 1; }, { passive: true });
let onlineHudRivalTime = null;

function hudLater(callback, ms) {
  const match = state;
  const timer = setTimeout(() => {
    hudTimers.delete(timer);
    if (state === match && state) callback();
  }, ms);
  hudTimers.add(timer);
}

function holdHudChange(side, kind, amount) {
  const hold = { side, kind, amount, match: state, round: state?.currentRound };
  hudHolds.add(hold);
  return hold;
}

function heldHudAmount(side, kind) {
  let total = 0;
  for (const hold of hudHolds) {
    if (hold.match !== state || hold.side !== side || hold.kind !== kind) continue;
    if (kind === 'moves' && (state.currentSide !== side || hold.round !== state.currentRound)) continue;
    total += hold.amount;
  }
  return total;
}

function shownHudTime(side) {
  return Math.max(0, timeFor(side) - heldHudAmount(side, 'time'));
}

function shownTurnTime(side) {
  let pending = 0;
  for (const hold of hudHolds) {
    if (hold.match === state && hold.side === side && hold.kind === 'penalty'
      && hold.appliedToTurn && hold.round === state.currentRound) pending += hold.amount;
  }
  return Math.max(0, state.turnTimeLeft + pending);
}

function setHudText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

function pulseHud(node, attack = false) {
  if (!node?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  node.getAnimations().forEach((animation) => animation.cancel());
  node.animate(attack
    ? [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }]
    : [{ transform: 'scale(1)' }, { transform: 'scale(1.045)' }, { transform: 'scale(1)' }],
  { duration: 320, easing: 'ease-out' });
}

function queueHudReward(side, kind, amount, { hold = null, wait = 0, label = '', sourceSide = side, origin = null, stack = 0 } = {}) {
  if (!state || (!amount && !label)) return;
  const destination = { score: 'Score', cash: 'Money', time: 'Clock', moves: 'Moves', crown: 'CrownBoostTime', penalty: 'Clock' }[kind];
  const laneId = `${side}${destination}Reward`;
  const node = $(laneId);
  if (!node) { if (hold) hudHolds.delete(hold); return; }
  const reservation = hold || holdHudChange(side, kind, amount);
  const queue = hudLanes.get(laneId) || [];
  // Frequent remote snapshots may arrive while a reward is being read. Keep one
  // accumulated follow-up per destination instead of building an animation backlog.
  const pending = queue.length > 1 ? queue[queue.length - 1] : null;
  if (pending && !label && !pending.customLabel && pending.kind === kind
    && pending.reservation.round === reservation.round
    && Math.sign(pending.reservation.amount) === Math.sign(amount)) {
    pending.reservation.amount += reservation.amount;
    hudHolds.delete(reservation);
    pending.text = hudRewardText(side, kind, pending.reservation.amount, label);
    return;
  }
  hudLanes.set(laneId, queue);
  queue.push({ reservation, text: hudRewardText(side, kind, amount, label), customLabel: !!label, side, kind, destination, wait, sourceSide, origin, stack });
  if (queue.length === 1) runHudReward(laneId);
}

function hudRewardText(side, kind, amount, label = '') {
  return label || (kind === 'score' ? `+${Math.round(amount).toLocaleString('pt-BR')}`
    : kind === 'cash' ? `+${formatMoney(amount)}`
      : kind === 'moves' ? `+${amount} MOV.`
        : kind === 'crown' ? `👑 x${crownMultiplierFor(side)}`
          : amount < 0 ? `😈 −${Number(Math.abs(amount).toFixed(1)).toLocaleString('pt-BR')}s` : `+${Number(amount.toFixed(1)).toLocaleString('pt-BR')}s`);
}

function rewardOrigin(positions) {
  const cells = [...positions].map((pos) => typeof pos === 'string' ? parseKey(pos) : pos);
  if (!cells.length) return null;
  return {
    x: (cells.reduce((sum, pos) => sum + pos.c, 0) / cells.length + .5) / SIZE,
    y: (cells.reduce((sum, pos) => sum + pos.r, 0) / cells.length + .5) / SIZE,
  };
}

function startRewardFlight(job, target, slot) {
  const layer = $('flightLayer');
  const board = boardRoot(job.sourceSide);
  if (!layer || !board || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const token = document.createElement('div');
  token.className = `reward-flight ${job.kind}${job.reservation.amount < 0 ? ' attack' : ''}`;
  token.dataset.destination = `${job.side}${job.destination}`;
  token.dataset.source = job.sourceSide;
  token.textContent = job.text;
  layer.appendChild(token);
  const flight = { token, frame: null };
  rewardFlights.add(flight);
  const started = performance.now();
  let revision = -1;
  let from, to, approach;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const paint = (now) => {
    const elapsed = now - started;
    if (elapsed >= HUD_REWARD.arrival) return; // Handoff to the destination slot.
    if (revision !== rewardGeometryRevision) {
      // Batch geometry reads once at launch, then only on scroll/resize. No
      // class-toggle/offsetWidth loops; animation restarts have their own token.
      const sourceRect = board.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const endRect = targetRect.width ? targetRect : slot.getBoundingClientRect();
      const tokenRect = token.getBoundingClientRect();
      const marginX = tokenRect.width / 2 + 8;
      const marginY = tokenRect.height / 2 + 8;
      const sourceY = clamp(sourceRect.top + sourceRect.height * (job.origin?.y ?? .35), marginY, innerHeight - marginY);
      // Stack toward the available space so simultaneous rewards never collapse
      // onto the same clamped point at the bottom edge of a phone.
      const stackDirection = sourceY + 3 * 46 > innerHeight - marginY ? -1 : 1;
      from = {
        x: clamp(sourceRect.left + sourceRect.width * (job.origin?.x ?? .5), marginX, innerWidth - marginX),
        y: clamp(sourceY + job.stack * 46 * stackDirection, marginY, innerHeight - marginY),
      };
      to = { x: endRect.left + endRect.width / 2, y: endRect.top + endRect.height / 2 };
      const distance = Math.hypot(from.x - to.x, from.y - to.y) || 1;
      const gap = Math.min(48, distance * .2);
      approach = { x: to.x + (from.x - to.x) / distance * gap, y: to.y + (from.y - to.y) / distance * gap };
      revision = rewardGeometryRevision;
    }
    let x = from.x, y = from.y;
    token.dataset.phase = 'read';
    if (elapsed >= HUD_REWARD.read && elapsed < HUD_REWARD.approach) {
      const t = (elapsed - HUD_REWARD.read) / (HUD_REWARD.approach - HUD_REWARD.read);
      const eased = t * t * (3 - 2 * t);
      x = mix(from.x, approach.x, eased);
      y = mix(from.y, approach.y, eased);
      token.dataset.phase = 'travel';
    } else if (elapsed >= HUD_REWARD.approach) {
      const t = clamp((elapsed - HUD_REWARD.land) / (HUD_REWARD.arrival - HUD_REWARD.land), 0, 1);
      x = mix(approach.x, to.x, t * t);
      y = mix(approach.y, to.y, t * t);
      token.dataset.phase = t > 0 ? 'land' : 'hover';
    }
    token.style.opacity = String(Math.min(1, elapsed / 100));
    token.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    flight.frame = requestAnimationFrame(paint);
  };
  flight.frame = requestAnimationFrame(paint);
  return flight;
}

function removeRewardFlight(flight) {
  if (!flight) return;
  cancelAnimationFrame(flight.frame);
  flight.token.remove();
  rewardFlights.delete(flight);
}

function runHudReward(laneId) {
  const queue = hudLanes.get(laneId);
  const job = queue?.[0];
  if (!job) return;
  job.endAt = performance.now() + job.wait + HUD_REWARD.end;
  hudLater(() => {
    const node = $(laneId);
    setHudText(node, job.text);
    node.classList.toggle('attack', job.kind === 'penalty' || job.reservation.amount < 0);
    const target = $(`${job.side}${job.destination}`);
    const flight = startRewardFlight(job, target, node);
    if (job.kind === 'cash' && job.reservation.amount > 0) playPowerSound('cash', job.side);
    if (!flight) node.classList.add('visible'); // Reduced motion still gets reading time.
    hudLater(() => {
      removeRewardFlight(flight);
      node.classList.add('visible');
      pulseHud(target.getClientRects().length ? target : node, job.kind === 'penalty' || job.reservation.amount < 0);
    }, HUD_REWARD.arrival);
    hudLater(() => {
      hudHolds.delete(job.reservation);
      renderHud();
    }, HUD_REWARD.update);
    hudLater(() => node.classList.remove('visible'), HUD_REWARD.fade);
    hudLater(() => {
      setHudText(node, '');
      queue.shift();
      if (queue.length) runHudReward(laneId);
      else hudLanes.delete(laneId);
    }, HUD_REWARD.end);
  }, job.wait);
}

function resetHudRewards() {
  document.querySelectorAll('.celebrating-creation, .moment-source, .moment-target').forEach(node => {
    node.classList.remove('celebrating-creation', 'moment-source', 'moment-target');
  });
  rewardFlights.forEach(removeRewardFlight);
  onlineHudRivalTime = null;
  hudTimers.forEach(clearTimeout);
  hudTimers.clear();
  hudHolds.clear();
  hudLanes.clear();
  document.querySelectorAll('.hud-reward').forEach((node) => {
    node.classList.remove('visible', 'attack');
    setHudText(node, '');
  });
  document.querySelectorAll('.freeze-status').forEach((node) => {
    node.classList.remove('active');
    node.textContent = '';
  });
}

function remainingHudRewardTime() {
  let remaining = 0;
  for (const queue of hudLanes.values()) {
    const queued = queue.slice(1).reduce((sum, job) => sum + job.wait + HUD_REWARD.end, 0);
    remaining = Math.max(remaining, queue[0].endAt - performance.now() + queued);
  }
  return Math.max(0, remaining);
}
const DEV_HOST = window.location.hostname;
const developerMode = ['localhost', '127.0.0.1', '::1'].includes(DEV_HOST) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(DEV_HOST) || DEV_HOST.endsWith('.local') || window.location.protocol === 'file:' || new URLSearchParams(window.location.search).get('dev') === '1';

let onlineRoomId = null;
let onlineSeat = null;
let onlineUnsubscribe = null;
let onlineLobby = null;
let onlineSyncingMenu = false;
let onlineCommitTimer = null;
let onlineLastPublishedAt = 0;
let onlineMatchStarted = false;
let db = null;
let fbDoc = null;
let fbGetDoc = null;
let fbOnSnapshot = null;
let fbSetDoc = null;
let fbUpdateDoc = null;
let firebaseLoadPromise = null;

async function ensureFirebase() {
  if (db && fbDoc) return true;
  if (!firebaseLoadPromise) {
    firebaseLoadPromise = import('./firebase.js').then((mod) => {
      db = mod.db;
      fbDoc = mod.doc;
      fbGetDoc = mod.getDoc;
      fbOnSnapshot = mod.onSnapshot;
      fbSetDoc = mod.setDoc;
      fbUpdateDoc = mod.updateDoc;
      return true;
    }).catch((error) => {
      firebaseLoadPromise = null;
      console.error('[Online] Firebase indisponível:', error);
      return false;
    });
  }
  return firebaseLoadPromise;
}


function showScreen(id) {
  if (id !== 'gameScreen') {
    resetHudRewards();
    resetPowerAudio();
  }
  screens.forEach((screen) => $(screen).classList.toggle('active', screen === id));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderDeveloperMode() {
  if ($('devTools')) $('devTools').hidden = !developerMode;
  if ($('devModeBadge')) $('devModeBadge').hidden = !developerMode;
}

function populateDevSelectors() {
  const row = $('devRow');
  const col = $('devCol');
  const type = $('devType');
  if (!row || !col || !type || row.options.length) return;
  for (let i = 1; i <= SIZE; i++) {
    row.add(new Option(String(i), String(i - 1)));
    col.add(new Option(String(i), String(i - 1)));
  }
  const center = Math.max(0, Math.floor((SIZE - 1) / 2));
  row.value = String(center);
  col.value = String(center);
  GEM_TYPES.forEach((gem, index) => type.add(new Option(`${gem.icon} ${gem.name}`, String(index))));
}

function ensureMatchAudio() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!matchAudioContext) matchAudioContext = new AudioContextCtor();
  if (!matchAudioLoadPromise) {
    matchAudioLoadPromise = fetch(MATCH_AUDIO_SRC)
      .then((response) => {
        if (!response.ok) throw new Error(`Falha ao carregar áudio: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => matchAudioContext.decodeAudioData(buffer))
      .then((decoded) => {
        matchAudioBuffer = decoded;
        return decoded;
      })
      .catch((error) => {
        console.warn('[Áudio] Som de encaixe indisponível.', error);
        return null;
      });
  }
  return matchAudioContext;
}

function unlockMatchAudio() {
  const context = ensureMatchAudio();
  if (context?.state === 'suspended') context.resume().catch(() => {});
  for (const kind of Object.keys(POWER_AUDIO)) void loadPowerAudio(kind);
  ensureBombAudio();
}

function commonAudioBus(context) {
  if (!commonAudioGain) {
    commonAudioGain = context.createGain();
    commonAudioGain.connect(context.destination);
  }
  return commonAudioGain;
}

function duckCommonAudio() {
  if (!matchAudioContext) return;
  const context = matchAudioContext;
  const gain = commonAudioBus(context).gain;
  gain.cancelScheduledValues(context.currentTime);
  gain.setTargetAtTime(activePowerAudio.size ? 0.58 : 1, context.currentTime, 0.06);
}

function loadPowerAudio(kind) {
  const context = ensureMatchAudio();
  if (!context) return Promise.resolve(null);
  if (!powerAudioLoads.has(kind)) {
    powerAudioLoads.set(kind, fetch(POWER_AUDIO[kind].src)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => { powerAudioDurations.set(kind, buffer.duration); return buffer; })
      .catch((error) => { console.warn(`[Áudio] Poder ${kind} indisponível.`, error); return null; }));
  }
  return powerAudioLoads.get(kind);
}

function stopPowerAudio(job) {
  if (!activePowerAudio.delete(job)) return;
  const now = matchAudioContext.currentTime;
  job.gain.gain.cancelScheduledValues(now);
  job.gain.gain.setTargetAtTime(0, now, 0.015);
  job.source.stop(now + 0.06);
}

function resetPowerAudio() {
  powerAudioEpoch += 1;
  clearTimeout(powerAudioTimer);
  powerAudioTimer = null;
  powerAudioQueue.length = 0;
  for (const job of activePowerAudio) stopPowerAudio(job);
  lastPowerAudioAt = -Infinity;
  duckCommonAudio();
}

function pumpPowerAudio() {
  clearTimeout(powerAudioTimer);
  powerAudioTimer = null;
  const now = performance.now();
  for (let i = powerAudioQueue.length - 1; i >= 0; i--) {
    const job = powerAudioQueue[i];
    if (job.match !== state || now - job.created > 2600) powerAudioQueue.splice(i, 1);
  }
  if (!powerAudioQueue.length) return;
  powerAudioQueue.sort((a, b) => b.priority - a.priority || a.created - b.created);
  const job = powerAudioQueue[0];
  // Incoming attacks can interrupt a quieter rival effect, never pile on top of it.
  if (job.priority >= 2.5) {
    for (const active of activePowerAudio) {
      if (active.kind === 'moves') continue; // Finish spoken words; never cut a syllable to prioritize another cue.
      if (active.priority < job.priority && (activePowerAudio.size >= 2
        || (POWER_AUDIO[job.kind].voice && POWER_AUDIO[active.kind].voice))) stopPowerAudio(active);
    }
  }
  const voiceBusy = POWER_AUDIO[job.kind].voice && [...activePowerAudio].some(active => POWER_AUDIO[active.kind].voice);
  if (activePowerAudio.size >= 2 || voiceBusy || now - lastPowerAudioAt < 180) {
    powerAudioTimer = setTimeout(pumpPowerAudio, 100);
    return;
  }
  powerAudioQueue.shift();
  const context = matchAudioContext;
  if (context?.state !== 'running') return;
  const config = POWER_AUDIO[job.kind];
  const source = context.createBufferSource();
  const gain = context.createGain();
  const duration = Math.min(job.buffer.duration, config.duration || Infinity);
  const volume = config.volume * (job.side === 'rival' && job.kind !== 'devil' ? 0.35 : 1);
  // Give the output and ducking a short head start. Speech starts at full gain,
  // from sample zero, without the effect fade-in swallowing the initial vowel.
  const startAt = context.currentTime + (job.kind === 'moves' ? 0.08 : 0.01);
  source.buffer = job.buffer;
  source.playbackRate.value = 1;
  const preserveEnvelope = job.kind === 'moves' || config.originalEnvelope;
  gain.gain.value = preserveEnvelope ? volume : 0;
  if (!preserveEnvelope) {
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(volume, startAt + 0.025);
    gain.gain.setValueAtTime(volume, startAt + Math.max(0.025, duration - 0.16));
    gain.gain.linearRampToValueAtTime(0, startAt + duration);
  }
  source.connect(gain);
  gain.connect(context.destination);
  Object.assign(job, { source, gain, startAt });
  activePowerAudio.add(job);
  lastPowerAudioAt = now;
  source.onended = () => {
    activePowerAudio.delete(job);
    source.disconnect();
    gain.disconnect();
    duckCommonAudio();
    pumpPowerAudio();
  };
  source.start(startAt, 0, duration); // One playback, never a loop.
  duckCommonAudio();
  if (powerAudioQueue.length) powerAudioTimer = setTimeout(pumpPowerAudio, 180);
}

async function playPowerSound(kind, side, { distinct = false, spotlight = false } = {}) {
  const match = state;
  const epoch = powerAudioEpoch;
  const created = performance.now();
  if (!match || document.hidden || !POWER_AUDIO[kind]) return;
  const context = ensureMatchAudio();
  if (!context) return;
  if (context.state === 'suspended') {
    try { await context.resume(); } catch { return; }
  }
  const buffer = await loadPowerAudio(kind);
  if (!buffer || state !== match || epoch !== powerAudioEpoch || document.hidden || performance.now() - created > 2600) return;
  // Coalesce repeated powers in a cascade, including while a clip is playing.
  if (!distinct && [...activePowerAudio, ...powerAudioQueue].some(job => job.kind === kind && job.side === side)) return;
  const priority = kind === 'devil' && side === 'rival' ? 3 : side === 'player' ? (spotlight ? 2.5 : 2) : 1;
  if (powerAudioQueue.length >= 8) return;
  powerAudioQueue.push({ kind, side, match, buffer, priority, created });
  pumpPowerAudio();
}

function recordPowerAudio(kind, side, options) {
  if (state?.opponentType === 'online' && side === 'player') {
    state.powerAudioEvents ??= {};
    state.powerAudioEvents[kind] = (state.powerAudioEvents[kind] || 0) + 1;
  }
  void playPowerSound(kind, side, options);
}

function syncPowerAudio(events = {}) {
  const previous = state.rivalPowerAudioEvents || {};
  for (const kind of ['clock', 'moves', 'crown', 'devil']) {
    const count = Math.max(0, Number(events[kind]) || 0);
    if (count > (previous[kind] || 0)) void playPowerSound(kind, 'rival');
    previous[kind] = Math.max(previous[kind] || 0, count);
  }
  state.rivalPowerAudioEvents = previous;
}

document.addEventListener('visibilitychange', () => { if (document.hidden) resetPowerAudio(); });

function ensureBombAudio() {
  const context = ensureMatchAudio();
  if (!context) return null;
  if (!bombAudioLoadPromise) {
    bombAudioLoadPromise = fetch(BOMB_AUDIO_SRC)
      .then((response) => {
        if (!response.ok) throw new Error(`Falha ao carregar explosão: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => context.decodeAudioData(buffer))
      .then((decoded) => {
        bombAudioBuffer = decoded;
        return decoded;
      })
      .catch((error) => {
        console.warn('[Áudio] Som de bomba indisponível.', error);
        return null;
      });
  }
  return context;
}

async function playBombSound(side) {
  const epoch = powerAudioEpoch;
  const context = ensureBombAudio();
  if (!context) return;
  if (context.state === 'suspended') {
    try { await context.resume(); } catch { return; }
  }
  const buffer = bombAudioBuffer || await bombAudioLoadPromise;
  if (!buffer || context.state !== 'running' || epoch !== powerAudioEpoch || document.hidden) return;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = side === 'rival' ? 0.23 : 0.38;
  source.connect(gain);
  gain.connect(commonAudioBus(context));
  source.onended = () => { source.disconnect(); gain.disconnect(); };
  source.start();
}

async function playMatchSound(side, cascade = 1) {
  const epoch = powerAudioEpoch;
  const context = ensureMatchAudio();
  if (!context) return;
  if (context.state === 'suspended') {
    try { await context.resume(); } catch { return; }
  }
  const buffer = matchAudioBuffer || await matchAudioLoadPromise;
  if (!buffer || context.state !== 'running' || epoch !== powerAudioEpoch || document.hidden) return;

  const source = context.createBufferSource();
  const gain = context.createGain();
  const rateIndex = Math.min(MATCH_AUDIO_RATE.length - 1, Math.max(0, cascade - 1));
  source.buffer = buffer;
  source.playbackRate.value = MATCH_AUDIO_RATE[rateIndex];
  gain.gain.value = side === 'rival' ? 0.34 : 0.52;
  source.connect(gain);
  gain.connect(commonAudioBus(context));
  source.onended = () => { source.disconnect(); gain.disconnect(); };
  source.start();
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomGemType() {
  return Math.floor(Math.random() * GEMS.length);
}

function randomPower() {
  const roll = Math.random();
  if (roll < 0.018) return 'crown';
  if (roll < 0.036) return 'devil';
  if (roll < 0.052) return 'cash';
  if (roll < 0.068) return 'clock';
  return null;
}

function makeCell(type = randomGemType(), special = null, power = randomPower()) {
  const powerType = power ? POWER_TYPE[power] : null;
  return { id: nextCellId++, type: Number.isInteger(powerType) ? powerType : type, special, power };
}

function matchType(cell) {
  if (!cell || cell.special === 'prism') return null;
  const powerType = cell.power ? POWER_TYPE[cell.power] : null;
  return Number.isInteger(powerType) ? powerType : cell.type;
}

function cloneBoard(board) {
  return board.map((row) => row.map((cell) => cell == null ? null : { ...cell }));
}

function samePos(a, b) {
  return !!a && !!b && a.r === b.r && a.c === b.c;
}

function isAdjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function inBounds(pos) {
  return pos.r >= 0 && pos.r < SIZE && pos.c >= 0 && pos.c < SIZE;
}

function key(r, c) {
  return `${r}:${c}`;
}

function parseKey(value) {
  const [r, c] = value.split(':').map(Number);
  return { r, c };
}

function swap(board, a, b) {
  [board[a.r][a.c], board[b.r][b.c]] = [board[b.r][b.c], board[a.r][a.c]];
}

function makesInitialMatch(board, r, c, type) {
  if (c >= 2 && matchType(board[r][c - 1]) === type && matchType(board[r][c - 2]) === type) return true;
  if (r >= 2 && matchType(board[r - 1][c]) === type && matchType(board[r - 2][c]) === type) return true;
  return false;
}

function createBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      let cell;
      do cell = makeCell(); while (makesInitialMatch(board, r, c, matchType(cell)));
      board[r][c] = cell;
    }
  }
  if (!findValidMove(board)) return createBoard();
  return board;
}

function findMatches(board) {
  const matched = new Set();
  const groups = [];

  for (let r = 0; r < SIZE; r++) {
    let start = 0;
    for (let c = 1; c <= SIZE; c++) {
      const startType = matchType(board[r][start]);
      if (c < SIZE && startType != null && matchType(board[r][c]) === startType) continue;
      const len = c - start;
      if (startType != null && len >= 3) {
        const cells = [];
        for (let x = start; x < c; x++) {
          matched.add(key(r, x));
          cells.push({ r, c: x });
        }
        groups.push({ cells, orientation: 'row', type: startType, length: len });
      }
      start = c;
    }
  }

  for (let c = 0; c < SIZE; c++) {
    let start = 0;
    for (let r = 1; r <= SIZE; r++) {
      const startType = matchType(board[start]?.[c]);
      if (r < SIZE && startType != null && matchType(board[r][c]) === startType) continue;
      const len = r - start;
      if (startType != null && len >= 3) {
        const cells = [];
        for (let x = start; x < r; x++) {
          matched.add(key(x, c));
          cells.push({ r: x, c });
        }
        groups.push({ cells, orientation: 'col', type: startType, length: len });
      }
      start = r;
    }
  }

  return { matched, groups };
}

function scoreGroups(groups, cascade) {
  let score = 0;
  for (const group of groups) {
    const base = SCORE_BY_SIZE[Math.min(5, group.length)] || 120 + (group.length - 5) * 50;
    score += base;
  }
  return Math.round(score * (1 + Math.max(0, cascade - 1) * 0.35));
}

function isDirectSpecialCombo(cellA, cellB) {
  if (!cellA || !cellB) return false;
  if (cellA.special === 'prism' || cellB.special === 'prism') return true;
  return !!cellA.special && !!cellB.special;
}

function hasMatchAfterSwap(board, a, b) {
  const aCell = board[a.r][a.c];
  const bCell = board[b.r][b.c];
  if (isDirectSpecialCombo(aCell, bCell)) return true;
  swap(board, a, b);
  const valid = findMatches(board).matched.size > 0;
  swap(board, a, b);
  return valid;
}

function findValidMove(board) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const a = { r, c };
      for (const b of [{ r: r + 1, c }, { r, c: c + 1 }]) {
        if (inBounds(b) && hasMatchAfterSwap(board, a, b)) return { a, b };
      }
    }
  }
  return null;
}

function allValidMoves(board) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const a = { r, c };
      for (const b of [{ r: r + 1, c }, { r, c: c + 1 }]) {
        if (inBounds(b) && hasMatchAfterSwap(board, a, b)) moves.push({ a, b });
      }
    }
  }
  return moves;
}

function chooseAnchor(cells, preferred = []) {
  for (const pos of preferred) {
    if (pos && cells.some((cell) => samePos(cell, pos))) return { ...pos };
  }
  return { ...cells[Math.floor((cells.length - 1) / 2)] };
}

function buildSpecialCreations(board, matchResult, preferred = []) {
  const creations = new Map();
  const memberships = new Map();

  matchResult.groups.forEach((group, index) => {
    group.cells.forEach((cell) => {
      const k = key(cell.r, cell.c);
      if (!memberships.has(k)) memberships.set(k, []);
      memberships.get(k).push(index);
    });
  });

  const tOrLGroups = new Set();
  for (const [coord, indexes] of memberships.entries()) {
    const groups = indexes.map((index) => matchResult.groups[index]);
    const rows = groups.filter((group) => group.orientation === 'row');
    const cols = groups.filter((group) => group.orientation === 'col');
    const intersect = rows.find((row) => cols.some((col) => col.type === row.type));
    if (!intersect) continue;
    const pos = parseKey(coord);
    const involved = indexes.filter((index) => matchResult.groups[index].type === intersect.type);
    involved.forEach((index) => tOrLGroups.add(index));
    const sources = [];
    involved.forEach((index) => {
      matchResult.groups[index].cells.forEach((cell) => {
        if (!sources.some((source) => samePos(source, cell))) sources.push({ r: cell.r, c: cell.c });
      });
    });
    creations.set(coord, { pos, special: 'bomb', type: intersect.type, reason: 'T/L', sources });
  }

  matchResult.groups.forEach((group, index) => {
    if (tOrLGroups.has(index)) return;
    let special = null;
    if (group.length >= 5) special = 'prism';
    else if (group.length === 4) special = group.orientation === 'row' ? 'row' : 'col';
    if (!special) return;
    const pos = chooseAnchor(group.cells, preferred);
    const k = key(pos.r, pos.c);
    const existing = creations.get(k);
    if (!existing || SPECIAL_PRIORITY[special] > SPECIAL_PRIORITY[existing.special]) {
      creations.set(k, {
        pos,
        special,
        type: group.type,
        reason: group.length >= 5 ? '5' : '4',
        sources: group.cells.map((cell) => ({ r: cell.r, c: cell.c })),
      });
    }
  });

  return [...creations.values()];
}

function addRow(clearSet, row) {
  for (let c = 0; c < SIZE; c++) clearSet.add(key(row, c));
}

function addCol(clearSet, col) {
  for (let r = 0; r < SIZE; r++) clearSet.add(key(r, col));
}

function addArea(clearSet, center, radius = 1) {
  for (let r = center.r - radius; r <= center.r + radius; r++) {
    for (let c = center.c - radius; c <= center.c + radius; c++) {
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) clearSet.add(key(r, c));
    }
  }
}

function addColor(clearSet, board, type) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (matchType(board[r][c]) === type) clearSet.add(key(r, c));
    }
  }
}

function expandAllEffects(board, initial, protectedKeys = new Set()) {
  const clearSet = new Set(initial);
  const queue = [...initial];
  const queued = new Set(queue);
  const triggered = new Set();
  const powerTriggered = new Set();
  let crownCount = 0;
  let cashCount = 0;
  let clockCount = 0;
  let devilCount = 0;

  // Uma peça usada para criar seta/bomba/arco-íris continua ativando o poder aleatório
  // que ela já carregava antes de virar a nova especial.
  for (const value of protectedKeys) {
    if (initial.has(value) && !queued.has(value)) { queue.push(value); queued.add(value); }
  }

  const enqueueNew = (before) => {
    for (const value of clearSet) {
      if (!before.has(value) && !queued.has(value)) { queue.push(value); queued.add(value); }
    }
  };

  while (queue.length) {
    const currentKey = queue.shift();
    const pos = parseKey(currentKey);
    const cell = board[pos.r]?.[pos.c];
    if (!cell) continue;

    if (cell.special && !triggered.has(currentKey)) {
      triggered.add(currentKey);
      const before = new Set(clearSet);
      if (cell.special === 'row') addRow(clearSet, pos.r);
      else if (cell.special === 'col') addCol(clearSet, pos.c);
      else if (cell.special === 'bomb') addArea(clearSet, pos, 1);
      else if (cell.special === 'prism') {
        const neighbors = [
          board[pos.r]?.[pos.c - 1], board[pos.r]?.[pos.c + 1],
          board[pos.r - 1]?.[pos.c], board[pos.r + 1]?.[pos.c],
        ].filter(Boolean).filter((neighbor) => neighbor.special !== 'prism');
        const type = matchType(neighbors[0]);
        if (Number.isInteger(type)) addColor(clearSet, board, type);
      }
      enqueueNew(before);
    }

    if (cell.power && !powerTriggered.has(currentKey)) {
      powerTriggered.add(currentKey);
      if (cell.power === 'crown') crownCount += 1;
      if (cell.power === 'cash') cashCount += 1;
      if (cell.power === 'clock') clockCount += 1;
      if (cell.power === 'devil') devilCount += 1;
    }
  }

  protectedKeys.forEach((value) => clearSet.delete(value));
  return { clearSet, triggered, powerTriggered, crownCount, cashCount, clockCount, devilCount };
}

function expandSpecialClear(board, initial, protectedKeys = new Set()) {
  const clearSet = new Set(initial);
  const queue = [...initial];
  const triggered = new Set();

  while (queue.length) {
    const currentKey = queue.shift();
    if (protectedKeys.has(currentKey)) continue;
    const pos = parseKey(currentKey);
    const cell = board[pos.r]?.[pos.c];
    if (!cell?.special || triggered.has(currentKey)) continue;
    triggered.add(currentKey);
    const before = new Set(clearSet);

    if (cell.special === 'row') addRow(clearSet, pos.r);
    else if (cell.special === 'col') addCol(clearSet, pos.c);
    else if (cell.special === 'bomb') addArea(clearSet, pos, 1);
    else if (cell.special === 'prism') {
      const neighbors = [
        board[pos.r]?.[pos.c - 1], board[pos.r]?.[pos.c + 1],
        board[pos.r - 1]?.[pos.c], board[pos.r + 1]?.[pos.c],
      ].filter(Boolean).filter((neighbor) => neighbor.special !== 'prism');
      const type = neighbors[0]?.type;
      if (Number.isInteger(type)) addColor(clearSet, board, type);
    }

    for (const value of clearSet) if (!before.has(value)) queue.push(value);
  }

  protectedKeys.forEach((value) => clearSet.delete(value));
  return { clearSet, triggered };
}

function buildDirectSpecialPlan(board, a, b) {
  const cellA = board[a.r][a.c];
  const cellB = board[b.r][b.c];
  const clearSet = new Set([key(a.r, a.c), key(b.r, b.c)]);
  let label = 'Especial!';
  let timeBonus = 1;

  if (cellA.special === 'prism' || cellB.special === 'prism') {
    const prismPos = cellA.special === 'prism' ? a : b;
    const otherPos = cellA.special === 'prism' ? b : a;
    const other = board[otherPos.r][otherPos.c];
    if (other?.special === 'prism') {
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) clearSet.add(key(r, c));
      label = '🌈 ARCO-ÍRIS DUPLO!';
      timeBonus = 3;
    } else if (Number.isInteger(other?.type)) {
      addColor(clearSet, board, other.type);
      label = `🌈 ${GEMS[other.type]} ${GEM_TYPES[other.type].name} em massa!`; 
      timeBonus = other?.special ? 3 : 2;
      if (other?.special === 'row') {
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
          if (matchType(board[r][c]) === other.type) addRow(clearSet, r);
        }
      } else if (other?.special === 'col') {
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
          if (matchType(board[r][c]) === other.type) addCol(clearSet, c);
        }
      } else if (other?.special === 'bomb') {
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
          if (matchType(board[r][c]) === other.type) addArea(clearSet, { r, c }, 1);
        }
      }
    }
    clearSet.add(key(prismPos.r, prismPos.c));
  } else if (cellA.special && cellB.special) {
    const types = new Set([cellA.special, cellB.special]);
    if (types.has('bomb') && types.size === 1) {
      addArea(clearSet, a, 2);
      addArea(clearSet, b, 2);
      label = '💣 BOMBA DUPLA!';
      timeBonus = 3;
    } else if (types.has('bomb')) {
      const bombPos = cellA.special === 'bomb' ? a : b;
      const lineCell = cellA.special === 'bomb' ? cellB : cellA;
      if (lineCell.special === 'row') {
        for (let r = Math.max(0, bombPos.r - 1); r <= Math.min(SIZE - 1, bombPos.r + 1); r++) addRow(clearSet, r);
      } else if (lineCell.special === 'col') {
        for (let c = Math.max(0, bombPos.c - 1); c <= Math.min(SIZE - 1, bombPos.c + 1); c++) addCol(clearSet, c);
      }
      label = '💣 COMBO DE BOMBA!';
      timeBonus = 3;
    } else {
      addRow(clearSet, a.r);
      addCol(clearSet, a.c);
      addRow(clearSet, b.r);
      addCol(clearSet, b.c);
      label = '↔↕ SETAS CRUZADAS!';
      timeBonus = 2;
    }
  }

  const expanded = expandAllEffects(board, clearSet);
  return { ...expanded, label, timeBonus };
}

function collapseBoard(board) {
  const movement = new Map();
  for (let c = 0; c < SIZE; c++) {
    const kept = [];
    for (let r = SIZE - 1; r >= 0; r--) {
      const cell = board[r][c];
      if (cell != null) kept.push({ cell, fromR: r });
    }

    let targetR = SIZE - 1;
    for (const { cell, fromR } of kept) {
      board[targetR][c] = cell;
      movement.set(cell.id, { fromR, toR: targetR, isNew: false });
      targetR--;
    }

    let spawnIndex = 0;
    while (targetR >= 0) {
      const cell = makeCell();
      board[targetR][c] = cell;
      movement.set(cell.id, { fromR: -1 - spawnIndex, toR: targetR, isNew: true });
      spawnIndex++;
      targetR--;
    }
  }
  return movement;
}

function shuffledCopy(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function reshuffleBoard(board) {
  const original = board.flat().filter(Boolean);
  for (let attempt = 0; attempt < 220; attempt++) {
    const shuffled = shuffledCopy(original);
    const candidate = Array.from({ length: SIZE }, (_, r) => shuffled.slice(r * SIZE, (r + 1) * SIZE));
    if (findMatches(candidate).matched.size === 0 && findValidMove(candidate)) {
      for (let r = 0; r < SIZE; r++) board[r] = candidate[r];
      return true;
    }
  }
  const fresh = createBoard();
  for (let r = 0; r < SIZE; r++) board[r] = fresh[r];
  return true;
}

async function ensurePlayableForSide(side, { announce = true } = {}) {
  const board = boardData(side);
  if (!board || findValidMove(board)) return false;
  if (announce) {
    const notice = $('reshuffleNotice');
    if (notice) {
      notice.textContent = `${sideName(side)} ficou sem movimentos. Embaralhando…`;
      notice.classList.add('show');
    }
    const stateNode = $(side === 'player' ? 'playerMoveState' : 'rivalMoveState');
    if (stateNode) stateNode.textContent = 'Sem movimentos';
    if (side === 'player') $('comboLabel').textContent = 'Sem movimentos possíveis. Embaralhando automaticamente…';
    await delay(620);
  }
  reshuffleBoard(board);
  renderBoard(side);
  if (announce) {
    const notice = $('reshuffleNotice');
    if (notice) {
      notice.textContent = 'Tabuleiro embaralhado!';
      setTimeout(() => notice.classList.remove('show'), 1100);
    }
  }
  await commitOnlinePlayerIfNeeded(side);
  return true;
}

function boardRoot(side) {
  return side === 'player' ? $('board') : $('rivalBoard');
}

function boardData(side) {
  if (!state) return null;
  return side === 'player' ? state.board : state.rivalBoard;
}

function scoreFor(side) {
  return side === 'player' ? state.playerScore : state.rivalScore;
}

function setScore(side, value) {
  if (side === 'player') state.playerScore = value;
  else state.rivalScore = value;
}

function bonusMoneyFor(side) {
  if (!state) return 0;
  return Number(side === 'player' ? state.playerBonusMoney : state.rivalBonusMoney) || 0;
}

function setBonusMoney(side, value) {
  if (!state) return;
  const safeValue = Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
  if (side === 'player') state.playerBonusMoney = safeValue;
  else state.rivalBonusMoney = safeValue;
}

function addBonusMoney(side, value) {
  if (!state || !value) return;
  setBonusMoney(side, bonusMoneyFor(side) + value);
}

function sideName(side) {
  if (state?.opponentType === 'online') {
    const seat = Number(state.onlineSeat ?? onlineSeat ?? 0);
    const names = state.onlineNames || ['Jogador 1', 'Jogador 2'];
    return side === 'player' ? (names[seat] || 'Você') : (names[1 - seat] || 'Rival');
  }
  if (side === 'player') return 'Você';
  return BOT_PROFILES[state?.botProfile]?.name || 'Rival';
}

function otherSide(side) {
  return side === 'player' ? 'rival' : 'player';
}

function timeFor(side) {
  return side === 'player' ? state.playerTime : state.rivalTime;
}

function setTime(side, value) {
  if (side === 'player') state.playerTime = value;
  else state.rivalTime = value;
}

function formatSeconds(value) {
  return `${Math.max(0, value).toFixed(1).replace('.', ',')}s`;
}

function formatMoney(value) {
  return `R$ ${Math.max(0, Number(value) || 0).toFixed(2).replace('.', ',')}`;
}

function pointValue() {
  return Math.max(0, Number(state?.pointValue ?? DEFAULT_POINT_VALUE));
}

function scoreMoney(score) {
  return Math.max(0, Number(score) || 0) * pointValue();
}

function totalMoneyFor(side, shownScore = null) {
  const score = shownScore == null ? scoreFor(side) : shownScore;
  return Math.round((scoreMoney(score) + bonusMoneyFor(side)) * 100) / 100;
}

function crownBoostFor(side) {
  if (!state) return 0;
  return Math.max(0, Number(side === 'player' ? state.playerCrownBoost : state.rivalCrownBoost) || 0);
}

function crownLevelFor(side) {
  if (!state) return 0;
  return Math.max(0, Math.floor(Number(side === 'player' ? state.playerCrownLevel : state.rivalCrownLevel) || 0));
}

function crownMultiplierFor(side) {
  const level = crownLevelFor(side);
  return level > 0 ? 2 ** level : 1;
}

function crownDurationForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  if (state?.format === 'turns') return CROWN_BASE_MOVES + safeLevel - 1;
  return CROWN_BASE_SECONDS + (safeLevel - 1) * CROWN_STEP_SECONDS;
}

function setCrownBoostLevel(side, level) {
  if (!state) return;
  const value = Math.max(0, Math.floor(Number(level) || 0));
  if (side === 'player') state.playerCrownLevel = value;
  else state.rivalCrownLevel = value;
}

function setCrownBoost(side, amount) {
  if (!state) return;
  const level = crownLevelFor(side);
  const max = level > 0 ? crownDurationForLevel(level) : 0;
  const value = Math.max(0, Math.min(max, Number(amount) || 0));
  if (side === 'player') state.playerCrownBoost = value;
  else state.rivalCrownBoost = value;
  if (value <= 0.02) setCrownBoostLevel(side, 0);
}

function activateCrownBoost(side, count = 1, origin = null) {
  if (!state) return;
  let remaining = Math.max(1, Math.floor(Number(count) || 1));
  while (remaining > 0) {
    const active = crownBoostFor(side) > 0.02 && crownLevelFor(side) > 0;
    const nextLevel = active ? crownLevelFor(side) + 1 : 1;
    setCrownBoostLevel(side, nextLevel);
    setCrownBoost(side, crownDurationForLevel(nextLevel));
    remaining -= 1;
  }
  queueHudReward(side, 'crown', Math.max(1, Math.floor(Number(count) || 1)), { origin });
  recordPowerAudio('crown', side);
  renderCrownBoost(side);
}

function consumeCrownMove(side) {
  if (!state || state.format !== 'turns') return;
  const before = crownBoostFor(side);
  if (before <= 0) return;
  setCrownBoost(side, Math.max(0, before - 1));
}

function renderCrownBoost(side) {
  if (!state) return;
  const root = $(side === 'player' ? 'playerCrownBoost' : 'rivalCrownBoost');
  const timeNode = $(side === 'player' ? 'playerCrownBoostTime' : 'rivalCrownBoostTime');
  const fill = $(side === 'player' ? 'playerCrownBoostFill' : 'rivalCrownBoostFill');
  if (!root || !timeNode || !fill) return;
  const level = Math.max(0, crownLevelFor(side) - heldHudAmount(side, 'crown'));
  const remaining = crownBoostFor(side);
  root.hidden = remaining <= 0.02 || level === 0;
  if (root.hidden) return;
  const multiplier = 2 ** level;
  const max = crownDurationForLevel(level);
  timeNode.textContent = state.format === 'turns'
    ? `x${multiplier} · ${Math.ceil(remaining)} jog.`
    : `x${multiplier} · ${formatSeconds(remaining)}`;
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, remaining / Math.max(1, max)))})`;
}

function updateMoneyLeadDisplay(playerShown = scoreDisplay.player, rivalShown = scoreDisplay.rival) {
  if (!state) return;
  const node = $('moneyLead');
  const totals = {};
  for (const [side, score] of [['player', playerShown], ['rival', rivalShown]]) {
    totals[side] = Math.max(0, totalMoneyFor(side, score) - heldHudAmount(side, 'cash'));
    setHudText($(side + 'Money'), formatMoney(totals[side]));
  }
  setHudText($('moneyRate'), '100 pts = ' + formatMoney(pointValue() * 100));
  const solo = state.opponentType === 'solo';
  const diff = Math.round((totals.player - totals.rival) * 100) / 100;
  const leaderClass = solo ? 'solo-money' : diff > 0 ? 'leader-player' : diff < 0 ? 'leader-rival' : 'leader-tie';
  if (node.dataset.leader !== leaderClass) {
    node.classList.remove('solo-money', 'leader-player', 'leader-rival', 'leader-tie');
    node.classList.add(leaderClass);
    node.dataset.leader = leaderClass;
  }
  const label = solo ? 'VALOR GERADO' : diff === 0 ? 'EMPATE' : sideName(diff > 0 ? 'player' : 'rival').toUpperCase() + ' NA FRENTE';
  setHudText($('moneyLeadLabel'), label);
  setHudText($('moneyLeadValue'), (solo || !diff ? '' : '+') + formatMoney(solo ? totals.player : Math.abs(diff)));
}

function renderFreezeStatus(side) {
  const node = $(side + 'Freeze');
  const remaining = state.format === 'turns' && state.currentSide !== side ? 0 : clockFreezeFor(side);
  if (remaining > 0) {
    setHudText(node, '⏸ CONGELADO · ' + formatSeconds(remaining));
    node.classList.add('active');
  } else if (node.classList.contains('active')) {
    setHudText(node, '⏸ CONGELADO · 0,0s');
    node.classList.remove('active');
  }
}

function animateScoreHud(side, target) {
  const node = $(side === 'player' ? 'playerScore' : 'rivalScore');
  if (!node) return;
  const safeTarget = Math.max(0, Math.round(Number(target) || 0));
  if (scoreTarget[side] === safeTarget && scoreAnimationFrame[side]) return;
  if (scoreTarget[side] === safeTarget && Math.round(scoreDisplay[side]) === safeTarget) {
    node.textContent = safeTarget.toLocaleString('pt-BR');
    updateMoneyLeadDisplay();
    return;
  }

  if (scoreAnimationFrame[side]) cancelAnimationFrame(scoreAnimationFrame[side]);
  const start = Number.isFinite(scoreDisplay[side]) ? scoreDisplay[side] : 0;
  const delta = safeTarget - start;
  scoreTarget[side] = safeTarget;
  const started = performance.now();
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 420;

  const step = (now) => {
    const t = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const shown = Math.round(start + delta * eased);
    scoreDisplay[side] = shown;
    node.textContent = shown.toLocaleString('pt-BR');
    updateMoneyLeadDisplay();
    if (t < 1) scoreAnimationFrame[side] = requestAnimationFrame(step);
    else {
      scoreDisplay[side] = safeTarget;
      scoreAnimationFrame[side] = null;
      node.textContent = safeTarget.toLocaleString('pt-BR');
      updateMoneyLeadDisplay();
    }
  };
  scoreAnimationFrame[side] = requestAnimationFrame(step);
}

function resetScoreHud(player = 0, rival = 0) {
  resetHudRewards();
  for (const side of ['player', 'rival']) {
    if (scoreAnimationFrame[side]) cancelAnimationFrame(scoreAnimationFrame[side]);
    scoreAnimationFrame[side] = null;
  }
  scoreDisplay = { player: Number(player) || 0, rival: Number(rival) || 0 };
  scoreTarget = { ...scoreDisplay };
  updateMoneyLeadDisplay();
}

function showDevilAttack(side, penaltySeconds, appliedSeconds = penaltySeconds, origin = null, wait = 0) {
  if (!state || !penaltySeconds || state.opponentType === 'solo') return;
  const target = otherSide(side);
  const turns = state.format === 'turns';
  queueHudReward(target, turns ? 'penalty' : 'time', turns ? appliedSeconds : -appliedSeconds, {
    sourceSide: side, origin, wait, stack: 3,
    label: appliedSeconds > 0
      ? '😈 −' + Number(appliedSeconds.toFixed(1)).toLocaleString('pt-BR') + 's' + (turns ? ' PRÓX.' : '')
      : turns ? '😈 LIMITE' : '😈 SEM TEMPO',
  });
}

function renderTimeBars() {
  if (!state) return;
  const race = state.format === 'race';
  [['player', 'playerTimeBar', 'playerTimeFill'], ['rival', 'rivalTimeBar', 'rivalTimeFill']].forEach(([side, barId, fillId]) => {
    const bar = $(barId); const fill = $(fillId);
    if (!bar || !fill) return;

    if (race) {
      const visible = side === 'player' || state.opponentType !== 'solo';
      bar.hidden = !visible;
      bar.style.visibility = '';
      if (!visible) return;
      const base = Math.max(1, Number(state.duration) || 60);
      const current = shownHudTime(side);
      const basePct = Math.max(0, Math.min(100, (current / base) * 100));
      const overflowPct = Math.max(0, Math.min(55, ((current - base) / base) * 100));
      fill.style.transform = `scaleX(${basePct / 100})`;
      bar.style.setProperty('--overflow-width', `${overflowPct}%`);
      bar.classList.toggle('has-overflow', overflowPct > 0.05);
      return;
    }

    const visible = state.currentSide === side && (side === 'player' || state.opponentType !== 'solo');
    bar.hidden = false;
    bar.style.visibility = visible ? 'visible' : 'hidden';
    bar.classList.remove('has-overflow');
    bar.style.setProperty('--overflow-width', '0%');
    if (!visible) return;
    const current = shownTurnTime(side);
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, current / TURN_SECONDS))})`;
  });
}

function showPlayFeedback(side, { points = 0, seconds = 0, moves = 0, money = 0, holds = {}, origin = null } = {}) {
  let wait = 0;
  for (const [kind, amount] of [['score', points], ['time', seconds], ['moves', moves], ['cash', money]]) {
    if (!amount) continue;
    queueHudReward(side, kind, amount, { hold: holds[kind], wait, origin, stack: wait / HUD_REWARD.stagger });
    wait += HUD_REWARD.stagger;
  }
}

function collectCascadeFeedback(side, rewards, points, money, origin = null) {
  rewards.origin ??= origin;
  for (const [kind, amount] of [['score', points], ['cash', money]]) {
    if (!amount) continue;
    if (rewards.holds[kind]) rewards.holds[kind].amount += amount;
    else rewards.holds[kind] = holdHudChange(side, kind, amount);
  }
  rewards.points += points;
  rewards.money += money;
}

function canHumanInteract(side) {
  if (!state || state.finished || busy[side]) return false;
  if (side === 'rival') return false;
  if (state.format === 'race') return timeFor(side) > 0;
  return state.currentSide === side && state.movesLeft > 0 && state.turnTimeLeft > 0 && !state.turnEnding;
}

function renderHud() {
  if (!state) return;
  animateScoreHud('player', state.playerScore - heldHudAmount('player', 'score'));
  animateScoreHud('rival', state.rivalScore - heldHudAmount('rival', 'score'));
  updateMoneyLeadDisplay();
  renderCrownBoost('player');
  renderCrownBoost('rival');
  renderFreezeStatus('player');
  renderFreezeStatus('rival');
  $('gameScreen').classList.toggle('solo-game', state.opponentType === 'solo');
  renderTimeBars();

  const hasRival = state.opponentType !== 'solo';
  $('rivalHud').style.visibility = hasRival ? 'visible' : 'hidden';
  $('rivalPanel').hidden = !hasRival;
  $('versusMark').hidden = !hasRival;
  $('playerNameHud').textContent = sideName('player').toUpperCase();
  $('playerBoardTitle').textContent = sideName('player').toUpperCase();
  $('rivalNameHud').textContent = sideName('rival').toUpperCase();
  $('rivalBoardTitle').textContent = sideName('rival').toUpperCase();
  $('rivalBoard').classList.toggle('bot-controlled', state.opponentType === 'bot');

  if (state.format === 'race') {
    $('centerLabel').textContent = state.opponentType === 'solo' ? 'PARTIDA RÁPIDA' : 'CORRIDA';
    $('centerValue').textContent = state.opponentType === 'solo' ? 'TEMPO' : 'AO VIVO';
    $('centerSub').textContent = state.opponentType === 'solo' ? 'faça a maior pontuação' : 'cada um tem seu relógio';
    $('playerClock').hidden = false;
    $('playerClock').textContent = formatSeconds(shownHudTime('player'));
    $('rivalClock').hidden = !hasRival;
    $('rivalClock').textContent = formatSeconds(shownHudTime('rival'));
  } else {
    const activeSide = state.currentSide;
    const turnTime = shownTurnTime(activeSide);
    $('centerLabel').textContent = `RODADA ${Math.min(state.currentRound, state.rounds)}/${state.rounds}`;
    $('centerValue').textContent = activeSide === 'player' ? 'VOCÊ' : sideName('rival').toUpperCase();
    $('centerSub').textContent = '90s por turno';
    $('playerClock').hidden = false;
    $('rivalClock').hidden = !hasRival;
    $('playerClock').textContent = activeSide === 'player' ? formatSeconds(turnTime) : formatSeconds(TURN_SECONDS - turnPenaltyFor('player') + heldHudAmount('player', 'penalty'));
    $('rivalClock').textContent = activeSide === 'rival' ? formatSeconds(turnTime) : formatSeconds(TURN_SECONDS - turnPenaltyFor('rival') + heldHudAmount('rival', 'penalty'));
  }

  for (const side of ['player', 'rival']) {
    const turns = state.format === 'turns';
    const active = state.currentSide === side;
    $(side + 'MovesMetric').hidden = !turns;
    setHudText($(side + 'Moves'), active ? `${Math.max(0, state.movesLeft - heldHudAmount(side, 'moves'))} MOV.` : '— MOV.');
    setHudText($(side + 'ClockLabel'), turns && !active ? 'PRÓX. TURNO' : 'TEMPO');
  }

  updatePanelStates();
}

function updatePanelStates() {
  if (!state) return;
  for (const side of ['player', 'rival']) {
    const panel = $(side === 'player' ? 'playerPanel' : 'rivalPanel');
    if (!panel) continue;
    const inactiveTurn = state.format === 'turns' && state.currentSide !== side;
    const finishedSide = state.format === 'race' && timeFor(side) <= 0;
    panel.classList.toggle('inactive-turn', inactiveTurn);
    panel.classList.toggle('finished-side', finishedSide);
  }

  if (state.format === 'race') {
    $('playerMoveState').textContent = state.playerTime > 0 ? (busy.player ? 'Jogando…' : 'Jogando') : 'Tempo acabou';
    $('playerMoveState').className = `move-state${busy.player ? ' playing' : state.playerTime > 0 ? '' : ' waiting'}`;
    if (state.opponentType === 'online') {
      $('rivalMoveState').textContent = state.rivalTime > 0 ? 'Jogando' : 'Tempo acabou';
      $('rivalMoveState').className = `move-state${state.rivalTime > 0 ? '' : ' waiting'}`;
    } else if (state.opponentType === 'bot') {
      if (!busy.rival) {
        $('rivalMoveState').textContent = state.rivalTime > 0 ? 'Pensando…' : 'Tempo acabou';
        $('rivalMoveState').className = `move-state${state.rivalTime > 0 ? ' thinking' : ' waiting'}`;
      }
    }
  } else {
    $('playerMoveState').textContent = state.currentSide === 'player'
      ? (busy.player ? 'Jogando…' : 'Sua vez')
      : 'Aguardando';
    $('playerMoveState').className = `move-state${state.currentSide === 'player' ? busy.player ? ' playing' : '' : ' waiting'}`;
    if (state.opponentType === 'online') {
      $('rivalMoveState').textContent = state.currentSide === 'rival' ? 'Jogando' : 'Aguardando';
      $('rivalMoveState').className = `move-state${state.currentSide === 'rival' ? ' playing' : ' waiting'}`;
    } else if (state.opponentType === 'bot') {
      if (!busy.rival) {
        $('rivalMoveState').textContent = state.currentSide === 'rival' ? 'Pensando…' : 'Aguardando';
        $('rivalMoveState').className = `move-state${state.currentSide === 'rival' ? ' thinking' : ' waiting'}`;
      }
    }
  }
}

function renderBoard(side) {
  if (!state) return;
  const root = boardRoot(side);
  const data = boardData(side);
  if (!root || !data) return;

  const fragment = document.createDocumentFragment();
  data.forEach((row, r) => row.forEach((cell, c) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gem';
    button.classList.add((r + c) % 2 === 0 ? 'shade-a' : 'shade-b');
    button.setAttribute('role', 'gridcell');
    button.dataset.r = r;
    button.dataset.c = c;
    button.dataset.cellId = cell.id;
    const effectiveType = matchType(cell);
    const gemMeta = GEM_TYPES[Number.isInteger(effectiveType) ? effectiveType : cell.type];
    const specialName = cell.special ? `, especial ${SPECIAL_NAME[cell.special]}` : '';
    const powerName = cell.power ? `, poder ${POWER_NAME[cell.power]}` : '';
    button.setAttribute('aria-label', `Peça ${gemMeta.name} ${gemMeta.icon}${specialName}${powerName}, linha ${r + 1}, coluna ${c + 1}`);
    button.title = `${gemMeta.icon} ${gemMeta.name}${cell.special ? ` · ${SPECIAL_NAME[cell.special]}` : ''}${cell.power ? ` · ${POWER_MARK[cell.power]} ${POWER_NAME[cell.power]}` : ''}`;
    button.classList.add(`gem-type-${gemMeta.slug}`);
    if (selected[side] && selected[side].r === r && selected[side].c === c) button.classList.add('selected');
    if (cell.special) button.classList.add(`special-${cell.special}`);
    if (cell.power) button.classList.add('random-power', `power-${cell.power}`);

    const face = document.createElement('span');
    face.className = 'gem-face';
    if (cell.special === 'prism') {
      face.classList.add('prism-gem');
      face.textContent = '◆';
      face.setAttribute('aria-hidden', 'true');
    } else {
      face.textContent = gemMeta.icon;
    }
    button.append(face);

    if (cell.power) {
      const powerMark = document.createElement('span');
      powerMark.className = 'power-mark';
      powerMark.textContent = POWER_MARK[cell.power];
      powerMark.setAttribute('aria-hidden', 'true');
      button.append(powerMark);
    }

    if (cell.special && cell.special !== 'prism') {
      const mark = document.createElement('span');
      mark.className = 'special-mark';
      mark.textContent = SPECIAL_MARK[cell.special];
      mark.setAttribute('aria-hidden', 'true');
      button.append(mark);
    }

    if (cell.power && cell.special && cell.special !== 'prism') button.classList.add('stacked-marks');
    fragment.append(button);
  }));

  root.replaceChildren(fragment);
}

function renderAllBoards() {
  renderHud();
  renderBoard('player');
  if (state?.opponentType !== 'solo') renderBoard('rival');
}

function getCellElement(side, pos) {
  return boardRoot(side)?.querySelector(`.gem[data-r="${pos.r}"][data-c="${pos.c}"]`) || null;
}

async function animateSwap(side, a, b, { invalid = false } = {}) {
  const first = getCellElement(side, a);
  const second = getCellElement(side, b);
  if (!first || !second || !first.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await delay(1);
    return;
  }
  const ar = first.getBoundingClientRect();
  const br = second.getBoundingClientRect();
  const dx = br.left - ar.left;
  const dy = br.top - ar.top;
  const duration = invalid ? ANIM.invalid : ANIM.swap;
  const firstFrames = invalid
    ? [{ transform: 'translate(0,0)' }, { transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }]
    : [{ transform: 'translate(0,0)' }, { transform: `translate(${dx}px,${dy}px)` }];
  const secondFrames = invalid
    ? [{ transform: 'translate(0,0)' }, { transform: `translate(${-dx}px,${-dy}px)` }, { transform: 'translate(0,0)' }]
    : [{ transform: 'translate(0,0)' }, { transform: `translate(${-dx}px,${-dy}px)` }];
  const options = { duration, easing: invalid ? 'ease-in-out' : 'cubic-bezier(.2,.85,.3,1)', fill: 'both' };
  await Promise.allSettled([first.animate(firstFrames, options).finished, second.animate(secondFrames, options).finished]);
}

function cellPitch(root) {
  const a = root.querySelector('.gem[data-r="0"][data-c="0"]');
  const b = root.querySelector('.gem[data-r="1"][data-c="0"]');
  if (!a) return 48;
  if (!b) return a.getBoundingClientRect().height + 4;
  return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
}

async function animateFalls(side, movement) {
  const root = boardRoot(side);
  if (!root || !movement?.size || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const pitch = cellPitch(root);
  const animations = [];
  movement.forEach((info, id) => {
    if (info.fromR === info.toR && !info.isNew) return;
    const el = root.querySelector(`.gem[data-cell-id="${id}"]`);
    if (!el?.animate) return;
    const deltaRows = info.fromR - info.toR;
    const distance = deltaRows * pitch;
    const rows = Math.max(1, Math.abs(deltaRows));
    const duration = Math.min(820, 390 + rows * 58);
    const stagger = info.isNew ? Math.min(110, Math.max(0, (-info.fromR - 1) * 22)) : 0;
    animations.push(el.animate(
      [
        { transform: `translateY(${distance}px) scale(.98)`, opacity: info.isNew ? .12 : 1, offset: 0 },
        { transform: 'translateY(3px) scale(1)', opacity: 1, offset: .88 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 1 },
      ],
      { duration, delay: stagger, easing: 'cubic-bezier(.16,.76,.24,1)', fill: 'both' },
    ).finished);
  });
  await Promise.allSettled(animations);
}


function triggeredLineEffects(board, triggered) {
  const list = [];
  triggered.forEach((value) => {
    const pos = parseKey(value);
    const cell = board[pos.r]?.[pos.c];
    if (!cell?.special) return;
    if (cell.special === 'row' || cell.special === 'col') list.push({ r: pos.r, c: pos.c, special: cell.special });
  });
  return list;
}

async function showLineEffects(side, effects) {
  if (!effects?.length) return;
  const root = boardRoot(side);
  if (!root) return;
  const rootRect = root.getBoundingClientRect();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const waits = [];
  effects.forEach((effect) => {
    const cell = getCellElement(side, effect);
    if (!cell) return;
    const rect = cell.getBoundingClientRect();
    const blast = document.createElement('div');
    blast.className = `line-blast ${effect.special === 'row' ? 'row' : 'col'}`;
    if (effect.special === 'row') {
      blast.style.left = '0px';
      blast.style.top = `${rect.top - rootRect.top + rect.height / 2 - 8}px`;
      blast.style.width = `${rootRect.width}px`;
      blast.style.transformOrigin = `${((effect.c + .5) / SIZE) * 100}% 50%`;
    } else {
      blast.style.left = `${rect.left - rootRect.left + rect.width / 2 - 8}px`;
      blast.style.top = '0px';
      blast.style.height = `${rootRect.height}px`;
      blast.style.transformOrigin = `50% ${((effect.r + .5) / SIZE) * 100}%`;
    }
    root.appendChild(blast);
    const botLite = side === 'rival' && state?.opponentType === 'bot';
    if (!reduced && blast.animate) {
      const peakOpacity = botLite ? .34 : 1;
      const frames = effect.special === 'row'
        ? [{ transform: 'scaleX(.08)', opacity: 0 }, { transform: 'scaleX(1)', opacity: peakOpacity, offset: .25 }, { transform: 'scaleX(1)', opacity: 0 }]
        : [{ transform: 'scaleY(.08)', opacity: 0 }, { transform: 'scaleY(1)', opacity: peakOpacity, offset: .25 }, { transform: 'scaleY(1)', opacity: 0 }];
      waits.push(blast.animate(frames, { duration: botLite ? 220 : 360, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished.finally(() => blast.remove()));
    } else {
      waits.push(delay(botLite ? 160 : 300).then(() => blast.remove()));
    }
  });
  await Promise.allSettled(waits);
}

async function previewSpecialCreations(side, creations) {
  if (!creations?.length) return;
  const root = boardRoot(side);
  if (!root) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rivalLite = side === 'rival' && state?.opponentType === 'bot';
  const animations = [];

  creations.forEach((creation) => {
    const targetEl = root.querySelector(`.gem[data-r="${creation.pos.r}"][data-c="${creation.pos.c}"]`);
    if (targetEl) targetEl.classList.add('creation-target');
    const targetRect = targetEl?.getBoundingClientRect();

    (creation.sources || []).forEach((source) => {
      const isTarget = source.r === creation.pos.r && source.c === creation.pos.c;
      const sourceEl = root.querySelector(`.gem[data-r="${source.r}"][data-c="${source.c}"]`);
      if (!sourceEl) return;
      if (isTarget) {
        sourceEl.classList.add('creation-anchor');
        return;
      }
      sourceEl.classList.add('merge-source');
      if (rivalLite) return;
      if (!reduced && sourceEl.animate && targetRect) {
        const rect = sourceEl.getBoundingClientRect();
        const dx = (targetRect.left + targetRect.width / 2) - (rect.left + rect.width / 2);
        const dy = (targetRect.top + targetRect.height / 2) - (rect.top + rect.height / 2);
        animations.push(sourceEl.animate([
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${dx * .62}px, ${dy * .62}px) scale(.78)`, opacity: .86 },
          { transform: `translate(${dx}px, ${dy}px) scale(.38)`, opacity: 0 },
        ], { duration: 390, easing: 'cubic-bezier(.2,.78,.2,1)', fill: 'forwards' }).finished);
      }
    });
  });

  if (rivalLite) await delay(110);
  else if (animations.length) await Promise.allSettled(animations);
  else await delay(300);
}

// Celebrate the confirmed match while its sources are still on the board.
// This is presentation only: the accumulated rewards are applied as before.
async function showCreationMoments(side, creations, rewards) {
  if (!creations.length) return;
  const match = state;
  const root = boardRoot(side);
  if (!root || !match) return;
  try {
    for (const creation of creations) {
      if (state !== match || match.finished) return;
      const moves = match.format === 'turns' ? turnMovesFromCreation([creation]) : 0;
      const duration = moves
        ? Math.max(CREATION_MOMENT.moves, Math.min(POWER_AUDIO.moves.duration, powerAudioDurations.get('moves') || POWER_AUDIO.moves.duration) * 1000 + 80)
        : CREATION_MOMENT.special;
      const sources = (creation.sources || [creation.pos]).map(pos => getCellElement(side, pos)).filter(Boolean);
      const target = getCellElement(side, creation.pos);
      root.classList.add('celebrating-creation');
      sources.forEach(node => node.classList.add('moment-source'));
      target?.classList.add('moment-target');
      if (moves) {
        rewards.announcedMoves = (rewards.announcedMoves || 0) + moves;
        recordPowerAudio('moves', side, { distinct: true, spotlight: true });
      }
      // The existing sparkle also celebrates a new jewel; it grants no crown.
      if (!moves || creation.special === 'prism') void playPowerSound('crown', side, { distinct: true, spotlight: true });
      await delay(duration);
      sources.forEach(node => node.classList.remove('moment-source'));
      target?.classList.remove('moment-target');
    }
  } finally {
    // An abandoned match must never clean up the new match's presentation.
    if (state === match) root.classList.remove('celebrating-creation');
  }
}

async function showClear(side, clearSet, triggered = new Set()) {
  const root = boardRoot(side);
  const cells = [];
  for (const value of clearSet) {
    const { r, c } = parseKey(value);
    const el = root?.querySelector(`.gem[data-r="${r}"][data-c="${c}"]`);
    if (!el) continue;
    cells.push({ el, triggered: triggered.has(value) });
    el.classList.add('match-primed');
  }
  if (cells.length) await delay(ANIM.matchPrime);
  for (const { el, triggered: isTriggered } of cells) {
    el.classList.remove('match-primed');
    el.classList.add(isTriggered ? 'special-activated' : 'matched');
  }
  await delay(ANIM.match);
}

async function pulseCreatedSpecials(side, ids) {
  if (!ids?.length) return;
  const root = boardRoot(side);
  const promises = ids.map((id) => {
    const el = root?.querySelector(`.gem[data-cell-id="${id}"]`);
    if (!el) return null;
    el.classList.add('special-created');
    if (!el.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return delay(1);
    return delay(ANIM.specialBorn);
  }).filter(Boolean);
  await Promise.allSettled(promises);
}

function timeBonusFromCreation(creations, cascade) {
  let bonus = 0;
  for (const creation of creations) {
    if (creation.special === 'row' || creation.special === 'col') bonus += 4;
    else if (creation.special === 'bomb') bonus += 6;
    else if (creation.special === 'prism') bonus += 5;
  }
  if (cascade === 2) bonus += 1;
  else if (cascade >= 3) bonus += 2;
  return bonus;
}

function turnMovesFromCreation(creations) {
  return creations.filter((creation) => ['row', 'col', 'bomb', 'prism'].includes(creation.special)).length;
}



function awardTime(side, seconds) {
  if (!state || state.format !== 'race' || seconds <= 0) return;
  setTime(side, timeFor(side) + seconds);
}

function clockFreezeFor(side) {
  if (!state) return 0;
  return Math.max(0, Number(side === 'player' ? state.playerClockFreeze : state.rivalClockFreeze) || 0);
}

function setClockFreeze(side, seconds) {
  if (!state) return;
  const value = Math.max(0, Number(seconds) || 0);
  if (side === 'player') state.playerClockFreeze = value;
  else state.rivalClockFreeze = value;
}

function addClockFreeze(side, count = 1) {
  if (!state || count <= 0) return;
  setClockFreeze(side, clockFreezeFor(side) + Math.max(0, Number(count) || 0) * CLOCK_FREEZE_SECONDS);
  recordPowerAudio('clock', side);
}

function consumeClockFreeze(side, dt) {
  const before = clockFreezeFor(side);
  if (before <= 0 || dt <= 0) return dt;
  const frozen = Math.min(before, dt);
  setClockFreeze(side, before - frozen);
  return Math.max(0, dt - frozen);
}

function turnPenaltyFor(side) {
  if (!state) return 0;
  return Math.max(0, Number(side === 'player' ? state.playerTurnPenalty : state.rivalTurnPenalty) || 0);
}

function setTurnPenalty(side, seconds) {
  if (!state) return;
  const maxPenalty = TURN_SECONDS - MIN_TURN_SECONDS;
  const value = Math.max(0, Math.min(maxPenalty, Number(seconds) || 0));
  if (side === 'player') state.playerTurnPenalty = value;
  else state.rivalTurnPenalty = value;
}

function resetTurnClock(side) {
  if (!state || state.format !== 'turns') return;
  const penalty = turnPenaltyFor(side);
  for (const hold of hudHolds) {
    if (hold.match === state && hold.side === side && hold.kind === 'penalty') {
      hold.appliedToTurn = true;
      hold.round = state.currentRound;
    }
  }
  state.turnTimeLeft = Math.max(MIN_TURN_SECONDS, TURN_SECONDS - penalty);
  setTurnPenalty(side, 0);
  setClockFreeze(side, 0);
  state.lastTickAt = performance.now();
}

function publishOnlineRaceDevilPenalty(targetTime) {
  if (!state || state.opponentType !== 'online' || !Number.isInteger(onlineSeat)) return;
  const ref = onlineRoomRef();
  if (!ref) return;
  const targetSeat = 1 - onlineSeat;
  void fbUpdateDoc(ref, {
    [`match.players.${targetSeat}.time`]: Math.max(0, Number(targetTime) || 0),
    [`match.players.${onlineSeat}.powerAudioEvents`]: { ...state.powerAudioEvents },
    updatedAt: Date.now(),
  }).catch((error) => console.error('[Online] Falha ao publicar Diabinho:', error));
}

function applyDevilEffect(side, count = 0) {
  if (!state || count <= 0 || state.opponentType === 'solo') return 0;
  const target = otherSide(side);
  if (state.format === 'race') {
    const penalty = Math.max(0, Number(count) || 0) * DEVIL_RACE_PENALTY_SECONDS;
    const before = timeFor(target);
    setTime(target, Math.max(0, timeFor(target) - penalty));
    if (timeFor(target) < before) recordPowerAudio('devil', side);
    if (state.opponentType === 'online' && side === 'player') publishOnlineRaceDevilPenalty(timeFor(target));
    return penalty;
  }
  const penalty = Math.max(0, Number(count) || 0) * DEVIL_TURN_PENALTY_SECONDS;
  const before = turnPenaltyFor(target);
  setTurnPenalty(target, turnPenaltyFor(target) + penalty);
  if (turnPenaltyFor(target) > before) recordPowerAudio('devil', side);
  return penalty;
}

function createCascadeRewards() {
  return { seconds: 0, moves: 0, clockCount: 0, devilCount: 0, points: 0, money: 0, holds: {} };
}

function finalizeCascadeRewards(side, rewards) {
  if (!state || !rewards) return;
  // Apply gameplay immediately, exactly as before; only the HUD waits for reading.
  if (state.format === 'race' && rewards.seconds > 0) awardTime(side, rewards.seconds);
  if (state.format === 'turns' && rewards.moves > 0) {
    state.movesLeft += rewards.moves;
    if (rewards.moves > (rewards.announcedMoves || 0)) recordPowerAudio('moves', side);
  }
  if (rewards.clockCount > 0) addClockFreeze(side, rewards.clockCount);
  const target = otherSide(side);
  const before = state.format === 'race' ? timeFor(target) : turnPenaltyFor(target);
  const devilPenalty = applyDevilEffect(side, rewards.devilCount);
  const after = state.format === 'race' ? timeFor(target) : turnPenaltyFor(target);
  if (devilPenalty > 0) showDevilAttack(side, devilPenalty, Math.abs(after - before), rewards.origin, HUD_REWARD.stagger * 3);
  showPlayFeedback(side, {
    points: rewards.points, money: rewards.money, holds: rewards.holds, origin: rewards.origin,
    seconds: state.format === 'race' ? rewards.seconds : 0,
    moves: state.format === 'turns' ? rewards.moves : 0,
  });
  if (side === 'player') $('comboLabel').textContent = 'Arraste uma joia para combinar.';
  renderHud();
}

function clearBoardCells(board, clearSet) {
  for (const value of clearSet) {
    const { r, c } = parseKey(value);
    board[r][c] = null;
  }
}

async function resolveMatches(side, preferred = [], sharedRewards = null) {
  const match = state;
  const board = boardData(side);
  let cascade = 1;
  let total = 0;
  const rewards = sharedRewards || createCascadeRewards();
  const ownsRewards = !sharedRewards;

  while (state === match && state && !state.finished) {
    const result = findMatches(board);
    if (!result.matched.size) break;
    const creations = buildSpecialCreations(board, result, cascade === 1 ? preferred : []);
    const protectedKeys = new Set(creations.map((creation) => key(creation.pos.r, creation.pos.c)));
    const expanded = expandAllEffects(board, result.matched, protectedKeys);
    const clearSet = expanded.clearSet;
    const extraClears = Math.max(0, clearSet.size - Math.max(0, result.matched.size - protectedKeys.size));
    const rawGained = scoreGroups(result.groups, cascade) + extraClears * 12 + creations.length * 40;
    const origin = rewardOrigin(cascade === 1 && preferred.length ? preferred : result.matched);

    if (expanded.crownCount) activateCrownBoost(side, expanded.crownCount, origin);
    const crownMultiplier = crownMultiplierFor(side);
    const gained = Math.round(rawGained * crownMultiplier);
    total += gained;
    setScore(side, scoreFor(side) + gained);

    const moneyBonus = Math.round((expanded.cashCount || 0) * DIRECT_CASH_BONUS * 100) / 100;
    if (moneyBonus) addBonusMoney(side, moneyBonus);

    if (state.format === 'race') rewards.seconds += timeBonusFromCreation(creations, cascade);
    else rewards.moves += turnMovesFromCreation(creations);
    rewards.clockCount += expanded.clockCount || 0;
    rewards.devilCount += expanded.devilCount || 0;

    const usedBomb = [...expanded.triggered].some((value) => {
      const pos = parseKey(value);
      return board[pos.r]?.[pos.c]?.special === 'bomb';
    });

    if (side === 'player') $('comboLabel').textContent = cascade > 1 ? `Resolvendo cascata ×${cascade}…` : 'Resolvendo combinação…';
    collectCascadeFeedback(side, rewards, gained, moneyBonus, origin);
    const stateNode = $(side === 'player' ? 'playerMoveState' : 'rivalMoveState');
    if (stateNode) stateNode.textContent = cascade > 1 ? `Cascata x${cascade}` : `+${gained}`;
    renderHud();
    await showCreationMoments(side, creations, rewards);
    if (state !== match || match.finished) return total;
    void playMatchSound(side, cascade);
    if (usedBomb) void playBombSound(side);

    if (creations.length) await previewSpecialCreations(side, creations);
    if (state !== match || match.finished) return total;
    await showLineEffects(side, triggeredLineEffects(board, expanded.triggered));
    if (state !== match || match.finished) return total;
    await showClear(side, clearSet, expanded.triggered);
    if (state !== match || match.finished) return total;
    clearBoardCells(board, clearSet);

    const createdIds = [];
    for (const creation of creations) {
      const existing = board[creation.pos.r][creation.pos.c];
      if (!existing) continue;
      existing.special = creation.special;
      existing.power = null;
      if (creation.special === 'prism') existing.type = randomGemType();
      createdIds.push(existing.id);
    }

    const movement = collapseBoard(board);
    renderBoard(side);
    await animateFalls(side, movement);
    if (state !== match || match.finished) return total;
    await pulseCreatedSpecials(side, createdIds);
    await delay(ANIM.cascadePause);
    cascade += 1;
  }

  if (state !== match || !state || state.finished) return total;
  if (ownsRewards) finalizeCascadeRewards(side, rewards);
  await ensurePlayableForSide(side);
  return total;
}

async function resolveDirectSpecialSwap(side, a, b) {
  const match = state;
  const board = boardData(side);
  const plan = buildDirectSpecialPlan(board, a, b);
  const rewards = createCascadeRewards();
  const rawGained = Math.round(90 + plan.clearSet.size * 14 + plan.triggered.size * 35);
  const origin = rewardOrigin([a, b]);

  if (plan.crownCount) activateCrownBoost(side, plan.crownCount, origin);
  const crownMultiplier = crownMultiplierFor(side);
  const gained = rawGained * crownMultiplier;
  if (plan.crownCount) {
    const unit = state.format === 'turns'
      ? `${Math.ceil(crownBoostFor(side))} jog.`
      : formatSeconds(crownBoostFor(side));
    plan.label = `👑 Coroa: x${crownMultiplier} por ${unit}`;
  }
  setScore(side, scoreFor(side) + gained);

  const moneyBonus = Math.round((plan.cashCount || 0) * DIRECT_CASH_BONUS * 100) / 100;
  if (moneyBonus) addBonusMoney(side, moneyBonus);
  rewards.clockCount += plan.clockCount || 0;
  rewards.devilCount += plan.devilCount || 0;

  if (side === 'player') $('comboLabel').textContent = plan.label;
  collectCascadeFeedback(side, rewards, gained, moneyBonus, origin);
  const stateNode = $(side === 'player' ? 'playerMoveState' : 'rivalMoveState');
  if (stateNode) stateNode.textContent = plan.label;
  renderHud();
  void playMatchSound(side, 2);

  const usedBomb = [...plan.triggered].some((value) => {
    const pos = parseKey(value);
    return board[pos.r]?.[pos.c]?.special === 'bomb';
  });
  if (usedBomb) void playBombSound(side);

  await showLineEffects(side, triggeredLineEffects(board, plan.triggered));
  await showClear(side, plan.clearSet, plan.triggered);
  if (state !== match || match.finished) return;
  clearBoardCells(board, plan.clearSet);
  const movement = collapseBoard(board);
  renderBoard(side);
  await animateFalls(side, movement);
  await delay(ANIM.cascadePause);
  if (state !== match || match.finished) return;
  await resolveMatches(side, [], rewards);
  if (state !== match || match.finished) return;
  finalizeCascadeRewards(side, rewards);
}

async function performSwap(side, a, b, { automated = false } = {}) {
  if (!state || state.finished || busy[side] || !isAdjacent(a, b)) return false;
  if (!automated && !canHumanInteract(side)) return false;
  if (state.format === 'race' && timeFor(side) <= 0) return false;
  if (state.format === 'turns' && (state.turnTimeLeft <= 0 || state.turnEnding)) return false;
  const match = state;

  busy[side] = true;
  selected[side] = null;
  updatePanelStates();
  renderBoard(side);

  const board = boardData(side);
  const beforeA = board[a.r][a.c];
  const beforeB = board[b.r][b.c];
  const directSpecial = isDirectSpecialCombo(beforeA, beforeB);
  const valid = directSpecial || hasMatchAfterSwap(board, a, b);
  await animateSwap(side, a, b, { invalid: !valid });
  if (state !== match || match.finished) return false;

  if (!valid) {
    if (side === 'player') $('comboLabel').textContent = 'Essa troca não forma combinação.';
    busy[side] = false;
    renderHud();
    return false;
  }

  swap(board, a, b);
  renderBoard(side);
  if (directSpecial) await resolveDirectSpecialSwap(side, a, b);
  else await resolveMatches(side, [b, a]);
  if (state !== match || match.finished) return false;

  busy[side] = false;
  renderHud();
  renderBoard(side);
  await consumeTurnMove(side);
  if (state?.opponentType === 'online' && side === 'player' && state.format === 'race') {
    await commitOnlinePlayerIfNeeded('player');
  }
  return true;
}

function evaluateBotMove(board, move) {
  const test = cloneBoard(board);
  const aCell = test[move.a.r][move.a.c];
  const bCell = test[move.b.r][move.b.c];
  if (isDirectSpecialCombo(aCell, bCell)) {
    swap(test, move.a, move.b);
    return 500 + buildDirectSpecialPlan(test, move.a, move.b).clearSet.size * 20;
  }
  swap(test, move.a, move.b);
  const result = findMatches(test);
  const creations = buildSpecialCreations(test, result, [move.b, move.a]);
  return scoreGroups(result.groups, 1) + creations.reduce((sum, c) => sum + SPECIAL_PRIORITY[c.special] * 100, 0);
}

async function botMoveOnce(token) {
  if (!state || state.finished || state.opponentType !== 'bot' || busy.rival || token !== botTurnToken) return false;
  if (state.format === 'race' && state.rivalTime <= 0) return false;
  if (state.format === 'turns' && (state.currentSide !== 'rival' || state.turnTimeLeft <= 0 || state.turnEnding)) return false;

  busy.rival = true;
  renderHud();
  const profile = BOT_PROFILES[state.botProfile] || BOT_PROFILES.jade;
  const moves = allValidMoves(state.rivalBoard);
  if (!moves.length) {
    await ensurePlayableForSide('rival');
    busy.rival = false;
    return false;
  }
  const scored = moves.map((move) => ({ move, immediate: evaluateBotMove(state.rivalBoard, move) })).sort((a, b) => b.immediate - a.immediate);
  const pool = scored.slice(0, Math.min(profile.pool, scored.length));
  const pick = pool[Math.floor(Math.random() * pool.length)].move;

  $('rivalMoveState').textContent = 'Escolheu';
  $('rivalMoveState').className = 'move-state playing';
  getCellElement('rival', pick.a)?.classList.add('bot-target');
  getCellElement('rival', pick.b)?.classList.add('bot-target');
  await delay(randomBetween(300, 560));
  if (!state || state.finished || token !== botTurnToken) { busy.rival = false; return false; }

  busy.rival = false;
  return performSwap('rival', pick.a, pick.b, { automated: true });
}

function scheduleBotRace() {
  clearTimeout(botTimerId);
  if (!state || state.finished || state.opponentType !== 'bot' || state.format !== 'race' || state.rivalTime <= 0) return;
  const token = ++botTurnToken;
  const profile = BOT_PROFILES[state.botProfile] || BOT_PROFILES.jade;
  botTimerId = setTimeout(async () => {
    if (!state || token !== botTurnToken) return;
    await botMoveOnce(token);
    if (!state || state.finished || token !== botTurnToken) return;
    botTimerId = setTimeout(scheduleBotRace, randomBetween(...profile.between));
  }, randomBetween(...profile.think));
}

async function runBotTurn() {
  if (!state || state.finished || state.opponentType !== 'bot' || state.format !== 'turns' || state.currentSide !== 'rival') return;
  const token = ++botTurnToken;
  const profile = BOT_PROFILES[state.botProfile] || BOT_PROFILES.jade;
  while (state && !state.finished && state.currentSide === 'rival' && state.movesLeft > 0 && token === botTurnToken) {
    await delay(randomBetween(...profile.think));
    if (!state || state.finished || token !== botTurnToken) return;
    await botMoveOnce(token);
    if (!state || state.finished || token !== botTurnToken) return;
    await delay(randomBetween(...profile.between));
  }
}

async function consumeTurnMove(side) {
  if (!state || state.finished || state.format !== 'turns' || state.currentSide !== side) return;
  consumeCrownMove(side);
  state.movesLeft = Math.max(0, state.movesLeft - 1);
  renderHud();

  if (state.opponentType === 'online' && side === 'player' && state.movesLeft > 0) {
    await setOnlineTurnState({
      currentSeat: onlineSeat,
      currentRound: state.currentRound,
      movesLeft: state.movesLeft,
      turnTimeLeft: state.turnTimeLeft,
    });
    return;
  }

  if (state.movesLeft > 0) return;
  await endTurn(side);
}

async function endTurn(side, { timeout = false } = {}) {
  if (!state || state.finished || state.format !== 'turns' || state.currentSide !== side || state.turnEnding) return;
  state.turnEnding = true;

  if (timeout) {
    state.movesLeft = 0;
    const stateNode = $(side === 'player' ? 'playerMoveState' : 'rivalMoveState');
    if (stateNode) stateNode.textContent = 'Tempo acabou';
    if (side === 'player') $('comboLabel').textContent = '⏱️ Tempo do turno acabou.';
  }

  if (state.opponentType === 'online' && side === 'player') {
    await delay(timeout ? 100 : 260);
    let nextRound = state.currentRound;
    const nextSeat = 1 - onlineSeat;
    if (onlineSeat === 1) nextRound += 1;
    if (nextRound > state.rounds) {
      await setOnlineTurnState({
        currentSeat: onlineSeat,
        currentRound: state.currentRound,
        movesLeft: 0,
        turnTimeLeft: 0,
        status: 'finished',
      });
      state.turnEnding = false;
      finishGame();
      return;
    }
    state.currentRound = nextRound;
    state.currentSide = 'rival';
    state.movesLeft = state.movesPerTurn;
    resetTurnClock('rival');
    await setOnlineTurnState({
      currentSeat: nextSeat,
      currentRound: nextRound,
      movesLeft: state.movesPerTurn,
      turnTimeLeft: state.turnTimeLeft,
    });
    selected.player = null;
    selected.rival = null;
    state.turnEnding = false;
    renderAllBoards();
    return;
  }

  if (state.opponentType === 'online' && side === 'rival') {
    state.turnEnding = false;
    return;
  }

  await delay(timeout ? 120 : 300);
  if (!state || state.finished) return;

  if (side === 'player') {
    if (state.opponentType === 'solo') {
      state.currentRound += 1;
      if (state.currentRound > state.rounds) {
        state.turnEnding = false;
        finishGame();
        return;
      }
      state.currentSide = 'player';
      state.movesLeft = state.movesPerTurn;
    } else {
      state.currentSide = 'rival';
      state.movesLeft = state.movesPerTurn;
    }
  } else {
    state.currentRound += 1;
    if (state.currentRound > state.rounds) {
      state.turnEnding = false;
      finishGame();
      return;
    }
    state.currentSide = 'player';
    state.movesLeft = state.movesPerTurn;
  }

  resetTurnClock(state.currentSide);
  selected.player = null;
  selected.rival = null;
  state.turnEnding = false;
  renderAllBoards();
  if (state.opponentType === 'bot' && state.currentSide === 'rival') void runBotTurn();
}

function decrementCrownBoost(side, dt) {
  if (state?.format === 'turns') return;
  const before = crownBoostFor(side);
  if (before <= 0) return;
  setCrownBoost(side, Math.max(0, before - dt));
}

function tickTurnMode() {
  if (!state || state.finished || state.format !== 'turns') return;
  const now = performance.now();
  const last = Number(state.lastTickAt || now);
  const dt = Math.max(0, (now - last) / 1000);
  state.lastTickAt = now;

  const side = state.currentSide;
  const remoteWaiting = state.opponentType === 'online' && side === 'rival';
  if (!remoteWaiting && !busy[side] && !state.turnEnding) {
    const activeDt = consumeClockFreeze(side, dt);
    if (activeDt > 0) state.turnTimeLeft = Math.max(0, state.turnTimeLeft - activeDt);
  }

  renderHud();
  if (state.opponentType === 'online' && side === 'player') queueOnlinePlayerCommit();

  if (!remoteWaiting && state.turnTimeLeft <= 0 && !busy[side] && !state.turnEnding) {
    void endTurn(side, { timeout: true });
  }
}

function tickRace() {
  if (!state || state.finished || state.format !== 'race') return;
  const now = performance.now();
  const dt = Math.max(0, (now - state.lastTickAt) / 1000);
  state.lastTickAt = now;

  if (state.playerTime > 0) {
    const activeDt = consumeClockFreeze('player', dt);
    if (activeDt > 0) state.playerTime = Math.max(0, state.playerTime - activeDt);
  }
  if (state.opponentType !== 'solo' && state.rivalTime > 0) {
    const activeDt = consumeClockFreeze('rival', dt);
    if (activeDt > 0) state.rivalTime = Math.max(0, state.rivalTime - activeDt);
  }
  if (state.playerTime > 0) decrementCrownBoost('player', dt);
  if (state.opponentType !== 'solo' && state.rivalTime > 0) decrementCrownBoost('rival', dt);

  if (state.opponentType === 'online') {
    queueOnlinePlayerCommit();
    const localDone = state.playerTime <= 0 && !busy.player;
    if (localDone && !state.onlineDonePublished) {
      state.onlineDonePublished = true;
      void commitOnlinePlayerIfNeeded('player');
    }
    renderHud();
    if (localDone && state.rivalDone) {
      const ref = onlineRoomRef();
      if (ref) void fbUpdateDoc(ref, { 'match.status': 'finished', updatedAt: Date.now() }).catch(console.error);
      finishGame();
    }
    return;
  }

  renderHud();
  const done = state.opponentType === 'solo'
    ? state.playerTime <= 0 && !busy.player
    : state.playerTime <= 0 && state.rivalTime <= 0 && !busy.player && !busy.rival;
  if (done) finishGame();
}

function stopTimers() {
  clearInterval(timerId);
  clearTimeout(botTimerId);
  timerId = null;
  botTimerId = null;
  botTurnToken += 1;
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function onlineRoomRef() {
  return onlineRoomId ? fbDoc(db, 'buracoGames', `jewels-${onlineRoomId}`) : null;
}

function currentOnlineConfig() {
  return {
    format: $('formatSelect').value || 'race',
    duration: Number($('durationSelect').value || 60),
    rounds: Number($('roundsSelect').value || 3),
    movesPerTurn: Number($('movesSelect').value || 3),
    pointValue: Number($('pointValueSelect').value || DEFAULT_POINT_VALUE),
  };
}

function currentOnlineNames() {
  return [
    ($('onlineName0')?.value || 'Jogador 1').trim().slice(0, 18) || 'Jogador 1',
    ($('onlineName1')?.value || 'Jogador 2').trim().slice(0, 18) || 'Jogador 2',
  ];
}

function roomShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('game', onlineRoomId || '');
  url.searchParams.delete('seat');
  return url.toString();
}

function setOnlineMessage(text, tone = '') {
  const node = $('onlineLobbyMessage');
  if (!node) return;
  node.textContent = text;
  node.className = `online-lobby-message${tone ? ` ${tone}` : ''}`;
}

function applyOnlineLobbyToMenu(lobby) {
  if (!lobby) return;
  onlineSyncingMenu = true;
  try {
    const config = lobby.config || {};
    if (config.format) $('formatSelect').value = config.format;
    if (config.duration) $('durationSelect').value = String(config.duration);
    if (config.rounds) $('roundsSelect').value = String(config.rounds);
    if (config.movesPerTurn) $('movesSelect').value = String(config.movesPerTurn);
    if (config.pointValue != null) $('pointValueSelect').value = String(config.pointValue);
    const names = lobby.names || ['Jogador 1', 'Jogador 2'];
    if (document.activeElement !== $('onlineName0')) $('onlineName0').value = names[0] || 'Jogador 1';
    if (document.activeElement !== $('onlineName1')) $('onlineName1').value = names[1] || 'Jogador 2';
    const ready = lobby.ready || [false, false];
    for (let i = 0; i < 2; i++) {
      const chip = $(`onlineReady${i}`);
      if (chip) {
        chip.textContent = ready[i] ? 'pronto' : 'aguardando';
        chip.classList.toggle('ready', !!ready[i]);
      }
    }
    const startText = $('startBtn')?.querySelector('span');
    if (startText && $('opponentSelect').value === 'online') {
      startText.textContent = Number.isInteger(onlineSeat) && ready[onlineSeat] ? 'CANCELAR PRONTO' : 'FICAR PRONTO';
    }
  } finally {
    onlineSyncingMenu = false;
  }
}

async function pushOnlineLobby({ resetReady = false } = {}) {
  const ref = onlineRoomRef();
  if (!ref || onlineSyncingMenu) return;
  const ready = resetReady ? [false, false] : [...(onlineLobby?.ready || [false, false])];
  const lobby = {
    names: currentOnlineNames(),
    ready,
    config: currentOnlineConfig(),
    updatedAt: Date.now(),
  };
  try {
    await fbSetDoc(ref, { lobby, updatedAt: Date.now() }, { merge: true });
  } catch (error) {
    console.error('[Online] Falha ao atualizar lobby:', error);
    setOnlineMessage('Não consegui sincronizar a sala no Firebase.', 'error');
  }
}

function queueOnlineLobbyPush({ resetReady = true } = {}) {
  if ($('opponentSelect').value !== 'online' || !onlineRoomId || onlineSyncingMenu) return;
  clearTimeout(onlineCommitTimer);
  onlineCommitTimer = setTimeout(() => pushOnlineLobby({ resetReady }), 180);
}

function plainBoard(board) {
  return board.map((row) => row.map((cell) => ({
    id: Number(cell.id),
    type: Number(cell.type),
    special: cell.special || null,
    power: cell.power || null,
  })));
}

function restoreBoard(board) {
  if (!Array.isArray(board) || board.length !== SIZE) return createBoard();
  let maxId = nextCellId;
  const restored = board.map((row) => row.map((cell) => {
    const normalized = {
      id: Number(cell?.id) || nextCellId++,
      type: Number.isInteger(cell?.type) ? cell.type : randomGemType(),
      special: cell?.special || null,
      power: cell?.power || null,
    };
    maxId = Math.max(maxId, normalized.id + 1);
    return normalized;
  }));
  nextCellId = Math.max(nextCellId, maxId);
  return restored;
}

async function startOnlineMatchAsHost() {
  const ref = onlineRoomRef();
  if (!ref || onlineSeat !== 0 || !onlineLobby?.ready?.[0] || !onlineLobby?.ready?.[1]) return;
  const config = onlineLobby.config || currentOnlineConfig();
  const match = {
    status: 'playing',
    matchId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    format: config.format || 'race',
    duration: Number(config.duration || 60),
    rounds: Number(config.rounds || 3),
    movesPerTurn: Number(config.movesPerTurn || 3),
    pointValue: Number(config.pointValue || DEFAULT_POINT_VALUE),
    currentSeat: 0,
    currentRound: 1,
    movesLeft: Number(config.movesPerTurn || 3),
    turnTimeLeft: TURN_SECONDS,
    startedAt: Date.now(),
    players: {
      0: { board: plainBoard(createBoard()), score: 0, bonusMoney: 0, time: Number(config.duration || 60), crownBoost: 0, crownLevel: 0, clockFreeze: 0, turnPenalty: 0, seq: 0, done: false },
      1: { board: plainBoard(createBoard()), score: 0, bonusMoney: 0, time: Number(config.duration || 60), crownBoost: 0, crownLevel: 0, clockFreeze: 0, turnPenalty: 0, seq: 0, done: false },
    },
  };
  await fbUpdateDoc(ref, { match, updatedAt: Date.now() });
}

function startOnlineGameFromSnapshot(match, lobby) {
  resetPowerAudio();
  if (!Number.isInteger(onlineSeat) || !match?.players) return;
  stopTimers();
  const mine = match.players[String(onlineSeat)] || match.players[onlineSeat];
  const theirs = match.players[String(1 - onlineSeat)] || match.players[1 - onlineSeat];
  if (!mine || !theirs) return;
  const names = lobby?.names || ['Jogador 1', 'Jogador 2'];
  state = {
    opponentType: 'online',
    botProfile: 'jade',
    onlineSeat,
    onlineNames: names,
    onlineMatchId: match.matchId,
    onlineSeq: Number(mine.seq || 0),
    powerAudioEvents: { ...mine.powerAudioEvents },
    rivalPowerAudioEvents: { ...theirs.powerAudioEvents },
    onlineDonePublished: !!mine.done,
    rivalDone: !!theirs.done,
    format: match.format || 'race',
    duration: Number(match.duration || 60),
    playerTime: Number(mine.time ?? match.duration ?? 60),
    rivalTime: Number(theirs.time ?? match.duration ?? 60),
    playerScore: Number(mine.score || 0),
    rivalScore: Number(theirs.score || 0),
    playerBonusMoney: Number(mine.bonusMoney || 0),
    rivalBonusMoney: Number(theirs.bonusMoney || 0),
    playerCrownBoost: Number(mine.crownBoost || 0),
    rivalCrownBoost: Number(theirs.crownBoost || 0),
    playerCrownLevel: Number(mine.crownLevel || 0),
    rivalCrownLevel: Number(theirs.crownLevel || 0),
    playerClockFreeze: Number(mine.clockFreeze || 0),
    rivalClockFreeze: Number(theirs.clockFreeze || 0),
    playerTurnPenalty: Number(mine.turnPenalty || 0),
    rivalTurnPenalty: Number(theirs.turnPenalty || 0),
    turnTimeLeft: Number(match.turnTimeLeft ?? TURN_SECONDS),
    turnEnding: false,
    board: restoreBoard(mine.board),
    rivalBoard: restoreBoard(theirs.board),
    rounds: Number(match.rounds || 3),
    currentRound: Number(match.currentRound || 1),
    movesPerTurn: Number(match.movesPerTurn || 3),
    movesLeft: Number(match.movesLeft || match.movesPerTurn || 3),
    currentSide: Number(match.currentSeat || 0) === onlineSeat ? 'player' : 'rival',
    pointValue: Number(match.pointValue || DEFAULT_POINT_VALUE),
    finished: false,
    startedAt: Number(match.startedAt || Date.now()),
    lastTickAt: performance.now(),
    external: false,
    context: null,
  };
  onlineMatchStarted = true;
  resetScoreHud(state.playerScore, state.rivalScore);
  busy = { player: false, rival: false };
  selected = { player: null, rival: null };
  pointerGesture = { player: null, rival: null };
  $('comboLabel').textContent = state.format === 'race'
    ? 'Partida online: cada jogador controla seu próprio tabuleiro.'
    : (state.currentSide === 'player' ? `Sua vez: ${state.movesLeft} movimentos.` : `Vez de ${sideName('rival')}.`);
  showScreen('gameScreen');
  renderDeveloperMode();
  renderAllBoards();
  if (state.format === 'race') timerId = setInterval(tickRace, 100);
  else { state.lastTickAt = performance.now(); timerId = setInterval(tickTurnMode, 100); }
}

function syncOnlineGameFromSnapshot(match, lobby) {
  if (!state || state.opponentType !== 'online' || state.onlineMatchId !== match?.matchId) {
    startOnlineGameFromSnapshot(match, lobby);
    return;
  }
  const mine = match.players?.[String(onlineSeat)] || match.players?.[onlineSeat];
  const theirs = match.players?.[String(1 - onlineSeat)] || match.players?.[1 - onlineSeat];
  if (!mine || !theirs) return;
  const boardKey = (board) => board.flat().map((cell) => cell
    ? `${cell.id}:${cell.type}:${cell.special || ''}:${cell.power || ''}` : '_').join('|');
  const previousPlayerBoard = busy.player ? null : boardKey(state.board);
  const previousRivalBoard = boardKey(state.rivalBoard);
  state.onlineNames = lobby?.names || state.onlineNames;
  syncPowerAudio(theirs.powerAudioEvents);
  const previousRival = {
    score: state.rivalScore, money: bonusMoneyFor('rival'), time: onlineHudRivalTime ?? state.rivalTime,
    crown: crownLevelFor('rival'), moves: state.movesLeft,
    side: state.currentSide, round: state.currentRound,
  };

  // O tabuleiro local é autoritativo enquanto a animação/jogada está acontecendo.
  if (!busy.player && Number(mine.seq || 0) > Number(state.onlineSeq || 0)) {
    state.board = restoreBoard(mine.board);
    state.playerScore = Number(mine.score || 0);
    state.playerBonusMoney = Number(mine.bonusMoney ?? state.playerBonusMoney ?? 0);
    state.playerTime = Number(mine.time ?? state.playerTime);
    state.playerCrownBoost = Number(mine.crownBoost ?? state.playerCrownBoost ?? 0);
    state.playerCrownLevel = Number(mine.crownLevel ?? state.playerCrownLevel ?? 0);
    state.playerClockFreeze = Number(mine.clockFreeze ?? state.playerClockFreeze ?? 0);
    state.playerTurnPenalty = Number(mine.turnPenalty ?? state.playerTurnPenalty ?? 0);
    state.onlineSeq = Number(mine.seq || 0);
  }
  if (state.format === 'race') {
    const serverMineTime = Number(mine.time ?? state.playerTime);
    if (serverMineTime < state.playerTime - 0.75) {
      const correction = serverMineTime - state.playerTime;
      state.playerTime = serverMineTime;
      // The protocol sends time, not an attack event; do not invent an attacker.
      queueHudReward('player', 'time', correction, { label: `−${formatSeconds(-correction)}` });
    }
  }
  const previousPenalty = turnPenaltyFor('player');
  state.playerTurnPenalty = Math.max(state.playerTurnPenalty || 0, Number(mine.turnPenalty || 0));
  if (turnPenaltyFor('player') > previousPenalty) {
    showDevilAttack('rival', turnPenaltyFor('player') - previousPenalty);
  }

  state.rivalBoard = restoreBoard(theirs.board);
  state.rivalScore = Number(theirs.score || 0);
  state.rivalBonusMoney = Number(theirs.bonusMoney ?? state.rivalBonusMoney ?? 0);
  state.rivalCrownBoost = Number(theirs.crownBoost ?? state.rivalCrownBoost ?? 0);
  state.rivalCrownLevel = Number(theirs.crownLevel ?? state.rivalCrownLevel ?? 0);
  state.rivalClockFreeze = Number(theirs.clockFreeze ?? state.rivalClockFreeze ?? 0);
  state.rivalTurnPenalty = Number(theirs.turnPenalty ?? state.rivalTurnPenalty ?? 0);
  state.rivalDone = !!theirs.done;
  if (state.format === 'race') state.rivalTime = Number(theirs.time ?? state.rivalTime);
  onlineHudRivalTime = state.rivalTime;
  state.currentRound = Number(match.currentRound || state.currentRound);
  state.movesLeft = Number(match.movesLeft ?? state.movesLeft);
  if (state.format === 'turns') state.turnTimeLeft = Number(match.turnTimeLeft ?? state.turnTimeLeft ?? TURN_SECONDS);
  state.currentSide = Number(match.currentSeat || 0) === onlineSeat ? 'player' : 'rival';
  showPlayFeedback('rival', {
    points: Math.max(0, state.rivalScore - previousRival.score),
    money: Math.max(0, bonusMoneyFor('rival') - previousRival.money),
    seconds: state.format === 'race' ? Math.max(0, state.rivalTime - previousRival.time) : 0,
    moves: state.format === 'turns' && previousRival.side === 'rival' && state.currentSide === 'rival'
      && previousRival.round === state.currentRound ? Math.max(0, state.movesLeft - previousRival.moves) : 0,
  });
  if (crownLevelFor('rival') > previousRival.crown) {
    queueHudReward('rival', 'crown', crownLevelFor('rival') - previousRival.crown);
  }
  renderHud();
  if (!busy.player && previousPlayerBoard !== boardKey(state.board)) renderBoard('player');
  if (previousRivalBoard !== boardKey(state.rivalBoard)) renderBoard('rival');

  if (match.status === 'finished' && !state.finished) finishGame();
}

async function commitOnlinePlayerIfNeeded(side = 'player', extra = {}) {
  if (!state || state.opponentType !== 'online' || side !== 'player' || !Number.isInteger(onlineSeat)) return;
  const ref = onlineRoomRef();
  if (!ref) return;
  state.onlineSeq = Number(state.onlineSeq || 0) + 1;
  const payload = {
    board: plainBoard(state.board),
    score: state.playerScore,
    bonusMoney: Math.round(bonusMoneyFor('player') * 100) / 100,
    time: Math.max(0, state.playerTime),
    crownBoost: Math.max(0, state.playerCrownBoost || 0),
    crownLevel: Math.max(0, state.playerCrownLevel || 0),
    clockFreeze: Math.max(0, state.playerClockFreeze || 0),
    turnPenalty: Math.max(0, state.playerTurnPenalty || 0),
    seq: state.onlineSeq,
    powerAudioEvents: { ...state.powerAudioEvents },
    done: state.format === 'race' ? (state.playerTime <= 0 && !busy.player) : false,
  };
  const updates = {
    [`match.players.${onlineSeat}`]: payload,
    updatedAt: Date.now(),
    ...extra,
  };
  if (state.format === 'turns' && state.currentSide === 'player') {
    updates['match.turnTimeLeft'] = Math.max(0, Number(state.turnTimeLeft) || 0);
  }
  try {
    await fbUpdateDoc(ref, updates);
  } catch (error) {
    console.error('[Online] Falha ao publicar jogada:', error);
  }
}

function queueOnlinePlayerCommit() {
  if (!state || state.opponentType !== 'online') return;
  const now = performance.now();
  if (now - onlineLastPublishedAt < 700) return;
  onlineLastPublishedAt = now;
  void commitOnlinePlayerIfNeeded('player');
}

async function setOnlineTurnState({ currentSeat, currentRound, movesLeft, turnTimeLeft = state?.turnTimeLeft ?? TURN_SECONDS, status = 'playing' }) {
  const ref = onlineRoomRef();
  if (!ref) return;
  await commitOnlinePlayerIfNeeded('player', {
    'match.currentSeat': currentSeat,
    'match.currentRound': currentRound,
    'match.movesLeft': movesLeft,
    'match.turnTimeLeft': Math.max(0, Number(turnTimeLeft) || 0),
    'match.status': status,
  });
}

async function toggleOnlineReady() {
  if (!(await ensureFirebase())) {
    setOnlineMessage('Firebase indisponível nesta conexão.', 'error');
    return;
  }
  if (!Number.isInteger(onlineSeat)) {
    setOnlineMessage('Escolha “Jogador 1” ou “Jogador 2” antes de ficar pronto.', 'error');
    return;
  }
  if (!onlineRoomId) await connectOnlineRoom();
  const ref = onlineRoomRef();
  if (!ref) {
    setOnlineMessage('A sala ainda não está pronta. Tente novamente em um instante.', 'error');
    return;
  }
  const ready = [...(onlineLobby?.ready || [false, false])];
  ready[onlineSeat] = !ready[onlineSeat];
  const lobby = {
    names: currentOnlineNames(),
    ready,
    config: currentOnlineConfig(),
    updatedAt: Date.now(),
  };
  await fbSetDoc(ref, { lobby, updatedAt: Date.now() }, { merge: true });
  try { await fbUpdateDoc(ref, { 'match.status': 'idle', updatedAt: Date.now() }); } catch {}
  if (ready.every(Boolean) && onlineSeat === 0) setTimeout(() => startOnlineMatchAsHost().catch(console.error), 120);
}

async function connectOnlineRoom() {
  const firebaseReady = await ensureFirebase();
  if (!firebaseReady) {
    setOnlineMessage('Não consegui carregar o Firebase. O restante do jogo continua funcionando offline.', 'error');
    return;
  }
  if (!onlineRoomId) {
    const params = new URLSearchParams(window.location.search);
    onlineRoomId = (params.get('game') || makeRoomId()).toUpperCase();
    const url = new URL(window.location.href);
    url.searchParams.set('game', onlineRoomId);
    window.history.replaceState({}, '', url);
  }
  $('onlineRoomCode').textContent = onlineRoomId;
  const savedSeat = localStorage.getItem(`jewels_seat_${onlineRoomId}`);
  if (!Number.isInteger(onlineSeat) && (savedSeat === '0' || savedSeat === '1')) {
    onlineSeat = Number(savedSeat);
    $('onlineSeatSelect').value = savedSeat;
  }
  if (onlineUnsubscribe) return;
  const ref = onlineRoomRef();
  const existing = await fbGetDoc(ref);
  if (!existing.exists()) {
    await fbSetDoc(ref, {
      lobby: {
        names: currentOnlineNames(),
        ready: [false, false],
        config: currentOnlineConfig(),
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    });
  }
  onlineUnsubscribe = fbOnSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    onlineLobby = data.lobby || onlineLobby;
    applyOnlineLobbyToMenu(onlineLobby);
    const ready = onlineLobby?.ready || [false, false];
    if (ready.every(Boolean)) setOnlineMessage('Os dois estão prontos. Iniciando…', 'ok');
    else if (ready.some(Boolean)) setOnlineMessage('Um jogador está pronto. Aguardando o outro…');
    else setOnlineMessage('Compartilhe o link e escolha quem é cada jogador.');
    if (data.match?.status === 'playing' || data.match?.status === 'finished') {
      syncOnlineGameFromSnapshot(data.match, onlineLobby);
    }
    if (onlineSeat === 0 && ready.every(Boolean) && (!data.match || data.match.status === 'idle')) {
      void startOnlineMatchAsHost().catch(console.error);
    }
  }, (error) => {
    console.error('[Online] Firestore:', error);
    setOnlineMessage('Erro ao conectar no Firebase. Confira a conexão/regras da sala.', 'error');
  });
}

function parseOpponent(value) {
  if (value === 'solo') return { opponentType: 'solo', botProfile: 'jade' };
  if (value === 'online') return { opponentType: 'online', botProfile: 'jade' };
  const [, profile] = String(value).split(':');
  return { opponentType: 'bot', botProfile: BOT_PROFILES[profile] ? profile : 'jade' };
}

function startGame(config = {}) {
  resetPowerAudio();
  stopTimers();
  const opponent = config.opponentType
    ? { opponentType: config.opponentType, botProfile: config.botProfile || 'jade' }
    : parseOpponent($('opponentSelect').value);
  if (opponent.opponentType === 'online') return;
  const format = config.format || $('formatSelect').value || 'race';
  const duration = Math.max(15, Math.min(180, Number(config.duration || $('durationSelect').value || 60)));
  const rounds = Math.max(1, Math.min(9, Number(config.rounds || $('roundsSelect').value || 3)));
  const movesPerTurn = Math.max(1, Math.min(9, Number(config.movesPerTurn || $('movesSelect').value || 3)));
  const pointValueConfig = Math.max(0, Number(config.pointValue ?? $('pointValueSelect').value ?? DEFAULT_POINT_VALUE));

  state = {
    opponentType: opponent.opponentType,
    botProfile: opponent.botProfile,
    format,
    duration,
    playerTime: duration,
    rivalTime: duration,
    playerScore: 0,
    rivalScore: 0,
    playerBonusMoney: 0,
    rivalBonusMoney: 0,
    playerCrownBoost: 0,
    rivalCrownBoost: 0,
    playerCrownLevel: 0,
    rivalCrownLevel: 0,
    playerClockFreeze: 0,
    rivalClockFreeze: 0,
    playerTurnPenalty: 0,
    rivalTurnPenalty: 0,
    turnTimeLeft: TURN_SECONDS,
    turnEnding: false,
    board: createBoard(),
    rivalBoard: createBoard(),
    rounds,
    currentRound: 1,
    movesPerTurn,
    movesLeft: movesPerTurn,
    currentSide: 'player',
    pointValue: pointValueConfig,
    finished: false,
    startedAt: Date.now(),
    lastTickAt: performance.now(),
    external: !!config.external,
    context: config.context || null,
  };

  resetScoreHud(0, 0);
  busy = { player: false, rival: false };
  selected = { player: null, rival: null };
  pointerGesture = { player: null, rival: null };
  $('comboLabel').textContent = format === 'race'
    ? 'Arraste uma joia. Jogadas melhores podem render segundos extras.'
    : `Rodada 1: ${movesPerTurn} movimentos e ${TURN_SECONDS}s para jogar.`;
  showScreen('gameScreen');
  renderDeveloperMode();
  renderAllBoards();

  if (format === 'race') {
    timerId = setInterval(tickRace, 100);
    if (state.opponentType === 'bot') scheduleBotRace();
  } else {
    state.lastTickAt = performance.now();
    timerId = setInterval(tickTurnMode, 100);
  }
}

function resultPayload() {
  const hasRival = state.opponentType !== 'solo';
  const won = !hasRival ? true : state.playerScore > state.rivalScore;
  const draw = hasRival && state.playerScore === state.rivalScore;
  const scoreDifference = hasRival ? state.playerScore - state.rivalScore : state.playerScore;
  const playerMoneyTotal = Math.round((scoreMoney(state.playerScore) + bonusMoneyFor('player')) * 100) / 100;
  const rivalMoneyTotal = Math.round((scoreMoney(state.rivalScore) + bonusMoneyFor('rival')) * 100) / 100;
  const moneyDelta = Math.round(((hasRival ? (playerMoneyTotal - rivalMoneyTotal) : playerMoneyTotal)) * 100) / 100;
  return {
    game: 'jewels',
    opponentType: state.opponentType,
    botProfile: state.botProfile,
    format: state.format,
    duration: state.duration,
    rounds: state.rounds,
    movesPerTurn: state.movesPerTurn,
    playerScore: state.playerScore,
    opponentScore: state.rivalScore,
    scoreDifference,
    pointValue: pointValue(),
    playerMoney: playerMoneyTotal,
    opponentMoney: rivalMoneyTotal,
    playerBonusMoney: Math.round(bonusMoneyFor('player') * 100) / 100,
    opponentBonusMoney: Math.round(bonusMoneyFor('rival') * 100) / 100,
    won,
    draw,
    moneyDelta,
    virtualDelta: moneyDelta,
    context: state.context,
  };
}

function finishGame() {
  if (!state || state.finished) return;
  state.finished = true;
  stopTimers();
  const result = resultPayload();
  const hasRival = state.opponentType !== 'solo';
  const rivalName = sideName('rival');

  $('finalPlayer').textContent = result.playerScore.toLocaleString('pt-BR');
  $('finalRival').textContent = result.opponentScore.toLocaleString('pt-BR');
  $('finalRivalName').textContent = rivalName.toUpperCase();
  $('finalRivalWrap').style.display = hasRival ? '' : 'none';

  if (!hasRival) {
    $('resultIcon').textContent = '💎';
    $('resultTitle').textContent = state.format === 'race' ? 'TEMPO ESGOTADO' : 'DESAFIO CONCLUÍDO';
    $('resultText').textContent = `Você marcou ${result.playerScore.toLocaleString('pt-BR')} pontos.`;
  } else if (result.draw) {
    $('resultIcon').textContent = '🤝';
    $('resultTitle').textContent = 'EMPATE';
    $('resultText').textContent = 'A diferença de pontos ficou zerada.';
  } else if (result.won) {
    $('resultIcon').textContent = '🏆';
    $('resultTitle').textContent = 'VOCÊ VENCEU';
    $('resultText').textContent = `Você terminou com mais pontos que ${rivalName}.`;
  } else {
    $('resultIcon').textContent = '💸';
    $('resultTitle').textContent = `${rivalName.toUpperCase()} VENCEU`;
    $('resultText').textContent = `${rivalName} terminou com mais pontos.`;
  }

  const rateText = `100 pts = ${formatMoney(result.pointValue * 100)}`;
  $('resultDetail').textContent = state.format === 'race'
    ? `Tempo inicial: ${state.duration}s por jogador · ${rateText}.`
    : `${state.rounds} rodadas · ${state.movesPerTurn} movimentos por lado · ${rateText}.`;

  const money = $('moneyResult');
  money.className = 'money-result';
  if (!hasRival) {
    money.textContent = `${result.playerScore.toLocaleString('pt-BR')} pts · ${rateText} · total ${formatMoney(result.playerMoney)}${result.playerBonusMoney ? ` · bônus ${formatMoney(result.playerBonusMoney)}` : ''}`;
    money.classList.add('win');
  } else if (result.draw) {
    money.textContent = `Diferença 0 pts · acerto ${formatMoney(0)}`;
  } else {
    const absDiff = Math.abs(result.scoreDifference);
    money.textContent = `${absDiff.toLocaleString('pt-BR')} pts de diferença · ${rateText} · ${result.moneyDelta > 0 ? '+' : '-'}${formatMoney(Math.abs(result.moneyDelta))}${(result.playerBonusMoney || result.opponentBonusMoney) ? ` · bônus diretos você ${formatMoney(result.playerBonusMoney)} / rival ${formatMoney(result.opponentBonusMoney)}` : ''}`;
    money.classList.add(result.moneyDelta > 0 ? 'win' : 'lose');
  }

  const revealResult = () => {
    resetScoreHud(state.playerScore, state.rivalScore);
    showScreen('resultScreen');
  };
  const rewardWait = remainingHudRewardTime();
  if (rewardWait > 0) hudLater(revealResult, rewardWait + 30);
  else revealResult();
  if (state.opponentType === 'online' && onlineRoomId && fbUpdateDoc) {
    const ref = onlineRoomRef();
    if (ref) {
      void fbUpdateDoc(ref, {
        'lobby.ready': [false, false],
        'match.status': 'finished',
        updatedAt: Date.now(),
      }).catch((error) => console.error('[Online] Falha ao encerrar partida:', error));
    }
  }
  if (resolveExternalChallenge) {
    const resolve = resolveExternalChallenge;
    resolveExternalChallenge = null;
    resolve(result);
  }
  window.dispatchEvent(new CustomEvent('jewels:result', { detail: result }));
}

function adjacentFromSwipe(start, dx, dy) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return null;
  if (Math.abs(dx) > Math.abs(dy)) return { r: start.r, c: start.c + (dx > 0 ? 1 : -1) };
  return { r: start.r + (dy > 0 ? 1 : -1), c: start.c };
}

function bindBoardInput(side) {
  const root = boardRoot(side);
  root.addEventListener('pointerdown', (event) => {
    const gem = event.target.closest('.gem');
    if (!gem || !canHumanInteract(side)) return;
    pointerGesture[side] = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pos: { r: Number(gem.dataset.r), c: Number(gem.dataset.c) },
    };
    root.setPointerCapture?.(event.pointerId);
  });

  root.addEventListener('pointerup', (event) => {
    const gesture = pointerGesture[side];
    if (!gesture || gesture.pointerId !== event.pointerId || !state || state.finished) return;
    pointerGesture[side] = null;
    const target = adjacentFromSwipe(gesture.pos, event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (!target || !inBounds(target)) return;
    suppressNextClick[side] = true;
    setTimeout(() => { suppressNextClick[side] = false; }, 0);
    void performSwap(side, gesture.pos, target);
  });

  root.addEventListener('pointercancel', () => { pointerGesture[side] = null; });

  root.addEventListener('click', (event) => {
    if (suppressNextClick[side]) return;
    const gem = event.target.closest('.gem');
    if (!gem || !canHumanInteract(side)) return;
    const pos = { r: Number(gem.dataset.r), c: Number(gem.dataset.c) };
    if (!selected[side]) {
      selected[side] = pos;
      renderBoard(side);
      return;
    }
    if (samePos(selected[side], pos)) {
      selected[side] = null;
      renderBoard(side);
      return;
    }
    if (!isAdjacent(selected[side], pos)) {
      selected[side] = pos;
      renderBoard(side);
      return;
    }
    void performSwap(side, selected[side], pos);
  });
}

function syncMenu(pushOnline = true) {
  const format = $('formatSelect').value;
  const opponentValue = $('opponentSelect').value;
  const isSolo = opponentValue === 'solo';
  const isOnline = opponentValue === 'online';
  const race = format === 'race';

  $('durationWrap').hidden = !race;
  $('roundsWrap').hidden = race;
  $('movesWrap').hidden = race;
  $('onlineLobby').hidden = !isOnline;

  document.querySelectorAll('.mode-option').forEach((button) => {
    const active = button.dataset.format === format;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  $('durationLabel').textContent = isSolo ? 'Tempo da partida' : 'Tempo por jogador';
  $('configCaption').textContent = race
    ? (isSolo ? 'Defina quanto tempo você terá para pontuar.' : 'Cada lado começa com seu próprio relógio.')
    : `Cada turno tem ${TURN_SECONDS}s para usar os movimentos. Animações e cascatas não gastam o relógio.`;

  $('formatHelp').innerHTML = race
    ? '<strong>Bônus:</strong> criar ↔/↕ +4s · 💣 +6s · ◆ Arco-íris +5s · cascata x2 +1s · x3+ +2s. ⏳ congela 10s. 😈 tira 2s do rival. Sem teto de tempo extra.'
    : '<strong>Turnos:</strong> 90s por vez. Criar ↔/↕, 💣 ou ◆ Arco-íris dá +1 movimento. Extras acumulam sem limite. ⏳ congela 10s. 😈 tira 5s do próximo turno rival (mín. 30s).';

  if (isSolo) {
    $('opponentHelp').textContent = 'Treino individual: busque a maior pontuação sem rival.';
  } else if (isOnline) {
    $('opponentHelp').textContent = 'Cada pessoa joga no próprio aparelho. Sala e partida são sincronizadas pelo Firebase.';
    const startText = $('startBtn')?.querySelector('span');
    if (startText) startText.textContent = Number.isInteger(onlineSeat) && onlineLobby?.ready?.[onlineSeat] ? 'CANCELAR PRONTO' : 'FICAR PRONTO';
    void connectOnlineRoom();
  } else {
    const profile = opponentValue.split(':')[1] || 'jade';
    const descriptions = {
      luna: 'Luna joga de forma mais casual e costuma deixar oportunidades passar.',
      jade: 'Jade equilibra boas jogadas com um ritmo natural.',
      ruby: 'Ruby procura combinações mais fortes e pune mais erros.',
    };
    $('opponentHelp').textContent = descriptions[profile] || '';
    const startText = $('startBtn')?.querySelector('span');
    if (startText) startText.textContent = 'JOGAR';
  }

  const rival = $('opponentSelect').selectedOptions[0]?.textContent || 'Rival';
  const pointRate = $('pointValueSelect').selectedOptions[0]?.textContent || '100 pontos = R$ 1,00';
  const configText = race
    ? `${$('durationSelect').value}s${isSolo ? '' : ' cada'}`
    : `${$('roundsSelect').value} rodadas · ${$('movesSelect').value} mov./turno · ${TURN_SECONDS}s/turno`;
  $('menuSummary').innerHTML = `<strong>${rival}</strong> · ${race ? 'Corrida' : 'Turnos'} · ${configText} · ${pointRate}`;

  if (isOnline && pushOnline && onlineRoomId && !onlineSyncingMenu) queueOnlineLobbyPush({ resetReady: true });
}

function devSelection() {
  const side = $('devSide')?.value || 'player';
  const r = Number($('devRow')?.value ?? 0);
  const c = Number($('devCol')?.value ?? 0);
  const type = Number($('devType')?.value ?? 0);
  return { side, r, c, type };
}

function setDevStatus(message, tone = '') {
  const node = $('devStatus');
  if (!node) return;
  node.textContent = message;
  node.className = `dev-status${tone ? ` ${tone}` : ''}`;
}

function placeDevPreset(preset) {
  if (!developerMode) return;
  if (!state) {
    setDevStatus('Inicie uma partida primeiro.', 'error');
    return;
  }
  const { side, r, c, type } = devSelection();
  const board = boardData(side);
  const cell = board?.[r]?.[c];
  if (!cell) {
    setDevStatus('Casa inválida.', 'error');
    return;
  }

  cell.type = type;
  cell.special = null;
  cell.power = null;

  if (preset === 'row' || preset === 'col' || preset === 'bomb' || preset === 'prism') {
    cell.special = preset;
  } else if (Object.hasOwn(POWER_TYPE, preset)) {
    cell.power = preset;
    cell.type = POWER_TYPE[preset];
    if ($('devType')) $('devType').value = String(cell.type);
  }

  renderBoard(side);
  const base = GEM_TYPES[cell.type]?.icon || '◆';
  const label = preset === 'normal'
    ? `${base} normal`
    : preset === 'row' ? `${base} ↔`
      : preset === 'col' ? `${base} ↕`
        : preset === 'bomb' ? `${base} 💣`
          : preset === 'prism' ? '◆ arco-íris multicolorido'
            : `${base} ${POWER_MARK[preset] || ''} ${POWER_NAME[preset] || preset}`;
  setDevStatus(`${side === 'player' ? 'Você' : 'Rival'} · linha ${r + 1}, coluna ${c + 1}: ${label}`, 'ok');
  if ($('comboLabel')) $('comboLabel').textContent = `DEV: ${label} criada. Agora você pode executar a peça.`;
}

function clearDevPiece() {
  if (!developerMode || !state) return;
  const { side, r, c } = devSelection();
  const cell = boardData(side)?.[r]?.[c];
  if (!cell) return;
  cell.special = null;
  cell.power = null;
  renderBoard(side);
  setDevStatus(`Linha ${r + 1}, coluna ${c + 1}: especial/poder removido.`, 'ok');
}

async function executeDevPiece() {
  if (!developerMode || !state) return;
  const match = state;
  const { side, r, c } = devSelection();
  const board = boardData(side);
  const cell = board?.[r]?.[c];
  if (!cell) return setDevStatus('Casa inválida.', 'error');
  if (!cell.special && !cell.power) return setDevStatus('Essa casa não tem especial nem poder para executar.', 'error');
  if (busy[side]) return setDevStatus('Espere a animação atual terminar.', 'error');

  busy[side] = true;
  selected[side] = null;
  const triggerSet = new Set([key(r, c)]);
  const expanded = expandAllEffects(board, triggerSet);
  const rewards = createCascadeRewards();
  const rawGained = Math.round(50 + expanded.clearSet.size * 14 + expanded.triggered.size * 32 + expanded.powerTriggered.size * 20);
  const origin = rewardOrigin([{ r, c }]);

  if (expanded.crownCount) activateCrownBoost(side, expanded.crownCount, origin);
  const multiplier = crownMultiplierFor(side);
  const gained = Math.round(rawGained * multiplier);
  setScore(side, scoreFor(side) + gained);

  const moneyBonus = Math.round((expanded.cashCount || 0) * DIRECT_CASH_BONUS * 100) / 100;
  if (moneyBonus) addBonusMoney(side, moneyBonus);
  rewards.clockCount += expanded.clockCount || 0;
  rewards.devilCount += expanded.devilCount || 0;

  const label = cell.special === 'row' ? '↔ Seta'
    : cell.special === 'col' ? '↕ Seta'
      : cell.special === 'bomb' ? '💣 Bomba'
        : cell.special === 'prism' ? '◆ Arco-íris'
          : cell.power === 'crown' ? `👑 x${multiplier}`
            : cell.power === 'devil' ? (state.format === 'race' ? '😈 -2s rival' : '😈 -5s próximo turno rival')
              : cell.power === 'cash' ? `💸 +${formatMoney(moneyBonus)}`
                : cell.power === 'clock' ? `⏳ congela ${CLOCK_FREEZE_SECONDS}s`
                  : 'Peça especial';

  if (side === 'player') $('comboLabel').textContent = `DEV: ${label}`;
  collectCascadeFeedback(side, rewards, gained, moneyBonus, origin);
  renderHud();
  void playMatchSound(side, 2);

  const usedBomb = [...expanded.triggered].some((value) => {
    const pos = parseKey(value);
    return board[pos.r]?.[pos.c]?.special === 'bomb';
  });
  if (usedBomb) void playBombSound(side);

  await showLineEffects(side, triggeredLineEffects(board, expanded.triggered));
  await showClear(side, expanded.clearSet, expanded.triggered);
  if (state !== match || match.finished) return;
  clearBoardCells(board, expanded.clearSet);
  const movement = collapseBoard(board);
  renderBoard(side);
  await animateFalls(side, movement);
  if (state !== match || match.finished) return;
  await resolveMatches(side, [], rewards);
  if (state !== match || match.finished) return;
  finalizeCascadeRewards(side, rewards);

  busy[side] = false;
  renderBoard(side);
  renderHud();
  setDevStatus(`Executado em ${side === 'player' ? 'você' : 'rival'} · linha ${r + 1}, coluna ${c + 1}.`, 'ok');
}

bindBoardInput('player');
bindBoardInput('rival');
document.addEventListener('pointerdown', unlockMatchAudio, { once: true, passive: true });
document.querySelectorAll('.mode-option').forEach((button) => {
  button.addEventListener('click', () => {
    $('formatSelect').value = button.dataset.format;
    syncMenu();
  });
});
['opponentSelect', 'durationSelect', 'roundsSelect', 'movesSelect', 'pointValueSelect'].forEach((id) => {
  $(id).addEventListener('change', () => syncMenu(true));
});

$('onlineSeatSelect').addEventListener('change', () => {
  const value = $('onlineSeatSelect').value;
  onlineSeat = value === '0' || value === '1' ? Number(value) : null;
  if (onlineRoomId) {
    if (Number.isInteger(onlineSeat)) localStorage.setItem(`jewels_seat_${onlineRoomId}`, String(onlineSeat));
    else localStorage.removeItem(`jewels_seat_${onlineRoomId}`);
  }
  const url = new URL(window.location.href);
  if (Number.isInteger(onlineSeat)) url.searchParams.set('seat', String(onlineSeat));
  else url.searchParams.delete('seat');
  window.history.replaceState({}, '', url);
  applyOnlineLobbyToMenu(onlineLobby || { ready: [false, false], names: currentOnlineNames(), config: currentOnlineConfig() });
});

['onlineName0', 'onlineName1'].forEach((id) => {
  $(id).addEventListener('input', () => queueOnlineLobbyPush({ resetReady: false }));
});

$('copyRoomBtn').addEventListener('click', async () => {
  if (!onlineRoomId) await connectOnlineRoom();
  const url = roomShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    setOnlineMessage('Link copiado. Envie para o outro jogador.', 'ok');
  } catch {
    window.prompt('Copie o link da sala:', url);
  }
});

const initialParams = new URLSearchParams(window.location.search);
if (initialParams.get('game')) {
  onlineRoomId = initialParams.get('game').toUpperCase();
  const seatParam = initialParams.get('seat');
  if (seatParam === '0' || seatParam === '1') onlineSeat = Number(seatParam);
  $('opponentSelect').value = 'online';
  if (Number.isInteger(onlineSeat)) $('onlineSeatSelect').value = String(onlineSeat);
}
populateDevSelectors();
renderDeveloperMode();
document.querySelectorAll('[data-dev-preset]').forEach((button) => {
  button.addEventListener('click', () => placeDevPreset(button.dataset.devPreset));
});
$('devExecuteBtn')?.addEventListener('click', () => { void executeDevPiece(); });
$('devClearBtn')?.addEventListener('click', clearDevPiece);

syncMenu(false);

$('startBtn').addEventListener('click', () => {
  if ($('opponentSelect').value === 'online') void toggleOnlineReady();
  else startGame();
});
$('quitBtn').addEventListener('click', () => {
  stopTimers();
  const wasOnline = state?.opponentType === 'online';
  state = null;
  onlineMatchStarted = false;
  showScreen('menuScreen');
  if (wasOnline && onlineRoomId) void pushOnlineLobby({ resetReady: true });
});
$('againBtn').addEventListener('click', () => {
  if (!state) return showScreen('menuScreen');
  if (state.opponentType === 'online') {
    state = null;
    onlineMatchStarted = false;
    showScreen('menuScreen');
    void pushOnlineLobby({ resetReady: true });
    return;
  }
  startGame({
    opponentType: state.opponentType,
    botProfile: state.botProfile,
    format: state.format,
    duration: state.duration,
    rounds: state.rounds,
    movesPerTurn: state.movesPerTurn,
    pointValue: state.pointValue,
  });
});
$('menuBtn').addEventListener('click', () => {
  const wasOnline = state?.opponentType === 'online';
  state = null;
  onlineMatchStarted = false;
  showScreen('menuScreen');
  if (wasOnline && onlineRoomId) void pushOnlineLobby({ resetReady: true });
});

window.JewelsGame = Object.freeze({
  startChallenge(options = {}) {
    if (resolveExternalChallenge) return Promise.reject(new Error('Já existe um desafio de joias em andamento.'));
    return new Promise((resolve) => {
      resolveExternalChallenge = resolve;
      const opponentType = options.opponentType === 'solo' ? 'solo' : 'bot';
      startGame({
        opponentType,
        botProfile: BOT_PROFILES[options.botProfile] ? options.botProfile : 'jade',
        format: options.format === 'turns' ? 'turns' : 'race',
        duration: Math.max(15, Math.min(180, Number(options.duration) || 60)),
        rounds: Math.max(1, Math.min(9, Number(options.rounds) || 3)),
        movesPerTurn: Math.max(1, Math.min(9, Number(options.movesPerTurn) || 3)),
        pointValue: Math.max(0, Number(options.pointValue) || DEFAULT_POINT_VALUE),
        context: options.context || null,
        external: true,
      });
    });
  },
  getState() {
    if (!state) return null;
    return {
      opponentType: state.opponentType,
      botProfile: state.botProfile,
      format: state.format,
      playerTime: state.playerTime,
      opponentTime: state.rivalTime,
      playerScore: state.playerScore,
      opponentScore: state.rivalScore,
      round: state.currentRound,
      rounds: state.rounds,
      movesLeft: state.movesLeft,
      turnTimeLeft: state.turnTimeLeft,
      currentSide: state.currentSide,
      pointValue: state.pointValue,
      finished: state.finished,
    };
  },
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((error) => console.warn('[SW] Falha ao registrar:', error));
  });
}
