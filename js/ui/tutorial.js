// ============================================================
// TUTORIAL — guided tour of every panel and global feature.
// ============================================================
// Triggered from the ❓ button in the top toolbar, or auto-shown
// on a user's first visit (gated by localStorage). Each page is
// a self-contained chunk of HTML; navigation is prev/next.

// Bumped when the tour content meaningfully changes so returning users see
// the updated walk-through once more.
const TUTORIAL_KEY = 'skt-tutorial-seen-v2';

const TUTORIAL_PAGES = [
  {
    title: 'Welcome to the DM Workspace',
    icon: '👋',
    body: `
      <p>This is a single-page workspace for running 5e games. Every tool you need —
      stat blocks, combat, notes, maps, music, weather — lives in floating windows you
      can arrange however you like.</p>
      <p style="color:var(--text-muted)">This tour takes about a minute. Use
      <strong>Next</strong> / <strong>Prev</strong> to flip pages, or <strong>Skip</strong>
      to dismiss it. You can re-open the tutorial any time from the
      <strong>❓</strong> button in the top toolbar.</p>
    `,
  },
  {
    title: 'Search bar',
    icon: '🔎',
    target: '#float-search-btn, #search-input',
    body: `
      <p>Press <kbd>/</kbd> any time to focus the search bar (top-left).
      It searches the full 5etools dataset:</p>
      <ul>
        <li><strong>Monsters</strong>, <strong>spells</strong>, <strong>magic items</strong>, <strong>conditions</strong></li>
        <li><strong>Base items</strong> — every weapon, armor, tool, and adventuring-gear entry, with proper damage / AC / weight / cost in the stat block.</li>
        <li>Plus feats, races, classes, backgrounds, deities, traps, vehicles, adventures, and more under the <strong>More ▾</strong> row.</li>
      </ul>
      <p>Click any result to view its full stat block. From a monster, you can
      <strong>+ Add to combat</strong>; from a condition, <strong>+ Apply to active combatant</strong>.
      Press <kbd>⧉ Pop out</kbd> to keep a stat block open in its own floating window.</p>
      <p><strong>Tabbed magic variants:</strong> open a base weapon or armor (e.g. Longsword) and the detail
      shows a tab strip — <strong>Base / +1 / +2 / +3</strong> — so you can flip between every enhancement
      bonus version in one entry. Searching "+1 longsword" still finds the base.</p>
      <p>Closing the search clears it — pressing <kbd>/</kbd> again starts fresh.</p>
    `,
  },
  {
    title: 'The dock & floating windows',
    icon: '🪟',
    target: '.panel-dock',
    body: `
      <p>The <strong>dock on the left</strong> opens panels. Each panel becomes a floating
      window you can:</p>
      <ul>
        <li><strong>Drag</strong> by its title bar; <strong>resize</strong> from any edge or corner.</li>
        <li><strong>🔒 Lock</strong> to prevent accidental moves.</li>
        <li><strong>👁 Share</strong> (DM-only) to expose the window to Player View.</li>
        <li><strong>– Minimize</strong> or <strong>× Close</strong>.</li>
      </ul>
      <p><strong>Right-click the empty workspace</strong> to toggle panels and save
      named <em>focuses</em> (layout presets) — useful for "combat layout" vs
      "exploration layout."</p>
      <p>Use <kbd>Ctrl</kbd>+<kbd>=</kbd>/<kbd>-</kbd>/<kbd>0</kbd> to zoom the workspace,
      and the <strong>↻</strong> dock button to reset the layout.</p>
    `,
  },
  {
    title: 'Combat Tracker ⚔',
    icon: '⚔',
    target: '.window[data-panel="combat"], .dock-btn[data-panel="combat"]',
    panel: 'combat',
    body: `
      <p>Run encounters here. Add combatants by:</p>
      <ul>
        <li>Searching a monster and clicking <strong>+ Add to combat</strong>.</li>
        <li>Dragging a card from the Bestiary, Party Tracker, NPC Library, or Encounter Builder onto the tracker.</li>
        <li>Clicking <strong>+ Add</strong> for a quick custom combatant.</li>
      </ul>
      <p>Per-card you can edit HP, AC, initiative, upload a portrait, and toggle death saves (PCs).
      <strong>Right-click any tile</strong> (PC or NPC) to open the conditions menu — pick from the full
      5e condition list to apply or remove.</p>
      <p>Drag tiles to reorder turn order manually. Use the round counter and turn arrows
      to advance. <strong>Hide Monster Stats</strong> in settings hides HP/AC from the Player View.</p>
    `,
  },
  {
    title: 'Party Tracker ♥',
    icon: '♥',
    target: '.window[data-panel="party"], .dock-btn[data-panel="party"]',
    panel: 'party',
    body: `
      <p>Cards for your PCs. Each card shows HP/Max HP (with a bar), AC, initiative, speed,
      passive perception, and gold. Click into a card for the full sheet:</p>
      <ul>
        <li><strong>Stats</strong> tab — abilities, saves, proficiencies, hit dice.</li>
        <li><strong>Skills</strong> tab — grouped by <strong>◉ Expertise / ● Proficient / ◐ Half</strong>;
          untrained skills tucked into a collapsible footer.</li>
        <li><strong>Spells</strong> tab — slot pips, known spells. <strong>Click any spell name</strong>
          to pop open its full description in a floating window.</li>
      </ul>
      <p>Toggle <strong>Heroic Inspiration</strong> or <strong>Bardic Inspiration</strong> right from the card.
      Click <strong>📄 Import PDF</strong> to parse a D&amp;D Beyond character sheet, or build one manually.
      Drag a party card to the Combat Tracker to add the PC to combat.</p>
      <p><strong>📊 Party Skills</strong> button at the bottom opens a modal showing every skill and exactly
      who is proficient / has expertise / has half-prof — instantly answers "who should make this check?"
      and surfaces the party's blind spots.</p>
    `,
  },
  {
    title: 'Bestiary 🐲',
    icon: '🐲',
    target: '.window[data-panel="bestiary"], .dock-btn[data-panel="bestiary"]',
    panel: 'bestiary',
    body: `
      <p>Your personal monster shelf. Use it to bookmark monsters you'll need this session
      so you don't have to search for them again.</p>
      <ul>
        <li><strong>+ Add Monster</strong> opens a picker over the full 5e bestiary.</li>
        <li>Create folders to group monsters by encounter, location, or theme.</li>
        <li>Click a card for the full stat block; drag a card to the Combat Tracker to add it.</li>
      </ul>
    `,
  },
  {
    title: 'NPC Library 👤 & Generator 🎲',
    icon: '👤',
    target: '.window[data-panel="npclib"], .dock-btn[data-panel="npclib"]',
    panel: 'npclib',
    body: `
      <p><strong>NPC Library</strong> stores recurring characters with name, role, group,
      attitude (Ally / Friendly / Neutral / Hostile / Imprisoned / Unknown), HP/AC, tags,
      description, and notes. Drag an NPC to combat at any time.</p>
      <p><strong>NPC Generator</strong> rolls a fresh NPC: race, gender, role, age, attitude,
      two quirks, motivation, and a hidden secret. Re-roll any field individually, then
      <strong>save to Library</strong> or push directly to combat.</p>
    `,
  },
  {
    title: 'Loot Tracker 💰',
    icon: '💰',
    target: '.window[data-panel="loot"], .dock-btn[data-panel="loot"]',
    panel: 'loot',
    body: `
      <p>Track party treasure with rich per-item state.</p>
      <ul>
        <li><strong>Coins</strong> — CP/SP/EP/GP/PP, auto-totaled in gp. <strong>Divvy up</strong> splits evenly.</li>
        <li><strong>Add items</strong> — type a name to live-search the full 5e item library
          (including base weapons / armor / tools and "+1/+2/+3" variants). Click a result to add
          with the <strong>cost auto-filled</strong> from the 5e data. Or just type a custom name.</li>
        <li><strong>Edit inline</strong> — click the item name to rename, edit qty/value, swap
          assignment. Click <strong>📖</strong> next to a name to pop open the 5e detail.</li>
        <li><strong>Drag-to-reorder</strong> — grab the <strong>⋮⋮</strong> handle on any row.</li>
      </ul>
      <p><strong>Tabs</strong> across the top: <strong>All</strong>, a single <strong>👤 Party</strong>
      tab (every member as a section), any <strong>👥 Custom Tabs</strong> you create, the
      <strong>＋ Tab</strong> button to make a new one (pick a name + which party members it groups),
      and a <strong>📦 Group</strong> tab for shared / unassigned loot.</p>
      <p>Assigning an item to a custom group makes it appear in every member's section in that group's
      tab — perfect for "Frontline" loot that the warriors share.</p>
    `,
  },
  {
    title: 'Encounter Builder ⚡',
    icon: '⚡',
    target: '.window[data-panel="encounter"], .dock-btn[data-panel="encounter"]',
    panel: 'encounter',
    body: `
      <p>Plan a balanced fight before pushing it to combat. Set your party level and size,
      then add monsters with counts. The panel calculates:</p>
      <ul>
        <li><strong>Raw &amp; adjusted XP</strong> (with the multiple-monster multiplier).</li>
        <li><strong>Difficulty</strong> — Trivial / Easy / Medium / Hard / Deadly, color-coded.</li>
        <li>Per-difficulty <strong>XP thresholds</strong> for the full party.</li>
      </ul>
      <p>When the encounter feels right, click <strong>▶ Push to Combat Tracker</strong> to copy
      every monster onto the tracker.</p>
    `,
  },
  {
    title: 'Session Notes 📝',
    icon: '📝',
    target: '.window[data-panel="notes"], .dock-btn[data-panel="notes"]',
    panel: 'notes',
    body: `
      <p>Markdown notes with a folder tree. Click any line to edit; the toolbar provides
      bold, italic, headings, lists, quotes, and dividers. Use <kbd>Ctrl</kbd>+<kbd>B</kbd> /
      <kbd>Ctrl</kbd>+<kbd>I</kbd> for inline formatting.</p>
      <p>Drag the divider to resize the file tree. Connect an Obsidian-style
      <strong>vault folder</strong> via the pill in the tree header for two-way sync with
      a folder of <code>.md</code> files on disk.</p>
    `,
  },
  {
    title: 'Battle Map 🗺',
    icon: '🗺',
    target: '.window[data-panel="battlemap"], .dock-btn[data-panel="battlemap"]',
    panel: 'battlemap',
    body: `
      <p>Tactical canvas with grid, tokens, fog of war, and freehand annotations.</p>
      <ul>
        <li><strong>🗺 Map</strong> picks any 5etools adventure map (search across every adventure).</li>
        <li>Drop tokens for creatures and objects; drag to move. Drag from the
          <strong>Party:</strong> bar or Bestiary card straight onto the map.</li>
        <li><strong>🌫 Fog of war</strong> — paint to hide, 🖌 reveal as players explore;
          adjustable brush radius. Players see fog updates in real time.</li>
        <li><strong>🖊 Draw</strong> annotations in colored pencil. <strong>🗑 Erase</strong> now also
          removes pencil strokes (drag across them) in addition to tokens.</li>
        <li><strong>Custom grid sizes</strong> — type any pixel value in the Grid input, or pick
          a preset (30 / 50 / 64 / 80 / 100 / 120 / 150).</li>
        <li><strong>📐 Align</strong> — click two opposite corners of one cell on a printed map
          grid; the overlay grid snaps to match the map's printed cell size and offset.</li>
        <li><strong>Smooth zoom</strong> — wheel, slider, pinch, or ⊙ Fit. The grid stays anchored
          to the map content at every zoom level.</li>
      </ul>
      <p>Strokes, fog, and tokens all sync to the player view in real time. State persists across
      refreshes. Share the map window to show it on the player tab.</p>
    `,
  },
  {
    title: 'World tools — Weather ☁ · Time ⏱ · Shop $',
    icon: '🌍',
    body: `
      <p><strong>Weather Tool</strong> — pick a biome and season, roll a physically-plausible
      forecast (temperature, wind, humidity, cloud cover, precipitation).</p>
      <p><strong>Time Tracker</strong> — Forgotten Realms calendar with a 24-hour ring dial.
      Advance by hour, day, week, month, or year.</p>
      <p><strong>Shop Generator</strong> — pick shop type, price band, town economy, and
      assortment level. Generates a shopkeeper, personality, aesthetic, and an inventory
      table priced by your settings (currency symbol &amp; jitter live in <strong>⚙ Settings</strong>).</p>
    `,
  },
  {
    title: 'Soundboard 🔊',
    icon: '🔊',
    target: '.window[data-panel="soundboard"], .dock-btn[data-panel="soundboard"]',
    panel: 'soundboard',
    body: `
      <p>Ambient sound during sessions. Two libraries:</p>
      <ul>
        <li><strong>Shared</strong> — pre-bundled tracks from <code>audio/manifest.json</code>.</li>
        <li><strong>Personal</strong> — drag-drop your own audio; saved in your browser (IndexedDB).</li>
      </ul>
      <p><strong>Left-click</strong> a tile to play once; <strong>right-click</strong> to loop.
      Each sound has its own volume; the spectrum visualizer reflects the live mix.</p>
    `,
  },
  {
    title: 'Player View & sharing',
    target: '#player-view-btn, .float-toolbar',
    icon: '🖥',
    body: `
      <p>Click <strong>🖥 Player View</strong> in the top toolbar to open a separate window
      that mirrors only the windows you've marked with the <strong>👁 share</strong> icon —
      perfect for a TV at the table or a streamed call.</p>
      <p>The player tab is <strong>read-only by design</strong>: the battle-map toolbar there is
      trimmed down to just <strong>Draw / Erase / Zoom / Drawings (clear) / Clear (tokens)</strong>
      — no fog, map-picker, or grid-editing controls. Fog state, tokens, and pencil strokes still
      sync from the DM in real time via BroadcastChannel.</p>
      <p>The floating panel dock fades to nearly invisible when not in use and brightens on hover,
      so it doesn't crowd the shared windows.</p>
      <p>If realtime sync is configured, players can also view the shared workspace
      from their own device. Combatant HP/AC can be hidden via the
      <strong>Hide Monster Stats</strong> setting.</p>
    `,
  },
  {
    title: 'Settings & themes ⚙',
    target: '#settings-btn',
    icon: '⚙',
    body: `
      <p>The <strong>⚙</strong> button in the top toolbar opens settings:</p>
      <ul>
        <li><strong>Theme</strong> — 8 presets (Forest, Royal, Sanguine, Arcane, Parchment, …) or pick custom accent / panel colors.</li>
        <li><strong>Currency &amp; jitter</strong> for the shop generator.</li>
        <li><strong>Reprints filter</strong> — show 2014, 2024, or both versions of reprinted entries.</li>
        <li><strong>Window snap</strong> on/off.</li>
        <li><strong>Export / Import JSON</strong> to back up everything (party, combat, notes, bestiary, loot, settings).</li>
      </ul>
    `,
  },
  {
    title: "You're set 🎲",
    icon: '🎲',
    body: `
      <p>That's the whole tour. A few quick reminders:</p>
      <ul>
        <li>Press <kbd>/</kbd> to search — it's the fastest way to find anything.</li>
        <li>Right-click the workspace to manage panels and save layouts.</li>
        <li>Right-click a combatant tile to apply conditions.</li>
        <li>Drag cards (party, bestiary, NPC library) onto the Combat Tracker to add them.</li>
        <li>Drag the <strong>⋮⋮</strong> handle in loot rows to reorder items.</li>
        <li>Click a spell name on a character sheet to pop up its full description.</li>
        <li>Use <strong>📐 Align</strong> on the battle map to lock the grid to a printed map.</li>
        <li>Use <strong>📊 Party Skills</strong> to see who's good at what at a glance.</li>
        <li>Re-open this tour any time from the <strong>❓</strong> button.</li>
      </ul>
      <p style="color:var(--text-muted)">Happy running.</p>
    `,
  },
];

function openTutorial(startIdx) {
  let idx = Math.max(0, Math.min(startIdx|0, TUTORIAL_PAGES.length - 1));
  // Track panels the tutorial itself opened so we can close them on page
  // transitions / tour close. We don't want to leave 8 windows scattered on
  // the workspace after the tour finishes. Panels the user had open before
  // the tour started are recorded in `_preOpenPanels` and left alone.
  const _autoOpened = new Set();
  const _preOpenPanels = new Set();
  try {
    Object.entries(layout || {}).forEach(([id, l]) => { if (l && l.open) _preOpenPanels.add(id); });
  } catch(e){}

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal tutorial-modal" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div class="tutorial-progress"><div class="tutorial-progress-fill" id="tutorial-progress-fill"></div></div>
      <div class="tutorial-head">
        <span class="tutorial-icon" id="tutorial-icon"></span>
        <h3 id="tutorial-title" style="margin:0;flex:1"></h3>
        <span class="tutorial-counter" id="tutorial-counter"></span>
      </div>
      <div class="tutorial-body" id="tutorial-body"></div>
      <div class="tutorial-footer">
        <label class="tutorial-dontshow">
          <input type="checkbox" id="tutorial-dontshow"> Don't show on startup
        </label>
        <div class="tutorial-nav">
          <button class="btn" id="tutorial-skip">Skip</button>
          <button class="btn" id="tutorial-prev">‹ Prev</button>
          <button class="btn primary" id="tutorial-next">Next ›</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const $ = sel => backdrop.querySelector(sel);
  const fill = $('#tutorial-progress-fill');
  const iconEl = $('#tutorial-icon');
  const titleEl = $('#tutorial-title');
  const counterEl = $('#tutorial-counter');
  const bodyEl = $('#tutorial-body');
  const dontShow = $('#tutorial-dontshow');
  const prevBtn = $('#tutorial-prev');
  const nextBtn = $('#tutorial-next');

  // Reflect current state of "seen" → preset the checkbox.
  try { dontShow.checked = localStorage.getItem(TUTORIAL_KEY) === '1'; } catch(e){}

  // Spotlight overlay — a small fixed-position div sized over the page's
  // target element, with a huge translucent box-shadow that dims the rest
  // of the workspace. Reused across pages by mutating its style.
  const modal = backdrop.querySelector('.tutorial-modal');
  let spotlight = null;
  const ensureSpotlight = () => {
    if (spotlight) return spotlight;
    spotlight = document.createElement('div');
    spotlight.className = 'tutorial-spotlight';
    document.body.appendChild(spotlight);
    return spotlight;
  };
  const clearSpotlight = () => {
    if (spotlight) spotlight.style.display = 'none';
    // Restore default centered modal position + restore the backdrop's dim.
    modal.classList.remove('tutorial-modal-corner', 'tutorial-modal-docked', 'tutorial-modal-dock-top', 'tutorial-modal-dock-bottom');
    modal.style.left = modal.style.top = modal.style.right = modal.style.bottom = '';
    backdrop.classList.remove('tutorial-spotlight-active');
  };

  const paint = () => {
    const p = TUTORIAL_PAGES[idx];
    iconEl.textContent = p.icon;
    titleEl.textContent = p.title;
    counterEl.textContent = `${idx+1} / ${TUTORIAL_PAGES.length}`;
    bodyEl.innerHTML = p.body;
    fill.style.width = `${((idx+1)/TUTORIAL_PAGES.length)*100}%`;
    prevBtn.disabled = idx === 0;
    nextBtn.textContent = idx === TUTORIAL_PAGES.length - 1 ? 'Done' : 'Next ›';
    bodyEl.scrollTop = 0;

    // Spotlight handling — only kicks in when the page declares a target
    // and that target is currently in the DOM and visible. Otherwise the
    // default centered-modal-over-darkened-backdrop layout takes over.
    clearSpotlight();
    // Default position for every page: docked to the bottom-center. This is
    // the stable home — pages without a target keep it here, pages with a
    // target on the bottom half flip it to top-center. Two positions total
    // across the whole tour.
    modal.classList.add('tutorial-modal-docked', 'tutorial-modal-dock-bottom');
    // Close any panels we auto-opened on prior pages — except the one this
    // page also needs. Keeps the workspace tidy as the user navigates the
    // tour instead of leaving a trail of 8 open windows behind.
    if (typeof closePanel === 'function'){
      Array.from(_autoOpened).forEach(prevId => {
        if (prevId === p.panel) return; // still needed by this page
        if (_preOpenPanels.has(prevId)) return; // user had it before; leave it
        try { closePanel(prevId); } catch(e){}
        _autoOpened.delete(prevId);
      });
    }
    // If the page calls out a panel and the panel is closed, nudge it open so
    // the spotlight has a real window to land on rather than a tiny dock pill.
    // Brought to front via focusPanel so it sits above any other open windows
    // (the user may have left some stacked).
    if (p.panel && typeof ensurePanel === 'function'){
      try {
        const wasOpen = layout[p.panel] && layout[p.panel].open;
        ensurePanel(p.panel);
        if (!wasOpen && !_preOpenPanels.has(p.panel)) _autoOpened.add(p.panel);
        if (typeof focusPanel === 'function') focusPanel(p.panel);
      } catch(e){}
    }
    if (p.target){
      // Multi-selector targets resolve in *selector order*, not DOM order, so
      // an open window wins over the always-present dock button.
      const candidates = String(p.target).split(',').map(s => s.trim()).filter(Boolean);
      let el = null;
      for (const sel of candidates){
        const found = document.querySelector(sel);
        if (found){
          const r = found.getBoundingClientRect();
          if (r.width > 0 && r.height > 0){ el = found; break; }
          if (!el) el = found; // fallback if nothing visible matches later
        }
      }
      if (el){
        // Some panels (e.g. dock buttons) are visible but their parent might
        // be collapsed offscreen — `scrollIntoView` ensures the spotlight
        // points at something the user can actually see.
        try { el.scrollIntoView({block:'nearest', inline:'nearest'}); } catch(e){}
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0){
          const pad = 6;
          const s = ensureSpotlight();
          s.style.display = 'block';
          s.style.left   = (r.left   - pad) + 'px';
          s.style.top    = (r.top    - pad) + 'px';
          s.style.width  = (r.width  + pad*2) + 'px';
          s.style.height = (r.height + pad*2) + 'px';
          // Drop the backdrop dim — the spotlight's box-shadow now provides
          // the only darkening, so the workspace shows through the hole.
          backdrop.classList.add('tutorial-spotlight-active');
          // Predictable card position: docked-bottom by default (set above),
          // flips to docked-top only when the spotlighted target is itself
          // in the bottom half of the viewport (so we don't cover it). The
          // card lives in one of just TWO places across the whole tour —
          // easy to anticipate, not a chase. A CSS transition smooths the
          // rare top↔bottom flip.
          const vh = window.innerHeight;
          const ty = r.top + r.height / 2;
          if (ty > vh * 0.55){
            modal.classList.remove('tutorial-modal-dock-bottom');
            modal.classList.add('tutorial-modal-dock-top');
          }
        }
      }
    }
  };
  paint();
  // Spotlight needs to track if the window resizes (or the user changes
  // zoom). Throttled via rAF so it stays smooth.
  let resizeRaf = 0;
  const onResize = () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; paint(); });
  };
  window.addEventListener('resize', onResize);

  const close = () => {
    try {
      if (dontShow.checked) localStorage.setItem(TUTORIAL_KEY, '1');
      else localStorage.removeItem(TUTORIAL_KEY);
    } catch(e){}
    // Close every panel the tutorial popped open so the workspace returns
    // to the layout the user had when they started the tour. Anything they
    // had open beforehand stays open.
    if (typeof closePanel === 'function'){
      Array.from(_autoOpened).forEach(id => {
        if (_preOpenPanels.has(id)) return;
        try { closePanel(id); } catch(e){}
      });
      _autoOpened.clear();
    }
    backdrop.remove();
    if (spotlight) spotlight.remove();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && idx > 0) { idx--; paint(); }
    else if (e.key === 'ArrowRight') {
      if (idx < TUTORIAL_PAGES.length - 1) { idx++; paint(); }
      else close();
    }
  };
  document.addEventListener('keydown', onKey);

  prevBtn.addEventListener('click', () => { if (idx > 0) { idx--; paint(); } });
  nextBtn.addEventListener('click', () => {
    if (idx < TUTORIAL_PAGES.length - 1) { idx++; paint(); }
    else close();
  });
  $('#tutorial-skip').addEventListener('click', close);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
}

// The tour is a DM tour: 16 pages about floating windows, the icon dock,
// workspaces, the bestiary and the encounter builder — none of which a player
// has. It was greeting players with "Welcome to the DM Workspace" and walking
// them through tools they can't see.
//
// Read from the URL rather than body.player-mode: initPlayerView() adds that
// class, and there's no ordering guarantee that it has run by DOMContentLoaded.
// The query string is true before any script executes.
function _isPlayerUrl(){
  try { return new URLSearchParams(location.search).get('player') === '1'; }
  catch(e){ return false; }
}

function _initTutorial() {
  const player = _isPlayerUrl();

  // Hook the toolbar button. Players don't get it — CSS hides the ❓ for them
  // (body.player-mode #tutorial-btn), and leaving the handler off means a
  // keyboard or accessibility path can't reach DM content either.
  const btn = document.getElementById('tutorial-btn');
  if (btn && !player) btn.addEventListener('click', () => openTutorial(0));

  // Auto-show on first visit — DM view only.
  if (player) return;
  let seen = '0';
  try { seen = localStorage.getItem(TUTORIAL_KEY) || '0'; } catch(e){}
  if (seen !== '1') {
    // Slight delay so the workspace finishes laying out first.
    setTimeout(() => openTutorial(0), 400);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initTutorial);
} else {
  _initTutorial();
}
