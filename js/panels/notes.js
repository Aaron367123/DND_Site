// ============================================================
// NOTES PANEL
// ============================================================
// Markdown-only display by default; click any line to edit (textarea swap
// in-place). Each line is colored by whoever last edited it — identity comes
// from the local-only `skt-me-v1` (see _getMe in utils.js); the registry of
// {id → name, color} rides along inside the synced notes blob so other
// clients know what color to paint your lines in.

const notesDefaultPages=[{id:'p1',title:'Session 1',content:'# Session 1\n\nWrite your notes here. Markdown is rendered live.\n\n---\n\n## What happened\n\n- \n\n## NPCs met\n\n- \n\n## Loot found\n\n- ',lineAuthors:[]}];

function _notesHydrate(){
  try {
    const raw=localStorage.getItem('skt-notes-v1');
    if(!raw) return {pages:JSON.parse(JSON.stringify(notesDefaultPages)),authors:{}};
    const parsed=JSON.parse(raw);
    if(Array.isArray(parsed)){
      // Old shape: [{id,title,content}] → wrap and add empty per-line author lists
      return {
        pages: parsed.map(p=>({...p,lineAuthors:Array.isArray(p.lineAuthors)?p.lineAuthors:[]})),
        authors: {},
      };
    }
    return {
      pages: Array.isArray(parsed.pages)
        ? parsed.pages.map(p=>({...p,lineAuthors:Array.isArray(p.lineAuthors)?p.lineAuthors:[]}))
        : JSON.parse(JSON.stringify(notesDefaultPages)),
      authors: parsed.authors || {},
    };
  } catch(e){
    return {pages:JSON.parse(JSON.stringify(notesDefaultPages)),authors:{}};
  }
}

// Diff line-by-line: lines whose text matches an old line keep their prior
// author; new/changed lines are attributed to the current user. Robust to
// inserting or removing lines mid-document.
function _updateLineAuthors(oldContent,oldAuthors,newContent,myId){
  const oldLines=(oldContent||'').split('\n');
  const newLines=(newContent||'').split('\n');
  const priorByText=new Map();
  oldLines.forEach((line,i)=>{
    if(!priorByText.has(line)) priorByText.set(line, oldAuthors && oldAuthors[i]);
  });
  return newLines.map(line=>{
    const prior=priorByText.get(line);
    return prior!=null ? prior : myId;
  });
}

// Per-line variant of the markdown renderer. Keeps the same regex rules as
// the original but skips the multi-line passes (paragraph splits, <ul>
// wrapping). Each list item renders as its own <ul><li> — visually fine and
// makes the per-line color wrapping straightforward.
function _mdLineToHtml(line){
  let h=line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let block=null;
  if(/^### (.+)$/.test(h))      { block='h3'; h=h.replace(/^### /,''); }
  else if(/^## (.+)$/.test(h))  { block='h2'; h=h.replace(/^## /,''); }
  else if(/^# (.+)$/.test(h))   { block='h1'; h=h.replace(/^# /,''); }
  else if(/^> (.+)$/.test(h))   { block='blockquote'; h=h.replace(/^> /,''); }
  else if(/^---+$/.test(h))     return '<hr>';
  else if(/^[-*] (.+)$/.test(h)){ block='li'; h=h.replace(/^[-*] /,''); }
  // Inline markers
  h=h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  h=h.replace(/\*(.+?)\*/g,'<em>$1</em>');
  h=h.replace(/_(.+?)_/g,'<em>$1</em>');
  h=h.replace(/`(.+?)`/g,'<code>$1</code>');
  if(block==='li')   return '<ul><li>'+h+'</li></ul>';
  if(block)          return '<'+block+'>'+h+'</'+block+'>';
  return h;
}

registerPanel('notes',{
  title:'Session Notes',icon:'📝',
  _data:null, _active:0, _editing:false, _editingOriginal:null,

  mount(body){
    this._body=body;
    if(!this._data) this._data=_notesHydrate();
    if(!this._data.pages.length) this._data.pages=JSON.parse(JSON.stringify(notesDefaultPages));
    if(this._active>=this._data.pages.length) this._active=0;
    this._render();
  },
  unmount(){this._commitEditing();this._body=null;},

  _save(){
    // Tag self in the authors registry so other clients can color our lines.
    const me=_getMe();
    if(!this._data.authors) this._data.authors={};
    this._data.authors[me.id]={name:me.name,color:me.color};
    try{localStorage.setItem('skt-notes-v1',JSON.stringify(this._data));}catch(e){}
  },

  // Called from settings.js when the user changes their name/color so the
  // registry update propagates to others without requiring an edit.
  _touchSelf(){
    if(!this._data) return;
    this._save();
    if(this._body && !this._editing) this._refreshPreview();
  },

  _render(){
    const b=this._body;if(!b)return;
    const pg=this._data.pages[this._active]||this._data.pages[0];
    b.style.cssText='display:flex;flex-direction:column;height:100%;overflow:hidden';

    let html='<div class="notes-panel">';
    // Tab bar
    html+='<div class="notes-tabs">';
    this._data.pages.forEach((p,i)=>{
      html+='<button class="notes-tab '+(i===this._active?'active':'')+'" data-ti="'+i+'">'+esc(p.title)+'</button>';
    });
    html+='<button class="notes-tab-add" id="note-add-tab" title="New page">+</button>';
    html+='</div>';

    // Toolbar
    html+='<div class="notes-toolbar">'
      +'<input type="text" id="note-title" value="'+esc(pg.title)+'" style="width:130px;font-size:11px" placeholder="Page title">'
      +'<span style="flex:1"></span>'
      +'<button class="btn" data-nact="h1" title="Heading 1">H1</button>'
      +'<button class="btn" data-nact="h2" title="Heading 2">H2</button>'
      +'<button class="btn" data-nact="bold" title="Bold (Ctrl+B)"><b>B</b></button>'
      +'<button class="btn" data-nact="italic" title="Italic (Ctrl+I)"><i>I</i></button>'
      +'<button class="btn" data-nact="bullet" title="Bullet list">•</button>'
      +'<button class="btn" data-nact="hr" title="Divider">—</button>'
      +'<button class="btn" id="note-download" title="Save to desktop">💾</button>'
      +'<button class="btn danger" data-nact="del-page" title="Delete this page">🗑</button>'
    +'</div>';

    // Single click-to-edit area: rendered preview by default, becomes a
    // textarea on click and reverts on blur/Esc.
    html+='<div class="notes-edit-area" id="note-edit-area">'+this._renderColoredPreview(pg)+'</div>';

    html+='</div>';
    b.innerHTML=html;
    this._editing=false;
    this._wire();
  },

  _renderColoredPreview(pg){
    const lines=(pg.content||'').split('\n');
    const authorsMap=this._data.authors||{};
    return lines.map((line,i)=>{
      const authorId=pg.lineAuthors && pg.lineAuthors[i];
      const author=authorId && authorsMap[authorId];
      const color=author && author.color ? author.color : '';
      const tip=author && author.name ? ' title="'+esc(author.name)+'"' : '';
      const html=_mdLineToHtml(line)||'&nbsp;';
      const styleAttr=color?' style="color:'+esc(color)+'"':'';
      return '<div class="nl" data-line="'+i+'"'+styleAttr+tip+'>'+html+'</div>';
    }).join('');
  },

  _refreshPreview(){
    if(this._editing) return;
    const area=this._body && this._body.querySelector('#note-edit-area');
    if(!area) return;
    const pg=this._data.pages[this._active]||this._data.pages[0];
    area.innerHTML=this._renderColoredPreview(pg);
  },

  _enterEdit(lineIdx){
    if(this._editing) return;
    const area=this._body && this._body.querySelector('#note-edit-area');
    if(!area) return;
    const pg=this._data.pages[this._active];
    if(!pg) return;
    this._editing=true;
    this._editingOriginal=pg.content||'';
    area.innerHTML='<textarea class="notes-textarea" id="note-textarea" spellcheck="true" style="width:100%;height:100%;resize:none;border:none;background:transparent;color:var(--text);font-family:\'Cascadia Code\',\'Consolas\',monospace;font-size:12px;line-height:1.7;padding:0;outline:none">'+esc(pg.content||'')+'</textarea>';
    const ta=area.querySelector('#note-textarea');
    ta.addEventListener('keydown',e=>{
      if(e.key==='Escape'){ e.preventDefault(); ta.blur(); return; }
      if(e.key==='Tab'){
        e.preventDefault();
        const s=ta.selectionStart;
        ta.value=ta.value.slice(0,s)+'  '+ta.value.slice(s);
        ta.selectionStart=ta.selectionEnd=s+2;
      }
      if((e.ctrlKey||e.metaKey)&&!e.shiftKey){
        if(e.key==='b'){ e.preventDefault(); this._insert(ta,'bold'); }
        if(e.key==='i'){ e.preventDefault(); this._insert(ta,'italic'); }
        if(e.key==='s'){ e.preventDefault(); this._download(); }
      }
    });
    ta.addEventListener('blur',()=>this._exitEdit());
    // Place cursor at the start of the clicked line
    ta.focus();
    const lines=(pg.content||'').split('\n');
    const idx=Math.max(0,Math.min(lineIdx, Math.max(0,lines.length-1)));
    let pos=0;
    for(let i=0;i<idx;i++) pos+=lines[i].length+1;
    try{ ta.setSelectionRange(pos,pos); }catch(e){}
  },

  _exitEdit(){
    if(!this._editing) return;
    this._commitEditing();
    this._editing=false;
    this._editingOriginal=null;
    this._refreshPreview();
  },

  // Reads the textarea (if the user is in edit mode), diffs against the
  // pre-edit snapshot, updates lineAuthors, and persists.
  _commitEditing(){
    const ta=this._body && this._body.querySelector('#note-textarea');
    if(!ta) return;
    const pg=this._data.pages[this._active];
    if(!pg) return;
    const oldContent=this._editingOriginal!=null ? this._editingOriginal : (pg.content||'');
    const newContent=ta.value;
    if(newContent!==oldContent){
      const me=_getMe();
      pg.lineAuthors=_updateLineAuthors(oldContent, pg.lineAuthors, newContent, me.id);
      pg.content=newContent;
    }
    this._save();
  },

  _wire(){
    const b=this._body;if(!b)return;

    // Click-to-edit
    const area=b.querySelector('#note-edit-area');
    if(area){
      area.addEventListener('click',e=>{
        if(this._editing) return;
        const lineDiv=e.target.closest('.nl');
        const pg=this._data.pages[this._active];
        const totalLines=((pg && pg.content)||'').split('\n').length;
        const lineIdx=lineDiv ? +lineDiv.dataset.line : Math.max(0,totalLines-1);
        this._enterEdit(lineIdx);
      });
    }

    // Tabs
    b.querySelectorAll('.notes-tab').forEach(tab=>tab.addEventListener('click',()=>{
      this._commitEditing();
      this._active=+tab.dataset.ti;
      this._render();
    }));
    b.querySelector('#note-add-tab').addEventListener('click',()=>{
      this._commitEditing();
      this._data.pages.push({id:uid(),title:'Page '+(this._data.pages.length+1),content:'',lineAuthors:[]});
      this._active=this._data.pages.length-1;
      this._save();
      this._render();
    });
    b.querySelector('#note-title').addEventListener('change',e=>{
      this._commitEditing();
      this._data.pages[this._active].title=e.target.value;
      this._save();
      // Update tab label without a full re-render (would lose textarea focus)
      const tabBtn=b.querySelectorAll('.notes-tab')[this._active];
      if(tabBtn) tabBtn.textContent=e.target.value;
    });

    // Download
    b.querySelector('#note-download').addEventListener('click',()=>this._download());

    // Toolbar insert buttons — auto-enter edit mode if currently in preview
    b.querySelectorAll('[data-nact]').forEach(btn=>{
      btn.addEventListener('mousedown',e=>{
        const act=btn.dataset.nact;
        if(act!=='del-page') e.preventDefault();
      });
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        const act=btn.dataset.nact;
        if(act==='del-page'){
          if(this._data.pages.length===1){showModal('⚠ Cannot Delete',[],'OK').then(()=>{});return;}
          showModal('Delete Page?',[],'Delete').then(r=>{
            if(r===null)return;
            this._data.pages.splice(this._active,1);
            this._active=Math.min(this._active,this._data.pages.length-1);
            this._save();
            this._render();
          });
          return;
        }
        // Formatting buttons: ensure we're in edit mode first
        if(!this._editing){
          const pg=this._data.pages[this._active];
          const total=((pg && pg.content)||'').split('\n').length;
          this._enterEdit(Math.max(0,total-1));
        }
        const ta=this._body.querySelector('#note-textarea');
        if(ta) this._insert(ta,act);
      });
    });
  },

  _insert(ta,act){
    const s=ta.selectionStart, end=ta.selectionEnd;
    const selected=ta.value.slice(s,end);
    const wrap={bold:'**',italic:'_'}[act];
    const prefix={h1:'# ',h2:'## ',h3:'### ',hr:'---',bullet:'- ',quote:'> '}[act];
    let newCursor=s;
    if(wrap){
      const insert=wrap+(selected||'')+wrap;
      ta.value=ta.value.slice(0,s)+insert+ta.value.slice(end);
      newCursor=selected ? s+insert.length : s+wrap.length;
    } else if(prefix){
      const lineStart=ta.value.lastIndexOf('\n',s-1)+1;
      ta.value=ta.value.slice(0,lineStart)+prefix+ta.value.slice(lineStart);
      newCursor=s+prefix.length;
    }
    // Don't update pg.content here — _commitEditing handles the diff against
    // the pre-edit snapshot so lineAuthors gets attributed correctly.
    ta.focus();
    ta.setSelectionRange(newCursor,newCursor);
  },

  _download(){
    const pg=this._data.pages[this._active]||this._data.pages[0];
    const blob=new Blob([pg.content],{type:'text/plain'});
    const url=URL.createObjectURL(blob);
    const a=Object.assign(document.createElement('a'),{href:url,download:(pg.title||'notes')+'.md'});
    a.click();URL.revokeObjectURL(url);
    showToast('Saved: '+(pg.title||'notes')+'.md');
  },
});
