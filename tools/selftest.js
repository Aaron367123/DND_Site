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

  // books/adventures/time/weather still mount, inside Library and World; the
  // window manager routes them there, so each is checked both ways.
  const PANELS = ['adventures','battlemap','bestiary','books','combat',
    'encounter','library','loot','notes','npcgen','npclib','party','shop','soundboard',
    'time','turnview','weather','world'];

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
        for (const id of ['party','combat','turnview']){
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
         (Object.keys(SHAPES).length * 3) + ' combinations)',
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
      const PANELS7 = ['party','combat','turnview','battlemap','loot','npclib'];
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
        // An imported character's features show in the full sheet's
        // Features tab (the party card no longer has its own tabs).
        openCharSheet('zzlay', { tab: 'features' }); await sleep(300);
        const rows = [...document.querySelectorAll('#cs-root details.feat-block')].filter(d => {
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
        if (typeof csClose === 'function') csClose();
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
          // One way to show players a note: Send…, as a copy that pops up or
          // kept in their Notes (live, read-only). The 👁 switch folded in.
          const btn = () => N._body.querySelector('[data-act="notes-send"]');
          ok('notes: an open note has one "Send…" and no separate share switch', !!btn() && !N._body.querySelector('[data-act="notes-share"]'));
          const id = N._selected() && N._selected().id;
          const storedNote = () => (JSON.parse(localStorage.getItem('skt-notes-v2') || '{}').items || []).find(i => i.id === id) || {};
          btn().click(); await sleep(80);
          let dlg = document.getElementById('ho-send-back');
          ok('notes: Send offers a copy now, or keeping it in their Notes',
             !!dlg && !!dlg.querySelector('input[name="ho-send-mode"][value="copy"]:checked') && !!dlg.querySelector('input[name="ho-send-mode"][value="live"]'));
          dlg.querySelector('input[name="ho-send-mode"][value="live"]').checked = true;
          dlg.querySelector('[data-ho-send="go"]').click(); await sleep(120);
          ok('notes: kept in their Notes marks it shared with everyone, and saves it', storedNote().shared === true);
          ok('notes: the button says it is shared', /Shared/.test(btn().textContent) && btn().classList.contains('active'));
          ok('notes: a shared note is marked in the tree',
             !!N._body.querySelector('.notes-file.selected .notes-shared-mark'));
          // To one player only — which needs a party of two.
          const P0n = JSON.stringify(state.party);
          if (state.party.filter(p => !p.foe).length < 2) state.party.push({ id: 'zz_second', name: 'ZZ Second', hp: 10, hpMax: 10 });
          btn().click(); await sleep(80);
          dlg = document.getElementById('ho-send-back');
          ok('notes: reopening it starts on "kept in their Notes", with Stop sharing',
             !!dlg.querySelector('input[name="ho-send-mode"][value="live"]:checked') && !!dlg.querySelector('[data-ho-send="unshare"]'));
          const all = dlg.querySelector('#ho-send-all'); all.checked = false; all.dispatchEvent(new Event('change'));
          const first = dlg.querySelector('.ho-send-pc'); first.checked = true; first.dispatchEvent(new Event('change'));
          dlg.querySelector('[data-ho-send="go"]').click(); await sleep(120);
          ok('notes: it can be in one player\u2019s Notes only', JSON.stringify(storedNote().shared) === JSON.stringify([first.value]),
             JSON.stringify(storedNote().shared) + ' · party of ' + state.party.filter(p => !p.foe).length);
          btn().click(); await sleep(80);
          document.querySelector('#ho-send-back [data-ho-send="unshare"]').click(); await sleep(120);
          ok('notes: Stop sharing takes it out of their Notes', N._selected().shared === false && !storedNote().shared);
          state.party = JSON.parse(P0n);
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
        } catch(e){ ok('npcgen: the save check ran to completion', false, e.message); }
        finally {
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

    // ── Merged windows: Turn View acts for anyone; Library; World ─────────
    {
      const before = errs.length;
      const L0 = JSON.stringify(layout);
      try {
        _remoteUpdate = true;
        try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
        finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party');
        // Turn View: act as someone off their turn.
        const TV = panelDefs.turnview; openPanel('turnview'); await sleep(450);
        const turn = state.activeCombatantId;
        const other = state.combatants.find(c => c.id !== turn && !c.isPC) || state.combatants.find(c => c.id !== turn);
        const sel = TV._body.querySelector('[data-tvactas]');
        ok('turnview: an "Act as…" picker for someone off their turn', !!sel && !!sel.querySelector('option[value="' + other.id + '"]'));
        sel.value = other.id; sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(120);
        ok('turnview: acting as them shows their actions, and the turn stays put',
           TV._active().id === other.id && state.activeCombatantId === turn
           && /Acting as/.test(TV._body.querySelector('.tv-turnline').textContent)
           && TV._body.querySelector('.tv-headwrap').textContent.includes(other.name));
        TV._body.querySelector('[data-tv="actas-end"]').click(); await sleep(80);
        ok('turnview: Back returns to whoever’s turn it is', TV._active().id === turn && !TV._actAs);
        TV.actAs(other.id); await sleep(30);
        const order = state.combatants, i = order.findIndex(c => c.id === turn);
        state.activeCombatantId = order[(i + 1) % order.length].id; save(); await sleep(120);
        ok('turnview: the turn moving on stops acting for them', !TV._actAs);
        state.activeCombatantId = turn; save();
        closePanel('turnview');
        ok('dock: the Attack Runner, Books, Adventures, Time and Weather buttons are gone; Library and World are there',
           ['attacks', 'books', 'adventures', 'time', 'weather'].every(id => !document.querySelector('.dock-btn[data-panel="' + id + '"]'))
           && !!document.querySelector('.dock-btn[data-panel="library"]') && !!document.querySelector('.dock-btn[data-panel="world"]'));
        openPanel('attacks'); await sleep(200);
        ok('opening the old Attack Runner opens Turn View', !!layout.turnview.open && !document.querySelector('.window[data-panel="attacks"]'));
        closePanel('turnview');

        // Library.
        openPanel('library'); await sleep(250);
        const lib = document.querySelector('.window[data-panel="library"]');
        ok('library: one window with Books and Adventures tabs',
           !!lib && lib.querySelectorAll('[data-lib-tab]').length === 2);
        lib.querySelector('[data-lib-tab="adventures"]').click(); await sleep(250);
        ok('library: the Adventures tab mounts Adventures and lets Books go',
           !!panelDefs.adventures._body && lib.contains(panelDefs.adventures._body) && !panelDefs.books._body
           && layout.library.tab === 'adventures');
        openPanel('books'); await sleep(250);
        ok('library: opening Books goes to its tab, in the same window',
           document.querySelectorAll('.window[data-panel="library"]').length === 1 && !document.querySelector('.window[data-panel="books"]')
           && !!panelDefs.books._body && lib.contains(panelDefs.books._body) && !panelDefs.adventures._body
           && lib.querySelector('[data-lib-tab="books"]').classList.contains('on'));
        closePanel('library'); await sleep(60);
        ok('library: closing it unmounts the open tab', !panelDefs.books._body && !document.querySelector('.window[data-panel="library"]'));

        // World.
        const T0 = localStorage.getItem('skt-time-v1'), W0 = localStorage.getItem('skt-weather-v2');
        try {
          openPanel('time'); await sleep(300);
          const w = document.querySelector('.window[data-panel="world"]');
          ok('world: opening Time opens World, with the time and the weather in it',
             !!w && w.contains(panelDefs.time._body) && w.contains(panelDefs.weather._body));
          const W = panelDefs.weather;
          W._maybeAutoTick();
          const before = JSON.stringify(W._data.lastRollDate);
          panelDefs.time._advance(24); await sleep(80);
          ok('world: turning the day over rolls the new day’s weather', JSON.stringify(W._data.lastRollDate) !== before, before);
          closePanel('world');
        } finally {
          _remoteUpdate = true;
          try {
            if (T0 == null) localStorage.removeItem('skt-time-v1'); else localStorage.setItem('skt-time-v1', T0);
            if (W0 == null) localStorage.removeItem('skt-weather-v2'); else localStorage.setItem('skt-weather-v2', W0);
          } finally { _remoteUpdate = false; }
          panelDefs.time._data = null; panelDefs.weather._data = null;
        }

        // Saved layouts and workspaces from before the merge.
        const m = sktMigrateLayout({
          books:   { x: 11, y: 22, w: 500, h: 400, open: false, z: 3 },
          adventures: { x: 33, y: 44, w: 500, h: 400, open: true, minimized: false, z: 9 },
          time:    { x: 55, y: 66, w: 300, h: 500, open: true, z: 4 },
          weather: { x: 77, y: 88, w: 300, h: 500, open: true, z: 5 },
          attacks: { x: 99, y: 10, w: 400, h: 400, open: true, z: 6 },
        });
        ok('layout: windows that were open open their new home, where the old one sat',
           m.library && m.library.open && m.library.x === 33 && m.library.tab === 'adventures'
           && m.world && m.world.open && m.world.x === 55 && m.turnview && m.turnview.open && m.turnview.x === 99
           && ['books', 'adventures', 'time', 'weather', 'attacks'].every(k => !(k in m)), JSON.stringify(m));
        {
          const raw0 = localStorage.getItem(WS_KEY);
          try {
            localStorage.setItem(WS_KEY, JSON.stringify({ active: 'ws_a', list: [{ id: 'ws_a', name: 'Prep',
              panels: { books: { x: 1, y: 2, w: 500, h: 400, open: true, z: 2 } } }] }));
            const d = _wsLoad();
            ok('workspaces: a saved workspace with Books open opens the Library',
               !!d && d.list[0].panels.library && d.list[0].panels.library.open && !d.list[0].panels.books);
          } finally { if (raw0 == null) localStorage.removeItem(WS_KEY); else localStorage.setItem(WS_KEY, raw0); }
        }
        ok('sharing: the old Time and Weather share the World tab',
           JSON.stringify(sktCanonShared(['notes', 'time', 'weather', 'world'])) === '["notes","world"]');
      } catch(e){ ok('merged windows: the checks ran to completion', false, e.message); }
      finally {
        ['turnview', 'library', 'world'].forEach(id => { try { closePanel(id); } catch(e){} });
        Object.keys(layout).forEach(k => delete layout[k]); Object.assign(layout, JSON.parse(L0)); saveLayout();
      }
      ok('merged windows: silent', errs.length === before, errs.slice(before).join(' | '));
    }

    // ── One search box: / and 🔍 open Ctrl+K; "See all" opens the full search
    {
      try {
        document.activeElement && document.activeElement.blur && document.activeElement.blur();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
        await sleep(60);
        ok('search: / opens the Ctrl+K box', !!document.getElementById('cp-backdrop')
           && !document.getElementById('search-wrap').classList.contains('open'));
        const inp = document.getElementById('cp-input');
        inp.value = 'goblin'; inp.dispatchEvent(new Event('input', { bubbles: true })); await sleep(60);
        const rows = [...document.querySelectorAll('#cp-list .cp-item')];
        const last = rows[rows.length - 1];
        ok('search: its results end with "See all"', !!last && /See all results for .goblin./.test(last.textContent));
        last.click(); await sleep(150);
        ok('search: "See all" opens the full search with the query in it',
           !document.getElementById('cp-backdrop') && document.getElementById('search-wrap').classList.contains('open')
           && document.getElementById('search-input').value === 'goblin');
        closeSearch();
        document.getElementById('float-search-btn').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await sleep(60);
        ok('search: the toolbar 🔍 opens the same box', !!document.getElementById('cp-backdrop'));
      } catch(e){ ok('search: the checks ran to completion', false, e.message); }
      finally { document.getElementById('cp-backdrop')?.remove(); try { closeSearch(); } catch(e){} }
    }

    // ── Turn View, decluttered ─────────────────────────────────────────────
    {
      const before = errs.length;
      const K0 = JSON.stringify(state.combatants), A0 = state.activeCombatantId;
      try {
        _remoteUpdate = true;
        try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
        finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party');
        const mon = state.combatants.find(c => !c.isPC && panelDefs.turnview._attacksFor(c).length);
        state.activeCombatantId = mon.id; save();
        const TV = panelDefs.turnview; TV._stdOpen = false; TV._manualOpen = false; TV._result = ''; TV._log = [];
        openPanel('turnview'); await sleep(500);
        const b = TV._body;
        ok('turnview: no chips for the reactions everyone has', !/Opportunity Attack/.test(b.querySelector('.tv-headwrap').textContent));
        ok('turnview: the six standard actions wait behind one button',
           !b.querySelector('[data-tv="stdact"]') && !!b.querySelector('[data-tv="stdopen"]'));
        b.querySelector('[data-tv="stdopen"]').click(); await sleep(60);
        ok('turnview: and are there when asked for', b.querySelectorAll('[data-tv="stdact"]').length === 6);
        ok('turnview: "rolled it yourself" is one small button for a creature with attacks',
           !b.querySelector('[data-tvman="dmg"]') && !!b.querySelector('.tv-manual-open'));
        b.querySelector('.tv-manual-open').click(); await sleep(60);
        ok('turnview: which opens the row', !!b.querySelector('[data-tvman="dmg"]'));
        ok('turnview: no placeholder boxes before anything has happened',
           getComputedStyle(b.querySelector('.tv-result')).display === 'none');
        // One undo history: a rolled attack is a step Ctrl+Z takes back.
        const tgt = state.combatants.find(c => c.id !== mon.id && c.hp > 0);
        TV._armed = tgt.id; TV._render();
        const hp0 = tgt.hp; let tries = 0;
        while (state.combatants.find(c => c.id === tgt.id).hp === hp0 && tries++ < 30){
          TV._rollAttack(0); await sleep(10);
          if (TV._pending){ TV._pending = null; }
        }
        const hit = state.combatants.find(c => c.id === tgt.id).hp;
        ok('turnview: the attack is in the app’s undo history', hit < hp0 && /→/.test(sktUndoLabel() || ''), sktUndoLabel());
        ok('turnview: with an Undo beside the result', !!b.querySelector('.tv-result [data-tv="undo"]'));
        sktUndo(); await sleep(60);
        ok('turnview: Ctrl+Z puts the hit points back', state.combatants.find(c => c.id === tgt.id).hp === hp0,
           state.combatants.find(c => c.id === tgt.id).hp + ' vs ' + hp0);
        sktRedo(); await sleep(60);
        ok('turnview: and redo lands it again', state.combatants.find(c => c.id === tgt.id).hp === hit);
        // A short window: the attacks scroll inside the column instead of
        // running under the footer with End turn on it.
        closePanel('turnview');
        const lay0 = JSON.stringify(layout.turnview);
        layout.turnview = { ...layout.turnview, h: 420 }; openPanel('turnview'); await sleep(400);
        const foot = TV._body.querySelector('.tv-foot').getBoundingClientRect().top;
        const acts = TV._body.querySelector('.tv-actions').getBoundingClientRect().bottom;
        ok('turnview: in a short window the attacks end above the footer', acts <= foot + 1, Math.round(acts) + ' vs ' + Math.round(foot));
        closePanel('turnview'); layout.turnview = JSON.parse(lay0);
      } catch(e){ ok('turnview: the declutter checks ran to completion', false, e.message); }
      finally {
        try { closePanel('turnview'); } catch(e){}
        state.combatants = JSON.parse(K0); state.activeCombatantId = A0; save();
      }
      ok('turnview: declutter checks silent', errs.length === before, errs.slice(before).join(' | '));
    }

    // ── Second round of merges: one of each ───────────────────────────────
    {
      const before = errs.length;
      const K0 = localStorage.getItem('skt-combat-v1'), P0 = localStorage.getItem('skt-party-v1');
      const T0 = localStorage.getItem('skt-time-v1'), W0 = localStorage.getItem('skt-weather-v2');
      const H0 = localStorage.getItem('skt-handouts-v1'), S0 = JSON.stringify(state.settings);
      const rt = window.showToast, rc = window.showConfirm;
      window.showToast = () => {}; window.showConfirm = () => Promise.resolve(true);
      const restore = () => {
        _remoteUpdate = true;
        try {
          [['skt-combat-v1', K0], ['skt-party-v1', P0], ['skt-time-v1', T0], ['skt-weather-v2', W0], ['skt-handouts-v1', H0]]
            .forEach(([k, v]) => { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
        } finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party');
        panelDefs.time._data = null; panelDefs.weather._data = null;
      };
      try {
        // #1 The right-click menu lists workspaces; focuses are gone.
        const ws = document.getElementById('workspace');
        ws.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 400 }));
        await sleep(60);
        const menu = document.getElementById('workspace-ctx-menu');
        ok('menu: right-click lists the workspaces, and offers a new one',
           menu.querySelectorAll('[data-ws-id]').length === _wsState.list.length && !!menu.querySelector('[data-ctx-act="ws-add"]')
           && !/Focus/.test(menu.textContent));
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(20);
        {
          const st0 = JSON.stringify(_wsState);
          try {
            localStorage.setItem('skt-focuses-v1', JSON.stringify([{ id: 'f1', name: 'ZZ Travel', snap: { panels: { world: { x: 5, y: 5, w: 400, h: 400 } } } },
                                                                   { id: 'f2', name: _wsState.list[0].name, snap: { panels: {} } }]));
            const n0 = _wsState.list.length;
            _wsAdoptFocuses();
            const added = _wsState.list.filter(w => w.name === 'ZZ Travel');
            ok('menu: an old saved focus becomes a workspace, once, and the old list goes',
               added.length === 1 && _wsState.list.length === n0 + 1 && added[0].panels.world.open === true
               && localStorage.getItem('skt-focuses-v1') == null);
          } finally { _wsState = JSON.parse(st0); wsSave(); }
        }

        // #2 A rest moves the clock; undoing it puts the clock back.
        const T = panelDefs.time;
        T._data = null; T._data = _timeHydrate(); T._save();
        const clock = () => { const d = JSON.parse(localStorage.getItem('skt-time-v1')); return d.day * 24 + d.hour + (d.month * 30 + d.year * 360) * 24; };
        const c0 = clock();
        panelDefs.party._longRestAll(); await sleep(80);
        ok('rest: a party long rest moves the world clock 8 hours', clock() - c0 === 8, String(clock() - c0));
        sktUndo(); await sleep(60);
        ok('rest: undoing it puts the clock back too', clock() === c0, String(clock() - c0));
        panelDefs.party._shortRestAll(); await sleep(40);
        ok('rest: starting a short rest does not move the clock yet', clock() === c0);
        panelDefs.party._finishShortRest(sktRollReq()); await sleep(60);
        ok('rest: finishing it moves the clock an hour', clock() - c0 === 1, String(clock() - c0));
        openPanel('world'); await sleep(250);
        const longBtn = panelDefs.time._body.querySelector('[data-rest="long"]');
        const c1 = clock();
        longBtn.click(); await sleep(120);
        const hpFull = state.party.filter(p => !p.foe && !p.dead).every(p => p.hp === p.hpMax || p.hp == null);
        ok('rest: World’s Long rest is the party’s long rest, and 8 hours pass', clock() - c1 === 8 && hpFull, (clock() - c1) + 'h, full ' + hpFull);
        closePanel('world');

        // #4 A whisper is the Send dialog, with a box to write in.
        const pcs = state.party.filter(p => !p.foe);
        let pr = sktWhisperTo(pcs[0].id); await sleep(60);
        let dlg = document.getElementById('ho-send-back');
        ok('whisper: it opens Send to players, one player ticked, a box to write in',
           !!dlg && !!dlg.querySelector('#ho-send-msg') && [...dlg.querySelectorAll('.ho-send-pc:checked')].map(b => b.value).join() === pcs[0].id);
        dlg.querySelector('#ho-send-msg').value = 'ZZ the innkeeper is lying';
        dlg.querySelector('[data-ho-send="go"]').click(); await pr;
        let top = sktHandouts().list[0];
        ok('whisper: to one player it arrives as a whisper', top.whisper === true && JSON.stringify(top.to) === JSON.stringify([pcs[0].id]) && /innkeeper/.test(top.text));
        if (pcs.length > 1){
          pr = sktWhisperTo(pcs[0].id); await sleep(60);
          dlg = document.getElementById('ho-send-back');
          const b2 = dlg.querySelector('.ho-send-pc[value="' + pcs[1].id + '"]'); b2.checked = true; b2.dispatchEvent(new Event('change'));
          dlg.querySelector('#ho-send-msg').value = 'ZZ for two';
          dlg.querySelector('[data-ho-send="go"]').click(); await pr;
          top = sktHandouts().list[0];
          ok('whisper: to more than one it is a handout to them', !top.whisper && top.to.length === 2 && /for two/.test(top.text));
        }

        // #5 Turn View adds through the Combat Tracker.
        openPanel('turnview'); await sleep(400);
        const TV = panelDefs.turnview;
        TV._body.querySelector('[data-tv="initedit"]').click(); await sleep(80);
        ok('turnview: adding to the fight is the picker, a party member, or Other',
           !!TV._body.querySelector('[data-tv="addmon"]') && !!TV._body.querySelector('[data-tv="addother"]') && !TV._body.querySelector('[data-tvadd]'));
        TV._body.querySelector('[data-tv="addmon"]').click(); await sleep(80);
        ok('turnview: + Monsters opens the shared picker', /Add to combat/.test((document.getElementById('mp-back') || {}).textContent || ''));
        document.getElementById('mp-back')?.remove();
        let rolled = 0; const rI = panelDefs.combat._rollInitiative;
        panelDefs.combat._rollInitiative = function(){ rolled++; return rI.apply(this, arguments); };
        try { TV._body.querySelector('[data-tv="rollinit"]').click(); await sleep(80); }
        finally { panelDefs.combat._rollInitiative = rI; }
        ok('turnview: Roll NPCs is the tracker’s roll, then sorted',
           rolled === 1 && state.combatants.every((c, i, a) => i === 0 || +a[i - 1].initiative >= +c.initiative));
        TV._body.querySelector('[data-tv="initdone"]').click(); await sleep(40);
        closePanel('turnview');

        // #6 Inspiration in the card menu only on a compact card.
        const P = panelDefs.party; openPanel('party'); await sleep(250);
        const menuFor = async () => {
          let items = null; const sm = window.showContextMenu;
          window.showContextMenu = (x, y, it) => { items = it; };
          try { P._body.querySelector('[data-act="actions-menu"]').click(); await sleep(40); }
          finally { window.showContextMenu = sm; }
          return (items || []).map(i => i.label || '');
        };
        state.settings.partyCompact = false; P._render();
        const full = await menuFor();
        state.settings.partyCompact = true; P._render();
        const compact = await menuFor();
        ok('party: the card menu repeats inspiration only when the card hides its buttons',
           full.length > 0 && !full.some(l => /Inspiration/.test(l)) && compact.some(l => /Heroic Inspiration/.test(l)), JSON.stringify([full.length, compact.length]));
        state.settings = JSON.parse(S0); P._render(); closePanel('party');

        // #7 One Ctrl+K entry for asking the table to roll.
        const labels = _cpCommands().map(c => c.label);
        ok('palette: one "Ask the players to roll…", no separate initiative entry',
           labels.filter(l => /Ask the players to roll/.test(l)).length === 1 && !labels.includes('Ask players for initiative'));
      } catch(e){ ok('merges 2: the checks ran to completion', false, e.message); }
      finally {
        window.showToast = rt; window.showConfirm = rc;
        document.getElementById('ho-send-back')?.remove(); document.getElementById('mp-back')?.remove(); document.getElementById('rr-card')?.remove();
        ['turnview', 'party', 'world'].forEach(id => { try { closePanel(id); } catch(e){} });
        state.settings = JSON.parse(S0);
        restore();
      }
      ok('merges 2: silent', errs.length === before, errs.slice(before).join(' | '));
    }

    // ── Third round: fixes and tidying ─────────────────────────────────────
    {
      const before = errs.length;
      const K0 = localStorage.getItem('skt-combat-v1'), P0 = localStorage.getItem('skt-party-v1');
      const H0 = localStorage.getItem('skt-handouts-v1'), I0 = localStorage.getItem('skt-ho-imgs-v1');
      const S0 = JSON.stringify(state.settings);
      const rt = window.showToast; window.showToast = () => {};
      const stub = { ready: window.sktMapBlobReady, put: window.sktMapBlobPut, get: window.sktMapBlobGet, del: window.sktMapBlobDelete };
      try {
        const C = panelDefs.combat;
        // #1 Numbering from the name without its number.
        state.combatants = [{ id: 'zz_h', name: 'hill giant 1', isPC: false, hp: 50, hpMax: 50, ac: 13, initiative: 5, conditions: [] }];
        save(); C._duplicate(0);
        const names = state.combatants.map(c => c.name);
        ok('combat: copying "hill giant 1" makes "hill giant 2", not "hill giant 1 1"',
           JSON.stringify(names) === JSON.stringify(['hill giant 1', 'hill giant 2']) && state.combatants.every(c => c.baseName === 'hill giant'), JSON.stringify(names));
        _remoteUpdate = true;
        try { localStorage.setItem('skt-combat-v1', JSON.stringify({ combatRound: 1, activeCombatantId: null, combatants: [
          { id: 'a', name: 'hill giant 1 1', baseName: 'hill giant 1', isPC: false, hp: 9, hpMax: 9 },
          { id: 'b', name: 'ogre 1 2', baseName: 'ogre 1', isPC: false, hp: 9, hpMax: 9 },
          { id: 'c', name: 'Kraken Priest 3', baseName: 'Kraken Priest', isPC: false, hp: 9, hpMax: 9 }] })); }
        finally { _remoteUpdate = false; }
        loadDomain('combat');
        ok('combat: a fight saved with doubled numbers is tidied when it loads',
           JSON.stringify(state.combatants.map(c => c.name + '|' + c.baseName)) === JSON.stringify(['hill giant 1|hill giant', 'ogre 2|ogre', 'Kraken Priest 3|Kraken Priest']),
           JSON.stringify(state.combatants.map(c => c.name)));
        _remoteUpdate = true;
        try { if (K0 != null) localStorage.setItem('skt-combat-v1', K0); } finally { _remoteUpdate = false; }
        loadDomain('combat');

        // #2 Settings from the keyboard.
        const drawer = document.getElementById('settings-drawer');
        drawer.classList.remove('open');
        document.getElementById('settings-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        ok('settings: Enter or Space on the gear opens Settings', drawer.classList.contains('open'));
        drawer.classList.remove('open');

        // #3 The Combat Tracker toolbar.
        openPanel('combat'); await sleep(250);
        const cb = C._body;
        ok('combat: the view switches left the toolbar for the ⋯ menu',
           !cb.querySelector('[data-act="toggle-compact"]') && !cb.querySelector('[data-act="toggle-group"]')
           && C.menuItems().some(i => /Compact cards/.test(i.label)) && C.menuItems().some(i => /Group identical/.test(i.label)));
        ok('combat: Sort stays in the toolbar', !!cb.querySelector('[data-act="sort-init"]'));
        ok('combat: one "＋ Add" instead of + and the paw', !!cb.querySelector('[data-act="add-menu"]') && !cb.querySelector('[data-act="add-monster"]') && !cb.querySelector('.combat-controls [data-act="add"]'));
        let items = null; const sm = window.showContextMenu;
        window.showContextMenu = (x, y, it) => { items = it; };
        try { cb.querySelector('[data-act="add-menu"]').click(); } finally { window.showContextMenu = sm; }
        ok('combat: "＋ Add" offers monsters, party members not in the fight, and Other',
           !!items && /Monsters/.test(items[0].label) && /Other/.test(items[items.length - 1].label), JSON.stringify((items || []).map(i => i.label)));
        state.settings.monsterStatsMode = 'conceal'; C._render();
        ok('combat: what players see of monster HP is a small icon, not a banner',
           !!cb.querySelector('.combat-controls .combat-stats-ind') && !cb.querySelector('.combat-hide-banner'));
        state.settings = JSON.parse(S0); C._render();
        ok('combat: the phone and area-save buttons are drawn icons, not emoji',
           /i-phone/.test((cb.querySelector('[data-act="ask-init"]') || {}).innerHTML || 'i-phone') && /i-burst/.test((cb.querySelector('[data-act="area-save"]') || {}).innerHTML || 'i-burst'));

        // #4 A character's turn has the action pips too.
        const pc = state.combatants.find(c => c.isPC);
        const A0 = state.activeCombatantId; state.activeCombatantId = pc.id; save();
        openPanel('turnview'); await sleep(400);
        ok('turnview: a character’s turn shows Action, Bonus and Reaction', panelDefs.turnview._body.querySelectorAll('.tv-econ').length === 3);
        closePanel('turnview'); state.activeCombatantId = A0; save();

        // #5 The damage-type chip.
        openPanel('party'); await sleep(250);
        ok('party: the damage-type chip says "type" when none is picked',
           [...panelDefs.party._body.querySelectorAll('.party-hp-type-label')].some(e => e.textContent === 'type'));
        closePanel('party');

        // #7 Handout pictures on their own node.
        const store = {}; let deleted = null;
        window.sktMapBlobReady = () => true;
        window.sktMapBlobPut = (id, url) => { store[id] = url; return Promise.resolve(true); };
        window.sktMapBlobGet = id => Promise.resolve(store[id] || null);
        window.sktMapBlobDelete = id => { deleted = id; delete store[id]; return Promise.resolve(true); };
        const cv = document.createElement('canvas'); cv.width = 60; cv.height = 40;
        const pic = cv.toDataURL('image/jpeg', 0.8);
        const hid = panelDefs.handouts.send({ title: 'ZZ map scrap', text: '', img: pic, to: 'all' });
        await sleep(30);
        const rec = sktHandouts().list.find(h => h.id === hid);
        ok('handouts: a picture is stored on its own, and the handout carries only its id',
           !!rec && !rec.img && rec.imgBlob === hid && store[hid] === pic && !localStorage.getItem('skt-handouts-v1').includes('data:image'));
        delete _hoImgMem[hid]; localStorage.removeItem('skt-ho-imgs-v1');
        const box = document.createElement('div'); box.innerHTML = sktHoImgTag(rec, 'pa-ho-img'); document.body.appendChild(box);
        ok('handouts: a device without the picture asks for it', !!box.querySelector('img[data-ho-blob="' + hid + '"]'));
        sktHoFillImgs(box); await sleep(40);
        ok('handouts: and shows it once it arrives', box.querySelector('img').src === pic);
        box.remove();
        panelDefs.handouts.remove(hid);
        ok('handouts: deleting the handout deletes its picture', deleted === hid && !store[hid]);
        window.sktMapBlobReady = () => false;
        const hid2 = panelDefs.handouts.send({ title: 'ZZ offline', text: '', img: pic, to: 'all' });
        ok('handouts: offline, the picture rides inline as before', (sktHandouts().list.find(h => h.id === hid2) || {}).img === pic);
      } catch(e){ ok('round 3: the checks ran to completion', false, e.message); }
      finally {
        window.showToast = rt;
        window.sktMapBlobReady = stub.ready; window.sktMapBlobPut = stub.put; window.sktMapBlobGet = stub.get; window.sktMapBlobDelete = stub.del;
        state.settings = JSON.parse(S0);
        _remoteUpdate = true;
        try {
          [['skt-combat-v1', K0], ['skt-party-v1', P0], ['skt-handouts-v1', H0], ['skt-ho-imgs-v1', I0]]
            .forEach(([k, v]) => { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
        } finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party');
        ['combat', 'party', 'turnview'].forEach(id => { try { closePanel(id); } catch(e){} });
      }
      ok('round 3: silent', errs.length === before, errs.slice(before).join(' | '));
    }

    // ── Sync costs: the focus refresh, portraits, the old blob ────────────
    {
      const before = errs.length;
      const P0 = localStorage.getItem('skt-party-v1');
      const stub = { put: window.sktMapBlobPut, get: window.sktMapBlobGet };
      const applyRK = window._applyRemoteKey;
      try {
        // #1 Coming back to the window: once per ten seconds, unchanged keys left alone.
        const store = {}; let reads = 0;
        const fakeDb = { ref: path => ({ once: () => { reads++; return Promise.resolve({ exists: () => path in store, val: () => store[path] }); } }) };
        let applied = [];
        window._applyRemoteKey = (k, v) => { applied.push(k); };
        try {
          SKT_SYNC_KEYS.filter(k => !_ENTITY_KEYS[k]).forEach(k => { store[_wholePath(k)] = 'same-' + k; _lastServer[k] = 'same-' + k; });
          store[_wholePath('skt-loot-v1')] = 'changed';
          _refreshLast = 0;
          const first = _refreshAll(false, fakeDb);
          await sleep(30);
          ok('refresh: coming back re-reads, but re-applies only what changed',
             first === true && JSON.stringify(applied) === JSON.stringify(['skt-loot-v1']), JSON.stringify(applied));
          const r0 = reads;
          ok('refresh: a second return within ten seconds (focus + visibility) does nothing', _refreshAll(false, fakeDb) === false && reads === r0);
          ok('refresh: a forced one (a long absence, Resync) still runs', _refreshAll(true, fakeDb) === true);
        } finally { window._applyRemoteKey = applyRK; SKT_SYNC_KEYS.forEach(k => { delete _lastServer[k]; }); _refreshLast = 0; }

        // #2 Portraits travel once, on their own.
        const blobs = {};
        window.sktMapBlobPut = (id, url) => { blobs[id] = url; return Promise.resolve(true); };
        window.sktMapBlobGet = id => Promise.resolve(blobs[id] || null);
        const spec = _ENTITY_KEYS['skt-party-v1'];
        const cv = document.createElement('canvas'); cv.width = 80; cv.height = 80;
        { const g = cv.getContext('2d'); for (let i = 0; i < 400; i++){ g.fillStyle = 'hsl(' + (i * 37 % 360) + ',60%,50%)'; g.fillRect((i * 13) % 80, (i * 7) % 80, 4, 4); } }
        const pic = cv.toDataURL('image/png');
        const party = JSON.parse(P0);
        party[0] = { ...party[0], icon: pic };
        party[1] = { ...party[1], icon: '🧝' };
        const nodes = spec.explode(JSON.stringify(party));
        const ids = Object.keys(nodes).filter(n => n.startsWith('items/'));
        const sent0 = JSON.parse(nodes[ids[0]]), sent1 = JSON.parse(nodes[ids[1]]);
        await sleep(10);
        ok('portrait: a character record goes to the server without its picture, which is stored once on its own',
           pic.length > 1000 && sent0.icon === null && /^pi_/.test(sent0.iconBlob) && blobs[sent0.iconBlob] === pic && nodes[ids[0]].length < 4000);
        ok('portrait: a small icon (an emoji) still rides along', sent1.icon === '🧝' && !sent1.iconBlob);
        // Back from the server on this device: from the local copy.
        _remoteUpdate = true;
        try { localStorage.setItem('skt-party-v1', JSON.stringify(party.map((p, i) => i === 0 ? { ...p, iconBlob: sent0.iconBlob } : p))); } finally { _remoteUpdate = false; }
        Object.keys(_portraitMem).forEach(k => delete _portraitMem[k]);
        const back = JSON.parse(spec.assemble(nodes));
        ok('portrait: coming back, it is put back from this device’s own copy', back[0].icon === pic);
        // On a device that has never had it: fetched, then drawn.
        Object.keys(_portraitMem).forEach(k => delete _portraitMem[k]);
        _remoteUpdate = true;
        try { localStorage.setItem('skt-party-v1', JSON.stringify(party.map((p, i) => i === 0 ? { ...p, icon: null, iconBlob: sent0.iconBlob } : p))); } finally { _remoteUpdate = false; }
        const fresh = JSON.parse(spec.assemble(nodes));
        await sleep(60);
        const stored = JSON.parse(localStorage.getItem('skt-party-v1'))[0];
        ok('portrait: a device without it fetches it once and shows it', fresh[0].icon == null && stored.icon === pic);

        // #4 The old combined copy goes once the split keys are in use.
        const LG0 = localStorage.getItem('skt-workspace-v1');
        localStorage.setItem('skt-workspace-v1', '{"party":[]}');
        const lay0 = JSON.stringify(layout);
        load();
        ok('storage: the stale pre-split copy of the campaign is removed', localStorage.getItem('skt-workspace-v1') == null);
        if (LG0 != null) localStorage.setItem('skt-workspace-v1', LG0);
        Object.keys(layout).forEach(k => delete layout[k]); Object.assign(layout, JSON.parse(lay0));
      } catch(e){ ok('sync costs: the checks ran to completion', false, e.message); }
      finally {
        window.sktMapBlobPut = stub.put; window.sktMapBlobGet = stub.get; window._applyRemoteKey = applyRK;
        _remoteUpdate = true;
        try { if (P0 != null) localStorage.setItem('skt-party-v1', P0); } finally { _remoteUpdate = false; }
        loadDomain('party');
      }
      ok('sync costs: silent', errs.length === before, errs.slice(before).join(' | '));
    }

    // ── Toolbars and menus ─────────────────────────────────────────────────
    {
      const before = errs.length;
      const lay0 = JSON.stringify(layout), NP0 = localStorage.getItem('skt-npcs-v2');
      let cm = null; const sm = window.showContextMenu;
      try {
        window.showContextMenu = (x, y, it) => { cm = it; };
        // #1 Battle Map: play on the toolbar, setup in ⚙.
        openPanel('battlemap'); await sleep(500);
        const M = panelDefs.battlemap, mb = M._body;
        const bar = mb.querySelector('.map-toolbar');
        ok('map: the toolbar is what a fight needs — no grid size, preset list, colour, grid style, snap or align on it',
           !bar.querySelector('#map-size, #map-size-preset, #map-bg-color, [data-mact="toggle-grid"], [data-mact="toggle-snap"], [data-mact="tool-align"], [data-mact="clear-img"]')
           && !!bar.querySelector('[data-mact="map-menu"]') && !!bar.querySelector('[data-mact="tool-add-pc"]') && !!bar.querySelector('[data-mact="fog-toggle"]'));
        cm = null; bar.querySelector('[data-mact="map-menu"]').click();
        ok('map: "Map ▾" chooses a map, and reaches the grid setup', !!cm && /Choose a map/.test(cm[0].label) && cm.some(i => /Grid/.test(i.label)));
        mb.querySelector('[data-mact="toggle-settings"]').click(); await sleep(150);
        const set = mb.querySelector('.bm-settings');
        ok('map: snapping, alignment and the background colour are in ⚙',
           !!set.querySelector('[data-bmset="snap"]') && !!set.querySelector('[data-bmset="align"]') && !!set.querySelector('#bm-set-bgcolor'));
        const snap0 = !!M._snapToGrid;
        set.querySelector('[data-bmset="snap"]').click(); await sleep(60);
        ok('map: and they work from there', !!M._snapToGrid === !snap0);
        M._snapToGrid = snap0; M._cellSize = 38.46473891664834; M._refreshSettings();
        ok('map: the cell size reads as a whole number', (mb.querySelector('#bm-set-cellsize-val') || {}).textContent === '38px');
        M._settingsOpen = false; closePanel('battlemap');

        // #2 Party: the everyday actions in a header row.
        openPanel('party'); await sleep(250);
        const P = panelDefs.party, ph = P._body.querySelector('.party-head');
        ok('party: Add character, Rest and Ask to roll sit in the header row',
           !!ph && !!ph.querySelector('[data-act="party-add"]') && !!ph.querySelector('[data-act="party-rest"]') && !!ph.querySelector('[data-act="party-ask"]'));
        cm = null; ph.querySelector('[data-act="party-rest"]').click();
        ok('party: Rest offers a short rest and a long rest', !!cm && cm.length === 2 && /Short/.test(cm[0].label) && /Long/.test(cm[1].label));
        ok('party: the ⋯ menu keeps the rest — Manage Party, Party Skills', JSON.stringify(P.menuItems().map(i => i.label)) === JSON.stringify(['Manage Party', 'Party Skills', 'Import a character…']));
        closePanel('party');

        // #3 Every ⋯ menu: icons and checks, no emoji, window options last.
        openPanel('combat'); await sleep(250);
        document.querySelector('.window[data-panel="combat"] [data-wact="menu"]').click(); await sleep(60);
        const menu = document.querySelector('.window-menu');
        const labels = [...menu.querySelectorAll('.wm-label')].map(e => e.textContent);
        const emoji = /\p{Extended_Pictographic}/u;
        ok('menu: no emoji in a window menu', labels.length > 5 && !labels.some(l => emoji.test(l)), labels.join(' | '));
        ok('menu: a switch shows a check, the choice made shows which',
           menu.querySelectorAll('[role="menuitemcheckbox"]').length >= 5 && menu.querySelectorAll('.wm-chk.on').length >= 1);
        ok('menu: the window’s own options come after the panel’s', labels.indexOf('Lock position') > labels.indexOf('HP bars') && labels[labels.length - 1] === 'Snap to layout…');
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); menu.remove();
        closePanel('combat');
        // An item still written the old way is read for what it means.
        { const N = panelDefs.notes, mi0 = N.menuItems;
          N.menuItems = () => [{ label: '📋 Old style', run(){} }, { label: '☑ Old switch', run(){} }];
          try {
            openPanel('notes'); await sleep(200);
            document.querySelector('.window[data-panel="notes"] [data-wact="menu"]').click(); await sleep(60);
            const m2 = document.querySelector('.window-menu');
            const l2 = [...m2.querySelectorAll('.wm-label')].map(e => e.textContent);
            ok('menu: an older label loses its emoji, and a ☑ becomes a check', l2[0] === 'Old style' && l2[1] === 'Old switch'
               && !!m2.querySelectorAll('.window-menu-item')[1].querySelector('.wm-chk.on'), JSON.stringify(l2.slice(0, 2)));
            m2.remove();
          } finally { if (mi0 === undefined) delete N.menuItems; else N.menuItems = mi0; closePanel('notes'); }
        }

        // #4 Library: the "applies to" chips wait in the footer.
        const B = panelDefs.books, H0 = B._hiddenBooks ? new Set(B._hiddenBooks) : null;
        openPanel('books'); await sleep(400);
        if (B._hiddenBooks && !B._hiddenBooks.size && B._adventures && B._adventures[0]){ B._hiddenBooks.add(B._adventures[0].id); B._render(); await sleep(60); }
        const lb = B._body;
        ok('library: the "applies to" row is not above the books', !lb.querySelector('.adv-scope-row') && !!lb.querySelector('#adv-scope-toggle'));
        lb.querySelector('#adv-scope-toggle').click(); await sleep(60);
        ok('library: "Applies to…" by the hidden count opens it', !!B._body.querySelector('.adv-scope-row'));
        B._scopeOpen = false;
        if (H0){ B._hiddenBooks = H0; }
        closePanel('library');

        // #5 NPC Library: words where a symbol stood alone.
        openPanel('npclib'); await sleep(300);
        if (!panelDefs.npclib._selected()){ panelDefs.npclib._newNpc(); await sleep(100); }
        const nb = panelDefs.npclib._body;
        ok('npc: HP, AC and Init are labelled', ['HP', 'AC', 'Init'].every(t => [...nb.querySelectorAll('.npclib-stat .lab')].some(e => e.textContent.trim() === t)));
        ok('npc: "Select" says what the bulk button does, and the export is not an emoji',
           (nb.querySelector('#npclib-bulk-toggle') || {}).textContent === 'Select' && !/📷/.test(nb.innerHTML));
        closePanel('npclib');

        // #6 Loot: the totals and both buttons on one line.
        openPanel('loot'); await sleep(300);
        const sb = panelDefs.loot._body.querySelector('.loot-sumbar');
        // Centres, not tops: a button and a line of text differ in height.
        const mids = [...sb.children].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2); });
        ok('loot: the totals, Roll treasure and Divvy up share one line', Math.max(...mids) - Math.min(...mids) < 8, JSON.stringify(mids));
        closePanel('loot');
      } catch(e){ ok('toolbars: the checks ran to completion', false, e.message); }
      finally {
        window.showContextMenu = sm;
        document.querySelectorAll('.window-menu').forEach(m => m.remove());
        _remoteUpdate = true;
        try { if (NP0 == null) localStorage.removeItem('skt-npcs-v2'); else localStorage.setItem('skt-npcs-v2', NP0); } finally { _remoteUpdate = false; }
        panelDefs.npclib._npcs = null;
        Object.keys(layout).forEach(k => delete layout[k]); Object.assign(layout, JSON.parse(lay0)); saveLayout();
      }
      ok('toolbars: silent', errs.length === before, errs.slice(before).join(' | '));
    }

    // ── The NPC generator lives in the NPC Library ────────────────────────
    {
      const before = errs.length;
      const n0 = localStorage.getItem('skt-npcs-v2');
      const rt = window.showToast; window.showToast = () => {};
      try {
        const L = panelDefs.npclib, G = panelDefs.npcgen;
        ok('npc: no NPC Generator button in the dock', !document.querySelector('.dock-btn[data-panel="npcgen"]'));
        openPanel('npcgen'); await sleep(300);
        const w = document.querySelector('.window[data-panel="npclib"]');
        ok('npc: opening the generator opens the Library, generating in its right-hand pane',
           !!w && !document.querySelector('.window[data-panel="npcgen"]') && L._gen === true
           && !!G._body && w.querySelector('.npclib-right').contains(G._body));
        const count0 = L._npcs.length;
        G._body.querySelector('#npcgen-bulk').click(); await sleep(150);
        ok('npc: +5 drops five into the list and keeps generating', L._npcs.length === count0 + 5 && L._gen === true && !!G._body);
        G._body.querySelector('#npcgen-roll').click(); await sleep(60);
        const name = G._npc.name;
        G._body.querySelector('#npcgen-save').click(); await sleep(200);
        const sel = L._selected();
        ok('npc: Keep files it and opens it in the editor', L._npcs.length === count0 + 6 && !!sel && sel.name === name
           && L._gen === false && !G._body && !!w.querySelector('.npclib-detail'));
        w.querySelector('#npclib-gen').click(); await sleep(150);
        ok('npc: 🎲 in the toolbar starts generating again', L._gen === true && !!G._body);
        w.querySelector('.npclib-card').click(); await sleep(150);
        ok('npc: picking an NPC from the list leaves the generator', L._gen === false && !G._body);
        const ml = sktMigrateLayout({ npcgen: { x: 3, y: 4, w: 480, h: 540, open: true, z: 2 } });
        ok('layout: a saved layout with the generator open opens the Library, generating', ml.npclib && ml.npclib.open && ml.npclib.gen === true && !('npcgen' in ml));
      } catch(e){ ok('npc: the checks ran to completion', false, e.message); }
      finally {
        window.showToast = rt;
        try { closePanel('npclib'); } catch(e){}
        _remoteUpdate = true;
        try { if (n0 == null) localStorage.removeItem('skt-npcs-v2'); else localStorage.setItem('skt-npcs-v2', n0); }
        finally { _remoteUpdate = false; }
        panelDefs.npclib._npcs = null; panelDefs.npclib._gen = false;
      }
      ok('npc: silent', errs.length === before, errs.slice(before).join(' | '));
    }

    // ── One monster picker: combat, bestiary, encounter builder ───────────
    if (typeof _5eLoaded !== 'undefined' && _5eLoaded){
      const before = errs.length;
      const K0 = JSON.stringify(state.combatants), B0 = localStorage.getItem('skt-bestiary-v1');
      const E = panelDefs.encounter, M0 = JSON.stringify(E._monsters || []), EN0 = localStorage.getItem('skt-enc-v1');
      const rt = window.showToast; window.showToast = () => {};
      const hid0 = window.SKT_IS_SOURCE_HIDDEN;
      const rowFor = (name, src) => [...document.querySelectorAll('#mp-list .mp-row')].find(r =>
        r.querySelector('.mp-row-name').firstChild.textContent.trim() === name
        && (!src || (r.querySelector('.detail-source-badge') || {}).textContent === (typeof _formatSource === 'function' ? _formatSource(src) : src)));
      const type = async (q) => { const i = document.getElementById('mp-q'); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200); };
      try {
        // Combat.
        openPanel('combat'); await sleep(200);
        const C = panelDefs.combat;
        const n0 = state.combatants.length;
        C._openMonsterPicker(); await sleep(80);
        const mp = document.getElementById('mp-back');
        ok('picker: the Combat Tracker opens the shared picker', !!mp && /Add to combat/.test(mp.textContent) && !!mp.querySelector('#mp-n'));
        await type('goblin');
        const cr = mp.querySelector('#mp-cr'); cr.value = '1/4'; cr.dispatchEvent(new Event('change')); await sleep(60);
        const crs = [...mp.querySelectorAll('.mp-row-cr')].map(e => e.textContent);
        ok('picker: the CR filter narrows the list', crs.length > 0 && crs.every(t => t === 'CR 1/4'), crs.slice(0, 4).join(','));
        const row = rowFor('Goblin', 'MM') || rowFor('Goblin');
        row.click(); await sleep(40);
        ok('picker: choosing one shows it beside the list', /Goblin/.test(mp.querySelector('#mp-preview').textContent)
           && /AC/.test(mp.querySelector('#mp-preview').textContent));
        mp.querySelector('#mp-n').value = '3';
        mp.querySelector('[data-mp="add"]').click(); await sleep(150);
        const added = state.combatants.slice(n0);
        ok('picker: "how many" adds that many to the fight, and it stays open for the next',
           added.length === 3 && added.every(c => /^Goblin/.test(c.name)) && !!document.getElementById('mp-back')
           && /Added 3 × Goblin/.test(document.getElementById('mp-status').textContent), added.map(c => c.name).join(','));
        // Hidden books, by the caller's scope.
        const count = () => (document.getElementById('mp-count').textContent.match(/(\d+) match/) || [])[1];
        cr.value = ''; cr.dispatchEvent(new Event('change')); await sleep(60);
        const all = +count();
        mp.querySelector('[data-mp="close"]').click(); await sleep(30);
        // On top of whatever is already hidden, so a campaign's own hidden
        // books stay hidden and the count can only go down.
        window.SKT_IS_SOURCE_HIDDEN = (scope, src) => (scope === 'encounter' && src === 'MM') || (!!hid0 && hid0(scope, src));
        C._openMonsterPicker(); await sleep(80); await type('goblin');
        const fewer = +count();
        ok('picker: books hidden in the Books panel stay hidden when adding to a fight', fewer < all && !rowFor('Goblin', 'MM'), all + ' → ' + fewer);
        document.querySelector('#mp-back [data-mp="close"]').click(); await sleep(30);
        window.SKT_IS_SOURCE_HIDDEN = hid0;
        ok('picker: Done closes it', !document.getElementById('mp-back'));

        // Bestiary.
        openPanel('bestiary'); await sleep(250);
        const B = panelDefs.bestiary;
        const b0 = B._data.monsters.length;
        B._openMonsterPicker(); await sleep(80);
        ok('picker: the Bestiary opens the same picker', !!document.getElementById('mp-back') && /Add to bestiary/.test(document.getElementById('mp-back').textContent));
        await type('owlbear'); (rowFor('Owlbear', 'MM') || rowFor('Owlbear')).click();
        document.querySelector('#mp-back [data-mp="add"]').click(); await sleep(100);
        const nb = B._data.monsters[B._data.monsters.length - 1];
        ok('picker: and adds to the bestiary', B._data.monsters.length === b0 + 1 && nb.name === 'Owlbear' && !!nb.slug);
        document.querySelector('#mp-back [data-mp="close"]').click(); await sleep(30);
        closePanel('bestiary');

        // Encounter builder.
        openPanel('encounter'); await sleep(250); E._monsters = []; E._render();
        E._body.querySelector('#enc-add').click(); await sleep(80);
        ok('picker: the Encounter Builder opens the same picker', /Add to encounter/.test((document.getElementById('mp-back') || {}).textContent || ''));
        await type('goblin'); (rowFor('Goblin', 'MM') || rowFor('Goblin')).click();
        document.querySelector('#mp-n').value = '2'; document.querySelector('#mp-back [data-mp="add"]').click(); await sleep(80);
        document.querySelector('#mp-n').value = '1'; document.querySelector('#mp-back [data-mp="add"]').click(); await sleep(80);
        ok('picker: adding the same monster again adds to its row', E._monsters.length === 1 && E._monsters[0].count === 3, JSON.stringify(E._monsters));
        document.querySelector('#mp-back [data-mp="close"]').click(); await sleep(30);
        const names = E._searchPool('goblin').map(m => m.name + '|' + m._source);
        const shared = sktMonsterPool('encounter').filter(d => sktMonsterMatches(d, 'goblin')).slice(0, 30).map(d => d.name + '|' + d._source);
        ok('picker: one search rule everywhere', JSON.stringify(names) === JSON.stringify(shared) && names.length > 3);
      } catch(e){ ok('picker: the checks ran to completion', false, e.message); }
      finally {
        window.SKT_IS_SOURCE_HIDDEN = hid0; window.showToast = rt;
        document.getElementById('mp-back')?.remove();
        state.combatants = JSON.parse(K0); E._monsters = JSON.parse(M0); save();
        _remoteUpdate = true;
        try {
          if (B0 == null) localStorage.removeItem('skt-bestiary-v1'); else localStorage.setItem('skt-bestiary-v1', B0);
          if (EN0 == null) localStorage.removeItem('skt-enc-v1'); else localStorage.setItem('skt-enc-v1', EN0);
        } finally { _remoteUpdate = false; }
        panelDefs.bestiary._data = null;
        ['encounter', 'bestiary', 'combat'].forEach(id => { try { closePanel(id); } catch(e){} });
      }
      ok('picker: silent', errs.length === before, errs.slice(before).join(' | '));
    }

    // ── The dock says what each icon is ───────────────────────────────────
    {
      const btns = [...document.querySelectorAll('.panel-dock .dock-btn[data-panel]')];
      ok('dock: every panel button carries its name',
         btns.length >= 12 && btns.every(b => b.dataset.label && b.querySelector('.dock-label')),
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
      // The switch is redrawn with the panel, so it is looked up each time.
      const togEl = () => document.querySelector('.window[data-panel="party"] .party-head [data-party-compact]');
      const tog = togEl();
      ok('party: compact has a visible switch in the panel’s header row, not a bare icon in the title bar',
         !!tog && !document.querySelector('.window[data-panel="party"] .window-actions [data-party-compact]'));
      try {
        if (tog){
          if (state.settings.partyCompact) { togEl().click(); await sleep(100); }
          togEl().click(); await sleep(150);
          ok('party: the button turns compact on', !!state.settings.partyCompact && togEl().getAttribute('aria-pressed') === 'true');
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
    // A real campaign's names, at the default size: long, and given to a
    // character with a long name. The fixture's are short and unassigned, so
    // the check above passed while a live table's "Handaxe → Ulrick
    // Axeborne" got a 12px name box — the pill repeated the dropdown and took
    // the name's room.
    {
      const L = panelDefs.loot, l0 = JSON.stringify(L._loot), lay0 = JSON.stringify(layout.loot);
      try {
        closePanel('loot');
        layout.loot = { ...DEFAULT_LAYOUT.loot, open: false };
        const who = state.party.find(p => !p.foe);
        const nm0 = who.name; who.name = 'Ulrick Axeborne the Unyielding';
        L._loot = L._loot || { items: [] };
        L._loot.items = [
          { name: 'Instrument of the Bards, Cli Lyre', qty: 1, value: '5000 gp', assignedTo: who.id },
          { name: 'Handaxe', qty: 3, value: '5 gp', assignedTo: who.id },
          { name: 'Spell Scroll (Charm Person)', qty: 1, value: '50 gp' },
        ];
        openPanel('loot'); await sleep(350);
        const ins = [...L._body.querySelectorAll('.loot-item .loot-name-input')];
        const cutL = ins.filter(i => i.scrollWidth > i.clientWidth + 1);
        ok('loot: long names given to a long-named character fit at the default size',
           ins.length === 3 && cutL.length === 0, cutL.map(i => i.value + ' ' + i.clientWidth + '/' + i.scrollWidth).join(', '));
        ok('loot: who has it is said once, by the dropdown', !L._body.querySelector('.loot-assigned-pill')
           && L._body.querySelector('.loot-item .loot-assign').value === who.id);
        who.name = nm0;
        ok('layout: a Loot window saved at the old 480px default opens at the new one',
           sktMigrateLayout({ loot: { x: 1, y: 2, w: 480, h: 480, open: false } }).loot.w === 560
           && sktMigrateLayout({ loot: { x: 1, y: 2, w: 500, h: 480, open: false } }).loot.w === 500);
      } catch(e){ ok('loot: the long-name checks ran to completion', false, e.message); }
      finally { closePanel('loot'); L._loot = JSON.parse(l0); layout.loot = JSON.parse(lay0); loadDomain('party'); }
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
        // One history: Ctrl+Z with the battle map focused undoes the last
        // thing done, wherever it was — here, damage in the tracker.
        ok('undo: Ctrl+Z over the battle map still undoes the last thing done',
           hpOf(id) === hp0 && sktUndoDepth() === depth, JSON.stringify({ hp: hpOf(id), depth: sktUndoDepth(), was: depth }));

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
        // The list compares against this device's own signature, cached for
        // half a second; this test moves faster than that, so measure afresh.
        _presSig = null;
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
      const req0 = localStorage.getItem('skt-rollreq-v1');
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
        const req = JSON.parse(localStorage.getItem('skt-rollreq-v1'));
        ok('saves: the ask names the ability, the DC and what it is for',
           !!req && req.ab === 'DEX' && req.dc === 15 && req.showDc === true && req.name === 'Fireball'
           && req.pcs.length === 2 && !req.closed, JSON.stringify(req && { ab: req.ab, dc: req.dc, n: req.pcs.length }));
        ok('saves: their rows wait for them', back.querySelectorAll('.as-table tr.waiting').length === 2);
        ok('saves: and nothing can be applied while they do',
           back.querySelector('[data-as="apply"]').disabled === true);
        // One answers well, one badly.
        req.answers = { [pcs[0]]: { v: 23, rid: req.id, at: Date.now() } };
        saveJson('skt-rollreq-v1', req, 'save request');
        sktOnRollAnswers(); await sleep(60);
        ok('saves: an answer fills in that row',
           back.querySelectorAll('.as-table tr.waiting').length === 1
           && back.querySelectorAll('.as-table tr.ok').length === 1);
        ok('saves: an answer from an older ask is ignored', (() => {
          const stale = JSON.parse(localStorage.getItem('skt-rollreq-v1'));
          stale.answers[pcs[1]] = { v: 25, rid: 'sr_somethingelse', at: Date.now() };
          saveJson('skt-rollreq-v1', stale, 'save request');
          sktOnRollAnswers();
          return back.querySelectorAll('.as-table tr.waiting').length === 1;
        })());
        const r2 = JSON.parse(localStorage.getItem('skt-rollreq-v1'));
        r2.answers[pcs[1]] = { v: 4, rid: r2.id, at: Date.now() };
        saveJson('skt-rollreq-v1', r2, 'save request');
        sktOnRollAnswers(); await sleep(60);
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
           (JSON.parse(localStorage.getItem('skt-rollreq-v1')) || {}).closed === true);

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
           (JSON.parse(localStorage.getItem('skt-rollreq-v1')) || {}).closed === true);
        ok('saves: asking with no characters picked does nothing', C.askSaves({ ab: 'WIS', dc: 10, pcs: [] }) === null);
        // An answer from a player window in this same browser arrives as a
        // `storage` event, not through the sync layer.
        C.openAreaSave({ name: 'Relay', ab: 'DEX', dc: 10, parts: [], targets: pcs.slice(0, 1) });
        await sleep(80);
        const b3 = document.getElementById('area-save-back');
        b3.querySelector('[data-as="ask"]').click(); await sleep(60);
        const r3 = JSON.parse(localStorage.getItem('skt-rollreq-v1'));
        r3.answers = { [pcs[0]]: { v: 19, rid: r3.id, at: Date.now() } };
        const v3 = JSON.stringify(r3);
        _remoteUpdate = true;
        try { localStorage.setItem('skt-rollreq-v1', v3); } finally { _remoteUpdate = false; }
        window.dispatchEvent(new StorageEvent('storage', { key: 'skt-rollreq-v1', newValue: v3 }));
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
          if (req0 == null) localStorage.removeItem('skt-rollreq-v1'); else localStorage.setItem('skt-rollreq-v1', req0);
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
        ok('builder: both editions load thirteen classes, the Artificer from its own book', R24.classes.length === 13 && R14.classes.length === 13
          && sktRulesClass(R14, 'Artificer').source === 'TCE' && sktRulesClass(R24, 'Artificer').source === 'EFA');
        ok('builder: a book class’s features keep their rules text', ['2014', '2024'].every(ed => { const c = sktRulesClass(ed === '2014' ? R14 : R24, 'Artificer'); const f = c && c.features.find(x => x.name === 'Flash of Genius'); return f && /Intelligence modifier/.test(sktRulesText(f.entries)); }));
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
        { const wl = L => sktBuildSpellcasting(Object.assign(sktBlankBuild('2014'), { cls: 'Warlock', level: L }), R14, { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16 }).slots;
          ok('builder 2014: a warlock’s pact slots rise with its level (2nd at 3, 5th at 9 and 20)', JSON.stringify(wl(3)) === '{"2":2}' && JSON.stringify(wl(9)) === '{"5":2}' && JSON.stringify(wl(20)) === '{"5":4}', JSON.stringify([wl(3), wl(9), wl(20)])); }
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
        ok('builder: the summary shows passive Perception, size and languages', /Passive Perception/.test(q('.cb-side').textContent) && /Languages/.test(q('.cb-side').textContent));
        click('[data-cb-step="class"]'); await sleep(30); click('[data-cb-cls="Fighter"]'); await sleep(30);
        click('[data-cb-step="species"]'); await sleep(30); click('[data-cb-species="Dwarf"]'); await sleep(30);
        click('[data-cb-step="background"]'); await sleep(30); click('[data-cb-bg="Soldier"]'); await sleep(30);
        set('[data-cb-bg2]', 'str'); await sleep(20); set('[data-cb-bg1]', 'con'); await sleep(20);
        click('[data-cb-step="skills"]'); await sleep(30);
        tick('[data-cb-skill="perception"]'); await sleep(20); tick('[data-cb-skill="survival"]'); await sleep(20);
        tick('[data-cb-tool="background||Dice Set"]'); await sleep(20);
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

    // -- The character builder: feat spells, the spellbook, size, gold, details --
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R24 = await sktRulesLoad('2024'), R14 = await sktRulesLoad('2014');
        // A 2024 Acolyte's Magic Initiate is fixed to the cleric list.
        const mi = Object.assign(sktBlankBuild('2024'), { name: 'Mi', species: 'Human', cls: 'Fighter', level: 1, background: 'Acolyte' });
        const g0 = sktFeatSpellGrant(R24, mi, 'Magic Initiate');
        ok('feat spells: an Acolyte’s Magic Initiate is the cleric list, ability to choose',
           !!g0 && g0.listFixed && g0.block && g0.block.name === 'Cleric' && JSON.stringify(g0.abilityChoices) === '["int","wis","cha"]', g0 && g0.block && g0.block.name);
        ok('feat spells: two cantrips and one 1st-level spell to pick, all cleric',
           !!g0 && g0.choices.length === 2 && g0.choices[0].count === 1 && g0.choices[1].count === 2
           && g0.choices[0].options.includes('Bless') && !g0.choices[0].options.includes('Magic Missile') && g0.choices[1].options.includes('Guidance'));
        ok('feat spells: the builder asks for them until chosen', sktBuildTodo(mi, R24).some(t => /Magic Initiate/.test(t.what)));
        mi.featChoices = { 'Magic Initiate': { spellAbility: 'wis', spells: ['Guidance', 'Sacred Flame', 'Bless', 'Magic Missile'] } };
        const M = sktComputeCharacter(mi, R24);
        ok('feat spells: what was picked goes on the sheet — and nothing off the list',
           ['Guidance', 'Sacred Flame', 'Bless'].every(n => M.sheet.spells.includes(n)) && !M.sheet.spells.includes('Magic Missile'), M.sheet.spells);
        ok('feat spells: with how the 1st-level one is cast',
           (M.sheet.notes || []).some(n => /Magic Initiate \(Wisdom\).*Bless once per long rest/.test(n)), M.sheet.notes);
        ok('feat spells: and nothing left to choose', !sktBuildTodo(mi, R24).some(t => /Magic Initiate/.test(t.what)));
        // 2014: six lists to choose from.
        const g1 = sktFeatSpellGrant(R14, sktBlankBuild('2014'), 'Magic Initiate');
        ok('feat spells 2014: Magic Initiate offers six lists, none chosen yet', !!g1 && g1.blocks.length === 6 && !g1.block && g1.missing >= 1);
        // A wizard's spellbook.
        const wz = Object.assign(sktBlankBuild('2024'), { cls: 'Wizard', level: 3,
          abilities: { method: 'manual', base: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 } } });
        const wsc = sktBuildSpellcasting(wz, R24, sktBuildAbilities(wz, R24));
        ok('spellbook: a 3rd-level wizard has ten spells in the book', wsc.spellbook === 10, wsc.spellbook);
        ok('spellbook: the builder asks for them', sktBuildTodo(wz, R24).some(t => /spellbook/.test(t.what)));
        ok('spellbook: other casters have none', !sktBuildSpellcasting(Object.assign({}, wz, { cls: 'Cleric' }), R24, sktBuildAbilities(wz, R24)).spellbook);
        // Size, gold, details.
        const hu = Object.assign(sktBlankBuild('2024'), { species: 'Human', cls: 'Fighter', level: 1, background: 'Soldier', size: 'S',
          details: { alignment: 'Neutral Good', backstory: 'Grew up by the sea.' }, equipment: { cls: 'B', bg: 'A' } });
        const H = sktComputeCharacter(hu, R24);
        ok('size: a Human may be Small', H.sheet.size === 'Small', H.sheet.size);
        ok('size: and is Medium otherwise', sktComputeCharacter(Object.assign({}, hu, { size: '' }), R24).sheet.size === 'Medium');
        ok('size: a Dwarf cannot be Small', sktComputeCharacter(Object.assign({}, hu, { species: 'Dwarf' }), R24).sheet.size === 'Medium');
        ok('gold: the kit’s gold is kept on the character', H.gold === 25, H.gold);
        ok('gold: and what they have now survives a level up', sktComputeCharacter(hu, R24, { gold: 7 }).gold === 7);
        ok('details: alignment and backstory reach the sheet', H.sheet.details.alignment === 'Neutral Good' && /sea/.test(H.sheet.details.backstory));

        // The builder's screens (the 2024 rules, whatever was used last).
        await openCharBuilder({ edition: '2024' }); await sleep(150);
        const root = () => document.getElementById('cb-root');
        const q = s => root().querySelector(s), qa = s => [...root().querySelectorAll(s)];
        const click = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.click(); };
        const tick = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const set = (s, v) => { const e = q(s); if (!e) throw new Error('missing ' + s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const nm = q('[data-cb-in="name"]'); nm.value = 'Booka'; nm.dispatchEvent(new Event('input', { bubbles: true }));
        click('[data-cb-step="class"]'); await sleep(30); click('[data-cb-cls="Wizard"]'); await sleep(30);
        click('[data-cb-step="species"]'); await sleep(30); click('[data-cb-species="Human"]'); await sleep(30);
        ok('builder: a Human is offered Small or Medium', qa('[data-cb-size]').length === 2);
        click('[data-cb-size="S"]'); await sleep(30);
        ok('builder: and Small is kept', CB.build.size === 'S' && q('[data-cb-size="S"]').classList.contains('on'));
        click('[data-cb-species="Dwarf"]'); await sleep(30);
        ok('builder: a Dwarf has no size to choose', !q('[data-cb-size]'));
        click('[data-cb-species="Human"]'); await sleep(30); click('[data-cb-size="S"]'); await sleep(30);
        click('[data-cb-step="background"]'); await sleep(30); click('[data-cb-bg="Acolyte"]'); await sleep(30);
        click('[data-cb-step="spells"]'); await sleep(30);
        const books = qa('[data-cb-book]');
        ok('builder: a wizard writes spells into a book', books.length > 10 && !qa('[data-cb-spell]').length, books.length);
        for (const e of books.slice(0, 8)){ const s2 = e.dataset.cbBook; tick('[data-cb-book="' + CSS.escape(s2) + '"]'); await sleep(10); }
        ok('builder: six of them at 1st level', CB.build.spellbook.length === 6, CB.build.spellbook.length);
        const prep = qa('[data-cb-spell]').map(e => e.dataset.cbSpell);
        ok('builder: and prepares only from the book', prep.length === 6 && prep.every(n => CB.build.spellbook.includes(n)), prep.join(', '));
        tick('[data-cb-spell="' + CSS.escape(prep[0]) + '"]'); await sleep(20);
        tick('[data-cb-book="' + CSS.escape(prep[0]) + '"]'); await sleep(20);
        ok('builder: a spell taken out of the book is no longer prepared', !CB.build.spellbook.includes(prep[0]) && !CB.build.spells.includes(prep[0]));
        ok('builder: the Acolyte’s Magic Initiate asks for its spells here', !!q('[data-cb-fsab="Magic Initiate"]') && qa('[data-cb-fspell^="Magic Initiate||"]').length > 3);
        set('[data-cb-fsab="Magic Initiate"]', 'wis'); await sleep(20);
        tick('[data-cb-fspell="Magic Initiate||Guidance"]'); await sleep(20);
        tick('[data-cb-fspell="Magic Initiate||Bless"]'); await sleep(20);
        tick('[data-cb-fspell="Magic Initiate||Cure Wounds"]'); await sleep(20);
        const fc = CB.build.featChoices['Magic Initiate'] || {};
        ok('builder: the picks are kept, one 1st-level spell only', fc.spellAbility === 'wis' && fc.spells.includes('Guidance') && fc.spells.includes('Bless') && !fc.spells.includes('Cure Wounds'), JSON.stringify(fc));
        click('[data-cb-step="equipment"]'); await sleep(30);
        ok('builder: the equipment step says the gold is kept', /Starting gold: \d+ gp/.test(q('.cb-main').textContent));
        click('[data-cb-step="details"]'); await sleep(30);
        set('[data-cb-detail="alignment"]', 'Lawful Good'); await sleep(20);
        const bs = q('textarea[data-cb-detail="backstory"]'); bs.value = 'Raised in a temple.\nLeft it.'; bs.dispatchEvent(new Event('input', { bubbles: true }));
        ok('builder: typing a backstory does not redraw the page under you', q('textarea[data-cb-detail="backstory"]') === bs && CB.build.details.backstory === 'Raised in a temple.\nLeft it.');
        click('[data-cb-step="review"]'); await sleep(30);
        ok('builder: Review shows size, alignment and gold', /Small · Lawful Good · \d+ gp/.test((q('.cb-review-who') || {}).textContent || ''));
        // Skills and the rest are left unchosen: "Save anyway".
        const sc0 = window.showConfirm; window.showConfirm = () => Promise.resolve(true);
        try { click('[data-cb="save"]'); await sleep(200); } finally { window.showConfirm = sc0; }
        const made = state.party.find(p => p.name === 'Booka');
        ok('builder: the character keeps them all',
           !!made && typeof made.gold === 'number' && made.sheet.size === 'Small' && made.sheet.details.alignment === 'Lawful Good'
           && made.sheet.spellbook.length === 5 && made.sheet.spells.includes('Bless'), made && JSON.stringify({ g: made.gold, s: made.sheet.size }));
        // One sheet: the party card is a tracker, and its Sheet button opens
        // the full sheet, where size, alignment and gold live.
        openPanel('party'); await sleep(200);
        const P = panelDefs.party, pi = state.party.findIndex(p => p.id === made.id);
        const card = P._body.querySelector('.char-card[data-cidx="' + pi + '"]');
        ok('party: the card has no mini-sheet tabs of its own', !!card && !card.querySelector('.sheet-tab, .sheet-tab-strip, .sheet-content'));
        card.querySelector('[data-act="open-sheet"]').click(); await sleep(150);
        const csr = document.getElementById('cs-root');
        ok('party: its Sheet button opens the one full sheet', !!csr && CS.id === made.id);
        CS.tab = 'background'; csRender(); await sleep(20);
        ok('party: which shows size and alignment', /Small/.test(csr.textContent) && /Lawful Good/.test(document.querySelector('#cs-root [data-cs-detail="alignment"]').value));
        CS.tab = 'inventory'; csRender(); await sleep(20);
        const gin = document.querySelector('#cs-root [data-cs-coin="gp"]');
        gin.value = '42'; gin.dispatchEvent(new Event('change', { bubbles: true })); await sleep(30);
        ok('party: and its gold, changed there', state.party.find(p => p.id === made.id).gold === 42);
        csClose();
        // A roll from the card's ⋯ menu shows on the card itself.
        P._setLastRoll(state.party[pi], P._rollD20(3, { mode: 'normal', label: 'Booka · Initiative' })); P._render(); await sleep(30);
        ok('party: the card shows its last roll', /Initiative/.test(P._body.querySelector('.char-card[data-cidx="' + pi + '"]').textContent));
        closePanel('party');
      } catch(e){ ok('builder: the feat-spell / spellbook / details checks ran to completion', false, e.message); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- The character builder: other books -----------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const uniq = a => new Set(a.map(x => x.name)).size === a.length;
        ok('books 2014: species, backgrounds and feats from every 2014 book, the handbook’s marked',
           R14.species.length > 60 && R14.species.filter(x => x.core).length === 9 && R14.backgrounds.length > 80 && R14.feats.length > 90
           && R14.feats.filter(x => x.core).length === 42, [R14.species.length, R14.backgrounds.length, R14.feats.length].join('/'));
        ok('books: one of each name — reprints and repeats dropped', [R14.species, R14.backgrounds, R14.feats, R14.spells, R24.species, R24.backgrounds, R24.feats, R24.spells].every(uniq));
        ok('books 2014: the newer printing of a reprint (Multiverse Aasimar, not Volo’s)', (sktRulesSpecies(R14, 'Aasimar') || {}).source === 'MPMM');
        ok('books 2024: its own Aasimar, and older species the 2024 rules allow', (sktRulesSpecies(R24, 'Aasimar') || {}).source === 'XPHB' && (sktRulesSpecies(R24, 'Tabaxi') || {}).core === false);
        ok('books 2024: no 2014 handbook background', !R24.backgrounds.some(b => b.source === 'PHB'));
        ok('books 2024: an older spell renamed in the 2024 book appears once, by its 2024 name',
           !sktRulesSpell(R24, 'Feeblemind') && !!sktRulesSpell(R24, 'Befuddlement') && !sktRulesSpell(R24, 'Summon Draconic Spirit') && !!sktRulesSpell(R24, 'Summon Dragon')
           && !!sktRulesSpell(R14, 'Feeblemind') && !sktRulesSpell(R14, 'Befuddlement'));
        ok('books 2014: where two books print a species, Multiverse’s', (sktRulesSpecies(R14, 'Hobgoblin') || {}).source === 'MPMM' && (sktRulesSpecies(R14, 'Triton') || {}).source === 'MPMM');
        const wz14 = Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', level: 1 });
        const can = (R, b) => sktSpellOptions(R, b, 0).map(s => s.name);
        ok('books: Xanathar’s spells only with other books on', !can(R14, wz14).includes('Toll the Dead') && can(R14, Object.assign({}, wz14, { allBooks: true })).includes('Toll the Dead'));
        ok('books: the handbook’s spell lists unchanged with them off', sktSpellOptions(R14, wz14, 1).every(s => s.core) && sktSpellOptions(R14, wz14, 1).length >= 30);
        // A species' spells.
        const tf = L => sktSpeciesSpellGrant(R14, Object.assign(sktBlankBuild('2014'), { species: 'Tiefling', cls: 'Fighter', level: L }));
        ok('species spells: a Tiefling knows Thaumaturgy, gains Hellish Rebuke at 3rd and Darkness at 5th',
           JSON.stringify(tf(1).spells) === '["Thaumaturgy"]' && tf(3).daily.includes('Hellish Rebuke') && !tf(3).spells.includes('Darkness') && tf(5).spells.includes('Darkness') && tf(5).ability === 'cha');
        const he = Object.assign(sktBlankBuild('2014'), { name: 'He', species: 'Elf', subspecies: 'High', cls: 'Fighter', level: 1 });
        ok('species spells: a High Elf is asked for a wizard cantrip', sktBuildTodo(he, R14).some(t => t.step === 'species' && /spells/.test(t.what)));
        he.speciesChoice = { spells: ['Fire Bolt'] };
        const HE = sktComputeCharacter(he, R14);
        ok('species spells: and has it', HE.sheet.spells.includes('Fire Bolt') && !sktBuildTodo(he, R14).some(t => t.step === 'species') && (HE.sheet.notes || []).some(n => /High Elf \(Intelligence\): Fire Bolt/.test(n)), HE.sheet.notes);
        const t24 = Object.assign(sktBlankBuild('2024'), { species: 'Tiefling', cls: 'Fighter', level: 3 });
        ok('species spells 2024: a Tiefling is asked for a legacy', sktBuildTodo(t24, R24).some(t => t.what === 'a lineage'));
        t24.speciesChoice = { lineage: 'Infernal', spellAbility: 'cha' };
        ok('species spells 2024: the Infernal legacy’s spells, Hellish Rebuke at 3rd', sktComputeCharacter(t24, R24).sheet.spells.includes('Hellish Rebuke') && sktComputeCharacter(t24, R24).sheet.spells.includes('Fire Bolt'));
        // A Multiverse species: increases anywhere, other speeds.
        const tb = Object.assign(sktBlankBuild('2014'), { name: 'Tb', species: 'Tabaxi', cls: 'Rogue', level: 1, abilities: { method: 'manual', base: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 } } });
        ok('books: a Tabaxi asks where its increases go', JSON.stringify(sktSpeciesAsiChoice(sktRulesSpecies(R14, 'Tabaxi'), null)) === '{"flex":true}' && sktBuildTodo(tb, R14).some(t => /ability increases/.test(t.what)));
        tb.speciesAsi = { dex: 2, cha: 1 };
        const TB = sktComputeCharacter(tb, R14);
        ok('books: and applies them, with its climbing speed', TB.abilities.dex === 16 && TB.abilities.cha === 11 && (TB.sheet.notes || []).some(n => /Climb 30 ft/.test(n))
           && !sktBuildTodo(tb, R14).some(t => /ability increases/.test(t.what)), JSON.stringify(TB.abilities));
        // A Tasha's feat.
        const ft = Object.assign(sktBlankBuild('2014'), { cls: 'Fighter', level: 4, allBooks: true, asi: { 4: { type: 'feat', feat: 'Fey Touched' } } });
        const fg = sktFeatSpellGrant(R14, ft, 'Fey Touched');
        const fg0 = sktFeatSpellGrant(R14, Object.assign({}, ft, { allBooks: false }), 'Fey Touched');
        ok('books: its picks come from the handbook unless other books are on',
           fg0.choices[0].options.every(n => (sktRulesSpell(R14, n) || {}).core) && sktFeatSpellGrant(R14, ft, 'Fey Touched').choices[0].options.some(n => !(sktRulesSpell(R14, n) || {}).core));
        ok('books: Fey Touched gives Misty Step and a 1st-level divination or enchantment', !!fg && fg.spells.includes('Misty Step') && fg.choices[0].options.includes('Bless') && !fg.choices[0].options.includes('Magic Missile'));

        // The builder's screens.
        await openCharBuilder({ edition: '2014' }); await sleep(800);
        const root = () => document.getElementById('cb-root');
        const q = s => root().querySelector(s), qa = s => [...root().querySelectorAll(s)];
        const click = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.click(); };
        const tick = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const set = (s, v) => { const e = q(s); if (!e) throw new Error('missing ' + s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const nm = q('[data-cb-in="name"]'); nm.value = 'Bookworm'; nm.dispatchEvent(new Event('input', { bubbles: true }));
        ok('builder: Basics has the other-books switch, off', !!q('[data-cb-allbooks]') && !q('[data-cb-allbooks]').checked && !CB.build.allBooks);
        click('[data-cb-step="species"]'); await sleep(30);
        ok('builder: the handbook’s nine species without it', qa('[data-cb-species]').length === 9 && !q('[data-cb-species="Tabaxi"]'));
        tick('[data-cb-allbooks]'); await sleep(30);
        ok('builder: with it, the rest under “Other books”, each naming its book',
           CB.build.allBooks && qa('[data-cb-species]').length > 60 && /Other books/.test(q('.cb-books-h').textContent) && /MPMM/.test(q('[data-cb-species="Tabaxi"]').textContent));
        click('[data-cb-species="Tabaxi"]'); await sleep(30);
        set('[data-cb-spflex="2"]', 'dex'); await sleep(20); set('[data-cb-spflex="1"]', 'cha'); await sleep(20);
        ok('builder: +2 and +1 where you want them', JSON.stringify(CB.build.speciesAsi) === '{"dex":2,"cha":1}', JSON.stringify(CB.build.speciesAsi));
        set('[data-cb-spflex="1"]', 'dex'); await sleep(20);
        ok('builder: not both on the same score', JSON.stringify(CB.build.speciesAsi) === '{"dex":1}', JSON.stringify(CB.build.speciesAsi));
        click('[data-cb-spmode="111"]'); await sleep(20);
        ['str', 'con', 'wis', 'int'].forEach(k => tick('[data-cb-spasi="' + k + '"]'));
        await sleep(30);
        ok('builder: or three +1s', JSON.stringify(CB.build.speciesAsi) === '{"str":1,"con":1,"wis":1}', JSON.stringify(CB.build.speciesAsi));
        click('[data-cb-species="Elf"]'); await sleep(30); click('[data-cb-subspecies="High"]'); await sleep(30);
        ok('builder: a High Elf picks its cantrip on the species step', qa('[data-cb-fspell^="@species||"]').length > 10);
        tick('[data-cb-fspell="@species||Fire Bolt"]'); await sleep(20);
        ok('builder: and it is kept', JSON.stringify(CB.build.speciesChoice.spells) === '["Fire Bolt"]');
        click('[data-cb-subspecies="Wood"]'); await sleep(30);
        ok('builder: another subrace starts that over', !CB.build.speciesChoice.spells);
        click('[data-cb-step="background"]'); await sleep(30);
        ok('builder: backgrounds from other books too', qa('[data-cb-bg]').length > 80 && !!q('[data-cb-bg="Far Traveler"]'));
        click('[data-cb-step="class"]'); await sleep(30); click('[data-cb-cls="Wizard"]'); await sleep(30);
        click('[data-cb-step="spells"]'); await sleep(30);
        ok('builder: Xanathar’s cantrips for a wizard', !!q('[data-cb-cantrip="Toll the Dead"]'));
        tick('[data-cb-cantrip="Toll the Dead"]'); await sleep(20);
        click('[data-cb-step="review"]'); await sleep(30);
        const sc0 = window.showConfirm; window.showConfirm = () => Promise.resolve(true);
        try { click('[data-cb="save"]'); await sleep(200); } finally { window.showConfirm = sc0; }
        const i = state.party.findIndex(p => p.name === 'Bookworm');
        ok('builder: the switch is saved with the character', i >= 0 && state.party[i].build.allBooks === true && state.party[i].sheet.spells.includes('Toll the Dead'));
        // A character from before the switch, using another book, opens with it on.
        const old = JSON.parse(JSON.stringify(state.party[i].build)); delete old.allBooks;
        ok('builder: an older character using another book opens with it on', cbUsesOtherBooks(old, R14) && !cbUsesOtherBooks(Object.assign({}, old, { cantrips: [], species: 'Dwarf', subspecies: 'Hill' }), R14));
      } catch(e){ ok('builder: the other-books checks ran to completion', false, e.message); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- The character builder: magic items and gear ---------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014'), M14 = await sktMagicLoad('2014');
        const M24 = await sktMagicLoad('2024');
        const f = (M, n) => M.find(m => m.name === n);
        ok('items: the magic item list for each edition, one of each name',
           M14.length > 1000 && M24.length > 1000 && new Set(M14.map(m => m.name)).size === M14.length && new Set(M24.map(m => m.name)).size === M24.length);
        ok('items: an item the 2024 book made a variant is listed once, as the variant', (f(M24, 'Dwarven Plate') || {}).kind === 'variant' && (f(M14, 'Dwarven Plate') || {}).kind === 'item');
        ok('items: a 2014 Flame Tongue is a sword', JSON.stringify(sktMagicBases(R14, f(M14, 'Flame Tongue'))) === '["greatsword","longsword","rapier","scimitar","shortsword"]');
        ok('items: a +1 Shield is a shield, and no +1 net', JSON.stringify(sktMagicBases(R14, f(M14, '+1 Shield'))) === '["shield"]'
           && sktMagicBases(R14, f(M14, '+1 Weapon')).includes('longsword') && !sktMagicBases(R14, f(M14, '+1 Weapon')).includes('net'));
        { const R24 = await sktRulesLoad('2024'); const am = sktMagicBases(R24, f(M24, '+1 Ammunition'));
          ok('items: ammunition matches whichever book printed it', am.includes('crossbow bolt') && am.includes('arrow'), am.join(',')); }
        ok('items: +1 Armor is any armour, not a shield', sktMagicBases(R14, f(M14, '+1 Armor')).includes('plate armor') && !sktMagicBases(R14, f(M14, '+1 Armor')).includes('shield'));
        const fi = Object.assign(sktBlankBuild('2014'), { name: 'F', species: 'Human', cls: 'Fighter', level: 1, background: 'Soldier',
          abilities: { method: 'manual', base: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 } }, equipment: { cls: 'A', bg: 'A' } });
        const F0 = sktComputeCharacter(fi, R14);
        const mk = (n, base) => sktMagicMake(R14, f(M14, n), base);
        fi.items = [mk('+1 Weapon', 'longsword'), mk('Cloak of Protection'), mk('Gauntlets of Ogre Power'), mk('+1 Armor', 'plate armor')];
        const F1 = sktComputeCharacter(fi, R14);
        const ls = a => (a.sheet.attacks.find(x => x.name === '+1 Longsword') || {});
        ok('items: a +1 longsword hits and hurts one better', ls(F1).atkBonus === '+6' && ls(F1).damage === '1d8+4 slashing', JSON.stringify(ls(F1)));
        ok('items: +1 plate is worn over chain mail', F1.ac === F0.ac + 2 + 1 && /\+1 Plate Armor/.test(F1.sheet.acSource), F0.ac + ' → ' + F1.ac + ' ' + F1.sheet.acSource);
        ok('items: an item that needs attunement does nothing until attuned', F1.abilities.str === 16 && F1.sheet.saves.str === F0.sheet.saves.str);
        fi.items[1].attuned = true; fi.items[2].attuned = true;
        const F2 = sktComputeCharacter(fi, R14);
        ok('items: attuned, the Cloak adds 1 to AC and saves, the Gauntlets make STR 19',
           F2.ac === F1.ac + 1 && F2.sheet.saves.dex === F1.sheet.saves.dex + 1 && F2.abilities.str === 19, F2.ac + ' ' + F2.abilities.str);
        ok('items: and the sheet lists them, saying which are attuned', F2.sheet.equipment.includes('Cloak of Protection (attuned)') && F2.sheet.equipment.includes('+1 Longsword'));
        // A weapon that needs attunement is an ordinary one until attuned.
        const ha = Object.assign(sktBlankBuild('2014'), fi, { items: [sktMagicMake(R14, f(M14, 'Holy Avenger'), 'longsword')] });
        const haAtk = b2 => (sktComputeCharacter(b2, R14).sheet.attacks.find(x => x.name === 'Holy Avenger Longsword' || /Holy Avenger/.test(x.name)) || {}).atkBonus;
        ok('items: a Holy Avenger is +0 until attuned, +3 after', haAtk(ha) === '+5' && (ha.items[0].attuned = true, haAtk(ha) === '+8'), haAtk(ha));
        // Gauntlets never lower a score.
        fi.abilities.base.str = 20;
        ok('items: a score item never lowers a score', sktComputeCharacter(fi, R14).abilities.str === 20);
        fi.abilities.base.str = 16;
        // Three attuned at most.
        fi.items.push(Object.assign(mk('Ring of Protection'), { attuned: true }), Object.assign(mk('Cloak of Protection'), { attuned: true }));
        ok('items: only three attuned items work', sktComputeCharacter(fi, R14).ac === F2.ac + 1, sktComputeCharacter(fi, R14).ac);
        // Bracers of Defense: only without armour or a shield.
        const mo = Object.assign(sktBlankBuild('2014'), { cls: 'Monk', level: 1, abilities: { method: 'manual', base: { str: 10, dex: 16, con: 12, int: 10, wis: 14, cha: 8 } },
                                 items: [Object.assign(mk('Bracers of Defense'), { attuned: true })] });
        ok('items: Bracers of Defense on an unarmoured monk', sktComputeCharacter(mo, R14).ac === 10 + 3 + 2 + 2);
        fi.items = [Object.assign(mk('Bracers of Defense'), { attuned: true })];
        ok('items: and not over chain mail', sktComputeCharacter(fi, R14).ac === F0.ac);
        // Spell attack and DC.
        const wz = Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', level: 1, abilities: { method: 'manual', base: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 8 } } });
        const W0 = sktComputeCharacter(wz, R14);
        wz.items = [Object.assign(mk('+2 Wand of the War Mage'), { attuned: true })];
        ok('items: a Wand of the War Mage raises the spell attack', sktComputeCharacter(wz, R14).sheet.spellAtkBonus === sktSigned(parseInt(W0.sheet.spellAtkBonus, 10) + 2), sktComputeCharacter(wz, R14).sheet.spellAtkBonus);

        // The builder's equipment step.
        await openCharBuilder({ edition: '2014' }); await sleep(800);
        const root = () => document.getElementById('cb-root');
        const q = s => root().querySelector(s), qa = s => [...root().querySelectorAll(s)];
        const click = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.click(); };
        const tick = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const set = (s, v) => { const e = q(s); if (!e) throw new Error('missing ' + s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const nm = q('[data-cb-in="name"]'); nm.value = 'Gearhead'; nm.dispatchEvent(new Event('input', { bubbles: true }));
        click('[data-cb-step="class"]'); await sleep(30); click('[data-cb-cls="Fighter"]'); await sleep(30);
        click('[data-cb-step="equipment"]'); await sleep(400);
        ok('builder: the equipment step lists magic items to add', qa('#cb-magic-dl option').length > 1000 && !!q('[data-cb-magicq]'));
        const mq = q('[data-cb-magicq]'); mq.value = '+1 Wea'; mq.dispatchEvent(new Event('input', { bubbles: true }));
        ok('builder: typing searches without redrawing', q('[data-cb-magicq]') === mq && CB.magicQ === '+1 Wea');
        set('[data-cb-magicq]', '+1 Weapon'); await sleep(30);
        ok('builder: a variant asks which weapon', !!q('[data-cb-magicbase]') && q('[data-cb="magic-add"]').disabled);
        set('[data-cb-magicbase]', 'longsword'); await sleep(30);
        click('[data-cb="magic-add"]'); await sleep(30);
        set('[data-cb-magicq]', 'Cloak of Protection'); await sleep(30);
        ok('builder: what an item does is shown before adding it', /bonus to AC/.test((q('.cb-gear-prev') || {}).textContent || ''));
        click('[data-cb="magic-add"]'); await sleep(30);
        set('[data-cb-magicq]', 'Shield'); await sleep(30); click('[data-cb="magic-add"]'); await sleep(30);
        ok('builder: the items are on the character', JSON.stringify(CB.build.items.map(m => m.name)) === '["+1 Longsword","Cloak of Protection","Shield"]', JSON.stringify(CB.build.items.map(m => m.name)));
        const acA = CB.rec.ac;
        tick('[data-cb-attune="1"]'); await sleep(30);
        ok('builder: attuning the cloak raises AC on the spot', CB.build.items[1].attuned && CB.rec.ac === acA + 1 && /Attuned: 1 of 3/.test(q('.cb-main').textContent));
        ok('builder: the result shows the +1 longsword', /\+1 Longsword/.test(q('.cb-attacks').textContent));
        // A fourth attunement is refused.
        const keep = CB.build.items;
        CB.build.items = keep.concat([0, 1, 2].map(() => Object.assign(sktMagicMake(CB.R, CB.magic.find(m => m.name === 'Ring of Protection')), {})));
        CB.build.items[3].attuned = true; CB.build.items[4].attuned = true; cbRender(); await sleep(20);
        tick('[data-cb-attune="5"]'); await sleep(20);
        ok('builder: no more than three attuned', !CB.build.items[5].attuned && CB.build.items.filter(m => m.attuned).length === 3);
        CB.build.items = keep; cbRender(); await sleep(20);
        click('[data-cb-itemdel="2"]'); await sleep(30);
        ok('builder: Remove takes an item off', CB.build.items.length === 2);
        click('[data-cb-step="review"]'); await sleep(30);
        const sc0 = window.showConfirm; window.showConfirm = () => Promise.resolve(true);
        try { click('[data-cb="save"]'); await sleep(200); } finally { window.showConfirm = sc0; }
        const g = state.party.find(p => p.name === 'Gearhead');
        ok('builder: saved with the character', !!g && g.build.items.length === 2 && g.sheet.equipment.includes('Cloak of Protection (attuned)'));
      } catch(e){ ok('builder: the magic item checks ran to completion', false, e.message); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- The character builder: multiclassing -----------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const base = { str: 15, dex: 14, con: 14, int: 14, wis: 10, cha: 8 };
        const fw = Object.assign(sktBlankBuild('2014'), { name: 'Mc', species: 'Human', cls: 'Fighter', subclass: 'Champion', level: 5,
          abilities: { method: 'manual', base }, equipment: { cls: 'A', bg: 'A' },
          multi: [{ cls: 'Wizard', subclass: '', level: 2, skills: ['arcana'], cantrips: ['Fire Bolt', 'Mage Hand', 'Light'], spells: ['Shield'], spellbook: ['Shield', 'Sleep'] }] });
        const FW = sktComputeCharacter(fw, R14);
        ok('multiclass: Fighter 3 / Wizard 2 — each class at its own level',
           JSON.stringify(FW.sheet.classLevels.map(p => p.cls + p.level)) === '["fighter3","wizard2"]' && FW.level === 5);
        ok('multiclass: hit points by each class’s die (10+2, then 2×(6+2) and 2×(4+2))', FW.hpMax === 40 && FW.sheet.hitDiceByClass === '3d10 + 2d6', FW.hpMax);
        const fl = FW.sheet.featureList.map(f => f.name);
        ok('multiclass: a 3rd-level fighter’s features and a 2nd-level wizard’s — no Extra Attack',
           ['Action Surge', 'Improved Critical', 'Arcane Recovery'].every(n => fl.includes(n)) && !fl.includes('Extra Attack') && FW.sheet.attacksPerAction === 1);
        ok('multiclass: only the first class’s saving throws', FW.sheet.saveProf.includes('str') && !FW.sheet.saveProf.includes('int'));
        ok('multiclass: a wizard’s spells with the character’s proficiency (DC 8+3+2)', FW.sheet.spellSaveDc === 13 && FW.sheet.spells.includes('Fire Bolt') && JSON.stringify(Object.keys(FW.sheet.spellSlots)) === '["1"]' && FW.sheet.spellSlots[1].total === 3);
        ok('multiclass: the skill the second class gives', FW.sheet.skillProf.arcana === 1);
        ok('multiclass: the second class’s subclass is asked for', sktBuildTodo(fw, R14).some(t => t.what === 'an arcane tradition for Wizard'));
        const pal = Object.assign(sktBlankBuild('2014'), { cls: 'Paladin', level: 5, abilities: { method: 'manual', base: { str: 15, dex: 10, con: 14, int: 8, wis: 10, cha: 15 } },
          multi: [{ cls: 'Sorcerer', subclass: 'Draconic Bloodline', level: 3 }] });
        const PS = sktComputeCharacter(pal, R14).sheet.spellSlots;
        ok('multiclass: Paladin 2 / Sorcerer 3 casts as a 4th-level caster (4 + 3 slots)', PS[1].total === 4 && PS[2].total === 3 && !PS[3]);
        const wl = Object.assign({}, pal, { cls: 'Warlock', subclass: 'The Fiend' });
        const WL = sktComputeCharacter(wl, R14);
        ok('multiclass: a warlock’s pact slots stay their own', WL.sheet.spellSlots[1].total === 6 && WL.sheet.notes.some(n => /Pact Magic: 2 of the level 1 slots/.test(n)));
        const bf = Object.assign(sktBlankBuild('2014'), { cls: 'Barbarian', level: 5, abilities: { method: 'manual', base }, multi: [{ cls: 'Fighter', level: 3, subclass: 'Champion' }] });
        ok('multiclass: a 2nd-level barbarian rages twice, whatever else they are', (sktComputeCharacter(bf, R14).resources.find(r => r.name === 'Rage') || {}).max === 2);
        const p3 = sktComputeCharacter(Object.assign({}, pal, { multi: [{ cls: 'Sorcerer', subclass: 'Draconic Bloodline', level: 2 }] }), R14).sheet.spellSlots;
        ok('multiclass: a paladin’s levels count half, rounded down in 2014 (Paladin 3 / Sorcerer 2 → 4 + 2)', p3[1].total === 4 && p3[2].total === 2, JSON.stringify(p3));
        const wf = Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', level: 2, abilities: { method: 'manual', base }, multi: [{ cls: 'Fighter', level: 1 }] });
        ok('multiclass: a fighter’s armour training comes with it', ['light', 'medium'].every(a => sktComputeCharacter(wf, R14).sheet.proficiencies.armor.includes(a)) && !sktComputeCharacter(wf, R14).sheet.proficiencies.armor.includes('heavy'));
        const fp = Object.assign(sktBlankBuild('2014'), { cls: 'Fighter', level: 3, abilities: { method: 'manual', base }, multi: [{ cls: 'Paladin', level: 2 }] });
        ok('multiclass: a fighting style from each class', (sktOptionalChoices(fp, R14).find(o => o.name === 'Fighting Style') || {}).count === 2);
        const fw4 = Object.assign({}, fw, { level: 8, multi: [Object.assign({}, fw.multi[0], { level: 4 })], asi: { 4: { type: 'asi', inc: { str: 1 } }, 'wizard@4': { type: 'asi', inc: { int: 2 } } } });
        ok('multiclass: each class’s ability score improvements', JSON.stringify(sktAsiSlots(fw4, R14).map(s => s.key)) === '["4","wizard@4"]' && sktComputeCharacter(fw4, R14).abilities.int === 16 && sktComputeCharacter(fw4, R14).abilities.str === 16);
        ok('multiclass: and one that no longer exists does nothing', sktComputeCharacter(Object.assign({}, fw4, { level: 7, multi: [Object.assign({}, fw.multi[0], { level: 3 })] }), R14).abilities.int === 14);
        ok('multiclass: the 13s it asks for', sktMulticlassNeedText(R14, 'Paladin') === 'STR 13 and CHA 13' && sktMulticlassNeedText(R14, 'Fighter') === 'STR 13 or DEX 13'
           && sktMulticlassNeedText(R24, 'Monk') === 'DEX 13 and WIS 13' && !sktMulticlassOk(R24, 'Monk', { dex: 13, wis: 12 }) && sktMulticlassOk(R14, 'Fighter', { str: 8, dex: 13 }));
        const one = sktComputeCharacter(Object.assign({}, fw, { multi: [] }), R14);
        ok('multiclass: a single-class character is as before', one.hpMax === 44 && one.sheet.attacksPerAction === 2 && one.sheet.classLevels.length === 1);

        // The builder.
        await openCharBuilder({ edition: '2014' }); await sleep(800);
        const root = () => document.getElementById('cb-root');
        const q = s => root().querySelector(s), qa = s => [...root().querySelectorAll(s)];
        const click = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.click(); };
        const tick = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const set = (s, v) => { const e = q(s); if (!e) throw new Error('missing ' + s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const nm = q('[data-cb-in="name"]'); nm.value = 'Duo'; nm.dispatchEvent(new Event('input', { bubbles: true }));
        const lv = q('[data-cb-in="level"]'); lv.value = '5'; lv.dispatchEvent(new Event('input', { bubbles: true }));
        click('[data-cb-step="class"]'); await sleep(30); click('[data-cb-cls="Fighter"]'); await sleep(30);
        ok('builder: the Class step offers another class', !!q('[data-cb-mcadd]'));
        set('[data-cb-mcadd]', 'Wizard'); await sleep(30);
        ok('builder: adding one takes a level from the first', CB.build.multi.length === 1 && sktClassLevels(CB.build, CB.R)[0].level === 4);
        click('[data-cb-mclvl="0:1"]'); await sleep(30);
        ok('builder: + gives it another', CB.build.multi[0].level === 2 && /Fighter 3 \/ Wizard 2/.test(q('.cb-sheet-sub').textContent), q('.cb-sheet-sub').textContent);
        ok('builder: its subclass, once it reaches one', qa('[data-cb-mcsub]').length >= 8);
        click('[data-cb-mcsub="0||Evocation"]'); await sleep(30);
        ok('builder: the subclass is kept on the class, and a wizard gives no skill', CB.build.multi[0].subclass === 'Evocation' && !q('[data-cb-mcskill]'));
        set('[data-cb-mcadd]', 'Rogue'); await sleep(30);
        tick('[data-cb-mcskill="1||stealth"]'); await sleep(30); tick('[data-cb-mcskill="1||acrobatics"]'); await sleep(30);
        ok('builder: a rogue gives one skill', JSON.stringify(CB.build.multi[1].skills) === '["stealth"]' && CB.rec.sheet.skillProf.stealth === 1);
        click('[data-cb-mcdel="1"]'); await sleep(30);
        ok('builder: Remove drops a class, its level back to the first', CB.build.multi.length === 1 && sktClassLevels(CB.build, CB.R)[0].level === 3);
        click('[data-cb-step="spells"]'); await sleep(30);
        ok('builder: the wizard’s spells on the Spells step', /Wizard spells/.test(q('.cb-main').textContent) && !!q('[data-cb-mcspell="0|cantrips|Fire Bolt"]'));
        tick('[data-cb-mcspell="0|cantrips|Fire Bolt"]'); await sleep(20);
        tick('[data-cb-mcspell="0|spellbook|Shield"]'); await sleep(20);
        tick('[data-cb-mcspell="0|spells|Shield"]'); await sleep(20);
        ok('builder: kept with the wizard', JSON.stringify(CB.build.multi[0].cantrips) === '["Fire Bolt"]' && CB.build.multi[0].spells.includes('Shield') && CB.rec.sheet.spells.includes('Fire Bolt'));
        const lv2 = q('[data-cb-step="basics"]'); lv2.click(); await sleep(30);
        const lvi = q('[data-cb-in="level"]'); lvi.value = '2'; lvi.dispatchEvent(new Event('input', { bubbles: true })); await sleep(30);
        ok('builder: lowering the level trims the other classes first', CB.build.multi[0].level === 1 && sktClassLevels(CB.build, CB.R)[0].level === 1);
        lvi.value = '5'; lvi.dispatchEvent(new Event('input', { bubbles: true })); await sleep(30);
        click('[data-cb-step="review"]'); await sleep(30);
        const sc0 = window.showConfirm; window.showConfirm = () => Promise.resolve(true);
        try { click('[data-cb="save"]'); await sleep(200); } finally { window.showConfirm = sc0; }
        const i = state.party.findIndex(p => p.name === 'Duo');
        ok('builder: saved with both classes', i >= 0 && JSON.stringify(state.party[i].sheet.classLevels.map(p => p.cls + p.level)) === '["fighter4","wizard1"]');
        openPanel('party'); await sleep(200);
        ok('party: the card names both classes', [...panelDefs.party._body.querySelectorAll('.char-subline')].some(e => /fighter 4 \/ wizard 1/.test(e.textContent)));
        closePanel('party');
        // Level up: the new level can go to either class.
        await openCharBuilder({ idx: i, levelup: true }); await sleep(150);
        ok('builder: level up asks which class gets the level', qa('[data-cb-lvlto]').length === 2 && sktClassLevels(CB.build, CB.R)[0].level === 5);
        click('[data-cb-lvlto="0"]'); await sleep(30);
        ok('builder: given to the wizard', CB.build.multi[0].level === 2 && sktClassLevels(CB.build, CB.R)[0].level === 4 && /Sculpt Spells/.test(q('.cb-new').textContent) && !/Extra Attack/.test(q('.cb-new').textContent), q('.cb-new').textContent.slice(0, 200));
        click('[data-cb-lvlto="first"]'); await sleep(30);
        ok('builder: and back to the fighter', CB.build.multi[0].level === 1 && sktClassLevels(CB.build, CB.R)[0].level === 5 && /Extra Attack/.test(q('.cb-new').textContent));
        // A wizard multiclassed into a cleric prepares from its own levels:
        // Wizard 3 / Cleric 2 has 3rd-level slots, but a 3rd-level wizard
        // knows no 3rd-level spells.
        Object.assign(CB.build, { cls: 'Wizard', subclass: 'Evocation', level: 5, multi: [{ cls: 'Cleric', subclass: 'Life Domain', level: 2 }], spellbook: [], spells: [], cantrips: [] });
        CB.step = 'spells'; cbRender(); await sleep(30);
        ok('builder: the first class’s spells stop at its own level', !!q('[data-cb-book="Magic Missile"]') && !q('[data-cb-book="Fireball"]') && CB.rec.sheet.spellSlots[3] && CB.rec.sheet.spellSlots[3].total === 2);
        cbClose();
      } catch(e){ ok('builder: the multiclass checks ran to completion', false, e.message); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Party card: death saves between fights -------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember, d: window.sktD };
      try {
        window._findCombatantForPartyMember = () => -1; window.sktD = () => 12;
        openPanel('party'); await sleep(200);
        const P = panelDefs.party;
        state.party[0] = { ...state.party[0], hp: 3, tempHp: 0 }; save(); P._render();
        P._applyHpDelta(0, -10, null); await sleep(30);
        const btn = P._body.querySelector('[data-act="death-roll"]');
        ok('party: a downed PC between fights gets a death-save button', !!btn && /0\/3 saves/.test(btn.textContent));
        btn.click(); await sleep(40);
        ok('party: which rolls and records it', (state.party[0].deathSaves || {}).success === 1 && /1\/3 saves/.test(P._body.querySelector('[data-act="death-roll"]').textContent));
        closePanel('party');
      } catch(e){ ok('party: the death-save checks ran to completion', false, e.message); }
      finally {
        window._findCombatantForPartyMember = st.find; window.sktD = st.d;
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- The character sheet window -------------------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { d: window.sktD, conf: window.showConfirm, find: window._findCombatantForPartyMember };
      try {
        const R = await sktRulesLoad('2014');
        const b = Object.assign(sktBlankBuild('2014'), { name: 'Sheeta', species: 'Elf', subspecies: 'High', cls: 'Wizard', subclass: 'Evocation', level: 5, background: 'Sage',
          abilities: { method: 'manual', base: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 } }, skills: ['arcana', 'investigation'],
          cantrips: ['Fire Bolt', 'Mage Hand', 'Light'], spellbook: ['Magic Missile', 'Shield', 'Fireball', 'Misty Step', 'Sleep', 'Detect Magic', 'Mage Armor', 'Burning Hands', 'Hold Person', 'Counterspell', 'Haste', 'Web', 'Thunderwave', 'Find Familiar'],
          spells: ['Magic Missile', 'Shield', 'Fireball', 'Misty Step', 'Hold Person', 'Counterspell', 'Haste', 'Web'], speciesChoice: { spells: ['Prestidigitation'] } });
        const rec = sktComputeCharacter(b, R); rec.id = 'pc_sheet_test'; state.party.push(rec); save();
        window._findCombatantForPartyMember = () => -1;
        const me = () => state.party.find(p => p.id === 'pc_sheet_test');
        openCharSheet('pc_sheet_test'); await sleep(400);
        const root = () => document.getElementById('cs-root');
        const q = s => root().querySelector(s), qa = s => [...root().querySelectorAll(s)];
        const click = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.click(); };
        const tick = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const set = (s, v) => { const e = q(s); if (!e) throw new Error('missing ' + s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const tab = async t => { click('[data-cs-tab="' + t + '"]'); await sleep(40); };
        ok('sheet: it opens with the tabs D&D Beyond has', !!root() && JSON.stringify(qa('.cs-tab').filter(e => e.offsetParent).map(e => e.textContent)) === '["Actions","Spells","Inventory","Features & Traits","Background","Notes","Extras"]');
        ok('sheet: abilities, saves and skills down the side', qa('.cs-ab').length === 6 && qa('[data-cs-roll^="save:"]').length === 6 && qa('[data-cs-roll^="skill:"]').length === 18
           && /Intelligence/.test(q('[data-cs-roll="save:int"]').textContent) && /\+6/.test(q('[data-cs-roll="save:int"]').textContent));
        // Rolling.
        window.sktD = () => 10;
        click('[data-cs-roll="save:int"]'); await sleep(30);
        ok('sheet: a click rolls the save', CS.log[0] && CS.log[0].total === 16 && CS.log[0].rolls.length === 1 && /16/.test(q('.cs-last').textContent));
        ok('sheet: the roll is kept on the character, for the game log', (me().rolls || [])[0] && me().rolls[0].label === 'Intelligence save' && me().rolls[0].total === 16 && me().rolls[0].from === 'dm');
        click('[data-cs-mode="adv"]'); await sleep(20);
        { let k = 0; window.sktD = () => (k++ % 2 ? 15 : 5); }
        click('[data-cs-roll="skill:arcana"]'); await sleep(30);
        ok('sheet: with advantage, two dice and the higher', CS.log[0].rolls.length === 2 && CS.log[0].mode === 'adv' && CS.log[0].natural === 15);
        click('[data-cs-mode="dis"]'); await sleep(20);
        click('[data-cs-roll="skill:arcana"]'); await sleep(30);
        ok('sheet: with disadvantage, the lower', CS.log[0].natural === 5);
        window.sktD = () => 10;
        click('[data-cs-mode="normal"]'); await sleep(20);
        const r = csRollDamage('Test', '2d6+1d4+3 slashing', false);
        const rc = csRollDamage('Test', '2d6+1d4+3 slashing', true);
        ok('sheet: damage rolls every term, and a crit doubles the dice', r.total === 33 && r.type === 'slashing' && rc.total === 63, r.total + ' ' + rc.total);
        ok('sheet: written with spaces too', csRollDamage('Test', '1d10 + 4 force', false).total === 14);
        click('[data-cs-atk="0"]'); await sleep(20);
        ok('sheet: an attack button rolls to hit', /attack/.test(CS.log[0].label));
        // Hit points.
        const hp0 = me().hp;
        q('[data-cs-amt]').value = '7'; click('[data-cs-hp="-1"]'); await sleep(40);
        ok('sheet: damage from the sheet', me().hp === hp0 - 7);
        q('[data-cs-amt]').value = '4'; click('[data-cs-hp="temp"]'); await sleep(40);
        ok('sheet: and temporary hit points', me().tempHp === 4);
        // Conditions, exhaustion, inspiration.
        set('[data-cs-addcond]', 'Poisoned'); await sleep(40);
        ok('sheet: a condition can be added', (me().conditions || []).includes('Poisoned') && /Poisoned/.test(q('.cs-state').textContent));
        click('[data-cs-cond="Poisoned"]'); await sleep(40);
        ok('sheet: and removed', !(me().conditions || []).includes('Poisoned'));
        click('[data-cs-exh="1"]'); await sleep(40);
        ok('sheet: exhaustion goes up', me().exhaustion === 1);
        click('[data-cs="insp"]'); await sleep(40);
        ok('sheet: Heroic Inspiration toggles', me().inspiration === true);
        // Limited use.
        click('[data-cs-res="0:0"]'); await sleep(40);
        ok('sheet: a lit pip spends the use', me().resources[0].current === 0);
        // Spells.
        await tab('spells');
        ok('sheet: spells by level, with their source', /Cantrips/.test(q('.cs-pane').textContent) && /3rd level/.test(q('.cs-pane').textContent) && /Species/.test(q('.cs-pane').textContent));
        const s1 = me().sheet.spellSlots[1].expended || 0;
        click('[data-cs-slot="1:3"]'); await sleep(40);
        ok('sheet: a slot pip spends a slot', me().sheet.spellSlots[1].expended === s1 + 1);
        set('[data-cs-castlvl="Magic Missile"]', '2'); await sleep(10);
        click('[data-cs-cast="Magic Missile:1"]'); await sleep(40);
        ok('sheet: Cast spends the slot chosen (2nd level)', me().sheet.spellSlots[2].expended === 1);
        click('[data-cs-cast="Hold Person:2"]'); await sleep(40);
        ok('sheet: casting a concentration spell starts concentration', me().concentration === 'Hold Person' && me().sheet.spellSlots[2].expended === 2);
        click('[data-cs-cast="Fire Bolt:0"]'); await sleep(40);
        ok('sheet: a cantrip costs nothing', me().sheet.spellSlots[2].expended === 2);
        click('[data-cs-open="sp:Fireball"]'); await sleep(40);
        ok('sheet: a spell opens to its text', /20-foot-radius/.test(q('.cs-pane').textContent));
        click('[data-cs="manage"]'); await sleep(40);
        ok('sheet: Manage spells shows the prepared count', /Prepared 8 \/ 8/.test(q('.cs-pane').textContent));
        tick('[data-cs-prep="-1|spells|Web"]'); await sleep(300);
        ok('sheet: unpreparing a spell takes it off the sheet', !me().build.spells.includes('Web') && !me().sheet.spells.includes('Web'));
        tick('[data-cs-prep="-1|spells|Sleep"]'); await sleep(300);
        ok('sheet: and preparing another puts it on', me().sheet.spells.includes('Sleep'));
        // Inventory.
        await tab('inventory'); await sleep(1500);
        ok('sheet: the inventory starts as the kit, with weight against what STR 8 carries', qa('.cs-item').length >= 4 && /Quarterstaff/.test(q('.cs-inv').textContent)
           && /Carrying [1-9][\d.]* lb of 120 lb/.test(q('.cs-carry').textContent), q('.cs-carry').textContent);
        tick('[data-cs-equip="0"]'); await sleep(300);
        ok('sheet: unequipping a weapon takes it out of the attacks', me().build.equipment.materialized && !me().sheet.attacks.some(a => a.name === 'Quarterstaff'));
        ok('sheet: and the rest of the kit is still carried', ['Quarterstaff', 'Spellbook'].every(n => me().build.items.some(x => x.name === n)) && qa('.cs-item').length >= 4);
        const n0 = me().build.items.length;
        set('[data-cs-q]', '+1 Armor'); await sleep(40); set('[data-cs-qbase]', 'leather armor'); await sleep(40);
        const ac0 = me().ac;
        click('[data-cs="additem"]'); await sleep(300);
        ok('sheet: adding +1 leather armour puts it on', me().build.items.length === n0 + 1 && me().ac === 11 + 1 + 3, ac0 + ' → ' + me().ac);
        q('[data-cs-custom]').value = 'Lucky coin'; q('[data-cs-customwt]').value = '0.1'; click('[data-cs="addcustom"]'); await sleep(300);
        ok('sheet: a custom item', me().build.items.some(x => x.name === 'Lucky coin' && x.custom));
        const i = me().build.items.findIndex(x => x.name === 'Lucky coin');
        click('[data-cs-qty="' + i + ':1"]'); await sleep(300);
        ok('sheet: quantities', me().build.items[i].qty === 2);
        click('[data-cs-del="' + i + '"]'); await sleep(300);
        ok('sheet: remove', !me().build.items.some(x => x.name === 'Lucky coin'));
        set('[data-cs-coin="sp"]', '30'); await sleep(40);
        ok('sheet: coins of every kind', me().coins.sp === 30 && /Worth 13 gp/.test(q('.cs-coins').textContent), q('.cs-coins').textContent);
        // Customize.
        click('[data-cs="customize"]'); await sleep(40);
        const acC = me().ac;
        set('[data-cs-ov="ac"]', '2'); await sleep(300);
        set('[data-cs-ov="skill:stealth"]', '1'); await sleep(300);
        ok('sheet: Customize adds a bonus the rules don’t know', me().ac === acC + 2 && me().build.overrides.ac === 2 && me().sheet.skills.stealth === 4);
        click('[data-cs="customize"]'); await sleep(40);
        // Features, background, notes.
        await tab('features');
        ok('sheet: features by source', /Class features/.test(q('.cs-pane').textContent) && /Arcane Recovery/.test(q('.cs-pane').textContent) && /Species traits/.test(q('.cs-pane').textContent));
        await tab('background');
        const bs = q('textarea[data-cs-detail="backstory"]'); bs.value = 'Raised among books.'; bs.dispatchEvent(new Event('input', { bubbles: true }));
        ok('sheet: the backstory is written to the character and its build', me().sheet.details.backstory === 'Raised among books.' && me().build.details.backstory === 'Raised among books.' && q('textarea[data-cs-detail="backstory"]') === bs);
        await tab('notes');
        const nt = q('[data-cs-notes]'); nt.value = 'Owes Gundren 10 gp'; nt.dispatchEvent(new Event('input', { bubbles: true }));
        ok('sheet: notes are kept', me().playerNotes === 'Owes Gundren 10 gp');
        // Rests.
        window.showConfirm = () => Promise.resolve(true);
        click('[data-cs="long"]'); await sleep(80);
        ok('sheet: a long rest from the sheet', me().hp === me().hpMax && me().sheet.spellSlots[2].expended === 0 && me().exhaustion === 0);
        click('[data-cs="close"]'); await sleep(20);
        ok('sheet: closes', !root());
        // From the party card.
        openPanel('party'); await sleep(200);
        const pi = state.party.findIndex(p => p.id === 'pc_sheet_test');
        panelDefs.party._body.querySelector('[data-act="open-sheet"][data-idx="' + pi + '"]').click(); await sleep(100);
        ok('party: the card’s Sheet button opens it', !!root() && CS.id === 'pc_sheet_test');
        csClose(); closePanel('party');
      } catch(e){ ok('sheet: the checks ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.sktD = st.d; window.showConfirm = st.conf; window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Builder: tools, characteristics, gold, spell picker, prerequisites, Tasha's, XP --
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const ed0 = state.settings && state.settings.builderEdition;
      const st = { d: window.sktD, conf: window.showConfirm };
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const base = { method: 'manual', base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } };
        // #8 Tools.
        const monk = Object.assign(sktBlankBuild('2014'), { name: 'M', cls: 'Monk', species: 'Human', background: 'Soldier', level: 1, abilities: base });
        const tc = sktToolChoices(monk, R14);
        const mc = tc.find(c => c.key === 'class'), bc = tc.find(c => c.key === 'background');
        ok('tools: a monk picks an artisan’s tool or an instrument; a soldier a gaming set',
           !!mc && mc.count === 1 && mc.options.includes("Smith's Tools") && mc.options.includes('Lute') && !!bc && bc.options.includes('Dice Set'));
        ok('tools: asked for until chosen', sktBuildTodo(monk, R14).some(t => /tool proficienc/.test(t.what)));
        monk.toolPicks = { class: ['Lute'], background: ['Dice Set'] };
        const MK = sktComputeCharacter(monk, R14);
        ok('tools: the picks are proficiencies', MK.sheet.proficiencies.tools.includes('lute') && MK.sheet.proficiencies.tools.includes('dice set') && !sktBuildTodo(monk, R14).some(t => /tool/.test(t.what)));
        ok('tools: a bard picks three instruments', (sktToolChoices(Object.assign({}, monk, { cls: 'Bard' }), R14).find(c => c.key === 'class') || {}).count === 3);
        ok('tools: a rogue simply has thieves’ tools', sktComputeCharacter(Object.assign({}, monk, { cls: 'Rogue' }), R14).sheet.proficiencies.tools.includes("thieves' tools"));
        ok('tools: a dwarf picks one of three', JSON.stringify((sktToolChoices(Object.assign({}, monk, { species: 'Dwarf', subspecies: 'Hill' }), R14).find(c => c.key === 'species') || {}).options) === JSON.stringify(["Brewer's Supplies", "Mason's Tools", "Smith's Tools"]));
        // #9 Characteristics.
        const ac = (sktRulesBackground(R14, 'Acolyte') || {}).characteristics || {};
        ok('background: the Acolyte’s d8 of traits and d6s of ideals, bonds and flaws', (ac.personality || []).length === 8 && (ac.ideals || []).length === 6 && (ac.bonds || []).length === 6 && (ac.flaws || []).length === 6);
        // #10 Gold instead of the kit.
        const fg = sktClassGold(sktRulesClass(R14, 'Fighter'));
        ok('gold: a 2014 fighter may take 5d4 × 10 gp', !!fg && fg.n === 5 && fg.d === 4 && fg.mult === 10 && fg.avg === 120);
        const fi = Object.assign(sktBlankBuild('2014'), { cls: 'Fighter', species: 'Human', background: 'Soldier', level: 1, abilities: base, equipment: { cls: 'A', bg: 'A', clsGold: 130 } });
        const FI = sktComputeCharacter(fi, R14);
        ok('gold: taking it means no class kit', FI.gold >= 130 && !/Chain Mail/.test(FI.sheet.acSource) && !FI.sheet.attacks.some(a => a.name === 'Longsword'), FI.sheet.acSource);
        // #12 Prerequisites.
        const wz = Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', species: 'Human', level: 4, abilities: { method: 'manual', base: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 } } });
        const ham = sktRulesFeat(R14, 'Heavy Armor Master');
        ok('feats: Heavy Armor Master needs heavy armour — a wizard has none, a fighter does',
           !sktFeatPrereq(R14, wz, ham, sktComputeCharacter(wz, R14)).ok && sktFeatPrereq(R14, fi, ham, FI).ok && /heavy armor/.test(sktFeatPrereq(R14, wz, ham, null).text));
        ok('feats: Grappler needs STR 13, War Caster a spell', !sktFeatPrereq(R14, wz, sktRulesFeat(R14, 'Grappler'), null).ok
           && sktFeatPrereq(R14, wz, sktRulesFeat(R14, 'War Caster'), sktComputeCharacter(wz, R14)).ok && !sktFeatPrereq(R14, fi, sktRulesFeat(R14, 'War Caster'), FI).ok);
        // #13 Tasha's.
        const dw = Object.assign(sktBlankBuild('2014'), { cls: 'Fighter', species: 'Dwarf', subspecies: 'Hill', level: 1, abilities: base });
        ok('Tasha’s: a hill dwarf’s increases are CON +2, WIS +1 as printed', sktBuildAbilities(dw, R14).con === 15 && sktBuildAbilities(dw, R14).wis === 11);
        dw.speciesChoice = { customOrigin: true }; dw.speciesAsi = { str: 2, dex: 1 };
        ok('Tasha’s: Customizing Your Origin moves them', sktBuildAbilities(dw, R14).con === 13 && sktBuildAbilities(dw, R14).str === 17 && sktBuildAbilities(dw, R14).dex === 15
           && JSON.stringify(sktSpeciesAsiChoice(sktRulesSpecies(R14, 'Dwarf'), null, dw)) === '{"flex":true}');
        const rg = Object.assign(sktBlankBuild('2014'), { cls: 'Ranger', level: 4, abilities: base });
        const fn = b => sktBuildFeatures(b, R14).filter(f => f.from === 'class').map(f => f.name);
        ok('Tasha’s: without the option, the handbook’s ranger', fn(rg).includes('Natural Explorer') && !fn(rg).includes('Deft Explorer'));
        rg.optionalFeatures = true;
        ok('Tasha’s: with it, Deft Explorer and Favored Foe replace Natural Explorer and Favored Enemy', fn(rg).includes('Deft Explorer') && fn(rg).includes('Favored Foe') && fn(rg).includes('Martial Versatility')
           && !fn(rg).includes('Natural Explorer') && !fn(rg).includes('Favored Enemy'), fn(rg).join(', '));

        // The builder's screens.
        await openCharBuilder({ edition: '2014' }); await sleep(800);
        const root = () => document.getElementById('cb-root');
        const q = s => root().querySelector(s), qa = s => [...root().querySelectorAll(s)];
        const click = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.click(); };
        const tick = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const set = (s, v) => { const e = q(s); if (!e) throw new Error('missing ' + s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const nm = q('[data-cb-in="name"]'); nm.value = 'Toolsy'; nm.dispatchEvent(new Event('input', { bubbles: true }));
        ok('builder: Basics has a picture upload and the levelling choice', !!q('[data-cb="upload"]') && !!q('[data-cb-advance]'));
        set('[data-cb-advance]', 'xp'); await sleep(20);
        ok('builder: XP levelling is kept', CB.build.advancement === 'xp');
        click('[data-cb-step="class"]'); await sleep(30); click('[data-cb-cls="Monk"]'); await sleep(30);
        click('[data-cb-step="background"]'); await sleep(30); click('[data-cb-bg="Acolyte"]'); await sleep(30);
        click('[data-cb-step="skills"]'); await sleep(30);
        ok('builder: the Skills step asks for the monk’s tool', qa('[data-cb-tool^="class||"]').length > 20);
        tick('[data-cb-tool="class||Lute"]'); await sleep(20);
        ok('builder: and keeps it', JSON.stringify((CB.build.toolPicks || {}).class) === '["Lute"]');
        click('[data-cb-step="details"]'); await sleep(30);
        set('[data-cb-suggest="ideals"]', '0'); await sleep(30);
        ok('builder: a suggested ideal fills the box', (CB.build.details.ideals || '').length > 10 && q('textarea[data-cb-detail="ideals"]').value === CB.build.details.ideals);
        window.sktD = () => 2;
        click('[data-cb-suggestroll="flaws"]'); await sleep(30);
        ok('builder: or a roll picks one', CB.build.details.flaws === ac.flaws[1]);
        // Gold instead of the kit.
        click('[data-cb-step="class"]'); await sleep(30); click('[data-cb-cls="Fighter"]'); await sleep(30);
        click('[data-cb-step="equipment"]'); await sleep(200);
        click('[data-cb-clsgold="gold"]'); await sleep(30);
        ok('builder: gold instead of the kit, the average to start', CB.build.equipment.clsGold === 120 && !q('[data-cb-eq^="cls:"]'));
        window.sktD = () => 3;
        click('[data-cb-clsgold="roll"]'); await sleep(30);
        ok('builder: or rolled (5d4 × 10)', CB.build.equipment.clsGold === 150);
        click('[data-cb-clsgold="kit"]'); await sleep(30);
        ok('builder: and back to the kit', CB.build.equipment.clsGold === undefined && !!q('[data-cb-eq^="cls:"]'));
        // Spell picker.
        click('[data-cb-step="class"]'); await sleep(30); click('[data-cb-cls="Wizard"]'); await sleep(30);
        click('[data-cb-step="spells"]'); await sleep(30);
        const sq = q('[data-cb-spq]'); sq.value = 'fire'; sq.dispatchEvent(new Event('input', { bubbles: true })); await sleep(350);
        ok('builder: searching the spells', qa('[data-cb-cantrip]').map(e => e.dataset.cbCantrip).join() === 'Fire Bolt' && document.activeElement === q('[data-cb-spq]'));
        const sq2 = q('[data-cb-spq]'); sq2.value = ''; sq2.dispatchEvent(new Event('input', { bubbles: true })); await sleep(350);
        set('[data-cb-spschool]', 'V'); await sleep(30);
        ok('builder: filtering by school', qa('[data-cb-book]').length > 0 && qa('[data-cb-book]').every(e => (sktRulesSpell(CB.R, e.dataset.cbBook) || {}).school === 'V'));
        set('[data-cb-spschool]', ''); await sleep(30);
        click('[data-cb-spinfo="Magic Missile"]'); await sleep(30);
        ok('builder: a spell’s text on the Spells step', /dart/.test((q('.cb-spinfo') || {}).textContent || '') && !CB.build.spellbook.includes('Magic Missile'));
        // Prerequisites in the feat picker.
        const lv = q('[data-cb-step="basics"]'); lv.click(); await sleep(30);
        const lvi = q('[data-cb-in="level"]'); lvi.value = '4'; lvi.dispatchEvent(new Event('input', { bubbles: true })); await sleep(30);
        click('[data-cb-step="levels"]'); await sleep(30);
        click('[data-cb-asitype="4:feat"]'); await sleep(30);
        const opts = () => [...q('[data-cb-asifeat="4"]').options].map(o => o.value);
        ok('builder: feats the character can’t take are hidden', !opts().includes('Heavy Armor Master') && opts().includes('Alert'));
        tick('[data-cb-qualified]'); await sleep(30);
        ok('builder: or shown, saying what they need', opts().includes('Heavy Armor Master') && /needs proficiency with heavy armor/.test(q('[data-cb-asifeat="4"] option[value="Heavy Armor Master"]').textContent));
        // Tasha's.
        click('[data-cb-step="species"]'); await sleep(30); click('[data-cb-species="Dwarf"]'); await sleep(30);
        tick('[data-cb-customorigin]'); await sleep(30);
        ok('builder: Customizing Your Origin offers the increases anywhere', CB.build.speciesChoice.customOrigin === true && !!q('[data-cb-spflex="2"]'));
        click('[data-cb-step="class"]'); await sleep(30); click('[data-cb-cls="Ranger"]'); await sleep(30);
        tick('[data-cb-optfeat]'); await sleep(30);
        ok('builder: Tasha’s optional class features, with what each replaces', CB.build.optionalFeatures === true && /replaces Natural Explorer/.test(q('.cb-main').textContent));
        click('[data-cb-step="review"]'); await sleep(30);
        window.showConfirm = () => Promise.resolve(true);
        click('[data-cb="save"]'); await sleep(200);
        const made = state.party.find(p => p.name === 'Toolsy');
        // XP on the sheet.
        openCharSheet(made.id); await sleep(200);
        ok('sheet: XP shows for a character levelled by XP', /XP 0 \/ 6,500/.test(document.querySelector('#cs-root .cs-xp').textContent));
        const xi = document.querySelector('#cs-root [data-cs-xp]'); xi.value = '7000';
        document.querySelector('#cs-root [data-cs="addxp"]').click(); await sleep(40);
        ok('sheet: adding XP, and Level up lights at the mark', state.party.find(p => p.id === made.id).xp === 7000 && document.querySelector('#cs-root [data-cs="levelup"]').classList.contains('primary'));
        // A player's roll reaching the DM.
        csClose();
        openPanel('party'); await sleep(200);
        const P = panelDefs.party; P._render();
        const pc = state.party.find(p => p.id === made.id);
        pc.rolls = [{ label: 'Stealth', total: 17, text: '17 (d20 14 +3)', at: Date.now() + 1000, from: 'player' }].concat(pc.rolls || []);
        P._render(); await sleep(30);
        ok('party: a player’s roll pops up on the DM’s screen, and sits on the card',
           [...document.querySelectorAll('.toast-item')].some(t => /Toolsy — Stealth: 17/.test(t.textContent)) && /Stealth/.test((P._body.querySelector('.char-prolls') || {}).textContent || ''));
        closePanel('party');
      } catch(e){ ok('builder: the D&D Beyond extras ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.sktD = st.d; window.showConfirm = st.conf;
        document.getElementById('cb-root')?.remove(); CB = null;
        if (typeof csClose === 'function') csClose();
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Builder round 3: feat choices, books, buying, class table, extras, print --
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const ed0 = state.settings && state.settings.builderEdition;
      const st = { d: window.sktD, conf: window.showConfirm, pr: window.print, find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const base = { method: 'manual', base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } };
        // Feat choices.
        const fb = Object.assign(sktBlankBuild('2014'), { cls: 'Fighter', species: 'Human', level: 4, abilities: base, asi: { 4: { type: 'feat', feat: 'Skilled' } } });
        const sk = sktFeatChoices(R14, fb, 'Skilled');
        ok('feats: Skilled asks for three skills or tools', sk.choices.length === 1 && sk.choices[0].kind === 'skillsTools' && sk.choices[0].count === 3 && sk.choices[0].options.includes('s:stealth') && sk.choices[0].options.includes('t:Lute'));
        ok('feats: and the builder asks until they are chosen', sktBuildTodo(fb, R14).some(t => t.what === 'choices for Skilled' && t.step === 'levels'));
        fb.featChoices = { Skilled: { skills: ['stealth', 'arcana'], tools: ['Lute'] } };
        const FB = sktComputeCharacter(fb, R14);
        ok('feats: the picks land on the sheet', FB.sheet.skillProf.stealth === 1 && FB.sheet.skillProf.arcana === 1 && FB.sheet.proficiencies.tools.includes('lute') && !sktBuildTodo(fb, R14).some(t => /Skilled/.test(t.what)));
        const ling = sktFeatChoices(R14, fb, 'Linguist'), wm = sktFeatChoices(R14, fb, 'Weapon Master');
        { const ai = sktFeatSpellGrant(R14, Object.assign({}, fb, { allBooks: true }), 'Artificer Initiate');
          ok('feats: Artificer Initiate has the artificer’s list to choose from', !!ai && ai.choices.length >= 2 && ai.choices.every(c => c.options.length > 0), ai && JSON.stringify(ai.choices.map(c => c.options.length))); }
        ok('feats: Linguist three languages, Weapon Master four martial weapons', ling.choices[0].kind === 'languages' && ling.choices[0].count === 3
           && wm.choices[0].kind === 'weapons' && wm.choices[0].count === 4 && wm.choices[0].options.includes('Longsword') && !wm.choices[0].options.includes('Club'));
        ok('feats: an armour feat gives its armour from the data', sktComputeCharacter(Object.assign({}, fb, { cls: 'Wizard', asi: { 4: { type: 'feat', feat: 'Moderately Armored' } } }), R14).sheet.proficiencies.armor.includes('medium'));
        const fi = Object.assign({}, fb, { asi: { 4: { type: 'feat', feat: 'Fighting Initiate' } }, allBooks: true });
        ok('feats: Fighting Initiate asks for a fighting style', (sktOptionalChoices(fi, R14).find(o => o.name === 'Fighting Style') || {}).count === 2);
        const cr = Object.assign(sktBlankBuild('2024'), { cls: 'Fighter', species: 'Human', background: 'Artisan', level: 1, abilities: base });
        ok('feats: a 2024 Artisan’s Crafter asks for three tools on the Background step', sktBuildTodo(cr, R24).some(t => t.what === 'choices for Crafter' && t.step === 'background'));
        // Books one by one.
        const bk = Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', level: 1, allBooks: true });
        const can = b => sktSpellOptions(R14, b, 0).map(x => x.name);
        ok('books: Xanathar’s cantrips with every book', can(bk).includes('Toll the Dead'));
        ok('books: not when Xanathar’s is left out', !can(Object.assign({}, bk, { books: ['TCE'] })).includes('Toll the Dead') && can(Object.assign({}, bk, { books: ['XGE'] })).includes('Toll the Dead'));
        ok('books: the list names each book', sktOtherBooks(R14).some(x => x.source === 'XGE' && /Xanathar/.test(x.name) && x.count > 10));
        // The builder.
        await openCharBuilder({ edition: '2014' }); await sleep(800);
        const root = () => document.getElementById('cb-root');
        const q = s => root().querySelector(s), qa = s => [...root().querySelectorAll(s)];
        const click = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.click(); };
        const tick = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const set = (s, v) => { const e = q(s); if (!e) throw new Error('missing ' + s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        const nm = q('[data-cb-in="name"]'); nm.value = 'Shopper'; nm.dispatchEvent(new Event('input', { bubbles: true }));
        tick('[data-cb-allbooks]'); await sleep(30);
        ok('builder: with other books on, the books are listed one by one', qa('[data-cb-src]').length > 10);
        click('[data-cb-srcall="0"]'); await sleep(30);
        click('[data-cb-step="species"]'); await sleep(30);
        ok('builder: with none ticked, only the handbook’s species', !q('.cb-books-h') && CB.build.books.length === 0);
        click('[data-cb-step="basics"]'); await sleep(30);
        tick('[data-cb-src="MPMM"]'); await sleep(30);
        click('[data-cb-step="species"]'); await sleep(30);
        ok('builder: tick one book and its species appear', !!q('[data-cb-species="Tabaxi"]') && !q('[data-cb-species="Kalashtar"]'));
        { const all = sktOtherBooks(CB.R).map(x => x.source); CB.build.books = all.filter(x => x !== 'XGE'); click('[data-cb-step="basics"]'); await sleep(30);
          tick('[data-cb-src="XGE"]'); await sleep(30);
          ok('builder: every book ticked is "all books" again', CB.build.books === undefined); click('[data-cb-step="species"]'); await sleep(30); }
        click('[data-cb-step="background"]'); await sleep(30); click('[data-cb-bg="Soldier"]'); await sleep(30);
        click('[data-cb-step="class"]'); await sleep(30); click('[data-cb-cls="Fighter"]'); await sleep(30);
        ok('builder: the class table, as the book prints it', !!q('.cb-ctable') && qa('.cb-ctable tbody tr').length === 20 && /Action Surge/.test(q('.cb-ctable').textContent));
        // Buying with the starting money.
        click('[data-cb-step="equipment"]'); await sleep(400);
        const gold0 = sktBuildEquipment(CB.build, CB.R).gold;
        set('[data-cb-magicq]', 'Shield'); await sleep(30);
        ok('builder: an item with a price can be bought', /Buy \(10 gp\)/.test((q('[data-cb="magic-buy"]') || {}).textContent || ''));
        ok('builder: the Soldier’s pouch pays for it', gold0 >= 10, gold0);
        click('[data-cb="magic-buy"]'); await sleep(30);
        ok('builder: buying takes it out of the starting money', sktBuildEquipment(CB.build, CB.R).gold === gold0 - 10 && CB.build.items.some(x => x.name === 'Shield'));
        // Feat choices in the builder.
        const lvi = (click('[data-cb-step="basics"]'), q('[data-cb-in="level"]')); lvi.value = '4'; lvi.dispatchEvent(new Event('input', { bubbles: true })); await sleep(30);
        click('[data-cb-step="levels"]'); await sleep(30);
        click('[data-cb-asitype="4:feat"]'); await sleep(30);
        set('[data-cb-asifeat="4"]', 'Skilled'); await sleep(30);
        ok('builder: Skilled asks for its three picks', qa('[data-cb-fc^="Skilled||skillsTools||"]').length > 30);
        tick('[data-cb-fc="Skilled||skillsTools||s:stealth"]'); await sleep(20);
        tick('[data-cb-fc="Skilled||skillsTools||t:Lute"]'); await sleep(20);
        tick('[data-cb-fc="Skilled||skillsTools||s:arcana"]'); await sleep(20);
        tick('[data-cb-fc="Skilled||skillsTools||s:history"]'); await sleep(20);
        ok('builder: three and no more', JSON.stringify(CB.build.featChoices.Skilled) === '{"skills":["stealth","arcana"],"tools":["Lute"]}', JSON.stringify(CB.build.featChoices.Skilled));
        // More details.
        click('[data-cb-step="details"]'); await sleep(30);
        ok('builder: gender, lifestyle, allies and enemies too', !!q('[data-cb-detail="gender"]') && !!q('[data-cb-detail="lifestyle"]') && !!q('textarea[data-cb-detail="allies"]') && !!q('textarea[data-cb-detail="enemies"]'));
        click('[data-cb-step="review"]'); await sleep(30);
        window.showConfirm = () => Promise.resolve(true);
        click('[data-cb="save"]'); await sleep(200);
        const made = state.party.find(p => p.name === 'Shopper');
        // The sheet: buying with change, extras, printing.
        window._findCombatantForPartyMember = () => -1;
        made.gold = 2; made.coins = { pp: 1, ep: 0, sp: 0, cp: 0 }; save();
        openCharSheet(made.id, { tab: 'inventory' }); await sleep(2500);
        const cq = document.querySelector('#cs-root [data-cs-q]'); cq.value = 'Hempen Rope (50 feet)'; cq.dispatchEvent(new Event('change', { bubbles: true })); await sleep(40);
        const buy = document.querySelector('#cs-root [data-cs="buyitem"]');
        ok('sheet: gear shows its price', !!buy && /Buy \(1 gp\)/.test(buy.textContent), buy && buy.textContent);
        buy.click(); await sleep(400);
        const me = () => state.party.find(p => p.id === made.id);
        ok('sheet: buying pays from the purse', me().gold === 1 && me().coins.pp === 1 && me().build.items.some(x => /Rope/.test(x.name)), JSON.stringify({ g: me().gold, c: me().coins }));
        const cq2 = document.querySelector('#cs-root [data-cs-q]'); cq2.value = 'Handaxe'; cq2.dispatchEvent(new Event('change', { bubbles: true })); await sleep(40);
        document.querySelector('#cs-root [data-cs="buyitem"]').click(); await sleep(400);
        ok('sheet: a 5 gp handaxe from 1 gp and 1 pp breaks the platinum: 6 gp left', me().coins.pp === 0 && me().gold === 6, JSON.stringify({ g: me().gold, c: me().coins }));
        const cq3 = document.querySelector('#cs-root [data-cs-q]'); cq3.value = 'Plate Armor'; cq3.dispatchEvent(new Event('change', { bubbles: true })); await sleep(40);
        const n3 = me().build.items.length;
        document.querySelector('#cs-root [data-cs="buyitem"]').click(); await sleep(300);
        ok('sheet: not when the purse is short', me().build.items.length === n3 && me().gold === 6);
        document.querySelector('#cs-root [data-cs-tab="extras"]').click(); await sleep(40);
        const eq = document.querySelector('#cs-root [data-cs-exq]'); eq.value = 'Owl'; document.querySelector('#cs-root [data-cs="addextra"]').click(); await sleep(60);
        ok('sheet: a companion from the bestiary, with its hit points', (me().extras || []).length === 1 && me().extras[0].name === 'Owl' && me().extras[0].hpMax > 0, JSON.stringify(me().extras));
        document.querySelector('#cs-root [data-cs-amt]').value = '1';
        document.querySelector('#cs-root [data-cs-exhp="0:-1"]').click(); await sleep(40);
        ok('sheet: its hit points go down', me().extras[0].hp === me().extras[0].hpMax - 1);
        let printed = 0; window.print = () => { printed++; };
        document.querySelector('#cs-root [data-cs="print"]').click(); await sleep(40);
        const pv = document.getElementById('cs-print');
        ok('sheet: Print lays out the whole sheet without buttons', printed === 1 && !!pv && /Actions/.test(pv.textContent) && /Equipment/.test(pv.textContent) && /Saving throws/i.test(pv.textContent) && !pv.querySelector('button, input, select, textarea'));
        window.dispatchEvent(new Event('afterprint')); await sleep(20);
        ok('sheet: and tidies up after', !document.getElementById('cs-print'));
        csClose();
      } catch(e){ ok('builder: round 3 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.sktD = st.d; window.showConfirm = st.conf; window.print = st.pr; window._findCombatantForPartyMember = st.find;
        document.getElementById('cb-root')?.remove(); CB = null;
        if (typeof csClose === 'function') csClose();
        document.getElementById('cs-print')?.remove();
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Sheet round 4: conditions in rolls, spell damage, short rest, custom background --
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const ed0 = state.settings && state.settings.builderEdition;
      const st = { d: window.sktD, conf: window.showConfirm, find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        window._findCombatantForPartyMember = () => -1;
        const base = { method: 'manual', base: { str: 15, dex: 14, con: 14, int: 16, wis: 10, cha: 8 } };
        const wb = Object.assign(sktBlankBuild('2014'), { name: 'Roundfour', cls: 'Wizard', subclass: 'Evocation', species: 'Human', level: 5, abilities: base,
          cantrips: ['Fire Bolt'], spellbook: ['Fireball', 'Magic Missile', 'Shield', 'Burning Hands'], spells: ['Fireball', 'Magic Missile', 'Shield', 'Burning Hands'] });
        const rec = sktComputeCharacter(wb, R14); rec.id = 'pc_r4'; rec.hitDice = { current: 5, max: 5, dieType: 'd6' }; state.party.push(rec); save();
        const me = () => state.party.find(p => p.id === 'pc_r4');
        openCharSheet('pc_r4'); await sleep(400);
        const q = s => document.querySelector('#cs-root ' + s);
        // Conditions in rolls.
        let k = 0; window.sktD = () => (k++ % 2 ? 15 : 5);
        me().conditions = ['Poisoned']; csRender();
        q('[data-cs-roll="skill:arcana"]').click(); await sleep(30);
        ok('rolls: poisoned, an ability check is at disadvantage', CS.log[0].mode === 'dis' && CS.log[0].natural === 5 && /poisoned/.test(CS.log[0].why));
        q('[data-cs-mode="adv"]').click(); await sleep(20);
        q('[data-cs-roll="skill:arcana"]').click(); await sleep(30);
        ok('rolls: advantage and disadvantage cancel', CS.log[0].mode === 'normal' && CS.log[0].rolls.length === 1);
        q('[data-cs-mode="normal"]').click(); await sleep(20);
        q('[data-cs-roll="save:con"]').click(); await sleep(30);
        ok('rolls: but a save is not affected by poison', CS.log[0].mode === 'normal');
        ok('rolls: the sheet says what the conditions do', /attacks at disadvantage/.test(q('.cs-fx').textContent));
        me().conditions = ['Stunned']; csRender();
        q('[data-cs-roll="save:dex"]').click(); await sleep(30);
        ok('rolls: stunned, a DEX save fails automatically', CS.log[0].autoFail && /automatic failure/.test(CS.log[0].why));
        me().conditions = []; me().exhaustion = 2; csRender();
        q('[data-cs-roll="skill:arcana"]').click(); await sleep(30);
        ok('rolls: 2014 exhaustion — checks at disadvantage, speed halved', CS.log[0].mode === 'dis' && /15 ft/.test(document.querySelector('#cs-root .cs-boxes').textContent));
        me().exhaustion = 0; csRender();
        ok('rolls: 2024 exhaustion is −2 a level', csRollEffects({ exhaustion: 3, rules: '2024', conditions: [] }, 'check').bonus === -6 && csRollEffects({ exhaustion: 3, rules: '2024', conditions: [] }, 'attack').bonus === -6);
        // Spell damage.
        q('[data-cs-tab="spells"]').click(); await sleep(40);
        const fb = q('[data-cs-spdmg="Fireball"]');
        ok('spells: Fireball shows its damage and its save', !!fb && /8d6/.test(fb.textContent) && /DEX save DC 14/.test(q('.cs-pane').textContent));
        window.sktD = () => 3;
        fb.click(); await sleep(30);
        ok('spells: and rolls it', CS.log[0].kind === 'dmg' && CS.log[0].total === 24);
        ok('spells: cast higher, more dice', csSpellDamage(csSpell('Fireball'), 5) === '10d6' && csSpellDamage(csSpell('Burning Hands'), 3) === '5d6');
        ok('spells: a cantrip shows its scaled damage', /2d10/.test(q('.cs-pane').textContent));
        // Short rest with hit dice.
        q('[data-cs-tab="actions"]').click(); await sleep(20);
        me().hp = 10; me().resources.forEach(r => { r.current = 0; }); csRender();
        q('[data-cs="short"]').click(); await sleep(30);
        ok('rest: a short rest opens with the hit dice to spend', /Hit dice 5 \/ 5/.test(q('.cs-rest').textContent));
        window.sktD = () => 4;
        q('[data-cs="restdie"]').click(); await sleep(40);
        ok('rest: spending one rolls and heals (d6 4 + CON 2)', me().hp === 16 && me().hitDice.current === 4 && /healed 6/.test(q('.cs-rest').textContent));
        q('[data-cs="restdone"]').click(); await sleep(40);
        ok('rest: finishing restores what a short rest gives back', !q('.cs-rest') && (me().resources.find(r => r.name === 'Arcane Recovery') || { current: 0 }).current >= 0);
        csClose();
        // A custom background.
        const cb = Object.assign(sktBlankBuild('2024'), { cls: 'Fighter', species: 'Human', level: 1, abilities: base, background: SKT_CUSTOM_BG,
          customBg: { name: 'Sailor', skills: ['athletics', 'perception'], abilities: ['str', 'dex', 'con'], feat: 'Alert', tools: ["Navigator's Tools"] }, bgAsi: { str: 2, con: 1 } });
        const CBR = sktComputeCharacter(cb, R24);
        ok('background: your own — two skills, the abilities you chose, an origin feat, a tool', CBR.sheet.skillProf.athletics && CBR.sheet.skillProf.perception
           && CBR.abilities.str === 17 && CBR.feats.includes('Alert') && CBR.sheet.proficiencies.tools.includes("navigator's tools") && CBR.background === SKT_CUSTOM_BG, JSON.stringify(CBR.feats));
        const c14 = Object.assign(sktBlankBuild('2014'), { cls: 'Fighter', species: 'Human', level: 1, abilities: base, background: SKT_CUSTOM_BG,
          customBg: { name: 'Hermit-monk', skills: ['religion', 'medicine'], tools: ['Herbalism Kit'], languages: 1, feature: 'Acolyte', equipment: 'Acolyte' } });
        const C14 = sktComputeCharacter(c14, R14);
        ok('background 2014: a borrowed feature and kit', C14.sheet.featureList.some(f => f.from === 'background' && /Shelter of the Faithful/.test(f.name)) && C14.sheet.skillProf.religion && C14.sheet.proficiencies.tools.includes('herbalism kit'));
        // In the builder.
        await openCharBuilder({ edition: '2024' }); await sleep(800);
        const bq = s => document.querySelector('#cb-root ' + s);
        bq('[data-cb-step="background"]').click(); await sleep(30);
        bq('[data-cb-bg="' + SKT_CUSTOM_BG + '"]').click(); await sleep(30);
        ok('builder: a Custom background card opens its choices', !!bq('[data-cb-cbg="name"]') && document.querySelectorAll('#cb-root [data-cb-cbgskill]').length === 18 && !!bq('[data-cb-cbg="feat"]'));
        const tk = s => { const e = bq(s); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
        tk('[data-cb-cbgskill="stealth"]'); await sleep(20); tk('[data-cb-cbgskill="survival"]'); await sleep(20); tk('[data-cb-cbgskill="arcana"]'); await sleep(20);
        ok('builder: two skills and no more', JSON.stringify(CB.build.customBg.skills) === '["stealth","survival"]');
        cbClose();
      } catch(e){ ok('sheet: round 4 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.sktD = st.d; window.showConfirm = st.conf; window._findCombatantForPartyMember = st.find;
        document.getElementById('cb-root')?.remove(); CB = null;
        if (typeof csClose === 'function') csClose();
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Sheet round 5: concentration checks, initiative, ammunition, healing, homebrew, two hands --
    {
      const p0 = localStorage.getItem('skt-party-v1'), c0 = localStorage.getItem('skt-combat-v1');
      const st = { d: window.sktD, find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        const base = { method: 'manual', base: { str: 14, dex: 16, con: 14, int: 10, wis: 15, cha: 8 } };
        const rb = Object.assign(sktBlankBuild('2014'), { name: 'Archer', cls: 'Ranger', species: 'Human', level: 5, abilities: base,
          equipment: { cls: 'A', bg: 'A', clsBlocks: ['a', 'a', 'a'] }, spells: ['Cure Wounds', 'Hunter’s Mark'.replace('’', "'")] });
        const rec = sktComputeCharacter(rb, R14); rec.id = 'pc_r5'; state.party.push(rec); save();
        const me = () => state.party.find(p => p.id === 'pc_r5');
        window._findCombatantForPartyMember = () => -1;
        openCharSheet('pc_r5'); await sleep(500);
        const q = s => document.querySelector('#cs-root ' + s);
        // Concentration check.
        me().concentration = "Hunter's Mark"; csRender();
        q('[data-cs-amt]').value = '24'; q('[data-cs-hp="-1"]').click(); await sleep(40);
        ok('concentration: damage while concentrating asks for a CON save, DC half the damage', /CON save DC 12/.test((q('.cs-conc') || {}).textContent || ''));
        window.sktD = () => 2;
        q('[data-cs="concsave"]').click(); await sleep(60);
        ok('concentration: failing it ends the spell', !me().concentration && !q('.cs-conc'));
        me().concentration = "Hunter's Mark"; csRender();
        q('[data-cs-amt]').value = '4'; q('[data-cs-hp="-1"]').click(); await sleep(40);
        window.sktD = () => 15;
        q('[data-cs="concsave"]').click(); await sleep(60);
        ok('concentration: passing keeps it (DC 10 at least)', me().concentration === "Hunter's Mark");
        // Ammunition.
        const lb = (me().sheet.attacks || []).findIndex(a => a.name === 'Longbow');
        ok('ammo: the longbow shows the arrows left', lb >= 0 && /20 arrows left/.test(q('.cs-atks').textContent), q('.cs-atks') && q('.cs-atks').textContent.slice(0, 300));
        q('[data-cs-atk="' + lb + '"]').click(); await sleep(400);
        ok('ammo: an attack uses one', /19 arrows left/.test(q('.cs-atks').textContent) && me().build.items.some(x => x.name === 'Arrows' && x.qty === 19));
        // Two hands.
        const vs = (me().sheet.attacks || []).findIndex(a => a.versatile);
        if (vs >= 0){
          q('[data-cs-dmg2="' + vs + '"]').click(); await sleep(30);
          ok('two hands: a versatile weapon rolls its bigger die', /two hands/.test(CS.log[0].label));
        }
        // Healing.
        q('[data-cs-tab="spells"]').click(); await sleep(40);
        const cw = q('[data-cs-spheal="Cure Wounds"]');
        ok('healing: Cure Wounds shows its healing with the modifier', !!cw && /1d8\+2/.test(cw.textContent), cw && cw.textContent);
        window.sktD = () => 5; cw.click(); await sleep(30);
        ok('healing: and rolls it', CS.log[0].total === 7 && /heals/.test(CS.log[0].label));
        ok('healing: more at a higher slot', csSpellHeal(csSpell('Cure Wounds'), 2, 2) === '2d8+2');
        // Homebrew gear.
        q('[data-cs-tab="inventory"]').click(); await sleep(1500);
        q('[data-cs-custom]').value = 'Sunblade-ish'; q('[data-cs-customkind]').value = 'martial'; q('[data-cs-customstat]').value = '1d10 radiant'; q('[data-cs-custombonus]').value = '2';
        q('[data-cs="addcustom"]').click(); await sleep(400);
        const sb = (me().sheet.attacks || []).find(a => a.name === 'Sunblade-ish');
        ok('homebrew: a custom weapon fights, with its bonus', !!sb && /1d10\+\d+ radiant/.test(sb.damage) && sb.atkBonus === sktSigned(2 + 3 + 2), sb && JSON.stringify(sb));
        q('[data-cs-custom]').value = 'Dragonhide'; q('[data-cs-customkind]').value = 'MA'; q('[data-cs-customstat]').value = 'AC 15';
        q('[data-cs="addcustom"]').click(); await sleep(400);
        ok('homebrew: custom armour is worn when it is the best', me().ac >= 15 + 2 && /Dragonhide/.test(me().sheet.acSource), me().ac + ' ' + me().sheet.acSource);
        // Initiative into the fight.
        csClose();
        const cmb = { id: 'cmb_r5', name: 'Archer', isPC: true, hp: me().hp, hpMax: me().hpMax, ac: me().ac, initiative: 0, conditions: [] };
        state.combatants.push(cmb); save();
        window._findCombatantForPartyMember = p => p.id === 'pc_r5' ? state.combatants.findIndex(c => c.id === 'cmb_r5') : -1;
        openCharSheet('pc_r5'); await sleep(200);
        window.sktD = () => 11;
        document.querySelector('#cs-root [data-cs-roll="init"]').click(); await sleep(40);
        ok('initiative: a roll on the sheet lands on the combat card', state.combatants.find(c => c.id === 'cmb_r5').initiative === 11 + me().init);
        csClose();
      } catch(e){ ok('sheet: round 5 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.sktD = st.d; window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); if (c0 != null) localStorage.setItem('skt-combat-v1', c0); } finally { _remoteUpdate = false; }
        loadDomain('party'); loadDomain('combat');
        panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Sheet round 6: armour and stealth, slot recovery, Font of Magic, rage, hit dice --
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { d: window.sktD, find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const base = { method: 'manual', base: { str: 16, dex: 12, con: 14, int: 16, wis: 10, cha: 16 } };
        const mk = (id, extra) => { const r = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { species: 'Human', abilities: base }, extra), R14); r.id = id; state.party.push(r); save(); return r; };
        const me = id => state.party.find(p => p.id === id);
        // Chain mail: Stealth at disadvantage.
        mk('pc_r6a', { name: 'Clank', cls: 'Fighter', level: 1, equipment: { cls: 'A', bg: 'A', clsBlocks: ['a', 'a', 'a', 'a'] } });
        openCharSheet('pc_r6a'); await sleep(300);
        ok('stealth: chain mail marks Stealth', me('pc_r6a').sheet.stealthDis === true && /D/.test(document.querySelector('#cs-root [data-cs-roll="skill:stealth"] .cs-dis').textContent));
        let k = 0; window.sktD = () => (k++ % 2 ? 15 : 5);
        document.querySelector('#cs-root [data-cs-roll="skill:stealth"]').click(); await sleep(30);
        ok('stealth: and rolls it at disadvantage', CS.log[0].mode === 'dis' && /armour/.test(CS.log[0].why));
        document.querySelector('#cs-root [data-cs-roll="skill:athletics"]').click(); await sleep(30);
        ok('stealth: other skills are not affected', CS.log[0].mode === 'normal');
        ok('hit dice: shown on the sheet', /Hit dice 1\/1/.test(document.querySelector('#cs-root .cs-state').textContent));
        csClose();
        // Arcane Recovery.
        mk('pc_r6b', { name: 'Recall', cls: 'Wizard', level: 6 });
        const w = me('pc_r6b');
        w.sheet.spellSlots[3].expended = 2; w.sheet.spellSlots[1].expended = 1; save();
        openCharSheet('pc_r6b', { tab: 'spells' }); await sleep(300);
        document.querySelector('#cs-root [data-cs="recover"]').click(); await sleep(40);
        // It opens the slot picker on the highest-first pick; Recover takes it.
        document.querySelector('#cs-root [data-cs="recgo"]').click(); await sleep(40);
        ok('Arcane Recovery: three levels back for a 6th-level wizard, highest first', me('pc_r6b').sheet.spellSlots[3].expended === 1 && me('pc_r6b').sheet.spellSlots[1].expended === 1
           && me('pc_r6b').resources.find(r => r.name === 'Arcane Recovery').current === 0 && !document.querySelector('#cs-root [data-cs="recover"]'));
        csClose();
        // Font of Magic.
        mk('pc_r6c', { name: 'Fonty', cls: 'Sorcerer', subclass: 'Draconic Bloodline', level: 5 });
        openCharSheet('pc_r6c', { tab: 'spells' }); await sleep(300);
        const sp0 = me('pc_r6c').resources.find(r => r.name === 'Sorcery Points');
        sp0.current = 1; save(); csRender();
        const sel = document.querySelector('#cs-root [data-cs-fontslot]'); sel.value = '2';
        document.querySelector('#cs-root [data-cs="font2pts"]').click(); await sleep(40);
        ok('Font of Magic: a 2nd-level slot becomes 2 points', me('pc_r6c').resources.find(r => r.name === 'Sorcery Points').current === 3 && me('pc_r6c').sheet.spellSlots[2].expended === 1);
        const sel2 = document.querySelector('#cs-root [data-cs-fontpts]'); sel2.value = '2';
        document.querySelector('#cs-root [data-cs="font2slot"]').click(); await sleep(40);
        ok('Font of Magic: and 3 points make it back', me('pc_r6c').resources.find(r => r.name === 'Sorcery Points').current === 0 && me('pc_r6c').sheet.spellSlots[2].expended === 0);
        csClose();
        // Rage.
        mk('pc_r6d', { name: 'Grr', cls: 'Barbarian', level: 1 });
        openCharSheet('pc_r6d'); await sleep(300);
        document.querySelector('#cs-root [data-cs-use="Rage"]').click(); await sleep(60);
        ok('rage: using Rage turns raging on', me('pc_r6d').rage === true && me('pc_r6d').resources.find(r => r.name === 'Rage').current === 1 && /Raging/.test(document.querySelector('#cs-root .cs-state').textContent));
        document.querySelector('#cs-root [data-cs="endrage"]').click(); await sleep(40);
        ok('rage: and it can be ended', me('pc_r6d').rage === false);
        csClose();
      } catch(e){ ok('sheet: round 6 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.sktD = st.d; window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 7: Quick Build, suggested scores, export/import, spells in Actions --
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const ed0 = state.settings && state.settings.builderEdition;
      const st = { conf: window.showConfirm, find: window._findCombatantForPartyMember };
      try {
        for (const ed of ['2014', '2024']){
          for (const cls of ['Wizard', 'Cleric', 'Rogue', 'Paladin', 'Artificer']){
            await openCharBuilder({ edition: ed }); await sleep(ed === '2014' ? 700 : 300);
            const r = document.getElementById('cb-root');
            r.querySelector('[data-cb-step="class"]').click(); await sleep(20);
            r.querySelector('[data-cb-cls="' + cls + '"]').click(); await sleep(20);
            r.querySelector('[data-cb-step="basics"]').click(); await sleep(20);
            const lv = r.querySelector('[data-cb-in="level"]'); lv.value = '5'; lv.dispatchEvent(new Event('input', { bubbles: true })); await sleep(20);
            r.querySelector('[data-cb="quick"]').click(); await sleep(60);
            const todo = sktBuildTodo(CB.build, CB.R);
            ok('quick build ' + ed + ' ' + cls + ' 5: nothing left to choose, spells included', todo.length === 0, JSON.stringify(todo));
            const order = SKT_ABILITY_ORDER[cls.toLowerCase()];
            ok('quick build ' + ed + ' ' + cls + ': the 15 goes in ' + order[0].toUpperCase() + ', the 14 in ' + order[1].toUpperCase(),
               CB.build.abilities.base[order[0]] === 15 && CB.build.abilities.base[order[1]] === 14, JSON.stringify(CB.build.abilities.base));
            cbClose();
          }
        }
        // Suggested scores.
        await openCharBuilder({ edition: '2024' }); await sleep(300);
        const r = document.getElementById('cb-root');
        r.querySelector('[data-cb-step="class"]').click(); await sleep(20); r.querySelector('[data-cb-cls="Rogue"]').click(); await sleep(20);
        r.querySelector('[data-cb-step="abilities"]').click(); await sleep(20);
        r.querySelector('[data-cb="suggest"]').click(); await sleep(30);
        ok('suggest: a rogue’s 15 goes in DEX, 14 in CON', CB.build.abilities.base.dex === 15 && CB.build.abilities.base.con === 14 && CB.build.abilities.base.str === 8);
        cbClose();
        // Export and import.
        const src = state.party.find(p => p.build) || state.party[0];
        const file = sktCharacterFile(src);
        ok('export: the file carries the character and its build', JSON.parse(file).format === 'skt-character' && JSON.parse(file).character.name === src.name);
        const n0 = state.party.length;
        const rec = sktImportCharacter(file);
        ok('import: it joins the party as a new member', state.party.length === n0 + 1 && rec.id !== src.id && rec.name === src.name);
        let bad = '';
        try { sktImportCharacter('{"hello":1}'); } catch(e){ bad = e.message; }
        ok('import: a file without a character is refused, with a reason', /no character/.test(bad) && state.party.length === n0 + 1);
        ok('party: the panel menu offers Import', panelDefs.party.menuItems().some(i => /Import a character/.test(i.label)));
        // Spells in Actions.
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const wz = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Bolt', cls: 'Wizard', species: 'Human', level: 5, abilities: { method: 'manual', base: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 } },
          spellbook: ['Fireball', 'Shield', 'Ray of Sickness'], spells: ['Fireball', 'Shield', 'Ray of Sickness'] }), R14);
        wz.id = 'pc_r7'; state.party.push(wz); save();
        openCharSheet('pc_r7'); await sleep(300);
        const at = document.querySelector('#cs-root .cs-pane').textContent;
        ok('actions: attack and save spells listed with their damage', /Fireball/.test(at) && /8d6/.test(at) && /DC 14 DEX/.test(at) && /Ray of Sickness/.test(at) && !/Shield 1st/.test(at));
        csClose();
      } catch(e){ ok('round 7 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.showConfirm = st.conf; window._findCombatantForPartyMember = st.find;
        document.getElementById('cb-root')?.remove(); CB = null;
        if (typeof csClose === 'function') csClose();
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 8: off-hand attacks, Sneak Attack, Divine Smite --------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { d: window.sktD, find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const base = { method: 'manual', base: { str: 10, dex: 16, con: 14, int: 12, wis: 10, cha: 14 } };
        // A rogue with two shortswords (kit A then two daggers): the off-hand attack.
        const rg = Object.assign(sktBlankBuild('2014'), { name: 'Twin', cls: 'Rogue', species: 'Human', level: 5, abilities: base, equipment: { cls: 'A', bg: 'A', clsBlocks: ['b', 'a', 'a'] } });
        const RG = sktComputeCharacter(rg, R14);
        const off = RG.sheet.attacks.find(a => /\(off-hand\)/.test(a.name));
        ok('off-hand: two light weapons give a bonus-action attack without the modifier', !!off && /^1d\d+ (piercing|slashing)$/.test(off.damage), JSON.stringify(RG.sheet.attacks.map(a => a.name + ' ' + a.damage)));
        const fb = Object.assign(sktBlankBuild('2014'), { cls: 'Fighter', species: 'Human', level: 1, abilities: { method: 'manual', base: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 } },
          equipment: { cls: 'A', bg: 'A', clsBlocks: ['a', 'a', 'b', 'a'] } });
        const offOf = b => (sktComputeCharacter(b, R14).sheet.attacks.find(a => a.name === 'Handaxe (off-hand)') || {}).damage;
        ok('off-hand: two handaxes — no modifier on the off-hand…', offOf(fb) === '1d6 slashing', offOf(fb));
        ok('off-hand: …until Two-Weapon Fighting adds it', offOf(Object.assign({}, fb, { optional: { 'Fighting Style': ['Two-Weapon Fighting'] } })) === '1d6+3 slashing', offOf(Object.assign({}, fb, { optional: { 'Fighting Style': ['Two-Weapon Fighting'] } })));
        RG.id = 'pc_r8a'; state.party.push(RG); save();
        openCharSheet('pc_r8a'); await sleep(300);
        const sb = document.querySelector('#cs-root [data-cs-xdmg^="Sneak Attack|"]');
        ok('sneak attack: a 5th-level rogue rolls 3d6', !!sb && /3d6/.test(sb.textContent));
        window.sktD = () => 4;
        sb.click(); await sleep(30);
        ok('sneak attack: and the roll adds up', CS.log[0].total === 12);
        csClose();
        // A paladin smites with a slot.
        const pl = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Smiter', cls: 'Paladin', species: 'Human', level: 5, abilities: { method: 'manual', base: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 16 } } }), R14);
        pl.id = 'pc_r8b'; state.party.push(pl); save();
        openCharSheet('pc_r8b'); await sleep(300);
        const lvl = document.querySelector('#cs-root [data-cs-smitelvl]'); lvl.value = '2';
        document.querySelector('#cs-root [data-cs-smiteundead]').checked = true;
        document.querySelector('#cs-root [data-cs="smite"]').click(); await sleep(40);
        const me = state.party.find(p => p.id === 'pc_r8b');
        ok('smite: a 2nd-level slot against undead is 4d8, and spends the slot', CS.log[0].total === 16 && /radiant/.test(CS.log[0].type) && me.sheet.spellSlots[2].expended === 1);
        csClose();
      } catch(e){ ok('round 8 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.sktD = st.d; window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 9: custom proficiencies, languages, defences, senses ---------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const r9 = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Custom', cls: 'Fighter', species: 'Human', level: 1 }), R14);
        r9.id = 'pc_r9'; state.party.push(r9); save();
        const me = () => state.party.find(p => p.id === 'pc_r9');
        openCharSheet('pc_r9'); await sleep(300);
        document.querySelector('#cs-root [data-cs="customize"]').click(); await sleep(30);
        const set = (k, v) => { const e = document.querySelector('#cs-root [data-cs-ovlist="' + k + '"]'); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        set('languages', 'Sylvan, Thieves cant'); await sleep(300);
        set('tools', "Smith's Tools"); await sleep(300);
        set('resist', 'cold'); await sleep(300);
        set('vulnerable', 'radiant'); await sleep(300);
        set('senses', 'Darkvision 60 ft.'); await sleep(300);
        ok('customize: an extra language and tool', /Sylvan/.test(me().sheet.languages) && me().sheet.proficiencies.tools.includes("smith's tools"));
        ok('customize: a resistance and a vulnerability the rules don’t know', me().resistances.includes('cold') && me().vulnerabilities.includes('radiant'));
        ok('customize: and a sense', /Darkvision 60 ft/.test(me().sheet.senses));
        set('vulnerable', ''); await sleep(300);
        ok('customize: taking it off takes it away', !me().vulnerabilities.includes('radiant'));
        csClose();
      } catch(e){ ok('round 9 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 10: score breakdowns, spell filters, item text, coin transactions --
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const b10 = Object.assign(sktBlankBuild('2014'), { name: 'Tally', cls: 'Wizard', species: 'Elf', subspecies: 'High', level: 4, background: 'Sage',
          abilities: { method: 'manual', base: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 } }, asi: { 4: { type: 'asi', inc: { int: 2 } } },
          cantrips: ['Fire Bolt', 'Light', 'Mage Hand'], spellbook: ['Magic Missile', 'Shield', 'Misty Step', 'Sleep', 'Web', 'Burning Hands'], spells: ['Magic Missile', 'Shield', 'Misty Step', 'Sleep', 'Web', 'Burning Hands'] });
        const why = sktAbilityBreakdown(b10, R14);
        ok('scores: where INT comes from — base, species, the level 4 improvement', why.int === 'Base 15 · Species +1 · Level 4 improvement +2', why.int);
        ok('scores: and DEX', why.dex === 'Base 14 · Species +2', why.dex);
        const r10 = sktComputeCharacter(b10, R14); r10.id = 'pc_r10'; r10.gold = 5; r10.coins = { pp: 0, ep: 0, sp: 0, cp: 0 }; state.party.push(r10); save();
        const me = () => state.party.find(p => p.id === 'pc_r10');
        openCharSheet('pc_r10'); await sleep(400);
        ok('scores: the sheet’s INT box says why', /Level 4 improvement \+2/.test(document.querySelector('#cs-root [data-cs-roll="ab:int"]').title));
        // Spell filters.
        document.querySelector('#cs-root [data-cs-tab="spells"]').click(); await sleep(30);
        const spellNames = () => [...document.querySelectorAll('#cs-root .cs-spell-n b')].map(e => e.textContent);
        document.querySelector('#cs-root [data-cs-splv="0"]').click(); await sleep(30);
        ok('spells: the Cantrips pill shows only cantrips', JSON.stringify(spellNames()) === '["Fire Bolt","Light","Mage Hand"]', JSON.stringify(spellNames()));
        document.querySelector('#cs-root [data-cs-splv="all"]').click(); await sleep(30);
        const sq = document.querySelector('#cs-root [data-cs-spq]'); sq.value = 'mis'; sq.dispatchEvent(new Event('input', { bubbles: true })); await sleep(350);
        ok('spells: search narrows the list, the box keeps the caret', JSON.stringify(spellNames()) === '["Magic Missile","Misty Step"]' && document.activeElement === document.querySelector('#cs-root [data-cs-spq]'), JSON.stringify(spellNames()));
        CS.readOnly = true; csRender();
        const sq2 = document.querySelector('#cs-root [data-cs-spq]'); sq2.value = 'fire'; sq2.dispatchEvent(new Event('input', { bubbles: true })); await sleep(350);
        ok('spells: someone else’s read-only sheet can be searched too', JSON.stringify(spellNames()) === '["Fire Bolt"]', JSON.stringify(spellNames()));
        CS.readOnly = false; CS.spQ = ''; csRender();
        // Item text.
        document.querySelector('#cs-root [data-cs-tab="inventory"]').click(); await sleep(1500);
        const qi = me().build.items && me().build.items.length ? 0 : 0;
        document.querySelector('#cs-root [data-cs-open="it:0"]').click(); await sleep(40);
        ok('items: an item opens to what it is', !!document.querySelector('#cs-root .cs-itemt'));
        // Coins.
        const tx = document.querySelector('#cs-root [data-cs-txn]'); tx.value = '30'; document.querySelector('#cs-root [data-cs-txc]').value = 'sp';
        document.querySelector('#cs-root [data-cs="coinadd"]').click(); await sleep(40);
        ok('coins: adding 30 sp', me().coins.sp === 30);
        document.querySelector('#cs-root [data-cs-txn]').value = '7'; document.querySelector('#cs-root [data-cs-txc]').value = 'gp';
        document.querySelector('#cs-root [data-cs="coinspend"]').click(); await sleep(40);
        ok('coins: spending 7 gp from 5 gp and 30 sp: silver first, 1 gp left', me().gold === 1 && me().coins.sp === 0, JSON.stringify({ g: me().gold, c: me().coins }));
        document.querySelector('#cs-root [data-cs-txn]').value = '50'; document.querySelector('#cs-root [data-cs="coinspend"]').click(); await sleep(40);
        ok('coins: not more than there is, and it says so', me().gold === 1 && me().coins.sp === 0 && [...document.querySelectorAll('.toast-item')].some(t => /Not that much money/.test(t.textContent)));
        csClose();
      } catch(e){ ok('round 10 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 11: manual hit points, containers, theme colour -------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const b11 = Object.assign(sktBlankBuild('2014'), { name: 'Packer', cls: 'Fighter', species: 'Human', level: 3, background: 'Soldier', abilities: { method: 'manual', base: { str: 15, dex: 12, con: 14, int: 10, wis: 10, cha: 8 } } });
        ok('hit points: entered by hand', sktComputeCharacter(Object.assign({}, b11, { hp: { method: 'manual', manual: 40, rolls: {} } }), R14).hpMax === 40);
        const r11 = sktComputeCharacter(b11, R14); r11.id = 'pc_r11'; state.party.push(r11); save();
        const me = () => state.party.find(p => p.id === 'pc_r11');
        openCharSheet('pc_r11', { tab: 'inventory' }); await sleep(1800);
        const q = s => document.querySelector('#cs-root ' + s);
        q('[data-cs-custom]').value = 'Bag of Holding'; q('[data-cs-customwt]').value = '15'; q('[data-cs="addcustom"]').click(); await sleep(400);
        q('[data-cs-custom]').value = 'Anvil'; q('[data-cs-customwt]').value = '100'; q('[data-cs="addcustom"]').click(); await sleep(400);
        const carry = () => parseFloat((/Carrying ([\d.]+)/.exec(q('.cs-carry').textContent) || [])[1]);
        const before = carry();
        const ai = me().build.items.findIndex(x => x.name === 'Anvil');
        const sel = q('[data-cs-in="' + ai + '"]');
        ok('containers: an item can go into a bag', !!sel && [...sel.options].some(o => o.value === 'Bag of Holding'));
        sel.value = 'Bag of Holding'; sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(400);
        ok('containers: in a Bag of Holding it weighs nothing', me().build.items.find(x => x.name === 'Anvil').in === 'Bag of Holding' && Math.round(before - carry()) === 100, before + ' → ' + carry());
        // Theme colour.
        q('[data-cs="customize"]').click(); await sleep(30);
        const tc = q('[data-cs-theme]'); tc.value = '#3366cc'; tc.dispatchEvent(new Event('change', { bubbles: true })); await sleep(40);
        ok('theme: the sheet takes the character’s colour', me().theme === '#3366cc' && document.getElementById('cs-root').classList.contains('themed'));
        csClose();
      } catch(e){ ok('round 11 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 12: Lucky, Reliable Talent, Heroic Inspiration reroll, the roll log --
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { d: window.sktD, find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const base = { method: 'manual', base: { str: 8, dex: 16, con: 12, int: 12, wis: 10, cha: 14 } };
        const h = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Pip', cls: 'Rogue', species: 'Halfling', subspecies: 'Lightfoot', level: 11, abilities: base,
          skills: ['stealth', 'acrobatics', 'perception', 'deception'] }), R14);
        h.id = 'pc_r12'; h.inspiration = true; state.party.push(h); save();
        const me = () => state.party.find(p => p.id === 'pc_r12');
        openCharSheet('pc_r12'); await sleep(300);
        const q = s => document.querySelector('#cs-root ' + s);
        let seq = [1, 14]; window.sktD = () => seq.length ? seq.shift() : 10;
        q('[data-cs-roll="save:con"]').click(); await sleep(30);
        ok('Lucky: a halfling’s natural 1 is rolled again', CS.log[0].natural === 14 && /Lucky/.test(CS.log[0].why));
        seq = [3]; q('[data-cs-roll="skill:stealth"]').click(); await sleep(30);
        ok('Reliable Talent: a proficient check never shows under 10', CS.log[0].natural === 10 && /Reliable Talent/.test(CS.log[0].why));
        seq = [3]; q('[data-cs-roll="skill:arcana"]').click(); await sleep(30);
        ok('Reliable Talent: not for a skill without proficiency', CS.log[0].natural === 3);
        ok('inspiration: a Reroll button while inspired', !!q('[data-cs="reroll"]'));
        seq = [18]; q('[data-cs="reroll"]').click(); await sleep(40);
        ok('inspiration: rerolling spends it', CS.log[0].natural === 18 && /reroll/.test(CS.log[0].label) && me().inspiration === false && !q('[data-cs="reroll"]'));
        q('[data-cs="log"]').click(); await sleep(20);
        ok('log: the recent rolls', document.querySelectorAll('#cs-root .cs-log > div').length >= 4);
        csClose();
      } catch(e){ ok('round 12 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.sktD = st.d; window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 13: party XP, Level up badge, prepared count ---------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { modal: window.showModal, find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const mk = (id, name) => { const r = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name, cls: 'Cleric', subclass: 'Life', species: 'Human', level: 1, advancement: 'xp',
          abilities: { method: 'manual', base: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 } }, cantrips: ['Light', 'Guidance', 'Sacred Flame'], spells: ['Bless'] }), R14); r.id = id; r.xp = 0; state.party.push(r); return r; };
        mk('pc_x1', 'Xa'); mk('pc_x2', 'Xb'); save();
        openPanel('party'); await sleep(200);
        const P = panelDefs.party;
        ok('xp: the party menu offers Award XP', P.menuItems().some(i => i.label === 'Award XP…'));
        window.showModal = () => Promise.resolve({ xp: '600' });
        P._awardXp(); await sleep(60);
        const x = id => state.party.find(p => p.id === id);
        ok('xp: shared evenly', x('pc_x1').xp === 300 && x('pc_x2').xp === 300);
        P._render(); await sleep(30);
        ok('xp: enough for level 2 shows Level up!', !!P._body.querySelector('[data-act="xp-levelup"]'));
        closePanel('party');
        openCharSheet('pc_x1', { tab: 'spells' }); await sleep(300);
        ok('spells: the prepared count, and how many more', /prepared 1 \/ 4/.test(document.querySelector('#cs-root .cs-prepcount').textContent) && !!document.querySelector('#cs-root .cs-prepcount [data-cs="manage"]'),
           document.querySelector('#cs-root .cs-prepcount') && document.querySelector('#cs-root .cs-prepcount').textContent);
        csClose();
      } catch(e){ ok('round 13 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.showModal = st.modal; window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 15: crit range, extra crit dice, Great Weapon Fighting ------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { d: window.sktD, find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        window._findCombatantForPartyMember = () => -1;
        const base = { method: 'manual', base: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 } };
        // A half-orc Champion with a greatsword and Great Weapon Fighting.
        const ch = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Crit', cls: 'Fighter', subclass: 'Champion', species: 'Half-Orc', level: 3, abilities: base,
          optional: { 'Fighting Style': ['Great Weapon Fighting'] }, equipment: { cls: 'A', bg: 'A', clsBlocks: ['a', 'b', 'a', 'a'], picks: { 'cls:1:0': 'greatsword', 'cls:1:1': 'greatsword' } } }), R14);
        ok('rules: a Champion crits on 19, a half-orc adds a die, GWF is noted', ch.sheet.critRange === 19 && ch.sheet.critExtraDice === 1 && ch.sheet.greatWeaponFighting === true);
        ch.id = 'pc_r15'; state.party.push(ch); save();
        openCharSheet('pc_r15'); await sleep(300);
        const gi = ch.sheet.attacks.findIndex(a => a.name === 'Greatsword');
        ok('setup: a greatsword', gi >= 0, JSON.stringify(ch.sheet.attacks.map(a => a.name)));
        window.sktD = () => 19;
        document.querySelector('#cs-root [data-cs-atk="' + gi + '"]').click(); await sleep(30);
        ok('crit: a 19 is a critical hit for a Champion', CS.lastAtkCrit && CS.lastAtkCrit.crit === true);
        // Damage: 2d6 doubled (4) + 1 Savage die = 5 dice; GWF rerolls the 1s.
        const seq = [1, 6, 6, 6, 6, 6]; window.sktD = () => seq.length ? seq.shift() : 6;
        document.querySelector('#cs-root [data-cs-dmg="' + gi + '"]').click(); await sleep(30);
        ok('crit: five dice (two doubled, one Savage Attacks), the 1 rerolled by Great Weapon Fighting', CS.log[0].total === 5 * 6 + 4 && /5d6/.test(CS.log[0].detail), CS.log[0].detail + ' = ' + CS.log[0].total);
        csClose();
        ok('2024: Great Weapon Fighting counts 1s and 2s as 3s', (() => { const q = [1, 2]; window.sktD = () => q.length ? q.shift() : 4; return sktDamageRoll('2d6', false, { gwf: '2024' }).total === 6; })());
      } catch(e){ ok('round 15 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.sktD = st.d; window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 16: how hit points and AC are worked out ------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const f16 = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Sums', cls: 'Fighter', species: 'Human', level: 5, abilities: { method: 'manual', base: { str: 15, dex: 12, con: 13, int: 10, wis: 10, cha: 8 } },
          optional: { 'Fighting Style': ['Defense'] }, equipment: { cls: 'A', bg: 'A', clsBlocks: ['a', 'a', 'a', 'a'] } }), R14);
        ok('working: hit points show their sum', /^level 1: 10 [+-]\d CON · Fighter levels 2–5: 4 × 6 [+-]\d each = \d+$/.test(f16.sheet.hpDetail) && f16.sheet.hpDetail.endsWith('= ' + f16.hpMax), f16.sheet.hpDetail);
        ok('working: AC shows its parts', /^Chain Mail 16 \+ Defense 1 \+ Shield 2 = 19$/.test(f16.sheet.acDetail), f16.sheet.acDetail);
        f16.id = 'pc_r16'; state.party.push(f16); save();
        openCharSheet('pc_r16'); await sleep(250);
        ok('working: on the sheet, on hover', /Chain Mail 16/.test(document.querySelector('#cs-root .cs-boxes .cs-box').title) && /level 1/.test(document.querySelector('#cs-root .cs-hp').title));
        csClose();
      } catch(e){ ok('round 16 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 17: custom trackers and actions ---------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const c17 = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Charges', cls: 'Wizard', species: 'Human', level: 3 }), R14);
        c17.id = 'pc_r17'; state.party.push(c17); save();
        const me = () => state.party.find(p => p.id === 'pc_r17');
        openCharSheet('pc_r17'); await sleep(300);
        const q = s => document.querySelector('#cs-root ' + s);
        q('.cs-addcustom').open = true;
        q('[data-cs-trk]').value = 'Wand of Magic Missiles'; q('[data-cs-trkmax]').value = '7'; q('[data-cs="addtrk"]').click(); await sleep(300);
        ok('custom: a tracker with its uses', (me().resources.find(r => r.name === 'Wand of Magic Missiles') || {}).max === 7);
        q('.cs-addcustom').open = true;
        q('[data-cs-act]').value = 'Gnome Trick'; q('[data-cs-acttype]').value = 'Bonus Action'; q('[data-cs-actdesc]').value = 'A small illusion.'; q('[data-cs="addact"]').click(); await sleep(300);
        ok('custom: an action under its kind', me().sheet.activations.some(a => a.name === 'Gnome Trick' && a.action === 'Bonus Action') && /Gnome Trick/.test(q('.cs-pane').textContent));
        // Spend a charge, level up: the tracker and what was spent come through.
        const ri = me().resources.findIndex(r => r.name === 'Wand of Magic Missiles');
        me().resources[ri].current = 4; save();
        const R = await sktRulesLoad('2014');
        const b = JSON.parse(JSON.stringify(me().build)); b.level = 4;
        const up = sktComputeCharacter(b, R, me());
        ok('custom: kept through a level up, charges spent stay spent', (up.resources.find(r => r.name === 'Wand of Magic Missiles') || {}).current === 4);
        csClose();
      } catch(e){ ok('round 17 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- The sheet opens for everyone, built or imported, on every tab ----------
    {
      const before = errs.length;
      const p0 = localStorage.getItem('skt-party-v1');
      try {
        const list = state.party.slice(0, 8);
        let opened = 0, bad = [];
        for (const pc of list){
          try {
            openCharSheet(pc.id); await sleep(150);
            for (const t of CS_TABS.map(x => x.id)){ CS.tab = t; csRender(); }
            if (!document.querySelector('#cs-root .cs-pane')) bad.push(pc.name);
            opened++; csClose();
          } catch(e){ bad.push(pc.name + ': ' + e.message); }
        }
        ok('sheet: opens on every tab for every party member (' + opened + ')', opened === list.length && !bad.length, bad.join(' | '));
      } finally { if (typeof csClose === 'function') csClose(); }
      ok('sheet: silent while doing it', errs.length === before, errs.slice(before).join(' | '));
    }

    // -- Quick Build for every class, both editions, levels 1 to 20 -------------
    {
      const before = errs.length;
      const ed0 = state.settings && state.settings.builderEdition;
      const p0 = localStorage.getItem('skt-party-v1');
      const left = [], broken = [];
      try {
        for (const ed of ['2014', '2024']){
          const R = await sktRulesLoad(ed);
          await openCharBuilder({ edition: ed }); await sleep(ed === '2014' ? 600 : 300);
          for (const cls of R.classes.map(c => c.name)){
            for (const lv of [1, 3, 5, 11, 20]){
              try {
                CB.build = Object.assign(sktBlankBuild(ed), { level: lv, cls, name: cls + ' ' + lv });
                cbQuickBuild();
                const todo = sktBuildTodo(CB.build, CB.R);
                if (todo.length) left.push(ed + ' ' + cls + ' ' + lv + ': ' + todo.map(t => t.what).join(', '));
                const rec = sktComputeCharacter(CB.build, CB.R);
                if (!(rec.hpMax > 0) || !(rec.ac >= 10)) broken.push(ed + ' ' + cls + ' ' + lv + ' hp ' + rec.hpMax + ' ac ' + rec.ac);
              } catch(e){ broken.push(ed + ' ' + cls + ' ' + lv + ': ' + e.message); }
            }
          }
          cbClose();
        }
      } catch(e){ broken.push('setup: ' + e.message); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party');
      }
      ok('quick build: every class at levels 1, 3, 5, 11 and 20 ends with nothing to choose', !left.length, left.slice(0, 6).join(' | '));
      ok('quick build: and a working character', !broken.length, broken.slice(0, 6).join(' | '));
      ok('quick build: silent', errs.length === before, errs.slice(before).join(' | '));
    }

    // -- Round 18: homebrew spells -------------------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { d: window.sktD, find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const c18 = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Brewer', cls: 'Wizard', species: 'Human', level: 3 }), R14);
        c18.id = 'pc_r18'; state.party.push(c18); save();
        const me = () => state.party.find(p => p.id === 'pc_r18');
        openCharSheet('pc_r18', { tab: 'spells' }); await sleep(300);
        const q = s => document.querySelector('#cs-root ' + s);
        q('[data-cs-csn]').value = 'Grease Fire'; q('[data-cs-csl]').value = '2'; q('[data-cs-csd]').value = '3d8 fire'; q('[data-cs-csc]').checked = true; q('[data-cs-cst]').value = 'A slick of burning oil.';
        q('[data-cs="addspell"]').click(); await sleep(300);
        ok('homebrew spell: added to the sheet', me().sheet.spells.includes('Grease Fire') && (me().build.customSpells || []).length === 1);
        ok('homebrew spell: under its level, with its tags and damage', /2nd level/.test(q('.cs-pane').textContent) && !!q('[data-cs-spdmg="Grease Fire"]') && /3d8 fire/.test(q('[data-cs-spdmg="Grease Fire"]').textContent));
        window.sktD = () => 4;
        q('[data-cs-spdmg="Grease Fire"]').click(); await sleep(30);
        ok('homebrew spell: its damage rolls', CS.log[0].total === 12);
        q('[data-cs-cast="Grease Fire:2"]').click(); await sleep(40);
        ok('homebrew spell: cast with a slot, and concentration', me().concentration === 'Grease Fire' && me().sheet.spellSlots[2].expended === 1);
        csClose();
      } catch(e){ ok('round 18 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.sktD = st.d; window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 19: create and open the sheet; equipment once the sheet keeps it --
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const ed0 = state.settings && state.settings.builderEdition;
      const st = { conf: window.showConfirm };
      try {
        await openCharBuilder({ edition: '2024' }); await sleep(300);
        const r = document.getElementById('cb-root');
        r.querySelector('[data-cb="quick"]').click(); await sleep(60);
        CB.step = 'review'; cbRender(); await sleep(20);
        window.showConfirm = () => Promise.resolve(true);
        r.querySelector('[data-cb="savesheet"]').click(); await sleep(400);
        ok('builder: Create and open the sheet', !document.getElementById('cb-root') && !!document.getElementById('cs-root') && state.party.some(p => p.id === CS.id));
        const id = CS.id;
        csClose();
        const i = state.party.findIndex(p => p.id === id);
        state.party[i].build.equipment = Object.assign({}, state.party[i].build.equipment, { materialized: true });
        state.party[i].build.items = [{ name: 'Rope', qty: 1 }]; save();
        await openCharBuilder({ idx: i }); await sleep(300);
        CB.step = 'equipment'; cbRender(); await sleep(20);
        ok('builder: once the sheet keeps the inventory, the kit choices are gone', /kept on their sheet/.test(document.querySelector('#cb-root .cb-main').textContent) && !document.querySelector('#cb-root [data-cb-eq]'));
        cbClose();
      } catch(e){ ok('round 19 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.showConfirm = st.conf;
        document.getElementById('cb-root')?.remove(); CB = null;
        if (typeof csClose === 'function') csClose();
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 20: a feature's uses beside it ----------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const f20 = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Uses', cls: 'Fighter', species: 'Human', level: 2 }), R14);
        f20.id = 'pc_r20'; state.party.push(f20); save();
        const me = () => state.party.find(p => p.id === 'pc_r20');
        openCharSheet('pc_r20', { tab: 'features' }); await sleep(300);
        const feat = [...document.querySelectorAll('#cs-root .cs-feat')].find(d => /Second Wind/.test(d.querySelector('summary').textContent));
        ok('features: Second Wind shows its uses beside it', !!feat && !!feat.querySelector('.cs-fuses .cs-pip.on') && /1\/1/.test(feat.querySelector('.cs-fuses').textContent));
        feat.querySelector('.cs-pip').click(); await sleep(40);
        ok('features: and spending it from there works', me().resources.find(r => r.name === 'Second Wind').current === 0);
        csClose();
      } catch(e){ ok('round 20 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 21: the Artificer -------------------------------------------------
    {
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        await openCharBuilder({ edition: '2014' }); await sleep(700);
        const r = document.getElementById('cb-root');
        r.querySelector('[data-cb-step="class"]').click(); await sleep(20);
        const card = r.querySelector('[data-cb-cls="Artificer"]');
        ok('artificer: offered on the Class step, with its book', !!card && /Tasha/.test(card.textContent));
        card.click(); await sleep(20);
        r.querySelector('[data-cb-step="basics"]').click(); await sleep(20);
        const lv = r.querySelector('[data-cb-in="level"]'); lv.value = '2'; lv.dispatchEvent(new Event('input', { bubbles: true })); await sleep(20);
        CB.step = 'levels'; cbRender(); await sleep(20);
        const main = r.querySelector('.cb-main');
        const names = R14.optional.filter(o => (o.featureType || []).includes('AI')).map(o => o.name);
        const inf = [...main.querySelectorAll('label')].filter(l => l.querySelector('input[type=checkbox]') && names.some(n => l.textContent.startsWith(n)));
        ok('artificer: infusions to choose without ticking other books', /Infusions/.test(main.textContent) && /Enhanced Defense/.test(main.textContent) && inf.length >= 10, inf.length);
        ok('artificer: an infusion shows what it goes on and its level', /Boots of the Winding Path \(level 6\+ · A pair of boots/.test(main.textContent));
        cbClose();
        // An infusion's level is the artificer's, not the character's.
        await openCharBuilder({ edition: '2014' }); await sleep(300);
        Object.assign(CB.build, { cls: 'Fighter', level: 16, multi: [{ cls: 'Artificer', level: 2 }] });
        CB.build.abilities.base.int = 14; CB.build.abilities.base.str = 14;
        CB.rec = sktComputeCharacter(CB.build, CB.R); cbQuickBuild();
        const picked = (CB.build.optional || {}).Infusions || [];
        ok('artificer multiclass: Quick Build picks only infusions a level-2 artificer can take', picked.length === 4 && !picked.some(n => /Arcane Propulsion|Winding Path|Helm of Awareness|Radiant Weapon/.test(n)), JSON.stringify(picked));
        cbClose();

        const art = (R, ed, L, extra) => sktComputeCharacter(Object.assign(sktBlankBuild(ed), { name: 'Art', cls: 'Artificer', species: 'Human', level: L,
          abilities: { method: 'manual', base: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 } } }, extra || {}), R);
        const a7 = art(R14, '2014', 7);
        const slots = a7.sheet.spellSlots || {};
        ok('artificer 2014 7: half-caster slots rounded up (4 1st, 3 2nd), INT casting', slots[1] && slots[1].total === 4 && slots[2] && slots[2].total === 3 && !slots[3] && a7.sheet.spellAbility === 'int', JSON.stringify(slots));
        const fg = a7.resources.find(x => x.name === 'Flash of Genius');
        ok('artificer: Flash of Genius uses = INT modifier, on a long rest', !!fg && fg.max === 3 && fg.recharge === 'long');
        ok('artificer: the saves and armour the book gives', (a7.sheet.saveProf || []).join() === 'con,int'
           && ['light', 'medium', 'shield'].every(x => a7.sheet.proficiencies.armor.includes(x)), JSON.stringify(a7.sheet.saveProf));
        const a14 = art(R24, '2024', 14);
        ok('artificer 2024 14: Advanced Artifice gives Flash of Genius back on a short rest', (a14.resources.find(x => x.name === 'Flash of Genius') || {}).recharge === 'short-one');
        ok('artificer 2024 14: and five attuned items', a14.sheet.attuneMax === 5);
        const al = art(R24, '2024', 5, { subclass: 'Alchemist' });
        ok('artificer 2024 alchemist 5: three experimental elixirs', (al.resources.find(x => x.name === 'Experimental Elixir') || {}).max === 3);
        ok('artificer 2024: Tinker\'s Magic uses = INT modifier', (al.resources.find(x => x.name === 'Tinker\'s Magic') || {}).max === 3);
        const mc = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'MC', cls: 'Wizard', species: 'Human', level: 6,
          abilities: { method: 'manual', base: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 13 } }, multi: [{ cls: 'Artificer', level: 3 }] }), R14);
        const ms = mc.sheet.spellSlots || {};
        ok('artificer multiclass: wizard 3 + artificer 3 casts as level 5 (4/3/2)', ms[1] && ms[1].total === 4 && ms[2] && ms[2].total === 3 && ms[3] && ms[3].total === 2, JSON.stringify(ms));
      } catch(e){ ok('round 21 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
      }
    }

    // -- Round 22: artificer plans, attunement, encumbrance ------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const ed0 = state.settings && state.settings.builderEdition;
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R24 = await sktRulesLoad('2024');
        const plans = R24.optional.filter(o => (o.featureType || []).includes('EFA:Plan'));
        ok('plans: the four Magic Item Plans tables become picks (56 plans)', plans.length === 56, plans.length);
        ok('plans: the book\'s recommended four come first', plans.slice(0, 4).map(x => x.name).sort().join() === ['+1 Wand of the War Mage', 'Bag of Holding', 'Cap of Water Breathing', 'Sending Stones'].sort().join(), plans.slice(0, 4).map(x => x.name).join());
        const boots = plans.find(x => x.name === 'Boots of the Winding Path');
        ok('plans: a level-6 table\'s plan needs artificer level 6', !!boots && boots.prerequisite[0].level.level === 6 && /attunement/.test(boots.entries[0]));
        await openCharBuilder({ edition: '2024' }); await sleep(300);
        Object.assign(CB.build, { cls: 'Artificer', level: 6 });
        CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'levels'; cbRender(); await sleep(20);
        const main = document.querySelector('#cb-root .cb-main');
        ok('plans: the builder asks for Magic Item Plans at the Plans Known count', /Magic Item Plans/.test(main.textContent) && /0\s*\/\s*5|0 of 5/.test(main.textContent), (main.textContent.match(/Magic Item Plans.{0,40}/) || [''])[0]);
        cbQuickBuild();
        const got = CB.build.optional['Magic Item Plans'] || [];
        ok('plans: Quick Build picks the recommended ones first', got.length === 5 && got.includes('Bag of Holding') && got.includes('Sending Stones'), JSON.stringify(got));
        const rec = sktComputeCharacter(CB.build, CB.R);
        ok('plans: chosen plans are listed with the features', rec.sheet.featureList.some(f => f.name === 'Bag of Holding'));
        cbClose();

        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const a = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Att', cls: 'Artificer', species: 'Human', level: 10,
          abilities: { method: 'manual', base: { str: 10, dex: 14, con: 14, int: 16, wis: 12, cha: 8 } } }), R14);
        ok('attunement: Magic Item Adept raises it to four', a.sheet.attuneMax === 4);
        a.id = 'pc_r22'; state.party.push(a); save();
        const me = () => state.party.find(p => p.id === 'pc_r22');
        me().build.items = [{ name: 'Cloak of Protection', qty: 1, reqAttune: true, attuned: true }, { name: 'Sack of rocks', qty: 1, weight: 60 }];
        me().build.equipment = Object.assign({}, me().build.equipment, { materialized: true });
        me().coins = { cp: 0, sp: 0, ep: 0, pp: 0 }; me().gold = 500; save();
        openCharSheet('pc_r22', { tab: 'inventory' }); await sleep(300);
        const carry = () => document.querySelector('#cs-root .cs-carry').textContent;
        ok('attunement: the inventory counts against four', /attuned 1 of 4/.test(carry()), carry());
        ok('encumbrance: standard rule, 60 lb + 10 lb of coins is fine at STR 10', /70 lb/.test(carry()) && /of 150 lb/.test(carry()) && !/encumbered|over/.test(carry()), carry());
        document.querySelector('#cs-root [data-cs="customize"]').click(); await sleep(40);
        const sel = document.querySelector('#cs-root [data-cs-ovpref="encumbrance"]');
        sel.value = 'variant'; sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200);
        ok('encumbrance: the variant slows the character past 5 × STR', me().build.overrides.encumbrance === 'variant' && /encumbered: speed −10/.test(carry()), carry());
        const cw = document.querySelector('#cs-root [data-cs-ovpref="coinWeight"]');
        cw.checked = false; cw.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200);
        ok('encumbrance: coins can weigh nothing', me().build.overrides.coinWeight === false && /60 lb/.test(carry()), carry());
        me().build.items[1].weight = 200; save(); csRender(); await sleep(40);
        ok('encumbrance: 200 lb is over the limit', /over the limit/.test(carry()), carry());
        const sel2 = document.querySelector('#cs-root [data-cs-ovpref="encumbrance"]');
        sel2.value = 'none'; sel2.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200);
        ok('encumbrance: or not be tracked at all', !/of 150/.test(carry()) && !/encumbered|over the limit/.test(carry()), carry());
        csClose();
      } catch(e){ ok('round 22 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        document.getElementById('cb-root')?.remove(); CB = null;
        if (typeof csClose === 'function') csClose();
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 23: the book audit's fixes -----------------------------------------
    {
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const base = { method: 'manual', base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } };
        const mk = (R, ed, extra) => sktComputeCharacter(Object.assign(sktBlankBuild(ed), { cls: 'Wizard', level: 1, allBooks: true, abilities: JSON.parse(JSON.stringify(base)) }, extra), R);
        // Feats with a fixed increase.
        const actor = mk(R14, '2014', { cls: 'Fighter', level: 4, asi: { 4: { type: 'feat', feat: 'Actor' } } });
        ok('audit: Actor gives its +1 Charisma', actor.abilities.cha === 11, actor.abilities.cha);
        const durable = mk(R14, '2014', { cls: 'Fighter', level: 4, asi: { 4: { type: 'feat', feat: 'Durable' } } });
        ok('audit: Durable gives its +1 Constitution', durable.abilities.con === 11);
        // 2014 backgrounds: languages and feats.
        const rune = mk(R14, '2014', { background: 'Rune Carver' });
        ok('audit: Rune Carver speaks Giant', /Giant/.test(rune.sheet.languages), rune.sheet.languages);
        ok('audit: Rune Carver grants Rune Shaper', rune.sheet.featureList.some(f => f.name === 'Rune Shaper'));
        const strix = mk(R14, '2014', { background: 'Lorehold Student' });
        ok('audit: a Strixhaven student gets Strixhaven Initiate', strix.sheet.featureList.some(f => f.name === 'Strixhaven Initiate'));
        const rew = mk(R14, '2014', { background: 'Rewarded', bgFeat: 2 });
        ok('audit: Rewarded grants the one feat chosen', rew.sheet.featureList.some(f => f.name === 'Skilled') && !rew.sheet.featureList.some(f => f.name === 'Lucky'));
        await openCharBuilder({ edition: '2014' }); await sleep(700);
        Object.assign(CB.build, { background: 'Rewarded', allBooks: true }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'background'; cbRender(); await sleep(20);
        const bf = document.querySelector('#cb-root [data-cb-bgfeat]');
        ok('audit: the builder asks which of Rewarded\'s feats', !!bf && bf.options.length === 3);
        bf.value = '1'; bf.dispatchEvent(new Event('change', { bubbles: true })); await sleep(30);
        ok('audit: and keeps the pick', CB.build.bgFeat === 1);
        cbClose();
        // A dwarf in heavy armour.
        const dw = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { cls: 'Fighter', level: 1, species: 'Dwarf', subspecies: 'Hill', abilities: JSON.parse(JSON.stringify(base)),
          items: [{ name: 'Chain Mail', base: 'chain mail', qty: 1, equipped: true }], equipment: { materialized: true } }), R14);
        ok('audit: a dwarf in chain mail without the Strength keeps 25 ft', dw.spd === 25, dw.spd + ' ac ' + dw.ac);
        const hu = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { cls: 'Fighter', level: 1, species: 'Human', abilities: JSON.parse(JSON.stringify(base)),
          items: [{ name: 'Chain Mail', base: 'chain mail', qty: 1, equipped: true }], equipment: { materialized: true } }), R14);
        ok('audit: a human in the same armour is slowed to 20 ft', hu.spd === 20, hu.spd);
        // Subrace to choose, unless there's a plain option.
        ok('audit: a dwarf asks for a subrace', sktBuildTodo(Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', species: 'Dwarf' }), R14).some(t => t.what === 'a subrace'));
        ok('audit: a human doesn\'t', !sktBuildTodo(Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', species: 'Human' }), R14).some(t => t.what === 'a subrace'));
        // 2024 lineages and legacies carry their numbers.
        const elf = lin => mk(R24, '2024', { species: 'Elf', speciesChoice: { lineage: lin } });
        ok('audit: a drow elf sees 120 ft in the dark', /Darkvision 120/.test(elf('Drow').sheet.senses), elf('Drow').sheet.senses);
        ok('audit: a wood elf moves 35 ft', elf('Wood Elf').spd === 35, elf('Wood Elf').spd);
        const tf = mk(R24, '2024', { species: 'Tiefling', speciesChoice: { lineage: 'Infernal' } });
        ok('audit: an infernal tiefling resists fire', (tf.resistances || []).includes('fire'), JSON.stringify(tf.resistances));
        // Goliath's giant ancestry, chosen like a subrace.
        const gol = sktRulesSpecies(R24, 'Goliath');
        ok('audit: Goliath offers its six giant ancestries', gol.subraces.filter(s => s.version).length === 6, gol.subraces.map(s => s.name).join());
        ok('audit: and asks for one', sktBuildTodo(Object.assign(sktBlankBuild('2024'), { cls: 'Wizard', species: 'Goliath' }), R24).some(t => t.what === 'a Goliath option'));
        const cloud = mk(R24, '2024', { species: 'Goliath', subspecies: 'Cloud Giant Ancestry' });
        const gf = cloud.sheet.featureList.map(f => f.name);
        ok('audit: the chosen ancestry replaces the generic trait', gf.includes('Giant Ancestry (Cloud)') && !gf.includes('Giant Ancestry'), gf.join());
        const clD = mk(R14, '2014', { species: 'Custom Lineage', subspecies: 'Darkvision' }), clS = mk(R14, '2014', { species: 'Custom Lineage', subspecies: 'Skill Proficiency' });
        ok('audit: Custom Lineage: darkvision or a skill, not both', /Darkvision 60/.test(clD.sheet.senses) && !/Darkvision/.test(clS.sheet.senses || ''), clD.sheet.senses + ' / ' + clS.sheet.senses);
        // Expanded spell lists, and 2014 subclasses for 2024 classes.
        const opts = (R, ed, cls, sub, L, lv) => sktSpellOptions(R, Object.assign(sktBlankBuild(ed), { cls, subclass: sub, level: L, subclassPick: sub === 'Divine Soul' ? 'Good' : sub === 'Genie' ? 'Dao' : '' }), lv).map(x => x.name);
        ok('audit: a fiend warlock can learn Burning Hands', opts(R14, '2014', 'Warlock', 'Fiend', 1, 1).includes('Burning Hands') && !opts(R14, '2014', 'Warlock', 'Archfey', 1, 1).includes('Burning Hands'));
        ok('audit: a 2024 hexblade gets the hexblade list', opts(R24, '2024', 'Warlock', 'Hexblade', 3, 1).includes('Shield'));
        ok('audit: chronurgy wizards get the dunamancy spells', opts(R14, '2014', 'Wizard', 'Chronurgy', 2, 1).includes('Gift of Alacrity') && !opts(R14, '2014', 'Wizard', 'Evoker', 2, 1).includes('Gift of Alacrity'));
        const forge = mk(R24, '2024', { cls: 'Cleric', subclass: 'Forge', level: 3 });
        ok('audit: a 2024 forge cleric has the domain spells', (forge.sheet.alwaysPrepared || []).includes('Searing Smite'), JSON.stringify(forge.sheet.alwaysPrepared));
        ok('audit: the 2024 Knowledge Domain is Heroes of Faerûn\'s', sktRulesSubclass(sktRulesClass(R24, 'Cleric'), 'Knowledge').source === 'FRHoF');
        // Items printed as copies, and the adventures' unrated ones.
        const m14 = await sktMagicLoad('2014'), m24 = await sktMagicLoad('2024'), g14 = await sktGearLoad('2014');
        ok('audit: the Wildemount vestiges’ exalted states can be added', m14.some(i => i.name === 'Blade of Broken Mirrors (Exalted)') && m14.some(i => i.name === "Danoth's Visor (Awakened)"));
        ok('audit: unrated magic items too (the Silver Sword)', m14.some(i => i.name === 'Silver Sword'));
        ok('audit: a copy of a reprinted item still loads in 2024', m24.some(i => i.name === "Jakarion's Staff of Frost"));
        ok('audit: and unrated curios are gear', g14.some(i => i.name === 'Iron Ball'));
        // Languages from the other books; secret ones stay with their features.
        const lc = sktLanguageOptions(R24, sktBlankBuild('2024')), la = sktLanguageOptions(R24, Object.assign(sktBlankBuild('2024'), { allBooks: true }));
        ok('audit: other books’ languages with other books on (Zemnian, Leonin)', !lc.includes('Zemnian') && la.includes('Zemnian') && la.includes('Leonin'));
        ok('audit: Druidic and Thieves’ Cant aren’t free picks', !la.includes('Druidic') && !la.includes("Thieves' Cant"));
        // Prerequisites the data writes as a feature, a campaign or one-of-a-kind.
        const fb = Object.assign(sktBlankBuild('2024'), { cls: 'Fighter', level: 4, species: 'Human', asi: { 4: { type: 'feat', feat: 'Mark of Detection' } } });
        const frec = sktComputeCharacter(fb, R24), q = (b, r, f) => sktFeatPrereq(R24, b, sktRulesFeat(R24, f), r);
        ok('audit: a second dragonmark is refused', !q(fb, frec, 'Aberrant Dragonmark').ok && /Eberron campaign/.test(q(fb, frec, 'Aberrant Dragonmark').text));
        const wb = Object.assign(sktBlankBuild('2024'), { cls: 'Wizard', level: 4, species: 'Human' }), wrec = sktComputeCharacter(wb, R24);
        ok('audit: fighting-style feats need Fighting Style', q(fb, frec, 'Archery').ok && !q(wb, wrec, 'Archery').ok);
        // Draconic ancestry / damage resistance.
        const db14 = mk(R14, '2014', { species: 'Dragonborn', speciesChoice: { ancestry: 'Silver' } }), db24 = mk(R24, '2024', { species: 'Dragonborn', speciesChoice: { ancestry: 'Red' } });
        ok('audit: a 2014 dragonborn resists the damage chosen', (db14.resistances || []).includes('cold'), JSON.stringify(db14.resistances));
        ok('audit: a red 2024 dragonborn resists fire and breathes it', (db24.resistances || []).includes('fire') && db24.sheet.notes.some(n => /Breath Weapon: fire damage \(Red/.test(n)));
        ok('audit: a dragonborn is asked for its ancestry', sktBuildTodo(Object.assign(sktBlankBuild('2024'), { cls: 'Wizard', species: 'Dragonborn' }), R24).some(t => t.what === 'a draconic ancestry'));
        ok('audit: a tiefling\'s legacy settles its resistance', !sktSpeciesResistChoice(sktRulesSpecies(R24, 'Tiefling'), sktSpeciesSub(sktRulesSpecies(R24, 'Tiefling'), { speciesChoice: { lineage: 'Infernal' } })));
        // Divine Soul: cleric spells, by sorcerer level.
        ok('audit: a divine soul can learn Cure Wounds', opts(R14, '2014', 'Sorcerer', 'Divine Soul', 1, 1).includes('Cure Wounds'));
        ok('audit: and level-2 cleric spells from sorcerer 3', !opts(R14, '2014', 'Sorcerer', 'Divine Soul', 1, 2).includes('Prayer of Healing') && opts(R14, '2014', 'Sorcerer', 'Divine Soul', 3, 2).includes('Prayer of Healing'));
        // Kobold legacies: Craftiness has no spell, Draconic Sorcery has.
        const kob = sktRulesSpecies(R14, 'Kobold');
        ok('audit: a kobold\'s legacy decides its spell', !sktSpeciesSpellGrant(R14, Object.assign(sktBlankBuild('2014'), { species: 'Kobold', subspecies: 'Craftiness' })) && !!sktSpeciesSpellGrant(R14, Object.assign(sktBlankBuild('2014'), { species: 'Kobold', subspecies: 'Draconic Sorcery' })), kob.subraces.map(s => s.name).join());
        // A feat taken at 1st level keeps its fixed increase.
        const vh = mk(R14, '2014', { species: 'Human', subspecies: 'Variant', originFeat: 'Actor' });
        ok('audit: a variant human\'s Actor still gives +1 Charisma', vh.abilities.cha === 11, vh.abilities.cha);
        // The builder: the 2024 Knowledge card, Goliath's traits, Custom Lineage's skill.
        await openCharBuilder({ edition: '2024' }); await sleep(300);
        Object.assign(CB.build, { cls: 'Cleric', level: 3, allBooks: true }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'class'; cbRender(); await sleep(20);
        const kc = document.querySelector('#cb-root [data-cb-sub="Knowledge"]');
        ok('audit: the 2024 Knowledge card is Heroes of Faerûn\'s', !!kc && /FRHoF/.test(kc.textContent), kc && kc.textContent);
        Object.assign(CB.build, { species: 'Goliath', subspecies: 'Cloud Giant Ancestry' }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'species'; cbRender(); await sleep(20);
        const traits = [...document.querySelectorAll('#cb-root .cb-feat b')].map(x => x.textContent);
        ok('audit: the Goliath step shows the chosen ancestry, not the generic trait', traits.includes('Giant Ancestry (Cloud)') && !traits.includes('Giant Ancestry'), traits.join());
        cbClose();
        await openCharBuilder({ edition: '2014' }); await sleep(300);
        Object.assign(CB.build, { species: 'Custom Lineage', subspecies: 'Darkvision', allBooks: true }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'species'; cbRender(); await sleep(20);
        const noSkill = !document.querySelector('#cb-root [data-cb-spskill]');
        CB.build.subspecies = 'Skill Proficiency'; CB.rec = sktComputeCharacter(CB.build, CB.R); cbRender(); await sleep(20);
        ok('audit: Custom Lineage asks for a skill only with that option', noSkill && !!document.querySelector('#cb-root [data-cb-spskill]'));
        cbClose();
      } catch(e){ ok('round 23 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
      }
    }

    // -- Round 24: subclass picks D&D Beyond asks for --------------------------------
    {
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const ap = (R, ed, cls, sub, L, pick) => sktBuildAlwaysPrepared(Object.assign(sktBlankBuild(ed), { cls, subclass: sub, level: L, subclassPick: pick }), R);
        ok('picks: a 2014 arctic druid has the arctic circle spells', ap(R14, '2014', 'Druid', 'Land', 5, 'Arctic').join() === 'Hold Person,Spike Growth,Sleet Storm,Slow');
        ok('picks: a 2024 polar druid has the polar spells', ap(R24, '2024', 'Druid', 'Land', 3, 'Polar Land').includes('Ray of Frost') && !ap(R24, '2024', 'Druid', 'Land', 3, 'Polar Land').includes('Fire Bolt'));
        ok('picks: and the land is asked for', sktBuildTodo(Object.assign(sktBlankBuild('2014'), { cls: 'Druid', subclass: 'Land', level: 3 }), R14).some(t => t.what === 'a land type for Land'));
        ok('picks: a good divine soul knows Cure Wounds', ap(R14, '2014', 'Sorcerer', 'Divine Soul', 1, 'Good').includes('Cure Wounds'));
        ok('picks: a giant barbarian\'s cantrip is the one chosen', ap(R14, '2014', 'Barbarian', 'Giant', 3, 'Thaumaturgy').join() === 'Thaumaturgy');
        const gen = n => sktSpellOptions(R14, Object.assign(sktBlankBuild('2014'), { cls: 'Warlock', subclass: 'Genie', level: 1, subclassPick: n }), 1).map(x => x.name);
        ok('picks: a dao genie warlock gets the dao spells, not the djinni\'s', gen('Dao').includes('Sanctuary') && !gen('Dao').includes('Thunderwave') && gen('Djinni').includes('Thunderwave'));
        // The Hunter's options and the totems.
        const h = Object.assign(sktBlankBuild('2014'), { cls: 'Ranger', subclass: 'Hunter', level: 11 });
        ok('picks: the Hunter asks for its prey, tactics and multiattack', sktBuildChoices(h, R14).map(c => c.feature).join() === "Hunter's Prey,Defensive Tactics,Multiattack");
        h.featureChoices = { "Hunter's Prey": 'Colossus Slayer', 'Defensive Tactics': 'Steel Will', Multiattack: 'Volley' };
        const hf = sktComputeCharacter(h, R14).sheet.featureList.map(f => f.name);
        ok('picks: and only the chosen options are the character\'s', hf.includes('Colossus Slayer') && !hf.includes('Giant Killer') && hf.includes('Steel Will') && !hf.includes('Escape the Horde'), hf.join());
        const h24 = Object.assign(sktBlankBuild('2024'), { cls: 'Ranger', subclass: 'Hunter', level: 7, featureChoices: { "Hunter's Prey": 'Horde Breaker' } });
        ok('picks: the 2024 Hunter\'s prey shows as chosen', sktComputeCharacter(h24, R24).sheet.notes.includes("Hunter's Prey: Horde Breaker."));
        ok('picks: the totem warrior chooses each animal', sktBuildChoices(Object.assign(sktBlankBuild('2014'), { cls: 'Barbarian', subclass: 'Totem Warrior', level: 14 }), R14).map(c => c.feature + ':' + c.spec.options.length).join() === 'Totem Spirit:5,Aspect of the Beast:5,Totemic Attunement:5');
        // The Armorer's armour model, and the model's own features.
        const arm = Object.assign(sktBlankBuild('2014'), { cls: 'Artificer', subclass: 'Armorer', level: 3, featureChoices: { 'Armor Model': 'Guardian' } });
        const af = sktComputeCharacter(arm, R14).sheet.featureList.map(f => f.name);
        ok('picks: a guardian armorer has thunder gauntlets, not the infiltrator’s launcher', af.includes('Thunder Gauntlets') && !af.includes('Lightning Launcher'), af.join());
        ok('picks: the 2024 armorer chooses from three models', (sktBuildChoices(Object.assign(sktBlankBuild('2024'), { cls: 'Artificer', subclass: 'Armorer', level: 3 }), R24).find(c => c.feature === 'Armor Model') || { spec: { options: [] } }).spec.options.length === 3);
        // Spells a subclass lets you pick.
        const gr = (R, ed, cls, sub, L) => sktSubclassSpellGrants(Object.assign(sktBlankBuild(ed), { cls, subclass: sub, level: L }), R);
        const arcana = gr(R14, '2014', 'Cleric', 'Arcana', 1)[0];
        ok('picks: an arcana cleric chooses two wizard cantrips', !!arcana && arcana.choices[0].count === 2 && arcana.choices[0].options.includes('Fire Bolt') && !arcana.choices[0].options.includes('Guidance'));
        const ab = Object.assign(sktBlankBuild('2014'), { cls: 'Cleric', subclass: 'Arcana', level: 1, featChoices: { 'Arcana Domain': { spells: ['Fire Bolt', 'Light'] } } });
        ok('picks: and has them', sktComputeCharacter(ab, R14).sheet.featSpells.some(g => g.feat === 'Arcana Domain' && g.spells.includes('Fire Bolt')));
        ok('picks: unpicked, they are on the to-do list', sktBuildTodo(Object.assign(sktBlankBuild('2014'), { cls: 'Cleric', subclass: 'Arcana', level: 1 }), R14).some(t => t.what === 'the spells from Arcana Domain'));
        const scion = gr(R24, '2024', 'Rogue', 'Scion of the Three', 3)[0];
        ok('picks: a choice written as a list offers only that list', !!scion && scion.choices[0].options.join() === 'Minor Illusion,Blade Ward,Chill Touch', scion && scion.choices[0].options.length);
        ok('picks: the Lore bard’s Additional Magical Secrets are two picks', gr(R14, '2014', 'Bard', 'Lore', 6)[0].choices.length === 2);
        // The builder: the land cards, and Quick Build keeping a storm herald's environment.
        await openCharBuilder({ edition: '2014' }); await sleep(700);
        Object.assign(CB.build, { cls: 'Druid', level: 3, subclass: 'Land' }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'class'; cbRender(); await sleep(20);
        const arc = document.querySelector('#cb-root [data-cb-subpick="Arctic"]');
        ok('picks: the Class step offers the lands', !!arc && document.querySelectorAll('#cb-root [data-cb-subpick]').length === 8);
        arc.click(); await sleep(30);
        ok('picks: and keeps the one clicked', CB.build.subclassPick === 'Arctic');
        // A multiclassed druid picks its land on its row.
        Object.assign(CB.build, { cls: 'Fighter', level: 5, subclass: 'Champion', multi: [{ cls: 'Druid', level: 3, subclass: 'Land' }] }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        ok('picks: a multiclass land druid is asked for its land', sktBuildTodo(CB.build, CB.R).some(t => t.what === 'a land type for Land'));
        CB.step = 'class'; cbRender(); await sleep(20);
        const mc = document.querySelector('#cb-root [data-cb-mcpick="0||Coast"]');
        ok('picks: its row offers the lands', !!mc);
        if (mc){ mc.click(); await sleep(30); }
        ok('picks: and keeps the one clicked', CB.build.multi[0].subclassPick === 'Coast' && sktBuildAlwaysPrepared(CB.build, CB.R).includes('Mirror Image'));
        CB.build.multi = [];
        Object.assign(CB.build, { cls: 'Barbarian', level: 14, subclass: 'Storm Herald', featureChoices: { 'Storm Aura': 'Sea' } }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        cbQuickBuild();
        ok('picks: Quick Build keeps the storm herald\'s environment', CB.build.featureChoices['Storm Soul'] === 'Sea' && CB.build.featureChoices['Raging Storm'] === 'Sea', JSON.stringify(CB.build.featureChoices));
        cbClose();
      } catch(e){ ok('round 24 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
      }
    }

    // -- Round 25: proficiencies subclass features grant -----------------------------
    {
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const pc = (R, ed, cls, sub, L, extra) => sktComputeCharacter(Object.assign(sktBlankBuild(ed), { cls, subclass: sub, level: L }, extra || {}), R);
        const hex = pc(R14, '2014', 'Warlock', 'Hexblade', 1).sheet.proficiencies;
        ok('profs: a hexblade wears medium armour and shields and uses martial weapons', hex.armor.includes('medium') && hex.armor.includes('shield') && hex.weapons.includes('martial'));
        const tem = pc(R24, '2024', 'Cleric', 'Tempest', 3).sheet.proficiencies;
        ok('profs: a tempest cleric has heavy armour and martial weapons', tem.armor.includes('heavy') && tem.weapons.includes('martial'));
        const val = pc(R14, '2014', 'Bard', 'Valor', 3).sheet.proficiencies;
        ok('profs: a valor bard has medium armour, shields and martial weapons', val.armor.includes('medium') && val.armor.includes('shield') && val.weapons.includes('martial'));
        ok('profs: a gloom stalker gains Wisdom saves at 7', pc(R14, '2014', 'Ranger', 'Gloom Stalker', 7).sheet.saveProf.includes('wis') && !pc(R14, '2014', 'Ranger', 'Gloom Stalker', 6).sheet.saveProf.includes('wis'));
        ok('profs: an artillerist uses martial ranged weapons', pc(R24, '2024', 'Artificer', 'Artillerist', 3).sheet.proficiencies.weapons.includes('longbow'));
        ok('profs: a forge cleric has smith\'s tools', pc(R14, '2014', 'Cleric', 'Forge', 1).sheet.proficiencies.tools.includes("smith's tools"));
        ok('profs: a rune knight speaks Giant', /Giant/.test(pc(R14, '2014', 'Fighter', 'Rune Knight', 3).sheet.languages));
        ok('profs: a temporary proficiency is not kept', !sktProfGrants('As an action, you touch a creature. For 1 hour, you gain proficiency with heavy armor.').any && sktProfGrants('You gain proficiency with heavy armor.').armor.includes('heavy'));
        // Choices.
        const lore = Object.assign(sktBlankBuild('2014'), { cls: 'Bard', subclass: 'Lore', level: 3 });
        ok('profs: a lore bard is asked for three skills', sktBuildTodo(lore, R14).some(t => t.what === '3 skills from Bonus Proficiencies'));
        lore.profPicks = { 'Bonus Proficiencies': { skills: ['arcana', 'history', 'stealth'] } };
        const ls = sktComputeCharacter(lore, R14).sheet.skillProf;
        ok('profs: and has the ones picked', ls.arcana && ls.history && ls.stealth);
        ok('profs: a knowledge cleric picks two of four skills', (sktProfChoices(Object.assign(sktBlankBuild('2014'), { cls: 'Cleric', subclass: 'Knowledge', level: 1 }), R14)[0] || {}).options.join() === 'arcana,history,nature,religion');
        ok('profs: a battle master picks an artisan\'s tool', sktToolChoices(Object.assign(sktBlankBuild('2014'), { cls: 'Fighter', subclass: 'Battle Master', level: 3 }), R14).some(c => c.key === 'sub:Student of War' && c.options.includes("Smith's Tools")));
        const blade = sktProfChoices(Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', subclass: 'Bladesinging', level: 2 }), R14).find(c => c.kind === 'weapons');
        ok('profs: a 2014 bladesinger picks a one-handed melee weapon', !!blade && blade.options.includes('rapier') && !blade.options.includes('greatsword'));
        // The builder: the picks on the Skills step, languages counted, Quick Build.
        await openCharBuilder({ edition: '2014' }); await sleep(700);
        Object.assign(CB.build, { cls: 'Bard', level: 3, subclass: 'Lore' }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'skills'; cbRender(); await sleep(20);
        const box = document.querySelector('#cb-root [data-cb-profpick="Bonus Proficiencies||skills||insight"]');
        ok('profs: the Skills step offers the lore bard\'s skills', !!box);
        if (box){ box.click(); await sleep(30); }
        ok('profs: and keeps the one clicked', ((CB.build.profPicks || {})['Bonus Proficiencies'] || {}).skills.includes('insight'));
        Object.assign(CB.build, { cls: 'Cleric', level: 1, subclass: 'Knowledge', profPicks: {}, background: 'Acolyte' }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        ok('profs: a knowledge cleric learns two more languages', cbLanguageCount() === 4, cbLanguageCount());
        const kcount = cbLanguageCount();
        Object.assign(CB.build, { cls: 'Ranger', level: 6, subclass: 'Hunter' }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        ok('profs: a 2014 ranger learns a language per favored enemy', cbLanguageCount() === 4, cbLanguageCount());
        Object.assign(CB.build, { cls: 'Cleric', level: 1, subclass: 'Knowledge' }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        cbQuickBuild();
        const kc = sktProfChoices(CB.build, CB.R)[0];
        ok('profs: Quick Build fills the subclass\'s picks', !!kc && kc.picked.length === 2 && !sktBuildTodo(CB.build, CB.R).some(t => /from Blessings/.test(t.what)));
        cbClose();
        await openCharBuilder({ edition: '2024' }); await sleep(300);
        Object.assign(CB.build, { cls: 'Rogue', level: 1 }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        ok('profs: a 2024 rogue learns a language beside Thieves’ Cant', cbLanguageCount() === 3, cbLanguageCount());
        Object.assign(CB.build, { cls: 'Ranger', level: 2 }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        ok('profs: a 2024 ranger’s Deft Explorer adds two', cbLanguageCount() === 4, cbLanguageCount());
        Object.assign(CB.build, { cls: 'Rogue', level: 3, subclass: 'Mastermind' }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        ok('profs: a 2024 mastermind learns two more', cbLanguageCount() === 5, cbLanguageCount());
        cbClose();
      } catch(e){ ok('round 25 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
      }
    }

    // -- Round 26: Mystic Arcanum ----------------------------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const ed0 = state.settings && state.settings.builderEdition;
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        const wb = Object.assign(sktBlankBuild('2014'), { cls: 'Warlock', subclass: 'Fiend', level: 13 });
        ok('arcanum: a 13th-level warlock has 6th and 7th', sktArcanumLevels(wb, R14).join() === '6,7' && !sktArcanumLevels(Object.assign({}, wb, { level: 10 }), R14).length);
        ok('arcanum: and is asked for them', sktBuildTodo(wb, R14).filter(t => /Mystic Arcanum/.test(t.what)).length === 2);
        ok('arcanum: the 6th-level choices are warlock spells', sktArcanumOptions(wb, R14, 6).includes('Circle of Death') && !sktArcanumOptions(wb, R14, 6).includes('Heal'));
        // 2024 third-casters prepare spells by their own column.
        const R24 = await sktRulesLoad('2024');
        const ek = Object.assign(sktBlankBuild('2024'), { cls: 'Fighter', subclass: 'Eldritch Knight', level: 3, abilities: { method: 'manual', base: { str: 15, dex: 12, con: 14, int: 14, wis: 10, cha: 8 } } });
        ok('casting: a 2024 eldritch knight prepares 3 spells at 3rd level', (sktBuildSpellcasting(ek, R24, sktBuildAbilities(ek, R24)) || {}).prepared === 3);
        const at = Object.assign({}, ek, { cls: 'Rogue', subclass: 'Arcane Trickster', level: 10 });
        ok('casting: a 2024 arcane trickster prepares 7 at 10th', (sktBuildSpellcasting(at, R24, sktBuildAbilities(at, R24)) || {}).prepared === 7);
        ok('casting: and is asked for them', sktBuildTodo(ek, R24).some(t => t.step === 'spells'));
        // The builder.
        await openCharBuilder({ edition: '2014' }); await sleep(700);
        Object.assign(CB.build, { cls: 'Warlock', level: 11, subclass: 'Fiend' }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'spells'; cbRender(); await sleep(20);
        const pick = document.querySelector('#cb-root [data-cb-arcanum="6|Circle of Death"]');
        ok('arcanum: the Spells step offers them', !!pick);
        if (pick){ pick.click(); await sleep(30); }
        ok('arcanum: and keeps the pick', (CB.build.arcanum || {})[6] === 'Circle of Death');
        CB.build.arcanum = {}; CB.build.level = 13; cbQuickBuild();
        ok('arcanum: Quick Build fills them', !!(CB.build.arcanum || {})[6] && !!(CB.build.arcanum || {})[7]);
        cbClose();
        // The sheet: cast once with its own daily use.
        window._findCombatantForPartyMember = () => -1;
        const w = sktComputeCharacter(Object.assign({}, wb, { name: 'Arc', species: 'Human', arcanum: { 6: 'Circle of Death' } }), R14);
        w.id = 'pc_r26'; state.party.push(w); save();
        const me = () => state.party.find(p => p.id === 'pc_r26');
        openCharSheet('pc_r26', { tab: 'spells' }); await sleep(300);
        const btn = document.querySelector('#cs-root [data-cs-cast="Circle of Death:arcanum"]');
        ok('arcanum: the sheet offers it as Mystic Arcanum', !!btn && !btn.disabled);
        if (btn){ btn.click(); await sleep(60); }
        ok('arcanum: casting spends the 6th-level use, not a slot', (me().resources.find(r => r.name === 'Mystic Arcanum (6th)') || {}).current === 0);
        const again = document.querySelector('#cs-root [data-cs-cast="Circle of Death:arcanum"]');
        ok('arcanum: and it can\'t be cast again until a long rest', !!again && again.disabled);
        csClose();
      } catch(e){ ok('round 26 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        document.getElementById('cb-root')?.remove(); CB = null;
        if (typeof csClose === 'function') csClose();
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 27: limited uses read from the text -----------------------------------
    {
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const ab = { method: 'manual', base: { str: 14, dex: 14, con: 14, int: 14, wis: 16, cha: 14 } };
        const res = (R, ed, cls, sub, L, name) => (sktComputeCharacter(Object.assign(sktBlankBuild(ed), { cls, subclass: sub, level: L, abilities: JSON.parse(JSON.stringify(ab)) }), R).resources || []).find(r => r.name === name) || null;
        const ws = res(R14, '2014', 'Cleric', 'Tempest', 1, 'Wrath of the Storm');
        ok('uses: Wrath of the Storm, Wisdom modifier times a long rest', !!ws && ws.max === 3 && ws.recharge === 'long');
        const dl = res(R14, '2014', 'Warlock', 'Fiend', 6, "Dark One's Own Luck");
        ok('uses: Dark One\'s Own Luck, once per short rest', !!dl && dl.max === 1 && dl.recharge === 'short');
        const as = res(R14, '2014', 'Fighter', 'Arcane Archer', 3, 'Arcane Shot');
        ok('uses: Arcane Shot, two uses per short rest', !!as && as.max === 2 && as.recharge === 'short');
        const fs = res(R24, '2024', 'Fighter', 'Samurai', 3, 'Fighting Spirit');
        ok('uses: Fighting Spirit, three times a long rest', !!fs && fs.max === 3);
        const pe14 = res(R14, '2014', 'Rogue', 'Soulknife', 5, 'Psionic Energy'), pe24 = res(R24, '2024', 'Fighter', 'Psi Warrior', 10, 'Psionic Energy');
        ok('uses: psionic energy dice (2014: twice proficiency, d8 at 5th)', !!pe14 && pe14.max === 6 && pe14.die === 'd8');
        ok('uses: psionic energy dice (2024: the table, one back on a short rest)', !!pe24 && pe24.max === 8 && pe24.die === 'd8' && pe24.recharge === 'short-one');
        ok('uses: a Channel Divinity option spends Channel Divinity, not its own', !res(R14, '2014', 'Cleric', 'Tempest', 2, 'Channel Divinity: Destructive Wrath'));
        const sp = x => (sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { cls: 'Fighter', level: 5, allBooks: true }, x), R14).resources || []);
        ok('uses: species traits too (Rabbit Hop, proficiency bonus times)', (sp({ species: 'Harengon' }).find(r => r.name === 'Rabbit Hop') || {}).max === 3);
        ok('uses: and feats (Orcish Fury, once per short rest)', (sp({ species: 'Half-Orc', asi: { 4: { type: 'feat', feat: 'Orcish Fury' } } }).find(r => r.name === 'Orcish Fury') || {}).recharge === 'short');
        ok('uses: but not a once-a-day spell, which casts free from the sheet', !sp({ asi: { 4: { type: 'feat', feat: 'Fey Touched' } } }).some(r => r.name === 'Fey Touched'));
        ok('uses: a feature with no stated limit has no tracker', sktUsesFromText('You can use your action to frighten someone with your menacing presence.', { pb: 2, mod: {} }, 'Intimidating Presence') === null);
      } catch(e){ ok('round 27 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 28: a feat once, unless it repeats ------------------------------------
    {
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        await openCharBuilder({ edition: '2014' }); await sleep(700);
        Object.assign(CB.build, { cls: 'Fighter', level: 8, showAllFeats: true, asi: { 4: { type: 'feat', feat: 'Alert' }, 6: { type: 'feat', feat: '' } } }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'levels'; cbRender(); await sleep(20);
        const opts = [...(document.querySelector('#cb-root [data-cb-asifeat="6"]') || { options: [] }).options].map(o => o.value);
        ok('feats: a feat already taken isn\'t offered again', opts.length > 10 && !opts.includes('Alert'), opts.length);
        CB.build.asi[4] = { type: 'feat', feat: 'Elemental Adept' }; CB.rec = sktComputeCharacter(CB.build, CB.R); cbRender(); await sleep(20);
        const opts2 = [...(document.querySelector('#cb-root [data-cb-asifeat="6"]') || { options: [] }).options].map(o => o.value);
        ok('feats: a repeatable one is (Elemental Adept)', opts2.includes('Elemental Adept'));
        const own = [...(document.querySelector('#cb-root [data-cb-asifeat="4"]') || { options: [] }).options].map(o => o.value);
        ok('feats: and a slot still lists its own pick', own.includes('Elemental Adept'));
        cbClose();
      } catch(e){ ok('round 28 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
      }
    }

    // -- Round 29: kensei weapons; the origin feat once ------------------------------
    {
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014');
        const kc = L => sktProfChoices(Object.assign(sktBlankBuild('2014'), { cls: 'Monk', subclass: 'Kensei', level: L }), R14).find(c => c.kind === 'weapons');
        ok('kensei: two kensei weapons at 3rd level, five by 17th', !!kc(3) && kc(3).count === 2 && kc(6).count === 3 && kc(17).count === 5);
        ok('kensei: no heavy weapons, but the longbow', kc(3).options.includes('longbow') && !kc(3).options.includes('greatsword') && kc(3).options.includes('shortsword'));
        const kb = Object.assign(sktBlankBuild('2014'), { cls: 'Monk', subclass: 'Kensei', level: 3, profPicks: { 'Path of the Kensei': { weapons: ['longsword', 'longbow'] } } });
        ok('kensei: and is proficient with them', ['longsword', 'longbow'].every(w => sktComputeCharacter(kb, R14).sheet.proficiencies.weapons.includes(w)));
        const ea = Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', level: 4, asi: { 4: { type: 'feat', feat: 'Elemental Adept' } } });
        ok('feats: Elemental Adept asks for its damage type', sktBuildTodo(ea, R14).some(t => t.what === 'Elemental Adept choice'));
        ea.featureChoices = { 'Elemental Adept': 'Fire' };
        ok('feats: and notes it on the sheet', sktComputeCharacter(ea, R14).sheet.notes.some(n => /^Elemental Adept \(Fire\)/.test(n)));
        const pcd = (sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { cls: 'Paladin', subclass: 'Devotion', level: 3 }), R14).resources || []).find(r => r.name === 'Channel Divinity');
        ok('paladin: a 2014 oath gives Channel Divinity once per short rest', !!pcd && pcd.max === 1 && pcd.recharge === 'short');
        const acts = (cls, sub, L) => (sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { cls, subclass: sub, level: L }), R14).sheet.activations || []).filter(a => a.resource === 'Channel Divinity');
        const life = acts('Cleric', 'Life', 2).map(a => a.name);
        ok('channel divinity: a life cleric can Turn Undead or Preserve Life from the sheet', life.includes('Turn Undead') && life.includes('Preserve Life'), life.join());
        const dev = acts('Paladin', 'Devotion', 3);
        ok('channel divinity: a devotion paladin has Sacred Weapon and Turn the Unholy, as actions', dev.map(a => a.name).join() === 'Sacred Weapon,Turn the Unholy' && dev.every(a => a.action === 'Action'));
        ok('channel divinity: Guided Strike costs no action', (acts('Cleric', 'War', 2).find(a => a.name === 'Guided Strike') || {}).action === 'Free');
        // A variant human's feat doesn't repeat one taken later.
        await openCharBuilder({ edition: '2014' }); await sleep(700);
        Object.assign(CB.build, { cls: 'Fighter', level: 4, species: 'Human', subspecies: 'Variant', asi: { 4: { type: 'feat', feat: 'Alert' } } }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'species'; cbRender(); await sleep(20);
        const of = [...(document.querySelector('#cb-root [data-cb-originfeat]') || { options: [] }).options].map(o => o.value);
        ok('feats: the variant human\'s feat list leaves out one already taken', of.length > 10 && !of.includes('Alert') && of.includes('Lucky'), of.length);
        cbClose();
      } catch(e){ ok('round 29 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
      }
    }

    // -- Round 30: picks that say what they do; known skills locked -----------------
    {
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014');
        const hp = sktBuildChoices(Object.assign(sktBlankBuild('2014'), { cls: 'Ranger', subclass: 'Hunter', level: 3 }), R14).find(c => c.feature === "Hunter's Prey");
        ok('picks: an option says what it does, not only its flavour', /extra 1d8 damage/.test((hp.spec.options.find(o => o.value === 'Colossus Slayer') || {}).desc || ''), (hp.spec.options[0] || {}).desc);
        await openCharBuilder({ edition: '2014' }); await sleep(700);
        Object.assign(CB.build, { cls: 'Bard', level: 3, subclass: 'Lore', skills: ['arcana', 'history', 'insight'] }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'skills'; cbRender(); await sleep(20);
        const box = document.querySelector('#cb-root [data-cb-profpick="Bonus Proficiencies||skills||arcana"]');
        ok('picks: a skill already known can\'t be picked again', !!box && box.disabled);
        cbClose();
      } catch(e){ ok('round 30 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
      }
    }

    // -- Round 31: a 2014 ranger's favored enemies and terrains ----------------------
    {
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014');
        const rc = L => sktProfChoices(Object.assign(sktBlankBuild('2014'), { cls: 'Ranger', level: L }), R14);
        ok('ranger: one favored enemy and terrain at 1st, more at 6th, 10th and 14th', rc(1).map(c => c.kind + c.count).join() === 'enemies1,terrains1' && rc(10).map(c => c.kind + c.count).join() === 'enemies2,terrains3' && rc(14).map(c => c.kind + c.count).join() === 'enemies3,terrains3');
        ok('ranger: and asks for them', sktBuildTodo(Object.assign(sktBlankBuild('2014'), { cls: 'Ranger', level: 6 }), R14).some(t => t.what === '2 favored enemies from Favored Enemy'));
        const rb = Object.assign(sktBlankBuild('2014'), { cls: 'Ranger', level: 1, profPicks: { 'Favored Enemy': { enemies: ['Undead'] }, 'Natural Explorer': { terrains: ['Swamp'] } } });
        const notes = sktComputeCharacter(rb, R14).sheet.notes;
        ok('ranger: the sheet says which', notes.some(n => /^Favored Enemy \(Undead\)/.test(n)) && notes.some(n => /^Natural Explorer \(Swamp\)/.test(n)));
        await openCharBuilder({ edition: '2014' }); await sleep(700);
        Object.assign(CB.build, { cls: 'Ranger', level: 1 }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'skills'; cbRender(); await sleep(20);
        const box = document.querySelector('#cb-root [data-cb-profpick="Favored Enemy||enemies||Dragons"]');
        ok('ranger: the Skills step offers the enemy types', !!box);
        if (box){ box.click(); await sleep(30); }
        ok('ranger: and keeps the pick', (((CB.build.profPicks || {})['Favored Enemy'] || {}).enemies || []).includes('Dragons'));
        cbClose();
      } catch(e){ ok('round 31 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
      }
    }

    // -- Round 32: kensei weapons are monk weapons ------------------------------------
    {
      try {
        const R14 = await sktRulesLoad('2014');
        const mk = (sub, weapons, picks) => sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { cls: 'Monk', subclass: sub, level: 3, abilities: { method: 'manual', base: { str: 10, dex: 16, con: 12, int: 10, wis: 14, cha: 8 } },
          items: weapons.map(n => ({ name: n, base: n.toLowerCase(), qty: 1, equipped: true })), equipment: { materialized: true }, profPicks: picks || {} }), R14);
        const ls = mk('Kensei', ['Longsword'], { 'Path of the Kensei': { weapons: ['longsword'] } }).sheet.attacks.find(a => a.name === 'Longsword');
        ok('kensei: a kensei longsword uses Dexterity like a monk weapon', !!ls && /^1d8\+3/.test(ls.damage), ls && ls.damage);
        const plain = mk('Open Hand', ['Longsword']).sheet.attacks.find(a => a.name === 'Longsword');
        ok('kensei: another monk\'s longsword doesn\'t', !!plain && /^1d8 /.test(plain.damage), plain && plain.damage);
      } catch(e){ ok('round 32 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 33: the Actions filter -------------------------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R24 = await sktRulesLoad('2024');
        window._findCombatantForPartyMember = () => -1;
        const pc = sktComputeCharacter(Object.assign(sktBlankBuild('2024'), { name: 'Filt', cls: 'Cleric', subclass: 'Life', species: 'Human', level: 6 }), R24);
        pc.id = 'pc_r33'; state.party.push(pc); save();
        openCharSheet('pc_r33', { tab: 'actions' }); await sleep(300);
        const sec = k => document.querySelector('#cs-root .cs-asec[data-k="' + k + '"]');
        ok('actions: a 2024 Magic action is listed with the actions', !!sec('action') && /Turn Undead/.test(sec('action').textContent));
        document.querySelector('#cs-root [data-cs-actf="limited"]').click(); await sleep(40);
        const vis = k => { const e = sec(k); return !!e && getComputedStyle(e).display !== 'none'; };
        ok('actions: the filter shows only limited uses', vis('limited') && !vis('action') && !vis('attack'));
        document.querySelector('#cs-root [data-cs-actf="all"]').click(); await sleep(40);
        ok('actions: and All shows everything again', vis('limited') && vis('action') && vis('attack'));
        csClose();
      } catch(e){ ok('round 33 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        if (typeof CS !== 'undefined' && CS) CS.actF = 'all';
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 34: a bard's Magical Secrets -------------------------------------------
    {
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const bd = L => Object.assign(sktBlankBuild('2014'), { cls: 'Bard', level: L });
        const known = L => sktBuildSpellcasting(bd(L), R14, sktBuildAbilities(bd(L), R14)).known;
        ok('secrets: a 10th-level bard picks two Magical Secrets beside 12 bard spells (the table\'s 14)', known(10) === 12 && sktMagicalSecrets(bd(10), R14).count === 2 && !sktMagicalSecrets(bd(9), R14));
        ok('secrets: six by 18th level', sktMagicalSecrets(bd(18), R14).count === 6 && known(18) === 16);
        ok('secrets: from any class (Fireball)', sktMagicalSecrets(bd(10), R14).options.includes('Fireball'));
        ok('secrets: asked for', sktBuildTodo(bd(10), R14).some(t => t.what === '2 Magical Secrets spells'));
        ok('secrets: and on the sheet once chosen', sktComputeCharacter(Object.assign(bd(10), { secrets: ['Fireball', 'Counterspell'] }), R14).sheet.spells.includes('Fireball'));
        const o = (L, lv) => sktSpellOptions(R24, Object.assign(sktBlankBuild('2024'), { cls: 'Bard', level: L }), lv).map(s => s.name);
        ok('secrets: a 2024 bard prepares from the cleric, druid and wizard lists from 10th level', o(10, 3).includes('Fireball') && !o(9, 3).includes('Fireball'));
        await openCharBuilder({ edition: '2014' }); await sleep(700);
        Object.assign(CB.build, { cls: 'Bard', level: 10 }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        CB.step = 'spells'; cbRender(); await sleep(20);
        const box = document.querySelector('#cb-root [data-cb-secret="Fireball"]');
        ok('secrets: the Spells step offers them', !!box);
        if (box){ box.click(); await sleep(30); }
        ok('secrets: and keeps the pick', (CB.build.secrets || []).includes('Fireball'));
        CB.build.secrets = []; cbQuickBuild();
        ok('secrets: Quick Build takes another class\'s spells', (CB.build.secrets || []).length === 2 && CB.build.secrets.every(n => !sktSpellOnList(sktRulesSpell(CB.R, n), 'Bard', CB.build)));
        cbClose();
      } catch(e){ ok('round 34 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
      }
    }

    // -- Round 35: a wizard's Spell Mastery and Signature Spells; Quick Build's spread --
    {
      const ed0 = state.settings && state.settings.builderEdition;
      try {
        const R14 = await sktRulesLoad('2014');
        const wz = (L, book, picks) => Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', level: L, spellbook: book || [], spells: [], featureSpells: picks || {} });
        const book = ['Shield', 'Magic Missile', 'Misty Step', 'Invisibility', 'Fireball', 'Counterspell', 'Haste'];
        ok('wizard: Spell Mastery at 18th asks for a 1st- and a 2nd-level spell', sktFeatureSpellPicks(wz(18, book), R14).map(x => x.level + ':' + x.count).join() === '1:1,2:1' && !sktFeatureSpellPicks(wz(17, book), R14).length);
        ok('wizard: from the spellbook', sktFeatureSpellPicks(wz(18, book), R14)[0].options.join() === 'Shield,Magic Missile');
        ok('wizard: Signature Spells at 20th, asked for', sktBuildTodo(wz(20, book), R14).some(t => t.what === '2 3rd-level spells for Signature Spells'));
        const sig = sktComputeCharacter(wz(20, book, { 'Signature Spells': ['Fireball', 'Counterspell'], 'Spell Mastery': ['Shield', 'Misty Step'] }), R14).sheet;
        ok('wizard: signature spells are always prepared', ['Fireball', 'Counterspell'].every(n => sig.alwaysPrepared.includes(n)));
        ok('wizard: the mastery spells are named on the sheet', sig.notes.some(n => /^Spell Mastery \(Shield, Misty Step\)/.test(n)));
        await openCharBuilder({ edition: '2014' }); await sleep(700);
        Object.assign(CB.build, { cls: 'Wizard', level: 20 }); CB.rec = sktComputeCharacter(CB.build, CB.R);
        cbQuickBuild();
        ok('wizard: Quick Build fills both from a book with every level', (CB.build.featureSpells['Signature Spells'] || []).length === 2 && (CB.build.featureSpells['Spell Mastery'] || []).length === 2);
        ok('quick build: a 20th-level wizard\'s book has 9th-level spells', (CB.build.spellbook || []).some(n => (sktRulesSpell(CB.R, n) || {}).level === 9));
        cbClose();
      } catch(e){ ok('round 35 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        document.getElementById('cb-root')?.remove(); CB = null;
        if (state.settings){ if (ed0 === undefined) delete state.settings.builderEdition; else state.settings.builderEdition = ed0; }
      }
    }

    // -- Round 36: draconic sorcery's ancestor and affinity ---------------------------
    {
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const b14 = Object.assign(sktBlankBuild('2014'), { cls: 'Sorcerer', subclass: 'Draconic', level: 6 });
        ok('draconic: a 2014 draconic sorcerer chooses a dragon ancestor', (sktBuildChoices(b14, R14).find(c => c.feature === 'Dragon Ancestor') || { spec: { options: [] } }).spec.options.length === 10);
        b14.featureChoices = { 'Dragon Ancestor': 'Red' };
        const p14 = sktComputeCharacter(b14, R14).sheet;
        ok('draconic: Elemental Affinity follows it (fire)', p14.notes.some(n => /^Elemental Affinity: .* fire spell/.test(n)));
        ok('draconic: and speaks Draconic', /Draconic/.test(p14.languages));
        const p24 = sktComputeCharacter(Object.assign(sktBlankBuild('2024'), { cls: 'Sorcerer', subclass: 'Draconic', level: 6, featureChoices: { 'Elemental Affinity': 'Cold' } }), R24);
        ok('draconic: a 2024 sorcerer\'s Elemental Affinity gives resistance to its type', (p24.resistances || []).includes('cold'));
      } catch(e){ ok('round 36 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 37: the Moon bard's skill; the Noble Genies aura -----------------------
    {
      try {
        const R24 = await sktRulesLoad('2024');
        const mb = sktProfChoices(Object.assign(sktBlankBuild('2024'), { cls: 'Bard', subclass: 'Moon', level: 3 }), R24).find(c => c.feature === 'Primal Lore');
        ok('moon bard: Primal Lore asks for one of its six skills', !!mb && mb.count === 1 && mb.options.length === 6 && mb.options.includes('survival'));
        const g = Object.assign(sktBlankBuild('2024'), { cls: 'Paladin', subclass: 'Noble Genies', level: 7, featureChoices: { 'Aura of Elemental Shielding': 'Fire' } });
        ok('noble genies: the aura resists the damage type chosen', (sktComputeCharacter(g, R24).resistances || []).includes('fire'));
      } catch(e){ ok('round 37 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 38: the 2014 Dragonborn's ancestry table -------------------------------
    {
      try {
        const R14 = await sktRulesLoad('2014');
        const anc = sktRulesSpecies(R14, 'Dragonborn').ancestries;
        ok('dragonborn: the 2014 ancestry table\'s ten dragons', anc.length === 10 && anc.find(a => a.name === 'Silver').damage === 'cold');
      } catch(e){ ok('round 38 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 39: magic item charges; an artificer's attunement for bonuses ---------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember, rnd: Math.random };
      try {
        const R14 = await sktRulesLoad('2014'), M14 = await sktMagicLoad('2014');
        const wand = sktMagicMake(R14, M14.find(x => x.name === 'Wand of Magic Missiles'));
        ok('charges: a wand keeps its charges and how it regains them', wand.charges === 7 && wand.recharge === 'dawn' && /1d6 \+ 1/.test(wand.rechargeAmount));
        window._findCombatantForPartyMember = () => -1;
        const pc = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Wandy', cls: 'Wizard', species: 'Human', level: 3, items: [wand], equipment: { materialized: true } }), R14);
        const wr = pc.resources.find(r => r.name === 'Wand of Magic Missiles');
        ok('charges: a carried wand counts its 7 charges', !!wr && wr.max === 7 && wr.recharge === 'dawn');
        pc.id = 'pc_r39'; wr.current = 0; state.party.push(pc); save();
        Math.random = () => 0;
        panelDefs.party._longRestOne(state.party.find(p => p.id === 'pc_r39'), state.party.length - 1);
        ok('charges: a long rest gives back 1d6 + 1, not all seven', state.party.find(p => p.id === 'pc_r39').resources.find(r => r.name === 'Wand of Magic Missiles').current === 2);
        Math.random = st.rnd;
        const rings = [1, 2, 3, 4, 5].map(n => ({ name: 'Ring ' + n, reqAttune: true, attuned: true, bonusAc: 1 }));
        const ac = (cls, L) => sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { cls, level: L, items: rings, equipment: { materialized: true } }), R14).ac;
        ok('attunement: a 10th-level artificer\'s fourth attuned item counts', ac('Artificer', 10) === ac('Artificer', 9) + 1 && ac('Artificer', 14) === ac('Artificer', 9) + 2);
      } catch(e){ ok('round 39 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        Math.random = st.rnd; window._findCombatantForPartyMember = st.find;
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 40: a wizard's spellbook rituals -----------------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const pc = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Rit', cls: 'Wizard', species: 'Human', level: 3,
          spellbook: ['Detect Magic', 'Find Familiar', 'Magic Missile', 'Shield'], spells: ['Magic Missile', 'Shield'] }), R14);
        pc.id = 'pc_r40'; state.party.push(pc); save();
        openCharSheet('pc_r40', { tab: 'spells' }); await sleep(300);
        const rit = document.querySelector('#cs-root [data-cs-cast="Detect Magic:ritual"]');
        ok('rituals: an unprepared ritual in the spellbook can be cast as a ritual', !!rit && !document.querySelector('#cs-root [data-cs-cast="Detect Magic:1"]'));
        ok('rituals: a spell that isn\'t a ritual stays off the list until prepared', !/Find Familiar/.test(document.querySelector('#cs-root').textContent) || !!document.querySelector('#cs-root [data-cs-cast="Find Familiar:ritual"]'));
        csClose();
      } catch(e){ ok('round 40 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 41: companions in Extras ---------------------------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const pc = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Smith', cls: 'Artificer', subclass: 'Battle Smith', species: 'Human', level: 3,
          abilities: { method: 'manual', base: { str: 10, dex: 12, con: 14, int: 16, wis: 10, cha: 8 } } }), R14);
        pc.id = 'pc_r41'; state.party.push(pc); save();
        const me = () => state.party.find(p => p.id === 'pc_r41');
        openCharSheet('pc_r41', { tab: 'extras' }); await sleep(300);
        const btn = document.querySelector('#cs-root [data-cs-comp="Steel Defender"]');
        ok('companions: a battle smith is offered the Steel Defender', !!btn);
        if (btn){ btn.click(); await sleep(60); }
        const sd = (me().extras || []).find(x => x.name === 'Steel Defender');
        ok('companions: its AC and HP worked out for the character (15, 2 + 3 + 15)', !!sd && sd.ac === 15 && sd.hpMax === 20, JSON.stringify(sd));
        ok('companions: and isn\'t offered twice', !document.querySelector('#cs-root [data-cs-comp="Steel Defender"]'));
        csClose();
        const rg = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Drk', cls: 'Ranger', subclass: 'Drakewarden', species: 'Human', level: 5 }), R14);
        const m = csCompanionMonster(rg, 'Drake Companion');
        CS = { R: R14 }; const dst = csCompanionStats(rg, m); CS = null;
        ok('companions: a drake\'s AC is 14 + PB and HP 5 + five times the ranger level', !!m && dst.ac === 17 && dst.hp === 30, JSON.stringify(dst));
      } catch(e){ ok('round 41 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') try { csClose(); } catch(_){ }
        CS = null;
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 42: a familiar or a steed from its spell -------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const pc = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Fam', cls: 'Wizard', species: 'Human', level: 1, spellbook: ['Find Familiar', 'Magic Missile'], spells: ['Magic Missile'] }), R14);
        pc.id = 'pc_r42'; state.party.push(pc); save();
        const me = () => state.party.find(p => p.id === 'pc_r42');
        openCharSheet('pc_r42', { tab: 'extras' }); await sleep(300);
        const sel = document.querySelector('#cs-root [data-cs-sumsel="Familiar"]');
        ok('familiar: Find Familiar offers the familiar forms', !!sel && [...sel.options].some(o => o.value === 'Owl'));
        if (sel){ sel.value = 'Owl'; document.querySelector('#cs-root [data-cs="addsummon"][data-cs-sumfor="Familiar"]').click(); await sleep(60); }
        const owl = (me().extras || []).find(x => x.name === 'Owl');
        ok('familiar: and adds the chosen one with its stats', !!owl && owl.hpMax >= 1 && owl.ac >= 10, JSON.stringify(owl));
        ok('familiar: a character without the spell isn\'t offered one', (() => { csClose(); const p2 = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'NoFam', cls: 'Fighter', species: 'Human', level: 1 }), R14); p2.id = 'pc_r42b'; state.party.push(p2); save(); openCharSheet('pc_r42b', { tab: 'extras' }); return !document.querySelector('#cs-root [data-cs-sumsel="Familiar"]'); })());
        csClose();
      } catch(e){ ok('round 42 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') try { csClose(); } catch(_){ }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 43: an older wand takes up its charges ---------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const st = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014');
        window._findCombatantForPartyMember = () => -1;
        const pc = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Old', cls: 'Wizard', species: 'Human', level: 3,
          items: [{ name: 'Wand of Magic Missiles', qty: 1, rarity: 'uncommon' }], equipment: { materialized: true } }), R14);
        pc.id = 'pc_r43'; state.party.push(pc); save();
        const me = () => state.party.find(p => p.id === 'pc_r43');
        openCharSheet('pc_r43', { tab: 'inventory' }); await sleep(300);
        for (let k = 0; k < 40 && !(CS && CS.magic); k++) await sleep(100);
        csRender(); await sleep(60);
        const b = document.querySelector('#cs-root [data-cs-trackchg="0"]');
        ok('charges: an older wand offers to track its charges', !!b);
        if (b){ b.click(); await sleep(200); }
        ok('charges: and then counts them', (me().resources || []).some(r => r.name === 'Wand of Magic Missiles' && r.max === 7));
        csClose();
      } catch(e){ ok('round 43 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window._findCombatantForPartyMember = st.find;
        if (typeof csClose === 'function') try { csClose(); } catch(_){ }
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 44: the Simic Hybrid's animal enhancements -----------------------------
    {
      try {
        const R14 = await sktRulesLoad('2014');
        const sb = (L, picks) => Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', level: L, species: 'Simic Hybrid', allBooks: true, profPicks: picks ? { 'Animal Enhancement': { enhancements: picks } } : {} });
        const c1 = sktProfChoices(sb(1), R14).find(c => c.kind === 'enhancements'), c5 = sktProfChoices(sb(5), R14).find(c => c.kind === 'enhancements');
        ok('simic: one enhancement from the first list at 1st level, two by 5th', !!c1 && c1.count === 1 && c1.options.length === 3 && !c1.options.includes('Carapace') && c5.count === 2 && c5.options.includes('Carapace'));
        ok('simic: asked for', sktBuildTodo(sb(1), R14).some(t => t.what === '1 animal enhancement from Animal Enhancement'));
        const withC = sktComputeCharacter(sb(5, ['Nimble Climber', 'Carapace']), R14), without = sktComputeCharacter(sb(5, ['Nimble Climber', 'Acid Spit']), R14);
        ok('simic: Carapace adds 1 to AC', withC.ac === without.ac + 1 && /Carapace 1/.test(withC.sheet.acDetail));
        ok('simic: Acid Spit is counted', (without.resources || []).some(r => r.name === 'Acid Spit'));
      } catch(e){ ok('round 44 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 45: lasting benefits read from the text ----------------------------------
    {
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const pc = (R, ed, cls, sub, L) => sktComputeCharacter(Object.assign(sktBlankBuild(ed), { cls, subclass: sub, level: L }), R);
        ok('passive: a forge cleric resists fire from 6th level', pc(R14, '2014', 'Cleric', 'Forge', 6).resistances.includes('fire') && !pc(R14, '2014', 'Cleric', 'Forge', 5).resistances.includes('fire'));
        ok('passive: a twilight cleric sees 300 ft in the dark', /Darkvision 300/.test(pc(R24, '2024', 'Cleric', 'Twilight', 3).sheet.senses));
        ok('passive: a scout moves 10 ft faster from 9th level', pc(R14, '2014', 'Rogue', 'Scout', 9).spd === pc(R14, '2014', 'Rogue', 'Scout', 8).spd + 10);
        ok('passive: Bladesong\'s speed is only while it\'s active', pc(R14, '2014', 'Wizard', 'Bladesinging', 2).spd === 30 && pc(R24, '2024', 'Wizard', 'Bladesinger', 3).spd === 30);
        ok('passive: Dread Ambusher\'s speed is only the first turn', pc(R14, '2014', 'Ranger', 'Gloom Stalker', 3).spd === 30);
        ok('passive: a celestial warlock resists radiant damage', pc(R14, '2014', 'Warlock', 'Celestial', 6).resistances.includes('radiant'));
      } catch(e){ ok('round 45 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 46: picks over the limit after the limit drops ----------------
    {
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const ab = { method: 'manual', base: { str: 10, dex: 10, con: 10, int: 16, wis: 16, cha: 16 } };
        const mk = (R, ed, cls, L) => {
          const b = Object.assign(sktBlankBuild(ed), { cls, level: L, abilities: JSON.parse(JSON.stringify(ab)) });
          const sc = sktBuildSpellcasting(b, R, sktBuildAbilities(b, R));
          b.cantrips = sktSpellOptions(R, b, 0).map(s => s.name).slice(0, sc.cantrips);
          b.spells = [4, 3, 2, 1].flatMap(l => sktSpellOptions(R, b, l).map(s => s.name).slice(0, 3)).slice(0, sc.prepared || sc.known);
          return b;
        };
        const rm = (b, R) => sktBuildTodo(b, R).filter(t => /^(\w+: )?remove /.test(t.what) && !t.soft).map(t => t.what);
        const full = mk(R24, '2024', 'Cleric', 7);
        ok('limit: a full list at the limit asks nothing removed', rm(full, R24).length === 0, JSON.stringify(rm(full, R24)));
        full.level = 1;
        const w = rm(full, R24);
        ok('limit: lowering the level flags the extra cantrip', w.includes('remove 1 cantrip (3 allowed)'), JSON.stringify(w));
        ok('limit: and the extra prepared spells', w.includes('remove 7 spells (4 allowed)'), JSON.stringify(w));
        ok('limit: and the spells too high to cast now', w.some(x => /^remove 9 spells above level 1 \(/.test(x)), JSON.stringify(w));
        const cl = mk(R14, '2014', 'Cleric', 3);
        cl.abilities.base.wis = 10;
        ok('limit: a 2014 cleric whose Wisdom drops prepares fewer', rm(cl, R14).includes('remove 3 spells (3 allowed)'), JSON.stringify(rm(cl, R14)));
        const wz = mk(R24, '2024', 'Wizard', 7); wz.spellbook = wz.spells.slice(); wz.level = 1;
        ok('limit: a wizard’s spellbook too', rm(wz, R24).includes('remove 5 spells from the spellbook (6 allowed)'), JSON.stringify(rm(wz, R24)));
        ok('limit: the counter turns red and says how many to remove', /cb-counter over/.test(cbCounter(6, 4, 'chosen')) && /remove 2/.test(cbCounter(6, 4, 'chosen')) && !/over/.test(cbCounter(4, 4, 'chosen')));
        const rows = cbSpellRows(R24, 1, ['Bless', 'Banishment'], () => ['Bless', 'Cure Wounds'], o => o.join('+'));
        ok('limit: a spell now too high is listed to untick, alone on its row', /Level 4 · too high<\/span>Banishment</.test(rows) && /Level 1<\/span>Bless\+Cure Wounds/.test(rows) && !/Level [23]/.test(rows), rows);
      } catch(e){ ok('round 46 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 47: on/off states change the numbers -------------------------
    {
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const ab = { method: 'manual', base: { str: 16, dex: 14, con: 14, int: 16, wis: 14, cha: 16 } };
        const mk = (R, ed, cls, sub, L, extra, prior) => sktComputeCharacter(Object.assign(sktBlankBuild(ed), { cls, subclass: sub, level: L, abilities: JSON.parse(JSON.stringify(ab)) }, extra || {}), R, prior);
        const atk = (r, n) => (r.sheet.attacks.find(a => a.name === n) || {}).damage;
        const st = (r, k) => (r.sheet.states || []).find(s => s.key === k);
        const bear = { featureChoices: { 'Totem Spirit': 'Bear' } };
        const calm = mk(R14, '2014', 'Barbarian', 'Totem Warrior', 5, bear), mad = mk(R14, '2014', 'Barbarian', 'Totem Warrior', 5, bear, { rage: true });
        ok('states: a barbarian can rage, and it starts off', !!st(calm, 'Rage') && !st(calm, 'Rage').on && st(mad, 'Rage').on);
        ok('states: Rage adds its damage to Strength melee attacks', atk(calm, 'Greataxe') === '1d12+3 slashing' && atk(mad, 'Greataxe') === '1d12+5 slashing' && atk(mad, 'Unarmed Strike') === '6 bludgeoning', atk(mad, 'Greataxe'));
        ok('states: and to the off-hand attack, which drops only the ability modifier', atk(calm, 'Handaxe (off-hand)') === '1d6 slashing' && atk(mad, 'Handaxe (off-hand)') === '1d6+2 slashing', atk(mad, 'Handaxe (off-hand)'));
        ok('states: a 2014 Bear totem resists all but psychic while raging', calm.resistances.length === 0 && mad.resistances.length === 12 && !mad.resistances.includes('psychic'));
        const wh = o => mk(R24, '2024', 'Barbarian', 'Wild Heart', 5, {}, { rage: true, active: { 'Rage:opt': o } });
        ok('states: a 2024 Wild Heart chooses its animal each rage; Bear resists all but four', JSON.stringify(st(wh('Bear'), 'Rage').options) === '["Bear","Eagle","Wolf"]' && wh('Bear').resistances.length === 9 && !wh('Bear').resistances.includes('force') && wh('Wolf').resistances.length === 3);
        ok('states: a Zealot’s Divine Fury while raging', JSON.stringify(mk(R24, '2024', 'Barbarian', 'Zealot', 5, {}, { rage: true }).sheet.extraDamage) === JSON.stringify([{ label: 'Divine Fury', dice: '1d6+2 radiant', note: 'the first creature you hit each turn while raging' }]));
        ok('states: Rage gives advantage on Strength checks and saves', JSON.stringify(mad.sheet.rollAdv) === JSON.stringify([{ on: ['ab:str', 'save:str'], label: 'Rage' }]) && calm.sheet.rollAdv.length === 0);
        const bw = { spells: ['Shield', 'Mage Armor', 'Haste'] };
        const b0 = mk(R24, '2024', 'Wizard', 'Bladesinger', 6, bw), b1 = mk(R24, '2024', 'Wizard', 'Bladesinger', 6, bw, { active: { Bladesong: true } });
        ok('states: Bladesong adds Intelligence to AC and 10 ft of speed', b1.ac === b0.ac + 3 && b1.spd === b0.spd + 10 && b1.sheet.concBonus === 3 && /Bladesong 3/.test(b1.sheet.acDetail));
        const b2 = mk(R24, '2024', 'Wizard', 'Bladesinger', 6, bw, { active: { Bladesong: true, Shield: true, 'Mage Armor': true }, concentration: 'Haste' });
        ok('states: Mage Armor, Shield and Haste stack with it', b2.ac === 25 && b2.spd === 80 && b2.sheet.acDetail === 'Mage Armor 15 + Bladesong 3 + Shield 5 + Haste 2 = 25', b2.sheet.acDetail);
        ok('states: a concentration spell is on while it is the one concentrated on', st(b2, 'Haste').conc && st(b2, 'Haste').on && !st(b0, 'Haste').on && !st(b2, 'Shield').conc);
        ok('states: only spells the character has are offered', !st(b0, 'Bless') && !st(b0, 'Barkskin'));
        const bk = (R, ed, prior) => mk(R, ed, 'Druid', '', 3, { spells: ['Barkskin'] }, prior);
        ok('states: Barkskin keeps AC at 16 (2014, concentration) or 17 (2024)', bk(R14, '2014', { concentration: 'Barkskin' }).ac === 16 && st(bk(R14, '2014'), 'Barkskin').conc
           && bk(R24, '2024', { active: { Barkskin: true } }).ac === 17 && !st(bk(R24, '2024'), 'Barkskin').conc);
        ok('states: Innate Sorcery raises the spell save DC by 1', mk(R24, '2024', 'Sorcerer', 'Draconic', 3, {}, { active: { 'Innate Sorcery': true } }).sheet.spellSaveDc === mk(R24, '2024', 'Sorcerer', 'Draconic', 3).sheet.spellSaveDc + 1);
        const dv = mk(R14, '2014', 'Paladin', 'Devotion', 3, {}, { active: { 'Sacred Weapon': true } });
        ok('states: Sacred Weapon adds Charisma to weapon attacks only', dv.sheet.attacks.find(a => a.name === 'Longsword').atkBonus === '+8' && dv.sheet.attacks.find(a => a.name === 'Unarmed Strike').atkBonus === '+5');
        const hx = mk(R14, '2014', 'Warlock', 'Hexblade', 3, { cantrips: ['Eldritch Blast'] }, { active: { "Hexblade's Curse": true } });
        ok('states: Hexblade’s Curse adds the proficiency bonus to damage and crits on 19', atk(hx, 'Eldritch Blast') === '1d10+2 force' && hx.sheet.critRange === 19);
        const weak = { method: 'manual', base: { str: 10, dex: 14, con: 14, int: 16, wis: 14, cha: 16 } };
        const sh = (L, on) => mk(R24, '2024', 'Wizard', '', L, { cantrips: ['Shillelagh', 'True Strike'], abilities: weak }, on ? { active: { Shillelagh: true } } : {});
        ok('states: Shillelagh makes the quarterstaff hit with the casting ability and a bigger die', atk(sh(1), 'Quarterstaff') === '1d6 bludgeoning' && atk(sh(1, true), 'Quarterstaff') === '1d8+3 bludgeoning' && atk(sh(5, true), 'Quarterstaff') === '1d10+3 bludgeoning', atk(sh(1), 'Quarterstaff') + ' / ' + atk(sh(5, true), 'Quarterstaff'));
        const fx = { pb: 3, mod: { str: 3, dex: 3, con: 0, int: 0, wis: 0, cha: 0 }, weaponProf: new Set(['martial', 'simple']), weaponPropRules: [], build: { masteries: [] }, edition: '2014', R: R14,
                     rangedAttackBonus: 0, duelingBonus: 0, weaponHit: 0, rageOn: 2, damageBonusAll: 0, level: 5 };
        const bow = sktBuildAttacks(fx, { weapons: [R14.items.longbow, R14.items.longsword] }, null);
        ok('states: Rage stays off a ranged attack, even with Strength equal to Dexterity', bow[0].damage === '1d8+3 piercing' && bow[1].damage === '1d8+5 slashing', bow.map(a => a.damage).join(' / '));
        ok('states: and neither it nor True Strike is an attack row of its own', !sh(5).sheet.attacks.some(a => /Shillelagh|True Strike/.test(a.name)));
        ok('states: what is on, as one signature', sktStateSig({}) === '' && sktStateSig({ rage: true, concentration: 'Bless', active: { Shield: true, Off: false } }) === 'R|C:Bless|A:Shield=true');

        // On the sheet.
        const p0 = localStorage.getItem('skt-party-v1');
        const keep = { d: window.sktD, find: window._findCombatantForPartyMember };
        try {
          window._findCombatantForPartyMember = () => -1;
          const rb = Object.assign(sktBlankBuild('2024'), { name: 'Ragey', cls: 'Barbarian', subclass: 'Wild Heart', level: 5, abilities: JSON.parse(JSON.stringify(ab)) });
          const rr = sktComputeCharacter(rb, R24); rr.id = 'pc_state_barb'; state.party.push(rr);
          const bb = Object.assign(sktBlankBuild('2014'), { name: 'Bladey', cls: 'Wizard', subclass: 'Bladesinging', level: 2, abilities: JSON.parse(JSON.stringify(ab)) });
          const br = sktComputeCharacter(bb, R14); br.id = 'pc_state_blade'; state.party.push(br);
          const wb = Object.assign(sktBlankBuild('2014'), { name: 'Blessy', cls: 'Cleric', subclass: 'Life', level: 5, abilities: JSON.parse(JSON.stringify(ab)), spells: ['Bless', 'Shield of Faith', 'Cure Wounds', 'Divine Favor'] });
          const wr = sktComputeCharacter(wb, R14); wr.id = 'pc_state_cler'; state.party.push(wr);
          const mb = Object.assign(sktBlankBuild('2014'), { name: 'Shieldy', cls: 'Wizard', level: 3, abilities: JSON.parse(JSON.stringify(ab)), spells: ['Shield', 'Mage Armor'], spellbook: ['Shield', 'Mage Armor'] });
          const mr = sktComputeCharacter(mb, R14); mr.id = 'pc_state_wiz'; state.party.push(mr);
          save();
          const me = id => state.party.find(p => p.id === id);
          const root = () => document.getElementById('cs-root');
          const q = s => root().querySelector(s);
          const click = s => { const e = q(s); if (!e) throw new Error('missing ' + s); e.click(); };
          openCharSheet('pc_state_barb'); await sleep(300);
          const rages = () => me('pc_state_barb').resources.find(r => r.name === 'Rage').current;
          const r0 = rages(), g0 = me('pc_state_barb').sheet.attacks.find(a => a.name === 'Greataxe').damage;
          ok('sheet states: the switch is there, off', !!q('[data-cs-state="Rage"]') && q('[data-cs-state="Rage"]').getAttribute('aria-pressed') === 'false');
          click('[data-cs-state="Rage"]'); await sleep(60);
          const g1 = me('pc_state_barb').sheet.attacks.find(a => a.name === 'Greataxe').damage;
          ok('sheet states: turning Rage on spends a use and the numbers follow', me('pc_state_barb').rage === true && rages() === r0 - 1 && g0 === '1d12+3 slashing' && g1 === '1d12+5 slashing'
             && me('pc_state_barb').resistances.includes('slashing') && q('[data-cs-state="Rage"]').classList.contains('on'), g0 + ' → ' + g1);
          ok('sheet states: what it does is spelled out', /Rage \(Bear\):.*resistance to all damage except force, necrotic, psychic and radiant/.test(q('.cs-stdesc').textContent));
          window.sktD = n => n === 20 ? 9 : 1;
          click('[data-cs-roll="save:str"]'); await sleep(30);
          ok('sheet states: a Strength save while raging rolls with advantage', CS.log[0].mode === 'adv' && /Rage/.test(CS.log[0].why), CS.log[0].why);
          click('[data-cs-roll="ab:str"]'); await sleep(30);
          const strAdv = CS.log[0].mode;
          click('[data-cs-roll="ab:dex"]'); await sleep(30);
          ok('sheet states: and a Strength check, not a Dexterity one', strAdv === 'adv' && CS.log[0].mode === 'normal');
          click('[data-cs-roll="skill:athletics"]'); await sleep(30);
          const athAdv = CS.log[0].mode;
          click('[data-cs-roll="skill:acrobatics"]'); await sleep(30);
          ok('sheet states: Athletics is a Strength check too; Acrobatics isn’t', athAdv === 'adv' && CS.log[0].mode === 'normal');
          const opt = q('[data-cs-stateopt="Rage"]');
          opt.value = 'Bear'; opt.dispatchEvent(new Event('change', { bubbles: true })); await sleep(60);
          ok('sheet states: a Wild Heart picks Bear for this rage, and resists nearly everything', me('pc_state_barb').resistances.length === 9 && me('pc_state_barb').active['Rage:opt'] === 'Bear');
          // The tracker ending it (its minute up): the numbers come back by themselves.
          me('pc_state_barb').rage = false; save(); await sleep(30);
          ok('sheet states: Rage ended elsewhere puts the numbers back', me('pc_state_barb').sheet.attacks.find(a => a.name === 'Greataxe').damage === '1d12+3 slashing' && !me('pc_state_barb').resistances.includes('slashing'));
          csClose();

          openCharSheet('pc_state_cler'); await sleep(300);
          const ac0 = me('pc_state_cler').ac;
          click('[data-cs-state="Shield of Faith"]'); await sleep(60);
          ok('sheet states: a concentration spell switched on is concentrated on, +2 AC', me('pc_state_cler').concentration === 'Shield of Faith' && me('pc_state_cler').ac === ac0 + 2);
          click('[data-cs-state="Shield of Faith"]'); await sleep(60);
          ok('sheet states: switched off, concentration ends with it', !me('pc_state_cler').concentration && me('pc_state_cler').ac === ac0);
          click('[data-cs-state="Shield of Faith"]'); await sleep(60);
          click('[data-cs-state="Bless"]'); await sleep(60);
          ok('sheet states: another one ends the first', me('pc_state_cler').concentration === 'Bless' && me('pc_state_cler').ac === ac0);
          window.sktD = n => n === 4 ? 3 : 10;
          click('[data-cs-roll="save:wis"]'); await sleep(30);
          const sv = me('pc_state_cler').sheet.saves.wis;
          ok('sheet states: Bless adds its d4 to a save', CS.log[0].total === 10 + sv + 3 && /Bless d4: 3/.test(CS.log[0].why), CS.log[0].total + ' ' + CS.log[0].why);
          click('[data-cs-roll="ab:wis"]'); await sleep(30);
          ok('sheet states: but not to an ability check', CS.log[0].total === 10 + Math.floor((me('pc_state_cler').abilities.wis - 10) / 2));
          click('[data-cs="dropconc"]'); await sleep(60);
          ok('sheet states: dropping concentration ends it', !me('pc_state_cler').concentration && !me('pc_state_cler').sheet.states.find(s => s.key === 'Bless').on && me('pc_state_cler').sheet.rollDice.length === 0);
          click('[data-cs-state="Divine Favor"]'); await sleep(60);
          click('[data-cs-tab="actions"]'); await sleep(40);
          ok('sheet states: Divine Favor puts its 1d4 on the extra damage buttons', !!q('[data-cs-xdmg="Divine Favor|1d4 radiant"]'));
          csClose();

          openCharSheet('pc_state_blade'); await sleep(300);
          const bl0 = me('pc_state_blade').ac, uses0 = me('pc_state_blade').resources.find(r => r.name === 'Bladesong').current;
          click('[data-cs-state="Bladesong"]'); await sleep(60);
          ok('sheet states: Bladesong spends a use and raises AC', me('pc_state_blade').ac === bl0 + 3 && me('pc_state_blade').resources.find(r => r.name === 'Bladesong').current === uses0 - 1);
          me('pc_state_blade').concentration = 'Haste'; CS.conc = { dc: 10, spell: 'Haste' }; csRender();
          window.sktD = () => 10;
          click('[data-cs="concsave"]'); await sleep(30);
          ok('sheet states: and adds Intelligence to a concentration save', CS.log[0].total === 10 + me('pc_state_blade').sheet.saves.con + 3, CS.log[0].total + ' vs con ' + me('pc_state_blade').sheet.saves.con);
          me('pc_state_blade').resources.find(r => r.name === 'Bladesong').current = 0; me('pc_state_blade').active = null; save(); csRender();
          click('[data-cs-state="Bladesong"]'); await sleep(60);
          ok('sheet states: with no uses left it stays off', !me('pc_state_blade').active && me('pc_state_blade').ac === bl0);
          csClose();

          openCharSheet('pc_state_wiz', { tab: 'spells' }); await sleep(300);
          const w0 = me('pc_state_wiz').ac;
          click('[data-cs-cast="Shield:1"]'); await sleep(60);
          ok('sheet states: casting Shield turns it on: +5 AC', me('pc_state_wiz').active && me('pc_state_wiz').active.Shield === true && me('pc_state_wiz').ac === w0 + 5);
          click('[data-cs-state="Mage Armor"]'); await sleep(60);
          ok('sheet states: Mage Armor too', me('pc_state_wiz').ac === w0 + 5 + 3);
          click('[data-cs-state="Shield"]'); await sleep(60);
          ok('sheet states: and off again', me('pc_state_wiz').ac === w0 + 3 && !me('pc_state_wiz').active.Shield);
          const wi = state.party.findIndex(p => p.id === 'pc_state_wiz');
          panelDefs.party._shortRestOne(state.party[wi], wi); save();
          ok('sheet states: a short rest keeps Mage Armor (eight hours)', me('pc_state_wiz').ac === w0 + 3);
          panelDefs.party._longRestOne(state.party[wi], wi); save();
          ok('sheet states: a long rest ends it', me('pc_state_wiz').ac === w0 && !me('pc_state_wiz').active);
          csClose();
        } finally {
          window.sktD = keep.d; window._findCombatantForPartyMember = keep.find;
          if (typeof csClose === 'function') csClose();
          _remoteUpdate = true;
          try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
          loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
        }
      } catch(e){ ok('round 47 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 48: advantage on saves, as D&D Beyond lists it ----------------
    {
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const mk = (R, ed, x) => sktComputeCharacter(Object.assign(sktBlankBuild(ed), { cls: 'Fighter', level: 4 }, x), R);
        const d14 = mk(R14, '2014', { species: 'Dwarf', subspecies: 'Hill' }), d24 = mk(R24, '2024', { species: 'Dwarf' });
        ok('saves: a dwarf’s poison advantage is listed beside the saves, not rolled in', JSON.stringify(d14.sheet.saveMods) === JSON.stringify([{ abs: ['all'], text: 'Advantage on saving throws against poison', src: 'Dwarven Resilience' }])
           && d24.sheet.saveMods[0].text === 'Advantage on saving throws to avoid or end the Poisoned condition' && d14.sheet.rollAdv.length === 0);
        const g14 = mk(R14, '2014', { species: 'Gnome', subspecies: 'Rock' }), g24 = mk(R24, '2024', { species: 'Gnome', subspecies: 'Rock' });
        ok('saves: a 2014 gnome’s is against magic; a 2024 gnome’s is every mental save, rolled in', g14.sheet.saveMods[0].text === 'Advantage on Intelligence, Wisdom and Charisma saves against magic' && JSON.stringify(g14.sheet.saveMods[0].abs) === '["int","wis","cha"]'
           && JSON.stringify(g24.sheet.rollAdv) === JSON.stringify([{ on: ['save:int', 'save:wis', 'save:cha'], label: 'Gnomish Cunning' }]) && g24.sheet.saveMods.length === 0);
        ok('saves: War Caster rolls concentration saves with advantage', JSON.stringify(mk(R14, '2014', { asi: { 4: { type: 'feat', feat: 'War Caster' } } }).sheet.rollAdv) === JSON.stringify([{ on: ['conc'], label: 'War Caster' }]));
        ok('saves: Durable’s is on death saves, rolled in', mk(R24, '2024', { asi: { 4: { type: 'feat', feat: 'Durable' } } }).sheet.rollAdv.some(x => x.on[0] === 'death' && x.label === 'Durable'));
        const b14 = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { cls: 'Barbarian', level: 2 }), R14), b24 = sktComputeCharacter(Object.assign(sktBlankBuild('2024'), { cls: 'Barbarian', level: 7 }), R24);
        ok('saves: Danger Sense — 2014 against what you can see (listed), 2024 always (rolled in)', b14.sheet.saveMods.some(m => m.src === 'Danger Sense' && m.abs[0] === 'dex') && b24.sheet.rollAdv.some(a => a.label === 'Danger Sense' && a.on[0] === 'save:dex'));
        ok('saves: Feral Instinct gives advantage on initiative', b24.sheet.rollAdv.some(a => a.label === 'Feral Instinct' && a.on[0] === 'init'));
        ok('saves: temporary advantage is left out', sktSaveAdvantages('As a bonus action, you gain the following benefits for 1 minute: You have advantage on Strength saving throws.').length === 0
           && sktSaveAdvantages('Until you emerge, you have advantage on Strength and Constitution saving throws.').length === 0
           && sktSaveAdvantages('The target has disadvantage on saving throws against your spells.').length === 0
           && sktSaveAdvantages('You have advantage on one attack roll, ability check, or saving throw.').length === 0
           && sktSaveAdvantages('Allies have advantage on saving throws while within 30 feet of you.').length === 0);
        ok('saves: a benefit that lasts a minute, and someone else’s disadvantage, are left out too',
           sktSaveAdvantages('As a bonus action, you gain the following benefits, which last for 1 minute. You have advantage on Strength saving throws.').length === 0
           && sktSaveAdvantages('Enemies have disadvantage on saving throws against your spells.').length === 0);
        ok('saves: a subclass feature’s (an abjurer’s Spell Resistance)', sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { cls: 'Wizard', subclass: 'Abjuration', level: 14 }), R14).sheet.saveMods.some(m => m.src === 'Spell Resistance' && m.text === 'Advantage on saving throws against spells'));
        ok('saves: an "unless" still counts as always', sktSaveAdvantages('You have Advantage on Dexterity saving throws unless you have the Incapacitated condition.')[0].auto === true);

        const p0 = localStorage.getItem('skt-party-v1');
        const keep = { d: window.sktD, find: window._findCombatantForPartyMember };
        try {
          window._findCombatantForPartyMember = () => -1;
          const rec = sktComputeCharacter(Object.assign(sktBlankBuild('2024'), { name: 'Stubby', cls: 'Barbarian', level: 7, species: 'Dwarf', asi: { 4: { type: 'feat', feat: 'War Caster' } }, spells: ['Bless'] }), R24);
          rec.id = 'pc_save_mods'; state.party.push(rec); save();
          openCharSheet('pc_save_mods'); await sleep(300);
          const root = document.getElementById('cs-root'), q = s => root.querySelector(s);
          ok('sheet saves: the modifiers sit under the saving throws', /Saving throw modifiers.*Advantage on saving throws to avoid or end the Poisoned condition.*Dwarven Resilience/.test(q('.cs-savemods').textContent));
          ok('sheet saves: an A beside the Dexterity save and initiative, and only there', !!q('[data-cs-roll="save:dex"] .cs-adv') && !q('[data-cs-roll="save:str"] .cs-adv') && !!q('[data-cs-roll="init"] .cs-adv'));
          window.sktD = () => 7;
          q('[data-cs-roll="save:dex"]').click(); await sleep(30);
          ok('sheet saves: the Dexterity save rolls with advantage', CS.log[0].mode === 'adv' && /Danger Sense/.test(CS.log[0].why));
          q('[data-cs-roll="init"]').click(); await sleep(30);
          ok('sheet saves: so does initiative', CS.log[0].mode === 'adv' && /Feral Instinct/.test(CS.log[0].why));
          document.querySelector('#cs-root [data-cs-roll="save:con"]').click(); await sleep(30);
          ok('sheet saves: a Constitution save reminds of the poison advantage', CS.log[0].mode === 'normal' && /check: advantage on saving throws to avoid or end the Poisoned condition \(Dwarven Resilience\)/.test(CS.log[0].why), CS.log[0].why);
          state.party.find(p => p.id === 'pc_save_mods').concentration = 'Bless'; save(); CS.conc = { dc: 10, spell: 'Bless' }; csRender();
          document.querySelector('#cs-root [data-cs="concsave"]').click(); await sleep(30);
          ok('sheet saves: War Caster’s advantage on the concentration save', CS.log[0].mode === 'adv' && /War Caster/.test(CS.log[0].why), CS.log[0].why);
          ok('sheet saves: and Bless (concentrated on) adds its d4 to it, a save like any other', /Bless d4/.test(CS.log[0].why), CS.log[0].why);
          csClose();
        } finally {
          window.sktD = keep.d; window._findCombatantForPartyMember = keep.find;
          if (typeof csClose === 'function') csClose();
          _remoteUpdate = true;
          try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
          loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
        }
      } catch(e){ ok('round 48 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 49: readable on every theme --------------------------------------
    {
      try {
        const h2r = h => { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
        const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        const ratio = (a, b) => { const x = lum(h2r(a)), y = lum(h2r(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const bad = [];
        Object.entries(THEME_PRESETS).forEach(([id, t]) => {
          const v = t.vars, p3 = v['--panel-3'];
          ['--text-muted', '--text-dim', '--danger', '--success', '--warning', '--accent'].forEach(k => { if (!v[k] || ratio(v[k], p3) < 4.5) bad.push(id + ' ' + k + ' ' + (v[k] ? ratio(v[k], p3).toFixed(2) : 'unset')); });
          const on = v['--on-accent'] || '#1a1a1a';
          if (ratio(on, v['--accent']) < 4.5) bad.push(id + ' on-accent ' + ratio(on, v['--accent']).toFixed(2));
        });
        ok('readable: every theme’s secondary text, status colours and accent read at 4.5:1 on the lightest panel', bad.length === 0, bad.join(', '));
        const keep = { pref: localStorage.getItem('skt-theme-v1') };
        applyTheme('parchment', null, null);
        ok('readable: a light theme says so, and draws native controls light', document.documentElement.dataset.themeTone === 'light' && getComputedStyle(document.documentElement).colorScheme === 'light');
        applyTheme('default', null, null);
        ok('readable: and a dark one dark', document.documentElement.dataset.themeTone === 'dark' && getComputedStyle(document.documentElement).colorScheme === 'dark');
        if (keep.pref) localStorage.setItem('skt-theme-v1', keep.pref);
        const r = document.createElement('input'); r.type = 'radio'; document.body.appendChild(r);
        ok('readable: a radio is its own size, not the row’s width', r.getBoundingClientRect().width < 30, r.getBoundingClientRect().width + 'px');
        r.remove();
        const t = document.createElement('div');
        t.innerHTML = '<div class="combatant-card"><div class="card-stats" style="width:180px"><div class="card-stat" title="HP"><span class="lab">♥</span><input type="number" value="61"><span class="hp-temp-badge">+8</span></div><div class="card-stat"><input value="15"></div><div class="card-stat"><input value="20"></div></div></div>';
        document.body.appendChild(t);
        const hp = t.querySelector('[title="HP"] input');
        ok('readable: the HP number keeps room beside a temp-HP badge', hp.clientWidth >= hp.scrollWidth && hp.getBoundingClientRect().width > 20, hp.getBoundingClientRect().width + 'px');
        t.remove();
        // The builder's upload button and the party card's name.
        await openCharBuilder({}); for (let i = 0; i < 60 && !CB.R; i++) await sleep(100);
        CB.step = 'basics'; cbRender(); await sleep(30);
        const up = document.querySelector('#cb-root .cb-upload');
        ok('readable: the portrait Upload button holds its word', !!up && up.scrollWidth <= up.clientWidth + 1 && up.getBoundingClientRect().width > 50, up ? up.scrollWidth + ' in ' + up.clientWidth : 'missing');
        cbClose();
        openPanel('party'); await sleep(250);
        const nm = document.querySelector('.window[data-panel="party"] .char-name');
        ok('readable: a party card’s name isn’t squeezed by its buttons', !!nm && nm.getBoundingClientRect().width >= 90, nm ? Math.round(nm.getBoundingClientRect().width) + 'px' : 'no card');
        closePanel('party');
      } catch(e){ ok('round 49 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 50: Reckless Attack, and advantage on death saves -------------------
    {
      const p0 = localStorage.getItem('skt-party-v1'), c0 = localStorage.getItem('skt-combat-v1');
      const keep = { find: window._findCombatantForPartyMember };
      try {
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const ab = { method: 'manual', base: { str: 16, dex: 14, con: 14, int: 8, wis: 10, cha: 10 } };
        const barb = (ed, R, prior) => sktComputeCharacter(Object.assign(sktBlankBuild(ed), { name: 'Grog', cls: 'Barbarian', level: 2, abilities: JSON.parse(JSON.stringify(ab)) }), R, prior);
        const b0 = barb('2024', R24), b1 = barb('2024', R24, { active: { 'Reckless Attack': true } });
        const st = b0.sheet.states.find(s => s.key === 'Reckless Attack');
        ok('reckless: a switch, off, and no longer a counter', !!st && !st.on && !b0.resources.some(r => r.name === 'Reckless Attack'));
        ok('reckless: on, Strength attacks roll with advantage', JSON.stringify(b1.sheet.rollAdv.filter(x => x.label === 'Reckless Attack')) === JSON.stringify([{ on: ['attack:str'], label: 'Reckless Attack' }]) && !b0.sheet.rollAdv.some(x => x.label === 'Reckless Attack'));
        ok('reckless: the greataxe and an unarmed strike use Strength', b0.sheet.attacks.find(a => a.name === 'Greataxe').str === true && b0.sheet.attacks.find(a => a.name === 'Unarmed Strike').str === true);
        const fx = { pb: 2, mod: { str: 1, dex: 3, con: 0, int: 0, wis: 0, cha: 0 }, weaponProf: new Set(['martial', 'simple']), weaponPropRules: [], build: { masteries: [] }, edition: '2014', R: R14,
                     rangedAttackBonus: 0, duelingBonus: 0, weaponHit: 0, rageOn: 0, damageBonusAll: 0, level: 2 };
        const rows = sktBuildAttacks(fx, { weapons: [R14.items.longbow, R14.items.rapier, R14.items.greataxe] }, null);
        ok('reckless: a bow, or a rapier swung with Dexterity, doesn’t', rows.find(a => a.name === 'Longbow').str === false && rows.find(a => a.name === 'Rapier').str === false && rows.find(a => a.name === 'Greataxe').str === true);
        const even = sktBuildAttacks(Object.assign({}, fx, { mod: Object.assign({}, fx.mod, { str: 3, dex: 3 }) }), { weapons: [R14.items.longbow] }, null);
        ok('reckless: a bow isn’t a Strength attack even when Strength equals Dexterity', even.find(a => a.name === 'Longbow').str === false);
        ok('death: Durable rolls death saves with advantage', JSON.stringify(sktComputeCharacter(Object.assign(sktBlankBuild('2024'), { cls: 'Fighter', level: 4, asi: { 4: { type: 'feat', feat: 'Durable' } } }), R24).sheet.rollAdv) === JSON.stringify([{ on: ['death'], label: 'Durable' }]));

        const seq = v => { const l = v.slice(); sktSetRandom(() => (l.shift() - 1) / 20 + 1e-9); };
        window._findCombatantForPartyMember = () => -1;
        const rec = barb('2024', R24); rec.id = 'pc_reck'; state.party.push(rec); save();
        const me = () => state.party.find(p => p.id === 'pc_reck');
        openCharSheet('pc_reck', { tab: 'actions' }); await sleep(300);
        const q = s => document.querySelector('#cs-root ' + s);
        q('[data-cs-state="Reckless Attack"]').click(); await sleep(60);
        const gi = me().sheet.attacks.findIndex(a => a.name === 'Greataxe');
        sktSetRandom(() => 0.3);
        q('[data-cs-atk="' + gi + '"]').click(); await sleep(30);
        ok('sheet: with Reckless Attack on, the greataxe rolls with advantage', CS.log[0].mode === 'adv' && /Reckless Attack/.test(CS.log[0].why), CS.log[0].why);
        csClose();
        // The start of the barbarian's next turn ends it (and Shield with it).
        state.combatants = [{ id: 'pc_reck', name: 'Grog', isPC: true, hp: 20, hpMax: 20, initiative: 10 }];
        window._findCombatantForPartyMember = keep.find;
        me().active = { 'Reckless Attack': true, Shield: true, 'Mage Armor': true }; save();
        panelDefs.combat._refreshTurnEconomy('pc_reck'); save();
        ok('turn: the start of their turn ends Reckless Attack and Shield, not Mage Armor', JSON.stringify(me().active) === '{"Mage Armor":true}' && !me().sheet.rollAdv.some(x => x.label === 'Reckless Attack'), JSON.stringify(me().active));
        // The Turn View's attack roll: Reckless Attack's advantage, Bless's d4.
        me().build.spells = ['Bless']; me().active = { 'Reckless Attack': true }; me().concentration = 'Bless';
        Object.assign(me(), sktComputeCharacter(me().build, R24, me())); save();
        state.combatants = [{ id: 'pc_reck', name: 'Grog', isPC: true, hp: 20, hpMax: 20, initiative: 10 }, { id: 'tgt_x', name: 'Dummy', hp: 30, hpMax: 30, ac: 30, initiative: 5 }];
        state.activeCombatantId = 'pc_reck'; save();
        openPanel('turnview'); await sleep(300);
        const T = panelDefs.turnview, was = T._resolve; let got = null;
        T._resolve = o => { got = o; };
        try {
          const ai = T._attacksFor(state.combatants[0]).findIndex(a => a.name === 'Greataxe');
          seq([5, 14, 12, 10, 10, 10, 10]);
          T._rollAttack(ai, { attacker: state.combatants[0], target: state.combatants[1] });
        } finally { T._resolve = was; }
        const gb = parseInt(me().sheet.attacks.find(a => a.name === 'Greataxe').atkBonus, 10);
        ok('turn view: a reckless greataxe rolls with advantage and adds Bless', !!got && got.nat === 14 && /Reckless Attack/.test(got.hitNote) && /Bless \+3/.test(got.hitNote) && got.total === 14 + gb + 3, got ? got.nat + ' ' + got.total + ' ' + got.hitNote : 'no roll');
        closePanel('turnview');

        // Death saves: two dice, the higher kept.
        window._findCombatantForPartyMember = () => -1;
        const tough = sktComputeCharacter(Object.assign(sktBlankBuild('2024'), { name: 'Hardy', cls: 'Fighter', level: 4, asi: { 4: { type: 'feat', feat: 'Durable' } } }), R24);
        tough.id = 'pc_dur'; tough.hp = 0; state.party.push(tough); save();
        const dur = () => state.party.find(p => p.id === 'pc_dur');
        seq([4, 15]); const r1 = sktRollDeathSave(dur());
        ok('death: advantage keeps the higher die (4 and 15: a success)', r1.nat === 15 && dur().deathSaves.success === 1 && /advantage, Durable: 4 \/ 15/.test(r1.msg), r1.msg);
        rec.hp = 0; me().hp = 0; me().deathSaves = null; save();
        seq([4, 15]); const r2 = sktRollDeathSave(me());
        ok('death: without it, one die (4: a failure)', r2.nat === 4 && me().deathSaves.fail === 1 && !/advantage/.test(r2.msg), r2.msg);
        // The Turn View's death save too.
        window._findCombatantForPartyMember = keep.find;
        state.combatants = [{ id: 'pc_dur', name: 'Hardy', isPC: true, hp: 0, hpMax: 40, deathSaves: { success: 0, fail: 0 } }];
        state.activeCombatantId = 'pc_dur'; save();
        openPanel('turnview'); await sleep(300);
        seq([3, 12]); panelDefs.turnview._rollDeathSave();
        ok('death: the Turn View rolls a Durable PC’s save with advantage too', JSON.stringify(state.combatants[0].deathSaves) === '{"success":1,"fail":0}', JSON.stringify(state.combatants[0].deathSaves));
        closePanel('turnview');
      } catch(e){ ok('round 50 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        sktSetRandom(null); window._findCombatantForPartyMember = keep.find;
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); if (c0 != null) localStorage.setItem('skt-combat-v1', c0); } finally { _remoteUpdate = false; }
        loadDomain('party'); loadDomain('combat');
        panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }
    // -- Round 51: the sheet on paper, and the Export menu ---------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      const keep = { pr: window.print, find: window._findCombatantForPartyMember, clip: navigator.clipboard };
      try {
        window._findCombatantForPartyMember = () => -1;
        const R14 = await sktRulesLoad('2014'), R24 = await sktRulesLoad('2024');
        const cler = sktComputeCharacter(Object.assign(sktBlankBuild('2024'), { name: 'Brother Tam', cls: 'Cleric', subclass: 'Life', level: 5, species: 'Dwarf', background: 'Acolyte',
          spells: ['Bless', 'Cure Wounds', 'Spirit Guardians'], cantrips: ['Sacred Flame'], details: { personality: 'Quotes scripture.' } }), R24);
        cler.id = 'pc_print'; state.party.push(cler); save();
        openCharSheet('pc_print'); await sleep(300);
        const html = csPrintSheet(cler), box = document.createElement('div'); box.innerHTML = html;
        const txt = box.textContent;
        ok('paper: no buttons, inputs or menus on it', !box.querySelector('button, input, select, textarea, details'));
        ok('paper: page one has hit points, hit dice and death saves to keep in pencil', /Current hit points/.test(txt) && box.querySelectorAll('.cp-ds .cp-ring').length === 6
           && box.querySelector('.cp-spent').querySelectorAll('.cp-box').length === 5 && /Hit point maximum\s*38/.test(txt));
        ok('paper: limited uses as boxes to tick', [...box.querySelectorAll('.cp-res')].some(r => /Channel Divinity/.test(r.textContent) && r.querySelectorAll('.cp-box').length === 2));
        ok('paper: every feature with its text, not just its name', /Disciple of Life/.test(txt) && /additional Hit Points/i.test(txt));
        ok('paper: spells with their casting line and text, and slots to tick', /Protective spirits/.test(txt) && [...box.querySelectorAll('.cp-meta-line')].some(m => /^1 action · Emanation/.test(m.textContent)) && /3rd level/.test(txt)
           && [...box.querySelectorAll('.cp-slots .cp-res')].some(r => /1st level/.test(r.textContent) && r.querySelectorAll('.cp-box').length === 4));
        ok('paper: what the player wrote, and lines where they haven’t', /Quotes scripture/.test(txt) && box.querySelectorAll('.cp-write .cp-lines').length >= 3);
        ok('paper: only armour and weapons are marked equipped', [...box.querySelectorAll('.cp-tbl tr')].some(r => /Mace/.test(r.textContent) && /equipped/.test(r.textContent))
           && ![...box.querySelectorAll('.cp-tbl tr')].some(r => /Calligrapher/.test(r.textContent) && /equipped/.test(r.textContent)));
        const barb = sktComputeCharacter(Object.assign(sktBlankBuild('2014'), { name: 'Grog', cls: 'Barbarian', level: 3 }), R14);
        ok('paper: a character without spells gets no spell page', !/Spellcasting/.test(csPrintSheet(barb)));
        ok('paper: class and level read as they would be written', cpClassLevel(cler) === 'Cleric 5 · Life'
           && cpClassLevel({ sheet: { classLevels: [{ cls: 'fighter', level: 3, subclass: 'Champion' }, { cls: 'wizard', level: 2, subclass: '' }] } }) === 'Fighter 3 / Wizard 2 · Champion', cpClassLevel(cler));
        const t = csCharacterText(cler);
        ok('text: the numbers and the lists', /^Brother Tam — /.test(t) && /AC \d+ · HP 38/.test(t) && /WIS 10 \(\+0\)/.test(t) && /- 3rd level \(2 slots\): .*Spirit Guardians/.test(t) && /Coins: \d+ gp/.test(t), t.slice(0, 200));

        // The menu.
        const q = s => document.querySelector('#cs-root ' + s);
        q('[data-cs="exportmenu"]').click(); await sleep(30);
        ok('menu: Export opens three choices', !!q('.cs-exmenu') && !!q('.cs-exmenu [data-cs="print"]') && !!q('.cs-exmenu [data-cs="export"]') && !!q('.cs-exmenu [data-cs="copytext"]'));
        q('.cs-boxes').click(); await sleep(30);
        ok('menu: and closes on a click elsewhere', !q('.cs-exmenu'));
        let printed = 0; window.print = () => { printed++; };
        q('[data-cs="exportmenu"]').click(); await sleep(20); q('.cs-exmenu [data-cs="print"]').click(); await sleep(30);
        ok('menu: the PDF choice prints the paper sheet and closes the menu', printed === 1 && /Current hit points/.test((document.querySelector('#cs-print .cp-p1') || {}).textContent || '') && !q('.cs-exmenu'));
        window.dispatchEvent(new Event('afterprint')); await sleep(20);
        let copied = null;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: s => { copied = s; return Promise.resolve(); } } });
        q('[data-cs="exportmenu"]').click(); await sleep(20); q('.cs-exmenu [data-cs="copytext"]').click(); await sleep(40);
        ok('menu: Copy as text puts the text on the clipboard', copied === csCharacterText(state.party.find(p => p.id === 'pc_print')) && !q('.cs-textout'));
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
        q('[data-cs="exportmenu"]').click(); await sleep(20); q('.cs-exmenu [data-cs="copytext"]').click(); await sleep(60);
        ok('menu: where copying is refused, the text is shown to copy by hand', !!q('[data-cs-textout]') && /Brother Tam/.test(q('[data-cs-textout]').value));
        q('[data-cs="closetext"]').click(); await sleep(20);
        ok('menu: and put away', !q('[data-cs-textout]'));
        csClose();
      } catch(e){ ok('round 51 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        window.print = keep.pr; window._findCombatantForPartyMember = keep.find;
        try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: keep.clip }); } catch(_){}
        document.getElementById('cs-print')?.remove();
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 52: the sheet reads at table distance ------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      try {
        const R24 = await sktRulesLoad('2024');
        const rec = sktComputeCharacter(Object.assign(sktBlankBuild('2024'), { name: 'Keith', cls: 'Bard', level: 6, spells: ['Healing Word'] }), R24);
        rec.id = 'pc_big'; state.party.push(rec);
        // A character brought in from a PDF: no casting ability, an unsigned bonus.
        state.party.push({ id: 'pc_imp', name: 'Imported', cls: 'bard', level: 6, hp: 30, hpMax: 30, abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 12, cha: 16 },
          sheet: { spellSaveDc: 15, spellAtkBonus: 7, spells: ['Healing Word'], profBonus: 3 } });
        save();
        openCharSheet('pc_big'); await sleep(300);
        const q = s => document.querySelector('#cs-root ' + s);
        const px = s => parseFloat(getComputedStyle(q(s)).fontSize);
        ok('big: rows are 14px, not 12', px('.cs-row') >= 14 && px('.cs-row span:nth-child(2)') >= 14, px('.cs-row') + 'px');
        const b = q('.cs-row > b'), bs = getComputedStyle(b);
        // Its box: a border, or the sheet's frame (an outline drawn by ::before).
        const framed = bs.borderTopStyle === 'solid' || (getComputedStyle(b, '::before').content !== 'none' && bs.clipPath !== 'none');
        ok('big: each save and skill bonus sits in its own box', parseFloat(bs.fontSize) >= 15 && framed && b.getBoundingClientRect().width >= 40);
        ok('big: ability modifiers at 24px', px('.cs-ab b') >= 24);
        ok('big: the rest of the app keeps its own sizes', parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs-md')) === 12);
        csClose();
        openCharSheet('pc_imp', { tab: 'spells' }); await sleep(300);
        const head = q('.cs-spellhead').textContent;
        ok('big: an imported bard’s spell header says CHA and +7', /Ability\s*CHA/.test(head) && /Spell attack\s*\+7/.test(head), head);
        ok('big: the bonus reads signed whatever it was stored as', csAtkText(7) === '+7' && csAtkText('+7') === '+7' && csAtkText(-1) === '-1' && csAtkText('') === '' && csAtkText('DC 13') === 'DC 13');
        csClose();
      } catch(e){ ok('round 52 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 53: the builder reads like the sheet -------------------------
    {
      try {
        await openCharBuilder({}); for (let i = 0; i < 60 && !CB.R; i++) await sleep(100);
        CB.build.cls = 'Wizard'; CB.build.level = 5; cbQuickBuild();
        const px = s => { const e = document.querySelector('#cb-root ' + s); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; };
        CB.step = 'class'; cbRender(); await sleep(30);
        ok('builder big: class choices at 16px and the step tabs at 14px', px('.cb-card') >= 16 && px('[data-cb-step]') >= 14, px('.cb-card') + ' / ' + px('[data-cb-step]'));
        CB.step = 'spells'; cbRender(); await sleep(30);
        ok('builder big: spell options and notes at 14px, the info button 12px', px('.cb-check') >= 14 && px('.cb-dim') >= 14 && px('.cb-spi') >= 12, px('.cb-check') + ' / ' + px('.cb-dim') + ' / ' + px('.cb-spi'));
        ok('builder big: headings at 20px', px('.cb-main h3') >= 20);
        cbClose();
      } catch(e){ ok('round 53 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally { if (document.getElementById('cb-root') && typeof cbClose === 'function') cbClose(); }
    }

    // -- Round 54: the toolbar's tools live in the dock ----------------------
    {
      const app = document.querySelector('.app'), h0 = app.style.height;
      try {
        const id = s => document.getElementById(s);
        ok('dock tools: nothing floats in the top-right corner', getComputedStyle(id('float-toolbar')).display === 'none' && document.body.classList.contains('tools-in-dock'));
        ok('dock tools: search at the top of the dock', id('dock-tools-top').contains(id('float-search-btn')));
        ok('dock tools: campaign, sync, player view, help and settings at the bottom', ['campaign-btn', 'sync-status', 'player-view-btn', 'tutorial-btn', 'settings-btn'].every(k => id('dock-tools-bottom').contains(id(k))));
        ok('dock tools: each one named, as the panel buttons are', ['float-search-btn', 'campaign-btn', 'sync-status', 'player-view-btn', 'tutorial-btn', 'settings-btn'].every(k => id(k).dataset.label && id(k).querySelector('.dt-label')));
        ok('dock tools: the campaign button is named for the campaign, with an icon', id('campaign-btn').dataset.label === sktActiveCampaignName() && !!id('campaign-btn').querySelector('.dt-ico'));
        _setSyncStatus('live'); await sleep(30);
        const live = id('sync-status').dataset.label;
        _setSyncStatus('offline'); await sleep(30);
        ok('dock tools: the sync button’s name follows the connection', live === 'Sync: Live' && id('sync-status').dataset.label === 'Sync: Offline', live + ' / ' + id('sync-status').dataset.label);
        ok('dock tools: no native tooltip on top of the hover label', !id('settings-btn').hasAttribute('title') && !id('campaign-btn').hasAttribute('title') && !!id('settings-btn').getAttribute('aria-label'));
        sktRefreshCampaignChip(); await sleep(30);   // it sets the chip's tooltip again
        ok('dock tools: nor after the campaign chip is refreshed', !id('campaign-btn').hasAttribute('title') && /Campaign: /.test(id('campaign-btn').getAttribute('aria-label') || ''));
        // Who's connected opens beside the chip, not off the bottom of the screen.
        sktPresenceToggle(); await sleep(20);
        const pp = id('presence-pop').getBoundingClientRect(), chip = id('sync-status').getBoundingClientRect();
        ok('dock tools: who’s connected opens beside the sync button, on screen', pp.left >= chip.right && pp.bottom <= innerHeight && pp.top >= 0, JSON.stringify([Math.round(pp.left), Math.round(pp.top), Math.round(pp.bottom)]));
        sktPresenceClose();
        // The full search box, centred.
        sktOpenFullSearch('goblin'); await sleep(80);
        const sw = id('search-wrap').getBoundingClientRect();
        ok('dock tools: the full search opens centred over the workspace', getComputedStyle(id('search-wrap')).display !== 'none' && sw.width >= 600 && Math.abs((sw.left + sw.right) / 2 - innerWidth / 2) < 4, JSON.stringify([Math.round(sw.left), Math.round(sw.width)]));
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await sleep(30);
        ok('dock tools: and closes on a click away', !id('search-wrap').classList.contains('open'));
        // A short screen: the panel list scrolls; search and settings stay in reach.
        app.style.height = '600px'; await sleep(60);
        const set = id('settings-btn').getBoundingClientRect(), btn = document.querySelector('.dock-panels .dock-btn[data-panel="combat"]').getBoundingClientRect();
        const pl = document.querySelector('.dock-panels');
        ok('dock tools: on a short screen the panels scroll and the tools stay on screen', set.bottom <= 600 && btn.height >= 30 && pl.scrollHeight > pl.clientHeight, Math.round(set.bottom) + ' / btn ' + Math.round(btn.height));
      } catch(e){ ok('round 54 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally { app.style.height = h0; if (typeof sktPresenceClose === 'function') sktPresenceClose(); }
    }

    // -- Round 55: starting up can't be held hostage by a slow download -------
    {
      try {
        ok('boot: the app says it started, and the watchdog stood down', window.__sktBooted === true && !document.getElementById('skt-boot-stuck') && Array.isArray(window.__sktBootErrors));
        ok('boot: no <script> tag waits on gstatic.com (Firebase loads when sync starts)', ![...document.querySelectorAll('script[src]')].some(s => /gstatic\.com/.test(s.src)));
        ok('boot: the watchdog is the first script, inline in the head', !!document.head.querySelector('script:not([src])') && /__sktBooted/.test(document.head.querySelector('script:not([src])').textContent));
        ok('boot: the Firebase loader exists for sync to use', typeof _rtLoadSdk === 'function' && typeof _rtConnect === 'function');
      } catch(e){ ok('round 55 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }

    // -- Round 56: a lowered maximum doesn't push the card's temp box out --------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      try {
        state.party.push({ id: 'pc_maxloss', name: 'Zindle "Deathwhistle" Farrago', cls: 'bard', level: 6, hp: 34, hpMax: 39, hpMaxNormal: 53, ac: 14, tempHp: 0 });
        save(); openPanel('party'); await sleep(250); panelDefs.party._render(); await sleep(60);
        const i = state.party.findIndex(p => p.id === 'pc_maxloss');
        const card = panelDefs.party._body.querySelector('.char-card[data-cidx="' + i + '"]');
        const cr = card.getBoundingClientRect(), t = card.querySelector('.char-hp-temp').getBoundingClientRect();
        const b = card.querySelector('.char-hpmax-loss').getBoundingClientRect(), strip = card.querySelector('.party-hp-dmg').getBoundingClientRect();
        ok('party: with a lowered maximum the temp box stays inside the card', t.right <= cr.right - 4, Math.round(t.right) + ' vs card ' + Math.round(cr.right));
        ok('party: and the ▼ tag sits under the numbers, clear of the damage row', b.bottom <= strip.top && b.top > card.querySelector('.char-hp-current').getBoundingClientRect().top, Math.round(b.bottom) + ' vs ' + Math.round(strip.top));
        closePanel('party');
      } catch(e){ ok('round 56 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party && panelDefs.party._render && panelDefs.party._render();
      }
    }

    // -- Round 57: every dropdown has one arrow, focused or not ---------------
    {
      try {
        const bad = [];
        const check = where => document.querySelectorAll('select').forEach(s => {
          if (!s.offsetParent || s.classList.contains('party-hp-type')) return;   // that one is a label with an invisible select over it
          const look = () => { const c = getComputedStyle(s); return c.backgroundImage === 'none' ? 'no arrow' : c.backgroundRepeat !== 'no-repeat' ? 'arrow tiles' : parseFloat(c.paddingRight) < 18 ? 'arrow over the text' : ''; };
          const a = look(); s.focus(); const b = look(); s.blur();
          if (a || b) bad.push(where + ' ' + (s.id || s.className || 'select') + ': ' + (a || '') + (b ? ' (focused: ' + b + ')' : ''));
        });
        await openCharBuilder({}); for (let i = 0; i < 60 && !CB.R; i++) await sleep(100);
        CB.build.cls = 'Wizard'; CB.build.level = 5; cbQuickBuild();
        for (const st of CB_STEPS){ CB.step = st.id; cbRender(); await sleep(20); check('builder ' + st.id); }
        cbClose();
        for (const id of ['encounter', 'loot', 'world']){ openPanel(id); await sleep(300); check(id); closePanel(id); }
        document.getElementById('settings-btn').click(); await sleep(200); check('settings');
        document.getElementById('close-drawer')?.click(); await sleep(100);
        ok('dropdowns: every one shows a single arrow, focused or not', bad.length === 0, bad.slice(0, 5).join(' | '));
      } catch(e){ ok('round 57 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally { if (document.getElementById('cb-root') && typeof cbClose === 'function') cbClose(); }
    }

    // -- Round 58: the party's toolbar is a strip of its own, lined up with the cards
    {
      try {
        openPanel('party'); await sleep(250); panelDefs.party._render(); await sleep(60);
        const B = panelDefs.party._body, head = B.querySelector('.party-head'), card = B.querySelector('.party-grid .char-card');
        const btn = head.querySelector('[data-act="party-add"]').getBoundingClientRect(), c = card.getBoundingClientRect(), h = getComputedStyle(head);
        ok('party toolbar: its first button lines up with the first card, not the window edge', Math.abs(btn.left - c.left) <= 2, Math.round(btn.left) + ' vs card ' + Math.round(c.left));
        ok('party toolbar: a strip with its own background and a line under it', h.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(h.borderBottomWidth) >= 1, h.backgroundColor + ' / ' + h.borderBottomWidth);
        B.scrollTop = 200; await sleep(30);
        ok('party toolbar: stays at the top while the cards scroll', B.scrollHeight <= B.clientHeight || Math.abs(head.getBoundingClientRect().top - B.getBoundingClientRect().top) <= 1, Math.round(head.getBoundingClientRect().top) + ' vs ' + Math.round(B.getBoundingClientRect().top));
        B.scrollTop = 0;
        const hs = [...head.querySelectorAll('.btn')].map(b => Math.round(b.getBoundingClientRect().height));
        ok('party toolbar: every button the same height', new Set(hs).size === 1, hs.join(','));
        const tops = [...head.querySelectorAll('.btn')].map(b => Math.round(b.getBoundingClientRect().top));
        ok('party toolbar: one row, even on a phone', new Set(tops).size === 1, tops.join(','));
        closePanel('party');
      } catch(e){ ok('round 58 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }
    // -- Round 59: the combat tracker's toolbar is a strip too, its buttons all boxed
    {
      try {
        openPanel('combat'); await sleep(250); panelDefs.combat._render(); await sleep(60);
        const B = panelDefs.combat._body, bar = B.querySelector('.combat-controls'), card = B.querySelector('.combatant-card');
        const btns = [...bar.querySelectorAll('.btn')], hs = getComputedStyle(bar);
        ok('combat toolbar: its first button lines up with the cards', !card || Math.abs(btns[0].getBoundingClientRect().left - card.getBoundingClientRect().left) < 1.5, Math.round(btns[0].getBoundingClientRect().left) + ' vs ' + (card && Math.round(card.getBoundingClientRect().left)));
        ok('combat toolbar: a strip with its own background, staying put', hs.backgroundColor !== 'rgba(0, 0, 0, 0)' && hs.position === 'sticky', hs.backgroundColor + ' / ' + hs.position);
        const bare = btns.filter(b => { const c = getComputedStyle(b); return c.backgroundColor === 'rgba(0, 0, 0, 0)' || c.borderTopColor === 'rgba(0, 0, 0, 0)'; }).map(b => b.dataset.act);
        ok('combat toolbar: every button has a box, none a loose symbol', bare.length === 0, bare.join(','));
        const h = btns.map(b => Math.round(b.getBoundingClientRect().height));
        ok('combat toolbar: every button the same height', new Set(h).size === 1, h.join(','));
        closePanel('combat');
      } catch(e){ ok('round 59 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }
    // -- Round 60: narrow windows and narrow cards reflow, nothing pokes out ----
    {
      const p0 = localStorage.getItem('skt-party-v1'), cw0 = state.settings.partyCardWidth, cmp0 = state.settings.partyCompact;
      try {
        const T = 'rgba(0, 0, 0, 0)', phone = innerWidth < 760;
        const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const c = getComputedStyle(el); return c.visibility !== 'hidden' && c.display !== 'none'; };
        const isBox = el => { const c = getComputedStyle(el); return c.backgroundColor !== T || (parseFloat(c.borderRightWidth) > 0 && c.borderRightColor !== T); };
        const lab = el => el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0];
        // spill: a control or text past the edge of the box it sits in.
        // column: a row of 3+ small items (pips, chips) crushed to ≤2 a line.
        const scan = (root, where, bad) => {
          for (const el of root.querySelectorAll('*')){
            if (!vis(el) || el.closest('svg, .map-token, .tv-map')) continue;
            const pos = getComputedStyle(el).position;
            if ((!el.children.length || /^(INPUT|SELECT|BUTTON|IMG)$/.test(el.tagName)) && pos !== 'absolute' && pos !== 'fixed'){
              const r = el.getBoundingClientRect();
              for (let a = el.parentElement; a && root.contains(a); a = a.parentElement){
                if (a !== root && getComputedStyle(a).overflowX !== 'visible') break;
                if (isBox(a)){ const ar = a.getBoundingClientRect(), o = Math.max(r.right - ar.right, ar.left - r.left);
                  if (o > 1.5) bad.push(where + ': ' + lab(el) + ' out of ' + lab(a) + ' by ' + Math.round(o)); break; }
              }
            }
            const kids = [...el.children].filter(vis), small = kids.filter(k => { const r = k.getBoundingClientRect(); return r.width <= 28 && r.height <= 28; });
            if (small.length >= 3 && small.length >= kids.length * 0.8){
              const rows = {}; small.forEach(k => { const t = Math.round(k.getBoundingClientRect().top / 4); rows[t] = (rows[t] || 0) + 1; });
              const n = Object.values(rows); if (n.length >= 3 && Math.max(...n) <= 2) bad.push(where + ': ' + lab(el) + ' crushed to a column');
            }
          }
        };
        const P = panelDefs.party;
        openPanel('party'); await sleep(250);
        const pw = P._body.closest('.window');
        if (!phone) Object.assign(pw.style, { left: '60px', top: '0px', width: '1200px', height: '600px' });
        const pb = [];
        for (const cw of (phone ? [0] : [140, 200, 260])){ if (cw) state.settings.partyCardWidth = cw; P._render(); await sleep(60); scan(pw, 'party cards ' + (cw || 'phone'), pb); }
        state.settings.partyCompact = true; P._render(); await sleep(60); scan(pw, 'party compact', pb);
        state.settings.partyCompact = cmp0; state.settings.partyCardWidth = cw0; P._render();
        ok('narrow: party cards at every width keep Temp, hit dice and resources inside the card', pb.length === 0, [...new Set(pb)].slice(0, 4).join(' | '));
        const card = P._body.querySelector('.char-card .hd-pips');
        if (card){ const tops = new Set([...card.children].map(p => Math.round(p.getBoundingClientRect().top))); ok('narrow: the hit-dice dots stay one row for a level-6 character', [...card.children].length > 6 || tops.size === 1, tops.size + ' rows'); }
        closePanel('party');
        // Every window, narrow
        const wb = [];
        for (const id of ['adventures','battlemap','bestiary','books','combat','encounter','handouts','library','loot','notes','npcgen','npclib','shop','soundboard','time','turnview','world']){
          openPanel(id); await sleep(250);
          const B = panelDefs[id] && panelDefs[id]._body; if (!B) continue;
          const w = B.closest('.window');
          for (const W of (phone ? [0] : [360, 520])){
            if (W){ Object.assign(w.style, { left: '60px', top: '0px', width: W + 'px', height: '640px' }); await sleep(120); }
            scan(w, id + (W ? '@' + W : ' phone'), wb);
          }
          closePanel(id);
        }
        ok('narrow: no window lets a control or text poke out of its box, or crushes a row into a column', wb.length === 0, [...new Set(wb)].slice(0, 5).join(' | '));
        // The three that kept two columns when the window (not the screen) was narrow
        const lay = [];
        for (const [id, sel, one] of [['turnview', '.tv-main', s => s.gridTemplateColumns.split(' ').length === 1], ['shop', '.shop-layout', s => s.gridTemplateColumns.split(' ').length === 1], ['encounter', '.enc-panel', s => s.flexDirection === 'column']]){
          openPanel(id); await sleep(250);
          const B = panelDefs[id]._body, w = B.closest('.window');
          if (!phone) Object.assign(w.style, { left: '60px', top: '0px', width: '520px', height: '640px' });
          await sleep(120);
          const el = B.querySelector(sel); if (el && !one(getComputedStyle(el))) lay.push(id);
          closePanel(id);
        }
        ok('narrow: Turn View, Shop and Encounter go to one column in a narrow window', lay.length === 0, lay.join(', '));
      } catch(e){ ok('round 60 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally {
        state.settings.partyCardWidth = cw0; state.settings.partyCompact = cmp0;
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
      }
    }
    // -- Round 61: Turn View's stat block is readable; the phone toolbar sits in the title bar
    {
      try {
        const T = panelDefs.turnview;
        ok('turn view: a condition immunity reads "charmed", not "Name charmed"', T._plain([{ name: 'charmed' }]) === 'charmed' && T._plain({ index: 'x', name: 'Frightened', url: '/x' }) === 'Frightened' && /Darkvision/.test(T._plain({ darkvision: '60 ft.' })), T._plain([{ name: 'charmed' }]));
        if (state.combatants.length && !document.body.classList.contains('player-mode')){
          openPanel('turnview'); await sleep(300);
          if (innerWidth >= 1200) Object.assign(T._body.closest('.window').style, { left: '50px', top: '0px', width: (innerWidth - 80) + 'px', height: '700px' });
          T._render(); await sleep(80);
          const B = T._body, tr = B.querySelector('.tv-trait'), dl = B.querySelector('.tv-passive');
          ok('turn view: speed, senses and the rest are labelled rows, not one run-on line', !!dl && dl.tagName === 'DL' && dl.querySelectorAll('dt').length >= 2 && [...dl.querySelectorAll('dt')].some(d => /speed/i.test(d.textContent)), dl ? dl.textContent.slice(0, 80) : 'none');
          if (tr){
            const cs = getComputedStyle(tr), ch = parseFloat(cs.fontSize) * 0.55;
            ok('turn view: trait text is body-sized (≥13px) in body colour', parseFloat(cs.fontSize) >= 13 && cs.color === getComputedStyle(B.querySelector('.tv-actor-name')).color, cs.fontSize + ' ' + cs.color);
            ok('turn view: a trait line is a readable measure, not the window\'s width', tr.getBoundingClientRect().width <= parseFloat(cs.fontSize) * 0.62 * 80, Math.round(tr.getBoundingClientRect().width) + 'px');
            ok('turn view: each trait\'s name sits on its own line', getComputedStyle(tr.querySelector('b')).display === 'block');
          }
          closePanel('turnview');
        }
        if (innerWidth < 760 && matchMedia('(pointer: coarse)').matches && !document.body.classList.contains('player-mode')){
          openPanel('encounter'); await sleep(300);
          const head = document.querySelector('.window[data-panel="encounter"] .window-head'), tb = document.getElementById('float-toolbar');
          const h = head.getBoundingClientRect(), t = tb.getBoundingClientRect(), title = head.querySelector('.window-title').getBoundingClientRect();
          ok('phone: the tools sit inside the title bar, not hanging below it', t.top >= h.top - 1 && t.bottom <= h.bottom + 1, Math.round(t.top) + '–' + Math.round(t.bottom) + ' vs bar ' + Math.round(h.top) + '–' + Math.round(h.bottom));
          ok('phone: no floating pill (no shadow, no box of its own)', getComputedStyle(tb).boxShadow === 'none' && getComputedStyle(tb).backgroundColor === 'rgba(0, 0, 0, 0)');
          ok('phone: the window title ends before the tools start', title.right <= t.left + 1, Math.round(title.right) + ' vs ' + Math.round(t.left));
          closePanel('encounter');
        }
      } catch(e){ ok('round 61 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }
    // -- Round 62: the battle map's settings drawer stays where you scrolled it
    {
      const M = panelDefs.battlemap; let before = [];
      try {
        if (M && !document.body.classList.contains('player-mode')){
          openPanel('battlemap'); await sleep(400);
          M._settingsOpen = true; M._render(); await sleep(150);
          // The tiles that were on, to switch back afterwards.
          before = [...M._body.querySelectorAll('.bm-settings .bm-set-tile.active[data-bmset]')].map(t => t.dataset.bmset).filter(k => /^(fog-mode|fog-shape|grid-)/.test(k));
          const moved = [];
          for (const k of ['fog-mode-free', 'fog-shape-circle', 'grid-hex', 'grid-square', 'snap', 'snap', 'tok-names', 'tok-names']){
            const a = M._body.querySelector('.bm-settings'), btn = a && a.querySelector('[data-bmset="' + k + '"]'); if (!btn) continue;
            a.scrollTop = 0; a.scrollTop = Math.max(0, btn.getBoundingClientRect().top - a.getBoundingClientRect().top - 120); await sleep(20);
            const y = a.scrollTop; if (y < 20) continue;
            btn.click(); await sleep(80);
            const y2 = M._body.querySelector('.bm-settings').scrollTop;
            if (Math.abs(y2 - y) > 2) moved.push(k + ' ' + y + '→' + y2);
          }
          ok('battle map: choosing a setting leaves the drawer where it was scrolled', moved.length === 0, moved.join(', '));
          for (const k of before) M._body.querySelector('.bm-settings [data-bmset="' + k + '"]')?.click();
          M._settingsOpen = false; M._render(); closePanel('battlemap');
        }
      } catch(e){ ok('round 62 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
    }
    // -- Round 63: picking something deep in a list keeps your place (library, builder)
    {
      try {
        // Library: a chapter far down an adventure's contents
        const ad = panelDefs.adventures;
        if (ad && !document.body.classList.contains('player-mode')){
          openPanel('adventures'); await sleep(300);
          if (ad._loadIndex) await ad._loadIndex();
          const skt = (ad._adventures || []).find(a => /^skt$/i.test(a.id || '')) || (ad._adventures || [])[0];
          if (skt){
            await ad._loadAdventure(skt.id);
            ad._currentAdvId = skt.id; ad._currentChapterIdx = 0; ad._render(); await sleep(60);
            const w = ad._body.closest('.window'); if (innerWidth >= 760) Object.assign(w.style, { height: '320px' }); await sleep(60);
            let toc = ad._body.querySelector('.adv-toc-list'), chs = toc ? [...toc.querySelectorAll('.adv-chapter')] : [];
            if (toc && toc.scrollHeight > toc.clientHeight + 40 && chs.length > 4){
              // Scrolled so a chapter near the end sits at the bottom edge —
              // not at the very end, where every outcome looks the same.
              const pick = chs[chs.length - 3];
              toc.scrollTop = 0; toc.scrollTop = pick.getBoundingClientRect().top - toc.getBoundingClientRect().top - toc.clientHeight + pick.offsetHeight + 4; await sleep(20);
              const y = toc.scrollTop, ci = pick.dataset.ci, top = pick.getBoundingClientRect().top;
              pick.click(); await sleep(80);
              toc = ad._body.querySelector('.adv-toc-list');
              const on = toc.querySelector('.adv-chapter.active');
              ok('library: picking a chapter far down the contents leaves the list where it was', Math.abs(toc.scrollTop - y) <= 2 && on && on.dataset.ci === ci && Math.abs(on.getBoundingClientRect().top - top) <= 2, y + ' → ' + toc.scrollTop);
              // Reopening at that bookmarked chapter shows it in the list
              ad._render(); await sleep(40); toc = ad._body.querySelector('.adv-toc-list');
              const on2 = toc.querySelector('.adv-chapter.active'), tr = toc.getBoundingClientRect(), r2 = on2.getBoundingClientRect();
              ok('library: opening at a chapter far down the list brings it into view', r2.top >= tr.top - 1 && r2.bottom <= tr.bottom + 1, Math.round(r2.top) + ' in ' + Math.round(tr.top) + '–' + Math.round(tr.bottom));
            }
            ad._currentAdvId = null; ad._currentChapterIdx = 0; ad._render();
          }
          closePanel('adventures');
        }
        // Builder: the control you use stays put; a spell's text opens under it
        await openCharBuilder({}); for (let i = 0; i < 60 && !CB.R; i++) await sleep(100);
        CB.build.cls = 'Wizard'; CB.build.level = 5; cbQuickBuild();
        CB.step = 'spells'; cbRender(); await sleep(60);
        const main = () => document.querySelector('#cb-root .cb-main');
        const drift = [];
        for (const f of [0.5, 0.8, 0.3]){
          const m = main(), bs = [...m.querySelectorAll('[data-cb-spinfo]:not([data-cb-spinfo=""])')], b = bs[Math.floor(bs.length * f)];
          m.scrollTop = 0; m.scrollTop = b.getBoundingClientRect().top - m.getBoundingClientRect().top - m.clientHeight / 2; await sleep(20);
          const top = b.getBoundingClientRect().top, name = b.dataset.cbSpinfo, inList = b.dataset.cbSpin;
          b.click(); await sleep(60);
          const b2 = main().querySelector('[data-cb-spinfo="' + CSS.escape(name) + '"][data-cb-spin="' + CSS.escape(inList) + '"]');
          if (!b2 || Math.abs(b2.getBoundingClientRect().top - top) > 3) drift.push(name + ' moved ' + (b2 ? Math.round(b2.getBoundingClientRect().top - top) : 'gone'));
          const next = b2 && b2.closest('.cb-check').nextElementSibling;
          if (!next || !next.classList.contains('cb-spinfo')) drift.push(name + ': its text not under it');
        }
        ok('builder: a spell\'s "i" opens its text right under it, and the list doesn\'t move', drift.length === 0, drift.join(', '));
        // A spell checkbox deep in the list
        { const m = main(), cs = [...m.querySelectorAll('.cb-check input[type=checkbox]:not(:disabled)')], c = cs[Math.floor(cs.length * 0.7)];
          m.scrollTop = 0; m.scrollTop = c.getBoundingClientRect().top - m.getBoundingClientRect().top - m.clientHeight / 2; await sleep(20);
          const sel = cbAnchorSel(c), top = c.getBoundingClientRect().top;
          c.click(); await sleep(60);
          const c2 = main().querySelector(sel);
          ok('builder: ticking a spell deep in the list leaves it where it was on screen', c2 && Math.abs(c2.getBoundingClientRect().top - top) <= 3, c2 ? Math.round(c2.getBoundingClientRect().top - top) + 'px' : 'gone');
          c2 && c2.click(); }
        cbClose();
      } catch(e){ ok('round 63 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally { if (document.getElementById('cb-root') && typeof cbClose === 'function') cbClose(); }
    }
    // -- Round 67: two light weapons on one inventory line still give the off-hand attack
    {
      try {
        await openCharBuilder({}); for (let i = 0; i < 80 && !CB.R; i++) await sleep(100);
        CB.build.cls = 'Barbarian'; CB.build.level = 5; cbQuickBuild();
        const R = CB.R, b = JSON.parse(JSON.stringify(CB.build));
        cbClose();
        const names = bb => sktComputeCharacter(bb, R, null).sheet.attacks.map(a => a.name);
        const kit = names(b);
        const b2 = JSON.parse(JSON.stringify(b));
        b2.items = sktKitItems(b2, R, null); b2.equipment = Object.assign({}, b2.equipment, { materialized: true });
        const inv = names(b2);
        ok('off-hand: the kit\'s four handaxes give a Handaxe (off-hand) attack', kit.includes('Handaxe (off-hand)'), kit.join(', '));
        ok('off-hand: still there once the kit is an inventory ("Handaxe ×4" on one line)', inv.includes('Handaxe (off-hand)') && (b2.items.find(m => m.name === 'Handaxe') || {}).qty >= 2, inv.join(', '));
        const b3 = JSON.parse(JSON.stringify(b2)); b3.items = b3.items.map(m => m.name === 'Handaxe' ? Object.assign({}, m, { qty: 1 }) : m);
        ok('off-hand: and gone with only one light weapon left', !names(b3).includes('Handaxe (off-hand)'), names(b3).join(', '));
      } catch(e){ ok('round 67 ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
      finally { if (document.getElementById('cb-root') && typeof cbClose === 'function') cbClose(); }
    }
    // -- Round 68: stats sit in frames of their own, not plain boxes -------------
    {
      try {
        const framed = el => !!el && getComputedStyle(el).clipPath !== 'none' && getComputedStyle(el, '::before').content !== 'none';
        const shield = el => !!el && /50% 0/.test(getComputedStyle(el).clipPath.replace(/px/g, '')) || (!!el && /polygon\(0(px)? 7%|polygon\(0(px)? 8%/.test(getComputedStyle(el).clipPath));
        const pc = state.party.find(p => !p.foe);
        openCharSheet(pc.id); await sleep(200);
        const r = document.getElementById('cs-root');
        ok('frames: the sheet\'s ability scores, stat boxes and hit points are framed', framed(r.querySelector('.cs-ab')) && framed(r.querySelector('.cs-box')) && framed(r.querySelector('.cs-hp')));
        ok('frames: AC is a shield on the sheet', shield(r.querySelector('.cs-boxes > .cs-box:first-child')), getComputedStyle(r.querySelector('.cs-boxes > .cs-box:first-child')).clipPath.slice(0, 60));
        csClose();
        openPanel('party'); await sleep(250);
        const card = panelDefs.party._body.querySelector('.char-card');
        ok('frames: the party card\'s hit points and stats are framed, AC a shield', framed(card.querySelector('.char-hp-block')) && framed(card.querySelector('.char-stat')) && shield(card.querySelector('.char-stats-row > .char-stat:first-child')));
        closePanel('party');
        await openCharBuilder({}); for (let i = 0; i < 60 && !CB.R; i++) await sleep(100);
        ok('frames: the builder\'s summary boxes are framed', framed(document.querySelector('#cb-root .cb-big > div')));
        cbClose();
      } catch(e){ ok('round 68 ran to completion', false, e.message); }
      finally { if (typeof csClose === 'function' && CS) csClose(); if (document.getElementById('cb-root') && typeof cbClose === 'function') cbClose(); }
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

    // -- One undo history, the map included --------------------------------
    {
      _remoteUpdate = true;
      try { ['skt-combat-v1', 'skt-party-v1', 'skt-battlemap-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
      finally { _remoteUpdate = false; }
      loadDomain('combat'); loadDomain('party');
      closePanel('battlemap'); openPanel('battlemap'); await sleep(900);
      const bm = panelDefs.battlemap;
      try {
        const tok = bm._tokens.find(t => t.x != null);
        const x0 = tok.x;
        // A token move, then damage in the tracker: two entries, one history.
        tok.x = x0 + 50; bm._saveMap(); await sleep(30);
        const i = state.combatants.findIndex(c => !c.isPC);
        const hp0 = state.combatants[i].hp;
        sktUndoable('probe damage', () => { panelDefs.combat._applyHpDelta(i, -3); });
        await sleep(30);
        ok('undo: the map’s toolbar names what it would undo, even from elsewhere',
           /probe damage/.test((bm._body.querySelector('[data-mact="undo"]') || {}).title || ''),
           (bm._body.querySelector('[data-mact="undo"]') || {}).title);
        bm._body.querySelector('[data-mact="undo"]').click(); await sleep(40);
        ok('undo: the map’s Undo button undoes the last thing done (the damage)', state.combatants[i].hp === hp0);
        bm._body.querySelector('[data-mact="undo"]').click(); await sleep(60);
        const now = bm._tokens.find(t => t.id === tok.id);
        ok('undo: and the next press undoes the map move before it', !!now && Math.abs(now.x - x0) < 0.5, now && now.x);
        sktRedo(); await sleep(60);
        ok('undo: redo puts the move back', Math.abs(bm._tokens.find(t => t.id === tok.id).x - (x0 + 50)) < 0.5);
        // Someone else changes the map: an older map entry must not revert it.
        const t2 = bm._tokens.find(t => t.id === tok.id);
        t2.y = (t2.y || 0) + 40; bm._saveMap(); await sleep(30);
        bm._resetUndoBaseline();      // what a remote map update does
        const before = JSON.stringify(bm._tokens.map(t => [t.x, t.y]));
        const refused = sktUndo();
        ok('undo: a map change made stale by another device is refused, not reverted',
           refused === false && JSON.stringify(bm._tokens.map(t => [t.x, t.y])) === before);
      } catch(e){ ok('undo: the map checks ran to completion', false, e.message); }
      finally {
        closePanel('battlemap');
        _remoteUpdate = true;
        try { ['skt-combat-v1', 'skt-party-v1', 'skt-battlemap-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
        finally { _remoteUpdate = false; }
        loadDomain('combat'); loadDomain('party');
      }
    }

    // -- Bardic Inspiration, end to end -------------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      try {
        const P = panelDefs.party; openPanel('party'); await sleep(200);
        const bard = state.party.find(p => sktBardicPool(p));
        const other = state.party.find(p => p !== bard && !p.foe);
        ok('bardic: the fixture has a bard with uses to give', !!bard && !!other);
        if (!bard || !other) throw new Error('no bard on this bench — the rest of the checks need one');
        const bi = state.party.indexOf(bard), oi = state.party.indexOf(other);
        state.party[bi] = { ...bard, resources: bard.resources.map(r => r.name === 'Bardic Inspiration' ? { ...r, current: 2, max: 3 } : r) };
        state.party[oi] = { ...other, bardicInspiration: false };
        save(); P._render(); await sleep(60);
        const give = P._body.querySelector('[data-act="bardic-give"][data-idx="' + oi + '"]');
        ok('bardic: a party card offers to give one when there is a bard', !!give && !give.disabled);
        ok('bardic: but not on the bard’s own card', !P._body.querySelector('[data-act="bardic-give"][data-idx="' + bi + '"]'));
        give.click(); await sleep(80);
        const b2 = state.party.find(p => p.id === bard.id), o2 = state.party.find(p => p.id === other.id);
        ok('bardic: giving it spends one of the bard’s uses', sktBardicPool(b2).current === 1, sktBardicPool(b2).current);
        ok('bardic: and the recipient holds the bard’s die', typeof o2.bardicInspiration === 'string' && /^d\d+$/.test(o2.bardicInspiration)
           && o2.bardicFrom === bard.name, JSON.stringify({ d: o2.bardicInspiration, from: o2.bardicFrom }));
        P._render(); await sleep(40);
        P._body.querySelector('.status-badge.bardic[data-idx="' + oi + '"]').click(); await sleep(40);
        ok('bardic: tapping the badge when it is used clears it', !state.party[oi].bardicInspiration);
        state.party[bi] = { ...state.party[bi], resources: state.party[bi].resources.map(r => r.name === 'Bardic Inspiration' ? { ...r, current: 0 } : r) };
        save(); P._render(); await sleep(40);
        const dry = P._body.querySelector('[data-act="bardic-give"][data-idx="' + oi + '"]');
        ok('bardic: with no uses left the button says so', !!dry && dry.disabled);
        ok('bardic: and a grant is refused', /no Bardic Inspiration left/.test(sktGrantBardic(bard.id, other.id)));
        // No bard in the party at all: no button anywhere.
        state.party.forEach((p, k) => { if (sktBardicPool(p)) state.party[k] = { ...p, resources: p.resources.filter(r => r.name !== 'Bardic Inspiration') }; });
        save(); P._render(); await sleep(40);
        ok('bardic: without a bard, no card offers it', !P._body.querySelector('[data-act="bardic-give"]'));
      } catch(e){ ok('bardic: the checks ran to completion', false, e.message); }
      finally {
        document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party._render();
      }
    }

    // -- One way in to adding a character -----------------------------------
    {
      const p0 = localStorage.getItem('skt-party-v1');
      try {
        const P = panelDefs.party;
        openPanel('party'); await sleep(200);
        const items = P.menuItems().map(i => i.label);
        ok('add: one "＋ Add character", in the party header, and nothing else that adds one',
           !!P._body.querySelector('.party-head [data-act="party-add"]') && !items.some(l => /Add a character|Build a new character|Import PDF/.test(l)), items.join(' | '));
        P._addCharacter(); await sleep(40);
        const opts = [...document.querySelectorAll('#add-char-back [data-add]')].map(b => b.dataset.add);
        ok('add: it offers build, import and blank', ['build', 'pdf', 'blank'].every(k => opts.includes(k)), opts.join(','));
        const n0 = state.party.length;
        document.querySelector('#add-char-back [data-add="blank"]').click(); await sleep(60);
        ok('add: blank adds a card', state.party.length === n0 + 1 && !document.getElementById('add-char-back'));
        P._addCharacter({ foe: true }); await sleep(40);
        ok('add: a rival is never built with the player builder',
           !document.querySelector('#add-char-back [data-add="build"]') && !!document.querySelector('#add-char-back [data-add="pdf"]'));
        document.querySelector('#add-char-back [data-add="cancel"]').click();
        P._render(); await sleep(40);
        ok('add: the per-card rest button says it is a long rest', /Long rest/.test((P._body.querySelector('[data-act="hd-rest"]') || {}).textContent || ''));
      } catch(e){ ok('add: the checks ran to completion', false, e.message); }
      finally {
        document.getElementById('add-char-back')?.remove();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party'); panelDefs.party._render(); closePanel('party');
      }
    }

    // -- A player window on this laptop changes the party --------------------
    // Two tabs of one browser share localStorage; the other tab's write
    // arrives as a `storage` event. This window used to ignore it for the
    // party and the fight, so its next save wrote its stale copy back over
    // the player's change — hit dice spent on a short rest, gone.
    {
      const p0 = localStorage.getItem('skt-party-v1');
      try {
        const party = JSON.parse(p0);
        const i = party.findIndex(p => p && !p.foe);
        // Hit dice: HP would be put back from the combat card, which a real
        // player write updates alongside.
        party[i] = { ...party[i], hitDice: { ...(party[i].hitDice || { max: 5, dieType: 'd8' }), current: 1 } };
        const v = JSON.stringify(party);
        _remoteUpdate = true;
        try { localStorage.setItem('skt-party-v1', v); } finally { _remoteUpdate = false; }
        window.dispatchEvent(new StorageEvent('storage', { key: 'skt-party-v1', newValue: v }));
        await sleep(40);
        ok('relay: a party change from a player window on this laptop reaches this window', state.party[i].hitDice.current === 1, JSON.stringify(state.party[i].hitDice));
        save();
        ok('relay: and this window’s next save keeps it', JSON.parse(localStorage.getItem('skt-party-v1'))[i].hitDice.current === 1);
      } catch(e){ ok('relay: the checks ran to completion', false, e.message); }
      finally {
        _remoteUpdate = true;
        try { localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party');
      }
    }

    // -- "Ask the players to roll…": checks, and the party short rest -------
    {
      const r0 = localStorage.getItem('skt-rollreq-v1'), p0 = localStorage.getItem('skt-party-v1');
      try {
        const party = state.party.filter(p => !p.foe);
        sktOpenAskRoll({ kind: 'check' }); await sleep(60);
        const dlg = document.getElementById('rr-ask-back');
        ok('ask: one dialog asks for initiative, a save or a check',
           ['init', 'save', 'check'].every(k => !!dlg.querySelector('[data-rk="' + k + '"]')));
        const sk = dlg.querySelector('#rr-skill'); sk.value = 'perception'; sk.dispatchEvent(new Event('change', { bubbles: true }));
        ok('ask: picking a skill picks its ability', dlg.querySelector('#rr-ab').value === 'WIS');
        dlg.querySelector('#rr-dc').value = '14';
        dlg.querySelector('[data-rr-go="ask"]').click(); await sleep(60);
        const r = sktRollReq();
        ok('ask: a Perception check goes to every member of the party',
           !!r && r.kind === 'check' && r.skill === 'perception' && r.ab === 'WIS' && r.dc === 14 && r.pcs.length === party.length);
        ok('ask: the results card waits for them', /Perception check/.test((document.getElementById('rr-card') || {}).textContent || ''));
        r.answers[r.pcs[0]] = { v: 18, rid: r.id }; r.answers[r.pcs[1]] = { v: 9, rid: r.id };
        saveJson('skt-rollreq-v1', r, 'roll request'); sktOnRollAnswers(); await sleep(40);
        const card = document.getElementById('rr-card');
        ok('ask: answers show with whether they beat the DC',
           card.querySelectorAll('.rr-row.ok').length === 1 && /^18 /.test(card.querySelector('.rr-row.ok b').textContent)
           && card.querySelectorAll('.rr-row.bad').length === 1 && /^9 /.test(card.querySelector('.rr-row.bad b').textContent));
        card.querySelector('[data-rr="close"]').click(); await sleep(30);
        ok('ask: closing it ends the request and takes the card away', sktRollReq().closed === true && !document.getElementById('rr-card'));
        // The party short rest, on the same system.
        const P = panelDefs.party; openPanel('party'); await sleep(150);
        const a = state.party.findIndex(p => !p.foe && Array.isArray(p.resources));
        const b = state.party.findIndex((p, k) => k !== a && !p.foe);
        state.party[a] = { ...state.party[a], concentration: 'Bless' };
        state.party[b] = { ...state.party[b], concentration: 'Hex' };
        save();
        P._shortRestAll(); await sleep(50);
        const rr = sktRollReq();
        ok('rest: a party short rest asks every phone', rr.kind === 'rest' && rr.pcs.length === party.length);
        ok('rest: the card offers to finish it', !!document.querySelector('#rr-card [data-rr="finish"]'));
        // One player finished on their phone (which rested them there).
        P._shortRestOne(state.party[a], a); save();
        rr.answers[state.party[a].id] = { done: true, rid: rr.id };
        saveJson('skt-rollreq-v1', rr, 'roll request'); sktOnRollAnswers(); await sleep(30);
        ok('rest: a player who finished shows as done', /done/.test(document.getElementById('rr-card').textContent));
        document.querySelector('#rr-card [data-rr="finish"]').click(); await sleep(60);
        ok('rest: Finish rests everyone who hadn\u2019t, and closes it',
           !state.party[b].concentration && sktRollReq().closed === true && !document.getElementById('rr-card'));
      } catch(e){ ok('ask: the checks ran to completion', false, e.message); }
      finally {
        document.getElementById('rr-ask-back')?.remove(); document.getElementById('rr-card')?.remove();
        _remoteUpdate = true;
        try {
          if (r0 == null) localStorage.removeItem('skt-rollreq-v1'); else localStorage.setItem('skt-rollreq-v1', r0);
          if (p0 != null) localStorage.setItem('skt-party-v1', p0);
        } finally { _remoteUpdate = false; }
        loadDomain('party'); closePanel('party');
      }
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
      const r0 = localStorage.getItem('skt-rollreq-v1');
      _remoteUpdate = true;
      try { ['skt-combat-v1', 'skt-party-v1'].forEach(k => { if (snapshot[k] != null) localStorage.setItem(k, snapshot[k]); }); }
      finally { _remoteUpdate = false; }
      loadDomain('combat'); loadDomain('party');
      const C = panelDefs.combat; openPanel('combat'); await sleep(250); C._render();
      try {
        const btn = C._body.querySelector('[data-act="ask-init"]');
        ok('initiative: the tracker has an "ask the players" button', !!btn);
        btn.click(); await sleep(60);
        ok('initiative: it opens "Ask the players to roll", set to initiative', !!document.querySelector('#rr-ask-back [data-rk="init"].on'));
        document.querySelector('#rr-ask-back [data-rr-go="ask"]').click(); await sleep(60);
        const r = JSON.parse(localStorage.getItem('skt-rollreq-v1'));
        const pcs = state.combatants.filter(c => c.isPC && !c.dead).map(c => c.id);
        ok('initiative: asking lists every character in the fight', !!r && !r.closed && r.kind === 'init' && JSON.stringify(r.pcs) === JSON.stringify(pcs));
        ok('initiative: the results card shows nobody in yet', /0 of \d+/.test((document.querySelector('#rr-card') || {}).textContent || ''));
        const a = JSON.parse(localStorage.getItem('skt-rollreq-v1'));
        a.answers[pcs[0]] = { v: 19, rid: r.id }; a.answers[pcs[1]] = { v: 7, rid: r.id };
        a.answers[pcs[2]] = { v: 30, rid: 'ir_older' };   // a leftover answer to an earlier request
        _applyRemoteKey('skt-rollreq-v1', JSON.stringify(a)); await sleep(60);
        ok('initiative: answers fill the tracker and the card counts them (an old answer does not count)',
           /2 of \d+/.test(document.querySelector('#rr-card').textContent)
           && +state.combatants.find(c => c.id === pcs[0]).initiative === 19 && +state.combatants.find(c => c.id === pcs[1]).initiative === 7);
        const b2 = JSON.parse(localStorage.getItem('skt-rollreq-v1'));
        pcs.slice(2).forEach((id, i) => b2.answers[id] = { v: 12 + i, rid: r.id });
        let t = null; const st = window.showToast; window.showToast = (m, o) => { t = { m, action: !!(o && o.action) }; };
        _applyRemoteKey('skt-rollreq-v1', JSON.stringify(b2)); await sleep(60);
        window.showToast = st;
        ok('initiative: when everyone is in, the DM is told, with Sort to hand', !!t && /Everyone has rolled/.test(t.m) && t.action);
        document.querySelector('#rr-card [data-rr="sort"]').click(); await sleep(60);
        ok('initiative: Sort orders the fight and closes the request',
           state.combatants.every((c, i, arr) => i === 0 || +arr[i - 1].initiative >= +c.initiative)
           && JSON.parse(localStorage.getItem('skt-rollreq-v1')).closed === true && !document.querySelector('#rr-card'));
      } catch(e){ ok('initiative: the DM checks ran to completion', false, e.message); }
      finally {
        if (r0 == null) localStorage.removeItem('skt-rollreq-v1'); else localStorage.setItem('skt-rollreq-v1', r0);
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
        const nw = document.querySelector('.window[data-panel="notes"]');
        ok('handouts: they open inside Notes, as "Sent to players", with no window of their own',
           !document.querySelector('.dock-btn[data-panel="handouts"]') && !document.querySelector('.window[data-panel="handouts"]')
           && !!nw && !!H._body && nw.contains(H._body) && /Sent to players/.test(nw.textContent));
        const cv = document.createElement('canvas'); cv.width = 40; cv.height = 30;
        const img = cv.toDataURL('image/jpeg', 0.7);
        const id = H.send({ title: 'Test letter', text: 'line one\nline two', img, to: 'all' });
        const d = JSON.parse(localStorage.getItem('skt-handouts-v1') || '{}');
        ok('handouts: sending stores it for the phones', !!id && d.list && d.list[0].id === id && d.list[0].img === img && d.list[0].to === 'all');
        ok('handouts: and lists it', !!H._body.querySelector('.ho-item[data-id="' + id + '"]'));
        ok('handouts: sending to no one is refused', H.send({ title: 'x', to: [] }) === false);
        const t0 = d.list[0].shownAt; await sleep(15); H.showAgain(id);
        ok('handouts: "Show again" re-announces it', JSON.parse(localStorage.getItem('skt-handouts-v1')).list[0].shownAt > t0);
        // One "Send to players…": everyone, some, or one.
        const pcs = state.party.filter(p => !p.foe);
        ok('notes: every note has "📜 Send…"', /data-act="notes-send"/.test(panelDefs.notes._renderEditor({ name: 'x', content: '' })));
        const sent = panelDefs.notes._sendNote({ name: 'The innkeeper’s letter', content: 'Meet me at dawn.' }); await sleep(40);
        const dlg = document.getElementById('ho-send-back');
        ok('send: a note opens "Send to players", everyone ticked', !!dlg && /innkeeper/.test(dlg.textContent)
           && dlg.querySelector('#ho-send-all').checked && dlg.querySelectorAll('.ho-send-pc:checked').length === pcs.length);
        const all = dlg.querySelector('#ho-send-all'); all.checked = false; all.dispatchEvent(new Event('change'));
        const one = dlg.querySelector('.ho-send-pc[value="' + pcs[1].id + '"]'); one.checked = true; one.dispatchEvent(new Event('change'));
        dlg.querySelector('[data-ho-send="go"]').click();
        const sid = await sent;
        const top = JSON.parse(localStorage.getItem('skt-handouts-v1')).list[0];
        ok('send: to one player, with the note’s text', !!sid && top.id === sid && JSON.stringify(top.to) === JSON.stringify([pcs[1].id])
           && top.text === 'Meet me at dawn.' && /innkeeper/.test(top.title));
        H._body.querySelector('[data-ho="send"]') && (H._draft.title = 'Map', H._render());
        H._body.querySelector('[data-ho="send"]').click(); await sleep(30);
        ok('send: the composer uses the same dialog', !!document.getElementById('ho-send-back'));
        document.querySelector('#ho-send-back [data-ho-send="cancel"]').click(); await sleep(20);
        ok('send: Cancel sends nothing', !document.getElementById('ho-send-back')
           && JSON.parse(localStorage.getItem('skt-handouts-v1')).list[0].id === sid);
        const ml = sktMigrateLayout({ handouts: { x: 7, y: 8, w: 500, h: 600, open: true, z: 4 } });
        ok('layout: a saved layout with Handouts open opens Notes on "Sent to players"',
           ml.notes && ml.notes.open && ml.notes.sent === true && ml.notes.x === 7 && !('handouts' in ml), JSON.stringify(ml));
        panelDefs.notes.showSent(false); await sleep(60);
        ok('notes: "← Notes" goes back and lets the handouts go', !H._body && !panelDefs.notes._sent);
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

    // ── The full sheet on a phone: what the builder adds ──────────────────
    if (typeof paSheetDetail === 'function'){
      try {
        const html = paSheetDetail({ id: 'x', name: 'X', gold: 12, hitDice: null, resources: [],
          sheet: { size: 'Small', spells: ['Shield'], spellbook: ['Shield', 'Sleep'],
                   details: { alignment: 'Chaotic Good', backstory: 'Line one\nline <two>' } } });
        ok('phone sheet: size, alignment and gold', /Small/.test(html) && /Chaotic Good/.test(html) && /12 gp/.test(html));
        ok('phone sheet: the rest of the spellbook, not what is already prepared', /Also in the spellbook/.test(html) && /pa-chip dim">Sleep/.test(html) && !/pa-chip dim">Shield/.test(html));
        ok('phone sheet: the backstory, line breaks kept and escaped', /Line one<br>line &lt;two&gt;/.test(html));
        ok('phone sheet: nothing extra for a character without them', !/About|spellbook| gp/.test(paSheetDetail({ id: 'y', name: 'Y', resources: [], sheet: {} })));
      } catch(e){ ok('phone sheet: the checks ran', false, e.message); }
    }

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

      // ── A lowered maximum HP, on the player's own sheet ───────────────────
      {
        const me0 = localStorage.getItem('skt-me-v1'), tab0 = paTab;
        const pi = (state.party || []).findIndex(p => p.hpMax > 10);
        const p0 = pi >= 0 ? JSON.parse(JSON.stringify(state.party[pi])) : null;
        try {
          if (p0){
            state.party[pi] = sktReduceMaxHp(state.party[pi], 6, 'Life Drain');
            if (typeof syncPartyToCombat === 'function') syncPartyToCombat(pi);
            paSetPc(p0.id); paTab = 'you'; paRender(); await sleep(60);
            const line = document.querySelector('#pa-screen #cs-root .cs-hp-loss');
            ok('player: a lowered max HP is explained on their sheet',
               !!line && /lowered by 6/.test(line.textContent) && /long rest/.test(line.textContent) && /Life Drain/.test(line.textContent));
            ok('player: and the bar shows the part that was taken', !!document.querySelector('#pa-screen #cs-root .cs-hpbar .cs-hp-lost'));
          }
        } catch(e){ ok('player: the max HP checks ran to completion', false, e.message); }
        finally {
          if (p0){ state.party[pi] = p0; if (typeof syncPartyToCombat === 'function') syncPartyToCombat(pi); }
          paTab = tab0; if (me0 == null) localStorage.removeItem('skt-me-v1'); else localStorage.setItem('skt-me-v1', me0);
          paRender();
        }
      }
      // ── The player's own bookkeeping, on their sheet ──────────────────────
      {
        const p0 = localStorage.getItem('skt-party-v1'), me0 = localStorage.getItem('skt-me-v1'), tab0 = paTab;
        const q = sel => document.querySelector('#pa-screen #cs-root ' + sel), qa = sel => [...document.querySelectorAll('#pa-screen #cs-root ' + sel)];
        try {
          const i = state.party.findIndex(p => p.sheet && p.sheet.spellSlots && Object.keys(p.sheet.spellSlots).length && (p.resources || []).length);
          if (i >= 0){
            state.party[i] = { ...state.party[i], exhaustion: 2, hp: Math.max(1, (state.party[i].hpMax || 20) - 15), concentration: null,
              hitDice: { current: 3, max: 6, dieType: 'd8' } };
            save();
            paSetPc(state.party[i].id); paTab = 'you'; paRender(); await sleep(60);
            const P = () => state.party[i];
            q('[data-cs-tab="actions"]').click(); await sleep(30);
            const r0 = P().resources[0].current;
            const lit = qa('[data-cs-res^="0:"].on').pop();
            ok('player: a resource pip is a button', !!lit && lit.tagName === 'BUTTON');
            lit && lit.click(); await sleep(20);
            ok('player: tapping a lit pip spends one, and only one', P().resources[0].current === r0 - 1, P().resources[0].current + ' vs ' + r0);
            q('[data-cs-res="0:' + (r0 - 1) + '"]').click(); await sleep(20);
            ok('player: tapping an empty pip gives one back', P().resources[0].current === r0);
            q('[data-cs-tab="spells"]').click(); await sleep(30);
            const lvl = Object.keys(P().sheet.spellSlots).find(k => (P().sheet.spellSlots[k].total || 0) > (P().sheet.spellSlots[k].expended || 0));
            const e0 = P().sheet.spellSlots[lvl].expended || 0, left = P().sheet.spellSlots[lvl].total - e0;
            q('[data-cs-slot="' + lvl + ':' + (left - 1) + '"]').click(); await sleep(20);
            ok('player: tapping a spell slot spends it', (P().sheet.spellSlots[lvl].expended || 0) === e0 + 1);
            q('[data-cs-slot="' + lvl + ':' + (left - 1) + '"]').click(); await sleep(20);
            ok('player: and tapping it again gets it back', (P().sheet.spellSlots[lvl].expended || 0) === e0);
            q('[data-cs="short"]').click(); await sleep(20);
            const hp0 = P().hp;
            q('[data-cs="restdie"]').click(); await sleep(20);
            ok('player: a short rest spends a hit die and heals', P().hitDice.current === 2 && P().hp > hp0);
            state.party[i] = { ...P(), concentration: 'Bless', resources: [...P().resources, { name: 'Probe (short rest)', current: 0, max: 1, recharge: 'short' }] };
            q('[data-cs="restdone"]').click(); await sleep(30);
            const pr = P().resources.find(x => x.name === 'Probe (short rest)');
            ok('player: finishing it refreshes short-rest resources and ends concentration', !!pr && pr.current === 1 && !P().concentration && !q('.cs-rest'));
            state.party[i] = { ...P(), concentration: 'Hex' }; save(); paRender(); await sleep(20);
            ok('player: concentration shows on their sheet', /Hex/.test((q('.cs-state') || {}).textContent || ''));
            q('[data-cs="dropconc"]').click(); await sleep(20);
            ok('player: and can be dropped', !P().concentration);
            const ex = q('[data-cs-condinfo="Exhaustion"]');
            ok('player: exhaustion shows, and is a button', !!ex && /2/.test((q('.cs-exh') || {}).textContent || ''));
            ex && ex.click(); await sleep(20);
            ok('player: and tapping it explains it', /Level 2 of 6/.test((q('.cs-conddet') || {}).textContent || ''));
          }
        } catch(e){ ok('player: the bookkeeping checks ran to completion', false, e.message); }
        finally {
          if (CS) CS.condOpen = null;
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
        const q = sel => document.querySelector('#pa-screen #cs-root ' + sel), qa = sel => [...document.querySelectorAll('#pa-screen #cs-root ' + sel)];
        try {
          if (paMyIdx() < 0 && state.party.length) paSetPc(state.party[0].id);
          const mi = paMyIdx();
          if (mi >= 0){
            state.party[mi] = { ...state.party[mi], hp: Math.max(10, Math.round((state.party[mi].hpMax || 20) / 2)) };
            save();
            paTab = 'you'; paRender(); await sleep(120);
            const hp = () => { const c = paCombatant(); return c ? c.hp : paPc().hp; };
            const before = hp();
            q('[data-cs-amt]').value = '6';
            q('[data-cs-hp="-1"]').click(); await sleep(80);
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

      // -- The phone between fights: damage, temp HP, death saves, rests -------
      {
        const p0 = localStorage.getItem('skt-party-v1'), tab0 = paTab;
        const stub = { pc: window.paCombatant, find: window._findCombatantForPartyMember, d: window.sktD, conf: window.showConfirm };
        const q = sel => document.querySelector('#pa-screen #cs-root ' + sel), qa = sel => [...document.querySelectorAll('#pa-screen #cs-root ' + sel)];
        try {
          if (paMyIdx() < 0 && state.party.length) paSetPc(state.party[0].id);
          const mi = paMyIdx();
          window.paCombatant = () => null; window._findCombatantForPartyMember = () => -1;
          const me = () => state.party[paMyIdx()];
          const set = (o) => { state.party[mi] = { ...state.party[mi], ...o }; save(); paTab = 'you'; paRender(); };
          const hit = (n, sign, type) => {
            q('[data-cs-amt]').value = String(n);
            const sel = q('[data-cs-dtype]'); if (sel){ sel.value = type || ''; sel.dispatchEvent(new Event('change', { bubbles: true })); }
            q('[data-cs-hp="' + sign + '"]').click();
          };
          set({ hp: 20, hpMax: 30, tempHp: 5, resistances: ['fire'], deathSaves: undefined, stable: undefined, dead: undefined });
          await sleep(60);
          hit(7, -1); await sleep(60);
          ok('phone: out of a fight, temporary hit points soak damage first', me().tempHp === 0 && me().hp === 18, JSON.stringify({ t: me().tempHp, hp: me().hp }));
          hit(10, -1, 'fire'); await sleep(60);
          ok('phone: and a resistance halves it', me().hp === 13, me().hp);
          q('[data-cs-amt]').value = '8'; q('[data-cs-hp="temp"]').click(); await sleep(40);
          q('[data-cs-amt]').value = '3'; q('[data-cs-hp="temp"]').click(); await sleep(40);
          ok('phone: temporary hit points can be set, and the higher stays', me().tempHp === 8, me().tempHp);
          set({ hp: 2, tempHp: 0 }); await sleep(40);
          hit(5, -1); await sleep(60);
          ok('phone: dropping to 0 between fights starts death saves', me().hp === 0 && JSON.stringify(me().deathSaves) === '{"success":0,"fail":0}' && !!q('[data-cs="death"]'));
          window.sktD = () => 15;
          q('[data-cs="death"]').click(); await sleep(60);
          ok('phone: and they can be rolled', (me().deathSaves || {}).success === 1);
          hit(3, -1); await sleep(60);
          ok('phone: a hit at 0 is a failed save', (me().deathSaves || {}).fail === 1);
          q('[data-cs="death"]').click(); await sleep(40);
          q('[data-cs="death"]').click(); await sleep(60);
          ok('phone: three successes and they are stable', me().stable === true && !me().deathSaves && /Stable/.test((q('.cs-death') || {}).textContent || ''));
          hit(4, 1); await sleep(60);
          ok('phone: healing ends it all', me().hp === 4 && !me().stable && !me().deathSaves);
          set({ hp: 0, deathSaves: { success: 0, fail: 0 } }); window.sktD = () => 1;
          q('[data-cs="death"]').click(); await sleep(40);
          q('[data-cs="death"]').click(); await sleep(60);
          ok('phone: a natural 1 counts twice; three failures and they are dead', me().dead === true && /Dead/.test((q('.cs-death') || {}).textContent || ''));
          set({ hp: 0, dead: undefined, deathSaves: { success: 0, fail: 0 } }); window.sktD = () => 20;
          q('[data-cs="death"]').click(); await sleep(60);
          ok('phone: a natural 20 wakes them at 1 HP', me().hp === 1 && !me().deathSaves);
          // Heroic Inspiration.
          set({ inspiration: true }); await sleep(40);
          ok('phone: Heroic Inspiration shows', !!q('[data-cs="insp"].on'));
          q('[data-cs="insp"]').click(); await sleep(40);
          ok('phone: and can be spent', me().inspiration === false && !q('[data-cs="insp"].on'));
          // Long rest.
          set({ hp: 3, tempHp: 4, exhaustion: 2 });
          window.showConfirm = () => Promise.resolve(true);
          q('[data-cs="long"]').click(); await sleep(80);
          ok('phone: a long rest from the phone', me().hp === me().hpMax && me().tempHp === 0 && me().exhaustion === 1);
          set({ hp: 0, dead: true });
          q('[data-cs="long"]').click(); await sleep(80);
          ok('phone: a long rest does not raise the dead', me().hp === 0 && me().dead === true);
        } catch(e){ ok('phone: the between-fights checks ran to completion', false, e.message); }
        finally {
          window.paCombatant = stub.pc; window._findCombatantForPartyMember = stub.find; window.sktD = stub.d; window.showConfirm = stub.conf;
          if (p0 != null){
            _remoteUpdate = true;
            try { localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
            loadDomain('party');
          }
          paTab = tab0; paRender();
        }
      }

      // -- The sheet's attack buttons: every damage term, and the roll is kept ----
      {
        const p0 = localStorage.getItem('skt-party-v1'), tab0 = paTab, d0 = window.sktD;
        const q = sel => document.querySelector('#pa-screen #cs-root ' + sel), qa = sel => [...document.querySelectorAll('#pa-screen #cs-root ' + sel)];
        try {
          if (paMyIdx() < 0 && state.party.length) paSetPc(state.party[0].id);
          const mi = paMyIdx();
          state.party[mi] = { ...state.party[mi], sheet: { ...(state.party[mi].sheet || {}), attacks: [{ name: 'Flame Blade', atkBonus: '+5', damage: '2d6+1d4+3 fire' }] }, rolls: [] };
          save(); paTab = 'you'; paRender(); await sleep(60);
          q('[data-cs-tab="actions"]').click(); await sleep(30);
          window.sktD = () => 4;
          q('[data-cs-dmg="0"]').click(); await sleep(40);
          ok('phone: a weapon\'s damage rolls every term, on the roll card', /\b15\b/.test((document.querySelector('#pa-roll .pa-roll-dmg') || {}).textContent || ''), (document.querySelector('#pa-roll') || {}).textContent);
          ok('phone: and the roll is kept for the DM to see', (state.party[mi].rolls || [])[0] && /Flame Blade/.test(state.party[mi].rolls[0].label) && state.party[mi].rolls[0].from === 'player');
        } catch(e){ ok('phone: the attack checks ran to completion', false, e.message); }
        finally {
          window.sktD = d0; paHideRoll();
          if (p0 != null){ _remoteUpdate = true; try { localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; } loadDomain('party'); }
          paTab = tab0; paRender();
        }
      }

      // -- The player's turn on their sheet: the turn card and the roll card ---
      {
        const p0 = localStorage.getItem('skt-party-v1'), tab0 = paTab, d0 = window.sktD;
        const cb0 = JSON.stringify(state.combatants || []), act0 = state.activeCombatantId, sh0 = state.sharedPanels;
        const q = sel => document.querySelector('#pa-screen #cs-root ' + sel), qa = sel => [...document.querySelectorAll('#pa-screen #cs-root ' + sel)];
        try {
          if (paMyIdx() < 0 && state.party.length) paSetPc(state.party[0].id);
          const mi = paMyIdx(), me = () => state.party[mi];
          state.party[mi] = { ...me(), concentration: null, rolls: [],
            sheet: { ...(me().sheet || {}), attacks: [{ name: 'Mace', atkBonus: '+4', damage: '1d6+2 bludgeoning' }],
                     spells: ['Healing Word', 'Bless', 'Sacred Flame'], spellSlots: { 1: { total: 2, expended: 0 } }, spellSaveDc: 13, spellAtkBonus: '+5', profBonus: 2 } };
          state.sharedPanels = [...new Set([...(state.sharedPanels || []), 'combat'])];
          state.combatants = [{ id: me().id, name: me().name, isPC: true, hp: me().hp, hpMax: me().hpMax, initiative: 15, conditions: [] },
                              { id: 'ogre_t', name: 'Ogre', hp: 59, hpMax: 59, initiative: 8, conditions: [] }];
          state.activeCombatantId = me().id;
          save(); paTab = 'you'; paRender(); paHideTurnBanner(); await sleep(60);
          const econ = q('.pa-econ.mine');
          ok('phone: on your turn, Action / Bonus / Reaction on your sheet', !!econ && econ.querySelectorAll('[data-pa-econ]').length === 3);
          window.sktD = () => 4;
          q('[data-cs-tab="actions"]').click(); await sleep(30);
          q('[data-cs-atk="0"]').click(); await sleep(40);
          const card = document.getElementById('pa-roll'), tabs = document.getElementById('pa-tabs');
          ok('phone: a roll from the sheet lands on the card above the tab bar', !!card.querySelector('.pa-roll-hit') && !document.getElementById('pa-screen').contains(card)
             && getComputedStyle(card).position === 'fixed' && card.getBoundingClientRect().bottom <= tabs.getBoundingClientRect().top + 1,
             Math.round(card.getBoundingClientRect().bottom) + ' vs tabs ' + Math.round(tabs.getBoundingClientRect().top));
          paRender(); await sleep(20);
          ok('phone: and a redraw (a sync, an HP change) doesn\'t wipe it', !!document.querySelector('#pa-roll .pa-roll-hit'));
          ok('phone: attacking marks the Action used', state.combatants[0].actionUsed === true && !!q('[data-pa-econ="actionUsed"].used'));
          document.querySelector('#pa-roll').click(); await sleep(20);
          ok('phone: tapping the card puts it away', !document.querySelector('#pa-roll .pa-roll-in'));
          q('[data-cs-tab="spells"]').click(); await sleep(30);
          for (let i = 0; i < 80 && !q('[data-cs-cast^="Healing Word:"]'); i++){ await sleep(120); csRender(); }
          q('[data-cs-cast="Healing Word:1"]').click(); await sleep(40);
          ok('phone: casting from the sheet spends the slot', me().sheet.spellSlots[1].expended === 1);
          ok('phone: and a bonus-action spell marks the bonus action', state.combatants[0].bonusUsed === true);
          sktUndo(); await sleep(40);
          ok('phone: Undo gives the slot back', state.party[mi].sheet.spellSlots[1].expended === 0);
          q('[data-cs-cast^="Bless:"]').click(); await sleep(40);
          ok('phone: casting a concentration spell starts concentrating on it', me().concentration === 'Bless');
          state.activeCombatantId = 'ogre_t'; paRender(); paHideTurnBanner(); await sleep(20);
          const off = q('.pa-econ');
          ok('phone: off your turn, only the reaction', !!off && !off.classList.contains('mine') && off.querySelectorAll('[data-pa-econ]').length === 1);
          q('[data-pa-econ="reactionUsed"]').click(); await sleep(20);
          ok('phone: and tapping it marks it used', state.combatants[0].reactionUsed === true);
        } catch(e){ ok('phone: the turn checks ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
        finally {
          window.sktD = d0; paHideRoll();
          state.combatants = JSON.parse(cb0); state.activeCombatantId = act0; state.sharedPanels = sh0;
          if (p0 != null){ _remoteUpdate = true; try { localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; } loadDomain('party'); }
          save(); paTab = tab0; paRender(); paHideTurnBanner();
        }
      }

      // -- Arcane Recovery on the sheet: the player picks the slots -----------
      {
        const p0 = localStorage.getItem('skt-party-v1'), me0 = localStorage.getItem('skt-me-v1'), tab0 = paTab;
        const q = sel => document.querySelector('#pa-screen #cs-root ' + sel), qa = sel => [...document.querySelectorAll('#pa-screen #cs-root ' + sel)];
        try {
          let saved = null;
          await openCharBuilder({ onDone: r => { saved = r; } });
          for (let i = 0; i < 80 && !CB.R; i++) await sleep(100);
          CB.build.cls = 'Wizard'; CB.build.level = 5; CB.build.name = 'Recovering Wizard'; cbQuickBuild(); cbSave(); await sleep(80);
          if (document.getElementById('cb-root')) cbClose();
          const id = (saved || state.party.find(p => p.name === 'Recovering Wizard')).id, pi = () => state.party.findIndex(p => p.id === id), me = () => state.party[pi()];
          const sl = JSON.parse(JSON.stringify(me().sheet.spellSlots)); sl[1].expended = 3; sl[2].expended = 2; sl[3].expended = 1;
          state.party[pi()] = { ...me(), sheet: { ...me().sheet, spellSlots: sl } }; save();
          paSetPc(id); paTab = 'you'; paRender(); await sleep(60);
          q('[data-cs-tab="spells"]').click(); await sleep(30);
          q('[data-cs="recover"]').click(); await sleep(30);
          const n = l => +((q('[data-cs-recstep="' + l + ':1"]') || {}).previousElementSibling || {}).textContent;
          ok('recovery: the sheet lists the spent slots, 5th level or lower', [1, 2, 3].every(l => q('[data-cs-recstep="' + l + ':1"]')));
          ok('recovery: it starts on the highest-first pick (a 3rd for a level-5 wizard)', n(3) === 1 && n(1) === 0 && n(2) === 0, [n(1), n(2), n(3)].join(','));
          ok('recovery: nothing more fits the 3-level budget', [1, 2, 3].every(l => q('[data-cs-recstep="' + l + ':1"]').disabled));
          q('[data-cs-recstep="3:-1"]').click(); await sleep(20);
          q('[data-cs-recstep="1:1"]').click(); await sleep(20);
          q('[data-cs-recstep="2:1"]').click(); await sleep(20);
          ok('recovery: the player picks a 2nd and a 1st instead', n(1) === 1 && n(2) === 1 && n(3) === 0 && q('[data-cs-recstep="1:1"]').disabled, [n(1), n(2), n(3)].join(','));
          const b = q('[data-cs-recstep="1:1"]'); b.disabled = false; b.click(); await sleep(10);
          ok('recovery: and the budget holds even past the button', n(1) === 1);
          q('[data-cs="recgo"]').click(); await sleep(40);
          const s = me().sheet.spellSlots;
          ok('recovery: exactly those come back, and the use is spent', s[1].expended === 2 && s[2].expended === 1 && s[3].expended === 1
             && (me().resources.find(r => r.name === 'Arcane Recovery') || {}).current === 0, [s[1].expended, s[2].expended, s[3].expended].join(','));
          ok('recovery: the card says what came back', /3\s*levels back/.test(document.getElementById('pa-roll').textContent) && /2nd level, 1st level/.test(document.getElementById('pa-roll').textContent));
          sktUndo(); await sleep(40);
          ok('recovery: Undo puts it all back', me().sheet.spellSlots[1].expended === 3 && (me().resources.find(r => r.name === 'Arcane Recovery') || {}).current === 1);
          state.party[pi()] = { ...me(), resources: me().resources.map(r => r.name === 'Arcane Recovery' ? { ...r, current: 0 } : r) }; save(); paRender(); await sleep(30);
          ok('recovery: once used, it isn\'t offered', !q('[data-cs="recover"]'));
        } catch(e){ ok('recovery checks ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
        finally {
          if (CS) CS.recPick = null; paHideRoll();
          if (document.getElementById('cb-root') && typeof cbClose === 'function') cbClose();
          if (p0 != null){ _remoteUpdate = true; try { localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; } loadDomain('party'); }
          if (me0 == null) localStorage.removeItem('skt-me-v1'); else localStorage.setItem('skt-me-v1', me0);
          paTab = tab0; paRender();
        }
      }

      // -- A campaign night on the phone, every class ------------------------
      // A level-5 character of each class, made in the builder, picked on the
      // phone and played on their own sheet: checks and saves (the number on
      // the button is the number rolled), every attack and damage, every
      // feature, a cantrip, a slot spell, concentration and the save when hit,
      // the turn card, going down and a death save, a short and a long rest,
      // the map, the party, level up.
      if (paIsPhone()){
        const p0 = localStorage.getItem('skt-party-v1'), me0 = localStorage.getItem('skt-me-v1'), tab0 = paTab, d0 = window.sktD, conf0 = window.showConfirm;
        const cb0 = JSON.stringify(state.combatants || []), act0 = state.activeCombatantId, sh0 = state.sharedPanels;
        const B0 = localStorage.getItem('skt-battlemap-v1');
        const errs = [], onErr = e => errs.push((e.message || '') + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno);
        window.addEventListener('error', onErr);
        const q = sel => document.querySelector('#pa-screen #cs-root ' + sel), qa = sel => [...document.querySelectorAll('#pa-screen #cs-root ' + sel)];
        try {
          window.showConfirm = () => Promise.resolve(true);
          const closeModals = () => { document.querySelectorAll('.modal-back, #pa-rest, #pa-roll-req, #pa-conc-save').forEach(m => m.remove()); };
          const card = () => (document.querySelector('#pa-roll') || {}).textContent || '';
          state.sharedPanels = [...new Set([...(state.sharedPanels || []), 'combat', 'battlemap', 'party'])];
          const R = await sktRulesLoad('2024');
          const classes = R.classes.filter(c => c.core !== false).map(c => c.name);
          ok('campaign night: all twelve classes to play', classes.length >= 12, classes.join(', '));
          for (const cls of classes){
            const bad = [];
            const note = (cond, msg) => { if (!cond) bad.push(msg); };
            try {
              let saved = null;
              await openCharBuilder({ onDone: rec => { saved = rec; } });
              for (let i = 0; i < 80 && !CB.R; i++) await sleep(100);
              CB.build.cls = cls; CB.build.level = 5; CB.build.name = 'Test ' + cls; cbQuickBuild();
              cbSave(); await sleep(80);
              if (document.getElementById('cb-root')) cbClose();
              saved = saved || state.party.find(p => p.name === 'Test ' + cls);
              if (!saved){ bad.push('BUILD FAILED'); throw new Error('no character'); }
              const id = saved.id, pc = () => state.party.find(p => p.id === id);
              paSetPc(id); paTab = 'you'; paRender(); await sleep(80);
              for (let i = 0; i < 60 && !(CS && CS.R); i++) await sleep(100);
              note(CS && CS.embed && CS.id === id && (q('.cs-head') || {}).textContent.includes('Test ' + cls), 'their sheet is not the You tab');
              note(/\d/.test((q('.cs-hp-n') || {}).textContent || ''), 'no HP');
              // Checks and saves
              q('[data-cs-tab="abilities"]').click(); await sleep(20);
              window.sktD = () => 10;
              for (const k of ['save:dex', 'save:wis', 'skill:perception', 'skill:stealth', 'ab:str']){
                const b = q('[data-cs-roll="' + k + '"]'); if (!b){ bad.push('no button for ' + k); continue; }
                const shown = parseInt((b.querySelector('b') || b).textContent, 10);
                b.click(); await sleep(20);
                const tot = parseInt(((document.querySelector('#pa-roll .pa-roll-hit') || {}).textContent || ''), 10);
                if (tot !== 10 + shown && !/advantage|disadvantage|exhaustion|Bless|Reliable/i.test(card())) bad.push(k + ': button says ' + shown + ' but rolled ' + tot + ' on a 10');
              }
              // Attacks and damage
              q('[data-cs-tab="actions"]').click(); await sleep(20);
              for (const i of qa('[data-cs-atk]').map(x => x.dataset.csAtk)){ q('[data-cs-atk="' + i + '"]').click(); await sleep(10); if (!document.querySelector('#pa-roll .pa-roll-hit')) bad.push('attack ' + i + ' rolled nothing'); }
              for (const i of qa('[data-cs-dmg]').map(x => x.dataset.csDmg)){ q('[data-cs-dmg="' + i + '"]').click(); await sleep(10); if (!document.querySelector('#pa-roll .pa-roll-dmg')) bad.push('damage ' + i + ' rolled nothing'); }
              // Features
              for (const nm of [...new Set(qa('[data-cs-use]:not([disabled])').map(x => x.dataset.csUse))]){
                const a = (pc().sheet.activations || []).find(x => x.name === nm), r = a && (pc().resources || []).find(x => x.name === a.resource), before = r ? r.current : null;
                const b = q('[data-cs-use="' + CSS.escape(nm) + '"]:not([disabled])'); if (!b) continue;
                b.click(); await sleep(20); closeModals();
                const r2 = a && (pc().resources || []).find(x => x.name === a.resource);
                if (r && nm !== 'Bardic Inspiration' && r2 && r2.current !== Math.max(0, before - (a.amount || 1))) bad.push(nm + ' did not spend (' + before + '→' + r2.current + ')');
              }
              (pc().resources || []).forEach((r, i) => { if ((r.max || 0) > 0 && r.type !== 'toggle' && !q('[data-cs-res^="' + i + ':"]')) bad.push(r.name + ' has uses but no pips'); });
              // Spells
              if ((pc().sheet.spells || []).length){
                q('[data-cs-tab="spells"]').click(); await sleep(30);
                const casts = qa('[data-cs-cast]').map(x => x.dataset.csCast);
                note(casts.length > 0, 'a caster with nothing to cast');
                const can = casts.find(v => /:0$/.test(v));
                if (can){ q('[data-cs-cast="' + CSS.escape(can) + '"]').click(); await sleep(20); }
                const lv = casts.find(v => /:[1-9]$/.test(v));
                if (lv){
                  const l = lv.slice(-1), e0 = (pc().sheet.spellSlots[l] || {}).expended || 0;
                  q('[data-cs-cast="' + CSS.escape(lv) + '"]').click(); await sleep(30);
                  if (((pc().sheet.spellSlots[l] || {}).expended || 0) !== e0 + 1) bad.push('casting ' + lv + ' did not spend a slot');
                  sktUndo(); await sleep(20);
                }
                const concName = (pc().sheet.spells || []).find(n => { const sp = csSpell(n); return sp && sp.concentration; });
                if (concName){ const b = q('[data-cs-cast^="' + CSS.escape(concName) + ':"]'); if (b){ b.click(); await sleep(30); if (pc().concentration !== concName) bad.push('casting ' + concName + ' did not start concentration'); } }
              }
              paHideRoll();
              // Into a fight; my turn
              state.combatants = [{ id, name: pc().name, isPC: true, hp: pc().hp, hpMax: pc().hpMax, initiative: 15, conditions: [] },
                                  { id: 'ogre_pt', name: 'Ogre', hp: 59, hpMax: 59, initiative: 8, conditions: [] }];
              state.activeCombatantId = id; save(); paRender(); paHideTurnBanner(); await sleep(30);
              note(!!q('.pa-econ.mine'), 'no turn card on my turn');
              q('[data-cs-tab="actions"]').click(); await sleep(20);
              const a0 = q('[data-cs-atk]'); if (a0){ a0.click(); await sleep(20); note(state.combatants[0].actionUsed === true, 'attacking did not use the action'); }
              // Hit while concentrating
              if (pc().concentration){
                q('[data-cs-amt]').value = String(Math.max(1, Math.min(12, (state.combatants[0].hp || 2) - 1))); q('[data-cs-hp="-1"]').click(); await sleep(40);
                const ov = document.getElementById('pa-conc-save');
                note(!q('.cs-conc'), 'the sheet asked for the concentration save as well');
                if (!ov) bad.push('no concentration save after damage');
                else { const cc = pc().concCheck, mod = paSaveMod(pc(), 'con') + (+(pc().sheet || {}).concBonus || 0), made = 1 + mod >= cc.dc;
                  window.sktD = () => 1; ov.querySelector('[data-pa-cs="roll"]').click(); await sleep(30);
                  if (!!pc().concentration !== made) bad.push('a 1 + ' + mod + ' vs DC ' + cc.dc + ' should have ' + (made ? 'kept' : 'lost') + ' it');
                  if (!(made ? /holds/ : /ends/).test(ov.textContent)) bad.push('concentration result not shown'); closeModals(); window.sktD = () => 10; }
              }
              // Down: death saves
              q('[data-cs-amt]').value = String((state.combatants[0].hp || 0) + 2); q('[data-cs-hp="-1"]').click(); await sleep(40);
              const death = q('[data-cs="death"]');
              note(!!death, 'at 0 HP: no death save button');
              if (death){ death.click(); await sleep(30); note(/Death save/.test(card()), 'death save not on the card'); }
              // End the fight; rests
              state.combatants = []; state.activeCombatantId = null; save(); paRender(); await sleep(30);
              const pi = state.party.findIndex(p => p.id === id);
              state.party[pi] = Object.assign({}, state.party[pi], { hp: Math.max(1, Math.floor(state.party[pi].hpMax / 2)) }); save(); paRender(); await sleep(20);
              q('[data-cs="short"]').click(); await sleep(20); note(!!q('.cs-rest'), 'short rest did not open'); q('[data-cs="restcancel"]') && q('[data-cs="restcancel"]').click(); await sleep(20);
              q('[data-cs="long"]').click(); await sleep(60);
              note(pc().hp === pc().hpMax, 'long rest did not restore HP (' + pc().hp + '/' + pc().hpMax + ')');
              Object.entries(pc().sheet.spellSlots || {}).forEach(([l, sv]) => { if (sv.expended) bad.push('long rest left level ' + l + ' slots spent'); });
              (pc().resources || []).forEach(r => { if (r.current < r.max) bad.push('long rest left ' + r.name + ' at ' + r.current + '/' + r.max); });
              // Map: a token for me
              const B = panelDefs.battlemap;
              paTab = 'map'; paRender(); await sleep(200);
              B._tokens = (B._tokens || []).concat([{ id: 'tk_' + id, cid: id, label: pc().name, x: 225, y: 225, isPC: true, size: 1, color: '#446688' }]);
              B._render(); await sleep(300);
              note(!!document.querySelector('[data-pa-me]'), 'no Me button on the map');
              note(!!document.querySelector('.map-token[data-tid="tk_' + id + '"]'), 'my token not drawn');
              paTab = 'party'; paRender(); await sleep(30);
              note(document.getElementById('pa-screen').textContent.includes('Test ' + cls), 'not on the Party tab');
              paTab = 'you'; paRender(); await sleep(30);
              const lu = q('[data-cs="levelup"]');
              note(!!lu && !lu.disabled === (pc().level < 20), 'level-up button wrong for level ' + pc().level);
              const featNames = ((pc().sheet || {}).featureList || []).filter(f => f.from === 'feat' || /^(Alert|Tough|Lucky|Skilled|Savage Attacker|Magic Initiate)$/.test(f.name)).map(f => f.name);
              const dup = featNames.filter((n, i) => featNames.indexOf(n) !== i && !/Magic Initiate|Skilled/.test(n));
              note(!dup.length, 'the same feat twice: ' + dup.join(', '));
            } catch(e){ if (e.message !== 'no character') bad.push('THREW ' + e.message + ' ' + (e.stack || '').split('\n')[1]); }
            closeModals(); paHideRoll();
            ok('campaign night: a level-5 ' + cls + ' plays through on their sheet', !bad.length, bad.join(' ;; '));
          }
          ok('campaign night: no script errors all evening', !errs.length, [...new Set(errs)].slice(0, 4).join(' | '));
        } catch(e){ ok('campaign night ran to completion', false, e.message + ' ' + (e.stack || '').split('\n')[1]); }
        finally {
          window.removeEventListener('error', onErr);
          window.sktD = d0; window.showConfirm = conf0; paHideRoll();
          document.querySelectorAll('#pa-rest, #pa-roll-req, #pa-conc-save').forEach(m => m.remove());
          if (document.getElementById('cb-root') && typeof cbClose === 'function') cbClose();
          if (B0 != null){ _remoteUpdate = true; try { localStorage.setItem('skt-battlemap-v1', B0); } finally { _remoteUpdate = false; }
            if (panelDefs.battlemap) panelDefs.battlemap._tokens = (JSON.parse(B0).tokens || []); }
          state.combatants = JSON.parse(cb0); state.activeCombatantId = act0; state.sharedPanels = sh0;
          if (p0 != null){ _remoteUpdate = true; try { localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; } loadDomain('party'); }
          if (me0 == null) localStorage.removeItem('skt-me-v1'); else localStorage.setItem('skt-me-v1', me0);
          save(); paTab = tab0; paRender(); paHideTurnBanner();
        }
      }

      // -- The sheet reads a PDF character's skills; the map follows you -------
      ok('sheet: a PDF character\'s Animal Handling and Sleight of Hand are its own, not the bare ability',
         csSkillVal({ skills: { animalHandling: 4, sleightOfHand: 7 } }, 'animal_handling') === 4 && csSkillVal({ skills: { sleight_of_hand: 2 } }, 'sleight_of_hand') === 2 && csSkillVal({ skills: {} }, 'stealth') == null);
      if (paIsPhone() && panelDefs.battlemap){
        const B = panelDefs.battlemap, bm0 = localStorage.getItem('skt-battlemap-v1'), vs0 = B._viewScale, tab0 = paTab, sh0 = state.sharedPanels;
        try {
          if (paMyIdx() < 0 && state.party.length) paSetPc(state.party[0].id);
          const me = state.party[paMyIdx()];
          state.sharedPanels = [...new Set([...(state.sharedPanels || []), 'battlemap'])];
          paTab = 'map'; paRender(); await sleep(200);
          B._tokens = (B._tokens || []).filter(t => t.cid !== me.id).concat([{ id: 'tk_follow', cid: me.id, label: me.name, x: 125, y: 125, isPC: true, size: 1, color: '#446688' }]);
          B._viewScale = 3; B._render(); await sleep(350);
          const off = () => { const el = document.querySelector('.map-token[data-tid="tk_follow"]'), sc = document.querySelector('#pa-screen #map-scroll');
            if (!el || !sc) return 999; const r = el.getBoundingClientRect(), s = sc.getBoundingClientRect();
            return Math.round(Math.hypot(r.left + r.width / 2 - s.left - s.width / 2, r.top + r.height / 2 - s.top - s.height / 2)); };
          ok('map: a Me button once your token is on the map', !!document.querySelector('[data-pa-me]'));
          document.querySelector('#pa-screen #map-scroll').scrollTo(0, 0); await sleep(30);
          document.querySelector('[data-pa-me]').click(); await sleep(450);
          ok('map: Me centres your token', off() <= 30, off() + 'px off');
          document.querySelector('#pa-screen #map-scroll').scrollTo(0, 0); await sleep(30);
          const t = B._tokens.find(x => x.id === 'tk_follow'); t.x += 200; t.y += 150; B._render(); await sleep(700);
          ok('map: and follows it when it moves', off() <= 30, off() + 'px off');
        } catch(e){ ok('map follow ran to completion', false, e.message); }
        finally {
          B._viewScale = vs0; state.sharedPanels = sh0; paTab = tab0; paRender();
          if (bm0 != null){ _remoteUpdate = true; try { localStorage.setItem('skt-battlemap-v1', bm0); } finally { _remoteUpdate = false; } B._tokens = JSON.parse(bm0).tokens || []; }
        }
      }

      // -- The character sheet is the player's home screen --------------------
      {
        const tab0 = paTab;
        try {
          if (paMyIdx() < 0 && state.party.length) paSetPc(state.party[0].id);
          paTab = 'you'; paRender(); await sleep(80);
          const root = document.querySelector('#pa-screen #cs-root');
          ok('phone: the You tab is the player\'s own sheet, open and editable', !!root && CS && CS.embed && CS.id === paPc().id && !CS.readOnly && !!root.querySelector('[data-cs-hp="-1"]'));
          ok('phone: with nothing to close', !!root && !root.querySelector('[data-cs="close"]'));
          const w = root.getBoundingClientRect().width, sw = root.scrollWidth;
          ok('phone: it fits the screen', sw <= Math.ceil(w) + 1, sw + ' > ' + w);
          ok('phone: Change character is on the sheet', !!root.querySelector('[data-pa-swap]'));
          if (paIsPhone()){ paTab = 'more'; paRender(); await sleep(30); ok('phone: and in More', !!document.querySelector('#pa-screen [data-pa-swap]')); paTab = 'you'; paRender(); await sleep(40); }
          // A sync while they type: the number and the focus stay.
          const amt = document.querySelector('#pa-screen #cs-root [data-cs-amt]');
          amt.focus(); amt.value = '17'; paRender(); await sleep(20);
          const amt2 = document.querySelector('#pa-screen #cs-root [data-cs-amt]');
          ok('phone: a redraw while typing keeps the number and the focus', amt2 === document.activeElement && amt2.value === '17');
          amt2.blur(); await sleep(40);
          const other = sktPlayerParty().find(p => p.id !== paPc().id);
          if (other){
            paOpenMates.add(other.id); paTab = 'party'; paRender(); await sleep(60);
            const mb = document.querySelector('[data-pa-sheet="' + other.id + '"]');
            ok('phone: a party-mate\'s card offers the whole sheet', !!mb);
            if (mb){ mb.click(); await sleep(100); } else openCharSheet(other.id);
            await sleep(100);
            ok('phone: a party-mate\'s sheet opens read-only', CS.readOnly && !document.querySelector('#cs-root [data-cs-hp]') && !document.querySelector('#cs-root [data-cs="long"]'));
            csClose(); await sleep(30);
            // Over the You tab (as Level up / Edit do), and closed with no redraw
            // asked for: the player's own sheet comes back by itself.
            paTab = 'you'; paRender(); await sleep(40);
            openCharSheet(other.id); await sleep(40);
            csClose(); await sleep(80);
            ok('phone: and afterwards their own sheet is back', !!(CS && CS.embed && CS.id === paPc().id && document.querySelector('#pa-screen #cs-root')));
          }
        } catch(e){ ok('phone: the sheet checks ran to completion', false, e.message); }
        finally { paTab = tab0; paRender(); }
      }

      // -- The builder and the sheet fit a phone, every step and tab -----------
      {
        const wide = [];
        try {
          await openCharBuilder({ edition: '2024' }); await sleep(400);
          const r = document.getElementById('cb-root');
          r.querySelector('[data-cb="quick"]') && r.querySelector('[data-cb="quick"]').click(); await sleep(60);
          for (const st of cbVisibleSteps().map(x => x.id)){
            CB.step = st; cbRender(); await sleep(30);
            const main = r.querySelector('.cb-main') || r;
            if (r.scrollWidth > r.clientWidth + 1 || main.scrollWidth > main.clientWidth + 1) wide.push('builder:' + st + ' ' + main.scrollWidth + '>' + main.clientWidth);
          }
          cbClose();
          if (paMyIdx() < 0 && state.party.length) paSetPc(state.party[0].id);
          openCharSheet(paPc().id); await sleep(300);
          const root = document.getElementById('cs-root');
          for (const t of CS_TABS.map(x => x.id)){
            CS.tab = t; csRender(); await sleep(20);
            const main = root.querySelector('.cs-main');
            if (root.scrollWidth > root.clientWidth + 1 || (main && main.scrollWidth > main.clientWidth + 1)) wide.push('sheet:' + t + ' ' + (main ? main.scrollWidth + '>' + main.clientWidth : ''));
          }
          csClose();
        } catch(e){ wide.push('error: ' + e.message); }
        finally { document.getElementById('cb-root')?.remove(); CB = null; if (typeof csClose === 'function') csClose(); }
        if (paIsPhone && paIsPhone()) ok('phone: every builder step and sheet tab fits the screen', !wide.length, wide.join(' | '));
      }

      // -- "Make a DEX save" on this phone ----------------------------------
      {
        const req0 = localStorage.getItem('skt-rollreq-v1');
        try {
          const me = paMe().pcId || (state.party[0] || {}).id;
          if (!paMe().pcId) paSetPc(me);
          const ask = (o) => {
            localStorage.setItem('skt-rollreq-v1', JSON.stringify(Object.assign({
              id: 'sr_t' + Math.random().toString(36).slice(2, 7), askedAt: Date.now(),
              kind: 'save', ab: 'DEX', dc: 15, showDc: true, name: 'Fireball', pcs: [me], answers: {}, closed: false,
            }, o || {})));
            paOnSaveRequest();
          };
          ask(); await sleep(80);
          const card = () => document.getElementById('pa-roll-req');
          ok('player: a save the DM called for pops up', !!card());
          ok('player: it names the ability and this character’s bonus',
             /Dexterity saving throw/.test(card().textContent)
             && /bonus/.test(card().textContent), card().textContent.slice(0, 60));
          ok('player: and the number to beat, when the DM says so',
             /beat/.test(card().textContent) && /15/.test(card().textContent));
          card().querySelector('[data-pa-rr="roll"]').click(); await sleep(50);
          const line = card().querySelector('#pa-rr-dice').textContent;
          ok('player: rolling shows the dice and whether it made it',
             /d20 \(\d+\)/.test(line) && /(made it|missed it)/.test(line), line);
          const typed = parseInt(card().querySelector('#pa-rr-val').value, 10);
          card().querySelector('[data-pa-rr="send"]').click(); await sleep(80);
          const r = JSON.parse(localStorage.getItem('skt-rollreq-v1'));
          ok('player: sending files the total under this character',
             r.answers[me] && r.answers[me].v === typed && r.answers[me].rid === r.id);
          ok('player: and the pop-up goes away', !document.getElementById('pa-roll-req'));
          // A table that keeps the DC to itself.
          ask({ showDc: false }); await sleep(80);
          ok('player: with the DC kept back, it just asks for the roll',
             !!card() && !/beat/.test(card().textContent));
          card().querySelector('[data-pa-rr="dis"]').click(); await sleep(50);
          ok('player: disadvantage keeps the lower of two',
             /2d20 \((\d+), (\d+)\) keep/.test(card().querySelector('#pa-rr-dice').textContent),
             card().querySelector('#pa-rr-dice').textContent);
          ok('player: and says nothing about making it',
             !/(made it|missed it)/.test(card().querySelector('#pa-rr-dice').textContent));
          // Somebody else's save is none of this phone's business.
          ask({ pcs: ['not-this-character'] }); await sleep(80);
          ok('player: a save asked of another character does not pop up here', !card());
          // Neither is one the DM has already closed.
          ask({ closed: true }); await sleep(60);
          ok('player: nor one the DM has closed', !card());
        } catch(e){ ok('player: the saving-throw checks ran to completion', false, e.message); }
        finally {
          document.getElementById('pa-roll-req')?.remove();
          _remoteUpdate = true;
          try { if (req0 == null) localStorage.removeItem('skt-rollreq-v1'); else localStorage.setItem('skt-rollreq-v1', req0); }
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
        const req0 = localStorage.getItem('skt-rollreq-v1'), ho0 = localStorage.getItem('skt-handouts-v1');
        try {
          const me = paMe().pcId || (state.party[0] || {}).id;
          if (!paMe().pcId) paSetPc(me);
          document.getElementById('pa-roll-req')?.remove();
          const v = JSON.stringify({ id: 'sr_relay', askedAt: Date.now(), kind: 'save', ab: 'WIS', dc: 13, showDc: true,
                                     name: '', pcs: [me], answers: {}, closed: false });
          localStorage.setItem('skt-rollreq-v1', v);
          window.dispatchEvent(new StorageEvent('storage', { key: 'skt-rollreq-v1', newValue: v }));
          await sleep(60);
          ok('player: a save asked from another tab pops up here', !!document.getElementById('pa-roll-req'));
          document.getElementById('pa-roll-req')?.remove();
          const h = JSON.stringify({ list: [{ id: 'w_relay', title: 'A word from the DM', text: 'Psst.', img: null,
                                              to: [me], ts: Date.now(), shownAt: Date.now(), whisper: true }] });
          localStorage.setItem('skt-handouts-v1', h);
          window.dispatchEvent(new StorageEvent('storage', { key: 'skt-handouts-v1', newValue: h }));
          await sleep(80);
          ok('player: so does a whisper', !!document.getElementById('pa-handout')
             && /Psst/.test(document.getElementById('pa-handout').textContent));
        } catch(e){ ok('player: the same-laptop relay checks ran to completion', false, e.message); }
        finally {
          document.getElementById('pa-roll-req')?.remove();
          document.getElementById('pa-handout')?.remove();
          _remoteUpdate = true;
          try {
            if (req0 == null) localStorage.removeItem('skt-rollreq-v1'); else localStorage.setItem('skt-rollreq-v1', req0);
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
          ok('player: with a Level up button on its own sheet', !!document.querySelector('#pa-screen #cs-root [data-cs="levelup"]'));
          ok('player: its actions come from the builder, not from parsed text',
             Array.isArray(pc.sheet.activations) && pc.sheet.activations.every((a, i) => paActivations(pc)[i] === a));
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

      // -- The same weapon twice is one row ---------------------------------
      {
        const p0 = localStorage.getItem('skt-party-v1');
        try {
          const me = paMe().pcId || (state.party[0] || {}).id;
          if (!paMe().pcId) paSetPc(me);
          const pc = state.party.find(p => p.id === me);
          pc.sheet = pc.sheet || {};
          pc.sheet.attacks = [{ name: 'Dagger', atkBonus: '+5', damage: '1d4+2 piercing' },
                              { name: 'Dagger', atkBonus: '+5', damage: '1d4+2 piercing' },
                              { name: 'Shortbow', atkBonus: '+5', damage: '1d6+2 piercing' }];
          paTab = 'you'; paRender(); await sleep(150);
          document.querySelector('#pa-screen #cs-root [data-cs-tab="actions"]').click(); await sleep(30);
          const rows = [...document.querySelectorAll('#pa-screen #cs-root .cs-atks')][0] ? [...document.querySelectorAll('#pa-screen #cs-root .cs-atks')][0].querySelectorAll('.cs-atk:not(.cs-atk-h) > b') : [];
          const rowsT = [...rows].map(e => e.textContent.replace(/\s+/g, ' ').trim());
          ok('player: two identical daggers are one row, ×2', rowsT.length === 2 && rowsT[0] === 'Dagger ×2' && rowsT[1] === 'Shortbow', JSON.stringify(rowsT));
        } catch(e){ ok('player: the weapon-row check ran to completion', false, e.message); }
        finally {
          _remoteUpdate = true;
          try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
          loadDomain('party'); paRender();
        }
      }

      // -- A check and a short rest, from the DM, on this phone ----------------
      {
        const r0 = localStorage.getItem('skt-rollreq-v1');
        try {
          const me = paMe().pcId || (state.party[0] || {}).id;
          if (!paMe().pcId) paSetPc(me);
          const ask = o => { localStorage.setItem('skt-rollreq-v1', JSON.stringify(Object.assign({ id: 'rr_' + Math.random().toString(36).slice(2, 7),
            askedAt: Date.now(), pcs: [me], answers: {}, closed: false }, o))); paOnRollRequest(); };
          ask({ kind: 'check', ab: 'WIS', skill: 'perception', dc: 12, showDc: false }); await sleep(60);
          const ov = document.getElementById('pa-roll-req');
          ok('player: a Perception check pops up by name', !!ov && /Perception check/.test(ov.textContent), ov && ov.textContent.slice(0, 60));
          const pc = state.party.find(p => p.id === me);
          const want = pc.sheet && pc.sheet.skills && typeof pc.sheet.skills.perception === 'number' ? pc.sheet.skills.perception : null;
          ok('player: with the character\u2019s own Perception bonus', want == null || new RegExp('bonus ' + (want >= 0 ? '\\+' : '') + want).test(ov.textContent));
          ov.remove();
          ask({ kind: 'rest' }); await sleep(80);
          const rest = document.getElementById('pa-rest');
          ok('player: a short rest from the DM opens the hit-dice screen', !!rest && !document.getElementById('pa-roll-req'));
          if (rest) rest.querySelector('[data-rest="finish"]').click(); await sleep(60);
          const r = sktRollReq();
          ok('player: finishing it tells the DM this character is done', !!r.answers[me] && r.answers[me].done === true && r.answers[me].rid === r.id);
        } catch(e){ ok('player: the check and rest checks ran to completion', false, e.message); }
        finally {
          document.getElementById('pa-roll-req')?.remove(); document.getElementById('pa-rest')?.remove();
          _remoteUpdate = true;
          try { if (r0 == null) localStorage.removeItem('skt-rollreq-v1'); else localStorage.setItem('skt-rollreq-v1', r0); }
          finally { _remoteUpdate = false; }
        }
      }

      // ── "Roll initiative!" on this phone ──────────────────────────────────
      {
        const r0 = localStorage.getItem('skt-rollreq-v1'), me0 = localStorage.getItem('skt-me-v1'), tab0 = paTab;
        try {
          const pc = (state.combatants || []).find(c => c.isPC && state.party.some(p => p.id === c.id));
          const other = (state.party || []).find(p => !pc || p.id !== pc.id);
          if (pc && other){
            paSetPc(pc.id); paTab = 'you'; paRender();
            _applyRemoteKey('skt-rollreq-v1', JSON.stringify({ id: 'ir_t', askedAt: Date.now(), kind: 'init', pcs: [pc.id], answers: {}, closed: false })); await sleep(50);
            const ov = document.getElementById('pa-roll-req');
            ok('player: asked for initiative, the phone pops it up with the bonus', !!ov && /bonus/.test(ov.textContent));
            ov.querySelector('[data-pa-rr="roll"]').click(); await sleep(15);
            const v = parseInt(document.getElementById('pa-rr-val').value, 10), bonus = paInitBonus(pc.id);
            ok('player: "Roll for me" rolls d20 plus the bonus', v >= 1 + bonus && v <= 20 + bonus, v + ' / ' + bonus);
            const val = document.getElementById('pa-rr-val'); val.value = '17'; val.dispatchEvent(new Event('input'));
            ov.querySelector('[data-pa-rr="send"]').click(); await sleep(40);
            const after = JSON.parse(localStorage.getItem('skt-rollreq-v1'));
            ok('player: sending answers the request and sets the combatant',
               after.answers[pc.id] && after.answers[pc.id].v === 17 && after.answers[pc.id].rid === 'ir_t'
               && +state.combatants.find(c => c.id === pc.id).initiative === 17 && !document.getElementById('pa-roll-req'));
            _applyRemoteKey('skt-rollreq-v1', JSON.stringify(after) + ' '); await sleep(30);
            ok('player: and it does not come back once answered', !document.getElementById('pa-roll-req'));
            paSetPc(other.id);
            _applyRemoteKey('skt-rollreq-v1', JSON.stringify({ id: 'ir_t2', askedAt: Date.now(), kind: 'init', pcs: [pc.id], answers: {}, closed: false })); await sleep(30);
            ok('player: a character not in the fight gets no pop-up', !document.getElementById('pa-roll-req'));
            paSetPc(pc.id);
            _applyRemoteKey('skt-rollreq-v1', JSON.stringify({ id: 'ir_t3', askedAt: Date.now(), kind: 'init', pcs: [pc.id], answers: {}, closed: false })); await sleep(30);
            const up = !!document.getElementById('pa-roll-req');
            _applyRemoteKey('skt-rollreq-v1', JSON.stringify({ id: 'ir_t3', askedAt: Date.now(), kind: 'init', pcs: [pc.id], answers: {}, closed: true })); await sleep(30);
            ok('player: the DM closing the request takes the pop-up down', up && !document.getElementById('pa-roll-req'));
          }
        } catch(e){ ok('player: the initiative checks ran to completion', false, e.message); }
        finally {
          document.getElementById('pa-roll-req')?.remove();
          if (r0 == null) localStorage.removeItem('skt-rollreq-v1'); else localStorage.setItem('skt-rollreq-v1', r0);
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
            ok('player: no Handouts tab — it is in Notes now', !paVisibleTabs().some(t => t.id === 'handouts'));
            pop && pop.querySelector('.pa-ho-close').click(); await sleep(20);
            _applyRemoteKey('skt-handouts-v1', payload + ' '); await sleep(40);
            ok('player: and does not pop up again once closed', !document.getElementById('pa-handout'));
            paTab = 'notes'; paRender(); await sleep(300);
            const chips = [...document.querySelectorAll('[data-player-note^="ho:"]')].map(b => b.textContent);
            ok('player: Notes lists theirs under "From the DM", not anyone else’s',
               /From the DM/.test(document.getElementById('pa-screen').textContent)
               && chips.some(t => /For everyone/.test(t)) && chips.some(t => /Last week/.test(t)) && !chips.some(t => /Not yours/.test(t)), JSON.stringify(chips));
            document.querySelector('[data-player-note="ho:ho_t1"]').click(); await sleep(60);
            ok('player: opening one shows it', /a\s*b/.test((document.querySelector('.notes-ho') || {}).textContent || ''));
            document.querySelector('.notes-ho') && document.querySelector('[data-pa-ho="ho_t1"]').click(); await sleep(30);
            ok('player: "Show it big" pops it up again', !!document.getElementById('pa-handout'));
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
            paSetPc(cc.id); paTab = 'you'; paRender(); await sleep(60);
            const chip = document.querySelector('#pa-screen #cs-root .cs-state [data-cs-condinfo]');
            ok('player: a condition on their sheet is a button', !!chip && chip.tagName === 'BUTTON');
            chip && chip.click(); await sleep(80);
            const det = document.querySelector('#pa-screen #cs-root .cs-conddet');
            ok('player: tapping it shows the rule text',
               !!det && det.textContent.replace(/\s+/g, ' ').length > 80, det ? det.textContent.slice(0, 80) : 'nothing opened');
            document.querySelector('#pa-screen #cs-root .cs-conddet [data-cs-condinfo]')?.click(); await sleep(50);
            ok('player: and ✕ closes it', !document.querySelector('#pa-screen #cs-root .cs-conddet'));
            const pc = state.party.find(p => p.id === cc.id);
            if (pc && pc.sheet && pc.sheet.spellSlots && Object.keys(pc.sheet.spellSlots).length){
              document.querySelector('#pa-screen #cs-root [data-cs-tab="spells"]').click(); await sleep(30);
              ok('player: spell slots sit on the Spells tab, with the spells', !!document.querySelector('#pa-screen #cs-root [data-cs-slot]'));
            }
          }
        } catch(e){
          ok('player: the condition checks ran to completion', false, e.message);
        } finally {
          paCondOpen = null; if (CS) CS.condOpen = null; paTab = tab0;
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
          const open = d.items.find(i => i.id === 'n_open'); if (open) open.shared = [other.id];
          localStorage.setItem('skt-notes-v2', JSON.stringify(d));
          state.sharedPanels = ['party'];                 // the Notes PANEL is not shared — it no longer matters
          ok('pnotes: every player has a Notes tab, shared or not',
             paVisibleTabs().some(t => t.id === 'notes'));
          paTab = 'notes'; paRender(); await sleep(350);
          if (N._body){ N._data = null; N.mount(N._body); await sleep(150); }
          ok('pnotes: another player’s notes are not shown', !/ZZ Other Player Note/.test(txt()));
          ok('pnotes: a DM note kept in ANOTHER player\u2019s Notes is not shown here',
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

          // Kept in this player's Notes too: it shows, with no other switch.
          { const d2 = JSON.parse(localStorage.getItem('skt-notes-v2') || '{"items":[]}');
            const o2 = d2.items.find(i => i.id === 'n_open'); if (o2) o2.shared = [other.id, me.id];
            localStorage.setItem('skt-notes-v2', JSON.stringify(d2)); }
          N._data = null; N.mount(N._body); await sleep(200);
          const chip = [...N._body.querySelectorAll('[data-player-note]')].find(b => /Session 21/.test(b.textContent));
          ok('pnotes: a DM note kept in this player\u2019s Notes is listed — no Notes window share needed', !!chip);
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

    // World: the time and the weather, one tab. Shared like any other panel,
    // and read-only here: the controls are hidden by CSS and realtime.js
    // refuses to push either key from a player device, so a phone cannot
    // rewind the table’s clock.
    if (typeof paTab !== 'undefined' && typeof paRender === 'function'){
      const S0 = (state.sharedPanels || []).slice(), tab0 = paTab;
      state.sharedPanels = []; saveSharedPanels(); paRender(); await sleep(250);
      const shut = [...document.querySelectorAll('[data-pa-tab]')].map(b => b.dataset.paTab);
      ok('player: the world tab is hidden until shared', shut.indexOf('world') < 0, JSON.stringify(shut));

      // A DM still sharing the old Time panel gets the World tab, once.
      state.sharedPanels = ['time', 'weather']; saveSharedPanels();
      paRender(); await sleep(250);
      const open = [...document.querySelectorAll('[data-pa-tab]')].map(b => b.dataset.paTab);
      ok('player: sharing the old Time or Weather shows one World tab',
         open.filter(t => t === 'world').length === 1 && open.indexOf('time') < 0 && open.indexOf('sky') < 0, JSON.stringify(open));

      for (const t of ['world']){
        const before = errs.length;
        paTab = t; paRender(); await sleep(550);
        const screen = document.getElementById('pa-screen');
        const text = (screen && screen.textContent || '').replace(/\s+/g, ' ').trim();
        ok('player: the ' + t + ' tab shows something', text.length > 20, String(text.length));
        ok('player: the world tab has the date and the weather',
           !!document.querySelector('.pa-mount [data-world-part="time"] *') && !!document.querySelector('.pa-mount [data-world-part="weather"] *'));
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

    // ── The character sheet's header: one slim row and a ⋯ menu ─────────────
    {
      const p0 = localStorage.getItem('skt-party-v1');
      try {
        const R = await sktRulesLoad('2024');
        const rec = sktComputeCharacter(Object.assign(sktBlankBuild('2024'), { name: 'Phoney', cls: 'Cleric', level: 5 }), R);
        rec.id = 'pc_phone_head'; state.party.push(rec); save();
        openCharSheet('pc_phone_head'); await sleep(300);
        const q = s => document.querySelector('#cs-root ' + s);
        const head = q('.cs-head');
        ok('mobile: the sheet header is one slim row', head.offsetHeight <= 64 && getComputedStyle(q('.cs-headbtns')).display === 'none', head.offsetHeight + 'px');
        ok('mobile: with the name, a ⋯ menu and close', !!q('.cs-headmore') && q('.cs-headmore').getBoundingClientRect().width > 30 && !!q('.cb-x'));
        q('.cs-headmore').click(); await sleep(30);
        const m = q('.cs-headmenu');
        ok('mobile: the menu holds every header action', !!m && ['short', 'long', 'levelup', 'edit', 'customize', 'print', 'export', 'copytext'].every(k => m.querySelector('[data-cs="' + k + '"]'))
           && m.getBoundingClientRect().right <= innerWidth && m.getBoundingClientRect().left >= 0);
        ok('mobile: its choices are big enough to tap', [...m.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 44));
        m.querySelector('[data-cs="customize"]').click(); await sleep(40);
        ok('mobile: a choice does its job and closes the menu', !q('.cs-headmenu') && !!CS.customize);
        q('.cs-headmore').click(); await sleep(20); q('.cs-hp, .cs-boxes').click(); await sleep(30);
        ok('mobile: a tap elsewhere closes it', !q('.cs-headmenu'));
        csClose();
      } catch(e){ ok('mobile: the sheet header checks ran', false, e.message); }
      finally {
        if (typeof csClose === 'function') csClose();
        _remoteUpdate = true;
        try { if (p0 != null) localStorage.setItem('skt-party-v1', p0); } finally { _remoteUpdate = false; }
        loadDomain('party');
      }
    }

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
