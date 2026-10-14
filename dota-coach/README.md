# Dota Coach

Dota Coach er en coach for Dota 2 som kjører på din egen PC, litt som Blitz for League of Legends:

- **Før kampen – automatisk draft-hjelp:** desktop-appen kjenner igjen heroene i draften fra skjermen, og overlayet viser hva du bør picke for din posisjon og rank, mens du picker. Hvert forslag har en forklaring, f.eks. «Sterk mot Axe +6 %». Du kan også legge inn eller rette heroer selv.
- **I kampen – live-coach og overlay:**
  - **Fight-meter** som sier om du bør *kjempe*, *presse*, *farme* eller *trekke deg* akkurat nå, og hvorfor.
  - Neste item, hvor mye gull du mangler, og items mot akkurat dette fiendelaget.
  - **Neste evne å skille**, **talentvalg** med prosent fra pro-kamper, og hvilket **nøytralt item** og hvilken **fortryllelse** du bør velge.
  - Varsler som lav HP, ingen TP, items i stashen, ubrukte skill-poeng og at du står dypt på fiendens side.
  - Timere for runer, stacks, neutral items, Tormentor og Roshan.
  - Hvor du bør farme, og tips som leses opp med stemme.
- **Etter kampen – kampanalyse:**
  - Karakter (S–D) og poeng for laning, farm, overlevelse, items, fights og disiplin.
  - Hva som gikk bra, hva som gikk dårlig, og 3–5 konkrete ting å jobbe med til neste kamp.
  - Grafer, kart over hvor du døde (og hvorfor), item-timinger og viktige øyeblikk.
- **Kamphistorikk og trender:** snittscore, vinnerrate og feilene du gjør oftest over de siste kampene.
- **Meta og builds:** tier-liste per posisjon og rank, og populære builds, skill-rekkefølge, talenter og nøytrale items for hver hero.

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

## Oppdateringer – du trenger aldri laste ned på nytt

Dota Coach oppdaterer seg selv fra GitHub:

- Når appen starter, ser den etter en ny versjon. Finnes det en, og du ikke er i en kamp, installeres den automatisk, og appen starter på nytt i løpet av noen sekunder.
- Mens appen kjører, sjekker den hver tredje time. Kommer det noe nytt, får du et banner med **Oppdater nå**. Den oppdaterer aldri av seg selv midt i en kamp.
- Bare filene som er endret, lastes ned, og hver fil sjekkes mot GitHub før den tas i bruk.
- Før noe byttes ut, tas det backup (mappen `backup/`). Den nye versjonen testes før den startes. Feiler testen, settes den gamle versjonen tilbake automatisk.
- Under **Oppsett → Oppdateringer** ser du hva som er nytt. Der kan du også se etter oppdateringer selv, slå av automatisk installering, eller **angre siste oppdatering**. Starter ikke appen i det hele tatt, kjør `rollback.bat`.
- Innstillingene dine og kamphistorikken din blir aldri rørt av en oppdatering.

> **Har du egne endringer i filene?** De blir overskrevet når en ny versjon kommer, men en kopi ligger i `backup/`.

### Hjelp coachen å bli bedre

Under **Oppsett** finner du **📋 Kopier diagnose**. Den kopierer versjon, status, eventuelle feilmeldinger og de siste kampanalysene (ingen passord eller personlig info). Lim teksten inn i chatten med Claude sammen med det du vil ha endret. Da kan forbedringen sendes ut som en oppdatering, og du får den automatisk.

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

## Automatisk draft

Dota gir ikke andre apper beskjed om hvilke heroer fiendene picker. Desktop-appen (`Dota Coach.bat`) ser derfor på heroportrettene øverst på skjermen under draften, og tidlig i kampen til alle 10 er funnet:

- Heroer den har kjent igjen, havner automatisk i draften (merket **AUTO** under *Draft-hjelp*).
- Overlayet viser de 5 beste pickene for deg mens draften pågår, og oppdaterer dem for hver ny pick.
- Feil hero? Klikk på den under *Draft-hjelp* for å fjerne den. Den kommer ikke tilbake i denne kampen.
- Første gang laster appen ned bildene av heroene (lagres i `cache/heroimg`).
- Bildene behandles bare på din PC. Ingenting lagres, med mindre du trykker **📸 Lagre skjermbilde** (for feilsøking). Da havner bildet i mappen `debug/`.

Gjenkjenningen virker best når Dota står i *Borderless Window*. Bommer den, trykk **📸 Lagre skjermbilde** under draften, og send bildet og «Kopier diagnose» til Claude, så blir den justert i neste oppdatering.

## Evner, talenter og nøytrale items

Coachen henter skill-rekkefølgen, talentene og de nøytrale itemene fra de siste ~400 pro-kampene med heroen din (OpenDota), og bruker dem live:

- **Neste evne:** når du har et ubrukt poeng, sier den hva du bør skille, f.eks. «Skill Blink (nivå 3) – 82 % av pro-spillerne gjør det her». Den foreslår aldri noe du ikke kan skille ennå.
- **Talenter:** ved nivå 10, 15, 20 og 25 ser du hvor mange som velger hver side, og hvilket som er anbefalt. Dør du mye, får du et hint om det defensive valget.
- **Nøytrale items:** når du kan lage et nøytralt item, viser den artefaktene med andelen pro-spillere som bruker dem, og anbefaler en fortryllelse ut fra rollen din (carry, mid, offlane eller support). Pro-kampene viser bare nøytralt item i sluttbuilden, så for tidlige tiers velges artefakten ofte etter hva statsene gir helten din.

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
- leser draften fra **skjermbildet** (det du selv ser på skjermen), ikke fra spillet,
- leser **ikke** minnet til spillet og endrer ingenting i Dota,
- viser **ingen** info om motspillerne som profiler, MMR eller historikk (det har Valve forbudt i overlays).

## Feilsøking

| Problem | Løsning |
|---|---|
| Statusen blir aldri grønn | Sjekk at `-gamestateintegration` står i startalternativene, og start Dota på nytt. Kjør `setup.bat` på nytt. Finner den ikke Dota, kjør `setup.bat --path "D:\SteamLibrary\steamapps\common\dota 2 beta"`. |
| «Porten er allerede i bruk» | Coachen kjører allerede (sjekk ikonet ved klokka). |
| Ingen builds eller meta | Coachen trenger internett for å hente fra OpenDota. Etterpå lagres dataene i `cache/`. |
| Overlayet vises ikke over spillet | Dota må stå i *Borderless Window*, ikke vanlig fullskjerm. |
| Draften fylles ikke inn av seg selv | Bruk desktop-appen (`Dota Coach.bat`) og *Borderless Window*. Se at «🤖 Automatisk» står under *Draft-hjelp*. Bommer den, trykk **📸 Lagre skjermbilde** og send bildet til Claude. Heroene kan alltid legges inn for hånd. |
| Ingen råd om evner eller talenter | Rådene kommer fra OpenDota. Uten internett, eller for helt nye heroer, finnes det ikke data ennå. |
| Ingen tale | Trykk <kbd>Alt+Shift+S</kbd>, og velg en stemme under *Oppsett*. |
| Ingen kampanalyse | Analysen lages for kamper som varer minst 5 minutter, og bare når coachen kjørte under kampen. |
| En oppdatering ødela noe | Oppsett → **Angre siste oppdatering**, eller kjør `rollback.bat`. Si fra, så blir det fikset i neste versjon. |
| «Oppdateringen feilet» | Sjekk internett. GitHub begrenser antall sjekker i timen, så prøv igjen senere. |

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
node src/selftest.js  # selvtesten som kjøres etter hver oppdatering
node tools/release.js patch "Hva er nytt"   # ny versjon (se CLAUDE.md)
```

Serveren (`src/server.js`) har ingen avhengigheter utover Node. Den tar imot GSI på `POST /gsi`, regner ut coach-tilstanden (`src/coach/`) og sender den til appen og overlayet med Server-Sent Events (`/api/stream`). Kamper analyseres i `src/coach/analysis.js` og lagres i `matches/`. OpenDota-svar lagres i `cache/`, slik at appen holder seg godt under rate-limiten.

Data: [OpenDota API](https://docs.opendota.com) og [dotaconstants](https://github.com/odota/dotaconstants). Dota 2 er et varemerke for Valve Corporation. Dette prosjektet er ikke tilknyttet Valve.
