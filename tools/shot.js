#!/usr/bin/env node
// ============================================================
// SCREENSHOT THE SITE AT A GIVEN DEVICE SIZE
// ============================================================
// Writes a PNG so it can be looked at directly, instead of the layout only
// ever being verified by measuring the DOM.
//
// Zero install: drives the Chrome that's already on this machine over the
// DevTools protocol, using Node's built-in WebSocket (Node >= 22). No
// Playwright, no Puppeteer, no browser download.
//
// Why not just size the window: the phone layout is gated on
// `(max-width: 768px) and (pointer: coarse)`, so a narrow DESKTOP window
// deliberately does NOT trigger it. Only real device emulation
// (Emulation.setDeviceMetricsOverride mobile:true + touch emulation) flips
// the pointer to coarse. The tool asserts the query actually matched before
// it shoots, so a silently-wrong screenshot isn't possible.
//
//   node tools/shot.js                          # desktop, default page
//   node tools/shot.js --preset mobile
//   node tools/shot.js --preset mobile --player
//   node tools/shot.js --preset mobile --full   # whole scroll height
//   node tools/shot.js --size 844x390 --touch   # landscape phone
//   node tools/shot.js --eval "openPanel('battlemap')" --wait 1200
//   node tools/shot.js --state skt-backup-2026-08-14.json   # the REAL campaign
//
// --state loads a Settings → Export backup into localStorage before the page
// boots. Firebase rules require auth, so the live campaign can't be read
// directly; an exported backup is the only way this tool sees real data
// instead of whatever synthetic fight --seed invents.
//
// Needs the static server up (tools are served over http, not file://):
//   python -m http.server 8765
//
// The default URL carries ?nosync=1 on purpose — screenshots should never
// write to the live campaign.

const { spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ── Presets ───────────────────────────────────────────────────────────────
// dpr 2 on the small screens because the point is to READ the result; a
// 390px-wide shot at dpr 1 is too coarse to judge type and spacing.
const PRESETS = {
  desktop:   { w: 1440, h: 900,  dpr: 1, mobile: false, touch: false },
  laptop:    { w: 1280, h: 800,  dpr: 1, mobile: false, touch: false },
  tablet:    { w: 820,  h: 1180, dpr: 2, mobile: true,  touch: true  },
  'tablet-l':{ w: 1180, h: 820,  dpr: 2, mobile: true,  touch: true  },
  mobile:    { w: 390,  h: 844,  dpr: 2, mobile: true,  touch: true  },
  'mobile-l':{ w: 844,  h: 390,  dpr: 2, mobile: true,  touch: true  },
  'mobile-s':{ w: 360,  h: 740,  dpr: 2, mobile: true,  touch: true  },
};

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

// ── Args ──────────────────────────────────────────────────────────────────
function parseArgs(argv){
  const a = { preset:'desktop', url:null, out:null, full:false, wait:800,
              evalJs:null, evalFile:null, seed:null, ready:null, tour:false, player:false, size:null,
              touch:null, state:null };
  for (let i = 0; i < argv.length; i++){
    const k = argv[i];
    if      (k === '--preset') a.preset = argv[++i];
    else if (k === '--url')    a.url    = argv[++i];
    else if (k === '--out')    a.out    = argv[++i];
    else if (k === '--size')   a.size   = argv[++i];
    else if (k === '--wait')   a.wait   = parseInt(argv[++i], 10) || 0;
    else if (k === '--eval')   a.evalJs = argv[++i];
    // --eval-file keeps big batteries (tools/selftest.js) off the command
    // line; Windows caps a command at ~32KB and the suite is past that.
    else if (k === '--eval-file') a.evalFile = argv[++i];
    else if (k === '--seed')   a.seed   = argv[++i];
    else if (k === '--state')  a.state  = argv[++i];
    else if (k === '--ready')  a.ready  = argv[++i];
    else if (k === '--tour')   a.tour   = true;
    else if (k === '--full')   a.full   = true;
    else if (k === '--player') a.player = true;
    else if (k === '--touch')  a.touch  = true;
    else if (k === '--no-touch') a.touch = false;
    else if (k === '--help' || k === '-h'){ usage(); process.exit(0); }
    else { console.error('unknown arg: ' + k); usage(); process.exit(2); }
  }
  return a;
}
function usage(){
  console.log('usage: node tools/shot.js [--preset ' + Object.keys(PRESETS).join('|') + ']');
  console.log('       [--size WxH] [--touch|--no-touch] [--url URL] [--player]');
  console.log('       [--out FILE] [--full] [--wait MS] [--eval JS] [--seed JS] [--tour]');
  console.log('');
  console.log('       [--state BACKUP.json]');
  console.log('');
  console.log('  --state F  load a Settings → Export backup as the starting state');
  console.log('  --seed JS  runs BEFORE page scripts (use for localStorage setup)');
  console.log('  --eval JS  runs AFTER load (use to open panels, click things)');
  console.log('  --eval-file F  same, read from a file (no command-line size cap)');
  console.log('  --ready JS poll until truthy before shooting (default: workspace built)');
  console.log('  --tour     keep the onboarding overlay (suppressed by default)');
}

// ── Minimal CDP client ────────────────────────────────────────────────────
class CDP {
  constructor(ws){
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null){
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        // A CDP error is a normal response with an `error` member, not a
        // socket failure — surface it as a rejection or it looks like a hang.
        if (msg.error) p.reject(new Error(msg.method + ': ' + msg.error.message));
        else p.resolve(msg.result);
      } else {
        const h = this.handlers.get(msg.method);
        if (h) h(msg.params);
      }
    });
  }
  send(method, params){
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  once(method){
    return new Promise(resolve => {
      this.handlers.set(method, p => { this.handlers.delete(method); resolve(p); });
    });
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, tries, delay){
  for (let i = 0; i < tries; i++){
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch(e){ /* chrome not listening yet */ }
    await sleep(delay);
  }
  return null;
}

function findChrome(){
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────
(async function main(){
  const a = parseArgs(process.argv.slice(2));

  // Read the backup before spawning anything — a typo'd path should fail in a
  // millisecond, not after a browser launch.
  let stateKeys = null;
  if (a.state){
    let doc;
    try { doc = JSON.parse(fs.readFileSync(a.state, 'utf8')); }
    catch(e){ console.error('[shot] --state: ' + e.message); process.exit(2); }
    // Both shapes js/features/backup.js can write: the current wrapper, and a
    // bare {key: value} map for hand-assembled states.
    stateKeys = (doc && doc.keys && typeof doc.keys === 'object') ? doc.keys : doc;
    if (!stateKeys || typeof stateKeys !== 'object'){
      console.error('[shot] --state: not a backup file (no `keys`)'); process.exit(2);
    }
    // Values must be the raw strings localStorage holds. backup.js is careful
    // never to re-serialize them; anything else here means the file was
    // rewritten by something that was not careful, and restoring an object
    // would put "[object Object]" in localStorage.
    for (const k of Object.keys(stateKeys)){
      if (typeof stateKeys[k] !== 'string') stateKeys[k] = JSON.stringify(stateKeys[k]);
    }
    const n = Object.keys(stateKeys).length;
    const kb = Math.round(JSON.stringify(stateKeys).length / 1024);
    console.log('[shot] state: ' + n + ' keys, ' + kb + 'KB from ' + a.state);
    if (kb > 4500){
      console.error('[shot] WARNING: ' + kb + 'KB may exceed the localStorage quota; '
        + 'the app will boot with whatever fit and no error.');
    }
  }

  let dev = PRESETS[a.preset];
  if (a.size){
    const m = /^(\d+)x(\d+)$/.exec(a.size);
    if (!m){ console.error('--size wants WxH, e.g. 844x390'); process.exit(2); }
    // An explicit --size keeps the preset's other traits so
    // `--preset mobile --size 430x932` stays a touch device.
    dev = Object.assign({}, dev, { w: +m[1], h: +m[2] });
  }
  if (a.touch !== null) dev = Object.assign({}, dev, { touch: a.touch, mobile: a.touch });
  if (!dev){ console.error('unknown preset: ' + a.preset); usage(); process.exit(2); }

  const url = a.url
    || ('http://localhost:8765/skt-workspace.html?nosync=1' + (a.player ? '&player=1' : ''));
  const out = path.resolve(a.out
    || path.join('tools', 'shots', a.preset + (a.player ? '-player' : '') + '.png'));

  const chrome = findChrome();
  if (!chrome){
    console.error('No Chrome or Edge found. Looked in:\n  ' + CHROME_CANDIDATES.join('\n  '));
    process.exit(1);
  }

  // Fail with a useful message rather than a blank page if nothing is serving.
  try {
    const probe = await fetch(url, { method: 'GET' });
    if (!probe.ok) throw new Error('HTTP ' + probe.status);
  } catch(e){
    console.error('Cannot reach ' + url + '\n  ' + e.message);
    console.error('Is the static server up?  python -m http.server 8765');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'skt-shot-'));

  // Port 0 = let the OS choose, and read back what Chrome picked from
  // DevToolsActivePort in the profile dir. A fixed port meant a stray Chrome
  // left over from an interrupted run (a `| head` closing the pipe is enough)
  // kept listening, and the next run silently attached to that dead session
  // and hung instead of failing.
  const proc = spawn(chrome, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    // Software compositing. Headless GPU compositing on this machine returned
    // captures with the whole transformed #workspace-canvas layer missing.
    '--disable-gpu',
    '--force-device-scale-factor=1',   // dpr comes from the emulation override
    // Match the real browser window to the emulated viewport. Left at the
    // default 800x600, captures of the phone layout came back with the
    // position:fixed chrome (toolbar, dock) painted but the whole
    // #workspace-canvas subtree blank — that canvas carries a transform, so
    // it composites on its own layer, and its tiles were only rasterised for
    // the mismatched surface. The DOM was correct in every one of those runs;
    // only the picture was wrong, which is the worst possible failure for a
    // tool whose entire job is to be looked at.
    '--window-size=' + dev.w + ',' + dev.h,
    'about:blank',
  ], { stdio: 'ignore' });

  let code = 0;
  let ws = null;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 100 && port === null; i++){
      // Guarded: Chrome writes this file while we're polling for it, and on
      // Windows catching it mid-write throws EBUSY. That's a normal race, not
      // a failure — just try again on the next tick.
      try {
        if (fs.existsSync(portFile)){
          const first = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
          if (first) port = parseInt(first, 10);
        }
      } catch(e){ /* EBUSY / partial write — retry */ }
      if (port === null) await sleep(100);
    }
    if (!port) throw new Error('Chrome never reported a debugging port');

    const list = await fetchJson('http://127.0.0.1:' + port + '/json/list', 60, 120);
    if (!list) throw new Error('Chrome opened port ' + port + ' but served no target list');
    const page = list.find(t => t.type === 'page');
    if (!page) throw new Error('No page target');

    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', () => rej(new Error('CDP socket failed')));
    });
    const cdp = new CDP(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // Forward page errors. Without this a screenshot of a broken page looks
    // exactly like a screenshot of a working one, and the reason is sitting
    // unread in a console nobody is attached to.
    const pageErrors = [];
    cdp.handlers.set('Runtime.exceptionThrown', p => {
      const d = p && p.exceptionDetails;
      pageErrors.push((d && (d.exception && d.exception.description || d.text)) || 'error');
    });
    cdp.handlers.set('Runtime.consoleAPICalled', p => {
      if (p.type !== 'error' && p.type !== 'warning') return;
      pageErrors.push(p.type + ': ' + (p.args || [])
        .map(x => x.value !== undefined ? x.value : (x.description || x.type)).join(' '));
    });
    // Order matters: metrics and touch go on BEFORE the navigation, so
    // load-time device gates (matchMedia reads in window-manager.js,
    // battlemap's mount) see the phone and not a desktop.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: dev.w, height: dev.h, deviceScaleFactor: dev.dpr, mobile: !!dev.mobile,
    });
    // maxTouchPoints must be 1..16 — sending 0 to turn touch OFF is an error,
    // so the field is omitted entirely in that case.
    await cdp.send('Emulation.setTouchEmulationEnabled',
      dev.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    if (dev.touch){
      await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    }

    // Each run gets a throwaway Chrome profile, so localStorage starts empty
    // and the onboarding overlay covers everything. Seeding has to happen
    // BEFORE the page's own scripts read those keys, which --eval (post-load)
    // is too late for — hence addScriptToEvaluateOnNewDocument.
    const seedParts = [];
    // Never let the service worker register. Two reasons, both bit hard:
    //
    // Every run uses a fresh profile, so the SW installs and claims the client
    // — and js/app.js listens for `controllerchange` and calls
    // location.reload(). That reload navigated the target out from under the
    // CDP session mid-run: "Inspected target navigated or closed", reliably
    // on the first runs after a stamp changed sw.js.
    //
    // And a screenshot must show the files on disk. A cached shell served the
    // previous build twice today and both times the picture looked entirely
    // plausible while being of the wrong code.
    // A stub, not `undefined`: the app feature-detects with
    // `'serviceWorker' in navigator`, which stays true for an own property, so
    // removing the value just moved the failure to `.register` of undefined.
    // register() returns a promise that never settles, so no update path runs.
    seedParts.push(
      "try{var _swStub={register:function(){return new Promise(function(){})},"
      + "getRegistration:function(){return Promise.resolve(undefined)},"
      + "getRegistrations:function(){return Promise.resolve([])},"
      + "addEventListener:function(){},removeEventListener:function(){},"
      + "ready:new Promise(function(){}),controller:null};"
      + "Object.defineProperty(navigator,'serviceWorker',"
      + "{configurable:true,get:function(){return _swStub}})}catch(e){}");
    if (!a.tour){
      seedParts.push("localStorage.setItem('skt-tutorial-seen-v2','1');"
                   + "localStorage.setItem('skt-pv-dock-hint-seen','1');");
    }
    // Before --seed, so a --seed can still override one key of a real backup.
    if (stateKeys){
      seedParts.push('(function(){var S=' + JSON.stringify(stateKeys) + ';'
        + 'for(var k in S){try{localStorage.setItem(k,S[k])}catch(e){'
        + "console.error('seed quota: '+k)}}})();");
    }
    if (a.seed) seedParts.push(a.seed);
    if (seedParts.length){
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: 'try{' + seedParts.join('\n') + '}catch(e){console.error(e)}',
      });
    }

    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(20000)]);

    // load ≠ ready. The workspace builds itself after load (panels mount, the
    // workspace switcher renders), and a fixed sleep was a coin flip: about
    // half the runs captured a page with the toolbar and dock painted but the
    // entire workspace subtree still empty — a screenshot that looks like a
    // real one and shows a UI that never existed. Poll for a readiness
    // signal instead of guessing at a duration.
    // Default signal: the workspace switcher has been POPULATED by
    // workspaces.js. `.ws-switch` itself ships in the static HTML, so testing
    // for its existence — the obvious first guess — returns true immediately
    // and waits for nothing. Its children only appear once the app has built
    // the workspace, which is the thing worth waiting for. The player view has
    // no switcher, so its dock counts instead.
    // `.pa-tab` is the player app's tab strip. The older `.pv-dock-btn` no
    // longer exists — the player view was rebuilt around player-app.js — so
    // on its own it meant every --player run burned the full 10s poll and
    // then warned that a page which had built perfectly well was not ready.
    const readyExpr = a.ready
      || "!!(document.querySelector('.ws-switch')?.children.length"
       + " || document.querySelector('.pa-tab')"
       + " || document.querySelector('.pv-dock-btn'))";
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++){
      const rr = await cdp.send('Runtime.evaluate', {
        expression: readyExpr, returnByValue: true,
      }).catch(() => null);
      ready = !!(rr && rr.result && rr.result.value);
      if (!ready) await sleep(100);
    }
    if (!ready){
      console.error('[shot] WARNING: never became ready: ' + readyExpr);
      code = 5;
    }
    await sleep(a.wait);

    if (a.evalFile && !a.evalJs){
      try { a.evalJs = require('fs').readFileSync(a.evalFile, 'utf8'); }
      catch(e){ console.error('[shot] --eval-file: ' + e.message); process.exit(2); }
    }
    if (a.evalJs){
      const r = await cdp.send('Runtime.evaluate', {
        expression: a.evalJs, awaitPromise: true, returnByValue: true,
      });
      if (r.exceptionDetails){
        // .text is usually just "Uncaught" — the useful part is the thrown
        // value's description (message + stack).
        const d = r.exceptionDetails;
        const detail = (d.exception && (d.exception.description || d.exception.value))
          || d.text || 'unknown';
        throw new Error('--eval threw: ' + String(detail).split('\n').slice(0, 3).join(' | '));
      }
      // Print whatever it returned — --eval doubles as a probe, and silently
      // dropping the value meant writing a screenshot to inspect a number.
      if (r.result && r.result.value !== undefined){
        console.log('[eval] ' + (typeof r.result.value === 'string'
          ? r.result.value : JSON.stringify(r.result.value, null, 2)));
      }
      await sleep(a.wait);
    }

    // Report what the page actually believes it is. Without this a wrong
    // emulation would just produce a plausible-looking desktop screenshot
    // labelled "mobile".
    const probe = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `JSON.stringify({
        w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
        coarse: matchMedia('(pointer: coarse)').matches,
        phoneLayout: matchMedia('(max-width: 768px) and (pointer: coarse)').matches,
        playerMode: document.body.classList.contains('player-mode'),
        title: document.title
      })`,
    });
    const info = JSON.parse(probe.result.value);

    // --full captures the whole scroll height, so the clip needs the real
    // document height rather than the viewport's.
    let fullH = dev.h;
    if (a.full){
      const hr = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: 'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, innerHeight)',
      }).catch(() => null);
      if (hr && hr.result && hr.result.value) fullH = Math.min(hr.result.value, 20000);
    }

    // Nudge the compositor into committing a frame before asking for one.
    // An idle page (everything settled, nothing animating) commits no new
    // frame, and captureScreenshot then waits for one indefinitely — the hang
    // reproduced reliably on the phone layout with a panel open, while rAF
    // showed the page happily rendering at 68fps. Two frames: the first
    // flushes pending style and layout, the second is the one that gets
    // captured.
    await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
    }).catch(() => {});

    // Capture until two consecutive frames agree, then keep the biggest.
    //
    // Headless intermittently hands back a frame with the position:fixed
    // chrome painted and the transformed #workspace-canvas layer missing —
    // roughly one run in six even after the page has settled, and the DOM was
    // verified correct in every one of those runs. A screenshot that is wrong
    // but plausible is the worst thing this tool can produce, so one shot is
    // not trusted: a partial frame is dramatically smaller than a complete one
    // (24KB vs 40KB here), and two captures landing on the same byte length is
    // good evidence the compositor has stopped changing its mind.
    let best = null, prevLen = -1, stable = false;
    for (let attempt = 0; attempt < 4 && !stable; attempt++){
      const one = await captureOnce();
      const buf = Buffer.from(one.data, 'base64');
      if (!best || buf.length > best.length) best = buf;
      if (buf.length === prevLen) stable = true;
      prevLen = buf.length;
      if (!stable && attempt < 3) await sleep(250);
    }
    if (!stable){
      console.error('[shot] WARNING: frames never stabilised — kept the largest. '
        + 'Treat this image with suspicion and re-run.');
      code = 6;
    }
    fs.writeFileSync(out, best);

    async function captureOnce(){
    // captureScreenshot has been seen to never resolve — a page that stops
    // producing frames leaves the CDP request outstanding forever, and there
    // is no error to catch. Race it so the run fails loudly instead of
    // hanging until something else kills it.
    return Promise.race([
      // An explicit clip with captureBeyondViewport forces a fresh raster of
      // the requested region instead of reading back whatever the browser
      // window's compositor surface happens to hold. Without it, captures
      // came back with the position:fixed chrome painted and the transformed
      // #workspace-canvas layer blank — the DOM was correct in every one of
      // those runs, so only the picture lied.
      cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: {
          x: 0, y: 0,
          width: dev.w,
          height: a.full ? fullH : dev.h,
          // 1, not dev.dpr: setDeviceMetricsOverride already applies the
          // device scale factor, so passing it again here produced a 4x image.
          scale: 1,
        },
      }),
      sleep(20000).then(() => { throw new Error('captureScreenshot timed out after 20s'); }),
    ]);
    }

    const bytes = fs.statSync(out).size;
    console.log('[shot] ' + out);
    console.log('[shot] ' + info.w + 'x' + info.h + ' @' + info.dpr + 'x'
      + '  coarse=' + info.coarse + '  phoneLayout=' + info.phoneLayout
      + '  player=' + info.playerMode + '  ' + Math.round(bytes/1024) + 'KB');
    if (pageErrors.length){
      console.error('[shot] ' + pageErrors.length + ' page error(s):');
      pageErrors.slice(0, 8).forEach(m => console.error('  ' + String(m).split('\n')[0]));
      code = 4;
    }
    if (dev.touch && !info.coarse){
      console.error('[shot] WARNING: touch emulation did not produce pointer:coarse — '
        + 'the phone-only CSS is NOT in this screenshot.');
      code = 3;
    }
  } catch(e){
    console.error('[shot] ' + e.message);
    code = 1;
  } finally {
    // Close the socket BEFORE exiting. Tearing the process down with an open
    // libuv handle tripped an assertion in the Node runtime on the error path.
    try { if (ws) ws.close(); } catch(e){}
    // Chrome spawns a tree of renderer/GPU children; killing only the process
    // we spawned left them alive, and they accumulate across runs. /T takes
    // the tree. Scoped to OUR pid — never a blanket kill of chrome.exe, since
    // the user's own browser is running on this machine.
    if (process.platform === 'win32'){
      try {
        require('child_process').execFileSync(
          'taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' });
      } catch(e){ try { proc.kill(); } catch(e2){} }
    } else {
      try { proc.kill(); } catch(e){}
    }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch(e){}
  }
  await sleep(50);
  process.exit(code);
})();
