// ============================================================
// PARTY PANEL
// ============================================================
const PARTY_ICONS=['⚔','🗡','🏹','🪄','🔮','🛡','🪓','👊','🌿','🎵','🔥','❄️','⚡','☀','🌙','💀','🐉','🦅','🐺','🌊','📿','🏺','🎭','🌟','💎','🩸','🦴','🌀','👁','🗝'];

registerPanel('party',{
  title:'Party Tracker',icon:'♥',
  _pickerOpen:null, // idx of card with open icon picker
  // UI-only state (not synced) keyed by character id.
  _expanded:{},
  _activeTab:{}, // 'stats' | 'skills' | 'spells' | 'inventory' | 'bio'
  mount(body){this._body=body;this._render();},
  unmount(){this._body=null;},

  _render(){
    const b=this._body;if(!b)return;
    b.innerHTML='<div class="party-grid">'+state.party.map((c,i)=>this._card(c,i)).join('')+'</div>'
      +'<div style="padding:0 10px 10px;display:flex;gap:6px">'
      +'<button class="btn small" data-act="add">+ Add character</button>'
      +'<button class="btn small" data-act="import-pdf" title="Import a D&D Beyond character sheet">📄 Import PDF</button>'
      +'</div>';
    this._wire();
  },

  _card(c,i){
    const icon=c.icon||'⚔';
    const hpPct=c.hpMax>0?Math.max(0,Math.min(100,(c.hp/c.hpMax)*100)):0;
    const hpColor=hpPct>50?'#6b9e6b':hpPct>25?'#c9a050':'#c25450';
    const resources=c.resources||[];

    let resHtml='';
    if(resources.length){
      resHtml='<div class="resource-section"><div class="resource-section-head"><span>Resources</span>'
        +'<button class="btn small" data-act="add-res" data-idx="'+i+'" style="font-size:9px;padding:1px 5px">+ Add</button></div>';
      resources.forEach((r,ri)=>{
        const pips=r.type==='pool'?r.max:1;
        let pipHtml='<div class="resource-pips">';
        for(let p=0;p<pips;p++){
          pipHtml+='<div class="pip '+(p<r.current?'filled':'')+'" data-act="pip" data-idx="'+i+'" data-ri="'+ri+'" data-pi="'+p+'"></div>';
        }
        pipHtml+='</div>';
        resHtml+='<div class="resource-row">'
          +'<span class="resource-label" title="'+esc(r.name)+'">'+esc(r.name)+'</span>'
          +pipHtml
          +'<button class="btn icon-btn" data-act="del-res" data-idx="'+i+'" data-ri="'+ri+'" style="font-size:10px;padding:0 4px;opacity:.5">×</button>'
          +'</div>';
      });
      resHtml+='</div>';
    } else {
      resHtml='<button class="btn small" data-act="add-res" data-idx="'+i+'" style="font-size:9px;padding:2px 6px;align-self:flex-start">+ Add resource</button>';
    }

    return '<div class="char-card" data-cidx="'+i+'" draggable="true" title="Drag to Combat Tracker to add to combat">'
      // Header: icon + name + remove
      +'<div class="char-header" style="position:relative">'
        +'<button class="char-icon-btn" data-act="icon-btn" data-idx="'+i+'" title="Change icon">'+renderIcon(icon, c.name)+'</button>'
        +(this._pickerOpen===i?this._iconPicker(i):'')
        +'<input class="char-name" value="'+esc(c.name)+'" data-field="name" data-idx="'+i+'" placeholder="Character name">'
        +'<button class="btn icon-btn danger" data-act="remove" data-idx="'+i+'" title="Remove character" style="flex-shrink:0">×</button>'
      +'</div>'
      // HP block
      +'<div class="char-hp-block">'
        +'<div class="char-hp-row">'
          +'<input class="char-hp-current" type="number" value="'+c.hp+'" data-field="hp" data-idx="'+i+'" title="Current HP">'
          +'<span class="char-hp-sep">/</span>'
          +'<input class="char-hp-max" type="number" value="'+c.hpMax+'" data-field="hpMax" data-idx="'+i+'" title="Max HP">'
          +'<span style="font-size:10px;color:var(--text-dim);margin-left:auto">HP</span>'
        +'</div>'
        +'<div class="hp-bar-wrap"><div class="hp-bar-fill" style="width:'+hpPct+'%;background:'+hpColor+'"></div></div>'
      +'</div>'
      // Stats: AC, Init, Spd, PP
      +'<div class="char-stats-row">'
        +'<div class="char-stat"><div class="l">⛨ AC</div><input type="number" value="'+c.ac+'" data-field="ac" data-idx="'+i+'"></div>'
        +'<div class="char-stat"><div class="l">⚡ Init</div><input type="number" value="'+c.init+'" data-field="init" data-idx="'+i+'"></div>'
        +'<div class="char-stat"><div class="l">Spd</div><input type="number" value="'+c.spd+'" data-field="spd" data-idx="'+i+'"></div>'
      +'</div>'
      // Hit dice — only shown when the character has hitDice info from PDF import.
      +this._hitDiceRow(c,i)
      // Resources
      +resHtml
      // Inspiration row: Heroic (the original generic toggle) + Bardic
      +'<div class="inspiration-pair">'
        +'<div class="inspiration-row '+(c.inspiration?'has-inspiration':'')+'" data-act="insp" data-idx="'+i+'" title="Heroic Inspiration · right-click for award reasons">'
          +'<div class="inspiration-toggle"></div><span>Heroic</span>'
        +'</div>'
        +'<div class="inspiration-row '+(c.bardicInspiration?'has-inspiration bardic':'')+'" data-act="bardic-insp" data-idx="'+i+'" title="Bardic Inspiration">'
          +'<div class="inspiration-toggle"></div><span>Bardic</span>'
        +'</div>'
      +'</div>'
      // Full character sheet — collapsed by default; expand to see tabs.
      + this._sheetSection(c, i)
    +'</div>';
  },

  // ------------------------------------------------------------------
  // Character sheet (Phase 2): tabbed view of skills / spells / inventory / bio
  // ------------------------------------------------------------------
  _sheetSection(c, i){
    const has = !!c.sheet;
    const expanded = !!this._expanded[c.id];
    const toggleLabel = expanded ? '▲ Hide character sheet' : (has ? '▼ Show character sheet' : '▼ Show character sheet (no PDF imported)');
    return '<button class="sheet-toggle" data-act="toggle-sheet" data-idx="'+i+'">'+toggleLabel+'</button>'
      + (expanded ? this._sheetBody(c, i) : '');
  },

  _sheetBody(c, i){
    const tabs = ['stats','skills','spells'];
    const labels = {stats:'Stats', skills:'Skills', spells:'Spells'};
    let active = this._activeTab[c.id] || 'stats';
    if (!tabs.includes(active)) active = 'stats';
    const tabBar = tabs.map(t =>
      `<button class="sheet-tab ${t===active?'active':''}" data-act="sheet-tab" data-idx="${i}" data-tab="${t}">${labels[t]}</button>`
    ).join('');
    let body = '';
    if (active === 'stats')      body = this._tabStats(c);
    else if (active === 'skills')body = this._tabSkills(c);
    else if (active === 'spells')body = this._tabSpells(c);
    return `<div class="sheet-body">
      <div class="sheet-tabs">${tabBar}</div>
      <div class="sheet-content">${body}</div>
    </div>`;
  },

  _abilityBlock(c){
    const ab = c.abilities || {};
    const order = [['str','STR'],['dex','DEX'],['con','CON'],['int','INT'],['wis','WIS'],['cha','CHA']];
    return '<div class="sheet-abilities">' + order.map(([k,lbl])=>{
      const v = ab[k];
      const mod = (typeof v === 'number') ? Math.floor((v-10)/2) : null;
      return `<div class="sheet-ab"><div class="sheet-ab-lbl">${lbl}</div><div class="sheet-ab-val">${v??'—'}</div><div class="sheet-ab-mod">${mod==null?'':(mod>=0?'+':'')+mod}</div></div>`;
    }).join('') + '</div>';
  },

  _tabStats(c){
    const sh = c.sheet || {};
    const saveDefs = [['str','STR'],['dex','DEX'],['con','CON'],['int','INT'],['wis','WIS'],['cha','CHA']];
    const ab = c.abilities || {};
    const saves = sh.saves || {};
    const saveRows = saveDefs.map(([k,lbl])=>{
      // Prefer imported save bonus; else compute from ability mod.
      let v = saves[k];
      if (v == null && typeof ab[k]==='number') v = Math.floor((ab[k]-10)/2);
      return `<div class="sheet-stat-row"><span>${lbl} Save</span><span class="sheet-stat-val">${v==null?'—':(v>=0?'+':'')+v}</span></div>`;
    }).join('');
    const prof = sh.profBonus;
    const pp = sh.passivePerception;
    const dexMod = (typeof ab.dex==='number') ? Math.floor((ab.dex-10)/2) : null;
    const computedPP = (typeof ab.wis==='number') ? 10+Math.floor((ab.wis-10)/2) : null;
    return this._abilityBlock(c)
      + '<div class="sheet-grid2">'
      + '<div class="sheet-col"><h5>Saving Throws</h5>'+saveRows+'</div>'
      + '<div class="sheet-col"><h5>Vitals</h5>'
      +   `<div class="sheet-stat-row"><span>Proficiency</span><span class="sheet-stat-val">${prof==null?'—':'+'+prof}</span></div>`
      +   `<div class="sheet-stat-row"><span>Passive Perception</span><span class="sheet-stat-val">${pp ?? computedPP ?? '—'}</span></div>`
      +   `<div class="sheet-stat-row"><span>Initiative</span><span class="sheet-stat-val">${(c.init>=0?'+':'')+(c.init??0)}</span></div>`
      +   `<div class="sheet-stat-row"><span>Speed</span><span class="sheet-stat-val">${c.spd ?? '—'}</span></div>`
      +   `<div class="sheet-stat-row"><span>AC</span><span class="sheet-stat-val">${c.ac ?? '—'}</span></div>`
      + '</div>'
      + '</div>'
      + (sh.languages ? this._renderLanguages(sh.languages) : '')
      + (sh.attacks?.length ? this._renderAttacks(sh.attacks) : '');
  },

  // Split a free-text "languages & proficiencies" blob into categorized chip
  // groups. Recognizes either:
  //   • Labelled lines: "Languages: Common, Elvish\nArmor: Light, Medium"
  //   • Heuristic categorization based on known keywords for unlabelled text.
  _renderLanguages(text){
    const raw = String(text || '').trim();
    if (!raw) return '';
    // Try labelled-line format first.
    const lines = raw.split(/\r?\n+/).map(l=>l.trim()).filter(Boolean);
    const groups = {};
    let usedLabelled = false;
    lines.forEach(line => {
      const m = line.match(/^([^:]+):\s*(.+)$/);
      if (m){
        usedLabelled = true;
        const cat = m[1].trim();
        const items = m[2].split(/[,;]/).map(s=>s.trim()).filter(Boolean);
        groups[cat] = (groups[cat]||[]).concat(items);
      } else if (!usedLabelled){
        // Defer; fall back to heuristic
      }
    });
    if (!usedLabelled){
      // Flatten everything to a single token list, then bucket by keyword.
      // Strip out section-marker tokens like "=== LANGUAGES ===" — the chip
      // group labels already serve as headers.
      const tokens = raw.split(/[,;\n]/).map(s=>s.trim())
        .filter(Boolean)
        .filter(t => !/^=+\s*.+?\s*=+$/.test(t));
      const buckets = { Languages:[], Armor:[], Weapons:[], Tools:[], Other:[] };
      const KNOWN_LANGS = /^(common|dwarvish|elvish|giant|gnomish|goblin|halfling|orc|abyssal|celestial|draconic|deep speech|infernal|primordial|sylvan|undercommon|aarakocra|sign language|thieves|druidic|aquan|auran|ignan|terran)/i;
      const ARMOR_KW = /armor|shield/i;
      const WEAPON_KW = /weapon|crossbow|sword|bow|axe|hammer|spear|whip|mace|flail|club|dagger|firearm|simple|martial/i;
      const TOOL_KW = /tools?|kit|instrument|gaming|smith|brewer|carpenter|cook|disguise|forgery|herbalism|navigator|painter|poisoner|tinker|pottery|jeweler|leatherworker|mason|cartographer|cobbler|glassblower|weaver|woodcarver|thieves'?\s*tools|musical/i;
      tokens.forEach(t => {
        if (!t) return;
        if (KNOWN_LANGS.test(t)) buckets.Languages.push(t);
        else if (ARMOR_KW.test(t)) buckets.Armor.push(t);
        else if (WEAPON_KW.test(t)) buckets.Weapons.push(t);
        else if (TOOL_KW.test(t)) buckets.Tools.push(t);
        else buckets.Other.push(t);
      });
      Object.entries(buckets).forEach(([k, arr]) => { if (arr.length) groups[k] = arr; });
    }
    // Hide empty Other if there's at least one categorized group.
    if (groups.Other && Object.keys(groups).length > 1 && !groups.Other.length) delete groups.Other;
    if (!Object.keys(groups).length) return '';
    const html = Object.entries(groups).map(([cat, arr]) => {
      const chips = arr.map(x => `<span class="prof-chip">${esc(x)}</span>`).join('');
      return `<div class="prof-group"><div class="prof-group-label">${esc(cat)}</div><div class="prof-chips">${chips}</div></div>`;
    }).join('');
    return `<div class="sheet-block"><h5>Languages &amp; Proficiencies</h5>${html}</div>`;
  },

  _renderAttacks(attacks){
    const rows = attacks.map(a =>
      `<tr><td>${esc(a.name)}</td><td>${esc(a.atkBonus||'—')}</td><td>${esc(a.damage||'—')}</td></tr>`
    ).join('');
    return `<div class="sheet-block"><h5>Attacks</h5>
      <table class="sheet-table">
        <thead><tr><th>Name</th><th>Atk</th><th>Damage</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  },

  _tabSkills(c){
    const sh = c.sheet || {};
    const skills = sh.skills || {};
    const ab = c.abilities || {};
    // Skill → governing ability (for the "fallback to ability mod" path)
    const SKILL_AB = {
      acrobatics:'dex', animalHandling:'wis', arcana:'int', athletics:'str',
      deception:'cha', history:'int', insight:'wis', intimidation:'cha',
      investigation:'int', medicine:'wis', nature:'int', perception:'wis',
      performance:'cha', persuasion:'cha', religion:'int',
      sleightOfHand:'dex', stealth:'dex', survival:'wis',
    };
    const LABELS = {
      acrobatics:'Acrobatics (DEX)', animalHandling:'Animal Handling (WIS)',
      arcana:'Arcana (INT)', athletics:'Athletics (STR)', deception:'Deception (CHA)',
      history:'History (INT)', insight:'Insight (WIS)', intimidation:'Intimidation (CHA)',
      investigation:'Investigation (INT)', medicine:'Medicine (WIS)', nature:'Nature (INT)',
      perception:'Perception (WIS)', performance:'Performance (CHA)', persuasion:'Persuasion (CHA)',
      religion:'Religion (INT)', sleightOfHand:'Sleight of Hand (DEX)',
      stealth:'Stealth (DEX)', survival:'Survival (WIS)',
    };
    const keys = Object.keys(LABELS);
    const rows = keys.map(k => {
      let v = skills[k];
      if (v == null){
        const a = ab[SKILL_AB[k]];
        v = (typeof a === 'number') ? Math.floor((a-10)/2) : null;
      }
      return `<div class="sheet-stat-row"><span>${LABELS[k]}</span><span class="sheet-stat-val">${v==null?'—':(v>=0?'+':'')+v}</span></div>`;
    }).join('');
    return '<div class="sheet-skills">'+rows+'</div>';
  },

  _tabSpells(c){
    const sh = c.sheet || {};
    const slots = sh.spellSlots || {};
    const lvls = Object.keys(slots).map(n=>parseInt(n)).sort((a,b)=>a-b);
    let slotsHtml = '';
    if (lvls.length){
      slotsHtml = '<div class="sheet-block"><h5>Spell Slots</h5><div class="sheet-slots">'
        + lvls.map(l=>{
            const s = slots[l];
            const total = s.total||0, expended = s.expended||0;
            let pips = '';
            for (let n=1; n<=total; n++) pips += `<span class="slot-pip ${n<=total-expended?'available':'spent'}"></span>`;
            return `<div class="sheet-slot-row"><span class="slot-lvl">L${l}</span>${pips}<span class="slot-count">${total-expended}/${total}</span></div>`;
          }).join('')
        + '</div></div>';
    }
    let metaHtml = '';
    if (sh.spellSaveDc != null || sh.spellAtkBonus != null){
      metaHtml = '<div class="sheet-block"><h5>Spellcasting</h5>'
        + (sh.spellSaveDc!=null ? `<div class="sheet-stat-row"><span>Save DC</span><span class="sheet-stat-val">${sh.spellSaveDc}</span></div>` : '')
        + (sh.spellAtkBonus!=null ? `<div class="sheet-stat-row"><span>Attack Bonus</span><span class="sheet-stat-val">${sh.spellAtkBonus>=0?'+':''}${sh.spellAtkBonus}</span></div>` : '')
        + '</div>';
    }
    let listHtml = '';
    if (sh.spells?.length){
      listHtml = '<div class="sheet-block"><h5>Known Spells (' + sh.spells.length + ')</h5><div class="sheet-spell-list">'
        + sh.spells.map(s=>`<span class="sheet-spell-chip">${esc(s)}</span>`).join('')
        + '</div></div>';
    }
    if (!slotsHtml && !metaHtml && !listHtml){
      return '<div class="sheet-empty">No spell data in the imported PDF.</div>';
    }
    return metaHtml + slotsHtml + listHtml;
  },



  _iconPicker(i){
    return '<div class="icon-picker" data-picker="'+i+'">'
      +'<button class="icon-upload-btn" data-act="upload-icon" data-idx="'+i+'" title="Upload custom image">📷</button>'
      +PARTY_ICONS.map(ic=>'<button data-act="set-icon" data-idx="'+i+'" data-icon="'+ic+'">'+ic+'</button>').join('')
      +'</div>';
  },

  // Modal to manage the list of inspiration award reasons. Reasons are stored
  // in state.settings.inspirationReasons and synced via the workspace key.
  _manageInspirationReasons(){
    if (!state.settings.inspirationReasons) state.settings.inspirationReasons = [];
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const renderList = () => state.settings.inspirationReasons.map((r,i) =>
      `<div class="qn-row"><input class="qn-input" data-i="${i}" value="${esc(r)}"><button class="btn icon-btn danger" data-rm="${i}" title="Remove">×</button></div>`
    ).join('') || '<div style="color:var(--text-muted);font-size:11px;padding:8px 0">No reasons yet — add one below.</div>';
    const renderModal = () => {
      backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="min-width:340px">
        <h3>Inspiration Award Reasons</h3>
        <p style="color:var(--text-muted);font-size:11px;margin:0 0 10px">Right-click the Heroic Inspiration toggle on a party card to pick from this list. Award reasons are reminders for you — they show up as a toast when used.</p>
        <div class="qn-list">${renderList()}</div>
        <div class="qn-add-row">
          <input class="qn-add-input" placeholder="New reason (e.g. Saved an NPC)" autocomplete="off">
          <button class="btn primary" id="qn-add-btn">+ Add</button>
        </div>
        <div class="modal-actions" style="margin-top:14px">
          <button class="btn" id="qn-done">Done</button>
        </div>
      </div>`;
      wire();
    };
    const wire = () => {
      backdrop.querySelectorAll('input.qn-input').forEach(inp => inp.addEventListener('change', e => {
        const i = +e.target.dataset.i;
        const v = String(e.target.value).trim();
        if (!v) state.settings.inspirationReasons.splice(i,1);
        else    state.settings.inspirationReasons[i] = v;
        save();
        renderModal();
      }));
      backdrop.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        state.settings.inspirationReasons.splice(+btn.dataset.rm, 1);
        save();
        renderModal();
      }));
      const addInp = backdrop.querySelector('.qn-add-input');
      const addBtn = backdrop.querySelector('#qn-add-btn');
      const doAdd = () => {
        const v = String(addInp.value).trim();
        if (!v) return;
        if (state.settings.inspirationReasons.includes(v)){ addInp.value=''; return; }
        state.settings.inspirationReasons.push(v);
        save();
        renderModal();
        backdrop.querySelector('.qn-add-input')?.focus();
      };
      addBtn.addEventListener('click', doAdd);
      addInp.addEventListener('keydown', e => { if (e.key==='Enter'){ e.preventDefault(); doAdd(); } });
      backdrop.querySelector('#qn-done').addEventListener('click', () => backdrop.remove());
    };
    document.body.appendChild(backdrop);
    renderModal();
    backdrop.addEventListener('mousedown', e => { if (e.target===backdrop) backdrop.remove(); });
    setTimeout(() => backdrop.querySelector('.qn-add-input')?.focus(), 30);
  },

  _spendHitDie(i){
    const c = state.party[i]; if (!c || !c.hitDice || c.hitDice.current <= 0) return;
    const conMod = (c.abilities && typeof c.abilities.con === 'number') ? Math.floor((c.abilities.con-10)/2) : 0;
    const sides = parseInt(String(c.hitDice.dieType||'d8').replace('d','')) || 8;
    showConfirm(`Spend 1 ${c.hitDice.dieType||'d8'} hit die? You'll roll ${c.hitDice.dieType||'d8'} + ${conMod>=0?'+':''}${conMod} (CON) and heal that much.`,
      {title:'Spend hit die', confirmLabel:'Roll & Heal'}).then(ok => {
        if (!ok) return;
        const roll = Math.floor(Math.random()*sides) + 1;
        const heal = Math.max(1, roll + conMod); // can't go below 1 even with negative CON
        c.hitDice.current -= 1;
        c.hp = Math.min(c.hpMax, (c.hp||0) + heal);
        save();
        syncPartyToCombat(i);
        this._render();
        showToast(`Rolled ${roll}+${conMod>=0?'+':''}${conMod} = ${heal} HP`);
      });
  },

  // Render the hit-dice pip row when the character has imported hit dice.
  // Pips left-to-right represent current → max. Click a filled pip to spend
  // one (rolls dieType + CON modifier and adds to current HP).
  _hitDiceRow(c, i){
    const hd = c.hitDice;
    if (!hd || !hd.max) return '';
    const cur = Math.max(0, Math.min(hd.max, hd.current ?? hd.max));
    let pips = '';
    for (let n = 1; n <= hd.max; n++){
      pips += `<span class="hd-pip ${n<=cur?'filled':''}" data-act="hd-spend" data-idx="${i}" data-n="${n}" title="${n<=cur?'Spend a hit die':'Already spent'}"></span>`;
    }
    return `<div class="hd-row">
      <span class="hd-label">🎲 ${esc(hd.dieType||'d8')}</span>
      <span class="hd-pips">${pips}</span>
      <span class="hd-count">${cur}/${hd.max}</span>
      <button class="btn small" data-act="hd-rest" data-idx="${i}" title="Long rest — restore hit dice">🛌 Rest</button>
    </div>`;
  },

  _wire(){
    const b=this._body;if(!b)return;
    // Drag a party card → drop on Combat Tracker to add to combat. Suppress
    // drag when grabbing inputs/buttons so text selection still works.
    b.querySelectorAll('.char-card').forEach(card=>{
      card.addEventListener('dragstart', e=>{
        if (e.target.closest('input,select,textarea,button,.icon-picker,.pip')){ e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-skt-party-pi', card.dataset.cidx);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', ()=>card.classList.remove('dragging'));
      // Right-click the Heroic Inspiration row to award via a pre-set reason.
      const inspRow = card.querySelector('[data-act="insp"]');
      inspRow?.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        const idx = +card.dataset.cidx;
        const reasons = state.settings?.inspirationReasons || [];
        const items = reasons.map(r => ({
          label: r,
          onClick: () => {
            state.party[idx] = {...state.party[idx], inspiration: true};
            save();
            this._render();
            showToast('Inspiration: ' + r);
          },
        }));
        items.push({ label: '✏ Edit reasons…', onClick: () => this._manageInspirationReasons() });
        showContextMenu(e.clientX, e.clientY, items);
      });
      // Drag-reorder: dropping a party card onto another party card
      // moves it to that position. The same drag still works for cross-panel
      // drops (combat tracker, battle map) — those panels listen on their own
      // bodies, so a drop on a .char-card never reaches them.
      card.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes('application/x-skt-party-pi')) return;
        e.preventDefault();
        const r = card.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        card.classList.toggle('drop-before', before);
        card.classList.toggle('drop-after', !before);
      });
      card.addEventListener('dragleave', () => card.classList.remove('drop-before','drop-after'));
      card.addEventListener('drop', e => {
        card.classList.remove('drop-before','drop-after');
        const fromStr = e.dataTransfer.getData('application/x-skt-party-pi');
        if (!fromStr) return;
        const from = parseInt(fromStr);
        const to0 = parseInt(card.dataset.cidx);
        const r = card.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        let to = to0 + (before ? 0 : 1);
        // Ignore no-op drops (onto self or on the immediate boundary)
        if (from === to0 || from === to0 + (before ? -1 : 0)) return;
        if (from < to) to -= 1; // splice-from-earlier-index correction
        e.preventDefault(); e.stopPropagation();
        const [moved] = state.party.splice(from, 1);
        state.party.splice(to, 0, moved);
        save(); this._render();
      });
    });
    // Inputs
    b.querySelectorAll('input[data-field]').forEach(inp=>{
      inp.addEventListener('change',e=>{
        const i=+e.target.dataset.idx, f=e.target.dataset.field;
        let v=e.target.value;
        if(['hp','hpMax','ac','init','spd'].includes(f))v=parseInt(v)||0;
        state.party[i]={...state.party[i],[f]:v};
        // Mirror to the combat slot BEFORE saving so localStorage (and the
        // resulting Firebase push) captures both halves in one write. If the
        // sync happened after save(), the persisted value would be stale and
        // a later save anywhere could push the old combatants back out.
        if(['hp','hpMax','ac'].includes(f))syncPartyToCombat(i);
        save();
        // Re-render just this card's HP bar without full re-render
        if(f==='hp'||f==='hpMax'){
          const card=b.querySelector('[data-cidx="'+i+'"]');
          if(card){
            const p=state.party[i];
            const pct=p.hpMax>0?Math.max(0,Math.min(100,(p.hp/p.hpMax)*100)):0;
            const col=pct>50?'#6b9e6b':pct>25?'#c9a050':'#c25450';
            const bar=card.querySelector('.hp-bar-fill');
            if(bar){bar.style.width=pct+'%';bar.style.background=col;}
          }
        }
      });
      inp.addEventListener('click',e=>e.stopPropagation());
    });

    // Actions
    b.querySelectorAll('[data-act]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      const act=el.dataset.act, i=+el.dataset.idx;
      if(act==='remove'){
        showModal('Remove '+state.party[i].name+'?',[],'Remove')
          .then(r=>{if(r===null)return;state.party.splice(i,1);save();this._render();});
      }
      else if(act==='insp'){state.party[i]={...state.party[i],inspiration:!state.party[i].inspiration};save();this._render();}
      else if(act==='bardic-insp'){state.party[i]={...state.party[i],bardicInspiration:!state.party[i].bardicInspiration};save();this._render();}
      else if(act==='add'){
        state.party.push({id:uid(),name:'New Character',cls:'fighter',icon:'⚔',hp:30,hpMax:30,ac:14,init:0,spd:30,pp:10,inspiration:false,resources:[]});
        save();this._render();
      }
      else if(act==='import-pdf'){
        this._importPdf();
      }
      else if(act==='toggle-sheet'){
        const c = state.party[i]; if (!c) return;
        this._expanded[c.id] = !this._expanded[c.id];
        this._render();
      }
      else if(act==='sheet-tab'){
        const c = state.party[i]; if (!c) return;
        this._activeTab[c.id] = el.dataset.tab;
        this._render();
      }
      else if(act==='hd-spend'){
        const idx = +el.dataset.idx, n = +el.dataset.n;
        const c = state.party[idx]; if (!c || !c.hitDice) return;
        if (n > c.hitDice.current) return; // empty pip — ignore
        this._spendHitDie(idx);
      }
      else if(act==='hd-rest'){
        const idx = +el.dataset.idx;
        const c = state.party[idx]; if (!c || !c.hitDice) return;
        c.hitDice.current = c.hitDice.max;
        c.hp = c.hpMax; // long rest also restores HP fully
        save(); this._render();
        syncPartyToCombat(idx);
        showToast(c.name + ' took a long rest');
      }
      else if(act==='icon-btn'){
        this._pickerOpen=this._pickerOpen===i?null:i;
        this._render();
      }
      else if(act==='set-icon'){
        state.party[i]={...state.party[i],icon:el.dataset.icon};
        this._pickerOpen=null;save();this._render();
        panelDefs.combat?._render?.();
      }
      else if(act==='upload-icon'){
        // Trigger a hidden file input — keep picker open until upload finishes
        const inp=document.createElement('input');
        inp.type='file'; inp.accept='image/*';
        inp.addEventListener('change',async ev=>{
          const f=ev.target.files[0]; if(!f) return;
          try {
            const dataUrl = await showCropModal(f, {size:96, shape:'circle', title:'Crop character icon'});
            if (!dataUrl) return; // user cancelled
            state.party[i]={...state.party[i],icon:dataUrl};
            this._pickerOpen=null; save(); this._render();
            panelDefs.combat?._render?.();
            showToast('Icon uploaded');
          } catch(err){ showToast('Upload failed: '+err.message); }
        });
        inp.click();
      }
      else if(act==='pip'){
        const ri=+el.dataset.ri, pi=+el.dataset.pi;
        const res=[...state.party[i].resources];
        const r={...res[ri]};
        // Toggle: clicking a filled pip unfills it and all after; clicking empty fills up to it
        r.current=pi<r.current?pi:pi+1;
        res[ri]=r;
        state.party[i]={...state.party[i],resources:res};
        save();this._render();
      }
      else if(act==='del-res'){
        const res=state.party[i].resources.filter((_,ri)=>ri!==+el.dataset.ri);
        state.party[i]={...state.party[i],resources:res};save();this._render();
      }
      else if(act==='add-res'){
        showModal('Add Resource',[
          {id:'name',label:'Name',type:'text',value:'',placeholder:'Spell Slots L1, Rage, Focus Points...'},
          {id:'max', label:'Max uses',type:'number',value:4,min:1,max:99},
          {id:'type',label:'Type',type:'select',value:'pool',options:[
            {value:'pool',  label:'Pool (multiple uses, click pips to spend)'},
            {value:'toggle',label:'Toggle (single on/off)'},
          ]},
        ],'Add').then(r=>{
          if(!r||!r.name)return;
          const res=[...(state.party[i].resources||[])];
          res.push({name:r.name,type:r.type==='toggle'?'toggle':'pool',current:parseInt(r.max)||1,max:parseInt(r.max)||1});
          state.party[i]={...state.party[i],resources:res};save();this._render();
        });
      }
    }));

    // Close icon picker when clicking outside
    b.addEventListener('click',()=>{if(this._pickerOpen!==null){this._pickerOpen=null;this._render();}});
  },

  // PDF import flow: file picker → parseDDBeyondPdf → preview modal → apply.
  // Pulls in fields from a D&D Beyond character sheet PDF and writes them to
  // an existing or new party slot. The preview modal is fully editable so the
  // user can correct any mis-extracted fields before saving.
  _importPdf(){
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/pdf';
    inp.addEventListener('change', async ev => {
      const f = ev.target.files[0]; if (!f) return;
      showToast('Reading PDF…');
      try {
        const data = await parseDDBeyondPdf(f);
        this._showPdfPreview(data);
      } catch(err){
        console.error(err);
        showToast('PDF parse failed: ' + (err?.message || 'unknown'));
      }
    });
    inp.click();
  },

  _showPdfPreview(data){
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const slotOptions = state.party.map((p,i) =>
      `<option value="${i}"${(data.name && p.name.toLowerCase() === data.name.toLowerCase()) ? ' selected' : ''}>${esc(p.name)}</option>`
    ).join('') + '<option value="new">— New character —</option>';
    const ab = data.abilities || {};
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:520px;max-width:92vw">
      <h3>Import character sheet</h3>
      <p style="color:var(--text-muted);font-size:11px;margin:0 0 12px">Review the values pulled from the PDF and pick which party slot to apply them to. Anything that didn't extract cleanly can be edited before saving.</p>
      <div class="modal-fields">
        <div class="modal-field"><label>Apply to</label><select id="pdf-slot">${slotOptions}</select></div>
        <div class="modal-field"><label>Name</label><input id="pdf-name" type="text" value="${esc(data.name||'')}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="modal-field"><label>Class</label><input id="pdf-cls" type="text" value="${esc(data.cls||'')}"></div>
          <div class="modal-field"><label>Level</label><input id="pdf-lvl" type="number" value="${data.level||1}" min="1" max="20"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="modal-field"><label>Race</label><input id="pdf-race" type="text" value="${esc(data.race||'')}"></div>
          <div class="modal-field"><label>Background</label><input id="pdf-bg" type="text" value="${esc(data.background||'')}"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
          <div class="modal-field"><label>HP</label><input id="pdf-hp" type="number" value="${data.hp??''}"></div>
          <div class="modal-field"><label>HP Max</label><input id="pdf-hpmax" type="number" value="${data.hpMax??''}"></div>
          <div class="modal-field"><label>AC</label><input id="pdf-ac" type="number" value="${data.ac??''}"></div>
          <div class="modal-field"><label>Speed</label><input id="pdf-spd" type="number" value="${data.speed??''}"></div>
        </div>
        <div class="modal-field"><label>Initiative bonus</label><input id="pdf-init" type="number" value="${data.init??''}"></div>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px">
          ${['str','dex','con','int','wis','cha'].map(k=>`<div class="modal-field"><label>${k.toUpperCase()}</label><input id="pdf-${k}" type="number" value="${ab[k]??''}"></div>`).join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="pdf-cancel">Cancel</button>
        <button class="btn primary" id="pdf-apply">Apply</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const close = ()=>backdrop.remove();
    backdrop.querySelector('#pdf-cancel').addEventListener('click', close);
    backdrop.addEventListener('mousedown', e=>{ if (e.target===backdrop) close(); });
    backdrop.addEventListener('keydown', e=>{ if (e.key==='Escape') close(); });
    backdrop.querySelector('#pdf-apply').addEventListener('click', () => {
      const get = id => backdrop.querySelector('#'+id).value;
      const num = id => parseInt(get(id)) || 0;
      const slot = get('pdf-slot');
      const data2 = {
        name: get('pdf-name').trim() || 'New Character',
        cls: get('pdf-cls').trim().toLowerCase() || 'fighter',
        level: num('pdf-lvl') || 1,
        race: get('pdf-race').trim(),
        background: get('pdf-bg').trim(),
        hp: num('pdf-hp'),
        hpMax: num('pdf-hpmax') || num('pdf-hp'),
        ac: num('pdf-ac') || 10,
        spd: num('pdf-spd') || 30,
        init: num('pdf-init'),
        abilities: {
          str: num('pdf-str'), dex: num('pdf-dex'), con: num('pdf-con'),
          int: num('pdf-int'), wis: num('pdf-wis'), cha: num('pdf-cha'),
        },
        // Hit dice come straight from the parser — not exposed in the modal
        // since they're auto-derived from class + level.
        hitDice: data.hitDice || null,
        // Full character sheet payload (skills, saves, attacks, spells, bio…)
        // — surfaced via the expand-sheet toggle on each card.
        sheet: data.sheet || null,
      };
      if (slot === 'new'){
        state.party.push({
          id: uid(),
          icon: '⚔',
          pp: 10,
          inspiration: false, resources: [],
          ...data2,
        });
      } else {
        const i = parseInt(slot);
        const existing = state.party[i] || {};
        state.party[i] = { ...existing, ...data2 };
      }
      save();
      close();
      this._render();
      // Mirror HP/AC into combat slot if this PC is currently in combat.
      const idx = state.party.findIndex(p => p.name === data2.name);
      if (idx >= 0) syncPartyToCombat(idx);
      showToast('Imported: ' + data2.name);
    });
  },
});
