// ============================================================
// ATTACK RUNNER — roll a monster's attack straight onto a target
// ============================================================
// The job this panel exists to remove: read the stat block, work out the
// damage type, click the damage-type chip in the combat tracker, type a
// number, find the right card, click minus. Four or five interactions per
// attack, every attack, all fight.
//
// Here it is two: pick AVG or ROLL on the attack, pick who it hit. The damage
// type comes from the stat block, so resistances and immunities apply without
// anyone selecting anything — which is also the point where the old flow
// quietly went wrong, because a DM in a hurry leaves the type on whatever it
// was last time.
//
// Multi-type attacks are applied as SEPARATE typed hits. A red dragon's bite
// is 2d10+8 piercing *plus* 2d6 fire; a target resistant to fire must halve
// only the fire. Rolling it into one number would be wrong in a way nobody
// would notice at the table.

registerPanel('attacks', {
  title: 'Attack Runner', icon: '🎯',

  _open: {},        // combatant id → expanded?
  _sig: null,       // last-rendered combat-tracker signature; see _syncFromCombat
  _applying: false, // guards the re-entrant save() during _apply
  _lastTargetId: null,
  _pending: null,   // { srcId, atk, amount:[{amt,type}], label }
  // An in-flight multiattack: one entry per swing, each picking its own target.
  // { srcId, mode, items:[{ai,name}], i, hits, misses }
  _queue: null,
  _log: [],

  mount(body){
    this._body = body;
    this._render();
    // The list is driven entirely by the combat tracker, so it has to redraw
    // when that changes. Cheap: this panel is small and only renders on open.
    if (typeof on5eLoaded === 'function' && !(typeof _5eLoaded !== 'undefined' && _5eLoaded)){
      on5eLoaded(() => { if (this._body) this._render(); });
    }
    if (typeof load5eData === 'function') load5eData();
  },
  unmount(){ this._body = null; },

  menuItems(){
    return [
      { label: '↻ Refresh from combat tracker', run: () => this._render() },
      { label: '🧹 Clear damage log', run: () => { this._log = []; this._render(); } },
    ];
  },

  // ─── Dice ─────────────────────────────────────────────────────────────────
  // "2d10+8" / "1d4-1" / "18d6". Returns {total, detail} so the log can show
  // the individual dice — a DM reading "19" wants to know it was 7+4+8.
  _roll(dice){
    const m = String(dice||'').replace(/\s+/g,'').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
    if (!m) return { total: 0, detail: '—' };
    const n = parseInt(m[1] || '1'), sides = parseInt(m[2]), mod = parseInt(m[3] || '0');
    const rolls = [];
    for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(Math.random() * sides));
    const sum = rolls.reduce((a,b)=>a+b, 0);
    // Damage never goes below 0 even if a modifier drags it negative.
    return { total: Math.max(0, sum + mod),
             detail: rolls.join('+') + (mod ? (mod > 0 ? '+' + mod : String(mod)) : '') };
  },

  // ─── Data ─────────────────────────────────────────────────────────────────
  // NPC combatants that have a resolvable stat block, with their attacks.
  // Parsing a stat block is not free, and now that _syncFromCombat fires on
  // every HP tick this runs constantly. The result depends only on the _raw
  // object, which is shared and immutable, so memoise against it — a WeakMap
  // so unloading the bestiary doesn't leak the entries.
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
  _rows(){
    const C = panelDefs.combat;
    if (!C || typeof C.statBlockFor !== 'function') return [];
    return (state.combatants || [])
      .filter(c => !c.isPC)
      .map((c, i) => {
        const entry = C.statBlockFor(c);
        const raw = entry && entry._raw;
        const p = raw ? this._parsed(raw) : null;
        return {
          c, idx: state.combatants.indexOf(c),
          entry,
          attacks: p ? p.attacks : [],
          magical: p ? p.magical : false,
          multi:   p ? p.multi   : null,
        };
      });
  },

  // Everything about the combat tracker that this panel actually shows. Only
  // these fields; a change to initiative order or a condition doesn't move
  // anything here and shouldn't cost a redraw.
  _combatSig(){
    return (state.combatants || [])
      .map(c => [c.id, c.name, c.hp, c.hpMax, c.isPC ? 1 : 0, c._slug || '', c._source || ''].join('~'))
      .join('|');
  },
  // Called from save(), i.e. after every change anywhere in the app. Cheap by
  // design: build the signature, compare, and do nothing the vast majority of
  // the time. Without this the panel showed whatever the tracker held when it
  // was opened, so adding a monster mid-fight left it invisible here until you
  // reopened the panel.
  _syncFromCombat(){
    if (!this._body) return;
    // _apply calls into the combat tracker, which saves, which lands back
    // here — mid-way through, with _pending already spent. Let _apply finish
    // and render once itself.
    if (this._applying) return;
    const sig = this._combatSig();
    if (sig === this._sig) return;
    this._render();
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

  _targets(){
    return (state.combatants || []).map((c) => ({ c, idx: state.combatants.indexOf(c) }));
  },

  // ─── Render ───────────────────────────────────────────────────────────────
  _render(){
    const b = this._body; if (!b) return;
    this._sig = this._combatSig();
    const ready = (typeof _5eLoaded !== 'undefined') && _5eLoaded;
    const rows = ready ? this._rows() : [];

    let inner;
    if (!ready){
      inner = `<div class="atk-empty">Loading the 5e bestiary…</div>`;
    } else if (!rows.length){
      inner = `<div class="atk-empty">
        <div style="font-size:30px;margin-bottom:8px">🎯</div>
        <div>No monsters in the combat tracker.</div>
        <div class="atk-empty-sub">Add some in ⚔ Combat and their attacks show up here.</div>
      </div>`;
    } else {
      inner = rows.map(r => this._renderMonster(r)).join('');
    }

    b.innerHTML = `<div class="atk-root">
      ${this._pending ? this._renderTargetBar() : ''}
      <div class="atk-list">${inner}</div>
      ${this._renderLog()}
    </div>`;
    this._wire();
  },

  _renderMonster(r){
    const c = r.c;
    const open = this._open[c.id] !== false;   // expanded by default
    const hp = `${c.hp ?? '?'}/${c.hpMax ?? '?'}`;
    const dead = (c.hp || 0) <= 0;
    // Multiattack is the instruction for the whole turn, so it sits above the
    // individual attacks rather than among them. Shown VERBATIM: the ×N chips
    // below only appear where a name resolved, and the roughly 4-in-10 that
    // say "makes two melee attacks" resolve to nothing — the DM still needs
    // the sentence, so it is never replaced by the parse.
    // "Run" only appears when the wording resolved to real attacks. On the
    // ~4-in-10 that say "makes two melee attacks" there is nothing to queue,
    // and offering a button that silently did less than the sentence says
    // would be worse than offering none.
    const plan = this._plan(r);
    const runBtns = plan.length
      ? `<div class="atk-multi-run">
           <span class="atk-multi-run-label">Run ${plan.length}:</span>
           <button class="atk-btn small" data-aact="multi" data-cid="${esc(c.id)}" data-mode="avg"
             title="${esc(plan.map(p=>p.name).join(' → '))} — average damage, choose a target for each">Avg</button>
           <button class="atk-btn small roll" data-aact="multi" data-cid="${esc(c.id)}" data-mode="roll"
             title="${esc(plan.map(p=>p.name).join(' → '))} — roll each, choose a target for each">🎲 Roll</button>
         </div>`
      : '';
    const multi = r.multi
      ? `<div class="atk-multi" title="Multiattack, from the stat block">
           <span class="atk-multi-tag">Multiattack</span>
           <span class="atk-multi-text">${esc(r.multi.text)}</span>
           ${runBtns}
         </div>`
      : '';
    if (!r.attacks.length){
      return `<div class="atk-mon${dead?' dead':''}">
        <div class="atk-mon-head" data-aact="toggle" data-cid="${esc(c.id)}">
          <span class="atk-mon-name">${esc(c.name)}</span>
          <span class="atk-mon-hp">${esc(hp)}</span>
        </div>
        ${open ? multi : ''}
        <div class="atk-none">${r.entry ? 'No parsable attacks in this stat block' : 'Stat block not found'}</div>
      </div>`;
    }
    return `<div class="atk-mon${dead?' dead':''}">
      <div class="atk-mon-head" data-aact="toggle" data-cid="${esc(c.id)}">
        <span class="atk-caret">${open?'▾':'▸'}</span>
        <span class="atk-mon-name">${esc(c.name)}</span>
        ${r.magical ? '<span class="atk-tag magical" title="This creature\'s attacks count as magical, so resistance to nonmagical damage will not apply">magical</span>' : ''}
        <span class="atk-mon-hp">${esc(hp)}</span>
      </div>
      ${open ? multi : ''}
      ${open ? r.attacks.map((a, ai) => this._renderAttack(r, a, ai)).join('') : ''}
    </div>`;
  },

  _dmgSummary(parts){
    return parts.map(p => `${p.avg} <span class="atk-dice">(${esc(p.dice)})</span> ${esc(p.type)}`).join(' + ');
  },

  _renderAttack(r, a, ai){
    const cid = esc(r.c.id);
    const meta = a.save
      ? `<span class="atk-save">DC ${a.save.dc} ${esc(String(a.save.ability).slice(0,3).toUpperCase())}</span>`
      : (a.toHit ? `<span class="atk-tohit">${esc(a.toHit)}</span>` : '');
    const grp = a.group ? `<span class="atk-tag">${esc(a.group)}</span>` : '';
    // Recharge belongs on the row, not buried in the name — a DM needs to know
    // the breath weapon isn't available every round.
    const rech = a.recharge
      ? `<span class="atk-tag recharge" title="Recharges on a d6 roll of ${esc(a.recharge)} at the start of the creature's turn">↺ ${esc(a.recharge)}</span>`
      : '';
    const btns = a.save
      ? `<button class="atk-btn" data-aact="go" data-cid="${cid}" data-ai="${ai}" data-mode="avg"  data-half="0">Failed</button>
         ${a.save.half ? `<button class="atk-btn ghost" data-aact="go" data-cid="${cid}" data-ai="${ai}" data-mode="avg" data-half="1">Saved ½</button>` : ''}
         <button class="atk-btn roll" data-aact="go" data-cid="${cid}" data-ai="${ai}" data-mode="roll" data-half="0" title="Roll the damage dice">🎲</button>`
      : `<button class="atk-btn" data-aact="go" data-cid="${cid}" data-ai="${ai}" data-mode="avg" data-half="0" title="Use the stat block's average">Avg</button>
         <button class="atk-btn roll" data-aact="go" data-cid="${cid}" data-ai="${ai}" data-mode="roll" data-half="0" title="Roll the damage dice">🎲 Roll</button>`;
    // How many times Multiattack says this specific attack is made. 0 when the
    // wording named nothing we could resolve, in which case no chip and no
    // repeat button appear — better to show nothing than a number that might
    // be wrong. Save-based effects are excluded: "two Claw attacks" is a
    // repeat, a breath weapon inside a multiattack is not something you fire
    // twice at one target.
    const rep = (!a.save && r.multi) ? sktMultiattackCountFor(r.multi.counts, a.name) : 0;
    const repChip = rep > 1
      ? `<span class="atk-tag rep" title="Multiattack makes this attack ${rep} times">×${rep}</span>` : '';
    const repBtns = rep > 1
      ? `<div class="atk-alt">
           <span class="atk-alt-label">all ${rep}, one target</span>
           <button class="atk-btn small" data-aact="go" data-cid="${cid}" data-ai="${ai}" data-mode="avg"
             data-rep="${rep}" data-half="0" title="Average damage, ${rep} hits">Avg ×${rep}</button>
           <button class="atk-btn small roll" data-aact="go" data-cid="${cid}" data-ai="${ai}" data-mode="roll"
             data-rep="${rep}" data-half="0" title="Roll each of the ${rep} hits separately">🎲 ×${rep}</button>
         </div>`
      : '';
    const altBtns = a.alt
      ? `<div class="atk-alt">
           <span class="atk-alt-label">${esc(a.altLabel || 'alternate')}: ${this._dmgSummary(a.alt)}</span>
           <button class="atk-btn small" data-aact="go" data-cid="${cid}" data-ai="${ai}" data-mode="avg"  data-alt="1" data-half="0">Avg</button>
           <button class="atk-btn small roll" data-aact="go" data-cid="${cid}" data-ai="${ai}" data-mode="roll" data-alt="1" data-half="0">🎲</button>
         </div>`
      : '';
    return `<div class="atk-row">
      <div class="atk-row-main">
        <span class="atk-name">${esc(a.name)}</span>${grp}${repChip}${rech}${meta}
        <span class="atk-dmg">${this._dmgSummary(a.parts)}</span>
      </div>
      <div class="atk-actions">${btns}</div>
      ${repBtns}
      ${altBtns}
    </div>`;
  },

  // The target bar only appears once damage is in hand, so the flow reads
  // "this much, of these types → who took it".
  _renderTargetBar(){
    const p = this._pending;
    const amt = p.amount.map(x => `${x.amt} ${esc(x.type)}`).join(' + ');
    const chips = this._targets().map(t => {
      const dead = (t.c.hp||0) <= 0;
      const isLast = t.c.id === this._lastTargetId;
      return `<button class="atk-target${t.c.isPC?' pc':''}${dead?' dead':''}${isLast?' last':''}"
        data-aact="hit" data-idx="${t.idx}" title="${esc(t.c.name)} — ${t.c.hp}/${t.c.hpMax} HP">
        ${esc(t.c.name)}<span class="atk-target-hp">${t.c.hp}</span></button>`;
    }).join('');
    const q = this._queue;
    // Miss is not optional polish. The DM rolls to hit outside this panel, so
    // a sequence with no way to say "that one missed" would force them to
    // cancel and restart the rest by hand.
    const queueUi = q
      ? `<span class="atk-queue-step">${q.i + 1} / ${q.items.length}</span>
         <button class="atk-btn ghost small" data-aact="miss" title="This attack missed — skip to the next">Miss</button>`
      : '';
    return `<div class="atk-targetbar${q ? ' multi' : ''}">
      <div class="atk-pending">
        ${queueUi}
        <span class="atk-pending-label">${esc(p.label)}</span>
        <span class="atk-pending-amt">${amt}</span>
        ${p.detail ? `<span class="atk-pending-detail">${esc(p.detail)}</span>` : ''}
        <button class="atk-btn ghost small" data-aact="cancel">${q ? 'Stop' : 'Cancel'}</button>
      </div>
      <div class="atk-targets">${chips}</div>
      ${q ? `<div class="atk-queue-rest">${q.items.map((it, k) =>
              `<span class="atk-queue-pip${k < q.i ? ' done' : k === q.i ? ' now' : ''}">${esc(it.name)}</span>`
            ).join('')}</div>` : ''}
    </div>`;
  },

  _renderLog(){
    if (!this._log.length) return '';
    return `<div class="atk-log">${this._log.slice(0,8).map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
  },

  // ─── Interaction ──────────────────────────────────────────────────────────
  _wire(){
    const b = this._body; if (!b) return;
    if (b._atkWired) return;      // body survives _render(); only its children change
    b._atkWired = true;
    b.addEventListener('click', e => {
      const el = e.target.closest('[data-aact]'); if (!el) return;
      const act = el.dataset.aact;
      if (act === 'toggle'){
        const id = el.dataset.cid;
        this._open[id] = this._open[id] === false ? true : false;
        this._render();
      } else if (act === 'go'){
        this._prepare(el.dataset.cid, +el.dataset.ai, el.dataset.mode,
                      el.dataset.alt === '1', el.dataset.half === '1',
                      Math.max(1, parseInt(el.dataset.rep || '1', 10) || 1));
      } else if (act === 'multi'){
        this._startMulti(el.dataset.cid, el.dataset.mode);
      } else if (act === 'cancel'){
        // Stops the whole sequence, not just this swing — the alternative
        // (cancel one, keep going) has no obvious meaning and no button for it.
        if (this._queue) this._finishMulti(true);
        else { this._pending = null; this._render(); }
      } else if (act === 'miss'){
        if (this._queue){ this._queue.misses++; this._advanceQueue(); }
      } else if (act === 'hit'){
        this._apply(+el.dataset.idx);
      }
    });
  },

  // ─── Multiattack sequence ─────────────────────────────────────────────────
  // Each swing picks its own target, so the queue holds the plan and _pending
  // holds the current swing's numbers — the existing single-attack machinery
  // does the actual work, one step at a time.
  //
  // Damage is rolled at the START of each step rather than all up front, so
  // what the DM sees is what a target is about to take. Rolling the whole
  // multiattack in advance would mean the numbers were decided before they
  // chose who each one hit.
  _startMulti(cid, mode){
    const row = this._rows().find(r => r.c.id === cid); if (!row) return;
    const items = this._plan(row); if (!items.length) return;
    // Name is captured HERE, not read back at the end: the creature can be
    // killed by a reaction mid-sequence, and the summary line shouldn't
    // degrade to "Monster" just because its row has gone.
    this._queue = { srcId: cid, name: row.c.name, mode, items, i: 0, hits: 0, misses: 0 };
    this._prepareQueueStep();
  },
  _prepareQueueStep(){
    const q = this._queue; if (!q) return;
    const it = q.items[q.i];
    // The monster can leave the tracker mid-sequence (killed by a reaction,
    // removed by the DM). Abandon rather than throw.
    const row = this._rows().find(r => r.c.id === q.srcId);
    if (!row || !it || !row.attacks[it.ai]){ this._finishMulti(true); return; }
    this._prepare(q.srcId, it.ai, q.mode, false, false, 1);
    if (this._pending) this._pending.label += ` (${q.i + 1}/${q.items.length})`;
    this._render();
  },
  _advanceQueue(){
    const q = this._queue; if (!q) return;
    q.i++;
    if (q.i >= q.items.length){ this._finishMulti(false); return; }
    this._prepareQueueStep();
  },
  _finishMulti(aborted){
    const q = this._queue; if (!q) return;
    this._log.unshift(`${q.name} · Multiattack ${aborted ? 'stopped' : 'done'}`
      + ` — ${q.hits} hit${q.hits === 1 ? '' : 's'}`
      + (q.misses ? `, ${q.misses} missed` : ''));
    this._queue = null;
    this._pending = null;
    this._render();
  },

  // Work out the numbers, then wait for a target.
  _prepare(cid, ai, mode, useAlt, halved, reps){
    const row = this._rows().find(r => r.c.id === cid); if (!row) return;
    const a = row.attacks[ai]; if (!a) return;
    const parts = (useAlt && a.alt) ? a.alt : a.parts;
    const n = Math.max(1, reps || 1);
    const details = [];
    const amount = parts.map(p => {
      let amt = 0;
      // Each repeat is rolled SEPARATELY and summed. Rolling once and
      // multiplying would collapse the spread — two claws at 2d6 is 2–24, not
      // an even number between 4 and 24 — and would double a maximum roll into
      // a guaranteed one.
      for (let i = 0; i < n; i++){
        if (mode === 'roll'){
          const r = this._roll(p.dice);
          amt += r.total;
          details.push(p.type + ' ' + r.detail);
        } else {
          amt += p.avg;
        }
      }
      // Halve BEFORE resistance, and round down — a successful save halves the
      // damage, then resistance halves what's left, and 5e rounds down at each
      // step. Doing it after would hand the target a point back. Applied to
      // the summed total, matching how a save against one effect works; the
      // repeat buttons are suppressed for save-based attacks anyway.
      if (halved) amt = Math.floor(amt / 2);
      return { amt, type: p.type };
    });
    this._pending = {
      srcId: cid, magical: row.magical,
      label: row.c.name + ' · ' + a.name + (n > 1 ? ' ×' + n : '')
             + (halved ? ' (saved)' : '') + (useAlt ? ' (' + (a.altLabel||'alt') + ')' : ''),
      amount,
      detail: details.join(' · '),
    };
    this._render();
  },

  _apply(targetIdx){
    const p = this._pending; if (!p) return;
    const C = panelDefs.combat;
    const target = state.combatants[targetIdx];
    if (!C || !target){
      if (this._queue) this._finishMulti(true); else { this._pending = null; this._render(); }
      return;
    }

    // Tell the combat tracker how the blow was delivered so qualified
    // resistances ("nonmagical bludgeoning") resolve correctly. Natural
    // monster attacks are nonmagical unless the stat block says otherwise —
    // null is exactly that statement, not a missing value.
    const prevProp = C._lastAtkProp;
    C._lastAtkProp = p.magical ? 'magical' : null;
    this._applying = true;
    try {
      // One call PER TYPE. _applyHpDelta resolves resistance against the type
      // it is given, so a combined number would apply the target's fire
      // resistance to the piercing half as well (or neither).
      p.amount.forEach(part => {
        const i = state.combatants.indexOf(target);   // re-find: the list can shift
        if (i < 0 || !part.amt) return;
        C._applyHpDelta(i, -part.amt, part.type);
      });
    } finally { C._lastAtkProp = prevProp; this._applying = false; }

    const total = p.amount.reduce((s,x)=>s+x.amt, 0);
    this._log.unshift(`${p.label} → ${target.name}: ${p.amount.map(x=>x.amt+' '+x.type).join(' + ')}`
                      + (p.amount.length>1 ? ` (${total} before resistances)` : ''));
    this._lastTargetId = target.id;
    this._pending = null;
    panelDefs.combat?._render?.();
    // Mid-sequence: roll the next swing instead of returning to the list. The
    // combat tracker is re-rendered FIRST so the target chips in the next step
    // show HP that already includes this hit.
    if (this._queue){ this._queue.hits++; this._advanceQueue(); return; }
    this._render();
  },
});
