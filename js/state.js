// ============================================================
// STATE & PERSISTENCE
// ============================================================
const SAVE_KEY='skt-workspace-v1';
const LAYOUT_KEY='skt-layout-v1';

const state={
  party:JSON.parse(JSON.stringify(DEFAULT_PARTY)),
  combatants:[],
  combatRound:0,
  activeCombatantId:null,
  shop:null,
  settings:{...DEFAULT_SETTINGS},
  searchState:{category:'all',query:'',focused:-1,detail:null},
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
  }catch(e){}
}
