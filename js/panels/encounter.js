// ============================================================
// ENCOUNTER BUILDER PANEL
// ============================================================
// The rules tables come from js/generated/rules.js, extracted from the books
// that ship in this repo by tools/extract-rules.js. Hand-typed copies of
// these were wrong on 19 of 20 threshold rows and 14 of 16 multiplier counts,
// and stopped at CR 24 — so a Scion of Surtur scored zero. The fallbacks are
// the correct values, used only if the generated file failed to load; the
// generator refuses to write at all if a table does not parse.
const _R = (typeof window !== 'undefined' && window.SKT_RULES) || {};
const XP_THRESH = _R.xpThresholds2014 || [[25,50,75,100]];
const CR_XP = _R.crXp || {};
// 2024 DMG XP budget PER CHARACTER by level (1–20): [Low, Moderate, High].
// The 2024 system drops the encounter multiplier entirely — you just spend the
// summed budget on monsters (raw XP), which reads far closer to actual play.
const XP_BUDGET_2024 = _R.xpBudget2024 || [];
registerPanel('encounter',{
  title:'Encounter Builder',icon:'⚡',
  _monsters:[],_partyLevel:6,_partySize:5,
  _system:'2024', // encounter-building system: '2024' (budget, no multiplier) or '2014'
  // Library of saved encounters — each is {id, name, monsters, ts}. Lets
  // the DM stage two or three fights for a session and switch between them.
  _saved:[],
  // Party members sitting this fight out (ids). Everyone else in the Party
  // Tracker (not a rival) is in it, at their own level.
  _out:[],
  // The saved encounter being worked on (its id), and the notes that go
  // with this one (tactics, the ground, the treasure).
  _cur:null, _notes:'',
  // Hit points when the encounter goes to the tracker: the stat block's
  // average, rolled from its hit dice, or rolled at the table and typed in.
  _hpMode:'avg',
  mount(body){
    this._body=body;
    this._load();
    this._render();
  },
  // What's stored. Also before adding from a stat block with the window
  // never opened this session: saving then would otherwise write an empty
  // builder over the saved encounters.
  _loaded:false,
  _load(){
    this._loaded = true;
    try{const r=localStorage.getItem('skt-enc-v1');if(r){const d=JSON.parse(r);this._monsters=d.monsters||[];this._partyLevel=d.partyLevel||6;this._partySize=d.partySize||state.party.length||5;this._saved=Array.isArray(d.saved)?d.saved:[];if(d.system==='2014'||d.system==='2024')this._system=d.system;this._out=Array.isArray(d.out)?d.out:[];this._cur=d.cur||null;this._notes=typeof d.notes==='string'?d.notes:'';if(['avg','roll','mine'].includes(d.hpMode))this._hpMode=d.hpMode;}}catch(e){}
    this._monsters.forEach(m => { if (m && !m.id) m.id = this._rowId(); });
  },
  // Each monster row has an id. Two DM screens changing the encounter at
  // once merged it as one list, so one screen's whole list won and the
  // other's added monster was gone; with ids the sync merges row by row.
  _rowId(){ return 'em_' + (typeof uid === 'function' ? uid() : Math.random().toString(36).slice(2)); },
  // UNDO. Taking a monster out, Clear, deleting a saved encounter and Scale
  // to had none (Ctrl+Z or the toast's Undo): a stray × lost the row. The
  // change is made, saved and drawn, and goes into the app's undo history.
  _undoable(label, fn){
    const snap = () => JSON.stringify({ m: this._monsters, s: this._saved, c: this._cur, n: this._notes });
    const before = snap(); fn(); const after = snap();
    this._save(); if (this._body) this._render();
    if (before === after) return;
    const put = j => { const o = JSON.parse(j); if (!this._loaded) this._load(); this._monsters = o.m; this._saved = o.s; this._cur = o.c; this._notes = o.n; this._save(); if (this._body) this._render(); };
    if (typeof sktUndoRecordCustom === 'function') sktUndoRecordCustom(label, () => put(before), () => put(after));
    else if (typeof showToast === 'function') showToast(label);
  },
  // From a stat block anywhere (search, the Bestiary): into the encounter
  // being built, open or not. The same name and book adds to its row.
  addEntry(d, n){
    if (!d || d.cat !== 'monster') return;
    if (!this._loaded) this._load();
    n = Math.max(1, n | 0 || 1);
    const _source = d._source || null;
    const had = this._monsters.find(m => m.name === d.name && (m._source || null) === _source);
    if (had) had.count = (had.count || 1) + n;
    else this._monsters.push({ id: this._rowId(), name: d.name, cr: d._cr ?? d._raw?.challenge_rating ?? '?', hp: d.hp || 10, ac: d.ac || 10, dex: d.dex || 10, _source, count: n });
    this._save();
    if (this._body) this._render();
    const total = this._monsters.reduce((s, m) => s + (m.count || 1), 0);
    if (typeof showToast === 'function') showToast(d.name + ' added to the encounter (' + total + ' monster' + (total === 1 ? '' : 's') + ')',
      this._body ? {} : { action: { label: 'Open', run: () => openPanel('encounter') } });
  },
  unmount(){
    this._body=null;
  },
  _save(){saveJson('skt-enc-v1', {monsters:this._monsters,partyLevel:this._partyLevel,partySize:this._partySize,saved:this._saved,system:this._system,out:this._out,cur:this._cur,notes:this._notes,hpMode:this._hpMode}, 'encounters');},
  // A creature's hit dice ("7d10 + 21"), or '' when its stat block has none.
  _hitDice(c){
    const d = c && typeof sktFindMonster === 'function' && c._slug ? sktFindMonster(c._slug, c._source) : null;
    const raw = (d && d._raw) || null;
    return raw && typeof raw.hit_dice === 'string' && /\d+d\d+/.test(raw.hit_dice) ? raw.hit_dice.replace(/\s+/g, '') : '';
  },
  // The creatures just added, their hit points as chosen. Rolled: each its
  // own hit dice (a goblin is 2d6, so 2 to 12, not always 7). Mine: one box
  // each, the average in it, for what was rolled at the table.
  _applyHp(ids){
    if (this._hpMode === 'avg' || !ids.length) return;
    const list = ids.map(id => state.combatants.find(c => c.id === id)).filter(c => c && this._hitDice(c));
    if (!list.length) return;
    const set = (c, n) => { n = Math.max(1, Math.round(+n || 0)); if (!(n > 0)) return; c.hp = n; c.hpMax = n; };
    const done = () => { save(); try { panelDefs.combat._render(); } catch(e){} };
    if (this._hpMode === 'roll'){
      list.forEach(c => set(c, sktRollDice(this._hitDice(c)).total));
      done();
      if (typeof showToast === 'function') showToast('Hit points rolled: ' + list.slice(0, 6).map(c => c.name + ' ' + c.hp).join(', ') + (list.length > 6 ? ' …' : ''));
      return;
    }
    if (typeof showModal !== 'function') return;
    showModal('Hit points rolled at the table', list.map(c => ({ id: 'hp_' + c.id, label: c.name + ' (' + this._hitDice(c).replace(/\+/g, ' + ') + ')', type: 'number', value: c.hpMax, min: 1 })), 'Set hit points')
      .then(r => { if (!r) return; list.forEach(c => { const v = parseInt(r['hp_' + c.id], 10); if (v > 0) set(c, v); }); done(); });
  },
  // SAVED ENCOUNTERS. Loading one replaced what was being built without a
  // word, and saving after changing a loaded one offered another name
  // ("Goblin & friends (8)" for "Bridge ambush"), so it was kept twice. The
  // builder now knows which one it is working on: Save puts the changes back
  // in it, Save as new… makes another; loading over unsaved work asks first.
  _curSaved(){ return this._cur ? this._saved.find(s => s.id === this._cur) || null : null; },
  // The saved list, as filtered: every word in the name, a monster's name or
  // the notes. (No cap any more, so the list can grow long.)
  _savedQ:'',
  _savedShown(){
    const w = String(this._savedQ || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!w.length) return this._saved;
    return this._saved.filter(s => { const hay = (s.name + ' ' + (s.monsters || []).map(m => m.name).join(' ') + ' ' + (s.notes || '')).toLowerCase(); return w.every(x => hay.includes(x)); });
  },
  _sameMons(a, b){ const k = l => JSON.stringify((l || []).map(m => [m.name, m._source || null, m.count || 1]).sort()); return k(a) === k(b); },
  // Unsaved: a loaded one changed, or a new one with something in it.
  _dirty(){
    const s = this._curSaved();
    if (!s) return this._monsters.length > 0 || !!this._notes.trim();
    return !this._sameMons(s.monsters, this._monsters) || (s.notes || '') !== this._notes;
  },
  _storeAs(name, id){
    const lc = name.toLowerCase();
    const rec = { id: id || ('enc_' + (typeof uid==='function' ? uid() : Date.now().toString(36))), name, monsters: JSON.parse(JSON.stringify(this._monsters)), notes: this._notes, ts: Date.now() };
    // one of a name: another with this name is replaced
    this._saved = this._saved.filter(s => s.id !== rec.id && (s.name||'').toLowerCase() !== lc);
    this._saved.unshift(rec);
    // No cap. There was one of 30, and the 31st save threw the oldest away
    // without a word; a saved encounter is a few hundred characters and the
    // whole key may be 2,000,000.
    this._cur = rec.id;
    this._save(); this._render();
    if (typeof showToast==='function') showToast('Saved “' + name + '”');
  },
  // THE PARTY. It was a level and a size typed in (6 and 5 until changed),
  // never the party's: a table of seven read as five, and a mixed party (a
  // 3rd-level newcomer among 6ths) couldn't be said at all — both DMGs add
  // up each character at their OWN level. Now: the Party Tracker's
  // characters (not rivals), each at their level, ticked in or out of this
  // fight. With no party, the typed level and size as before.
  _members(){ return ((typeof state !== 'undefined' && state.party) || []).filter(p => p && !p.foe); },
  _lvlOf(p){ const n = this._ownLvl(p); return n || Math.min(Math.max(this._partyLevel, 1), 20); },
  // Their own level, or 0 when their sheet has none: they were counted at
  // the builder's 6 without a word.
  _ownLvl(p){ const n = parseInt(p && (p.level || (p.sheet && p.sheet.level)), 10); return n >= 1 ? Math.min(20, n) : 0; },
  // The levels of everyone in this fight, one per character.
  _levels(){
    const m = this._members();
    if (!m.length) return Array.from({ length: Math.max(1, this._partySize | 0) }, () => Math.min(Math.max(this._partyLevel, 1), 20));
    return m.filter(p => !this._out.includes(p.id)).map(p => this._lvlOf(p));
  },
  _count(){ return this._levels().length; },
  // 2014: Easy/Medium/Hard/Deadly for the whole party, each at their level.
  _thresh2014(){
    return this._levels().reduce((t, l) => { const r = XP_THRESH[l - 1] || XP_THRESH[0]; return t.map((v, i) => v + r[i]); }, [0, 0, 0, 0]);
  },
  _systemMode(){ return this._system==='2014' ? '2014' : '2024'; },
  // 2024 party XP budget for the current level + size (per-char × size).
  _budget2024(){
    const t = this._levels().reduce((s, l) => { const b = XP_BUDGET_2024[l - 1] || XP_BUDGET_2024[0]; return s.map((v, i) => v + b[i]); }, [0, 0, 0]);
    return {low:t[0], moderate:t[1], high:t[2]};
  },
  // 2024 difficulty from RAW monster XP (no multiplier) vs the party budget.
  _difficulty2024(rawXP){
    if(!rawXP) return {label:'—',cls:'easy'};
    const bg=this._budget2024();
    if(rawXP<=bg.low)      return {label:'Low',cls:'easy'};
    if(rawXP<=bg.moderate) return {label:'Moderate',cls:'medium'};
    if(rawXP<=bg.high)     return {label:'High',cls:'hard'};
    return {label:'Deadly',cls:'deadly'};
  },
  _calcXP(){
    const total=this._monsters.reduce((sum,m)=>{const xp=CR_XP[m.cr]||0;return sum+(xp*(m.count||1));},0);
    const count=this._monsters.reduce((s,m)=>s+(m.count||1),0);
    // DMG "Encounter Multipliers": 1 monster x1, 2 x1.5, 3-6 x2, 7-10 x2.5,
    // 11-14 x3, 15+ x4. The old lookup was a list indexed by the COUNT while
    // its values were written as if it were indexed from zero, so one monster
    // got x1.5 and two got x2 — and the values themselves did not match the
    // table either. Fourteen of the first sixteen counts came out wrong.
    // A range test rather than an array, because that is what the book is.
    // Stepped table from the book: [maxCount, multiplier], last step open-ended.
    const steps = _R.encounterMultipliers || [[1,1],[2,1.5],[6,2],[10,2.5],[14,3],[null,4]];
    let si = steps.findIndex(([upto]) => upto == null || count <= upto);
    if (si < 0) si = steps.length - 1;
    // DMG p.83, "Party Size": a party of fewer than three characters uses the
    // next HIGHER multiplier, six or more the next LOWER. Only the count table
    // was here, so a party of six read every fight as harder than the book
    // says, and a duo read every fight as easier — in the direction that gets
    // someone killed.
    //
    // Stepping below the first row is a real value, not a clamp: the book's
    // own sidebar puts a single monster against six-plus characters at x0.5.
    // Stepping above the last is not, so it clamps.
    let si2 = si;
    const size = this._count();
    if (size < 3)       si2 = Math.min(steps.length - 1, si + 1);
    else if (size >= 6) si2 = si - 1;
    const mult = si2 < 0 ? 0.5 : steps[si2][1];
    const sizeAdj = si2 === si ? 0 : (si2 > si ? 1 : -1);
    return{raw:total,adjusted:Math.round(total*mult),mult,count,sizeAdj};
  },
  _difficulty(adjXP){
    const partyThresh=this._thresh2014();
    if(adjXP<partyThresh[0])return{label:'Trivial',cls:'easy'};
    if(adjXP<partyThresh[1])return{label:'Easy',cls:'easy'};
    if(adjXP<partyThresh[2])return{label:'Medium',cls:'medium'};
    if(adjXP<partyThresh[3])return{label:'Hard',cls:'hard'};
    return{label:'Deadly',cls:'deadly'};
  },
  // A row's stat block: by name and book; a row saved without a book, by name.
  _entryOf(m){
    if (typeof _5eData === 'undefined' || !Array.isArray(_5eData) || !m) return null;
    return _5eData.find(d => d.cat === 'monster' && d.name === m.name && m._source && d._source === m._source)
      || (m._source ? null : _5eData.find(d => d.cat === 'monster' && d.name === m.name)) || null;
  },
  // The shared search (monster-picker.js), shaped as this panel's rows.
  _searchPool(q){
    if (typeof sktMonsterPool !== 'function') return [];
    return sktMonsterSearch('encounter', q).slice(0, 30)
      .map(d => ({ name:d.name, cr:d._cr ?? d._raw?.challenge_rating ?? '?', hp:d.hp||10, ac:d.ac||10, dex:d.dex||d._raw?.dexterity||10, _img:d._img, _source:d._source }));
  },
  // Monsters come from the shared picker. Same name AND book adds to the row
  // already there; a 2014 and a 2024 entry of one monster stay two rows.
  _openPicker(){
    if (typeof sktPickMonster !== 'function') return;
    sktPickMonster({
      title: 'Add monsters to the encounter', action: 'Add to encounter', scope: 'encounter', count: true, xp: true,
      onPick: (d, n) => {
        const _source = d._source || null;
        const existing = this._monsters.find(m => m.name === d.name && (m._source || null) === _source);
        if (existing) existing.count = (existing.count || 1) + n;
        else this._monsters.push({ id: this._rowId(), name: d.name, cr: d._cr ?? d._raw?.challenge_rating ?? '?', hp: d.hp || 10, ac: d.ac || 10,
                                   dex: d.dex || 10, _source, count: n });
        this._save(); this._render();
        return 'Added ' + (n > 1 ? n + ' × ' : '') + d.name + ' to the encounter';
      },
    });
  },

  _render(){
    const b=this._body;if(!b)return;
    const xp=this._calcXP();
    const system=this._systemMode();
    // Nobody ticked: no budget at all, which read as Deadly.
    const diff=!this._count() ? {label:'—',cls:'easy'} : system==='2024' ? this._difficulty2024(xp.raw) : this._difficulty(xp.adjusted);
    // .enc-root is there to be measured: the two columns stack when the
    // window is narrow (a container query in main.css).
    b.innerHTML=`<div class="enc-root"><div class="enc-panel">
      <div class="enc-left">
        <div class="enc-section">
          <h3>Party</h3>
          ${this._members().length ? `<div class="enc-party-list">${this._members().map(p => `<label class="enc-pc" title="${this._out.includes(p.id) ? 'Not in this fight' : 'In this fight'}">
              <input type="checkbox" data-epc="${esc(p.id)}" ${this._out.includes(p.id) ? '' : 'checked'}>
              <span class="enc-pc-n">${esc(p.name)}</span><span class="enc-pc-l"${this._ownLvl(p) ? '' : ' title="No level on their sheet: counted at the level below"'}>Lv ${this._ownLvl(p) || '?'}</span></label>`).join('')}</div>
            ${this._members().some(p => !this._ownLvl(p)) ? `<label class="enc-nolvl">No level set — count as level <input type="number" id="enc-level" aria-label="Level for those with none" value="${this._partyLevel}" min="1" max="20"></label>` : ''}
            <div class="enc-party-sum">${(() => { const L = this._levels(); if (!L.length) return 'Nobody in this fight — tick who is'; const lo = Math.min(...L), hi = Math.max(...L);
              return L.length + ' character' + (L.length === 1 ? '' : 's') + ' · level ' + (lo === hi ? lo : lo + '–' + hi); })()}</div>`
          : `<div class="enc-party-adj">
            <label>Level</label>
            <input type="number" id="enc-level" aria-label="Party level" value="${this._partyLevel}" min="1" max="20" style="font-size:var(--fs-sm);margin-bottom:6px">
            <label>Size</label>
            <input type="number" id="enc-size" aria-label="Party size" value="${this._partySize}" min="1" max="10" style="font-size:var(--fs-sm)">
          </div>`}
        </div>
        <div class="enc-section" style="flex:1;overflow-y:auto">
          <h3>Monsters${this._curSaved() ? ` <span class="enc-cur" title="The saved encounter you are working on">· ${esc(this._curSaved().name)}${this._dirty() ? ' <span class="enc-dirty">(changed)</span>' : ''}</span>` : ''}</h3>
          <div class="enc-monsters-list" id="enc-monster-list">
            ${!this._monsters.length?'<div style="font-size:var(--fs-sm);color:var(--text-dim)">Add monsters below.</div>':
              this._monsters.map((m,i)=>{
                const srcDisplay = m._source ? (typeof _formatSource==='function' ? _formatSource(m._source) : m._source) : '';
                const srcBadge = srcDisplay ? `<span class="enc-src-badge">${esc(srcDisplay)}</span>` : '';
                // The name whole on its own line (a narrow column cut it to
                // "Vampi…" beside a clipped book badge), CR, XP and the book
                // under it; the name opens the stat block.
                const each = CR_XP[m.cr];
                return `<div class="enc-monster-row">
                  <input type="number" value="${m.count||1}" min="1" max="200" data-ei="${i}" aria-label="How many ${esc(m.name)}" style="width:38px;font-size:var(--fs-sm);padding:2px 4px">
                  <span class="enc-name"><button class="enc-nm" data-eact="stat" data-ei="${i}" title="${esc(m.name)}: the stat block">${esc(m.name)}</button>
                    <span class="enc-meta">CR ${esc(String(m.cr))} · ${each != null ? (each * (m.count||1)).toLocaleString() + ' XP' : 'no XP'}${srcDisplay ? ' · ' + esc(srcDisplay) : ''}</span></span>
                  <button class="btn icon-btn danger" data-eact="del" data-ei="${i}" title="Take ${esc(m.name)} out" style="padding:2px 5px;font-size:var(--fs-sm)">×</button>
                </div>`;
              }).join('')}
          </div>
          <button class="btn enc-add-btn" id="enc-add" title="Search monsters by name, CR, type or book">＋ Add monsters…</button>
          <textarea id="enc-notes" class="enc-notes" rows="3" placeholder="Notes — tactics, the ground, treasure" aria-label="Notes for this encounter">${esc(this._notes)}</textarea>
        </div>
      </div>
      <div class="enc-right">
        <div class="enc-stats">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px">
            <h3 style="font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:0">XP Budget</h3>
            <div class="enc-system-toggle" title="Encounter-building system. 2024 drops the count multiplier and reads closer to real play.">
              <button class="enc-sys-btn ${system==='2024'?'active':''}" data-eact="sys" data-sys="2024" title="2024 DMG — XP budget, no multiplier">2024</button>
              <button class="enc-sys-btn ${system==='2014'?'active':''}" data-eact="sys" data-sys="2014" title="2014 DMG — adjusted XP with count multiplier">2014</button>
            </div>
          </div>
          ${this._renderEncStats(system, xp, diff)}
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <label style="font-size:var(--fs-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Scale to:</label>
            <select id="enc-scale-target" aria-label="Difficulty to scale to" style="font-size:var(--fs-sm);padding:3px 24px 3px 6px;flex:0 0 auto;background-color:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:3px" ${!this._monsters.length?'disabled':''}>
              <option value="">—</option>
              ${(system==='2024'?['Low','Moderate','High','Deadly']:['Easy','Medium','Hard','Deadly']).map(o=>`<option value="${o}">${o}</option>`).join('')}
            </select>
            <span style="font-size:var(--fs-xs);color:var(--text-dim)">changes how many of each</span>
          </div>
          <div class="enc-hp-mode">
            <label for="enc-hp">Hit points</label>
            <select id="enc-hp" aria-label="Monsters’ hit points when they go to the tracker">
              <option value="avg" ${this._hpMode==='avg'?'selected':''}>Average (the stat block’s)</option>
              <option value="roll" ${this._hpMode==='roll'?'selected':''}>Rolled from their hit dice</option>
              <option value="mine" ${this._hpMode==='mine'?'selected':''}>I’ll roll them — ask me</option>
            </select>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn small primary" id="enc-push-combat" ${!this._monsters.length?'disabled':''}>▶ Push to Combat Tracker</button>
            <button class="btn small" id="enc-push-map" ${!this._monsters.length?'disabled':''} title="Add them to the fight, then click the battle map where they stand">Push and place on map</button>
            <button class="btn small danger" id="enc-clear">Clear encounter</button>
          </div>
          <h3 style="font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:14px 0 8px">Saved encounters</h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
            ${this._curSaved()
              ? `<button class="btn small${this._dirty() ? ' primary' : ''}" id="enc-save-over" ${this._dirty() ? '' : 'disabled title="No changes to save"'}>${ICO('i-save')} Save</button>
                 <button class="btn small" id="enc-save-current" ${!this._monsters.length?'disabled title="Add monsters first"':''}>Save as new…</button>`
              : `<button class="btn small" id="enc-save-current" ${!this._monsters.length?'disabled title="Add monsters first"':''}>${ICO('i-save')} Save current…</button>`}
          </div>
          ${this._saved.length > 6 ? `<input type="search" id="enc-saved-q" class="enc-saved-q" placeholder="Find a saved encounter — name, monster, notes" value="${esc(this._savedQ || '')}" aria-label="Find a saved encounter">` : ''}
          <div id="enc-saved-list" style="display:flex;flex-direction:column;gap:4px">
            ${!this._saved.length
              ? '<div style="font-size:var(--fs-sm);color:var(--text-dim)">No saved encounters yet.</div>'
              : this._savedShown().map(s => {
                  const count = (s.monsters||[]).reduce((n,m)=>n+(m.count||1),0);
                  // How hard it is for the party as it stands now, in this edition.
                  const v = this._verdictFor(s.monsters || []);
                  return `<div class="enc-saved-row${s.id === this._cur ? ' on' : ''}" style="display:flex;align-items:center;gap:6px;background:var(--panel-2);border:1px solid var(--border);border-radius:4px;padding:4px 6px">
                    <button class="btn small" data-eact="load-enc" data-eid="${esc(s.id)}" style="flex:1;text-align:left;justify-content:flex-start" title="${s.id === this._cur ? 'Open now' : 'Open this encounter'}${s.notes ? ' — ' + esc(String(s.notes).slice(0, 120)) : ''}">${esc(s.name)} <span style="color:var(--text-dim);font-size:var(--fs-xs)">· ${count} monster${count === 1 ? '' : 's'} · <span class="enc-sv-d">${esc(v)}</span></span></button>
                    <button class="btn icon-btn" data-eact="ren-enc" data-eid="${esc(s.id)}" title="Rename “${esc(s.name)}”" aria-label="Rename" style="padding:2px 5px;font-size:var(--fs-sm)">✎</button>
                    <button class="btn icon-btn danger" data-eact="del-enc" data-eid="${esc(s.id)}" title="Delete saved encounter" style="padding:2px 5px;font-size:var(--fs-sm)">×</button>
                  </div>`;
                }).join('') + (this._saved.length && !this._savedShown().length ? '<div style="font-size:var(--fs-sm);color:var(--text-dim)">None match.</div>' : '')}
          </div>
        </div>
      </div>
    </div></div>`;
    // Party inputs
    b.querySelector('#enc-level')?.addEventListener('change',e=>{this._partyLevel=Math.min(20,Math.max(1,parseInt(e.target.value)||6));this._save();this._render();});
    b.querySelector('#enc-size')?.addEventListener('change',e=>{this._partySize=Math.min(10,Math.max(1,parseInt(e.target.value)||5));this._save();this._render();});
    b.querySelectorAll('[data-epc]').forEach(cb => cb.addEventListener('change', () => {
      const id = cb.dataset.epc;
      this._out = this._out.filter(x => x !== id).concat(cb.checked ? [] : [id]);
      this._save(); this._render();
    }));
    // Monster list
    b.querySelectorAll('[data-eact="del"]').forEach(btn=>btn.addEventListener('click',()=>{ const m = this._monsters[+btn.dataset.ei];
      this._undoable('Removed ' + (m ? m.name : 'a monster'), () => { this._monsters.splice(+btn.dataset.ei,1); }); }));
    b.querySelectorAll('[data-eact="stat"]').forEach(btn => btn.addEventListener('click', () => {
      const m = this._monsters[+btn.dataset.ei], d = m && this._entryOf(m);
      if (d && typeof popOutDetail === 'function') popOutDetail(d);
      else if (typeof showToast === 'function') showToast('No stat block for ' + (m ? m.name : 'that') + ' in the books in use');
    }));
    b.querySelectorAll('#enc-monster-list input[type="number"]').forEach(inp=>inp.addEventListener('change',e=>{this._monsters[+e.target.dataset.ei].count=Math.min(200,Math.max(1,parseInt(e.target.value)||1));this._save();this._render();}));
    b.querySelector('#enc-add').addEventListener('click', () => this._openPicker());
    b.querySelector('#enc-hp')?.addEventListener('change', e => { this._hpMode = e.target.value; this._save(); });
    // Push to combat — flash the button to confirm the action, open the
    // combat panel if it's not already up, and use a richer toast that names
    // a few of the monsters added (instead of just a count).
    // The same, then the battle map opens and the next click there is where
    // they stand.
    b.querySelector('#enc-push-map')?.addEventListener('click', () => {
      if (!this._monsters.length) return;
      this._confirmPush(() => {
        const fresh = this._push(b.querySelector('#enc-push-combat'));
        if (!fresh.length) return;
        if (!layout.battlemap?.open) openPanel('battlemap');
        const start = () => { const B = panelDefs.battlemap;
          if (B && B._body){ if (typeof sktEnsureCombatTokens === 'function') sktEnsureCombatTokens(true); B._placeCombatants(fresh); } };
        setTimeout(start, 350);
      });
    });
    b.querySelector('#enc-push-combat').addEventListener('click', e => {
      if (!this._monsters.length) return;
      const btn = e.currentTarget;
      this._confirmPush(() => this._push(btn));
    });
    this._wire2(b);

  },
  // PUSHED TWICE. A second press added a second set without a word — a
  // double click, or a press to check it had worked, and the fight had
  // twelve goblins. Pushing this encounter again while its monsters are
  // still in the fight asks first (a second wave is a yes).
  _pushSig(){ return JSON.stringify(this._monsters.map(m => [m.name, m._source || null, m.count || 1])); },
  _alreadyIn(){
    const p = this._pushed;
    if (!p || p.sig !== this._pushSig()) return 0;
    return p.ids.filter(id => (state.combatants || []).some(c => c.id === id)).length;
  },
  _confirmPush(go){
    const n = this._alreadyIn();
    if (!n) return go();
    showConfirm('This encounter is already in the fight (' + n + ' of its monsters). Add another set of them?', { title:'Push again', confirmLabel:'Add another set' }).then(ok => { if (ok) go(); });
  },
  // Into the tracker: every monster, its stat block, its hit points as
  // chosen. → the ids of the creatures added.
  _push(btn){
      const before = new Set(state.combatants.map(c => c.id));
      let pushed = 0;
      const summaryParts = [];
      this._monsters.forEach(m => {
        const n = m.count || 1;
        // Push the STAT BLOCK the builder picked, not a copy of five fields.
        // addMonster takes resistances, immunities, the exact source, the
        // portrait and legendary actions only from what it is handed; this
        // handed it {name, hp, ac, dex}. Combat then fell back to a lookup by
        // name, which guesses between the 2014 and 2024 entries: 92 monsters
        // differ between them, and picking the 2024 Archmage here gave one
        // that took full psychic damage it is immune to. Dragons also arrived
        // with no legendary action counter.
        //
        // Name AND source, the same rule the Bestiary's drag-to-combat uses.
        // The five-field object stays as the fallback for encounters saved
        // without a source, or before the monster data has loaded.
        const entry = (typeof _5eLoaded !== 'undefined' && _5eLoaded) ? this._entryOf(m) : null;
        for (let k=0;k<n;k++){
          panelDefs.combat.addMonster(entry || {name:m.name,hp:m.hp,hpMax:m.hp,ac:m.ac,dex:m.dex||10});
          pushed++;
        }
        summaryParts.push(n>1 ? `${n}× ${m.name}` : m.name);
      });
      // Visual confirmation on the button itself — class toggled briefly so
      // the user gets feedback even if their cursor is far from a toast.
      if (btn){ btn.classList.add('enc-flash'); setTimeout(() => btn.classList.remove('enc-flash'), 600); }
      const wasOpen = !!layout.combat?.open;
      if (!wasOpen) openPanel('combat');
      const tail = summaryParts.length > 3 ? ' + ' + (summaryParts.length-3) + ' more' : '';
      const summary = summaryParts.slice(0,3).join(', ') + tail;
      showToast(`Added ${pushed} to combat: ${summary}${wasOpen ? '' : ' · opened tracker'}`);
      const fresh = state.combatants.filter(c => !before.has(c.id)).map(c => c.id);
      this._pushed = { sig: this._pushSig(), ids: fresh };
      this._applyHp(fresh);
      return fresh;
  },
  _wire2(b){
    // Scale-to-target: multiply every monster's count by the smallest integer
    // factor that puts adjusted XP into the target tier. Picks the threshold's
    // midpoint as the anchor so the result lands cleanly inside the zone
    // rather than at its edge.
    b.querySelector('#enc-scale-target')?.addEventListener('change', e => {
      const target = e.target.value;
      if (!target || !this._monsters.length){ e.target.value=''; return; }
      const was = this._calcXP().count;
      const factor = this._findScaleFactor(target);
      if (factor === null){
        showToast('Can’t make it ' + target + ' by changing how many — add or remove a kind of monster', { alert: true });
        e.target.value=''; return;
      }
      if (factor === 1){
        showToast('It’s already ' + target);
        e.target.value=''; return;
      }
      this._undoable('Scaled to ' + target + ': ' + was + ' monster' + (was === 1 ? '' : 's') + ' → ' + this._monsters.reduce((n, m) => n + Math.max(1, Math.round((m.count||1) * factor)), 0),
        () => { this._monsters.forEach(m => { m.count = Math.max(1, Math.round((m.count||1) * factor)); }); });
    });
    // 2014 ⇄ 2024 system toggle.
    b.querySelectorAll('[data-eact="sys"]').forEach(btn=>btn.addEventListener('click',()=>{
      this._system = btn.dataset.sys==='2014' ? '2014' : '2024';
      this._save(); this._render();
    }));
    b.querySelector('#enc-clear').addEventListener('click',()=>{
      showConfirm('Clear all monsters from this encounter?', {title:'Clear encounter', confirmLabel:'Clear', danger:true}).then(ok=>{
        if(!ok) return;
        this._undoable('Cleared the encounter', () => { this._monsters=[]; this._notes=''; this._cur=null; });
      });
    });
    b.querySelector('#enc-notes')?.addEventListener('input', e => {
      this._notes = e.target.value; this._save();
      // the "(changed)" mark and Save, without redrawing the box being typed in
      const h = b.querySelector('.enc-cur'); if (h){ const d = this._dirty(); let m = h.querySelector('.enc-dirty'); if (d && !m){ h.insertAdjacentHTML('beforeend', ' <span class="enc-dirty">(changed)</span>'); } else if (!d && m) m.remove(); }
      const so = b.querySelector('#enc-save-over'); if (so){ so.disabled = !this._dirty(); so.classList.toggle('primary', this._dirty()); }
    });
    b.querySelector('#enc-save-over')?.addEventListener('click', () => { const s = this._curSaved(); if (s) this._storeAs(s.name, s.id); });
    // Save current encounter under a name
    b.querySelector('#enc-save-current')?.addEventListener('click', () => {
      if (!this._monsters.length) return;
      const open = this._curSaved();
      showModal(open ? 'Save as a new encounter' : 'Save encounter', [
        { id:'name', label:'Encounter name', type:'text', value: open ? open.name + ' (2)' : this._suggestEncName() }
      ], 'Save').then(r => {
        if (!r) return;
        const name = (r.name||'').trim();
        if (!name){ if (typeof showToast==='function') showToast('Name required'); return; }
        // Another encounter has this name: replacing it is asked, not done.
        const other = this._saved.find(x => (x.name || '').toLowerCase() === name.toLowerCase());
        if (!other) return this._storeAs(name);
        showConfirm('There is already an encounter called “' + other.name + '”. Replace it with this one?', { title:'Replace encounter', confirmLabel:'Replace', danger:true })
          .then(ok => { if (ok) this._storeAs(name); });
      });
    });
    // Load a saved encounter — replaces current monsters in place
    b.querySelectorAll('[data-eact="load-enc"]').forEach(btn => btn.addEventListener('click', () => {
      const s = this._saved.find(x => x.id === btn.dataset.eid);
      if (!s || (s.id === this._cur && !this._dirty())) return;
      const go = () => {
        this._monsters = JSON.parse(JSON.stringify(s.monsters||[])); this._monsters.forEach(m => { if (!m.id) m.id = this._rowId(); }); this._notes = s.notes || ''; this._cur = s.id;
        this._save(); this._render();
        if (typeof showToast==='function') showToast('Opened “' + s.name + '”');
      };
      if (!this._dirty()) return go();
      const what = this._curSaved() ? 'The changes to “' + this._curSaved().name + '” aren’t saved.' : 'The encounter you’re building isn’t saved.';
      showConfirm(what + ' Open “' + s.name + '” anyway?', { title:'Open encounter', confirmLabel:'Open' }).then(ok => { if (ok) go(); });
    }));
    // Find one (typing keeps the box; only the list redraws)
    b.querySelector('#enc-saved-q')?.addEventListener('input', e => {
      this._savedQ = e.target.value;
      const pos = e.target.selectionStart; this._render();
      const q2 = this._body && this._body.querySelector('#enc-saved-q'); if (q2){ q2.focus(); try { q2.setSelectionRange(pos, pos); } catch(x){} }
    });
    // Rename one
    b.querySelectorAll('[data-eact="ren-enc"]').forEach(btn => btn.addEventListener('click', () => {
      const s = this._saved.find(x => x.id === btn.dataset.eid); if (!s) return;
      showModal('Rename encounter', [{ id:'name', label:'Name', type:'text', value: s.name }], 'Rename').then(r => {
        const name = r && String(r.name || '').trim(); if (!name || name === s.name) return;
        if (this._saved.some(x => x.id !== s.id && (x.name || '').toLowerCase() === name.toLowerCase())){ if (typeof showToast === 'function') showToast('Another encounter is called “' + name + '”', { alert: true }); return; }
        this._undoable('Renamed “' + s.name + '” to “' + name + '”', () => { s.name = name; });
      });
    }));
    // Delete a saved encounter
    b.querySelectorAll('[data-eact="del-enc"]').forEach(btn => btn.addEventListener('click', () => {
      const s = this._saved.find(x => x.id === btn.dataset.eid);
      if (!s) return;
      showConfirm('Delete saved encounter "' + s.name + '"?',
        {title:'Delete encounter', confirmLabel:'Delete', danger:true}).then(ok => {
          if (!ok) return;
          this._undoable('Deleted “' + s.name + '”', () => { this._saved = this._saved.filter(x => x.id !== s.id); if (this._cur === s.id) this._cur = null; });
        });
    }));
  },
  // Stats block — switches between the 2024 budget read and the 2014 adjusted
  // read. 2024: total (raw) XP vs party Low/Moderate/High budget, no multiplier.
  // 2014: raw + adjusted (×multiplier) XP vs Easy/Medium/Hard/Deadly thresholds.
  _renderEncStats(system, xp, diff){
    if (system === '2024'){
      const bg = this._budget2024();
      return `<div class="enc-stat-grid">
            <div class="enc-stat-box"><div class="l">Total XP</div><div class="v">${xp.raw.toLocaleString()}</div></div>
            <div class="enc-stat-box"><div class="l">Difficulty</div><div class="v ${diff.cls}">${diff.label}</div></div>
            <div class="enc-stat-box"><div class="l">Monster Count</div><div class="v">${xp.count}</div></div>
            ${this._eachBox(xp.raw)}
          </div>
          ${this._renderGauge2024(xp.raw)}
          <h3 style="font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:10px 0 8px">XP budget (full party)</h3>
          <div class="enc-stat-grid">
            <div class="enc-stat-box"><div class="l">Low</div><div class="v" style="font-size:var(--fs-md)">${bg.low.toLocaleString()} XP</div></div>
            <div class="enc-stat-box"><div class="l">Moderate</div><div class="v" style="font-size:var(--fs-md)">${bg.moderate.toLocaleString()} XP</div></div>
            <div class="enc-stat-box"><div class="l">High</div><div class="v" style="font-size:var(--fs-md)">${bg.high.toLocaleString()} XP</div></div>
          </div>`;
    }
    const t = this._thresh2014();
    return `<div class="enc-stat-grid">
            <div class="enc-stat-box"><div class="l">Raw XP</div><div class="v">${xp.raw.toLocaleString()}</div></div>
            <div class="enc-stat-box" title="${xp.sizeAdj
              ? 'DMG p.83: a party of ' + (xp.sizeAdj > 0 ? 'fewer than three uses the next higher multiplier'
                                                          : 'six or more uses the next lower multiplier')
              : 'DMG Encounter Multipliers, by monster count'}"><div class="l">Adjusted XP (×${xp.mult}${
              xp.sizeAdj ? (xp.sizeAdj > 0 ? ' ↑' : ' ↓') : ''})</div><div class="v">${xp.adjusted.toLocaleString()}</div></div>
            <div class="enc-stat-box"><div class="l">Difficulty</div><div class="v ${diff.cls}">${diff.label}</div></div>
            <div class="enc-stat-box"><div class="l">Monster Count</div><div class="v">${xp.count}</div></div>
            ${this._eachBox(xp.raw)}
          </div>
          ${this._renderDifficultyGauge(xp.adjusted)}
          <h3 style="font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:10px 0 8px">Thresholds (full party)</h3>
          <div class="enc-stat-grid">${['Easy','Medium','Hard','Deadly'].map((lab,i)=>`<div class="enc-stat-box"><div class="l">${lab}</div><div class="v" style="font-size:var(--fs-md)">${t[i].toLocaleString()} XP</div></div>`).join('')}</div>`;
  },

  // 2024 gauge — Low / Moderate / High zones at the party budget, marker at the
  // total (raw) monster XP. Reuses the gauge zone classes (green→red).
  _renderGauge2024(rawXP){
    const bg = this._budget2024();
    const t = [bg.low, bg.moderate, bg.high];
    const maxX = Math.max(rawXP, t[2]) * 1.15 || 100;
    const pct = (v) => Math.max(0, Math.min(100, (v / maxX) * 100));
    const markerPct = pct(rawXP);
    return '<div class="enc-gauge">'
      + '<div class="enc-gauge-bar">'
      + '<div class="enc-gauge-zone easy"   style="left:0%;width:'+pct(t[0])+'%" title="Low · 0–'+t[0].toLocaleString()+' XP"></div>'
      + '<div class="enc-gauge-zone medium" style="left:'+pct(t[0])+'%;width:'+(pct(t[1])-pct(t[0]))+'%" title="Moderate · '+t[0].toLocaleString()+'–'+t[1].toLocaleString()+' XP"></div>'
      + '<div class="enc-gauge-zone hard"   style="left:'+pct(t[1])+'%;width:'+(pct(t[2])-pct(t[1]))+'%" title="High · '+t[1].toLocaleString()+'–'+t[2].toLocaleString()+' XP"></div>'
      + '<div class="enc-gauge-zone deadly" style="left:'+pct(t[2])+'%;width:'+(100-pct(t[2]))+'%" title="Beyond High · '+t[2].toLocaleString()+'+ XP"></div>'
      + '<div class="enc-gauge-marker" style="left:'+markerPct+'%" title="Total: '+rawXP.toLocaleString()+' XP"></div>'
      + '</div>'
      + this._gaugeAxis([0, pct(t[0]), pct(t[1]), pct(t[2]), 100], ['Low', 'Moderate', 'High', 'Deadly'])
      + '</div>';
  },

  // What each character earns for the fight: the monsters' own XP shared
  // among those in it — never the 2014 adjusted figure, which is only for
  // judging difficulty (DMG p.82). D&D Beyond shows it; this didn't.
  _eachBox(raw){
    const n = this._count();
    if (!raw || !n) return '';
    return '<div class="enc-stat-box enc-each" title="The monsters’ XP shared among the ' + n + ' in the fight"><div class="l">XP each</div><div class="v">' + Math.floor(raw / n).toLocaleString() + '</div></div>';
  },
  // The words under the bar, each in the middle of its own band. They were
  // spread evenly under bands that aren't, so "Med" sat under the line
  // between Medium and Hard. A band too narrow for its word goes without.
  _gaugeAxis(stops, labels){
    return '<div class="enc-gauge-axis">' + labels.map((l, i) => {
      const a = stops[i], z = stops[i + 1], w = z - a;
      if (!(w >= 9)) return '';
      return '<span style="left:' + ((a + z) / 2).toFixed(2) + '%">' + l + '</span>';
    }).join('') + '</div>';
  },
  // Difficulty gauge — horizontal bar split into Easy / Medium / Hard / Deadly
  // zones at the party's thresholds, with a marker showing where the current
  // adjusted XP sits. Gives an at-a-glance read of "how close to the next tier
  // am I?" without doing the math by hand.
  _renderDifficultyGauge(adjXP){
    const t = this._thresh2014();
    // Zones: [0, easy), [easy, med), [med, hard), [hard, deadly), [deadly, 2×deadly)
    const maxX = Math.max(adjXP, t[3]) * 1.15 || 100;
    const pct = (v) => Math.max(0, Math.min(100, (v / maxX) * 100));
    const zoneStops = [0, t[0], t[1], t[2], t[3], maxX];
    const markerPct = pct(adjXP);
    return '<div class="enc-gauge">'
      + '<div class="enc-gauge-bar">'
      + '<div class="enc-gauge-zone trivial" style="left:0%;width:'+pct(t[0])+'%" title="Trivial · 0–'+t[0].toLocaleString()+' XP"></div>'
      + '<div class="enc-gauge-zone easy"    style="left:'+pct(t[0])+'%;width:'+(pct(t[1])-pct(t[0]))+'%" title="Easy · '+t[0].toLocaleString()+'–'+t[1].toLocaleString()+' XP"></div>'
      + '<div class="enc-gauge-zone medium"  style="left:'+pct(t[1])+'%;width:'+(pct(t[2])-pct(t[1]))+'%" title="Medium · '+t[1].toLocaleString()+'–'+t[2].toLocaleString()+' XP"></div>'
      + '<div class="enc-gauge-zone hard"    style="left:'+pct(t[2])+'%;width:'+(pct(t[3])-pct(t[2]))+'%" title="Hard · '+t[2].toLocaleString()+'–'+t[3].toLocaleString()+' XP"></div>'
      + '<div class="enc-gauge-zone deadly"  style="left:'+pct(t[3])+'%;width:'+(100-pct(t[3]))+'%" title="Deadly · '+t[3].toLocaleString()+'+ XP"></div>'
      + '<div class="enc-gauge-marker" style="left:'+markerPct+'%" title="Current: '+adjXP.toLocaleString()+' XP"></div>'
      + '</div>'
      + this._gaugeAxis([0, pct(t[0]), pct(t[1]), pct(t[2]), pct(t[3]), 100], ['Trivial', 'Easy', 'Medium', 'Hard', 'Deadly'])
      + '</div>';
  },

  // SCALE TO. The factor on every count (each rounded, at least one) that
  // gives the named difficulty, as near ×1 as there is: up or down. It is
  // judged by the builder's own verdict, so it can't disagree with what the
  // panel then says. It had a multiplier table of its own (the old wrong
  // one): "scale to Easy" made eight goblins of one that the panel called
  // Trivial. It only scaled up, stopped at ×10 — so one goblin could reach
  // nothing, and was told it was "past the top tier" — and in 2024 stopped
  // on a band's edge, which reads as the band below. 1: already there;
  // null: no count of these monsters gives it.
  _verdictFor(mons){
    const keep = this._monsters; this._monsters = mons;
    try { if (!this._count()) return '—'; const xp = this._calcXP(); return (this._systemMode() === '2024' ? this._difficulty2024(xp.raw) : this._difficulty(xp.adjusted)).label; }
    finally { this._monsters = keep; }
  },
  _findScaleFactor(target){
    if (!this._monsters.length || !target) return null;
    const at = f => this._monsters.map(m => Object.assign({}, m, { count: Math.max(1, Math.round((m.count || 1) * f)) }));
    if (this._verdictFor(at(1)) === target) return 1;
    let best = null;
    for (let k = 1; k <= 400; k++){
      for (const f of [Math.pow(1.02, k), Math.pow(1.02, -k)]){
        if (this._verdictFor(at(f)) === target && (best == null || Math.abs(Math.log(f)) < Math.abs(Math.log(best)))) best = f;
      }
      if (best != null) break;
    }
    return best;
  },

  // Default name for the Save dialog — combine the highest-CR monster's name
  // with the monster count so the user gets a sensible suggestion.
  _suggestEncName(){
    if (!this._monsters.length) return '';
    const sorted = [...this._monsters].sort((a,b) => (CR_XP[b.cr]||0) - (CR_XP[a.cr]||0));
    const lead = sorted[0]?.name || 'Encounter';
    const count = this._monsters.reduce((n,m)=>n+(m.count||1),0);
    return count > 1 ? `${lead} & friends (${count})` : lead;
  },
});
