// Shared by the sync tests (sync-e2e.js, sync-fight.js): one headless Chrome
// per device, each its own profile, driven over the DevTools protocol, with
// Dropbox cut off and the page seeded into a throwaway campaign.
//   const { launch, sleep } = require('./sync-lib')(campaignId);
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
class CDP {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
      if (m.id != null){ const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); m.error ? p.reject(new Error(p.method + ': ' + m.error.message)) : p.resolve(m.result); }
      else { const h = this.handlers.get(m.method); if (h) h(m.params); } }); }
  send(method, params){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params: params || {} })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method })); }
}
async function launch(name, { player, w, h, mobile, keys, seed, CAMPAIGN, BASE }){
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'skt-dual-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-gpu', '--force-device-scale-factor=1', '--window-size=' + w + ',' + h, 'about:blank'], { stdio: 'ignore' });
  let port = null;
  for (let i = 0; i < 100 && !port; i++){ try { const f = path.join(profile, 'DevToolsActivePort'); if (fs.existsSync(f)) port = parseInt(fs.readFileSync(f, 'utf8').split('\n')[0], 10) || null; } catch(e){} if (!port) await sleep(100); }
  let list; for (let i = 0; i < 60 && !list; i++){ try { list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); } catch(e){ await sleep(120); } }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('cdp'))); });
  const cdp = new CDP(ws), errors = [], dbx = [];
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  cdp.handlers.set('Runtime.exceptionThrown', p => { const d = p.exceptionDetails; errors.push((d.exception && d.exception.description || d.text || '').split('\n').slice(0, 2).join(' | ')); });
  cdp.handlers.set('Runtime.consoleAPICalled', p => { if (p.type === 'error') errors.push('console: ' + (p.args || []).map(a => a.value !== undefined ? a.value : a.description).join(' ').slice(0, 220)); });
  // Dropbox's hosts are refused outright. Through Fetch with URL patterns,
  // not the Network domain: Network reports EVERY request in full, and an
  // uploaded map is a multi-megabyte data: URL — Chrome stalled pushing that
  // to us and the page looked frozen. Fetch only ever sees the matches.
  const BLOCK = ['*dropboxapi.com*', '*://*.dropbox.com/*', '*://dropbox.com/*'].concat([]);
  cdp.handlers.set('Fetch.requestPaused', p => { if (/dropbox/i.test(p.request.url)) dbx.push(p.request.url); cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); });
  await cdp.send('Fetch.enable', { patterns: BLOCK.map(urlPattern => ({ urlPattern })) });
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
    async offline(on){ if (on) await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: !!on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); if (!on) await cdp.send('Network.disable'); },
    async shot(file){ const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
    async reload(){ await cdp.send('Page.reload', { ignoreCache: false }); await sleep(800); return dev.until("return !!(document.querySelector('.ws-switch')?.children.length || document.querySelector('.pa-tab'))", 30000); },
    close(){ try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch(e){} }, 800); },
  };
  const ok = await dev.until("return !!(document.querySelector('.ws-switch')?.children.length || document.querySelector('.pa-tab'))", 30000);
  if (ok == null) throw new Error(name + ' never became ready');
  return dev;
}

module.exports = CAMPAIGN => {
  if (!/^(stress-test|test-)/.test(CAMPAIGN || '')) throw new Error('the campaign id must start with stress-test or test-: this writes to live Firebase');
  const BASE = 'http://localhost:8765/skt-workspace.html?c=' + CAMPAIGN;
  return { launch: (name, o) => launch(name, Object.assign({ CAMPAIGN, BASE }, o)), sleep, CDP };
};
