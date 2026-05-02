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

function renderFeatFull(d) {
  const r = d._raw || {};
  const desc = Array.isArray(r.desc) ? r.desc.join('\n\n') : (r.desc || d.desc || '');
  let html = '';
  if (r.prerequisite) html += `<div class="detail-section" style="color:var(--text-dim)"><strong>Prerequisite.</strong> ${esc(r.prerequisite)}</div>`;
  html += `<div class="detail-section" style="line-height:1.7">${esc(desc)}</div>`;
  return html;
}

function renderConditionFull(d) {
  const r = d._raw || {};
  // dnd5eapi returns desc as string[], Open5e returned [{desc:string}]
  const descs = Array.isArray(r.desc) ? r.desc.map(p=>typeof p==='string'?p:(p.desc||'')) : (d.desc?[d.desc]:[]);
  return `<div class="detail-section" style="line-height:1.7">${descs.map(p=>`<p style="margin:0 0 8px">${esc(p)}</p>`).join('')}</div>`;
}

// Adventure detail: cover image (if installed), level range, storyline, published
// date, author, and a chapter-name list. Chapters are themselves searchable as
// their own entries so users can pull up the full text.
function renderAdventureFull(d) {
  const r = d._raw || {};
  const lvl = r.level && r.level.start
    ? `${r.level.start}${r.level.end!=null?'–'+r.level.end:''}`
    : '';
  const cover = r.cover && r.cover.path
    ? `<img class="detail-img" src="img/${esc(r.cover.path)}" onerror="this.style.display='none'" alt="${esc(d.name)} cover">`
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
// that just has parsed `desc` text — splits into paragraphs, preserves line breaks.
function renderRefFull(d) {
  const text = d.desc || '';
  if (!text.trim()) return '<div class="detail-section" style="color:var(--text-muted);font-style:italic">No description available.</div>';
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
  return paragraphs.map(p =>
    `<div class="detail-section" style="line-height:1.7;white-space:pre-wrap">${esc(p)}</div>`
  ).join('');
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

// Spell link click from monster detail — find in local data
function searchForSpell(slug) {
  const match = _5eData.find(d => d.cat==='spell' && d._slug===slug);
  if (match) { state.searchState.detail = match; renderSearchResults(); }
}

function getSearchPool(){
  const party = state.party.map(p=>({cat:'party',name:p.name,meta:(p.notes||'').split('\n')[0]||'Party member',partyData:p}));
  // Use 5etools data once loaded, otherwise fall back to built-in SEARCH_DATA
  let base = _5eLoaded ? _5eData : SEARCH_DATA;
  const policy = state.settings?.reprintPolicy || 'all';
  if (policy === 'hide-legacy')   base = base.filter(r => !_isLegacyEntry(r));
  else if (policy === 'hide-reprints') base = base.filter(r => !_isReprintEntry(r));
  return [...party, ...base];
}

// Tab category can be 'all', a single cat string, or a comma-joined list
// (e.g. 'cult,boon') for tabs that union multiple cats. _catMatches centralizes
// the comparison so doSearch and renderSearchTabs stay consistent.
function _catMatches(cat, sel) {
  if (sel === 'all') return true;
  if (sel.indexOf(',') >= 0) return sel.split(',').includes(cat);
  return cat === sel;
}

function doSearch(){
  const q=(state.searchState.query||'').trim().toLowerCase();
  let pool=getSearchPool();
  const sel=state.searchState.category;
  if(sel!=='all')pool=pool.filter(r=>_catMatches(r.cat, sel));
  if(q){
    pool=pool.filter(r=>r.name.toLowerCase().includes(q)||(r.meta||'').toLowerCase().includes(q));
    pool.sort((a,b)=>(a.name.toLowerCase().startsWith(q)?0:1)-(b.name.toLowerCase().startsWith(q)?0:1)||a.name.localeCompare(b.name));
  }else pool.sort((a,b)=>a.name.localeCompare(b.name));
  return pool.slice(0,80);
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
  document.querySelectorAll('#search-tabs .search-tab').forEach(tab=>{
    if(tab.classList.contains('more-toggle'))return; // handled separately below
    const cat=tab.dataset.cats||tab.dataset.cat;
    const count=cat==='all'?pool.length:pool.filter(r=>_catMatches(r.cat, cat)).length;
    tab.innerHTML=`${labels[cat]||cat} <span class="count">${count}</span>`;
    const isActive=sel===cat;
    tab.classList.toggle('active',isActive);
    if(isActive && tab.classList.contains('secondary'))activeIsSecondary=true;
  });
  // Auto-expand the More section whenever a secondary category is selected so
  // the user can see the active state without an extra click.
  const tabsRoot=document.getElementById('search-tabs');
  if(activeIsSecondary)tabsRoot.classList.add('expanded');
  // Highlight the More toggle when its hidden contents include the active cat.
  const moreBtn=document.getElementById('search-more-toggle');
  if(moreBtn)moreBtn.classList.toggle('has-active-secondary', activeIsSecondary);
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

// <img> tag for an entry's hero image. Sources only the local 5etools image
// pack — no remote fallback. Monster fluff stores paths relative to img/
// (e.g. "bestiary/MM/Goblin.webp"), while the per-category fluff loader
// already prefixes 'img/' when populating _img on non-monster rows. If no
// local image exists, render nothing.
function _detailImgTag(d) {
  if (!d._img) return '';
  const src = d.cat === 'monster' ? 'img/' + d._img : d._img;
  return `<img class="detail-img" src="${esc(src)}" onerror="this.style.display='none'" alt="${esc(d.name)}">`;
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
  const srcBadge = d._source ? `<span style="font-size:9px;color:var(--text-dim);padding:1px 5px;background:var(--panel-3);border-radius:3px">${esc(d._source)}</span>` : '';
  let actionsHtml = '';
  if (!isParty) {
    actionsHtml = '<div class="detail-actions">';
    if(isMonster) actionsHtml+=`<button class="btn small primary" id="det-add-monster${idSuffix}">+ Add to combat</button>`;
    if(isCond)    actionsHtml+=`<button class="btn small primary" id="det-apply-cond${idSuffix}">+ Apply to active combatant</button>`;
    actionsHtml += '</div>';
  }
  return `<div class="search-detail">
    ${srcBadge?`<div style="display:flex;justify-content:flex-end;margin-bottom:8px">${srcBadge}</div>`:''}
    <h4>${esc(d.name)}</h4>
    <div class="detail-meta">${esc(d.meta||'')}</div>
    ${_detailImgTag(d)}
    <div>${buildDetailBody(d)}</div>
    ${actionsHtml}
  </div>`;
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
    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px">
      <button class="detail-back" id="detail-back">← Back</button>
      <button class="detail-back" id="detail-popout" title="Open in its own window">⧉ Pop out</button>
    </div>
    <h4>${esc(d.name)}</h4>
    <div class="detail-meta">${esc(d.meta||'')}</div>
    ${d._source?`<div style="margin:4px 0"><span style="font-size:9px;color:var(--text-dim);padding:1px 5px;background:var(--panel-3);border-radius:3px">${esc(d._source)}</span></div>`:''}
    ${_detailImgTag(d)}
    <div id="detail-body">${buildDetailBody(d)}</div>
    ${d.cat==='party' ? '' : (function(){
      let h='<div class="detail-actions">';
      if(d.cat==='monster')   h+=`<button class="btn small primary" id="det-add-monster${suffix}">+ Add to combat</button>`;
      if(d.cat==='condition') h+=`<button class="btn small primary" id="det-apply-cond${suffix}">+ Apply to active combatant</button>`;
      return h+'</div>';
    })()}
  </div>`;

  document.getElementById('detail-back')?.addEventListener('click',()=>{state.searchState.detail=null;renderSearchResults();});
  document.getElementById('detail-popout')?.addEventListener('click',()=>popOutDetail(d));
  wireDetailActions(d, container, suffix, closeSearch);
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
  document.addEventListener('mousedown', () => { if(!_insideSearch)closeSearch(); _insideSearch=false; });
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();inp.focus();}});
}
