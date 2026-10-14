// Turns single screen detections into the picks of a match. A hero counts once it was seen on the same side in
// `needed` scans in a row; once confirmed it stays for the rest of the match (portraits of dead heroes are grey and
// can be missed, and a picked hero never leaves the draft). At most 5 per side: the best scores win.
export class PickTracker {
  constructor({ needed = 2 } = {}) {
    this.needed = needed;
    this.reset();
  }

  reset() {
    this.streak = new Map(); // name -> { side, n, score }
    this.confirmed = new Map(); // name -> { side, score }
    this.sent = '';
  }

  // result: detectTopBar() output. Returns { left, right, changed }.
  add(result) {
    const seen = new Set();
    for (const h of result?.heroes || []) {
      if (!h?.name || (h.side !== 'left' && h.side !== 'right')) continue;
      seen.add(h.name);
      const s = this.streak.get(h.name);
      const n = s && s.side === h.side ? s.n + 1 : 1;
      this.streak.set(h.name, { side: h.side, n, score: h.score });
      if (n >= this.needed) this.confirmed.set(h.name, { side: h.side, score: Math.max(h.score || 0, this.confirmed.get(h.name)?.score || 0) });
    }
    for (const name of this.streak.keys()) if (!seen.has(name)) this.streak.delete(name);
    const side = (s) =>
      [...this.confirmed]
        .filter(([, c]) => c.side === s)
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 5)
        .map(([name]) => name)
        .sort();
    const left = side('left');
    const right = side('right');
    const key = `${left.join(',')}|${right.join(',')}`;
    const changed = key !== this.sent;
    this.sent = key;
    return { left, right, changed };
  }
}
