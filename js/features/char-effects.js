// ============================================================
// CHARACTER RULES — what each feature does, beyond its text
// ============================================================
// The effects the data only states in prose, for char-rules.js to apply.
// Kept apart from the engine because this is the file that grows: every
// feature made mechanical is an entry here, and nothing else changes.
//
// Four shapes of entry, by what the feature is at the table:
//   pool(name, n, recharge)   a limited use the party card counts down
//   act({ name, action, … })  something you DO, spendable from the phone and
//                             the Turn View, with the pool it costs
//   note(text)                a rule always in effect, listed under
//                             "Always in effect" on the sheet
//   ctx changes               numbers on the sheet: AC, speed, saves,
//                             senses, immunities, skill bonuses
// and sktDefineChoice for a feature that asks a question (Divine Order).
//
// Keys: '<from>:<class>:<name>', optionally prefixed with an edition
// ('2014:' / '2024:') when the two books differ. Descriptions are short
// summaries for the table, not the rules text — the full text is always
// on the sheet beside them.

(function(api){
  const def = api.sktDefineEffect, choice = api.sktDefineChoice;
  const pool = api._fxPool, act = api._fxAction, note = api._fxNote, col = api._fxCol;
  const both = (keys, fn) => def(keys, fn);
  const abm = (ctx, k) => Math.max(1, ctx.mod[k]);   // "your X modifier (minimum of 1)"
  const signed = n => (n >= 0 ? '+' : '') + n;

  // ── Artificer ──────────────────────────────────────────────────────────
  def('2014:class:artificer:Magical Tinkering', ctx => note(ctx, 'Magical Tinkering: touch a Tiny object to give it light, a recorded message, a sound or a picture; up to ' + abm(ctx, 'int') + ' objects at once.'));
  def('2024:class:artificer:Tinker\'s Magic', ctx => {
    pool(ctx, 'Tinker\'s Magic', abm(ctx, 'int'), 'long');
    act(ctx, { name: 'Tinker\'s Magic', action: 'Magic', resource: 'Tinker\'s Magic', amount: 1, feature: 'Tinker\'s Magic',
      desc: 'Holding tinker\'s tools, create an item from the list (rope, a torch, a lamp…) within 5 feet; it lasts until a long rest.' });
  });
  def('2014:class:artificer:Optional Rule: Firearm Proficiency', ctx => note(ctx, 'Firearm Proficiency: if your DM uses firearms, you are proficient with them.'));
  def('2024:class:artificer:Replicate Magic Item', ctx => {
    const plans = col(ctx, 'Plans Known') || 4, items = col(ctx, 'Magic Items') || 2;
    note(ctx, 'Replicate Magic Item: you know ' + plans + ' magic item plans; at the end of a long rest, make up to ' + items + ' items from them with the right tools. They last until you replace them.');
  });
  def('2024:class:artificer:Magic Item Tinker', ctx => note(ctx, 'Magic Item Tinker: as a bonus action, recharge an item you replicated with a spell slot, or make one vanish to gain a spell slot (level 1 for Common, 2 for Uncommon or Rare) once per long rest.'));
  def('2024:class:artificer:Advanced Artifice', ctx => {
    ctx.attuneMax = Math.max(ctx.attuneMax || 3, 5);
    note(ctx, 'Advanced Artifice: you can attune to up to five magic items; a short rest restores one use of Flash of Genius.');
    const r = ctx.resources.find(x => x.name === 'Flash of Genius');
    if (r) r.recharge = 'short-one';
  });
  def('2014:class:artificer:Infuse Item', ctx => {
    const n = col(ctx, 'Infused Items') || 2;
    note(ctx, 'Infuse Item: at the end of a long rest, infuse up to ' + n + ' nonmagical items with infusions you know; an infusion lasts until you replace it.');
  });
  both(['class:artificer:Flash of Genius'], ctx => {
    pool(ctx, 'Flash of Genius', abm(ctx, 'int'), 'long');
    act(ctx, { name: 'Flash of Genius', action: 'Reaction', resource: 'Flash of Genius', amount: 1, feature: 'Flash of Genius',
      desc: 'When you or a creature within 30 feet ' + (ctx.edition === '2024' ? 'fails' : 'makes') + ' an ability check or save, add ' + signed(abm(ctx, 'int')) + ' to it.' });
  });
  both(['class:artificer:Spell-Storing Item'], ctx => {
    pool(ctx, 'Spell-Storing Item', 2 * abm(ctx, 'int'), 'long');
    act(ctx, { name: 'Spell-Storing Item', action: 'Action', resource: 'Spell-Storing Item', amount: 1, feature: 'Spell-Storing Item',
      desc: 'Whoever holds the stored item casts its ' + (ctx.edition === '2024' ? 'level 1–3' : '1st- or 2nd-level') + ' artificer spell, using your spellcasting modifier.' });
  });
  both(['class:artificer:Tool Expertise'], ctx => note(ctx, 'Tool Expertise: your proficiency bonus is doubled for any ability check using a tool you\'re proficient with.'));
  both(['class:artificer:The Right Tool for the Job'], ctx => note(ctx, 'The Right Tool for the Job: with thieves\' tools or artisan\'s tools in hand, spend an hour (or a short rest) to make one set of artisan\'s tools.'));
  both(['class:artificer:Magic Item Adept'], ctx => (ctx.attuneMax = Math.max(ctx.attuneMax || 3, 4), note(ctx, 'Magic Item Adept: you can attune to up to four magic items at once' + (ctx.edition === '2014' ? '; crafting a common or uncommon magic item takes a quarter of the time and half the gold.' : '.'))));
  both(['class:artificer:Magic Item Savant'], ctx => (ctx.attuneMax = Math.max(ctx.attuneMax || 3, 5), note(ctx, 'Magic Item Savant: you can attune to up to five magic items and ignore class, species, spell and level requirements on them.')));
  both(['class:artificer:Magic Item Master'], ctx => (ctx.attuneMax = Math.max(ctx.attuneMax || 3, 6), note(ctx, 'Magic Item Master: you can attune to up to six magic items at once.')));
  def('2014:class:artificer:Soul of Artifice', ctx => note(ctx, 'Soul of Artifice: +1 to all saving throws per magic item you\'re attuned to; when reduced to 0 HP, use your reaction to end an infusion and drop to 1 HP instead.'));
  def('2024:class:artificer:Soul of Artifice', ctx => note(ctx, 'Soul of Artifice: +1 to saving throws per attuned magic item; when reduced to 0 HP, disintegrate Uncommon or Rare items you replicated to drop to 20 HP per item instead.'));
  both(['subclass:Experimental Elixir'], ctx => {
    const L = ctx.level;
    const n = ctx.edition === '2024' ? (L >= 15 ? 5 : L >= 9 ? 4 : L >= 5 ? 3 : 2) : (L >= 15 ? 3 : L >= 6 ? 2 : 1);
    pool(ctx, 'Experimental Elixir', n, 'long');
    act(ctx, { name: 'Experimental Elixir', action: ctx.edition === '2024' ? 'Bonus Action' : 'Action', feature: 'Experimental Elixir',
      desc: 'Elixirs made at the end of a long rest (' + n + '): healing, swiftness, resilience, boldness, flight or transformation, rolled on the table. More cost a spell slot each.' });
  });
  both(['subclass:Eldritch Cannon'], ctx => {
    pool(ctx, 'Eldritch Cannon', 1, 'long');
    act(ctx, { name: 'Eldritch Cannon', action: ctx.edition === '2024' ? 'Magic' : 'Action', resource: 'Eldritch Cannon', amount: 1, feature: 'Eldritch Cannon',
      desc: 'Create a Small or Tiny cannon within 5 feet: flamethrower, force ballista or protector. Make another by spending a spell slot.' });
  });
  both(['subclass:Arcane Jolt'], ctx => {
    pool(ctx, 'Arcane Jolt', abm(ctx, 'int'), 'long');
    act(ctx, { name: 'Arcane Jolt', action: 'Free', resource: 'Arcane Jolt', amount: 1, feature: 'Arcane Jolt',
      desc: 'Once per turn when you or your steel defender hit with a magic weapon: an extra ' + (ctx.level >= 15 ? '4d6' : '2d6') + ' force damage, or heal a creature within 30 feet that much.' });
  });
  both(['subclass:Steel Defender'], ctx => note(ctx, 'Steel Defender: your companion acts on your turn; it takes the Dodge action unless you use a bonus action to command it. Its stat block uses your proficiency bonus.'));

  // ── Feats ──────────────────────────────────────────────────────────────
  // Elemental Adept names its damage type only in the text.
  choice(['feat:Elemental Adept'], {
    label: 'Elemental Adept',
    options: ['Acid', 'Cold', 'Fire', 'Lightning', 'Thunder'].map(d => ({ value: d, label: d,
      desc: 'Your spells ignore resistance to ' + d.toLowerCase() + ' damage, and a 1 on their ' + d.toLowerCase() + ' damage dice counts as a 2.' })),
    apply(ctx, v){ note(ctx, 'Elemental Adept (' + v + '): spells ignore resistance to ' + v.toLowerCase() + ' damage; 1s on its damage dice count as 2s.'); },
  });

  // ── Draconic sorcery: the ancestor, and its damage type ────────────────
  // 2014: Dragon Ancestor picks a dragon; Elemental Affinity (6th) adds
  // Charisma to that damage and can buy resistance. 2024: Elemental Affinity
  // picks the type and gives resistance to it.
  const SKT_DRAGONS = [['Black', 'Acid'], ['Blue', 'Lightning'], ['Brass', 'Fire'], ['Bronze', 'Lightning'], ['Copper', 'Acid'],
                       ['Gold', 'Fire'], ['Green', 'Poison'], ['Red', 'Fire'], ['Silver', 'Cold'], ['White', 'Cold']];
  choice(['2014:subclass:sorcerer:Dragon Ancestor'], {
    label: 'Dragon Ancestor',
    options: SKT_DRAGONS.map(([d, t]) => ({ value: d, label: d + ' (' + t + ')', desc: t + ' damage: your later draconic features use it.' })),
    apply(ctx, v){ const d = SKT_DRAGONS.find(x => x[0] === v); if (d){ ctx.dragonDamage = d[1]; note(ctx, 'Dragon Ancestor: ' + d[0] + ' dragon (' + d[1].toLowerCase() + ').'); } },
  });
  def('2014:subclass:sorcerer:Elemental Affinity', ctx => {
    const v = ((ctx.build._full || ctx.build).featureChoices || {})['Dragon Ancestor'], d = SKT_DRAGONS.find(x => x[0] === v);
    note(ctx, 'Elemental Affinity: add ' + signed(ctx.mod.cha) + ' to one damage roll of a ' + (d ? d[1].toLowerCase() : 'your ancestry’s') + ' spell; 1 sorcery point for resistance to it for 1 hour.');
  });
  choice(['2024:subclass:sorcerer:Elemental Affinity'], {
    label: 'Elemental Affinity',
    options: ['Acid', 'Cold', 'Fire', 'Lightning', 'Poison'].map(t => ({ value: t, label: t, desc: 'Resistance to ' + t.toLowerCase() + ' damage, and your Charisma modifier on one damage roll of a ' + t.toLowerCase() + ' spell.' })),
    apply(ctx, v){ ctx.resist.add(v.toLowerCase()); note(ctx, 'Elemental Affinity (' + v + '): resistance to ' + v.toLowerCase() + '; add ' + signed(ctx.mod.cha) + ' to one damage roll of a ' + v.toLowerCase() + ' spell.'); },
  });

  // A Noble Genies paladin's aura resists the damage type chosen.
  choice(['2024:subclass:paladin:Aura of Elemental Shielding'], {
    label: 'Aura of Elemental Shielding',
    options: ['Acid', 'Cold', 'Fire', 'Lightning', 'Thunder'].map(t => ({ value: t, label: t, desc: 'You and allies in your aura have resistance to ' + t.toLowerCase() + ' damage.' })),
    apply(ctx, v){ ctx.resist.add(v.toLowerCase()); note(ctx, 'Aura of Elemental Shielding (' + v + '): you and allies in your aura resist ' + v.toLowerCase() + ' damage.'); },
  });

  // ── The Simic Hybrid's animal enhancements ─────────────────────────────
  def('species:Animal Enhancement', ctx => {
    const p = ((((ctx.build._full || ctx.build).profPicks || {})['Animal Enhancement'] || {}).enhancements || []);
    const say = { 'Manta Glide': 'Manta Glide: subtract up to 100 feet from a fall, and glide 2 feet sideways per foot you fall.',
      'Nimble Climber': 'Nimble Climber: a climbing speed equal to your walking speed.',
      'Underwater Adaptation': 'Underwater Adaptation: you breathe air and water, and have a swimming speed equal to your walking speed.',
      'Grappling Appendage': 'Grappling Appendage: two claws or tentacles; grapple with one as an action, 1d6 + Strength unarmed strikes.',
      'Carapace': 'Carapace: +1 AC while you aren’t wearing heavy armor.',
      'Acid Spit': 'Acid Spit: an action, a creature within 30 feet makes a Dexterity save or takes acid damage.' };
    p.forEach(n => { if (say[n]) note(ctx, say[n]); });
    if (p.includes('Carapace')) ctx.acUnlessHeavy += 1;
    if (p.includes('Acid Spit')) pool(ctx, 'Acid Spit', abm(ctx, 'con'), 'long');
  });

  // ── Psionic Energy (Psi Warrior, Soulknife) ────────────────────────────
  def('2014:subclass:Psionic Power', ctx => {
    const L = ctx.level, die = L >= 17 ? 'd12' : L >= 11 ? 'd10' : L >= 5 ? 'd8' : 'd6';
    pool(ctx, 'Psionic Energy', 2 * ctx.pb, 'long', { die });
    note(ctx, 'Psionic Energy: ' + 2 * ctx.pb + ' ' + die + ' dice; once per short rest, a bonus action regains one.');
  });
  def('2024:subclass:Psionic Power', ctx => {
    const n = col(ctx, 'Number') || 4, die = String(col(ctx, 'Die Size') || 'd6').toLowerCase();
    pool(ctx, 'Psionic Energy', typeof n === 'number' ? n : 4, 'short-one', { die });
  });

  // ── Barbarian ──────────────────────────────────────────────────────────
  def('2014:class:barbarian:Brutal Critical', ctx => {
    const n = ctx.level >= 17 ? 3 : ctx.level >= 13 ? 2 : 1;
    ctx.critExtraDice = Math.max(ctx.critExtraDice || 0, n);
    note(ctx, 'Brutal Critical: a critical hit with a melee weapon rolls ' + n + ' extra weapon damage ' + (n === 1 ? 'die' : 'dice') + '.');
  });
  both(['class:barbarian:Relentless Rage'], ctx => note(ctx, 'Relentless Rage: dropping to 0 HP while raging, make a DC 10 Constitution save (DC +5 each time) to drop to 1 HP instead.'));
  both(['class:barbarian:Persistent Rage'], ctx => note(ctx, 'Persistent Rage: your rage only ends early if you fall unconscious or choose to end it.'));
  both(['class:barbarian:Indomitable Might'], ctx => note(ctx, 'Indomitable Might: a Strength check or Strength save that totals less than your Strength score (' + ctx.abilities.str + ') counts as that score.'));
  def('2024:class:barbarian:Primal Knowledge', ctx => note(ctx, 'Primal Knowledge: while raging, Acrobatics, Intimidation, Perception, Stealth and Survival checks can use Strength.'));
  def('2024:class:barbarian:Instinctive Pounce', ctx => note(ctx, 'Instinctive Pounce: when you enter your rage, move up to half your speed.'));
  def('2024:class:barbarian:Brutal Strike', ctx => {
    const d = ctx.level >= 17 ? '2d10' : '1d10';
    note(ctx, 'Brutal Strike: give up advantage from Reckless Attack on one attack to add ' + d + ' damage and a Brutal Strike effect' + (ctx.level >= 17 ? ' (two effects)' : '') + '.');
  });
  def('2024:class:barbarian:Improved Brutal Strike', () => {});   // folded into Brutal Strike's text

  // ── Bard ───────────────────────────────────────────────────────────────
  def('2014:class:bard:Song of Rest', ctx => {
    const d = ctx.level >= 17 ? 'd12' : ctx.level >= 13 ? 'd10' : ctx.level >= 9 ? 'd8' : 'd6';
    note(ctx, 'Song of Rest: during a short rest, allies who spend Hit Dice regain an extra 1' + d + ' hit points.');
  });
  both(['class:bard:Font of Inspiration'], () => {});              // Bardic Inspiration's recharge
  both(['class:bard:Countercharm'], ctx => act(ctx, { name: 'Countercharm', action: ctx.edition === '2024' ? 'Reaction' : 'Action', feature: 'Countercharm',
    desc: ctx.edition === '2024' ? 'When a creature within 30 feet fails a save against Charmed or Frightened, it can reroll with advantage.'
                                 : 'Until the end of your next turn, you and allies within 30 feet have advantage on saves against being Charmed or Frightened.' }));
  both(['class:bard:Magical Secrets'], ctx => note(ctx, 'Magical Secrets: bard spells you learn can come from the cleric, druid and wizard lists' + (ctx.edition === '2014' ? ' (or any class, as chosen)' : '') + '.'));
  both(['class:bard:Superior Inspiration'], ctx => note(ctx, 'Superior Inspiration: when you roll initiative with fewer than two Bardic Inspiration uses, regain up to two.'));
  def('2024:class:bard:Words of Creation', ctx => note(ctx, 'Words of Creation: Power Word Heal and Power Word Kill are always prepared, and can target a second creature.'));

  // ── Cleric ─────────────────────────────────────────────────────────────
  def('2014:class:cleric:Destroy Undead', ctx => {
    const cr = ctx.level >= 17 ? '4' : ctx.level >= 14 ? '3' : ctx.level >= 11 ? '2' : ctx.level >= 8 ? '1' : '1/2';
    note(ctx, 'Destroy Undead: undead of CR ' + cr + ' or lower that fail against Turn Undead are destroyed.');
  });
  both(['class:cleric:Divine Intervention'], ctx => {
    pool(ctx, 'Divine Intervention', 1, 'long');
    act(ctx, { name: 'Divine Intervention', action: 'Action', resource: 'Divine Intervention', amount: 1, feature: 'Divine Intervention',
      desc: ctx.edition === '2024' ? 'Cast any cleric spell of 5th level or lower without a slot or components.'
                                   : 'Call on your deity: succeeds if a d100 roll is ' + ctx.level + ' or lower (automatic at level 20).' });
  });
  def('2024:class:cleric:Greater Divine Intervention', ctx => note(ctx, 'Greater Divine Intervention: Divine Intervention can cast Wish; afterwards it is unavailable for 2d4 long rests.'));
  def('2024:class:cleric:Sear Undead', ctx => note(ctx, 'Sear Undead: undead that fail against Turn Undead take ' + Math.max(1, ctx.mod.wis) + 'd8 radiant damage.'));
  choice('2024:class:cleric:Divine Order', {
    label: 'Divine Order',
    options: [
      { value: 'Protector', label: 'Protector', desc: 'Proficiency with Martial weapons and Heavy armor.' },
      { value: 'Thaumaturge', label: 'Thaumaturge', desc: 'One extra cleric cantrip, and add your Wisdom modifier to Intelligence (Arcana or Religion) checks.', cantrips: 1 },
    ],
    apply(ctx, v){
      if (v === 'Protector'){ ctx.weaponProf.add('martial'); ctx.armorProf.add('heavy'); }
      if (v === 'Thaumaturge'){ const b = abm(ctx, 'wis'); ctx.skillBonus.arcana = (ctx.skillBonus.arcana || 0) + b; ctx.skillBonus.religion = (ctx.skillBonus.religion || 0) + b; }
    },
  });
  choice('2024:class:cleric:Blessed Strikes', {
    label: 'Blessed Strikes',
    options: [
      { value: 'Divine Strike', label: 'Divine Strike', desc: 'Once per turn, a weapon hit deals an extra 1d8 radiant or necrotic damage (2d8 from level 14).' },
      { value: 'Potent Spellcasting', label: 'Potent Spellcasting', desc: 'Add your Wisdom modifier to the damage of your cleric cantrips.' },
    ],
    apply(ctx, v){
      if (v === 'Potent Spellcasting') ctx.cantripDamageBonus += ctx.mod.wis;
      else ctx.extraDamage.push({ label: 'Divine Strike', dice: (ctx.level >= 14 ? '2d8' : '1d8') + ' radiant', note: 'once per turn, a weapon hit (radiant or necrotic)' });
    },
  });
  def('2024:class:cleric:Improved Blessed Strikes', () => {});    // folded into Blessed Strikes

  // ── Druid ──────────────────────────────────────────────────────────────
  both(['class:druid:Druidic'], ctx => { ctx.languages.add('Druidic'); });
  both(['class:druid:Timeless Body'], ctx => note(ctx, 'Timeless Body: you age one year for every ten that pass.'));
  both(['class:druid:Beast Spells'], ctx => note(ctx, 'Beast Spells: cast spells in Wild Shape (not ones with costly or consumed material components).'));
  def('2014:class:druid:Archdruid', ctx => note(ctx, 'Archdruid: Wild Shape is unlimited, and you ignore verbal, somatic and non-costly material components.'));
  def('2024:class:druid:Archdruid', ctx => note(ctx, 'Archdruid: regain a Wild Shape use on initiative if you have none; turn unused Wild Shape into a spell slot; you age slowly.'));
  choice('2024:class:druid:Primal Order', {
    label: 'Primal Order',
    options: [
      { value: 'Magician', label: 'Magician', desc: 'One extra druid cantrip, and add your Wisdom modifier to Intelligence (Arcana or Nature) checks.', cantrips: 1 },
      { value: 'Warden', label: 'Warden', desc: 'Proficiency with Martial weapons and Medium armor.' },
    ],
    apply(ctx, v){
      if (v === 'Warden'){ ctx.weaponProf.add('martial'); ctx.armorProf.add('medium'); }
      if (v === 'Magician'){ const b = abm(ctx, 'wis'); ctx.skillBonus.arcana = (ctx.skillBonus.arcana || 0) + b; ctx.skillBonus.nature = (ctx.skillBonus.nature || 0) + b; }
    },
  });
  def('2024:class:druid:Wild Companion', ctx => act(ctx, { name: 'Wild Companion', action: 'Magic', resource: 'Wild Shape', amount: 1, feature: 'Wild Companion',
    desc: 'Spend a Wild Shape use (or a spell slot) to cast Find Familiar without components; the familiar is a Fey.' }));
  def('2024:class:druid:Wild Resurgence', ctx => note(ctx, 'Wild Resurgence: with no Wild Shape uses left, spend a spell slot for one; once per long rest, a Wild Shape use can become a 1st-level slot.'));
  choice('2024:class:druid:Elemental Fury', {
    label: 'Elemental Fury',
    options: [
      { value: 'Potent Spellcasting', label: 'Potent Spellcasting', desc: 'Add your Wisdom modifier to the damage of your druid cantrips.' },
      { value: 'Primal Strike', label: 'Primal Strike', desc: 'Once per turn, a weapon or beast-form hit deals an extra 1d8 cold, fire, lightning or thunder damage (2d8 from level 15).' },
    ],
    apply(ctx, v){
      if (v === 'Potent Spellcasting') ctx.cantripDamageBonus += ctx.mod.wis;
      else ctx.extraDamage.push({ label: 'Primal Strike', dice: (ctx.level >= 15 ? '2d8' : '1d8') + ' fire', note: 'once per turn, a weapon or beast-form hit (cold, fire, lightning or thunder)' });
    },
  });
  def('2024:class:druid:Improved Elemental Fury', () => {});      // folded into Elemental Fury

  // ── Fighter ────────────────────────────────────────────────────────────
  def('2024:class:fighter:Tactical Mind', ctx => act(ctx, { name: 'Tactical Mind', action: 'Free', resource: 'Second Wind', amount: 1, feature: 'Tactical Mind',
    desc: 'When you fail an ability check, spend a Second Wind use to add 1d10; if it still fails, the use isn’t spent.' }));
  def('2024:class:fighter:Tactical Shift', ctx => note(ctx, 'Tactical Shift: when you use Second Wind, move up to half your speed without provoking opportunity attacks.'));
  def('2024:class:fighter:Tactical Master', ctx => note(ctx, 'Tactical Master: when you attack with a weapon whose mastery you use, you can swap it for Push, Sap or Slow.'));
  def('2024:class:fighter:Studied Attacks', ctx => note(ctx, 'Studied Attacks: after you miss a creature, your next attack against it before the end of your next turn has advantage.'));
  both(['class:fighter:Indomitable'], ctx => {
    pool(ctx, 'Indomitable', ctx.level >= 17 ? 3 : ctx.level >= 13 ? 2 : 1, 'long');
    act(ctx, { name: 'Indomitable', action: 'Free', resource: 'Indomitable', amount: 1, feature: 'Indomitable',
      desc: ctx.edition === '2024' ? 'Reroll a failed saving throw with a bonus of +' + ctx.level + '; you must use the new roll.'
                                   : 'Reroll a failed saving throw; you must use the new roll.' });
  });

  // ── Monk ───────────────────────────────────────────────────────────────
  def('2014:class:monk:Deflect Missiles', ctx => act(ctx, { name: 'Deflect Missiles', action: 'Reaction', feature: 'Deflect Missiles',
    desc: 'Reduce a ranged weapon attack’s damage by 1d10 + ' + (ctx.mod.dex + ctx.level) + '; at 0, catch it and throw it back for 1 Focus Point.' }));
  def('2024:class:monk:Deflect Attacks', ctx => act(ctx, { name: 'Deflect Attacks', action: 'Reaction', feature: 'Deflect Attacks',
    desc: 'Reduce bludgeoning, piercing or slashing damage from an attack by 1d10 + ' + (ctx.mod.dex + ctx.level) + '; at 0, spend 1 Focus Point to redirect it.' }));
  def('2024:class:monk:Deflect Energy', ctx => note(ctx, 'Deflect Energy: Deflect Attacks works against any damage type.'));
  both(['class:monk:Slow Fall'], ctx => act(ctx, { name: 'Slow Fall', action: 'Reaction', feature: 'Slow Fall',
    desc: 'Reduce falling damage by ' + (5 * ctx.level) + '.' }));
  both(['class:monk:Stunning Strike'], ctx => act(ctx, { name: 'Stunning Strike', action: 'Free', resource: 'Focus Points', amount: 1, feature: 'Stunning Strike',
    desc: 'After you hit with a monk weapon or unarmed strike, the target makes a Constitution save (DC ' + (8 + ctx.pb + ctx.mod.wis) + ') or is Stunned until the start of your next turn.' }));
  def('2014:class:monk:Ki-Empowered Strikes', ctx => note(ctx, 'Ki-Empowered Strikes: your unarmed strikes count as magical.'));
  def('2024:class:monk:Empowered Strikes', ctx => note(ctx, 'Empowered Strikes: your unarmed strikes can deal force damage instead of bludgeoning.'));
  def('2014:class:monk:Stillness of Mind', ctx => act(ctx, { name: 'Stillness of Mind', action: 'Action', feature: 'Stillness of Mind', desc: 'End one effect on yourself that is causing you to be Charmed or Frightened.' }));
  def('2014:class:monk:Purity of Body', ctx => { ctx.immune.add('poison'); note(ctx, 'Purity of Body: immune to disease and poison.'); });
  def('2014:class:monk:Tongue of the Sun and Moon', ctx => note(ctx, 'Tongue of the Sun and Moon: you understand all spoken languages, and any creature that knows a language understands you.'));
  def('2014:class:monk:Timeless Body', ctx => note(ctx, 'Timeless Body: you don’t need food or water, can’t be aged magically, and suffer no frailty of age.'));
  def('2014:class:monk:Empty Body', ctx => act(ctx, { name: 'Empty Body', action: 'Action', resource: 'Focus Points', amount: 4, feature: 'Empty Body',
    desc: 'Become invisible for 1 minute with resistance to all damage but force.' }));
  def('2014:class:monk:Perfect Self', ctx => note(ctx, 'Perfect Self: when you roll initiative with no Focus Points, regain 4.'));
  def('2024:class:monk:Uncanny Metabolism', ctx => {
    pool(ctx, 'Uncanny Metabolism', 1, 'long');
    act(ctx, { name: 'Uncanny Metabolism', action: 'Free', resource: 'Uncanny Metabolism', amount: 1, feature: 'Uncanny Metabolism',
      desc: 'When you roll initiative, regain all Focus Points and ' + (ctx.martialArtsDie || '1d6') + ' + ' + ctx.level + ' hit points.' });
  });
  def('2024:class:monk:Acrobatic Movement', ctx => note(ctx, 'Acrobatic Movement: without armor or a shield, move along vertical surfaces and across liquids on your turn.'));
  def('2024:class:monk:Heightened Focus', ctx => note(ctx, 'Heightened Focus: Flurry of Blows makes three strikes, Patient Defense grants temporary hit points, Step of the Wind can carry an ally.'));
  def('2024:class:monk:Self-Restoration', ctx => note(ctx, 'Self-Restoration: end Charmed, Frightened or Poisoned on yourself at the end of each turn; going without food or drink doesn’t exhaust you.'));
  def('2024:class:monk:Disciplined Survivor', ctx => { ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(k => ctx.saveProf.add(k)); note(ctx, 'Disciplined Survivor: reroll a failed saving throw by spending 1 Focus Point.'); });
  def('2024:class:monk:Perfect Focus', ctx => note(ctx, 'Perfect Focus: when you roll initiative with 3 or fewer Focus Points, regain up to 4.'));
  def('2024:class:monk:Superior Defense', ctx => act(ctx, { name: 'Superior Defense', action: 'Free', resource: 'Focus Points', amount: 3, feature: 'Superior Defense',
    desc: 'At the start of your turn: resistance to every damage type but force for 1 minute.' }));
  def('2024:class:monk:Body and Mind', ctx => { ctx.abilityBonus.dex += 4; ctx.abilityBonus.wis += 4; ctx.abilityCapBonus.dex = 25; ctx.abilityCapBonus.wis = 25; });
  // The three things Focus Points buy (2024: Monk's Focus; 2014: Ki).
  def(['2024:class:monk:Monk’s Focus', '2024:class:monk:Monk\'s Focus', '2014:class:monk:Ki'], ctx => {
    const n = col(ctx, ctx.edition === '2024' ? 'Focus Points' : 'Ki Points') || ctx.level;
    pool(ctx, 'Focus Points', n, 'short');
    act(ctx, { name: 'Flurry of Blows', action: 'Bonus Action', resource: 'Focus Points', amount: 1, feature: 'Focus', desc: 'Make two unarmed strikes.' });
    act(ctx, { name: 'Patient Defense', action: 'Bonus Action', resource: 'Focus Points', amount: ctx.edition === '2024' ? 1 : 1, feature: 'Focus', desc: ctx.edition === '2024' ? 'Disengage and Dodge.' : 'Take the Dodge action.' });
    act(ctx, { name: 'Step of the Wind', action: 'Bonus Action', resource: 'Focus Points', amount: 1, feature: 'Focus', desc: ctx.edition === '2024' ? 'Disengage and Dash; your jump distance doubles.' : 'Disengage or Dash; your jump distance doubles.' });
  });

  // ── Paladin ────────────────────────────────────────────────────────────
  def('2014:class:paladin:Divine Sense', ctx => {
    pool(ctx, 'Divine Sense', 1 + Math.max(0, ctx.mod.cha), 'long');
    act(ctx, { name: 'Divine Sense', action: 'Action', resource: 'Divine Sense', amount: 1, feature: 'Divine Sense', desc: 'Sense celestials, fiends and undead within 60 feet until the end of your next turn.' });
  });
  def('2014:class:paladin:Divine Smite', ctx => act(ctx, { name: 'Divine Smite', action: 'Free', feature: 'Divine Smite',
    desc: 'On a melee weapon hit, spend a spell slot: +2d8 radiant, +1d8 per slot level above 1st (max 5d8), +1d8 against undead or fiends.' }));
  def('2024:class:paladin:Paladin’s Smite', ctx => smite(ctx));
  def('2024:class:paladin:Paladin\'s Smite', ctx => smite(ctx));
  function smite(ctx){
    pool(ctx, 'Paladin’s Smite', 1, 'long');
    act(ctx, { name: 'Divine Smite', action: 'Bonus Action', resource: 'Paladin’s Smite', amount: 1, feature: 'Paladin’s Smite',
      desc: 'Cast Divine Smite once per long rest without a slot (or with a slot any time): +2d8 radiant, +1d8 per slot level above 1st.' });
  }
  def('2014:class:paladin:Divine Health', ctx => note(ctx, 'Divine Health: immune to disease.'));
  both(['class:paladin:Aura of Courage'], ctx => note(ctx, 'Aura of Courage: you and allies within ' + (ctx.level >= 18 ? 30 : 10) + ' feet can’t be Frightened while you are conscious.'));
  def('2014:class:paladin:Improved Divine Smite', ctx => note(ctx, 'Improved Divine Smite: every melee weapon hit deals an extra 1d8 radiant damage.'));
  def('2024:class:paladin:Radiant Strikes', ctx => note(ctx, 'Radiant Strikes: every melee weapon or unarmed strike hit deals an extra 1d8 radiant damage.'));
  def('2014:class:paladin:Cleansing Touch', ctx => {
    pool(ctx, 'Cleansing Touch', abm(ctx, 'cha'), 'long');
    act(ctx, { name: 'Cleansing Touch', action: 'Action', resource: 'Cleansing Touch', amount: 1, feature: 'Cleansing Touch', desc: 'End one spell on yourself or a willing creature you touch.' });
  });
  def('2024:class:paladin:Faithful Steed', ctx => {
    pool(ctx, 'Faithful Steed', 1, 'long');
    act(ctx, { name: 'Find Steed', action: 'Magic', resource: 'Faithful Steed', amount: 1, feature: 'Faithful Steed', desc: 'Cast Find Steed without a slot once per long rest; it is always prepared.' });
  });
  def('2024:class:paladin:Abjure Foes', ctx => act(ctx, { name: 'Abjure Foes', action: 'Magic', resource: 'Channel Divinity', amount: 1, feature: 'Abjure Foes',
    desc: 'Up to ' + abm(ctx, 'cha') + ' creatures within 60 feet make a Wisdom save (DC ' + (8 + ctx.pb + ctx.mod.cha) + ') or are Frightened for 1 minute.' }));
  def('2024:class:paladin:Restoring Touch', ctx => note(ctx, 'Restoring Touch: Lay on Hands can also end Blinded, Charmed, Deafened, Frightened, Paralyzed or Stunned (5 points each).'));
  def('2024:class:paladin:Aura Expansion', () => {});              // Aura of Protection reads the level

  // ── Ranger ─────────────────────────────────────────────────────────────
  const picks = (ctx, f) => ((((ctx.build._full || ctx.build).profPicks || {})[f] || {})[f === 'Favored Enemy' ? 'enemies' : 'terrains'] || []);
  def('2014:class:ranger:Favored Enemy', ctx => { const p = picks(ctx, 'Favored Enemy');
    note(ctx, 'Favored Enemy' + (p.length ? ' (' + p.join(', ') + ')' : '') + ': advantage on Survival checks to track, and Intelligence checks to recall information, about your favored enemies.'); });
  def('2014:class:ranger:Natural Explorer', ctx => { const p = picks(ctx, 'Natural Explorer');
    note(ctx, 'Natural Explorer' + (p.length ? ' (' + p.join(', ') + ')' : '') + ': in your favored terrain, double proficiency on Intelligence and Wisdom checks, and the party can’t be slowed or lost.'); });
  def('2014:class:ranger:Primeval Awareness', ctx => act(ctx, { name: 'Primeval Awareness', action: 'Action', feature: 'Primeval Awareness', desc: 'Spend a spell slot to sense aberrations, celestials, dragons, elementals, fey, fiends and undead within 1 mile (6 in favored terrain).' }));
  both(['class:ranger:Land\'s Stride', 'class:ranger:Land’s Stride'], ctx => note(ctx, 'Land’s Stride: nonmagical difficult terrain costs no extra movement, and plants don’t harm or slow you.'));
  def('2014:class:ranger:Hide in Plain Sight', ctx => note(ctx, 'Hide in Plain Sight: spend a minute camouflaging to gain +10 to Stealth while you stay still.'));
  def('2014:class:ranger:Vanish', ctx => act(ctx, { name: 'Vanish', action: 'Bonus Action', feature: 'Vanish', desc: 'Take the Hide action; you can’t be tracked by nonmagical means.' }));
  both(['class:ranger:Feral Senses'], ctx => {
    if (ctx.edition === '2024') ctx.senses.blindsight = Math.max(ctx.senses.blindsight || 0, 30);
    else note(ctx, 'Feral Senses: no disadvantage attacking creatures you can’t see; you know where invisible creatures within 30 feet are.');
  });
  both(['class:ranger:Foe Slayer'], ctx => note(ctx, ctx.edition === '2024' ? 'Foe Slayer: Hunter’s Mark’s damage die becomes a d10.' : 'Foe Slayer: once per turn, add ' + signed(ctx.mod.wis) + ' to an attack or damage roll against a favored enemy.'));
  def('2024:class:ranger:Deft Explorer', ctx => note(ctx, 'Deft Explorer: expertise in one skill and two extra languages (chosen in the builder).'));
  def('2024:class:ranger:Roving', ctx => { ctx.speedBonusUnlessHeavy += 10; note(ctx, 'Roving: climb and swim speeds equal to your speed while not in heavy armor.'); });
  def('2024:class:ranger:Tireless', ctx => {
    pool(ctx, 'Tireless', abm(ctx, 'wis'), 'long');
    act(ctx, { name: 'Tireless', action: 'Magic', resource: 'Tireless', amount: 1, feature: 'Tireless', desc: 'Gain 1d8 + ' + ctx.mod.wis + ' temporary hit points. A short rest also lowers Exhaustion by 1.' });
  });
  def('2024:class:ranger:Relentless Hunter', ctx => note(ctx, 'Relentless Hunter: taking damage can’t break your concentration on Hunter’s Mark.'));
  def('2024:class:ranger:Nature’s Veil', ctx => veil(ctx));
  def('2024:class:ranger:Nature\'s Veil', ctx => veil(ctx));
  function veil(ctx){
    pool(ctx, 'Nature’s Veil', abm(ctx, 'wis'), 'long');
    act(ctx, { name: 'Nature’s Veil', action: 'Bonus Action', resource: 'Nature’s Veil', amount: 1, feature: 'Nature’s Veil', desc: 'Become Invisible until the end of your next turn.' });
  }
  def('2024:class:ranger:Precise Hunter', ctx => note(ctx, 'Precise Hunter: advantage on attacks against the target of your Hunter’s Mark.'));

  // ── Rogue ──────────────────────────────────────────────────────────────
  both(['class:rogue:Thieves\' Cant', 'class:rogue:Thieves’ Cant'], ctx => { ctx.languages.add('Thieves’ Cant'); });
  both(['class:rogue:Cunning Action'], ctx => act(ctx, { name: 'Cunning Action', action: 'Bonus Action', feature: 'Cunning Action', desc: 'Dash, Disengage or Hide.' }));
  both(['class:rogue:Uncanny Dodge'], ctx => act(ctx, { name: 'Uncanny Dodge', action: 'Reaction', feature: 'Uncanny Dodge', desc: 'Halve the damage of an attack that hits you from an attacker you can see.' }));
  def('2014:class:rogue:Blindsense', ctx => note(ctx, 'Blindsense: you know where any hidden or invisible creature within 10 feet is, if you can hear.'));
  both(['class:rogue:Elusive'], ctx => note(ctx, 'Elusive: no attack roll has advantage against you while you aren’t Incapacitated.'));
  both(['class:rogue:Stroke of Luck'], ctx => {
    pool(ctx, 'Stroke of Luck', 1, 'short');
    act(ctx, { name: 'Stroke of Luck', action: 'Free', resource: 'Stroke of Luck', amount: 1, feature: 'Stroke of Luck',
      desc: ctx.edition === '2024' ? 'Turn a failed D20 Test into a 20.' : 'Turn a missed attack into a hit, or treat a failed ability check’s d20 as a 20.' });
  });
  def('2024:class:rogue:Steady Aim', ctx => act(ctx, { name: 'Steady Aim', action: 'Bonus Action', feature: 'Steady Aim', desc: 'Advantage on your next attack this turn, if you haven’t moved; your speed is 0 until the end of the turn.' }));
  def('2024:class:rogue:Cunning Strike', ctx => note(ctx, 'Cunning Strike: give up Sneak Attack dice for an effect — Poison (1d6), Trip (1d6), Withdraw (1d6)' + (ctx.level >= 14 ? ', or Daze, Knock Out, Obscure (14th level)' : '') + '.'));
  def('2024:class:rogue:Improved Cunning Strike', ctx => note(ctx, 'Improved Cunning Strike: use up to two Cunning Strike effects on one Sneak Attack.'));
  def('2024:class:rogue:Devious Strikes', () => {});                 // folded into Cunning Strike's text

  // ── Sorcerer ───────────────────────────────────────────────────────────
  def('2014:class:sorcerer:Sorcerous Restoration', ctx => note(ctx, 'Sorcerous Restoration: regain 4 Sorcery Points when you finish a short rest.'));
  def('2024:class:sorcerer:Sorcerous Restoration', ctx => {
    pool(ctx, 'Sorcerous Restoration', 1, 'long');
    act(ctx, { name: 'Sorcerous Restoration', action: 'Free', resource: 'Sorcerous Restoration', amount: 1, feature: 'Sorcerous Restoration', desc: 'After a short rest, regain up to ' + Math.floor(ctx.level / 2) + ' Sorcery Points.' });
  });
  def('2024:class:sorcerer:Sorcery Incarnate', ctx => note(ctx, 'Sorcery Incarnate: with no Innate Sorcery uses left, spend 2 Sorcery Points to activate it; while it’s active, use two Metamagic options on one spell.'));
  def('2024:class:sorcerer:Arcane Apotheosis', ctx => note(ctx, 'Arcane Apotheosis: while Innate Sorcery is active, one Metamagic option per turn costs no Sorcery Points.'));

  // ── Warlock ────────────────────────────────────────────────────────────
  def('2014:class:warlock:Pact Boon', () => {});                    // an optional-feature choice
  both(['class:warlock:Mystic Arcanum'], ctx => {
    [[11, 6], [13, 7], [15, 8], [17, 9]].forEach(([at, lv]) => {
      if (ctx.level >= at) pool(ctx, 'Mystic Arcanum (' + lv + 'th)', 1, 'long');
    });
  });
  def('2014:class:warlock:Eldritch Master', ctx => {
    pool(ctx, 'Eldritch Master', 1, 'long');
    act(ctx, { name: 'Eldritch Master', action: 'Action', resource: 'Eldritch Master', amount: 1, feature: 'Eldritch Master', desc: 'Spend 1 minute to regain all your expended Pact Magic slots.' });
  });
  def('2024:class:warlock:Magical Cunning', ctx => {
    pool(ctx, 'Magical Cunning', 1, 'long');
    act(ctx, { name: 'Magical Cunning', action: 'Free', resource: 'Magical Cunning', amount: 1, feature: 'Magical Cunning',
      desc: 'Spend 1 minute to regain ' + (ctx.level >= 20 ? 'all' : 'up to half (rounded up) of') + ' your expended Pact Magic slots.' });
  });
  def('2024:class:warlock:Eldritch Master', () => {});              // folded into Magical Cunning
  def('2024:class:warlock:Contact Patron', ctx => {
    pool(ctx, 'Contact Patron', 1, 'long');
    act(ctx, { name: 'Contact Other Plane', action: 'Magic', resource: 'Contact Patron', amount: 1, feature: 'Contact Patron', desc: 'Cast Contact Other Plane without a slot to reach your patron; you automatically succeed on the save.' });
  });

  // ── Wizard ─────────────────────────────────────────────────────────────
  both(['class:wizard:Spell Mastery'], ctx => { const p = (((ctx.build._full || ctx.build).featureSpells || {})['Spell Mastery'] || []);
    note(ctx, 'Spell Mastery' + (p.length ? ' (' + p.join(', ') + ')' : '') + ': cast your chosen 1st- and 2nd-level spells at their lowest level without a slot.'); });
  both(['class:wizard:Signature Spells'], ctx => pool(ctx, 'Signature Spells', 2, 'short', { note: 'Each of your two 3rd-level signature spells once per rest without a slot.' }));
  def('2024:class:wizard:Ritual Adept', ctx => note(ctx, 'Ritual Adept: cast any ritual spell in your spellbook as a ritual without preparing it.'));
  def('2024:class:wizard:Scholar', () => {});                       // an expertise pick in the builder
  def('2024:class:wizard:Memorize Spell', ctx => note(ctx, 'Memorize Spell: after a short rest, swap one prepared spell for another from your spellbook.'));

  // ── Subclass features: reminders with the character's numbers ──────────
  // The 2024 books' version of a feature, when the older one reads differently.
  const new24 = ctx => ['XPHB', 'EFA', 'FRHoF'].includes((ctx.sub || {}).source);
  const psiDie = ctx => (ctx.resources.find(r => r.name === 'Psionic Energy') || {}).die || (ctx.level >= 17 ? 'd12' : ctx.level >= 11 ? 'd10' : ctx.level >= 5 ? 'd8' : 'd6');
  // Barbarian (Mindless Rage and the 2024 Frenzy also act through the Rage toggle).
  def('subclass:barbarian:Frenzy', ctx => note(ctx, new24(ctx)
    ? 'Frenzy: with Reckless Attack while raging, the first target you hit each turn with a Strength attack takes an extra ' + ctx.rageDamage + 'd6.'
    : 'Frenzy: when you rage you can frenzy — a melee weapon attack as a bonus action each turn, and a level of exhaustion when the rage ends.'));
  def('subclass:barbarian:Mindless Rage', ctx => note(ctx, 'Mindless Rage: immune to being charmed or frightened while raging.'));
  def('subclass:barbarian:Reckless Abandon', ctx => note(ctx, 'Reckless Abandon: Reckless Attack while raging gives ' + abm(ctx, 'con') + ' temporary hit points.'));
  def('subclass:barbarian:Ancestral Protectors', ctx => note(ctx, 'Ancestral Protectors: while raging, the first creature you hit each turn has disadvantage on attacks against anyone but you, and its hits on others are resisted.'));
  def('subclass:barbarian:Fanatical Focus', ctx => note(ctx, new24(ctx)
    ? 'Fanatical Focus: once per rage, reroll a failed save with +' + ctx.rageDamage + '.'
    : 'Fanatical Focus: once per rage, reroll a failed save.'));
  def('subclass:barbarian:Rage beyond Death', ctx => note(ctx, 'Rage beyond Death: while raging, 0 hit points doesn’t knock you out, and failed death saves can’t kill you until the rage ends.'));
  def('subclass:barbarian:Giant\'s Havoc', ctx => note(ctx, 'Giant’s Havoc: while raging, +5 ft reach, Large if smaller, and +' + ctx.rageDamage + ' (Rage Damage) on Strength thrown-weapon hits.'));
  def('subclass:barbarian:Demiurgic Colossus', ctx => note(ctx, 'Demiurgic Colossus: when you rage, +10 ft reach and Large or Huge; Elemental Cleaver deals 2d6.'));
  def('subclass:barbarian:Power of the Wilds', ctx => note(ctx, 'Power of the Wilds: when you rage, pick Falcon (fly speed without armour), Lion (enemies near you have disadvantage against others) or Ram (knock Large or smaller prone).'));
  def('subclass:barbarian:Vitality of the Tree', ctx => note(ctx, 'Vitality of the Tree: entering your rage gives ' + ctx.classLevel('barbarian') + ' temporary hit points; each turn while raging, an ally within 10 ft gains ' + ctx.rageDamage + 'd6.'));
  def('subclass:barbarian:Bestial Soul', ctx => note(ctx, 'Bestial Soul: Form of the Beast weapons are magical; after each rest, pick a swim speed (and water breathing), a climb speed, or a jump.'));
  // Bard
  def('subclass:bard:Combat Inspiration', ctx => note(ctx, 'Combat Inspiration: a creature with your Bardic Inspiration can add the die to a weapon' + (new24(ctx) ? ' hit’s' : '') + ' damage, or use its reaction to add it to AC against an attack.'));
  def('subclass:bard:Blade Flourish', ctx => note(ctx, 'Blade Flourish: taking the Attack action gives +10 ft speed this turn; one flourish per turn on a hit.'));
  def('subclass:bard:Master\'s Flourish', ctx => note(ctx, 'Master’s Flourish: a Blade Flourish can roll a d6 instead of spending Bardic Inspiration.'));
  def('subclass:bard:Mote of Potential', ctx => note(ctx, 'Mote of Potential: a Bardic Inspiration die you give adds an effect — a check rolls it twice, an attack bursts for thunder, a save gives temporary hit points.'));
  def('subclass:bard:Unfailing Inspiration', ctx => note(ctx, 'Unfailing Inspiration: a creature that adds your Bardic Inspiration die and still fails keeps the die.'));
  def('subclass:bard:Spiritual Focus', ctx => note(ctx, 'Spiritual Focus: a candle, crystal ball, skull, spirit board or tarokka deck is your bard focus' + (ctx.level >= 6 ? '; damage or healing spells cast through it add 1d6 to one roll.' : '.')));
  // Cleric
  def('subclass:cleric:Inescapable Destruction', ctx => note(ctx, 'Inescapable Destruction: necrotic damage from your cleric spells and Channel Divinity ignores resistance.'));
  def('subclass:cleric:Supreme Healing', ctx => note(ctx, 'Supreme Healing: healing dice from your spells' + (new24(ctx) ? ' and Channel Divinity' : '') + ' always roll their highest number.'));
  // Druid
  def('subclass:druid:Circle Forms', ctx => {
    const L = ctx.level, cr = Math.floor(L / 3);
    note(ctx, new24(ctx)
      ? 'Circle Forms: Wild Shape into a beast of CR ' + cr + ' or lower; in the form your AC is at least ' + (13 + ctx.mod.wis) + ' and you gain ' + 3 * L + ' temporary hit points.'
      : 'Circle Forms: Wild Shape as a bonus action, into a beast of CR ' + Math.max(1, cr) + ' or lower.');
  });
  def('subclass:druid:Improved Circle Forms', ctx => note(ctx, 'Improved Circle Forms: in Wild Shape, attacks can deal radiant damage, and Constitution saves add ' + signed(ctx.mod.wis) + ' (WIS).'));
  def('subclass:druid:Hearth of Moonlight and Shadow', ctx => note(ctx, 'Hearth of Moonlight and Shadow: during a rest, a 30 ft sphere gives +5 to Stealth and Perception and hides its firelight.'));
  def('2024:subclass:cleric:Divine Strike', () => {});   // the class's Blessed Strikes decides
  def('2014:subclass:cleric:Blessed Strikes', ctx => ctx.extraDamage.push({ label: 'Blessed Strikes', dice: '1d8 radiant',
    note: 'once per turn, when your cantrip or weapon attack damages a creature (Tasha’s option in place of Divine Strike or Potent Spellcasting)' }));
  def('subclass:cleric:Order\'s Wrath', ctx => note(ctx, 'Order’s Wrath: a creature you hit with Divine Strike is cursed; the next ally to hit it adds 2d8 psychic.'));
  def('subclass:cleric:Improved Warding Flare', ctx => {
    const r = ctx.resources.find(x => x.name === 'Warding Flare'); if (r) r.recharge = 'short';
    note(ctx, 'Improved Warding Flare: uses come back on a short rest; the creature you protect gains 2d6' + signed(ctx.mod.wis) + ' temporary hit points.');
  });
  def('subclass:cleric:Protective Bond', ctx => note(ctx, 'Protective Bond: when a creature under your Emboldening Bond is about to take damage, another bonded creature within 30 ft can use its reaction to teleport beside it and take the damage.'));
  // Druid (Starry Form)
  def('subclass:druid:Chalice', ctx => note(ctx, 'Chalice: in Starry Form, a spell slot healing spell also heals you or a creature within 30 ft for ' + (ctx.level >= 10 ? '2d8' : '1d8') + signed(ctx.mod.wis) + '.'));
  def('subclass:druid:Twinkling Constellations', ctx => note(ctx, 'Twinkling Constellations: Archer and Chalice roll 2d8, the Dragon gives a 20 ft fly speed (hover), and you can change constellation each turn.'));
  def('subclass:cleric:Stormborn', ctx => note(ctx, 'Stormborn: a fly speed equal to your walking speed when not underground or indoors.'));
  def('subclass:druid:Stormborn', ctx => note(ctx, 'Stormborn: while Wrath of the Sea is active, a fly speed equal to your speed and resistance to cold, lightning and thunder.'));
  // Fighter
  def('subclass:fighter:Additional Superiority Die', () => {});   // Combat Superiority counts it
  def('subclass:fighter:Improved Combat Superiority', () => {});  // and grows the die
  def('subclass:fighter:Relentless', ctx => note(ctx, new24(ctx)
    ? 'Relentless: once per turn, a maneuver can use a d8 instead of a Superiority Die.'
    : 'Relentless: rolling initiative with no superiority dice left gives one back.'));
  def('subclass:fighter:Eldritch Strike', ctx => note(ctx, 'Eldritch Strike: a creature you hit with a weapon has disadvantage on its next save against your spells before the end of your next turn.'));
  def('subclass:fighter:Psionic Strike', ctx => {
    const dice = '1' + psiDie(ctx) + signed(ctx.mod.int);
    ctx.extraDamage.push({ label: 'Psionic Strike', dice: dice + ' force', note: 'once per turn after a weapon hit within 30 ft, spend a Psionic Energy die' });
    act(ctx, { name: 'Psionic Strike', action: 'Free', resource: 'Psionic Energy', amount: 1, dice, feature: 'Psionic Strike',
      desc: 'Once per turn, after hitting a target within 30 ft with a weapon, spend a Psionic Energy die for force damage.' });
  });
  def('subclass:fighter:Know Your Enemy', ctx => {
    if (!new24(ctx)) return note(ctx, 'Know Your Enemy: after a minute observing a creature, learn how it compares to you in two traits (a score, AC, hit points or levels).');
    pool(ctx, 'Know Your Enemy', 1, 'long');
    act(ctx, { name: 'Know Your Enemy', action: 'Bonus Action', resource: 'Know Your Enemy', amount: 1, feature: 'Know Your Enemy',
      desc: 'Learn a creature’s immunities, resistances and vulnerabilities within 30 ft. A Superiority Die restores the use.' });
  });
  def('subclass:fighter:Great Stature', ctx => note(ctx, 'Great Stature: Giant’s Might adds 1d8 damage.'));
  def('subclass:fighter:Runic Juggernaut', ctx => note(ctx, 'Runic Juggernaut: Giant’s Might adds 1d10 damage, and you can grow to Huge with +5 ft reach.'));
  def('subclass:fighter:Rapid Strike', ctx => note(ctx, 'Rapid Strike: once per turn, give up advantage on an attack to make an extra weapon attack against that target.'));
  def('subclass:fighter:Team Tactics', ctx => note(ctx, 'Team Tactics: allies you restore with Group Recovery have advantage on D20 tests until your next turn.'));
  // Monk
  def('subclass:monk:Agile Parry', ctx => note(ctx, 'Agile Parry: after an unarmed strike in the Attack action, holding a melee kensei weapon gives +2 AC until your next turn.'));
  def('subclass:monk:Flurry of Healing and Harm', ctx => {
    if (new24(ctx)) pool(ctx, 'Flurry of Healing and Harm', abm(ctx, 'wis'), 'long');
    note(ctx, 'Flurry of Healing and Harm: Flurry of Blows can trade strikes for Hand of Healing, and add Hand of Harm to one, without spending ' + (new24(ctx) ? 'Focus Points (' + abm(ctx, 'wis') + ' times per long rest).' : 'ki.'));
  });
  def('subclass:monk:Drunken Technique', ctx => note(ctx, 'Drunken Technique: Flurry of Blows also Disengages and gives +10 ft speed this turn.'));
  def('subclass:monk:Stride of the Elements', ctx => note(ctx, 'Stride of the Elements: while Elemental Attunement is active, fly and swim speeds equal to your speed.'));
  def('subclass:monk:Elemental Epitome', ctx => note(ctx, 'Elemental Epitome: while Elemental Attunement is active, resistance to acid, cold, fire, lightning or thunder (switch each turn), and Step of the Wind adds 20 ft and damages creatures you pass.'));
  def('subclass:warlock:Genie\'s Vessel', ctx => note(ctx, 'Genie’s Vessel: your warlock focus; AC ' + (8 + ctx.pb + ctx.mod.cha) + ', ' + (ctx.level + ctx.pb) + ' hit points, immune to poison and psychic.'));
  // Paladin
  def('subclass:paladin:Control Undead', ctx => act(ctx, { name: 'Control Undead', action: 'Action', resource: 'Channel Divinity', amount: 1, feature: 'Control Undead',
    desc: 'An undead within 30 ft (below CR ' + ctx.level + ') makes a Wisdom save or obeys you for 24 hours.' }));
  def('subclass:paladin:Dreadful Aspect', ctx => act(ctx, { name: 'Dreadful Aspect', action: 'Action', resource: 'Channel Divinity', amount: 1, feature: 'Dreadful Aspect',
    desc: 'Creatures of your choice within 30 ft that see you make a Wisdom save or are frightened for 1 minute.' }));
  def('subclass:paladin:Dread Lord', ctx => {
    pool(ctx, 'Dread Lord', 1, 'long');
    act(ctx, { name: 'Dread Lord', action: 'Action', resource: 'Dread Lord', amount: 1, feature: 'Dread Lord',
      desc: 'For 1 minute, a 30 ft aura of gloom: frightened enemies starting their turn in it take 4d10 psychic, and attacks by sight against you and allies in it have disadvantage.' });
  });
  def('subclass:paladin:Protective Spirit', ctx => note(ctx, 'Protective Spirit: ending your turn in combat below half your hit points, regain 1d6+' + Math.floor(ctx.level / 2) + '.'));
  def('subclass:paladin:Aura of Hate', ctx => note(ctx, 'Aura of Hate: you, and fiends and undead within ' + (ctx.level >= 18 ? 30 : 10) + ' ft, add ' + signed(abm(ctx, 'cha')) + ' to melee weapon damage.'));
  // Ranger
  def('subclass:ranger:Stalker\'s Flurry', ctx => note(ctx, new24(ctx)
    ? 'Stalker’s Flurry: Dreadful Strike deals 2d8, and can add Sudden Strike (another attack nearby) or Mass Fear (frighten around the target).'
    : 'Stalker’s Flurry: once per turn, a weapon miss lets you make another weapon attack.'));
  def('subclass:ranger:Supernatural Defense', ctx => note(ctx, 'Supernatural Defense: add 1d6 to saves your Slayer’s Prey target forces, and to checks to escape its grapple.'));
  def('subclass:ranger:Gathered Swarm', ctx => ctx.extraDamage.push({ label: 'Gathered Swarm', dice: (ctx.level >= 11 ? '1d8' : '1d6') + ' piercing',
    note: 'once per turn after a hit — or push the target 15 ft, or move yourself 5 ft' }));
  def('subclass:ranger:Mighty Swarm', () => {});   // Gathered Swarm grows to 1d8
  def('subclass:ranger:Hunter\'s Rime', ctx => note(ctx, 'Hunter’s Rime: casting Hunter’s Mark gives 1d10+' + ctx.level + ' temporary hit points, and the marked creature can’t Disengage.'));
  // Rogue
  def('subclass:rogue:Supreme Sneak', ctx => note(ctx, new24(ctx)
    ? 'Supreme Sneak: Cunning Strike option Stealth Attack (1d6) — the attack doesn’t end your invisibility from Hide if you end the turn behind cover.'
    : 'Supreme Sneak: advantage on Stealth if you move no more than half your speed that turn.'));
  def('subclass:rogue:Eye for Weakness', ctx => note(ctx, 'Eye for Weakness: Sneak Attack deals 3d6 more against a creature your Insightful Fighting applies to.'));
  def('subclass:rogue:Envenom Weapons', ctx => note(ctx, 'Envenom Weapons: the Poison Cunning Strike also deals 2d6 poison, ignoring resistance, on each failed save.'));
  def('subclass:rogue:Strike Fear', ctx => note(ctx, 'Strike Fear: Cunning Strike option Terrify (1d6) — a Wisdom save or frightened for 1 minute, and you have advantage against it.'));
  def('subclass:rogue:Assassinate', ctx => {
    if (new24(ctx)) ctx.rollAdv.push({ on: ['init'], label: 'Assassinate' });
    note(ctx, new24(ctx)
      ? 'Assassinate: in the first round, advantage against creatures that haven’t acted, and a Sneak Attack hit deals ' + ctx.level + ' extra damage.'
      : 'Assassinate: advantage on attacks against creatures that haven’t acted yet; hits against surprised creatures are critical.');
  });
  def('subclass:rogue:Ambush Master', ctx => {
    ctx.rollAdv.push({ on: ['init'], label: 'Ambush Master' });
    note(ctx, 'Ambush Master: the first creature you hit in the first round is attacked with advantage until your next turn.');
  });
  def('subclass:rogue:Magical Ambush', ctx => note(ctx, 'Magical Ambush: a creature has disadvantage on saves against your spell when you cast it while ' + (new24(ctx) ? 'invisible.' : 'hidden from it.')));
  def('subclass:rogue:Psi-Bolstered Knack', ctx => act(ctx, { name: 'Psi-Bolstered Knack', action: 'Free', resource: 'Psionic Energy', amount: 1, dice: '1' + psiDie(ctx), feature: 'Psi-Bolstered Knack',
    desc: 'After failing a check with a skill or tool you’re proficient in, add a Psionic Energy die; it’s spent only if the check then succeeds.' }));
  def('subclass:rogue:Homing Strikes', ctx => act(ctx, { name: 'Homing Strikes', action: 'Free', resource: 'Psionic Energy', amount: 1, dice: '1' + psiDie(ctx), feature: 'Homing Strikes',
    desc: 'After missing with Psychic Blades, add a Psionic Energy die to the attack; it’s spent only if the attack then hits.' }));
  def('subclass:rogue:Soul Blades', () => {});   // its powers are listed on their own
  // Sorcerer
  def('subclass:sorcerer:Tides of Chaos', ctx => {
    pool(ctx, 'Tides of Chaos', 1, 'long');
    note(ctx, 'Tides of Chaos: advantage on one ' + (new24(ctx) ? 'D20 test' : 'attack, check or save') + '; it comes back after a Wild Magic Surge' + (new24(ctx) ? ' from a sorcerer spell.' : ' the DM calls for.'));
  });
  def('subclass:sorcerer:Bolstering Flames', ctx => note(ctx, 'Bolstering Flames (Spellfire Burst): you or a creature within 30 ft gains 1d4' + signed(ctx.mod.cha) + (ctx.level >= 14 ? '+' + ctx.level : '') + ' temporary hit points.'));
  def('subclass:sorcerer:Radiant Fire', ctx => note(ctx, 'Radiant Fire (Spellfire Burst): a creature within 30 ft takes ' + (ctx.level >= 14 ? '1d8' : '1d4') + ' fire or radiant damage.'));
  def('subclass:sorcerer:Honed Spellfire', () => {});   // Bolstering Flames and Radiant Fire grow
  def('subclass:sorcerer:Psionic Sorcery', ctx => note(ctx, 'Psionic Sorcery: cast your Psionic Spells with sorcery points equal to the spell’s level, needing no verbal, somatic or (unconsumed) material components.'));
  def('subclass:sorcerer:Eyes of the Dark', ctx => {
    ctx.senses.darkvision = Math.max(ctx.senses.darkvision || 0, 120);
    if (ctx.level >= 3) note(ctx, 'Eyes of the Dark: cast Darkness for 2 sorcery points and see through it.');
  });
  // Wizard
  def('subclass:wizard:Temporal Awareness', ctx => { ctx.initBonus += ctx.mod.int; });
  def('subclass:wizard:Improved Abjuration', ctx => note(ctx, 'Improved Abjuration: ability checks your abjuration spells call for (Counterspell, Dispel Magic) add +' + ctx.pb + '.'));
  def('subclass:wizard:Undead Thralls', ctx => note(ctx, 'Undead Thralls: Animate Dead raises one extra; undead you make have +' + ctx.level + ' hit points and add +' + ctx.pb + ' to weapon damage.'));
  def('subclass:wizard:Overchannel', ctx => note(ctx, 'Overchannel: a level 1–5 wizard damage spell deals maximum damage; using it again before a long rest costs 2d12 necrotic per spell level (then 3d12, 4d12…).'));
  def('subclass:wizard:Durable Magic', ctx => note(ctx, 'Durable Magic: while concentrating on a spell, +2 AC and +2 to all saves.'));
  def('subclass:wizard:Song of Victory', ctx => new24(ctx)
    ? act(ctx, { name: 'Song of Victory', action: 'Bonus Action', feature: 'Song of Victory', desc: 'After casting a spell with a casting time of an action, make one weapon attack.' })
    : note(ctx, 'Song of Victory: while Bladesong is active, melee weapon attacks deal ' + signed(abm(ctx, 'int')) + ' damage.'));
  // Artificer
  def('subclass:artificer:Alchemical Savant', ctx => note(ctx, 'Alchemical Savant: a spell cast through alchemist’s supplies adds ' + signed(abm(ctx, 'int')) + ' to one healing roll or acid, fire, ' + (new24(ctx) ? '' : 'necrotic ') + 'or poison damage roll.'));
  def('subclass:artificer:Arcane Firearm', ctx => note(ctx, 'Arcane Firearm: artificer spells cast through it add 1d8 to one damage roll.'));
  def('subclass:artificer:Guided Precision', ctx => note(ctx, 'Guided Precision: once per turn, a Cartographer spell or a hit on a creature in your Faerie Fire adds ' + signed(ctx.mod.int) + ' damage; damage can’t break your concentration on Faerie Fire.'));
  def('subclass:artificer:Improved Defender', ctx => note(ctx, 'Improved Defender: Arcane Jolt deals or heals 4d6; your steel defender’s Deflect Attack deals 1d4' + signed(ctx.mod.int) + ' force' + (new24(ctx) ? '.' : ', and it gains +2 AC.')));
  def('subclass:artificer:Adventurer\'s Atlas', ctx => note(ctx, 'Adventurer’s Atlas: after a long rest, give magical maps to up to ' + Math.max(2, 1 + ctx.mod.int) + ' creatures; holders see each other on them.'));
  def('subclass:artificer:Thunder Gauntlets', ctx => note(ctx, 'Thunder Gauntlets: empty gauntlets are simple melee weapons dealing 1d8 thunder (INT to hit and damage); a creature hit has disadvantage against others until your next turn.'));
  def('subclass:artificer:Improved Armorer', ctx => note(ctx, 'Improved Armorer: an extra Armor plan and item for Replicate Magic Item, and +1 to attack and damage with your armour’s special weapon.'));

  // ── Subclass features, continued ───────────────────────────────────────
  const half = ctx => Math.floor(ctx.level / 2);
  const dc = (ctx, k) => 8 + ctx.pb + ctx.mod[k];
  const n = (keys, fn) => def(keys, fn);
  // Barbarian
  n('subclass:barbarian:Spiked Retribution', ctx => note(ctx, 'Spiked Retribution: while raging in spiked armour, a creature within 5 ft that hits you with a melee attack takes 3 piercing.'));
  n('subclass:barbarian:Vengeful Ancestors', ctx => note(ctx, 'Vengeful Ancestors: damage your Spirit Shield prevents is dealt back to the attacker as force.'));
  n('subclass:barbarian:Shielding Storm', ctx => note(ctx, 'Shielding Storm: creatures of your choice in your Storm Aura share your Storm Soul resistance.'));
  n('subclass:barbarian:Controlled Surge', ctx => note(ctx, 'Controlled Surge: roll twice on the Wild Magic table and choose; doubles let you pick any effect.'));
  n('subclass:barbarian:Battering Roots', ctx => note(ctx, 'Battering Roots: on your turn, +10 ft reach with Heavy or Versatile melee weapons, and a hit can add Push or Topple to the weapon’s mastery.'));
  n('subclass:barbarian:Warrior of the Gods', ctx => {
    if (!new24(ctx)) return note(ctx, 'Warrior of the Gods: spells that only bring you back to life need no material components.');
    const d = ctx.level >= 17 ? 7 : ctx.level >= 12 ? 6 : ctx.level >= 6 ? 5 : 4;
    pool(ctx, 'Warrior of the Gods', d, 'long', { die: 'd12' });
    act(ctx, { name: 'Warrior of the Gods', action: 'Bonus Action', resource: 'Warrior of the Gods', amount: 1, dice: '1d12', feature: 'Warrior of the Gods',
      desc: 'Spend any number of the pool’s d12s and regain that many hit points.' });
  });
  // Bard
  n(['subclass:bard:Additional Magical Secrets', 'subclass:bard:Magical Discoveries'], () => {});   // picked with the spells (sktMagicalSecrets)
  n('subclass:bard:Creative Crescendo', ctx => note(ctx, 'Creative Crescendo: Performance of Creation makes up to ' + Math.max(2, ctx.mod.cha) + ' items at once.'));
  n('subclass:bard:Silver Tongue', ctx => note(ctx, 'Silver Tongue: a d20 of 9 or lower on Persuasion or Deception counts as a 10.'));
  n('subclass:bard:Mystical Connection', ctx => note(ctx, 'Mystical Connection: roll twice on the Spirit Tales table and choose; doubles let you pick any tale.'));
  n('subclass:bard:Dazzling Footwork', () => {});   // its parts are listed on their own
  n('subclass:bard:Leading Evasion', ctx => note(ctx, 'Leading Evasion: Evasion on Dexterity saves for half damage, shared with creatures within 5 ft making the same save.'));
  // Cleric
  n('subclass:cleric:Blessed Healer', ctx => note(ctx, 'Blessed Healer: healing another creature with a spell slot heals you 2 + the slot’s level.'));
  n('subclass:cleric:Improved Flare', ctx => note(ctx, 'Improved Flare: Warding Flare also protects a creature within 30 ft that’s attacked.'));
  n(['subclass:cleric:Thunderbolt Strike', 'subclass:cleric:Resounding Strike'], ctx => note(ctx, 'Thunderbolt Strike: your lightning or thunder damage can push a Large or smaller creature 10 ft.'));
  n('subclass:cleric:Improved Duplicity', ctx => note(ctx, new24(ctx)
    ? 'Improved Duplicity: attacks against creatures within 5 ft of your illusion have advantage; when it ends, someone beside it regains ' + ctx.level + ' hit points.'
    : 'Improved Duplicity: Invoke Duplicity makes up to four duplicates; a bonus action moves any of them 30 ft.'));
  n('subclass:cleric:Reaper', ctx => note(ctx, 'Reaper: a necromancy cantrip from any list; single-target necromancy cantrips can hit two creatures within 5 ft of each other.'));
  n('subclass:cleric:Improved Reaper', ctx => note(ctx, 'Improved Reaper: single-target necromancy spells of 1st–5th level can target a second creature.'));
  n('subclass:cleric:Spell Breaker', ctx => note(ctx, 'Spell Breaker: healing an ally with a spell slot can also end a spell on it of that level or lower.'));
  n('subclass:cleric:Arcane Mastery', ctx => note(ctx, 'Arcane Mastery: one wizard spell each of 6th–9th level joins your domain spells, always prepared.'));
  n('subclass:cleric:Avatar of Battle', ctx => new24(ctx) ? ['bludgeoning', 'piercing', 'slashing'].forEach(t => ctx.resist.add(t))
    : note(ctx, 'Avatar of Battle: resistance to bludgeoning, piercing and slashing from nonmagical attacks.'));
  n('subclass:cleric:Saint of Forge and Fire', ctx => { ctx.immune.add('fire');
    note(ctx, 'Saint of Forge and Fire: immune to fire; in heavy armour, resistance to nonmagical bludgeoning, piercing and slashing.'); });
  n('subclass:cleric:Keeper of Souls', ctx => note(ctx, 'Keeper of Souls: once a round, when an enemy dies within 60 ft, you or a creature there regains hit points equal to its Hit Dice.'));
  n('subclass:cleric:Expansive Bond', ctx => note(ctx, 'Expansive Bond: Emboldening and Protective Bond reach 60 ft, and the creature taking the damage resists it.'));
  n('subclass:cleric:Twilight Shroud', ctx => note(ctx, 'Twilight Shroud: you and allies have half cover inside your Twilight Sanctuary.'));
  // Druid
  n('subclass:druid:Mighty Summoner', ctx => note(ctx, 'Mighty Summoner: beasts and fey you conjure have +2 hit points per Hit Die, and magical natural weapons.'));
  n('subclass:druid:Guardian Spirit', ctx => note(ctx, 'Guardian Spirit: your summoned beasts and fey ending their turn in your Spirit Totem aura regain ' + half(ctx) + ' hit points.'));
  n('subclass:druid:Dragon', ctx => note(ctx, 'Dragon (Starry Form): a d20 of 9 or lower on Intelligence or Wisdom checks, or concentration saves, counts as a 10.'));
  n('subclass:druid:Full of Stars', ctx => note(ctx, 'Full of Stars: in Starry Form, resistance to bludgeoning, piercing and slashing.'));
  n('subclass:druid:Enhanced Bond', ctx => note(ctx, 'Enhanced Bond: while your wildfire spirit is summoned, a fire or healing spell adds 1d8 to one roll, and can come from the spirit’s space.'));
  n('subclass:druid:Nature\'s Ward', ctx => {
    if (!new24(ctx)){ ctx.immune.add('poison'); ctx.immune.add('poisoned');
      return note(ctx, 'Nature’s Ward: immune to poison and disease; elementals and fey can’t charm or frighten you.'); }
    ctx.immune.add('poisoned');
    const land = String(ctx.build.subclassPick || ''), t = /arid/i.test(land) ? 'fire' : /polar/i.test(land) ? 'cold' : /temperate/i.test(land) ? 'lightning' : /tropical/i.test(land) ? 'poison' : '';
    if (t) ctx.resist.add(t);
  });
  n('subclass:druid:Nature\'s Sanctuary', ctx => new24(ctx)
    ? act(ctx, { name: 'Nature\'s Sanctuary', action: 'Magic', resource: 'Wild Shape', amount: 1, feature: 'Nature\'s Sanctuary',
        desc: 'A 15 ft cube of spectral trees within 120 ft for 1 minute: you and allies in it have half cover and your Nature’s Ward resistance. A bonus action moves it 60 ft.' })
    : note(ctx, 'Nature’s Sanctuary: a beast or plant attacking you makes a DC ' + dc(ctx, 'wis') + ' Wisdom save or must pick another target.'));
  n('2014:subclass:druid:Primal Strike', ctx => note(ctx, 'Primal Strike: your beast-form attacks count as magical.'));
  n('2024:class:druid:Primal Strike', () => {});   // Elemental Fury decides
  // Fighter
  n('subclass:fighter:Heroic Warrior', ctx => note(ctx, 'Heroic Warrior: in combat, start your turn with Heroic Inspiration if you don’t have it.'));
  n('subclass:fighter:Survivor', ctx => {
    if (new24(ctx)) ctx.rollAdv.push({ on: ['death'], label: 'Survivor' });
    note(ctx, 'Survivor: at the start of your turn while ' + (new24(ctx) ? 'bloodied' : 'at half hit points or less') + ' (and above 0), regain ' + (5 + ctx.mod.con) + ' hit points' + (new24(ctx) ? '; death saves of 18–20 count as a 20.' : '.'));
  });
  n('subclass:fighter:War Magic', ctx => note(ctx, new24(ctx) ? 'War Magic: replace one attack of the Attack action with a wizard cantrip.' : 'War Magic: after casting a cantrip with your action, make a weapon attack as a bonus action.'));
  n('subclass:fighter:Improved War Magic', ctx => note(ctx, new24(ctx) ? 'Improved War Magic: replace two attacks with a level 1 or 2 wizard spell.' : 'Improved War Magic: after casting a spell with your action, make a weapon attack as a bonus action.'));
  n('subclass:fighter:Rallying Cry', ctx => note(ctx, 'Rallying Cry: Second Wind also heals up to three allies within 60 ft for ' + ctx.level + ' hit points each.'));
  n('subclass:fighter:Bulwark', ctx => note(ctx, 'Bulwark: when Indomitable rerolls an Intelligence, Wisdom or Charisma save, an ally within 60 ft who failed the same save rerolls too.'));
  n('subclass:fighter:Magic Arrow', ctx => note(ctx, 'Magic Arrow: arrows you fire from a shortbow or longbow are magical.'));
  n('subclass:fighter:Ever-Ready Shot', ctx => note(ctx, 'Ever-Ready Shot: roll initiative with no Arcane Shots left and regain one.'));
  n('subclass:fighter:Hold the Line', ctx => note(ctx, 'Hold the Line: creatures moving 5 ft within your reach provoke opportunity attacks, and a hit stops them.'));
  n('subclass:fighter:Ferocious Charger', ctx => note(ctx, 'Ferocious Charger: once per turn, after moving 10 ft straight, a hit forces a DC ' + dc(ctx, 'str') + ' Strength save or the target is knocked prone.'));
  n('subclass:fighter:Tireless Spirit', ctx => note(ctx, 'Tireless Spirit: roll initiative with no Fighting Spirit left and regain one use.'));
  n('subclass:fighter:Telekinetic Adept', () => {});   // Psi-Powered Leap and Telekinetic Thrust are listed on their own
  n('subclass:fighter:Telekinetic Thrust', ctx => note(ctx, 'Telekinetic Thrust: a target of your Psionic Strike makes a DC ' + dc(ctx, 'int') + ' Strength save or is knocked prone or moved 10 ft.'));
  n('subclass:fighter:Master of Runes', ctx => note(ctx, 'Master of Runes: each rune you know can be invoked twice between short rests.'));
  // Monk
  n('subclass:monk:Shadow Arts', ctx => new24(ctx) ? null : act(ctx, { name: 'Shadow Arts', action: 'Action', resource: 'Focus Points', amount: 2, feature: 'Shadow Arts',
    desc: 'Cast Darkness, Darkvision, Pass without Trace or Silence without material components.' }));
  n('subclass:monk:Open Hand Technique', ctx => note(ctx, 'Open Hand Technique: a Flurry of Blows hit can topple (DC ' + dc(ctx, 'wis') + ' Dexterity), push 15 ft (Strength), or stop reactions' + (new24(ctx) ? ' (Addle: no opportunity attacks).' : '.')));
  n('subclass:monk:Touch of Death', ctx => note(ctx, 'Touch of Death: reducing a creature within 5 ft to 0 hit points gives ' + Math.max(1, ctx.mod.wis + ctx.level) + ' temporary hit points.'));
  n('subclass:monk:Tipsy Sway', () => {});   // Leap to Your Feet and Redirect Attack are listed on their own
  n('subclass:monk:Leap to Your Feet', ctx => note(ctx, 'Leap to Your Feet: standing up from prone costs only 5 ft of movement.'));
  n('subclass:monk:Intoxicated Frenzy', ctx => note(ctx, 'Intoxicated Frenzy: Flurry of Blows can make up to three more attacks, each against a different creature.'));
  n('subclass:monk:Unerring Accuracy', ctx => note(ctx, 'Unerring Accuracy: once per turn, reroll a missed monk-weapon attack.'));
  n('subclass:monk:Physician\'s Touch', ctx => note(ctx, 'Physician’s Touch: Hand of Healing can also end blinded, deafened, paralyzed, poisoned or stunned' + (new24(ctx) ? '' : ' or a disease') + '; Hand of Harm can poison until the end of your next turn.'));
  n('subclass:monk:Forms of Your Astral Self', () => {});   // how it looks
  // Paladin
  n('subclass:paladin:Smite of Protection', ctx => note(ctx, 'Smite of Protection: after a Divine Smite, you and allies in your Aura of Protection have half cover until your next turn.'));
  n('subclass:paladin:Aura of Warding', ctx => {
    if (new24(ctx)){ ['necrotic', 'psychic', 'radiant'].forEach(t => ctx.resist.add(t)); return note(ctx, 'Aura of Warding: you and allies in your Aura of Protection resist necrotic, psychic and radiant damage.'); }
    note(ctx, 'Aura of Warding: you and friendly creatures within ' + (ctx.level >= 18 ? 30 : 10) + ' ft resist damage from spells.');
  });
  n('subclass:paladin:Supernatural Resistance', ctx => note(ctx, 'Supernatural Resistance: resistance to bludgeoning, piercing and slashing from nonmagical weapons.'));
  n('subclass:paladin:Aura of Conquest', ctx => note(ctx, 'Aura of Conquest: creatures frightened of you have speed 0 within ' + (ctx.level >= 18 ? 30 : 10) + ' ft and take ' + half(ctx) + ' psychic when they start their turn there.'));
  n('subclass:paladin:Scornful Rebuke', ctx => note(ctx, 'Scornful Rebuke: a creature that hits you takes ' + abm(ctx, 'cha') + ' psychic damage.'));
  n('subclass:paladin:Emissary of Redemption', ctx => note(ctx, 'Emissary of Redemption: resistance to all damage from other creatures, and attackers take half the damage as radiant — until you harm them.'));
  n('subclass:paladin:Purity of Spirit', ctx => note(ctx, 'Purity of Spirit: always under Protection from Evil and Good.'));
  n('subclass:paladin:Elemental Smite', () => {});   // its four effects are listed on their own
  n('subclass:paladin:Dao\'s Crush', ctx => note(ctx, 'Dao’s Crush (Elemental Smite): your smite’s target is grappled and restrained (escape DC ' + dc(ctx, 'cha') + ').'));
  n('subclass:paladin:Djinni\'s Escape', ctx => note(ctx, 'Djinni’s Escape (Elemental Smite): teleport 30 ft and turn semi-incorporeal until the end of your next turn — resistance to bludgeoning, piercing and slashing.'));
  n('subclass:paladin:Marid\'s Surge', ctx => note(ctx, 'Marid’s Surge (Elemental Smite): the target and creatures you choose within 10 ft make a DC ' + dc(ctx, 'cha') + ' Strength save or are pushed 15 ft and knocked prone.'));
  // Ranger
  n('subclass:ranger:Hunter\'s Lore', ctx => note(ctx, 'Hunter’s Lore: you know the immunities, resistances and vulnerabilities of a creature marked by your Hunter’s Mark.'));
  n('subclass:ranger:Superior Hunter\'s Prey', ctx => note(ctx, 'Superior Hunter’s Prey: once per turn, Hunter’s Mark’s extra damage can also hit another creature within 30 ft of the first.'));
  n('subclass:ranger:Distant Strike', ctx => note(ctx, 'Distant Strike: teleport 10 ft before each attack; attacking two creatures gives a third attack.'));
  n('subclass:ranger:Bestial Fury', ctx => note(ctx, new24(ctx) ? 'Bestial Fury: your beast uses Beast’s Strike twice, and its first hit each turn on your Hunter’s Mark target adds the mark’s damage.' : 'Bestial Fury: your beast makes two attacks (or Multiattack) when commanded to Attack.'));
  n('subclass:ranger:Escape the Horde', ctx => note(ctx, 'Escape the Horde: opportunity attacks against you have disadvantage.'));
  n('subclass:ranger:Evasion', ctx => note(ctx, 'Evasion: no damage on a successful Dexterity save for half, half on a failure.'));
  n('subclass:ranger:Fey Reinforcements', ctx => {
    pool(ctx, 'Fey Reinforcements', 1, 'long');
    note(ctx, 'Fey Reinforcements: Summon Fey without a material component, once a long rest without a slot, and optionally without concentration (1 minute).');
  });
  // Rogue
  n('subclass:rogue:Infiltration Expertise', ctx => note(ctx, new24(ctx) ? 'Infiltration Expertise: mimic speech or handwriting after an hour’s study; Steady Aim doesn’t stop you moving.' : 'Infiltration Expertise: spend 7 days and 25 gp to build a false identity others believe.'));
  n('subclass:rogue:Death Strike', ctx => note(ctx, 'Death Strike: ' + (new24(ctx) ? 'a Sneak Attack hit in the first round' : 'a hit on a surprised creature') + ' forces a DC ' + dc(ctx, 'dex') + ' Constitution save or the damage is doubled.'));
  n('subclass:rogue:Thief\'s Reflexes', ctx => note(ctx, 'Thief’s Reflexes: two turns in the first round of combat — at your initiative and at initiative −10.'));
  n('subclass:rogue:Ear for Deceit', ctx => note(ctx, 'Ear for Deceit: an Insight roll of 7 or lower to spot a lie counts as an 8.'));
  n('subclass:rogue:Insightful Manipulator', ctx => note(ctx, 'Insightful Manipulator: after a minute observing a creature, learn how it compares to you in two traits (Intelligence, Wisdom, Charisma or class levels).'));
  n('subclass:rogue:Soul of Deceit', ctx => note(ctx, 'Soul of Deceit: your thoughts can’t be read unless you allow it, and magic can’t tell whether you’re lying.'));
  n('subclass:rogue:Fancy Footwork', ctx => note(ctx, 'Fancy Footwork: a creature you make a melee attack against can’t make opportunity attacks against you this turn.'));
  n('subclass:rogue:Whispers of the Dead', ctx => note(ctx, 'Whispers of the Dead: after each rest, gain one skill or tool proficiency you lack until you choose another.'));
  n('subclass:rogue:Death\'s Friend', ctx => note(ctx, 'Death’s Friend: Wails from the Grave hits both creatures, and a long rest gives you a soul trinket if you have none.'));
  n('subclass:rogue:Dread Allegiance', ctx => note(ctx, 'Dread Allegiance: pick Bane, Bhaal or Myrkul after each long rest — a damage resistance and a cantrip (INT).'));
  n('subclass:rogue:Aura of Malevolence', ctx => note(ctx, 'Aura of Malevolence: teleporting with Bloodthirst deals ' + ctx.mod.int + ' damage of your Dread Allegiance type, ignoring resistance, to creatures within 10 ft of either space.'));
  n('subclass:rogue:Dread Incarnate', ctx => note(ctx, 'Dread Incarnate: a short rest restores one Bloodthirst use, and Sneak Attack dice treat 1s and 2s as 3s.'));
  // Sorcerer
  n('subclass:sorcerer:Controlled Chaos', ctx => note(ctx, 'Controlled Chaos: roll twice on the Wild Magic Surge table and choose.'));
  n('subclass:sorcerer:Spell Bombardment', ctx => note(ctx, 'Spell Bombardment: once per turn, a spell damage die that rolls its maximum is rolled again and added.'));
  n('subclass:sorcerer:Heart of Fire', ctx => note(ctx, 'Heart of Fire: casting a fire spell of 1st level or higher deals ' + Math.max(1, half(ctx)) + ' fire to creatures you choose within 10 ft.'));
  n('subclass:sorcerer:Moon Fire', ctx => note(ctx, 'Moon Fire: Sacred Flame can target two creatures within 5 ft of each other.'));
  // Warlock
  n('subclass:warlock:Dark One\'s Blessing', ctx => note(ctx, 'Dark One’s Blessing: reducing an enemy to 0 hit points' + (new24(ctx) ? ' (or an ally doing so within 10 ft)' : '') + ' gives ' + Math.max(1, ctx.mod.cha + ctx.level) + ' temporary hit points.'));
  n('subclass:warlock:Undying Nature', ctx => note(ctx, 'Undying Nature: no need for food, water, sleep or air, and you age slowly.'));
  n('subclass:warlock:Celestial Resilience', ctx => note(ctx, 'Celestial Resilience: after a rest' + (new24(ctx) ? ' or Magical Cunning' : '') + ', you gain ' + (ctx.level + ctx.mod.cha) + ' temporary hit points and up to five creatures gain ' + (half(ctx) + ctx.mod.cha) + '.'));
  n('subclass:warlock:Master of Hexes', ctx => note(ctx, 'Master of Hexes: when your Hexblade’s Curse target dies, move the curse to a creature within 30 ft.'));
  n('subclass:warlock:Genie\'s Wrath', ctx => {
    const k = String(ctx.build.subclassPick || ''), t = /dao/i.test(k) ? 'bludgeoning' : /djinn/i.test(k) ? 'thunder' : /efreet/i.test(k) ? 'fire' : /marid/i.test(k) ? 'cold' : '';
    ctx.extraDamage.push({ label: 'Genie\'s Wrath', dice: String(ctx.pb) + (t ? ' ' + t : ''), note: 'once on each of your turns, an attack roll hit' });
  });
  n('subclass:warlock:Grave Touched', ctx => note(ctx, 'Grave Touched: no need to eat, drink or breathe; once per turn a hit can deal necrotic instead (an extra die in Form of Dread).'));
  n('subclass:warlock:Awakened Mind', ctx => new24(ctx)
    ? act(ctx, { name: 'Awakened Mind', action: 'Bonus Action', feature: 'Awakened Mind', desc: 'Telepathy with a creature within 30 ft, for ' + ctx.level + ' minutes, up to ' + Math.max(1, ctx.mod.cha) + ' mile' + (Math.max(1, ctx.mod.cha) === 1 ? '' : 's') + ' apart.' })
    : note(ctx, 'Awakened Mind: speak telepathically to a creature you can see within 30 ft.'));
  // Wizard
  n(['subclass:wizard:Abjuration Savant', 'subclass:wizard:Conjuration Savant', 'subclass:wizard:Divination Savant', 'subclass:wizard:Enchantment Savant', 'subclass:wizard:Evocation Savant',
     'subclass:wizard:Illusion Savant', 'subclass:wizard:Necromancy Savant', 'subclass:wizard:Transmutation Savant'], ctx => note(ctx, new24(ctx)
    ? 'Savant: two spells of your school (level 2 or lower) free in your spellbook, and one more free each time you gain a new spell level.'
    : 'Savant: copying spells of your school into your spellbook takes half the gold and time.'));
  n('subclass:wizard:Focused Conjuration', ctx => note(ctx, 'Focused Conjuration: damage can’t break your concentration on a conjuration spell.'));
  n('subclass:wizard:Durable Summons', ctx => note(ctx, 'Durable Summons: creatures you summon with conjuration have 30 temporary hit points.'));
  n('subclass:wizard:Expert Divination', ctx => note(ctx, 'Expert Divination: casting a divination spell of 2nd level or higher regains a lower slot (up to 5th).'));
  n('subclass:wizard:Split Enchantment', ctx => note(ctx, 'Split Enchantment: a single-target enchantment spell of 1st level or higher can target a second creature.'));
  n('subclass:wizard:Potent Cantrip', ctx => note(ctx, 'Potent Cantrip: a creature that ' + (new24(ctx) ? 'you miss or that saves against your cantrip' : 'saves against your cantrip') + ' still takes half its damage.'));
  n('subclass:wizard:Grim Harvest', ctx => note(ctx, 'Grim Harvest: killing with a spell of 1st level or higher heals twice its level (three times for necromancy).'));
  n('subclass:wizard:Minor Alchemy', ctx => note(ctx, 'Minor Alchemy: spend 10 minutes to turn a nonmagical object of wood, stone, iron, copper or silver into another of those for an hour.'));
  n('subclass:wizard:Power Surge', ctx => {
    pool(ctx, 'Power Surge', abm(ctx, 'int'), 'long');
    note(ctx, 'Power Surge: once per turn, spend a surge for +' + half(ctx) + ' force damage with a wizard spell; gain one by countering or dispelling a spell (resets to one after a long rest).');
  });
  n('subclass:wizard:Deflecting Shroud', ctx => note(ctx, 'Deflecting Shroud: Arcane Deflection also deals ' + half(ctx) + ' force to up to three creatures within 60 ft.'));
  n('subclass:wizard:Gravity Well', ctx => note(ctx, 'Gravity Well: a creature your spell hits (or that fails its save, or is willing) can be moved 5 ft.'));
  n('subclass:wizard:Bladesinger Styles', () => {});   // flavour
  // Artificer
  n('subclass:artificer:Armor Modifications', ctx => note(ctx, 'Armor Modifications: your Arcane Armor counts as four items for infusions (chest, boots, helmet, weapon), and you can infuse two more items if they’re armour parts.'));
  n('subclass:artificer:Perfected Armor', ctx => note(ctx, 'Perfected Armor: your armour model’s weapon hits harder and gains a new power (see the model).'));

  // ── On/off states: the sheet's toggles ─────────────────────────────────
  // Each one changes numbers while it's on, the way D&D Beyond's do. A
  // spell's is offered when the character has the spell; turning on a
  // concentration spell is concentrating on it.
  const st = api.sktDefineState, has = (ctx, n) => ctx.featureNames.has(n);
  const DMG = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
  st({ key: 'Rage', label: 'Rage', resource: 'Rage', has: ctx => has(ctx, 'Rage') && ctx.rageDamage,
    // The 2024 Wild Heart picks an animal each time it rages.
    options: ctx => has(ctx, 'Rage of the Wilds') ? ['Bear', 'Eagle', 'Wolf'] : [],
    desc: (ctx, v) => 'Advantage on Strength checks and saves, +' + ctx.rageDamage + ' damage on Strength melee attacks, '
      + (ctx.edition === '2014' && (ctx.build.featureChoices || {})['Totem Spirit'] === 'Bear' ? 'resistance to all damage but psychic.'
        : v === 'Bear' ? 'resistance to all damage except force, necrotic, psychic and radiant.'
        : 'resistance to bludgeoning, piercing and slashing.'
          + (v === 'Eagle' ? ' Dash and Disengage as one bonus action.' : v === 'Wolf' ? ' Allies have advantage on attacks against enemies within 5 ft of you.' : '')),
    apply: (ctx, v) => {
      ctx.rageOn = ctx.rageDamage;
      ['bludgeoning', 'piercing', 'slashing'].forEach(t => ctx.resist.add(t));
      if (ctx.edition === '2014' && (ctx.build.featureChoices || {})['Totem Spirit'] === 'Bear') DMG.filter(t => t !== 'psychic').forEach(t => ctx.resist.add(t));
      if (v === 'Bear') DMG.filter(t => !['force', 'necrotic', 'psychic', 'radiant'].includes(t)).forEach(t => ctx.resist.add(t));
      ctx.rollAdv.push({ on: ['ab:str', 'save:str'], label: 'Rage' });
      if (has(ctx, 'Mindless Rage')) ['charmed', 'frightened'].forEach(c => ctx.immune.add(c));
      if (has(ctx, 'Frenzy') && ctx.edition === '2024') ctx.extraDamage.push({ label: 'Frenzy', dice: ctx.rageDamage + 'd6', note: 'with Reckless Attack, the first target you hit each turn with a Strength attack' });
      if (has(ctx, 'Divine Fury')) ctx.extraDamage.push({ label: 'Divine Fury', dice: '1d6+' + Math.floor(ctx.classLevel('barbarian') / 2) + ' radiant', note: 'the first creature you hit each turn while raging' });
    } });
  // Until the start of your next turn: the combat tracker turns it off then.
  st({ key: 'Reckless Attack', label: 'Reckless Attack', has: ctx => has(ctx, 'Reckless Attack'),
    desc: ctx => 'Advantage on ' + (ctx.edition === '2014' ? 'melee weapon attacks' : 'attacks') + ' using Strength this turn; attacks against you have advantage until your next turn.',
    apply: ctx => ctx.rollAdv.push({ on: ['attack:str'], label: 'Reckless Attack' }) });
  st({ key: 'Bladesong', label: 'Bladesong', resource: 'Bladesong', has: ctx => has(ctx, 'Bladesong'),
    desc: ctx => '+' + abm(ctx, 'int') + ' AC and to concentration saves, +10 ft speed, advantage on Acrobatics. Not in medium or heavy armour' + (ctx.edition === '2014' ? ' or with a shield.' : '.'),
    apply: ctx => {
      const b = abm(ctx, 'int');
      ctx.acBonus.push({ label: 'Bladesong', value: b }); ctx.speedBonus += 10; ctx.concBonus += b;
      ctx.rollAdv.push({ on: ['skill:acrobatics'], label: 'Bladesong' });
    } });
  st({ key: 'Innate Sorcery', label: 'Innate Sorcery', resource: 'Innate Sorcery', edition: '2024', has: ctx => has(ctx, 'Innate Sorcery'),
    desc: '+1 to your sorcerer spell save DC and advantage on sorcerer spell attacks, for 1 minute.',
    apply: ctx => { ctx.spellDcBonus += 1; ctx.rollAdv.push({ on: ['attack:spell'], label: 'Innate Sorcery' }); } });
  st({ key: 'Sacred Weapon', label: 'Sacred Weapon', resource: 'Channel Divinity', has: ctx => ctx.actions.some(a => a.name === 'Sacred Weapon'),
    desc: ctx => '+' + abm(ctx, 'cha') + ' to attack rolls with weapons for 1 minute.',
    apply: ctx => { ctx.weaponHit += abm(ctx, 'cha'); } });
  st({ key: 'Hexblade\'s Curse', label: 'Hexblade’s Curse', resource: 'Hexblade\'s Curse', has: ctx => has(ctx, 'Hexblade\'s Curse'),
    desc: ctx => 'Against the cursed target: +' + ctx.pb + ' damage, and a critical hit on 19 or 20.',
    apply: ctx => { ctx.damageBonusAll += ctx.pb; ctx.critRange = Math.min(ctx.critRange, 19); } });
  st({ key: 'Shield', label: 'Shield', spell: 'Shield', desc: '+5 AC until the start of your next turn.', apply: ctx => ctx.acBonus.push({ label: 'Shield', value: 5 }) });
  st({ key: 'Shield of Faith', label: 'Shield of Faith', spell: 'Shield of Faith', desc: '+2 AC.', apply: ctx => ctx.acBonus.push({ label: 'Shield of Faith', value: 2 }) });
  st({ key: 'Mage Armor', label: 'Mage Armor', spell: 'Mage Armor', desc: 'Base AC 13 + Dexterity without armour.',
    apply: ctx => ctx.acOptions.push({ label: 'Mage Armor', value: 13 + ctx.mod.dex, noArmor: true, shieldOk: true }) });
  st({ key: 'Barkskin', label: 'Barkskin', spell: 'Barkskin', desc: ctx => 'AC can’t be lower than ' + (ctx.edition === '2014' ? 16 : 17) + '.',
    apply: ctx => { ctx.acFloor = { label: 'Barkskin', value: ctx.edition === '2014' ? 16 : 17 }; } });
  st({ key: 'Haste', label: 'Haste', spell: 'Haste', desc: '+2 AC, double speed, advantage on Dexterity saves, an extra action.',
    apply: ctx => { ctx.acBonus.push({ label: 'Haste', value: 2 }); ctx.speedMult *= 2; ctx.rollAdv.push({ on: ['save:dex'], label: 'Haste' }); } });
  st({ key: 'Bless', label: 'Bless', spell: 'Bless', desc: '+1d4 to attack rolls and saving throws.',
    apply: ctx => ctx.rollDice.push({ on: ['attack', 'save'], die: 4, label: 'Bless' }) });
  st({ key: 'Longstrider', label: 'Longstrider', spell: 'Longstrider', desc: '+10 ft speed.', apply: ctx => { ctx.speedBonus += 10; } });
  st({ key: 'Stoneskin', label: 'Stoneskin', spell: 'Stoneskin', desc: ctx => 'Resistance to ' + (ctx.edition === '2014' ? 'nonmagical ' : '') + 'bludgeoning, piercing and slashing damage.',
    apply: ctx => ['bludgeoning', 'piercing', 'slashing'].forEach(t => ctx.resist.add(t)) });
  st({ key: 'Shillelagh', label: 'Shillelagh', spell: 'Shillelagh',
    desc: 'A club or quarterstaff hits with your spellcasting ability and a bigger die.',
    apply: ctx => { const L = ctx.level; ctx.shillelagh = { die: ctx.edition === '2014' || L < 5 ? '1d8' : L < 11 ? '1d10' : L < 17 ? '1d12' : '2d6' }; } });
  st({ key: 'Divine Favor', label: 'Divine Favor', spell: 'Divine Favor', desc: '+1d4 radiant damage on weapon hits.',
    apply: ctx => ctx.extraDamage.push({ label: 'Divine Favor', dice: '1d4 radiant', note: 'each weapon hit' }) });

})(typeof module !== 'undefined' && module.exports ? require('./char-rules.js') : window);
