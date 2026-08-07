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
  const a = { preset:'desktop', url:null, out:null, full:false, wait:400,
              evalJs:null, seed:null, tour:false, player:false, size:null,
              touch:null, port:9377 };
  for (let i = 0; i < argv.length; i++){
    const k = argv[i];
    if      (k === '--preset') a.preset = argv[++i];
    else if (k === '--url')    a.url    = argv[++i];
    else if (k === '--out')    a.out    = argv[++i];
    else if (k === '--size')   a.size   = argv[++i];
    else if (k === '--wait')   a.wait   = parseInt(argv[++i], 10) || 0;
    else if (k === '--eval')   a.evalJs = argv[++i];
    else if (k === '--seed')   a.seed   = argv[++i];
    else if (k === '--tour')   a.tour   = true;
    else if (k === '--port')   a.port   = parseInt(argv[++i], 10);
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
  console.log('  --seed JS  runs BEFORE page scripts (use for localStorage setup)');
  console.log('  --eval JS  runs AFTER load (use to open panels, click things)');
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

  const proc = spawn(chrome, [
    '--headless=new',
    '--remote-debugging-port=' + a.port,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--force-device-scale-factor=1',   // dpr comes from the emulation override
    'about:blank',
  ], { stdio: 'ignore' });

  let code = 0;
  let ws = null;
  try {
    const list = await fetchJson('http://127.0.0.1:' + a.port + '/json/list', 60, 120);
    if (!list) throw new Error('Chrome never opened a debugging port on ' + a.port);
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
    if (!a.tour){
      seedParts.push("localStorage.setItem('skt-tutorial-seen-v2','1');"
                   + "localStorage.setItem('skt-pv-dock-hint-seen','1');");
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
    await sleep(a.wait);

    if (a.evalJs){
      const r = await cdp.send('Runtime.evaluate', {
        expression: a.evalJs, awaitPromise: true, returnByValue: true,
      });
      if (r.exceptionDetails) throw new Error('--eval threw: ' + r.exceptionDetails.text);
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

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: !!a.full,
    });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

    const bytes = fs.statSync(out).size;
    console.log('[shot] ' + out);
    console.log('[shot] ' + info.w + 'x' + info.h + ' @' + info.dpr + 'x'
      + '  coarse=' + info.coarse + '  phoneLayout=' + info.phoneLayout
      + '  player=' + info.playerMode + '  ' + Math.round(bytes/1024) + 'KB');
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
    proc.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch(e){}
  }
  await sleep(50);
  process.exit(code);
})();
