import { esc, heroImg, itemImg, abilityImg, skillImg, fmtClock, fmtNum, api, connect, Speaker, throttle } from './common.js';
import { mountOverlay, patch, patchList, layout } from './overlay-view.js';
import { lineChart, deathMap, scoreColumns } from './charts.js';

const $ = (id) => document.getElementById(id);
const BRACKET_NAME = { 1: 'Herald', 2: 'Guardian', 3: 'Crusader', 4: 'Archon', 5: 'Legend', 6: 'Ancient', 7: 'Divine', 8: 'Immortal' };
const ATTR = { str: 'Styrke', agi: 'Smidighet', int: 'Intelligens', all: 'Universal' };
const ROLE_NAME = { 1: 'pos 1 (carry)', 2: 'pos 2 (mid)', 3: 'pos 3 (offlane)', 4: 'pos 4 (soft support)', 5: 'pos 5 (hard support)' };

let state = null;
let status = null;
let settings = { role: 1, bracket: 5, voice: '', ttsRate: 1.05 };
let heroes = [];
let heroByName = new Map();
let pipUpdate = null;
let openReportId = null;
let update = null;
let knownVersion = null;
let updateRequested = false;
const speaker = new Speaker('dotacoach.tts.dashboard', true);

function toast(msg, ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

// ---------------- Navigation ----------------
const TAB_TITLE = { live: 'Live-coach', draft: 'Draft-hjelp', meta: 'Meta og builds', matches: 'Kamper og analyse', setup: 'Oppsett' };
let activeTab = 'live';
function showTab(name) {
  activeTab = name;
  document.querySelectorAll('.nav-item').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  for (const id of Object.keys(TAB_TITLE)) $(`tab-${id}`).classList.toggle('hidden', id !== name);
  $('page-title').textContent = TAB_TITLE[name];
  if (name === 'draft') initDraft();
  if (name === 'meta') loadMeta();
  if (name === 'setup') {
    renderSetup();
    renderUpdateCard();
  }
  if (name === 'matches') {
    $('new-report').classList.add('hidden');
    if (!openReportId) loadMatches();
  }
  try {
    localStorage.setItem('dotacoach.tab', name);
  } catch {
    // ignore
  }
}
document.querySelectorAll('.nav-item').forEach((t) =>
  t.addEventListener('click', () => {
    if (t.dataset.tab === 'matches') openReportId = null;
    showTab(t.dataset.tab);
  }),
);

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

// After an update the page reloads and the pop-out overlay closes; it needs a click to come back.
try {
  if (sessionStorage.getItem('dotacoach.reopenPip')) {
    sessionStorage.removeItem('dotacoach.reopenPip');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = 'Dota Coach ble oppdatert, og overlay-vinduet ble lukket. <button class="btn primary">⧉ Åpne overlay-vinduet igjen</button>';
    el.querySelector('button').addEventListener('click', () => {
      el.remove();
      openPopout();
    });
    document.body.append(el);
    setTimeout(() => el.remove(), 60000);
  }
} catch {}

async function openPopout() {
  if (!('documentPictureInPicture' in window)) {
    window.open('overlay.html', 'dotacoach-overlay', 'width=380,height=560');
    toast('Nettleseren støtter ikke vinduer som alltid ligger øverst. Bruk Chrome eller Edge, eller «Dota Coach.bat».', 6000);
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

const renderState = throttle(() => {
  renderLive();
  renderConn();
  pipUpdate?.(state, status);
});

connect({
  onState: (s) => {
    state = s;
    renderState();
    speaker.handleTips(s.tips);
    syncDraft(s.draft);
  },
  onStatus: (s) => {
    // A new version is running (after an update): load the new pages.
    if (knownVersion && s.version && s.version !== knownVersion) {
      // The pop-out overlay closes with the reload and needs a click to open again: remind the user.
      try {
        if (pipUpdate) sessionStorage.setItem('dotacoach.reopenPip', '1');
      } catch {}
      return location.reload();
    }
    knownVersion = knownVersion || s.version;
    // Dota only reads its GSI config at start-up: after the app asked for more data, say so once.
    if (s.gsiConfigUpdated && s.gsiConnected && !status?.gsiConnected) {
      try {
        if (!sessionStorage.getItem('dotacoach.gsiRestart')) {
          sessionStorage.setItem('dotacoach.gsiRestart', '1');
          toast('Coachen ber nå Dota om mer data (bl.a. nøytrale items). Start Dota på nytt når det passer, så kommer alt med.', 9000);
        }
      } catch {}
    }
    status = s;
    renderUpdate();
    settings = { ...settings, ...s.settings };
    Object.assign(speaker.settings, s.settings || {});
    $('patch').textContent = s.patch ? `patch ${s.patch}` : '';
    if (document.activeElement !== $('role')) $('role').value = settings.role;
    if (document.activeElement !== $('bracket')) $('bracket').value = settings.bracket;
    renderConn();
    if (draftReady) renderVisionLine();
    if (!state?.hero) renderLive();
    if (activeTab === 'setup') renderSetup();
    pipUpdate?.(state, status);
  },
  onReport: (summary) => {
    if (activeTab === 'matches' && openReportId === summary.matchId) return openReport(summary.matchId);
    if (activeTab === 'matches' && !openReportId) return loadMatches();
    $('new-report').classList.remove('hidden');
    toast(`Kampanalysen er klar: ${summary.hero?.dname || ''} fikk karakter ${summary.grade}. Se «Kamper».`, 7000);
    // Right after a match (not in the middle of one) jump straight to the report, like Blitz does.
    if (activeTab === 'live' && (!state || state.matchId === summary.matchId || ['post', 'menu'].includes(state.phase))) {
      openReportId = summary.matchId;
      showTab('matches');
      openReport(summary.matchId);
    }
  },
  onUpdate: (u) => {
    update = u;
    renderUpdate();
    if (activeTab === 'setup') renderUpdateCard();
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
    const dh = state?.draftHelp;
    text = dh?.picks?.length
      ? `${draftHelpIntro(dh)}${draftPicksHtml(dh.picks.slice(0, 5))}${dh.banPhase && dh.bans?.length ? `<div class="draft-sub">Foreslåtte bans</div>${draftPicksHtml(dh.bans.slice(0, 3), 'ban')}` : ''}<div style="margin-top:10px">Mer detaljer og manuell retting under <a href="#" data-goto="draft">Draft-hjelp</a>.</div>`
      : 'Gå til <a href="#" data-goto="draft">Draft-hjelp</a> og legg inn fiendene. Da får du forslag til hero og items.';
  } else if (connected) {
    big = '✅';
    title = 'Koblet til Dota 2';
    text = 'Coachen er klar. Live-tipsene starter når du er i en kamp.';
  }
  const steps = !connected
    ? `<div class="steps">
        <div class="step ${status?.tokenIsDefault === false ? 'done' : ''}"><div>Kjør <code>setup.bat</code> én gang. Den legger inn GSI-konfigurasjonen i Dota-mappen.</div></div>
        <div class="step"><div>Legg til <code>-gamestateintegration</code> under Startalternativer for Dota 2 i Steam.</div></div>
        <div class="step"><div>Start Dota 2. Statusen nede til venstre blir grønn.</div></div>
      </div>`
    : '';
  patch($('live-waiting'), `<div class="big">${big}</div><h2>${title}</h2><p class="muted">${text}</p>${steps}`);
}

const SRC_TEXT = { gsi: 'fra spillet', screen: 'fra skjermen', manual: 'lagt inn for hånd' };

function draftHelpIntro(dh) {
  const vs = dh.enemies?.length ? `mot ${(dh.enemyNames || dh.enemies).map(esc).join(', ')}` : 'etter meta (ingen fiender kjent ennå)';
  const who = dh.forTeam ? `Du har valgt ${esc(dh.ownHero?.dname || '')}. Forslag til lagkameratene` : `Beste valg for deg som ${esc(ROLE_NAME[settings.role] || `pos ${settings.role}`)}`;
  const src = dh.source ? ` <span class="src-pill ${esc(dh.source)}">Draften ${SRC_TEXT[dh.source] || ''}</span>` : '';
  const needs = dh.needsText ? `<div class="draft-needs">⚠️ ${esc(dh.needsText)}</div>` : '';
  return `${who} ${vs}:${src}${needs}`;
}

// A reason list from the server: [{ text, kind: 'pos' | 'neg' | 'info' }] (or plain strings for bans).
function reasonsHtml(r) {
  const list = (r.reasons || []).map((x) => (typeof x === 'string' ? { text: x } : x));
  if (!list.length) {
    if (r.good?.length) list.push({ text: `Sterk mot ${r.good.join(', ')}`, kind: 'pos' });
    if (r.bad?.length) list.push({ text: `Svak mot ${r.bad.join(', ')}`, kind: 'neg' });
  }
  if (r.winrate != null && list.length < 3) list.push({ text: `${(r.winrate * 100).toFixed(1)} % seier` });
  return list.map((x) => (x.kind === 'pos' || x.kind === 'neg' ? `<span class="${x.kind}">${esc(x.text)}</span>` : esc(x.text))).join(' · ');
}

function draftPicksHtml(picks, kind = '') {
  return `<div class="draft-picks">${picks
    .map((r) => `<div class="sugg ${kind}">${heroImg(r.name, r.dname)}<div><div class="name"><span class="tier ${esc(r.tier)}">${esc(r.tier)}</span> ${esc(r.dname)}</div><div class="why">${reasonsHtml(r)}</div></div></div>`)
    .join('')}</div>`;
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

  // The fight meter has its own card, so its tips are only read aloud here.
  const tips = s.tips.filter((t) => !t.id.startsWith('fight-'));
  $('c-tipcount').textContent = tips.length ? `${tips.length} aktive` : '';
  if (tips.length) {
    patchList($('c-tips'), tips, (t) => t.key, (t) => `<div class="ico">${t.icon}</div><div>${esc(t.text)}</div>`, (t) => `tip ${t.level}`);
  } else patch($('c-tips'), '<div class="empty">✅ Ingenting som haster akkurat nå. Følg fokuset under.</div>');

  patch(
    $('c-focus'),
    `<h3>Fokus i denne fasen</h3>
     ${s.focus ? `<div class="focus-text"><span class="label-sm">Hva du bør gjøre</span>${esc(s.focus)}</div>` : ''}
     ${s.farm ? `<div class="focus-text"><span class="label-sm">Hvor du bør være / farme</span>${esc(s.farm)}</div>` : ''}`,
  );

  renderFight();
  renderNext();
  renderSkills();
  renderNeutral();
  renderBuild();
  renderSituational();
  renderTimers();
  renderPerf();
  renderEnemyTips();
}

function renderFight() {
  const f = state.fight;
  const card = $('c-fight');
  if (state.phase === 'post') {
    card.className = 'card fight-card';
    return patch(card, `<div class="fm-label"><span class="fm-icon">🏁</span><div><div class="fm-word">KAMPEN ER OVER</div><div class="fm-sub">Analysen lages nå</div></div></div><div class="fm-headline">Rapporten med karakter, hva som gikk bra og hva du bør jobbe med dukker opp under «Kamper» om et øyeblikk.</div><div><button class="btn primary" data-goto="matches">📜 Gå til Kamper</button></div>`);
  }
  card.classList.toggle('hidden', !f);
  if (!f) return;
  card.className = `card fight-card ${f.level}`;
  const box = layout(
    card,
    'fight',
    `<div class="fm-label"><span class="fm-icon" data-p="icon"></span><div><div class="fm-word" data-p="word"></div><div class="fm-sub">Fight-meter</div></div></div>
     <div><div class="fm-headline" data-p="head"></div><div class="fm-gauge"><i data-p="marker"></i></div><div class="fm-scale"><span>Trekk deg</span><span>Farm</span><span>Nøytral</span><span>Press</span><span>Kjemp</span></div></div>
     <div class="fm-reasons" data-p="reasons"></div>`,
  );
  patch(box('icon'), f.icon);
  patch(box('word'), esc(f.label));
  patch(box('head'), esc(f.headline));
  box('marker').style.left = `${(f.score + 100) / 2}%`;
  patch(
    box('reasons'),
    f.reasons.length
      ? f.reasons.map((r) => `<div class="fm-reason"><b class="${r.delta > 0 ? 'pos' : 'neg'}">${r.delta > 0 ? '+' : '−'}${Math.abs(r.delta)}</b><span>${esc(r.text)}</span></div>`).join('')
      : '<div class="muted">Ingen sterke signaler akkurat nå.</div>',
  );
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

function renderSkills() {
  const sk = state.skills;
  const card = $('c-skills');
  card.classList.toggle('hidden', !sk);
  if (!sk) return patch(card, '');
  if (!sk.games) {
    const msg = {
      loading: '<span class="spinner"></span> Henter skill-builds fra pro-kamper …',
      none: 'Ingen pro-data for skill-rekkefølge på denne helten ennå.',
    }[state.skillsStatus] ||
      `Fant ingen skill-data for helten akkurat nå${state.skillsError ? ` (${esc(state.skillsError)})` : ''}. Prøver igjen om noen minutter.`;
    return patch(card, `<h3>Evner og talenter</h3><div class="muted">${msg}</div>`);
  }
  const n = sk.next;
  const nextHtml = n
    ? `<div class="next-skill">${skillImg(n, 'lg')}<div>
         <div class="name">${n.talent ? `Talent: ${esc(n.dname)}` : `${esc(n.dname)} <span class="faint">→ nivå ${n.toLevel}</span>`}</div>
         <div class="muted">${n.talent && n.reason ? `Anbefalt: ${esc(n.reason)}` : `${n.pct} % av pro-spillerne${n.exact ? ' med samme build' : ''} tar denne nå`}</div>
         ${n.alternatives?.length ? `<div class="alt muted">Ellers: ${n.alternatives.map((a) => `${esc(a.dname)} ${a.pct} %`).join(' · ')}</div>` : ''}
       </div></div>`
    : sk.unspent > 0
      ? `<div class="muted">Du har ${sk.unspent} ubrukt${sk.unspent > 1 ? 'e' : ''} poeng, men pro-kampene sier ikke noe sikkert om akkurat dette steget. Se rekkefølgen under.</div>`
      : '<div class="muted">Ingen ubrukte poeng. Du får neste råd når du går opp i nivå.</div>';
  const spent = sk.spent ?? Math.max(0, (state.hero?.level || 0) - (n ? 1 : 0));
  const strip = sk.typical?.length
    ? `<div class="subhead">Vanlig rekkefølge hos pro-spillere</div><div class="skill-strip">${sk.typical
        .map((t, i) => `<div class="st ${i < spent ? 'done' : i === spent ? 'now' : ''}" title="${esc(`${i + 1}: ${t.dname} (${t.pct} %)`)}">${skillImg(t, 'sm')}<span>${i + 1}</span></div>`)
        .join('')}</div>`
    : '';
  const t = sk.talent;
  const talent = t
    ? `<div class="subhead">Talent nivå ${t.level}${t.open ? ' – velg nå' : ' – snart'}</div>${t.options
        .map((o) => choiceRow('<span class="aimg sm talent">★</span>', o.dname, o.winPct != null ? `${o.winPct} % seier med dette` : '', o.pct, o.name === t.pick, false))
        .join('')}<div class="muted" style="font-size:12.5px;margin-top:6px">Anbefalt fordi: ${esc(t.reason)}.${t.hint ? ` ${esc(t.hint)}` : ''}</div>`
    : '';
  patch(card, `<h3>Evner og talenter <span class="right faint">${sk.games} pro-kamper</span></h3>${nextHtml}${talent}${strip}`);
}

function choiceRow(img, name, sub, pct, pick, taken) {
  return `<div class="choice ${taken ? 'taken' : pick ? 'pick' : ''}">${img}<div><div class="nm">${esc(name)}${taken ? '<span class="badge-taken">Valgt</span>' : pick ? '<span class="badge-pick">Anbefalt</span>' : ''}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}${pct != null ? `<div class="bar blue"><i style="width:${Math.max(2, pct)}%"></i></div>` : ''}</div><span class="pct">${pct != null ? `${pct} %` : ''}</span></div>`;
}

function renderNeutral() {
  const sk = state.skills;
  const card = $('c-neutral');
  const n = sk?.neutral;
  const pro = sk?.proNeutrals;
  card.classList.toggle('hidden', !n && !pro);
  if (n) {
    const arts = n.artifacts.map((a) => choiceRow(itemImg(a.name, a.dname, 'sm'), a.dname, [a.stats, a.winPct != null ? `${a.winPct} % seier` : ''].filter(Boolean).join(' · '), a.pct, a.name === n.pickArtifact, a.selected)).join('');
    const ench = n.enchantments.map((e) => choiceRow(itemImg(e.name, e.dname, 'sm'), e.dname, e.stats, null, e.name === n.pickEnchantment, e.selected)).join('');
    return patch(
      card,
      `<h3>Nøytralt item <span class="right faint">tier ${n.tier}${n.madstone != null ? ` · ${n.madstone} madstone` : ''}</span></h3>
       ${arts ? `<div class="subhead">Artefakt <span class="faint">(% = andel av pro-spillerne på helten)</span></div>${arts}` : ''}
       ${ench ? `<div class="subhead">Fortryllelse</div>${ench}` : ''}
       <div class="muted" style="font-size:12.5px;margin-top:6px">Artefakt: ${esc(n.artifactReason)}. Fortryllelse: ${esc(n.enchantmentReason)}.</div>`,
    );
  }
  if (pro) {
    const arts = (pro.items || [])
      .map((x, i) => choiceRow(itemImg(x.name, x.dname, 'sm'), x.dname, [x.stats, x.winPct != null ? `${x.winPct} % seier` : ''].filter(Boolean).join(' · '), x.pct, i === 0, false))
      .join('');
    const ench = (pro.enchantments || []).map((e, i) => choiceRow(itemImg(e.name, e.dname, 'sm'), e.dname, e.stats, null, i === 0, false)).join('');
    return patch(
      card,
      `<h3>Nøytrale items <span class="right faint">tier ${pro.tier}${pro.source === 'pro' ? ' · pro-spillere' : ''}</span></h3>
       ${arts ? `<div class="subhead">Beste artefakter for helten din${pro.source === 'pro' ? ' <span class="faint">(% = andel pro-spillere)</span>' : ''}</div>${arts}` : ''}
       ${ench ? `<div class="subhead">Fortryllelse</div>${ench}` : ''}
       <div class="muted" style="font-size:12.5px;margin-top:6px">${pro.source === 'pro' ? 'Artefaktene er sortert etter hva pro-spillere bruker.' : 'Sortert etter hva statsene gir helten og rollen din.'}${pro.enchantmentReason ? ` Fortryllelsen ${esc(pro.enchantmentReason)}.` : ''} Valgene fra spillet dukker opp her når du lager et nøytralt item.</div>`,
    );
  }
  patch(card, '');
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

// ---------------- Matches and post-game reports ----------------
const RESULT = { win: ['Seier', 'win'], loss: ['Tap', 'loss'], unknown: ['Ukjent', 'unknown'] };
const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};
const meterClass = (score) => (score >= 72 ? 'good' : score >= 60 ? 'ok' : score >= 45 ? 'warn' : 'bad');

async function loadMatches() {
  $('match-report').classList.add('hidden');
  const list = $('matches-list');
  list.classList.remove('hidden');
  list.innerHTML = '<div class="card"><span class="spinner"></span> Henter kamper …</div>';
  let data;
  try {
    data = await api('/api/matches');
  } catch (err) {
    list.innerHTML = `<div class="card"><div class="notice warn">${esc(err.message)}</div></div>`;
    return;
  }
  if (!data.matches.length) {
    list.innerHTML = `<div class="waiting"><div class="big">📜</div><h2>Ingen kamper analysert ennå</h2>
      <p class="muted">Spill en kamp med coachen åpen. Når kampen er ferdig får du en rapport med karakter, hva som gikk bra og dårlig, og hva du bør jobbe med. Vil du se et eksempel, kjør <code>demo.bat</code>.</p></div>`;
    return;
  }
  const tr = data.trends;
  const fmt1 = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toLocaleString('nb-NO'));
  const common = tr.common.length
    ? `<div style="margin-top:14px"><span class="label-sm">Det du oftest bør jobbe med</span><div class="tip-cards">${tr.common
        .map((c) => `<div class="tip-card"><div><b>${esc(c.title)} <span class="faint">(${c.count} av ${tr.games} kamper)</span></b><span class="muted">${esc(c.text)}</span></div></div>`)
        .join('')}</div></div>`
    : '<p class="muted" style="margin:14px 0 0">Ingen feil går igjen i flere kamper ennå. Bra!</p>';
  list.innerHTML = `<div class="grid matches-grid">
    <div class="col">
      <div class="card"><h3>Trend <span class="right faint">siste ${tr.games} kamper</span></h3>
        <div class="trend-stats">
          <div class="stat"><div class="k">Snittscore</div><div class="v">${tr.avgScore}</div></div>
          <div class="stat"><div class="k">Vinnerrate</div><div class="v">${tr.winrate == null ? '–' : `${Math.round(tr.winrate * 100)} %`}</div></div>
          <div class="stat"><div class="k">Dødsfall</div><div class="v">${fmt1(tr.avgDeaths)}</div></div>
          <div class="stat"><div class="k">LH ved 10</div><div class="v">${fmt1(tr.avgLhAt10)}</div></div>
        </div>
        <div style="margin-top:14px"><span class="label-sm">Score per kamp</span><div id="score-cols"></div></div>
        ${common}
      </div>
    </div>
    <div class="col"><div class="card"><h3>Kamphistorikk</h3>${data.matches
      .map((m) => {
        const [rt, rc] = RESULT[m.result] || RESULT.unknown;
        return `<div class="match-row" data-match="${esc(m.matchId)}">${heroImg(m.hero?.name, m.hero?.dname)}
          <span class="grade ${m.grade}">${m.grade}</span>
          <div><b>${esc(m.hero?.dname || '')}</b> <span class="result ${rc}">${rt}</span><div class="muted" style="font-size:12.5px">${fmtDate(m.date)} · ${fmtClock(m.duration)} · Pos ${m.role}</div></div>
          <div class="num" style="text-align:right">${m.kda.join('/')}<div class="muted" style="font-size:12px">KDA</div></div>
          <div class="num" style="text-align:right">${m.score}<div class="muted" style="font-size:12px">score</div></div></div>`;
      })
      .join('')}</div></div></div>`;
  scoreColumns($('score-cols'), tr.scores);
}

$('matches-list').addEventListener('click', (e) => {
  const row = e.target.closest('[data-match]');
  if (!row) return;
  openReportId = row.dataset.match;
  openReport(openReportId);
});

async function openReport(id) {
  $('matches-list').classList.add('hidden');
  const box = $('match-report');
  box.classList.remove('hidden');
  box.innerHTML = '<div class="card"><span class="spinner"></span> Laster rapport …</div>';
  let r;
  try {
    r = await api(`/api/matches/${encodeURIComponent(id)}`);
  } catch (err) {
    box.innerHTML = `<div class="card"><div class="notice warn">${esc(err.message)}</div></div>`;
    return;
  }
  renderReport(r);
}

// ---------------- Dota Plus-style details (parsed OpenDota match) ----------------
const DMG_WORD = { physical: 'fysisk', magical: 'magisk', pure: 'ren', unknown: 'ukjent' };
const n0 = (v) => Number(v) || 0;
const pctOf = (r) => `${n0(r.pct)} %`;
const valPct = (value, pct) => `<b>${fmtNum(n0(value))}</b><span class="faint">${n0(pct)} %</span>`;

// Horizontal bars, longest = the biggest row. name/text return escaped HTML.
function barList(rows, { name, value = (r) => r.value, text, cls = () => '', tip = () => '', sub = () => '' }) {
  const max = Math.max(1, ...rows.map((r) => n0(value(r))));
  return `<div class="hb-list">${rows
    .map(
      (r) => `<div class="hb" title="${esc(tip(r))}">
        <div class="hb-top"><span class="hb-name">${name(r)}</span><span class="hb-val num">${text(r)}</span></div>
        <div class="hb-bar"><i class="${esc(cls(r))}" style="width:${Math.max(1.5, (n0(value(r)) / max) * 100).toFixed(1)}%"></i></div>${sub(r)}</div>`,
    )
    .join('')}</div>`;
}

const dmgKey = (t) => (DMG_WORD[t] ? t : 'unknown');
const dmgTag = (t) => `<span class="dmg-tag"><i class="sw ${dmgKey(t)}"></i>${DMG_WORD[dmgKey(t)]}</span>`;
// Icon in a fixed-width slot, then the text (which may wrap), so every row's text lines up.
const nameCell = (icon, label) => `<span class="hb-ico" aria-hidden="true">${icon}</span><span class="hb-label">${label}</span>`;
const heroName = (r) => nameCell(heroImg(r.name, r.dname, 'xs'), esc(r.dname));
const unitName = (r) => (r.kind === 'hero' ? heroName(r) : nameCell(r.kind === 'roshan' ? '🐲' : r.kind === 'tower' ? '🏰' : '•', esc(r.dname)));

function sourceName(s, { showHero }) {
  const icon = s.kind === 'item' ? itemImg(s.key, s.dname, 'sm') : s.kind === 'ability' ? abilityImg(s.key, s.dname, 'sm') : s.kind === 'attack' ? '⚔' : '…';
  const who = showHero && s.heroDname ? ` <span class="faint">· ${esc(s.heroDname)}</span>` : '';
  return nameCell(icon, `${esc(s.dname)}${who}${s.kind === 'rest' ? '' : ` ${dmgTag(s.dmg)}`}`);
}

function sourceBars(block, { showHero }) {
  return barList(block.rows, {
    name: (s) => sourceName(s, { showHero }),
    text: (s) => valPct(s.value, s.pct),
    cls: (s) => (s.kind === 'rest' ? 'unknown' : dmgKey(s.dmg)),
    tip: (s) => `${s.dname}${s.heroDname ? ` (${s.heroDname})` : ''}: ${fmtNum(n0(s.value))} skade, ${pctOf(s)}${s.kind === 'rest' ? '' : `, ${DMG_WORD[dmgKey(s.dmg)]} skade`}`,
  });
}

function heroBars(block, what) {
  return barList(block.rows, {
    name: unitName,
    text: (r) => valPct(r.value, r.pct),
    cls: (r) => (r.kind === 'hero' ? 'amount' : 'unknown'),
    tip: (r) => `${r.dname}: ${fmtNum(n0(r.value))} ${what} (${pctOf(r)})`,
    sub: (r) => (r.parts?.length ? `<div class="hb-sub">${r.parts.map((p) => `${esc(p.dname)} ${fmtNum(n0(p.value))}`).join(' · ')}</div>` : ''),
  });
}

function countBars(block, unitWord) {
  return barList(block.rows, {
    name: unitName,
    value: (r) => r.count,
    text: (r) => `<b>${n0(r.count)}</b><span class="faint">${n0(r.count) === 1 ? unitWord[0] : unitWord[1]}</span>`,
    cls: () => 'amount',
    tip: (r) => `${r.dname}: ${n0(r.count)} ${n0(r.count) === 1 ? unitWord[0] : unitWord[1]}`,
  });
}

function reasonBars(block, cls) {
  return barList(block.rows, {
    name: (r) => `<span class="hb-label">${esc(r.label)}</span>`,
    text: (r) => valPct(r.value, r.pct),
    cls: () => cls,
    tip: (r) => `${r.label}: ${fmtNum(n0(r.value))} (${pctOf(r)})`,
  });
}

function dpBlock(title, right, body) {
  if (!body) return '';
  return `<section class="dp-block"><h4><span>${title}</span>${right ? `<span class="faint num">${right}</span>` : ''}</h4>${body}</section>`;
}

function dpGroup(title, blocks) {
  const html = blocks.filter(Boolean).join('');
  return html ? `<div class="dp-group"><div class="label-sm">${title}</div><div class="dp-grid">${html}</div></div>` : '';
}

function renderDetails(d, r) {
  const st = d.stats || {};
  const tiles = [];
  const tile = (k, v, s = '') => tiles.push(`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`);
  if (st.maxHit) tile('Største treff', fmtNum(n0(st.maxHit.value)), `${esc(st.maxHit.source?.dname || '')}${st.maxHit.target ? ` mot ${esc(st.maxHit.target.dname)}` : ''}`);
  if (st.stuns != null) tile('Stuns', `${n0(st.stuns).toLocaleString('nb-NO')}<small> s</small>`, 'på fiendene');
  if (st.teamfight != null) tile('Teamfights', `${Math.round(n0(st.teamfight) * 100)}<small> %</small>`, 'deltakelse');
  if (st.runes) tile('Runer', n0(st.runes.total), esc((st.runes.rows || []).map((x) => `${x.label} ${x.count}`).join(', ')));
  if (st.buybacks != null) tile('Buybacks', n0(st.buybacks));
  if (st.timeDead != null) tile('Tid død', fmtClock(st.timeDead), r.duration ? `${Math.round((n0(st.timeDead) / r.duration) * 100)} % av kampen` : '');
  if (st.lhAt10 != null) tile('LH / DN ved 10', `${n0(st.lhAt10)}<small> / ${n0(st.dnAt10)}</small>`);
  if (st.laneEfficiency != null) tile('Lane-effektivitet', `${n0(st.laneEfficiency)}<small> %</small>`);

  const types = d.damageTypes;
  const typeBody = types
    ? `<div class="stack-bar" role="img" aria-label="${esc(types.rows.map((t) => `${t.label} ${t.pct} %`).join(', '))}">${types.rows
        .map((t) => `<i class="${esc(t.key)}" style="flex-grow:${n0(t.value)}" title="${esc(`${t.label}: ${fmtNum(n0(t.value))} (${pctOf(t)})`)}"></i>`)
        .join('')}</div>
       <div class="stack-legend">${types.rows.map((t) => `<span><i class="sw ${esc(t.key)}"></i>${esc(t.label)} <b class="num">${n0(t.pct)} %</b></span>`).join('')}</div>`
    : '';

  const gold = d.gold;
  const goldBody = gold
    ? reasonBars(gold, 'gold') + (gold.lost || gold.buyback ? `<div class="hb-sub" style="margin-top:8px">Tapt ved dødsfall: ${fmtNum(n0(gold.lost))} · Brukt på buyback: ${fmtNum(n0(gold.buyback))}</div>` : '')
    : '';
  const uses = d.uses?.length
    ? barList(d.uses, {
        name: (u) => nameCell(u.kind === 'item' ? itemImg(u.key, u.dname, 'sm') : abilityImg(u.key, u.dname, 'sm'), esc(u.dname)),
        value: (u) => u.count,
        text: (u) => `<b>${n0(u.count)}</b><span class="faint">${n0(u.count) === 1 ? 'gang' : 'ganger'}</span>`,
        cls: () => 'amount',
        tip: (u) => `${u.dname}: brukt ${n0(u.count)} ${n0(u.count) === 1 ? 'gang' : 'ganger'}`,
      })
    : '';
  const buys = d.purchases?.length
    ? `<div class="dp-buys">${d.purchases.map((p) => `<div class="dp-buy" title="${esc(p.dname)}">${itemImg(p.name, p.dname)}<span class="num">${fmtClock(p.t)}</span></div>`).join('')}</div>`
    : '';

  return `<div class="card dp-card" style="margin-top:16px">
    <h3>📊 Detaljert statistikk (som Dota Plus) <span class="right faint">fra OpenDota-analysen av replayen</span></h3>
    ${d.insights?.length ? `<div class="tips dp-insights">${d.insights.map((i) => `<div class="tip warn"><div class="ico">💡</div><div><b>${esc(i.label)}:</b> ${esc(i.text)}</div></div>`).join('')}</div>` : ''}
    ${tiles.length ? `<div class="trend-stats dp-tiles">${tiles.join('')}</div>` : ''}
    ${dpGroup('Skade du tok', [
      d.damageTaken && dpBlock('Skade tatt fra helter', fmtNum(n0(d.damageTaken.total)), heroBars(d.damageTaken, 'skade')),
      d.damageTakenBy && dpBlock('Skade tatt fra evner/items', '', sourceBars(d.damageTakenBy, { showHero: true })),
      (types || d.killedBy) &&
        `<div class="col dp-col">${types ? dpBlock('Skadetype', '', typeBody) : ''}${d.killedBy ? dpBlock('Drept av', `${n0(d.killedBy.total)} dødsfall`, countBars(d.killedBy, ['gang', 'ganger'])) : ''}</div>`,
    ])}
    ${dpGroup('Skade du ga', [
      d.damageDealt && dpBlock('Skade gitt til helter', fmtNum(n0(d.damageDealt.total)), heroBars(d.damageDealt, 'skade')),
      d.damageDealtBy && dpBlock('Skade gitt med evner', '', sourceBars(d.damageDealtBy, { showHero: false })),
      d.kills && dpBlock('Du drepte', `${n0(d.kills.total)} kills`, countBars(d.kills, ['gang', 'ganger'])),
    ])}
    ${dpGroup('Gull, XP og bruk', [
      gold && dpBlock('Gullkilder', fmtNum(n0(gold.total)), goldBody),
      d.xp && dpBlock('XP-kilder', fmtNum(n0(d.xp.total)), reasonBars(d.xp, 'xp')),
      (uses || buys) && `<div class="col dp-col">${dpBlock('Mest brukte evner/items', '', uses)}${dpBlock('Nøkkelkjøp', '', buys)}</div>`,
    ])}
  </div>`;
}

const DETAILS_HINT =
  'Skade tatt fra hver helt og evne, skadetyper, gull- og XP-kilder, største treff og mer kommer når OpenDota har analysert replayen. Coachen ber om analysen etter kampen og henter den automatisk (vanligvis innen 5–30 min).';

function renderReport(r) {
  const [rt, rc] = RESULT[r.result] || RESULT.unknown;
  const st = r.stats;
  const pctTxt = (p) => (p == null ? '' : ` <span class="faint">(${Math.round(p * 100)}. pst)</span>`);
  const od = r.opendota;
  const odCard = od
    ? `<div class="card"><h3>Fra OpenDota <span class="right faint">${od.parsed ? 'full analyse' : 'grunndata'}</span></h3>
        <div class="trend-stats">
          ${od.heroDamage != null ? `<div class="stat"><div class="k">Hero damage</div><div class="v">${fmtNum(od.heroDamage)}<small> #${od.teamRank.heroDamage} på laget</small></div></div>` : ''}
          ${od.towerDamage != null ? `<div class="stat"><div class="k">Tårnskade</div><div class="v">${fmtNum(od.towerDamage)}<small> #${od.teamRank.towerDamage}</small></div></div>` : ''}
          ${od.netWorth != null ? `<div class="stat"><div class="k">Net worth</div><div class="v">${fmtNum(od.netWorth)}<small> #${od.teamRank.netWorth}</small></div></div>` : ''}
          ${od.obsPlaced != null ? `<div class="stat"><div class="k">Observers</div><div class="v">${od.obsPlaced}</div></div>` : ''}
        </div>
        <div class="list-check" style="margin-top:12px">${od.good.map((t) => `<div><span>✅</span><span>${esc(t)}</span></div>`).join('')}${od.bad.map((t) => `<div><span>⚠️</span><span>${esc(t)}</span></div>`).join('')}</div>
      </div>`
    : `<div class="card"><h3>Fra OpenDota</h3><p class="muted" style="margin:0 0 10px">Hero damage, tårnskade, wards og detaljert statistikk (som i Dota Plus) hentes fra OpenDota når kampen er tilgjengelig der (vanligvis 5–15 min etter kampen, og bare hvis «Expose Public Match Data» er på i Dota).</p><button class="btn" data-od-refresh>↻ Hent nå</button></div>`;
  const detailsCard = od?.details
    ? renderDetails(od.details, r)
    : od
      ? `<div class="card" style="margin-top:16px"><h3>📊 Detaljert statistikk (som Dota Plus)</h3><p class="muted" style="margin:0 0 10px">${esc(DETAILS_HINT)}</p><button class="btn" data-od-refresh>↻ Hent nå</button></div>`
      : '';

  $('match-report').innerHTML = `
    <div style="margin-bottom:14px"><button class="btn" id="report-back">← Alle kamper</button></div>
    <div class="card report-head">
      ${heroImg(r.hero?.name, r.hero?.dname, 'lg')}
      <div><div class="hero-name">${esc(r.hero?.dname || '')} <span class="result ${rc}">${rt}</span></div>
        <div class="meta-row"><span>Pos ${r.role}</span><span>${fmtClock(r.duration)}</span><span>${fmtDate(r.date)}</span><span>KDA <b>${st.kills}/${st.deaths}/${st.assists}</b></span><span>LH <b>${st.lastHits}</b></span><span>GPM <b>${st.gpm}</b>${pctTxt(st.gpmPct)}</span><span>XPM <b>${st.xpm}</b>${pctTxt(st.xpmPct)}</span>${st.kp != null ? `<span>Kill-deltakelse <b>${Math.round(st.kp * 100)} %</b></span>` : ''}</div></div>
      <div class="report-score"><div class="hero-figure">${r.score}<small>/100</small></div><span class="grade lg ${r.grade}">${r.grade}</span></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Karakter per område</h3><div class="cat-tiles">${r.categories
      .map((c) => `<div class="cat-tile"><div class="top"><span>${esc(c.label)}</span><span class="grade sm ${c.grade}">${c.grade}</span></div><div class="meter ${meterClass(c.score)}"><i style="width:${Math.max(3, c.score)}%"></i></div><div class="muted num" style="font-size:12px;margin-top:5px">${c.score}/100</div></div>`)
      .join('')}</div></div>
    <div class="grid report-cols" style="margin-top:16px">
      <div class="card"><h3>✅ Dette gikk bra</h3><div class="list-check">${r.good.length ? r.good.map((g) => `<div><span>✅</span><span>${esc(g.text)}</span></div>`).join('') : '<div class="muted">Ingen klare styrker denne gangen.</div>'}</div></div>
      <div class="card"><h3>⚠️ Dette kan bli bedre</h3><div class="list-check">${r.bad.length ? r.bad.map((g) => `<div><span>⚠️</span><span>${esc(g.text)}</span></div>`).join('') : '<div class="muted">Ingen store feil. Bra jobba!</div>'}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>🎯 Fokus til neste kamp</h3><div class="tip-cards">${r.tips.map((t) => `<div class="tip-card"><div><b>${esc(t.title)}</b><span class="muted">${esc(t.text)}</span></div></div>`).join('')}</div></div>
    <div class="grid report-cols" style="margin-top:16px">
      <div class="card"><h3>Last hits over tid</h3>${r.charts.lhTargetPerMin ? '<div class="legend"><span><i></i>Du</span><span><i class="ref"></i>Mål</span></div>' : ''}<div class="chart" id="ch-lh"></div></div>
      <div class="card"><h3>Gull i lomma (ubrukt)</h3><div class="legend"><span><i></i>Ubrukt gull</span><span><i class="ref"></i>Grense før du bør kjøpe</span></div><div class="chart" id="ch-gold"></div></div>
    </div>
    <div class="grid report-cols" style="margin-top:16px">
      <div class="card"><h3>Hvor du døde</h3>${r.deaths.length ? `<div id="death-map"></div><div class="list-check" style="margin-top:12px">${r.deaths.map((d) => `<div><span class="num">${d.n}.</span><span><b class="num">${fmtClock(d.t)}</b> ${esc(d.label || '')}${d.why.length ? ` <span class="muted">– ${esc(d.why.join(', '))}</span>` : ''}</span></div>`).join('')}</div>` : '<div class="muted">Du døde ikke i det hele tatt. Sterkt!</div>'}</div>
      <div class="col">
        <div class="card"><h3>Viktige øyeblikk</h3>${r.moments.length ? r.moments.map((m) => `<div class="moment"><span class="t">${fmtClock(m.t)}</span><span>${m.icon}</span><span>${esc(m.text)}</span></div>`).join('') : '<div class="muted">Ingen registrert.</div>'}</div>
        <div class="card"><h3>Item-timinger</h3>${r.items.length ? r.items.map((it) => `<div class="item-time">${itemImg(it.name, it.dname, 'sm')}<span>${esc(it.dname)}${it.expected ? ` <span class="faint">vanlig ca. ${fmtClock(it.expected)}</span>` : ''}</span><b class="num">${fmtClock(it.t)}</b></div>`).join('') : '<div class="muted">Ingen items registrert.</div>'}</div>
        ${odCard}
      </div>
    </div>
    ${detailsCard}`;

  if (r.charts.lh.length) {
    lineChart($('ch-lh'), {
      points: r.charts.lh,
      name: 'Last hits',
      ref: r.charts.lhTargetPerMin ? { name: 'Mål', at: (t) => Math.max(0, (r.charts.lhTargetPerMin * (t - 30)) / 60) } : null,
    });
  }
  if (r.charts.gold.length) {
    lineChart($('ch-gold'), { points: r.charts.gold, name: 'Ubrukt gull', ref: { name: 'Grense', at: () => r.charts.unspentLimit } });
  }
  if (r.deaths.length) deathMap($('death-map'), r.deaths, r.team);
  $('report-back').addEventListener('click', () => {
    openReportId = null;
    loadMatches();
  });
  for (const btn of $('match-report').querySelectorAll('[data-od-refresh]')) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Henter …';
      try {
        const res = await api(`/api/matches/${encodeURIComponent(r.matchId)}/opendota`, {});
        if (!res.found) toast('Kampen er ikke tilgjengelig på OpenDota ennå. Prøv igjen om noen minutter.');
        else {
          if (!res.report.opendota?.details) toast('OpenDota har ikke analysert replayen ennå. Prøv igjen om noen minutter.');
          return renderReport(res.report);
        }
      } catch (err) {
        toast(`Klarte ikke å hente: ${err.message}`);
      }
      btn.disabled = false;
      btn.textContent = '↻ Hent nå';
    });
  }
}

// ---------------- Heroes ----------------
async function loadHeroes() {
  if (heroes.length) return;
  const data = await api('/api/heroes');
  heroes = data.heroes;
  heroByName = new Map(heroes.map((h) => [h.name, h]));
}

// ---------------- Draft ----------------
const draft = { enemies: [], allies: [], bans: [], mode: 'enemies', auto: new Set(), removed: new Set(), autoAt: 0, rev: 0, sources: {}, source: null };
let draftInFlight = 0; // POSTs not answered yet: a state from the server may be older than the user's edit
const LIMITS = { enemies: 5, allies: 4, bans: 14 };
const GROUP_LABEL = { enemies: ['Fiender', 'motstanderlaget'], allies: ['Ditt lag', 'lagkameratene'], bans: ['Bans', 'bannede heroes'] };
let draftReady = false;
let draftTimer = null;
let draftSeq = 0;

async function initDraft() {
  if (draftReady) return;
  draftReady = true;
  await loadHeroes();
  try {
    applyServerDraft(await api('/api/draft'));
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
    draft.auto = new Set();
    draft.removed = new Set();
    draft.mode = 'enemies';
    draft.reset = true;
    renderSlots();
    renderHeroGrid();
    pushDraft();
  });
  $('vision-line').addEventListener('change', (e) => {
    if (e.target.matches('[data-vision-toggle]')) saveSettings({ vision: e.target.checked }).then(renderVisionLine);
  });
  $('vision-line').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-vision-debug]')) return;
    try {
      const r = await api('/api/vision/debug', {});
      toast(r.active ? 'Tar et skjermbilde av draften. Det lagres i mappen «debug» i Dota Coach-mappen.' : 'Desktop-appen kjører ikke, så det finnes ikke noe skjermbilde å ta.');
    } catch (err) {
      toast(err.message);
    }
  });
  renderVisionLine();
}

// The server's draft = what the user entered + what the desktop app recognised on screen.
function applyServerDraft(d) {
  if (!d) return;
  draft.enemies = d.enemies || [];
  draft.allies = d.allies || [];
  draft.bans = d.bans || [];
  draft.rev = d.rev || 0;
  draft.auto = new Set([...(d.autoEnemies || []), ...(d.autoAllies || []), ...(d.autoBans || [])]);
  draft.unassigned = d.unassigned || [];
  draft.team = d.team || null;
  draft.autoAt = d.autoAt || 0;
  // The state's copy of the draft has no sources: keep the last ones then.
  if (d.sources) draft.sources = d.sources;
  if ('source' in d) draft.source = d.source;
}

// Called on every state update: pick up changes made elsewhere (heroes recognised on screen, a new match,
// another window). Skipped while the user's own edit is on its way, so it can't undo that edit.
let suggestSeq = 0;
async function syncDraft(d) {
  if (!d || !draftReady || d.rev === draft.rev || draftTimer || draftInFlight) return;
  applyServerDraft(d);
  renderSlots();
  renderHeroGrid();
  renderVisionLine();
  fetchSuggestions();
}

// Asks for the suggestions for the draft as it is. While the server is still fetching matchups (`loading`), it
// asks again a few times so the list is refined without a click.
async function fetchSuggestions(retry = 0) {
  const seq = ++suggestSeq;
  try {
    const res = await api('/api/draft', { suggestOnly: true, role: settings.role, bracket: settings.bracket });
    if (seq !== suggestSeq || draftTimer || draftInFlight) return;
    if (res.draft && res.draft.rev === draft.rev) {
      applyServerDraft(res.draft); // with the sources of each hero
      renderSlots();
      renderVisionLine();
    }
    renderSuggestions(res.suggestions);
    refineLater(res.suggestions, retry);
  } catch {
    // the next change tries again
  }
}

let refineTimer = null;
function refineLater(sg, retry) {
  clearTimeout(refineTimer);
  if (sg?.loading && retry < 8) refineTimer = setTimeout(() => fetchSuggestions(retry + 1), 1500);
}

function renderVisionLine() {
  const el = $('vision-line');
  if (!el) return;
  const v = status?.vision;
  const unassigned = draft.unassigned?.length
    ? `<span class="muted">Gjenkjent: ${draft.unassigned.map((n) => esc(heroByName.get(n)?.dname || n)).join(', ')} – venter på å vite hvilket lag du er på.</span>`
    : '';
  const debugBtn = '<button class="btn" data-vision-debug>📸 Lagre skjermbilde</button>';
  const toggle = v?.active ? `<label class="switch"><input type="checkbox" data-vision-toggle ${settings.vision !== false ? 'checked' : ''}> Les draften fra skjermen</label>` : '';
  let html;
  const fromGame =
    draft.source === 'gsi' ? '<span class="pill src-pill gsi">🎮 Fra spillet</span><span class="muted">Dota sender draften direkte. Heroene merket SPILL kommer derfra.</span>' : '';
  if (fromGame) html = fromGame;
  else if (v?.active && settings.vision === false) html = '<span class="muted">Skjermlesing er slått av. Legg inn heroene selv, eller slå den på igjen.</span>';
  else if (!v?.active) html = '<span class="muted">Automatisk gjenkjenning av heroer krever desktop-appen (Dota Coach.bat). Her kan du også legge dem inn selv.</span>';
  else if (v.error || !v.ready) {
    html = `<span class="pill" style="background:rgba(230,160,40,.2)">⚠️ Gjenkjenning virker ikke ennå</span><span class="muted">${esc(v.error || 'Laster heltebildene …')} Legg inn heroene selv så lenge.</span>${debugBtn}`;
  } else {
    html = `<span class="pill" style="background:rgba(60,140,255,.18)">🤖 Automatisk</span><span class="muted">Desktop-appen leser heroene fra skjermen (merket AUTO). Feil hero? Klikk på den for å fjerne den.</span>${debugBtn}`;
    if (v.hint) html += `<span class="muted" style="color:var(--gold)">${esc(v.hint)}</span>`;
  }
  if (fromGame && v?.active) html += debugBtn;
  patch(el, html + toggle + unassigned);
}

// A hero in the draft, marked with where it came from: SPILL (Dota's own data), AUTO (the screen) or by hand.
function slotHero(g, n) {
  const auto = draft.auto.has(n);
  const src = auto ? (draft.sources?.[n] === 'gsi' ? 'gsi' : 'auto') : '';
  const title = src === 'gsi' ? 'Fra spillet (Dota) – klikk for å fjerne' : src ? 'Gjenkjent fra skjermen – klikk for å fjerne' : 'Klikk for å fjerne';
  return `<span class="slot-hero ${src}" data-remove="${g}:${n}" title="${title}">${heroImg(n, heroByName.get(n)?.dname)}</span>`;
}

function renderSlots() {
  const html = ['enemies', 'allies', 'bans']
    .map((g) => {
      const list = draft[g];
      const empty = Math.max(0, Math.min(LIMITS[g], g === 'bans' ? Math.max(list.length + 1, 3) : LIMITS[g]) - list.length);
      return `<div class="slot-row ${draft.mode === g ? 'active' : ''}" data-group="${g}">
        <div class="lbl">${GROUP_LABEL[g][0]}<small>${list.length}/${LIMITS[g]}</small></div>
        <div class="slot-list">${list.map((n) => slotHero(g, n)).join('')}${'<span class="slot"></span>'.repeat(empty)}</div>
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
    if (draft.auto.has(n)) {
      draft.auto.delete(n);
      draft.removed.add(n);
    }
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
  // A newer edit makes every answer still on its way stale.
  const seq = ++draftSeq;
  suggestSeq++;
  draftTimer = setTimeout(async () => {
    if (draft.enemies.length) patch($('draft-results'), `<div class="card"><span class="spinner"></span> Regner ut forslag … (første gang kan ta noen sekunder)</div>`);
    const body = { enemies: draft.enemies, allies: draft.allies, bans: draft.bans, removed: [...draft.removed], reset: !!draft.reset, role: settings.role, bracket: settings.bracket };
    try {
      draft.removed = new Set();
      draft.reset = false;
      draftTimer = null;
      draftInFlight++;
      let res;
      try {
        res = await api('/api/draft', body);
      } finally {
        draftInFlight--;
      }
      if (seq === draftSeq) {
        applyServerDraft(res.draft);
        renderSlots();
        renderHeroGrid();
        renderVisionLine();
        renderSuggestions(res.suggestions);
        refineLater(res.suggestions, 0);
      }
    } catch (err) {
      for (const n of body.removed) draft.removed.add(n); // send the removals again with the next change
      if (seq === draftSeq) patch($('draft-results'), `<div class="card"><div class="notice warn">Klarte ikke å regne ut forslag: ${esc(err.message)}</div></div>`);
    }
  }, 200);
}

const fmtAdv = (a) => `${a > 0 ? '+' : '−'}${Math.abs(a).toFixed(1)} %`;

function renderSuggestions(sg) {
  const notices = [];
  if (!sg.hasStats) notices.push('<div class="notice warn">Får ikke hentet meta fra OpenDota akkurat nå. Forslagene bygger bare på det som er lagret lokalt.</div>');
  if (!draft.enemies.length) notices.push('<div class="notice">Legg inn fiendene, så blir forslagene tilpasset dem (counters). Til nå er listen sortert etter meta for din rolle og rank, laget ditt og bans.</div>');
  else if (!sg.hasMatchups) notices.push(`<div class="notice warn">${sg.loading ? '<span class="spinner"></span> Henter matchup-data …' : 'Matchup-data er ikke tilgjengelig ennå.'} Forslagene bygger på meta så lenge.</div>`);
  if (sg.needsText) notices.push(`<div class="draft-needs">⚠️ ${esc(sg.needsText)}</div>`);

  const rows = sg.picks
    .map((r) => {
      const why = [];
      if (r.good.length) why.push(`<span class="pos">Sterk mot ${r.good.map((g) => `${esc(g.dname)} ${fmtAdv(g.adv)}`).join(', ')}</span>`);
      for (const x of r.synergy || []) why.push(`<span class="pos">Kombo med ${esc(x.dname)}: ${esc(x.why)}</span>`);
      for (const x of (r.reasons || []).filter((x) => x.text.startsWith('Gir laget'))) why.push(`<span class="pos">${esc(x.text)}</span>`);
      if (r.bad.length) why.push(`<span class="neg">Svak mot ${r.bad.map((g) => `${esc(g.dname)} ${fmtAdv(g.adv)}`).join(', ')}</span>`);
      if (r.winrate != null) why.push(`${(r.winrate * 100).toFixed(1)} % vinnerrate i ${BRACKET_NAME[settings.bracket]}`);
      return `<div class="sugg">${heroImg(r.name, r.dname)}
        <div><div class="name"><span class="tier ${esc(r.tier)}">${esc(r.tier)}</span> ${esc(r.dname)}</div><div class="why">${why.join(' · ')}</div></div>
        <div class="score" title="Samlet score: meta + counters + det laget mangler + kombo med lagkamerater">${r.score > 0 ? '+' : ''}${r.score.toFixed(1)}</div></div>`;
    })
    .join('');

  const bans = (sg.bans || []).length
    ? `<div class="card"><h3>Foreslåtte bans</h3><div class="muted" style="font-size:12.5px;margin-bottom:4px">${draft.allies.length || state?.draftHelp?.ownHero ? 'Sterke heroes i din rank som er gode mot laget ditt.' : 'De sterkeste heroene i din rank, særlig de du møter i lanen.'}</div>${sg.bans
        .slice(0, 5)
        .map((b) => `<div class="sugg">${heroImg(b.name, b.dname)}<div><div class="name"><span class="tier ${esc(b.tier)}">${esc(b.tier)}</span> ${esc(b.dname)}</div><div class="why">${b.reasons.map(esc).join(' · ')}</div></div></div>`)
        .join('')}</div>`
    : '';

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

  const title = sg.forTeam ? 'Forslag til lagkameratene' : 'Beste valg for deg';
  const sub = sg.forTeam ? `Alle posisjoner · ${BRACKET_NAME[settings.bracket]}` : `Pos ${settings.role} · ${BRACKET_NAME[settings.bracket]}`;
  patch(
    $('draft-results'),
    `<div class="card"><h3>${title} <span class="right">${sub}</span></h3>
      <div style="display:grid;gap:8px;margin-bottom:6px">${notices.join('')}</div>${rows || '<div class="muted">Ingen forslag.</div>'}</div>${bans}${avoid}${sit}${tips}`,
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

function skillsHtml(sk, err) {
  if (!sk?.games) return err ? `<div class="notice warn" style="margin-top:12px">Fikk ikke hentet skill-rekkefølge og talenter fra OpenDota: ${esc(err)}</div>` : '';
  const strip = `<div class="subhead">Vanlig skill-rekkefølge <span class="faint">(${sk.games} pro-kamper)</span></div><div class="skill-strip">${sk.typical
    .map((t, i) => `<div class="st" title="${esc(`${i + 1}: ${t.dname} (${t.pct} %)`)}">${skillImg(t, 'sm')}<span>${i + 1}</span></div>`)
    .join('')}</div>`;
  const talents = `<div class="subhead">Talenter <span class="faint">(andel som velger hver side)</span></div>${[...sk.talents]
    .reverse()
    .map((t) => {
      const best = Math.max(...t.options.map((o) => o.pct ?? -1));
      return `<div class="talent-tier"><span class="lvl">${t.level}</span>${t.options
        .map((o) => `<div class="opt ${o.pct != null && o.pct === best ? 'best' : ''}"><span>${esc(o.dname)}</span><b>${o.pct != null ? `${o.pct} %` : '–'}</b></div>`)
        .join('')}</div>`;
    })
    .join('')}`;
  const neutrals = sk.neutrals?.length
    ? `<div class="subhead">Nøytrale items <span class="faint">(pro-spillere, alle tiers)</span></div>${sk.neutrals
        .slice(0, 10)
        .map((it) => `<div class="pop-item">${itemImg(it.name, it.dname, 'sm')}<div><div>${esc(it.dname)} <span class="faint">tier ${it.tier ?? '?'}${it.winPct != null ? ` · ${it.winPct} % seier` : ''}</span></div><div class="bar blue"><i style="width:${Math.max(2, it.pct)}%"></i></div></div><span class="faint num">${it.pct} %</span></div>`)
        .join('')}`
    : '';
  return strip + talents + neutrals;
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
      ${skillsHtml(data.skills, data.skillsError)}
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

// ---------------- Updates ----------------
function changeNotes(changes) {
  return (changes || []).flatMap((c) => c.notes || []);
}

function renderUpdate() {
  $('app-version').textContent = status?.version ? `Versjon ${status.version}` : '';
  const box = $('update-banner');
  const u = update;
  let html = '';
  let error = false;
  if (u?.state === 'downloading') {
    const p = u.progress;
    const step = p ? `${p.step}${p.total ? ` ${p.done}/${p.total} filer` : ''}` : 'Starter …';
    html = `<span class="spinner"></span><div class="ub-text"><b>Oppdaterer til versjon ${esc(u.latest || '')} …</b><span>${esc(step)}</span></div>`;
  } else if (u?.state === 'installed') {
    html = `<span>✅</span><div class="ub-text"><b>Versjon ${esc(u.installed?.to || u.latest || '')} er installert</b><span>Lukk Dota Coach og start den på nytt for å ta i bruk den nye versjonen.</span></div>`;
  } else if (u?.state === 'restarting') {
    html = `<span class="spinner"></span><div class="ub-text"><b>Starter den nye versjonen …</b><span>${
      status?.canRestart === false ? 'Hvis ingenting skjer, lukk vinduet og start Dota Coach på nytt.' : 'Siden lastes inn på nytt av seg selv om noen sekunder.'
    }</span></div>`;
  } else if (u?.error && updateRequested) {
    // Shown before «version X is ready», otherwise a failed install looks like nothing happened.
    error = true;
    const title = u.available ? 'Oppdateringen feilet' : 'Fikk ikke sjekket etter oppdateringer';
    html = `<span>⚠️</span><div class="ub-text"><b>${title}</b><span>${esc(u.error)}</span></div>${u.available ? '<button class="btn primary" data-update="apply">Prøv igjen</button>' : ''}<button class="btn" data-update="dismiss">Lukk</button>`;
  } else if (u?.available) {
    const notes = changeNotes(u.changes);
    html = `<div class="ub-text"><b>🆕 Versjon ${esc(u.latest)} er klar</b><span>${esc(notes[0] || 'Forbedringer og feilrettinger.')}${notes.length > 1 ? ` (+${notes.length - 1} til)` : ''}</span></div>
      <button class="btn primary" data-update="apply">Oppdater nå</button><button class="btn" data-goto="setup">Hva er nytt?</button>`;
  }
  box.className = `update-banner${error ? ' error' : ''}${html ? '' : ' hidden'}`;
  patch(box, html);
}

async function applyUpdate() {
  updateRequested = true;
  if (
    state?.phase &&
    ['draft', 'strategy', 'pregame', 'laning', 'mid', 'late'].includes(state.phase) &&
    !confirm('Du er i en kamp eller draft. Oppdaterer du nå, starter coachen på nytt og er borte i noen sekunder. Vil du oppdatere likevel?')
  )
    return;
  if (update) update = { ...update, error: null };
  try {
    const res = await api('/api/update/apply', {});
    if (!res.ok) {
      update = { ...update, error: res.error, state: 'idle' };
      renderUpdate();
      toast(res.error, 6000);
    }
  } catch {
    // The server restarts right after a successful update, so a dropped request is expected.
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-update]');
  if (!b) return;
  if (b.dataset.update === 'apply') applyUpdate();
  if (b.dataset.update === 'dismiss') {
    updateRequested = false;
    renderUpdate();
  }
  if (b.dataset.update === 'check') checkUpdateNow();
  if (b.dataset.update === 'rollback') rollbackUpdate();
});

async function checkUpdateNow() {
  updateRequested = true;
  const card = $('update-card');
  card.querySelector('[data-update=check]')?.setAttribute('disabled', '');
  try {
    update = await api('/api/update/check', {});
    if (!update.available && !update.error) toast('Du har nyeste versjon.');
  } catch (err) {
    toast(err.message);
  }
  renderUpdate();
  renderUpdateCard();
}

async function rollbackUpdate() {
  if (!confirm('Vil du gå tilbake til versjonen du hadde før forrige oppdatering?')) return;
  const res = await api('/api/update/rollback', {}).catch((err) => ({ ok: false, error: err.message }));
  if (!res.ok) toast(res.error, 6000);
  else toast(`Går tilbake til versjon ${res.to} …`);
}

async function renderUpdateCard() {
  const card = $('update-card');
  let info;
  try {
    info = await api('/api/update');
  } catch {
    return;
  }
  const checked = info.checkedAt ? new Date(info.checkedAt).toLocaleString('nb-NO', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : 'aldri';
  const upcoming = info.available
    ? `<div class="notice" style="margin-top:10px"><b>Versjon ${esc(info.latest)} er klar:</b><ul style="margin:6px 0 0;padding-left:18px">${changeNotes(info.changes).map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`
    : '';
  const log = (info.log || []).slice(0, 4).map((c) => `<div><div class="ver">${esc(c.version)}<small>${esc(c.date || '')}</small></div><ul>${(c.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`).join('');
  patch(
    card,
    `<h3>Oppdateringer</h3>
     <div class="kv"><span class="muted">Din versjon</span><b>${esc(info.current)}</b>
       <span class="muted">Sist sjekket</span><span>${checked}${info.error ? ` <span class="faint">(${esc(info.error)})</span>` : ''}</span></div>
     ${upcoming}
     <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
       ${info.available ? '<button class="btn primary" data-update="apply">Oppdater nå</button>' : ''}
       <button class="btn" data-update="check">↻ Se etter oppdateringer</button>
       ${info.backups?.length ? `<button class="btn" data-update="rollback">↩ Angre siste oppdatering</button>` : ''}
     </div>
     <label class="switch" style="margin-top:12px"><input type="checkbox" id="auto-update" ${settings.autoUpdate !== false ? 'checked' : ''}> Installer oppdateringer automatisk når appen starter</label>
     <div class="changelog"><span class="label-sm">Hva er nytt</span>${log}</div>`,
  );
  $('auto-update').addEventListener('change', (e) => saveSettings({ autoUpdate: e.target.checked }));
}

$('copy-diag').addEventListener('click', async () => {
  let text;
  try {
    const d = await api('/api/diagnostics');
    text = `Dota Coach – diagnose (${new Date().toLocaleString('nb-NO')})\n\`\`\`json\n${JSON.stringify(d, null, 1)}\n\`\`\``;
  } catch (err) {
    return toast(`Klarte ikke å lage diagnose: ${err.message}`);
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Diagnosen er kopiert. Lim den inn i chatten med Claude.', 5000);
  } catch {
    // No clipboard access (e.g. opened over the network): show the text so it can be copied by hand.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'width:100%;height:220px;margin-top:10px;background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:8px;font:12px var(--mono)';
    $('copy-diag').after(area);
    area.select();
  }
});

// ---------------- Start ----------------
// In the desktop app the overlay window handles speech and is always on top already.
if (/Electron/.test(navigator.userAgent)) {
  $('popout').classList.add('hidden');
  $('tts').classList.add('hidden');
  speaker.setEnabled(false);
}
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
api('/api/update')
  .then((u) => {
    update = u;
    renderUpdate();
  })
  .catch(() => {});
try {
  const t = localStorage.getItem('dotacoach.tab');
  if (t && t !== 'live') showTab(t);
} catch {
  // ignore
}
