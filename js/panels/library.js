// ============================================================
// LIBRARY — Books and Adventures, one reader with two tabs
// ============================================================
// They were two windows built on the same content reader
// (content-panel.js), opened from two dock buttons that sat next to each
// other, and a DM looking for "the chapter about the tavern" had to remember
// which shelf it was on. Now one window; each tab is the panel it always
// was, mounted into this one. Only the open tab is mounted, so a book that
// isn't on screen isn't holding its chapters in the DOM.
//
// openPanel('books') / openPanel('adventures') still work: the window manager
// sends them here (SKT_PANEL_HOST in data.js) and select() picks the tab.

const LIBRARY_TABS = [
  { id: 'books',      label: 'Books',      icon: 'i-books' },
  { id: 'adventures', label: 'Adventures', icon: 'i-book-open' },
];

registerPanel('library', {
  title: 'Library', icon: '📚',
  _tab: null,
  _child: null,     // the tab currently mounted

  _current(){
    if (this._tab) return this._tab;
    const saved = (typeof layout !== 'undefined' && layout.library && layout.library.tab) || null;
    return LIBRARY_TABS.some(t => t.id === saved) ? saved : 'books';
  },

  // Called by the window manager before it opens this window for a tab.
  select(id){
    if (!LIBRARY_TABS.some(t => t.id === id)) return;
    this._tab = id;
    if (typeof layout !== 'undefined' && layout.library) layout.library.tab = id;
    if (this._body) this._show(id);
  },

  mount(body){
    this._body = body;
    body.classList.add('lib-host');
    body.innerHTML = '<div class="lib-tabs" role="tablist">'
      + LIBRARY_TABS.map(t => '<button class="lib-tab" role="tab" data-lib-tab="' + t.id + '">'
          + (typeof ICO === 'function' ? ICO(t.icon) : '') + '<span>' + esc(t.label) + '</span></button>').join('')
      + '</div><div class="lib-pane"></div>';
    body.querySelector('.lib-tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-lib-tab]'); if (!b) return;
      this.select(b.dataset.libTab);
      if (typeof saveLayout === 'function') saveLayout();
    });
    this._child = null;
    this._show(this._current());
  },

  _show(id){
    const b = this._body; if (!b) return;
    if (this._child === id) return;
    this._unmountChild();
    const pane = b.querySelector('.lib-pane');
    pane.innerHTML = '';
    pane.removeAttribute('style');
    b.querySelectorAll('[data-lib-tab]').forEach(t => {
      const on = t.dataset.libTab === id;
      t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const def = panelDefs[id];
    if (!def) return;
    this._child = id;
    def.mount(pane);
  },

  _unmountChild(){
    const def = this._child && panelDefs[this._child];
    if (def){
      try { if (typeof def.unmount === 'function') def.unmount(); } catch(e){}
      def._body = null;
    }
    this._child = null;
  },

  unmount(){ this._unmountChild(); this._body = null; },

  _render(){ const def = this._child && panelDefs[this._child]; if (def && def._render) def._render(); },

  // The open tab's own ⋯ items, so nothing it offered as a window is lost.
  menuItems(){
    const def = this._child && panelDefs[this._child];
    if (!def) return [];
    return typeof def.menuItems === 'function' ? (def.menuItems() || []) : (def.menuItems || []);
  },
});
