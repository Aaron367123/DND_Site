// ============================================================
// IN-PAGE SELF TEST
// ============================================================
//   node tools/shot.js --state .state/live.json --out /dev/null \
//        --wait 5000 --eval-file tools/selftest.js
//
// Asserts against the REAL app in a real browser: every panel, the sync
// layer's merge and echo bookkeeping, entity explode/assemble round-trips,
// state save/load, and backup coverage. Restores whatever it touched.
//
// Prints one line per check plus a summary. Any FAIL line is a regression.
(async () => {
  // HARD STOP if this tab is talking to the real campaign. The suite writes to
  // localStorage on purpose, and with the storage hook installed those writes
  // would be pushed to Firebase and land on the table mid-session. shot.js
  // loads the page with ?nosync=1 so _fbDb stays null; anything else is a
  // mistake worth refusing rather than a risk worth taking.
  if (typeof _fbDb !== 'undefined' && _fbDb){
    return 'REFUSED — this tab is connected to live sync. Run via tools/shot.js '
         + '(which loads with ?nosync=1); never against the live campaign.';
  }

  const R = [], t0 = Date.now();
  const touched = {};                     // key -> original value, for restore
  const stash = k => { if (!(k in touched)) touched[k] = localStorage.getItem(k); };
  const ok   = (n, c, d) => R.push({ n, pass: !!c, d: c ? '' : (d || '') });
  const eqJ  = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const errs = [];
  window.addEventListener('error', e => errs.push(e.message));
  window.addEventListener('unhandledrejection', e => errs.push('reject: ' + e.reason));

  const PANELS = ['adventures','attacks','battlemap','bestiary','books','combat',
    'encounter','loot','notes','npcgen','npclib','party','shop','soundboard',
    'time','turnview','weather'];

  // 1. every panel mounts, renders, unmounts, remounts, and stays quiet
  for (const id of PANELS){
    const before = errs.length;
    try { openPanel(id); } catch(e){ ok('mount ' + id, false, e.message); continue; }
    await sleep(260);
    const d = panelDefs[id];
    ok('mount ' + id, d && d._body && d._body.children.length > 0, 'empty body');
    try { closePanel(id); } catch(e){ ok('unmount ' + id, false, e.message); }
    await sleep(80);
    ok('unmount ' + id, !panelDefs[id]._body, '_body survived unmount');
    try { openPanel(id); } catch(e){ ok('remount ' + id, false, e.message); continue; }
    await sleep(200);
    ok('remount ' + id, panelDefs[id]._body && panelDefs[id]._body.children.length > 0);
    ok('silent ' + id, errs.length === before, errs.slice(before).join(' | '));
    closePanel(id);
  }

  // 2. entity keys: explode/assemble is lossless
  // Canonical (key-sorted) compare, not raw JSON. battlemap's assemble
  // rebuilds as {...meta, tokens, fog, ...}, so field ORDER legitimately
  // changes; only the values have to survive.
  const canon = v => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object'){
      const o = {};
      Object.keys(v).sort().forEach(k => { o[k] = canon(v[k]); });
      return o;
    }
    return v;
  };
  for (const k of Object.keys(_ENTITY_KEYS)){
    const spec = _ENTITY_KEYS[k], cur = localStorage.getItem(k);
    if (cur == null){ ok('roundtrip ' + k, true, 'absent'); continue; }
    let got;
    try { got = spec.assemble(spec.explode(cur)); }
    catch(e){ ok('roundtrip ' + k, false, e.message); continue; }
    ok('roundtrip ' + k, eqJ(canon(JSON.parse(got)), canon(JSON.parse(cur))), 'values differ');
  }

  // 3. entity merge keeps both sides of a disjoint edit
  const nest = flat => {
    const o = {};
    Object.keys(flat).forEach(n => {
      const i = n.indexOf('/');
      if (i < 0) o[n] = flat[n];
      else (o[n.slice(0, i)] = o[n.slice(0, i)] || {})[n.slice(i + 1)] = flat[n];
    });
    return o;
  };
  const entityCase = (k, mutA, mutB, check) => {
    const spec = _ENTITY_KEYS[k], base = localStorage.getItem(k);
    if (base == null) return ok('entity merge ' + k, true, 'absent');
    stash(k);
    _entityCache[k] = spec.explode(base);
    _remoteUpdate = true; localStorage.setItem(k, mutA(base)); _remoteUpdate = false;
    _dirtyKeys.add(k);
    _applyEntitySnapshot(k, nest(spec.explode(mutB(base))));
    ok('entity merge ' + k, check(JSON.parse(localStorage.getItem(k))));
    _dirtyKeys.clear();
    delete _entityCache[k];
  };
  entityCase('skt-party-v1',
    s => { const a = JSON.parse(s); a[0].hp = 3; return JSON.stringify(a); },
    s => { const a = JSON.parse(s); a[1].hp = 7; return JSON.stringify(a); },
    a => a[0].hp === 3 && a[1].hp === 7);
  entityCase('skt-combat-v1',
    s => { const d = JSON.parse(s); if (d.combatants[0]) d.combatants[0].hp = 3; return JSON.stringify(d); },
    s => { const d = JSON.parse(s); if (d.combatants[1]) d.combatants[1].hp = 7; return JSON.stringify(d); },
    d => (!d.combatants[0] || d.combatants[0].hp === 3)
      && (!d.combatants[1] || d.combatants[1].hp === 7));
  entityCase('skt-battlemap-v1',
    s => { const d = JSON.parse(s); if (d.tokens[0]) d.tokens[0].x = 111; return JSON.stringify(d); },
    s => { const d = JSON.parse(s); if (d.tokens[1]) d.tokens[1].x = 222; return JSON.stringify(d); },
    d => (!d.tokens[0] || d.tokens[0].x === 111)
      && (!d.tokens[1] || d.tokens[1].x === 222));

  // 4. whole-key merge, driven through the real apply path
  const K = 'skt-settings-v1', S0 = localStorage.getItem(K);
  if (S0){
    stash(K);
    const mine = JSON.parse(S0); mine.fontScale = (mine.fontScale || 100) + 10;
    const thrs = JSON.parse(S0); thrs.combatCompact = !thrs.combatCompact;
    _lastServer[K] = S0;
    _remoteUpdate = true; localStorage.setItem(K, JSON.stringify(mine)); _remoteUpdate = false;
    _dirtyKeys.add(K);
    _applyRemoteKey(K, JSON.stringify(thrs));
    const g = JSON.parse(localStorage.getItem(K));
    ok('whole-key disjoint merge',
       g.fontScale === mine.fontScale && g.combatCompact === thrs.combatCompact);
    ok('merge re-queues a push', _dirtyKeys.has(K));

    _dirtyKeys.clear();
    const m2 = JSON.parse(S0); m2.fontScale = 150;
    const t2 = JSON.parse(S0); t2.fontScale = 200;
    _lastServer[K] = S0;
    _remoteUpdate = true; localStorage.setItem(K, JSON.stringify(m2)); _remoteUpdate = false;
    _dirtyKeys.add(K);
    _applyRemoteKey(K, JSON.stringify(t2));
    ok('clash takes remote', JSON.parse(localStorage.getItem(K)).fontScale === 200);
    ok('clash queues nothing', !_dirtyKeys.has(K));
    _dirtyKeys.clear();
  }

  // 5. sync bookkeeping never strands
  ok('conflict dialog is gone',
     typeof _renderConflictBar === 'undefined' && !document.getElementById('rt-conflict-bar'));

  const kLoot = 'skt-loot-v1', vLoot = localStorage.getItem(kLoot);
  if (vLoot){
    stash(kLoot);
    _dirtyKeys.add(kLoot);
    _lastServer[kLoot] = vLoot;
    _applyRemoteKey(kLoot, vLoot);                  // remote identical to local
    ok('identical remote clears dirty', !_dirtyKeys.has(kLoot));
    _dirtyKeys.clear();
  }

  // _remoteUpdate must survive a throwing setItem, or nothing syncs again
  stash('skt-enc-v1');
  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function(k){
    if (k === 'skt-enc-v1') throw new Error('QuotaExceededError');
    return origSet.apply(this, arguments);
  };
  try { _applyRemoteKey('skt-enc-v1', '{"monsters":[]}'); } catch(e){}
  Storage.prototype.setItem = origSet;
  ok('_remoteUpdate cleared after a failed apply', _remoteUpdate === false);

  // The dirty hook lives in _patchLocalStorage, which only installs inside
  // _startRealtime() after Firebase auth — offline, setItem is unpatched and
  // nothing is ever marked dirty. Install it and stub the db for this check,
  // then put both back.
  stash('skt-npcs-v2');
  const preSet = Storage.prototype.setItem;
  const preDb  = _fbDb;
  _patchLocalStorage();
  _fbDb = { ref: function(){ return { set: function(){ return Promise.resolve(); } }; } };
  localStorage.setItem('skt-npcs-v2', JSON.stringify([{ id: 'selftest', name: 'probe' }]));
  ok('local edits mark the key dirty', _dirtyKeys.has('skt-npcs-v2'));
  localStorage.setItem('skt-npcs-v2', JSON.stringify([{ id: 'selftest', name: 'probe' }]));
  _dirtyKeys.delete('skt-npcs-v2');
  localStorage.setItem('skt-npcs-v2', JSON.stringify([{ id: 'selftest', name: 'probe' }]));
  ok('byte-identical rewrite marks nothing', !_dirtyKeys.has('skt-npcs-v2'));
  Storage.prototype.setItem = preSet;
  _fbDb = preDb;
  clearTimeout(_pushTimer);
  _dirtyKeys.clear();

  // 6. load/save settles. The first cycle is allowed to normalise — party
  // runs reconcilePcHp (combat's hp wins, and it toasts) and
  // migratePartySpellSlots (slot POOLS fold into sheet.spellSlots). Both are
  // deliberate and documented. What would be a bug is a cycle that never
  // settles, so the second one must be a byte-for-byte no-op.
  for (const [key, dom] of [['skt-party-v1','party'], ['skt-combat-v1','combat'],
                            ['skt-shop-v1','shop'], ['skt-settings-v1','settings']]){
    if (localStorage.getItem(key) == null) continue;
    stash(key);
    loadDomain(dom); save();
    const once = localStorage.getItem(key);
    loadDomain(dom); save();
    ok('load/save settles ' + dom, localStorage.getItem(key) === once,
       'still changing on the second cycle');
  }

  // ...and the slot migration must MOVE the data, not drop it.
  {
    const before = JSON.parse(touched['skt-party-v1'] || localStorage.getItem('skt-party-v1') || '[]');
    const after  = JSON.parse(localStorage.getItem('skt-party-v1') || '[]');
    const SLOT = /^Spell Slots L(\d)$/;
    let checked = 0, lost = [];
    before.forEach(p => {
      (p.resources || []).forEach(r => {
        const m = SLOT.exec(r.name || '');
        if (!m) return;
        checked++;
        const dst = after.find(q => q.id === p.id);
        const got = dst && dst.sheet && dst.sheet.spellSlots && dst.sheet.spellSlots[+m[1]];
        if (!got || got.total !== Math.max(0, r.max || 0)) lost.push(p.name + ' L' + m[1]);
      });
    });
    ok('slot pools migrate into sheet, none lost (' + checked + ' checked)',
       lost.length === 0, lost.join(', '));
  }

  // 7. backup covers what it should and excludes what it must
  if (typeof buildBackup === 'function'){
    let b = null;
    try { b = buildBackup(); } catch(e){}
    ok('backup builds', !!(b && b.keys));
    if (b && b.keys){
      const missing = SKT_SYNC_KEYS.filter(k => localStorage.getItem(k) != null && !(k in b.keys));
      ok('backup covers every synced key', missing.length === 0, 'missing ' + missing.join(','));
      const leaked = Object.keys(b.keys).filter(k => /skt-bm-view/.test(k));
      ok('backup excludes per-device zoom', leaked.length === 0, leaked.join(','));
    }
  }

  // 8. generated data present and the right shape
  ok('rules table loaded', !!(window.SKT_RULES && window.SKT_RULES.xpThresholds2014
       && window.SKT_RULES.xpThresholds2014.length === 20));
  ok('reactions table loaded',
     !!(window.SKT_REACTIONS && Object.keys(window.SKT_REACTIONS).length > 0));

  // restore everything this run touched
  _remoteUpdate = true;
  Object.keys(touched).forEach(k => {
    if (touched[k] == null) localStorage.removeItem(k);
    else localStorage.setItem(k, touched[k]);
  });
  _remoteUpdate = false;
  _dirtyKeys.clear();
  ['party', 'combat', 'shop', 'settings'].forEach(d => { try { loadDomain(d); } catch(e){} });

  const fails = R.filter(r => !r.pass);
  return [
    ...R.map(r => (r.pass ? 'pass  ' : 'FAIL  ') + r.n + (r.d ? '  -- ' + r.d : '')),
    '',
    (fails.length ? 'FAILED ' + fails.length + ' of ' : 'ALL ') + R.length + ' checks'
      + '   (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)',
  ].join('\n');
})()
