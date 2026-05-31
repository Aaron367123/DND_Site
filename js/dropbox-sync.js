// ============================================================
// NOTES — DROPBOX SYNC (single shared account, HTTP API)
// ============================================================
// Mirrors the public API surface of notes-sync.js so the Session
// Notes panel can call either adapter with the same method names.
//
// Auth model: one long-lived access token pasted into
// js/dropbox-config.js. There is no per-user OAuth — every browser
// that loads the page is "logged in" as the shared account.
//
// Sync model: same as notes-sync.js — last-write-wins, 8 s poll for
// incoming changes, 800 ms debounce for outgoing edits.

(function() {
  'use strict';

  const STATE_KEY = 'skt-dropbox-sync-v1';
  const POLL_MS = 8000;
  const PUSH_DEBOUNCE_MS = 800;
  const API  = 'https://api.dropboxapi.com/2';
  const CONT = 'https://content.dropboxapi.com/2';

  // ─── State ────────────────────────────────────────────────────────────────
  let _state = {
    cursor: null,       // for list_folder/continue incremental polling
    fileRevs: {},       // path_lower → Dropbox rev string
    lastSync: 0,
  };
  let _pushTimers = new Map();
  let _pollTimer = null;
  let _statusListeners = new Set();
  let _busy = false;
  let _editingProvider = null;
  let _connectError = null;  // string explaining the last hard failure
  // Cached short-lived access token + its expiry timestamp (ms). Minted
  // from the refresh token on demand and re-minted ~30 s before expiry.
  let _accessToken = null;
  let _accessTokenExpiry = 0;
  let _refreshPromise = null; // dedupe concurrent refreshes

  function _loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) _state = Object.assign(_state, JSON.parse(raw));
    } catch(e){}
  }
  function _saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(_state)); } catch(e){}
  }
  function _emit() { _statusListeners.forEach(fn => { try { fn(getStatus()); } catch(e){} }); }

  function _appKey() {
    return (window.DROPBOX_CONFIG && window.DROPBOX_CONFIG.appKey) || '';
  }
  function _refreshToken() {
    return (window.DROPBOX_CONFIG && window.DROPBOX_CONFIG.refreshToken) || '';
  }
  function _notesPath() {
    let p = (window.DROPBOX_CONFIG && window.DROPBOX_CONFIG.notesPath) || '';
    if (p && !p.startsWith('/')) p = '/' + p;
    if (p.endsWith('/')) p = p.slice(0, -1);
    return p; // '' or '/sub'
  }

  // ─── Public state helpers ─────────────────────────────────────────────────
  function isConfigured() {
    const k = _appKey();
    const r = _refreshToken();
    return !!k && !!r &&
           k !== 'PASTE_YOUR_APP_KEY_HERE' &&
           r !== 'PASTE_YOUR_REFRESH_TOKEN_HERE';
  }
  function isConnected() {
    // No persistent connect step — configured ⇒ connected (until a 401).
    return isConfigured() && !_connectError;
  }

  // Trade the refresh token for a fresh access token. Cached for ~3.5 h.
  // Concurrent callers share one in-flight refresh via _refreshPromise.
  async function _ensureAccessToken() {
    if (!isConfigured()) throw new Error('Dropbox not configured');
    const now = Date.now();
    if (_accessToken && now < _accessTokenExpiry - 30_000) return _accessToken;
    if (_refreshPromise) return _refreshPromise;
    _refreshPromise = (async () => {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: _refreshToken(),
        client_id: _appKey(),
      });
      const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        const text = await res.text();
        _connectError = 'Dropbox token refresh failed (' + res.status + ')';
        _emit();
        if (typeof showToast === 'function') showToast('Dropbox auth failed — re-run dropbox-auth.html');
        throw new Error('refresh ' + res.status + ': ' + text);
      }
      const j = await res.json();
      _accessToken = j.access_token;
      _accessTokenExpiry = Date.now() + (j.expires_in || 14400) * 1000;
      _connectError = null;
      _emit();
      return _accessToken;
    })();
    try { return await _refreshPromise; }
    finally { _refreshPromise = null; }
  }
  function isSupported() { return true; } // works in any modern browser
  function getStatus() {
    return {
      configured: isConfigured(),
      supported: true,
      connected: isConnected(),
      busy: _busy,
      lastSync: _state.lastSync,
      vaultName: 'Dropbox' + (_notesPath() || ''),
      error: _connectError,
    };
  }
  function onStatus(cb) { _statusListeners.add(cb); return () => _statusListeners.delete(cb); }
  function init(isEditingFn) {
    _editingProvider = (typeof isEditingFn === 'function') ? isEditingFn : null;
    _loadState();
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────
  // A 401 mid-flight means the cached access token expired between our
  // freshness check and the actual request — refresh once and retry.
  async function _retryOn401(makeReq) {
    let res = await makeReq();
    if (res.status === 401) {
      _accessToken = null; _accessTokenExpiry = 0;
      await _ensureAccessToken();
      res = await makeReq();
    }
    return res;
  }
  async function _api(endpoint, body) {
    if (!isConfigured()) throw new Error('Dropbox not configured');
    await _ensureAccessToken();
    const res = await _retryOn401(() => fetch(API + endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + _accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || null),
    }));
    if (res.status === 401) {
      _connectError = 'Dropbox token rejected';
      _emit();
      if (typeof showToast === 'function') showToast('Dropbox token rejected — re-run dropbox-auth.html');
      throw new Error('Dropbox 401');
    }
    if (res.status === 429) {
      const retry = parseInt(res.headers.get('Retry-After')) || 5;
      await new Promise(r => setTimeout(r, retry * 1000));
      return _api(endpoint, body);
    }
    if (!res.ok) {
      const text = await res.text();
      // Surface the body to the console so 400s tell us *why* Dropbox said no
      // (path format, missing param, scope mismatch, etc.). The throw still
      // propagates for callers that want to handle specific cases.
      console.error('[dropboxSync] ' + endpoint + ' ' + res.status + ':', text, 'body sent:', body);
      throw new Error('Dropbox ' + endpoint + ' ' + res.status + ': ' + text);
    }
    if (res.status === 204) return null;
    return res.json();
  }
  async function _download(path) {
    if (!isConfigured()) throw new Error('Dropbox not configured');
    await _ensureAccessToken();
    const res = await _retryOn401(() => fetch(CONT + '/files/download', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + _accessToken,
        'Dropbox-API-Arg': JSON.stringify({ path }),
      },
    }));
    if (res.status === 409) return null; // not found
    if (!res.ok) throw new Error('download ' + res.status);
    return res.text();
  }
  async function _upload(path, content) {
    if (!isConfigured()) throw new Error('Dropbox not configured');
    await _ensureAccessToken();
    const res = await _retryOn401(() => fetch(CONT + '/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + _accessToken,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path,
          mode: 'overwrite',
          autorename: false,
          mute: true,
          strict_conflict: false,
        }),
      },
      body: content,
    }));
    if (!res.ok) {
      const text = await res.text();
      throw new Error('upload ' + res.status + ': ' + text);
    }
    return res.json(); // returns the new entry with `rev`
  }

  // ─── Path / item helpers ──────────────────────────────────────────────────
  function _buildPath(item, items, ext) {
    // Walk up ancestors to build /<notesPath>/folder/folder/name(.md)
    const parts = [];
    let cur = item;
    const byId = new Map(items.map(i => [i.id, i]));
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
    const base = _notesPath();
    let path = (base ? base : '') + '/' + parts.join('/');
    if (ext && !path.toLowerCase().endsWith(ext)) path += ext;
    return path;
  }
  function _findItemByPath(path, items) {
    // path is like '/Sessions/Session 1.md' or '/Sessions' (folder)
    const np = _notesPath();
    let rel = path;
    if (np && path.toLowerCase().startsWith(np.toLowerCase())) rel = path.slice(np.length);
    rel = rel.replace(/^\/+/, '');
    const parts = rel.split('/');
    if (!parts.length) return null;
    const byId = new Map(items.map(i => [i.id, i]));
    let parent = null;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      // Files: last part may have .md; strip for the item name match
      const baseName = isLast ? name.replace(/\.md$/i, '') : name;
      const match = items.find(it =>
        (it.parent || null) === (parent ? parent.id : null) &&
        it.name === baseName);
      if (!match) return null;
      if (isLast) return match;
      parent = match;
    }
    return null;
  }
  function _ensureFolderChain(parts, items) {
    // Ensure folder items exist for each segment in `parts`. Mutates items[].
    let parentId = null;
    for (const name of parts) {
      let folder = items.find(it => it.type === 'folder' && it.name === name && (it.parent || null) === parentId);
      if (!folder) {
        folder = { id: 'f_' + (typeof uid === 'function' ? uid() : Math.random().toString(36).slice(2)),
                   type: 'folder', name, parent: parentId, expanded: true };
        items.push(folder);
      }
      parentId = folder.id;
    }
    return parentId;
  }

  // ─── Full sync (initial connect + refresh) ────────────────────────────────
  async function fullSync(data, opts) {
    if (!isConfigured()) return;
    if (_busy && !(opts && opts.force)) return;
    _busy = true; _emit();
    try {
      _connectError = null;
      const np = _notesPath();
      let entries = [];
      let cursor = null, hasMore = true, path = np || '';
      // Recursive listing
      let resp;
      try {
        resp = await _api('/files/list_folder', { path, recursive: true, include_deleted: false });
      } catch(e) {
        // Folder doesn't exist yet — treat as empty.
        if (String(e.message).includes('not_found')) {
          resp = { entries: [], cursor: null, has_more: false };
        } else {
          throw e;
        }
      }
      entries = entries.concat(resp.entries || []);
      cursor = resp.cursor; hasMore = resp.has_more;
      while (hasMore) {
        resp = await _api('/files/list_folder/continue', { cursor });
        entries = entries.concat(resp.entries || []);
        cursor = resp.cursor; hasMore = resp.has_more;
      }
      // Merge Dropbox truth into the existing local items, instead of
      // replacing wholesale. This is critical on first connect when the
      // user already has local files: replacing would wipe them before
      // they ever get uploaded. The rules:
      //   1. For each Dropbox folder/file, ensure a matching local item
      //      exists (create if missing).
      //   2. For each Dropbox file, if its rev changed (or it's new),
      //      download content and apply.
      //   3. After merging Dropbox-in, push any local files that Dropbox
      //      didn't have up to Dropbox — they're presumed to be locally
      //      created and not yet synced.
      if (!Array.isArray(data.items)) data.items = [];
      const items = data.items;
      const folders = entries.filter(e => e['.tag'] === 'folder');
      const files   = entries.filter(e => e['.tag'] === 'file' && /\.md$/i.test(e.name));
      const fileRevs = Object.assign({}, _state.fileRevs || {});
      const seenLocalIds = new Set(); // local items confirmed present in Dropbox

      // Pass 1: ensure Dropbox folders exist locally.
      for (const f of folders) {
        const rel = f.path_display.slice((np || '').length).replace(/^\//, '');
        const parts = rel ? rel.split('/') : [];
        if (!parts.length) continue;
        const parentParts = parts.slice(0, -1);
        const parentId = parentParts.length ? _ensureFolderChain(parentParts, items) : null;
        const name = parts[parts.length - 1];
        let existing = items.find(it => it.type === 'folder' && it.name === name && (it.parent || null) === parentId);
        if (!existing) {
          existing = {
            id: 'f_' + (typeof uid === 'function' ? uid() : Math.random().toString(36).slice(2)),
            type: 'folder', name, parent: parentId, expanded: true,
          };
          items.push(existing);
        }
        seenLocalIds.add(existing.id);
      }

      // Pass 2: ensure Dropbox files exist locally + download fresh content
      // when their rev has changed. Collect work to download in parallel.
      // First — if a file is in our pendingDeletes set (a previous delete
      // failed), re-attempt the delete instead of re-creating it locally.
      // This is the self-heal path for "file keeps reappearing after I
      // deleted it" — the user shouldn't have to manually delete twice.
      const pending = _state.pendingDeletes || {};
      const filesToFetch = [];
      for (const f of files) {
        if (pending[f.path_lower]){
          // Retry the delete in the background. If it succeeds the next
          // fullSync won't see the file. Capped at 5 attempts.
          const attempts = (pending[f.path_lower].attempts || 0);
          if (attempts < 5){
            deletePath(f.path_display).catch(()=>{});
            continue; // skip creating a local entry for it
          } else {
            // Give up — surface and let the user clear it via Dropbox UI.
            console.warn('[dropboxSync] gave up on pending delete after 5 attempts:', f.path_display);
            delete pending[f.path_lower];
          }
        }
        const rel = f.path_display.slice((np || '').length).replace(/^\//, '');
        const parts = rel.split('/');
        const parentParts = parts.slice(0, -1);
        const parentId = parentParts.length ? _ensureFolderChain(parentParts, items) : null;
        const baseName = parts[parts.length - 1].replace(/\.md$/i, '');
        let existing = items.find(it => it.type === 'file' && it.name === baseName && (it.parent || null) === parentId);
        if (!existing) {
          existing = {
            id: 'n_' + (typeof uid === 'function' ? uid() : Math.random().toString(36).slice(2)),
            type: 'file', name: baseName, parent: parentId, content: '', lineAuthors: [],
          };
          items.push(existing);
        }
        seenLocalIds.add(existing.id);
        // Track that we've seen the folder chain too so they don't get
        // misclassified as local-only later.
        let p = existing.parent;
        while (p){
          const f2 = items.find(it => it.id === p);
          if (!f2) break;
          seenLocalIds.add(f2.id);
          p = f2.parent;
        }
        const prevRev = _state.fileRevs && _state.fileRevs[f.path_lower];
        if (prevRev !== f.rev) {
          filesToFetch.push({ item: existing, path: f.path_lower, rev: f.rev });
        } else {
          fileRevs[f.path_lower] = f.rev;
        }
      }
      const CONCURRENCY = 5;
      let cursor2 = 0;
      async function worker() {
        while (cursor2 < filesToFetch.length) {
          const idx = cursor2++;
          const { item, path, rev } = filesToFetch[idx];
          try {
            const text = await _download(path);
            if (text != null) item.content = text;
            fileRevs[path] = rev;
          } catch(e) { /* leave existing content on failure */ }
        }
      }
      await Promise.all(Array.from({length: Math.min(CONCURRENCY, filesToFetch.length)}, worker));

      // Pass 3: push local-only files up to Dropbox. These are files that
      // exist locally but don't appear in the Dropbox listing — typically
      // created in this app session before Dropbox was reachable. Folders
      // get created implicitly when their files upload.
      const localOnlyFiles = items.filter(it => it.type === 'file' && !seenLocalIds.has(it.id));
      for (const f of localOnlyFiles) {
        pushFile(f, items); // debounced individually; fires within 800 ms
      }

      // Ensure selectedId still points at a real file.
      if (!data.selectedId || !items.find(i => i.id === data.selectedId)){
        data.selectedId = (items.find(i => i.type === 'file') || {}).id || null;
      }
      _state.cursor = cursor;
      _state.fileRevs = fileRevs;
      _state.lastSync = Date.now();
      _saveState();
      // Persist the merged model to local storage too.
      try { localStorage.setItem('skt-notes-v2', JSON.stringify(data)); } catch(e){}
    } finally {
      _busy = false; _emit();
    }
  }

  // ─── Incremental poll ─────────────────────────────────────────────────────
  async function _pollOnce(getData) {
    if (!isConfigured() || !_state.cursor) return;
    if (_editingProvider && _editingProvider()) return; // skip — user mid-edit
    const data = getData(); if (!data || !Array.isArray(data.items)) return;
    let resp;
    try {
      resp = await _api('/files/list_folder/continue', { cursor: _state.cursor });
    } catch(e) {
      // Cursor expired or other failure — recover with a full sync next tick.
      _state.cursor = null; _saveState();
      return;
    }
    let changed = false;
    for (const entry of (resp.entries || [])) {
      const tag = entry['.tag'];
      if (tag === 'deleted') {
        // Remove items whose path matches.
        const item = _findItemByPath(entry.path_display, data.items);
        if (item) {
          const toDelete = new Set([item.id]);
          // Sweep descendants
          let more = true;
          while (more) {
            more = false;
            data.items.forEach(x => {
              if (x.parent && toDelete.has(x.parent) && !toDelete.has(x.id)) { toDelete.add(x.id); more = true; }
            });
          }
          data.items = data.items.filter(x => !toDelete.has(x.id));
          delete _state.fileRevs[(entry.path_lower || '')];
          changed = true;
        }
      } else if (tag === 'folder') {
        const existing = _findItemByPath(entry.path_display, data.items);
        if (!existing) {
          const np = _notesPath();
          const rel = entry.path_display.slice((np || '').length).replace(/^\//, '');
          const parts = rel.split('/');
          _ensureFolderChain(parts, data.items);
          changed = true;
        }
      } else if (tag === 'file' && /\.md$/i.test(entry.name)) {
        const prevRev = _state.fileRevs[entry.path_lower];
        if (prevRev === entry.rev) continue; // already current
        // Pending-delete guard: a previous delete request failed and the
        // file still sits on Dropbox. Re-attempt the delete instead of
        // re-creating it locally so the user's intent (a delete) wins.
        if (_state.pendingDeletes && _state.pendingDeletes[entry.path_lower]){
          deletePath(entry.path_display).catch(()=>{});
          continue;
        }
        let item = _findItemByPath(entry.path_display, data.items);
        if (!item) {
          // New file from outside — create item under its folder chain.
          const np = _notesPath();
          const rel = entry.path_display.slice((np || '').length).replace(/^\//, '');
          const parts = rel.split('/');
          const parentParts = parts.slice(0, -1);
          const parentId = parentParts.length ? _ensureFolderChain(parentParts, data.items) : null;
          const baseName = parts[parts.length-1].replace(/\.md$/i, '');
          item = {
            id: 'n_' + (typeof uid === 'function' ? uid() : Math.random().toString(36).slice(2)),
            type: 'file', name: baseName, parent: parentId, content: '', lineAuthors: [],
          };
          data.items.push(item);
        }
        try {
          const text = await _download(entry.path_lower);
          if (text != null) item.content = text;
        } catch(e) {}
        _state.fileRevs[entry.path_lower] = entry.rev;
        changed = true;
      }
    }
    _state.cursor = resp.cursor || _state.cursor;
    _state.lastSync = Date.now();
    _saveState();
    if (changed) {
      try { localStorage.setItem('skt-notes-v2', JSON.stringify(data)); } catch(e){}
      if (typeof window.dropboxSync._onPullCallback === 'function') {
        try { window.dropboxSync._onPullCallback(); } catch(e){}
      }
    }
  }

  function startPolling(getData) {
    stopPolling();
    if (!isConfigured()) return;
    _pollTimer = setInterval(() => { _pollOnce(getData).catch(() => {}); }, POLL_MS);
  }
  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ─── Push (single file upload, debounced) ─────────────────────────────────
  function pushFile(file, items) {
    if (!isConfigured() || !file) return;
    if (_pushTimers.has(file.id)) clearTimeout(_pushTimers.get(file.id));
    const t = setTimeout(async () => {
      _pushTimers.delete(file.id);
      try {
        const path = _buildPath(file, items, '.md');
        const res = await _upload(path, file.content || '');
        if (res && res.rev) _state.fileRevs[(res.path_lower || path.toLowerCase())] = res.rev;
        _state.lastSync = Date.now();
        _saveState();
      } catch(e) { /* swallow — next sync tick will retry indirectly */ }
    }, PUSH_DEBOUNCE_MS);
    _pushTimers.set(file.id, t);
  }

  // ─── Delete / move (propagate panel mutations to Dropbox) ─────────────────
  async function deletePath(path) {
    if (!isConfigured() || !path) return;
    try {
      await _api('/files/delete_v2', { path });
      delete _state.fileRevs[path.toLowerCase()];
      // Remember the deletion so a poll that races in BEFORE this delete
      // reaches the cursor stream doesn't resurrect the file. Cleared on
      // confirmed delete event, or on a successful re-delete.
      delete (_state.pendingDeletes || {})[path.toLowerCase()];
      _saveState();
      console.log('[dropboxSync] deleted', path);
    } catch (e) {
      const msg = String(e.message);
      // path/not_found means the file was already gone — silent success.
      if (msg.includes('not_found')) {
        delete _state.fileRevs[path.toLowerCase()];
        _saveState();
        return;
      }
      console.error('[dropboxSync] delete failed', path, msg);
      if (typeof showToast === 'function'){
        showToast('Dropbox delete failed for ' + path + ' — check console. Will retry.');
      }
      // Track for retry — next poll re-attempts. Without this, the file
      // stays on Dropbox and reappears locally on the next fullSync().
      if (!_state.pendingDeletes) _state.pendingDeletes = {};
      _state.pendingDeletes[path.toLowerCase()] = { path, ts: Date.now(), attempts: ((_state.pendingDeletes[path.toLowerCase()]||{}).attempts || 0) + 1 };
      _saveState();
      // Don't re-throw — callers are fire-and-forget. The retry stash +
      // toast already surface the failure, and a thrown rejection here
      // just spams the console with "Uncaught (in promise)".
    }
  }
  async function movePath(fromPath, toPath) {
    if (!isConfigured() || !fromPath || !toPath || fromPath === toPath) return;
    try {
      const res = await _api('/files/move_v2', {
        from_path: fromPath, to_path: toPath,
        allow_shared_folder: false, autorename: false, allow_ownership_transfer: false,
      });
      const oldKey = fromPath.toLowerCase(), newKey = toPath.toLowerCase();
      if (_state.fileRevs[oldKey]){
        _state.fileRevs[newKey] = _state.fileRevs[oldKey];
        delete _state.fileRevs[oldKey];
      } else if (res && res.metadata && res.metadata.rev){
        _state.fileRevs[newKey] = res.metadata.rev;
      }
      _saveState();
    } catch (e) {
      console.error('[dropboxSync] move failed', fromPath, '→', toPath, e.message);
    }
  }

  // ─── Expose ───────────────────────────────────────────────────────────────
  window.dropboxSync = {
    init, isConfigured, isConnected, isSupported, getStatus, onStatus,
    fullSync, pushFile, deletePath, movePath, startPolling, stopPolling,
    // buildPath is useful for callers that need to compute a Dropbox path
    // from an item + items[] (e.g. notes panel capturing path before
    // deletion). Exposes the same private helper used internally.
    buildPath: (item, items, ext) => _buildPath(item, items, ext),
    _onPullCallback: null,
  };
})();
