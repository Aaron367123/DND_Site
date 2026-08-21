#!/usr/bin/env node
// ============================================================
// SELF TEST RUNNER
// ============================================================
//   node tools/selftest-run.js                  # uses .state/live.json
//   node tools/selftest-run.js some-backup.json
//   node tools/selftest-run.js --mode dm        # just one mode
//
// Runs tools/selftest.js three times through tools/shot.js — DM desktop,
// player view, phone — and aggregates. Exits non-zero if anything failed, so
// it is usable as a pre-push gate.
'use strict';
const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
let only = null, state = null;
for (let i = 0; i < args.length; i++){
  if (args[i] === '--mode') only = args[++i];
  else if (args[i] === '--help' || args[i] === '-h'){
    console.log('usage: node tools/selftest-run.js [BACKUP.json|--live] [--mode dm|player|mobile]');
    console.log('  default: tools/fixture.json (frozen bench — build with make-fixture.js)');
    console.log('  --live : .state/live.json (real campaign; bench checks may flag drift)');
    process.exit(0);
  } else state = args[i];
}
// Default to the frozen fixture, not the live campaign.
//
// The live snapshot is a moving target and coverage drains out of it without
// anything going red: the spell-slot migration check read "6 checked" one
// morning and "0 checked" that afternoon, because the migration had run and
// the pools were gone from the data. It still printed pass. tools/fixture.json
// is deliberately awkward and never changes, so a green line means the same
// thing next month as it does today.
//
// Pass a path (or --live) to run against real data instead. That pass is still
// worth doing occasionally — it exercises real shapes and the real bestiary —
// but expect the bench precondition to flag whatever the campaign has moved on
// from.
if (state === '--live') state = path.join(ROOT, '.state', 'live.json');
if (!state) state = path.join(ROOT, 'tools', 'fixture.json');
if (!fs.existsSync(state)){
  console.error('no state file at ' + state);
  console.error(/fixture\.json$/.test(state)
    ? 'build it with: node tools/make-fixture.js'
    : 'pass one explicitly, or refresh with: node tools/pull-state.js');
  process.exit(2);
}
console.log('state: ' + path.relative(ROOT, state));

// Pre-flight. A stale ?v= means the browser runs the previous build, so the
// suite would report green for code that is not the code on disk — the one
// failure that makes every other result meaningless.
{
  const v = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'verify-assets.js')],
                      { cwd: ROOT, encoding: 'utf8' });
  process.stdout.write(v.stdout || '');
  if (v.status !== 0){
    process.stderr.write(v.stderr || '');
    console.error('');
    console.error('refusing to run: the suite would be testing stale assets');
    process.exit(1);
  }
}

const MODES = [
  // DM mode waits for the bestiary: the damage checks resolve a real Deva and
  // Werewolf out of _5eData, and without it they would quietly skip.
  { name: 'dm',     extra: ['--ready', "typeof _5eLoaded !== 'undefined' && _5eLoaded"] },
  { name: 'player', extra: ['--player'] },
  { name: 'mobile', extra: ['--preset', 'mobile'] },
].filter(m => !only || m.name === only);

// ── Static server ────────────────────────────────────────────────────────────
// shot.js loads http://localhost:8765/..., so something must be serving the
// repo. Relying on a human to have started one by hand means the suite fails
// for a reason that has nothing to do with the code.
//
// A SEPARATE PROCESS, not an in-process http server: the mode loop below uses
// spawnSync, which blocks this process's event loop, so an in-process listener
// could never answer the child's request. That deadlock is easy to write and
// presents as "shot.js failed to run this mode", which points nowhere near the
// real cause.
const PORT = 8765;
function serving(){
  const probe = "require('http').get({host:'127.0.0.1',port:" + PORT
    + ",path:'/skt-workspace.html',timeout:1000}, r => process.exit(r.statusCode===200?0:1))"
    + ".on('error',()=>process.exit(1)).on('timeout',()=>process.exit(1));";
  return spawnSync(process.execPath, ['-e', probe], { encoding:'utf8' }).status === 0;
}

let serverProc = null;
const stopServer = () => { if (serverProc){ try { serverProc.kill(); } catch(e){} serverProc = null; } };
if (serving()){
  console.log('server: reusing localhost:' + PORT);
} else {
  serverProc = require('child_process').spawn(
    process.execPath, [path.join(ROOT, 'tools', 'static-server.js'), String(PORT)],
    { cwd: ROOT, stdio: 'ignore' });
  // Each probe is its own process, so the loop paces itself without a sleep.
  let up = false;
  for (let i = 0; i < 30 && !up; i++) up = serving();
  if (!up){
    stopServer();
    console.error('could not start tools/static-server.js on ' + PORT);
    process.exit(2);
  }
  console.log('server: started tools/static-server.js on localhost:' + PORT);
}
process.on('exit', stopServer);

let totalPass = 0, totalFail = 0;
const failedModes = [];

for (const m of MODES){
  process.stdout.write('\n=== ' + m.name + ' '.repeat(Math.max(0, 8 - m.name.length)) + '===\n');
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'shot.js'),
    '--state', state,
    '--out', path.join(require('os').tmpdir(), 'selftest-' + m.name + '.png'),
    '--wait', '5000',
    '--eval-file', path.join(ROOT, 'tools', 'selftest.js'),
    ...m.extra,
  ], { cwd: ROOT, encoding: 'utf8' });

  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0 && !/\[eval\]/.test(out)){
    console.log(out.trim().split('\n').slice(-8).join('\n'));
    console.log('  -> shot.js failed to run this mode');
    failedModes.push(m.name);
    continue;
  }
  if (/^REFUSED/m.test(out)){
    console.log(out.match(/^REFUSED.*$/m)[0]);
    failedModes.push(m.name);
    continue;
  }

  const fails = out.split('\n').filter(l => /^FAIL /.test(l.replace('[eval] ', '')));
  const summary = (out.match(/^(?:\[eval\] )?(?:ALL|FAILED) .*$/m) || [''])[0].replace('[eval] ', '');
  const passN = (out.match(/^(?:\[eval\] )?pass /gm) || []).length;

  fails.forEach(l => console.log('  ' + l.replace('[eval] ', '')));
  console.log('  ' + (summary || 'no summary line — did the suite throw?'));

  totalPass += passN;
  totalFail += fails.length;
  if (fails.length || !summary) failedModes.push(m.name);
}

stopServer();

console.log('\n' + '-'.repeat(46));
console.log(totalFail === 0
  ? 'ALL ' + totalPass + ' checks passed across ' + MODES.length + ' mode(s)'
  : totalFail + ' FAILED, ' + totalPass + ' passed  (' + failedModes.join(', ') + ')');
process.exit(totalFail === 0 && failedModes.length === 0 ? 0 : 1);
