// ============================================================
// PARTY PANEL
// ============================================================
const PARTY_ICONS=['⚔','🗡','🏹','🪄','🔮','🛡','🪓','👊','🌿','🎵','🔥','❄️','⚡','☀','🌙','💀','🐉','🦅','🐺','🌊','📿','🏺','🎭','🌟','💎','🩸','🦴','🌀','👁','🗝'];

registerPanel('party',{
  title:'Party Tracker',icon:'♥',
  _pickerOpen:null, // idx of card with open icon picker
  // UI-only state (not synced) keyed by character id.
  _expanded:{},
  _activeTab:{}, // 'stats' | 'skills' | 'spells'
  mount(body){this._body=body;this._render();},
  unmount(){this._body=null;},
  // Items added to the window's ⋯ menu. Evaluated each time the menu opens
  // so labels/visibility can react to current party state.
  menuItems(){
    const items = [
      { label:'📋 Manage Party', run: () => this._openManageParty() },
      { label:'📄 Import PDF',   run: () => this._importPdf() },
    ];
    if (state.party.length){
      items.push({ label:'📊 Party Skills', run: () => this._openPartySkills() });
      // Rest actions live in the window menu now (instead of a top-of-panel
      // toolbar) so the panel itself stays card-focused. Long rest is a
      // destructive-ish action (overwrites HP / slots / hit dice / etc.) so
      // it gets a confirm; short rest is a softer touch.
      items.push({ label:'🛌 Long rest (party)',  run: () => this._longRestAll() });
      items.push({ label:'💤 Short rest (party)', run: () => this._shortRestAll() });
    }
    return items;
  },

  _render(){
    const b=this._body;if(!b)return;
    // Long rest / Short rest moved into the window-options menu (menuItems)
    // so the panel is card-only — no top toolbar competing with the grid.
    b.innerHTML = '<div class="party-grid">' + state.party.map((c,i)=>this._card(c,i)).join('') + '</div>';
    this._wire();
  },

  // Pull active conditions from the matching combat slot. PCs that aren't in
  // combat won't have a combatant entry — return empty in that case. Returns
  // empty string if there's nothing to show so it adds zero visual weight.
  // Active-conditions row. Conditions live on the combat slot when the PC
  // is in combat, OR on c.conditions as a fallback when they aren't (so the
  // DM can mark "frightened" during an RP scene without forcing them into
  // initiative). Both sets get unioned for display.
  //
  // Chips are clickable (remove that condition) and the "+ Cond" pill at
  // the end opens the picker — same condition list the combat tracker uses.
  _conditionsRow(c){
    if (!c || !c.id) return '';
    const i = state.party.findIndex(p => p.id === c.id);
    const co = (typeof state !== 'undefined' && state.combatants)
      ? state.combatants.find(x => x.id === c.id)
      : null;
    // Union of combat-slot conditions + party-side conditions. dedupe.
    const seen = new Set();
    const conds = [];
    (co?.conditions || []).forEach(n => { if (!seen.has(n)){ seen.add(n); conds.push(n); }});
    (c.conditions || []).forEach(n => { if (!seen.has(n)){ seen.add(n); conds.push(n); }});
    // Even with no active conditions we still show the "+ Cond" picker pill
    // so adding a condition is one click. Empty pill is dashed/muted so it
    // doesn't compete visually.
    const chips = conds.map(name =>
      `<span class="cond-chip" data-act="cond-remove" data-idx="${i}" data-cond="${esc(name)}" title="Remove ${esc(name)}">${esc(name)} <span class="cond-chip-x">×</span></span>`
    ).join('');
    const addPill = `<span class="cond-chip add" data-act="cond-add" data-idx="${i}" title="Add a condition (frightened, poisoned, prone, …)">+ Cond</span>`;
    return `<div class="char-conditions" title="Active conditions — click a chip to remove, + to add">${chips}${addPill}</div>`;
  },

  // Status pills: concentration + exhaustion. Always rendered so the
  // controls are always reachable; pills change appearance based on state.
  //
  // Concentration: stored as a string on c.concentration (spell name).
  //   • Empty → "🌀 +" pill, click prompts for spell name.
  //   • Set   → "🌀 Bless ×" pill, click drops concentration.
  //
  // Exhaustion: stored as an integer 0–6 on c.exhaustion (per 2024 rules).
  //   • Level 0 → "+ Exh" hint button, click bumps to 1.
  //   • Level ≥1 → "⚠ Exh: N − +" with stepper buttons.
  _statusRow(c, i){
    const conc = c.concentration || '';
    const exh = +c.exhaustion || 0;
    const concHtml = conc
      ? `<button class="status-pill conc active" data-act="conc-drop" data-idx="${i}" title="Concentrating on ${esc(conc)} — click to drop">🌀 ${esc(conc)} <span class="status-pill-x">×</span></button>`
      : `<button class="status-pill conc" data-act="conc-set" data-idx="${i}" title="Set what this character is concentrating on">🌀 <span class="status-pill-hint">Concentration</span></button>`;
    const exhHtml = exh > 0
      ? `<div class="status-pill exh active" title="Exhaustion level (1–6, 2024 rules: each level = −2 to d20 rolls and −5 ft speed; 6 = death)">
          <span class="status-pill-label">⚠ Exh: ${exh}</span>
          <button class="status-pill-step" data-act="exh-down" data-idx="${i}" title="Decrease">−</button>
          <button class="status-pill-step" data-act="exh-up" data-idx="${i}" title="Increase">+</button>
         </div>`
      : `<button class="status-pill exh" data-act="exh-up" data-idx="${i}" title="Apply exhaustion">⚠ <span class="status-pill-hint">Exhaustion</span></button>`;
    return `<div class="char-status-row">${concHtml}${exhHtml}</div>`;
  },

  // HP bar visual: clamp 0–100% normally, but flag a "surplus" state when
  // current HP exceeds max (Aid spell, Heroes' Feast, temp HP added to total,
  // etc.) so the player sees they're over-cap. Surplus uses a cool-blue fill
  // so it's visually distinct from the green/yellow/red ladder of normal HP.
  _hpBarStyle(c){
    if (!(c.hpMax > 0)) return { pct:0, color:'#c25450', surplus:false };
    if (c.hp > c.hpMax) return { pct:100, color:'#4a8ec9', surplus:true };
    const pct = Math.max(0, Math.min(100, (c.hp / c.hpMax) * 100));
    const color = pct > 50 ? '#6b9e6b' : pct > 25 ? '#c9a050' : '#c25450';
    return { pct, color, surplus:false };
  },

  _card(c,i){
    const icon=c.icon||'⚔';
    const hp=this._hpBarStyle(c);
    const hpPct=hp.pct, hpColor=hp.color;
    const resources=c.resources||[];

    let resHtml='';
    if(resources.length){
      resHtml='<div class="resource-section"><div class="resource-section-head"><span>Resources</span></div>';
      resources.forEach((r,ri)=>{
        const pips=r.type==='pool'?r.max:1;
        let pipHtml='';
        // Compact "−/+ N of M" badge for large pools where 13+ pips would wrap
        // into multiple cramped rows. Click the number to step it up/down via
        // the same data-act='pip' handler with synthetic pi indices.
        if (pips > 12){
          pipHtml = '<div class="resource-pips compact">'
            + '<button class="pip-step" data-act="pip-step" data-idx="'+i+'" data-ri="'+ri+'" data-dir="-1" title="Spend one">−</button>'
            + '<span class="pip-count">'+r.current+' / '+pips+'</span>'
            + '<button class="pip-step" data-act="pip-step" data-idx="'+i+'" data-ri="'+ri+'" data-dir="+1" title="Restore one">+</button>'
            + '</div>';
        } else {
          pipHtml = '<div class="resource-pips">';
          for(let p=0;p<pips;p++){
            pipHtml+='<div class="pip '+(p<r.current?'filled':'')+'" data-act="pip" data-idx="'+i+'" data-ri="'+ri+'" data-pi="'+p+'"></div>';
          }
          pipHtml+='</div>';
        }
        resHtml+='<div class="resource-row">'
          +'<span class="resource-label" title="'+esc(r.name)+'">'+esc(r.name)+'</span>'
          +pipHtml
          +'</div>';
      });
      resHtml+='</div>';
    }

    // Class/Race/Level subline. Falls back to c.sheet fields when the
    // top-level c.cls/race/level haven't been set (PDF imports populate the
    // sheet first; Manage Party fills the top-level fields). The line is
    // omitted entirely when no fields are known so the card stays clean.
    const sheet = c.sheet || {};
    const subRace = c.race || sheet.race || '';
    const subCls  = c.cls  || sheet.class || '';
    const subLvl  = c.level || sheet.level;
    const clsLvl  = [subCls, subLvl].filter(x => x != null && x !== '').join(' ');
    const sublineParts = [subRace, clsLvl].filter(Boolean);
    const sublineHtml = sublineParts.length
      ? '<div class="char-subline">' + esc(sublineParts.join(' · ')) + '</div>'
      : '';
    // Active-turn highlight: mirror the combat tracker's accent glow when
    // this PC is the current initiative slot. Lets the DM (or player on the
    // player view) see whose turn it is without switching panels.
    const isActiveTurn = c.id && state.activeCombatantId === c.id;
    // Already-in-combat check: drives the header button's affordance —
    // "+ ⚔" to add, or "in combat" pill to remove from combat with one click.
    const inCombat = !!(state.combatants && state.combatants.find(co => co.id === c.id));
    // Downed visual — PC at ≤0 HP gets a desaturated card + pulsing red bar
    // + a "Downed" badge so the DM glancing across a 5-card party can spot
    // who's in death-save territory without reading numbers.
    const downed = (c.hp != null) && c.hp <= 0;
    const raging = !!c.rage;
    const wildshaped = !!(c.wildshape && c.wildshape.name);
    return '<div class="char-card'+(isActiveTurn?' active-turn':'')+(inCombat?' in-combat':'')+(downed?' downed':'')+(raging?' raging':'')+(wildshaped?' wildshaped':'')+'" data-cidx="'+i+'" draggable="true" title="Drag to Combat Tracker to add to combat">'
      // Header: icon + name + remove
      +'<div class="char-header" style="position:relative">'
        +'<button class="char-icon-btn" data-act="icon-btn" data-idx="'+i+'" title="Change icon">'+renderIcon(icon, c.name)+'</button>'
        +(this._pickerOpen===i?this._iconPicker(i):'')
        +'<div class="char-header-text">'
          +'<input class="char-name" value="'+esc(c.name)+'" data-field="name" data-idx="'+i+'" placeholder="Character name">'
          +sublineHtml
        +'</div>'
        // One-click toggle to add/remove this PC from the combat tracker —
        // drag-drop still works, this is the discoverable affordance for new
        // DMs (and saves a panel-switch when the combat tracker isn't open).
        +'<button class="char-combat-btn'+(inCombat?' in-combat':'')+'" data-act="toggle-combat" data-idx="'+i+'" title="'+(inCombat?'Remove from combat':'Add to combat')+'">'
          +(inCombat?'⚔ In':'+ ⚔')
        +'</button>'
      +'</div>'
      // HP block — current / max with an optional Temp HP badge. Temp HP
      // sits visually beside the HP fields and edits inline like the others.
      // The HP bar gains a small overlay segment when temp > 0 so the
      // surplus is visible at a glance, even if c.hp itself isn't full.
      // The heal/damage strip on the right mirrors the combat tracker — same
      // shape, same handlers (party uses _applyHpDelta), so DMs don't context-
      // switch to combat just to apply a potion outside of initiative.
      +'<div class="char-hp-block">'
        +'<div class="char-hp-row">'
          +'<input class="char-hp-current" type="number" value="'+c.hp+'" data-field="hp" data-idx="'+i+'" title="Current HP">'
          +'<span class="char-hp-sep">/</span>'
          +'<input class="char-hp-max" type="number" value="'+c.hpMax+'" data-field="hpMax" data-idx="'+i+'" title="Max HP">'
          +'<input class="char-hp-temp" type="number" value="'+(c.tempHp||0)+'" data-field="tempHp" data-idx="'+i+'" title="Temporary HP (absorbs damage first)" min="0">'
          +'<span style="font-size:10px;color:var(--text-dim);margin-left:auto">HP</span>'
        +'</div>'
        // Horizontal heal/damage row sits beside/below the HP fields, full
        // width of the card. Bigger tap targets, clearer grouping, and no
        // more 4-tall column that fights with the HP/max/temp inputs above.
        +'<div class="party-hp-dmg" data-idx="'+i+'" title="Type amount, click − to damage (drains temp HP first, applies resist/vuln/immune) or + to heal">'
          +'<button class="party-hp-btn dmg" data-act="hp-damage" data-idx="'+i+'" title="Damage">−</button>'
          +'<input class="party-hp-amt" type="number" value="'+(this._lastDmgAmount||5)+'" min="0" max="999" data-idx="'+i+'" title="Heal / damage amount">'
          +'<button class="party-hp-btn heal" data-act="hp-heal" data-idx="'+i+'" title="Heal (clamped to max)">+</button>'
          +(()=>{
            // Dropdown panel shows the FULL type name; collapsed chip shows
            // the 2-letter abbreviation. The visible chip text is an overlay
            // <span> sitting on top of a transparent-text <select>.
            const dmgTypes = [
              ['', '— untyped', '—'],
              ['acid','acid','ac'],['bludgeoning','bludgeoning','bl'],['cold','cold','co'],
              ['fire','fire','fi'],['force','force','fo'],['lightning','lightning','li'],
              ['necrotic','necrotic','ne'],['piercing','piercing','pi'],['poison','poison','po'],
              ['psychic','psychic','ps'],['radiant','radiant','ra'],['slashing','slashing','sl'],
              ['thunder','thunder','th'],
            ];
            const lastType = this._lastDmgType || '';
            const lastAbbr = (dmgTypes.find(t => t[0] === lastType) || dmgTypes[0])[2];
            return '<span class="party-hp-type-wrap" title="Damage type — applies this PC\'s resist/vuln/immune (set them in the Stats tab; current: '+(lastType||'untyped')+')">'
              + '<span class="party-hp-type-label">'+lastAbbr+'</span>'
              + '<select class="party-hp-type" data-idx="'+i+'">'
              + dmgTypes.map(([val,full])=>'<option value="'+val+'"'+(val===lastType?' selected':'')+'>'+full+'</option>').join('')
              + '</select>'
              + '</span>';
          })()
        +'</div>'
        +'<div class="hp-bar-wrap'+(hp.surplus?' hp-surplus':'')+(downed?' downed':'')+'">'
          +'<div class="hp-bar-fill" style="width:'+hpPct+'%;background:'+hpColor+'"></div>'
          +(c.tempHp>0 ? '<div class="hp-bar-temp" title="Temp HP: '+c.tempHp+'"></div>' : '')
        +'</div>'
        // Downed banner — shows below the HP bar when at ≤0 HP. Death saves
        // themselves live on the combat slot (combat.js initializes deathSaves
        // on the matching combatant when HP crosses 0 in combat) — we just
        // surface the badge here so the party panel makes the state visible.
        + (downed
          ? '<div class="char-downed-badge" title="At 0 HP — see combat tracker for death saves">💀 Downed' + (
              (()=>{
                const co = state.combatants.find(x => x.id === c.id);
                if (co && co.deathSaves){
                  const ds = co.deathSaves;
                  return ' · ' + (ds.success||0) + '/3 saves · ' + (ds.fail||0) + '/3 fails';
                }
                return '';
              })()
            ) + '</div>'
          : '')
      +'</div>'
      // Stats: AC, Init, Spd. The AC input has a computed-breakdown tooltip
      // ("10 + 2 DEX + 5 gear = 17") so the DM can see at a glance whether
      // a number looks right. Manual c.acSources entries override the
      // inferred breakdown for DMs who track gear explicitly.
      +'<div class="char-stats-row">'
        +'<div class="char-stat"><div class="l">⛨ AC</div><input type="number" value="'+c.ac+'" data-field="ac" data-idx="'+i+'" title="'+esc(this._acBreakdown(c))+'"></div>'
        +'<div class="char-stat"><div class="l">⚡ Init</div><input type="number" value="'+c.init+'" data-field="init" data-idx="'+i+'"></div>'
        +'<div class="char-stat"><div class="l">Spd</div><input type="number" value="'+c.spd+'" data-field="spd" data-idx="'+i+'"></div>'
      +'</div>'
      // Active-form row — class-aware buttons for rage (barbarian) and wild
      // shape (druid). Renders nothing for other classes. When active, the
      // toggle becomes a pill with quick-reference rules and a ✕ to drop.
      + this._formsRow(c, i)
      // Wild Shape beast stats overlay — sits between the forms row and the
      // stats row. Shows beast HP / AC / speed / attacks. Damage from the
      // heal/damage strip routes to beast HP first while this is rendered.
      + this._wildshapeOverlay(c, i)
      // Concentration / Exhaustion / Conditions removed from the party card
      // to keep it focused on HP / stats / resources / inspiration. Those
      // statuses still exist and still work — they're managed from the
      // combat tracker's per-card status menu (the "+" pill on each combat
      // card opens Set Conc / Mark Reaction / Add Buff). Concentration data
      // still lives on c.concentration and damage triggers the save toast.
      // Hit dice — only shown when the character has hitDice info from PDF import.
      +this._hitDiceRow(c,i)
      // Resources
      +resHtml
      // Inspiration row: Heroic (the original generic toggle) + Bardic.
      // Bardic shows the appropriate die-size from class+level when this
      // character is actually a bard (d6 lv1→d8 lv5→d10 lv10→d12 lv15).
      + (()=>{
          const bd = this._bardicDie(c);
          const bardicLabel = bd ? `Bardic ${bd}` : 'Bardic';
          const bardicTitle = bd
            ? `Bardic Inspiration die (auto from level ${subLvl||'?'}): roll a ${bd} for the buff`
            : 'Bardic Inspiration';
          return '<div class="inspiration-pair">'
            +'<div class="inspiration-row '+(c.inspiration?'has-inspiration':'')+'" data-act="insp" data-idx="'+i+'" title="Heroic Inspiration · right-click for award reasons">'
              +'<div class="inspiration-toggle"></div><span>Heroic</span>'
            +'</div>'
            +'<div class="inspiration-row '+(c.bardicInspiration?'has-inspiration bardic':'')+'" data-act="bardic-insp" data-idx="'+i+'" title="'+esc(bardicTitle)+'">'
              +'<div class="inspiration-toggle"></div><span>'+esc(bardicLabel)+'</span>'
            +'</div>'
          +'</div>';
        })()
      // Full character sheet — collapsed by default; expand to see tabs.
      + this._sheetSection(c, i)
    +'</div>';
  },

  // ------------------------------------------------------------------
  // Character sheet (Phase 2): tabbed view of stats / skills / spells
  // ------------------------------------------------------------------
  _sheetSection(c, i){
    const has = !!c.sheet;
    const expanded = !!this._expanded[c.id];
    const toggleLabel = expanded ? '▲ Hide character sheet' : (has ? '▼ Show character sheet' : '▼ Show character sheet (no PDF imported)');
    return '<button class="sheet-toggle" data-act="toggle-sheet" data-idx="'+i+'">'+toggleLabel+'</button>'
      + (expanded ? this._sheetBody(c, i) : '');
  },

  _sheetBody(c, i){
    const tabs = ['stats','skills','spells','features'];
    const labels = {stats:'Stats', skills:'Skills', spells:'Spells', features:'Features'};
    let active = this._activeTab[c.id] || 'stats';
    if (!tabs.includes(active)) active = 'stats';
    const tabBar = tabs.map(t =>
      `<button class="sheet-tab ${t===active?'active':''}" data-act="sheet-tab" data-idx="${i}" data-tab="${t}">${labels[t]}</button>`
    ).join('');
    let body = '';
    if (active === 'stats')        body = this._tabStats(c);
    else if (active === 'skills')  body = this._tabSkills(c);
    else if (active === 'spells')  body = this._tabSpells(c);
    else if (active === 'features')body = this._tabFeatures(c);
    return `<div class="sheet-body">
      <div class="sheet-tabs">${tabBar}</div>
      <div class="sheet-content">${body}</div>
    </div>`;
  },

  // Features tab — pulls from the loaded 5etools dataset and renders the
  // character's race, class, and subclass features filtered by their level.
  // Falls back to a helpful empty state if c.cls/c.race/c.subclass don't
  // match any loaded entry. Each section is collapsible so a level-15
  // character with 20+ features doesn't dump the whole list at once.
  _tabFeatures(c){
    if (typeof _5eData === 'undefined' || !_5eLoaded){
      return '<div class="sheet-empty">5e data still loading — open this tab again in a moment.</div>';
    }
    const pcLevel = parseInt(c.level || (c.sheet && c.sheet.level) || 0) || 0;
    const clsName = String(c.cls || (c.sheet && c.sheet.class) || '').trim().toLowerCase();
    const subName = String(c.subclass || '').trim().toLowerCase();
    const raceName= String(c.race || '').trim().toLowerCase();

    // Find the matching loaded entries. Classes/subclasses share cat:'class'
    // but disambiguate via _raw — classes have `classFeatures`, subclasses
    // have `subclassFeatures`. We pick the first source-PHB match when
    // multiple exist; the entry's _resolvedFeatures has already been built
    // by data-loader.js.
    const classEntry = clsName
      ? _5eData.find(d => d.cat==='class' && d._raw?.classFeatures && d.name.toLowerCase() === clsName)
      : null;
    const subEntry = (subName && clsName)
      ? _5eData.find(d => d.cat==='class' && d._raw?.subclassFeatures
          && d.name.toLowerCase() === subName
          && String(d._raw.className||'').toLowerCase() === clsName)
      : null;
    const raceEntry = raceName
      ? _5eData.find(d => d.cat==='race' && d.name.toLowerCase() === raceName)
      : null;

    const flatten = entries => {
      if (!Array.isArray(entries)) return '';
      // Mirror Bestiary detail rendering: recursive walk over entries,
      // bolding named sub-entries and dropping the rest as paragraphs.
      const walk = arr => arr.map(e => {
        if (typeof e === 'string') return '<p>' + this._renderEntryText(e) + '</p>';
        if (e && typeof e === 'object'){
          if (e.type === 'list' && Array.isArray(e.items)){
            return '<ul class="feat-list">' + e.items.map(it =>
              '<li>' + (typeof it === 'string' ? this._renderEntryText(it)
                : (it.entries ? walk(it.entries) : '')) + '</li>'
            ).join('') + '</ul>';
          }
          if (e.name && e.entries){
            return '<div class="feat-sub"><strong>' + esc(e.name) + '.</strong> ' + walk(e.entries) + '</div>';
          }
          if (e.entries) return walk(e.entries);
        }
        return '';
      }).join('');
      return walk(entries);
    };

    const renderFeatureList = (features, ribbon) => {
      if (!features || !features.length) return '';
      const filtered = features.filter(f => (f.level || 0) <= pcLevel);
      if (!filtered.length) return `<div class="sheet-empty">No ${ribbon} features at level ${pcLevel||'?'} yet.</div>`;
      return filtered.map(f =>
        `<details class="feat-block">
          <summary><span class="feat-lvl">L${f.level||'?'}</span> ${esc(f.name)}</summary>
          <div class="feat-body">${flatten(f.entries)}</div>
        </details>`
      ).join('');
    };

    const renderRaceFeatures = (raceObj) => {
      const raw = raceObj && raceObj._raw;
      if (!raw) return '';
      // Race entries can be flat strings + named sub-blocks. We treat each
      // named sub-block as its own collapsible row. Anonymous strings get
      // their own "overview" row at the top.
      const entries = Array.isArray(raw.entries) ? raw.entries : [];
      const named = entries.filter(e => e && typeof e === 'object' && e.name && e.entries);
      const plain = entries.filter(e => !(e && typeof e === 'object' && e.name));
      const out = [];
      if (plain.length){
        out.push(`<details class="feat-block" open>
          <summary><span class="feat-lvl race">RACE</span> Overview</summary>
          <div class="feat-body">${flatten(plain)}</div>
        </details>`);
      }
      named.forEach(e => {
        out.push(`<details class="feat-block">
          <summary><span class="feat-lvl race">RACE</span> ${esc(e.name)}</summary>
          <div class="feat-body">${flatten(e.entries)}</div>
        </details>`);
      });
      return out.join('');
    };

    const sections = [];
    if (raceEntry){
      sections.push(`<div class="sheet-block feat-section">
        <h5>🌿 Race: ${esc(raceEntry.name)}${raceEntry._source?` <span class="detail-source-badge">${esc(_formatSource(raceEntry._source))}</span>`:''}</h5>
        ${renderRaceFeatures(raceEntry)}
      </div>`);
    } else if (raceName){
      sections.push(`<div class="sheet-block feat-section"><h5>🌿 Race</h5><div class="sheet-empty">No 5etools entry matched "${esc(c.race)}". Check spelling (case-insensitive match on name).</div></div>`);
    }
    if (classEntry){
      sections.push(`<div class="sheet-block feat-section">
        <h5>⚔ Class: ${esc(classEntry.name)} <span class="feat-lvl-pill">level ${pcLevel||'?'}</span></h5>
        ${renderFeatureList(classEntry._raw?._resolvedFeatures, 'class')}
      </div>`);
    } else if (clsName){
      sections.push(`<div class="sheet-block feat-section"><h5>⚔ Class</h5><div class="sheet-empty">No 5etools class matched "${esc(c.cls)}". Try "Fighter", "Wizard", etc.</div></div>`);
    }
    if (subEntry){
      sections.push(`<div class="sheet-block feat-section">
        <h5>✦ Subclass: ${esc(subEntry.name)}</h5>
        ${renderFeatureList(subEntry._raw?._resolvedFeatures, 'subclass')}
      </div>`);
    } else if (subName){
      sections.push(`<div class="sheet-block feat-section"><h5>✦ Subclass</h5><div class="sheet-empty">No 5etools subclass matched "${esc(c.subclass)}" for ${esc(c.cls||'class')}.</div></div>`);
    }

    if (!sections.length){
      return `<div class="sheet-empty">
        Set <strong>Race</strong>, <strong>Class</strong>, and <strong>Subclass</strong> on this character (use 📋 Manage Party → ✏ Edit details) to see their features here.
      </div>`;
    }
    return sections.join('');
  },

  // Light-weight 5etools entry-string renderer: strips {@tag …} markup down
  // to readable plain text. The full search/popout renderer already handles
  // these at depth — we don't need links here, just clean prose.
  _renderEntryText(s){
    return esc(String(s||'')
      .replace(/\{@(?:dice|damage|hit|d20|chance|recharge|scaledice|scaledamage|h)\s+([^|}]+)(?:\|[^}]*)?\}/gi, '$1')
      .replace(/\{@(?:item|spell|condition|skill|action|sense|ability|race|class|feat|creature|filter|table|book|adventure|background|disease|status|object|vehicle|reward|hazard|deity|deck|card|optfeature|psionic|trap|cult|boon|language|legroup|variantrule|classFeature|subclassFeature|itemMastery|itemProperty)\s+([^|}]+)(?:\|[^}]*)?\}/gi, '$1')
      .replace(/\{@(?:bold|b)\s+([^}]+)\}/gi, '$1')
      .replace(/\{@(?:italic|i)\s+([^}]+)\}/gi, '$1')
      .replace(/\{@note\s+([^}]+)\}/gi, '$1')
      .replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, '$1'));
  },

  // Resistances / Immunities / Vulnerabilities editor. Three rows of chips,
  // each chip is a damage type, click to cycle through the four states:
  // (none) → resist → immune → vulnerable → (none). Honored by _applyHpDelta
  // when the DM picks a damage type on the heal/damage strip.
  // Stored on c.resistances / c.immunities / c.vulnerabilities as lowercase
  // type strings. Backward-compat: if a PDF later imports these, the lists
  // get unioned (combat tracker style).
  _renderResistances(c){
    const TYPES = ['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder'];
    const i = state.party.findIndex(p => p.id === c.id);
    const res = new Set((c.resistances    || []).map(x => String(x).toLowerCase()));
    const imm = new Set((c.immunities     || []).map(x => String(x).toLowerCase()));
    const vul = new Set((c.vulnerabilities|| []).map(x => String(x).toLowerCase()));
    // Only render the block if the PC has at least one entry OR the user
    // explicitly toggled it open (cheap: a transient `this._resistancesOpen`
    // map). New PCs see a small "+ Resist/Vuln/Immune" pill that opens it.
    if (!this._resistancesOpen) this._resistancesOpen = {};
    const isOpen = this._resistancesOpen[c.id] === true;
    const hasAny = res.size || imm.size || vul.size;
    if (!hasAny && !isOpen){
      return `<div class="sheet-block sheet-resist-collapsed">
        <button class="btn small" data-act="resist-toggle" data-cid="${esc(c.id)}" title="Edit this character's damage resistances, immunities, and vulnerabilities">+ Resist / Immune / Vuln</button>
      </div>`;
    }
    const chip = (t) => {
      let state, label, cls;
      if (imm.has(t))      { state='immune';     label='IMM'; cls='imm'; }
      else if (res.has(t)) { state='resist';     label='RES'; cls='res'; }
      else if (vul.has(t)) { state='vulnerable'; label='VUL'; cls='vul'; }
      else                 { state='none';       label='—';   cls='none'; }
      const next = state==='none' ? 'resist' : state==='resist' ? 'immune' : state==='immune' ? 'vulnerable' : 'none';
      return `<button class="resist-chip ${cls}" data-act="resist-cycle" data-idx="${i}" data-type="${t}" data-next="${next}" title="${t}: ${state} — click to set ${next}">
        <span class="resist-chip-name">${t}</span>
        <span class="resist-chip-state">${label}</span>
      </button>`;
    };
    return `<div class="sheet-block">
      <h5>Damage Resistances <span class="resist-legend">click to cycle: — → RES → IMM → VUL</span>
        <button class="btn icon-btn" data-act="resist-toggle" data-cid="${esc(c.id)}" title="Hide editor" style="margin-left:auto;padding:1px 6px;font-size:11px">×</button>
      </h5>
      <div class="resist-grid">${TYPES.map(chip).join('')}</div>
    </div>`;
  },

  // AC breakdown tooltip — best-effort decomposition of c.ac into base 10 +
  // Dex modifier (capped by armor type when we know it) + residual gear.
  // If the DM has populated c.acSources as [{label, value}], we honor that
  // explicitly and show their labelled breakdown instead of inferring.
  // Returns a human-readable string for the input's `title` attribute.
  _acBreakdown(c){
    const ac = c.ac;
    if (ac == null || ac === '') return 'No AC set';
    // Explicit DM-authored breakdown wins.
    if (Array.isArray(c.acSources) && c.acSources.length){
      const sum = c.acSources.reduce((s, x) => s + (parseInt(x.value)||0), 0);
      const parts = c.acSources.map(x => {
        const v = parseInt(x.value)||0;
        return (v >= 0 ? '+' : '') + v + ' ' + (x.label || '');
      });
      const mismatch = sum !== ac ? ` (Σ=${sum}, stored ${ac})` : '';
      return 'AC ' + ac + ': ' + parts.join(', ') + mismatch;
    }
    // Inferred breakdown from Dex.
    const ab = c.abilities || {};
    const dexMod = (typeof ab.dex === 'number') ? Math.floor((ab.dex - 10) / 2) : null;
    if (dexMod == null) return 'AC ' + ac + ' (import a PDF for Dex-based breakdown)';
    const residual = ac - 10 - dexMod;
    // Sign formatting helper. residual can be negative for low-AC PCs (rare).
    const sign = n => (n >= 0 ? '+' : '−') + Math.abs(n);
    let label;
    if (residual === 0)      label = 'Unarmored';
    else if (residual <= 1)  label = 'Mage Armor / Padded';
    else if (residual <= 2)  label = 'Leather + Shield / Studded';
    else if (residual <= 3)  label = 'Studded + Shield / Hide';
    else if (residual <= 4)  label = 'Chain Shirt + Shield / Scale Mail';
    else if (residual <= 5)  label = 'Half Plate + Shield / Chain Mail';
    else if (residual <= 7)  label = 'Plate + Shield / heavy gear';
    else                     label = 'Magical gear';
    return 'AC ' + ac + ': 10 base ' + sign(dexMod) + ' DEX ' + sign(residual) + ' gear (≈ ' + label + ')';
  },

  // Add or remove a condition. Writes to whichever store currently holds it
  // (combat slot if the PC is in combat, else c.conditions on the party
  // member). Adding always writes to the combat slot when one exists so the
  // combat tracker chip stays canonical; otherwise it stores on the party
  // member and gets carried over the next time they join combat.
  _toggleCondition(i, name){
    const c = state.party[i]; if (!c) return;
    const co = state.combatants.find(x => x.id === c.id);
    // De-duplicated "currently has it" check across both stores.
    const partyHas = Array.isArray(c.conditions) && c.conditions.includes(name);
    const combatHas = co && Array.isArray(co.conditions) && co.conditions.includes(name);
    if (partyHas || combatHas){
      // Remove from both — keeps the two stores from drifting.
      if (partyHas) c.conditions = c.conditions.filter(x => x !== name);
      if (combatHas) co.conditions = co.conditions.filter(x => x !== name);
    } else {
      if (co){
        co.conditions = [...(co.conditions || []), name];
      } else {
        c.conditions = [...(c.conditions || []), name];
      }
    }
    save(); this._render();
    panelDefs.combat?._render?.();
  },

  // Forms row — toggleable class state for Barbarians (rage) and Druids
  // (wild shape). Renders the right control set based on the character's
  // class string. Empty for other classes so the row adds no chrome unless
  // there's something to show.
  _formsRow(c, i){
    const cls = String(c.cls || c.sheet?.class || '').toLowerCase();
    const isBarb  = /\bbarbarian\b/.test(cls);
    const isDruid = /\bdruid\b/.test(cls);
    if (!isBarb && !isDruid) return '';
    const raging = !!c.rage;
    const wildshape = c.wildshape || null;
    const parts = [];
    if (isBarb){
      // Rage damage bonus by level (5e RAW: +2 to lv8, +3 to lv15, +4 at 16+).
      const lvl = parseInt(c.level || c.sheet?.level || 1, 10) || 1;
      const rageDmg = lvl >= 16 ? '+4' : lvl >= 9 ? '+3' : '+2';
      if (raging){
        parts.push(`<button class="form-pill rage-on" data-act="rage-off" data-idx="${i}" title="Rage active — Advantage on STR checks/saves · ${rageDmg} damage on melee STR attacks · Resistance to bludgeoning, piercing, slashing · Can't cast or concentrate · Lasts 1 min (10 rounds). Click to end rage.">💢 RAGING <span class="form-pill-x">×</span></button>`);
      } else {
        parts.push(`<button class="form-pill rage-off" data-act="rage-on" data-idx="${i}" title="Enter rage — Advantage on STR · ${rageDmg} melee damage · Resist B/P/S · Lasts 1 minute">💢 Rage</button>`);
      }
    }
    if (isDruid){
      if (wildshape){
        parts.push(`<button class="form-pill ws-on" data-act="ws-end" data-idx="${i}" title="Wild Shape active as ${esc(wildshape.name)} — Druid stats hidden, beast HP routes damage first. Click to revert.">🐺 ${esc(wildshape.name)} <span class="form-pill-x">×</span></button>`);
        parts.push(`<button class="form-pill ws-edit" data-act="ws-edit" data-idx="${i}" title="Edit the beast's HP, AC, speed, attacks">✎</button>`);
      } else {
        parts.push(`<button class="form-pill ws-off" data-act="ws-start" data-idx="${i}" title="Transform into a beast — opens an editor for the beast's HP, AC, speed, and attacks">🐺 Wild Shape</button>`);
      }
    }
    return `<div class="char-forms-row">${parts.join('')}</div>`;
  },

  // Wild Shape stats overlay — visible only when c.wildshape is set. Shows
  // the beast's HP bar + AC + Speed + attacks. The card's editable druid
  // HP/AC stay rendered above (in the normal HP block & stats row); damage
  // from the heal/damage strip routes through _applyHpDelta which checks
  // c.wildshape and decrements beast HP first.
  _wildshapeOverlay(c, i){
    const ws = c.wildshape;
    if (!ws || !ws.name) return '';
    const max = ws.hpMax || ws.hp || 1;
    const pct = Math.max(0, Math.min(100, Math.round((ws.hp / max) * 100)));
    const color = pct > 50 ? '#6b9e6b' : pct > 25 ? '#c9a050' : '#c25450';
    const attacks = (ws.attacks || '').trim();
    return `<div class="char-wildshape">
      <div class="ws-head">
        <span class="ws-icon">🐺</span>
        <span class="ws-name">${esc(ws.name)}</span>
        <span class="ws-stats">
          <span title="Beast HP — damage from the strip drains here first">♥ ${ws.hp}/${ws.hpMax||ws.hp}</span>
          ${ws.ac!=null ? `<span title="Beast AC">⛨ ${ws.ac}</span>` : ''}
          ${ws.speed ? `<span title="Beast speed">⇒ ${esc(ws.speed)}</span>` : ''}
        </span>
      </div>
      <div class="ws-bar"><div class="ws-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      ${attacks ? `<div class="ws-attacks" title="Attacks / abilities of this beast form">${esc(attacks)}</div>` : ''}
      ${ws.notes ? `<div class="ws-notes">${esc(ws.notes)}</div>` : ''}
    </div>`;
  },

  // Open a small modal for the beast's stats. On save, mark wildshape active
  // and re-render. On cancel, no change. The druid's existing concentration
  // is dropped per 5e RAW when transformation starts (handled here on save).
  _editWildShape(i){
    const c = state.party[i]; if (!c) return;
    const cur = c.wildshape || {};
    showModal('🐺 Wild Shape — ' + c.name, [
      {id:'name',   label:'Beast name',                  type:'text',   value:cur.name||'',   placeholder:'Brown Bear, Giant Spider, Wolf …'},
      {id:'hp',     label:'Beast HP (current)',          type:'number', value:cur.hp==null?34:cur.hp, min:0},
      {id:'hpMax',  label:'Beast HP (max)',              type:'number', value:cur.hpMax==null?34:cur.hpMax, min:1},
      {id:'ac',     label:'Beast AC',                    type:'number', value:cur.ac==null?11:cur.ac, min:0},
      {id:'speed',  label:'Beast speed',                 type:'text',   value:cur.speed||'',  placeholder:'40 ft · climb 30 ft · swim 30 ft'},
      {id:'attacks',label:'Attacks (free text)',         type:'text',   value:cur.attacks||'',placeholder:'Bite +5 (1d8+3 piercing); Claws +5 (2d6+3 slashing)'},
      {id:'notes',  label:'Notes',                       type:'text',   value:cur.notes||'',  placeholder:'Keen Smell, Charge…'},
    ], cur.name?'Update':'Transform').then(r => {
      if (!r || !String(r.name||'').trim()) return;
      // Save the beast snapshot. Druid's own HP/AC stay unchanged.
      const ws = {
        name:    String(r.name).trim(),
        hp:      Math.max(0, parseInt(r.hp)    || 0),
        hpMax:   Math.max(1, parseInt(r.hpMax) || 1),
        ac:                  parseInt(r.ac)    || 0,
        speed:   String(r.speed||'').trim(),
        attacks: String(r.attacks||'').trim(),
        notes:   String(r.notes||'').trim(),
      };
      ws.hp = Math.min(ws.hp, ws.hpMax);
      const wasFresh = !c.wildshape;
      state.party[i] = {...c, wildshape: ws};
      // Druids drop concentration when they wildshape (5e RAW).
      if (wasFresh && state.party[i].concentration){
        state.party[i].concentration = null;
      }
      save(); this._render();
    });
  },

  // Drop wild shape — revert to druid form. Carry any HP overflow if the
  // beast was at 0 (rare on a manual ✕ click but handled cleanly).
  _endWildShape(i){
    const c = state.party[i]; if (!c || !c.wildshape) return;
    state.party[i] = {...c, wildshape: null};
    save(); this._render();
    showToast(c.name + ' reverts to their normal form');
  },

  // Bardic Inspiration die-size ladder (5e RAW): d6 at lv1, d8 at lv5, d10
  // at lv10, d12 at lv15. Returns the die string when this character is a
  // bard (multiclass detection is "class string contains 'bard'") or null
  // when the auto-display doesn't apply. The DM can still toggle Bardic
  // Inspiration regardless; the die-size label is just a reminder.
  _bardicDie(c){
    const sheet = c.sheet || {};
    const cls = (c.cls || sheet.class || '').toLowerCase();
    if (!/\bbard\b/.test(cls)) return null;
    const lvl = parseInt(c.level || sheet.level || 0, 10);
    if (!lvl) return null;
    if (lvl >= 15) return 'd12';
    if (lvl >= 10) return 'd10';
    if (lvl >= 5)  return 'd8';
    return 'd6';
  },

  // Roll a d20 with an integer modifier. opts.mode: 'normal'|'adv'|'dis'.
  // Returns the result object the Stats tab renders in its "Last roll"
  // strip. Uses the global d20() helper from utils.js. Crit/fumble are
  // detected on the natural d20 (not the modified total).
  _rollD20(mod, opts){
    const mode = (opts && opts.mode) || 'normal';
    if (mode === 'adv' || mode === 'dis'){
      const a = d20(), b = d20();
      const used = (mode === 'adv') ? Math.max(a, b) : Math.min(a, b);
      return {
        natural: used,
        rolls: [a, b],
        kept: (mode === 'adv') ? (a >= b ? 0 : 1) : (a <= b ? 0 : 1),
        mod: mod || 0,
        total: used + (mod || 0),
        crit: used === 20,
        fumble: used === 1,
        mode,
        label: opts?.label || '',
      };
    }
    const n = d20();
    return {
      natural: n,
      rolls: [n],
      kept: 0,
      mod: mod || 0,
      total: n + (mod || 0),
      crit: n === 20,
      fumble: n === 1,
      mode: 'normal',
      label: opts?.label || '',
    };
  },

  // Roll an attack: d20 + bonus to-hit, then roll damage dice. Returns the
  // same shape as _rollD20() with an extra `damage` block when dmgExpr was
  // provided. Crits double the dice (not modifiers), per 5e RAW.
  _rollAttack(c, name, atkBonus, dmgExpr, mode){
    const toHit = this._rollD20(atkBonus, {
      mode,
      label: c.name + ' · ' + name + ' attack',
    });
    if (dmgExpr){
      const dmg = this._rollDamageExpr(dmgExpr, toHit.crit);
      toHit.damage = dmg;
      toHit.attack = true;
    }
    return toHit;
  },

  // Tiny dice-expression evaluator. Accepts things like:
  //   "2d6+3", "1d8 +5", "1d10+3 piercing", "2d6+1d4+3 fire", "1d8"
  // Returns { total, breakdown, type } where breakdown is the human-readable
  // string with individual rolls. On crit, each NdN term doubles (the rule is
  // "double the dice", so 2d6+3 becomes 4d6+3, not 2d6+3 doubled). Unparsed
  // input degrades gracefully — returns the raw string in breakdown.
  _rollDamageExpr(expr, crit){
    const raw = String(expr || '').trim();
    if (!raw) return null;
    // Split off the trailing "type" word(s) so "2d6+3 slashing" pulls out
    // "slashing" cleanly. Everything not part of the math goes to type.
    const typeMatch = raw.match(/\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder|healing)\b/i);
    const dmgType = typeMatch ? typeMatch[1].toLowerCase() : '';
    const expression = raw.replace(/\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder|healing)\b/ig, '').trim();
    // Tokenize: NdN, signed integers, plus/minus separators. Anything weird
    // → fall through to "couldn't parse" branch.
    const terms = [];
    const re = /([+-]?\s*\d+d\d+|[+-]?\s*\d+)/g;
    let m;
    while ((m = re.exec(expression)) !== null){
      terms.push(m[0].replace(/\s+/g, ''));
    }
    if (!terms.length) return { total: 0, breakdown: raw, type: dmgType };
    let total = 0;
    const parts = [];
    for (const t of terms){
      const sign = t.startsWith('-') ? -1 : 1;
      const body = t.replace(/^[+-]/, '');
      const dm = body.match(/^(\d+)d(\d+)$/);
      if (dm){
        let n = parseInt(dm[1], 10);
        const sides = parseInt(dm[2], 10);
        if (crit) n *= 2;             // crit doubles the dice
        const rolls = [];
        for (let i = 0; i < n; i++){
          rolls.push(1 + Math.floor(Math.random() * sides));
        }
        const sub = rolls.reduce((a,b)=>a+b, 0) * sign;
        total += sub;
        parts.push((sign < 0 ? '−' : '') + n + 'd' + sides + ' [' + rolls.join(',') + ']');
      } else {
        const k = parseInt(body, 10) * sign;
        if (Number.isFinite(k)){
          total += k;
          parts.push((k >= 0 ? '+' : '−') + Math.abs(k));
        }
      }
    }
    return { total, breakdown: parts.join(' '), type: dmgType, crit: !!crit };
  },

  // Apply +/- HP to party member `i`, draining tempHp first on damage. When
  // dmgType is supplied AND the PC has matching entries in c.immunities /
  // c.resistances / c.vulnerabilities (DM-managed arrays of lowercase type
  // strings), the damage is nulled / halved / doubled before any temp-HP
  // math. Mirrors to combat tracker via syncPartyToCombat so an in-combat PC
  // stays in sync. Heal is clamped to hpMax; damage can dip below 0
  // (death-save territory). Triggers a concentration-save toast on damage.
  _applyHpDelta(i, delta, dmgType){
    const c = state.party[i]; if (!c) return;
    if (delta < 0){
      let remaining = -delta; // positive amount of damage
      let typeSuffix = '';
      // Resist/immune/vulnerable math — fires whenever a type is supplied.
      // Rage extends this with bludgeoning/piercing/slashing resist while
      // c.rage is true (5e barbarian RAW). The math walks immune → resist
      // → vuln in priority order; rage just adds to the resist set.
      if (dmgType){
        const t = String(dmgType).toLowerCase();
        const has = (arr) => Array.isArray(arr) && arr.some(x => String(x).toLowerCase() === t);
        const ragingBPS = c.rage && (t === 'bludgeoning' || t === 'piercing' || t === 'slashing');
        if (has(c.immunities)){
          remaining = 0;
          typeSuffix = ' (' + dmgType + ' — immune)';
        } else if (has(c.resistances) || ragingBPS){
          remaining = Math.floor(remaining / 2);
          typeSuffix = ' (' + dmgType + (ragingBPS ? ' — rage resist, ½' : ' — resisted, ½') + ')';
        } else if (has(c.vulnerabilities)){
          remaining = remaining * 2;
          typeSuffix = ' (' + dmgType + ' — vulnerable, ×2)';
        } else {
          typeSuffix = ' (' + dmgType + ')';
        }
      } else if (c.rage){
        // Untyped damage in rage gets no resist (we'd need the type to know
        // if it's B/P/S). Show a small reminder in the toast though.
        typeSuffix = ' (untyped — rage applies only to B/P/S)';
      }
      // Wild Shape: damage hits the BEAST pool first. Once beast HP ≤ 0,
      // overflow drops the form and carries to druid HP (5e RAW).
      if (c.wildshape && c.wildshape.name){
        const wsHp = c.wildshape.hp || 0;
        if (wsHp > 0){
          const beastTook = Math.min(wsHp, remaining);
          c.wildshape.hp = wsHp - beastTook;
          remaining -= beastTook;
          if (typeof showToast === 'function'){
            showToast(c.name + '\'s ' + c.wildshape.name + ' took ' + beastTook + ' damage' + typeSuffix);
          }
          // Beast knocked out → revert and let overflow continue to druid.
          if (c.wildshape.hp <= 0){
            const beastName = c.wildshape.name;
            c.wildshape = null;
            if (typeof showToast === 'function'){
              showToast(beastName + ' form drops — ' + c.name + ' reverts');
            }
          }
        }
      }
      // Temp HP absorbs next (druid side, after beast pool is exhausted or
      // when no wildshape is active).
      const temp = c.tempHp || 0;
      if (temp > 0 && remaining > 0){
        const drain = Math.min(temp, remaining);
        c.tempHp = temp - drain;
        remaining -= drain;
      }
      const taken = Math.max(0, remaining);
      if (taken > 0){
        c.hp = (c.hp || 0) - taken;
      }
      // Concentration save reminder — 5e rule. Toast only; don't auto-roll.
      if (c.concentration && taken > 0){
        const dc = Math.max(10, Math.floor(taken / 2));
        if (typeof showToast === 'function'){
          showToast('🌀 ' + c.name + ': DC ' + dc + ' CON save to maintain ' + c.concentration);
        }
      }
      // Damage-type readout in a small toast so the DM sees the resist/etc.
      // applied. Untyped damage stays silent (no extra toast — the HP bar
      // is the feedback).
      if (dmgType && typeof showToast === 'function'){
        showToast(c.name + ' took ' + taken + ' damage' + typeSuffix);
      }
    } else if (delta > 0){
      // Healing routes to the beast pool first while wildshape is active —
      // that's the body actually taking the spell. Druid HP is unchanged
      // unless overflow remains (rare; clamped to beast hpMax).
      if (c.wildshape && c.wildshape.name){
        const beastCap = c.wildshape.hpMax || c.wildshape.hp || 0;
        const before = c.wildshape.hp || 0;
        c.wildshape.hp = Math.min(beastCap, before + delta);
        const beastHealed = c.wildshape.hp - before;
        const overflow = delta - beastHealed;
        if (overflow > 0){
          // Spillover heals the druid too (matches "regaining hit points"
          // affecting both pools in the spirit of the rule). Clamp to druid
          // hpMax. Most tables won't see this trigger because beast HP
          // refills to cap fast.
          const cap = c.hpMax || c.hp || 0;
          c.hp = Math.min(cap, (c.hp || 0) + overflow);
        }
      } else {
        const cap = c.hpMax || c.hp || 0;
        c.hp = Math.min(cap, (c.hp || 0) + delta);
      }
    }
    save();
    syncPartyToCombat(i);
    this._render();
    // Combat panel might be showing this PC's card — keep its HP value in
    // sync without forcing the DM to click into it.
    panelDefs.combat?._render?.();
  },

  // Long rest applied to the whole party. 5e RAW:
  //   • HP back to max
  //   • All spell slots restored
  //   • Hit dice restored by half (rounded up, min 1)
  //   • Exhaustion -1 (2024 rules: same)
  //   • Concentration dropped
  //   • Death saves cleared (PCs that survived stabilize)
  // Players that survived the day get a clean slate; downed PCs come back at
  // 1 HP (5e rule: a stabilized creature wakes with 1 HP after a long rest).
  _longRestAll(){
    if (!state.party.length){ showToast('No party to rest'); return; }
    if (typeof showConfirm !== 'function'){
      this._applyLongRest();
      return;
    }
    showConfirm('Long rest the whole party? HP to max, all spell slots restored, hit dice ½ back, exhaustion −1, concentration dropped.',
      {title:'Long rest', confirmLabel:'Rest', danger:false}).then(ok => {
        if (ok) this._applyLongRest();
      });
  },
  _applyLongRest(){
    state.party.forEach((c, i) => {
      // HP: stabilize downed PCs at 1, else full heal.
      c.hp = (c.hp <= 0) ? 1 : (c.hpMax || c.hp);
      c.tempHp = 0;
      // Hit dice: half back, rounded up, min 1.
      if (c.hitDice && c.hitDice.max){
        const back = Math.max(1, Math.ceil(c.hitDice.max / 2));
        c.hitDice.current = Math.min(c.hitDice.max, (c.hitDice.current || 0) + back);
      }
      // Spell slots: clear all expended counters.
      const slots = c.sheet?.spellSlots;
      if (slots){
        Object.keys(slots).forEach(k => { slots[k] = {...slots[k], expended: 0}; });
      }
      // Exhaustion: -1 (clamped at 0).
      c.exhaustion = Math.max(0, (+c.exhaustion || 0) - 1);
      // Concentration: dropped.
      c.concentration = null;
      // Rage / Wild Shape: both end at any rest (rage lasts 1 minute;
      // wildshape ends at the druid's choice or when its hours expire).
      c.rage = false;
      c.wildshape = null;
      // Mirror to combat tracker.
      syncPartyToCombat(i);
    });
    save();
    this._render();
    panelDefs.combat?._render?.();
    showToast('🛌 Long rest — party fully recovered');
  },

  // Short rest applied to the whole party. 5e RAW: PCs spend hit dice to
  // heal. We don't auto-spend (varies wildly by player choice); instead we
  // restore Warlock-style "short rest" pact slots and recharge things like
  // Action Surge / Second Wind. For now, the simplest useful behavior:
  //   • Clear concentration (a 1-hour break drops it)
  //   • Restore any resources flagged with name containing "short rest"
  // Hit dice spending stays per-PC via the existing per-die-pip click.
  _shortRestAll(){
    if (!state.party.length){ showToast('No party to rest'); return; }
    if (typeof showConfirm !== 'function'){
      this._applyShortRest();
      return;
    }
    showConfirm('Short rest the whole party? Concentration drops; resources whose name contains "short rest" refresh. Players can spend hit dice per-PC after.',
      {title:'Short rest', confirmLabel:'Rest', danger:false}).then(ok => {
        if (ok) this._applyShortRest();
      });
  },
  _applyShortRest(){
    state.party.forEach((c, i) => {
      c.concentration = null;
      if (Array.isArray(c.resources)){
        c.resources = c.resources.map(r => {
          if (/short\s*rest/i.test(r.name || '')) return {...r, current: r.max || r.current};
          return r;
        });
      }
      syncPartyToCombat(i);
    });
    save();
    this._render();
    panelDefs.combat?._render?.();
    showToast('💤 Short rest — concentration dropped, short-rest resources refreshed');
  },

  // Render the "Last roll" strip shown above the ability block. Returns ''
  // when this character hasn't rolled anything this session. The strip is
  // ephemeral (held on the panel, not persisted) so opening the sheet on
  // a fresh page load starts clean.
  _renderLastRoll(c){
    const r = this._lastRoll && this._lastRoll[c.id];
    if (!r) return '';
    const modText = (r.mod >= 0 ? '+' : '') + r.mod;
    const modeChip = r.mode === 'adv' ? '<span class="roll-chip adv">ADV</span>'
                    : r.mode === 'dis' ? '<span class="roll-chip dis">DIS</span>'
                    : '';
    const dice = r.rolls.map((x, i) =>
      `<span class="roll-die${i === r.kept ? ' kept' : ' dropped'}${x === 20 ? ' crit' : x === 1 ? ' fumble' : ''}">${x}</span>`
    ).join('');
    const status = r.crit ? '<span class="roll-status crit">CRIT 20!</span>'
                  : r.fumble ? '<span class="roll-status fumble">Nat 1</span>'
                  : '';
    // Attack rolls carry an attached damage block. Show it inline so the
    // player sees the to-hit AND the damage on one row. Damage is also bold-
    // styled when the hit critted (already doubled at roll time).
    const dmgBlock = r.damage
      ? `<span class="roll-dmg ${r.crit?'crit':''}" title="${esc(r.damage.breakdown)}">
          <span class="roll-dmg-icon">⚔</span>
          <span class="roll-dmg-total">${r.damage.total}</span>${r.damage.type?`<span class="roll-dmg-type">${esc(r.damage.type)}</span>`:''}
         </span>`
      : '';
    return `<div class="roll-strip ${r.crit?'crit':''}${r.fumble?' fumble':''}">
      <span class="roll-label">${esc(r.label || 'Roll')}</span>
      ${modeChip}
      <span class="roll-dice">${dice}</span>
      <span class="roll-eq">${modText}</span>
      <span class="roll-total">${r.total}</span>
      ${dmgBlock}
      ${status}
      <span class="roll-hint" title="Shift-click any ability or save for advantage · Alt-click for disadvantage">?</span>
    </div>`;
  },

  // Persist the result of a roll on the panel and re-render the active
  // character's sheet so the strip updates. The map is keyed by character
  // id so each PC keeps their own most-recent roll.
  _setLastRoll(c, result){
    if (!this._lastRoll) this._lastRoll = {};
    this._lastRoll[c.id] = result;
    this._render();
  },

  _abilityBlock(c){
    const ab = c.abilities || {};
    const order = [['str','STR'],['dex','DEX'],['con','CON'],['int','INT'],['wis','WIS'],['cha','CHA']];
    return '<div class="sheet-abilities">' + order.map(([k,lbl])=>{
      const v = ab[k];
      const mod = (typeof v === 'number') ? Math.floor((v-10)/2) : null;
      const rollable = mod != null;
      // Clickable when the ability score is set. data-roll-ability/data-mod
      // carry everything needed for the click handler; the visible body is
      // unchanged from the read-only render.
      const cls = 'sheet-ab' + (rollable ? ' rollable' : '');
      const dataAttrs = rollable
        ? ` data-act="roll-check" data-cid="${esc(c.id)}" data-ability="${k}" data-mod="${mod}" title="Click to roll d20${(mod>=0?'+':'')+mod} (Shift = adv · Alt = dis)"`
        : '';
      return `<div class="${cls}"${dataAttrs}><div class="sheet-ab-lbl">${lbl}</div><div class="sheet-ab-val">${v??'—'}</div><div class="sheet-ab-mod">${mod==null?'':(mod>=0?'+':'')+mod}</div></div>`;
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
      const rollable = v != null;
      const extra = rollable
        ? ` data-act="roll-save" data-cid="${esc(c.id)}" data-ability="${k}" data-mod="${v}" title="Click to roll d20${(v>=0?'+':'')+v} save (Shift = adv · Alt = dis)" style="cursor:pointer"`
        : '';
      const cls = 'sheet-stat-row' + (rollable ? ' rollable' : '');
      return `<div class="${cls}"${extra}><span>${lbl} Save</span><span class="sheet-stat-val">${v==null?'—':(v>=0?'+':'')+v}</span></div>`;
    }).join('');
    const prof = sh.profBonus;
    const pp = sh.passivePerception;
    const dexMod = (typeof ab.dex==='number') ? Math.floor((ab.dex-10)/2) : null;
    const computedPP = (typeof ab.wis==='number') ? 10+Math.floor((ab.wis-10)/2) : null;
    // Passive Insight / Investigation — DM-side reference values that come up
    // constantly. 10 + ability mod + (skill prof level × proficiency bonus).
    // Skill prof level uses the same 'expert'/'proficient'/'half'/null values
    // the Skills tab already inspects.
    const skills = sh.skills || {};
    const skillBonus = (lvl) => {
      if (lvl === 'expert' && prof != null)     return prof * 2;
      if (lvl === 'proficient' && prof != null) return prof;
      if (lvl === 'half' && prof != null)       return Math.floor(prof / 2);
      return 0;
    };
    const passiveOf = (abilKey, skillKey) => {
      const m = (typeof ab[abilKey] === 'number') ? Math.floor((ab[abilKey]-10)/2) : null;
      if (m == null) return null;
      return 10 + m + skillBonus(skills[skillKey]);
    };
    const piVal = passiveOf('wis', 'insight');
    const pIVal = passiveOf('int', 'investigation');
    return this._renderLastRoll(c)
      + this._abilityBlock(c)
      + this._renderResistances(c)
      + '<div class="sheet-grid2">'
      + '<div class="sheet-col"><h5>Saving Throws</h5>'+saveRows+'</div>'
      + '<div class="sheet-col"><h5>Vitals</h5>'
      +   `<div class="sheet-stat-row"><span>Proficiency</span><span class="sheet-stat-val">${prof==null?'—':'+'+prof}</span></div>`
      +   `<div class="sheet-stat-row"><span>Passive Perception</span><span class="sheet-stat-val">${pp ?? computedPP ?? '—'}</span></div>`
      +   `<div class="sheet-stat-row"><span>Passive Insight</span><span class="sheet-stat-val">${piVal ?? '—'}</span></div>`
      +   `<div class="sheet-stat-row"><span>Passive Investigation</span><span class="sheet-stat-val">${pIVal ?? '—'}</span></div>`
      +   `<div class="sheet-stat-row rollable" data-act="roll-init" data-cid="${esc(c.id)}" data-mod="${c.init??0}" title="Click to roll initiative (Shift = adv · Alt = dis)" style="cursor:pointer"><span>Initiative</span><span class="sheet-stat-val">${(c.init>=0?'+':'')+(c.init??0)}</span></div>`
      +   `<div class="sheet-stat-row"><span>Speed</span><span class="sheet-stat-val">${c.spd ?? '—'}</span></div>`
      +   `<div class="sheet-stat-row"><span>AC</span><span class="sheet-stat-val">${c.ac ?? '—'}</span></div>`
      + '</div>'
      + '</div>'
      + (sh.languages ? this._renderLanguages(sh.languages) : '')
      + (sh.attacks?.length ? this._renderAttacks(sh.attacks, c) : '');
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

  _renderAttacks(attacks, c){
    // Rows are clickable when atkBonus parses to a number — clicking rolls
    // d20+bonus (with Shift/Alt = adv/dis), then evaluates the damage dice
    // expression. Crits double dice (not modifiers), nat-1 still shows the
    // result but as a miss. Falls back to display-only for ambiguous fields.
    const rows = attacks.map(a => {
      const atkNum = this._parseAtkBonus(a.atkBonus);
      const clickable = (atkNum != null && c && c.id);
      const cls = clickable ? 'attack-row rollable' : 'attack-row';
      const extra = clickable
        ? ` data-act="roll-attack" data-cid="${esc(c.id)}" data-atk="${atkNum}" data-dmg="${esc(a.damage||'')}" data-atk-name="${esc(a.name)}" style="cursor:pointer" title="Click to roll attack (Shift = adv · Alt = dis)"`
        : '';
      return `<tr class="${cls}"${extra}><td>${esc(a.name)}</td><td>${esc(a.atkBonus||'—')}</td><td>${esc(a.damage||'—')}</td></tr>`;
    }).join('');
    return `<div class="sheet-block"><h5>Attacks</h5>
      <table class="sheet-table">
        <thead><tr><th>Name</th><th>Atk</th><th>Damage</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  },

  // Extract a signed integer from atkBonus strings like "+7", "+11/+6/+1"
  // (Extra Attack), "5". Returns null when nothing numeric is found. For
  // multi-attack chains we just use the first bonus — rolling the others is
  // a separate click.
  _parseAtkBonus(s){
    if (s == null) return null;
    const m = String(s).match(/[+-]?\d+/);
    return m ? parseInt(m[0], 10) : null;
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

    // Bucket this character's own skills by proficiency level. Anything they
    // aren't trained in falls into a small "Untrained" group at the bottom.
    const groups = { expert:[], proficient:[], half:[], none:[] };
    keys.forEach(k => {
      let v = skills[k];
      if (v == null){
        const a = ab[SKILL_AB[k]];
        v = (typeof a === 'number') ? Math.floor((a-10)/2) : null;
      }
      const lvl = this._classifyCharSkill(c, k) || 'none';
      groups[lvl].push({ k, label: LABELS[k], v });
    });

    const SECTIONS = [
      { key:'expert',     title:'Expertise',          glyph:'◉' },
      { key:'proficient', title:'Proficient',         glyph:'●' },
      { key:'half',       title:'Half-proficiency',   glyph:'◐' },
    ];
    // Skill rows are clickable to roll d20 + skill modifier. The lookup at
    // click time keys off c.id so reordering the party can't desync the
    // handler. Skipped when there's no usable modifier (no ability score).
    const renderRow = ({ label, v, k }) => {
      const rollable = v != null;
      const extra = rollable
        ? ` data-act="roll-skill" data-cid="${esc(c.id)}" data-skill="${esc(k)}" data-skill-label="${esc(label)}" data-mod="${v}" title="Click to roll ${esc(label)}: d20${(v>=0?'+':'')+v} (Shift = adv · Alt = dis)" style="cursor:pointer"`
        : '';
      const cls = 'sheet-stat-row' + (rollable ? ' rollable' : '');
      return `<div class="${cls}"${extra}><span>${label}</span><span class="sheet-stat-val">${v==null?'—':(v>=0?'+':'')+v}</span></div>`;
    };
    const renderSection = (sec) => {
      const list = groups[sec.key];
      if (!list.length) return '';
      return `<div class="sheet-block sheet-prof-section ${sec.key}">
        <h5><span class="sheet-skill-chip ${sec.key}">${sec.glyph}</span> ${sec.title} <span class="sheet-prof-count">${list.length}</span></h5>
        ${list.map(renderRow).join('')}
      </div>`;
    };

    const trainedHtml = SECTIONS.map(renderSection).join('');
    const untrainedHtml = groups.none.length
      ? `<details class="sheet-prof-untrained"><summary>Untrained (${groups.none.length})</summary>${groups.none.map(renderRow).join('')}</details>`
      : '';

    if (!trainedHtml && !untrainedHtml){
      return this._renderLastRoll(c) + '<div class="sheet-empty">No skill data available.</div>';
    }
    return this._renderLastRoll(c) + '<div class="sheet-skills-prof">'+(trainedHtml || '<div class="sheet-empty">No skill proficiencies on this character.</div>')+untrainedHtml+'</div>';
  },

  _tabSpells(c){
    const sh = c.sheet || {};
    const slots = sh.spellSlots || {};
    const lvls = Object.keys(slots).map(n=>parseInt(n)).sort((a,b)=>a-b);
    let slotsHtml = '';
    if (lvls.length){
      // Slot pips are clickable: click the leftmost available pip to mark a
      // slot expended; click any spent pip to refund. Click handler is keyed
      // off (level, pip-index) so the rendered order is the source of truth.
      // Need PC index for the handler — find via state.party (id-based, so
      // reordering can't desync the wire).
      const pcIdx = state.party.findIndex(p => p.id === c.id);
      slotsHtml = '<div class="sheet-block"><h5>Spell Slots</h5><div class="sheet-slots">'
        + lvls.map(l=>{
            const s = slots[l];
            const total = s.total||0, expended = s.expended||0;
            let pips = '';
            for (let n=1; n<=total; n++){
              const filled = n <= (total - expended);
              pips += `<span class="slot-pip ${filled?'available':'spent'}" data-act="slot-pip" data-idx="${pcIdx}" data-lvl="${l}" data-n="${n}" title="${filled?'Spend a level ' + l + ' slot':'Refund a level ' + l + ' slot'}"></span>`;
            }
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
        + sh.spells.map(s => `<span class="sheet-spell-chip" data-act="spell-open" data-spell="${esc(s)}" title="Click to view ${esc(s)}">${esc(s)}</span>`).join('')
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

  // Manage Party: table modal with inline editing of every character's core stats.
  _openManageParty(){
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const cols = [
      {key:'name',  label:'NAME',        type:'text',   w:160},
      {key:'hp',    label:'HP',          type:'number', w:60},
      {key:'hpMax', label:'MAX HP',      type:'number', w:70},
      {key:'ac',    label:'AC',          type:'number', w:55},
      {key:'init',  label:'INIT',        type:'number', w:55},
      {key:'spd',   label:'SPD',         type:'number', w:55},
      {key:'pp',    label:'PP',          type:'number', w:55},
      {key:'resources',   label:'RESOURCES',   type:'resources', w:180},
      {key:'inspiration', label:'INSPIRATION', type:'bool',      w:90},
    ];
    const resSummary = c => {
      const rs = c.resources || [];
      if (!rs.length) return '<span class="mp-res-empty">+ Add</span>';
      return rs.map(r => r.type === 'toggle'
        ? `<span class="mp-res-chip">${esc(r.name)} ${r.current?'✓':'—'}</span>`
        : `<span class="mp-res-chip">${esc(r.name)} ${r.current}/${r.max}</span>`
      ).join(' ');
    };
    const renderRows = () => state.party.map((c,i) => {
      const cells = cols.map(col => {
        if (col.type === 'bool'){
          return `<td class="mp-cell mp-cell-bool"><button class="mp-bool ${c[col.key]?'on':''}" data-act="mp-bool" data-i="${i}" data-k="${col.key}">${c[col.key]?'Yes':'No'}</button></td>`;
        }
        if (col.type === 'resources'){
          return `<td class="mp-cell mp-cell-resources" data-act="mp-res" data-i="${i}" title="Click to edit resources">${resSummary(c)}</td>`;
        }
        const v = c[col.key]==null?'':c[col.key];
        return `<td class="mp-cell"><input class="mp-input" type="${col.type}" data-i="${i}" data-k="${col.key}" value="${esc(String(v))}"></td>`;
      }).join('');
      return `<tr>
        <td class="mp-cell mp-cell-icon">${renderIcon(c.icon||'⚔', c.name)}</td>
        ${cells}
        <td class="mp-cell mp-cell-details"><button class="btn icon-btn" data-act="mp-details" data-i="${i}" title="Edit class, level, race, abilities, hit dice">✎</button></td>
        <td class="mp-cell mp-cell-del"><button class="btn icon-btn danger" data-act="mp-del" data-i="${i}" title="Remove character">🗑</button></td>
      </tr>`;
    }).join('');
    const renderModal = () => {
      backdrop.innerHTML = `<div class="modal mp-modal" role="dialog" aria-modal="true">
        <div class="rh rh-n"  data-rh="n"></div>
        <div class="rh rh-s"  data-rh="s"></div>
        <div class="rh rh-e"  data-rh="e"></div>
        <div class="rh rh-w"  data-rh="w"></div>
        <div class="rh rh-ne" data-rh="ne"></div>
        <div class="rh rh-nw" data-rh="nw"></div>
        <div class="rh rh-se" data-rh="se"></div>
        <div class="rh rh-sw" data-rh="sw"></div>
        <div class="mp-head">
          <h3 style="margin:0">Manage Party</h3>
          <button class="btn icon-btn" data-act="mp-close" title="Close">×</button>
        </div>
        <div class="mp-table-wrap">
          <table class="mp-table">
            <thead><tr>
              <th></th>
              ${cols.map(col => `<th style="min-width:${col.w}px">${col.label}</th>`).join('')}
              <th></th>
              <th></th>
            </tr></thead>
            <tbody>${renderRows()}</tbody>
          </table>
        </div>
        <div class="mp-foot">
          <span class="mp-count">${state.party.length} member${state.party.length===1?'':'s'}</span>
          <button class="btn primary" data-act="mp-add">+ Add Member</button>
        </div>
      </div>`;
      wire();
    };
    const wire = () => {
      backdrop.querySelectorAll('input.mp-input').forEach(inp => {
        inp.addEventListener('change', e => {
          const i = +e.target.dataset.i, k = e.target.dataset.k;
          const c = state.party[i]; if (!c) return;
          let v = e.target.value;
          if (e.target.type === 'number') v = v === '' ? 0 : Number(v);
          state.party[i] = {...c, [k]: v};
          save();
          this._render();
        });
      });
      backdrop.querySelectorAll('[data-act="mp-bool"]').forEach(btn => btn.addEventListener('click', e => {
        const i = +e.currentTarget.dataset.i, k = e.currentTarget.dataset.k;
        const c = state.party[i]; if (!c) return;
        state.party[i] = {...c, [k]: !c[k]};
        save();
        this._render();
        renderModal();
      }));
      backdrop.querySelectorAll('[data-act="mp-res"]').forEach(td => td.addEventListener('click', e => {
        const i = +e.currentTarget.dataset.i;
        this._openResourcesEditor(i, () => renderModal());
      }));
      backdrop.querySelectorAll('[data-act="mp-details"]').forEach(btn => btn.addEventListener('click', e => {
        const i = +e.currentTarget.dataset.i;
        this._openCharDetailsEditor(i, () => renderModal());
      }));
      backdrop.querySelectorAll('[data-act="mp-del"]').forEach(btn => btn.addEventListener('click', e => {
        const i = +e.currentTarget.dataset.i;
        const c = state.party[i]; if (!c) return;
        showConfirm(`Remove ${c.name}?`, {title:'Remove character', confirmLabel:'Remove'}).then(ok => {
          if (!ok) return;
          state.party.splice(i,1);
          save();
          this._render();
          renderModal();
        });
      }));
      backdrop.querySelector('[data-act="mp-add"]')?.addEventListener('click', () => {
        state.party.push({id:uid(),name:'New Character',cls:'fighter',icon:'⚔',hp:30,hpMax:30,ac:14,init:0,spd:30,pp:10,inspiration:false,resources:[]});
        save();
        this._render();
        renderModal();
      });
      backdrop.querySelector('[data-act="mp-close"]')?.addEventListener('click', () => backdrop.remove());
      this._wireMpResize();
    };
    document.body.appendChild(backdrop);
    renderModal();
    backdrop.addEventListener('mousedown', e => { if (e.target===backdrop) backdrop.remove(); });
  },

  // 8-direction edge/corner resize for the Manage Party modal. Unlike the
  // built-in CSS `resize:both` (corner only), these handles let the user
  // pull from any edge or corner. Applies width/height inline; the modal's
  // flex centering keeps it visually centered while resizing.
  _wireMpResize(){
    const modal = document.querySelector('.mp-modal');
    if (!modal) return;
    const MIN_W = 520, MIN_H = 280;
    let rs = null;
    const onDown = e => {
      const handle = e.target.closest('[data-rh]');
      if (!handle || !modal.contains(handle)) return;
      e.preventDefault(); e.stopPropagation();
      const r = modal.getBoundingClientRect();
      rs = { dir: handle.dataset.rh, sx: e.clientX, sy: e.clientY, w: r.width, h: r.height };
    };
    const onMove = e => {
      if (!rs) return;
      const dx = e.clientX - rs.sx, dy = e.clientY - rs.sy;
      let w = rs.w, h = rs.h;
      // Centered modal: dragging east OR west grows/shrinks symmetrically by
      // 2× the cursor delta so the cursor stays under the dragged edge.
      if (rs.dir.includes('e')) w = rs.w + dx * 2;
      if (rs.dir.includes('w')) w = rs.w - dx * 2;
      if (rs.dir.includes('s')) h = rs.h + dy * 2;
      if (rs.dir.includes('n')) h = rs.h - dy * 2;
      w = Math.max(MIN_W, Math.min(window.innerWidth  - 20, w));
      h = Math.max(MIN_H, Math.min(window.innerHeight - 20, h));
      modal.style.width  = w + 'px';
      modal.style.height = h + 'px';
    };
    const onUp = () => { rs = null; };
    modal.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    // Clean up the document-level listeners when the modal closes. The
    // backdrop is removed via .remove() — observe its removal to detach.
    const obs = new MutationObserver(() => {
      if (!document.body.contains(modal)){
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList:true, subtree:true });
  },

  // Per-character resources editor (popup over Manage Party).
  _openResourcesEditor(i, onClose){
    const c = state.party[i]; if (!c) return;
    if (!c.resources) c.resources = [];
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const renderRows = () => (c.resources.length
      ? c.resources.map((r, ri) => `
          <div class="mp-res-row">
            <input class="mp-input" data-ri="${ri}" data-k="name" value="${esc(r.name||'')}" placeholder="Name" style="flex:1">
            <select class="mp-input" data-ri="${ri}" data-k="type" style="width:90px">
              <option value="pool"${r.type==='pool'?' selected':''}>Pool</option>
              <option value="toggle"${r.type==='toggle'?' selected':''}>Toggle</option>
            </select>
            ${r.type==='toggle'
              ? `<button class="mp-bool ${r.current?'on':''}" data-rk-toggle="${ri}">${r.current?'On':'Off'}</button>`
              : `<input class="mp-input" type="number" data-ri="${ri}" data-k="current" value="${r.current}" style="width:60px">
                 <span style="color:var(--text-dim)">/</span>
                 <input class="mp-input" type="number" data-ri="${ri}" data-k="max" value="${r.max}" style="width:60px">`}
            <button class="btn icon-btn danger" data-rm="${ri}" title="Remove resource">×</button>
          </div>`).join('')
      : '<div style="color:var(--text-muted);font-size:11px;padding:8px 0">No resources yet — add one below.</div>');
    const renderModal = () => {
      backdrop.innerHTML = `<div class="modal mp-edit-modal" role="dialog" aria-modal="true">
        <div class="mp-head"><h3 style="margin:0">Resources — ${esc(c.name)}</h3><button class="btn icon-btn" data-close>×</button></div>
        <div class="mp-edit-body"><div class="mp-res-list">${renderRows()}</div>
          <div style="margin-top:10px"><button class="btn primary" data-add>+ Add resource</button></div>
        </div>
        <div class="mp-foot"><span></span><button class="btn" data-close>Done</button></div>
      </div>`;
      wire();
    };
    const wire = () => {
      backdrop.querySelectorAll('input.mp-input,select.mp-input').forEach(el => el.addEventListener('change', e => {
        const ri = +e.target.dataset.ri, k = e.target.dataset.k;
        const r = c.resources[ri]; if (!r) return;
        let v = e.target.value;
        if (e.target.type === 'number') v = v === '' ? 0 : Number(v);
        r[k] = v;
        if (k === 'type'){
          if (v === 'toggle'){ r.current = r.current ? 1 : 0; r.max = 1; }
          else if (!r.max) { r.max = 1; r.current = Math.min(r.current, r.max); }
        }
        if (k === 'max') r.current = Math.min(r.current, r.max);
        save();
        this._render();
        renderModal();
      }));
      backdrop.querySelectorAll('[data-rk-toggle]').forEach(btn => btn.addEventListener('click', e => {
        const ri = +e.currentTarget.dataset.rkToggle;
        const r = c.resources[ri]; if (!r) return;
        r.current = r.current ? 0 : 1;
        save(); this._render(); renderModal();
      }));
      backdrop.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', e => {
        const ri = +e.currentTarget.dataset.rm;
        c.resources.splice(ri, 1);
        save(); this._render(); renderModal();
      }));
      backdrop.querySelector('[data-add]').addEventListener('click', () => {
        c.resources.push({name:'New Resource', type:'pool', current:1, max:1});
        save(); this._render(); renderModal();
      });
      backdrop.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    };
    const close = () => { backdrop.remove(); if (onClose) onClose(); };
    document.body.appendChild(backdrop);
    renderModal();
    backdrop.addEventListener('mousedown', e => { if (e.target===backdrop) close(); });
  },

  // Per-character details editor: class, level, race, background, abilities, hit dice.
  _openCharDetailsEditor(i, onClose){
    const c = state.party[i]; if (!c) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const abKeys = [['str','STR'],['dex','DEX'],['con','CON'],['int','INT'],['wis','WIS'],['cha','CHA']];
    const renderModal = () => {
      const ab = c.abilities || {};
      const hd = c.hitDice;
      backdrop.innerHTML = `<div class="modal mp-edit-modal" role="dialog" aria-modal="true">
        <div class="mp-head"><h3 style="margin:0">Edit details — ${esc(c.name)}</h3><button class="btn icon-btn" data-close>×</button></div>
        <div class="mp-edit-body">
          <div class="mp-edit-section">
            <div class="mp-edit-grid">
              <label>Class<input class="mp-input" data-k="cls" value="${esc(c.cls||'')}" placeholder="Fighter, Wizard, …"></label>
              <label>Subclass<input class="mp-input" data-k="subclass" value="${esc(c.subclass||'')}" placeholder="Battle Master, Evocation, …"></label>
              <label>Level<input class="mp-input" type="number" data-k="level" value="${c.level==null?'':c.level}"></label>
              <label>Race<input class="mp-input" data-k="race" value="${esc(c.race||'')}" placeholder="Human, High Elf, …"></label>
              <label>Background<input class="mp-input" data-k="background" value="${esc(c.background||'')}"></label>
            </div>
          </div>
          <div class="mp-edit-section">
            <div class="mp-edit-section-head">Abilities</div>
            <div class="mp-ability-grid">
              ${abKeys.map(([k,lbl]) => `<label>${lbl}<input class="mp-input" type="number" data-ak="${k}" value="${ab[k]==null?'':ab[k]}"></label>`).join('')}
            </div>
          </div>
          <div class="mp-edit-section">
            <div class="mp-edit-section-head">Hit dice</div>
            ${hd
              ? `<div class="mp-edit-grid mp-edit-grid-3">
                   <label>Die type<select class="mp-input" data-hd="dieType">
                     ${['d6','d8','d10','d12'].map(d => `<option value="${d}"${(hd.dieType||'d8')===d?' selected':''}>${d}</option>`).join('')}
                   </select></label>
                   <label>Current<input class="mp-input" type="number" data-hd="current" value="${hd.current}"></label>
                   <label>Max<input class="mp-input" type="number" data-hd="max" value="${hd.max}"></label>
                 </div>`
              : `<button class="btn" data-hd-init>+ Initialize hit dice</button>`}
          </div>
        </div>
        <div class="mp-foot"><span></span><button class="btn" data-close>Done</button></div>
      </div>`;
      wire();
    };
    const wire = () => {
      backdrop.querySelectorAll('input.mp-input[data-k],select.mp-input[data-k]').forEach(el => el.addEventListener('change', e => {
        const k = e.target.dataset.k;
        let v = e.target.value;
        if (e.target.type === 'number') v = v === '' ? 0 : Number(v);
        state.party[i] = {...state.party[i], [k]: v};
        save(); this._render();
      }));
      backdrop.querySelectorAll('[data-ak]').forEach(el => el.addEventListener('change', e => {
        const k = e.target.dataset.ak;
        const ab = {...(state.party[i].abilities || {})};
        ab[k] = e.target.value === '' ? 0 : Number(e.target.value);
        state.party[i] = {...state.party[i], abilities: ab};
        save(); this._render();
      }));
      backdrop.querySelectorAll('[data-hd]').forEach(el => el.addEventListener('change', e => {
        const k = e.target.dataset.hd;
        const hd = {...(state.party[i].hitDice || {dieType:'d8',current:0,max:0})};
        let v = e.target.value;
        if (e.target.type === 'number') v = v === '' ? 0 : Number(v);
        hd[k] = v;
        if (k === 'max') hd.current = Math.min(hd.current, hd.max);
        state.party[i] = {...state.party[i], hitDice: hd};
        save(); this._render();
      }));
      backdrop.querySelector('[data-hd-init]')?.addEventListener('click', () => {
        const lvl = state.party[i].level || 1;
        state.party[i] = {...state.party[i], hitDice: {dieType:'d8', current:lvl, max:lvl}};
        save(); this._render(); renderModal();
      });
      backdrop.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    };
    const close = () => { backdrop.remove(); if (onClose) onClose(); };
    document.body.appendChild(backdrop);
    renderModal();
    backdrop.addEventListener('mousedown', e => { if (e.target===backdrop) close(); });
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
        if (e.target.closest('input,select,textarea,button,.icon-picker,.pip,.party-hp-dmg,.slot-pip,.party-hp-type')){ e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-skt-party-pi', card.dataset.cidx);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', ()=>card.classList.remove('dragging'));
      // Right-click (or long-press on mobile) the Heroic Inspiration row to award via a pre-set reason.
      const inspRow = card.querySelector('[data-act="insp"]');
      const openInspMenu = (x, y) => {
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
        showContextMenu(x, y, items);
      };
      inspRow?.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        openInspMenu(e.clientX, e.clientY);
      });
      if (inspRow) addLongPress(inspRow, openInspMenu);
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
        if(['hp','hpMax','ac','init','spd','tempHp'].includes(f))v=parseInt(v)||0;
        // Temp HP can never go negative — taking damage just zeroes it out
        // before any further damage hits real HP, but the field itself
        // shouldn't display a negative buffer.
        if (f === 'tempHp' && v < 0) v = 0;
        state.party[i]={...state.party[i],[f]:v};
        // Mirror to the combat slot BEFORE saving so localStorage (and the
        // resulting Firebase push) captures both halves in one write. If the
        // sync happened after save(), the persisted value would be stale and
        // a later save anywhere could push the old combatants back out.
        if(['hp','hpMax','ac'].includes(f))syncPartyToCombat(i);
        save();
        // Re-render just this card's HP bar without full re-render
        if(f==='hp'||f==='hpMax'||f==='tempHp'){
          const card=b.querySelector('[data-cidx="'+i+'"]');
          if(card){
            const p=state.party[i];
            const hp=this._hpBarStyle(p);
            const wrap=card.querySelector('.hp-bar-wrap');
            const bar=card.querySelector('.hp-bar-fill');
            if(wrap) wrap.classList.toggle('hp-surplus', hp.surplus);
            if(bar){bar.style.width=hp.pct+'%';bar.style.background=hp.color;}
          }
        }
      });
      inp.addEventListener('click',e=>e.stopPropagation());
    });

    // Heal/damage amount input — suppress drag/card-click and persist the
    // typed value across renders so the DM doesn't have to re-type.
    b.querySelectorAll('.party-hp-amt').forEach(inp => {
      inp.addEventListener('click', e => e.stopPropagation());
      inp.addEventListener('mousedown', e => e.stopPropagation());
      inp.addEventListener('change', () => {
        const v = parseInt(inp.value) || 0;
        if (v > 0) this._lastDmgAmount = v;
      });
    });

    // Damage-type select — same suppress + persist-last-choice dance, plus
    // updating the overlay abbreviation label. Map kept here so both render
    // path and change path agree on the 2-letter codes.
    const ABBR = {'':'—','acid':'ac','bludgeoning':'bl','cold':'co','fire':'fi','force':'fo','lightning':'li','necrotic':'ne','piercing':'pi','poison':'po','psychic':'ps','radiant':'ra','slashing':'sl','thunder':'th'};
    b.querySelectorAll('.party-hp-type').forEach(sel => {
      sel.addEventListener('click', e => e.stopPropagation());
      sel.addEventListener('mousedown', e => e.stopPropagation());
      sel.addEventListener('change', () => {
        this._lastDmgType = sel.value;
        const lbl = sel.parentElement?.querySelector('.party-hp-type-label');
        if (lbl) lbl.textContent = ABBR[sel.value] || '—';
        const wrap = sel.parentElement;
        if (wrap) wrap.title = 'Damage type — applies this PC\'s resist/vuln/immune (set them in the Stats tab; current: ' + (sel.value || 'untyped') + ')';
      });
    });

    // (Inventory tab removed — no inv-edit wiring needed.)

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
      // Concentration set/drop — set prompts for the spell name; drop clears.
      else if(act==='conc-set'){
        const cur = state.party[i].concentration || '';
        showModal('Concentration spell', [
          { id:'spell', label:'Spell name', type:'text', value:cur, placeholder:'Bless · Hex · Haste · Spiritual Weapon …' },
        ], 'Save').then(r => {
          if (!r) return;
          const name = (r.spell||'').trim();
          state.party[i] = {...state.party[i], concentration: name || null};
          save(); this._render();
        });
      }
      else if(act==='conc-drop'){
        state.party[i] = {...state.party[i], concentration: null};
        save(); this._render();
      }
      // Exhaustion stepper — clamped 0–6 per 2024 rules.
      else if(act==='exh-up'){
        const cur = +state.party[i].exhaustion || 0;
        state.party[i] = {...state.party[i], exhaustion: Math.min(6, cur + 1)};
        save(); this._render();
      }
      else if(act==='exh-down'){
        const cur = +state.party[i].exhaustion || 0;
        state.party[i] = {...state.party[i], exhaustion: Math.max(0, cur - 1)};
        save(); this._render();
      }
      else if(act==='add'){
        state.party.push({id:uid(),name:'New Character',cls:'fighter',icon:'⚔',hp:30,hpMax:30,ac:14,init:0,spd:30,pp:10,inspiration:false,resources:[]});
        save();this._render();
      }
      else if(act==='import-pdf'){
        this._importPdf();
      }
      else if(act==='party-skills'){
        this._openPartySkills();
      }
      else if(act==='spell-open'){
        this._openSpellDetail(el.dataset.spell);
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
      else if(act==='roll-check' || act==='roll-save' || act==='roll-init' || act==='roll-skill'){
        // d20 roller — Shift = advantage, Alt = disadvantage.
        const cid = el.dataset.cid;
        const c = state.party.find(p => p.id === cid);
        if (!c) return;
        const mod = parseInt(el.dataset.mod) || 0;
        const mode = e.shiftKey ? 'adv' : e.altKey ? 'dis' : 'normal';
        const abilityLabel = (el.dataset.ability || '').toUpperCase();
        let label;
        if (act === 'roll-init')        label = c.name + ' · Initiative';
        else if (act === 'roll-save')   label = c.name + ' · ' + abilityLabel + ' Save';
        else if (act === 'roll-skill')  label = c.name + ' · ' + (el.dataset.skillLabel || 'Skill');
        else                             label = c.name + ' · ' + abilityLabel + ' Check';
        const result = this._rollD20(mod, { mode, label });
        this._setLastRoll(c, result);
      }
      else if(act==='hd-spend'){
        const idx = +el.dataset.idx, n = +el.dataset.n;
        const c = state.party[idx]; if (!c || !c.hitDice) return;
        if (n > c.hitDice.current) return; // empty pip — ignore
        this._spendHitDie(idx);
      }
      // Heal/damage strip — same shape as the combat tracker's. Reads the
      // amount from this card's own input, drains tempHp first, and mirrors
      // the change into any active combat slot via _applyHpDelta.
      else if(act==='hp-heal' || act==='hp-damage'){
        const card = el.closest('.char-card');
        const amtInp = card?.querySelector('.party-hp-amt');
        const typeSel = card?.querySelector('.party-hp-type');
        const amt = Math.max(0, parseInt(amtInp?.value) || 0);
        if (!amt) return;
        this._lastDmgAmount = amt;
        const type = typeSel ? typeSel.value : '';
        if (act === 'hp-damage') this._applyHpDelta(i, -amt, type);
        else                     this._applyHpDelta(i, +amt);
      }
      // Spell-slot pip — toggle expended state on sheet.spellSlots[lvl]. Click
      // an available pip to spend, click a spent pip to refund.
      else if(act==='slot-pip'){
        const lvl = parseInt(el.dataset.lvl);
        const n   = parseInt(el.dataset.n);     // 1-based pip index
        const c = state.party[i]; if (!c || !c.sheet?.spellSlots?.[lvl]) return;
        const slot = c.sheet.spellSlots[lvl];
        const total = slot.total || 0;
        const available = total - (slot.expended || 0);
        // Pip N=1 is leftmost (available pips drawn first, then spent). To
        // map pip-index back to action: if N <= available → spend (expended++);
        // else → refund (expended--).
        let exp = slot.expended || 0;
        if (n <= available)  exp = Math.min(total, exp + 1);
        else                 exp = Math.max(0, exp - 1);
        const newSlots = {...c.sheet.spellSlots, [lvl]: {...slot, expended: exp}};
        state.party[i] = {...c, sheet: {...c.sheet, spellSlots: newSlots}};
        save(); this._render();
      }
      // Attack row click — d20 + atk bonus, then roll damage dice. Shift =
      // advantage, Alt = disadvantage. Crits double damage dice (not modifiers).
      else if(act==='roll-attack'){
        const cid = el.dataset.cid;
        const c = state.party.find(p => p.id === cid);
        if (!c) return;
        const atkBonus = parseInt(el.dataset.atk) || 0;
        const dmgExpr = el.dataset.dmg || '';
        const name = el.dataset.atkName || 'Attack';
        const mode = e.shiftKey ? 'adv' : e.altKey ? 'dis' : 'normal';
        const result = this._rollAttack(c, name, atkBonus, dmgExpr, mode);
        this._setLastRoll(c, result);
      }
      // (long-rest / short-rest live in the window-options menu now, not a
      // top-of-panel toolbar; their handlers are reachable via menuItems().)
      // Rage toggle — flips c.rage. Damage handler honors the B/P/S resist
      // on damage with one of those types when c.rage is true. No data
      // mutation beyond the flag — players & DMs still narrate the rest.
      else if(act==='rage-on'){
        state.party[i] = {...state.party[i], rage: true};
        save(); this._render();
        showToast(state.party[i].name + ' enters a rage');
      }
      else if(act==='rage-off'){
        state.party[i] = {...state.party[i], rage: false};
        save(); this._render();
        showToast(state.party[i].name + '\'s rage ends');
      }
      else if(act==='ws-start') this._editWildShape(i);
      else if(act==='ws-edit')  this._editWildShape(i);
      else if(act==='ws-end')   this._endWildShape(i);
      // (expand-all / collapse-all removed; per-card toggle on each sheet
      // remains the only path to open/close a sheet.)
      // Resist/Immune/Vuln editor — toggle visible state per-PC; cycle a type
      // through the four states (none → resist → immune → vulnerable → none).
      else if(act==='resist-toggle'){
        const cid = el.dataset.cid;
        if (!this._resistancesOpen) this._resistancesOpen = {};
        this._resistancesOpen[cid] = !this._resistancesOpen[cid];
        this._render();
      }
      else if(act==='resist-cycle'){
        const idx = +el.dataset.idx, type = el.dataset.type, next = el.dataset.next;
        const c = state.party[idx]; if (!c) return;
        const drop = (key) => { c[key] = (c[key]||[]).filter(t => String(t).toLowerCase() !== type); };
        drop('resistances'); drop('immunities'); drop('vulnerabilities');
        const map = { resist:'resistances', immune:'immunities', vulnerable:'vulnerabilities' };
        if (map[next]){
          c[map[next]] = [...(c[map[next]]||[]), type];
        }
        save(); this._render();
      }
      // One-click add-or-remove this PC from combat. Calls into combat.js
      // for the add path so name-numbering, init-mod, portrait, etc. all use
      // the same code as drag-drop. Remove uses splice + _render.
      else if(act==='toggle-combat'){
        const c = state.party[i]; if (!c) return;
        const cIdx = state.combatants.findIndex(co => co.id === c.id);
        if (cIdx >= 0){
          state.combatants.splice(cIdx, 1);
          // If we removed the active turn, advance to the next combatant or
          // clear if list is empty. Combat panel re-renders cleanly either way.
          if (state.activeCombatantId === c.id){
            state.activeCombatantId = state.combatants[0]?.id || null;
          }
          save(); this._render(); panelDefs.combat?._render?.();
          showToast(c.name + ' removed from combat');
        } else {
          // Reuse combat.js's _addPartyToCombat so init-mod / portrait / etc.
          // get computed the same way as a drag-drop. Falls back to a minimal
          // push when the combat panel isn't loaded.
          if (panelDefs.combat && typeof panelDefs.combat._addPartyToCombat === 'function'){
            panelDefs.combat._addPartyToCombat(i);
          } else {
            const dexMod = (c.abilities && typeof c.abilities.dex==='number') ? Math.floor((c.abilities.dex-10)/2) : 0;
            state.combatants.push({id:c.id, name:c.name, isPC:true, cls:c.cls||'fighter', hp:c.hp, hpMax:c.hpMax, ac:c.ac, initBonus: c.init || dexMod, initiative: c.init || 0, conditions:[]});
            if (!state.combatRound) state.combatRound = 1;
            save();
          }
          this._render();
          showToast(c.name + ' added to combat');
        }
      }
      // Condition chip × removes from BOTH combat slot and party-side list
      // (a chip can come from either). Belt and suspenders.
      else if(act==='cond-remove'){
        const cond = el.dataset.cond;
        const c = state.party[i]; if (!c) return;
        if (Array.isArray(c.conditions)){
          c.conditions = c.conditions.filter(x => x !== cond);
        }
        const co = state.combatants.find(x => x.id === c.id);
        if (co && Array.isArray(co.conditions)){
          co.conditions = co.conditions.filter(x => x !== cond);
        }
        save(); this._render(); panelDefs.combat?._render?.();
      }
      // "+ Cond" pill — open the same condition list the combat tracker uses.
      // SEARCH_DATA is the data-loader's flat catalog with cat:'condition'.
      else if(act==='cond-add'){
        const c = state.party[i]; if (!c) return;
        const conds = (typeof SEARCH_DATA !== 'undefined')
          ? SEARCH_DATA.filter(d => d.cat === 'condition')
          : [];
        if (!conds.length){ showToast('Condition list not loaded yet'); return; }
        const rect = el.getBoundingClientRect();
        // Show as a context menu — checked entries are already on the PC so
        // clicking unchecks them, otherwise it adds.
        const co = state.combatants.find(x => x.id === c.id);
        const have = new Set([...(c.conditions||[]), ...(co?.conditions||[])]);
        const items = conds.map(d => ({
          label: d.name,
          checked: have.has(d.name),
          onClick: () => this._toggleCondition(i, d.name),
        }));
        showContextMenu(rect.left, rect.bottom + 4, items);
      }
      // (Inventory tab removed.)
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
      else if(act==='pip-step'){
        // Compact-mode +/- button on large pools. Clamps to [0, max].
        const ri=+el.dataset.ri, dir=parseInt(el.dataset.dir,10)||0;
        const res=[...state.party[i].resources];
        const r={...res[ri]};
        r.current = Math.max(0, Math.min(r.max||0, (r.current||0) + dir));
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

  // ── Spell quick-view ────────────────────────────────────────────────────
  // Resolves a spell name to its 5e entry and opens the standard popout
  // detail (same window the global search uses). Falls back to a toast if
  // the 5e dataset isn't loaded yet or the name doesn't match.
  _openSpellDetail(name){
    if (!name) return;
    if (typeof _5eLoaded === 'undefined' || !_5eLoaded || !Array.isArray(_5eData)){
      showToast?.('5e data still loading — try again in a moment'); return;
    }
    const lower = name.trim().toLowerCase();
    // Exact match first; if the PDF saved the name with an "(Concentration)"
    // / "(Ritual)" suffix or extra whitespace, retry against the prefix only.
    let match = _5eData.find(d => d.cat === 'spell' && d.name.toLowerCase() === lower);
    if (!match){
      const stripped = lower.replace(/\s*\(.*\)\s*$/, '').trim();
      if (stripped !== lower){
        match = _5eData.find(d => d.cat === 'spell' && d.name.toLowerCase() === stripped);
      }
    }
    if (!match){
      // Fuzzy startsWith fallback so "Cure Wo…" still finds Cure Wounds.
      match = _5eData.find(d => d.cat === 'spell' && d.name.toLowerCase().startsWith(lower));
    }
    if (match && typeof popOutDetail === 'function'){ popOutDetail(match); return; }
    showToast?.(`No 5e entry for "${name}"`);
  },

  // ── Party-wide skills overview ──────────────────────────────────────────
  // Inspects each character's saved skill modifier and infers proficiency
  // level by comparing it against (ability mod) + (k × prof bonus). Returns
  // 'expert' / 'proficient' / 'half' / null per skill per character.
  _classifyCharSkill(c, skillKey){
    const sh = c.sheet || {};
    const skills = sh.skills || {};
    const ab = c.abilities || {};
    const SKILL_AB = {
      acrobatics:'dex', animalHandling:'wis', arcana:'int', athletics:'str',
      deception:'cha', history:'int', insight:'wis', intimidation:'cha',
      investigation:'int', medicine:'wis', nature:'int', perception:'wis',
      performance:'cha', persuasion:'cha', religion:'int',
      sleightOfHand:'dex', stealth:'dex', survival:'wis',
    };
    const skillMod = skills[skillKey];
    if (typeof skillMod !== 'number') return null;
    const abVal = ab[SKILL_AB[skillKey]];
    if (typeof abVal !== 'number') return null;
    const abMod = Math.floor((abVal - 10) / 2);
    // Default proficiency bonus if the sheet doesn't carry one — derive from
    // any saved level, fall back to +2.
    let prof = sh.profBonus;
    if (typeof prof !== 'number'){
      const lvl = c.level || sh.level || 1;
      prof = 2 + Math.floor((Math.max(1, lvl) - 1) / 4);
    }
    const diff = skillMod - abMod;
    if (diff <= 0) return null;                           // no proficiency
    if (diff === Math.floor(prof / 2)) return 'half';     // Jack of All Trades
    if (diff === prof) return 'proficient';
    if (diff >= prof * 2) return 'expert';
    // Off-by-one or partial bonuses (e.g. magic items): treat as proficient.
    if (diff < prof) return 'half';
    return 'proficient';
  },

  _openPartySkills(){
    const SKILL_LABELS = {
      acrobatics:'Acrobatics (DEX)', animalHandling:'Animal Handling (WIS)',
      arcana:'Arcana (INT)', athletics:'Athletics (STR)', deception:'Deception (CHA)',
      history:'History (INT)', insight:'Insight (WIS)', intimidation:'Intimidation (CHA)',
      investigation:'Investigation (INT)', medicine:'Medicine (WIS)', nature:'Nature (INT)',
      perception:'Perception (WIS)', performance:'Performance (CHA)', persuasion:'Persuasion (CHA)',
      religion:'Religion (INT)', sleightOfHand:'Sleight of Hand (DEX)',
      stealth:'Stealth (DEX)', survival:'Survival (WIS)',
    };
    const skillKeys = Object.keys(SKILL_LABELS);

    // Gather { skillKey: [{character, level}] } in alphabetical character order.
    const bySkill = {};
    skillKeys.forEach(k => bySkill[k] = []);
    state.party.forEach(c => {
      skillKeys.forEach(k => {
        const lvl = this._classifyCharSkill(c, k);
        if (lvl) bySkill[k].push({c, lvl});
      });
    });
    // Skills no one has → list separately at the end.
    const covered = skillKeys.filter(k => bySkill[k].length);
    const uncovered = skillKeys.filter(k => !bySkill[k].length);

    const LEVEL_RANK = { expert:0, proficient:1, half:2 };
    const LEVEL_BADGE = {
      expert:     '<span class="ps-badge expert" title="Expertise (×2 prof)">◉ Expert</span>',
      proficient: '<span class="ps-badge prof"   title="Proficient">● Prof</span>',
      half:       '<span class="ps-badge half"   title="Half proficiency (Jack of All Trades / Remarkable Athlete)">◐ Half</span>',
    };

    const renderRow = (k) => {
      const entries = bySkill[k].slice().sort((a,b) =>
        LEVEL_RANK[a.lvl] - LEVEL_RANK[b.lvl] || a.c.name.localeCompare(b.c.name)
      );
      const chips = entries.map(({c, lvl}) =>
        `<span class="ps-chip ${lvl}"><span class="ps-chip-name">${esc(c.name)}</span>${LEVEL_BADGE[lvl]}</span>`
      ).join('');
      return `<div class="ps-row">
        <div class="ps-skill-name">${esc(SKILL_LABELS[k])}</div>
        <div class="ps-chips">${chips || '<span class="ps-empty">— No one</span>'}</div>
      </div>`;
    };

    const coveredHtml = covered.map(renderRow).join('');
    const uncoveredHtml = uncovered.length
      ? '<div class="ps-uncovered-head">Skills no one has trained:</div>'
        + '<div class="ps-uncovered">' + uncovered.map(k => esc(SKILL_LABELS[k])).join(', ') + '</div>'
      : '';

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:560px;max-width:94vw;max-height:82vh;display:flex;flex-direction:column;padding:18px 20px">
      <h3 style="margin:0 0 4px">Party Skills</h3>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
        Inferred from each character's skill modifier vs ability score and proficiency bonus.
        <span class="ps-badge expert" style="margin:0 2px">◉ Expert</span>
        <span class="ps-badge prof"   style="margin:0 2px">● Prof</span>
        <span class="ps-badge half"   style="margin:0 2px">◐ Half</span>
      </div>
      <div class="ps-list" style="flex:1;overflow-y:auto;padding-right:4px">${coveredHtml}${uncoveredHtml}</div>
      <div class="modal-actions" style="margin-top:14px"><button class="btn primary" id="ps-close">Close</button></div>
    </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('#ps-close').addEventListener('click', close);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
    backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    setTimeout(() => backdrop.querySelector('#ps-close')?.focus(), 30);
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
