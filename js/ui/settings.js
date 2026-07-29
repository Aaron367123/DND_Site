// ============================================================
// SETTINGS DRAWER
// ============================================================

// Apply a global UI scale factor to everything inside the app shell using the
// CSS `zoom` property. This is the cleanest way to make text + buttons +
// windows all grow together: the browser handles every measurement (paddings,
// border widths, viewport coords) so no per-element math is needed. We
// deliberately set this on the body rather than `.app` so the settings
// drawer, modals, and popovers (which live outside `.app`) also scale.
function applyFontScale(scale){
  const s = Math.max(0.5, Math.min(2, scale || 1));
  document.body.style.zoom = s;
  // CSS `zoom` visually scales the body but leaves layout dimensions alone,
  // so `height:100vh` ends up covering only `s × 100vh` of physical screen
  // — leaving a gap below (and to the right) of every element sized in
  // viewport units. Counter-scale every viewport-sized element so they all
  // still fill the screen at any zoom.
  //
  // .app uses `height:100vh` in CSS so it needs the same treatment as body;
  // otherwise body fills the screen but `.app` (which lives inside body)
  // still ends up shorter than the viewport and its background shows
  // through as a dark gap.
  const app = document.querySelector('.app');
  if (Math.abs(s - 1) < 0.001){
    document.body.style.width = '';
    document.body.style.height = '';
    document.body.style.minHeight = '';
    if (app){ app.style.width = ''; app.style.height = ''; app.style.minHeight = ''; }
  } else {
    const pct = (100 / s).toFixed(3);
    document.body.style.width  = pct + 'vw';
    document.body.style.height = pct + 'vh';
    document.body.style.minHeight = pct + 'vh';
    if (app){
      app.style.width  = pct + 'vw';
      app.style.height = pct + 'vh';
      app.style.minHeight = pct + 'vh';
    }
  }
}

// Apply per-element visibility toggles by setting body classes that the CSS
// uses to hide the matching widget. Settings (⚙) and search (🔎) intentionally
// stay visible so the user can always return to this drawer.
function applyUiHide(uiHide){
  const u = uiHide || {};
  document.body.classList.toggle('hide-dock',          !!u.dock);
  document.body.classList.toggle('hide-player-view',   !!u.playerView);
  document.body.classList.toggle('hide-sync-status',   !!u.syncStatus);
  document.body.classList.toggle('hide-tutorial-btn',  !!u.tutorialBtn);
  document.body.classList.toggle('hide-zoom-controls', !!u.zoomControls);
  document.body.classList.toggle('hide-window-focus',  !!u.windowFocus);
}

function initSettings(){
  // Apply the saved font scale immediately, before any UI shows up, so the
  // page renders at the right size from the first paint.
  applyFontScale(state.settings.fontScale ?? 1);
  // Apply saved UI-visibility toggles too.
  applyUiHide(state.settings.uiHide || {});

  const drawer=document.getElementById('settings-drawer');
  const settingsBtn=document.getElementById('settings-btn');
  // Toggle on mousedown (not click) so the document-level "click outside to
  // close" handler below sees stopPropagation in time. Otherwise the document
  // closes the drawer first, then the button's click re-opens it on the same gesture.
  settingsBtn.addEventListener('mousedown',e=>{
    e.stopPropagation();
    drawer.classList.toggle('open');
  });
  document.getElementById('close-drawer').addEventListener('click',()=>drawer.classList.remove('open'));
  drawer.addEventListener('mousedown',e=>e.stopPropagation());
  document.addEventListener('mousedown',()=>{
    if(drawer.classList.contains('open')) drawer.classList.remove('open');
  });
  // Escape also closes
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && drawer.classList.contains('open')) drawer.classList.remove('open');
  });

  // Shop generator controls (currency symbol, price jitter, rounding) used to
  // live in this drawer; they were moved into the Shop Generator panel itself
  // via a small ⚙ button so the settings drawer focuses on global preferences.

  // Per-user identity (local-only, drives per-line author coloring in Notes).
  const meName = document.getElementById('me-name');
  const meColor = document.getElementById('me-color');
  const me = _getMe();
  meName.value = me.name;
  meColor.value = me.color;
  function _persistMe(){
    const updated = { id: me.id, name: (meName.value || 'Player').trim(), color: meColor.value };
    me.name = updated.name; me.color = updated.color;
    try { localStorage.setItem('skt-me-v1', JSON.stringify(updated)); } catch(e) {}
    // Push the updated registry entry into the synced notes blob so other clients see it.
    panelDefs.notes && panelDefs.notes._touchSelf && panelDefs.notes._touchSelf();
  }
  meName.addEventListener('change', _persistMe);
  meColor.addEventListener('change', _persistMe);

  // Theme picker (presets + custom). Local-only, lives in localStorage.
  if (typeof initThemeControls === 'function') initThemeControls();

  // Window-snapping toggle.
  const snap = document.getElementById('snap-windows');
  if (snap) {
    snap.checked = state.settings.snapWindows !== false;
    snap.addEventListener('change', () => {
      state.settings.snapWindows = snap.checked;
      save();
    });
  }

  // Visibility toggles for chrome elements (sidebar, top-bar buttons, status).
  // Stored as `state.settings.uiHide.<key>` (true = hidden). Each checkbox
  // shows the OPPOSITE state to the user (checked = visible).
  const uiHide = state.settings.uiHide = state.settings.uiHide || {};
  const visControls = [
    { id:'show-dock',           key:'dock' },
    { id:'show-player-view',    key:'playerView' },
    { id:'show-sync-status',    key:'syncStatus' },
    { id:'show-tutorial-btn',   key:'tutorialBtn' },
    { id:'show-zoom-controls',  key:'zoomControls' },
    { id:'show-window-focus',   key:'windowFocus' },
  ];
  visControls.forEach(({id, key}) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    cb.checked = !uiHide[key];
    cb.addEventListener('change', () => {
      uiHide[key] = !cb.checked;
      save();
      applyUiHide(uiHide);
    });
  });

  // Display font-scale — slider for the common range (80–150%) + number
  // input for arbitrary values (50–200%). Either control drives the other,
  // and both call applyFontScale via CSS `zoom`. The slider provides a live
  // preview during drag; release / blur commits to state.
  const fs  = document.getElementById('font-scale');
  const fsn = document.getElementById('font-scale-num');
  if (fs && fsn){
    const SLIDER_MIN = 80, SLIDER_MAX = 150;
    const NUM_MIN = 50, NUM_MAX = 200;
    const initPct = Math.round(((state.settings.fontScale ?? 1) * 100));
    fs.value  = String(Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, initPct)));
    fsn.value = String(initPct);

    // Mirror current value into both controls without re-firing each other.
    let _muting = false;
    // Preview (drag-time) updates the number display only — applying the
    // actual page zoom while the user is still dragging causes the slider
    // thumb to physically move under the cursor (the whole page rescales,
    // including the slider), making the control fight back against the
    // drag. We commit the visual change ONLY on release.
    const setBoth = (pct, opts={}) => {
      const clampedNum = Math.max(NUM_MIN, Math.min(NUM_MAX, pct));
      _muting = true;
      fsn.value = String(clampedNum);
      fs.value  = String(Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, clampedNum)));
      _muting = false;
      if (opts.apply !== false) applyFontScale(clampedNum / 100);
      if (opts.commit){
        state.settings.fontScale = clampedNum / 100;
        save();
      }
    };

    // Slider: number reads track the drag for feedback, but the actual zoom
    // is only applied on release ('change'). No more chasing the slider as
    // the UI rescales mid-drag.
    fs.addEventListener('input', () => {
      if (_muting) return;
      const pct = Math.max(NUM_MIN, Math.min(NUM_MAX, parseInt(fs.value)));
      _muting = true;
      fsn.value = String(pct);
      _muting = false;
    });
    fs.addEventListener('change', () => { if (_muting) return; setBoth(parseInt(fs.value), {commit:true}); });
    // Number input: only apply on blur / Enter, NOT on every keystroke. If
    // we previewed on `input`, typing "1" while replacing "200" with "100"
    // would briefly scale the page to 1% and make the input unreachable.
    // `change` fires on blur or Enter so the user can finish typing first.
    fsn.addEventListener('change', () => {
      if (_muting) return;
      const v = parseInt(fsn.value);
      if (!isNaN(v)) setBoth(v, {commit:true});
    });
    // Pressing Enter inside the number input should immediately commit
    // (without waiting for blur, which is what `change` would normally need).
    fsn.addEventListener('keydown', e => {
      if (e.key === 'Enter') fsn.blur();
    });
  }

  // Reprint policy — controls whether reprinted entries appear in search.
  const reprintPolicy = state.settings.reprintPolicy || 'all';
  document.querySelectorAll('#reprint-group button').forEach(b=>{
    b.classList.toggle('active', b.dataset.val === reprintPolicy);
  });
  document.querySelectorAll('#reprint-group button').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('#reprint-group button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    state.settings.reprintPolicy = btn.dataset.val;
    save();
    // Refresh the search popup if it's open so the change is visible immediately
    if (document.getElementById('search-popup')?.classList.contains('open')) {
      renderSearchTabs(); renderSearchResults();
    }
  }));

  // "Sync now" — force a flush of pending changes to Firebase, then trigger
  // a full sync of notes via whichever notes-sync provider is active. Useful
  // when the user wants instant push instead of waiting on the debounce, or
  // wants to know whether sync is actually configured.
  const syncBtn = document.getElementById('sync-now-btn');
  const syncStat = document.getElementById('sync-now-status');
  if (syncBtn){
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      const setStat = (txt) => { if (syncStat) syncStat.textContent = txt; };
      setStat('Syncing…');
      const results = [];
      // Firebase realtime — push any dirty localStorage keys
      try {
        if (typeof window.realtimeFlush === 'function' && window.realtimeFlush()){
          results.push('Firebase');
        }
      } catch(e){ console.warn('[sync-now] realtime failed', e); }
      // Notes data — used by both sync providers
      let notesData = null;
      try {
        const raw = localStorage.getItem('skt-notes-v2');
        if (raw) notesData = JSON.parse(raw);
      } catch(e){}
      // Local-vault notes (File System Access)
      try {
        if (window.notesSync && typeof window.notesSync.fullSync === 'function' && notesData){
          await window.notesSync.fullSync(notesData, {force:true});
          if (window.notesSync.isConnected && window.notesSync.isConnected()) results.push('vault');
        }
      } catch(e){ console.warn('[sync-now] notes-sync failed', e); }
      // Dropbox notes
      try {
        if (window.dropboxSync && typeof window.dropboxSync.fullSync === 'function' && notesData){
          await window.dropboxSync.fullSync(notesData, {force:true});
          if (window.dropboxSync.isConnected && window.dropboxSync.isConnected()) results.push('Dropbox');
        }
      } catch(e){ console.warn('[sync-now] dropbox-sync failed', e); }
      const now = new Date();
      const hhmm = now.toTimeString().slice(0,5);
      if (results.length){
        setStat('✓ ' + results.join(', ') + ' · ' + hhmm);
        if (typeof showToast === 'function') showToast('Synced ' + results.join(', '));
      } else {
        setStat('No sync configured');
      }
      syncBtn.disabled = false;
    });
  }

  // Export / import now go through js/features/backup.js, which snapshots EVERY
  // skt-* key. The old inline version wrote six fields and quietly omitted
  // notes, the battle map, the bestiary, NPCs, loot and the rest.
  document.getElementById('export-btn').addEventListener('click',()=>{
    try {
      const bytes = sktBackup.download();
      showToast('Exported · ' + sktBackup.formatBytes(bytes));
    } catch(err){
      console.error('[backup] export failed', err);
      showToast('Export failed — ' + (err.message || err));
    }
  });
  document.getElementById('import-btn').addEventListener('click',()=>document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      let parsed;
      try { parsed = sktBackup.parse(ev.target.result); }
      catch(err){ showToast('Import failed — ' + err.message); e.target.value = ''; return; }
      const info = sktBackup.describe(parsed);

      // Spell out the two things that actually surprise people: a restore
      // REMOVES local data the file doesn't contain, and it publishes to
      // every other connected device rather than staying on this one.
      let msg = 'Replace everything in this browser with:\n\n' + info.lines.join('\n');
      if (info.created) msg += '\n\nBacked up ' + new Date(info.created).toLocaleString();
      if (info.legacy){
        msg += '\n\n⚠ Old-format file — it only contains party, combat, shop and'
             + ' settings. Notes, maps, bestiary and NPCs were not in this backup.';
      }
      if (info.localOnly.length){
        msg += '\n\n⚠ Not in this file, so it will be CLEARED:\n• ' + info.localOnly.join('\n• ');
      }
      msg += '\n\nThis also overwrites the shared campaign for everyone connected.';

      const proceed = async (ok) => {
        e.target.value = '';
        if (!ok) return;
        try {
          const res = await sktBackup.restore(parsed);
          if (res.sync === 'timeout' || res.sync === 'partial'){
            // Don't reload — the listeners would read the server's older
            // copy and undo the restore. Let the user retry from a stable
            // state instead of silently losing it.
            showToast('Restored locally, but the sync push did not confirm. Use “Sync now” before reloading.');
            return;
          }
          showToast('Restored ' + res.restored + ' item' + (res.restored===1?'':'s') + ' — reloading…');
          // Full reload rather than initPanels(): every panel re-reads its
          // own key on boot, which is far more reliable than trying to
          // re-init 16 panels in place after replacing all of storage.
          setTimeout(() => location.reload(), 600);
        } catch(err){
          console.error('[backup] restore failed', err);
          showToast('Restore failed — ' + (err.message || err));
        }
      };
      if (typeof showConfirm === 'function'){
        showConfirm(msg, {title:'Restore backup', confirmLabel:'Replace everything', danger:true}).then(proceed);
      } else {
        proceed(window.confirm(msg));
      }
    };
    reader.readAsText(f);
  });

  // ─── Automatic snapshots ───────────────────────────────────────────────────
  // Rolling local copies, so recovery doesn't depend on having remembered to
  // click Export. Rendered on every drawer open (cheap — the list query
  // strips the payloads).
  const renderSnapshots = async () => {
    const el = document.getElementById('snapshot-list');
    if (!el || !window.sktBackup) return;
    let rows;
    try { rows = await sktBackup.autosave.list(); }
    catch(err){ el.innerHTML = '<p class="drawer-note">Snapshots unavailable — ' + esc(String(err.message||err)) + '</p>'; return; }
    if (!rows.length){
      el.innerHTML = '<p class="drawer-note">No snapshots yet — the first is taken a minute after load, then every '
        + Math.round(sktBackup.autosave.INTERVAL_MS/60000) + ' minutes.</p>';
      return;
    }
    el.innerHTML = rows.map(r => {
      const when = new Date(r.created);
      const tag = r.reason === 'before-restore' ? ' <span class="snap-tag">pre-restore</span>' : '';
      return '<div class="snap-row" data-snap="' + r.id + '">'
        + '<span class="snap-when">' + esc(when.toLocaleString()) + tag + '</span>'
        + '<span class="snap-size">' + esc(sktBackup.formatBytes(r.size||0)) + '</span>'
        + '<button class="btn small" data-snapact="download" data-snap="' + r.id + '">Download</button>'
        + '<button class="btn small danger" data-snapact="restore" data-snap="' + r.id + '">Restore</button>'
        + '</div>';
    }).join('');
  };

  const snapList = document.getElementById('snapshot-list');
  if (snapList){
    snapList.addEventListener('click', async ev => {
      const btn = ev.target.closest('[data-snapact]'); if (!btn) return;
      const id = Number(btn.dataset.snap);
      const rec = await sktBackup.autosave.get(id);
      if (!rec){ showToast('Snapshot not found'); return; }
      if (btn.dataset.snapact === 'download'){
        sktBackup.download(rec.snap);
        showToast('Downloaded');
        return;
      }
      const parsed = { keys: rec.snap.keys, created: rec.created, version: rec.snap.version, legacy:false };
      const info = sktBackup.describe(parsed);
      let msg = 'Roll back to the snapshot from ' + new Date(rec.created).toLocaleString() + '?\n\n'
              + info.lines.join('\n');
      if (info.localOnly.length) msg += '\n\n⚠ Will be CLEARED:\n• ' + info.localOnly.join('\n• ');
      msg += '\n\nThis also overwrites the shared campaign for everyone connected.\n'
           + 'Your current state is saved as a new snapshot first.';
      const ok = typeof showConfirm === 'function'
        ? await showConfirm(msg, {title:'Restore snapshot', confirmLabel:'Roll back', danger:true})
        : window.confirm(msg);
      if (!ok) return;
      try {
        const res = await sktBackup.restore(parsed);
        if (res.sync === 'timeout' || res.sync === 'partial'){
          showToast('Restored locally, but the sync push did not confirm. Use “Sync now” before reloading.');
          return;
        }
        showToast('Rolled back — reloading…');
        setTimeout(() => location.reload(), 600);
      } catch(err){
        console.error('[backup] snapshot restore failed', err);
        showToast('Restore failed — ' + (err.message || err));
      }
    });
  }

  const snapNowBtn = document.getElementById('snapshot-now-btn');
  if (snapNowBtn){
    snapNowBtn.addEventListener('click', async () => {
      snapNowBtn.disabled = true;
      try {
        // 'manual' is exempt from the rolling prune, same as 'before-restore'.
        const rec = await sktBackup.autosave.write('manual');
        showToast(rec ? 'Snapshot saved · ' + sktBackup.formatBytes(rec.size) : 'No changes since the last snapshot');
        await renderSnapshots();
      } catch(err){
        showToast('Snapshot failed — ' + (err.message || err));
      }
      snapNowBtn.disabled = false;
    });
  }
  window._sktRenderSnapshots = renderSnapshots;

  // Storage usage indicator — sums byte length of every localStorage key the
  // app owns (skt-* prefix) so the user can spot when they're approaching the
  // ~5 MB quota most browsers enforce. Refreshes every time the drawer reopens.
  const updateStorageUsage = () => {
    const el = document.getElementById('storage-usage'); if (!el) return;
    let bytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++){
        const k = localStorage.key(i);
        if (!k || !k.startsWith('skt-')) continue;
        const v = localStorage.getItem(k) || '';
        // localStorage stores UTF-16 code units → multiply by 2 for byte size.
        bytes += (k.length + v.length) * 2;
      }
    } catch(e){}
    const mb = bytes / 1024 / 1024;
    const pct = Math.min(100, (bytes / (5 * 1024 * 1024)) * 100);
    el.innerHTML = `${mb.toFixed(2)} MB used of ~5 MB (${pct.toFixed(0)}%)
      <div style="margin-top:4px;height:4px;background:var(--panel-3);border-radius:2px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${pct>80?'var(--danger)':'var(--accent)'};transition:width .2s"></div>
      </div>`;
  };
  // Diagnostics. The count is the point — it's the passive signal that
  // something went wrong while you weren't looking at the console.
  const updateErrCount = () => {
    const el = document.getElementById('errlog-count');
    if (!el || !window.sktErrors) return;
    const n = sktErrors.count();
    el.textContent = n ? ('Error log (' + n + ')') : 'Error log';
    el.parentElement?.classList.toggle('danger', n > 0);
  };
  document.getElementById('open-errlog-btn')?.addEventListener('click', () => {
    if (window.sktErrors) sktErrors.show();
  });

  updateStorageUsage();
  updateErrCount();
  renderSnapshots();
  // Also refresh when the drawer opens — easy hook is the visibility class
  // toggling on the drawer container. (Reuses the `drawer` already declared
  // at the top of initSettings.)
  if (drawer){
    new MutationObserver(() => { updateStorageUsage(); updateErrCount(); renderSnapshots(); })
      .observe(drawer, { attributes:true, attributeFilter:['class','style'] });
  }
  // Help & about: open the shortcut overlay from settings (parity with `?`
  // key), and let the user re-trigger the tutorial from here too.
  document.getElementById('open-help-overlay')?.addEventListener('click', () => {
    if (typeof window.showHelpOverlay === 'function') window.showHelpOverlay();
  });
  document.getElementById('open-tutorial-btn')?.addEventListener('click', () => {
    if (typeof window.openTutorial === 'function') window.openTutorial(0);
  });
  document.getElementById('open-changelog-btn')?.addEventListener('click', () => {
    if (typeof window.openChangelog === 'function') window.openChangelog(false);
  });
  document.getElementById('open-about-btn')?.addEventListener('click', () => {
    if (typeof window.openAbout === 'function') window.openAbout();
  });
  document.getElementById('open-demo-btn')?.addEventListener('click', () => {
    if (typeof window.runDemoScenario === 'function') window.runDemoScenario();
  });

  // Rebuild the cached 5e index — escape hatch for a stale cache (e.g. data/
  // files changed without bumping DATA_STAMP in data-loader.js).
  document.getElementById('rebuild-index-btn')?.addEventListener('click', () => {
    if (typeof window.SKT_REBUILD_INDEX !== 'function'){ showToast('Index cache unavailable'); return; }
    showToast('Rebuilding data index — reloading…');
    window.SKT_REBUILD_INDEX();
  });

  document.getElementById('reset-data-btn').addEventListener('click',()=>{
    showModal('⚠ Reset Everything?',[],'Reset to Defaults').then(r=>{
      if(r===null)return;
      state.party=JSON.parse(JSON.stringify(DEFAULT_PARTY));state.combatants=[];state.combatRound=0;state.activeCombatantId=null;state.shop=null;state.settings=JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      save();applyFontScale(state.settings.fontScale??1);applyUiHide(state.settings.uiHide||{});initPanels();showToast('Reset to defaults');
    });
  });
} // end initSettings
