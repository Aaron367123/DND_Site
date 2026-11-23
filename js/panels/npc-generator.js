// ============================================================
// NPC GENERATOR — the 🎲 pane of the NPC Library
// ============================================================
// No window of its own: npc-library.js mounts it in its right-hand pane, and
// SKT_PANEL_HOST (data.js) sends openPanel('npcgen') there.
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
    'Owes a debt to a dangerous faction','Is not who they claim to be','Witnessed something they shouldn’t have',
    'Has a family member in trouble','Was once involved in a crime','Is being blackmailed','Knows the location of something valuable',
    'Secretly sympathizes with the enemy','Has a hidden illness','Is working as an informant',
  ],
  // Names by people and by gender: one list per people made a "Male" dwarf
  // Brunhilda as often as Brokk, and a dragonborn or a goliath was named
  // from a list of ten generic ones. m / f, and n for names that are neither
  // (a tabaxi's). A non-binary NPC draws from all of them; a people without
  // its own list borrows one (an aasimar's are human, a firbolg's elven).
  names:{
    Human:{ m:['Aldric','Gareth','Tobias','Dorian','Caspian','Bram','Edric','Hollis','Marten','Roderick'],
            f:['Mira','Seraphine','Elara','Vesna','Lyra','Annika','Brienne','Celia','Imogen','Rowena'] },
    Elf:{ m:['Caladrel','Thalindor','Elarion','Daeron','Aerendyl','Faelmir','Ilvanor','Lorethan','Saelorn','Vaeril'],
          f:['Aelindra','Faelwen','Miriel','Sylvara','Nimue','Ithilwen','Elanessa','Liraen','Shaelia','Ysolde'] },
    Dwarf:{ m:['Throdin','Kazrak','Dolgrin','Brokk','Rangrim','Bardrun','Durgan','Harnok','Torgar','Ulfgrim'],
            f:['Brunhilda','Helga','Marta','Sigrun','Vera','Agna','Dagny','Hildra','Ingrid','Tova'] },
    Halfling:{ m:['Pip','Merric','Tobold','Hob','Willo','Bramble','Fennick','Jory','Milo','Tad'],
               f:['Rosie','Calla','Bree','Daisy','Peony','Clover','Hazel','Lavinia','Marigold','Tansy'] },
    Gnome:{ m:['Bimble','Fizzwick','Nackle','Orryn','Quillon','Tibbit','Wrenfold','Zook','Dabbin','Gimble'],
            f:['Bella','Carlin','Fizzy','Lorilla','Nissa','Pippa','Quenna','Tilly','Wynnie','Zanna'] },
    Dragonborn:{ m:['Draxis','Kethrax','Morvoth','Tazhan','Vorrak','Szurath','Ghesh','Nadrith','Pyrrax','Uthrak'],
                 f:['Sorasha','Kava','Thessa','Vyrel','Zhenna','Irrith','Myrrhae','Naalia','Raxa','Ulvessa'] },
    Tiefling:{ m:['Malachar','Kalleth','Mordai','Zarek','Belvane','Orrin','Sarkis','Thamuz','Azrem','Valko'],
               f:['Lilit','Nemeia','Orianna','Rieta','Sabine','Vashti','Zaira','Akta','Kallista','Morwen'],
               n:['Hope','Sorrow','Ash','Ember','Torment','Reverie','Solace','Vigil'] },
    'Half-Orc':{ m:['Grukk','Durza','Krog','Mardok','Ruhn','Shagrol','Thokar','Urzog','Varg','Zorbash'],
                 f:['Arza','Ghorza','Kansha','Murka','Oretta','Sharga','Tuva','Urzha','Vola','Yevra'] },
    Goliath:{ m:['Kavrok','Lothar','Orrik','Thalgar','Vaunak','Gorran','Kelvak','Pethor','Ranak','Uthal'],
              f:['Aukala','Ilikai','Kethra','Naloa','Orvala','Paavi','Thenna','Vaema','Keoni','Mavra'] },
    Tabaxi:{ n:['Seven Lanterns','Dust on the Road','Quiet Feather','Copper Bell','River Song','Two Moons Rising','Hollow Reed','Bright Pebble','Morning Ash','Still Water'] },
  },
  nameFrom:{ Aasimar:'Human', Firbolg:'Elf', 'Half-Elf':['Human', 'Elf'] },
  // Ages a grown NPC of each people might be [youngest, oldest]: a 25-year-old
  // elf merchant is a child by elven reckoning, a 70-year-old half-orc ancient.
  ages:{ Human:[18, 75], Elf:[110, 600], 'Half-Elf':[20, 160], Dwarf:[50, 300], Halfling:[20, 130], Gnome:[40, 350],
         Tiefling:[18, 85], Dragonborn:[15, 70], 'Half-Orc':[14, 60], Goliath:[18, 80], Tabaxi:[18, 70], Firbolg:[30, 400], Aasimar:[18, 140] },
  epithets:['the Bold','the Silent','One-Eye','the Quick','the Elder','the Gray','the Red','the Tall','Ironhands','Goldtongue','the Pious','the Drunk'],
};

function rnd(arr){return arr[Math.floor(Math.random()*arr.length)];}
// The names an NPC of this people and gender could have.
function _npcNamePool(race, gender){
  const D = NPC_GEN_DATA;
  let src = D.names[race] ? [race] : [].concat(D.nameFrom[race] || 'Human');
  const g = gender === 'Male' ? 'm' : gender === 'Female' ? 'f' : null;
  const pool = [];
  src.forEach(r => { const p = D.names[r] || {}; (g ? (p[g] || []).concat(p.n || []) : [].concat(p.m || [], p.f || [], p.n || [])).forEach(x => pool.push(x)); });
  return pool.length ? pool : [].concat(D.names.Human.m, D.names.Human.f);
}
function _npcAge(race, role){
  const [lo, hi] = NPC_GEN_DATA.ages[race] || [18, 75];
  // A street urchin is a child, of whatever people.
  if (role === 'Street Urchin') return Math.max(6, Math.round(lo * (0.45 + Math.random() * 0.4)));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
function genNPC(overrides){
  const race=overrides.race||rnd(NPC_GEN_DATA.races);
  const gender=overrides.gender||rnd(NPC_GEN_DATA.genders);
  const role=overrides.role||rnd(NPC_GEN_DATA.roles);
  const name=rnd(_npcNamePool(race, gender))+(Math.random()<0.25?' '+rnd(NPC_GEN_DATA.epithets):'');
  const age=_npcAge(race, role);
  // Roll quirks first so we can dedupe — picking quirk2 != quirk avoids
  // "Hums under their breath. Hums under their breath." in the saved
  // NPC's description.
  const quirk = rnd(NPC_GEN_DATA.quirks);
  // Pick the second quirk from the remaining pool so it's GUARANTEED distinct —
  // the old bounded retry loop could, with vanishing-but-nonzero odds, still
  // land on the same quirk twice.
  const _otherQuirks = NPC_GEN_DATA.quirks.filter(q => q !== quirk);
  const quirk2 = _otherQuirks.length ? rnd(_otherQuirks) : quirk;
  return {
    name, race, gender, role, age,
    attitude:overrides.attitude||rnd(NPC_GEN_DATA.attitudes),
    quirk, quirk2,
    motivation:rnd(NPC_GEN_DATA.motivations),
    secret:rnd(NPC_GEN_DATA.secrets),
    hp:4+Math.floor(Math.random()*12),
    ac:10+Math.floor(Math.random()*4),
  };
}

registerPanel('npcgen',{
  title:'NPC Generator',icon:'🎲',
  _npc:null, _filters:{race:'',gender:'',role:'',attitude:''}, _secretRevealed:false,
  // Per-field locks — when true, "Generate" preserves that field's current
  // value instead of re-rolling it. Lets the DM keep e.g. an NPC's name and
  // race while re-rolling their personality.
  _locks:{},
  mount(body){this._body=body;if(!this._npc)this._npc=genNPC({});this._render();},
  unmount(){this._body=null;},

  // Roll a fresh NPC, then merge locked fields back from the current one so
  // they survive. Shared by single + bulk generate paths.
  _rollRespectingLocks(){
    // A kept people, gender or role rolls the rest for it: the name for a
    // kept "Female", the age for a kept dwarf.
    const keep = {}; ['race', 'gender', 'role'].forEach(k => { if (this._locks[k] && this._npc && this._npc[k]) keep[k] = this._npc[k]; });
    const fresh = genNPC(Object.assign({}, this._filters, keep));
    if (!this._npc) return fresh;
    const merged = {...fresh};
    Object.keys(this._locks).forEach(k => {
      if (this._locks[k] && this._npc[k] != null) merged[k] = this._npc[k];
    });
    return merged;
  },

  _render(){
    const b=this._body;if(!b)return;
    const n=this._npc||genNPC({});

    const sel=(label,key,opts)=>{
      const cur=this._filters[key]||'';
      return '<div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:100px">'
        +'<label style="font-size:var(--fs-2xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">'+label+'</label>'
        +'<select data-fkey="'+key+'" style="font-size:var(--fs-sm);padding:3px 5px">'
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

    const anyLocked = Object.values(this._locks).some(Boolean);
    html+='<div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      +'<button class="btn primary" id="npcgen-roll" style="flex:1;min-width:140px" title="'+(anyLocked?'Re-roll only unlocked fields':'Re-roll every field')+'">'+ICO('i-dice')+' '+(anyLocked?'Reroll unlocked':'Generate NPC')+'</button>'
      +'<button class="btn" id="npcgen-bulk" style="flex-shrink:0" title="Generate 5 NPCs straight into the NPC Library">+5 to Library</button>'
      +'<button class="btn" id="npcgen-save" style="flex-shrink:0" title="Keep this NPC in the library and open it">'+ICO('i-save')+' Keep</button>'
      +'<button class="btn" id="npcgen-combat" style="flex-shrink:0" title="Add to combat">'+ICO('i-combat')+' Combat</button>'
    +'</div>';

    if(n){
      html+='<div style="flex:1;overflow-y:auto;padding:12px">';

      // Tiny lock toggle helper — sits next to any field that should be
      // pinnable across generates. Inline SVG keeps the glyph crisp + small;
      // emoji 🔒/🔓 rendered chunky and inconsistent across platforms.
      const LOCK_SVG_LOCKED   = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M5 7V5a3 3 0 1 1 6 0v2h.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H5zm1 0h4V5a2 2 0 1 0-4 0v2z"/></svg>';
      const LOCK_SVG_UNLOCKED = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.25" d="M5.5 7.5V5a2.5 2.5 0 0 1 5 0M4.5 7.5h7a.5.5 0 0 1 .5.5v5.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5V8a.5.5 0 0 1 .5-.5z"/></svg>';
      const lock = (key) => {
        const on = !!this._locks[key];
        return '<button class="npcgen-lock '+(on?'on':'')+'" data-lock-key="'+key+'" title="'+(on?'Locked — preserved on re-roll. Click to unlock.':'Click to lock this field')+'">'+(on?LOCK_SVG_LOCKED:LOCK_SVG_UNLOCKED)+'</button>';
      };

      // Name & identity (editable)
      html+='<div style="margin-bottom:12px">'
        +'<div style="display:flex;align-items:center;gap:4px">'
          +'<input class="npcgen-name" data-nf="name" value="'+esc(n.name)+'" style="flex:1;font-size:var(--fs-2xl);font-weight:700;color:var(--accent);background:transparent;border:1px solid transparent;padding:2px 4px;border-radius:3px;margin-bottom:2px">'
          +lock('name')
        +'</div>'
        +'<div class="npcgen-identity" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;font-size:var(--fs-md);color:var(--text-muted)">'
          +'<input data-nf="gender" value="'+esc(n.gender)+'" class="npcgen-inline" placeholder="Gender">'+lock('gender')
          +'<input data-nf="race" value="'+esc(n.race)+'" class="npcgen-inline" placeholder="Race">'+lock('race')
          +'<span>·</span>'
          +'<input type="number" data-nf="age" value="'+n.age+'" class="npcgen-inline" min="1" max="999" title="Age">'+lock('age')
          +'<span>yrs</span>'
          +'<span>·</span>'
          +'<input data-nf="role" value="'+esc(n.role)+'" class="npcgen-inline" placeholder="Role">'+lock('role')
        +'</div>'
      +'</div>';

      // Stats (editable)
      const statBox=(lab,key,val,big)=>'<div class="npcgen-stat-box">'
        +'<div class="npcgen-stat-lab">'+lab+'</div>'
        +'<input data-nf="'+key+'" value="'+esc(val)+'" class="npcgen-stat-input"'+(big?' type="number"':'')+'>'
      +'</div>';
      html+='<div class="npcgen-stat-row">'
        +statBox('Attitude','attitude',n.attitude,false)
        +statBox('HP','hp',n.hp,true)
        +statBox('AC','ac',n.ac,true)
      +'</div>';

      const field=(label,key,val,col,isSecret)=>{
        const hidden = isSecret && !this._secretRevealed;
        const reveal = isSecret
          ? '<button class="btn small npcgen-reveal" data-act="toggle-secret" style="font-size:var(--fs-xs)">'
              +(this._secretRevealed?ICO('i-eye-off')+' Hide':ICO('i-eye')+' Reveal')
            +'</button>'
          : '';
        const on = !!this._locks[key];
        const lockBtn = '<button class="npcgen-lock '+(on?'on':'')+'" data-lock-key="'+key+'" title="'+(on?'Locked — preserved on re-roll':'Lock this field')+'" style="margin-left:auto;'+(isSecret?'margin-right:6px':'')+'">'+(on?LOCK_SVG_LOCKED:LOCK_SVG_UNLOCKED)+'</button>';
        return '<div class="npcgen-field" style="margin-bottom:8px">'
          +'<div style="display:flex;align-items:center;font-size:var(--fs-2xs);text-transform:uppercase;letter-spacing:.5px;color:'+(col||'var(--text-muted)')+';margin-bottom:3px;gap:4px">'
            +'<span>'+label+'</span>'+lockBtn+reveal
          +'</div>'
          +'<textarea data-nf="'+key+'" rows="2" class="npcgen-field-input'+(hidden?' redacted':'')+'" style="border-left:2px solid '+(col||'var(--border)')+'">'+esc(val||'')+'</textarea>'
        +'</div>';
      };

      html+=field('Quirk','quirk',n.quirk,'var(--info)',false);
      html+=field('Also','quirk2',n.quirk2,'var(--info)',false);
      html+=field('Motivation','motivation',n.motivation,'var(--warning)',false);
      html+=field(ICO('i-lock')+' Secret','secret',n.secret,'var(--danger)',true);

      html+='</div>';
    }

    b.innerHTML=html;

    // Filter selects
    b.querySelectorAll('[data-fkey]').forEach(sel2=>sel2.addEventListener('change',e=>{
      this._filters[e.target.dataset.fkey]=e.target.value;
    }));

    // Editable NPC field bindings — store back onto this._npc without re-rendering
    // (re-render would lose focus / cursor position).
    b.querySelectorAll('[data-nf]').forEach(el=>{
      el.addEventListener('input',e=>{
        const f=el.dataset.nf;
        const v=el.value;
        this._npc[f] = (f==='hp'||f==='ac'||f==='age') ? (parseInt(v)||0) : v;
      });
    });

    // Secret reveal toggle
    b.querySelector('[data-act="toggle-secret"]')?.addEventListener('click',()=>{
      this._secretRevealed = !this._secretRevealed;
      this._render();
    });

    // Per-field lock toggles
    b.querySelectorAll('[data-lock-key]').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.lockKey;
      this._locks[k] = !this._locks[k];
      this._render();
    }));

    b.querySelector('#npcgen-roll').addEventListener('click',()=>{
      this._npc = this._rollRespectingLocks();
      this._secretRevealed=false;
      this._render();
    });

    // Build a v2-shape NPC Library entry from a generator NPC. Centralised so
    // single-save and bulk-save use the exact same mapping.
    const toLibraryEntry = (g) => ({
      id: (typeof uid==='function' ? uid() : 'n_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5)),
      name: g.name || 'New NPC',
      role: g.role || '',
      group: (typeof NPC_DEFAULT_GROUP !== 'undefined') ? NPC_DEFAULT_GROUP : 'Unfiled',
      attitude: g.attitude || 'Neutral',
      hp: g.hp || 0,
      ac: g.ac || 10,
      init: 0,
      tags: [g.race, g.role, g.gender].filter(Boolean),
      // Visible description — the player-facing flavor. Dedupe quirks so an
      // NPC whose two quirks rolled identical doesn't read "Hums under their
      // breath Hums under their breath".
      description: (() => {
        const quirks = [g.quirk, g.quirk2].filter(Boolean);
        const uniqueQuirks = [...new Set(quirks)];
        return [g.gender, g.race, 'aged ' + g.age + '.', ...uniqueQuirks].filter(Boolean).join(' ');
      })(),
      // DM-only notes — motivation is fine in plain notes; the SECRET goes
      // into its own dedicated field so the library can render it with a
      // hide/reveal toggle (same UX as the generator). Saving a generated
      // NPC used to dump the secret straight into the notes field where it
      // sat in plain text — a player glancing at the screen could read it.
      // HTML-escaped: the library renders n.notes as innerHTML (rich-text
      // field), so a raw '<' or '&' in the motivation would corrupt it.
      notes: 'Motivation: ' + esc(g.motivation||'—'),
      secret: g.secret || '',
    });

    // Push one entry into the library, persisting under v2 (the library's
    // current schema). Mounts the panel if it's not already open so the user
    // sees the new entry immediately, and selects it for editing.
    const saveOneToLibrary = (g, open) => {
      const lib = panelDefs.npclib;
      const entry = toLibraryEntry(g);
      if (lib){
        // Load it first. `lib` always exists — the panel is registered at
        // startup — but its list is only read from storage when the Library
        // is opened. Treating "not loaded" as "empty" made the first NPC
        // saved here in a session replace the entire library.
        if (typeof lib._ensureLoaded === 'function') lib._ensureLoaded();
        if (!Array.isArray(lib._npcs)) lib._npcs = [];
        lib._npcs.unshift(entry);
        if (open){ lib._selectedId = entry.id; lib._gen = false; }
        // Re-hide the secret: the generated NPC carries one, and the library's
        // reveal flag is panel-global — leaving it true would expose the new
        // entry's secret on render without an explicit Reveal click.
        lib._secretRevealed = false;
        // Use the panel's own _save() rather than poking localStorage directly,
        // so any future persistence logic in _save() isn't bypassed.
        if (typeof lib._save === 'function') lib._save();
        else { saveJson('skt-npcs-v2', lib._npcs, 'NPC library'); }
        if (lib._body && typeof lib._render === 'function') lib._render();
      } else {
        // Library panel not mounted — write directly to localStorage so it
        // shows up next time the panel opens.
        let cur;
        try { cur = JSON.parse(localStorage.getItem('skt-npcs-v2') || '[]'); } catch(e){ cur = []; }
        if (!Array.isArray(cur)) cur = [];
        cur.unshift(entry);
        saveJson('skt-npcs-v2', cur, 'NPC library');
      }
      return entry;
    };

    b.querySelector('#npcgen-save').addEventListener('click',()=>{
      if(!n)return;
      // Kept: filed in the library and opened there, in place of this pane.
      const entry = saveOneToLibrary(n, true);
      this._npc = null;
      if (typeof showToast === 'function') showToast(entry.name + ' kept in the library');
    });

    // Bulk generate — respects filters; ignores locks so each NPC is fully
    // fresh. Useful for staging crowd scenes (tavern, market, court).
    b.querySelector('#npcgen-bulk')?.addEventListener('click', () => {
      const N = 5;
      for (let k = 0; k < N; k++){
        saveOneToLibrary(genNPC(this._filters));
      }
      if (typeof showToast === 'function') showToast('Added ' + N + ' NPCs to the library');
    });

    b.querySelector('#npcgen-combat').addEventListener('click',()=>{
      if(!n)return;
      panelDefs.combat.addMonster({name:n.name,hp:n.hp,hpMax:n.hp,ac:n.ac,dex:10});
    });
  },
});
