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
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const argv = process.argv.slice(2);
const argOf = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const CAMPAIGN = argOf('--campaign') || '';
if (!/^(stress-test|test-)[A-Za-z0-9_-]{0,30}$/.test(CAMPAIGN)){
  console.error('usage: node tools/sync-e2e.js --campaign stress-test-<something> [--only REGEX]');
  console.error('(the campaign id must start with stress-test or test-: this writes to live Firebase)');
  process.exit(2);
}
const BASE = 'http://localhost:8765/skt-workspace.html?c=' + CAMPAIGN;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
      if (m.id != null){ const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); m.error ? p.reject(new Error(p.method + ': ' + m.error.message)) : p.resolve(m.result); }
      else { const h = this.handlers.get(m.method); if (h) h(m.params); } }); }
  send(method, params){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params: params || {} })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method })); }
}
async function launch(name, { player, w, h, mobile, keys, seed }){
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'skt-dual-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-gpu', '--force-device-scale-factor=1', '--window-size=' + w + ',' + h, 'about:blank'], { stdio: 'ignore' });
  let port = null;
  for (let i = 0; i < 100 && !port; i++){ try { const f = path.join(profile, 'DevToolsActivePort'); if (fs.existsSync(f)) port = parseInt(fs.readFileSync(f, 'utf8').split('\n')[0], 10) || null; } catch(e){} if (!port) await sleep(100); }
  let list; for (let i = 0; i < 60 && !list; i++){ try { list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); } catch(e){ await sleep(120); } }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('cdp'))); });
  const cdp = new CDP(ws), errors = [], dbx = [];
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  cdp.handlers.set('Runtime.exceptionThrown', p => { const d = p.exceptionDetails; errors.push((d.exception && d.exception.description || d.text || '').split('\n').slice(0, 2).join(' | ')); });
  cdp.handlers.set('Runtime.consoleAPICalled', p => { if (p.type === 'error') errors.push('console: ' + (p.args || []).map(a => a.value !== undefined ? a.value : a.description).join(' ').slice(0, 220)); });
  cdp.handlers.set('Network.requestWillBeSent', p => { if (/dropbox(api)?.com/i.test(p.request.url)) dbx.push(p.request.url); });
  await cdp.send('Network.setBlockedURLs', { urls: ['*dropboxapi.com*', '*://*.dropbox.com/*', '*://dropbox.com/*'] });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
  if (mobile){ await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
  const camp = JSON.stringify([{ id: CAMPAIGN, name: 'Stress test', created: Date.now() }]);
  const parts = [
    // No service worker (it reloads the page out from under the driver).
    "var _sw={register:function(){return new Promise(function(){})},getRegistration:function(){return Promise.resolve()},getRegistrations:function(){return Promise.resolve([])},addEventListener:function(){},removeEventListener:function(){},ready:new Promise(function(){}),controller:null};Object.defineProperty(navigator,'serviceWorker',{configurable:true,get:function(){return _sw}});",
    // Dropbox can never be configured in this page.
    "Object.defineProperty(window,'DROPBOX_CONFIG',{configurable:false,get:function(){return {}},set:function(){}});",
    "if(!sessionStorage.getItem('dual-seeded')){sessionStorage.setItem('dual-seeded','1');",
    "localStorage.setItem('skt-tutorial-seen-v2','1');localStorage.setItem('skt-pv-dock-hint-seen','1');",
    "localStorage.setItem('skt-campaigns-v1'," + JSON.stringify(camp) + ");localStorage.setItem('skt-campaign-active-v1'," + JSON.stringify(CAMPAIGN) + ");",
    keys ? '(function(){var S=' + JSON.stringify(keys) + ';for(var k in S)localStorage.setItem(k,S[k]);})();' : '',
    seed || '', '}',
  ];
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{' + parts.join('\n') + '}catch(e){console.error("seed "+e)}' });
  await cdp.send('Page.navigate', { url: BASE + (player ? '&player=1' : '') });
  const dev = {
    name, cdp, errors, dbx,
    async ev(js){
      const r = await cdp.send('Runtime.evaluate', { expression: '(async()=>{' + js + '})()', awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(name + ': ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text).split('\n').slice(0, 3).join(' | '));
      return r.result.value;
    },
    async until(js, ms){ const t0 = Date.now(); while (Date.now() - t0 < (ms || 10000)){ try { if (await dev.ev(js)) return Date.now() - t0; } catch(e){} await sleep(150); } return null; },
    async drag(pts, touch){
      if (touch){
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
        for (const p of pts.slice(1)){ await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); await sleep(30); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0][0], y: pts[0][1] });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], button: 'left', clickCount: 1 });
        for (const p of pts.slice(1)){ await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1 }); await sleep(30); }
        const l = pts[pts.length - 1];
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l[0], y: l[1], button: 'left', clickCount: 1 });
      }
    },
    async tap(x, y, touch){ await dev.drag([[x, y]], touch); },
    async offline(on){ await cdp.send('Network.emulateNetworkConditions', { offline: !!on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); },
    async shot(file){ const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
    close(){ try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch(e){} }, 800); },
  };
  const ok = await dev.until("return !!(document.querySelector('.ws-switch')?.children.length || document.querySelector('.pa-tab'))", 30000);
  if (ok == null) throw new Error(name + ' never became ready');
  return dev;
}

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

    // ── Combat ──────────────────────────────────────────────────────────────
    await step('DM starts a fight, Next button → phone turn bar', async () => {
      await dm.ev("const mons = _5eData.filter(r=>r.cat==='monster' && r.name==='Goblin'); panelDefs.combat.addMonster(mons[0]); panelDefs.combat.addMonster(mons[0]); state.party.forEach((p,i)=>{ if (!state.combatants.some(c=>c.id===p.id)) panelDefs.combat._addPartyToCombat(i); }); state.combatRound = 1; state.activeCombatantId = state.combatants[0].id; save(); panelDefs.combat._render(); await new Promise(r=>setTimeout(r,300)); document.querySelector('.window[data-panel=\"combat\"] [data-act=\"next\"]').click(); return 1");
      const who = await dm.ev("return (state.combatants.find(c=>c.id===state.activeCombatantId)||{}).name");
      return lat(await W(pl, "return state.combatants.length >= 7 && (state.combatants.find(c=>c.id===state.activeCombatantId)||{}).name === " + JSON.stringify(who) + " && (document.querySelector('#pa-turn, .pa-turn')||document.body).textContent.includes(" + JSON.stringify(who.split(' ')[0]) + ")"));
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
      const box = await pl.ev("const b = document.querySelector('#pa-screen [data-pa-draw=\"tool-draw\"]'); if (!b) throw new Error('no draw button on the phone'); b.click(); await new Promise(r=>setTimeout(r,300)); const c = [...document.querySelectorAll('#pa-screen canvas')].find(c => getComputedStyle(c).pointerEvents !== 'none'); if (!c) throw new Error('no drawable canvas'); const r = c.getBoundingClientRect(); return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.4 }");
      await pl.drag([[box.x, box.y], [box.x + 25, box.y + 15], [box.x + 50, box.y + 35], [box.x + 80, box.y + 30]], true);
      await W(pl, drawCount + ' === ' + (n0 + 1), 3000);
      const n1 = await pl.ev(drawCount);
      if (n1 !== n0 + 1) return { ok: false, why: 'stroke not made on the phone (' + n0 + '→' + n1 + ')' };
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
      const t = await dm.ev("const w = document.querySelector('.window[data-panel=\"battlemap\"]'); const tb = w.querySelector('[data-mact=\"tool-erase\"]'); if (panelDefs.battlemap._tool) { panelDefs.battlemap._tool=''; panelDefs.battlemap._render(); await new Promise(r=>setTimeout(r,200)); } const el = [...w.querySelectorAll('.map-token')].find(e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.y > 120 && r.y < 800 && r.x > 60 && r.x < 1300; }); if (!el) return null; const r = el.getBoundingClientRect(); const tok = panelDefs.battlemap._tokens.find(x => String(x.id) === el.dataset.tid); return { id: el.dataset.tid, x: r.x + r.width/2, y: r.y + r.height/2, cs: panelDefs.battlemap._cellSize, before: [tok.x, tok.y] }");
      if (!t) return { ok: false, why: 'no token on the DM map' };
      await dm.drag([[t.x, t.y], [t.x + 20, t.y + 10], [t.x + 60, t.y + 30], [t.x + 3 * t.cs, t.y + 2 * t.cs]]);
      const after = await dm.ev("const tok = panelDefs.battlemap._tokens.find(x => String(x.id) === '" + t.id + "'); return [tok.x, tok.y]");
      if (after[0] === t.before[0] && after[1] === t.before[1]) return { ok: false, why: 'token did not move on the DM' };
      return lat(await W(pl, "const tok = (JSON.parse(localStorage.getItem('skt-battlemap-v1')).tokens||[]).find(x => String(x.id) === '" + t.id + "'); return tok && tok.x === " + after[0] + " && tok.y === " + after[1]));
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

    // ── Shared windows, loot, notes, time, weather, settings, books ─────────
    await step('DM shares Loot, adds an item → phone has the tab and the item', async () => {
      await dm.ev("if (!state.sharedPanels.includes('loot')) state.sharedPanels.push('loot'); saveSharedPanels(); const L = JSON.parse(localStorage.getItem('skt-loot-v1')||'{}'); const items = Array.isArray(L) ? L : (L.items || []); const it = { id: 'loot_stress', name: 'Stress Gem', qty: 1, value: 50 }; if (Array.isArray(L)) { L.push(it); localStorage.setItem('skt-loot-v1', JSON.stringify(L)); } else { L.items = items.concat([it]); localStorage.setItem('skt-loot-v1', JSON.stringify(L)); } return 1");
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
