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
  unmount(){ this._body = null; },

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
      const coverPath = a.cover && a.cover.path ? 'img/' + a.cover.path : '';
      const cover = coverPath
        ? `<img class="adv-card-img" src="${esc(coverPath)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'adv-card-nopic',textContent:'📚',style:'cssText:width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:42px'}))">`
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
        <div class="adv-list">${cards || '<div class="empty-state" style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted)">No adventures match.</div>'}</div>
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

  _wireCards(){
    const b = this._body; if (!b) return;
    b.querySelectorAll('.adv-card').forEach(c => {
      const open = async () => {
        this._currentAdvId = c.dataset.aid;
        // Restore last-visited chapter for this adventure if we have one.
        const bm = this._bookmarks && this._bookmarks[this._currentAdvId];
        this._currentChapterIdx = (bm && Number.isInteger(bm.chapterIdx)) ? bm.chapterIdx : 0;
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
            <button class="btn small" data-act="back">← All books</button>
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

    const extraHtml = ch ? this._injectChapterReferenceContent(ch, adv) : '';
    const contentHtml = ch
      ? `<h2 class="adv-content-title">${esc(ch.name||'')}</h2>${this._renderChapterEntries(ch)}${extraHtml}`
      : '<div class="empty-state" style="padding:30px">Empty chapter.</div>';

    b.innerHTML = `
      <div class="adv-panel adv-panel-detail">
        <div class="adv-head">
          <button class="btn small" data-act="back">← All books</button>
          <span class="adv-head-title">${esc(adv.name)}</span>
          <span class="adv-head-meta">${esc((adv.source||'')+(adv.published?(' · '+adv.published):''))}</span>
          <span style="flex:1"></span>
          <button class="btn small" data-act="print" title="Open a print-friendly view (chapter picker + browser Print → save as PDF)">🖨 Print / Export</button>
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
    b.querySelector('[data-act="print"]')?.addEventListener('click', () => this._openPrintPicker(adv, file));
    b.querySelectorAll('.adv-chapter').forEach(btn => btn.addEventListener('click', () => {
      this._currentChapterIdx = +btn.dataset.ci;
      this._bumpBookmark();
      this._render();
      // Scroll the new chapter content to the top.
      const c = this._body?.querySelector('#adv-content');
      if (c) c.scrollTop = 0;
    }));

    // Hover popovers for {@creature}, {@spell}, {@item}, {@condition}.
    this._wireAdvHover();

    // Area links: click to scroll to the matching section.
    b.querySelectorAll('.adv-link.adv-area').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const id = a.dataset.chapter;
      if (!id) return;
      const target = b.querySelector('#adv-section-' + CSS.escape(id));
      const scroller = b.querySelector('#adv-content');
      if (target && scroller){
        // Use offsetTop relative to the scroller, not scrollIntoView (which
        // scrolls the wrong ancestor when nested in the workspace).
        scroller.scrollTo({ top: target.offsetTop - 8, behavior: 'smooth' });
      }
    }));
  },

  // Event-delegate hover behaviour. One popover element exists at document
  // level; we just point it at the currently-hovered .adv-tag span.
  _wireAdvHover(){
    const b = this._body; if (!b) return;
    if (!this._advHover){
      this._advHover = { enterTimer: null, leaveTimer: null, currentEl: null, pop: null };
    }
    const H = this._advHover;
    // Tear down any previous listeners on this panel body (we re-wire every
    // render).
    if (H._handlers){
      b.removeEventListener('mouseover', H._handlers.over, true);
      b.removeEventListener('mouseout',  H._handlers.out,  true);
      b.removeEventListener('scroll',    H._handlers.scroll, true);
    }
    const ensurePop = () => {
      if (H.pop && document.body.contains(H.pop)) return H.pop;
      const p = document.createElement('div');
      p.id = 'adv-hover-pop';
      p.style.display = 'none';
      p.addEventListener('mouseenter', () => { clearTimeout(H.leaveTimer); H.leaveTimer = null; });
      p.addEventListener('mouseleave', scheduleHide);
      document.body.appendChild(p);
      H.pop = p;
      return p;
    };
    const hide = () => {
      const p = H.pop; if (p) p.style.display = 'none';
      H.currentEl = null;
    };
    const scheduleHide = () => {
      clearTimeout(H.leaveTimer);
      H.leaveTimer = setTimeout(hide, 150);
    };
    const positionPop = (anchorRect) => {
      const p = H.pop;
      // Render off-screen first to measure.
      p.style.left = '-9999px'; p.style.top = '-9999px';
      p.style.display = 'block';
      const pw = p.offsetWidth || 360;
      const ph = p.offsetHeight || 220;
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = anchorRect.right + 8;
      let top  = anchorRect.top;
      if (left + pw > vw - 8) left = Math.max(8, anchorRect.left - pw - 8); // flip to the left
      if (top + ph > vh - 8)  top  = Math.max(8, vh - ph - 8);
      if (top < 8) top = 8;
      p.style.left = left + 'px';
      p.style.top  = top + 'px';
    };
    const show = (el) => {
      const pop = ensurePop();
      H.currentEl = el;
      pop.innerHTML = this._renderAdvPop(el.dataset.tag, el.dataset.name, el.dataset.source);
      positionPop(el.getBoundingClientRect());
    };
    const onOver = e => {
      const el = e.target.closest && e.target.closest('.adv-tag');
      if (!el || !b.contains(el)) return;
      clearTimeout(H.leaveTimer); H.leaveTimer = null;
      if (H.currentEl === el) return;
      clearTimeout(H.enterTimer);
      H.enterTimer = setTimeout(() => show(el), 250);
    };
    const onOut = e => {
      const el = e.target.closest && e.target.closest('.adv-tag');
      if (!el) return;
      clearTimeout(H.enterTimer); H.enterTimer = null;
      scheduleHide();
    };
    const onScroll = () => { clearTimeout(H.enterTimer); hide(); };
    b.addEventListener('mouseover', onOver, true);
    b.addEventListener('mouseout',  onOut,  true);
    // The chapter content scroller emits scroll on its own element, not the
    // body. Capture-phase listener on the body sees it bubble.
    b.addEventListener('scroll', onScroll, true);
    H._handlers = { over:onOver, out:onOut, scroll:onScroll };
    // Esc to dismiss.
    if (!H._escWired){
      document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
      H._escWired = true;
    }
  },

  // Inline string → HTML. The default pipeline strips 5etools tags to plain
  // text. For the adventure panel we want creature/spell/item/condition refs
  // to render as hoverable spans and area refs as click-to-jump links. We
  // capture those tags BEFORE _stripTags sees them, swap in safe placeholder
  // sentinels (`\x10N\x10`), run the original strip/escape/render pipeline,
  // then substitute the sentinels with the real HTML.
  _inline(str){
    if (typeof _stripTags !== 'function' || typeof _renderInline !== 'function'){
      return esc(String(str ?? ''));
    }
    const s = String(str ?? '');
    const placeholders = [];
    // Hoverable reference tags + the few link-style ones (area, adventure,
    // book). Everything else continues to flow through _stripTags as-is.
    const TAGS_RE = /\{@(creature|spell|item|itemProperty|itemMastery|condition|status|disease|background|race|feat|optfeature|class|classFeature|subclassFeature|deity|object|vehicle|reward|psionic|trap|hazard|variantrule|table|language|cult|boon|action|skill|sense|charoption|facility|deck|encounter|recipe|area|adventure|book)\s+([^}]+)\}/gi;
    const marked = s.replace(TAGS_RE, (_full, tag, body) => {
      const idx = placeholders.length;
      placeholders.push({ tag: tag.toLowerCase(), body });
      return '\x10' + idx + '\x10';
    });
    let html = _renderInline(esc(_stripTags(marked)));
    html = html.replace(/\x10(\d+)\x10/g, (_m, idxStr) => {
      const ph = placeholders[+idxStr];
      return ph ? this._renderAdvTag(ph.tag, ph.body) : '';
    });
    return html;
  },

  // Tag → _5eData.cat lookup map. Covers every category the loader knows
  // about. Tags whose intended target is a specialised file (e.g. status
  // = condition) fold into the right cat here.
  _ADV_TAG_CAT: {
    creature:'monster', spell:'spell',
    item:'item', itemProperty:'item', itemMastery:'item',
    condition:'condition', status:'condition', disease:'condition',
    background:'background', race:'race', feat:'feat',
    optfeature:'optionalfeature',
    class:'class', classFeature:'classFeature', subclassFeature:'classFeature',
    deity:'deity', object:'object', vehicle:'vehicle', reward:'reward',
    psionic:'psionic', trap:'trap', hazard:'hazard',
    variantrule:'variantrule', table:'table', language:'language',
    cult:'cult', boon:'boon',
    action:'action', skill:'skill', sense:'sense',
    charoption:'charoption', facility:'facility',
    deck:'deck', encounter:'encounter', recipe:'recipe',
  },

  // Wrap a captured {@…} reference as either a hover span (creature/spell/
  // item/condition) or a click-to-jump link (area). `body` is the raw text
  // between the tag name and the closing brace, pipe-delimited:
  //   {@creature Goblin Warrior|MM|goblin}
  //   {@area area 1|001|x}
  _renderAdvTag(tag, body){
    const parts = body.split('|').map(p => p.trim());
    if (tag === 'area'){
      const display = parts[0] || 'area';
      const chapter = parts[1] || '';
      return '<a class="adv-link adv-area" href="javascript:void(0)" data-chapter="'
        + esc(chapter) + '">' + esc(display) + '</a>';
    }
    if (tag === 'adventure' || tag === 'book'){
      // Meta refs to source books/adventures — no popover. Show as a subtle
      // styled span so the user can tell it's a reference, not body text.
      const display = parts[2] || parts[0] || '';
      const titleAttr = parts[0] ? ' title="' + esc(parts[0]) + '"' : '';
      return '<span class="adv-link-source"' + titleAttr + '>' + esc(display) + '</span>';
    }
    const name    = parts[0] || '';
    const source  = parts[1] || '';
    const display = parts[2] || name;
    return '<span class="adv-tag" data-tag="' + esc(tag)
      + '" data-name="' + esc(name) + '" data-source="' + esc(source)
      + '">' + esc(display) + '</span>';
  },

  // Find a 5etools entry by category + name (+ optional source). Returns
  // null if data isn't loaded yet or no match found. Uses the _ADV_TAG_CAT
  // map to translate the tag name into the actual `cat` value the loader
  // stores entries under (so e.g. {@status} hits cat='condition').
  _lookup(tag, name, source){
    if (typeof _5eData === 'undefined' || !_5eData) return null;
    if (typeof _5eLoaded !== 'undefined' && !_5eLoaded) return null;
    const cat = this._ADV_TAG_CAT[tag];
    if (!cat || !name) return null;
    const nlow = name.toLowerCase();
    const slow = (source||'').toLowerCase();
    let best = null;
    for (const d of _5eData){
      if (d.cat !== cat) continue;
      if ((d.name||'').toLowerCase() !== nlow) continue;
      if (slow && (d._source||'').toLowerCase() === slow) return d;
      if (!best) best = d;
    }
    return best;
  },

  // Generic card renderer. Works for any category whose loader stores the
  // raw 5etools JSON under d._raw (every category does). Renders the name,
  // an optional meta line, and the entries array. Because _renderNode
  // recurses through _inline → _renderAdvTag, tags inside the popover are
  // themselves hoverable.
  _renderGenericCard(d){
    const r = d && d._raw; if (!r) return '<div class="adv-pop-empty">No data.</div>';
    const sub = d.meta ? '<div class="adv-pop-sub">' + esc(d.meta) + '</div>' : '';
    let head = '<div class="adv-pop-head"><strong>' + esc(d.name) + '</strong>' + sub + '</div>';
    // Item-specific extras: rarity / attunement aren't in `entries`.
    if (d.cat === 'item'){
      const rarity = r.rarity && r.rarity !== 'none' ? r.rarity : '';
      const attune = r.reqAttune
        ? ' (requires attunement' + (typeof r.reqAttune === 'string' && r.reqAttune !== true ? ' ' + r.reqAttune : '') + ')'
        : '';
      if (rarity || attune){
        head = '<div class="adv-pop-head"><strong>' + esc(d.name) + '</strong>'
          + '<div class="adv-pop-sub">' + esc(rarity) + esc(attune) + '</div></div>';
      }
    }
    const entries = Array.isArray(r.entries) ? r.entries : [];
    const body = entries.length
      ? entries.map(e => typeof e === 'string'
          ? '<p>' + this._inline(e) + '</p>'
          : this._renderNode(e)).join('')
      : (d.desc ? '<p>' + esc(d.desc) + '</p>' : '<div class="adv-pop-empty">No description.</div>');
    return head + '<div class="adv-pop-body">' + body + '</div>';
  },

  // Build the HTML body for a tooltip pop given the span's dataset.
  // Creature / spell / item get specialised renderers from search.js since
  // their data shape is non-trivial (items have `desc` as a parsed control-
  // char string rather than an `entries` array, and the rich card needs the
  // weapon/armor stats too). Everything else uses the generic entries path.
  _renderAdvPop(tag, name, source){
    const d = this._lookup(tag, name, source);
    if (!d) return '<div class="adv-pop-empty"><strong>' + esc(name) + '</strong><br><span style="color:var(--text-dim);font-size:11px">Reference unavailable (no local data)</span></div>';
    // Pre-render the name header so every card has the title up top —
    // the search-panel renderers (creature/spell/item) don't include one
    // because the search UI shows the name separately above the card.
    const sub = d.meta ? '<div class="adv-pop-sub">' + esc(d.meta) + '</div>' : '';
    const head = '<div class="adv-pop-head"><strong>' + esc(d.name) + '</strong>' + sub + '</div>';
    if (tag === 'creature' && typeof renderMonsterFull === 'function') return head + renderMonsterFull(d, {});
    if (tag === 'spell'    && typeof renderSpellFull   === 'function') return head + renderSpellFull(d);
    if (d.cat === 'item'   && typeof renderItemFull    === 'function') return head + renderItemFull(d);
    // _renderGenericCard already emits its own head — don't double up.
    return this._renderGenericCard(d);
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
        const idAttr = node.id ? ` id="adv-section-${esc(String(node.id))}"` : '';
        return `<section class="adv-section"${idAttr}>${head}${renderChildren(node.entries)}</section>`;
      }
      case 'item': {
        // 5etools "item" inside a list → bold name + inline body. The shape
        // varies — 3000+ items in the book corpus use `entry` (singular
        // string) instead of `entries` (array). Honor both so single-line
        // definitions don't render as just a bold name with no body.
        const name = node.name ? `<strong>${this._inline(node.name)}${node.nameDot===false?'':'.'}</strong> ` : '';
        let body = '';
        if (typeof node.entry === 'string'){
          body = this._inline(node.entry);
        } else if (Array.isArray(node.entries)){
          body = node.entries.map(e => typeof e==='string' ? this._inline(e) : this._renderNode(e)).join(' ');
        }
        return `<p class="adv-item">${name}${body}</p>`;
      }
      case 'abilityGeneric': {
        // Tiny "10 + modifiers" style rule lines. The whole entry lives in
        // node.text — there's no entries array — so we render it inline with
        // an optional bold name prefix.
        const name = node.name ? `<strong>${this._inline(node.name)}.</strong> ` : '';
        return `<p class="adv-item">${name}${this._inline(node.text||'')}</p>`;
      }
      case 'hr':
        return '<hr class="adv-hr">';
      case 'variantInner':
      case 'variant': {
        // Inline variant rule callout. variantInner has the name + nested
        // entries; without the name fallback users lose the heading.
        const head = node.name ? `<h4 class="adv-variant-head">${this._inline(node.name)}</h4>` : '';
        return `<aside class="adv-variant">${head}${renderChildren(node.entries)}</aside>`;
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
            // Cell objects carry their text in `entry` (singular). Without
            // this, ~145 tables in the book corpus rendered empty cells.
            if (c && c.type === 'cell' && typeof c.entry === 'string') return `<td>${this._inline(c.entry)}</td>`;
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

  // Print/export — same flow as Adventures (clone). Picker → new tab with
  // print-friendly stylesheet → user uses File → Print.
  _openPrintPicker(adv, file){
    const chapters = (file && file.data) || [];
    if (!chapters.length){
      if (typeof showToast === 'function') showToast('No chapters to print');
      return;
    }
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:520px;max-width:92vw;max-height:90vh;display:flex;flex-direction:column">
      <h3 style="margin:0 0 4px">Print "${esc(adv.name||'Book')}"</h3>
      <p style="margin:0 0 12px;font-size:11px;color:var(--text-muted)">Pick chapters → opens a print-friendly view. Use your browser's File → Print to save as PDF.</p>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button class="btn small" id="adv-print-all">Select all</button>
        <button class="btn small" id="adv-print-none">Select none</button>
        <span style="flex:1"></span>
        <label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:5px;cursor:pointer">
          <input type="checkbox" id="adv-print-images" checked> Include images
        </label>
      </div>
      <div style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:5px;padding:6px;background:var(--panel-2)">
        ${chapters.map((c, i) => `
          <label class="adv-print-row" style="display:flex;align-items:center;gap:8px;padding:4px 6px;font-size:12px;cursor:pointer;border-radius:3px">
            <input type="checkbox" class="adv-print-chk" data-ci="${i}" checked>
            <span style="color:var(--text-dim);min-width:24px">${i+1}.</span>
            <span style="flex:1;color:var(--text)">${esc(c.name || 'Untitled')}</span>
          </label>
        `).join('')}
      </div>
      <div class="modal-actions" style="margin-top:10px">
        <span id="adv-print-count" style="font-size:11px;color:var(--text-muted);align-self:center">${chapters.length} chapters selected</span>
        <span style="flex:1"></span>
        <button class="btn" id="adv-print-close">Cancel</button>
        <button class="btn primary" id="adv-print-go">Open print view</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('#adv-print-close').addEventListener('click', close);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
    backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    const checks = backdrop.querySelectorAll('.adv-print-chk');
    const countEl = backdrop.querySelector('#adv-print-count');
    const refresh = () => {
      const n = [...checks].filter(c => c.checked).length;
      countEl.textContent = n + ' chapter' + (n===1?'':'s') + ' selected';
      backdrop.querySelector('#adv-print-go').disabled = n === 0;
    };
    checks.forEach(c => c.addEventListener('change', refresh));
    backdrop.querySelector('#adv-print-all').addEventListener('click', () => { checks.forEach(c => c.checked = true); refresh(); });
    backdrop.querySelector('#adv-print-none').addEventListener('click', () => { checks.forEach(c => c.checked = false); refresh(); });
    backdrop.querySelector('#adv-print-go').addEventListener('click', () => {
      const picks = [...checks].filter(c => c.checked).map(c => +c.dataset.ci);
      if (!picks.length) return;
      const includeImages = backdrop.querySelector('#adv-print-images').checked;
      this._openPrintWindow(adv, file, picks, { includeImages });
      close();
    });
  },

  _openPrintWindow(adv, file, chapterIndices, opts){
    const includeImages = opts?.includeImages !== false;
    const chapters = (file && file.data) || [];
    const tocItems = chapterIndices.map((i, n) => `
      <li><a href="#chap-${i}"><span class="num">${n+1}.</span> ${esc(chapters[i]?.name || 'Untitled')}</a></li>
    `).join('');
    const chaptersHtml = chapterIndices.map(i => {
      const ch = chapters[i]; if (!ch) return '';
      let body = this._renderChapterEntries(ch);
      if (!includeImages) body = body.replace(/<img\b[^>]*>/g, '');
      return `<section class="chap" id="chap-${i}">
        <h1 class="chap-title">${esc(ch.name || 'Untitled')}</h1>
        ${body}
      </section>`;
    }).join('');
    const css = `
      *,*::before,*::after{box-sizing:border-box}
      html,body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
      body{background:#1a1a1a;color:#e8e8e8;font-size:13px;line-height:1.55;padding:30px 50px;max-width:900px;margin:0 auto}
      h1.title{font-size:34px;margin:0 0 4px;color:#d4a574}
      h1.title + .meta{color:#999;font-size:13px;margin-bottom:30px}
      h2.toc-title{margin:30px 0 8px;font-size:18px;border-bottom:1px solid #3a3a3a;padding-bottom:5px}
      ol.toc{list-style:none;padding:0;margin:0 0 30px}
      ol.toc li{padding:3px 0;font-size:13px}
      ol.toc a{color:#d4a574;text-decoration:none}
      ol.toc a:hover{text-decoration:underline}
      ol.toc .num{display:inline-block;width:30px;color:#999;font-variant-numeric:tabular-nums}
      .chap{page-break-before:always;break-before:page;padding-top:20px}
      .chap-title{font-size:26px;border-bottom:2px solid #d4a574;padding-bottom:6px;margin:0 0 14px}
      .chap p{margin:0 0 10px}
      .chap h3,.chap h4,.chap h5{color:#d4a574;margin:18px 0 6px}
      .chap ul,.chap ol{margin:0 0 10px;padding-left:24px}
      .chap li{margin:2px 0}
      .chap table{border-collapse:collapse;margin:10px 0;width:100%;font-size:12px}
      .chap th,.chap td{border:1px solid #3a3a3a;padding:5px 9px;text-align:left}
      .chap th{background:#2a2a2a;color:#d4a574}
      .chap img{max-width:100%;height:auto;display:block;margin:10px 0;border-radius:4px}
      .chap blockquote,.chap .inset{background:rgba(212,165,116,0.08);border-left:3px solid #d4a574;margin:10px 0;padding:8px 14px}
      .chap .read-aloud,.chap .inset-readaloud{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:4px;padding:10px 14px;font-style:italic;margin:10px 0}
      .adv-tag{color:#d4a574}
      .toolbar{position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:10px 0;margin:-30px 0 20px;display:flex;gap:8px;align-items:center;z-index:10}
      .toolbar button{background:#333;border:1px solid #3a3a3a;color:#e8e8e8;padding:6px 14px;font-size:13px;border-radius:4px;cursor:pointer;font-family:inherit}
      .toolbar button:hover{background:#444}
      .toolbar .primary{background:#d4a574;color:#1a1a1a;border-color:#d4a574;font-weight:600}
      .toolbar .meta{color:#999;font-size:12px;flex:1;text-align:right}
      @media print{
        body{background:#fff;color:#000;padding:0;font-size:11pt;max-width:none}
        .toolbar{display:none}
        h1.title{color:#5a3a14}
        h1.title + .meta{color:#444}
        h2.toc-title{border-color:#000}
        ol.toc a{color:#000;text-decoration:none}
        ol.toc .num{color:#666}
        .chap-title{color:#5a3a14;border-color:#5a3a14}
        .chap h3,.chap h4,.chap h5{color:#5a3a14}
        .chap th{background:#f0e8d8;color:#5a3a14}
        .chap th,.chap td{border-color:#aaa}
        .chap blockquote,.chap .inset{background:#f7f0e0;border-color:#5a3a14}
        .chap .read-aloud,.chap .inset-readaloud{background:#f0f0f0;border-color:#aaa}
        .adv-tag{color:#000}
        @page{margin:1.5cm}
      }
    `;
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(adv.name||'Book')} — Print</title>
  <base href="${esc(location.origin + location.pathname.replace(/[^/]+$/, ''))}">
  <style>${css}</style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">🖨 Print / Save as PDF</button>
    <button onclick="window.close()">Close</button>
    <span class="meta">${esc(adv.name||'Book')} · ${chapterIndices.length} chapter${chapterIndices.length===1?'':'s'}</span>
  </div>
  <h1 class="title">${esc(adv.name || 'Book')}</h1>
  <div class="meta">${esc((adv.source||'') + (adv.published?(' · '+adv.published):''))}</div>
  <h2 class="toc-title">Contents</h2>
  <ol class="toc">${tocItems}</ol>
  ${chaptersHtml}
</body>
</html>`;
    const win = window.open('', '_blank');
    if (!win){
      if (typeof showToast === 'function') showToast('Pop-up blocked — allow pop-ups for this site to use print export.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    if (typeof showToast === 'function') showToast('Print view opened — use File → Print in the new tab');
  },
});
