// ============================================================
// ADVENTURES PANEL
// ============================================================
// Lists every published adventure; clicking one opens the full content with
// a chapter-tree sidebar on the left and the rendered text on the right —
// 5etools-style. Adventure files live at `data/adventure/adventure-<id>.json`
// and are fetched lazily on first selection (cached on the panel after).

registerPanel('adventures', {
  title: 'Adventures', icon: '📖',
  _adventures: null,        // index from adventures.json (sorted)
  _advCache: {},            // { advIdLower: parsedFile }
  _currentAdvId: null,      // null = list view; otherwise one adventure
  _currentChapterIdx: 0,
  _loading: false,

  mount(body){
    this._body = body;
    this._render();
    this._loadIndex();
  },
  unmount(){ this._body = null; },

  async _loadIndex(){
    if (this._adventures) return;
    try {
      const res = await fetch('data/adventures.json');
      const j = await res.json();
      this._adventures = (j.adventure || []).slice().sort((a,b) => a.name.localeCompare(b.name));
      if (this._body && !this._currentAdvId) this._render();
    } catch(_){ this._adventures = []; if (this._body) this._render(); }
  },

  async _loadAdventure(id){
    const key = (id||'').toLowerCase();
    if (this._advCache[key]) return this._advCache[key];
    try {
      const res = await fetch('data/adventure/adventure-' + key + '.json');
      const j = await res.json();
      this._advCache[key] = j;
      return j;
    } catch(_){
      this._advCache[key] = { data: [] };
      return this._advCache[key];
    }
  },

  _render(){
    const b = this._body; if (!b) return;
    if (this._currentAdvId) this._renderAdv();
    else this._renderList();
  },

  // ── List view: grid of every adventure's cover + meta ──────────────────────
  _renderList(){
    const b = this._body; if (!b) return;
    if (!this._adventures){
      b.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center">Loading adventures…</div>';
      return;
    }
    if (!this._adventures.length){
      b.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center">No adventures available.</div>';
      return;
    }
    const cardHtml = a => {
      const lvl = a.level && a.level.start
        ? `L${a.level.start}${a.level.end!=null?'–'+a.level.end:''}`
        : '';
      const meta = [lvl, a.storyline, a.published].filter(Boolean).join(' · ');
      const coverPath = a.cover && a.cover.path ? 'img/' + a.cover.path : '';
      const cover = coverPath
        ? `<img class="adv-card-img" src="${esc(coverPath)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'adv-card-nopic',textContent:'📖'}))">`
        : `<div class="adv-card-nopic">📖</div>`;
      return `<div class="adv-card" role="button" tabindex="0" data-aid="${esc(a.id)}" title="${esc(a.name)}">
        <div class="adv-card-imgwrap">
          ${cover}
          <div class="adv-card-titleover">${esc(a.name)}</div>
        </div>
        <div class="adv-card-body">
          <div class="adv-card-meta">${esc(meta)}</div>
        </div>
      </div>`;
    };
    this._cardHtml = cardHtml;
    const filterQ = (this._searchQ || '').toLowerCase();
    const visible = filterQ
      ? this._adventures.filter(a => (a.name+' '+(a.storyline||'')+' '+(a.id||'')).toLowerCase().includes(filterQ))
      : this._adventures;
    const cards = visible.map(cardHtml).join('');

    b.innerHTML = `
      <div class="adv-panel">
        <div class="adv-list-head">
          <input type="search" id="adv-search" placeholder="🔎 Filter adventures…" value="${esc(this._searchQ||'')}" autocomplete="off">
          <span class="adv-list-count">${visible.length} / ${this._adventures.length}</span>
        </div>
        <div class="adv-list">${cards || '<div class="empty-state" style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted)">No adventures match.</div>'}</div>
      </div>`;
    const search = b.querySelector('#adv-search');
    if (search){
      search.addEventListener('input', e => {
        this._searchQ = e.target.value;
        // Update grid only — keep input focused.
        const list = b.querySelector('.adv-list');
        const count = b.querySelector('.adv-list-count');
        if (!list) return;
        const q = (this._searchQ||'').toLowerCase();
        const arr = q
          ? this._adventures.filter(a => (a.name+' '+(a.storyline||'')+' '+(a.id||'')).toLowerCase().includes(q))
          : this._adventures;
        list.innerHTML = arr.map(cardHtml).join('') || '<div class="empty-state" style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted)">No adventures match.</div>';
        if (count) count.textContent = `${arr.length} / ${this._adventures.length}`;
        this._wireCards();
      });
    }
    this._wireCards();
  },

  _wireCards(){
    const b = this._body; if (!b) return;
    b.querySelectorAll('.adv-card').forEach(c => {
      const open = async () => {
        this._currentAdvId = c.dataset.aid;
        this._currentChapterIdx = 0;
        this._loading = true;
        this._render();
        await this._loadAdventure(this._currentAdvId);
        this._loading = false;
        this._render();
      };
      c.addEventListener('click', open);
      c.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); }
      });
    });
  },

  // ── Adventure view: chapter sidebar + content ──────────────────────────────
  async _renderAdv(){
    const b = this._body; if (!b) return;
    const adv = (this._adventures||[]).find(a => a.id === this._currentAdvId) || { name: this._currentAdvId };
    const file = this._advCache[(this._currentAdvId||'').toLowerCase()];

    if (!file){
      b.innerHTML = `
        <div class="adv-panel">
          <div class="adv-head">
            <button class="btn small" data-act="back">← All adventures</button>
            <span class="adv-head-title">${esc(adv.name)}</span>
          </div>
          <div class="empty-state" style="padding:40px;text-align:center">Loading…</div>
        </div>`;
      b.querySelector('[data-act="back"]').addEventListener('click', () => {
        this._currentAdvId = null;
        this._render();
      });
      return;
    }

    const chapters = (file && file.data) || [];
    if (this._currentChapterIdx >= chapters.length) this._currentChapterIdx = 0;
    const ch = chapters[this._currentChapterIdx];

    const tocHtml = chapters.map((c, i) => `
      <button class="adv-chapter${i===this._currentChapterIdx?' active':''}" data-ci="${i}" title="${esc(c.name||'')}">
        <span class="adv-chapter-num">${i+1}</span>
        <span class="adv-chapter-name">${esc(c.name||'Untitled')}</span>
      </button>`).join('');

    const contentHtml = ch
      ? `<h2 class="adv-content-title">${esc(ch.name||'')}</h2>${this._renderChapterEntries(ch)}`
      : '<div class="empty-state" style="padding:30px">Empty chapter.</div>';

    b.innerHTML = `
      <div class="adv-panel adv-panel-detail">
        <div class="adv-head">
          <button class="btn small" data-act="back">← All adventures</button>
          <span class="adv-head-title">${esc(adv.name)}</span>
          <span class="adv-head-meta">${esc((adv.source||'')+(adv.published?(' · '+adv.published):''))}</span>
        </div>
        <div class="adv-body">
          <div class="adv-toc">
            <div class="adv-toc-head">Chapters · ${chapters.length}</div>
            <div class="adv-toc-list">${tocHtml || '<div class="empty-state" style="padding:20px;font-size:11px">No chapters in this file.</div>'}</div>
          </div>
          <div class="adv-content" id="adv-content">${contentHtml}</div>
        </div>
      </div>`;

    b.querySelector('[data-act="back"]').addEventListener('click', () => {
      this._currentAdvId = null;
      this._render();
    });
    b.querySelectorAll('.adv-chapter').forEach(btn => btn.addEventListener('click', () => {
      this._currentChapterIdx = +btn.dataset.ci;
      this._render();
      // Scroll the new chapter content to the top.
      const c = this._body?.querySelector('#adv-content');
      if (c) c.scrollTop = 0;
    }));
  },

  // Inline string → HTML. Pipes through the existing _stripTags (which
  // honors 5etools {@…} link-text and emits control-char markers) and then
  // _renderInline to convert those control chars into <strong>/<i>/etc.
  _inline(str){
    if (typeof _stripTags !== 'function' || typeof _renderInline !== 'function'){
      return esc(String(str ?? ''));
    }
    return _renderInline(esc(_stripTags(String(str ?? ''))));
  },

  // Recursively render any 5etools entry node to HTML. Adventures use the
  // fullest variety of entry types in the dataset: 'image', 'gallery',
  // 'statblock', 'flowchart', 'flowBlock', 'inset', 'insetReadaloud',
  // 'table', 'tableGroup', 'list', 'quote', 'item', 'section', 'entries',
  // 'spellcasting', 'none'. The earlier _parseEntries silently dropped
  // most of these — this dedicated renderer keeps the page complete.
  _renderNode(node){
    if (node == null) return '';
    if (typeof node === 'string') return `<p>${this._inline(node)}</p>`;
    if (Array.isArray(node)) return node.map(n => this._renderNode(n)).join('');
    if (typeof node !== 'object') return '';
    const t = node.type;
    const renderChildren = arr => (Array.isArray(arr) ? arr : []).map(n => this._renderNode(n)).join('');

    switch (t){
      case 'entries':
      case 'section':
      case 'none':
      case 'inlineBlock':
      case 'internal': {
        const head = node.name ? `<h3 class="adv-section-head">${this._inline(node.name)}</h3>` : '';
        return `<section class="adv-section">${head}${renderChildren(node.entries)}</section>`;
      }
      case 'item': {
        // 5etools "item" inside a list → bold name + inline body.
        const name = node.name ? `<strong>${this._inline(node.name)}.</strong> ` : '';
        const body = (node.entries||[]).map(e => typeof e==='string' ? this._inline(e) : this._renderNode(e)).join(' ');
        return `<p class="adv-item">${name}${body}</p>`;
      }
      case 'list': {
        const items = (node.items||[]).map(it => {
          if (typeof it === 'string') return `<li>${this._inline(it)}</li>`;
          return `<li>${this._renderNode(it)}</li>`;
        }).join('');
        const tag = node.style && node.style.includes('list-decimal') ? 'ol' : 'ul';
        return `<${tag} class="adv-list">${items}</${tag}>`;
      }
      case 'table':
      case 'tableGroup': {
        if (t === 'tableGroup'){
          return (node.tables||[]).map(tb => this._renderNode(tb)).join('');
        }
        const caption = node.caption ? `<caption>${this._inline(node.caption)}</caption>` : '';
        const head = (node.colLabels||[]).length
          ? `<thead><tr>${node.colLabels.map(c => `<th>${this._inline(c)}</th>`).join('')}</tr></thead>`
          : '';
        const rows = (node.rows||[]).map(r => {
          const cells = (Array.isArray(r) ? r : [r]).map(c => {
            if (typeof c === 'string') return `<td>${this._inline(c)}</td>`;
            if (c && c.roll && c.roll.exact != null) return `<td>${c.roll.exact}</td>`;
            if (c && c.roll && c.roll.min != null) return `<td>${c.roll.min}–${c.roll.max}</td>`;
            if (c && c.type) return `<td>${this._renderNode(c)}</td>`;
            return '<td></td>';
          }).join('');
          return `<tr>${cells}</tr>`;
        }).join('');
        return `<div class="adv-table-wrap"><table class="adv-table">${caption}${head}<tbody>${rows}</tbody></table></div>`;
      }
      case 'inset':
      case 'insetReadaloud': {
        const head = node.name ? `<div class="adv-inset-head">${this._inline(node.name)}</div>` : '';
        const cls = t === 'insetReadaloud' ? 'adv-inset adv-inset-readaloud' : 'adv-inset';
        return `<aside class="${cls}">${head}${renderChildren(node.entries)}</aside>`;
      }
      case 'quote': {
        const by = node.by ? `<footer class="adv-quote-by">— ${this._inline(node.by)}${node.from?', '+this._inline(node.from):''}</footer>` : '';
        return `<blockquote class="adv-quote">${renderChildren(node.entries)}${by}</blockquote>`;
      }
      case 'image': {
        const path = node.href && node.href.path ? 'img/'+node.href.path : '';
        if (!path) return '';
        const cap = node.title || node.caption || '';
        const credit = node.credit ? `<span class="adv-img-credit">${this._inline(node.credit)}</span>` : '';
        return `<figure class="adv-figure"><img src="${esc(path)}" alt="${esc(cap)}" loading="lazy" onerror="this.style.display='none'">${(cap||credit)?`<figcaption>${cap?this._inline(cap):''}${credit}</figcaption>`:''}</figure>`;
      }
      case 'gallery': {
        return `<div class="adv-gallery">${(node.images||[]).map(im => this._renderNode(im)).join('')}</div>`;
      }
      case 'statblock': {
        const tag = node.tag || 'creature';
        const label = tag === 'creature' ? 'Creature' : tag.charAt(0).toUpperCase()+tag.slice(1);
        return `<div class="adv-statblock-ref"><strong>${esc(label)}:</strong> ${esc(node.name||'')}${node.source?` <span class="adv-statblock-src">(${esc(node.source)})</span>`:''}</div>`;
      }
      case 'spellcasting': {
        // Render headerEntries + lists of spells per level.
        let html = '<div class="adv-spellcasting">';
        if (node.name) html += `<h3 class="adv-section-head">${this._inline(node.name)}</h3>`;
        (node.headerEntries||[]).forEach(e => html += this._renderNode(e));
        const slots = node.spells || {};
        Object.keys(slots).sort().forEach(lvl => {
          const lvlData = slots[lvl];
          const spells = (lvlData.spells||[]).map(s => this._inline(s)).join(', ');
          html += `<p><strong>Level ${lvl}:</strong> ${spells}</p>`;
        });
        if (Array.isArray(node.daily)){
          // simpler: render any extra nested entries
        }
        (node.footerEntries||[]).forEach(e => html += this._renderNode(e));
        html += '</div>';
        return html;
      }
      case 'flowchart': {
        // Sequence of flowBlocks, render as connected boxes.
        return `<div class="adv-flowchart">${(node.blocks||[]).map(b => this._renderNode(b)).join('')}</div>`;
      }
      case 'flowBlock': {
        const head = node.name ? `<div class="adv-flowblock-head">${this._inline(node.name)}</div>` : '';
        return `<div class="adv-flowblock">${head}${renderChildren(node.entries)}</div>`;
      }
      case 'abilityDc':
        return `<p><strong>Spell save DC</strong> = 8 + proficiency bonus + ${esc((node.attributes||['ability'])[0])} modifier</p>`;
      case 'abilityAttackMod':
        return `<p><strong>Spell attack modifier</strong> = proficiency bonus + ${esc((node.attributes||['ability'])[0])} modifier</p>`;
      case 'square':
      case 'cell':
      case 'hexColsOdd':
      case 'hexColsEven':
        // Layout primitives we don't try to recreate visually — drop silently.
        return '';
      default:
        // Unknown / future type — best effort: render any nested entries.
        if (Array.isArray(node.entries)) return renderChildren(node.entries);
        return '';
    }
  },

  _renderChapterEntries(ch){
    if (!ch || !Array.isArray(ch.entries) || !ch.entries.length){
      return '<div class="empty-state" style="padding:20px;color:var(--text-muted)">No content.</div>';
    }
    return ch.entries.map(e => this._renderNode(e)).join('');
  },
});
