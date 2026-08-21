#!/usr/bin/env node
// ============================================================
// BUILD THE TEST FIXTURE
// ============================================================
//   node tools/make-fixture.js        # writes tools/fixture.json
//
// The suite used to run against .state/live.json — the real campaign. That is
// a moving target, and coverage drained out of it silently: the spell-slot
// migration check read "6 checked" in the morning and "0 checked" by the
// afternoon, because the migration had run and the pools no longer existed in
// the data. It still printed `pass`. A check with nothing to check always does.
//
// So the fixture is FROZEN and deliberately awkward. Every oddity below is
// here to make some assertion mean something, and each is labelled with which
// one. Nothing in here is realistic play data; it is a test bench.
//
// Keep the generator rather than hand-editing fixture.json: the reasons matter
// more than the bytes, and they cannot live in JSON.
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'fixture.json');

const S = v => JSON.stringify(v);

// ── Party ────────────────────────────────────────────────────────────────────
// Zoey  : carries spell-slot POOLS. This is the one that went vacuous — the
//         migration folds pools into sheet.spellSlots, so a fixture pulled
//         after a migration has none left and the check verifies nothing.
//         Frozen here so it always has three pools to move.
// Namroc: wild-shaped, with the beast carrying its own resistances. Exercises
//         the beast-pool damage routing and the "[beast]" resistance labels.
// Ulrick: tempHp, and a d12 hit die (the barbarian case the d8 default misses).
// Zindle: resistances/immunities/vulnerabilities on the party slot itself.
// Creambak: deliberately plain — the control.
const party = [
  { id:'zoey', name:'Zoey', cls:'rogue', icon:'🗡', hp:32, hpMax:55, ac:17, init:4,
    spd:30, pp:14, inspiration:false, tempHp:0,
    abilities:{ str:10, dex:18, con:14, int:12, wis:13, cha:11 },
    hitDice:{ current:6, max:6, dieType:'d8' },
    resources:[
      { name:'Spell Slots L1', type:'pool', current:4, max:4 },
      { name:'Spell Slots L2', type:'pool', current:2, max:3 },
      { name:'Spell Slots L3', type:'pool', current:3, max:3 },
      { name:'Sneak Attack',   type:'toggle', current:1, max:1 },
    ],
    sheet:{ spellSlots:{} } },

  { id:'namroc', name:'Namroc', cls:'druid', icon:'🌿', hp:5, hpMax:52, ac:14, init:1,
    spd:30, pp:15, tempHp:0,
    abilities:{ str:12, dex:13, con:15, int:11, wis:18, cha:10 },
    hitDice:{ current:3, max:6, dieType:'d8' },
    wildshape:{ name:'Dire Wolf', hp:22, hpMax:37, ac:14,
                resistances:['cold'], immunities:[], vulnerabilities:[] },
    resources:[{ name:'Wild Shape', type:'pool', current:1, max:2 }],
    sheet:{ spellSlots:{ 1:{ total:4, expended:1 } } } },

  { id:'ulrick', name:'Ulrick Axeborne', cls:'Barbarian', icon:'🪓', hp:61, hpMax:79,
    ac:15, init:2, spd:40, pp:12, tempHp:8, rage:false,
    abilities:{ str:18, dex:14, con:16, int:8, wis:12, cha:10 },
    hitDice:{ current:6, max:6, dieType:'d12' },
    resources:[{ name:'Rage', type:'pool', current:3, max:3 }],
    sheet:{ spellSlots:{} } },

  { id:'zindle', name:'Zindle "Deathwhistle" Farrago', cls:'bard', icon:'🎵',
    hp:40, hpMax:53, ac:15, init:3, spd:30, pp:13, tempHp:0,
    abilities:{ str:9, dex:16, con:13, int:14, wis:11, cha:18 },
    hitDice:{ current:5, max:6, dieType:'d8' },
    resistances:['fire'], immunities:['poison'], vulnerabilities:['thunder'],
    resources:[{ name:'Bardic Inspiration', type:'pool', current:4, max:4 }],
    sheet:{ spellSlots:{ 1:{ total:4, expended:0 }, 2:{ total:3, expended:1 } } } },

  { id:'creambak', name:'Creambak', cls:'monk', icon:'👊', hp:26, hpMax:47, ac:16,
    init:3, spd:45, pp:16, tempHp:0,
    abilities:{ str:13, dex:17, con:14, int:10, wis:16, cha:9 },
    hitDice:{ current:6, max:6, dieType:'d8' },
    resources:[{ name:'Ki', type:'pool', current:6, max:6 }],
    sheet:{ spellSlots:{} } },
];

// ── Combat ───────────────────────────────────────────────────────────────────
// Four PCs plus two monsters. The werewolf carries the qualifier-gated immunity
// that the magical/silvered matching depends on; the ogre carries a plain one.
// Namroc is at 5 hp so a single hit can drive the massive-damage path, and the
// downed PC gives the death-save checks a real starting state.
const combat = {
  combatants: [
    { id:'ulrick', name:'Ulrick Axeborne', isPC:true, cls:'Barbarian', hp:61, hpMax:79,
      ac:15, initBonus:2, initiative:20, conditions:[] },
    { id:'zoey', name:'Zoey', isPC:true, cls:'rogue', hp:32, hpMax:55, ac:17,
      initBonus:4, initiative:18, conditions:['prone'] },
    { id:'wolf', name:'Werewolf', isPC:false, cls:'enemy', hp:58, hpMax:58, ac:12,
      initBonus:2, initiative:14, conditions:[],
      _immune:["bludgeoning, piercing, slashing from nonmagical attacks that aren't silvered"],
      _resist:[], _vulnerable:[] },
    { id:'ogre1', name:'Ogre 1', isPC:false, cls:'enemy', hp:23, hpMax:59, ac:11,
      initBonus:-1, initiative:8, conditions:[],
      _immune:[], _resist:['fire'], _vulnerable:[] },
    { id:'namroc', name:'Namroc', isPC:true, cls:'druid', hp:5, hpMax:52, ac:14,
      initBonus:1, initiative:6, conditions:[] },
    { id:'creambak', name:'Creambak', isPC:true, cls:'monk', hp:0, hpMax:47, ac:16,
      initBonus:3, initiative:4, conditions:[],
      deathSaves:{ success:1, fail:1 } },
  ],
  combatRound: 3,
  activeCombatantId: 'wolf',
};

// ── Battle map ───────────────────────────────────────────────────────────────
// Eight tokens so the fog check has a monster to hide and a PC to leave alone,
// hex grid because that is the harder grid path, and one revealed cell so fog
// has both states to test.
const tokens = [
  { id:'tk_ulrick',  cid:'ulrick',  label:'UA', x:75,  y:75,  size:1, color:'#c25450', isPC:true },
  { id:'tk_zoey',    cid:'zoey',    label:'Z',  x:125, y:75,  size:1, color:'#c08fde', isPC:true },
  { id:'tk_namroc',  cid:'namroc',  label:'N',  x:75,  y:125, size:1, color:'#6b9e6b', isPC:true },
  { id:'tk_creambak',cid:'creambak',label:'C',  x:125, y:125, size:1, color:'#e8c75f', isPC:true },
  { id:'tk_wolf',    cid:'wolf',    label:'W',  x:275, y:275, size:1, color:'#8a8a8a', isPC:false },
  { id:'tk_ogre',    cid:'ogre1',   label:'O',  x:325, y:275, size:2, color:'#8a8a8a', isPC:false },
  { id:'tk_loose1',  label:'X', x:425, y:75,  size:1, color:'#777', isPC:false },
  { id:'tk_loose2',  label:'Y', x:425, y:125, size:1, color:'#777', isPC:false },
];
const battlemap = {
  cellSize: 50, cols: 20, rows: 14, bgColor:'#1d1d1d', gridType:'hex',
  gridOffsetX: 0, gridOffsetY: 0, rotation: 0, bgMapScale: 1,
  // A real background image, inline. Several controls only exist when one is
  // loaded (Fit is gated on _mapBgImage), and the grid colour is chosen from
  // the ART's brightness — a fixture with no image leaves both untested. Pale
  // on purpose: a white grid over pale ground was a real bug once, so the
  // luminance path should be exercised against the case that broke.
  bgMapPath: 'data:image/svg+xml,'
    + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700">'
      + '<rect width="1000" height="700" fill="#dfd6bd"/>'
      + '<rect x="0" y="0" width="1000" height="240" fill="#a9c8d8"/>'
      + '<circle cx="700" cy="480" r="150" fill="#c2b48e"/></svg>'),
  ftPerCell: 5,
  tokens,
  fog: ['1,1','2,1','1,2','2,2'],
  fogStrokes: [],
  drawings: [{ p:[60,60,140,140], c:'#e0c46c', w:3 }],
};

// ── Notes ────────────────────────────────────────────────────────────────────
// Distinctive names, because the player-view leak check asserts that the note
// TREE never reaches a player — generic names would match by accident.
const notes = {
  items: [
    { id:'n_open',   name:'Session 21 recap',        type:'file', content:'The party reached the gate.' },
    { id:'n_secret', name:'DM only - the traitor',   type:'file', content:'It is the innkeeper.' },
    { id:'n_plans',  name:'Vault contingency plans', type:'file', content:'If they open it early...' },
    { id:'n_folder', name:'Handouts',                type:'folder' },
  ],
  selectedId: 'n_open',
  authors: {},
};

// ── Shop ─────────────────────────────────────────────────────────────────────
// Two "Splint Armor" entries on purpose. Duplicate names make the inventory
// unkeyable for the three-way merge, which is exactly why shop is an atomic
// key — with unique names the atomicity check would pass for the wrong reason.
const shop = {
  type:'Blacksmith', name:'The Bent Anvil', keeper:'Hilda Ironsong', tone:'gruff but fair',
  quirks:['Has a fake leg','Hums while working'], aesthetic:'Soot-black beams, a forge that never cools',
  meta:{ price:'Average', economy:'Average', assortment:'Standard' },
  inventory:[
    { name:'Splint Armor',   category:'armor',   rarity:'Common', price:200, stock:1 },
    { name:'Splint Armor',   category:'armor',   rarity:'Common', price:200, stock:1 },
    { name:'Dagger',         category:'weapons', rarity:'Common', price:2,   stock:6 },
    { name:'Potion of Healing', category:'potions', rarity:'Common', price:50, stock:3 },
  ],
};

// ── Settings ─────────────────────────────────────────────────────────────────
// monsterStatsMode 'conceal' so the player-view hiding checks start from the
// interesting state rather than 'show'. healthTiers left at the defaults, which
// are the six anonymous records the merge deliberately cannot key.
const settings = {
  currencySymbol:'gp', currencyFormat:'short', priceJitter:20, rounding:'none',
  reprintPolicy:'all', snapWindows:true, fontScale:100,
  healthTiers:[
    { threshold:100, label:'Healthy' }, { threshold:76, label:'Scratched' },
    { threshold:50,  label:'Bloodied' }, { threshold:25, label:'Wounded' },
    { threshold:1,   label:'Near Death' }, { threshold:0, label:'Defeated' },
  ],
  monsterStatsMode:'conceal', hideMonsterStats:false,
  combatHpBar:true, combatCompact:false, combatGroupSimilar:false,
  partyCompact:false, lootEncumbrance:false, autoRollInit:false,
};

// ── Loot ─────────────────────────────────────────────────────────────────────
const loot = {
  cp:120, sp:45, ep:0, gp:310, pp:2,
  items:[
    { id:'li_1', name:'Silvered longsword', qty:1, value:'115 gp', claimed:false },
    { id:'li_2', name:'Pearl',              qty:4, value:'100 gp', claimed:true  },
    { id:'li_3', name:'Potion of Healing',  qty:2, value:'50 gp',  claimed:false },
  ],
  tabGroups:[],
};

const keys = {
  'skt-party-v1'            : S(party),
  'skt-combat-v1'           : S(combat),
  'skt-battlemap-v1'        : S(battlemap),
  'skt-notes-v2'            : S(notes),
  'skt-shop-v1'             : S(shop),
  'skt-settings-v1'         : S(settings),
  'skt-loot-v1'             : S(loot),
  'skt-enc-v1'              : S({ monsters:[{ name:'Ogre', cr:'2', count:3 }],
                                  partyLevel:6, partySize:5, saved:[], system:'2014' }),
  'skt-npcs-v2'             : S([{ id:'npc_1', name:'Hilda Ironsong', role:'Blacksmith',
                                   secret:'Knows who forged the gate key' }]),
  'skt-bestiary-v1'         : S({ folders:[{ id:'f1', name:'Gate encounter' }],
                                  collapsed:{}, monsters:[] }),
  'skt-shared-panels-v1'    : S(['battlemap','combat','party','notes']),
  'skt-books-hidden-v1'     : S(['AI','TDCSR']),
  'skt-adventures-hidden-v1': S(['LMoP']),
};

const doc = {
  format:'skt-backup', version:2,
  // Fixed, not Date.now(): a fixture that changes every time it is generated
  // shows up as a diff on every run and teaches everyone to ignore diffs to it.
  created:'2026-01-01T00:00:00.000Z',
  build:null, source:'make-fixture',
  keys,
};

fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
const bytes = fs.statSync(OUT).size;
console.log('wrote ' + path.relative(process.cwd(), OUT) + ' — '
  + Object.keys(keys).length + ' keys, ' + (bytes / 1024).toFixed(1) + ' KB');
console.log('  party ' + party.length + ' characters, '
  + party.reduce((n,c) => n + (c.resources||[]).filter(r => /^Spell Slots L\d$/.test(r.name)).length, 0)
  + ' spell-slot pools to migrate');
console.log('  combat ' + combat.combatants.length + ' combatants, '
  + combat.combatants.filter(c => !c.isPC).length + ' monsters, 1 downed PC');
console.log('  map ' + tokens.length + ' tokens, ' + battlemap.fog.length + ' revealed cells');
console.log('  shop ' + shop.inventory.length + ' items with a duplicate name');
