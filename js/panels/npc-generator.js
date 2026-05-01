// ============================================================
// NPC GENERATOR PANEL
// ============================================================
const NPC_GEN_DATA = {
  races:['Human','Elf','Half-Elf','Dwarf','Halfling','Gnome','Tiefling','Dragonborn','Half-Orc','Goliath','Tabaxi','Firbolg','Aasimar'],
  genders:['Male','Female','Non-binary'],
  roles:['Merchant','Guard','Noble','Peasant','Innkeeper','Blacksmith','Scholar','Priest','Thief','Sailor','Farmer','Herbalist','Spy','Mercenary','Street Urchin','Soldier','Fisherman','Cook','Cartographer','Bounty Hunter'],
  attitudes:['Friendly','Neutral','Suspicious','Hostile','Fearful','Eager','Gruff','Melancholy','Jovial','Secretive'],
  quirks:[
    'Constantly fidgets with a ring','Speaks in a low whisper','Never makes eye contact','Laughs at inappropriate moments',
    'Refers to themselves in third person','Has a nervous tick','Always eating something','Excessively formal',
    'Hums under their breath','Collects strange trinkets','Smells of pipe smoke','Has a distinctive scar',
    'Tells long-winded stories','Repeats the last word they hear','Chews on a toothpick','Avoids using names',
    'Touches their face when lying','Has a pet mouse','Speaks too loudly','Always looks over their shoulder',
  ],
  motivations:['Greed','Love','Revenge','Survival','Duty','Curiosity','Fear','Ambition','Loyalty','Redemption','Power','Freedom','Family','Faith','Honor'],
  secrets:[
    'Owes a debt to a dangerous faction','Is not who they claim to be','Witnessed something they shouldnt have',
    'Has a family member in trouble','Was once involved in a crime','Is being blackmailed','Knows the location of something valuable',
    'Secretly sympathizes with the enemy','Has a hidden illness','Is working as an informant',
  ],
  names:{
    Human:['Aldric','Mira','Gareth','Seraphine','Tobias','Elara','Dorian','Vesna','Caspian','Lyra'],
    Elf:['Aelindra','Faelwen','Caladrel','Miriel','Thalindor','Sylvara','Elarion','Nimue','Daeron','Ithilwen'],
    Dwarf:['Throdin','Brunhilda','Kazrak','Helga','Dolgrin','Marta','Brokk','Sigrun','Rangrim','Vera'],
    Halfling:['Pip','Rosie','Merric','Calla','Tobold','Bree','Hob','Daisy','Willo','Peony'],
    default:['Zara','Krix','Veln','Sora','Dax','Mira','Odo','Lyss','Finn','Cael'],
  },
  epithets:['the Bold','the Silent','One-Eye','the Quick','the Elder','the Gray','the Red','the Tall','Ironhands','Goldtongue','the Pious','the Drunk'],
};

function rnd(arr){return arr[Math.floor(Math.random()*arr.length)];}
function genNPC(overrides){
  const race=overrides.race||rnd(NPC_GEN_DATA.races);
  const gender=overrides.gender||rnd(NPC_GEN_DATA.genders);
  const role=overrides.role||rnd(NPC_GEN_DATA.roles);
  const namePool=NPC_GEN_DATA.names[race]||NPC_GEN_DATA.names.default;
  const name=rnd(namePool)+(Math.random()<0.25?' '+rnd(NPC_GEN_DATA.epithets):'');
  const age=20+Math.floor(Math.random()*60);
  return {
    name, race, gender, role, age,
    attitude:overrides.attitude||rnd(NPC_GEN_DATA.attitudes),
    quirk:rnd(NPC_GEN_DATA.quirks),
    quirk2:rnd(NPC_GEN_DATA.quirks),
    motivation:rnd(NPC_GEN_DATA.motivations),
    secret:rnd(NPC_GEN_DATA.secrets),
    hp:4+Math.floor(Math.random()*12),
    ac:10+Math.floor(Math.random()*4),
  };
}

registerPanel('npcgen',{
  title:'NPC Generator',icon:'🎲',
  _npc:null, _filters:{race:'',gender:'',role:'',attitude:''},
  mount(body){this._body=body;if(!this._npc)this._npc=genNPC({});this._render();},
  unmount(){this._body=null;},

  _render(){
    const b=this._body;if(!b)return;
    const n=this._npc||genNPC({});

    const sel=(label,key,opts)=>{
      const cur=this._filters[key]||'';
      return '<div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:100px">'
        +'<label style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">'+label+'</label>'
        +'<select data-fkey="'+key+'" style="font-size:11px;padding:3px 5px">'
        +'<option value="">Any</option>'
        +opts.map(o=>'<option value="'+o+'" '+(cur===o?'selected':'')+'>'+o+'</option>').join('')
        +'</select></div>';
    };

    b.style.cssText='display:flex;flex-direction:column;height:100%;overflow:hidden';
    let html='';

    // Filter bar
    html+='<div style="display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid var(--border);background:var(--panel-2);flex-wrap:wrap">'
      +sel('Race','race',NPC_GEN_DATA.races)
      +sel('Gender','gender',NPC_GEN_DATA.genders)
      +sel('Role','role',NPC_GEN_DATA.roles)
      +sel('Attitude','attitude',NPC_GEN_DATA.attitudes)
    +'</div>';

    html+='<div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;gap:8px">'
      +'<button class="btn primary" id="npcgen-roll" style="flex:1">🎲 Generate NPC</button>'
      +'<button class="btn" id="npcgen-save" style="flex-shrink:0" title="Save to NPC Library">💾 Save to Library</button>'
      +'<button class="btn" id="npcgen-combat" style="flex-shrink:0" title="Add to combat">⚔ Combat</button>'
    +'</div>';

    if(n){
      html+='<div style="flex:1;overflow-y:auto;padding:12px">';

      // Name & identity
      html+='<div style="margin-bottom:12px">'
        +'<div style="font-size:18px;font-weight:700;color:var(--accent);margin-bottom:2px">'+esc(n.name)+'</div>'
        +'<div style="font-size:12px;color:var(--text-muted)">'+esc(n.gender)+' '+esc(n.race)+', '+n.age+' years old · '+esc(n.role)+'</div>'
      +'</div>';

      // Stats
      html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px">'
        +'<div style="background:var(--panel-2);padding:6px 8px;border-radius:4px;text-align:center"><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase">Attitude</div><div style="font-size:12px;font-weight:600">'+esc(n.attitude)+'</div></div>'
        +'<div style="background:var(--panel-2);padding:6px 8px;border-radius:4px;text-align:center"><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase">HP</div><div style="font-size:14px;font-weight:700">'+n.hp+'</div></div>'
        +'<div style="background:var(--panel-2);padding:6px 8px;border-radius:4px;text-align:center"><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase">AC</div><div style="font-size:14px;font-weight:700">'+n.ac+'</div></div>'
      +'</div>';

      const field=(label,val,col)=>'<div style="margin-bottom:8px">'
        +'<div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:'+(col||'var(--text-muted)')+';margin-bottom:3px">'+label+'</div>'
        +'<div style="font-size:12px;line-height:1.5;color:var(--text);background:var(--panel-2);padding:6px 8px;border-radius:4px;border-left:2px solid '+(col||'var(--border)')+'">'+esc(val)+'</div>'
      +'</div>';

      html+=field('Quirk',n.quirk,'var(--info)');
      html+=field('Also',n.quirk2,'var(--info)');
      html+=field('Motivation',n.motivation,'var(--warning)');
      html+=field('🔒 Secret',n.secret,'var(--danger)');

      html+='</div>';
    }

    b.innerHTML=html;

    // Filter selects
    b.querySelectorAll('[data-fkey]').forEach(sel2=>sel2.addEventListener('change',e=>{
      this._filters[e.target.dataset.fkey]=e.target.value;
    }));

    b.querySelector('#npcgen-roll').addEventListener('click',()=>{
      this._npc=genNPC(this._filters);this._render();
    });

    b.querySelector('#npcgen-save').addEventListener('click',()=>{
      if(!n)return;
      const lib=panelDefs.npclib;
      if(lib){
        const entry={id:uid(),name:n.name,role:n.role+' · '+n.race,hp:n.hp,ac:n.ac,cr:'',attitude:n.attitude,tags:[n.race,n.role],notes:'Age: '+n.age,quirks:n.quirk+'. '+n.quirk2,secret:n.secret};
        if(!lib._npcs)lib._npcs=[];
        lib._npcs.unshift(entry);
        try{localStorage.setItem('skt-npcs-v1',JSON.stringify(lib._npcs));}catch(e){}
        lib._expanded=entry.id;
        if(lib._body)lib._render();
        showToast(n.name+' saved to NPC Library');
      } else showToast('Open NPC Library first');
    });

    b.querySelector('#npcgen-combat').addEventListener('click',()=>{
      if(!n)return;
      panelDefs.combat.addMonster({name:n.name,hp:n.hp,hpMax:n.hp,ac:n.ac,dex:10});
    });
  },
});
