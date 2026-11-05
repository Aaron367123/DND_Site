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
    // "Three attacks, using Greataxe or Javelin in any combination": that many
    // swings of the first, each one switchable to the others (`choice`).
    const co = r.multi.combo;
    if (co && co.forms) out.length = 0;   // one form's attacks or another's, not both
    if (!out.length && co && co.n){
      const one = nm => { const m = {}; m[nm] = 1; return m; };
      const find = nm => r.attacks.findIndex(a => !a.save && sktMultiattackCountFor(one(nm), a.name));
      let choice = co.any ? r.attacks.map((a, ai) => a.save ? -1 : ai).filter(ai => ai >= 0) : co.names.map(find).filter(ai => ai >= 0);
      (co.extra || []).map(find).forEach(ai => { if (ai >= 0 && !choice.includes(ai)) choice.push(ai); });
      // All the named ones must be real attacks, or the plan would do less than the sentence says.
      if (choice.length && (co.any || co.names.every(nm => find(nm) >= 0))){
        const notDef = co.notDefault ? find(co.notDefault) : -1;
        const def = choice.find(ai => ai !== notDef) ?? choice[0];
        for (let k = 0; k < co.n; k++) out.push({ ai: def, name: r.attacks[def].name, choice: choice.slice() });
      }
    }
    return out;
  },
});
