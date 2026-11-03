// Vekt én gang i uka: snitt per uke (ISO-uke), trend og om du er i rute mot målet.
// Målingene ligger i mat.vekt[personId] = [{ id, dato, kg }] og slettes aldri automatisk.

export function isoUke(dato) {
  const d = new Date(dato + 'T12:00:00Z');
  const dag = d.getUTCDay() || 7;
  const mandag = new Date(d); mandag.setUTCDate(d.getUTCDate() - dag + 1);
  d.setUTCDate(d.getUTCDate() + 4 - dag);
  const aar = d.getUTCFullYear();
  const uke = Math.ceil(((d - Date.UTC(aar, 0, 1)) / 864e5 + 1) / 7);
  return { aar, uke, nokkel: `${aar}-${String(uke).padStart(2, '0')}`, mandag: mandag.toISOString().slice(0, 10) };
}

// Én rad per uke med snittet av ukas målinger, eldst først
export function ukeserie(maalinger = []) {
  const per = new Map();
  for (const m of maalinger) {
    if (!(m.kg > 0) || !m.dato) continue;
    const u = isoUke(m.dato);
    const rad = per.get(u.nokkel) ?? { ...u, sum: 0, antall: 0, maalinger: [] };
    rad.sum += Number(m.kg); rad.antall++; rad.maalinger.push(m);
    per.set(u.nokkel, rad);
  }
  return [...per.values()].sort((a, b) => a.nokkel.localeCompare(b.nokkel))
    .map((r) => ({ nokkel: r.nokkel, aar: r.aar, uke: r.uke, mandag: r.mandag, kg: Math.round((r.sum / r.antall) * 10) / 10, antall: r.antall, maalinger: r.maalinger }));
}

// Endring i kg per uke over de siste ukene (minste kvadraters metode), eller null med bare én uke
export function trendPerUke(serie, uker = 6) {
  const s = serie.slice(-uker);
  if (s.length < 2) return null;
  const x0 = Date.parse(s[0].mandag);
  const xs = s.map((r) => (Date.parse(r.mandag) - x0) / (7 * 864e5)), ys = s.map((r) => r.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const teller = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const nevner = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return nevner ? teller / nevner : null;
}

// Vanlig og trygg fart per uke for hvert mål (kg). Negativt = ned.
export const MALFART = { ned: [-0.75, -0.25], nedmuskler: [-0.5, -0.1], holde: [-0.2, 0.2], muskler: [0.1, 0.35], opp: [0.2, 0.5] };

// Returnerer en norsk tekst med {kg} som plassholder, og en status
export function vurdering(mal, perUke) {
  if (perUke == null) return { status: 'for-lite', tekst: 'Før vekten én gang i uka, så ser du utviklingen og om du er i rute.' };
  const [lav, hoy] = MALFART[mal] || MALFART.holde;
  const kg = Math.abs(Math.round(perUke * 10) / 10);
  if (mal === 'ned' || mal === 'nedmuskler') {
    if (perUke > 0.1) return { status: 'feil-vei', kg, tekst: 'Vekten går opp ca. {kg} kg i uka. Prøv å holde deg litt under kalorimålet.' };
    if (perUke < lav) return { status: 'for-fort', kg, tekst: 'Du går ned ganske fort, ca. {kg} kg i uka. Spis gjerne litt mer, så holder du på musklene.' };
    if (perUke > hoy) return { status: 'sakte', kg, tekst: 'Vekten står nesten stille. Det er helt greit – vil du ned raskere, kan du spise litt mindre.' };
    return { status: 'i-rute', kg, tekst: 'I rute: du går ned ca. {kg} kg i uka.' };
  }
  if (mal === 'muskler' || mal === 'opp') {
    if (perUke < -0.1) return { status: 'feil-vei', kg, tekst: 'Vekten går ned ca. {kg} kg i uka. Spis litt mer for å nå målet ditt.' };
    if (perUke > hoy) return { status: 'for-fort', kg, tekst: 'Du går opp ganske fort, ca. {kg} kg i uka. Litt færre kalorier gir mer muskler og mindre fett.' };
    if (perUke < lav) return { status: 'sakte', kg, tekst: 'Vekten står nesten stille. Spis litt mer for å bygge muskler.' };
    return { status: 'i-rute', kg, tekst: 'I rute: du går opp ca. {kg} kg i uka.' };
  }
  if (perUke >= lav && perUke <= hoy) return { status: 'i-rute', kg, tekst: 'Vekten holder seg stabil 👍' };
  return perUke > 0
    ? { status: 'sakte', kg, tekst: 'Vekten går opp ca. {kg} kg i uka.' }
    : { status: 'sakte', kg, tekst: 'Vekten går ned ca. {kg} kg i uka.' };
}

// Hvor langt det er igjen til målvekta, og ca. hvor mange uker med farten nå
export function tilMalvekt(siste, malvekt, perUke) {
  if (!(malvekt > 0) || !(siste > 0)) return null;
  const igjen = Math.round((malvekt - siste) * 10) / 10;
  if (Math.abs(igjen) < 0.3) return { igjen: 0, nadd: true };
  const uker = perUke && Math.sign(perUke) === Math.sign(igjen) && Math.abs(perUke) >= 0.05 ? Math.ceil(igjen / perUke) : null;
  return { igjen, uker };
}
