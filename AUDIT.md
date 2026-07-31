# Codebase Audit — 70 verified findings

Generated from a multi-agent audit. 11 finders ran in parallel across panel logic, sync, rendering, and CSS; 105 candidate findings were collected, then each was adversarially verified. **70 survived.**

Check items off as you fix them.

---

## Cross-cutting themes

These show up across multiple files and are worth addressing structurally:

- **Listener lifecycle is ad-hoc.** Document-level handlers get attached inside `_render()` or modals without symmetric removal — both leaks and stale-target bugs. Affects `notes._wireDivider`, `party._wire` body click, `utils._runCrop` Escape, notes settings popover.
- **Sync paths are inconsistent.** Drag-reorder, undo-while-not-editing, and folder rename for descendants all mutate state + `_save()` to localStorage but skip the Dropbox/notesSync push. Echo suppression in `realtime.js` tracks only the latest write per key.
- **Battlemap scale math.** `_csScreen()` returns scaled pixels but several call sites multiply by `_bgMapScale` *again* (token clamp, touch end), and `fogPaint` captures a pre-zoom `cs` in closure. Any zoom != 1 misplaces visuals.
- **Identity-vs-index drift.** Maps keyed by character/combatant index (`party._pickerOpen`, actions-menu closures) desync after splice/reorder. Id-keyed transient maps (`_rollHistory`, `_activeTab`) are never pruned on removal. Two patterns coexist without a rule.

---

## High priority — 7

Real bugs or data-loss risks. Tackle these first.

- [x] **Drag-and-drop tree reorder/move never syncs to Dropbox or local vault** — `js/panels/notes.js:961`
  - UI + localStorage update; file stays at old path. Next poll reverts the move. Folder moves strand every descendant.
  - **Fix:** Mirror `_renamePrompt` (line 1340) — capture `oldPath` BEFORE mutating `from.parent`, then call `dropboxSync.movePath(oldPath, newPath)` / `_syncAfter()` for vault.

- [x] **`_wireDivider` leaks document mousemove/mouseup on every `_render()`** — `js/panels/notes.js:1276`
  - Sync pulls fire every 8 s → unbounded listener growth; panel becomes uncollectable.
  - **Fix:** Store bound handlers on `this._dividerHandlers`; remove before re-adding. Or attach once in `mount()` gated on `this._dragState`.

- [x] **Firebase echo suppression breaks under rapid edits** — `js/sync/realtime.js:126`
  - `_justWrote[k]` is overwritten on each flush. Two close-spaced writes for the same key → echo for the older value no longer matches and gets applied. Silently clobbers user input.
  - **Fix:** Track a Set/queue of pushed values per key, or include a per-write nonce and suppress by nonce.

- [x] ~~**Group cards break drag-reorder — `splice(NaN)` scrambles combat order**~~ — `js/panels/combat.js:908` *(fixed)*
  - Group cards render without `data-idx`. Drop runs `parseInt(undefined)` → `NaN`, then `splice(NaN, …)` coerces to `splice(0, …)`. Reproducible any time grouping is on with mixed cards.
  - **Fix applied:** Added `if (!card.dataset.idx) return;` guard at the top of `_wireDragReorder`'s forEach so group containers never get drag listeners attached. Belt-and-suspenders `Number.isNaN(from || to)` check in the drop handler in case any other path emits a card with a malformed index.

- [x] ~~**Map upload replaces map without rescaling tokens or clearing stale drawings/fog**~~ — `js/panels/battlemap.js:2046` (also `:2214`, `:2276`) *(fixed)*
  - Sets `_bgMapScale=1` and `_lastTokenScale=1` directly. After a fractional-scale previous map, tokens appear at 40% of where they should. Drawings/fog reference old `_cols/_rows`.
  - **Fix applied:** Extracted `_resetMapScene()` helper that calls `_scaleTokensTo(1)` to bake the rescale into canonical pixels BEFORE the scale fields get clobbered, then clears `_drawings` (drawn in old coord space) and `_fog` (keyed to old `_cols/_rows`). Called from all three map-swap paths so any future call site picks up the same behavior.

- [x] ~~**Token clamp double-scales `_bgMapScale`**~~ — `js/panels/battlemap.js:2919` (also `:3009`) *(fixed)*
  - `cs = _csScreen()` already incorporates the scale; `half = (size*cs/2) * _bgMapScale` applies it twice. At 2x zoom, tokens near edges jump inward by an extra full natural-cell.
  - **Fix applied:** Dropped the redundant `* (this._bgMapScale || 1)` at both the mouse drag end and the touch drag end. `half = size * cs / 2` now correctly produces stage-pixel half-extents at any zoom level.

- [x] ~~**`fogPaint` closure captures stale `cs` before zoom**~~ — `js/panels/battlemap.js:1494` *(fixed)*
  - `_setupMap` captures `cs` once at line 1075; wheel/pinch zoom calls `_applyZoomTransform` (not `_setupMap`). After any zoom, fog strokes land on wrong cells.
  - **Fix applied:** Added `const cs = this._csScreen();` inside `fogPaint`, shadowing the stale outer captured value. The brush now reads the current per-event cell size, so cell-grid math and the brush radius track the zoom correctly.

---

## Medium priority — 24

Clear correctness / perf issues that haven't bitten yet.

### Party tracker
- [x] ~~HP-field surgical update doesn't toggle `.downed` class / downed badge / status badges / temp marker~~ — `js/panels/party.js:2245` *(fixed: detect alive↔downed and tempHp 0↔>0 transitions; fall back to full `_render()` for those, keep the surgical fast path for within-range edits)*
- [x] ~~`_mirrorPartyToCombatSilent` strict-id-only → long/short rest skip name-matched PCs~~ — `js/panels/party.js:1314` *(fixed: now uses `_findCombatantForPartyMember` so manually-added "Zoey (Rogue)" combatants also get HP/AC restored on rest)*
- [x] ~~Actions-menu closures capture index `i` that desyncs after remote drag-reorder~~ — `js/panels/party.js:2173` *(fixed: captured `cid` at menu open; added `resolve()` helper that re-looks up the party slot by id at click time; remove-modal callback re-resolves after the async confirm too)*
- [x] ~~Body click listener leaked every `_render()` — multiplies on each interaction~~ — `js/panels/party.js:2846` *(fixed: handler hoisted to `mount()` as `this._bodyClickHandler`, attached once, removed in `unmount()`)*

### Combat tracker
- [x] ~~Group rows ignore damage type → resist/vuln/immune bypassed in grouped view~~ — `js/panels/combat.js:707` *(fixed: type select isn't rendered in group rows for space reasons; handler now falls back to `this._lastDmgType` — the panel-scoped value that already tracks the last single-card selection — so group-rolled damage honors resist/immune/vuln correctly)*
- [x] ~~Death-save at 3 successes/3 failures leaves state inconsistent~~ — `js/panels/combat.js:724` *(fixed: introduced `c.stable` and `c.dead` flags. Stabilize sets `stable:true` + clears `deathSaves`; the next damage tick un-stabilizes and starts fresh saves with 1 failure per RAW. Death sets `dead:true` + clears `deathSaves`; the pip click handler bails for dead PCs so the 3rd-fail pip can't be un-clicked. Render path swaps the pip row for a "💀 Dead" or "⚕ Stable" banner. Heal above 0 (revive/revivify) wipes all three flags.)*
- [x] ~~Concentration save toast misses wild-shape damage absorbed by beast pool~~ — `js/panels/combat.js:1386` *(fixed: capture `damageForConc` after resist/vuln/immune math but BEFORE pool absorption. Per 5e RAW, damage soaked by temp HP or wild-shape beast HP still counts as "taking damage" — so a druid in Brown Bear form whose beast HP eats all the damage now still gets the CON save toast.)*

### Battlemap
- [x] ~~**`_renderTokens` leaks `.map-token-facing` DOM nodes — z-fighting after fog sessions**~~ — `js/panels/battlemap.js:2764` *(fixed)*
  - The per-render cleanup swept `.map-token, .map-token-name` but not `.map-token-facing`. Rotated tokens append a fresh facing-arrow div every `_renderTokens()` (fog paint, drag, zoom all re-render) so they piled up as stacked `z-index:2` clones.
  - **Fix applied:** Added `.map-token-facing` to the cleanup querySelectorAll so the facing layer is swept alongside the token/name layers before re-creation.
- [x] ~~**Fog paint has no touch handler — mobile DMs can't reveal/hide fog**~~ — `js/panels/battlemap.js:1494` *(fixed)*
  - Fog reveal/hide was wired to `mousedown`/`mousemove`/`mouseup` only. On a tablet/phone the fog tool did nothing.
  - **Fix applied:** Added `touchstart`/`touchmove`/`touchend`/`touchcancel` on the canvas mirroring the mouse handlers — `fogPaint()` reads `clientX/clientY`, so `e.touches[0]` forwards straight through. Single-finger only (2-finger gestures fall through), `{passive:false}` + `preventDefault` to suppress scroll, and a shared `endFogTouch` that flushes the deferred free-stroke broadcast just like the mouseup path.

### Sync
- [x] ~~**Dropbox 429 retry recurses without retry cap**~~ — `js/sync/dropbox-sync.js:160` *(fixed)*
  - The 429 branch waited `Retry-After` then unconditionally `return _api(endpoint, body)` — a sustained rate-limit recursed forever, never surfacing the failure and pinning a background loop on the 429 wall.
  - **Fix applied:** Threaded an internal `_attempt` counter through `_api`. After 4 retries it sets `_connectError`, toasts "Dropbox is rate-limiting — sync paused", and throws. Backoff now honors `Retry-After` or falls back to exponential (`5·2^n`) capped at 60s.
- [x] ~~**File System Access permission silently expires after reload — UI shows "connected" but vault never syncs**~~ — `js/sync/notes-sync.js:199` *(fixed)*
  - `init()` restored the handle from IndexedDB so `isConnected()` returned true and the pill showed 📂 connected, but FSA grants reset to `'prompt'` on reload. Every poll-driven `fullSync` called `_ensurePermission()` → `requestPermission()` with no user gesture, which never opens a dialog, so the vault silently never synced.
  - **Fix applied:** Added a `_needsPermission` flag — `init()` now `queryPermission()`s the restored handle and flags a lapsed grant; `getStatus()` surfaces it; `_ensurePermission()` updates+emits it on every transition. New public `requestAccess()` re-requests inside a user gesture. `notes.js` renders a pulsing amber "🔓 Grant vault access" pill that calls `requestAccess()` then `fullSync` on click.

### Data loader
- [x] ~~**Subclass fluff lookup keyed by display name never matches — all subclass cards fall through to mechanical text**~~ — `js/content/data-loader.js:1052` *(fixed)*
  - The bucket was keyed `"alchemist (artificer)|tce"` (display name), but `addRef` → `_applyFluff('class', d.name, d.source)` looks up the BARE `"alchemist|tce"`. Confirmed against real data: both `subclass.name` and `subclassFluff.name` are the bare `"Alchemist"`. The key mismatch meant fluff never applied and every subclass fell back to concatenated feature text.
  - **Fix applied:** Key the subclass-fluff bucket by bare `name|source` (matching `_applyFluff`), and additionally store the `"Name (ClassName)|source"` display variant for any consumer keying by the disambiguated name.
- [x] ~~**`_convertSpell` drops all but the first `entriesHigherLevel` block**~~ — `js/content/data-loader.js:449` *(fixed)*
  - `[_parseEntries(d.entriesHigherLevel[0]?.entries||…)]` only ever kept block [0]. Spells with multiple higher-level blocks (e.g. a "Cantrip Upgrade" block + an upcast block) silently lost the rest.
  - **Fix applied:** Map every block to its own parsed string (renderer joins with blank lines), prefixing a non-generic block name when present so multi-block spells read correctly.
- [x] ~~**`_findItemEntry` no source-omitted fallback — literal `{#itemEntry …}` leaks into descriptions**~~ — `js/content/data-loader.js:475` *(fixed)*
  - Lookup was exact `name|source` only; a ref that omitted the source (or named a source differing from where the template lives) missed and the literal `{#itemEntry …}` token rendered in the description.
  - **Fix applied:** Added a parallel `_ITEM_ENTRY_BY_NAME` index (first template wins) populated alongside `_ITEM_ENTRY_BY_KEY`; `_findItemEntry` now falls back to the name-only match when the exact key misses.
- [x] ~~**`expandMagicVariants` is O(variants × baseItems), ~100k calls per cold load**~~ — `js/content/data-loader.js:807` *(fixed)*
  - Scanned all base items for every variant's `requires.some(...)` predicate.
  - **Fix applied:** Pre-bucket base items by `type` code; each variant only scans the union of its requires' type-buckets (full-list fallback when a req omits `type`). **Empirically verified equivalent** — a replay over real `magicvariants.json` × `items-base.json` produced identical match sets for all 187 named variants / 5,450 pairs, 0 mismatches.

### Notes
- [x] ~~**Undo while not editing bypasses sync push**~~ — `js/panels/notes.js:879` *(fixed)*
  - The non-edit-mode branches of `_undo`/`_redo` did `file.content = …; this._save(); this._render()` — localStorage only, no Dropbox/vault push. The edit silently never reached disk.
  - **Fix applied:** Extracted a `_pushActive(file)` helper (the adapter-routing logic from `_commitEditing`) and call it from both undo/redo non-edit branches as well as commit.
- [x] ~~**800 ms debounced push survives unmount — closing tab within 800 ms of typing loses the write**~~ — `js/panels/notes.js:768` *(fixed)*
  - The per-file push debounce (800 ms) only persisted to disk/cloud after the timer fired. Closing the tab (or unmounting the panel) inside that window dropped the external write; only localStorage had it.
  - **Fix applied:** Both sync modules now keep each pending push as a named `run` closure (stored as `{timer, run}`) and expose `flushPending()` which clears the timers and fires the runs immediately. `notes.js` flushes in `unmount()` and registers a `visibilitychange→hidden` + `pagehide` handler (hoisted in `mount`, removed in `unmount`) that commits the editor and flushes both adapters — collapsing the 800 ms window to 0 the moment the page is hidden.
- [x] ~~**`_notesUpdateLineAuthors` drops authorship for duplicate lines, especially blank lines**~~ — `js/panels/notes.js:68` *(fixed)*
  - It mapped line TEXT → the FIRST occurrence's author, so every duplicate line (blank lines especially) collapsed onto one author.
  - **Fix applied:** Build an ordered per-text QUEUE of authors and `shift()` one per matching new line, so each occurrence keeps its own authorship; surplus/new lines get the current author.
- [x] ~~**Deleting author from legend leaves orphan `lineAuthors` refs**~~ — `js/panels/notes.js:658` *(fixed)*
  - Deleting an author removed only the legend entry; lines still attributed to that id rendered as colorless "ghost" authors against a missing palette entry.
  - **Fix applied:** On delete, sweep every file's `lineAuthors` and null out entries matching the removed id so those lines fall back to the unattributed style.

### Other panels
- [x] ~~**Encounter `XP_THRESH[0]` has 5 entries while every other level has 4 → wrong difficulty tier at level 1**~~ — `js/panels/encounter.js:5` *(fixed)*
  - `[0,25,50,75,100]` had a spurious leading `0`; consumers index `[easy,medium,hard,deadly]=[0..3]`, so at level 1 Easy read 0 XP, Medium 25, etc. — every tier shifted down one.
  - **Fix applied:** `[0,25,50,75,100]` → `[25,50,75,100]` (DMG level-1 thresholds), matching the 4-entry shape of every other row.
- [x] ~~**Bestiary snapshot edit (HP/AC/CR) ignored by stat-block popout**~~ — `js/panels/bestiary.js:462` *(fixed)*
  - `_openStatBlock` popped out the canonical `_5eData` entry, ignoring the DM's edited snapshot (elite goblin +HP, etc.).
  - **Fix applied:** When the snapshot differs from the canonical `_raw` (verified field names: `hit_points`, `armor_class[0].value`, `challenge_rating`), clone the entry and overlay the edits, then popout the clone — never mutating shared `_5eData`.
- [x] ~~**Modal Escape-to-close keydown never fires on non-focusable backdrop**~~ — `js/panels/shop.js:186`, `js/panels/bestiary.js:335` *(fixed)*
  - The handler was bound on the backdrop `<div>`, which isn't focusable and never receives keydown.
  - **Fix applied:** Bind the Escape handler on `document`; `close()` removes it so it can't leak. Done for both the shop item modal and the bestiary template modal.
- [x] ~~**`_loadAdventure` caches failed fetches as empty data for the session**~~ — `js/panels/books.js:150` *(fixed)*
  - A transient fetch failure stored `{data:[]}` in `_advCache`, pinning that adventure to "empty" for the whole session.
  - **Fix applied:** Added a `res.ok` check and stopped caching the failure — the catch returns a throwaway empty shape and leaves the cache slot open so the next open retries.
- [x] ~~**`.adv-list` class collision breaks bulleted lists inside chapter content**~~ — `js/panels/books.js:717`, `js/panels/adventures.js:635` *(fixed)*
  - `.adv-list` styled both the adventure-grid container (`display:grid`) and in-content `<ul>`/`<ol>`; the scoped override didn't reset `display`, so chapter lists rendered as a grid.
  - **Fix applied:** Renamed the in-content list class to `.adv-content-list` in both renderers and updated the scoped CSS (`.adv-content .adv-content-list`), fully decoupling it from the grid container. (Verified no global `ul` list-style reset would suppress bullets.)
- [x] ~~**Secret reveal state persists across delete/auto-select in NPC library**~~ — `js/panels/npc-library.js:849` *(fixed)*
  - The panel-global `_secretRevealed` flag wasn't reset when delete auto-selected the next NPC, exposing the new NPC's secret without a Reveal click.
  - **Fix applied:** Reset `this._secretRevealed = false` in the delete handler before re-render.
- [x] ~~**Generator save bypasses `lib._save()` and skips secret-rehide**~~ — `js/panels/npc-generator.js:252` *(fixed)*
  - Wrote `localStorage` directly and left `lib._secretRevealed` untouched, so the freshly-saved NPC's secret could render revealed.
  - **Fix applied:** Set `lib._secretRevealed = false` before render and call `lib._save()` (with a direct-write fallback) instead of poking localStorage.
- [x] ~~**`initPanels()` and reset-layout skip `adventures` and `books` panels**~~ — `js/app.js:10` *(fixed)*
  - The hardcoded panel arrays (used by import/reset-data via `initPanels()`, and by the reset-layout unmount sweep) omitted both panels, so they kept stale data / lingered as orphan windows.
  - **Fix applied:** Added `'adventures'` and `'books'` to both arrays in `app.js`.
- [x] ~~**Stale/missing cache busters** on `utils.js` / `state.js` / `soundboard.js` / `weather.js` / `timetracker.js` / `pdf-import.js` (+ every panel edited this batch)~~ — `skt-workspace.html` *(fixed)*
  - These had no `?v=` at all, so prior edits never shipped to returning browsers.
  - **Fix applied:** Added `?v=20260524e` to the unbustered files and bumped every file edited this batch (`app.js`, `encounter.js`, `bestiary.js`, `shop.js`, `books.js`, `adventures.js`, `npc-library.js`, `npc-generator.js`, `utils.js`, `state.js`, `main.css→y`). app.js build stamp bumped to match.
- [x] ~~**Document-level Escape keydown leaks per crop modal**~~ — `js/core/utils.js:177` *(fixed)*
  - The keydown listener was only removed on the Escape path; closing via Save/Cancel/backdrop left a dangling handler (one leaked per crop).
  - **Fix applied:** Moved `removeEventListener('keydown', escHandler)` into `cleanup()` (now a hoisted fn) so it's released on every close path.
- [x] ~~**Toast `z-index:200` sits below `modal-backdrop:500` — validation toasts hidden behind modals**~~ — `styles/main.css:2872` *(fixed)*
  - **Fix applied:** Raised `.toast` and `#toast-host` to `z-index:10001`, above modals (500), drawers (700), conflict bars (9500), and crop overlays (9500).

---

## Low priority — 30+

Polish, dead code, schema drift.

### Dead JS in `party.js`
- [x] ~~**`_conditionsRow`, `_statusRow`, `_sheetBody` are fully implemented but never called (~80 lines)**~~ *(fixed)*
  - Verified each appears only as its own definition (no callers); removed all three with their comment blocks. Kept `_sheetTabStrip` (live, called from the sheet render).
- [x] ~~**Click handlers with no matching `data-act` emitter**~~ *(fixed)*
  - Verified via grep that none of `remove`/`add`/`import-pdf`/`party-skills`/`quick-roll`/`del-res`/`add-res`/`toggle-sheet`/`sheet-tab` are emitted (sheet-tab only appeared in the now-removed `_sheetBody`; the `toggle-sheet`/`sheet-tab` pair was explicitly labelled "Back-compat"). Removed all nine `else if` blocks. Confirmed the *features* live elsewhere: add → Manage Party menu, remove → actions menu, import-pdf/party-skills → window ⋯ menu, quick-roll → the `roll-*` sheet buttons.
  - **Left in place (flagged):** removing the three methods leaves `conc-set`/`exh-up`/`exh-down`/`cond-add`/`cond-remove` handlers (+ `_toggleCondition`) with no live emitter. They were *not* in the audit's removal list, `conc-drop` is still live (status badge), and they reference real condition/concentration logic — so I left them as scaffolding rather than over-reach. Easy follow-on if you want them gone too.
- [x] ~~**Misleading `data-act="resize-start"` on the resize grip**~~ *(fixed)*
  - Removed the attribute; the grip's own mousedown handles the drag, and there was never a `resize-start` dispatch branch.

### Dead CSS (~100 lines)
- [x] ~~**`.inspiration-row` / `.inspiration-pair` / `.inspiration-toggle`**~~ *(fixed)* — superseded by `.status-badge.insp` / `.insp-give-btn`; removed the main block + the two `player-mode` overrides.
- [x] ~~**`.sheet-toggle` back-compat stub**~~ *(fixed)* — removed the rules + `player-mode` override. Kept `.sheet-tab` (live via `_sheetTabStrip`).
- [x] ~~**Notes V1 (`.notes-tabs` / `.notes-tab` / `.notes-textarea` / `.notes-preview`)**~~ *(fixed)* — removed all four families (incl. `.notes-preview` descendants). **Kept `.notes-editor`** (still used by V2, notes.js:387/501) and fixed a stale comment that referenced `.notes-preview`. (`.notes-panel`/`.notes-tab-add`/`.notes-toolbar` are also dead-V1 but weren't listed, so left untouched.)
- [x] ~~**Combat `.hp-dmg-strip` column-strip variant**~~ *(verified — nothing to remove)* — `.hp-dmg-strip` is **live**: group rows use it (combat.js:705) and the single-card damage-type select hangs off it. No `flex-direction:column` variant exists in the CSS anymore, so there was no dead variant to delete.
- [x] ~~**Old `.drawer-section` card layout**~~ *(fixed)* — drawer now uses `.drawer-group*`; `.drawer-section` had no JS/HTML refs. Removed the three rules (kept `.drawer-sec-icon`, not listed).
- [x] ~~**`.char-hp-temp[value='0']` dim-state won't re-apply after edit (attribute vs IDL value)**~~ *(fixed)* — the rule matches the value *attribute*, not the live IDL value. Added an `input` listener that mirrors keystrokes onto the attribute so the dim re-evaluates live; kept the CSS rule (it now works reliably).

### State / settings drift
- [x] ~~**Runtime-only settings keys not in `DEFAULT_SETTINGS`**~~ — `js/core/data.js:51` *(fixed)*
  - Found all 7 missing: `partyCompact`, `partyCardWidth`, `lootEncumbrance`, `monsterStatsMode`, `combatHpBar`, `combatCompact`, `combatGroupSimilar`. Added each with the default that matches its current undefined-fallback so behavior is unchanged (`combatHpBar:true` since it's read as `!== false`; `monsterStatsMode:'show'`; `partyCardWidth:null`; the rest `false`). Now they reset on "reset to defaults" and round-trip through export/import.
- [x] ~~**`syncPartyToCombat` only mirrors `hp/hpMax/ac` — name renames go stale on combat card**~~ — `js/core/window-manager.js:336` *(fixed)*
  - Added `name:p.name` to the mirror and extended the party change-handler trigger to fire on `name` edits too. Id-matched PCs (the normal case) now propagate renames to their combat slot; documented that the rare name-only-match case can't (matching key is the name itself).
- [x] ~~**Transient per-character maps never pruned on removal**~~ — `js/panels/party.js` *(fixed)*
  - Added `_pruneTransientState()` (drops entries whose id isn't in `state.party`) and call it at the top of `_render()`, so `_rollHistory`/`_activeTab`/`_expanded`/`_lastRoll`/`_historyOpen`/`_resistancesOpen` (+ the new per-char damage maps) are cleaned no matter how a PC is removed (actions menu, Manage Party, remote-sync deletion). Also prevents a recycled id from inheriting stale state.

### Per-character state bleed
- [x] ~~**`_lastDmgType` and `_lastDmgAmount` are panel-scoped — bleed between characters**~~ — `js/panels/party.js` *(fixed)*
  - Made both per-character maps (keyed by id) in the party panel: render reads `this._lastDmgType[c.id]` / `this._lastDmgAmount[c.id]`; the three writers store by id. Each card now remembers its own last type/amount instead of one panel-wide value leaking the wrong damage type (and resist math) onto every PC. Added to the prune list above.
  - **Combat left intentionally panel-scoped** — its `_lastDmgType` is load-bearing: group rows render no type select and fall back to it (the group-row resist fix from an earlier batch). Per-character there would regress that, and the comment at `combat.js:711` documents the intent.

### UX / polish
- [x] ~~**Align tool rounds cell-span guesses though renderer accepts floats**~~ — `js/panels/battlemap.js` *(fixed)* — `askAndApply` no longer `Math.round`s the span, so a fractional measurement (e.g. 2.5 cells) keeps its precision.
- [x] ~~**Touch token drag ignores Shift/snap-invert and has the double-scale bug**~~ — `js/panels/battlemap.js` *(verified — already resolved)* — the double-scale clamp was fixed in the earlier battlemap batch (both mouse + touch use `half = size*cs/2`; comment at `:3052` documents it). Touch has no Shift key, so snap-invert is N/A; touch correctly uses `_snapToGrid` directly.
- [x] ~~**Notes `_render` destroys editor preview on every sync pull — scroll lost**~~ — `js/panels/notes.js` *(fixed)* — added `_renderKeepScroll()` (captures/restores `.notes-edit-area` scrollTop) and the dropbox+vault pull callbacks now use it.
- [x] ~~**Loot item search runs full `_5eData` scan on every keystroke**~~ — `js/panels/loot.js` *(fixed)* — debounced the dropdown render ~120ms; Enter flushes the pending render so type-then-Enter still resolves.
- [x] ~~**Hidden-books + bookmarks don't propagate cross-tab via storage event**~~ — `js/panels/books.js` *(fixed)* — added a `storage` listener (attached in mount, removed in unmount) that re-reads `skt-books-hidden-v1`/`skt-book-bookmarks-v1` and re-renders, so same-browser tabs sync instantly instead of waiting on a Firebase round-trip. **Mirrored into `adventures.js`** (its `skt-adventures-hidden-v1` / `skt-adv-bookmarks-v1` keys), and its identical chapter-bookmark clamp now writes back too.
- [x] ~~**Stale chapter bookmark past end-of-chapters clamped to 0 but never written back**~~ — `js/panels/books.js` *(fixed)* — the render clamp now calls `_bumpBookmark()` so the corrected index persists.
- [x] ~~**Books panel shows "No adventures match." (copy-paste leftover)**~~ — `js/panels/books.js` *(fixed)* — now "No books match."
- [x] ~~**`parseInt(0)||fallback` prevents setting AC to 0 in bestiary snapshot**~~ — `js/panels/bestiary.js` *(fixed)* — parse first, apply when `!isNaN` so AC 0 sticks.
- [x] ~~**Curated shop extras use substring 'drink'/'food' for `excludeConsumables` vs main path's P/SC/A**~~ — `js/panels/shop.js` *(fixed)* — broadened the curated check to `/drink|food|potion|consumable|scroll|ammo/`, matching the main catalog's intent.
- [x] ~~**Shop unmount leaks open modal backdrops**~~ — `js/panels/shop.js` *(fixed)* — both backdrops tagged `data-shop-modal`; `unmount()` sweeps them so closing the window mid-modal doesn't orphan an overlay.
- [x] ~~**Avatar onerror handler can break on initials with apostrophes**~~ — `js/panels/npc-library.js` *(fixed)* — `_npcInitials` now takes the first *alphanumeric* char per word, so initials are letter-only and safe inside the inline `onerror="...'X'..."` string.
- [x] ~~**Generator quirk dedupe loop can still return identical quirks**~~ — `js/panels/npc-generator.js` *(fixed)* — second quirk is now picked from the pool *excluding* the first, guaranteeing distinctness.
- [x] ~~**Resizable textareas lose drag-resized height on every full `_render`**~~ — `js/panels/npc-library.js` *(fixed)* — `_render` captures the desc/secret heights (keyed to the NPC in the DOM via `_lastRenderedId`) and restores them after rebuild, only when the same NPC is still selected.
- [x] ~~**Generator notes write plain text but library treats `n.notes` as HTML**~~ — `js/panels/npc-generator.js` *(fixed)* — motivation is now `esc()`-escaped so it's valid HTML for the rich-text notes field.
- [x] ~~**Settings popover outside-click listener stays bound after Close/Done**~~ — `js/panels/notes.js` *(fixed)* — `close()` now removes the capture-phase document listener on every close path.
- [x] ~~**Folder rename on Dropbox leaves descendant file revs keyed under old path**~~ — `js/sync/dropbox-sync.js` *(fixed)* — `movePath` now re-keys every `oldPath/…` descendant rev to `newPath/…` after the server-side move.
- [x] ~~**`_resolveCopy` deep-clones every monster via `JSON.parse(JSON.stringify)`**~~ — `js/content/data-loader.js` *(fixed)* — added a `_deepClone` helper using `structuredClone` (markedly faster for these large objects; semantically equivalent for pure-JSON data) with a JSON fallback.
- [x] ~~**`_isReprintEntry` key not trimmed while reprint targets are**~~ — `js/content/data-loader.js` *(fixed)* — both name and source are now trimmed before the lookup, matching how the target keys are built.
- [x] ~~**Dead share-button DOM lookup in `realtime.js` shared-panels handler**~~ — `js/sync/realtime.js` *(fixed)* — removed the dead `[data-wact="share"]` loop; share state now lives in the window ⋯ menu which reads it live.
- [x] ~~**`.party-grid.compact .char-card > *` uses `!important` to nuke 8 sibling rules — fragile**~~ — `styles/main.css` *(fixed + browser-verified)*
  - The `!important` was unnecessary: the compact selector is `(0,3,0)` and every divider rule it fights is `.char-card > .child` `(0,2,0)`, so it already wins on specificity. Removed both `!important` flags. **Verified live** via a local static server + computed-style probe: in compact mode the children read `border-top:none/0px; padding-top:0px`; in normal mode the `1px dashed` dividers + padding remain — identical to before, just won by specificity. Added a comment steering future divider rules to a `:not(.compact)` qualifier instead of reaching for `!important`.
- [x] ~~**Card-avatar/char-icon-btn animate width+height (layout-driving transition)**~~ — `styles/main.css` *(fixed)* — dropped `width`/`height` from both `transition` lists (active-turn size now snaps; only border-color/box-shadow animate, which are compositor-friendly). The transform-based smooth-grow alternative was left out to avoid changing whether neighbors get pushed.

---

## Suggested first slice

If you want a quick high-impact pass (~2 hours):
1. Cache busters on `utils.js` / `state.js` and other stale entries (1-line edits, prevents the next "why isn't my fix landing?" bug)
2. Notes drag-and-drop sync (silent data loss on every reorganization)
3. Realtime echo suppression queue (silent loss of user typing under rapid edits)
4. Combat group-card drag NaN scramble

A second slice (~1 hour) for the battlemap math:
5. Drop the duplicate `* _bgMapScale` at lines 2887 and 2977
6. Move `cs = _csScreen()` inside `fogPaint`
7. Reset tokens/drawings/fog on map upload

---

## Live QA findings (browser walkthrough)

Found while play-testing the site against the static preview server.

- [x] ~~**Fog of war ignores the grid alignment offset — revealed cells render shifted off the squares**~~ — `js/panels/battlemap.js` *(fixed + pixel-verified)*
  - `_drawGrid` offsets its lines by `((gridOffset*scale)%cs+cs)%cs`, but `fogPaint` hit-tested with `floor(x/cs)` and `_drawFog` rendered at `gx*cs` — both ignoring the offset. So once the two-click **Align** tool set a non-zero offset (which it always does for a real-world grid), every revealed cell sat shifted from the drawn square by the offset.
  - **Fix applied:** both `fogPaint` (subtract `offX/offY` before flooring) and `_drawFog` (add `offX/offY` when filling) now use the exact same offset formula as `_drawGrid`. Verified in the live preview against a real aligned map (offset 15.5/7.83px img → 26.25/13.27px screen, cell 65.76px): the revealed cell's canvas hole measured `619–682px`, matching the grid square at `618–684px` (was rendering at the `~592px` origin). Existing fog repaints onto the correct squares; no migration needed.
  - *Note:* free-mode (pixel) brush strokes are intentionally left origin-relative — they're freeform, not cell-snapped.

---

## Second-pass review (2026-07-02)

Fresh multi-agent review after the original 70 were closed. Agent findings were adversarially spot-checked before fixing — several claims did NOT survive verification (showModal listeners don't leak: they're element-scoped and die with `backdrop.remove()`; NPC bulk delete DOES confirm first) and were discarded. Everything below was verified in code and, where observable, in the live preview.

- [x] ~~**Rename/move deleted the vault file before writing the new one — data loss if the write fails**~~ — `js/sync/notes-sync.js:449` *(fixed)*
  - `pushFile` did `_deleteFile(oldPath)` then `_writeFile(newPath)`. A failed write (permission revoked, disk full) left no copy on disk at all.
  - **Fix applied:** write-new-first, delete-old only after success; a failed delete of the stale copy is tolerated (recoverable — the new path is canonical).

- [x] ~~**Battlemap leaked one `document` mouseup listener per render**~~ — `js/panels/battlemap.js` (`_setupMap`) *(fixed)*
  - Anonymous handler attached in `_setupMap()` (runs on every `_render()`), never removed. **Fix:** stored on `this._docMouseUp`, swapped on re-render, removed in `unmount()`.

- [x] ~~**Escape didn't close the bestiary/combat monster pickers or utils modals reliably**~~ — `js/panels/bestiary.js`, `js/panels/combat.js`, `js/core/utils.js` *(fixed + verified in preview)*
  - Keydown was attached to the non-focusable backdrop div (the exact bug already fixed in bestiary's template modal). **Fix:** document-level keydown, removed in `close()`, applied to all four modals (`showModal`, `showConfirm`, both pickers).

- [x] ~~**XSS via NPC notes — raw HTML from shared sync rendered into innerHTML**~~ — `js/panels/npc-library.js:534` *(fixed)*
  - `${n.notes||''}` unescaped while the `secret` field beside it used `esc()`. Notes sync through the shared Dropbox account + Firebase, so any player could inject HTML that executes on the DM's screen. Notes is legit rich text, so it can't just be escaped.
  - **Fix applied:** new `sanitizeHtml()` in utils.js (template-parse, strip script/style/iframe/etc., `on*` attributes, `javascript:`/`data:` URLs) applied at render. Verified: `<script>`, `onerror`, and `javascript:` payloads stripped; formatting tags kept.

- [x] ~~**Sync failures were silent (quota, upload, realtime give-up)**~~ — `js/sync/dropbox-sync.js`, `js/sync/realtime.js`, `js/panels/bestiary.js` *(fixed)*
  - `localStorage.setItem` quota failures in both fullSync/poll paths, upload failures in `pushFile` (whose "next tick retries indirectly" comment was wrong — nothing retried once the rev was recorded), realtime giving up after 4 retries with only `console.error`, and bestiary `_save()` with a bare `catch{}` — all now surface a toast. Dropbox toasts throttle to once/min per kind (`_warnSync`) so the poll loop can't spam.

- [x] ~~**Combat + party re-attached every card's listeners on every render**~~ — `js/panels/combat.js`, `js/panels/party.js` *(refactored + verified in preview)*
  - The `[data-act]` dispatch, damage inputs, combatant field edits, and quick-pick dropdowns are now delegated: one click/change/mousedown listener attached ONCE in `mount()` on the panel body (which survives `_render()` — innerHTML only swaps children). Party's dispatch is merged with the icon-picker outside-click closer so action clicks still never close a just-opened picker (matches the old stopPropagation semantics). Verified: sheet tabs, next/prev turn, icon picker open/outside-close, damage strip all behave identically.

- [x] ~~**Battlemap settings tiles forced a full stage re-render**~~ — `js/panels/battlemap.js` (`_wireSettingsSidebar`) *(fixed + verified: `#map-stage` node survives toggles)*
  - Fog reveal/hide swap, brush mode/shape, grid square/hex/none, cell highlight, and token visibility now update surgically: sidebar re-renders in place (`_refreshSettings()`), grid changes redraw only the canvas (same lightweight path the remote-update handler already used), token visibility toggles classes on `#map-stage`. `_saveMap()` still broadcasts, so players stay in sync. Turning the fog TOOL on still full-renders (top toolbar changes).

- [x] ~~**Monster/encounter search rebuilt a 200-row list per keystroke**~~ — `js/panels/combat.js`, `js/panels/bestiary.js`, `js/panels/encounter.js` *(fixed: 150ms debounce, verified in preview)*

- [x] ~~**`_renderTokens` appended 3 nodes per token individually**~~ — `js/panels/battlemap.js` *(fixed: all nodes batched through one DocumentFragment append)*

- [x] ~~**Realtime retry backoff had no jitter; give-up was silent**~~ — `js/sync/realtime.js` *(fixed: +0–300ms random jitter so multi-tab sessions don't retry in lockstep; toast on final give-up)*

**Noted, intentionally not changed:** the Dropbox refresh token in `js/sync/dropbox-config.js` is committed by documented design (shared single account, app-folder scope, no per-user login). Residual risk: anyone with repo access can wipe the campaign folder — the revoke link in that file's comments is the kill switch. Worth confirming Firebase RTDB rules are scoped equally tightly.

---

## Mobile sync + eraser fixes (2026-07-26)

User report: "battle grid isn't syncing at times, on mobile the map doesn't update at all, eraser doesn't work." Three root causes found and fixed:

- [x] ~~**Draw / erase / fog / align / hover ignored the workspace zoom**~~ — `js/panels/battlemap.js` *(fixed + verified at 50% zoom)*
  - Every screen→canvas conversion (`clientX - rect.left`) skipped dividing by `getZoom()` — only the token drag did it right. At any workspace zoom ≠ 1 (i.e. nearly always on mobile) the eraser hit-tested the wrong spot, strokes drew offset, and fog painted the wrong cells.
  - **Fix applied:** zoom division added to draw + erase (mouse and touch), fogPaint, canvas click (align/token placement), hover-cell tracking, and the wheel-zoom cursor anchor. Verified in preview at zoom 0.5: stroke recorded at target coords exactly, eraser removed it, fog revealed exactly the aimed cell.

- [x] ~~**Cross-device apply path dropped half the map fields**~~ — `js/sync/realtime.js` (`_reloadPanel`) *(fixed + verified)*
  - BroadcastChannel only reaches same-browser tabs; a phone gets updates solely through Firebase → `_reloadPanel('battlemap')`, which never applied `gridType`, `fogStrokes`, `gridOffsetX/Y`, `bgMapScale`, or `mapRotation`. Grid-type changes and free-fog paint simply never arrived on other devices; scale changes left tokens misplaced.
  - **Fix applied:** all shared fields now applied (with `_lastTokenScale` kept in lockstep). The same missing fields were also added to the BroadcastChannel payload + handler (scale/rotation changes trigger a full render there; offsets ride the lightweight repaint).

- [x] ~~**Conflict parking silently froze battlemap updates**~~ — `js/sync/realtime.js` (`_applyRemoteKey`) *(fixed + verified)*
  - The map is written on every token drag / fog stroke by both sides, so the 300 ms dirty window collided constantly; a parked conflict then blocked ALL further battlemap updates on that device until the conflict bar was resolved — easy to miss on mobile, reads as "map stopped updating."
  - **Fix applied:** `skt-battlemap-v1` is exempt from conflict parking (last-write-wins). Losing one in-flight stroke to a rare race beats a frozen map; the local push still queued re-asserts this device's state moments later. Other keys (notes, party, …) keep full conflict handling.

---

## Notes delete-resurrection fixes (2026-07-26)

User report: "I delete a note, it doesn't reflect on a different device, and the deleted file shows up again." Two root causes in `js/sync/dropbox-sync.js`, both fixed and verified end-to-end against the live Dropbox with a throwaway test file:

- [x] ~~**fullSync re-uploaded remotely-deleted files — the resurrection bug**~~ *(fixed + verified)*
  - fullSync's pass 3 treated every file that exists locally but not in the Dropbox listing as "created locally, push it up." But "deleted remotely while this device wasn't watching" looks identical. Since fullSync runs on EVERY notes-panel mount, any device that was closed (or asleep — phones) when the delete happened would re-upload its stale copy on next open, and every other device then pulled the "deleted" file back. Guaranteed resurrection unless all devices were actively polling at delete time.
  - **Fix applied:** `_state.fileRevs` doubles as a tombstone — if this device has a rev recorded for the file's path, it synced that exact path FROM Dropbox before, so its absence from the listing means a remote delete → remove the local copy instead of re-uploading. Files with no recorded rev are genuinely local-only and still push up. Stale rev entries are pruned after reconciliation (pendingDeletes kept). Also handles remote renames correctly (old path removed, new path created by pass 2).
  - **Verified:** uploaded `zz-sync-selftest.md`, deleted it remotely, restored the stale-device state (local item + rev tombstone), reloaded → mount-time fullSync removed the local copy, did NOT re-upload, tombstone consumed, real notes untouched.

- [x] ~~**Cursor expiry silently stopped sync until remount**~~ *(fixed)*
  - When the incremental poll's cursor expired, `_pollOnce` set `cursor = null` with a comment saying "recover with a full sync next tick" — but the next tick just early-returned on `!cursor`, forever. The device silently stopped receiving ALL notes changes (including deletes) until the notes panel was remounted, which is what set up the stale state the resurrection bug then fed on.
  - **Fix applied:** a poll tick with no cursor now runs `fullSync()` to reconcile and re-establish the cursor (respects the mid-edit guard and fullSync's busy re-entrancy check).

---

## Grid opacity / line width now sync to the player view (2026-07-26)

- [x] ~~**Grid opacity (and the new line width) never reached the player view**~~ — `js/panels/battlemap.js`, `js/sync/realtime.js` *(fixed + verified live in a real ?player=1 tab)*
  - `gridOpacity` was designed as "per-user" — excluded from both the BroadcastChannel payload (same-browser player tabs) and the Firebase `_reloadPanel` apply (cross-device). But the player view has no settings UI, so "per-user" in practice meant "the DM's grid tuning silently never applies to what players see."
  - **Fix applied:** `gridOpacity` + `gridWidth` are now shared map state — added to the broadcast payload, the BC receive handler, and the cross-device `_reloadPanel` apply. Verified end-to-end: DM tab set 85%/2px → player tab applied both and repainted within 800 ms; restore to 60%/1px tracked back the same way.
  - *Also confirmed while investigating:* stroke coordinates DO rescale with map zoom (`_scaleTokensTo` handles `_drawings`), so the desktop "eraser doesn't work" reports trace to the workspace-zoom coordinate bug fixed above — desktop browsers hit it too whenever the workspace zoom control isn't at exactly 100%.

---

## Bug hunt round 3 (2026-07-26) — post-refactor sweep

Three parallel reviewers over commit ee83c059 (the delegation/zoom/sync refactor), the never-audited files, and the big panels. Every finding below was hand-verified against the code; agent claims that didn't survive verification were dropped.

### Fixed immediately (regressions from this session's changes)

- [x] ~~**PiP / pop-out combat tracker was completely dead**~~ — `js/panels/combat.js` *(fixed + verified: delegated handler fires in a swapped body, exactly once in each)*
  - The delegation refactor attached click/change/mousedown to the panel body once at mount. `_openPiP`/`_openPiPFallback` swap `_body` to a node in a DIFFERENT document — whose events never reach the old body's listeners. Every button/field in the popout did nothing.
  - **Fix:** `_wireDelegated()` now runs after each body swap; the wired-bodies guard is a WeakSet so re-wiring the restored original is a no-op (no double-dispatch).

- [x] ~~**sanitizeHtml stripped `data:image/` — pasted images in NPC notes broke, then were destroyed on next edit**~~ — `js/core/utils.js` *(fixed + verified)*
  - The blanket `data:` block on `src` removed the base64 payload of pasted screenshots/portraits; the notes input handler then re-saved the src-less HTML, permanently losing the image.
  - **Fix:** `src`/`xlink:href` now allow `data:image/*` (still block `javascript:`/`vbscript:` and every other `data:` flavor); `href`/`formaction` keep the full block.

- [x] ~~**Cache-bust versions never bumped — deployed browsers keep running OLD code after every change**~~ — `skt-workspace.html` *(fixed)*
  - Scripts load as `js/…?v=20260525c`; none of this session's 11 changed files had their `?v=` bumped, so any browser with the old cached URL (i.e. every returning device on the deployed site) would keep executing pre-fix code indefinitely. All changed assets bumped to `v=20260726a`. **Process note: bump `?v=` on every changed JS/CSS file when committing.**

### Open findings — verified real, not yet fixed

- [x] ~~**Map rotation ≠ 0 breaks all battlemap pointer input**~~ *(fixed: `_stagePoint`/`_stageDelta` helpers un-rotate every screen→stage conversion — draw, erase, fog, click/align, hover, token drags, and party-token drops; verified in preview at 90° rotation: fog painted the exact aimed cell)* — `js/panels/battlemap.js`
  - `#map-stage` rotates via CSS transform, but every screen→canvas conversion assumes an unrotated stage. At 90°/270° axes swap; at 180° both flip. Token drags move perpendicular, fog paints wrong cells, Align computes garbage. Fix: un-rotate pointer coords about the stage center, or lock rotation-dependent tools while rotated.

- [x] ~~**PC AC/HP buffs are clobbered by the party↔combat mirror**~~ *(fixed: PC buff add/remove now applies the delta to the party slot — the stat owner — and lets syncPartyToCombat mirror it back; verified: +2 AC buff survives a forced re-mirror and removal restores the original values exactly)* — `js/panels/combat.js` (`_promptAddBuff`) vs `js/core/window-manager.js:344`
  - The ✦ buff writes AC/HP only to the combatant; any party-side edit re-mirrors un-buffed `hp/hpMax/ac` over it. The buff chip stays; removing it then SUBTRACTS the delta again, leaving the PC below their true max. Fix: route PC buffs through the party slot, or re-apply active buffs after each mirror, or hide AC/HP buffs on PC cards.

- [x] ~~**Combat right-click menu + conc/buff prompts capture stale indices**~~ *(fixed: context-menu items, `_promptAddBuff`, and `_promptConcentration` capture the combatant id and re-resolve the index at click/confirm time, mirroring the party actions-menu fix)* — `js/panels/combat.js` (`openMenu`, `_promptConcentration`, `_promptAddBuff`)
  - Index + combatant snapshot captured at open; a remote reorder/removal while the menu/modal is open makes the click hit whatever now sits at that index. Same pattern already fixed for the party actions menu — mirror that fix (capture `c.id`, re-resolve at click time).

- [x] ~~**Remote battlemap update mid-drag discards the local token move**~~ *(fixed: `_reloadPanel('battlemap')` skips while `def._drag` is active — the drag-end `_saveMap()` makes this device canonical under last-write-wins anyway; logic fix, not practical to race-test locally)* — `js/sync/realtime.js` (`_reloadPanel('battlemap')`)
  - Now that the map is last-write-wins, a peer's write during a local drag re-renders the stage and replaces `_tokens`; drag-end then writes to an orphaned object and saves the un-moved array — token snaps back. Fix: while `def._drag` is active, defer the reload (apply on drag-end).

- [x] ~~**`state.settings` shallow-copies `DEFAULT_SETTINGS` — nested defaults get corrupted; Reset to Defaults can't restore them**~~ — `js/core/state.js:14`, `js/ui/settings.js:368` *(fixed: deep clone at both init and Reset-to-Defaults, same as `DEFAULT_PARTY`; verified `state.settings.shopFilters !== DEFAULT_SETTINGS.shopFilters`)*

- [x] ~~**Adventures panel caches a failed fetch as permanently empty**~~ *(fixed: `res.ok` check + failures return without caching, mirroring the books fix; verified a failed load leaves the cache slot empty for retry)* — `js/panels/adventures.js:100`
  - No `res.ok` check + the catch writes `{data:[]}` into `_advCache`, so one transient 404/hiccup pins "No chapters in this file" until a full page reload. The books panel got this exact fix (AUDIT line ~123); adventures was missed. Fix: mirror the books pattern (throw on !ok, return without caching).

---

## Sync redesign — step 1: split the workspace blob (2026-07-26)

First step of the sync architecture cleanup (see plan: one transport, small documents, field-level writes). `skt-workspace-v1` (party + combat + shop + settings in ONE 21.5KB blob, fully re-shipped on every HP tick, blob-level conflicts) is split into `skt-party-v1` / `skt-combat-v1` / `skt-shop-v1` / `skt-settings-v1`.

- `save()` still serializes everything, but the sync layer's setItem patch now skips byte-identical writes — so only the domain(s) that actually changed mark dirty and push. Verified: a monster HP tick pushes ONLY the 1.1KB combat key; a settings toggle pushes only settings; a PC HP edit pushes party + combat (the mirror pair), nothing else.
- Migration is two-sided: `load()` splits a LOCAL legacy blob (kept read-only as a rollback snapshot), and realtime init pulls the Firebase legacy node once for fresh-profile clients — without that, a new device would boot showing defaults and its first edit could seed defaults over the campaign (caught during verification, before any damage).
- Conflicts are now per-domain: two DMs editing combat and settings in the same window can no longer collide at all.
- **Deploy note:** old-code clients still read/write the legacy node until they reload with new code — ship this with the version bumps (`state.js`/`realtime.js` → `20260726c`) and have everyone reload before the next session. Remaining steps of the plan: field-level `update()` for combat/map (step 2), notes onto Firebase + Dropbox as export-only (step 3), auth + rules (step 4).

---

## Sync redesign — step 2: entity-level sync for combat + battlemap (2026-07-26)

Combat and the battlemap now sync as per-entity Firebase nodes (`skt/combat_v2/items/{id}`, `skt/battlemap_v2/tokens/{id}`, plus `meta`/`fog`/`fogStrokes`/`drawings`) instead of whole-key strings. Panels are untouched — localStorage keeps the assembled JSON; `explode()`/`assemble()` in `realtime.js` translate at the transport boundary. Push side diffs against the last known server state and multi-path-`update()`s only changed nodes; receive side does an entity-level three-way merge (pending local entity edits are kept, server wins elsewhere).

**Verified live:** a damage tick writes exactly ONE 154-byte node (21.5KB in the blob era → 1.1KB after step 1 → 154B now); a pending local edit to combatant A survives a simultaneous remote edit to combatant B and both apply — the exact race that used to clobber one side. Migration seeds v2 from local, falling back to the step-1 whole-key node; `_refreshAll` covers entity keys.

**Safety property gained:** deletions only ship for nodes present in the client's last-seen server state, so a fresh/empty client can no longer mass-delete entities it never knew about.

**⚠ Incident during verification:** that exact failure mode — under the OLD whole-key transport — had already clobbered the map's tokens server-side (a fresh preview profile's auto-fit save pushed a token-less map). Recovery staged: both server map nodes were deleted so the next real device to load (old or new code) re-seeds the full map, tokens included, from its localStorage. If the map ever comes up empty anyway, re-drag the party tokens from the map's party bar — positions were the only unrecoverable part.

Remaining roadmap: ~~notes onto Firebase with Dropbox as export-only (step 3)~~ *(done — see below)*, auth + security rules (step 4).

---

## Sync redesign — step 3: notes onto Firebase, Dropbox demoted to backup (2026-07-26)

Notes now sync device-to-device through the same per-entity Firebase layer as combat/battlemap (`skt/notes_v3/items/{id}` + `meta{order, authors}`), replacing the 8-second Dropbox polling loop as the live transport. `selectedId` stays per-device (each client keeps its own selection through remote updates). A `holdOff` hook (generalized from the battlemap drag guard) skips remote applies while the user is mid-edit so the editor never re-renders under the cursor.

**Dropbox's new role — write-through backup, not a sync source:** every edit/rename/delete still pushes to Dropbox so the .md mirror stays fresh, but nothing ever pulls from it automatically (no polling, no mount-time fullSync — the whole delete-resurrection class of bugs is out of the live path). The notes ↻ button remains as the deliberate disaster-recovery pull (fullSync with the tombstone fix).

**Verified live:** seeded `notes_v3` (12 items) via the manual backup pull; a single note edit pushed only that note's node (~335 bytes incl. meta); a simulated remote edit was skipped while `_editing` (cache untouched, so nothing was lost), applied cleanly after editing ended, and the local selection survived. Empty clients seed nothing (safety property holds). Zero console errors.

**Deploy note:** an old-code device edits notes → Dropbox only; new-code devices won't see those edits until a manual ↻. Ship with the version bumps (`realtime.js`/`notes.js` → `20260726e`) and have everyone reload together.

---

## Sync redesign — step 4: anonymous auth + database rules (2026-07-26)

The last step of the sync plan. Every client now signs into Firebase anonymously before starting sync (`firebase-auth-compat` added to the page; `initRealtime` split into auth → `_startRealtime`). Sign-in failure is non-fatal — clients fall back to unauthenticated sync so nothing breaks before the console-side setup is done. Verified live: SDK loads, sign-in attempts, fails with `auth/configuration-not-found` (Anonymous provider not yet enabled in the project), falls back gracefully, and sync runs exactly as before ("Live", full campaign loaded, zero errors).

**[`firebase-rules.json`](../firebase-rules.json)** (repo root) contains the lockdown rules: root denied; `skt/*` read/write requires `auth != null`; per-node `.validate` caps for the v2 subtrees (combat items 100KB, notes items 500KB, fog 500KB, etc., unknown children rejected); legacy whole-string keys capped at 2MB; the live-stroke channel requires the `{stroke, ts}` shape.

**⚠ TWO MANUAL CONSOLE STEPS remain (documented at the top of SETUP.md):** (1) enable Authentication → Anonymous, (2) paste `firebase-rules.json` into Realtime Database → Rules and Publish. **Order matters:** deploy the site + everyone reloads FIRST, then publish the rules — old-code clients can't authenticate and go "Offline" the moment the rules land. Until the rules are published, the database remains in test mode (anyone with the URL can write), same as it's been all along.

---

## Performance overhaul (2026-07-28)

Profiled with three parallel reviewers plus a Node reproduction of the data loader. Measured before → after, all verified in the browser.

| Metric | Before | After |
|---|---|---|
| Files fetched per load | 369 | **0** (warm cache) / 211 (cold) |
| Bytes fetched + parsed | 74 MB | **0** (warm) / 24 MB (cold) |
| Index build time | ~3,000 ms | 1,171 ms cold · **228 ms warm** |
| Index size in memory | ~80 MB | **30 MB** |
| doSearch() | 15.1 ms | **1.69 ms** |
| renderSearchTabs() | 16.5 ms | **0.18 ms** |
| doSearch calls per 6 chars typed | 6+ | **1** |
| Full panel rebuilds per HP click | 2 | **0** |
| Canvas redraws per 50 mousemoves | 50 | **1** |

- [x] **Adventures no longer indexed** — 98 files / 45 MB were fetched and parsed on every load to build 833 rows that `getSearchPool()` discarded unconditionally and no panel ever read (Adventures/Books fetch their own content). Removed from `data-loader.js`; row count 17,079 → 16,246 with per-category counts otherwise unchanged.
- [x] **`defer` on all 34 scripts** — 1.29 MB of JS no longer blocks first paint (no inline scripts, so execution order is preserved).
- [x] **IndexedDB index cache** (`skt-5edata`) keyed by `DATA_STAMP#INDEX_SCHEMA`. Warm loads hydrate in one read: **0 data fetches**. Write is deferred to idle and `meta` is written last, so a half-written cache is never a hit; cache reads race a 3 s timeout so a hung/blocked IDB can never be worse than today. Verified: stale stamp → clean rebuild; Settings → **"Rebuild data index"** is the manual escape hatch.
  - **Bump `DATA_STAMP` in `js/content/data-loader.js` whenever anything under `data/` changes** — same discipline as the `?v=` query strings.
- [x] **Search index** — `_n`/`_h` normalized fields precomputed at build (was ~68k regex executions per keystroke); pool memoized on a signature that deliberately ignores live party stat edits; tab counts in one pass instead of 21 filters; `keydown` no longer runs a full search on every character (it bypassed the 80 ms debounce entirely) and flushes a pending debounce before Enter/Arrow so they never act on a stale list.
- [x] **Monster resist/immune/vulnerable FIXED** — `combat.js` read `raw.immune`/`resist`/`vulnerable`, but `_raw` is the *converted* object whose fields are `damage_*`. Those reads were always `undefined`, so **monsters have always taken full damage from everything**. Facets are now hoisted onto index rows (`_immune`/`_resist`/`_vulnerable`, plus `_cr`/`_type`/item+class facets) and copied onto combatants when added; numbered duplicates ("Ogre 2") resolve via name-stripping. Verified: Skeleton takes 4 bludgeoning → 8, 10 poison → 0, 3 fire → 3. **Encounters will hit harder than the party is used to.**
- [x] **Surgical HP updates** — a single HP click used to rebuild BOTH the party and combat panels (re-serializing every character sheet). `_patchHp(i)` on each panel patches just that card and the mirror routes through it; structural transitions (downed/dead/temp-HP/grouped) still fall back to a full render.
- [x] **rAF-batched canvas** — fog paint and cell-hover fired a synchronous full redraw per mousemove; now coalesced to one per frame, and the fog canvas only reallocates its backing store when dimensions actually change. Pending frames are cancelled on unmount.
- [x] **Quota failures surfaced** — `warnStorageFailure()` (throttled 1/min per subsystem) on party/combat, notes, and battle map saves. These were bare `catch{}`, so a full quota silently discarded writes while the session looked healthy.

**Deliberately NOT done, with reasons:**
- *Portraits → IndexedDB blobs:* would make character icons **device-local**, breaking the cross-device sync players rely on. The base64 icons are 96px/~5–11 KB each — not the real quota risk. Notes with pasted images are; those are now covered by the quota toast.
- *Map picker thumbnails:* the picker renders full-resolution art (largest are 16 MB, ~280 MB decoded). Real fix needs generated thumbnails, i.e. a build step, which is out of scope for this no-build project. Added `decoding="async"` so decodes don't block the main thread. **Still the largest open memory item.**
- *`width` → `transform` CSS transitions:* animate briefly on HP change rather than continuously; converting means touching every bar-write site for negligible gain.
- *Stripping `_raw` from cached rows* (would take 30 MB → ~7 MB): needs migrating shop.js's filter helpers off many raw fields. Deferred as high-risk/low-reward versus keeping `_raw` cached.
- *`notesSync.stopPolling()` on unmount* and *`SEARCH_DATA` removal:* both were reviewer claims that **did not survive verification** — the stop call already exists, and `SEARCH_DATA` is the only source for the condition context menus.

---

## Service worker + automated cache-busting (2026-07-28)

- [x] **`tools/stamp-build.js`** — hashes every JS/CSS file and writes the hash into its `?v=` in the HTML, then stamps `sw.js` with a build id + precache list. Replaces manual `?v=` date bumps, which failed silently (it happened during this session's work: a fix didn't take because the browser served a cached `utils.js`). `--check` mode exits 1 when stamping is needed, for a pre-commit/CI gate. Verified idempotent, and correctly detects an edited file.
- [x] **`sw.js`** — offline support + correct caching. HTML network-first (fresh asset hashes always win online), hashed JS/CSS cache-first (safe: changed file = changed URL), `data/*.json` stale-while-revalidate, `img/` cache-on-use capped at 120 entries, **cross-origin never intercepted** so Firebase sync is untouched. Versioned shell bucket, all other `skt-*` buckets purged on activate.
- [x] **Removed the `no-cache, no-store, must-revalidate` meta tags** — they forced a full re-download of 1.3 MB of JS on every load as a stale-code defence. That job now belongs to content hashes + network-first HTML, without the bandwidth cost.
- [x] **Update prompt** — a new build installs and *waits*; the page shows "A new version is available — Reload" instead of swapping code under a live session. Doubles as the **version-skew warning** that repeated deploy hazards in this file called for. Also re-checks for updates on tab focus.

**Verified in the browser:** with the dev server fully stopped, a reload booted the complete app — shell rendered, real campaign loaded (party + 7 combatants), all 16,246 index rows hydrated — and search, panel opening, and damage application all worked offline. Firebase stayed "Live" throughout, confirming cross-origin passthrough. A simulated deploy produced the toast; clicking Reload activated the new worker, reloaded into the new build, and collapsed three stale shell buckets to one.

**Gotcha found and fixed during verification:** update detection is genuinely racy — `updatefound` can fire before `register()` resolves, so a single listener misses it. The registration now watches all three entry points (already-waiting, install-in-flight, install-starts-later) plus timed backstops, with an idempotency guard so overlapping paths can't double-prompt.

**Deploy note:** run `node tools/stamp-build.js` before committing. The first deploy after this change is the last one that needs everyone to hard-reload manually; from then on the update prompt handles it.

---

## Moving `img/` off git — code side done, hosting pending (2026-07-28)

Goal: `.git` is **5.61 GiB** because 14,278 images (3.8 GB) are committed; webp can't be delta-compressed. Measured: img blobs are 5.57 GiB of the pack, **all other history is 0.06 GiB** — so purging `img/` should land `.git` at roughly **65–90 MB**. The site is also far past GitHub Pages' documented 1 GB limit (images serve today, but unenforced).

Decisions: keep every image (host on Cloudflare R2, don't prune), rewrite history, generate thumbnails.

### Done and verified

- [x] **`assetUrl()` / `assetThumbUrl()` in `js/core/utils.js` + `js/core/asset-config.js`** — all 13 render-time `'img/' + path` sites now route through one helper; `imgBase: ''` reproduces today's URLs exactly. Verified as a **provable no-op**: 22 image requests, 0 failures, map background + picker cards + bestiary tokens + covers all render.
  - Absorbs the long-standing `_img` inconsistency (monsters prefix-less at `data-loader.js:1271`, everything else prefixed at `:1212/:1232`) by stripping any leading `img/`.
  - **Four sites deliberately still build relative `'img/…'` strings** (`battlemap.js:1943`, `combat.js:1926`, `data-loader.js:1212/1232`) because those values are **stored and synced to Firebase** — persisting an absolute CDN URL would bake in a hostname. `renderIcon()` re-bases them at render time. Commented in place so nobody "fixes" them.
- [x] **Percent-encoding** — 5,870 filenames contain spaces (256 parens, 106 apostrophes). Browsers auto-encode *relative* URLs, so this was invisible locally, but hand-built absolute CDN URLs would have 404'd on all of them. `_encPath()` encodes per segment, idempotently. Verified `bestiary/tokens/MM/Hill Giant.webp` → 200 `image/webp`.
- [x] **Thumbnails** — `tools/make-thumbs.py` (Pillow) generated **1,702 thumbs, 46 MB, 0 errors**, scoped by applying the picker's own `imageType: map|mapPlayer` filter to the adventure/book data. The same images at full size are **1,884 MB**. A picker card is now **28 KB instead of 2,573 KB (93× smaller)**. Map picker + starred strip switched over, each with a full-size `onerror` fallback.
- [x] **Service worker prepared** — cross-origin allow-list (`IMG_ORIGINS`, currently empty so behavior is unchanged) added *above* the same-origin guard rather than weakening it, so Firebase/gstatic still fall straight through. Thumbnails get their own `skt-thumb-v1` bucket (cap 1500) so browsing can't evict full-size maps from `skt-img-v1`; both added to `KEEP` and the cleanup regex.
- [x] **`.gitignore`** for `/img/` and `/thumbs/`. Correctly does **not** untrack the existing images — they must keep serving from Pages until the CDN is live.

### LIVE as of 2026-07-28 — images now served from Cloudflare R2

Bucket `dnd-img`, public base `https://pub-4b8864700c38402395c9f9951ed106ce.r2.dev`.

- **Upload verified by content, not just size:** 15,980 objects (14,278 images + 1,702 thumbnails), 3.768 GiB. `rclone check --one-way` → **0 differences, 14,278 matching files**. Single-part uploads (`--s3-chunk-size=32M` exceeds the 16.5 MB largest file) keep every ETag a true MD5, so that check is a real hash comparison.
- **CORS + `crossorigin="anonymous"`** on all 11 generated `<img>` sites and on `img.crossOrigin` before `.src` in `_loadBgFromPath`.
- **Verified live in the browser:** 23 requests from the CDN, **0 still hitting local `img/`**; percent-encoded names (`Hill%20Giant.webp`) resolve; Firebase still "Live" (same-origin guard intact); map loads at 3000×1905 and **`getImageData` succeeds — canvas NOT tainted**, so adaptive grid contrast still works (sampled luminance 184); **19 CDN images cached in `skt-img-v1`**, which is only possible with non-opaque responses and therefore proves CORS end to end.
- `tools/verify-cdn.sh` passes 6/6 (public access, content-type, cache headers, CORS, thumbnails, awkward filenames).

**Still fully reversible:** the images remain in the repo. Setting `imgBase: ''` in `js/core/asset-config.js` restores local serving.

### `r2.dev` load-tested — the rate-limit worry was unfounded (2026-07-28)

Cloudflare designates the free `pub-*.r2.dev` URL as non-production and rate-limited, which was the stated reason to consider a custom domain before purging. Measured instead of assumed: **481 requests / 115 MB in 34 s at 40 concurrent** — 5–10× a real session, and harsher per-IP than five players browsing.

- **481/481 HTTP 200. Zero 429s, zero throttling.** (The one 404 in an earlier run was `adventure/SKT/thumbnail`, a *directory* the test script picked up — not a missing object.)
- Latency p50 **317 ms**, p95 **1.1 s**.
- **No edge caching**: repeat requests to the same object stay at p50 ~170–210 ms with no `Age` or `cf-cache-status` header, despite `Cache-Control: immutable, max-age=31536000`. Every request reaches the R2 origin.

So a custom domain would buy edge caching, not rate-limit relief — and the service worker already caches images per-device, so the gain is first-view-only. **Decision: no custom domain; proceed r2.dev → soak → purge.** Residual risk is policy, not capacity: Cloudflare could tighten `r2.dev` at any time precisely because it's non-production.

### Remaining — the history purge (irreversible; soak first)

**Tooling is built and tested: `tools/purge-img-history.sh`.** Rewrites in a fresh clone and stops — it never pushes, and never touches the working repo, which stays a complete fallback. Gates on: clean tree, on `main`, in sync with `origin/main` (unpushed work would be discarded by the force-push), `img/` still tracked, `.gitignore` covers `img/`, `imgBase` non-empty, and **8 CDN probes sampled across the tree all returning 200**. Backs up to a tag + bundle, then proves the bundle by *actually cloning from it* and comparing HEAD, commit count and file count — `git bundle verify` alone only checks prerequisites, not that the result is usable.

Predicts the post-purge commit count up front (**14 image-only commits will vanish, 236 of 250 remain**) and asserts it afterwards, so a surprise is a failure rather than a shrug.

Verified end-to-end on a throwaway repo built to mirror the real conditions — force-added images past `.gitignore`, real CDN paths, a bare upstream: **.git 12M → 102K**, `img/` gone from index and all history, predicted commit count exact, key source files intact, original repo and upstream both provably untouched.

**Soak checklist before running it:** one real session with players connected · every device loaded the new build · Settings → Data → Diagnostics shows no `Failed to load img` entries (the error handler records resource failures, so this is now measurable rather than a vibe) · a fresh incognito window renders images, since the service worker will otherwise mask a broken deploy with cached copies.

1. **R2, not Pages**: Pages caps a project at 20,000 files; 14,278 images + thumbnails leaves no headroom. R2 has no file limit, 10 GB free (need ~3.9 GB), zero egress.
2. Upload with `rclone copy ./img r2:<bucket>` — bucket root mirrors the *contents* of `img/`; thumbnails to `thumbs/`. Set `Cache-Control: public, max-age=31536000, immutable`.
3. **CORS is mandatory, not optional.** `battlemap.js` reads pixels off the map background (`getImageData`) for adaptive grid contrast, and `npc-library.js` uses `toBlob` — a cross-origin image taints the canvas and silently kills the first and throws in the second. CORS also keeps SW responses non-opaque; opaque entries are never cached by `cacheFirst` (`res.ok` is false) and force-caching them costs ~7 MB padding each.
4. Also add `crossorigin="anonymous"` to generated `<img>` tags and `img.crossOrigin` before `.src`, or requests stay `no-cors` and come back opaque even with CORS headers present.
5. Then set `imgBase` in `js/core/asset-config.js` **and** `IMG_ORIGINS` in `sw.js` (they must match), soak for a few days with the repo copy as a live fallback, and only then purge history.
6. **Purge is last and irreversible.** Tag `pre-cdn-purge` and push it first; take a mirror clone + bundle and verify both; `pip install git-filter-repo`; rewrite in a *fresh* clone; force-push. **Never `git reset --hard` the old clone afterwards — against an img-less tree that deletes all 14,278 files from disk.** Verify in a fresh incognito profile: the SW will happily keep serving cached images and make a broken deploy look fine locally.

---

## Backups — whole-state snapshot/restore (2026-07-28)

**The finding:** Settings had an Export/Import pair, so backups looked covered. The export wrote six fields — `party`, `combatants`, `combatRound`, `activeCombatantId`, `shop`, `settings` — out of the ~50 `skt-*` keys the app owns. Session notes, the battle map (tokens, fog, drawings, saved and starred maps), the bestiary, the NPC library, loot, encounters, soundboard scenes, time, weather and every bookmark were **absent from every backup ever taken**, and the import gave no hint of it. Measured on a live profile: importing an old-format file would have cleared **9 populated key groups**.

### Done and verified

- [x] **`js/features/backup.js`** — `snapshot()` captures every `skt-*` key minus a documented denylist (`skt-me-v1` is the important one: it's per-browser author identity, and restoring it onto a second device makes two people the same notes author). Values are stored as **raw strings, never re-parsed** — a `JSON.parse`/`stringify` round trip reorders keys and drops `undefined`, so the restore wouldn't be byte-identical to the backup.
- [x] **Restore is destructive on purpose, and says so.** Keys absent from the file are cleared, otherwise a restore *merges* and an NPC deleted before the backup was taken comes back to life. The confirm dialog lists exactly which local data will be cleared, and warns that a restore overwrites the shared campaign for everyone connected.
- [x] **The clobber trap — the reason this needed care.** Writing keys locally and reloading does **not** work: on the next load the sync listeners attach, read the server's still-pre-restore copy, and apply it over everything. The restore vanishes with no error anywhere. `_flushDirtyKeys`/`_flushEntityKey` now return their promises and `window.realtimeFlushAndWait()` resolves `published` / `partial` / `offline` / `timeout`; the UI only reloads on `published`, and on anything else keeps the restored state on screen and tells the user to sync first.
- [x] **Entity keys ignored a clear** — `_flushEntityKey` returned early when the local value was gone, leaving every exploded child node on the server so the next load pulled the deleted data straight back. Now removes the base node. (Affects `skt-combat-v1`, `skt-battlemap-v1`, `skt-notes-v2`.)
- [x] **Stale keys are `setItem('')` *then* `removeItem()`** — both matter. `setItem` is the only thing realtime.js hooks, so it's what marks the key dirty; `removeItem` then leaves storage clean and makes the flush push `null`. Stopping at `''` left empty-string debris in every later snapshot (caught by the round-trip test failing).
- [x] **Rolling automatic snapshots** in IndexedDB (`skt-backups`) — a backup you have to remember to click is a backup you don't have. Two independent 10-deep rings so timed snapshots can't evict deliberate ones (`manual`, `before-restore`); both capped, since an uncapped ring is an unbounded disk leak. Byte-identical consecutive autosaves are skipped so an idle tab can't flush real history out of the ring. One is taken automatically before any restore.
- [x] **Legacy imports still work** — the original six-field format is detected and mapped onto the modern keys, and flagged in the preview as incomplete.

**Verified in-browser (24 assertions):** snapshot covers 14/16 live keys with both omissions on the denylist; file round-trip byte-identical; restore byte-identical after mutation; stale keys fully removed with no empty-string debris; sync reported `published`; pre-restore snapshot written; both rings cap at 10; legacy parse rebuilds the combat shape and warns about 9 key groups it would clear; malformed and non-backup JSON rejected with readable messages. Restore was exercised against **non-synced keys only** — a real restore publishes, and this profile points at the live campaign.

**Still not covered, stated in the UI:** soundboard *audio* (raw Blobs in the `skt-soundboard` IndexedDB store, routinely hundreds of MB) and the derived 5e data index (rebuilds itself).

---

## Global error handler (2026-07-28)

**The finding:** no `window.onerror`, no `unhandledrejection` listener, nowhere in `js/`. Every uncaught exception died in a console nobody had open. Both failures found earlier this same day were of exactly that shape — sync listeners dead with `permission_denied` while the UI still read "Live", and 262 monster portraits rendering as empty rings.

### Done and verified

- [x] **`js/core/errors.js`, loaded first.** Defer scripts execute in order, so installing ahead of everything else means the handlers exist while the rest of the app is still parsing — a syntax error anywhere below gets logged instead of lost.
- [x] **Toast only for the genuinely exceptional** — uncaught exceptions and unhandled rejections. `console.error`/`console.warn` are recorded but never toasted: Firebase logs to console on ordinary network blips, and a toast per blip is worse than silence.
- [x] **Resource errors are not app errors.** An `<img>` 404 fires the same `error` event with the element as target; `renderIcon`'s token fallback deliberately relies on one. Filtered on `ErrorEvent`, so image failures are logged quietly and never surface as "something went wrong".
- [x] **Throttled and collapsed.** One toast per 30 s with an overflow count, so a render loop throwing every frame can't paper the screen over (verified: 25 errors → ≤1 toast). Consecutive identical entries collapse to a single row with a counter rather than evicting real history from the 120-entry ring.
- [x] **Passive console capture** puts the 47 existing `console.warn`/`error` sites in the log without editing any of them.
- [x] **Known cost, mitigated:** wrapping `console` moves DevTools' clickable source link to `errors.js`. Unavoidable while wrapping, so the wrapper resolves the true call site from the stack and stores it on the entry — the diagnostics view keeps attribution the console loses (verified: `@ /js/core/utils.js:388:52`, cache-bust hash stripped).
- [x] **Diagnostics viewer** built from raw DOM, depending on nothing but `document` — it has to work when the app is broken. Copy-all falls back to `execCommand` when `navigator.clipboard` is unavailable, which is exactly the plain-http LAN case where you're most likely debugging. Reachable from Settings → Data → Diagnostics, with a count badge that turns the button red.
- [x] **Log survives a reload** (sessionStorage, 64 KB cap, oldest-first drop) — the error often *causes* the reload.

**Verified in-browser (20 assertions):** real uncaught throws and real unhandled rejections both captured with stacks; toast fires with a working Details action; `console.error` captured but silent; image 404 not counted as an app error; 8 repeats collapse to one row with `n=8`; flood throttled; `report()` records with source; viewer renders and copies; log survives reload; badge reflects and resets; a getter that throws inside a logged object does not break logging (reentrancy guard). Clean boot logs **0 entries, 0 toasts**.

**Not covered:** the ~125 `catch(e){}` blocks. A swallowed error is invisible to every mechanism here, by definition — `sktErrors.report(source, err)` exists for converting the ones that matter, but that is per-site follow-up work.

---

## PWA install target (2026-07-28)

**The finding:** `manifest.json` had `"start_url": "./skt-workspace.html?player=1"`. `start_url` is what launches when you tap the installed icon — not the URL you installed from — and `app.js:18` returns early on that flag, skipping `load()`, `initRealtime()` and all dock wiring. So installing the app gave you the **read-only player view, every launch**, with no route back to your own workspace short of typing the URL. Latent until this session, when the service worker made installing worth doing at all.

- [x] **`start_url` → the DM workspace**, with the player view kept reachable as a manifest `shortcuts` entry (taskbar right-click / Android long-press), so one install serves both roles.
- [x] **Explicit `id`.** Absent, it defaults to `start_url` — meaning any future change to `start_url` changes the app's *identity* and reads as a different app rather than an update. Pinned to `skt-workspace` so that can't happen again. **Consequence: an already-installed copy needs uninstall/reinstall once**, since this change itself moves the identity.
- [x] **Explicit `scope`** (`"./"`, relative so it resolves correctly under both `/` locally and `/DND_Site/` on Pages).
- [x] **`icon-maskable.svg`** for Android adaptive icons: full-bleed background (the platform supplies the mask, so edge transparency shows as a notch) and art scaled to 85%. Measured, not eyeballed — the base icon's art reaches radius **195 of the 204.8** safe-zone limit, inside it but with ~10px to spare; the maskable variant reaches **166**, a 39px margin.

**Verified in-browser (18 assertions):** manifest parses and serves as `application/json`; `start_url` and the shortcut both resolve inside `scope`; both icon files return 200 as SVG; the new `start_url` boots the DM workspace (15 dock buttons, realtime up, 0 errors logged); `?player=1` still enters player mode cleanly.

---

## Per-device battle-map zoom (2026-07-29)

**The ask:** mobile players want the map zoomed in, desktop players want it out. One shared zoom made that impossible.

**Why the obvious fix corrupts data:** `_bgMapScale` isn't just a display value — `_scaleTokensTo()` (`battlemap.js:612`) destructively multiplies every token `x/y` and every drawing point by the zoom ratio, so **stored coordinates are in stage pixels baked at the current zoom**. Simply un-syncing it would have made two devices at different zooms disagree about token positions by that ratio, and tokens *are* synced — so whichever saved last moves everyone's tokens. Same class as `AUDIT.md:41` and `AUDIT.md:281-282`.

### Done and verified

- [x] **`_bgMapScale` frozen as a world scale**; a new per-device `_viewScale` layered on as a CSS transform. **No data migration**: existing maps stay self-consistent at whatever scale they were baked at, and new maps start at 1 so their coordinates become map-native.
- [x] **The coordinate change is three lines** — `_stagePoint` (:304) and the mouse/touch drag handlers (:3164/:3253) divide by `_screenScale()` instead of `getZoom()`. `_stagePoint` measures from the bounding-box *centre* and `el.width`/`el.offsetWidth` are untransformed, so a uniform ancestor `scale()` changes exactly that one divisor. `_csScreen`, `_drawGrid`, `_drawFog`, `_cellAtPx`, the fog offsets and the **Align tool** are untouched.
- [x] **Two wrappers, not one** — `#map-sizer` carries the scaled layout size (a transform doesn't affect layout, so without it you could zoom in but not scroll to the rest of the map); `#map-zoom` carries `scale()` at origin `0 0`. Kept separate from `#map-stage`, which already owns `rotate()` at origin `50% 50%`, so every existing `querySelector('#map-stage')` still works.
- [x] **Role-scoped key** (`skt-bm-view-v1` / `skt-bm-view-player-v1`), read in `mount()` — not the object literal, because `body.player-mode` is added by `initPlayerView()` after this file parses. A DM window and a TV/player window on one machine keep separate zoom.
- [x] **Screen-size floors counter-scaled.** A CSS transform silently reinterprets `min-width:32px` and `Math.max(11, …)` as *stage* px. The mobile token tap target is now `calc(32px / var(--bm-vs))` — measured at 0.30 zoom it computes to 106.7 stage px = **exactly 32 screen px**; without it, 9.6px on the platform this feature targets.
- [x] **Old/new interop** — old code still writes `bgMapScale`, but it pushes the rescaled tokens in the same entity, so the payload is internally consistent and can't corrupt a new device. `_absorbWorldScaleChange()` folds the change into `_viewScale` so on-screen size doesn't lurch.
- [x] **Bugs fixed in passing:** players had the zoom slider and Fit, both of which called `_saveMap()` — **any player zooming was rescaling every token for the whole table**. And `realtime.js:572` reloaded the background image on *every* battlemap update (even a fog tick); now only on an actual map change.
- [x] **Fit didn't fit.** It measured the raw image while layout is driven by the grid, which rounds up to whole cells — so the last row overflowed, raised a scrollbar, shrank `clientHeight`, and Fit reliably failed. Verified pre-existing (the new sizer is algebraically identical to the old stage size), then fixed to fit the grid extent.

**Verified in-browser (20 assertions).** Coordinate correctness was proved by round-tripping through the browser's own layout engine — place a marker at a known stage point, read where it actually lands, feed that back through `_stagePoint` — rather than by performing drags, so the test wrote nothing: **0.000px error across viewScale {0.4, 1, 2.5} × rotation {0, 90} × workspace zoom {1, 1.25}**. Token and drawing coordinates **byte-identical across four zoom changes**. **Zero writes to `skt-battlemap-v1`** during 25 wheel events plus slider and Fit (previously every wheel tick shipped the whole blob to Firebase). Two windows held independent zoom and each restored its own on reload; a stale stored map path correctly triggered a re-fit. 0 console errors throughout.

### Follow-up: remote updates no longer force a full rebuild (2026-07-29)

Profiled the panel under a synthetic session load (20 tokens, ~500 fog cells, 25 strokes). Local hot paths were already fine — fog painting is rAF-batched via `_invalidate({fog:true})`, token drags use `_renderTokens()` (0.50 ms), `_drawFog()` is 0.19 ms. **The outlier was `_render()` at ~10–12 ms**, and the cross-device sync path called it unconditionally.

The asymmetry: the same-browser BroadcastChannel handler had always used a cheap repaint, while `realtime.js` — *the only live path a player on their own phone or laptop has* — did a full innerHTML teardown for the identical event. Every token move and fog reveal rebuilt the toolbar, sidebar, stage and every token node.

- [x] Extracted that repaint into **`_repaintRemote()`**, now shared by both live paths instead of existing only inside the BroadcastChannel closure.
- [x] `realtime.js` picks one of three tiers: map path changed (or image not yet loaded) → reload + re-fit; **stage geometry** changed (`cols`/`rows`/`cellSize`/`gridType`/`bgMapScale`/`mapRotation`/grid offsets, compared via a signature captured before the fields are overwritten) → full `_render()`; otherwise → `_repaintRemote()`. Anything that resizes the stage still takes the old path, so the fast path can only ever be taken when it's safe.
- [x] Also stopped `_loadBgFromPath` running on **every** update — a fog tick used to re-create the `Image` and force a *second* full render on top of the first.

**Measured: 11.94 ms → 2.42 ms (4.9× faster)**, and 1.52 ms when the token payload is unchanged (the common case during a fog stroke, where the hash check skips token DOM work entirely).

**Verified end-to-end against live Firebase**, using two tabs as two independent sync clients: a display-only change (`gridOpacity` 80→55) applied on the receiver with **1 repaint and 0 full renders**; a geometry change (`mapRotation` 0→90) correctly fell back to **1 full render** with `rotate(90deg)` landing on the stage. Both test values restored afterwards; 0 console errors.

### Follow-up: undo/redo for the battle map (2026-07-29)

**The gap:** zero matches for "undo" anywhere in `battlemap.js`. An accidental fog reveal, a stray pencil stroke, a misclicked "Clear drawings" — none of it was recoverable, mid-session, in front of players. Fog is the one that stings: revealing a room early can't be taken back.

- [x] **Snapshot-based, captured in `_saveMap()`.** There are 20+ sites that mutate tokens/fog/drawings and every one ends in `_saveMap()` — hooking them individually would have guaranteed a missed one. Committing on save also gets the granularity right for free: a fog drag, a token drag and a pencil stroke each save once, at the end, so each is one undo step.
- [x] **Content only** — tokens, fog, fog strokes, drawings. Grid size, alignment, rotation, zoom and the map image are deliberately excluded: Ctrl+Z silently swapping the map back would be a worse surprise than not undoing.
- [x] **30-deep, with no-op dedupe.** A save that doesn't change content pushes nothing.
- [x] **A remote change clears the history and re-baselines** — undoing across another device's edit would silently revert their work.
- [x] **Ctrl+Z / Ctrl+Shift+Z**, scoped by two guards: bail on any editable target (the notes editor owns Ctrl+Z while you type in it) and require the map window to carry window-manager's `.focused` class. Plus `↶`/`↷` toolbar buttons in both the DM and player toolbars, disabled when their stack is empty.

**Bug found and fixed during verification:** `_undoRedo` called `_repaintRemote()`, which clears the undo stacks — so undo worked exactly once and then erased its own history. Split into `_repaintLayers()` (pure painting, used by undo) and `_repaintRemote()` (re-baselines, then paints). Caught by the test asserting three successive undos, not by reading the code.

**Verified in-browser (24 assertions):** three distinct edits → depth 3, each undo peeling back exactly one layer and leaving the others intact; full drain to empty and full redo back up; a new action clearing the redo branch; the 30-entry cap holding across 45 edits; persisted state matching memory. Keyboard: fires when the map window is focused, ignored in `<input>`/`<textarea>` (notes keeps Ctrl+Z), ignored when another window is focused, Shift redoes. Remote: a simulated remote update cleared both stacks and the next undo correctly returned to the *remote* state rather than jumping behind it. 0 console errors; all test tokens/fog/drawings cleared from the live campaign afterwards.

### Follow-up: cache the grid luminance probe (2026-07-29)

`_drawGrid` picks a grid colour that contrasts with the map art by resampling the **entire image** (3000×1905 on the current map) down to 4×4 and reading it back with `getImageData`. It did that on every call — and `_drawGrid` runs on every render, every remote update, and every fog repaint — even though the value depends only on the image.

- [x] Cached in `_bgLuminance()`, **keyed on the Image object rather than the path**. Every load path assigns a brand-new `Image`, so a different map is automatically a cache miss and there is no invalidation to forget.
- [x] A failed sample (tainted canvas) is cached too, so a CORS failure doesn't retry the expensive resample forever.

**Measured under the same synthetic load as the original profile:** `_drawGrid` **2.70 ms → 0.98 ms**, `_setupMap` **2.58 ms → 1.30 ms**, `_repaintLayers` (the remote-update path) **2.42 ms → 1.06 ms**. Grid output is pixel-identical, verified by hashing the canvas before and after; reloading the map produces a fresh `Image`, correctly misses the cache, recomputes, and yields the identical grid.

**Not a regression, checked:** `_render` appeared to slow down between runs, but repeated timings bounce 24.8 → 7.6 → 12.4 → 5.6 ms with DOM node count flat at 1441 across 20 renders — high variance in a non-compositing preview pane, no listener or node accumulation.

### Follow-up: canvas crispness at high zoom — done (2026-07-29)

The three map layers (grid, drawings, fog) are bitmaps sized in stage pixels, and the per-device zoom is a CSS transform — so past 100% the browser magnified those bitmaps and the grid went soft. `_sizeLayer()` now allocates the backing store at k× the stage size and hands back a context pre-scaled by k, so the layers rasterise at display resolution while every existing draw call keeps working in stage coordinates unchanged.

- [x] **k is capped, and the cap is the point.** Uncapped, a 1617×1036 stage at 2.8× on a 2× phone asks for k=6 — ~240 MB per canvas, ~720 MB across three; browsers refuse the allocation or the tab dies. Budget: 8 MP per layer (~32 MB), plus the 16384px hard side limit. Measured worst case **92 MB across all three layers**, with k landing at 2.18 instead of 2.8. On a very large map (6000×4000 stage) the budget correctly refuses to add any resolution at all — k=1.
- [x] **k never drops below 1**, so the zoomed-out case can never get worse than it is today; resolution is only ever added.
- [x] **Debounced (180 ms).** `_applyViewScale` schedules the re-rasterise rather than doing it inline — reallocating three backing stores per wheel tick would stutter far worse than the moment of softness while zooming. Verified: no reallocation during the zoom itself, k upgrades after settle.

**Real bug this surfaced:** `_stagePoint` derived the element centre from `el.width` — which for a canvas is the **backing store**, equal to the stage size only by coincidence. The moment `_sizeLayer` started allocating at k×, every click, drag, fog paint and Align measurement was off by that factor at high zoom. Now computed from state (`_cols × _csScreen()`), which is exact and immune to how a layer is rasterised. Caught by the coordinate round-trip failing at k=2.18 while passing at k=1.

**Verified in-browser:** coordinate error is now **identical (0.0053px, from the fractional stage width) at k=1 and k=2.18**, via the grid canvas, the draw canvas and the stage div, including at 90° rotation and workspace zoom 1.25 — i.e. k provably does not affect coordinates. Grid lines land at the same stage positions at both k (max drift 0.70px, and the higher k resolves one extra edge line). A stroke drawn at stage y=300 rasterises at y=300 at both k, thicker in device pixels at high k. Fog coverage identical (alpha 140 both). Undo/redo unaffected. 0 console errors; campaign state left clean.

---

## Firebase / Cloudflare cost check (2026-07-29)

Measured after the session's changes, because "did this make my bills go up" deserves numbers rather than reassurance.

**Firebase.** Whole campaign database is **82.5 KB** — 0.008% of the 1 GB free tier. A page load pulls ~66 KB of listened keys, so the 10 GB/month download cap is ~150,000 loads away.

Net traffic went **down**, and the biggest win was invisible: zoom used to call `_scaleTokensTo()`, rewriting every token coordinate and drawing point, so the entity sync saw *every token node* change and pushed them all plus drawings plus meta — and every connected player then downloaded it. Firebase bills downloads, so one wheel gesture cost ×(number of players). Now zero. `_fitMapToView` had the same problem via auto-fit on every panel resize. Also removed: the redundant background-image reload on every remote update (Cloudflare traffic, not Firebase).

Added this session and costing **nothing** on Firebase: backups and rolling snapshots (IndexedDB), the error log (sessionStorage), undo/redo (one save per undo — identical to the edit it reverses).

**Cloudflare R2.** 3.768 GB stored of 10 GB free; egress is always free; the one-time upload was 15,980 of the 1M/month Class A allowance. Reads are the only recurring cost and land around 20,000/month against a 10M allowance — 0.2%. Service-worker caching and thumbnails (2,573 KB → 28 KB per picker card) hold it there.

### Fixed: legacy blob downloaded on every load

`js/sync/realtime.js` pulled the ~24 KB `skt_workspace_v1` legacy node on **every page load**, then checked whether the migration was needed — roughly a third of the app's total Firebase download, for a migration that completed long ago. The test is purely local, so it now runs *before* the network read.

The post-read re-check is kept, and it isn't redundant: on a genuinely fresh profile the key listeners may deliver real data while the request is in flight, and their newer data must win over the legacy blob. Verified `load()` only *reads* the split keys on a fresh profile, so the guard is meaningful rather than always-true.

**Verified live:** this profile has 4/4 split keys so the read is skipped, the migration path did not run, party data intact, sync live, 0 errors — and the legacy node is still present in Firebase (23.6 KB) as the fallback for a genuinely new device. **The fresh-profile path itself was NOT exercised against the live campaign on purpose** — a fresh-profile client already clobbered real data once this session, so that branch is verified by inspection only.

Also noted, not changed: ~40 KB of dead nodes (`skt_workspace_v1`, `skt_notes_v1`, `skt_combat_v1`, `skt_battlemap_v1`, and a `data` node nothing in the codebase reads or writes). Storage cost is nil and three of them are still wired as migration fallbacks, so deleting them buys nothing.

---

## Adventures/Books de-duplication (2026-07-29)

Measured rather than eyeballed: the two panels shared **24 member names, 19 of them >90% identical and 13 byte-for-byte**. Everything that genuinely differed was a user-facing noun.

The duplication had already cost real bugs — a cross-tab sync fix had to be hand-mirrored between the files, one panel shipped a copy-paste "No adventures match." while showing books, and the comments drifted so the same function documented "3000+ items" in one copy and nothing in the other.

`js/panels/content-panel.js` now holds the 14 shared members, merged by `applyContentPanelShared()`, which refuses to overwrite anything a panel defines itself. **2090 lines across two files → 1501**, with 729 of those in one place instead of two.

**The trap, avoided:** merging is by assignment, so putting a mutable property like `_bookmarks: {}` in the shared object would have handed *both* panels the same object and made them overwrite each other's bookmarks. Only methods and one immutable lookup table moved. `_renderList` and `mount` stayed per-panel — 86 of ~150 lines genuinely differ.

**Verified:** all 14 members merged into both panels as the same function object; bookmarks are distinct objects after mount and write to their own storage keys with no cross-contamination; SKT renders 42,206 chars over 22 chapters with reference tags and images intact; Bigby Presents renders 21,782 chars over 10 chapters; 0 console errors.

## battlemap.js size — assessed, and NOT split

I flagged the 3,800-line `battlemap.js` as worth splitting. Having measured it, **I'd hold off**, and the reason is worth recording.

By concern: fog 567 lines, tokens 347, drawings 245, map picker 222, zoom/view 186, undo 91 — and 2,124 lines in none of those groups. So the biggest self-contained slice is 15% of the file, not the majority.

**The blocker:** `_mapBgImage` is a module-scoped `let` with **46 usage sites**, read by `_drawFog`, `_drawGrid`, `_applyFogBlur` and `_drawCellHighlight`. Methods moved to another file would reference an undefined variable, so any fog or drawings extraction requires first relocating that variable onto the panel — a broad mechanical edit with no functional benefit, done purely to enable a file move.

Only the token methods (~250 lines, 6%) are cleanly extractable today.

Unlike the Adventures/Books work, this removes no duplication and fixes no bug — it is pure reorganisation of the file that carries the most live campaign state, with no test suite to catch a slip. The honest cost/benefit says the enabling change is riskier than the tidiness is worth. Revisit if `_mapBgImage` ever moves onto the panel for its own reasons.

---

*Generated by codebase audit workflow. Findings have already been adversarially verified — false positives were stripped before this list was written. When fixing an item, mark its checkbox and (optionally) annotate with the date and commit hash so future audits can skip it.*

---

## Fix + optimize pass (2026-07-29)

No open items were left on the list above, so this round hunted fresh
findings by measuring the running app rather than working from a stale
checklist. Everything below was verified in the browser.

- [x] ~~**No way to run the app without joining the live campaign**~~ — `js/sync/realtime.js`, `js/sync/dropbox-sync.js` *(fixed + verified)*
  - Any local page load auto-connected to the shared Firebase campaign. A
    throwaway browser profile doing exactly that once pushed an empty
    battlemap over the real one (see the incident note in the step-2 section).
  - **Fix applied:** `?nosync=1` runs everything against localStorage and
    never opens a Firebase connection, persisted per-tab in sessionStorage so
    in-app navigation (player view, pop-outs) can't silently reconnect once
    the param falls off the URL; `?nosync=0` clears it. Dropbox rides the same
    switch by reporting "not configured" — every `_api()` call already checks
    that. **Verified:** zero requests to firebase/googleapis/dropbox on a full
    boot. Use this for all local development.

- [x] ~~**"Asmodeus (Tiefling)" rendered a completely empty card**~~ — `js/content/data-loader.js` *(fixed + verified)*
  - MTF defines it as identical to the PHB tiefling: no traits, no ability
    scores, and no fluff entry either, so there was nothing to render.
  - **Fix applied:** a subrace that supplies nothing renderable inherits the
    parent race's raw entry. Deliberately narrow — the other 97 subraces
    override or extend the parent and are untouched, so they can't double up
    on inherited text. The `d.name` guard is load-bearing: races.json has 5
    UNNAMED subraces (base variants of Dragonborn/Half-Elf/Half-Orc/Human/
    Tiefling) that `addRef` correctly drops, and without it the merge handed
    them the parent's name and resurrected all 5 as phantom rows — caught by
    watching the row count go 16246 → 16250.

- [x] ~~**NPC library leaked a document listener pair on every render**~~ — `js/panels/npc-library.js` *(fixed + verified)*
  - `_wireDivider()` attached anonymous `mousemove`/`mouseup` handlers to
    `document` and runs from `_render()`. Every re-render (a sync pull can
    trigger those repeatedly) added another closure-retaining pair that
    nothing removed. Same bug as `notes._wireDivider`, which was fixed
    earlier; npc-library has the identical code and was missed.
  - **Fix applied:** handlers built once in `mount()`, removed in `unmount()`,
    drag state on `this._dividerDrag`. `_wireDivider` keeps only the divider's
    own element-scoped mousedown. Unlike the notes fix this is fully
    symmetric, so it doesn't rely on the handlers outliving the panel.
  - **Measured:** document add/removeEventListener counted across 5
    mount/unmount cycles of all 15 panels — was +1 mousemove +1 mouseup per
    cycle, all attributable to npclib; now zero. Divider still works after a
    remount (378px → 440px on a synthetic drag).

- [x] ~~**Sync failures left no trace in the diagnostics viewer**~~ — `js/sync/realtime.js`, `js/sync/notes-sync.js`, `js/sync/dropbox-sync.js` *(fixed + verified)*
  - The sync layer swallows into bare `catch(e){}`. The behaviour is right —
    one corrupt node must not abort a whole assemble — but it left no record,
    so "a combatant vanished" or "sync just stopped" was unfalsifiable.
  - **Fix applied:** 16 catches now call a local `_diag()` that records to
    `sktErrors`. No toast, no rethrow, no behaviour change; each null-guarded
    so a missing errors.js can't turn a swallowed error into a thrown one.
    The ones that cost data if they fire: `assemble()` throwing discards the
    ENTIRE remote update for a key; `flushPending()` throwing on tab close
    drops the pending note write; `_saveState()` quota failure loses the rev
    tombstones that stop deleted notes resurrecting; a failed listener
    re-attach kills sync for the session.
  - **Left alone:** the ~108 best-effort catches elsewhere (localStorage
    probes, listener callbacks) — noise, not signal.
  - **Verified:** a corrupt node fed through the real assemble path still
    skips that node and returns the good combatants, and now leaves one entry
    naming it.

- [x] ~~**Search comment documented behaviour that was never implemented**~~ — `js/content/search.js` *(fixed)*
  - The comment promised `"frost gnt"` finds "Frost Giant". Tokens match as
    substrings, not subsequences, so it returns 0 — `"frost gia"` works.
    Comment corrected, with the reason substring is the deliberate choice
    (subsequence would make "gnt" hit "aGeNT", "puNGeNT", …).

- [x] ~~**Every page load silently re-downloaded the whole 5etools dump**~~ — `sw.js`, `tools/stamp-build.js` *(fixed + A/B measured)*
  - `data/*.json` used stale-while-revalidate. SWR fires `fetch()`
    unconditionally — including on a cache hit — so any load that rebuilt the
    search index with a warm SW cache re-fetched all 289 files (29.9 MB) to
    replace them with byte-identical content. Pure waste: the dump is
    immutable between refreshes.
  - **Careful with the evidence here.** DevTools shows a SW-intercepted
    request as TWO entries (page→SW, SW→network), so "items.json appears
    twice" does NOT by itself prove double bandwidth — that read was wrong at
    first. The dev server's request log is the authoritative source, because
    SW cache hits never reach it.
  - **Fix applied:** cache-first, with `DATA_CACHE` keyed to `DATA_STAMP`
    instead of a hand-written `v1`. `tools/stamp-build.js` now reads
    `DATA_STAMP` out of `js/content/data-loader.js` and stamps it into
    `sw.js`, so the stamp that already gates the in-app index cache gates the
    HTTP cache too — one thing to bump, and a missing constant is a hard
    error rather than a silent stale pin. The activate handler already
    deletes non-current `skt-data-*` buckets, so the changeover is automatic.
    Dead `staleWhileRevalidate` helper removed.
  - **A/B, identical scenario (index cache wiped -> forced rebuild, data cache
    warm), counted from the server log:**
    - stale-while-revalidate: all 289 files re-fetched
    - cache-first: **0 files** — confirmed the load really did rebuild
      (`index ready (build) 16246 rows`), so the zero isn't trivial

- [x] ~~**Grid lines uneven / one missing when zoomed OUT**~~ — `js/panels/battlemap.js` *(fixed + measured; follow-up to the snapping fix)*
  - The device-space snapping fix was real but addressed the wrong half of
    the problem. `_canvasK` clamped at `>= 1` ("only ever add detail"), so at
    40% zoom the grid was rasterised 3003px wide and the BROWSER downscaled it
    to ~1200. Resampling a 1px line by 0.4 lands it differently on every line.
  - **Measured over one row at 40%, simulating the compositor's downscale:**
    38 lines instead of 39 (one gone entirely), peak ink 14–230 out of 255,
    widths split evenly 1px/2px. Which lines were faint changed with the zoom.
  - **Fix applied:** `_canvasK` now tracks `viewScale x dpr` DOWN as well as
    up (floor `_CANVAS_MIN_K` 0.2) so the backing store matches the on-screen
    size — one backing pixel per device pixel, no resampling. Safe for all
    three layers because each is re-rasterised from state (grid from
    cols/rows, strokes from stored points, fog from its cell grid), never
    resampled from a bitmap. `_requalityCanvases` switched to a RATIO
    threshold — a fixed 0.05 was 20% of the resolution at k=0.2 but under 2%
    at k=3, so the low end would have stayed stale. `_scheduleRequality` now
    redraws the grid synchronously (~1 ms, strokes only) instead of behind the
    180 ms debounce, since a grid rendered for the old scale is an obvious
    defect where soft fog is not.
  - **After, measured through the same simulated downscale:** 25/40/60/100%
    all render every line at exactly 1px and full 255.
  - **Still imperfect zoomed IN:** `_CANVAS_MAX_PIXELS` (8 MP) caps k at 1.176
    on a 3003x1925 stage, so at 150%/275% the backing store is upscaled and
    peaks range 168–252 / 207–255. Raising the budget is not free — k=2.75
    would need ~175 MB per layer, ~525 MB across three, on a platform where
    the touch zoom cap is 6x. The real fix is rendering only the visible
    viewport at full resolution; deferred as a separate change.
  - Coordinates verified unaffected: `_stagePoint` output is identical at
    k=0.4, 1 and 1.176, and it derives stage size from `_cols`/`_csScreen()`
    plus the CSS `rect`, never from `canvas.width`.

- [x] ~~**Choosing a map didn't repaint the DM's own view**~~ — `js/panels/battlemap.js` *(regression from the per-device zoom work; fixed + counterfactual measured)*
  - User report: "I tried loading a new map in the DM view and only the map in
    the player view changed, and I need to close the Battle Map window then
    open it again."
  - `_loadBgFromPath`'s `autoFit` branch called only `_fitMapToView()`, leaving
    the `_applyBg()` + `_render()` to the non-autoFit branch. That was fine
    while `_fitMapToView` ended in `_applyZoomTransform`, which resized the
    stage in pixels and called `_applyBg` on the way past. Per-device zoom
    replaced it with `_applyViewScale`, which only sets a CSS transform and so
    has no reason to touch the background — and the repaint went with it.
  - Result: picking a map re-fitted the grid to the NEW image's dimensions
    while leaving the PREVIOUS map's art on the stage (the oversized grid
    hanging off the old picture), until the window was closed and reopened —
    `mount()` renders from scratch. Only the DM's own window was affected;
    every other view gets the change over BroadcastChannel or Firebase and
    re-renders on that path, which is why the player view looked correct and
    the DM's didn't.
  - **Fix applied:** both branches of `_loadBgFromPath` now `_applyBg()` +
    `_render()`. Deliberately fixed there and not in `_fitMapToView`, which is
    also called by the Fit button and the ResizeObserver — the art hasn't
    changed on those paths and a full render would be waste. Verified the Fit
    path still does not rebuild the stage node, and that `_viewScale` survives
    the added `_render()` (`_setupMap` re-applies it).
  - **Counterfactual, same panel, same session:** start on map A, switch the
    path to B and run the OLD sequence (`_fitGridToBg` + `_fitMapToView`) —
    stage still shows A. Add `_applyBg` + `_render` — stage shows B.

## Audit: what the old `_applyZoomTransform` used to do (2026-07-29)

Two defects had already traced back to repaints that used to ride inside
`_applyZoomTransform` before the per-device zoom work replaced it with
`_applyViewScale`. That's a pattern, not a coincidence, so this is a
line-by-line audit of the old function's responsibilities against what covers
them now. It found a third.

The old function did eight things. Coverage today:

| # | Old responsibility | Covered by | Verdict |
|---|---|---|---|
| 1 | `stage.style.width/height` | `_setupMap` ONLY (via `_render`) | callers must render on geometry change — see below |
| 2 | `_applyBg(stage, W, H)` | `_setupMap`, and now `_loadBgFromPath` | **was broken**, fixed |
| 3 | grid canvas resize + `_drawGrid` | `_scheduleRequality` (synchronous) | **was broken**, fixed |
| 4 | draw canvas resize + `_drawAllStrokes` | `_scheduleRequality` (debounced) | ok |
| 5 | `_drawFog` | `_scheduleRequality` (debounced) | ok |
| 6 | token position / size / font | automatic under the CSS transform; glyph font floor in `_counterScaleLabels` | ok |
| 7 | token name label position / font floor | `_counterScaleLabels` | ok |
| 8 | slider value + % readout | `_applyViewScale` (now shows *effective* %) | ok |

Rows 1 and 2 are the dangerous ones: exactly one place in the file sets the
stage's pixel size and re-tiles the background, so **every path that changes
`_cols` / `_rows` / `_cellSize` must reach `_render()`**. Auditing all seven
writers of those fields:

- `mount()` load — followed by `_render()` — ok
- `_fitGridToBg` via `_loadBgFromPath` — fixed earlier this session
- `_restoreMapSnapshot` — routes through `_loadBgFromPath` or `_render()` — ok
  (it was also broken before the `_loadBgFromPath` fix, and that fix repaired it)
- three grid-size inputs (`:1741`, `:1969`, `:2551`) — all `_saveMap(); _render()` — ok
- Firebase apply in `realtime.js` — compares a `_struct()` of all eight
  geometry fields and renders on any change — ok
- **BroadcastChannel receive — checked only scale and rotation** — BROKEN

- [x] ~~**Grid-size changes didn't resize the stage in a same-browser player tab**~~ — `js/panels/battlemap.js` *(found by this audit; fixed + measured)*
  - `_repaintRemote`'s own comment states the contract: *"Callers must still
    fall back to `_render()` when the map's GEOMETRY changes
    (cols/rows/cellSize/scale/rotation)."* The Firebase path honoured it; the
    BroadcastChannel handler checked scale and rotation only, so a cell-size
    change from the DM fell through to the lightweight repaint.
  - **Measured:** cellSize 80 → 110 left a same-browser player tab's stage at
    800×1040 when it should have been 880×1100 — grid and background out of
    step with the new cell grid. A cross-device player was unaffected, which
    is what made it easy to miss.
  - **Fix applied:** the handler now captures the same eight-field `_struct()`
    before applying the message and renders when it moves. Verified the
    cell-size case takes the full-render branch and lands on the correct stage
    size, **and** that a fog-only message still takes the cheap path — the
    point of `_repaintRemote` is that fog ticks don't cost a full rebuild.

**Net: the zoom rewrite left three defects, all now closed.** Two were
repaints that silently stopped happening; the third was a geometry check that
existed on one live-update path and not the other. Worth remembering that the
DM's own window and the two remote paths are three separate code paths for the
same event, and a change to one is not a change to the others.

- [x] ~~**Zoomed-in canvas layers were soft — the pixel budget was spent off-screen**~~ — `js/panels/battlemap.js` *(fixed + measured)*
  - `_CANVAS_MAX_PIXELS` (8 MP) is a per-layer budget, and a layer covering
    the whole map spent it on area nobody was looking at. On a 3040x1920 stage
    (5.8 MP) that capped `k` at 1.18, so zooming to 275% just upscaled a 1.18x
    bitmap — grid, pencil strokes and fog all soft. At that zoom the viewport
    shows ~623x385 stage px, about 4% of the map: ~96% of those pixels were
    never visible.
  - **Fix applied:** `_sizeLayer` now sizes each layer to `_visibleStageRect()`
    — the on-screen part of the stage — and positions it there, with the
    offset folded into the context transform as
    `setTransform(k,0,0,k,-ox*k,-oy*k)`. That last part is what makes this
    cheap: **every existing draw call is unchanged**. Callers still work in
    stage coordinates and still clear with `(0,0,stageW,stageH)`; anything
    outside the covered rect falls off the canvas and is clipped. An
    rAF-throttled `scroll` listener repaints as the viewport moves.
  - Falls back to the old full-stage behaviour when the stage is rotated (the
    visible region becomes an inverse-rotated box and it isn't worth the math
    for a rare setting), when the scroll container isn't measurable, or when
    the whole stage already fits — where the two are equivalent anyway.
  - **Measured on the 3040x1920 map:** `k` 1.18 → **2.75** at 275% zoom, and
    effective resolution is **exactly 1.00** backing pixel per device pixel at
    0.4 / 1 / 1.5 / 2.75. Backing store *fell* from 32 MB to 6.9 MB. Grid line
    positions verified against prediction while scrolled: worst centre error
    0.55 stage px, which is the deliberate half-pixel snapping, not drift.
  - **Prerequisite, committed separately:** `_stagePoint` used to take the
    coordinate frame from whatever element the caller passed, and nine of ten
    callers pass a CANVAS. That is only correct while every canvas is exactly
    the stage's box — precisely the invariant this change breaks. It now
    resolves `#map-stage` itself.
  - **Smoke test caught two of its own flaws here**, both of which looked like
    product bugs: it downscaled by the STAGE size (stretching a viewport-sized
    canvas across the whole map), and it sampled a single mid-height row that
    can land exactly on a horizontal grid line, inking the row end to end and
    reading as one enormous "line". Fixed to scale by what the canvas actually
    covers and to sample five rows, keeping the busiest. Red-green re-verified
    against the reintroduced bug afterwards.

- [x] ~~**Strokes redrawn after a scroll painted at the previous offset**~~ — `js/panels/battlemap.js` *(regression from the viewport-sizing change, caught by auditing it; fixed + red-green verified)*
  - `_drawAllStrokes` took its context with `canvas.getContext('2d')` and
    relied on whatever transform `_sizeLayer` had last left there. That was
    safe while layers always covered the whole stage — a stale transform was
    still the correct transform. Once layers track the viewport it is not:
    four callers reach `_drawAllStrokes` without sizing first (the eraser at
    `:908`, the remote repaint at `:1401`, the live-stroke preview at `:1522`,
    the rAF flush at `:3508`), so any redraw after the view moved painted
    every stroke at the old scroll offset.
  - **Fix applied:** `_drawAllStrokes` now sizes its own layer, matching
    `_drawGrid` and `_drawFog` which have always been self-sufficient. The
    guarantee belongs in one place rather than at four call sites where the
    fifth will be missed. Cheap — `_sizeLayer` only reallocates when the
    backing dimensions actually change, the same reason `_drawFog` can call it
    on every fog-paint mousemove.
  - **Verified:** a stroke at a known stage position, drawn through the
    un-sized path while scrolled to the far corner at 250%, lands within the
    expected band (residual offset is the 6px round line cap at k=2.5, not
    drift). New smoke check `strokes redraw at the right place after
    scrolling`, red-green verified against the reintroduced bug.

**The stale-node trap bit a third time.** Writing that smoke check, the first
two versions failed with "stroke did not render at all" and both looked like
product bugs. Cause: the test captured `#draw-canvas` before a wait, and
anything that re-renders replaces that node, so it was reading a detached
canvas. Same root cause as the two earlier false alarms this session. **When
testing this panel, re-query every DOM node after any await.**

- [x] ~~**Rotated maps were excluded from viewport sizing**~~ — `js/panels/battlemap.js` *(fixed + measured)*
  - `_visibleStageRect` bailed out on any rotation, so a rotated map kept the
    full-stage layers and stayed soft at high zoom.
  - **Fix applied:** the viewport's four corners are mapped into stage space
    and their bounding box taken. `#map-stage` rotates about its own centre, so
    a corner at `(zx, zy)` in un-scaled `#map-zoom` space becomes
    `_stageDelta(zx - W/2, zy - H/2) + (W/2, H/2)` — the same conversion
    `_stagePoint` uses, reused rather than re-derived, because a second copy of
    the rotation maths is exactly what goes quietly wrong. For the rotations
    this panel supports (0/90/180/270, all `_stageDelta` implements) the
    rotated viewport is still axis-aligned in stage space, so the box is exact.
  - **Measured at 250% zoom, scrolled, all four rotations:** strokes land in
    the right place (residual is the 6px round line cap, not drift), and the
    invariant *"whatever is at the centre of the viewport is inside the rect we
    chose to rasterise"* holds at every rotation x scroll position tested —
    zero violations.

### Found while doing that, NOT fixed — rotated maps overflow their scroll area

Pre-existing and independent of the viewport work, but worth writing down
because it is more user-visible than the sharpness it was found chasing.

`_applyViewScale` sizes `#map-sizer` to `W x H x viewScale` — the UNROTATED
stage dimensions. At 90/270 the rotated stage's visual box is `H x W`, so the
two disagree. Measured on a 3040x1920 map at 90 degrees:

| | |
|---|---|
| sizer box | 3040 x 1920 |
| rotated stage box | 1920 x 3040 |
| overflow top / bottom | **560px each** |
| overflow left / right | -560px each (scrolls through empty space) |

So roughly a third of a 90-degree-rotated map cannot be scrolled to, and
horizontally you scroll through 560px of nothing at each end. This is why the
visible rect collapses to a sliver at maximum scroll on a rotated map — the
rect is correct; the place it is pointing at genuinely is mostly off-map.

The fix is to size the sizer to the rotated extent and translate the stage so
the rotated content starts at the origin, which also shifts the coordinate
frame `_visibleStageRect` reads. That is a separate change and deserves its own
pass rather than being bolted onto this one.

- [x] ~~**A player drawing in a same-browser tab never reached the DM window**~~ — `js/panels/battlemap.js` *(fixed + measured with two live tabs)*
  - User report: "a player is also drawing." The BroadcastChannel handler
    opened with `if (!isPlayer) return; // DM tab only sends; ignore its own
    echoes`. That reason is **wrong** — BroadcastChannel never delivers a
    message back to the context that posted it, so the DM tab has no echoes to
    ignore. What the guard actually dropped was every OTHER tab's message,
    including a player's.
  - Measured before the fix: the player's stroke reached shared localStorage
    (1 drawing) while the DM tab's in-memory `_drawings` stayed at **0**.
    Cross-device players were fine, since Firebase carries `drawings` both
    ways — so this only bit a player sharing the DM's browser, and offline it
    never arrived at all.
  - **Fix applied:** the broadcast payload carries a `role`, and the DM tab
    accepts pencil annotations from a `player` message — **and nothing else**.
    A player's payload contains the whole map state, so applying all of it
    would let a stale player tab push its tokens or fog back over the DM's.
    Drawing and erasing are the only shared state a player can change;
    everything else in their toolbar is per-device. The DM then `_saveMap()`s
    so the stroke reaches Firebase and every other device.
  - **Verified with two real tabs**, player at 220% zoom and DM at 100%:
    the stroke arrives, coordinates identical (`240,320,560,320`), renders in
    the right place on the DM canvas. Coordinates match because strokes are
    stored in stage pixels and per-device `_viewScale` deliberately never
    touches them.
  - **Isolation verified from the adversarial side:** a player broadcasting a
    divergent full state — a ghost token, `gridType: 'hex'`, a fog cell — had
    only its stroke accepted; `ghostTokenLeaked: false`, DM grid still square.
  - Same-entity races stay last-write-wins, as everywhere else on this map: if
    the DM adds a stroke in the same instant, whichever array lands second is
    the one kept.

## The three map-update paths are now one (2026-07-31)

Structural fix for the pattern behind several of this session's bugs. Every
live map update arrives on one of three routes — the DM's own window, a
same-browser BroadcastChannel message, or a cross-device Firebase apply — and
two of those were independent copies of the same logic. They drifted apart
repeatedly, and three separate bugs all had the shape *"make path B do what
path A already does"*:

- the cross-device apply silently missed `gridType`, `fogStrokes`, the align
  offsets, scale and rotation for a long time;
- later the BroadcastChannel path was the one missing the geometry check, so a
  cell-size change left a same-browser player on a stale stage;
- and the same handler dropped every inbound message, blocking a whole role.

`battlemap.applyMapState(src, opts)` is now the only code that knows how to
take a map snapshot and put it on screen. `src` uses the field names the stored
map JSON and the broadcast payload already share, so either can be passed
unchanged. The transports only decide WHAT to hand it:

- BroadcastChannel keeps the live `strokeTick`/`strokeEnd` preview messages and
  the player-role policy (the DM accepts a player's drawings and nothing else),
  then delegates.
- `realtime.js` hands over the parsed localStorage value and nothing more.

**149 lines of duplicated logic removed.** One behaviour change fell out for
free: the mid-drag guard (`if (this._drag) return`) existed only on the
Firebase route, so a BroadcastChannel update could previously yank the map out
from under a token drag. Both routes have it now.

Verified with two live tabs after the refactor:

| direction | result |
|---|---|
| DM → player, token move | arrives, renders in the DOM |
| DM → player, cellSize 50 → 90 | propagates, stage resized to 2160x1620 to match |
| player → DM, drawing | arrives with exact coordinates |
| player → DM, ghost token + hex grid | **rejected** — drawings only |

Smoke suite green, 13 checks.

### Measured and deliberately NOT changed

Recording these so the next pass doesn't re-investigate them:

- **Memory is a non-issue.** Heap 39.6 MB against a 4 GB limit with the full
  16,246-row index and every `_raw` pinned; localStorage 39 KB. No reason to
  shrink the index.
- **Panels are healthy.** All 15 mount and unmount with zero errors; slowest
  is battlemap at 69 ms (canvas setup), everything else under 15 ms.
- **Content rendering is complete.** All 16,246 entries pushed through
  `buildDetailBody`: 0 errors, 0 empty cards. The 288 "thin" items and 42
  thin languages render everything the source data has (e.g. Abacus really is
  just cost + weight) — not a bug.
- **`desc` emptiness is a misleading metric.** 11,393 rows have no `desc`
  because monsters/items/feats/tables render from `_raw` stat-blocks instead.
  Measure rendered output, not `desc`.
- **Warm boot is served by the service worker.** Data files don't hit the
  network at all; index comes from the IndexedDB cache in ~818 ms vs ~2036 ms
  to rebuild. Note the resource-timing buffer caps at 250 entries and
  silently truncates — use the dev server's request log for anything
  authoritative.


## PDF importer, validated against two real sheets (2026-07-31)

Two actual character sheets (a level-6 rogue and a level-6 warlock, a custom
874-field template, not the WotC form) were run through `_fromFields`. Most of
the importer held up unchanged: class/level, abilities, AC, speed, all 18
skills, all 6 saves, prof bonus, HP, attacks and 17 spells all came out right.
Three things did not.

**Warlocks imported with zero spell slots.** The indexed-template slot walker
matched `/(\d+)\s*Slot/i` against each `spellSlotHeader<N>`. A warlock's section
never contains the word "Slots" — the real field reads `"2 Pact OO"` — so the
match failed and every warlock silently got `spellSlots: {}`. The level lookup
was fine (`spellHeader3` = `"=== 3rd LEVEL ==="`); only the count regex was
wrong. Now also accepts the pact form, giving `{3: {total: 2, expended: 0}}`,
and the Pact Magic short-rest restore added earlier works on the result.

**`Defenses` was parsed by nobody.** The warlock's sheet says
`"Resistances - Radiant, Necrotic"`, and the party card has had
`c.resistances`/`immunities`/`vulnerabilities` all along — the import just never
filled them, so the tool applied full damage from two types the character
resists. `_parseDefenses` now locates resist/immune/vulnerable headings by index
and assigns each run of text between them, defaulting to resistances for text
before any heading. Only the 13 canonical damage types are accepted, so prose
("from nonmagical attacks", "advantage on saves vs. charm") contributes nothing
rather than guessing. On merge the lists are **unioned** with whatever the DM set
by hand, and are only written when the parse found something — a PDF with no
defenses line can't clear chips someone toggled on.

**`Passive1` added as a passive-Perception alias.** This template numbers its
passives rather than naming them. On both sheets `Passive1/2/3` are exactly
`10 +` Perception/Insight/Investigation, so it agrees with the value the party
panel already derives; the alias only matters for sheets whose skill rows are
blank.

Two candidates deliberately **not** taken:

- `Total` = `"6d8"` as a hit-dice alias. `_deriveHitDice` uses the raw string
  only for the *current* pool, never the die size, so on these sheets it
  produces exactly what class+level derivation already produces — no gain. And
  "Total" is generic enough to collide with a currency or weight total on some
  other template, where a small value would wrongly show spent hit dice.
- `CharacterName` reading `Zoey\(Rogue\`. That is an artifact of the throwaway
  Python extractor used to dump the fields (its regex stops at the first `)`,
  including PDF-escaped ones), not of the app — pdf.js unescapes properly.
  Fixing the app here would have corrupted correct input.

Method note, again: the first short-rest check appeared to show pact slots *not*
restoring. `_shortRestAll` routes through an async `showConfirm`, and the
assertion ran before the callback did. Testing `_applyShortRest` directly shows
the warlock restoring to 0 expended and a wizard with identical slots correctly
keeping them spent. Same class of mistake as the stale-DOM-node reads: assert
after the async boundary, not across it.

### Three more sheets: Wizard 8, Wizard 5 / Fighter 3, Ranger 9

**The ordinary slot table was never broken.** A wizard's sections read
`"4 Slots OOOO"` — the format the original regex was written for. Wizard 8
imports 4/3/3/2, exactly the RAW table, so the earlier warlock failure really
was specific to the pact wording and the fix didn't need to go further.

**Multiclass imported at the wrong level.** `"Wizard 5 / Fighter 3"` was matched
by a start-anchored pattern that stopped after the first pair, so a level-8
character became a level-5 wizard with 5 hit dice and no fighter half at all.
Now every class/level pair is collected: the character level is their sum, the
highest becomes the primary class, and the split is kept on
`sheet.classLevels`. Verified against `"Fighter 1/Rogue 2/Wizard 3"` (no spaces
around the slash) and `"Wizard 5 (Evocation) / Fighter 3"` too.

`cls` deliberately stays a **bare class name**. `_tabFeatures` matches it with
`d.name.toLowerCase() === clsName`, so storing the joined string would have
silently emptied the class *and* subclass features tabs — the kind of quiet
downgrade that only shows up when someone opens the tab weeks later.

That created a second-order problem worth naming: with the level correctly
raised to 8, gating class features by character level would have handed the
wizard three levels of features she doesn't have. `_tabFeatures` now gates on
the character's levels *in that class* when `sheet.classLevels` is present, and
falls through to the total otherwise. Confirmed in the DOM: the multiclass
renders a "level 5" pill and no 6th–8th-level content, while a pure Wizard 8
still renders "level 8" and does. Race features are untouched — they never read
that variable.

**Ranger 9 imports only 1st-level slots, and that is correct.** RAW it should be
4/3/2, but the sheet only prints spell sections the character actually has
spells in, and this one has only 1st-level spells. Nothing to import.
Multi-speed strings (`"40 ft. (Walking), 40 ft. (Climbing), …"`) resolve to 40.

**Still unverified: expended slots.** All five sheets have every slot unspent
(`OOOO`), so the expended-pip detection — `[●Xx✓✔■▲]` — has never once matched
real input. It is equally consistent with "this template uses a glyph we don't
list" and "this template never encodes expenditure at all", and the two can't
be told apart without a sheet exported mid-adventuring-day. Defaulting to 0
expended is the safe reading either way.

Also confirmed: `CharacterName` reading `Zoey\(Rogue\` was purely the scratch
Python extractor's regex stopping at PDF-escaped parens. With the unescape
fixed it reads `Zoey(Rogue)`, which is what the app got via pdf.js all along.
Good reminder to distrust the measuring instrument before the thing measured.

## Combat Tracker (2026-07-31)

### Removing the active combatant corrupted the initiative order

Killing a creature on its own turn and clicking ✕ — routine — left
`state.activeCombatantId` pointing at something that no longer existed. Four
removal paths, three different behaviors: `combat._remove` and
`combat._removeFromCombatById` spliced and left the id dangling, while
`party.js` had two copies that reset it to `combatants[0]`. One of those carried
the comment "advance to the next combatant" above code that jumped to index 0.

The dangling id was the damaging case, because of an accident in `_nextTurn`:

```js
let ni = state.combatants.findIndex(c => c.id === id) + 1;   // -1 + 1 === 0
```

A missing id produced index 0 — indistinguishable from a legitimate wrap except
that the round never incremented. Measured on a four-creature order with Borg
active:

| | before | correct |
|---|---|---|
| remove active Borg | no turn marker at all | Cleo |
| then Next | **Aria** — Cleo and Dax lose their turns | Dax |
| remove the last creature in the order, then Next | Aria, **round stays 3** | Aria, round 4 |
| condition hotkey with a dangling id | silently returns false | applies |

The round counter stalling is the worst of these: it is silent, and it
compounds every time the last creature in the order dies, so durations and
"rounds elapsed" drift further from the truth the longer the fight runs.

All four paths now funnel through `combat._removeCombatantAt(i)`. When the
removed creature was active its turn is over, so the turn passes to whoever now
occupies its slot; falling off the end means the round ended with it and ticks
the round properly. Removing a non-active creature leaves the turn untouched,
and emptying the list nulls the id.

Two things fell out of doing it properly:

- The round-boundary side effects (legendary/reaction refresh, buff duration
  ticks) lived inline in `_nextTurn`, so the remove-the-last-creature path would
  have skipped them all. Extracted to `_startRound(n)` and shared.
- `_prevTurn` had the mirror-image bug: `findIndex(...) - 1` on a missing id
  gives -2, which fell into the wrap branch and walked the round counter
  *backwards*. It now treats "not found" explicitly, like `_nextTurn` does.

### Buff expiry could leave a creature at negative HP

`_startRound`'s expiry path backed a `+hp` buff out of both current and max with
`Math.min(hpMax, hp - bf.hp)` and no lower bound. A creature at 5 of 20 HP when
a +10 Aid-style buff expired landed at **-5**, which renders as a live creature
with a nonsense bar rather than one that has dropped. Clamped at 0.

Verified with ten assertions covering mid-order removal, last-in-order removal
(round ticks), non-active removal (turn unmoved), removing the only combatant,
`_prevTurn` with a dangling id, an ordinary wrap still ticking exactly once, and
the buff clamp — plus real DOM clicks on the panel's ✕ and the party panel's
"remove from combat", since both had their own copy of the logic.

### _applyHpDelta — HP ran negative, and three RAW gaps behind it

`c.hp = (c.hp || 0) - damageDealt` had no lower bound. A PC at 5 of 20 who took
15 sat at **-10**, and the damage stayed invisible until someone tried to heal:

| | before | RAW |
|---|---|---|
| PC 5/20 takes 15 | hp **-10** | hp 0 |
| …then healed 10 | hp **0**, still unconscious, death saves not cleared, log reads "healed 10 HP" | hp 10, saves cleared |
| PC 5/20 takes 40 | hp **-35**, alive | dead — 35 overflow ≥ 20 max |
| downed PC hit again | **nothing happens** | +1 failed death save |
| monster 4/59 takes 30 | hp **-26** | hp 0 |

The heal case is the one that bites at the table: the cleric spends a spell, the
log says it worked, and the character stays down because the heal was eaten by a
phantom negative pool and `c.hp > 0` never became true, so the death-save state
survived. This is the same defect party.js had (fixed earlier); combat.js had its
own copy.

Clamping at 0 exposed two rules the clamp then made implementable:

**Massive damage.** PHB: reduced to 0 with damage remaining, you die instantly if
the remainder equals or exceeds your hit point maximum. The overflow is measured
*after* temp HP and the wild-shape pool take their share, which is why it is
computed at the HP write and not off the incoming delta. Verified on the
interesting case: a druid at 6/20 inside a 30 HP bear taking 45 has 30 absorbed
by the bear and 15 reach her — overflow 9, so she is downed, not dead. At 60
damage the overflow is 24 and she dies. Boundary checked both ways: 24 damage to
a 5/20 PC is 19 overflow and does *not* kill.

**Damage to a creature already at 0 costs a death save.** This did nothing, on
the stated theory that the DM was mid-roll clicking pips — which quietly made a
downed PC the safest place on the battlefield, and was inconsistent with the
branch immediately above it that already charges a stable creature a failure for
the same event. Third failure marks them dead, matching what the pip row does.

A PC with no `hpMax` can't trigger massive damage (`cap > 0` guard) — they just
go down, which is the safe reading for incomplete data.

Regression-guarded in the same run: ordinary damage, temp HP absorption (6 vs 8
temp leaves HP untouched and temp at 2), resistance still halving via the
negative-delta `Math.ceil` (21 fire → 10), immunity, revivify clearing `dead`,
repeated hits on an already-dead PC, and a real click on the panel's − button.

### The last two ways back into negative HP

Clamping the damage path left two doors open, and both were verified to
reproduce the original swallowed-heal symptom exactly.

**The HP field still accepted negatives.** `_onFieldChange`'s clamp table had
`hp: {min: -9999}` with a comment justifying it as "downed PCs can dip below 0
from massive hits" — i.e. the behavior that had just been removed. Typing -10
stuck, and an 8-point heal then left the PC at **-2**. Floored at 0. Initiative
and initBonus keep their negative ranges; only HP changed.

**Combat state saved before the clamp could already hold a negative.** The heal
path read `c.hp` directly, so such a combatant would keep absorbing heals until
someone noticed. `Math.max(0, c.hp || 0)` heals *up* from a negative rather than
through it, so any pre-existing bad value repairs itself the first time it is
touched. party.js already did this, for the same reason.

Confirmed: a legacy combatant at -26/59 healed for 8 now lands on 8, and healed
for 100 lands on 59 rather than 74.

### Duplicate monsters could share a name

`_duplicate` numbered copies as `count + 1`, which collides as soon as anything
is removed from the middle of a group: from Goblin 1/3/4, killing Goblin 2 and
duplicating again produced a **second Goblin 4**. Ids stay distinct so damage
still lands on the right creature, but the group card renders one HP row per
member labelled by name, so the DM has two identical rows and no way to tell
which is which. Now takes the lowest unused suffix, which also fills gaps left
by casualties (Goblin 1/3/4 → next copy is Goblin 2).

Verified across repeated duplication, removal from the middle, two independent
groups not interfering, and copies still starting at full HP with no inherited
conditions. Buffs are deliberately still copied — the buff's AC/HP delta is
already baked into the fields being copied, so dropping the buff without
reversing its delta would leave the duplicate permanently inflated.

### Pop-out (PiP) — three things bound to the wrong document, one zombie window

The pop-out swaps `this._body` to a node in *another document*. `_wireDelegated`
already handles that properly (a WeakSet, so each body wires exactly once and
re-wiring the restored original is a no-op). Three other places did not.

**The PC quick-ref rendered into the window the DM wasn't looking at.**
`_showPcQuickRef` was hard-bound to `document`: it built the popup with
`document.createElement`, appended to the main `document.body`, clamped against
the main `window.innerWidth/innerHeight`, and registered its dismiss listeners
on the main document. Popped out, clicking a PC name appeared to do nothing —
the card was real, just built in the main window behind the "Combat tracker is
in Picture-in-Picture" placeholder, positioned against the wrong viewport, and
unable to dismiss because the DM was clicking in a different document. Now
resolves `this._body.ownerDocument` and its `defaultView`, and sweeps stale
popups from both documents since the panel may have moved since the last one.

**`_patchHp` read the wrong document's focus.** The guard that stops a sync
overwriting an HP field mid-edit is `hpInp !== document.activeElement`. Popped
out, `document.activeElement` is the *main* window's focus and can never be the
PiP input being typed into, so the guard always passed. Verified: with "3" typed
into a popped-out HP field and a sync landing, the old code clobbered it; it now
survives, and still syncs to 40 once the field is blurred.

**`unmount()` left a zombie window.** The comment read "Close any open PiP window
when the panel unmounts", and the call passed `silent:true` — the one flag that
tells `_closePiP` *not* to close it. On a layout reset the orphan stayed open
showing a frozen tracker whose buttons still mutated and saved state, while the
repaint went nowhere because `_body` had just been nulled. Now closes for real.
The re-entrancy this introduces is safe and was checked rather than assumed:
`close()` fires `pagehide`, whose listener calls `_closePiP(true)` again, but
both fields are already null by then so it early-outs — one close, two entries,
no recursion.

**Bonus, found while reading it: the quick-ref's saves and passive Perception
were a second copy of the stale formula.** Saves showed the bare ability
modifier, so a fighter's +5 CON save read **+2**; passive Perception was
`10 + WIS mod`, so a rogue with expertise read **12 instead of 20** — the exact
defect fixed in party.js earlier, living on in the card a DM checks mid-fight.
Both now prefer the imported sheet totals, falling back to the ability modifier
only when the sheet has nothing.

Verification note: the document-routing fixes were exercised against a real
second document (an iframe), which is what a PiP window is from the code's point
of view. A live `documentPictureInPicture` window was **not** opened —
`requestWindow` requires a user gesture that can't be synthesized here. The PiP
plumbing itself (stylesheet mirroring, body swap) was not modified.

### Buffs and conditions

Conditions themselves came out clean — `_toggleCondAtIdx`, `applyCondition` and
`_removeCond` all replace the combatant immutably and all three already nudge
the party panel, which doesn't subscribe to combat changes. Nothing to fix.

**Timed buffs never expired on a PC.** Three places apply a buff's AC/HP delta.
Adding one and removing one by hand both knew that PC stats are *owned by the
party slot* — `syncPartyToCombat` overwrites the combatant's hp/hpMax/ac on
every party-side edit, so a delta written only to the combatant gets reverted
the next time anything touches the party. The timed expiry in `_startRound` did
not know that, and reversed on the combatant alone. Measured on a PC with
Bless (+2 AC, +5 HP):

| | combatant | party slot |
|---|---|---|
| after applying | AC 17, 25/25 | AC 17, 25/25 |
| after it expires | AC 15, 20/20 | **AC 17, 25/25** |
| after any party sync | **AC 17, 25/25** | AC 17, 25/25 |

So the party card kept the bonus forever and the next sync pushed it back onto
the combatant too — a duration-limited buff on a PC was permanent in practice.
Monsters were unaffected, which is why it could sit unnoticed.

All three paths now share `_applyBuffDelta(idx, buff, sign)`. It returns whether
a party slot was touched so callers repaint the party panel once rather than per
buff, and it clamps HP into `[0, newMax]` on both directions, consistent with
the negative-HP work above.

Restructuring the expiry loop exposed a latent trap worth recording: the old
code mutated `c.ac`/`c.hp` in place and assigned `c.buffs = next` at the end.
Once expiry routes through a helper that *replaces* `state.combatants[ci]`, that
trailing assignment would have written to an orphaned object. The trimmed buff
list is now written before any delta is reversed. Same stale-reference family as
the `_render()`-invalidated-DOM-node mistakes logged earlier.

**Concentration never ended when a creature went down.** RAW you lose
concentration when incapacitated or when you die, and dropping to 0 knocks you
unconscious. Nothing cleared it, so the 🌀 chip stayed lit on an unconscious
character indefinitely, and the very hit that downed them still popped a
"DC N CON save to maintain X" toast for a save that RAW never happens. Now the
spell ends at 0 HP, on both the PC (party slot) and monster paths, and the save
prompt is suppressed for that hit. Because the chip vanishing is structural and
mirrored on the party card, this case forces a real repaint instead of the
HP-only patch.

Checked that the change is narrow: a concentrating PC who survives the hit still
gets the DC prompt and keeps the spell, and a hit fully absorbed by temp HP
still prompts (RAW — damage soaked by temp HP is still damage taken) while
leaving concentration intact.

### Monster picker

**Clicking a row could add a different book's stat block.** The click handler
resolved the row with `all.find(x => x._slug === row.dataset.slug)`, and slugs
are not unique: **685 of the 4454 monster rows share a slug with another
source**, and **273 of those collisions have genuinely different stat blocks**.
`find` returns the first, so the second row of a pair was unreachable. Proved
both directions rather than asserting it — Space Hamster appears as BAM
10 HP/15 AC and WDMM 1 HP/10 AC, the old lookup resolved to BAM either way, and
rows now add 10/15 and 1/10 respectively.

Relevant to this campaign specifically: `tressym` collides between BGDIA and
**SKT**. (That pair happens to have identical stats, so it was harmless — but it
shows the collision set isn't exotic.)

Rows are now looked up by index into the pool that produced them. The source
badge was already rendered, so the two entries were always distinguishable on
screen; only the lookup was ambiguous.

**The list was silently capped at 200.** With no query that is 200 of 4454 — 4%
— and "dragon" alone matches 294. Nothing on screen admitted the cut, so a
monster that was merely off the end looked like a monster the dataset didn't
have. The modal now states it: "Showing first 200 of 294 matches — keep typing
to narrow it down", and plain "60 matches" when nothing is hidden.

**`addMonster` had the same numbering collision `_duplicate` did, and fixing
only `_duplicate` left the more common path broken.** Adding four Goblins,
removing Goblin 2, then adding another produced a second **Goblin 4** — the
group card labels its HP rows by name, so two rows became indistinguishable.
Both paths now share `_nextGroupSuffix` / `_numberFirstOfGroup`; the suffix is
the lowest unused number, which also reuses gaps left by casualties. Verified
the whole sequence across both entry points, plus that the first monster stays
unnumbered and the second retroactively renames the first.

Worth noting as a process point: the duplicate-numbering bug was fixed one
commit earlier and I did not check whether the same logic existed elsewhere. It
did, in the path a DM uses far more often. Grep for the pattern, not just the
symptom.

### Bestiary drag-and-drop — and the same slug bug in two more places

Following the drop path found the picker collision again, twice. The bestiary
saves a `source` on every monster it stores, so both of these had the
information needed to disambiguate and neither used it:

- `combat._wireBestiaryDrop` resolved the dragged monster with
  `_5eData.find(d => d._slug === m.slug)`. Dragging a saved **WDMM** Space
  Hamster (1 HP/10 AC) into combat added **BAM**'s (10 HP/15 AC).
- `bestiary._openStatBlock` did the same, so opening a saved SKT tressym's stat
  block could show the BGDIA one.
- `bestiary._openMonsterPicker` is a copy of the combat picker and carried
  *both* of its bugs — slug lookup and the silent 200-row cap.

All slug lookups now go through `sktFindMonster(slug, source)` in
`js/core/utils.js`, which prefers an exact source match and falls back to the
slug alone so saved rows predating the `source` field still resolve. The two
pickers index into the pool that rendered the row.

Verified end to end by dispatching real drop events: a saved WDMM hamster
arrives as 1/10 and a saved BAM one as 10/15; the bestiary picker's second row
saves `source: WDMM, 1hp/10ac`; and `sktFindMonster` returns the right entry for
each source, falls back rather than returning null for an unknown source, and
returns null for an unknown or empty slug.

Two smaller things in the drop handler itself:

- **The drop highlight could stick on.** `dragleave` only cleared it when
  `e.target === b`, but leaving the panel from over a card — most of its area —
  fires `dragleave` on the card. Now tests `!b.contains(e.relatedTarget)`,
  which is what "actually left" means.
- **A malformed party payload crashed.** `parseInt('garbage')` reached
  `_addPartyToCombat` as NaN, where `state.party[NaN]` is undefined and the next
  line reads `p.id`. Guarded; verified the drop is now a silent no-op.

**Not fixed, noted:** `_wireBestiaryDrop` is only called from `mount()`, so the
popped-out tracker is not a drop target. Adding the call is a one-liner, but
cross-window HTML5 drag with custom MIME types can't be exercised here, and I
would rather not ship behavior I can't verify.

This is the third distinct copy of the "look it up by slug" mistake and the
second copy of the 200-row cap. The pattern, not the symptom — as noted one
section above, and evidently worth repeating.

## Battle map — undo/redo (2026-07-31)

The undo system is snapshot-based and deliberately covers content only —
tokens, fog, fog strokes, drawings — on the stated grounds that "Ctrl+Z
silently swapping the map back would be a worse surprise than not undoing".
That reasoning is right, but excluding the map from the *snapshot* without also
clearing the *history* on a map change produced a worse surprise than either.

**One Ctrl+Z after switching maps pasted the previous map's content onto the new
one.** Measured: map A with two tokens, one stroke and two fog cells → switch to
map B → press undo once → the stroke and both fog cells reappear, on a map whose
grid dimensions they were never keyed to. `_resetUndoBaseline` existed and was
wired for *remote* changes only; the three local swap paths and
`_restoreMapSnapshot` never called it.

The reset now lives at the end of `_resetMapScene`, which its own comment
already nominates as the choke point — "Called by every map-swap path … so the
bug doesn't reappear when a fourth call site is added later". Putting it there
also makes the swap itself non-undoable for free: the `_saveMap()` that follows
finds a baseline equal to the state it is about to write, so `_captureUndo`
pushes nothing. `_restoreMapSnapshot` doesn't route through `_resetMapScene`, so
it gets its own call.

Worth noting what is deliberately *not* changed: tokens still carry across a map
swap (the party follows you to the next map) while drawings and fog do not.
Verified that still holds.

**`_undoRedo` could corrupt its own stacks.** It popped `from` and pushed `to`
before attempting the restore, then bailed on a parse failure — discarding the
target step and leaving a bogus entry on the opposite stack, with
`_updateUndoButtons` skipped so the buttons lied about it too. The stacks now
move only after the restore lands. Verified by planting malformed JSON in the
stack: both stacks and the scene come through unchanged.

Twelve assertions: swap isolation both directions, ordinary undo/redo within a
map across two edit types, redo branch invalidation on a new action, snapshot
restore, and the corrupt-entry case.

Everything else in this area held up. `_startUndoKeys` guards against
double-binding and against stealing Ctrl+Z from text inputs and unfocused
windows; `unmount` removes the handler along with the resize observer, the
document mouseup, the queued rAF and the requality timer. No leaks found.

### Fog of war — the two-way brush ignored the order you painted in

`_drawFog` rendered free-brush strokes in two passes grouped **by operation**:
every `reveal`, then every `hide`. The strokes array is chronological and each
entry carries its op, so that grouping threw away the only thing that makes a
two-way brush behave.

Measured on the real renderer by sampling the fog canvas: **reveal → hide →
re-reveal** over one spot left alpha at **140** (fogged) instead of 0. The
re-reveal was drawn first and the hide painted over it, so an area hidden with
the free brush could never be revealed again — the reveal brush simply looked
broken there.

The same probe exposed a second defect. `reveal→hide→reveal` and
`hide→reveal→hide` returned **140 vs 203**, because hides repainted at 0.55 over
whatever was already there: 0.55, then 0.80, then 0.91. Brushing back and forth
drove the DM's see-through fog toward opaque, even though the code comment said
it repainted "at the same opacity as the base layer".

Both come from compositing at display opacity while painting. Fog coverage is
now built as an **opaque binary mask** on a cached scratch layer — chronological
order, `destination-out` for reveal and `source-over` for hide — then stamped
once at 0.55 (DM) or 1.0 (player). Order is preserved and fog is exactly one
opacity everywhere it exists, however many times it has been brushed. The
scratch canvas is cached and resized on the same terms as `_sizeLayer`, since
this runs on every fog-paint mousemove.

**A mistake worth recording, because the first round of tests passed it.** The
cached mask context keeps its `globalCompositeOperation` between calls, and the
loops leave it on `destination-out`. Without an explicit reset, the *next*
repaint's base fill runs as an erase — the map comes back almost entirely
unfogged, showing fog only where a hide stroke happened to land. A single
`_drawFog()` call renders perfectly, so a one-shot probe says everything is
fine; it only appears from the second repaint onward, which in practice is
every real frame. Caught by asserting on points *outside* the brushed area
rather than only on the spot under test — three "untouched" samples read 0 when
they should have read 140, and chasing that discrepancy instead of dismissing it
found a regression that would have blanked fog across the table.

21 assertions: ordering both directions, non-compounding across four stacked
hides, cell reveals, a hide re-covering a cell, circle vs square brushes,
player-view opacity, stability across repeated repaints, mask reuse, and fog
disabled.

Also verified while in here: `_drawFog` passes the full stage size to
`_sizeLayer`, which clips to `_visibleStageRect` internally — so fog already
inherits the viewport-sizing work from earlier this session and does not
allocate a full-map backing store at high zoom.

### Tokens

**Syncing the party still dumped everyone in the top-left corner.** Earlier this
session the one-at-a-time "add party member" button was changed to drop tokens
where the DM is looking, spiralling out via `_viewCenterStage` + `_freeCellNear`,
because placing them at the corner meant hunting each one down and dragging it
back. `_syncParty` — the "↺ Sync tokens from Combat tracker" / load-initiative
path, which is how you place the *whole party at once* — was not changed, and
kept laying them along a virtual top row. So the fix covered the path that
places one token and missed the path that places five.

That is the fourth time this session a fix landed on one call site while a
sibling kept the old behavior (duplicate numbering → `addMonster`; slug lookup →
three more sites; and now my own token-placement fix). The pattern is always the
same: the symptom is found in one function, fixed there, and never grepped for.

`_syncParty` now uses the same centre-and-spiral placement. Verified with the
view centre stubbed to a known point: all five land within two cells of it, none
on the same square, none near the corner; a member added later goes to the
*current* view centre rather than the old one; and with the view unmeasurable it
falls back to the middle of the map.

**Players couldn't see monsters standing on free-brush-revealed ground.** The
renderer decided token visibility with its own inline lookup,
`_fog.has(floor(x/cs) + ',' + floor(y/cs))`, which was wrong in two ways:

- It ignored `_fogStrokes` entirely. A DM who reveals a room with the *free*
  brush — a supported, first-class mode — showed the players the room and
  nothing standing in it. In the other direction a free-brush HIDE over a
  cell-revealed square left the token on screen, which leaks rather than hides.
- It dropped the Align-tool grid offset that `fogPaint` applies when building
  the same key, so on any map whose grid has been aligned the lookup was a cell
  off.

Both now go through `_isFogged(px, py)`, which mirrors `_drawFog`'s composition
exactly: start fogged, cells in `_fog` reveal, then strokes apply in painted
order with the last one covering the point winning. 13 assertions on the
predicate (fog disabled, cells, free reveal, free hide over a cell, both
chronological orders, circle radius, aligned-grid offset both sides) plus 6 on
the renderer in a real player-mode DOM (DM sees all; players see only the PC
when fogged; free-brush reveal exposes the orc; cell reveal exposes the troll; a
later hide re-conceals; fog off shows everything).

Noted, not changed: a token's `dead` flag is seeded from combatant HP when the
token is created and thereafter only toggled by hand in the token panel, so it
drifts once someone drops in combat. Auto-syncing it is a behavior change rather
than a fix, and the DM has an explicit toggle.

### Saved / starred maps

Mostly a negative result, which is worth recording as clearly as a bug.
`_snapshotMap` ↔ `_restoreMapSnapshot` round-trips **cleanly**: 18 assertions
over every field the snapshot claims to carry — path, world scale, rotation,
Align offsets, cell size, cols/rows, bg colour, grid type, cell highlight, snap,
all three fog modes, hardness/opacity/width, tokens (including size and facing),
fog cells, fog strokes and drawings — plus two that confirm the snapshot is a
deep copy rather than an alias, and one that `fog: null` (disabled) survives as
disabled instead of collapsing to an empty set. Starred maps also behave: Set
semantics, correct persistence, no duplicates, corrupt JSON caught by mount's
guard, and an empty section rendering nothing.

Two real problems, both in the save path, both about destroying data quietly.

**Re-saving under an existing name overwrote it silently.** The name field is
pre-filled from the map's own filename, so saving the same map twice collides
*by default* — that is the normal case, not an edge case. The delete button asks
before destroying a saved map; overwrite, which destroys one just as completely
and with no undo, did not. It now confirms, naming the entry it would replace.

**The 40-entry cap dropped the oldest saves in silence.** New entries `unshift`
to the front and the list is then truncated, so a full library quietly eats the
oldest map every time you save. The toast now names what went:
`Saved "Number Fortyone" · library full, dropped oldest: Old 39`.

14 assertions on the save path: first save, collision prompting, declining
leaving the original untouched, accepting replacing in place without adding a
row, a fresh name never prompting, and the cap keeping the newest, dropping the
oldest, and reporting it.

Noted, not changed: loading a saved map replaces the current scene with no
confirmation, and since the undo history is now correctly cleared on a scene
change (see the undo section above), that is irreversible. Loading from a picker
conventionally replaces, and prompting every time would be tiresome — but it is
the one remaining unguarded way to lose unsaved tokens and fog, so it is the
user's call whether it should ask when the current scene has content.

### Stroke erase

The geometry is sound — `_distToSegment` is a correct point-to-segment
distance with the parameter clamped to [0,1], the segment walk indexes
correctly for pair-packed points, single-point dots have their own branch, and
both call sites (mouse and touch) drag-erase and then `_saveMap()` once on
release rather than per move. Nothing wrong there.

**The grab radius was in the wrong unit.** The comment promised "a floor of 8
screen-pixels regardless of zoom"; the arithmetic used a bare `8`, and `x`/`y`
arrive from `_stagePoint` in **stage** pixels. So the on-screen slop scaled with
the view instead of resisting it:

| view scale | on-screen grab radius, thin line | |
|---|---|---|
| 0.25 | **2 px** | unusable |
| 0.4  | **3 px** | pixel-hunting |
| 1.0  | 8 px | as intended |
| 2.5  | **20 px** | grabs lines you aren't pointing at |
| 6.0 (touch cap) | **48 px** | erases most of the screen |

Measured both directions. Zoomed out to 0.4, a pointer 7 screen px from a line
sat 17.5 stage px away against an 8-stage-px radius and **missed**; it now hits.
Zoomed in to 2.5, a pointer 15 screen px away sat 6 stage px out, inside the old
20-screen-px radius, and **erased a line the cursor wasn't near**; it now
correctly leaves it alone.

Dividing the affordance by `_screenScale()` — which is the same stage→screen
factor `_stagePoint` divides by, so the two agree by construction — makes the
grab zone `max(8, strokeHalfWidthOnScreen + 6)` screen px. The stroke's own
half-width deliberately stays in world units: a thick line really is thicker on
the map, so it keeps a proportionally larger target, which is why the effective
radius is 11 px at 2.5× rather than a flat 8.

This was listed in the per-device-zoom plan as an optional one-liner alongside
the token-label floors, and was the item from that list that never got done. The
label floors were counter-scaled at the time; this wasn't.

12 assertions: erasing at a constant 7 screen px offset across 0.4/1/2.5, not
erasing at 30 screen px across the same, thick strokes still grabbed at their
edge while thin ones there are not, topmost overlapping stroke removed and only
one per call, single-point dots, and empty/null point arrays ignored.

## Notes (2026-07-31)

### Ctrl+Z did nothing while writing a note

The editor bound Ctrl+Z to `e.preventDefault(); this._undo()`, where `_undo`
read a hand-rolled per-file stack. That stack was pushed from exactly three
places — the Ctrl+B handler, the Ctrl+I handler, and the toolbar insert — and
from nowhere else. **Typing never pushed anything.** So in a textarea full of
typed prose the stack was empty, `_undo` returned silently, and the browser's
own undo had already been suppressed by the `preventDefault`. Ctrl+Z in a note
was a no-op, and the working native undo was actively disabled to make it so.

The reason a hand-rolled stack existed at all is the real defect underneath:
`_insert` mutated the textarea with `ta.value = …`, and a direct value
assignment **destroys** the native undo history. Verified rather than assumed —
type into a textarea, assign `.value`, then `execCommand('undo')`: the call
returns `true` and the assigned text stays, because there is no history left to
walk. So bold/italic wiped the history, the hand-rolled stack was written to
paper over that, and the patch only ever covered the actions that caused the
problem, never the typing in between.

Fixed at the cause. Every programmatic edit — bold, italic, headings, bullets,
quote, code, code fence, the 3×3 table template, and the Tab key — now goes
through `document.execCommand('insertText')`, which the browser records in its
own undo stack (verified: insert, undo, redo all round-trip). With that true,
the Ctrl+Z/Ctrl+Shift+Z interception is simply removed and native undo covers
typing and toolbar inserts uniformly. `execCommand` is deprecated but has no
standard replacement for undoable programmatic text insertion; each call keeps
a value-assignment fallback so an engine that refuses only loses that one undo
step rather than the edit.

The toolbar's undo/redo buttons now drive `document.execCommand('undo'/'redo')`
while the editor is open. With the stacks gone they have nothing to fall back
on when it is closed, which matches reality — undo history belongs to the
textarea, and the previous "operates on saved content" path could only ever
have fired if a stack survived from an earlier edit session in the same page
load.

`_pushUndo`, `_undo`, `_redo`, `_undoStacks` and `_redoStacks` are deleted
rather than left dormant. A dead parallel undo sitting next to a working native
one is precisely the trap that produced this bug; 64 lines removed, 52 added.

18 assertions against the real editor: typing undone and redone, bold undone
and the history continuing *past* it into the typing before, h2, table,
codeblock and Tab each reversed, and blur still committing to the file with the
editing flag cleared.

### Notes folder tree

The drag-and-drop reparenting is sound. `_isDescendant` is called before every
move and correctly rejects both dropping a folder *into* its own descendant and
dropping it *between* rows inside its own subtree (the second case would set
`from.parent` to something in `from`'s subtree, which is the same cycle by
another route). `_reorderSiblings` re-numbers correctly after the caller has
already reparented, and `_deletePrompt` BFS-cascades children, reassigns the
selection, and captures the Dropbox path before mutating. Field naming is
consistent — `.parent` throughout, no stray `.parentId`.

Three things were wrong.

**A note whose parent no longer exists became invisible and unreachable.**
`_buildTree` buckets by `it.parent`, `_renderTree` only ever walks down from
`__root__`, so an item pointing at a deleted id lands in a bucket nobody
visits. It stays in `items[]`, keeps being saved, keeps being synced, and
cannot be seen or opened. Measured: a note holding real content next to a
normal folder rendered as `Keep, Visible.md` — the third note simply absent.
Local deletes cascade so they can't cause this, but sync can: delete a folder
on one device while another adds a note inside it, and the merge leaves that
note pointing at something gone. Dangling parents now surface at the root.

**A parent cycle hung the tab.** `_isDescendant` walks up the chain with no
loop guard. The first probe returned instantly and looked fine — but only
because the ancestor being tested *was* in the cycle, so the early
`cur.parent === ancestorId` exit fired. Asking about an ancestor outside the
loop never terminates: 50 000 lookups and still going. The drop handler can't
create a cycle (this function is what prevents it), but the same concurrent-sync
merge can — two devices moving A into B and B into A. Now guarded by a visited
set, and `_buildTree` surfaces cycle members at the root too rather than
leaving them in an unreachable bucket.

That near-miss is worth recording on its own: the first cycle test *passed* and
would have gone in the notes as "cycles are safe". It only failed once the test
was built so the early-exit couldn't fire. A guard test has to be constructed
against the code path it's guarding, not against the happy accident next to it.

**The delete prompt didn't say what it was destroying.** "Delete Folder and ALL
its contents?" read identically for an empty folder and for one holding forty
sessions of notes — on an action with no undo, since the tree has no history
and only file *content* does. It now counts the cascade:
`Delete Folder and 3 notes and 1 subfolder?`, or `Delete Empty folder?` when
there is nothing inside. Files are unchanged.

11 assertions: orphan recovery, cycle members still reachable, `_isDescendant`
terminating on a cycle while still correctly identifying real
descendants/non-descendants/self, normal nesting still bucketing normally
(not flattened by the new guard), and all three delete-prompt wordings.

### Dropbox sync had no conflict detection at all

The vault adapter (`notes-sync.js`) reconciles properly: it keeps a
last-known-good hash per file and compares three signals — disk changed, app
changed, disk newer — so a two-sided edit is queued for the user instead of one
side being picked silently. `dropbox-sync.js` had none of that. It uploaded
with `mode: 'overwrite'` and, on the download side, did this:

```js
const text = await _download(path);
if (text != null) item.content = text;
```

Unconditional. If the remote rev had moved, the local copy was replaced —
whether or not this device had edits of its own that hadn't been pushed yet.
That window is not small: the push is debounced 800 ms, and a *failed* upload
leaves the edit unsent indefinitely (the code warns, but never retries). Both
download paths had it, including the incremental cursor poll, which is the one
that runs every tick and so is the one that actually ate work.

Dropbox now keeps `_state.fileHashes` — the content hash as of the last time
this device and Dropbox agreed — written at both moments they agree: after a
successful upload and after a successful download. On a rev change it compares
the local content against that baseline:

| baseline vs local | remote vs local | outcome |
|---|---|---|
| unchanged | differs | take remote |
| changed | same text | take remote (both made the same edit) |
| changed | differs | **conflict — neither side written** |
| no baseline recorded | — | take remote (nothing local to protect) |

The conflict is queued in the same shape the vault uses and the adapter exposes
`onConflict` / `getConflicts` / `resolveConflict` with identical signatures and
the same `'app' | 'disk' | 'manual'` vocabulary. The resolver UI in the notes
panel was already adapter-agnostic in everything but its wiring — it subscribed
only to `notesSync` and called `notesSync.resolveConflict` directly, so a
Dropbox conflict had nowhere to appear and no way to be resolved. It now
subscribes to Dropbox too and routes resolution through `_activeSync()`.

Three details that would each have re-broken it:

- `resolveConflict` records the baseline hash from the *same string* it
  uploads. Skip that and the next poll re-raises the conflict just resolved.
- `pushFile` records the hash on upload. Skip that and every pushed edit reads
  as a local change on the next poll — a conflict against our own write.
- `movePath` re-keys hashes alongside revs, including the `oldPrefix/…` sweep
  for folder moves. Left behind, the new path has a rev but no hash, which
  reads as "never agreed" and silently disables detection for that file.

Verified against the real code path with `window.fetch` fully stubbed — no
request could reach Dropbox, and the endpoints hit are listed in the test output
as proof (`/oauth2/token`, `/2/files/list_folder`, `/2/files/download`,
`/2/files/upload`). 12 assertions across a four-round sequence: first pull
establishes the baseline; a remote-only change applies cleanly; a two-sided
change leaves the local edit intact and queues a conflict carrying both
versions; resolving to the app version writes it back and clears the queue; and
a following poll does not re-raise it. Plus 6 on the decision table itself and 6
on the exposed surface matching the vault's.

**Note:** that test wrote a fixture note and a fake path/cursor into the live
`skt-notes-v2` and `skt-dropbox-sync-v1` keys. Both were cleaned afterwards —
the fixture note removed, the fake rev/hash entries deleted, and the cursor
nulled so the next real sync does a full list rather than trusting a cursor a
stub minted.

## Attack Runner (new panel, 2026-07-31)

Collapses the per-attack ritual — read the stat block, work out the type, click
the damage-type chip, type a number, find the card, click minus — down to two
clicks: **Avg** or **🎲 Roll** on the attack, then the target. The damage type
comes from the stat block, so resistances and immunities resolve without anyone
selecting anything. That last part is also where the old flow quietly went
wrong: the type chip keeps whatever it was set to last, so a DM in a hurry
applies fire damage as slashing and never sees it.

**Multi-type attacks apply as separate typed hits.** An Adult Red Dragon's bite
is 2d10+8 piercing *plus* 2d6 fire, and a fire-resistant target must halve only
the fire. Measured against a 19+7 bite: plain PC takes 26, fire-resistant takes
**22** (19 + 3), piercing-resistant takes **16** (9 + 7), fire-immune takes
**19**. Collapsing it into one number would be wrong in a way nobody notices.

Save-based attacks get **Failed** / **Saved ½** buttons. The halving happens
before resistance and rounds down at each step, per RAW: a 63-damage breath is
63 failed, 31 saved, and 15 saved-and-fire-resistant.

### The parser is the load-bearing part

5etools monster actions are English prose, not structured damage. Everything
needed is in there; it has to be read out of a sentence. Grammars handled:

- 2014 attacks — `+14 to hit … Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage`
- 2024 attacks — `Melee Attack Roll: +7, … Hit: …`
- 2014 saves — `DC 21 Dexterity saving throw, taking 63 (18d6) fire damage … half as much`
- 2024 saves — `dex DC 11, … 7 (2d6) Fire damage.  Half damage.`
- versatile — `, or 6 (1d10+1) slashing damage if used with two hands` is an
  **alternative**, offered separately, not added. The PDF importer made exactly
  this mistake once already.
- riders — the Fire Elemental sets its target alight for `5 (1d10) fire damage`
  a sentence after the hit; a global scan would bill that as part of the strike.

Coverage: **7871 of 8122** damage-bearing actions parse (97%). The first pass
scored 7065 — the shortfall was two grammars I had written off after checking
only monster-level coverage instead of action-level, which made a 13% gap look
like 4%. The remaining 251 are genuinely ambiguous prose (grapple-then-ongoing
damage, damage dealt to a *ship*, "takes the bite's damage") and are left
unparsed on purpose: inventing attacks that don't exist is worse than omitting
ones that do.

Two supporting changes: `addMonster` now records `_slug`/`_source` on the
combatant, and `combat.statBlockFor()` resolves by slug+source before falling
back to the name — otherwise the panel would re-introduce the same-name
ambiguity fixed earlier. `_openBestiaryDetail` and `_applyHpDelta`'s facet
fallback share it.

Also: monsters whose block says their strikes are magical are detected and set
the attack property accordingly, so a target resistant to *nonmagical* damage
correctly does not halve them. Verified both directions through the UI — a
Couatl's magical bite ignores "piercing from nonmagical attacks" and lands 8
while a Werewolf's ordinary bite against the same target is halved to 3.

Verification: 11 parser assertions, 13 on damage application, 14 through the
rendered DOM (real clicks on Avg/Roll/target/cancel/collapse, dock button opens
the panel). Two test expectations were wrong rather than the code — a Werewolf
biting a Werewolf deals 0 because both are immune to nonmagical piercing, which
is right; and I reused a DOM node captured before a re-render, for the fourth
time this session.

### Rage

Reviewed after the fact — rage had been read from (combat's damage handler
honours its B/P/S resistance) but never reviewed on the party side. The
resistance itself is correct. Three things around it were not, and all three
were promised by text already on screen.

**A short rest didn't end it.** Rage lasts one minute; a short rest is an hour.
Only `_applyLongRest` cleared it, and the long rest's own comment says "Rage /
Wild Shape: both end at any rest" — true of one of the two rests. Wild shape had
the same gap and is fixed alongside.

**Entering a rage didn't drop concentration.** PHB is explicit — "you can't cast
spells or concentrate on them while raging" — and the rage pill's tooltip has
always said so. It never happened, so a raging barbarian kept a lit 🌀 chip and
the tracker went on prompting concentration saves for a spell that RAW had
already ended. Note this is the *opposite* of wild shape, where Sage Advice says
concentration survives; the two read alike and behave differently, which is
presumably how one got the other's treatment. Ending a rage correctly leaves
concentration alone — only entering one breaks it.

**Rage didn't end on falling unconscious.** The consequence is worse than a
stale chip: the B/P/S resistance kept halving hits on a downed barbarian, at the
one moment a creature is least able to shrug anything off. Fixed in both damage
paths — the party tracker's and the combat tracker's — since either can drop a
PC to 0.

There were also two independent rage toggles, the pill and the context-menu
item, which had already drifted. Both now go through `_setRage`.

13 assertions: both rests, concentration dropped on entering and preserved on
ending, 0 HP through each damage path, the resistance halving correctly while up
and not after going down, and a non-barbarian unaffected.

Deliberately **not** added, as they change behaviour rather than fix it:
duration tracking (rage is 10 rounds and nothing counts them) and a per-long-rest
rage-use counter. The generic `resources` list already lets a DM track "Rages"
by hand, and auto-creating one would collide with anybody who has.
