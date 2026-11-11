/* =========================================================
   StakeMe — Mines
   Tuiles 3D à retournement, diamants et mines illustrés.
   ========================================================= */

import {
  $, wallet, fair, recordBet, toast, confettiWin, sfx,
  fmtX, money, validateBet, refreshIcons, round2,
} from '../core.js';

const TILES = 25;
const EDGE = 0.99;

const GEM = `<svg viewBox="0 0 100 88" aria-hidden="true">
  <ellipse cx="50" cy="79" rx="19" ry="3.6" fill="#000" opacity=".3"/>
  <path d="M50 11 79 34 50 79 21 34z" fill="url(#gemA)"/>
  <path d="M50 11 79 34 50 34z" fill="#ddd6fe" opacity=".85"/>
  <path d="M50 11 21 34 50 34z" fill="#7c3aed" opacity=".9"/>
  <path d="M21 34h58L50 79z" fill="url(#gemB)" opacity=".92"/>
  <path d="M50 11v23l29 0z" fill="#fff" opacity=".28"/>
  <path d="M21 34l29 0 0 45z" fill="#312e81" opacity=".3"/>
  <path d="M50 34 79 34 50 79z" fill="#22d3ee" opacity=".2"/>
  <path d="M50 11 79 34M50 11 21 34M21 34h58" stroke="#f5f3ff" stroke-width="1.1" opacity=".55" fill="none"/>
  <path d="M27 18l1.8 4.4 4.4 1.8-4.4 1.8L27 30.4l-1.8-4.4-4.4-1.8 4.4-1.8z" fill="#fff" opacity=".9"/>
  <path d="M74 17l1.4 3.4 3.4 1.4-3.4 1.4L74 26.6l-1.4-3.4-3.4-1.4 3.4-1.4z" fill="#a5f3fc" opacity=".8"/>
</svg>`;

const MINE = `<svg viewBox="0 0 100 88" aria-hidden="true">
  <ellipse cx="46" cy="77" rx="25" ry="4.6" fill="#000" opacity=".4"/>
  <g fill="#1f2937" stroke="#0b0f18" stroke-width="2">
    <path d="M46 18v-8M46 70v8M18 44h-8M74 44h8M26 24l-6-6M66 64l6 6M66 24l6-6M26 64l-6 6"/>
  </g>
  <circle cx="46" cy="44" r="23" fill="url(#mineBody)"/>
  <ellipse cx="38" cy="35" rx="7" ry="5" fill="#94a3b8" opacity=".3"/>
  <path d="M63 25c8-2 11-8 9-15" stroke="#a16207" stroke-width="3.6" stroke-linecap="round" fill="none"/>
  <circle cx="72" cy="9" r="5.5" fill="url(#fuseSpark)"/>
  <circle cx="72" cy="9" r="2.2" fill="#fffbe6"/>
</svg>`;

let el = null;
let bound = false;
let status = 'idle'; // idle | running | dead | cashed
let minesCount = 3;
let bet = 0;
let mineSet = new Set();
let opened = new Set();
let bonus = 0;
let busy = false;
let holdOverlay = false;

/** Multiplicateur pour k diamants trouvés avec m mines. */
function multiplier(k) {
  if (k <= 0) return 1;
  let m = EDGE;
  for (let i = 0; i < k; i++) m *= (TILES - i) / (TILES - minesCount - i);
  return m;
}

function cache(root) {
  el = {
    root,
    wrap: $('.mines-wrap', root),
    board: $('#minesBoard', root),
    overlay: $('#minesOverlay', root),
    overlayTitle: $('#minesOverlayTitle', root),
    overlayText: $('#minesOverlayText', root),
    again: $('#minesAgain', root),
    range: $('#minesRange', root),
    count: $('#minesCount', root),
    bet: $('#minesBet', root),
    start: $('#minesStart', root),
    cashout: $('#minesCashout', root),
    found: $('#minesFound', root),
    mult: $('#minesMult', root),
    bigMult: $('#minesCurrent', root),
    potential: $('#minesPotential', root),
    safeLeft: $('#minesSafeLeft', root),
    minesLeft: $('#minesMinesLeft', root),
  };
}

function bind() {
  if (bound) return;
  bound = true;

  el.range.addEventListener('input', () => {
    if (status === 'running') { el.range.value = minesCount; return; }
    minesCount = Number(el.range.value);
    render();
  });
  el.range.addEventListener('change', () => sfx('click'));

  el.start.addEventListener('click', () => {
    if (status === 'running' || busy) return;
    begin();
  });
  el.cashout.addEventListener('click', () => cashout());
  el.again.addEventListener('click', () => begin());

  el.board.addEventListener('click', (ev) => {
    const tile = ev.target.closest('[data-tile]');
    if (!tile) return;
    reveal(Number(tile.dataset.tile));
  });
}

function buildBoard() {
  el.board.innerHTML = Array.from({ length: TILES }, (_, i) => `
    <button class="mine-tile" data-tile="${i}" aria-label="Case ${i + 1}">
      <span class="tile-inner">
        <span class="tile-face tile-front"></span>
        <span class="tile-face tile-back"></span>
      </span>
    </button>`).join('');
  el.board.classList.remove('is-lost');
}

function begin() {
  const value = validateBet(el.bet);
  if (!value) return;
  place(value);
}

async function place(value) {
  if (busy) return;
  busy = true;
  let layout = null;
  let debited = false;

  try {
    const floats = await fair.round(TILES);
    const ordered = floats.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
    layout = new Set(ordered.slice(0, minesCount).map((o) => o.i));
    debited = wallet.debit(value);
  } finally {
    busy = false;
  }

  if (!debited) {
    toast('Solde insuffisant.', 'error');
    render();
    return;
  }

  mineSet = layout;
  bet = value;
  bonus = 0;
  opened = new Set();
  status = 'running';
  el.overlay.classList.add('hidden');
  buildBoard();
  sfx('click');
  render();
}

function reveal(index) {
  if (status !== 'running' || opened.has(index)) return;
  const tile = el.board.querySelector(`[data-tile="${index}"]`);
  if (!tile) return;
  const back = tile.querySelector('.tile-back');

  if (mineSet.has(index)) {
    status = 'dead';
    tile.classList.add('flipped', 'is-bone');
    back.innerHTML = MINE;
    revealBombs(index);
    recordBet({
      game: 'mines',
      bet,
      payout: 0,
      multiplier: 0,
      outcome: 'lose',
      detail: `${opened.size} diamant${opened.size > 1 ? 's' : ''} · ${minesCount} mines`,
    });
    sfx('boom');
    el.overlayTitle.textContent = 'Boom.';
    el.overlayText.textContent = `La mine a tout emporté après ${opened.size} diamant${opened.size > 1 ? 's' : ''}.`;
    render();
    holdOverlay = true;
    setTimeout(() => {
      holdOverlay = false;
      if (status === 'dead') el.overlay.classList.remove('hidden');
    }, 900);
    return;
  }

  opened.add(index);
  tile.classList.add('flipped', 'is-gem');
  back.innerHTML = GEM;
  tile.disabled = true;
  sfx('reveal');

  if (opened.size === TILES - minesCount) {
    cashout(true);
    return;
  }
  render();
}

function revealBombs(clicked) {
  el.board.querySelectorAll('[data-tile]').forEach((tile) => {
    const i = Number(tile.dataset.tile);
    tile.disabled = true;
    if (i === clicked) return;

    if (mineSet.has(i)) {
      tile.classList.add('flipped', 'is-bone', 'is-dim');
      tile.querySelector('.tile-back').innerHTML = MINE;
    } else if (!opened.has(i)) {
      tile.classList.add('is-dim');
    }
  });

  el.board.classList.add('is-lost');
  el.wrap.classList.add('is-flashing');
  setTimeout(() => el.wrap.classList.remove('is-flashing'), 650);
  setTimeout(() => el.board.classList.remove('is-lost'), 650);
}

function cashout(auto = false) {
  if (status !== 'running' || opened.size === 0) return;
  const mult = multiplier(opened.size);
  const payout = round2(bet * mult);

  wallet.credit(payout);
  recordBet({
    game: 'mines',
    bet,
    payout,
    multiplier: mult,
    outcome: 'win',
    detail: `${opened.size} diamant${opened.size > 1 ? 's' : ''}${auto ? ' · auto' : ''}`,
  });

  bonus = round2(payout - bet);
  status = 'cashed';
  el.overlay.classList.remove('hidden');
  el.overlayTitle.textContent = auto ? 'Grille nettoyée !' : 'Encaissé !';
  el.overlayText.textContent = `+$${money(bonus)} net à ${fmtX(mult)}.`;

  // Révèle les mines restantes, en douceur.
  el.board.querySelectorAll('[data-tile]').forEach((tile) => {
    const i = Number(tile.dataset.tile);
    tile.disabled = true;
    if (!opened.has(i) && mineSet.has(i)) {
      tile.classList.add('flipped', 'is-bone', 'is-dim');
      tile.querySelector('.tile-back').innerHTML = MINE;
    }
  });
  render();

  if (mult > 3) {
    confettiWin(1.4);
    sfx('jingle');
  } else {
    sfx('win');
  }
  toast(`Encaissé $${money(payout)} à ${fmtX(mult)}.`, 'success', 'hand-coins');
}

function render() {
  if (!el) return;
  const running = status === 'running';
  const mult = opened.size ? multiplier(opened.size) : 1;

  el.count.textContent = String(minesCount);
  el.range.value = String(minesCount);
  el.range.disabled = running;
  el.found.textContent = String(opened.size);
  el.mult.textContent = fmtX(mult);
  el.bigMult.textContent = fmtX(mult);
  el.potential.textContent = opened.size ? `$${money(bet * mult)}` : `$${money(0)}`;
  el.safeLeft.textContent = String(TILES - minesCount - opened.size);
  el.minesLeft.textContent = String(minesCount);

  el.start.disabled = running || busy;
  el.start.innerHTML = running
    ? '<i data-lucide="lock" class="h-4 w-4"></i> Partie en cours'
    : '<i data-lucide="play" class="h-4 w-4"></i> Miser & jouer';
  el.cashout.disabled = !(running && opened.size > 0);
  el.cashout.innerHTML = running && opened.size
    ? `<i data-lucide="hand-coins" class="h-4 w-4"></i> Encaisser $${money(bet * mult)}`
    : '<i data-lucide="hand-coins" class="h-4 w-4"></i> Encaisser';

  // Reprise après navigation : les tuiles déjà ouvertes restent visibles.
  el.board.querySelectorAll('[data-tile]').forEach((tile) => {
    const i = Number(tile.dataset.tile);
    if (opened.has(i) && !tile.classList.contains('flipped')) {
      tile.classList.add('flipped', 'is-gem');
      tile.querySelector('.tile-back').innerHTML = GEM;
      tile.disabled = true;
    }
  });

  refreshIcons(el.root);
}

export default {
  enter(root) {
    cache(root);
    bind();
    if (!el.board.children.length) buildBoard();
    const showOverlay = !holdOverlay && (status === 'dead' || status === 'cashed');
    el.overlay.classList.toggle('hidden', !showOverlay);
    el.range.disabled = status === 'running';
    render();
  },
  leave() {},
};
