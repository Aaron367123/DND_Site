// ============================================================
// CHARACTER BUILDER — make a character, or level one up
// ============================================================
// A step-by-step builder in the spirit of D&D Beyond's, for either rules
// edition. Everything it asks is a choice stored on the build; the sheet is
// recomputed from the build on every change (char-rules.js), so the preview
// on the right is always the real character, and "Create" just saves it.
//
// The same overlay serves three jobs:
//   create   — a blank build, from the Party panel, Ctrl+K or a phone
//   edit     — an existing built character, every step open
//   levelup  — an existing build one level higher, opened on the steps
//              that have something new to decide
//
// It works at phone width: one column, steps across the top, the sheet as
// a strip of headline numbers, the big buttons at the bottom.

let CB = null;   // { build, R, step, mode, idx, onDone, rolls }

const CB_STEPS = [
  { id: 'basics',     label: 'Basics' },
  { id: 'class',      label: 'Class' },
  { id: 'species',    label: 'Species' },
  { id: 'background', label: 'Background' },
  { id: 'abilities',  label: 'Abilities' },
  { id: 'skills',     label: 'Skills' },
  { id: 'levels',     label: 'Levels' },
  { id: 'spells',     label: 'Spells' },
  { id: 'equipment',  label: 'Equipment' },
  { id: 'details',    label: 'Details' },
  { id: 'review',     label: 'Review' },
];

function cbEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function cbIsPlayer(){ return document.body.classList.contains('player-mode') || document.body.classList.contains('player-app'); }

// ── Opening ──────────────────────────────────────────────────────────────────
// opts: { idx } to edit or level up the party member at idx; { levelup:true };
// { edition } to start a new build in a given edition; onDone(record, idx).
async function openCharBuilder(opts){
  opts = opts || {};
  const prior = (opts.idx != null) ? state.party[opts.idx] : null;
  // An imported character (a PDF) opened here is rebuilt: its choices are
  // filled in from what the sheet says, so it can be levelled and edited
  // like one made here. Its edition is the one its features are printed in.
  const convert = !!(prior && !prior.build && !prior.foe);
  let build;
  if (prior && prior.build) build = JSON.parse(JSON.stringify(prior.build));
  else build = sktBlankBuild(convert ? cbImportEdition(prior) : (opts.edition || '2024'));
  const mode = prior ? (opts.levelup ? 'levelup' : 'edit') : 'create';
  if (mode === 'levelup') build.level = Math.min(20, (build.level || 1) + 1);
  const multi0 = JSON.parse(JSON.stringify(build.multi || []));
  CB = { build, R: null, step: mode === 'create' ? 'basics' : (mode === 'levelup' ? 'levels' : 'review'),
         mode, idx: opts.idx != null ? opts.idx : null, onDone: opts.onDone || null,
         fromLevel: prior && prior.build ? prior.build.level : null, loading: true, multi0, lvlTo: 'first' };
  if (convert) CB.convertFrom = prior.id;
  cbMount();
  await cbLoad(build.edition);
  if (CB && CB.convertFrom && CB.R && !CB.error){
    try { cbFromImported(prior); } catch(e){ CB.error = 'Couldn\u2019t read ' + prior.name + '\u2019s sheet into the builder (' + e.message + ').'; }
    cbRender();
  }
}

// ── Rebuilding an imported character ────────────────────────────────────────
// A PDF gives the results (scores, bonuses, a list of spells and feats); the
// builder keeps the choices that make them. So: everything the sheet names is
// set (class, subclass, species, background, the skills it's proficient in,
// feats, fighting style, masteries, spells, gear), the builder's quick build
// fills whatever is left the way it would for a new character, and the base
// scores are worked backwards so every ability comes out as on the sheet.
// The review lists anything that still differs from the PDF.
const SKT_SPECIES_REPRINT = { 'half-elf': 'Khoravar', 'half elf': 'Khoravar' };
function cbItemName(n){ const s = String(n || '').trim().toLowerCase(); return s.includes(',') ? s.split(',').map(x => x.trim()).reverse().join(' ') : s; }
function cbImportEdition(pc){
  const f = String((pc.sheet && pc.sheet.bio && pc.sheet.bio.features) || '');
  if (/PHB-2024|XPHB|\b2024\b/.test(f)) return '2024';
  if (/PHB-2014|\bPHB\s*\d/.test(f)) return '2014';
  return (state.settings && state.settings.builderEdition) || '2024';
}
function cbFromImported(pc){
  const R = CB.R, b = CB.build, sh = pc.sheet || {}, notes = [];
  const lc = s => String(s || '').trim().toLowerCase();
  const camel = k => String(k).replace(/_([a-z])/g, (m, c) => c.toUpperCase());
  b.name = pc.name || ''; b.icon = pc.icon || '';
  // Class and level: the first class of a multiclass leads.
  const parts = (sh.classLevels && sh.classLevels.length ? sh.classLevels : [{ cls: pc.cls, level: pc.level }])
    .map(p => ({ cls: R.classes.find(c => c.key === lc(p.cls) || lc(p.cls).startsWith(c.key)), level: parseInt(p.level, 10) || 1 })).filter(p => p.cls);
  if (!parts.length) throw new Error('no class the rules know (' + (pc.cls || '?') + ')');
  b.cls = parts[0].cls.name;
  b.level = parts.length > 1 ? parts[0].level : Math.max(1, Math.min(20, parseInt(pc.level, 10) || parts[0].level));
  b.multi = parts.slice(1).map(p => ({ cls: p.cls.name, level: p.level, skills: [], cantrips: [], spells: [], spellbook: [] }));
  const cls = parts[0].cls;
  if (pc.subclass){
    const n = lc(pc.subclass);
    const s = sktRulesSubclass(cls, pc.subclass) || cls.subclasses.find(x => lc(x.name).includes(n) || n.includes(lc(x.shortName)));
    if (s){ b.subclass = s.shortName; if (sktIsLegacy(b, s)) b.legacy = true; else if (s.core === false) b.allBooks = true; } else notes.push('Subclass “' + pc.subclass + '” isn’t in the rules here — pick one');
  }
  // Species and background, by name (a book beyond the handbook switches the others on).
  const exact = (list, name) => { const n = lc(name); return n ? (list.find(x => lc(x.name) === n) || list.find(x => lc(x.name).replace(/[^a-z]/g, '') === n.replace(/[^a-z]/g, ''))) : null; };
  const near = (list, name) => { const n = lc(name); return n ? list.filter(x => n.includes(lc(x.name))).sort((x, y) => y.name.length - x.name.length)[0] || null : null; };
  let sp = exact(R.species, pc.race);
  // A species the newer books reprinted under another name: the 2014 Half-Elf
  // is Eberron's Khoravar in the 2024 era (the data's own reprint note).
  if (!sp && R.edition === '2024' && SKT_SPECIES_REPRINT[lc(pc.race)]){
    sp = exact(R.species, SKT_SPECIES_REPRINT[lc(pc.race)]);
    if (sp) notes.push('“' + pc.race + '” is the ' + sp.name + ' in the 2024 books — switch the rules to 2014 on the Basics step to keep the old one');
  }
  if (!sp && (sp = near(R.species, pc.race))) notes.push('“' + pc.race + '” isn’t in the ' + R.edition + ' rules — ' + sp.name + ' is the closest; check the species step');
  if (sp){ b.species = sp.name; if (sktIsLegacy(b, sp)){ b.legacy = true; notes.push('Legacy content is on: the ' + sp.name + ' is a 2014 species (D&D Beyond’s Legacy setting)'); } else if (sp.core === false) b.allBooks = true; }
  else if (pc.race) notes.push('Species “' + pc.race + '” isn’t in the rules here — pick one');
  // "Custom Background" (D&D Beyond's own): the builder's custom background,
  // with the skills, abilities and origin feat filled in below.
  const customBg = /custom/i.test(pc.background || '');
  const bg = customBg ? null : exact(R.backgrounds, pc.background);
  if (customBg){ b.background = SKT_CUSTOM_BG; b.customBg = { name: 'Custom background', skills: [], tools: [], languages: 0 }; }
  else if (bg){ b.background = bg.name; if (bg.core === false) b.allBooks = true; }
  else if (pc.background) notes.push('Background “' + pc.background + '” isn’t in the rules here — pick one');
  b.details = Object.assign({}, b.details, { alignment: pc.alignment || '', backstory: (sh.bio || {}).backstory || '',
    traits: (sh.bio || {}).traits || '', ideals: (sh.bio || {}).ideals || '', bonds: (sh.bio || {}).bonds || '', flaws: (sh.bio || {}).flaws || '' });
  // Skills it's proficient in: what the background and species don't give
  // are the class's picks (then a species pick), expertise where it has it.
  const prof = sh.skillProf || (typeof csImpProfs === 'function' ? csImpProfs(pc).skillProf : {});
  const want = Object.keys(prof).filter(k => prof[k] >= 1).map(camel), exp = Object.keys(prof).filter(k => prof[k] >= 2).map(camel);
  // A feat's skill picks left unmade count as made by default when the rules
  // work the character out: mark them empty so they aren't taken as given.
  sktBuildFeatNames(b, R).forEach(n => { const f = sktRulesFeat(R, n); if (f && sktFeatChoices(R, b, n, null).choices.some(c => c.kind === 'skills' || c.kind === 'skillsTools')) b.featChoices[f.name] = Object.assign({ skills: [], tools: [] }, b.featChoices[f.name]); });
  const granted = new Set(Object.keys(sktComputeCharacter(b, R).sheet.skillProf || {}));
  const skp = sp ? cbSpeciesSkillChoice(sp, sktSpeciesSub(sp, b)) : null;
  const sFrom = new Set(skp ? skp.from : []);
  let left = want.filter(k => !granted.has(k));
  // Expertise first (it needs the proficiency), then what nothing later can cover.
  const rank = (k, later) => (exp.includes(k) ? 0 : 2) + (later(k) ? 1 : 0);
  const take = (from, n, later) => { const got = left.filter(from).sort((x, y) => rank(x, later) - rank(y, later)).slice(0, n); left = left.filter(k => !got.includes(k)); return got; };
  b.skills = take(k => cls.skillChoice.from.includes(k), cls.skillChoice.count, k => customBg || sFrom.has(k));
  if (skp) b.speciesSkills = take(k => sFrom.has(k), skp.count, () => customBg);
  if (customBg) b.customBg.skills = take(() => true, 2, () => false);
  b.expertise = exp;
  // Feats: a fighting style, an origin feat, then the rest into the ASI levels in order.
  if (customBg && R.edition === '2024'){
    const o = (pc.feats || []).map(x => sktRulesFeat(R, String((x && x.name) || x))).find(f => f && String(f.category || '').split(':')[0] === 'O');
    if (o) b.customBg.feat = o.name;
    b.customBg.abilities = SKT_ABS.slice().sort((x, y) => (+((pc.abilities || {})[y]) || 0) - (+((pc.abilities || {})[x]) || 0)).slice(0, 3);
  }
  const bgNow = sktBuildBackground(R, b);
  const owned = new Set([].concat(...((bgNow && bgNow.feats) || []).map(o => Object.keys(o))).map(k => String(k).split(/[|;]/)[0].trim().toLowerCase()));
  const feats = (pc.feats || []).map(x => String((x && x.name) || x)).filter(n => !/^\d+:/.test(n)).map(n => sktRulesFeat(R, n)).filter(Boolean)
    .filter((f, i, a) => a.indexOf(f) === i && f.name !== 'Ability Score Improvement' && !owned.has(lc(f.name)));
  if (feats.some(f => sktIsLegacy(b, f))) b.legacy = true;
  const cat = f => String(f.category || '').split(':')[0];
  const fs = feats.filter(f => cat(f) === 'FS');
  if (fs.length){
    const o = sktOptionalChoices(b, R).find(x => x.kind === 'feat' && (x.types || []).some(t => t.split(':')[0] === 'FS'));
    if (o) b.optional[o.name] = fs.map(f => f.name).slice(0, o.count);
  }
  const origin = feats.filter(f => cat(f) === 'O');
  if (origin.length) b.originFeat = origin[0].name;
  const general = feats.filter(f => !fs.includes(f) && !(origin[0] === f));
  sktAsiSlots(b, R).forEach((slot, i) => { if (general[i]) b.asi[slot.key] = { type: 'feat', feat: general[i].name }; });
  // A feat that grants skills (the 2024 Noble's Skilled) takes the ones still
  // unexplained; what it has to spare goes on tools, which move no numbers.
  { const rec0 = sktComputeCharacter(b, R);
    sktBuildFeatNames(b, R).forEach(n => { const f = sktRulesFeat(R, n); if (!f) return;
      sktFeatChoices(R, b, n, rec0).choices.forEach(c => {
        if (c.kind !== 'skills' && c.kind !== 'skillsTools') return;
        const sk = c.kind === 'skillsTools' ? c.options.filter(o => o.startsWith('s:')).map(o => o.slice(2)) : c.options;
        const got = left.filter(k => sk.includes(k)).slice(0, c.count);
        left = left.filter(k => !got.includes(k));
        const ch = Object.assign({}, b.featChoices[f.name], { skills: got });
        if (c.kind === 'skillsTools' && got.length < c.count) ch.tools = c.options.filter(o => o.startsWith('t:')).map(o => o.slice(2)).slice(0, c.count - got.length);
        // Skills only: ones it already has from elsewhere, which change nothing.
        else if (got.length < c.count) ch.skills = got.concat(sk.filter(k => !got.includes(k) && rec0.sheet.skillProf && rec0.sheet.skillProf[k])).slice(0, c.count);
        b.featChoices[f.name] = ch;
      }); }); }
  // A class feature that grants a skill (the 2024 barbarian's Primal Knowledge).
  sktProfChoices(b, R).forEach(c => {
    if (c.kind !== 'skills') return;
    const got = left.filter(k => c.options.includes(k)).slice(0, c.count); if (!got.length) return;
    left = left.filter(k => !got.includes(k));
    b.profPicks = Object.assign({}, b.profPicks); b.profPicks[c.feature] = Object.assign({}, b.profPicks[c.feature], { skills: got });
  });
  // Weapon masteries, as the sheet lists them.
  if (typeof sktImportedMasteries === 'function'){
    const ms = Object.keys(sktImportedMasteries(pc)).filter(n => R.items[n] && R.items[n].mastery);
    const mc = cbMasteryCount(); if (mc && ms.length) b.masteries = ms.slice(0, mc);
  }
  // Spells: the class's own; cantrips apart.
  const always = new Set(sktBuildAlwaysPrepared(b, R).map(lc));
  [...new Set(sh.spells || [])].forEach(n => {
    const s = sktRulesSpell(R, n); if (!s || always.has(lc(s.name))) return;
    if (!sktSpellOnList(s, cls.name, b)) return;
    if (s.level === 0) b.cantrips.push(s.name); else b.spells.push(s.name);
  });
  // Gear: what it carries, the weapons it attacks with, the armour its AC is made of.
  const items = (pc.inventory || []).map(x => { const m = Object.assign({}, x); delete m.pdf; return m; });
  const has = n => items.some(m => lc(m.name) === lc(n) || lc(m.base) === lc(n));
  (sh.attacks || []).forEach(a => { const k = R.items[lc(a.name)] ? lc(a.name) : cbItemName(a.name); const it = R.items[k]; if (it && /^(M|R)$/.test(String(it.type || '').split('|')[0]) && !has(k)) items.push({ name: typeof _sktTitle === 'function' ? _sktTitle(it.name) : it.name, base: k, qty: 1, weight: +it.weight || 0, equipped: true }); });
  if (typeof csPdfGearItems === 'function' && typeof csGuessPdfGear === 'function'){
    const decl = (pc.acGear && pc.acGear.decl) || csGuessPdfGear(pc, R);
    csPdfGearItems(decl, R).forEach(m => { if (!has(m.base)) { delete m.pdf; items.push(m); } });
  }
  b.items = items; b.equipment = Object.assign({}, b.equipment, { materialized: true });
  // Spells from feats and subclasses (Magic Initiate's two cantrips and a
  // 1st-level spell): the ones on the PDF, from the list the feat's name gives.
  { const mine = [...new Set(sh.spells || [])].map(n => (sktRulesSpell(R, n) || {}).name).filter(Boolean);
    const named = (pc.feats || []).map(x => (/\(([^)]+)\)/.exec(String((x && x.name) || x)) || [])[1]).filter(Boolean).map(lc);
    sktFeatSpells(b, R).forEach(g => {
      if (!g.feat || g.feat === '@species' || g.block || !(g.blocks || []).length) return;
      const bl = g.blocks.find(x => named.includes(lc(x.name)));
      if (bl) b.featChoices[g.feat] = Object.assign({}, b.featChoices[g.feat], { spellList: bl.name });
    });
    sktFeatSpells(b, R).forEach(g => {
      if (!g.feat || g.feat === '@species') return;
      const ch = b.featChoices[g.feat] = Object.assign({}, b.featChoices[g.feat]); ch.spells = (ch.spells || []).slice();
      g.choices.forEach(c => mine.filter(n => c.options.includes(n) && !ch.spells.includes(n)).slice(0, Math.max(0, c.count - c.picked.length)).forEach(n => ch.spells.push(n)));
      if (!ch.spells.length) delete ch.spells;
      // Not the class's own as well.
      b.cantrips = b.cantrips.filter(n => !(ch.spells || []).includes(n)); b.spells = b.spells.filter(n => !(ch.spells || []).includes(n));
    }); }
  // Languages the PDF lists ("=== LANGUAGES === Common, Elvish"), those the
  // character picks rather than gets.
  { const raw = typeof csPdfProfs === 'function' ? (csPdfProfs(sh.languages).languages || (/===/.test(sh.languages || '') ? '' : sh.languages)) : sh.languages;
    const list = String(raw || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean);
    const known = new Set(String(sktComputeCharacter(b, R).sheet.languages || '').split(', ').map(lc));
    const opts = sktLanguageOptions(R, Object.assign({}, b, { allBooks: true }));
    const n = cbLanguageCount();
    if (n) b.languages = list.map(x => opts.find(o => lc(o) === lc(x))).filter(x => x && !known.has(lc(x))).slice(0, n); }
  // Feature options the features text names: "Primal Order … Warden".
  { const text = String((sh.bio || {}).features || '');
    sktBuildChoices(b, R).forEach(c => {
      const at = text.search(new RegExp(_sktEsc(c.feature), 'i')); if (at < 0) return;
      const win = text.slice(at, at + 2500);
      const hit = (c.spec.options || []).map(o => ({ o, i: win.search(new RegExp('\\b' + _sktEsc(String(o.label || o.value)) + '\\b', 'i')) })).filter(x => x.i >= 0).sort((x, y) => x.i - y.i)[0];
      if (hit){ b.featureChoices = Object.assign({}, b.featureChoices, { [c.feature]: hit.o.value }); }
    }); }
  // The rest, as for a new character.
  b.abilities.method = 'manual';
  cbQuickBuild();
  // Too many spells for the slots it has now (or a spell list the PDF mixed): keep what fits.
  const sc = sktBuildSpellcasting(b, R, sktBuildAbilities(b, R));
  if (sc){ const s0 = (sc.classes ? sc.classes[0].sc : sc) || {};
    if (s0.cantrips != null && b.cantrips.length > s0.cantrips) b.cantrips = b.cantrips.slice(0, s0.cantrips);
    const w = s0.prepared || s0.known; if (w && b.spells.length > w) b.spells = b.spells.slice(0, w);
    if (s0.spellbook && (b.spellbook || []).length < b.spells.length) b.spellbook = [...new Set((b.spellbook || []).concat(b.spells))]; }
  // Base scores worked backwards: final − every increase the builder adds.
  b.abilities.method = 'manual';
  SKT_ABS.forEach(k => { b.abilities.base[k] = 10; });
  const add = sktBuildAbilities(b, R);
  SKT_ABS.forEach(k => { const f = parseInt((pc.abilities || {})[k], 10); if (!isNaN(f)) b.abilities.base[k] = f - (add[k] - 10); });
  // Hit points: the average if that's what the sheet has, else its number.
  b.hp = { method: 'average', rolls: {} };
  if (sktComputeCharacter(b, R).hpMax !== +pc.hpMax && +pc.hpMax > 0) b.hp = { method: 'manual', manual: +pc.hpMax, rolls: {} };
  CB.convertNotes = notes;
  CB.convertDiff = cbImportDiff(pc, sktComputeCharacter(b, R, pc));
}
// At the top of the review: where this came from, and what to check.
function cbConvertNote(){
  const diff = CB.convertDiff || [], notes = CB.convertNotes || [];
  return '<div class="cb-convert"><b>Rebuilt from ' + cbEsc(CB.build.name) + '\u2019s imported sheet.</b> '
    + 'Every choice the builder needs is filled in from it; saving replaces the imported character with this one (Undo puts it back).'
    + (notes.length ? '<ul class="cb-convert-notes">' + notes.map(n => '<li>' + cbEsc(n) + '</li>').join('') + '</ul>' : '')
    + (diff.length ? '<div class="cb-convert-diff"><b>Not the same as the PDF</b> — change the choices behind these if the PDF is right:<ul>' + diff.map(n => '<li>' + cbEsc(n) + '</li>').join('') + '</ul></div>'
                   : '<div class="cb-convert-ok">✓ Scores, AC, hit points, saves, skills and attacks all match the PDF.</div>')
    + '</div>';
}
// What the rebuilt character works out to that the PDF doesn't say.
function cbImportDiff(pc, rec){
  const out = [], sh = pc.sheet || {}, rs = rec.sheet || {};
  const num = v => parseInt(v, 10);
  // Scores, AC, HP and DCs as numbers; bonuses signed.
  const cmp = (label, a, b) => {
    if (isNaN(num(a)) || isNaN(num(b)) || num(a) === num(b)) return;
    const f = v => /score|^AC$|HP|DC/.test(label) ? String(v) : sktSigned(v);
    out.push(label + ': PDF ' + f(num(a)) + ', builder ' + f(num(b)));
  };
  SKT_ABS.forEach(k => cmp(k.toUpperCase() + ' score', (pc.abilities || {})[k], (rec.abilities || {})[k]));
  cmp('AC', pc.ac, rec.ac);
  cmp('Max HP', pc.hpMax, rec.hpMax);
  SKT_ABS.forEach(k => cmp(k.toUpperCase() + ' save', (sh.saves || {})[k], (rs.saves || {})[k]));
  Object.keys(sh.skills || {}).forEach(k => { const key = String(k).replace(/_([a-z])/g, (m, c) => c.toUpperCase()); cmp((SKT_SKILL_LABEL && SKT_SKILL_LABEL[key]) || k, sh.skills[k], (rs.skills || {})[key]); });
  cmp('Spell save DC', sh.spellSaveDc, rs.spellSaveDc);
  const seen = new Set();
  const elsewhere = new Set([].concat(rs.spells || [], rs.cantrips || [], (rs.featureList || []).map(f => f.name), (rs.activations || []).map(a => a.name)).map(x => String(x).toLowerCase()));
  (sh.attacks || []).forEach(a => {
    const n = String(a.name).toLowerCase(); if (seen.has(n)) return; seen.add(n);
    const m = (rs.attacks || []).find(x => { const xn = String(x.name).toLowerCase(); return xn === n || xn === cbItemName(a.name); });
    if (!m && elsewhere.has(n)) return;
    if (m) cmp(a.name + ' to hit', a.atkBonus, m.atkBonus);
    else out.push(a.name + ': an attack on the PDF the builder doesn\u2019t list (add the weapon on the equipment step, or it\u2019s a feature the builder doesn\u2019t know)');
  });
  return out;
}

async function cbLoad(edition){
  CB.loading = true; cbRender();
  try { CB.R = await sktRulesLoad(edition); }
  catch(e){ CB.error = 'The rules data did not load (' + e.message + '). Check the connection and try again.'; }
  if (CB.R && !CB.build.allBooks && cbUsesOtherBooks(CB.build, CB.R)) CB.build.allBooks = true;
  if (CB.R && !CB.build.legacy && cbUsesLegacy(CB.build, CB.R)) CB.build.legacy = true;
  CB.loading = false;
  cbRender();
}

// Whether anything chosen comes from beyond the handbook — a build made
// before the switch was saved on it.
function cbUsesOtherBooks(b, R){
  const cls = sktRulesClass(R, b.cls), sub = sktRulesSubclass(cls, b.subclass);
  const sp = sktRulesSpecies(R, b.species), bg = sktBuildBackground(R, b);
  const off = x => x && x.core === false;
  return off(sub) || off(sp) || off(sp && sktSpeciesSub(sp, b)) || off(bg)
    || sktBuildFeatNames(b, R).some(n => off(sktRulesFeat(R, n)))
    || [].concat(b.cantrips || [], b.spells || [], b.spellbook || []).some(n => off(sktRulesSpell(R, n)));
}
// Whether anything chosen is legacy (2014) content.
function cbUsesLegacy(b, R){
  const cls = sktRulesClass(R, b.cls), leg = x => sktIsLegacy(b, x);
  return leg(sktRulesSubclass(cls, b.subclass)) || leg(sktRulesSpecies(R, b.species)) || leg(sktBuildBackground(R, b))
    || sktBuildFeatNames(b, R).some(n => leg(sktRulesFeat(R, n)))
    || [].concat(b.cantrips || [], b.spells || [], b.spellbook || []).some(n => leg(sktRulesSpell(R, n)));
}
// Cards for one list: the handbook's, then (with other books on) the rest
// under their own heading, each naming its book.
function cbBookCards(list, selected, attr, sub){
  const b = CB.build;
  const core = list.filter(x => x.core !== false);
  const more = list.filter(x => x.core === false && (sktBookOk(b, x) || x.name === selected));
  const card = x => ({ value: x.name, label: x.name, sub: [sub ? sub(x) : '', x.core === false ? (sktIsLegacy(b, x) ? 'Legacy · ' : '') + x.source : ''].filter(Boolean).join(' · ') });
  return cbCards(core.map(card), selected, attr)
    + (more.length ? '<h4 class="cb-books-h">Other books</h4>' + cbCards(more.map(card), selected, attr) : '');
}
function cbBooksToggle(){
  return '<label class="cb-inline"><input type="checkbox" data-cb-allbooks' + (CB.build.allBooks ? ' checked' : '') + '> Include other books</label>';
}
// Which other books, one by one.
function cbBookListHtml(){
  const b = CB.build; if (!b.allBooks || !CB.R) return '';
  const books = sktOtherBooks(CB.R);
  const on = src => !Array.isArray(b.books) || b.books.includes(src);
  return '<details class="cb-books"' + (Array.isArray(b.books) ? ' open' : '') + '><summary>Choose the books (' + (Array.isArray(b.books) ? b.books.length : books.length) + ' of ' + books.length + ')</summary>'
    + '<div class="cb-dim"><button class="btn small" data-cb-srcall="1">All</button> <button class="btn small" data-cb-srcall="0">None</button></div>'
    + '<div class="cb-checks cb-booklist">' + books.map(x => '<label class="cb-check' + (on(x.source) ? ' on' : '') + '"><input type="checkbox" data-cb-src="' + cbEsc(x.source) + '"' + (on(x.source) ? ' checked' : '') + '><span>' + cbEsc(x.name) + ' <i>' + x.count + '</i></span></label>').join('') + '</div></details>';
}

function cbMount(){
  document.getElementById('cb-root')?.remove();
  const root = document.createElement('div');
  root.id = 'cb-root'; root.className = 'cb';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Character builder');
  document.body.appendChild(root);
  root.addEventListener('click', cbAnchored(cbOnClick));
  root.addEventListener('change', cbAnchored(cbOnChange));
  root.addEventListener('input', cbAnchored(cbOnInput));
  document.addEventListener('keydown', cbOnKey);
}

// Every change redraws the step, and a redraw put you back where the old
// scroll offset pointed — wrong whenever the change grew or shrank what was
// above (Species' "Include other books" moved the checkbox 660px; a spell's
// "i" jumped to the top every time). So the control you used stays at the
// same spot on screen: found again after the redraw by its data-cb-*
// attributes and the step scrolled by however far it moved. A step change
// still starts at the top.
function cbAnchorSel(el){
  if (!el || !el.attributes) return null;
  const a = [...el.attributes].filter(x => /^data-cb/.test(x.name));
  if (!a.length) return null;
  return el.tagName.toLowerCase() + a.map(x => '[' + x.name + '="' + CSS.escape(x.value) + '"]').join('');
}
function cbAnchored(fn){
  return e => {
    const sc = document.querySelector('#cb-root .cb-main');
    const el = e.target && e.target.closest && e.target.closest('button, input, select, textarea');
    const sel = sc && el && sc.contains(el) ? cbAnchorSel(el) : null;
    const nth = sel ? [...sc.querySelectorAll(sel)].indexOf(el) : -1;
    const top = sel ? el.getBoundingClientRect().top : 0, step = CB && CB.step;
    fn(e);
    if (!sel || !CB || CB.step !== step) return;
    const sc2 = document.querySelector('#cb-root .cb-main'); if (!sc2) return;
    const m = sc2.querySelectorAll(sel), el2 = m[Math.max(0, Math.min(nth, m.length - 1))];
    if (el2 && el2 !== el) sc2.scrollTop += el2.getBoundingClientRect().top - top;
  };
}
function cbClose(){
  document.getElementById('cb-root')?.remove();
  document.removeEventListener('keydown', cbOnKey);
  CB = null;
}
function cbOnKey(e){ if (e.key === 'Escape' && CB && !document.querySelector('.modal-backdrop')) cbAskClose(); }
function cbAskClose(){
  if (!CB) return;
  const dirty = !!(CB.build.cls || CB.build.species || CB.build.name);
  if (!dirty || typeof showConfirm !== 'function'){ cbClose(); return; }
  showConfirm(CB.mode === 'create' ? 'Close the builder? This character has not been created yet.' : 'Close without saving these changes?',
              { title: 'Close builder', confirmLabel: 'Close', danger: true }).then(ok => { if (ok) cbClose(); });
}

// ── Rendering ────────────────────────────────────────────────────────────────
function cbRender(){
  const root = document.getElementById('cb-root'); if (!root || !CB) return;
  if (CB.error){ root.innerHTML = cbShell('<div class="cb-msg">' + cbEsc(CB.error) + '</div>', ''); return; }
  if (CB.loading || !CB.R){ root.innerHTML = cbShell('<div class="cb-msg">Loading the ' + CB.build.edition + ' rules…</div>', ''); return; }
  const rec = sktComputeCharacter(CB.build, CB.R, CB.idx != null ? state.party[CB.idx] : null);
  CB.rec = rec;
  const main = (CB_RENDER[CB.step] || CB_RENDER.basics)();
  root.innerHTML = cbShell(main, cbSide(rec));
  const sc = root.querySelector('.cb-main'); if (sc && CB.scrollTop != null){ sc.scrollTop = CB.scrollTop; CB.scrollTop = null; }
}

function cbShell(main, side){
  const todo = CB && CB.R ? sktBuildTodo(CB.build, CB.R) : [];
  const count = id => todo.filter(t => t.step === id && !t.soft).length;
  const steps = cbVisibleSteps().map(s => {
    const n = count(s.id);
    return '<button class="cb-step' + (CB.step === s.id ? ' on' : '') + '" data-cb-step="' + s.id + '">' + cbEsc(s.label)
      + (n ? '<span class="cb-step-n" title="' + n + ' still to choose">' + n + '</span>' : '') + '</button>';
  }).join('');
  const title = CB.mode === 'levelup' ? 'Level up — ' + cbEsc(CB.build.name || 'character') + ' to level ' + CB.build.level
              : CB.mode === 'edit' ? 'Edit ' + cbEsc(CB.build.name || 'character') : 'New character';
  const vis = cbVisibleSteps(), at = vis.findIndex(s => s.id === CB.step);
  const last = at === vis.length - 1;
  const blocking = todo.filter(t => !t.soft);
  return '<div class="cb-head"><b class="cb-title">' + title + '</b>'
    + '<span class="cb-ed">' + (CB.build.edition === '2014' ? '2014 rules' : CB.build.legacy ? '2024 rules + legacy' : '2024 rules') + '</span>'
    + '<button class="cb-x" data-cb="close" aria-label="Close">✕</button></div>'
    + '<nav class="cb-steps">' + steps + '</nav>'
    + '<div class="cb-body"><div class="cb-main">' + main + '</div>'
    + (side ? '<aside class="cb-side">' + side + '</aside>' : '') + '</div>'
    + '<div class="cb-foot">'
    +   '<button class="btn" data-cb="back"' + (at <= 0 ? ' disabled' : '') + '>‹ Back</button>'
    +   '<span class="cb-foot-todo">' + (blocking.length ? blocking.length + ' still to choose' : 'Everything chosen') + '</span>'
    +   (last ? (CB.mode === 'create' && typeof openCharSheet === 'function' ? '<button class="btn" data-cb="save">Create</button><button class="btn primary" data-cb="savesheet">Create and open the sheet</button>'
                  : '<button class="btn primary" data-cb="save">' + (CB.mode === 'create' ? 'Create character' : 'Save changes') + '</button>')
             : '<button class="btn primary" data-cb="next">Next ›</button>')
    + '</div>';
}

// Steps that have nothing to ask are skipped: no Spells for a fighter, no
// Levels page for a level 1 character with no choices there.
function cbVisibleSteps(){
  if (!CB || !CB.R) return CB_STEPS;
  const cls = sktRulesClass(CB.R, CB.build.cls);
  const sc = cls ? sktBuildSpellcasting(CB.build, CB.R, sktBuildAbilities(CB.build, CB.R)) : null;
  const hasLevels = (CB.build.level || 1) > 1 || sktOptionalChoices(CB.build, CB.R).length || cbMasteryCount() > 0
    || (cls && sktBuildChoices(CB.build, CB.R).length);
  return CB_STEPS.filter(s => (s.id !== 'spells' || sc) && (s.id !== 'levels' || hasLevels || !cls));
}

// The live sheet beside every step.
function cbClassLabel(rec){
  const cl = (rec.sheet && rec.sheet.classLevels) || [];
  if (cl.length > 1) return cl.map(p => _sktTitle(p.cls) + ' ' + p.level).join(' / ');
  const cls = sktRulesClass(CB.R, CB.build.cls);
  return cls ? cls.name + ' ' + rec.level : '';
}
function cbSide(rec){
  const b = CB.build, R = CB.R;
  const cls = sktRulesClass(R, b.cls);
  const ab = rec.abilities;
  const abil = SKT_ABS.map(k => '<div class="cb-ab"><span>' + k.toUpperCase() + '</span><b>' + ab[k] + '</b><i>' + sktSigned(sktMod(ab[k])) + '</i></div>').join('');
  const todo = sktBuildTodo(b, R);
  return '<div class="cb-sheet">'
    + '<div class="cb-sheet-name">' + cbEsc(rec.icon) + ' ' + cbEsc(b.name || 'Unnamed') + '</div>'
    + '<div class="cb-sheet-sub">' + cbEsc([rec.race, cbClassLabel(rec), rec.subclass].filter(Boolean).join(' · ') || 'Choose a species and a class') + '</div>'
    + '<div class="cb-big"><div><span>AC</span><b>' + rec.ac + '</b></div><div><span>HP</span><b>' + rec.hpMax + '</b></div>'
    + '<div><span>Init</span><b>' + sktSigned(rec.init) + '</b></div><div><span>Speed</span><b>' + rec.spd + '</b></div>'
    + '<div><span>Prof</span><b>+' + rec.sheet.profBonus + '</b></div></div>'
    + '<div class="cb-abs">' + abil + '</div>'
    + (rec.sheet.acSource ? '<div class="cb-dim">AC from ' + cbEsc(rec.sheet.acSource) + '</div>' : '')
    // The rest of what D&D Beyond's summary shows as you build.
    + '<div class="cb-sidefacts">'
    +   '<div><span>Passive Perception</span><b>' + rec.sheet.passivePerception + '</b></div>'
    +   (rec.sheet.spellSaveDc ? '<div><span>Spell save DC</span><b>' + rec.sheet.spellSaveDc + '</b></div><div><span>Spell attack</span><b>' + cbEsc(rec.sheet.spellAtkBonus) + '</b></div>' : '')
    +   (rec.sheet.size ? '<div><span>Size</span><b>' + cbEsc(rec.sheet.size) + '</b></div>' : '')
    +   (rec.sheet.senses ? '<div><span>Senses</span><b>' + cbEsc(rec.sheet.senses) + '</b></div>' : '')
    +   (rec.sheet.languages ? '<div><span>Languages</span><b>' + cbEsc(rec.sheet.languages) + '</b></div>' : '')
    + '</div>'
    + (todo.length ? '<div class="cb-todo"><b>Still to choose</b>' + todo.map(t => '<div class="cb-todo-i' + (t.soft ? ' soft' : '') + '" data-cb-step="' + t.step + '">' + cbEsc(t.what) + '</div>').join('') + '</div>' : '<div class="cb-done">✓ Ready</div>')
    + '</div>';
}

// ── Small UI pieces ──────────────────────────────────────────────────────────
function cbCards(items, selected, attr, extra){
  return '<div class="cb-cards">' + items.map(it => {
    const on = selected === it.value;
    return '<button class="cb-card' + (on ? ' on' : '') + '" data-' + attr + '="' + cbEsc(it.value) + '">'
      + '<b>' + cbEsc(it.label) + '</b>' + (it.sub ? '<span>' + cbEsc(it.sub) + '</span>' : '') + '</button>';
  }).join('') + '</div>' + (extra || '');
}
// A checklist with a limit. `locked` are shown ticked and cannot be changed
// (granted by something else); `max` counts only the free picks.
function cbChecks(options, chosen, max, attr, locked){
  locked = locked || {};
  const free = chosen.filter(v => !locked[v]);
  const full = max != null && free.length >= max;
  return '<div class="cb-checks">' + options.map(o => {
    const v = typeof o === 'string' ? o : o.value, label = typeof o === 'string' ? o : o.label;
    const lock = locked[v];
    const on = !!lock || chosen.includes(v);
    const dis = lock || (!on && full);
    return '<label class="cb-check' + (on ? ' on' : '') + (dis && !on ? ' dim' : '') + '">'
      + '<input type="checkbox" data-' + attr + '="' + cbEsc(v) + '"' + (on ? ' checked' : '') + (dis ? ' disabled' : '') + '>'
      + '<span>' + cbEsc(label) + (lock ? ' <i>' + cbEsc(lock) + '</i>' : '') + '</span></label>';
  }).join('') + '</div>';
}
function cbCounter(have, want, what){
  const ok = have >= want, over = have > want;
  return '<div class="cb-counter' + (over ? ' over' : ok ? ' ok' : '') + '">' + have + ' / ' + want + ' ' + cbEsc(what) + (over ? ' — remove ' + (have - want) : '') + '</div>';
}
function cbFeatureText(text, open){
  const t = String(text || '').trim(); if (!t) return '';
  return '<details class="cb-ft"' + (open ? ' open' : '') + '><summary>What it does</summary><div>' + cbEsc(t).replace(/\n/g, '<br>') + '</div></details>';
}
function cbAbLabel(k){ return SKT_AB_NAME[k] || k; }

// ── Steps ────────────────────────────────────────────────────────────────────
const CB_RENDER = {};

CB_RENDER.basics = () => {
  const b = CB.build;
  const icons = ['⚔', '🗡', '🏹', '🪓', '🛡', '🔥', '✨', '🌿', '🎵', '👊', '📘', '👁', '🐉', '🌙'];
  return '<h3>Basics</h3>'
    + '<div class="cb-quick"><button class="btn primary" data-cb="quick">⚡ Quick build</button><span class="cb-dim">Fills in every choice you haven’t made — scores, skills, spells, gear — with sensible picks for the class. Change anything after.</span></div>'
    + '<div class="cb-row"><label class="cb-f cb-grow">Name<input data-cb-in="name" value="' + cbEsc(b.name) + '" placeholder="Character name" maxlength="60"></label>'
    + '<label class="cb-f">Level<input type="number" min="1" max="20" data-cb-in="level" value="' + (b.level || 1) + '"' + (CB.mode === 'levelup' ? ' disabled' : '') + '></label></div>'
    + '<div class="cb-f">Rules'
    + (b.edition === '2014'
      ? '<div class="cb-note">Built on the 2014 rules throughout. <button class="btn small" data-cb-ed="2024">Use the 2024 rules</button></div>'
        + '<div class="cb-dim">The 2024 rules can still use 2014 options with Legacy content on' + (CB.convertFrom ? '; the sheet is read again' : ' — the name and level are kept, other choices are cleared') + '.</div>'
      : '<label class="cb-inline cb-legacy"><input type="checkbox" data-cb-legacy' + (b.legacy ? ' checked' : '') + '> Legacy content</label>'
        + '<div class="cb-dim">The 2024 rules, as D&D Beyond plays them. Legacy content adds the 2014 options beside them — the Half-Elf, 2014 feats, subclasses and spells; where a 2024 version exists, that one is used.</div>')
    + '</div>'
    + '<div class="cb-f">Books' + cbBooksToggle() + cbBookListHtml()
    +   '<div class="cb-dim">Species, backgrounds, feats, spells and subclasses from the other ' + (b.edition === '2014' ? '2014-era books — Xanathar’s, Tasha’s, Monsters of the Multiverse, the setting books' : '2024-era books — Heroes of Faerûn, Eberron, and older species and spells the 2024 rules allow') + '. Their own rules show as text where the sheet can’t apply them.</div></div>'
    + '<div class="cb-f">Portrait<div class="cb-icons">' + (/^data:image|^img\/|^https?:/.test(String(b.icon || '')) ? '<span class="cb-portrait on">' + renderIcon(b.icon, b.name) + '</span>' : '')
    +   '<button class="cb-upload" data-cb="upload" title="Upload a picture">📷 Upload</button>'
    +   icons.map(i => '<button class="' + (b.icon === i ? 'on' : '') + '" data-cb-icon="' + i + '">' + i + '</button>').join('') + '</div></div>'
    + '<label class="cb-f">Levelling<select class="cb-sel" data-cb-advance><option value="milestone"' + (b.advancement !== 'xp' ? ' selected' : '') + '>Milestone — the DM says when</option>'
    +   '<option value="xp"' + (b.advancement === 'xp' ? ' selected' : '') + '>Experience points</option></select></label>';
};

CB_RENDER.class = () => {
  const b = CB.build, R = CB.R;
  const cls = sktRulesClass(R, b.cls);
  const cards = R.classes.map(c => ({ value: c.name, label: c.name,
    sub: 'd' + c.hd + ' · saves ' + c.saves.map(s => s.toUpperCase()).join('/') + (c.core === false ? ' · ' + ((R.bookNames || {})[c.source] || c.source) : '') }));
  let html = '<h3>Class</h3>' + cbCards(cards, cls && cls.name, 'cb-cls');
  if (cls){
    const lvl1 = cls.features.filter(f => f.level === 1 && !/Proficiencies/.test(f.name)).map(f => f.name).join(', ');
    html += '<div class="cb-note"><b>' + cbEsc(cls.name) + '</b> — at level 1: ' + cbEsc(lvl1) + '.</div>' + cbClassTableHtml(cls);
    const title = sktRulesInline(cls.subclassTitle);
    if (sktClassLevels(b, R)[0].level >= cls.subclassLevel){
      const subs = cls.subclasses.filter(s => s.core || sktBookOk(b, Object.assign({ core: false }, s)) || s.shortName === b.subclass)
        .filter((s, i, a) => { const same = a.filter(x => x.shortName === s.shortName); const pick = sktRulesSubclass(cls, s.shortName); return same.includes(pick) ? s === pick : same[0] === s; })
        .map(s => ({ value: s.shortName, label: s.shortName, sub: s.core ? '' : s.source }));
      html += '<h4>' + cbEsc(title) + '</h4>' + cbCards(subs, b.subclass, 'cb-sub')
        + cbBooksToggle();
      const sub = sktRulesSubclass(cls, b.subclass);
      const pk = sktSubclassSpellPick(sub);
      if (pk) html += '<h4>' + cbEsc(pk.label) + '</h4>' + cbCards(pk.options.map(o => ({ value: o.value, label: o.value })), b.subclassPick, 'cb-subpick');
      if (sub) html += sub.features.filter(f => f.level <= b.level).map(f => '<div class="cb-feat"><b>' + cbEsc(f.name) + '</b> <span class="cb-dim">level ' + f.level + '</span>' + cbFeatureText(sktRulesText(f.entries)) + '</div>').join('');
    } else {
      html += '<div class="cb-dim">' + cbEsc(title) + ' is chosen at level ' + cls.subclassLevel + '.</div>';
    }
    if (R.edition === '2014' && cls.features.some(f => f.optional)){
      const on = !!b.optionalFeatures;
      html += '<h4>Optional class features</h4><label class="cb-inline"><input type="checkbox" data-cb-optfeat' + (on ? ' checked' : '') + '> Use Tasha’s optional class features</label>';
      if (on) html += cls.features.filter(f => f.optional && f.level <= (b.level || 1)).map(f => '<div class="cb-feat"><b>' + cbEsc(f.name) + '</b> <span class="cb-dim">level ' + f.level + (f.replaces ? ' · replaces ' + cbEsc(f.replaces) : '') + '</span>' + cbFeatureText(sktRulesText(f.entries)) + '</div>').join('');
    }
    html += cbMulticlassHtml();
  }
  return html;
};
// The class table, as the book prints it: proficiency bonus, features and
// the class's own columns (rages, sneak attack, spell slots…) by level.
function cbClassTableHtml(cls){
  const b = CB.build, L = sktClassLevels(b, CB.R)[0].level;
  const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
  const heads = [];
  (cls.tableGroups || []).forEach(g => (g.colLabels || []).forEach((l, i) => heads.push({ g, i, label: sktRulesInline(String(l)) || ORD[i] })));
  const cell = (h, lv) => { const rows = h.g.rows || h.g.rowsSpellProgression || []; const c = _sktCell((rows[lv - 1] || [])[h.i]); return c == null || c === 0 ? '—' : c; };
  let t = '<table class="cb-ctable"><thead><tr><th>Level</th><th>Prof.</th><th>Features</th>' + heads.map(h => '<th>' + cbEsc(String(h.label)) + '</th>').join('') + '</tr></thead><tbody>';
  for (let lv = 1; lv <= 20; lv++){
    const fs = cls.features.filter(f => f.level === lv && (!f.optional || b.optionalFeatures)).map(f => f.name);
    t += '<tr' + (lv === L ? ' class="on"' : '') + '><td>' + lv + '</td><td>+' + sktProfBonus(lv) + '</td><td>' + cbEsc(fs.join(', ') || '—') + '</td>'
      + heads.map(h => '<td>' + cbEsc(String(cell(h, lv))) + '</td>').join('') + '</tr>';
  }
  return '<details class="cb-ctwrap"><summary>The ' + cbEsc(cls.name) + ' table</summary><div class="cb-ctscroll">' + t + '</tbody></table></div></details>';
}
// More classes: each with its levels (taken from the first class), its
// subclass when it reaches one, and the skill some classes give. The
// character's total level stays what Basics says. There was no
// multiclassing before.
function cbMulticlassHtml(){
  const b = CB.build, R = CB.R;
  const parts = sktClassLevels(b, R);
  const ab = sktBuildAbilities(b, R);
  const first = parts[0];
  let h = '<h4>Multiclass</h4>';
  if (parts.length === 1 && (b.level || 1) < 2) return h + '<div class="cb-dim">From 2nd level a character can take levels in another class.</div>';
  h += '<div class="cb-mc"><div class="cb-mc-row"><b>' + cbEsc(_sktTitle(first.cls)) + '</b><span class="cb-dim">' + first.level + ' level' + (first.level === 1 ? '' : 's') + ' — the rest of the character’s ' + (b.level || 1) + '</span></div>';
  parts.slice(1).forEach((p, i) => {
    const c2 = sktRulesClass(R, p.cls);
    const ok = sktMulticlassOk(R, p.cls, ab) && sktMulticlassOk(R, b.cls, ab);
    h += '<div class="cb-mc-row"><b>' + cbEsc(c2.name) + '</b>'
      + '<span class="cb-counter-ctl"><button class="btn small" data-cb-mclvl="' + i + ':-1"' + (p.level <= 1 ? ' disabled' : '') + ' aria-label="One level less">−</button>'
      + '<span>' + p.level + '</span><button class="btn small" data-cb-mclvl="' + i + ':1"' + (first.level <= 1 ? ' disabled' : '') + ' aria-label="One level more">+</button></span>'
      + '<button class="btn small" data-cb-mcdel="' + i + '">Remove</button></div>';
    if (!ok) h += '<div class="cb-warn">Multiclassing asks for ' + cbEsc([sktMulticlassNeedText(R, b.cls), sktMulticlassNeedText(R, p.cls)].filter(Boolean).join('; ')) + '. The sheet allows it anyway.</div>';
    if (p.level >= c2.subclassLevel){
      const subs = c2.subclasses.filter(s => s.core || sktBookOk(b, Object.assign({ core: false }, s)) || s.shortName === p.subclass)
        .filter((s, k, a) => { const same = a.filter(x => x.shortName === s.shortName); const pick = sktRulesSubclass(c2, s.shortName); return same.includes(pick) ? s === pick : same[0] === s; })
        .map(s => ({ value: i + '||' + s.shortName, label: s.shortName, sub: s.core ? '' : s.source }));
      h += cbCards(subs, p.subclass ? i + '||' + p.subclass : '', 'cb-mcsub');
      // Its land, affinity or kind of genie.
      const pk = sktSubclassSpellPick(sktRulesSubclass(c2, p.subclass)), cur = (p.entry || {}).subclassPick;
      if (pk) h += '<div class="cb-dim">' + cbEsc(pk.label) + '</div>' + cbCards(pk.options.map(o => ({ value: i + '||' + o.value, label: o.value })), cur ? i + '||' + cur : '', 'cb-mcpick');
    }
    const sk = _sktSkillChoice(((c2.multiclassing || {}).proficienciesGained || {}).skills);
    if (sk.count){
      h += '<div class="cb-dim">' + cbEsc(c2.name) + ' gives ' + sk.count + ' skill' + (sk.count === 1 ? '' : 's') + '.</div>'
        + cbChecks(sk.from.map(k => ({ value: i + '||' + k, label: SKT_SKILL_LABEL[k] })), ((p.entry || {}).skills || []).map(k => i + '||' + k), sk.count, 'cb-mcskill');
    }
  });
  h += '</div>';
  const taken = new Set(parts.map(p => p.key));
  if (first.level > 1){
    h += '<label class="cb-f">Add a class<select class="cb-sel" data-cb-mcadd><option value="">Choose…</option>'
      + R.classes.filter(c => !taken.has(c.key)).map(c => '<option value="' + cbEsc(c.name) + '">' + cbEsc(c.name) + (sktMulticlassOk(R, c.name, ab) ? '' : ' (needs ' + cbEsc(sktMulticlassNeedText(R, c.name)) + ')') + '</option>').join('') + '</select></label>';
  } else h += '<div class="cb-dim">Raise the character’s level on Basics to add another class.</div>';
  return h;
}
// Keep the classes' levels within the character's: the first class always
// has at least one.
function cbFitLevels(b){
  b.multi = (b.multi || []).filter(m => m && m.cls && m.cls !== b.cls);
  let over = b.multi.reduce((n, m) => n + Math.max(1, +m.level || 1), 0) - ((b.level || 1) - 1);
  for (let i = b.multi.length - 1; i >= 0 && over > 0; i--){
    const m = b.multi[i], cut = Math.min(over, Math.max(1, +m.level || 1));
    if (cut >= m.level) { b.multi.splice(i, 1); over -= m.level; }
    else { m.level -= cut; over -= cut; }
  }
}

CB_RENDER.species = () => {
  const b = CB.build, R = CB.R;
  const sp = sktRulesSpecies(R, b.species);
  let html = '<h3>Species</h3>' + cbBookCards(R.species, b.species, 'cb-species',
    s => (typeof s.speed === 'number' ? s.speed : (s.speed && s.speed.walk) || 30) + ' ft' + (s.darkvision ? ' · darkvision' : '')) + cbBooksToggle();
  if (!sp) return html;
  const subs = sp.subraces.filter(s => sktBookOk(b, s) || s.name === b.subspecies);
  if (subs.length){
    html += '<h4>' + (R.edition === '2014' ? 'Subrace' : 'Lineage') + '</h4>' + cbCards(subs.map(s => ({ value: s.name, label: s.name, sub: s.core === false ? s.source : '' })), b.subspecies, 'cb-subspecies');
  }
  // 2024 lineages that live in additionalSpells (Elf, Gnome, Tiefling).
  const lineages = (R.edition === '2024' && Array.isArray(sp.additionalSpells) && sp.additionalSpells.length > 1)
    ? sp.additionalSpells.map(x => x.name).filter(Boolean) : [];
  if (lineages.length){
    html += '<h4>Lineage</h4>' + cbCards(lineages.map(n => ({ value: n, label: n })), b.speciesChoice.lineage, 'cb-lineage');
  }
  // Draconic ancestry, or the damage resistance the species lets you pick.
  const rc = sktSpeciesResistChoice(sp, sktSpeciesSub(sp, b));
  if (rc){
    const cur = rc.kind === 'ancestry' ? b.speciesChoice.ancestry : b.speciesChoice.resist;
    html += '<h4>' + (rc.kind === 'ancestry' ? 'Draconic ancestry' : 'Damage resistance') + '</h4>'
      + cbCards(rc.options.map(o => ({ value: o.name, label: _sktTitle(o.name), sub: rc.kind === 'ancestry' ? _sktTitle(o.damage) : '' })), cur, rc.kind === 'ancestry' ? 'cb-ancestry' : 'cb-spresist');
  }
  // Small or Medium, where the species leaves it to you (2024 Human, Tiefling, Aasimar).
  if (Array.isArray(sp.size) && sp.size.length > 1){
    const cur = sp.size.includes(b.size) ? b.size : (sp.size.includes('M') ? 'M' : sp.size[0]);
    const NAME = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large' };
    html += '<h4>Size</h4><div class="cb-seg">' + sp.size.map(z => '<button class="' + (cur === z ? 'on' : '') + '" data-cb-size="' + z + '">' + NAME[z] + '</button>').join('') + '</div>';
  }
  // Choosable ability increases (2014: Half-Elf, Variant Human…).
  const sub = sktSpeciesSub(sp, b);
  if (R.edition === '2014'){
    html += '<label class="cb-inline cb-tasha"><input type="checkbox" data-cb-customorigin' + ((b.speciesChoice || {}).customOrigin ? ' checked' : '') + '> Customizing Your Origin (Tasha’s): place the ability increases yourself</label>';
  }
  const ch = R.edition === '2014' ? sktSpeciesAsiChoice(sp, sub, b) : null;
  if (ch && ch.flex){
    // Monsters of the Multiverse and later: +2 and +1, or three +1s, anywhere.
    const mode = b.speciesChoice.asiMode || '21', inc = b.speciesAsi || {};
    html += '<h4>Ability increases</h4><div class="cb-dim">Increase one score by 2 and another by 1, or three scores by 1.</div>'
      + '<div class="cb-seg"><button class="' + (mode === '21' ? 'on' : '') + '" data-cb-spmode="21">+2 / +1</button><button class="' + (mode === '111' ? 'on' : '') + '" data-cb-spmode="111">+1 / +1 / +1</button></div>';
    if (mode === '21'){
      const two = Object.keys(inc).find(k => inc[k] === 2) || '', one = Object.keys(inc).find(k => inc[k] === 1) || '';
      const sel = (amt, cur) => '<select class="cb-sel" data-cb-spflex="' + amt + '"><option value="">—</option>'
        + SKT_ABS.map(k => '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + cbAbLabel(k) + '</option>').join('') + '</select>';
      html += '<div class="cb-row"><label class="cb-f">+2' + sel(2, two) + '</label><label class="cb-f">+1' + sel(1, one) + '</label></div>';
    } else {
      html += cbChecks(SKT_ABS.map(k => ({ value: k, label: cbAbLabel(k) })), Object.keys(inc), 3, 'cb-spasi');
    }
  } else if (ch){
    const picked = Object.keys(b.speciesAsi || {});
    html += '<h4>Ability increases</h4><div class="cb-dim">Choose ' + ch.count + ' to increase by ' + ch.amount + '.</div>'
      + cbChecks(ch.from.map(k => ({ value: k, label: cbAbLabel(k) })), picked, ch.count, 'cb-spasi');
  }
  // Species skill picks.
  const skillPick = cbSpeciesSkillChoice(sp, sub);
  if (skillPick){
    html += '<h4>Skills</h4><div class="cb-dim">Choose ' + skillPick.count + '.</div>'
      + cbChecks(skillPick.from.map(k => ({ value: k, label: SKT_SKILL_LABEL[k] })), b.speciesSkills || [], skillPick.count, 'cb-spskill');
  }
  // A bonus feat: 2014 Variant Human; 2024 Human (Versatile, an origin feat).
  if ((R.edition === '2014' && ((sub && /variant/i.test(sub.name)) || cbSpeciesGivesFeat(sp, sub))) || (R.edition === '2024' && sp.name === 'Human')){
    const others = new Set(sktBuildFeatNames(Object.assign({}, b, { originFeat: '' }), R));
    const pool = R.feats.filter(f => (R.edition === '2014' ? true : f.category === 'O') && (sktBookOk(b, f) || f.name === b.originFeat)
      && (f.repeatable || f.name === b.originFeat || !others.has(f.name)));
    html += '<h4>' + (R.edition === '2024' ? 'Versatile — an origin feat' : 'Feat') + '</h4>'
      + '<select class="cb-sel" data-cb-originfeat><option value="">Choose a feat…</option>'
      + pool.map(f => '<option' + (b.originFeat === f.name ? ' selected' : '') + '>' + cbEsc(f.name) + '</option>').join('') + '</select>'
      + (b.originFeat ? cbFeatChoicesHtml(b.originFeat) + cbFeatureText(sktRulesText((sktRulesFeat(R, b.originFeat) || {}).entries)) : '');
  }
  // The species' spells (a Tiefling's legacy, a High Elf's cantrip…).
  const spg = sktSpeciesSpellGrant(R, b);
  if (spg && spg.block) html += cbGrantHtml(spg, '@species', 'Spells');
  html += '<h4>Traits</h4>' + [sp].concat(sub ? [sub] : []).map(s => (s.entries || []).filter(e => e && e.name && e.entries && !(s === sp && sub && (sub.replaces || []).includes(sktRulesInline(e.name))))
    .map(e => '<div class="cb-feat"><b>' + cbEsc(sktRulesInline(e.name)) + '</b>' + cbFeatureText(sktRulesText(e.entries)) + '</div>').join('')).join('');
  return html;
};
function cbSpeciesGivesFeat(sp, sub){
  return [sp, sub].some(s => s && (s.feats || []).some(f => f && f.any));
}
function cbSpeciesSkillChoice(sp, sub){
  for (const list of [sub && sub.skills, (sub && (sub.overrides || []).includes('skills')) ? null : sp.skills]){
    for (const s of (list || [])){
      if (s.any) return { from: Object.keys(SKT_SKILLS), count: s.any };
      if (s.choose) return { from: (s.choose.from || []).map(sktSkillKey).filter(Boolean), count: s.choose.count || 1 };
    }
  }
  // 2024 Human: Skillful (one skill); 2024 Elf: Keen Senses (one of three).
  if (CB.R.edition === '2024' && sp.name === 'Human') return { from: Object.keys(SKT_SKILLS), count: 1 };
  if (CB.R.edition === '2024' && sp.name === 'Elf') return { from: ['insight', 'perception', 'survival'], count: 1 };
  // Eberron's Khoravar (the 2024 half-elf): Skill Versatility, one skill (or tool).
  if (sp.name === 'Khoravar' && (sp.entries || []).some(e => e && e.name === 'Skill Versatility')) return { from: Object.keys(SKT_SKILLS), count: 1 };
  return null;
}

CB_RENDER.background = () => {
  const b = CB.build, R = CB.R;
  const bg = sktBuildBackground(R, b);
  const skillsOf = x => (x.skills || []).flatMap(o => Object.keys(o).filter(k => o[k] === true).map(k => SKT_SKILL_LABEL[sktSkillKey(k)] || k));
  let html = '<h3>Background</h3>' + cbBookCards(R.backgrounds, b.background, 'cb-bg', x => skillsOf(x).join(', '))
    + cbCards([{ value: SKT_CUSTOM_BG, label: 'Custom background', sub: 'your own' }], b.background, 'cb-bg') + cbBooksToggle();
  if (b.background === SKT_CUSTOM_BG) html += cbCustomBgHtml();
  if (!bg) return html;
  if (R.edition === '2024' && Array.isArray(bg.ability)){
    const from = ((bg.ability[0] || {}).choose || {}).weighted ? bg.ability[0].choose.weighted.from : SKT_ABS;
    const mode = b.bgAsiMode || '21';
    html += '<h4>Ability increases</h4><div class="cb-dim">Increase one of these by 2 and another by 1, or all three by 1.</div>'
      + '<div class="cb-seg"><button class="' + (mode === '21' ? 'on' : '') + '" data-cb-bgmode="21">+2 / +1</button><button class="' + (mode === '111' ? 'on' : '') + '" data-cb-bgmode="111">+1 / +1 / +1</button></div>';
    if (mode === '21'){
      const plus2 = Object.keys(b.bgAsi).find(k => b.bgAsi[k] === 2) || '';
      const plus1 = Object.keys(b.bgAsi).find(k => b.bgAsi[k] === 1) || '';
      const opt = (sel, not) => from.map(k => '<option value="' + k + '"' + (sel === k ? ' selected' : '') + (k === not ? ' disabled' : '') + '>' + cbAbLabel(k) + '</option>').join('');
      html += '<div class="cb-row"><label class="cb-f">+2<select class="cb-sel" data-cb-bg2><option value="">—</option>' + opt(plus2, plus1) + '</select></label>'
            + '<label class="cb-f">+1<select class="cb-sel" data-cb-bg1><option value="">—</option>' + opt(plus1, plus2) + '</select></label></div>';
    } else {
      html += '<div class="cb-dim">' + from.map(cbAbLabel).join(', ') + ' each +1.</div>';
    }
    const feat = sktBuildFeatNames({ ...b, originFeat: '', asi: {} }, R)[0];
    if (feat) html += '<h4>Origin feat — ' + cbEsc(feat) + '</h4>' + cbFeatChoicesHtml(feat) + cbFeatureText(sktRulesText((sktRulesFeat(R, feat) || {}).entries), false);
  }
  if (R.edition === '2014' && Array.isArray(bg.feats) && bg.feats.length){
    const names = bg.feats.map(o => _sktTitle(String(Object.keys(o).find(k => o[k] === true) || '').split('|')[0]));
    const feat = names[Math.min(Math.max(0, +b.bgFeat || 0), names.length - 1)];
    html += '<h4>Feat — ' + (names.length > 1 ? '<select class="cb-sel" data-cb-bgfeat>' + names.map((n, i) => '<option value="' + i + '"' + (n === feat ? ' selected' : '') + '>' + cbEsc(n) + '</option>').join('') + '</select>' : cbEsc(feat)) + '</h4>'
      + (feat ? cbFeatChoicesHtml(feat) + cbFeatureText(sktRulesText((sktRulesFeat(R, feat) || {}).entries), false) : '');
  }
  html += '<div class="cb-note">Skills: ' + cbEsc(skillsOf(bg).join(', ') || '—') + '</div>';
  html += _sktTraitsHtml(bg.entries);
  return html;
};
// Your own background: a name, two skills, tools or languages, a feature
// (2014); three abilities, an origin feat, a tool (2024); a kit borrowed
// from a printed background, or the gold instead.
function cbCustomBgHtml(){
  const b = CB.build, R = CB.R, c = b.customBg || {};
  const ARTS = Object.values(SKT_TOOL_SETS).reduce((a, x) => a.concat(x), []).concat(["Disguise Kit", "Forgery Kit", "Herbalism Kit", "Navigator's Tools", "Poisoner's Kit", "Thieves' Tools"]).sort();
  let h = '<div class="cb-custombg"><label class="cb-f">Name<input data-cb-cbg="name" value="' + cbEsc(c.name || '') + '" placeholder="Sailor, Smuggler, Hermit-monk…" maxlength="40"></label>';
  h += '<h4>Two skills</h4>' + cbChecks(Object.keys(SKT_SKILLS).map(k => ({ value: k, label: SKT_SKILL_LABEL[k] })), c.skills || [], 2, 'cb-cbgskill');
  if (R.edition === '2024'){
    h += '<h4>Three abilities</h4><div class="cb-dim">The ones your background increases.</div>' + cbChecks(SKT_ABS.map(k => ({ value: k, label: cbAbLabel(k) })), c.abilities || [], 3, 'cb-cbgab');
    h += '<label class="cb-f">Origin feat<select class="cb-sel" data-cb-cbg="feat"><option value="">Choose…</option>'
      + R.feats.filter(f => f.category === 'O' && sktBookOk(b, f)).map(f => '<option' + (c.feat === f.name ? ' selected' : '') + '>' + cbEsc(f.name) + '</option>').join('') + '</select></label>';
    h += '<h4>A tool</h4>' + cbChecks(ARTS, c.tools || [], 1, 'cb-cbgtool');
  } else {
    const n = (c.tools || []).length + (+c.languages || 0);
    h += '<h4>Two tools or languages</h4><div class="cb-dim">Tools here; each language you take instead is picked on the Skills step.</div>'
      + '<label class="cb-f">Languages<select class="cb-sel" data-cb-cbg="languages">' + [0, 1, 2].map(k => '<option' + ((+c.languages || 0) === k ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></label>'
      + cbChecks(ARTS, c.tools || [], 2 - (+c.languages || 0), 'cb-cbgtool');
    h += '<label class="cb-f">Feature (borrowed from a printed background)<select class="cb-sel" data-cb-cbg="feature"><option value="">Choose…</option>'
      + R.backgrounds.filter(x => sktBookOk(b, x) && (x.entries || []).some(e => e && /^Feature:/i.test(e.name || ''))).map(x => '<option value="' + cbEsc(x.name) + '"' + (c.feature === x.name ? ' selected' : '') + '>' + cbEsc(((x.entries || []).find(e => e && /^Feature:/i.test(e.name || '')) || {}).name.replace(/^Feature:\s*/i, '')) + ' (' + cbEsc(x.name) + ')</option>').join('') + '</select></label>';
  }
  h += '<label class="cb-f">Equipment<select class="cb-sel" data-cb-cbg="equipment"><option value="">' + (R.edition === '2024' ? '50 gp' : '10 gp') + ' instead</option>'
    + R.backgrounds.filter(x => sktBookOk(b, x) && (x.equipment || []).length).map(x => '<option value="' + cbEsc(x.name) + '"' + (c.equipment === x.name ? ' selected' : '') + '>' + cbEsc(x.name) + '’s kit</option>').join('') + '</select></label>';
  return h + '</div>';
}
function _sktTraitsHtml(entries){
  return (entries || []).filter(e => e && typeof e === 'object' && e.name && e.entries && !/^(Skill|Tool|Language|Equipment|Ability|Feat)/i.test(e.name))
    .map(e => '<div class="cb-feat"><b>' + cbEsc(sktRulesInline(e.name)) + '</b>' + cbFeatureText(sktRulesText(e.entries)) + '</div>').join('');
}

// The standard array (or the matching point buy) in the class's order.
function cbSuggestScores(b){
  const order = SKT_ABILITY_ORDER[String(b.cls || '').toLowerCase()] || SKT_ABS;
  if (b.abilities.method !== 'array' && b.abilities.method !== 'pointbuy') b.abilities.method = 'array';
  b.abilities.assign = {};
  order.forEach((k, i) => { b.abilities.base[k] = SKT_STANDARD_ARRAY[i]; if (b.abilities.method === 'array') b.abilities.assign[k] = i; });
}
function cbQuickPrereqOk(x, b){
  const ps = x.prerequisite || [];
  if (!ps.length) return true;
  // A level in a named class counts that class's levels ("6th-level
  // artificer"); an infusion's item is only what it goes on.
  const lvl = p => {
    const c = typeof p.level === 'object' && p.level.class;
    if (!c) return b.level || 1;
    const part = CB.R ? sktClassLevels(b, CB.R).find(q => q.key === String(c.name).toLowerCase()) : null;
    return part ? part.level : 0;
  };
  return ps.some(p => Object.keys(p).every(k => k === 'item' || (k === 'level' && lvl(p) >= (typeof p.level === 'object' ? p.level.level : p.level))));
}
// Quick Build: every choice still open gets a sensible answer — the class's
// best scores, the skills its abilities favour, the first options where
// there is no better guide. Nothing already chosen changes.
function cbQuickBuild(){
  const b = CB.build, R = CB.R;
  const pickCore = list => list.filter(x => x.core !== false)[0];
  if (!b.cls) b.cls = 'Fighter';
  const cls = sktRulesClass(R, b.cls);
  const order = SKT_ABILITY_ORDER[cls.key] || SKT_ABS;
  if (!b.species){ const sp = R.species.find(s => s.name === 'Human') || pickCore(R.species); b.species = sp.name; }
  const sp = sktRulesSpecies(R, b.species);
  if (sp.subraces.length && !b.subspecies) b.subspecies = (sp.subraces.find(s => s.core !== false) || sp.subraces[0]).name;
  { const rc = sktSpeciesResistChoice(sp, sktSpeciesSub(sp, b));
    if (rc && !sktSpeciesResist(sp, sktSpeciesSub(sp, b), b)){ b.speciesChoice = b.speciesChoice || {}; b.speciesChoice[rc.kind === 'ancestry' ? 'ancestry' : 'resist'] = rc.options[0].name; } }
  if (!b.background){
    // A background whose skills the class's abilities like.
    const score = bg => (bg.skills || []).reduce((n, o) => n + Object.keys(o).filter(k => o[k] === true).reduce((m, k) => { const sk = sktSkillKey(k); return m + (sk ? 6 - order.indexOf(SKT_SKILLS[sk]) : 0); }, 0), 0);
    b.background = R.backgrounds.filter(x => x.core !== false).sort((x, y) => score(y) - score(x))[0].name;
  }
  if (!b.name) b.name = 'New ' + cls.name;
  // Untouched scores: all 10s, nothing assigned, or the standard array still
  // in the order a new character starts with (STR 15 … CHA 8).
  const pristine = SKT_ABS.every(k => (b.abilities.base[k] || 10) === 10) || (b.abilities.method === 'array' && !Object.keys(b.abilities.assign || {}).length)
    || (b.abilities.method === 'array' && SKT_ABS.every((k, i) => b.abilities.base[k] === SKT_STANDARD_ARRAY[i]));
  if (pristine) cbSuggestScores(b);
  const bg = sktBuildBackground(R, b);
  if (R.edition === '2024' && bg && Array.isArray(bg.ability) && !Object.keys(b.bgAsi || {}).length){
    const from = ((bg.ability[0] || {}).choose || {}).weighted ? bg.ability[0].choose.weighted.from : SKT_ABS;
    const best = order.filter(k => from.includes(k));
    b.bgAsiMode = '21'; b.bgAsi = {}; if (best[0]) b.bgAsi[best[0]] = 2; if (best[1]) b.bgAsi[best[1]] = 1;
  }
  const L = b.level || 1;
  if (L >= cls.subclassLevel && !b.subclass){ const s = cls.subclasses.find(x => x.core) || cls.subclasses[0]; if (s) b.subclass = s.shortName; }
  { const pk = sktSubclassSpellPick(sktRulesSubclass(cls, b.subclass)); if (pk && !pk.options.some(o => o.value === b.subclassPick)) b.subclassPick = pk.options[0].value; }
  // Fill what the to-do list still asks for, a few passes (one answer can open another).
  for (let pass = 0; pass < 4; pass++){
    const rec = sktComputeCharacter(b, R);
    const ab = sktBuildAbilities(b, R);
    const bySkill = list => list.slice().sort((x, y) => (ab[SKT_SKILLS[y]] || 0) - (ab[SKT_SKILLS[x]] || 0));
    // Species ability increases (2014).
    const sub = sktSpeciesSub(sp, b);
    const ach = R.edition === '2014' ? sktSpeciesAsiChoice(sp, sub, b) : null;
    if (ach && !Object.keys(b.speciesAsi || {}).length){
      b.speciesAsi = {};
      if (ach.flex){ b.speciesAsi[order[0]] = 2; b.speciesAsi[order[1]] = 1; }
      else order.filter(k => (ach.from || []).includes(k)).slice(0, ach.count).forEach(k => { b.speciesAsi[k] = ach.amount; });
    }
    const granted = new Set(Object.keys(rec.sheet.skillProf || {}).filter(k => !(b.skills || []).includes(k)));
    if ((b.skills || []).length < cls.skillChoice.count)
      b.skills = (b.skills || []).concat(bySkill(cls.skillChoice.from.filter(k => !granted.has(k) && !(b.skills || []).includes(k)))).slice(0, cls.skillChoice.count);
    const skp = cbSpeciesSkillChoice(sp, sub);
    if (skp && (b.speciesSkills || []).length < skp.count)
      b.speciesSkills = bySkill(skp.from.filter(k => !Object.keys(rec.sheet.skillProf || {}).includes(k))).slice(0, skp.count);
    const ex = cbExpertiseCount();
    if (ex && (b.expertise || []).length < ex) b.expertise = bySkill(Object.keys(rec.sheet.skillProf || {})).slice(0, ex);
    const lc = cbLanguageCount();
    if (lc && (b.languages || []).length < lc){
      const known = (rec.sheet.languages || '').split(', ');
      b.languages = (b.languages || []).concat(sktLanguageOptions(R, b).filter(n => !known.includes(n))).slice(0, lc);
    }
    sktToolChoices(b, R).forEach(c => { b.toolPicks = b.toolPicks || {}; if ((b.toolPicks[c.key] || []).length < c.count) b.toolPicks[c.key] = c.options.slice(0, c.count); });
    { const ms = sktMagicalSecrets(b, R); if (ms && ms.picked.length < ms.count){ const known = new Set([].concat(b.spells || [], b.cantrips || [])); const lv = n => (sktRulesSpell(R, n) || {}).level || 0;
      // Another class's spells, the highest level first: what the feature is for.
      const other = ms.options.filter(n => !known.has(n) && !ms.picked.includes(n) && !sktSpellOnList(sktRulesSpell(R, n), 'Bard', b)).sort((x, y) => lv(y) - lv(x) || x.localeCompare(y));
      b.secrets = ms.picked.concat(other).slice(0, ms.count); } }
    sktFeatureSpellPicks(b, R).forEach(x => { if (x.picked.length < x.count && x.options.length){ b.featureSpells = Object.assign({}, b.featureSpells); b.featureSpells[x.feature] = (b.featureSpells[x.feature] || []).concat(x.options.filter(n => !x.picked.includes(n)).slice(0, x.count - x.picked.length)); } });
    sktArcanumLevels(b, R).forEach(lv => { if (!(b.arcanum || {})[lv]){ const o = sktArcanumOptions(b, R, lv)[0]; if (o){ b.arcanum = Object.assign({}, b.arcanum); b.arcanum[lv] = o; } } });
    sktProfChoices(b, R).forEach(c => {
      if (c.picked.length >= c.count) return;
      const known = Object.keys(sktComputeCharacter(b, R).sheet.skillProf || {});
      // Skills not already known first; if too few are left, the rest of the list.
      const opts = c.kind === 'skills' ? bySkill(c.options.filter(k => !known.includes(k))).concat(c.options.filter(k => known.includes(k))) : c.options;
      b.profPicks = Object.assign({}, b.profPicks); const p = b.profPicks[c.feature] = Object.assign({}, b.profPicks[c.feature]);
      p[c.kind] = c.picked.concat(opts.filter(k => !c.picked.includes(k))).slice(0, c.count);
    });
    // Ability Score Improvements: +2 to the class's best score (to 20), else spread.
    sktAsiSlots(b, R).forEach(s => {
      if (b.asi[s.key]) return;
      const cur = sktBuildAbilities(b, R);
      const k1 = order.find(k => cur[k] <= 18), inc = {};
      if (k1) inc[k1] = 2; else { const k2 = order.filter(k => cur[k] < 20).slice(0, 2); k2.forEach(k => { inc[k] = 1; }); }
      b.asi[s.key] = { type: 'asi', inc };
    });
    if ((R.edition === '2014' && sub && /variant/i.test(sub.name) || (R.edition === '2024' && sp.name === 'Human')) && !b.originFeat)
    { // One the background doesn't already give: a Criminal or Farmer human
      // got Alert twice, and a feat that isn't repeatable counts once.
      const owned = new Set([].concat(...((bg && bg.feats) || []).map(o => Object.keys(o))).map(k => String(k).split(/[|;]/)[0].trim().toLowerCase()));
      b.originFeat = (['Alert', 'Tough', 'Lucky', 'Skilled', 'Savage Attacker'].map(n => R.feats.find(f => f.name === n && (R.edition === '2014' || f.category === 'O')))
        .find(f => f && !owned.has(f.name.toLowerCase())) || {}).name || ''; }
    sktBuildChoices(b, R).forEach(c => {
      if (c.value) return;
      b.featureChoices = b.featureChoices || {};
      const same = c.spec.options.find(o => Object.values(b.featureChoices).includes(o.value));
      b.featureChoices[c.feature] = (same || c.spec.options[0]).value;
    });
    sktOptionalChoices(b, R).forEach(o => {
      const have = (b.optional[o.name] || []);
      if (have.length >= o.count) return;
      const pool = o.kind === 'feat' ? R.feats.filter(f => o.types.some(t => String(f.category).split(':')[0] === t.split(':')[0]) && f.core !== false)
                                     : R.optional.filter(x => (x.featureType || []).some(t => o.types.includes(t)) && x.core !== false && cbQuickPrereqOk(x, b));
      b.optional[o.name] = have.concat(pool.map(x => x.name).filter(n => !have.includes(n))).slice(0, o.count);
    });
    const mc = cbMasteryCount();
    if (mc && (b.masteries || []).length < mc){
      const kit = (rec.sheet.attacks || []).map(a => String(a.name).toLowerCase()).filter(n => R.items[n] && R.items[n].mastery);
      b.masteries = [...new Set((b.masteries || []).concat(kit))].slice(0, mc);
    }
    // Spells: one of each level in turn, the highest first, so a high-level
    // caster has spells of every level (and a wizard's book has 3rd-level
    // spells for Signature Spells). Each casting class from its own list.
    const sc = sktBuildSpellcasting(b, R, sktBuildAbilities(b, R));
    if (sc) (sc.classes || [{ primary: true, sc, view: b, entry: null }]).forEach(x => {
      const s = x.sc, v = x.view || b, lst = x.primary ? b : x.entry;
      if (!lst) return;
      const always = sktBuildAlwaysPrepared(v, R);
      if ((lst.cantrips || []).length < s.cantrips) lst.cantrips = (lst.cantrips || []).concat(sktSpellOptions(R, v, 0).map(o => o.name).filter(n => !(lst.cantrips || []).includes(n))).slice(0, s.cantrips);
      const pool = [], byLv = [];
      for (let lv = 1; lv <= s.maxSpellLevel; lv++) byLv[lv] = sktSpellOptions(R, v, lv).map(o => o.name).filter(n => !always.includes(n));
      for (let i = 0; byLv.some(l => l && l.length > i); i++) for (let lv = s.maxSpellLevel; lv >= 1; lv--) if (byLv[lv] && byLv[lv][i]) pool.push(byLv[lv][i]);
      if (s.spellbook && (lst.spellbook || []).length < s.spellbook) lst.spellbook = (lst.spellbook || []).concat(pool.filter(n => !(lst.spellbook || []).includes(n))).slice(0, s.spellbook);
      const want = s.prepared || s.known, src = s.spellbook ? lst.spellbook : pool;
      if (want && (lst.spells || []).length < want) lst.spells = (lst.spells || []).concat(src.filter(n => !(lst.spells || []).includes(n))).slice(0, want);
    });
    // Another class's subclass and skill.
    sktClassLevels(b, R).slice(1).forEach(p => {
      const c2 = sktRulesClass(R, p.cls), m = p.entry;
      if (p.level >= c2.subclassLevel && !m.subclass){ const s2 = c2.subclasses.find(x => x.core) || c2.subclasses[0]; if (s2) m.subclass = s2.shortName; }
      { const pk = sktSubclassSpellPick(sktRulesSubclass(c2, m.subclass)); if (pk && !pk.options.some(o => o.value === m.subclassPick)) m.subclassPick = pk.options[0].value; }
      const sk = _sktSkillChoice(((c2.multiclassing || {}).proficienciesGained || {}).skills);
      if (sk.count && (m.skills || []).length < sk.count) m.skills = bySkill(sk.from.filter(k => !Object.keys(rec.sheet.skillProf || {}).includes(k))).slice(0, sk.count);
    });
    // Spells from feats and the species; a feat's own picks.
    sktFeatSpells(b, R).concat([sktSpeciesSpellGrant(R, b)].filter(Boolean)).forEach(g => {
      const key = g.feat === '@species' ? null : g.feat;
      const ch = key ? (b.featChoices[key] = Object.assign({}, b.featChoices[key])) : (b.speciesChoice = Object.assign({}, b.speciesChoice));
      if (!g.block && g.blocks.length) ch.spellList = g.blocks[0].name;
      if (g.abilityChoices && !g.ability) ch.spellAbility = order.find(k => g.abilityChoices.includes(k)) || g.abilityChoices[0];
      g.choices.forEach(c => { if (c.picked.length < c.count){ ch.spells = (ch.spells || []).concat(c.options.filter(n => !(ch.spells || []).includes(n)).slice(0, c.count - c.picked.length)); } });
    });
    sktBuildFeatNames(b, R).forEach(n => {
      const fc = sktFeatChoices(R, b, n, rec), f = sktRulesFeat(R, n); if (!f) return;
      const ch = b.featChoices[f.name] = Object.assign({}, b.featChoices[f.name]);
      fc.choices.forEach(c => {
        if (c.kind === 'skillsTools'){ if ((ch.skills || []).length + (ch.tools || []).length < c.count) ch.skills = bySkill(c.options.filter(o => o.startsWith('s:')).map(o => o.slice(2))).slice(0, c.count); }
        else if ((ch[c.kind] || []).length < c.count) ch[c.kind] = (c.kind === 'skills' ? bySkill(c.options) : c.options).slice(0, c.count);
      });
      const ac2 = cbFeatAbilityChoice(f);
      if (ac2 && !Object.keys(ch.inc || {}).length){ const k = order.find(x => ac2.from.includes(x)); if (k) ch.inc = { [k]: ac2.amount }; }
    });
    if (R.edition === '2024' && sp.additionalSpells && sp.additionalSpells.length > 1 && !b.speciesChoice.lineage) b.speciesChoice.lineage = sp.additionalSpells[0].name;
  }
}

CB_RENDER.abilities = () => {
  const b = CB.build, R = CB.R;
  const m = b.abilities.method || 'array';
  const base = b.abilities.base;
  const final = sktBuildAbilities(b, R);
  const why = sktAbilityBreakdown(b, R);
  const seg = [['array', 'Standard array'], ['pointbuy', 'Point buy'], ['roll', 'Roll'], ['manual', 'Enter scores']]
    .map(([k, l]) => '<button class="' + (m === k ? 'on' : '') + '" data-cb-method="' + k + '">' + l + '</button>').join('');
  let pool = null, note = '';
  if (m === 'array') pool = SKT_STANDARD_ARRAY;
  if (m === 'roll') pool = b.abilities.rolled || null;
  if (m === 'pointbuy'){
    const spent = SKT_ABS.reduce((s, k) => s + (SKT_POINT_BUY[base[k]] ?? 99), 0);
    note = '<div class="cb-counter' + (spent <= 27 ? ' ok' : '') + '">' + (27 - spent) + ' of 27 points left</div>';
  }
  if (m === 'roll') note = '<button class="btn" data-cb="roll">🎲 Roll 4d6, drop the lowest — six times</button>'
    + (pool ? '<div class="cb-dim">Rolled: ' + pool.join(', ') + '. Assign each to an ability.</div>' : '');
  const rows = SKT_ABS.map(k => {
    let ctrl;
    if (m === 'manual') ctrl = '<input type="number" min="3" max="20" data-cb-score="' + k + '" value="' + base[k] + '">';
    else if (m === 'pointbuy') ctrl = '<button class="btn small" data-cb-pb="' + k + ':-1"' + (base[k] <= 8 ? ' disabled' : '') + '>−</button><b class="cb-pbv">' + base[k] + '</b><button class="btn small" data-cb-pb="' + k + ':1"' + (base[k] >= 15 ? ' disabled' : '') + '>+</button>';
    else ctrl = pool ? '<select class="cb-sel" data-cb-assign="' + k + '">' + pool.map((v, i) => '<option value="' + i + '"' + ((b.abilities.assign || {})[k] === i ? ' selected' : '') + '>' + v + '</option>').join('') + '</select>' : '<span class="cb-dim">roll first</span>';
    const bonus = final[k] - base[k];
    return '<div class="cb-abrow"><span class="cb-abn">' + cbAbLabel(k) + '</span><span class="cb-abc">' + ctrl + '</span>'
      + '<span class="cb-abb" title="' + cbEsc(why[k] || '') + '">' + (bonus ? sktSigned(bonus) : '') + '</span><b class="cb-abf" title="' + cbEsc(why[k] || '') + '">' + final[k] + '</b><i class="cb-abm">' + sktSigned(sktMod(final[k])) + '</i></div>';
  }).join('');
  const where = R.edition === '2024' ? 'Background and feat increases are included.' : 'Species and feat increases are included.';
  return '<h3>Ability scores</h3><div class="cb-seg">' + seg + '</div>'
    + (b.cls && (m === 'array' || m === 'pointbuy') ? '<button class="btn small cb-suggest-btn" data-cb="suggest">Suggest for a ' + cbEsc(b.cls) + '</button>' : '') + note
    + '<div class="cb-abtable"><div class="cb-abrow cb-abhead"><span></span><span>Base</span><span>Bonus</span><span>Score</span><span>Mod</span></div>' + rows + '</div>'
    + '<div class="cb-dim">' + where + '</div>'
    + '<div class="cb-whylist">' + SKT_ABS.filter(k => (why[k] || '').includes('·')).map(k => '<div><b>' + cbAbLabel(k) + '</b> ' + cbEsc(why[k]) + '</div>').join('') + '</div>';
};

CB_RENDER.skills = () => {
  const b = CB.build, R = CB.R;
  const cls = sktRulesClass(R, b.cls);
  if (!cls) return '<h3>Skills</h3><div class="cb-dim">Choose a class first.</div>';
  const rec = CB.rec;
  // What other choices already grant, shown ticked and fixed.
  const granted = {};
  const sp = sktRulesSpecies(R, b.species), bg = sktBuildBackground(R, b);
  const grant = (list, label) => (list || []).forEach(o => Object.keys(o).forEach(k => { const sk = sktSkillKey(k); if (sk && o[k] === true) granted[sk] = label; }));
  grant(bg && bg.skills, 'background'); grant(sp && sp.skills, 'species');
  (b.speciesSkills || []).forEach(k => { granted[k] = 'species'; });
  if (R.edition === '2014' && sp && sp.entries && sp.entries.some(e => e && e.name === 'Keen Senses')) granted.perception = 'species';
  if (sp && sp.entries && sp.entries.some(e => e && e.name === 'Menacing')) granted.intimidation = 'species';
  let html = '<h3>Skills</h3><h4>' + cbEsc(cls.name) + ' skills</h4>' + cbCounter((b.skills || []).length, cls.skillChoice.count, 'chosen')
    + cbChecks(cls.skillChoice.from.map(k => ({ value: k, label: SKT_SKILL_LABEL[k] })), b.skills || [], cls.skillChoice.count, 'cb-skill', granted);
  const ex = cbExpertiseCount();
  if (ex){
    const profd = Object.keys(rec.sheet.skillProf || {});
    html += '<h4>Expertise</h4><div class="cb-dim">Double your proficiency bonus in ' + ex + ' skill' + (ex === 1 ? '' : 's') + ' you are proficient in.</div>'
      + cbCounter((b.expertise || []).length, ex, 'chosen')
      + cbChecks(profd.map(k => ({ value: k, label: SKT_SKILL_LABEL[k] })), b.expertise || [], ex, 'cb-expert');
  }
  const langCount = cbLanguageCount();
  if (langCount){
    const known = (rec.sheet.languages || '').split(', ').filter(Boolean).filter(l => !(b.languages || []).includes(l));
    html += '<h4>Languages</h4><div class="cb-dim">Already known: ' + cbEsc(known.join(', ') || '—') + '. Choose ' + langCount + ' more.</div>'
      + cbChecks([...new Set(sktLanguageOptions(R, b).concat(b.languages || []))].filter(n => !known.includes(n)), b.languages || [], langCount, 'cb-lang');
  }
  // Skills and weapons a subclass feature lets the player choose.
  sktProfChoices(b, R).forEach(c => {
    const label = k => c.kind === 'skills' ? SKT_SKILL_LABEL[k] : c.kind === 'weapons' ? _sktTitle(k) : k;
    // Skills the character already has from elsewhere can't be picked again.
    const locked = {};
    if (c.kind === 'skills') c.options.forEach(k => { if ((rec.sheet.skillProf || {})[k] && !c.picked.includes(k)) locked[c.feature + '||skills||' + k] = 'already'; });
    html += '<h4>' + ({ skills: 'Skills', weapons: 'Weapons', enemies: 'Favored enemies', terrains: 'Favored terrains', enhancements: 'Animal enhancements' }[c.kind]) + ' — ' + cbEsc(c.feature) + '</h4>' + cbCounter(c.picked.length, c.count, 'chosen')
      + cbChecks(c.options.map(k => ({ value: c.feature + '||' + c.kind + '||' + k, label: label(k) })), c.picked.map(k => c.feature + '||' + c.kind + '||' + k), c.count, 'cb-profpick', locked);
  });
  // Tools the class, background or species leaves to the player.
  sktToolChoices(b, R).forEach(c => {
    const picks = (b.toolPicks || {})[c.key] || [];
    html += '<h4>Tools — ' + cbEsc(c.label) + '</h4>' + cbCounter(picks.length, c.count, 'chosen')
      + cbChecks(c.options.map(t => ({ value: c.key + '||' + t, label: t })), picks.map(t => c.key + '||' + t), c.count, 'cb-tool');
  });
  html += '<h4>All skills</h4><div class="cb-skilltable">' + Object.keys(SKT_SKILLS).map(k =>
    '<div class="cb-sk' + (rec.sheet.skillProf[k] ? ' prof' + rec.sheet.skillProf[k] : '') + '"><span>' + SKT_SKILL_LABEL[k] + ' <i>' + SKT_SKILLS[k].toUpperCase() + '</i></span><b>' + sktSigned(rec.sheet.skills[k]) + '</b></div>').join('') + '</div>';
  return html;
};
function cbExpertiseCount(){
  const cls = sktRulesClass(CB.R, CB.build.cls); if (!cls) return 0;
  const L = CB.build.level || 1;
  let n = cls.features.filter(f => f.level <= L && /^Expertise$/i.test(f.name)).length * 2;
  if (CB.R.edition === '2024' && cls.key === 'ranger' && L >= 2) n += 1;         // Deft Explorer
  if (CB.R.edition === '2024' && cls.key === 'wizard' && L >= 2) n += 1;         // Scholar
  return n;
}
// Languages a subclass feature lets the player learn (Knowledge Domain, Mastermind).
function cbSubclassLanguages(){
  return sktRulesClass(CB.R, CB.build.cls) ? sktSubclassProfFeatures(CB.build, CB.R).reduce((n, x) => n + x.g.choices.filter(c => c.kind === 'languages').reduce((m, c) => m + c.count, 0), 0) : 0;
}
// Languages class features add: the 2024 rogue's one beside Thieves' Cant,
// the 2024 ranger's two from Deft Explorer, a 2014 ranger's one per
// favored enemy (1st, 6th and 14th level).
function cbClassLanguages(){
  const R = CB.R;
  return sktClassLevels(CB.build, R).reduce((n, p) => {
    if (p.key === 'rogue' && R.edition === '2024') n += 1;
    if (p.key === 'ranger' && R.edition === '2024' && p.level >= 2) n += 2;
    if (p.key === 'ranger' && R.edition === '2014') n += [1, 6, 14].filter(l => p.level >= l).length;
    return n;
  }, 0);
}
function cbLanguageCount(){
  const R = CB.R, b = CB.build;
  if (R.edition === '2024') return 2 + cbSubclassLanguages() + cbClassLanguages();
  let n = 0;
  const sp = sktRulesSpecies(R, b.species), sub = sp && sktSpeciesSub(sp, b);
  const bg = sktBuildBackground(R, b);
  [sp && sp.languages, sub && sub.languages, bg && bg.languages].forEach(list => (list || []).forEach(o => {
    n += (+o.anyStandard || 0) + (+o.any || 0) + (o.choose ? (o.choose.count || 1) : 0);
  }));
  return n + cbSubclassLanguages() + cbClassLanguages();
}
function cbMasteryCount(){
  if (!CB || !CB.R || CB.R.edition !== '2024') return 0;
  const cls = sktRulesClass(CB.R, CB.build.cls);
  if (!cls) return 0;
  const L = CB.build.level || 1;
  // Fighters and barbarians have a column for it; paladins, rangers and
  // rogues only say "two kinds" in the feature's text.
  const n = sktClassColumn(cls, 'Weapon Mastery', L);
  if (typeof n === 'number') return n;
  return cls.features.some(f => f.name === 'Weapon Mastery' && f.level <= L) ? 2 : 0;
}

CB_RENDER.levels = () => {
  const b = CB.build, R = CB.R;
  const cls = sktRulesClass(R, b.cls);
  if (!cls) return '<h3>Levels</h3><div class="cb-dim">Choose a class first.</div>';
  const L = b.level || 1;
  let html = '<h3>Levels</h3>';
  if (CB.mode === 'levelup' && CB.fromLevel && (CB.multi0 || []).length){
    html += '<h4>This level goes to</h4><div class="cb-seg"><button class="' + (CB.lvlTo === 'first' ? 'on' : '') + '" data-cb-lvlto="first">' + cbEsc(cls.name) + '</button>'
      + CB.multi0.map((m, i) => '<button class="' + (CB.lvlTo === String(i) ? 'on' : '') + '" data-cb-lvlto="' + i + '">' + cbEsc(_sktTitle(m.cls)) + '</button>').join('')
      + '</div><div class="cb-dim">Another class entirely is added on the Class step.</div>';
  }
  if (CB.mode === 'levelup' && CB.fromLevel){
    const was = {}; sktClassLevels(Object.assign({}, b, { level: CB.fromLevel, multi: CB.multi0 || [] }), R).forEach(p => { was[p.key] = p.level; });
    const fresh = sktBuildFeatures(b, R).filter(f => !f.info && f.cls && f.level > (was[f.cls] || 0));
    html += '<div class="cb-new"><b>New at level ' + L + '</b>' + (fresh.length ? fresh.map(f => '<div class="cb-feat"><b>' + cbEsc(f.name) + '</b> ' + (f.mech ? '<span class="cb-badge">applied</span>' : '') + cbFeatureText(f.text, true) + '</div>').join('') : '<div class="cb-dim">No new features — just hit points and anything below.</div>') + '</div>';
  }
  // Hit points.
  if (L > 1){
    const avg = Math.floor(cls.hd / 2) + 1;
    const hm = (b.hp && b.hp.method) || 'average';
    html += '<h4>Hit points</h4><div class="cb-seg"><button class="' + (hm === 'average' ? 'on' : '') + '" data-cb-hp="average">Take the average (' + avg + ')</button>'
      + '<button class="' + (hm === 'rolled' ? 'on' : '') + '" data-cb-hp="rolled">Roll</button>'
      + '<button class="' + (hm === 'manual' ? 'on' : '') + '" data-cb-hp="manual">Enter it</button></div>';
    if (hm === 'manual') html += '<label class="cb-f">Hit point maximum<input type="number" min="1" data-cb-hpmanual value="' + (b.hp.manual || CB.rec.hpMax) + '"></label>';
    if (hm === 'rolled'){
      let rows = '';
      for (let lv = 2; lv <= sktClassLevels(b, R)[0].level; lv++){
        const v = (b.hp.rolls || {})[lv] || '';
        rows += '<label class="cb-hproll">Level ' + lv + ' <input type="number" min="1" max="' + cls.hd + '" data-cb-hproll="' + lv + '" value="' + v + '"><button class="btn small" data-cb-hpdice="' + lv + '">🎲 d' + cls.hd + '</button></label>';
      }
      html += '<div class="cb-hprolls">' + rows + '</div>';
    }
    html += '<div class="cb-dim">Level 1 is always the full d' + cls.hd + '. Your Constitution modifier is added every level.'
      + (sktIsMulticlass(b, R) ? ' Levels in other classes take their average.' : '') + '</div>';
  }
  // Features that are a choice: Divine Order, Primal Order, Blessed Strikes…
  sktBuildChoices(b, R).forEach(c => {
    html += '<h4>' + cbEsc(c.spec.label || c.feature) + ' <span class="cb-dim">level ' + c.level + '</span></h4>'
      + '<div class="cb-cards">' + c.spec.options.map(o => '<button class="cb-card' + (c.value === o.value ? ' on' : '') + '" data-cb-fchoice="'
        + cbEsc(c.feature + '||' + o.value) + '"><b>' + cbEsc(o.label) + '</b><span>' + cbEsc(o.desc || '') + '</span></button>').join('') + '</div>';
  });
  // Subclass.
  if (sktClassLevels(b, R)[0].level >= cls.subclassLevel && !b.subclass) html += '<div class="cb-warn">Choose your ' + cbEsc(sktRulesInline(cls.subclassTitle)) + ' on the Class step.</div>';
  // ASI or feat.
  const multiAsi = sktIsMulticlass(b, R);
  sktAsiSlots(b, R).forEach(s => {
    const l = s.key;
    const p = b.asi[l] || {};
    const isFeat = p.type === 'feat';
    html += '<div class="cb-asi"><h4>' + (multiAsi ? cbEsc(_sktTitle(s.cls)) + ' ' : 'Level ') + s.level + '</h4><div class="cb-seg">'
      + '<button class="' + (p.type === 'asi' ? 'on' : '') + '" data-cb-asitype="' + l + ':asi">Ability Score Improvement</button>'
      + '<button class="' + (isFeat ? 'on' : '') + '" data-cb-asitype="' + l + ':feat">A feat</button></div>';
    if (p.type === 'asi'){
      const inc = p.inc || {};
      const sel = (slot) => {
        const keys = Object.keys(inc); const cur = slot === 0 ? keys[0] || '' : (keys[1] || (inc[keys[0]] === 2 ? keys[0] : ''));
        return '<select class="cb-sel" data-cb-asiab="' + l + ':' + slot + '"><option value="">—</option>' + SKT_ABS.map(k => '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + cbAbLabel(k) + '</option>').join('') + '</select>';
      };
      html += '<div class="cb-row"><label class="cb-f">+1' + sel(0) + '</label><label class="cb-f">+1' + sel(1) + '</label></div><div class="cb-dim">Pick the same ability twice for +2.</div>';
    } else if (isFeat){
      const pre = f => sktFeatPrereq(R, Object.assign({}, b, { level: s.primary ? s.level : b.level }), f, CB.rec);
      const taken = new Set(sktBuildFeatNames(b, R));
      const pool = R.feats.filter(f => (R.edition === '2014' || f.category === 'G' || (l >= 19 && f.category === 'EB'))
                                    && (f.repeatable || p.feat === f.name || !taken.has(f.name))
                                    && (sktBookOk(b, f) || p.feat === f.name)
                                    && (b.showAllFeats || p.feat === f.name || pre(f).ok));
      html += '<select class="cb-sel" data-cb-asifeat="' + l + '"><option value="">Choose a feat…</option>'
        + pool.map(f => { const q = pre(f); return '<option value="' + cbEsc(f.name) + '"' + (p.feat === f.name ? ' selected' : '') + '>' + cbEsc(f.name) + (f.core === false ? ' (' + cbEsc(f.source) + ')' : '')
          + (q.ok ? '' : ' — needs ' + cbEsc(q.text)) + '</option>'; }).join('') + '</select>'
        + '<label class="cb-inline"><input type="checkbox" data-cb-qualified' + (b.showAllFeats ? '' : ' checked') + '> Only feats this character qualifies for</label>';
      { const pf = p.feat && sktRulesFeat(R, p.feat), q = pf && pre(pf); if (q && q.text) html += '<div class="' + (q.ok ? 'cb-dim' : 'cb-warn') + '">Prerequisite: ' + cbEsc(q.text) + '</div>'; }
      const f = p.feat && sktRulesFeat(R, p.feat);
      if (f){
        const ch = cbFeatAbilityChoice(f);
        if (ch){
          const cur = Object.keys((b.featChoices[f.name] || {}).inc || {})[0] || '';
          html += '<label class="cb-f">' + (ch.amount === 1 ? 'Increase by 1' : 'Increase') + '<select class="cb-sel" data-cb-featab="' + cbEsc(f.name) + ':' + ch.amount + '"><option value="">—</option>'
            + ch.from.map(k => '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + cbAbLabel(k) + '</option>').join('') + '</select></label>';
        }
        html += cbFeatChoicesHtml(f.name);
        if (/^Resilient$/i.test(f.name)){
          const cur = (b.featChoices[f.name] || {}).save || '';
          html += '<label class="cb-f">Saving throw proficiency<select class="cb-sel" data-cb-featsave="' + cbEsc(f.name) + '"><option value="">—</option>'
            + SKT_ABS.map(k => '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + cbAbLabel(k) + '</option>').join('') + '</select></label>';
        }
        html += cbFeatureText(sktRulesText(f.entries));
      }
    }
    html += '</div>';
  });
  // Optional features: invocations, metamagic, fighting styles, pact boons.
  sktOptionalChoices(b, R).forEach(o => {
    const have = (b.optional[o.name] || []);
    const pool = o.kind === 'feat'
      ? R.feats.filter(f => o.types.some(t => String(f.category).split(':')[0] === t.split(':')[0]) && (String(f.category) === 'FS' || o.types.includes(f.category)))
          .filter(f => sktBookOk(b, f) || have.includes(f.name))
      : R.optional.filter(x => (x.featureType || []).some(t => o.types.includes(t)) && (sktBookOk(b, x) || have.includes(x.name)));
    html += '<h4>' + cbEsc(o.name) + '</h4>' + cbCounter(have.length, o.count, 'chosen')
      + cbChecks(pool.map(x => ({ value: x.name, label: x.name + cbPrereqNote(x) })), have, o.count, 'cb-opt-' + cbSlug(o.name));
    have.forEach(n => { const x = pool.find(p => p.name === n); if (x) html += '<div class="cb-feat"><b>' + cbEsc(n) + '</b>' + cbFeatureText(sktRulesText(x.entries)) + '</div>'; });
  });
  // 2024 weapon masteries.
  const mc = cbMasteryCount();
  if (mc){
    const P = CB.rec.sheet.proficiencies;
    const prof = P.weapons, rules = P.weaponRules || [];
    const can = i => prof.includes(i.weaponCategory) || prof.includes(i.name.toLowerCase())
      || rules.some(r => r.cat === i.weaponCategory && r.props.some(p => (i.property || []).map(x => String(x).split('|')[0]).includes(p)));
    const weapons = Object.values(R.items).filter(i => i.mastery && i.weaponCategory && can(i))
      .map(i => i.name).filter((n, k, a) => a.indexOf(n) === k).sort();
    html += '<h4>Weapon Mastery</h4><div class="cb-dim">Use the mastery property of ' + mc + ' kinds of weapon.</div>'
      + cbCounter((b.masteries || []).length, mc, 'chosen')
      + cbChecks(weapons.map(n => ({ value: n.toLowerCase(), label: n + ' — ' + String((R.items[n.toLowerCase()].mastery || [''])[0]).split('|')[0] })), b.masteries || [], mc, 'cb-mastery');
  }
  return html;
};
function cbSlug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function cbPrereqNote(x){
  const p = (x.prerequisite || [])[0]; if (!p) return '';
  if (p.level) return ' (level ' + (p.level.level || p.level) + '+' + (p.item ? ' · ' + p.item[0] : '') + ')';
  if (p.item) return ' (' + p.item[0] + ')';
  if (p.pact) return ' (' + p.pact + ')';
  if (p.spell) return ' (needs ' + String(p.spell[0]).split('|')[0].replace(/#c$/, '') + ')';
  return '';
}
// A feat's skill, tool, language, weapon and expertise picks.
function cbFeatChoicesHtml(featName){
  const R = CB.R, b = CB.build;
  const f = sktRulesFeat(R, featName); if (!f) return '';
  const fc = sktFeatChoices(R, b, f.name, CB.rec);
  const ch = b.featChoices[f.name] || {};
  const label = v => v.startsWith('s:') ? SKT_SKILL_LABEL[v.slice(2)] : v.startsWith('t:') ? v.slice(2) : (SKT_SKILL_LABEL[v] || _sktTitle(v));
  return fc.choices.map(c => {
    const picked = c.kind === 'skillsTools' ? [...(ch.skills || []).map(s => 's:' + s), ...(ch.tools || []).map(t => 't:' + t)] : (ch[c.kind] || []);
    return '<div class="cb-fc"><div class="cb-dim">' + cbEsc(f.name) + ': choose ' + c.count + ' ' + c.label + (c.count === 1 ? '' : 's') + '</div>'
      + cbChecks(c.options.map(o => ({ value: f.name + '||' + c.kind + '||' + o, label: label(o) })), picked.map(o => f.name + '||' + c.kind + '||' + o), c.count, 'cb-fc') + '</div>';
  }).join('');
}
function cbFeatAbilityChoice(f){
  for (const a of (f.ability || [])){
    if (a.choose) return { from: a.choose.from || SKT_ABS, amount: a.choose.amount || 1 };
  }
  return null;
}

// Search and filters for every spell list on the Spells step; the chosen
// spells always stay in view.
function cbSpellFilterHtml(){
  const schools = { A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment', V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation' };
  return '<div class="cb-spfilter"><input data-cb-spq placeholder="Search spells…" value="' + cbEsc(CB.spQ || '') + '">'
    + '<select class="cb-sel" data-cb-spschool><option value="">Any school</option>' + Object.keys(schools).map(k => '<option value="' + k + '"' + (CB.spSchool === k ? ' selected' : '') + '>' + schools[k] + '</option>').join('') + '</select>'
    + '<label class="cb-inline"><input type="checkbox" data-cb-spritual' + (CB.spRitual ? ' checked' : '') + '> Ritual</label>'
    + '<label class="cb-inline"><input type="checkbox" data-cb-spconc' + (CB.spConc ? ' checked' : '') + '> Concentration</label></div>';
}
function cbSpellPass(name, chosen){
  if ((chosen || []).includes(name)) return true;
  const s = sktRulesSpell(CB.R, name); if (!s) return true;
  if (CB.spQ && !s.name.toLowerCase().includes(CB.spQ.toLowerCase())) return false;
  if (CB.spSchool && s.school !== CB.spSchool) return false;
  if (CB.spRitual && !s.ritual) return false;
  if (CB.spConc && !s.concentration) return false;
  return true;
}
function cbSpellInfoHtml(name){
  const s = sktRulesSpell(CB.R, name); if (!s) return '';
  const lvl = s.level ? 'level ' + s.level : 'cantrip';
  return '<div class="cb-spinfo"><b>' + cbEsc(s.name) + '</b> <span class="cb-dim">' + cbEsc(lvl + (s.concentration ? ' · concentration' : '') + (s.ritual ? ' · ritual' : '')) + '</span>'
    + '<button class="cb-x" data-cb-spinfo="" aria-label="Close">✕</button>' + cbFeatureText(sktRulesText(s.entries), true) + '</div>';
}
// A wizard's Spell Mastery and Signature Spells, from the spellbook.
function cbWizardPicksHtml(){
  const picks = sktFeatureSpellPicks(CB.build, CB.R);
  return picks.map(x => '<h4>' + cbEsc(x.feature) + ' <span class="cb-dim">' + x.level + (x.level === 1 ? 'st' : x.level === 2 ? 'nd' : 'rd') + ' level</span></h4>'
    + (x.options.length ? cbSpellChecks(x.options, x.picked.map(n => x.level + '|' + n), x.count, 'cb-wizpick', n => x.level + '|' + n) : '<div class="cb-dim">Write a spell of this level into the spellbook first.</div>')).join('');
}
// A 2014 bard's Magical Secrets: spells from any class.
function cbSecretsHtml(){
  const ms = sktMagicalSecrets(CB.build, CB.R);
  if (!ms) return '';
  return '<h4>Magical Secrets</h4><div class="cb-dim">Spells from any class, cantrips included; they count as bard spells.</div>'
    + cbCounter(ms.picked.length, ms.count, 'chosen') + cbSpellChecks(ms.options, ms.picked, ms.count, 'cb-secret');
}
// A warlock's Mystic Arcanum: one spell of each level it has reached.
function cbArcanumHtml(){
  const b = CB.build, R = CB.R, lvls = sktArcanumLevels(b, R);
  if (!lvls.length) return '';
  return '<h4>Mystic Arcanum</h4><div class="cb-dim">One spell of each level, cast once per long rest without a slot.</div>'
    + lvls.map(lv => '<div class="cb-spl"><span class="cb-spl-l">Level ' + lv + '</span>'
      + cbSpellChecks(sktArcanumOptions(b, R, lv), (b.arcanum || {})[lv] ? [lv + '|' + b.arcanum[lv]] : [], 1, 'cb-arcanum', n => lv + '|' + n) + '</div>').join('');
}
// A checklist of spells, each with a button to read it.
function cbSpellChecks(options, chosen, max, attr, valueOf){
  valueOf = valueOf || (n => n);
  const shown = options.filter(n => cbSpellPass(n, chosen.map ? chosen.map(x => String(x).split('|').pop()) : []));
  const vals = chosen;
  const full = max != null && vals.length >= max;
  if (!shown.length) return '<div class="cb-dim">No spells match.</div>';
  // A spell's text opens right under it, across the list (it opened above
  // the whole list, and the step scrolled up to it — away from your place).
  return '<div class="cb-checks">' + shown.map(n => {
    const v = valueOf(n), on = vals.includes(v);
    return '<label class="cb-check' + (on ? ' on' : '') + (!on && full ? ' dim' : '') + '"><input type="checkbox" data-' + attr + '="' + cbEsc(v) + '"' + (on ? ' checked' : '') + (!on && full ? ' disabled' : '') + '>'
      + '<span>' + cbEsc(n) + '</span><button class="cb-spi" data-cb-spinfo="' + cbEsc(n) + '" data-cb-spin="' + cbEsc(attr) + '" title="What it does" aria-label="About ' + cbEsc(n) + '">i</button></label>'
      + (CB.spInfo === n && CB.spInfoIn === attr ? cbSpellInfoHtml(n) : '');
  }).join('') + '</div>';
}
CB_RENDER.spells = () => {
  const b = CB.build, R = CB.R;
  const sc = sktBuildSpellcasting(b, R, sktBuildAbilities(b, R));
  const fromFeats = cbFeatSpellsHtml();
  if (!sc) return '<h3>Spells</h3>' + (fromFeats || '<div class="cb-dim">This character does not cast spells yet.</div>');
  if (sc.classes && !sc.classes[0].primary) return '<h3>Spells</h3><div class="cb-note">Spell slots: ' + cbSlotText(sc) + '</div>' + cbMultiSpellsHtml() + fromFeats;
  const want = sc.prepared || sc.known;
  const maxLv = sc.classes ? sc.classes[0].sc.maxSpellLevel : sc.maxSpellLevel;
  const always = sktBuildAlwaysPrepared(b, R);
  let html = '<h3>Spells</h3>' + cbSpellFilterHtml() + '<div class="cb-note">' + cbAbLabel(sc.ability) + ' · save DC ' + sc.dc + ' · attack ' + sktSigned(sc.attack)
    + ' · slots ' + (Object.keys(sc.slots).map(l => sc.slots[l] + '×' + l + (l === '1' ? 'st' : l === '2' ? 'nd' : l === '3' ? 'rd' : 'th')).join(', ') || '—') + '</div>';
  if (sc.cantrips){
    html += '<h4>Cantrips</h4>' + cbCounter((b.cantrips || []).length, sc.cantrips, 'chosen')
      + cbSpellChecks(sktSpellOptions(R, b, 0).map(s => s.name), b.cantrips || [], sc.cantrips, 'cb-cantrip');
  }
  // A wizard writes spells into a book, and prepares from the book — the
  // whole wizard list was on offer before.
  const book = sc.spellbook ? (b.spellbook && b.spellbook.length ? b.spellbook : (b.spells || [])) : null;
  if (sc.spellbook){
    html += '<h4>Spellbook</h4><div class="cb-dim">Six spells at 1st level, two more each level after. You prepare from these.</div>'
      + cbCounter(book.length, sc.spellbook, 'in the book');
    html += cbSpellRows(R, maxLv, book, lv => sktSpellOptions(R, b, lv).map(s => s.name).filter(n => !always.includes(n)), opts => cbSpellChecks(opts, book, sc.spellbook, 'cb-book'));
  }
  if (want){
    html += '<h4>' + (sc.prepared ? 'Prepared spells' : 'Spells known') + '</h4>' + cbCounter((b.spells || []).length, want, 'chosen');
    if (book){
      const opts = book.filter(n => !always.includes(n));
      html += opts.length ? cbSpellChecks(opts, b.spells || [], want, 'cb-spell') : '<div class="cb-dim">Write spells into the book first.</div>';
    } else html += cbSpellRows(R, maxLv, b.spells, lv => sktSpellOptions(R, b, lv).map(s => s.name).filter(n => !always.includes(n)), opts => cbSpellChecks(opts, b.spells || [], want, 'cb-spell'));
  }
  if (always.length) html += '<h4>Always prepared</h4><div class="cb-dim">' + cbEsc(always.join(', ')) + '</div>';
  return html + cbSecretsHtml() + cbArcanumHtml() + cbWizardPicksHtml() + cbMultiSpellsHtml() + fromFeats;
};
// The levels to list: up to what the class casts, and past it for any
// picked spell that's now too high (a lower level), showing only those.
function cbSpellRows(R, maxLv, chosen, optsAt, row){
  const lv = n => (sktRulesSpell(R, n) || {}).level || 0;
  const top = Math.max(maxLv, ...(chosen || []).map(lv));
  let h = '';
  for (let l = 1; l <= top; l++){
    const high = l > maxLv, opts = high ? (chosen || []).filter(n => lv(n) === l) : optsAt(l);
    if (opts.length) h += '<div class="cb-spl"><span class="cb-spl-l">Level ' + l + (high ? ' · too high' : '') + '</span>' + row(opts) + '</div>';
  }
  return h;
}
function cbSlotText(sc){
  return Object.keys(sc.slots).map(l => sc.slots[l] + '×' + l + (l === '1' ? 'st' : l === '2' ? 'nd' : l === '3' ? 'rd' : 'th')).join(', ') || '—';
}
// Another class's spells, from its own list and at its own level.
function cbMultiSpellsHtml(){
  const b = CB.build, R = CB.R;
  const sc = sktBuildSpellcasting(b, R, sktBuildAbilities(b, R));
  if (!sc || !sc.classes) return '';
  return sc.classes.filter(x => !x.primary).map(x => {
    const i = b.multi.indexOf(x.entry), m = x.entry || {}, s = x.sc, v = x.view;
    const chk = (opts, chosen, max, kind) => cbChecks(opts.map(n => ({ value: i + '|' + kind + '|' + n, label: n })), (chosen || []).map(n => i + '|' + kind + '|' + n), max, 'cb-mcspell');
    const always = sktBuildAlwaysPrepared(v, R);
    let h = '<h3>' + cbEsc(_sktTitle(x.cls)) + ' spells</h3><div class="cb-note">' + cbAbLabel(s.ability) + ' · save DC ' + s.dc + ' · attack ' + sktSigned(s.attack) + '</div>';
    if (s.cantrips) h += '<h4>Cantrips</h4>' + cbCounter((m.cantrips || []).length, s.cantrips, 'chosen') + chk(sktSpellOptions(R, v, 0).map(o => o.name), m.cantrips, s.cantrips, 'cantrips');
    const book = s.spellbook ? (m.spellbook && m.spellbook.length ? m.spellbook : (m.spells || [])) : null;
    if (s.spellbook){
      h += '<h4>Spellbook</h4>' + cbCounter(book.length, s.spellbook, 'in the book');
      h += cbSpellRows(R, s.maxSpellLevel, book, lv => sktSpellOptions(R, v, lv).map(o => o.name).filter(n => !always.includes(n)), opts => chk(opts, book, s.spellbook, 'spellbook'));
    }
    const want = s.prepared || s.known;
    if (want){
      h += '<h4>' + (s.prepared ? 'Prepared spells' : 'Spells known') + '</h4>' + cbCounter((m.spells || []).length, want, 'chosen');
      if (book) h += chk(book.filter(n => !always.includes(n)), m.spells, want, 'spells');
      else h += cbSpellRows(R, s.maxSpellLevel, m.spells, lv => sktSpellOptions(R, v, lv).map(o => o.name).filter(n => !always.includes(n)), opts => chk(opts, m.spells, want, 'spells'));
    }
    if (always.length) h += '<h4>Always prepared</h4><div class="cb-dim">' + cbEsc(always.join(', ')) + '</div>';
    return h;
  }).join('');
}
// The spells a feat or a species grants: which list (unless fixed), the
// casting ability where it is a choice, and each pick. `key` is the feat's
// name, or '@species'.
function cbFeatSpellsHtml(){
  return sktFeatSpells(CB.build, CB.R).map(g => cbGrantHtml(g, g.feat, 'From ' + g.feat)).join('');
}
function cbGrantHtml(g, key, title){
  let h = '<h4>' + cbEsc(title) + '</h4>';
  if (!g.listFixed){
    h += '<label class="cb-f">Spell list<select class="cb-sel" data-cb-fslist="' + cbEsc(key) + '"><option value="">Choose…</option>'
      + g.blocks.map(x => '<option' + (g.block && g.block.name === x.name ? ' selected' : '') + '>' + cbEsc(x.name) + '</option>').join('') + '</select></label>';
  }
  if (!g.block) return h;
  if (g.abilityChoices){
    h += '<label class="cb-f">Casting ability<select class="cb-sel" data-cb-fsab="' + cbEsc(key) + '"><option value="">—</option>'
      + g.abilityChoices.map(k => '<option value="' + k + '"' + (g.ability === k ? ' selected' : '') + '>' + cbAbLabel(k) + '</option>').join('') + '</select></label>';
  }
  const fixed = g.spells.filter(n => !g.choices.some(c => c.picked.includes(n)));
  if (fixed.length) h += '<div class="cb-dim">You always have: ' + cbEsc(fixed.join(', ')) + (g.daily.length ? ' — ' + cbEsc(g.daily.join(', ')) + ' once per long rest' : '') + '</div>';
  g.choices.forEach(c => {
    const lvl = /level=0/.test(c.filter) ? 'cantrip' : 'spell';
    h += '<div class="cb-spl"><span class="cb-spl-l">' + c.count + ' ' + lvl + (c.count === 1 ? '' : 's') + (c.daily ? ' · once a day' : '') + '</span>'
      + cbChecks(c.options.map(n => ({ value: key + '||' + n, label: n })), c.picked.map(n => key + '||' + n), c.count, 'cb-fspell') + '</div>';
  });
  return h;
}

CB_RENDER.equipment = () => {
  const b = CB.build, R = CB.R;
  const cls = sktRulesClass(R, b.cls), bg = sktBuildBackground(R, b);
  let html = '<h3>Equipment</h3>';
  if ((b.equipment || {}).materialized){
    html += '<div class="cb-note">This character’s inventory is kept on their sheet now — what they carry, equipped and attuned. The starting kit no longer applies.</div>'
      + '<div class="cb-dim">Carrying: ' + cbEsc((b.items || []).map(m => m.name + ((m.qty || 1) > 1 ? ' ×' + m.qty : '')).join(', ') || 'nothing') + '</div>';
    const rec = CB.rec;
    return html + '<h4>Result</h4><div class="cb-note">AC ' + rec.ac + (rec.sheet.acSource ? ' (' + cbEsc(rec.sheet.acSource) + ')' : '') + '</div>';
  }
  const itemText = (it) => typeof it === 'string' ? _sktTitleCase(sktRefName(it))
    : it.value ? (it.value / 100) + ' gp'
    : it.item ? (it.quantity > 1 ? it.quantity + ' × ' : '') + (it.displayName || _sktTitleCase(sktRefName(it.item)))
    : it.special ? it.special : it.equipmentType ? _SKT_EQ_LABEL[it.equipmentType] || 'an item of your choice' : '';
  const blockHtml = (blocks, kind) => (blocks || []).map((block, i) => {
    const letters = Object.keys(block).filter(k => k !== '_');
    const fixed = (block._ || []).map(itemText).filter(Boolean).join(', ');
    const cur = kind === 'cls' ? (R.edition === '2024' ? b.equipment.cls : (b.equipment.clsBlocks || [])[i]) : (R.edition === '2024' ? b.equipment.bg : (b.equipment.bgBlocks || [])[i]);
    const chosen = letters.includes(cur) ? cur : letters[0];
    let out = '';
    if (letters.length){
      out += '<div class="cb-eqblock">' + letters.map(l => {
        const items = block[l];
        const picks = items.map((it, j) => it && it.equipmentType && l === chosen
          ? '<select class="cb-sel" data-cb-eqpick="' + kind + ':' + i + ':' + ((block._ || []).length + j) + '">' + sktEquipmentOptions(R, it.equipmentType).map(n => '<option' + ((b.equipment.picks || {})[kind + ':' + i + ':' + ((block._ || []).length + j)] === n.toLowerCase() || (!(b.equipment.picks || {})[kind + ':' + i + ':' + ((block._ || []).length + j)] && _SKT_EQ_DEFAULT[it.equipmentType] === n.toLowerCase()) ? ' selected' : '') + ' value="' + cbEsc(n.toLowerCase()) + '">' + cbEsc(n) + '</option>').join('') + '</select>' : '').join('');
        return '<label class="cb-eqopt' + (l === chosen ? ' on' : '') + '"><input type="radio" name="eq-' + kind + '-' + i + '" data-cb-eq="' + kind + ':' + i + ':' + l + '"' + (l === chosen ? ' checked' : '') + '>'
          + '<b>(' + l.toUpperCase() + ')</b> ' + cbEsc(items.map(itemText).filter(Boolean).join(', ')) + picks + '</label>';
      }).join('') + '</div>';
    }
    if (fixed) out += '<div class="cb-dim">Also: ' + cbEsc(fixed) + '</div>';
    return out;
  }).join('');
  const goldAlt = R.edition === '2014' ? sktClassGold(cls) : null;
  const takingGold = goldAlt && typeof b.equipment.clsGold === 'number';
  if (goldAlt){
    html += '<h4>' + cbEsc(cls.name) + '</h4><div class="cb-seg"><button class="' + (takingGold ? '' : 'on') + '" data-cb-clsgold="kit">Take the equipment</button>'
      + '<button class="' + (takingGold ? 'on' : '') + '" data-cb-clsgold="gold">Take ' + cbEsc(goldAlt.text) + ' instead</button></div>';
    if (takingGold) html += '<div class="cb-row cb-goldrow"><label class="cb-f">Gold<input type="number" min="0" data-cb-clsgoldv value="' + b.equipment.clsGold + '"></label>'
      + '<button class="btn" data-cb-clsgold="roll">🎲 Roll ' + cbEsc(goldAlt.text) + '</button><button class="btn" data-cb-clsgold="avg">Average (' + goldAlt.avg + ')</button></div>'
      + '<div class="cb-dim">Buy gear with it under "Magic items and gear" below, or on the character sheet’s Inventory.</div>';
  }
  if (takingGold){ /* the class's kit is not taken */ }
  else if (cls && cls.equipment && Array.isArray(cls.equipment.defaultData)) html += (goldAlt ? '' : '<h4>' + cbEsc(cls.name) + '</h4>') + blockHtml(cls.equipment.defaultData, 'cls');
  else if (!cls) html += '<div class="cb-dim">Choose a class first.</div>';
  if (bg && (bg.equipment || []).length) html += '<h4>' + cbEsc(bg.name) + '</h4>' + blockHtml(bg.equipment, 'bg');
  html += cbGearHtml();
  const rec = CB.rec;
  const gold = sktBuildEquipment(b, R).gold;
  html += '<h4>Result</h4>' + (gold ? '<div class="cb-note">Starting gold: <b>' + gold + ' gp</b> — kept on the character</div>' : '') + '<div class="cb-note">AC ' + rec.ac + (rec.sheet.acSource ? ' (' + cbEsc(rec.sheet.acSource) + ')' : '') + '</div>'
    + '<div class="cb-attacks">' + rec.sheet.attacks.map(a => '<div class="cb-atk"><b>' + cbEsc(a.name) + '</b><span>' + cbEsc(a.atkBonus) + '</span><span>' + cbEsc(a.damage) + '</span>' + (a.mastery ? '<i>' + cbEsc(a.mastery) + '</i>' : '') + '</div>').join('') + '</div>';
  return html;
};
function _sktTitleCase(s){ return _sktTitle(s); }

// Magic items and gear given since the kit: a +1 longsword, magic armour, a
// Ring of Protection, a shield bought in town. Searched by name; a variant
// ("+1 Weapon", "Flame Tongue") asks which weapon or armour it is. There was
// no way to give a built character anything before.
function cbGearEntries(){
  const R = CB.R;
  // Plain weapons and armour need no download; the magic list does.
  const plain = Object.keys(R.items).filter(k => /^(M|R|LA|MA|HA|S)(\||$)/.test(String(R.items[k].type)))
    .map(k => ({ kind: 'base', name: R.items[k].name, base: k, rarity: '', source: R.items[k].source, text: '' }));
  return (CB.magic || []).concat(plain);
}
// The price of an item in copper, when the data has one.
function cbGearPrice(e, bases){
  if (!e) return 0;
  if (e.kind === 'base'){ const bi = CB.R.items[e.base]; return (bi && bi.value) || 0; }
  if (e.kind === 'variant'){ const bi = CB.magicBase && CB.R.items[CB.magicBase]; return bases && bi && e.value ? e.value + (bi.value || 0) : 0; }
  return e.value || 0;
}
function cbGearFind(name){
  const n = String(name || '').trim().toLowerCase();
  return n ? cbGearEntries().find(e => e.name.toLowerCase() === n) || null : null;
}
function cbGearHtml(){
  const b = CB.build, R = CB.R;
  if (CB.magicEd !== R.edition){
    CB.magic = null; CB.magicEd = R.edition;
    sktMagicLoad(R.edition).then(list => { if (CB && CB.magicEd === R.edition){ CB.magic = list; if (CB.step === 'equipment') cbRender(); } })
      .catch(e => { if (CB){ CB.magicErr = e.message; if (CB.step === 'equipment') cbRender(); } });
  }
  const items = b.items || [];
  const attuned = items.filter(m => m.reqAttune && m.attuned).length;
  let h = '<h4>Magic items and gear</h4><div class="cb-dim">Anything found or bought since: a +1 longsword, magic armour, a Ring of Protection, a shield. The sheet applies their bonuses. Up to three can be attuned.</div>';
  const e = cbGearFind(CB.magicQ);
  const bases = e && e.kind === 'variant' ? sktMagicBases(R, e) : null;
  h += '<div class="cb-row cb-gear-add"><input class="cb-grow" data-cb-magicq list="cb-magic-dl" placeholder="' + (CB.magic ? 'Search items…' : CB.magicErr ? 'Weapons and armour (the magic item list did not load)' : 'Loading the item list…') + '" value="' + cbEsc(CB.magicQ || '') + '">'
    + (bases ? '<select class="cb-sel" data-cb-magicbase><option value="">Which one?</option>' + bases.map(k => '<option value="' + cbEsc(k) + '"' + (CB.magicBase === k ? ' selected' : '') + '>' + cbEsc(R.items[k].name) + '</option>').join('') + '</select>' : '')
    + '<button class="btn" data-cb="magic-add"' + (e && (!bases || (CB.magicBase && bases.includes(CB.magicBase))) ? '' : ' disabled') + '>Add</button>'
    + (cbGearPrice(e, bases) ? '<button class="btn primary" data-cb="magic-buy">Buy (' + sktCoinText(cbGearPrice(e, bases)) + ')</button>' : '') + '</div>'
    + '<datalist id="cb-magic-dl">' + cbGearEntries().map(x => '<option value="' + cbEsc(x.name) + '">' + cbEsc(x.rarity || '') + '</option>').join('') + '</datalist>';
  if (e && e.text) h += '<div class="cb-note cb-gear-prev"><b>' + cbEsc(e.name) + '</b> <span class="cb-dim">' + cbEsc([e.rarity, e.reqAttune ? 'attunement' : ''].filter(Boolean).join(' · ')) + '</span>' + cbFeatureText(e.text) + '</div>';
  if (items.length){
    h += '<div class="cb-gear-list">' + items.map((m, i) => '<div class="cb-gear"><b>' + cbEsc(m.name) + '</b>'
      + (m.rarity ? ' <span class="cb-dim">' + cbEsc(m.rarity) + '</span>' : '')
      + (m.reqAttune ? '<label class="cb-inline"><input type="checkbox" data-cb-attune="' + i + '"' + (m.attuned ? ' checked' : '') + (!m.attuned && attuned >= 3 ? ' disabled' : '') + '> Attuned</label>' : '')
      + '<button class="btn" data-cb-itemdel="' + i + '" aria-label="Remove ' + cbEsc(m.name) + '">Remove</button></div>').join('') + '</div>'
      + (items.some(m => m.reqAttune) ? '<div class="cb-dim">Attuned: ' + attuned + ' of 3</div>' : '');
  }
  return h;
}
const _SKT_EQ_LABEL = { weaponMartial: 'a martial weapon', weaponMartialMelee: 'a martial melee weapon', weaponSimple: 'a simple weapon',
  weaponSimpleMelee: 'a simple melee weapon', weaponSimpleRanged: 'a simple ranged weapon', focusSpellcastingArcane: 'an arcane focus',
  focusSpellcastingDruidic: 'a druidic focus', focusSpellcastingHoly: 'a holy symbol', instrumentMusical: 'a musical instrument',
  toolArtisan: 'artisan’s tools', setGaming: 'a gaming set' };

const CB_ALIGNMENTS = ['Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'True Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil', 'Unaligned'];
const CB_DETAIL_LINES = [['gender', 'Gender'], ['age', 'Age'], ['height', 'Height'], ['weight', 'Weight'], ['eyes', 'Eyes'], ['hair', 'Hair'], ['skin', 'Skin'], ['faith', 'Faith'], ['lifestyle', 'Lifestyle']];
const CB_DETAIL_TEXT = [['appearance', 'Appearance'], ['personality', 'Personality traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws'],
                        ['allies', 'Allies & organizations'], ['enemies', 'Enemies'], ['backstory', 'Backstory']];
CB_RENDER.details = () => {
  const d = CB.build.details || {};
  return '<h3>Details</h3><div class="cb-dim">All optional — who they are, for the table.</div>'
    + '<label class="cb-f">Alignment<select class="cb-sel" data-cb-detail="alignment"><option value="">—</option>'
    +   CB_ALIGNMENTS.map(a => '<option' + (d.alignment === a ? ' selected' : '') + '>' + a + '</option>').join('') + '</select></label>'
    + '<div class="cb-detail-grid">' + CB_DETAIL_LINES.map(([k, l]) => '<label class="cb-f">' + l + '<input data-cb-detail="' + k + '" value="' + cbEsc(d[k] || '') + '" maxlength="40"></label>').join('') + '</div>'
    + CB_DETAIL_TEXT.map(([k, l]) => '<label class="cb-f">' + l + '<textarea data-cb-detail="' + k + '" rows="' + (k === 'backstory' ? 5 : 2) + '" maxlength="4000">' + cbEsc(d[k] || '') + '</textarea></label>'
      + cbCharacteristicsHtml(k)).join('');
};
// The background's own suggestions (a 2014 background's d8 of traits and d6s
// of ideals, bonds and flaws): pick one or roll. A 2024 background borrows
// the 2014 printing's tables, which the 2024 book dropped.
function cbCharacteristics(){
  const b = CB.build;
  const own = (sktBuildBackground(CB.R, b) || {}).characteristics;
  if (own) return own;
  if (CB.R.edition === '2024' && b.background){
    if (!CB.R14 && !CB.R14loading){ CB.R14loading = true; sktRulesLoad('2014').then(R => { if (CB){ CB.R14 = R; if (CB.step === 'details') cbRender(); } }).catch(() => {}); }
    const old = CB.R14 && sktRulesBackground(CB.R14, b.background);
    return old && old.characteristics || null;
  }
  return null;
}
function cbCharacteristicsHtml(k){
  if (!['personality', 'ideals', 'bonds', 'flaws'].includes(k)) return '';
  const list = (cbCharacteristics() || {})[k];
  if (!list || !list.length) return '';
  return '<div class="cb-suggest"><select class="cb-sel" data-cb-suggest="' + k + '"><option value="">Suggestions from ' + cbEsc(CB.build.background) + '…</option>'
    + list.map((t, i) => '<option value="' + i + '">' + (i + 1) + '. ' + cbEsc(t.length > 90 ? t.slice(0, 88) + '…' : t) + '</option>').join('') + '</select>'
    + '<button class="btn small" data-cb-suggestroll="' + k + '" title="Roll d' + list.length + '">🎲 d' + list.length + '</button></div>';
}
function cbAddCharacteristic(k, i){
  const list = (cbCharacteristics() || {})[k]; if (!list || !list[i]) return;
  cbSet(b => {
    b.details = Object.assign({}, b.details);
    const cur = String(b.details[k] || '').trim();
    b.details[k] = cur ? cur + '\n' + list[i] : list[i];
  });
}

CB_RENDER.review = () => {
  const rec = CB.rec, b = CB.build;
  const sh = rec.sheet;
  const feats = (sh.featureList || []).filter(f => !f.info);
  const mech = feats.filter(f => f.mech).length;
  const saves = SKT_ABS.map(k => '<div class="cb-sk' + (sh.saveProf.includes(k) ? ' prof1' : '') + '"><span>' + cbAbLabel(k) + '</span><b>' + sktSigned(sh.saves[k]) + '</b></div>').join('');
  const res = (rec.resources || []).filter(r => r.type === 'pool').map(r => cbEsc(r.name) + ' ' + r.max + (r.recharge === 'short' ? ' (short rest)' : r.recharge === 'short-one' ? ' (1 back on a short rest)' : '')).join(' · ');
  const todo = sktBuildTodo(b, CB.R).filter(t => !t.soft);
  return '<h3>Review</h3>'
    + (CB.convertFrom ? cbConvertNote() : '')
    + (todo.length ? '<div class="cb-warn">Still to choose: ' + cbEsc(todo.map(t => t.what).join(', ')) + '</div>' : '')
    + '<div class="cb-note cb-review-who">' + cbEsc([sh.size, (sh.details || {}).alignment, typeof rec.gold === 'number' ? rec.gold + ' gp' : ''].filter(Boolean).join(' · ')) + '</div>'
    + '<div class="cb-review">'
    + '<div><h4>Saving throws</h4><div class="cb-skilltable">' + saves + '</div></div>'
    + '<div><h4>Attacks</h4><div class="cb-attacks">' + sh.attacks.map(a => '<div class="cb-atk"><b>' + cbEsc(a.name) + '</b><span>' + cbEsc(a.atkBonus) + '</span><span>' + cbEsc(a.damage) + '</span></div>').join('') + '</div>'
    + (sh.attacksPerAction > 1 ? '<div class="cb-dim">' + sh.attacksPerAction + ' attacks per Attack action</div>' : '') + '</div>'
    + '</div>'
    + (res ? '<h4>Resources</h4><div class="cb-note">' + res + '</div>' : '')
    + (sh.spellSaveDc ? '<h4>Spellcasting</h4><div class="cb-note">DC ' + sh.spellSaveDc + ' · attack ' + cbEsc(sh.spellAtkBonus) + ' · ' + cbEsc((sh.spells || []).join(', ') || 'no spells chosen') + '</div>'
      + (sh.spellbook ? '<div class="cb-dim">Spellbook: ' + cbEsc(sh.spellbook.join(', ') || 'empty') + '</div>' : '') : '')
    + (sh.senses || (rec.resistances || []).length ? '<div class="cb-note">' + cbEsc([sh.senses, (rec.resistances || []).length ? 'Resistant to ' + rec.resistances.join(', ') : ''].filter(Boolean).join(' · ')) + '</div>' : '')
    + (sh.notes || []).map(n => '<div class="cb-dim">• ' + cbEsc(n) + '</div>').join('')
    + '<h4>Features <span class="cb-dim">' + mech + ' of ' + feats.length + ' applied to the sheet automatically</span></h4>'
    + feats.map(f => '<div class="cb-feat"><b>' + cbEsc(f.name) + '</b> <span class="cb-dim">' + cbEsc(f.from) + (f.level ? ' ' + f.level : '') + '</span> '
      + (f.mech ? '<span class="cb-badge" title="The sheet applies this one">applied</span>' : '<span class="cb-badge text" title="Shown as text; apply it at the table">text</span>')
      + cbFeatureText(f.text) + '</div>').join('');
};

// ── Events ───────────────────────────────────────────────────────────────────
function cbSet(fn){ fn(CB.build); CB.scrollTop = (document.querySelector('#cb-root .cb-main') || {}).scrollTop; cbRender(); }
function cbToggle(list, v, max){
  const i = list.indexOf(v);
  if (i >= 0){ list.splice(i, 1); return; }
  if (max == null || list.length < max) list.push(v);
}

function cbOnClick(e){
  if (!CB) return;
  const t = e.target.closest('button, [data-cb-step]'); if (!t) return;
  const d = t.dataset;
  if (d.cb === 'close') return cbAskClose();
  if (d.cbStep){ CB.step = d.cbStep; CB.scrollTop = 0; cbRender(); return; }
  const vis = cbVisibleSteps(), at = vis.findIndex(s => s.id === CB.step);
  if (d.cb === 'next'){ CB.step = vis[Math.min(vis.length - 1, at + 1)].id; CB.scrollTop = 0; cbRender(); return; }
  if (d.cb === 'back'){ CB.step = vis[Math.max(0, at - 1)].id; CB.scrollTop = 0; cbRender(); return; }
  if (d.cb === 'save') return cbSave();
  if (d.cb === 'savesheet'){
    const done0 = CB.onDone;
    CB.onDone = (saved, idx) => { if (typeof done0 === 'function') done0(saved, idx); if (saved && typeof openCharSheet === 'function') openCharSheet(saved.id); };
    return cbSave();
  }
  if (d.cb === 'suggest') return cbSet(b => cbSuggestScores(b));
  if (d.cb === 'quick') return cbSet(() => cbQuickBuild());
  if (d.cb === 'upload'){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', async ev => {
      const f = ev.target.files[0]; if (!f) return;
      try {
        const url = typeof showCropModal === 'function' ? await showCropModal(f, { size: 96, shape: 'circle', title: 'Crop the portrait' }) : await fileToIconDataUrl(f, 96);
        if (url && CB) cbSet(b => { b.icon = url; });
      } catch(err){ if (typeof showToast === 'function') showToast('Upload failed: ' + err.message); }
    });
    inp.click(); return;
  }
  if (d.cb === 'magic-add' || d.cb === 'magic-buy'){
    const e = cbGearFind(CB.magicQ); if (!e) return;
    const price = d.cb === 'magic-buy' ? cbGearPrice(e, e.kind === 'variant' ? sktMagicBases(CB.R, e) : null) : 0;
    if (price && sktBuildEquipment(CB.build, CB.R).gold * 100 < price){ if (typeof showToast === 'function') showToast('Not enough money for ' + e.name); return; }
    const it = e.kind === 'base' ? { name: e.name, base: e.base } : sktMagicMake(CB.R, e, CB.magicBase);
    if (!it) return;
    CB.magicQ = ''; CB.magicBase = '';
    return cbSet(b => { b.items = (b.items || []).concat([it]); if (price) b.equipment = Object.assign({}, b.equipment, { spent: ((b.equipment || {}).spent || 0) + price }); });
  }
  if (d.cbItemdel != null) return cbSet(b => { b.items = (b.items || []).filter((x, i) => i !== +d.cbItemdel); });
  if (d.cb === 'roll') return cbSet(b => {
    const r = () => { const d4 = [sktD(6), sktD(6), sktD(6), sktD(6)].sort((x, y) => y - x); return d4[0] + d4[1] + d4[2]; };
    b.abilities.rolled = [r(), r(), r(), r(), r(), r()].sort((x, y) => y - x);
    b.abilities.assign = {}; SKT_ABS.forEach((k, i) => { b.abilities.assign[k] = i; b.abilities.base[k] = b.abilities.rolled[i]; });
  });
  if (d.cbEd && d.cbEd !== CB.build.edition) return cbSwitchEdition(d.cbEd);
  if (d.cbIcon) return cbSet(b => { b.icon = d.cbIcon; });
  if (d.cbCls) return cbSet(b => {
    if (b.cls === d.cbCls) return;
    b.cls = d.cbCls; b.subclass = ''; b.skills = []; b.expertise = []; b.cantrips = []; b.spells = []; b.spellbook = [];
    cbFitLevels(b);
    if (b.toolPicks) delete b.toolPicks.class;
    b.optional = {}; b.masteries = []; b.equipment = { cls: 'A', bg: b.equipment.bg || 'A', picks: {} };
  });
  if (d.cbSub) return cbSet(b => { if (b.subclass !== d.cbSub) b.subclassPick = ''; b.subclass = d.cbSub; });
  if (d.cbMcsub){ const [i, s] = d.cbMcsub.split('||'); return cbSet(b => { if (b.multi[+i]){ if (b.multi[+i].subclass !== s) b.multi[+i].subclassPick = ''; b.multi[+i].subclass = s; } }); }
  if (d.cbMclvl){
    const [i, dlt] = d.cbMclvl.split(':').map(Number);
    return cbSet(b => {
      const m = b.multi[i]; if (!m) return;
      // "+" is disabled once the first class is down to one level.
      if (dlt > 0) m.level = (+m.level || 1) + 1;
      if (dlt < 0 && m.level > 1) m.level -= 1;
    });
  }
  if (d.cbMcdel != null) return cbSet(b => { b.multi.splice(+d.cbMcdel, 1); });
  if (d.cbLvlto != null) return cbSet(b => {
    // Level up: which class the new level goes to. Undo the last choice,
    // then give it to this one (the first class takes it by default).
    b.multi = JSON.parse(JSON.stringify(CB.multi0 || []));
    if (d.cbLvlto !== 'first'){ const m = b.multi[+d.cbLvlto]; if (m) m.level = (+m.level || 1) + 1; }
    CB.lvlTo = d.cbLvlto;
  });
  if (d.cbSpecies) return cbSet(b => {
    if (b.species === d.cbSpecies) return;
    b.species = d.cbSpecies; b.subspecies = ''; b.speciesAsi = {}; b.speciesSkills = []; b.speciesChoice = {};
    if (b.toolPicks) delete b.toolPicks.species;
    b.originFeat = '';
  });
  if (d.cbSubspecies) return cbSet(b => { b.subspecies = d.cbSubspecies; b.speciesAsi = {}; b.speciesSkills = []; b.originFeat = ''; delete b.speciesChoice.spells; });
  if (d.cbAncestry) return cbSet(b => { b.speciesChoice.ancestry = d.cbAncestry; });
  if (d.cbSpresist) return cbSet(b => { b.speciesChoice.resist = d.cbSpresist; });
  if (d.cbMcpick){ const [i, v] = d.cbMcpick.split('||'); return cbSet(b => { if (b.multi[+i]) b.multi[+i].subclassPick = v; }); }
  if (d.cbSubpick) return cbSet(b => { b.subclassPick = d.cbSubpick; });
  if (d.cbLineage) return cbSet(b => { if (b.speciesChoice.lineage !== d.cbLineage) delete b.speciesChoice.spells; b.speciesChoice.lineage = d.cbLineage; });
  if (d.cbSize) return cbSet(b => { b.size = d.cbSize; });
  if (d.cbSrcall) return cbSet(b => { if (d.cbSrcall === '1') delete b.books; else b.books = []; });
  if (d.cbSpinfo != null){ e.preventDefault(); const same = CB.spInfo === d.cbSpinfo && CB.spInfoIn === (d.cbSpin || ''); CB.spInfo = same ? '' : (d.cbSpinfo || ''); CB.spInfoIn = d.cbSpin || ''; return cbRender(); }
  if (d.cbClsgold){
    const g = sktClassGold(sktRulesClass(CB.R, CB.build.cls)); if (!g) return;
    const roll = () => { let t = 0; for (let k = 0; k < g.n; k++) t += sktD(g.d); return t * g.mult; };
    return cbSet(b => {
      b.equipment = Object.assign({}, b.equipment);
      if (d.cbClsgold === 'kit') delete b.equipment.clsGold;
      else if (d.cbClsgold === 'gold') b.equipment.clsGold = g.avg;
      else if (d.cbClsgold === 'roll') b.equipment.clsGold = roll();
      else if (d.cbClsgold === 'avg') b.equipment.clsGold = g.avg;
    });
  }
  if (d.cbSuggestroll){ const list = (cbCharacteristics() || {})[d.cbSuggestroll] || []; if (list.length) cbAddCharacteristic(d.cbSuggestroll, sktD(list.length) - 1); return; }
  if (d.cbSpmode) return cbSet(b => { if ((b.speciesChoice.asiMode || '21') !== d.cbSpmode){ b.speciesChoice.asiMode = d.cbSpmode; b.speciesAsi = {}; } });
  if (d.cbBg) return cbSet(b => { if (b.background !== d.cbBg){ b.background = d.cbBg; b.bgAsi = {}; b.bgSkills = []; } });
  if (d.cbBgmode) return cbSet(b => {
    b.bgAsiMode = d.cbBgmode; b.bgAsi = {};
    if (d.cbBgmode === '111'){
      const bg = sktBuildBackground(CB.R, b);
      const from = bg && bg.ability && bg.ability[0] && bg.ability[0].choose && bg.ability[0].choose.weighted ? bg.ability[0].choose.weighted.from : [];
      from.forEach(k => { b.bgAsi[k] = 1; });
    }
  });
  if (d.cbMethod) return cbSet(b => {
    b.abilities.method = d.cbMethod;
    if (d.cbMethod === 'array'){ b.abilities.assign = {}; SKT_ABS.forEach((k, i) => { b.abilities.assign[k] = i; b.abilities.base[k] = SKT_STANDARD_ARRAY[i]; }); }
    if (d.cbMethod === 'pointbuy') SKT_ABS.forEach(k => { b.abilities.base[k] = 8; });
  });
  if (d.cbPb) return cbSet(b => {
    const [k, n] = d.cbPb.split(':'); const v = Math.max(8, Math.min(15, b.abilities.base[k] + +n));
    const spent = SKT_ABS.reduce((s, x) => s + SKT_POINT_BUY[x === k ? v : b.abilities.base[x]], 0);
    if (spent <= 27) b.abilities.base[k] = v;
  });
  if (d.cbHp) return cbSet(b => { b.hp = b.hp || { rolls: {} }; if (d.cbHp === 'manual' && !b.hp.manual) b.hp.manual = CB.rec.hpMax; b.hp.method = d.cbHp; b.hp.rolls = b.hp.rolls || {}; });
  if (d.cbHpdice) return cbSet(b => {
    const cls = sktRulesClass(CB.R, b.cls); b.hp.rolls[d.cbHpdice] = sktD(cls.hd);
  });
  if (d.cbFchoice) return cbSet(b => {
    const [feat, val] = d.cbFchoice.split('||');
    b.featureChoices = b.featureChoices || {};
    b.featureChoices[feat] = val;
  });
  if (d.cbAsitype) return cbSet(b => {
    const [l, type] = d.cbAsitype.split(':');
    b.asi[l] = type === 'asi' ? { type: 'asi', inc: {} } : { type: 'feat', feat: '' };
  });
}

function cbOnChange(e){
  if (!CB) return;
  const t = e.target, d = t.dataset;
  const v = t.value;
  const list = (key, max) => cbSet(b => { b[key] = b[key] || []; cbToggle(b[key], Object.values(d)[0], max); });
  if ('cbAllbooks' in d) return cbSet(b => { b.allBooks = t.checked; });
  if ('cbLegacy' in d) return cbSet(b => { b.legacy = t.checked; });
  if ('cbHpmanual' in d) return cbSet(b => { b.hp = Object.assign({}, b.hp, { manual: Math.max(1, parseInt(v, 10) || 1) }); });
  if (d.cbCbg && d.cbCbg !== 'name') return cbSet(b => { b.customBg = Object.assign({}, b.customBg, { [d.cbCbg]: d.cbCbg === 'languages' ? +v : v });
    if (d.cbCbg === 'languages') b.customBg.tools = (b.customBg.tools || []).slice(0, 2 - (+v || 0)); });
  if (d.cbCbgskill) return cbSet(b => { b.customBg = Object.assign({}, b.customBg); b.customBg.skills = (b.customBg.skills || []).slice(); cbToggle(b.customBg.skills, d.cbCbgskill, 2); });
  if (d.cbCbgab) return cbSet(b => { b.customBg = Object.assign({}, b.customBg); b.customBg.abilities = (b.customBg.abilities || []).slice(); cbToggle(b.customBg.abilities, d.cbCbgab, 3); b.bgAsi = {}; });
  if (d.cbCbgtool){ const c = CB.build.customBg || {}; const max = CB.R.edition === '2024' ? 1 : 2 - (+c.languages || 0);
    return cbSet(b => { b.customBg = Object.assign({}, b.customBg); b.customBg.tools = (b.customBg.tools || []).slice(); cbToggle(b.customBg.tools, d.cbCbgtool, max); }); }
  if (d.cbSrc){
    const all = sktOtherBooks(CB.R).map(x => x.source);
    return cbSet(b => {
      const cur = Array.isArray(b.books) ? b.books.slice() : all.slice();
      const at = cur.indexOf(d.cbSrc);
      if (t.checked && at < 0) cur.push(d.cbSrc);
      if (!t.checked && at >= 0) cur.splice(at, 1);
      if (all.every(x => cur.includes(x))) delete b.books; else b.books = cur;
    });
  }
  if ('cbClsgoldv' in d) return cbSet(b => { b.equipment = Object.assign({}, b.equipment, { clsGold: Math.max(0, parseInt(v, 10) || 0) }); });
  if ('cbQualified' in d) return cbSet(b => { b.showAllFeats = !t.checked; });
  if ('cbCustomorigin' in d) return cbSet(b => { b.speciesChoice = Object.assign({}, b.speciesChoice, { customOrigin: t.checked }); b.speciesAsi = {}; });
  if ('cbOptfeat' in d) return cbSet(b => { b.optionalFeatures = t.checked; });
  if ('cbAdvance' in d) return cbSet(b => { b.advancement = v; });
  if ('cbSpschool' in d){ CB.spSchool = v; return cbRender(); }
  if ('cbSpritual' in d){ CB.spRitual = t.checked; return cbRender(); }
  if ('cbSpconc' in d){ CB.spConc = t.checked; return cbRender(); }
  if ('cbMcadd' in d){
    if (!v) return;
    return cbSet(b => {
      if (sktClassLevels(b, CB.R)[0].level <= 1) return;
      b.multi = (b.multi || []).concat([{ cls: v, subclass: '', level: 1, skills: [], cantrips: [], spells: [], spellbook: [] }]);
    });
  }
  if (d.cbMcskill){
    const [i, k] = d.cbMcskill.split('||');
    const c2 = sktRulesClass(CB.R, (CB.build.multi[+i] || {}).cls);
    const sk = _sktSkillChoice(((c2 && c2.multiclassing || {}).proficienciesGained || {}).skills);
    return cbSet(b => { const m = b.multi[+i]; if (!m) return; m.skills = m.skills || []; cbToggle(m.skills, k, sk.count); });
  }
  if (d.cbMcspell){
    // Another class's cantrips, spells and spellbook: "i|kind|name".
    const [i, kind, name] = d.cbMcspell.split('|');
    const x = (sktBuildSpellcasting(CB.build, CB.R, sktBuildAbilities(CB.build, CB.R)).classes || []).find(c => c.entry === CB.build.multi[+i]);
    if (!x) return;
    return cbSet(b => {
      const m = b.multi[+i]; m[kind] = m[kind] || [];
      const max = kind === 'cantrips' ? x.sc.cantrips : kind === 'spellbook' ? x.sc.spellbook : (x.sc.prepared || x.sc.known);
      cbToggle(m[kind], name, max);
      if (kind === 'spellbook') m.spells = (m.spells || []).filter(n => m.spellbook.includes(n));
    });
  }
  if ('cbMagicq' in d){ CB.magicQ = v; CB.magicBase = ''; cbRender(); const q = document.querySelector('#cb-root [data-cb-magicq]'); if (q && !cbGearFind(v)) q.focus(); return; }
  if ('cbMagicbase' in d){ CB.magicBase = v; cbRender(); return; }
  if (d.cbAttune != null){
    const i = +d.cbAttune;
    return cbSet(b => {
      const m = b.items[i]; if (!m) return;
      const n = b.items.filter(x => x.reqAttune && x.attuned).length;
      if (m.attuned) m.attuned = false; else if (n < 3) m.attuned = true;
    });
  }
  if (d.cbSkill){ const cls = sktRulesClass(CB.R, CB.build.cls); return cbSet(b => cbToggle(b.skills, d.cbSkill, cls.skillChoice.count)); }
  if (d.cbExpert) return cbSet(b => cbToggle(b.expertise, d.cbExpert, cbExpertiseCount()));
  if (d.cbLang) return cbSet(b => cbToggle(b.languages, d.cbLang, cbLanguageCount()));
  if (d.cbTool){
    const [key, tool] = d.cbTool.split('||');
    const c = sktToolChoices(CB.build, CB.R).find(x => x.key === key); if (!c) return;
    return cbSet(b => { b.toolPicks = Object.assign({}, b.toolPicks); b.toolPicks[key] = (b.toolPicks[key] || []).slice(); cbToggle(b.toolPicks[key], tool, c.count); });
  }
  if (d.cbProfpick){
    const [feature, kind, k] = d.cbProfpick.split('||');
    const c = sktProfChoices(CB.build, CB.R).find(x => x.feature === feature && x.kind === kind);
    return cbSet(b => { b.profPicks = Object.assign({}, b.profPicks); const p = b.profPicks[feature] = Object.assign({}, b.profPicks[feature]); p[kind] = (p[kind] || []).slice(); cbToggle(p[kind], k, c ? c.count : 1); });
  }
  if (d.cbWizpick){
    const i = d.cbWizpick.indexOf('|'), lv = +d.cbWizpick.slice(0, i), n = d.cbWizpick.slice(i + 1);
    const x = sktFeatureSpellPicks(CB.build, CB.R).find(y => y.level === lv);
    return cbSet(b => {
      b.featureSpells = Object.assign({}, b.featureSpells);
      const all = (b.featureSpells[x.feature] || []).filter(m => (sktRulesSpell(CB.R, m) || {}).level !== lv);
      const mine = (b.featureSpells[x.feature] || []).filter(m => (sktRulesSpell(CB.R, m) || {}).level === lv);
      cbToggle(mine, n, x.count);
      b.featureSpells[x.feature] = all.concat(mine);
    });
  }
  if (d.cbSecret){
    const ms = sktMagicalSecrets(CB.build, CB.R);
    return cbSet(b => { b.secrets = (b.secrets || []).slice(); cbToggle(b.secrets, d.cbSecret, ms ? ms.count : 2); });
  }
  if (d.cbArcanum){
    const i = d.cbArcanum.indexOf('|'), lv = d.cbArcanum.slice(0, i), n = d.cbArcanum.slice(i + 1);
    return cbSet(b => { b.arcanum = Object.assign({}, b.arcanum); if (b.arcanum[lv] === n) delete b.arcanum[lv]; else b.arcanum[lv] = n; });
  }
  if (d.cbSpskill){
    const sp = sktRulesSpecies(CB.R, CB.build.species), sub = sp && sktSpeciesSub(sp, CB.build);
    const ch = cbSpeciesSkillChoice(sp, sub);
    return cbSet(b => cbToggle(b.speciesSkills, d.cbSpskill, ch ? ch.count : 1));
  }
  if (d.cbSpasi){
    const sp = sktRulesSpecies(CB.R, CB.build.species), sub = sp && sktSpeciesSub(sp, CB.build);
    const ch = sktSpeciesAsiChoice(sp, sub, CB.build);
    const count = ch.flex ? 3 : ch.count, amount = ch.flex ? 1 : ch.amount;
    return cbSet(b => {
      if (b.speciesAsi[d.cbSpasi]) delete b.speciesAsi[d.cbSpasi];
      else if (Object.keys(b.speciesAsi).length < count) b.speciesAsi[d.cbSpasi] = amount;
    });
  }
  if (d.cbSpflex){
    const amt = +d.cbSpflex;
    return cbSet(b => {
      const inc = {};
      Object.keys(b.speciesAsi || {}).forEach(k => { if (b.speciesAsi[k] !== amt) inc[k] = b.speciesAsi[k]; });
      if (v) inc[v] = amt;
      b.speciesAsi = inc;
    });
  }
  if (d.cbCantrip){ const sc = sktBuildSpellcasting(CB.build, CB.R, sktBuildAbilities(CB.build, CB.R)); return cbSet(b => cbToggle(b.cantrips, d.cbCantrip, sc.cantrips)); }
  if (d.cbSpell){
    const sc = sktBuildSpellcasting(CB.build, CB.R, sktBuildAbilities(CB.build, CB.R));
    return cbSet(b => cbToggle(b.spells, d.cbSpell, sc.prepared || sc.known));
  }
  if (d.cbMastery) return cbSet(b => cbToggle(b.masteries, d.cbMastery, cbMasteryCount()));
  if (d.cbBook){
    const sc = sktBuildSpellcasting(CB.build, CB.R, sktBuildAbilities(CB.build, CB.R));
    return cbSet(b => {
      if (!b.spellbook || !b.spellbook.length) b.spellbook = (b.spells || []).slice();
      cbToggle(b.spellbook, d.cbBook, sc.spellbook);
      b.spells = (b.spells || []).filter(n => b.spellbook.includes(n));   // prepared only from the book
    });
  }
  if (d.cbFspell){
    const [feat, name] = d.cbFspell.split('||');
    const g = feat === '@species' ? sktSpeciesSpellGrant(CB.R, CB.build) : sktFeatSpells(CB.build, CB.R).find(x => x.feat === feat);
    const c = g && g.choices.find(x => x.options.includes(name));
    return cbSet(b => {
      const fc = feat === '@species' ? b.speciesChoice : (b.featChoices[feat] = Object.assign({}, b.featChoices[feat]));
      fc.spells = (fc.spells || []).slice();
      const i = fc.spells.indexOf(name);
      if (i >= 0) fc.spells.splice(i, 1);
      else if (c && c.picked.length < c.count) fc.spells.push(name);
    });
  }
  if (d.cbFslist) return cbSet(b => { b.featChoices[d.cbFslist] = Object.assign({}, b.featChoices[d.cbFslist], { spellList: v, spells: [] }); });
  if (d.cbFsab === '@species') return cbSet(b => { b.speciesChoice.spellAbility = v; });
  if (d.cbFsab) return cbSet(b => { b.featChoices[d.cbFsab] = Object.assign({}, b.featChoices[d.cbFsab], { spellAbility: v }); });
  if (d.cbDetail === 'alignment') return cbSet(b => { b.details = Object.assign({}, b.details, { alignment: v }); });
  if (d.cbSuggest){ if (v !== '') cbAddCharacteristic(d.cbSuggest, +v); return; }
  const optKey = Object.keys(d).find(k => /^cbOpt/.test(k));
  if (optKey){
    const o = sktOptionalChoices(CB.build, CB.R).find(x => 'cbOpt' + cbSlug(x.name).replace(/-(\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, c => c.toUpperCase()) === optKey);
    if (o) return cbSet(b => { b.optional[o.name] = b.optional[o.name] || []; cbToggle(b.optional[o.name], d[optKey], o.count); });
  }
  if ('cbOriginfeat' in d) return cbSet(b => { b.originFeat = v; });
  if ('cbBgfeat' in d) return cbSet(b => { b.bgFeat = +v || 0; });
  if (d.cbBg2 !== undefined || d.cbBg1 !== undefined){
    return cbSet(b => {
      const keep = {};
      const two = d.cbBg2 !== undefined ? v : Object.keys(b.bgAsi).find(k => b.bgAsi[k] === 2);
      const one = d.cbBg1 !== undefined ? v : Object.keys(b.bgAsi).find(k => b.bgAsi[k] === 1);
      if (two) keep[two] = 2; if (one && one !== two) keep[one] = 1;
      b.bgAsi = keep;
    });
  }
  if (d.cbAssign){
    return cbSet(b => {
      const pool = b.abilities.method === 'array' ? SKT_STANDARD_ARRAY : (b.abilities.rolled || []);
      const a = b.abilities.assign = b.abilities.assign || {};
      const want = +v, k = d.cbAssign;
      // Each value is used once: swap with whoever had it.
      const other = SKT_ABS.find(x => x !== k && a[x] === want);
      if (other != null) a[other] = a[k];
      a[k] = want;
      SKT_ABS.forEach(x => { if (a[x] != null) b.abilities.base[x] = pool[a[x]]; });
    });
  }
  if (d.cbScore) return cbSet(b => { b.abilities.base[d.cbScore] = Math.max(3, Math.min(20, parseInt(v, 10) || 10)); });
  if (d.cbHproll) return cbSet(b => { b.hp.rolls[d.cbHproll] = parseInt(v, 10) || ''; });
  if (d.cbAsiab){
    return cbSet(b => {
      const [l, slot] = d.cbAsiab.split(':');
      const p = b.asi[l] = b.asi[l] && b.asi[l].type === 'asi' ? b.asi[l] : { type: 'asi', inc: {} };
      const picks = [];
      Object.keys(p.inc).forEach(k => { for (let n = 0; n < p.inc[k]; n++) picks.push(k); });
      picks[+slot] = v || undefined;
      p.inc = {};
      picks.filter(Boolean).forEach(k => { p.inc[k] = (p.inc[k] || 0) + 1; });
    });
  }
  if (d.cbAsifeat) return cbSet(b => { b.asi[d.cbAsifeat] = { type: 'feat', feat: v }; });
  if (d.cbFeatab){
    const [name, amount] = d.cbFeatab.split(':');
    return cbSet(b => { b.featChoices[name] = Object.assign({}, b.featChoices[name], { inc: v ? { [v]: +amount || 1 } : {} }); });
  }
  if (d.cbFeatsave) return cbSet(b => { b.featChoices[d.cbFeatsave] = Object.assign({}, b.featChoices[d.cbFeatsave], { save: v }); });
  if (d.cbFc){
    const [feat, kind, val] = d.cbFc.split('||');
    const c = sktFeatChoices(CB.R, CB.build, feat, CB.rec).choices.find(x => x.kind === kind); if (!c) return;
    return cbSet(b => {
      const ch = b.featChoices[feat] = Object.assign({}, b.featChoices[feat]);
      if (kind === 'skillsTools'){
        const k = val.startsWith('s:') ? 'skills' : 'tools', v2 = val.slice(2);
        ch[k] = (ch[k] || []).slice();
        const at = ch[k].indexOf(v2);
        if (at >= 0) ch[k].splice(at, 1);
        else if ((ch.skills || []).length + (ch.tools || []).length < c.count) ch[k].push(v2);
      } else { ch[kind] = (ch[kind] || []).slice(); cbToggle(ch[kind], val, c.count); }
    });
  }
  if (d.cbEq){
    const [kind, i, letter] = d.cbEq.split(':');
    return cbSet(b => {
      if (CB.R.edition === '2024') b.equipment[kind] = letter;
      else { const k = kind + 'Blocks'; b.equipment[k] = b.equipment[k] || []; b.equipment[k][+i] = letter; }
    });
  }
  if (d.cbEqpick) return cbSet(b => { b.equipment.picks = b.equipment.picks || {}; b.equipment.picks[d.cbEqpick] = v; });
}

// Typing in the name or level box: update without a full re-render, so the
// field keeps focus and the caret stays where it is.
function cbOnInput(e){
  if (!CB) return;
  const t = e.target, d = t.dataset;
  if (d.cbIn === 'name'){ CB.build.name = t.value; cbRefreshSide(); return; }
  if (d.cbCbg === 'name'){ CB.build.customBg = Object.assign({}, CB.build.customBg, { name: t.value }); return; }
  if ('cbSpq' in d){
    // Filter as you type, keeping the caret in the box.
    CB.spQ = t.value; clearTimeout(CB._spT);
    CB._spT = setTimeout(() => {
      if (!CB) return; const at = t.selectionStart; cbRender();
      const q = document.querySelector('#cb-root [data-cb-spq]'); if (q){ q.focus(); try { q.setSelectionRange(at, at); } catch(_){} }
    }, 200);
    return;
  }
  if ('cbMagicq' in d){ CB.magicQ = t.value; return; }
  // Details: typed, not chosen — no re-render, so the box keeps the caret.
  if (d.cbDetail && d.cbDetail !== 'alignment'){ CB.build.details = Object.assign({}, CB.build.details, { [d.cbDetail]: t.value }); return; }
  if (d.cbIn === 'level'){
    const n = Math.max(1, Math.min(20, parseInt(t.value, 10) || 1));
    CB.build.level = n; cbFitLevels(CB.build); cbRefreshSide(); cbRefreshSteps();
  }
}
function cbRefreshSide(){
  const side = document.querySelector('#cb-root .cb-side'); if (!side || !CB || !CB.R) return;
  CB.rec = sktComputeCharacter(CB.build, CB.R, CB.idx != null ? state.party[CB.idx] : null);
  side.innerHTML = cbSide(CB.rec);
}
function cbRefreshSteps(){
  const nav = document.querySelector('#cb-root .cb-steps'); if (!nav) return;
  const tmp = document.createElement('div'); tmp.innerHTML = cbShell('', '');
  const fresh = tmp.querySelector('.cb-steps'); if (fresh) nav.innerHTML = fresh.innerHTML;
}

async function cbSwitchEdition(ed){
  const keep = { name: CB.build.name, level: CB.build.level, icon: CB.build.icon,
                 allBooks: !!CB.build.allBooks, items: (CB.build.items || []).slice() };
  CB.build = Object.assign(sktBlankBuild(ed), keep);
  if (state.settings){ state.settings.builderEdition = ed; save(); }
  await cbLoad(ed);
  // Rebuilding an imported character: the choices come from its sheet again,
  // in the other book, rather than being cleared.
  const from = CB && CB.convertFrom && state.party.find(p => p.id === CB.convertFrom);
  if (from && CB.R && !CB.error){
    CB.build = sktBlankBuild(ed);
    try { cbFromImported(from); } catch(e){ CB.error = 'Couldn\u2019t read ' + from.name + '\u2019s sheet into the builder (' + e.message + ').'; }
    cbRender();
  }
}

// ── Saving ───────────────────────────────────────────────────────────────────
function cbSave(){
  if (!CB || !CB.R) return;
  const todo = sktBuildTodo(CB.build, CB.R).filter(t => !t.soft);
  const go = () => {
    const prior = CB.idx != null ? state.party[CB.idx] : null;
    const rec = sktComputeCharacter(CB.build, CB.R, prior);
    const label = CB.convertFrom ? 'Rebuilt ' + rec.name + ' in the character builder' : CB.mode === 'create' ? 'Created ' + rec.name : CB.mode === 'levelup' ? rec.name + ' is now level ' + rec.level : 'Saved ' + rec.name;
    let idx = CB.idx;
    const apply = () => {
      if (prior){
        // Keep everything the builder does not own: conditions, notes,
        // death saves, a portrait, which combatant it is.
        state.party[idx] = Object.assign({}, prior, rec, { id: prior.id, portrait: prior.portrait });
        // Rebuilt from an import: its gear is in the build now, and the PDF's
        // AC breakdown and inventory bookkeeping mean nothing to a built one.
        if (CB.convertFrom){ ['inventory', 'acGear', 'invResist'].forEach(k => { delete state.party[idx][k]; }); }
      } else {
        rec.id = (typeof uid === 'function') ? uid() : 'pc_' + Date.now().toString(36);
        state.party.push(rec); idx = state.party.length - 1;
      }
      save();
    };
    if (typeof sktUndoable === 'function') sktUndoable(label, apply); else apply();
    if (typeof syncPartyToCombat === 'function') { try { syncPartyToCombat(idx); } catch(e){} }
    try { panelDefs.party && panelDefs.party._render && panelDefs.party._render(); } catch(e){}
    const done = CB.onDone; const saved = state.party[idx];
    cbClose();
    if (typeof done === 'function') done(saved, idx);
  };
  if (todo.length && typeof showConfirm === 'function'){
    showConfirm('Still to choose: ' + todo.map(t => t.what).join(', ') + '. Save anyway? You can finish it later from the party card.',
                { title: 'Not finished', confirmLabel: 'Save anyway' }).then(ok => { if (ok) go(); });
  } else go();
}
