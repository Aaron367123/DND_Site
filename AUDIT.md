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

- [x] **Firebase echo suppression breaks under rapid edits** — `js/realtime.js:126`
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
- [x] ~~**Dropbox 429 retry recurses without retry cap**~~ — `js/dropbox-sync.js:160` *(fixed)*
  - The 429 branch waited `Retry-After` then unconditionally `return _api(endpoint, body)` — a sustained rate-limit recursed forever, never surfacing the failure and pinning a background loop on the 429 wall.
  - **Fix applied:** Threaded an internal `_attempt` counter through `_api`. After 4 retries it sets `_connectError`, toasts "Dropbox is rate-limiting — sync paused", and throws. Backoff now honors `Retry-After` or falls back to exponential (`5·2^n`) capped at 60s.
- [x] ~~**File System Access permission silently expires after reload — UI shows "connected" but vault never syncs**~~ — `js/notes-sync.js:199` *(fixed)*
  - `init()` restored the handle from IndexedDB so `isConnected()` returned true and the pill showed 📂 connected, but FSA grants reset to `'prompt'` on reload. Every poll-driven `fullSync` called `_ensurePermission()` → `requestPermission()` with no user gesture, which never opens a dialog, so the vault silently never synced.
  - **Fix applied:** Added a `_needsPermission` flag — `init()` now `queryPermission()`s the restored handle and flags a lapsed grant; `getStatus()` surfaces it; `_ensurePermission()` updates+emits it on every transition. New public `requestAccess()` re-requests inside a user gesture. `notes.js` renders a pulsing amber "🔓 Grant vault access" pill that calls `requestAccess()` then `fullSync` on click.

### Data loader
- [x] ~~**Subclass fluff lookup keyed by display name never matches — all subclass cards fall through to mechanical text**~~ — `js/data-loader.js:1052` *(fixed)*
  - The bucket was keyed `"alchemist (artificer)|tce"` (display name), but `addRef` → `_applyFluff('class', d.name, d.source)` looks up the BARE `"alchemist|tce"`. Confirmed against real data: both `subclass.name` and `subclassFluff.name` are the bare `"Alchemist"`. The key mismatch meant fluff never applied and every subclass fell back to concatenated feature text.
  - **Fix applied:** Key the subclass-fluff bucket by bare `name|source` (matching `_applyFluff`), and additionally store the `"Name (ClassName)|source"` display variant for any consumer keying by the disambiguated name.
- [x] ~~**`_convertSpell` drops all but the first `entriesHigherLevel` block**~~ — `js/data-loader.js:449` *(fixed)*
  - `[_parseEntries(d.entriesHigherLevel[0]?.entries||…)]` only ever kept block [0]. Spells with multiple higher-level blocks (e.g. a "Cantrip Upgrade" block + an upcast block) silently lost the rest.
  - **Fix applied:** Map every block to its own parsed string (renderer joins with blank lines), prefixing a non-generic block name when present so multi-block spells read correctly.
- [x] ~~**`_findItemEntry` no source-omitted fallback — literal `{#itemEntry …}` leaks into descriptions**~~ — `js/data-loader.js:475` *(fixed)*
  - Lookup was exact `name|source` only; a ref that omitted the source (or named a source differing from where the template lives) missed and the literal `{#itemEntry …}` token rendered in the description.
  - **Fix applied:** Added a parallel `_ITEM_ENTRY_BY_NAME` index (first template wins) populated alongside `_ITEM_ENTRY_BY_KEY`; `_findItemEntry` now falls back to the name-only match when the exact key misses.
- [x] ~~**`expandMagicVariants` is O(variants × baseItems), ~100k calls per cold load**~~ — `js/data-loader.js:807` *(fixed)*
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
- [x] ~~**Document-level Escape keydown leaks per crop modal**~~ — `js/utils.js:177` *(fixed)*
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
- [x] ~~**Runtime-only settings keys not in `DEFAULT_SETTINGS`**~~ — `js/data.js:51` *(fixed)*
  - Found all 7 missing: `partyCompact`, `partyCardWidth`, `lootEncumbrance`, `monsterStatsMode`, `combatHpBar`, `combatCompact`, `combatGroupSimilar`. Added each with the default that matches its current undefined-fallback so behavior is unchanged (`combatHpBar:true` since it's read as `!== false`; `monsterStatsMode:'show'`; `partyCardWidth:null`; the rest `false`). Now they reset on "reset to defaults" and round-trip through export/import.
- [x] ~~**`syncPartyToCombat` only mirrors `hp/hpMax/ac` — name renames go stale on combat card**~~ — `js/window-manager.js:336` *(fixed)*
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
- [x] ~~**Folder rename on Dropbox leaves descendant file revs keyed under old path**~~ — `js/dropbox-sync.js` *(fixed)* — `movePath` now re-keys every `oldPath/…` descendant rev to `newPath/…` after the server-side move.
- [x] ~~**`_resolveCopy` deep-clones every monster via `JSON.parse(JSON.stringify)`**~~ — `js/data-loader.js` *(fixed)* — added a `_deepClone` helper using `structuredClone` (markedly faster for these large objects; semantically equivalent for pure-JSON data) with a JSON fallback.
- [x] ~~**`_isReprintEntry` key not trimmed while reprint targets are**~~ — `js/data-loader.js` *(fixed)* — both name and source are now trimmed before the lookup, matching how the target keys are built.
- [x] ~~**Dead share-button DOM lookup in `realtime.js` shared-panels handler**~~ — `js/realtime.js` *(fixed)* — removed the dead `[data-wact="share"]` loop; share state now lives in the window ⋯ menu which reads it live.
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

*Generated by codebase audit workflow. Findings have already been adversarially verified — false positives were stripped before this list was written. When fixing an item, mark its checkbox and (optionally) annotate with the date and commit hash so future audits can skip it.*
