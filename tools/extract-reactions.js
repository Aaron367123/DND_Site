#!/usr/bin/env node
// ============================================================
// DERIVE THE REACTION TABLE FROM 5ETOOLS DATA
// ============================================================
// Answers "which of this character's features are reactions" from data/class/
// rather than from anyone's memory of the PHB. Counted this way, the split is
// stark: 5 reactions come from base classes, 78 from subclasses, 17 from feats.
// Deriving from class + level alone would find 5 of 100.
//
// Emits tools/reactions-table.json — {classes:[], subclasses:[], feats:[]} —
// which the turn-view prototype inlines so it can run standalone, and which the
// real panel can regenerate whenever the 5etools data is updated.
//
//   node tools/extract-reactions.js

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
// "as a reaction" / "you can use your reaction" / "using your reaction".
// Deliberately narrow: matching a bare "reaction" pulls in every feature that
// merely mentions the word, including ones that TAKE AWAY reactions.
const RE = /\bas a reaction\b|\byou can use your reaction\b|\busing your reaction\b|\bwith your reaction\b/i;

// 5etools markup → plain text. {@dice 1d8}, {@creature goblin|MM}, {@spell
// shield} and friends all carry a display form after the first pipe, or the
// whole payload when there is none.
function detag(s){
  return String(s)
    .replace(/\{@(?:\w+)\s+([^}|]+)(?:\|[^}]*)?\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function strings(node, out){
  if (Array.isArray(node)) node.forEach(n => strings(n, out));
  else if (node && typeof node === 'object'){
    if (typeof node.name === 'string') out.push(node.name);
    Object.keys(node).forEach(k => { if (k !== 'name') strings(node[k], out); });
  } else if (typeof node === 'string') out.push(node);
  return out;
}

// First sentence, capped — enough for the DM to recognise the feature without
// turning the reaction bar into a rules quotation.
function note(entries){
  const flat = detag(strings(entries, []).join(' '));
  const m = flat.match(/[^.]*\breaction\b[^.]*\./i) || flat.match(/^[^.]*\./);
  let s = (m ? m[0] : flat).trim();
  if (s.length > 150) s = s.slice(0, 147).replace(/\s\S*$/, '') + '…';
  return s;
}

function readJson(f){
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e){ console.error('  skip ' + path.basename(f) + ': ' + e.message); return null; }
}

const classes = [], subclasses = [];
for (const f of fs.readdirSync(path.join(DATA, 'class'))){
  if (!f.startsWith('class-') || !f.endsWith('.json')) continue;
  const dat = readJson(path.join(DATA, 'class', f));
  if (!dat) continue;

  for (const cf of dat.classFeature || []){
    const txt = detag(strings(cf.entries || [], []).join(' '));
    if (!RE.test(txt)) continue;
    classes.push({ cls: cf.className, lvl: cf.level, name: cf.name,
                   src: cf.source, note: note(cf.entries) });
  }
  for (const sf of dat.subclassFeature || []){
    const txt = detag(strings(sf.entries || [], []).join(' '));
    if (!RE.test(txt)) continue;
    subclasses.push({ cls: sf.className, sub: sf.subclassShortName, lvl: sf.level,
                      name: sf.name, src: sf.source, note: note(sf.entries) });
  }
}

const feats = [];
const fd = readJson(path.join(DATA, 'feats.json'));
for (const ft of (fd && fd.feat) || []){
  const txt = detag(strings(ft.entries || [], []).join(' '));
  if (!RE.test(txt)) continue;
  feats.push({ name: ft.name, src: ft.source, note: note(ft.entries) });
}

// Every creature has these and no class file mentions them.
const universal = [
  { name: 'Opportunity Attack',
    note: 'When a hostile creature you can see leaves your reach, make one melee attack against it.' },
  { name: 'Ready',
    note: 'A readied action triggers on its condition and uses your reaction.' },
];

const out = { generated: 'node tools/extract-reactions.js', universal, classes, subclasses, feats };
const dest = path.join(__dirname, 'reactions-table.json');
fs.writeFileSync(dest, JSON.stringify(out));
const kb = Math.round(fs.statSync(dest).size / 1024);

console.log('classes    ' + classes.length);
console.log('subclasses ' + subclasses.length);
console.log('feats      ' + feats.length);
console.log('universal  ' + universal.length);
console.log('-> ' + path.relative(process.cwd(), dest) + '  (' + kb + ' KB)');
