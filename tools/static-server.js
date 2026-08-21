#!/usr/bin/env node
// ============================================================
// STATIC SERVER
// ============================================================
//   node tools/static-server.js [port]        # default 8765
//
// Serves the repo so tools/shot.js has something to load. Exists so the test
// tooling has no Python dependency and so selftest-run can start one itself
// instead of failing for a reason that has nothing to do with the code.
//
// Deliberately a SEPARATE PROCESS. An in-process server cannot work here: the
// runner drives shot.js with spawnSync, which blocks the event loop the server
// needs to answer, so every request would hang until the child gave up.
'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8765;

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',   '.webp':'image/webp', '.gif':'image/gif',
  '.woff2':'font/woff2',  '.woff':'font/woff', '.ttf':'font/ttf',
  '.ico':'image/x-icon',  '.mp3':'audio/mpeg', '.ogg':'audio/ogg',
  '.webm':'video/webm',   '.txt':'text/plain; charset=utf-8', '.md':'text/markdown',
};

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(String(req.url || '/').split('?')[0]); }
  catch(e){ res.writeHead(400); return res.end('bad url'); }
  if (rel === '/' || rel === '') rel = '/skt-workspace.html';

  // Contain every read to the repo. A test server should not be a file
  // browser for the whole disk.
  const file = path.resolve(ROOT, '.' + path.posix.normalize(rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)){
    res.writeHead(403); return res.end('outside the repo');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()){ res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      // No caching: the whole point is to serve what is on disk right now.
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('serving ' + ROOT + ' on http://localhost:' + PORT);
});
server.on('error', e => {
  console.error('static-server: ' + e.message);
  process.exit(1);
});
