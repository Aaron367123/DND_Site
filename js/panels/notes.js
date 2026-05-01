// ============================================================
// NOTES PANEL
// ============================================================
const notesDefaultPages=[{id:'p1',title:'Session 1',content:'# Session 1\n\nWrite your notes here. Markdown is rendered live on the right.\n\n---\n\n## What happened\n\n- \n\n## NPCs met\n\n- \n\n## Loot found\n\n- '}];
registerPanel('notes',{
  title:'Session Notes',icon:'📝',
  _pages:null,_active:0,
  mount(body){
    this._body=body;
    if(!this._pages){
      try{const raw=localStorage.getItem('skt-notes-v1');this._pages=raw?JSON.parse(raw):JSON.parse(JSON.stringify(notesDefaultPages));}
      catch(e){this._pages=JSON.parse(JSON.stringify(notesDefaultPages));}
    }
    this._render();
  },
  unmount(){this._save();this._body=null;},
  _save(){try{localStorage.setItem('skt-notes-v1',JSON.stringify(this._pages));}catch(e){}},

  _render(){
    const b=this._body;if(!b)return;
    const pg=this._pages[this._active]||this._pages[0];
    b.style.cssText='display:flex;flex-direction:column;height:100%;overflow:hidden';

    let html='<div class="notes-panel">';
    // Tab bar
    html+='<div class="notes-tabs">';
    this._pages.forEach((p,i)=>{
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

    // Split: textarea | preview
    html+='<div style="display:flex;flex:1;overflow:hidden;gap:0">'
      +'<textarea class="notes-textarea" id="note-textarea" spellcheck="true" style="flex:1;resize:none;border:none;border-right:1px solid var(--border);border-radius:0;background:var(--panel);font-size:12px;line-height:1.7;padding:12px 14px;font-family:\'Cascadia Code\',\'Consolas\',monospace;color:var(--text)">'+esc(pg.content)+'</textarea>'
      +'<div class="notes-preview" id="note-preview" style="flex:1;overflow-y:auto;padding:12px 14px;font-size:12px;line-height:1.7">'+this._mdToHtml(pg.content)+'</div>'
    +'</div>';

    html+='</div>';
    b.innerHTML=html;
    this._wire();
  },

  _wire(){
    const b=this._body;if(!b)return;
    const ta=b.querySelector('#note-textarea');
    const preview=b.querySelector('#note-preview');

    // Live preview update
    if(ta){
      ta.addEventListener('input',()=>{
        this._pages[this._active].content=ta.value;
        this._save();
        if(preview) preview.innerHTML=this._mdToHtml(ta.value);
      });
      ta.addEventListener('keydown',e=>{
        if(e.key==='Tab'){e.preventDefault();const s=ta.selectionStart;ta.value=ta.value.slice(0,s)+'  '+ta.value.slice(s);ta.selectionStart=ta.selectionEnd=s+2;}
        if((e.ctrlKey||e.metaKey)&&!e.shiftKey){
          if(e.key==='b'){e.preventDefault();this._insert(ta,'bold');}
          if(e.key==='i'){e.preventDefault();this._insert(ta,'italic');}
          if(e.key==='s'){e.preventDefault();this._download();}
        }
      });
    }

    // Tabs
    b.querySelectorAll('.notes-tab').forEach(tab=>tab.addEventListener('click',()=>{
      this._saveCurrent();this._active=+tab.dataset.ti;this._render();
    }));
    b.querySelector('#note-add-tab').addEventListener('click',()=>{
      this._saveCurrent();
      this._pages.push({id:uid(),title:'Page '+(this._pages.length+1),content:''});
      this._active=this._pages.length-1;this._save();this._render();
    });
    b.querySelector('#note-title').addEventListener('change',e=>{this._pages[this._active].title=e.target.value;this._save();});

    // Download
    b.querySelector('#note-download').addEventListener('click',()=>this._download());

    // Toolbar insert buttons — mousedown prevents focus loss
    b.querySelectorAll('[data-nact]').forEach(btn=>{
      btn.addEventListener('mousedown',e=>{
        const act=btn.dataset.nact;
        if(act!=='del-page')e.preventDefault();
      });
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        const act=btn.dataset.nact;
        if(act==='del-page'){
          if(this._pages.length===1){showModal('⚠ Cannot Delete',[],'OK').then(()=>{});return;}
          showModal('Delete Page?',[],'Delete').then(r=>{
            if(r===null)return;
            this._pages.splice(this._active,1);
            this._active=Math.min(this._active,this._pages.length-1);
            this._save();this._render();
          });return;
        }
        if(ta)this._insert(ta,act);
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
      newCursor=selected?s+insert.length:s+wrap.length;
    } else if(prefix){
      const lineStart=ta.value.lastIndexOf('\n',s-1)+1;
      ta.value=ta.value.slice(0,lineStart)+prefix+ta.value.slice(lineStart);
      newCursor=s+prefix.length;
    }
    this._pages[this._active].content=ta.value;this._save();
    const preview=this._body?.querySelector('#note-preview');
    if(preview)preview.innerHTML=this._mdToHtml(ta.value);
    ta.focus();ta.setSelectionRange(newCursor,newCursor);
  },

  _download(){
    const pg=this._pages[this._active]||this._pages[0];
    const blob=new Blob([pg.content],{type:'text/plain'});
    const url=URL.createObjectURL(blob);
    const a=Object.assign(document.createElement('a'),{href:url,download:(pg.title||'notes')+'.md'});
    a.click();URL.revokeObjectURL(url);
    showToast('Saved: '+(pg.title||'notes')+'.md');
  },

  _saveCurrent(){const ta=this._body?.querySelector('#note-textarea');if(ta&&this._pages[this._active])this._pages[this._active].content=ta.value;},

  _mdToHtml(md){
    let h=md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    h=h.replace(/^### (.+)$/gm,'<h3>$1</h3>');
    h=h.replace(/^## (.+)$/gm,'<h2>$1</h2>');
    h=h.replace(/^# (.+)$/gm,'<h1>$1</h1>');
    h=h.replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>');
    h=h.replace(/^---+$/gm,'<hr>');
    h=h.replace(/^[-*] (.+)$/gm,'<li>$1</li>');
    h=h.replace(/(<li>[\s\S]*?<\/li>)(\n(?!<li>)|$)/g,'<ul>$1</ul>$2');
    h=h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    h=h.replace(/\*(.+?)\*/g,'<em>$1</em>');
    h=h.replace(/_(.+?)_/g,'<em>$1</em>');
    h=h.replace(/`(.+?)`/g,'<code>$1</code>');
    h=h.replace(/\n\n+/g,'</p><p>');
    h='<p>'+h+'</p>';
    h=h.replace(/<p>\s*<\/p>/g,'');
    h=h.replace(/<p>(<h[1-6]|<ul|<hr|<blockquote)/g,'$1');
    h=h.replace(/(<\/h[1-6]>|<\/ul>|<hr>|<\/blockquote>)<\/p>/g,'$1');
    return h;
  },
});
