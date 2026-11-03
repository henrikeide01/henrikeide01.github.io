// Spørsmålene som tilpasser middager, porsjoner og makroer – ett spørsmål om gangen, store knapper.
const V = (v, tekst, ikon = '', hjelp = '') => ({ v, tekst, ikon, hjelp });

export const PERSONSPORSMAL = [
  { id: 'alder', type: 'tall', tekst: 'Hvor gammel er du, {navn}?', enhet: 'år', min: 10, max: 100 },
  { id: 'kjonn', type: 'valg', tekst: 'Kjønn', hjelp: 'Brukes bare til å regne ut hvor mye energi kroppen trenger.', valg: [V('mann', 'Mann', '👨'), V('kvinne', 'Kvinne', '👩'), V('annet', 'Annet / vil ikke si', '🙂')] },
  { id: 'hoyde', type: 'tall', tekst: 'Hvor høy er du?', enhet: 'cm', min: 120, max: 230 },
  { id: 'vekt', type: 'tall', tekst: 'Hvor mye veier du?', enhet: 'kg', min: 30, max: 250, hjelp: 'Et omtrentlig tall holder.' },
  { id: 'aktivitet', type: 'valg', tekst: 'Hvor aktiv er du i en vanlig uke?', valg: [
    V('lite', 'Sitter mest stille', '🛋️'), V('litt', 'Trener 1–2 ganger', '🚶'), V('middels', 'Trener 3–4 ganger', '🏃'),
    V('mye', 'Trener 5 ganger eller mer', '🏋️'), V('svaert', 'Fysisk jobb og trening', '💪')] },
  { id: 'mal', type: 'valg', tekst: 'Hva er målet ditt?', valg: [
    V('ned', 'Gå ned i vekt', '📉'), V('holde', 'Holde vekten', '⚖️'), V('muskler', 'Bygge muskler', '💪'), V('opp', 'Gå opp i vekt', '📈')] },
  { id: 'middag', type: 'valg', tekst: 'Hvor stor er middagen for deg?', valg: [
    V('liten', 'Liten', '🥄', 'Jeg spiser mest ellers i løpet av dagen'), V('normal', 'Vanlig', '🍽️'), V('stor', 'Stor', '🍲', 'Middag er dagens hovedmåltid')] },
  { id: 'kosthold', type: 'valg', tekst: 'Hva spiser du?', valg: [
    V('alt', 'Alt', '🍗'), V('pescetar', 'Fisk, men ikke kjøtt', '🐟'), V('vegetar', 'Vegetar', '🥦'), V('vegan', 'Vegansk', '🌱')] },
  { id: 'allergier', type: 'flere', tekst: 'Allergier eller noe du ikke tåler?', ingen: 'Ingen', valg: [
    V('gluten', 'Gluten', '🌾'), V('melk', 'Melk / laktose', '🥛'), V('egg', 'Egg', '🥚'), V('fisk', 'Fisk', '🐟'),
    V('skalldyr', 'Skalldyr', '🦐'), V('notter', 'Nøtter', '🥜'), V('soya', 'Soya', '🫘')] },
  { id: 'misliker', type: 'flere', tekst: 'Er det noe du ikke liker?', ingen: 'Liker alt', valg: [
    V('fisk', 'Fisk', '🐟'), V('skalldyr', 'Skalldyr', '🦐'), V('sopp', 'Sopp', '🍄'), V('lok', 'Løk', '🧅'), V('paprika', 'Paprika', '🫑'),
    V('tomat', 'Tomat', '🍅'), V('bonner', 'Bønner og linser', '🫘'), V('kokos', 'Kokos', '🥥'), V('svin', 'Svinekjøtt', '🐖'),
    V('kylling', 'Kylling', '🍗'), V('ost', 'Ost', '🧀'), V('egg', 'Egg', '🥚'), V('avokado', 'Avokado', '🥑'), V('sterk', 'Sterk mat', '🌶️')] },
  { id: 'favoritter', type: 'flere', tekst: 'Hva elsker du å spise?', hjelp: 'Velg så mange du vil.', valg: [
    V('kylling', 'Kylling', '🍗'), V('kjottdeig', 'Kjøttdeig', '🥩'), V('biff', 'Biff', '🥩'), V('laks', 'Laks', '🐟'), V('fisk', 'Annen fisk', '🐠'),
    V('pasta', 'Pasta', '🍝'), V('ris', 'Risretter', '🍚'), V('taco', 'Taco', '🌮'), V('pizza', 'Pizza', '🍕'), V('wok', 'Wok', '🥡'),
    V('curry', 'Curry', '🍛'), V('suppe', 'Suppe', '🍲'), V('burger', 'Burger', '🍔'), V('husmannskost', 'Husmannskost', '🥔'), V('vegetar', 'Vegetar', '🥗')] },
];

// Kun når en ny husstand settes opp: inntekt per person til budsjettet
export const INNTEKTSSPORSMAL = { id: 'inntekt', type: 'tall', tekst: 'Hvor mye har du å bruke i måneden?', enhet: 'kr', min: 0, max: 200000, hjelp: 'Studielån, lønn og annet etter skatt. Du kan endre det senere.' };

export const FOKUSVALG = [V('protein', 'Mye protein', '💪'), V('billig', 'Billig', '💸'), V('raskt', 'Raskt å lage', '⚡'), V('lett', 'Lett og få kalorier', '🥗')];

export const HUSSTANDSPORSMAL = [
  { id: 'fokus', type: 'flere', tekst: 'Hva er viktigst når dere velger middag?', hjelp: 'Velg så mange dere vil.', valg: FOKUSVALG },
  { id: 'middager', type: 'valg', tekst: 'Hvor mange middager lager dere hjemme i uka?', valg: [3, 4, 5, 6, 7].map((n) => V(String(n), `${n} middager`, '🍽️')) },
  { id: 'tid', type: 'valg', tekst: 'Hvor lang tid har dere til middag på hverdager?', valg: [V('15', 'Maks 15 minutter', '⚡'), V('25', 'Ca. 25 minutter', '⏱️'), V('35', 'Ca. 35 minutter', '🕒'), V('60', 'Gjerne en time', '👨‍🍳')] },
  { id: 'utstyr', type: 'flere', tekst: 'Hva har dere på kjøkkenet?', valg: [
    V('ovn', 'Stekeovn', '🔥'), V('airfryer', 'Airfryer', '🌀'), V('riskoker', 'Riskoker', '🍚'), V('mikro', 'Mikrobølgeovn', '📡'), V('blender', 'Blender', '🥤')] },
  { id: 'stiler', type: 'flere', tekst: 'Hvilken type mat liker dere?', valg: [
    V('norsk', 'Norsk husmannskost', '🇳🇴'), V('italiensk', 'Italiensk', '🍝'), V('meksikansk', 'Meksikansk', '🌮'), V('asiatisk', 'Asiatisk', '🥢'),
    V('indisk', 'Indisk', '🍛'), V('amerikansk', 'Amerikansk', '🍔'), V('middelhav', 'Middelhavet', '🫒')] },
  { id: 'sparing', type: 'valg', tekst: 'Hvor viktig er det å holde matprisen nede?', valg: [V('veldig', 'Veldig – vi må spare', '💸'), V('litt', 'Litt', '🙂'), V('lite', 'Ikke så viktig', '😎')] },
  { id: 'rester', type: 'valg', tekst: 'Vil dere lage litt ekstra til matpakke dagen etter?', valg: [V('ja', 'Ja, gjerne', '🥡'), V('nei', 'Nei', '🙅')] },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Viser spørsmålene ett og ett i en egen dialog. Kaller vedFerdig(svar) til slutt.
export function kjorSporsmal({ tittel, sporsmal, svar = {}, navn = '', vedFerdig, vedAvbryt }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sporsmal';
  document.body.append(dlg);
  const svarNa = { ...svar };
  let i = 0;
  const lukk = () => { dlg.close(); dlg.remove(); };

  function neste() {
    i++;
    if (i >= sporsmal.length) { lukk(); vedFerdig?.(svarNa); return; }
    tegn();
  }

  function tegn() {
    const q = sporsmal[i];
    const tekst = q.tekst.replace('{navn}', navn || '');
    const verdi = svarNa[q.id];
    let kropp = '';
    if (q.type === 'valg') {
      kropp = `<div class="valg">${q.valg.map((o) => `<button type="button" class="valgknapp ${String(verdi) === o.v ? 'valgt' : ''}" data-v="${esc(o.v)}"><span class="ikon">${o.ikon}</span><span><b>${esc(o.tekst)}</b>${o.hjelp ? `<small>${esc(o.hjelp)}</small>` : ''}</span></button>`).join('')}</div>`;
    } else if (q.type === 'flere') {
      const valgt = new Set(Array.isArray(verdi) ? verdi : []);
      kropp = `<div class="flervalg">${q.valg.map((o) => `<button type="button" class="chip ${valgt.has(o.v) ? 'valgt' : ''}" data-flere="${esc(o.v)}" aria-pressed="${valgt.has(o.v)}">${o.ikon} ${esc(o.tekst)}</button>`).join('')}</div>
        <button type="button" class="knapp hoved stor" data-videre>${valgt.size ? 'Neste' : esc(q.ingen || 'Neste')}</button>`;
    } else {
      kropp = `<form class="tallsvar" data-tallform><div class="tallfelt"><input type="${q.type === 'tekst' ? 'text' : 'number'}" inputmode="${q.type === 'tekst' ? 'text' : 'decimal'}" ${q.min != null ? `min="${q.min}"` : ''} ${q.max != null ? `max="${q.max}"` : ''} step="any" value="${esc(verdi ?? '')}" aria-label="${esc(tekst)}" autofocus>${q.enhet ? `<span>${esc(q.enhet)}</span>` : ''}</div>
        <button type="submit" class="knapp hoved stor">Neste</button></form>`;
    }
    dlg.innerHTML = `
      <div class="sp-topp">
        <button type="button" class="sp-tilbake" data-tilbake aria-label="Tilbake" ${i === 0 ? 'style="visibility:hidden"' : ''}>‹</button>
        <div class="sp-fremdrift"><span style="width:${Math.round((i / sporsmal.length) * 100)}%"></span></div>
        <button type="button" class="sp-lukk" data-lukk-sp aria-label="Lukk">✕</button>
      </div>
      <div class="sp-innhold">
        ${tittel ? `<div class="sp-tittel">${esc(tittel)} · ${i + 1} av ${sporsmal.length}</div>` : ''}
        <h2>${esc(tekst)}</h2>
        ${q.hjelp ? `<p class="sp-hjelp">${esc(q.hjelp)}</p>` : ''}
        ${kropp}
        <button type="button" class="sp-hopp" data-hopp>Hopp over</button>
      </div>`;
    dlg.querySelector('input')?.focus();
  }

  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const q = sporsmal[i];
    if ('lukkSp' in b.dataset) { lukk(); vedAvbryt?.(svarNa); return; }
    if ('tilbake' in b.dataset) { i = Math.max(0, i - 1); tegn(); return; }
    if ('hopp' in b.dataset) { neste(); return; }
    if (b.dataset.v != null) { svarNa[q.id] = b.dataset.v; setTimeout(neste, 120); b.classList.add('valgt'); return; }
    if (b.dataset.flere != null) {
      const liste = new Set(Array.isArray(svarNa[q.id]) ? svarNa[q.id] : []);
      liste.has(b.dataset.flere) ? liste.delete(b.dataset.flere) : liste.add(b.dataset.flere);
      svarNa[q.id] = [...liste];
      b.classList.toggle('valgt'); b.setAttribute('aria-pressed', String(liste.has(b.dataset.flere)));
      dlg.querySelector('[data-videre]').textContent = liste.size ? 'Neste' : (q.ingen || 'Neste');
      return;
    }
    if ('videre' in b.dataset) { svarNa[q.id] = Array.isArray(svarNa[q.id]) ? svarNa[q.id] : []; neste(); }
  });
  dlg.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = sporsmal[i];
    const inp = dlg.querySelector('input');
    const v = q.type === 'tekst' ? inp.value.trim() : parseFloat(String(inp.value).replace(',', '.'));
    if (q.type !== 'tekst' && !(v >= (q.min ?? -Infinity) && v <= (q.max ?? Infinity))) { inp.focus(); inp.classList.add('feil'); return; }
    svarNa[q.id] = v;
    neste();
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); lukk(); vedAvbryt?.(svarNa); });
  tegn();
  dlg.showModal();
}
