// ============================================================
// ONBOARDING — the About box
// ============================================================
// There used to be a "try a combat demo" button and a changelog here. The
// demo swapped the party and the fight for demo characters on every phone in
// the campaign, and the changelog had stopped being kept; both went. A
// device that was mid-demo when that happened still gets its banner and its
// way back (exitDemoScenario restores what it saved).

// ─── Demo combat scenario ────────────────────────────────────────────────────
const DEMO_SNAPSHOT_KEY = 'skt-demo-snapshot-v1';

function _onbDemoActive(){
  try { return !!localStorage.getItem(DEMO_SNAPSHOT_KEY); } catch(e){ return false; }
}

function exitDemoScenario(){
  let snap;
  try { snap = JSON.parse(localStorage.getItem(DEMO_SNAPSHOT_KEY) || 'null'); }
  catch(e){ snap = null; }
  if (!snap){
    _onbRenderDemoBanner(); // hide if shown
    return;
  }
  if (Array.isArray(snap.party))      state.party = snap.party;
  if (Array.isArray(snap.combatants)) state.combatants = snap.combatants;
  if (typeof snap.combatRound === 'number') state.combatRound = snap.combatRound;
  state.activeCombatantId = snap.activeCombatantId ?? null;
  try { localStorage.removeItem(DEMO_SNAPSHOT_KEY); } catch(e){}
  if (typeof save === 'function') save();
  if (typeof panelDefs !== 'undefined'){
    panelDefs.combat?._render?.();
    panelDefs.party?._render?.();
  }
  _onbRenderDemoBanner();
  if (typeof showToast === 'function') showToast('Demo exited — your data is back');
}

// Floating banner pinned to the top-center while a demo is active. Click
// the chip to exit. Re-rendered idempotently — calling multiple times
// just shows the same banner once.
function _onbRenderDemoBanner(){
  const existing = document.getElementById('onb-demo-banner');
  if (!_onbDemoActive()){
    if (existing) existing.remove();
    return;
  }
  if (existing) return;
  const banner = document.createElement('div');
  banner.id = 'onb-demo-banner';
  banner.innerHTML = `<span>🎲 Demo combat active — your campaign data is saved.</span>
    <button class="btn small" id="onb-demo-exit">Exit demo</button>`;
  document.body.appendChild(banner);
  banner.querySelector('#onb-demo-exit').addEventListener('click', exitDemoScenario);
}

// Restore the banner on every page load if a demo is still active (e.g.
// the user reloaded mid-demo). Fires after load() runs in app.js.
function initOnboarding(){
  _onbRenderDemoBanner();
}

window.exitDemoScenario = exitDemoScenario;
window.initOnboarding   = initOnboarding;


// ────────────────────────────────────────────────────────────────────────────
// About modal — app version, credits, data-storage summary, links. Mirrors
// the changelog modal's visual language so the two feel like a set.
// ────────────────────────────────────────────────────────────────────────────
function _onbBytesUsed(){
  // Sum the byte length of every localStorage value for this origin. Matches
  // the calculation used by the storage-usage meter in settings.js.
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      total += k.length + v.length;
    }
  } catch(e){}
  return total;
}
function _onbFormatBytes(n){
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/1024/1024).toFixed(2) + ' MB';
}
function openAbout(){
  document.getElementById('onb-about-backdrop')?.remove();
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.id = 'onb-about-backdrop';
  const bytes = _onbBytesUsed();
  // Rough quota — most browsers cap localStorage around 5 MB per origin.
  const quotaMB = 5;
  const pct = Math.min(100, (bytes / (quotaMB*1024*1024)) * 100);
  // Panel-count heuristic: rough open windows count.
  let windowCount = 0;
  try { windowCount = document.querySelectorAll('.window').length; } catch(e){}
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:520px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column">
    <h3 style="margin:0 0 4px;display:flex;align-items:center;gap:8px"><span style="font-size:var(--fs-3xl)">⚔</span> SKT Campaign Workspace</h3>
    <p style="margin:0 0 14px;font-size:var(--fs-sm);color:var(--text-muted)">A single-page workspace for running 5e games. Vanilla JS, no framework.</p>
    <div style="flex:1;overflow-y:auto;padding-right:4px">
      <h4 style="margin:0 0 6px;font-size:var(--fs-md);color:var(--accent)">Data storage</h4>
      <p style="margin:0 0 4px;font-size:var(--fs-md)">${esc(_onbFormatBytes(bytes))} used of ~${quotaMB} MB localStorage quota · ${windowCount} open window${windowCount===1?'':'s'}</p>
      <div style="background:var(--panel-2);height:6px;border-radius:3px;overflow:hidden;margin-bottom:14px">
        <div style="width:${pct.toFixed(1)}%;height:100%;background:var(--accent);transition:width .2s"></div>
      </div>
      <p style="margin:0 0 14px;font-size:var(--fs-sm);color:var(--text-muted)">Everything auto-saves to this browser. Use Export / Import (above) to back up or move devices. Optional Firebase + Dropbox sync are configured in <code>SETUP.md</code>.</p>

      <h4 style="margin:0 0 6px;font-size:var(--fs-md);color:var(--accent)">Credits</h4>
      <p style="margin:0 0 6px;font-size:var(--fs-md)">Stat blocks, spells, items, and adventure content are sourced from <a href="https://5e.tools/" target="_blank" rel="noopener" style="color:var(--accent)">5etools</a> (CC-licensed game-mechanics data). Module licenses live alongside the source.</p>
      <p style="margin:0 0 14px;font-size:var(--fs-sm);color:var(--text-muted)">Built for a long-running Storm King's Thunder campaign — hence the name.</p>

      <h4 style="margin:0 0 6px;font-size:var(--fs-md);color:var(--accent)">Quick actions</h4>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <button class="btn small" id="about-open-tutorial">📖 Reopen tutorial</button>
        <button class="btn small" id="about-reset-onboarding">↺ Reset onboarding flag</button>
      </div>
      <p style="margin:0;font-size:var(--fs-sm);color:var(--text-dim)">"Reset onboarding flag" makes the tutorial auto-pop on next reload (handy when showing a friend).</p>
    </div>
    <div class="modal-actions" style="margin-top:12px">
      <span style="flex:1"></span>
      <button class="btn primary" id="onb-about-close">Close</button>
    </div>
  </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('#onb-about-close').addEventListener('click', close);
  back.querySelector('#about-open-tutorial')?.addEventListener('click', () => {
    close();
    if (typeof openTutorial === 'function') openTutorial(0);
  });
  back.querySelector('#about-reset-onboarding')?.addEventListener('click', () => {
    try {
      localStorage.removeItem('skt-tutorial-seen-v2');
      localStorage.removeItem('skt-changelog-seen-version');
    } catch(e){}
    if (typeof showToast === 'function') showToast('Onboarding flags cleared — reload to re-trigger.');
  });
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
window.openAbout = openAbout;
