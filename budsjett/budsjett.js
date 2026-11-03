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

// Startforslag for en student i Tromsø, studieåret 2026–2027. Alt kan endres på siden.
export const STANDARD_PLAN = {
  inntekter: [
    { id: 'lan', navn: 'Lånekassen (basislån)', belop: 15488 },
    { id: 'jobb', navn: 'Deltidsjobb', belop: 0 },
    { id: 'annet-inn', navn: 'Annen inntekt', belop: 0 },
  ],
  utgifter: [
    { id: 'husleie', navn: 'Husleie', belop: 5500, gruppe: 'fast' },
    { id: 'strom', navn: 'Strøm og internett', belop: 300, gruppe: 'fast' },
    { id: 'mobil', navn: 'Mobil', belop: 300, gruppe: 'fast' },
    { id: 'forsikring', navn: 'Innboforsikring', belop: 120, gruppe: 'fast' },
    { id: 'buss', navn: 'Buss (Svipper)', belop: 450, gruppe: 'fast' },
    { id: 'trening', navn: 'Trening', belop: 300, gruppe: 'fast' },
    { id: 'abonnement', navn: 'Abonnementer', belop: 200, gruppe: 'fast' },
    { id: 'semester', navn: 'Semesteravgift', belop: 120, gruppe: 'fast' },
    { id: 'mat', navn: 'Matbutikk', belop: 4000, gruppe: 'mat' },
    { id: 'kantine', navn: 'Kantine og take-away', belop: 400, gruppe: 'mat' },
    { id: 'hygiene', navn: 'Hygiene og husholdning', belop: 400, gruppe: 'forbruk' },
    { id: 'klaer', navn: 'Klær og sko', belop: 400, gruppe: 'forbruk' },
    { id: 'fritid', navn: 'Fritid og sosialt', belop: 800, gruppe: 'forbruk' },
    { id: 'uforutsett', navn: 'Uforutsett', belop: 400, gruppe: 'forbruk' },
    { id: 'sparing', navn: 'Sparing', belop: 500, gruppe: 'sparing' },
  ],
};

const NOKKEL_PLAN = 'budsjett.plan';
const NOKKEL_POSTER = 'budsjett.poster';

function les(nokkel, standard) {
  try { const v = localStorage.getItem(nokkel); return v == null ? standard : JSON.parse(v); } catch { return standard; }
}
function skriv(nokkel, verdi) {
  try { localStorage.setItem(nokkel, JSON.stringify(verdi)); return true; } catch { return false; }
}

export const lesPlan = () => les(NOKKEL_PLAN, null) || structuredClone(STANDARD_PLAN);
export const lagrePlan = (plan) => skriv(NOKKEL_PLAN, plan);
export const harEgenPlan = () => les(NOKKEL_PLAN, null) != null;
export const lesPoster = () => les(NOKKEL_POSTER, []);
export const lagrePoster = (poster) => skriv(NOKKEL_POSTER, poster);

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

export function summerPlan(plan) {
  const inn = sum(plan.inntekter);
  const perGruppe = Object.fromEntries(GRUPPER.map((g) => [g.id, sum(plan.utgifter.filter((u) => u.gruppe === g.id))]));
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

export const kroner = (n) => Math.round(n).toLocaleString('nb-NO');
