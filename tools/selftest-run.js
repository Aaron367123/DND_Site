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
    console.log('usage: node tools/selftest-run.js [BACKUP.json] [--mode dm|player|mobile]');
    process.exit(0);
  } else state = args[i];
}
if (!state) state = path.join(ROOT, '.state', 'live.json');
if (!fs.existsSync(state)){
  console.error('no state file at ' + state);
  console.error('pass one explicitly, or refresh with: node tools/pull-state.js');
  process.exit(2);
}

const MODES = [
  // DM mode waits for the bestiary: the damage checks resolve a real Deva and
  // Werewolf out of _5eData, and without it they would quietly skip.
  { name: 'dm',     extra: ['--ready', "typeof _5eLoaded !== 'undefined' && _5eLoaded"] },
  { name: 'player', extra: ['--player'] },
  { name: 'mobile', extra: ['--preset', 'mobile'] },
].filter(m => !only || m.name === only);

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

console.log('\n' + '-'.repeat(46));
console.log(totalFail === 0
  ? 'ALL ' + totalPass + ' checks passed across ' + MODES.length + ' mode(s)'
  : totalFail + ' FAILED, ' + totalPass + ' passed  (' + failedModes.join(', ') + ')');
process.exit(totalFail === 0 && failedModes.length === 0 ? 0 : 1);
