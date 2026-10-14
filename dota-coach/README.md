# Dota Coach

Dota Coach er en coach for Dota 2 som kjører på din egen PC, litt som Blitz for League of Legends:

- **Før kampen – draft-hjelp:** legg inn fiendene, så får du forslag til hero for din posisjon og rank. Hvert forslag har en forklaring, f.eks. «Sterk mot Axe +6 %».
- **I kampen – live-coach og overlay:**
  - **Fight-meter** som sier om du bør *kjempe*, *presse*, *farme* eller *trekke deg* akkurat nå, og hvorfor.
  - Neste item, hvor mye gull du mangler, og items mot akkurat dette fiendelaget.
  - Varsler som lav HP, ingen TP, items i stashen, ubrukte skill-poeng og at du står dypt på fiendens side.
  - Timere for runer, stacks, neutral items, Tormentor og Roshan.
  - Hvor du bør farme, og tips som leses opp med stemme.
- **Etter kampen – kampanalyse:**
  - Karakter (S–D) og poeng for laning, farm, overlevelse, items, fights og disiplin.
  - Hva som gikk bra, hva som gikk dårlig, og 3–5 konkrete ting å jobbe med til neste kamp.
  - Grafer, kart over hvor du døde (og hvorfor), item-timinger og viktige øyeblikk.
- **Kamphistorikk og trender:** snittscore, vinnerrate og feilene du gjør oftest over de siste kampene.
- **Meta og builds:** tier-liste per posisjon og rank, og populære builds for hver hero.

Alt er laget for patch **7.41**. Meta og builds hentes fra OpenDota, så de oppdateres av seg selv.

---

## Kom i gang (Windows)

1. **Installer Node.js:** last ned «LTS» fra <https://nodejs.org> og installer med standardvalg.
2. **Last ned denne mappen** (`dota-coach`) til PC-en, for eksempel `C:\dota-coach`.
3. **Dobbeltklikk `setup.bat`.** Den finner Dota-mappen og legger inn konfig-filen for Game State Integration.
4. **I Steam:** høyreklikk *Dota 2* → *Egenskaper* → *Generelt* → *Startalternativer*, og skriv inn:
   ```
   -gamestateintegration
   ```
5. **I Dota 2:** *Innstillinger → Video → Visningsmodus: Borderless Window* (da kan overlayet ligge oppå spillet).
6. **Dobbeltklikk `Dota Coach.bat`.** Appen åpner seg med et overlay på høyre side av skjermen. Første gang laster den ned app-komponenten (~100 MB, tar et minutt).
7. **Start Dota 2.** Statusen nede til venstre i appen blir grønn når data kommer inn.

> Vil du se hvordan alt ser ut uten å starte Dota? Dobbeltklikk **`demo.bat`**. Da spilles en simulert kamp med Anti-Mage, og kampanalysen dukker opp til slutt.
>
> Vil du heller bruke nettleseren enn appen? Kjør **`start.bat`** i stedet for `Dota Coach.bat`.

### Hurtigtaster i appen

| Tast | Funksjon |
|---|---|
| <kbd>Alt+Shift+D</kbd> | Vis eller skjul appvinduet |
| <kbd>Alt+Shift+C</kbd> | Vis eller skjul overlayet |
| <kbd>Alt+Shift+M</kbd> | Flytt overlayet (dra det), og trykk igjen for å låse |
| <kbd>Alt+Shift+S</kbd> | Tale av og på |

Lukker du appvinduet, fortsetter coachen i bakgrunnen (ikonet nede til høyre ved klokka). Avslutt helt via høyreklikk på ikonet.

### Andre måter å se coachen på

| Alternativ | Slik gjør du |
|---|---|
| **Lite vindu som alltid ligger øverst** | Kjør `start.bat`, og trykk «⧉ Overlay-vindu» øverst i dashboardet (Chrome/Edge). |
| **Mobil eller nettbrett som skjerm nr. 2** | Kjør `start.bat --lan` og åpne adressen den skriver ut, på samme Wi-Fi. |

### Tale

Tipsene leses opp med Windows-stemmen. For norsk uttale: *Innstillinger → Tid og språk → Tale → Legg til stemmer → Norsk (bokmål)*. Velg stemme og hastighet under *Oppsett*.

---

## Fight-meteret: når du bør kjempe og når du bør farme

Øverst i live-coachen og i overlayet står det hele tiden én av disse:

| Visning | Betyr |
|---|---|
| ⚔️ **KJEMP** | Du er på et powerspike. Se etter fights eller en gank. |
| 🔥 **PRESS** | Ta initiativ: press tårn, ta objektiver og bli med når laget går. |
| ⚖️ **NØYTRAL** | Farm, men vær klar til å bli med. |
| 🌾 **FARM** | Farm og chill. Vent til du er sterkere. |
| 🛑 **TREKK DEG** | Ikke kjemp nå. |

Det regnes ut fra blant annet:

- **Powerspikes:** et nytt nøkkelitem (Battle Fury, BKB, Blink …) eller nivå 6.
- **Cooldowns:** om ultimaten eller BKB/Blink er klare.
- **Om du er nær neste item:** «Bare 400 gull til BKB. Farm den ferdig først.»
- **Hero-kurve:** early-, mid- eller late-game hero, og hvilket lag som er sterkest i denne fasen (bruker draften).
- HP og mana, kill-ledelse, Aegis, nylige dødsfall og buyback.

Du ser alltid hvorfor, f.eks. «+25 Nytt powerspike: Battle Fury» og «−20 Ultimaten er på cooldown». Når meteret skifter, får du beskjed med tale.

## Kampanalyse etter kampen

Coachen tar opp kampen underveis (hvert 10. sekund, pluss hendelser). Når kampen er ferdig, åpnes analysen automatisk under **Kamper**:

- **Karakter og poeng** totalt og per område. Supports vurderes etter andre mål enn carries (mer vekt på fights og overlevelse, ikke på farm).
- **Dette gikk bra / Dette kan bli bedre:** f.eks. «72 last hits ved 10:00 (mål 65)» eller «3 av dødsfallene skjedde på fiendens side av kartet».
- **Fokus til neste kamp:** konkrete tips for de svakeste områdene.
- **Hvor du døde:** kart med alle dødsfall og årsak (på fiendens side, mens coachen sa FARM, med mye upålitelig gull, uten TP …).
- **Item-timinger** sammenlignet med en vanlig spiller på samme hero, og **viktige øyeblikk** (powerspikes, Roshan, dødsfall).
- **Fra OpenDota:** hero damage, tårnskade og net worth (rangert på laget ditt), og wards og stacks hvis kampen er analysert. Dette kommer 5–15 min etter kampen, og bare hvis *Expose Public Match Data* er slått på i Dota (Innstillinger → Sosialt).

Rapportene lagres i mappen `matches/` på din PC.

## Fair play

Coachen bruker bare **Valves offisielle Game State Integration** (den samme som brukes av blant annet strømmeverktøy). Den:

- ser bare det du selv ser: din hero, gull, items, klokke og posisjon,
- leser **ikke** minnet til spillet og endrer ingenting i Dota,
- viser **ingen** info om motspillerne som profiler, MMR eller historikk (det har Valve forbudt i overlays).

## Feilsøking

| Problem | Løsning |
|---|---|
| Statusen blir aldri grønn | Sjekk at `-gamestateintegration` står i startalternativene, og start Dota på nytt. Kjør `setup.bat` på nytt. Finner den ikke Dota, kjør `setup.bat --path "D:\SteamLibrary\steamapps\common\dota 2 beta"`. |
| «Porten er allerede i bruk» | Coachen kjører allerede (sjekk ikonet ved klokka). |
| Ingen builds eller meta | Coachen trenger internett for å hente fra OpenDota. Etterpå lagres dataene i `cache/`. |
| Overlayet vises ikke over spillet | Dota må stå i *Borderless Window*, ikke vanlig fullskjerm. |
| Ingen tale | Trykk <kbd>Alt+Shift+S</kbd>, og velg en stemme under *Oppsett*. |
| Ingen kampanalyse | Analysen lages for kamper som varer minst 5 minutter, og bare når coachen kjørte under kampen. |

## Tilpass selv

All spillkunnskap ligger som vanlig tekst:

- `data/knowledge.js`: timinger, «fokus»-tekster, counter-items, tips mot heroer, hero-kurver (early/mid/late) og powerspike-items.
- `data/positions.js`: hvilke posisjoner hver hero spilles i.
- `src/coach/rules.js`: alle live-varslene.
- `src/coach/fight.js`: hvordan fight-meteret regnes ut.
- `src/coach/analysis.js`: karakterene, tersklene og tipsene i kampanalysen.

Kommer det en ny patch, sjekk timingene i `data/knowledge.js`. Hero- og item-lister oppdateres med `npm i --no-save dotaconstants && npm run build-data`.

## For utviklere

```
npm test              # tester (node:test, ingen avhengigheter)
npm run server        # bare serveren
npm run simulate      # simulert kamp mot en kjørende server (--speed 15 --hero juggernaut --start 600)
npm run overlay       # desktop-appen (Electron) – starter serveren selv
```

Serveren (`src/server.js`) har ingen avhengigheter utover Node. Den tar imot GSI på `POST /gsi`, regner ut coach-tilstanden (`src/coach/`) og sender den til appen og overlayet med Server-Sent Events (`/api/stream`). Kamper analyseres i `src/coach/analysis.js` og lagres i `matches/`. OpenDota-svar lagres i `cache/`, slik at appen holder seg godt under rate-limiten.

Data: [OpenDota API](https://docs.opendota.com) og [dotaconstants](https://github.com/odota/dotaconstants). Dota 2 er et varemerke for Valve Corporation. Dette prosjektet er ikke tilknyttet Valve.
