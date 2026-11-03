#!/usr/bin/env node
// A whole fight over the LIVE Firebase: the DM and five phones, one per
// character, playing three rounds the way a table does. Each player drags
// their own token with a finger on their turn; the DM moves the monsters,
// applies the damage both ways and presses Next; other phones fiddle with
// their sheets at the same time. After every turn all six devices must agree
// on the round, whose turn it is, every hit point and every token. One phone
// drops offline for a few turns (and may move while it's gone), another
// reloads mid-round. Each device also logs every token position it ever
// stores, so a token that jumps somewhere the DM never put it is caught even
// if it jumps back before the next check.
//
//   node tools/static-server.js 8765        (in another terminal)
//   node tools/sync-fight.js --campaign stress-test-1027 [--rounds 3] [--seed 7]
//
// Same rules as sync-e2e.js: throwaway campaigns only (the id must start with
// stress-test or test-), seeded from tools/fixture.json, Dropbox cut off.
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
const argOf = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const CAMPAIGN = argOf('--campaign') || '';
if (!/^(stress-test|test-)[A-Za-z0-9_-]{0,30}$/.test(CAMPAIGN)){
  console.error('usage: node tools/sync-fight.js --campaign stress-test-<something> [--rounds 3] [--seed 7]');
  process.exit(2);
}
const { launch, sleep } = require('./sync-lib')(CAMPAIGN);
const ROUNDS = parseInt(argOf('--rounds') || '3', 10);
let seed = parseInt(argOf('--seed') || '7', 10);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const S = path.join(__dirname, 'shots', 'fight-');
const fix = require('./fixture.json'); const keys = fix.keys || fix;
const PCS = ['zoey', 'namroc', 'ulrick', 'zindle', 'creambak'];
const results = [], lats = [];
const log = (ok, name, extra) => { results.push({ ok, name, ...(extra || {}) }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra && extra.lat != null ? '  [' + extra.lat + 'ms]' : '') + (extra && extra.why ? '  -- ' + extra.why : '')); };

// What every device must agree on. Stored state, not memory: it's what the
// next reload, and every other device, will read.
const SNAP = "const m = JSON.parse(localStorage.getItem('skt-battlemap-v1')||'{}'); const tok = {};"
  + "(m.tokens||[]).forEach(t => { if (t && (t.cid != null || t.isPC)) tok[t.cid != null ? t.cid : t.label] = Math.round(t.x) + ',' + Math.round(t.y); });"
  + " return JSON.stringify({ r: state.combatRound, a: state.activeCombatantId,"
  + " c: state.combatants.map(c => c.id + ':' + c.hp + ':' + (c.tempHp||0)).sort(),"
  + " p: state.party.map(p => p.id + ':' + p.hp).sort(), tok: Object.keys(tok).sort().map(k => k + '@' + tok[k]) });";
// Every token position a device ever stores, sampled every 100 ms, with when
// each token moved (the same machine's clock, so devices line up).
const WATCH = "if (!window.__seen){ window.__seen = new Set(); window.__moves = {}; setInterval(() => { try { (JSON.parse(localStorage.getItem('skt-battlemap-v1')||'{}').tokens||[]).forEach(t => { if (!t || t.cid == null) return;"
  + " const at = Math.round(t.x) + ',' + Math.round(t.y), m = window.__moves[t.cid] || (window.__moves[t.cid] = []);"
  + " window.__seen.add(t.cid + '@' + at); if (!m.length || m[m.length - 1][1] !== at) m.push([Date.now(), at]); }); } catch(e){} }, 100); } return 1";

(async () => {
  const devs = [];
  let dm;
  const phone = {};
  const offline = new Set();
  let nTurn = 9;
  // Wait until every online device stores what the DM stores.
  async function agree(label, ms){
    const t0 = Date.now(); let want, last = {};
    while (Date.now() - t0 < (ms || 20000)){
      want = await dm.ev(SNAP);
      const outs = await Promise.all(PCS.filter(id => !offline.has(id)).map(async id => [id, await phone[id].ev(SNAP).catch(e => 'ERR ' + e.message)]));
      last = {}; outs.forEach(([id, s]) => { if (s !== want) last[id] = s; });
      if (!Object.keys(last).length){ const t = Date.now() - t0; lats.push(t); log(true, label, { lat: t }); return true; }
      await sleep(200);
    }
    const W = JSON.parse(want), diff = Object.keys(last).map(id => {
      let s; try { s = JSON.parse(last[id]); } catch(e){ return id + ' ' + last[id]; }
      const d = []; ['r', 'a'].forEach(k => { if (s[k] !== W[k]) d.push(k + ' ' + s[k] + '≠' + W[k]); });
      ['c', 'p', 'tok'].forEach(k => { const a = s[k].filter(x => !W[k].includes(x)); if (a.length) d.push(k + ' ' + a.join(' ') + ' (DM ' + W[k].filter(x => !s[k].includes(x)).join(' ') + ')'); });
      return id + ': ' + d.join('; ');
    });
    log(false, label, { why: diff.join(' | ').slice(0, 600) });
    return false;
  }
  try {
    dm = await launch('DM', { w: 1440, h: 900, keys }); devs.push(dm);
    await dm.until('return _realtimeStarted', 15000); await sleep(3500);
    const me = n => "localStorage.setItem('skt-me-v1', JSON.stringify({pcId:'" + n + "',id:'" + n + "',name:'" + n + "'}));";
    const phones = await Promise.all(PCS.map(id => launch(id.toUpperCase(), { player: true, w: 390, h: 844, mobile: true, seed: me(id) })));
    phones.forEach((d, i) => { phone[PCS[i]] = d; devs.push(d); });
    const ids = await dm.ev('return JSON.stringify(state.party.map(p=>p.id))');
    const ready = await Promise.all(phones.map(d => d.until('return _realtimeStarted && JSON.stringify(state.party.map(p=>p.id)) === ' + JSON.stringify(ids), 40000)));
    log(ready.every(x => x != null), 'five phones and the DM connected', { why: ready.map((x, i) => PCS[i] + ' ' + x).join(', ') });

    // ── The fight starts: an encounter pushed and placed on the map ───────
    await dm.ev("sktCloseRoll(); state.prompt = null; state.combatants = []; state.combatRound = 0; state.activeCombatantId = null; save();"
      + " const B = panelDefs.battlemap; ['party','combat','battlemap','encounter'].forEach(id => openPanel(id)); await new Promise(r=>setTimeout(r,800));"
      + " B._tokens = B._tokens.filter(t => t.isPC);"
      // Earlier runs leave the party piled up at the edge; spread them out
      // along a row, two squares apart, the way a DM sets up.
      + " const cs = B._csScreen(); B._tokens.forEach((t, i) => { t.x = cs * (4.5 + i * 2); t.y = cs * 9.5; }); B._renderTokens(); B._saveMap(); return 1");
    for (const d of phones) await d.ev("for (let k = 0; k < 10; k++){ const x = document.querySelector('#pa-handout .pa-ho-close'); if (!x) break; x.click(); await new Promise(r=>setTimeout(r,150)); } paTab = 'map'; paRender(); return 1");
    // Watch for jumps only once everyone has the party where the DM set it:
    // before that a phone still holds where the last session left them.
    await agree('everyone has the party where the DM set it out', 30000);
    await Promise.all(devs.map(d => d.ev(WATCH)));
    const placed = await dm.ev("const E = panelDefs.encounter; E._monsters = [{ name: 'Goblin', count: 3, hp: 7, ac: 15, dex: 14 }, { name: 'Ogre', count: 1, hp: 59, ac: 11, dex: 8 }]; E._render(); await new Promise(r=>setTimeout(r,150));"
      + " document.querySelector('#enc-push-map').click(); await new Promise(r=>setTimeout(r,1300));"
      + " const st = document.querySelector('.window[data-panel=\"battlemap\"] #map-stage'), r = st.getBoundingClientRect(), x = r.left + Math.min(r.width, 900) * 0.6, y = r.top + Math.min(r.height, 600) * 0.35;"
      + " st.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 })); await new Promise(r=>setTimeout(r,300));"
      + " state.party.forEach((p, i) => { if (!state.combatants.some(c => c.id === p.id)) panelDefs.combat._addPartyToCombat(i); });"
      + " sktEnsureCombatTokens(true); panelDefs.combat._rollInitiative(); await new Promise(r=>setTimeout(r,300));"
      + " state.combatRound = 1; state.activeCombatantId = state.combatants[0].id; save(); panelDefs.combat._render();"
      + " const toks = new Set(panelDefs.battlemap._tokens.map(t => t.cid != null ? t.cid : t.label)); const has = c => toks.has(c.id) || (c.isPC && toks.has(c.name));"
      + " return { n: state.combatants.length, party: state.party.length, mons: state.combatants.filter(c=>!c.isPC).length, toks: toks.size, missing: state.combatants.filter(c => !has(c)).map(c => c.name + (c.isPC ? ' (pc ' + c.id + ' hp ' + c.hp + ')' : '')) }");
    nTurn = placed.n;
    log(placed.n === placed.party + 4 && placed.mons === 4 && !placed.missing.length, 'DM pushes 3 goblins and an ogre onto the map with the party, rolls initiative', { why: JSON.stringify(placed) });
    await agree('everyone sees the fight start', 30000);

    // ── Turns ──────────────────────────────────────────────────────────────
    let turn = 0, offlineAt = null, reloaded = false, movedOffline = null;
    const turnAt = [];
    let expect = null;
    const tokenAt = id => "const n = (state.party.find(p => p.id === '" + id + "') || {}).name; const t = (JSON.parse(localStorage.getItem('skt-battlemap-v1')||'{}').tokens||[]).find(t => t.cid === '" + id + "' || (t.isPC && t.label === n)); return t ? Math.round(t.x) + ',' + Math.round(t.y) : null";
    const totalTurns = ROUNDS * nTurn;
    while (turn < totalTurns){
      turn++;
      const cur = await dm.ev("const c = state.combatants.find(c => c.id === state.activeCombatantId) || {}; const L = state.combatants, k = L.indexOf(c); return { id: c.id, name: c.name, pc: !!c.isPC, hp: c.hp, round: state.combatRound, in2: k < 0 ? null : (L[(k + 2) % L.length] || {}).id }");
      const label = 'R' + cur.round + ' ' + cur.name;
      turnAt.push([Date.now(), label]);
      // Round 2: Zindle's phone loses signal for four turns, Zindle's own among them:
      // they drag their token with no signal, and the move must reach everyone.
      if (cur.round === 2 && offlineAt == null && cur.in2 === 'zindle'){ offlineAt = turn; offline.add('zindle'); await phone.zindle.offline(true); console.log('  (zindle offline)'); }
      if (offlineAt != null && offline.has('zindle') && turn - offlineAt >= 4){ await phone.zindle.offline(false); offline.delete('zindle'); console.log('  (zindle back online)');
        if (movedOffline){
          const mo = movedOffline; movedOffline = null;
          const where = tokenAt(mo.id);
          const t = await dm.until('return (() => { ' + where + ' })() === ' + JSON.stringify(mo.at), 30000);
          log(t != null, 'the token Zindle dragged with no signal reaches the DM on reconnecting', t != null ? { lat: t } : { why: 'DM has ' + await dm.ev(where) + ', the phone moved it to ' + mo.at });
        }
      }
      // Round 3: Creambak's phone reloads the page in the middle of it.
      if (cur.round === 3 && !reloaded && !cur.pc){ reloaded = true; const t = await phone.creambak.reload(); await phone.creambak.ev(WATCH); await phone.creambak.ev("paTab = 'map'; paRender(); return 1"); console.log('  (creambak reloaded, ready in ' + t + 'ms)'); }

      const busy = [];
      if (cur.pc && phone[cur.id]){
        // The player drags their token one or two squares with a finger.
        const d = phone[cur.id];
        const r = await d.ev("paTab = 'map'; paRender(); await new Promise(r=>setTimeout(r,700)); paCenterOnMe(); await new Promise(r=>setTimeout(r,250));"
          + " const t = paMyToken(); if (!t) return null; const el = document.querySelector('#pa-screen .pa-mount .map-token[data-tid=\"' + CSS.escape(String(t.id)) + '\"]'); if (!el) return null;"
          + " const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, top = document.elementFromPoint(x, y);"
          + " return { x, y, w: b.width, before: [t.x, t.y], under: top === el || el.contains(top) ? 'token' : (top ? top.tagName + '.' + String(top.className).slice(0, 40) + ' ' + ((top.closest('.map-token')||{}).dataset||{}).tid : 'nothing'), mine: t.id, copies: document.querySelectorAll('#pa-screen .map-token[data-tid=\"' + CSS.escape(String(t.id)) + '\"]').length, vh: innerHeight, vw: innerWidth,"
          + " cs: panelDefs.battlemap._csScreen(), others: panelDefs.battlemap._tokens.filter(o => o.id !== t.id).map(o => [o.x, o.y]) }");
        if (!r) log(false, label + ': phone finds its own token');
        else {
          // A square that's on screen and that nobody stands in: you can't end
          // a move in someone else's space, and a player wouldn't try.
          const free = ([dx, dy], n) => {
            const sx = r.x + dx * r.w * n, sy = r.y + dy * r.w * n, tx = r.before[0] + dx * r.cs * n, ty = r.before[1] + dy * r.cs * n;
            return sx > r.w && sx < r.vw - r.w && sy > r.w * 2 && sy < r.vh - r.w * 4 && !r.others.some(([ox, oy]) => Math.abs(ox - tx) < r.cs * 0.9 && Math.abs(oy - ty) < r.cs * 0.9);
          };
          const moves = [];
          [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(d => [1, 2].forEach(n => { if (free(d, n)) moves.push([d, n]); }));
          const [dir, n] = moves.length ? pick(moves) : [[1, 0], 1];
          const to = [r.x + dir[0] * r.w * n, r.y + dir[1] * r.w * n], pts = [];
          for (let k = 0; k <= 6; k++) pts.push([r.x + (to[0] - r.x) * k / 6, r.y + (to[1] - r.y) * k / 6]);
          await d.drag(pts, true); await sleep(250);
          const after = await d.ev("const t = paMyToken(); return t ? [t.x, t.y] : null");
          if (offline.has(cur.id) && after) movedOffline = { id: cur.id, at: after.map(Math.round).join(",") };
          else if (after) expect = { id: cur.id, at: after.map(Math.round).join(','), who: 'the phone' };
          if (!after || (after[0] === r.before[0] && after[1] === r.before[1])){ log(false, label + ': the finger drag moved the token on the phone', { why: JSON.stringify({ before: r.before, after, at: [Math.round(r.x), Math.round(r.y)], vh: r.vh, under: r.under, mine: r.mine, copies: r.copies }) }); await d.shot(S + 'miss-' + cur.id + '.png'); }
        }
        // They hit something; the DM applies it.
        busy.push(dm.ev("const live = state.combatants.map((c, i) => [c, i]).filter(([c]) => !c.isPC && c.hp > 0); if (!live.length) return 0; const [c, i] = live[Math.floor(Math.random() * live.length)];"
          + " panelDefs.combat._applyHpDelta(i, -(3 + Math.floor(Math.random() * 6)), 'slashing'); return 1"));
      } else {
        // A monster: the DM moves it a square and it hits someone.
        busy.push(dm.ev("const B = panelDefs.battlemap, cs = B._csScreen(), t = B._tokens.find(t => t.cid === state.activeCombatantId); if (t){ t.x += cs * (Math.random() < 0.5 ? -1 : 1); B._renderTokens(); B._saveMap(); }"
          + " if (" + JSON.stringify(!cur.pc && cur.hp > 0) + "){ const pcs = state.combatants.map((c, i) => [c, i]).filter(([c]) => c.isPC && c.hp > 1); if (pcs.length){ const [c, i] = pcs[Math.floor(Math.random() * pcs.length)]; panelDefs.combat._applyHpDelta(i, -Math.min(c.hp - 1, 2 + Math.floor(Math.random() * 5)), 'bludgeoning'); } }"
          + " return t ? Math.round(t.x) + ',' + Math.round(t.y) : null").then(at => { if (at) expect = { id: cur.id, at, who: 'the DM' }; }));
      }
      // Meanwhile two other players poke at their own sheets.
      const others = PCS.filter(id => id !== cur.id && !offline.has(id));
      for (const id of [pick(others), pick(others)]){
        busy.push(phone[id].ev("const i = state.party.findIndex(p => p.id === '" + id + "'); const p = state.party[i];"
          + " if (Math.random() < 0.5){ p.inspiration = !p.inspiration; save(); } else { p.hp = Math.min(p.hpMax, p.hp + 1); syncPartyToCombat(i); save(); } return 1"));
      }
      await Promise.all(busy);
      await sleep(400);
      // Next.
      await dm.ev("document.querySelector('.window[data-panel=\"combat\"] [data-act=\"next\"]').click(); return 1");
      await agree('turn ' + turn + ' (' + label + ')' + (offline.has('zindle') ? ' [zindle offline]' : ''));
      // Agreeing isn't enough: a stale write could take everyone, the DM
      // included, back to where the token was. The move has to stick.
      if (expect){
        const now = await dm.ev(tokenAt(expect.id));
        if (now !== expect.at) log(false, label + ': the move ' + expect.who + ' made stuck', { why: 'moved to ' + expect.at + ', everyone now has ' + now });
        expect = null;
      }
    }
    if (offline.has('zindle')){ await phone.zindle.offline(false); offline.delete('zindle'); }
    await agree('Zindle’s phone caught up after the dropout, everything agrees', 30000);

    // ── Each phone's own sheet shows the hit points everyone agreed on ────
    const shown = await Promise.all(PCS.map(id => phone[id].ev("paTab = 'you'; paRender(); await new Promise(r=>setTimeout(r,500)); const p = paPc(); const el = document.querySelector('#pa-screen .cs-hp-n, #pa-screen .pa-hp-n'); return [p.hp, el ? el.textContent : null]")));
    const bad = shown.map((s, i) => [PCS[i], s]).filter(([, s]) => !(s[1] && s[1].includes(String(s[0]))));
    log(!bad.length, 'each phone’s sheet shows its agreed hit points', { why: JSON.stringify(bad) });

    // ── Nobody's token ever stood anywhere the DM didn't put it ──────────
    const dmSeen = new Set(await dm.ev('return [...window.__seen]'));
    const ghosts = {};
    for (const id of PCS){ const s = await phone[id].ev('return [...window.__seen]'); const g = s.filter(x => !dmSeen.has(x)); if (g.length) ghosts[id] = g.slice(0, 6); }
    log(!Object.keys(ghosts).length, 'no phone ever stored a token position the DM never had (no jumps)', { why: JSON.stringify(ghosts) });
    if (Object.keys(ghosts).length){
      // Where it came from: that token's moves on the DM and on one phone, against the turns.
      const id0 = Object.keys(ghosts)[0], cid = ghosts[id0][0].split('@')[0], t0 = turnAt[0] ? turnAt[0][0] : 0;
      const tl = async d => (await d.ev("return JSON.stringify(window.__moves['" + cid + "'] || [])"));
      console.log('  ' + cid + ' on the DM: ' + JSON.parse(await tl(dm)).map(([t, a]) => (t - t0) + 'ms ' + a).join(' → '));
      console.log('  ' + cid + ' on ' + id0 + ': ' + JSON.parse(await tl(phone[id0])).map(([t, a]) => (t - t0) + 'ms ' + a).join(' → '));
      console.log('  turns: ' + turnAt.map(([t, l]) => (t - t0) + 'ms ' + l).join(', '));
    }

    // ── The DM ends the fight ─────────────────────────────────────────────
    await dm.ev("document.querySelector('.window[data-panel=\"combat\"] [data-act=\"end\"]').click(); await new Promise(r=>setTimeout(r,400));"
      + " const b = [...document.querySelectorAll('.modal button, .skt-modal button, dialog button')].find(b => /end|yes|ok|confirm/i.test(b.textContent)); if (b) b.click(); await new Promise(r=>setTimeout(r,500)); return state.combatants.length");
    await agree('DM ends the fight, every phone clears', 20000);
    const left = await Promise.all(devs.map(d => d.ev("return (JSON.parse(localStorage.getItem('skt-battlemap-v1')||'{}').tokens||[]).filter(t => t && t.cid != null && !t.isPC).length")));
    log(left.every(n => n === 0), 'the monsters left every map', { why: left.join('/') });
    for (const d of devs) await d.shot(S + d.name + '.png');
  } catch(e){ log(false, 'DRIVER FAILED', { why: e.message }); }
  finally {
    const errs = {}; for (const d of devs) { const e = [...new Set(d.errors)].slice(0, 8); if (e.length) errs[d.name] = e; }
    const dbx = devs.reduce((n, d) => n + d.dbx.length, 0);
    const sorted = lats.slice().sort((a, b) => a - b), q = f => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : null;
    console.log('\nturn agreement latency: median ' + q(0.5) + 'ms, p90 ' + q(0.9) + 'ms, max ' + q(1) + 'ms over ' + sorted.length + ' checks');
    console.log('page errors', JSON.stringify(errs, null, 1), '\nrequests to Dropbox:', dbx);
    console.log(results.filter(r => r.ok).length + '/' + results.length + ' passed');
    fs.writeFileSync(S + 'results.json', JSON.stringify({ results, lats }, null, 1));
    process.exitCode = results.every(r => r.ok) ? 0 : 1;
    devs.forEach(d => d.close());
  }
})();
