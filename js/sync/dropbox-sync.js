// ============================================================
// NOTES — DROPBOX SYNC (single shared account, HTTP API)
// ============================================================
// Mirrors the public API surface of notes-sync.js so the Session
// Notes panel can call either adapter with the same method names.
//
// Auth model: one long-lived access token pasted into
// js/sync/dropbox-config.js. There is no per-user OAuth — every browser
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
    // path_lower → hash of the content as of the last time this device and
    // Dropbox agreed on that file. Without it a poll cannot tell "the remote
    // moved on" from "we both moved on", which is the difference between a
    // safe update and destroying somebody's writing. Mirrors the
    // fileMeta.hash the vault adapter has always kept.
    fileHashes: {},
    lastSync: 0,
  };
  // Two-sided changes waiting on the user. In-memory only, same as the vault
  // adapter — a conflict that survives a reload would be stale.
  let _conflicts = [];
  let _conflictListeners = new Set();
  function _emitConflicts(){
    _conflictListeners.forEach(cb => { try { cb([..._conflicts]); } catch(e){} });
  }
  // FNV-1a, byte-for-byte the same function the vault adapter uses, so the
  // two agree about what "unchanged" means.
  function _hash(s){
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  }
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

  // Record a handled failure into the diagnostics log (Settings ->
  // Diagnostics) without changing behaviour. Null-guarded so a missing
  // errors.js can never turn a swallowed error into a thrown one.
  function _diag(what, e){
    try { if (window.sktErrors) sktErrors.report('dropbox:' + what, e); } catch(_){}
  }

  function _loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) _state = Object.assign(_state, JSON.parse(raw));
    } catch(e){ _diag('loadState', e); }
  }
  function _saveState() {
    // Losing _state drops fileRevs, which doubles as the delete tombstone —
    // the exact state whose absence caused the note-resurrection bug.
    try { localStorage.setItem(STATE_KEY, JSON.stringify(_state)); } catch(e){ _diag('saveState', e); }
  }
  function _emit() { _statusListeners.forEach(fn => { try { fn(getStatus()); } catch(e){} }); }

  // Toast a sync problem at most once a minute per kind — the poll loop runs
  // every few seconds, so an unthrottled toast would spam a persistent failure.
  const _lastWarnAt = {};
  function _warnSync(kind, msg) {
    const now = Date.now();
    if (_lastWarnAt[kind] && now - _lastWarnAt[kind] < 60000) return;
    _lastWarnAt[kind] = now;
    console.warn('[dropbox-sync] ' + msg);
    if (typeof showToast === 'function') showToast(msg);
  }

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
    // `?nosync=1` (see realtime.js) must cut EVERY remote write, not just
    // Firebase — otherwise a local test session still pushes notes to the
    // shared Dropbox folder. Reporting "not configured" is the right lever:
    // every _api() call already checks it, and the UI renders a plain
    // not-connected pill rather than a broken/error state.
    if (typeof _syncDisabled === 'function' && _syncDisabled()) return false;
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
  async function _api(endpoint, body, _attempt) {
    _attempt = _attempt || 0;
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
      // Cap the retries. A sustained rate-limit would otherwise recurse
      // _api → wait → _api → … forever, never surfacing the failure to the
      // caller and pinning a background loop on the 429 wall.
      if (_attempt >= 4) {
        _connectError = 'Dropbox rate-limited';
        _emit();
        if (typeof showToast === 'function') showToast('Dropbox is rate-limiting — sync paused, will retry later');
        throw new Error('Dropbox 429: retry cap reached after ' + _attempt + ' attempts');
      }
      // Honor Retry-After when present; otherwise exponential backoff capped at 60s.
      const retry = parseInt(res.headers.get('Retry-After')) || Math.min(60, 5 * Math.pow(2, _attempt));
      await new Promise(r => setTimeout(r, retry * 1000));
      return _api(endpoint, body, _attempt + 1);
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
          // The remote moved. Whether it is safe to take it depends on
          // whether WE moved too since the last agreement — compare the local
          // content against the hash recorded when this device and Dropbox
          // last matched. No recorded hash means we've never agreed on this
          // path, so there is nothing local to protect.
          const baseHash = _state.fileHashes && _state.fileHashes[f.path_lower];
          const localChanged = baseHash != null && _hash(existing.content || '') !== baseHash;
          filesToFetch.push({ item: existing, path: f.path_lower, rev: f.rev, localChanged });
        } else {
          fileRevs[f.path_lower] = f.rev;
        }
      }
      const CONCURRENCY = 5;
      let cursor2 = 0;
      async function worker() {
        while (cursor2 < filesToFetch.length) {
          const idx = cursor2++;
          const { item, path, rev, localChanged } = filesToFetch[idx];
          try {
            const text = await _download(path);
            if (text == null) continue;
            // Both sides edited since they last agreed → do NOT pick a winner.
            // This used to assign item.content unconditionally, so a remote
            // edit silently destroyed local writing that hadn't been pushed
            // yet (the push is debounced 800 ms, and a failed upload leaves it
            // unsent indefinitely). The vault adapter has always queued this
            // case for the user; Dropbox just overwrote.
            if (localChanged && _hash(text) !== _hash(item.content || '')){
              if (!_conflicts.some(c => c.itemId === item.id)){
                _conflicts.push({
                  itemId: item.id,
                  path,
                  name: item.name || path.split('/').pop().replace(/\.md$/, ''),
                  appContent: item.content || '',
                  diskContent: text,
                  diskMtime: 0,
                  ts: Date.now(),
                });
                console.warn('[dropboxSync] conflict queued for', path);
              }
              // Leave both the content and the recorded rev/hash alone so the
              // next poll re-detects it until the user decides.
              continue;
            }
            item.content = text;
            fileRevs[path] = rev;
            _state.fileHashes[path] = _hash(text);
          } catch(e) { /* leave existing content on failure */ }
        }
      }
      await Promise.all(Array.from({length: Math.min(CONCURRENCY, filesToFetch.length)}, worker));
      // One emit for the whole batch rather than per worker.
      if (_conflicts.length) _emitConflicts();

      // Pass 3: reconcile files that exist locally but not in the Dropbox
      // listing. Two very different causes look identical here:
      //   a) genuinely new — created on this device before Dropbox was
      //      reachable → push it up.
      //   b) deleted remotely — another device deleted it while this one
      //      wasn't polling (phone asleep, app closed, cursor expired).
      // Blindly pushing (the old behavior) RESURRECTED remotely-deleted
      // files: this device re-uploaded its stale copy on the next mount and
      // every other device then pulled it back. Disambiguate with
      // _state.fileRevs — if this device has a rev recorded for the file's
      // path, it synced that exact path from Dropbox before, so its absence
      // from the listing means it was deleted remotely → delete locally.
      const listedPaths = new Set(files.map(f => f.path_lower));
      const localOnlyFiles = items.filter(it => it.type === 'file' && !seenLocalIds.has(it.id));
      const removedRemotely = new Set();
      for (const f of localOnlyFiles) {
        const p = _buildPath(f, items, '.md').toLowerCase();
        if ((_state.fileRevs || {})[p] && !listedPaths.has(p)){
          removedRemotely.add(f.id);
          delete fileRevs[p];
          continue;
        }
        pushFile(f, items); // debounced individually; fires within 800 ms
      }
      if (removedRemotely.size){
        // Splice in place — `items` aliases data.items and is read below.
        for (let i = items.length - 1; i >= 0; i--){
          if (removedRemotely.has(items[i].id)) items.splice(i, 1);
        }
        console.log('[dropboxSync] removed ' + removedRemotely.size + ' file(s) deleted remotely');
      }
      // Prune stale rev entries (renamed/deleted paths already reconciled
      // above) so tombstones don't accumulate forever. Keep pendingDeletes —
      // those are still being retried.
      Object.keys(fileRevs).forEach(p => {
        if (!listedPaths.has(p) && !pending[p]){ delete fileRevs[p]; delete _state.fileHashes[p]; }
      });

      // Ensure selectedId still points at a real file.
      if (!data.selectedId || !items.find(i => i.id === data.selectedId)){
        data.selectedId = (items.find(i => i.type === 'file') || {}).id || null;
      }
      _state.cursor = cursor;
      _state.fileRevs = fileRevs;
      _state.lastSync = Date.now();
      _saveState();
      // Persist the merged model to local storage too.
      try { localStorage.setItem('skt-notes-v2', JSON.stringify(data)); }
      catch(e){ _warnSync('quota', 'Couldn’t save synced notes locally — browser storage is full'); }
    } finally {
      _busy = false; _emit();
    }
  }

  // ─── Incremental poll ─────────────────────────────────────────────────────
  async function _pollOnce(getData) {
    if (!isConfigured()) return;
    if (_editingProvider && _editingProvider()) return; // skip — user mid-edit
    const data = getData(); if (!data || !Array.isArray(data.items)) return;
    if (!_state.cursor){
      // No cursor — either first run or the previous poll invalidated it
      // (expired cursor). The old code returned here forever, so a device
      // whose cursor expired silently STOPPED syncing until the notes panel
      // was remounted. Recover by running a full sync, which re-establishes
      // the cursor for subsequent incremental polls.
      await fullSync(data);
      return;
    }
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
          if (text != null) {
            // Same two-sided-change guard as the full sync. This is the path
            // that runs on every poll tick, so it is the one that actually
            // ate local edits in practice.
            const baseHash = _state.fileHashes && _state.fileHashes[entry.path_lower];
            const localChanged = baseHash != null && _hash(item.content || '') !== baseHash;
            if (localChanged && _hash(text) !== _hash(item.content || '')){
              if (!_conflicts.some(c => c.itemId === item.id)){
                _conflicts.push({
                  itemId: item.id,
                  path: entry.path_lower,
                  name: item.name || entry.name.replace(/\.md$/i, ''),
                  appContent: item.content || '',
                  diskContent: text,
                  diskMtime: 0,
                  ts: Date.now(),
                });
                console.warn('[dropboxSync] conflict queued for', entry.path_lower);
                _emitConflicts();
              }
              // Leave content, rev and hash untouched so the next tick
              // re-detects this until the user picks a side.
              continue;
            }
            item.content = text;
            _state.fileHashes[entry.path_lower] = _hash(text);
          }
        } catch(e) { _diag('download ' + entry.path_lower, e); }
        _state.fileRevs[entry.path_lower] = entry.rev;
        changed = true;
      }
    }
    _state.cursor = resp.cursor || _state.cursor;
    _state.lastSync = Date.now();
    _saveState();
    if (changed) {
      try { localStorage.setItem('skt-notes-v2', JSON.stringify(data)); }
      catch(e){ _warnSync('quota', 'Couldn’t save synced notes locally — browser storage is full'); }
      if (typeof window.dropboxSync._onPullCallback === 'function') {
        try { window.dropboxSync._onPullCallback(); } catch(e){ _diag('onPull callback', e); }
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
    if (_pushTimers.has(file.id)) clearTimeout(_pushTimers.get(file.id).timer);
    // Named closure (not a bare setTimeout) so flushPending() can fire it
    // immediately on page hide / panel unmount.
    const run = async () => {
      _pushTimers.delete(file.id);
      try {
        const path = _buildPath(file, items, '.md');
        const body = file.content || '';
        const res = await _upload(path, body);
        if (res && res.rev){
          const key = res.path_lower || path.toLowerCase();
          _state.fileRevs[key] = res.rev;
          // A successful upload is the other moment the two sides agree, so
          // it's the other place the baseline hash has to be recorded — miss
          // it and the next poll reads every pushed edit as a local change
          // and reports a conflict against our own write.
          _state.fileHashes[key] = _hash(body);
        }
        _state.lastSync = Date.now();
        _saveState();
      } catch(e) {
        // Don't swallow silently: if the rev is already recorded, no later
        // tick re-attempts this write — the user needs to know it didn't land.
        _warnSync('upload', 'Dropbox upload failed — "' + (file.name || 'note') + '" isn’t synced yet');
      }
    };
    _pushTimers.set(file.id, { timer: setTimeout(run, PUSH_DEBOUNCE_MS), run });
  }

  // Fire every queued debounced upload NOW (tab hide / unmount) so a write
  // isn't lost if the page closes inside the 800 ms debounce window.
  function flushPending() {
    if (!_pushTimers.size) return;
    const runs = [];
    _pushTimers.forEach(v => { clearTimeout(v.timer); runs.push(v.run); });
    // Tab-close / unmount flush — a throw here silently drops the pending
    // upload, so the note never reaches Dropbox.
    runs.forEach(run => { try { run(); } catch(e){ _diag('flushPending', e); } });
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
      // The baseline hash is keyed by path too, so it has to follow the move.
      // Left behind, the new path would have a rev but no hash — which reads
      // as "never agreed" and quietly disables conflict detection for that
      // file until the next upload re-establishes it.
      if (_state.fileHashes[oldKey] != null){
        _state.fileHashes[newKey] = _state.fileHashes[oldKey];
        delete _state.fileHashes[oldKey];
      }
      // Folder move: move_v2 relocated every descendant server-side in one
      // call, but their cached revs were still filed under the OLD folder path.
      // Re-key each `oldKey/…` rev to `newKey/…` so a later sync looks up the
      // right path and reuses the rev instead of re-uploading or conflicting.
      const oldPrefix = oldKey + '/';
      Object.keys(_state.fileRevs).forEach(k => {
        if (k.startsWith(oldPrefix)){
          _state.fileRevs[newKey + '/' + k.slice(oldPrefix.length)] = _state.fileRevs[k];
          delete _state.fileRevs[k];
        }
      });
      Object.keys(_state.fileHashes).forEach(k => {
        if (k.startsWith(oldPrefix)){
          _state.fileHashes[newKey + '/' + k.slice(oldPrefix.length)] = _state.fileHashes[k];
          delete _state.fileHashes[k];
        }
      });
      _saveState();
    } catch (e) {
      console.error('[dropboxSync] move failed', fromPath, '→', toPath, e.message);
    }
  }

  // ─── Conflicts ────────────────────────────────────────────────────────────
  // Same three functions, same shapes and same 'app' | 'disk' | 'manual'
  // vocabulary as the vault adapter, so the notes panel's existing resolver
  // works against either without knowing which one it is talking to.
  function onConflict(cb){
    _conflictListeners.add(cb);
    try { cb([..._conflicts]); } catch(e){}
    return () => _conflictListeners.delete(cb);
  }
  function getConflicts(){ return [..._conflicts]; }
  async function resolveConflict(itemId, choice, opts){
    const c = _conflicts.find(x => x.itemId === itemId);
    if (!c) return false;
    const data = opts && opts.data;
    const item = data && data.items && data.items.find(i => i.id === itemId);
    let finalContent;
    if (choice === 'app')         finalContent = c.appContent;
    else if (choice === 'manual') finalContent = (opts && typeof opts.manualContent === 'string') ? opts.manualContent : c.appContent;
    else                          finalContent = c.diskContent;
    if (item){
      item.content = finalContent;
      if (choice === 'disk') item.lineAuthors = [];
    }
    // Write the decision back so both sides agree again, and record the
    // baseline hash from the SAME string we uploaded — otherwise the very
    // next poll re-raises the conflict we just resolved.
    try {
      const res = await _upload(c.path, finalContent);
      const key = (res && res.path_lower) || c.path.toLowerCase();
      if (res && res.rev) _state.fileRevs[key] = res.rev;
      _state.fileHashes[key] = _hash(finalContent);
      _state.lastSync = Date.now();
      _saveState();
    } catch(e){
      _diag('resolveConflict upload', e);
      _warnSync('upload', 'Couldn’t write the resolved note to Dropbox — it stays unsynced for now');
    }
    _conflicts = _conflicts.filter(x => x.itemId !== itemId);
    _emitConflicts();
    _emit();
    return true;
  }

  // ─── Expose ───────────────────────────────────────────────────────────────
  window.dropboxSync = {
    init, isConfigured, isConnected, isSupported, getStatus, onStatus,
    fullSync, pushFile, flushPending, deletePath, movePath, startPolling, stopPolling,
    onConflict, getConflicts, resolveConflict,
    // buildPath is useful for callers that need to compute a Dropbox path
    // from an item + items[] (e.g. notes panel capturing path before
    // deletion). Exposes the same private helper used internally.
    buildPath: (item, items, ext) => _buildPath(item, items, ext),
    _onPullCallback: null,
  };
})();
