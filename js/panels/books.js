// ============================================================
// BOOKS PANEL
// ============================================================
// Clone of the Adventures panel pointed at data/book/. The renderer (entry
// types, area links, hover popovers, image inlining) is identical — books
// and adventures use the same 5etools JSON schema. Only the fetch paths,
// panel id, and bookmark localStorage key differ.

// Eagerly publish the user's hidden-sources set as a lowercase Set on
// `window` so every panel that filters by source (shop generator, encounter
// builder, search results, bestiary picker, etc.) can do
//   if (window.SKT_HIDDEN_SOURCES?.has((src||'').toLowerCase())) return false;
// without waiting for the Books / Adventures panel to be mounted.
// The set is the UNION of two storage keys:
//   • skt-books-hidden-v1      — hidden book IDs (managed by Books panel)
//   • skt-adventures-hidden-v1 — hidden adventure IDs (managed by Adventures
//                                 panel)
// Adventures contribute items, monsters, etc. to _5eData with their adventure
// codes as `_source` (e.g. SKT, ToA, WDH), so adventures need to be filterable
// alongside books for the source filter to be universal.
// Normalize a source/id string so book ids ("PS-K", "GoS") match the
// corresponding monster source codes ("PSK", "GOS") that lack the dash /
// case match. Used on BOTH sides of every comparison so the set lookups
// work regardless of which form the stored key took.
window.SKT_NORMALIZE_SOURCE = function(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]/g, '');
};
window.SKT_HIDDEN_SOURCES_REBUILD = function(){
  const out = new Set();
  const add = (key) => {
    try {
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      (Array.isArray(arr) ? arr : []).forEach(s => out.add(window.SKT_NORMALIZE_SOURCE(s)));
    } catch(e){}
  };
  add('skt-books-hidden-v1');
  add('skt-adventures-hidden-v1');
  window.SKT_HIDDEN_SOURCES = out;
  // Version counter so search.js can memoize its filtered pool and know when
  // to invalidate — bumped here so every caller of REBUILD is covered.
  window.SKT_SOURCE_FILTER_VERSION = (window.SKT_SOURCE_FILTER_VERSION || 0) + 1;
};
window.SKT_HIDDEN_SOURCES_REBUILD();

// Per-consumer scope test — consumers (shop, search, bestiary picker,
// encounter builder, loot tracker) call this with their own key ('shop',
// 'search', etc.) plus a source string. Returns true if the source should
// be hidden from THIS consumer specifically. Honors:
//   • state.settings.hiddenSourceScope[<consumer>]  — per-consumer on/off
//   • window.SKT_HIDDEN_SOURCES                       — the merged hidden set
// Designed to be the single function every consumer calls; if the user
// later wants per-book per-consumer rules, this is the place to extend.
window.SKT_IS_SOURCE_HIDDEN = function(consumer, source){
  if (!source) return false;
  const scope = (typeof state !== 'undefined' && state.settings && state.settings.hiddenSourceScope) || {};
  // Default to true (filter applies) when the key is missing so behavior
  // doesn't change for existing setups that pre-date this feature.
  const enabled = scope[consumer] !== false;
  if (!enabled) return false;
  const hidden = window.SKT_HIDDEN_SOURCES;
  // Normalize the source the same way SKT_HIDDEN_SOURCES_REBUILD normalizes
  // hidden ids — strip non-alphanumerics + lowercase. Otherwise book ids
  // like "PS-K" never match monster sources like "PSK".
  const norm = (typeof window.SKT_NORMALIZE_SOURCE === 'function')
    ? window.SKT_NORMALIZE_SOURCE(source)
    : String(source).toLowerCase();
  return !!(hidden && hidden.has(norm));
};

registerPanel('books', {
  // Read by CONTENT_PANEL_SHARED (js/panels/content-panel.js).
  _kindLabel: 'Book',

  title: 'Books', icon: '📚',
  _adventures: null,        // index from books.json (sorted) — name kept for code parity with adventures.js
  _advCache: {},            // { bookIdLower: parsedFile }
  _currentAdvId: null,      // null = list view; otherwise one book
  _currentChapterIdx: 0,
  _loading: false,
  // Bookmarks: { [bookId]: { chapterIdx, ts } } — persisted per-browser.
  // Separate key from the adventures panel so per-book and per-adventure
  // progress don't trample each other.
  _bookmarks: null,

  // Hidden books — Set of book IDs the user has tucked away from the index.
  // Persisted under its own localStorage key so it survives reloads. Default
  // empty (show everything). Toggled via the × on each card; restored
  // via the "Show N hidden" footer link.
  _hiddenBooks: null,

  mount(body){
    this._body = body;
    if (!this._bookmarks){
      try { this._bookmarks = JSON.parse(localStorage.getItem('skt-book-bookmarks-v1') || '{}') || {}; }
      catch(e){ this._bookmarks = {}; }
    }
    if (!this._hiddenBooks){
      try {
        const arr = JSON.parse(localStorage.getItem('skt-books-hidden-v1') || '[]');
        this._hiddenBooks = new Set(Array.isArray(arr) ? arr : []);
      } catch(e){ this._hiddenBooks = new Set(); }
    }
    // Make sure the merged global is up to date — Adventures panel may have
    // mutated its hidden list before Books was opened.
    if (typeof window.SKT_HIDDEN_SOURCES_REBUILD === 'function') window.SKT_HIDDEN_SOURCES_REBUILD();
    // Cross-tab sync. Hidden-books and bookmarks are browser-local
    // (skt-books-hidden-v1 / skt-book-bookmarks-v1) and hidden-books only
    // round-trips through Firebase slowly — so a second tab in the SAME browser
    // never saw the change. The native `storage` event fires in other tabs the
    // instant these keys change; re-read + re-render off it. Attached once.
    if (!this._onStorage){
      this._onStorage = (e) => {
        if (!this._body || !e) return;
        if (e.key === 'skt-books-hidden-v1'){
          try { const arr = JSON.parse(e.newValue || '[]'); this._hiddenBooks = new Set(Array.isArray(arr) ? arr : []); }
          catch(_){ this._hiddenBooks = new Set(); }
          if (typeof window.SKT_HIDDEN_SOURCES_REBUILD === 'function') window.SKT_HIDDEN_SOURCES_REBUILD();
          this._render();
        } else if (e.key === 'skt-book-bookmarks-v1'){
          try { this._bookmarks = JSON.parse(e.newValue || '{}') || {}; } catch(_){ this._bookmarks = {}; }
          if (!this._currentAdvId) this._render(); // list view shows resume badges
        }
      };
      window.addEventListener('storage', this._onStorage);
    }
    this._render();
    this._loadIndex();
    // When the 5etools side data finishes loading, re-render the open chapter
    // so injected class/race/spell/etc. content fills in. One-shot per mount.
    if (typeof on5eLoaded === 'function' && !this._sideDataHook){
      this._sideDataHook = true;
      on5eLoaded(() => { if (this._body && this._currentAdvId) this._render(); });
    }
  },

  _saveHiddenBooks(){
    try { localStorage.setItem('skt-books-hidden-v1', JSON.stringify([...this._hiddenBooks])); } catch(e){}
    // Rebuild the global helper cache so other panels (shop, encounter,
    // bestiary, etc.) see the change immediately without remounting. The
    // rebuild merges hidden books + hidden adventures into one Set.
    if (typeof window.SKT_HIDDEN_SOURCES_REBUILD === 'function') window.SKT_HIDDEN_SOURCES_REBUILD();
  },
  _toggleBookHidden(id){
    if (!this._hiddenBooks) this._hiddenBooks = new Set();
    if (this._hiddenBooks.has(id)) this._hiddenBooks.delete(id);
    else this._hiddenBooks.add(id);
    this._saveHiddenBooks();
    this._render();
  },

  _bumpBookmark(){
    if (!this._currentAdvId) return;
    this._bookmarks[this._currentAdvId] = { chapterIdx: this._currentChapterIdx, ts: Date.now() };
    try { localStorage.setItem('skt-book-bookmarks-v1', JSON.stringify(this._bookmarks)); } catch(e){}
  },

  async _loadIndex(){
    if (this._adventures) return;
    try {
      const res = await fetch('data/books.json');
      const j = await res.json();
      this._adventures = (j.book || []).slice().sort((a,b) => a.name.localeCompare(b.name));
      if (this._body && !this._currentAdvId) this._render();
    } catch(_){ this._adventures = []; if (this._body) this._render(); }
  },

  async _loadAdventure(id){
    const key = (id||'').toLowerCase();
    if (this._advCache[key]) return this._advCache[key];
    try {
      const res = await fetch('data/book/book-' + key + '.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      this._advCache[key] = j;
      return j;
    } catch(_){
      // Do NOT cache the failure. A transient network error (or a fetch that
      // raced page load) would otherwise pin this adventure to "empty" for the
      // rest of the session. Return a throwaway empty shape and leave the cache
      // slot open so the next open retries the fetch.
      return { data: [] };
    }
  },


  // ── List view: grid of every adventure's cover + meta ──────────────────────
  _renderList(){
    const b = this._body; if (!b) return;
    // Snapshot the scroll position of the book grid so a re-render (triggered
    // by hiding/unhiding a book, typing in the search box, etc.) doesn't yank
    // the user back to the top.
    const prevList = b.querySelector('.adv-list');
    const savedScrollTop = prevList ? prevList.scrollTop : 0;
    if (!this._adventures){
      b.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center">Loading books…</div>';
      return;
    }
    if (!this._adventures.length){
      b.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center">No books available.</div>';
      return;
    }
    const cardHtml = a => {
      // Books use `author` + `group` (e.g. "core", "supplement") instead of
      // the adventure level/storyline fields. Capitalise the group label
      // since the JSON ships it lowercase.
      const group = a.group ? a.group.charAt(0).toUpperCase() + a.group.slice(1) : '';
      const meta = [group, a.author, a.published].filter(Boolean).join(' · ');
      const coverPath = a.cover && a.cover.path ? assetUrl(a.cover.path) : '';
      const cover = coverPath
        ? `<img class="adv-card-img" crossorigin="anonymous" src="${esc(coverPath)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'adv-card-nopic',textContent:'📚',style:'cssText:width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:42px'}))">`
        : `<div class="adv-card-nopic" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:42px">📚</div>`;
      // Resume badge — shown only when the user has a bookmark and the
      // bookmarked chapter isn't 0 (chapter 0 = "haven't really started").
      const bm = this._bookmarks && this._bookmarks[a.id];
      const resumeBadge = (bm && bm.chapterIdx > 0)
        ? `<div class="adv-card-resume" title="Last visited: chapter ${bm.chapterIdx + 1}">↪ Resume ch. ${bm.chapterIdx + 1}</div>`
        : '';
      // Toggle button morphs based on the book's current hidden state. When
      // the book is HIDDEN (and the user is in "Show N hidden" peek mode so
      // they can actually see it), the button shows ↺ for "restore" instead
      // of × for "hide", with matching tooltip + accent styling. Clicking
      // either flips the state via the same _toggleBookHidden handler.
      const isHidden = this._hiddenBooks && this._hiddenBooks.has(a.id);
      const toggleBtn = isHidden
        ? `<button class="adv-card-hide adv-card-unhide" data-act="hide-book" data-aid="${esc(a.id)}" title="Unhide this book">↺</button>`
        : `<button class="adv-card-hide" data-act="hide-book" data-aid="${esc(a.id)}" title="Hide this book from the list (can be restored from the footer below)">×</button>`;
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
    // First narrow by search query (if any), then filter out hidden books.
    // We track the filtered-pre-hide count and the hidden count separately
    // so the footer can offer to restore them.
    const searched = filterQ
      ? this._adventures.filter(a => (a.name+' '+(a.author||'')+' '+(a.group||'')+' '+(a.id||'')).toLowerCase().includes(filterQ))
      : this._adventures;
    const showingHidden = !!this._showHiddenBooks;
    const visible = showingHidden ? searched : searched.filter(a => !this._hiddenBooks.has(a.id));
    const hiddenInScope = searched.filter(a => this._hiddenBooks.has(a.id)).length;
    const cards = visible.map(cardHtml).join('');
    const hiddenFooter = hiddenInScope > 0
      ? `<div class="adv-hidden-footer">
          <span>${hiddenInScope} book${hiddenInScope===1?'':'s'} hidden</span>
          <button class="btn small" id="adv-toggle-hidden">${showingHidden ? 'Hide them again' : 'Show ' + hiddenInScope + ' hidden'}</button>
          ${this._hiddenBooks.size > 0 ? '<button class="btn small" id="adv-unhide-all">Unhide all</button>' : ''}
        </div>`
      : '';
    // Filter-scope row — only meaningful when at least one book/adventure is
    // hidden. Lets the user pick which consumers (shop, search, bestiary,
    // encounter, loot) respect the hidden list. Default all on.
    const anyHidden = this._hiddenBooks.size > 0 || (typeof window.SKT_HIDDEN_SOURCES === 'object' && window.SKT_HIDDEN_SOURCES.size > 0);
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
          <input type="search" id="adv-search" placeholder="🔎 Filter books…" value="${esc(this._searchQ||'')}" autocomplete="off">
          <span class="adv-list-count">${visible.length} / ${this._adventures.length}</span>
        </div>
        ${scopeRow}
        <div class="adv-list">${cards || '<div class="empty-state" style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted)">No books match.</div>'}</div>
        ${hiddenFooter}
      </div>`;
    // Restore the scroll position on the freshly-built list so hiding a
    // book in the middle of the catalog doesn't fling the user to the top.
    const newList = b.querySelector('.adv-list');
    if (newList && savedScrollTop){ newList.scrollTop = savedScrollTop; }
    // Hide button click — also stops the card's own click (which would open
    // the book) since the × sits inside the card's bounds.
    b.querySelectorAll('[data-act="hide-book"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        this._toggleBookHidden(btn.dataset.aid);
      });
    });
    b.querySelector('#adv-toggle-hidden')?.addEventListener('click', () => {
      this._showHiddenBooks = !this._showHiddenBooks;
      this._render();
    });
    b.querySelector('#adv-unhide-all')?.addEventListener('click', () => {
      this._hiddenBooks.clear();
      this._saveHiddenBooks();
      this._render();
    });
    // Per-consumer scope chip clicks — flip the corresponding flag in
    // state.settings.hiddenSourceScope. `save()` rides the existing workspace
    // sync so the choice propagates to every connected tab via Firebase.
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
        // Debounce + full re-render so the hidden-books filter and footer
        // both update with the search query. Cheap because the index is small.
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
          this._render();
          // Restore focus + caret position so typing isn't interrupted.
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











  // Many 5etools books — most notably the PHB / DMG — store only chapter
  // intros and rules text. The actual class/race/spell/item/etc. content
  // lives in separate side files (data/class/*, data/spells/*, etc.) and is
  // referenced via {@class Foo} tags. Without this injection step the user
  // sees "Classes" with three paragraphs of intro and nothing else.
  //
  // We detect intent from the chapter name, pull matching rows from _5eData
  // filtered by the book's id (= source), and render them with the existing
  // detail renderers from search.js. Result: each class chapter shows full
  // class progression + every subclass; each spell chapter shows every spell.
  _injectChapterReferenceContent(chapter, book){
    if (typeof _5eData === 'undefined' || !_5eLoaded || !chapter || !book) return '';
    const name = String(chapter.name || '').toLowerCase();
    const bookId = String(book.id || '').toLowerCase();
    if (!bookId) return '';
    const matchSource = d => String(d._source || '').toLowerCase() === bookId;

    // Pretty-print a list of rows under a single category. `renderer(d)`
    // returns HTML; we wrap each with its name + meta header so the page
    // reads like a normal book chapter.
    const renderRows = (rows, renderer, headingLvl) => {
      const tag = 'h' + (headingLvl || 3);
      return rows.map(d => {
        const meta = d.meta ? `<div class="adv-ref-meta">${esc(d.meta)}</div>` : '';
        let body = '';
        try { body = renderer(d) || ''; } catch(e){ body = ''; }
        if (!body) return '';
        return `<section class="adv-ref-block">
          <${tag} class="adv-ref-head">${esc(d.name)}</${tag}>
          ${meta}
          <div class="adv-ref-body">${body}</div>
        </section>`;
      }).join('');
    };

    let out = '';

    // ─── Classes (+ subclasses nested under each parent) ─────────────────────
    if (/^(classes?|character classes)/.test(name)){
      // Parent classes have classFeatures[] in _raw; subclasses have
      // subclassFeatures[]. Bucket and pair them by className.
      const all = _5eData.filter(d => d.cat === 'class' && matchSource(d));
      const parents = all.filter(d => d._raw && Array.isArray(d._raw.classFeatures));
      const subsByClass = {};
      all.filter(d => d._raw && Array.isArray(d._raw.subclassFeatures)).forEach(d => {
        const cn = String(d._raw.className||'').toLowerCase();
        (subsByClass[cn] = subsByClass[cn] || []).push(d);
      });
      parents.sort((a,b) => a.name.localeCompare(b.name));
      parents.forEach(p => {
        let body = '';
        try { body = (typeof renderClassFull === 'function') ? renderClassFull(p) : ''; } catch(e){}
        out += `<section class="adv-ref-block adv-ref-class">
          <h2 class="adv-ref-head">${esc(p.name)}</h2>
          <div class="adv-ref-body">${body}</div>`;
        const subs = subsByClass[p.name.toLowerCase()] || [];
        if (subs.length){
          subs.sort((a,b) => a.name.localeCompare(b.name));
          out += `<h3 class="adv-ref-subhead">${esc(p.name)} Subclasses</h3>`;
          subs.forEach(s => {
            let sb = '';
            try { sb = (typeof renderSubclassFull === 'function') ? renderSubclassFull(s) : ''; } catch(e){}
            out += `<section class="adv-ref-block adv-ref-subclass">
              <h4 class="adv-ref-head">${esc(s.name)}</h4>
              <div class="adv-ref-body">${sb}</div>
            </section>`;
          });
        }
        out += '</section>';
      });
    }

    // ─── Races (+ subraces grouped under each parent race) ───────────────────
    else if (/^(races?|character races)/.test(name)){
      const rows = _5eData.filter(d => d.cat === 'race' && matchSource(d));
      rows.sort((a,b) => a.name.localeCompare(b.name));
      out += renderRows(rows, renderRaceFull, 2);
    }

    // ─── Spells ──────────────────────────────────────────────────────────────
    else if (/^spells?$/.test(name) || /^spell\s*lists?$/.test(name)){
      const rows = _5eData.filter(d => d.cat === 'spell' && matchSource(d));
      rows.sort((a,b) => a.name.localeCompare(b.name));
      out += renderRows(rows, renderSpellFull, 3);
    }

    // ─── Equipment / Items ───────────────────────────────────────────────────
    else if (/^(equipment|magic items?|items?|treasure|magical items?)/.test(name)){
      const rows = _5eData.filter(d => d.cat === 'item' && matchSource(d));
      rows.sort((a,b) => a.name.localeCompare(b.name));
      out += renderRows(rows, renderItemFull, 3);
    }

    // ─── Backgrounds ─────────────────────────────────────────────────────────
    else if (/(personality and background|backgrounds?)/.test(name)){
      const rows = _5eData.filter(d => d.cat === 'background' && matchSource(d));
      rows.sort((a,b) => a.name.localeCompare(b.name));
      out += renderRows(rows, renderBackgroundFull, 3);
    }

    // ─── Feats (PHB calls the chapter "Customization Options") ───────────────
    else if (/(feats?|customization options)/.test(name)){
      const rows = _5eData.filter(d => d.cat === 'feat' && matchSource(d));
      rows.sort((a,b) => a.name.localeCompare(b.name));
      out += renderRows(rows, renderFeatFull, 3);
    }

    // ─── Conditions ──────────────────────────────────────────────────────────
    else if (/^conditions?$/.test(name)){
      const rows = _5eData.filter(d => d.cat === 'condition' && matchSource(d));
      rows.sort((a,b) => a.name.localeCompare(b.name));
      out += renderRows(rows, renderConditionFull, 3);
    }

    // ─── Deities ─────────────────────────────────────────────────────────────
    else if (/(gods of the multiverse|deities|pantheons?)/.test(name)){
      const rows = _5eData.filter(d => d.cat === 'deity' && matchSource(d));
      rows.sort((a,b) => a.name.localeCompare(b.name));
      out += renderRows(rows, renderDeityFull, 3);
    }

    // ─── Monsters / Bestiary ─────────────────────────────────────────────────
    else if (/(monsters?|bestiary|creatures?)/.test(name)){
      const rows = _5eData.filter(d => d.cat === 'monster' && matchSource(d));
      rows.sort((a,b) => a.name.localeCompare(b.name));
      // Monster renderer expects a second arg (localData); empty object is fine.
      out += renderRows(rows, d => renderMonsterFull(d, {}), 3);
    }

    if (out){
      return `<div class="adv-ref-injected"><div class="adv-ref-note">📚 The following content is sourced from the side data files (5etools convention) since the book file only stores chapter intros.</div>${out}</div>`;
    }
    return '';
  },


});

// Pull in the behaviour shared with the Adventures panel.
applyContentPanelShared('books');
