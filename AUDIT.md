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

## Live QA findings (browser walkthrough)

Found while play-testing the site against the static preview server.

- [x] ~~**Fog of war ignores the grid alignment offset — revealed cells render shifted off the squares**~~ — `js/panels/battlemap.js` *(fixed + pixel-verified)*
  - `_drawGrid` offsets its lines by `((gridOffset*scale)%cs+cs)%cs`, but `fogPaint` hit-tested with `floor(x/cs)` and `_drawFog` rendered at `gx*cs` — both ignoring the offset. So once the two-click **Align** tool set a non-zero offset (which it always does for a real-world grid), every revealed cell sat shifted from the drawn square by the offset.
  - **Fix applied:** both `fogPaint` (subtract `offX/offY` before flooring) and `_drawFog` (add `offX/offY` when filling) now use the exact same offset formula as `_drawGrid`. Verified in the live preview against a real aligned map (offset 15.5/7.83px img → 26.25/13.27px screen, cell 65.76px): the revealed cell's canvas hole measured `619–682px`, matching the grid square at `618–684px` (was rendering at the `~592px` origin). Existing fog repaints onto the correct squares; no migration needed.
  - *Note:* free-mode (pixel) brush strokes are intentionally left origin-relative — they're freeform, not cell-snapped.

---

## Second-pass review (2026-07-02)

Fresh multi-agent review after the original 70 were closed. Agent findings were adversarially spot-checked before fixing — several claims did NOT survive verification (showModal listeners don't leak: they're element-scoped and die with `backdrop.remove()`; NPC bulk delete DOES confirm first) and were discarded. Everything below was verified in code and, where observable, in the live preview.

- [x] ~~**Rename/move deleted the vault file before writing the new one — data loss if the write fails**~~ — `js/notes-sync.js:449` *(fixed)*
  - `pushFile` did `_deleteFile(oldPath)` then `_writeFile(newPath)`. A failed write (permission revoked, disk full) left no copy on disk at all.
  - **Fix applied:** write-new-first, delete-old only after success; a failed delete of the stale copy is tolerated (recoverable — the new path is canonical).

- [x] ~~**Battlemap leaked one `document` mouseup listener per render**~~ — `js/panels/battlemap.js` (`_setupMap`) *(fixed)*
  - Anonymous handler attached in `_setupMap()` (runs on every `_render()`), never removed. **Fix:** stored on `this._docMouseUp`, swapped on re-render, removed in `unmount()`.

- [x] ~~**Escape didn't close the bestiary/combat monster pickers or utils modals reliably**~~ — `js/panels/bestiary.js`, `js/panels/combat.js`, `js/utils.js` *(fixed + verified in preview)*
  - Keydown was attached to the non-focusable backdrop div (the exact bug already fixed in bestiary's template modal). **Fix:** document-level keydown, removed in `close()`, applied to all four modals (`showModal`, `showConfirm`, both pickers).

- [x] ~~**XSS via NPC notes — raw HTML from shared sync rendered into innerHTML**~~ — `js/panels/npc-library.js:534` *(fixed)*
  - `${n.notes||''}` unescaped while the `secret` field beside it used `esc()`. Notes sync through the shared Dropbox account + Firebase, so any player could inject HTML that executes on the DM's screen. Notes is legit rich text, so it can't just be escaped.
  - **Fix applied:** new `sanitizeHtml()` in utils.js (template-parse, strip script/style/iframe/etc., `on*` attributes, `javascript:`/`data:` URLs) applied at render. Verified: `<script>`, `onerror`, and `javascript:` payloads stripped; formatting tags kept.

- [x] ~~**Sync failures were silent (quota, upload, realtime give-up)**~~ — `js/dropbox-sync.js`, `js/realtime.js`, `js/panels/bestiary.js` *(fixed)*
  - `localStorage.setItem` quota failures in both fullSync/poll paths, upload failures in `pushFile` (whose "next tick retries indirectly" comment was wrong — nothing retried once the rev was recorded), realtime giving up after 4 retries with only `console.error`, and bestiary `_save()` with a bare `catch{}` — all now surface a toast. Dropbox toasts throttle to once/min per kind (`_warnSync`) so the poll loop can't spam.

- [x] ~~**Combat + party re-attached every card's listeners on every render**~~ — `js/panels/combat.js`, `js/panels/party.js` *(refactored + verified in preview)*
  - The `[data-act]` dispatch, damage inputs, combatant field edits, and quick-pick dropdowns are now delegated: one click/change/mousedown listener attached ONCE in `mount()` on the panel body (which survives `_render()` — innerHTML only swaps children). Party's dispatch is merged with the icon-picker outside-click closer so action clicks still never close a just-opened picker (matches the old stopPropagation semantics). Verified: sheet tabs, next/prev turn, icon picker open/outside-close, damage strip all behave identically.

- [x] ~~**Battlemap settings tiles forced a full stage re-render**~~ — `js/panels/battlemap.js` (`_wireSettingsSidebar`) *(fixed + verified: `#map-stage` node survives toggles)*
  - Fog reveal/hide swap, brush mode/shape, grid square/hex/none, cell highlight, and token visibility now update surgically: sidebar re-renders in place (`_refreshSettings()`), grid changes redraw only the canvas (same lightweight path the remote-update handler already used), token visibility toggles classes on `#map-stage`. `_saveMap()` still broadcasts, so players stay in sync. Turning the fog TOOL on still full-renders (top toolbar changes).

- [x] ~~**Monster/encounter search rebuilt a 200-row list per keystroke**~~ — `js/panels/combat.js`, `js/panels/bestiary.js`, `js/panels/encounter.js` *(fixed: 150ms debounce, verified in preview)*

- [x] ~~**`_renderTokens` appended 3 nodes per token individually**~~ — `js/panels/battlemap.js` *(fixed: all nodes batched through one DocumentFragment append)*

- [x] ~~**Realtime retry backoff had no jitter; give-up was silent**~~ — `js/realtime.js` *(fixed: +0–300ms random jitter so multi-tab sessions don't retry in lockstep; toast on final give-up)*

**Noted, intentionally not changed:** the Dropbox refresh token in `js/dropbox-config.js` is committed by documented design (shared single account, app-folder scope, no per-user login). Residual risk: anyone with repo access can wipe the campaign folder — the revoke link in that file's comments is the kill switch. Worth confirming Firebase RTDB rules are scoped equally tightly.

---

## Mobile sync + eraser fixes (2026-07-26)

User report: "battle grid isn't syncing at times, on mobile the map doesn't update at all, eraser doesn't work." Three root causes found and fixed:

- [x] ~~**Draw / erase / fog / align / hover ignored the workspace zoom**~~ — `js/panels/battlemap.js` *(fixed + verified at 50% zoom)*
  - Every screen→canvas conversion (`clientX - rect.left`) skipped dividing by `getZoom()` — only the token drag did it right. At any workspace zoom ≠ 1 (i.e. nearly always on mobile) the eraser hit-tested the wrong spot, strokes drew offset, and fog painted the wrong cells.
  - **Fix applied:** zoom division added to draw + erase (mouse and touch), fogPaint, canvas click (align/token placement), hover-cell tracking, and the wheel-zoom cursor anchor. Verified in preview at zoom 0.5: stroke recorded at target coords exactly, eraser removed it, fog revealed exactly the aimed cell.

- [x] ~~**Cross-device apply path dropped half the map fields**~~ — `js/realtime.js` (`_reloadPanel`) *(fixed + verified)*
  - BroadcastChannel only reaches same-browser tabs; a phone gets updates solely through Firebase → `_reloadPanel('battlemap')`, which never applied `gridType`, `fogStrokes`, `gridOffsetX/Y`, `bgMapScale`, or `mapRotation`. Grid-type changes and free-fog paint simply never arrived on other devices; scale changes left tokens misplaced.
  - **Fix applied:** all shared fields now applied (with `_lastTokenScale` kept in lockstep). The same missing fields were also added to the BroadcastChannel payload + handler (scale/rotation changes trigger a full render there; offsets ride the lightweight repaint).

- [x] ~~**Conflict parking silently froze battlemap updates**~~ — `js/realtime.js` (`_applyRemoteKey`) *(fixed + verified)*
  - The map is written on every token drag / fog stroke by both sides, so the 300 ms dirty window collided constantly; a parked conflict then blocked ALL further battlemap updates on that device until the conflict bar was resolved — easy to miss on mobile, reads as "map stopped updating."
  - **Fix applied:** `skt-battlemap-v1` is exempt from conflict parking (last-write-wins). Losing one in-flight stroke to a rare race beats a frozen map; the local push still queued re-asserts this device's state moments later. Other keys (notes, party, …) keep full conflict handling.

---

## Notes delete-resurrection fixes (2026-07-26)

User report: "I delete a note, it doesn't reflect on a different device, and the deleted file shows up again." Two root causes in `js/dropbox-sync.js`, both fixed and verified end-to-end against the live Dropbox with a throwaway test file:

- [x] ~~**fullSync re-uploaded remotely-deleted files — the resurrection bug**~~ *(fixed + verified)*
  - fullSync's pass 3 treated every file that exists locally but not in the Dropbox listing as "created locally, push it up." But "deleted remotely while this device wasn't watching" looks identical. Since fullSync runs on EVERY notes-panel mount, any device that was closed (or asleep — phones) when the delete happened would re-upload its stale copy on next open, and every other device then pulled the "deleted" file back. Guaranteed resurrection unless all devices were actively polling at delete time.
  - **Fix applied:** `_state.fileRevs` doubles as a tombstone — if this device has a rev recorded for the file's path, it synced that exact path FROM Dropbox before, so its absence from the listing means a remote delete → remove the local copy instead of re-uploading. Files with no recorded rev are genuinely local-only and still push up. Stale rev entries are pruned after reconciliation (pendingDeletes kept). Also handles remote renames correctly (old path removed, new path created by pass 2).
  - **Verified:** uploaded `zz-sync-selftest.md`, deleted it remotely, restored the stale-device state (local item + rev tombstone), reloaded → mount-time fullSync removed the local copy, did NOT re-upload, tombstone consumed, real notes untouched.

- [x] ~~**Cursor expiry silently stopped sync until remount**~~ *(fixed)*
  - When the incremental poll's cursor expired, `_pollOnce` set `cursor = null` with a comment saying "recover with a full sync next tick" — but the next tick just early-returned on `!cursor`, forever. The device silently stopped receiving ALL notes changes (including deletes) until the notes panel was remounted, which is what set up the stale state the resurrection bug then fed on.
  - **Fix applied:** a poll tick with no cursor now runs `fullSync()` to reconcile and re-establish the cursor (respects the mid-edit guard and fullSync's busy re-entrancy check).

---

## Grid opacity / line width now sync to the player view (2026-07-26)

- [x] ~~**Grid opacity (and the new line width) never reached the player view**~~ — `js/panels/battlemap.js`, `js/realtime.js` *(fixed + verified live in a real ?player=1 tab)*
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

- [x] ~~**sanitizeHtml stripped `data:image/` — pasted images in NPC notes broke, then were destroyed on next edit**~~ — `js/utils.js` *(fixed + verified)*
  - The blanket `data:` block on `src` removed the base64 payload of pasted screenshots/portraits; the notes input handler then re-saved the src-less HTML, permanently losing the image.
  - **Fix:** `src`/`xlink:href` now allow `data:image/*` (still block `javascript:`/`vbscript:` and every other `data:` flavor); `href`/`formaction` keep the full block.

- [x] ~~**Cache-bust versions never bumped — deployed browsers keep running OLD code after every change**~~ — `skt-workspace.html` *(fixed)*
  - Scripts load as `js/…?v=20260525c`; none of this session's 11 changed files had their `?v=` bumped, so any browser with the old cached URL (i.e. every returning device on the deployed site) would keep executing pre-fix code indefinitely. All changed assets bumped to `v=20260726a`. **Process note: bump `?v=` on every changed JS/CSS file when committing.**

### Open findings — verified real, not yet fixed

- [x] ~~**Map rotation ≠ 0 breaks all battlemap pointer input**~~ *(fixed: `_stagePoint`/`_stageDelta` helpers un-rotate every screen→stage conversion — draw, erase, fog, click/align, hover, token drags, and party-token drops; verified in preview at 90° rotation: fog painted the exact aimed cell)* — `js/panels/battlemap.js`
  - `#map-stage` rotates via CSS transform, but every screen→canvas conversion assumes an unrotated stage. At 90°/270° axes swap; at 180° both flip. Token drags move perpendicular, fog paints wrong cells, Align computes garbage. Fix: un-rotate pointer coords about the stage center, or lock rotation-dependent tools while rotated.

- [x] ~~**PC AC/HP buffs are clobbered by the party↔combat mirror**~~ *(fixed: PC buff add/remove now applies the delta to the party slot — the stat owner — and lets syncPartyToCombat mirror it back; verified: +2 AC buff survives a forced re-mirror and removal restores the original values exactly)* — `js/panels/combat.js` (`_promptAddBuff`) vs `js/window-manager.js:344`
  - The ✦ buff writes AC/HP only to the combatant; any party-side edit re-mirrors un-buffed `hp/hpMax/ac` over it. The buff chip stays; removing it then SUBTRACTS the delta again, leaving the PC below their true max. Fix: route PC buffs through the party slot, or re-apply active buffs after each mirror, or hide AC/HP buffs on PC cards.

- [x] ~~**Combat right-click menu + conc/buff prompts capture stale indices**~~ *(fixed: context-menu items, `_promptAddBuff`, and `_promptConcentration` capture the combatant id and re-resolve the index at click/confirm time, mirroring the party actions-menu fix)* — `js/panels/combat.js` (`openMenu`, `_promptConcentration`, `_promptAddBuff`)
  - Index + combatant snapshot captured at open; a remote reorder/removal while the menu/modal is open makes the click hit whatever now sits at that index. Same pattern already fixed for the party actions menu — mirror that fix (capture `c.id`, re-resolve at click time).

- [x] ~~**Remote battlemap update mid-drag discards the local token move**~~ *(fixed: `_reloadPanel('battlemap')` skips while `def._drag` is active — the drag-end `_saveMap()` makes this device canonical under last-write-wins anyway; logic fix, not practical to race-test locally)* — `js/realtime.js` (`_reloadPanel('battlemap')`)
  - Now that the map is last-write-wins, a peer's write during a local drag re-renders the stage and replaces `_tokens`; drag-end then writes to an orphaned object and saves the un-moved array — token snaps back. Fix: while `def._drag` is active, defer the reload (apply on drag-end).

- [x] ~~**`state.settings` shallow-copies `DEFAULT_SETTINGS` — nested defaults get corrupted; Reset to Defaults can't restore them**~~ — `js/state.js:14`, `js/settings.js:368` *(fixed: deep clone at both init and Reset-to-Defaults, same as `DEFAULT_PARTY`; verified `state.settings.shopFilters !== DEFAULT_SETTINGS.shopFilters`)*

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
  - **Bump `DATA_STAMP` in `js/data-loader.js` whenever anything under `data/` changes** — same discipline as the `?v=` query strings.
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

- [x] **`assetUrl()` / `assetThumbUrl()` in `js/utils.js` + `js/asset-config.js`** — all 13 render-time `'img/' + path` sites now route through one helper; `imgBase: ''` reproduces today's URLs exactly. Verified as a **provable no-op**: 22 image requests, 0 failures, map background + picker cards + bestiary tokens + covers all render.
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

**Still fully reversible:** the images remain in the repo. Setting `imgBase: ''` in `js/asset-config.js` restores local serving.

### Remaining — the history purge (irreversible; soak first)

1. **R2, not Pages**: Pages caps a project at 20,000 files; 14,278 images + thumbnails leaves no headroom. R2 has no file limit, 10 GB free (need ~3.9 GB), zero egress.
2. Upload with `rclone copy ./img r2:<bucket>` — bucket root mirrors the *contents* of `img/`; thumbnails to `thumbs/`. Set `Cache-Control: public, max-age=31536000, immutable`.
3. **CORS is mandatory, not optional.** `battlemap.js` reads pixels off the map background (`getImageData`) for adaptive grid contrast, and `npc-library.js` uses `toBlob` — a cross-origin image taints the canvas and silently kills the first and throws in the second. CORS also keeps SW responses non-opaque; opaque entries are never cached by `cacheFirst` (`res.ok` is false) and force-caching them costs ~7 MB padding each.
4. Also add `crossorigin="anonymous"` to generated `<img>` tags and `img.crossOrigin` before `.src`, or requests stay `no-cors` and come back opaque even with CORS headers present.
5. Then set `imgBase` in `js/asset-config.js` **and** `IMG_ORIGINS` in `sw.js` (they must match), soak for a few days with the repo copy as a live fallback, and only then purge history.
6. **Purge is last and irreversible.** Tag `pre-cdn-purge` and push it first; take a mirror clone + bundle and verify both; `pip install git-filter-repo`; rewrite in a *fresh* clone; force-push. **Never `git reset --hard` the old clone afterwards — against an img-less tree that deletes all 14,278 files from disk.** Verify in a fresh incognito profile: the SW will happily keep serving cached images and make a broken deploy look fine locally.

---

## Backups — whole-state snapshot/restore (2026-07-28)

**The finding:** Settings had an Export/Import pair, so backups looked covered. The export wrote six fields — `party`, `combatants`, `combatRound`, `activeCombatantId`, `shop`, `settings` — out of the ~50 `skt-*` keys the app owns. Session notes, the battle map (tokens, fog, drawings, saved and starred maps), the bestiary, the NPC library, loot, encounters, soundboard scenes, time, weather and every bookmark were **absent from every backup ever taken**, and the import gave no hint of it. Measured on a live profile: importing an old-format file would have cleared **9 populated key groups**.

### Done and verified

- [x] **`js/backup.js`** — `snapshot()` captures every `skt-*` key minus a documented denylist (`skt-me-v1` is the important one: it's per-browser author identity, and restoring it onto a second device makes two people the same notes author). Values are stored as **raw strings, never re-parsed** — a `JSON.parse`/`stringify` round trip reorders keys and drops `undefined`, so the restore wouldn't be byte-identical to the backup.
- [x] **Restore is destructive on purpose, and says so.** Keys absent from the file are cleared, otherwise a restore *merges* and an NPC deleted before the backup was taken comes back to life. The confirm dialog lists exactly which local data will be cleared, and warns that a restore overwrites the shared campaign for everyone connected.
- [x] **The clobber trap — the reason this needed care.** Writing keys locally and reloading does **not** work: on the next load the sync listeners attach, read the server's still-pre-restore copy, and apply it over everything. The restore vanishes with no error anywhere. `_flushDirtyKeys`/`_flushEntityKey` now return their promises and `window.realtimeFlushAndWait()` resolves `published` / `partial` / `offline` / `timeout`; the UI only reloads on `published`, and on anything else keeps the restored state on screen and tells the user to sync first.
- [x] **Entity keys ignored a clear** — `_flushEntityKey` returned early when the local value was gone, leaving every exploded child node on the server so the next load pulled the deleted data straight back. Now removes the base node. (Affects `skt-combat-v1`, `skt-battlemap-v1`, `skt-notes-v2`.)
- [x] **Stale keys are `setItem('')` *then* `removeItem()`** — both matter. `setItem` is the only thing realtime.js hooks, so it's what marks the key dirty; `removeItem` then leaves storage clean and makes the flush push `null`. Stopping at `''` left empty-string debris in every later snapshot (caught by the round-trip test failing).
- [x] **Rolling automatic snapshots** in IndexedDB (`skt-backups`) — a backup you have to remember to click is a backup you don't have. Two independent 10-deep rings so timed snapshots can't evict deliberate ones (`manual`, `before-restore`); both capped, since an uncapped ring is an unbounded disk leak. Byte-identical consecutive autosaves are skipped so an idle tab can't flush real history out of the ring. One is taken automatically before any restore.
- [x] **Legacy imports still work** — the original six-field format is detected and mapped onto the modern keys, and flagged in the preview as incomplete.

**Verified in-browser (24 assertions):** snapshot covers 14/16 live keys with both omissions on the denylist; file round-trip byte-identical; restore byte-identical after mutation; stale keys fully removed with no empty-string debris; sync reported `published`; pre-restore snapshot written; both rings cap at 10; legacy parse rebuilds the combat shape and warns about 9 key groups it would clear; malformed and non-backup JSON rejected with readable messages. Restore was exercised against **non-synced keys only** — a real restore publishes, and this profile points at the live campaign.

**Still not covered, stated in the UI:** soundboard *audio* (raw Blobs in the `skt-soundboard` IndexedDB store, routinely hundreds of MB) and the derived 5e data index (rebuilds itself).

---

*Generated by codebase audit workflow. Findings have already been adversarially verified — false positives were stripped before this list was written. When fixing an item, mark its checkbox and (optionally) annotate with the date and commit hash so future audits can skip it.*
