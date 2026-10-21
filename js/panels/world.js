// ============================================================
// WORLD — the date, the clock and the sky in one window
// ============================================================
// Time and Weather were two small windows that are only ever wanted
// together: the weather rolls when the day turns over, and the first thing a
// DM says after "it's the next morning" is what it's like outside. Both are
// mounted here at once — side by side when the window is wide, one above the
// other when it isn't — and each is still the panel it always was, so the
// sync (skt-time-v1, skt-weather-v2) and the player view's read-only rules
// need nothing new.
//
// The player view's World tab mounts this same window (player-app.js).

const WORLD_PARTS = ['time', 'weather'];

registerPanel('world', {
  title: 'World', icon: '🌤',

  // Both parts are always shown; this exists so openPanel('time') can route
  // here like the Library's tabs do.
  select(){},

  mount(body){
    this._body = body;
    body.classList.add('world-host');
    body.innerHTML = '<div class="world-root">'
      + WORLD_PARTS.map(id => '<div class="world-part" data-world-part="' + id + '"></div>').join('')
      + '</div>';
    WORLD_PARTS.forEach(id => {
      const def = panelDefs[id];
      if (def) def.mount(body.querySelector('[data-world-part="' + id + '"]'));
    });
  },

  unmount(){
    WORLD_PARTS.forEach(id => {
      const def = panelDefs[id];
      if (!def) return;
      try { if (typeof def.unmount === 'function') def.unmount(); } catch(e){}
      def._body = null;
    });
    this._body = null;
  },

  _render(){
    WORLD_PARTS.forEach(id => { const def = panelDefs[id]; if (def && def._body && def._render) def._render(); });
  },

  menuItems(){
    const out = [];
    WORLD_PARTS.forEach(id => {
      const def = panelDefs[id];
      if (!def) return;
      const items = typeof def.menuItems === 'function' ? (def.menuItems() || []) : (def.menuItems || []);
      out.push(...items);
    });
    return out;
  },
});
