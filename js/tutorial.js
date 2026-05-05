// ============================================================
// TUTORIAL — guided tour of every panel and global feature.
// ============================================================
// Triggered from the ❓ button in the top toolbar, or auto-shown
// on a user's first visit (gated by localStorage). Each page is
// a self-contained chunk of HTML; navigation is prev/next.

const TUTORIAL_KEY = 'skt-tutorial-seen-v1';

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
    body: `
      <p>Press <kbd>/</kbd> any time to focus the search bar (top-left).
      It searches the full 5etools dataset:</p>
      <ul>
        <li><strong>Monsters</strong>, <strong>spells</strong>, <strong>magic items</strong>, <strong>conditions</strong></li>
        <li>Plus feats, races, classes, backgrounds, deities, traps, vehicles, adventures, and more under the <strong>More ▾</strong> row.</li>
      </ul>
      <p>Click any result to view its full stat block. From a monster, you can
      <strong>+ Add to combat</strong>; from a condition, <strong>+ Apply to active combatant</strong>.
      Press <kbd>⧉ Pop out</kbd> to keep a stat block open in its own floating window.</p>
    `,
  },
  {
    title: 'The dock & floating windows',
    icon: '🪟',
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
    body: `
      <p>Run encounters here. Add combatants by:</p>
      <ul>
        <li>Searching a monster and clicking <strong>+ Add to combat</strong>.</li>
        <li>Dragging a card from the Bestiary, Party Tracker, NPC Library, or Encounter Builder onto the tracker.</li>
        <li>Clicking <strong>+ Add</strong> for a quick custom combatant.</li>
      </ul>
      <p>Per-card you can edit HP, AC, initiative, upload a portrait, and toggle death saves (PCs).
      <strong>Right-click any tile</strong> to open the conditions menu — pick from the full
      5e condition list to apply or remove.</p>
      <p>Drag tiles to reorder turn order manually. Use the round counter and turn arrows
      to advance. <strong>Hide Monster Stats</strong> in settings hides HP/AC from the Player View.</p>
    `,
  },
  {
    title: 'Party Tracker ♥',
    icon: '♥',
    body: `
      <p>Cards for your PCs. Each card shows HP/Max HP (with a bar), AC, initiative, speed,
      passive perception, and gold. Click into a card for the full sheet:</p>
      <ul>
        <li><strong>Stats</strong> tab — abilities, saves, proficiencies, hit dice.</li>
        <li><strong>Skills</strong> tab — full skill list with modifiers.</li>
        <li><strong>Spells</strong> tab — spell slots and known/prepared spells.</li>
      </ul>
      <p>Toggle <strong>Heroic Inspiration</strong> or <strong>Bardic Inspiration</strong> right from the card.
      Click <strong>Import PDF</strong> to parse a D&amp;D Beyond character sheet, or build one manually.
      Drag a party card to the Combat Tracker to add the PC to combat.</p>
    `,
  },
  {
    title: 'Bestiary 🐲',
    icon: '🐲',
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
    body: `
      <p>Track party treasure across:</p>
      <ul>
        <li><strong>Coins</strong> in CP/SP/EP/GP/PP — totals are auto-converted to gp equivalent.</li>
        <li><strong>Items</strong> — type a name (or <strong>search the 5e item database</strong>)
        and click an entry to add it. Set qty and value, and <strong>assign each item to a party member</strong>.</li>
      </ul>
      <p>Switch between <strong>All Items</strong> and <strong>By Party Member</strong> view to see who
      gets what. The <strong>Divvy up</strong> button splits coin equally across the party.</p>
    `,
  },
  {
    title: 'Encounter Builder ⚡',
    icon: '⚡',
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
    body: `
      <p>Tactical canvas with grid, tokens, and fog of war.</p>
      <ul>
        <li><strong>Upload</strong> any image or pick a 5etools adventure map.</li>
        <li>Drop tokens for creatures and objects; drag to move.</li>
        <li><strong>Fog of war</strong> — paint over to hide, paint to reveal; adjustable brush radius.</li>
        <li><strong>Draw</strong> annotations in colored pencil; toggle the grid; auto-fit or snap-to-grid.</li>
      </ul>
      <p>State persists across refreshes. Share the map window to show it to players.</p>
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
    icon: '🖥',
    body: `
      <p>Click <strong>🖥 Player View</strong> in the top toolbar to open a separate window
      that mirrors only the windows you've marked with the <strong>👁 share</strong> icon —
      perfect for a TV at the table or a streamed call.</p>
      <p>If realtime sync is configured, players can also view the shared workspace
      from their own device. Combatant HP/AC can be hidden via the
      <strong>Hide Monster Stats</strong> setting.</p>
    `,
  },
  {
    title: 'Settings & themes ⚙',
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
        <li>Re-open this tour any time from the <strong>❓</strong> button.</li>
      </ul>
      <p style="color:var(--text-muted)">Happy running.</p>
    `,
  },
];

function openTutorial(startIdx) {
  let idx = Math.max(0, Math.min(startIdx|0, TUTORIAL_PAGES.length - 1));

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
  };
  paint();

  const close = () => {
    try {
      if (dontShow.checked) localStorage.setItem(TUTORIAL_KEY, '1');
      else localStorage.removeItem(TUTORIAL_KEY);
    } catch(e){}
    backdrop.remove();
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

function _initTutorial() {
  // Hook the toolbar button.
  const btn = document.getElementById('tutorial-btn');
  if (btn) btn.addEventListener('click', () => openTutorial(0));

  // Auto-show on first visit.
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
