// Leser tall ut av teksten på en norsk lønnsslipp (fra tekstgjenkjenning av et bilde).
// Ingen DOM her, så den kan testes med Node. Resultatet er et forslag brukeren sjekker før det lagres.

const MAANEDER = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];

const DATO = /\b(\d{1,2})\s?[./-]\s?(\d{1,2})\s?[./-]\s?(\d{4}|\d{2})\b/g;
const TALL = /-?\d+(?:[ .]\d{3})*(?:,\d{1,2})?-?/g;

function tilTall(s) {
  const neg = s.includes('-');
  const n = Number(s.replace(/-/g, '').replace(/[ .](?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// Tallene i en linje, uten datoer, prosenter og organisasjonsnumre
function tallI(linje) {
  const ren = linje.replace(DATO, ' ').replace(/\d+(?:,\d+)?\s?%/g, ' ').replace(/\b\d{3} ?\d{3} ?\d{3}\b/g, ' ');
  return (ren.match(TALL) || []).map(tilTall).filter((n) => n != null);
}

function etter(linje, re) {
  const m = linje.match(re);
  return m ? linje.slice(m.index + m[0].length) : linje;
}

function maanedFra(linjer) {
  const tekst = linjer.join('\n');
  const tilMaaned = (aar, mnd) => `${aar.length === 2 ? '20' + aar : aar}-${String(mnd).padStart(2, '0')}`;
  // 1) Periode-linje med dato
  for (const l of linjer) {
    if (!/periode/i.test(l)) continue;
    const d = [...l.matchAll(DATO)][0];
    if (d) return tilMaaned(d[3], Number(d[2]));
  }
  // 2) Månedsnavn + år («september 2026»)
  const m = tekst.toLowerCase().match(new RegExp(`\\b(${MAANEDER.join('|')})\\s+(\\d{4})\\b`));
  if (m) return tilMaaned(m[2], MAANEDER.indexOf(m[1]) + 1);
  // 3) «10/2026» eller «2026-10»
  const kort = tekst.match(/\b(0?[1-9]|1[0-2])\s?\/\s?(20\d{2})\b/) || tekst.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (kort) return kort[1].length === 4 ? `${kort[1]}-${kort[2]}` : tilMaaned(kort[2], Number(kort[1]));
  // 4) Første dato (ofte utbetalingsdato)
  const d = [...tekst.matchAll(DATO)][0];
  return d ? tilMaaned(d[3], Number(d[2])) : null;
}

const UTELAT = /hittil|i år|i aar|akkumulert|grunnlag|opptjent|saldo|tidligere|forrige/i;

function sisteBelop(linjer, mønstre) {
  for (const re of mønstre) {
    for (const l of linjer) {
      if (!re.test(l) || UTELAT.test(l)) continue;
      const tall = tallI(etter(l, re));
      if (tall.length) return Math.abs(tall[tall.length - 1]);
    }
  }
  return null;
}

function timerFra(linjer) {
  let sum = 0;
  let funnet = false;
  const timeLinje = /tim(e|er)?l[øo]nn|\btimer\b|ordin[æa]r|grunnl[øo]nn|overtid|time(?:r)? jobbet|antall timer/i;
  for (const l of linjer) {
    if (!timeLinje.test(l) || UTELAT.test(l) || /tillegg|sum|totalt|sats/i.test(l)) continue;
    const rest = etter(l, timeLinje);
    const tall = tallI(rest).map(Math.abs);
    if (!tall.length) continue;
    let timer = null;
    const passer = (a, b, c) => a > 0 && a <= 400 && b > 0 && Math.abs(a * b - c) <= Math.max(2, c * 0.02);
    // «30 220,00 6 600,00»: antall uten desimaler kan smelte sammen med satsen – prøv også ord for ord
    const ord = rest.replace(DATO, ' ').replace(/\d+(?:,\d+)?\s?%/g, ' ').trim().split(' ').filter((t) => /^-?[\d.,]+-?$/.test(t));
    const [oa, ob, ...oc] = ord.map((t) => t);
    const alt = ord.length >= 3 ? [tilTall(oa), tilTall(ob), tilTall(oc.join(''))].map((n) => Math.abs(n ?? NaN)) : null;
    if (tall.length >= 3 && passer(...tall.slice(-3))) {
      timer = tall[tall.length - 3];
    } else if (alt && passer(...alt)) {
      timer = alt[0];
    } else if (tall.length === 2) {
      const [a, c] = tall;
      if (a > 0 && a <= 400 && c / a >= 100 && c / a <= 1500) timer = a;
    } else if (/\btimer\b|antall timer|time(?:r)? jobbet/i.test(l) && tall[0] <= 400) {
      timer = tall[0];
    }
    if (timer != null) { sum += timer; funnet = true; }
  }
  return funnet ? Math.round(sum * 100) / 100 : null;
}

export function tolkLonnsslipp(tekst) {
  const linjer = String(tekst || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const maaned = maanedFra(linjer);
  const timer = timerFra(linjer);
  let brutto = sisteBelop(linjer, [/sum brutto|brutto ?l[øo]nn|bruttobel[øo]p|sum l[øo]nn/i, /\bbrutto\b/i]);
  let skatt = sisteBelop(linjer, [/forskuddstrekk|skattetrekk|tabelltrekk|prosenttrekk/i, /\bskatt\b/i]);
  let netto = sisteBelop(linjer, [/netto ?utbetalt|til utbetaling|utbetalt bel[øo]p|[åa] utbetale|sum utbetalt|nettol[øo]nn/i, /\bnetto\b|\butbetalt\b|utbetales/i]);
  const tips = sisteBelop(linjer, [/\btips\b|\bdriks\b/i]);
  const feriepenger = sisteBelop(linjer, [/feriepenger/i]);

  if (brutto == null && netto != null && skatt != null) brutto = netto + skatt;
  if (netto == null && brutto != null) netto = brutto - (skatt || 0);
  if (skatt == null && brutto != null && netto != null && netto <= brutto) skatt = 0;
  if (brutto != null && netto != null && netto > brutto * 1.01) [brutto, netto] = [netto, brutto];

  const funnet = Object.entries({ maaned, timer, brutto, skatt, netto }).filter(([, v]) => v != null).map(([k]) => k);
  return { maaned, timer, brutto, skatt, netto, tips, feriepenger, funnet, timelonn: timer && brutto ? brutto / timer : null };
}
