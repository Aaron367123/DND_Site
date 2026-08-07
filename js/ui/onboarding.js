// ============================================================
// ONBOARDING — demo scenario + in-app changelog
// ============================================================
// Two related "first-impression" features:
//   1. Try-a-combat-scenario button that loads a curated mini-encounter
//      with full undo (snapshot + restore on exit).
//   2. In-app changelog that auto-opens once per version bump and is
//      also reachable manually from Settings → Help & about.

// ─── Demo combat scenario ────────────────────────────────────────────────────
const DEMO_SNAPSHOT_KEY = 'skt-demo-snapshot-v1';

// Demo party + opponents — small enough to fit on screen at once, varied
// enough to show off conditions, death saves, monster portraits, and the
// damage/heal widget without feeling like a sample dataset dump.
const DEMO_PARTY = [
  {
    id:'demo-pc-1', name:'Lyra Stoneheart', cls:'cleric', icon:'⚔',
    hp:24, hpMax:32, ac:18, init:1, spd:30, pp:15,
    inspiration:true, resources:[],
    abilities:{str:14,dex:10,con:14,int:10,wis:16,cha:12},
  },
  {
    id:'demo-pc-2', name:'Briar Quickfoot', cls:'rogue', icon:'🗡',
    hp:11, hpMax:26, ac:15, init:4, spd:30, pp:14,
    inspiration:false, resources:[],
    abilities:{str:10,dex:18,con:12,int:13,wis:12,cha:10},
  },
];
const DEMO_COMBATANTS = [
  // PCs first (already in party slots above)
  {id:'demo-pc-1', name:'Lyra Stoneheart', isPC:true, cls:'cleric', hp:24, hpMax:32, ac:18, initBonus:1, initiative:14, conditions:[]},
  {id:'demo-pc-2', name:'Briar Quickfoot', isPC:true, cls:'rogue',   hp:11, hpMax:26, ac:15, initBonus:4, initiative:17, conditions:['Poisoned']},
  // Monsters
  {id:'demo-mon-1', name:'Goblin 1',   baseName:'Goblin', isPC:false, cls:'enemy', hp:7,  hpMax:7,  ac:15, initBonus:2, initiative:13, conditions:[]},
  {id:'demo-mon-2', name:'Goblin 2',   baseName:'Goblin', isPC:false, cls:'enemy', hp:4,  hpMax:7,  ac:15, initBonus:2, initiative:9,  conditions:['Frightened']},
  {id:'demo-mon-3', name:'Bugbear',    baseName:'Bugbear',isPC:false, cls:'enemy', hp:27, hpMax:27, ac:16, initBonus:2, initiative:11, conditions:[]},
];

function _onbDemoActive(){
  try { return !!localStorage.getItem(DEMO_SNAPSHOT_KEY); } catch(e){ return false; }
}

function runDemoScenario(){
  if (_onbDemoActive()){
    if (typeof showToast === 'function') showToast('Demo already active — click Exit demo to restore your data');
    return;
  }
  // Snapshot the current state we're about to overwrite. Layout snapshot
  // too so opened panels return to their prior arrangement on exit.
  const snap = {
    party: state.party,
    combatants: state.combatants,
    combatRound: state.combatRound,
    activeCombatantId: state.activeCombatantId,
    // Capture which panels were open + their layout so exit can restore.
    openPanels: Object.keys(layout || {}).filter(id => layout[id]?.open),
  };
  try { localStorage.setItem(DEMO_SNAPSHOT_KEY, JSON.stringify(snap)); } catch(e){
    if (typeof showToast === 'function') showToast('Couldn\'t start demo — localStorage full');
    return;
  }
  // Swap in the demo data.
  state.party = JSON.parse(JSON.stringify(DEMO_PARTY));
  state.combatants = JSON.parse(JSON.stringify(DEMO_COMBATANTS));
  state.combatRound = 1;
  state.activeCombatantId = state.combatants[0]?.id || null;
  if (typeof save === 'function') save();
  // Open the panels that show off the demo.
  if (typeof openPanel === 'function'){
    if (!layout.combat?.open) openPanel('combat');
    if (!layout.party?.open)  openPanel('party');
  }
  if (typeof panelDefs !== 'undefined'){
    panelDefs.combat?._render?.();
    panelDefs.party?._render?.();
  }
  _onbRenderDemoBanner();
  if (typeof showToast === 'function') showToast('Demo loaded — try the damage widget, conditions, death saves');
}

function exitDemoScenario(){
  let snap;
  try { snap = JSON.parse(localStorage.getItem(DEMO_SNAPSHOT_KEY) || 'null'); }
  catch(e){ snap = null; }
  if (!snap){
    _onbRenderDemoBanner(); // hide if shown
    return;
  }
  if (Array.isArray(snap.party))      state.party = snap.party;
  if (Array.isArray(snap.combatants)) state.combatants = snap.combatants;
  if (typeof snap.combatRound === 'number') state.combatRound = snap.combatRound;
  state.activeCombatantId = snap.activeCombatantId ?? null;
  try { localStorage.removeItem(DEMO_SNAPSHOT_KEY); } catch(e){}
  if (typeof save === 'function') save();
  if (typeof panelDefs !== 'undefined'){
    panelDefs.combat?._render?.();
    panelDefs.party?._render?.();
  }
  _onbRenderDemoBanner();
  if (typeof showToast === 'function') showToast('Demo exited — your data is back');
}

// Floating banner pinned to the top-center while a demo is active. Click
// the chip to exit. Re-rendered idempotently — calling multiple times
// just shows the same banner once.
function _onbRenderDemoBanner(){
  const existing = document.getElementById('onb-demo-banner');
  if (!_onbDemoActive()){
    if (existing) existing.remove();
    return;
  }
  if (existing) return;
  const banner = document.createElement('div');
  banner.id = 'onb-demo-banner';
  banner.innerHTML = `<span>🎲 Demo combat active — your campaign data is saved.</span>
    <button class="btn small" id="onb-demo-exit">Exit demo</button>`;
  document.body.appendChild(banner);
  banner.querySelector('#onb-demo-exit').addEventListener('click', exitDemoScenario);
}

// Restore the banner on every page load if a demo is still active (e.g.
// the user reloaded mid-demo). Fires after load() runs in app.js.
function initOnboarding(){
  _onbRenderDemoBanner();
  _onbMaybeShowChangelog();
}

window.runDemoScenario  = runDemoScenario;
window.exitDemoScenario = exitDemoScenario;
window.initOnboarding   = initOnboarding;

// ─── In-app changelog ───────────────────────────────────────────────────────
// Newest entries first. Each entry: {version, date, title?, items}.
// `version` is a free-form string; auto-show gate compares strings.
// Bump the top entry whenever something shippable lands.
const CHANGELOG_ENTRIES = [
  {
    version: '2026-05-18',
    date: '2026-05-18',
    title: 'Big polish pass',
    items: [
      'Battle Map: save & name multiple maps; star adventure maps; token rotation handle; custom uploads render correctly.',
      'Combat Tracker: hover-only ±damage / heal widget with temp-HP drain; collapsible round log; legendary action tracker.',
      'Party Tracker: inline d20 roller from Stats + Skills tab (Shift = adv, Alt = dis); temp-HP pool; condition chips synced from Combat.',
      'Loot Tracker: weight / encumbrance toggle with per-member capacity; mark-paid workflow; rarity chip on search.',
      'NPC Library: bulk-select multi-row ops; export NPC as themed PNG.',
      'Adventures + Books: print/export with chapter picker → printable HTML.',
      'Soundboard: ambient flag + auto-volume ducking; named scenes.',
      'Time Tracker: minute / second precision; fast-forward to sunrise/sunset.',
      'Weather: history timeline with restore-from-history; auto-tick when in-game date advances.',
      'Settings: dark-mode-auto (follow OS); storage-usage meter; "Sync now" button.',
      'Search: Damerau-Levenshtein fuzzy fallback (catches typos like fyer → fire); recent searches; match-highlight.',
      'Notes: drag-reorder files in the tree; [[wiki]] backlinks; sync-conflict resolver with side-by-side merge.',
      'Bestiary: folder templates (Role / Type / Tier) for quick setup.',
      'Tutorial: live UI spotlight — the actual element being described gets highlighted.',
      'Windows: per-focus zoom restore; pinch-zoom on touch; smart-arrange auto-tile (Ctrl+Shift+A).',
    ],
  },
  {
    version: '2026-05-09',
    date: '2026-05-09',
    title: 'Adventures + Books panels',
    items: [
      'Adventures panel reads 5etools adventure JSON with rich inline rendering.',
      'Books panel: same renderer pointed at the 5etools books (PHB, DMG, MM, supplements).',
      'Per-adventure bookmarks; resume badge on the index card.',
    ],
  },
];

const CHANGELOG_SEEN_KEY = 'skt-changelog-seen-version';

function _onbLatestVersion(){
  return (CHANGELOG_ENTRIES[0] || {}).version || '';
}

function _onbMaybeShowChangelog(){
  const latest = _onbLatestVersion();
  if (!latest) return;
  let seen = '';
  try { seen = localStorage.getItem(CHANGELOG_SEEN_KEY) || ''; } catch(e){}
  if (seen === latest) return;
  // First-time visitors (no prior seen value) shouldn't get the changelog
  // up front — they're already getting the tutorial. Only auto-show when
  // the user has seen *some* previous version. The Settings → Help & about
  // button always works for the first-run case.
  if (!seen) {
    try { localStorage.setItem(CHANGELOG_SEEN_KEY, latest); } catch(e){}
    return;
  }
  openChangelog(/*auto*/true);
}

function openChangelog(isAuto){
  // Dismiss any previously-open changelog modal (idempotent).
  document.getElementById('onb-changelog-backdrop')?.remove();
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.id = 'onb-changelog-backdrop';
  const latest = _onbLatestVersion();
  const sectionsHtml = CHANGELOG_ENTRIES.map((e, i) => {
    const isLatest = i === 0;
    const items = (e.items || []).map(it => '<li>' + esc(it) + '</li>').join('');
    return `<section class="changelog-section${isLatest?' latest':''}">
      <div class="changelog-head">
        <span class="changelog-version">${esc(e.version)}</span>
        ${isLatest ? '<span class="changelog-latest">latest</span>' : ''}
        ${e.title ? `<span class="changelog-title">${esc(e.title)}</span>` : ''}
      </div>
      <ul class="changelog-items">${items}</ul>
    </section>`;
  }).join('');
  back.innerHTML = `<div class="modal changelog-modal" role="dialog" aria-modal="true" style="width:640px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column">
    <h3 style="margin:0 0 4px">📜 What's new</h3>
    <p style="margin:0 0 12px;font-size:var(--fs-sm);color:var(--text-muted)">Recent updates to the workspace. ${isAuto ? 'This popped up because the version bumped since you last visited.' : ''}</p>
    <div style="flex:1;overflow-y:auto;padding-right:4px">${sectionsHtml}</div>
    <div class="modal-actions" style="margin-top:12px">
      <span style="font-size:var(--fs-sm);color:var(--text-dim);align-self:center">v ${esc(latest)}</span>
      <span style="flex:1"></span>
      <button class="btn primary" id="onb-changelog-close">Got it</button>
    </div>
  </div>`;
  document.body.appendChild(back);
  const close = () => {
    try { localStorage.setItem(CHANGELOG_SEEN_KEY, latest); } catch(e){}
    back.remove();
  };
  back.querySelector('#onb-changelog-close').addEventListener('click', close);
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

window.openChangelog = openChangelog;

// ────────────────────────────────────────────────────────────────────────────
// About modal — app version, credits, data-storage summary, links. Mirrors
// the changelog modal's visual language so the two feel like a set.
// ────────────────────────────────────────────────────────────────────────────
function _onbBytesUsed(){
  // Sum the byte length of every localStorage value for this origin. Matches
  // the calculation used by the storage-usage meter in settings.js.
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      total += k.length + v.length;
    }
  } catch(e){}
  return total;
}
function _onbFormatBytes(n){
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/1024/1024).toFixed(2) + ' MB';
}
function openAbout(){
  document.getElementById('onb-about-backdrop')?.remove();
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.id = 'onb-about-backdrop';
  const version = _onbLatestVersion();
  const bytes = _onbBytesUsed();
  // Rough quota — most browsers cap localStorage around 5 MB per origin.
  const quotaMB = 5;
  const pct = Math.min(100, (bytes / (quotaMB*1024*1024)) * 100);
  // Panel-count heuristic: rough open windows count.
  let windowCount = 0;
  try { windowCount = document.querySelectorAll('.window').length; } catch(e){}
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:520px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column">
    <h3 style="margin:0 0 4px;display:flex;align-items:center;gap:8px"><span style="font-size:var(--fs-3xl)">⚔</span> SKT Campaign Workspace</h3>
    <p style="margin:0 0 14px;font-size:var(--fs-sm);color:var(--text-muted)">A single-page workspace for running 5e games. Vanilla JS, no framework.</p>
    <div style="flex:1;overflow-y:auto;padding-right:4px">
      <h4 style="margin:0 0 6px;font-size:var(--fs-md);color:var(--accent)">Version</h4>
      <p style="margin:0 0 14px;font-size:var(--fs-md)">v ${esc(version || '—')} · <a href="javascript:void(0)" id="about-open-changelog" style="color:var(--accent)">View full changelog →</a></p>

      <h4 style="margin:0 0 6px;font-size:var(--fs-md);color:var(--accent)">Data storage</h4>
      <p style="margin:0 0 4px;font-size:var(--fs-md)">${esc(_onbFormatBytes(bytes))} used of ~${quotaMB} MB localStorage quota · ${windowCount} open window${windowCount===1?'':'s'}</p>
      <div style="background:var(--panel-2);height:6px;border-radius:3px;overflow:hidden;margin-bottom:14px">
        <div style="width:${pct.toFixed(1)}%;height:100%;background:var(--accent);transition:width .2s"></div>
      </div>
      <p style="margin:0 0 14px;font-size:var(--fs-sm);color:var(--text-muted)">Everything auto-saves to this browser. Use Export / Import (above) to back up or move devices. Optional Firebase + Dropbox sync are configured in <code>SETUP.md</code>.</p>

      <h4 style="margin:0 0 6px;font-size:var(--fs-md);color:var(--accent)">Credits</h4>
      <p style="margin:0 0 6px;font-size:var(--fs-md)">Stat blocks, spells, items, and adventure content are sourced from <a href="https://5e.tools/" target="_blank" rel="noopener" style="color:var(--accent)">5etools</a> (CC-licensed game-mechanics data). Module licenses live alongside the source.</p>
      <p style="margin:0 0 14px;font-size:var(--fs-sm);color:var(--text-muted)">Built for a long-running Storm King's Thunder campaign — hence the name.</p>

      <h4 style="margin:0 0 6px;font-size:var(--fs-md);color:var(--accent)">Quick actions</h4>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <button class="btn small" id="about-open-tutorial">📖 Reopen tutorial</button>
        <button class="btn small" id="about-reset-onboarding">↺ Reset onboarding flag</button>
      </div>
      <p style="margin:0;font-size:var(--fs-sm);color:var(--text-dim)">"Reset onboarding flag" makes the tutorial auto-pop on next reload (handy when showing a friend).</p>
    </div>
    <div class="modal-actions" style="margin-top:12px">
      <span style="flex:1"></span>
      <button class="btn primary" id="onb-about-close">Close</button>
    </div>
  </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('#onb-about-close').addEventListener('click', close);
  back.querySelector('#about-open-changelog')?.addEventListener('click', () => { close(); openChangelog(false); });
  back.querySelector('#about-open-tutorial')?.addEventListener('click', () => {
    close();
    if (typeof openTutorial === 'function') openTutorial(0);
  });
  back.querySelector('#about-reset-onboarding')?.addEventListener('click', () => {
    try {
      localStorage.removeItem('skt-tutorial-seen-v2');
      localStorage.removeItem('skt-changelog-seen-version');
    } catch(e){}
    if (typeof showToast === 'function') showToast('Onboarding flags cleared — reload to re-trigger.');
  });
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
window.openAbout = openAbout;
