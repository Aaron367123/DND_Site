#!/usr/bin/env node
// ============================================================
// ASSET INTEGRITY CHECK
// ============================================================
//   node tools/verify-assets.js
//
// There is no build system here, so a stale ?v= hash is served from the
// service worker's cache and the browser quietly runs the OLD file. That
// failure is invisible: the app works, the change simply is not in it, and
// anything measured against it measures the previous build.
//
// Run by tools/selftest-run.js before it launches anything, because a suite
// run against stale assets is worse than no suite run — it reports green for
// code that is not the code on disk.
'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const HTML = ['skt-workspace.html'];

function check(){
  const problems = [];
  let checked = 0, external = 0;

  for (const page of HTML){
    const file = path.join(ROOT, page);
    if (!fs.existsSync(file)){ problems.push(page + ' is missing'); continue; }
    const html = fs.readFileSync(file, 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"]+?\.(?:js|css))(\?v=([0-9a-f]+))?"/g)];

    for (const [, ref, , ver] of refs){
      if (/^https?:/.test(ref)){ external++; continue; }
      const target = path.join(ROOT, ref);
      if (!fs.existsSync(target)){ problems.push(page + ' -> ' + ref + ' (file does not exist)'); continue; }
      if (!ver){ problems.push(ref + ' has no ?v= — edits to it will be served stale'); continue; }
      const hash = crypto.createHash('sha1').update(fs.readFileSync(target)).digest('hex');
      if (!hash.startsWith(ver)){
        problems.push(ref + ' is stamped ?v=' + ver + ' but hashes to ' + hash.slice(0, ver.length)
                      + ' — run: node tools/stamp-build.js');
        continue;
      }
      checked++;

      // A versioned file the shell does not precache still works, but it is
      // fetched over the network on a cold start, which is the one thing the
      // precache exists to avoid.
      const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
      const block = (sw.match(/PRECACHE\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
      if (block && !block.includes("'" + ref)) problems.push(ref + ' is not in the service worker PRECACHE');
    }
  }

  // Every entity subtree the code writes must have a matching block in
  // firebase-rules.json. The catch-all `$wholeKey` rule requires a STRING, so
  // an entity base with no block of its own is rejected by the database on
  // every write — the client retries, gives up, and the DM gets "Live sync
  // failed" with no clue which key or why. That is not hypothetical: adding
  // party_v2 without its rules block did exactly this, and the only visible
  // symptom was the toast.
  try {
    const rulesFile = path.join(ROOT, 'firebase-rules.json');
    if (fs.existsSync(rulesFile)){
      const skt = (JSON.parse(fs.readFileSync(rulesFile, 'utf8')).rules || {}).skt || {};
      const code = fs.readFileSync(path.join(ROOT, 'js', 'sync', 'realtime.js'), 'utf8');
      const bases = [...code.matchAll(/base:\s*'skt\/([A-Za-z0-9_]+)'/g)].map(m => m[1]);
      bases.forEach(b => {
        if (!(b in skt)) problems.push('firebase-rules.json has no block for skt/' + b
          + ' — the $wholeKey catch-all requires a string, so every write to it is rejected');
      });
    }
  } catch(e){ problems.push('could not cross-check firebase-rules.json: ' + e.message); }

  // The service worker's own BUILD stamp has to move too, or the shell cache
  // is never swapped and the old index keeps being served.
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  if (!/const BUILD = '[0-9a-f]{6,}'/.test(sw)) problems.push('sw.js BUILD stamp is missing or malformed');

  return { problems, checked, external };
}

const { problems, checked, external } = check();
if (problems.length){
  console.error('asset check FAILED (' + problems.length + ')');
  problems.forEach(p => console.error('  ' + p));
  process.exit(1);
}
console.log('assets ok — ' + checked + ' versioned and current, ' + external + ' external');
