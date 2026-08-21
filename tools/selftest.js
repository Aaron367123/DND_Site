// ============================================================
// IN-PAGE SELF TEST
// ============================================================
// Run all three modes with:   node tools/selftest-run.js
//
// Or one at a time:
//   node tools/shot.js --state .state/live.json --out /dev/null \
//        --wait 5000 --eval-file tools/selftest.js
//   ...add --player        for the player view
//   ...add --preset mobile for the phone layout
//
// Asserts against the REAL app in a real browser. Which battery runs is chosen
// by what the page actually is, so one file covers all three modes. Everything
// it writes is restored before it returns.
//
// Prints one line per check plus a summary. Any FAIL line is a regression.
(async () => {
  // HARD STOP if this tab is talking to the real campaign. The suite writes to
  // localStorage on purpose, and with the storage hook installed those writes
  // would be pushed to Firebase and land on the table mid-session. shot.js
  // loads the page with ?nosync=1 so _fbDb stays null; anything else is a
  // mistake worth refusing rather than a risk worth taking.
  if (typeof _fbDb !== 'undefined' && _fbDb){
    return 'REFUSED - this tab is connected to live sync. Run via tools/shot.js '
         + '(which loads with ?nosync=1); never against the live campaign.';
  }

  const R = [], t0 = Date.now();
  const ok    = (n, c, d) => R.push({ n, pass: !!c, d: c ? '' : (d || '') });
  const eqJ   = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const errs  = [];
  window.addEventListener('error', e => errs.push(e.message));
  window.addEventListener('unhandledrejection', e => errs.push('reject: ' + e.reason));

  // Snapshot every app key up front and put them all back at the end. The
  // interaction battery rolls treasure, regenerates shops and adds tokens;
  // restoring per-test would be one missed call away from leaving the campaign
  // file mutated.
  const snapshot = {};
  Object.keys(localStorage).forEach(k => {
    if (/^skt/.test(k)) snapshot[k] = localStorage.getItem(k);
  });
  const restore = () => {
    if (typeof _remoteUpdate !== 'undefined') _remoteUpdate = true;
    Object.keys(localStorage).forEach(k => {
      if (/^skt/.test(k) && !(k in snapshot)) localStorage.removeItem(k);
    });
    Object.keys(snapshot).forEach(k => localStorage.setItem(k, snapshot[k]));
    if (typeof _remoteUpdate !== 'undefined') _remoteUpdate = false;
    if (typeof _dirtyKeys !== 'undefined') _dirtyKeys.clear();
    ['party','combat','shop','settings'].forEach(d => { try { loadDomain(d); } catch(e){} });
  };

  const PLAYER = document.body.classList.contains('player-mode');
  const MOBILE = window.innerWidth < 768;
  const MODE   = PLAYER ? 'player' : (MOBILE ? 'mobile' : 'dm');

  const PANELS = ['adventures','attacks','battlemap','bestiary','books','combat',
    'encounter','loot','notes','npcgen','npclib','party','shop','soundboard',
    'time','turnview','weather'];

  // Click a real control. A selector that no longer matches is itself a
  // regression - the button was renamed or dropped - so callers assert on the
  // return value rather than silently skipping.
  const click = async (root, sel, ms) => {
    const el = (root || document).querySelector(sel);
    if (!el) return null;
    el.click();
    await sleep(ms == null ? 260 : ms);
    return el;
  };

  // ══════════════════════════════════════════════════════════ DM / desktop
  if (MODE === 'dm'){

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
    // rebuilds as {...meta, tokens, fog, ...} so field ORDER legitimately
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

    // 4b. an atomic key must never be field-merged. The prompt is one question
    // bound to one answer: merging p1-with-an-answer against a freshly
    // published p2 would take `id` from the server and `answer` from us, and
    // the DM would spend the wrong character's reaction on the wrong attack.
    {
      const P = 'skt-prompt-v1';
      const p1 = { id:'p1', ts:1000, label:'Claw',  target:{id:'zoey',name:'Zoey'},
                   dmg:11, offers:[{pcId:'zoey',key:'shield'}], answer:null };
      const p2 = { id:'p2', ts:2000, label:'Bite',  target:{id:'namroc',name:'Namroc'},
                   dmg:7,  offers:[{pcId:'namroc',key:'absorb'}], answer:null };
      const answered = Object.assign({}, p1,
        { answer:{ pcId:'zoey', who:'Zoey', key:'shield', at:1500 } });
      _lastServer[P] = JSON.stringify(p1);
      _remoteUpdate = true; localStorage.setItem(P, JSON.stringify(answered)); _remoteUpdate = false;
      _dirtyKeys.add(P);
      _applyRemoteKey(P, JSON.stringify(p2));
      const got = JSON.parse(localStorage.getItem(P) || 'null');
      ok('prompt is taken whole, never field-merged',
         got && got.id === 'p2' && got.answer == null,
         'got id=' + (got && got.id) + ' answer=' + JSON.stringify(got && got.answer));
      _dirtyKeys.clear();
    }

    // 4c. a regenerated shop must not keep the old stock. Its inventory has
    // duplicate item names, so the array is unkeyable and a field-wise merge
    // reverts the stock while keeping the new keeper.
    {
      const SH = 'skt-shop-v1', s0 = localStorage.getItem(SH);
      if (s0){
        const regen  = JSON.parse(s0);
        regen.keeper = 'Dorn'; regen.name = 'Ironhand Supply';
        regen.inventory = [{ name:'New Blade', price:15 }, { name:'New Rope', price:1 }];
        const edited = JSON.parse(s0);
        if (edited.inventory && edited.inventory[0]) edited.inventory[0].bought = true;
        _lastServer[SH] = s0;
        _remoteUpdate = true; localStorage.setItem(SH, JSON.stringify(regen)); _remoteUpdate = false;
        _dirtyKeys.add(SH);
        _applyRemoteKey(SH, JSON.stringify(edited));
        const g = JSON.parse(localStorage.getItem(SH));
        const names = (g.inventory || []).map(i => i.name);
        const mixed = g.keeper === 'Dorn' && !names.some(n => /^New /.test(n));
        ok('shop never mixes a new keeper with the old stock', !mixed,
           'keeper=' + g.keeper + ' stock=' + names.slice(0, 2).join(','));
        _dirtyKeys.clear();
      }
    }

    // 5. sync bookkeeping never strands
    ok('conflict dialog is gone',
       typeof _renderConflictBar === 'undefined' && !document.getElementById('rt-conflict-bar'));

    const kLoot = 'skt-loot-v1', vLoot = localStorage.getItem(kLoot);
    if (vLoot){
      _dirtyKeys.add(kLoot);
      _lastServer[kLoot] = vLoot;
      _applyRemoteKey(kLoot, vLoot);                // remote identical to local
      ok('identical remote clears dirty', !_dirtyKeys.has(kLoot));
      _dirtyKeys.clear();
    }

    // _remoteUpdate must survive a throwing setItem, or nothing syncs again
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k){
      if (k === 'skt-enc-v1') throw new Error('QuotaExceededError');
      return origSet.apply(this, arguments);
    };
    try { _applyRemoteKey('skt-enc-v1', '{"monsters":[]}'); } catch(e){}
    Storage.prototype.setItem = origSet;
    ok('_remoteUpdate cleared after a failed apply', _remoteUpdate === false);

    // The dirty hook lives in _patchLocalStorage, which only installs inside
    // _startRealtime() after Firebase auth - offline, setItem is unpatched and
    // nothing is ever marked dirty. Install it and stub the db for this check,
    // then put both back.
    const preSet = Storage.prototype.setItem;
    const preDb  = _fbDb;
    _patchLocalStorage();
    _fbDb = { ref: function(){ return { set: function(){ return Promise.resolve(); } }; } };
    localStorage.setItem('skt-npcs-v2', JSON.stringify([{ id: 'selftest', name: 'probe' }]));
    ok('local edits mark the key dirty', _dirtyKeys.has('skt-npcs-v2'));
    _dirtyKeys.delete('skt-npcs-v2');
    localStorage.setItem('skt-npcs-v2', JSON.stringify([{ id: 'selftest', name: 'probe' }]));
    ok('byte-identical rewrite marks nothing', !_dirtyKeys.has('skt-npcs-v2'));
    Storage.prototype.setItem = preSet;
    _fbDb = preDb;
    clearTimeout(_pushTimer);
    _dirtyKeys.clear();

    // 6. load/save settles. The first cycle is allowed to normalise - party
    // runs reconcilePcHp (combat's hp wins, and it toasts) and
    // migratePartySpellSlots (slot POOLS fold into sheet.spellSlots). Both are
    // deliberate and documented. What would be a bug is a cycle that never
    // settles, so the second one must be a byte-for-byte no-op.
    for (const [key, dom] of [['skt-party-v1','party'], ['skt-combat-v1','combat'],
                              ['skt-shop-v1','shop'], ['skt-settings-v1','settings']]){
      if (localStorage.getItem(key) == null) continue;
      loadDomain(dom); save();
      const once = localStorage.getItem(key);
      loadDomain(dom); save();
      ok('load/save settles ' + dom, localStorage.getItem(key) === once,
         'still changing on the second cycle');
    }

    // ...and the slot migration must MOVE the data, not drop it.
    {
      const before = JSON.parse(snapshot['skt-party-v1'] || '[]');
      const after  = JSON.parse(localStorage.getItem('skt-party-v1') || '[]');
      const SLOT = /^Spell Slots L(\d)$/;
      let checked = 0; const lost = [];
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

    // 7b. restore actually brings the campaign back. This is the path that
    // matters most on the worst day of the campaign's life, and nothing
    // exercised it before.
    if (window.sktBackup){
      const B = sktBackup.snapshot();
      const partyBefore = localStorage.getItem('skt-party-v1');
      const zoomKey = 'skt-bm-view-v1', zoomVal = '{"p":"selftest","v":2.5}';

      // Wreck it the way a bad session would.
      const wrecked = JSON.parse(partyBefore); wrecked[0].hp = 1; wrecked.pop();
      localStorage.setItem('skt-party-v1', JSON.stringify(wrecked));
      localStorage.setItem('skt-npcs-v2', JSON.stringify([]));
      localStorage.setItem('skt-selftest-stray-v1', 'junk');
      localStorage.removeItem('skt-loot-v1');
      localStorage.setItem(zoomKey, zoomVal);          // per-device, EXCLUDEd

      let r = null;
      try { r = await sktBackup.restore(B, { syncTimeoutMs: 300 }); }
      catch(e){ ok('restore runs', false, e.message); }
      if (r){
        ok('restore runs', true);
        const wrong = Object.keys(B.keys).filter(k => localStorage.getItem(k) !== B.keys[k]);
        ok('restore returns every key byte-exact', wrong.length === 0, wrong.join(','));
        ok('restore recovers a deleted key', localStorage.getItem('skt-loot-v1') != null);
        ok('restore refills a wiped list',
           JSON.parse(localStorage.getItem('skt-npcs-v2') || '[]').length > 0);
        // Replace, don't merge - otherwise anything deleted before the backup
        // was taken comes back to life.
        ok('restore clears keys the file predates',
           localStorage.getItem('skt-selftest-stray-v1') === null);
        ok('restore leaves per-device keys alone', localStorage.getItem(zoomKey) === zoomVal);
        ok('restore leaves no empty-string debris',
           Object.keys(localStorage).filter(k => /^skt/.test(k)
             && localStorage.getItem(k) === '').length === 0);
      }
      localStorage.removeItem(zoomKey);
    }

    // 7c. the rolling snapshots are the safety net nobody clicks. Two rings,
    // newest KEEP of each, and timed snapshots must never push out the
    // deliberate ones - those are the ones taken just before something risky.
    if (window.sktBackup && window.sktBackup.autosave && window.indexedDB){
      const A = sktBackup.autosave;
      const bump = n => localStorage.setItem('skt-settings-v1', JSON.stringify(
        Object.assign(JSON.parse(localStorage.getItem('skt-settings-v1')), { fontScale: 100 + n })));
      try {
        const w = await A.write('manual');
        ok('autosave writes and returns an id', !!(w && w.id != null));
        const seen = await A.list();
        ok('autosave lists what it wrote', seen.some(x => x.id === (w && w.id)));
        const got = w && await A.get(w.id);
        ok('a snapshot carries a full payload',
           !!(got && got.snap && got.snap.keys && Object.keys(got.snap.keys).length > 0));
        if (got){
          const pb = localStorage.getItem('skt-party-v1');
          const p2 = JSON.parse(pb); p2[0].hp = 1;
          localStorage.setItem('skt-party-v1', JSON.stringify(p2));
          await sktBackup.restore(got.snap, { syncTimeoutMs: 200 });
          ok('a snapshot is restorable', localStorage.getItem('skt-party-v1') === pb);
        }
        await A.write('auto');
        ok('an unchanged auto snapshot is skipped', (await A.write('auto')) === null);

        for (let i = 0; i < A.KEEP + 3; i++){ bump(i); await A.write('auto'); }
        const l2 = await A.list();
        ok('the auto ring caps at KEEP',
           l2.filter(x => x.reason === 'auto').length === A.KEEP,
           l2.filter(x => x.reason === 'auto').length + ' kept');
        ok('timed snapshots do not evict deliberate ones',
           l2.filter(x => x.reason !== 'auto').length > 0);

        for (let i = 0; i < A.KEEP + 3; i++){ bump(100 + i); await A.write('manual'); }
        const l3 = await A.list();
        ok('the deliberate ring caps too (no unbounded disk)',
           l3.filter(x => x.reason !== 'auto').length === A.KEEP,
           l3.filter(x => x.reason !== 'auto').length + ' kept');
        ok('deliberate snapshots do not evict the autos',
           l3.filter(x => x.reason === 'auto').length === A.KEEP);
      } catch(e){
        ok('autosave ring', false, e.message);
      }
    }

    // 8. generated data present and the right shape
    ok('rules table loaded', !!(window.SKT_RULES && window.SKT_RULES.xpThresholds2014
         && window.SKT_RULES.xpThresholds2014.length === 20));
    ok('reactions table loaded',
       !!(window.SKT_REACTIONS && Object.keys(window.SKT_REACTIONS).length > 0));

    // 9. dice
    if (typeof sktRollDice === 'function'){
      let lo = 99, hi = -1, bad = 0;
      for (let i = 0; i < 4000; i++){
        const r = sktRollDice('2d6+3');
        if (!r || typeof r.total !== 'number'){ bad++; continue; }
        lo = Math.min(lo, r.total); hi = Math.max(hi, r.total);
      }
      ok('2d6+3 stays within 5..15', bad === 0 && lo >= 5 && hi <= 15, 'saw ' + lo + '..' + hi);
      ok('2d6+3 reaches both ends', lo === 5 && hi === 15, 'saw ' + lo + '..' + hi);
      ok('a negative modifier floors at 0', sktRollDice('1d4-100').total === 0);
    }

    // 9b. damage maths. Wrong numbers here change what happens at the table,
    // and every one of these is a 5e rule rather than a preference.
    {
      openPanel('combat'); await sleep(320);
      const C = panelDefs.combat;
      const P0 = JSON.stringify(state.party), K0 = JSON.stringify(state.combatants);
      const A0 = state.activeCombatantId;
      const mon = f => { state.combatants = [Object.assign(
        { id:'st_m', name:'Dummy', hp:200, hpMax:200, isPC:false }, f)]; };
      const took = () => 200 - state.combatants[0].hp;

      mon({});                     C._applyHpDelta(0,-10,'fire');
      ok('dmg: plain damage lands', took() === 10, 'took ' + took());
      mon({_resist:['fire']});     C._applyHpDelta(0,-21,'fire');
      ok('dmg: resistance halves, rounding down', took() === 10, 'took ' + took());
      mon({_resist:['fire']});     C._applyHpDelta(0,-1,'fire');
      ok('dmg: resisting 1 leaves 0', took() === 0, 'took ' + took());
      mon({_immune:['fire']});     C._applyHpDelta(0,-21,'fire');
      ok('dmg: immunity zeroes it', took() === 0, 'took ' + took());
      mon({_vulnerable:['fire']}); C._applyHpDelta(0,-21,'fire');
      ok('dmg: vulnerability doubles', took() === 42, 'took ' + took());
      mon({_immune:['fire'],_resist:['fire']}); C._applyHpDelta(0,-21,'fire');
      ok('dmg: immunity beats resistance', took() === 0, 'took ' + took());
      mon({_resist:['cold']});     C._applyHpDelta(0,-21,'fire');
      ok('dmg: a different type is not resisted', took() === 21, 'took ' + took());

      state.combatants = [{ id:'st_m', name:'D', hp:5, hpMax:20, isPC:false }];
      C._applyHpDelta(0,-30,'fire');
      ok('dmg: hp clamps at 0, never negative', state.combatants[0].hp === 0);

      const pc = (hp, max, extra) => {
        state.party = [Object.assign({ id:'st_pc', name:'Tester', hp, hpMax:max }, extra || {})];
        state.combatants = [{ id:'st_pc', name:'Tester', hp, hpMax:max, isPC:true }];
      };
      pc(5,20); C._applyHpDelta(0,-30,'fire');
      ok('dmg: massive damage is instant death', !!state.combatants[0].dead);
      pc(5,20); C._applyHpDelta(0,-24,'fire');
      ok('dmg: one short of hpMax overflow is not', !state.combatants[0].dead);
      pc(5,20); C._applyHpDelta(0,-25,'fire');
      ok('dmg: overflow exactly equal to hpMax kills', !!state.combatants[0].dead);
      pc(20,20,{tempHp:5});  C._applyHpDelta(0,-8,'fire');
      ok('dmg: temp hp absorbs first, then hp',
         state.party[0].tempHp === 0 && state.combatants[0].hp === 17);
      pc(20,20,{tempHp:10}); C._applyHpDelta(0,-8,'fire');
      ok('dmg: temp hp can soak it all',
         state.party[0].tempHp === 2 && state.combatants[0].hp === 20);
      pc(20,20,{tempHp:100,resistances:['fire']}); C._applyHpDelta(0,-21,'fire');
      ok('dmg: resistance applies before temp hp', state.party[0].tempHp === 90,
         'temp ' + state.party[0].tempHp);

      // Multi-part: a dragon's bite is piercing PLUS fire, and each part
      // resolves its own resistance. Passing the sum under one label applied
      // the wrong resistance to the whole thing.
      openPanel('turnview'); await sleep(420);
      const T = panelDefs.turnview;
      const hit = (facets, parts, magical) => {
        state.combatants = [Object.assign(
          { id:'st_m', name:'Dummy', hp:200, hpMax:200, isPC:false }, facets)];
        T._applyDamage(state.combatants[0], parts, !!magical);
        return 200 - state.combatants[0].hp;
      };
      ok('dmg: multi-part resists only the matching type',
         hit({_resist:['fire']}, [{amt:17,type:'piercing'},{amt:6,type:'fire'}]) === 20);
      ok('dmg: multi-part resists the other type correctly',
         hit({_resist:['piercing']}, [{amt:17,type:'piercing'},{amt:6,type:'fire'}]) === 14);

      // The werewolf case: a qualifier must actually gate on the qualifier.
      const NONMAG = ['bludgeoning, piercing, and slashing from nonmagical attacks'];
      ok('dmg: a nonmagical slash is shrugged off',
         hit({_immune:NONMAG}, [{amt:12,type:'slashing'}], false) === 0);
      ok('dmg: a magical slash gets through',
         hit({_immune:NONMAG}, [{amt:12,type:'slashing'}], true) === 12);

      // Manual entry must be able to say "magical" — without it a hand-rolled
      // magic longsword did nothing to a werewolf.
      state.combatants = [
        { id:'st_a', name:'Paladin', hp:40, hpMax:40, isPC:true, initiative:20 },
        { id:'st_w', name:'Werewolf', hp:58, hpMax:58, isPC:false, initiative:10, _immune:NONMAG }];
      state.activeCombatantId = 'st_a'; save();
      const manual = magic => {
        state.combatants[1].hp = 58;
        T._render(); T._armed = 'st_w'; T._render();
        const b = T._body;
        b.querySelector('[data-tvman="dmg"]').value = '14';
        b.querySelector('[data-tvman="type"]').value = 'slashing';
        const m = b.querySelector('[data-tvman="magical"]');
        if (!m) return null;
        m.checked = magic;
        T._manualAttack();
        return 58 - state.combatants.find(c => c.id === 'st_w').hp;
      };
      const mundane = manual(false), magicked = manual(true);
      ok('dmg: manual row has a magical toggle', mundane !== null);
      ok('dmg: manual mundane is still shrugged off', mundane === 0, 'took ' + mundane);
      ok('dmg: manual magical lands in full', magicked === 14, 'took ' + magicked);

      // End to end on real bestiary data: stat-block text -> magical flag ->
      // qualifier match -> damage. Every link is tested above in isolation;
      // this is the one that proves they are wired to each other. A Deva's
      // mace must get past a Werewolf, a mundane club must not.
      if (typeof _5eData !== 'undefined' && typeof _5eLoaded !== 'undefined' && _5eLoaded){
        const all = Array.from(_5eData || []);
        const deva = all.find(m => String(m.name).toLowerCase() === 'deva');
        const wolf = all.find(m => String(m.name).toLowerCase() === 'werewolf');
        ok('5e: found a Deva and a Werewolf to test with', !!(deva && wolf));
        if (deva && wolf && deva._raw){
          ok('5e: the Deva reads as having magical attacks',
             panelDefs.attacks._parsed(deva._raw).magical === true);
          state.combatants = [{ id:'st_w', name:'Werewolf', hp:58, hpMax:58,
                                isPC:false, _immune: wolf._immune }];
          const prevProp = C._lastAtkProp;
          C._lastAtkProp = 'magical';
          C._applyHpDelta(0, -12, 'bludgeoning');
          const magicked = 58 - state.combatants[0].hp;
          state.combatants[0].hp = 58;
          C._lastAtkProp = null;
          C._applyHpDelta(0, -12, 'bludgeoning');
          const mundane = 58 - state.combatants[0].hp;
          C._lastAtkProp = prevProp;
          ok('5e: a magical attack gets past the Werewolf', magicked === 12, 'took ' + magicked);
          ok('5e: a mundane one does not', mundane === 0, 'took ' + mundane);
        }
      } else {
        ok('5e: bestiary loaded for the end-to-end damage check', false,
           'run via tools/selftest-run.js, which waits for _5eLoaded');
      }

      state.party = JSON.parse(P0); state.combatants = JSON.parse(K0);
      state.activeCombatantId = A0; save();
      closePanel('turnview'); closePanel('combat');
    }

    // 10. interactions - click the controls a DM actually clicks
    openPanel('time'); await sleep(320);
    {
      const b = panelDefs.time._body;
      // The clock is its own key, not part of `state` - and deliberately not
      // in SKT_SYNC_KEYS, so it never syncs. It may not exist yet: the panel
      // writes it on the first advance, so tick once to materialise it before
      // taking the baseline, or "returns to the start" is comparing against
      // null and can never hold.
      const read = () => localStorage.getItem('skt-time-v1');
      const first = await click(b, '[data-delta-h="1"]');
      ok('time: +1h control exists', !!first, 'selector [data-delta-h="1"] gone');
      const t1 = read();
      ok('time: the clock key is written', t1 != null);
      await click(panelDefs.time._body, '[data-delta-h="1"]');
      ok('time: +1h advances the clock', read() !== t1);
      await click(panelDefs.time._body, '[data-delta-h="-1"]');
      ok('time: -1h returns to the same instant', read() === t1, 'clock did not reverse');
    }
    closePanel('time');

    openPanel('weather'); await sleep(320);
    {
      const before = errs.length;
      const hit = await click(panelDefs.weather._body, '#weather-reroll', 400);
      ok('weather: reroll control exists', !!hit, '#weather-reroll gone');
      ok('weather: reroll is silent', errs.length === before, errs.slice(before).join(' | '));
      ok('weather: panel still rendered', panelDefs.weather._body.children.length > 0);
    }
    closePanel('weather');

    openPanel('combat'); await sleep(340);
    {
      const at = () => String(state.activeCombatantId) + '#' + (state.combatRound || 0);
      const a0 = at();
      const hit = await click(panelDefs.combat._body, '[data-act="next"]', 320);
      ok('combat: next-turn control exists', !!hit, '[data-act="next"] gone');
      ok('combat: next advances the turn', !!hit && at() !== a0, 'still ' + a0);
      await click(panelDefs.combat._body, '[data-act="prev"]', 320);
      ok('combat: prev returns to the same turn', at() === a0, at() + ' vs ' + a0);
    }
    closePanel('combat');

    openPanel('loot'); await sleep(340);
    {
      const before = errs.length;
      const n0 = ((state.loot && state.loot.items) || []).length;
      const hit = await click(panelDefs.loot._body, '#loot-roll', 500);
      ok('loot: roll control exists', !!hit, '#loot-roll gone');
      ok('loot: roll is silent', errs.length === before, errs.slice(before).join(' | '));
      ok('loot: roll never destroys existing loot',
         ((state.loot && state.loot.items) || []).length >= n0);
    }
    closePanel('loot');

    openPanel('encounter'); await sleep(340);
    {
      const before = errs.length;
      const txt = () => (panelDefs.encounter._body.textContent || '');
      const h14 = await click(panelDefs.encounter._body, '[data-eact="sys"][data-sys="2014"]', 340);
      const t14 = txt();
      const h24 = await click(panelDefs.encounter._body, '[data-eact="sys"][data-sys="2024"]', 340);
      ok('encounter: both edition buttons exist', !!h14 && !!h24);
      ok('encounter: edition switch is silent', errs.length === before, errs.slice(before).join(' | '));
      ok('encounter: difficulty is named',
         /trivial|easy|medium|hard|deadly|low|moderate|high/i.test(txt()), 'no difficulty word');
      ok('encounter: the readout is not empty', t14.length > 0);
    }
    closePanel('encounter');

    openPanel('shop'); await sleep(340);
    {
      const before = errs.length;
      const hit = await click(panelDefs.shop._body, '[data-act="gen"]', 800);
      ok('shop: generate control exists', !!hit, '[data-act="gen"] gone');
      ok('shop: generate is silent', errs.length === before, errs.slice(before).join(' | '));
      const inv = (state.shop && state.shop.inventory) || [];
      ok('shop: generated a stocked inventory', inv.length > 0, inv.length + ' items');
      const free = inv.filter(i => !(Number(i.price) > 0));
      ok('shop: every item is priced above zero', free.length === 0,
         free.length + ' free, e.g. ' + free.slice(0, 3).map(i => i.name).join(', '));
    }
    closePanel('shop');

    openPanel('battlemap'); await sleep(450);
    {
      const d = panelDefs.battlemap;
      const before = errs.length;
      const n0 = (d._tokens || []).length;
      const hit = await click(d._body, '[data-mact="tool-add-pc"]', 420);
      ok('battlemap: add-PC control exists', !!hit, '[data-mact="tool-add-pc"] gone');
      ok('battlemap: add-PC is silent', errs.length === before, errs.slice(before).join(' | '));
      ok('battlemap: no token was lost', (d._tokens || []).length >= n0);
      const fit = await click(d._body, '[data-mact="fit-map"]', 340);
      ok('battlemap: fit control exists', !!fit, '[data-mact="fit-map"] gone');
      ok('battlemap: fit is silent', errs.length === before, errs.slice(before).join(' | '));
    }
    closePanel('battlemap');

    openPanel('turnview'); await sleep(450);
    {
      const before = errs.length;
      const targets = [...panelDefs.turnview._body.querySelectorAll('[data-tv="jump"][data-id]')];
      ok('turnview: jump targets render', targets.length > 0);
      if (targets.length > 1){
        const a0 = String(state.activeCombatantId);
        const other = targets.find(e => e.getAttribute('data-id') !== a0) || targets[0];
        const want = other.getAttribute('data-id');
        other.click();
        await sleep(360);
        ok('turnview: jump changes the active combatant',
           String(state.activeCombatantId) === want,
           'wanted ' + want + ' got ' + state.activeCombatantId);
      }
      ok('turnview: interaction is silent', errs.length === before, errs.slice(before).join(' | '));
    }
    closePanel('turnview');
  }

  // ══════════════════════════════════════════════════════════ player view
  if (MODE === 'player'){
    ok('player: body is in player mode', document.body.classList.contains('player-mode'));
    ok('player: turn bar rendered', !!document.querySelector('.pa-turn'));

    const tabs = [...document.querySelectorAll('.pa-tab')];
    ok('player: tabs rendered', tabs.length > 0, tabs.length + ' tabs');

    for (const tab of tabs){
      const label = (tab.textContent || '?').trim().slice(0, 12);
      const before = errs.length;
      tab.click();
      await sleep(430);
      ok('player tab silent: ' + label, errs.length === before, errs.slice(before).join(' | '));
      ok('player tab renders: ' + label,
         document.body.textContent.trim().length > 0 && !!document.querySelector('.pa-turn'));
    }

    // paRender is the player view's whole refresh path; it must be re-entrant,
    // because every incoming sync event calls it.
    if (typeof paRender === 'function'){
      const before = errs.length;
      try { paRender(); paRender(); } catch(e){ errs.push(e.message); }
      await sleep(240);
      ok('player: paRender is re-entrant', errs.length === before, errs.slice(before).join(' | '));
    }

    // A player is a RESTRICTED writer on the map. This allowlist is what stops
    // a phone that is momentarily behind from pushing its stale `meta` over
    // everyone's map, so it has to actually reject one.
    if (typeof _ENTITY_KEYS !== 'undefined'){
      const spec = _ENTITY_KEYS['skt-battlemap-v1'];
      const wr = spec && spec.playerWritable;
      ok('player: map has a write allowlist', typeof wr === 'function');
      if (typeof wr === 'function'){
        // The rule is `node in prev`: a player may MOVE a token the server
        // already knows about, but may not conjure one the DM never placed.
        const prev = { 'tokens/abc': '{}' };
        ok('player: may move an existing token', wr('tokens/abc', prev) === true);
        ok('player: may NOT create a new token', wr('tokens/zzz', prev) !== true);
        ok('player: may draw', wr('drawings', prev) === true);
        ok('player: may NOT overwrite map meta', wr('meta', prev) !== true);
        ok('player: may NOT overwrite fog', wr('fog', prev) !== true);
      }
    }

    ok('player: no horizontal overflow',
       document.documentElement.scrollWidth <= window.innerWidth + 1,
       document.documentElement.scrollWidth + ' > ' + window.innerWidth);
  }

  // ══════════════════════════════════════════════════════════ mobile / phone
  if (MODE === 'mobile'){
    ok('mobile: coarse pointer detected', matchMedia('(pointer:coarse)').matches);
    ok('mobile: page does not scroll sideways',
       document.documentElement.scrollWidth <= window.innerWidth + 1,
       document.documentElement.scrollWidth + ' > ' + window.innerWidth);

    for (const id of PANELS){
      const before = errs.length;
      try { openPanel(id); } catch(e){ ok('mobile mount ' + id, false, e.message); continue; }
      await sleep(300);
      const d = panelDefs[id];
      ok('mobile mount ' + id, d && d._body && d._body.children.length > 0, 'empty body');
      ok('mobile silent ' + id, errs.length === before, errs.slice(before).join(' | '));
      // The classic phone bug: a panel wider than the screen.
      ok('mobile fits ' + id,
         document.documentElement.scrollWidth <= window.innerWidth + 1,
         'doc ' + document.documentElement.scrollWidth + ' > vw ' + window.innerWidth);
      closePanel(id);
      await sleep(60);
    }

    // Turn View's map must not offer the hover-expand on a phone - the screen
    // is already small, which is why the expansion was taken out.
    openPanel('turnview'); await sleep(460);
    {
      const b = panelDefs.turnview._body;
      ok('mobile: turn view map has no expand affordance',
         !(b && b.querySelector('.tv-map-expand, [data-tv="expand-map"]')));
    }
    closePanel('turnview');
  }

  restore();

  const fails = R.filter(r => !r.pass);
  return [
    ...R.map(r => (r.pass ? 'pass  ' : 'FAIL  ') + r.n + (r.d ? '  -- ' + r.d : '')),
    '',
    (fails.length ? 'FAILED ' + fails.length + ' of ' : 'ALL ') + R.length + ' checks'
      + '   [' + MODE + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + 's]',
  ].join('\n');
})()
