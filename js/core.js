/* =========================================================
   StakeMe — core engine
   State, wallet, provably fair, UI utilities.
   ========================================================= */

export const STORAGE_KEY = 'stakeme.state.v1';

/* ---------------- small utilities ---------------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const money = (n, decimals = 2) =>
  Number(n || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

export const fmtX = (n) => `${Number(n).toFixed(2)}×`;
export const fmtXSpaced = (n) => `${Number(n).toFixed(2)}x`;

export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ---------------- state ---------------- */
const randHex = (bytes = 16) => {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const AVATARS = ['🦊', '🐼', '🐲', '🦁', '🐯', '👾', '🦉', '🐺'];

function defaults() {
  return {
    version: 1,
    balance: 1000,
    createdAt: Date.now(),
    profile: { name: 'Guest', avatar: '🦊', xp: 120 },
    stats: { wagered: 0, won: 0, bets: 0, wins: 0, biggestWin: 0, bestMultiplier: 0 },
    history: [],
    deposits: [],
    settings: { sound: true, effects: true },
    fair: {
      serverSeed: randHex(32),
      serverSeedHash: '',
      revealedSeed: '',
      clientSeed: randHex(8),
      nonce: 0,
    },
  };
}

function load() {
  const base = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return {
      ...base,
      ...parsed,
      profile: { ...base.profile, ...(parsed.profile || {}) },
      stats: { ...base.stats, ...(parsed.stats || {}) },
      settings: { ...base.settings, ...(parsed.settings || {}) },
      fair: { ...base.fair, ...(parsed.fair || {}) },
      history: Array.isArray(parsed.history) ? parsed.history : [],
      deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [],
    };
  } catch (err) {
    console.warn('[StakeMe] état illisible, réinitialisation partielle', err);
    return base;
  }
}

export const state = load();

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[StakeMe] sauvegarde impossible', err);
    }
  }, 60);
}

export function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[StakeMe] sauvegarde impossible', err);
  }
}

/* ---------------- events ---------------- */
const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}
export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try { fn(payload); } catch (err) { console.error(err); }
  });
}

/* ---------------- icons ---------------- */
export function refreshIcons(root = document) {
  if (window.lucide?.createIcons) window.lucide.createIcons({ root, attrs: { 'stroke-width': 2 } });
}

/* ---------------- balance animation ---------------- */
let lastBalanceShown = state.balance;

export function refreshBalance(pulse = false) {
  const target = state.balance;
  const from = lastBalanceShown;
  lastBalanceShown = target;

  $$('[data-balance]').forEach((el) => {
    if (!pulse || from === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = money(target);
      return;
    }
    const start = performance.now();
    const dur = 480;
    const step = (now) => {
      const p = clamp((now - start) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = money(from + (target - from) * eased);
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = money(target);
    };
    requestAnimationFrame(step);
  });

  if (pulse) {
    const widget = $('.balance-widget');
    if (widget) {
      widget.classList.remove('bump');
      void widget.offsetWidth;
      widget.classList.add('bump');
    }
  }
}

export function refreshStats() {
  const s = state.stats;
  $$('[data-stat]').forEach((el) => {
    const key = el.dataset.stat;
    if (key === 'wagered' || key === 'won' || key === 'biggestWin') el.textContent = money(s[key] || 0);
    else el.textContent = s[key] ?? 0;
  });
  const net = round2((s.won || 0) - (s.wagered || 0));
  const netEl = $('#statNet');
  if (netEl) {
    netEl.textContent = `${net >= 0 ? '+' : '−'}$${money(Math.abs(net))}`;
    netEl.classList.toggle('text-neon-mint', net > 0);
    netEl.classList.toggle('text-slate-300', net <= 0);
  }
  const winrate = $('#statWinrate');
  if (winrate) winrate.textContent = s.bets ? `${Math.round((s.wins / s.bets) * 100)} %` : '—';
}

/* ---------------- wallet ---------------- */
export const wallet = {
  get balance() { return state.balance; },
  canAfford(amount) { return Number(amount) > 0 && Number(amount) <= state.balance + 1e-9; },
  debit(amount) {
    const value = round2(amount);
    if (!this.canAfford(value)) return false;
    state.balance = round2(state.balance - value);
    save();
    refreshBalance(true);
    emit('wallet:change', { balance: state.balance });
    return true;
  },
  credit(amount) {
    const value = round2(amount);
    if (value <= 0) return;
    state.balance = round2(state.balance + value);
    save();
    refreshBalance(true);
    emit('wallet:change', { balance: state.balance });
  },
  deposit(amount) {
    const value = round2(amount);
    if (value <= 0) return;
    state.balance = round2(state.balance + value);
    state.deposits.push({ amount: value, at: Date.now() });
    save();
    refreshBalance(true);
    emit('wallet:change', { balance: state.balance });
  },
};

const XP_PER_LEVEL = 500;

export function levelInfo(xp = state.profile.xp) {
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const current = xp % XP_PER_LEVEL;
  return { level, current, max: XP_PER_LEVEL, progress: (current / XP_PER_LEVEL) * 100 };
}

/* ---------------- bet journal ---------------- */
let betSeq = 0;

/**
 * @param {{game:string, bet:number, payout:number, multiplier:number, outcome:'win'|'lose', detail?:string}} entry
 */
export function recordBet(entry) {
  const bet = round2(entry.bet);
  const payout = round2(entry.payout || 0);
  const profit = round2(payout - bet);
  const s = state.stats;

  state.history.unshift({
    id: `${Date.now().toString(36)}-${(betSeq++).toString(36)}`,
    game: entry.game,
    bet,
    payout,
    profit,
    multiplier: Number(entry.multiplier ?? 0),
    outcome: entry.outcome,
    detail: entry.detail || '',
    at: Date.now(),
  });
  if (state.history.length > 250) state.history.length = 250;

  s.bets += 1;
  s.wagered = round2(s.wagered + bet);
  s.won = round2(s.won + payout);
  if (payout > bet) s.wins += 1;
  if (profit > 0) s.biggestWin = Math.max(s.biggestWin, profit);
  s.bestMultiplier = Math.max(s.bestMultiplier, Number(entry.multiplier || 0));
  state.profile.xp = Math.round(state.profile.xp + Math.max(2, bet * 0.6));

  save();
  refreshStats();
  emit('bets:change', state.history[0]);
  return state.history[0];
}

/* ---------------- provably fair ---------------- */
const encoder = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  if (!crypto?.subtle) return simpleHash(text);
  try {
    return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  } catch {
    return simpleHash(text);
  }
}

/* Fallback déterministe si SubtleCrypto est indisponible (ex: contexte non sécurisé) */
function simpleHash(text) {
  const seeds = [0x811c9dc5, 0x1b873593, 0x85ebca6b, 0xc2b2ae35];
  let out = '';
  for (let s = 0; s < 4; s++) {
    let h = seeds[s] >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i) + s;
      h = Math.imul(h, 16777619) >>> 0;
      h ^= h >>> 13;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out.repeat(2);
}

export const fair = {
  get clientSeed() { return state.fair.clientSeed; },
  get nonce() { return state.fair.nonce; },
  get serverSeedHash() { return state.fair.serverSeedHash; },

  async ensureHash() {
    if (!state.fair.serverSeedHash) {
      state.fair.serverSeedHash = await sha256Hex(state.fair.serverSeed);
      save();
    }
    return state.fair.serverSeedHash;
  },

  /** Renvoie `count` flottants [0,1) déterministes pour un nonce unique. */
  async round(count = 1) {
    const f = state.fair;
    let hashed = await sha256Hex(`${f.serverSeed}:${f.clientSeed}:${f.nonce}`);
    f.nonce += 1;
    save();

    const out = [];
    while (out.length < count) {
      for (let i = 0; i + 8 <= hashed.length && out.length < count; i += 8) {
        out.push(parseInt(hashed.slice(i, i + 8), 16) / 0x100000000);
      }
      hashed = await sha256Hex(hashed);
    }
    return out;
  },

  setClientSeed(seed) {
    state.fair.clientSeed = String(seed || '').trim().slice(0, 64) || randHex(8);
    state.fair.nonce = 0;
    save();
    emit('fair:change');
  },

  async rotate() {
    state.fair.revealedSeed = state.fair.serverSeed;
    state.fair.serverSeed = randHex(32);
    state.fair.serverSeedHash = await sha256Hex(state.fair.serverSeed);
    state.fair.nonce = 0;
    save();
    emit('fair:change');
    return state.fair.revealedSeed;
  },
};

/* ---------------- sound (WebAudio, no assets) ---------------- */
let audioCtx = null;
export function sfx(kind = 'click') {
  if (!state.settings.sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const make = (freq, dur, type = 'sine', gain = 0.05, slide = null) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, now + dur);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    };

    const noise = (dur = 0.45, gain = 0.14, from = 2200, to = 90) => {
      const buffer = audioCtx.createBuffer(1, Math.max(1, Math.floor(audioCtx.sampleRate * dur)), audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(from, now);
      filter.frequency.exponentialRampToValueAtTime(to, now + dur);
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      src.connect(filter).connect(g).connect(audioCtx.destination);
      src.start(now);
    };

    switch (kind) {
      case 'click': make(520, 0.05, 'triangle', 0.035); break;
      case 'step': make(330, 0.12, 'sine', 0.04, 560); break;
      case 'win': make(660, 0.12, 'triangle', 0.05); setTimeout(() => make(990, 0.18, 'triangle', 0.045), 90); break;
      case 'lose': make(190, 0.22, 'sawtooth', 0.035, 90); break;
      case 'reveal': make(760, 0.07, 'triangle', 0.03, 980); break;
      case 'jingle':
        make(523, 0.1, 'triangle', 0.05);
        setTimeout(() => make(659, 0.1, 'triangle', 0.05), 90);
        setTimeout(() => make(784, 0.12, 'triangle', 0.05), 180);
        setTimeout(() => make(1046, 0.22, 'triangle', 0.045), 280);
        break;
      case 'boom': noise(0.4, 0.16, 1500, 70); make(110, 0.38, 'sine', 0.09, 40); break;
      case 'crash': noise(0.6, 0.18, 2600, 90); make(90, 0.5, 'sine', 0.1, 35); break;
      case 'coin': make(880, 0.08, 'square', 0.03); setTimeout(() => make(1320, 0.1, 'square', 0.028), 70); break;
      case 'tick': make(720, 0.03, 'square', 0.02); break;
      case 'cashed': make(520, 0.1, 'sine', 0.05, 880); setTimeout(() => make(1040, 0.16, 'sine', 0.04), 80); break;
      default: make(520, 0.05, 'triangle', 0.03);
    }
  } catch { /* audio optionnel */ }
}

/* ---------------- toast ---------------- */
export function toast(message, type = 'info', iconName = null) {
  const stack = $('#toasts');
  if (!stack) return;
  const icons = { success: 'check', error: 'x', info: 'info' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon"><i data-lucide="${iconName || icons[type] || 'info'}"></i></span><span>${message}</span>`;
  stack.appendChild(el);
  refreshIcons(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

/* ---------------- confetti ---------------- */
export function confettiWin(strength = 1) {
  if (!state.settings.effects || typeof window.confetti !== 'function') return;
  const colors = ['#00e701', '#2ee6a8', '#a855f7', '#ec4899', '#ffffff'];
  const base = { colors, disableForReducedMotion: true, zIndex: 90 };
  window.confetti({ ...base, particleCount: Math.round(70 * strength), spread: 65, origin: { y: 0.7 }, startVelocity: 42 });
  setTimeout(() => {
    window.confetti({ ...base, particleCount: Math.round(40 * strength), angle: 60, spread: 55, origin: { x: 0, y: 0.75 } });
    window.confetti({ ...base, particleCount: Math.round(40 * strength), angle: 120, spread: 55, origin: { x: 1, y: 0.75 } });
  }, 160);
}

/* ---------------- modals ---------------- */
export function openModal(id) {
  const el = $(`#modal-${id}`);
  if (!el) return;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  emit('modal:open', id);
}

export function closeModal(id) {
  const el = $(`#modal-${id}`);
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal.open')) document.body.style.overflow = '';
  emit('modal:close', id);
}

/* ---------------- bet inputs ---------------- */
export function readBet(input) {
  const value = round2(parseFloat(input.value));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function setBet(input, value) {
  const max = Math.max(1, Math.floor(wallet.balance * 100) / 100);
  input.value = String(round2(clamp(value, 0.01, max)));
}

/** Câble les boutons ½ / 2× / MIN / MAX de chaque panneau de mise. */
export function enhanceBetPanels() {
  $$('[data-panel]').forEach((panel) => {
    const input = $('[data-bet-input]', panel);
    if (!input || panel.dataset.betReady) return;
    panel.dataset.betReady = '1';

    input.addEventListener('change', () => {
      const v = readBet(input);
      setBet(input, v || 1);
      emit('bet:change', readBet(input));
    });

    $$('[data-quick]', panel).forEach((btn) => {
      btn.addEventListener('click', () => {
        const current = readBet(input) || 1;
        const max = Math.max(1, Math.floor(wallet.balance * 100) / 100);
        switch (btn.dataset.quick) {
          case 'half': setBet(input, current / 2); break;
          case 'double': setBet(input, current * 2); break;
          case 'min': setBet(input, 1); break;
          case 'max': setBet(input, max); break;
          default: break;
        }
        sfx('click');
        emit('bet:change', readBet(input));
      });
    });
  });
}

/** Limite la saisie à la mise disponible et prévient l'utilisateur. */
export function validateBet(input) {
  const bet = readBet(input);
  if (!bet || bet <= 0) {
    toast('Entre une mise valide.', 'error');
    return 0;
  }
  if (bet < 1) {
    toast('La mise minimale est de 1 $.', 'error');
    return 0;
  }
  if (bet > wallet.balance) {
    toast('Solde insuffisant pour cette mise.', 'error');
    return 0;
  }
  return round2(bet);
}

/* ---------------- formatting for game labels ---------------- */
export const GAME_META = {
  chicken: { name: 'La Poule', icon: 'bird', color: 'text-neon-green', bg: 'rgba(0,231,1,.1)' },
  mines: { name: 'Mines', icon: 'bomb', color: 'text-neon-violet', bg: 'rgba(168,85,247,.14)' },
  crash: { name: 'Crash', icon: 'rocket', color: 'text-neon-pink', bg: 'rgba(236,72,153,.12)' },
  dice: { name: 'Dé', icon: 'dices', color: 'text-sky-400', bg: 'rgba(56,189,248,.12)' },
};
