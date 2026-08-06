// ============================================================
// SEARCH — powered by local 5etools data (data-loader.js)
// ============================================================

// Build full detail HTML from a dnd5eapi monster response
function renderMonsterFull(d, localData) {
  const r = d._raw || {};
  const hp = r.hit_points || localData?.hp || 0;
  const acVal = r.armor_class?.[0]?.value ?? localData?.ac ?? 0;
  const acType = r.armor_class?.[0]?.type || '';
  const speed = Object.entries(r.speed||{}).map(([k,v])=>k+' '+v).join(', ') || localData?.speed || '—';
  const str=r.strength||10,dex=r.dexterity||10,con=r.constitution||10;
  const int=r.intelligence||10,wis=r.wisdom||10,cha=r.charisma||10;
  // Map of saves the creature is proficient in (5etools stores them on
  // d.save → moved into proficiencies by _parseProficiencies). Every ability
  // cell shows BOTH the mod and the save; non-proficient saves equal the mod
  // and are still rendered so the layout matches 5etools' MOD/SAVE columns.
  const profSaves = new Map();
  (r.proficiencies||[])
    .filter(p => p.proficiency.name.startsWith('Saving Throw:'))
    .forEach(p => profSaves.set(p.proficiency.name.replace('Saving Throw: ',''), p.value));
  const fmtMod = n => (n >= 0 ? '+' : '') + n;
  const ab = (l, s) => {
    const m = mod(s);
    const sv = profSaves.has(l) ? profSaves.get(l) : m;
    const isProf = profSaves.has(l);
    return `<div class="ability">
      <div class="ab-name">${l}</div>
      <div class="ab-val">${s}</div>
      <div class="ab-mod">${fmtMod(m)}</div>
      <div class="ab-save${isProf?' is-prof':''}" title="${isProf?'Proficient saving throw':'Saving throw'}">save ${fmtMod(sv)}</div>
    </div>`;
  };
  const section=(label,text)=>text?`<div class="detail-section"><strong>${label}.</strong> ${esc(text)}</div>`:'';
  const actions=(label,arr)=>{
    if(!arr||!arr.length)return'';
    const rows=arr.map(a=>'<em>'+esc(a.name||'')+'</em> '+_renderInline(esc(a.desc||''))).join('<br><br>');
    return'<div class="action-block"><strong>'+label+'.</strong><br>'+rows+'</div>';
  };
  // Initiative sits next to AC because that's where the 2024 books put it, and
  // because a DM reaching for it is mid-encounter-start, not mid-turn.
  // Rendered as "+3 (13)": the modifier to roll with, then the passive value
  // for when you'd rather not roll for this creature at all.
  const _ini = (typeof sktMonsterInitiative === 'function') ? sktMonsterInitiative(r) : null;
  const iniHtml = _ini
    ? '<div class="stat-block"><div class="lab">Init</div><div class="val">'
      + (_ini.bonus >= 0 ? '+' : '') + _ini.bonus + ' (' + _ini.passive + ')'
      + (_ini.mode === 'adv' ? ' <span title="Rolls initiative with advantage">adv</span>'
        : _ini.mode === 'dis' ? ' <span title="Rolls initiative with disadvantage">dis</span>' : '')
      + '</div></div>'
    : '';
  let html = '';
  html += '<div class="detail-stats">'
    + '<div class="stat-block"><div class="lab">HP</div><div class="val">'+hp+(r.hit_dice?' ('+r.hit_dice+')':'')+'</div></div>'
    + '<div class="stat-block"><div class="lab">AC</div><div class="val">'+acVal+(acType?' ('+acType+')':'')+'</div></div>'
    + iniHtml
    + '<div class="stat-block"><div class="lab">Speed</div><div class="val">'+esc(speed)+'</div></div>'
    + '</div>';
  html += '<div class="ability-grid">'+ab('STR',str)+ab('DEX',dex)+ab('CON',con)+ab('INT',int)+ab('WIS',wis)+ab('CHA',cha)+'</div>';
  // Skills from the proficiencies array. (Saves are now rendered inline
  // inside each ability cell above, so we don't repeat them here.)
  if(r.proficiencies?.length){
    const skills=r.proficiencies.filter(p=>p.proficiency.name.startsWith('Skill:'))
      .map(p=>p.proficiency.name.replace('Skill: ','')+(p.value>=0?' +'+(p.value):' '+p.value));
    if(skills.length)html+='<div class="detail-section"><strong>Skills.</strong> '+skills.join(', ')+'</div>';
  }
  if(r.damage_vulnerabilities?.length)html+=section('Vulnerabilities',r.damage_vulnerabilities.join(', '));
  if(r.damage_resistances?.length)html+=section('Resistances',r.damage_resistances.join(', '));
  if(r.damage_immunities?.length)html+=section('Immunities',r.damage_immunities.join(', '));
  if(r.condition_immunities?.length)html+=section('Condition Immunities',r.condition_immunities.map(c=>c.name).join(', '));
  const senses=Object.entries(r.senses||{}).filter(([k])=>k!=='passive_perception').map(([k,v])=>k.replace(/_/g,' ')+' '+v).join(', ');
  if(senses)html+=section('Senses',senses+(r.senses?.passive_perception!=null?', passive Perception '+r.senses.passive_perception:''));
  if(r.languages)html+=section('Languages',r.languages);
  // CR display: 5etools shows "None" for roleplay-only NPCs with no CR.
  // _parseCR already normalizes nulls to "None"; we just zero the XP for
  // those rows so we don't show "XP 10" by accident on a CR-less stat block.
  const _crRaw = r.challenge_rating;
  const _crBlank = _crRaw == null || _crRaw === '' || _crRaw === 'None' || _crRaw === '—' || _crRaw === '?';
  const crText = _crBlank ? 'None' : String(_crRaw);
  const xpText = _crBlank ? '0' : (r.xp != null ? r.xp.toLocaleString() : '0');
  html+='<div class="detail-section"><strong>CR.</strong> '+esc(crText)+' &nbsp; <strong>XP.</strong> '+xpText+'</div>';
  if(r.special_abilities?.length)html+=actions('Traits',r.special_abilities);
  if(r.actions?.length)html+=actions('Actions',r.actions);
  if(r.bonus_actions?.length)html+=actions('Bonus Actions',r.bonus_actions);
  if(r.reactions?.length)html+=actions('Reactions',r.reactions);
  if(r.legendary_actions?.length)html+=actions('Legendary Actions',r.legendary_actions);
  if(r.mythic_actions?.length)html+=actions('Mythic Actions',r.mythic_actions);
  // Joined on from data/bestiary/legendarygroups.json — see addMonster. These
  // sit last because that's where they appear in a printed stat block.
  if(r.lair_actions?.length)html+=actions('Lair Actions',r.lair_actions);
  if(r.regional_effects?.length)html+=actions('Regional Effects',r.regional_effects);
  return html;
}

function _statRow(label, val) {
  if (val == null || val === '' || val === '—') return '';
  return `<div class="detail-statrow"><strong>${esc(label)}:</strong> ${val}</div>`;
}

function renderSpellFull(d) {
  const r = d._raw || {};
  const components = Array.isArray(r.components) ? r.components.join(', ')+(r.material?' ('+r.material+')':'') : (d.components||'—');
  const desc = Array.isArray(r.desc) ? r.desc.join('\n\n') : (r.desc||d.desc||'');
  const higherLevel = Array.isArray(r.higher_level) ? r.higher_level.join('\n\n') : (r.higher_level||'');
  const classes = r.classes?.map(c=>c.name).join(', ') || '';
  let html = '<div class="detail-statblock">';
  html += _statRow('Casting Time', esc(r.casting_time||d.cast||'—'));
  html += _statRow('Range', esc(r.range||d.range||'—'));
  html += _statRow('Components', esc(components));
  html += _statRow('Duration', esc(r.duration||d.duration||'—'));
  html += '</div>';
  if(r.concentration||r.ritual){
    const tags = [];
    if(r.concentration) tags.push('<span style="color:var(--warning)">⚡ Concentration</span>');
    if(r.ritual)        tags.push('<span style="color:var(--accent)">📿 Ritual</span>');
    html += `<div class="detail-section" style="font-size:11px">${tags.join(' · ')}</div>`;
  }
  html += renderEntriesText(desc);
  if(higherLevel)html+=`<div class="detail-section"><strong class="detail-label">At Higher Levels.</strong> ${_renderInline(esc(higherLevel))}</div>`;
  if(classes)html+=`<div class="detail-statrow"><strong>Classes:</strong> ${esc(classes)}</div>`;
  return html;
}

// 5etools weapon-property single-letter codes → human label.
const _ITEM_PROP_LABEL = {
  'A':'Ammunition','AF':'Ammunition (Futuristic)','BF':'Burst Fire','F':'Finesse',
  'H':'Heavy','L':'Light','LD':'Loading','R':'Reach','RLD':'Reload','S':'Special',
  'T':'Thrown','2H':'Two-Handed','V':'Versatile','RN':'Range','M':'Mounted',
};
const _ITEM_DMG_TYPE_LABEL = {
  'A':'acid','B':'bludgeoning','C':'cold','F':'fire','O':'force','L':'lightning',
  'N':'necrotic','P':'piercing','I':'poison','Y':'psychic','R':'radiant','S':'slashing',
  'T':'thunder',
};

// Renders just the stat-block + description for one item (the base or one of
// its bonus variants). Used both standalone and as the tab body in
// renderItemFull.
function _renderItemBody(raw, fallbackDesc){
  const r = raw || {};
  const desc = Array.isArray(r.desc) ? r.desc.join('\n\n') : (r.desc||fallbackDesc||'');
  let html = '<div class="detail-statblock">';
  if (r.value != null) html += _statRow('Cost', esc(String(r.value)));
  if (r.weight != null) html += _statRow('Weight', esc(r.weight + (r.weight === 1 ? ' lb.' : ' lbs.')));
  if (r.rarity && r.rarity !== 'unknown' && r.rarity !== 'none') html += _statRow('Rarity', esc(r.rarity.charAt(0).toUpperCase()+r.rarity.slice(1)));
  if (r.requires_attunement) html += _statRow('Attunement', typeof r.requires_attunement==='string'?esc(r.requires_attunement):'Required');

  // Weapons: damage dice + type, properties, range.
  if (r.dmg1 || r.dmg2 || r.dmgType){
    const dmgType = r.dmgType ? (_ITEM_DMG_TYPE_LABEL[r.dmgType] || r.dmgType) : '';
    const parts = [];
    if (r.dmg1) parts.push(r.dmg1 + (dmgType ? ' '+dmgType : ''));
    if (r.dmg2) parts.push('('+r.dmg2+(dmgType ? ' '+dmgType : '')+', versatile)');
    html += _statRow('Damage', esc(parts.join(' ')));
  }
  if (r.weaponCategory) {
    html += _statRow('Weapon', esc(r.weaponCategory.charAt(0).toUpperCase()+r.weaponCategory.slice(1)));
  }
  if (r.range) html += _statRow('Range', esc(r.range + ' ft.'));
  if (Array.isArray(r.property) && r.property.length){
    const labels = r.property.map(p => {
      const code = String(p).split('|')[0]; // strip "|SOURCE" suffix
      return _ITEM_PROP_LABEL[code] || code;
    });
    html += _statRow('Properties', esc(labels.join(', ')));
  }

  // Armor: AC, stealth disadvantage, strength requirement.
  // Shields list their AC as a bonus (+2); armor lists it as the value (16).
  if (r.ac != null){
    const typeCode = (r.type||'').split('|')[0];
    const isShield = typeCode === 'S';
    html += _statRow('Armor Class', esc(isShield ? '+'+r.ac : String(r.ac)));
  }
  if (r.strength) html += _statRow('Min. Strength', esc('Str ' + r.strength));
  if (r.stealth) html += _statRow('Stealth', 'Disadvantage');

  // Mounts, vehicles, animals: speed and carrying capacity.
  if (r.speed != null) html += _statRow('Speed', esc(r.speed + ' ft.'));
  if (r.carryingCapacity != null) html += _statRow('Carrying Capacity', esc(r.carryingCapacity + ' lb.'));

  html += '</div>';
  html += renderEntriesText(desc);
  return html;
}

function renderItemFull(d) {
  const variants = d._variants || [];
  // Tab payloads: base + each variant. Each entry has {label, raw, fallbackDesc}.
  const tabs = [
    { label: 'Base', raw: d._raw, fallbackDesc: d.desc },
    ...variants.map(v => ({ label: v.label, raw: v._raw, fallbackDesc: '' })),
  ];
  if (tabs.length === 1){
    // No variants — render just the stat block (no tab strip).
    return _renderItemBody(d._raw, d.desc);
  }
  // Encode each variant body up-front and stash on data attributes so a tiny
  // inline script can swap them on tab click without round-tripping through
  // the search controller.
  const bodies = tabs.map(t => _renderItemBody(t.raw, t.fallbackDesc));
  // Use a unique id so multiple item detail views (search popup + popped-out
  // window) don't clobber each other's tabs.
  const id = 'itab-' + (renderItemFull._n = (renderItemFull._n || 0) + 1);
  let html = `<div class="item-tabs" data-itab-root="${id}">`;
  tabs.forEach((t, i) => {
    html += `<button class="item-tab${i===0?' active':''}" data-itab="${id}" data-i="${i}">${esc(t.label)}</button>`;
  });
  html += '</div>';
  html += `<div class="item-tab-body" id="${id}-body">${bodies[0]}</div>`;
  // Stash bodies as base64 in a hidden script tag so a delegated click handler
  // (wired below) can read them out.
  html += `<script type="application/json" id="${id}-data">${JSON.stringify(bodies).replace(/</g,'\\u003c')}</script>`;
  return html;
}

// One global click delegate handles every item-tab strip (search popup and
// any popped-out windows). Tab click → swap the body element's HTML with the
// stashed pre-rendered body for the clicked variant.
if (!window._itemTabsWired){
  window._itemTabsWired = true;
  document.addEventListener('click', e => {
    const btn = e.target.closest('.item-tab');
    if (!btn) return;
    const id = btn.dataset.itab; if (!id) return;
    const idx = +btn.dataset.i;
    const dataEl = document.getElementById(id + '-data');
    const bodyEl = document.getElementById(id + '-body');
    if (!dataEl || !bodyEl) return;
    let bodies; try { bodies = JSON.parse(dataEl.textContent); } catch(_){ return; }
    if (!bodies[idx]) return;
    bodyEl.innerHTML = bodies[idx];
    // Update active class on sibling tabs.
    document.querySelectorAll(`.item-tab[data-itab="${id}"]`).forEach(el => {
      el.classList.toggle('active', +el.dataset.i === idx);
    });
  });
}

// Psionic: Manifestation Time / Range / Duration / Target stats up top.
function renderPsionicFull(d) {
  const r = d._raw || {};
  let html = '<div class="detail-statblock">';
  // 5etools psionic structure: top-level entries[] usually has body text plus
  // a list of {type:'item', name:'...', entries:[...]} for the meta lines.
  // The discipline header row uses focus + order, but those aren't always present.
  if (r.focus) html += _statRow('Psionic Focus', esc(r.focus));
  html += '</div>';
  // The body already contains the manifestation stats and the modes (\x04 markers).
  html += renderEntriesText(d.desc || '');
  return html;
}

// Deity: most entries (347/563) have NO body — they rely entirely on
// alignment/category/domains/pantheon/symbol/province structured fields.
const _ALIGN = {L:'Lawful',N:'Neutral',C:'Chaotic',G:'Good',E:'Evil',U:'Unaligned',A:'Any'};
function renderDeityFull(d) {
  const r = d._raw || {};
  let html = '<div class="detail-statblock">';
  if (r.title) html += `<div class="detail-statrow" style="font-style:italic;color:var(--text-muted);margin-bottom:6px">${esc(r.title)}</div>`;
  if (r.alignment) {
    const a = Array.isArray(r.alignment) ? r.alignment.map(x => _ALIGN[x]||x).join(' ') : r.alignment;
    html += _statRow('Alignment', esc(a));
  }
  if (r.category) html += _statRow('Category', esc(r.category));
  if (Array.isArray(r.domains) && r.domains.length) html += _statRow('Domains', esc(r.domains.join(', ')));
  if (r.pantheon)    html += _statRow('Pantheon', esc(r.pantheon));
  if (r.province)    html += _statRow('Province', esc(r.province));
  if (r.symbol)      html += _statRow('Symbol', esc(r.symbol));
  if (Array.isArray(r.altNames) && r.altNames.length) html += _statRow('Alternate Names', esc(r.altNames.join(', ')));
  html += '</div>';
  if (d.desc) html += renderEntriesText(d.desc);
  return html;
}

// Race: ability/size/speed/languages even when entries are missing.
function _abilityScoresStr(abilArr) {
  if (!Array.isArray(abilArr) || !abilArr.length) return '';
  return abilArr.map(a => {
    if (a.choose) return `Choose ${a.choose.amount||1} from ${(a.choose.from||[]).map(s=>s.toUpperCase()).join('/')}+${a.choose.count||1}`;
    return Object.entries(a).filter(([k])=>!['choose'].includes(k)).map(([k,v])=>`${k.toUpperCase()} ${v>=0?'+':''}${v}`).join(', ');
  }).join('; ');
}
function renderRaceFull(d) {
  const r = d._raw || {};
  let html = '<div class="detail-statblock">';
  const abil = _abilityScoresStr(r.ability);
  if (abil) html += _statRow('Ability Scores', esc(abil));
  if (r.size) html += _statRow('Size', esc((Array.isArray(r.size)?r.size:[r.size]).map(s=>({T:'Tiny',S:'Small',M:'Medium',L:'Large'}[s]||s)).join(' or ')));
  if (Array.isArray(r.speed)) html += _statRow('Speed', esc(r.speed.join(', ')));
  else if (typeof r.speed==='number') html += _statRow('Speed', r.speed+' ft.');
  else if (r.speed && typeof r.speed==='object') {
    const parts = Object.entries(r.speed).filter(([,v])=>v).map(([k,v])=>k+' '+(v===true?'30':v)+' ft.');
    if (parts.length) html += _statRow('Speed', esc(parts.join(', ')));
  }
  if (Array.isArray(r.languageProficiencies) && r.languageProficiencies.length) {
    const lang = r.languageProficiencies.map(lp => {
      if (lp.anyStandard) return `Choose ${lp.anyStandard} standard language(s)`;
      return Object.keys(lp).filter(k=>lp[k]).map(k=>k.charAt(0).toUpperCase()+k.slice(1)).join(', ');
    }).filter(Boolean).join('; ');
    if (lang) html += _statRow('Languages', esc(lang));
  }
  html += '</div>';
  if (d.desc) html += renderEntriesText(d.desc);
  return html;
}

// Background: ability, skill/tool/language proficiencies, equipment, feats.
function renderBackgroundFull(d) {
  const r = d._raw || {};
  let html = '<div class="detail-statblock">';
  if (Array.isArray(r.skillProficiencies) && r.skillProficiencies.length) {
    const sp = r.skillProficiencies[0];
    const skills = Object.keys(sp).filter(k => sp[k]===true).map(k => k.charAt(0).toUpperCase()+k.slice(1));
    if (sp.choose) skills.push(`choose ${sp.choose.count||1} from ${(sp.choose.from||[]).map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(', ')}`);
    if (skills.length) html += _statRow('Skill Proficiencies', esc(skills.join(', ')));
  }
  if (Array.isArray(r.toolProficiencies) && r.toolProficiencies.length) {
    const tp = r.toolProficiencies[0];
    const tools = Object.keys(tp).filter(k => tp[k]===true).map(k => k.charAt(0).toUpperCase()+k.slice(1));
    if (tools.length) html += _statRow('Tool Proficiencies', esc(tools.join(', ')));
  }
  if (Array.isArray(r.languageProficiencies) && r.languageProficiencies.length) {
    const lp = r.languageProficiencies[0];
    const n = lp.anyStandard || lp.any;
    if (n) html += _statRow('Languages', `Any ${n}`);
  }
  if (Array.isArray(r.feats) && r.feats.length) {
    const fs = r.feats.map(f => Object.keys(f).map(k=>k.split('|')[0]).join(', ')).join('; ');
    if (fs) html += _statRow('Feats', esc(fs));
  }
  if (r.ability) {
    const abil = _abilityScoresStr(r.ability);
    if (abil) html += _statRow('Ability Scores', esc(abil));
  }
  html += '</div>';
  if (d.desc) html += renderEntriesText(d.desc);
  return html;
}

// Object: stat-block-like rendering for Large/Huge objects with HP, AC, etc.
function renderObjectFull(d) {
  const r = d._raw || {};
  let html = '<div class="detail-statblock">';
  const sz = (Array.isArray(r.size)?r.size[0]:r.size);
  const sizeName = {T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan'}[sz]||sz;
  if (sizeName||r.objectType) html += `<div class="detail-statrow" style="font-style:italic;color:var(--text-muted);margin-bottom:6px">${esc([sizeName,r.objectType||'object'].filter(Boolean).join(' '))}</div>`;
  if (r.ac) html += _statRow('Armor Class', esc(typeof r.ac==='object'?(r.ac[0]?.ac||r.ac):String(r.ac)));
  if (r.hp) html += _statRow('Hit Points', esc(typeof r.hp==='object'?(r.hp.average||r.hp.formula||''):String(r.hp)));
  if (r.speed != null) {
    const sp = typeof r.speed==='number' ? r.speed+' ft.' : (typeof r.speed==='object'?Object.entries(r.speed).map(([k,v])=>(k==='walk'?'':k+' ')+(typeof v==='number'?v:v.number||0)+' ft.').join(', '):String(r.speed));
    html += _statRow('Speed', esc(sp));
  }
  if (r.str||r.dex||r.con||r.int||r.wis||r.cha) {
    const ab = ['str','dex','con','int','wis','cha'].filter(k=>r[k]!=null).map(k=>{
      const v=r[k]; const m=Math.floor((v-10)/2);
      return `${k.toUpperCase()} ${v} (${m>=0?'+':''}${m})`;
    }).join(', ');
    html += _statRow('Ability Scores', esc(ab));
  }
  if (Array.isArray(r.immune) && r.immune.length) html += _statRow('Damage Immunities', esc(r.immune.map(i=>typeof i==='string'?i:i.immune?.join('/')||'').filter(Boolean).join(', ')));
  if (r.senses) html += _statRow('Senses', esc(Array.isArray(r.senses)?r.senses.join(', '):String(r.senses)));
  html += '</div>';
  if (d.desc) html += renderEntriesText(d.desc);
  // Action entries (e.g. "Claw" attacks)
  if (Array.isArray(r.actionEntries) && r.actionEntries.length) {
    html += '<h3 class="detail-header">Actions</h3>';
    r.actionEntries.forEach(a => {
      html += `<div class="detail-section"><strong class="detail-label">${esc(a.name||'')}.</strong> ${_renderInline(esc(_parseEntries_local(a.entries||[])))}</div>`;
    });
  }
  return html;
}
function _parseEntries_local(arr) {
  if (!Array.isArray(arr)) return typeof arr === 'string' ? _stripTagsLocal(arr) : '';
  return arr.map(e => {
    if (typeof e === 'string') return _stripTagsLocal(e);
    if (e && typeof e === 'object') {
      const sub = e.entries || (e.entry ? [e.entry] : null);
      if (sub) return (e.name ? e.name + ': ' : '') + _parseEntries_local(sub);
    }
    return '';
  }).filter(Boolean).join('\n\n');
}
function _stripTagsLocal(s) {
  if (typeof _stripTags === 'function') return _stripTags(s);
  // fallback if data-loader not yet loaded
  return s
    .replace(/\{@atk [^}]+\}/g, 'Attack:')
    .replace(/\{@hom\}/g, 'Hit or Miss: ')
    .replace(/\{@h\}/g, 'Hit: ')
    .replace(/\{@hit ([+-]?\d+)\}/g, (_, n) => (parseInt(n) >= 0 ? '+' : '') + n)
    .replace(/\{@dc (\d+)\}/g, 'DC $1')
    .replace(/\{@(?:damage|dice)\s+([^|}]+)[^}]*\}/g, '$1')
    .replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, '$1')
    .replace(/\{@[^}]*\}/g, '');
}

// Bastion facility: prerequisite, space, hirelings, order.
function renderFacilityFull(d) {
  const r = d._raw || {};
  let html = '<div class="detail-statblock">';
  if (r.level||r.facilityType) html += `<div class="detail-statrow" style="font-style:italic;color:var(--text-muted);margin-bottom:6px">${esc([r.level?'Level '+r.level:'',r.facilityType?r.facilityType+' Bastion Facility':''].filter(Boolean).join(' '))}</div>`;
  if (r.prerequisite) html += _statRow('Prerequisite', esc(typeof r.prerequisite==='string'?r.prerequisite:JSON.stringify(r.prerequisite)));
  if (r.space) html += _statRow('Space', esc(Array.isArray(r.space)?r.space.join(', '):r.space));
  if (r.hirelings != null) html += _statRow('Hirelings', esc(typeof r.hirelings==='object'?(r.hirelings[0]?.exact||r.hirelings[0]?.min+'-'+r.hirelings[0]?.max||''):String(r.hirelings)));
  if (Array.isArray(r.orders) && r.orders.length) html += _statRow('Order', esc(r.orders.join(', ')));
  html += '</div>';
  if (d.desc) html += renderEntriesText(d.desc);
  return html;
}

// Language: most languages have no entries — show typicalSpeakers/script.
function renderLanguageFull(d) {
  const r = d._raw || {};
  let html = '<div class="detail-statblock">';
  if (r.type) html += _statRow('Type', esc(r.type.charAt(0).toUpperCase()+r.type.slice(1)));
  if (r.script) html += _statRow('Script', esc(r.script));
  // typicalSpeakers/dialects come straight from the raw 5etools data and may
  // contain {@creature ...} link tags — strip those to plain text first.
  const stripper = (typeof _stripTags === 'function') ? _stripTags : (s => String(s||''));
  if (Array.isArray(r.typicalSpeakers) && r.typicalSpeakers.length) html += _statRow('Typical Speakers', esc(r.typicalSpeakers.map(stripper).join(', ')));
  if (Array.isArray(r.dialects) && r.dialects.length) html += _statRow('Dialects', esc(r.dialects.map(stripper).join(', ')));
  html += '</div>';
  if (d.desc) html += renderEntriesText(d.desc);
  return html;
}

// Skill: ability score association.
function renderSkillFull(d) {
  const r = d._raw || {};
  let html = '<div class="detail-statblock">';
  if (r.ability) html += _statRow('Ability', esc(r.ability.toUpperCase()));
  html += '</div>';
  if (d.desc) html += renderEntriesText(d.desc);
  return html;
}

// Vehicle: 36/39 vehicles have NO entries — they're stat-block-only.
function renderVehicleFull(d) {
  const r = d._raw || {};
  let html = '<div class="detail-statblock">';
  const sz = (Array.isArray(r.size)?r.size[0]:r.size);
  const sizeName = {T:'Tiny',S:'Small',M:'Medium',L:'Large',H:'Huge',G:'Gargantuan'}[sz]||sz;
  const subtitle = [sizeName, r.vehicleType||'vehicle', r.dimensions?`(${r.dimensions.join(' by ')})`:''].filter(Boolean).join(' ');
  if (subtitle) html += `<div class="detail-statrow" style="font-style:italic;color:var(--text-muted);margin-bottom:6px">${esc(subtitle)}</div>`;
  if (r.capCrew || r.capPassenger) {
    const parts = [];
    if (r.capCrew) parts.push(r.capCrew + ' crew');
    if (r.capPassenger) parts.push(r.capPassenger + ' passengers');
    if (parts.length) html += _statRow('Creature Capacity', esc(parts.join(', ')));
  }
  if (r.capCargo != null) html += _statRow('Cargo Capacity', esc(String(r.capCargo) + (typeof r.capCargo==='number'?' tons':'')));
  if (r.pace) html += _statRow('Travel Pace', esc(String(r.pace) + ' miles per hour'));
  if (r.speed != null) {
    const sp = typeof r.speed==='number' ? r.speed+' ft.' : (typeof r.speed==='object'?Object.entries(r.speed).map(([k,v])=>(k==='walk'?'':k+' ')+(typeof v==='number'?v:v.number||0)+' ft.').join(', '):String(r.speed));
    html += _statRow('Speed', esc(sp));
  }
  if (r.ac != null) html += _statRow('Armor Class', esc(typeof r.ac==='object'?(r.ac[0]?.ac||r.ac):String(r.ac)));
  if (r.hp != null) html += _statRow('Hit Points', esc(typeof r.hp==='object'?(r.hp.hp||r.hp.average||r.hp.formula||''):String(r.hp)));
  if (Array.isArray(r.terrain) && r.terrain.length) html += _statRow('Terrain', esc(r.terrain.join(', ')));
  if (Array.isArray(r.immune) && r.immune.length) html += _statRow('Damage Immunities', esc(r.immune.map(i=>typeof i==='string'?i:i.immune?.join('/')||'').filter(Boolean).join(', ')));
  html += '</div>';
  html += renderEntriesText(d.desc || '');
  return html;
}

function renderFeatFull(d) {
  const r = d._raw || {};
  const desc = Array.isArray(r.desc) ? r.desc.join('\n\n') : (r.desc || d.desc || '');
  let html = '';
  if (r.prerequisite) html += `<div class="detail-section"><strong class="detail-label">Prerequisite.</strong> ${esc(r.prerequisite)}</div>`;
  html += renderEntriesText(desc);
  return html;
}

// Strip 5etools `{@tag arg}` wrappers to plain text. Used when rendering
// classTableGroups headers/cells where the full hyperlink machinery isn't
// worth the complexity for the small subset of tags that appear.
// NOTE: Named distinctly to avoid shadowing data-loader.js's _stripTags
// (which is the proper, full-featured version used by _parseEntries).
function _stripTagsTable(s) {
  return String(s || '').replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, '$1').replace(/\{@[^}]*\}/g, '');
}

// Compute proficiency bonus for a level (5e RAW: +2 at L1, +1 every 4 levels).
function _profBonus(lvl) { return 2 + Math.floor((lvl - 1) / 4); }

// Render the class progression table from r.classTableGroups[]. Output is
// one wide table: Level | Prof Bonus | Features | (group columns…).
// Features column is computed from _resolvedFeatures: feature names at that level joined.
function _renderClassTable(r, resolvedFeatures) {
  const groups = Array.isArray(r.classTableGroups) ? r.classTableGroups : [];
  // Group features by level (no ASI placeholder rows — they're already in the
  // 5etools data so no need to skip).
  const featuresByLevel = {};
  (resolvedFeatures || []).forEach(f => {
    if (!f.level) return;
    if (!featuresByLevel[f.level]) featuresByLevel[f.level] = [];
    featuresByLevel[f.level].push(f.name);
  });

  // Compose column headers
  const headers = ['Level', 'Prof. Bonus', 'Features'];
  const groupHeaderCols = [];
  groups.forEach(g => {
    if (Array.isArray(g.colLabels)) {
      g.colLabels.forEach(lbl => groupHeaderCols.push(_stripTagsTable(lbl)));
    } else if (g.rowsSpellProgression) {
      // Spell progression grid: header per slot level (1st, 2nd, …)
      const cols = (g.rowsSpellProgression[0] || []).length;
      for (let i = 0; i < cols; i++) groupHeaderCols.push(['1st','2nd','3rd','4th','5th','6th','7th','8th','9th'][i] || '');
    }
  });
  headers.push(...groupHeaderCols);

  let html = '<div class="detail-section" style="overflow-x:auto"><table class="detail-table">';
  html += '<thead><tr>' + headers.map(h => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>';

  for (let lvl = 1; lvl <= 20; lvl++) {
    const cells = [String(lvl), '+'+_profBonus(lvl)];
    cells.push((featuresByLevel[lvl] || ['—']).join(', '));
    groups.forEach(g => {
      if (Array.isArray(g.rows) && g.rows[lvl-1]) {
        const row = g.rows[lvl-1];
        row.forEach(cell => {
          if (cell && typeof cell === 'object') {
            // {type:"bonus", value:N} or {type:"dice", toRoll:[{number,faces}]}
            if (cell.type === 'bonus') cells.push((cell.value>=0?'+':'')+cell.value);
            else if (cell.type === 'bonusSpeed') cells.push('+'+cell.value+' ft.');
            else if (cell.type === 'dice' && Array.isArray(cell.toRoll)) {
              cells.push(cell.toRoll.map(r => `${r.number}d${r.faces}`).join('+'));
            } else cells.push(_stripTagsTable(cell.entry || cell.value || ''));
          } else {
            cells.push(_stripTagsTable(String(cell ?? '')));
          }
        });
      } else if (Array.isArray(g.rowsSpellProgression) && g.rowsSpellProgression[lvl-1]) {
        const row = g.rowsSpellProgression[lvl-1];
        row.forEach(n => cells.push(n > 0 ? String(n) : '—'));
      }
    });
    html += '<tr>' + cells.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

// Render the per-level feature descriptions list. One <h3> per feature, with
// the full entries text below.
function _renderFeatureList(resolvedFeatures) {
  if (!Array.isArray(resolvedFeatures) || !resolvedFeatures.length) return '';
  let html = '<h3 class="detail-header">Features</h3>';
  // Group by level for readability.
  const byLvl = {};
  resolvedFeatures.forEach(f => {
    if (!byLvl[f.level]) byLvl[f.level] = [];
    byLvl[f.level].push(f);
  });
  Object.keys(byLvl).map(n=>parseInt(n)).sort((a,b)=>a-b).forEach(lvl => {
    html += `<div class="detail-section" style="font-weight:600;color:var(--accent);margin-top:12px">Level ${lvl}</div>`;
    byLvl[lvl].forEach(f => {
      html += `<div class="detail-section"><strong class="detail-label">${esc(f.name)}.</strong> `;
      const text = _parseEntries_local(f.entries || []);
      html += renderEntriesText(text);
      html += '</div>';
    });
  });
  return html;
}

// Class detail: hit die, saving-throw proficiencies, starting proficiencies
// (armor/weapons/tools/skills), spellcasting ability, level progression
// table, then per-level feature descriptions, then the fluff text.
function renderClassFull(d) {
  const r = d._raw || {};
  let html = '<div class="detail-statblock">';
  const ABS = {str:'Strength',dex:'Dexterity',con:'Constitution',int:'Intelligence',wis:'Wisdom',cha:'Charisma'};
  const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : '';

  // Header stats grid
  const stats = [];
  if (r.hd) stats.push(['Hit Die', `d${r.hd.faces}` + (r.hd.number > 1 ? ` × ${r.hd.number}` : '')]);
  if (Array.isArray(r.proficiency) && r.proficiency.length){
    stats.push(['Saving Throws', r.proficiency.map(p => ABS[p]||cap(p)).join(', ')]);
  }
  if (r.spellcastingAbility) stats.push(['Spellcasting', ABS[r.spellcastingAbility] || cap(r.spellcastingAbility)]);
  if (r.casterProgression && !r.spellcastingAbility) stats.push(['Caster', cap(r.casterProgression)]);
  stats.forEach(([label, val]) => { html += _statRow(label, esc(String(val))); });

  // Starting proficiencies
  const sp = r.startingProficiencies;
  if (sp) {
    const _flat = arr => Array.isArray(arr) ? arr.map(x => typeof x === 'string'
      ? x.replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, '$1')
      : (x.proficiency || x.name || '')
    ).filter(Boolean) : [];
    const armor = _flat(sp.armor);
    const weapons = _flat(sp.weapons);
    const tools = _flat(sp.tools);
    if (armor.length) html += _statRow('Armor', esc(armor.join(', ')));
    if (weapons.length) html += _statRow('Weapons', esc(weapons.join(', ')));
    if (tools.length) html += _statRow('Tools', esc(tools.join(', ')));
    // Skills: choose N from list, or "any"
    if (Array.isArray(sp.skills) && sp.skills.length) {
      const sk = sp.skills[0];
      let txt = '';
      if (sk && sk.choose && sk.choose.from) {
        const n = sk.choose.count || 2;
        const from = Array.isArray(sk.choose.from) ? sk.choose.from.map(cap).join(', ') : '';
        txt = `Choose ${n} from ${from}`;
      } else if (sk && sk.any) {
        txt = `Choose ${sk.any} any skills`;
      }
      if (txt) html += _statRow('Skills', esc(txt));
    }
  }

  html += '</div>';

  // Fluff description (loaded from data/class/fluff-class-*.json into d.desc).
  if (d.desc) html += renderEntriesText(d.desc);

  // Level progression table — built from r.classTableGroups + resolved features.
  if (Array.isArray(r.classTableGroups) && r.classTableGroups.length){
    html += '<h3 class="detail-header">Class Progression</h3>';
    html += _renderClassTable(r, r._resolvedFeatures);
  }

  // Per-level feature descriptions.
  html += _renderFeatureList(r._resolvedFeatures);

  if (!d.desc && (!r._resolvedFeatures || !r._resolvedFeatures.length) && !r.classTableGroups){
    html += '<div class="detail-section" style="color:var(--text-muted);font-style:italic">No description available.</div>';
  }
  return html;
}

// Subclass detail: header + per-level feature list. Subclass fluff doesn't
// carry feature text, so this is built entirely from r._resolvedFeatures
// (populated at load time in data-loader.js).
function renderSubclassFull(d) {
  const r = d._raw || {};
  let html = '';
  // Subclass intro line — Source · Class
  const parent = r.className || '';
  if (parent) {
    html += `<div class="detail-statblock"><div class="detail-statrow" style="font-style:italic;color:var(--text-muted)">${esc(parent)} subclass</div></div>`;
  }
  if (Array.isArray(r._resolvedFeatures) && r._resolvedFeatures.length){
    html += _renderFeatureList(r._resolvedFeatures);
  } else if (d.desc) {
    html += renderEntriesText(d.desc);
  } else {
    html += '<div class="detail-section" style="color:var(--text-muted);font-style:italic">No description available.</div>';
  }
  return html;
}

function renderConditionFull(d) {
  const r = d._raw || {};
  const descs = Array.isArray(r.desc) ? r.desc.map(p=>typeof p==='string'?p:(p.desc||'')) : (d.desc?[d.desc]:[]);
  return renderEntriesText(descs.join('\n\n')) || '<div class="detail-section" style="color:var(--text-muted);font-style:italic">No description available.</div>';
}

// Adventure detail: cover image (if installed), level range, storyline, published
// date, author, and a chapter-name list. Chapters are themselves searchable as
// their own entries so users can pull up the full text.
// UNREACHABLE as of 2026-07-28: the data loader no longer creates `adventure`
// or `chapter` rows (it used to fetch ~45 MB of adventure files to build rows
// that getSearchPool() then discarded unconditionally — see the note in
// data-loader.js). Adventures are browsed via the Adventures/Books panels,
// which fetch their own content. Kept only so that re-enabling adventure
// indexing doesn't require rewriting this renderer.
function renderAdventureFull(d) {
  const r = d._raw || {};
  const lvl = r.level && r.level.start
    ? `${r.level.start}${r.level.end!=null?'–'+r.level.end:''}`
    : '';
  const cover = r.cover && r.cover.path
    ? `<img class="detail-img" crossorigin="anonymous" src="${esc(assetUrl(r.cover.path))}" onerror="this.style.display='none'" alt="${esc(d.name)} cover">`
    : '';
  const stat = (label, val) => val
    ? `<div class="stat-block"><div class="lab">${label}</div><div class="val">${esc(String(val))}</div></div>`
    : '';
  let html = cover + '<div class="detail-stats">'
    + stat('Levels',   lvl)
    + stat('Storyline', r.storyline)
    + stat('Published', r.published)
    + '</div>';
  if (r.author) html += `<div class="detail-section"><strong>Author.</strong> ${esc(Array.isArray(r.author)?r.author.join(', '):r.author)}</div>`;
  if (Array.isArray(r._chapters) && r._chapters.length) {
    html += '<div class="detail-section"><strong>Chapters.</strong><ul style="margin:6px 0 0 0;padding-left:20px;line-height:1.7">'
      + r._chapters.map(c => `<li>${esc(c)}</li>`).join('')
      + '</ul></div>';
  }
  return html;
}

// Fallback renderer for any reference entry (background, race, deity, etc.)
function renderRefFull(d) {
  const text = d.desc || '';
  const html = renderEntriesText(text);
  return html || '<div class="detail-section" style="color:var(--text-muted);font-style:italic">No description available.</div>';
}

// Tables ship with caption + colLabels + rows[], not free-text entries, so the
// generic renderRefFull would always say "No description available." This
// renderer pulls those fields and emits a real <table>. Cell strings can carry
// 5etools inline tags ({@item ...}, {@damage ...}) — strip them via esc()
// after running them through _strip if available; the loader's _stripTags is
// not in scope here, so we do a light regex inline.
function _stripCell(s) {
  if (typeof s !== 'string') {
    if (s && typeof s === 'object' && s.roll && s.roll.exact != null) return String(s.roll.exact);
    if (s && typeof s === 'object' && s.roll && s.roll.min != null) return s.roll.min + '–' + s.roll.max;
    return '';
  }
  return s
    .replace(/\{@(?:b|bold|i|italic|s|strike|u|sup|sub|kbd|code)\s+([^}]+)\}/g, '$1')
    .replace(/\{@(?:damage|dice|scaledice|scaledamage|chance|hit|dc)\s+([^|}]+)[^}]*\}/g, '$1')
    .replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, '$1')
    .replace(/\{@[^}]*\}/g, '');
}
function renderTableFull(d) {
  const r = d._raw || {};
  const caption = r.caption || '';
  const cols = Array.isArray(r.colLabels) ? r.colLabels : [];
  const rows = Array.isArray(r.rows) ? r.rows : [];
  if (!cols.length && !rows.length) {
    // Some tables are just a wrapper around `entries[]` text — fall back to ref.
    return renderRefFull(d);
  }
  let html = '';
  if (caption) html += `<div class="detail-section" style="font-style:italic;color:var(--text-muted)">${esc(caption)}</div>`;
  html += '<div class="detail-section" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
  if (cols.length) {
    html += '<thead><tr>' + cols.map(c => `<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:500">${esc(_stripCell(c))}</th>`).join('') + '</tr></thead>';
  }
  html += '<tbody>' + rows.map(row => {
    const cells = Array.isArray(row) ? row : [row];
    return '<tr>' + cells.map(c => `<td style="padding:4px 6px;border-bottom:1px solid var(--panel-3);vertical-align:top">${esc(_stripCell(c))}</td>`).join('') + '</tr>';
  }).join('') + '</tbody></table></div>';
  return html;
}

// Format a 5etools source code for display:
//   XPHB / XDMG / XMM  →  24PHB / 24DMG / 24MM   (2024 core reprints)
//   PHB / DMG / MM      →  14PHB / 14DMG / 14MM   (2014 originals)
// Everything else (XGE, MTF, CoS, SKT, …) passes through untouched.
const _CORE_2014 = new Set(['PHB','DMG','MM']);
const _CORE_2024 = new Set(['XPHB','XDMG','XMM']);
function _formatSource(src) {
  if (!src) return '';
  const u = String(src).toUpperCase();
  if (_CORE_2024.has(u)) return '24' + u.slice(1);
  if (_CORE_2014.has(u)) return '14' + u;
  return src;
}

// Convert inline markers in already-esc()'d text to HTML (italic/bold/labels).
// Block markers (\x01 \x02 \x03 \x07) are handled at the paragraph level.
function _renderInline(s) {
  return s
    .replace(/\x06([^\x06]+)\x06/g, '<strong>$1</strong>')
    .replace(/\x05([^\x05]+)\x05/g, '<i>$1</i>')
    .replace(/\x04([^\x04]+)\x04/g, '<strong class="detail-label">$1.</strong>');
}

// Render a fenced table emitted by _parseEntries (\x07JSON\x07).
function _renderEmbeddedTable(json) {
  let t; try { t = JSON.parse(json); } catch (_) { return ''; }
  let html = '<div class="detail-section" style="overflow-x:auto"><table class="detail-table">';
  if (t.caption) html += `<caption>${_renderInline(esc(t.caption))}</caption>`;
  if (t.cols && t.cols.length) {
    html += '<thead><tr>' + t.cols.map(c => `<th>${_renderInline(esc(c))}</th>`).join('') + '</tr></thead>';
  }
  if (t.rows && t.rows.length) {
    html += '<tbody>' + t.rows.map(r =>
      '<tr>' + r.map(c => `<td>${_renderInline(esc(c))}</td>`).join('') + '</tr>'
    ).join('') + '</tbody>';
  }
  return html + '</table></div>';
}

// Split a flat _parseEntries string into rendered HTML, handling section
// headers, inset/quote blocks, embedded tables, and inline markers.
function renderEntriesText(text) {
  if (!text || !text.trim()) return '';
  // First, extract block markers (insets, quotes, tables) so they survive paragraph splitting.
  const blocks = [];
  text = text.replace(/\x07([\s\S]+?)\x07/g, (_, j) => {
    blocks.push({kind:'table', body:j});
    return '\x00B' + (blocks.length-1) + '\x00';
  });
  text = text.replace(/\x02([\s\S]+?)\x02/g, (_, b) => {
    blocks.push({kind:'inset', body:b});
    return '\x00B' + (blocks.length-1) + '\x00';
  });
  text = text.replace(/\x03([\s\S]+?)\x03/g, (_, b) => {
    blocks.push({kind:'quote', body:b});
    return '\x00B' + (blocks.length-1) + '\x00';
  });

  const out = [];
  text.split(/\n{2,}/).forEach(p => {
    p = p.trim();
    if (!p) return;
    if (p.startsWith('\x01')) {
      out.push(`<h3 class="detail-header">${esc(p.slice(1).trimEnd())}</h3>`);
      return;
    }
    const blk = p.match(/^\x00B(\d+)\x00$/);
    if (blk) {
      const b = blocks[+blk[1]];
      if (b.kind === 'table') out.push(_renderEmbeddedTable(b.body));
      else if (b.kind === 'inset') {
        out.push(`<div class="detail-inset">${_renderInline(esc(b.body)).replace(/\n/g,'<br>')}</div>`);
      } else if (b.kind === 'quote') {
        out.push(`<blockquote class="detail-quote">${_renderInline(esc(b.body)).replace(/\n/g,'<br>')}</blockquote>`);
      }
      return;
    }
    // Bullet list paragraph (single \n separated lines starting with •)
    if (p.split('\n').every(l => l.trim().startsWith('•'))) {
      const items = p.split('\n').map(l => l.replace(/^\s*•\s*/, '').trim()).filter(Boolean);
      out.push('<ul class="detail-list">' + items.map(i => `<li>${_renderInline(esc(i))}</li>`).join('') + '</ul>');
      return;
    }
    out.push(`<div class="detail-section">${_renderInline(esc(p)).replace(/\n/g,'<br>')}</div>`);
  });
  return out.join('');
}

// Spell link click from monster detail — find in local data
function searchForSpell(slug) {
  const match = _5eData.find(d => d.cat==='spell' && d._slug===slug);
  if (match) { state.searchState.detail = match; renderSearchResults(); }
}

// Memoized search pool. Rebuilding this array meant walking all ~16k rows with
// 1-2 .filter() passes and a fresh spread — and it was called up to 4× per
// keystroke (doSearch, renderSearchTabs, and twice more inside the fuzzy
// branch). Now it's built once and reused until something it depends on
// actually changes.
//
// The signature deliberately covers ONLY the fields the pool derives from.
// Party rows hold `partyData: p` (a live object reference), so HP ticks and
// other stat edits stay visible without invalidating the cache — only a
// rename / add / remove / notes-first-line change rebuilds it.
let _poolCache = null;   // {sig, arr, visible, visibleVer, byCat}
let _lastResults = [];   // last list produced by renderSearchResults, reused by keydown nav
// How many rows doSearch() matched BEFORE the 80-row cap. "dragon" matches 738
// and always did; showing 80 of them with no indication read as "that's all
// there is", so a DM narrowing a search had no idea there was anything to
// narrow. Set on every doSearch(), read by the renderer.
const SEARCH_LIMIT = 80;
let _lastTotal = 0;

function _poolSig(){
  const party = state.party.map(p => p.id + ':' + p.name + ':' + ((p.notes||'').split('\n')[0]||'')).join('|');
  return (_5eLoaded ? 'L' : 'S')
    + '|' + (state.settings?.reprintPolicy || 'all')
    + '|' + party;
}

function _buildPool(){
  const party = state.party.map(p=>{
    const row = {cat:'party',name:p.name,meta:(p.notes||'').split('\n')[0]||'Party member',partyData:p};
    // Party rows are built here rather than by the data loader, so they need
    // their normalized search fields computed too (≤10 rows — trivial).
    row._n = _normSearch(row.name);
    row._h = row._n + ' ' + _normSearch(row.meta || '');
    return row;
  });
  // Use 5etools data once loaded, otherwise fall back to built-in SEARCH_DATA
  let base = _5eLoaded ? _5eData : SEARCH_DATA;
  const policy = state.settings?.reprintPolicy || 'all';
  if (policy === 'hide-legacy')   base = base.filter(r => !_isLegacyEntry(r));
  else if (policy === 'hide-reprints') base = base.filter(r => !_isReprintEntry(r));
  // Adventures + their chapters are no longer in search — they have their
  // own dedicated panel (Adventures 📖) with a chapter-tree browser. (The
  // data loader no longer produces those rows at all; this filter remains as
  // a cheap guard for the static SEARCH_DATA fallback.)
  base = base.filter(r => r.cat !== 'adventure' && r.cat !== 'chapter');
  return [...party, ...base];
}

function getSearchPool(){
  const sig = _poolSig();
  if (_poolCache && _poolCache.sig === sig) return _poolCache.arr;
  _poolCache = { sig, arr: _buildPool(), visible: null, visibleVer: -1, byCat: null };
  return _poolCache.arr;
}

// Pool with the hidden-sources filter applied. Kept SEPARATE from the base
// pool on purpose: renderSearchTabs() counts against the unfiltered pool while
// doSearch() returns filtered results, so tab counts can exceed the result
// count when sources are hidden. That asymmetry predates this change — it is
// preserved here rather than silently "fixed" during a performance pass.
function _getVisiblePool(){
  const arr = getSearchPool();
  if (typeof window.SKT_IS_SOURCE_HIDDEN !== 'function') return arr;
  const ver = window.SKT_SOURCE_FILTER_VERSION || 0;
  if (_poolCache.visible && _poolCache.visibleVer === ver) return _poolCache.visible;
  _poolCache.visible = arr.filter(r => !window.SKT_IS_SOURCE_HIDDEN('search', r._source));
  _poolCache.visibleVer = ver;
  return _poolCache.visible;
}

// Tab category can be 'all', a single cat string, or a comma-joined list
// (e.g. 'cult,boon') for tabs that union multiple cats. _catMatches centralizes
// the comparison so doSearch and renderSearchTabs stay consistent.
function _catMatches(cat, sel) {
  if (sel === 'all') return true;
  if (sel.indexOf(',') >= 0) return sel.split(',').includes(cat);
  return cat === sel;
}

// Normalize a string for fuzzy matching: lowercase, collapse all non-alphanumeric
// runs (spaces, hyphens, apostrophes, slashes, punctuation) to a single space.
// So "All-Purpose Tool", "all purpose tool", and "all  purpose  tool" all match.
function _normSearch(s) {
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

// Damerau-Levenshtein (OSA variant) — counts a transposition of two
// adjacent characters as a single edit, on top of standard insert/
// delete/substitute. Catches finger-fumble typos like "fyer" → "fire"
// or "drangon" → "dragon" with a low distance threshold. Used only on
// the fuzzy-fallback path so exact substring matches always win.
function _editDistance(a, b){
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = [];
  for (let i = 0; i <= m; i++){ dp[i] = new Array(n + 1); dp[i][0] = i; }
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++){
    for (let j = 1; j <= n; j++){
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,           // delete
        dp[i][j-1] + 1,           // insert
        dp[i-1][j-1] + cost       // substitute (or match)
      );
      // Adjacent transposition (OSA)
      if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]){
        dp[i][j] = Math.min(dp[i][j], dp[i-2][j-2] + 1);
      }
    }
  }
  return dp[m][n];
}

function doSearch(){
  const qRaw=(state.searchState.query||'').trim().toLowerCase();
  const q=_normSearch(qRaw);
  // Hidden-sources filter — books/adventures the user has × off are excluded
  // when the Search consumer scope is enabled (defaults on; the user can
  // turn it off in the Books panel's "Filter applies to" toggle row).
  // Both this and the base pool are memoized; see _getVisiblePool().
  let pool=_getVisiblePool();
  const sel=state.searchState.category;
  if(sel!=='all')pool=pool.filter(r=>_catMatches(r.cat, sel));
  if(q){
    // Multi-token: every whitespace-separated token must appear somewhere in
    // the normalized name or meta, in any order. So "giant frost" and
    // "frost gia" both find "Frost Giant".
    //
    // Tokens match as SUBSTRINGS, not subsequences — "frost gnt" finds
    // nothing. (An earlier version of this comment claimed otherwise; the
    // code never did it.) Substring matching is the deliberate choice:
    // subsequence matching would make "gnt" also hit "aGeNT", "arGeNTum",
    // "puNGeNT"… and drown the short queries people actually type.
    //
    // `_h` is the precomputed haystack (name + meta + item variant names)
    // built once by the data loader — no per-row regex work here.
    const tokens = q.split(' ').filter(Boolean);
    const nTok = tokens.length;
    pool = pool.filter(r => {
      const hay = r._h || (r._n = _normSearch(r.name), r._h = r._n + ' ' + _normSearch(r.meta||''));
      for (let i = 0; i < nTok; i++) if (hay.indexOf(tokens[i]) === -1) return false;
      return true;
    });
    pool.sort((a,b) => {
      const aStarts = (a._n || '').startsWith(q) ? 0 : 1;
      const bStarts = (b._n || '').startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    });
    // Fuzzy fallback — only kicks in for single-token queries of 3+ chars
    // when strict results are thin. Compares the query against each word
    // of every candidate's name with Damerau-Levenshtein, keeps anything
    // within a small threshold, and appends those at the end so exact
    // matches always lead. Marked with `_fuzzy:true` for renderer styling.
    if (tokens.length === 1 && q.length >= 3 && pool.length < 5){
      const maxDist = q.length <= 3 ? 1 : 2;
      const seen = new Set(pool.map(r => r.name + '|' + (r._source||'')));
      // The VISIBLE pool, same as the strict path above. This used to be the
      // base pool, with a note deferring the question as "a behavior decision,
      // not a perf one" — so it got measured: with MM hidden, "dragon"
      // correctly returned nothing from MM, but the typo "drangon" surfaced
      // MM's Dragon Turtle. Hiding a source and then having a fumbled
      // keystroke reveal it is not a defensible behaviour, so it is decided.
      const basePool = _getVisiblePool();
      const fullPool = (sel === 'all')
        ? basePool
        : basePool.filter(r => _catMatches(r.cat, sel));
      const candidates = [];
      for (const r of fullPool){
        const key = r.name + '|' + (r._source||'');
        if (seen.has(key)) continue;
        const name = r._n || _normSearch(r.name);
        if (!name) continue;
        // Cheap early-out on overall length difference.
        if (Math.abs(name.length - q.length) > maxDist + 4) continue;
        // Match against individual words in the name so multi-word names
        // can still hit a single-word typo ("dragn" → "Red Dragon").
        const words = name.split(/\s+/);
        let best = Infinity;
        for (const w of words){
          if (Math.abs(w.length - q.length) > maxDist) continue;
          const d = _editDistance(w, q);
          if (d < best){ best = d; if (best === 0) break; }
        }
        if (best <= maxDist){
          candidates.push({ r, dist: best });
        }
      }
      candidates.sort((a, b) => a.dist - b.dist || a.r.name.localeCompare(b.r.name));
      const room = 80 - pool.length;
      if (room > 0){
        pool = pool.concat(candidates.slice(0, room).map(c => Object.assign({ _fuzzy:true }, c.r)));
      }
    }
  }else pool.sort((a,b)=>a.name.localeCompare(b.name));
  _lastTotal = pool.length;
  return pool.slice(0, SEARCH_LIMIT);
}


function renderSearchTabs(){
  const pool=getSearchPool();
  const labels={all:'All',monster:'Monsters',spell:'Spells',item:'Items',condition:'Conditions',
    feat:'Feats',background:'Backgrounds',race:'Races',class:'Classes',party:'Party',
    action:'Actions',facility:'Bastions',deity:'Deities',language:'Languages',
    reward:'Gifts & Rewards',psionic:'Psionics',vehicle:'Vehicles',adventure:'Adventures',
    'cult,boon':'Cults & Boons',object:'Objects','trap,hazard':'Traps & Hazards'};
  const sel=state.searchState.category;
  let activeIsSecondary=false;
  // Count every category in ONE pass and memoize onto the pool cache. This
  // used to run pool.filter() once per tab — 21 tabs × 16k rows ≈ 340k
  // iterations plus 21 throwaway arrays on every single render.
  if (_poolCache && !_poolCache.byCat){
    const c = Object.create(null);
    for (let i = 0; i < pool.length; i++){ const k = pool[i].cat; c[k] = (c[k]||0) + 1; }
    _poolCache.byCat = c;
  }
  const byCat = (_poolCache && _poolCache.byCat) || Object.create(null);
  // Tab labels can be comma-joined multi-category (e.g. 'trap,hazard').
  const countFor = cat => cat === 'all'
    ? pool.length
    : (cat.indexOf(',') >= 0
        ? cat.split(',').reduce((a,k) => a + (byCat[k]||0), 0)
        : (byCat[cat]||0));
  document.querySelectorAll('#search-tabs .search-tab').forEach(tab=>{
    if(tab.classList.contains('more-toggle'))return; // handled separately below
    const cat=tab.dataset.cats||tab.dataset.cat;
    const count=countFor(cat);
    tab.innerHTML=`${labels[cat]||cat} <span class="count">${count}</span>`;
    const isActive=sel===cat;
    tab.classList.toggle('active',isActive);
    if(isActive && tab.classList.contains('secondary'))activeIsSecondary=true;
  });
  // Highlight the More toggle when its hidden contents include the active cat.
  // Note: the More section's expanded state is now controlled solely by the
  // user clicking the toggle (and openSearch() opens it once if a secondary
  // is active). Re-running renderSearchTabs after a user collapse used to
  // reopen it via the auto-expand line that lived here — gone now.
  const moreBtn=document.getElementById('search-more-toggle');
  if(moreBtn)moreBtn.classList.toggle('has-active-secondary', activeIsSecondary);
}

// Wrap every case-insensitive occurrence of `q` inside `text` with <mark>.
// Operates on already-escaped HTML so it's safe to inject. Empty query →
// returns the input unchanged.
// Highlight `q` inside RAW text, escaping as it goes. Takes raw rather than
// pre-escaped text on purpose: matching over already-escaped HTML meant a query
// could land inside an entity, and "amp" rendered `Bag of Devouring &<mark>amp
// </mark>; Co` — which the browser then showed as a literal "&amp;". Same for
// "quot" against a quoted name and "#39" against every apostrophe. Never an
// injection (the replacement re-inserted escaped text), but visibly wrong.
// Splitting on the match and escaping each side keeps entities intact.
function _highlightMatch(rawText, q){
  const text = String(rawText == null ? '' : rawText);
  if (!q) return esc(text);
  // Escape regex specials so user input can't break the pattern.
  const safe = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re;
  try { re = new RegExp(safe, 'gi'); } catch(e){ return esc(text); }
  let out = '', last = 0, m;
  while ((m = re.exec(text)) !== null){
    // A zero-length match would spin forever; nothing produces one today, but
    // the loop must not depend on that.
    if (!m[0]){ re.lastIndex++; continue; }
    out += esc(text.slice(last, m.index)) + '<mark class="search-hit">' + esc(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

// Recent-searches helpers. Backed by localStorage so the strip survives
// reloads. Capped at 8 so the chip row stays compact.
const _RECENT_KEY = 'skt-search-recent-v1';
function _searchGetRecent(){
  try { return JSON.parse(localStorage.getItem(_RECENT_KEY) || '[]') || []; }
  catch(e){ return []; }
}
function _searchSaveRecent(q){
  q = (q||'').trim(); if (!q || q.length < 2) return;
  let cur = _searchGetRecent().filter(x => x.toLowerCase() !== q.toLowerCase());
  cur.unshift(q);
  if (cur.length > 8) cur = cur.slice(0, 8);
  try { localStorage.setItem(_RECENT_KEY, JSON.stringify(cur)); } catch(e){}
}
function _searchClearRecent(){
  try { localStorage.removeItem(_RECENT_KEY); } catch(e){}
}

function renderSearchResults(){
  const container=document.getElementById('search-results');
  if(state.searchState.detail){renderSearchDetail();return;}
  const results=doSearch();
  _lastResults = results;   // reused by the keydown nav handler — see below
  const q=(state.searchState.query||'').trim();

  if(!results.length && !q){
    const hint = !_5eLoaded
      ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px">Loading 5etools data…</div>'
      : '';
    const recent = _searchGetRecent();
    const recentHtml = recent.length
      ? `<div class="search-recent">
          <div class="search-recent-head">Recent searches
            <button class="search-recent-clear" data-act="clear-recent" title="Clear recent searches">clear</button>
          </div>
          <div class="search-recent-pills">${recent.map(r => `<button class="search-recent-pill" data-recent="${esc(r)}">${esc(r)}</button>`).join('')}</div>
        </div>`
      : '';
    container.innerHTML=`<div class="search-empty">Type to search monsters, spells, items, conditions, or your party.${hint}</div>${recentHtml}`;
    // Wire recent pills + clear
    container.querySelectorAll('[data-recent]').forEach(btn => btn.addEventListener('click', () => {
      const inp = document.getElementById('search-input');
      if (inp){ inp.value = btn.dataset.recent; state.searchState.query = btn.dataset.recent; renderSearchResults(); inp.focus(); }
    }));
    container.querySelector('[data-act="clear-recent"]')?.addEventListener('click', () => {
      _searchClearRecent(); renderSearchResults();
    });
    return;
  }
  if(!results.length){
    const hint = !_5eLoaded ? ' <span style="font-size:11px;color:var(--text-dim)">(data still loading…)</span>' : '';
    container.innerHTML=`<div class="search-empty">No results for "${esc(q)}"${hint}</div>`;
    return;
  }

  container.innerHTML = results.map((r,i)=>`
    <div class="search-result ${i===state.searchState.focused?'focused':''} ${r._fuzzy?'fuzzy':''}" data-idx="${i}">
      <div class="res-name">
        <span>${_highlightMatch(r.name, q)}</span>
        <div style="display:flex;gap:5px;align-items:center;flex-shrink:0">
          ${r._fuzzy?'<span class="res-fuzzy" title="Approximate match — your query didn\'t exactly match this entry">~</span>':''}
          ${r._source?`<span style="font-size:9px;color:var(--text-dim);padding:1px 4px;background:var(--panel-3);border-radius:3px">${esc(_formatSource(r._source))}</span>`:''}
          <span class="res-tag ${r.cat}">${r.cat}</span>
        </div>
      </div>
      <div class="res-meta">${_highlightMatch(r.meta||'', q)}</div>
    </div>`).join('')
    + (_lastTotal > results.length
        ? `<div class="search-more">Showing ${results.length} of ${_lastTotal} matches — keep typing to narrow it down.</div>`
        : '');
  container.querySelectorAll('.search-result').forEach((el,i)=>el.addEventListener('click', e => {
    e.stopPropagation();
    state.searchState.detail=results[i];
    // Commit this query to the recent-searches list since the user just
    // committed to a specific result.
    _searchSaveRecent(state.searchState.query);
    renderSearchResults();
  }));
}

// <img> tag for an entry's hero image. Sources only the local 5etools image
// pack — no remote fallback. Monster fluff stores paths relative to img/
// (e.g. "bestiary/MM/Goblin.webp"), while the per-category fluff loader
// already prefixes 'img/' when populating _img on non-monster rows. If no
// local image exists, render nothing.
function _detailImgTag(d) {
  if (!d._img) return '';
  if (d.cat === 'monster'){
    // Prefer the token image (head-shot, cropped) over the full creature art.
    // bestiaryPortraitPath picks whichever actually exists (see utils.js —
    // 10% of monsters have no token crop). Keep the onerror chain anyway for
    // art the index doesn't know about, then hide if neither loads.
    const token = assetUrl(bestiaryPortraitPath(d._img));
    const full  = assetUrl(d._img);
    return `<img class="detail-img" crossorigin="anonymous" src="${esc(token)}" data-fb="${esc(full)}" alt="${esc(d.name)}" onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.removeAttribute('data-fb');}else{this.style.display='none';}">`;
  }
  // Non-monster `_img` already carries the img/ prefix (see data-loader);
  // assetUrl normalizes either form.
  return `<img class="detail-img" crossorigin="anonymous" src="${esc(assetUrl(d._img))}" onerror="this.style.display='none'" alt="${esc(d.name)}">`;
}

// Builds just the inner stat-block / description HTML for any search entry.
// Reused by both the in-popup detail view and the popped-out floating window.
function buildDetailBody(d) {
  const isMonster=d.cat==='monster', isSpell=d.cat==='spell', isItem=d.cat==='item', isCond=d.cat==='condition', isFeat=d.cat==='feat', isParty=d.cat==='party';
  if (isParty) {
    const p=d.partyData;
    return '<div class="detail-stats">'
      +'<div class="stat-block"><div class="lab">HP</div><div class="val">'+p.hp+'/'+p.hpMax+'</div></div>'
      +'<div class="stat-block"><div class="lab">AC</div><div class="val">'+p.ac+'</div></div>'
      +'<div class="stat-block"><div class="lab">Init</div><div class="val">'+(p.init>=0?'+':'')+p.init+'</div></div>'
      +'</div>'
      +'<div class="detail-section"><strong>Speed.</strong> '+p.spd+' ft &nbsp;<strong>PP.</strong> '+p.pp+' &nbsp;<strong>GP.</strong> '+p.gp+'</div>'
      +(p.notes?'<div class="detail-section"><strong>Notes.</strong> '+esc(p.notes)+'</div>':'')
      +(p.inspiration?'<div class="detail-section" style="color:var(--warning)">★ Has inspiration</div>':'');
  }
  if (d._raw) {
    if(isMonster) return renderMonsterFull(d, d);
    if(isSpell)   return renderSpellFull(d);
    if(isItem)    return renderItemFull(d);
    if(isCond)    return renderConditionFull(d);
    if(isFeat)    return renderFeatFull(d);
    if(d.cat==='adventure') return renderAdventureFull(d);
    if(d.cat==='table')     return renderTableFull(d);
    if(d.cat==='psionic')   return renderPsionicFull(d);
    if(d.cat==='vehicle')   return renderVehicleFull(d);
    if(d.cat==='deity')     return renderDeityFull(d);
    if(d.cat==='race')      return renderRaceFull(d);
    if(d.cat==='background')return renderBackgroundFull(d);
    if(d.cat==='object')    return renderObjectFull(d);
    if(d.cat==='facility')  return renderFacilityFull(d);
    if(d.cat==='language')  return renderLanguageFull(d);
    if(d.cat==='skill')     return renderSkillFull(d);
    if(d.cat==='class') {
      // Subclasses have classSource + subclassFeatures; classes have classFeatures.
      const r = d._raw || {};
      if (r.subclassFeatures || r.classSource) return renderSubclassFull(d);
      return renderClassFull(d);
    }
    // All the long-tail reference categories (background, race, class, deity,
    // object, vehicle, action, skill, chapter, etc.) share a generic
    // entries→paragraphs render.
    return renderRefFull(d);
  }
  // Fallback for old SEARCH_DATA entries without _raw
  if(isMonster){
    let html=`<div class="detail-stats"><div class="stat-block"><div class="lab">HP</div><div class="val">${d.hp||'?'}</div></div><div class="stat-block"><div class="lab">AC</div><div class="val">${d.ac||'?'}</div></div><div class="stat-block"><div class="lab">Speed</div><div class="val">${esc(d.speed||'—')}</div></div></div>`;
    if(d.str){const ab=(l,s)=>`<div class="ability"><div class="ab-name">${l}</div><div class="ab-val">${s}</div><div class="ab-mod">${mod(s)>=0?'+':''}${mod(s)}</div></div>`;html+=`<div class="ability-grid">${ab('STR',d.str)}${ab('DEX',d.dex)}${ab('CON',d.con)}${ab('INT',d.int)}${ab('WIS',d.wis)}${ab('CHA',d.cha)}</div>`;}
    return html;
  }
  return `<div class="detail-section">${esc(d.desc||d.cast||'')}</div>`;
}

// Build the full detail card HTML (header + meta + image + body + action buttons).
// idSuffix lets multiple instances coexist (search popup vs popped-out windows).
function buildDetailCard(d, idSuffix) {
  const isMonster=d.cat==='monster', isCond=d.cat==='condition', isParty=d.cat==='party';
  const srcBadge = d._source ? `<span style="font-size:9px;color:var(--text-dim);padding:1px 5px;background:var(--panel-3);border-radius:3px">${esc(_formatSource(d._source))}</span>` : '';
  let actionsHtml = '';
  if (!isParty) {
    actionsHtml = '<div class="detail-actions">';
    if(isMonster) actionsHtml+=`<button class="btn small primary" id="det-add-monster${idSuffix}">+ Add to combat</button>`;
    if(isCond)    actionsHtml+=`<button class="btn small primary" id="det-apply-cond${idSuffix}">+ Apply to active combatant</button>`;
    actionsHtml += '</div>';
  }
  return `<div class="search-detail">
    <div class="detail-title-row">
      <h4 class="detail-title">${esc(d.name)}</h4>
      ${d._source?`<span class="detail-source-badge">${esc(_formatSource(d._source))}</span>`:''}
    </div>
    <div class="detail-meta">${esc(d.meta||'')}</div>
    ${_detailImgTag(d)}
    <div>${buildDetailBody(d)}</div>
    ${_sourceFootHtml(d)}
    ${actionsHtml}
  </div>`;
}

// Bottom-of-card source citation, e.g. "Source: PHB'24, page 361".
function _sourceFootHtml(d) {
  const src = d._source || (d._raw && d._raw.source);
  if (!src) return '';
  const page = (d._raw && d._raw.page) || null;
  return `<div class="detail-source-foot"><strong>Source:</strong> <i>${esc(_formatSource(src))}</i>${page?`, page ${esc(String(page))}`:''}</div>`;
}

// Wire the action buttons inside a detail card. onAfterAction is called once
// the action succeeds (closes the search popup, but leaves popouts open).
function wireDetailActions(d, root, idSuffix, onAfterAction) {
  root.querySelector('#det-add-monster'+idSuffix)?.addEventListener('click',()=>{
    panelDefs.combat.addMonster(d);
    onAfterAction?.();
  });
  root.querySelector('#det-apply-cond'+idSuffix)?.addEventListener('click',()=>{
    if(panelDefs.combat.applyCondition(d.name)) onAfterAction?.();
  });
}

const _detailIcon = {monster:'⚔', spell:'✦', item:'📿', condition:'⚡', feat:'⭐', party:'☻'};

function popOutDetail(d) {
  const win = createFloatingWindow({
    title: d.name,
    icon: _detailIcon[d.cat] || '◇',
    w: 380, h: 500,
  });
  const suffix = '-pop-' + uid();
  win.body.innerHTML = buildDetailCard(d, suffix);
  win.body.style.padding = '12px';
  win.body.style.overflowY = 'auto';
  wireDetailActions(d, win.body, suffix, null /* keep popout open after action */);
  closeSearch();
}

function renderSearchDetail(){
  const container=document.getElementById('search-results');
  const d=state.searchState.detail;
  const suffix = '';

  container.innerHTML=`<div class="search-detail">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:10px">
      <button class="detail-back" id="detail-back">← Back</button>
      <button class="detail-back" id="detail-popout" title="Open in its own window">⧉ Pop out</button>
    </div>
    <div class="detail-title-row">
      <h4 class="detail-title">${esc(d.name)}</h4>
      ${d._source?`<span class="detail-source-badge">${esc(_formatSource(d._source))}</span>`:''}
    </div>
    <div class="detail-meta">${esc(d.meta||'')}</div>
    ${_detailImgTag(d)}
    <div id="detail-body">${buildDetailBody(d)}</div>
    ${_sourceFootHtml(d)}
    ${d.cat==='party' ? '' : (function(){
      let h='<div class="detail-actions">';
      if(d.cat==='monster')   h+=`<button class="btn small primary" id="det-add-monster${suffix}">+ Add to combat</button>`;
      if(d.cat==='condition') h+=`<button class="btn small primary" id="det-apply-cond${suffix}">+ Apply to active combatant</button>`;
      return h+'</div>';
    })()}
  </div>`;

  // Scroll back to the top so the detail view always starts at the title,
  // never at whatever position the user had scrolled the result list to.
  container.scrollTop = 0;

  document.getElementById('detail-back')?.addEventListener('click',()=>{state.searchState.detail=null;renderSearchResults();});
  document.getElementById('detail-popout')?.addEventListener('click',()=>popOutDetail(d));
  wireDetailActions(d, container, suffix, closeSearch);
}

function openSearch(){
  document.getElementById('search-wrap')?.classList.add('open');
  document.getElementById('search-popup').classList.add('open');
  state.searchState.detail=null;renderSearchTabs();renderSearchResults();
  // First-paint convenience: if the stored category lives in the More row,
  // expand it so the highlight is visible. After this point, the user's
  // toggle clicks are the only thing that opens/closes the row.
  const tabsRoot = document.getElementById('search-tabs');
  if (tabsRoot && tabsRoot.querySelector('.search-tab.secondary.active')){
    tabsRoot.classList.add('expanded');
  }
}
function closeSearch(){
  document.getElementById('search-popup').classList.remove('open');
  document.getElementById('search-wrap')?.classList.remove('open');
  state.searchState.detail=null;
  // Clear the previous query so re-opening the search starts blank.
  state.searchState.query='';
  state.searchState.focused=-1;
  const inp = document.getElementById('search-input');
  if (inp) inp.value='';
}
function initSearch(){
  // Start loading 5etools data in the background immediately
  load5eData();
  // When it finishes, refresh the open search popup if visible
  on5eLoaded(()=>{
    if(document.getElementById('search-popup')?.classList.contains('open')){renderSearchTabs();renderSearchResults();}
  });

  const inp=document.getElementById('search-input');
  inp.addEventListener('focus',openSearch);
  // Debounce result rendering — the search dataset can be 5k+ entries, and
  // re-rendering on every keystroke noticeably lags fast typists. 80ms keeps
  // the UI responsive (well under perception threshold) while collapsing a
  // 5-character burst into one render instead of five.
  let _searchInputTimer = null;
  inp.addEventListener('input',e=>{
    state.searchState.query=e.target.value;
    state.searchState.focused=-1;
    state.searchState.detail=null;
    if(!document.getElementById('search-popup').classList.contains('open'))openSearch();
    if (_searchInputTimer) clearTimeout(_searchInputTimer);
    _searchInputTimer = setTimeout(() => { _searchInputTimer = null; renderSearchResults(); }, 80);
  });
  // Nav keys only. This used to run a full doSearch() on EVERY keydown —
  // including plain characters — which completely defeated the 80ms input
  // debounce above and made each keystroke cost two full scans of the pool.
  // Navigation reuses the result list from the last render instead.
  const _NAV_KEYS = new Set(['Escape','ArrowDown','ArrowUp','Enter']);
  inp.addEventListener('keydown',e=>{
    if(!_NAV_KEYS.has(e.key)) return;   // typing: let the debounced input handler do the work
    if(e.key==='Escape'){
      if(state.searchState.detail){state.searchState.detail=null;renderSearchResults();}
      else{inp.blur();closeSearch();}
      return;
    }
    // Flush a pending debounce first — otherwise Enter/Arrow pressed within
    // 80ms of the last character would act on the PREVIOUS query's results.
    if(_searchInputTimer){
      clearTimeout(_searchInputTimer); _searchInputTimer = null;
      renderSearchResults();
    }
    const list=_lastResults;
    if(!list.length) return;
    if(e.key==='ArrowDown'){e.preventDefault();state.searchState.focused=Math.min(state.searchState.focused+1,list.length-1);renderSearchResults();document.querySelector('.search-result.focused')?.scrollIntoView({block:'nearest'});}
    else if(e.key==='ArrowUp'){e.preventDefault();state.searchState.focused=Math.max(state.searchState.focused-1,0);renderSearchResults();document.querySelector('.search-result.focused')?.scrollIntoView({block:'nearest'});}
    else if(e.key==='Enter'){const r=state.searchState.focused>=0?list[state.searchState.focused]:list[0];if(r){state.searchState.detail=r;_searchSaveRecent(state.searchState.query);renderSearchResults();}}
  });
  document.querySelectorAll('#search-tabs .search-tab').forEach(tab=>{
    if(tab.classList.contains('more-toggle'))return; // wired separately below
    tab.addEventListener('click',()=>{state.searchState.category=tab.dataset.cats||tab.dataset.cat;state.searchState.focused=-1;state.searchState.detail=null;renderSearchTabs();renderSearchResults();inp.focus();});
  });
  // The "More" button just toggles visibility of the secondary tab row — it
  // doesn't change the search category itself.
  document.getElementById('search-more-toggle')?.addEventListener('click', () => {
    document.getElementById('search-tabs').classList.toggle('expanded');
    inp.focus();
  });
  let _insideSearch = false;
  document.querySelector('.search-wrap').addEventListener('mousedown', () => { _insideSearch = true; });
  // The 🔎 toggle button on the floating toolbar opens (and focuses) the input.
  // Note: we DON'T `e.stopPropagation()` here. If we did, the document-level
  // mousedown handler below would never fire — meaning `_insideSearch` would
  // stay stuck at `true` after this click, and the next click outside the
  // search would (silently) skip the close and only reset the flag. The user
  // would then have to click off twice to actually close the search.
  document.getElementById('float-search-btn')?.addEventListener('mousedown', e => {
    _insideSearch = true;
    const wrap = document.getElementById('search-wrap');
    if (wrap?.classList.contains('open')) closeSearch();
    else { openSearch(); setTimeout(()=>inp.focus(), 50); }
  });
  document.addEventListener('mousedown', () => { if(!_insideSearch)closeSearch(); _insideSearch=false; });
  document.addEventListener('keydown',e=>{
    if(e.key!=='/') return;
    // Modifiers pass through. Ctrl+/ and Cmd+/ are "toggle comment" almost
    // everywhere else, and hijacking them to open a search box is startling.
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    const ae=document.activeElement;
    // isContentEditable, not just the three tag names. The NPC Library's notes
    // field is a contenteditable div (npc-library.js), so typing a slash
    // mid-sentence there used to open the search and yank focus out of what
    // the DM was writing. The ? help overlay already guarded this; search
    // didn't, which is what makes it an oversight rather than a decision.
    if(ae&&(ae.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(ae.tagName))) return;
    // A modal is a focus trap; opening search underneath one strands it.
    if(document.querySelector('.modal-backdrop')) return;
    e.preventDefault(); openSearch(); setTimeout(()=>inp.focus(), 50);
  });
}
