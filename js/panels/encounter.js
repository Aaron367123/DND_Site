// ============================================================
// ENCOUNTER BUILDER PANEL
// ============================================================
// XP thresholds by character level [easy, medium, hard, deadly]
const XP_THRESH=[[0,25,50,75,100],[200,450,600,800],[400,700,1100,1600],[500,900,1400,2100],[700,1100,1800,2700],[1000,1400,2300,3400],[1300,1700,2900,4300],[1400,2100,3900,5900],[1600,2400,4700,7200],[2000,2800,5700,8800],[2200,3200,6400,9600],[2500,3600,7300,10900],[2800,4000,8200,12300],[3200,4400,9100,13700],[3500,4800,10000,15000],[3800,5200,10900,15000],[4000,5600,11800,15000],[4300,6000,12700,15000],[4700,6400,13600,15000],[5000,6800,14400,15000]];
const CR_XP={'0':10,'1/8':25,'1/4':50,'1/2':100,'1':200,'2':450,'3':700,'4':1100,'5':1800,'6':2300,'7':2900,'8':3900,'9':5000,'10':5900,'11':7200,'12':8400,'13':10000,'14':11500,'15':13000,'16':15000,'17':18000,'18':20000,'19':22000,'20':25000,'21':33000,'22':41000,'23':50000,'24':62000};
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
  mount(body){
    this._body=body;
    try{const r=localStorage.getItem('skt-enc-v1');if(r){const d=JSON.parse(r);this._monsters=d.monsters||[];this._partyLevel=d.partyLevel||6;this._partySize=d.partySize||state.party.length||5;}}catch(e){}
    this._partySize=state.party.length||this._partySize;
    this._render();
  },
  unmount(){this._body=null;},
  _save(){try{localStorage.setItem('skt-enc-v1',JSON.stringify({monsters:this._monsters,partyLevel:this._partyLevel,partySize:this._partySize}));}catch(e){}},
  _calcXP(){
    const total=this._monsters.reduce((sum,m)=>{const xp=CR_XP[m.cr]||0;return sum+(xp*(m.count||1));},0);
    const count=this._monsters.reduce((s,m)=>s+(m.count||1),0);
    // Multiplier table
    const mults=[1,1.5,2,2,2,3,3,3,4,4,4,4,5];const mi=Math.min(count,12);const mult=mults[mi]||5;
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
  _render(){
    const b=this._body;if(!b)return;
    const xp=this._calcXP();const diff=this._difficulty(xp.adjusted);
    const searchResults=this._searchQ?MONSTER_LIST.filter(m=>m.name.toLowerCase().includes(this._searchQ.toLowerCase())).slice(0,12):[];
    b.innerHTML=`<div class="enc-panel">
      <div class="enc-left">
        <div class="enc-section">
          <h3>Party</h3>
          <div class="enc-party-adj">
            <label>Level</label>
            <input type="number" id="enc-level" value="${this._partyLevel}" min="1" max="20" style="font-size:11px;margin-bottom:6px">
            <label>Size</label>
            <input type="number" id="enc-size" value="${this._partySize}" min="1" max="10" style="font-size:11px">
          </div>
        </div>
        <div class="enc-section" style="flex:1;overflow-y:auto">
          <h3>Monsters</h3>
          <div class="enc-monsters-list" id="enc-monster-list">
            ${!this._monsters.length?'<div style="font-size:11px;color:var(--text-dim)">Search and add monsters below.</div>':
              this._monsters.map((m,i)=>`<div class="enc-monster-row">
                <input type="number" value="${m.count||1}" min="1" max="99" data-ei="${i}" style="width:38px;font-size:11px;padding:2px 4px">
                <span class="enc-name" title="${esc(m.name)}">${esc(m.name)}</span>
                <span class="enc-cr">CR ${m.cr}</span>
                <button class="btn icon-btn danger" data-eact="del" data-ei="${i}" style="padding:2px 5px;font-size:11px">×</button>
              </div>`).join('')}
          </div>
          <div class="enc-add-input">
            <input type="text" id="enc-search" placeholder="Search monster..." style="font-size:11px">
          </div>
          <div class="enc-search-results ${this._searchOpen&&searchResults.length?'open':''}" id="enc-search-results">
            ${searchResults.map(m=>`<div class="enc-search-result" data-mname="${esc(m.name)}" data-mcr="${esc(m.cr)}" data-mhp="${m.hp}" data-mac="${m.ac}">
              <span>${esc(m.name)}</span><span class="enc-cr-badge">CR ${m.cr} · ${CR_XP[m.cr]||'?'} XP</span>
            </div>`).join('')}
          </div>
        </div>
      </div>
      <div class="enc-right">
        <div class="enc-stats">
          <h3 style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:0 0 10px">XP Budget</h3>
          <div class="enc-stat-grid">
            <div class="enc-stat-box"><div class="l">Raw XP</div><div class="v">${xp.raw.toLocaleString()}</div></div>
            <div class="enc-stat-box"><div class="l">Adjusted XP (×${xp.mult})</div><div class="v">${xp.adjusted.toLocaleString()}</div></div>
            <div class="enc-stat-box"><div class="l">Difficulty</div><div class="v ${diff.cls}">${diff.label}</div></div>
            <div class="enc-stat-box"><div class="l">Monster Count</div><div class="v">${xp.count}</div></div>
          </div>
          <h3 style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:10px 0 8px">Thresholds (full party)</h3>
          ${(()=>{const l=Math.min(Math.max(this._partyLevel,1),20)-1;const t=XP_THRESH[l]||XP_THRESH[0];return`<div class="enc-stat-grid">${['Easy','Medium','Hard','Deadly'].map((lab,i)=>`<div class="enc-stat-box"><div class="l">${lab}</div><div class="v" style="font-size:12px">${(t[i]*this._partySize).toLocaleString()} XP</div></div>`).join('')}</div>`;})()}
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn small primary" id="enc-push-combat">▶ Push to Combat Tracker</button>
            <button class="btn small danger" id="enc-clear">Clear encounter</button>
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
    // Search
    const searchInp=b.querySelector('#enc-search');
    searchInp.value=this._searchQ;
    searchInp.addEventListener('input',e=>{this._searchQ=e.target.value;this._searchOpen=true;this._render();});
    searchInp.addEventListener('focus',()=>{this._searchOpen=true;this._render();});
    b.querySelectorAll('.enc-search-result').forEach(el=>el.addEventListener('click',()=>{
      const name=el.dataset.mname,cr=el.dataset.mcr,hp=+el.dataset.mhp,ac=+el.dataset.mac;
      const existing=this._monsters.find(m=>m.name===name);
      if(existing)existing.count=(existing.count||1)+1;
      else this._monsters.push({name,cr,hp,ac,count:1});
      this._searchQ='';this._searchOpen=false;this._save();this._render();
    }));
    // Push to combat
    b.querySelector('#enc-push-combat').addEventListener('click',()=>{
      let pushed=0;
      this._monsters.forEach(m=>{for(let i=0;i<(m.count||1);i++){panelDefs.combat.addMonster({name:m.name,hp:m.hp,hpMax:m.hp,ac:m.ac,dex:10});pushed++;}});
      showToast(`${pushed} combatant(s) added`);
      if(!layout.combat?.open)openPanel('combat');
    });
    b.querySelector('#enc-clear').addEventListener('click',()=>{if(!confirm('Clear encounter?'))return;this._monsters=[];this._save();this._render();});
  },
});
