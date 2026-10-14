// Shared helpers for the dashboard and the overlay.

const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const initials = (dname) =>
  String(dname || '')
    .split(/[\s_-]+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();

const IMG_FAIL = "this.parentNode.classList.add('noimg');this.remove()";

// A stable colour per name, used behind the label when an image can't be loaded (offline).
const hue = (name) => {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

export function heroImg(name, dname, cls = '') {
  return `<span class="himg ${cls}" style="--h:${hue(name)}" data-label="${esc(dname || name)}" title="${esc(dname || name)}"><img src="${CDN}/heroes/${esc(name)}.png" alt="" loading="lazy" onerror="${IMG_FAIL}"></span>`;
}

export function itemImg(name, dname, cls = '') {
  return `<span class="iimg ${cls}" style="--h:${hue(name)}" data-label="${esc(initials(dname || name))}" title="${esc(dname || name)}"><img src="${CDN}/items/${esc(name)}.png" alt="" loading="lazy" onerror="${IMG_FAIL}"></span>`;
}

export function abilityImg(name, dname, cls = '') {
  return `<span class="iimg aimg ${cls}" style="--h:${hue(name)}" data-label="${esc(initials(dname || name))}" title="${esc(dname || name)}"><img src="${CDN}/abilities/${esc(name)}.png" alt="" loading="lazy" onerror="${IMG_FAIL}"></span>`;
}

// Talents have no icon of their own.
export function skillImg(x, cls = '') {
  return x.talent || String(x.name).startsWith('special_bonus') ? `<span class="aimg talent ${cls}" title="${esc(x.dname || 'Talent')}">★</span>` : abilityImg(x.name, x.dname, cls);
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('nb-NO') : '–');

export async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Calls `fn` at most once per `ms`, always with the latest call last, so a slow screen
// never builds up a backlog of old game states.
export function throttle(fn, ms = 120) {
  let last = 0;
  let timer = null;
  return () => {
    const wait = last + ms - Date.now();
    if (wait <= 0) {
      last = Date.now();
      fn();
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn();
      }, wait);
    }
  };
}

// Live connection to the coach server (Server-Sent Events, reconnects by itself).
export function connect({ onState, onStatus, onConnection, onReport, onUpdate }) {
  let es;
  const open = () => {
    es = new EventSource('/api/stream');
    es.addEventListener('state', (e) => onState?.(JSON.parse(e.data)));
    es.addEventListener('status', (e) => onStatus?.(JSON.parse(e.data)));
    es.addEventListener('report', (e) => onReport?.(JSON.parse(e.data)));
    es.addEventListener('update', (e) => onUpdate?.(JSON.parse(e.data)));
    es.onopen = () => onConnection?.(true);
    es.onerror = () => onConnection?.(false);
  };
  open();
  return () => es.close();
}

// Reads tips aloud. Only one open window speaks each tip (the server hands out the "claim").
export class Speaker {
  // alwaysAllowed: the page may speak without a click first (Electron overlay).
  constructor(storageKey, defaultOn, { alwaysAllowed = false } = {}) {
    this.storageKey = storageKey;
    this.alwaysAllowed = alwaysAllowed;
    this.settings = { voice: '', ttsRate: 1.05 };
    this.seen = new Set();
    try {
      const v = localStorage.getItem(storageKey);
      this.enabled = v === null ? defaultOn : v === '1';
    } catch {
      this.enabled = defaultOn;
    }
    this.supported = 'speechSynthesis' in window;
  }

  setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem(this.storageKey, on ? '1' : '0');
    } catch {
      // storage blocked – keep the in-memory value
    }
    if (!on && this.supported) speechSynthesis.cancel();
  }

  canSpeak() {
    if (!this.supported || !this.enabled) return false;
    return this.alwaysAllowed || !navigator.userActivation || navigator.userActivation.hasBeenActive;
  }

  voices() {
    return this.supported ? speechSynthesis.getVoices() : [];
  }

  pickVoice() {
    const voices = this.voices();
    return (
      voices.find((v) => v.name === this.settings.voice) ||
      voices.find((v) => /^(nb|no|nn)\b/i.test(v.lang)) ||
      voices.find((v) => /^(da|sv)\b/i.test(v.lang)) ||
      null
    );
  }

  say(text) {
    if (!this.supported || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pickVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = 'nb-NO';
    u.rate = Number(this.settings.ttsRate) || 1;
    if (speechSynthesis.pending) speechSynthesis.cancel(); // never fall far behind the game
    speechSynthesis.speak(u);
  }

  async handleTips(tips = []) {
    for (const t of tips) {
      if (!t.say || this.seen.has(t.key)) continue;
      this.seen.add(t.key);
      if (!this.canSpeak() || Date.now() - (t.since || 0) > 12000) continue;
      try {
        const { ok } = await api('/api/claim-speech', { key: t.key });
        if (ok) this.say(t.say);
      } catch {
        this.say(t.say);
      }
    }
  }
}
