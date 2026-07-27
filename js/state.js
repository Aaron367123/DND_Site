// ============================================================
// STATE & PERSISTENCE
// ============================================================
const SAVE_KEY='skt-workspace-v1';
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

function save(){try{localStorage.setItem(SAVE_KEY,JSON.stringify({party:state.party,combatants:state.combatants,combatRound:state.combatRound,activeCombatantId:state.activeCombatantId,shop:state.shop,settings:state.settings}))}catch(e){}}
function saveLayout(){try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(layout))}catch(e){}}
function load(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(raw){const d=JSON.parse(raw);if(Array.isArray(d.party))state.party=d.party;if(Array.isArray(d.combatants))state.combatants=d.combatants;if(typeof d.combatRound==='number')state.combatRound=d.combatRound;state.activeCombatantId=d.activeCombatantId??null;state.shop=d.shop??null;if(d.settings)state.settings={...state.settings,...d.settings};}
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
