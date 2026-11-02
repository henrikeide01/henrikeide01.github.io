// Henter ukens kundeavis-tilbud fra matbutikkene i nærheten (via eTilbudsavis/Tjek)
// og lagrer dem som kompakt JSON som tilbudssiden leser.
//
// Kjøres av GitHub Actions (.github/workflows/tilbud.yml), men kan også kjøres lokalt:
//   node tilbud/scripts/hent-tilbud.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const MAPPE = new URL('../', import.meta.url);
const DATA = new URL('data/', MAPPE);
const API = 'https://squid-api.tjek.com/v2';

const cfg = JSON.parse(await readFile(new URL('innstillinger.json', MAPPE), 'utf8'));
const tillatteButikker = new Set(cfg.butikker.map((n) => n.toLowerCase()));
const visningsnavn = (n) => cfg.visningsnavn?.[n] ?? n;
const naa = new Date();

const vent = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(sti, params = {}) {
  const url = new URL(API + sti);
  const alle = { ...params, r_lat: cfg.lat, r_lng: cfg.lng, r_radius: cfg.radiusMeter, r_locale: 'nb_NO' };
  for (const [k, v] of Object.entries(alle)) url.searchParams.set(k, v);
  let sisteFeil;
  for (let forsok = 1; forsok <= 4; forsok++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) return await res.json();
      sisteFeil = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      sisteFeil = e;
    }
    await vent(1500 * 2 ** forsok);
  }
  throw sisteFeil;
}

async function hentAlle(sti, params) {
  const ut = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const side = await api(sti, { ...params, limit: 100, offset });
    if (!Array.isArray(side)) break;
    ut.push(...side);
    if (side.length < 100) break;
    await vent(300);
  }
  return ut;
}

// ---------- Tolking av tall og tekst ----------

const tall = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.'));
const rund = (n, d = 2) => (n == null || !isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

function finnForpris(pris, stk, beskrivelse, apiForpris) {
  const d = beskrivelse || '';
  let forpris = apiForpris > 0 ? apiForpris : null;
  let m;
  if (!forpris && (m = d.match(/f[øo]rpris:?\s*(?:kr\.?\s*)?(\d+(?:[.,]\d{1,2})?)/i))) {
    forpris = tall(m[1]);
  }
  if (!forpris && (m = d.match(/\bspar(?:\s+fra)?\s*(?:kr\.?\s*)?(\d+(?:[.,]\d{1,2})?)\s*(%|prosent)?/i))) {
    const v = tall(m[1]);
    forpris = m[2] ? (v < 90 ? pris / (1 - v / 100) : null) : pris + v;
  }
  if (!forpris && stk > 1 &&
      (m = d.match(/\b1\s*(?:stk|flaske|fl|pk|pakke|boks|glass|pose|kartong|beger|brett|pakning|bx|bunt|stykk)\.?\s*(?:kr\.?\s*)?(\d+(?:[.,]\d{1,2})?)/i))) {
    forpris = tall(m[1]) * stk; // "2 for 45" – førpris er prisen for én, ganget opp
  }
  if (forpris && forpris <= pris && stk > 1 && forpris * stk > pris) forpris *= stk;
  if (!forpris || forpris <= pris * 1.005 || forpris > pris * 8) return null;
  return rund(forpris);
}

// Fjerner pris-/mengdetekst som allerede vises for seg (kilopris, førpris, «1 stk 34,50» osv.)
const N = String.raw`\d+(?:[.,]\d{1,2})?`;
const R = String.raw`${N}(?:\s*[-–/]\s*${N})?`;
const ENH = '(?:kg|l|liter|stk|pk|pakke|pose|glass|flaske|fl|kartong|boks|beger|kapsel|strømpe|bukett|brett|bunt|beholder|pakning|enhet|rull|tube|kurv|stykk|bx)';
function rensInfo(info, mengde) {
  let s = ' ' + String(info || '') + ' ';
  const fjern = [
    new RegExp(String.raw`enh\.?\s*pris:?\s*${R}\s*(?:pr\.?\s*${ENH}\.?)?`, 'gi'),
    new RegExp(String.raw`\bpris\s+pr\.?\s*${ENH}\b\.?`, 'gi'),
    new RegExp(String.raw`f[øo]r(?:pris)?:?\s*(?:fra\s*)?(?:kr\.?\s*)?${R}(?:\s*,-)?`, 'gi'),
    new RegExp(String.raw`spar(?:\s+fra)?\s*(?:kr\.?\s*)?${N}\s*(?:kr|,-|%)?!?`, 'gi'),
    new RegExp(String.raw`(?:fra\s*)?${R}\s*(?:kr\s*)?(?:pr\.?\s*|\/\s*)${ENH}\b\.?`, 'gi'),
    new RegExp(String.raw`\bpr\.?\s*${ENH}\b\.?(?:\s*(?:fra\s*)?${R})?`, 'gi'),
    new RegExp(String.raw`\b1\s*${ENH}\.?\s*(?:fra\s*)?(?:kr\.?\s*)?${R}`, 'gi'),
  ];
  for (const re of fjern) s = s.replace(re, ' ');
  if (mengde) {
    const m = mengde.replace(/^\d+ × /, '').replace('–', '-');
    for (const v of [m, m.replace(' ', ''), m.replace('-', '/')]) s = s.replace(new RegExp(`(^|[\\s,.(])(?:fra\\s+|ca\\.?\\s*)?(?:\\d+\\s*[x×]\\s*)?${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s,.)]|$)`, 'i'), '$1 ');
  }
  return s.replace(/\s*([,.])(\s*[,.])+/g, '$1').replace(/\s+([,.!])/g, '$1').replace(/\s+/g, ' ').replace(/^[\s,.·\-–]+|[\s,·\-–]+$/g, '').replace(/^\.$/, '').trim();
}

function fmtMengde(fra, til, symbol) {
  const f = (n) => String(rund(n, 3)).replace('.', ',');
  const sym = symbol === 'pcs' ? 'stk' : symbol;
  return fra === til || til == null ? `${f(fra)} ${sym}` : `${f(fra)}–${f(til)} ${sym}`;
}

function rensTekst(s, maks = 160) {
  const t = String(s || '')
    .replace(/Ukens Joker GARANTI[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > maks ? t.slice(0, maks - 1).trimEnd() + '…' : t;
}

function behandle(o, butikk) {
  const pris = o.pricing?.price;
  if (!(pris > 0)) return null;
  const q = o.quantity || {};
  const stk = q.pieces?.from > 0 ? q.pieces.from : 1;
  const siSym = q.unit?.si?.symbol;
  const faktor = q.unit?.si?.factor ?? 1;
  const enhet = siSym === 'kg' ? 'kg' : siSym === 'l' ? 'l' : siSym === 'pcs' ? 'stk' : null;
  const sFra = q.size?.from;
  const sTil = q.size?.to ?? sFra;

  let enhetspris = null;
  let enhetsprisMaks = null;
  let mengde = null;
  if (enhet && sFra > 0) {
    enhetspris = pris / (sTil * faktor * stk); // største pakning gir laveste pris («fra»)
    enhetsprisMaks = pris / (sFra * faktor * stk);
    const vanligStk = enhet === 'stk' && sFra === 1 && sTil === 1;
    mengde = vanligStk ? (stk > 1 ? `${stk} stk` : null) : `${stk > 1 ? stk + ' × ' : ''}${fmtMengde(sFra, sTil, q.unit.symbol)}`;
  }
  const forpris = finnForpris(pris, stk, o.description, o.pricing?.pre_price);

  return {
    id: o.id,
    butikk,
    tittel: rensTekst(o.heading, 90),
    info: rensTekst(rensInfo(String(o.description || '').replace(/Ukens Joker GARANTI[\s\S]*$/i, ''), mengde)),
    pris: rund(pris),
    forpris,
    rabatt: forpris ? Math.round((1 - pris / forpris) * 100) : null,
    stk,
    mengde,
    enhet,
    enhetspris: rund(enhetspris),
    enhetsprisMaks: enhetsprisMaks && Math.abs(enhetsprisMaks - enhetspris) > 0.01 ? rund(enhetsprisMaks) : null,
    maksPerKunde: q.pieces?.max || null,
    bilde: o.images?.thumb || null,
    bildeStort: o.images?.zoom || o.images?.view || null,
    fra: o.run_from,
    til: o.run_till,
  };
}

function lesbarFarge(hex) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.88 ? null : `#${h.toLowerCase()}`; // hvit/nesten hvit merkevarefarge er ubrukelig som etikett
}

// ---------- Hent ----------

const katalogNavn = (k) => String(k.branding?.name || k.dealer?.name || '');
const alleKataloger = (await hentAlle('/catalogs', { order_by: '-publication_date' })).filter((k) => new Date(k.run_till) > naa);
const kataloger = alleKataloger.filter((k) => tillatteButikker.has(katalogNavn(k).toLowerCase()));
const hoppetOver = [...new Set(alleKataloger.filter((k) => !kataloger.includes(k)).map(katalogNavn))].sort();
console.log(`Hopper over (ikke valgt): ${hoppetOver.join(', ') || '–'}`);

console.log(`Fant ${kataloger.length} kundeaviser fra matbutikker rundt ${cfg.sted}:`);

const butikker = {};
const tilbud = [];
const sett = new Set();
for (const k of kataloger) {
  const navn = visningsnavn(katalogNavn(k));
  butikker[navn] ??= { farge: lesbarFarge(k.branding?.color || k.dealer?.color), logo: k.branding?.logo || null };
  const rå = await hentAlle('/offers', { catalog_ids: k.id });
  let antall = 0;
  for (const o of rå) {
    const t = behandle(o, navn);
    if (!t || new Date(t.til) < naa) continue;
    const nokkel = `${navn}|${t.tittel.toLowerCase()}|${t.pris}|${t.til}`;
    if (sett.has(nokkel) || sett.has(t.id)) continue;
    sett.add(nokkel).add(t.id);
    tilbud.push(t);
    antall++;
  }
  console.log(` - ${navn.padEnd(12)} ${String(k.label || '').padEnd(40).slice(0, 40)} ${k.run_from.slice(0, 10)} → ${k.run_till.slice(0, 10)}  ${antall} tilbud`);
  await vent(300);
}

if (tilbud.length === 0) {
  console.error('Fikk ingen tilbud – lar eksisterende data stå urørt.');
  process.exit(1);
}

tilbud.sort((a, b) => a.butikk.localeCompare(b.butikk, 'nb') || a.tittel.localeCompare(b.tittel, 'nb'));

// ---------- Lagre (bare hvis noe faktisk er endret) ----------

await mkdir(DATA, { recursive: true });
const lesJson = async (fil, standard) => {
  try { return JSON.parse(await readFile(new URL(fil, DATA), 'utf8')); } catch { return standard; }
};

const hash = createHash('sha1').update(JSON.stringify(tilbud)).digest('hex').slice(0, 12);
const gammel = await lesJson('tilbud.json', null);
if (gammel?.hash === hash) {
  console.log(`Ingen endringer siden ${gammel.hentet} (${tilbud.length} tilbud).`);
} else {
  const ut = { hentet: naa.toISOString(), sted: cfg.sted, hash, antall: tilbud.length, butikker, tilbud };
  await writeFile(new URL('tilbud.json', DATA), JSON.stringify(ut));
  console.log(`Lagret ${tilbud.length} tilbud fra ${Object.keys(butikker).length} butikker.`);
}

// Prishistorikk: ett innslag per tilbud vi har sett, slik at siden kan si «laveste pris på X uker».
// Format per id: [startdato, butikk, tittel, enhet, enhetspris, pris, rabatt]
const historikk = await lesJson('historikk.json', { tilbud: {} });
let nye = 0;
for (const t of tilbud) {
  if (t.enhetspris == null) continue;
  const innslag = [t.fra.slice(0, 10), t.butikk, t.tittel, t.enhet, t.enhetspris, t.pris, t.rabatt];
  if (JSON.stringify(historikk.tilbud[t.id]) === JSON.stringify(innslag)) continue;
  historikk.tilbud[t.id] = innslag;
  nye++;
}
const grense = new Date(naa.getTime() - (cfg.historikkDager || 180) * 864e5).toISOString().slice(0, 10);
const valgteNavn = new Set(cfg.butikker.map(visningsnavn));
let fjernet = 0;
for (const [id, h] of Object.entries(historikk.tilbud)) {
  if (h[0] < grense || !valgteNavn.has(h[1])) { delete historikk.tilbud[id]; fjernet++; }
}
if (nye || fjernet) {
  historikk.oppdatert = naa.toISOString();
  await writeFile(new URL('historikk.json', DATA), JSON.stringify(historikk));
}
console.log(`Historikk: ${nye} nye, ${fjernet} fjernet, ${Object.keys(historikk.tilbud).length} totalt.`);
