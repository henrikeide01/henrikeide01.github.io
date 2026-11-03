// Felles budsjett på flere telefoner (Henrik og Hanna).
// Alt krypteres på telefonen med husstandskoden (AES-GCM, nøkkel fra PBKDF2) før det sendes til
// Firebase-databasen. Databasen lagrer bare uleselig tekst – uten koden kan ingen lese budsjettet.
import { lesPlan, lagrePlan, lesPoster, lagrePoster, lesLonn, lagreLonn, lesMat, lagreMat } from './budsjett.js';

// Det som synkes som én helhet (sist lagret vinner). Utgifter synkes hver for seg.
const DELER = [
  { navn: 'plan', les: lesPlan, lagre: lagrePlan },
  { navn: 'lonn', les: lesLonn, lagre: lagreLonn },
  { navn: 'mat', les: lesMat, lagre: lagreMat },
];

export const DB = 'https://eidert-default-rtdb.europe-west1.firebasedatabase.app';
const NOKKEL = 'budsjett.deling';
const TEGN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // uten I, O, 0 og 1

const les = () => { try { return JSON.parse(localStorage.getItem(NOKKEL)) || null; } catch { return null; } };
const skriv = (d) => { try { d ? localStorage.setItem(NOKKEL, JSON.stringify(d)) : localStorage.removeItem(NOKKEL); } catch {} };
export const deling = les;
export const erDelt = () => !!les()?.kode;

export function normaliserKode(kode) {
  const k = String(kode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return k.match(/.{1,4}/g)?.join('-') || '';
}

export function nyKode() {
  const tall = crypto.getRandomValues(new Uint8Array(16));
  return normaliserKode([...tall].map((n) => TEGN[n % TEGN.length]).join(''));
}

export const delingslenke = (kode) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}#bli-med=${kode}`;

// ---------- Kryptering ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
const tilB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fraB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const nokler = new Map();

async function krypto(kode) {
  const k = normaliserKode(kode);
  if (nokler.has(k)) return nokler.get(k);
  const hash = await crypto.subtle.digest('SHA-256', enc.encode('eidert-budsjett|' + k));
  const husId = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  const base = await crypto.subtle.importKey('raw', enc.encode(k), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('eidert-budsjett-v1'), iterations: 150000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  const v = { husId, key };
  nokler.set(k, v);
  return v;
}

async function krypter(key, verdi) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(verdi)));
  return `${tilB64(iv)}.${tilB64(ct)}`;
}

async function dekrypter(key, tekst) {
  const [iv, ct] = String(tekst).split('.');
  const ren = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fraB64(iv) }, key, fraB64(ct));
  return JSON.parse(dec.decode(ren));
}

// ---------- Database (Firebase REST) ----------
export class SynkFeil extends Error {
  constructor(melding, type) { super(melding); this.type = type; }
}

async function kall(metode, url, kropp) {
  let res;
  try {
    res = await fetch(url, { method: metode, headers: kropp ? { 'Content-Type': 'application/json' } : {}, body: kropp ? JSON.stringify(kropp) : undefined });
  } catch {
    throw new SynkFeil('Fikk ikke kontakt med databasen. Er du på nett?', 'nett');
  }
  if (!res.ok) {
    const tekst = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403 || /permission/i.test(tekst)) throw new SynkFeil('Databasen tillater ikke lagring av budsjettet ennå.', 'nektet');
    throw new SynkFeil(`Databasen svarte med feil (${res.status}).`, 'server');
  }
  return res.status === 204 ? null : res.json();
}

const sti = (husId, del = '') => `${DB}/budsjett/${husId}${del}.json`;

// ---------- Endringer på denne telefonen ----------
// budsjett.js sender «budsjett-lagret» når plan eller lønn lagres; da merker vi det for opplasting.
let ventetid = null;
let lytter = null;
if (typeof window !== 'undefined') {
  window.addEventListener('budsjett-lagret', (e) => {
    const d = les();
    if (!d?.kode) return;
    if (DELER.some((x) => x.navn === e.detail)) d[`${e.detail}Endret`] = Date.now();
    skriv(d);
    clearTimeout(ventetid);
    ventetid = setTimeout(() => synk().then((r) => r.endret && lytter?.(r)).catch(() => {}), 1200);
  });
}

// ---------- Synkronisering ----------
let paagaar = null;

export function synk() {
  if (paagaar) return paagaar;
  paagaar = (async () => {
    const d = les();
    if (!d?.kode) return { endret: false };
    const { husId, key } = await krypto(d.kode);
    const alt = () => JSON.stringify([lesPoster(), ...DELER.map((x) => x.les())]);
    const foer = alt();

    // 1) Send det som er nytt her siden sist
    const lokale = lesPoster();
    const ider = new Set(lokale.map((p) => p.id));
    const kjente = new Set(d.kjente || []);
    const endring = {};
    for (const p of lokale) if (!kjente.has(p.id)) endring[`poster/${p.id}`] = { d: await krypter(key, p) };
    for (const id of kjente) if (!ider.has(id)) { endring[`poster/${id}`] = null; endring[`slettet/${id}`] = { '.sv': 'timestamp' }; }
    const endretFoer = Object.fromEntries(DELER.map((x) => [x.navn, d[`${x.navn}Endret`] || 0]));
    for (const x of DELER) if (endretFoer[x.navn]) endring[x.navn] = { d: await krypter(key, x.les()), t: { '.sv': 'timestamp' } };
    if (Object.keys(endring).length) await kall('PATCH', sti(husId), endring);

    // 2) Hent alt og bruk det felles
    const fjern = (await kall('GET', sti(husId))) || {};
    const slettet = new Set(Object.keys(fjern.slettet || {}));
    const poster = (await Promise.all(Object.values(fjern.poster || {}).map((v) => dekrypter(key, v.d).catch(() => null))))
      .filter((p) => p && !slettet.has(p.id));
    const naa = les() || d;
    // Poster som er lagt til her mens vi synket, sendes neste gang
    const nyeImens = lesPoster().filter((p) => !ider.has(p.id) && !kjente.has(p.id));
    lagrePoster([...poster, ...nyeImens.filter((p) => !poster.some((x) => x.id === p.id))], { stille: true });
    naa.kjente = poster.map((p) => p.id);

    for (const x of DELER) {
      const f = fjern[x.navn];
      if (!f?.d || (f.t === naa[`${x.navn}Sett`] && !endretFoer[x.navn])) continue;
      if ((naa[`${x.navn}Endret`] || 0) === endretFoer[x.navn]) {
        x.lagre(await dekrypter(key, f.d), { stille: true });
        naa[`${x.navn}Endret`] = 0;
      }
      naa[`${x.navn}Sett`] = f.t;
    }
    naa.sist = Date.now();
    naa.feil = null;
    skriv(naa);
    return { endret: alt() !== foer };
  })().catch((e) => {
    const d = les();
    if (d) { d.feil = e.type || 'ukjent'; skriv(d); }
    throw e;
  }).finally(() => { paagaar = null; });
  return paagaar;
}

// Start deling fra denne telefonen: lager kode og laster opp alt som ligger her
export async function startDeling(jeg) {
  const kode = nyKode();
  skriv({ kode, jeg, kjente: [], planEndret: Date.now(), lonnEndret: Date.now(), matEndret: Date.now() });
  try {
    await synk();
  } catch (e) {
    skriv(null);
    throw e;
  }
  return kode;
}

// Bli med i et budsjett som noen andre har delt. Returnerer personene, så brukeren kan velge hvem hen er.
export async function finnDelt(kode) {
  const k = normaliserKode(kode);
  if (k.replace(/-/g, '').length < 12) throw new SynkFeil('Koden er for kort.', 'kode');
  const { husId, key } = await krypto(k);
  const fjern = await kall('GET', sti(husId, '/plan'));
  if (!fjern?.d) throw new SynkFeil('Fant ikke noe felles budsjett med denne koden.', 'kode');
  let plan;
  try { plan = await dekrypter(key, fjern.d); } catch { throw new SynkFeil('Koden stemmer ikke.', 'kode'); }
  return { kode: k, personer: plan.personer || [] };
}

export async function bliMed(kode, jeg) {
  skriv({ kode: normaliserKode(kode), jeg, kjente: [], planEndret: 0, lonnEndret: 0, matEndret: 0 });
  lagrePoster([], { stille: true }); // budsjettet på denne telefonen byttes ut med det felles
  await synk();
}

export function settJeg(jeg) {
  const d = les();
  if (d) { d.jeg = jeg; skriv(d); }
}

export function kobleFra() { skriv(null); }

// Hent jevnlig mens siden er åpen, og når du kommer tilbake til den
export function startAutoSynk(vedEndring) {
  lytter = vedEndring;
  const kjor = () => { if (erDelt() && document.visibilityState === 'visible') synk().then((r) => vedEndring?.(r)).catch((e) => vedEndring?.({ endret: false, feil: e })); };
  kjor();
  setInterval(kjor, 20000);
  document.addEventListener('visibilitychange', kjor);
  window.addEventListener('online', kjor);
}
