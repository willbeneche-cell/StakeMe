/* =========================================================
   StakeMe — app controller
   Navigation, wallet UI, dépôt, live feed, historique.
   ========================================================= */

import {
  $, $$, state, save, saveNow, wallet, money, fmtX, timeAgo, round2, clamp,
  refreshBalance, refreshStats, refreshIcons, recordBet, fair,
  sfx, toast, confettiWin, openModal, closeModal, enhanceBetPanels,
  levelInfo, AVATARS, GAME_META, emit,
} from './core.js';

import chicken from './games/chicken.js';
import mines from './games/mines.js';
import crash from './games/crash.js';
import dice from './games/dice.js';

const games = { chicken, mines, crash, dice };

const PAGES = ['home', 'games', 'casino', 'history', 'profile'];
let currentPage = 'home';
let lastPage = 'home';
let currentGame = null;
let historyFilter = 'all';
let selectedAmount = 500;

/* =========================================================
   NAVIGATION
   ========================================================= */
function navigate(page) {
  if (!PAGES.includes(page)) page = 'home';
  leaveGame();
  lastPage = currentPage;
  currentPage = page;

  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${page}`)?.classList.remove('hidden');

  $$('[data-nav]').forEach((btn) => {
    if (!(btn.classList.contains('side-link') || btn.classList.contains('bottom-link'))) return;
    btn.classList.toggle('active', btn.dataset.nav === page);
  });

  window.scrollTo({ top: 0, behavior: 'auto' });

  if (page === 'history') renderHistory();
  if (page === 'profile') refreshProfileUI();
  if (page === 'home') { renderRecentActivity(); refreshStats(); }
}

function openGame(id) {
  const game = games[id];
  if (!game) return;
  if (currentGame === id) return;

  leaveGame();
  lastPage = currentPage;
  currentGame = id;

  $$('.view').forEach((v) => v.classList.add('hidden'));
  const view = $(`#game-${id}`);
  $$('.game-view').forEach((v) => v.classList.add('hidden'));
  view?.classList.remove('hidden');

  $$('[data-nav]').forEach((btn) => btn.classList.remove('active'));
  window.scrollTo({ top: 0, behavior: 'auto' });
  game.enter(view);
  updateLiveFeedPause(true);
  sfx('click');
}

function leaveGame() {
  if (!currentGame) return;
  games[currentGame]?.leave?.();
  currentGame = null;
  $$('.game-view').forEach((v) => v.classList.add('hidden'));
  updateLiveFeedPause(false);
}

/* =========================================================
   DEPOSIT
   ========================================================= */
function updateDepositPreview() {
  const custom = parseFloat($('#depositCustom')?.value);
  const amount = Number.isFinite(custom) && custom > 0 ? custom : selectedAmount;
  const preview = $('#depositPreview');
  if (preview) preview.textContent = money(round2(state.balance + amount));
  $('#depositSubmit')?.classList.toggle('opacity-50', !(amount >= 1));
}

function coinShower() {
  const layer = $('#coinShower');
  if (!layer) return;
  layer.innerHTML = '';
  for (let i = 0; i < 26; i++) {
    const coin = document.createElement('span');
    coin.className = 'coin';
    coin.textContent = '$';
    coin.style.left = `${Math.random() * 100}%`;
    coin.style.animationDelay = `${Math.random() * 0.45}s`;
    coin.style.animationDuration = `${0.9 + Math.random() * 0.9}s`;
    coin.style.opacity = `${0.6 + Math.random() * 0.4}`;
    layer.appendChild(coin);
  }
  setTimeout(() => { layer.innerHTML = ''; }, 2300);
}

function openDeposit() {
  selectedAmount = 500;
  const custom = $('#depositCustom');
  if (custom) custom.value = '';
  $$('.amount-tile').forEach((t) => t.classList.toggle('active', t.dataset.amount === '500'));
  updateDepositPreview();
  openModal('deposit');
  setTimeout(() => custom?.focus({ preventScroll: true }), 260);
}

function doDeposit() {
  const custom = parseFloat($('#depositCustom')?.value);
  const amount = Number.isFinite(custom) && custom > 0 ? round2(custom) : selectedAmount;

  if (!Number.isFinite(amount) || amount < 1) {
    toast('Montant invalide (minimum 1 $).', 'error');
    return;
  }
  if (amount > 100000) {
    toast('Maximum 100 000 $ par dépôt.', 'error');
    return;
  }

  wallet.deposit(amount);
  refreshProfileUI();
  coinShower();
  confettiWin(0.9);
  sfx('coin');
  toast(`+$${money(amount)} crédités sur ton solde.`, 'success', 'coins');
  closeModal('deposit');
}

/* =========================================================
   FAIRNESS
   ========================================================= */
async function refreshFairUI() {
  await fair.ensureHash();
  const hash = $('#fairHash');
  if (hash) hash.textContent = state.fair.serverSeedHash || '—';
  const client = $('#fairClientSeed');
  if (client && document.activeElement !== client) client.value = state.fair.clientSeed;
  const nonce = $('#fairNonce');
  if (nonce) nonce.textContent = String(state.fair.nonce);
  const revealed = $('#fairRevealed');
  if (revealed) revealed.textContent = state.fair.revealedSeed || '—';
  const profileSeed = $('#profileClientSeed');
  if (profileSeed) profileSeed.textContent = state.fair.clientSeed;
}

async function saveClientSeed() {
  const input = $('#fairClientSeed');
  fair.setClientSeed(input.value);
  await refreshFairUI();
  toast('Seed client enregistré. Nouveau cycle de nonce.', 'success', 'shield-check');
}

async function rotateSeed() {
  await fair.rotate();
  await refreshFairUI();
  toast('Seed serveur renouvelé. L’ancien seed est révélé.', 'success', 'refresh-cw');
}

/* =========================================================
   PROFILE
   ========================================================= */
function levelTitle(level) {
  if (level >= 12) return 'High roller';
  if (level >= 6) return 'Habitué';
  if (level >= 3) return 'Joueur';
  return 'Recrue';
}

function refreshProfileUI() {
  const { level, current, max, progress } = levelInfo();
  const name = state.profile.name || 'Guest';
  const avatar = state.profile.avatar || '🦊';

  ['heroName', 'sidebarName'].forEach((id) => { const el = $(`#${id}`); if (el) el.textContent = name; });
  const headerAvatar = $('#headerAvatar');
  const sidebarAvatar = $('#sidebarAvatar');
  const profileAvatar = $('#profileAvatar');
  if (headerAvatar) headerAvatar.textContent = avatar;
  if (sidebarAvatar) sidebarAvatar.textContent = avatar;
  if (profileAvatar) profileAvatar.textContent = avatar;

  const levelEls = ['profileLevel', 'sidebarLevel'];
  levelEls.forEach((id) => { const el = $(`#${id}`); if (el) el.textContent = String(level); });
  const xp = $('#profileXp'); if (xp) xp.textContent = String(current);
  const xpMax = $('#profileXpMax'); if (xpMax) xpMax.textContent = String(max);
  const bar = $('#xpBar'); if (bar) bar.style.width = `${clamp(progress, 2, 100)}%`;
  const lvlLabel = $('#profileLevelLabel');
  if (lvlLabel) lvlLabel.textContent = levelTitle(level);

  const nameInput = $('#profileName');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = name;
  const since = $('#memberSince');
  if (since) since.textContent = new Date(state.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const seed = $('#profileClientSeed');
  if (seed) seed.textContent = state.fair.clientSeed;

  const picker = $('#avatarPicker');
  if (picker) {
    picker.innerHTML = AVATARS.map(
      (a) => `<button class="avatar-opt ${a === avatar ? 'active' : ''}" data-avatar="${a}" aria-label="Avatar ${a}">${a}</button>`
    ).join('');
  }

  $('#prefSound') && ($('#prefSound').checked = state.settings.sound);
  $('#prefEffects') && ($('#prefEffects').checked = state.settings.effects);
}

function saveName() {
  const input = $('#profileName');
  const value = (input.value || '').trim().slice(0, 18);
  if (!value) { toast('Choisis un pseudo.', 'error'); return; }
  state.profile.name = value;
  save();
  refreshProfileUI();
  toast('Pseudo mis à jour.', 'success', 'check');
}

async function resetAccount() {
  const result = await Swal.fire({
    title: 'Réinitialiser le compte ?',
    html: 'Le solde repasse à <b>1 000 $</b>.<br>Historique, statistiques et seeds seront effacés.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Réinitialiser',
    cancelButtonText: 'Annuler',
    customClass: { popup: 'stake-swal' },
    buttonsStyling: false,
    reverseButtons: true,
    focusCancel: true,
  });
  if (!result.isConfirmed) return;

  const fresh = {
    balance: 1000,
    createdAt: Date.now(),
    profile: { name: 'Guest', avatar: '🦊', xp: 120 },
    stats: { wagered: 0, won: 0, bets: 0, wins: 0, biggestWin: 0, bestMultiplier: 0 },
    history: [],
    deposits: [],
    settings: { ...state.settings },
    fair: {
      serverSeed: randomHex(32),
      serverSeedHash: '',
      revealedSeed: '',
      clientSeed: randomHex(8),
      nonce: 0,
    },
  };
  Object.assign(state, fresh);
  saveNow();
  await fair.ensureHash();
  refreshBalance(false);
  refreshStats();
  refreshProfileUI();
  await refreshFairUI();
  renderHistory();
  renderRecentActivity();
  navigate('home');
  toast('Compte réinitialisé. Bon jeu !', 'success', 'rotate-ccw');
}

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* =========================================================
   HISTORY
   ========================================================= */
function historyRow(entry) {
  const meta = GAME_META[entry.game] || { name: entry.game, icon: 'dices', color: 'text-slate-300', bg: 'rgba(255,255,255,.05)' };
  const win = entry.payout > entry.bet;
  const detail = entry.detail ? ` · ${entry.detail}` : '';
  return `
    <div class="history-row">
      <span class="history-icon" style="background:${meta.bg}">
        <i data-lucide="${meta.icon}" class="${meta.color}"></i>
      </span>
      <div class="min-w-0 flex-1">
        <p class="history-game">${meta.name}</p>
        <p class="history-meta">${timeAgo(entry.at)}${detail}</p>
      </div>
      <div class="hidden text-right sm:block">
        <p class="history-meta">Mise</p>
        <p class="text-[12px] font-semibold tabular-nums text-slate-300">$${money(entry.bet)}</p>
      </div>
      <span class="mult-chip ${win ? 'win' : 'lose'}">${entry.outcome === 'win' ? fmtX(entry.multiplier) : 'Perdu'}</span>
      <div class="w-[76px] text-right">
        <p class="history-amount ${win ? 'text-neon-mint' : 'text-slate-400'}">${win ? '+' : '−'}$${money(Math.abs(round2(entry.payout - entry.bet)))}</p>
        <p class="history-meta">gain net</p>
      </div>
    </div>`;
}

function renderHistory() {
  const container = $('#historyList');
  if (!container) return;
  const rows = state.history.filter((e) => historyFilter === 'all' || e.game === historyFilter);

  if (!rows.length) {
    container.className = 'mt-3 card';
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="scroll-text"></i>
        <p>Aucun pari ${historyFilter === 'all' ? 'pour le moment' : 'sur ce jeu'}.</p>
        <button class="btn btn-ghost btn-sm mt-3" data-nav="games">Découvrir les mini-jeux</button>
      </div>`;
    refreshIcons(container);
    return;
  }

  container.className = 'mt-3 card overflow-hidden divide-y divide-white/[0.04]';
  container.innerHTML = rows
    .slice(0, 60)
    .map((e) => historyRow(e))
    .join('');
  refreshIcons(container);
}

function exportHistory() {
  if (!state.history.length) { toast('Rien à exporter pour le moment.', 'info'); return; }
  const payload = {
    exportedAt: new Date().toISOString(),
    balance: state.balance,
    stats: state.stats,
    bets: state.history,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stakeme-historique-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Historique exporté en JSON.', 'success', 'download');
}

function renderRecentActivity() {
  const box = $('#recentActivity');
  if (!box) return;
  const rows = state.history.slice(0, 4);
  if (!rows.length) {
    box.innerHTML = `
      <div class="empty-state !py-7">
        <i data-lucide="activity"></i>
        <p>Pas encore de mise. Lance ton premier jeu !</p>
      </div>`;
  } else {
    box.innerHTML = rows.map((e) => {
      const meta = GAME_META[e.game] || { name: e.game, icon: 'dices', color: 'text-slate-300' };
      const win = e.payout > e.bet;
      return `
        <div class="activity-row">
          <span class="history-icon !h-8 !w-8"><i data-lucide="${meta.icon}" class="${meta.color}"></i></span>
          <div class="min-w-0 flex-1">
            <p class="text-[12.5px] font-medium text-slate-200">${meta.name}</p>
            <p class="history-meta">${timeAgo(e.at)} · mise $${money(e.bet)}</p>
          </div>
          <span class="text-[12.5px] font-semibold tabular-nums ${win ? 'text-neon-mint' : 'text-slate-500'}">
            ${win ? '+' : '−'}$${money(Math.abs(round2(e.payout - e.bet)))}
          </span>
        </div>`;
    }).join('');
  }
  refreshIcons(box);
}

/* =========================================================
   LIVE FEED
   ========================================================= */
const FEED_PLAYERS = [
  ['0xLucky', '🦊'], ['NeonKing', '🐯'], ['Mika_777', '🐼'], ['stake_ghost', '👾'],
  ['RubyRoll', '🐲'], ['TomTom', '🐺'], ['Sativa', '🦉'], ['Lucas.B', '🦁'],
  ['MoonBoy', '🐼'], ['Kxrma', '👾'], ['Aya', '🦊'], ['Nox', '🐺'],
  ['BigSlick', '🐯'], ['Juju', '🦉'], ['Zer0', '🐲'], ['Pablo', '🦁'],
  ['Lina', '🐼'], ['Vortex', '👾'], ['Sam', '🦊'], ['Rico', '🐯'],
];

const FEED_GAMES = [
  ['chicken', 'La Poule'], ['mines', 'Mines'], ['crash', 'Crash'], ['dice', 'Dé'],
];

let feedTimer = null;
let feedPaused = false;

function pushFeedRow(instant = false) {
  const feed = $('#liveFeed');
  if (!feed) return;
  const [name, avatar] = FEED_PLAYERS[Math.floor(Math.random() * FEED_PLAYERS.length)];
  const [gameId, gameName] = FEED_GAMES[Math.floor(Math.random() * FEED_GAMES.length)];
  const bet = round2(1 + Math.pow(Math.random(), 1.8) * 180);
  const mult = round2(1.05 + Math.pow(Math.random(), 2.6) * 24);
  const win = round2(bet * mult);

  const row = document.createElement('div');
  row.className = 'feed-row';
  row.innerHTML = `
    <span class="feed-avatar">${avatar}</span>
    <div class="min-w-0 flex-1">
      <p class="feed-name truncate">${name}</p>
      <p class="feed-meta">${gameName} · ${fmtX(mult)} · $${money(bet)}</p>
    </div>
    <span class="feed-win">+$${money(win)}</span>`;

  if (instant) feed.appendChild(row);
  else feed.prepend(row);
  while (feed.children.length > 6) feed.lastElementChild.remove();
  if (instant) while (feed.children.length > 6) feed.firstElementChild.remove();
}

function startLiveFeed() {
  const feed = $('#liveFeed');
  if (!feed) return;
  feed.innerHTML = '';
  for (let i = 0; i < 5; i++) pushFeedRow(true);
  clearInterval(feedTimer);
  feedTimer = setInterval(() => {
    if (feedPaused || document.hidden) return;
    pushFeedRow(false);
  }, 2800 + Math.random() * 1600);
}

function updateLiveFeedPause(paused) {
  feedPaused = paused;
}

/* =========================================================
   SLOTS LOBBY (visuel)
   ========================================================= */
const SLOTS = [
  { name: 'Neon Fruits', glyph: '🍒', provider: 'StakeMe Originals', bg: 'linear-gradient(160deg,#3b1220,#160b14 70%)', accent: '#ec4899' },
  { name: 'Crypto Reels', glyph: '🪙', provider: 'BGaming', bg: 'linear-gradient(160deg,#3a2c08,#161006 70%)', accent: '#eab308' },
  { name: 'Midnight Rush', glyph: '🌙', provider: 'Pragmatic Play', bg: 'linear-gradient(160deg,#131c3d,#0a0f1f 70%)', accent: '#818cf8' },
  { name: 'Golden Bull', glyph: '🐂', provider: 'Hacksaw', bg: 'linear-gradient(160deg,#3d1a0a,#170b06 70%)', accent: '#f97316' },
  { name: 'Frost Fortune', glyph: '❄️', provider: 'NetEnt', bg: 'linear-gradient(160deg,#0d2f3d,#07141c 70%)', accent: '#38bdf8' },
  { name: 'Lucky Tiger', glyph: '🐯', provider: 'PG Soft', bg: 'linear-gradient(160deg,#3d2a08,#171006 70%)', accent: '#f59e0b' },
  { name: 'Rocket Reels', glyph: '🚀', provider: 'Nolimit City', bg: 'linear-gradient(160deg,#2c0f31,#120716 70%)', accent: '#a855f7' },
  { name: 'Sugar Vault', glyph: '🍭', provider: 'Push Gaming', bg: 'linear-gradient(160deg,#2b1030,#140818 70%)', accent: '#f472b6' },
];

function renderSlots() {
  const grid = $('#slotsGrid');
  if (!grid) return;
  grid.innerHTML = SLOTS.map((slot) => `
    <button class="slot-card group" data-slot="${slot.name}">
      <div class="slot-cover" style="background:${slot.bg}">
        <span class="slot-glyph">${slot.glyph}</span>
        <span class="absolute right-1.5 top-1.5 rounded-md border border-white/10 bg-black/35 px-1.5 py-0.5 text-[9px] font-semibold text-white/70">New</span>
      </div>
      <div class="slot-body">
        <p class="slot-name truncate">${slot.name}</p>
        <p class="slot-provider truncate">${slot.provider}</p>
      </div>
    </button>`).join('');
}

/* =========================================================
   GAME LOBBY FILTERS
   ========================================================= */
function filterGameCards(tag = 'all', query = '') {
  const q = query.trim().toLowerCase();
  $$('#gamesGrid .game-card').forEach((card) => {
    const tags = (card.dataset.tags || '').split(' ');
    const matchTag = tag === 'all' || tags.includes(tag);
    const matchQuery = !q || card.textContent.toLowerCase().includes(q);
    card.classList.toggle('hidden', !(matchTag && matchQuery));
  });
}

/* =========================================================
   GLOBAL WIRING
   ========================================================= */
function bindGlobal() {
  document.addEventListener('click', (ev) => {
    const nav = ev.target.closest('[data-nav]');
    if (nav) { navigate(nav.dataset.nav); return; }

    const gameBtn = ev.target.closest('[data-game]');
    if (gameBtn) { openGame(gameBtn.dataset.game); return; }

    if (ev.target.closest('[data-open-deposit]')) { openDeposit(); return; }
    if (ev.target.closest('[data-open-fair]')) { openModal('fair'); refreshFairUI(); return; }
    if (ev.target.closest('[data-back]')) { navigate(lastPage || 'home'); return; }

    const closer = ev.target.closest('[data-close]');
    if (closer) { closeModal(closer.dataset.close); return; }

    const amountTile = ev.target.closest('[data-amount]');
    if (amountTile) {
      selectedAmount = Number(amountTile.dataset.amount);
      $('#depositCustom').value = '';
      $$('.amount-tile').forEach((t) => t.classList.toggle('active', t === amountTile));
      updateDepositPreview();
      sfx('click');
      return;
    }

    const slot = ev.target.closest('[data-slot]');
    if (slot) {
      Swal.fire({
        title: slot.dataset.slot,
        html: 'Cette machine est décorative.<br>Les gains se jouent dans les <b>4 originals</b> StakeMe.',
        icon: 'info',
        confirmButtonText: 'Voir les originals',
        showCancelButton: true,
        cancelButtonText: 'Fermer',
        customClass: { popup: 'stake-swal' },
        buttonsStyling: false,
      }).then((r) => { if (r.isConfirmed) navigate('games'); });
      return;
    }

    const filter = ev.target.closest('[data-game-filter]');
    if (filter) {
      $$('[data-game-filter]').forEach((b) => b.classList.toggle('active', b === filter));
      filterGameCards(filter.dataset.gameFilter, $('#searchInput')?.value || '');
      return;
    }

    const hFilter = ev.target.closest('[data-history-filter]');
    if (hFilter) {
      historyFilter = hFilter.dataset.historyFilter;
      $$('[data-history-filter]').forEach((b) => b.classList.toggle('active', b === hFilter));
      renderHistory();
      return;
    }

    const avatar = ev.target.closest('[data-avatar]');
    if (avatar) {
      state.profile.avatar = avatar.dataset.avatar;
      save();
      refreshProfileUI();
      sfx('click');
      return;
    }
  });

  $('#depositCustom')?.addEventListener('input', updateDepositPreview);
  $('#depositSubmit')?.addEventListener('click', doDeposit);
  $('#exportHistory')?.addEventListener('click', exportHistory);
  $('#saveName')?.addEventListener('click', saveName);
  $('#profileName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });
  $('#resetAccount')?.addEventListener('click', resetAccount);

  $('#prefSound')?.addEventListener('change', (e) => {
    state.settings.sound = e.target.checked;
    save();
    if (e.target.checked) sfx('coin');
    toast(e.target.checked ? 'Sons activés.' : 'Sons coupés.', 'info');
  });
  $('#prefEffects')?.addEventListener('change', (e) => {
    state.settings.effects = e.target.checked;
    save();
    toast(e.target.checked ? 'Effets activés.' : 'Effets réduits.', 'info');
  });

  $('#fairSave')?.addEventListener('click', saveClientSeed);
  $('#fairRotate')?.addEventListener('click', rotateSeed);

  const search = $('#searchInput');
  search?.addEventListener('input', () => {
    if (search.value.trim()) {
      $$('[data-game-filter]').forEach((b) => b.classList.toggle('active', b.dataset.gameFilter === 'all'));
      filterGameCards('all', search.value);
    } else {
      const active = $('[data-game-filter].active');
      filterGameCards(active?.dataset.gameFilter || 'all', '');
    }
  });
  search?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { navigate('games'); search.blur(); }
    if (e.key === 'Escape') { search.value = ''; filterGameCards('all', ''); search.blur(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal.open').forEach((m) => closeModal(m.id.replace('modal-', '')));
    }
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      search?.focus();
    }
  });

  document.addEventListener('visibilitychange', () => {
    // Retour d'onglet : on resynchronise l'affichage du solde.
    if (!document.hidden) refreshBalance(false);
  });

  refreshBalance(false);
  refreshStats();
}

/* =========================================================
   BOOT
   ========================================================= */
async function boot() {
  await fair.ensureHash();
  bindGlobal();
  enhanceBetPanels();
  refreshProfileUI();
  refreshStats();
  refreshBalance(false);
  renderSlots();
  renderHistory();
  renderRecentActivity();
  renderLiveFeedPlaceholder();
  startLiveFeed();
  await refreshFairUI();
  refreshIcons();
  navigate('home');

  // La mise à jour du nom du héros se fait depuis le profil.
  emit('app:ready');
}

function renderLiveFeedPlaceholder() {
  const feed = $('#liveFeed');
  if (feed && !feed.children.length) pushFeedRow(true);
}

// Expose un petit handle pour le debug / tests manuels.
window.StakeMe = { navigate, openGame, state, refreshBalance, refreshStats, renderHistory, openDeposit };

boot().catch((err) => {
  console.error('[StakeMe] échec du démarrage', err);
  toast('Le casino n’a pas pu démarrer complètement.', 'error');
});
