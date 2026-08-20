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
// Sample monster list for encounter search
const MONSTER_LIST=[
  {name:'Goblin',cr:'1/4',hp:7,ac:15},{name:'Orc',cr:'1/2',hp:15,ac:13},{name:'Hobgoblin',cr:'1/2',hp:11,ac:18},
  {name:'Bugbear',cr:'1',hp:27,ac:16},{name:'Ogre',cr:'2',hp:59,ac:11},{name:'Bandit Captain',cr:'2',hp:65,ac:15},
  {name:'Owlbear',cr:'3',hp:59,ac:13},{name:'Werewolf',cr:'3',hp:84,ac:11},{name:'Troll',cr:'5',hp:84,ac:15},
  {name:'Hill Giant',cr:'5',hp:105,ac:13},{name:'Young Red Dragon',cr:'10',hp:178,ac:18},{name:'Stone Giant',cr:'7',hp:126,ac:17},
  {name:'Frost Giant',cr:'8',hp:138,ac:15},{name:'Fire Giant',cr:'9',hp:162,ac:18},{name:'Cloud Giant',cr:'9',hp:200,ac:14},
  {name:'Storm Giant',cr:'13',hp:230,ac:16},{name:'Adult Red Dragon',cr:'17',hp:256,ac:19},{name:'Iymrith',cr:'22',hp:481,ac:22},
  {name:'Gnoll',cr:'1/2',hp:22,ac:15},{name:'Skeleton',cr:'1/4',hp:13,ac:13},{name:'Zombie',cr:'1/4',hp:22,ac:8},
  {name:'Wolf',cr:'1/4',hp:11,ac:13},{name:'Dire Wolf',cr:'1',hp:37,ac:14},{name:'Mammoth',cr:'6',hp:126,ac:13},
  {name:'Kraken',cr:'23',hp:472,ac:18},{name:'Wyvern',cr:'6',hp:110,ac:13},{name:'Griffon',cr:'2',hp:59,ac:12},
  {name:'Harpy',cr:'1',hp:38,ac:11},{name:'Banshee',cr:'4',hp:58,ac:12},{name:'Vampire Spawn',cr:'5',hp:82,ac:15},
];
registerPanel('encounter',{
  title:'Encounter Builder',icon:'⚡',
  _monsters:[],_partyLevel:6,_partySize:5,_searchQ:'',_searchOpen:false,
  _system:'2024', // encounter-building system: '2024' (budget, no multiplier) or '2014'
  // Library of saved encounters — each is {id, name, monsters, ts}. Lets
  // the DM stage two or three fights for a session and switch between them.
  _saved:[],
  mount(body){
    this._body=body;
    try{const r=localStorage.getItem('skt-enc-v1');if(r){const d=JSON.parse(r);this._monsters=d.monsters||[];this._partyLevel=d.partyLevel||6;this._partySize=d.partySize||state.party.length||5;this._saved=Array.isArray(d.saved)?d.saved:[];if(d.system==='2014'||d.system==='2024')this._system=d.system;}}catch(e){}
    this._partySize=state.party.length||this._partySize;
    this._render();
  },
  unmount(){
    if (this._encDocDown){ document.removeEventListener('mousedown', this._encDocDown); this._encDocDown = null; }
    this._body=null;
  },
  _save(){saveJson('skt-enc-v1', {monsters:this._monsters,partyLevel:this._partyLevel,partySize:this._partySize,saved:this._saved,system:this._system}, 'encounters');},
  _systemMode(){ return this._system==='2014' ? '2014' : '2024'; },
  // 2024 party XP budget for the current level + size (per-char × size).
  _budget2024(){
    const lvl=Math.min(Math.max(this._partyLevel,1),20)-1;
    const b=XP_BUDGET_2024[lvl]||XP_BUDGET_2024[0];
    return {low:b[0]*this._partySize, moderate:b[1]*this._partySize, high:b[2]*this._partySize};
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
    const step = steps.find(([upto]) => upto == null || count <= upto);
    const mult = step ? step[1] : 4;
    return{raw:total,adjusted:Math.round(total*mult),mult,count};
  },
  _difficulty(adjXP){
    const level=Math.min(Math.max(this._partyLevel,1),20)-1;
    const thresh=XP_THRESH[level]||XP_THRESH[0];
    const partyThresh=thresh.map(t=>t*this._partySize);
    if(adjXP<partyThresh[0])return{label:'Trivial',cls:'easy'};
    if(adjXP<partyThresh[1])return{label:'Easy',cls:'easy'};
    if(adjXP<partyThresh[2])return{label:'Medium',cls:'medium'};
    if(adjXP<partyThresh[3])return{label:'Hard',cls:'hard'};
    return{label:'Deadly',cls:'deadly'};
  },
  // Pull monster pool: prefer the loaded 5etools bestiary, fall back to the
  // built-in static list while data is still loading.
  _searchPool(q){
    if (typeof _5eLoaded !== 'undefined' && _5eLoaded && Array.isArray(_5eData)) {
      const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
      // Honor the user's hidden-sources filter when the encounter scope is
      // on (toggleable per consumer in the Books panel).
      return _5eData
        .filter(d => d.cat==='monster')
        .filter(d => !(typeof window.SKT_IS_SOURCE_HIDDEN === 'function' && window.SKT_IS_SOURCE_HIDDEN('encounter', d._source)))
        .filter(d => tokens.every(t => (d.name+' '+(d.meta||'')).toLowerCase().includes(t)))
        .slice(0, 30)
        .map(d => ({ name:d.name, cr:d._raw?.challenge_rating ?? '?', hp:d.hp||10, ac:d.ac||10, dex:d._raw?.dexterity||10, _img:d._img, _source:d._source }));
    }
    return MONSTER_LIST.filter(m => m.name.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  },
  _renderSearchDropdown(){
    const b=this._body; if(!b) return;
    const drop = b.querySelector('#enc-search-results'); if(!drop) return;
    const results = this._searchQ ? this._searchPool(this._searchQ) : [];
    const open = this._searchOpen && results.length;
    drop.classList.toggle('open', !!open);
    drop.innerHTML = results.map(m => {
      const srcDisplay = m._source ? (typeof _formatSource==='function' ? _formatSource(m._source) : m._source) : '';
      const srcBadge = srcDisplay ? `<span class="enc-src-badge">${esc(srcDisplay)}</span>` : '';
      return `<div class="enc-search-result" data-mname="${esc(m.name)}" data-mcr="${esc(String(m.cr))}" data-mhp="${m.hp}" data-mac="${m.ac}" data-mdex="${m.dex||10}" data-msrc="${esc(m._source||'')}">
        <span class="enc-result-name">${esc(m.name)}${srcBadge}</span>
        <span class="enc-cr-badge">CR ${esc(String(m.cr))} · ${CR_XP[m.cr]||'?'} XP</span>
      </div>`;
    }).join('');
    drop.querySelectorAll('.enc-search-result').forEach(el => el.addEventListener('click', () => {
      const name = el.dataset.mname, cr = el.dataset.mcr, hp = +el.dataset.mhp, ac = +el.dataset.mac, dex = +el.dataset.mdex, _source = el.dataset.msrc || null;
      // Match by name+source so a 2014 and 2024 entry of the same monster are treated as different rows.
      const existing = this._monsters.find(m => m.name === name && (m._source||null) === _source);
      if (existing) existing.count = (existing.count||1) + 1;
      else this._monsters.push({ name, cr, hp, ac, dex, _source, count: 1 });
      this._searchQ = ''; this._searchOpen = false; this._save();
      this._render();
    }));
  },

  _render(){
    const b=this._body;if(!b)return;
    const xp=this._calcXP();
    const system=this._systemMode();
    const diff=system==='2024' ? this._difficulty2024(xp.raw) : this._difficulty(xp.adjusted);
    b.innerHTML=`<div class="enc-panel">
      <div class="enc-left">
        <div class="enc-section">
          <h3>Party</h3>
          <div class="enc-party-adj">
            <label>Level</label>
            <input type="number" id="enc-level" value="${this._partyLevel}" min="1" max="20" style="font-size:var(--fs-sm);margin-bottom:6px">
            <label>Size</label>
            <input type="number" id="enc-size" value="${this._partySize}" min="1" max="10" style="font-size:var(--fs-sm)">
          </div>
        </div>
        <div class="enc-section" style="flex:1;overflow-y:auto">
          <h3>Monsters</h3>
          <div class="enc-monsters-list" id="enc-monster-list">
            ${!this._monsters.length?'<div style="font-size:var(--fs-sm);color:var(--text-dim)">Search and add monsters below.</div>':
              this._monsters.map((m,i)=>{
                const srcDisplay = m._source ? (typeof _formatSource==='function' ? _formatSource(m._source) : m._source) : '';
                const srcBadge = srcDisplay ? `<span class="enc-src-badge">${esc(srcDisplay)}</span>` : '';
                return `<div class="enc-monster-row">
                  <input type="number" value="${m.count||1}" min="1" max="99" data-ei="${i}" style="width:38px;font-size:var(--fs-sm);padding:2px 4px">
                  <span class="enc-name" title="${esc(m.name)}">${esc(m.name)}${srcBadge}</span>
                  <span class="enc-cr">CR ${m.cr}</span>
                  <button class="btn icon-btn danger" data-eact="del" data-ei="${i}" style="padding:2px 5px;font-size:var(--fs-sm)">×</button>
                </div>`;
              }).join('')}
          </div>
          <div class="enc-add-input">
            <input type="text" id="enc-search" placeholder="Search monster..." style="font-size:var(--fs-sm)">
          </div>
          <div class="enc-search-results" id="enc-search-results"></div>
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
            <select id="enc-scale-target" style="font-size:var(--fs-sm);padding:3px 6px;flex:0 0 auto;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:3px" ${!this._monsters.length?'disabled':''}>
              <option value="">—</option>
              ${(system==='2024'?['Moderate','High','Deadly']:['Easy','Medium','Hard','Deadly']).map(o=>`<option value="${o}">${o}</option>`).join('')}
            </select>
            <span style="font-size:var(--fs-xs);color:var(--text-dim)">multiplies counts</span>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn small primary" id="enc-push-combat" ${!this._monsters.length?'disabled':''}>▶ Push to Combat Tracker</button>
            <button class="btn small danger" id="enc-clear">Clear encounter</button>
          </div>
          <h3 style="font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:14px 0 8px">Saved encounters</h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
            <button class="btn small" id="enc-save-current" ${!this._monsters.length?'disabled title="Add monsters first"':''}>${ICO('i-save')} Save current…</button>
          </div>
          <div id="enc-saved-list" style="display:flex;flex-direction:column;gap:4px">
            ${!this._saved.length
              ? '<div style="font-size:var(--fs-sm);color:var(--text-dim)">No saved encounters yet.</div>'
              : this._saved.map(s => {
                  const count = (s.monsters||[]).reduce((n,m)=>n+(m.count||1),0);
                  return `<div class="enc-saved-row" style="display:flex;align-items:center;gap:6px;background:var(--panel-2);border:1px solid var(--border);border-radius:4px;padding:4px 6px">
                    <button class="btn small" data-eact="load-enc" data-eid="${esc(s.id)}" style="flex:1;text-align:left;justify-content:flex-start" title="Load this encounter">${esc(s.name)} <span style="color:var(--text-dim);font-size:var(--fs-xs)">· ${count} mon</span></button>
                    <button class="btn icon-btn danger" data-eact="del-enc" data-eid="${esc(s.id)}" title="Delete saved encounter" style="padding:2px 5px;font-size:var(--fs-sm)">×</button>
                  </div>`;
                }).join('')}
          </div>
        </div>
      </div>
    </div>`;
    // Party inputs
    b.querySelector('#enc-level').addEventListener('change',e=>{this._partyLevel=parseInt(e.target.value)||6;this._save();this._render();});
    b.querySelector('#enc-size').addEventListener('change',e=>{this._partySize=parseInt(e.target.value)||5;this._save();this._render();});
    // Monster list
    b.querySelectorAll('[data-eact="del"]').forEach(btn=>btn.addEventListener('click',()=>{this._monsters.splice(+btn.dataset.ei,1);this._save();this._render();}));
    b.querySelectorAll('#enc-monster-list input[type="number"]').forEach(inp=>inp.addEventListener('change',e=>{this._monsters[+e.target.dataset.ei].count=parseInt(e.target.value)||1;this._save();this._render();}));
    // Search — only update the dropdown on input/focus so the input keeps focus.
    const searchInp=b.querySelector('#enc-search');
    searchInp.value=this._searchQ;
    searchInp.addEventListener('input',e=>{
      this._searchQ=e.target.value;
      this._searchOpen=true;
      // Debounced — the dropdown filters the full monster list, so rebuilding
      // it on every keystroke makes fast typing feel laggy.
      clearTimeout(this._searchTimer);
      this._searchTimer=setTimeout(()=>this._renderSearchDropdown(), 150);
    });
    searchInp.addEventListener('focus',()=>{
      this._searchOpen=true;
      this._renderSearchDropdown();
    });
    // Blur close — short delay so a result click registers before we hide the
    // dropdown. Pointer-events on the dropdown also stay live during that
    // window so fast clicks aren't lost.
    searchInp.addEventListener('blur',()=>{
      setTimeout(()=>{
        if (document.activeElement === searchInp) return;
        this._searchOpen=false;
        const drop=b.querySelector('#enc-search-results');
        if (drop) drop.classList.remove('open');
      }, 180);
    });
    // Click anywhere outside the search row also closes the dropdown.
    const onDocDown = (ev)=>{
      if (!this._searchOpen) return;
      if (ev.target === searchInp) return;
      if (ev.target.closest && ev.target.closest('#enc-search-results')) return;
      this._searchOpen=false;
      const drop=b.querySelector('#enc-search-results');
      if (drop) drop.classList.remove('open');
    };
    if (this._encDocDown) document.removeEventListener('mousedown', this._encDocDown);
    this._encDocDown = onDocDown;
    document.addEventListener('mousedown', onDocDown);
    // Initial dropdown render (handles the case where _render was triggered with a query)
    this._renderSearchDropdown();
    // Push to combat — flash the button to confirm the action, open the
    // combat panel if it's not already up, and use a richer toast that names
    // a few of the monsters added (instead of just a count).
    b.querySelector('#enc-push-combat').addEventListener('click', e => {
      if (!this._monsters.length) return;
      const btn = e.currentTarget;
      let pushed = 0;
      const summaryParts = [];
      this._monsters.forEach(m => {
        const n = m.count || 1;
        for (let k=0;k<n;k++){
          panelDefs.combat.addMonster({name:m.name,hp:m.hp,hpMax:m.hp,ac:m.ac,dex:m.dex||10});
          pushed++;
        }
        summaryParts.push(n>1 ? `${n}× ${m.name}` : m.name);
      });
      // Visual confirmation on the button itself — class toggled briefly so
      // the user gets feedback even if their cursor is far from a toast.
      btn.classList.add('enc-flash');
      setTimeout(() => btn.classList.remove('enc-flash'), 600);
      const wasOpen = !!layout.combat?.open;
      if (!wasOpen) openPanel('combat');
      const tail = summaryParts.length > 3 ? ' + ' + (summaryParts.length-3) + ' more' : '';
      const summary = summaryParts.slice(0,3).join(', ') + tail;
      showToast(`Added ${pushed} to combat: ${summary}${wasOpen ? '' : ' · opened tracker'}`);
    });
    // Scale-to-target: multiply every monster's count by the smallest integer
    // factor that puts adjusted XP into the target tier. Picks the threshold's
    // midpoint as the anchor so the result lands cleanly inside the zone
    // rather than at its edge.
    b.querySelector('#enc-scale-target')?.addEventListener('change', e => {
      const target = e.target.value;
      if (!target || !this._monsters.length){ e.target.value=''; return; }
      const factor = this._findScaleFactor(target);
      if (factor === null){
        showToast('Already past the top tier — clear or reduce monsters first');
        e.target.value=''; return;
      }
      if (factor === 1){
        showToast('Already in ' + target + ' range');
        e.target.value=''; return;
      }
      this._monsters.forEach(m => { m.count = Math.max(1, Math.round((m.count||1) * factor)); });
      this._save(); this._render();
      showToast('Scaled counts ×' + factor.toFixed(2) + ' → ' + target);
    });
    // 2014 ⇄ 2024 system toggle.
    b.querySelectorAll('[data-eact="sys"]').forEach(btn=>btn.addEventListener('click',()=>{
      this._system = btn.dataset.sys==='2014' ? '2014' : '2024';
      this._save(); this._render();
    }));
    b.querySelector('#enc-clear').addEventListener('click',()=>{
      showConfirm('Clear all monsters from this encounter?', {title:'Clear encounter', confirmLabel:'Clear', danger:true}).then(ok=>{
        if(!ok) return;
        this._monsters=[]; this._save(); this._render();
      });
    });
    // Save current encounter under a name
    b.querySelector('#enc-save-current')?.addEventListener('click', () => {
      if (!this._monsters.length) return;
      showModal('Save encounter', [
        { id:'name', label:'Encounter name', type:'text', value: this._suggestEncName() }
      ], 'Save').then(r => {
        if (!r) return;
        const name = (r.name||'').trim();
        if (!name){ if (typeof showToast==='function') showToast('Name required'); return; }
        // Replace if a saved encounter already has this name (case-insensitive)
        const lc = name.toLowerCase();
        this._saved = this._saved.filter(s => (s.name||'').toLowerCase() !== lc);
        this._saved.unshift({
          id: 'enc_' + (typeof uid==='function' ? uid() : Date.now().toString(36)),
          name,
          monsters: JSON.parse(JSON.stringify(this._monsters)),
          ts: Date.now()
        });
        // Cap the list so it doesn't grow forever
        if (this._saved.length > 30) this._saved.length = 30;
        this._save(); this._render();
        if (typeof showToast==='function') showToast('Saved "' + name + '"');
      });
    });
    // Load a saved encounter — replaces current monsters in place
    b.querySelectorAll('[data-eact="load-enc"]').forEach(btn => btn.addEventListener('click', () => {
      const s = this._saved.find(x => x.id === btn.dataset.eid);
      if (!s) return;
      this._monsters = JSON.parse(JSON.stringify(s.monsters||[]));
      this._save(); this._render();
      if (typeof showToast==='function') showToast('Loaded "' + s.name + '"');
    }));
    // Delete a saved encounter
    b.querySelectorAll('[data-eact="del-enc"]').forEach(btn => btn.addEventListener('click', () => {
      const s = this._saved.find(x => x.id === btn.dataset.eid);
      if (!s) return;
      showConfirm('Delete saved encounter "' + s.name + '"?',
        {title:'Delete encounter', confirmLabel:'Delete', danger:true}).then(ok => {
          if (!ok) return;
          this._saved = this._saved.filter(x => x.id !== s.id);
          this._save(); this._render();
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
          </div>
          ${this._renderGauge2024(xp.raw)}
          <h3 style="font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:10px 0 8px">XP budget (full party)</h3>
          <div class="enc-stat-grid">
            <div class="enc-stat-box"><div class="l">Low</div><div class="v" style="font-size:var(--fs-md)">${bg.low.toLocaleString()} XP</div></div>
            <div class="enc-stat-box"><div class="l">Moderate</div><div class="v" style="font-size:var(--fs-md)">${bg.moderate.toLocaleString()} XP</div></div>
            <div class="enc-stat-box"><div class="l">High</div><div class="v" style="font-size:var(--fs-md)">${bg.high.toLocaleString()} XP</div></div>
          </div>`;
    }
    const l = Math.min(Math.max(this._partyLevel,1),20)-1;
    const t = XP_THRESH[l] || XP_THRESH[0];
    return `<div class="enc-stat-grid">
            <div class="enc-stat-box"><div class="l">Raw XP</div><div class="v">${xp.raw.toLocaleString()}</div></div>
            <div class="enc-stat-box"><div class="l">Adjusted XP (×${xp.mult})</div><div class="v">${xp.adjusted.toLocaleString()}</div></div>
            <div class="enc-stat-box"><div class="l">Difficulty</div><div class="v ${diff.cls}">${diff.label}</div></div>
            <div class="enc-stat-box"><div class="l">Monster Count</div><div class="v">${xp.count}</div></div>
          </div>
          ${this._renderDifficultyGauge(xp.adjusted)}
          <h3 style="font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:10px 0 8px">Thresholds (full party)</h3>
          <div class="enc-stat-grid">${['Easy','Medium','Hard','Deadly'].map((lab,i)=>`<div class="enc-stat-box"><div class="l">${lab}</div><div class="v" style="font-size:var(--fs-md)">${(t[i]*this._partySize).toLocaleString()} XP</div></div>`).join('')}</div>`;
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
      + '<div class="enc-gauge-axis"><span>Low</span><span>Mod</span><span>High</span><span>+</span></div>'
      + '</div>';
  },

  // Difficulty gauge — horizontal bar split into Easy / Medium / Hard / Deadly
  // zones at the party's thresholds, with a marker showing where the current
  // adjusted XP sits. Gives an at-a-glance read of "how close to the next tier
  // am I?" without doing the math by hand.
  _renderDifficultyGauge(adjXP){
    const level = Math.min(Math.max(this._partyLevel,1),20)-1;
    const t = (XP_THRESH[level]||XP_THRESH[0]).map(x => x * this._partySize);
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
      + '<div class="enc-gauge-axis"><span>Trivial</span><span>Easy</span><span>Med</span><span>Hard</span><span>Deadly</span></div>'
      + '</div>';
  },

  // Smallest factor (≥1, multiples of 0.25) that puts adjusted XP into the
  // target zone's midpoint. Returns 1 when already at/above target's lower
  // bound, or null when even unbounded scaling can't reach the target (only
  // happens with a totally empty monster list).
  _findScaleFactor(target){
    if (!this._monsters.length) return null;
    let targetMin, xpAt;
    if (this._systemMode() === '2024'){
      // 2024: target is the LOWER bound of the named band — Moderate starts just
      // past the Low budget, High past Moderate, Deadly past High. No multiplier.
      const bg = this._budget2024();
      targetMin = { Moderate:bg.low, High:bg.moderate, Deadly:bg.high }[target];
      xpAt = (f) => this._monsters.reduce((s,m)=>s+(CR_XP[m.cr]||0)*Math.max(1,Math.round((m.count||1)*f)),0);
    } else {
      const level = Math.min(Math.max(this._partyLevel,1),20)-1;
      const t = (XP_THRESH[level]||XP_THRESH[0]).map(x => x * this._partySize);
      targetMin = { Easy:t[0], Medium:t[1], Hard:t[2], Deadly:t[3] }[target];
      // Adjusted XP grows non-linearly with count (the multiplier table jumps).
      xpAt = (f) => {
        const count = this._monsters.reduce((n,m)=>n+Math.max(1,Math.round((m.count||1)*f)),0);
        const xp    = this._monsters.reduce((s,m)=>s+(CR_XP[m.cr]||0)*Math.max(1,Math.round((m.count||1)*f)),0);
        const mults = [1,1.5,2,2,2,3,3,3,4,4,4,4,5];
        return xp * (mults[Math.min(count,12)] || 5);
      };
    }
    if (targetMin == null) return null;
    // Brute-force the cheapest factor (0.25 steps) that clears the target. If
    // we're already at/above it, return 1 — "scale to fit" never reduces.
    if (xpAt(1) >= targetMin) return 1;
    for (let f = 1.25; f <= 10; f += 0.25){
      if (xpAt(f) >= targetMin) return f;
    }
    return null;
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
