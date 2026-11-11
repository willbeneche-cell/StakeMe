/* =========================================================
   StakeMe — Dé
   Barre bicolore, dé 3D, compteur néon et puces de résultats.
   ========================================================= */

import {
  $, $$, wallet, fair, recordBet, toast, confettiWin, sfx,
  fmtX, money, readBet, validateBet, refreshIcons, clamp, round2,
} from '../core.js';

let el = null;
let bound = false;
let target = 50.5;
let over = false;
let rolling = false;
let busy = false;
let lastRoll = null;
let animToken = 0;
let cubeX = -18;
let cubeY = -24;
let cubeRaf = 0;
const history = [];

function chance() {
  return over ? 100 - target : target;
}
function multiplier() {
  const c = chance();
  return c > 0 ? 99 / c : 0;
}

function cache(root) {
  el = {
    root,
    bet: $('#diceBet', root),
    roll: $('#diceRoll', root),
    result: $('#diceResult', root),
    slider: $('#diceSlider', root),
    winZone: $('#diceWinZone', root),
    loseZone: $('#diceLoseZone', root),
    marker: $('#diceMarker', root),
    pin: $('#dicePin', root),
    track: $('#diceTrack', root),
    cube: $('#diceCube', root),
    chance: $('#diceChance', root),
    mult: $('#diceMult', root),
    potential: $('#dicePotential', root),
    history: $('#diceHistory', root),
    modes: $$('[data-dice-mode]', root),
    presets: $$('[data-dice-preset]', root),
    scaleLow: $('#diceScaleLow', root),
    scaleHigh: $('#diceScaleHigh', root),
  };
}

function bind() {
  if (bound) return;
  bound = true;

  el.slider.addEventListener('input', () => {
    if (rolling) { el.slider.value = String(target); return; }
    target = clamp(parseFloat(el.slider.value) || 50, 2, 98);
    render();
  });

  el.modes.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (rolling) return;
      over = btn.dataset.diceMode === 'over';
      el.modes.forEach((b) => b.classList.toggle('active', b === btn));
      render();
      sfx('click');
    });
  });

  el.presets.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (rolling) return;
      const p = Number(btn.dataset.dicePreset);
      target = clamp(over ? 100 - p : p, 2, 98);
      el.slider.value = String(target);
      render();
      sfx('click');
    });
  });

  el.roll.addEventListener('click', () => roll());
}

/* ---------------- dé 3D ---------------- */
function showLbl(zone, pct) {
  const label = zone?.querySelector('span');
  if (label) label.style.opacity = pct > 17 ? '1' : '0';
}

function startCubeSpin() {
  if (!el?.cube) return;
  cancelAnimationFrame(cubeRaf);
  el.cube.style.transition = 'none';
  const spin = () => {
    cubeX += 15;
    cubeY += 19;
    el.cube.style.transform = `rotateX(${cubeX}deg) rotateY(${cubeY}deg)`;
    cubeRaf = requestAnimationFrame(spin);
  };
  spin();
}

function settleCube(value) {
  if (!el?.cube) return;
  cancelAnimationFrame(cubeRaf);
  const face = Math.min(6, Math.floor(value / (100 / 6)) + 1);
  const base = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [0, 180], 5: [0, 90], 6: [90, 0] }[face];
  const targetX = Math.ceil(cubeX / 360) * 360 + base[0] + 360;
  const targetY = Math.ceil(cubeY / 360) * 360 + base[1] + 360;
  el.cube.style.transition = 'transform 0.55s cubic-bezier(0.2, 0.9, 0.25, 1)';
  el.cube.style.transform = `rotateX(${targetX}deg) rotateY(${targetY}deg)`;
  cubeX = targetX;
  cubeY = targetY;
}

function render(rollValue = lastRoll, outcome = null) {
  if (!el) return;
  const c = chance();
  const m = multiplier();
  const bet = readBet(el.bet) || 0;

  el.chance.textContent = `${c.toFixed(2)} %`;
  el.mult.textContent = fmtX(m);
  el.potential.textContent = `$${money(bet * m)}`;
  el.slider.value = String(target);
  el.pin.style.left = `${target}%`;

  // Zone gagnante / perdante bicolore
  const winPct = over ? 100 - target : target;
  const losePct = 100 - winPct;
  if (over) {
    el.loseZone.style.left = '0%';
    el.loseZone.style.width = `${target}%`;
    el.winZone.style.left = `${target}%`;
    el.winZone.style.width = `${100 - target}%`;
  } else {
    el.winZone.style.left = '0%';
    el.winZone.style.width = `${target}%`;
    el.loseZone.style.left = `${target}%`;
    el.loseZone.style.width = `${100 - target}%`;
  }
  showLbl(el.winZone, winPct);
  showLbl(el.loseZone, losePct);

  el.scaleLow.textContent = '0';
  el.scaleHigh.textContent = '100';

  if (rollValue !== null && rollValue !== undefined) {
    el.result.textContent = rollValue.toFixed(2);
    el.marker.style.left = `${clamp(rollValue, 0, 100)}%`;
    el.marker.classList.add('show');
  } else {
    el.result.textContent = '50.00';
    el.marker.classList.remove('show');
  }

  el.result.classList.remove('win', 'lose', 'rolling');
  if (outcome === 'win') el.result.classList.add('win');
  else if (outcome === 'lose') el.result.classList.add('lose');

  el.roll.disabled = rolling;
}

function renderHistory() {
  if (!el?.history) return;
  if (!history.length) {
    el.history.innerHTML = '<span class="text-[11px] text-slate-600">Aucun lancer pour le moment.</span>';
    return;
  }
  el.history.innerHTML = history
    .slice(0, 8)
    .map((h) => `<span class="dice-chip ${h.win ? 'win' : 'lose'}">${h.value.toFixed(2)}</span>`)
    .join('');
}

async function roll() {
  if (rolling || busy) return;
  const bet = validateBet(el.bet);
  if (!bet) return;
  busy = true;

  const [f] = await fair.round(1);
  const value = Math.floor(clamp(f, 0, 0.99999) * 100 * 100) / 100;
  const won = over ? value > target : value < target;
  const m = multiplier();
  const payout = won ? round2(bet * m) : 0;

  if (!wallet.debit(bet)) {
    toast('Solde insuffisant.', 'error');
    busy = false;
    return;
  }

  rolling = true;
  busy = false;
  el.roll.disabled = true;
  el.result.classList.remove('win', 'lose');
  el.result.classList.add('rolling');
  el.marker.classList.remove('show');
  startCubeSpin();
  const token = ++animToken;

  const started = performance.now();
  const duration = 620;
  const tick = (now) => {
    if (token !== animToken) return;
    const p = clamp((now - started) / duration, 0, 1);
    el.result.textContent = (Math.random() * 100).toFixed(2);
    if (p < 1) {
      requestAnimationFrame(tick);
      return;
    }

    el.result.classList.remove('rolling');
    lastRoll = value;
    el.result.textContent = value.toFixed(2);
    el.result.classList.add(won ? 'win' : 'lose');
    el.marker.style.left = `${value}%`;
    el.marker.classList.add('show');
    settleCube(value);

    history.unshift({ value, win: won });
    if (history.length > 16) history.length = 16;
    renderHistory();

    if (won) {
      wallet.credit(payout);
      if (m > 3) {
        confettiWin(1.4);
        sfx('jingle');
      } else {
        sfx('win');
      }
      toast(`Gagné $${money(payout)} · ${fmtX(m)}`, 'success', 'trending-up');
    } else {
      sfx('lose');
    }

    recordBet({
      game: 'dice',
      bet,
      payout,
      multiplier: won ? m : 0,
      outcome: won ? 'win' : 'lose',
      detail: `${value.toFixed(2)} ${over ? '>' : '<'} ${target.toFixed(1)}`,
    });

    rolling = false;
    el.roll.disabled = false;
    render(value, won ? 'win' : 'lose');
    refreshIcons(el.root);
  };
  requestAnimationFrame(tick);
}

export default {
  enter(root) {
    cache(root);
    bind();
    render(lastRoll, lastRoll !== null ? (el.result.classList.contains('win') ? 'win' : 'lose') : null);
    renderHistory();
    refreshIcons(root);
  },
  leave() {
    // On laisse le tirage en cours se terminer : le pari est déjà débité.
    renderHistory();
  },
};
