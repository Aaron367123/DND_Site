// ============================================================
// MONSTER ATTACKS — a stat block's attacks, parsed once
// ============================================================
// What is left of the Attack Runner: it was a panel of its own until Turn
// View took over everything it did ("Act as…" covers rolling for someone
// off their turn). Turn View still reads stat blocks through these two, and
// the window manager sends anything that opens 'attacks' to Turn View
// (SKT_PANEL_HOST in data.js), so the panel id stays registered, with no
// window to mount.

registerPanel('attacks', {
  title: 'Monster attacks', icon: '🎯',

  // Parsing a stat block is not free, and Turn View asks on every render.
  // The result depends only on the _raw object, which is shared and
  // immutable, so memoise against it — a WeakMap so unloading the bestiary
  // doesn't leak the entries.
  _parseCache: new WeakMap(),
  _parsed(raw){
    let v = this._parseCache.get(raw);
    if (!v){
      v = { attacks: sktParseMonsterAttacks(raw),
            magical: sktMonsterAttacksAreMagical(raw),
            multi:   sktParseMultiattack(raw) };
      this._parseCache.set(raw, v);
    }
    return v;
  },

  // Expand a monster's Multiattack into one entry per swing, in stat-block
  // order: a dragon's "one with its bite and two with its claws" becomes
  // [Bite, Claw, Claw]. Only attacks the wording actually named are included —
  // same confidence rule as the ×N chips — and save-based effects are left out
  // for the same reason they get no chip.
  _plan(r){
    if (!r || !r.multi) return [];
    const out = [];
    r.attacks.forEach((a, ai) => {
      if (a.save) return;
      const n = sktMultiattackCountFor(r.multi.counts, a.name);
      for (let k = 0; k < n; k++) out.push({ ai, name: a.name });
    });
    return out;
  },
});
