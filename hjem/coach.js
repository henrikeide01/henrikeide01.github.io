// Coach: påminnelser som kalenderfil (.ics), rekker og standardvalg. Ingen DOM her.

export const UKEDAGER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']; // indeks 0 = mandag

const pad = (n) => String(n).padStart(2, '0');
export const plussDager = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const ukedag = (iso) => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; // 1 = mandag … 7 = søndag
const gyldigTid = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const gyldigDag = (n) => Number.isInteger(n) && n >= 1 && n <= 7;

// Treningsdager som passer med antall økter i uka
const TRENINGSDAGER = { 1: [3], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 7] };
export const treningsdagerFor = (okter) => TRENINGSDAGER[Number(okter)] || [];

export function standardPaaminnelser({ oktMal = 0 } = {}) {
  const dager = treningsdagerFor(oktMal);
  return {
    veiing: { pa: true, dag: 1, tid: '07:30' },
    vann: { pa: true, tider: ['10:00', '14:00', '18:00'] },
    mat: { pa: true, tid: '20:30' },
    trening: { pa: dager.length > 0, dager, tid: '17:00' },
    handle: { pa: false, dag: 6, tid: '11:00' },
    uke: { pa: true, dag: 7, tid: '19:00' },
  };
}

// Det som er lagret, fylt ut med standardverdier der noe mangler eller er ugyldig
export function fyllPaaminnelser(lagret, standard) {
  const ut = {};
  for (const [id, std] of Object.entries(standard)) {
    const l = lagret?.[id] || {};
    const r = { pa: typeof l.pa === 'boolean' ? l.pa : std.pa };
    if ('tid' in std) r.tid = gyldigTid(l.tid) ? l.tid : std.tid;
    if ('dag' in std) r.dag = gyldigDag(l.dag) ? l.dag : std.dag;
    if ('tider' in std) r.tider = std.tider.map((s, i) => (gyldigTid(l.tider?.[i]) ? l.tider[i] : s));
    if ('dager' in std) r.dager = Array.isArray(l.dager) ? [...new Set(l.dager.filter(gyldigDag))].sort() : std.dager;
    ut[id] = r;
  }
  return ut;
}

// Hendelser (én per påminnelse og klokkeslett) ut fra innstillingene. tekster: id → { tittel, tekst }
export function hendelserFor(p, tekster) {
  const h = [];
  const legg = (id, type, tid, dager) => { const tx = tekster[type]; if (tx && gyldigTid(tid)) h.push({ id, tid, dager, tittel: tx.tittel, tekst: tx.tekst }); };
  if (p.veiing?.pa) legg('veiing', 'veiing', p.veiing.tid, [p.veiing.dag]);
  if (p.vann?.pa) p.vann.tider.forEach((tid, i) => legg(`vann-${i + 1}`, 'vann', tid, null));
  if (p.mat?.pa) legg('mat', 'mat', p.mat.tid, null);
  if (p.trening?.pa && p.trening.dager?.length) legg('trening', 'trening', p.trening.tid, p.trening.dager);
  if (p.handle?.pa) legg('handle', 'handle', p.handle.tid, [p.handle.dag]);
  if (p.uke?.pa) legg('uke', 'uke', p.uke.tid, [p.uke.dag]);
  return h;
}

const escIcs = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// RFC 5545: høyst 75 oktetter per linje, fortsettelser starter med mellomrom
function brett(linje) {
  const enc = new TextEncoder(), deler = [];
  let del = '', lengde = 0;
  for (const tegn of linje) {
    const n = enc.encode(tegn).length;
    if (lengde + n > (deler.length ? 74 : 75)) { deler.push(del); del = ''; lengde = 0; }
    del += tegn; lengde += n;
  }
  deler.push(del);
  return deler.join('\r\n ');
}
export const tidsstempel = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Gjentakende hendelser med varsel på selve tidspunktet. Flytende lokal tid, så den følger telefonens tidssone.
export function lagIcs({ hendelser, idag, url, kalendernavn, stempel }) {
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//eidert.no//Hjemme coach//NO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escIcs(kalendernavn)}`];
  for (const h of hendelser) {
    const [tt, mm] = h.tid.split(':').map(Number);
    const dager = h.dager?.length ? [...new Set(h.dager)].sort() : null;
    let start = idag;
    if (dager) for (let i = 0; i < 7; i++) { const d = plussDager(idag, i); if (dager.includes(ukedag(d))) { start = d; break; } }
    l.push(
      'BEGIN:VEVENT',
      `UID:hjem-${h.id}@eidert.no`,
      `DTSTAMP:${stempel}`,
      `DTSTART:${start.replace(/-/g, '')}T${pad(tt)}${pad(mm)}00`,
      'DURATION:PT15M',
      dager ? `RRULE:FREQ=WEEKLY;BYDAY=${dager.map((d) => UKEDAGER[d - 1]).join(',')}` : 'RRULE:FREQ=DAILY',
      `SUMMARY:${escIcs(h.tittel)}`,
      `DESCRIPTION:${escIcs(`${h.tekst}\n${url}`)}`,
      `URL:${url}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(h.tittel)}`, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT',
    );
  }
  l.push('END:VCALENDAR');
  return `${l.map(brett).join('\r\n')}\r\n`;
}

// Antall dager på rad (som ender i dag, eller i går hvis i dag ikke er gjort ennå)
export function rekke(datoer, idag) {
  const sett = datoer instanceof Set ? datoer : new Set(datoer);
  let d = sett.has(idag) ? idag : plussDager(idag, -1), n = 0;
  while (sett.has(d) && n < 3660) { n++; d = plussDager(d, -1); }
  return n;
}

// Antall uker på rad med veiing. nokkelFor(mandag) → ukenøkkel
export function ukerekke(nokler, mandag, nokkelFor) {
  const sett = nokler instanceof Set ? nokler : new Set(nokler);
  let m = sett.has(nokkelFor(mandag)) ? mandag : plussDager(mandag, -7), n = 0;
  while (sett.has(nokkelFor(m)) && n < 520) { n++; m = plussDager(m, -7); }
  return n;
}

// Hvor mye av dagens vann som burde vært drukket nå (fra kl. 8 til 21)
export function vannForventet(mal, minutter) {
  const andel = Math.max(0, Math.min(1, (minutter - 8 * 60) / (13 * 60)));
  return Math.floor(mal * andel);
}

// Når et måltid regnes som «burde vært ført»
export const MALTID_FRIST = { frokost: 10 * 60 + 30, lunsj: 14 * 60, mellom: 16 * 60 + 30, middag: 19 * 60 + 30, kveld: 22 * 60 };
