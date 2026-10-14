import { esc, heroImg, itemImg, fmtClock, fmtNum, api, connect, Speaker } from './common.js';
import { mountOverlay, patch, patchList, layout } from './overlay-view.js';

const $ = (id) => document.getElementById(id);
const BRACKET_NAME = { 1: 'Herald', 2: 'Guardian', 3: 'Crusader', 4: 'Archon', 5: 'Legend', 6: 'Ancient', 7: 'Divine', 8: 'Immortal' };
const ATTR = { str: 'Styrke', agi: 'Smidighet', int: 'Intelligens', all: 'Universal' };

let state = null;
let status = null;
let settings = { role: 1, bracket: 5, voice: '', ttsRate: 1.05 };
let heroes = [];
let heroByName = new Map();
let pipUpdate = null;
const speaker = new Speaker('dotacoach.tts.dashboard', true);

function toast(msg, ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

// ---------------- Tabs ----------------
let activeTab = 'live';
function showTab(name) {
  activeTab = name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  for (const id of ['live', 'draft', 'meta', 'setup']) $(`tab-${id}`).classList.toggle('hidden', id !== name);
  if (name === 'draft') initDraft();
  if (name === 'meta') loadMeta();
  if (name === 'setup') renderSetup();
  try {
    localStorage.setItem('dotacoach.tab', name);
  } catch {
    // ignore
  }
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

// ---------------- Header controls ----------------
async function saveSettings(patchObj) {
  settings = await api('/api/settings', patchObj);
  Object.assign(speaker.settings, settings);
}

$('role').addEventListener('change', async (e) => {
  await saveSettings({ role: Number(e.target.value) });
  if (activeTab === 'draft') pushDraft();
  if (activeTab === 'meta') loadMeta(true);
});
$('bracket').addEventListener('change', async (e) => {
  await saveSettings({ bracket: Number(e.target.value) });
  if (activeTab === 'draft') pushDraft();
  if (activeTab === 'meta') loadMeta(true);
});

function renderTtsButton() {
  const b = $('tts');
  b.classList.toggle('on', speaker.enabled);
  b.textContent = !speaker.enabled ? '🔈 Tale av' : speaker.canSpeak() ? '🔊 Tale på' : '🔊 Klikk for å aktivere tale';
}
// Browsers only allow speech after the user has clicked somewhere on the page.
document.addEventListener('pointerdown', () => setTimeout(renderTtsButton, 0), { once: true });
$('tts').addEventListener('click', () => {
  speaker.setEnabled(!speaker.enabled);
  renderTtsButton();
  if (speaker.enabled) speaker.say('Tale er på');
});

$('popout').addEventListener('click', openPopout);

async function openPopout() {
  if (!('documentPictureInPicture' in window)) {
    window.open('overlay.html', 'dotacoach-overlay', 'width=380,height=560');
    toast('Nettleseren støtter ikke vinduer som alltid ligger øverst. Bruk Chrome eller Edge, eller start-overlay.bat.', 6000);
    return;
  }
  const pip = await documentPictureInPicture.requestWindow({ width: 370, height: 540 });
  for (const href of ['css/app.css', 'css/overlay.css']) {
    const link = pip.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL(href, location.href).href;
    pip.document.head.append(link);
  }
  pip.document.title = 'Dota Coach';
  pip.document.body.className = 'overlay-page';
  const root = pip.document.createElement('div');
  pip.document.body.append(root);
  pipUpdate = mountOverlay(root);
  pipUpdate(state, status);
  pip.addEventListener('pagehide', () => (pipUpdate = null));
}

// ---------------- Connection ----------------
function renderConn() {
  const el = $('conn');
  let cls = '';
  let text = 'Ingen kontakt med coach-serveren';
  if (status) {
    if (status.gsiConnected) {
      cls = 'on';
      text = state?.hero ? `${state.hero.dname} · ${state.phaseLabel}` : `Koblet til Dota 2 · ${state?.phaseLabel || ''}`;
    } else {
      cls = 'wait';
      text = status.everConnected ? 'Mistet kontakten med Dota 2' : 'Venter på Dota 2';
    }
  }
  patch(el, `<span class="dot ${cls}"></span><span>${esc(text)}</span>`);
}

connect({
  onState: (s) => {
    state = s;
    renderLive();
    renderConn();
    pipUpdate?.(state, status);
    speaker.handleTips(s.tips);
  },
  onStatus: (s) => {
    status = s;
    settings = { ...settings, ...s.settings };
    Object.assign(speaker.settings, s.settings || {});
    $('patch').textContent = s.patch ? `patch ${s.patch}` : '';
    if (document.activeElement !== $('role')) $('role').value = settings.role;
    if (document.activeElement !== $('bracket')) $('bracket').value = settings.bracket;
    renderConn();
    if (!state?.hero) renderLive();
    if (activeTab === 'setup') renderSetup();
    pipUpdate?.(state, status);
  },
  onConnection: (ok) => {
    if (!ok) {
      status = null;
      renderConn();
    }
  },
});

// ---------------- Live ----------------
function renderWaiting() {
  const connected = status?.gsiConnected;
  const phase = state?.phase;
  let big = '🎮';
  let title = 'Venter på Dota 2';
  let text = 'Start Dota 2, så kobler coachen seg til automatisk. Vil du se hvordan det ser ut? Kjør <code>demo.bat</code> (eller <code>npm run simulate</code>).';
  if (!status) {
    big = '🔌';
    title = 'Får ikke kontakt med coach-serveren';
    text = 'Sjekk at <code>start.bat</code> fortsatt kjører.';
  } else if (connected && phase === 'draft') {
    big = '🧠';
    title = 'Hero-valg pågår';
    text = 'Gå til <a href="#" data-goto="draft">Draft-hjelp</a> og legg inn fiendene. Da får du forslag til hero og items.';
  } else if (connected) {
    big = '✅';
    title = 'Koblet til Dota 2';
    text = 'Coachen er klar. Live-tipsene starter når du er i en kamp.';
  }
  const steps = !connected
    ? `<div class="steps">
        <div class="step ${status?.tokenIsDefault === false ? 'done' : ''}"><div>Kjør <code>setup.bat</code> én gang. Den legger inn GSI-konfigurasjonen i Dota-mappen.</div></div>
        <div class="step"><div>Legg til <code>-gamestateintegration</code> under Startalternativer for Dota 2 i Steam.</div></div>
        <div class="step"><div>Start Dota 2. Statusen øverst blir grønn.</div></div>
      </div>`
    : '';
  patch($('live-waiting'), `<div class="big">${big}</div><h2>${title}</h2><p class="muted">${text}</p>${steps}`);
}

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) {
    e.preventDefault();
    showTab(go.dataset.goto);
  }
});

function renderLive() {
  const live = !!state?.hero && !['menu', 'loading'].includes(state.phase);
  $('live-waiting').classList.toggle('hidden', live);
  $('live-game').classList.toggle('hidden', !live);
  if (!live) return renderWaiting();

  const s = state;
  const h = s.hero;
  const p = s.player;
  const day = s.daytime === null ? '' : s.daytime ? '☀️ Dag' : '🌙 Natt';
  const hero = layout($('c-hero'), 'hero', '<div class="portrait" data-p="img"></div><div data-p="info"></div><div class="statline" data-p="stats"></div>');
  hero('img').classList.toggle('dead', !h.alive);
  patch(hero('img'), heroImg(h.name, h.dname, 'lg'));
  patch(
    hero('info'),
    `<div class="hero-name">${esc(h.dname)} <span class="lvl">Nivå ${h.level ?? '?'}</span>${h.alive ? '' : `<span class="pill">💀 ${h.respawn}s</span>`}</div>
     <div class="meta-row"><span><b class="num">${esc(s.clockText)}</b>${s.paused ? ' ⏸' : ''}</span><span>${day}</span><span>${esc(s.phaseLabel)}</span>
       <span>${esc(s.roleLabel || '')}</span>${s.location ? `<span>📍 ${esc(s.location.label)}</span>` : ''}</div>`,
  );
  patch(
    hero('stats'),
    `<div class="stat"><div class="k">KDA</div><div class="v">${p.kills}/${p.deaths}/${p.assists}</div></div>
     <div class="stat"><div class="k">LH / DN</div><div class="v">${p.lastHits}<small> / ${p.denies}</small></div></div>
     <div class="stat"><div class="k">Gull</div><div class="v gold">${fmtNum(p.gold)}</div></div>
     <div class="stat"><div class="k">GPM</div><div class="v">${p.gpm}</div></div>
     <div class="stat"><div class="k">XPM</div><div class="v">${p.xpm}</div></div>`,
  );

  $('c-tipcount').textContent = s.tips.length ? `${s.tips.length} aktive` : '';
  if (s.tips.length) {
    patchList($('c-tips'), s.tips, (t) => t.key, (t) => `<div class="ico">${t.icon}</div><div>${esc(t.text)}</div>`, (t) => `tip ${t.level}`);
  } else patch($('c-tips'), '<div class="empty">✅ Ingenting som haster akkurat nå. Følg fokuset under.</div>');

  patch(
    $('c-focus'),
    `<h3>Fokus i denne fasen</h3>
     ${s.focus ? `<div class="focus-text"><span class="label-sm">Hva du bør gjøre</span>${esc(s.focus)}</div>` : ''}
     ${s.farm ? `<div class="focus-text"><span class="label-sm">Hvor du bør være / farme</span>${esc(s.farm)}</div>` : ''}`,
  );

  renderNext();
  renderBuild();
  renderSituational();
  renderTimers();
  renderPerf();
  renderEnemyTips();
}

function renderNext() {
  const s = state;
  const n = s.next;
  if (!n) {
    const msg =
      s.buildStatus === 'loading'
        ? '<span class="spinner"></span> Henter populær build for helten …'
        : s.buildStatus === 'none'
          ? 'Fant ingen build-data (OpenDota er utilgjengelig). Sjekk internett.'
          : 'Du har alle kjerne-itemene i builden. Kjøp situasjonsitems eller luksus-items.';
    return patch($('c-next'), `<h3>Neste item</h3><div class="muted">${msg}</div>`);
  }
  const have = Math.min(s.player.gold, n.remaining);
  const pct = n.remaining > 0 ? Math.round((have / n.remaining) * 100) : 100;
  const missing = Math.max(0, n.remaining - s.player.gold);
  const eta = missing > 0 && s.player.gpm > 0 ? ` · ca. ${Math.max(1, Math.round(missing / s.player.gpm))} min` : '';
  const box = layout(
    $('c-next'),
    'next',
    '<h3>Neste item <span class="right" data-p="full"></span></h3><div class="next-item"><span data-p="img"></span><div><div class="name" data-p="name"></div><div class="muted num" data-p="missing"></div><div class="bar" data-p="bar"><i></i></div></div></div>',
  );
  patch(box('full'), n.cost !== n.remaining ? `fullpris ${fmtNum(n.cost)} g` : '');
  patch(box('img'), itemImg(n.name, n.dname, 'lg'));
  patch(box('name'), esc(n.dname));
  patch(box('missing'), missing > 0 ? `Mangler ${fmtNum(missing)} gull${eta}` : '<span style="color:var(--green)">Du har råd. Kjøp nå!</span>');
  box('bar').classList.toggle('green', pct >= 100);
  box('bar').firstChild.style.width = `${pct}%`;
}

function buildItems(list, owned, next) {
  return list
    .map((it) => `<span class="item-chip ${owned.has(it.name) ? 'owned' : ''} ${next === it.name ? 'next' : ''}">${itemImg(it.name, it.dname, 'sm')}</span>`)
    .join('');
}

function renderBuild() {
  const b = state.build;
  if (!b) return patch($('c-build'), `<h3>Build</h3><div class="muted">${state.buildStatus === 'loading' ? '<span class="spinner"></span> Laster …' : 'Ingen build-data tilgjengelig.'}</div>`);
  const owned = new Set(b.owned);
  const next = state.next?.name;
  const row = (lbl, list) => (list?.length ? `<div class="build-row"><span class="lbl">${lbl}</span><div class="items">${buildItems(list, owned, next)}</div></div>` : '');
  patch(
    $('c-build'),
    `<h3>Populær build <span class="right faint">fra pro-kamper (OpenDota)</span></h3>
     ${row('Start', b.start)}${row('Tidlig', b.early)}${row('Mid', b.mid)}${row('Sent', b.late)}`,
  );
}

function renderSituational() {
  const list = state.situational || [];
  if (!state.enemies?.length) {
    return patch($('c-sit'), '<h3>Mot fiendelaget</h3><div class="muted">Legg inn fiendene under <a href="#" data-goto="draft">Draft-hjelp</a>, så får du item-råd mot akkurat dem.</div>');
  }
  patch(
    $('c-sit'),
    `<h3>Mot fiendelaget <span class="right">${state.enemies.map((e) => heroImg(e.name, e.dname, 'xs')).join(' ')}</span></h3>
     ${list.length ? list.map((x) => `<div class="sit ${x.owned ? 'owned' : ''}">${itemImg(x.item, x.dname)}<div><b>${esc(x.dname)}</b> <span class="faint num">${fmtNum(x.cost)} g</span>${x.owned ? ' ✓' : ''}<div class="why">${esc(x.why)}</div></div></div>`).join('') : '<div class="muted">Ingen spesielle items trengs mot dette laget. Følg builden.</div>'}`,
  );
}

function renderTimers() {
  const t = state.timers || [];
  patch(
    $('c-timers'),
    t.length
      ? t.map((x) => `<div class="timer ${x.in <= 30 ? 'soon' : ''}"><div class="k">${esc(x.label)}</div><div class="v">${fmtClock(x.in)}</div></div>`).join('')
      : '<div class="muted">Timerne starter når kampen begynner.</div>',
  );
}

function pctRow(label, value, display) {
  if (value == null) return '';
  const pct = Math.round(value * 100);
  const cls = pct >= 70 ? 'green' : pct >= 40 ? 'blue' : 'red';
  return `<div class="perf-row"><span class="muted">${label}</span><div class="bar ${cls}"><i style="width:${Math.max(3, pct)}%"></i></div><span class="num">${display}</span></div>`;
}

function renderPerf() {
  const pf = state.perf || {};
  const rows = [pctRow('GPM', pf.gpmPct, `${Math.round((pf.gpmPct ?? 0) * 100)}. pst`), pctRow('XPM', pf.xpmPct, `${Math.round((pf.xpmPct ?? 0) * 100)}. pst`), pctRow('LH/min', pf.lhPct, `${Math.round((pf.lhPct ?? 0) * 100)}. pst`)].join('');
  patch(
    $('c-perf'),
    `<h3>Prestasjon <span class="right faint">mot andre ${esc(state.hero.dname)}-spillere</span></h3>
     ${rows || '<div class="muted">Sammenligningen starter etter 10 minutter.</div>'}
     ${pf.lhAt10 != null ? `<div class="muted" style="margin-top:8px">Last hits ved 10:00: <b style="color:var(--text)">${pf.lhAt10}</b></div>` : ''}`,
  );
}

function renderEnemyTips() {
  const tips = state.enemyTips || [];
  $('c-enemy').classList.toggle('hidden', !tips.length);
  if (!tips.length) return patch($('c-enemy'), '');
  patch(
    $('c-enemy'),
    `<h3>Husk mot fiendene</h3>${tips.map((t) => `<div class="enemy-tip">${heroImg(t.hero, heroByName.get(t.hero)?.dname || t.hero, 'xs')}<span>${esc(t.text)}</span></div>`).join('')}`,
  );
}

// ---------------- Heroes ----------------
async function loadHeroes() {
  if (heroes.length) return;
  const data = await api('/api/heroes');
  heroes = data.heroes;
  heroByName = new Map(heroes.map((h) => [h.name, h]));
}

// ---------------- Draft ----------------
const draft = { enemies: [], allies: [], bans: [], mode: 'enemies' };
const LIMITS = { enemies: 5, allies: 4, bans: 10 };
const GROUP_LABEL = { enemies: ['Fiender', 'motstanderlaget'], allies: ['Ditt lag', 'lagkameratene'], bans: ['Bans', 'bannede heroes'] };
let draftReady = false;
let draftTimer = null;
let draftSeq = 0;

async function initDraft() {
  if (draftReady) return;
  draftReady = true;
  await loadHeroes();
  try {
    const saved = await api('/api/draft');
    draft.enemies = saved.enemies || [];
    draft.allies = saved.allies || [];
    draft.bans = saved.bans || [];
  } catch {
    // start empty
  }
  renderSlots();
  renderHeroGrid();
  pushDraft();
  $('hero-search').addEventListener('input', renderHeroGrid);
  $('hero-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = $('hero-grid').querySelector('.hero-btn:not(.taken):not(.hidden)');
    if (first) {
      addHero(first.dataset.hero);
      e.target.value = '';
      renderHeroGrid();
    }
  });
  $('draft-reset').addEventListener('click', () => {
    draft.enemies = [];
    draft.allies = [];
    draft.bans = [];
    draft.mode = 'enemies';
    renderSlots();
    renderHeroGrid();
    pushDraft();
  });
}

function renderSlots() {
  const html = ['enemies', 'allies', 'bans']
    .map((g) => {
      const list = draft[g];
      const empty = Math.max(0, Math.min(LIMITS[g], g === 'bans' ? Math.max(list.length + 1, 3) : LIMITS[g]) - list.length);
      return `<div class="slot-row ${draft.mode === g ? 'active' : ''}" data-group="${g}">
        <div class="lbl">${GROUP_LABEL[g][0]}<small>${list.length}/${LIMITS[g]}</small></div>
        <div class="slot-list">${list.map((n) => `<span class="slot-hero" data-remove="${g}:${n}">${heroImg(n, heroByName.get(n)?.dname)}</span>`).join('')}${'<span class="slot"></span>'.repeat(empty)}</div>
      </div>`;
    })
    .join('');
  $('draft-slots').innerHTML = `${html}<div class="muted" style="font-size:12.5px">Klikk på en rad for å velge hvor heroene havner, og klikk deretter på heroene under. Klikk på en valgt hero for å fjerne den.</div>`;
}

$('draft-slots').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    const [g, n] = rm.dataset.remove.split(':');
    draft[g] = draft[g].filter((x) => x !== n);
    renderSlots();
    renderHeroGrid();
    pushDraft();
    return;
  }
  const row = e.target.closest('[data-group]');
  if (row) {
    draft.mode = row.dataset.group;
    renderSlots();
  }
});

function addHero(name) {
  const g = draft.mode;
  if (draft[g].includes(name)) return;
  if (draft[g].length >= LIMITS[g]) {
    toast(`${GROUP_LABEL[g][0]} er full. Fjern en hero først, eller velg en annen rad.`);
    return;
  }
  draft[g].push(name);
  if (g === 'enemies' && draft.enemies.length === LIMITS.enemies) draft.mode = 'allies';
  renderSlots();
  renderHeroGrid();
  pushDraft();
}

function renderHeroGrid() {
  const q = $('hero-search').value.trim().toLowerCase();
  const taken = new Set([...draft.enemies, ...draft.allies, ...draft.bans]);
  const groups = { str: [], agi: [], int: [], all: [] };
  for (const h of heroes) (groups[h.attr] || groups.all).push(h);
  $('hero-grid').innerHTML = Object.entries(groups)
    .map(([attr, list]) => {
      const visible = list.filter((h) => !q || h.dname.toLowerCase().includes(q) || h.name.includes(q));
      if (!visible.length) return '';
      return `<div class="attr-group"><h4>${ATTR[attr]}</h4><div class="hero-grid">${visible
        .map((h) => `<button class="hero-btn ${taken.has(h.name) ? 'taken' : ''}" data-hero="${h.name}" title="${esc(h.dname)}">${heroImg(h.name, h.dname)}<span class="nm">${esc(h.dname)}</span></button>`)
        .join('')}</div></div>`;
    })
    .join('');
}

$('hero-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.hero-btn');
  if (b) addHero(b.dataset.hero);
});

function pushDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    const seq = ++draftSeq;
    if (draft.enemies.length) patch($('draft-results'), `<div class="card"><span class="spinner"></span> Regner ut forslag … (første gang kan ta noen sekunder)</div>`);
    try {
      const res = await api('/api/draft', { enemies: draft.enemies, allies: draft.allies, bans: draft.bans, role: settings.role, bracket: settings.bracket });
      if (seq === draftSeq) renderSuggestions(res.suggestions);
    } catch (err) {
      if (seq === draftSeq) patch($('draft-results'), `<div class="card"><div class="notice warn">Klarte ikke å regne ut forslag: ${esc(err.message)}</div></div>`);
    }
  }, 200);
}

const fmtAdv = (a) => `${a > 0 ? '+' : '−'}${Math.abs(a).toFixed(1)} %`;

function renderSuggestions(sg) {
  const notices = [];
  if (!sg.hasStats) notices.push('<div class="notice warn">Får ikke hentet meta fra OpenDota akkurat nå. Forslagene bygger bare på det som er lagret lokalt.</div>');
  if (!draft.enemies.length) notices.push('<div class="notice">Legg inn fiendene, så blir forslagene tilpasset dem (counters). Til nå er listen sortert etter meta for din rolle og rank.</div>');
  else if (!sg.hasMatchups) notices.push('<div class="notice warn">Matchup-data er ikke tilgjengelig ennå. Forslagene bygger på meta.</div>');

  const rows = sg.picks
    .map((r) => {
      const why = [];
      if (r.good.length) why.push(`<span class="pos">Sterk mot ${r.good.map((g) => `${esc(g.dname)} ${fmtAdv(g.adv)}`).join(', ')}</span>`);
      if (r.bad.length) why.push(`<span class="neg">Svak mot ${r.bad.map((g) => `${esc(g.dname)} ${fmtAdv(g.adv)}`).join(', ')}</span>`);
      if (r.winrate != null) why.push(`${(r.winrate * 100).toFixed(1)} % vinnerrate i ${BRACKET_NAME[settings.bracket]}`);
      return `<div class="sugg">${heroImg(r.name, r.dname)}
        <div><div class="name"><span class="tier ${r.tier}">${r.tier}</span> ${esc(r.dname)}</div><div class="why">${why.join(' · ')}</div></div>
        <div class="score" title="Samlet score (meta + counters)">${r.score > 0 ? '+' : ''}${r.score.toFixed(1)}</div></div>`;
    })
    .join('');

  const avoid = sg.avoid.length
    ? `<div class="card"><h3>Unngå mot dette laget</h3>${sg.avoid
        .map((r) => `<div class="sugg">${heroImg(r.name, r.dname)}<div><div class="name">${esc(r.dname)}</div><div class="why"><span class="neg">Svak mot ${r.bad.map((g) => `${esc(g.dname)} ${fmtAdv(g.adv)}`).join(', ')}</span></div></div><div class="score" style="color:var(--red)">${r.counter.toFixed(1)}</div></div>`)
        .join('')}</div>`
    : '';

  const sit = sg.situational.length
    ? `<div class="card"><h3>Items mot dette laget</h3>${sg.situational.map((x) => `<div class="sit">${itemImg(x.item, x.dname)}<div><b>${esc(x.dname)}</b><div class="why">${esc(x.why)}</div></div></div>`).join('')}</div>`
    : '';
  const tips = sg.enemyTips.length
    ? `<div class="card"><h3>Husk mot fiendene</h3>${sg.enemyTips.map((t) => `<div class="enemy-tip">${heroImg(t.hero, heroByName.get(t.hero)?.dname, 'xs')}<span>${esc(t.text)}</span></div>`).join('')}</div>`
    : '';

  patch(
    $('draft-results'),
    `<div class="card"><h3>Beste valg for deg <span class="right">Pos ${settings.role} · ${BRACKET_NAME[settings.bracket]}</span></h3>
      <div style="display:grid;gap:8px;margin-bottom:6px">${notices.join('')}</div>${rows || '<div class="muted">Ingen forslag.</div>'}</div>${avoid}${sit}${tips}`,
  );
}

// ---------------- Meta ----------------
let metaKey = '';
let metaSelected = null;
$('meta-role').addEventListener('change', () => loadMeta(true));

async function loadMeta(force) {
  await loadHeroes();
  const role = Number($('meta-role').value);
  const key = `${role}:${settings.bracket}`;
  if (!force && key === metaKey) return;
  metaKey = key;
  $('meta-table').innerHTML = '<span class="spinner"></span> Henter meta …';
  try {
    const data = await api(`/api/meta?role=${role}&bracket=${settings.bracket}`);
    if (key !== metaKey) return;
    const rows = data.rows.slice(0, 80);
    $('meta-table').innerHTML = `<div class="muted" style="margin-bottom:8px;font-size:12.5px">Vinnerrate og pick-rate i ${BRACKET_NAME[settings.bracket]} (offentlige kamper, OpenDota). Tier er relativ til de andre heroene i lista.</div>
      <table><thead><tr><th>Tier</th><th>Hero</th><th>Vinnerrate</th><th>Pick-rate</th><th>Posisjoner</th></tr></thead><tbody>${rows
        .map(
          (r) => `<tr data-hero="${r.name}" class="${metaSelected === r.name ? 'sel' : ''}"><td><span class="tier ${r.tier}">${r.tier}</span></td>
            <td class="hero-cell">${heroImg(r.name, r.dname, 'xs')}${esc(r.dname)}</td>
            <td class="num">${r.winrate != null ? (r.winrate * 100).toFixed(1) + ' %' : '–'}</td>
            <td class="num">${(r.pickrate * 100).toFixed(1)} %</td>
            <td><div class="pos-badges">${r.positions.map((p, i) => `<span class="${i === 0 ? 'main' : ''}">${p}</span>`).join('')}</div></td></tr>`,
        )
        .join('')}</tbody></table>`;
  } catch (err) {
    metaKey = '';
    $('meta-table').innerHTML = `<div class="notice warn">${esc(err.message)}</div>`;
  }
}

$('meta-table').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-hero]');
  if (!tr) return;
  metaSelected = tr.dataset.hero;
  document.querySelectorAll('#meta-table tr.sel').forEach((r) => r.classList.remove('sel'));
  tr.classList.add('sel');
  loadHeroBuild(metaSelected);
});

function popList(title, list) {
  if (!list?.length) return '';
  return `<div style="margin-top:12px"><span class="label-sm">${title}</span>${list
    .map((it) => `<div class="pop-item">${itemImg(it.name, it.dname, 'sm')}<div><div>${esc(it.dname)} <span class="faint num">${fmtNum(it.cost)} g</span></div><div class="bar blue"><i style="width:${it.pop}%"></i></div></div><span class="faint num">${it.pop} %</span></div>`)
    .join('')}</div>`;
}

async function loadHeroBuild(name) {
  const h = heroByName.get(name);
  $('meta-build').innerHTML = `<h3>Build</h3><span class="spinner"></span> Henter build for ${esc(h?.dname || name)} …`;
  try {
    const data = await api(`/api/hero/${name}`);
    if (metaSelected !== name) return;
    const b = data.build;
    const med = (k) => data.benchmarks?.[k]?.find((x) => x.percentile === 0.5)?.value;
    const top = (k) => data.benchmarks?.[k]?.find((x) => x.percentile === 0.9)?.value;
    const bench = data.benchmarks
      ? `<div class="statline" style="grid-column:auto;margin-top:12px">
          <div class="stat"><div class="k">GPM median</div><div class="v">${Math.round(med('gold_per_min') || 0)}<small> / topp 10 %: ${Math.round(top('gold_per_min') || 0)}</small></div></div>
          <div class="stat"><div class="k">LH/min median</div><div class="v">${(med('last_hits_per_min') || 0).toFixed(1)}<small> / ${(top('last_hits_per_min') || 0).toFixed(1)}</small></div></div>
        </div>`
      : '';
    $('meta-build').innerHTML = `<h3>Build <span class="right faint">populært i pro-kamper</span></h3>
      <div style="display:flex;gap:12px;align-items:center">${heroImg(name, h?.dname, 'lg')}<div><div class="hero-name">${esc(h?.dname || name)}</div>
      <div class="pos-badges" style="margin-top:6px">${(h?.positions || []).map((p, i) => `<span class="${i === 0 ? 'main' : ''}">Pos ${p}</span>`).join('')}</div></div></div>
      ${bench}
      ${b ? popList('Startitems', b.start) + popList('Tidlig (0–10 min)', b.early) + popList('Midgame (10–25 min)', b.mid) + popList('Lategame (25+ min)', b.late) : `<div class="notice warn" style="margin-top:12px">Ingen build-data: ${esc(data.error || 'ukjent feil')}</div>`}`;
  } catch (err) {
    $('meta-build').innerHTML = `<h3>Build</h3><div class="notice warn">${esc(err.message)}</div>`;
  }
}

// ---------------- Setup ----------------
function renderSetup() {
  const st = status;
  const ago = st?.lastGsiAt ? Math.round((Date.now() - st.lastGsiAt) / 1000) : null;
  const od = st?.opendota || {};
  const checks = [
    [st ? '✅' : '❌', st ? 'Coach-serveren kjører.' : 'Får ikke kontakt med coach-serveren. Start <code>start.bat</code>.'],
    [
      st?.gsiConnected ? '✅' : st?.everConnected ? '⚠️' : '⏳',
      st?.gsiConnected ? `Mottar data fra Dota 2 (sist for ${ago} s siden).` : st?.everConnected ? `Mistet kontakten med Dota 2 for ${ago} s siden.` : 'Har ikke mottatt data fra Dota 2 ennå. Følg stegene under og start Dota på nytt.',
    ],
    [
      od.fixtures ? '🧪' : od.online === true ? '✅' : od.online === false ? '⚠️' : '⏳',
      od.fixtures ? 'Bruker testdata (demo-modus).' : od.online === true ? 'OpenDota (meta og builds) er tilgjengelig.' : od.online === false ? `OpenDota svarer ikke (${esc(od.lastError || '')}). Bruker lagrede data hvis de finnes.` : 'Sjekker OpenDota …',
    ],
    [st?.tokenIsDefault ? 'ℹ️' : '✅', st?.tokenIsDefault ? 'Oppsettet er ikke kjørt ennå. Kjør <code>setup.bat</code> for å installere GSI-konfigurasjonen.' : 'GSI-konfigurasjonen er generert.'],
  ];
  $('setup-status').innerHTML = checks.map(([s, t]) => `<div class="check"><span class="st">${s}</span><div>${t}</div></div>`).join('');
  renderVoices();
}

function renderVoices() {
  const sel = $('voice');
  const voices = speaker.voices();
  const current = settings.voice || '';
  const opts = ['<option value="">Automatisk (norsk hvis tilgjengelig)</option>']
    .concat(
      voices
        .slice()
        .sort((a, b) => (/^(nb|no|nn)/i.test(b.lang) ? 1 : 0) - (/^(nb|no|nn)/i.test(a.lang) ? 1 : 0) || a.lang.localeCompare(b.lang))
        .map((v) => `<option value="${esc(v.name)}" ${v.name === current ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`),
    )
    .join('');
  if (sel._opts !== opts) {
    sel.innerHTML = opts;
    sel._opts = opts;
  }
  $('rate').value = settings.ttsRate || 1.05;
}
if (speaker.supported) speechSynthesis.addEventListener?.('voiceschanged', () => activeTab === 'setup' && renderVoices());
$('voice').addEventListener('change', (e) => saveSettings({ voice: e.target.value }));
$('rate').addEventListener('change', (e) => saveSettings({ ttsRate: Number(e.target.value) }));
$('voice-test').addEventListener('click', () => speaker.say('Du har råd til Black King Bar. Kjøp den nå!'));

// ---------------- Start ----------------
renderTtsButton();
renderLive();
api('/api/settings')
  .then((s) => {
    settings = { ...settings, ...s };
    Object.assign(speaker.settings, s);
    $('role').value = settings.role;
    $('bracket').value = settings.bracket;
  })
  .catch(() => {});
loadHeroes().catch(() => {});
try {
  const t = localStorage.getItem('dotacoach.tab');
  if (t && t !== 'live') showTab(t);
} catch {
  // ignore
}
