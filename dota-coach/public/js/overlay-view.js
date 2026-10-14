// Compact coach view used by overlay.html (Electron / browser) and the pop-out window in the dashboard.
import { esc, heroImg, itemImg, fmtClock, fmtNum } from './common.js';

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

export function mountOverlay(root) {
  root.innerHTML = `
    <div class="ov">
      <div class="ov-head" data-s="head"></div>
      <div class="ov-tips" data-s="tips"></div>
      <div class="ov-next" data-s="next"></div>
      <div class="ov-timers" data-s="timers"></div>
      <div class="ov-foot" data-s="foot"></div>
      <div class="ov-edit-hint">Flyttemodus: dra vinduet dit du vil ha det. Trykk <b>Alt+Shift+M</b> for å låse.</div>
    </div>`;
  const s = (name) => root.querySelector(`[data-s="${name}"]`);
  const els = { head: s('head'), tips: s('tips'), next: s('next'), timers: s('timers'), foot: s('foot') };

  return function update(state, status) {
    const connected = status?.gsiConnected;
    const live = state && state.hero && !['menu', 'loading'].includes(state.phase);

    if (!live) {
      const msg = !status
        ? 'Kobler til coach-serveren …'
        : connected
          ? state?.phase === 'draft'
            ? 'Hero-valg pågår. Bruk Draft-fanen i dashboardet.'
            : 'Klar. Venter på at kampen starter.'
          : 'Venter på Dota 2 … Start spillet eller en demo.';
      patch(els.head, `<div class="ov-title"><span class="dot ${connected ? 'on' : 'wait'}"></span><b>Dota Coach</b><span class="ov-muted">${esc(state?.phaseLabel || '')}</span></div>`);
      patch(els.tips, `<div class="ov-empty">${esc(msg)}</div>`);
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

    const tips = (state.tips || []).slice(0, MAX_TIPS);
    const shown = tips.length ? tips : [{ key: 'calm', level: 'calm', icon: '✅', text: state.focus || 'Alt ser bra ut. Fortsett sånn!' }];
    patchList(
      els.tips,
      shown,
      (t) => t.key,
      (t) => `<span>${t.icon}</span><span>${esc(t.text)}</span>`,
      (t) => `ov-tip ${t.level}`,
    );

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
