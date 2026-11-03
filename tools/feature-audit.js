// Feature audit: does every class and subclass feature give what its own text
// says? Run in the page (rules data loaded), e.g.
//   node tools/shot.js --state tools/fixture.json --eval-file tools/feature-audit.js --out /tmp/a.png
// It reads each feature's sentences for concrete claims (a cantrip it teaches,
// free casts of a named spell, a lasting resistance or condition immunity,
// darkvision/blindsight/tremorsense/truesight, a climb/swim/fly/burrow speed,
// armour/weapon or skill proficiency) and checks the computed character has it.
// Claims under a condition ("while", "when", "choose", …) or a feature the sheet
// already shows as a toggle, action or note are skipped. Prints JSON: checked,
// gaps. Known false alarms on 2026-11-03: choice features read without a choice
// made (Aspect of the Wilds), "martial weapons" stored as "martial", lists the
// heuristics misread (Avatar of Battle). Everything else it flags is worth a look.
(async () => {
  const out = { checked: 0, gaps: [] };
  const lc = s => String(s || '').toLowerCase();
  const strip = s => String(s).replace(/\{@\w+ ([^|}]+)[^}]*\}/g, '$1');
  const COND = /\b(while|when|whenever|if|until|as a (bonus )?action|as a reaction|for 1 (minute|hour)|choose|you can|can't|cannot|instead|unless|once per|each time|the target|a creature|an ally|your allies|of your choice|one of the following)\b/i;
  for (const ed of ['2024', '2014']){
    const R = await sktRulesLoad(ed);
    for (const cls of R.classes){
      const subs = (cls.subclasses || []).length ? cls.subclasses : [{ shortName: '' }];
      for (const sub of subs){
        const b = Object.assign(sktBlankBuild(ed), { name: 'Audit', cls: cls.name, level: 20, species: 'Human', background: ed === '2024' ? 'Guide' : 'Acolyte', subclass: sub.shortName || '', allBooks: true });
        let rec, feats;
        try { rec = sktComputeCharacter(b, R); feats = sktBuildFeatures(b, R); } catch(e){ out.gaps.push(ed + ' ' + cls.name + '/' + sub.shortName + ' threw ' + e.message); continue; }
        const sh = rec.sheet;
        const spells = new Set([].concat(sh.spells || [], sh.alwaysPrepared || [], ...(sh.featSpells || []).map(g => g.spells || [])).map(lc));
        const acts = (sh.activations || []).map(a => lc(a.name + ' ' + (a.desc || '')));
        const notes = lc((sh.notes || []).join(' '));
        const res = (rec.resistances || []).map(lc), imm = (rec.immunities || []).map(lc);
        const senses = lc(sh.senses), skills = sh.skillProf || {}, profs = lc(JSON.stringify(sh.proficiencies || ''));
        const said = lc(JSON.stringify(sh.states || '') + JSON.stringify(sh.activations || '') + (sh.notes || []).join(' ') + JSON.stringify(rec.resources || ''));
        for (const f of feats){
          if (f.info || (f.from !== 'class' && f.from !== 'subclass')) continue;
          const tag = ed + ' ' + cls.name + (sub.shortName ? '/' + sub.shortName : '') + ' L' + f.level + ' ' + f.name;
          out.checked++;
          const covered = said.includes(lc(f.name));
          String(f.text || '').split(/(?<=[.!?])\s+/).forEach(sRaw => {
            const s = strip(sRaw);
            let m;
            if ((m = /you (?:learn|know|gain) the ([A-Z][\w' ]+?) cantrip/i.exec(s)) && !/choose|of your choice/i.test(s)){
              m[1].split(/ and /).forEach(n => { if (!spells.has(lc(n.trim()))) out.gaps.push(tag + ' — teaches the ' + n.trim() + ' cantrip, not in the spells'); });
            }
            if ((m = /cast ([A-Z][\w']*(?: [A-Z][\w']*| of| the)*) without expending a spell slot/.exec(s))){
              const n = lc(m[1]);
              if (!/^(them|those|each|it|the spell)$/.test(n) && !spells.has(n) && !acts.some(a => a.includes(n)) && !notes.includes(n)) out.gaps.push(tag + ' — free casts of ' + m[1] + ': not a spell, action or note');
            }
            if (COND.test(s) || covered) return;
            if ((m = /(?:have|gain) resistance to (.+?) damage(?:\.|,? (?:and|but)|$)/i.exec(s))){
              m[1].replace(/ damage/gi, '').split(/,\s*| and | or /).map(x => lc(x.trim())).filter(x => x && x.length < 14).forEach(t => { if (!res.some(r => r.includes(t))) out.gaps.push(tag + ' — resistance to ' + t + ' not on the sheet'); });
            }
            if ((m = /(?:are|have|gain) immun(?:e|ity) to (?:the )?([\w ]+?) conditions?/i.exec(s))){
              m[1].split(/ and |, /).map(x => lc(x.trim())).forEach(t => { if (!imm.some(r => r.includes(t)) && !notes.includes(t)) out.gaps.push(tag + ' — immune to ' + t + ' not on the sheet'); });
            }
            ['darkvision', 'blindsight', 'tremorsense', 'truesight'].forEach(sn => {
              if (new RegExp('(?:gain|have) ' + sn, 'i').test(s) && !senses.includes(sn)) out.gaps.push(tag + ' — ' + sn + ' not in senses');
            });
            if ((m = /(?:gain|have) a (climb|swim|fly|burrow)(?:ing)? speed/i.exec(s)) && !(rec.speeds || {})[lc(m[1])]) out.gaps.push(tag + ' — ' + m[1] + ' speed not on the sheet');
            if ((m = /gain proficiency with (heavy armor|medium armor|martial weapons|shields)/i.exec(s)) && !profs.includes(lc(m[1]).replace(/s$/, ''))) out.gaps.push(tag + ' — proficiency with ' + m[1] + ' not on the sheet');
            if ((m = /you gain proficiency in the ([A-Z]\w+(?: \w+)?) skill/i.exec(s))){
              const k = lc(m[1]).replace(/ (\w)/g, (x, c) => c.toUpperCase());
              if (!skills[k]) out.gaps.push(tag + ' — proficiency in ' + m[1] + ' not on the sheet');
            }
          });
        }
      }
    }
  }
  out.gaps = [...new Set(out.gaps)];
  return JSON.stringify(out);
})()
