// Språk: norsk (standard) eller engelsk. Valget lagres per telefon.
// Siden skrives på norsk; når engelsk er valgt, oversettes teksten på siden fortløpende
// fra ordboka i sprak-en.js (og navn på retter, varer og måltider fra mat-en.js).
import { EN, MONSTRE } from './sprak-en.js';

const NOKKEL = 'hjem.sprak';

function lesSprak() {
  if (typeof window === 'undefined') return 'no';
  try { const v = localStorage.getItem(NOKKEL); if (v === 'no' || v === 'en') return v; } catch {}
  // Alle som allerede bruker appen, beholder norsk til de selv bytter
  try { if (['budsjett.plan', 'budsjett.poster', 'hjem.mat', 'tilbudsavis.varer'].some((k) => localStorage.getItem(k) != null)) return 'no'; } catch {}
  // Nye besøkende med en telefon på et annet språk enn norsk, svensk eller dansk får engelsk
  try { const l = (navigator.language || '').toLowerCase(); if (l && !/^(nb|nn|no|sv|da)/.test(l)) return 'en'; } catch {}
  return 'no';
}

export const sprak = lesSprak();
export const erEngelsk = sprak === 'en';
export const LOK = erEngelsk ? 'en-GB' : 'nb-NO';

export function settSprak(s) {
  try { localStorage.setItem(NOKKEL, s); } catch {}
  location.reload();
}

const ekstra = {};
export function leggTilOrdbok(ordbok) { Object.assign(ekstra, ordbok); }

const har = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const slaOpp = (tekst) => (har(ekstra, tekst) ? ekstra[tekst] : har(EN, tekst) ? EN[tekst] : null);

// Tall i teksten byttes med # før oppslag, så «Ca. 1 234 kr» finner «Ca. # kr»
const TALL = /[\d½¼¾](?:[\d½¼¾  ]|[ ,.:](?=\d))*/g;
function medTall(tekst) {
  const direkte = slaOpp(tekst);
  if (direkte != null) return direkte;
  const tall = [];
  const mal = tekst.replace(TALL, (x) => { tall.push(x); return '#'; });
  if (!tall.length) return null;
  const ut = slaOpp(mal);
  if (ut == null) return null;
  let i = 0;
  return ut.replace(/#/g, () => tall[i++] ?? '');
}

const FORAN = /^[^\p{L}\p{N}«"(¿]+/u;
const BAK = /[^\p{L}\p{N}.:!?)»"%]+$/u;
function monster(tekst) {
  for (const [re, f] of MONSTRE) {
    const m = tekst.match(re);
    if (m) { const r = typeof f === 'function' ? f(m, oversett) : tekst.replace(re, f); if (r != null) return r; }
  }
  return null;
}
function finn(tekst) {
  const ut = medTall(tekst);
  if (ut != null) return ut;
  // Ikoner og tegn foran og bak («🛒 Handleliste», «Se tilbud →») tas av og settes på igjen
  const foran = tekst.match(FORAN)?.[0] || '';
  const bak = tekst.slice(foran.length).match(BAK)?.[0] || '';
  const kjerne = tekst.slice(foran.length, tekst.length - bak.length);
  if ((foran || bak) && kjerne) { const k = medTall(kjerne); if (k != null) return foran + k + bak; }
  const m = monster(tekst);
  if (m != null) return m;
  if ((foran || bak) && kjerne) { const k = monster(kjerne); if (k != null) return foran + k + bak; }
  return null;
}

// Oversett en hel tekst (eller returner den som den er)
export function oversett(tekst) {
  if (!erEngelsk || tekst == null) return tekst;
  const s = String(tekst);
  const f = finn(s.trim());
  return f != null ? s.replace(s.trim(), f) : s;
}
// Tekst med {plassholdere}: t('Hei, {navn}!', { navn })
export function t(tekst, verdier) {
  let s = oversett(tekst);
  if (verdier) s = s.replace(/\{(\w+)\}/g, (_, k) => (verdier[k] ?? ''));
  return s;
}
// «a, b og c» på riktig språk
export function liste(deler) {
  const d = deler.filter(Boolean);
  if (d.length < 2) return d.join('');
  return `${d.slice(0, -1).join(', ')} ${erEngelsk ? 'and' : 'og'} ${d[d.length - 1]}`;
}

const ATTRIBUTTER = ['placeholder', 'aria-label', 'title'];
const HOPP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
const laget = new Set(); // tekst vi selv har oversatt – skal ikke oversettes en gang til

function oversettTekstnode(n) {
  const raw = n.nodeValue;
  const tr = raw.trim();
  if (!tr || tr.length > 500 || laget.has(tr) || !/[A-Za-zÆØÅæøå]/.test(tr)) return;
  if (n.parentElement && (HOPP.has(n.parentElement.tagName) || n.parentElement.closest('[data-ikke-oversett]'))) return;
  const ny = finn(tr);
  if (ny != null && ny !== tr) { laget.add(ny.trim()); n.nodeValue = raw.replace(tr, ny); }
}

function oversettAttributter(el) {
  if (!el.getAttribute || el.closest('[data-ikke-oversett]')) return;
  for (const a of ATTRIBUTTER) {
    const v = el.getAttribute(a);
    if (!v || laget.has(v.trim())) continue;
    const ny = finn(v.trim());
    if (ny != null && ny !== v) { laget.add(ny); el.setAttribute(a, ny); }
  }
}

export function oversettDom(rot) {
  if (!erEngelsk || !rot) return;
  if (rot.nodeType === 3) { oversettTekstnode(rot); return; }
  if (rot.nodeType !== 1 || HOPP.has(rot.tagName)) return;
  oversettAttributter(rot);
  const w = document.createTreeWalker(rot, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) oversettTekstnode(n); else oversettAttributter(n);
  }
}

export function startOversetting() {
  if (!erEngelsk) return;
  document.documentElement.lang = 'en';
  document.title = oversett(document.title);
  oversettDom(document.body);
  new MutationObserver((endringer) => {
    for (const e of endringer) {
      if (e.type === 'characterData') oversettTekstnode(e.target);
      else if (e.type === 'attributes') oversettAttributter(e.target);
      else for (const n of e.addedNodes) oversettDom(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTTER });
}

// Knapp for å bytte språk
export function sprakknapp() {
  return erEngelsk
    ? '<button type="button" class="sprakknapp" data-sprak="no" data-ikke-oversett aria-label="Bytt til norsk">🇳🇴 Norsk</button>'
    : '<button type="button" class="sprakknapp" data-sprak="en" aria-label="Switch to English">🇬🇧 English</button>';
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-sprak]'); if (b) settSprak(b.dataset.sprak); });
}
