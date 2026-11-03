// Felles budsjettlogikk – brukes av /budsjett/ og av tilbudsavisen (/tilbud/).
// Alt lagres i nettleseren (localStorage) på eidert.no, så begge sidene ser de samme tallene.

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

// Budsjett for Henrik og Hanna i Tromsø, studieåret 2026–2027. Husleie, strøm og støtte er deres tall;
// resten er anslag som kan endres på siden.
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
  if (!p) return structuredClone(STANDARD_PLAN);
  const json = JSON.stringify(p);
  if (json === GAMMEL_STANDARD || json === STANDARD_V2 || json === STANDARD_V3) return structuredClone(STANDARD_PLAN);
  let plan = structuredClone(p);
  if (Array.isArray(plan.personer) && plan.personer.length) {
    plan = flett(plan, basis || JSON.parse(STANDARD_V2), STANDARD_PLAN);
  }
  if (!Array.isArray(plan.personer) || !plan.personer.length) {
    plan.personer = structuredClone(STANDARD_PERSONER);
    plan.migrert = true;
  }
  if (!(plan.andelMeg >= 0 && plan.andelMeg <= 100)) plan.andelMeg = 50;
  plan.inntekter ??= [];
  plan.utgifter ??= [];
  const ider = new Set(plan.personer.map((x) => x.id));
  for (const l of plan.inntekter) if (!ider.has(l.hvem)) l.hvem = plan.personer[0].id;
  for (const l of plan.utgifter) {
    if (l.hvem !== 'felles' && !ider.has(l.hvem)) l.hvem = TYPISK_FELLES.has(l.id) ? 'felles' : plan.personer[0].id;
  }
  return plan;
}

export const lesPlan = () => normaliserPlan(les(NOKKEL_PLAN, null), les(NOKKEL_BASIS, null));
export const lagrePlan = (plan, { stille = false } = {}) => { const ok = skriv(NOKKEL_PLAN, plan) && skriv(NOKKEL_BASIS, STANDARD_PLAN); varsle('plan', stille); return ok; };
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

export function leggTilPost({ belop, kategori, dato = idag(), notat = '' }) {
  const poster = lesPoster();
  const post = { id: nyId(), dato, belop: Math.round(belop * 100) / 100, kategori, notat };
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
  const [forste, ...andre] = plan.personer;
  if (!forste) return 1;
  if (hvem === forste.id) return andre.length ? plan.andelMeg / 100 : 1;
  return andre.length ? (1 - plan.andelMeg / 100) / andre.length : 0;
}

// visning = 'alle' (hele husstanden) eller en person-id («min del»)
export function faktor(plan, linje, visning = 'alle') {
  if (visning === 'alle') return 1;
  if (linje.hvem === 'felles') return andelFor(plan, visning);
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

export const kroner = (n) => Math.round(n).toLocaleString('nb-NO');
