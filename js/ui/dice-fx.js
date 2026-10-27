// ============================================================
// DICE FX — a die you can see, for every roll the sheets make
// ============================================================
// A roll used to be a line of text. Now a die of the right shape tumbles,
// flickers through numbers and lands on the one rolled; a natural 20 bursts
// in gold, a natural 1 cracks red. On the desktop it shows in a tray at the
// bottom right (sktDiceFx); on the player's phone the die sits in the roll
// card (sktDieHtml + sktDiceAnimate, from paShowRoll). The numbers are the
// roll's own — this only shows them.

// The die's outline: a triangle for a d4, a square for a d6, a diamond for
// a d8, a kite for a d10, a pentagon for a d12, the icosahedron's hexagon
// with its inner facets for a d20.
const SKT_DIE_SHAPES = {
  4: '<polygon points="50,6 94,86 6,86" class="dfx-face"/>',
  6: '<rect x="12" y="12" width="76" height="76" rx="8" class="dfx-face"/>',
  8: '<polygon points="50,4 94,50 50,96 6,50" class="dfx-face"/><polyline points="6,50 94,50" class="dfx-edge"/>',
  10: '<polygon points="50,4 92,40 50,96 8,40" class="dfx-face"/><polyline points="8,40 50,58 92,40" class="dfx-edge"/><line x1="50" y1="58" x2="50" y2="96" class="dfx-edge"/>',
  12: '<polygon points="50,4 95,37 78,92 22,92 5,37" class="dfx-face"/><polygon points="50,24 74,42 65,72 35,72 26,42" class="dfx-edge dfx-inner"/>',
  20: '<polygon points="50,3 93,27 93,73 50,97 7,73 7,27" class="dfx-face"/>'
    + '<polygon points="50,22 76,66 24,66" class="dfx-edge dfx-inner"/>'
    + '<polyline points="50,3 50,22 7,27 24,66 7,73 24,66 50,97 76,66 93,73 76,66 93,27 50,22" class="dfx-edge"/>',
};
function sktDieSides(r){
  if (!r || r.kind !== 'dmg') return 20;
  const m = /\d*d(4|6|8|10|12|20)\b/.exec(String(r.expr || r.detail || ''));
  return m ? +m[1] : 6;
}
// The die, showing `value` (the number it lands on); `data-final` is read by
// sktDiceAnimate to flicker towards it.
function sktDieHtml(sides, value, cls){
  sides = SKT_DIE_SHAPES[sides] ? sides : 20;
  return '<span class="dfx-die dfx-d' + sides + (cls ? ' ' + cls : '') + '" data-sides="' + sides + '" data-final="' + esc(String(value)) + '" aria-hidden="true">'
    + '<svg viewBox="0 0 100 100">' + SKT_DIE_SHAPES[sides] + '</svg><b class="dfx-n">' + esc(String(value)) + '</b></span>';
}
function _sktReducedMotion(){ try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e){ return false; } }
// Tumble every die not yet rolled in `root`: spin, flicker, land.
function sktDiceAnimate(root){
  (root || document).querySelectorAll('.dfx-die:not(.dfx-done)').forEach(die => {
    die.classList.add('dfx-done');
    if (_sktReducedMotion()) return;
    const n = die.querySelector('.dfx-n'), sides = +die.dataset.sides || 20, final = die.dataset.final;
    die.classList.add('dfx-rolling');
    let t = 0;
    const iv = setInterval(() => {
      t += 1;
      if (t >= 11){ clearInterval(iv); n.textContent = final; die.classList.remove('dfx-rolling'); die.classList.add('dfx-landed'); return; }
      n.textContent = 1 + Math.floor(Math.random() * sides);
    }, 55);
  });
}
// The desktop tray: the die, what was rolled, the total. Gone after a few
// seconds; three at most at once.
function sktDiceFx(r){
  if (!r || typeof document === 'undefined') return false;
  let tray = document.getElementById('skt-dice');
  if (!tray){ tray = document.createElement('div'); tray.id = 'skt-dice'; tray.setAttribute('role', 'status'); tray.setAttribute('aria-live', 'polite'); document.body.appendChild(tray); }
  const dmg = r.kind === 'dmg', sides = sktDieSides(r);
  const face = dmg ? r.total : (r.natural != null ? r.natural : (r.rolls || [])[0]);
  const cls = !dmg && r.crit ? 'crit' : !dmg && (r.fumble || r.autoFail) ? 'fumble' : '';
  const sign = n => (n >= 0 ? '+' : '−') + Math.abs(n);
  const detail = dmg ? (r.detail || '')
    : 'd20 ' + (r.rolls || []).join(' / ') + (r.mod ? ' ' + sign(r.mod) : '') + (r.mode && r.mode !== 'normal' ? (r.mode === 'adv' ? ' · advantage' : ' · disadvantage') : '');
  const el = document.createElement('div');
  el.className = 'dfx' + (cls ? ' ' + cls : '');
  el.innerHTML = sktDieHtml(sides, face, cls)
    + '<div class="dfx-txt"><span class="dfx-label">' + esc(r.label || 'Roll') + '</span>'
    + '<span class="dfx-total">' + (r.autoFail ? 'Fails' : esc(String(r.total))) + (dmg && r.type ? ' <i>' + esc(r.type) + '</i>' : '') + '</span>'
    + '<span class="dfx-detail">' + esc(detail) + (cls === 'crit' ? ' · natural 20!' : cls === 'fumble' && r.fumble ? ' · natural 1' : '') + '</span>'
    + (r.why ? '<span class="dfx-why">' + esc(r.why) + '</span>' : '') + '</div>';
  tray.appendChild(el);
  while (tray.children.length > 3) tray.firstElementChild.remove();
  sktDiceAnimate(el);
  setTimeout(() => { el.classList.add('dfx-out'); setTimeout(() => el.remove(), 400); }, 4200);
  return true;
}
