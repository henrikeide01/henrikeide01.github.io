// Henter hyllepriser per kjede fra Kassalapp for alle varene i Hjemme-appen → tilbud/data/priser.json
// Trenger KASSALAPP_API_KEY (GitHub-hemmelighet). Uten nøkkel gjør skriptet ingenting.
// Bare ferske priser tas med: Kassalapp har gamle priser for noen kjeder, og de skal ikke se nye ut.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { INGREDIENSER } from '../../hjem/mat.js';
import { lagMatcher } from '../motor.js';

const NOKKEL = process.env.KASSALAPP_API_KEY;
if (!NOKKEL) { console.log('Ingen KASSALAPP_API_KEY – hopper over hyllepriser.'); process.exit(0); }

const API = 'https://kassal.app/api/v1';
const UT = new URL('../data/priser.json', import.meta.url);
// Kjeder som finnes i Tromsø. Oda (bare netthandel i Sør-Norge) og grossister tas ikke med.
const KJEDER = { SPAR_NO: 'Eurospar', MENY_NO: 'Meny', JOKER_NO: 'Joker', BUNNPRIS: 'Bunnpris', COOP_NO: 'Coop', KIWI: 'Kiwi', REMA_1000: 'REMA 1000', REMA_NO: 'REMA 1000' };
const FERSK_DAGER = 21;
// Hyllene har langt flere varer enn kundeavisene, så prissøket trenger flere ord som utelukker feil treff
const ALLTID_IKKE = ['mnd', 'sennep', 'ketchup', 'dressing', 'fjordland', 'toro ', 'ferdigrett', 'i saus', 'urtesaus', 'gele', 'hundemat', 'kattemat', 'dyremat', 'barnemat', 'chips', 'snacks', 'pålegg'];
const EKSTRA_IKKE = {
  granola: ['yoghurt', 'go morgen'], smor: ['margarin', 'olivenolje', 'flytende', 'smørbar', 'bremykt'],
  biff: ['svin', 'hval', 'snadder', 'kylling', 'kebab'], tunfisk: ['salat', 'postei'], kyllingfilet: ['grillet', 'kokt', 'røkt'],
  laks: ['røkt', 'gravet', 'kaviar', 'postei'], polser: ['brød', 'lompe'], ost: ['smøreost', 'prim', 'brunost', 'revet parmesan'],
  skyr: ['drikke'], yoghurt: ['drikke', 'go morgen'], bacon: ['grateng'], erter: ['tørrede', 'tørket'],
  tomat: ['knust', 'hakkede', 'soltørkede', 'puré', 'pure', 'boks'], agurk: ['skivede', 'sylte', 'nora'],
  paprika: ['partymix', 'skinnfri', 'krydder', 'pulver'], nudler: ['smak', 'cup'],
};
const PAUSE_MS = 1100; // Kassalapp tillater 60 kall i minuttet
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

async function sok(tekst) {
  const url = `${API}/products?search=${encodeURIComponent(tekst)}&size=100`;
  for (let forsok = 1; forsok <= 4; forsok++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${NOKKEL}`, Accept: 'application/json' } });
    if (res.status === 429) { await vent(15000 * forsok); continue; }
    if (res.status === 401 || res.status === 403) throw new Error(`Kassalapp avviste nøkkelen (${res.status})`);
    if (!res.ok) { await vent(3000 * forsok); continue; }
    return (await res.json()).data || [];
  }
  return [];
}

// Pakningsstørrelse i gram (liter regnes som kilo). Egg telles i stk à ca. 60 g.
function gram(p, key) {
  const w = Number(p.weight), u = String(p.weight_unit || '').toLowerCase();
  if (w > 0) {
    if (u === 'g' || u === 'ml') return w;
    if (u === 'kg' || u === 'l') return w * 1000;
    if (u === 'cl') return w * 10;
    if (u === 'dl') return w * 100;
  }
  const navn = String(p.name || '').toLowerCase().replace(',', '.');
  const multi = navn.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|gr|l|ltr|dl|cl|ml)\b/);
  const enkel = navn.match(/(\d+(?:\.\d+)?)\s*(kg|g|gr|l|ltr|dl|cl|ml)\b/);
  const omreg = (n, e) => n * ({ kg: 1000, g: 1, gr: 1, l: 1000, ltr: 1000, dl: 100, cl: 10, ml: 1 }[e] || 0);
  if (multi) return Number(multi[1]) * omreg(Number(multi[2]), multi[3]);
  if (enkel) return omreg(Number(enkel[1]), enkel[2]);
  const stk = navn.match(/(\d+)\s*(stk|pk|egg)\b/);
  if (key === 'egg' && stk) return Number(stk[1]) * 60;
  return 0;
}

// Søkeordet må starte et ord («laks», ikke «flaksalt»), og ikke være tilbehør («julekake m/meierismør», «grøt med banan»)
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function hovedord(navn, sok) {
  const t = ` ${String(navn).toLowerCase()}`;
  return sok.some((s) => {
    const ord = s.replace(/["+]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!ord) return false;
    for (const m of t.matchAll(new RegExp(`[\\s(,/-]${esc(ord)}`, 'g'))) {
      if (!/(m\/|med |og |\/)$/.test(t.slice(0, m.index + 1))) return true;
    }
    return false;
  });
}

const sistePris = (p) => (p.price_history || []).reduce((a, h) => (h.date > (a?.date || '') ? h : a), null);
const median = (l) => { const s = [...l].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const naa = Date.now();
const varer = {};
let kall = 0;
for (const [key, ing] of Object.entries(INGREDIENSER)) {
  if (ing.basis || !ing.sok?.length) continue;
  const passer = lagMatcher({ sok: ing.sok, ikke: [...(ing.ikke || []), ...ALLTID_IKKE, ...(EKSTRA_IKKE[key] || [])] });
  const sett = new Map();
  for (const ord of ing.sok.slice(0, 2).map((s) => s.replace(/["+]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    if (kall++) await vent(PAUSE_MS);
    for (const p of await sok(ord)) sett.set(p.id, p);
  }
  const perKjede = {};
  for (const p of sett.values()) {
    const kjede = KJEDER[p.store?.code];
    if (!kjede || !(p.current_price > 0) || !passer(p.name || '') || !hovedord(p.name || '', ing.sok)) continue;
    const siste = sistePris(p);
    const dato = siste?.date || p.updated_at;
    if (!dato || (naa - Date.parse(dato)) / 864e5 > FERSK_DAGER) continue;
    const g = gram(p, key);
    if (!(g > 0) || g < ing.pakke * 0.2 || g > ing.pakke * 6) continue; // ikke pålegg-småpakker eller storkjøkken
    const kg = (p.current_price / g) * 1000;
    if (kg < ing.pris * 0.3 || kg > ing.pris * 3) continue; // langt unna normalprisen: trolig en annen vare
    const naaBest = perKjede[kjede];
    if (!naaBest || kg < naaBest.kg) perKjede[kjede] = { kg: Math.round(kg * 10) / 10, pris: p.current_price, gram: Math.round(g), navn: p.name, dato: String(dato).slice(0, 10) };
  }
  const kjeder = Object.keys(perKjede);
  if (kjeder.length) varer[key] = { median: Math.round(median(kjeder.map((k) => perKjede[k].kg)) * 10) / 10, per: perKjede };
  console.log(`${ing.navn}: ${kjeder.map((k) => `${k} ${perKjede[k].kg} kr/kg`).join(', ') || '–'}`);
}

const ut = { oppdatert: new Date().toISOString(), kilde: 'Kassalapp (kassal.app)', ferskDager: FERSK_DAGER, varer };
let gammel = null;
try { gammel = JSON.parse(await readFile(UT, 'utf8')); } catch {}
if (gammel && JSON.stringify(gammel.varer) === JSON.stringify(varer)) { console.log('Ingen prisendringer.'); process.exit(0); }
await mkdir(new URL('.', UT), { recursive: true });
await writeFile(UT, `${JSON.stringify(ut, null, 1)}\n`);
console.log(`Lagret priser for ${Object.keys(varer).length} varer.`);
