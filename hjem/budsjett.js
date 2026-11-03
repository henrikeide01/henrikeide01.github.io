// Felles data for Hjemme-appen (/hjem/) og tilbudsavisen (/tilbud/): budsjett, lønn og mat.
// Alt lagres i nettleseren (localStorage) på eidert.no, og synkes kryptert av synk.js hvis husstanden deler.
import { LOK } from './sprak.js';

export const GRUPPER = [
  { id: 'fast', navn: 'Faste utgifter', farge: 1 },
  { id: 'mat', navn: 'Mat og drikke', farge: 2 },
  { id: 'forbruk', navn: 'Annet forbruk', farge: 3 },
  { id: 'sparing', navn: 'Sparing', farge: 4 },
];

// Grupper du fører utgifter på løpende. Faste utgifter og sparing regnes som betalt etter planen.
export const LOPENDE = new Set(['mat', 'forbruk']);

export const STANDARD_PERSONER = [
  { id: 'meg', navn: 'Henrik' },
  { id: 'p2', navn: 'Hanna' },
];

// Oppsettet Henrik og Hanna fikk før appen fikk oppstart for nye husstander. Brukes bare for å
// ta vare på planer som allerede ligger på telefonene deres (og kan hentes fram igjen ved behov).
// «hvem» er 'felles' (deles mellom dere) eller en person-id. Felles beløp er totalen for husstanden.
export const STANDARD_PLAN = {
  personer: STANDARD_PERSONER,
  andelMeg: 50, // hvor mange prosent av felles utgifter person 1 betaler
  inntekter: [
    { id: 'lan', navn: 'Støtte fra Lånekassen', belop: 11616, hvem: 'meg' },
    { id: 'jobb', navn: 'Jobb (annenhver lørdag)', belop: 8550, hvem: 'meg' }, // 30 t × 300 kr/t inkl. tips, ca. 5 % trekk
    { id: 'lan-p2', navn: 'Støtte fra Lånekassen', belop: 11616, hvem: 'p2' },
    { id: 'jobb-p2', navn: 'Jobb (mandager)', belop: 7150, hvem: 'p2' }, // 7,5 t/uke × 220 kr/t, under frikortgrensen
  ],
  utgifter: [
    { id: 'husleie', navn: 'Husleie', belop: 18000, gruppe: 'fast', hvem: 'felles' },
    { id: 'strom', navn: 'Strøm', belop: 700, gruppe: 'fast', hvem: 'felles' },
    { id: 'forsikring', navn: 'Innboforsikring', belop: 150, gruppe: 'fast', hvem: 'felles' },
    { id: 'abonnement', navn: 'Abonnementer', belop: 300, gruppe: 'fast', hvem: 'felles' },
    { id: 'mobil', navn: 'Mobil', belop: 300, gruppe: 'fast', hvem: 'meg' },
    { id: 'mobil-p2', navn: 'Mobil', belop: 300, gruppe: 'fast', hvem: 'p2' },
    { id: 'buss', navn: 'Buss (Svipper)', belop: 450, gruppe: 'fast', hvem: 'meg' },
    { id: 'buss-p2', navn: 'Buss (Svipper)', belop: 450, gruppe: 'fast', hvem: 'p2' },
    { id: 'trening', navn: 'Trening', belop: 300, gruppe: 'fast', hvem: 'meg' },
    { id: 'trening-p2', navn: 'Trening', belop: 300, gruppe: 'fast', hvem: 'p2' },
    { id: 'semester', navn: 'Semesteravgift', belop: 120, gruppe: 'fast', hvem: 'meg' },
    { id: 'semester-p2', navn: 'Semesteravgift', belop: 120, gruppe: 'fast', hvem: 'p2' },
    { id: 'mat', navn: 'Matbutikk', belop: 7000, gruppe: 'mat', hvem: 'felles' },
    { id: 'kantine', navn: 'Kantine og take-away', belop: 400, gruppe: 'mat', hvem: 'meg' },
    { id: 'kantine-p2', navn: 'Kantine og take-away', belop: 400, gruppe: 'mat', hvem: 'p2' },
    { id: 'hygiene', navn: 'Hygiene og husholdning', belop: 600, gruppe: 'forbruk', hvem: 'felles' },
    { id: 'uforutsett', navn: 'Uforutsett', belop: 600, gruppe: 'forbruk', hvem: 'felles' },
    { id: 'klaer', navn: 'Klær og sko', belop: 400, gruppe: 'forbruk', hvem: 'meg' },
    { id: 'klaer-p2', navn: 'Klær og sko', belop: 400, gruppe: 'forbruk', hvem: 'p2' },
    { id: 'fritid', navn: 'Fritid og sosialt', belop: 800, gruppe: 'forbruk', hvem: 'meg' },
    { id: 'fritid-p2', navn: 'Fritid og sosialt', belop: 800, gruppe: 'forbruk', hvem: 'p2' },
    { id: 'sparing', navn: 'Sparing', belop: 500, gruppe: 'sparing', hvem: 'meg' },
    { id: 'sparing-p2', navn: 'Sparing', belop: 500, gruppe: 'sparing', hvem: 'p2' },
  ],
};

// Tidligere standardplaner. Brukes for å oppdatere linjer du ikke har endret selv.
const STANDARD_V3 = '{"personer":[{"id":"meg","navn":"Henrik"},{"id":"p2","navn":"Hanna"}],"andelMeg":50,"inntekter":[{"id":"lan","navn":"Støtte fra Lånekassen","belop":11616,"hvem":"meg"},{"id":"jobb","navn":"Deltidsjobb","belop":0,"hvem":"meg"},{"id":"lan-p2","navn":"Støtte fra Lånekassen","belop":11616,"hvem":"p2"},{"id":"jobb-p2","navn":"Deltidsjobb","belop":0,"hvem":"p2"}],"utgifter":[{"id":"husleie","navn":"Husleie","belop":18000,"gruppe":"fast","hvem":"felles"},{"id":"strom","navn":"Strøm","belop":700,"gruppe":"fast","hvem":"felles"},{"id":"forsikring","navn":"Innboforsikring","belop":150,"gruppe":"fast","hvem":"felles"},{"id":"abonnement","navn":"Abonnementer","belop":300,"gruppe":"fast","hvem":"felles"},{"id":"mobil","navn":"Mobil","belop":300,"gruppe":"fast","hvem":"meg"},{"id":"mobil-p2","navn":"Mobil","belop":300,"gruppe":"fast","hvem":"p2"},{"id":"buss","navn":"Buss (Svipper)","belop":450,"gruppe":"fast","hvem":"meg"},{"id":"buss-p2","navn":"Buss (Svipper)","belop":450,"gruppe":"fast","hvem":"p2"},{"id":"trening","navn":"Trening","belop":300,"gruppe":"fast","hvem":"meg"},{"id":"trening-p2","navn":"Trening","belop":300,"gruppe":"fast","hvem":"p2"},{"id":"semester","navn":"Semesteravgift","belop":120,"gruppe":"fast","hvem":"meg"},{"id":"semester-p2","navn":"Semesteravgift","belop":120,"gruppe":"fast","hvem":"p2"},{"id":"mat","navn":"Matbutikk","belop":7000,"gruppe":"mat","hvem":"felles"},{"id":"kantine","navn":"Kantine og take-away","belop":400,"gruppe":"mat","hvem":"meg"},{"id":"kantine-p2","navn":"Kantine og take-away","belop":400,"gruppe":"mat","hvem":"p2"},{"id":"hygiene","navn":"Hygiene og husholdning","belop":600,"gruppe":"forbruk","hvem":"felles"},{"id":"uforutsett","navn":"Uforutsett","belop":600,"gruppe":"forbruk","hvem":"felles"},{"id":"klaer","navn":"Klær og sko","belop":400,"gruppe":"forbruk","hvem":"meg"},{"id":"klaer-p2","navn":"Klær og sko","belop":400,"gruppe":"forbruk","hvem":"p2"},{"id":"fritid","navn":"Fritid og sosialt","belop":800,"gruppe":"forbruk","hvem":"meg"},{"id":"fritid-p2","navn":"Fritid og sosialt","belop":800,"gruppe":"forbruk","hvem":"p2"},{"id":"sparing","navn":"Sparing","belop":500,"gruppe":"sparing","hvem":"meg"},{"id":"sparing-p2","navn":"Sparing","belop":500,"gruppe":"sparing","hvem":"p2"}]}';
const STANDARD_V2 = '{"personer":[{"id":"meg","navn":"Henrik"},{"id":"p2","navn":"Person 2"}],"andelMeg":50,"inntekter":[{"id":"lan","navn":"Lånekassen (basislån)","belop":15488,"hvem":"meg"},{"id":"jobb","navn":"Deltidsjobb","belop":0,"hvem":"meg"},{"id":"lan-p2","navn":"Lånekassen (basislån)","belop":15488,"hvem":"p2"},{"id":"jobb-p2","navn":"Deltidsjobb","belop":0,"hvem":"p2"}],"utgifter":[{"id":"husleie","navn":"Husleie","belop":10000,"gruppe":"fast","hvem":"felles"},{"id":"strom","navn":"Strøm og internett","belop":1000,"gruppe":"fast","hvem":"felles"},{"id":"forsikring","navn":"Innboforsikring","belop":150,"gruppe":"fast","hvem":"felles"},{"id":"abonnement","navn":"Abonnementer","belop":300,"gruppe":"fast","hvem":"felles"},{"id":"mobil","navn":"Mobil","belop":300,"gruppe":"fast","hvem":"meg"},{"id":"mobil-p2","navn":"Mobil","belop":300,"gruppe":"fast","hvem":"p2"},{"id":"buss","navn":"Buss (Svipper)","belop":450,"gruppe":"fast","hvem":"meg"},{"id":"buss-p2","navn":"Buss (Svipper)","belop":450,"gruppe":"fast","hvem":"p2"},{"id":"trening","navn":"Trening","belop":300,"gruppe":"fast","hvem":"meg"},{"id":"trening-p2","navn":"Trening","belop":300,"gruppe":"fast","hvem":"p2"},{"id":"semester","navn":"Semesteravgift","belop":120,"gruppe":"fast","hvem":"meg"},{"id":"semester-p2","navn":"Semesteravgift","belop":120,"gruppe":"fast","hvem":"p2"},{"id":"mat","navn":"Matbutikk","belop":7000,"gruppe":"mat","hvem":"felles"},{"id":"kantine","navn":"Kantine og take-away","belop":400,"gruppe":"mat","hvem":"meg"},{"id":"kantine-p2","navn":"Kantine og take-away","belop":400,"gruppe":"mat","hvem":"p2"},{"id":"hygiene","navn":"Hygiene og husholdning","belop":600,"gruppe":"forbruk","hvem":"felles"},{"id":"uforutsett","navn":"Uforutsett","belop":600,"gruppe":"forbruk","hvem":"felles"},{"id":"klaer","navn":"Klær og sko","belop":400,"gruppe":"forbruk","hvem":"meg"},{"id":"klaer-p2","navn":"Klær og sko","belop":400,"gruppe":"forbruk","hvem":"p2"},{"id":"fritid","navn":"Fritid og sosialt","belop":800,"gruppe":"forbruk","hvem":"meg"},{"id":"fritid-p2","navn":"Fritid og sosialt","belop":800,"gruppe":"forbruk","hvem":"p2"},{"id":"sparing","navn":"Sparing","belop":500,"gruppe":"sparing","hvem":"meg"},{"id":"sparing-p2","navn":"Sparing","belop":500,"gruppe":"sparing","hvem":"p2"}]}';
const GAMMEL_STANDARD = '{"inntekter":[{"id":"lan","navn":"Lånekassen (basislån)","belop":15488},{"id":"jobb","navn":"Deltidsjobb","belop":0},{"id":"annet-inn","navn":"Annen inntekt","belop":0}],"utgifter":[{"id":"husleie","navn":"Husleie","belop":5500,"gruppe":"fast"},{"id":"strom","navn":"Strøm og internett","belop":300,"gruppe":"fast"},{"id":"mobil","navn":"Mobil","belop":300,"gruppe":"fast"},{"id":"forsikring","navn":"Innboforsikring","belop":120,"gruppe":"fast"},{"id":"buss","navn":"Buss (Svipper)","belop":450,"gruppe":"fast"},{"id":"trening","navn":"Trening","belop":300,"gruppe":"fast"},{"id":"abonnement","navn":"Abonnementer","belop":200,"gruppe":"fast"},{"id":"semester","navn":"Semesteravgift","belop":120,"gruppe":"fast"},{"id":"mat","navn":"Matbutikk","belop":4000,"gruppe":"mat"},{"id":"kantine","navn":"Kantine og take-away","belop":400,"gruppe":"mat"},{"id":"hygiene","navn":"Hygiene og husholdning","belop":400,"gruppe":"forbruk"},{"id":"klaer","navn":"Klær og sko","belop":400,"gruppe":"forbruk"},{"id":"fritid","navn":"Fritid og sosialt","belop":800,"gruppe":"forbruk"},{"id":"uforutsett","navn":"Uforutsett","belop":400,"gruppe":"forbruk"},{"id":"sparing","navn":"Sparing","belop":500,"gruppe":"sparing"}]}';
const TYPISK_FELLES = new Set(['husleie', 'strom', 'forsikring', 'abonnement', 'mat', 'hygiene', 'uforutsett']);

const NOKKEL_PLAN = 'budsjett.plan';
const NOKKEL_BASIS = 'budsjett.planBasis'; // standardplanen slik den var da du sist lagret
const NOKKEL_POSTER = 'budsjett.poster';
const NOKKEL_LONN = 'budsjett.lonn';

function les(nokkel, standard) {
  try { const v = localStorage.getItem(nokkel); return v == null ? standard : JSON.parse(v); } catch { return standard; }
}
function skriv(nokkel, verdi) {
  try { localStorage.setItem(nokkel, JSON.stringify(verdi)); return true; } catch { return false; }
}
// Gir beskjed til synk.js (felles budsjett) om at noe er endret på denne telefonen
function varsle(hva, stille) {
  if (!stille && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('budsjett-lagret', { detail: hva }));
}

const lik = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Når standardplanen blir oppdatert (f.eks. nye tall fra deg), flettes den inn i den lagrede planen:
// linjer du ikke har rørt får de nye tallene, nye linjer legges til, og alt du har endret selv beholdes.
function flettListe(mine = [], basis = [], std = []) {
  const iBasis = new Map(basis.map((x) => [x.id, x]));
  const iStd = new Map(std.map((x) => [x.id, x]));
  const ut = mine.flatMap((l) => {
    const b = iBasis.get(l.id);
    if (!b || !lik(b, l)) return [l];
    const ny = iStd.get(l.id);
    return ny ? [structuredClone(ny)] : [];
  });
  const finnes = new Set(ut.map((x) => x.id));
  for (const l of std) if (!iBasis.has(l.id) && !finnes.has(l.id)) ut.push(structuredClone(l));
  return ut;
}

function flett(mine, basis, std) {
  if (lik(basis, std)) return mine;
  return {
    ...mine,
    personer: flettListe(mine.personer, basis.personer, std.personer),
    andelMeg: mine.andelMeg === basis.andelMeg ? std.andelMeg : mine.andelMeg,
    inntekter: flettListe(mine.inntekter, basis.inntekter, std.inntekter),
    utgifter: flettListe(mine.utgifter, basis.utgifter, std.utgifter),
  };
}

// Sørger for at eldre lagrede planer fortsatt virker, og tar inn oppdateringer i standardplanen.
export function normaliserPlan(p, basis = null) {
  if (!p) return lagNyPlan({ personer: [{ id: 'meg', navn: 'Meg' }] });
  const json = JSON.stringify(p);
  if (json === GAMMEL_STANDARD || json === STANDARD_V2 || json === STANDARD_V3) return structuredClone(STANDARD_PLAN);
  let plan = structuredClone(p);
  if (plan.type !== 'husstand' && Array.isArray(plan.personer) && plan.personer.length) {
    plan = flett(plan, basis || JSON.parse(STANDARD_V2), STANDARD_PLAN);
  }
  if (!Array.isArray(plan.personer) || !plan.personer.length) {
    plan.personer = structuredClone(STANDARD_PERSONER);
    plan.migrert = true;
  }
  if (!(plan.andelMeg >= 0 && plan.andelMeg <= 100)) plan.andelMeg = 50;
  // Andel av felles utgifter per person (eldre planer hadde bare andelMeg for to personer)
  if (plan.personer.some((x) => !(x.andel >= 0))) {
    if (plan.personer.length === 2) { plan.personer[0].andel ??= plan.andelMeg; plan.personer[1].andel ??= 100 - plan.andelMeg; }
    for (const x of plan.personer) if (!(x.andel >= 0)) x.andel = Math.round(100 / plan.personer.length);
  }
  plan.inntekter ??= [];
  plan.utgifter ??= [];
  const ider = new Set(plan.personer.map((x) => x.id));
  for (const l of plan.inntekter) if (!ider.has(l.hvem)) l.hvem = plan.personer[0].id;
  for (const l of plan.utgifter) {
    if (l.hvem !== 'felles' && !ider.has(l.hvem)) l.hvem = TYPISK_FELLES.has(l.id) ? 'felles' : plan.personer[0].id;
  }
  return plan;
}

export const harPlan = () => les(NOKKEL_PLAN, null) != null;
export const lesPlan = () => normaliserPlan(les(NOKKEL_PLAN, null), les(NOKKEL_BASIS, null));
export const lagrePlan = (plan, { stille = false } = {}) => {
  const ok = skriv(NOKKEL_PLAN, plan) && (plan.type === 'husstand' || skriv(NOKKEL_BASIS, STANDARD_PLAN));
  varsle('plan', stille);
  return ok;
};

// Telefoner som brukte budsjettet før oppstarten kom, men aldri lagret en egen plan, beholder oppsettet sitt.
export function sikreTidligereOppsett() {
  if (harPlan()) return false;
  const brukt = ['budsjett.poster', 'budsjett.lonn', 'budsjett.planBasis', 'budsjett.deling', 'tilbudsavis.varer', 'tilbudsavis.handleliste']
    .some((k) => { try { return localStorage.getItem(k) != null; } catch { return false; } });
  if (!brukt) return false;
  skriv(NOKKEL_PLAN, structuredClone(STANDARD_PLAN));
  skriv(NOKKEL_BASIS, STANDARD_PLAN);
  return true;
}
export const hentTidligereOppsett = () => structuredClone(STANDARD_PLAN);

// ---------- Ny husstand ----------
const MAL_FELLES = [
  ['husleie', 'Husleie', 'fast', 0], ['strom', 'Strøm', 'fast', 0], ['forsikring', 'Innboforsikring', 'fast', 150],
  ['abonnement', 'Abonnementer', 'fast', 300], ['mat', 'Matbutikk', 'mat', 3500, true], ['hygiene', 'Hygiene og husholdning', 'forbruk', 300, true],
  ['uforutsett', 'Uforutsett', 'forbruk', 300, true],
];
const MAL_PERSON = [
  ['mobil', 'Mobil', 'fast', 300], ['kantine', 'Kantine og take-away', 'mat', 300], ['klaer', 'Klær og sko', 'forbruk', 400],
  ['fritid', 'Fritid og sosialt', 'forbruk', 800], ['sparing', 'Sparing', 'sparing', 500],
];

function personlinjer(p) {
  return MAL_PERSON.map(([id, navn, gruppe, belop]) => ({ id: `${id}-${p.id}`, navn, belop, gruppe, hvem: p.id }));
}

function fordelAndeler(personer) {
  const n = personer.length || 1;
  personer.forEach((p, i) => { p.andel = i === n - 1 ? 100 - Math.floor(100 / n) * (n - 1) : Math.floor(100 / n); });
}

// personer: [{ id, navn, inntekt }]
export function lagNyPlan({ personer, husleie = 0, strom = 0 }) {
  const n = Math.max(1, personer.length);
  const plan = { type: 'husstand', personer: personer.map((p) => ({ id: p.id, navn: p.navn })), inntekter: [], utgifter: [] };
  fordelAndeler(plan.personer);
  for (const p of personer) plan.inntekter.push({ id: `inn-${p.id}`, navn: 'Inntekt', belop: Number(p.inntekt) || 0, hvem: p.id });
  for (const [id, navn, gruppe, belop, perHode] of MAL_FELLES) {
    const verdi = id === 'husleie' ? husleie : id === 'strom' ? strom : perHode ? belop * n : belop;
    plan.utgifter.push({ id, navn, belop: Number(verdi) || 0, gruppe, hvem: 'felles' });
  }
  for (const p of plan.personer) plan.utgifter.push(...personlinjer(p));
  return plan;
}

export function leggTilPerson(plan, navn) {
  const p = { id: nyId(), navn: navn || 'Ny person' };
  plan.personer.push(p);
  fordelAndeler(plan.personer);
  plan.inntekter.push({ id: `inn-${p.id}`, navn: 'Inntekt', belop: 0, hvem: p.id });
  plan.utgifter.push(...personlinjer(p));
  return p;
}

export function fjernPerson(plan, id) {
  if (plan.personer.length <= 1) return false;
  plan.personer = plan.personer.filter((p) => p.id !== id);
  plan.inntekter = plan.inntekter.filter((l) => l.hvem !== id);
  plan.utgifter = plan.utgifter.filter((l) => l.hvem !== id);
  fordelAndeler(plan.personer);
  return true;
}
export const lesPoster = () => les(NOKKEL_POSTER, []);
export const lagrePoster = (poster, { stille = false } = {}) => { const ok = skriv(NOKKEL_POSTER, poster); varsle('poster', stille); return ok; };
// Lønnsprofil per person: timer (per uke eller måned), timelønn (inkl. tips) og skattetrekk i prosent.
export const STANDARD_LONN = {
  slipper: [],
  valgt: 'meg',
  personer: {
    meg: { timer: 30, per: 'maaned', timelonn: 300, trekk: 5 },
    p2: { timer: 7.5, per: 'uke', timelonn: 220, trekk: 0 },
  },
};

export const lesLonn = () => {
  const l = les(NOKKEL_LONN, null) || {};
  const ut = structuredClone(STANDARD_LONN);
  if (Array.isArray(l.slipper)) ut.slipper = l.slipper;
  if (l.valgt) ut.valgt = l.valgt;
  else if (l.plan?.hvem) ut.valgt = l.plan.hvem; // eldre format
  for (const [id, pr] of Object.entries(l.personer || {})) ut.personer[id] = { ...(ut.personer[id] || {}), ...pr };
  return ut;
};

export function lonnsprofil(lonn, hvem) {
  return (lonn.personer[hvem] ??= { timer: 0, per: 'maaned', timelonn: 0, trekk: 0 });
}
export const lagreLonn = (lonn, { stille = false } = {}) => { const ok = skriv(NOKKEL_LONN, lonn); varsle('lonn', stille); return ok; };

export const nyId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function leggTilPost({ belop, kategori, dato = idag(), notat = '', ...ekstra }) {
  const poster = lesPoster();
  const post = { id: nyId(), dato, belop: Math.round(belop * 100) / 100, kategori, notat, ...ekstra };
  poster.push(post);
  lagrePoster(poster);
  return post;
}

// ---------- Datoer (norsk tid) ----------
const datoFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }); // gir YYYY-MM-DD
export const idag = () => datoFmt.format(new Date());
export const maanedAv = (dato) => dato.slice(0, 7); // 'YYYY-MM'

export function ukestart(dato = idag()) {
  const d = new Date(dato + 'T12:00:00Z');
  const dag = (d.getUTCDay() + 6) % 7; // mandag = 0
  d.setUTCDate(d.getUTCDate() - dag);
  return d.toISOString().slice(0, 10);
}

export function dagerIMaaned(maaned) {
  const [aar, mnd] = maaned.split('-').map(Number);
  return new Date(Date.UTC(aar, mnd, 0)).getUTCDate();
}

// ---------- Utregninger ----------
export const sum = (liste) => liste.reduce((s, x) => s + (Number(x.belop) || 0), 0);

// Andelen av felles utgifter en person betaler (person 1 = andelMeg, resten deler likt)
export function andelFor(plan, hvem) {
  const total = plan.personer.reduce((s, p) => s + (Number(p.andel) || 0), 0);
  const p = plan.personer.find((x) => x.id === hvem);
  if (!p) return 0;
  return total > 0 ? (Number(p.andel) || 0) / total : 1 / plan.personer.length;
}

// Matbudsjettet kan deles med egne prosenter (plan.matFordeling = { type: 'likt' | 'kalorier' | 'egen', andeler: { id: % } })
export function matAndelFor(plan, hvem) {
  const f = plan.matFordeling;
  if (!f || f.type === 'likt' || !f.andeler) return andelFor(plan, hvem);
  const total = plan.personer.reduce((s, p) => s + (Number(f.andeler[p.id]) || 0), 0);
  if (!(total > 0)) return andelFor(plan, hvem);
  return (Number(f.andeler[hvem]) || 0) / total;
}
export const harEgenMatdeling = (plan) => !!plan.matFordeling && plan.matFordeling.type !== 'likt' && !!plan.matFordeling.andeler;

// visning = 'alle' (hele husstanden) eller en person-id («min del»)
export function faktor(plan, linje, visning = 'alle') {
  if (visning === 'alle') return 1;
  if (linje.hvem === 'felles') return linje.gruppe === 'mat' ? matAndelFor(plan, visning) : andelFor(plan, visning);
  return linje.hvem === visning ? 1 : 0;
}

export function summerPlan(plan, visning = 'alle') {
  const inn = plan.inntekter.reduce((s, l) => s + (visning === 'alle' || l.hvem === visning ? Number(l.belop) || 0 : 0), 0);
  const perGruppe = Object.fromEntries(GRUPPER.map((g) => [g.id,
    plan.utgifter.filter((u) => u.gruppe === g.id).reduce((s, u) => s + (Number(u.belop) || 0) * faktor(plan, u, visning), 0)]));
  const ut = Object.values(perGruppe).reduce((a, b) => a + b, 0);
  return { inn, ut, perGruppe, tilOvers: inn - ut };
}

// Ukebudsjett for mat = månedsbudsjettet for «matbutikk»-linja (eller hele matgruppa) × 12 / 52
export function ukesMatbudsjett(plan = lesPlan()) {
  const matlinje = plan.utgifter.find((u) => u.id === 'mat');
  const maaned = matlinje ? Number(matlinje.belop) || 0 : sum(plan.utgifter.filter((u) => u.gruppe === 'mat'));
  return Math.round((maaned * 12) / 52);
}

export function matBruktDenneUka(poster = lesPoster(), plan = lesPlan()) {
  const start = ukestart();
  const matId = plan.utgifter.some((u) => u.id === 'mat') ? new Set(['mat']) : new Set(plan.utgifter.filter((u) => u.gruppe === 'mat').map((u) => u.id));
  return sum(poster.filter((p) => p.dato >= start && p.dato <= idag() && matId.has(p.kategori)));
}

// ---------- Lønn ----------
export const FERIEPENGESATS = 0.102; // vanlig sats etter ferieloven (4 uker + 1 dag)

export const nettoAv = (s) => (s.netto > 0 ? Number(s.netto) : Math.max(0, (Number(s.brutto) || 0) - (Number(s.skatt) || 0)));

export function lonnsstatistikk(slipper) {
  const med = slipper.filter((s) => s.iSnitt !== false && s.timer > 0 && s.brutto > 0);
  if (!med.length) return null;
  const timer = med.reduce((a, s) => a + Number(s.timer), 0);
  const brutto = med.reduce((a, s) => a + Number(s.brutto), 0);
  const netto = med.reduce((a, s) => a + nettoAv(s), 0);
  return { antall: med.length, timer, brutto, netto, perTimeBrutto: brutto / timer, perTimeNetto: netto / timer, trekkandel: 1 - netto / brutto };
}

export const FRIKORTGRENSE = 100000; // 2026, Skatteetaten (inkl. feriepenger)

export function anslagLonn(profil) {
  const timer = Number(profil.timer) || 0;
  const timerPerMaaned = profil.per === 'uke' ? (timer * 52) / 12 : timer;
  const brutto = timerPerMaaned * (Number(profil.timelonn) || 0);
  const nettoPerTime = (Number(profil.timelonn) || 0) * (1 - (Number(profil.trekk) || 0) / 100);
  const netto = timerPerMaaned * nettoPerTime;
  const feriepenger = brutto * FERIEPENGESATS;
  return { timerPerMaaned, brutto, netto, nettoPerTime, feriepenger, aarBrutto: brutto * 12, aarMedFerie: brutto * 12 + feriepenger * 12 };
}

export const kroner = (n) => Math.round(n).toLocaleString(LOK);


// ---------- Mat: profiler, husstand, meny, kjøkken, handleliste og logg ----------
const NOKKEL_MAT = 'hjem.mat';
export const STANDARD_MAT = {
  profiler: {},      // personId → svar fra spørsmålene
  husstand: {},      // svar som gjelder hele husstanden
  meny: {},          // 'YYYY-MM-DD' → { id, laast, spist }
  kjokken: {},       // varenøkkel → gram vi har
  handleliste: [],   // { id, vare, gram, tekst, haket }
  logg: [],          // { id, dato, oppskrift, porsjoner: { personId: porsjoner }, kcal: { personId: kcal } }
  vurderinger: {},   // oppskriftId → poeng (lærer hva dere liker)
};
export function lesMat() {
  const m = les(NOKKEL_MAT, null) || {};
  return { ...structuredClone(STANDARD_MAT), ...m };
}
export const lagreMat = (mat, { stille = false } = {}) => { const ok = skriv(NOKKEL_MAT, mat); varsle('mat', stille); return ok; };
