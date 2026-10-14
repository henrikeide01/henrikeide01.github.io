# src/vision – reading the hero portraits from the screen

Game State Integration does not tell us which heroes the enemies picked. `detect.js` finds the hero portraits in
the Dota 2 top bar of a screenshot (5 Radiant portraits left of the clock, 5 Dire right of it; during the draft a
similar row of picked heroes) by template matching against the official landscape hero images (256x144).
`picks.js` (separate) turns single detections into confirmed picks over several scans.

Pure functions, Node built-ins only. Images are `{ width, height, data, format }` with 4 bytes per pixel and
`format` `'rgba'` or `'bgra'` (Electron's `nativeImage.toBitmap()` is BGRA on Windows).

```js
import { prepareTemplates, detectTopBar, learnLayout } from './detect.js';
const templates = prepareTemplates(heroes); // [{ name, image }], once (~150-250 ms for 130 heroes)
const result = detectTopBar(screen, templates); // full search
// { heroes: [{ name, score, margin, x, y, w, h, side: 'left'|'right', slot: 0..4 }], scale, ms, searched, width, height }
const layout = learnLayout(result); // null unless >= 8 heroes in one evenly spaced row
const next = detectTopBar(screen2, templates, { layout }); // only the 10 slots; also next.missing: [{ side, slot }]
```

## How it works

All matching is normalised cross-correlation (NCC) of the central 90% (`opts.crop`) of each hero image, so
brightness/contrast changes and a slightly different crop do not matter.

1. **Coarse** (12x7 grey): the top band (`bandBottom` = 10% of the height, `xFrom`..`xTo` = 15%..85% of the
   width) is shrunk once per portrait size in `scales` (heights 2.4%..6% of the screen, ~20% apart) and every
   window is compared with every hero. Local maxima (per hero) are ranked by grey + colour NCC times a contrast prior.
2. **Medium** (16x9 grey): the best `maxRefine` (150, a share for every size) get a hill-climbing refinement of
   position and size.
3. **Fine** (32x18 grey + colour): the best `maxCandidates` (40) are refined again and classified against every
   hero. Score = (grey NCC + colour NCC) / 2, scaled down when the window has less than half the hero image's
   contrast (a dim patch of game world that happens to have the right shapes).
4. **Row and grid**: the 10 portraits are one row of 5 + 5 evenly spaced slots mirrored around the screen centre.
   When 3+ candidates scoring `rowScore` agree on such a grid, only candidates on it count, and every empty slot is
   classified directly with an overlay-tolerant score (robust NCC: iteratively reweighted, ignores the respawn
   timer on a dead hero's grey portrait). Portraits do not overlap, each hero appears once, at most 5 per side.
   Without such a row, a portrait needs `loneScore`.
5. **Layout**: `learnLayout()` fits the 10 slot rectangles; with `opts.layout` only those are classified (a few
   pixels of jitter search). A layout is only used for the resolution it was learned on; if no slot has a hero
   (stale layout) a full search runs instead (`fallback`).

`opts.debug` adds `result.debug` (candidate counts, ms per stage, grid, the 20 best candidates) for tuning.

## Thresholds (scores are 0..1)

| option | default | meaning |
| --- | --- | --- |
| `minScore` | 0.70 | a portrait on an established row |
| `rowScore` | 0.82 | 3 of these on one evenly spaced row establish the row; also needed in slots beyond the found ones |
| `loneScore` | 0.88 | a portrait without a row (empty bar, first picks) |

Chosen from synthetic score distributions: live portraits score 0.90-1.00 (5th percentile ~0.98), dead
portraits (grey, 55% brightness, respawn timer) 0.73-0.88 via the robust score, the best wrong match in the
textured background ~0.82 (>= 0.8 in under 1% of candidates). Real screenshots will shift all of these: tune with
`debug` output from saved screenshots before changing code.

## Speed (Node 22, one thread, synthetic screens)

Full search 0.4-0.75 s for 1280x720 up to 3440x1440 (coarse pass ~60%). Layout path 25-50 ms.

## Known weaknesses (all tuned on synthetic data only)

- **Real art and rendering**: the in-game portraits may be cropped, tinted, vignetted or shaded differently from the
  official images. If true portraits score < 0.82 no row is found; lower `rowScore`/`minScore`/`loneScore`, adjust
  `crop`, or pass `aspect` if the portrait shape differs from 16:9. Candidates are ranked with colour too, so a
  strong tint or desaturation of all portraits pushes them down the list (raise `maxRefine` if that happens).
- **Dead heroes** are recognised from grey structure only. Heroes whose art differs mostly in colour (low luma
  contrast) can be missed or confused while dead. `picks.js` keeps heroes confirmed earlier.
- **Slot numbers in a partly filled draft**: if the slot next to the clock is empty on both sides, the grid cannot
  tell where the row starts and slot numbers may be off by one (names and sides are still right).
- **Look-alikes**: very similar heroes get a small `margin` (score minus the next best hero); check it before
  trusting a pick.
- Portraits outside `xFrom..xTo` or taller than ~6.6% of the screen are not searched (the grid fill-in can still
  reach slots outside the x range once 3 portraits are found).
- A layout learned in game is wrong for the draft screen; the full search fallback only runs when no slot matches.
