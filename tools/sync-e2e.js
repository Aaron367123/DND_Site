#!/usr/bin/env node
// End-to-end sync test: a DM browser and two player phones, each its own
// Chrome profile, talking through the LIVE Firebase — the only way to see
// what another connected device really receives. ~30 actions, each made on
// one device and checked on another: party and sheet buttons, combat, map
// strokes (real mouse and touch input), token drags, handouts, roll
// requests answered by two phones at once, reaction prompts, shared loot,
// notes both ways, time, weather, simultaneous edits, offline and back.
//
//   node tools/static-server.js 8765        (in another terminal)
//   node tools/sync-e2e.js --campaign stress-test-1027 [--only REGEX]
//
// It writes to Firebase, so it only runs in a throwaway campaign: the id must
// start with "stress-test" or "test-". Seeded from tools/fixture.json; the
// real campaign is never read or written. Dropbox is cut twice: its config is
// pinned empty (isConfigured() → false) and its hosts are blocked outright.
// The test campaign keeps its data between runs; delete its node
// (skt/c/<id>) from the Firebase console when you're done with it.
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
const argOf = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const CAMPAIGN = argOf('--campaign') || '';
if (!/^(stress-test|test-)[A-Za-z0-9_-]{0,30}$/.test(CAMPAIGN)){
  console.error('usage: node tools/sync-e2e.js --campaign stress-test-<something> [--only REGEX]');
  console.error('(the campaign id must start with stress-test or test-: this writes to live Firebase)');
  process.exit(2);
}
const { launch, sleep } = require('./sync-lib')(CAMPAIGN);

const S = path.join(__dirname, 'shots', 'sync-');
const fix = require('./fixture.json'); const keys = fix.keys || fix;
const ONLY = argOf('--only') ? new RegExp(argOf('--only')) : null;
const results = [];
const W = (dev, js, ms) => dev.until(js, ms || 12000);
async function step(name, fn){
  if (ONLY && !ONLY.test(name)) return;
  const t0 = Date.now(); let r;
  try { r = await fn(); } catch(e){ r = { ok: false, why: e.message.slice(0, 300) }; }
  if (r === true) r = { ok: true }; if (r == null || r === false) r = { ok: false };
  results.push({ name, ...r, ms: Date.now() - t0 });
  console.log((r.ok ? 'PASS ' : 'FAIL ') + name + (r.lat != null ? '  [' + r.lat + 'ms]' : '') + (r.why ? '  -- ' + r.why : ''));
}
const lat = t => t == null ? { ok: false, why: 'never arrived' } : { ok: true, lat: t };
const setHp = (id, v) => "const i = state.party.findIndex(p=>p.id==='" + id + "'); state.party[i].hp = " + v + "; syncPartyToCombat(i); save();";
const hpOf = id => "(state.party.find(p=>p.id==='" + id + "')||{}).hp";

const window = {};
(async () => {
  let dm, pl, p2;
  try {
    dm = await launch('DM', { w: 1440, h: 900, keys });
    await W(dm, 'return _realtimeStarted', 15000); await sleep(3500);
    const me = n => "localStorage.setItem('skt-me-v1', JSON.stringify({pcId:'" + n + "',id:'" + n + "',name:'" + n + "'}));";
    [pl, p2] = await Promise.all([
      launch('PHONE', { player: true, w: 390, h: 844, mobile: true, seed: me('zoey') }),
      launch('PHONE2', { player: true, w: 390, h: 844, mobile: true, seed: me('namroc') }),
    ]);
    const dmNames = await dm.ev('return JSON.stringify(state.party.map(p=>p.id))');
    for (const d of [pl, p2]) await W(d, '_realtimeStarted && JSON.stringify(state.party.map(p=>p.id)) === ' + JSON.stringify(dmNames) + ' ? 1 : 0', 30000);
    await dm.ev("['party','combat','battlemap'].forEach(id => openPanel(id)); sktCloseRoll(); state.prompt = null; save(); await new Promise(r=>setTimeout(r,800)); return 1");
    await sleep(1500);
    for (const d of [pl, p2]) await d.ev("for (let k = 0; k < 10; k++){ const x = document.querySelector('#pa-handout .pa-ho-close'); if (!x) break; x.click(); await new Promise(r=>setTimeout(r,150)); } return 1");

    // An earlier run in this campaign can leave someone down or dead: start everyone standing.
    await dm.ev("state.party.forEach(p => { p.hp = p.hpMax; delete p.deathSaves; delete p.stable; delete p.dead; p.concentration = null; p.concCheck = null; p.exhaustion = 0; p.rage = false; p.wildshape = null; }); state.combatants = []; state.combatRound = 0; save(); panelDefs.party._render(); return 1");
    await sleep(1500);
    // ── Party: buttons on each side ─────────────────────────────────────────
    await step('DM party card − button → phone HP', async () => {
      const before = await pl.ev('return ' + hpOf('zoey'));
      await dm.ev("const i = state.party.findIndex(p=>p.id==='zoey'); const card = document.querySelector('.window[data-panel=\"party\"]'); const amt = card.querySelector('.party-hp-amt[data-idx=\"'+i+'\"]'); amt.value = 4; amt.dispatchEvent(new Event('input',{bubbles:true})); amt.dispatchEvent(new Event('change',{bubbles:true})); card.querySelector('[data-act=\"hp-damage\"][data-idx=\"'+i+'\"]').click(); return 1");
      const want = await dm.ev('return ' + hpOf('zoey'));
      if (want === before) return { ok: false, why: 'DM click did nothing (' + before + ')' };
      return lat(await W(pl, 'return ' + hpOf('zoey') + ' === ' + want + " && document.querySelector('#pa-screen .cs-hp-n, #pa-screen .pa-hp-n')?.textContent.includes('" + want + "')"));
    });
    await step('phone Damage button → DM party + combat', async () => {
      const before = await dm.ev('return ' + hpOf('zoey'));
      await pl.ev("paTab='you'; paRender(); await new Promise(r=>setTimeout(r,200)); const inp = document.querySelector('#pa-screen input[data-cs-amt]'); inp.value = 3; inp.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#pa-screen [data-cs-hp=\"-1\"]').click(); return 1");
      const want = await pl.ev('return ' + hpOf('zoey'));
      if (want === before) return { ok: false, why: 'phone click did nothing' };
      return lat(await W(dm, 'return ' + hpOf('zoey') + ' === ' + want + " && (state.combatants.find(c=>c.id==='zoey')||{hp:" + want + "}).hp === " + want));
    });
    await step('phone Inspiration toggle → DM', async () => {
      await pl.ev("const b = document.querySelector('#pa-screen [data-cs=\"insp\"]'); if (!b) throw new Error('no insp'); b.click(); return 1");
      const want = await pl.ev("return !!state.party.find(p=>p.id==='zoey').inspiration");
      return lat(await W(dm, "return !!state.party.find(p=>p.id==='zoey').inspiration === " + want));
    });
    await step('phone resource pip → DM', async () => {
      const r = await pl.ev("paTab='you'; paRender(); await new Promise(r=>setTimeout(r,150)); const tb = document.querySelector('#pa-screen [data-cs-tab=\"actions\"]'); if (tb){ tb.click(); await new Promise(r=>setTimeout(r,150)); } const pip = document.querySelector('#pa-screen [data-cs-res]'); if (!pip) return null; const pc = state.party.find(p=>p.id==='zoey'); const before = JSON.stringify(pc.resources||pc.sheet&&pc.sheet.resources||null); pip.click(); await new Promise(r=>setTimeout(r,100)); const p2 = state.party.find(p=>p.id==='zoey'); return { before, after: JSON.stringify(p2.resources||p2.sheet&&p2.sheet.resources||null) }");
      if (!r) return { ok: false, why: 'no resource pip on the phone sheet' };
      if (r.before === r.after) return { ok: false, why: 'pip click changed nothing locally' };
      return lat(await W(dm, "const p = state.party.find(p=>p.id==='zoey'); return JSON.stringify(p.resources||p.sheet&&p.sheet.resources||null) === " + JSON.stringify(r.after)));
    });
    await step('DM adds a condition → phone shows it', async () => {
      await dm.ev("const p = state.party.find(p=>p.id==='zoey'); p.conditions = ['Poisoned']; save(); panelDefs.party._render(); return 1");
      return lat(await W(pl, "return (state.party.find(p=>p.id==='zoey').conditions||[]).includes('Poisoned') && /Poisoned/.test(document.getElementById('pa-screen').textContent)"));
    });

    // ── Party card: rage, wild shape, exhaustion, bardic, concentration, death saves, a short rest ──
    const pidx = id => "state.party.findIndex(p=>p.id==='" + id + "')";
    const partyWin = "document.querySelector('.window[data-panel=\"party\"]')";
    // Between fights: a fight the test campaign kept from an earlier run would
    // take the damage below on its combatants instead.
    await dm.ev("state.combatants = []; state.combatRound = 0; state.activeCombatantId = null; save(); panelDefs.combat._render(); return 1");
    await step('DM rage button → phone', async () => {
      await dm.ev("const i = " + pidx('ulrick') + "; panelDefs.party._render(); " + partyWin + ".querySelector('[data-act=\"rage-on\"][data-idx=\"'+i+'\"]').click(); return 1");
      if (!await dm.ev("return !!state.party.find(p=>p.id==='ulrick').rage")) return { ok: false, why: 'DM click did nothing' };
      return lat(await W(pl, "return !!state.party.find(p=>p.id==='ulrick').rage"));
    });
    await step('DM Wild Shape (Namroc) → Namroc’s phone shows the form', async () => {
      // The test campaign keeps its state between runs: a use to spend, no form yet.
      await dm.ev("const n = state.party.find(p=>p.id==='namroc'); n.wildshape = null; (n.resources||[]).forEach(r => { if (r.name === 'Wild Shape') r.current = r.max; }); save(); return 1");
      await dm.ev("const wolf = _5eData.find(d=>d.cat==='monster' && d.name==='Wolf' && d._raw); panelDefs.party._applyWildShape(" + pidx('namroc') + ", wolf); return 1");
      if (!await dm.ev("return (state.party.find(p=>p.id==='namroc').wildshape||{}).name === 'Wolf'")) return { ok: false, why: 'no form on the DM' };
      return lat(await W(p2, "paTab='you'; return (state.party.find(p=>p.id==='namroc').wildshape||{}).name === 'Wolf' && /Wild Shape: Wolf/.test(document.getElementById('pa-screen').textContent)"));
    });
    await step('DM exhaustion → phone shows the level', async () => {
      await pl.ev("paTab='you'; paRender(); return 1");
      await dm.ev("const i = " + pidx('zoey') + "; state.party[i] = { ...state.party[i], exhaustion: 2 }; save(); panelDefs.party._render(); return 1");
      const t = await W(pl, "return state.party.find(p=>p.id==='zoey').exhaustion === 2 && /Exhaustion.{0,3}2/.test(document.getElementById('pa-screen').textContent)");
      if (t == null) return { ok: false, why: 'phone: ' + await pl.ev("return JSON.stringify({ exh: state.party.find(p=>p.id==='zoey').exhaustion, tab: paTab, me: (paPc()||{}).id, text: (document.getElementById('pa-screen').textContent.match(/.{0,30}xhaust.{0,30}/) || [''])[0] })") };
      return lat(t);
    });
    await step('DM gives Bardic Inspiration (Zindle → Zoey) → phone holds the die, the bard’s use is spent', async () => {
      const before = await dm.ev("return (state.party.find(p=>p.id==='zindle').resources.find(r=>r.name==='Bardic Inspiration')||{}).current");
      await dm.ev("const i = " + pidx('zoey') + "; panelDefs.party._render(); const b = " + partyWin + ".querySelector('[data-act=\"bardic-give\"][data-idx=\"'+i+'\"], [data-act=\"bardic-insp\"][data-idx=\"'+i+'\"]'); if (!b) throw new Error('no Bardic button'); b.click(); return 1");
      return lat(await W(pl, "const z = state.party.find(p=>p.id==='zoey'), b = state.party.find(p=>p.id==='zindle'); return !!z.bardicInspiration && (b.resources.find(r=>r.name==='Bardic Inspiration')||{}).current === " + (before - 1) + " && /Bardic/.test(document.getElementById('pa-screen').textContent)"));
    });
    await step('DM hits a concentrating PC → phone asks for the CON save; its answer reaches the DM', async () => {
      await dm.ev("const i = " + pidx('zoey') + "; state.party[i] = { ...state.party[i], hp: 30, concentration: 'Bless', concCheck: null }; save(); panelDefs.party._applyHpDelta(i, -6, 'slashing'); return 1");
      const t = await W(pl, "return !!document.getElementById('pa-conc-save')", 15000);
      if (t == null) return { ok: false, why: 'the phone never asked' };
      // A failed save with something left to try (Heroic Inspiration) asks first: let it end.
      await pl.ev("document.querySelector('#pa-conc-save [data-pa-cs=\"roll\"]').click(); await new Promise(r=>setTimeout(r,300)); const end = document.querySelector('#pa-conc-save [data-pa-cs=\"end\"]'); if (end) end.click(); return 1");
      const kept = await W(pl, "return !state.party.find(p=>p.id==='zoey').concCheck", 8000);
      // The result stays up until OK, as on a real phone: press it, or the card sits over the map for the steps after.
      await pl.ev("const okb = document.querySelector('#pa-conc-save [data-pa-cs=\"ok\"]'); if (okb) okb.click(); document.getElementById('pa-conc-save')?.remove(); return 1");
      if (kept == null) return { ok: false, why: 'the phone never cleared the check' };
      const want = await pl.ev("return state.party.find(p=>p.id==='zoey').concentration || ''");
      return lat(await W(dm, "const z = state.party.find(p=>p.id==='zoey'); return !z.concCheck && (z.concentration || '') === " + JSON.stringify(want)));
    });
    await step('DM in combat hits a concentrating PC → a DM card and the phone asks; the phone answers → the DM card goes', async () => {
      const CARD = "document.querySelector('#cond-save-stack .cond-save, .tv-condsaves .cond-save')";
      await dm.ev("const i = " + pidx('zoey') + "; state.party[i] = { ...state.party[i], hp: 30, concentration: 'Bless', concCheck: null }; "
        + "window.__e2eAdded = !state.combatants.some(c => c.id === 'zoey'); if (window.__e2eAdded) state.combatants.push({ id: 'zoey', name: 'Zoey', isPC: true, hp: 30, hpMax: state.party[i].hpMax || 30, ac: state.party[i].ac || 12, initiative: 10, conditions: [] }); "
        + "save(); const C = panelDefs.combat; C._applyHpDelta(state.combatants.findIndex(c => c.id === 'zoey'), -6, 'slashing'); return 1");
      const card = await W(dm, "return !!" + CARD, 5000);
      if (card == null) return { ok: false, why: 'no card on the DM screen' };
      const t = await W(pl, "return !!document.getElementById('pa-conc-save')", 15000);
      if (t == null) return { ok: false, why: 'the phone never asked' };
      await pl.ev("document.querySelector('#pa-conc-save [data-pa-cs=\"roll\"]').click(); await new Promise(r=>setTimeout(r,300)); const end = document.querySelector('#pa-conc-save [data-pa-cs=\"end\"]'); if (end) end.click(); await new Promise(r=>setTimeout(r,200)); const okb = document.querySelector('#pa-conc-save [data-pa-cs=\"ok\"]'); if (okb) okb.click(); document.getElementById('pa-conc-save')?.remove(); return 1");
      const gone = await W(dm, "return !" + CARD, 15000);
      await dm.ev("if (window.__e2eAdded) state.combatants = state.combatants.filter(c => c.id !== 'zoey'); const i = " + pidx('zoey') + "; state.party[i] = { ...state.party[i], concentration: null, concCheck: null }; save(); return 1");
      return lat(gone);
    });
    await step('DM drops a PC between fights → phone rolls the death save → DM card shows it', async () => {
      await dm.ev("const i = " + pidx('zoey') + "; state.party[i] = { ...state.party[i], hp: 2, deathSaves: null, stable: false, dead: false }; save(); panelDefs.party._applyHpDelta(i, -5, 'slashing'); return 1");
      await pl.ev("paTab='you'; paRender(); return 1");
      // The phone's own screen is the character sheet: its Death saves Roll.
      const DS = "#pa-screen [data-cs=\"death\"], #pa-screen [data-pa-death=\"roll\"]";
      const t = await W(pl, "paTab='you'; return !!document.querySelector('" + DS + "')", 15000);
      if (t == null) return { ok: false, why: 'no death save on the phone: ' + await pl.ev("const z = state.party.find(p=>p.id==='zoey'); return JSON.stringify({ hp: z.hp, ds: z.deathSaves, dead: z.dead, stable: z.stable, tab: paTab, me: (paPc()||{}).id, inFight: (state.combatants||[]).some(c=>c.id==='zoey') })") + ' · the DM has ' + await dm.ev("const z = state.party.find(p=>p.id==='zoey'); return JSON.stringify({ hp: z.hp, ds: z.deathSaves, conc: z.concentration, cc: z.concCheck, inFight: (state.combatants||[]).some(c=>c.id==='zoey') })") };
      await pl.ev("document.querySelector('" + DS + "').click(); return 1");
      await sleep(400);
      const after = await pl.ev("const z = state.party.find(p=>p.id==='zoey'); return JSON.stringify({ hp: z.hp, ds: z.deathSaves || null })");
      return lat(await W(dm, "const z = state.party.find(p=>p.id==='zoey'); return JSON.stringify({ hp: z.hp, ds: z.deathSaves || null }) === " + JSON.stringify(after) + " && (z.hp > 0 || /saves/.test(" + partyWin + ".textContent))"));
    });
    await step('DM party short rest → phone spends a hit die and finishes → DM card', async () => {
      await dm.ev("const i = " + pidx('zoey') + "; state.party[i] = { ...state.party[i], hp: 5, deathSaves: null, stable: false }; state.party[i].hitDice = { ...state.party[i].hitDice, current: state.party[i].hitDice.max }; save(); panelDefs.party._shortRestAll(); return 1");
      const t = await W(pl, "return !!document.querySelector('.pa-rest-card')", 15000);
      if (t == null) return { ok: false, why: 'the phone never opened its rest' };
      await pl.ev("document.querySelector('.pa-rest-card [data-rest=\"spend\"]').click(); await new Promise(r=>setTimeout(r,300)); document.querySelector('.pa-rest-card [data-rest=\"finish\"]').click(); return 1");
      const want = await pl.ev("const z = state.party.find(p=>p.id==='zoey'); return JSON.stringify({ hp: z.hp, hd: z.hitDice.current })");
      if (JSON.parse(want).hp <= 5) return { ok: false, why: 'the hit die healed nothing on the phone ' + want };
      return lat(await W(dm, "const z = state.party.find(p=>p.id==='zoey'); return JSON.stringify({ hp: z.hp, hd: z.hitDice.current }) === " + JSON.stringify(want)));
    });
    await step('DM ends the rage and the wild shape → phones', async () => {
      await dm.ev("panelDefs.party._setRage(" + pidx('ulrick') + ", false); panelDefs.party._endWildShape(" + pidx('namroc') + "); const i = " + pidx('zoey') + "; state.party[i] = { ...state.party[i], exhaustion: 0, bardicInspiration: false }; save(); return 1");
      return lat(await W(p2, "return !state.party.find(p=>p.id==='ulrick').rage && !state.party.find(p=>p.id==='namroc').wildshape && !state.party.find(p=>p.id==='zoey').exhaustion"));
    });

    // ── Combat ──────────────────────────────────────────────────────────────
    await step('DM starts a fight, Next button → phone turn bar', async () => {
      await dm.ev("const mons = _5eData.filter(r=>r.cat==='monster' && r.name==='Goblin'); panelDefs.combat.addMonster(mons[0]); panelDefs.combat.addMonster(mons[0]); state.party.forEach((p,i)=>{ if (!state.combatants.some(c=>c.id===p.id)) panelDefs.combat._addPartyToCombat(i); }); state.combatRound = 1; state.activeCombatantId = state.combatants[0].id; save(); panelDefs.combat._render(); await new Promise(r=>setTimeout(r,300)); document.querySelector('.window[data-panel=\"combat\"] [data-act=\"next\"]').click(); return 1");
      const who = await dm.ev("return (state.combatants.find(c=>c.id===state.activeCombatantId)||{}).name");
      return lat(await W(pl, "return state.combatants.length >= 7 && (state.combatants.find(c=>c.id===state.activeCombatantId)||{}).name === " + JSON.stringify(who) + " && (document.querySelector('#pa-turn, .pa-turn')||document.body).textContent.includes(" + JSON.stringify(who.split(' ')[0]) + ")"));
    });
    await step('DM passes the turn to Zoey → her token on the phone’s map wears the turn ring; passed on → it goes', async () => {
      const ok1 = await dm.ev("openPanel('battlemap'); await new Promise(r=>setTimeout(r,300)); const z = state.combatants.find(c => c.id === 'zoey' || /zoey/i.test(c.name)); if (!z) return 'no Zoey in the fight'; const B = panelDefs.battlemap; if (!sktTokenForCombatant(B._tokens, z)){ B._syncTokensFromCombat && B._syncTokensFromCombat(); } if (!sktTokenForCombatant(B._tokens, z)) return 'no token for Zoey'; state.activeCombatantId = z.id; save(); return 'ok'");
      if (ok1 !== 'ok') return { ok: false, why: ok1 };
      const ring = "const B = panelDefs.battlemap, z = state.combatants.find(c => c.id === state.activeCombatantId), t = z && sktTokenForCombatant(B._tokens || [], z); const el = t && document.querySelector('#map-stage .map-token[data-tid=\"' + t.id + '\"]'); return el && el.classList.contains('turn') && /zoey/i.test(z.name) && document.querySelectorAll('#map-stage .map-token.turn').length === 1 ? 1 : 0";
      const t1 = await W(pl, "paTab = 'map'; paRender(); " + ring, 10000);
      if (t1 == null) return { ok: false, why: 'the phone’s map never ringed Zoey: ' + await pl.ev("return JSON.stringify([state.activeCombatantId, [...document.querySelectorAll('#map-stage .map-token.turn')].map(e => e.dataset.tid)])") };
      await dm.ev("const i = state.combatants.findIndex(c => c.id === state.activeCombatantId); state.activeCombatantId = state.combatants[(i + 1) % state.combatants.length].id; save(); return 1");
      const t2 = await W(pl, "return !document.querySelector('#map-stage .map-token.turn[data-tid]') || ![...document.querySelectorAll('#map-stage .map-token.turn')].some(e => /zoey/i.test(e.textContent + e.title)) ? 1 : 0", 10000);
      if (t2 == null) return { ok: false, why: 'the ring stayed on Zoey after the turn passed' };
      return lat(t1);
    });
    await step('Zoey walks away from a goblin on her phone → the DM is asked about its opportunity attack; she taps Take back → back on the DM’s map, the question gone', async () => {
      const set = await dm.ev("openPanel('battlemap'); openPanel('turnview'); await new Promise(r=>setTimeout(r,500)); const B = panelDefs.battlemap, T = panelDefs.turnview, cs = B._csScreen(); const z = state.combatants.find(c => /zoey/i.test(c.name)); if (!z) return 'no Zoey in the fight'; const zt = sktTokenForCombatant(B._tokens, z); if (!zt) return 'no token for Zoey'; const g = state.combatants.find(c => !c.isPC && (c.hp || 0) > 0 && sktTokenForCombatant(B._tokens, c)); if (!g) return 'no goblin on the map'; const gt = sktTokenForCombatant(B._tokens, g); delete gt.hidden; if (B._gridType === 'hex'){ const o = B._gridOffPx(), c = sktHexAt(zt.x, zt.y, cs, o.x, o.y), p0 = B._hexAtQR(c.q, c.r), p1 = B._hexAtQR(c.q + 1, c.r); gt.x = zt.x + p1[0] - p0[0]; gt.y = zt.y + p1[1] - p0[1]; } else { gt.x = zt.x + cs; gt.y = zt.y; } delete gt.elev; delete zt.elev; delete zt.mvBack; delete zt.mv; g.reactionUsed = false; z.reactionUsed = false; state.combatRound = Math.max(1, +state.combatRound || 0); state.activeCombatantId = z.id; T._pending = null; save(); B._saveMap(); B._render(); T._mapCache = null; T._render(); const ft = T._ftBetween(g, z); return ft != null && ft <= 5 ? 'ok:' + zt.x : 'not next to each other: ' + ft");
      if (!/^ok:/.test(set)) return { ok: false, why: set };
      const x0 = +set.slice(3);
      const ready = await W(pl, "paTab = 'map'; paRender(); const B = panelDefs.battlemap, z = state.combatants.find(c => c.id === state.activeCombatantId), t = z && sktTokenForCombatant(B._tokens, z); return /zoey/i.test(z && z.name) && t && Math.abs(t.x - " + x0 + ") < 1 && sktTurnMoved(t) === 0 && !t.mvBack && !!document.querySelector('#pa-screen .map-foot-move:not([hidden])') ? 1 : 0", 10000);
      if (ready == null) return { ok: false, why: 'the phone never had Zoey’s turn on its map' };
      await pl.ev("const B = panelDefs.battlemap, z = state.combatants.find(c => c.id === state.activeCombatantId), t = sktTokenForCombatant(B._tokens, z); B._keyMove(t, -1, 0); B._keyMove(t, -1, 0); return 1");
      const asked = await W(dm, "const T = panelDefs.turnview, o = T._pending; return o && o.kind === 'move' && /zoey/i.test(o.mover.name) && !!T._body.querySelector('.tv-react [data-tv=\"oa\"][data-id]') ? 1 : 0", 10000);
      if (asked == null) return { ok: false, why: 'the DM was never asked: ' + await dm.ev("const B = panelDefs.battlemap, T = panelDefs.turnview, z = state.combatants.find(c => c.id === state.activeCombatantId), t = sktTokenForCombatant(B._tokens, z); return JSON.stringify({ x0: " + x0 + ", x: t && t.x, mv: t && t.mv, pending: T._pending && T._pending.kind })") };
      const btn = await pl.ev("for (let i = 0; i < 2; i++){ const b = document.querySelector('#pa-screen .map-foot-back'); if (!b) return i; b.click(); } return 2");
      if (btn !== 2) return { ok: false, why: 'Take back on the phone: tapped ' + btn + ' of 2 times' };
      const back = await W(dm, "const B = panelDefs.battlemap, T = panelDefs.turnview, z = state.combatants.find(c => c.id === state.activeCombatantId), t = sktTokenForCombatant(B._tokens, z); return !T._pending && t && Math.abs(t.x - " + x0 + ") < 1 && sktTurnMoved(t) === 0 && !t.mvBack ? 1 : 0", 10000);
      if (back == null) return { ok: false, why: 'the DM: ' + await dm.ev("const B = panelDefs.battlemap, T = panelDefs.turnview, z = state.combatants.find(c => c.id === state.activeCombatantId), t = sktTokenForCombatant(B._tokens, z); return JSON.stringify({ x0: " + x0 + ", x: t && t.x, mv: t && t.mv, pending: T._pending && T._pending.kind })") };
      return lat(asked);
    });
    await step('DM saves an encounter with notes → it never reaches a phone (the DM’s plans)', async () => {
      const mark = 'e2e-plan-' + Date.now();
      await dm.ev("openPanel('encounter'); await new Promise(r=>setTimeout(r,400)); const E = panelDefs.encounter; E._monsters = [{ name: 'Goblin', cr: '1/4', count: 3, _source: 'MM' }]; E._notes = " + JSON.stringify(mark) + "; E._save(); E._render(); return 1");
      // the DM's own copy reaches the server (where a second DM screen gets it)…
      const up = await W(dm, "return (_lastServer['skt-enc-v1'] || '').includes(" + JSON.stringify(mark) + ") ? 1 : 0", 10000);
      if (up == null) return { ok: false, why: 'the DM’s encounter never reached the server (a second DM screen would not get it)' };
      // …and after a good while, neither phone has it
      await sleep(6000);
      const seen = await Promise.all([pl, p2].map(d => d.ev("return (localStorage.getItem('skt-enc-v1') || '').includes(" + JSON.stringify(mark) + ") ? 1 : 0")));
      await dm.ev("const E = panelDefs.encounter; E._notes = ''; E._save(); return 1");
      if (seen.some(Boolean)) return { ok: false, why: 'a phone has the DM’s encounter and its notes: ' + JSON.stringify(seen) };
      return { ok: true, lat: 6000 };
    });
    await step('DM hides a goblin on the map → it leaves the phone’s turn strip; revealed → back by name', async () => {
      const id = await dm.ev("const c = state.combatants.filter(c => !c.isPC).pop(); if (!c) return ''; c.e2eName = c.name; c.name = 'e2e Sneak'; save(); openPanel('battlemap'); await new Promise(r=>setTimeout(r,300)); const B = panelDefs.battlemap; B._tokens = B._tokens.filter(t => t.id !== 'e2e-sneak'); B._tokens.push({ id: 'e2e-sneak', cid: c.id, label: 'e2e Sneak', x: 400, y: 300, size: 1, hidden: true }); B._saveMap(); B._render(); return c.id");
      if (!id) return { ok: false, why: 'no monster in the fight' };
      const strip = "(document.querySelector('#pa-turn') || {}).textContent || ''";
      const t1 = await W(pl, "paRender(); return state.combatants.some(c => c.name === 'e2e Sneak') && (JSON.parse(localStorage.getItem('skt-battlemap-v1') || '{}').tokens || []).some(t => t.id === 'e2e-sneak' && t.hidden) && !(" + strip + ").includes('e2e Sneak') ? 1 : 0", 10000);
      if (t1 == null) return { ok: false, why: 'phone: ' + await pl.ev("paRender(); const el = document.querySelector('#pa-turn'); return JSON.stringify({ strip: " + strip + ", el: !!el, hidden: el && el.hidden, names: state.combatants.map(c => c.name), tok: (JSON.parse(localStorage.getItem('skt-battlemap-v1') || '{}').tokens || []).filter(t => t.id === 'e2e-sneak'), shared: [...paShared()] })") };
      await dm.ev("const B = panelDefs.battlemap; const t = B._tokens.find(t => t.id === 'e2e-sneak'); delete t.hidden; B._saveMap(); B._render(); return 1");
      const t2 = await W(pl, "paRender(); return (" + strip + ").includes('e2e Sneak') ? 1 : 0", 10000);
      // Tidy: its name back, the token gone.
      await dm.ev("const c = state.combatants.find(c => c.id === " + JSON.stringify(id) + "); if (c && c.e2eName){ c.name = c.e2eName; delete c.e2eName; save(); } const B = panelDefs.battlemap; B._tokens = B._tokens.filter(t => t.id !== 'e2e-sneak'); B._saveMap(); B._render(); return 1");
      if (t2 == null) return { ok: false, why: 'revealed, but not back in the phone’s strip' };
      return lat(t1);
    });
    await step('DM damages a goblin → both phones', async () => {
      const r = await dm.ev("const i = state.combatants.findIndex(c=>!c.isPC); panelDefs.combat._applyHpDelta(i, -3, 'slashing'); return { id: state.combatants[i].id, hp: state.combatants[i].hp }");
      const js = "return (state.combatants.find(c=>c.id==='" + r.id + "')||{}).hp === " + r.hp;
      const [a, b] = await Promise.all([W(pl, js), W(p2, js)]);
      return a != null && b != null ? { ok: true, lat: Math.max(a, b) } : { ok: false, why: 'phone1 ' + a + ' phone2 ' + b };
    });

    // ── The map: real mouse and touch strokes ───────────────────────────────
    const drawCount = "return (JSON.parse(localStorage.getItem('skt-battlemap-v1')||'{}').drawings||[]).filter(s=>s && s.k!=='tpl').length";
    await step('DM draws on the map (mouse) → phone', async () => {
      await pl.ev("paTab='map'; paRender(); await new Promise(r=>setTimeout(r,1200)); return 1");
      const n0 = await dm.ev(drawCount);
      const box = await dm.ev("const w = document.querySelector('.window[data-panel=\"battlemap\"]'); w.querySelector('[data-mact=\"tool-draw\"]').click(); await new Promise(r=>setTimeout(r,200)); const c = w.querySelector('canvas.draw-canvas, #draw-canvas, canvas[data-layer=\"draw\"]') || [...w.querySelectorAll('canvas')].find(c => getComputedStyle(c).pointerEvents !== 'none'); const r = c.getBoundingClientRect(); const v = w.querySelector('.window-body').getBoundingClientRect(); return { x: Math.max(r.x, v.x) + 60, y: Math.max(r.y, v.y) + 120, cls: c.className || c.id }");
      await dm.drag([[box.x, box.y], [box.x + 30, box.y + 10], [box.x + 60, box.y + 30], [box.x + 90, box.y + 20], [box.x + 120, box.y + 40]]);
      await W(dm, drawCount + ' === ' + (n0 + 1), 3000);
      const n1 = await dm.ev(drawCount);
      if (n1 !== n0 + 1) return { ok: false, why: 'stroke not made on the DM (' + n0 + '→' + n1 + ', canvas ' + box.cls + ')' };
      return lat(await W(pl, drawCount.replace('return ', 'return ') + ' === ' + n1 + ' && panelDefs.battlemap._drawings.filter(s=>s&&s.k!=="tpl").length === ' + n1));
    });
    await step('phone draws on the map (touch) → DM', async () => {
      const n0 = await dm.ev(drawCount);
      // A pop-up an earlier step left (an initiative ask, a save) sits over the map; a player would close it first.
      const leftOver = await pl.ev("const o = [...document.querySelectorAll('.pa-init, #pa-roll-req, #pa-rest')].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed'); o.forEach(e => { const x = e.querySelector('[data-pa-cs=\"ok\"], .pa-init-close, [data-close], [data-rest=\"cancel\"]'); if (x) x.click(); }); await new Promise(r=>setTimeout(r,200)); document.querySelectorAll('.pa-init, #pa-roll-req, #pa-rest').forEach(e => e.remove()); return o.map(e => e.id || e.className).join(',')");
      const box = await pl.ev("const b = document.querySelector('#pa-screen [data-pa-draw=\"tool-draw\"]'); if (!b) throw new Error('no draw button on the phone'); b.click(); await new Promise(r=>setTimeout(r,300)); const c = [...document.querySelectorAll('#pa-screen canvas')].find(c => getComputedStyle(c).pointerEvents !== 'none'); if (!c) throw new Error('no drawable canvas'); const r = c.getBoundingClientRect(); /* bare map to draw on: earlier steps put a fight's tokens about the middle, and a finger landing on one moves it instead (that made this step fail now and then) */ const clear = (x, y) => [0, 25, 50, 80].every(dx => { const e = document.elementFromPoint(x + dx, y + 20); return e && !e.closest('.map-token, .map-token-name, button'); }); for (let fy = 0.2; fy <= 0.8; fy += 0.05) for (let fx = 0.1; fx <= 0.6; fx += 0.05){ const x = r.x + r.width * fx, y = r.y + r.height * fy; if (clear(x, y)) return { x, y }; } return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.4, crowded: true }");
      await pl.drag([[box.x, box.y], [box.x + 25, box.y + 15], [box.x + 50, box.y + 35], [box.x + 80, box.y + 30]], true);
      await W(pl, drawCount + ' === ' + (n0 + 1), 3000);
      const n1 = await pl.ev(drawCount);
      if (n1 !== n0 + 1) return { ok: false, why: 'stroke not made on the phone (' + n0 + '→' + n1 + ')' + (box.crowded ? ' — no bare map to start on' : '') + ' — under the finger: ' + await pl.ev('const e = document.elementFromPoint(' + box.x + ', ' + box.y + '); return e ? (e.className || e.tagName) : null') };
      return lat(await W(dm, drawCount + ' === ' + n1 + ' && panelDefs.battlemap._drawings.filter(s=>s&&s.k!=="tpl").length === ' + n1));
    });
    await step('phone Undo its stroke → DM', async () => {
      const n0 = await pl.ev(drawCount);
      await pl.ev("const b = document.querySelector('#pa-screen [data-pa-draw=\"undo\"]'); b.click(); return 1");
      await W(pl, drawCount + ' === ' + (n0 - 1), 3000);
      const n1 = await pl.ev(drawCount);
      window.__undoInfo = await pl.ev("return { mem: panelDefs.battlemap._drawings.filter(s=>s&&s.k!=='tpl').length }");
      if (n1 !== n0 - 1) return { ok: false, why: 'undo did nothing on the phone (' + n0 + '→' + n1 + ')' };
      const t = await W(dm, drawCount + ' === ' + n1);
      return t == null ? { ok: false, why: 'never arrived: phone ' + n1 + ' (in memory ' + JSON.stringify(window.__undoInfo) + '), DM ' + await dm.ev(drawCount) + ', phone server copy after 10s ' + await pl.ev(drawCount) } : { ok: true, lat: t };
    });
    await step('DM erases its stroke (mouse) → phone', async () => {
      const n0 = await dm.ev(drawCount);
      const pt = await dm.ev("const B = panelDefs.battlemap; const s = B._drawings.filter(s=>s&&s.k!=='tpl').slice(-1)[0]; const w = document.querySelector('.window[data-panel=\"battlemap\"]'); w.querySelector('[data-mact=\"tool-erase\"]').click(); await new Promise(r=>setTimeout(r,200)); const c = [...w.querySelectorAll('canvas')].find(c => getComputedStyle(c).pointerEvents !== 'none'); const r = c.getBoundingClientRect(); const k = r.width / (c.width / (B._canvasK ? B._canvasK() : 1)); return { x: s.p[4], y: s.p[5], rx: r.x, ry: r.y, rw: r.width, cw: c.width }");
      // Stage → screen: find the point by asking the panel itself.
      const scr = await dm.ev("const B = panelDefs.battlemap; const w = document.querySelector('.window[data-panel=\"battlemap\"]'); const c = [...w.querySelectorAll('canvas')].find(c => getComputedStyle(c).pointerEvents !== 'none'); const r = c.getBoundingClientRect(); for (let y = r.y; y < r.y + Math.min(r.height, 700); y += 2) for (let x = r.x; x < r.x + Math.min(r.width, 900); x += 2){ const p = B._stagePoint(x, y, c); if (Math.abs(p.x - " + pt.x + ") < 2 && Math.abs(p.y - " + pt.y + ") < 2) return { x, y }; } return null");
      if (!scr) return { ok: false, why: 'could not place the eraser' };
      await dm.drag([[scr.x, scr.y], [scr.x + 2, scr.y + 2]]);
      const n1 = await dm.ev(drawCount);
      if (n1 !== n0 - 1) return { ok: false, why: 'erase did nothing on the DM (' + n0 + '→' + n1 + ')' };
      return lat(await W(pl, drawCount + ' === ' + n1));
    });
    await step('DM moves a token (drag) → phone', async () => {
      const t = await dm.ev("const w = document.querySelector('.window[data-panel=\"battlemap\"]'); const tb = w.querySelector('[data-mact=\"tool-erase\"]'); if (panelDefs.battlemap._tool) { panelDefs.battlemap._tool=''; panelDefs.battlemap._render(); await new Promise(r=>setTimeout(r,200)); } const pick = () => [...w.querySelectorAll('.map-token')].find(e => { const r = e.getBoundingClientRect(); if (!(r.width >= 3 && r.y > 120 && r.y < 800 && r.x > 60 && r.x < 1300)) return false; /* the one a press at its centre reaches: on a zoomed-out map, tokens a few pixels wide sit on top of each other */ const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return !!top && top.closest('.map-token') === e; }); let el = pick(); /* the test campaign keeps its map between runs and this drag walks a token further each time: when none is in view, fit the map to the window */ if (!el){ try { panelDefs.battlemap._fitMapToView(); } catch(e){} await new Promise(r=>setTimeout(r,300)); el = pick(); } if (!el) return null; const r = el.getBoundingClientRect(); const tok = panelDefs.battlemap._tokens.find(x => String(x.id) === el.dataset.tid); return { id: el.dataset.tid, x: r.x + r.width/2, y: r.y + r.height/2, cs: panelDefs.battlemap._cellSize, before: [tok.x, tok.y] }");
      if (!t) return { ok: false, why: 'no token on the DM map: ' + await dm.ev("const w = document.querySelector('.window[data-panel=\"battlemap\"]'); const wr = w && w.getBoundingClientRect(); return 'window ' + (wr ? [wr.x, wr.y, wr.width, wr.height].map(Math.round).join(',') : 'none') + ' tokens ' + panelDefs.battlemap._tokens.length + ' els ' + [...(w ? w.querySelectorAll('.map-token') : [])].slice(0, 6).map(e => { const r = e.getBoundingClientRect(); return Math.round(r.x) + ',' + Math.round(r.y) + 'w' + Math.round(r.width); }).join(' ')") };
      await dm.drag([[t.x, t.y], [t.x + 20, t.y + 10], [t.x + 60, t.y + 30], [t.x + 3 * t.cs, t.y + 2 * t.cs]]);
      const after = await dm.ev("const tok = panelDefs.battlemap._tokens.find(x => String(x.id) === '" + t.id + "'); return [tok.x, tok.y]");
      if (after[0] === t.before[0] && after[1] === t.before[1]) return { ok: false, why: 'token did not move on the DM' };
      return lat(await W(pl, "const tok = (JSON.parse(localStorage.getItem('skt-battlemap-v1')).tokens||[]).find(x => String(x.id) === '" + t.id + "'); return tok && tok.x === " + after[0] + " && tok.y === " + after[1]));
    });

    await step('phone adds itself to the map → DM', async () => {
      const zt = "return (JSON.parse(localStorage.getItem('skt-battlemap-v1')||'{}').tokens||[]).filter(t => t.isPC && t.label === 'Zoey').length";
      await dm.ev("const B = panelDefs.battlemap; B._tokens = B._tokens.filter(t => !(t.isPC && t.label === 'Zoey')); B._saveMap(); return 1");
      if (await W(pl, zt + ' === 0') == null) return { ok: false, why: 'phone never lost the token' };
      await pl.ev("paTab = 'map'; paRender(); await new Promise(r=>setTimeout(r,1200)); return 1");
      const offered = await pl.ev("return [...document.querySelectorAll('#pa-screen [data-mact=\"add-party\"]')].map(b => b.textContent.trim())");
      if (offered.length !== 1 || !/Zoey/.test(offered[0])) return { ok: false, why: 'phone offered ' + JSON.stringify(offered) };
      await pl.ev("document.querySelector('#pa-screen [data-mact=\"add-party\"]').click(); return 1");
      return lat(await W(dm, zt + ' === 1'));
    });

    await step('phone moves its own token → DM; a monster it can’t move → the DM’s stays put', async () => {
      const pos = id => "const t = (panelDefs.battlemap._tokens||[]).find(t => " + id + "); return t ? Math.round(t.x) + ',' + Math.round(t.y) : null";
      const ZOEY = "t.isPC && t.label === 'Zoey'";
      // The phone's map holds its tokens once its Map tab has been opened.
      await pl.ev("paTab = 'map'; paRender(); await new Promise(r=>setTimeout(r,900)); return 1");
      // A monster on the DM's map, in plain sight.
      await dm.ev("const B = panelDefs.battlemap; B._fog = null; B._tokens = B._tokens.filter(t => t.id !== 'e2e-ogre'); const z = B._tokens.find(t => " + ZOEY + "); B._tokens.push({ id: 'e2e-ogre', label: 'E2E Ogre', isPC: false, x: (z ? z.x : 200) + B._csScreen() * 3, y: z ? z.y : 200, size: 2 }); B._saveMap(); B._renderTokens(); return 1");
      if (await W(pl, pos("t.id === 'e2e-ogre'") + ' ? 1 : 0') == null) return { ok: false, why: 'the ogre never reached the phone' };
      const ogre0 = await dm.ev(pos("t.id === 'e2e-ogre'"));
      await pl.ev("paRender(); await new Promise(r=>setTimeout(r,600)); return 1");
      const drag = id => "const B = panelDefs.battlemap; const t = B._tokens.find(t => " + id + "); const el = t && document.querySelector('#pa-screen .map-token[data-tid=\"' + t.id + '\"]'); if (!el) return 'no element'; const r = el.getBoundingClientRect(), cx = r.left + r.width/2, cy = r.top + r.height/2; el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, clientX:cx, clientY:cy, button:0})); for (let i = 1; i <= 6; i++){ document.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, clientX:cx + i*14, clientY:cy + i*6})); await new Promise(r=>setTimeout(r,20)); } document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:cx + 84, clientY:cy + 36})); return 'done'";
      const r1 = await pl.ev(drag("t.id === 'e2e-ogre'"));
      const r2 = await pl.ev(drag(ZOEY));
      if (r1 !== 'done' || r2 !== 'done') return { ok: false, why: 'phone drag: ' + r1 + ' / ' + r2 };
      const zPhone = await pl.ev(pos(ZOEY));
      const t = await W(dm, 'return (' + "(() => { " + pos(ZOEY) + " })()" + ') === ' + JSON.stringify(zPhone));
      if (t == null) return { ok: false, why: 'Zoey’s move never reached the DM (' + zPhone + ')' };
      await sleep(1500);
      const ogre1 = await dm.ev(pos("t.id === 'e2e-ogre'")), ogreP = await pl.ev(pos("t.id === 'e2e-ogre'"));
      await dm.ev("const B = panelDefs.battlemap; B._tokens = B._tokens.filter(t => t.id !== 'e2e-ogre'); B._saveMap(); B._renderTokens(); return 1");
      if (ogre1 !== ogre0 || ogreP !== ogre0) return { ok: false, why: 'the ogre moved: DM ' + ogre0 + ' → ' + ogre1 + ', phone ' + ogreP };
      return lat(t);
    });

    await step('phone flies Zoey 20 ft up (Height) → DM; DM’s hidden area stays off the phone, its difficult terrain and an emanation on Zoey reach it', async () => {
      const ZOEY = "t.isPC && t.label === 'Zoey'";
      await pl.ev("paTab = 'map'; paRender(); await new Promise(r=>setTimeout(r,900)); for (const s of ['.pa-init', '#pa-rest', '#pa-roll-req']) document.querySelectorAll(s).forEach(e => e.remove()); return 1");
      const opened = await pl.ev("const b = document.querySelector('#pa-screen [data-pa-draw=\"height\"]'); if (!b) return 'no Height button'; b.click(); await new Promise(r=>setTimeout(r,200)); const up = () => document.querySelector('#pa-screen .pa-height-ctl [data-pa-draw=\"elev-up\"]'); if (!up()) return 'no up'; const me = paMyToken(); if (me && me.elev) panelDefs.battlemap._setElev(me, 0); await new Promise(r=>setTimeout(r,200)); for (let i = 0; i < 4; i++){ up().click(); await new Promise(r=>setTimeout(r,120)); } return 'ok ' + (paMyToken() || {}).elev");
      if (!/^ok 20$/.test(opened)) return { ok: false, why: 'phone height: ' + opened };
      const t = await W(dm, "const z = (panelDefs.battlemap._tokens||[]).find(t => " + ZOEY + "); return z && z.elev === 20 ? 1 : 0");
      if (t == null) return { ok: false, why: 'Zoey’s height never reached the DM: ' + await dm.ev("const z = (panelDefs.battlemap._tokens||[]).find(t => " + ZOEY + "); return z && z.elev") };
      await dm.ev("const B = panelDefs.battlemap, z = B._tokens.find(t => " + ZOEY + "), cs = B._csScreen(); B._drawings = B._drawings.filter(s => !(s && /^e2e-/.test(s.id || ''))); B._drawings.push({ k: 'tpl', id: 'e2e-hid', shape: 'circle', x: z.x + cs * 4, y: z.y, ft: 10, c: '#ff0000', dm: true }, { k: 'tpl', id: 'e2e-dt', shape: 'terrain', x: z.x + cs, y: z.y + cs, x2: z.x + cs * 3, y2: z.y + cs * 3 }, { k: 'tpl', id: 'e2e-aura', shape: 'aura', tok: z.id, ft: 10, x: z.x, y: z.y, c: '#e8c547' }); B._saveMap(); B._renderAreas(); return 1");
      const got = await W(pl, "const B = panelDefs.battlemap, ids = (B._drawings||[]).map(s => s && s.id); return ids.includes('e2e-dt') && ids.includes('e2e-aura') ? 1 : 0");
      if (got == null) return { ok: false, why: 'the terrain and emanation never reached the phone' };
      const seen = await pl.ev("const B = panelDefs.battlemap; B._renderAreas(); await new Promise(r=>setTimeout(r,200)); return JSON.stringify({ areas: B._areas().map(a => a.id).filter(x => /^e2e-/.test(x)), rough: B._terrain().map(a => a.id), hidDrawn: !!document.querySelector('#pa-screen #tpl-layer [data-tpl=\"e2e-hid\"]'), dtDrawn: !!document.querySelector('#pa-screen #tpl-layer [data-dt=\"e2e-dt\"]'), auraDrawn: !!document.querySelector('#pa-screen #tpl-layer [data-tpl=\"e2e-aura\"]') })");
      const s = JSON.parse(seen);
      // Tidy: down to the ground, areas gone.
      await pl.ev("const me = paMyToken(); if (me) panelDefs.battlemap._setElev(me, 0); paHeightOpen = false; return 1");
      await dm.ev("const B = panelDefs.battlemap; B._drawings = B._drawings.filter(s => !(s && /^e2e-/.test(s.id || ''))); B._saveMap(); B._renderAreas(); return 1");
      if (s.hidDrawn || s.areas.includes('e2e-hid')) return { ok: false, why: 'the hidden area shows on the phone: ' + seen };
      if (!s.dtDrawn || !s.auraDrawn || !s.rough.includes('e2e-dt')) return { ok: false, why: 'phone map: ' + seen };
      return lat(t);
    });

    await step('DM makes the map dark → phone shades it; phone lights a torch → DM sees Zoey carrying it', async () => {
      const ZOEY = "t.isPC && t.label === 'Zoey'";
      await dm.ev("const B = panelDefs.battlemap; B._light = 'dark'; B._saveMap(); B._render(); return 1");
      const t1 = await W(pl, "return panelDefs.battlemap._light === 'dark' && !!document.querySelector('#pa-screen #sight-layer') ? 1 : 0");
      if (t1 == null) return { ok: false, why: 'the phone never went dark: ' + await pl.ev("return panelDefs.battlemap._light") };
      const lit = await pl.ev("paTab = 'map'; paRender(); await new Promise(r=>setTimeout(r,600)); for (const s of ['.pa-init', '#pa-rest', '#pa-roll-req']) document.querySelectorAll(s).forEach(e => e.remove()); if (!paHeightOpen){ const b = document.querySelector('#pa-screen [data-pa-draw=\"height\"]'); if (!b) return 'no button'; b.click(); await new Promise(r=>setTimeout(r,200)); } const sel = document.querySelector('#pa-screen [data-pa-light]'); if (!sel) return 'no light picker'; sel.value = 'torch'; sel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r=>setTimeout(r,200)); return 'ok'");
      if (lit !== 'ok') return { ok: false, why: 'phone: ' + lit };
      const t2 = await W(dm, "const z = (panelDefs.battlemap._tokens||[]).find(t => " + ZOEY + "); return z && z.lt && z.lt.b === 20 ? 1 : 0");
      // Tidy: torch out, back to daylight.
      await pl.ev("const me = paMyToken(); if (me) panelDefs.battlemap._setTokenLight(me, 'none'); paHeightOpen = false; return 1");
      await dm.ev("const B = panelDefs.battlemap; B._light = 'bright'; B._saveMap(); B._render(); return 1");
      if (t2 == null) return { ok: false, why: 'the torch never reached the DM' };
      return lat(t2);
    });

    await step('phone pings the map → the DM sees it, with Zoey’s name; the DM pings → the phone sees it', async () => {
      await dm.ev("openPanel('battlemap'); await new Promise(r=>setTimeout(r,300)); document.querySelectorAll('.map-ping').forEach(e => e.remove()); return 1");
      await pl.ev("paTab = 'map'; paRender(); await new Promise(r=>setTimeout(r,500)); document.querySelectorAll('.map-ping').forEach(e => e.remove()); panelDefs.battlemap._ping(321, 234); return 1");
      const t1 = await W(dm, "const p = [...document.querySelectorAll('#map-stage .map-ping')].find(e => /Zoey/i.test(e.textContent)); return p && Math.abs(p.offsetLeft + p.offsetWidth / 2 - 321) < 2 ? 1 : 0", 8000);
      if (t1 == null) return { ok: false, why: 'the DM never saw the phone’s ping' };
      await dm.ev("panelDefs.battlemap._ping(150, 160); return 1");
      const t2 = await W(pl, "return [...document.querySelectorAll('#map-stage .map-ping')].some(e => /DM/.test(e.textContent)) ? 1 : 0", 8000);
      if (t2 == null) return { ok: false, why: 'the phone never saw the DM’s ping' };
      return lat(t1);
    });

    await step('phone measures → the DM sees Zoey’s ruler and its feet; put away → gone; the DM’s reaches the phone only with “Show players”', async () => {
      await dm.ev("openPanel('battlemap'); await new Promise(r=>setTimeout(r,300)); localStorage.setItem('skt-bm-ruler-share-v1', '0'); return 1");
      const lbl = await pl.ev("paTab = 'map'; paRender(); await new Promise(r=>setTimeout(r,500)); const B = panelDefs.battlemap, cs = B._csScreen(); B._tool = 'ruler'; B._render(); B._measureShow(2.5 * cs, 2.5 * cs, 2.5 * cs, 6.5 * cs); return document.querySelector('#map-stage .bm-measure:not(.remote) .bm-measure-l').textContent");
      // (what the phone's own label says, whatever this campaign's grid is left as)
      const t1 = await W(dm, "return [...document.querySelectorAll('#map-stage .bm-measure.remote')].some(e => e.textContent === 'Zoey: ' + " + JSON.stringify(lbl) + ") ? 1 : 0", 8000);
      if (t1 == null) return { ok: false, why: 'the DM never saw the phone’s ruler' };
      await pl.ev("const B = panelDefs.battlemap; B._tool = ''; B._measureHide(); B._render(); return 1");
      const t2 = await W(dm, "return document.querySelector('#map-stage .bm-measure.remote') ? 0 : 1", 8000);
      if (t2 == null) return { ok: false, why: 'the phone’s ruler stayed on the DM’s screen once put away' };
      await dm.ev("const B = panelDefs.battlemap, cs = B._csScreen(); B._tool = 'ruler'; B._render(); B._measureShow(1.5 * cs, 1.5 * cs, 5.5 * cs, 1.5 * cs); return 1");
      await sleep(2500);
      const leak = await pl.ev("return document.querySelector('#map-stage .bm-measure.remote') ? 1 : 0");
      if (leak) return { ok: false, why: 'the DM’s ruler reached the phone without “Show players”' };
      await dm.ev("const B = panelDefs.battlemap; localStorage.setItem('skt-bm-ruler-share-v1', '1'); B._measureShow(1.5 * cs0(), 1.5 * cs0(), 5.5 * cs0(), 1.5 * cs0()); function cs0(){ return B._csScreen(); } return 1");
      const t3 = await W(pl, "return [...document.querySelectorAll('#map-stage .bm-measure.remote')].some(e => /^DM: [0-9]+ ft/.test(e.textContent)) ? 1 : 0", 8000);
      await dm.ev("const B = panelDefs.battlemap; B._tool = ''; B._measureHide(); B._render(); localStorage.setItem('skt-bm-ruler-share-v1', '0'); return 1");
      if (t3 == null) return { ok: false, why: 'with “Show players” the phone never saw the DM’s ruler' };
      const t4 = await W(pl, "return document.querySelector('#map-stage .bm-measure.remote') ? 0 : 1", 8000);
      if (t4 == null) return { ok: false, why: 'the DM’s ruler stayed on the phone once put away' };
      return lat(t1);
    });

    await step('DM puts a picture of its own on a monster’s token (a noisy photo, the biggest kind) → the phone’s map shows it; ✕ → its own again', async () => {
      const len = await dm.ev("openPanel('battlemap'); await new Promise(r=>setTimeout(r,300)); const B = panelDefs.battlemap, cs = B._csScreen(); B._tokens = B._tokens.filter(t => t.id !== 'e2e-pic'); const t = { id: 'e2e-pic', label: 'e2e Captain', x: 7.5 * cs, y: 7.5 * cs, size: 1, icon: '🗡' }; B._tokens.push(t); B._render();"
        + " const c = document.createElement('canvas'); c.width = c.height = 600; const g = c.getContext('2d'), d = g.createImageData(600, 600); for (let i = 0; i < d.data.length; i++) d.data[i] = (Math.random() * 256) | 0; g.putImageData(d, 0, 0);"
        + " const f = new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'noise.png', { type: 'image/png' }); await B._setTokenPicture(t, f); return t.portrait.length");
      const t1 = await W(pl, "paTab = 'map'; paRender(); const im = document.querySelector('#map-stage .map-token[data-tid=\"e2e-pic\"] img'); return im && /^data:image/.test(im.getAttribute('src')) && im.getAttribute('src').length === " + len + " ? 1 : 0", 12000);
      if (t1 == null) return { ok: false, why: 'the phone never showed the picture (' + len + ' characters)' };
      await dm.ev("const B = panelDefs.battlemap; await B._setTokenPicture(B._tokens.find(t => t.id === 'e2e-pic'), null); return 1");
      const t2 = await W(pl, "paRender(); const el = document.querySelector('#map-stage .map-token[data-tid=\"e2e-pic\"]'); return el && !el.querySelector('img') ? 1 : 0", 12000);
      await dm.ev("const B = panelDefs.battlemap; B._tokens = B._tokens.filter(t => t.id !== 'e2e-pic'); B._saveMap(); B._render(); return 1");
      if (t2 == null) return { ok: false, why: '✕ didn’t reach the phone' };
      return { ok: true, lat: t1, why: undefined };
    });

    await step('DM puts a door beside Zoey → phone taps it open → the DM sees it open; DM locks it → phone can’t', async () => {
      const ZOEY = "t.isPC && t.label === 'Zoey'";
      const put = await dm.ev("openPanel('battlemap'); await new Promise(r=>setTimeout(r,300)); const B = panelDefs.battlemap, cs = B._csScreen(); const z = (B._tokens||[]).find(t => " + ZOEY + "); if (!z) return 'no Zoey on the map'; B._drawings = B._drawings.filter(s => s.id !== 'e2e-door'); B._drawings.push({ k: 'tpl', id: 'e2e-door', shape: 'wall', door: true, pts: [z.x - cs / 2, z.y + cs / 2, z.x + cs / 2, z.y + cs / 2] }); B._saveMap(); B._render(); return 'ok'");
      if (put !== 'ok') return { ok: false, why: 'DM: ' + put };
      await pl.ev("paTab = 'map'; paRender(); return 1");
      const seen = await W(pl, "return document.querySelector('#pa-screen [data-door-h=\"e2e-door\"]') ? 1 : 0", 10000);
      if (seen == null) return { ok: false, why: 'the phone never showed the door’s handle' };
      const tapped = await pl.ev("const B = panelDefs.battlemap, d = B._drawings.find(s => s.id === 'e2e-door'); const m = B._doorMid(d); B._tapMap(m.x, m.y); return d.open ? 'open' : 'shut'");
      if (tapped !== 'open') return { ok: false, why: 'the phone’s tap left it ' + tapped };
      const t1 = await W(dm, "const d = panelDefs.battlemap._drawings.find(s => s.id === 'e2e-door'); return d && d.open ? 1 : 0", 10000);
      if (t1 == null) return { ok: false, why: 'the DM never saw it open' };
      await dm.ev("const B = panelDefs.battlemap, d = B._drawings.find(s => s.id === 'e2e-door'); d.locked = true; delete d.open; B._saveMap(); B._render(); return 1");
      const t2 = await W(pl, "const d = panelDefs.battlemap._drawings.find(s => s.id === 'e2e-door'); return d && d.locked && !d.open ? 1 : 0", 10000);
      if (t2 == null) return { ok: false, why: 'the lock never reached the phone' };
      const tried = await pl.ev("const B = panelDefs.battlemap, d = B._drawings.find(s => s.id === 'e2e-door'); const m = B._doorMid(d); B._tapMap(m.x, m.y); return d.open ? 'open' : 'shut'");
      await dm.ev("const B = panelDefs.battlemap; B._drawings = B._drawings.filter(s => s.id !== 'e2e-door'); B._saveMap(); B._render(); return 1");
      if (tried !== 'shut') return { ok: false, why: 'the phone opened a locked door' };
      return lat(t1);
    });

    await step('DM adds a floor and goes up → the phone shows the upper floor (its name, its tokens); back down → the ground floor', async () => {
      const prep = await dm.ev("openPanel('battlemap'); await new Promise(r=>setTimeout(r,300)); const B = panelDefs.battlemap; try { localStorage.removeItem('skt-bm-floors-v1'); } catch(e){} B._floors = undefined; B._floorName = null; B._tokens = B._tokens.filter(t => !/^e2e-fl/.test(t.id)); B._tokens.push({ id: 'e2e-fl-g', label: 'e2e Ground goblin', x: 120, y: 120, size: 1 }); B._saveMap(); B._render(); return 'ok'");
      if (prep !== 'ok') return { ok: false, why: 'DM: ' + prep };
      await W(pl, "paTab = 'map'; paRender(); return (panelDefs.battlemap._tokens || []).some(t => t.id === 'e2e-fl-g') ? 1 : 0", 10000);
      const up = await dm.ev("const B = panelDefs.battlemap; B._floors = { active: 'fl_e2eA', list: [{ id: 'fl_e2eA', name: 'e2e Ground', snap: null }, { id: 'fl_e2eB', name: 'e2e Tower top', snap: Object.assign(B._blankFloorSnap(), { tokens: [{ id: 'e2e-fl-h', label: 'e2e Harpy', x: 160, y: 160, size: 1 }] }) }] }; B._floorName = 'e2e Ground'; B._switchFloor('fl_e2eB'); return B._floorName");
      if (up !== 'e2e Tower top') return { ok: false, why: 'DM switch: ' + up };
      const t1 = await W(pl, "const B = panelDefs.battlemap; const f = document.querySelector('#pa-screen .map-foot'); return B._floorName === 'e2e Tower top' && (B._tokens || []).some(t => t.id === 'e2e-fl-h') && !(B._tokens || []).some(t => t.id === 'e2e-fl-g') && f && /e2e Tower top/.test(f.textContent) ? 1 : 0", 12000);
      if (t1 == null) return { ok: false, why: 'the phone never went up: ' + await pl.ev("const B = panelDefs.battlemap; return B._floorName + ' ' + (B._tokens || []).map(t => t.id).join(',')") };
      await dm.ev("panelDefs.battlemap._switchFloor('fl_e2eA'); return 1");
      const t2 = await W(pl, "const B = panelDefs.battlemap; return B._floorName === 'e2e Ground' && (B._tokens || []).some(t => t.id === 'e2e-fl-g') && !(B._tokens || []).some(t => t.id === 'e2e-fl-h') ? 1 : 0", 12000);
      // Tidy: a plain map, the goblin gone.
      await dm.ev("const B = panelDefs.battlemap; try { localStorage.removeItem('skt-bm-floors-v1'); } catch(e){} B._floors = undefined; B._floorName = null; B._tokens = B._tokens.filter(t => !/^e2e-fl/.test(t.id)); B._saveMap(); B._render(); return 1");
      if (t2 == null) return { ok: false, why: 'the phone never came back down' };
      return lat(t1);
    });

    await step('DM uploads a map (3000×4000) → phone draws it at the same size and grid', async () => {
      const geo = 'const B = panelDefs.battlemap; return [B._bgMapPath, B._bgMapNaturalW, B._bgMapNaturalH, B._cols, B._rows].join(" ")';
      const before = await dm.ev("return panelDefs.battlemap._bgMapPath || ''");
      await dm.ev("openPanel('battlemap'); await new Promise(r=>setTimeout(r,400)); const B = panelDefs.battlemap; B._openMapPicker(); for (let i = 0; i < 40 && !document.getElementById('mapsel-upload-input'); i++) await new Promise(r=>setTimeout(r,100));"
        + " const c = document.createElement('canvas'); c.width = 3000; c.height = 4000; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 3000, 4000); gr.addColorStop(0, '#2a5'); gr.addColorStop(1, '#a52'); g.fillStyle = gr; g.fillRect(0, 0, 3000, 4000); for (let i = 0; i < 400; i++){ g.fillStyle = 'hsl(' + (i * 37 % 360) + ',50%,50%)'; g.fillRect((i * 97) % 3000, (i * 131) % 4000, 60, 60); }"
        + " const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)); const dt = new DataTransfer(); dt.items.add(new File([blob], 'test-map.jpg', { type: 'image/jpeg' })); const inp = document.getElementById('mapsel-upload-input'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); return 1");
      const shared = await W(dm, "return /^sktblob:/.test(panelDefs.battlemap._bgMapPath || '') && panelDefs.battlemap._bgMapPath !== " + JSON.stringify(before), 30000);
      if (shared == null) return { ok: false, why: 'the DM never shared it' };
      const d = await dm.ev(geo);
      await pl.ev("paTab = 'map'; paRender(); return 1");
      const t = await W(pl, "const B = panelDefs.battlemap; return !!B && [B._bgMapPath, B._bgMapNaturalW, B._bgMapNaturalH, B._cols, B._rows].join(' ') === " + JSON.stringify(d), 30000);
      return t == null ? { ok: false, why: 'DM ' + d + ' · phone ' + await pl.ev(geo) } : { ok: true, lat: t };
    });

    // ── Handouts, roll requests, reactions ──────────────────────────────────
    await step('DM sends a handout → phone pops it up', async () => {
      await dm.ev("openPanel('handouts'); await new Promise(r=>setTimeout(r,300)); panelDefs.handouts.send({ title: 'Stress handout', text: 'A note from the DM', to: 'all' }); return 1");
      return lat(await W(pl, "return !!document.getElementById('pa-handout') && /Stress handout/.test(document.getElementById('pa-handout').textContent)"));
    });
    await step('phone closes the handout (Back button) → stays in the app', async () => {
      await pl.ev("window.dispatchEvent(new PopStateEvent('popstate', { state: { pa: 'base' } })); await new Promise(r=>setTimeout(r,200)); return 1");
      return { ok: await pl.ev("return !document.getElementById('pa-handout') && document.body.classList.contains('player-app')") };
    });
    await step('DM asks for a Perception check → both phones; both answer at once → DM gets both', async () => {
      await dm.ev("sktAskRoll({ kind: 'check', skill: 'perception', ab: 'WIS', pcs: ['zoey','namroc'] }); return 1");
      const shown = "return !!document.getElementById('pa-roll-req')";
      const [a, b] = await Promise.all([W(pl, shown), W(p2, shown)]);
      if (a == null || b == null) return { ok: false, why: 'request not shown: phone1 ' + a + ' phone2 ' + b };
      const answer = "const b = document.querySelector('#pa-roll-req [data-pa-rr=\"roll\"]'); b.click(); await new Promise(r=>setTimeout(r,200)); const s = document.querySelector('#pa-roll-req [data-pa-rr=\"send\"]'); if (s && !s.disabled) s.click(); return 1";
      await Promise.all([pl.ev(answer), p2.ev(answer)]);
      return lat(await W(dm, "const r = sktRollReq(); return r && r.answers && r.answers.zoey != null && r.answers.namroc != null"));
    });
    await step('DM offers a reaction prompt → phone answers → DM sees the answer', async () => {
      await dm.ev("const T = panelDefs.turnview; window.__ans = null; const o = T._onPromptChange; T._onPromptChange = function(){ if (state.prompt && state.prompt.answer) window.__ans = state.prompt.answer; return o.apply(this, arguments); }; return 1");
      await dm.ev("state.prompt = { id: 'p_stress', ts: Date.now(), attacker: 'Ogre', label: 'Greatclub', target: { id: 'zoey', name: 'Zoey' }, hit: true, total: 18, ac: 17, dmg: 12, type: 'bludgeoning', offers: [{ pcId: 'zoey', who: 'Zoey', key: 'uncanny', name: 'Uncanny Dodge', note: '', cost: '', ft: 0, preview: '12 → 6' }], answer: null }; save(); return 1");
      const t = await W(pl, "return !!document.querySelector('[data-pa-react]')");
      if (t == null) return { ok: false, why: 'prompt never shown on the phone' };
      await pl.ev("document.querySelector('[data-pa-react]').click(); return 1");
      return lat(await W(dm, "return !!(window.__ans && window.__ans.pcId === 'zoey')"));
    });

    // ── What a phone sends the DM's Turn View: a damage roll, a save spell ───
    const fight = "if (!state.combatants.some(c=>!c.isPC)){ const g = _5eData.find(r=>r.cat==='monster' && r.name==='Goblin'); panelDefs.combat.addMonster(g); } state.party.forEach((p,i)=>{ if (!state.combatants.some(c=>c.id===p.id)) panelDefs.combat._addPartyToCombat(i); }); state.combatRound = state.combatRound || 1; state.activeCombatantId = state.activeCombatantId || state.combatants[0].id; save(); openPanel('turnview'); await new Promise(r=>setTimeout(r,500)); return 1";
    await step('phone rolls damage → DM Turn View offers Apply; Apply hits the goblin → phone sees it', async () => {
      await dm.ev(fight);
      await pl.ev("const p = state.party.find(p=>p.id==='zoey'); sktKeepRoll(p, '9 piercing', { kind: 'dmg', label: 'E2E Shortsword damage', total: 9, type: 'piercing' }); return 1");
      const t = await W(dm, "const b = document.querySelector('.tv-dmgroll'); return !!(b && /E2E Shortsword damage/.test(b.textContent) && /Zoey/.test(b.textContent))");
      if (t == null) return { ok: false, why: 'the roll never reached the DM’s Turn View' };
      const g = await dm.ev("const T = panelDefs.turnview, g = state.combatants.find(c=>!c.isPC); T._armed = g.id; T._render(); document.querySelector('.tv-dmgroll [data-tv=\"dmgapply\"]').click(); await new Promise(r=>setTimeout(r,200)); if (T._pending) T._commit(T._pending, null); return { id: g.id, hp: (state.combatants.find(c=>c.id===g.id)||{}).hp }");
      const t2 = await W(pl, "return (state.combatants.find(c=>c.id==='" + g.id + "')||{}).hp === " + g.hp);
      return t2 == null ? { ok: false, why: 'the phone never saw the goblin at ' + g.hp } : { ok: true, lat: t };
    });
    await step('phone casts a save spell → DM Turn View offers the saves; Dismiss → phone’s request cleared', async () => {
      await dm.ev(fight);
      await pl.ev("const p = state.party.find(p=>p.id==='zoey'); p.castReq = [{ id: 'e2e_cast', spell: 'Fireball', lvl: 3, ab: 'DEX', dc: 15, dice: '8d6', type: 'fire', half: true, at: Date.now() }]; save(); return 1");
      const t = await W(dm, "const b = document.querySelector('.tv-castreq'); return !!(b && /Fireball/.test(b.textContent) && /DEX save DC 15/.test(b.textContent))");
      if (t == null) return { ok: false, why: 'the cast never reached the DM’s Turn View' };
      await dm.ev("document.querySelector('.tv-castreq [data-tv=\"castdrop\"]').click(); return 1");
      const t2 = await W(pl, "return !((state.party.find(p=>p.id==='zoey')||{}).castReq||[]).length");
      return t2 == null ? { ok: false, why: 'the phone still holds the request' } : { ok: true, lat: t };
    });

    // ── Shared windows, loot, notes, time, weather, settings, books ─────────
    await step('DM shares Loot, adds an item → phone has the tab and the item', async () => {
      await dm.ev("if (!state.sharedPanels.includes('loot')) state.sharedPanels.push('loot'); saveSharedPanels(); const L = JSON.parse(localStorage.getItem('skt-loot-v1')||'{}'); const items = Array.isArray(L) ? L : (L.items || []); const it = { id: 'loot_stress', name: 'Stress Gem', qty: 1, value: 50 }; if (Array.isArray(L)) { if (!L.some(x => x.id === 'loot_stress')) L.push(it); localStorage.setItem('skt-loot-v1', JSON.stringify(L)); } else { L.items = items.filter(x => x.id !== 'loot_stress').concat([it]); localStorage.setItem('skt-loot-v1', JSON.stringify(L)); } return 1");
      return lat(await W(pl, "return paVisibleTabs().some(t=>t.id==='loot') && (localStorage.getItem('skt-loot-v1')||'').includes('Stress Gem')"));
    });
    await step('DM puts a note in players’ Notes → phone sees it', async () => {
      await dm.ev("openPanel('notes'); await new Promise(r=>setTimeout(r,400)); const N = panelDefs.notes; N._data.items.push({ id: 'n_stress', type: 'file', name: 'Stress note', parent: null, content: 'Visible to players', lineAuthors: [], shared: true }); N._save(); return 1");
      return lat(await W(pl, "return (JSON.parse(localStorage.getItem('skt-notes-v2')||'{}').items||[]).some(i => i.id === 'n_stress' && i.shared === true)"));
    });
    await step('phone writes its own note → DM sees it', async () => {
      await pl.ev("paTab='notes'; paRender(); await new Promise(r=>setTimeout(r,600)); const b = document.querySelector('#pa-screen [data-player-new]'); if (!b) throw new Error('no + New note'); b.click(); await new Promise(r=>setTimeout(r,300)); const inp = document.querySelector('.modal input'); if (inp){ inp.value = 'Zoey stress note'; inp.dispatchEvent(new Event('input',{bubbles:true})); const ok = [...document.querySelectorAll('.modal button')].find(x => /create|ok|save|add/i.test(x.textContent)) || document.querySelector('.modal .btn.primary'); ok.click(); } await new Promise(r=>setTimeout(r,400)); const ta = document.querySelector('#note-player-text'); if (ta){ ta.value = 'Written on the phone'; ta.dispatchEvent(new Event('input',{bubbles:true})); ta.dispatchEvent(new Event('change',{bubbles:true})); ta.blur(); } return 1");
      return lat(await W(dm, "return (JSON.parse(localStorage.getItem('skt-notes-v2')||'{}').items||[]).some(i => i.owner === 'zoey' && /Written on the phone/.test(i.content||''))", 15000));
    });
    await step('DM +10m time button → phone clock', async () => {
      await dm.ev("openPanel('time'); await new Promise(r=>setTimeout(r,400)); window.__t0 = localStorage.getItem('skt-time-v1'); document.querySelector('.window[data-panel=\"time\"] [data-delta-m=\"10\"], [data-delta-m=\"10\"]').click(); return 1");
      const want = await dm.ev("return localStorage.getItem('skt-time-v1')");
      if (want === await dm.ev('return window.__t0')) return { ok: false, why: '+10m changed nothing on the DM' };
      return lat(await W(pl, "return localStorage.getItem('skt-time-v1') === " + JSON.stringify(want)));
    });
    await step('DM rolls weather → phone', async () => {
      await dm.ev("openPanel('weather'); await new Promise(r=>setTimeout(r,400)); panelDefs.weather._rollAndKeepHistory(); return 1");
      const want = await dm.ev("return localStorage.getItem('skt-weather-v2')");
      return lat(await W(pl, "return localStorage.getItem('skt-weather-v2') === " + JSON.stringify(want)));
    });
    await step('DM hides a book → phone’s sources follow', async () => {
      await dm.ev("const h = JSON.parse(localStorage.getItem('skt-books-hidden-v1')||'[]'); h.push('AU'); localStorage.setItem('skt-books-hidden-v1', JSON.stringify(h)); return 1");
      return lat(await W(pl, "return JSON.parse(localStorage.getItem('skt-books-hidden-v1')||'[]').includes('AU')"));
    });

    // ── Two people at once ──────────────────────────────────────────────────
    await step('DM and phone edit different characters at the same moment → both kept everywhere', async () => {
      await Promise.all([
        dm.ev("const p = state.party.find(p=>p.id==='ulrick'); window.__u = Math.max(1, p.hp - 2); " + setHp('ulrick', 'window.__u') + " return 1"),
        pl.ev("const p = state.party.find(p=>p.id==='zoey'); window.__z = Math.max(1, p.hp - 1); " + setHp('zoey', 'window.__z') + " return 1"),
      ]);
      const u = await dm.ev('return window.__u'), z = await pl.ev('return window.__z');
      const js = 'return ' + hpOf('ulrick') + ' === ' + u + ' && ' + hpOf('zoey') + ' === ' + z;
      const r = await Promise.all([W(dm, js), W(pl, js), W(p2, js)]);
      return r.every(x => x != null) ? { ok: true, lat: Math.max(...r) } : { ok: false, why: 'dm ' + r[0] + ' phone ' + r[1] + ' phone2 ' + r[2] + ' — ' + JSON.stringify(await Promise.all([dm, pl, p2].map(d => d.ev('return [' + hpOf('ulrick') + ',' + hpOf('zoey') + ']')))) + ' want ' + [u, z] };
    });
    await step('two phones damage the same goblin at once → every device agrees', async () => {
      const gid = await dm.ev("return state.combatants.find(c=>!c.isPC && c.hp > 4).id");
      await sleep(1500);
      await Promise.all([pl, p2].map(d => d.ev("const c = state.combatants.find(c=>c.id==='" + gid + "'); c.hp -= 1; localStorage.setItem('skt-combat-v1', JSON.stringify({ combatants: state.combatants, combatRound: state.combatRound, activeCombatantId: state.activeCombatantId })); return 1")));
      await sleep(4000);
      const vals = await Promise.all([dm, pl, p2].map(d => d.ev("return state.combatants.find(c=>c.id==='" + gid + "').hp")));
      return { ok: vals.every(v => v === vals[0]), why: 'dm/phone/phone2 = ' + vals.join('/') };
    });
    await step('a burst: DM changes HP 25 times in 2 s → phone ends on the last value', async () => {
      for (let k = 0; k < 25; k++){ await dm.ev(setHp('creambak', 10 + k) + " return 1"); await sleep(80); }
      return lat(await W(pl, 'return ' + hpOf('creambak') + ' === 34', 15000));
    });

    // ── Offline and back ────────────────────────────────────────────────────
    await step('phone offline; DM changes HP and draws; phone back online → catches up', async () => {
      await pl.offline(true); await sleep(1500);
      await dm.ev(setHp('ulrick', 7) + " return 1");
      const n = await dm.ev("const B = panelDefs.battlemap; B._drawings.push({ c: '#ff0000', s: 4, p: [10,10,40,40,80,60] }); B._saveMap(); " + drawCount.replace('return ', 'return '));
      await sleep(2500);
      const stale = await pl.ev('return ' + hpOf('ulrick'));
      await pl.offline(false);
      const t = await W(pl, 'return ' + hpOf('ulrick') + ' === 7 && ' + drawCount.replace('return ', '') + ' === ' + n, 45000);
      return t == null ? { ok: false, why: 'never caught up (offline it showed ' + stale + ')' } : { ok: true, lat: t };
    });
    await step('phone changes HP while offline → DM gets it when it reconnects', async () => {
      await pl.offline(true); await sleep(1000);
      await pl.ev(setHp('zoey', 11) + " return 1");
      await sleep(2500);
      await pl.offline(false);
      return lat(await W(dm, 'return ' + hpOf('zoey') + ' === 11', 45000));
    });
    await step('loot coins: the phone spends 10 gp offline while the DM adds 50 → both count, everywhere', async () => {
      // the same starting purse on both
      await dm.ev("openPanel('loot'); await new Promise(r=>setTimeout(r,400)); const L = panelDefs.loot; L._loot.gp = 100; L._save(); L._render(); return 1");
      const same = await W(pl, "return JSON.parse(localStorage.getItem('skt-loot-v1') || '{}').gp === 100 ? 1 : 0", 10000);
      if (same == null) return { ok: false, why: 'the phone never had the 100 gp' };
      await pl.offline(true); await sleep(1000);
      // the phone: 10 gp spent (as its Loot tab does it)
      await pl.ev("const L = panelDefs.loot; if (!L._loot){ L._loot = JSON.parse(localStorage.getItem('skt-loot-v1')); } L._loot.gp = (+L._loot.gp || 0) - 10; L._save(); return 1");
      await dm.ev("const L = panelDefs.loot; L._loot.gp = (+L._loot.gp || 0) + 50; L._save(); L._render(); return 1");
      await sleep(2500);
      await pl.offline(false);
      const t = await W(dm, "return JSON.parse(localStorage.getItem('skt-loot-v1') || '{}').gp === 140 ? 1 : 0", 45000);
      if (t == null) return { ok: false, why: 'the DM ended at ' + await dm.ev("return JSON.parse(localStorage.getItem('skt-loot-v1') || '{}').gp") + ' gp, not 140' };
      const p = await W(pl, "return JSON.parse(localStorage.getItem('skt-loot-v1') || '{}').gp === 140 ? 1 : 0", 20000);
      if (p == null) return { ok: false, why: 'the phone ended at ' + await pl.ev("return JSON.parse(localStorage.getItem('skt-loot-v1') || '{}').gp") + ' gp, not 140' };
      return lat(t);
    });
    await step('loot: two quick changes on one device count once (100 gp, spend 10, then a copper: 90, not 80)', async () => {
      await dm.ev("openPanel('loot'); await new Promise(r=>setTimeout(r,400)); const L = panelDefs.loot; L._loot.gp = 100; L._loot.cp = 0; L._save(); L._render(); return 1");
      const same = await W(pl, "return JSON.parse(localStorage.getItem('skt-loot-v1') || '{}').gp === 100 ? 1 : 0", 10000);
      if (same == null) return { ok: false, why: 'the phone never had the 100 gp' };
      await sleep(1500);
      // A slow connection: the server's answer to each write takes 0.7 s to
      // come back, so the second change is made while the first is on its way.
      await dm.ev("window.__slowP = _pushWholeKey; _pushWholeKey = function(){ return __slowP.apply(this, arguments).then(r => new Promise(res => setTimeout(() => res(r), 700))); }; return 1");
      await dm.ev("const L = panelDefs.loot; L._loot.gp -= 10; L._save(); await new Promise(r => setTimeout(r, 330)); L._loot.cp += 1; L._save(); await new Promise(r => setTimeout(r, 330)); L._loot.cp += 1; L._save(); return 1");
      await sleep(3000);
      await dm.ev("_pushWholeKey = window.__slowP; return 1");
      const good = "const L = JSON.parse(localStorage.getItem('skt-loot-v1') || '{}'); return L.gp === 90 && L.cp === 2 ? 1 : 0";
      const show = "const L = JSON.parse(localStorage.getItem('skt-loot-v1') || '{}'); return L.gp + ' gp ' + L.cp + ' cp'";
      await sleep(4000);
      const t = await W(dm, good, 15000), p = await W(pl, good, 15000);
      if (t == null || p == null) return { ok: false, why: 'the DM has ' + await dm.ev(show) + ', the phone ' + await pl.ev(show) + ' (want 90 gp 2 cp)' };
      return lat(t);
    });
    await step('loot stack: the phone claims one of five offline while the DM splits one off → three left, both new rows kept', async () => {
      await dm.ev("openPanel('loot'); await new Promise(r=>setTimeout(r,400)); const L = panelDefs.loot; L._loot.items = (L._loot.items || []).filter(x => x.name !== 'E2E Potion').concat([{ id: 'e2e_pot', name: 'E2E Potion', qty: 5, value: '50 gp', assignedTo: null }]); L._save(); L._render(); return 1");
      const same = await W(pl, "return (JSON.parse(localStorage.getItem('skt-loot-v1') || '{}').items || []).some(x => x.id === 'e2e_pot' && +x.qty === 5) ? 1 : 0", 10000);
      if (same == null) return { ok: false, why: 'the phone never had the five' };
      await pl.offline(true); await sleep(1000);
      await pl.ev("const L = JSON.parse(localStorage.getItem('skt-loot-v1')); sktLootSplit(L, 'e2e_pot', 'zoey'); saveJson('skt-loot-v1', L, 'loot'); if (panelDefs.loot) panelDefs.loot._loot = null; return 1");
      await dm.ev("const L = panelDefs.loot; sktLootSplit(L._loot, 'e2e_pot', null); L._save(); L._render(); return 1");
      await sleep(2500);
      await pl.offline(false);
      const good = "const a = (JSON.parse(localStorage.getItem('skt-loot-v1') || '{}').items || []).filter(x => x.name === 'E2E Potion'); return a.length === 3 && +a.find(x => x.id === 'e2e_pot').qty === 3 && a.some(x => x.assignedTo === 'zoey' && +x.qty === 1) && a.filter(x => !x.assignedTo).length === 2 ? 1 : 0";
      const show = "return JSON.stringify((JSON.parse(localStorage.getItem('skt-loot-v1') || '{}').items || []).filter(x => x.name === 'E2E Potion').map(x => x.qty + ':' + (x.assignedTo || 'party')))";
      const t = await W(dm, good, 45000);
      if (t == null) return { ok: false, why: 'the DM ended with ' + await dm.ev(show) + ', the phone with ' + await pl.ev(show) };
      const p = await W(pl, good, 20000);
      if (p == null) return { ok: false, why: 'the phone ended with ' + await pl.ev(show) };
      await dm.ev("const L = panelDefs.loot; L._loot.items = L._loot.items.filter(x => x.name !== 'E2E Potion'); L._save(); L._render(); return 1");
      return lat(t);
    });
    await step('loot ↔ the player’s own sheet: claimed in the Loot window → on the phone’s open inventory; its count; ↩ on the phone → the party’s; Claim 1 on the phone → one theirs', async () => {
      const inv = "paTab='you'; if (!document.querySelector('#pa-screen .cs-inv')){ paRender(); await new Promise(r=>setTimeout(r,150)); const tb = document.querySelector('#pa-screen [data-cs-tab=\"inventory\"]'); if (tb){ tb.click(); await new Promise(r=>setTimeout(r,200)); } } ";
      const mine = "[...document.querySelectorAll('#pa-screen .cs-lootitem')].find(r => r.textContent.includes('E2E Lantern'))";
      const pile = "[...document.querySelectorAll('#pa-screen .cs-partylootitem')].find(r => r.textContent.includes('E2E Rations'))";
      await dm.ev("openPanel('loot'); await new Promise(r=>setTimeout(r,400)); const L = panelDefs.loot; L._loot.items = (L._loot.items || []).filter(x => !/^E2E (Lantern|Rations)/.test(x.name)).concat([{ id: 'e2e_lan', name: 'E2E Lantern', qty: 1, value: '5 gp', assignedTo: null }, { id: 'e2e_rat', name: 'E2E Rations', qty: 4, value: '5 sp', assignedTo: null }]); L._view = 'all'; L._save(); L._render(); return 1");
      await pl.ev(inv + "return 1");
      if (await W(pl, inv + "return " + pile + " ? 1 : 0", 15000) == null) return { ok: false, why: 'the phone’s sheet never listed the party’s new rations' };
      // the DM gives the lantern to Zoey, from the Loot window's dropdown
      await dm.ev("const L = panelDefs.loot; const s = L._body.querySelector('.loot-item[data-id=\"e2e_lan\"] [data-lfield=\"assignedTo\"]'); s.value = 'zoey'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1");
      const t = await W(pl, inv + "return " + mine + " ? 1 : 0", 15000);
      if (t == null) return { ok: false, why: 'the lantern never showed in Zoey’s inventory on the phone' };
      await dm.ev("const L = panelDefs.loot; const q = L._body.querySelector('.loot-item[data-id=\"e2e_lan\"] [data-lfield=\"qty\"]'); q.value = '2'; q.dispatchEvent(new Event('change', { bubbles: true })); return 1");
      if (await W(pl, inv + "const r = " + mine + "; return r && /×2/.test(r.querySelector('.cs-qty').textContent) ? 1 : 0", 15000) == null) return { ok: false, why: 'the count of 2 never reached the phone’s sheet' };
      // the phone gives it back, and claims one ration
      await pl.ev(inv + "document.querySelector('#pa-screen [data-cs-lootback=\"e2e_lan\"]').click(); await new Promise(r=>setTimeout(r,300)); document.querySelector('#pa-screen [data-cs-lootclaimone=\"e2e_rat\"]').click(); return 1");
      const back = await W(dm, "const L = panelDefs.loot; const a = L._loot.items; const lan = a.find(x => x.id === 'e2e_lan'), r = a.filter(x => x.name === 'E2E Rations'); return lan && !lan.assignedTo && r.length === 2 && r.some(x => x.assignedTo === 'zoey' && +x.qty === 1) && +r.find(x => x.id === 'e2e_rat').qty === 3 && L._body.querySelector('.loot-item[data-id=\"e2e_lan\"] [data-lfield=\"assignedTo\"]').value === '' ? 1 : 0", 20000);
      if (back == null) return { ok: false, why: 'the DM’s Loot window ended with ' + await dm.ev("return JSON.stringify(panelDefs.loot._loot.items.filter(x => /^E2E/.test(x.name)).map(x => x.name + ' ' + x.qty + ':' + (x.assignedTo || 'party')))") };
      await dm.ev("const L = panelDefs.loot; L._loot.items = L._loot.items.filter(x => !/^E2E (Lantern|Rations)/.test(x.name)); L._save(); L._render(); return 1");
      return lat(t);
    });
    await step('phone messages the DM → the DM has it; the DM answers → the phone has it', async () => {
      const tag = 'e2e ' + Date.now().toString(36);
      await pl.ev("sktMsgSend('dm', " + JSON.stringify(tag + ' from Zoey') + "); return 1");
      const t = await W(dm, "return sktMsgThread('zoey').some(m => m.text === " + JSON.stringify(tag + ' from Zoey') + ") ? 1 : 0", 15000);
      if (t == null) return { ok: false, why: 'the DM never got the message' };
      await dm.ev("sktMsgSend('zoey', " + JSON.stringify(tag + ' from the DM') + "); return 1");
      const p = await W(pl, "return sktMsgThread('zoey').some(m => m.text === " + JSON.stringify(tag + ' from the DM') + " && m.from === 'dm') ? 1 : 0", 15000);
      if (p == null) return { ok: false, why: 'the phone never got the answer' };
      return lat(t);
    });
    await step('phone rolls with My dice (its own d20 typed in) → the DM’s game log has the total, rolled at the table', async () => {
      const r = await pl.ev("localStorage.setItem('skt-own-dice-v1', '1'); paTab = 'you'; paRender(); await new Promise(r => setTimeout(r, 300)); const t = document.querySelector('#pa-screen [data-cs-tab=\"abilities\"]'); if (t){ t.click(); await new Promise(r => setTimeout(r, 200)); } const b = document.querySelector('#pa-screen [data-cs-roll=\"init\"]'); if (!b) return 'no initiative box'; b.click(); await new Promise(r => setTimeout(r, 150)); const box = document.getElementById('pa-roll'); const inp = box && box.querySelector('[data-cs-owndie]'); if (!inp) return 'not asked'; inp.value = '13'; box.querySelector('[data-cs=\"owndie\"]').click(); await new Promise(r => setTimeout(r, 150)); localStorage.removeItem('skt-own-dice-v1'); const last = (paPc().rolls || [])[0]; return last ? last.total : 'nothing kept'");
      if (typeof r !== 'number') return { ok: false, why: 'on the phone: ' + r };
      const t = await W(dm, "return sktLogEntries().some(e => e.pcId === 'zoey' && e.total === " + r + " && /rolled at the table/.test(e.text || '')) ? 1 : 0", 15000);
      if (t == null) return { ok: false, why: 'the DM’s log never showed Zoey’s ' + r };
      return lat(t);
    });
    await step('DM long rest → phone back to full', async () => {
      await dm.ev("panelDefs.party._applyLongRest(); return 1");
      const want = await dm.ev('return ' + hpOf('zoey'));
      return lat(await W(pl, 'return ' + hpOf('zoey') + ' === ' + want));
    });
    await step('phone Change character → picker, pick Creambak → DM sees nothing broken', async () => {
      await pl.ev("paTab='more'; paRender(); await new Promise(r=>setTimeout(r,200)); document.querySelector('#pa-screen [data-pa-swap]').click(); await new Promise(r=>setTimeout(r,200)); document.querySelector('#pa-screen [data-pa-pick=\"creambak\"]').click(); await new Promise(r=>setTimeout(r,300)); return 1");
      return { ok: await pl.ev("return paPc() && paPc().id === 'creambak' && paTab === 'you'") };
    });

    for (const d of [dm, pl, p2]) await d.shot(S + d.name + '.png');
  } catch(e){ console.log('DRIVER FAILED', e.message); }
  finally {
    const errs = {}; for (const d of [dm, pl, p2].filter(Boolean)) errs[d.name] = [...new Set(d.errors)].slice(0, 10);
    const dbx = [dm, pl, p2].filter(Boolean).reduce((n, d) => n + d.dbx.length, 0);
    console.log('\npage errors', JSON.stringify(errs, null, 1), '\nrequests to Dropbox:', dbx);
    console.log(results.filter(r => r.ok).length + '/' + results.length + ' passed');
    fs.writeFileSync(S + 'results.json', JSON.stringify(results, null, 1));
    process.exitCode = results.every(r => r.ok) ? 0 : 1;
    [dm, pl, p2].forEach(d => d && d.close());
  }
})();
