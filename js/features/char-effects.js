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
      else note(ctx, 'Divine Strike: once per turn, +' + (ctx.level >= 14 ? '2d8' : '1d8') + ' radiant or necrotic damage on a weapon hit.');
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
      else note(ctx, 'Primal Strike: once per turn, +' + (ctx.level >= 15 ? '2d8' : '1d8') + ' cold, fire, lightning or thunder damage on a weapon or beast-form hit.');
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
  both(['class:wizard:Spell Mastery'], ctx => note(ctx, 'Spell Mastery: cast your chosen 1st- and 2nd-level spells at their lowest level without a slot.'));
  both(['class:wizard:Signature Spells'], ctx => pool(ctx, 'Signature Spells', 2, 'short', { note: 'Each of your two 3rd-level signature spells once per rest without a slot.' }));
  def('2024:class:wizard:Ritual Adept', ctx => note(ctx, 'Ritual Adept: cast any ritual spell in your spellbook as a ritual without preparing it.'));
  def('2024:class:wizard:Scholar', () => {});                       // an expertise pick in the builder
  def('2024:class:wizard:Memorize Spell', ctx => note(ctx, 'Memorize Spell: after a short rest, swap one prepared spell for another from your spellbook.'));

})(typeof module !== 'undefined' && module.exports ? require('./char-rules.js') : window);
