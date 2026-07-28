#!/usr/bin/env node
/*
 * stamp-build.js — cache-bust stamper for a no-build project.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every <script>/<link> in skt-workspace.html carries a manual ?v=YYYYMMDDx
 * cache-buster. Getting one right requires remembering to bump it on every
 * edit, and forgetting is silent: the browser keeps serving the OLD file and
 * the change simply doesn't take. That has already happened in practice.
 *
 * This script removes the discipline entirely. It hashes each referenced file
 * and writes that hash into its ?v=, so the URL changes if and only if the
 * FILE changed. It also stamps sw.js with a build id + the exact precache
 * list, so the service worker's cache bucket and the page's asset URLs can
 * never drift apart.
 *
 * USAGE
 *   node tools/stamp-build.js          # stamp
 *   node tools/stamp-build.js --check  # exit 1 if stamping is needed (CI)
 *
 * Run it before committing/deploying. Idempotent — running twice is a no-op.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'skt-workspace.html');
const SW   = path.join(ROOT, 'sw.js');
const CHECK_ONLY = process.argv.includes('--check');

const hash = buf => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);

function main(){
  let html = fs.readFileSync(HTML, 'utf8');
  const original = html;

  // Match src="js/foo.js?v=..." / href="styles/main.css?v=..." — local assets
  // only. Cross-origin scripts (Firebase from gstatic) have no ?v= and are
  // intentionally left alone.
  const ASSET_RE = /((?:src|href)=")((?:js|styles)\/[^"?]+)(\?v=[^"]*)?(")/g;

  const assets = [];        // {url, hash} in document order
  const missing = [];

  html = html.replace(ASSET_RE, (full, pre, relPath, _oldQuery, post) => {
    const abs = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)){
      missing.push(relPath);
      return full;                              // leave untouched; report below
    }
    const h = hash(fs.readFileSync(abs));
    assets.push({ url: relPath + '?v=' + h, hash: h });
    return pre + relPath + '?v=' + h + post;
  });

  if (missing.length){
    console.error('[stamp] referenced but missing on disk:\n  ' + missing.join('\n  '));
    process.exitCode = 1;
    return;
  }

  // Build id = hash of every asset hash in order. Changes iff any asset
  // changed, which is exactly when the service worker should swap buckets.
  const BUILD = hash(assets.map(a => a.hash).join('|'));

  // The HTML itself is precached too. It is fetched network-first at runtime,
  // so the copy in the bucket is purely the offline fallback.
  const precache = ['./', 'skt-workspace.html'].concat(assets.map(a => a.url));

  let sw = fs.readFileSync(SW, 'utf8');
  const swBefore = sw;
  sw = sw.replace(/const BUILD\s*=\s*'[^']*';/, "const BUILD = '" + BUILD + "';");
  sw = sw.replace(
    /const PRECACHE\s*=\s*\[[\s\S]*?\];/,
    'const PRECACHE = [\n' + precache.map(u => "  '" + u + "',").join('\n') + '\n];'
  );

  const htmlChanged = html !== original;
  const swChanged   = sw !== swBefore;

  if (CHECK_ONLY){
    if (htmlChanged || swChanged){
      console.error('[stamp] OUT OF DATE — run: node tools/stamp-build.js');
      process.exitCode = 1;
    } else {
      console.log('[stamp] up to date (build ' + BUILD + ')');
    }
    return;
  }

  if (htmlChanged) fs.writeFileSync(HTML, html);
  if (swChanged)   fs.writeFileSync(SW, sw);

  console.log('[stamp] build ' + BUILD + ' · ' + assets.length + ' assets · '
    + (htmlChanged || swChanged ? 'updated' : 'no changes'));
}

main();
