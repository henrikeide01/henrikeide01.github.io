// Mat: ingredienser med næringsinnhold, oppskrifter, kalori-/makromål og middagsforslag.
// Ingen DOM her, så alt kan testes med Node. Næringsverdier er omtrentlige (per 100 g, rå vare).
import { lagMatcher, vurder } from '../tilbud/motor.js';

// navn, kcal, protein, fett, karbo (per 100 g), pakke (g), pris (kr/kg), type, allergener, søkeord mot tilbud
const I = (navn, kcal, p, f, k, pakke, pris, type, allergener = [], sok = [], ikke = [], ekstra = {}) =>
  ({ navn, kcal, p, f, k, pakke, pris, type, allergener, sok, ikke, ...ekstra });

export const INGREDIENSER = {
  kyllingfilet: I('Kyllingfilet', 106, 23, 1.5, 0, 1000, 190, 'kjott', [], ['kyllingfilet', 'kyllingbryst', 'kylling filet', 'kylling + filet', 'kyllinginnerfilet'], ['lår', 'vinge', 'stekt', 'skivet', 'pålegg', 'nuggets', 'pølse', 'burger', 'korv']),
  kyllinglar: I('Kyllinglårfilet', 160, 18, 10, 0, 500, 170, 'kjott', [], ['kyllinglår', 'kylling lårfilet', 'lårfilet'], ['stekt', 'skivet', 'pålegg']),
  kjottdeig: I('Kjøttdeig', 210, 18, 15, 0, 400, 190, 'kjott', [], ['kjøttdeig', 'karbonadedeig'], ['saus', 'lasagne', 'pizza', 'krydder', 'gryte']),
  svinekjott: I('Strimlet svinekjøtt', 150, 21, 7, 0, 350, 170, 'kjott', [], ['strimlet svin', 'svinekjøtt', 'svinestrimler', 'svinefilet', 'nakkekotelett'], ['pålegg', 'kokt'], { svin: true }),
  biff: I('Biffstrimler', 140, 22, 5, 0, 400, 300, 'kjott', [], ['biffstrimler', 'biff', 'entrecote', 'indrefilet', 'ytrefilet', 'mørbrad', 'høyrygg'], ['burger', 'pålegg', 'kjøttdeig']),
  laks: I('Laks', 200, 20, 13, 0, 500, 230, 'fisk', ['fisk'], ['laks'], ['røkt', 'tilbehør', 'saus', 'rogn', 'pålegg', 'postei', 'smørbar']),
  torsk: I('Torsk eller sei', 80, 18, 0.7, 0, 400, 200, 'fisk', ['fisk'], ['torsk', '"sei"', 'seifilet', 'hyse'], ['rogn', 'lever', 'kaker', 'pudding', 'panert', 'sprøbakt']),
  scampi: I('Scampi', 75, 17, 1, 0, 400, 250, 'skalldyr', ['skalldyr'], ['scampi', 'reker'], ['salat', 'majones', 'røre']),
  bacon: I('Bacon', 330, 15, 30, 0.5, 200, 200, 'kjott', [], ['bacon'], ['postei', 'chips', 'dressing', 'ost'], { svin: true }),
  polser: I('Pølser', 230, 12, 19, 3, 600, 120, 'kjott', [], ['pølse', 'wiener'], ['brød', 'lompe', 'pålegg', 'salami', 'skivet'], { svin: true }),
  skinke: I('Skinke', 110, 19, 3, 1, 150, 230, 'kjott', [], ['kokt skinke', 'skinke i skiver', 'skinke i biter', 'renskåret kokt skinke'], ['stek', 'spekeskinke'], { svin: true }),
  tunfisk: I('Tunfisk', 110, 25, 1, 0, 185, 110, 'fisk', ['fisk'], ['tunfisk'], ['salat', 'pizza', 'postei', 'i olje']),
  egg: I('Egg', 140, 12.5, 10, 0.7, 720, 75, 'egg', ['egg'], ['"egg"', 'frokostegg', 'gårdsegg'], ['sjokolade', 'påske', 'kinder'], { stk: 60 }),
  kidney: I('Kidneybønner', 100, 7, 0.5, 13, 400, 40, 'gronn', [], ['kidneybønner', 'chilibønner', 'bønner'], ['grønne bønner', 'bønnespirer']),
  linser: I('Røde linser', 340, 25, 1.5, 50, 500, 50, 'gronn', [], ['linser']),
  ost: I('Ost', 350, 27, 27, 0, 500, 160, 'meieri', ['melk'], ['gulost', 'norvegia', 'jarlsberg', 'revet ost', 'ekte revet', 'revet lettost', 'pizzaost', 'cheese mix', 'hvitost'], ['chips', 'kjeks', 'brunost', 'smøreost', 'kremost', 'snacks']),
  feta: I('Fetaost', 260, 14, 21, 2, 200, 180, 'meieri', ['melk'], ['feta', 'salatost', 'apetina']),
  romme: I('Rømme', 190, 2.7, 18, 4, 300, 90, 'meieri', ['melk'], ['rømme', 'seterrømme', 'lettrømme', 'crème fraîche'], ['dressing', 'dip', 'potet']),
  matflote: I('Matfløte', 180, 2.5, 18, 3.6, 300, 80, 'meieri', ['melk'], ['matfløte']),
  kremflote: I('Kremfløte', 340, 2, 35, 3, 300, 100, 'meieri', ['melk'], ['kremfløte']),
  melk: I('Melk', 40, 3.5, 1, 4.5, 1750, 20, 'meieri', ['melk'], ['lettmelk', 'helmelk', '"melk"'], ['sjokolade', 'sjoko', 'kokos', 'havre']),
  smor: I('Smør', 740, 0.6, 82, 0.6, 500, 120, 'meieri', ['melk'], ['"smør"', 'meierismør']),
  ris: I('Ris', 350, 7, 0.6, 78, 5000, 35, 'karbo', [], ['jasminris', 'basmatiris', '"ris"', 'fullkornsris', 'parboiled'], ['grøt', 'krem', 'pudding', 'boil in bag', 'kaker']),
  pasta: I('Pasta', 355, 12, 1.5, 72, 500, 35, 'karbo', ['gluten'], ['pasta', 'spaghetti', 'penne', 'fusilli', 'makaroni', 'tagliatelle', 'farfalle', 'rigatoni'], ['saus', 'salat', 'ferdigrett']),
  nudler: I('Nudler', 370, 13, 4, 70, 250, 80, 'karbo', ['gluten'], ['eggnudler', 'nudler', 'risnudler'], ['koppnudler', 'yum yum', 'mr lee']),
  poteter: I('Poteter', 77, 2, 0.1, 17, 2000, 28, 'karbo', [], ['potet', 'pottet'], ['gull', 'chips', 'mos', 'stappe', 'fløtepotet', 'båt', 'fries', 'grateng', 'salat', 'lompe']),
  tortilla: I('Tortillalefser', 300, 8, 7, 50, 370, 50, 'karbo', ['gluten'], ['tortilla'], ['chips', 'skjell']),
  lasagne: I('Lasagneplater', 355, 12, 1.5, 72, 250, 80, 'karbo', ['gluten'], ['lasagneplater']),
  mel: I('Hvetemel', 340, 10, 1.5, 70, 2000, 12, 'karbo', ['gluten'], ['hvetemel', 'siktet hvetemel']),
  burgerbrod: I('Hamburgerbrød', 270, 9, 4, 50, 300, 60, 'karbo', ['gluten'], ['hamburgerbrød', 'burgerbrød'], [], { stk: 75 }),
  frossenpizza: I('Frossenpizza', 230, 10, 9, 27, 575, 110, 'kjott', ['gluten', 'melk'], ['grandiosa', 'pizza', 'big one', 'la mia grande', 'ristorante'], ['pizzabunn', 'pizzasaus', 'pizzaost', 'pizzadeig', 'pizzamel', 'pizzaskinke'], { meieri: true }),
  lok: I('Løk', 40, 1.1, 0.1, 9, 700, 30, 'gronn', [], ['"løk"', 'løk i strømpe', 'gul løk', 'rødløk'], ['chips', 'potegull', 'stekt', 'dressing', 'suppe', 'vårløk']),
  paprika: I('Paprika', 30, 1, 0.3, 6, 450, 70, 'gronn', [], ['paprika', 'spisspaprika'], ['krydder', 'pulver', 'chips', 'saus'], { stk: 150 }),
  tomat: I('Tomater', 18, 0.9, 0.2, 3.9, 500, 60, 'gronn', [], ['tomater', 'småtomat', 'cherrytomat', 'tomatmiks', 'piccolotomat'], ['hakkede', 'knuste', 'polpa', 'boks', 'pure', 'suppe', 'saus', 'soltørkede']),
  hakketomat: I('Hakkede tomater', 25, 1.2, 0.2, 4, 400, 38, 'gronn', [], ['hakkede tomater', 'knuste tomater', 'polpa', 'finhakkede tomater']),
  gulrot: I('Gulrøtter', 41, 0.9, 0.2, 10, 750, 27, 'gronn', [], ['gulrot', 'gulrøtter'], ['kake', 'snack', 'juice', 'stappe']),
  brokkoli: I('Brokkoli', 34, 2.8, 0.4, 7, 400, 50, 'gronn', [], ['brokkoli']),
  wokgronnsaker: I('Wokgrønnsaker', 40, 2, 0.3, 7, 750, 60, 'gronn', [], ['wokmiks', 'wokgrønnsaker', 'grønnsaksblanding', 'wok miks'], ['salat']),
  erter: I('Erter', 80, 5, 0.4, 14, 500, 40, 'gronn', [], ['"erter"', 'grønne erter', 'frosne erter'], ['stuing', 'suppe']),
  mais: I('Mais', 85, 3, 1, 17, 300, 45, 'gronn', [], ['mais', 'maiskorn'], ['chips', 'kake', 'nacho', 'popcorn']),
  salat: I('Salat', 15, 1, 0.2, 3, 150, 130, 'gronn', [], ['isberg', 'romanosalat', 'salatblanding', 'ruccola', 'baby leaf', '"salat"'], ['dressing', 'pasta', 'kylling', 'tunfisk', 'potet', 'skinke', 'reke', 'coleslaw']),
  agurk: I('Agurk', 12, 0.6, 0.1, 2, 350, 50, 'gronn', [], ['agurk'], ['sylte', 'salat', 'pariseragurk'], { stk: 350 }),
  champignon: I('Sjampinjong', 22, 3, 0.3, 3, 250, 120, 'gronn', [], ['champignon', 'sjampinjong', '"sopp"'], ['suppe', 'saus']),
  avokado: I('Avokado', 160, 2, 15, 9, 400, 100, 'gronn', [], ['avokado'], ['guacamole', 'dip'], { stk: 200 }),
  kokosmelk: I('Kokosmelk', 200, 2, 20, 3, 400, 60, 'saus', [], ['kokosmelk'], ['drikke']),
  karripaste: I('Karripaste', 120, 2, 8, 10, 100, 300, 'saus', [], ['karripaste', 'curry paste', 'currypasta', 'tikka masala', 'butter chicken']),
  pesto: I('Pesto', 450, 5, 45, 5, 185, 250, 'saus', ['notter', 'melk'], ['pesto'], [], { meieri: true }),
  tacokrydder: I('Tacokrydder', 330, 8, 6, 55, 28, 450, 'saus', [], ['tacokrydder', 'taco krydder', 'taco seasoning']),
  tacosaus: I('Tacosaus', 30, 1, 0.2, 6, 230, 90, 'saus', [], ['tacosaus', 'salsa'], ['chips']),
  // Frokost, lunsj og mellommåltid
  havregryn: I('Havregryn', 370, 13, 7, 60, 1000, 30, 'frokost', ['gluten'], ['havregryn', 'lettkokt havre']),
  granola: I('Granola', 450, 10, 18, 60, 500, 140, 'frokost', ['gluten'], ['granola', 'müsli', 'musli'], ['bar']),
  brod: I('Brød', 230, 9, 3, 40, 750, 50, 'frokost', ['gluten'], ['grovbrød', 'kneipp', '"brød"'], ['knekkebrød', 'smørbrød', 'pølsebrød', 'skolebrød']),
  brodmiks: I('Brødmiks', 350, 11, 3, 65, 1000, 35, 'frokost', ['gluten'], ['brødmiks', 'brødmix', 'brød mix', 'mestermiks', 'grovbrødmiks', 'bakemiks', 'bakemix'], ['kake', 'pannekake', 'vaffel', 'pizza', 'boller', 'muffins', 'brownies']),
  knekkebrod: I('Knekkebrød', 360, 10, 6, 60, 500, 70, 'frokost', ['gluten'], ['knekkebrød', 'wasa', 'husman']),
  yoghurt: I('Yoghurt', 70, 4.5, 3, 6, 1000, 40, 'meieri', ['melk'], ['yoghurt', 'yogurt', 'biola'], ['granola', 'rosiner', 'is', 'dressing']),
  skyr: I('Skyr', 60, 11, 0.2, 4, 500, 70, 'meieri', ['melk'], ['skyr']),
  kesam: I('Cottage cheese', 90, 12, 4, 2, 400, 70, 'meieri', ['melk'], ['cottage', 'kesam']),
  banan: I('Banan', 90, 1.1, 0.3, 20, 1000, 30, 'frukt', [], ['banan'], ['chips', 'sjokolade', 'smoothie', 'skum'], { stk: 120 }),
  eple: I('Eple', 52, 0.3, 0.2, 12, 1000, 35, 'frukt', [], ['epler', '"eple"'], ['juice', 'kake', 'most', 'chips'], { stk: 150 }),
  baer: I('Bær', 45, 1, 0.3, 9, 500, 80, 'frukt', [], ['blåbær', 'bringebær', 'skogsbær', 'bærmiks', 'frosne bær'], ['syltetøy', 'sjokolade', 'yoghurt', 'juice', 'saft', 'kake', 'drikke']),
  notter: I('Nøtter', 600, 20, 50, 15, 200, 200, 'snacks', ['notter'], ['peanøtter', 'cashew', 'mandler', 'nøttemiks'], ['sjokolade', 'smør']),
  peanottsmor: I('Peanøttsmør', 600, 25, 50, 15, 350, 114, 'snacks', ['notter'], ['peanøttsmør']),
  proteinbar: I('Proteinbar', 360, 30, 12, 35, 150, 500, 'snacks', ['melk'], ['proteinbar', 'barebells', 'protein bar'], [], { stk: 55 }),

  // Basisvarer: regnes som noe dere alltid har, og settes ikke på handlelista
  soyasaus: I('Soyasaus', 60, 8, 0, 6, 150, 150, 'basis', ['soya', 'gluten'], [], [], { basis: true }),
  olje: I('Olje', 900, 0, 100, 0, 1000, 40, 'basis', [], [], [], { basis: true }),
  hvitlok: I('Hvitløk', 150, 6, 0.5, 33, 100, 80, 'basis', [], [], [], { basis: true }),
  tomatpure: I('Tomatpuré', 80, 4, 0.5, 16, 140, 100, 'basis', [], [], [], { basis: true }),
  gjaer: I('Gjær', 100, 12, 1, 10, 50, 200, 'basis', [], [], [], { basis: true }),
};

const R = (id, navn, ikon, tid, stil, tags, ingredienser, steg, ekstra = {}) => ({ id, navn, ikon, tid, stil, tags, ingredienser, steg, porsjoner: 4, ...ekstra });

// Mengder er for 4 porsjoner, i gram
export const OPPSKRIFTER = [
  R('kyllingcurry', 'Kyllingcurry med ris', '🍛', 30, 'indisk', ['kylling', 'curry', 'ris'],
    { kyllingfilet: 600, kokosmelk: 400, karripaste: 60, lok: 150, paprika: 150, ris: 320, olje: 15 },
    ['Kok risen i riskokeren eller i en kjele.', 'Skjær kylling, løk og paprika i biter.', 'Stek kyllingen i olje til den har fått farge, og ta med løk og paprika.', 'Rør inn karripasta, hell over kokosmelk og la det småkoke i 10 minutter.', 'Smak til med salt og server med risen.']),
  R('kyllingwok', 'Kyllingwok med nudler', '🥡', 20, 'asiatisk', ['kylling', 'wok'],
    { kyllingfilet: 500, wokgronnsaker: 750, nudler: 250, soyasaus: 40, olje: 20, hvitlok: 10 },
    ['Kok nudlene etter pakken.', 'Skjær kyllingen i strimler og stek den på høy varme i olje.', 'Ta med hvitløk og wokgrønnsaker, og stek i 4–5 minutter.', 'Vend inn nudlene og soyasausen.']),
  R('taco', 'Taco', '🌮', 25, 'meksikansk', ['taco', 'kjottdeig'],
    { kjottdeig: 400, tacokrydder: 28, tortilla: 370, ost: 150, romme: 300, salat: 150, tomat: 200, agurk: 150, mais: 300, tacosaus: 230 },
    ['Stek kjøttdeigen, og rør inn tacokrydder og litt vann.', 'Kutt salat, tomat og agurk.', 'Varm lefsene og sett alt på bordet.']),
  R('bolognese', 'Spaghetti bolognese', '🍝', 30, 'italiensk', ['pasta', 'kjottdeig'],
    { kjottdeig: 400, hakketomat: 800, lok: 150, gulrot: 150, hvitlok: 10, pasta: 400, ost: 60, olje: 15 },
    ['Hakk løk, hvitløk og gulrot, og fres dem i olje.', 'Ta med kjøttdeigen og stek til den er brun.', 'Hell i hakkede tomater og la sausen småkoke i 15 minutter.', 'Kok pastaen, og server med sausen og litt ost på toppen.']),
  R('kjottkaker', 'Kjøttkaker i brun saus', '🥔', 50, 'norsk', ['kjottdeig', 'husmannskost'],
    { kjottdeig: 600, egg: 60, lok: 100, poteter: 1000, erter: 300, mel: 30, smor: 30, melk: 100 },
    ['Kok potetene.', 'Bland kjøttdeig, egg, revet løk, melk, salt og pepper, og form kjøttkaker.', 'Brun kjøttkakene i smør, og legg dem til side.', 'Lag brun saus: brun smør og mel, spe med vann og buljong, og legg kjøttkakene i sausen i 10 minutter.', 'Server med poteter og erter.']),
  R('laksovn', 'Ovnsbakt laks med poteter og brokkoli', '🐟', 30, 'norsk', ['laks', 'fisk'],
    { laks: 600, poteter: 1000, brokkoli: 400, romme: 150, smor: 20 },
    ['Sett ovnen på 200 grader, og kok potetene.', 'Legg laksen i en form, krydre med salt og pepper og bak den i 15 minutter.', 'Kok eller damp brokkolien.', 'Server med en klatt rømme.'], { utstyr: ['ovn'] }),
  R('laksris', 'Laks med ris og wokgrønnsaker', '🍣', 25, 'asiatisk', ['laks', 'fisk', 'ris', 'wok'],
    { laks: 600, ris: 320, wokgronnsaker: 500, soyasaus: 40, olje: 10 },
    ['Kok risen.', 'Stek laksen i panna, ca. 4 minutter på hver side.', 'Stek wokgrønnsakene og smak til med soyasaus.', 'Server laksen over ris og grønnsaker.']),
  R('kyllinggryte', 'Kremet kyllinggryte med ris', '🍲', 30, 'norsk', ['kylling', 'ris'],
    { kyllingfilet: 600, matflote: 300, champignon: 200, lok: 100, paprika: 150, ris: 320, olje: 15 },
    ['Kok risen.', 'Stek kylling i biter i olje.', 'Ta med løk, sopp og paprika, og stek litt til.', 'Hell i matfløte og la det koke i 10 minutter. Smak til med salt og pepper.']),
  R('pestopasta', 'Pasta med kylling og pesto', '🌿', 20, 'italiensk', ['pasta', 'kylling'],
    { pasta: 400, kyllingfilet: 500, pesto: 120, tomat: 250, ost: 40, olje: 10 },
    ['Kok pastaen.', 'Stek kyllingen i strimler.', 'Vend pasta, kylling, pesto og delte tomater sammen.', 'Strø over litt ost.']),
  R('quesadilla', 'Quesadilla med kylling', '🫓', 20, 'meksikansk', ['kylling', 'taco'],
    { tortilla: 370, kyllingfilet: 400, ost: 200, paprika: 150, mais: 150, romme: 150, tacokrydder: 28, olje: 10 },
    ['Stek kyllingen i biter med tacokrydder.', 'Fordel kylling, paprika, mais og ost på halvparten av hver lefse, og brett dem sammen.', 'Stek lefsene i tørr panne til de er gylne på begge sider.', 'Server med rømme.']),
  R('lasagne', 'Lasagne', '🧀', 75, 'italiensk', ['pasta', 'kjottdeig'],
    { kjottdeig: 500, lasagne: 250, hakketomat: 800, lok: 100, ost: 200, melk: 500, smor: 40, mel: 40 },
    ['Lag kjøttsaus av kjøttdeig, løk og hakkede tomater.', 'Lag hvit saus: smelt smør, rør inn mel og spe med melk.', 'Legg lag med kjøttsaus, plater og hvit saus i en form. Avslutt med ost.', 'Stek på 200 grader i 35–40 minutter.'], { utstyr: ['ovn'] }),
  R('chili', 'Chili con carne med ris', '🌶️', 35, 'meksikansk', ['kjottdeig', 'ris', 'sterk', 'chili'],
    { kjottdeig: 400, kidney: 500, hakketomat: 800, lok: 150, paprika: 150, ris: 320, romme: 150, olje: 15 },
    ['Kok risen.', 'Fres løk og paprika, og ta med kjøttdeigen.', 'Krydre med chili, spisskummen og paprikapulver.', 'Ta med tomater og bønner, og la det koke i 15 minutter.', 'Server med ris og rømme.']),
  R('pannekaker', 'Pannekaker med bacon', '🥞', 30, 'norsk', ['husmannskost'],
    { mel: 250, egg: 240, melk: 600, smor: 30, bacon: 300 },
    ['Visp sammen mel, egg, melk og litt salt, og la røren svelle i 10 minutter.', 'Stek baconet sprøtt.', 'Stek tynne pannekaker i smør.']),
  R('omelett', 'Omelett med skinke og ost', '🍳', 15, 'norsk', ['egg'],
    { egg: 600, skinke: 150, ost: 100, paprika: 100, lok: 50, smor: 20 },
    ['Visp eggene med litt salt og pepper.', 'Fres løk og paprika i smør.', 'Hell i eggene, og strø over skinke og ost.', 'Stek på svak varme til omeletten har stivnet.']),
  R('polsemos', 'Pølser med potetmos', '🌭', 25, 'norsk', ['husmannskost'],
    { polser: 600, poteter: 1200, melk: 200, smor: 40, erter: 200 },
    ['Kok potetene, og mos dem med melk, smør og salt.', 'Varm pølsene i vann som ikke koker.', 'Kok ertene og server alt sammen.']),
  R('torsk', 'Torsk med poteter og gulrøtter', '🐠', 25, 'norsk', ['fisk', 'husmannskost'],
    { torsk: 600, poteter: 1000, gulrot: 400, smor: 60 },
    ['Kok poteter og gulrøtter.', 'Legg torsken i lettsaltet vann som så vidt koker, i 6–8 minutter.', 'Server med smeltet smør.']),
  R('stroganoff', 'Biff stroganoff med ris', '🥩', 30, 'norsk', ['biff', 'ris'],
    { biff: 500, champignon: 250, lok: 100, romme: 300, tomatpure: 70, ris: 320, olje: 15 },
    ['Kok risen.', 'Stek biffstrimlene raskt på høy varme, og ta dem ut.', 'Fres løk og sopp, og rør inn tomatpuré.', 'Ta med rømme og biffen igjen, og varm opp uten at det koker.']),
  R('burger', 'Hjemmelaget burger', '🍔', 25, 'amerikansk', ['burger', 'kjottdeig'],
    { kjottdeig: 500, burgerbrod: 300, ost: 80, salat: 100, tomat: 150, lok: 50, romme: 100 },
    ['Form 4 burgere av kjøttdeigen, og krydre med salt og pepper.', 'Stek dem 3–4 minutter på hver side, og legg på ost til slutt.', 'Varm brødene, og bygg burgerne med salat, tomat, løk og dressing.']),
  R('pizza', 'Hjemmelaget pizza', '🍕', 60, 'italiensk', ['pizza'],
    { mel: 500, gjaer: 12, hakketomat: 400, ost: 300, skinke: 200, paprika: 150, olje: 30 },
    ['Lag deig av mel, gjær, 3 dl lunkent vann, olje og salt, og la den heve i 30 minutter.', 'Kjevle ut deigen på et stekebrett.', 'Fordel tomat, skinke, paprika og ost.', 'Stek på 250 grader i 12–15 minutter.'], { utstyr: ['ovn'] }),
  R('stektris', 'Stekt ris med egg og skinke', '🍚', 20, 'asiatisk', ['ris', 'egg'],
    { ris: 320, egg: 240, wokgronnsaker: 500, skinke: 150, soyasaus: 40, olje: 30 },
    ['Kok risen. Den blir best hvis den er kald, gjerne fra dagen før.', 'Stek wokgrønnsaker og skinke i olje.', 'Skyv det til siden, og rør eggene i panna.', 'Ta med risen og soyasausen, og stek alt sammen.']),
  R('kyllinglar', 'Sprø kyllinglår med båtpoteter', '🍗', 40, 'amerikansk', ['kylling'],
    { kyllinglar: 800, poteter: 1000, olje: 30, salat: 150, romme: 150 },
    ['Skjær potetene i båter, og vend dem i olje, salt og paprikapulver.', 'Krydre kyllinglårene.', 'Stek begge i airfryer (ca. 20 minutter på 200 grader) eller i ovnen (ca. 35 minutter).', 'Server med salat og rømme.'], { utstyr: ['airfryer|ovn'] }),
  R('linsesuppe', 'Linsesuppe med kokos', '🍲', 35, 'indisk', ['suppe', 'vegetar'],
    { linser: 250, hakketomat: 400, lok: 150, gulrot: 200, kokosmelk: 400, karripaste: 30 },
    ['Fres løk og gulrot i en gryte.', 'Rør inn karripasta, og ta med linser, tomater, kokosmelk og 5 dl vann.', 'La det koke i 20 minutter til linsene er møre.', 'Smak til med salt.']),
  R('bonnechili', 'Bønnechili med ris', '🌱', 30, 'meksikansk', ['vegetar', 'ris', 'sterk', 'chili'],
    { kidney: 800, mais: 300, hakketomat: 800, lok: 150, paprika: 150, ris: 320, romme: 150, olje: 15 },
    ['Kok risen.', 'Fres løk og paprika, og krydre med chili og spisskummen.', 'Ta med bønner, mais og tomater, og la det koke i 15 minutter.', 'Server med ris og rømme.']),
  R('carbonara', 'Pasta carbonara', '🥓', 20, 'italiensk', ['pasta'],
    { pasta: 400, bacon: 250, egg: 240, ost: 100 },
    ['Kok pastaen.', 'Stek baconet sprøtt.', 'Visp sammen egg og litt ost.', 'Vend den varme pastaen med bacon og eggeblandingen utenfor platen, så eggene ikke blir eggerøre.']),
  R('kyllingbowl', 'Kyllingbowl med ris og avokado', '🥗', 25, 'asiatisk', ['kylling', 'ris'],
    { kyllingfilet: 500, ris: 320, avokado: 300, mais: 200, agurk: 200, romme: 150, soyasaus: 20, olje: 10 },
    ['Kok risen.', 'Stek kyllingen, og smak til med soyasaus.', 'Fordel ris, kylling, avokado, mais og agurk i boller.', 'Topp med en dressing av rømme.']),
  R('scampiwok', 'Wok med scampi og nudler', '🍤', 20, 'asiatisk', ['wok', 'skalldyr'],
    { scampi: 400, nudler: 250, wokgronnsaker: 750, soyasaus: 40, hvitlok: 10, olje: 20 },
    ['Kok nudlene.', 'Stek scampi og hvitløk raskt i olje.', 'Ta med wokgrønnsakene, og stek i 3–4 minutter.', 'Vend inn nudlene og soyasausen.']),
  R('fredagspizza', 'Fredagspizza (ferdig)', '🍕', 15, 'italiensk', ['pizza'],
    { frossenpizza: 1150, salat: 150 },
    ['Stek pizzaene etter pakken.', 'Server med salat.'], { utstyr: ['ovn'] }),
  R('butterchicken', 'Butter chicken med ris', '🍛', 35, 'indisk', ['kylling', 'curry', 'ris'],
    { kyllingfilet: 600, hakketomat: 400, kremflote: 200, smor: 40, lok: 100, karripaste: 50, ris: 320 },
    ['Kok risen.', 'Brun kyllingen i smør.', 'Ta med løk og karripasta, og deretter tomater og fløte.', 'La det småkoke i 15 minutter.']),
  R('svinewok', 'Svinewok med ris', '🥢', 20, 'asiatisk', ['wok', 'ris'],
    { svinekjott: 500, wokgronnsaker: 750, ris: 320, soyasaus: 40, olje: 20 },
    ['Kok risen.', 'Stek svinekjøttet på høy varme.', 'Ta med wokgrønnsakene og soyasausen, og stek i 4 minutter.']),
  R('kyllingris', 'Kylling, ris og brokkoli', '💪', 25, 'asiatisk', ['kylling', 'ris'],
    { kyllingfilet: 700, ris: 300, brokkoli: 500, soyasaus: 30, olje: 15, hvitlok: 10 },
    ['Kok risen.', 'Skjær kyllingen i biter, og stek den i olje med hvitløk.', 'Damp eller kok brokkolien i 4 minutter.', 'Smak til med soyasaus. Fint å lage dobbelt til matpakker.']),
  R('tacobowl', 'Tacobowl med kjøttdeig og bønner', '🌯', 25, 'meksikansk', ['taco', 'kjottdeig', 'ris'],
    { kjottdeig: 400, kidney: 400, ris: 300, mais: 200, tacokrydder: 28, romme: 150, ost: 80, salat: 100 },
    ['Kok risen.', 'Stek kjøttdeigen, og rør inn tacokrydder, bønner og litt vann.', 'Fordel ris, kjøttdeig, mais og salat i boller.', 'Topp med rømme og ost.']),
  R('tunfiskpasta', 'Tunfiskpasta med tomat', '🐟', 20, 'italiensk', ['pasta', 'fisk'],
    { pasta: 400, tunfisk: 370, hakketomat: 400, lok: 100, ost: 60, olje: 10 },
    ['Kok pastaen.', 'Fres løken i olje, og ta med hakkede tomater.', 'Rør inn tunfisken, og la sausen koke i 5 minutter.', 'Vend sammen med pastaen, og strø over litt ost.']),
  R('kyllingsalat', 'Kyllingsalat med feta', '🥗', 20, 'middelhav', ['kylling'],
    { kyllingfilet: 500, salat: 200, tomat: 250, agurk: 200, feta: 150, mais: 150, olje: 20 },
    ['Stek kyllingen, og skjær den i biter.', 'Kutt salat, tomat og agurk.', 'Bland alt, og topp med feta og en dressing av olje og sitron.']),
];

export const oppskrift = (id) => OPPSKRIFTER.find((r) => r.id === id);

// ---------- Næring ----------
export function naering(r, skala = 1) {
  const sum = { kcal: 0, p: 0, f: 0, k: 0 };
  for (const [key, gram] of Object.entries(r.ingredienser)) {
    const ing = INGREDIENSER[key];
    if (!ing) continue;
    for (const n of Object.keys(sum)) sum[n] += (ing[n] * gram * skala) / 100;
  }
  return sum;
}
export const perPorsjon = (r) => { const n = naering(r); return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v / r.porsjoner])); };

// ---------- Mål per person (Mifflin–St Jeor + aktivitet + mål) ----------
const AKTIVITET = { lite: 1.2, litt: 1.375, middels: 1.55, mye: 1.725, svaert: 1.9 };
// «nedmuskler»: lite underskudd og ekstra mye protein, så du går ned i fett og bygger muskler samtidig
const MAL = { ned: -0.15, nedmuskler: -0.1, holde: 0, muskler: 0.1, opp: 0.15 };
const PROTEIN_PER_KG = { ned: 1.8, nedmuskler: 2.2, holde: 1.4, muskler: 2.0, opp: 1.6 };
export const VIL_HA_PROTEIN = new Set(['muskler', 'nedmuskler']);

export function beregnMal(pr) {
  const vekt = Number(pr?.vekt), hoyde = Number(pr?.hoyde), alder = Number(pr?.alder);
  // Vekta er privat og ligger bare på telefonen til personen selv. Andre telefoner får bare det ferdige målet.
  if (!(vekt > 0 && hoyde > 0 && alder > 0)) return pr?.malTall?.kcal > 0 ? { ...pr.malTall } : null;
  const kjonn = pr.kjonn === 'mann' ? 5 : pr.kjonn === 'kvinne' ? -161 : -78;
  const bmr = 10 * vekt + 6.25 * hoyde - 5 * alder + kjonn;
  let kcal = bmr * (AKTIVITET[pr.aktivitet] ?? 1.45) * (1 + (MAL[pr.mal] ?? 0));
  const protein = (PROTEIN_PER_KG[pr.mal] ?? 1.4) * vekt;
  const fett = (kcal * 0.3) / 9;
  const karbo = Math.max(0, (kcal - protein * 4 - fett * 9) / 4);
  const andel = pr.middag === 'stor' ? 0.42 : pr.middag === 'liten' ? 0.28 : 0.35;
  return { kcal, protein, fett, karbo, middagKcal: kcal * andel, middagProtein: protein * andel };
}

// Porsjonsfaktor per person ut fra kalorimålet (1 = én vanlig porsjon)
export function porsjonFor(pr, r) {
  const mal = beregnMal(pr);
  const kcal = perPorsjon(r).kcal;
  if (!mal || !kcal) return pr?.middag === 'stor' ? 1.25 : pr?.middag === 'liten' ? 0.75 : 1;
  return Math.min(2.5, Math.max(0.5, Math.round((mal.middagKcal / kcal) * 4) / 4));
}

// Porsjoner for husstanden: hver person etter kalorimålet, pluss én ekstra til matpakke hvis dere vil ha rester
export function porsjonerFor(mat, personer, r) {
  const perPerson = Object.fromEntries(personer.map((p) => [p.id, porsjonFor(mat.profiler?.[p.id] || {}, r)]));
  const ekstra = mat.husstand?.rester === 'ja' ? 1 : 0;
  const total = Object.values(perPerson).reduce((a, b) => a + b, 0) + ekstra || r.porsjoner;
  return { perPerson, ekstra, total };
}

// ---------- Hvem kan spise hva ----------
const FORBUDT = {
  vegetar: (ing) => ['kjott', 'fisk', 'skalldyr'].includes(ing.type),
  pescetar: (ing) => ing.type === 'kjott',
  vegan: (ing) => ['kjott', 'fisk', 'skalldyr', 'egg', 'meieri'].includes(ing.type) || ing.meieri,
};
const MISLIKER = {
  fisk: ['laks', 'torsk', 'tunfisk'], skalldyr: ['scampi'], sopp: ['champignon'], lok: ['lok'], paprika: ['paprika'],
  tomat: ['tomat', 'hakketomat'], bonner: ['kidney', 'linser'], kokos: ['kokosmelk'], svin: ['bacon', 'svinekjott', 'polser', 'skinke'],
  kylling: ['kyllingfilet', 'kyllinglar'], ost: ['ost', 'feta'], egg: ['egg'], avokado: ['avokado'],
};

export function passerFor(r, profiler) {
  const ingr = Object.keys(r.ingredienser).map((k) => INGREDIENSER[k]).filter(Boolean);
  const allergener = new Set(ingr.flatMap((i) => i.allergener));
  for (const pr of profiler) {
    if ((pr.allergier || []).some((a) => allergener.has(a))) return false;
    const forbud = FORBUDT[pr.kosthold];
    if (forbud && ingr.some(forbud)) return false;
  }
  return true;
}

function misliker(r, pr) {
  return (pr.misliker || []).some((m) => (m === 'sterk' ? r.tags.includes('sterk') : (MISLIKER[m] || []).some((k) => k in r.ingredienser)));
}

// ---------- Tilbud på ingrediensene ----------
const tilbudsCache = new WeakMap();
export function tilbudPaIngredienser(tilbud) {
  if (!tilbud) return {};
  if (tilbudsCache.has(tilbud)) return tilbudsCache.get(tilbud);
  const ut = {};
  for (const [key, ing] of Object.entries(INGREDIENSER)) {
    if (!ing.sok.length) continue;
    const passer = lagMatcher({ sok: ing.sok, ikke: ing.ikke });
    let beste = null;
    for (const t of tilbud) {
      if (!passer(t.tittel)) continue;
      const kg = t.enhet === 'kg' || t.enhet === 'l' ? t.enhetspris : t.enhet === 'stk' && ing.stk ? (t.enhetspris * 1000) / ing.stk : null;
      if (!(kg > 0)) continue;
      if (!beste || kg < beste.kg) beste = { t, kg, v: vurder({ ...t, enhet: 'kg', enhetspris: kg }, { normalpris: ing.pris, enhet: 'kg' }, null) };
    }
    if (beste && beste.kg < ing.pris * 0.97) ut[key] = beste;
  }
  tilbudsCache.set(tilbud, ut);
  return ut;
}

export function prisFor(r, skala, tilbudInfo = {}) {
  let sum = 0;
  for (const [key, gram] of Object.entries(r.ingredienser)) {
    const ing = INGREDIENSER[key];
    if (!ing || ing.basis) continue;
    sum += ((gram * skala) / 1000) * (tilbudInfo[key]?.kg ?? ing.pris);
  }
  return sum;
}

// ---------- Forslag ----------
// mat: { profiler, husstand, meny, kjokken, logg, vurderinger }, personer: plan.personer
const HOVEDTAGS = ['kylling', 'kjottdeig', 'laks', 'fisk', 'biff', 'pasta', 'taco', 'pizza', 'husmannskost', 'vegetar', 'wok', 'curry', 'chili'];

export function foreslaa({ mat, personer, tilbud, dato, unnta = new Set(), forrige = null, ukeTags = [] }) {
  const profiler = personer.map((p) => ({ id: p.id, ...(mat.profiler?.[p.id] || {}) }));
  const hus = mat.husstand || {};
  const tilbudInfo = tilbudPaIngredienser(tilbud);
  const fokus = new Set(hus.fokus || []);
  const sparevekt = Math.max(hus.sparing === 'veldig' ? 1.5 : hus.sparing === 'lite' ? 0.5 : 1, fokus.has('billig') ? 1.5 : 0);
  const ukedag = new Date(dato + 'T12:00:00Z').getUTCDay();
  const hverdag = ukedag >= 1 && ukedag <= 4;
  const sistSpist = {};
  for (const l of mat.logg || []) if (!sistSpist[l.oppskrift] || l.dato > sistSpist[l.oppskrift]) sistSpist[l.oppskrift] = l.dato;
  const dagerSiden = (d) => Math.round((new Date(dato + 'T12:00:00Z') - new Date(d + 'T12:00:00Z')) / 864e5);
  const utstyr = hus.utstyr;

  return OPPSKRIFTER.filter((r) => !unnta.has(r.id) && passerFor(r, profiler)).filter((r) => {
    if (!utstyr?.length || !r.utstyr) return true;
    return r.utstyr.every((krav) => krav.split('|').some((u) => utstyr.includes(u)));
  }).map((r) => {
    const porsjoner = porsjonerFor(mat, personer, r).total;
    const skala = porsjoner / r.porsjoner;
    let poeng = 0;
    const grunner = [];
    const paTilbud = [];
    // De to dyreste ingrediensene er «hovedvarene» – tilbud på dem teller mest
    const hoved = Object.entries(r.ingredienser).filter(([k]) => INGREDIENSER[k] && !INGREDIENSER[k].basis)
      .sort((a, b) => b[1] * INGREDIENSER[b[0]].pris - a[1] * INGREDIENSER[a[0]].pris).slice(0, 2).map(([k]) => k);
    for (const [key, gram] of Object.entries(r.ingredienser)) {
      const ing = INGREDIENSER[key];
      if (!ing || ing.basis) continue;
      const tb = tilbudInfo[key];
      if (tb) {
        // Prisen per porsjon tar allerede med tilbudsprisen, så dette er bare en liten ekstra dytt
        poeng += hoved.includes(key) ? (tb.v.andel >= 0.35 ? 2.5 : 1.2) * sparevekt : 0.3;
        paTilbud.push({ key, hoved: hoved.includes(key), ...tb });
      }
      if ((mat.kjokken?.[key] || 0) >= gram * skala * 0.9) poeng += 1.2;
    }
    if (paTilbud.length) {
      const best = [...paTilbud].sort((a, b) => (b.hoved - a.hoved) || (b.v.andel - a.v.andel))[0];
      grunner.push(`${INGREDIENSER[best.key].navn} på tilbud hos ${best.t.butikk}${best.v.andel >= 0.2 ? ` (${Math.round(best.v.andel * 100)} % billigere)` : ''}`);
    }
    const harHjemme = Object.keys(r.ingredienser).filter((k) => !INGREDIENSER[k]?.basis && (mat.kjokken?.[k] || 0) > 0);
    if (harHjemme.length >= 2) grunner.push(`Dere har ${harHjemme.slice(0, 2).map((k) => INGREDIENSER[k].navn.toLowerCase()).join(' og ')} hjemme`);

    let favoritter = 0;
    for (const pr of profiler) {
      if ((pr.favoritter || []).some((f) => r.tags.includes(f))) favoritter++;
      if (misliker(r, pr)) poeng -= 6;
    }
    if (favoritter) { poeng += 4 * favoritter; grunner.push(favoritter === profiler.length && profiler.length > 1 ? 'Favoritt for alle' : 'En favoritt'); }
    if ((hus.stiler || []).includes(r.stil)) poeng += 1.2;
    if (r.tags.includes('ris') && (hus.utstyr || []).includes('riskoker')) poeng += 0.4;

    const v = Math.max(-3, Math.min(3, mat.vurderinger?.[r.id] || 0));
    poeng += v * 3;
    if (v > 0) grunner.push('Dere likte den sist');

    if (sistSpist[r.id]) {
      const d = dagerSiden(sistSpist[r.id]);
      if (d >= 0 && d < 7) poeng -= 10; else if (d >= 0 && d < 14) poeng -= 4;
    }
    if (hverdag && hus.tid && r.tid > Number(hus.tid) + 5) poeng -= 3;
    if (hverdag && r.tid <= 25) poeng += 0.6;
    if (forrige && forrige.tags.some((t) => HOVEDTAGS.includes(t) && r.tags.includes(t))) poeng -= 3;
    // Variasjon gjennom uka: trekk for hver gang samme type allerede står i menyen
    for (const t of r.tags) if (HOVEDTAGS.includes(t)) poeng -= 2.5 * ukeTags.filter((x) => x === t).length;

    const pris = prisFor(r, skala, tilbudInfo);
    const prisPerPorsjon = pris / porsjoner;
    poeng -= (prisPerPorsjon / 15) * sparevekt;
    const n = perPorsjon(r);
    if (fokus.has('protein')) {
      poeng += (n.p - 35) * 0.3;
      if (n.p >= 40) grunner.unshift(`💪 ${Math.round(n.p)} g protein per porsjon`);
      if (fokus.has('billig') || sparevekt > 1) {
        const perKrone = n.p / Math.max(8, prisPerPorsjon);
        poeng += (perKrone - 1.2) * 3;
        if (perKrone >= 1.5 && n.p >= 35) grunner.push('Mye protein for pengene');
      }
    }
    if (fokus.has('raskt')) poeng += r.tid <= 25 ? 2 : r.tid > 40 ? -3 : 0;
    if (fokus.has('lett')) poeng += n.kcal < 600 ? 2 : n.kcal > 800 ? -2 : 0;
    if (prisPerPorsjon < 30) grunner.push(`Bare ca. ${Math.round(prisPerPorsjon)} kr per porsjon`);
    return { r, poeng, grunner, paTilbud, pris, prisPerPorsjon, porsjoner, skala };
  }).sort((a, b) => b.poeng - a.poeng);
}

// ---------- Ukemeny ----------
export const leggTilDager = (dato, n) => { const d = new Date(dato + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function fyllMeny({ mat, personer, tilbud, fra, dager = 7 }) {
  const meny = { ...(mat.meny || {}) };
  const antall = Math.max(1, Math.min(7, Number(mat.husstand?.middager) || 5));
  const datoer = Array.from({ length: dager }, (_, i) => leggTilDager(fra, i));
  let planlagt = datoer.filter((d) => meny[d]?.id).length;
  const brukt = new Set(datoer.map((d) => meny[d]?.id).filter(Boolean));
  for (const d of datoer) {
    if (meny[d]?.id || meny[d]?.fri) continue;
    if (planlagt >= antall) { meny[d] = { fri: true }; continue; }
    const forrige = oppskrift(meny[leggTilDager(d, -1)]?.id);
    const ukeTags = [...brukt].flatMap((id) => oppskrift(id)?.tags || []);
    const [beste] = foreslaa({ mat: { ...mat, meny }, personer, tilbud, dato: d, unnta: brukt, forrige, ukeTags });
    if (!beste) continue;
    meny[d] = { id: beste.r.id };
    brukt.add(beste.r.id);
    planlagt++;
  }
  // Gamle dager beholdes som historikk – ingenting slettes
  return meny;
}

// ---------- Handleliste og kjøkken ----------
export function behovForMeny({ mat, personer, fra, dager = 7 }) {
  const behov = {};
  for (let i = 0; i < dager; i++) {
    const d = leggTilDager(fra, i);
    const m = mat.meny?.[d];
    const r = m?.id && !m.spist ? oppskrift(m.id) : null;
    if (!r) continue;
    const porsjoner = porsjonerFor(mat, personer, r).total;
    for (const [key, gram] of Object.entries(r.ingredienser)) {
      if (INGREDIENSER[key]?.basis) continue;
      (behov[key] ??= { gram: 0, retter: [] }).gram += (gram * porsjoner) / r.porsjoner;
      if (!behov[key].retter.includes(r.navn)) behov[key].retter.push(r.navn);
    }
  }
  const mangler = [];
  for (const [key, b] of Object.entries(behov)) {
    const har = mat.kjokken?.[key] || 0;
    const trenger = b.gram - har;
    if (trenger > 5) mangler.push({ key, gram: Math.round(trenger), retter: b.retter, pakker: Math.max(1, Math.ceil(trenger / INGREDIENSER[key].pakke)) });
  }
  return mangler.sort((a, b) => INGREDIENSER[a.key].navn.localeCompare(INGREDIENSER[b.key].navn, 'nb'));
}

export function snartTomt(mat) {
  const ut = [];
  for (const [key, gram] of Object.entries(mat.kjokken || {})) {
    const ing = INGREDIENSER[key];
    if (ing && !ing.basis && gram > 0 && gram < ing.pakke * 0.2) ut.push(key);
  }
  return ut;
}

export function mengdeTekst(key, gram, { opp = false } = {}) {
  const ing = INGREDIENSER[key];
  if (!ing) return `${Math.round(gram)} g`;
  if (ing.stk) {
    const n = gram / ing.stk;
    const verdi = opp ? Math.max(1, Math.ceil(n - 0.05)) : n >= 10 ? Math.round(n) : Math.max(0.5, Math.round(n * 2) / 2);
    return `${String(verdi).replace('.', ',')} stk`;
  }
  if (gram >= 1000) return `${(Math.round(gram / 100) / 10).toString().replace('.', ',')} kg`;
  return `${Math.round(gram / 10) * 10 || Math.round(gram)} g`;
}


// ================= Dagsplan: frokost, lunsj, mellommåltid og kveldsmat =================
const M = (id, navn, ikon, maltid, tags, ingredienser, ekstra = {}) => ({ id, navn, ikon, maltid, tags, ingredienser, ...ekstra });

// Mengder er for én vanlig porsjon (g)
export const MALTIDER = [
  M('grot', 'Havregrøt med banan', '🥣', 'frokost', ['grot'], { havregryn: 60, melk: 250, banan: 120 }),
  M('yoghurtgranola', 'Yoghurt med granola og bær', '🥣', 'frokost', ['yoghurt'], { yoghurt: 200, granola: 50, baer: 75 }),
  M('skyrbowl', 'Skyr med granola og banan', '💪', 'frokost', ['yoghurt'], { skyr: 250, granola: 40, banan: 120 }),
  M('brodegg', 'Brødskiver med egg', '🍞', 'frokost', ['brod', 'egg'], { brod: 100, egg: 120, smor: 10 }),
  M('eggerore', 'Eggerøre på brød', '🍳', 'frokost', ['egg', 'brod'], { egg: 180, melk: 30, smor: 10, brod: 70 }),
  M('knekkebrodost', 'Knekkebrød med ost og skinke', '🧀', 'frokost', ['brod'], { knekkebrod: 50, ost: 40, skinke: 40, smor: 10 }),
  M('yoghurtnotter', 'Yoghurt med bær og nøtter', '🥣', 'frokost', ['yoghurt'], { yoghurt: 200, baer: 75, notter: 20 }),
  M('eggbacon', 'Eggerøre med bacon', '🥓', 'frokost', ['egg'], { egg: 180, bacon: 40, melk: 30, smor: 5 }),
  M('smoothie', 'Smoothie med banan og bær', '🥤', 'frokost', ['smoothie'], { banan: 120, baer: 100, yoghurt: 200, havregryn: 30 }, { utstyr: 'blender' }),
  M('matpakke', 'Matpakke med ost og skinke', '🥪', 'lunsj', ['matpakke', 'brod'], { brod: 150, ost: 40, skinke: 50, smor: 15 }),
  M('matpakkeegg', 'Matpakke med egg', '🥪', 'lunsj', ['matpakke', 'brod', 'egg'], { brod: 150, egg: 120, smor: 15 }),
  M('rester', 'Rester fra middagen i går', '🍱', 'lunsj', ['rester'], {}, { rester: true }),
  M('tunfisksalat', 'Salat med tunfisk og egg', '🥗', 'lunsj', ['salat'], { salat: 100, tunfisk: 120, egg: 60, mais: 80, tomat: 100, olje: 10 }),
  M('kyllingsalatlunsj', 'Salat med kylling og mais', '🥗', 'lunsj', ['salat'], { salat: 100, kyllingfilet: 150, mais: 80, tomat: 100, olje: 10 }),
  M('kyllingwrap', 'Wrap med kylling', '🌯', 'lunsj', ['wrap'], { tortilla: 120, kyllingfilet: 150, salat: 50, romme: 50, ost: 30 }),
  M('knekkebrodcottage', 'Knekkebrød med cottage cheese', '🥗', 'lunsj', ['brod'], { knekkebrod: 50, kesam: 150, tomat: 80 }),
  M('kantine', 'Kantine eller kjøpt lunsj', '🏪', 'lunsj', ['kantine'], {}, { kcal: 650, p: 30, f: 25, k: 70 }),
  M('banan', 'Banan', '🍌', 'mellom', ['frukt'], { banan: 120 }, { fast: true }),
  M('eple', 'Eple', '🍎', 'mellom', ['frukt'], { eple: 150 }, { fast: true }),
  M('yoghurtsnack', 'Yoghurt med bær', '🍓', 'mellom', ['yoghurt'], { yoghurt: 150, baer: 50 }),
  M('skyrsnack', 'Skyr', '💪', 'mellom', ['yoghurt'], { skyr: 170 }),
  M('cottagesnack', 'Cottage cheese', '🥄', 'mellom', ['yoghurt'], { kesam: 150 }),
  M('notter', 'En neve nøtter', '🥜', 'mellom', ['notter'], { notter: 30 }, { fast: true }),
  M('proteinbar', 'Proteinbar', '💪', 'mellom', ['proteinbar'], { proteinbar: 55 }, { fast: true }),
  M('knekkebrodpeanott', 'Knekkebrød med peanøttsmør', '🥜', 'mellom', ['brod'], { knekkebrod: 25, peanottsmor: 15 }),
  M('kveldsbrod', 'Brødskiver med ost', '🍞', 'kveld', ['brod'], { brod: 100, ost: 30, smor: 10 }),
  M('kveldyoghurt', 'Yoghurt med granola', '🥣', 'kveld', ['yoghurt'], { yoghurt: 200, granola: 40 }),
  M('kveldcottage', 'Knekkebrød med cottage cheese', '🥗', 'kveld', ['brod'], { knekkebrod: 40, kesam: 120 }),
];
export const maltid = (id) => MALTIDER.find((x) => x.id === id);
export const MALTIDSNAVN = { frokost: 'Frokost', lunsj: 'Lunsj', middag: 'Middag', mellom: 'Mellommåltid', kveld: 'Kveldsmat' };

// Rester som ligger i kjøkkenet (fra middager som er ført som spist), nyeste først
export const RESTER_DAGER = 4;
export function resterFor(mat, dato) {
  return (mat.rester || [])
    .filter((x) => x.porsjoner > 0.2 && oppskrift(x.oppskrift) && x.dato <= dato && x.dato >= leggTilDager(dato, -RESTER_DAGER))
    .sort((a, b) => b.dato.localeCompare(a.dato));
}

export function naeringMaltid(m, faktor = 1, mat = null, dato = null) {
  if (m.rester && mat && dato) {
    // Først rester som faktisk ligger i kjøkkenet …
    const rest = resterFor(mat, dato)[0];
    let r = rest ? oppskrift(rest.oppskrift) : null;
    // … ellers gårsdagens middag, hvis dere lager ekstra og den ikke er ført ennå
    if (!r && mat.husstand?.rester === 'ja') {
      const igaar = mat.meny?.[leggTilDager(dato, -1)];
      if (igaar?.id && !igaar.spist) r = oppskrift(igaar.id);
    }
    if (r) { const n = perPorsjon(r); return { kcal: n.kcal * faktor, p: n.p * faktor, f: n.f * faktor, k: n.k * faktor, fra: r, restId: rest?.id, maks: rest?.porsjoner }; }
    return null;
  }
  if (m.kcal) return { kcal: m.kcal * faktor, p: m.p * faktor, f: m.f * faktor, k: m.k * faktor };
  const sum = { kcal: 0, p: 0, f: 0, k: 0 };
  for (const [key, gram] of Object.entries(m.ingredienser)) {
    const ing = INGREDIENSER[key];
    if (!ing) continue;
    for (const n of Object.keys(sum)) sum[n] += (ing[n] * gram * faktor) / 100;
  }
  return sum;
}

function passerMaltid(m, pr) {
  const ingr = Object.keys(m.ingredienser).map((k) => INGREDIENSER[k]).filter(Boolean);
  if ((pr.allergier || []).some((a) => ingr.some((i) => i.allergener.includes(a)))) return false;
  const forbud = FORBUDT[pr.kosthold];
  if (forbud && ingr.some(forbud)) return false;
  if ((pr.misliker || []).some((x) => (MISLIKER[x] || []).some((k) => k in m.ingredienser))) return false;
  return true;
}

const ONSKER = { frokost: 'frokostvaner', lunsj: 'lunsjvaner', mellom: 'mellomvaner', kveld: 'mellomvaner' };
// Har personen sagt hva hen liker til et måltid, foreslås bare det. Passer ingenting av det, vises alt.
const onskerFor = (pr, slot) => new Set((pr?.[ONSKER[slot]] || []).filter((x) => x !== 'hopper'));
const liker = (x, onsker) => x.tags.some((t) => onsker.has(t));
function etterOnsker(liste, onsker) {
  if (!onsker.size) return liste;
  const likte = liste.filter((x) => liker(x, onsker));
  return likte.length ? likte : liste;
}
const SLOTANDEL = { frokost: 0.27, lunsj: 0.33, mellom: 0.17, kveld: 0.15 };
const hashTall = (tekst) => { let h = 0; for (const c of tekst) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

export function slotsFor(pr) {
  const antall = Number(pr?.maltider) || 4;
  const slots = ['frokost', 'lunsj'];
  if (antall >= 4) slots.push('mellom');
  if (antall >= 5) slots.push('kveld');
  if ((pr?.frokostvaner || []).includes('hopper')) slots.shift();
  return slots;
}

// Lager dagsplanen for én person. Brukerens egne valg ligger i mat.dagsplaner[dato][personId][slot].
export function dagsplan({ mat, personer, personId, dato }) {
  const pr = mat.profiler?.[personId] || {};
  const mal = beregnMal(pr) || { kcal: 2200, protein: 90, fett: 73, karbo: 280, middagKcal: 770, utenMal: true };
  const fokus = new Set(mat.husstand?.fokus || []);
  const utstyr = mat.husstand?.utstyr;
  const valgt = mat.dagsplaner?.[dato]?.[personId] || {};
  const kjokken = mat.kjokken || {};

  // Middagen fra ukemenyen
  const m = mat.meny?.[dato];
  const r = m?.id ? oppskrift(m.id) : null;
  let middag = null;
  if (r) { const f = porsjonFor(pr, r); const n = perPorsjon(r); middag = { slot: 'middag', r, faktor: f, kcal: n.kcal * f, p: n.p * f, f: n.f * f, k: n.k * f }; }

  const slots = slotsFor(pr);
  const restKcal = Math.max(600, mal.kcal - (middag?.kcal ?? mal.middagKcal));
  const andelSum = slots.reduce((s, x) => s + SLOTANDEL[x], 0);
  const brukt = new Set();
  const bruktVarer = new Set();
  let proteinSaaLangt = middag?.p || 0;
  const ut = [];
  for (const slot of slots) {
    const mal_kcal = restKcal * (SLOTANDEL[slot] / andelSum);
    const onsker = onskerFor(pr, slot);
    const alle = MALTIDER.filter((x) => x.maltid === slot || (slot === 'kveld' && x.maltid === 'mellom'))
      .filter((x) => passerMaltid(x, pr) && !brukt.has(x.id))
      .filter((x) => !x.utstyr || !utstyr?.length || utstyr.includes(x.utstyr))
      .filter((x) => !x.rester || naeringMaltid(x, 1, mat, dato))
      .filter((x) => !x.tags.includes('kantine') || onsker.has('kantine'));
    const kandidater = etterOnsker(alle, onsker);
    const poeng = (x) => {
      let p = 0;
      if (x.tags.some((t) => onsker.has(t))) p += 6;
      const keys = Object.keys(x.ingredienser).filter((k) => !INGREDIENSER[k]?.basis);
      const har = keys.filter((k) => (kjokken[k] || 0) > 0).length;
      if (keys.length && har === keys.length) p += 3; else p += har * 0.8;
      if (x.rester) p += onsker.has('rester') ? 4 : 1;
      const n = naeringMaltid(x, 1, mat, dato);
      // Protein teller bare så lenge dagsmålet ikke er nådd
      const proteinBehov = Math.max(0, 1 - proteinSaaLangt / Math.max(1, mal.protein));
      if (n) p += (n.p / Math.max(1, n.kcal)) * 100 * (fokus.has('protein') || VIL_HA_PROTEIN.has(pr.mal) ? 0.6 : 0.2) * proteinBehov;
      if (x.maltid === slot) p += 2;
      if (x.rester && n?.restId) p += 3; // rester som ligger i kjøleskapet bør spises før de blir gamle
      // Pris teller når dere vil spare
      if (fokus.has('billig') || mat.husstand?.sparing === 'veldig') {
        const kr = Object.entries(x.ingredienser).reduce((sum, [k, g]) => sum + (INGREDIENSER[k] && !INGREDIENSER[k].basis ? (g / 1000) * INGREDIENSER[k].pris : 0), 0);
        p -= kr / 10;
      }
      // Variasjon: ikke samme hovedvare flere ganger samme dag
      p -= 3 * Object.entries(x.ingredienser).filter(([k, g]) => g >= 100 && bruktVarer.has(k)).length;
      if (fokus.has('lett') && n) p += n.kcal < 350 ? 1 : 0;
      p += (hashTall(`${dato}|${personId}|${slot}|${x.id}`) % 100) / 100 * 2.2; // litt variasjon fra dag til dag
      return p;
    };
    let valgtM = valgt[slot] ? maltid(valgt[slot]) : null;
    if (!valgtM) valgtM = [...kandidater].sort((a, b) => poeng(b) - poeng(a))[0];
    if (!valgtM) continue;
    brukt.add(valgtM.id);
    for (const [k, g] of Object.entries(valgtM.ingredienser)) if (g >= 100) bruktVarer.add(k);
    const n1 = naeringMaltid(valgtM, 1, mat, dato);
    if (!n1) continue;
    let faktor = n1.kcal ? mal_kcal / n1.kcal : 1;
    const maks = slot === 'mellom' || slot === 'kveld' ? 1.5 : 2;
    faktor = valgtM.fast ? Math.min(valgtM.tags.includes('frukt') ? 2 : 1, Math.max(1, Math.round(faktor))) : Math.min(maks, Math.max(0.5, Math.round(faktor * 4) / 4));
    if (n1.maks) faktor = Math.max(0.25, Math.min(faktor, Math.floor(n1.maks * 4) / 4));
    const n = naeringMaltid(valgtM, faktor, mat, dato);
    const mangler = Object.keys(valgtM.ingredienser).filter((k) => !INGREDIENSER[k]?.basis && !((kjokken[k] || 0) >= valgtM.ingredienser[k] * faktor * 0.9));
    proteinSaaLangt += n.p;
    ut.push({ slot, m: valgtM, faktor, ...n, mangler });
  }
  if (middag) ut.push(middag);
  const REKKE = ['frokost', 'lunsj', 'mellom', 'middag', 'kveld'];
  ut.sort((x, y) => REKKE.indexOf(x.slot) - REKKE.indexOf(y.slot));
  const total = ut.reduce((s, x) => ({ kcal: s.kcal + x.kcal, p: s.p + x.p, f: s.f + x.f, k: s.k + x.k }), { kcal: 0, p: 0, f: 0, k: 0 });
  return { maltider: ut, total, mal };
}

// Alternativer når man vil bytte et måltid
export function alternativer({ mat, personId, slot, dato }) {
  const pr = mat.profiler?.[personId] || {};
  const utstyr = mat.husstand?.utstyr;
  const onsker = onskerFor(pr, slot);
  const alle = MALTIDER.filter((x) => (x.maltid === slot || (slot === 'kveld' && x.maltid === 'mellom')) && passerMaltid(x, pr))
    .filter((x) => !x.utstyr || !utstyr?.length || utstyr.includes(x.utstyr))
    .filter((x) => !x.rester || naeringMaltid(x, 1, mat, dato))
    .filter((x) => !x.tags.includes('kantine') || onsker.has('kantine'));
  // Bare det personen liker, så lenge det finnes minst to å bytte mellom
  const likte = onsker.size ? alle.filter((x) => liker(x, onsker) || (x.rester && onsker.has('rester'))) : alle;
  return likte.length >= 2 ? likte : alle;
}

// ================= Ukeshandel: alt dere trenger den neste uka =================
export function behovForUke({ mat, personer, fra, dager = 7, medDagsplan = true }) {
  const behov = {};
  const legg = (key, gram, hva) => {
    if (!INGREDIENSER[key] || INGREDIENSER[key].basis || !(gram > 0)) return;
    (behov[key] ??= { gram: 0, retter: [] }).gram += gram;
    if (!behov[key].retter.includes(hva)) behov[key].retter.push(hva);
  };
  for (let i = 0; i < dager; i++) {
    const d = leggTilDager(fra, i);
    const m = mat.meny?.[d];
    const r = m?.id && !m.spist ? oppskrift(m.id) : null;
    if (r) {
      const porsjoner = porsjonerFor(mat, personer, r).total;
      for (const [key, gram] of Object.entries(r.ingredienser)) legg(key, (gram * porsjoner) / r.porsjoner, r.navn);
    }
    if (!medDagsplan) continue;
    for (const p of personer) {
      if (!mat.profiler?.[p.id]?.frokostvaner && !mat.profiler?.[p.id]?.lunsjvaner) continue; // bare for de som har svart
      const plan = dagsplan({ mat, personer, personId: p.id, dato: d });
      for (const x of plan.maltider) {
        if (x.slot === 'middag' || !x.m?.ingredienser) continue;
        const spist = (mat.logg || []).some((l) => l.type === 'maltid' && l.dato === d && l.person === p.id && l.slot === x.slot);
        if (spist) continue;
        for (const [key, gram] of Object.entries(x.m.ingredienser)) legg(key, gram * x.faktor, MALTIDSNAVN[x.slot]);
      }
    }
  }
  // Baker dere selv, står det brødmiks på lista i stedet for brød (1 kg miks blir ca. 1,6 kg brød)
  if (mat.husstand?.brod === 'selv' && behov.brod) {
    const b = behov.brod;
    delete behov.brod;
    const igjen = b.gram - (mat.kjokken?.brod || 0);
    if (igjen > 0) { const m = (behov.brodmiks ??= { gram: 0, retter: [] }); m.gram += igjen / 1.6; for (const r of b.retter) if (!m.retter.includes(r)) m.retter.push(r); }
  }
  const mangler = [];
  for (const [key, b] of Object.entries(behov)) {
    const trenger = b.gram - (mat.kjokken?.[key] || 0);
    if (trenger > 5) mangler.push({ key, gram: Math.round(trenger), retter: b.retter, pakker: Math.max(1, Math.ceil(trenger / INGREDIENSER[key].pakke)) });
  }
  return mangler.sort((a, b) => INGREDIENSER[a.key].navn.localeCompare(INGREDIENSER[b.key].navn, 'nb'));
}

// ================= Hvilken butikk er billigst? =================
// Grovt prisnivå på varer som ikke er på tilbud (1,00 = lavpris). Et anslag, ikke målte priser.
export const PRISNIVA = { 'REMA 1000': 1.0, 'KIWI': 1.0, 'Coop Extra': 1.0, 'Coop Obs': 0.99, 'Coop Prix': 1.06, 'Eurospar': 1.08, 'SPAR': 1.08, 'Joker': 1.15, 'MENY': 1.15, 'Bunnpris': 1.1, 'Coop Mega': 1.1 };

const butikkCache = new WeakMap();
export function tilbudPerButikk(tilbud) {
  if (!tilbud) return {};
  if (butikkCache.has(tilbud)) return butikkCache.get(tilbud);
  const ut = {};
  for (const [key, ing] of Object.entries(INGREDIENSER)) {
    if (!ing.sok.length) continue;
    const passer = lagMatcher({ sok: ing.sok, ikke: ing.ikke });
    for (const t of tilbud) {
      if (!passer(t.tittel)) continue;
      const kg = t.enhet === 'kg' || t.enhet === 'l' ? t.enhetspris : t.enhet === 'stk' && ing.stk ? (t.enhetspris * 1000) / ing.stk : null;
      if (!(kg > 0)) continue;
      const b = (ut[t.butikk] ??= {});
      if (!b[key] || kg < b[key].kg) b[key] = { kg, t };
    }
  }
  butikkCache.set(tilbud, ut);
  return ut;
}

export function butikkanbefaling({ varer, tilbud, foretrukne = [] }) {
  const perButikk = tilbudPerButikk(tilbud);
  const butikker = [...new Set([...(tilbud || []).map((t) => t.butikk)])].filter((b) => !foretrukne.length || foretrukne.includes(b));
  if (!butikker.length || !varer.length) return null;
  const prisHos = (b, v) => {
    const ing = INGREDIENSER[v.key];
    const tb = perButikk[b]?.[v.key];
    const kg = tb && tb.kg < ing.pris * (PRISNIVA[b] ?? 1.05) ? tb.kg : ing.pris * (PRISNIVA[b] ?? 1.05);
    return { kr: v.pakker * (ing.pakke / 1000) * kg, tilbud: !!tb && tb.kg < ing.pris * (PRISNIVA[b] ?? 1.05) };
  };
  const totaler = butikker.map((b) => {
    let sum = 0, antallTilbud = 0;
    for (const v of varer) { const p = prisHos(b, v); sum += p.kr; if (p.tilbud) antallTilbud++; }
    return { butikk: b, sum, antallTilbud };
  }).sort((a, b) => a.sum - b.sum);
  // Lønner det seg å dele handelen på to butikker?
  let deling = null;
  for (let i = 0; i < totaler.length; i++) for (let j = i + 1; j < totaler.length; j++) {
    const a = totaler[i].butikk, b = totaler[j].butikk;
    let sum = 0; const hosB = [];
    for (const v of varer) { const pa = prisHos(a, v).kr, pb = prisHos(b, v).kr; if (pb < pa) { sum += pb; hosB.push(v.key); } else sum += pa; }
    const spar = totaler[0].sum - sum;
    if (hosB.length && spar > 40 && (!deling || spar > deling.spar)) deling = { a, b, hosB, sum, spar };
  }
  return { totaler, beste: totaler[0], deling };
}


// ================= Hva kan vi lage av det som er i kjøkkenet? =================
// Dekning vektes etter mengde, så kylling og ris teller mer enn litt paprika.
function dekning(ingredienser, skala, kjokken) {
  let har = 0, totalt = 0;
  const mangler = [], forLite = [], bruker = [];
  for (const [k, g] of Object.entries(ingredienser)) {
    const ing = INGREDIENSER[k];
    if (!ing || ing.basis) continue;
    const trenger = g * skala, finnes = kjokken[k] || 0, vekt = Math.min(600, trenger);
    totalt += vekt;
    if (finnes >= trenger * 0.9) { har += vekt; bruker.push(k); }
    else if (finnes > 0) { har += vekt * Math.min(0.8, finnes / trenger); forLite.push(k); bruker.push(k); }
    else mangler.push(k);
  }
  return totalt ? { andel: har / totalt, mangler, forLite, bruker } : null;
}

export function fraKjokkenet({ mat, personer, personId, dato }) {
  const kjokken = mat.kjokken || {};
  const snart = new Set(snartTomt(mat));
  const profiler = personer.map((p) => mat.profiler?.[p.id] || {});
  const utstyr = mat.husstand?.utstyr || [];
  const harUtstyr = (krav) => !utstyr.length || !krav || [].concat(krav).every((k) => k.split('|').some((u) => utstyr.includes(u)));
  const sorter = (a, b) => (a.mangler.length + a.forLite.length * 0.5) - (b.mangler.length + b.forLite.length * 0.5) || b.andel - a.andel || b.poeng - a.poeng;
  const middager = OPPSKRIFTER
    .filter((r) => passerFor(r, profiler) && !profiler.some((pr) => misliker(r, pr)) && harUtstyr(r.utstyr))
    .map((r) => {
      const por = porsjonerFor(mat, personer, r);
      const d = dekning(r.ingredienser, por.total / r.porsjoner, kjokken);
      if (!d) return null;
      const poeng = d.bruker.filter((k) => snart.has(k)).length + (mat.vurderinger?.[r.id] || 0) * 0.3;
      return { r, ...d, poeng };
    })
    .filter((x) => x && x.andel >= 0.5 && x.mangler.length <= 3)
    .sort(sorter);
  const pr = mat.profiler?.[personId] || {};
  const maltider = MALTIDER
    .filter((m) => !m.rester && !m.kcal && passerMaltid(m, pr) && harUtstyr(m.utstyr))
    .filter((m) => { const o = onskerFor(pr, m.maltid); return !o.size || liker(m, o) || !MALTIDER.some((y) => y.maltid === m.maltid && liker(y, o)); })
    .map((m) => { const d = dekning(m.ingredienser, 1, kjokken); return d ? { m, ...d, poeng: d.bruker.filter((k) => snart.has(k)).length } : null; })
    .filter((x) => x && x.andel >= 0.6 && x.mangler.length <= 1)
    .sort(sorter);
  return { middager, maltider, rester: resterFor(mat, dato) };
}
