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
  // Last heal/damage amount + type, PER character id. Panel-scoping these (one
  // value for the whole panel) bled the type between PCs — set "fire" on one
  // card and every other card's quick-damage defaulted to fire, silently
  // applying the wrong resist/vuln math. Keyed by id, each card remembers its
  // own. (Combat keeps its panel-scoped versions on purpose — group rows
  // inherit the type there.)
  _lastDmgType:{},
  _lastDmgAmount:{},
  mount(body){
    this._body=body;
    // Body-level click listener for the "click outside to close the icon
    // picker" affordance. Attached ONCE per mount instead of inside _wire()
    // — _wire runs on every _render(), so attaching there leaked a new
    // listener per interaction (eventually thousands per session, each
    // running the picker-close check on every click). The handler closes
    // over `this`, not the picker state, so it reads the current value.
    if (!this._bodyClickHandler){
      this._bodyClickHandler = (e) => {
        // [data-act] dispatch is delegated here too — the body element
        // survives _render() (innerHTML only swaps its children), so one
        // listener replaces re-attaching every card's action buttons on
        // every render. Actions swallow the click (same net effect as the
        // old per-element stopPropagation), so an action click never falls
        // through to the picker-close branch below.
        const actEl = e.target.closest('[data-act]');
        if (actEl && this._body && this._body.contains(actEl)){
          this._onAction(actEl, e);
          return;
        }
        // Form fields kept their clicks to themselves before (per-element
        // stopPropagation) — preserve that: never treat them as "outside".
        if (e.target.matches('input,select,textarea')) return;
        if (this._pickerOpen !== null){
          this._pickerOpen = null;
          this._render();
        }
      };
      body.addEventListener('click', this._bodyClickHandler);
    }
    this._render();
  },
  unmount(){
    if (this._body && this._bodyClickHandler){
      this._body.removeEventListener('click', this._bodyClickHandler);
    }
    this._bodyClickHandler = null;
    this._body = null;
  },
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
      // Compact "party glance" mode — one-row-per-character layout. Stored
      // as a setting so it persists across reloads & syncs.
      const compact = !!(state.settings && state.settings.partyCompact);
      items.push({
        label: (compact?'☑':'☐') + ' Compact party glance',
        run: () => {
          if (!state.settings) state.settings = {};
          state.settings.partyCompact = !state.settings.partyCompact;
          save(); this._render();
        }
      });
    }
    return items;
  },

  // Drop transient per-character UI state for PCs no longer in the party.
  // These maps are keyed by character id and were never cleaned on removal,
  // so a long session (or repeated add/remove) leaked entries — and a recycled
  // id could inherit a stale tab / roll history / damage type. Runs on every
  // render so it catches removals from any path (actions menu, Manage Party,
  // remote sync deletion).
  _pruneTransientState(){
    const live = new Set(state.party.map(p => p.id));
    ['_rollHistory','_activeTab','_expanded','_lastRoll','_historyOpen','_resistancesOpen','_lastDmgType','_lastDmgAmount'].forEach(name => {
      const m = this[name];
      if (!m || typeof m !== 'object') return;
      for (const id in m){ if (!live.has(id)) delete m[id]; }
    });
  },

  _render(){
    const b=this._body;if(!b)return;
    this._pruneTransientState();
    const compact = !!(state.settings && state.settings.partyCompact);
    const gridCls = 'party-grid' + (compact ? ' compact' : '');
    // Apply the persisted card-width custom property on the panel body
    // so the grid's minmax() picks it up. Clamped to a sane range so the
    // user can't shrink cards to nothing or stretch them off-screen.
    const w = state.settings?.partyCardWidth;
    if (typeof w === 'number' && w > 0){
      // Wide clamp range — narrow enough for a "phone book" look, wide
      // enough to fill a single column on a big monitor. Drag updates this
      // live via the grip handler below.
      b.style.setProperty('--party-card-w', Math.max(140, Math.min(640, w)) + 'px');
    } else {
      b.style.removeProperty('--party-card-w');
    }
    b.innerHTML = '<div class="'+gridCls+'">' + state.party.map((c,i)=>this._card(c,i)).join('') + '</div>';
    this._wire();
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
    // Active-turn highlight intentionally NOT applied to the party card —
    // the combat tracker is the canonical "whose turn is it" surface. The
    // party panel stays calm so a DM glancing at it during downtime doesn't
    // see flashing borders or a swelling avatar.
    // Already-in-combat check: drives the header button's affordance —
    // "+ ⚔" to add, or "in combat" pill to remove from combat with one click.
    const inCombat = !!(state.combatants && state.combatants.find(co => co.id === c.id));
    // Downed visual — PC at ≤0 HP gets a desaturated card + pulsing red bar
    // + a "Downed" badge so the DM glancing across a 5-card party can spot
    // who's in death-save territory without reading numbers.
    const downed = (c.hp != null) && c.hp <= 0;
    const raging = !!c.rage;
    const wildshaped = !!(c.wildshape && c.wildshape.name);
    const classColor = this._classColor(c);
    return '<div class="char-card'+(inCombat?' in-combat':'')+(downed?' downed':'')+(raging?' raging':'')+(wildshaped?' wildshaped':'')+'" data-cidx="'+i+'" draggable="true" title="Drag to Combat Tracker to add to combat" style="--class-color:'+classColor+'">'
      // Class-color accent stripe — purely decorative, set via CSS using the
      // --class-color custom property on the card root.
      +'<div class="char-class-stripe"></div>'
      // Resize grip — drag horizontally to change the minimum card width
      // for the WHOLE grid (party-wide setting, persisted). Hidden in
      // compact mode (where cards are already full-row).
      +'<div class="char-resize-grip" title="Drag to resize all character cards"></div>'
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
        // ⋯ actions menu — consolidated menu of less-frequent actions
        // (combat toggle, rage/wild shape, hit die, inspiration, edit,
        // remove). Roll d20 also reachable in the actions menu now that
        // the dedicated 🎲 button has been removed.
        +'<button class="char-action-btn menu" data-act="actions-menu" data-idx="'+i+'" title="More actions — roll, combat toggle, hit die, inspiration, edit, remove">⋯</button>'
      +'</div>'
      // Status badges — concentration, rage, wildshape, inspiration. Only
      // renders for ACTIVE states. Empty row collapses to nothing.
      + this._statusBadges(c, i)
      // BIG HP block — large numeral, thick bar, color-coded by tier. The
      // current/max/temp inputs live UNDER the numeral as small fields so
      // the eye lands on the big number first. Heal/damage strip is below.
      // When the PC is wildshaped, this is labeled as the DRUID's true HP
      // (the beast HP shows in the wildshape overlay below). Damage from
      // the strip routes to the beast pool first; the druid HP only takes
      // damage after the beast form drops.
      +'<div class="char-hp-block'+(wildshaped?' has-wildshape':'')+'">'
        +(wildshaped?'<div class="char-hp-druid-label" title="Your druid form\'s true HP — damage from the strip drains the beast pool first (see wild shape overlay below). When the beast hits 0 HP the form auto-drops and overflow damage continues here.">DRUID HP</div>':'')
        +'<div class="char-hp-big">'
          +'<div class="char-hp-big-num" style="color:'+hpColor+'" title="Click to edit current HP">'
            +'<input class="char-hp-current" type="number" value="'+c.hp+'" data-field="hp" data-idx="'+i+'" title="Current HP">'
            +'<span class="char-hp-big-sep">/</span>'
            +'<input class="char-hp-max" type="number" value="'+c.hpMax+'" data-field="hpMax" data-idx="'+i+'" title="Max HP">'
          +'</div>'
          +'<div class="char-hp-side">'
            +'<label class="char-hp-temp-row" title="Temporary HP (absorbs damage first)">'
              +'<span>Temp</span>'
              +'<input class="char-hp-temp" type="number" value="'+(c.tempHp||0)+'" data-field="tempHp" data-idx="'+i+'" min="0">'
            +'</label>'
          +'</div>'
        +'</div>'
        // Horizontal heal/damage row sits beside/below the HP fields, full
        // width of the card. Bigger tap targets, clearer grouping, and no
        // more 4-tall column that fights with the HP/max/temp inputs above.
        +'<div class="party-hp-dmg" data-idx="'+i+'" title="Type amount, click − to damage (drains temp HP first, applies resist/vuln/immune) or + to heal">'
          +'<button class="party-hp-btn dmg" data-act="hp-damage" data-idx="'+i+'" title="Damage">−</button>'
          +'<input class="party-hp-amt" type="number" value="'+(this._lastDmgAmount[c.id]||5)+'" min="0" max="999" data-idx="'+i+'" title="Heal / damage amount">'
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
            const lastType = this._lastDmgType[c.id] || '';
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
      // Inspiration moved into the status badges row above. To AWARD/grant
      // inspiration (when none is active), use the inspiration buttons in
      // the tab content below — or right-click anywhere on the badge area.
      // For PCs without active inspiration, a small "+ Insp / + Bardic"
      // row sits at the bottom of the card body.
      + (()=>{
          // Only render the "give inspiration" affordance row when neither
          // flavor is active (otherwise the badges above already cover it).
          if (c.inspiration && c.bardicInspiration) return '';
          // Bardic Inspiration is grantable to ANY character (bards can give
          // it out, so any party member can be the recipient). The bardic
          // die-size auto-label still only renders when the recipient is a
          // bard (since the die-size formula keys off bard level), but a
          // non-bard recipient just sees "🎵 Bardic" without the die suffix.
          const bd = this._bardicDie(c);
          const parts = [];
          if (!c.inspiration){
            parts.push(`<button class="insp-give-btn" data-act="insp" data-idx="${i}" title="Grant Heroic Inspiration · right-click for award reasons">✨ Grant</button>`);
          }
          if (!c.bardicInspiration){
            parts.push(`<button class="insp-give-btn bardic" data-act="bardic-insp" data-idx="${i}" title="Grant Bardic Inspiration${bd?' ('+bd+')':' (set by the bard granting it)'}">🎵 Bardic${bd?' '+bd:''}</button>`);
          }
          return parts.length ? `<div class="insp-give-row">${parts.join('')}</div>` : '';
        })()
      // Tab strip — always visible. Click a tab to show its content;
      // click the SAME tab to collapse. Replaces the old ▼/▲ accordion.
      + this._sheetTabStrip(c, i)
    +'</div>';
  },

  // ------------------------------------------------------------------
  // Character sheet — Stats / Skills / Spells / Features tabs.
  // Tab strip is ALWAYS visible at the bottom of the card. Clicking a tab:
  //   • If no tab is currently open → opens it.
  //   • If clicking the OPEN tab → collapses (no content shown).
  //   • If clicking a DIFFERENT tab → switches the content panel.
  // _expanded[c.id] tracks open/closed; _activeTab[c.id] tracks which tab.
  // ------------------------------------------------------------------
  _sheetTabStrip(c, i){
    const tabs = ['stats','skills','spells','features'];
    const labels = {stats:'Stats', skills:'Skills', spells:'Spells', features:'Features'};
    const expanded = !!this._expanded[c.id];
    const active = expanded ? (this._activeTab[c.id] || 'stats') : null;
    const tabBar = tabs.map(t =>
      `<button class="sheet-tab ${t===active?'active':''}" data-act="sheet-tab-toggle" data-idx="${i}" data-tab="${t}" title="${labels[t]}${t===active?' — click again to collapse':''}">${labels[t]}</button>`
    ).join('');
    let body = '';
    if (expanded){
      if (active === 'stats')        body = this._tabStats(c);
      else if (active === 'skills')  body = this._tabSkills(c);
      else if (active === 'spells')  body = this._tabSpells(c);
      else if (active === 'features')body = this._tabFeatures(c);
    }
    return `<div class="sheet-tab-strip">${tabBar}</div>`
      + (expanded ? `<div class="sheet-content sheet-content-open">${body}</div>` : '');
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
    // Subclass entries in _5eData carry a displayName like "Battle Master
    // (Fighter)" (so the global search can disambiguate same-named subclasses
    // across classes). For the lookup we want the BARE subclass name — that
    // lives on _raw.name (and _raw.shortName for the short form). We also
    // accept partial matches both directions ("Battle Master" matches
    // "Battlemaster" and vice-versa, after stripping non-alphanumerics) so
    // the DM doesn't have to type the canonical 5etools spelling.
    const normalize = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g, '');
    const subNameN = normalize(subName);
    const subEntry = (subNameN && clsName)
      ? _5eData.find(d => {
          if (d.cat !== 'class' || !d._raw?.subclassFeatures) return false;
          if (String(d._raw.className||'').toLowerCase() !== clsName) return false;
          const candidates = [d._raw.name, d._raw.shortName, d.name.replace(/\s*\([^)]+\)\s*$/, '')];
          return candidates.some(n => {
            const nN = normalize(n);
            return nN === subNameN || nN.includes(subNameN) || subNameN.includes(nN);
          });
        })
      : null;
    const raceEntry = raceName
      ? _5eData.find(d => d.cat==='race' && d.name.toLowerCase() === raceName)
      : null;

    const flatten = entries => {
      if (!Array.isArray(entries)) return '';
      // Walk 5etools entry array. Handles every common type used in class +
      // subclass features so the rendered text matches what you'd see in
      // the official rulebook (not a stripped-down placeholder).
      const walk = arr => arr.map(e => {
        if (e == null) return '';
        if (typeof e === 'string') return '<p>' + this._renderEntryText(e) + '</p>';
        if (typeof e !== 'object') return '';
        // Bullet list
        if (e.type === 'list' && Array.isArray(e.items)){
          return '<ul class="feat-list">' + e.items.map(it =>
            '<li>' + (typeof it === 'string' ? this._renderEntryText(it)
              : (it && it.entries ? walk(it.entries)
                : it && it.name ? '<strong>'+esc(it.name)+'.</strong> '+(it.entries?walk(it.entries):'')
                : '')) + '</li>'
          ).join('') + '</ul>';
        }
        // Table (Combat Superiority die size, Sneak Attack dice, etc.)
        if (e.type === 'table' && Array.isArray(e.rows)){
          const head = Array.isArray(e.colLabels)
            ? '<thead><tr>'+e.colLabels.map(l => '<th>'+this._renderEntryText(l)+'</th>').join('')+'</tr></thead>'
            : '';
          const body = '<tbody>'+e.rows.map(r => {
            const cells = Array.isArray(r) ? r : (r.row || []);
            return '<tr>'+cells.map(cell => {
              if (typeof cell === 'string') return '<td>'+this._renderEntryText(cell)+'</td>';
              if (cell && typeof cell === 'object'){
                if (cell.type === 'cell' && cell.entry) return '<td>'+walk([cell.entry])+'</td>';
                if (cell.entries) return '<td>'+walk(cell.entries)+'</td>';
                if (cell.roll != null) return '<td>'+esc(String(cell.roll.exact ?? (cell.roll.min+'-'+cell.roll.max)))+'</td>';
              }
              return '<td></td>';
            }).join('')+'</tr>';
          }).join('')+'</tbody>';
          return '<table class="feat-table">'+(e.caption?'<caption>'+esc(e.caption)+'</caption>':'')+head+body+'</table>';
        }
        // Inset / quote — render as block quote
        if (e.type === 'inset' || e.type === 'insetReadaloud' || e.type === 'quote'){
          const body = e.entries ? walk(e.entries) : '';
          const head = e.name ? '<strong>'+esc(e.name)+'.</strong> ' : '';
          return '<blockquote class="feat-quote">'+head+body+'</blockquote>';
        }
        // Spell DC / spell attack auto-text
        if (e.type === 'abilityDc'){
          return '<p><strong>'+esc(e.name||'Spell save DC')+' = 8 + your proficiency bonus + your '+esc(((e.attributes||[]).join('/'))||'spellcasting')+' modifier</strong></p>';
        }
        if (e.type === 'abilityAttackMod'){
          return '<p><strong>'+esc(e.name||'Spell attack bonus')+' = your proficiency bonus + your '+esc(((e.attributes||[]).join('/'))||'spellcasting')+' modifier</strong></p>';
        }
        if (e.type === 'abilityGeneric'){
          return e.text ? '<p>'+this._renderEntryText(e.text)+'</p>' : '';
        }
        // "Options" lists (multiple sub-features the player chooses from —
        // Maneuvers, Eldritch Invocations, Metamagic, etc.) render each as
        // its own named sub-block.
        if (e.type === 'options' && Array.isArray(e.entries)){
          return '<div class="feat-options">'+walk(e.entries)+'</div>';
        }
        // Named feature block — by far the most common: `{name, entries, …}`.
        if (e.name && Array.isArray(e.entries)){
          return '<div class="feat-sub"><strong>'+esc(e.name)+'.</strong> '+walk(e.entries)+'</div>';
        }
        // Anonymous nested entries.
        if (Array.isArray(e.entries)) return walk(e.entries);
        return '';
      }).join('');
      return walk(entries);
    };

    // Names that are pure "choose a subclass" placeholders — the entry text
    // just says "pick a Roguish Archetype" without describing any features.
    // We hide these in the CLASS section because the actual subclass
    // features render in their own section below. Covers 2014 names (per
    // class) AND the 2024 generic "<Class> Subclass" pattern.
    const SUBCLASS_PLACEHOLDER = /^(roguish archetype|martial archetype(?: feature)?|arcane tradition|divine domain|druid circle|sorcerous origin|otherworldly patron|sacred oath|ranger (?:archetype|conclave)|monastic tradition|bard college|primal path|artificer specialist|\w+ subclass|subclass feature)$/i;
    const renderFeatureList = (features, ribbon, opts) => {
      if (!features || !features.length) return '';
      let filtered = features.filter(f => (f.level || 0) <= pcLevel);
      // For the class list, drop subclass-marker placeholders since their
      // text is "choose a subclass" — useless once the subclass section
      // renders the actual features below. Keep them everywhere else.
      if (opts && opts.dropSubclassMarkers){
        filtered = filtered.filter(f => !SUBCLASS_PLACEHOLDER.test(String(f.name||'').trim()));
      }
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
        ${renderFeatureList(classEntry._raw?._resolvedFeatures, 'class', {dropSubclassMarkers:true})}
        ${!subEntry && pcLevel >= 3 ? '<div class="sheet-empty" style="text-align:left;padding:6px 8px">✦ <strong>Subclass features</strong> — set <em>Subclass</em> in Manage Party → ✏ Edit details to see the chosen archetype\'s features.</div>' : ''}
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
    // Hydrate display-only fields from _5eData on demand. The snapshot only
    // stores name/slug/hp/ac/resist/etc. — keeps every save() tiny. If the
    // dataset isn't loaded yet (rare; race on a fresh refresh), we render
    // just the HP/AC/damage-mods which the snapshot does carry.
    const beastEntry = (typeof _5eData !== 'undefined' && _5eLoaded && ws.slug)
      ? _5eData.find(d => d.cat === 'monster' && d._slug === ws.slug)
      : null;
    const raw = beastEntry?._raw || null;
    const mod = v => v == null ? '' : ' (' + (((v-10)>>1) >= 0 ? '+' : '') + ((v-10)>>1) + ')';
    const ab = raw
      ? [
          raw.strength!=null    ? `STR ${raw.strength}${mod(raw.strength)}`         : '',
          raw.dexterity!=null   ? `DEX ${raw.dexterity}${mod(raw.dexterity)}`       : '',
          raw.constitution!=null? `CON ${raw.constitution}${mod(raw.constitution)}` : '',
        ].filter(Boolean).join(' · ')
      : '';
    const speed = raw
      ? (typeof raw.speed === 'string' ? raw.speed : (raw.speed?.walk ? `${raw.speed.walk} ft` : ''))
      : '';
    // raw.senses is an OBJECT like {darkvision:'60 ft.', passive_perception:13}
    // — flatten it to a readable string. Falls back to a plain string when
    // data shape varies. Passive perception goes last as "PP 13".
    const senses = (() => {
      const s = raw?.senses;
      if (!s) return '';
      if (typeof s === 'string') return s;
      if (typeof s !== 'object') return String(s);
      const parts = [];
      Object.entries(s).forEach(([k, v]) => {
        if (k === 'passive_perception' || k === 'passive') return; // last
        const label = k.replace(/_/g,' ');
        parts.push(label + (v ? ' ' + v : ''));
      });
      const pp = s.passive_perception ?? s.passive;
      if (pp != null) parts.push('passive Perception ' + pp);
      return parts.join(', ');
    })();
    const fmtAction = a => {
      const desc = String(a.desc || '').replace(/\s+/g, ' ').trim();
      return a.name + (desc ? ': ' + (desc.length > 220 ? desc.slice(0, 217) + '…' : desc) : '');
    };
    const actions = raw ? (raw.actions || []).map(fmtAction).join('\n') : '';
    const traits  = raw ? (raw.special_abilities || []).map(fmtAction).join('\n') : '';
    const dmgMods = [];
    if (ws.immunities?.length)      dmgMods.push(`IMM: ${ws.immunities.join(', ')}`);
    if (ws.resistances?.length)     dmgMods.push(`RES: ${ws.resistances.join(', ')}`);
    if (ws.vulnerabilities?.length) dmgMods.push(`VUL: ${ws.vulnerabilities.join(', ')}`);
    return `<div class="char-wildshape">
      <div class="ws-head">
        <span class="ws-icon">🐺</span>
        <span class="ws-name">${esc(ws.name)}${ws.cr!=null?` <span class="ws-cr">CR ${esc(String(ws.cr))}</span>`:''}</span>
        <span class="ws-stats">
          <span title="Beast HP — damage from the strip drains here first">♥ ${ws.hp}/${ws.hpMax||ws.hp}</span>
          ${ws.ac!=null ? `<span title="Beast AC">⛨ ${ws.ac}</span>` : ''}
          ${speed ? `<span title="Beast speed">⇒ ${esc(speed)}</span>` : ''}
        </span>
      </div>
      <div class="ws-bar"><div class="ws-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      ${ab ? `<div class="ws-abilities">${esc(ab)}</div>` : ''}
      ${senses ? `<div class="ws-senses">${esc(senses)}</div>` : ''}
      ${dmgMods.length ? `<div class="ws-mods">${esc(dmgMods.join(' · '))}</div>` : ''}
      ${traits ? `<details class="ws-section"><summary>Traits</summary><pre class="ws-block">${esc(traits)}</pre></details>` : ''}
      ${actions ? `<details class="ws-section" open><summary>Actions</summary><pre class="ws-block">${esc(actions)}</pre></details>` : ''}
    </div>`;
  },

  // Wild-Shape beast picker. Pulls beasts from the loaded 5etools dataset
  // and hydrates the wildshape snapshot from the chosen beast's stat block.
  //
  // Druid level gates the eligible CR (5e RAW): lv1 → CR 1/4 (no climb/swim
  // restrictions removed at lv4), lv4 → CR 1/2, lv8 → CR 1. We show every
  // beast regardless and add a chip badge for "above your CR" — Circle of
  // the Moon and homebrew vary, so the DM gets the final call.
  _editWildShape(i){
    const c = state.party[i]; if (!c) return;
    if (typeof _5eData === 'undefined' || !_5eLoaded){
      showToast('5e bestiary still loading — try again in a moment');
      return;
    }
    // Beasts only. Filter on the parsed creature type — _raw.type can be
    // a string or {type, tags}; the stored type field in the catalog is the
    // human-readable type that data-loader.js builds. We match case-insensitively.
    // Also honor the global hidden-books/adventures filter via the
    // 'wildshape' consumer key (toggle in Books / Adventures panels).
    const isHidden = (src) => (typeof window.SKT_IS_SOURCE_HIDDEN === 'function')
      && window.SKT_IS_SOURCE_HIDDEN('wildshape', src);
    const all = _5eData
      .filter(d => d.cat === 'monster' && /beast/i.test(d._raw?.type || ''))
      .filter(d => !isHidden(d._source))
      .sort((a,b) => {
        // Sort by CR first, then name. Low-CR beasts (the ones druids
        // actually shape into) bubble to the top.
        // _raw.challenge_rating is a STRING built by _parseCR (e.g. "1/4",
        // "1", "5", "None"). parseFloat("1/4") = 1, parseFloat("None") = NaN
        // — handle fractions and unknowns explicitly so the sort is right.
        const toN = s => {
          const v = String(s ?? '').trim();
          if (!v || v === 'None' || v === '—') return 999;
          if (v.includes('/')){ const [p,q] = v.split('/').map(parseFloat); return q ? p/q : 999; }
          const n = parseFloat(v);
          return Number.isFinite(n) ? n : 999;
        };
        const ca = toN(a._raw?.challenge_rating);
        const cb = toN(b._raw?.challenge_rating);
        if (ca !== cb) return ca - cb;
        return a.name.localeCompare(b.name);
      });
    if (!all.length){ showToast('No beasts in the loaded data'); return; }

    const druidLvl = parseInt(c.level || c.sheet?.level || 1, 10) || 1;
    // CR cap by druid level (vanilla 5e — Circle of the Moon doubles this).
    const crCap = druidLvl >= 8 ? 1
                : druidLvl >= 4 ? 0.5
                : 0.25;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const renderList = (q) => {
      const qn = (q || '').toLowerCase().trim();
      const list = backdrop.querySelector('#ws-pick-list');
      // Search matches name OR source (code AND friendly name) so the DM
      // can filter by book — type "MM", "Monster Manual", "Volo", etc.
      const pool = qn
        ? all.filter(d => {
            if (d.name.toLowerCase().includes(qn)) return true;
            const src = (d._source || '').toLowerCase();
            if (src.includes(qn)) return true;
            const srcLabel = (typeof _formatSource === 'function' ? _formatSource(d._source||'') : '').toLowerCase();
            if (srcLabel.includes(qn)) return true;
            return false;
          })
        : all;
      list.innerHTML = pool.slice(0, 240).map(d => {
        const raw = d._raw || {};
        // raw.challenge_rating is a string from _parseCR ("1/4", "1", "None")
        const crStr = String(raw.challenge_rating ?? '').trim() || '?';
        const crNum = /^\d+(\.\d+)?$/.test(crStr)
          ? parseFloat(crStr)
          : /^1\/(\d+)$/.test(crStr)
            ? 1 / parseInt(crStr.split('/')[1])
            : NaN;
        const overCap = Number.isFinite(crNum) && crNum > crCap;
        const hp = raw.hit_points || raw.hp || '?';
        const ac = (Array.isArray(raw.armor_class) ? raw.armor_class[0]?.value : raw.armor_class) || raw.ac || '?';
        // Source badge — uses _formatSource so book codes like "MM" / "XMM"
        // / "VGM" render as their friendly names. Falls back to the raw
        // code when the formatter doesn't know it.
        const src = d._source || '';
        const srcLabel = (src && typeof _formatSource === 'function')
          ? _formatSource(src) : src;
        return `<div class="bestiary-pick-row" data-slug="${esc(d._slug)}">
          <div class="bestiary-pick-left">
            <span class="bestiary-pick-name">${esc(d.name)}</span>
            ${src ? `<span class="detail-source-badge" title="From ${esc(srcLabel)}">${esc(srcLabel)}</span>` : ''}
            ${overCap?'<span class="ws-cr-warn" title="Above your druid-level CR cap (vanilla 5e) — Circle of the Moon may override">⚠</span>':''}
          </div>
          <span class="bestiary-pick-meta">CR ${esc(crStr)} · HP ${esc(String(hp))} · AC ${esc(String(ac))}</span>
        </div>`;
      }).join('') || '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px">No beasts match.</div>';
    };
    const cur = c.wildshape || {};
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:540px;max-width:92vw">
      <h3>🐺 Wild Shape — ${esc(c.name)}</h3>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
        <span style="font-size:11px;color:var(--text-muted)">Druid lv ${druidLvl} · CR cap ≤ ${crCap}</span>
        <span style="flex:1"></span>
        ${cur.name ? `<button class="btn small" id="ws-revert" title="Drop the current form">↩ Revert (${esc(cur.name)})</button>` : ''}
      </div>
      <input type="search" id="ws-pick-search" placeholder="🔎 Search beasts by name or source (Wolf · Volo · MM …)" autocomplete="off"
        style="width:100%;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:5px;font-size:12px;margin-bottom:10px">
      <div id="ws-pick-list" style="max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:5px;background:var(--panel-2)"></div>
      <div class="modal-actions"><button class="btn" id="ws-pick-close">Close</button></div>
    </div>`;
    document.body.appendChild(backdrop);
    renderList('');
    const close = () => backdrop.remove();
    backdrop.querySelector('#ws-pick-search').addEventListener('input', e => renderList(e.target.value));
    backdrop.querySelector('#ws-pick-close').addEventListener('click', close);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
    backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    backdrop.querySelector('#ws-revert')?.addEventListener('click', () => {
      close();
      this._endWildShape(i);
    });
    backdrop.querySelector('#ws-pick-list').addEventListener('click', e => {
      const row = e.target.closest('.bestiary-pick-row'); if (!row) return;
      const d = all.find(x => x._slug === row.dataset.slug); if (!d) return;
      this._applyWildShape(i, d);
      close();
    });
    setTimeout(() => backdrop.querySelector('#ws-pick-search').focus(), 30);
  },

  // Snapshot a 5etools beast entry into c.wildshape. Pulls HP / AC / speed /
  // actions / traits / saves / damage modifiers verbatim from the parsed
  // _raw block. Druid concentration drops on initial transform (5e RAW).
  _applyWildShape(i, beast){
    const c = state.party[i]; if (!c || !beast) return;
    const raw = beast._raw || {};
    const ac = (Array.isArray(raw.armor_class) ? raw.armor_class[0]?.value : raw.armor_class) || 10;
    const hp = parseInt(raw.hit_points || raw.hp || 1) || 1;
    // Tiny snapshot — only the fields the damage handler needs at click
    // time. Display data (actions, traits, ability scores, senses, AC desc,
    // speed) is fetched fresh from _5eData at render time using the slug.
    // Keeps every `save()` (and Firebase push) under a few hundred bytes
    // even when the form is a complex beast.
    const ws = {
      name: beast.name,
      slug: beast._slug,
      source: beast._source,
      hp, hpMax: hp,
      ac,
      resistances:    (raw.damage_resistances    || []).map(x => (typeof x === 'string' ? x : x.name || '').toLowerCase()).filter(Boolean),
      immunities:     (raw.damage_immunities     || []).map(x => (typeof x === 'string' ? x : x.name || '').toLowerCase()).filter(Boolean),
      vulnerabilities:(raw.damage_vulnerabilities|| []).map(x => (typeof x === 'string' ? x : x.name || '').toLowerCase()).filter(Boolean),
      cr: raw.challenge_rating ?? null,
    };
    const wasFresh = !c.wildshape;
    state.party[i] = {...c, wildshape: ws};
    // Druids drop concentration when they wildshape (5e RAW).
    if (wasFresh && state.party[i].concentration){
      state.party[i].concentration = null;
    }
    save();
    this._render();
    // Combat tracker mirrors rage/wildshape chips from partyMatch — nudge it
    // to re-render now so the chip appears instantly instead of waiting for
    // the next unrelated render. Same for _endWildShape and rage toggles.
    panelDefs.combat?._render?.();
    showToast(c.name + ' transforms into ' + ws.name);
  },

  // Drop wild shape — revert to druid form. Carry any HP overflow if the
  // beast was at 0 (rare on a manual ✕ click but handled cleanly).
  _endWildShape(i){
    const c = state.party[i]; if (!c || !c.wildshape) return;
    state.party[i] = {...c, wildshape: null};
    save();
    this._render();
    panelDefs.combat?._render?.();
    showToast(c.name + ' reverts to their normal form');
  },

  // Class → accent color. Drives the left-edge stripe on each party card so
  // a glance across the panel identifies the party comp by color. Lowercase
  // match on the c.cls string (multiclass "Fighter/Wizard" uses the first
  // class). Default falls back to the workspace accent color.
  _classColor(c){
    const COLORS = {
      barbarian:'#c25450', bard:'#c08fde', cleric:'#e8c75f', druid:'#6b9e6b',
      fighter:'#a0a0a8', monk:'#c9a050', paladin:'#d4d4dc', ranger:'#6b8f6b',
      rogue:'#6a6a72', sorcerer:'#e892a0', warlock:'#8a4fa0', wizard:'#5e8fc8',
      artificer:'#c47a52', blood_hunter:'#7c1f1f',
    };
    const cls = String(c.cls || c.sheet?.class || '').toLowerCase();
    for (const k of Object.keys(COLORS)){
      if (cls.includes(k.replace('_',' '))) return COLORS[k];
    }
    return 'var(--accent)';
  },

  // Header status badges. Renders only ACTIVE states (concentration spell,
  // rage, wild shape, heroic/bardic inspiration). Empty → returns ''. Each
  // badge is clickable to manage that state. Lives right under the name so
  // the eye catches it before falling to HP.
  _statusBadges(c, i){
    const badges = [];
    if (c.concentration){
      badges.push(`<span class="status-badge conc" data-act="conc-drop" data-idx="${i}" title="Concentrating on ${esc(c.concentration)} — click to drop">🌀 ${esc(c.concentration)}</span>`);
    }
    if (c.rage){
      badges.push(`<span class="status-badge rage" data-act="rage-off" data-idx="${i}" title="Raging — adv on STR · resist B/P/S · click to end">💢 RAGE</span>`);
    }
    if (c.wildshape && c.wildshape.name){
      badges.push(`<span class="status-badge wildshape" data-act="ws-end" data-idx="${i}" title="Wild Shape as ${esc(c.wildshape.name)} — click to revert">🐺 ${esc(c.wildshape.name)}</span>`);
    }
    if (c.inspiration){
      badges.push(`<span class="status-badge insp" data-act="insp" data-idx="${i}" title="Heroic Inspiration — click to spend">✨ Inspiration</span>`);
    }
    if (c.bardicInspiration){
      const bd = this._bardicDie(c);
      badges.push(`<span class="status-badge bardic" data-act="bardic-insp" data-idx="${i}" title="Bardic Inspiration${bd?' '+bd:''} — click to spend">🎵 Bardic${bd?' '+bd:''}</span>`);
    }
    if (!badges.length) return '';
    return `<div class="char-status-badges">${badges.join('')}</div>`;
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
    let raw = String(expr || '').trim();
    if (!raw) return null;
    // Versatile weapons are written "1d8/1d10" on a character sheet, meaning
    // one-handed OR two-handed — not both. The tokenizer treated the slash as
    // noise and rolled every die it found, so a longsword swung for 1d8+1d10
    // and quietly hit about 60% too hard. Keep the first alternative, which is
    // the one-handed value and the conventional default.
    //
    // Collapse only the DICE PAIR, not the whole string: splitting on the
    // slash threw away anything after it, so "1d8/1d10 +3" lost its +3 and
    // rolled a bare d8.
    raw = raw.replace(/(\d+d\d+)\s*\/\s*\d+d\d+/g, '$1').trim();
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
      // c.rage is true (5e barbarian RAW). When wildshape is active the
      // beast's own resist/immune/vuln lists ALSO apply (the beast is the
      // body taking the hit). Order of priority is immune → resist → vuln.
      if (dmgType){
        const t = String(dmgType).toLowerCase();
        const has = (arr) => Array.isArray(arr) && arr.some(x => String(x).toLowerCase() === t);
        const ws = c.wildshape;
        const ragingBPS = c.rage && (t === 'bludgeoning' || t === 'piercing' || t === 'slashing');
        if (has(c.immunities) || has(ws?.immunities)){
          remaining = 0;
          typeSuffix = ' (' + dmgType + ' — immune' + (ws ? ' [beast]' : '') + ')';
        } else if (has(c.resistances) || has(ws?.resistances) || ragingBPS){
          remaining = Math.floor(remaining / 2);
          typeSuffix = ' (' + dmgType + (ragingBPS ? ' — rage resist, ½' : has(ws?.resistances) ? ' — beast resist, ½' : ' — resisted, ½') + ')';
        } else if (has(c.vulnerabilities) || has(ws?.vulnerabilities)){
          remaining = remaining * 2;
          typeSuffix = ' (' + dmgType + ' — vulnerable, ×2' + (has(ws?.vulnerabilities) ? ' [beast]' : '') + ')';
        } else {
          typeSuffix = ' (' + dmgType + ')';
        }
      } else if (c.rage){
        // Untyped damage in rage gets no resist (we'd need the type to know
        // if it's B/P/S). Show a small reminder in the toast though.
        typeSuffix = ' (untyped — rage applies only to B/P/S)';
      }
      // Damage for the concentration check is captured HERE — after the
      // resist/immune/vulnerable math but BEFORE any pool absorbs it. Per RAW
      // you have taken the damage even when temporary hit points or a wild
      // shape's beast pool soak all of it, so the save is still owed. Reading
      // the post-absorption figure instead silently swallowed every check in
      // exactly the situation a concentrating caster is most likely to be in.
      // combat.js already does this — its comment even claims it mirrors this
      // function, which it did not.
      const damageForConc = remaining;
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
        // Floor at 0. Damage that would take you below 0 sets you to 0 in 5e;
        // the excess only matters for instant death, which this tracker does
        // not model. Letting it run negative made healing a downed PC useless:
        // at -15, a 5-point Healing Word moved them to -10 and they stayed
        // down, when RAW says they wake at 5.
        c.hp = Math.max(0, (c.hp || 0) - taken);
      }
      // Concentration save reminder — 5e rule. Toast only; don't auto-roll.
      if (c.concentration && damageForConc > 0){
        const dc = Math.max(10, Math.floor(damageForConc / 2));
        if (typeof showToast === 'function'){
          showToast('🌀 ' + c.name + ': DC ' + dc + ' CON save to maintain ' + c.concentration);
        }
      }
      // Damage-type readout so the DM sees the resist/etc. applied. Report
      // what was DEALT, noting anything a pool soaked — "took 0 damage" when
      // temp HP ate a hit reads as though the attack missed.
      if (dmgType && typeof showToast === 'function'){
        const soaked = damageForConc - taken;
        showToast(c.name + ' took ' + damageForConc + ' damage' + typeSuffix
          + (soaked > 0 ? ' — ' + soaked + ' absorbed' : ''));
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
        // Heal up from 0, never from a negative. The clamp on the damage side
        // keeps new values at 0, and Math.max here repairs any character
        // already sitting on a negative HP from before that clamp existed.
        c.hp = Math.min(cap, Math.max(0, c.hp || 0) + delta);
      }
    }
    save();
    // Mirror to the matching combat slot. syncPartyToCombat() repaints the
    // combat card itself (surgically where possible), so don't re-render
    // combat separately — that was the double-render that made HP ticks lag.
    syncPartyToCombat(i);
    // Surgical repaint of just this card when nothing structural changed;
    // a full party _render() re-serializes every character sheet.
    if (!this._patchHp(i)) this._render();
  },

  // Long rest applied to the whole party. 5e RAW:
  //   • HP back to max — including anyone who was down but not dead
  //   • All spell slots restored
  //   • Hit dice restored by half of TOTAL, rounded DOWN, min 1
  //   • Exhaustion -1 (2024 rules: same)
  //   • Concentration dropped, rage and wild shape end
  //   • Death-save pips and the "stable" flag cleared on the combat card
  // A character flagged DEAD is skipped entirely — a night's sleep doesn't
  // raise them, so their HP, flag and pips are all left alone for the DM to
  // resolve deliberately.
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
  // Cheap inline mirror — same field copy as syncPartyToCombat() does, but
  // WITHOUT triggering a panel re-render. Use this inside batched paths
  // (long rest, short rest) so we re-render combat ONCE at the end instead
  // of N times in the loop.
  _mirrorPartyToCombatSilent(partyIdx){
    const p = state.party[partyIdx]; if (!p) return;
    // Use the canonical name-fallback lookup so combatants that were added
    // via the manual "Add Combatant" dialog (different id, same character
    // name) also get mirrored during long/short rest. The strict
    // `c.id === p.id` test missed these — syncPartyToCombat() in
    // window-manager.js falls back to a normalized-name match for exactly
    // this reason, and the silent mirror needs the same fallback to avoid
    // skipping HP/AC restore on rest.
    const ci = (typeof _findCombatantForPartyMember === 'function')
      ? _findCombatantForPartyMember(p)
      : state.combatants.findIndex(c => c.id === p.id);
    if (ci >= 0){
      state.combatants[ci] = {...state.combatants[ci], hp:p.hp, hpMax:p.hpMax, ac:p.ac};
    }
  },

  _applyLongRest(){
    state.party.forEach((c, i) => {
      // Death-save state lives on the COMBATANT, not the party member, and
      // nothing used to clear it — so after a rest the combat card still
      // showed "⚕ Stable" with its pips filled while the party card showed a
      // recovered character. Worse, a PC flagged dead was quietly healed to
      // 1 HP by the rest while the combat card still read "💀 Dead".
      const ci = (typeof _findCombatantForPartyMember === 'function')
        ? _findCombatantForPartyMember(c) : -1;
      const combatant = ci >= 0 ? state.combatants[ci] : null;
      // A long rest does not raise the dead. Leave them exactly as they are;
      // reviving is a deliberate act (revivify, or clearing the flag by hand).
      if (combatant && combatant.dead) return;
      if (combatant){
        combatant.stable = false;
        combatant.deathSaves = null;
      }
      // HP to max — which is what the confirm dialog promises, and what RAW
      // gives you. A character who drops, stabilises and then sleeps eight
      // hours is not left on 1 HP; that was this function's own house rule
      // contradicting its own prompt.
      c.hp = c.hpMax || c.hp;
      c.tempHp = 0;
      // Hit dice: half of TOTAL back, minimum 1. Rounded DOWN — the PHB's
      // general rule is to round down when you divide, so a level 5 character
      // regains 2, not 3. This rounded up and quietly handed every
      // odd-levelled character a spare die every night.
      if (c.hitDice && c.hitDice.max){
        const back = Math.max(1, Math.floor(c.hitDice.max / 2));
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
      // Silent mirror — one combat render at the bottom, not N.
      this._mirrorPartyToCombatSilent(i);
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
      this._mirrorPartyToCombatSilent(i);
    });
    save();
    this._render();
    panelDefs.combat?._render?.();
    showToast('💤 Short rest — concentration dropped, short-rest resources refreshed');
  },

  // Render the "Last roll" strip + optional history (last 4 prior rolls).
  // Storage: this._rollHistory[c.id] is an array of up to 5 results with
  // index 0 = most recent. Older rolls reveal via a small ▼ disclosure
  // anchored on the strip. Returns '' if the character hasn't rolled yet.
  _renderLastRoll(c){
    const list = (this._rollHistory && this._rollHistory[c.id]) || [];
    if (!list.length) return '';
    const showHistory = !!(this._historyOpen && this._historyOpen[c.id]);
    const renderOne = (r, isCurrent) => {
      const modText = (r.mod >= 0 ? '+' : '') + r.mod;
      const modeChip = r.mode === 'adv' ? '<span class="roll-chip adv">ADV</span>'
                      : r.mode === 'dis' ? '<span class="roll-chip dis">DIS</span>'
                      : '';
      const dice = r.rolls.map((x, di) =>
        `<span class="roll-die${di === r.kept ? ' kept' : ' dropped'}${x === 20 ? ' crit' : x === 1 ? ' fumble' : ''}">${x}</span>`
      ).join('');
      const status = r.crit ? '<span class="roll-status crit">CRIT 20!</span>'
                    : r.fumble ? '<span class="roll-status fumble">Nat 1</span>'
                    : '';
      const dmgBlock = r.damage
        ? `<span class="roll-dmg ${r.crit?'crit':''}" title="${esc(r.damage.breakdown)}">
            <span class="roll-dmg-icon">⚔</span>
            <span class="roll-dmg-total">${r.damage.total}</span>${r.damage.type?`<span class="roll-dmg-type">${esc(r.damage.type)}</span>`:''}
           </span>`
        : '';
      return `<div class="roll-strip ${isCurrent?'current':'history'} ${r.crit?'crit':''}${r.fumble?' fumble':''}">
        <span class="roll-label">${esc(r.label || 'Roll')}</span>
        ${modeChip}
        <span class="roll-dice">${dice}</span>
        <span class="roll-eq">${modText}</span>
        <span class="roll-total">${r.total}</span>
        ${dmgBlock}
        ${status}
      </div>`;
    };
    const cur = list[0];
    const prior = list.slice(1);
    const toggleBtn = prior.length
      ? `<button class="roll-history-toggle" data-act="roll-history-toggle" data-cid="${esc(c.id)}" title="${showHistory?'Hide':'Show'} the last ${prior.length} roll${prior.length===1?'':'s'}">${showHistory?'▲':'▼'} ${prior.length} prior</button>`
      : '';
    let priorHtml = '';
    if (showHistory && prior.length){
      priorHtml = '<div class="roll-history-list">' + prior.map(r => renderOne(r, false)).join('') + '</div>';
    }
    return `<div class="roll-history-wrap">
      ${renderOne(cur, true)}
      ${toggleBtn}
      ${priorHtml}
    </div>`;
  },

  // Persist a roll result + keep up to 5 most-recent per character. New
  // entries push to the front (index 0); older drop off the tail.
  _setLastRoll(c, result){
    if (!this._rollHistory) this._rollHistory = {};
    const list = this._rollHistory[c.id] || [];
    list.unshift(result);
    if (list.length > 5) list.length = 5;
    this._rollHistory[c.id] = list;
    // Back-compat: keep _lastRoll[c.id] pointing at the most recent.
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
    const str = String(s);
    // Prefer an explicitly SIGNED number — that's what a to-hit bonus looks
    // like. Taking the first number of any kind read "1d8 Longsword +5" as a
    // bonus of 1, because the 1 in "1d8" came first. Unsigned is still
    // accepted as a fallback so a bare "7" keeps working.
    const signed = str.match(/[+-]\s*\d+/);
    if (signed) return parseInt(signed[0].replace(/\s+/g, ''), 10);
    const any = str.match(/\d+/);
    return any ? parseInt(any[0], 10) : null;
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
        const heal = Math.max(1, roll + conMod); // house rule: RAW floor is 0
        c.hitDice.current -= 1;
        // Same cap expression as the heal path in _applyHpDelta. This used
        // c.hpMax directly, so a character with no hpMax recorded got
        // Math.min(undefined, n) === NaN — their HP became NaN and the die was
        // spent anyway. Math.max(0, …) additionally heals up from a negative
        // rather than from it, for anyone saved before HP was floored at 0.
        const cap = c.hpMax || c.hp || 0;
        c.hp = Math.min(cap, Math.max(0, c.hp || 0) + heal);
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

  // Surgical HP repaint for ONE character card. Returns true if it fully
  // handled the update, false when the caller must fall back to _render().
  //
  // A full party _render() re-serializes every character sheet (~230 lines of
  // template per member) — far too expensive for an HP tick, especially since
  // the party↔combat mirror means one click used to rebuild BOTH panels.
  // Structural transitions (alive↔downed, tempHp 0↔>0) change the card's
  // markup, not just its numbers, so those still need the full path.
  _patchHp(i){
    const b = this._body; if (!b) return true;   // panel closed → nothing to paint
    const p = state.party[i]; if (!p) return false;
    const card = b.querySelector('[data-cidx="'+i+'"]');
    if (!card) return false;
    const wasDowned = card.classList.contains('downed');
    const isDowned  = (p.hp != null) && p.hp <= 0;
    const hadTemp   = !!card.querySelector('.hp-bar-temp');
    const hasTemp   = (p.tempHp||0) > 0;
    if (wasDowned !== isDowned || hadTemp !== hasTemp) return false;
    const hp = this._hpBarStyle(p);
    const wrap = card.querySelector('.hp-bar-wrap');
    const bar  = card.querySelector('.hp-bar-fill');
    const big  = card.querySelector('.char-hp-big-num');
    if (wrap) wrap.classList.toggle('hp-surplus', hp.surplus);
    if (bar){ bar.style.width = hp.pct+'%'; bar.style.background = hp.color; }
    if (big){ big.style.color = hp.color; }
    // Keep the numeric fields in step — the change may have originated in the
    // combat panel, so this card's inputs still show the pre-mirror values.
    // Skip whichever field is focused so we never fight the user's cursor.
    const act = document.activeElement;
    ['hp','hpMax','tempHp'].forEach(f => {
      const inp = card.querySelector('input[data-field="'+f+'"][data-idx="'+i+'"]');
      if (inp && inp !== act && String(p[f] ?? '') !== inp.value) inp.value = p[f] ?? '';
    });
    if (big && big.textContent !== String(p.hp)) big.textContent = p.hp;
    return true;
  },

  _wire(){
    const b=this._body;if(!b)return;
    // Drag a party card → drop on Combat Tracker to add to combat. Suppress
    // drag when grabbing inputs/buttons so text selection still works.
    b.querySelectorAll('.char-card').forEach(card=>{
      card.addEventListener('dragstart', e=>{
        if (e.target.closest('input,select,textarea,button,.icon-picker,.pip,.party-hp-dmg,.slot-pip,.party-hp-type,.char-resize-grip')){ e.preventDefault(); return; }
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
    // Keep the .char-hp-temp[value="0"] dim selector honest while the user
    // types. That selector matches the value ATTRIBUTE (the rendered default),
    // not the live IDL value — so without this, editing a 0 to a real number
    // (or vice versa) wouldn't update the dim state until a full re-render.
    // Mirror each keystroke onto the attribute so the rule re-evaluates live.
    b.querySelectorAll('.char-hp-temp').forEach(inp=>{
      inp.addEventListener('input',()=>inp.setAttribute('value', inp.value));
    });
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
        if(['hp','hpMax','ac','name'].includes(f))syncPartyToCombat(i);
        save();
        // HP / hpMax / tempHp partial update. When the card's VISUAL STATE
        // changes (alive↔downed, tempHp 0↔>0), the surgical bar/numeral
        // recolor isn't enough — we also need to toggle the .downed class
        // on the card, add/remove the downed banner, and add/remove the
        // .hp-bar-temp marker. Those are markup-structure changes, so we
        // fall back to a full _render(). Within-range edits (HP stays >0,
        // tempHp stays 0 or stays >0) keep the fast inline update.
        if(f==='hp'||f==='hpMax'||f==='tempHp'){
          if (!this._patchHp(i)) this._render();
        }
      });
      inp.addEventListener('click',e=>e.stopPropagation());
    });

    // Resize grips on each card — dragging any grip changes the minimum
    // card width for the WHOLE grid (so all cards stay the same size). The
    // setting persists in state.settings.partyCardWidth and syncs across
    // tabs via the normal save() path.
    b.querySelectorAll('.char-resize-grip').forEach(grip => {
      grip.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        const card = grip.closest('.char-card');
        if (!card) return;
        const startX = e.clientX;
        const startW = card.getBoundingClientRect().width;
        const onMove = (mv) => {
          // Width grows when dragged right (positive dx). Clamp matches the
          // render-time clamp so saved + live values agree. Wider range
          // (140-640 px) so "any size" actually feels like any size.
          const next = Math.max(140, Math.min(640, Math.round(startW + (mv.clientX - startX))));
          b.style.setProperty('--party-card-w', next + 'px');
          this._pendingCardWidth = next;
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (this._pendingCardWidth != null){
            if (!state.settings) state.settings = {};
            state.settings.partyCardWidth = this._pendingCardWidth;
            this._pendingCardWidth = null;
            save();
          }
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      // Also suppress click + dragstart so the card itself doesn't try to
      // drag-to-combat when the grip is grabbed.
      grip.addEventListener('click', e => e.stopPropagation());
      grip.addEventListener('dragstart', e => { e.preventDefault(); e.stopPropagation(); });
    });

    // Heal/damage amount input — suppress drag/card-click and persist the
    // typed value across renders so the DM doesn't have to re-type.
    b.querySelectorAll('.party-hp-amt').forEach(inp => {
      inp.addEventListener('click', e => e.stopPropagation());
      inp.addEventListener('mousedown', e => e.stopPropagation());
      inp.addEventListener('change', () => {
        const v = parseInt(inp.value) || 0;
        const cid = state.party[+inp.dataset.idx]?.id;
        if (v > 0 && cid) this._lastDmgAmount[cid] = v;
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
        const cid = state.party[+sel.dataset.idx]?.id;
        if (cid) this._lastDmgType[cid] = sel.value;
        const lbl = sel.parentElement?.querySelector('.party-hp-type-label');
        if (lbl) lbl.textContent = ABBR[sel.value] || '—';
        const wrap = sel.parentElement;
        if (wrap) wrap.title = 'Damage type — applies this PC\'s resist/vuln/immune (set them in the Stats tab; current: ' + (sel.value || 'untyped') + ')';
      });
    });

    // (Inventory tab removed — no inv-edit wiring needed.)

    // [data-act] clicks are dispatched by the delegated body listener
    // attached in mount() — see _onAction below.
  },

  // Single dispatch for every [data-act] click inside the panel body.
  // `el` is the closest [data-act] element to the click target.
  _onAction(el, e){
      const act=el.dataset.act, i=+el.dataset.idx;
      if(act==='insp'){state.party[i]={...state.party[i],inspiration:!state.party[i].inspiration};save();this._render();}
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
      else if(act==='spell-open'){
        this._openSpellDetail(el.dataset.spell);
      }
      // Unified tab toggle replaces the old toggle-sheet/sheet-tab pair.
      //   • clicking the currently-active tab collapses the content panel
      //   • clicking a different tab (or any tab when collapsed) opens that tab
      else if(act==='sheet-tab-toggle'){
        const c = state.party[i]; if (!c) return;
        const newTab = el.dataset.tab;
        const wasOpen = !!this._expanded[c.id];
        const oldTab = this._activeTab[c.id];
        if (wasOpen && oldTab === newTab){
          this._expanded[c.id] = false;
        } else {
          this._expanded[c.id] = true;
          this._activeTab[c.id] = newTab;
        }
        this._render();
      }
      // ⋯ actions menu — rare or "drill-down" actions consolidated in one
      // place so the always-visible card stays clean. Class-conditional
      // entries (rage, wild shape) only appear when applicable.
      //
      // All handlers re-resolve the party slot by ID inside their onClick
      // (via the resolve() helper). The menu survives _render(), so if a
      // remote peer or local drag-reorder shuffles state.party between
      // open + click, the captured index `i` would point at the wrong PC
      // (or none). Looking up by id at click time keeps the menu correct.
      else if(act==='actions-menu'){
        const c = state.party[i]; if (!c) return;
        const cid = c.id;
        // Re-resolve the party slot at click time. Returns { idx, c } or
        // null if the PC has been removed since the menu opened.
        const resolve = () => {
          const idx = state.party.findIndex(p => p.id === cid);
          return idx < 0 ? null : { idx, c: state.party[idx] };
        };
        const rect = el.getBoundingClientRect();
        const items = [];
        const cls = String(c.cls || c.sheet?.class || '').toLowerCase();
        const isBarb  = /\bbarbarian\b/.test(cls);
        const isDruid = /\bdruid\b/.test(cls);
        // Quick d20 roll — pops a sub-menu of initiative/saves/skill/death save.
        items.push({
          label: '🎲 Roll d20…',
          onClick: () => {
            const r0 = resolve(); if (!r0) return;
            const liveC = r0.c;
            // Re-find the menu button position to anchor the roll submenu.
            const card = this._body?.querySelector(`[data-cidx="${r0.idx}"]`);
            const anchor = card?.querySelector('.char-action-btn.menu');
            const rect = anchor ? anchor.getBoundingClientRect() : { left: 200, bottom: 200 };
            const rollItems = [];
            rollItems.push({ label:'⚡ Initiative', onClick: () => {
              const r = this._rollD20(liveC.init || 0, { mode:'normal', label: liveC.name + ' · Initiative' });
              this._setLastRoll(liveC, r);
              if (!this._expanded[cid]) { this._expanded[cid] = true; this._activeTab[cid] = 'stats'; this._render(); }
            }});
            const ab = liveC.abilities || {};
            const sh = liveC.sheet || {};
            const saveDefs = [['str','STR'],['dex','DEX'],['con','CON'],['int','INT'],['wis','WIS'],['cha','CHA']];
            const saves = sh.saves || {};
            const anySave = saveDefs.some(([k]) => saves[k] != null || typeof ab[k] === 'number');
            if (anySave){
              rollItems.push({ label: '─────', disabled: true });
              saveDefs.forEach(([k, lbl]) => {
                let v = saves[k];
                if (v == null && typeof ab[k] === 'number') v = Math.floor((ab[k]-10)/2);
                if (v == null) return;
                rollItems.push({ label: `${lbl} save (${v>=0?'+':''}${v})`, onClick: () => {
                  const r = this._rollD20(v, { mode:'normal', label: liveC.name + ' · ' + lbl + ' Save' });
                  this._setLastRoll(liveC, r);
                  if (!this._expanded[cid]) { this._expanded[cid] = true; this._activeTab[cid] = 'stats'; this._render(); }
                }});
              });
            }
            if ((liveC.hp || 0) <= 0){
              rollItems.push({ label: '─────', disabled: true });
              rollItems.push({ label:'💀 Death save', onClick: () => {
                const r = this._rollD20(0, { mode:'normal', label: liveC.name + ' · Death Save' });
                this._setLastRoll(liveC, r);
              }});
            }
            rollItems.push({ label: '─────', disabled: true });
            rollItems.push({ label:'(Hold Shift = adv · Alt = dis when clicking sheet skills)', disabled:true });
            showContextMenu(rect.left, rect.bottom + 4, rollItems);
          }
        });
        items.push({ label: '─────', disabled: true });
        // Combat toggle
        const inCombatNow = !!(state.combatants && state.combatants.find(co => co.id === cid));
        items.push({
          label: inCombatNow ? '⚔ Remove from combat' : '⚔ Add to combat',
          onClick: () => {
            const r = resolve(); if (!r) return;
            const cIdx = state.combatants.findIndex(co => co.id === cid);
            if (cIdx >= 0){
              state.combatants.splice(cIdx, 1);
              if (state.activeCombatantId === cid){
                state.activeCombatantId = state.combatants[0]?.id || null;
              }
              save(); this._render(); panelDefs.combat?._render?.();
            } else if (panelDefs.combat?._addPartyToCombat){
              panelDefs.combat._addPartyToCombat(r.idx);
              this._render();
            }
          }
        });
        // Rage (barb)
        if (isBarb){
          items.push({
            label: c.rage ? '💢 End rage' : '💢 Enter rage',
            onClick: () => {
              const r = resolve(); if (!r) return;
              state.party[r.idx] = {...r.c, rage: !r.c.rage};
              save(); this._render(); panelDefs.combat?._render?.();
            }
          });
        }
        // Wild Shape (druid)
        if (isDruid){
          items.push({
            label: c.wildshape ? '🐺 Revert wild shape' : '🐺 Wild shape…',
            onClick: () => {
              const r = resolve(); if (!r) return;
              r.c.wildshape ? this._endWildShape(r.idx) : this._editWildShape(r.idx);
            },
          });
        }
        // Hit die spend
        if (c.hitDice && c.hitDice.max){
          items.push({
            label: `🎲 Spend a hit die (${c.hitDice.current||0}/${c.hitDice.max})`,
            disabled: (c.hitDice.current||0) === 0,
            onClick: () => {
              const r = resolve(); if (!r) return;
              this._spendHitDie(r.idx);
            },
          });
        }
        items.push({ label: '─────', disabled: true });
        // Inspiration grants
        items.push({
          label: c.inspiration ? '✨ Spend Heroic Inspiration' : '✨ Grant Heroic Inspiration',
          onClick: () => {
            const r = resolve(); if (!r) return;
            state.party[r.idx] = {...r.c, inspiration: !r.c.inspiration};
            save(); this._render();
          }
        });
        // Bardic Inspiration is grantable to anyone — any character can be
        // the recipient of a bard's buff.
        items.push({
          label: c.bardicInspiration ? '🎵 Spend Bardic Inspiration' : '🎵 Grant Bardic Inspiration',
          onClick: () => {
            const r = resolve(); if (!r) return;
            state.party[r.idx] = {...r.c, bardicInspiration: !r.c.bardicInspiration};
            save(); this._render();
          }
        });
        items.push({ label: '─────', disabled: true });
        items.push({ label:'✎ Edit details…',  onClick: () => {
          const r = resolve(); if (!r) return;
          this._openCharDetailsEditor(r.idx);
        }});
        items.push({ label:'📋 Manage Party…', onClick: () => this._openManageParty() });
        items.push({ label:'🗑 Remove from party', onClick: () => {
          const r0 = resolve(); if (!r0) return;
          const liveC = r0.c;
          showModal('Remove '+liveC.name+'?',[],'Remove').then(ans => {
            if(ans === null) return;
            // Re-resolve AGAIN inside the modal callback — the modal is
            // async and the array may have shifted between menu open and
            // confirm click.
            const r2 = resolve(); if (!r2) return;
            state.party.splice(r2.idx, 1); save(); this._render();
          });
        }});
        showContextMenu(rect.left, rect.bottom + 4, items);
      }
      // Roll history disclosure — flips _historyOpen[cid].
      else if(act==='roll-history-toggle'){
        const cid = el.dataset.cid;
        if (!this._historyOpen) this._historyOpen = {};
        this._historyOpen[cid] = !this._historyOpen[cid];
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
        const cid = state.party[i]?.id;
        if (cid) this._lastDmgAmount[cid] = amt;
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
        panelDefs.combat?._render?.();
        showToast(state.party[i].name + ' enters a rage');
      }
      else if(act==='rage-off'){
        state.party[i] = {...state.party[i], rage: false};
        save(); this._render();
        panelDefs.combat?._render?.();
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
