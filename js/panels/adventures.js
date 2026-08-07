// ============================================================
// ADVENTURES PANEL — build 20260509-E
// ============================================================
console.log('adventures.js build 20260509-E loaded');
// Lists every published adventure; clicking one opens the full content with
// a chapter-tree sidebar on the left and the rendered text on the right —
// 5etools-style. Adventure files live at `data/adventure/adventure-<id>.json`
// and are fetched lazily on first selection (cached on the panel after).

registerPanel('adventures', {
  // Read by CONTENT_PANEL_SHARED (js/panels/content-panel.js).
  _kindLabel: 'Adventure',

  title: 'Adventures', icon: '📖',
  _adventures: null,        // index from adventures.json (sorted)
  _advCache: {},            // { advIdLower: parsedFile }
  _currentAdvId: null,      // null = list view; otherwise one adventure
  _currentChapterIdx: 0,
  _loading: false,
  // Bookmarks: { [advId]: { chapterIdx, ts } } — persisted per-browser.
  // Lets the DM jump back to where they left off in each adventure without
  // having to remember chapter numbers. Auto-set on every chapter change.
  _bookmarks: null,
  // Hidden adventures — same UX as the Books panel. Adventure IDs (LMoP, SKT,
  // ToA, …) match the `_source` tag on items / monsters / etc. that 5etools
  // tags with the originating adventure, so hiding one removes its content
  // from search / shop / bestiary / encounter.
  _hiddenAdventures: null,

  mount(body){
    this._body = body;
    if (!this._bookmarks){
      try { this._bookmarks = JSON.parse(localStorage.getItem('skt-adv-bookmarks-v1') || '{}') || {}; }
      catch(e){ this._bookmarks = {}; }
    }
    if (!this._hiddenAdventures){
      try {
        const arr = JSON.parse(localStorage.getItem('skt-adventures-hidden-v1') || '[]');
        this._hiddenAdventures = new Set(Array.isArray(arr) ? arr : []);
      } catch(e){ this._hiddenAdventures = new Set(); }
    }
    // Keep the merged global Set in sync in case Adventures was the first
    // panel to mount.
    if (typeof window.SKT_HIDDEN_SOURCES_REBUILD === 'function') window.SKT_HIDDEN_SOURCES_REBUILD();
    // Cross-tab sync (mirrors the Books panel). Hidden-adventures + bookmarks
    // are browser-local, so a second tab never saw the change without a slow
    // Firebase round-trip. The native `storage` event fires in other tabs the
    // instant these keys change; re-read + re-render off it.
    if (!this._onStorage){
      this._onStorage = (e) => {
        if (!this._body || !e) return;
        if (e.key === 'skt-adventures-hidden-v1'){
          try { const arr = JSON.parse(e.newValue || '[]'); this._hiddenAdventures = new Set(Array.isArray(arr) ? arr : []); }
          catch(_){ this._hiddenAdventures = new Set(); }
          if (typeof window.SKT_HIDDEN_SOURCES_REBUILD === 'function') window.SKT_HIDDEN_SOURCES_REBUILD();
          this._render();
        } else if (e.key === 'skt-adv-bookmarks-v1'){
          try { this._bookmarks = JSON.parse(e.newValue || '{}') || {}; } catch(_){ this._bookmarks = {}; }
          if (!this._currentAdvId) this._render();
        }
      };
      window.addEventListener('storage', this._onStorage);
    }
    this._render();
    this._loadIndex();
  },

  _saveHiddenAdventures(){
    try { localStorage.setItem('skt-adventures-hidden-v1', JSON.stringify([...this._hiddenAdventures])); } catch(e){}
    if (typeof window.SKT_HIDDEN_SOURCES_REBUILD === 'function') window.SKT_HIDDEN_SOURCES_REBUILD();
  },
  _toggleAdventureHidden(id){
    if (!this._hiddenAdventures) this._hiddenAdventures = new Set();
    if (this._hiddenAdventures.has(id)) this._hiddenAdventures.delete(id);
    else this._hiddenAdventures.add(id);
    this._saveHiddenAdventures();
    this._render();
  },

  // Persist bookmark for the current adventure + chapter. Called whenever the
  // user switches chapters so "last visited" reflects what the DM actually
  // read most recently, not just the first chapter they opened.
  _bumpBookmark(){
    if (!this._currentAdvId) return;
    this._bookmarks[this._currentAdvId] = { chapterIdx: this._currentChapterIdx, ts: Date.now() };
    try { localStorage.setItem('skt-adv-bookmarks-v1', JSON.stringify(this._bookmarks)); } catch(e){}
  },

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
      // A 404/500 body is HTML — res.json() would throw anyway, but check
      // explicitly so a served-but-failed response never counts as content.
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      this._advCache[key] = j;
      return j;
    } catch(_){
      // Do NOT cache the failure — a transient network hiccup used to pin
      // "No chapters in this file" for the whole session (the books panel
      // got this same fix earlier; this path was missed).
      return { data: [] };
    }
  },


  // ── List view: grid of every adventure's cover + meta ──────────────────────
  _renderList(){
    const b = this._body; if (!b) return;
    // Snapshot scroll position before rebuild so hiding/unhiding doesn't yank
    // the user back to the top of the grid.
    const prevList = b.querySelector('.adv-list');
    const savedScrollTop = prevList ? prevList.scrollTop : 0;
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
      const coverPath = a.cover && a.cover.path ? assetUrl(a.cover.path) : '';
      const cover = coverPath
        ? `<img class="adv-card-img" crossorigin="anonymous" src="${esc(coverPath)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'adv-card-nopic',textContent:'📖',style:'cssText:width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:42px'}))">`
        : `<div class="adv-card-nopic" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:42px">📖</div>`;
      // Resume badge — shown only when the user has a bookmark and the
      // bookmarked chapter isn't 0 (chapter 0 = "haven't really started").
      const bm = this._bookmarks && this._bookmarks[a.id];
      const resumeBadge = (bm && bm.chapterIdx > 0)
        ? `<div class="adv-card-resume" title="Last visited: chapter ${bm.chapterIdx + 1}">↪ Resume ch. ${bm.chapterIdx + 1}</div>`
        : '';
      // Hide/unhide toggle — same UX as the Books panel.
      const isHidden = this._hiddenAdventures && this._hiddenAdventures.has(a.id);
      const toggleBtn = isHidden
        ? `<button class="adv-card-hide adv-card-unhide" data-act="hide-adv" data-aid="${esc(a.id)}" title="Unhide this adventure">↺</button>`
        : `<button class="adv-card-hide" data-act="hide-adv" data-aid="${esc(a.id)}" title="Hide this adventure — also excludes its content (items, monsters, etc.) from shop/search/encounter">×</button>`;
      return `<div class="adv-card${isHidden?' is-hidden':''}" role="button" tabindex="0" data-aid="${esc(a.id)}" title="${esc(a.name)}" data-build="E" style="display:flex;flex-direction:column;min-height:260px;position:relative">
        ${toggleBtn}
        <div class="adv-card-imgwrap" data-build="E" style="position:relative;width:100%;height:220px;min-height:220px;overflow:hidden;background:#444;flex:0 0 220px">
          ${cover}
          <div class="adv-card-titleover">${esc(a.name)}</div>
          ${resumeBadge}
        </div>
        <div class="adv-card-body">
          <div class="adv-card-meta">${esc(meta)}</div>
        </div>
      </div>`;
    };
    this._cardHtml = cardHtml;
    const filterQ = (this._searchQ || '').toLowerCase();
    const searched = filterQ
      ? this._adventures.filter(a => (a.name+' '+(a.storyline||'')+' '+(a.id||'')).toLowerCase().includes(filterQ))
      : this._adventures;
    const showingHidden = !!this._showHiddenAdventures;
    const visible = showingHidden ? searched : searched.filter(a => !this._hiddenAdventures.has(a.id));
    const hiddenInScope = searched.filter(a => this._hiddenAdventures.has(a.id)).length;
    const cards = visible.map(cardHtml).join('');
    const hiddenFooter = hiddenInScope > 0
      ? `<div class="adv-hidden-footer">
          <span>${hiddenInScope} adventure${hiddenInScope===1?'':'s'} hidden</span>
          <button class="btn small" id="adv-toggle-hidden">${showingHidden ? 'Hide them again' : 'Show ' + hiddenInScope + ' hidden'}</button>
          ${this._hiddenAdventures.size > 0 ? '<button class="btn small" id="adv-unhide-all">Unhide all</button>' : ''}
        </div>`
      : '';
    // Filter-scope row mirrored from the Books panel — same global state, so
    // toggling here propagates to every consumer immediately.
    const anyHidden = this._hiddenAdventures.size > 0 || (typeof window.SKT_HIDDEN_SOURCES === 'object' && window.SKT_HIDDEN_SOURCES.size > 0);
    const scope = (typeof state !== 'undefined' && state.settings && state.settings.hiddenSourceScope) || {};
    const scopeChip = (key, label, title) => {
      const on = scope[key] !== false;
      return `<button class="adv-scope-chip${on?' on':''}" data-act="toggle-scope" data-scope="${esc(key)}" title="${esc(title)}">${esc(label)}</button>`;
    };
    const scopeRow = anyHidden
      ? `<div class="adv-scope-row" title="Pick which panels honor the hidden-books/adventures filter">
          <span class="adv-scope-label">Filter applies to:</span>
          ${scopeChip('shop',      'Shop',      'Shop generator')}
          ${scopeChip('search',    'Search',    'Top-bar / global search panel')}
          ${scopeChip('bestiary',  'Bestiary',  'Bestiary panel\'s Add-Monster picker')}
          ${scopeChip('encounter', 'Encounter', 'Encounter builder dropdown')}
          ${scopeChip('loot',      'Loot',      'Loot tracker item search')}
          ${scopeChip('wildshape', 'Wild Shape','Druid Wild Shape beast picker')}
        </div>`
      : '';

    b.innerHTML = `
      <div class="adv-panel">
        <div class="adv-list-head">
          <input type="search" id="adv-search" placeholder="Filter adventures…" value="${esc(this._searchQ||'')}" autocomplete="off">
          <span class="adv-list-count">${visible.length} / ${this._adventures.length}</span>
        </div>
        ${scopeRow}
        <div class="adv-list">${cards || '<div class="empty-state" style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted)">No adventures match.</div>'}</div>
        ${hiddenFooter}
      </div>`;
    // Restore scroll position on the rebuilt list.
    const newList = b.querySelector('.adv-list');
    if (newList && savedScrollTop) newList.scrollTop = savedScrollTop;
    // Wire hide / unhide + footer controls.
    b.querySelectorAll('[data-act="hide-adv"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        this._toggleAdventureHidden(btn.dataset.aid);
      });
    });
    b.querySelector('#adv-toggle-hidden')?.addEventListener('click', () => {
      this._showHiddenAdventures = !this._showHiddenAdventures;
      this._render();
    });
    b.querySelector('#adv-unhide-all')?.addEventListener('click', () => {
      this._hiddenAdventures.clear();
      this._saveHiddenAdventures();
      this._render();
    });
    // Per-consumer scope chip clicks — flip the corresponding flag in
    // state.settings.hiddenSourceScope. Shared with the Books panel.
    b.querySelectorAll('[data-act="toggle-scope"]').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.scope;
      if (!state.settings.hiddenSourceScope){
        state.settings.hiddenSourceScope = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.hiddenSourceScope));
      }
      const cur = state.settings.hiddenSourceScope[k] !== false;
      state.settings.hiddenSourceScope[k] = !cur;
      save();
      this._render();
    }));
    const search = b.querySelector('#adv-search');
    if (search){
      search.addEventListener('input', e => {
        this._searchQ = e.target.value;
        // Debounce + full re-render so the hidden-adventures filter and
        // footer stay in sync with the typed query.
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
          this._render();
          const newSearch = this._body?.querySelector('#adv-search');
          if (newSearch){
            newSearch.focus();
            try { newSearch.setSelectionRange(this._searchQ.length, this._searchQ.length); } catch(e){}
          }
        }, 60);
      });
    }
    this._wireCards();
  },












});

// Pull in the behaviour shared with the Books panel.
applyContentPanelShared('adventures');
