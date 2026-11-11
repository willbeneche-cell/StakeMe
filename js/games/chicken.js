/* =========================================================
   StakeMe — La Poule (table de cloches dorées)
   25 cloches, 1 à 16 os selon la difficulté, cashout libre.
   ========================================================= */

import {
  $, $$, wallet, fair, recordBet, toast, confettiWin, sfx,
  fmtX, money, validateBet, refreshIcons, round2,
} from '../core.js';

const TILES = 25;
const EDGE = 0.99;

const DIFFS = {
  easy: { bones: 4 },
  medium: { bones: 7 },
  hard: { bones: 11 },
  master: { bones: 16 },
};

/* ---------- visuels (SVG inline, dégradés définis dans index.html) ---------- */
const CLOCHE = `<svg viewBox="0 0 100 88" class="cloche-svg" aria-hidden="true">
  <ellipse cx="50" cy="80" rx="35" ry="5.5" fill="#000" opacity=".45"/>
  <ellipse cx="50" cy="76.5" rx="35" ry="5" fill="url(#goldPlate)"/>
  <path d="M15 71c0-27 15.7-46 35-46s35 19 35 46z" fill="url(#goldDome)"/>
  <path d="M23 67c1.5-21 12.5-36 27-36 9.5 0 17.5 5.5 22.5 14-7-3.5-14.5-2.5-21 1.5-11 6.5-18 15.5-21 25-1 3.5-1.5 7-1.5 10.5-2.5-4.5-4.5-9.5-6-15z" fill="#fff" opacity=".2"/>
  <path d="M15 71h70" stroke="#fff3c9" stroke-width="1.2" opacity=".55"/>
  <circle cx="50" cy="22" r="4.6" fill="url(#goldKnob)"/>
  <circle cx="48.5" cy="20.5" r="1.4" fill="#fffbe8" opacity=".9"/>
  <path d="M31 38c3-8 9-13 16-15" stroke="#fff8e0" stroke-width="2" opacity=".35" fill="none" stroke-linecap="round"/>
</svg>`;

const ROAST = `<svg viewBox="0 0 100 88" aria-hidden="true">
  <ellipse cx="50" cy="76" rx="29" ry="4.6" fill="#000" opacity=".35"/>
  <path d="M22 60c-5-15 7-31 28-31s33 16 28 31c-3.5 10-14 15-28 15s-24.5-5-28-15z" fill="url(#roastGold)"/>
  <path d="M23 50c-7 2-11 9-9 16 6 2.5 13-1 16-7z" fill="#a85f16"/>
  <path d="M77 50c7 2 11 9 9 16-6 2.5-13-1-16-7z" fill="#a85f16"/>
  <path d="M31 43c5-9 12-14 21-14 8 0 15 4.5 20 12-6-4-13-6-21-6-8.5 0-15 3-20 8z" fill="#ffe6ad" opacity=".5"/>
  <path d="M37 68l-7 10" stroke="#f2c883" stroke-width="6" stroke-linecap="round"/>
  <path d="M63 68l7 10" stroke="#f2c883" stroke-width="6" stroke-linecap="round"/>
  <circle cx="29" cy="79" r="4.2" fill="#fbe7bf"/>
  <circle cx="71" cy="79" r="4.2" fill="#fbe7bf"/>
  <circle cx="45" cy="47" r="1.6" fill="#2ee6a8" opacity=".85"/>
  <circle cx="56" cy="53" r="1.2" fill="#2ee6a8" opacity=".7"/>
  <circle cx="49" cy="57" r="1" fill="#b6ff3c" opacity=".6"/>
</svg>`;

const BONE = `<svg viewBox="0 0 100 88" aria-hidden="true">
  <ellipse cx="50" cy="76" rx="25" ry="4" fill="#000" opacity=".3"/>
  <g transform="rotate(-28 50 48)">
    <rect x="27" y="43" width="46" height="10" rx="5" fill="url(#boneIvory)"/>
    <circle cx="27" cy="40" r="8" fill="url(#boneIvory)"/>
    <circle cx="27" cy="56" r="8" fill="url(#boneIvory)"/>
    <circle cx="73" cy="40" r="8" fill="url(#boneIvory)"/>
    <circle cx="73" cy="56" r="8" fill="url(#boneIvory)"/>
    <rect x="30" y="43" width="40" height="3.4" rx="1.7" fill="#fff" opacity=".45"/>
    <circle cx="25" cy="38" r="2" fill="#7f7768" opacity=".35"/>
  </g>
</svg>`;

let el = null;
let bound = false;
let diff = 'easy';
let status = 'idle'; // idle | running | dead | cashed
let opened = new Set();
let bones = new Set();
let bet = 0;
let payout = 0;
let deadIndex = -1;
let busy = false;
let holdOverlay = false;

/** Multiplicateur pour k cloches sûres ouvertes (B os sur 25). */
function multFor(k) {
  if (k <= 0) return 1;
  let m = EDGE;
  const b = DIFFS[diff].bones;
  for (let i = 0; i < k; i++) m *= (TILES - i) / (TILES - b - i);
  return m;
}

const safeTotal = () => TILES - DIFFS[diff].bones;

function cache(root) {
  el = {
    root,
    board: $('#chickenBoard', root),
    table: $('#chickenTable', root),
    overlay: $('#chickenOverlay', root),
    overlayTitle: $('#chickenOverlayTitle', root),
    overlayText: $('#chickenOverlayText', root),
    hint: $('#chickenHint', root),
    bet: $('#chickenBet', root),
    start: $('#chickenStart', root),
    cashout: $('#chickenCashout', root),
    mult: $('#chickenMult', root),
    multBig: $('#chickenCurrent', root),
    potential: $('#chickenPotential', root),
    next: $('#chickenNext', root),
    step: $('#chickenStep', root),
    odds: $('#chickenOdds', root),
    diffBtns: $$('[data-diff]', root),
  };
}

function bind() {
  if (bound) return;
  bound = true;

  el.diffBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (status === 'running' || busy) return;
      diff = btn.dataset.diff;
      render();
      sfx('click');
    });
  });

  el.start.addEventListener('click', () => {
    if (status === 'running' || busy) return;
    const value = validateBet(el.bet);
    if (!value) return;
    begin(value);
  });

  el.cashout.addEventListener('click', () => cashout());

  el.board.addEventListener('click', (ev) => {
    const tile = ev.target.closest('[data-cloche]');
    if (!tile) return;
    if (status === 'idle') {
      toast('Lance une mise pour ouvrir les cloches.', 'info', 'coins');
      return;
    }
    if (status !== 'running') return;
    open(Number(tile.dataset.cloche));
  });
}

function buildBoard() {
  el.board.innerHTML = Array.from({ length: TILES }, (_, i) => `
    <button class="cloche" data-cloche="${i}" aria-label="Cloche ${i + 1}">
      <span class="cloche-dome">${CLOCHE}</span>
      <span class="cloche-content"></span>
    </button>`).join('');
  el.table.classList.remove('is-lost');
}

async function begin(value) {
  if (busy) return;
  busy = true;
  let nextBones = null;
  let debited = false;

  try {
    const floats = await fair.round(TILES);
    const ordered = floats.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
    nextBones = new Set(ordered.slice(0, DIFFS[diff].bones).map((o) => o.i));
    debited = wallet.debit(value);
  } finally {
    busy = false;
  }

  if (!debited) {
    toast('Solde insuffisant.', 'error');
    render();
    return;
  }

  bones = nextBones;
  bet = value;
  payout = 0;
  opened = new Set();
  deadIndex = -1;
  status = 'running';
  buildBoard();
  sfx('click');
  render();
}

function open(index) {
  if (status !== 'running' || opened.has(index) || index === deadIndex) return;
  const tile = el.board.querySelector(`[data-cloche="${index}"]`);
  if (!tile) return;

  if (bones.has(index)) {
    deadIndex = index;
    lose();
    return;
  }

  opened.add(index);
  tile.classList.add('is-open', 'is-food');
  tile.querySelector('.cloche-content').innerHTML = ROAST;
  tile.disabled = true;
  sfx('reveal');

  if (opened.size === safeTotal()) {
    cashout(true);
    return;
  }
  render();
}

function lose() {
  status = 'dead';
  holdOverlay = true;
  el.table.classList.add('is-lost');
  sfx('boom');
  recordBet({
    game: 'chicken',
    bet,
    payout: 0,
    multiplier: 0,
    outcome: 'lose',
    detail: `${opened.size} cloche${opened.size > 1 ? 's' : ''} · ${DIFFS[diff].bones} os`,
  });
  syncTiles();
  render();
  setTimeout(() => el.table.classList.remove('is-lost'), 650);
  setTimeout(() => {
    holdOverlay = false;
    render();
  }, 850);
}

function cashout(auto = false) {
  if (status !== 'running' || opened.size === 0) return;
  const mult = multFor(opened.size);
  payout = round2(bet * mult);

  wallet.credit(payout);
  recordBet({
    game: 'chicken',
    bet,
    payout,
    multiplier: mult,
    outcome: 'win',
    detail: `${opened.size} cloche${opened.size > 1 ? 's' : ''}${auto ? ' · auto' : ''}`,
  });

  status = 'cashed';
  syncTiles();
  render();
  if (mult > 3) {
    confettiWin(1.4);
    sfx('jingle');
  } else {
    sfx('win');
  }
  toast(`Encaissé $${money(payout)} à ${fmtX(mult)}.`, 'success', 'hand-coins');
}

/** Reconstruit l'état visuel des cloches (parties reprises, os révélés). */
function syncTiles() {
  if (!el?.board) return;
  el.board.querySelectorAll('[data-cloche]').forEach((tile) => {
    const i = Number(tile.dataset.cloche);
    const content = tile.querySelector('.cloche-content');
    const isOpen = opened.has(i) || i === deadIndex;

    tile.classList.remove('is-open', 'is-food', 'is-bone', 'ghost');
    content.innerHTML = '';
    tile.disabled = status === 'dead' || status === 'cashed';

    if (isOpen) {
      const isBone = i === deadIndex;
      tile.classList.add('is-open', isBone ? 'is-bone' : 'is-food');
      content.innerHTML = isBone ? BONE : ROAST;
      tile.disabled = true;
    } else if (bones.has(i) && (status === 'dead' || status === 'cashed')) {
      tile.classList.add('ghost');
    }
  });
}

function render() {
  if (!el) return;
  const running = status === 'running';
  const mult = opened.size ? multFor(opened.size) : 1;
  const nextMult = opened.size < safeTotal() ? multFor(opened.size + 1) : null;

  el.odds.textContent = `${DIFFS[diff].bones} os · ${safeTotal()} plats`;
  el.diffBtns.forEach((b) => {
    b.classList.toggle('active', b.dataset.diff === diff);
    b.disabled = running;
    b.classList.toggle('opacity-50', running);
  });

  el.step.textContent = String(opened.size);
  el.mult.textContent = fmtX(mult);
  el.multBig.textContent = fmtX(mult);
  el.potential.textContent = opened.size ? `$${money(bet * mult)}` : `$${money(0)}`;
  el.next.textContent = nextMult ? fmtX(nextMult) : '—';

  el.start.disabled = running || busy;
  el.start.innerHTML = running
    ? '<i data-lucide="hand-pointer" class="h-4 w-4"></i> Choisis une cloche'
    : (status === 'dead' || status === 'cashed')
      ? '<i data-lucide="rotate-ccw" class="h-4 w-4"></i> Rejouer'
      : '<i data-lucide="play" class="h-4 w-4"></i> Miser & jouer';

  el.cashout.disabled = !(running && opened.size > 0);
  el.cashout.innerHTML = running && opened.size
    ? `<i data-lucide="hand-coins" class="h-4 w-4"></i> Encaisser $${money(bet * mult)}`
    : '<i data-lucide="hand-coins" class="h-4 w-4"></i> Encaisser';

  el.hint.textContent = running
    ? `${opened.size} cloche${opened.size > 1 ? 's' : ''} ouverte${opened.size > 1 ? 's' : ''} · ${fmtX(mult)}`
    : status === 'dead'
      ? 'Un os est sorti. Mise perdue.'
      : status === 'cashed'
        ? `Encaissé à ${fmtX(multFor(opened.size))} · +$${money(payout - bet)}`
        : 'Lance une mise pour ouvrir les cloches.';

  const showOverlay = !holdOverlay && (status === 'dead' || status === 'cashed');
  el.overlay.classList.toggle('is-hidden', !showOverlay);
  if (status === 'dead') {
    el.overlayTitle.textContent = 'Os.';
    el.overlayText.textContent = `La mise de $${money(bet)} est perdue après ${opened.size} cloche${opened.size > 1 ? 's' : ''}.`;
  } else if (status === 'cashed') {
    el.overlayTitle.textContent = 'Encaissé !';
    el.overlayText.textContent = `+$${money(payout - bet)} net à ${fmtX(multFor(opened.size))}.`;
  }

  refreshIcons(el.root);
}

export default {
  enter(root) {
    cache(root);
    bind();
    if (!el.board.children.length) buildBoard();
    syncTiles();
    render();
  },
  leave() {},
};
