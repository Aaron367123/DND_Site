// ============================================================
// STATE & PERSISTENCE
// ============================================================
// Legacy combined blob (party+combat+shop+settings in ONE key). Read once
// for migration, never written again — syncing it as a unit meant any HP
// tick shipped the whole workspace and any two same-window edits anywhere
// in it counted as a "conflict". Split keys shrink both problems.
const LEGACY_SAVE_KEY='skt-workspace-v1';
const PARTY_KEY='skt-party-v1';
const COMBAT_KEY='skt-combat-v1';
const SHOP_KEY='skt-shop-v1';
const SETTINGS_KEY='skt-settings-v1';
const LAYOUT_KEY='skt-layout-v1';
const SHARED_PANELS_KEY='skt-shared-panels-v1';
// A reaction the DM is holding open, pushed to the players who could answer
// it. Its own key so it syncs on its own — a prompt is raised and cleared
// several times a round and has no business riding along with combat state.
const PROMPT_KEY='skt-prompt-v1';

const state={
  party:JSON.parse(JSON.stringify(DEFAULT_PARTY)),
  combatants:[],
  combatRound:0,
  activeCombatantId:null,
  shop:null,
  // Deep clone (like DEFAULT_PARTY above) — a shallow spread shared the
  // nested objects (shopFilters, uiHide, healthTiers, …) with the constant,
  // so editing e.g. a shop filter corrupted the defaults themselves and
  // "Reset to Defaults" couldn't restore them.
  settings:JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  searchState:{category:'all',query:'',focused:-1,detail:null},
  // The open reaction prompt, or null. Written by the DM's Turn View,
  // answered by a player's phone. See turnview._publishPrompt.
  prompt:null,
  // Panel ids the DM has opted to share with the player view. Synced through
  // Firebase as its own key so toggling share doesn't push the whole workspace.
  sharedPanels:[],
};

let layout=JSON.parse(JSON.stringify(DEFAULT_LAYOUT));

// save() serializes all four domains — callers don't declare what changed,
// and the writes are cheap. The realtime layer skips setItem calls whose
// value is byte-identical to what's stored, so only the domain(s) that
// actually changed get marked dirty and pushed to Firebase.
function save(){
  try{
    localStorage.setItem(PARTY_KEY,JSON.stringify(state.party));
    localStorage.setItem(COMBAT_KEY,JSON.stringify({combatants:state.combatants,combatRound:state.combatRound,activeCombatantId:state.activeCombatantId}));
    localStorage.setItem(SHOP_KEY,JSON.stringify(state.shop));
    localStorage.setItem(SETTINGS_KEY,JSON.stringify(state.settings));
    localStorage.setItem(PROMPT_KEY,JSON.stringify(state.prompt||null));
  }catch(e){
    // Don't swallow: a full quota here means party/combat changes are being
    // silently discarded while the session looks fine.
    if (typeof warnStorageFailure === 'function') warnStorageFailure('party & combat', e);
  }
  // The Attack Runner is driven entirely by the combat tracker, so it has to
  // notice when that changes. Hooked HERE rather than in combat's _render for
  // two reasons: that returns early when the combat panel is closed, so adding
  // a monster from search would never reach it; and every path that changes a
  // combatant ends up in save() anyway. The panel does its own cheap
  // signature check and only redraws when something it displays moved.
  // Generalised from a hard-coded call to the Attack Runner once the Turn View
  // needed the same hook — both are driven entirely by the combat tracker, and
  // a list of two names here would have become a list of names to forget to
  // add the third to.
  if (typeof panelDefs !== 'undefined'){
    for (const id in panelDefs){
      const d = panelDefs[id];
      if (d && typeof d._syncFromCombat === 'function'){
        try { d._syncFromCombat(); } catch(e){}
      }
    }
  }
}

// Re-read ONE domain from localStorage into `state`. Used at boot (via
// load) and by realtime.js when that domain's key arrives from Firebase —
// a party update no longer re-parses combat/shop/settings.
function loadDomain(domain){
  try{
    if(domain==='party'){
      const r=localStorage.getItem(PARTY_KEY);
      if(r){const a=JSON.parse(r);if(Array.isArray(a))state.party=a;}
      migratePartySpellSlots();
    }else if(domain==='combat'){
      const r=localStorage.getItem(COMBAT_KEY);
      if(r){const d=JSON.parse(r);if(Array.isArray(d.combatants))state.combatants=d.combatants;if(typeof d.combatRound==='number')state.combatRound=d.combatRound;state.activeCombatantId=d.activeCombatantId??null;}
    }else if(domain==='shop'){
      const r=localStorage.getItem(SHOP_KEY);
      if(r)state.shop=JSON.parse(r);
    }else if(domain==='prompt'){
      const r=localStorage.getItem(PROMPT_KEY);
      state.prompt=r?JSON.parse(r):null;
    }else if(domain==='settings'){
      const r=localStorage.getItem(SETTINGS_KEY);
      if(r){const s=JSON.parse(r);if(s&&typeof s==='object')state.settings={...state.settings,...s};}
    }
  }catch(e){}
}
// ── One home for spell slots ────────────────────────────────────────────────
// They used to live in two places: a generic resource pool named "Spell Slots
// L1", and sheet.spellSlots. A character could carry both, with different
// numbers, and the party screen printed the same slot twice saying 4/4 and
// 3/4.
//
// sheet.spellSlots wins, and not by preference — it is the one with the
// behaviour. It has the clickable pip row in the Spells tab, it is what a PDF
// import fills, it carries the warlock pact-slot refresh on a short rest, and
// it is what a LONG REST restores. Slots kept as a resource pool were never
// given back by a rest at all.
//
// Where both exist the pool wins the number, because the pool is the one the
// Turn View has been spending from. Runs on every party load rather than once:
// another device still on the old build can push the old shape back at any
// time, and the pass is idempotent.
function migratePartySpellSlots(){
  const SLOT = /^Spell Slots L(\d)$/;
  (state.party || []).forEach(p => {
    if (!Array.isArray(p.resources) || !p.resources.some(r => SLOT.test(r.name || ''))) return;
    const sheet = { ...(p.sheet || {}) };
    const slots = { ...(sheet.spellSlots || {}) };
    p.resources = p.resources.filter(r => {
      const m = SLOT.exec(r.name || '');
      if (!m) return true;
      const lvl = +m[1];
      const total = Math.max(0, r.max || 0);
      slots[lvl] = { total, expended: Math.max(0, total - Math.max(0, r.current || 0)) };
      return false;
    });
    sheet.spellSlots = slots;
    p.sheet = sheet;
  });
}

function saveLayout(){
  try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(layout))}catch(e){}
  // Mirror into the active workspace. Hooking it here rather than at each
  // caller is the same reasoning as _saveMap capturing undo: there are a dozen
  // places that move, resize, open or close a window and every one of them
  // ends here, so anything else would guarantee a missed one. No-op until
  // workspaces.js has initialised, and in the player view where it never does.
  if (typeof wsCommitLayout === 'function') wsCommitLayout();
}
function load(){
  try{
    const hasSplit=[PARTY_KEY,COMBAT_KEY,SHOP_KEY,SETTINGS_KEY].some(k=>localStorage.getItem(k)!=null);
    const legacy=localStorage.getItem(LEGACY_SAVE_KEY);
    if(!hasSplit&&legacy){
      // One-time migration: split the combined blob into per-domain keys.
      // The legacy key is left in place (read-only) as a rollback snapshot;
      // it's no longer written or synced.
      const d=JSON.parse(legacy);
      if(Array.isArray(d.party))state.party=d.party;
      if(Array.isArray(d.combatants))state.combatants=d.combatants;
      if(typeof d.combatRound==='number')state.combatRound=d.combatRound;
      state.activeCombatantId=d.activeCombatantId??null;
      state.shop=d.shop??null;
      if(d.settings)state.settings={...state.settings,...d.settings};
      save(); // seed the split keys (and, via the sync layer, Firebase)
    }else{
      loadDomain('party');loadDomain('combat');loadDomain('shop');loadDomain('settings');loadDomain('prompt');
    }
    const lr=localStorage.getItem(LAYOUT_KEY);
    if(lr)layout={...layout,...JSON.parse(lr)};
    const sr=localStorage.getItem(SHARED_PANELS_KEY);
    if(sr){const arr=JSON.parse(sr);if(Array.isArray(arr))state.sharedPanels=arr;}
  }catch(e){}
}
function saveSharedPanels(){try{localStorage.setItem(SHARED_PANELS_KEY,JSON.stringify(state.sharedPanels||[]))}catch(e){}}
function togglePanelShare(id){
  if(!state.sharedPanels)state.sharedPanels=[];
  const i=state.sharedPanels.indexOf(id);
  if(i>=0)state.sharedPanels.splice(i,1);
  else state.sharedPanels.push(id);
  saveSharedPanels();
}
