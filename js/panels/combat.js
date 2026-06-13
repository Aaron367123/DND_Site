// ============================================================
// COMBAT PANEL
// ============================================================
// Card-based tracker. Order is manually controlled by the user
// (drag to reorder), not auto-sorted by initiative. Bestiary cards
// can be dragged into the panel to add monsters; monster cards
// show a duplicate button beneath the delete button so groups of
// the same creature can be added quickly.

registerPanel('combat',{
  title:'Combat Tracker',icon:'⚔',
  mount(body){
    this._body=body;
    this._wireBestiaryDrop();
    this._render();
  },
  unmount(){
    // Close any open PiP window when the panel unmounts (full layout reset).
    try { this._closePiP(/*silent*/true); } catch(e){}
    this._body=null;
  },

  // (PiP menu item is merged into the main `menuItems()` further down so the
  // two definitions don't clobber each other.)

  // ─── Picture-in-Picture ───────────────────────────────────────────────────
  // Document PiP lets the combat tracker float in a small always-on-top
  // window so the DM can tab to D&D Beyond / Reddit / wherever without
  // losing initiative. Falls back to a toast when the browser doesn't
  // support the API. While PiP is active, the main panel window shows a
  // placeholder + "bring back" button so the panel isn't a black hole.
  _openPiP(){
    if (this._pipWin) return; // already open
    // Some Chromium-derivatives (Opera GX, Brave with shields) hide
    // `documentPictureInPicture` from the global even though the underlying
    // engine supports it. Probe defensively — check the property AND that
    // requestWindow is callable — and fall back to a regular popup if not.
    const pip = (typeof window !== 'undefined') ? window.documentPictureInPicture : null;
    const supportsPiP = pip && typeof pip.requestWindow === 'function';
    if (!supportsPiP){
      this._openPiPFallback();
      return;
    }
    pip.requestWindow({ width: 420, height: 560 }).then(pipWin => {
      this._pipWin = pipWin;
      // Mirror the app stylesheets into the PiP document so theme vars,
      // panel layout, and combat-specific styles all carry over.
      Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).forEach(node => {
        try {
          if (node.tagName === 'LINK'){
            const l = pipWin.document.createElement('link');
            l.rel = 'stylesheet';
            l.href = node.href;
            pipWin.document.head.appendChild(l);
          } else {
            const s = pipWin.document.createElement('style');
            s.textContent = node.textContent;
            pipWin.document.head.appendChild(s);
          }
        } catch(e){}
      });
      // Carry the app's body classes so theme + player-mode styles apply.
      try { pipWin.document.body.className = document.body.className + ' combat-pip-mode'; } catch(e){}
      pipWin.document.body.style.cssText = 'margin:0;padding:8px;background:var(--bg);min-height:100vh;overflow:auto';
      // Container for the combat panel inside PiP.
      const pipBody = pipWin.document.createElement('div');
      pipBody.id = 'panel-body-combat-pip';
      pipBody.style.cssText = 'height:100%';
      pipWin.document.body.appendChild(pipBody);
      // Swap render target. Re-rendering now paints into PiP.
      this._originalBody = this._body;
      this._body = pipBody;
      this._render();
      // Placeholder in the panel window so it isn't a void.
      if (this._originalBody){
        this._originalBody.innerHTML = '<div class="combat-pip-placeholder">'
          + '<div style="font-size:32px;margin-bottom:6px">⧉</div>'
          + '<div style="margin-bottom:10px">Combat tracker is in Picture-in-Picture</div>'
          + '<button class="btn primary" id="combat-pip-bring-back">Bring back</button>'
          + '</div>';
        this._originalBody.querySelector('#combat-pip-bring-back')?.addEventListener('click', () => this._closePiP());
      }
      // User closes the PiP window via the OS chrome — clean up.
      pipWin.addEventListener('pagehide', () => this._closePiP(/*silent*/true));
    }).catch(err => {
      console.warn('PiP open failed, falling back to popup window', err);
      this._openPiPFallback();
    });
  },

  // Fallback when `documentPictureInPicture` isn't available (Opera GX with
  // PiP disabled, older Chromium, Firefox). Opens a plain popup window via
  // `window.open()` — not "always-on-top" like real Document PiP, but the
  // user CAN drag it to a second monitor or pin it via OS-level "always on
  // top" (Windows PowerToys, macOS BetterTouchTool, etc.) so it's still
  // useful. Same render-swap logic as the PiP path.
  _openPiPFallback(){
    const pop = window.open('', 'skt-combat-pip-' + Date.now(), 'width=420,height=600,resizable=yes,scrollbars=yes');
    if (!pop){
      if (typeof showToast === 'function') showToast('Allow popups to use the pop-out combat tracker');
      return;
    }
    // Stand up a minimal HTML shell so we can append our content + styles.
    try {
      pop.document.open();
      pop.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Combat Tracker</title></head><body></body></html>');
      pop.document.close();
    } catch(e){}
    // Mirror app stylesheets (same as the PiP path).
    Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).forEach(node => {
      try {
        if (node.tagName === 'LINK'){
          const l = pop.document.createElement('link');
          l.rel = 'stylesheet';
          // Absolute URL — relative paths won't resolve correctly in the
          // about:blank document the popup starts on.
          l.href = node.href;
          pop.document.head.appendChild(l);
        } else {
          const s = pop.document.createElement('style');
          s.textContent = node.textContent;
          pop.document.head.appendChild(s);
        }
      } catch(e){}
    });
    try { pop.document.body.className = document.body.className + ' combat-pip-mode'; } catch(e){}
    pop.document.body.style.cssText = 'margin:0;padding:8px;background:var(--bg);min-height:100vh;overflow:auto';
    const pipBody = pop.document.createElement('div');
    pipBody.id = 'panel-body-combat-pip';
    pipBody.style.cssText = 'height:100%';
    pop.document.body.appendChild(pipBody);
    this._pipWin = pop;
    this._originalBody = this._body;
    this._body = pipBody;
    this._render();
    if (this._originalBody){
      this._originalBody.innerHTML = '<div class="combat-pip-placeholder">'
        + '<div style="font-size:32px;margin-bottom:6px">⧉</div>'
        + '<div style="margin-bottom:10px">Combat tracker is in pop-out window</div>'
        + '<button class="btn primary" id="combat-pip-bring-back">Bring back</button>'
        + '</div>';
      this._originalBody.querySelector('#combat-pip-bring-back')?.addEventListener('click', () => this._closePiP());
    }
    // Popup closed → restore. `beforeunload` covers Cmd-W / X-button.
    pop.addEventListener('beforeunload', () => this._closePiP(/*silent*/true));
    pop.addEventListener('pagehide', () => this._closePiP(/*silent*/true));
    if (typeof showToast === 'function') showToast('Combat popped out — drag to a second monitor or pin it on top');
  },
  _closePiP(silent){
    if (!this._pipWin && !this._originalBody) return;
    // Restore the original body as the active render target.
    if (this._originalBody){
      this._body = this._originalBody;
      this._originalBody = null;
    }
    // Close the PiP window (pagehide listener calls this again with silent
    // — guarded by the early-out below).
    if (this._pipWin){
      const w = this._pipWin;
      this._pipWin = null;
      if (!silent){ try { w.close(); } catch(e){} }
    }
    // Repaint the (now active) main panel.
    try { this._render(); } catch(e){}
  },

  // Tri-state monster stats reveal: show (real numbers), conceal (qualitative
  // tier like "Bloodied"), hide ("?"). Reads old hideMonsterStats=true as 'hide'
  // for backward-compat.
  _statsMode(){
    const m = state.settings?.monsterStatsMode;
    if (m === 'show' || m === 'conceal' || m === 'hide') return m;
    return state.settings?.hideMonsterStats ? 'hide' : 'show';
  },
  _setStatsMode(mode){
    state.settings.monsterStatsMode = mode;
    state.settings.hideMonsterStats = (mode === 'hide'); // keep legacy field in sync
    save(); this._render();
  },

  // Items added to the window's ⋯ menu. Evaluated each time the menu opens.
  // All entries are DM-only — players have no business changing what their
  // own view shows or editing combat structure.
  menuItems(){
    if (document.body.classList.contains('player-mode')) return [];
    const m = this._statsMode();
    const dot = active => active ? '●' : '○';
    const items = [];
    // PiP toggle goes first so it's easy to find. Shown even when the
    // Document PiP API isn't present — the click handler prints a clear
    // toast in that case rather than silently hiding the feature.
    items.push(this._pipWin
      ? { label: '⧉ Bring back from PiP', run: () => this._closePiP() }
      : { label: '⧉ Pop out to PiP (always-on-top)', run: () => this._openPiP() });
    items.push(
      { label: dot(m==='show')    + ' Monster HP/AC: Show',
        run: () => this._setStatsMode('show') },
      { label: dot(m==='conceal') + ' Monster HP/AC: Conceal (Bloodied / Wounded / …)',
        run: () => this._setStatsMode('conceal') },
      { label: dot(m==='hide')    + ' Monster HP/AC: Hide',
        run: () => this._setStatsMode('hide') },
      { label: '🩺 Manage health tiers…',
        run: () => this._manageHealthTiers() },
      { label: '⚙ Manage quick-pick names…',
        run: () => this._manageQuickNames() },
    );
    // HP bar visibility toggle — default ON. Stored on settings so it
    // persists across reloads and syncs across tabs via the existing
    // workspace-key path. Pure visual toggle — HP numerals always render.
    const hpBarOn = (state.settings && state.settings.combatHpBar !== false);
    items.push({
      label: (hpBarOn ? '☑' : '☐') + ' Show HP bars',
      run: () => {
        if (!state.settings) state.settings = {};
        state.settings.combatHpBar = !hpBarOn;
        save(); this._render();
      }
    });
    return items;
  },

  // Qualitative HP tier for "Conceal" mode. Tiers are user-configurable
  // via "Manage health tiers…" — array of {threshold, label} where threshold
  // is the HP% FLOOR for that label. Walks the list highest→lowest and uses
  // the first one whose threshold ≤ current pct.
  _hpTier(c){
    const max = c.hpMax || 0;
    if (max <= 0) return '—';
    const pct = (c.hp / max) * 100;
    const tiers = (state.settings && Array.isArray(state.settings.healthTiers) && state.settings.healthTiers.length)
      ? state.settings.healthTiers
      : DEFAULT_SETTINGS.healthTiers;
    const sorted = [...tiers].sort((a,b) => (b.threshold||0) - (a.threshold||0));
    // Special-case actually-dead: hp <= 0 always gets the lowest-threshold
    // tier (e.g. "Defeated"). Otherwise — if HP is still positive but a
    // fractional percent — the creature must be at least the lowest
    // NON-ZERO-threshold tier ("Near Death"). A giant at 1/138 HP is alive,
    // not defeated, even though 1/138 = 0.72% < 1%.
    if (c.hp <= 0) return (sorted[sorted.length-1].label || '?');
    // Pick the highest threshold the current pct still meets, but never
    // return the 0-threshold "defeated" tier when HP > 0.
    const nonZero = sorted.filter(t => (t.threshold ?? 0) > 0);
    for (const t of nonZero){
      if (pct >= (t.threshold ?? 0)) return t.label || '?';
    }
    // HP positive but below every non-zero threshold (e.g. 0.72% < 1%) →
    // show the lowest non-zero tier rather than rolling over to "Defeated".
    return nonZero.length
      ? (nonZero[nonZero.length-1].label || '?')
      : (sorted[sorted.length-1]?.label || '—');
  },

  // Render the collapsible round-log strip at the bottom of the panel.
  // Shown only when there's at least one entry; persists `_logOpen` on
  // the panel so the user's open/closed preference survives re-renders.
  _renderLog(){
    const log = Array.isArray(state.combatLog) ? state.combatLog : [];
    if (!log.length) return '';
    const open = this._logOpen !== false; // default open
    // Show newest at the bottom (chronological), tail-trimmed to 25 most
    // recent so the strip doesn't dominate the panel. Click "Show all" in
    // the header to bypass the cap.
    const showAll = !!this._logShowAll;
    const recent = showAll ? log : log.slice(-25);
    const rows = recent.map(e => `<div class="combat-log-row">
      <span class="combat-log-round">R${e.round || '·'}</span>
      <span class="combat-log-text">${esc(e.text)}</span>
    </div>`).join('');
    return `<div class="combat-log ${open?'open':'collapsed'}">
      <div class="combat-log-head" data-act="toggle-log">
        <span class="combat-log-caret">${open?'▾':'▸'}</span>
        <span class="combat-log-title">Round log</span>
        <span class="combat-log-count">${log.length}</span>
        <span style="flex:1"></span>
        ${(open && log.length > 25) ? `<button class="combat-log-mini" data-act="log-toggle-all" title="${showAll?'Show only the last 25':'Show every entry'}">${showAll?'Show recent':'Show all'}</button>` : ''}
        ${open ? '<button class="combat-log-mini" data-act="log-clear" title="Clear the log">Clear</button>' : ''}
      </div>
      ${open ? `<div class="combat-log-body">${rows}</div>` : ''}
    </div>`;
  },

  _render(){
    const b=this._body;if(!b)return;
    const inCombat=state.combatants.length>0;
    const compact = !!(state.settings && state.settings.combatCompact);
    const grouped = !!(state.settings && state.settings.combatGroupSimilar);
    b.innerHTML=`
      <div class="combat-controls">
        ${inCombat?'<button class="btn icon-btn" data-act="prev" title="Step back one turn (undo turn advance)">◀</button>':''}
        <button class="btn icon-btn" data-act="next" title="Advance turn">▶</button>
        <button class="btn icon-btn" data-act="add" title="Add custom combatant">+</button>
        <button class="btn icon-btn" data-act="add-monster" title="Add monster from bestiary">🐲</button>
        <button class="btn icon-btn ${compact?'active':''}" data-act="toggle-compact" title="${compact?'Show full cards':'Compact card mode'}">${compact?'▤':'▦'}</button>
        <button class="btn icon-btn ${grouped?'active':''}" data-act="toggle-group" title="${grouped?'Show every monster individually':'Group identical monsters into one card'}">${grouped?'▣':'⊞'}</button>
        ${inCombat?`<span class="round-display">Round ${state.combatRound||1}</span>`:''}
        <span style="flex:1"></span>
        ${inCombat?'<button class="btn icon-btn danger" data-act="end" title="End combat (clears all combatants)">⏹ End</button>':''}
      </div>

      ${(() => {
        // DM-only: the banner is a status reminder for the DM about what
        // players are seeing. Players themselves don't need to see it.
        if (document.body.classList.contains('player-mode')) return '';
        const m = this._statsMode();
        if (m === 'hide')    return '<div class="combat-hide-banner">🙈 Monster HP &amp; AC hidden from players</div>';
        if (m === 'conceal') return '<div class="combat-hide-banner">👁 Monster HP shown as health tier (Healthy / Bloodied / …) to players</div>';
        return '';
      })()}

      ${inCombat
        ? `<div class="combatant-list${compact?' compact':''}${grouped?' grouped':''}${(state.settings&&state.settings.combatHpBar===false)?' no-hp-bar':''}" id="combat-list">`+this._renderCombatants()+'</div>'
        : '<div class="empty-state" style="padding:30px;text-align:center;color:var(--text-muted)"><div style="font-size:24px;margin-bottom:6px">⚔</div>Drag a party member or monster here, or use the + / 🐲 buttons above.</div>'}

      ${inCombat ? this._renderLog() : ''}

      <div class="combat-droptip" id="combat-droptip">Drop to add to combat</div>`;
    this._wire();
  },

  _renderCombatants(){
    const grouped = !!(state.settings && state.settings.combatGroupSimilar);
    if (!grouped) return state.combatants.map((c,i)=>this._renderCard(c,i,false)).join('');
    // Group adjacent same-baseName monsters into one card with N HP rows.
    // PCs and ungrouped monsters render normally. Groups respect the
    // existing combatant order — we don't reshuffle, just collapse runs.
    const out = [];
    const used = new Set();
    state.combatants.forEach((c, i) => {
      if (used.has(i)) return;
      if (c.isPC || !c.baseName){ out.push(this._renderCard(c, i, false)); used.add(i); return; }
      // Find every same-baseName monster across the list (not just adjacent
      // — DM may have reordered). Active turn highlights the right row.
      const members = [];
      state.combatants.forEach((c2, j) => {
        if (!c2.isPC && c2.baseName === c.baseName) { members.push({c:c2, i:j}); used.add(j); }
      });
      if (members.length === 1) out.push(this._renderCard(c, i, false));
      else out.push(this._renderGroupCard(c.baseName, members));
    });
    return out.join('');
  },

  // Group-card render: one header (avatar/name/init), then N stacked rows,
  // each row = one combatant with its own HP bar + heal/damage strip.
  // The card itself has no `draggable` — group reorder is out of scope; the
  // user can disable grouping to drag.
  _renderGroupCard(baseName, members){
    const anyActive = members.some(m => m.c.id === state.activeCombatantId);
    const allDead = members.every(m => (m.c.hp||0) <= 0);
    const first = members[0].c;
    const portrait = first.portrait || CLASS_ICONS[first.cls] || CLASS_ICONS.enemy;
    const init = first.initiative || 0;
    return `<div class="combatant-card group ${anyActive?'active':''} ${allDead?'dead':''} npc" data-group="${esc(baseName)}">
      <div class="drag-handle" style="visibility:hidden">⋮⋮</div>
      <div class="card-avatar npc">${renderIcon(portrait, baseName)}</div>
      <div class="card-body">
        <div class="card-name">${esc(baseName)} <span style="color:var(--text-muted);font-weight:400">×${members.length}</span></div>
        <div class="group-rows">
          ${members.map(m => this._renderGroupRow(m.c, m.i)).join('')}
        </div>
        <div class="group-init">⚡ Init ${init}</div>
      </div>
      <div class="card-actions"></div>
    </div>`;
  },

  _renderGroupRow(c, i){
    const active = c.id === state.activeCombatantId;
    const dead = (c.hp||0) <= 0;
    const hpPct = this._hpPct(c);
    const hpColor = this._hpColor(hpPct);
    // Grouped entries are always monsters (PCs never group). In player view
    // they must respect the monster-stats mode just like single cards do —
    // otherwise exact HP (e.g. "9/9") leaks even when single monsters show a
    // concealed "Healthy" tier or a hidden "?".
    const isPlayerView = document.body.classList.contains('player-mode');
    const mode = isPlayerView ? this._statsMode() : 'show';
    const hpReadout = mode === 'show'
      ? `<div class="group-row-bar" style="--hp-pct:${hpPct}%;--hp-color:${hpColor}">
          <span class="group-row-bar-fill"></span>
          <span class="group-row-bar-text">${c.hp}/${c.hpMax||c.hp}</span>
        </div>`
      : `<div class="group-row-bar group-row-tier"><span class="group-row-bar-text">${mode === 'conceal' ? esc(this._hpTier(c)) : '?'}</span></div>`;
    // Heal/damage + remove controls are DM-only — never expose them (or the
    // stat-block link) to players.
    const controls = isPlayerView ? '' :
      `<button class="hp-dmg-btn heal" data-act="hp-heal" data-idx="${i}" title="Heal">+</button>
      <input type="number" class="hp-dmg-amt" data-idx="${i}" value="${this._lastDmgAmount || 5}" min="0" max="999" title="Amount">
      <button class="hp-dmg-btn dmg" data-act="hp-damage" data-idx="${i}" title="Damage">−</button>
      <button class="icon-btn danger" data-act="remove" data-idx="${i}" title="Remove">×</button>`;
    const nameAttrs = isPlayerView ? '' : ` data-act="open-bestiary" data-idx="${i}" title="Open stat block"`;
    return `<div class="group-row ${active?'active':''} ${dead?'dead':''}" data-idx="${i}">
      <span class="group-row-name"${nameAttrs}>${esc(c.name)}</span>
      ${hpReadout}
      ${controls}
    </div>`;
  },

  // Class-color helper — mirrors the party tracker's palette. Reads c.cls
  // from the matching party member so monsters fall through to the default
  // accent (no class stripe).
  _pcClassColor(p){
    const COLORS = {
      barbarian:'#c25450', bard:'#c08fde', cleric:'#e8c75f', druid:'#6b9e6b',
      fighter:'#a0a0a8', monk:'#c9a050', paladin:'#d4d4dc', ranger:'#6b8f6b',
      rogue:'#6a6a72', sorcerer:'#e892a0', warlock:'#8a4fa0', wizard:'#5e8fc8',
      artificer:'#c47a52', blood_hunter:'#7c1f1f',
    };
    const cls = String(p.cls || p.sheet?.class || '').toLowerCase();
    for (const k of Object.keys(COLORS)){
      if (cls.includes(k.replace('_',' '))) return COLORS[k];
    }
    return '';
  },

  // HP bar math — returns 0-100 percent of current/max.
  _hpPct(c){
    const max = c.hpMax || c.hp || 1;
    return Math.max(0, Math.min(100, Math.round((c.hp / max) * 100)));
  },
  // HP-bar color ramp: green (75+) → yellow (35-75) → red (under 35).
  _hpColor(pct){
    if (pct <= 0) return '#5a3a3a';
    if (pct < 35) return '#c25450';
    if (pct < 75) return '#d4a574';
    return '#6b9e6b';
  },

  _renderCard(c, i, isParty){
    const active = c.id === state.activeCombatantId;
    const dead = c.hp <= 0;
    const isPC = c.isPC;
    const portrait = c.portrait
      || (isPC ? (state.party.find(p=>p.id===c.id)?.icon || '⚔')
               : (CLASS_ICONS[c.cls] || CLASS_ICONS.enemy));
    // Tri-state reveal for monsters in player view: show / conceal / hide.
    // DM tab always shows real values regardless of the setting.
    const isPlayerView = document.body.classList.contains('player-mode');
    const mode = (!isPC && isPlayerView) ? this._statsMode() : 'show';
    // Temp HP for PCs is mirrored from state.party (the party tracker owns
    // the field). Shown as a small "+N" pill next to the HP value when > 0.
    const partyMatch = isPC ? state.party.find(p => p.id === c.id) : null;
    const tempHp = partyMatch?.tempHp || 0;
    // Heal/damage controls — a permanent vertical strip sitting in its own
    // grid column to the LEFT of the HP cell. Stacks [+]/amount/[−]
    // top-to-bottom (up = heal, down = damage). Always visible (no hover),
    // since the old hover-popup added a 250ms delay to every HP change and
    // didn't work at all on touch. Conditionally suppressed only when the
    // HP itself is hidden/concealed (monsters in player view at non-show
    // stats mode).
    // Damage-type select. State-cached in this._lastDmgType so it persists
    // across re-renders. Empty = untyped (no resist/vuln/immune math).
    //
    // We want the OPEN dropdown panel to show full type names ("fire",
    // "bludgeoning") but the COLLAPSED chip to show the 2-letter abbreviation
    // so it fits the strip. Native <select> always shows the selected
    // option's text — to break that, the select is rendered with its text
    // visually hidden and an overlay span shows the abbreviation. The
    // overlay updates from JS on `change`.
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
    // Heal/damage strip is now a HORIZONTAL row that sits between the stats
    // grid and the HP bar (rendered separately below — see `dmgStripRow`).
    // We keep `dmgStrip` empty here so the stats grid stays a clean 3-column
    // ♥ ⛨ ⚡ layout at its natural height.
    const dmgStrip = '';
    const dmgStripRow = (mode !== 'show')
      ? ''
      : `<div class="hp-dmg-bar" data-idx="${i}" title="Type amount, click − to damage (drains temp HP first, applies resist/vuln/immune) or + to heal">
          <button class="hp-dmg-btn dmg" data-act="hp-damage" data-idx="${i}" title="Damage">−</button>
          <input type="number" class="hp-dmg-amt" data-idx="${i}" value="${this._lastDmgAmount || 5}" min="0" max="999" title="Heal / damage amount">
          <button class="hp-dmg-btn heal" data-act="hp-heal" data-idx="${i}" title="Heal (clamped to max HP)">+</button>
          <span class="hp-dmg-type-wrap" title="Damage type — applies monster resist/vuln/immune (current: ${lastType||'untyped'})">
            <span class="hp-dmg-type-label">${lastAbbr}</span>
            <select class="hp-dmg-type" data-idx="${i}">
              ${dmgTypes.map(([val,full]) => `<option value="${val}" ${val===lastType?'selected':''}>${full}</option>`).join('')}
            </select>
          </span>
        </div>`;
    const tempBadge = tempHp > 0 ? `<span class="hp-temp-badge" title="Temporary HP (absorbs damage first)">+${tempHp}</span>` : '';
    const hpField = mode === 'hide'
      ? '<span class="card-stat-hidden">?</span>'
      : mode === 'conceal'
        ? `<span class="card-stat-tier" title="Concealed health">${esc(this._hpTier(c))}</span>`
        : `<input type="number" value="${c.hp}" data-ci="${i}" data-cf="hp">${tempBadge}`;
    const acField = mode === 'show'
      ? `<input type="number" value="${c.ac}" data-ci="${i}" data-cf="ac">`
      : '<span class="card-stat-hidden">?</span>';

    // HP bar — thin gradient fill across the card. Hidden in player-view
    // hide/conceal modes to avoid leaking remaining HP visually.
    const hpPct = this._hpPct(c);
    const hpColor = this._hpColor(hpPct);
    const hpBar = (mode !== 'show')
      ? ''
      : `<div class="card-hp-bar" style="--hp-pct:${hpPct}%;--hp-color:${hpColor}" title="${c.hp}/${c.hpMax||c.hp} HP"><span class="card-hp-bar-fill"></span></div>`;

    // Status row — only renders chips for items that ARE active. A single
    // "+ ⋯" trailing button opens the status menu (set concentration / mark
    // reaction / add buff). When nothing's active and the row is collapsed
    // to just the "+", the whole row uses ~14 px instead of the old ~22 px.
    // For PCs, concentration comes from the party slot (single source of
    // truth); for monsters, it lives on the combatant itself.
    const conc = isPC ? (partyMatch?.concentration || '') : (c.concentration || '');
    // Rage / Wild Shape — PC-only, mirrored from the party slot. Chips are
    // visual mirrors; toggling them still happens in the party tracker
    // (single source of truth for these states). Damage routing for both
    // states is implemented further down in _applyHpDelta.
    const ragingPc = !!(isPC && partyMatch?.rage);
    const wildshape = isPC && partyMatch?.wildshape && partyMatch.wildshape.name ? partyMatch.wildshape : null;
    const chips = [];
    if (ragingPc){
      chips.push(`<span class="status-pill rage-pill" title="Raging — Advantage on STR checks/saves · Resistance to bludgeoning/piercing/slashing · Can't cast or concentrate · Toggle in the Party tracker">💢 RAGING</span>`);
    }
    if (wildshape){
      // Beast HP visible on the chip itself so the DM doesn't have to hover
      // to see how close the form is to dropping. Format: "🐺 Bear 22/34".
      const wsHpMax = wildshape.hpMax || wildshape.hp || 1;
      chips.push(`<span class="status-pill wildshape-pill" title="Wild Shape as ${esc(wildshape.name)} — damage routes to the beast HP pool. When the beast hits 0 HP the form auto-drops. Toggle in the Party tracker.">🐺 ${esc(wildshape.name)} <strong>${wildshape.hp}/${wsHpMax}</strong></span>`);
    }
    if (conc){
      chips.push(`<span class="status-pill conc-pill" data-act="clear-conc" data-idx="${i}" title="Concentrating on ${esc(conc)} — click to drop">🌀 ${esc(conc)} ×</span>`);
    }
    if (c.reactionUsed){
      chips.push(`<span class="status-pill react-pip spent" data-act="toggle-reaction" data-idx="${i}" title="Reaction spent this round — click to refund">↩ React</span>`);
    }
    const buffs = Array.isArray(c.buffs) ? c.buffs : [];
    buffs.forEach((bf, bi) => {
      const acStr = bf.ac ? ` ${bf.ac>0?'+':''}${bf.ac}AC` : '';
      const hpStr = bf.hp ? ` ${bf.hp>0?'+':''}${bf.hp}HP` : '';
      const dur   = (bf.rounds!=null && bf.rounds>=0) ? ` ${bf.rounds}r` : '';
      chips.push(`<span class="status-pill buff-pill" data-act="rm-buff" data-idx="${i}" data-bi="${bi}" title="${esc(bf.label||'Buff')}${esc(acStr)}${esc(hpStr)}${esc(dur)} — click to remove">✦ ${esc(bf.label||'buff')}${acStr}${hpStr}${dur} ×</span>`);
    });
    // Trailing add button — opens a small inline menu for the three actions.
    // The menu is built lazily via showContextMenu so we don't render it now.
    const addPill = `<span class="status-pill status-add" data-act="status-menu" data-idx="${i}" title="Add concentration / mark reaction / add buff">+</span>`;
    const statusRow = (mode === 'show')
      ? `<div class="combat-status-row">${chips.join('')}${addPill}</div>`
      : '';

    // Name rendered as a span with data-act="open-bestiary" for monsters so
    // clicking pops the stat block. PCs already get a quick-ref popout on
    // click elsewhere — keep their existing path.
    const nameClickable = !isPC && c.baseName;
    // Class-color accent stripe for PCs — pulled from the party tracker's
    // class palette so the two panels read as one design language. Monsters
    // get a neutral accent (no class) so the two are also visually distinct.
    const classColor = isPC && partyMatch ? this._pcClassColor(partyMatch) : '';
    const cardStyle = classColor ? ` style="--class-color:${classColor}"` : '';
    return `<div class="combatant-card ${active?'active':''} ${dead?'dead':''} ${isPC?'pc':'npc'}" data-idx="${i}" draggable="true"${cardStyle}>
      ${isPC?'<div class="card-class-stripe"></div>':''}
      <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
      <div class="card-avatar ${isPC?'pc':'npc'}" data-act="upload-portrait" data-idx="${i}" title="Click to upload portrait">${renderIcon(portrait, c.name)}</div>
      <div class="card-body">
        ${isPC
          ? `<div class="card-name">${esc(c.name)}${active?' <span class="turn-marker">◀</span>':''}</div>`
          : `<div class="card-name-row">
              <input class="card-name-input ${nameClickable?'clickable':''}" type="text" value="${esc(c.name)}" data-ci="${i}" data-cf="name" ${nameClickable?'data-bestiary-link="1"':''} title="${nameClickable?'Edit name (Ctrl+click to open stat block)':'Edit name'}">
              ${(()=>{
                const opts = (state.settings && state.settings.combatNameOptions) || ['spear','hands','rock','small'];
                return `<select class="card-name-quick" data-ci="${i}" title="Quick-pick name">
                  <option value="">⌄</option>
                  ${opts.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}
                  <option disabled>─────</option>
                  <option value="__manage__">⚙ Manage…</option>
                </select>`;
              })()}
              ${nameClickable?`<button class="btn icon-btn" data-act="open-bestiary" data-idx="${i}" title="Open ${esc(c.baseName)} stat block in bestiary popout">📖</button>`:''}
              ${active?'<span class="turn-marker">◀</span>':''}
            </div>`}
        <div class="card-stats">
          <div class="card-stat" title="HP"><span class="lab">♥</span>${hpField}</div>
          <div class="card-stat" title="AC"><span class="lab">⛨</span>${acField}</div>
          <div class="card-stat" title="Initiative"><span class="lab">⚡</span><input type="number" value="${c.initiative||0}" data-ci="${i}" data-cf="initiative"></div>
        </div>
        ${dmgStripRow}
        ${hpBar}
        ${statusRow}
        ${c.conditions&&c.conditions.length?`<div class="conditions">${c.conditions.map(cd=>`<span class="condition-tag" data-act="rmcond" data-idx="${i}" data-cond="${esc(cd)}">${esc(cd)} ×</span>`).join('')}</div>`:''}
        ${(!isPC && (c.legendaryMax || c.legendaryMax === 0)) ? this._renderLegendary(i, c) : ''}
        ${(isPC && (c.hp||0) <= 0 && !c.dead && !c.stable) ? this._renderDeathSaves(i, c) : ''}
        ${(isPC && c.dead)   ? '<div class="death-saves dead-banner" title="The PC is dead. Heal them above 0 HP (revivify, etc.) to bring them back.">💀 Dead</div>' : ''}
        ${(isPC && c.stable && (c.hp||0) <= 0) ? '<div class="death-saves stable-banner" title="Stable at 0 HP — no more death saves unless they take damage (which will start fresh saves with one failure, per RAW).">⚕ Stable</div>' : ''}
      </div>
      <div class="card-actions">
        ${isPlayerView ? '' : `<button class="btn icon-btn danger" data-act="remove" data-idx="${i}" title="Remove">×</button>`}
        ${(isPC || isPlayerView) ? '' : `<button class="btn icon-btn" data-act="duplicate" data-idx="${i}" title="Duplicate">⎘</button>`}
      </div>
    </div>`;
  },

  _wire(){
    const b=this._body;if(!b)return;

    // Toolbar + per-card actions
    b.querySelectorAll('[data-act]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      const act=el.dataset.act;
      if(act==='next')                this._nextTurn();
      else if(act==='prev')           this._prevTurn();
      else if(act==='toggle-compact'){ state.settings.combatCompact = !state.settings.combatCompact; save(); this._render(); }
      else if(act==='toggle-group')  { state.settings.combatGroupSimilar = !state.settings.combatGroupSimilar; save(); this._render(); }
      else if(act==='toggle-reaction'){
        const i = parseInt(el.dataset.idx);
        const c = state.combatants[i]; if (!c) return;
        state.combatants[i] = {...c, reactionUsed: !c.reactionUsed};
        save(); this._render();
      }
      else if(act==='status-menu'){
        // Open a tiny context menu for the three add-status actions. The
        // anchor is the "+" pill itself; we position the menu just below it.
        const idx = parseInt(el.dataset.idx);
        const c = state.combatants[idx]; if (!c) return;
        const rect = el.getBoundingClientRect();
        const items = [];
        // Show "mark reaction" only when reaction is currently available
        // (when it's spent, the spent chip itself toggles to refund).
        if (!c.reactionUsed){
          items.push({ label: '↩ Mark reaction used', onClick: () => {
            state.combatants[idx] = {...c, reactionUsed: true};
            save(); this._render();
          }});
        }
        items.push({ label: '🌀 Set concentration…', onClick: () => this._promptConcentration(idx) });
        items.push({ label: '✦ Add buff…',           onClick: () => this._promptAddBuff(idx) });
        showContextMenu(rect.left, rect.bottom + 4, items);
      }
      else if(act==='set-conc')      this._promptConcentration(parseInt(el.dataset.idx));
      else if(act==='clear-conc'){
        const i = parseInt(el.dataset.idx);
        this._setConcentration(i, null);
      }
      else if(act==='add-buff')      this._promptAddBuff(parseInt(el.dataset.idx));
      else if(act==='rm-buff'){
        const i  = parseInt(el.dataset.idx);
        const bi = parseInt(el.dataset.bi);
        const c = state.combatants[i]; if (!c || !Array.isArray(c.buffs)) return;
        const bf = c.buffs[bi]; if (!bf) return;
        // Reverse the AC/HP delta when removing — symmetrical to _promptAddBuff.
        const next = c.buffs.slice(); next.splice(bi, 1);
        const patch = {buffs: next};
        if (bf.ac){ patch.ac = (c.ac || 0) - bf.ac; }
        if (bf.hp){
          patch.hpMax = Math.max(1, (c.hpMax || 0) - bf.hp);
          patch.hp    = Math.min(patch.hpMax, (c.hp || 0) - bf.hp);
        }
        state.combatants[i] = {...c, ...patch};
        save(); this._render();
      }
      else if(act==='open-bestiary') this._openBestiaryDetail(parseInt(el.dataset.idx));
      else if(act==='end'){
        const proceed = ok => {
          if (!ok) return;
          state.combatants = [];
          state.combatRound = 0;
          state.activeCombatantId = null;
          save(); this._render();
          if (typeof showToast === 'function') showToast('Combat ended');
        };
        if (typeof showConfirm === 'function'){
          showConfirm('End combat? All combatants will be removed.',
            {title:'End combat', confirmLabel:'End', danger:true}).then(proceed);
        } else {
          // Fallback if utils.js failed to load — at least don't crash.
          proceed(window.confirm('End combat? All combatants will be removed.'));
        }
      }
      else if(act==='add')            this._addPrompt();
      else if(act==='add-monster')    this._openMonsterPicker();
      else if(act==='remove')         this._remove(parseInt(el.dataset.idx));
      else if(act==='duplicate')      this._duplicate(parseInt(el.dataset.idx));
      else if(act==='rmcond')         this._removeCond(parseInt(el.dataset.idx),el.dataset.cond);
      else if(act==='upload-portrait')this._uploadPortrait(parseInt(el.dataset.idx));
      else if(act==='toggle-log'){
        // Toggle when clicking the header — but not when clicking one of
        // the inline action buttons inside the header (which have their
        // own data-act values).
        if (e.target.closest('.combat-log-mini')) return;
        this._logOpen = !(this._logOpen !== false);
        this._render();
      }
      else if(act==='log-toggle-all'){
        this._logShowAll = !this._logShowAll;
        this._render();
      }
      else if(act==='log-clear'){
        if (typeof showConfirm === 'function'){
          showConfirm('Clear the round log? This can\'t be undone.', {title:'Clear log', confirmLabel:'Clear', danger:true}).then(ok => {
            if (!ok) return;
            state.combatLog = [];
            save(); this._render();
          });
        } else {
          state.combatLog = [];
          save(); this._render();
        }
      }
      else if(act==='legendary-pip'){
        const i = parseInt(el.dataset.idx);
        const n = parseInt(el.dataset.n);
        const c = state.combatants[i]; if (!c || !c.legendaryMax) return;
        const used = c.legendaryUsed || 0;
        // Clicking pip N: if it's empty (N >= used), spend up to & including N
        // (used = N+1). If it's filled (N < used), refund (used = N).
        c.legendaryUsed = n < used ? n : (n + 1);
        save(); this._render();
      }
      else if(act==='hp-damage' || act==='hp-heal'){
        const i = parseInt(el.dataset.idx);
        // Read the amount from THIS row's input. Group rows have their own
        // amt input; single-card rows put it inside .hp-dmg-strip. We scope
        // via the same data-idx attribute on the input.
        const card = el.closest('.combatant-card');
        const amtInp = card?.querySelector(`.hp-dmg-amt[data-idx="${i}"]`) || card?.querySelector('.hp-dmg-amt');
        // Damage type: prefer the local card's type select. Group rows
        // don't render a select at all (no room), so fall back to
        // this._lastDmgType — the same panel-scoped value that keeps
        // single-card selects in sync across renders. Without this fallback
        // group rows always passed type='' and silently bypassed every
        // monster's resist/immune/vulnerable.
        const typeSel = card?.querySelector('.hp-dmg-type');
        const amt = Math.max(0, parseInt(amtInp?.value) || 0);
        if (!amt) return;
        this._lastDmgAmount = amt;
        const type = typeSel ? typeSel.value : (this._lastDmgType || '');
        if (act === 'hp-damage') this._applyHpDelta(i, -amt, type);
        else                     this._applyHpDelta(i, +amt);
      }
      else if(act==='death-save'){
        const i = parseInt(el.dataset.idx);
        const kind = el.dataset.kind; // 'success' | 'fail'
        const n = parseInt(el.dataset.n);
        const c = state.combatants[i]; if (!c) return;
        // Dead PCs can't roll. Without this guard, clicking the 3rd-fail
        // pip on a dead PC un-fills it (the toggle below would read
        // ds[kind]=3 >= n=3 → true → set to 2), effectively un-killing them.
        if (c.dead) return;
        const ds = {...(c.deathSaves || {success:0, fail:0})};
        // Click N: if already at >=N, set to N-1 (un-click); else set to N.
        ds[kind] = (ds[kind] >= n) ? (n-1) : n;
        state.combatants[i] = {...c, deathSaves: ds};
        if (ds.success >= 3){
          // Stabilize: HP stays at 0 (RAW), but no more death saves until
          // the PC takes new damage. Set c.stable so _applyHpDelta knows
          // not to re-initialize {success:0, fail:0} on the next damage
          // — instead it should flip stable→false AND record one failure
          // (or two, on crit). Clear the deathSaves struct so the pip row
          // doesn't render anymore.
          state.combatants[i] = {...state.combatants[i], deathSaves: null, stable: true};
          showToast(c.name + ' stabilized');
        } else if (ds.fail >= 3){
          // Dead: lock the state so re-clicking the 3rd pip can't undo it,
          // and so future damage doesn't re-initialize saves. The death
          // pip row stops rendering; the card stays in its dead visual
          // (.dead class is added because c.hp is still ≤ 0).
          state.combatants[i] = {...state.combatants[i], deathSaves: null, dead: true};
          showToast(c.name + ' has died');
        }
        save(); this._render();
      }
    }));

    // Damage/heal amount inputs shouldn't trigger card click or drag.
    b.querySelectorAll('.hp-dmg-amt').forEach(inp => {
      inp.addEventListener('click', e => e.stopPropagation());
      inp.addEventListener('mousedown', e => e.stopPropagation());
      // Persist the typed value so the next render starts from it.
      inp.addEventListener('change', () => {
        const v = parseInt(inp.value) || 0;
        if (v > 0) this._lastDmgAmount = v;
      });
    });

    // Damage-type select — same suppress + persistence dance, plus updating
    // the overlay label to the 2-letter abbreviation on change. The map
    // lives here so the render path and wire path agree on abbreviations.
    const ABBR = {'':'—','acid':'ac','bludgeoning':'bl','cold':'co','fire':'fi','force':'fo','lightning':'li','necrotic':'ne','piercing':'pi','poison':'po','psychic':'ps','radiant':'ra','slashing':'sl','thunder':'th'};
    b.querySelectorAll('.hp-dmg-type').forEach(sel => {
      sel.addEventListener('click', e => e.stopPropagation());
      sel.addEventListener('mousedown', e => e.stopPropagation());
      sel.addEventListener('change', () => {
        this._lastDmgType = sel.value;
        const lbl = sel.parentElement?.querySelector('.hp-dmg-type-label');
        if (lbl) lbl.textContent = ABBR[sel.value] || '—';
        // Also refresh the wrap's tooltip so hover reads correctly without
        // a full re-render.
        const wrap = sel.parentElement;
        if (wrap) wrap.title = 'Damage type — applies monster resist/vuln/immune (current: ' + (sel.value || 'untyped') + ')';
      });
    });

    // Monster name input: Ctrl+click opens stat block. Plain click still
    // lets the user type/edit. We listen on mousedown so we can catch the
    // modifier before the input focuses.
    b.querySelectorAll('input.card-name-input[data-bestiary-link="1"]').forEach(inp => {
      inp.addEventListener('mousedown', e => {
        if (e.ctrlKey || e.metaKey){
          e.preventDefault();
          const card = inp.closest('.combatant-card');
          const i = parseInt(card?.dataset.idx);
          if (!isNaN(i)) this._openBestiaryDetail(i);
        }
      });
    });

    // Combatant inputs (hp, ac, initiative, name) — no auto-sort
    // Numeric fields are clamped to sane ranges to prevent fat-finger inputs
    // (e.g. typing -9999 into HP) and 9-digit overflow values from sticking.
    const CLAMP = {
      hp:         {min:-9999, max: 99999},  // negative HP allowed: downed PCs can dip below 0 from massive hits
      hpMax:      {min:    1, max: 99999},
      ac:         {min:    0, max:    99},
      initiative: {min:  -99, max:    99},
      initBonus:  {min:  -20, max:    20},
    };
    b.querySelectorAll('input[data-cf]').forEach(inp=>{
      inp.addEventListener('change',e=>{
        const i=+e.target.dataset.ci, f=e.target.dataset.cf;
        const isText = f === 'name';
        let val = isText ? String(e.target.value).trim() : (parseInt(e.target.value)||0);
        if (!isText && CLAMP[f]){
          const {min, max} = CLAMP[f];
          if (val < min) val = min;
          if (val > max) val = max;
          // Reflect the clamp in the field so the user sees what was actually saved.
          if (String(val) !== e.target.value) e.target.value = val;
        }
        state.combatants[i]={...state.combatants[i],[f]:val};
        // PC came back above 0 HP — wipe ALL downed-related state: death
        // saves, stable flag, dead flag. (Direct edit is rarer than the
        // strip, but a DM raising an HP value is an explicit revive.)
        if (f === 'hp' && state.combatants[i].isPC && val > 0){
          const next = {...state.combatants[i]};
          if (next.deathSaves) next.deathSaves = undefined;
          if (next.stable)     next.stable = undefined;
          if (next.dead)       next.dead = undefined;
          state.combatants[i] = next;
        }
        // Mirror to the party slot BEFORE saving so localStorage (and the
        // resulting Firebase push) captures both halves in one consistent
        // write — see the matching comment in party.js.
        if((f==='hp'||f==='ac')&&state.combatants[i]?.isPC) syncCombatToParty(state.combatants[i].id);
        save();
        this._render();
      });
      inp.addEventListener('click',e=>e.stopPropagation());
      inp.addEventListener('mousedown',e=>e.stopPropagation()); // don't start card drag from input
    });

    // Quick-pick name dropdown
    b.querySelectorAll('select.card-name-quick').forEach(sel=>{
      sel.addEventListener('change',e=>{
        e.stopPropagation();
        const v = e.target.value;
        if (!v) return;
        if (v === '__manage__'){ e.target.value=''; this._manageQuickNames(); return; }
        const i = +e.target.dataset.ci;
        state.combatants[i] = {...state.combatants[i], name: v};
        save(); this._render();
      });
      sel.addEventListener('click',e=>e.stopPropagation());
      sel.addEventListener('mousedown',e=>e.stopPropagation());
    });

    // Right-click (or long-press on mobile): conditions menu / PC quick-ref
    b.querySelectorAll('.combatant-card').forEach(card=>{
      const openMenu = (x, y) => {
        const i=+card.dataset.idx;
        const c=state.combatants[i]; if(!c) return;
        const have=new Set(c.conditions||[]);
        const items = [];
        // Monsters get a "Legendary actions" sub-section at the top: enable
        // with a default of 3, or adjust to 0/1/2/3/4/5 once enabled.
        if (!c.isPC){
          if (c.legendaryMax == null){
            items.push({ label:'➕ Enable legendary actions (3/turn)', onClick:()=>{
              state.combatants[i] = {...c, legendaryMax:3, legendaryUsed:0};
              save(); this._render();
            }});
          } else {
            items.push({ label:'⚜ Legendary uses ─────', disabled:true });
            for (let n = 0; n <= 5; n++){
              items.push({
                label: '   ' + n + ' / turn',
                checked: c.legendaryMax === n,
                onClick: () => {
                  state.combatants[i] = {...c, legendaryMax:n, legendaryUsed:Math.min(c.legendaryUsed||0, n)};
                  save(); this._render();
                }
              });
            }
            items.push({ label:'✕ Disable legendary tracker', onClick:()=>{
              state.combatants[i] = {...c};
              delete state.combatants[i].legendaryMax;
              delete state.combatants[i].legendaryUsed;
              save(); this._render();
            }});
            items.push({ label:'─────', disabled:true });
          }
        }
        SEARCH_DATA
          .filter(d=>d.cat==='condition')
          .forEach(d => items.push({label:d.name, checked:have.has(d.name), onClick:()=>this._toggleCondAtIdx(i,d.name)}));
        showContextMenu(x, y, items);
      };
      card.addEventListener('contextmenu',e=>{
        if(e.target.matches('input,textarea,select')) return;
        e.preventDefault(); e.stopPropagation();
        openMenu(e.clientX, e.clientY);
      });
      // Long-press on touch devices (no right-click).
      addLongPress(card, (x, y) => openMenu(x, y));
    });

    this._wireDragReorder();
  },

  // HTML5 drag-and-drop — reorder combatant cards by dragging.
  _wireDragReorder(){
    const b=this._body;if(!b)return;
    const list = b.querySelector('#combat-list');
    if (!list) return;
    list.querySelectorAll('.combatant-card').forEach(card=>{
      // Skip group containers — they have no data-idx (the per-row
      // .group-row children own their own indices, but those aren't
      // .combatant-card and therefore aren't selected here). Without this
      // guard, the drop handler runs parseInt(undefined) → NaN, then
      // state.combatants.splice(NaN, …) coerces to splice(0, …) and
      // silently scrambles initiative whenever grouping is on. Group
      // cards aren't draggable anyway; ignoring them entirely is correct.
      if (!card.dataset.idx) return;
      card.addEventListener('dragstart', e=>{
        // Suppress drag if user grabbed an input/select (they need text drag)
        if (e.target.closest('input,select,textarea,button')) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-skt-combat-idx', card.dataset.idx);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', ()=>card.classList.remove('dragging'));
      card.addEventListener('dragover', e=>{
        if (!e.dataTransfer.types.includes('application/x-skt-combat-idx')) return;
        e.preventDefault();
        const r = card.getBoundingClientRect();
        const before = e.clientY < r.top + r.height/2;
        card.classList.toggle('drop-before', before);
        card.classList.toggle('drop-after', !before);
      });
      card.addEventListener('dragleave', ()=>{
        card.classList.remove('drop-before','drop-after');
      });
      card.addEventListener('drop', e=>{
        const fromStr = e.dataTransfer.getData('application/x-skt-combat-idx');
        if (!fromStr) return;
        e.preventDefault();
        const from = parseInt(fromStr);
        const r = card.getBoundingClientRect();
        const before = e.clientY < r.top + r.height/2;
        let to = parseInt(card.dataset.idx);
        // Defensive: if either index didn't parse (group card sneaks in,
        // unexpected DOM, etc.) bail rather than splicing(NaN) which would
        // coerce to splice(0, …) and silently scramble combat order.
        if (Number.isNaN(from) || Number.isNaN(to)){
          card.classList.remove('drop-before','drop-after');
          return;
        }
        if (!before) to += 1;
        // Adjust because removing from earlier index shifts indices down
        if (from < to) to -= 1;
        card.classList.remove('drop-before','drop-after');
        if (from === to) return;
        const [moved] = state.combatants.splice(from, 1);
        state.combatants.splice(to, 0, moved);
        save(); this._render();
      });
    });
  },

  // External drop zone — accepts bestiary monsters and party members dragged
  // in from their respective panels. Listens on the whole panel body so the
  // user can drop anywhere inside the tracker, not just on an existing card.
  // Wired exactly once per mount — _render() rebuilds innerHTML but keeps
  // the body element, so re-attaching here on every render would stack
  // duplicate listeners and a single drop would fire multiple times.
  _wireBestiaryDrop(){
    const b=this._body;if(!b)return;
    if (b._bestiaryDropWired) return;
    b._bestiaryDropWired = true;
    const externalTypes = ['application/x-skt-bestiary-mid','application/x-skt-party-pi'];
    const hasExternal = e => externalTypes.some(t => e.dataTransfer.types.includes(t));
    b.addEventListener('dragover', e=>{
      if (!hasExternal(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      b.classList.add('drop-active');
    });
    b.addEventListener('dragleave', e=>{
      if (e.target === b) b.classList.remove('drop-active');
    });
    b.addEventListener('drop', e=>{
      b.classList.remove('drop-active');
      const mid = e.dataTransfer.getData('application/x-skt-bestiary-mid');
      const pi  = e.dataTransfer.getData('application/x-skt-party-pi');
      if (mid){
        e.preventDefault();
        const bData = panelDefs.bestiary?._data;
        const m = bData?.monsters.find(x=>x.id===mid);
        if (!m){ showToast('Monster not found'); return; }
        let entry = null;
        if (typeof _5eData !== 'undefined' && _5eLoaded){
          entry = _5eData.find(d => d.cat==='monster' && d._slug === m.slug);
        }
        if (entry) this.addMonster(entry);
        else       this.addMonster({name:m.name, hp:m.hp||10, ac:m.ac||10, dex:10, _img:m.img||null});
      } else if (pi !== ''){
        e.preventDefault();
        this._addPartyToCombat(parseInt(pi));
      }
    });
  },

  _addPartyToCombat(pi){
    const p=state.party[pi];
    if(state.combatants.find(c=>c.isPC&&c.id===p.id)){showToast(p.name+' already in combat');return;}
    const dexMod = (p.abilities && typeof p.abilities.dex === 'number') ? Math.floor((p.abilities.dex - 10)/2) : null;
    const initBonus = (typeof p.init === 'number' ? p.init : null) ?? dexMod ?? 0;
    state.combatants.push({id:p.id,name:p.name,isPC:true,cls:p.cls||'fighter',hp:p.hp,hpMax:p.hpMax,ac:p.ac,initBonus,initiative:p.init||0,conditions:[]});
    if(!state.combatRound) state.combatRound=1;
    save();this._render();
    showToast(`${p.name} added`);
  },

  _removeFromCombatById(id){
    const i=state.combatants.findIndex(c=>c.id===id);
    if(i>=0){state.combatants.splice(i,1);save();this._render();}
  },

  _addPrompt(){
    showModal('⚔ Add Combatant',[
      {id:'name',  label:'Name',       type:'text',   value:'',  placeholder:'Bandit, Ogre...'},
      {id:'hp',    label:'HP',         type:'number', value:20,  min:1},
      {id:'ac',    label:'AC',         type:'number', value:12,  min:1},
      {id:'init',  label:'Initiative', type:'number', value:0},
    ],'Add to combat').then(r=>{
      if(!r||!r.name)return;
      state.combatants.push({id:uid(),name:r.name,isPC:false,cls:'enemy',hp:r.hp,hpMax:r.hp,ac:r.ac,initBonus:0,initiative:r.init,conditions:[]});
      if(!state.combatRound) state.combatRound=1;
      save();this._render();
    });
  },

  // Open a monster picker that searches the loaded 5e bestiary. Shares the
  // same picker UI flow as the Bestiary panel but adds the chosen monster
  // straight into combat.
  _openMonsterPicker(){
    if (typeof _5eData === 'undefined' || !_5eLoaded){
      showToast('5e data still loading — try again in a moment');
      return;
    }
    const all = _5eData.filter(d=>d.cat==='monster').sort((a,b)=>a.name.localeCompare(b.name));
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:520px;max-width:90vw">
      <h3>Add Monster to Combat</h3>
      <input type="search" id="cmb-pick-search" placeholder="🔎 Search 5e monsters…" autocomplete="off"
        style="width:100%;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:5px;font-size:12px;margin-bottom:10px">
      <div id="cmb-pick-list" style="max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:5px;background:var(--panel-2)"></div>
      <div class="modal-actions"><button class="btn" id="cmb-pick-close">Close</button></div>
    </div>`;
    document.body.appendChild(backdrop);
    const list = backdrop.querySelector('#cmb-pick-list');
    const renderList = q=>{
      const qn=(q||'').toLowerCase().trim();
      const pool = qn ? all.filter(d=>d.name.toLowerCase().includes(qn)||(d.meta||'').toLowerCase().includes(qn)||(d._source||'').toLowerCase().includes(qn)||(_formatSource(d._source)||'').toLowerCase().includes(qn)).slice(0,200) : all.slice(0,200);
      list.innerHTML = pool.map(d=>`<div class="bestiary-pick-row" data-slug="${esc(d._slug)}">
        <div class="bestiary-pick-left">
          <span class="bestiary-pick-name">${esc(d.name)}</span>
          ${d._source ? `<span class="detail-source-badge">${esc(_formatSource(d._source))}</span>` : ''}
        </div>
        <span class="bestiary-pick-meta">${esc(d.meta||'')}</span>
      </div>`).join('') || '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px">No matches</div>';
    };
    renderList('');
    const close = ()=>backdrop.remove();
    backdrop.querySelector('#cmb-pick-search').addEventListener('input', e=>renderList(e.target.value));
    backdrop.querySelector('#cmb-pick-close').addEventListener('click', close);
    backdrop.addEventListener('mousedown', e=>{ if (e.target===backdrop) close(); });
    backdrop.addEventListener('keydown', e=>{ if (e.key==='Escape') close(); });
    list.addEventListener('click', e=>{
      const row = e.target.closest('.bestiary-pick-row'); if (!row) return;
      const d = all.find(x=>x._slug===row.dataset.slug); if (!d) return;
      this.addMonster(d);
      close();
    });
    setTimeout(()=>backdrop.querySelector('#cmb-pick-search').focus(), 30);
  },

  _remove(i){state.combatants.splice(i,1);save();this._render();},

  // Duplicate a monster card. Re-uses the same baseName logic addMonster
  // uses so a second Goblin becomes "Goblin 2" (and the original gets
  // renamed to "Goblin 1" so the group is unambiguous).
  _duplicate(i){
    const c = state.combatants[i]; if (!c || c.isPC) return;
    const base = c.baseName || c.name;
    const existing = state.combatants.filter(x=>x.baseName===base || x.name===base).length;
    const copyNum = Math.max(existing, 1) + 1;
    const newName = base + ' ' + copyNum;
    if (existing === 1){
      // First duplicate — number the original too
      const oi = state.combatants.findIndex(x=>x.baseName===base || x.name===base);
      if (oi >= 0) state.combatants[oi] = {...state.combatants[oi], name: base+' 1', baseName: base};
    }
    state.combatants.splice(i+1, 0, {
      ...c,
      id: uid(),
      name: newName,
      baseName: base,
      hp: c.hpMax || c.hp,
      conditions: [],
      // Fresh legendary pool on the duplicate — the original's spent count
      // shouldn't carry over to the new instance.
      legendaryUsed: c.legendaryMax ? 0 : c.legendaryUsed,
    });
    save(); this._render();
  },

  _nextTurn(){
    if(!state.combatants.length){ showToast('No combatants yet'); return; }
    let id=state.activeCombatantId,round=state.combatRound;
    let newRound = false;
    if(!id){id=state.combatants[0].id;round=Math.max(1,round);}
    else{
      let ni=state.combatants.findIndex(c=>c.id===id)+1;
      if(ni>=state.combatants.length){ni=0;round++;newRound=true;showToast(`Round ${round}`);}
      id=state.combatants[ni].id;
    }
    state.activeCombatantId=id;state.combatRound=round;
    if (newRound){
      this._log('— Round ' + round + ' —');
      // Refresh legendary actions + reaction availability at the start of
      // every round (5e rule: both refresh on a creature's own turn, but the
      // common simplification is "everyone resets on round tick" — close
      // enough for the table, and saves per-combatant accounting).
      state.combatants.forEach(c => {
        if (c.legendaryMax){ c.legendaryUsed = 0; }
        if (c.reactionUsed){ c.reactionUsed = false; }
      });
      // Tick down buff durations. A buff at rounds==0 expires after this
      // round's start — drop it. Negative/undefined durations are permanent
      // (until manually removed) and don't tick.
      state.combatants.forEach(c => {
        if (!Array.isArray(c.buffs) || !c.buffs.length) return;
        const next = [];
        for (const bf of c.buffs){
          if (bf.rounds == null || bf.rounds < 0) { next.push(bf); continue; }
          // rounds is "ticks remaining". rounds<=1 → expires at THIS round
          // tick. rounds>1 → decrement and keep.
          if (bf.rounds <= 1){
            this._log(`${c.name} — buff "${bf.label||'buff'}" expired`);
            // Reverse the AC/HP delta on expiry so the chip removal mirrors
            // a manual ×-click. HP delta backs out of both current and max.
            if (bf.ac){ c.ac = (c.ac || 0) - bf.ac; }
            if (bf.hp){
              c.hpMax = Math.max(1, (c.hpMax || 0) - bf.hp);
              c.hp    = Math.min(c.hpMax, (c.hp || 0) - bf.hp);
            }
            continue;
          }
          next.push({...bf, rounds: bf.rounds - 1});
        }
        c.buffs = next;
      });
    }
    save();this._render();
  },

  // Step back one turn. Mirror of _nextTurn but in reverse. Crossing into
  // the previous round decrements the counter; doesn't undo buff/reaction/
  // legendary side-effects (those are state mutations, not the timeline).
  _prevTurn(){
    if (!state.combatants.length){ showToast('No combatants yet'); return; }
    let id = state.activeCombatantId;
    let round = state.combatRound || 1;
    if (!id){
      // No active turn — set to last combatant.
      state.activeCombatantId = state.combatants[state.combatants.length-1].id;
    } else {
      let pi = state.combatants.findIndex(c => c.id === id) - 1;
      if (pi < 0){
        if (round <= 1){ showToast('Already at start of round 1'); return; }
        pi = state.combatants.length - 1;
        round -= 1;
        showToast(`Back to round ${round}`);
      }
      state.activeCombatantId = state.combatants[pi].id;
      state.combatRound = round;
    }
    save(); this._render();
  },

  // Roll 1d20 + initBonus for every NPC. Skips PCs entirely (their initiative
  // comes from the player's own roll at the table) and skips NPCs whose
  // initBonus is missing (caller should fix the data first). Toasts a summary.
  _rollInitiative(){
    if (!state.combatants.length){ showToast('No combatants yet'); return; }
    let rolled = 0;
    state.combatants.forEach((c, i) => {
      if (c.isPC) return;
      const bonus = c.initBonus || 0;
      const d20 = 1 + Math.floor(Math.random() * 20);
      state.combatants[i] = {...c, initiative: d20 + bonus};
      rolled++;
    });
    if (!rolled){ showToast('No NPCs to roll for'); return; }
    save(); this._render();
    showToast(`Rolled initiative for ${rolled} NPC${rolled===1?'':'s'}`);
  },

  // Sort combatants by initiative DESC, with Dex modifier as tiebreaker
  // (5e PHB ch.9: "If a tie occurs, the DM decides... or roll a d20").
  // We use Dex mod because it's the canonical tiebreaker most tables use.
  // Active combatant ID is preserved so the turn marker survives the sort.
  _sortByInitiative(){
    if (!state.combatants.length){ showToast('No combatants yet'); return; }
    const dexMod = c => {
      if (c.isPC){
        const p = state.party.find(pp => pp.id === c.id);
        const ab = p && p.abilities;
        return (ab && typeof ab.dex === 'number') ? Math.floor((ab.dex - 10) / 2) : 0;
      }
      // For monsters, initBonus IS the Dex mod (set in addMonster), so reuse.
      return c.initBonus || 0;
    };
    state.combatants.sort((a, b) => {
      const di = (b.initiative || 0) - (a.initiative || 0);
      if (di !== 0) return di;
      return dexMod(b) - dexMod(a);
    });
    save(); this._render();
    showToast('Sorted by initiative (Dex breaks ties)');
  },

  // Open the bestiary detail popout for a monster combatant. Looks up the
  // 5etools entry by slug — falls back to a toast if data isn't loaded.
  _openBestiaryDetail(i){
    const c = state.combatants[i];
    if (!c || c.isPC){ return; }
    if (typeof _5eData === 'undefined' || !_5eLoaded){
      showToast('5e data still loading — try again in a moment');
      return;
    }
    const base = (c.baseName || c.name || '').toLowerCase();
    const entry = _5eData.find(d => d.cat === 'monster' && d.name.toLowerCase() === base);
    if (!entry){ showToast('Stat block not found for ' + (c.baseName||c.name)); return; }
    if (typeof popOutDetail === 'function') popOutDetail(entry);
  },

  // Concentration prompt — set or change the concentration spell. For PCs
  // this writes through to the party slot so both panels stay in sync.
  _promptConcentration(i){
    const c = state.combatants[i]; if (!c) return;
    const cur = c.isPC
      ? (state.party.find(p => p.id === c.id)?.concentration || '')
      : (c.concentration || '');
    showModal('🌀 Concentration spell — ' + c.name, [
      {id:'spell', label:'Spell name (leave blank to clear)', type:'text', value: cur, placeholder:'Bless, Hold Person, Hex…'},
    ], cur ? 'Update' : 'Concentrate').then(r => {
      if (!r) return; // cancel
      const trimmed = String(r.spell || '').trim();
      this._setConcentration(i, trimmed || null);
    });
  },
  _setConcentration(i, spellName){
    const c = state.combatants[i]; if (!c) return;
    if (c.isPC){
      const pi = state.party.findIndex(p => p.id === c.id);
      if (pi >= 0) state.party[pi] = {...state.party[pi], concentration: spellName || null};
    } else {
      state.combatants[i] = {...c, concentration: spellName || null};
    }
    save(); this._render();
    // Party panel mirrors concentration; nudge it to re-render so the chip
    // updates immediately on its side.
    if (c.isPC) panelDefs.party?._render?.();
  },

  // Buff prompt — collects label / AC delta / HP delta / duration.
  // Stored on combatant as {label, ac, hp, rounds}. Duration in rounds:
  // 0 = expires at start of next round; -1 (or undefined) = permanent.
  _promptAddBuff(i){
    const c = state.combatants[i]; if (!c) return;
    showModal('Add buff to ' + c.name, [
      {id:'label',  label:'Name (e.g. Shield, Bless, Mage Armor)', type:'text',   value:''},
      {id:'ac',     label:'AC bonus (blank for none)',             type:'number', value:''},
      {id:'hp',     label:'HP bonus (blank for none)',             type:'number', value:''},
      {id:'rounds', label:'Duration in rounds (blank = permanent)', type:'number', value:''},
    ], 'Add buff').then(r => {
      if (!r || !String(r.label||'').trim()) return;
      const next = Array.isArray(c.buffs) ? c.buffs.slice() : [];
      const ac = r.ac === '' || r.ac == null ? 0 : (parseInt(r.ac) || 0);
      const hp = r.hp === '' || r.hp == null ? 0 : (parseInt(r.hp) || 0);
      const rounds = (r.rounds === '' || r.rounds == null) ? null : Math.max(0, parseInt(r.rounds) || 0);
      next.push({label: String(r.label).trim(), ac, hp, rounds});
      // Apply the AC/HP delta immediately so the visible stats reflect the
      // buff. We DON'T track an "original AC" anywhere — the DM uses the
      // buff chip's remove (×) to subtract it back manually OR re-edits AC.
      // This matches how Bless/Shield work at the table (DM updates AC
      // mentally; the chip is a reminder).
      if (ac) state.combatants[i] = {...c, ac: (c.ac || 0) + ac, buffs: next};
      else    state.combatants[i] = {...c, buffs: next};
      if (hp){
        state.combatants[i].hpMax = (state.combatants[i].hpMax || c.hp || 0) + hp;
        state.combatants[i].hp    = (state.combatants[i].hp    || 0)        + hp;
      }
      save(); this._render();
    });
  },

  // Append an entry to the shared combat log. Capped at 200 entries so the
  // log doesn't grow unbounded across long sessions. Persisted via the
  // normal save() path so refreshing preserves history.
  _log(text){
    if (!Array.isArray(state.combatLog)) state.combatLog = [];
    state.combatLog.push({ts: Date.now(), round: state.combatRound || 0, text: String(text)});
    if (state.combatLog.length > 200) state.combatLog = state.combatLog.slice(-200);
  },

  // Apply +/- HP to combatant `i`. Negative delta = damage; drains the PC's
  // temporary HP first (mirrored from the Party tracker) before chipping
  // into real HP. Positive delta = heal, clamped to hpMax. Mirrors to party
  // afterward so HP bars stay in sync.
  _applyHpDelta(i, delta, dmgType){
    const c = state.combatants[i]; if (!c) return;
    let remaining = delta;
    let logParts = [];
    let typeSuffix = '';
    if (delta < 0){
      // Apply 5e resist / vulnerable / immune. For PCs, we union the party
      // slot's resist/immune/vuln (DM-authored) PLUS the beast's lists when
      // wildshape is active PLUS rage's B/P/S resist for raging barbarians.
      // For monsters, we use the 5etools _raw block as before.
      const partyIdx = c.isPC ? state.party.findIndex(p => p.id === c.id) : -1;
      const partySlot = partyIdx >= 0 ? state.party[partyIdx] : null;
      const ws = (partySlot && partySlot.wildshape && partySlot.wildshape.name) ? partySlot.wildshape : null;
      if (dmgType){
        const t = dmgType.toLowerCase();
        const has = (arr) => Array.isArray(arr) && arr.some(x => {
          const s = (typeof x === 'string' ? x : (x?.resist || x?.immune || x?.vulnerable || x?.name || '')) + '';
          return s.toLowerCase().includes(t);
        });
        const ragingBPS = partySlot?.rage && (t === 'bludgeoning' || t === 'piercing' || t === 'slashing');
        if (c.isPC){
          if (has(partySlot?.immunities) || has(ws?.immunities)){
            remaining = 0;
            typeSuffix = ` (${dmgType} — immune${ws ? ' [beast]' : ''})`;
          } else if (has(partySlot?.resistances) || has(ws?.resistances) || ragingBPS){
            remaining = Math.ceil(remaining / 2);
            typeSuffix = ` (${dmgType} — ${ragingBPS ? 'rage resist' : has(ws?.resistances) ? 'beast resist' : 'resisted'}, ½)`;
          } else if (has(partySlot?.vulnerabilities) || has(ws?.vulnerabilities)){
            remaining = remaining * 2;
            typeSuffix = ` (${dmgType} — vulnerable, ×2${has(ws?.vulnerabilities) ? ' [beast]' : ''})`;
          } else {
            typeSuffix = ` (${dmgType})`;
          }
        } else {
          // Monster path — preserve the original 5etools _raw lookup.
          const raw = c._raw || (c.baseName && typeof _5eData !== 'undefined' && _5eLoaded
            ? (_5eData.find(d => d.cat==='monster' && d.name.toLowerCase() === c.baseName.toLowerCase())?._raw)
            : null);
          if (raw){
            if (has(raw.immune)){
              remaining = 0;
              typeSuffix = ` (${dmgType} — immune)`;
            } else if (has(raw.resist)){
              remaining = Math.ceil(remaining / 2);
              typeSuffix = ` (${dmgType} — resisted, ½)`;
            } else if (has(raw.vulnerable)){
              remaining = remaining * 2;
              typeSuffix = ` (${dmgType} — vulnerable, ×2)`;
            } else {
              typeSuffix = ` (${dmgType})`;
            }
          } else {
            typeSuffix = ` (${dmgType})`;
          }
        }
      } else if (partySlot?.rage){
        // Untyped damage in rage — the resist only applies to B/P/S, so we
        // can't know without a type. Leave a hint in the log.
        typeSuffix = ' (untyped — rage applies only to B/P/S)';
      }
      // Snapshot the damage that the CREATURE "took" per 5e RAW — after
      // resist/immune/vuln math but BEFORE pool absorption. Concentration
      // saves trigger on "taking damage", and that includes damage soaked
      // by temp HP or wild-shape beast HP. Using `damageDealt` (post-
      // absorption) silently swallowed every check when the beast or temp
      // HP ate all of it.
      const damageForConc = remaining < 0 ? -remaining : 0;
      // Wild Shape: damage hits the BEAST pool first. Once beast HP ≤ 0,
      // form drops and overflow continues to druid HP / temp / death-save
      // territory. Mirrors party.js _applyHpDelta beast routing.
      if (c.isPC && ws && remaining < 0){
        const wsHp = ws.hp || 0;
        if (wsHp > 0){
          const beastTook = Math.min(wsHp, -remaining);
          ws.hp = wsHp - beastTook;
          remaining += beastTook; // remaining is negative → becomes less negative
          logParts.push(beastTook + ' ' + ws.name);
          if (ws.hp <= 0){
            const beastName = ws.name;
            partySlot.wildshape = null;
            logParts.push('form drops');
            if (typeof showToast === 'function') showToast(beastName + ' form drops — ' + c.name + ' reverts');
          }
        }
      }
      // Damage path — temp HP next (PC only, after beast pool).
      if (c.isPC && remaining < 0){
        if (partySlot && (partySlot.tempHp || 0) > 0){
          const drain = Math.min(partySlot.tempHp, -remaining);
          partySlot.tempHp -= drain;
          remaining += drain; // remaining is negative → becomes less negative
          if (drain) logParts.push(drain + ' temp');
        }
      }
      const damageDealt = remaining < 0 ? -remaining : 0;
      if (remaining < 0){
        c.hp = (c.hp || 0) - damageDealt;
        logParts.push(damageDealt + ' HP');
        // PC dropped to 0 (or took damage while already at 0):
        //   • Already dead → stays dead, no death-save state changes.
        //   • Stable but downed → un-stabilize and start fresh death saves
        //     with one failure (RAW: damage to a stable creature counts
        //     as a failed death save; crit = two failures, but we don't
        //     track crits here).
        //   • Already downed with active deathSaves → leave them alone
        //     (the user is mid-roll, clicking pips manually).
        //   • Otherwise → initialize fresh {success:0, fail:0}.
        if (c.isPC && c.hp <= 0 && !c.dead){
          if (c.stable){
            c.stable = false;
            c.deathSaves = {success:0, fail:1};
          } else if (!c.deathSaves){
            c.deathSaves = {success:0, fail:0};
          }
        }
      }
      if (!logParts.length) logParts.push('0');
      this._log(c.name + ' took ' + logParts.join(' + ') + ' damage' + typeSuffix);
      // Concentration save prompt — 5e rule: when a concentrating creature
      // takes damage, they roll a Con save vs DC max(10, half the damage).
      // We just toast the reminder; rolling itself stays at the table.
      const conc = c.isPC
        ? (state.party.find(p => p.id === c.id)?.concentration || '')
        : (c.concentration || '');
      // Use damageForConc (after resist/vuln math, before absorption) so
      // the check fires even when the beast pool / temp HP ate everything.
      // damageDealt is post-absorption and would show 0 in that case.
      if (conc && damageForConc > 0){
        const dc = Math.max(10, Math.floor(damageForConc / 2));
        showToast(`🌀 ${c.name}: DC ${dc} CON save to maintain ${conc}`);
      }
    } else if (delta > 0){
      // Healing routes to the beast pool first if the PC is wildshaped —
      // matches the party tracker's heal routing. Overflow above beast cap
      // spills onto the druid.
      let remainingHeal = delta;
      let logHealParts = [];
      if (c.isPC){
        const partyIdx = state.party.findIndex(p => p.id === c.id);
        const partySlot = partyIdx >= 0 ? state.party[partyIdx] : null;
        const ws = (partySlot && partySlot.wildshape && partySlot.wildshape.name) ? partySlot.wildshape : null;
        if (ws){
          const beastCap = ws.hpMax || ws.hp || 0;
          const beastBefore = ws.hp || 0;
          ws.hp = Math.min(beastCap, beastBefore + remainingHeal);
          const beastHealed = ws.hp - beastBefore;
          remainingHeal -= beastHealed;
          if (beastHealed > 0) logHealParts.push(beastHealed + ' ' + ws.name);
        }
      }
      const before = c.hp || 0;
      const cap = c.hpMax || c.hp || 0;
      c.hp = Math.min(cap, before + remainingHeal);
      const actual = c.hp - before;
      if (actual > 0) logHealParts.push(actual + ' HP');
      // Any heal above 0 wipes downed-related state — death saves, stable
      // flag, dead flag. Even dead PCs come back if revivified, so we
      // honor the heal rather than silently swallowing it.
      if (c.isPC && c.hp > 0){
        if (c.deathSaves) delete c.deathSaves;
        if (c.stable)     delete c.stable;
        if (c.dead)       delete c.dead;
      }
      this._log(c.name + ' healed ' + (logHealParts.join(' + ') || '0') + ' HP');
    }
    save();
    // Mirror HP changes to the party tracker for PCs. syncCombatToParty()
    // itself triggers panelDefs.party._render() — don't re-render party
    // afterwards (was a double-render that lagged every HP click).
    if (c.isPC && typeof syncCombatToParty === 'function') syncCombatToParty(c.id);
    this._render();
  },

  _removeCond(i,cond){
    const c = state.combatants[i];
    state.combatants[i] = {...c, conditions:(c.conditions||[]).filter(x => x !== cond)};
    save(); this._render();
    // Party panel renders condition chips by cross-referencing combatants by
    // id, but it doesn't subscribe to combat changes — without this nudge,
    // the chip lingers on the party card until something else triggers a
    // party re-render. Same fix already exists in _toggleCondAtIdx.
    if (c && c.isPC) panelDefs.party?._render?.();
  },

  // Per-monster legendary action tracker — N pip dots that toggle as the
  // DM spends each one between turns. Pool refreshes automatically at the
  // start of every new round (5e rule). Pip clicks both spend and refund
  // — clicking a filled pip empties it, clicking an empty pip spends one.
  _renderLegendary(i, c){
    const max = c.legendaryMax || 0;
    if (!max) return '';
    const used = Math.min(c.legendaryUsed || 0, max);
    let pips = '';
    for (let n = 0; n < max; n++){
      const spent = n < used;
      pips += `<span class="legendary-pip ${spent?'spent':'available'}" data-act="legendary-pip" data-idx="${i}" data-n="${n}" title="${spent?'Refund':'Spend'} legendary action ${n+1}"></span>`;
    }
    return `<div class="legendary-row" title="Legendary actions — pool refreshes each round">
      <span class="legendary-label">⚜ Legendary</span>
      ${pips}
      <span class="legendary-count">${max-used}/${max}</span>
    </div>`;
  },

  _renderDeathSaves(i, c){
    const ds = c.deathSaves || {success:0, fail:0};
    const pip = (filled, kind, n) =>
      `<span class="ds-pip ${kind} ${filled?'on':''}" data-act="death-save" data-idx="${i}" data-kind="${kind}" data-n="${n}"></span>`;
    return `<div class="death-saves">
      <span class="ds-label">Saves</span>
      <span class="ds-row ds-success">${[1,2,3].map(n=>pip(ds.success>=n,'success',n)).join('')}</span>
      <span class="ds-row ds-fail">${[1,2,3].map(n=>pip(ds.fail>=n,'fail',n)).join('')}</span>
    </div>`;
  },

  // Show a small popout near (x,y) with the PC's saves and passive Perception.
  // Reads from the matched party member's imported abilities.
  _showPcQuickRef(combatant, x, y){
    // Remove any prior popout.
    document.querySelectorAll('.pc-quickref').forEach(el => el.remove());
    const p = state.party.find(pp => pp.id === combatant.id);
    const ab = (p && p.abilities) || null;
    const fmtMod = m => (m >= 0 ? '+' : '') + m;
    const modOf = score => score == null ? null : Math.floor((score - 10) / 2);
    const row = (label, val) => `<div class="pc-quickref-row"><span>${esc(label)}</span><span>${esc(val)}</span></div>`;
    let html = `<div class="pc-quickref-name">${esc(combatant.name)}${p && p.cls ? ' <span style="color:var(--text-dim);font-weight:400">'+esc(p.cls)+(p.level?' '+p.level:'')+'</span>' : ''}</div>`;
    html += row('AC', combatant.ac ?? p?.ac ?? '?');
    html += row('HP', `${combatant.hp ?? '?'} / ${combatant.hpMax ?? p?.hpMax ?? '?'}`);
    html += row('Speed', (p && p.spd) ? p.spd + ' ft' : '—');
    if (ab){
      html += '<div class="pc-quickref-section">Saves</div>';
      ['str','dex','con','int','wis','cha'].forEach(k => {
        const m = modOf(ab[k]);
        html += row(k.toUpperCase(), m == null ? '—' : fmtMod(m));
      });
      const wisMod = modOf(ab.wis);
      if (wisMod != null) html += row('Passive Perception', 10 + wisMod);
    } else {
      html += '<div class="pc-quickref-empty">No imported abilities. Use 📄 Import PDF on the party tracker for save bonuses and passive perception.</div>';
    }
    const div = document.createElement('div');
    div.className = 'pc-quickref';
    div.innerHTML = html;
    document.body.appendChild(div);
    // Position with viewport clamping.
    const rect = div.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    div.style.left = Math.min(x, vw - rect.width - 8) + 'px';
    div.style.top  = Math.min(y, vh - rect.height - 8) + 'px';
    // Dismiss on outside click or Escape.
    const dismiss = (ev) => {
      if (ev && ev.type === 'mousedown' && div.contains(ev.target)) return;
      div.remove();
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') dismiss(); };
    setTimeout(() => {
      document.addEventListener('mousedown', dismiss);
      document.addEventListener('keydown', onKey);
    }, 0);
  },

  _toggleCondAtIdx(i,cond){
    const c=state.combatants[i]; if(!c) return;
    const conds=c.conditions||[];
    const has=conds.includes(cond);
    const next=has?conds.filter(x=>x!==cond):[...conds,cond];
    state.combatants[i]={...c,conditions:next};
    save();this._render();
    // Mirror to the party panel so PC condition chips stay in sync without
    // waiting for the next party-panel render. Safe when party is closed —
    // the optional-chain no-ops.
    if (c.isPC) panelDefs.party?._render?.();
    showToast(has?(cond+' removed from '+c.name):(cond+' → '+c.name));
  },

  applyCondition(cond){
    if(!state.activeCombatantId){showToast('No active combatant');return false;}
    const i=state.combatants.findIndex(c=>c.id===state.activeCombatantId);if(i<0)return false;
    const conds=state.combatants[i].conditions||[];
    if(!conds.includes(cond)){
      state.combatants[i]={...state.combatants[i],conditions:[...conds,cond]};
      save();this._render();
      // Mirror to the party panel so PC condition chips appear instantly.
      if (state.combatants[i].isPC) panelDefs.party?._render?.();
    }
    showToast(`${cond} → ${state.combatants[i].name}`);return true;
  },

  // Editor for the "Conceal" health-tier labels. Each row is {threshold%, label}.
  // Threshold is the HP% floor — walked highest→lowest; first match wins.
  _manageHealthTiers(){
    if (!Array.isArray(state.settings.healthTiers) || !state.settings.healthTiers.length){
      state.settings.healthTiers = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.healthTiers));
    }
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const sortTiers = () => state.settings.healthTiers.sort((a,b) => (b.threshold||0) - (a.threshold||0));
    const renderRows = () => {
      sortTiers();
      return state.settings.healthTiers.map((t,i) => `
        <div class="ht-row">
          <input class="ht-th" type="number" min="0" max="100" data-i="${i}" data-k="threshold" value="${t.threshold}">
          <span class="ht-pct">%</span>
          <input class="ht-lb" type="text" data-i="${i}" data-k="label" value="${esc(t.label||'')}" placeholder="Label">
          <button class="btn icon-btn danger" data-rm="${i}" title="Remove tier">×</button>
        </div>`).join('');
    };
    const renderModal = () => {
      backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:380px;max-width:94vw;max-height:80vh;display:flex;flex-direction:column;padding:18px 20px">
        <h3 style="margin:0 0 6px">Health tiers</h3>
        <p style="font-size:11px;color:var(--text-muted);margin:0 0 12px">Used in <strong>Conceal</strong> mode. Each row is the HP% floor for the label — the highest matching tier is shown to players.</p>
        <div class="ht-list" style="flex:1;overflow-y:auto">${renderRows()}</div>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center;justify-content:space-between">
          <button class="btn" id="ht-add">+ Add Tier</button>
          <button class="btn" id="ht-reset" title="Restore defaults">↺ Reset</button>
        </div>
        <div class="modal-actions" style="margin-top:14px"><button class="btn primary" id="ht-done">Done</button></div>
      </div>`;
      wire();
    };
    const wire = () => {
      backdrop.querySelectorAll('input.ht-th, input.ht-lb').forEach(el => el.addEventListener('change', e => {
        const i = +e.target.dataset.i, k = e.target.dataset.k;
        const t = state.settings.healthTiers[i]; if (!t) return;
        if (k === 'threshold'){
          let n = parseInt(e.target.value); if (!Number.isFinite(n)) n = 0;
          t.threshold = Math.max(0, Math.min(100, n));
        } else {
          t.label = String(e.target.value).trim() || '?';
        }
        save();
        this._render();
        renderModal();
      }));
      backdrop.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', e => {
        const i = +e.currentTarget.dataset.rm;
        state.settings.healthTiers.splice(i,1);
        save(); this._render(); renderModal();
      }));
      backdrop.querySelector('#ht-add').addEventListener('click', () => {
        state.settings.healthTiers.push({threshold:50, label:'New Tier'});
        save(); this._render(); renderModal();
      });
      backdrop.querySelector('#ht-reset').addEventListener('click', () => {
        state.settings.healthTiers = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.healthTiers));
        save(); this._render(); renderModal();
      });
      backdrop.querySelector('#ht-done').addEventListener('click', () => backdrop.remove());
    };
    document.body.appendChild(backdrop);
    renderModal();
    backdrop.addEventListener('mousedown', e => { if (e.target===backdrop) backdrop.remove(); });
    backdrop.addEventListener('keydown',   e => { if (e.key==='Escape') backdrop.remove(); });
  },

  _manageQuickNames(){
    if (!state.settings.combatNameOptions) state.settings.combatNameOptions = ['spear','hands','rock','small'];
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const renderList = () => {
      return state.settings.combatNameOptions.map((v,i) =>
        `<div class="qn-row">
          <input class="qn-input" data-i="${i}" value="${esc(v)}">
          <button class="btn icon-btn danger" data-rm="${i}" title="Remove">×</button>
        </div>`
      ).join('') || '<div style="color:var(--text-muted);font-size:11px;padding:8px 0">No options yet — add one below.</div>';
    };
    const renderModal = () => {
      backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="min-width:320px">
        <h3>Quick-pick Name Options</h3>
        <p style="color:var(--text-muted);font-size:11px;margin:0 0 10px">Used by the dropdown next to combatant names. Edit or remove existing options, or add new ones below.</p>
        <div class="qn-list">${renderList()}</div>
        <div class="qn-add-row">
          <input class="qn-add-input" placeholder="New option (e.g. axe, bow, mage)" autocomplete="off">
          <button class="btn primary" id="qn-add-btn">+ Add</button>
        </div>
        <div class="modal-actions" style="margin-top:14px">
          <button class="btn" id="qn-reset">Reset to defaults</button>
          <button class="btn primary" id="qn-done">Done</button>
        </div>
      </div>`;
      wire();
    };
    const wire = () => {
      backdrop.querySelectorAll('input.qn-input').forEach(inp => inp.addEventListener('change', e => {
        const i = +e.target.dataset.i;
        const v = String(e.target.value).trim();
        if (!v) { state.settings.combatNameOptions.splice(i,1); }
        else    { state.settings.combatNameOptions[i] = v; }
        save();
        renderModal();
      }));
      backdrop.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        state.settings.combatNameOptions.splice(+btn.dataset.rm, 1);
        save();
        renderModal();
      }));
      const addInp = backdrop.querySelector('.qn-add-input');
      const addBtn = backdrop.querySelector('#qn-add-btn');
      const doAdd = () => {
        const v = String(addInp.value).trim();
        if (!v) return;
        if (state.settings.combatNameOptions.includes(v)) { addInp.value=''; return; }
        state.settings.combatNameOptions.push(v);
        save();
        renderModal();
        backdrop.querySelector('.qn-add-input')?.focus();
      };
      addBtn.addEventListener('click', doAdd);
      addInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
      backdrop.querySelector('#qn-reset').addEventListener('click', () => {
        state.settings.combatNameOptions = ['spear','hands','rock','small'];
        save();
        renderModal();
      });
      backdrop.querySelector('#qn-done').addEventListener('click', () => {
        backdrop.remove();
        this._render();
      });
    };
    document.body.appendChild(backdrop);
    renderModal();
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) { backdrop.remove(); this._render(); }});
    setTimeout(() => backdrop.querySelector('.qn-add-input')?.focus(), 30);
  },

  _uploadPortrait(i){
    const c = state.combatants[i]; if(!c) return;
    const inp = document.createElement('input');
    inp.type='file'; inp.accept='image/*';
    inp.addEventListener('change', async ev => {
      const f = ev.target.files[0]; if(!f) return;
      try {
        const dataUrl = await showCropModal(f, {size:96, shape:'circle', title:'Crop combatant portrait'});
        if (!dataUrl) return;
        state.combatants[i] = {...state.combatants[i], portrait: dataUrl};
        save(); this._render();
        showToast('Portrait uploaded');
      } catch(err){ showToast('Upload failed: '+err.message); }
    });
    inp.click();
  },

  // Public API used by other panels (Bestiary drag-drop, search results, etc).
  // Appends to the end of the combatant list — manual reordering is the user's
  // job now, so we don't auto-sort by initiative.
  addMonster(m){
    const initMod = m.dex ? mod(m.dex) : 0;
    const existing = state.combatants.filter(c=>c.baseName===m.name).length;
    const displayName = existing ? `${m.name} ${existing+1}` : m.name;
    if (existing === 1){
      const oi = state.combatants.findIndex(c=>c.baseName===m.name);
      if (oi >= 0) state.combatants[oi] = {...state.combatants[oi], name:`${m.name} 1`};
    }
    let portrait = null;
    if (m._img){
      // Prefer the head-shot token over the full creature art for the small
      // round portrait. Tokens live alongside the fluff at
      // img/bestiary/tokens/<source>/<name>.webp.
      const raw = m._img.startsWith('img/') ? m._img.slice(4) : m._img;
      const token = raw.replace(/^bestiary\//, 'bestiary/tokens/');
      portrait = 'img/' + token;
    }
    // Auto-detect legendary actions from the 5etools entry. 5etools data
    // exposes them at m._raw.legendary_actions (array). Default count is 3
    // per 5e baseline; if the stat block declares more in its description
    // we just stop at 3 — DM can bump via the right-click menu.
    const hasLegendary = m && m._raw && Array.isArray(m._raw.legendary_actions) && m._raw.legendary_actions.length > 0;
    const legendaryFields = hasLegendary
      ? { legendaryMax: 3, legendaryUsed: 0 }
      : {};
    state.combatants.push({
      id: uid(),
      name: displayName,
      baseName: m.name,
      isPC: false,
      cls: 'enemy',
      hp: m.hp,
      hpMax: m.hp,
      ac: m.ac,
      initBonus: initMod,
      initiative: initMod, // pre-fill with dex modifier; user can bump it before/during combat
      conditions: [],
      portrait,
      ...legendaryFields,
    });
    if (!state.combatRound) state.combatRound = 1;
    save(); this._render();
    showToast(`Added ${displayName}`);
  },
});
