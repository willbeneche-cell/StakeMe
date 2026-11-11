/* =========================================================
   StakeMe — Crash
   Canvas temps réel, courbe log, crash pré-déterminé (SHA-256),
   cashout manuel ou automatique.
   ========================================================= */

import {
  $, wallet, fair, recordBet, toast, confettiWin, sfx,
  fmtX, money, readBet, validateBet, state, round2, clamp,
} from '../core.js';

const GROWTH = 0.1733;          // e^(GROWTH * s) → ~2× à 4 s
const WAIT_MS = 5500;
const COOLDOWN_MS = 4200;
const MAX_MULT = 50000;

const S = {
  phase: 'idle',            // idle | waiting | running | crashed
  crashAt: 2,
  mult: 1,
  startedAt: 0,
  points: [],
  particles: [],
  trail: [],
  smoke: [],
  history: [],
  activeBet: 0,
  armedAmount: 0,
  cashed: false,
  endElapsed: 0,
  autoOn: false,
  autoTarget: 2,
  countdownEnds: 0,
  nextRoundAt: 0,
  raf: 0,
  entered: false,
  bound: false,
  lastStatus: '',
  lastBadge: '',
};

let el = null;
let ctx = null;
let W = 0;
let H = 0;
let ro = null;
let lastFrame = 0;

const crashPointFromFloat = (f) => {
  const e = 4294967296;
  const h = Math.floor(clamp(f, 0, 0.999999999) * e);
  const raw = (100 * e - h) / (e - h);
  return clamp(Math.floor(raw) / 100, 1, MAX_MULT);
};

function cache(root) {
  el = {
    root,
    canvas: $('#crashCanvas', root),
    wrap: $('#crashWrap', root),
    multiplier: $('#crashMultiplier', root),
    status: $('#crashStatus', root),
    history: $('#crashHistory', root),
    action: $('#crashAction', root),
    hint: $('#crashHint', root),
    badge: $('#crashPhaseBadge', root),
    stake: $('#crashStake', root),
    potential: $('#crashPotential', root),
    bet: $('#crashBet', root),
    auto: $('#crashAuto', root),
    autoTarget: $('#crashAutoTarget', root),
    flash: $('#crashFlash', root),
    crashed: $('#crashCrashed', root),
  };
  ctx = el.canvas.getContext('2d');
}

function bind() {
  if (S.bound) return;
  S.bound = true;

  el.action.addEventListener('click', onAction);

  el.auto.addEventListener('change', () => {
    syncAuto();
    if (S.autoOn) el.autoTarget.focus({ preventScroll: true });
    sfx('click');
  });

  el.autoTarget.addEventListener('input', syncAuto);
  el.autoTarget.addEventListener('change', () => {
    syncAuto();
    el.autoTarget.value = S.autoTarget.toFixed(2);
  });

  window.addEventListener('resize', fit);
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(fit);
    ro.observe(el.wrap);
  }
}

/** Relit la case à cocher et la cible saisie (l'événement change peut ne pas partir). */
function syncAuto() {
  if (!el) return;
  S.autoOn = !!el.auto.checked;
  const value = parseFloat(el.autoTarget.value);
  if (Number.isFinite(value)) S.autoTarget = clamp(value, 1.01, 1000);
  el.autoTarget.disabled = !S.autoOn;
}

function fit() {
  if (!el?.canvas) return;
  const rect = el.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  el.canvas.width = Math.round(rect.width * dpr);
  el.canvas.height = Math.round(rect.height * dpr);
  W = rect.width;
  H = rect.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ---------------- cycle ---------------- */
async function startWaiting() {
  if (!S.entered) return;
  S.phase = 'waiting';
  S.mult = 1;
  S.points = [];
  S.particles = [];
  S.trail = [];
  S.smoke = [];
  S.cashed = false;
  S.activeBet = 0;
  S.countdownEnds = Date.now() + WAIT_MS;
  el.crashed?.classList.remove('show');
  updateUI();

  const [f] = await fair.round(1);
  S.crashAt = crashPointFromFloat(f);
}

function launch() {
  syncAuto();
  S.phase = 'running';
  S.mult = 1;
  S.startedAt = performance.now();
  S.points = [{ t: 0, m: 1 }];
  S.cashed = false;

  if (S.armedAmount > 0) {
    S.activeBet = S.armedAmount;
    S.armedAmount = 0;
    sfx('click');
  } else {
    S.activeBet = 0;
  }
  updateUI();
}

function crash() {
  S.endElapsed = S.points.length ? S.points[S.points.length - 1].t : 0.2;
  S.phase = 'crashed';
  S.nextRoundAt = Date.now() + COOLDOWN_MS;
  S.mult = S.crashAt;

  spawnExplosion();
  spawnSmoke();
  sfx('crash');
  el.crashed?.classList.add('show');

  if (el.flash) {
    el.flash.classList.add('show');
    setTimeout(() => el.flash.classList.remove('show'), 150);
  }

  if (S.activeBet > 0 && !S.cashed) {
    recordBet({
      game: 'crash',
      bet: S.activeBet,
      payout: 0,
      multiplier: 0,
      outcome: 'lose',
      detail: `crash à ${fmtX(S.crashAt)}`,
    });
    S.activeBet = 0;
  }

  S.history.unshift(S.crashAt);
  if (S.history.length > 8) S.history.length = 8;
  renderHistoryChips();
  updateUI();
}

function cashout(auto = false) {
  if (S.phase !== 'running' || !S.activeBet || S.cashed) return;
  const stake = S.activeBet;
  const mult = Math.min(S.mult, S.crashAt);
  const payout = round2(stake * mult);

  wallet.credit(payout);
  recordBet({
    game: 'crash',
    bet: stake,
    payout,
    multiplier: mult,
    outcome: 'win',
    detail: auto ? `auto ${fmtX(mult)}` : `cashout ${fmtX(mult)}`,
  });
  S.cashed = true;
  S.activeBet = 0;
  if (mult > 3) {
    confettiWin(1.4);
    sfx('jingle');
  } else {
    sfx('cashed');
  }
  setStatus(`${auto ? 'Auto cashout' : 'Cashout'} à ${fmtX(mult)} · +$${money(payout - stake)}`, 'win');
  updateUI();
}

/* ---------------- actions ---------------- */
function onAction() {
  if (S.phase === 'running') {
    if (S.activeBet > 0 && !S.cashed) cashout(false);
    return;
  }

  if (S.armedAmount > 0) {
    wallet.credit(S.armedAmount);
    toast(`Mise de $${money(S.armedAmount)} annulée et remboursée.`, 'info', 'rotate-ccw');
    S.armedAmount = 0;
    updateUI();
    return;
  }

  armBet();
}

function armBet() {
  syncAuto();
  const bet = validateBet(el.bet);
  if (!bet) return;
  if (S.phase === 'running') {
    toast('Le vol est en cours — attends le prochain départ.', 'info', 'clock');
    return;
  }
  if (!wallet.debit(bet)) {
    toast('Solde insuffisant.', 'error');
    return;
  }
  S.armedAmount = bet;
  S.bet = bet;
  sfx('click');
  toast(`Mise de $${money(bet)} placée pour le prochain vol.`, 'success', 'rocket');
  updateUI();
}

/* ---------------- UI ---------------- */
function setStatus(text, variant = '') {
  if (!el?.status) return;
  el.status.textContent = text;
  el.status.classList.toggle('win', variant === 'win');
}

function updateUI() {
  if (!el) return;

  // Multiplier
  el.multiplier.textContent = S.phase === 'waiting' ? '1.00×' : fmtX(S.mult);
  el.multiplier.classList.toggle('crashed', S.phase === 'crashed');

  if (S.phase === 'waiting') {
    const left = Math.max(0, (S.countdownEnds - Date.now()) / 1000);
    setStatus(`Décollage dans ${left.toFixed(1)} s`);
  } else if (S.phase === 'running') {
    setStatus(S.activeBet ? 'En vol · encaisse avant le crash' : 'En vol · mode spectateur');
  } else if (S.phase === 'crashed') {
    setStatus(`Crashé à ${fmtX(S.crashAt)} · nouveau vol bientôt`);
  }

  // Badge
  let badge = 'En attente';
  if (S.phase === 'running') badge = 'En vol';
  else if (S.phase === 'crashed') badge = 'Crashé';
  else if (S.phase === 'waiting') badge = S.armedAmount ? 'Mise placée' : 'Départ imminent';
  if (badge !== S.lastBadge) {
    el.badge.textContent = badge;
    const tone = S.phase === 'running' ? 'bg-neon-green/15 text-neon-green'
      : S.phase === 'crashed' ? 'bg-red-500/15 text-red-400'
        : S.armedAmount ? 'bg-neon-violet/15 text-neon-violet'
          : 'bg-white/[0.06] text-slate-400';
    el.badge.className = `rounded-md px-2 py-0.5 text-[11px] font-medium ${tone}`;
    S.lastBadge = badge;
  }

  el.stake.textContent = money(S.activeBet || S.armedAmount || 0);
  el.potential.textContent = `$${money(S.activeBet ? S.activeBet * S.mult : 0)}`;

  // Action
  const btn = el.action;
  btn.disabled = false;
  btn.classList.remove('btn-primary', 'btn-ghost', 'btn-cash');
  if (S.phase === 'running') {
    if (S.cashed) {
      btn.disabled = true;
      btn.classList.add('btn-cash');
      btn.innerHTML = '<i data-lucide="check" class="h-4 w-4"></i> Encaissé';
      el.hint.textContent = 'Ce vol est terminé pour toi.';
    } else if (S.activeBet > 0) {
      btn.classList.add('btn-cash');
      btn.innerHTML = `<i data-lucide="hand-coins" class="h-4 w-4"></i> Cashout $${money(S.activeBet * S.mult)}`;
      el.hint.textContent = 'Le crash peut arriver à tout instant.';
    } else {
      btn.disabled = true;
      btn.classList.add('btn-ghost');
      btn.innerHTML = '<i data-lucide="eye" class="h-4 w-4"></i> Observation';
      el.hint.textContent = 'Mise pour le prochain vol.';
    }
  } else if (S.armedAmount > 0) {
    btn.classList.add('btn-ghost');
    btn.innerHTML = '<i data-lucide="x" class="h-4 w-4"></i> Annuler la mise';
    el.hint.textContent = 'La mise partira au prochain décollage.';
  } else {
    btn.classList.add('btn-primary');
    btn.innerHTML = S.phase === 'crashed'
      ? '<i data-lucide="rocket" class="h-4 w-4"></i> Miser pour le prochain vol'
      : '<i data-lucide="rocket" class="h-4 w-4"></i> Miser';
    el.hint.textContent = 'La mise est prise en compte au prochain décollage.';
  }

  if (window.lucide?.createIcons) window.lucide.createIcons({ root: el.root });
}

function renderHistoryChips() {
  if (!el?.history) return;
  el.history.innerHTML = S.history.length
    ? S.history
      .map((m) => `<span class="crash-chip ${m >= 5 ? 'high' : m < 1.5 ? 'low' : ''}">${fmtX(m)}</span>`)
      .join('')
    : '<span class="text-[11px] text-slate-600">Aucun vol terminé.</span>';
}

/* ---------------- canvas drawing ---------------- */
function spawnExplosion() {
  const geo = rocketPosition();
  for (let i = 0; i < 46; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 190;
    S.particles.push({
      x: geo.x, y: geo.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 30,
      life: 0.65 + Math.random() * 0.5,
      born: performance.now(),
      size: 1.4 + Math.random() * 2.6,
      hue: Math.random() > 0.45 ? '#f87171' : Math.random() > 0.5 ? '#fbbf24' : '#a855f7',
    });
  }
}

function plotGeom() {
  return { padL: 44, padR: 20, padT: 26, padB: 30 };
}

function rocketPosition() {
  const { padL, padR, padT, padB } = plotGeom();
  const plotW = Math.max(10, W - padL - padR);
  const plotH = Math.max(10, H - padT - padB);
  const ref = S.phase === 'waiting' ? 1 : S.mult;
  const elapsed = S.phase === 'running'
    ? (performance.now() - S.startedAt) / 1000
    : S.phase === 'crashed' ? S.endElapsed : 0;
  const windowSec = Math.max(5, elapsed * 1.08);
  const yMax = Math.max(2, ref * 1.3);
  const x = padL + plotW;
  const y = padT + plotH - (Math.log(Math.max(1, ref)) / Math.log(yMax)) * plotH;
  return { x: S.phase === 'waiting' ? padL + 12 : x, y: S.phase === 'waiting' ? padT + plotH - 2 : y, padL, padR, padT, padB, plotW, plotH, yMax, windowSec };
}

function draw(now) {
  if (!ctx || !W || !H) return;
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
  lastFrame = now;

  const { padL, padR, padT, padB } = plotGeom();
  const plotW = Math.max(10, W - padL - padR);
  const plotH = Math.max(10, H - padT - padB);
  const baseY = padT + plotH;

  const elapsed = S.phase === 'running'
    ? (now - S.startedAt) / 1000
    : S.phase === 'crashed' ? S.endElapsed : 0;
  const windowSec = Math.max(5, elapsed * 1.08);
  const ref = S.phase === 'running' || S.phase === 'crashed' ? S.mult : 1;
  const yMax = Math.max(2, ref * 1.3);

  ctx.clearRect(0, 0, W, H);
  drawBackground(now);

  // ---- grid ----
  ctx.save();
  ctx.strokeStyle = 'rgba(148,163,184,0.075)';
  ctx.lineWidth = 1;
  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = 'rgba(148,163,184,0.42)';

  const ticks = [1.5, 2, 3, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000].filter((t) => t <= yMax * 1.02);
  ticks.unshift(1);
  ticks.forEach((t) => {
    const y = padT + plotH - (Math.log(t) / Math.log(yMax)) * plotH;
    if (y < padT - 2) return;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(`${t.toFixed(t < 10 ? 1 : 0)}×`, 8, y + 3);
  });

  const vLines = 5;
  for (let i = 0; i <= vLines; i++) {
    const x = padL + (plotW / vLines) * i;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, baseY);
    ctx.stroke();
  }

  // baseline
  ctx.strokeStyle = 'rgba(148,163,184,0.16)';
  ctx.beginPath();
  ctx.moveTo(padL, baseY);
  ctx.lineTo(padL + plotW, baseY);
  ctx.stroke();
  ctx.restore();

  // ---- waiting state ----
  if (S.phase === 'waiting' || S.phase === 'idle') {
    const pulse = 0.5 + Math.sin(now / 380) * 0.5;
    const x = padL + 10;
    const y = baseY - 12;
    ctx.save();
    ctx.strokeStyle = `rgba(0,231,1,${0.25 + pulse * 0.35})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 12 + pulse * 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([4, 7]);
    ctx.strokeStyle = 'rgba(46,230,168,0.25)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(padL + plotW * 0.42, padT + plotH * 0.35);
    ctx.stroke();
    ctx.restore();
    drawRocket(x, y, -0.42, 0.9);
    return;
  }

  // ---- curve ----
  const pts = S.points;
  if (pts.length > 1) {
    const toXY = (t, m) => ({
      x: padL + (t / windowSec) * plotW,
      y: padT + plotH - (Math.log(Math.max(1, m)) / Math.log(yMax)) * plotH,
    });

    const crashed = S.phase === 'crashed';
    const stroke = crashed ? '#f87171' : '#00e701';

    // remplissage
    ctx.save();
    ctx.beginPath();
    const first = toXY(pts[0].t, pts[0].m);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const p = toXY(pts[i].t, pts[i].m);
      ctx.lineTo(p.x, p.y);
    }
    const last = toXY(pts[pts.length - 1].t, pts[pts.length - 1].m);
    ctx.lineTo(Math.min(last.x, padL + plotW), baseY);
    ctx.lineTo(first.x, baseY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, baseY);
    if (crashed) {
      grad.addColorStop(0, 'rgba(248,113,113,0.28)');
      grad.addColorStop(1, 'rgba(248,113,113,0)');
    } else {
      grad.addColorStop(0, 'rgba(0,231,1,0.24)');
      grad.addColorStop(1, 'rgba(0,231,1,0)');
    }
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // tracé
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const p = toXY(pts[i].t, pts[i].m);
      ctx.lineTo(p.x, p.y);
    }
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke;
    ctx.shadowColor = crashed ? 'rgba(248,113,113,0.65)' : 'rgba(0,231,1,0.55)';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();

    // petite lueur au bout
    if (!crashed) {
      const g2 = ctx.createRadialGradient(last.x, last.y, 0, last.x, last.y, 26);
      g2.addColorStop(0, 'rgba(46,230,168,0.5)');
      g2.addColorStop(1, 'rgba(46,230,168,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 26, 0, Math.PI * 2);
      ctx.fill();

      const prev = toXY(pts[Math.max(0, pts.length - 4)].t, pts[Math.max(0, pts.length - 4)].m);
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      S.trail.push({ x: last.x, y: last.y, born: now });
      if (S.trail.length > 44) S.trail.shift();
      drawTrail(now);
      drawRocket(last.x, last.y, angle, 1);
    }
  }

  // ---- fumée ----
  if (S.smoke.length) {
    ctx.save();
    for (let i = S.smoke.length - 1; i >= 0; i--) {
      const p = S.smoke[i];
      const age = (now - p.born) / 1000;
      if (age > p.life) { S.smoke.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = age / p.life;
      const alpha = (1 - t) * 0.32;
      const r = p.size * (0.5 + t * 1.7);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, `rgba(185,195,215,${alpha})`);
      g.addColorStop(1, 'rgba(120,130,150,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- particles ----
  if (S.particles.length) {
    ctx.save();
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      const age = (now - p.born) / 1000;
      if (age > p.life) { S.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 210 * dt;
      p.vx *= 0.99;
      const alpha = 1 - age / p.life;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.hue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.6 + alpha * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/* ---------------- décor radar ---------------- */
function drawBackground(now) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(0.55, '#141a35');
  grad.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const ox = 40;
  const oy = H - 26;
  const maxR = Math.hypot(W, H);

  ctx.save();
  ctx.strokeStyle = 'rgba(129,140,248,0.11)';
  ctx.lineWidth = 1;
  for (let r = 58; r < maxR; r += 62) {
    ctx.beginPath();
    ctx.arc(ox, oy, r, -Math.PI / 2, 0);
    ctx.stroke();
  }
  for (let a = 0; a <= 90; a += 15) {
    const rad = (a * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(rad) * maxR, oy - Math.sin(rad) * maxR);
    ctx.stroke();
  }

  // balayage radar
  const sweep = ((now / 2800) % 1) * (Math.PI / 2);
  ctx.translate(ox, oy);
  ctx.rotate(-Math.PI / 2 + sweep);
  const wedge = ctx.createLinearGradient(0, 0, Math.min(W, H) * 0.95, 0);
  wedge.addColorStop(0, 'rgba(46,230,168,0.20)');
  wedge.addColorStop(1, 'rgba(46,230,168,0)');
  ctx.fillStyle = wedge;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, Math.min(W, H) * 0.95, -0.3, 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // vignette
  const vg = ctx.createRadialGradient(W * 0.5, H * 0.35, 20, W * 0.5, H * 0.5, Math.max(W, H) * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(3,6,14,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawTrail(now) {
  ctx.save();
  for (let i = 0; i < S.trail.length; i++) {
    const p = S.trail[i];
    const age = (now - p.born) / 1000;
    if (age > 1.15) continue;
    const alpha = (1 - age / 1.15) * 0.5;
    const r = 2 + age * 15;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, `rgba(200,255,225,${alpha})`);
    g.addColorStop(0.45, `rgba(46,230,168,${alpha * 0.5})`);
    g.addColorStop(1, 'rgba(46,230,168,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  S.trail = S.trail.filter((p) => now - p.born < 1300);
  ctx.restore();
}

function spawnSmoke() {
  const geo = rocketPosition();
  for (let i = 0; i < 22; i++) {
    S.smoke.push({
      x: geo.x + (Math.random() - 0.5) * 26,
      y: geo.y + (Math.random() - 0.5) * 22,
      vx: (Math.random() - 0.5) * 55,
      vy: -20 - Math.random() * 55,
      born: performance.now(),
      life: 0.9 + Math.random() * 0.9,
      size: 10 + Math.random() * 22,
    });
  }
}

function drawRocket(x, y, angle, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  // réacteur
  const flame = 16 + Math.random() * 12;
  const fg = ctx.createLinearGradient(-14, 0, -14 - flame, 0);
  fg.addColorStop(0, 'rgba(255,255,255,0.95)');
  fg.addColorStop(0.3, 'rgba(182,255,60,0.95)');
  fg.addColorStop(0.65, 'rgba(0,231,1,0.6)');
  fg.addColorStop(1, 'rgba(0,231,1,0)');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-12, -5);
  ctx.quadraticCurveTo(-18 - flame * 0.7, 0, -12, 5);
  ctx.closePath();
  ctx.fill();

  // ailerons
  ctx.fillStyle = '#0f766e';
  ctx.beginPath(); ctx.moveTo(-6, 5); ctx.lineTo(-15, 13); ctx.lineTo(-11, 3); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(-15, -13); ctx.lineTo(-11, -3); ctx.closePath(); ctx.fill();

  // fuselage
  const body = ctx.createLinearGradient(0, -8, 0, 8);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.45, '#d1fae5');
  body.addColorStop(1, '#34d399');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.quadraticCurveTo(8, -7, -6, -7);
  ctx.lineTo(-12, -4);
  ctx.quadraticCurveTo(-14, 0, -12, 4);
  ctx.lineTo(-6, 7);
  ctx.quadraticCurveTo(8, 7, 18, 0);
  ctx.closePath();
  ctx.fill();

  // verrière
  ctx.fillStyle = '#0f2b3d';
  ctx.beginPath(); ctx.ellipse(5, 0, 3.6, 2.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.ellipse(4.4, -0.8, 1.3, 0.7, -0.4, 0, Math.PI * 2); ctx.fill();

  // aile
  ctx.fillStyle = '#2ee6a8';
  ctx.beginPath(); ctx.moveTo(4, 4); ctx.lineTo(-10, 13); ctx.lineTo(-2, 3); ctx.closePath(); ctx.fill();

  // liseré néon
  ctx.strokeStyle = 'rgba(0,231,1,0.8)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.quadraticCurveTo(6, -5.5, -6, -5.5);
  ctx.stroke();

  ctx.restore();
}

/* ---------------- loop ---------------- */
function loop(now) {
  S.raf = requestAnimationFrame(loop);
  if (!S.entered) return;

  if (S.phase === 'waiting') {
    const left = Math.max(0, S.countdownEnds - Date.now());
    setStatus(`Décollage dans ${(left / 1000).toFixed(1)} s`);
    if (left <= 0) launch();
  } else if (S.phase === 'running') {
    const elapsed = (now - S.startedAt) / 1000;
    S.mult = Math.exp(GROWTH * elapsed);
    if (S.mult >= S.crashAt) {
      S.mult = S.crashAt;
      crash();
    } else {
      S.points.push({ t: elapsed, m: S.mult });
      if (S.points.length > 700) S.points = S.points.filter((_, i) => i % 2 === 0);
      el.multiplier.textContent = fmtX(S.mult);
      if (S.activeBet) el.potential.textContent = `$${money(S.activeBet * S.mult)}`;
      if (S.activeBet && !S.cashed) {
        el.action.innerHTML = `<i data-lucide="hand-coins" class="h-4 w-4"></i> Cashout $${money(S.activeBet * S.mult)}`;
      }
      if (S.autoOn && S.activeBet > 0 && !S.cashed && S.mult >= S.autoTarget) cashout(true);
    }
  } else if (S.phase === 'crashed') {
    if (Date.now() >= S.nextRoundAt) {
      // Nouveau cycle : si le joueur quitte l'écran, startWaiting vérifie `entered`.
      startWaiting();
    } else {
      const left = Math.ceil((S.nextRoundAt - Date.now()) / 1000);
      setStatus(`Crashé à ${fmtX(S.crashAt)} · nouveau vol dans ${left} s`);
    }
  }

  draw(now);
}

/* ---------------- lifecycle ---------------- */
export default {
  enter(root) {
    cache(root);
    bind();
    S.entered = true;
    fit();
    renderHistoryChips();

    // Reprise : on ne laisse pas un vol orphelin sans affichage.
    if (S.phase === 'idle') {
      startWaiting();
    } else if (S.phase === 'crashed' && Date.now() > S.nextRoundAt + 8000) {
      startWaiting();
    } else if (S.phase === 'waiting' && S.countdownEnds < Date.now() - 1000) {
      startWaiting();
    }

    updateUI();
    cancelAnimationFrame(S.raf);
    S.raf = requestAnimationFrame(loop);
    if (window.lucide?.createIcons) window.lucide.createIcons({ root });
  },

  leave() {
    S.entered = false;
    cancelAnimationFrame(S.raf);
    S.raf = 0;

    // Quitter en plein vol : on protège la mise du joueur.
    if (S.phase === 'running' && S.activeBet > 0 && !S.cashed) {
      cashout(true);
    }
    // Mise en attente : remboursée.
    if (S.armedAmount > 0) {
      wallet.credit(S.armedAmount);
      S.armedAmount = 0;
    }
    if (S.phase === 'waiting') S.phase = 'idle';
    if (S.phase === 'crashed') S.phase = 'idle';
  },
};
