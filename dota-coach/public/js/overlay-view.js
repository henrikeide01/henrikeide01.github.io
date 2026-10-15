// Compact coach view used by overlay.html (Electron / browser) and the pop-out window in the dashboard.
import { esc, heroImg, itemImg, skillImg, fmtClock, fmtNum } from './common.js';

const MAX_TIPS = 4;
const TIMER_ORDER = ['power', 'bounty', 'stack', 'wisdom', 'lotus', 'neutral', 'tormentor', 'roshan', 'aegis', 'daynight'];

// Only touch the DOM when a section actually changed (avoids image flicker).
export function patch(el, html) {
  if (el && el._html !== html) {
    el.innerHTML = html;
    el._html = html;
    el._layout = null;
  }
}

// Gives `el` a fixed skeleton (kept while `key` stays the same) and returns a lookup for its
// [data-p] parts, so images can stay put while the text next to them updates.
export function layout(el, key, html) {
  if (el._layout !== key) {
    el.innerHTML = html;
    el._layout = key;
    el._html = null;
  }
  return (name) => el.querySelector(`[data-p="${name}"]`);
}

// Renders a list where each entry keeps its element while its key stays the same,
// so tips whose text changes every second (countdowns) don't re-animate.
export function patchList(container, items, keyOf, htmlOf, wrapClass) {
  const doc = container.ownerDocument;
  const old = new Map([...container.children].map((el) => [el.dataset.key, el]));
  if (container._html) {
    container.innerHTML = ''; // previous content was set with patch()
    container._html = null;
    old.clear();
  }
  items.forEach((it, i) => {
    const key = keyOf(it);
    let el = old.get(key);
    old.delete(key);
    if (!el) {
      el = doc.createElement('div');
      el.dataset.key = key;
    }
    const cls = wrapClass(it);
    if (el.className !== cls) el.className = cls;
    patch(el, htmlOf(it));
    // Moving a node restarts its animation, so only touch nodes that are out of place.
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null);
  });
  for (const el of old.values()) el.remove();
}

// ---------- The pick phase ----------
const SRC_LABEL = { gsi: 'fra spillet', screen: 'fra skjermen', manual: 'lagt inn' };

// The most trustworthy source in a list of heroes: Dota's own data, then the screen, then entered by hand.
const listSource = (list) => ['gsi', 'screen', 'manual'].find((x) => list.some((h) => h.src === x)) || null;
const srcBadge = (src) => (src ? `<span class="ovd-src ${src}">${SRC_LABEL[src]}</span>` : '');

function teamRow(label, list) {
  if (!list?.length) return '';
  return `<div class="ovd-team"><span class="ovd-lbl">${label}</span><span class="ovd-heads">${list.map((h) => heroImg(h.name, h.dname, 'xxs')).join('')}</span>${srcBadge(listSource(list))}</div>`;
}

// One line of reasons, the most important first (cut with an ellipsis when it is too long).
function reasonLine(r) {
  const parts = (r.reasons || []).slice(0, 2).map((x) => (typeof x === 'string' ? { text: x, kind: '' } : x));
  if (!parts.length && r.winrate != null) parts.push({ text: `${(r.winrate * 100).toFixed(1).replace('.', ',')} % seier`, kind: '' });
  return parts.map((x) => `<span class="${x.kind === 'neg' ? 'neg' : x.kind === 'pos' ? 'pos' : ''}">${esc(x.text)}</span>`).join(' · ');
}

function renderDraft(el, dh) {
  const part = layout(
    el,
    'draft',
    '<div data-p="me"></div><div data-p="needs"></div><div class="ovd-h" data-p="bansHead"></div><div class="ovd-list" data-p="bans"></div><div class="ovd-h" data-p="picksHead"></div><div class="ovd-list" data-p="picks"></div><div class="ovd-teams" data-p="teams"></div>',
  );
  patch(part('me'), dh.ownHero ? `<div class="ovd-me">${heroImg(dh.ownHero.name, dh.ownHero.dname, 'xxs')}<span>Du har valgt <b>${esc(dh.ownHero.dname)}</b></span></div>` : '');
  patch(part('needs'), dh.needsText ? `<div class="ovd-needs">⚠️ ${esc(dh.needsText.replace(/^Laget mangler /, 'Laget mangler: '))}</div>` : '');

  const bans = dh.banPhase ? (dh.bans || []).slice(0, 3) : [];
  patch(part('bansHead'), bans.length ? 'Foreslåtte bans' : '');
  patchList(
    part('bans'),
    bans,
    (b) => `ban:${b.name}`,
    (b) => `${heroImg(b.name, b.dname, 'xs')}<div><b>${esc(b.dname)}</b> <span class="tier ${esc(b.tier)}">${esc(b.tier)}</span><div class="ov-sub">${reasonLine(b)}</div></div>`,
    () => 'ov-pick ban',
  );

  const picks = (dh.picks || []).slice(0, bans.length ? 3 : 4);
  const enemies = dh.enemyList?.length || dh.enemies?.length || 0;
  const head = dh.forTeam ? 'Forslag til laget' : `Beste valg${dh.role ? ` for pos ${dh.role}` : ''}${enemies ? ` mot ${enemies} fiende${enemies > 1 ? 'r' : ''}` : ''}`;
  patch(part('picksHead'), picks.length ? `${esc(head)}${dh.loading ? ' <span class="ovd-load">henter data …</span>' : ''}` : '');
  patchList(
    part('picks'),
    picks,
    (r) => r.name,
    (r) => `${heroImg(r.name, r.dname, 'xs')}<div><b>${esc(r.dname)}</b> <span class="tier ${esc(r.tier)}">${esc(r.tier)}</span><div class="ov-sub">${reasonLine(r)}</div></div>`,
    () => 'ov-pick',
  );

  const banned = dh.banList || [];
  patch(part('teams'), [teamRow('Fiender', dh.enemyList), teamRow('Laget', dh.allyList), teamRow('Bannet', banned)].join(''));
}

export function mountOverlay(root) {
  root.innerHTML = `
    <div class="ov">
      <div class="ov-head" data-s="head"></div>
      <div class="ov-fight" data-s="fight"></div>
      <div class="ov-draft" data-s="draft"></div>
      <div class="ov-tips" data-s="tips"></div>
      <div class="ov-skills" data-s="skills"></div>
      <div class="ov-next" data-s="next"></div>
      <div class="ov-timers" data-s="timers"></div>
      <div class="ov-foot" data-s="foot"></div>
      <div class="ov-edit-hint">Flyttemodus: dra vinduet dit du vil ha det. Trykk <b>Alt+Shift+M</b> for å låse.</div>
    </div>`;
  const s = (name) => root.querySelector(`[data-s="${name}"]`);
  const els = { head: s('head'), fight: s('fight'), draft: s('draft'), tips: s('tips'), skills: s('skills'), next: s('next'), timers: s('timers'), foot: s('foot') };

  return function update(state, status) {
    // A fresh game state means Dota is connected, even before the next status message arrives.
    const connected = status?.gsiConnected || (!!state?.phase && state.phase !== 'menu' && Date.now() - (state.updatedAt || 0) < 35000);
    // The pick phase keeps the draft view even after your own hero is picked (the rest of the draft matters).
    const live = state && state.hero && !['menu', 'loading', 'draft'].includes(state.phase);
    if (live) patch(els.draft, '');

    if (!live) {
      const msg = !status
        ? 'Kobler til coach-serveren …'
        : connected
          ? state?.phase === 'draft'
            ? 'Hero-valg pågår. Forslagene kommer når heroene er gjenkjent (eller lagt inn i Draft-fanen).'
            : 'Klar. Venter på at kampen starter.'
          : 'Venter på Dota 2 … Start spillet eller en demo.';
      patch(els.head, `<div class="ov-title"><span class="dot ${connected ? 'on' : 'wait'}"></span><b>Dota Coach</b><span class="ov-muted">${esc(state?.phaseLabel || '')}</span></div>`);
      const dh = connected ? state?.draftHelp : null;
      if (dh && (dh.picks?.length || dh.bans?.length)) {
        renderDraft(els.draft, dh);
        patch(els.tips, '');
      } else {
        patch(els.draft, '');
        patch(els.tips, `<div class="ov-empty">${esc(msg)}</div>`);
      }
      patch(els.skills, '');
      patch(els.fight, '');
      patch(els.next, '');
      patch(els.timers, '');
      patch(els.foot, '');
      return;
    }

    const h = state.hero;
    const day = state.daytime === null ? '' : state.daytime ? '☀️' : '🌙';
    const head = layout(els.head, 'live', '<div class="ov-title"><span data-p="img"></span><div class="ov-hero" data-p="info"></div><div class="ov-clock num" data-p="clock"></div></div>');
    patch(head('img'), heroImg(h.name, h.dname, 'xs'));
    patch(
      head('info'),
      `<b>${esc(h.dname)}</b> <span class="ov-lvl">Lv ${h.level ?? '?'}</span>
       <div class="ov-sub">${esc(state.phaseLabel)}${state.location ? ` · ${esc(state.location.label)}` : ''}</div>`,
    );
    patch(head('clock'), `${esc(state.clockText)} ${day}${state.paused ? ' ⏸' : ''}`);

    const f = state.fight;
    const dr = state.deathRecap;
    if (dr && h.alive === false) {
      // While dead the fight meter has nothing to say: the death recap takes its place.
      els.fight.className = 'ov-fight ov-death';
      const buy = dr.whileDead?.buy;
      const bb = dr.whileDead?.buyback;
      patch(
        els.fight,
        `<div class="ov-fight-row"><b>💀 Du døde</b><span>${dr.where ? esc(dr.where.label) : ''}${dr.respawn ? ` · respawn ${dr.respawn} s` : ''}</span></div>
         ${dr.mistakes.slice(0, 2).map((m) => `<div class="ov-dr-m">${esc(m.text)}</div>`).join('')}
         ${buy ? `<div class="ov-dr-do">🛒 ${esc(buy.text)}</div>` : ''}
         ${bb && bb.advice !== 'none' ? `<div class="ov-dr-do">💰 ${esc(bb.text)}</div>` : ''}`,
      );
    } else if (f && f.level !== 'dead') {
      els.fight.className = `ov-fight ${f.level}`;
      const fb = layout(els.fight, 'fight', '<div class="ov-fight-row"><b data-p="word"></b><span data-p="head"></span></div><div class="fm-gauge sm"><i data-p="marker"></i></div>');
      patch(fb('word'), `${f.icon} ${esc(f.label)}`);
      patch(fb('head'), esc(f.reasons[0]?.text || f.headline));
      fb('marker').style.left = `${(f.score + 100) / 2}%`;
    } else {
      els.fight.className = 'ov-fight';
      patch(els.fight, '');
    }

    // Skill and neutral choices get their own rows below, so their tips are only read aloud.
    const sk = state.skills;
    const own = (t) => (t.id === 'unspent' && sk?.next) || t.id.startsWith('neutral-') || (t.id.startsWith('talent-') && sk?.next?.talent);
    const deadBuy = state.deathRecap?.whileDead?.buy?.item;
    const tips = (state.tips || [])
      .filter((t) => !t.id.startsWith('fight-') && !t.id.startsWith('death-') && !t.id.startsWith('buy-') && !own(t) && !(deadBuy && t.id === `afford-${deadBuy}`))
      .slice(0, MAX_TIPS);
    const shown = tips.length ? tips : [{ key: 'calm', level: 'calm', icon: '✅', text: state.focus || 'Alt ser bra ut. Fortsett sånn!' }];
    patchList(
      els.tips,
      shown,
      (t) => t.key,
      (t) => `<span>${t.icon}</span><span>${esc(t.text)}</span>`,
      (t) => `ov-tip ${t.level}`,
    );

    const rows = [];
    if (sk?.next) {
      const x = sk.next;
      const tal = x.talent && sk.talent?.pick === x.name ? sk.talent : null;
      rows.push(
        `<div class="ov-skill">${skillImg(x, 'sm')}<div><span class="ov-muted">${x.talent ? 'Talent' : 'Skill'}:</span> <b>${esc(x.dname)}</b>${x.toLevel ? ` <span class="ov-muted">nv ${x.toLevel}</span>` : ''}${tal?.hint ? `<div class="ov-sub">${esc(tal.hint)}</div>` : ''}</div><span class="ov-pct">${x.pct} %</span></div>`,
      );
    }
    const nu = sk?.neutral;
    if (nu && state.phase !== 'post') {
      const a = !nu.artifacts.some((c) => c.selected) && nu.artifacts.find((c) => c.name === nu.pickArtifact);
      const e = !nu.enchantments.some((c) => c.selected) && nu.enchantments.find((c) => c.name === nu.pickEnchantment);
      if (a) rows.push(`<div class="ov-skill">${itemImg(a.name, a.dname, 'sm')}<div><span class="ov-muted">Artefakt T${nu.tier}:</span> <b>${esc(a.dname)}</b></div><span class="ov-pct">${a.pct != null ? `${a.pct} %` : ''}</span></div>`);
      if (e) rows.push(`<div class="ov-skill">${itemImg(e.name, e.dname, 'sm')}<div><span class="ov-muted">Fortryllelse:</span> <b>${esc(e.dname)}</b>${e.stats ? `<div class="ov-sub">${esc(e.stats)}</div>` : ''}</div><span class="ov-pct"></span></div>`);
    }
    // A new neutral tier just opened (and the game shows no choice): the best picks for this hero.
    const pn = sk?.proNeutrals;
    const tierAt = { 1: 0, 2: 900, 3: 1500, 4: 2100, 5: 3600 }[pn?.tier];
    if (!nu && pn && tierAt != null && state.clock - tierAt < 180 && state.clock >= tierAt) {
      const a = pn.items?.[0];
      const e = pn.enchantments?.[0];
      if (a || e) rows.push(`<div class="ov-skill">${a ? itemImg(a.name, a.dname, 'sm') : itemImg(e.name, e.dname, 'sm')}<div><span class="ov-muted">Nøytralt T${pn.tier}:</span> <b>${esc([a?.dname, e?.dname].filter(Boolean).join(' + '))}</b></div><span class="ov-pct">${a?.pct != null ? `${a.pct} %` : ''}</span></div>`);
    }
    // "Kjøp nå": the top one or two live item suggestions (the death recap has its own buy line).
    if (!(dr && h.alive === false)) {
      for (const x of (state.liveItems || []).slice(0, 2)) {
        const gold = x.remaining === 0 ? 'gratis' : x.afford ? 'råd nå' : `−${fmtNum(x.missing)}`;
        rows.push(
          `<div class="ov-skill ov-buy ${x.priority >= 80 ? 'high' : ''}">${itemImg(x.item, x.dname, 'sm')}<div><span class="ov-muted">Kjøp:</span> <b>${esc(x.dname)}</b>${x.short ? `<div class="ov-sub">${esc(x.short)}</div>` : ''}</div><span class="ov-pct ${x.afford ? 'ok' : 'miss'}">${gold}</span></div>`,
        );
      }
    }
    patch(els.skills, rows.join(''));

    const n = state.next;
    if (n) {
      const have = Math.min(state.player.gold, n.remaining);
      const pct = n.remaining > 0 ? Math.round((have / n.remaining) * 100) : 100;
      const next = layout(
        els.next,
        'next',
        '<div class="ov-next-row"><span data-p="img"></span><div class="ov-next-body"><div class="ov-next-name" data-p="name"></div><div class="bar" data-p="bar"><i></i></div></div><div class="ov-next-gold num" data-p="gold"></div></div>',
      );
      patch(next('img'), itemImg(n.name, n.dname, 'sm'));
      patch(next('name'), `Neste: <b>${esc(n.dname)}</b>`);
      next('bar').classList.toggle('green', pct >= 100);
      next('bar').firstChild.style.width = `${pct}%`;
      patch(next('gold'), `${fmtNum(state.player.gold)}<small>/${fmtNum(n.remaining)}</small>`);
    } else patch(els.next, state.buildStatus === 'loading' ? '<div class="ov-muted">Henter build …</div>' : '');

    const timers = [...(state.timers || [])].sort((a, b) => TIMER_ORDER.indexOf(a.id) - TIMER_ORDER.indexOf(b.id)).slice(0, 6);
    patch(
      els.timers,
      timers.map((t) => `<div class="ov-timer ${t.in <= 30 ? 'soon' : ''}"><span>${esc(t.label.replace(' rune', ''))}</span><b class="num">${fmtClock(t.in)}</b></div>`).join(''),
    );

    const p = state.player;
    const pct = state.perf?.gpmPct != null ? ` <span class="ov-muted">(${Math.round(state.perf.gpmPct * 100)}. pst)</span>` : '';
    patch(
      els.foot,
      `<span>GPM <b class="num">${p.gpm}</b>${pct}</span><span>LH <b class="num">${p.lastHits}</b></span><span>KDA <b class="num">${p.kills}/${p.deaths}/${p.assists}</b></span>`,
    );
  };
}
