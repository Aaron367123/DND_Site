#!/usr/bin/env node
// ============================================================
// PULL THE LIVE CAMPAIGN INTO A BACKUP FILE
// ============================================================
// Reads the campaign out of Firebase and writes it in the exact shape
// js/features/backup.js produces, so `shot.js --state` can boot the real
// table instead of a synthetic fight:
//
//   node tools/pull-state.js
//   node tools/shot.js --state .state/live.json --eval "openPanel('turnview')"
//
// WHY THIS IS READ-ONLY, structurally and not by convention:
//   • Every request is a GET. There is no code path here that can write.
//   • It never runs the app, so none of the app's own push logic exists in
//     this process. `shot.js` still loads the page with ?nosync=1.
//
// HOW IT AUTHENTICATES: firebase-rules.json grants `skt` to `auth != null`,
// so a read needs a session — and the app's session is ANONYMOUS. This asks
// for the same anonymous session every player's browser asks for on page
// load, using the public web API key that already ships in the repo. No
// private credential exists or is needed. The refresh token is cached in
// .state/ so this reuses one anonymous identity instead of minting a new one
// per run.
//
// The config is read out of js/sync/realtime.js rather than duplicated, so a
// project change can't leave this tool pointed at a dead database.

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const OUT_DIR  = path.join(ROOT, '.state');
const OUT_FILE = path.join(OUT_DIR, 'live.json');
const AUTH_FILE= path.join(OUT_DIR, 'auth.json');

// ── Config, read from the app ─────────────────────────────────────────────
function readConfig(){
  const src = fs.readFileSync(path.join(ROOT, 'js', 'sync', 'realtime.js'), 'utf8');
  const pick = re => { const m = re.exec(src); return m ? m[1] : null; };
  const apiKey = pick(/apiKey:\s*"([^"]+)"/);
  const dbUrl  = pick(/databaseURL:\s*"([^"]+)"/);
  if (!apiKey || !dbUrl) throw new Error('could not find apiKey/databaseURL in js/sync/realtime.js');
  return { apiKey, dbUrl: dbUrl.replace(/\/$/, '') };
}

// ── Auth ──────────────────────────────────────────────────────────────────
// Two paths: refresh a cached anonymous session, or mint one. Refresh first,
// so repeated runs don't accumulate anonymous users in the project.
async function getToken(cfg){
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch(e){}

  if (cached && cached.refreshToken){
    const r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + cfg.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(cached.refreshToken),
    });
    const j = await r.json().catch(() => ({}));
    if (j.id_token){
      save({ refreshToken: j.refresh_token || cached.refreshToken, uid: cached.uid || j.user_id });
      return { idToken: j.id_token, uid: cached.uid || j.user_id, fresh: false };
    }
    // A revoked or deleted anonymous user is expected eventually — fall
    // through and mint a new one rather than failing the run.
  }

  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + cfg.apiKey, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.idToken){
    const why = (j.error && j.error.message) || 'no idToken in response';
    throw new Error('anonymous sign-in failed: ' + why
      + (why === 'ADMIN_ONLY_OPERATION'
        ? '\n  → Authentication → Sign-in method → Anonymous is disabled in the Firebase console.' : ''));
  }
  save({ refreshToken: j.refreshToken, uid: j.localId });
  return { idToken: j.idToken, uid: j.localId, fresh: true };

  function save(o){
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(AUTH_FILE, JSON.stringify(o, null, 1));
    } catch(e){ /* a cache miss costs one extra anonymous user, not a run */ }
  }
}

// ── Read ──────────────────────────────────────────────────────────────────
async function get(cfg, tok, p, query){
  const url = cfg.dbUrl + '/' + p + '.json?auth=' + tok + (query ? '&' + query : '');
  const r = await fetch(url);
  const txt = await r.text();
  if (!r.ok) throw new Error('GET ' + p + ' → HTTP ' + r.status + ' ' + txt.slice(0, 200));
  return txt;
}

// ── Entity reassembly ─────────────────────────────────────────────────────
// Mirrors the assemble() functions in js/sync/realtime.js. The v2/v3 subtrees
// hold one node per combatant / token / note, and the app rebuilds the single
// localStorage string from them on receive; a snapshot has to do the same or
// combat and the map come back empty.
function assembleCombat(n){
  let meta = {}; try { meta = JSON.parse(n.meta || '{}') || {}; } catch(e){}
  const items = {};
  Object.keys(n).forEach(k => {
    if (!k.startsWith('items/')) return;
    // Keyed by node name, matching assemble() in realtime.js. Re-deriving
    // from c.id only agrees while ids are unique.
    try { const c = JSON.parse(n[k]); if (c) items[k.slice(6)] = c; } catch(e){}
  });
  const combatants = [], used = new Set();
  (Array.isArray(meta.order) ? meta.order : []).forEach(id => {
    if (items[id]){ combatants.push(items[id]); used.add(id); }
  });
  Object.keys(items).forEach(id => { if (!used.has(id)) combatants.push(items[id]); });
  return JSON.stringify({ combatants, combatRound: meta.combatRound || 0,
                          activeCombatantId: meta.activeCombatantId ?? null });
}

function assembleParty(n){
  let meta = {}; try { meta = JSON.parse(n.meta || '{}') || {}; } catch(e){}
  const items = {};
  Object.keys(n).forEach(k => {
    if (!k.startsWith('items/')) return;
    try { const c = JSON.parse(n[k]); if (c) items[k.slice(6)] = c; } catch(e){}
  });
  const out = [], used = new Set();
  (Array.isArray(meta.order) ? meta.order : []).forEach(id => {
    if (items[id]){ out.push(items[id]); used.add(id); }
  });
  Object.keys(items).forEach(id => { if (!used.has(id)) out.push(items[id]); });
  return JSON.stringify(out);
}

function assembleBattlemap(n){
  let meta = {}; try { meta = JSON.parse(n.meta || '{}') || {}; } catch(e){}
  const tokens = [];
  Object.keys(n).forEach(k => {
    if (!k.startsWith('tokens/')) return;
    try { const t = JSON.parse(n[k]); if (t) tokens.push(t); } catch(e){}
  });
  const p = (k, fb) => { try { return n[k] != null ? JSON.parse(n[k]) : fb; } catch(e){ return fb; } };
  return JSON.stringify({ ...meta, tokens, fog: p('fog', null),
                          fogStrokes: p('fogStrokes', []), drawings: p('drawings', []) });
}

function assembleNotes(n){
  let meta = {}; try { meta = JSON.parse(n.meta || '{}') || {}; } catch(e){}
  const map = {};
  Object.keys(n).forEach(k => {
    if (!k.startsWith('items/')) return;
    // Keyed by node name, matching assemble() in realtime.js.
    try { const it = JSON.parse(n[k]); if (it) map[k.slice(6)] = it; } catch(e){}
  });
  const items = [], used = new Set();
  (Array.isArray(meta.order) ? meta.order : []).forEach(id => {
    if (map[id]){ items.push(map[id]); used.add(id); }
  });
  Object.keys(map).forEach(id => { if (!used.has(id)) items.push(map[id]); });
  // selectedId is per-device in the app; a snapshot has no device, so open
  // the first file rather than nothing.
  const selectedId = (items.find(i => i.type === 'file') || {}).id || null;
  return JSON.stringify({ items, selectedId, authors: meta.authors || {} });
}

// Firebase stores nested nodes as objects; the app's cache flattens them to
// 'items/<id>' paths. Same flattening here so assemble() sees what it expects.
function flatten(val){
  const out = {};
  if (!val || typeof val !== 'object') return out;
  Object.keys(val).forEach(k1 => {
    const v = val[k1];
    if (v && typeof v === 'object'){
      Object.keys(v).forEach(k2 => { out[k1 + '/' + k2] = v[k2]; });
    } else if (v != null){
      out[k1] = v;
    }
  });
  return out;
}

const ENTITY = {
  combat_v2:    { key: 'skt-combat-v1',    assemble: assembleCombat },
  party_v2:     { key: 'skt-party-v1',      assemble: assembleParty },
  battlemap_v2: { key: 'skt-battlemap-v1', assemble: assembleBattlemap },
  notes_v3:     { key: 'skt-notes-v2',     assemble: assembleNotes },
};

// ── Main ──────────────────────────────────────────────────────────────────
(async function main(){
  const argv = process.argv.slice(2);
  const quiet = argv.includes('--quiet');
  const outArg = (i => i >= 0 ? argv[i + 1] : null)(argv.indexOf('--out'));
  const out = outArg ? path.resolve(outArg) : OUT_FILE;

  const peek = (i => i >= 0 ? argv[i + 1] : null)(argv.indexOf('--peek'));

  const cfg = readConfig();
  const tok = await getToken(cfg);
  if (!quiet) console.log('[pull] anonymous uid ' + tok.uid + (tok.fresh ? ' (new)' : ' (cached)'));

  // Diagnostic: print the shape of one node without writing a snapshot.
  // Still a GET, same as everything else here.
  if (peek){
    const raw = await get(cfg, tok.idToken, 'skt/' + peek);
    console.log('[peek] skt/' + peek + '  ' + raw.length + ' bytes');
    console.log(raw.length > 3000 ? raw.slice(0, 3000) + '\n… truncated' : raw);
    return;
  }

  // Shallow first: list the top-level nodes without downloading a bestiary
  // to find out what exists.
  const top = JSON.parse(await get(cfg, tok.idToken, 'skt', 'shallow=true') || 'null');
  if (!top){ console.error('[pull] /skt is empty — nothing to pull.'); process.exit(1); }

  const keys = {};
  const report = [];

  // TWO PASSES, and the order is the whole point.
  //
  // The step-1 whole-key nodes (skt/skt_combat_v1, skt/skt_battlemap_v1,
  // skt/skt_notes_v2) are still in the database as migration fallbacks, and
  // they map to the SAME localStorage key as the v2/v3 subtrees that
  // superseded them. In one pass, whichever Firebase happened to list last
  // won — which on the first real run meant a stale 1 KB combat node
  // overwrote the assembled live one. Entity subtrees are authoritative, so
  // they are written second and unconditionally.
  const entityNodes = Object.keys(top).filter(n => ENTITY[n]);
  const plainNodes  = Object.keys(top).filter(n => !ENTITY[n]);
  const shadowed    = new Set(entityNodes.map(n => ENTITY[n].key));

  for (const node of plainNodes){
    const raw = await get(cfg, tok.idToken, 'skt/' + node);
    const kb  = Math.round(raw.length / 1024);
    // Whole-key nodes hold the raw localStorage string, JSON-encoded once by
    // Firebase. Decode exactly one level — re-serializing would change bytes
    // the backup format promises not to touch.
    let val; try { val = JSON.parse(raw); } catch(e){ val = null; }
    if (typeof val !== 'string'){
      report.push(['  ' + node, kb + ' KB', '(skipped — not a string node)']);
      continue;
    }
    const lsKey = node.replace(/_/g, '-');
    if (shadowed.has(lsKey)){
      report.push(['  ' + lsKey, kb + ' KB', '(stale whole-key node — ignored)']);
      continue;
    }
    keys[lsKey] = val;
    report.push(['  ' + lsKey, kb + ' KB', '']);
  }

  for (const node of entityNodes){
    const raw  = await get(cfg, tok.idToken, 'skt/' + node);
    const spec = ENTITY[node];
    keys[spec.key] = spec.assemble(flatten(JSON.parse(raw)));
    report.push(['  ' + spec.key, Math.round(raw.length / 1024) + ' KB', '(from ' + node + ')']);
  }

  const snap = {
    format: 'skt-backup',
    version: 2,
    created: new Date().toISOString(),
    build: null,
    source: 'pull-state',
    keys,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(snap));

  if (!quiet){
    report.forEach(r => console.log(r[0].padEnd(32) + r[1].padStart(8) + '  ' + r[2]));
    const total = Math.round(fs.statSync(out).size / 1024);
    console.log('[pull] ' + Object.keys(keys).length + ' keys, ' + total + ' KB → ' + out);
  }
})().catch(e => { console.error('[pull] ' + e.message); process.exit(1); });
