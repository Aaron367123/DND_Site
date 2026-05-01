'use strict';

// ============================================================
// STATIC DATA
// ============================================================
const CLASS_ICONS = {
  rogue:     '<svg viewBox="0 0 24 24" fill="none" stroke="#7a8fa8" stroke-width="2"><path d="M12 2 L18 12 L12 22 L6 12 Z"/><circle cx="12" cy="12" r="2" fill="#7a8fa8"/></svg>',
  bard:      '<svg viewBox="0 0 24 24" fill="none" stroke="#a87a7a" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7L12 17M7 12L17 12" stroke-linecap="round"/></svg>',
  druid:     '<svg viewBox="0 0 24 24" fill="none" stroke="#7aa87a" stroke-width="2"><path d="M12 3C8 8 8 14 12 21C16 14 16 8 12 3Z"/><path d="M8 12L16 12" stroke-linecap="round"/></svg>',
  barbarian: '<svg viewBox="0 0 24 24" fill="none" stroke="#c25450" stroke-width="2"><path d="M3 6L21 6L18 20L6 20Z"/><path d="M9 10L15 10" stroke-linecap="round"/></svg>',
  monk:      '<svg viewBox="0 0 24 24" fill="none" stroke="#d4a574" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 4L14 10L20 12L14 14L12 20L10 14L4 12L10 10Z" fill="#d4a574" stroke="none"/></svg>',
  fighter:   '<svg viewBox="0 0 24 24" fill="none" stroke="#8b8b8b" stroke-width="2"><path d="M12 2L12 16M8 18L16 18M9 6L15 6"/></svg>',
  wizard:    '<svg viewBox="0 0 24 24" fill="none" stroke="#9b6bb4" stroke-width="2"><path d="M12 2L4 22L20 22Z"/><circle cx="12" cy="14" r="2" fill="#9b6bb4"/></svg>',
  cleric:    '<svg viewBox="0 0 24 24" fill="none" stroke="#d4d4a0" stroke-width="2"><path d="M10 3L14 3L14 9L20 9L20 13L14 13L14 21L10 21L10 13L4 13L4 9L10 9Z"/></svg>',
  ranger:    '<svg viewBox="0 0 24 24" fill="none" stroke="#7aa87a" stroke-width="2"><path d="M5 12Q12 4 19 12"/><path d="M12 8L12 18" stroke-linecap="round"/><path d="M9 18L15 18" stroke-linecap="round"/></svg>',
  warlock:   '<svg viewBox="0 0 24 24" fill="none" stroke="#9b6bb4" stroke-width="2"><circle cx="12" cy="12" r="3" fill="#9b6bb4"/><circle cx="12" cy="12" r="9"/><path d="M12 3L12 6M12 18L12 21M3 12L6 12M18 12L21 12"/></svg>',
  enemy:     '<svg viewBox="0 0 24 24" fill="none" stroke="#c25450" stroke-width="2"><path d="M5 8L19 8L17 18L7 18Z"/><circle cx="9" cy="12" r="1" fill="#c25450"/><circle cx="15" cy="12" r="1" fill="#c25450"/></svg>',
};

const DEFAULT_PARTY = [
  {id:'zoey',    name:'Zoey',                  cls:'rogue',     hp:42,hpMax:42,ac:16,init:4,spd:30,pp:16,gp:50,inspiration:false,icon:'⚔',
   resources:[{name:'Sneak Attack',type:'toggle',current:1,max:1},{name:'Psychic Dice',type:'pool',current:6,max:6}]},
  {id:'zindle',  name:'Zindle "Deathwhistle"', cls:'bard',      hp:45,hpMax:45,ac:15,init:2,spd:30,pp:14,gp:50,inspiration:false,icon:'🎵',
   resources:[{name:'Spell Slots L1',type:'pool',current:4,max:4},{name:'Spell Slots L2',type:'pool',current:3,max:3},{name:'Spell Slots L3',type:'pool',current:3,max:3},{name:'Bardic Inspiration',type:'pool',current:3,max:3}]},
  {id:'namroc',  name:'Namroc',                cls:'druid',     hp:44,hpMax:44,ac:14,init:1,spd:30,pp:15,gp:50,inspiration:false,icon:'🌿',
   resources:[{name:'Spell Slots L1',type:'pool',current:4,max:4},{name:'Spell Slots L2',type:'pool',current:3,max:3},{name:'Spell Slots L3',type:'pool',current:3,max:3},{name:'Wild Shape',type:'pool',current:2,max:2}]},
  {id:'ulrick',  name:'Ulrick Axeborne',       cls:'barbarian', hp:65,hpMax:65,ac:14,init:2,spd:40,pp:12,gp:50,inspiration:false,icon:'🪓',
   resources:[{name:'Rage',type:'pool',current:4,max:4},{name:'Reckless Attack',type:'toggle',current:1,max:1}]},
  {id:'creambak',name:'Creambak',              cls:'monk',      hp:47,hpMax:47,ac:16,init:3,spd:40,pp:17,gp:50,inspiration:false,icon:'👊',
   resources:[{name:'Focus Points',type:'pool',current:6,max:6},{name:'Stunning Strike',type:'toggle',current:1,max:1}]},
];

const DEFAULT_LAYOUT = {
  combat:     {x:16,  y:16,  w:320, h:560, open:true,  minimized:false, z:1},
  party:      {x:354, y:16,  w:720, h:380, open:true,  minimized:false, z:2},
  shop:       {x:354, y:412, w:720, h:400, open:false, minimized:false, z:3},
  notes:      {x:400, y:60,  w:560, h:520, open:false, minimized:false, z:4},
  battlemap:  {x:60,  y:60,  w:680, h:500, open:false, minimized:false, z:5},
  npclib:     {x:100, y:80,  w:520, h:580, open:false, minimized:false, z:6},
  npcgen:     {x:160, y:100, w:480, h:540, open:false, minimized:false, z:7},
  loot:       {x:200, y:100, w:480, h:480, open:false, minimized:false, z:8},
  encounter:   {x:150, y:80,  w:700, h:520, open:false, minimized:false, z:8},
  soundboard:  {x:200, y:100, w:580, h:500, open:false, minimized:false, z:9},
};

const DEFAULT_SETTINGS = {currencySymbol:'gp',currencyFormat:'short',priceJitter:20,rounding:'none'};

const ITEM_CATALOG = {
  'Blacksmith/Armory':[
    {name:'Battleaxe',category:'Weapon',basePrice:10,rarity:'Common'},{name:'Dagger',category:'Weapon',basePrice:2,rarity:'Common'},
    {name:'Flail',category:'Weapon',basePrice:10,rarity:'Common'},{name:'Glaive',category:'Weapon',basePrice:20,rarity:'Uncommon'},
    {name:'Greataxe',category:'Weapon',basePrice:30,rarity:'Uncommon'},{name:'Longsword',category:'Weapon',basePrice:15,rarity:'Uncommon'},
    {name:'Pike',category:'Weapon',basePrice:5,rarity:'Common'},{name:'Rapier',category:'Weapon',basePrice:25,rarity:'Uncommon'},
    {name:'Scale Mail',category:'Armor',basePrice:50,rarity:'Uncommon'},{name:'Shield',category:'Armor',basePrice:10,rarity:'Common'},
    {name:'Spear',category:'Weapon',basePrice:1,rarity:'Common'},{name:'Studded Leather',category:'Armor',basePrice:45,rarity:'Uncommon'},
    {name:'Whetstone',category:'Tool',basePrice:1,rarity:'Common'},{name:'Plate Armor',category:'Armor',basePrice:1500,rarity:'Rare'},
    {name:'Warhammer',category:'Weapon',basePrice:15,rarity:'Common'},{name:'Chain Mail',category:'Armor',basePrice:75,rarity:'Uncommon'},
    {name:'+1 Longsword',category:'Weapon',basePrice:800,rarity:'Rare'},
  ],
  'General Store':[
    {name:'Backpack',category:'Tool',basePrice:2,rarity:'Common'},{name:'Bedroll',category:'Tool',basePrice:1,rarity:'Common'},
    {name:'Rope (50 ft)',category:'Tool',basePrice:1,rarity:'Common'},{name:'Torch',category:'Tool',basePrice:1,rarity:'Common'},
    {name:'Lantern, Hooded',category:'Tool',basePrice:5,rarity:'Common'},{name:'Rations (1 day)',category:'Consumable',basePrice:1,rarity:'Common'},
    {name:'Waterskin',category:'Tool',basePrice:1,rarity:'Common'},{name:'Crowbar',category:'Tool',basePrice:2,rarity:'Common'},
    {name:'Climbing Kit',category:'Tool',basePrice:25,rarity:'Uncommon'},{name:"Healer's Kit",category:'Tool',basePrice:5,rarity:'Common'},
    {name:"Thieves' Tools",category:'Tool',basePrice:25,rarity:'Uncommon'},
  ],
  'Alchemist':[
    {name:'Potion of Healing',category:'Potion',basePrice:50,rarity:'Common'},{name:'Potion of Greater Healing',category:'Potion',basePrice:200,rarity:'Uncommon'},
    {name:'Antitoxin',category:'Potion',basePrice:50,rarity:'Common'},{name:'Acid (vial)',category:'Consumable',basePrice:25,rarity:'Common'},
    {name:"Alchemist's Fire",category:'Consumable',basePrice:50,rarity:'Uncommon'},{name:'Holy Water',category:'Consumable',basePrice:25,rarity:'Common'},
    {name:'Potion of Climbing',category:'Potion',basePrice:75,rarity:'Common'},{name:'Potion of Water Breathing',category:'Potion',basePrice:180,rarity:'Uncommon'},
    {name:'Potion of Giant Strength (Hill)',category:'Potion',basePrice:200,rarity:'Uncommon'},{name:'Potion of Heroism',category:'Potion',basePrice:180,rarity:'Uncommon'},
  ],
  'Magic Shop':[
    {name:'Bag of Holding',category:'Wondrous',basePrice:4000,rarity:'Uncommon'},{name:'Cloak of Protection',category:'Wondrous',basePrice:3500,rarity:'Uncommon'},
    {name:'Wand of Magic Missiles',category:'Wand',basePrice:1500,rarity:'Uncommon'},{name:'Boots of Elvenkind',category:'Wondrous',basePrice:2500,rarity:'Uncommon'},
    {name:'Driftglobe',category:'Wondrous',basePrice:800,rarity:'Uncommon'},{name:'Goggles of Night',category:'Wondrous',basePrice:2000,rarity:'Uncommon'},
    {name:'Pearl of Power',category:'Wondrous',basePrice:3000,rarity:'Uncommon'},{name:'Spell Scroll (1st)',category:'Scroll',basePrice:75,rarity:'Common'},
    {name:'Spell Scroll (2nd)',category:'Scroll',basePrice:250,rarity:'Uncommon'},{name:'Spell Scroll (3rd)',category:'Scroll',basePrice:500,rarity:'Uncommon'},
  ],
  'Tavern':[
    {name:'Ale (mug)',category:'Drink',basePrice:0.04,rarity:'Common'},{name:'Wine, Fine (bottle)',category:'Drink',basePrice:10,rarity:'Uncommon'},
    {name:'Bread, Loaf',category:'Food',basePrice:0.02,rarity:'Common'},{name:'Stew, Bowl',category:'Food',basePrice:0.1,rarity:'Common'},
    {name:'Inn Stay, Common',category:'Lodging',basePrice:0.5,rarity:'Common'},{name:'Inn Stay, Comfortable',category:'Lodging',basePrice:2,rarity:'Uncommon'},
  ],
  'Jeweler':[
    {name:'Silver Ring',category:'Jewelry',basePrice:25,rarity:'Common'},{name:'Gold Ring',category:'Jewelry',basePrice:75,rarity:'Uncommon'},
    {name:'Gemstone, Amethyst',category:'Gem',basePrice:100,rarity:'Uncommon'},{name:'Gemstone, Emerald',category:'Gem',basePrice:1000,rarity:'Rare'},
    {name:'Pearl',category:'Gem',basePrice:100,rarity:'Uncommon'},
  ],
  'Bookshop':[
    {name:'Book, Common',category:'Book',basePrice:25,rarity:'Common'},{name:'Spellbook (blank)',category:'Book',basePrice:50,rarity:'Common'},
    {name:'Map, Local',category:'Book',basePrice:10,rarity:'Common'},{name:'Map, Regional',category:'Book',basePrice:50,rarity:'Uncommon'},
    {name:'Ink (1 oz)',category:'Tool',basePrice:10,rarity:'Common'},{name:'Parchment (sheet)',category:'Tool',basePrice:0.1,rarity:'Common'},
  ],
  'Fletcher':[
    {name:'Shortbow',category:'Weapon',basePrice:25,rarity:'Common'},{name:'Longbow',category:'Weapon',basePrice:50,rarity:'Uncommon'},
    {name:'Hand Crossbow',category:'Weapon',basePrice:75,rarity:'Uncommon'},{name:'Arrows (20)',category:'Ammo',basePrice:1,rarity:'Common'},
    {name:'Silvered Arrows (10)',category:'Ammo',basePrice:100,rarity:'Uncommon'},
  ],
};

const SHOPKEEPER_NAMES=['Vessa Pike','Borin Stoneward','Mira Greybark','Dorn Ashforge','Tilda Goldcrest','Hark Ironfist','Sela Brewstone','Olric Coppervein','Maelle Fenwick','Renn Quickfingers'];
const QUIRKS=['Insists on exact change','Has a pet mouse on shoulder','Hums constantly','Tells long-winded stories','Never breaks eye contact','Smells of cinnamon','Has a fake leg','Calls everyone "friend"','Wears too many rings','Always smoking a pipe'];
const TONES=['Gruff but generous','Cheerful and chatty','Cold and businesslike','Suspicious of adventurers','Eager to haggle','Pretends to be poor','Brags constantly'];
const AESTHETICS={
  'Blacksmith/Armory':['Walls blackened by years of labor; sparks drift like fireflies.','Anvils ring in rhythm; the air shimmers above the forge.','Chainmail hangs in neat rows; oil and steel scent the air.'],
  'General Store':['Shelves crammed floor to ceiling; barely room to move.','Sunlight filters through dusty windows onto well-worn floorboards.','A friendly cat naps atop a barrel of flour.'],
  'Alchemist':['Vials of unknown liquid bubble on a crowded shelf.','Strange herbs hang drying from the rafters.','The air is thick with sulfur and lavender.'],
  'Magic Shop':['Glyphs glow softly along the doorframe.','Shelves seem to rearrange themselves when you blink.','A crystal ball pulses gently in a velvet cradle.'],
  'Tavern':['Smoke-stained beams cross above warm lamplight.','A bard plays badly by the hearth; no one minds.','Long tables crowded with locals and travelers alike.'],
  'Jeweler':['Velvet displays catch the lamplight; everything sparkles.','Mirrors angled to catch the gleam of every gem.'],
  'Bookshop':['Towers of books lean precariously in every corner.','Old paper and ink — smells like memory itself.'],
  'Fletcher':['Bundles of arrows stand like sheaves of grain.','Bowstrings hum faintly when the wind shifts.'],
};

const SEARCH_DATA=[
  {cat:'monster',name:'Hill Giant',meta:'Huge giant · CR 5',hp:105,ac:13,speed:'40 ft',str:21,dex:8,con:19,int:5,wis:9,cha:6,senses:'passive Perception 12',languages:'Giant',actions:'Multiattack: Two greatclub attacks. Greatclub: +8, 18 (3d8+5) bludgeoning. Rock: +8, range 60/240, 21 (3d10+5).'},
  {cat:'monster',name:'Stone Giant',meta:'Huge giant · CR 7',hp:126,ac:17,speed:'40 ft',str:23,dex:15,con:20,int:10,wis:12,cha:9,senses:'darkvision 60 ft, passive Perception 14',languages:'Giant',actions:'Multiattack: Two greatclub attacks. Greatclub: +9, reach 15 ft, 19 (3d8+6). Rock: +9, range 60/240, 28 (4d10+6).'},
  {cat:'monster',name:'Frost Giant',meta:'Huge giant · CR 8',hp:138,ac:15,speed:'40 ft',str:23,dex:9,con:21,int:9,wis:10,cha:12,senses:'passive Perception 13',languages:'Giant',actions:'Multiattack: Two greataxe attacks. Greataxe: +9, 25 (3d12+6) slashing. Rock: +9, range 60/240, 28 (4d10+6). Resists cold.'},
  {cat:'monster',name:'Fire Giant',meta:'Huge giant · CR 9',hp:162,ac:18,speed:'30 ft',str:25,dex:9,con:23,int:10,wis:14,cha:13,senses:'passive Perception 16',languages:'Giant',actions:'Multiattack: Two greatsword attacks. Greatsword: +11, 28 (6d6+7) slashing. Rock: +11, range 60/240, 29 (4d10+7). Immune fire.'},
  {cat:'monster',name:'Cloud Giant',meta:'Huge giant · CR 9',hp:200,ac:14,speed:'40 ft',str:27,dex:10,con:22,int:12,wis:16,cha:16,senses:'passive Perception 17',languages:'Common, Giant',actions:'Multiattack: Two morningstar attacks. Morningstar: +12, 21 (3d8+8). Rock: +12, range 60/240, 30 (4d10+8). Innate spells: fog cloud, fly, telekinesis.'},
  {cat:'monster',name:'Storm Giant',meta:'Huge giant · CR 13',hp:230,ac:16,speed:'50 ft, swim 50 ft',str:29,dex:14,con:20,int:16,wis:18,cha:18,senses:'passive Perception 19',languages:'Common, Giant',actions:'Multiattack: Two greatsword attacks. Greatsword: +14, 30 (6d6+9). Rock: +14, 35 (4d12+9). Lightning Strike: 60 ft line, DC 17 Dex, 54 (12d8). Innate: control weather.'},
  {cat:'monster',name:'Goblin',meta:'Small humanoid · CR 1/4',hp:7,ac:15,speed:'30 ft',str:8,dex:14,con:10,int:10,wis:8,cha:8,senses:'darkvision 60 ft, passive Perception 9',languages:'Common, Goblin',actions:'Scimitar: +4, 5 (1d6+2) slashing. Shortbow: +4, range 80/320, 5 (1d6+2). Nimble Escape: Disengage or Hide as bonus action.'},
  {cat:'monster',name:'Orc',meta:'Medium humanoid · CR 1/2',hp:15,ac:13,speed:'30 ft',str:16,dex:12,con:16,int:7,wis:11,cha:10,senses:'darkvision 60 ft, passive Perception 10',languages:'Common, Orc',actions:'Greataxe: +5, 9 (1d12+3) slashing. Javelin: +5, 6 (1d6+3). Aggressive: bonus action move toward hostile creature.'},
  {cat:'monster',name:'Hobgoblin',meta:'Medium humanoid · CR 1/2',hp:11,ac:18,speed:'30 ft',str:13,dex:12,con:12,int:10,wis:10,cha:9,senses:'darkvision 60 ft, passive Perception 10',languages:'Common, Goblin',actions:'Longsword: +3, 5 (1d8+1) slashing. Longbow: +3, range 150/600, 5 (1d8+1). Martial Advantage: +7 (2d6) if ally within 5 ft.'},
  {cat:'monster',name:'Ogre',meta:'Large giant · CR 2',hp:59,ac:11,speed:'40 ft',str:19,dex:8,con:16,int:5,wis:7,cha:7,senses:'darkvision 60 ft, passive Perception 8',languages:'Common, Giant',actions:'Greatclub: +6, 13 (2d8+4). Javelin: +6, melee or range 30/120, 11 (2d6+4).'},
  {cat:'monster',name:'Troll',meta:'Large giant · CR 5',hp:84,ac:15,speed:'30 ft',str:18,dex:13,con:20,int:7,wis:9,cha:7,senses:'darkvision 60 ft, passive Perception 12',languages:'Giant',actions:'Multiattack: Bite + 2 claws. Bite: +7, 7 (1d6+4). Claw: +7, 11 (2d6+4). Regeneration: 10 HP/turn unless took fire/acid.'},
  {cat:'monster',name:'Young Red Dragon',meta:'Large dragon · CR 10',hp:178,ac:18,speed:'40 ft, fly 80 ft',str:23,dex:10,con:21,int:14,wis:11,cha:19,senses:'blindsight 30 ft, darkvision 120 ft',languages:'Common, Draconic',actions:'Multiattack: bite + 2 claws. Bite: +10, 17 (2d10+6) + 1d6 fire. Fire Breath (recharge 5-6): 30 ft cone, DC 17 Dex, 56 (16d6) fire.'},
  {cat:'monster',name:'Adult Red Dragon',meta:'Huge dragon · CR 17',hp:256,ac:19,speed:'40 ft, fly 80 ft',str:27,dex:10,con:25,int:16,wis:13,cha:21,senses:'blindsight 60 ft, darkvision 120 ft',languages:'Common, Draconic',actions:'Multiattack: Frightful Presence + bite + 2 claws. Fire Breath (recharge 5-6): 60 ft cone, DC 21 Dex, 63 (18d6) fire.'},
  {cat:'monster',name:'Zombie',meta:'Medium undead · CR 1/4',hp:22,ac:8,speed:'20 ft',str:13,dex:6,con:16,int:3,wis:6,cha:5,senses:'darkvision 60 ft',languages:'—',actions:'Slam: +3, 4 (1d6+1) bludgeoning. Undead Fortitude: Con save DC 5+damage or stay at 1 HP (not radiant/crit).'},
  {cat:'monster',name:'Skeleton',meta:'Medium undead · CR 1/4',hp:13,ac:13,speed:'30 ft',str:10,dex:14,con:15,int:6,wis:8,cha:5,senses:'darkvision 60 ft',languages:'—',actions:'Shortsword: +4, 5 (1d6+2). Shortbow: +4, range 80/320. Vulnerable bludgeoning. Immune poison/exhaustion.'},
  {cat:'monster',name:'Bandit Captain',meta:'Medium humanoid · CR 2',hp:65,ac:15,speed:'30 ft',str:15,dex:16,con:14,int:14,wis:11,cha:14,senses:'passive Perception 10',languages:'any two',actions:'Multiattack: 2 scimitars + dagger. Scimitar: +5, 6 (1d6+3). Reaction: Parry +2 AC vs one melee attack.'},
  {cat:'monster',name:'Dire Wolf',meta:'Large beast · CR 1',hp:37,ac:14,speed:'50 ft',str:17,dex:15,con:15,int:3,wis:12,cha:7,senses:'passive Perception 13',languages:'—',actions:'Bite: +5, 10 (2d6+3) piercing. DC 13 Str or prone. Pack Tactics.'},
  {cat:'monster',name:'Iymrith',meta:'Ancient Blue Dragon · CR 22 (SKT)',hp:481,ac:22,speed:'40 ft, burrow 40 ft, fly 80 ft',str:29,dex:10,con:25,int:18,wis:15,cha:19,senses:'blindsight 60 ft, darkvision 120 ft',languages:'Common, Draconic',actions:'Lightning Breath (recharge 5-6): 120 ft line, DC 23 Dex, 88 (16d10) lightning. Bite: +16, 18 (2d10+9) + 11 (2d10) lightning.'},
  {cat:'spell',name:'Healing Word',meta:'1st level evocation',cast:'1 bonus action',range:'60 ft',components:'V',duration:'Instantaneous',desc:'A creature you can see regains 1d4 + spellcasting modifier HP. Higher levels: +1d4 per slot above 1st.'},
  {cat:'spell',name:'Cure Wounds',meta:'1st level evocation',cast:'1 action',range:'Touch',components:'V, S',duration:'Instantaneous',desc:'Creature you touch regains 1d8 + spellcasting modifier HP. Higher levels: +1d8 per slot above 1st.'},
  {cat:'spell',name:'Fireball',meta:'3rd level evocation',cast:'1 action',range:'150 ft',components:'V, S, M',duration:'Instantaneous',desc:'20 ft radius sphere. Dex save or 8d6 fire damage, half on success. Higher levels: +1d6 per slot above 3rd.'},
  {cat:'spell',name:'Counterspell',meta:'3rd level abjuration',cast:'1 reaction',range:'60 ft',components:'S',duration:'Instantaneous',desc:'Spell of 3rd level or lower automatically fails. 4th+: ability check DC 10 + spell level.'},
  {cat:'spell',name:'Shield',meta:'1st level abjuration',cast:'1 reaction',range:'Self',components:'V, S',duration:'1 round',desc:'+5 AC until start of your next turn, including the triggering attack. Take no damage from magic missile.'},
  {cat:'spell',name:'Misty Step',meta:'2nd level conjuration',cast:'1 bonus action',range:'Self',components:'V',duration:'Instantaneous',desc:'Teleport up to 30 ft to an unoccupied space you can see.'},
  {cat:'spell',name:'Hold Person',meta:'2nd level enchantment',cast:'1 action',range:'60 ft',components:'V, S, M',duration:'Concentration, 1 minute',desc:'Humanoid: Wis save or paralyzed. Repeats save end of each turn. Higher levels: +1 humanoid per slot above 2nd.'},
  {cat:'spell',name:'Bless',meta:'1st level enchantment',cast:'1 action',range:'30 ft',components:'V, S, M',duration:'Concentration, 1 minute',desc:'Up to 3 creatures: each adds 1d4 to attack rolls and saving throws.'},
  {cat:'spell',name:"Hunter's Mark",meta:'1st level divination',cast:'1 bonus action',range:'90 ft',components:'V',duration:'Concentration, 1 hour',desc:'+1d6 damage on weapon hits against the marked creature. Advantage on Wis (Perception/Survival) to find it.'},
  {cat:'spell',name:'Spiritual Weapon',meta:'2nd level evocation',cast:'1 bonus action',range:'60 ft',components:'V, S',duration:'1 minute',desc:'Floating weapon. Bonus action: move 20 ft + attack. Spellcasting + proficiency, 1d8 + mod force damage.'},
  {cat:'spell',name:'Faerie Fire',meta:'1st level evocation',cast:'1 action',range:'60 ft',components:'V',duration:'Concentration, 1 minute',desc:'20 ft cube. Dex save or outlined in light. Outlined creatures: no invisibility benefit, attacks against have advantage.'},
  {cat:'spell',name:'Pass without Trace',meta:'2nd level abjuration',cast:'1 action',range:'Self',components:'V, S, M',duration:'Concentration, 1 hour',desc:'You and creatures within 30 ft: +10 to Dex (Stealth), cannot be tracked except by magic.'},
  {cat:'spell',name:'Eldritch Blast',meta:'Cantrip evocation',cast:'1 action',range:'120 ft',components:'V, S',duration:'Instantaneous',desc:'Ranged spell attack: 1d10 force. 5th: 2 beams. 11th: 3. 17th: 4. Same or different targets.'},
  {cat:'spell',name:'Polymorph',meta:'4th level transmutation',cast:'1 action',range:'60 ft',components:'V, S, M',duration:'Concentration, 1 hour',desc:'Transform creature into beast with CR ≤ target level/CR. Wis save negates (unwilling). Reverts at 0 HP.'},
  {cat:'spell',name:'Revivify',meta:'3rd level necromancy',cast:'1 action',range:'Touch',components:'V, S, M (300 gp diamond)',duration:'Instantaneous',desc:'Creature dead < 1 minute returns to life with 1 HP.'},
  {cat:'item',name:'Potion of Healing',meta:'Potion · Common',desc:'Drink as an action. Regain 2d4+2 HP.'},
  {cat:'item',name:'Potion of Greater Healing',meta:'Potion · Uncommon',desc:'Drink as an action. Regain 4d4+4 HP.'},
  {cat:'item',name:'Potion of Superior Healing',meta:'Potion · Rare',desc:'Drink as an action. Regain 8d4+8 HP.'},
  {cat:'item',name:'Bag of Holding',meta:'Wondrous · Uncommon',desc:'Inside dimension holds up to 500 lb / 64 cubic feet. Bag weighs 15 lb.'},
  {cat:'item',name:'Cloak of Protection',meta:'Wondrous · Uncommon (attunement)',desc:'+1 to AC and saving throws while worn.'},
  {cat:'item',name:'Wand of Magic Missiles',meta:'Wand · Uncommon',desc:'7 charges. Expend 1+ to cast magic missile (1 charge = 1st level). Regains 1d6+1 at dawn.'},
  {cat:'item',name:'Gauntlets of Ogre Power',meta:'Wondrous · Uncommon (attunement)',desc:'Strength becomes 19 while worn.'},
  {cat:'item',name:'Belt of Hill Giant Strength',meta:'Wondrous · Rare (attunement)',desc:'Strength becomes 21.'},
  {cat:'item',name:'Belt of Stone/Frost Giant Strength',meta:'Wondrous · Very Rare (attunement)',desc:'Strength becomes 23.'},
  {cat:'item',name:'Belt of Fire Giant Strength',meta:'Wondrous · Very Rare (attunement)',desc:'Strength becomes 25.'},
  {cat:'item',name:'Belt of Cloud Giant Strength',meta:'Wondrous · Legendary (attunement)',desc:'Strength becomes 27.'},
  {cat:'item',name:'Belt of Storm Giant Strength',meta:'Wondrous · Legendary (attunement)',desc:'Strength becomes 29.'},
  {cat:'item',name:'Korolnor Scepter',meta:'Wondrous · Legendary (SKT)',desc:'Symbol of authority over Maelstrom. Key plot item — wielded by King Hekaton.'},
  {cat:'item',name:'Wyrmskull Throne',meta:'Artifact (SKT)',desc:'Teleportation throne at Maelstrom. Stolen during the events of SKT.'},
  {cat:'condition',name:'Blinded',meta:'Condition',desc:'Auto-fail checks requiring sight. Attacks against have advantage; your attacks have disadvantage.'},
  {cat:'condition',name:'Charmed',meta:'Condition',desc:'Cannot attack charmer or target with harmful abilities. Charmer has advantage on social checks against you.'},
  {cat:'condition',name:'Frightened',meta:'Condition',desc:'Disadvantage on ability checks and attacks while source is in line of sight. Cannot move closer to source.'},
  {cat:'condition',name:'Grappled',meta:'Condition',desc:'Speed becomes 0. Ends if grappler is incapacitated or effect removes you from reach.'},
  {cat:'condition',name:'Incapacitated',meta:'Condition',desc:'Cannot take actions or reactions.'},
  {cat:'condition',name:'Paralyzed',meta:'Condition',desc:'Incapacitated. Cannot move or speak. Auto-fail Str/Dex saves. All attacks have advantage. Hits within 5 ft are crits.'},
  {cat:'condition',name:'Petrified',meta:'Condition',desc:'Transformed to stone. Incapacitated, weight ×10. Auto-fail Str/Dex saves. Resistance to all damage.'},
  {cat:'condition',name:'Poisoned',meta:'Condition',desc:'Disadvantage on attack rolls and ability checks.'},
  {cat:'condition',name:'Prone',meta:'Condition',desc:'Crawling only (half speed to stand). Disadvantage on attacks. Attacks against: advantage within 5 ft, else disadvantage.'},
  {cat:'condition',name:'Restrained',meta:'Condition',desc:'Speed 0. Attacks against have advantage; your attacks have disadvantage. Disadvantage on Dex saves.'},
  {cat:'condition',name:'Stunned',meta:'Condition',desc:'Incapacitated. Cannot move, can barely speak. Auto-fail Str/Dex saves. Attacks against have advantage.'},
  {cat:'condition',name:'Unconscious',meta:'Condition',desc:'Incapacitated, drops items, falls prone. Auto-fail Str/Dex saves. Hits within 5 ft are crits.'},
  {cat:'condition',name:'Exhaustion',meta:'Condition · 6 levels',desc:'L1: Disadv on ability checks. L2: Speed halved. L3: Disadv attacks/saves. L4: HP max halved. L5: Speed 0. L6: Death.'},
];
