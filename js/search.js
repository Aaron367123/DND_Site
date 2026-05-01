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
  const ab=(l,s)=>`<div class="ability"><div class="ab-name">${l}</div><div class="ab-val">${s}</div><div class="ab-mod">${mod(s)>=0?'+':''}${mod(s)}</div></div>`;
  const section=(label,text)=>text?`<div class="detail-section"><strong>${label}.</strong> ${esc(text)}</div>`:'';
  const actions=(label,arr)=>{
    if(!arr||!arr.length)return'';
    const rows=arr.map(a=>'<em>'+esc(a.name||'')+'</em> '+esc(a.desc||'')).join('<br><br>');
    return'<div class="action-block"><strong>'+label+'.</strong><br>'+rows+'</div>';
  };
  let html = '';
  html += '<div class="detail-stats">'
    + '<div class="stat-block"><div class="lab">HP</div><div class="val">'+hp+(r.hit_dice?' ('+r.hit_dice+')':'')+'</div></div>'
    + '<div class="stat-block"><div class="lab">AC</div><div class="val">'+acVal+(acType?' ('+acType+')':'')+'</div></div>'
    + '<div class="stat-block"><div class="lab">Speed</div><div class="val">'+esc(speed)+'</div></div>'
    + '</div>';
  html += '<div class="ability-grid">'+ab('STR',str)+ab('DEX',dex)+ab('CON',con)+ab('INT',int)+ab('WIS',wis)+ab('CHA',cha)+'</div>';
  // Saving throws and skills from proficiencies array
  if(r.proficiencies?.length){
    const saves=r.proficiencies.filter(p=>p.proficiency.name.startsWith('Saving Throw:'))
      .map(p=>p.proficiency.name.replace('Saving Throw: ','')+(p.value>=0?' +'+(p.value):' '+p.value));
    if(saves.length)html+='<div class="detail-section"><strong>Saving Throws.</strong> '+saves.join(', ')+'</div>';
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
  html+='<div class="detail-section"><strong>CR.</strong> '+esc(String(r.challenge_rating??'?'))+' &nbsp; <strong>XP.</strong> '+(r.xp?.toLocaleString()||'?')+'</div>';
  if(r.special_abilities?.length)html+=actions('Traits',r.special_abilities);
  if(r.actions?.length)html+=actions('Actions',r.actions);
  if(r.legendary_actions?.length)html+=actions('Legendary Actions',r.legendary_actions);
  if(r.reactions?.length)html+=actions('Reactions',r.reactions);
  return html;
}

function renderSpellFull(d) {
  const r = d._raw || {};
  const components = Array.isArray(r.components) ? r.components.join(', ')+(r.material?' ('+r.material+')':'') : (d.components||'—');
  const desc = Array.isArray(r.desc) ? r.desc.join('\n\n') : (r.desc||d.desc||'');
  const higherLevel = Array.isArray(r.higher_level) ? r.higher_level.join('\n\n') : (r.higher_level||'');
  const classes = r.classes?.map(c=>c.name).join(', ') || '';
  let html = `<div class="detail-stats">
    <div class="stat-block"><div class="lab">Cast</div><div class="val">${esc(r.casting_time||d.cast||'—')}</div></div>
    <div class="stat-block"><div class="lab">Range</div><div class="val">${esc(r.range||d.range||'—')}</div></div>
    <div class="stat-block"><div class="lab">Duration</div><div class="val">${esc(r.duration||d.duration||'—')}</div></div>
  </div>`;
  html += `<div class="detail-section"><strong>Components.</strong> ${esc(components)}</div>`;
  if(r.concentration)html+=`<div class="detail-section" style="color:var(--warning)">⚡ Requires Concentration</div>`;
  if(r.ritual)html+=`<div class="detail-section" style="color:var(--accent)">📿 Ritual</div>`;
  html += `<div class="detail-section" style="line-height:1.7">${esc(desc)}</div>`;
  if(higherLevel)html+=`<div class="detail-section"><strong>At Higher Levels.</strong> ${esc(higherLevel)}</div>`;
  if(classes)html+=`<div class="detail-section" style="color:var(--text-muted);font-size:11px">Classes: ${esc(classes)}</div>`;
  return html;
}

function renderItemFull(d) {
  const r = d._raw || {};
  const desc = Array.isArray(r.desc) ? r.desc.join('\n\n') : (r.desc||d.desc||'');
  let html = `<div class="detail-section" style="line-height:1.7">${esc(desc)}</div>`;
  if(r.requires_attunement)html=`<div class="detail-section" style="color:var(--warning)">🔗 Requires Attunement${typeof r.requires_attunement==='string'?' '+esc(r.requires_attunement):''}</div>`+html;
  return html;
}

function renderConditionFull(d) {
  const r = d._raw || {};
  // dnd5eapi returns desc as string[], Open5e returned [{desc:string}]
  const descs = Array.isArray(r.desc) ? r.desc.map(p=>typeof p==='string'?p:(p.desc||'')) : (d.desc?[d.desc]:[]);
  return `<div class="detail-section" style="line-height:1.7">${descs.map(p=>`<p style="margin:0 0 8px">${esc(p)}</p>`).join('')}</div>`;
}

// Spell link click from monster detail — find in local data
function searchForSpell(slug) {
  const match = _5eData.find(d => d.cat==='spell' && d._slug===slug);
  if (match) { state.searchState.detail = match; renderSearchResults(); }
}

function getSearchPool(){
  const party = state.party.map(p=>({cat:'party',name:p.name,meta:(p.notes||'').split('\n')[0]||'Party member',partyData:p}));
  // Use 5etools data once loaded, otherwise fall back to built-in SEARCH_DATA
  const base = _5eLoaded ? _5eData : SEARCH_DATA;
  return [...party, ...base];
}

function doSearch(){
  const q=(state.searchState.query||'').trim().toLowerCase();
  let pool=getSearchPool();
  if(state.searchState.category!=='all')pool=pool.filter(r=>r.cat===state.searchState.category);
  if(q){
    pool=pool.filter(r=>r.name.toLowerCase().includes(q)||(r.meta||'').toLowerCase().includes(q));
    pool.sort((a,b)=>(a.name.toLowerCase().startsWith(q)?0:1)-(b.name.toLowerCase().startsWith(q)?0:1)||a.name.localeCompare(b.name));
  }else pool.sort((a,b)=>a.name.localeCompare(b.name));
  return pool.slice(0,80);
}


function renderSearchTabs(){
  const pool=getSearchPool();
  const labels={all:'All',monster:'Monsters',spell:'Spells',item:'Items',condition:'Conditions',party:'Party'};
  document.querySelectorAll('#search-tabs .search-tab').forEach(tab=>{
    const cat=tab.dataset.cat,count=cat==='all'?pool.length:pool.filter(r=>r.cat===cat).length;
    tab.innerHTML=`${labels[cat]} <span class="count">${count}</span>`;
    tab.classList.toggle('active',state.searchState.category===cat);
  });
}

function renderSearchResults(){
  const container=document.getElementById('search-results');
  if(state.searchState.detail){renderSearchDetail();return;}
  const results=doSearch();
  const q=(state.searchState.query||'').trim();

  if(!results.length && !q){
    const hint = !_5eLoaded
      ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px">Loading 5etools data…</div>'
      : '';
    container.innerHTML=`<div class="search-empty">Type to search monsters, spells, items, conditions, or your party.${hint}</div>`;
    return;
  }
  if(!results.length){
    const hint = !_5eLoaded ? ' <span style="font-size:11px;color:var(--text-dim)">(data still loading…)</span>' : '';
    container.innerHTML=`<div class="search-empty">No results for "${esc(q)}"${hint}</div>`;
    return;
  }

  container.innerHTML = results.map((r,i)=>`
    <div class="search-result ${i===state.searchState.focused?'focused':''}" data-idx="${i}">
      <div class="res-name">
        <span>${esc(r.name)}</span>
        <div style="display:flex;gap:5px;align-items:center;flex-shrink:0">
          ${r._source?`<span style="font-size:9px;color:var(--text-dim);padding:1px 4px;background:var(--panel-3);border-radius:3px">${esc(r._source)}</span>`:''}
          <span class="res-tag ${r.cat}">${r.cat}</span>
        </div>
      </div>
      <div class="res-meta">${esc(r.meta||'')}</div>
    </div>`).join('');
  container.querySelectorAll('.search-result').forEach((el,i)=>el.addEventListener('click', e => {
    e.stopPropagation();
    state.searchState.detail=results[i];
    renderSearchResults();
  }));
}

function renderSearchDetail(){
  const container=document.getElementById('search-results');
  const d=state.searchState.detail;

  const isMonster=d.cat==='monster', isSpell=d.cat==='spell', isItem=d.cat==='item', isCond=d.cat==='condition', isParty=d.cat==='party';

  let bodyHtml = '';
  if (isParty) {
    const p=d.partyData;
    bodyHtml='<div class="detail-stats">'
      +'<div class="stat-block"><div class="lab">HP</div><div class="val">'+p.hp+'/'+p.hpMax+'</div></div>'
      +'<div class="stat-block"><div class="lab">AC</div><div class="val">'+p.ac+'</div></div>'
      +'<div class="stat-block"><div class="lab">Init</div><div class="val">'+(p.init>=0?'+':'')+p.init+'</div></div>'
      +'</div>'
      +'<div class="detail-section"><strong>Speed.</strong> '+p.spd+' ft &nbsp;<strong>PP.</strong> '+p.pp+' &nbsp;<strong>GP.</strong> '+p.gp+'</div>'
      +(p.notes?'<div class="detail-section"><strong>Notes.</strong> '+esc(p.notes)+'</div>':'')
      +(p.inspiration?'<div class="detail-section" style="color:var(--warning)">★ Has inspiration</div>':'');
  } else if (d._raw) {
    if(isMonster) bodyHtml = renderMonsterFull(d, d);
    else if(isSpell) bodyHtml = renderSpellFull(d);
    else if(isItem)  bodyHtml = renderItemFull(d);
    else if(isCond)  bodyHtml = renderConditionFull(d);
  } else {
    // Fallback for old SEARCH_DATA entries without _raw
    if(isMonster){
      bodyHtml+=`<div class="detail-stats"><div class="stat-block"><div class="lab">HP</div><div class="val">${d.hp||'?'}</div></div><div class="stat-block"><div class="lab">AC</div><div class="val">${d.ac||'?'}</div></div><div class="stat-block"><div class="lab">Speed</div><div class="val">${esc(d.speed||'—')}</div></div></div>`;
      if(d.str){const ab=(l,s)=>`<div class="ability"><div class="ab-name">${l}</div><div class="ab-val">${s}</div><div class="ab-mod">${mod(s)>=0?'+':''}${mod(s)}</div></div>`;bodyHtml+=`<div class="ability-grid">${ab('STR',d.str)}${ab('DEX',d.dex)}${ab('CON',d.con)}${ab('INT',d.int)}${ab('WIS',d.wis)}${ab('CHA',d.cha)}</div>`;}
    } else {
      bodyHtml+=`<div class="detail-section">${esc(d.desc||d.cast||'')}</div>`;
    }
  }

  let actionsHtml = '<div class="detail-actions">';
  if(isMonster) actionsHtml+=`<button class="btn small primary" id="det-add-monster">+ Add to combat</button>`;
  if(isCond)    actionsHtml+=`<button class="btn small primary" id="det-apply-cond">+ Apply to active combatant</button>`;
  actionsHtml += '</div>';

  const srcBadge = d._source ? `<span style="font-size:9px;color:var(--text-dim);padding:1px 5px;background:var(--panel-3);border-radius:3px">${esc(d._source)}</span>` : '';

  container.innerHTML=`<div class="search-detail">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <button class="detail-back" id="detail-back">← Back</button>
      ${srcBadge}
    </div>
    <h4>${esc(d.name)}</h4>
    <div class="detail-meta">${esc(d.meta||'')}</div>
    ${isMonster?`<img class="detail-img" src="https://www.dnd5eapi.co/api/images/monsters/${d._slug}.png" onerror="this.style.display='none'" alt="${esc(d.name)}">`:''}
    <div id="detail-body">${bodyHtml}</div>
    ${!isParty?actionsHtml:''}
  </div>`;

  document.getElementById('detail-back')?.addEventListener('click',()=>{state.searchState.detail=null;renderSearchResults();});
  document.getElementById('det-add-monster')?.addEventListener('click',()=>{panelDefs.combat.addMonster(d);closeSearch();});
  document.getElementById('det-apply-cond')?.addEventListener('click',()=>{if(panelDefs.combat.applyCondition(d.name))closeSearch();});
}

function openSearch(){document.getElementById('search-popup').classList.add('open');state.searchState.detail=null;renderSearchTabs();renderSearchResults();}
function closeSearch(){document.getElementById('search-popup').classList.remove('open');state.searchState.detail=null;}
function initSearch(){
  // Start loading 5etools data in the background immediately
  load5eData();
  // When it finishes, refresh the open search popup if visible
  on5eLoaded(()=>{
    if(document.getElementById('search-popup')?.classList.contains('open')){renderSearchTabs();renderSearchResults();}
  });

  const inp=document.getElementById('search-input');
  inp.addEventListener('focus',openSearch);
  inp.addEventListener('input',e=>{
    state.searchState.query=e.target.value;
    state.searchState.focused=-1;
    state.searchState.detail=null;
    if(!document.getElementById('search-popup').classList.contains('open'))openSearch();
    renderSearchResults();
  });
  inp.addEventListener('keydown',e=>{
    const list=doSearch();
    if(e.key==='Escape'){if(state.searchState.detail){state.searchState.detail=null;renderSearchResults();}else{inp.blur();closeSearch();}}
    else if(e.key==='ArrowDown'){e.preventDefault();state.searchState.focused=Math.min(state.searchState.focused+1,list.length-1);renderSearchResults();document.querySelector('.search-result.focused')?.scrollIntoView({block:'nearest'});}
    else if(e.key==='ArrowUp'){e.preventDefault();state.searchState.focused=Math.max(state.searchState.focused-1,0);renderSearchResults();document.querySelector('.search-result.focused')?.scrollIntoView({block:'nearest'});}
    else if(e.key==='Enter'){const r=state.searchState.focused>=0?list[state.searchState.focused]:list[0];if(r){state.searchState.detail=r;renderSearchResults();}}
  });
  document.querySelectorAll('#search-tabs .search-tab').forEach(tab=>tab.addEventListener('click',()=>{state.searchState.category=tab.dataset.cat;state.searchState.focused=-1;state.searchState.detail=null;renderSearchTabs();renderSearchResults();inp.focus();}));
  let _insideSearch = false;
  document.querySelector('.search-wrap').addEventListener('mousedown', () => { _insideSearch = true; });
  document.addEventListener('mousedown', () => { if(!_insideSearch)closeSearch(); _insideSearch=false; });
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();inp.focus();}});
}
