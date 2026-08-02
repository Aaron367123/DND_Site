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
  }catch(e){
    // Don't swallow: a full quota here means party/combat changes are being
    // silently discarded while the session looks fine.
    if (typeof warnStorageFailure === 'function') warnStorageFailure('party & combat', e);
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
    }else if(domain==='combat'){
      const r=localStorage.getItem(COMBAT_KEY);
      if(r){const d=JSON.parse(r);if(Array.isArray(d.combatants))state.combatants=d.combatants;if(typeof d.combatRound==='number')state.combatRound=d.combatRound;state.activeCombatantId=d.activeCombatantId??null;}
    }else if(domain==='shop'){
      const r=localStorage.getItem(SHOP_KEY);
      if(r)state.shop=JSON.parse(r);
    }else if(domain==='settings'){
      const r=localStorage.getItem(SETTINGS_KEY);
      if(r){const s=JSON.parse(r);if(s&&typeof s==='object')state.settings={...state.settings,...s};}
    }
  }catch(e){}
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
      loadDomain('party');loadDomain('combat');loadDomain('shop');loadDomain('settings');
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
