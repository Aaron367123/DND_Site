// ============================================================
// NOTES — OBSIDIAN VAULT SYNC (File System Access API)
// ============================================================
// Two-way sync between the in-app notes (skt-notes-v2 in localStorage) and a
// folder of .md files on disk. Last-write-wins by mtime.
//
// Browser support: Chromium (Chrome / Edge / Opera). Other browsers: pill
// shows "Sync requires Chromium". Site must be served over HTTPS or localhost
// (already the case for github.io).

(function() {
  'use strict';

  const SYNC_KEY = 'skt-notes-sync-v1';
  const IDB_NAME = 'skt-notes-sync';
  const IDB_STORE = 'handles';
  const HANDLE_ID = 'vault';
  const POLL_MS = 8000;
  const PUSH_DEBOUNCE_MS = 800;

  // ─── Tiny IndexedDB wrapper ────────────────────────────────────────────────
  function _openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function _idbGet(key) {
    const db = await _openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function _idbSet(key, value) {
    const db = await _openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function _idbDel(key) {
    const db = await _openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ─── State ────────────────────────────────────────────────────────────────
  let _vaultHandle = null;     // FileSystemDirectoryHandle
  let _state = {               // persisted in localStorage
    vaultName: null,
    pathToId:  {},             // disk relative path → app item id
    fileMeta:  {},             // app id → {mtime, hash, path}
    lastSync:  0,
  };
  let _pushTimers = new Map(); // id → setTimeout handle (debouncing)
  let _pollTimer = null;
  let _statusListeners = new Set();
  let _conflictListeners = new Set();
  let _busy = false;           // syncing right now
  let _editingProvider = null; // function returning whether the user is mid-edit
  let _needsPermission = false;// handle restored but its readwrite grant lapsed
                               // (File System Access permissions reset on reload)

  // Outstanding conflicts the user needs to resolve. Kept in-memory only —
  // a fresh page-load forces a re-sync that re-detects them, so we don't
  // bother persisting (and risk surfacing stale ones). Each entry:
  //   {itemId, path, name, appContent, diskContent, diskMtime, ts}
  let _conflicts = [];
  function _emitConflicts(){ _conflictListeners.forEach(cb => { try { cb([..._conflicts]); } catch(e){} }); }

  function _loadState() {
    try {
      const raw = localStorage.getItem(SYNC_KEY);
      if (raw) _state = Object.assign(_state, JSON.parse(raw));
    } catch(e){}
  }
  function _saveState() {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(_state)); } catch(e){}
  }
  function _emit() { _statusListeners.forEach(fn => { try { fn(getStatus()); } catch(e){} }); }

  // ─── Hashing ──────────────────────────────────────────────────────────────
  // FNV-1a 32-bit; plenty for "did the content change" comparisons.
  function _hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  }

  // ─── Path helpers ─────────────────────────────────────────────────────────
  // Build the disk-relative path for an app item ("Folder/Sub/File.md").
  function _itemPath(item, allItems) {
    const parts = [];
    let cur = item;
    while (cur) {
      parts.unshift(cur.type === 'file' ? (cur.name + '.md') : cur.name);
      cur = cur.parent ? allItems.find(x => x.id === cur.parent) : null;
    }
    return parts.join('/');
  }

  // Map: app id → relative path. Skip orphans whose parent doesn't exist.
  function _buildPathMap(items) {
    const map = {};
    items.forEach(it => {
      try {
        let cur = it;
        while (cur && cur.parent) {
          if (!items.find(x => x.id === cur.parent)) return; // orphan
          cur = items.find(x => x.id === cur.parent);
        }
        map[it.id] = _itemPath(it, items);
      } catch(e){}
    });
    return map;
  }

  // ─── Filesystem walk ──────────────────────────────────────────────────────
  // Return a flat list of {path, handle, mtime, content} for every .md file in
  // the vault, plus a Set of every directory path encountered.
  async function _walkVault() {
    if (!_vaultHandle) return null;
    const files = [];
    const dirs = new Set();
    async function walk(dirHandle, prefix) {
      for await (const [name, entry] of dirHandle.entries()) {
        if (name.startsWith('.')) continue;            // skip .obsidian, .DS_Store
        const path = prefix ? prefix + '/' + name : name;
        if (entry.kind === 'directory') {
          dirs.add(path);
          await walk(entry, path);
        } else if (entry.kind === 'file' && name.toLowerCase().endsWith('.md')) {
          const file = await entry.getFile();
          const text = await file.text();
          files.push({ path, name: name.slice(0, -3), mtime: file.lastModified, content: text, handle: entry });
        }
      }
    }
    await walk(_vaultHandle, '');
    return { files, dirs };
  }

  async function _ensureDir(parts) {
    let cur = _vaultHandle;
    for (const p of parts) {
      cur = await cur.getDirectoryHandle(p, { create: true });
    }
    return cur;
  }

  async function _writeFile(relPath, content) {
    const parts = relPath.split('/');
    const fileName = parts.pop();
    const dir = parts.length ? await _ensureDir(parts) : _vaultHandle;
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
    const f = await fh.getFile();
    return f.lastModified;
  }

  async function _deleteFile(relPath) {
    const parts = relPath.split('/');
    const fileName = parts.pop();
    let dir = _vaultHandle;
    try {
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: false });
      await dir.removeEntry(fileName);
    } catch(e) { /* missing → fine */ }
  }

  // ─── Permission helpers ───────────────────────────────────────────────────
  async function _ensurePermission() {
    if (!_vaultHandle) return false;
    const opts = { mode: 'readwrite' };
    if ((await _vaultHandle.queryPermission(opts)) === 'granted') {
      if (_needsPermission) { _needsPermission = false; _emit(); }
      return true;
    }
    // requestPermission() only opens a dialog inside a user gesture. Called
    // from the poll timer there's no gesture, so it resolves 'prompt' without
    // prompting — and may throw in some engines. Either way, surface the lapse
    // so the pill can offer a manual "grant access" click (which IS a gesture).
    let granted = false;
    try { granted = (await _vaultHandle.requestPermission(opts)) === 'granted'; } catch(e) { granted = false; }
    if (granted) {
      if (_needsPermission) { _needsPermission = false; _emit(); }
      return true;
    }
    if (!_needsPermission) { _needsPermission = true; _emit(); }
    return false;
  }

  // Re-request the readwrite grant. MUST be called from a user gesture (the
  // vault pill's click handler) so the browser actually shows the permission
  // dialog. Clears the needsPermission flag on success.
  async function requestAccess() {
    if (!_vaultHandle) return false;
    const ok = await _ensurePermission();
    _emit();
    return ok;
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  async function init(editingProvider) {
    if (typeof editingProvider === 'function') _editingProvider = editingProvider;
    _loadState();
    if (!isSupported()) return;
    try {
      const handle = await _idbGet(HANDLE_ID);
      if (handle) {
        _vaultHandle = handle;
        // File System Access permission grants do NOT survive a page reload —
        // the handle persists in IndexedDB but its readwrite permission resets
        // to 'prompt'. Re-requesting needs a user gesture, so we can't do it
        // here on load. Detect the lapsed grant up front and flag it; without
        // this the pill claims "connected" while every poll-driven sync silently
        // no-ops (requestPermission outside a gesture never shows a dialog).
        try {
          const perm = await _vaultHandle.queryPermission({ mode: 'readwrite' });
          _needsPermission = (perm !== 'granted');
        } catch(e) { _needsPermission = true; }
      }
    } catch(e){}
    _emit();
  }

  function isSupported() {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }
  function isConnected() {
    return !!_vaultHandle;
  }
  function getStatus() {
    return {
      supported: isSupported(),
      connected: isConnected(),
      vaultName: _state.vaultName || (_vaultHandle && _vaultHandle.name) || null,
      lastSync:  _state.lastSync,
      busy:      _busy,
      needsPermission: _needsPermission,
    };
  }
  function onStatus(fn) { _statusListeners.add(fn); return () => _statusListeners.delete(fn); }

  async function connect() {
    if (!isSupported()) {
      showToast('Vault sync requires Chrome, Edge, or Opera');
      return false;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
    } catch(e) { return false; } // user cancelled
    _vaultHandle = handle;
    _state.vaultName = handle.name;
    _saveState();
    try { await _idbSet(HANDLE_ID, handle); } catch(e){}
    _emit();
    showToast('Vault connected: ' + handle.name);
    return true;
  }

  async function disconnect() {
    _vaultHandle = null;
    _state = { vaultName: null, pathToId: {}, fileMeta: {}, lastSync: 0 };
    _saveState();
    try { await _idbDel(HANDLE_ID); } catch(e){}
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    _emit();
    showToast('Vault disconnected');
  }

  // Reconcile both sides. Called after connect, after structural edits, or
  // on the periodic poll. `data` is the full notes data object; we mutate it
  // in place and return whether anything changed.
  async function fullSync(data, opts) {
    opts = opts || {};
    if (!_vaultHandle) return false;
    if (!(await _ensurePermission())) { _emit(); return false; }
    if (_busy) return false;
    if (_editingProvider && _editingProvider() && !opts.force) return false; // pause while typing
    _busy = true; _emit();
    let changed = false;
    try {
      const walk = await _walkVault();
      if (!walk) return false;

      const pathToFile = new Map(walk.files.map(f => [f.path, f]));
      const items = data.items;
      const idToPath = _buildPathMap(items);
      const pathToItem = new Map();
      Object.entries(idToPath).forEach(([id, path]) => {
        const it = items.find(x => x.id === id);
        if (it && it.type === 'file') pathToItem.set(path, it);
      });

      // 1) Files present in app but missing from disk
      for (const [path, item] of pathToItem) {
        if (pathToFile.has(path)) continue;
        const meta = _state.fileMeta[item.id];
        if (meta && meta.path === path) {
          // Was synced before, now missing on disk → user deleted on disk
          // → delete from app.
          const idx = items.findIndex(x => x.id === item.id);
          if (idx >= 0) items.splice(idx, 1);
          delete _state.fileMeta[item.id];
          delete _state.pathToId[path];
          changed = true;
        } else {
          // Brand-new app file → push to disk
          const mtime = await _writeFile(path, item.content || '');
          _state.fileMeta[item.id] = { mtime, hash: _hash(item.content || ''), path };
          _state.pathToId[path] = item.id;
        }
      }

      // 2) Files present on disk but not in app (or both)
      for (const [path, df] of pathToFile) {
        const existingItem = pathToItem.get(path);
        if (!existingItem) {
          // Disk-only → bring into app
          const id = _state.pathToId[path];
          const meta = id ? _state.fileMeta[id] : null;
          if (id && meta) {
            // Was synced before, missing in app → user deleted in app → delete from disk
            await _deleteFile(path);
            delete _state.fileMeta[id];
            delete _state.pathToId[path];
            continue;
          }
          // Genuine new disk file → create app entries
          const parts = path.split('/');
          const fileName = parts.pop().replace(/\.md$/i, '');
          // Ensure folder chain exists in app
          let parent = null;
          let prefix = '';
          for (const p of parts) {
            prefix = prefix ? prefix + '/' + p : p;
            let folder = items.find(x => x.type === 'folder' && _itemPath(x, items) === prefix);
            if (!folder) {
              folder = { id: 'f_' + uid(), type: 'folder', name: p, parent, expanded: true };
              items.push(folder);
            }
            parent = folder.id;
          }
          const newId = 'n_' + uid();
          const newItem = { id: newId, type: 'file', name: fileName, parent, content: df.content, lineAuthors: [] };
          items.push(newItem);
          _state.fileMeta[newId] = { mtime: df.mtime, hash: _hash(df.content), path };
          _state.pathToId[path] = newId;
          changed = true;
        } else {
          // Both sides have it → reconcile.
          // The last-known-good state for this file is `meta` — what we
          // recorded the last time the two sides agreed. Three independent
          // signals tell us what changed since then:
          //   diskChanged = disk hash differs from meta hash
          //   appChanged  = app hash differs from meta hash
          //   diskNewer   = file mtime moved forward past the recorded one
          const meta = _state.fileMeta[existingItem.id] || { mtime: 0, hash: '' };
          const diskHash = _hash(df.content);
          const appHash  = _hash(existingItem.content || '');
          const diskChanged = diskHash !== meta.hash;
          const appChanged  = appHash  !== meta.hash;
          const diskNewer   = df.mtime > meta.mtime + 500;

          // Skip files the user already has a pending conflict on — don't
          // re-process until they resolve it.
          if (_conflicts.some(c => c.itemId === existingItem.id)){
            // pass
          } else if (diskHash === appHash) {
            // No-op: both sides match, just refresh meta.
            _state.fileMeta[existingItem.id] = { mtime: df.mtime, hash: diskHash, path };
            _state.pathToId[path] = existingItem.id;
          } else if (diskChanged && appChanged) {
            // Both sides edited since last agreement — this is the
            // genuine conflict case. Queue it for the UI to resolve and
            // skip auto-merge so neither side gets clobbered.
            _conflicts.push({
              itemId: existingItem.id,
              path,
              name: existingItem.name || path.split('/').pop().replace(/\.md$/, ''),
              appContent: existingItem.content || '',
              diskContent: df.content,
              diskMtime: df.mtime,
              ts: Date.now(),
            });
            console.warn('[notes-sync] conflict queued for', path);
          } else if (diskChanged || diskNewer) {
            // Only disk changed (or mtime says disk wins for first-touch
            // cases where meta is fresh) → take disk version.
            existingItem.content = df.content;
            existingItem.lineAuthors = []; // no author info from disk
            _state.fileMeta[existingItem.id] = { mtime: df.mtime, hash: diskHash, path };
            _state.pathToId[path] = existingItem.id;
            changed = true;
            console.info('[notes-sync] disk → app:', path);
          } else if (appChanged) {
            // Only app changed → push to disk.
            const newMtime = await _writeFile(path, existingItem.content || '');
            _state.fileMeta[existingItem.id] = { mtime: newMtime, hash: appHash, path };
            _state.pathToId[path] = existingItem.id;
            console.info('[notes-sync] app → disk:', path);
          }
        }
      }

      _state.lastSync = Date.now();
      _saveState();
    } catch (e) {
      console.error('[notes-sync] fullSync failed', e);
    } finally {
      _busy = false; _emit();
      _emitConflicts();
    }
    return changed;
  }

  // Debounced single-file push. Used after an in-app edit lands.
  function pushFile(item, allItems) {
    if (!_vaultHandle || item.type !== 'file') return;
    const id = item.id;
    if (_pushTimers.has(id)) clearTimeout(_pushTimers.get(id).timer);
    // Keep the work as a named closure (not just a bare setTimeout) so
    // flushPending() can fire it immediately when the page is hiding.
    const run = async () => {
      _pushTimers.delete(id);
      if (!(await _ensurePermission())) return;
      try {
        const path = _itemPath(item, allItems);
        // Write the new path FIRST, then delete the old one on rename/move.
        // Delete-before-write meant a failed write (permission revoked, disk
        // full) left no copy on disk at all — the old file was already gone.
        const oldMeta = _state.fileMeta[id];
        const mtime = await _writeFile(path, item.content || '');
        if (oldMeta && oldMeta.path && oldMeta.path !== path) {
          try { await _deleteFile(oldMeta.path); } catch (e) { /* stale copy is recoverable; the new path is canonical */ }
          delete _state.pathToId[oldMeta.path];
        }
        _state.fileMeta[id] = { mtime, hash: _hash(item.content || ''), path };
        _state.pathToId[path] = id;
        _state.lastSync = Date.now();
        _saveState();
      } catch (e) {
        console.error('[notes-sync] pushFile failed', e);
      }
    };
    _pushTimers.set(id, { timer: setTimeout(run, PUSH_DEBOUNCE_MS), run });
  }

  // Fire every queued debounced push NOW instead of waiting out the 800 ms
  // window. Called on tab hide / panel unmount so a write isn't silently lost
  // when the page closes inside the debounce window (localStorage already has
  // it, but the on-disk vault copy would otherwise lag a tick behind).
  function flushPending() {
    if (!_pushTimers.size) return;
    // Snapshot the runs first — each run() deletes its own _pushTimers entry.
    const runs = [];
    _pushTimers.forEach(v => { clearTimeout(v.timer); runs.push(v.run); });
    runs.forEach(run => { try { run(); } catch(e){} });
  }

  // Periodic poll loop. Started via startPolling(getDataFn).
  function startPolling(getData) {
    if (_pollTimer) return;
    _pollTimer = setInterval(async () => {
      if (!_vaultHandle) return;
      const data = getData();
      if (!data) return;
      const changed = await fullSync(data);
      if (changed && typeof window.notesSync._onPullCallback === 'function') {
        window.notesSync._onPullCallback();
      }
    }, POLL_MS);
  }
  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // Subscribe to conflict-list changes. Callback receives a snapshot
  // array on subscribe + every change. Returns unsubscribe.
  function onConflict(cb){
    _conflictListeners.add(cb);
    try { cb([..._conflicts]); } catch(e){}
    return () => _conflictListeners.delete(cb);
  }

  function getConflicts(){ return [..._conflicts]; }

  // Resolve a queued conflict. `choice` is 'app' (keep current in-app
  // content and overwrite disk), 'disk' (take disk version and replace
  // app content), or 'manual' (caller provides `manualContent` which
  // overwrites both sides). After resolution the conflict is removed
  // from the queue and the chosen content is written through normally.
  async function resolveConflict(itemId, choice, opts){
    const c = _conflicts.find(x => x.itemId === itemId);
    if (!c) return false;
    const data = opts && opts.data;            // notes data ref to mutate the item directly
    const item = data && data.items && data.items.find(i => i.id === itemId);
    let finalContent;
    if (choice === 'app')         finalContent = c.appContent;
    else if (choice === 'manual') finalContent = (opts && typeof opts.manualContent === 'string') ? opts.manualContent : c.appContent;
    else                          finalContent = c.diskContent;
    if (item){
      item.content = finalContent;
      if (choice === 'disk') item.lineAuthors = [];
    }
    // Push the resolved content to disk and update meta so future syncs
    // start fresh.
    try {
      if (!(await _ensurePermission())) return false;
      const mtime = await _writeFile(c.path, finalContent);
      _state.fileMeta[itemId] = { mtime, hash: _hash(finalContent), path: c.path };
      _state.pathToId[c.path] = itemId;
      _state.lastSync = Date.now();
      _saveState();
    } catch(e){ console.error('[notes-sync] resolveConflict write failed', e); }
    _conflicts = _conflicts.filter(x => x.itemId !== itemId);
    _emitConflicts();
    _emit();
    return true;
  }

  // Expose
  window.notesSync = {
    init, isSupported, isConnected, getStatus, onStatus, requestAccess,
    connect, disconnect, fullSync, pushFile, flushPending,
    startPolling, stopPolling,
    onConflict, getConflicts, resolveConflict,
    _onPullCallback: null,         // notes panel sets this to re-render after disk → app
  };
})();
