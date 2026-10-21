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
        // Settings must be inside the ranges the app actually uses, or the
        // bench measures the wrong thing silently. fontScale is a MULTIPLIER
        // and applyFontScale clamps to [0.5, 2]; the fixture once held 100,
        // which clamped to 2 and ran every DM-mode pixel measurement at
        // double zoom.
        ['a sane fontScale', (() => {
          const fs = (JSON.parse(localStorage.getItem('skt-settings-v1') || '{}') || {}).fontScale;
          return fs == null || (fs >= 0.5 && fs <= 2);
        })()],
        ['no stray body zoom', (() => {
          const z = parseFloat(getComputedStyle(document.body).zoom);
          return !z || Math.abs(z - 1) < 0.01 || document.body.classList.contains('player-mode');
        })()],
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

      // Layout invariants for this row. Read the caveat before trusting them:
      // they PASS, but I could not make them fail. Reverting the CSS that
      // fixed the reported overlap — flex-wrap on the summary, flex-shrink on
      // the pill, the abbreviated label — leaves all three green, because the
      // harness renders the card at 168px and that is evidently wide enough
      // to avoid the squeeze that broke it in the real workspace.
      //
      // So treat these as assertions about invariants that ought to hold, not
      // as a guard proven to catch the bug they were written for. The checks
      // that ARE mutation-proven are the markup ones above (details element,
      // description present) and the shared abbreviation. What actually fixed
      // the overlap was flex-wrap on .feat-block summary plus margin-left:auto
      // on .feat-cost, confirmed by eye and by measuring the rendered card.
      {
        const P0 = JSON.stringify(state.party);
        state.party = [{ id:'zzlay', name:'ZZ Layout', cls:'Monk', level:6, subclass:'Mercy',
                         hp:9, hpMax:9, ac:14,
                         sheet:{ bio:{ features:[
                           '* Monk Focus • PHB-2024 101 ',
                           'Step of the Wind. You can expend 1 Focus Point to Dash and Disengage. ',
                           '   | Step of the Wind: 1 Bonus Action ',
                         ].join(String.fromCharCode(10)) } },
                         resources:[{name:'Focus Points',type:'pool',current:5,max:6}] }];
        panelDefs.party._render(); await sleep(300);
        const tab = [...document.querySelectorAll('button,[data-tab]')]
          .find(b => /^features$/i.test((b.textContent || '').trim()));
        if (tab){ tab.click(); await sleep(300); }
        const rows = [...document.querySelectorAll('details.feat-block')].filter(d => {
          const p = d.querySelector('.feat-lvl');
          return p && p.classList.contains('act');
        });
        ok('acts/layout: the row renders in a real card', rows.length > 0);
        if (rows.length){
          // scrollWidth beyond clientWidth means the flex item was squashed
          // below the width its own text needs — the overlap, measured.
          const pill = rows[0].querySelector('.feat-lvl');
          ok('acts/layout: the action pill is not squashed',
             pill.scrollWidth <= pill.clientWidth + 1,
             pill.textContent + ': ' + pill.scrollWidth + ' into ' + pill.clientWidth);
          // Nothing inside the summary may hang outside it.
          const sum = rows[0].querySelector('summary');
          const sb = sum.getBoundingClientRect();
          ok('acts/layout: nothing spills out of the row',
             [...sum.children].every(el => {
               const b = el.getBoundingClientRect();
               return b.right <= sb.right + 1 && b.left >= sb.left - 1;
             }));
          // A name broken one word per line is three or four lines tall.
          ok('acts/layout: the name is not shredded into single words',
             sb.height <= 70, String(Math.round(sb.height)));
        }
        state.party = JSON.parse(P0); panelDefs.party._render(); await sleep(200);
      }

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

    // One pool must not appear twice under two names. The monk's Ki Points is
    // the 2024 rules' Focus Points; the PDF importer derived the old name while
    // this app's own class template used the new one, and the import merged by
    // EXACT string — so importing a monk sheet gave the character both, side by
    // side, each spendable.
    {
      ok('resource aliases: Ki Points canonicalises to Focus Points',
         sktCanonResource('Ki Points') === 'Focus Points');
      ok('resource aliases: case and spacing do not matter',
         sktCanonResource('  ki points ') === 'Focus Points');
      ok('resource aliases: an unrelated pool is left alone',
         sktCanonResource('Rage') === 'Rage');

      const folded = sktMergeResources([
        { name:'Focus Points', type:'pool', current:2, max:6 },
        { name:'Flight',       type:'toggle', current:1, max:1 },
        { name:'Ki Points',    type:'pool', current:6, max:6 },
      ]);
      ok('resource merge: the duplicate collapses', folded.length === 2,
         JSON.stringify(folded.map(r => r.name)));
      // A fresh import must not hand back points already spent, so the SMALLER
      // current wins while the larger maximum does.
      const fp = folded.find(r => r.name === 'Focus Points');
      ok('resource merge: spending survives the merge',
         !!fp && fp.current === 2 && fp.max === 6,
         JSON.stringify(fp));
      ok('resource merge: unrelated pools are untouched',
         sktMergeResources([{ name:'Rage', current:2, max:3 },
                            { name:'Wild Shape', current:1, max:2 }]).length === 2);
      ok('resource merge: running it twice changes nothing',
         JSON.stringify(sktMergeResources(folded)) === JSON.stringify(folded));

      // And the load path applies it, so a character already carrying both is
      // repaired without anyone editing anything.
      const P0 = localStorage.getItem('skt-party-v1');
      const doubled = JSON.parse(P0);
      if (doubled[0]){
        doubled[0].resources = [
          { name:'Focus Points', type:'pool', current:4, max:6 },
          { name:'Ki Points',    type:'pool', current:6, max:6 },
        ];
        _remoteUpdate = true; localStorage.setItem('skt-party-v1', JSON.stringify(doubled));
        _remoteUpdate = false;
        loadDomain('party');
        const got = (state.party[0].resources || []).map(r => r.name);
        ok('resource merge: loading a doubled character repairs it',
           got.length === 1 && got[0] === 'Focus Points', JSON.stringify(got));
        _remoteUpdate = true; localStorage.setItem('skt-party-v1', P0); _remoteUpdate = false;
        loadDomain('party');
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

      // ── Entry text that never reached the screen ──────────────────────────
      // 5etools nests a named sub-entry as "itemSub", and puts its body in
      // "entry" (singular) as often as in "entries". The parser had a case for
      // "item" only, and its default branch read "entries" alone — so the node
      // produced nothing while the list around it still emitted its bullet.
      // The Vampire's four flaws and the Beholder's ten eye rays printed as a
      // column of empty dots; 34 bestiary entries were affected.
      if (typeof _5eData !== 'undefined' && typeof _5eLoaded !== 'undefined' && _5eLoaded){
        const mons = Array.from(_5eData || []).filter(r => r.cat === 'monster' && r._raw);
        const blocks = r => [].concat(r._raw.special_abilities || [], r._raw.actions || [],
                                      r._raw.bonus_actions || [], r._raw.reactions || [],
                                      r._raw.legendary_actions || []);
        const findBlock = (nm, src, re) => {
          const m = mons.find(r => r.name === nm && r._source === src);
          return m ? (blocks(m).find(a => re.test(a.name)) || null) : null;
        };

        const vamp = findBlock('Vampire', 'MM', /Weakness/i);
        ok('5e: a vampire lists its flaws instead of empty bullets',
           !!vamp && /Sunlight Hypersensitivity/.test(vamp.desc) && /radiant/.test(vamp.desc),
           vamp ? JSON.stringify(vamp.desc.slice(0, 90)) : 'trait not found');

        // The beholder is the worst case — the eye rays ARE the monster, and all
        // ten of them were blank.
        const eyes = findBlock('Beholder', 'MM', /Eye Rays/i);
        const rays = eyes ? (eyes.desc.match(/• /g) || []).length : 0;
        ok('5e: all ten of a beholder eye rays have text',
           rays === 10 && /Disintegration Ray/.test(eyes.desc) && /Death Ray/.test(eyes.desc),
           eyes ? rays + ' bullets' : 'action not found');

        // The invariant behind both: a bullet with nothing after it means the
        // parser met a shape it could not read. Swept corpus-wide, so a future
        // entry type needing a case here is caught the day the data adds it.
        const blank = [];
        for (const r of mons){
          for (const a of blocks(r)){
            if (/•\s*(\n|$)/.test(a.desc || '')) blank.push(r.name + '/' + a.name);
          }
        }
        ok('5e: no stat block in the bestiary has an empty bullet',
           blank.length === 0, blank.slice(0, 5).join(', '));

        // Spellcasting is its own structure, not an entries array, and nothing
        // read it — 1,125 monsters lost their spells outright. The MM Lich came
        // out as three traits and one action.
        const lich = findBlock('Lich', 'MM', /^Spellcasting/i);
        ok('5e: a lich brings its prepared spells with it',
           !!lich && /Power word kill/i.test(lich.desc) && /9th level \(1 slot\)/.test(lich.desc),
           lich ? JSON.stringify(lich.desc.slice(0, 90)) : 'no Spellcasting block');

        const hag = findBlock('Green Hag', 'MM', /Spellcasting/i);
        ok('5e: an innate caster lists its at-will spells',
           !!hag && /At will/.test(hag.desc) && /Vicious mockery/i.test(hag.desc),
           hag ? JSON.stringify(hag.desc.slice(0, 90)) : 'no Spellcasting block');

        // "displayAs" decides which part of the stat block the spellcasting
        // belongs to: a 2024 caster files it under Actions, a 2014 one under
        // Traits. Routing everything into one bucket would still pass every
        // check above, so both directions are asserted.
        let scTrait = 0, scAction = 0;
        for (const r of mons){
          if ((r._raw.special_abilities || []).some(a => /Spellcasting/i.test(a.name))) scTrait++;
          if ((r._raw.actions || []).some(a => /Spellcasting/i.test(a.name))) scAction++;
        }
        ok('5e: spellcasting is filed as a trait where the block says so', scTrait > 100, String(scTrait));
        ok('5e: and as an action where it says that instead', scAction > 100, String(scAction));
      }

      // Having the text is not the same as it being readable. Monster traits
      // and actions were rendered by a helper that inlined the whole
      // description, so every newline in it collapsed to a space — the flaws
      // above would have arrived as one run-on sentence and the lich's spell
      // levels as one line. Spells and conditions never had the problem; they
      // always went through the block renderer.
      if (typeof _5eData !== 'undefined' && typeof _5eLoaded !== 'undefined' && _5eLoaded
          && typeof buildDetailBody === 'function'){
        const row = nm => Array.from(_5eData).find(r => r.cat === 'monster' && r.name === nm && r._source === 'MM');
        const vHtml = row('Vampire') ? buildDetailBody(row('Vampire')) : '';
        const lHtml = row('Lich')    ? buildDetailBody(row('Lich'))    : '';
        ok('5e: a bulleted trait renders as a real list, not one paragraph',
           /<ul class="detail-list"><li><strong class="detail-label">Forbiddance\./.test(vHtml),
           vHtml ? 'no detail-list after the flaws intro' : 'no Vampire row');
        ok('5e: a caster spell levels each get their own line',
           /<br><strong class="detail-label">Cantrips \(at will\)\./.test(lHtml),
           lHtml ? 'spell levels not broken onto lines' : 'no Lich row');
        // The parser's private markers must never survive into the HTML.
        ok('5e: no parser marker leaks into the rendered stat block',
           !/[-]/.test(vHtml + lHtml));
      }

      // ── Notes: the DM's "Show to players" switch ──────────────────────────
      // Which note is open is per-device on purpose, so sharing is a flag on
      // the note itself — the only thing that can reach a player's phone.
      if (panelDefs.notes){
        const N = panelDefs.notes;
        const N0 = localStorage.getItem('skt-notes-v2'), view0 = N._view;
        const toasts = [], rt = window.showToast;
        window.showToast = m => toasts.push(String(m));
        try {
          openPanel('notes'); await sleep(300);
          N._data = null; N.mount(N._body); N._view = 'local'; N._render(); await sleep(100);
          const btn = () => N._body.querySelector('[data-act="notes-share"]');
          ok('notes: an open note has a "Show to players" switch', !!btn());
          const id = N._selected() && N._selected().id;
          if (btn()) btn().click();
          await sleep(120);
          const stored = (JSON.parse(localStorage.getItem('skt-notes-v2') || '{}').items || []).find(i => i.id === id) || {};
          ok('notes: switching it on marks the note shared, and saves it', stored.shared === true);
          ok('notes: the switch shows that it is on', btn() && btn().getAttribute('aria-pressed') === 'true');
          ok('notes: a shared note is marked in the tree',
             !!N._body.querySelector('.notes-file.selected .notes-shared-mark'));
          if (btn()) btn().click();
          await sleep(120);
          ok('notes: switching it off hides it from players again', N._selected().shared === false);
        } finally {
          window.showToast = rt;
          if (N0 != null) localStorage.setItem('skt-notes-v2', N0);
          N._data = null; N._view = view0; try { N.mount(N._body); closePanel('notes'); } catch(e){}
        }
      }

      // ── Encounter builder → combat keeps the stat block it picked ─────────
      // "Push to Combat Tracker" handed combat {name, hp, ac, dex}, so every
      // pushed monster lost its resistances, immunities, source, portrait and
      // legendary actions. Combat's fallback looks the monster up by NAME,
      // which guesses between the 2014 and 2024 entries — 92 differ — so a
      // 2024 Archmage picked here took psychic damage it is immune to.
      // Driven through the builder's own button.
      if (typeof _5eData !== 'undefined' && typeof _5eLoaded !== 'undefined' && _5eLoaded && panelDefs.encounter){
        const E = panelDefs.encounter, C = panelDefs.combat;
        const K0 = JSON.stringify(state.combatants), M0 = JSON.stringify(E._monsters || []);
        const rt = window.showToast; window.showToast = () => {};
        const push = async (name, src) => {
          state.combatants = [];
          const r = E._searchPool(name.toLowerCase()).find(p => p.name === name && p._source === src);
          if (!r) return null;
          E._monsters = [{ name: r.name, cr: r.cr, hp: r.hp, ac: r.ac, dex: r.dex, _source: r._source, count: 1 }];
          E._render(); await sleep(80);
          const btn = E._body && E._body.querySelector('#enc-push-combat');
          if (btn) btn.click();
          await sleep(120);
          return state.combatants[0] || null;
        };
        try {
          openPanel('encounter'); await sleep(300);
          const mage = await push('Archmage', 'XMM');
          ok('enc→combat: a pushed monster keeps its exact stat block',
             !!mage && mage._source === 'XMM', mage ? String(mage._source) : 'not pushed');
          let took = null;
          if (mage){ const hp0 = state.combatants[0].hp; C._applyHpDelta(0, -10, 'psychic'); took = hp0 - state.combatants[0].hp; }
          ok('enc→combat: the 2024 Archmage is immune to psychic damage, as its stat block says',
             took === 0, 'took ' + took);
          const dragon = await push('Adult Red Dragon', 'MM');
          ok('enc→combat: a legendary monster arrives with its legendary actions',
             !!dragon && dragon.legendaryMax === 3, dragon ? String(dragon.legendaryMax) : 'not pushed');
        } finally {
          window.showToast = rt;
          state.combatants = JSON.parse(K0); E._monsters = JSON.parse(M0); save();
          try { closePanel('encounter'); } catch(e){}
        }
      }

      // ── NPC generator → library never replaces the library ─────────────────
      // The Library panel is registered at startup but reads nothing from
      // storage until it is opened. The generator's Save found its list still
      // null, started an empty one, added its NPC and saved THAT over the
      // stored library — so the first NPC saved in a session where the
      // Library hadn't been opened deleted every other NPC, on every device.
      if (panelDefs.npcgen && panelDefs.npclib){
        const L = panelDefs.npclib;
        const N0 = localStorage.getItem('skt-npcs-v2'), mem0 = L._npcs;
        const rt = window.showToast; window.showToast = () => {};
        const names = () => (JSON.parse(localStorage.getItem('skt-npcs-v2') || '[]') || []).map(n => n.name);
        try {
          localStorage.setItem('skt-npcs-v2', JSON.stringify([{ id: 'zz_keep', name: 'ZZ Keep Me', role: '', group: 'Townsfolk' }]));
          L._npcs = null;                       // the Library has not been opened this session
          try { closePanel('npclib'); } catch(e){}
          openPanel('npcgen'); await sleep(300);
          const G = panelDefs.npcgen;
          G._body.querySelector('#npcgen-roll').click(); await sleep(80);
          G._body.querySelector('#npcgen-save').click(); await sleep(200);
          const after = names();
          ok('npcgen: saving an NPC keeps the rest of the library',
             after.includes('ZZ Keep Me') && after.length === 2, JSON.stringify(after));
        } finally {
          window.showToast = rt;
          if (N0 != null) localStorage.setItem('skt-npcs-v2', N0); else localStorage.removeItem('skt-npcs-v2');
          L._npcs = mem0;
          try { closePanel('npcgen'); closePanel('npclib'); } catch(e){}
        }
      }

      // The DM reads every player's notes in their own tree, under
      // "Player notes" / <character>.
      if (panelDefs.notes){
        const N = panelDefs.notes, N0 = localStorage.getItem('skt-notes-v2'), view0 = N._view;
        try {
          const d = JSON.parse(N0 || '{"items":[]}');
          d.items.push({ id: 'pn_root', type: 'folder', name: 'Player notes', parent: null, expanded: true });
          d.items.push({ id: 'pnf_zz', type: 'folder', name: 'ZZ Hero', parent: 'pn_root', owner: 'zz', expanded: true });
          d.items.push({ id: 'pnn_zzdm', type: 'file', name: 'ZZ Their Note', parent: 'pnf_zz', owner: 'zz', content: 'ZZ written by a player' });
          d.selectedId = 'pnn_zzdm';
          localStorage.setItem('skt-notes-v2', JSON.stringify(d));
          openPanel('notes'); await sleep(250);
          N._data = null; N.mount(N._body); N._view = 'local'; N._render(); await sleep(120);
          const rows = [...N._body.querySelectorAll('.notes-tree-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
          const at = n => rows.findIndex(r => r.indexOf(n) >= 0);
          ok('pnotes/dm: player notes appear under Player notes and the character',
             at('Player notes') >= 0 && at('Player notes') < at('ZZ Hero') && at('ZZ Hero') < at('ZZ Their Note'),
             JSON.stringify(rows));
          ok('pnotes/dm: and the DM can read them', /ZZ written by a player/.test(N._body.textContent));
        } finally {
          if (N0 != null) localStorage.setItem('skt-notes-v2', N0);
          N._data = null; N._view = view0; try { N.mount(N._body); closePanel('notes'); } catch(e){}
        }
      }

      // ── Rulebook chapters carry their reference content ───────────────────
      // A rulebook's "Classes" chapter is a page of intro prose in the source
      // data; books.js injects every class and subclass after it. When
      // Adventures and Books were merged onto one shared renderer that call
      // was dropped — the only one the merge lost — and the PHB's Classes
      // chapter showed ~4,500 characters instead of ~225,000.
      //
      // Driven through the panel's real render, because the injector itself
      // never stopped working: it was the call site that went missing.
      if (typeof _5eData !== 'undefined' && typeof _5eLoaded !== 'undefined' && _5eLoaded){
        const bk = panelDefs.books;
        let shown = '', ms = null;
        try {
          openPanel('books');
          await sleep(400);
          if (bk._loadIndex) await bk._loadIndex();
          // The id exactly as the book list has it ("PHB"). The injector finds
          // the book by it to learn which source to pull from; a lowercased id
          // matches nothing, and it quietly injects nothing.
          const phb = (bk._adventures || []).find(b => /^phb$/i.test(b.id || ''));
          const id = phb ? phb.id : 'PHB';
          await bk._loadAdventure(id);
          const file = bk._advCache[id.toLowerCase()];
          const idx = ((file && file.data) || []).findIndex(c => /^classes$/i.test(String(c.name || '').trim()));
          if (idx >= 0){
            bk._currentAdvId = id;
            bk._currentChapterIdx = idx;
            const t0 = performance.now();
            bk._render();
            ms = Math.round(performance.now() - t0);
            const content = bk._body.querySelector('#adv-content');
            shown = content ? content.textContent : '';
          }
        } catch(e){ shown = 'threw: ' + e.message; }
        ok('books: the PHB Classes chapter lists the classes, not just its intro',
           /Battle Master/.test(shown) && /Path of the Berserker/.test(shown),
           shown.length + ' chars' + (ms != null ? ', rendered in ' + ms + ' ms' : ''));
        try { bk._currentAdvId = null; bk._render(); closePanel('books'); } catch(e){}
      }

      // The parser's markers are private to it and to the one renderer that
      // understands them. Every other surface prints the string with esc(), so
      // a marker arrives as an invisible control character AND eats the
      // punctuation it stood in for. 90 monsters already leaked this way
      // through "item" nodes; restoring the sub-entry text above would have
      // taken it past a thousand. Swept over the whole bestiary because the
      // leak is per-node-type, not per-monster.
      if (typeof _5eData !== 'undefined' && typeof _5eLoaded !== 'undefined' && _5eLoaded
          && typeof sktPlainEntries === 'function' && panelDefs.turnview){
        const tv = panelDefs.turnview;
        const leaked = [];
        for (const r of Array.from(_5eData)){
          if (r.cat !== 'monster' || !r._raw) continue;
          for (const t of tv._rawList(r._raw, ['special_abilities', 'trait'])){
            if (/[-]/.test(t.name + ' ' + t.text)){ leaked.push(r.name + '/' + t.name); break; }
          }
          if (leaked.length > 4) break;
        }
        ok('turnview: no parser marker reaches the stat block text',
           leaked.length === 0, leaked.join(', '));
        // The label keeps the full stop the HTML renderer would have given it,
        // and does not gain a second one when it already ends in punctuation.
        ok('plain: a bold label keeps its full stop',
           sktPlainEntries('\x04Forbiddance\x04 No entry.') === 'Forbiddance. No entry.',
           JSON.stringify(sktPlainEntries('\x04Forbiddance\x04 No entry.')));
        ok('plain: and does not get a second one',
           sktPlainEntries('\x04Mage:\x04 A spell.') === 'Mage: A spell.',
           JSON.stringify(sktPlainEntries('\x04Mage:\x04 A spell.')));
      }

      // The adventure/book renderer is a SECOND implementation of the same job,
      // so fixing one leaves the other broken — which is how the pair got out
      // of step in the first place.
      if (typeof CONTENT_PANEL_SHARED !== 'undefined'){
        const html = CONTENT_PANEL_SHARED._renderNode({
          type: 'list',
          items: [{ type: 'itemSub', name: 'Forbiddance', entry: 'No invitation, no entry.' }],
        });
        ok('content: a nested sub-entry renders both its name and its body',
           /Forbiddance/.test(html) && /No invitation, no entry\./.test(html), html.slice(0, 140));
      }

      // The party sheet is a THIRD one, and its bug was the mirror image: it
      // tested "entries" first and returned the body with no name, then its
      // name-only branch looked for "entries" again — so an item carrying a
      // singular "entry" became a bold heading with nothing under it. Both
      // halves are asserted, against the same rows the renderer itself picks.
      if (typeof _5eData !== 'undefined' && _5eLoaded && panelDefs.party){
        const rowFor = cls => Array.from(_5eData).find(d => d.cat === 'class' && d._raw
                              && d._raw.classFeatures && d.name.toLowerCase() === cls.toLowerCase());
        const namedItems = row => {
          const out = [];
          const scan = node => {
            if (Array.isArray(node)) return node.forEach(scan);
            if (!node || typeof node !== 'object') return;
            for (const k in node){
              const v = node[k];
              if (k === 'items' && Array.isArray(v)){
                for (const it of v){
                  if (it && typeof it === 'object' && it.name
                      && (typeof it.entry === 'string' || Array.isArray(it.entries))) out.push(it.name);
                }
              }
              scan(v);
            }
          };
          for (const ft of ((row._raw || {})._resolvedFeatures || [])) scan(ft.entries);
          return out;
        };
        const clsNames = [...new Set(Array.from(_5eData)
          .filter(r => r.cat === 'class' && r._raw && r._raw.classFeatures).map(r => r.name))];
        const lostLabel = [], lostBody = [];
        let checked = 0;
        for (const cls of clsNames){
          const row = rowFor(cls); if (!row) continue;
          const want = namedItems(row).length;
          const html = panelDefs.party._tabFeatures({
            id: 'st_probe', name: 'Probe', cls: cls, class: cls, subclass: '', level: 20,
            isPC: true, hp: 30, hpMax: 30,
          });
          const got  = (html.match(/<li><strong>[^<]+<\/strong>/g) || []).length;
          const bare = (html.match(/<li><strong>[^<]+<\/strong>\s*<\/li>/g) || []).length;
          if (bare) lostBody.push(cls);
          if (want){ checked++; if (got < want) lostLabel.push(cls + ': ' + got + '/' + want); }
        }
        ok('party: a class with named sub-items was found to test with', checked > 0, String(checked));
        ok('party: every named sub-item keeps its label', lostLabel.length === 0, lostLabel.join(', '));
        ok('party: and none is left as a label with no body', lostBody.length === 0, lostBody.join(', '));
      }

      // PDF import: subclass and feats. Both are matched against _5eData
      // rather than read off the sheet, which is why they live here and not in
      // a unit test — and why they failed silently for so long. Two distinct
      // bugs are pinned below: the positional and form-field paths never
      // looked past one form field, and the feat matcher accepted any English
      // word that happened to be a feat name.
      if (typeof _matchFeats === 'function' && typeof _5eLoaded !== 'undefined' && _5eLoaded){
        const page = 'CHARACTER NAME Kaelin CLASS & LEVEL Monk 6 BACKGROUND Acolyte '
          + 'FEATURES & TRAITS Unarmored Defense, Martial Arts, Ki, Slow Fall, '
          + 'Way of the Open Hand, Open Hand Technique, Evasion. '
          + 'Fighting Style: Defense. Second Wind. '
          + 'FEATS Sentinel, War Caster '
          + 'EQUIPMENT shortsword, healer kit, lucky charm '
          + 'SPELLS Guidance, Magic Weapon, Alert the guard '
          + 'Attacks: Quarterstaff. Speed 45. Tough leather armor.';

        // The whole page yields five wrong feats out of seven. The FEATS
        // section yields the two real ones. If _featsRegion is ever widened
        // back to the full text, this is the check that says so.
        ok('pdf: the feats region is just the FEATS box',
           _featsRegion(page).trim() === 'Sentinel, War Caster',
           JSON.stringify(_featsRegion(page)));
        ok('pdf: real feats are found', eqJ(_matchFeats(_featsRegion(page)),
           ['Sentinel', 'War Caster']), JSON.stringify(_matchFeats(_featsRegion(page))));
        ok('pdf: lower-case equipment prose is not mistaken for feats',
           !_matchFeats(page).some(f => f === 'Healer' || f === 'Lucky'),
           JSON.stringify(_matchFeats(page)));
        // Why the region scoping is load-bearing and not belt-and-braces: the
        // word rules cannot reject a capitalised, sentence-initial "Tough" in
        // "Speed 45. Tough leather armor." Only looking in the right box can.
        // If someone ever points _matchFeats at the full page again, this is
        // the check that explains what breaks.
        ok('pdf: the full page still leaks, which is why the region exists',
           _matchFeats(page).length > _matchFeats(_featsRegion(page)).length,
           JSON.stringify(_matchFeats(page)));
        ok('pdf: "Unarmored Defense" is not the Defense feat',
           eqJ(_matchFeats('Unarmored Defense, Martial Arts, Evasion.'), []),
           JSON.stringify(_matchFeats('Unarmored Defense, Martial Arts, Evasion.')));

        // Positive controls. The two guards above suppress matches, so a
        // matcher that returned nothing at all would pass every check so far.
        ok('pdf: multi-word feats still match',
           eqJ(_matchFeats('FEATS Great Weapon Master, War Caster'),
               ['Great Weapon Master', 'War Caster']));
        ok('pdf: one-word feats in a plain list still match',
           eqJ(_matchFeats('FEATS Alert, Tough'), ['Alert', 'Tough']));
        ok('pdf: no FEATS heading means no region, not the whole page',
           _featsRegion('CHARACTER NAME Bob RACE Elf BACKGROUND Sage') === '');

        // Subclass reads the whole page safely — it is anchored to the class
        // and tries the longest name first.
        ok('pdf: subclass is found in page text', _matchSubclass('monk', [page]) === 'Open Hand',
           String(_matchSubclass('monk', [page])));
        ok('pdf: a subclass from the wrong class is not matched',
           _matchSubclass('wizard', [page]) === null,
           String(_matchSubclass('wizard', [page])));

        // ── The real D&D Beyond 2024 export shape ────────────────────────
        // Verbatim structure from three sheets that reported this bug: the
        // features box is FeaturesTraits1..6, there is no Subclass field at
        // all, Class & Level is "Monk 6" with no parenthetical, and the
        // rendered page text is ~2 KB of blank-form labels because every bit
        // of content lives in the AcroForm fields.
        const ddb = {
          'FeaturesTraits1': '=== MONK FEATURES === \n\n* Martial Arts • PHB-2024 101 \n',
          // Deliberately out of lexical order: "10" sorts before "2" as text,
          // and part 3 continues a sentence part 2 started.
          'FeaturesTraits10': '=== FEATS === \n\n* Sentinel • PHB-2024 207 \n'
            + 'Guardian. Immediately after a creature within 5 ft. of you takes the Disengage action... \n\n'
            + '* Aberrant Dragonmark • WGtE 52 \n'
            + '* Sage Ability Score Improvements • PHB-2024 178 \n',
          'FeaturesTraits2': '* Monk Subclass • PHB-2024 103 \n\n   | Warrior of Mercy \n\n',
          'FeaturesTraits3': '* Stunning Strike • PHB-2024 103 \n',
        };
        const joined = _ddbFeaturesText(ddb);
        ok('pdf/ddb: the numbered features fields are joined in numeric order',
           joined.indexOf('Martial Arts') < joined.indexOf('Monk Subclass')
        && joined.indexOf('Monk Subclass') < joined.indexOf('Stunning Strike')
        && joined.indexOf('Stunning Strike') < joined.indexOf('=== FEATS ==='),
           'order came out wrong');
        ok('pdf/ddb: nothing is dropped from the join',
           joined.length > 300 && /Aberrant Dragonmark/.test(joined));

        ok('pdf/ddb: the subclass is read off the pipe line',
           _ddbSubclassName(joined) === 'Warrior of Mercy',
           String(_ddbSubclassName(joined)));
        // 2024 renamed the monk subclasses; "Warrior of Mercy" has to resolve
        // to the same short name the reaction table and Features tab key on.
        ok('pdf/ddb: a 2024 subclass name resolves to its short form',
           _matchSubclass('monk', [_ddbSubclassName(joined)]) === 'Mercy',
           String(_matchSubclass('monk', [_ddbSubclassName(joined)])));
        // A pipe line further down belongs to some other feature's list.
        ok('pdf/ddb: a distant pipe line is not taken as the subclass',
           _ddbSubclassName('* Druid Subclass • PHB 81 \n* Natural Recovery • PHB 84 \n   | Cast Circle Spell \n') === null,
           String(_ddbSubclassName('* Druid Subclass • PHB 81 \n* Natural Recovery • PHB 84 \n   | Cast Circle Spell \n')));

        const df = _ddbFeats(joined);
        ok('pdf/ddb: feats come off the bullet lines', df.indexOf('Sentinel') >= 0, JSON.stringify(df));
        ok('pdf/ddb: a feat the dataset has never heard of is kept',
           df.indexOf('Aberrant Dragonmark') >= 0, JSON.stringify(df));
        ok('pdf/ddb: a background ability-score bump is not a feat',
           !df.some(x => /ability score/i.test(x)), JSON.stringify(df));
        // The prose under each feat names its own sub-features. Scanning it
        // would return "Guardian" as a feat.
        ok('pdf/ddb: sub-feature prose is not read as feats',
           df.indexOf('Guardian') < 0, JSON.stringify(df));
        ok('pdf/ddb: class features above the FEATS heading are not feats',
           df.indexOf('Martial Arts') < 0 && df.indexOf('Stunning Strike') < 0, JSON.stringify(df));

        // The INTEGRATION check, and the one that actually matters. Every
        // check above tests a helper in isolation, and all of them stayed
        // green when the wiring that calls them was reverted — the helpers
        // were never the broken part. This drives _fromFields with a
        // D&D Beyond-shaped field set and asserts the two fields come out the
        // far end, which is the bug as the DM experienced it.
        {
          const parsed = _fromFields({
            'CharacterName': 'ZZ Probe',
            'CLASS  LEVEL': 'Monk 6',
            'HPMax': '47', 'AC': '14', 'Speed': '30',
            'STR': '9', 'DEX': '17', 'CON': '14', 'INT': '13', 'WIS': '13', 'CHA': '10',
            'FeaturesTraits1': '=== MONK FEATURES === \n* Martial Arts • PHB-2024 101 \n',
            'FeaturesTraits2': '* Monk Subclass • PHB-2024 103 \n\n   | Warrior of Mercy \n\n',
            'FeaturesTraits3': '=== FEATS === \n* Sentinel • PHB-2024 207 \n',
          });
          ok('pdf/ddb: a D&D Beyond field set yields a subclass end to end',
             parsed.subclass === 'Mercy', String(parsed.subclass));
          ok('pdf/ddb: a D&D Beyond field set yields feats end to end',
             eqJ(parsed.feats, ['Sentinel']), JSON.stringify(parsed.feats));
          // The whole features box is worth keeping too — it was being
          // dropped entirely, 7 KB of it on one of the reported sheets.
          ok('pdf/ddb: the features text is kept, not dropped',
             ((parsed.sheet || {}).bio || {}).features
             && parsed.sheet.bio.features.indexOf('Martial Arts') >= 0,
             String(((parsed.sheet || {}).bio || {}).features || '').slice(0, 60));
        }

        // The Turn View reads the features text to find feat reactions, and
        // read sheet.features — which the importer never writes; it nests the
        // free-text boxes under sheet.bio.
        {
          const p0 = JSON.stringify(state.party), k0 = JSON.stringify(state.combatants);
          state.party = [{ id:'ddbprobe', name:'ZZ Probe', cls:'Monk', level:6,
                           subclass:'Mercy', feats:[],
                           sheet:{ bio:{ features:'* Sentinel • PHB-2024 207' } } }];
          state.combatants = [{ id:'ddbprobe', name:'ZZ Probe', isPC:true, hp:1, hpMax:1 }];
          const rx = (panelDefs.turnview._reactionsFor(state.combatants[0]) || []).map(x => x.name);
          ok('pdf/ddb: a feat named only in sheet.bio.features still gives its reaction',
             rx.indexOf('Sentinel') >= 0, JSON.stringify(rx));
          state.party = JSON.parse(p0); state.combatants = JSON.parse(k0);
        }
      }

      // ── Activatable features ──────────────────────────────────────────
      // Derived from the character's own sheet text, so the format below is
      // copied from a real D&D Beyond 2024 export rather than invented.
      if (typeof sktDeriveActivations === 'function'){
        const FEAT_TEXT = [
          '* Martial Arts • PHB-2024 101 ',
          'You can make an Unarmed Strike as a Bonus Action. ',
          '   | Unarmed Strike: 1 Bonus Action ',
          "* Monk's Focus • PHB-2024 101 ",
          'You have 6 Focus Points and regain all expended points after a Short or Long Rest. ',
          'Flurry of Blows. You can expend 1 Focus Point to make two Unarmed Strikes as a Bonus Action. ',
          'Patient Defense. You can expend 2 Focus Points to take both the Disengage and Dodge actions. ',
          '   | Focus Points: 6 / Short Rest • Special ',
          '   | Flurry of Blows: 1 Bonus Action ',
          '   | Patient Defense: 1 Bonus Action ',
          '* Monk Subclass • PHB-2024 103 ',
          '   | Warrior of Mercy ',
          '* Slow Fall • PHB-2024 103 ',
          '   | 1 Reaction ',
          '* Stunning Strike • PHB-2024 103 ',
          'Once per turn, when you hit with a Monk weapon or Unarmed Strike, you can expend 1 Focus Point to attempt a stunning strike. ',
          '   | 1 Action ',
          '* Breath Weapon • PHB-2024 194 ',
          '   | 3 / Long Rest • 1 Action ',
        ].join('\n');
        const A = sktDeriveActivations(FEAT_TEXT);
        const byName = n => A.find(x => x.name === n);

        ok('acts: options are found', A.length >= 4, JSON.stringify(A.map(x => x.name)));
        ok('acts: the action-economy cost is read off the pipe line',
           (byName('Flurry of Blows') || {}).action === 'Bonus Action',
           JSON.stringify(byName('Flurry of Blows')));
        ok('acts: the resource cost is read out of the prose',
           (byName('Flurry of Blows') || {}).resource === 'Focus Points'
        && (byName('Flurry of Blows') || {}).amount === 1,
           JSON.stringify(byName('Flurry of Blows')));
        // The two sit in one paragraph. Reading forward without stopping at
        // the next sub-option heading gave every option the first one's cost.
        ok('acts: a neighbouring option does not lend its cost',
           (byName('Patient Defense') || {}).amount === 2,
           JSON.stringify(byName('Patient Defense')));
        // Its own text says "Unarmed Strike" before it says the cost, which
        // is what used to truncate the search window.
        // Slow Fall is free and the bullet directly below it says "expend 1
        // Focus Point". Nothing in between looks like a sub-option heading, so
        // the only thing keeping the two apart is stopping at the next bullet.
        ok('acts: a free option does not read the next bullet cost',
           !!byName('Slow Fall') && !byName('Slow Fall').resource,
           JSON.stringify(byName('Slow Fall')));
        // The one that actually exercises the search window: Unarmed Strike
        // is free and sits directly above Flurry of Blows. Without a stop at
        // the next bullet it reads Flurry's sentence and costs a Focus Point
        // that the rules do not charge.
        ok('acts: a free option does not inherit the next cost',
           !!byName('Unarmed Strike') && !byName('Unarmed Strike').resource,
           JSON.stringify(byName('Unarmed Strike')));
        ok('acts: a cost after a mention of another feature is still found',
           (byName('Stunning Strike') || {}).amount === 1,
           JSON.stringify(byName('Stunning Strike')));
        ok('acts: an unnamed pipe line takes the enclosing feature\'s name',
           !!byName('Breath Weapon') && byName('Breath Weapon').uses === '3 / Long Rest',
           JSON.stringify(byName('Breath Weapon')));
        // "| Focus Points: 6 / Short Rest • Special" is the pool being
        // declared, and "| Warrior of Mercy" is a choice being recorded.
        // Neither is something you do on your turn.
        ok('acts: the resource pool is not listed as an action', !byName('Focus Points'),
           JSON.stringify(A.map(x => x.name)));
        ok('acts: a subclass choice is not listed as an action', !byName('Warrior of Mercy'),
           JSON.stringify(A.map(x => x.name)));
        ok('acts: nothing is returned for a sheet with no features text',
           eqJ(sktDeriveActivations(''), []));

        // ── Pool sizes: the sheet outranks the derived table ────────────
        {
          const POOLS = [
            '* Wild Shape • PHB-2024 82 ',
            '   | 3 / Long Rest • 1 Bonus Action ',
            "* Monk's Focus • PHB-2024 101 ",
            '   | Focus Points: 6 / Short Rest • Special ',
            '* Breath Weapon • PHB-2024 194 ',
            '   | 3 / Long Rest • 1 Action ',
          ].join('\n');
          const dp = sktDeclaredPools(POOLS);
          ok('pools: a pipe line names its own pool', dp['Focus Points'] === 6, JSON.stringify(dp));
          // "6 / Short Rest • Special" puts the activation cost after the
          // uses, so taking the last segment finds the wrong thing.
          ok('pools: the uses figure is found when it is not last',
             dp['Focus Points'] === 6 && dp['Wild Shape'] === 3, JSON.stringify(dp));
          ok('pools: an unnamed pipe line takes the bullet above it',
             dp['Wild Shape'] === 3, JSON.stringify(dp));
          ok('pools: nothing is declared by a sheet with no pipe lines',
             eqJ(sktDeclaredPools('* Evasion • PHB-2024 103 \nYou dodge well. '), {}));

          // Through the importer: a level 6 druid gets 3 uses, not the 2 the
          // derived table used to hand out, and the pool comes back full.
          const druid = _fromFields({
            'CharacterName': 'ZZ Druid', 'CLASS  LEVEL': 'Druid 6',
            'FeaturesTraits1': POOLS,
          });
          const ws = (druid.resources || []).find(r => r.name === 'Wild Shape');
          ok('pools: the sheet corrects a derived pool', !!ws && ws.max === 3,
             JSON.stringify(druid.resources));
          ok('pools: a corrected pool is full, not part-spent',
             !!ws && ws.current === 3, ws && (ws.current + '/' + ws.max));
          // Breath Weapon is declared as 3 / Long Rest too, but it is not a
          // class resource and must not appear on the party card.
          ok('pools: a declared use count does not invent a new pool',
             !(druid.resources || []).some(r => r.name === 'Breath Weapon'),
             JSON.stringify((druid.resources || []).map(r => r.name)));
          // A case where the two genuinely disagree. Bardic Inspiration is
          // derived from Charisma, and a sheet whose ability scores did not
          // extract gives a modifier of 0 and a pool of 1 — while the sheet
          // itself plainly states 4. Wild Shape above no longer tests this:
          // the derived table was corrected to the 2024 figure in the same
          // change, so both sides now say 3 and the check passed with the
          // correction disabled.
          const bard = _fromFields({
            'CharacterName': 'ZZ Bard', 'CLASS  LEVEL': 'Bard 6',
            'FeaturesTraits1': ['* Bardic Inspiration • PHB-2024 59 ',
                                 '   | 4 / Short Rest • 1 Bonus Action '].join(String.fromCharCode(10)),
          });
          const bi = (bard.resources || []).find(r => r.name === 'Bardic Inspiration');
          ok('pools: the sheet wins where it disagrees with the table',
             !!bi && bi.max === 4 && bi.current === 4,
             JSON.stringify(bard.resources));

          // A pool the sheet says nothing about is left exactly as derived —
          // otherwise the check above would pass with the whole table gone.
          const monk = _fromFields({
            'CharacterName': 'ZZ Monk', 'CLASS  LEVEL': 'Monk 6',
            'FeaturesTraits1': '* Evasion • PHB-2024 103 \nYou dodge well. ',
          });
          const fp = (monk.resources || []).find(r => r.name === 'Focus Points');
          ok('pools: an undeclared pool keeps its derived size',
             !!fp && fp.max === 6, JSON.stringify(monk.resources));
        }

        // One abbreviation shared by the Turn View chips and the Party tab
        // pills. They had separate copies, which is how the same feature
        // ends up labelled two different ways on two screens.
        ok('acts: action names abbreviate consistently',
           sktActionShort('Bonus Action') === 'BONUS'
        && sktActionShort('Reaction') === 'REACT'
        && sktActionShort('Action') === 'ACT'
        && sktActionShort('Special') === 'SPEC'
        && panelDefs.turnview._actShort({action:'Bonus Action'}) === 'BONUS',
           sktActionShort('Bonus Action'));

        // The Party tab rows must open. They were flat divs with the text in
        // a title attribute, so clicking one did nothing while the class
        // features directly below it opened — and a tooltip is no use at all
        // on a touch screen.
        {
          const html = panelDefs.party._tabFeatures({
            name:'ZZ Feat', cls:'Monk', level:6, subclass:'Mercy',
            sheet:{ bio:{ features:[
              '* Monk Focus • PHB-2024 101 ',
              'Flurry of Blows. You can expend 1 Focus Point to strike twice. ',
              '   | Flurry of Blows: 1 Bonus Action ',
            ].join(String.fromCharCode(10)) } },
            resources:[{name:'Focus Points',type:'pool',current:6,max:6}],
          });
          const at = html.indexOf('feat-lvl act');
          ok('acts: an activatable row is a details element', at >= 0);
          ok('acts: it is not a tooltip-only div',
             at >= 0 && html.lastIndexOf('<details', at) > html.lastIndexOf('<div', at),
             html.slice(Math.max(0, at - 90), at + 40));
          ok('acts: its body carries the description',
             html.indexOf('expend 1 Focus Point to strike twice') >= 0);
          ok('acts: the row names where the feature came from',
             /feat-from">from Monk Focus/.test(html));
        }

        // The Features tab lists what the character can DO before the full
        // rules text of every feature the class grants. It was appended last
        // by mistake, behind all of that, while the comment beside it said
        // otherwise.
        {
          const html = panelDefs.party._tabFeatures({
            name:'ZZ Feat', cls:'Monk', level:6, subclass:'Mercy',
            sheet:{ bio:{ features:['* Monk Focus • PHB-2024 101 ',
              'Flurry of Blows. You can expend 1 Focus Point to strike twice. ',
              '   | Flurry of Blows: 1 Bonus Action '].join(String.fromCharCode(10)) } },
            resources:[{name:'Focus Points',type:'pool',current:6,max:6}],
          });
          const iAct = html.indexOf('Activatable'), iCls = html.indexOf('Class:');
          ok('acts: the Features tab lists activatable options', iAct >= 0);
          ok('acts: they come before the class feature reference',
             iAct >= 0 && (iCls < 0 || iAct < iCls), 'act '+iAct+' cls '+iCls);
          ok('acts: the cost is shown in the singular there too',
             /1 Focus Point ·/.test(html));
        }

        // ── Descriptions ────────────────────────────────────────────
        // The chips are terse on purpose, so the description carries the
        // whole answer to "what does this one do". It comes off the sheet,
        // which means finding where the sheet DECLARES an option rather
        // than where it first happens to mention one.
        {
          const DESC = [
            '* Martial Arts • PHB-2024 101 ',
            'You gain benefits while unarmed. • You can make an Unarmed Strike as a Bonus Action. ',
            '   | Unarmed Strike: 1 Bonus Action ',
            '* Monk Focus • PHB-2024 101 ',
            'Flurry of Blows. You can expend 1 Focus Point to make two Unarmed Strikes. ',
            '   | Flurry of Blows: 1 Bonus Action ',
            '* Deflect Attacks • PHB-2024 102 ',
            'When an attack hits you, you can take a Reaction to reduce the damage. ',
            '   | Deflect Attack: Redirect Attack: 1 Reaction ',
          ].join(String.fromCharCode(10));
          const D = sktDeriveActivations(DESC);
          const dOf = n => (D.find(x => x.name === n) || {}).desc || '';

          ok('desc: every option gets a description',
             D.length > 0 && D.every(x => x.desc),
             JSON.stringify(D.map(x => x.name + ': ' + (x.desc || '(none)').slice(0, 25))));
          // Unarmed Strike is named in its pipe line and mid-sentence in the
          // prose, and nowhere as a declaration. Taking the first mention
          // started its description at "as a Bonus Action. can roll 1d8…".
          ok('desc: an option named only in a pipe line uses its feature',
             /^You gain benefits/.test(dOf('Unarmed Strike')), dOf('Unarmed Strike'));
          // Same for a sub-option whose name appears nowhere else: its
          // description used to come out as the literal string "1 Reaction".
          ok('desc: a sub-option inherits its feature description',
             /^When an attack hits you/.test(dOf('Deflect Attack: Redirect Attack')),
             dOf('Deflect Attack: Redirect Attack'));
          ok('desc: a declared sub-option keeps its own',
             /^You can expend 1 Focus Point/.test(dOf('Flurry of Blows')), dOf('Flurry of Blows'));
          // The source-reference stripper matched any bullet and ate the word
          // after it, so "• You can make an Unarmed Strike" lost its "You".
          ok('desc: the source reference goes and prose bullets stay',
             !/PHB/.test(dOf('Unarmed Strike')) && /• You can make/.test(dOf('Unarmed Strike')),
             dOf('Unarmed Strike'));
          ok('desc: no pipe lines survive into the prose',
             D.every(x => x.desc.indexOf('|') < 0), JSON.stringify(D.map(x => x.desc)));
        }

        // Tapping a chip must describe, not spend.
        {
          const p0 = JSON.stringify(state.party), k0 = JSON.stringify(state.combatants);
          const a0 = state.activeCombatantId;
          const T = panelDefs.turnview;
          state.party = [{ id:'dprobe', name:'ZZ Desc', cls:'Monk', level:6, hp:9, hpMax:9,
                           sheet:{ bio:{ features:[
                             '* Monk Focus • PHB-2024 101 ',
                             'Flurry of Blows. You can expend 1 Focus Point to strike twice. ',
                             '   | Flurry of Blows: 1 Bonus Action ',
                           ].join(String.fromCharCode(10)) } },
                           resources:[{name:'Focus Points',type:'pool',current:4,max:6}] }];
          state.combatants = [{ id:'dprobe', name:'ZZ Desc', isPC:true, hp:9, hpMax:9 }];
          state.activeCombatantId = 'dprobe';
          const who = state.combatants[0];
          const act = T._activationsFor(who)[0];
          const pool = () => state.party[0].resources[0];

          // The chip is wired to actpick and only the detail panel offers
          // actuse. That split IS the fix — a mis-tap cannot spend a point.
          try { localStorage.setItem('skt-tv-acts-v1', '1'); } catch(e){}
          T._actMenu = null;
          const head = T._renderActorHead(who);
          ok('desc: a feature chip picks rather than spends',
             /data-tv="actpick"/.test(head) && head.indexOf('tv-featdet') < 0);
          ok('desc: no chip is wired straight to Use',
             (head.match(/data-tv="actuse"/g) || []).length === 0);

          T._actMenu = { id:'dprobe', i:act.i };
          const opened = T._renderActorHead(who);
          ok('desc: the picked chip opens a detail panel',
             opened.indexOf('tv-featdet') >= 0);
          ok('desc: the detail carries the description',
             opened.indexOf('expend 1 Focus Point to strike twice') >= 0);
          ok('desc: the detail is the one place Use appears',
             (opened.match(/data-tv="actuse"/g) || []).length === 1);
          ok('desc: the detail names the cost', /1 Focus Point · 4\/6/.test(opened));
          ok('desc: opening a detail spends nothing', pool().current === 4, String(pool().current));

          // Collapsed by default: fifteen options was four rows of chips
          // above the attack list, which is what "cluttered" meant.
          try { localStorage.removeItem('skt-tv-acts-v1'); } catch(e){}
          T._actMenu = null;
          const shut = T._renderActorHead(who);
          ok('desc: the features row is collapsed until asked for',
             shut.indexOf('tv-featlist') < 0 && shut.indexOf('tv-feats-h') >= 0);
          ok('desc: the collapsed header still says how many there are',
             /tv-feats-n">1</.test(shut), shut.slice(shut.indexOf('tv-feats-h'), shut.indexOf('tv-feats-h') + 160));

          T._actMenu = null;
          state.party = JSON.parse(p0); state.combatants = JSON.parse(k0);
          state.activeCombatantId = a0;
        }

        // End to end in the Turn View: render, click, spend.
        {
          const p0 = JSON.stringify(state.party), k0 = JSON.stringify(state.combatants);
          const a0 = state.activeCombatantId;
          state.party = [{ id:'actprobe', name:'ZZ Acts', cls:'Monk', level:6, subclass:'Mercy',
                           hp:30, hpMax:30, ac:14,
                           sheet:{ bio:{ features:FEAT_TEXT } },
                           resources:[{ name:'Focus Points', type:'pool', current:6, max:6 }] }];
          state.combatants = [{ id:'actprobe', name:'ZZ Acts', isPC:true, hp:30, hpMax:30, ac:14 }];
          state.activeCombatantId = 'actprobe';
          const T = panelDefs.turnview;
          const who = state.combatants[0];
          const acts = T._activationsFor(who);
          ok('acts/tv: the Turn View sees the same options', acts.length === A.length,
             acts.length + ' vs ' + A.length);

          const flurry = acts.find(x => x.name === 'Flurry of Blows');
          T._useActivation('actprobe', flurry.i);
          const pool = () => state.party[0].resources[0];
          ok('acts/tv: using one spends exactly its cost', pool().current === 5, String(pool().current));
          ok('acts/tv: it consumes the bonus action', who.bonusUsed === true);
          // Patient Defense costs 2, not 1 — a shared constant would hide this.
          who.bonusUsed = false;
          T._useActivation('actprobe', acts.find(x => x.name === 'Patient Defense').i);
          ok('acts/tv: a two-point option spends two', pool().current === 3, String(pool().current));

          who.bonusUsed = true;
          ok('acts/tv: a second bonus action in one turn is refused',
             T._actProblem(who, flurry) === 'bonus action already used',
             String(T._actProblem(who, flurry)));
          who.bonusUsed = false;
          pool().current = 0;
          ok('acts/tv: an empty pool refuses the option',
             /no focus points left/.test(String(T._actProblem(who, flurry))),
             String(T._actProblem(who, flurry)));
          // A free option must survive an empty pool, or the check above would
          // pass just as well with everything disabled.
          const free = acts.find(x => !x.resource && !x.pool);
          ok('acts/tv: a free option is still available with the pool empty',
             !free || T._actProblem(who, free) === null,
             free ? free.name + ': ' + T._actProblem(who, free) : 'none to test');
          // "1 Focus Point", singular.
          pool().current = 6;
          ok('acts/tv: a cost of one is labelled in the singular',
             /^1 Focus Point ·/.test(T._actCostLabel(T._activationsFor(who).find(x => x.name === 'Flurry of Blows'))),
             T._actCostLabel(T._activationsFor(who).find(x => x.name === 'Flurry of Blows')));

          state.party = JSON.parse(p0); state.combatants = JSON.parse(k0);
          state.activeCombatantId = a0;
        }
      }

      // The review modal must expose both fields, because the matchers miss
      // often enough that "silently parsed, silently applied" left the DM with
      // no way to see it or fix it.
      {
        const partyBefore = JSON.stringify(state.party);
        panelDefs.party._showPdfPreview({ name:'ZZ Selftest', cls:'monk', level:6,
                                          subclass:'Open Hand', feats:['Sentinel'], abilities:{} });
        const sub = document.querySelector('#pdf-subclass');
        const fts = document.querySelector('#pdf-feats');
        ok('pdf: the review modal has a subclass box', !!sub);
        ok('pdf: the review modal has a feats box', !!fts);
        ok('pdf: both are pre-filled from the parse',
           !!sub && !!fts && sub.value === 'Open Hand' && fts.value === 'Sentinel');
        if (sub && fts){
          document.querySelector('#pdf-slot').value = 'new';
          sub.value = 'Way of Shadow';
          fts.value = ' Sentinel ,, War Caster ';
          document.querySelector('#pdf-apply').click();
          const made = state.party[state.party.length - 1];
          ok('pdf: a typed subclass reaches the character',
             !!made && made.subclass === 'Way of Shadow', made && made.subclass);
          ok('pdf: a typed feat list is split and cleaned',
             !!made && eqJ(made.feats, ['Sentinel', 'War Caster']),
             made && JSON.stringify(made.feats));
        }
        document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
        state.party = JSON.parse(partyBefore);
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
      // The multiplier cases above check one step of the pipeline. These
      // check the whole of it against answers the books state outright, so
      // a threshold table off by one row, a wrong CR value or an inverted
      // comparison shows up as the wrong word on screen rather than as a
      // number nobody can check by eye.
      const L0 = E._partyLevel, SY0 = E._system;
      const say = (sys, lvl, size, mons) => {
        E._system = sys; E._partyLevel = lvl; E._partySize = size; E._monsters = mons;
        const xp = E._calcXP();
        const d = sys === '2024' ? E._difficulty2024(xp.raw) : E._difficulty(xp.adjusted);
        return { adj: xp.adjusted, raw: xp.raw, label: d.label };
      };
      const gob = n => [{ name:'Goblin', cr:'1/4', count:n }];

      // The example every DM knows: four goblins is a deadly fight for four
      // level 1 characters. 4 x 50 = 200, x2 for the count = 400, and the
      // level 1 deadly threshold for four characters is exactly 400.
      {
        const r = say('2014', 1, 4, gob(4));
        ok('enc: four goblins are deadly for four level 1 characters',
           r.adj === 400 && r.label === 'Deadly', JSON.stringify(r));
      }
      // A single ogre, no multiplier at all, clears the same threshold.
      {
        const r = say('2014', 1, 4, [{ name:'Ogre', cr:'2', count:1 }]);
        ok('enc: one ogre is deadly for four level 1 characters',
           r.raw === 450 && r.label === 'Deadly', JSON.stringify(r));
      }
      // Same monsters, six characters: the step down to x1.5 pulls it out
      // of Deadly. This is the p.83 rule showing up in the verdict, not
      // just in the multiplier.
      {
        const r = say('2014', 1, 6, gob(4));
        ok('enc: six characters make the same fight Medium',
           r.adj === 300 && r.label === 'Medium', JSON.stringify(r));
      }
      // 2024 spends raw XP against a per-character budget and applies no
      // multiplier. Four level 3 characters get 150/225/400 each.
      {
        const low  = say('2024', 3, 4, gob(4));
        const mod  = say('2024', 3, 4, gob(13));
        const high = say('2024', 3, 4, gob(19));
        ok('enc/2024: under the low budget reads Low',
           low.raw === 200 && low.label === 'Low', JSON.stringify(low));
        ok('enc/2024: past low reads Moderate',
           mod.raw === 650 && mod.label === 'Moderate', JSON.stringify(mod));
        ok('enc/2024: past moderate reads High',
           high.raw === 950 && high.label === 'High', JSON.stringify(high));
        // The count multiplier must not leak into the 2024 verdict — the
        // whole point of the edition is that it does not have one.
        ok('enc/2024: the verdict ignores the monster count multiplier',
           say('2024', 3, 4, gob(4)).label === say('2024', 3, 4, [{name:'X',cr:'1',count:1}]).label
           || say('2024', 3, 4, gob(4)).raw === 200, 'raw was ' + say('2024', 3, 4, gob(4)).raw);
      }
      // An empty encounter must not read as a fight in either edition.
      ok('enc: nothing selected is not a difficulty',
         say('2024', 5, 4, []).label === '—' && say('2014', 5, 4, []).adj === 0);

      // Spot-check the tables themselves against values typed from the
      // books rather than read from the same generated file. Hand copies of
      // these were wrong on 19 of 20 rows once already.
      {
        const R = window.SKT_RULES || {};
        ok('enc: the 2014 threshold table matches the book',
           eqJ((R.xpThresholds2014||[])[0],  [25,50,75,100])
        && eqJ((R.xpThresholds2014||[])[4],  [250,500,750,1100])
        && eqJ((R.xpThresholds2014||[])[19], [2800,5700,8500,12700]),
           JSON.stringify([(R.xpThresholds2014||[])[0], (R.xpThresholds2014||[])[19]]));
        ok('enc: the 2024 budget table matches the book',
           eqJ((R.xpBudget2024||[])[0],  [50,75,100])
        && eqJ((R.xpBudget2024||[])[5],  [600,1000,1400])
        && eqJ((R.xpBudget2024||[])[19], [6400,13200,22000]),
           JSON.stringify([(R.xpBudget2024||[])[0], (R.xpBudget2024||[])[19]]));
        ok('enc: CR to XP matches the book at both ends',
           (R.crXp||{})['1/8'] === 25 && (R.crXp||{})['5'] === 1800
        && (R.crXp||{})['20'] === 25000 && (R.crXp||{})['30'] === 155000,
           JSON.stringify([(R.crXp||{})['1/8'], (R.crXp||{})['30']]));
      }
      E._partyLevel = L0; E._system = SY0;
      E._partySize = S0; E._monsters = JSON.parse(M0);
    }
    closePanel('encounter');

    // ── Which settings are the campaign’s, and which are this screen’s ────
    // skt-settings-v1 syncs. It was also carrying display preferences, so
    // the font scale set on a monitor was applied to every phone at the
    // table — applyFontScale writes an inline zoom on document.body, which
    // beats the player shell’s own stylesheet value.
    {
      const S0 = localStorage.getItem('skt-settings-v1');
      const V0 = localStorage.getItem('skt-view-prefs-v1');
      const st0 = JSON.stringify(state.settings);

      state.settings.fontScale = 1.6;
      state.settings.uiHide = { ...(state.settings.uiHide || {}), dock: true };
      state.settings.currencySymbol = 'sp';
      save();
      const shared = JSON.parse(localStorage.getItem('skt-settings-v1') || '{}');
      const mine   = JSON.parse(localStorage.getItem('skt-view-prefs-v1') || '{}');
      ok('settings: font scale is not in the synced record',
         !('fontScale' in shared), JSON.stringify(Object.keys(shared).slice(0, 8)));
      ok('settings: hidden chrome is not either', !('uiHide' in shared));
      // The positive control: this must not have quietly stopped syncing
      // everything, which would pass the two checks above just as well.
      ok('settings: campaign settings still sync', shared.currencySymbol === 'sp');
      ok('settings: the device keeps its own copy', mine.fontScale === 1.6,
         JSON.stringify(mine));
      // A device on an older build still sends the old shape.
      localStorage.setItem('skt-settings-v1',
        JSON.stringify({ ...shared, fontScale: 0.6, uiHide: { dock: false } }));
      loadDomain('settings');
      ok('settings: an incoming payload cannot resize this screen',
         state.settings.fontScale === 1.6, String(state.settings.fontScale));
      ok('settings: the per-device record is never synced',
         SKT_SYNC_KEYS.indexOf('skt-view-prefs-v1') < 0);

      if (S0 != null) localStorage.setItem('skt-settings-v1', S0);
      if (V0 != null) localStorage.setItem('skt-view-prefs-v1', V0);
      state.settings = JSON.parse(st0);
    }

    // The clock and the weather are campaign state — already in the backup
    // list — but were not synced, so two DM devices disagreed about the
    // date and the players could see neither.
    // ── Rage resistance ───────────────────────────────────────────────────
    // Raging gives resistance to bludgeoning, piercing and slashing. This is
    // arithmetic applied to real hit points, so it is worth pinning: a
    // regression here is silent and the barbarian just dies sooner.
    {
      const P0 = JSON.stringify(state.party), K0 = JSON.stringify(state.combatants);
      const hit = (raging, amount, type) => {
        state.party = [{ id:'zzbarb', name:'ZZ Barb', cls:'barbarian', level:5,
                         hp:80, hpMax:80, ac:15, rage: !!raging }];
        state.combatants = [{ id:'zzbarb', name:'ZZ Barb', isPC:true, hp:80, hpMax:80, ac:15 }];
        panelDefs.combat._applyHpDelta(0, -amount, type);
        return 80 - state.combatants[0].hp;
      };
      ok('rage: slashing is halved',    hit(true, 20, 'slashing')    === 10, String(hit(true, 20, 'slashing')));
      ok('rage: piercing is halved',    hit(true, 20, 'piercing')    === 10, String(hit(true, 20, 'piercing')));
      ok('rage: bludgeoning is halved', hit(true, 20, 'bludgeoning') === 10, String(hit(true, 20, 'bludgeoning')));
      // Rage covers those three and nothing else. Without this the check
      // above would pass just as well if everything were being halved.
      ok('rage: fire is not halved', hit(true, 20, 'fire') === 20, String(hit(true, 20, 'fire')));
      ok('rage: nothing is halved when not raging',
         hit(false, 20, 'slashing') === 20, String(hit(false, 20, 'slashing')));
      // 21 halved is 10, not 11 — resistance rounds down, in the defender’s
      // favour. The delta here is negative, so the code needs ceil to do it.
      ok('rage: an odd total rounds the damage down',
         hit(true, 21, 'slashing') === 10, String(hit(true, 21, 'slashing')));
      // Untyped damage — the -/+ buttons. Rage is B/P/S only, so there is no
      // honest way to halve a number with no type attached; the log says so
      // rather than the arithmetic guessing.
      ok('rage: untyped damage is not silently halved',
         hit(true, 20, null) === 20, String(hit(true, 20, null)));
      // A young red dragon bites for piercing AND fire in one attack. Rage
      // resists the piercing and not the fire, so the two have to be resolved
      // separately. Summing them under one label gives 15 or 30 depending on
      // which label wins; the right answer is 20.
      {
        const T = panelDefs.turnview;
        state.party = [{ id:'zzbite', name:'ZZ Bite', cls:'barbarian', level:5,
                         hp:400, hpMax:400, ac:1, rage:true }];
        state.combatants = [{ id:'zzbite', name:'ZZ Bite', isPC:true, hp:400, hpMax:400, ac:1 }];
        const t = state.combatants[0];
        const hit = parts => { t.hp = 400; state.party[0].hp = 400;
          T._applyDamage(t, parts, false, false); return 400 - t.hp; };
        ok('rage: a mixed-type attack resists only the part it should',
           hit([{amt:20,type:'piercing'},{amt:10,type:'fire'}]) === 20,
           String(hit([{amt:20,type:'piercing'},{amt:10,type:'fire'}])));
        // The two wrong answers that check rules out, asserted so a future
        // change to one-call-per-type cannot pass by coincidence.
        ok('rage: 30 piercing alone would be 15', hit([{amt:30,type:'piercing'}]) === 15);
        ok('rage: 30 fire alone would be 30',     hit([{amt:30,type:'fire'}]) === 30);

        // Saying WHY the number changed. The tracker has always written
        // "rage resist, ½" into its own log, but the Turn View is the panel
        // a DM watches during a fight and it reported "hit for 12" while
        // taking 6 off, with the explanation in a window they may not have
        // open.
        const notes = parts => { t.hp = 400; state.party[0].hp = 400;
          T._applyDamage(t, parts, false, false);
          return (T._lastDmgNotes || []).slice(); };
        ok('dmg note: a resisted hit says why',
           /rage resist/.test((notes([{amt:20,type:'slashing'}])[0] || '')),
           JSON.stringify(notes([{amt:20,type:'slashing'}])));
        // One part: the line already reads "20 slashing", so repeating the
        // type in the note beside it is a stutter.
        ok('dmg note: the type is not repeated for a single part',
           !/slashing/.test((notes([{amt:20,type:'slashing'}])[0] || '')),
           JSON.stringify(notes([{amt:20,type:'slashing'}])));
        // Several parts: the type is the only thing telling the resisted
        // half apart from the one that landed in full.
        ok('dmg note: the type is kept when there is more than one',
           /^piercing —/.test((notes([{amt:20,type:'piercing'},{amt:10,type:'fire'}])[0] || '')),
           JSON.stringify(notes([{amt:20,type:'piercing'},{amt:10,type:'fire'}])));
        // And nothing at all when nothing happened to the number, or every
        // ordinary hit picks up noise.
        // The log line is what a DM scrolls back through when someone asks
        // why the barbarian only took seven, so it has to carry the whole
        // derivation: the dice, the reason the total changed, and the number
        // actually taken.
        {
          const strip = h => String(h || '').replace(/<[^>]*>/g, '')
                               .replace(/\s+/g, ' ').trim();
          const line = (parts, detail) => {
            t.hp = 400; state.party[0].hp = 400;
            T._log.length = 0;
            T._commit({ attacker:'Thing', target:t, hit:true, dmg:parts.reduce((n,p)=>n+p.amt,0),
                        type:parts[0].type, parts, detail, label:'Hit', crit:false });
            return strip(T._log[0] || '');
          };

          // A mixed hit used to be described by its first type and its grand
          // total — "19 piercing" for 18 piercing plus 1 fire. The result
          // line was fixed for exactly this and the log was not.
          const mixed = line([{amt:18,type:'piercing'},{amt:1,type:'fire'}],
                             'piercing 6+6+6 · fire 1');
          ok('dmg log: every damage type is named, not just the first',
             /18 piercing \+ 1 fire/.test(mixed), mixed);
          ok('dmg log: the dice are shown', /6\+6\+6/.test(mixed), mixed);
          // 18 piercing halved is 9, the fire lands whole: 10 taken.
          ok('dmg log: it states what was actually taken',
             /10<\/strong> taken|10 taken/.test(mixed), mixed);

          // Nothing resisted: no reason clause, and no "taken" restating a
          // number the line already gives.
          const plain = line([{amt:12,type:'fire'}], 'fire 8+4');
          ok('dmg log: an ordinary hit stays clean',
             !/taken/.test(plain) && !/resist/.test(plain), plain);
          // With one type the breakdown does not repeat the word.
          // "Taken" means damage after resist/immune/vulnerable, NOT hit
          // points lost. They differ whenever temp HP or a beast pool is in
          // the way, and reporting the wrong one made a hit fully absorbed
          // by temp HP read as "0 taken · 40 → 40" — as though the attack
          // had missed. 5e counts soaked damage as damage taken; it is what
          // triggers a concentration save.
          {
            const P1 = JSON.stringify(state.party), K1 = JSON.stringify(state.combatants);
            const run = (party, parts, detail) => {
              state.party = [party];
              state.combatants = [{ id:'zzsoak', name:'ZZ Soak', isPC:true,
                                    hp:party.hp, hpMax:party.hpMax, ac:12 }];
              const c = state.combatants[0];
              T._log.length = 0;
              T._commit({ attacker:'Thing', target:c, hit:true,
                          dmg:parts.reduce((n,p)=>n+p.amt,0), type:parts[0].type,
                          parts, detail, label:'Hit', crit:false });
              return strip(T._log[0] || '');
            };

            const soaked = run(
              { id:'zzsoak', name:'ZZ Soak', cls:'wizard', level:5, hp:40, hpMax:40, ac:12, tempHp:20 },
              [{amt:12,type:'fire'}], 'fire 8+4');
            ok('dmg log: damage absorbed by temp HP is not reported as zero',
               !/0<\/strong> taken|→ 0 taken/.test(soaked), soaked);
            ok('dmg log: it says what soaked it', /12 soaked by temp HP/.test(soaked), soaked);

            // Resisted AND partly soaked: 20 slashing halves to 10 taken, 5
            // of which the temp HP eats, so 5 comes off hit points.
            const both = run(
              { id:'zzsoak', name:'ZZ Soak', cls:'barbarian', level:5, hp:60, hpMax:60,
                ac:12, rage:true, tempHp:5 },
              [{amt:20,type:'slashing'}], 'slashing 9+11');
            ok('dmg log: resistance and soak are both explained',
               /rage resist/.test(both) && /10<\/strong> taken|10 taken/.test(both)
            && /5 soaked by temp HP/.test(both), both);

            // Nothing in the way: neither clause, or every ordinary hit gets
            // two pieces of arithmetic it does not need.
            const plain2 = run(
              { id:'zzsoak', name:'ZZ Soak', cls:'wizard', level:5, hp:60, hpMax:60, ac:12 },
              [{amt:12,type:'fire'}], 'fire 8+4');
            ok('dmg log: a plain hit gains neither clause',
               !/taken/.test(plain2) && !/soaked/.test(plain2), plain2);

            state.party = JSON.parse(P1); state.combatants = JSON.parse(K1);
          }

          ok('dmg log: the type is not repeated in the dice',
             /\[8\+4\]/.test(plain), plain);
        }

        ok('dmg note: an unresisted hit gets no note',
           notes([{amt:20,type:'fire'}]).length === 0,
           JSON.stringify(notes([{amt:20,type:'fire'}])));
      }
      state.party = JSON.parse(P0); state.combatants = JSON.parse(K0);
    }

    // ── Campaigns ─────────────────────────────────────────────────────────
    // One browser, several campaigns, each with its own everything. The
    // failure mode that matters is leakage: a campaign inheriting another’s
    // party, or a switch pushing one group’s state over another group’s
    // table. Both are silent and neither is recoverable.
    if (typeof sktCampaigns === 'function'){
      const A0 = sktActiveCampaign();
      const PARTY = 'skt-party-v1';
      const keep = localStorage.getItem(PARTY);

      // Naming a campaign used to use the browser's own prompt() — an
      // operating-system dialog in the middle of a themed app, and one that
      // some browsers let a user disable for the rest of the session with a
      // "prevent more dialogs" tick. A native prompt would also hang this
      // suite outright, so reaching the end of this block is half the check.
      if (typeof sktOpenCampaignManager === 'function'){
        const realPrompt = window.prompt;
        let native = false;
        window.prompt = () => { native = true; return null; };
        sktOpenCampaignManager();
        await sleep(250);
        const newBtn = document.querySelector('[data-camp-new]');
        ok('campaign: the manager offers a new-campaign button', !!newBtn);
        if (newBtn){
          newBtn.click();
          await sleep(250);
          const dlg = document.querySelector('.camp-ask');
          ok('campaign: naming one uses the app\u2019s own dialog', !!dlg);
          ok('campaign: and not the browser\u2019s prompt', native === false);
          if (dlg){
            const input = dlg.querySelector('#camp-ask-input');
            // Focused, or you have a dialog you must click before typing.
            ok('campaign: the field is focused ready to type',
               document.activeElement === input);
            // Measured, not asserted from the markup: a field that overflows
            // its own dialog is the failure this kind of check exists for.
            const d = dlg.getBoundingClientRect(), i = input.getBoundingClientRect();
            ok('campaign: the field sits inside the dialog',
               i.right <= d.right + 1 && i.left >= d.left - 1,
               Math.round(i.width) + ' in ' + Math.round(d.width));
            ok('campaign: it has both a cancel and a confirm',
               dlg.querySelectorAll('.modal-actions .btn').length === 2);
            dlg.querySelector('[data-ask-cancel]').click();
            await sleep(150);
            ok('campaign: cancelling closes it', !document.querySelector('.camp-ask'));
          }
        }
        window.prompt = realPrompt;
        document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
      }

      ok('campaign: an existing browser is adopted rather than emptied',
         sktCampaigns().length >= 1 && !!sktActiveCampaign());
      // The whole point of the Firebase side: the path carries the id, so
      // two campaigns cannot write to one tree.
      ok('campaign: the sync root is campaign-scoped',
         /^skt\/c\//.test(sktFbRoot()), sktFbRoot());

      localStorage.setItem(PARTY, JSON.stringify([{id:'zza', name:'ZZ Alpha'}]));
      const idB = sktCreateCampaign('ZZ Second');
      const rootBefore = sktFbRoot();
      const switched = sktSwitchCampaign(idB);
      ok('campaign: switching reports success', switched === true);
      ok('campaign: and redirects the sync root',
         sktFbRoot() !== rootBefore, sktFbRoot());
      // A brand new campaign must NOT inherit the last one’s party.
      {
        let p = null;
        try { p = JSON.parse(localStorage.getItem(PARTY) || 'null'); } catch(e){}
        ok('campaign: a new one starts empty', !p || p.length === 0, JSON.stringify(p));
      }
      localStorage.setItem(PARTY, JSON.stringify([{id:'zzb', name:'ZZ Beta'}]));

      sktSwitchCampaign(A0);
      {
        let p = null;
        try { p = JSON.parse(localStorage.getItem(PARTY) || 'null'); } catch(e){}
        ok('campaign: switching back restores the first one exactly',
           eqJ((p || []).map(x => x.name), ['ZZ Alpha']), JSON.stringify(p));
      }
      sktSwitchCampaign(idB);
      {
        let p = null;
        try { p = JSON.parse(localStorage.getItem(PARTY) || 'null'); } catch(e){}
        ok('campaign: and the second still holds its own',
           eqJ((p || []).map(x => x.name), ['ZZ Beta']), JSON.stringify(p));
      }

      // Per-device things describe the browser, not a campaign, and must
      // survive a switch rather than being swapped with everything else.
      const me0 = localStorage.getItem('skt-me-v1');
      localStorage.setItem('skt-me-v1', 'zztester');
      sktSwitchCampaign(A0);
      ok('campaign: per-device keys are not swapped',
         localStorage.getItem('skt-me-v1') === 'zztester');
      if (me0 == null) localStorage.removeItem('skt-me-v1');
      else localStorage.setItem('skt-me-v1', me0);

      // The link is how a group lands in the right campaign, so it has to
      // carry the id and the player flag.
      {
        const link = sktPlayerLink(idB);
        ok('campaign: the player link names the campaign',
           link.indexOf('c=' + idB) >= 0 && /player=1/.test(link), link);
      }

      // Deleting the campaign you are standing in would leave the live keys
      // with nowhere to belong.
      // Moving to skt/c/<id> left every campaign tree empty at once, and an
      // empty tree is the signal that makes a client publish its own local
      // copy as the campaign. That was written when empty meant "nobody has
      // upgraded", and any client filling it was an improvement; now it
      // means the first device to open decides what the campaign is.
      //
      // Read from the source because the seed path needs a live Firebase
      // handle and an absent node to reach, neither of which exists here.
      try {
        const src = await (await fetch('/js/sync/realtime.js')).text();
        ok('campaign: a player device cannot seed an empty campaign',
           /_maySeedEmpty\(\)\s*\{\s*return\s*!_isPlayerMode\(\)/.test(src),
           'a stale phone opening first would become the campaign');
        // Both seed paths, whole-key and entity. Guarding one and not the
        // other would look fixed and leave half the domains exposed.
        ok('campaign: and the guard is on both seed paths',
           (src.match(/_maySeedEmpty\(\)/g) || []).length >= 3,
           String((src.match(/_maySeedEmpty\(\)/g) || []).length));
      } catch(e){
        ok('campaign: a player device cannot seed an empty campaign', false, e.message);
      }

      // "Does the app still WORK after a switch?" — the checks above prove
      // the keys move and the sync root changes, which is not the same
      // question. A switch reloads the page, and the page it reloads into
      // has no data at all, which nothing else in this suite exercises.
      {
        const idC = sktCreateCampaign('ZZ Fresh');
        sktSwitchCampaign(idC);
        // "No key" is not "empty": state.js falls back to DEFAULT_PARTY when
        // the party key is missing, so a new campaign came up holding the
        // five demo characters the app ships with and looked like a
        // half-copy of a real one.
        {
          let p = null;
          try { p = JSON.parse(localStorage.getItem('skt-party-v1') || 'null'); } catch(e){}
          ok('campaign: a new one has an explicitly empty party, not the demo one',
             Array.isArray(p) && p.length === 0, JSON.stringify(p));
        }
        // Now the real question: with nothing stored, does anything still
        // render? Panels that assume a party or a map exist would throw here
        // and nowhere else.
        load();
        const ids = ['combat', 'party', 'turnview', 'battlemap', 'notes', 'loot',
                     'encounter', 'shop', 'time', 'weather'];
        const broke = [];
        for (const id of ids){
          const before = errs.length;
          try { openPanel(id); } catch(e){ errs.push(id + ': ' + e.message); }
          await sleep(180);
          const d = panelDefs[id];
          if (!d || !d._body || !d._body.children.length || errs.length !== before) broke.push(id);
          try { closePanel(id); } catch(e){}
        }
        ok('campaign: every panel still renders on a campaign with no data',
           broke.length === 0, broke.join(', '));

        sktSwitchCampaign(A0);
        load();
        sktDeleteCampaign(idC);
      }

      // ── Arriving by a player link ────────────────────────────────────────
      // The player link is the ONLY way a second device learns which campaign
      // it belongs to, and it was being ignored. sktActiveCampaign() honoured
      // ?c= only when the id was already in this browser's registry — which on
      // a player's phone it never is. So every link to any campaign other than
      // "main" silently resolved to main: the player synced against a subtree
      // the DM was not writing to, and saw no map, no tokens and no combat
      // while everything looked connected.
      if (typeof sktAdoptCampaignLink === 'function'){
        const before   = sktActiveCampaign();
        const beforeN  = sktCampaigns().length;
        const LINKED   = 'zzlinked1';

        // A party in the campaign we are about to leave, so the swap can be
        // checked for having actually moved the keys rather than merged them.
        localStorage.setItem('skt-party-v1', JSON.stringify([{ id: 'zzp', name: 'Left Behind' }]));

        ok('campaign: a link to an unknown campaign is adopted, not ignored',
           sktAdoptCampaignLink(LINKED, 'Linked Table') === true);
        ok('campaign: and it is the one this client syncs to',
           sktFbRoot() === 'skt/c/' + LINKED, sktFbRoot());
        ok('campaign: it joins the registry under the name the link carried',
           (sktCampaigns().find(c => c.id === LINKED) || {}).name === 'Linked Table');

        // The swap has to MOVE the keys. Leaving them would hand the incoming
        // campaign the outgoing one's party.
        let landed = null;
        try { landed = JSON.parse(localStorage.getItem('skt-party-v1') || 'null'); } catch(e){}
        ok('campaign: the previous campaign party does not follow you in',
           Array.isArray(landed) && landed.length === 0, JSON.stringify(landed));

        // ...and it is still there when you go back, rather than discarded.
        sktAdoptCampaignLink(before, 'back');
        let restored = null;
        try { restored = JSON.parse(localStorage.getItem('skt-party-v1') || 'null'); } catch(e){}
        ok('campaign: and it is waiting when you return',
           Array.isArray(restored) && restored.length === 1 && restored[0].name === 'Left Behind',
           JSON.stringify(restored));

        // An id decides a database path, so a malformed one must never reach it.
        const root0 = sktFbRoot();
        ok('campaign: a malformed link id is refused',
           sktAdoptCampaignLink('../../evil', 'x') === false
           && sktAdoptCampaignLink('', 'x') === false
           && sktFbRoot() === root0, sktFbRoot());

        // Clean up the campaign this check invented.
        try {
          const list = sktCampaigns().filter(c => c.id !== LINKED);
          localStorage.setItem('skt-campaigns-v1', JSON.stringify(list));
          localStorage.removeItem('skt-campaign-data-' + LINKED);
        } catch(e){}
        ok('campaign: the link checks left the registry as they found it',
           sktCampaigns().length === beforeN && sktActiveCampaign() === before,
           sktCampaigns().length + ' vs ' + beforeN);
        load();
      }

      // ── A restore replaces the OPEN campaign and nothing else ─────────────
      // Restore clears every app key the file lacks. A backup from before
      // campaigns existed therefore deleted the campaign list and the stored
      // copy of every other campaign — a second table's whole party gone —
      // and the confirmation never said so, because it lists only keys it
      // has a friendly name for. The fixture IS such a file.
      if (window.sktBackup && typeof sktCreateCampaign === 'function'){
        const ALL = {};
        for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (k) ALL[k] = localStorage.getItem(k); }
        const partyOf = id => { try { return JSON.parse(JSON.parse(localStorage.getItem('skt-campaign-data-' + id) || 'null')['skt-party-v1']); } catch(e){ return null; } };
        try {
          const oldFile = await (await fetch('tools/fixture.json', { cache: 'no-store' })).text();
          const here = sktActiveCampaign();
          const otherId = sktCreateCampaign('ZZ Restore Other');
          sktSwitchCampaign(otherId);
          localStorage.setItem('skt-party-v1', JSON.stringify([{ id: 'zzo', name: 'Other Hero' }]));
          sktSwitchCampaign(here);
          localStorage.setItem('skt-npcgen-last-v1', '"zz only here"');

          const p1 = sktBackup.parse(oldFile);
          const info = sktBackup.describe(p1);
          ok('restore: the confirmation names the campaign it replaces', !!info.target, String(info.target));
          await sktBackup.restore(p1, { syncTimeoutMs: 300 });
          ok('restore: an old backup leaves the other campaigns alone',
             (partyOf(otherId) || []).some(p => p.name === 'Other Hero')
             && sktCampaigns().some(c => c.id === otherId),
             JSON.stringify(sktCampaigns().map(c => c.name)));
          ok('restore: the open campaign stays open', sktActiveCampaign() === here, sktActiveCampaign());
          // ...and is still genuinely replaced rather than merged into.
          ok('restore: the open campaign is replaced, not merged',
             localStorage.getItem('skt-npcgen-last-v1') == null);

          // A newer file carrying a campaign this browser lacks adds it, and
          // never overwrites one that is already here.
          const snap = sktBackup.snapshot();
          // From the live registry if the snapshot lacks one: a restore that
          // misbehaves deletes it, and crashing here would abort the whole DM
          // pass and discard every failure already recorded above.
          const list = JSON.parse(snap.keys['skt-campaigns-v1'] || JSON.stringify(sktCampaigns()));
          list.push({ id: 'czzfile', name: 'ZZ From File', created: null });
          snap.keys['skt-campaigns-v1'] = JSON.stringify(list);
          snap.keys['skt-campaign-data-czzfile'] = JSON.stringify({ 'skt-party-v1': JSON.stringify([{ id: 'f', name: 'File Hero' }]) });
          snap.keys['skt-campaign-data-' + otherId] = JSON.stringify({ 'skt-party-v1': JSON.stringify([{ id: 'x', name: 'Stale Copy' }]) });
          await sktBackup.restore(sktBackup.parse(JSON.stringify(snap)), { syncTimeoutMs: 300 });
          ok('restore: a campaign only the file has is added',
             sktCampaigns().some(c => c.id === 'czzfile') && (partyOf('czzfile') || []).some(p => p.name === 'File Hero'));
          ok('restore: a campaign already here is never overwritten by the file',
             (partyOf(otherId) || []).some(p => p.name === 'Other Hero'));
        } catch(e){
          ok('restore: the restore checks ran to completion', false, e.message);
        } finally {
          const now = []; for (let i = 0; i < localStorage.length; i++) now.push(localStorage.key(i));
          now.forEach(k => { if (k && !(k in ALL)) localStorage.removeItem(k); });
          Object.keys(ALL).forEach(k => localStorage.setItem(k, ALL[k]));
          load();
        }
      }

      ok('campaign: deleting the open one is refused',
         sktDeleteCampaign(sktActiveCampaign()) === false);
      ok('campaign: deleting another works', sktDeleteCampaign(idB) === true);
      ok('campaign: and takes its stored copy with it',
         localStorage.getItem('skt-campaign-data-' + idB) == null);

      if (keep == null) localStorage.removeItem(PARTY);
      else localStorage.setItem(PARTY, keep);
    }

    // ── Rivals ────────────────────────────────────────────────────────────
    // A character with a full sheet who fights AGAINST the party. Sides used
    // to be read straight off isPC, which conflated "has a sheet in the party
    // roster" with "is on the party’s side" and left no way to express one
    // without the other.
    {
      const P0 = JSON.stringify(state.party), K0 = JSON.stringify(state.combatants);
      const A0 = state.activeCombatantId;
      state.party = [
        { id:'zzhero',  name:'ZZ Hero',  cls:'fighter', level:5, hp:40, hpMax:40, ac:16, resources:[] },
        { id:'zzrival', name:'ZZ Rival', cls:'rogue',   level:5, hp:35, hpMax:35, ac:15, resources:[], foe:true },
      ];
      state.combatants = [
        { id:'zzhero',  name:'ZZ Hero',  isPC:true,  hp:40, hpMax:40, ac:16 },
        { id:'zzrival', name:'ZZ Rival', isPC:true,  hp:35, hpMax:35, ac:15 },
        { id:'zzogre',  name:'ZZ Ogre',  isPC:false, hp:59, hpMax:59, ac:11 },
      ];
      state.activeCombatantId = 'zzhero';
      save();

      ok('rival: a party member is on the party side',
         sktSideOf(state.combatants[0]) === 'party');
      ok('rival: a rival is on the enemy side even though it has a sheet',
         sktSideOf(state.combatants[1]) === 'foe' && state.combatants[1].isPC === true);
      ok('rival: a monster is still a foe', sktSideOf(state.combatants[2]) === 'foe');
      ok('rival: the players’ party excludes it',
         eqJ(sktPlayerParty().map(p => p.name), ['ZZ Hero']),
         JSON.stringify(sktPlayerParty().map(p => p.name)));

      // The reason sides exist at all: a rival must provoke from the party
      // and not from the monsters it is fighting alongside.
      openPanel('battlemap'); await sleep(400);
      openPanel('turnview');  await sleep(400);
      if (typeof sktEnsureCombatTokens === 'function') sktEnsureCombatTokens(true);
      await sleep(200);
      const T2 = panelDefs.turnview;
      const cs2 = T2._cs() || 50;
      const tk = id => T2._tokenFor(state.combatants.find(c => c.id === id));
      const th = tk('zzhero'), tr = tk('zzrival'), to = tk('zzogre');
      ok('rival: tokens are placed for the reach test', !!(th && tr && to));
      if (th && tr && to){
        th.x = 0; th.y = 0; to.x = 0; to.y = cs2;   // both adjacent to the rival
        tr.x = cs2; tr.y = 0;
        const from = { x: tr.x, y: tr.y };
        tr.x = cs2 * 5;                             // and it walks away
        state.combatants.forEach(c => { c.reactionUsed = false; });
        const who = T2._provokedBy(state.combatants[1], from).map(c => c.name);
        ok('rival: it provokes from the party', who.indexOf('ZZ Hero') >= 0, JSON.stringify(who));
        // The half that was broken before: without a side, a sheet-backed
        // enemy provoked from its own allies.
        ok('rival: and not from the monster beside it',
           who.indexOf('ZZ Ogre') < 0, JSON.stringify(who));
      }

      // It has to read as an enemy on the tracker, or it looks like a party
      // member in the wrong row.
      openPanel('combat'); await sleep(300);
      panelDefs.combat._render(); await sleep(300);
      {
        const html = panelDefs.combat._body ? panelDefs.combat._body.innerHTML : '';
        ok('rival: the combat card badges it', /foe-pill/.test(html));
        // One badge, on the rival — not on everything with a sheet.
        ok('rival: only the rival is badged',
           (html.match(/foe-pill/g) || []).length === 1,
           String((html.match(/foe-pill/g) || []).length));
      }
      closePanel('combat'); closePanel('turnview'); closePanel('battlemap');
      state.party = JSON.parse(P0); state.combatants = JSON.parse(K0);
      state.activeCombatantId = A0; save();
    }

    // ── Concurrent drawing ────────────────────────────────────────────────
    // The battle map keeps every drawing in ONE node holding ONE array, and
    // both the DM and the players write it. The entity merge kept whichever
    // side was local and discarded the other wholesale, which is right for a
    // token — one object, one owner — and wrong for a list several people
    // append to. Two people drawing at the same moment: whoever pushed last
    // erased the other one strokes. Reported as "sometimes it does not show
    // for others".
    if (typeof window.sktEntitySpec === 'function'){
      const spec = window.sktEntitySpec('skt-battlemap-v1');
      ok('draw: the battlemap spec knows how to merge a node',
         !!spec && typeof spec.mergeNode === 'function');
      if (spec && spec.mergeNode){
        const S = (...n) => JSON.stringify(n.map(i => ({ c:'#f00', s:3, p:[i, i] })));
        const M = (base, mine, theirs) =>
          JSON.parse(spec.mergeNode('drawings', base, mine, theirs)).map(o => o.p[0]);

        // The bug itself: I drew 2, they drew 3, both from a base of 1.
        ok('draw: two people drawing at once keep both strokes',
           eqJ(M(S(1), S(1, 2), S(1, 3)), [1, 2, 3]),
           JSON.stringify(M(S(1), S(1, 2), S(1, 3))));
        // A union alone would do that much and also resurrect anything
        // erased, which is why the merge needs the base: I deleted 2, they
        // still have it, and it must stay deleted.
        ok('draw: a stroke one side erased does not come back',
           eqJ(M(S(1, 2), S(1), S(1, 2)), [1]),
           JSON.stringify(M(S(1, 2), S(1), S(1, 2))));
        ok('draw: a stroke both erased stays gone',
           eqJ(M(S(1, 2), S(1), S(1)), [1]));
        ok('draw: identical sides merge to themselves',
           eqJ(M(S(1), S(1), S(1)), [1]));
        // Only the list-shaped nodes. Everything else must fall through to
        // the caller, or a token merge silently changes behaviour too.
        ok('draw: nodes it does not own are left alone',
           spec.mergeNode('meta', '{}', '{"a":1}', '{"a":2}') === undefined);
        // Every check above exercises mergeNode directly, and every one of
        // them stays green if the apply path stops calling it — which is the
        // bug, not the helper. That has now happened three times in this
        // suite (the D&D Beyond readers, the condition table, this), so it is
        // worth guarding rather than remembering.
        //
        // _applyEntitySnapshot is module-scope and needs a real Firebase
        // snapshot to drive, so this reads the source instead. A static check
        // is weaker than a behavioural one and is here because the
        // behavioural one is not reachable — not because it is preferable.
        try {
          const src = await (await fetch('/js/sync/realtime.js')).text();
          const applyFn = src.slice(src.indexOf('function _applyEntitySnapshot'),
                                    src.indexOf('function _patchLocalStorage'));
          ok('draw: the apply path actually calls mergeNode',
             /spec\.mergeNode\(/.test(applyFn),
             'mergeNode is defined but never called when a node changes on both sides');
        } catch(e){
          ok('draw: the apply path actually calls mergeNode', false, 'could not read source: ' + e.message);
        }

        ok('draw: fog strokes merge the same way',
           eqJ(JSON.parse(spec.mergeNode('fogStrokes', S(1), S(1, 2), S(1, 3))).map(o => o.p[0]), [1, 2, 3]));
      }
    }

    // ── Conditions ────────────────────────────────────────────────────────
    // Twelve conditions were tracked and displayed as badges while every
    // attack roll ignored all twelve — a prone, restrained or paralysed
    // target was attacked exactly like a healthy one.
    {
      const T = panelDefs.turnview;
      const P0 = JSON.stringify(state.party), K0 = JSON.stringify(state.combatants);
      const A0 = state.activeCombatantId;
      state.party = [];
      state.combatants = [
        { id:'zzatk', name:'ZZ Atk', isPC:false, hp:50, hpMax:50, ac:12, conditions:[] },
        { id:'zztgt', name:'ZZ Tgt', isPC:false, hp:50, hpMax:50, ac:12, conditions:[] },
      ];
      state.activeCombatantId = 'zzatk';
      save();
      openPanel('battlemap'); await sleep(400);
      openPanel('turnview');  await sleep(400);
      if (typeof sktEnsureCombatTokens === 'function') sktEnsureCombatTokens(true);
      await sleep(200);
      const cs = T._cs() || 50;
      // Conditions plus a distance, since prone and the automatic crit both
      // depend on how far apart the two are.
      const mods = (atkC, tgtC, ft) => {
        state.combatants[0].conditions = atkC;
        state.combatants[1].conditions = tgtC;
        const x = T._tokenFor(state.combatants[0]), y = T._tokenFor(state.combatants[1]);
        if (x && y){ x.x = 0; x.y = 0; y.x = cs * (ft / T._ftPerCell()); y.y = 0; }
        return T._condMods(state.combatants[0], state.combatants[1]);
      };
      ok('cond: both tokens are placed for the distance tests',
         !!T._tokenFor(state.combatants[0]) && !!T._tokenFor(state.combatants[1]));

      // The attacker’s own conditions.
      ok('cond: a blinded attacker has disadvantage',
         mods(['Blinded'], [], 5).dis.length === 1);
      ok('cond: a poisoned attacker has disadvantage',
         mods(['Poisoned'], [], 5).dis.length === 1);
      ok('cond: a prone attacker has disadvantage',
         mods(['Prone'], [], 5).dis.length === 1);
      // The target’s.
      ok('cond: a restrained target is attacked with advantage',
         mods([], ['Restrained'], 5).adv.length === 1);
      ok('cond: a stunned target is attacked with advantage',
         mods([], ['Stunned'], 5).adv.length === 1);

      // Prone is the one that cuts both ways, and the only reason the panel
      // can tell is that it knows where the tokens are.
      ok('cond: a prone target in melee gives advantage',
         mods([], ['Prone'], 5).adv.length === 1 && mods([], ['Prone'], 5).dis.length === 0);
      ok('cond: a prone target at range gives disadvantage',
         mods([], ['Prone'], 30).dis.length === 1 && mods([], ['Prone'], 30).adv.length === 0);

      // "A hit against a paralysed creature is a critical hit if the attacker
      // is within 5 feet" — so the distance decides, not the condition alone.
      ok('cond: paralysed within 5 ft is an automatic crit',
         mods([], ['Paralyzed'], 5).autoCrit === true);
      ok('cond: paralysed at range is advantage but no automatic crit',
         mods([], ['Paralyzed'], 30).autoCrit === false
      && mods([], ['Paralyzed'], 30).adv.length === 1);

      // 5e does not stack or net these out: any advantage with any
      // disadvantage is a straight roll.
      {
        const both = mods(['Blinded'], ['Restrained'], 5);
        ok('cond: advantage and disadvantage are both collected',
           both.adv.length === 1 && both.dis.length === 1);
      }
      // Conditions with no attack-roll effect must not invent one. Without
      // this the checks above would pass with everything flagged.
      // The checks above all exercise _condMods on its own, and every one of
      // them stays green if _rollAttack stops calling it — which is the whole
      // bug. These drive a real attack instead. The attacker is named Ogre
      // because _attacksFor resolves the stat block by name.
      {
        const strip = h => String(h || '').replace(/<[^>]*>/g, '')
                             .replace(/\s+/g, ' ').trim();
        state.combatants[0].name = 'Ogre';
        state.combatants[1].ac = 1;            // so every swing lands
        state.combatants[1].hp = 400; state.combatants[1].hpMax = 400;
        const swing = (atkC, tgtC, ft) => {
          mods(atkC, tgtC, ft);
          state.combatants[1].hp = 400;
          T._armed = 'zztgt';
          T._rollAttack(0, {});
          return strip((T._body.querySelector('.tv-result') || {}).textContent || '');
        };

        const restr = swing([], ['Restrained'], 5);
        ok('cond/roll: a restrained target actually rolls with advantage',
           /adv/.test(restr) && /target restrained/.test(restr), restr.slice(0, 110));
        // Two dice on the line, not one — advantage that is announced but
        // not rolled would pass a text check alone.
        ok('cond/roll: two dice were rolled and the higher kept',
           /\d+\/\d+ → \d+ adv/.test(restr), restr.slice(0, 110));

        const cancel = swing(['Blinded'], ['Restrained'], 5);
        ok('cond/roll: opposing sources cancel to a straight roll',
           /straight —/.test(cancel) && !/ adv| dis/.test(cancel.split('·')[1] || ''),
           cancel.slice(0, 130));

        // Paralysed within 5 ft: every hit is a critical hit, so this is not
        // a matter of luck over four swings.
        const near = [];
        for (let i = 0; i < 4; i++) near.push(swing([], ['Paralyzed'], 5));
        // A natural 1 misses whatever the AC is — correct, and it means the
        // assertion is about the swings that LANDED, not all of them.
        const landed = near.filter(x => !/^Miss/.test(x));
        ok('cond/roll: enough swings landed to judge', landed.length >= 2, String(landed.length));
        ok('cond/roll: every hit on a paralysed target in melee crits',
           landed.every(x => /Critical hit/.test(x)),
           landed.map(x => x.slice(0, 40)).join(' | '));
        // Every landed swing crits, but only the ones that would NOT have
        // crit on their own carry the note — a natural 20 needs no
        // explanation, and labelling it "automatic" would be wrong.
        ok('cond/roll: and it says why unless the die said it already',
           landed.every(x => /automatic crit within 5 ft/.test(x) || /→ 20 adv/.test(x)),
           landed.map(x => x.slice(0, 60)).join(' | '));
        // At range it is advantage only. Asserted on the phrase rather than
        // on the crit count, because a natural 20 will turn up eventually and
        // would make a count-based check fail at random.
        const far = [];
        for (let i = 0; i < 4; i++) far.push(swing([], ['Paralyzed'], 30));
        ok('cond/roll: no automatic crit at range',
           far.every(x => !/automatic crit/.test(x)),
           far.map(x => x.slice(0, 40)).join(' | '));
      }

      ok('cond: charmed and grappled change nothing',
         mods(['Charmed'], ['Grappled'], 5).adv.length === 0
      && mods(['Charmed'], ['Grappled'], 5).dis.length === 0);

      state.party = JSON.parse(P0); state.combatants = JSON.parse(K0);
      state.activeCombatantId = A0;
      closePanel('turnview'); closePanel('battlemap'); save();
    }

    // ── Disengage ─────────────────────────────────────────────────────────
    // The panel has detected opportunity attacks for as long as it could read
    // token positions, and has spent and logged the Disengage action for as
    // long as the economy bar existed. It never connected the two, so a
    // creature that disengaged was still attacked for walking away.
    {
      const T = panelDefs.turnview;
      const P0 = JSON.stringify(state.party), K0 = JSON.stringify(state.combatants);
      const A0 = state.activeCombatantId;
      state.party = [];
      state.combatants = [
        { id:'zzmover', name:'ZZ Mover', isPC:true,  hp:20, hpMax:20, ac:14 },
        { id:'zzogre',  name:'ZZ Ogre',  isPC:false, hp:59, hpMax:59, ac:11 },
      ];
      state.activeCombatantId = 'zzmover';
      save();
      // The battle map has to be mounted: the reconciler places tokens onto
      // the panel's live list when it is open, and onto stored map data when
      // it is not — and by this point in the run there is no stored map to
      // place onto, so nothing was created and every check answered null.
      openPanel('battlemap'); await sleep(400);
      openPanel('turnview'); await sleep(500);
      // Force the token reconciler. It skips when the roster signature looks
      // unchanged, which is right in the app and wrong here — this block swaps
      // the whole roster out between checks, and without tokens _provokedBy
      // has no geometry to reason about and answers null to everything.
      if (typeof sktEnsureCombatTokens === 'function') sktEnsureCombatTokens(true);
      await sleep(200);
      const cs = T._cs() || 50;
      // Re-read the tokens each time: _render() rebuilds them, so a reference
      // captured before an action describes a token that no longer exists.
      const provokes = () => {
        const mv = T._tokenFor(state.combatants[0]), og = T._tokenFor(state.combatants[1]);
        if (!mv || !og) return null;
        og.x = 0; og.y = 0; mv.x = cs; mv.y = 0;
        const from = { x: mv.x, y: mv.y };
        mv.x = cs * 4;
        state.combatants[1].reactionUsed = false;
        return T._provokedBy(state.combatants[0], from).length > 0;
      };
      const _dx = () => {
        const mv = T._tokenFor(state.combatants[0]), og = T._tokenFor(state.combatants[1]);
        return JSON.stringify({ mv: !!mv, og: !!og, cs, ftPerCell: T._ftPerCell && T._ftPerCell(),
          reach: T._reachOf(state.combatants[1]) });
      };
      ok('disengage: walking out of reach provokes normally', provokes() === true, _dx());
      T._takeStandardAction('Disengage');
      await sleep(200);
      ok('disengage: the action is still spent', state.combatants[0].actionUsed === true);
      ok('disengage: and now it suppresses the opportunity attack',
         provokes() === false);
      // It lasts until the end of THAT turn, not until the start of the next
      // one — a creature shoved during someone else’s turn provokes again.
      panelDefs.combat._endTurnEconomy("zzmover");
      ok('disengage: it ends when the turn does', provokes() === true);
      closePanel('turnview'); closePanel('battlemap');
      state.party = JSON.parse(P0); state.combatants = JSON.parse(K0);
      state.activeCombatantId = A0; save();
    }

    ok('sync: the in-game clock syncs', SKT_SYNC_KEYS.indexOf('skt-time-v1') >= 0);
    ok('sync: the weather syncs', SKT_SYNC_KEYS.indexOf('skt-weather-v2') >= 0);

    // ── Sharing an uploaded map ───────────────────────────────────────────
    // An upload used to set bgMapPath to null and keep the picture in memory,
    // so the players received "no map" and lost the one they had. It now goes
    // to its own Firebase node, referenced by a sktblob: path.
    openPanel('battlemap'); await sleep(500);
    {
      const bm = panelDefs.battlemap;
      const P0 = bm._bgMapPath, S0 = localStorage.getItem('skt-battlemap-v1');
      const putReal = window.sktMapBlobPut, getReal = window.sktMapBlobGet;
      // The real helpers answer false/null with no database handle, and the
      // suite refuses to run against a live one — so the sharing path can
      // only be exercised against a stand-in.
      const server = {}; let puts = 0;
      window.sktMapBlobPut = (id, data) => { puts++;
        Object.keys(server).forEach(k => delete server[k]);
        server[id] = data; return Promise.resolve(true); };
      window.sktMapBlobGet = id => Promise.resolve(server[id] || null);

      const c = document.createElement('canvas');
      c.width = 3200; c.height = 2400;
      const g = c.getContext('2d');
      g.fillStyle = '#3b5b3b'; g.fillRect(0, 0, 3200, 2400);
      g.fillStyle = '#c8b48a'; g.fillRect(400, 300, 2000, 1400);
      const img = new Image();
      await new Promise(r => { img.onload = r; img.src = c.toDataURL('image/png'); });

      const enc = bm._encodeForShare(img);
      ok('map upload: a large image re-encodes', !!enc);
      // 4,000,000 is the ceiling in firebase-rules.json. Over it, the write
      // is rejected by the database and the map silently never arrives.
      ok('map upload: the encoded image fits the rules limit',
         !!enc && enc.length < 4000000, enc && Math.round(enc.length / 1024) + 'KB');
      if (enc){
        const probe = new Image();
        await new Promise(r => { probe.onload = r; probe.src = enc; });
        ok('map upload: the long edge is capped',
           Math.max(probe.naturalWidth, probe.naturalHeight) <= 2560,
           probe.naturalWidth + 'x' + probe.naturalHeight);
      }

      await bm._shareUploadedMap(img);
      await sleep(200);
      ok('map upload: it is stored once', puts === 1, String(puts));
      ok('map upload: bgMapPath points at the stored copy',
         /^sktblob:/.test(bm._bgMapPath || ''), String(bm._bgMapPath));
      // Which is the whole point: this is the value that syncs.
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem('skt-battlemap-v1') || '{}'); } catch(e){}
      ok('map upload: the path reaches the synced key',
         saved.bgMapPath === bm._bgMapPath, String(saved.bgMapPath));

      // The receiving device has the path and nothing else.
      const path = bm._bgMapPath;
      bm._bgMapNaturalW = 0;
      bm._loadBgFromPath(path, true, true);
      await sleep(900);
      ok('map upload: another device loads it from the path alone',
         bm._bgMapNaturalW > 0, String(bm._bgMapNaturalW));

      // A second upload replaces the first rather than piling up.
      await bm._shareUploadedMap(img);
      await sleep(200);
      ok('map upload: only one image is kept on the server',
         Object.keys(server).length === 1, String(Object.keys(server).length));

      // An id that no longer exists must not wedge or blank the panel.
      const before = bm._bgMapNaturalW;
      bm._loadBgFromPath('sktblob:gone', true, true);
      await sleep(300);
      ok('map upload: a stale reference leaves the current map alone',
         bm._bgMapNaturalW === before, String(bm._bgMapNaturalW));

      window.sktMapBlobPut = putReal; window.sktMapBlobGet = getReal;
      bm._bgMapPath = P0;
      if (S0 != null) localStorage.setItem('skt-battlemap-v1', S0);
    }
    closePanel('battlemap');

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
      // ── A shared upload actually appearing on the map ─────────────────────
      // Sharing an uploaded map gave it a path for the first time:
      // "sktblob:<id>", a handle into Firebase. _applyBg had always treated a
      // path as an asset path, so it painted the stage with
      // <cdn>/sktblob%3A<id> — a URL that cannot exist — and threw away the
      // image it had already downloaded. The players saw nothing.
      //
      // The DM was the last to know, which is why this survived: _bgMapPath is
      // still null at the moment of upload, so the DM's own stage kept the
      // in-memory data URL and looked correct until the next reload.
      {
        const d = panelDefs.battlemap;
        const st = document.createElement('div');
        const path0 = d._bgMapPath, img0 = _mapBgImage;
        const DATA = 'data:image/webp;base64,AAAA';
        _mapBgImage = { naturalWidth: 100, naturalHeight: 100, src: DATA };

        d._bgMapPath = 'sktblob:u1abc';
        d._applyBg(st, 100, 100);
        ok('map: a shared upload paints the image, not a cdn path',
           st.style.backgroundImage.indexOf(DATA) !== -1, st.style.backgroundImage);

        // The other half of the same branch must not regress: a real asset
        // path still has to go through assetUrl.
        d._bgMapPath = 'adventure/x.webp';
        d._applyBg(st, 100, 100);
        ok('map: a real asset path still resolves through assetUrl',
           /adventure\/x\.webp/.test(st.style.backgroundImage)
           && st.style.backgroundImage.indexOf(DATA) === -1, st.style.backgroundImage);

        // "sktblob:u1abc" is not a filename either. Split on "/" it hands the
        // id back as the map's display name.
        d._bgMapPath = 'sktblob:u1abc';
        ok('map: a shared upload is named, not shown as its blob id',
           d._isSharedUpload(d._bgMapPath) === true
           && d._isSharedUpload('adventure/x.webp') === false);

        d._bgMapPath = path0; _mapBgImage = img0;
      }

      // End to end on the PLAYER's side of it: a bgMapPath arrives over sync,
      // the bytes are fetched out of Firebase, and the result has to reach the
      // stage. Every link is checked above on its own; this is the one that
      // proves they are joined up, and it is the link that was broken.
      {
        const d = panelDefs.battlemap;
        const DATA = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        const realGet = window.sktMapBlobGet;
        const path0 = d._bgMapPath, img0 = _mapBgImage, seq0 = d._bgLoadSeq;
        let askedFor = null;
        window.sktMapBlobGet = id => { askedFor = id; return Promise.resolve(DATA); };
        try {
          // Sync sets the path and THEN loads it (see _applyRemoteKey ->
          // bgMapPath). Loading without setting it left the old map's path in
          // place, so _applyBg answered about that map instead of this one.
          d._bgMapPath = 'sktblob:e2etest';
          d._loadBgFromPath('sktblob:e2etest', false);
          await sleep(500);
          ok('map: the player fetches the blob the path names', askedFor === 'e2etest', String(askedFor));
          ok('map: and the fetched image becomes the map background',
             !!_mapBgImage && String(_mapBgImage.src).indexOf('data:image/gif') === 0,
             _mapBgImage ? String(_mapBgImage.src).slice(0, 40) : 'no image');
          const st = document.createElement('div');
          d._applyBg(st, 100, 100);
          ok('map: which is what the stage ends up showing',
             st.style.backgroundImage.indexOf('data:image/gif') !== -1,
             st.style.backgroundImage.slice(0, 80));
        } finally {
          window.sktMapBlobGet = realGet;
          d._bgMapPath = path0; _mapBgImage = img0; d._bgLoadSeq = seq0;
        }
      }

      // ── Saved maps keep their uploaded background ─────────────────────────
      // The blob store used to be ONE slot per campaign — every upload set()
      // the parent node and replaced whatever was there. So save a map built on
      // an upload, upload anything else, and the saved map came back as tokens
      // and fog on an empty background.
      //
      // Driven through the REAL picker buttons, not the helpers: four bugs this
      // session were helpers that worked while nothing called them. Firebase is
      // replaced with an in-memory fake so the bookkeeping can be observed.
      {
        const d = panelDefs.battlemap;
        const saved0 = JSON.stringify(d._savedMaps || []);
        const path0 = d._bgMapPath, img0 = _mapBgImage;
        const real = { put: window.sktMapBlobPut, del: window.sktMapBlobDelete,
                       refs: window.sktMapBlobRefs, get: window.sktMapBlobGet,
                       modal: window.showModal, confirm: window.showConfirm,
                       enc: d._encodeForShare, toast: window.showToast };
        const blobs = {}, refs = {};
        let refsBroken = false;
        const toasts = [];
        window.sktMapBlobPut    = (id, data) => { blobs[id] = data; return Promise.resolve(true); };
        window.sktMapBlobDelete = id => { delete blobs[id]; return Promise.resolve(true); };
        window.sktMapBlobGet    = id => Promise.resolve(blobs[id] || null);
        window.sktMapBlobRefs   = fn => {
          if (refsBroken) return Promise.resolve(null);
          if (typeof fn === 'function') fn(refs);
          return Promise.resolve(JSON.parse(JSON.stringify(refs)));
        };
        window.showToast = m => { toasts.push(String(m)); };
        window.showConfirm = () => Promise.resolve(true);
        const DATA = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        d._encodeForShare = () => DATA;

        // A shared upload on screen, the way _shareUploadedMap leaves it.
        const share = async (replaced) => {
          await d._shareUploadedMap({ naturalWidth: 1, naturalHeight: 1 }, replaced);
          await sleep(60);
          return d._blobIdOf(d._bgMapPath);
        };
        const saveAs = async (name) => {
          window.showModal = () => Promise.resolve({ name });
          await d._openMapPicker();
          await sleep(120);
          const btn = document.querySelector('#mapsel-save');
          if (btn) btn.click();
          await sleep(200);
          document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
          return !!btn;
        };

        try {
          d._savedMaps = [];
          _mapBgImage = { naturalWidth: 1, naturalHeight: 1, src: DATA };

          // Throwaway uploads still clean up after themselves — otherwise
          // every upload of every session stays in the database for good.
          const a = await share(null);
          const b = await share('sktblob:' + a);
          ok('map: an unsaved upload is removed when replaced',
             !(a in blobs) && (b in blobs), JSON.stringify(Object.keys(blobs)));

          // THE FIX: save a map on an upload, then upload something else.
          const c = await share('sktblob:' + b);
          const clicked = await saveAs('ZZ Keep Me');
          ok('map: the save button was there to press', clicked);
          const entry = (d._savedMaps || []).find(m => m.name === 'ZZ Keep Me');
          ok('map: saving records which upload the map depends on',
             !!entry && refs[entry.id] === c, JSON.stringify(refs));
          const e2 = await share('sktblob:' + c);
          ok('map: a saved map keeps its upload when another is shared',
             (c in blobs) && (e2 in blobs), JSON.stringify(Object.keys(blobs)));

          // ...and loading it actually brings the background back.
          _mapBgImage = null;
          document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
          await d._openMapPicker();
          await sleep(120);
          const load = document.querySelector('[data-savedmap-load="' + (entry && entry.id) + '"]');
          if (load) load.click();
          await sleep(500);
          document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
          ok('map: loading the saved map restores its background',
             d._bgMapPath === 'sktblob:' + c && !!_mapBgImage
             && String(_mapBgImage.src).indexOf('data:image/gif') === 0,
             String(d._bgMapPath));

          // Deleting the saved map releases its upload — once it is no
          // longer the map on screen.
          await share(d._bgMapPath);        // move off it first
          await d._openMapPicker();
          await sleep(120);
          const del = document.querySelector('[data-savedmap-del="' + (entry && entry.id) + '"]');
          if (del) del.click();
          await sleep(250);
          document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
          ok('map: deleting a saved map releases its upload',
             !(c in blobs) && !(entry.id in refs), JSON.stringify({ blobs: Object.keys(blobs), refs }));

          // Another DM device's saved map protects an upload this device knows
          // nothing about. Saved maps are per device; the refs are not.
          const f1 = d._blobIdOf(d._bgMapPath);
          refs['map_other_device'] = f1;
          await share('sktblob:' + f1);
          ok('map: another device’s saved map protects its upload',
             f1 in blobs, JSON.stringify(Object.keys(blobs)));
          delete refs['map_other_device'];

          // When the refs cannot be read, nothing is deleted. Unknown is not
          // the same as unwanted.
          refsBroken = true;
          const g1 = d._blobIdOf(d._bgMapPath);
          await share('sktblob:' + g1);
          ok('map: with the refs unreadable, nothing is deleted',
             g1 in blobs, JSON.stringify(Object.keys(blobs)));
          refsBroken = false;

          // A saved map made BEFORE the refs existed — every saved map anyone
          // has today — is not in them until reconcile runs. In that window
          // the device's own library is the only thing standing between the
          // upload and deletion, so it has to count on its own.
          {
            const h1 = d._blobIdOf(d._bgMapPath);
            const keep = JSON.stringify(d._savedMaps);
            d._savedMaps = [{ id: 'map_pre_refs', name: 'Old', ts: 1,
                              snapshot: { bgMapPath: 'sktblob:' + h1 } }];
            delete refs['map_pre_refs'];
            await share('sktblob:' + h1);
            ok('map: a saved map not yet in the refs still protects its upload',
               h1 in blobs, JSON.stringify(Object.keys(blobs)));
            d._savedMaps = JSON.parse(keep);
          }

          // Reconcile re-asserts this device's saved maps and never removes
          // an entry it does not recognise.
          refs['map_foreign'] = 'zzforeign';
          d._savedMaps = [{ id: 'map_local', name: 'L', ts: 1, snapshot: { bgMapPath: 'sktblob:zzlocal' } }];
          d._reconcileSavedRefs();
          await sleep(30);
          ok('map: reconcile adds this device’s saved maps to the refs',
             refs['map_local'] === 'zzlocal', JSON.stringify(refs));
          ok('map: and leaves other devices’ entries alone',
             refs['map_foreign'] === 'zzforeign', JSON.stringify(refs));

          // An upload whose share failed has no path. Saving it cannot keep
          // the background, and the DM is told while they can still fix it.
          d._savedMaps = [];
          d._bgMapPath = null;
          _mapBgImage = { naturalWidth: 1, naturalHeight: 1, src: DATA };
          toasts.length = 0;
          await saveAs('ZZ No Art');
          ok('map: saving an unshared upload warns that the background is lost',
             toasts.some(t => /never shared/.test(t)), toasts.join(' | '));
        } finally {
          window.sktMapBlobPut = real.put; window.sktMapBlobDelete = real.del;
          window.sktMapBlobRefs = real.refs; window.sktMapBlobGet = real.get;
          window.showModal = real.modal; window.showConfirm = real.confirm;
          window.showToast = real.toast; d._encodeForShare = real.enc;
          d._savedMaps = JSON.parse(saved0); d._saveSavedMaps();
          d._bgMapPath = path0; _mapBgImage = img0; d._saveMap();
          document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
        }
      }

      // ── Download budget: one fetch per upload per device ──────────────────
      // Map updates arrive on every token nudge and fog tick, and until the
      // image has loaded applyMapState asks for it again on each one. A share
      // plus eight token moves during a two-second phone download fetched the
      // same ~1.2 MB map NINE times. Against a 10 GB/month free allowance
      // that is the difference between a table that fits and one that doesn't.
      {
        const d = panelDefs.battlemap;
        const real = window.sktMapBlobGet, realToast = window.showToast;
        const path0 = d._bgMapPath, img0 = _mapBgImage, w0 = d._bgMapNaturalW;
        const DATA = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        const base = JSON.parse(localStorage.getItem('skt-battlemap-v1') || '{}');
        const reset = () => { d._blobCache.clear(); d._blobInflight.clear(); d._bgFailedUrl = null;
                              _mapBgImage = null; d._bgMapNaturalW = 0; };
        const toasts = [];
        window.showToast = m => toasts.push(String(m));
        try {
          // A slow download with the DM moving tokens throughout.
          reset();
          let n = 0;
          window.sktMapBlobGet = () => { n++; return new Promise(r => setTimeout(() => r(DATA), 700)); };
          d.applyMapState({ ...base, bgMapPath: 'sktblob:uslow' }, { source: 'firebase' });
          for (let i = 0; i < 6; i++){
            await sleep(80);
            d.applyMapState({ ...base, bgMapPath: 'sktblob:uslow' }, { source: 'firebase' });
          }
          await sleep(900);
          ok('map: token moves during a download do not download the map again',
             n === 1, n + ' downloads');
          ok('map: and the map still arrives', !!d._bgMapNaturalW);

          // A blob that is gone: found once, said once.
          reset(); n = 0; toasts.length = 0;
          window.sktMapBlobGet = () => { n++; return Promise.resolve(null); };
          d.applyMapState({ ...base, bgMapPath: 'sktblob:ugone' }, { source: 'firebase' });
          for (let i = 0; i < 8; i++){
            await sleep(30);
            d.applyMapState({ ...base, bgMapPath: 'sktblob:ugone' }, { source: 'firebase' });
          }
          await sleep(150);
          const said = toasts.filter(t => /no longer on the server/.test(t)).length;
          ok('map: a missing upload is looked for once, not on every update',
             n === 1, n + ' fetches');
          ok('map: and the player is told once, not on every update', said === 1, said + ' toasts');

          // A network error is NOT remembered as "gone" — otherwise a dropped
          // connection would hide a map that is fine until the page reloads.
          reset(); n = 0;
          window.sktMapBlobGet = () => { n++; return n === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(DATA); };
          d._loadBgFromPath('sktblob:uflaky', false, false);
          await sleep(150);
          d._loadBgFromPath('sktblob:uflaky', false, false);
          await sleep(300);
          ok('map: a failed download is retried, not cached as missing',
             n === 2 && !!d._bgMapNaturalW, n + ' fetches, loaded=' + !!d._bgMapNaturalW);

          // The DM already has the bytes of their own upload.
          reset(); n = 0;
          window.sktMapBlobGet = () => { n++; return Promise.resolve(DATA); };
          const enc0 = d._encodeForShare, put0 = window.sktMapBlobPut, refs0 = window.sktMapBlobRefs;
          d._encodeForShare = () => DATA;
          window.sktMapBlobPut = () => Promise.resolve(true);
          window.sktMapBlobRefs = () => Promise.resolve(null);
          try {
            await d._shareUploadedMap({ naturalWidth: 1, naturalHeight: 1 }, null);
            _mapBgImage = null; d._bgMapNaturalW = 0;
            d._loadBgFromPath(d._bgMapPath, false, false);
            await sleep(300);
          } finally { d._encodeForShare = enc0; window.sktMapBlobPut = put0; window.sktMapBlobRefs = refs0; }
          ok('map: the DM does not download their own upload back',
             n === 0 && !!d._bgMapNaturalW, n + ' downloads');
        } finally {
          window.sktMapBlobGet = real; window.showToast = realToast;
          d._blobCache.clear(); d._blobInflight.clear(); d._bgFailedUrl = null;
          d._bgMapPath = path0; _mapBgImage = img0; d._bgMapNaturalW = w0; d._saveMap();
        }
      }

      // That "retried, not cached" check depends on sktMapBlobGet REJECTING on
      // a read error. It used to resolve null for both, which only stopped
      // mattering once nothing remembered the answer. Needs a live database to
      // exercise, so the line is read from source.
      {
        let src = '';
        try { src = await (await fetch('js/sync/realtime.js', { cache: 'no-store' })).text(); } catch(e){}
        const get = (src.match(/window\.sktMapBlobGet = function[\s\S]*?\n\};/) || [''])[0];
        ok('map: a blob read error rejects rather than answering "gone"',
           /_diag\('map blob get', err\); throw err;/.test(get), get.slice(-160));
      }

      // The write itself cannot run here — it needs a live database — so the
      // one line that decides whether uploads overwrite each other is read
      // from source. set() on the PARENT replaces every sibling; that single
      // call was the whole bug.
      {
        let src = '';
        try { src = await (await fetch('js/sync/realtime.js', { cache: 'no-store' })).text(); } catch(e){}
        const put = (src.match(/window\.sktMapBlobPut = function[\s\S]*?\n\};/) || [''])[0];
        ok('map: an upload writes its own node, not over its siblings',
           /_blobBase\(\) \+ '\/' \+ id\)\.set\(/.test(put) && !/_blobBase\(\)\)\.set\(/.test(put),
           put.slice(0, 160));
      }

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

    // ── The dock says what each icon is ───────────────────────────────────
    {
      const btns = [...document.querySelectorAll('.panel-dock .dock-btn[data-panel]')];
      ok('dock: every panel button carries its name',
         btns.length >= 17 && btns.every(b => b.dataset.label && b.querySelector('.dock-label')),
         btns.filter(b => !b.dataset.label).map(b => b.dataset.panel).join(','));
      ok('dock: no native tooltip to double up on the instant label',
         btns.every(b => !b.hasAttribute('title') && b.getAttribute('aria-label')));
      ok('dock: grouped under four headings',
         document.querySelectorAll('.panel-dock .dock-divider[data-group]').length === 4);
      const dock = document.querySelector('.panel-dock');
      const exp = document.getElementById('dock-expand-btn');
      const w0 = dock.getBoundingClientRect().width;
      const k0 = localStorage.getItem('skt-dock-names-v1');
      try {
        exp.click(); await sleep(150);
        const lab = document.querySelector('.dock-btn[data-panel="loot"] .dock-label');
        ok('dock: "show names" widens it and shows every name',
           document.body.classList.contains('dock-expanded') && dock.getBoundingClientRect().width > 150
           && getComputedStyle(lab).display !== 'none' && lab.getBoundingClientRect().width > 20,
           Math.round(dock.getBoundingClientRect().width) + 'px');
        ok('dock: and remembers it', localStorage.getItem('skt-dock-names-v1') === '1');
        exp.click(); await sleep(150);
        ok('dock: "hide names" puts it back', !document.body.classList.contains('dock-expanded')
           && Math.abs(dock.getBoundingClientRect().width - w0) < 2);
      } finally {
        document.body.classList.remove('dock-expanded');
        if (k0 == null) localStorage.removeItem('skt-dock-names-v1'); else localStorage.setItem('skt-dock-names-v1', k0);
      }
    }

    // ── Compact combat: two short rows a creature ─────────────────────────
    openPanel('combat'); await sleep(300);
    {
      const c0 = !!state.settings.combatCompact;
      try {
        state.settings.combatCompact = true; panelDefs.combat._render(); await sleep(100);
        const cards = [...document.querySelectorAll('#combat-list .combatant-card')];
        const plain = cards.filter(c => !c.querySelector('.conditions, .death-saves, .legendary-row'));
        const hs = plain.map(c => Math.round(c.getBoundingClientRect().height));
        ok('combat: a compact card is two short rows', hs.length > 0 && hs.every(h => h <= 60), JSON.stringify(hs));
        const clash = cards.filter(c => c.querySelector('.card-stats').getBoundingClientRect().right
                                        > c.querySelector('.card-actions').getBoundingClientRect().left + 1);
        ok('combat: the compact stats never run into ✕', clash.length === 0, clash.length + ' card(s)');
      } finally { state.settings.combatCompact = c0; panelDefs.combat._render(); }
    }

    // ── Compact party: a title-bar toggle, and rows that fit ──────────────
    openPanel('party'); await sleep(300);
    {
      const p0 = !!state.settings.partyCompact;
      const tog = document.querySelector('.window[data-panel="party"] [data-party-compact]');
      ok('party: compact has a button in the title bar', !!tog);
      try {
        if (tog){
          if (state.settings.partyCompact) { tog.click(); await sleep(100); }
          tog.click(); await sleep(150);
          ok('party: the button turns compact on', !!state.settings.partyCompact && tog.getAttribute('aria-pressed') === 'true');
          const cards = [...panelDefs.party._body.querySelectorAll('.party-grid.compact .char-card')];
          const wide = cards.filter(c => c.scrollWidth > c.clientWidth + 1);
          ok('party: no compact row is cut off at the right', cards.length > 0 && wide.length === 0,
             wide.map(c => c.scrollWidth + '>' + c.clientWidth).join(' '));
          // And short: rows that wrap to three lines are not a glance. With
          // AC / Init / Spd at the browser's default input width they did.
          const hs = cards.map(c => Math.round(c.getBoundingClientRect().height));
          ok('party: a compact row is at most two short lines', hs.every(h => h <= 72), JSON.stringify(hs));
          // Each number beside its label. An input left at width:auto is the
          // browser's ~20-character default, which parked AC's '17' 140px away
          // from the word AC.
          const iw = [...panelDefs.party._body.querySelectorAll('.party-grid.compact .char-stat input')].map(i => Math.round(i.getBoundingClientRect().width));
          ok('party: compact AC / Init / Spd sit beside their labels', iw.length > 0 && iw.every(w => w <= 48), JSON.stringify(iw.slice(0, 3)));
          const b = panelDefs.party._body;
          ok('party: nothing scrolls sideways', b.scrollWidth <= b.clientWidth + 1, b.scrollWidth + '>' + b.clientWidth);
        }
      } finally { state.settings.partyCompact = p0; panelDefs.party._render(); }
    }

    // ── Loot: one line per item, whole name visible ───────────────────────
    openPanel('loot'); await sleep(400);
    {
      const rows = [...panelDefs.loot._body.querySelectorAll('.loot-item')];
      const tall = rows.filter(r => r.getBoundingClientRect().height > 48);
      ok('loot: every item sits on one line', rows.length > 0 && tall.length === 0,
         tall.map(r => Math.round(r.getBoundingClientRect().height)).join(','));
      const cut = rows.map(r => r.querySelector('.loot-name-input')).filter(i => i.scrollWidth > i.clientWidth + 1);
      ok('loot: item names are not cut off', cut.length === 0, cut.map(i => i.value).join(', '));
    }
    closePanel('loot');

    // ── Map: names never run into each other; drops never stack ───────────
    openPanel('battlemap'); await sleep(900);
    {
      const bm = panelDefs.battlemap, b = bm._body;
      const lab = () => [...b.querySelectorAll('.map-token-name')].filter(e => getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none')
                          .map(e => e.getBoundingClientRect());
      const overlaps = rs => { let n = 0; rs.forEach((a, i) => rs.forEach((c, j) => { if (i < j && a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) n++; })); return n; };
      ok('map: no two token names overlap', overlaps(lab()) === 0, overlaps(lab()) + ' overlap(s) at ' + (bm._viewScale || 1).toFixed(2) + 'x');
      const tight = b.querySelector('.map-token-name.tight');
      if (tight){
        const tok = b.querySelector('.map-token[data-tid="' + tight.dataset.tid + '"]');
        tok.dispatchEvent(new MouseEvent('mouseenter'));
        ok('map: a hidden name shows in full on hover', getComputedStyle(tight).visibility === 'visible' && tight.scrollWidth <= tight.clientWidth + 1);
        tok.dispatchEvent(new MouseEvent('mouseleave'));
      }
      const occ = (bm._tokens || [])[0];
      const onMap = new Set((bm._tokens || []).filter(t => t.isPC).map(t => t.label));
      const pi = state.party.findIndex(p => !onMap.has(p.name));
      if (occ && pi >= 0){
        const r = b.querySelector('.map-token[data-tid="' + occ.id + '"]').getBoundingClientRect();
        const dt = new DataTransfer(); dt.setData('application/x-skt-party-pi', String(pi));
        const n0 = bm._tokens.length;
        b.querySelector('#map-scroll').dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:dt,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
        await sleep(200);
        const nt = bm._tokens[bm._tokens.length - 1], half = bm._csScreen() / 2;
        ok('map: a token dropped on an occupied square moves to a free one',
           bm._tokens.length === n0 + 1 && (Math.abs(nt.x - occ.x) >= half || Math.abs(nt.y - occ.y) >= half),
           nt ? [nt.x, nt.y, occ.x, occ.y].map(Math.round).join(',') : 'no token');
      }
    }
    closePanel('battlemap');

    // ── Ctrl+K ────────────────────────────────────────────────────────────
    {
      const type = v => { const i = document.getElementById('cp-input'); i.value = v; i.dispatchEvent(new Event('input')); };
      const key = (k, o) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key:k, bubbles:true, cancelable:true }, o || {})));
      const labels = () => [...document.querySelectorAll('#cp-list .cp-item .cp-label')].map(e => e.textContent);
      try {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'k', ctrlKey:true, bubbles:true, cancelable:true }));
        await sleep(80);
        ok('palette: Ctrl+K opens it, ready to type',
           !!document.getElementById('cp-backdrop') && document.activeElement.id === 'cp-input');
        const heads = [...document.querySelectorAll('#cp-list .cp-group')].map(e => e.textContent);
        ok('palette: each heading appears once', heads.length === new Set(heads).size, heads.join(','));
        type('ra'); await sleep(30);
        ok('palette: matches the start of a word, not the middle',
           !labels().some(l => /tracker/i.test(l) && !/\bra/i.test(l)), labels().slice(0, 6).join(', '));
        const ws0 = typeof _wsState !== 'undefined' && _wsState ? _wsState.active : null;
        key('2'); await sleep(60);
        ok('palette: typing a digit does not switch workspace', !ws0 || _wsState.active === ws0);
        type('loot'); await sleep(30);
        const was = !!(layout.loot && layout.loot.open);
        key('Enter'); await sleep(400);
        ok('palette: Enter runs the top match (opens Loot)',
           !was && !!(layout.loot && layout.loot.open) && !document.getElementById('cp-backdrop'));
        closePanel('loot');
        const a0 = state.activeCombatantId;
        openCommandPalette(); type('next turn'); await sleep(30); key('Enter'); await sleep(300);
        ok('palette: "Next turn" advances the fight', (state.combatants || []).length < 2 || state.activeCombatantId !== a0);
        state.activeCombatantId = a0;
        openCommandPalette(); key('Escape'); await sleep(40);
        ok('palette: Escape closes it', !document.getElementById('cp-backdrop'));
        openCommandPalette(); type('goblin'); await sleep(30);
        // One row per name AND kind: Goblin the monster, the race and the
        // language are three answers; the same monster in six books is one.
        const rows = [...document.querySelectorAll('#cp-list .cp-item')].map(e =>
          e.querySelector('.cp-label').textContent + '|' + ((e.querySelector('.cp-hint') || {}).textContent || '').split(' · ')[0]);
        const gm = rows.filter(r => r === 'Goblin|monster').length;
        ok('palette: a rules entry in six books is one row', !_5eLoaded || (gm === 1 && rows.length === new Set(rows).size), JSON.stringify(rows));
        // Torn down from outside, the way a wholesale overlay cleanup does
        // it. The palette's key listener is on document in the CAPTURE
        // phase and stops propagation on everything, so leaving it behind
        // kills every keyboard shortcut in the app for the rest of the
        // session — which is exactly what it did to Ctrl+Z.
        openCommandPalette(); await sleep(40);
        document.getElementById('cp-backdrop').remove();
        let heard = 0; const ear = () => { heard++; };
        document.addEventListener('keydown', ear);
        // A key nothing acts on, so the probe can't change the campaign.
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true }));
        await sleep(20);
        document.removeEventListener('keydown', ear);
        ok('palette: ripped out from under, it stops eating the keyboard', heard === 1, heard);
      } catch(e){
        ok('palette: the checks ran to completion', false, e.message);
      } finally { document.getElementById('cp-backdrop')?.remove(); }
    }

    // ── Sync: nothing gets trapped on one screen ──────────────────────────
    // Run against a stand-in for Firebase that records what would be sent,
    // so the real flush / apply / merge code is exercised end to end without
    // a network. Everything it touches is put back in the finally.
    {
      const K = 'skt-battlemap-v1', spec = _ENTITY_KEYS[K];
      const pushes = [], reads = [], removed = [], handlers = {};
      const mkRef = path => ({
        update(u){ pushes.push(u); return Promise.resolve(); },
        set(){ return Promise.resolve(); },
        remove(){ removed.push(path); return Promise.resolve(); },
        once(){ reads.push(path); return Promise.resolve({ exists: () => false, val: () => null }); },
        on(ev, cb){ handlers[path] = cb; return cb; },
        off(){},
        onDisconnect(){ return { remove(){ return Promise.resolve(); } }; },
      });
      const toTree = str => { const n = spec.explode(str), t = {};
        Object.keys(n).forEach(p => { const [a, c] = p.split('/'); if (c){ (t[a] = t[a] || {})[c] = n[p]; } else t[a] = n[p]; }); return t; };
      const origSet = Storage.prototype.setItem;
      const cache0 = JSON.stringify(_entityCache);
      try {
        _fbDb = { ref: mkRef, goOffline(){}, goOnline(){} };
        _patchLocalStorage();
        closePanel('battlemap'); openPanel('battlemap'); await sleep(900);
        const bm = panelDefs.battlemap, b = bm._body;
        _entityCache[K] = spec.explode(localStorage.getItem(K));

        // A stroke in progress when another device's update lands.
        bm._tool = 'draw';
        const dc = b.querySelector('#draw-canvas'); dc.style.pointerEvents = 'auto';
        const r = dc.getBoundingClientRect();
        const at = (x, y) => ({ clientX: r.left + r.width * x, clientY: r.top + r.height * y, bubbles: true, button: 0 });
        dc.dispatchEvent(new MouseEvent('mousedown', at(.3, .3)));
        for (let i = 1; i <= 6; i++){ document.dispatchEvent(new MouseEvent('mousemove', at(.3 + i * .03, .3 + i * .02))); await sleep(15); }
        const srv = JSON.parse(localStorage.getItem(K));
        const tok = srv.tokens[0], tx0 = tok.x; tok.x = tx0 + 50;
        const theirs = { c: '#00ff00', s: 4, p: [10, 10, 40, 40] };
        srv.drawings = [...(srv.drawings || []), theirs];
        _applyEntitySnapshot(K, toTree(JSON.stringify(srv)));
        ok('sync: an update mid-stroke waits instead of replacing the stroke', K in _heldSnaps);
        document.dispatchEvent(new MouseEvent('mouseup', at(.5, .5)));
        await sleep(150);
        const after = JSON.parse(localStorage.getItem(K));
        ok('sync: after the stroke, both strokes and their token move are on screen',
           after.drawings.some(d => d.c === '#00ff00') && after.drawings.some(d => d.c !== '#00ff00' && d.p && d.p.length >= 10)
           && after.tokens.find(t => t.id === tok.id).x === tx0 + 50, JSON.stringify(after.drawings.map(d => d.c)));
        await sleep(450);
        const dk = u => Object.keys(u).find(p => /drawings$/.test(p));
        const sent = (pushes.filter(dk).map(u => JSON.parse(u[dk(u)])).pop()) || [];
        ok('sync: and both are sent on, neither erasing the other',
           sent.some(d => d.c === '#00ff00') && sent.some(d => d.c !== '#00ff00' && d.p && d.p.length >= 10), sent.length + ' sent');

        // Erasing is a gesture too: an update mid-erase would bring back what
        // was just rubbed out.
        bm._tool = 'erase';
        dc.dispatchEvent(new MouseEvent('mousedown', at(.7, .7)));
        ok('sync: updates wait while erasing', spec.holdOff() === true);
        document.dispatchEvent(new MouseEvent('mouseup', at(.7, .7)));
        ok('sync: and flow again once the eraser lifts', spec.holdOff() === false);
        bm._tool = null;

        // A monster dragged in the Turn View while another device's move lands.
        // The update used to replace the map's token array mid-drag, the move
        // went onto an orphaned copy, and the DM's move was lost.
        try {
          openPanel('turnview'); await sleep(600);
          const T = panelDefs.turnview; T._render(); await sleep(200);
          const mon = bm._tokens.find(t => !t.isPC && t.label && T._body.querySelector('.tv-tok[data-tvlabel="' + t.label + '"]'));
          const pc  = bm._tokens.find(t => t.isPC);
          if (mon && pc){
            _entityCache[K] = spec.explode(localStorage.getItem(K));
            const mx0 = mon.x, px1 = pc.x + 70;
            const el = T._body.querySelector('.tv-tok[data-tvlabel="' + mon.label + '"]');
            const rr = el.getBoundingClientRect(), cx = rr.left + rr.width / 2, cy = rr.top + rr.height / 2;
            const pe = (ty, x, y) => new PointerEvent(ty, { clientX: x, clientY: y, bubbles: true, pointerId: 9, button: 0, isPrimary: true });
            el.dispatchEvent(pe('pointerdown', cx, cy));
            for (let i = 1; i <= 6; i++){
              T._body.dispatchEvent(pe('pointermove', cx + i * 8, cy)); await sleep(20);
              if (i === 3){ const sv = JSON.parse(localStorage.getItem(K)); sv.tokens.find(t => t.id === pc.id).x = px1;
                            _applyEntitySnapshot(K, toTree(JSON.stringify(sv))); }
            }
            T._body.dispatchEvent(pe('pointerup', cx + 48, cy)); await sleep(200);
            const fin = JSON.parse(localStorage.getItem(K)).tokens;
            ok('sync: a monster moved in the Turn View keeps its move when another update lands mid-drag',
               fin.find(t => t.id === mon.id).x !== mx0, Math.round(fin.find(t => t.id === mon.id).x) + ' vs ' + Math.round(mx0));
            ok('sync: and the other device move is kept too', fin.find(t => t.id === pc.id).x === px1);
          }
        } finally { closePanel('turnview'); }

        // A second window of this browser already stored the new value.
        {
          const CK = 'skt-combat-v1', cs = _ENTITY_KEYS[CK];
          _entityCache[CK] = cs.explode(localStorage.getItem(CK));
          const d = JSON.parse(localStorage.getItem(CK));
          const c = d.combatants.find(x => x.isPC);
          if (c){
            const want = (c.hp || 0) - 7; c.hp = want;
            const v = JSON.stringify(d);
            _remoteUpdate = true; try { localStorage.setItem(CK, v); } finally { _remoteUpdate = false; }
            const t = {}; const n = cs.explode(v);
            Object.keys(n).forEach(p => { const [a, x] = p.split('/'); if (x){ (t[a] = t[a] || {})[x] = n[p]; } else t[a] = n[p]; });
            _applyEntitySnapshot(CK, t);
            const now = (state.combatants.find(x => x.id === c.id) || {}).hp;
            ok('sync: a second window on this computer redraws what the first one changed', now === want, now + ' shown, ' + want + ' stored');
          }
        }

        // Coming back to the tab re-reads the campaign's data, not the root.
        _startRealtimeExtras();
        reads.length = 0;
        window.dispatchEvent(new Event('focus')); await sleep(50);
        const eb = _baseOf(spec);
        ok('sync: returning to the tab re-reads the map from this campaign',
           reads.includes(eb), JSON.stringify(reads.filter(p => /battlemap/.test(p))));

        // Live strokes and drags whose sender vanished.
        const liveP = Object.keys(handlers).find(p => /skt_battlemap_live_v1$/.test(p));
        const tokP  = Object.keys(handlers).find(p => /skt_battlemap_tokmove_v1$/.test(p));
        ok('sync: the map listens on the live channels', !!liveP && !!tokP);
        if (liveP && tokP){
          let painted = 0, cleared = 0;
          const ap = bm._applyPreviewStroke, cp = bm._clearPreviewStroke;
          bm._applyPreviewStroke = function(x){ painted++; return ap.call(this, x); };
          bm._clearPreviewStroke = function(){ cleared++; return cp.call(this); };
          handlers[liveP]({ val: () => ({ stroke: { c: '#f00', s: 4, p: [1, 1, 9, 9] }, ts: realtimeLive.serverNow() - 60000 }) });
          ok('sync: a stroke left behind by a vanished drawer is not painted', painted === 0 && cleared === 1);
          ok('sync: and is removed for everyone', removed.some(p => /skt_battlemap_live_v1$/.test(p)));
          let rer = 0; const rt = bm._renderTokens;
          bm._renderTokens = function(){ rer++; return rt.call(this); };
          const t0 = bm._tokens[0];
          handlers[tokP]({ val: () => ({ id: t0.id, x: t0.x + 80, y: t0.y, ts: realtimeLive.serverNow() }) });
          handlers[tokP]({ val: () => null });
          ok('sync: a normal drag end does not snap the token back early', rer === 0);
          handlers[liveP]({ val: () => ({ stroke: { c: '#f00', s: 4, p: [1, 1, 9, 9] }, ts: realtimeLive.serverNow() }) });
          handlers[tokP]({ val: () => ({ id: t0.id, x: t0.x + 80, y: t0.y, ts: realtimeLive.serverNow() }) });
          const c0 = cleared;
          await sleep(realtimeLive.LIVE_STALE_MS + 400);
          const el = b.querySelector('.map-token[data-tid="' + t0.id + '"]');
          ok('sync: a live stroke that goes silent is cleared', cleared > c0);
          ok('sync: a token left mid-drag goes back to where it really is',
             rer > 0 && Math.round(parseFloat(el.style.left)) === Math.round(t0.x));
          bm._applyPreviewStroke = ap; bm._clearPreviewStroke = cp; bm._renderTokens = rt;
        }
      } catch(e){
        ok('sync: the checks ran to completion', false, e.message);
      } finally {
        Storage.prototype.setItem = origSet;
        _fbDb = null; _dirtyKeys.clear(); clearTimeout(_pushTimer);
        Object.keys(_heldSnaps).forEach(k => delete _heldSnaps[k]);
        Object.keys(_entityCache).forEach(k => delete _entityCache[k]);
        Object.assign(_entityCache, JSON.parse(cache0));
        closePanel('battlemap');
      }
    }

    // ── Legendary resistance, lair actions, timed conditions, end-of-turn saves
    {
      _remoteUpdate = true;
      try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
      finally { _remoteUpdate = false; }
      loadDomain('combat'); loadDomain('party');
      const C = panelDefs.combat;
      openPanel('combat'); await sleep(300);
      try {
        const m = _5eLoaded && _5eData.find(d => d.cat === 'monster' && d.name === 'Adult Red Dragon');
        ok('combat: a dragon to test with', !!m);
        if (m){
          C.addMonster(m); await sleep(80);
          const did = state.combatants.find(c => c.baseName === 'Adult Red Dragon').id;
          const D = () => state.combatants.find(c => c.id === did);
          ok('combat: legendary resistance is read off the stat block (3/day)', D().lrMax === 3 && D().lrUsed === 0);
          ok('combat: a creature with lair actions is marked as having them, switched off', D().lairCapable === true && !D().lair);
          ok('combat: a monster save comes from its stat block', C.saveBonus(D(), 'wis') === 7 && C.saveBonus(D(), 'dex') === 6,
             C.saveBonus(D(), 'wis') + '/' + C.saveBonus(D(), 'dex'));
          C._render(); await sleep(40);
          ok('combat: resistance shows as pips', C._body.querySelectorAll('[data-act="lr-pip"]').length === 3);
          C._body.querySelector('[data-act="lr-pip"]').click(); await sleep(40);
          ok('combat: and a click spends one', D().lrUsed === 1);
          D().lair = true;
          state.combatants.forEach((c, i) => { c.initiative = [22, 21, 18, 15, 12, 10, 8, 5, 3][i] ?? 1; });
          state.activeCombatantId = state.combatants[0].id; state.combatRound = 1; C._lairDue = null; save();
          C._nextTurn();
          ok('combat: no lair action while initiative is still above 20', !C._lairDue);
          C._nextTurn();
          ok('combat: the lair acts as the order passes initiative 20', !!C._lairDue && C._lairDue.names.includes(D().name)
             && !!C._body.querySelector('.lair-banner'));
          const pc = state.combatants.find(c => c.isPC);
          C._setCondTimer(state.combatants.indexOf(pc), 'Stunned', { kind: 'end-next' }); save();
          let g = 0; while (state.activeCombatantId !== pc.id && g++ < 20) C._nextTurn();
          ok('combat: until the end of its next turn — still on during that turn',
             (state.combatants.find(c => c.id === pc.id).conditions || []).includes('Stunned'));
          C._nextTurn();
          ok('combat: and gone once that turn ends', !(state.combatants.find(c => c.id === pc.id).conditions || []).includes('Stunned'));
          C._setCondTimer(state.combatants.findIndex(c => c.id === did), 'Paralyzed', { save: { ab: 'wis', dc: 15 } }); save();
          g = 0; while (state.activeCombatantId !== did && g++ < 20) C._nextTurn();
          C._nextTurn(); await sleep(40);
          const card = document.querySelector('#cond-save-stack .cond-save');
          ok('combat: a repeat save is asked for at the end of its turn, with its bonus',
             !!card && /WIS save DC 15/.test(card.textContent) && card.textContent.indexOf("(+7)") >= 0);
          card && card.querySelector('[data-csp="pass"]').click(); await sleep(40);
          ok('combat: saving ends the condition', !(D().conditions || []).includes('Paralyzed') && !document.querySelector('#cond-save-stack .cond-save'));
          C._setCondTimer(state.combatants.findIndex(c => c.id === did), 'Frightened', { kind: 'rounds', left: 2 }); save();
          const turn = () => { let k = 0; while (state.activeCombatantId !== did && k++ < 20) C._nextTurn(); C._nextTurn(); };
          turn(); const after1 = (D().conditions || []).includes('Frightened');
          turn(); const after2 = (D().conditions || []).includes('Frightened');
          ok('combat: a 2-round condition lasts two of its turns', after1 && !after2);
          C._reduceMaxHpAt(state.combatants.findIndex(c => c.id === did), 20, 'Harm'); await sleep(40);
          ok('combat: a monster max HP can be reduced from its card', D().hpMax === D().hpMaxNormal - 20 && !!C._body.querySelector('.hp-maxloss-badge'));
          C._setCondTimer(state.combatants.findIndex(c => c.id === did), 'Prone', { kind: 'end-next' });
          C._toggleCondAtIdx(state.combatants.findIndex(c => c.id === did), 'Prone');
          C._toggleCondAtIdx(state.combatants.findIndex(c => c.id === did), 'Prone');
          ok('combat: a condition toggled back on starts without its old timer', !(D().condTimers && D().condTimers.Prone));
        }
      } catch(e){ ok('combat: the new-feature checks ran to completion', false, e.message); }
      finally {
        C._condSaves = []; C._renderCondSaves && C._renderCondSaves(); C._lairDue = null;
        _remoteUpdate = true;
        try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
        finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party'); C._render();
      }
    }
    // ── Area saves: several creatures, one damage roll ────────────────────
    {
      _remoteUpdate = true;
      try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
      finally { _remoteUpdate = false; }
      loadDomain('combat'); loadDomain('party');
      const C = panelDefs.combat; openPanel('combat'); await sleep(250);
      try {
        // Monsters: no temp HP or Wild Shape pool to soak the damage, so what
        // they lose is exactly what was applied.
        const alive = state.combatants.filter(c => !c.isPC && !c.dead && (c.hp || 0) > 0);
        ok('area save: two monsters to test with', alive.length >= 2);
        const hp0 = {}; state.combatants.forEach(c => hp0[c.id] = c.hp);
        C.openAreaSave({ name: 'Test blast', ab: 'DEX', dc: 99, parts: [{ dice: '4d6', type: '' }], half: true, targets: alive.map(c => c.id) });
        const g = document.getElementById('area-save-back');
        ok('area save: the dialog opens with the given targets ticked', !!g && g.querySelectorAll('#as-targets input:checked').length === alive.length);
        g.querySelector('[data-as="roll"]').click(); await sleep(30);
        ok('area save: each target rolls its own save', g.querySelectorAll('.as-table tr').length === alive.length);
        const dmg = +g.querySelector('.as-dmg b').textContent;
        ok('area save: the damage is rolled once, for everyone', dmg >= 4 && dmg <= 24);
        g.querySelector('[data-as="flip"][data-k="0"]').click(); await sleep(20);
        g.querySelector('[data-as="apply"]').click(); await sleep(120);
        const first = alive[0], rest = alive.slice(1);
        const now = id => (state.combatants.find(c => c.id === id) || {}).hp;
        const lost = id => hp0[id] - now(id);
        ok('area save: a failed save takes the full roll', rest.every(c => lost(c.id) === dmg || now(c.id) === 0),
           JSON.stringify(rest.map(c => lost(c.id))) + ' vs ' + dmg);
        ok('area save: a flipped success takes half', lost(first.id) === Math.floor(dmg / 2) || now(first.id) === 0,
           lost(first.id) + ' vs ' + Math.floor(dmg / 2));
        ok('area save: and the dialog closes', !document.getElementById('area-save-back'));
        const m = _5eLoaded && _5eData.find(d => d.cat === 'monster' && d.name === 'Adult Red Dragon');
        if (m){
          C.addMonster(m); await sleep(50);
          const dr = state.combatants.find(c => c.baseName === 'Adult Red Dragon');
          state.activeCombatantId = dr.id; save();
          openPanel('turnview'); await sleep(500);
          const T = panelDefs.turnview; T._render(); await sleep(150);
          const ab = T._body.querySelector('[data-tv="area"]');
          ok('area save: the Turn View offers it on a breath weapon', !!ab);
          ab && ab.click(); await sleep(60);
          const d2 = document.getElementById('area-save-back');
          ok('area save: prefilled from the action, the attacker left out',
             !!d2 && d2.querySelector('#as-dc').value === '21' && /18d6 fire/.test(d2.querySelector('#as-dmg').value)
             && !d2.querySelector('#as-targets input[value="' + dr.id + '"]'));
          d2 && d2.remove();
          closePanel('turnview');
        }
      } catch(e){ ok('area save: the checks ran to completion', false, e.message); }
      finally {
        document.getElementById('area-save-back')?.remove();
        _remoteUpdate = true;
        try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
        finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party'); C._render();
      }
    }

    // -- Undo, away from the map ------------------------------------------
    {
      _remoteUpdate = true;
      try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
      finally { _remoteUpdate = false; }
      loadDomain('combat'); loadDomain('party');
      const C = panelDefs.combat; openPanel('combat'); await sleep(250); C._render();
      try {
        const i = state.combatants.findIndex(c => !c.isPC && (c.hp || 0) > 12);
        const id = state.combatants[i].id, hp0 = state.combatants[i].hp;
        const hpOf = cid => (state.combatants.find(c => c.id === cid) || {}).hp;
        const btn = () => C._body.querySelector('[data-act="hp-damage"][data-idx="' + i + '"]');
        const inp = () => C._body.querySelector('.hp-dmg-amt[data-idx="' + i + '"]');
        ok('undo: the damage strip is where the test thinks it is', !!btn() && !!inp());
        inp().value = '7'; btn().click(); await sleep(60);
        ok('undo: damage lands first', hpOf(id) === hp0 - 7);
        const newest = () => [...document.querySelectorAll('.toast-item .toast-action')].pop();
        const act = newest();
        ok('undo: and the toast offers to take it back', !!act && act.textContent === 'Undo');
        sktUndo(); await sleep(60);
        ok('undo: the creature gets its hit points back', hpOf(id) === hp0, hpOf(id));
        sktRedo(); await sleep(60);
        ok('undo: redo puts the damage back', hpOf(id) === hp0 - 7);
        sktUndo(); await sleep(60);

        // The surgical part. Another device changes a DIFFERENT creature
        // while this undo is pending; undoing must not drag that back too.
        inp().value = '5'; btn().click(); await sleep(60);
        const j = state.combatants.findIndex((c, n) => n !== i && !c.isPC);
        const oid = state.combatants[j].id;
        const blob = JSON.parse(localStorage.getItem('skt-combat-v1'));
        blob.combatants.find(c => c.id === oid).hp = 3;
        _remoteUpdate = true;
        try { localStorage.setItem('skt-combat-v1', JSON.stringify(blob)); } finally { _remoteUpdate = false; }
        loadDomain('combat'); C._render(); await sleep(30);
        sktUndo(); await sleep(60);
        ok('undo: it puts back only what this action changed',
           hpOf(id) === hp0 && hpOf(oid) === 3, JSON.stringify({ mine: hpOf(id), theirs: hpOf(oid) }));

        // A removal, which has to put the creature back where it was.
        const name = state.combatants[i].name, n0 = state.combatants.length;
        C._body.querySelector('[data-act="remove"][data-idx="' + i + '"]').click(); await sleep(60);
        ok('undo: removing a combatant takes it off the list', state.combatants.length === n0 - 1);
        // Again with someone else moving at the same time, so the undo has
        // to put one creature back INTO the list the others left behind
        // rather than restoring the whole list wholesale.
        const blob2 = JSON.parse(localStorage.getItem('skt-combat-v1'));
        blob2.combatants.find(c => c.id === oid).hp = 7;
        _remoteUpdate = true;
        try { localStorage.setItem('skt-combat-v1', JSON.stringify(blob2)); } finally { _remoteUpdate = false; }
        loadDomain('combat'); C._render(); await sleep(30);
        const theirsBefore = hpOf(oid);
        const curNow = (JSON.parse(localStorage.getItem('skt-combat-v1')).combatants.find(c => c.id === oid) || {}).hp;
        sktUndo(); await sleep(60);
        ok('undo: and it comes back in its old place',
           state.combatants.length === n0 && state.combatants[i] && state.combatants[i].name === name,
           JSON.stringify({ n: state.combatants.length, want: n0, at: (state.combatants[i] || {}).name, name }));
        ok('undo: without undoing what the others did meanwhile', hpOf(oid) === 7,
           JSON.stringify({ now: hpOf(oid), beforeUndo: theirsBefore, inStorage: curNow }));

        // Ctrl+Z, and the map keeping its own.
        inp().value = '4'; btn().click(); await sleep(60);
        // Dispatched on body, where a real key press lands, and where the
        // palette's own Ctrl+K check dispatches from.
        const ctrlZ = o => document.body.dispatchEvent(new KeyboardEvent('keydown',
          Object.assign({ key: 'z', ctrlKey: true, bubbles: true, cancelable: true }, o || {})));
        ctrlZ();
        await sleep(60);
        ok('undo: Ctrl+Z does it from the keyboard', hpOf(id) === hp0,
           JSON.stringify({ hp: hpOf(id), want: hp0, depth: sktUndoDepth() }));
        const depth = sktUndoDepth();
        inp().value = '4'; btn().click(); await sleep(60);
        const fake = document.createElement('div');
        fake.className = 'window focused'; fake.dataset.panel = 'battlemap';
        document.body.appendChild(fake);
        ctrlZ();
        await sleep(60);
        fake.remove();
        ok('undo: Ctrl+Z over the battle map is left to the map',
           hpOf(id) === hp0 - 4 && sktUndoDepth() === depth + 1);
        sktUndo(); await sleep(40);

        // A long rest is the biggest irreversible click in the app.
        const P = panelDefs.party; openPanel('party'); await sleep(250);
        const pid = (state.party.find(p => p.hpMax > 10) || state.party[0]).id;
        const pcOf = () => state.party.find(p => p.id === pid) || {};
        const pi = state.party.findIndex(p => p.id === pid);
        state.party[pi] = { ...state.party[pi], hp: 3, exhaustion: 2 };
        // Through the mirror, not around it: a party record whose combat
        // card still says full HP is a state the app never produces, and
        // reconcilePcHp would pull the old number straight back.
        if (typeof syncPartyToCombat === 'function') syncPartyToCombat(pi);
        save(); await sleep(30);
        P._applyLongRest(); await sleep(60);
        ok('undo: a long rest heals the party', pcOf().hp === pcOf().hpMax && pcOf().exhaustion === 1,
           JSON.stringify({ hp: pcOf().hp, max: pcOf().hpMax, ex: pcOf().exhaustion }));
        sktUndo(); await sleep(60);
        ok('undo: and it can be taken back', pcOf().hp === 3 && pcOf().exhaustion === 2,
           JSON.stringify({ hp: pcOf().hp, ex: pcOf().exhaustion }));
      } catch(e){ ok('undo: the checks ran to completion', false, e.message); }
      finally {
        _remoteUpdate = true;
        try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
        finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party');
        panelDefs.combat._render(); panelDefs.party._render?.();
        closePanel('party');
      }
    }

    // -- Who is connected --------------------------------------------------
    {
      const live0 = window.realtimeLive, refresh0 = window.realtimeRefreshAll;
      try {
        save();   // so the signature is of the same state the panels hold
        const sig = sktPresenceSignature();
        ok('presence: a signature covers combat, party and map', !!sig && !!sig.c && !!sig.p && !!sig.m);
        const c0 = sig.c;
        const i = state.combatants.findIndex(c => !c.isPC);
        state.combatants[i] = { ...state.combatants[i], hp: (state.combatants[i].hp || 10) - 1 };
        save();
        ok('presence: it changes when a creature does', sktPresenceSignature().c !== c0);
        ok('presence: and not every part at once', sktPresenceSignature().p === sig.p);

        const me = sktDeviceId();
        ok('presence: this device is in the list', sktPresenceRows().some(r => r.mine && r.id === me));
        const mine = sktPresenceSignature();
        const now = Date.now();
        sktPresenceSeed({ zz: { ts: now, who: 'Zoey', kind: 'phone', sig: mine } });
        let rows = sktPresenceRows();
        ok('presence: a second device shows up', rows.length === 2 && rows[1].who === 'Zoey' && rows[1].state === 'ok');
        ok('presence: the chip counts them', (document.querySelector('#sync-status .sync-count') || {}).textContent === '2');
        ok('presence: the list says who, and how they are doing',
           /Zoey/.test(sktPresenceListHtml()) && /in sync/.test(sktPresenceListHtml()));

        // A device whose map has been wrong for twenty of its own seconds.
        const behind = { c: mine.c, p: mine.p, m: 'nope' };
        sktPresenceSeed({ zz: { ts: now - 20000, who: 'Zoey', kind: 'phone', sig: behind } });
        ok('presence: a fresh disagreement is just sync catching up', sktPresenceRows()[1].state === 'ok');
        sktPresenceSeed({ zz: { ts: now, who: 'Zoey', kind: 'phone', sig: behind } }, true);
        rows = sktPresenceRows();
        ok('presence: one that persists is called out, and says which part',
           rows[1].state === 'behind' && rows[1].diff.join() === 'map', JSON.stringify(rows[1]));
        ok('presence: and the chip warns', !!document.querySelector('#sync-status .sync-count.warn'));
        ok('presence: the row offers to resync that device', /data-pres-resync="zz"/.test(sktPresenceListHtml()));

        // Quiet, then gone.
        sktPresenceSeed({ zz: { ts: now - 60000, who: 'Zoey', kind: 'phone', sig: mine } });
        ok('presence: a device that stops sending goes quiet', sktPresenceRows()[1].state === 'quiet');
        sktPresenceSeed({ zz: { ts: now - 300000, who: 'Zoey', kind: 'phone', sig: mine } });
        ok('presence: and is dropped once it is long gone', sktPresenceRows().length === 1);

        // Resync, both directions.
        const sent = [];
        window.realtimeLive = { push: (path, val) => sent.push([path, val]), serverNow: () => Date.now() };
        sktPresenceResync('zz');
        ok('presence: Resync asks that device, down the live channel',
           sent.length === 1 && sent[0][0] === 'resync' && sent[0][1].who === 'zz');
        let refreshed = 0;
        window.realtimeRefreshAll = () => { refreshed++; };
        sktPresenceResync(sktDeviceId());
        ok('presence: resyncing this device re-reads everything', refreshed === 1);

        // The popover.
        sktPresenceSeed({ zz: { ts: Date.now(), who: 'Zoey', kind: 'phone', sig: sktPresenceSignature() } });
        document.getElementById('sync-status').click(); await sleep(60);
        ok('presence: the sync chip opens the list', !!document.getElementById('presence-pop')
           && /Zoey/.test(document.getElementById('presence-pop').textContent));
        document.getElementById('sync-status').click(); await sleep(40);
        ok('presence: and closes it again', !document.getElementById('presence-pop'));
      } catch(e){ ok('presence: the checks ran to completion', false, e.message); }
      finally {
        window.realtimeLive = live0; window.realtimeRefreshAll = refresh0;
        sktPresenceSeed({}); sktPresenceClose();
        _remoteUpdate = true;
        try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
        finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party'); panelDefs.combat._render();
      }
    }

    // -- Presence on the wire ---------------------------------------------
    // The seeded checks above cover the reading of the room; this covers
    // what actually goes down the socket, against a stand-in for Firebase.
    // Worth its own block because the shape is load-bearing: presence has to
    // live in live/presence_<device> rather than live/presence/<device>,
    // since the published database rules validate live/$chan directly, and
    // it has to be read as a KEY RANGE so a device isn't handed every tick
    // of every token drag.
    {
      const db0 = _fbDb;
      let range = null, rangeCb = null;
      const sets = [], listens = {};
      const q = { on(ev, f){ rangeCb = f; return f; }, off(){} };
      const mkRef = path => ({
        orderByKey(){ return { startAt(a){ return { endAt(b){ range = [path, a, b]; return q; } }; } }; },
        set(v){ sets.push([path, v]); return Promise.resolve(); },
        remove(){ return Promise.resolve(); },
        once(){ return Promise.resolve({ exists: () => false, val: () => null }); },
        on(ev, f){ listens[path] = f; return f; },
        off(){},
        onDisconnect(){ return { remove(){ return Promise.resolve(); } }; },
      });
      try {
        _fbDb = { ref: mkRef };
        const attached = sktPresenceOnline();
        ok('presence: it attaches once there is a database to attach to', attached === true);
        ok('presence: it reads the presence channels as one key range',
           !!range && /\/live$/.test(range[0]) && range[1] === 'presence_' && range[2].indexOf('presence_') === 0,
           JSON.stringify(range));
        const beat = sets.filter(x => /\/live\/presence_/.test(x[0])).pop();
        ok('presence: the heartbeat is a live channel of its own, with a timestamp',
           !!beat && beat[0].indexOf('/live/presence_' + sktDeviceId()) > 0
           && typeof beat[1].ts === 'number' && !!beat[1].sig && !!beat[1].who,
           beat && beat[0]);
        // A device arriving down the wire, keyed by the full channel name.
        rangeCb({ val: () => ({ ['presence_qq']: { ts: Date.now(), who: 'Pell', kind: 'phone', sig: sktPresenceSignature() } }) });
        await sleep(20);
        ok('presence: an incoming channel becomes a row, prefix stripped',
           sktPresenceRows().some(r => r.id === 'qq' && r.who === 'Pell'),
           JSON.stringify(sktPresenceRows().map(r => r.id)));
        // And a resync command aimed at this device.
        let refreshed = 0;
        const refresh0 = window.realtimeRefreshAll;
        window.realtimeRefreshAll = () => { refreshed++; };
        const resyncPath = Object.keys(listens).find(k => /\/live\/resync$/.test(k));
        ok('presence: it listens for a resync aimed at it', !!resyncPath);
        listens[resyncPath]({ val: () => ({ who: 'somebody else', ts: Date.now() }) });
        await sleep(20);
        ok('presence: one aimed at another device is ignored', refreshed === 0);
        listens[resyncPath]({ val: () => ({ who: sktDeviceId(), ts: Date.now() }) });
        await sleep(20);
        ok('presence: one aimed at this device re-reads everything', refreshed === 1);
        window.realtimeRefreshAll = refresh0;
      } catch(e){ ok('presence: the wire checks ran to completion', false, e.message); }
      finally { _fbDb = db0; sktPresenceSeed({}); }
    }

    // -- The fight, from the token ----------------------------------------
    {
      _remoteUpdate = true;
      try { ['skt-combat-v1', 'skt-party-v1', 'skt-battlemap-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
      finally { _remoteUpdate = false; }
      loadDomain('combat'); loadDomain('party');
      closePanel('battlemap'); openPanel('battlemap'); await sleep(900);
      const bm = panelDefs.battlemap, C = panelDefs.combat;
      const mode0 = state.settings.monsterStatsMode;
      try {
        const tok = bm._tokens.find(t => bm._combatantFor(t) && !bm._combatantFor(t).isPC);
        ok('token: a token knows which fighter it stands for', !!tok);
        const mon = bm._combatantFor(tok), id = mon.id;
        const at = () => state.combatants.findIndex(c => c.id === id);
        const el = () => document.querySelector('.map-token[data-tid="' + tok.id + '"]');
        const setHp = n => { const i = at(); state.combatants[i] = { ...state.combatants[i], hp: n }; save(); };

        // Hurt things look hurt.
        setHp(mon.hpMax); await sleep(80);
        ok('token: a healthy creature wears no ring', !/wound-/.test((el() || {}).className || ''));
        setHp(Math.ceil(mon.hpMax * 0.4)); await sleep(80);
        ok('token: at half it gets a ring', /wound-half/.test((el() || {}).className || ''), (el() || {}).className);
        setHp(Math.max(1, Math.ceil(mon.hpMax * 0.1))); await sleep(80);
        ok('token: near the end the ring changes', /wound-low/.test((el() || {}).className || ''), (el() || {}).className);
        ok('token: and the DM reads the real numbers off it',
           /\d+\/\d+ HP/.test((el() || {}).title || ''), (el() || {}).title);

        // Damage and conditions where the creature is.
        bm._selected = tok.id; bm._showPanel(tok); await sleep(60);
        const box = bm._body.querySelector('#tp-hp');
        ok('token: its panel offers hit points', !!box && box.style.display === 'block'
           && /\d+\/\d+ HP/.test((bm._body.querySelector('#tp-hp-line') || {}).textContent || ''));
        const hp0 = state.combatants[at()].hp;
        bm._body.querySelector('#tp-amt').value = '3';
        bm._body.querySelector('#tp-dmg').click(); await sleep(80);
        ok('token: damage from the token lands on the card', state.combatants[at()].hp === hp0 - 3);
        ok('token: and can be taken back', /took 3 damage/.test(sktUndoLabel() || ''), sktUndoLabel());
        sktUndo(); await sleep(60);
        ok('token: undone, the hit points are back', state.combatants[at()].hp === hp0);
        bm._body.querySelector('#tp-heal').click(); await sleep(80);
        ok('token: healing works the same way', state.combatants[at()].hp === Math.min(mon.hpMax, hp0 + 3));
        let condItems = null; const sm = window.showContextMenu;
        window.showContextMenu = (x, y, it) => { condItems = it; };
        bm._body.querySelector('#tp-cond').click(); await sleep(40);
        window.showContextMenu = sm;
        const prone = (condItems || []).find(i => i.label === 'Prone');
        ok('token: conditions are offered from the same panel', !!prone, (condItems || []).length);
        prone && prone.onClick(); await sleep(60);
        ok('token: and one applied shows on the card',
           (state.combatants[at()].conditions || []).includes('Prone'));
        sktUndo(); await sleep(60);
        ok('token: that is undoable too', !(state.combatants[at()].conditions || []).includes('Prone'));

        // Hidden from the players.
        bm._body.querySelector('#tp-hide').click(); await sleep(80);
        ok('token: it can be hidden from the players', tok.hidden === true
           && /tok-hidden/.test((el() || {}).className || ''));
        ok('token: and the button then offers to reveal it',
           /Reveal/.test(bm._body.querySelector('#tp-hide').textContent));
        ok('token: the DM still sees it', !!el());
        ok('token: hiding is saved with the map',
           (JSON.parse(localStorage.getItem('skt-battlemap-v1')).tokens.find(t => t.id === tok.id) || {}).hidden === true);
        bm._body.querySelector('#tp-hide').click(); await sleep(80);
        ok('token: and revealing puts it back', !tok.hidden);
      } catch(e){ ok('token: the checks ran to completion', false, e.message); }
      finally {
        state.settings.monsterStatsMode = mode0;
        bm._selected = null; bm._closePanel && bm._closePanel();
        closePanel('battlemap');
        _remoteUpdate = true;
        try { ['skt-combat-v1', 'skt-party-v1', 'skt-battlemap-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
        finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party'); panelDefs.combat._render();
      }
    }

    // -- A word to one player ---------------------------------------------
    {
      const ho0 = localStorage.getItem('skt-handouts-v1');
      try {
        const pc = state.party.find(p => !p.foe), other = state.party.find(p => !p.foe && p.id !== pc.id);
        localStorage.setItem('skt-handouts-v1', JSON.stringify({ list: [] }));
        ok('whisper: it sends', sktSendWhisper(pc.id, 'The innkeeper is lying.') === true);
        const h = sktHandouts().list[0];
        ok('whisper: addressed to that character alone',
           !!h && Array.isArray(h.to) && h.to.length === 1 && h.to[0] === pc.id, JSON.stringify(h && h.to));
        ok('whisper: it carries the line, and nothing to download',
           h.text === 'The innkeeper is lying.' && h.img === null && h.whisper === true);
        ok('whisper: it is stamped so the phone pops it up', typeof h.shownAt === 'number' && h.shownAt > 0);
        ok('whisper: an empty one is not sent', sktSendWhisper(pc.id, '   ') === false);
        // Chatter is capped; a picture handout is never dropped for it.
        const keep = { id: 'keepme', title: 'Map', text: '', img: null, to: 'all', ts: 1, shownAt: 1 };
        const d = sktHandouts(); d.list.push(keep);
        localStorage.setItem('skt-handouts-v1', JSON.stringify(d));
        for (let i = 0; i < 25; i++) sktSendWhisper(pc.id, 'line ' + i);
        const after = sktHandouts().list;
        ok('whisper: old whispers are trimmed', after.filter(x => x.whisper).length === 20, after.filter(x => x.whisper).length);
        ok('whisper: and the handouts are left alone', after.some(x => x.id === 'keepme'));
        if (other){
          ok('whisper: each one goes to one phone',
             sktHandouts().list.filter(x => x.whisper && x.to.includes(other.id)).length === 0);
        }
        const cmd = _cpCommands().find(c => c.group === 'Players' && c.label === 'Whisper to ' + pc.name);
        ok('whisper: Ctrl+K can send one by name', !!cmd);
      } catch(e){ ok('whisper: the checks ran to completion', false, e.message); }
      finally {
        _remoteUpdate = true;
        try { if (ho0 == null) localStorage.removeItem('skt-handouts-v1'); else localStorage.setItem('skt-handouts-v1', ho0); }
        finally { _remoteUpdate = false; }
      }
    }

    // -- Players roll their own saving throws ------------------------------
    {
      _remoteUpdate = true;
      try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
      finally { _remoteUpdate = false; }
      loadDomain('combat'); loadDomain('party');
      const C = panelDefs.combat; openPanel('combat'); await sleep(250); C._render();
      const req0 = localStorage.getItem('skt-savereq-v1');
      try {
        const pcs = state.combatants.filter(c => c.isPC && !c.dead).slice(0, 2).map(c => c.id);
        ok('saves: two characters to ask', pcs.length === 2);
        C.openAreaSave({ name: 'Fireball', ab: 'DEX', dc: 15, parts: [{ dice: '8d6', type: 'fire' }], targets: pcs });
        await sleep(120);
        const back = document.getElementById('area-save-back');
        ok('saves: the area dialog offers to ask the players', !!back.querySelector('[data-as="ask"]'));
        ok('saves: with a switch for telling them the DC', !!back.querySelector('#as-showdc'));
        back.querySelector('#as-showdc').checked = true;
        back.querySelector('[data-as="ask"]').click(); await sleep(100);
        const req = JSON.parse(localStorage.getItem('skt-savereq-v1'));
        ok('saves: the ask names the ability, the DC and what it is for',
           !!req && req.ab === 'DEX' && req.dc === 15 && req.showDc === true && req.name === 'Fireball'
           && req.pcs.length === 2 && !req.closed, JSON.stringify(req && { ab: req.ab, dc: req.dc, n: req.pcs.length }));
        ok('saves: their rows wait for them', back.querySelectorAll('.as-table tr.waiting').length === 2);
        ok('saves: and nothing can be applied while they do',
           back.querySelector('[data-as="apply"]').disabled === true);
        // One answers well, one badly.
        req.answers = { [pcs[0]]: { v: 23, rid: req.id, at: Date.now() } };
        saveJson('skt-savereq-v1', req, 'save request');
        C._onSaveAnswers(); await sleep(60);
        ok('saves: an answer fills in that row',
           back.querySelectorAll('.as-table tr.waiting').length === 1
           && back.querySelectorAll('.as-table tr.ok').length === 1);
        ok('saves: an answer from an older ask is ignored', (() => {
          const stale = JSON.parse(localStorage.getItem('skt-savereq-v1'));
          stale.answers[pcs[1]] = { v: 25, rid: 'sr_somethingelse', at: Date.now() };
          saveJson('skt-savereq-v1', stale, 'save request');
          C._onSaveAnswers();
          return back.querySelectorAll('.as-table tr.waiting').length === 1;
        })());
        const r2 = JSON.parse(localStorage.getItem('skt-savereq-v1'));
        r2.answers[pcs[1]] = { v: 4, rid: r2.id, at: Date.now() };
        saveJson('skt-savereq-v1', r2, 'save request');
        C._onSaveAnswers(); await sleep(60);
        ok('saves: once everyone is in, the damage can be applied',
           back.querySelectorAll('.as-table tr.waiting').length === 0
           && back.querySelector('[data-as="apply"]').disabled === false);
        ok('saves: the table shows it was their own roll',
           /their roll/.test(back.querySelector('.as-table').textContent));
        const hpBefore = pcs.map(id => (state.combatants.find(c => c.id === id) || {}).hp);
        back.querySelector('[data-as="apply"]').click(); await sleep(150);
        const took = pcs.map((id, k) => hpBefore[k] - (state.combatants.find(c => c.id === id) || {}).hp);
        ok('saves: the one who saved takes less than the one who did not',
           took[0] < took[1] && took[1] > 0, JSON.stringify(took));
        ok('saves: and the pop-up is taken off the phones',
           (JSON.parse(localStorage.getItem('skt-savereq-v1')) || {}).closed === true);

        // Nobody waits forever: the DM can roll a straggler's save instead.
        // The fireball above can drop a character to 0 depending on the
        // dice, and the dialog only lists those still standing — so put the
        // fight back first, or this half of the test depends on a roll.
        _remoteUpdate = true;
        try { localStorage.setItem('skt-combat-v1', snapshot['skt-combat-v1']); } finally { _remoteUpdate = false; }
        loadDomain('combat');
        C.openAreaSave({ name: 'Breath', ab: 'DEX', dc: 12, parts: [{ dice: '2d6', type: 'fire' }], targets: pcs });
        await sleep(100);
        const b2 = document.getElementById('area-save-back');
        b2.querySelector('[data-as="ask"]').click(); await sleep(80);
        const waiting0 = b2.querySelectorAll('.as-table tr.waiting').length;
        ok('saves: a waiting row can be rolled by the DM instead',
           waiting0 === 2 && !!b2.querySelector('[data-as="rollfor"]'), waiting0);
        b2.querySelector('[data-as="rollfor"]').click(); await sleep(60);
        ok('saves: which fills it in', b2.querySelectorAll('.as-table tr.waiting').length === waiting0 - 1);
        b2.querySelector('[data-as="cancel"]').click(); await sleep(60);
        ok('saves: closing the dialog closes the ask',
           (JSON.parse(localStorage.getItem('skt-savereq-v1')) || {}).closed === true);
        ok('saves: asking with no characters picked does nothing', C.askSaves({ ab: 'WIS', dc: 10, pcs: [] }) === null);
        // An answer from a player window in this same browser arrives as a
        // `storage` event, not through the sync layer.
        C.openAreaSave({ name: 'Relay', ab: 'DEX', dc: 10, parts: [], targets: pcs.slice(0, 1) });
        await sleep(80);
        const b3 = document.getElementById('area-save-back');
        b3.querySelector('[data-as="ask"]').click(); await sleep(60);
        const r3 = JSON.parse(localStorage.getItem('skt-savereq-v1'));
        r3.answers = { [pcs[0]]: { v: 19, rid: r3.id, at: Date.now() } };
        const v3 = JSON.stringify(r3);
        _remoteUpdate = true;
        try { localStorage.setItem('skt-savereq-v1', v3); } finally { _remoteUpdate = false; }
        window.dispatchEvent(new StorageEvent('storage', { key: 'skt-savereq-v1', newValue: v3 }));
        await sleep(60);
        ok('saves: an answer from a player tab on this laptop fills the row',
           b3.querySelectorAll('.as-table tr.waiting').length === 0 && /their roll/.test(b3.querySelector('.as-table').textContent));
        b3.querySelector('[data-as="cancel"]').click(); await sleep(40);
      } catch(e){ ok('saves: the checks ran to completion', false, e.message); }
      finally {
        document.getElementById('area-save-back')?.remove();
        C._areaSaveOnAnswers = null;
        _remoteUpdate = true;
        try {
          if (req0 == null) localStorage.removeItem('skt-savereq-v1'); else localStorage.setItem('skt-savereq-v1', req0);
          ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); });
        } finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party'); C._render();
      }
    }

    // -- "A new version is available" waits for a tap ----------------------
    // Nothing else applies an update — a refresh keeps the old version while
    // the new one waits — so a prompt that timed out left a device on old
    // code until every tab was closed.
    {
      try {
        document.getElementById('toast-host')?.remove();
        let tapped = 0;
        // Watch what each toast schedules rather than waiting it out: a toast
        // with a button already lasts five seconds, so a short wait could not
        // tell a sticky prompt from one that will time out later.
        const st0 = window.setTimeout, timers = [];
        window.setTimeout = (fn, ms, ...rest) => { timers.push(ms || 0); return st0(fn, ms, ...rest); };
        try { showToast('An ordinary one'); } finally { window.setTimeout = st0; }
        ok('update: an ordinary toast schedules its own exit', timers.some(ms => ms >= 1000), JSON.stringify(timers));
        timers.length = 0;
        window.setTimeout = (fn, ms, ...rest) => { timers.push(ms || 0); return st0(fn, ms, ...rest); };
        try { showToast('A new version is available.', { sticky: true, action: { label: 'Reload', run: () => { tapped++; } } }); }
        finally { window.setTimeout = st0; }
        ok('update: the prompt schedules none', !timers.some(ms => ms >= 1000), JSON.stringify(timers));
        for (let i = 0; i < 4; i++) showToast('Filler ' + i);
        ok('update: later toasts never push the prompt off', !!document.querySelector('.toast-item.sticky'));
        document.querySelector('.toast-item.sticky .toast-action').click(); await sleep(300);
        ok('update: tapping Reload runs it and clears it', tapped === 1 && !document.querySelector('.toast-item.sticky'));
      } catch(e){ ok('update: the checks ran to completion', false, e.message); }
      finally { document.getElementById('toast-host')?.remove(); }
    }

    // -- The character builder: the rules, both editions --------------------
    // Hand-worked characters, so a wrong number is a wrong rule rather than a
    // changed expectation.
    {
      try {
        const R24 = await sktRulesLoad('2024'), R14 = await sktRulesLoad('2014');
        ok('builder: both editions load twelve classes', R24.classes.length === 12 && R14.classes.length === 12);
        // 2024 Human Fighter 1, Soldier, chain mail, Defense.
        const f = Object.assign(sktBlankBuild('2024'), { name: 'T1', species: 'Human', cls: 'Fighter', level: 1, background: 'Soldier',
          abilities: { method: 'manual', base: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 } },
          bgAsi: { str: 2, con: 1 }, skills: ['athletics', 'perception'], equipment: { cls: 'A', bg: 'A' },
          optional: { 'Fighting Style': ['Defense'] }, masteries: ['greatsword'] });
        const F = sktComputeCharacter(f, R24);
        ok('builder 2024: STR 17 from the background', F.abilities.str === 17, F.abilities);
        ok('builder 2024: HP 10 + CON 2 = 12', F.hpMax === 12, F.hpMax);
        ok('builder 2024: AC chain mail 16 + Defense = 17', F.ac === 17, F.ac);
        const gs = F.sheet.attacks.find(a => a.name === 'Greatsword');
        ok('builder 2024: greatsword +5, 2d6+3, with its mastery', !!gs && gs.atkBonus === '+5' && gs.damage === '2d6+3 slashing' && gs.mastery === 'Graze', gs);
        ok('builder 2024: Second Wind twice, spendable from a phone',
           (F.resources.find(r => r.name === 'Second Wind') || {}).max === 2 && F.sheet.activations.some(a => a.resource === 'Second Wind'));
        ok('builder 2024: the background’s origin feat', F.feats.includes('Savage Attacker'), F.feats);
        // 2014 Hill Dwarf Barbarian 5.
        const bb = Object.assign(sktBlankBuild('2014'), { name: 'T2', species: 'Dwarf', subspecies: 'Hill', cls: 'Barbarian', subclass: 'Berserker', level: 5,
          background: 'Outlander', abilities: { method: 'manual', base: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 } },
          skills: ['athletics', 'intimidation'], asi: { 4: { type: 'asi', inc: { str: 2 } } } });
        const B = sktComputeCharacter(bb, R14);
        ok('builder 2014: HP d12 with the hill dwarf’s extra point a level = 55', B.hpMax === 55, B.hpMax);
        ok('builder 2014: Unarmored Defense 10 + DEX + CON = 14', B.ac === 14, B.ac);
        ok('builder 2014: dwarf 25 ft + Fast Movement = 35', B.spd === 35, B.spd);
        ok('builder 2014: three rages, two attacks', (B.resources.find(r => r.name === 'Rage') || {}).max === 3 && B.sheet.attacksPerAction === 2);
        // 2014 High Elf Wizard 5.
        const w = Object.assign(sktBlankBuild('2014'), { name: 'T3', species: 'Elf', subspecies: 'High', cls: 'Wizard', subclass: 'Evocation', level: 5,
          background: 'Sage', abilities: { method: 'manual', base: { str: 8, dex: 13, con: 14, int: 15, wis: 12, cha: 10 } },
          skills: ['arcana', 'investigation'], asi: { 4: { type: 'asi', inc: { int: 2 } } }, cantrips: ['Fire Bolt'] });
        const W = sktComputeCharacter(w, R14);
        ok('builder 2014: wizard 5 slots 4/3/2, DC 15', W.sheet.spellSlots[3] && W.sheet.spellSlots[3].total === 2 && W.sheet.spellSaveDc === 15, W.sheet.spellSlots);
        ok('builder 2014: Fire Bolt is 2d10 at level 5', (W.sheet.attacks.find(a => a.name === 'Fire Bolt') || {}).damage === '2d10 fire');
        // 2024 Warlock 5: pact magic, Eldritch Blast beams.
        const k = Object.assign(sktBlankBuild('2024'), { name: 'T4', species: 'Tiefling', cls: 'Warlock', subclass: 'Fiend', level: 5, background: 'Charlatan',
          abilities: { method: 'manual', base: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 } }, bgAsi: { cha: 2, dex: 1 },
          asi: { 4: { type: 'asi', inc: { cha: 1, con: 1 } } }, cantrips: ['Eldritch Blast'], optional: { 'Eldritch Invocations': ['Agonizing Blast'] } });
        const K = sktComputeCharacter(k, R24);
        ok('builder 2024: two pact slots at 3rd level', K.sheet.spellSlots[3] && K.sheet.spellSlots[3].total === 2 && !K.sheet.spellSlots[1]);
        ok('builder 2024: Eldritch Blast is two beams of 1d10+4', /^1d10\+4 force .2 beams$/.test((K.sheet.attacks.find(a => a.name === 'Eldritch Blast') || {}).damage || ''));
        // Weapon proficiency written as an item tag with a plural display.
        const bd = Object.assign(sktBlankBuild('2014'), { name: 'T5', species: 'Half-Elf', cls: 'Bard', level: 1, background: 'Entertainer',
          abilities: { method: 'manual', base: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 } }, speciesAsi: { dex: 1, con: 1 },
          equipment: { clsBlocks: ['a'] } });
        ok('builder 2014: a bard is proficient with the rapier it starts with', (sktComputeCharacter(bd, R14).sheet.attacks.find(a => a.name === 'Rapier') || {}).atkBonus === '+4');
        // Levelling a pool that grows: a full one stays full, a spent amount
        // stays spent. Lay on Hands is 15 at paladin 3 and 20 at 4.
        const pal = Object.assign(sktBlankBuild('2024'), { name: 'T6', species: 'Human', cls: 'Paladin', subclass: 'Devotion', level: 4, background: 'Soldier' });
        const loh = prior => (sktComputeCharacter(pal, R24, { resources: [{ name: 'Lay on Hands', type: 'pool', current: prior, max: 15 }] })
          .resources.find(r => r.name === 'Lay on Hands') || {});
        ok('builder: a full pool that grows on level up stays full', loh(15).current === 20 && loh(15).max === 20, loh(15));
        ok('builder: a part-spent pool keeps what was spent', loh(10).current === 15, loh(10));
        // The 2024 fighter's own Battle Master, not the 2014 one also listed for it.
        // Both printings have a "Combat Superiority", so check the printing.
        const bm = Object.assign(sktBlankBuild('2024'), { cls: 'Fighter', subclass: 'Battle Master', level: 3 });
        const bmSub = sktRulesSubclass(sktRulesClass(R24, 'Fighter'), 'Battle Master');
        ok('builder 2024: the edition’s own printing of a subclass', !!bmSub && bmSub.source === 'XPHB', bmSub && bmSub.source);
        ok('builder 2024: with its features', sktBuildFeatures(bm, R24).some(x => x.from === 'subclass' && x.name === 'Combat Superiority'));
      } catch(e){ ok('builder: the rules checks ran to completion', false, e.message); }
    }

    // -- The character builder: making and levelling a character -----------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      try {
        await openCharBuilder({}); await sleep(150);
        const root = () => document.getElementById('cb-root');
        const q = s => root().querySelector(s);
        const click = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.click(); };
        const tick = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const set = (s, v) => { const e = q(s); if (!e) throw new Error('missing ' + s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        ok('builder: it opens on Basics, with nothing chosen', !!root() && CB.step === 'basics' && sktBuildTodo(CB.build, CB.R).length >= 3);
        const nm = q('[data-cb-in="name"]'); nm.value = 'Testa'; nm.dispatchEvent(new Event('input', { bubbles: true }));
        ok('builder: the sheet beside it follows as you type', /Testa/.test(q('.cb-side').textContent));
        click('[data-cb-step="class"]'); await sleep(30); click('[data-cb-cls="Fighter"]'); await sleep(30);
        click('[data-cb-step="species"]'); await sleep(30); click('[data-cb-species="Dwarf"]'); await sleep(30);
        click('[data-cb-step="background"]'); await sleep(30); click('[data-cb-bg="Soldier"]'); await sleep(30);
        set('[data-cb-bg2]', 'str'); await sleep(20); set('[data-cb-bg1]', 'con'); await sleep(20);
        click('[data-cb-step="skills"]'); await sleep(30);
        tick('[data-cb-skill="perception"]'); await sleep(20); tick('[data-cb-skill="survival"]'); await sleep(20);
        click('[data-cb-step="levels"]'); await sleep(30);
        tick('[data-cb-opt-fighting-style="Defense"]'); await sleep(20);
        ['greatsword', 'flail', 'javelin'].forEach(n => tick('[data-cb-mastery="' + n + '"]'));
        await sleep(30);
        ok('builder: the choices are all made', sktBuildTodo(CB.build, CB.R).filter(t => !t.soft).length === 0,
           JSON.stringify(sktBuildTodo(CB.build, CB.R)));
        click('[data-cb-step="review"]'); await sleep(30);
        const n0 = state.party.length;
        click('[data-cb="save"]'); await sleep(200);
        const made = state.party.find(p => p.name === 'Testa');
        ok('builder: Create adds the character to the party', !root() && state.party.length === n0 + 1 && !!made);
        ok('builder: with the sheet the rest of the app reads',
           !!made && made.cls === 'fighter' && made.hpMax === 13 && made.ac === 17 && made.hitDice.dieType === 'd10'
           && made.build && made.rules === '2024', made && JSON.stringify({ hp: made.hpMax, ac: made.ac }));
        ok('builder: and Undo takes it away again', /Created Testa/.test(sktUndoLabel() || ''));
        // Level up, with damage taken and a pool partly spent.
        const i = state.party.findIndex(p => p.name === 'Testa');
        state.party[i] = { ...state.party[i], hp: 6,
          resources: state.party[i].resources.map(r => r.name === 'Second Wind' ? { ...r, current: 1 } : r) };
        save();
        await openCharBuilder({ idx: i, levelup: true }); await sleep(100);
        ok('builder: level up opens on what is new', CB.step === 'levels' && CB.build.level === 2 && /New at level 2/.test(q('.cb-main').textContent));
        click('[data-cb-step="review"]'); await sleep(30); click('[data-cb="save"]'); await sleep(200);
        const up = state.party[i];
        ok('builder: levelling up keeps the damage taken', up.level === 2 && up.hp === up.hpMax - 7, JSON.stringify({ hp: up.hp, max: up.hpMax }));
        ok('builder: and what was spent stays spent', (up.resources.find(r => r.name === 'Second Wind') || {}).current === 1);
        ok('builder: the same character, not a new one', up.id === made.id && state.party.length === n0 + 1);
        // The 2014 rules from the same builder.
        await openCharBuilder({}); await sleep(100);
        click('[data-cb-ed="2014"]'); await sleep(800);
        ok('builder: switching to the 2014 rules loads them', CB.build.edition === '2014' && CB.R && CB.R.edition === '2014');
        click('[data-cb-step="species"]'); await sleep(30); click('[data-cb-species="Half-Elf"]'); await sleep(30);
        ok('builder 2014: a half-elf is offered two +1s and two skills',
           root().querySelectorAll('[data-cb-spasi]').length === 5 && root().querySelectorAll('[data-cb-spskill]').length === 18);
        cbClose();
      } catch(e){ ok('builder: the UI checks ran to completion', false, e.message); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Class features: represented, not just text ------------------------
    {
      try {
        // Every base class feature, every class, levels 1-20, both books:
        // an effect, a choice the builder asks, or a header. Fails the day a
        // data update adds a feature nothing represents.
        for (const ed of ['2014', '2024']){
          const R = await sktRulesLoad(ed);
          const missing = [];
          R.classes.forEach(cls => {
            const b = Object.assign(sktBlankBuild(ed), { cls: cls.name, level: 20, subclass: (cls.subclasses.find(x => x.core) || {}).shortName || '' });
            sktBuildFeatures(b, R).filter(f => f.from === 'class' && !f.info && !f.mech).forEach(f => missing.push(cls.key + ':' + f.name));
          });
          ok('features ' + ed + ': every base class feature is represented', missing.length === 0, missing.slice(0, 8).join(', '));
        }
        const R24 = await sktRulesLoad('2024');
        // A choice the builder asks, and what each answer does.
        const cl = Object.assign(sktBlankBuild('2024'), { name: 'Cc', species: 'Human', cls: 'Cleric', subclass: 'Life', level: 1, background: 'Acolyte',
          abilities: { method: 'manual', base: { str: 10, dex: 12, con: 14, int: 13, wis: 15, cha: 8 } }, bgAsi: { wis: 2, int: 1 } });
        ok('features: Divine Order is asked, and required', sktBuildChoices(cl, R24).some(c => c.feature === 'Divine Order')
           && sktBuildTodo(cl, R24).some(t => /Divine Order/.test(t.what)));
        cl.featureChoices = { 'Divine Order': 'Thaumaturge' };
        const th = sktComputeCharacter(cl, R24);
        ok('features: Thaumaturge adds a cantrip and Wisdom to Arcana',
           sktBuildSpellcasting(cl, R24, th.abilities).cantrips === 4 && th.sheet.skills.arcana === 2 + 3, th.sheet.skills.arcana);
        cl.featureChoices = { 'Divine Order': 'Protector' };
        ok('features: Protector grants heavy armor and martial weapons',
           sktComputeCharacter(cl, R24).sheet.proficiencies.armor.includes('heavy') && sktComputeCharacter(cl, R24).sheet.proficiencies.weapons.includes('martial'));
        // Things you do become actions, with the pool they spend.
        const mk = Object.assign(sktBlankBuild('2024'), { name: 'Mm', cls: 'Monk', level: 5, species: 'Human', background: 'Hermit' });
        const M = sktComputeCharacter(mk, R24);
        ok('features: a monk’s Focus options spend Focus Points',
           ['Flurry of Blows', 'Patient Defense', 'Step of the Wind', 'Stunning Strike'].every(n => M.sheet.activations.some(a => a.name === n && a.resource === 'Focus Points')));
        ok('features: the Turn View and the phone read the same list', sktActivationsOf(M) === M.sheet.activations);
        // Short rests read each pool's own recharge.
        const ft = Object.assign(sktBlankBuild('2024'), { name: 'Rester', cls: 'Fighter', level: 2, species: 'Human', background: 'Soldier' });
        const pal = Object.assign(sktBlankBuild('2024'), { name: 'Rester2', cls: 'Paladin', subclass: 'Devotion', level: 3, species: 'Human', background: 'Soldier' });
        const p0 = localStorage.getItem('skt-party-v1');
        try {
          const F = sktComputeCharacter(ft, R24), P = sktComputeCharacter(pal, R24);
          const spend = (rec, name, cur) => rec.resources.map(r => r.name === name ? { ...r, current: cur } : r);
          F.resources = spend(F, 'Action Surge', 0); F.resources = F.resources.map(r => r.name === 'Second Wind' ? { ...r, current: 0 } : r);
          P.resources = spend(P, 'Channel Divinity', 0); P.resources = P.resources.map(r => r.name === 'Lay on Hands' ? { ...r, current: 3 } : r);
          F.id = 'rest_f'; P.id = 'rest_p';
          state.party.push(F, P); save();
          const PP = panelDefs.party; openPanel('party'); await sleep(150);
          PP._shortRestOne(state.party[state.party.length - 2], state.party.length - 2);
          PP._shortRestOne(state.party[state.party.length - 1], state.party.length - 1);
          const f2 = state.party[state.party.length - 2], q2 = state.party[state.party.length - 1];
          const cur = (rec, n) => (rec.resources.find(r => r.name === n) || {}).current;
          ok('rests: a short rest refills a short-rest pool (Action Surge)', cur(f2, 'Action Surge') === 1, cur(f2, 'Action Surge'));
          ok('rests: and gives back one use of a 2024 Second Wind', cur(f2, 'Second Wind') === 1, cur(f2, 'Second Wind'));
          ok('rests: and of a 2024 Channel Divinity', cur(q2, 'Channel Divinity') === 1, cur(q2, 'Channel Divinity'));
          ok('rests: but not a long-rest pool (Lay on Hands)', cur(q2, 'Lay on Hands') === 3, cur(q2, 'Lay on Hands'));
        } finally {
          _remoteUpdate = true;
          try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
          loadDomain('party'); closePanel('party');
        }
      } catch(e){ ok('features: the checks ran to completion', false, e.message); }
    }

    // ── Areas of effect on the map ────────────────────────────────────────
    {
      _remoteUpdate = true;
      try { if (snapshot['skt-battlemap-v1'] != null) localStorage.setItem('skt-battlemap-v1', snapshot['skt-battlemap-v1']); }
      finally { _remoteUpdate = false; }
      closePanel('battlemap'); openPanel('battlemap'); await sleep(900);
      const bm = panelDefs.battlemap, b = bm._body;
      try {
        bm._tool = 'area'; bm._render(); await sleep(80);
        ok('areas: the tool shows shape, size and colour', !!b.querySelector('#tpl-shape') && !!b.querySelector('#tpl-size') && !!b.querySelector('#tpl-color'));
        const tok = bm._tokens.find(t => t.x != null);
        b.querySelector('#tpl-shape').value = 'circle'; b.querySelector('#tpl-size').value = '10';
        const r = b.querySelector('.map-token[data-tid="' + tok.id + '"]').getBoundingClientRect();
        const dc = b.querySelector('#draw-canvas');
        dc.dispatchEvent(new MouseEvent('mousedown', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, button: 0 }));
        document.dispatchEvent(new MouseEvent('mouseup', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
        await sleep(80);
        const a = bm._areas()[0];
        ok('areas: a click drops a sphere, saved with the map', !!a && a.shape === 'circle' && a.ft === 10
           && JSON.parse(localStorage.getItem('skt-battlemap-v1')).drawings.some(d => d.k === 'tpl'));
        ok('areas: 10 ft is two squares of radius', !!a && Math.abs(bm._areaGeom(a).circle.r - 10 * bm._tokenUnitScreen() / (bm._ftPerCell || 5)) < 1);
        ok('areas: the creature under it lights up', !!b.querySelector('.map-token.in-area[data-tid="' + tok.id + '"]'));
        // Dragging an area MOVES it. It used to drop a second one on top of
        // the first, which is not a thing anyone wants — a template is
        // something you shuffle around the board looking for the angle.
        const vs = bm._screenScale() || 1;
        const sphere = bm._areas()[0];
        const was = { x: sphere.x, y: sphere.y };
        const cx0 = r.left + r.width / 2, cy0 = r.top + r.height / 2;
        const drag = (x0, y0, x1, y1) => {
          dc.dispatchEvent(new MouseEvent('mousedown', { clientX: x0, clientY: y0, bubbles: true, button: 0 }));
          document.dispatchEvent(new MouseEvent('mousemove', { clientX: x1, clientY: y1, bubbles: true }));
          document.dispatchEvent(new MouseEvent('mouseup',   { clientX: x1, clientY: y1, bubbles: true }));
        };
        drag(cx0, cy0, cx0 + 60, cy0);
        await sleep(60);
        ok('areas: dragging one moves it instead of dropping a second',
           bm._areas().length === 1 && Math.abs(bm._areas()[0].x - (was.x + 60 / vs)) < 2
           && Math.abs(bm._areas()[0].y - was.y) < 2,
           JSON.stringify({ n: bm._areas().length, dx: +(bm._areas()[0].x - was.x).toFixed(1), want: +(60 / vs).toFixed(1) }));
        ok('areas: a move is saved with the map',
           (JSON.parse(localStorage.getItem('skt-battlemap-v1')).drawings.find(d => d.k === 'tpl') || {}).x === bm._areas()[0].x);
        bm._areas()[0].x = was.x; bm._areas()[0].y = was.y; bm._renderAreas();
        // Stage coordinates back to screen ones, so the test can aim at a
        // point it computed in map space. Asserted against the real inverse
        // rather than assumed: if the stage ever learns to rotate, this
        // fails loudly instead of quietly aiming at the wrong pixel.
        const toClient = (sx, sy) => {
          const st = b.querySelector('#map-stage').getBoundingClientRect();
          const cs = bm._csScreen();
          return { x: st.left + st.width / 2 + (sx - bm._cols * cs / 2) * vs,
                   y: st.top + st.height / 2 + (sy - bm._rows * cs / 2) * vs };
        };
        const rt = (() => { const c = toClient(was.x, was.y); return bm._stagePoint(c.x, c.y, dc); })();
        ok('areas: the test can aim at a point in map space', Math.hypot(rt.x - was.x, rt.y - was.y) < 1.5);
        // A second area still goes down on empty ground.
        const away = toClient(was.x, was.y + bm._areaGeom(sphere).circle.r * 2 + 40);
        b.querySelector('#tpl-shape').value = 'cone'; b.querySelector('#tpl-size').value = '30';
        drag(away.x, away.y, away.x, away.y + 150);
        await sleep(60);
        const cone = bm._areas()[1];
        ok('areas: a cone aims along the drag', !!cone && cone.shape === 'cone' && Math.abs(cone.ang - Math.PI / 2) < 0.2, cone && cone.ang.toFixed(2));
        // …and can be turned afterwards by its handle, without moving.
        const coneWas = { x: cone.x, y: cone.y };
        const h = bm._areaHandle(cone);
        ok('areas: a cone has a turn handle at its far end', !!h && !!b.querySelector('[data-tplrot="' + cone.id + '"]'));
        const hc = toClient(h.x, h.y), tgt = toClient(cone.x - 120, cone.y);
        drag(hc.x, hc.y, tgt.x, tgt.y);
        await sleep(60);
        ok('areas: dragging the handle turns it where it stands',
           Math.abs(Math.abs(cone.ang) - Math.PI) < 0.25 && cone.x === coneWas.x && cone.y === coneWas.y,
           cone.ang.toFixed(2));
        ok('areas: a sphere has no handle to turn', !bm._areaHandle(bm._areas()[0]));
        // The sizes themselves, against the PHB: a sphere's number is its
        // radius, a cone is as wide at its far end as it is long, a line is
        // 5 ft wide however long it is, and a cube's number is its side.
        const cell = bm._tokenUnitScreen(), ftc = bm._ftPerCell || 5;
        const px = ft => ft * cell / ftc;
        ok('areas: a 10 ft sphere is 10 ft of radius, not of width',
           Math.abs(bm._areaGeom(bm._areas()[0]).circle.r - px(10)) < 1);
        const coneG = bm._areaGeom(cone);
        const far = Math.hypot(coneG.poly[1][0] - coneG.poly[2][0], coneG.poly[1][1] - coneG.poly[2][1]);
        const len = Math.hypot((coneG.poly[1][0] + coneG.poly[2][0]) / 2 - cone.x,
                               (coneG.poly[1][1] + coneG.poly[2][1]) / 2 - cone.y);
        ok('areas: a 30 ft cone is 30 ft long', Math.abs(len - px(30)) < 1.5, len.toFixed(1) + ' vs ' + px(30).toFixed(1));
        ok('areas: and 30 ft wide at the far end', Math.abs(far - px(30)) < 1.5, far.toFixed(1) + ' vs ' + px(30).toFixed(1));
        const line = { k: 'tpl', id: 'probe1', shape: 'line', x: 100, y: 100, ang: 0, ft: 60, c: '#f00' };
        const lg = bm._areaGeom(line);
        ok('areas: a line is 5 ft wide whatever its length',
           Math.abs(Math.hypot(lg.poly[0][0] - lg.poly[1][0], lg.poly[0][1] - lg.poly[1][1]) - px(5)) < 1);
        ok('areas: and as long as it says', Math.abs(lg.poly[2][0] - lg.poly[1][0] - px(60)) < 1);
        const cube = { k: 'tpl', id: 'probe2', shape: 'cube', x: 100, y: 100, ang: 0, ft: 15, c: '#f00' };
        const cg = bm._areaGeom(cube);
        ok('areas: a 15 ft cube is 15 ft on every side',
           Math.abs(Math.hypot(cg.poly[0][0] - cg.poly[1][0], cg.poly[0][1] - cg.poly[1][1]) - px(15)) < 1
           && Math.abs(cg.poly[2][0] - cg.poly[1][0] - px(15)) < 1);
        ok('areas: with its origin in the middle of one face',
           Math.abs((cg.poly[0][1] + cg.poly[1][1]) / 2 - cube.y) < 0.5);
        bm._tool = ''; bm._render(); await sleep(60);
        ok('areas: the handles go away with the tool', !b.querySelector('[data-tplrot]'));
        bm._tool = 'area'; bm._render(); await sleep(60);
        ok('areas: the eraser leaves areas alone', !bm._eraseStrokeAt(Math.round(tok.x), Math.round(tok.y)) && bm._areas().length === 2);
        bm._drawings.push({ c: '#f00', s: 4, p: [1, 1, 30, 30] });
        const sc = window.showConfirm; window.showConfirm = () => Promise.resolve(true);
        const clearItem = (bm.menuItems ? bm.menuItems() : []).find(i => /Clear all drawings/.test(i.label || ''));
        if (clearItem){ clearItem.run(); await sleep(60); }
        window.showConfirm = sc;
        ok('areas: "Clear all drawings" keeps the areas', !!clearItem && bm._areas().length === 2 && !bm._drawings.some(d => d.p));
        let items = null; const sm = window.showContextMenu; window.showContextMenu = (x, y, it) => { items = it; };
        bm._areaMenu(bm._areas()[0], 10, 10); window.showContextMenu = sm;
        ok('areas: an area offers to roll saves for those inside', !!items && /Roll saves for the \d+ creature/.test(items[0].label));
        b.querySelector('[data-mact="clear-areas"]').click(); await sleep(60);
        ok('areas: "Clear areas" removes them all', bm._areas().length === 0);
      } catch(e){ ok('areas: the checks ran to completion', false, e.message); }
      finally { bm._tool = ''; closePanel('battlemap'); }
    }

    // ── Players roll their own initiative ─────────────────────────────────
    {
      const r0 = localStorage.getItem('skt-initreq-v1');
      _remoteUpdate = true;
      try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
      finally { _remoteUpdate = false; }
      loadDomain('combat'); loadDomain('party');
      const C = panelDefs.combat; openPanel('combat'); await sleep(250); C._render();
      try {
        const btn = C._body.querySelector('[data-act="ask-init"]');
        ok('initiative: the tracker has an "ask the players" button', !!btn);
        btn.click(); await sleep(60);
        const r = JSON.parse(localStorage.getItem('skt-initreq-v1'));
        const pcs = state.combatants.filter(c => c.isPC && !c.dead).map(c => c.id);
        ok('initiative: asking lists every character in the fight', !!r && !r.closed && JSON.stringify(r.pcs) === JSON.stringify(pcs));
        ok('initiative: the strip shows nobody in yet', /0 of \d+ in/.test((C._body.querySelector('.init-banner') || {}).textContent || ''));
        const a = JSON.parse(localStorage.getItem('skt-initreq-v1'));
        a.answers[pcs[0]] = { v: 19, rid: r.id }; a.answers[pcs[1]] = { v: 7, rid: r.id };
        a.answers[pcs[2]] = { v: 30, rid: 'ir_older' };   // a leftover answer to an earlier request
        _applyRemoteKey('skt-initreq-v1', JSON.stringify(a)); await sleep(60);
        ok('initiative: answers fill the tracker and the strip counts them (an old answer does not count)',
           /2 of \d+ in/.test(C._body.querySelector('.init-banner').textContent)
           && +state.combatants.find(c => c.id === pcs[0]).initiative === 19 && +state.combatants.find(c => c.id === pcs[1]).initiative === 7);
        const b2 = JSON.parse(localStorage.getItem('skt-initreq-v1'));
        pcs.slice(2).forEach((id, i) => b2.answers[id] = { v: 12 + i, rid: r.id });
        let t = null; const st = window.showToast; window.showToast = (m, o) => { t = { m, action: !!(o && o.action) }; };
        _applyRemoteKey('skt-initreq-v1', JSON.stringify(b2)); await sleep(60);
        window.showToast = st;
        ok('initiative: when everyone is in, the DM is told, with Sort to hand', !!t && /Everyone has rolled/.test(t.m) && t.action);
        C._body.querySelector('[data-act="init-sort"]').click(); await sleep(60);
        ok('initiative: Sort orders the fight and closes the request',
           state.combatants.every((c, i, arr) => i === 0 || +arr[i - 1].initiative >= +c.initiative)
           && JSON.parse(localStorage.getItem('skt-initreq-v1')).closed === true && !C._body.querySelector('.init-banner'));
      } catch(e){ ok('initiative: the DM checks ran to completion', false, e.message); }
      finally {
        if (r0 == null) localStorage.removeItem('skt-initreq-v1'); else localStorage.setItem('skt-initreq-v1', r0);
        _remoteUpdate = true;
        try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
        finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party'); C._render();
      }
    }

    // ── Party rests, after the hit-die / short-rest split ─────────────────
    {
      _remoteUpdate = true;
      try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
      finally { _remoteUpdate = false; }
      loadDomain('combat'); loadDomain('party');
      const P = panelDefs.party; openPanel('party'); await sleep(200);
      try {
        const i = state.party.findIndex(p => p.hpMax > 10);
        state.party[i] = { ...state.party[i], hp: 5, hitDice: { current: 2, max: 4, dieType: 'd8' }, concentration: 'Bless',
          resources: [...(state.party[i].resources || []), { name: 'Test (short rest)', current: 0, max: 2 }] };
        const r = P._rollHitDie(i);
        ok('party: a hit die heals and is spent', !!r && state.party[i].hitDice.current === 1 && state.party[i].hp === 5 + r.heal);
        P._applyShortRest(); await sleep(30);
        const tr = state.party[i].resources.find(x => x.name === 'Test (short rest)');
        ok('party: the party short rest still refreshes short-rest resources and drops concentration',
           tr && tr.current === 2 && !state.party[i].concentration);
      } catch(e){ ok('party: the rest checks ran to completion', false, e.message); }
      finally {
        _remoteUpdate = true;
        try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
        finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party'); P._render();
      }
    }

    // ── Handouts ──────────────────────────────────────────────────────────
    {
      const h0 = localStorage.getItem('skt-handouts-v1');
      try {
        openPanel('handouts'); await sleep(250);
        const H = panelDefs.handouts;
        ok('handouts: the panel is in the dock and opens', !!document.querySelector('.dock-btn[data-panel="handouts"]') && !!H._body);
        const cv = document.createElement('canvas'); cv.width = 40; cv.height = 30;
        const img = cv.toDataURL('image/jpeg', 0.7);
        const id = H.send({ title: 'Test letter', text: 'line one\nline two', img, to: 'all' });
        const d = JSON.parse(localStorage.getItem('skt-handouts-v1') || '{}');
        ok('handouts: sending stores it for the phones', !!id && d.list && d.list[0].id === id && d.list[0].img === img && d.list[0].to === 'all');
        ok('handouts: and lists it', !!H._body.querySelector('.ho-item[data-id="' + id + '"]'));
        ok('handouts: sending to no one is refused', H.send({ title: 'x', to: [] }) === false);
        const t0 = d.list[0].shownAt; await sleep(15); H.showAgain(id);
        ok('handouts: "Show again" re-announces it', JSON.parse(localStorage.getItem('skt-handouts-v1')).list[0].shownAt > t0);
      } catch(e){ ok('handouts: the checks ran to completion', false, e.message); }
      finally {
        if (h0 == null) localStorage.removeItem('skt-handouts-v1'); else localStorage.setItem('skt-handouts-v1', h0);
        closePanel('handouts');
      }
    }

    // ── A lowered maximum HP (Life Drain, Harm…) ─────────────────────────
    {
      // Earlier checks end the fight; start from the original data.
      _remoteUpdate = true;
      try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
      finally { _remoteUpdate = false; }
      loadDomain('combat'); loadDomain('party');
      openPanel('party'); openPanel('combat'); await sleep(400);
      panelDefs.party._render(); panelDefs.combat._render();
      const P = panelDefs.party;
      const i = state.party.findIndex(p => state.combatants.some(c => c.id === p.id));
      ok('max HP: a party member in the fight to test with', i >= 0);
      const z0 = i >= 0 ? JSON.parse(JSON.stringify(state.party[i])) : null;
      try {
        if (z0){
          state.party[i] = {...state.party[i], hp: z0.hpMax}; syncPartyToCombat(i); save(); P._render();
          P._reduceMaxHp(i, 8, 'Life Drain'); await sleep(150);
          const z = state.party[i], c = state.combatants.find(x => x.id === z.id);
          ok('max HP: reducing it lowers the max and pulls current HP down to it',
             z.hpMax === z0.hpMax - 8 && z.hpMaxNormal === z0.hpMax && z.hp === z.hpMax, JSON.stringify([z.hp, z.hpMax, z.hpMaxNormal]));
          ok('max HP: the combat card carries the same maximum', !!c && c.hpMax === z.hpMax && c.hpMaxNormal === z.hpMaxNormal);
          const card = P._body.querySelector('[data-cidx="' + i + '"]');
          ok('max HP: the party card shows the loss and a striped bar end',
             !!card.querySelector('.char-hpmax-loss') && card.querySelector('.char-hpmax-loss').textContent === '▼8' && !!card.querySelector('.hp-bar-lost'));
          ok('max HP: so does the combat card', !!panelDefs.combat._body.querySelector('.hp-maxloss-badge') && !!panelDefs.combat._body.querySelector('.card-hp-bar-lost'));
          const hpCell = panelDefs.combat._body.querySelector('.combatant-card[data-idx="' + state.combatants.indexOf(c) + '"] input[data-cf="hp"]');
          ok('max HP: without squeezing the HP number off the combat card', !!hpCell && hpCell.getBoundingClientRect().width >= 18,
             hpCell ? Math.round(hpCell.getBoundingClientRect().width) + 'px' : 'no field');
          panelDefs.combat._applyHpDelta(state.combatants.indexOf(c), +20, null); save();
          ok('max HP: healing stops at the lowered max', state.party[i].hp === state.party[i].hpMax);
          ok('max HP: the menu offers to restore it', /Restore max HP/.test(JSON.stringify((() => { let items = []; const sc = window.showContextMenu;
             window.showContextMenu = (x, y, it) => { items = it; }; try { P._body.querySelector('[data-act="actions-menu"][data-idx="' + i + '"]').click(); } finally { window.showContextMenu = sc; }
             return items.map(t => t.label); })())));
          P._longRestOne(state.party[i], i); save(); P._render(); await sleep(80);
          ok('max HP: a long rest puts it back', state.party[i].hpMax === z0.hpMax && state.party[i].hpMaxNormal === undefined
             && (state.combatants.find(x => x.id === z0.id) || {}).hpMaxNormal === undefined);
          P._reduceMaxHp(i, 5); await sleep(40);
          const inp = P._body.querySelector('input[data-field="hpMax"][data-idx="' + i + '"]');
          inp.value = String(z0.hpMax + 2); inp.dispatchEvent(new Event('change', { bubbles: true })); await sleep(40);
          ok('max HP: typing a max at or above the normal one ends the reduction',
             state.party[i].hpMax === z0.hpMax + 2 && state.party[i].hpMaxNormal === undefined);
        }
      } catch(e){
        ok('max HP: the checks ran to completion', false, e.message);
      } finally {
        if (z0){ state.party[i] = z0; syncPartyToCombat(i); save(); P._render(); }
      }
    }
    // ── Two people changing the same character at once ───────────────────
    // Each character, creature and token is one record. Both sides of a
    // collision used to resolve to one side's whole record, so the DM's
    // damage or the player's heal was lost. Now merged field by field, with
    // HP and temp HP combined as changes — at write time in a transaction,
    // and when an update lands inside our own unsent window.
    {
      const cache0 = JSON.stringify(_entityCache);
      const origSet0 = Storage.prototype.setItem;
      try {
        const KC='skt-combat-v1', KP='skt-party-v1', KM='skt-battlemap-v1';
        const KEYS=[KC,KP,KM];
        const nest=f=>{const t={};Object.keys(f).forEach(p=>{const [a,b]=p.split('/');if(b){(t[a]=t[a]||{})[b]=f[p];}else t[a]=f[p];});return t;};
        
        _patchLocalStorage();
        const START={}; KEYS.forEach(k=>START[k]=snapshot[k]);   // the original data, not whatever earlier checks left
        
        let server, deliver;
        function reset(){
          _remoteUpdate=true; try{ KEYS.forEach(k=>localStorage.setItem(k, START[k])); } finally{ _remoteUpdate=false; }
          KEYS.forEach(k=>{ try{ loadDomain(k==='skt-combat-v1'?'combat':k==='skt-party-v1'?'party':'x'); }catch(e){} });
          server={}; KEYS.forEach(k=>{ server[k]=Object.assign({}, _ENTITY_KEYS[k].explode(START[k])); _entityCache[k]=_ENTITY_KEYS[k].explode(START[k]); });
          _dirtyKeys.clear(); deliver=true;
          const bm=panelDefs.battlemap; if (bm && bm._body) bm.applyMapState(JSON.parse(START[KM]),{source:'test'});
        }
        const keyOf=path=>KEYS.find(k=>path.indexOf(_baseOf(_ENTITY_KEYS[k])+'/')===0);
        const emit=k=>{ if(deliver) _applyEntitySnapshot(k, nest(server[k])); };
        _fbDb={ goOffline(){}, goOnline(){}, ref(path){ return {
          update(u){ const ks=new Set(); Object.keys(u).forEach(p=>{ const k=keyOf(p); const n=p.slice(_baseOf(_ENTITY_KEYS[k]).length+1); ks.add(k);
              if(u[p]==null) delete server[k][n]; else server[k][n]=u[p]; }); setTimeout(()=>ks.forEach(emit),0); return Promise.resolve(); },
          transaction(fn){ const k=keyOf(path); const n=path.slice(_baseOf(_ENTITY_KEYS[k]).length+1);
              const v=fn(server[k][n]==null?null:server[k][n]);
              if(v===undefined) return Promise.resolve({committed:false});
              server[k][n]=v; setTimeout(()=>emit(k),0); return Promise.resolve({committed:true}); },
          set(){return Promise.resolve();}, remove(){return Promise.resolve();},
          once(){return Promise.resolve({exists:()=>false,val:()=>null});}, on(e,cb){return cb;}, off(){},
          onDisconnect(){return{remove(){return Promise.resolve();}};} }; } };
        
        // The phone: heal Zoey by `n`, the way its own _applyHpDelta would — both records.
        const zid='zoey';
        const phoneHeal=(n, opts)=>{
          const c=JSON.parse(server[KC]['items/'+zid]); c.hp=Math.min(c.hpMax||999, c.hp+n); server[KC]['items/'+zid]=JSON.stringify(c);
          const p=JSON.parse(server[KP]['items/'+zid]); p.hp=Math.min(p.hpMax||999, p.hp+n); server[KP]['items/'+zid]=JSON.stringify(p);
          if (!(opts&&opts.silent)){ emit(KC); emit(KP); }
        };
        const srvHp=k=>JSON.parse(server[k]['items/'+zid]).hp;
        const locHp=()=>({combat:(state.combatants.find(c=>c.id===zid)||{}).hp, party:(state.party.find(p=>p.id===zid)||{}).hp});
        const dmHit=n=>{ const C=panelDefs.combat; const i=state.combatants.findIndex(c=>c.id===zid); C._applyHpDelta(i,-n,null); save(); };
        
        
        openPanel('combat'); openPanel('battlemap'); await sleep(900);
        reset(); const hp0 = srvHp(KC);
        dmHit(10); phoneHeal(5, { silent: true }); await sleep(500);
        ok('merge: DM damage and a player heal at once both count (heal reached the server first)',
           srvHp(KC) === hp0 - 5 && srvHp(KP) === hp0 - 5 && locHp().combat === hp0 - 5, JSON.stringify({ hp0, combat: srvHp(KC), party: srvHp(KP) }));
        reset(); dmHit(10); phoneHeal(5); await sleep(500);
        ok('merge: and when the heal arrives while the DM is still saving',
           srvHp(KC) === hp0 - 5 && locHp().party === hp0 - 5, JSON.stringify({ combat: srvHp(KC), screen: locHp() }));
        reset();
        { const i = state.combatants.findIndex(c => c.id === zid);
          state.combatants[i].conditions = [...(state.combatants[i].conditions || []), 'poisoned']; save(); }
        phoneHeal(5, { silent: true }); await sleep(500);
        { const cz = JSON.parse(server[KC]['items/' + zid]);
          ok('merge: a condition and a heal made at once both stick', (cz.conditions || []).includes('poisoned') && cz.hp === hp0 + 5); }
        reset();
        { const C = panelDefs.combat; const i = state.combatants.findIndex(c => c.id === zid); C._applyHpDelta(i, +15, null); save(); }   // each heal fits under max; together they do not
        phoneHeal(20, { silent: true }); await sleep(500);
        { const cz = JSON.parse(server[KC]['items/' + zid]);
          ok('merge: two heals at once never overfill max HP', cz.hp === cz.hpMax, cz.hp + '/' + cz.hpMax); }
        reset();
        const T0 = JSON.parse(START[KM]).tokens.find(t => t.id === 'tk_zoey');
        { const bm = panelDefs.battlemap; const t = bm._tokens.find(x => x.id === 'tk_zoey'); t.size = 2; bm._saveMap();
          const sv = JSON.parse(server[KM]['tokens/tk_zoey']); sv.x += 100; server[KM]['tokens/tk_zoey'] = JSON.stringify(sv); }
        await sleep(500);
        { const t = JSON.parse(server[KM]['tokens/tk_zoey']);
          ok('merge: a token resized and moved at once keeps both', t.size === 2 && t.x === T0.x + 100); }
        reset();
        { const bm = panelDefs.battlemap; const t = bm._tokens.find(x => x.id === 'tk_zoey'); t.y += 40; bm._saveMap();   // DM: straight down
          const sv = JSON.parse(server[KM]['tokens/tk_zoey']); sv.x += 100; server[KM]['tokens/tk_zoey'] = JSON.stringify(sv); }
        await sleep(500);
        { const t = JSON.parse(server[KM]['tokens/tk_zoey']);
          ok('merge: a token two people moved lands at one of their positions, not a mix', t.x === T0.x && t.y === T0.y + 40, t.x + ',' + t.y); }   // the player went sideways; one move wins whole
        reset(); dmHit(3); delete server[KC]['items/' + zid]; await sleep(500);
        ok('merge: a late edit does not bring back a creature someone removed', !(('items/' + zid) in server[KC]));
        reset(); deliver = false;
      } catch(e){
        ok('merge: the checks ran to completion', false, e.message);
      } finally {
        Storage.prototype.setItem = origSet0;
        _fbDb = null; _dirtyKeys.clear(); clearTimeout(_pushTimer);
        Object.keys(_entityCache).forEach(k => delete _entityCache[k]);
        Object.assign(_entityCache, JSON.parse(cache0));
        closePanel('battlemap');
      }
    }
  }

  // ══════════════════════════════════════════════════════════ player view
  if (MODE === 'player'){
    ok('player: body is in player mode', document.body.classList.contains('player-mode'));

    // ── Notes: a player sees only what the DM shares ──────────────────────
    // With Dropbox configured — which in production is EVERY device, the
    // token ships to all of them — a player got the DM's whole note tree,
    // any note readable with one click ("DM only - the traitor" included), a
    // working editor, and write-through to the DM's Dropbox. This suite never
    // saw it because ?nosync=1 makes Dropbox report "not configured", so the
    // player sat on a harmless picker. Dropbox is faked ON here for that
    // reason, with every write replaced and the network refused.
    if (typeof paTab !== 'undefined' && typeof paRender === 'function' && panelDefs.notes){
      const ds = window.dropboxSync;
      const real = ds ? { cfg: ds.isConfigured, push: ds.pushFile, mv: ds.movePath, del: ds.deletePath } : null;
      const rf = window.fetch;
      const N0 = localStorage.getItem('skt-notes-v2'), S0 = (state.sharedPanels || []).slice(), tab0 = paTab;
      let pushed = 0;
      window.fetch = function(i, o){ if (/dropbox/i.test(String((i && i.url) || i))) return Promise.reject(new TypeError('blocked by selftest')); return rf.apply(this, arguments); };
      if (ds){ ds.isConfigured = () => true; ds.pushFile = () => { pushed++; }; ds.movePath = () => { pushed++; }; ds.deletePath = () => { pushed++; }; }
      const setShared = ids => {
        const d = JSON.parse(localStorage.getItem('skt-notes-v2') || '{"items":[]}');
        d.items.forEach(i => { i.shared = ids.includes(i.id); });
        localStorage.setItem('skt-notes-v2', JSON.stringify(d));
      };
      const N = panelDefs.notes;
      const show = async () => {
        if (N._body){ N._data = null; N.mount(N._body); } else { paTab = 'notes'; paRender(); }
        await sleep(350);
        return N._body ? N._body.textContent : '';
      };
      try {
        state.sharedPanels = ['notes'];
        setShared([]);
        paTab = 'notes'; paRender(); await sleep(400);
        let t = N._body ? N._body.textContent : '';
        ok('notes/player: a player never gets the DM’s Dropbox view', N._view === 'player', String(N._view));
        ok('notes/player: with nothing shared, no DM note is visible',
           !/traitor|innkeeper|reached the gate|contingency/i.test(t), t.replace(/\s+/g, ' ').slice(0, 90));
        ok('notes/player: and no tree of the DM’s notes', N._body.querySelectorAll('.notes-tree-row').length === 0);

        setShared(['n_open']);
        t = await show();
        ok('notes/player: a shared note is shown', /reached the gate/.test(t));
        ok('notes/player: an unshared DM-only note is not', !/traitor|innkeeper/i.test(t));
        ok('notes/player: it is read-only',
           !N._body.querySelector('#note-edit-area, textarea, [contenteditable="true"]'));
        const line = N._body.querySelector('.nl'); if (line) line.click();
        await sleep(120);
        ok('notes/player: clicking the text does not open an editor', !N._body.querySelector('textarea'));
        ok('notes/player: a player’s phone writes nothing to the DM’s Dropbox', pushed === 0, pushed + ' writes');
      } finally {
        window.fetch = rf;
        if (ds && real){ ds.isConfigured = real.cfg; ds.pushFile = real.push; ds.movePath = real.mv; ds.deletePath = real.del; }
        if (N0 != null) localStorage.setItem('skt-notes-v2', N0);
        state.sharedPanels = S0; paTab = tab0;
        if (N._body){ N._data = null; N.mount(N._body); }
        paRender();
      }
      // ── No floating toolbar on a phone, and nothing reserved for it ───────
      // The phone player view hides the toolbar. The turn bar reserved room for
      // it by measuring it — and a hidden element measures as a zero box at
      // left 0, so the reservation became the WHOLE screen width and '5 turns
      // until you' wrapped one word per line. Checked by hiding the toolbar here
      // (this pass is desktop-sized, so the phone rule itself can't apply).
      if (typeof _updatePlayerViewportVars === 'function'){
        const ft = document.getElementById('float-toolbar');
        const d0 = ft ? ft.style.display : '';
        try {
          if (ft) ft.style.display = 'none';
          _updatePlayerViewportVars();
          const rv = getComputedStyle(document.documentElement).getPropertyValue('--pv-topright').trim();
          ok('phone: a hidden toolbar reserves no room in the turn bar', rv === '0px', rv);
        } finally { if (ft) ft.style.display = d0; _updatePlayerViewportVars(); }
        let css = '';
        try { css = await (await fetch('styles/main.css', { cache: 'no-store' })).text(); } catch(e){}
        ok('phone: the player view hides the floating toolbar on a phone',
           css.indexOf('body.player-mode .float-toolbar{display:none !important}') >= 0);
      }

      // ── A lowered maximum HP, on the player's own screen ──────────────────
      {
        const me0 = localStorage.getItem('skt-me-v1'), tab0 = paTab;
        const pi = (state.party || []).findIndex(p => p.hpMax > 10);
        const p0 = pi >= 0 ? JSON.parse(JSON.stringify(state.party[pi])) : null;
        try {
          if (p0){
            state.party[pi] = sktReduceMaxHp(state.party[pi], 6, 'Life Drain');
            if (typeof syncPartyToCombat === 'function') syncPartyToCombat(pi);
            paSetPc(p0.id); paTab = 'you'; paRender();
            const line = document.querySelector('.pa-hp-loss');
            ok('player: a lowered max HP is explained on the You screen',
               !!line && /lowered by 6/.test(line.textContent) && /long rest/.test(line.textContent) && /Life Drain/.test(line.textContent));
            ok('player: and the bar shows the part that was taken', !!document.querySelector('.pa-hp-bar .pa-hp-lost'));
          }
        } catch(e){ ok('player: the max HP checks ran to completion', false, e.message); }
        finally {
          if (p0){ state.party[pi] = p0; if (typeof syncPartyToCombat === 'function') syncPartyToCombat(pi); }
          paTab = tab0; if (me0 == null) localStorage.removeItem('skt-me-v1'); else localStorage.setItem('skt-me-v1', me0);
          paRender();
        }
      }
      // ── The player's own bookkeeping ──────────────────────────────────────
      {
        const p0 = localStorage.getItem('skt-party-v1'), me0 = localStorage.getItem('skt-me-v1'), tab0 = paTab;
        try {
          const i = state.party.findIndex(p => p.sheet && p.sheet.spellSlots && Object.keys(p.sheet.spellSlots).length && (p.resources || []).length);
          if (i >= 0){
            state.party[i] = { ...state.party[i], exhaustion: 2, hp: Math.max(1, (state.party[i].hpMax || 20) - 15), concentration: null,
              hitDice: { current: 3, max: 6, dieType: 'd8' } };
            save();
            paSetPc(state.party[i].id); paTab = 'you'; paRender();
            const P = () => state.party[i];
            const r0 = P().resources[0].current;
            const lit = document.querySelector('[data-pa-res="0"]:not(.off)');
            ok('player: a resource pip is a button', !!lit);
            lit && lit.click(); await sleep(15);
            ok('player: tapping a lit pip spends one, and only one', P().resources[0].current === r0 - 1);
            document.querySelector('[data-pa-res="0"].off').click(); await sleep(15);
            ok('player: tapping an empty pip gives one back', P().resources[0].current === r0);
            const lvl = Object.keys(P().sheet.spellSlots).find(k => (P().sheet.spellSlots[k].total || 0) > (P().sheet.spellSlots[k].expended || 0));
            const e0 = P().sheet.spellSlots[lvl].expended || 0;
            document.querySelector('[data-pa-slot="' + lvl + '"]:not(.off)').click(); await sleep(15);
            ok('player: tapping a spell slot spends it', (P().sheet.spellSlots[lvl].expended || 0) === e0 + 1);
            document.querySelector('[data-pa-slot="' + lvl + '"].off').click(); await sleep(15);
            ok('player: and tapping it again gets it back', (P().sheet.spellSlots[lvl].expended || 0) === e0);
            document.querySelector('[data-pa-rest="open"]').click(); await sleep(20);
            const hp0 = P().hp;
            document.querySelector('#pa-rest [data-rest="spend"]').click(); await sleep(20);
            ok('player: a short rest spends a hit die and heals', P().hitDice.current === 2 && P().hp > hp0);
            state.party[i] = { ...P(), concentration: 'Bless', resources: [...P().resources, { name: 'Probe (short rest)', current: 0, max: 1 }] };
            document.querySelector('#pa-rest [data-rest="finish"]').click(); await sleep(20);
            const pr = P().resources.find(x => x.name === 'Probe (short rest)');
            ok('player: finishing it refreshes short-rest resources and ends concentration', !!pr && pr.current === 1 && !P().concentration && !document.getElementById('pa-rest'));
            paRender();
            ok('player: a caster can set concentration', !!document.querySelector('[data-pa-conc="set"]'));
            paSetConcentration('Hex'); await sleep(15);
            ok('player: concentration shows and is on the character', P().concentration === 'Hex' && /Hex/.test((document.querySelector('.pa-conc') || {}).textContent || ''));
            document.querySelector('[data-pa-conc="drop"]').click(); await sleep(15);
            ok('player: and can be dropped', !P().concentration);
            paRender();
            const ex = document.querySelector('[data-pa-cond="Exhaustion"]');
            ok('player: exhaustion shows with its level', !!ex && /Exhaustion 2/.test(ex.textContent));
            ex && ex.click(); await sleep(20);
            ok('player: and tapping it explains it', /Level 2 of 6/.test((document.querySelector('.pa-conddet') || {}).textContent || ''));
          }
        } catch(e){ ok('player: the bookkeeping checks ran to completion', false, e.message); }
        finally {
          document.getElementById('pa-rest')?.remove(); paCondOpen = null;
          if (p0 != null) localStorage.setItem('skt-party-v1', p0); loadDomain('party');
          if (me0 == null) localStorage.removeItem('skt-me-v1'); else localStorage.setItem('skt-me-v1', me0);
          paTab = tab0; paRender();
        }
      }

      // -- Who is connected, from a phone -----------------------------------
      if (paIsPhone()) {
        const tab0 = paTab;
        try {
          sktPresenceSeed({ zz: { ts: Date.now(), who: 'DM', kind: 'laptop', sig: sktPresenceSignature() } });
          paTab = 'more'; paRender(); await sleep(150);
          const row = document.querySelector('[data-more="devices"]');
          ok('player: More says who else is connected', !!row && /2 devices/.test(row.textContent), row && row.textContent.trim());
          row.click(); await sleep(80);
          const ov = document.getElementById('pa-devices');
          ok('player: and opens the same list the DM sees',
             !!ov && /DM/.test(ov.textContent) && ov.querySelectorAll('.pres-row').length === 2);
          ov.querySelector('[data-dev="close"]').click(); await sleep(40);
          ok('player: closing it puts it away', !document.getElementById('pa-devices'));
        } catch(e){ ok('player: the who-is-connected checks ran to completion', false, e.message); }
        finally {
          document.getElementById('pa-devices')?.remove();
          sktPresenceSeed({}); paTab = tab0; paRender();
        }
      }

      // -- Undo on a phone ---------------------------------------------------
      {
        const p0 = localStorage.getItem('skt-party-v1'), tab0 = paTab;
        try {
          if (paMyIdx() < 0 && state.party.length) paSetPc(state.party[0].id);
          const mi = paMyIdx();
          if (mi >= 0){
            state.party[mi] = { ...state.party[mi], hp: Math.max(10, Math.round((state.party[mi].hpMax || 20) / 2)) };
            save();
            paTab = 'you'; paRender(); await sleep(120);
            const hp = () => { const c = paCombatant(); return c ? c.hp : paPc().hp; };
            const before = hp();
            document.getElementById('pa-hp-amt').value = '6';
            document.querySelector('[data-pa-hp="-1"]').click(); await sleep(80);
            ok('player: damage on a phone lands', hp() === before - 6, JSON.stringify({ before, now: hp() }));
            const act = [...document.querySelectorAll('.toast-item .toast-action')].pop();
            ok('player: with an Undo on the toast', !!act && act.textContent === 'Undo');
            act.click(); await sleep(80);
            ok('player: which puts the hit points back', hp() === before, hp());
          }
        } catch(e){ ok('player: the phone undo checks ran to completion', false, e.message); }
        finally {
          if (p0 != null){
            _remoteUpdate = true;
            try { localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
            loadDomain('party');
          }
          paTab = tab0; paRender();
        }
      }

      // -- "Make a DEX save" on this phone ----------------------------------
      {
        const req0 = localStorage.getItem('skt-savereq-v1');
        try {
          const me = paMe().pcId || (state.party[0] || {}).id;
          if (!paMe().pcId) paSetPc(me);
          const ask = (o) => {
            localStorage.setItem('skt-savereq-v1', JSON.stringify(Object.assign({
              id: 'sr_t' + Math.random().toString(36).slice(2, 7), askedAt: Date.now(),
              ab: 'DEX', dc: 15, showDc: true, name: 'Fireball', pcs: [me], answers: {}, closed: false,
            }, o || {})));
            paOnSaveRequest();
          };
          ask(); await sleep(80);
          const card = () => document.getElementById('pa-save');
          ok('player: a save the DM called for pops up', !!card());
          ok('player: it names the ability and this character’s bonus',
             /Dexterity saving throw/.test(card().textContent)
             && /bonus/.test(card().textContent), card().textContent.slice(0, 60));
          ok('player: and the number to beat, when the DM says so',
             /beat/.test(card().textContent) && /15/.test(card().textContent));
          card().querySelector('[data-pa-save="roll"]').click(); await sleep(50);
          const line = card().querySelector('#pa-save-dice').textContent;
          ok('player: rolling shows the dice and whether it made it',
             /d20 \(\d+\)/.test(line) && /(made it|missed it)/.test(line), line);
          const typed = parseInt(card().querySelector('#pa-save-val').value, 10);
          card().querySelector('[data-pa-save="send"]').click(); await sleep(80);
          const r = JSON.parse(localStorage.getItem('skt-savereq-v1'));
          ok('player: sending files the total under this character',
             r.answers[me] && r.answers[me].v === typed && r.answers[me].rid === r.id);
          ok('player: and the pop-up goes away', !document.getElementById('pa-save'));
          // A table that keeps the DC to itself.
          ask({ showDc: false }); await sleep(80);
          ok('player: with the DC kept back, it just asks for the roll',
             !!card() && !/beat/.test(card().textContent));
          card().querySelector('[data-pa-save="dis"]').click(); await sleep(50);
          ok('player: disadvantage keeps the lower of two',
             /2d20 \((\d+), (\d+)\) keep/.test(card().querySelector('#pa-save-dice').textContent),
             card().querySelector('#pa-save-dice').textContent);
          ok('player: and says nothing about making it',
             !/(made it|missed it)/.test(card().querySelector('#pa-save-dice').textContent));
          // Somebody else's save is none of this phone's business.
          ask({ pcs: ['not-this-character'] }); await sleep(80);
          ok('player: a save asked of another character does not pop up here', !card());
          // Neither is one the DM has already closed.
          ask({ closed: true }); await sleep(60);
          ok('player: nor one the DM has closed', !card());
        } catch(e){ ok('player: the saving-throw checks ran to completion', false, e.message); }
        finally {
          document.getElementById('pa-save')?.remove();
          _remoteUpdate = true;
          try { if (req0 == null) localStorage.removeItem('skt-savereq-v1'); else localStorage.setItem('skt-savereq-v1', req0); }
          finally { _remoteUpdate = false; }
        }
      }

      // -- A word meant for this phone --------------------------------------
      {
        const ho0 = localStorage.getItem('skt-handouts-v1');
        try {
          const me = paMe().pcId;
          const mk = to => ({ list: [{ id: 'w_t', title: 'A word from the DM', text: 'The innkeeper is lying.',
                                       img: null, to, ts: Date.now(), shownAt: Date.now(), whisper: true }] });
          localStorage.setItem('skt-handouts-v1', JSON.stringify(mk(['someone-else'])));
          paOnHandouts(); await sleep(80);
          ok('player: a whisper for someone else never shows here',
             !document.getElementById('pa-handout') && paMyHandouts().length === 0);
          localStorage.setItem('skt-handouts-v1', JSON.stringify(mk([me])));
          paOnHandouts(); await sleep(120);
          const ov = document.getElementById('pa-handout');
          ok('player: one meant for this character pops up',
             !!ov && /The innkeeper is lying/.test(ov.textContent));
          ok('player: and says it is for them alone', !!ov && /For you alone/.test(ov.textContent));
          ov.querySelector('.pa-ho-close').click(); await sleep(60);
          ok('player: closing it leaves it in their handouts', !document.getElementById('pa-handout')
             && paMyHandouts().length === 1);
        } catch(e){ ok('player: the whisper checks ran to completion', false, e.message); }
        finally {
          document.getElementById('pa-handout')?.remove();
          _remoteUpdate = true;
          try { if (ho0 == null) localStorage.removeItem('skt-handouts-v1'); else localStorage.setItem('skt-handouts-v1', ho0); }
          finally { _remoteUpdate = false; }
          paRender();
        }
      }

      // -- What a player's map does and does not show -----------------------
      {
        const tab0 = paTab, mode0 = state.settings.monsterStatsMode;
        const bm = panelDefs.battlemap;
        let tok = null;
        try {
          paTab = 'map'; paRender(); await sleep(800);
          if (bm._body){
            tok = bm._tokens.find(t => t.isPC && bm._combatantFor(t));
            const el = () => document.querySelector('.map-token[data-tid="' + (tok || {}).id + '"]');
            ok('player: a character token is on the map', !!tok && !!el());
            const c = bm._combatantFor(tok), i = state.combatants.findIndex(x => x.id === c.id);
            const hp0 = c.hp;
            state.combatants[i] = { ...c, hp: Math.ceil((c.hpMax || 20) * 0.3) };
            save(); await sleep(150);
            ok('player: a hurt character wears the ring here too',
               /wound-/.test((el() || {}).className || ''), (el() || {}).className);
            tok.hidden = true; bm._renderTokens(); await sleep(80);
            ok('player: a hidden token is not on their screen at all', !el()
               && !document.querySelector('.map-token-name[data-tid="' + tok.id + '"]'));
            tok.hidden = false; bm._renderTokens(); await sleep(60);
            ok('player: revealed, it is back', !!el());
            state.combatants[i] = { ...state.combatants[i], hp: hp0 }; save();
            // A monster's ring is the health tier in another form, so it
            // follows the same setting.
            const mt = bm._tokens.find(t => !t.isPC && bm._combatantFor(t));
            if (mt){
              const m = bm._combatantFor(mt), j = state.combatants.findIndex(x => x.id === m.id);
              const mhp = m.hp;
              state.combatants[j] = { ...m, hp: Math.ceil((m.hpMax || 20) * 0.4) };
              save(); await sleep(60);
              state.settings.monsterStatsMode = 'show';
              ok('player: a hurt monster wears one', !!bm._woundOf(mt), bm._woundOf(mt));
              state.settings.monsterStatsMode = 'conceal';
              ok('player: concealed stats still allow the ring — it is a tier, not a number',
                 !!bm._woundOf(mt) && !/\d+\/\d+/.test(bm._tokenTitle(mt)), bm._tokenTitle(mt));
              state.settings.monsterStatsMode = 'hide';
              ok('player: hidden stats take the ring away too',
                 bm._woundOf(mt) === '' && bm._tokenTitle(mt) === m.name, bm._tokenTitle(mt));
              state.combatants[j] = { ...state.combatants[j], hp: mhp };
            }
          }
        } catch(e){ ok('player: the map visibility checks ran to completion', false, e.message); }
        finally {
          if (tok) tok.hidden = false;
          state.settings.monsterStatsMode = mode0;
          _remoteUpdate = true;
          try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
          finally { _remoteUpdate = false; }
          loadDomain('combat'); loadDomain('party');
          paTab = tab0; paRender(); await sleep(100);
        }
      }

      // -- A player window on the DM's own laptop ---------------------------
      // No Firebase between two tabs of one browser: what links them is the
      // `storage` event. The map and the fight always rode it; the pop-ups
      // did not, so a player window beside the DM's never saw a save, an
      // initiative call or a handout unless the internet carried it round.
      {
        const req0 = localStorage.getItem('skt-savereq-v1'), ho0 = localStorage.getItem('skt-handouts-v1');
        try {
          const me = paMe().pcId || (state.party[0] || {}).id;
          if (!paMe().pcId) paSetPc(me);
          document.getElementById('pa-save')?.remove();
          const v = JSON.stringify({ id: 'sr_relay', askedAt: Date.now(), ab: 'WIS', dc: 13, showDc: true,
                                     name: '', pcs: [me], answers: {}, closed: false });
          localStorage.setItem('skt-savereq-v1', v);
          window.dispatchEvent(new StorageEvent('storage', { key: 'skt-savereq-v1', newValue: v }));
          await sleep(60);
          ok('player: a save asked from another tab pops up here', !!document.getElementById('pa-save'));
          document.getElementById('pa-save')?.remove();
          const h = JSON.stringify({ list: [{ id: 'w_relay', title: 'A word from the DM', text: 'Psst.', img: null,
                                              to: [me], ts: Date.now(), shownAt: Date.now(), whisper: true }] });
          localStorage.setItem('skt-handouts-v1', h);
          window.dispatchEvent(new StorageEvent('storage', { key: 'skt-handouts-v1', newValue: h }));
          await sleep(80);
          ok('player: so does a whisper', !!document.getElementById('pa-handout')
             && /Psst/.test(document.getElementById('pa-handout').textContent));
        } catch(e){ ok('player: the same-laptop relay checks ran to completion', false, e.message); }
        finally {
          document.getElementById('pa-save')?.remove();
          document.getElementById('pa-handout')?.remove();
          _remoteUpdate = true;
          try {
            if (req0 == null) localStorage.removeItem('skt-savereq-v1'); else localStorage.setItem('skt-savereq-v1', req0);
            if (ho0 == null) localStorage.removeItem('skt-handouts-v1'); else localStorage.setItem('skt-handouts-v1', ho0);
          } finally { _remoteUpdate = false; }
          paRender();
        }
      }

      // -- The update prompt on a phone sits clear of the tabs --------------
      if (paIsPhone()) {
        try {
          document.getElementById('toast-host')?.remove();
          showToast('A new version is available.', { sticky: true, action: { label: 'Reload', run: () => {} } });
          await sleep(300);
          const a = document.querySelector('.toast-item.sticky').getBoundingClientRect();
          const b = document.querySelector('.pa-tabs').getBoundingClientRect();
          ok('phone: the update prompt leaves the tab bar usable', a.bottom <= b.top + 1,
             Math.round(a.bottom) + ' vs ' + Math.round(b.top));
        } catch(e){ ok('phone: the update prompt check ran to completion', false, e.message); }
        finally { document.getElementById('toast-host')?.remove(); }
      }

      // -- A player builds their own character -------------------------------
      {
        const p0 = localStorage.getItem('skt-party-v1'), me0 = localStorage.getItem('skt-me-v1');
        try {
          localStorage.removeItem('skt-me-v1'); paRender(); await sleep(80);
          const btn = document.querySelector('[data-pa-build="new"]');
          ok('player: the character picker offers to build one', !!btn);
          btn.click(); await sleep(400);
          ok('player: the builder opens over the phone', !!document.getElementById('cb-root'));
          // Fill it in directly — the DM-side checks drive every control.
          Object.assign(CB.build, { name: 'Phoned', species: 'Human', cls: 'Rogue', background: 'Criminal',
            skills: ['acrobatics', 'perception', 'insight', 'investigation'], speciesSkills: ['athletics'],
            expertise: ['stealth', 'perception'], masteries: ['dagger', 'shortbow'], originFeat: 'Alert' });
          CB.step = 'review'; cbRender(); await sleep(60);
          document.querySelector('#cb-root [data-cb="save"]').click(); await sleep(300);
          // Unfinished choices ask first; confirm the dialog if it appeared.
          const okBtn = [...document.querySelectorAll('.modal-backdrop button')].find(b => /Save anyway/.test(b.textContent));
          if (okBtn){ okBtn.click(); await sleep(300); }
          const pc = state.party.find(p => p.name === 'Phoned');
          ok('player: creating it adds it to the party', !!pc);
          ok('player: and this phone becomes that character', !!pc && paMe().pcId === pc.id && paTab === 'you');
          ok('player: with a Level up button on its own sheet', !!document.querySelector('[data-pa-build="levelup"]'));
          ok('player: its actions come from the builder, not from parsed text',
             Array.isArray(pc.sheet.activations) && paActivations(pc) === pc.sheet.activations);
        } catch(e){ ok('player: the build-your-own checks ran to completion', false, e.message); }
        finally {
          document.getElementById('cb-root')?.remove(); if (typeof CB !== 'undefined') CB = null;
          document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
          _remoteUpdate = true;
          try {
            if (p0 != null) localStorage.setItem('skt-party-v1', p0);
            if (me0 == null) localStorage.removeItem('skt-me-v1'); else localStorage.setItem('skt-me-v1', me0);
          } finally { _remoteUpdate = false; }
          loadDomain('party'); paRender();
        }
      }

      // ── "Roll initiative!" on this phone ──────────────────────────────────
      {
        const r0 = localStorage.getItem('skt-initreq-v1'), me0 = localStorage.getItem('skt-me-v1'), tab0 = paTab;
        try {
          const pc = (state.combatants || []).find(c => c.isPC && state.party.some(p => p.id === c.id));
          const other = (state.party || []).find(p => !pc || p.id !== pc.id);
          if (pc && other){
            paSetPc(pc.id); paTab = 'you'; paRender();
            _applyRemoteKey('skt-initreq-v1', JSON.stringify({ id: 'ir_t', askedAt: Date.now(), pcs: [pc.id], answers: {}, closed: false })); await sleep(50);
            const ov = document.getElementById('pa-init');
            ok('player: asked for initiative, the phone pops it up with the bonus', !!ov && /bonus/.test(ov.textContent));
            ov.querySelector('[data-pa-init="roll"]').click(); await sleep(15);
            const v = parseInt(document.getElementById('pa-init-val').value, 10), bonus = paInitBonus(pc.id);
            ok('player: "Roll for me" rolls d20 plus the bonus', v >= 1 + bonus && v <= 20 + bonus, v + ' / ' + bonus);
            const val = document.getElementById('pa-init-val'); val.value = '17'; val.dispatchEvent(new Event('input'));
            ov.querySelector('[data-pa-init="send"]').click(); await sleep(40);
            const after = JSON.parse(localStorage.getItem('skt-initreq-v1'));
            ok('player: sending answers the request and sets the combatant',
               after.answers[pc.id] && after.answers[pc.id].v === 17 && after.answers[pc.id].rid === 'ir_t'
               && +state.combatants.find(c => c.id === pc.id).initiative === 17 && !document.getElementById('pa-init'));
            _applyRemoteKey('skt-initreq-v1', JSON.stringify(after) + ' '); await sleep(30);
            ok('player: and it does not come back once answered', !document.getElementById('pa-init'));
            paSetPc(other.id);
            _applyRemoteKey('skt-initreq-v1', JSON.stringify({ id: 'ir_t2', askedAt: Date.now(), pcs: [pc.id], answers: {}, closed: false })); await sleep(30);
            ok('player: a character not in the fight gets no pop-up', !document.getElementById('pa-init'));
            paSetPc(pc.id);
            _applyRemoteKey('skt-initreq-v1', JSON.stringify({ id: 'ir_t3', askedAt: Date.now(), pcs: [pc.id], answers: {}, closed: false })); await sleep(30);
            const up = !!document.getElementById('pa-init');
            _applyRemoteKey('skt-initreq-v1', JSON.stringify({ id: 'ir_t3', askedAt: Date.now(), pcs: [pc.id], answers: {}, closed: true })); await sleep(30);
            ok('player: the DM closing the request takes the pop-up down', up && !document.getElementById('pa-init'));
          }
        } catch(e){ ok('player: the initiative checks ran to completion', false, e.message); }
        finally {
          document.getElementById('pa-init')?.remove();
          if (r0 == null) localStorage.removeItem('skt-initreq-v1'); else localStorage.setItem('skt-initreq-v1', r0);
          if (me0 == null) localStorage.removeItem('skt-me-v1'); else localStorage.setItem('skt-me-v1', me0);
          paTab = tab0; paRender();
        }
      }

      // ── A handout reaching this phone ─────────────────────────────────────
      {
        const h0 = localStorage.getItem('skt-handouts-v1'), s0 = localStorage.getItem('skt-ho-seen-v1');
        const me0 = localStorage.getItem('skt-me-v1'), tab0 = paTab;
        try {
          const pc = (state.party || [])[0], other = (state.party || [])[1];
          if (pc && other){
            paSetPc(pc.id); paTab = 'you'; paRender();
            localStorage.removeItem('skt-ho-seen-v1');
            const now = Date.now();
            const payload = JSON.stringify({ list: [
              { id: 'ho_t1', title: 'For everyone', text: 'a\nb', img: null, to: 'all', ts: now, shownAt: now },
              { id: 'ho_t2', title: 'Not yours', text: 'secret', img: null, to: [other.id], ts: now, shownAt: now - 5 },
              { id: 'ho_t3', title: 'Last week', text: 'old', img: null, to: 'all', ts: now - 864e5, shownAt: now - 864e5 } ] });
            _applyRemoteKey('skt-handouts-v1', payload); await sleep(60);
            const pop = document.getElementById('pa-handout');
            ok('player: a new handout pops up', !!pop && /For everyone/.test(pop.textContent) && /<br>/.test(pop.innerHTML));
            ok('player: a Handouts tab appears', paVisibleTabs().some(t => t.id === 'handouts'));
            pop && pop.querySelector('.pa-ho-close').click(); await sleep(20);
            _applyRemoteKey('skt-handouts-v1', payload + ' '); await sleep(40);
            ok('player: and does not pop up again once closed', !document.getElementById('pa-handout'));
            paTab = 'handouts'; paRender();
            const titles = [...document.querySelectorAll('.pa-ho-item b')].map(b => b.textContent);
            ok('player: the tab lists theirs, not anyone else', titles.includes('For everyone') && titles.includes('Last week') && !titles.includes('Not yours'));
          }
        } catch(e){ ok('player: the handout checks ran to completion', false, e.message); }
        finally {
          document.getElementById('pa-handout')?.remove();
          if (h0 == null) localStorage.removeItem('skt-handouts-v1'); else localStorage.setItem('skt-handouts-v1', h0);
          if (s0 == null) localStorage.removeItem('skt-ho-seen-v1'); else localStorage.setItem('skt-ho-seen-v1', s0);
          if (me0 == null) localStorage.removeItem('skt-me-v1'); else localStorage.setItem('skt-me-v1', me0);
          paTab = tab0; paRender();
        }
      }

      // ── A condition says what it does ─────────────────────────────────────
      {
        const me0 = localStorage.getItem('skt-me-v1'), tab0 = paTab;
        const cc = (state.combatants || []).find(c => c.isPC && (c.conditions || []).length && state.party.some(p => p.id === c.id));
        try {
          if (cc){
            for (let i = 0; i < 50 && !(typeof _5eLoaded !== 'undefined' && _5eLoaded); i++) await sleep(200);
            paSetPc(cc.id); paTab = 'you'; paRender();
            const chip = document.querySelector('[data-pa-cond]');
            ok('player: a condition is a button', !!chip && chip.tagName === 'BUTTON');
            chip && chip.click(); await sleep(80);
            const det = document.querySelector('.pa-conddet');
            ok('player: tapping it shows the rule text',
               !!det && det.textContent.replace(/\s+/g, ' ').length > 80, det ? det.textContent.slice(0, 80) : 'nothing opened');
            document.querySelector('[data-pa-condclose]')?.click(); await sleep(50);
            ok('player: and ✕ closes it', !document.querySelector('.pa-conddet'));
            const heads = [...document.querySelectorAll('.pa-sec h4')].map(h => h.textContent.trim());
            const pc = state.party.find(p => p.id === cc.id);
            if (pc && pc.sheet && pc.sheet.spellSlots && Object.keys(pc.sheet.spellSlots).length)
              ok('player: spell slots have their own heading', heads.includes('Spell slots'), heads.join(','));
          }
        } catch(e){
          ok('player: the condition checks ran to completion', false, e.message);
        } finally {
          paCondOpen = null; paTab = tab0;
          if (me0 == null) localStorage.removeItem('skt-me-v1'); else localStorage.setItem('skt-me-v1', me0);
          paRender();
        }
      }

      // ── No campaign switcher for players ──────────────────────────────────
      // campaign-ui.js meant to remove it, but checked body.player-mode before
      // initPlayerView() had added it, so every player got the switcher.
      {
        const chip = document.getElementById('campaign-btn');
        ok('player: no campaign switcher', !chip || getComputedStyle(chip).display === 'none');
        ok('player: and none in the settings drawer', !document.getElementById('drawer-campaign'));
      }

      // ── "Your turn" arrives with a buzz and a banner ──────────────────────
      // Once, when the turn changes to you — not on every redraw while it
      // stays yours — and a lighter "up next" one turn earlier.
      if (typeof paTurnAlert === 'function' && (state.combatants || []).length > 2){
        const S0 = state.sharedPanels, A0 = state.activeCombatantId, me0 = localStorage.getItem('skt-me-v1');
        const vib0 = navigator.vibrate, toast0 = window.showToast;
        const vib = [], toasts = [];
        try {
          navigator.vibrate = p => { vib.push(p); return true; };
          window.showToast = m => { toasts.push(m); };
          if (!(state.sharedPanels || []).includes('combat')) state.sharedPanels = [...(state.sharedPanels || []), 'combat'];
          const list = state.combatants;
          const mine = list.find(c => c.isPC && (state.party || []).some(p => p.id === c.id));
          paSetPc(mine.id);
          const zi = list.indexOf(mine), at = k => list[(zi - k + list.length) % list.length].id;
          state.activeCombatantId = at(2); paRender();
          state.activeCombatantId = at(1); paRender();
          ok('player: a heads-up the turn before yours',
             toasts.includes("You're up next") && vib.length === 1, JSON.stringify({ toasts, vib }));
          state.activeCombatantId = mine.id; paRender();
          const ban = document.getElementById('pa-turn-alert');
          ok('player: your turn buzzes and puts up a banner',
             !!ban && vib.length === 2 && /Your turn/.test(ban.textContent));
          ok('player: and lights up the turn strip', document.getElementById('pa-turn').classList.contains('mine'));
          paRender(); paRender();
          ok('player: a redraw during your turn does not re-announce it', vib.length === 2, JSON.stringify(vib));
          ban && ban.click();
          ok('player: tapping the banner closes it', !document.getElementById('pa-turn-alert'));
          state.activeCombatantId = at(-1); paRender();
          ok('player: the strip goes back to normal when your turn ends',
             !document.getElementById('pa-turn').classList.contains('mine'));
        } catch(e){
          ok('player: the turn-alert checks ran to completion', false, e.message);
        } finally {
          navigator.vibrate = vib0; window.showToast = toast0;
          state.sharedPanels = S0; state.activeCombatantId = A0;
          if (me0 == null) localStorage.removeItem('skt-me-v1'); else localStorage.setItem('skt-me-v1', me0);
          if (typeof paHideTurnBanner === 'function') paHideTurnBanner();
          paRender();
        }
      }

      // ── The phone's More tab ──────────────────────────────────────────────
      // On a phone the floating toolbar is hidden and everything in it a
      // player can use moves to a More tab. On a desktop the toolbar is still
      // there, so a More tab would be a second copy of it. This pass runs at
      // both sizes (the runner's "phone" mode is the player view on a phone).
      if (typeof paVisibleTabs === 'function' && typeof paIsPhone === 'function'){
        const PHONE = paIsPhone();
        const has = paVisibleTabs().some(t => t.id === 'more');
        ok(PHONE ? 'phone: a More tab holds what the toolbar did'
                 : 'player: no More tab while the toolbar is on screen', has === PHONE);
        if (PHONE){
          const bar = document.getElementById('float-toolbar');
          const shown = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
          ok('phone: the floating toolbar is hidden', !shown(bar));
          _updatePlayerViewportVars && _updatePlayerViewportVars();
          ok('phone: and the turn bar reserves no room for it',
             getComputedStyle(document.documentElement).getPropertyValue('--pv-topright').trim() === '0px');
          const tab0 = paTab;
          try {
            paTab = 'more'; paRender(); await sleep(200);
            const scr = document.getElementById('pa-screen');
            const rows = [...scr.querySelectorAll('.pa-more-title')].map(e => e.textContent.trim());
            ok('phone: More has search, settings, sync, campaign and the way back',
               ['Search', 'Settings', 'Sync', 'Campaign', 'Back to DM view'].every(r => rows.includes(r)),
               JSON.stringify(rows));
            // Search is the real search box, brought back as a full-width strip.
            scr.querySelector('[data-more="search"]').click(); await sleep(200);
            const inp = document.getElementById('search-input');
            ok('phone: Search opens the real search box, full width',
               document.body.classList.contains('pa-searching') && shown(document.getElementById('search-wrap'))
               && document.getElementById('search-wrap').getBoundingClientRect().width > innerWidth * 0.6);
            ok('phone: with nothing else from the toolbar beside it',
               !shown(document.getElementById('campaign-btn')) && shown(document.getElementById('pa-search-close')));
            inp.value = 'fireball'; inp.dispatchEvent(new Event('input', { bubbles: true })); await sleep(250);
            ok('phone: and it finds things',
               shown(document.getElementById('search-popup')) && /Fireball/.test(document.getElementById('search-popup').textContent));
            document.getElementById('pa-search-close').click(); await sleep(150);
            ok('phone: Done closes it and hides the toolbar again',
               !document.body.classList.contains('pa-searching') && !shown(bar));
            scr.querySelector('[data-more="settings"]').click(); await sleep(150);
            const drawer = document.getElementById('settings-drawer');
            ok('phone: Settings opens the settings drawer', drawer.classList.contains('open') && shown(drawer));
            drawer.classList.remove('open');
          } catch(e){
            ok('phone: the More tab checks ran to completion', false, e.message);
          } finally {
            document.body.classList.remove('pa-searching');
            if (typeof closeSearch === 'function') closeSearch();
            paTab = tab0; paRender();
          }
        }
      }

      // ── A player's own notes ──────────────────────────────────────────────
      // Every player keeps notes of their own in the Notes tab — create,
      // rename, edit, delete — which live in the DM's tree under
      // "Player notes" / <character> so the DM can read them. Sync lets a
      // player write ONLY notes their character owns.
      if (typeof paSetPc === 'function' && (state.party || []).length >= 2){
        const N0 = localStorage.getItem('skt-notes-v2'), S0 = (state.sharedPanels || []).slice(), tab0 = paTab;
        const me0 = localStorage.getItem('skt-me-v1');
        const rm = window.showModal, rc = window.showConfirm, rt = window.showToast;
        let answer = null;
        window.showModal = () => Promise.resolve(answer);
        window.showConfirm = () => Promise.resolve(true);
        window.showToast = () => {};
        const N = panelDefs.notes;
        const me = state.party[0], other = state.party[1];
        const stored = () => (JSON.parse(localStorage.getItem('skt-notes-v2') || '{"items":[]}').items || []);
        const txt = () => (N._body ? N._body.textContent : '');
        try {
          paSetPc(me.id);
          const d = JSON.parse(localStorage.getItem('skt-notes-v2') || '{"items":[]}');
          d.items.push({ id: 'pnn_zzother', type: 'file', name: 'ZZ Other Player Note', owner: other.id, parent: 'pnf_' + other.id, content: 'not yours' });
          const open = d.items.find(i => i.id === 'n_open'); if (open) open.shared = true;
          localStorage.setItem('skt-notes-v2', JSON.stringify(d));
          state.sharedPanels = ['party'];                 // the Notes PANEL is not shared
          ok('pnotes: every player has a Notes tab, shared or not',
             paVisibleTabs().some(t => t.id === 'notes'));
          paTab = 'notes'; paRender(); await sleep(350);
          if (N._body){ N._data = null; N.mount(N._body); await sleep(150); }
          ok('pnotes: another player’s notes are not shown', !/ZZ Other Player Note/.test(txt()));
          ok('pnotes: a DM note switched on stays hidden until the Notes panel is shared',
             !/reached the gate/.test(txt()));

          const add = N._body && N._body.querySelector('[data-player-new]');
          if (add) add.click();
          await sleep(150);
          const ta = N._body && N._body.querySelector('#note-player-text');
          if (ta){ ta.focus(); ta.value = 'ZZ typed on the phone'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
          await sleep(550);
          if (ta) ta.blur();
          const mine = stored().filter(i => i.owner === me.id && i.type === 'file');
          ok('pnotes: a player can start a note of their own', mine.length === 1, String(mine.length));
          ok('pnotes: it saves as they type', !!mine[0] && mine[0].content === 'ZZ typed on the phone');
          ok('pnotes: it lives in the DM’s tree under the character’s folder',
             !!mine[0] && mine[0].parent === 'pnf_' + me.id
             && stored().some(i => i.id === 'pnf_' + me.id && i.parent === 'pn_root'));
          answer = { name: 'ZZ Renamed' };
          N._body.querySelector('[data-player-rename]')?.click(); await sleep(150);
          ok('pnotes: a player can rename their note', stored().some(i => i.owner === me.id && i.name === 'ZZ Renamed'));

          state.sharedPanels = ['party', 'notes'];
          N._data = null; N.mount(N._body); await sleep(200);
          const chip = [...N._body.querySelectorAll('[data-player-note]')].find(b => /Session 21/.test(b.textContent));
          ok('pnotes: once the panel is shared, the DM’s note is listed too', !!chip);
          if (chip){ chip.click(); await sleep(120); }
          ok('pnotes: and it is read-only', !!chip && !N._body.querySelector('#note-player-text'));

          const own = [...N._body.querySelectorAll('[data-player-note]')].find(b => /ZZ Renamed/.test(b.textContent));
          if (own){ own.click(); await sleep(100); }
          N._body.querySelector('[data-player-delete]')?.click(); await sleep(200);
          ok('pnotes: a player can delete their own note', !stored().some(i => i.name === 'ZZ Renamed'));
        } catch(e){
          // A throw here would abort the whole player pass and discard every
          // failure already recorded — so it is recorded as one instead.
          ok('pnotes: the player notes checks ran to completion', false, e.message);
        } finally {
          window.showModal = rm; window.showConfirm = rc; window.showToast = rt;
          if (N0 != null) localStorage.setItem('skt-notes-v2', N0);
          if (me0 != null) localStorage.setItem('skt-me-v1', me0); else localStorage.removeItem('skt-me-v1');
          state.sharedPanels = S0; paTab = tab0;
          if (N._body){ N._data = null; N.mount(N._body); }
          paRender();
        }
      }

      // What sync lets a player write. The UI is not enough on its own: a
      // phone holding a partial copy would delete the DM's notes through the
      // deletion sweep, and nothing stops a modified client writing whatever
      // it likes into its own push.
      {
        const spec = typeof window.sktEntitySpec === 'function' ? window.sktEntitySpec('skt-notes-v2') : null;
        const me0 = localStorage.getItem('skt-me-v1');
        const me = (state.party[0] || {}).id, other = (state.party[1] || {}).id;
        try {
          if (typeof paSetPc === 'function' && me) paSetPc(me);
          const J = o => JSON.stringify(o);
          const dm = { 'items/n_open': J({ id: 'n_open', type: 'file' }) };
          const own = { id: 'pnn_zz', type: 'file', owner: me, parent: 'pnf_' + me };
          ok('pnotes/sync: a player may write a note of their own',
             !!spec && spec.playerWritable('items/pnn_zz', {}, J(own)) === true);
          ok('pnotes/sync: but not one of the DM’s — even by putting their name on it',
             !!spec && spec.playerWritable('items/n_open', dm, J({ id: 'n_open', type: 'file', content: 'x' })) === false
                    && spec.playerWritable('items/n_open', dm, J({ id: 'n_open', type: 'file', owner: me })) === false);
          ok('pnotes/sync: nor another player’s, nor the note order',
             !!spec && spec.playerWritable('items/pnn_o', { 'items/pnn_o': J({ id: 'pnn_o', owner: other }) }, J({ id: 'pnn_o', owner: me })) === false
                    && spec.playerWritable('meta', {}, '{}') === false);
          ok('pnotes/sync: the shared folder can be created once, never overwritten',
             !!spec && spec.playerWritable('items/pn_root', {}, J({ id: 'pn_root', type: 'folder' })) === true
                    && spec.playerWritable('items/pn_root', { 'items/pn_root': J({ id: 'pn_root', type: 'folder', name: 'DM renamed' }) }, J({ id: 'pn_root', type: 'folder' })) === false);
          // Deleting: only your own note, and only one you deleted on purpose.
          const prevOwn = { 'items/pnn_zzdel': J({ id: 'pnn_zzdel', owner: me }) };
          const before = !!spec && spec.playerDeletable('items/pnn_zzdel', prevOwn);
          if (window.sktMarkNoteDeleted) window.sktMarkNoteDeleted('pnn_zzdel');
          ok('pnotes/sync: a note missing from a phone’s copy is never deleted by it', before === false);
          // The rules above are only as good as the one place that calls them,
          // and that place needs a live database, so it is read from source:
          // the write must hand the rule the NEW value (ownership is judged
          // on it), and the deletion sweep must ask playerDeletable rather
          // than refusing every player delete — or allowing them all.
          {
            let src = '';
            try { src = await (await fetch('js/sync/realtime.js', { cache: 'no-store' })).text(); } catch(e){}
            ok('pnotes/sync: the sync write passes the new value to the rule',
               src.indexOf('restrict(n, prev, nodes[n])') >= 0);
            ok('pnotes/sync: the deletion sweep asks the rule before a player deletes',
               src.indexOf('if (restrict && !(spec.playerDeletable && spec.playerDeletable(n, prev))) return;') >= 0);
          }
          ok('pnotes/sync: one the player deleted on purpose is',
             !!spec && spec.playerDeletable('items/pnn_zzdel', prevOwn) === true
                    && spec.playerDeletable('items/n_open', dm) === false);
        } finally {
          if (me0 != null) localStorage.setItem('skt-me-v1', me0); else localStorage.removeItem('skt-me-v1');
        }
      }
    }

    // A rival lives in state.party like anyone else, so anything reading
    // that array directly puts its hit points on every phone at the table.
    if (typeof paTab !== 'undefined' && typeof paRender === 'function'){
      const P0 = JSON.stringify(state.party), S0 = (state.sharedPanels || []).slice();
      const tab0 = paTab;
      state.party = [
        { id:'zzhero',  name:'ZZ Hero',  cls:'fighter', hp:40, hpMax:40, ac:16 },
        { id:'zzrival', name:'ZZ Rival', cls:'rogue',   hp:35, hpMax:35, ac:15, foe:true },
      ];
      state.sharedPanels = ['party']; saveSharedPanels();
      paTab = 'party'; paRender(); await sleep(400);
      const txt = (document.getElementById('pa-screen') || {}).textContent || '';
      ok('player: the party tab shows a party member', /ZZ Hero/.test(txt));
      ok('player: and hides the rival', !/ZZ Rival/.test(txt), txt.slice(0, 80));
      // A player must not be able to claim the rival as their character.
      paSetPc(null); paRender(); await sleep(350);
      const pick = (document.getElementById('pa-screen') || {}).textContent || '';
      ok('player: the rival is not offered as who you are',
         /ZZ Hero/.test(pick) && !/ZZ Rival/.test(pick), pick.slice(0, 80));
      state.party = JSON.parse(P0); state.sharedPanels = S0; saveSharedPanels();
      paTab = tab0; paRender(); await sleep(200);
    }

    // Time and Sky. Shared like any other panel, and read-only here: the
    // controls are hidden by CSS and realtime.js refuses to push either key
    // from a player device, so a phone cannot rewind the table’s clock.
    if (typeof paTab !== 'undefined' && typeof paRender === 'function'){
      const S0 = (state.sharedPanels || []).slice(), tab0 = paTab;
      state.sharedPanels = []; saveSharedPanels(); paRender(); await sleep(250);
      const shut = [...document.querySelectorAll('[data-pa-tab]')].map(b => b.dataset.paTab);
      ok('player: time and sky are hidden until shared',
         shut.indexOf('time') < 0 && shut.indexOf('sky') < 0, JSON.stringify(shut));

      state.sharedPanels = ['time', 'weather']; saveSharedPanels();
      paRender(); await sleep(250);
      const open = [...document.querySelectorAll('[data-pa-tab]')].map(b => b.dataset.paTab);
      ok('player: sharing them makes the tabs appear',
         open.indexOf('time') >= 0 && open.indexOf('sky') >= 0, JSON.stringify(open));

      for (const t of ['time', 'sky']){
        const before = errs.length;
        paTab = t; paRender(); await sleep(550);
        const screen = document.getElementById('pa-screen');
        const text = (screen && screen.textContent || '').replace(/\s+/g, ' ').trim();
        ok('player: the ' + t + ' tab shows something', text.length > 20, String(text.length));
        ok('player: the ' + t + ' tab is silent', errs.length === before,
           errs.slice(before).join(' | '));
        // Read-only means no control that would CHANGE it is on screen.
        const live = [...document.querySelectorAll(
          '.pa-mount .time-buttons, .pa-mount #time-edit-done,'
          + ' .pa-mount #weather-reroll, .pa-mount #weather-tick-day,'
          + ' .pa-mount #weather-sync-season, .pa-mount #weather-history-clear')]
          .filter(el => el.getBoundingClientRect().height > 0);
        ok('player: the ' + t + ' tab offers no way to change it',
           live.length === 0, live.map(el => el.id || el.className).join(', '));
      }
      state.sharedPanels = S0; saveSharedPanels();
      paTab = tab0; paRender(); await sleep(200);
    }

    // Panel lifecycle. This shell never called unmount() at all: leaving the
    // Map tab wiped the DOM but left the battle map panel believing it was
    // still on screen — _body pointing at a detached node, its
    // ResizeObserver still firing, its document mouseup listener still
    // bound, and another set added on every visit. The stale _body is the
    // part that misleads other code: _reloadPanel and applyMapState both
    // read it to decide the panel is visible, so an incoming map change was
    // applied and painted into nothing.
    if (typeof paTab !== 'undefined' && typeof paRender === 'function'){
      const bm = panelDefs.battlemap;
      const tab0 = paTab;
      paTab = 'map'; paRender(); await sleep(600);
      ok('player: the map tab mounts the panel',
         !!bm._body && document.contains(bm._body));
      paTab = 'you'; paRender(); await sleep(300);
      ok('player: leaving the tab unmounts it',
         !bm._body, 'body still set' + (bm._body && !document.contains(bm._body) ? ' and detached' : ''));
      ok('player: the resize observer does not outlive the panel',
         !bm._resizeObserver);
      ok('player: the document listener does not outlive the panel',
         !bm._docMouseUp);
      // Going back and forth must not stack up observers or leave the panel
      // half-alive.
      for (let i = 0; i < 3; i++){
        paTab = 'map'; paRender(); await sleep(200);
        paTab = 'you'; paRender(); await sleep(200);
      }
      ok('player: repeated visits leave nothing behind',
         !bm._body && !bm._resizeObserver && !bm._docMouseUp);
      // And it must still work afterwards, or the teardown broke the panel.
      paTab = 'map'; paRender(); await sleep(600);
      ok('player: the map still mounts after several teardowns',
         !!bm._body && document.contains(bm._body)
      && !!bm._body.querySelector('#map-stage'));
      paTab = tab0; paRender(); await sleep(200);
    }
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
        // On a phone the floating toolbar is hidden and the way back is the
        // More tab's "Back to DM view" row instead. Same rule — the view must
        // be escapable — different place. (Not clicked: it navigates away.)
        const phone = typeof paIsPhone === 'function' && paIsPhone();
        if (phone){
          const tab0 = paTab;
          paTab = 'more'; paRender(); await sleep(150);
          const row = document.querySelector('#pa-screen [data-more="dm"]');
          ok('player: the back control is visible', !!row && row.getBoundingClientRect().width > 0,
             'no Back to DM view row in More');
          paTab = tab0; paRender();
        } else {
          const cs = getComputedStyle(back);
          ok('player: the back control is visible', cs.display !== 'none'
             && back.getBoundingClientRect().width > 0, 'display ' + cs.display);
        }
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

    // Modals have to fit the screen they open on. Manage Party carried
    // min-width:520px, and min-width BEATS max-width in the cascade, so its
    // own 96vw cap was ignored: on a 390px phone it rendered 520 wide, centred
    // to x:-65, with the NAME column and the close button both off the edge.
    {
      openPanel('party'); await sleep(700);
      const R = e => e.getBoundingClientRect();
      const fits = el => { const r = R(el); return r.left >= -2 && r.top >= -2
        && r.right <= window.innerWidth + 2 && r.bottom <= window.innerHeight + 2; };

      panelDefs.party._openManageParty();
      await sleep(600);
      const mp = document.querySelector('.mp-modal');
      ok('mobile: Manage Party opens', !!mp);
      if (mp){
        ok('mobile: Manage Party fits the screen', fits(mp),
           Math.round(R(mp).width) + 'px at x' + Math.round(R(mp).left)
           + ' in ' + window.innerWidth);
        const close = mp.querySelector('[data-act="mp-close"]');
        ok('mobile: its close button is reachable', !!close && fits(close));
        // Nine columns will never fit a phone; they scroll inside the wrap
        // rather than being squeezed until nothing is tappable.
        const wrap = mp.querySelector('.mp-table-wrap');
        ok('mobile: the wide table scrolls inside the modal',
           !!wrap && wrap.scrollWidth > wrap.clientWidth);
        const bd = mp.closest('.modal-backdrop'); if (bd) bd.remove();
      }

      // The per-character editor was already sized correctly — pin it so it
      // stays that way.
      panelDefs.party._openCharDetailsEditor(0, () => {});
      await sleep(600);
      const ed = document.querySelector('.mp-edit-modal');
      ok('mobile: the character details editor opens', !!ed);
      if (ed){
        ok('mobile: the details editor fits the screen', fits(ed),
           Math.round(R(ed).width) + 'px at x' + Math.round(R(ed).left));
        const off = [...ed.querySelectorAll('.mp-input')]
          .filter(i => R(i).left < -2 || R(i).right > window.innerWidth + 2);
        ok('mobile: every field in it is on screen', off.length === 0, off.length + ' off');
        const bd2 = ed.closest('.modal-backdrop'); if (bd2) bd2.remove();
      }
      // The resources editor opens OVER Manage Party, so two backdrops stack.
      // Each dimmed at 0.65, which composites to 88% black — the dialog was
      // there, but the screen just looked like it had gone dark. And its name
      // field was 39px wide, too narrow to read "Wild Shape" let alone edit it.
      panelDefs.party._openManageParty(); await sleep(500);
      panelDefs.party._openResourcesEditor(2, () => {});
      await sleep(600);
      const bds = [...document.querySelectorAll('.modal-backdrop')];
      ok('mobile: the resources editor opens over Manage Party', bds.length === 2);
      const res = bds[bds.length - 1];
      const rm = res && res.querySelector('.mp-edit-modal');
      ok('mobile: the resources modal renders', !!rm);
      if (rm){
        ok('mobile: it fits the screen', fits(rm),
           Math.round(R(rm).width) + 'x' + Math.round(R(rm).height));
        // Occlusion, not just geometry: both modals sit in the same place, so
        // a box that is "on screen" can still be behind the one below it.
        const c = R(rm);
        const hit = document.elementFromPoint(Math.round(c.left + c.width/2),
                                              Math.round(c.top + c.height/2));
        ok('mobile: it is actually on top, not behind Manage Party',
           !!(hit && rm.contains(hit)), hit && String(hit.className));
        const dimmers = bds.filter(x => getComputedStyle(x).backgroundColor !== 'rgba(0, 0, 0, 0)');
        ok('mobile: the page is dimmed once, not twice', dimmers.length === 1,
           dimmers.length + ' backdrops painting');
        const nm = rm.querySelector('.mp-res-name');
        ok('mobile: the resource name is readable', !!nm && R(nm).width > 150,
           nm ? Math.round(R(nm).width) + 'px' : 'no field');
      }
      bds.forEach(x => x.remove());

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

    // ── The dock's names stay off the bottom bar ─────────────────────────
    {
      const exp = document.getElementById('dock-expand-btn');
      ok('mobile: no "show names" button on the bottom bar', !exp || getComputedStyle(exp).display === 'none');
      const lab = document.querySelector('.dock-btn[data-panel="combat"] .dock-label');
      ok('mobile: and no names squeezed into it', !lab || getComputedStyle(lab).display === 'none');
    }

    // ── The top bar fits ─────────────────────────────────────────────────
    // The campaign chip grew the toolbar to 316px of 390: the window's ✕ sat
    // under it, the toolbar was faded as "occluded" all the time, and the
    // panel's name had zero width. Campaign moved to the settings drawer.
    openPanel('party'); await sleep(300);
    {
      const rc = e => e.getBoundingClientRect();
      const tb = rc(document.getElementById('float-toolbar'));
      const w = document.querySelector('.window[data-panel="party"]');
      const acts = rc(w.querySelector('.window-actions'));
      const title = rc(w.querySelector('.window-title span:not(.window-title-icon)'));
      _updateToolbarOcclusion();
      ok('mobile: the window controls are clear of the toolbar', acts.right <= tb.left,
         'controls end ' + Math.round(acts.right) + ', toolbar starts ' + Math.round(tb.left));
      ok('mobile: so the toolbar is not faded out', !document.body.classList.contains('toolbar-occluded'));
      ok('mobile: and the panel name is visible', title.width > 60 && title.right <= tb.left,
         Math.round(title.width) + 'px');
      const dc = document.getElementById('drawer-campaign');
      ok('mobile: the campaign switcher is in the settings drawer',
         !!dc && getComputedStyle(dc).display !== 'none'
         && document.getElementById('drawer-campaign-name').textContent.trim() === sktActiveCampaignName());
    }
    closePanel('party');
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
