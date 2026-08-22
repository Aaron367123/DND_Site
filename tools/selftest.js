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

    // 0. Preconditions. Every check below is only as good as the data it runs
    // against, and several of them pass for free when that data is missing.
    // The spell-slot check read "6 checked" one morning and "0 checked" that
    // afternoon — still printing pass — because the migration had run and the
    // pools no longer existed. Assert the bench is loaded before trusting a
    // single green line from it.
    {
      const party = JSON.parse(localStorage.getItem('skt-party-v1') || '[]');
      const combat = JSON.parse(localStorage.getItem('skt-combat-v1') || '{}');
      const map = JSON.parse(localStorage.getItem('skt-battlemap-v1') || '{}');
      const notes = JSON.parse(localStorage.getItem('skt-notes-v2') || '{}');
      const shop = JSON.parse(localStorage.getItem('skt-shop-v1') || '{}');
      const pools = party.reduce((n, c) => n +
        (c.resources || []).filter(r => /^Spell Slots L\d$/.test(r.name || '')).length, 0);
      const inv = (shop.inventory || []).map(i => i.name);
      const need = [
        ['at least 2 party members',        party.length >= 2],
        ['spell-slot pools to migrate',     pools > 0],
        ['at least 2 combatants',           (combat.combatants || []).length >= 2],
        ['a monster in the fight',          (combat.combatants || []).some(c => !c.isPC)],
        ['a qualifier-gated immunity',      (combat.combatants || []).some(c =>
                                              (c._immune || []).some(x => /nonmagical/i.test(x)))],
        ['at least 2 map tokens',           (map.tokens || []).length >= 2],
        ['notes to keep out of sight',      (notes.items || []).length >= 2],
        ['a shop with duplicate item names', inv.length > 0 && new Set(inv).size !== inv.length],
      ];
      const absent = need.filter(n => !n[1]).map(n => n[0]);
      ok('the test bench is loaded (' + (need.length - absent.length) + '/' + need.length + ')',
         absent.length === 0, 'missing: ' + absent.join(', ')
           + ' — run node tools/make-fixture.js, or the checks below pass for free');
    }

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

    // 2b. duplicate ids must not collapse two records onto one node. Every
    // path that creates a record assigns a unique id, but a restore, an
    // import or a hand-edited backup is not something the sync layer
    // controls — and the damage is quiet: the second write wins and
    // assemble() hands the SAME record back twice, so the count still looks
    // right while one creature's hp has become another's.
    {
      const dup = (k, data, count) => {
        const spec = _ENTITY_KEYS[k];
        const nodes = spec.explode(JSON.stringify(data));
        const pre = k === 'skt-battlemap-v1' ? 'tokens/' : 'items/';
        const n = Object.keys(nodes).filter(x => x.startsWith(pre)).length;
        ok('dup ids get distinct nodes: ' + k, n === count, n + ' nodes for ' + count + ' records');
        return JSON.parse(spec.assemble(nodes));
      };
      const c = dup('skt-combat-v1',
        { combatants:[{id:'z',name:'Zoey',hp:50},{id:'z',name:'Dup',hp:12},{id:'og',name:'Ogre',hp:59}],
          combatRound:2, activeCombatantId:'z' }, 3);
      ok('dup ids keep both combatants distinct',
         eqJ(c.combatants.map(x => x.name + '/' + x.hp), ['Zoey/50','Dup/12','Ogre/59']),
         JSON.stringify(c.combatants.map(x => x.name + '/' + x.hp)));
      const pty = dup('skt-party-v1', [{id:'x',name:'A'},{id:'x',name:'B'},{id:'y',name:'C'}], 3);
      ok('dup ids keep both characters distinct', eqJ(pty.map(x => x.name), ['A','B','C']),
         JSON.stringify(pty.map(x => x.name)));
      const nts = dup('skt-notes-v2',
        { items:[{id:'n',name:'One',type:'file'},{id:'n',name:'Two',type:'file'}], authors:{} }, 2);
      ok('dup ids keep both notes distinct', eqJ(nts.items.map(x => x.name), ['One','Two']),
         JSON.stringify(nts.items.map(x => x.name)));
      const bm = dup('skt-battlemap-v1', { tokens:[{id:'t',x:1},{id:'t',x:2}], cellSize:50 }, 2);
      ok('dup ids keep both tokens distinct',
         eqJ((bm.tokens || []).map(t => t.x).sort(), [1,2]));

      // ...and ordinary data must produce the SAME node names as before, or
      // every client re-pushes everything once on upgrade.
      const live = localStorage.getItem('skt-party-v1');
      if (live){
        const names = Object.keys(_ENTITY_KEYS['skt-party-v1'].explode(live))
          .filter(x => x.startsWith('items/'));
        ok('unique ids are left completely alone', !names.some(n => /__dup/.test(n)),
           names.filter(n => /__dup/.test(n)).join(','));
      }
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

    // 3b. A map change arriving from another device must reach the Turn View
    // even when the Battle Map panel is CLOSED — which is the normal case, as
    // the Turn View is the panel a DM keeps open. postApply used to call only
    // _reloadPanel('battlemap'), which returns immediately for an unmounted
    // panel, so a new grid type, cell size or Align offset landed in storage
    // and nothing redrew until the battle map was opened.
    {
      const K = 'skt-battlemap-v1', spec = _ENTITY_KEYS[K];
      const base = localStorage.getItem(K);
      if (base){
        openPanel('turnview'); await sleep(600);
        try { closePanel('battlemap'); } catch(e){}
        const T = panelDefs.turnview;
        ok('map sync: the battle map panel is closed for this check', !panelDefs.battlemap._body);
        ok('map sync: the turn view is open', !!T._body);

        let told = 0;
        const real = T._syncFromMap.bind(T);
        T._syncFromMap = function(){ told++; return real(); };

        const changed = JSON.parse(base);
        changed.gridType = changed.gridType === 'hex' ? 'square' : 'hex';
        changed.cellSize = (changed.cellSize || 50) + 30;
        _entityCache[K] = spec.explode(base);
        _applyEntitySnapshot(K, nest(spec.explode(JSON.stringify(changed))));
        await sleep(350);

        T._syncFromMap = real;
        ok('map sync: a remote grid change reaches the turn view with the map closed',
           told > 0, 'the turn view was never told');
        ok('map sync: and the new grid is what got stored',
           JSON.parse(localStorage.getItem(K)).gridType === changed.gridType);

        _remoteUpdate = true; localStorage.setItem(K, base); _remoteUpdate = false;
        delete _entityCache[K];
        closePanel('turnview');
      }
    }

    // 3c. The Turn View's grid colour must come from ITS OWN copy of the map.
    // _mapBgImage is only assigned when the Battle Map panel loads a map, and
    // that panel is usually closed — so reading the global meant the grid sat
    // on its white fallback, invisible on a pale map, until the Battle Map had
    // been opened once.
    //
    // The global has to be nulled deliberately here: the panel sweep above
    // opens the Battle Map, which populates it, and the check would pass with
    // the bug still present. The fixture's map is pale on purpose so "correct"
    // means a DARK grid and the two outcomes are distinguishable.
    {
      const savedBg = (typeof _mapBgImage !== 'undefined') ? _mapBgImage : null;
      try { _mapBgImage = null; } catch(e){}
      openPanel('turnview'); await sleep(900);
      const T = panelDefs.turnview;
      const own = T._bgImage();
      ok('turn view has its own copy of the map image', !!own);
      const lum = (typeof _bgLuminance === 'function') ? _bgLuminance(own) : null;
      ok('grid colour: luminance is read without the battle map panel',
         lum != null, 'got ' + lum);
      ok('grid colour: the fixture map reads as pale', lum != null && lum > 128, 'lum ' + lum);

      T._mapCache = null;
      try { T._placeTokens(); } catch(e){}
      await sleep(300);
      const cv = T._body && T._body.querySelector('.tv-map-draw');
      ok('grid colour: the thumbnail drew a grid', !!cv);
      if (cv){
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let dark = 0, light = 0;
        for (let i = 0; i < d.length; i += 4){
          if (d[i+3] < 8) continue;
          const l = (d[i]*299 + d[i+1]*587 + d[i+2]*114) / 1000;
          if (l < 96) dark++; else light++;
        }
        ok('grid colour: dark grid over a pale map, battle map never consulted',
           dark > light, dark + ' dark vs ' + light + ' light');
      }
      try { _mapBgImage = savedBg; } catch(e){}
      closePanel('turnview');
    }

    // 3d. Every grid control on the battle map must reach the Turn View's
    // thumbnail. It read gridType, cellSize, the Align offsets and gridColor,
    // but ignored Opacity and Width outright and applied a custom colour as
    // raw hex with no alpha — so three of the controls did nothing to the
    // panel a DM actually watches.
    {
      openPanel('turnview'); await sleep(700);
      openPanel('battlemap'); await sleep(700);
      const T = panelDefs.turnview, B = panelDefs.battlemap;
      const o0 = B._gridOpacity, w0 = B._gridWidth, c0 = B._gridColor;
      const ink = () => {
        const cv = T._body && T._body.querySelector('.tv-map-draw');
        if (!cv) return null;
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0, a = 0;
        for (let i = 0; i < d.length; i += 4){ if (d[i+3] > 4){ n++; a += d[i+3]; } }
        return { px: n, alpha: n ? Math.round(a / n) : 0 };
      };
      const set = async (op, w, col) => {
        B._gridOpacity = op; B._gridWidth = w; B._gridColor = col;
        B._saveMap(); await sleep(420); return ink();
      };
      const faint = await set(20, 1, null);
      const bold  = await set(100, 1, null);
      ok('grid: the Opacity slider reaches the turn view',
         faint && bold && bold.alpha > faint.alpha * 2,
         JSON.stringify({ faint, bold }));

      const thin  = await set(60, 1, null);
      const thick = await set(60, 4, null);
      // 1 vs 2 both fall under one device pixel at thumbnail scale and cannot
      // differ; 1 vs 4 must.
      ok('grid: the Width slider reaches the turn view',
         thin && thick && thick.px > thin.px,
         JSON.stringify({ thin, thick }));

      const auto = await set(60, 1, null);
      const red  = await set(60, 1, '#ff0000');
      ok('grid: a custom colour reaches the turn view',
         auto && red && (red.px !== auto.px || red.alpha !== auto.alpha),
         JSON.stringify({ auto, red }));

      B._gridOpacity = o0; B._gridWidth = w0; B._gridColor = c0;
      B._saveMap(); await sleep(200);
      closePanel('battlemap'); closePanel('turnview');
    }

    // Opportunity attacks. The rule lives in the Turn View because it owns the
    // initiative order and the reaction bookkeeping, but the trigger has to
    // reach it from the BATTLE MAP too — that is the map a DM drags on, and
    // the check used to sit inline in the Turn View's own drag handler only.
    //
    // Tokens are resolved through _tokenFor at the point of use, never held
    // across a step: an entity sync REPLACES the token objects, so a reference
    // captured at the top of this block is stale by the time it is read and
    // the geometry silently describes tokens that are no longer on the map.
    {
      openPanel('turnview'); await sleep(700);
      openPanel('battlemap'); await sleep(700);
      const T = panelDefs.turnview, B = panelDefs.battlemap;
      const cs = B._csScreen();
      const tokOf = id => T._tokenFor(T._order().find(c => c.id === id));
      const wolf = T._order().find(c => c.id === 'wolf');
      ok('oa: the bench has the tokens this needs',
         !!tokOf('zoey') && !!tokOf('wolf') && !!tokOf('ogre1') && !!wolf);
      if (tokOf('zoey') && tokOf('wolf') && tokOf('ogre1') && wolf){
        const tok0 = JSON.stringify(B._tokens), hp0 = wolf.hp;
        const provokes = (moverId, fx, fy, tx, ty) => {
          const w = tokOf('wolf'); w.x = 200; w.y = 200;
          const m = tokOf(moverId);
          T._pending = null;
          m.x = fx; m.y = fy;
          const from = { x: fx, y: fy };
          m.x = tx; m.y = ty;
          T._checkProvoke(m, from);
          return !!(T._pending && T._pending.kind === 'move');
        };
        delete wolf.reactionUsed; wolf.hp = 58;

        ok('oa: leaving reach provokes', provokes('zoey', 200+cs, 200, 200+cs*4, 200));
        ok('oa: the prompt carries the distance and the provoker', (() => {
          const p = T._pending;
          // rows are the COMBATANTS themselves, not {who,...} wrappers — the
          // prompt renders w.name straight off them.
          return !!(p && p.moved === 15 && (p.rows || []).some(r => r && r.id === 'wolf'));
        })(), JSON.stringify(T._pending && { ft: T._pending.moved }));
        ok('oa: moving within reach does not', !provokes('zoey', 200+cs, 200, 200, 200));
        ok('oa: starting out of reach does not', !provokes('zoey', 200+cs*5, 200, 200+cs*9, 200));

        wolf.reactionUsed = true;
        ok('oa: a spent reaction does not', !provokes('zoey', 200+cs, 200, 200+cs*4, 200));
        delete wolf.reactionUsed; wolf.hp = 0;
        ok('oa: a downed watcher does not', !provokes('zoey', 200+cs, 200, 200+cs*4, 200));
        wolf.hp = 58;
        // Side is strictly PC vs non-PC, so two monsters never provoke.
        ok('oa: a monster leaving a monster does not',
           !provokes('ogre1', 200+cs, 200, 200+cs*4, 200));

        // No Turn View means nowhere to prompt — a quiet no-op, not a throw.
        T._pending = null;
        closePanel('turnview');
        let threw = false;
        try { T._checkProvoke(tokOf('zoey') || { x:1, y:1 }, { x:0, y:0 }); } catch(e){ threw = true; }
        ok('oa: no throw when the turn view is closed', !threw);

        B._tokens = JSON.parse(tok0); wolf.hp = hp0; delete wolf.reactionUsed;
        T._pending = null;
      }
      closePanel('battlemap');
    }

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
         checked > 0 && lost.length === 0,
         checked === 0 ? 'NOTHING CHECKED — the fixture has no slot pools' : lost.join(', '));
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

    // 7d. Treasure tables. A d100 table with a gap silently rolls nothing, and
    // one with an overlap makes later rows unreachable — both are invisible in
    // play, you just never see that result. Hand-entered game data has already
    // been wrong once in this repo (19 of 20 encounter threshold rows), so the
    // invariant is worth pinning rather than trusting.
    if (panelDefs.loot && typeof panelDefs.loot._ensureLootTables === 'function'){
      let T = null;
      try { T = await panelDefs.loot._ensureLootTables(); } catch(e){}
      ok('treasure tables load', !!T);
      if (T){
        const broken = [];
        let tables = 0;
        const cover = (rows, label) => {
          if (!Array.isArray(rows) || !rows.length) return;
          if (typeof rows[0] !== 'object') return;      // a plain name list, not a roll table
          tables++;
          const hits = new Array(101).fill(0);
          rows.forEach(r => {
            const lo = r.min != null ? r.min : 1, hi = r.max != null ? r.max : lo;
            for (let n = lo; n <= hi; n++) if (n >= 1 && n <= 100) hits[n]++;
          });
          for (let n = 1; n <= 100; n++){
            if (hits[n] !== 1){ broken.push(label + ' @' + n + (hits[n] ? ' overlap' : ' gap')); break; }
          }
        };
        ['individual','hoard','dragon'].forEach(k => (T[k] || []).forEach(b => {
          cover(b.table, k + '/' + (b.name || ''));
          (b.table || []).forEach((r, i) => ['gems','artObjects','magicItems'].forEach(sub => {
            if (r[sub] && Array.isArray(r[sub].table)) cover(r[sub].table, k + ' row' + i + ' ' + sub);
          }));
        }));
        (T.magicItems || []).forEach((t, i) => cover(t.table, 'magicItems[' + i + ']'));
        ok('every d100 treasure table covers 1-100 exactly once (' + tables + ' tables)',
           broken.length === 0, broken.slice(0, 4).join('; '));

        // Every dice expression in the file must parse. loot has its own
        // parser (it needs "2d6*100", which sktRollDice does not do) and an
        // unparseable string returns 0 rather than throwing.
        const exprs = new Set();
        (function walk(v){
          if (typeof v === 'string'){ if (/\d\s*d\s*\d/i.test(v)) exprs.add(v); return; }
          if (Array.isArray(v)) return v.forEach(walk);
          if (v && typeof v === 'object') return Object.values(v).forEach(walk);
        })(T);
        const dead = [...exprs].filter(e => {
          for (let i = 0; i < 200; i++) if (panelDefs.loot._rollDice(e) !== 0) return false;
          return true;    // always zero across 200 rolls = a parse failure, not luck
        });
        ok('every treasure dice expression parses (' + exprs.size + ' distinct)',
           dead.length === 0, dead.slice(0, 4).join(', '));
      }
    }

    // 7e. Malformed state must not take a panel down. A key can arrive empty,
    // truncated or the wrong shape from a partial sync, a restore written
    // before a field existed, or a hand-edited backup - and a panel that
    // throws on mount is gone for the session with no way back but a reload.
    {
      const KEYS = ['skt-party-v1','skt-combat-v1','skt-shop-v1','skt-settings-v1',
        'skt-battlemap-v1','skt-enc-v1','skt-loot-v1','skt-notes-v2','skt-npcs-v2','skt-bestiary-v1'];
      const OWNER = { 'skt-party-v1':'party','skt-combat-v1':'combat','skt-shop-v1':'shop',
        'skt-settings-v1':'combat','skt-battlemap-v1':'battlemap','skt-enc-v1':'encounter',
        'skt-loot-v1':'loot','skt-notes-v2':'notes','skt-npcs-v2':'npclib','skt-bestiary-v1':'bestiary' };
      const BAD = { 'empty string':'', 'null literal':'null', 'empty object':'{}',
        'empty array':'[]', 'garbage':'{not json', 'wrong type':'\u0022a string\u0022',
        'nulls inside':'[null,null]' };
      const before = {}; KEYS.forEach(k => before[k] = localStorage.getItem(k));
      const casualties = [];
      for (const k of KEYS){
        for (const label of Object.keys(BAD)){
          const seen = [];
          const h = e => seen.push(e.message);
          window.addEventListener('error', h);
          try {
            _remoteUpdate = true; localStorage.setItem(k, BAD[label]); _remoteUpdate = false;
            ['party','combat','shop','settings'].forEach(d => { try { loadDomain(d); } catch(e){} });
            const id = OWNER[k];
            try { closePanel(id); } catch(e){}
            try { openPanel(id); } catch(e){ casualties.push(k + ' + ' + label + ' threw'); }
            await sleep(130);
            const d = panelDefs[id];
            if (!d || !d._body || !d._body.children.length) casualties.push(k + ' + ' + label + ' empty');
            else if (seen.length) casualties.push(k + ' + ' + label + ' ' + seen[0].slice(0, 40));
          } finally { window.removeEventListener('error', h); }
        }
        _remoteUpdate = true; localStorage.setItem(k, before[k]); _remoteUpdate = false;
      }
      _remoteUpdate = true;
      KEYS.forEach(k => { if (before[k] != null) localStorage.setItem(k, before[k]); });
      _remoteUpdate = false;
      ['party','combat','shop','settings'].forEach(d => { try { loadDomain(d); } catch(e){} });
      ok('every panel survives malformed state (' + (KEYS.length * Object.keys(BAD).length) + ' combinations)',
         casualties.length === 0, casualties.slice(0, 5).join('; '));
    }

    // 7f. A record missing hp or hpMax must not print NaN or "undefined" at
    // the DM. These arrive from a PDF import, a hand-typed monster or an old
    // record, and the maths already tolerates them — it was only the rendering
    // that leaked the gap onto the screen.
    {
      const P0 = JSON.stringify(state.party), K0 = JSON.stringify(state.combatants);
      const A0 = state.activeCombatantId;
      const SHAPES = {
        'no hpMax'     : { id:'st_x', name:'Nomax', hp:10 },
        'both missing' : { id:'st_x', name:'Blank' },
        'hp null'      : { id:'st_x', name:'Nully', hp:null, hpMax:20 },
        'hp zero'      : { id:'st_x', name:'Zero',  hp:0,    hpMax:20 },
        'hp as string' : { id:'st_x', name:'Str',   hp:'12', hpMax:'20' },
      };
      const spoiled = [];
      for (const label of Object.keys(SHAPES)){
        const rec = SHAPES[label];
        state.party = [Object.assign({}, rec)];
        state.combatants = [Object.assign({}, rec, { isPC:true, initiative:10 })];
        state.activeCombatantId = 'st_x'; save();
        for (const id of ['party','combat','turnview','attacks']){
          try { closePanel(id); } catch(e){}
          try { openPanel(id); } catch(e){ spoiled.push(label + '/' + id + ' threw'); continue; }
          await sleep(230);
          const d = panelDefs[id];
          if (!d || !d._body){ spoiled.push(label + '/' + id + ' no body'); continue; }
          const t = d._body.innerText || '';
          if (/\bNaN\b/.test(t)) spoiled.push(label + '/' + id + ' shows NaN');
          if (/\bundefined\b/.test(t)) spoiled.push(label + '/' + id + ' shows undefined');
          closePanel(id);
        }
      }
      ok('no panel prints NaN or undefined for a partial record (' +
         (Object.keys(SHAPES).length * 4) + ' combinations)',
         spoiled.length === 0, spoiled.slice(0, 5).join('; '));

      // The fallback must use ?? and not ||, or a character on exactly 0 hp
      // renders as a dash and looks like missing data at the worst moment.
      state.party = [{ id:'st_x', name:'Zero', hp:0, hpMax:20 }];
      state.combatants = [{ id:'st_x', name:'Zero', hp:0, hpMax:20, isPC:true, initiative:10 }];
      state.activeCombatantId = 'st_x'; save();
      openPanel('turnview'); await sleep(380);
      ok('a character on 0 hp still reads 0, not a dash',
         /\b0\b/.test(panelDefs.turnview._body.innerText || ''));
      closePanel('turnview');

      state.party = JSON.parse(P0); state.combatants = JSON.parse(K0);
      state.activeCombatantId = A0; save();
    }

    // 7g. Names are rendered into HTML all over the app, and anything with a
    // Firebase connection can write one — the DM's other tab, a player's
    // phone, a restored backup. Escaping has to hold in BOTH contexts: as text
    // between tags, and inside value="..." where only a quote can break out.
    {
      const P0 = JSON.stringify(state.party), K0 = JSON.stringify(state.combatants);
      const A0 = state.activeCombatantId;
      const TEXT = '<i class="sktxss">x</i>';        // becomes an element if unescaped
      const ATTR = '" data-sktpwn="1';               // breaks out of an attribute
      const PANELS7 = ['party','combat','turnview','attacks','battlemap','loot','npclib'];
      const seed = nm => {
        state.party = [{ id:'st_x', name:nm, cls:'fighter', hp:10, hpMax:10, ac:12, conditions:[nm] }];
        state.combatants = [{ id:'st_x', name:nm, isPC:true, hp:10, hpMax:10, ac:12,
                              initiative:10, conditions:[nm], concentration:nm }];
        state.activeCombatantId = 'st_x'; save();
      };
      const sweep = async sel => {
        const bad = [];
        for (const id of PANELS7){
          try { closePanel(id); } catch(e){}
          try { openPanel(id); } catch(e){ continue; }
          await sleep(230);
          const d = panelDefs[id];
          if (d && d._body && d._body.querySelectorAll(sel).length) bad.push(id);
          closePanel(id);
        }
        return bad;
      };
      seed(TEXT);
      const asText = await sweep('.sktxss');
      ok('a name containing HTML is escaped as text', asText.length === 0, asText.join(', '));
      seed(ATTR);
      const asAttr = await sweep('[data-sktpwn]');
      ok('a name containing a quote cannot break out of an attribute',
         asAttr.length === 0, asAttr.join(', '));

      // Positive control: the panels really did render the character, so the
      // two checks above are not passing because nothing was on screen.
      seed('PlainBob');
      try { closePanel('party'); } catch(e){}
      openPanel('party'); await sleep(380);
      ok('the injection sweep actually rendered the character',
         /PlainBob/.test(panelDefs.party._body.innerHTML));

      // ...and escaping must not corrupt the stored value.
      seed(ATTR);
      panelDefs.party._render(); await sleep(300);
      const inp = panelDefs.party._body.querySelector('.char-name');
      ok('an escaped name round-trips through the editor unchanged',
         !!inp && inp.value === ATTR, inp ? inp.value : 'no input');
      closePanel('party');

      state.party = JSON.parse(P0); state.combatants = JSON.parse(K0);
      state.activeCombatantId = A0; save();
    }

    // How the player view is opened, checked on the DESKTOP side where it is
    // observable. A phone takes the other branch and NAVIGATES in place —
    // Android gives an installed PWA no second window, so window.open there
    // yields a Chrome Custom Tab with an address bar over the player view.
    // That branch cannot be exercised here: clicking it leaves the page and
    // takes the test run with it.
    {
      const btn = document.getElementById('player-view-btn');
      ok('the player-view control exists', !!btn);
      if (btn){
        let call = null;
        const real = window.open;
        window.open = (u, t, f) => { call = { u:String(u), t, f: f || null }; return null; };
        try { btn.click(); } catch(e){}
        window.open = real;
        ok('desktop opens the player view in a window', !!call);
        if (call){
          ok('...at the player URL', /[?&]player=1/.test(call.u), call.u);
          // noopener is SPECIFIED to return null, which made the popup-blocked
          // toast fire on every success and killed the fallback navigate.
          ok('...without noopener, so the handle comes back',
             !/noopener/.test(call.f || ''), call.f);
          ok('...sized, so it is a second window rather than a full tab',
             /width=/.test(call.f || ''), call.f);
        }
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

      // Qualifiers this matcher cannot evaluate. "(from stoneskin)" IS
      // modellable — it is the spell's own nonmagical wording — and was being
      // read as unconditional, halving magic weapons on 28 stat blocks. The
      // rest (lighting, the attacker's alignment, a named weapon) still apply
      // in full, but the DM is told which condition to check.
      {
        const SS = ['bludgeoning, piercing, slashing (from stoneskin)'];
        const lastLog = () => { const l = state.combatLog || []; return l.length ? l[l.length-1].text : ''; };
        const shot = (facets, type, magical) => {
          state.combatants = [Object.assign({ id:'st_x', name:'Thing', hp:100, hpMax:100, isPC:false }, facets)];
          const pv = C._lastAtkProp; C._lastAtkProp = magical ? 'magical' : null;
          C._applyHpDelta(0, -20, type); C._lastAtkProp = pv;
          return { took: 100 - state.combatants[0].hp, log: lastLog() };
        };
        ok('stoneskin halves a mundane weapon', shot({_resist:SS},'slashing',false).took === 10);
        ok('stoneskin does NOT halve a magic weapon', shot({_resist:SS},'slashing',true).took === 20,
           'took ' + shot({_resist:SS},'slashing',true).took);
        const dim = shot({_resist:['bludgeoning, piercing, slashing while in dim light or darkness']},'slashing',false);
        ok('an unevaluable condition still applies', dim.took === 10);
        ok('...and says which condition to check', /check: .*dim light/.test(dim.log), dim.log.slice(-60));
        ok('an ordinary resistance stays quiet',
           !/check:/.test(shot({_resist:['fire']},'fire',false).log));
        ok('a nonmagical qualifier stays quiet',
           !/check:/.test(shot({_resist:["bludgeoning, piercing, slashing from nonmagical attacks"]},'slashing',false).log));
      }

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

      // The party card and the combat tracker must agree. They are two entry
      // points to the same event, and the party one used to skip both rules
      // that decide whether a character dies.
      {
        openPanel('party'); await sleep(360);
        const P = panelDefs.party;
        const inFight = extra => {
          state.party = [Object.assign({ id:'st_p', name:'Pat', hp:20, hpMax:20 }, extra || {})];
          state.combatants = [Object.assign({ id:'st_p', name:'Pat', hp:20, hpMax:20, isPC:true },
                                            (extra && extra._c) || {})];
          save();
        };
        const solo = extra => {
          state.party = [Object.assign({ id:'st_p', name:'Pat', hp:20, hpMax:20 }, extra || {})];
          state.combatants = []; save();
        };
        inFight({ hp:5, _c:{ hp:5 } }); P._applyHpDelta(0,-30,'fire');
        ok('party card: massive damage kills', !!state.combatants[0].dead);
        inFight({ hp:5, _c:{ hp:5 } }); P._applyHpDelta(0,-24,'fire');
        ok('party card: one short does not kill', !state.combatants[0].dead);
        inFight({ hp:0, _c:{ hp:0, deathSaves:{success:0,fail:0} } }); P._applyHpDelta(0,-3,'fire');
        ok('party card: damage at 0 costs a death save',
           eqJ(state.combatants[0].deathSaves, {success:0,fail:1}),
           JSON.stringify(state.combatants[0].deathSaves));
        inFight({ resistances:['fire'], _c:{} }); P._applyHpDelta(0,-21,'fire');
        ok('party card: resistance still halves', 20 - state.combatants[0].hp === 10);
        inFight({ tempHp:5, _c:{} }); P._applyHpDelta(0,-8,'fire');
        ok('party card: temp hp still absorbs',
           state.party[0].tempHp === 0 && state.combatants[0].hp === 17);
        inFight({ _c:{} }); P._applyHpDelta(0,+5,null);
        ok('party card: healing caps at max', state.combatants[0].hp === 20);
        // Out of combat there is no combatant to hold death saves, so the
        // local path stays and must still be right.
        solo({ resistances:['fire'] }); P._applyHpDelta(0,-21,'fire');
        ok('out of combat: resistance still halves', 20 - state.party[0].hp === 10);
        solo(); P._applyHpDelta(0,-50,'fire');
        ok('out of combat: hp still clamps at 0', state.party[0].hp === 0);
        closePanel('party');
      }

      // Death saves. Every one of these is a printed rule with one right
      // answer, and they decide whether a character lives.
      {
        const force = v => sktSetRandom(() => (v - 1) / 20 + 1e-9);
        const downed = extra => {
          state.party = [{ id:'st_p', name:'Pat', hp:0, hpMax:20 }];
          state.combatants = [Object.assign({ id:'st_p', name:'Pat', hp:0, hpMax:20,
            isPC:true, deathSaves:{ success:0, fail:0 } }, extra || {})];
          state.activeCombatantId = 'st_p'; save(); T._render();
          return state.combatants[0];
        };
        const dsv = () => state.combatants[0].deathSaves;

        force(20); downed(); T._rollDeathSave();
        ok('death: nat 20 wakes them at 1 hp',
           state.combatants[0].hp === 1 && dsv() == null && !state.combatants[0].dead);
        force(1);  downed(); T._rollDeathSave();
        ok('death: nat 1 is two failures', eqJ(dsv(), {success:0,fail:2}), JSON.stringify(dsv()));
        force(1);  downed(); T._rollDeathSave(); T._rollDeathSave();
        ok('death: two nat 1s kill', !!state.combatants[0].dead);
        force(10); downed(); T._rollDeathSave();
        ok('death: 10 is a success', eqJ(dsv(), {success:1,fail:0}));
        force(9);  downed(); T._rollDeathSave();
        ok('death: 9 is a failure', eqJ(dsv(), {success:0,fail:1}));
        force(15); downed(); T._rollDeathSave(); T._rollDeathSave(); T._rollDeathSave();
        ok('death: three successes stabilise',
           dsv() == null && !!state.combatants[0].stable);
        sktSetRandom(null);

        downed(); C._applyHpDelta(0,-3,'fire');
        ok('death: damage at 0 hp is a failure', eqJ(dsv(), {success:0,fail:1}));
        downed({ stable:true, deathSaves:null }); C._applyHpDelta(0,-3,'fire');
        ok('death: damage un-stabilises with a failure',
           !state.combatants[0].stable && eqJ(dsv(), {success:0,fail:1}));
        downed({ deathSaves:{success:1,fail:2} }); C._applyHpDelta(0,+5,null);
        ok('death: healing above 0 clears the saves',
           state.combatants[0].hp === 5 && (dsv() || null) == null);

        // PHB: a critical hit at 0 hp is TWO failures, not one.
        let tg = downed(); T._applyDamage(tg,[{amt:5,type:'slashing'}],false,false);
        ok('death: an ordinary hit at 0 hp is one failure', eqJ(dsv(), {success:0,fail:1}));
        tg = downed(); T._applyDamage(tg,[{amt:5,type:'slashing'}],false,true);
        ok('death: a CRIT at 0 hp is two failures', eqJ(dsv(), {success:0,fail:2}),
           JSON.stringify(dsv()));
        tg = downed({ deathSaves:{success:0,fail:1} });
        T._applyDamage(tg,[{amt:5,type:'slashing'}],false,true);
        ok('death: a crit at one failure kills', !!state.combatants[0].dead);
        tg = downed({ stable:true, deathSaves:null });
        T._applyDamage(tg,[{amt:5,type:'slashing'}],false,true);
        ok('death: a crit on a stable PC is two failures', eqJ(dsv(), {success:0,fail:2}));
        ok('death: the crit flag does not outlive the blow', C._lastAtkCrit === false);
        tg = downed(); C._applyHpDelta(0,-5,'slashing');
        ok('death: a bare hp tick is not a crit', eqJ(dsv(), {success:0,fail:1}));
      }

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

    // Encounter multipliers, including the party-size rule most tools skip.
    openPanel('encounter'); await sleep(360);
    {
      const E = panelDefs.encounter;
      const S0 = E._partySize, M0 = JSON.stringify(E._monsters);
      const mult = (size, count) => {
        E._partySize = size; E._monsters = [{ name:'X', cr:'1', count }];
        return E._calcXP().mult;
      };
      const cases = [
        [4, 1,  1,   'one monster'],
        [4, 2,  1.5, 'two monsters'],
        [4, 4,  2,   'three to six'],
        [5, 8,  2.5, 'seven to ten'],
        [4, 12, 3,   'eleven to fourteen'],
        [4, 20, 4,   'fifteen or more'],
      ];
      cases.forEach(([sz, n, want, what]) => {
        const got = mult(sz, n);
        ok('xp mult: ' + what + ' is x' + want, got === want, 'got x' + got);
      });
      // DMG p.83 — the rule that was missing entirely.
      const sizeCases = [
        [6, 4,  1.5, 'six PCs step down'],
        [7, 8,  2,   'seven PCs step down'],
        [6, 1,  0.5, 'six PCs vs one monster go to x0.5'],
        [2, 4,  2.5, 'two PCs step up'],
        [1, 1,  1.5, 'a solo PC steps up'],
        [2, 20, 4,   'stepping up clamps at x4'],
        [3, 4,  2,   'three PCs are not adjusted'],
        [5, 4,  2,   'five PCs are not adjusted'],
      ];
      sizeCases.forEach(([sz, n, want, what]) => {
        const got = mult(sz, n);
        ok('xp mult: ' + what, got === want, 'got x' + got);
      });
      E._partySize = S0; E._monsters = JSON.parse(M0);
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

    // Monster numbers must not reach a player's screen when the DM has hidden
    // them. Scanned against the whole DOM rather than the one element that
    // renders HP, because a leak is just as real in a title attribute.
    {
      const K0 = JSON.stringify(state.combatants), M0 = (state.settings || {}).monsterStatsMode;
      const SH = JSON.stringify(state.sharedPanels || []);
      state.combatants = [
        { id:'st_pc', name:'Zoey', hp:32, hpMax:55, isPC:true,  ac:17, initiative:15 },
        { id:'st_og', name:'Ogre', hp:23, hpMax:59, isPC:false, ac:11, initiative:8 }];
      state.activeCombatantId = 'st_og';
      state.sharedPanels = ['combat','battlemap','party'];
      save();
      const leaks = () => {
        const html = document.body.innerHTML, text = document.body.innerText;
        if (/23\s*\/\s*59/.test(html) || /23\s*\/\s*59/.test(text)) return 'body';
        const attr = [...document.querySelectorAll('[title],[aria-label]')].some(e =>
          /23\s*\/\s*59/.test((e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || '')));
        return attr ? 'attribute' : '';
      };
      const paint = async m => {
        state.settings.monsterStatsMode = m; save();
        if (typeof paRender === 'function') paRender();
        if (panelDefs.combat && panelDefs.combat._body) panelDefs.combat._render();
        await sleep(320);
      };
      await paint('show');
      ok('player: monster hp IS shown when the DM allows it', leaks() === 'body');
      await paint('conceal');
      ok('player: concealed monster hp does not leak', leaks() === '', 'leaked via ' + leaks());
      await paint('hide');
      ok('player: hidden monster hp does not leak', leaks() === '', 'leaked via ' + leaks());
      ok('player: their own character is still visible',
         /32\s*\/\s*55/.test(document.body.innerText));
      // The mode reader must fail closed if it cannot reach the DM's setting.
      const realC = panelDefs.combat;
      panelDefs.combat = undefined;
      ok('player: an unreachable stats setting defaults to hidden', paStatsMode() === 'hide');
      panelDefs.combat = realC;
      state.combatants = JSON.parse(K0);
      state.sharedPanels = JSON.parse(SH);
      if (M0) state.settings.monsterStatsMode = M0;
      save();
    }

    // Loot is a full player-facing tab, unrestricted by choice: the party's
    // haul is the party's business, so claiming, splitting and adding are all
    // theirs. That is why loot.js needs no player-mode branches — but it also
    // means a regression here hands players a panel that does not work rather
    // than one that is merely read-only, so it is worth pinning.
    {
      const SH = JSON.stringify(state.sharedPanels || []);
      ok('loot is offered as shareable', typeof PA_SHAREABLE !== 'undefined'
         && PA_SHAREABLE.has('loot'));
      state.sharedPanels = ['loot']; save();
      paRender(); await sleep(600);
      const tab = [...document.querySelectorAll('.pa-tab')].find(t => /loot/i.test(t.textContent));
      ok('sharing loot produces a Loot tab', !!tab);
      if (tab){
        tab.click(); await sleep(900);
        const L = panelDefs.loot;
        ok('the loot panel mounts for a player', !!(L && L._body && L._body.children.length));
        if (L && L._body){
          ok('a player can see the coin totals', !!L._body.querySelector('.loot-summary'));
          ok('a player gets the full controls',
             !!L._body.querySelector('#loot-roll') && !!L._body.querySelector('#loot-divvy')
             && !!L._body.querySelector('#loot-add-item'),
             'missing one of roll/divvy/add');
          ok('a player can claim items',
             L._body.querySelectorAll('[data-lact="paid"]').length > 0);
          ok('the loot panel does not overflow the screen',
             document.documentElement.scrollWidth <= window.innerWidth + 1,
             document.documentElement.scrollWidth + ' > ' + window.innerWidth);
      // A popout raised from a panel mounted in the player view. There is no
      // workspace canvas here, so createFloatingWindow appended to null and
      // threw — every detail popout died that way, the Loot tab's item button
      // being simply the first one clicked. It also has to FIT: .window carries
      // desktop sizing and a 240px floor, and body.player-mode is zoom:2 on a
      // phone, so the default came out at twice the viewport.
      {
        const before = errs.length;
        const info = panelDefs.loot._body.querySelector('[data-lact="info"]');
        ok('loot rows offer an item-detail button', !!info);
        if (info){
          info.click();
          await sleep(800);
          const w = document.querySelector('.window[data-ephemeral="1"]');
          ok('a detail popout opens in the player view', !!w);
          ok('...without throwing', errs.length === before, errs.slice(before).join(' | '));
          if (w){
            const r = w.getBoundingClientRect();
            ok('the popout is attached to the body, not a missing canvas',
               w.parentElement === document.body);
            ok('the popout fits on screen',
               r.left >= -2 && r.top >= -2 && r.right <= window.innerWidth + 2
               && r.bottom <= window.innerHeight + 2,
               Math.round(r.width) + 'x' + Math.round(r.height) + ' at ' +
               Math.round(r.left) + ',' + Math.round(r.top) +
               ' in ' + window.innerWidth + 'x' + window.innerHeight);
            ok('the popout has content', !!(w.querySelector('.window-body') || {}).innerHTML);
            const close = w.querySelector('[data-wact="close"]');
            ok('the popout can be closed', !!close);
            if (close){
              close.click(); await sleep(300);
              ok('closing removes it', !document.querySelector('.window[data-ephemeral="1"]'));
            }
          }
        }
      }

        }
      }
      // Unsharing must take the tab away again.
      state.sharedPanels = []; save();
      paRender(); await sleep(500);
      ok('unsharing loot removes the tab',
         ![...document.querySelectorAll('.pa-tab')].some(t => /loot/i.test(t.textContent)));
      state.sharedPanels = JSON.parse(SH); save();
      paRender(); await sleep(300);
    }

    // Fog of war. A player must not see the map under fog, and must not see a
    // monster standing in it. Checked at the PIXEL level as well as the DOM,
    // because "hidden" that is only CSS is still readable by anyone curious.
    {
      const SH = JSON.stringify(state.sharedPanels || []);
      state.sharedPanels = ['battlemap']; save();
      if (typeof paRender === 'function') paRender();
      await sleep(500);
      const tab = [...document.querySelectorAll('.pa-tab')].find(t => /map/i.test(t.textContent));
      if (tab){ tab.click(); await sleep(800); }
      const B = panelDefs.battlemap;
      ok('player: the shared map mounts', !!(B && B._body));
      if (B && B._body){
        const tok0 = JSON.stringify(B._tokens || []);
        const fog0 = B._fog, str0 = B._fogStrokes;
        const cs = B._csScreen();
        B._tokens = [
          { id:'st_pc', label:'Zoey', name:'Zoey', isPC:true,  x:cs*1.5, y:cs*1.5, size:1 },
          { id:'st_mo', label:'Ogre', name:'Ogre', isPC:false, x:cs*5.5, y:cs*5.5, size:1 }];
        B._fog = new Set(['1,1']); B._fogStrokes = [];
        B._renderTokens(); B._drawFog();
        await sleep(320);
        const fc = B._body.querySelector('#fog-canvas');
        const stage = B._body.querySelector('#map-stage');
        ok('player: the fog layer exists', !!fc);
        if (fc && stage){
          // The canvas is sized in VIEW-SCALED pixels while token coordinates
          // and _isFogged are in stage pixels, so sampling needs the ratio.
          // Reading stage coords straight off the canvas looks like a fog bug
          // and is not one.
          const g = fc.getContext('2d');
          const k = fc.width / (stage.offsetWidth || fc.width);
          const at = (sx, sy) => g.getImageData(Math.round(sx*k), Math.round(sy*k), 1, 1).data[3];
          ok('player: fog is fully opaque over an unrevealed cell',
             at(cs*5.5, cs*5.5) === 255, 'alpha ' + at(cs*5.5, cs*5.5));
          ok('player: a revealed cell is see-through',
             at(cs*1.5, cs*1.5) === 0, 'alpha ' + at(cs*1.5, cs*1.5));
        }
        ok('player: a monster in fog is absent from the DOM, not just hidden',
           !/Ogre/.test(B._body.innerHTML));
        ok('player: a PC in a revealed cell is drawn', /Zoey/.test(B._body.innerHTML));
        B._tokens = JSON.parse(tok0); B._fog = fog0; B._fogStrokes = str0;
        try { B._renderTokens(); B._drawFog(); } catch(e){}
      }
      state.sharedPanels = JSON.parse(SH); save();
    }

    // The player view must be escapable. On a phone it replaces the DM view in
    // the same window — Android gives an installed PWA no second window — so
    // without this the only way back is the URL bar, which a standalone app
    // does not show.
    {
      const back = document.getElementById('player-view-btn');
      ok('player: a way back to the DM view exists', !!back);
      if (back){
        const cs = getComputedStyle(back);
        ok('player: the back control is visible', cs.display !== 'none'
           && back.getBoundingClientRect().width > 0, 'display ' + cs.display);
        ok('player: it is labelled as the way back',
           /back to dm/i.test(back.getAttribute('title') || ''),
           back.getAttribute('title'));
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

    // Party cards must use the row they are given. The grid used a FIXED track
    // width, so every leftover pixel pooled dead on the right — and because
    // partyCardWidth syncs, a width chosen on a monitor followed the DM onto
    // their phone and stranded 89px of a 362px row.
    {
      openPanel('party'); await sleep(800);
      const b = panelDefs.party._body;
      const card = b.querySelector('.char-card');
      ok('party: a card renders', !!card);
      if (card){
        const grid = card.parentElement;
        const R = e => e.getBoundingClientRect();
        const top = R(card).top;
        const row = [...grid.children].filter(c => Math.abs(R(c).top - top) < 2);
        const pad = parseFloat(getComputedStyle(grid).paddingRight) || 0;
        const dead = R(grid).right - R(row[row.length - 1]).right - pad;
        ok('party: the last card in a row reaches the edge (' + Math.round(dead) + 'px slack)',
           dead < 24, Math.round(dead) + 'px dead to the right of ' + row.length + ' card(s)');
      }
      closePanel('party');
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
