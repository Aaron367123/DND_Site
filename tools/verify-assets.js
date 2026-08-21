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
