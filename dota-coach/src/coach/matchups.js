// Hero-vs-hero results from public ranked matches (OpenDota public_matches), per rank bracket: the numbers
// sites like Dotabuff show as "counters". A snapshot ships in data/matchups.json; the server can refresh single
// heroes from the OpenDota SQL explorer (`publicMatchupSql`) and lay them over the snapshot.
//
// The advantage of hero A against hero B is how much more often A wins against B than you would expect from
// how strong A and B are in general (their overall win rates in that bracket), in percentage points. So a hero
// that is simply strong right now does not look like a counter to everyone.

const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clampP = (p) => Math.min(0.97, Math.max(0.03, p));

// The expected win rate of a hero with overall win rate `a` against one with `b` (both 0..1).
export const expectedWinrate = (a, b) => sigmoid(logit(clampP(a)) - logit(clampP(b)));

// Below this many games in your bracket, the neighbouring brackets are added (similar players, more data).
const MIN_GAMES = 300;
// Shrinks small samples towards "no advantage" (k games worth of 0).
const SHRINK = 300;

// raw: the data/matchups.json object. Returns an index:
// { ids: [heroId…], pos: Map heroId -> i, brackets: Map b -> { t: [[g, w]…], g: Int32Array(N*N), w: Int32Array(N*N) },
//   info: { from, to, matches, source } }
// g[i*N+j] = games hero i played against hero j, w[i*N+j] = hero i's wins in them.
export function buildMatchupIndex(raw) {
  if (!raw?.heroes?.length || !raw.brackets) return null;
  const ids = raw.heroes.map(Number);
  const N = ids.length;
  const pos = new Map(ids.map((id, i) => [id, i]));
  const brackets = new Map();
  for (const [b, d] of Object.entries(raw.brackets)) {
    if (!Array.isArray(d.g) || d.g.length !== N * N || !Array.isArray(d.w) || d.w.length !== N * N) continue;
    brackets.set(Number(b), { t: d.t, g: Int32Array.from(d.g), w: Int32Array.from(d.w), matches: d.matches || 0 });
  }
  return { ids, pos, N, brackets, info: { from: raw.from, to: raw.to, matches: raw.matches, source: raw.source, patch: raw.patch } };
}

// Explorer rows for one hero ([bracket, opponentId, games, wins], opponent 0 = the hero's own totals), laid over
// the index: the hero's row and column change, everything else stays. Returns a new index (the old one is kept).
export function overlayHero(index, heroId, rows) {
  if (!index || !index.pos.has(Number(heroId)) || !Array.isArray(rows) || !rows.length) return index;
  const i = index.pos.get(Number(heroId));
  const N = index.N;
  const brackets = new Map();
  for (const [b, d] of index.brackets) brackets.set(b, { t: d.t.map((x) => [...x]), g: Int32Array.from(d.g), w: Int32Array.from(d.w), matches: d.matches });
  const touched = new Set();
  for (const r of rows) {
    const [b, opp, games, wins] = r.map(Number);
    let d = brackets.get(b);
    if (!d) continue;
    if (!touched.has(b)) {
      // Fresh numbers replace the old ones for this hero in this bracket.
      for (let j = 0; j < N; j++) {
        d.g[i * N + j] = 0;
        d.w[i * N + j] = 0;
        d.g[j * N + i] = 0;
        d.w[j * N + i] = 0;
      }
      touched.add(b);
    }
    if (opp === 0) {
      d.t[i] = [games, wins];
      continue;
    }
    const j = index.pos.get(opp);
    if (j === undefined || j === i) continue;
    d.g[i * N + j] = games;
    d.w[i * N + j] = wins;
    d.g[j * N + i] = games;
    d.w[j * N + i] = games - wins;
  }
  return { ...index, brackets };
}

// Overall games and win rate of a hero in a bracket (with neighbours when there are few games).
export function heroTotals(index, heroId, bracket) {
  const i = index?.pos.get(Number(heroId));
  if (i === undefined) return null;
  let g = 0;
  let w = 0;
  for (const b of bracketsAround(index, bracket)) {
    const t = index.brackets.get(b)?.t?.[i];
    if (!t) continue;
    g += t[0];
    w += t[1];
    if (b === Number(bracket) && g >= MIN_GAMES * 10) break;
  }
  return g ? { games: g, wins: w, wr: w / g } : null;
}

// The bracket itself first, then its neighbours (used only while the sample is small).
function bracketsAround(index, bracket) {
  const b = Number(bracket) || 5;
  return [b, b - 1, b + 1, b - 2, b + 2].filter((x) => index.brackets.has(x));
}

// How hero `a` does against hero `b` in a bracket: { games, wins, wr, expected, adv, brackets }.
export function pairStats(index, a, b, bracket) {
  const i = index?.pos.get(Number(a));
  const j = index?.pos.get(Number(b));
  if (i === undefined || j === undefined || i === j) return null;
  let g = 0;
  let w = 0;
  const used = [];
  for (const br of bracketsAround(index, bracket)) {
    const d = index.brackets.get(br);
    const k = i * index.N + j;
    if (!d.g[k]) continue;
    g += d.g[k];
    w += d.w[k];
    used.push(br);
    if (g >= MIN_GAMES) break;
  }
  if (!g) return null;
  const ta = heroTotals(index, a, bracket);
  const tb = heroTotals(index, b, bracket);
  const wr = w / g;
  const expected = ta && tb ? expectedWinrate(ta.wr, tb.wr) : 0.5;
  const adv = (wr - expected) * 100 * (g / (g + SHRINK));
  return { games: g, wins: w, wr, expected, adv, brackets: used };
}

// The heroes `heroId` does best and worst against in a bracket, by advantage (min. games to count).
export function bestAndWorst(index, heroId, bracket, { limit = 6, minGames = 200 } = {}) {
  const rows = [];
  for (const id of index?.ids || []) {
    if (id === Number(heroId)) continue;
    const s = pairStats(index, heroId, id, bracket);
    if (s && s.games >= minGames) rows.push({ id, ...s });
  }
  rows.sort((x, y) => y.adv - x.adv);
  return { best: rows.slice(0, limit), worst: rows.slice(-limit).reverse() };
}

// SQL for the OpenDota explorer: one hero's results against every other hero, per bracket, in ranked public
// matches of about the last week (9 million match ids). Opponent 0 = the hero's own totals. `maxId` fixes the
// newest match (so a snapshot of all heroes covers the same matches); by default it is the newest there is.
export function publicMatchupSql(heroId, span = 9000000, maxId = null) {
  const id = Number(heroId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('ugyldig hero-id');
  const top = maxId != null && /^\d+$/.test(String(maxId)) ? String(maxId) : null;
  return `WITH r AS (SELECT ${top ? `${top}::bigint` : 'max(match_id)'} AS mx FROM public_matches${top ? ' LIMIT 1' : ''}), m AS (SELECT floor(avg_rank_tier/10)::int AS b, (radiant_win = (${id} = ANY(radiant_team))) AS win, CASE WHEN ${id} = ANY(radiant_team) THEN dire_team ELSE radiant_team END AS opp FROM public_matches, r WHERE match_id > r.mx - ${Number(span)} AND match_id <= r.mx AND (${id} = ANY(radiant_team) OR ${id} = ANY(dire_team)) AND avg_rank_tier IS NOT NULL AND lobby_type = 7) SELECT b, o AS hero_id, count(*) AS games, sum(win::int) AS wins FROM m, unnest(opp) o WHERE o > 0 GROUP BY b, o UNION ALL SELECT b, 0 AS hero_id, count(*) AS games, sum(win::int) AS wins FROM m GROUP BY b`;
}
