// Felles logikk for tilbudsavisen: finne hvilke tilbud som gjelder «mine varer»,
// og vurdere hvor gode de er. Ingen DOM her, så filen kan testes med Node.

export function normaliser(s) {
  return ' ' + String(s || '')
    .toLowerCase()
    .replace(/[’'`´]/g, ' ')
    .replace(/[éè]/g, 'e')
    .replace(/[^a-z0-9æøåäö%]+/g, ' ')
    .trim() + ' ';
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Et søkeord i "anførselstegn" må være et helt ord ("egg" treffer ikke «eggenudler»).
// Ellers holder det at ordet står et sted i navnet («laks» treffer «laksefilet»).
function lagTest(ord) {
  const helt = /^\s*["“”«»].*["“”«»]\s*$/.test(ord);
  const n = normaliser(ord.replace(/["“”«»]/g, '')).trim();
  if (!n) return null;
  if (helt) {
    const re = new RegExp(` ${escRe(n)} `);
    return (tekst) => re.test(tekst);
  }
  return (tekst) => tekst.includes(n);
}

const delOpp = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => s.trim()).filter(Boolean);

export function lagMatcher(vare) {
  const ja = delOpp(vare.sok?.length ? vare.sok : [vare.navn]).map(lagTest).filter(Boolean);
  const nei = delOpp(vare.ikke).map(lagTest).filter(Boolean);
  return (tittel) => {
    const t = normaliser(tittel);
    return ja.some((f) => f(t)) && !nei.some((f) => f(t));
  };
}

// Ord som avslører at et tilbud ikke er mat (brukes for «andre kupp»).
const IKKE_MAT = [
  'libresse', 'truseinnlegg', 'bind ', 'tampong', 'bleie', 'pampers', 'libero',
  'sjampo', 'shampoo', 'balsam', 'dusj', 'såpe', 'roll on', 'deodorant', ' deo ', ' axe ', 'garnier', 'micellar',
  'l oréal', 'l oreal', 'nivea', 'colgate', 'tannkrem', 'tannbørste', 'carmex', 'leppepomade', 'salvequick', 'plaster',
  'apobase', 'oily cream', 'bomull', 'softlan', 'tøymykner', 'vaskemiddel', 'oppvask', 'toalettpapir', 'tørkepapir', 'lambi',
  'bakepapir', 'folie', 'gavepapir', 'tape', 'batteri', 'lyspære', ' led ', 'kleshenger', 'klesrulle', 'airfryer filter',
  'krus ', ' kopp ', 'kopper', 'brille', 'ullgenser', 'sokk', 'boxer', 'pysj', 'undertøy', 'genser', 'jakke', 'bukse', 'regnsett', 'skøyter',
  'felleski', 'alpinski', 'akeplate', 'dockboot', 'støvsuger', 'varmepumpe', 'stekepanne', 'plancha', 'muttertrekker',
  'skjærebrett', 'kjøkkenredskap', 'hot wheels', 'julekalender', 'grunnboka', 'bukett', 'roser', 'tulipan', 'kaktus',
  'orkidé', 'orkide', 'krysantemum', 'helleborus', 'blomst', 'potteplante', 'earth control', 'kattemat', 'hundemat',
];

export function erMat(tilbud) {
  const t = normaliser(tilbud.tittel);
  return !IKKE_MAT.some((o) => t.includes(o));
}

export function kr(n, desimaler = true) {
  if (n == null) return '';
  const fast = desimaler && Math.round(n) !== n;
  return n.toLocaleString('nb-NO', { minimumFractionDigits: fast ? 2 : 0, maximumFractionDigits: fast ? 2 : 0 });
}

// Tidligere tilbud på samme vare (fra historikken), uten ukene som gjelder nå.
export function lagHistorikk(vare, historikk, naavaerendeIder) {
  if (!historikk) return null;
  const passer = lagMatcher(vare);
  const perEnhet = {};
  for (const [id, h] of Object.entries(historikk)) {
    if (naavaerendeIder.has(id)) continue;
    const [dato, , tittel, enhet, enhetspris] = h;
    if (!enhet || enhetspris == null || !passer(tittel)) continue;
    (perEnhet[enhet] ??= []).push({ dato, enhetspris });
  }
  const ut = {};
  for (const [enhet, liste] of Object.entries(perEnhet)) {
    const datoer = liste.map((x) => x.dato).sort();
    const uker = Math.round((Date.now() - new Date(datoer[0]).getTime()) / (7 * 864e5));
    ut[enhet] = { min: Math.min(...liste.map((x) => x.enhetspris)), antall: liste.length, uker };
  }
  return ut;
}

// Hvor godt er et tilbud? Gir nivå ('kjempe' | 'bra' | 'vanlig'), en poengsum og forklaringer.
export function vurder(tilbud, vare, hist) {
  const grunner = [];
  let andel = 0; // hvor mye under «normalt» (0.3 = 30 % billigere)

  if (tilbud.rabatt != null && tilbud.rabatt > 0) {
    andel = Math.max(andel, tilbud.rabatt / 100);
    grunner.push(`−${tilbud.rabatt} % (før ${kr(tilbud.forpris)} kr)`);
  }

  const ep = tilbud.enhetspris;
  if (vare?.normalpris > 0 && ep != null && tilbud.enhet === (vare.enhet || 'kg')) {
    const under = 1 - ep / vare.normalpris;
    if (under >= 0.1) {
      andel = Math.max(andel, under);
      grunner.push(`${Math.round(under * 100)} % under vanlig (~${kr(vare.normalpris)} kr/${tilbud.enhet})`);
    }
  }

  let rekord = false;
  const h = hist?.[tilbud.enhet];
  if (h && ep != null && h.antall >= 3 && h.uker >= 3) {
    if (ep < h.min * 0.98) {
      rekord = true;
      grunner.push(`Laveste pris på ${h.uker} uker`);
    } else if (ep <= h.min * 1.01) {
      grunner.push(`Like lavt som det beste på ${h.uker} uker`);
    }
  }

  let nivaa = 'vanlig';
  if (andel >= 0.38 || (rekord && andel >= 0.2)) nivaa = 'kjempe';
  else if (andel >= 0.2 || rekord) nivaa = 'bra';
  return { nivaa, andel, rekord, grunner };
}

export const NIVAA_REKKEFOLGE = { kjempe: 0, bra: 1, vanlig: 2 };
