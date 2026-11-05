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
  // `ctx`: what the stat block can't say — { summonLevel } for a spirit's
  // "half this spell's level", { count } for a hydra's heads.
  _plan(r, ctx){
    if (!r || !r.multi) return [];
    ctx = ctx || {};
    const soft = new Set(r.multi.soft || []);
    // (spacing aside: "Short bow" is the Shortbow; "hooves" is the Hoof)
    const norm = s => String(s).replace(/\s*\([^)]*\)/g, '').replace(/^[+-]\d+\s+|\s+[+-]\d+$/g, '').replace(/\s+/g, '').toLowerCase().replace(/ves$/, 'f');
    const exact = (k, nm) => { const n = norm(nm), kk = norm(k); return n === kk || n + 's' === kk || n.replace(/s$/, '') === kk || kk.replace(/s$/, '') === n; };
    const textLc = String(r.multi.text || '').toLowerCase();
    const named = ai => textLc.includes(String(r.attacks[ai].name).replace(/\s*\([^)]*\)/g, '').replace(/^[+-]\d+\s+/, '').trim().toLowerCase().replace(/s$/, ''));
    // Each count goes to one attack: an exact name first ("Bite"), then a
    // whole word in a longer name ("Ruidium Harpoon") from what is left, so a
    // "bite" count is not also taken by a "Poison Bite". A save-based action
    // named in the sentence ("uses Eye Rays three times", "two Lightning
    // Turret attacks") is a step too: its target's save is rolled (`save`).
    const fromCounts = counts0 => {
      const counts = Object.assign({}, counts0 || {});
      const per = r.attacks.map(() => 0), pick = r.attacks.map(() => null), wasSoft = r.attacks.map(() => false);
      r.attacks.forEach((a, ai) => {
        const k = Object.keys(counts).find(k => exact(k, a.name));
        if (k){ per[ai] = counts[k]; wasSoft[ai] = soft.has(k); delete counts[k]; }
      });
      r.attacks.forEach((a, ai) => {
        if (per[ai]) return;
        const k = Object.keys(counts).find(k => sktMultiattackCountFor({ [k]: 1 }, a.name));
        if (k){ per[ai] = counts[k]; wasSoft[ai] = soft.has(k); delete counts[k]; }
      });
      // A weapon the sentence names that the stat block calls something else
      // ("two longsword attacks", the block's weapon a Warhammer; a sky
      // whale's "bite" for its Flipper; "Lightning Ray" for a Fire Ray that
      // deals lightning): an attack left unclaimed that the sentence doesn't
      // name otherwise — a melee one first; several, and the swing is a
      // choice between them (Xenk's daggersword, in its two forms).
      Object.keys(counts).filter(k => !soft.has(k) || /ray|bolt|blast/.test(k)).sort((a, b) => counts[b] - counts[a]).forEach(k => {
        const freeAll = r.attacks.map((a, ai) => ai).filter(ai => !per[ai] && !r.attacks[ai].save && !named(ai) && !/spell|cantrip/i.test(r.attacks[ai].name));
        const melee = freeAll.filter(ai => !r.attacks[ai].ranged);
        const free = melee.length ? melee : freeAll;
        if (free.length){ per[free[0]] = counts[k]; if (free.length > 1) pick[free[0]] = free.slice(); delete counts[k]; }
      });
      // A name the sentence counts that no attack has, as big as what did
      // match: the plan would do less than the sentence says, so none.
      const left = Math.max(0, ...Object.keys(counts).filter(k => !soft.has(k)).map(k => counts[k])), got = Math.max(0, ...per);
      const list = [];
      if (!(left && left >= got)) r.attacks.forEach((a, ai) => { for (let k = 0; k < per[ai]; k++) list.push(Object.assign({ ai, name: a.name }, a.save ? { save: true } : {}, pick[ai] ? { choice: pick[ai] } : {}, wasSoft[ai] ? { soft: true } : {})); });
      return list;
    };
    let out = fromCounts(r.multi.counts);
    // The first alternative names nothing rollable — and isn't "any of its
    // attacks" either (that's the combo below): the next one that does.
    const firstIsAny = r.multi.combo && (r.multi.combo.any || (r.multi.combo.names || []).length);
    for (const ac of (out.length || firstIsAny ? [] : (r.multi.altCounts || []))){ out = fromCounts(ac); if (out.length) break; }
    // "Three attacks, using Greataxe or Javelin in any combination": that many
    // swings of the first, each one switchable to the others (`choice`).
    const co = r.multi.combo;
    const combo = [];
    const n = !co ? 0 : co.perSpell ? Math.floor((+ctx.summonLevel || 0) / 2) : co.ask ? (+ctx.count || co.dflt || 0) : co.n;
    if (co && n){
      const find = nm => r.attacks.findIndex(a => !a.save && sktMultiattackCountFor({ [nm]: 1 }, a.name));
      let choice = co.any ? r.attacks.map((a, ai) => a.save ? -1 : ai).filter(ai => ai >= 0) : co.names.map(find).filter(ai => ai >= 0);
      (co.extra || []).map(find).forEach(ai => { if (ai >= 0 && !choice.includes(ai)) choice.push(ai); });
      // At least one named attack is rollable ("Deathly Claw or Grave Bolt"
      // where only Grave Bolt parses): the swings are still that many.
      if (choice.length){
        const notDef = co.notDefault ? find(co.notDefault) : -1;
        const def = choice.find(ai => ai !== notDef) ?? choice[0];
        for (let k = 0; k < n; k++) combo.push({ ai: def, name: r.attacks[def].name, choice: choice.slice() });
      }
    }
    // One form's attacks or another's, not both; and a named choice ("two
    // attacks with its greataxe or its spear") over the count of its first.
    // An ability it "uses", in the sentence's order: "uses Fearful Gaze, then
    // makes four attacks" — the gaze first; "makes two attacks … and uses
    // Animal Spirit" — after.
    const inOrder = (fixed, choice) => {
      const at = x => textLc.indexOf(String(x.name).replace(/\s*\([^)]*\)/g, '').toLowerCase());
      const atk = textLc.search(/\battacks?\b/);
      const before = fixed.filter(x => x.soft && at(x) >= 0 && at(x) < atk), after = fixed.filter(x => x.soft && !before.includes(x));
      return before.concat(fixed.filter(x => !x.soft), choice, after);
    };
    if (co && co.plus) return combo.length ? inOrder(out, combo) : [];   // the fixed ones, then the choice
    if (combo.length && out.length && out.every(x => x.soft)) return inOrder(out, combo);
    if (combo.length && (co.forms || (!co.any && co.names.length > 1))) return combo;
    return out.length ? out : combo;
  },
});
