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
- [ ] HP-field surgical update doesn't toggle `.downed` class / downed badge / status badges / temp marker — typing 0 leaves card looking healthy — `js/panels/party.js:2245`
- [ ] `_mirrorPartyToCombatSilent` strict-id-only → long/short rest skip name-matched PCs — `js/panels/party.js:1314`
- [ ] Actions-menu closures capture index `i` that desyncs after remote drag-reorder — `js/panels/party.js:2173`
- [ ] Body click listener leaked every `_render()` — multiplies on each interaction — `js/panels/party.js:2846`

### Combat tracker
- [ ] Group rows ignore damage type → resist/vuln/immune bypassed in grouped view — `js/panels/combat.js:707`
- [ ] Death-save at 3 successes/3 failures leaves state inconsistent — stabilized PCs re-enter death-save mode on next damage; dead PCs unkillable via pip click — `js/panels/combat.js:724`
- [ ] Concentration save toast misses wild-shape damage absorbed by beast pool — `js/panels/combat.js:1386`

### Battlemap
- [ ] `_renderTokens` leaks `.map-token-facing` DOM nodes — z-fighting after fog sessions — `js/panels/battlemap.js:2725`
- [ ] Fog paint has no touch handler — mobile DMs can't reveal/hide fog — `js/panels/battlemap.js:1516`

### Sync
- [ ] Dropbox 429 retry recurses without retry cap — `js/dropbox-sync.js:160`
- [ ] File System Access permission silently expires after reload — UI shows "connected" but vault never syncs — `js/notes-sync.js:199`

### Data loader
- [ ] Subclass fluff lookup keyed by display name never matches — all subclass cards fall through to mechanical text — `js/data-loader.js:1054`
- [ ] `_convertSpell` drops all but the first `entriesHigherLevel` block — `js/data-loader.js:449`
- [ ] `_findItemEntry` no source-omitted fallback — literal `{#itemEntry …}` leaks into descriptions — `js/data-loader.js:475`
- [ ] `expandMagicVariants` is O(variants × baseItems), ~100k calls per cold load — `js/data-loader.js:826`

### Notes
- [ ] Undo while not editing bypasses sync push — `js/panels/notes.js:840`
- [ ] 800 ms debounced push survives unmount — closing tab within 800 ms of typing loses the write — `js/panels/notes.js:768`
- [ ] `_notesUpdateLineAuthors` drops authorship for duplicate lines, especially blank lines — `js/panels/notes.js:71`
- [ ] Deleting author from legend leaves orphan `lineAuthors` refs — `js/panels/notes.js:619`

### Other panels
- [ ] Encounter `XP_THRESH[0]` has 5 entries while every other level has 4 → wrong difficulty tier at level 1 — `js/panels/encounter.js:5`
- [ ] Bestiary snapshot edit (HP/AC/CR) ignored by stat-block popout — `js/panels/bestiary.js:462`
- [ ] Modal Escape-to-close keydown never fires on non-focusable backdrop — `js/panels/shop.js:186`, `js/panels/bestiary.js:335`
- [ ] `_loadAdventure` caches failed fetches as empty data for the session — `js/panels/books.js:150`
- [ ] `.adv-list` class collision breaks bulleted lists inside chapter content — `js/panels/books.js:717`, `js/panels/adventures.js:635`
- [ ] Secret reveal state persists across delete/auto-select in NPC library — `js/panels/npc-library.js:849`
- [ ] Generator save bypasses `lib._save()` and skips secret-rehide — `js/panels/npc-generator.js:252`
- [ ] `initPanels()` and reset-layout skip `adventures` and `books` panels — `js/app.js:10`
- [ ] **Stale cache busters** on `utils.js` / `state.js` / `notes-sync.js` / `soundboard.js` / `weather.js` / `timetracker.js` / `pdf-import.js` — `skt-workspace.html:284`
- [ ] Document-level Escape keydown leaks per crop modal — `js/utils.js:177`
- [ ] Toast `z-index:200` sits below `modal-backdrop:500` — validation toasts hidden behind modals — `styles/main.css:2856`

---

## Low priority — 30+

Polish, dead code, schema drift.

### Dead JS in `party.js`
- [ ] `_conditionsRow`, `_statusRow`, `_sheetBody` are fully implemented but never called (~80 lines)
- [ ] Eight click handlers (`remove`, `add`, `import-pdf`, `party-skills`, `quick-roll`, `del-res`, `add-res`, `toggle-sheet`, `sheet-tab`) have no matching `data-act` emitter
- [ ] Misleading `data-act="resize-start"` on the resize grip — handler doesn't exist; grip uses its own mousedown

### Dead CSS (~100 lines)
- [ ] `.inspiration-row` / `.inspiration-pair` / `.inspiration-toggle`
- [ ] `.sheet-toggle` back-compat stub
- [ ] Notes V1 (`.notes-tabs` / `.notes-tab` / `.notes-textarea` / `.notes-preview`)
- [ ] Combat `.hp-dmg-strip` column-strip variant
- [ ] Old `.drawer-section` card layout
- [ ] `.char-hp-temp[value='0']` dim-state won't re-apply after edit (attribute vs IDL value)

### State / settings drift
- [ ] Runtime-only settings keys (`combatCompact`, `combatGroupSimilar`, `monsterStatsMode`, etc.) not in `DEFAULT_SETTINGS`
- [ ] `syncPartyToCombat`/`syncCombatToParty` only mirror `hp/hpMax/ac` — name renames go stale on combat card
- [ ] Transient per-character maps (`_rollHistory`, `_activeTab`, `_expanded`, `_lastRoll`, `_historyOpen`, `_resistancesOpen`) never pruned on removal

### Per-character state bleed
- [ ] `_lastDmgType` and `_lastDmgAmount` are panel-scoped — bleed between characters

### UX / polish
- [ ] Align tool rounds cell-span guesses though renderer accepts floats — `js/panels/battlemap.js`
- [ ] Touch token drag ignores Shift/snap-invert and has the double-scale bug — `js/panels/battlemap.js`
- [ ] Notes `_render` destroys editor preview on every sync pull — scroll/selection lost — `js/panels/notes.js`
- [ ] Loot item search runs full `_5eData` scan on every keystroke (no debounce) — `js/panels/loot.js`
- [ ] Hidden-books/adventures + bookmarks don't propagate cross-tab via storage event (only via Firebase) — `js/panels/books.js`
- [ ] Stale chapter bookmark past end-of-chapters clamped to 0 but never written back — `js/panels/books.js`
- [ ] Books panel shows "No adventures match." (copy-paste leftover from adventures.js)
- [ ] `parseInt(0)||fallback` prevents setting AC to 0 in bestiary snapshot edit — `js/panels/bestiary.js`
- [ ] Curated shop extras use substring 'drink'/'food' for `excludeConsumables` vs main path's P/SC/A type check — `js/panels/shop.js`
- [ ] Shop unmount leaks open modal backdrops if user closes window while modal is open — `js/panels/shop.js`
- [ ] Avatar onerror handler can break on names whose initials contain apostrophes — `js/panels/npc-library.js`
- [ ] Generator quirk dedupe loop can still return identical quirks (probabilistically tiny) — `js/panels/npc-generator.js`
- [ ] Resizable textareas (`npclib-desc`, `npclib-secret`) lose drag-resized height on every full `_render` — `js/panels/npc-library.js`
- [ ] Generator notes write plain text but library treats `n.notes` as HTML (schema inconsistency) — `js/panels/npc-generator.js`
- [ ] Settings popover outside-click listener stays bound after Close/Done (self-cleans on next click) — `js/panels/notes.js`
- [ ] Folder rename on Dropbox leaves descendant file revs keyed under old path — `js/panels/notes.js`
- [ ] `_resolveCopy` deep-clones every monster via `JSON.parse(JSON.stringify)` — cold-load perf — `js/data-loader.js`
- [ ] `_isReprintEntry` key not trimmed while reprint targets are — silent miss on whitespace — `js/data-loader.js`
- [ ] Dead share-button DOM lookup in `realtime.js` shared-panels handler — `js/realtime.js`
- [ ] `.party-grid.compact .char-card > *` uses `!important` to nuke 8 sibling rules — fragile — `styles/main.css`
- [ ] Card-avatar/char-icon-btn animate width+height (layout-driving transition) on every active-turn flip — `styles/main.css`

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
