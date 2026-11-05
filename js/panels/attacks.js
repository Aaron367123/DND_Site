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
    // Each count goes to one attack: an exact name first ("Bite"), then a
    // whole word in a longer name ("Ruidium Harpoon") from what is left, so a
    // "bite" count is not also taken by a "Poison Bite".
    const counts = Object.assign({}, r.multi.counts || {});
    const per = r.attacks.map(() => 0);
    // (spacing aside: "Short bow" is the Shortbow)
    const exact = (k, nm) => { const n = String(nm).replace(/\s*\([^)]*\)/g, '').replace(/^[+-]\d+\s+|\s+[+-]\d+$/g, '').replace(/\s+/g, '').toLowerCase(), kk = k.replace(/\s+/g, ''); return n === kk || n + 's' === kk || n.replace(/s$/, '') === kk; };
    r.attacks.forEach((a, ai) => {
      if (a.save) return;
      const k = Object.keys(counts).find(k => exact(k, a.name));
      if (k){ per[ai] = counts[k]; delete counts[k]; }
    });
    r.attacks.forEach((a, ai) => {
      if (a.save || per[ai]) return;
      const k = Object.keys(counts).find(k => sktMultiattackCountFor({ [k]: 1 }, a.name));
      if (k){ per[ai] = counts[k]; delete counts[k]; }
    });
    // A name the sentence counts that no attack has ("two longsword attacks"
    // on a stat block whose weapon is a warhammer), as big as what did match:
    // the plan would do less than the sentence says, so none.
    const soft = new Set(r.multi.soft || []);
    const left = Math.max(0, ...Object.keys(counts).filter(k => !soft.has(k)).map(k => counts[k])), got = Math.max(0, ...per);
    if (!(left && left >= got)) r.attacks.forEach((a, ai) => { for (let k = 0; k < per[ai]; k++) out.push({ ai, name: a.name }); });
    // "Three attacks, using Greataxe or Javelin in any combination": that many
    // swings of the first, each one switchable to the others (`choice`).
    const co = r.multi.combo;
    const combo = [];
    if (co && co.n){
      const find = nm => r.attacks.findIndex(a => !a.save && sktMultiattackCountFor({ [nm]: 1 }, a.name));
      let choice = co.any ? r.attacks.map((a, ai) => a.save ? -1 : ai).filter(ai => ai >= 0) : co.names.map(find).filter(ai => ai >= 0);
      (co.extra || []).map(find).forEach(ai => { if (ai >= 0 && !choice.includes(ai)) choice.push(ai); });
      // At least one named attack is rollable ("Deathly Claw or Grave Bolt"
      // where only Grave Bolt parses): the swings are still that many.
      if (choice.length){
        const notDef = co.notDefault ? find(co.notDefault) : -1;
        const def = choice.find(ai => ai !== notDef) ?? choice[0];
        for (let k = 0; k < co.n; k++) combo.push({ ai: def, name: r.attacks[def].name, choice: choice.slice() });
      }
    }
    // One form's attacks or another's, not both; and a named choice ("two
    // attacks with its greataxe or its spear") over the count of its first.
    if (combo.length && (co.forms || (!co.any && co.names.length > 1))) return combo;
    return out.length ? out : combo;
  },
});
