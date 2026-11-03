// Leser totalbeløp, butikk og dato fra teksten på en kvittering (fra tekstgjenkjenning).

const BUTIKKER = [
  [/rema\s*1000|rema/i, 'REMA 1000'], [/coop\s*extra|\bextra\b/i, 'Coop Extra'], [/coop\s*obs|\bobs\b/i, 'Coop Obs'], [/coop\s*prix|\bprix\b/i, 'Coop Prix'],
  [/coop\s*mega|\bmega\b/i, 'Coop Mega'], [/eurospar|euro\s*spar/i, 'Eurospar'], [/\bspar\b/i, 'Spar'], [/\bkiwi\b/i, 'Kiwi'], [/\bmeny\b/i, 'Meny'],
  [/\bjoker\b/i, 'Joker'], [/bunnpris/i, 'Bunnpris'], [/\bcoop\b/i, 'Coop'], [/narvesen/i, 'Narvesen'], [/7-?eleven/i, '7-Eleven'], [/circle\s*k/i, 'Circle K'],
];
export const MATBUTIKKER = new Set(['REMA 1000', 'Coop Extra', 'Coop Obs', 'Coop Prix', 'Coop Mega', 'Eurospar', 'Spar', 'Kiwi', 'Meny', 'Joker', 'Bunnpris', 'Coop']);

// Ord som står ved totalen, i den rekkefølgen de stoles på
const TOTAL = [/(å|a|ä)\s*betale/i, /\btotal[t]?\b|\bsum\b|\bsum\s*nok\b/i, /\bbetalt\b|bankaxept|\bbax\b|visa|mastercard|\bkort\b/i];
const IKKE = /mva|grunnlag|spart|rabatt|bonus|trumf|poeng|antall|vekt|kg\b|tilbake|veksel/i;
const BELOP = /(\d{1,3}(?:[ .]\d{3})+|\d+)\s*[,.]\s*(\d{2})(?!\d)/g;

const tilTall = (heltall, ore) => Number(String(heltall).replace(/[ .]/g, '')) + Number(ore) / 100;
function belopI(linje) {
  const ut = [];
  for (const m of linje.matchAll(BELOP)) ut.push(tilTall(m[1], m[2]));
  return ut;
}

export function tolkKvittering(tekst, { idag = new Date().toISOString().slice(0, 10) } = {}) {
  const linjer = String(tekst || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const funnet = [];
  // Totalen: første nøkkelord som har et beløp på samme linje (eller linja under)
  let belop = null;
  for (const re of TOTAL) {
    for (let i = 0; i < linjer.length && belop == null; i++) {
      const l = linjer[i];
      if (!re.test(l) || IKKE.test(l)) continue;
      const her = belopI(l);
      const tall = her.length ? her : belopI(linjer[i + 1] || '');
      if (tall.length) belop = tall[tall.length - 1];
    }
    if (belop != null) break;
  }
  // Ellers: det største beløpet på kvitteringen
  if (belop == null) {
    const alle = linjer.filter((l) => !IKKE.test(l)).flatMap(belopI).filter((x) => x > 0 && x < 20000);
    if (alle.length) belop = Math.max(...alle);
  }
  if (belop != null) funnet.push('belop');

  let butikk = null;
  for (const l of linjer.slice(0, 12).concat(linjer)) { const b = BUTIKKER.find(([re]) => re.test(l)); if (b) { butikk = b[1]; break; } }
  if (butikk) funnet.push('butikk');

  let dato = null;
  for (const m of String(tekst || '').matchAll(/(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g)) {
    const d = Number(m[1]), mnd = Number(m[2]); let aar = Number(m[3]); if (aar < 100) aar += 2000;
    if (d < 1 || d > 31 || mnd < 1 || mnd > 12) continue;
    const iso = `${aar}-${String(mnd).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dager = (Date.parse(idag) - Date.parse(iso)) / 864e5;
    if (dager >= 0 && dager <= 120) { dato = iso; break; }
  }
  if (dato) funnet.push('dato');
  return { belop: belop != null ? Math.round(belop * 100) / 100 : null, butikk, dato, matbutikk: butikk ? MATBUTIKKER.has(butikk) : false, funnet };
}
