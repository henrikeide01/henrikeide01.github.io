# Dota Coach

Dota Coach er en live-coach for Dota 2 som kjører på din egen PC:

- **Draft-hjelp:** legg inn fiendene (og laget ditt), så får du forslag til hero for din posisjon og rank. Forslagene bygger på meta (vinnerrate) og counters (matchups), med en forklaring som «Sterk mot Axe +6 %».
- **Meta og builds:** tier-liste per posisjon og rank, og populære builds (start, tidlig, mid, sent) for hver hero.
- **Live-coaching i kampen** (via Valves offisielle *Game State Integration*):
  - Neste item du bør kjøpe, hvor mye gull du mangler, og varsel når du har råd.
  - Items mot akkurat dette fiendelaget (BKB mot mye magi, MKB mot evasion, sentry og dust mot usynlige osv.).
  - Varsler som *lav HP*, *ingen TP*, *items i stashen*, *ubrukte skill-poeng*, *mye upålitelig gull*, *dypt på fiendens side*, *ikke råd til buyback* og *mange dødsfall*.
  - Timere for bounty, power, wisdom, lotus, stack (:53), neutral-tiers, Tormentor og Roshan (respawn-vindu etter at han dør), og dag/natt.
  - «Fokus nå» og «hvor du bør farme», tilpasset rolle og fase (laning, mid, late).
  - GPM, XPM og LH sammenlignet med andre spillere på samme hero (persentiler).
  - Opplesning av de viktigste tipsene (tale), så du slipper å se bort fra spillet.
- **Overlay:** et gjennomsiktig vindu oppå spillet, et lite vindu som alltid ligger øverst, eller mobilen som skjerm nr. 2.

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
5. **Dobbeltklikk `start.bat`.** Coachen åpner seg i nettleseren (<http://localhost:3355>).
6. **Start Dota 2.** Statusen øverst blir grønn når data kommer inn.

> Vil du se hvordan det ser ut uten å starte Dota? Dobbeltklikk **`demo.bat`**. Da spilles en simulert kamp med Anti-Mage.

### Overlay oppå spillet

Sett Dota 2 til **Innstillinger → Video → Visningsmodus: Borderless Window** (vanlig fullskjerm dekker alle andre vinduer).

| Alternativ | Slik gjør du |
|---|---|
| **Ekte overlay** (gjennomsiktig, klikk går gjennom til spillet) | Dobbeltklikk `start-overlay.bat`. Første gang laster den ned overlay-komponenten (~100 MB). |
| **Lite vindu som alltid ligger øverst** | Trykk «⧉ Overlay-vindu» øverst i dashboardet (Chrome/Edge). |
| **Mobil eller nettbrett** | Kjør `start.bat --lan` og åpne adressen den skriver ut, på samme Wi-Fi. |

Hurtigtaster for den ekte overlayen:

| Tast | Funksjon |
|---|---|
| <kbd>Alt+Shift+C</kbd> | Vis eller skjul overlay |
| <kbd>Alt+Shift+M</kbd> | Flyttemodus: dra overlayet, og trykk igjen for å låse |
| <kbd>Alt+Shift+S</kbd> | Tale av og på |

### Tale

Tipsene leses opp med Windows-stemmen. For norsk uttale: *Innstillinger → Tid og språk → Tale → Legg til stemmer → Norsk (bokmål)*. Velg stemme og hastighet under *Oppsett* i dashboardet. I nettleseren må du klikke én gang på siden før den får lov til å snakke.

---

## Slik bruker du den i en kamp

1. **Velg rolle (Pos 1–5) og rank** øverst. Det styrer forslag, timere og tips.
2. **Under hero-valget:** åpne *Draft-hjelp*, velg raden «Fiender» og klikk på heroene de velger (du kan også søke og trykke Enter). Til høyre får du:
   - de beste heroene for deg, med forklaring,
   - heroer du bør unngå mot dette laget,
   - items mot fiendelaget og korte tips mot enkelte fiendeheroer.
3. **I kampen:** ha overlayet oppe og følg tipsene. Rødt er akutt, oransje er viktig, grønt er positivt (for eksempel «du har råd») og blått er info og timing.

## Fair play

Coachen bruker bare **Valves offisielle Game State Integration** (den samme som brukes av blant annet strømmeverktøy). Den:

- ser bare det du selv ser: din hero, gull, items, klokke og posisjon,
- leser **ikke** minnet til spillet og endrer ingenting i Dota,
- viser **ingen** info om motspillerne som profiler, MMR eller historikk (det har Valve forbudt i overlays).

Builds og tips tilsvarer det du finner i Dotas egne guider og på nettsider.

## Feilsøking

| Problem | Løsning |
|---|---|
| Statusen blir aldri grønn | Sjekk at `-gamestateintegration` står i startalternativene, og start Dota på nytt. Kjør `setup.bat` på nytt, og hvis den ikke finner Dota: `setup.bat --path "D:\SteamLibrary\steamapps\common\dota 2 beta"`. |
| «Porten er allerede i bruk» | Coachen kjører allerede i et annet vindu. Lukk det, eller bruk det som er åpent. |
| Ingen builds eller meta | Coachen trenger internett for å hente fra OpenDota (deretter lagres dataene i `cache/`). |
| Overlayet vises ikke over spillet | Dota må stå i *Borderless Window*, ikke vanlig fullskjerm. |
| Ingen tale | Klikk én gang på siden, og sjekk at «Tale på» er aktivert. Velg en stemme under *Oppsett*. |

## Tilpass selv

All spillkunnskap ligger som vanlig tekst i `data/`:

- `data/knowledge.js`: timinger (rune, neutral-tiers, Tormentor, Roshan), «fokus»-tekster per rolle og fase, counter-items og tips mot enkelte heroer.
- `data/positions.js`: hvilke posisjoner hver hero spilles i.
- `src/coach/rules.js`: alle live-varslene. Hver regel er en liten funksjon som er enkel å endre eller kopiere.

Kommer det en ny patch, sjekk timingene i `data/knowledge.js`. Hero- og item-lister oppdateres med `npm i --no-save dotaconstants && npm run build-data`.

## For utviklere

```
npm test              # tester (node:test, ingen avhengigheter)
npm run server        # bare serveren
npm run simulate      # send en simulert kamp til en kjørende server (--speed 15 --hero juggernaut --start 600)
npm run overlay       # Electron-overlay (starter serveren selv)
```

Serveren (`src/server.js`) har ingen avhengigheter utover Node. Den tar imot GSI på `POST /gsi`, regner ut coach-tilstanden (`src/coach/`) og sender den til dashboardet og overlayet med Server-Sent Events (`/api/stream`). OpenDota-svar lagres i `cache/` (6–24 timer), slik at appen holder seg godt under rate-limiten.

Data: [OpenDota API](https://docs.opendota.com) og [dotaconstants](https://github.com/odota/dotaconstants). Dota 2 er et varemerke for Valve Corporation. Dette prosjektet er ikke tilknyttet Valve.
