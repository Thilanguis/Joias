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
const POWER_NAME = Object.freeze({ crown: 'Coroa', devil: 'Diabinho', cash: 'Grana extra', clock: 'Tempo extra' });
const POWER_TYPE = Object.freeze({ crown: 2, devil: 3, cash: 1, clock: 4 });
const SCORE_BY_SIZE = { 3: 30, 4: 70, 5: 120 };
const BOT_PROFILES = Object.freeze({
  luna: { name: 'Luna', pool: 8, think: [1450, 2500], between: [850, 1450] },
  jade: { name: 'Jade', pool: 4, think: [900, 1650], between: [650, 1100] },
  ruby: { name: 'Ruby', pool: 2, think: [600, 1150], between: [480, 820] },
});
const SPECIAL_MARK = Object.freeze({ row: '↔', col: '↕', bomb: '💣', prism: '🌈' });
const SPECIAL_NAME = Object.freeze({ row: 'Seta horizontal', col: 'Seta vertical', bomb: 'Bomba 3×3', prism: 'Arco-íris' });
const SPECIAL_PRIORITY = Object.freeze({ row: 1, col: 1, bomb: 2, prism: 3 });
const ANIM = Object.freeze({ swap: 230, invalid: 320, match: 275, cascadePause: 95 });
const MATCH_AUDIO_SRC = './audio/gem-match.mp3';
const BOMB_AUDIO_SRC = './audio/bomb.mp3';
const MATCH_AUDIO_RATE = Object.freeze([1, 1.07, 1.14, 1.21, 1.26]);
const DEFAULT_POINT_VALUE = 0.01; // 100 pontos = R$ 1,00
const CROWN_BOOST_SECONDS = 8;
const CROWN_STACK_SECONDS = 10;
const DIRECT_CASH_BONUS = 0.35;
const CLOCK_BONUS_SECONDS = 2;


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
let scoreDisplay = { player: 0, rival: 0 };
let scoreTarget = { player: 0, rival: 0 };
let scoreAnimationFrame = { player: null, rival: null };
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
}

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
  const context = ensureBombAudio();
  if (!context) return;
  if (context.state === 'suspended') {
    try { await context.resume(); } catch { return; }
  }
  const buffer = bombAudioBuffer || await bombAudioLoadPromise;
  if (!buffer || context.state !== 'running') return;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = side === 'rival' ? 0.23 : 0.38;
  source.connect(gain);
  gain.connect(context.destination);
  source.start();
}

async function playMatchSound(side, cascade = 1) {
  const context = ensureMatchAudio();
  if (!context) return;
  if (context.state === 'suspended') {
    try { await context.resume(); } catch { return; }
  }
  const buffer = matchAudioBuffer || await matchAudioLoadPromise;
  if (!buffer || context.state !== 'running') return;

  const source = context.createBufferSource();
  const gain = context.createGain();
  const rateIndex = Math.min(MATCH_AUDIO_RATE.length - 1, Math.max(0, cascade - 1));
  source.buffer = buffer;
  source.playbackRate.value = MATCH_AUDIO_RATE[rateIndex];
  gain.gain.value = side === 'rival' ? 0.34 : 0.52;
  source.connect(gain);
  gain.connect(context.destination);
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
      if (cell.power === 'devil') {
        const before = new Set(clearSet);
        addColor(clearSet, board, matchType(cell));
        enqueueNew(before);
      }
    }
  }

  protectedKeys.forEach((value) => clearSet.delete(value));
  return { clearSet, triggered, powerTriggered, crownCount, cashCount, clockCount };
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

function crownMultiplierFor(side) {
  if (!state) return 1;
  const value = Number(side === 'player' ? state.playerCrownLevel : state.rivalCrownLevel) || 0;
  return value >= 2 ? 4 : value >= 1 ? 2 : 1;
}

function setCrownBoostLevel(side, level) {
  if (!state) return;
  const value = Math.max(0, Math.min(2, Number(level) || 0));
  if (side === 'player') state.playerCrownLevel = value;
  else state.rivalCrownLevel = value;
}

function setCrownBoost(side, seconds) {
  if (!state) return;
  const max = crownMultiplierFor(side) >= 4 ? CROWN_STACK_SECONDS : CROWN_BOOST_SECONDS;
  const value = Math.max(0, Math.min(max, Number(seconds) || 0));
  if (side === 'player') state.playerCrownBoost = value;
  else state.rivalCrownBoost = value;
  if (value <= 0.02) setCrownBoostLevel(side, 0);
}

function activateCrownBoost(side, count = 1) {
  if (!state) return;
  let remaining = Math.max(1, Number(count) || 1);
  while (remaining > 0) {
    const currentMultiplier = crownMultiplierFor(side);
    const currentSeconds = crownBoostFor(side);
    if (currentMultiplier >= 2 && currentSeconds > 0.02) {
      setCrownBoostLevel(side, 2);
      if (currentSeconds < CROWN_STACK_SECONDS) setCrownBoost(side, CROWN_STACK_SECONDS);
    } else {
      setCrownBoostLevel(side, 1);
      setCrownBoost(side, CROWN_BOOST_SECONDS);
    }
    remaining -= 1;
  }
  renderCrownBoost(side);
}

function renderCrownBoost(side) {
  if (!state) return;
  const root = $(side === 'player' ? 'playerCrownBoost' : 'rivalCrownBoost');
  const timeNode = $(side === 'player' ? 'playerCrownBoostTime' : 'rivalCrownBoostTime');
  const fill = $(side === 'player' ? 'playerCrownBoostFill' : 'rivalCrownBoostFill');
  if (!root || !timeNode || !fill) return;
  const seconds = crownBoostFor(side);
  root.hidden = seconds <= 0.02;
  if (root.hidden) return;
  const multiplier = crownMultiplierFor(side);
  const max = multiplier >= 4 ? CROWN_STACK_SECONDS : CROWN_BOOST_SECONDS;
  timeNode.textContent = `x${multiplier} · ${formatSeconds(seconds)}`;
  fill.style.width = `${Math.max(0, Math.min(100, (seconds / max) * 100))}%`;
}


function updateMoneyLeadDisplay(playerShown = scoreDisplay.player, rivalShown = scoreDisplay.rival) {
  if (!state) return;
  const node = $('moneyLead');
  const rate = $('moneyRate');
  if (!node) return;
  if (rate) rate.textContent = `100 pts = ${formatMoney(pointValue() * 100)}`;
  node.classList.remove('leader-player', 'leader-rival', 'leader-tie', 'solo-money');

  if (state.opponentType === 'solo') {
    node.classList.add('solo-money');
    node.innerHTML = `<small>VALOR GERADO</small><strong>${formatMoney(totalMoneyFor('player', playerShown))}</strong>`;
    return;
  }

  const playerMoney = totalMoneyFor('player', playerShown);
  const rivalMoney = totalMoneyFor('rival', rivalShown);
  const diff = Math.round((playerMoney - rivalMoney) * 100) / 100;
  const value = Math.abs(diff);
  if (diff === 0) {
    node.classList.add('leader-tie');
    node.innerHTML = `<small>EMPATE</small><strong>${formatMoney(0)}</strong>`;
    return;
  }
  const leader = diff > 0 ? sideName('player') : sideName('rival');
  node.classList.add(diff > 0 ? 'leader-player' : 'leader-rival');
  node.innerHTML = `<small>${leader.toUpperCase()} NA FRENTE</small><strong>+${formatMoney(value)}</strong>`;
}

function renderScoreTag(side) {
  const node = $(side === 'player' ? 'playerScoreTag' : 'rivalScoreTag');
  if (!node) return;
  const crown = crownBoostFor(side);
  node.hidden = crown <= 0.02;
  if (!node.hidden) node.textContent = `👑 x${crownMultiplierFor(side)} por ${formatSeconds(crown)}`;
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
  const duration = Math.min(900, Math.max(380, 430 + Math.abs(delta) * 0.7));
  node.classList.remove('score-bump');
  void node.offsetWidth;
  if (delta > 0) node.classList.add('score-bump');

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
  for (const side of ['player', 'rival']) {
    if (scoreAnimationFrame[side]) cancelAnimationFrame(scoreAnimationFrame[side]);
    scoreAnimationFrame[side] = null;
  }
  scoreDisplay = { player: Number(player) || 0, rival: Number(rival) || 0 };
  scoreTarget = { ...scoreDisplay };
  updateMoneyLeadDisplay();
}

function showScoreFloat(side, points) {
  if (!points) return;
  const node = $(side === 'player' ? 'playerScoreFloat' : 'rivalScoreFloat');
  if (!node) return;
  node.textContent = `+${Math.round(points).toLocaleString('pt-BR')}`;
  node.classList.remove('show');
  void node.offsetWidth;
  node.classList.add('show');
}

function pulseTarget(node) {
  if (!node) return;
  node.classList.remove('target-pulse');
  void node.offsetWidth;
  node.classList.add('target-pulse');
}

function flyRewardToTarget(side, text, targetId, kind = '') {
  const layer = $('flightLayer');
  const target = $(targetId);
  const board = boardRoot(side);
  if (!layer || !target || !board || !text) return;
  const originRect = board.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const token = document.createElement('div');
  token.className = `fly-token ${kind}`.trim();
  token.textContent = text;
  const startX = originRect.left + originRect.width / 2;
  const startY = originRect.top + originRect.height * 0.28;
  layer.appendChild(token);
  token.style.left = `${startX}px`;
  token.style.top = `${startY}px`;
  const dx = (targetRect.left + targetRect.width / 2) - startX;
  const dy = (targetRect.top + targetRect.height / 2) - startY;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const done = () => { pulseTarget(target); token.remove(); };
  if (reduced || !token.animate) {
    setTimeout(done, 520);
    return;
  }
  token.animate([
    { transform: 'translate(-50%, -50%) scale(.72)', opacity: 0, offset: 0 },
    { transform: 'translate(-50%, -50%) scale(1.12)', opacity: 1, offset: .12 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: .46 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: .58 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.72)`, opacity: .16, offset: 1 },
  ], { duration: 1750, easing: 'cubic-bezier(.2,.75,.2,1)', fill: 'forwards' }).finished.then(done).catch(done);
}

function renderTimeBars() {
  if (!state) return;
  const race = state.format === 'race';
  [['player', 'playerTimeBar', 'playerTimeFill'], ['rival', 'rivalTimeBar', 'rivalTimeFill']].forEach(([side, barId, fillId]) => {
    const bar = $(barId); const fill = $(fillId);
    if (!bar || !fill) return;
    const visible = race && (side === 'player' || state.opponentType !== 'solo');
    bar.hidden = !visible;
    if (!visible) return;
    const base = Math.max(1, Number(state.duration) || 60);
    const current = Math.max(0, timeFor(side));
    const basePct = Math.max(0, Math.min(100, (current / base) * 100));
    const overflowPct = Math.max(0, Math.min(55, ((current - base) / base) * 100));
    fill.style.width = `${basePct}%`;
    bar.style.setProperty('--overflow-width', `${overflowPct}%`);
    bar.classList.toggle('has-overflow', overflowPct > 0.05);
  });
}

function updateLastEvent(side, { title = '', points = 0, seconds = 0, money = 0, boosted = false } = {}) {
  const node = $(side === 'player' ? 'playerLastEvent' : 'rivalLastEvent');
  if (!node) return;
  const parts = [];
  if (title) parts.push(title);
  if (seconds) parts.push(`+${String(seconds).replace('.', ',')}s`);
  if (money) parts.push(`+${formatMoney(money)}`);
  if (boosted) parts.push('👑 boost ativo');
  node.textContent = parts.join(' · ') || 'Combinação concluída.';
  node.classList.remove('pulse');
  void node.offsetWidth;
  node.classList.add('pulse');
}

function showPlayFeedback(side, { title = '', points = 0, seconds = 0, money = 0, boosted = false } = {}) {
  const node = $(side === 'player' ? 'playerFeedback' : 'rivalFeedback');
  if (!node) return;
  if (points) showScoreFloat(side, points);
  if (seconds) flyRewardToTarget(side, `+${String(seconds).replace('.', ',')}s`, side === 'player' ? 'playerClock' : 'rivalClock', 'time');
  if (money) flyRewardToTarget(side, `+${formatMoney(money)}`, 'moneyLead', 'money');
  if (boosted) flyRewardToTarget(side, `👑 x${crownMultiplierFor(side)}`, side === 'player' ? 'playerCrownBoostTime' : 'rivalCrownBoostTime', 'boost');

  const chips = [];
  if (seconds) chips.push(`<b>⏳ +${String(seconds).replace('.', ',')}s</b>`);
  if (money) chips.push(`<u>💸 +${formatMoney(money)}</u>`);
  if (boosted) chips.push(`<i>👑 x${crownMultiplierFor(side)}</i>`);
  if (!chips.length) {
    node.classList.remove('show');
    node.innerHTML = '';
  } else {
    node.innerHTML = `${title ? `<em>${title}</em>` : ''}${chips.join('')}`;
    node.classList.remove('show');
    void node.offsetWidth;
    node.classList.add('show');
  }
  updateLastEvent(side, { title, points, seconds, money, boosted });
}

function canHumanInteract(side) {
  if (!state || state.finished || busy[side]) return false;
  if (side === 'rival') return false;
  if (state.format === 'race') return timeFor(side) > 0;
  return state.currentSide === side && state.movesLeft > 0;
}

function renderHud() {
  if (!state) return;
  animateScoreHud('player', state.playerScore);
  animateScoreHud('rival', state.rivalScore);
  updateMoneyLeadDisplay();
  renderCrownBoost('player');
  renderCrownBoost('rival');
  renderScoreTag('player');
  renderScoreTag('rival');
  renderTimeBars();

  const hasRival = state.opponentType !== 'solo';
  $('rivalHud').style.visibility = hasRival ? 'visible' : 'hidden';
  $('rivalPanel').hidden = !hasRival;
  $('versusMark').hidden = !hasRival;
  $('playerNameHud').textContent = sideName('player').toUpperCase();
  $('playerBoardTitle').textContent = sideName('player').toUpperCase();
  $('rivalNameHud').textContent = sideName('rival').toUpperCase();
  $('rivalBoardTitle').textContent = sideName('rival').toUpperCase();
  $('rivalBoard').classList.toggle('bot-controlled', state.opponentType === 'bot' || state.opponentType === 'online');

  if (state.format === 'race') {
    $('centerLabel').textContent = state.opponentType === 'solo' ? 'PARTIDA RÁPIDA' : 'CORRIDA';
    $('centerValue').textContent = state.opponentType === 'solo' ? 'TEMPO' : 'AO VIVO';
    $('centerSub').textContent = state.opponentType === 'solo' ? 'faça a maior pontuação' : 'cada um tem seu relógio';
    $('playerClock').hidden = false;
    $('playerClock').textContent = formatSeconds(state.playerTime);
    $('rivalClock').hidden = !hasRival;
    $('rivalClock').textContent = formatSeconds(state.rivalTime);
  } else {
    $('centerLabel').textContent = `RODADA ${Math.min(state.currentRound, state.rounds)}/${state.rounds}`;
    $('centerValue').textContent = state.currentSide === 'player' ? 'VOCÊ' : sideName('rival').toUpperCase();
    $('centerSub').textContent = `${state.movesLeft} mov. restantes`;
    $('playerClock').hidden = false;
    $('rivalClock').hidden = !hasRival;
    $('playerClock').textContent = state.currentSide === 'player' ? `${state.movesLeft} mov.` : 'aguardando';
    $('rivalClock').textContent = state.currentSide === 'rival' ? `${state.movesLeft} mov.` : 'aguardando';
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
    $('playerMoveState').textContent = state.currentSide === 'player' ? (busy.player ? 'Jogando…' : `${state.movesLeft} movimentos`) : 'Aguardando';
    $('playerMoveState').className = `move-state${state.currentSide === 'player' ? busy.player ? ' playing' : '' : ' waiting'}`;
    if (state.opponentType === 'online') {
      $('rivalMoveState').textContent = state.currentSide === 'rival' ? `${state.movesLeft} movimentos` : 'Aguardando';
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
  root.innerHTML = '';
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

    // A cor/forma base nunca some: ela diz com qual família a peça combina.
    // Poderes e especiais são desenhados DENTRO da própria peça, como uma camada visual.
    const face = document.createElement('span');
    face.className = 'gem-face';
    face.textContent = cell.special === 'prism' ? '🌈' : gemMeta.icon;
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
    root.append(button);
  }));
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
    const duration = Math.min(700, 330 + Math.abs(deltaRows) * 48);
    animations.push(el.animate(
      [
        { transform: `translateY(${distance}px)`, opacity: info.isNew ? .08 : 1 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      { duration, easing: 'cubic-bezier(.18,.78,.22,1)', fill: 'both' },
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
    if (!reduced && blast.animate) {
      const frames = effect.special === 'row'
        ? [{ transform: 'scaleX(.08)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1, offset: .25 }, { transform: 'scaleX(1)', opacity: 0 }]
        : [{ transform: 'scaleY(.08)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1, offset: .25 }, { transform: 'scaleY(1)', opacity: 0 }];
      waits.push(blast.animate(frames, { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished.finally(() => blast.remove()));
    } else {
      waits.push(delay(300).then(() => blast.remove()));
    }
  });
  await Promise.allSettled(waits);
}

async function previewSpecialCreations(side, creations) {
  if (!creations?.length) return;
  const root = boardRoot(side);
  if (!root) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
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
      if (!reduced && sourceEl.animate && targetRect) {
        const rect = sourceEl.getBoundingClientRect();
        const dx = (targetRect.left + targetRect.width / 2) - (rect.left + rect.width / 2);
        const dy = (targetRect.top + targetRect.height / 2) - (rect.top + rect.height / 2);
        animations.push(sourceEl.animate([
          { transform: 'translate(0,0) scale(1)', opacity: 1, filter: 'brightness(1)' },
          { transform: `translate(${dx * .65}px, ${dy * .65}px) scale(.72)`, opacity: .9, filter: 'brightness(1.35)' },
          { transform: `translate(${dx}px, ${dy}px) scale(.35)`, opacity: 0, filter: 'brightness(2)' },
        ], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished);
      }
    });
  });

  if (animations.length) await Promise.allSettled(animations);
  else await delay(300);
}

async function showClear(side, clearSet, triggered = new Set()) {
  const root = boardRoot(side);
  for (const value of clearSet) {
    const { r, c } = parseKey(value);
    const el = root?.querySelector(`.gem[data-r="${r}"][data-c="${c}"]`);
    if (!el) continue;
    el.classList.add(triggered.has(value) ? 'special-activated' : 'matched');
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
    return delay(460);
  }).filter(Boolean);
  await Promise.allSettled(promises);
}

function timeBonusFromCreation(creations, cascade, triggeredCount) {
  let bonus = 0;
  for (const creation of creations) {
    if (creation.special === 'row' || creation.special === 'col') bonus += 1;
    else if (creation.special === 'bomb' || creation.special === 'prism') bonus += 2;
  }
  if (cascade > 1) bonus += 1;
  if (triggeredCount > 0) bonus += Math.min(2, triggeredCount);
  return Math.min(4, bonus);
}

function flashTimeBonus(side, seconds) {
  if (!seconds || !state || state.format !== 'race') return;
  const node = $(side === 'player' ? 'playerTimeBonus' : 'rivalTimeBonus');
  if (!node) return;
  node.textContent = `+${seconds}s`;
  node.classList.remove('show');
  void node.offsetWidth;
  node.classList.add('show');
}

function awardTime(side, seconds) {
  if (!state || state.format !== 'race' || seconds <= 0) return;
  const maxTime = state.duration + 30;
  const before = timeFor(side);
  const after = Math.min(maxTime, before + seconds);
  const awarded = Math.max(0, Math.round((after - before) * 10) / 10);
  if (awarded <= 0) return;
  setTime(side, after);
}

function clearBoardCells(board, clearSet) {
  for (const value of clearSet) {
    const { r, c } = parseKey(value);
    board[r][c] = null;
  }
}

async function resolveMatches(side, preferred = []) {
  const board = boardData(side);
  let cascade = 1;
  let total = 0;

  while (state && !state.finished) {
    const result = findMatches(board);
    if (!result.matched.size) break;
    const creations = buildSpecialCreations(board, result, cascade === 1 ? preferred : []);
    const protectedKeys = new Set(creations.map((creation) => key(creation.pos.r, creation.pos.c)));
    const expanded = expandAllEffects(board, result.matched, protectedKeys);
    const clearSet = expanded.clearSet;
    const extraClears = Math.max(0, clearSet.size - Math.max(0, result.matched.size - protectedKeys.size));
    const rawGained = scoreGroups(result.groups, cascade) + extraClears * 12 + creations.length * 40;
    if (expanded.crownCount) activateCrownBoost(side, expanded.crownCount);
    const crownMultiplier = crownMultiplierFor(side);
    const gained = Math.round(rawGained * crownMultiplier);
    total += gained;
    setScore(side, scoreFor(side) + gained);
    const moneyBonus = Math.round((expanded.cashCount || 0) * DIRECT_CASH_BONUS * 100) / 100;
    if (moneyBonus) addBonusMoney(side, moneyBonus);

    let bonusSeconds = state.format === 'race' ? timeBonusFromCreation(creations, cascade, expanded.triggered.size) : 0;
    if (state.format === 'race' && expanded.clockCount) bonusSeconds += expanded.clockCount * CLOCK_BONUS_SECONDS;
    awardTime(side, bonusSeconds);

    const usedDevil = [...expanded.powerTriggered].some((value) => {
      const pos = parseKey(value);
      return board[pos.r]?.[pos.c]?.power === 'devil';
    });
    const usedBomb = [...expanded.triggered].some((value) => {
      const pos = parseKey(value);
      return board[pos.r]?.[pos.c]?.special === 'bomb';
    });
    const feedbackTags = [];
    if (cascade > 1) feedbackTags.push(`🔥 Cascata x${cascade}`);
    if (expanded.crownCount) feedbackTags.push(`👑 Coroa: x${crownMultiplier} por ${crownMultiplier >= 4 ? CROWN_STACK_SECONDS : CROWN_BOOST_SECONDS}s`);
    else if (crownMultiplier > 1) feedbackTags.push(`👑 x${crownMultiplier}`);
    if (usedDevil) feedbackTags.push('😈 Diabinho');
    if (moneyBonus) feedbackTags.push(`💸 +${formatMoney(moneyBonus)}`);
    if (expanded.clockCount) feedbackTags.push(`⏳ +${expanded.clockCount * CLOCK_BONUS_SECONDS}s`);
    if (usedBomb) feedbackTags.push('💥 Bomba');
    else if (creations.some((c) => c.special === 'bomb')) feedbackTags.push('💣 Bomba criada');
    if (creations.some((c) => c.special === 'prism')) feedbackTags.push('🌈 Arco-íris');
    if (creations.some((c) => c.special === 'row' || c.special === 'col')) feedbackTags.push('↔ Seta criada');
    const specialText = feedbackTags.length ? feedbackTags.join(' · ') : 'COMBINAÇÃO';
    if (side === 'player') $('comboLabel').textContent = specialText || 'Combinação concluída.';
    showPlayFeedback(side, { title: specialText, points: gained, seconds: bonusSeconds, money: moneyBonus, boosted: expanded.crownCount > 0 });
    const stateNode = $(side === 'player' ? 'playerMoveState' : 'rivalMoveState');
    if (stateNode) stateNode.textContent = cascade > 1 ? `Cascata x${cascade}` : `+${gained}`;
    renderHud();
    void playMatchSound(side, cascade);
    if (usedBomb) void playBombSound(side);

    if (creations.length) await previewSpecialCreations(side, creations);
    await showLineEffects(side, triggeredLineEffects(board, expanded.triggered));
    await showClear(side, clearSet, expanded.triggered);
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
    await pulseCreatedSpecials(side, createdIds);
    await delay(ANIM.cascadePause);
    cascade++;
  }

  await ensurePlayableForSide(side);
  return total;
}

async function resolveDirectSpecialSwap(side, a, b) {
  const board = boardData(side);
  const plan = buildDirectSpecialPlan(board, a, b);
  const rawGained = Math.round(90 + plan.clearSet.size * 14 + plan.triggered.size * 35);
  if (plan.crownCount) activateCrownBoost(side, plan.crownCount);
  const crownMultiplier = crownMultiplierFor(side);
  const gained = rawGained * crownMultiplier;
  if (plan.crownCount) plan.label = `👑 Coroa: x${crownMultiplier} por ${crownMultiplier >= 4 ? CROWN_STACK_SECONDS : CROWN_BOOST_SECONDS}s`;
  setScore(side, scoreFor(side) + gained);
  const moneyBonus = Math.round((plan.cashCount || 0) * DIRECT_CASH_BONUS * 100) / 100;
  if (moneyBonus) addBonusMoney(side, moneyBonus);
  let bonusSeconds = state.format === 'race' ? plan.timeBonus : 0;
  if (state.format === 'race' && plan.clockCount) bonusSeconds += plan.clockCount * CLOCK_BONUS_SECONDS;
  awardTime(side, bonusSeconds);
  if (side === 'player') $('comboLabel').textContent = plan.label;
  showPlayFeedback(side, { title: plan.label, points: gained, seconds: bonusSeconds, money: moneyBonus, boosted: plan.crownCount > 0 });
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
  clearBoardCells(board, plan.clearSet);
  const movement = collapseBoard(board);
  renderBoard(side);
  await animateFalls(side, movement);
  await delay(ANIM.cascadePause);
  await resolveMatches(side);
}

async function performSwap(side, a, b, { automated = false } = {}) {
  if (!state || state.finished || busy[side] || !isAdjacent(a, b)) return false;
  if (!automated && !canHumanInteract(side)) return false;
  if (state.format === 'race' && timeFor(side) <= 0) return false;

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
  if (state.format === 'turns' && state.currentSide !== 'rival') return false;

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
  state.movesLeft = Math.max(0, state.movesLeft - 1);
  renderHud();

  if (state.opponentType === 'online' && side === 'player') {
    if (state.movesLeft > 0) {
      await setOnlineTurnState({ currentSeat: onlineSeat, currentRound: state.currentRound, movesLeft: state.movesLeft });
      return;
    }
    await delay(320);
    let nextRound = state.currentRound;
    let nextSeat = 1 - onlineSeat;
    if (onlineSeat === 1) nextRound += 1;
    if (nextRound > state.rounds) {
      await setOnlineTurnState({ currentSeat: onlineSeat, currentRound: state.currentRound, movesLeft: 0, status: 'finished' });
      finishGame();
      return;
    }
    state.currentRound = nextRound;
    state.movesLeft = state.movesPerTurn;
    state.currentSide = 'rival';
    await setOnlineTurnState({ currentSeat: nextSeat, currentRound: nextRound, movesLeft: state.movesPerTurn });
    renderAllBoards();
    return;
  }

  if (state.movesLeft > 0) return;
  await delay(380);
  if (!state || state.finished) return;

  if (side === 'player') {
    if (state.opponentType === 'solo') {
      state.currentRound += 1;
      if (state.currentRound > state.rounds) return finishGame();
      state.movesLeft = state.movesPerTurn;
      state.currentSide = 'player';
    } else {
      state.currentSide = 'rival';
      state.movesLeft = state.movesPerTurn;
    }
  } else {
    state.currentRound += 1;
    if (state.currentRound > state.rounds) return finishGame();
    state.currentSide = 'player';
    state.movesLeft = state.movesPerTurn;
  }
  selected.player = null;
  selected.rival = null;
  renderHud();
  renderBoard('player');
  if (state.opponentType !== 'solo') renderBoard('rival');
  if (state.opponentType === 'bot' && state.currentSide === 'rival') void runBotTurn();
}

function decrementCrownBoost(side, dt) {
  const before = crownBoostFor(side);
  if (before <= 0) return;
  const after = Math.max(0, before - dt);
  setCrownBoost(side, after);
  if (after <= 0.02) setCrownBoostLevel(side, 0);
}

function tickTurnBoost() {
  if (!state || state.finished || state.format !== 'turns') return;
  const now = performance.now();
  const last = Number(state.lastBoostTickAt || now);
  const dt = Math.max(0, (now - last) / 1000);
  state.lastBoostTickAt = now;
  if (state.currentSide === 'player') decrementCrownBoost('player', dt);
  else decrementCrownBoost('rival', dt);
  renderCrownBoost('player');
  renderCrownBoost('rival');
  renderScoreTag('player');
  renderScoreTag('rival');
  renderTimeBars();
  if (state.opponentType === 'online' && state.currentSide === 'player') queueOnlinePlayerCommit();
}

function tickRace() {
  if (!state || state.finished || state.format !== 'race') return;
  const now = performance.now();
  const dt = Math.max(0, (now - state.lastTickAt) / 1000);
  state.lastTickAt = now;

  if (state.playerTime > 0) state.playerTime = Math.max(0, state.playerTime - dt);
  if (state.opponentType !== 'solo' && state.rivalTime > 0) state.rivalTime = Math.max(0, state.rivalTime - dt);
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
    startedAt: Date.now(),
    players: {
      0: { board: plainBoard(createBoard()), score: 0, bonusMoney: 0, time: Number(config.duration || 60), crownBoost: 0, crownLevel: 0, seq: 0, done: false },
      1: { board: plainBoard(createBoard()), score: 0, bonusMoney: 0, time: Number(config.duration || 60), crownBoost: 0, crownLevel: 0, seq: 0, done: false },
    },
  };
  await fbUpdateDoc(ref, { match, updatedAt: Date.now() });
}

function startOnlineGameFromSnapshot(match, lobby) {
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
  else { state.lastBoostTickAt = performance.now(); timerId = setInterval(tickTurnBoost, 100); }
}

function syncOnlineGameFromSnapshot(match, lobby) {
  if (!state || state.opponentType !== 'online' || state.onlineMatchId !== match?.matchId) {
    startOnlineGameFromSnapshot(match, lobby);
    return;
  }
  const mine = match.players?.[String(onlineSeat)] || match.players?.[onlineSeat];
  const theirs = match.players?.[String(1 - onlineSeat)] || match.players?.[1 - onlineSeat];
  if (!mine || !theirs) return;
  state.onlineNames = lobby?.names || state.onlineNames;

  // O tabuleiro local é autoritativo enquanto a animação/jogada está acontecendo.
  if (!busy.player && Number(mine.seq || 0) > Number(state.onlineSeq || 0)) {
    state.board = restoreBoard(mine.board);
    state.playerScore = Number(mine.score || 0);
    state.playerBonusMoney = Number(mine.bonusMoney ?? state.playerBonusMoney ?? 0);
    state.playerTime = Number(mine.time ?? state.playerTime);
    state.playerCrownBoost = Number(mine.crownBoost ?? state.playerCrownBoost ?? 0);
    state.playerCrownLevel = Number(mine.crownLevel ?? state.playerCrownLevel ?? 0);
    state.onlineSeq = Number(mine.seq || 0);
  }
  const previousRivalScore = state.rivalScore;
  state.rivalBoard = restoreBoard(theirs.board);
  state.rivalScore = Number(theirs.score || 0);
  state.rivalBonusMoney = Number(theirs.bonusMoney ?? state.rivalBonusMoney ?? 0);
  state.rivalCrownBoost = Number(theirs.crownBoost ?? state.rivalCrownBoost ?? 0);
  state.rivalCrownLevel = Number(theirs.crownLevel ?? state.rivalCrownLevel ?? 0);
  if (state.rivalScore > previousRivalScore) {
    showPlayFeedback('rival', { title: 'JOGADA RIVAL', points: state.rivalScore - previousRivalScore });
  }
  state.rivalDone = !!theirs.done;
  if (state.format === 'race') state.rivalTime = Number(theirs.time ?? state.rivalTime);
  state.currentRound = Number(match.currentRound || state.currentRound);
  state.movesLeft = Number(match.movesLeft ?? state.movesLeft);
  state.currentSide = Number(match.currentSeat || 0) === onlineSeat ? 'player' : 'rival';
  renderAllBoards();

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
    seq: state.onlineSeq,
    done: state.format === 'race' ? (state.playerTime <= 0 && !busy.player) : false,
  };
  const updates = {
    [`match.players.${onlineSeat}`]: payload,
    updatedAt: Date.now(),
    ...extra,
  };
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

async function setOnlineTurnState({ currentSeat, currentRound, movesLeft, status = 'playing' }) {
  const ref = onlineRoomRef();
  if (!ref) return;
  await commitOnlinePlayerIfNeeded('player', {
    'match.currentSeat': currentSeat,
    'match.currentRound': currentRound,
    'match.movesLeft': movesLeft,
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
    : `Rodada 1: você tem ${movesPerTurn} movimentos.`;
  showScreen('gameScreen');
  renderDeveloperMode();
  renderAllBoards();

  if (format === 'race') {
    timerId = setInterval(tickRace, 100);
    if (state.opponentType === 'bot') scheduleBotRace();
  } else {
    state.lastBoostTickAt = performance.now();
    timerId = setInterval(tickTurnBoost, 100);
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
    ? `Tempo inicial: ${state.duration}s por jogador · bônus limitado a +30s no relógio · ${rateText}.`
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

  showScreen('resultScreen');
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
    : (isSolo ? 'Escolha quantas rodadas e movimentos terá o desafio.' : 'Defina rodadas e movimentos antes de passar a vez.');

  $('formatHelp').innerHTML = race
    ? '<strong>Bônus:</strong> ↔/↕ +1s · 💣/🌈 +2s · cascata +1s · especiais ativados até +2s (máx. +4s). 👑 ativa pontos x2 por 8s; se pegar outra ativa, vira x4 por 10s.'
    : '<strong>Troca de vez:</strong> quando os movimentos acabam, o outro jogador recebe a vez.';

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
    : `${$('roundsSelect').value} rodadas · ${$('movesSelect').value} mov./turno`;
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
          : preset === 'prism' ? '🌈 arco-íris'
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
  const { side, r, c } = devSelection();
  const board = boardData(side);
  const cell = board?.[r]?.[c];
  if (!cell) {
    setDevStatus('Casa inválida.', 'error');
    return;
  }
  if (!cell.special && !cell.power) {
    setDevStatus('Essa casa não tem especial nem poder para executar.', 'error');
    return;
  }
  if (busy[side]) {
    setDevStatus('Espere a animação atual terminar.', 'error');
    return;
  }
  busy[side] = true;
  selected[side] = null;
  renderBoard(side);
  const triggerSet = new Set([key(r, c)]);
  const expanded = expandAllEffects(board, triggerSet);
  const rawGained = Math.round(50 + expanded.clearSet.size * 14 + expanded.triggered.size * 32 + expanded.powerTriggered.size * 20);
  if (expanded.crownCount) activateCrownBoost(side, expanded.crownCount);
  const crownMultiplier = crownMultiplierFor(side);
  const gained = Math.round(rawGained * crownMultiplier);
  setScore(side, scoreFor(side) + gained);
  const moneyBonus = Math.round((expanded.cashCount || 0) * DIRECT_CASH_BONUS * 100) / 100;
  if (moneyBonus) addBonusMoney(side, moneyBonus);
  let bonusSeconds = state.format === 'race' ? timeBonusFromCreation([], 1, expanded.triggered.size) : 0;
  if (state.format === 'race' && expanded.clockCount) bonusSeconds += expanded.clockCount * CLOCK_BONUS_SECONDS;
  awardTime(side, bonusSeconds);
  const usedBomb = [...expanded.triggered].some((value) => {
    const pos = parseKey(value);
    return board[pos.r]?.[pos.c]?.special === 'bomb';
  });
  const labelParts = [];
  if (cell.special === 'row' || cell.special === 'col') labelParts.push('↔/↕ Seta');
  if (cell.special === 'bomb') labelParts.push('💣 Bomba');
  if (cell.special === 'prism') labelParts.push('🌈 Arco-íris');
  if (cell.power === 'crown') labelParts.push(`👑 x${crownMultiplier}`);
  if (cell.power === 'devil') labelParts.push('😈 Diabinho');
  if (cell.power === 'cash') labelParts.push(`💸 +${formatMoney(moneyBonus)}`);
  if (cell.power === 'clock') labelParts.push(`⏳ +${expanded.clockCount * CLOCK_BONUS_SECONDS}s`);
  const label = labelParts.length ? labelParts.join(' · ') : 'Peça especial';
  if (side === 'player') $('comboLabel').textContent = `DEV: ${label}`;
  showPlayFeedback(side, { title: `DEV · ${label}`, points: gained, seconds: bonusSeconds, money: moneyBonus, boosted: expanded.crownCount > 0 });
  renderHud();
  void playMatchSound(side, 2);
  if (usedBomb) void playBombSound(side);
  await showLineEffects(side, triggeredLineEffects(board, expanded.triggered));
  await showClear(side, expanded.clearSet, expanded.triggered);
  clearBoardCells(board, expanded.clearSet);
  const movement = collapseBoard(board);
  renderBoard(side);
  await animateFalls(side, movement);
  await resolveMatches(side);
  busy[side] = false;
  renderBoard(side);
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
