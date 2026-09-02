// ============================================================
// CAMPAIGN SWITCHER
// ============================================================
// The chip in the top bar and the dialog behind it. The model lives in
// js/core/campaign.js; this file is only the surface.

function _campEsc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function sktRefreshCampaignChip(){
  const el = document.getElementById('campaign-name');
  if (el) el.textContent = sktActiveCampaignName();
  const btn = document.getElementById('campaign-btn');
  if (btn) btn.title = 'Campaign: ' + sktActiveCampaignName() + ' — click to switch or manage';
}

function sktOpenCampaignManager(){
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const close = () => backdrop.remove();

  const render = () => {
    const active = sktActiveCampaign();
    const list = sktCampaigns();
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:520px;max-width:92vw">
      <h3>Campaigns</h3>
      <p style="color:var(--text-muted);font-size:var(--fs-sm);margin:0 0 12px">
        Each campaign has its own party, combat, notes, maps and clock, and its own
        live sync — two campaigns never see each other. Give each group the player
        link for theirs.</p>
      ${list.map(c => {
        const on = c.id === active;
        return `<div class="camp-row ${on ? 'on' : ''}">
          <span class="camp-row-name">${_campEsc(c.name)}</span>
          ${on ? '<span class="camp-row-tag">open</span>' : ''}
          ${on ? '' : `<button class="btn" data-camp-open="${_campEsc(c.id)}">Switch to</button>`}
          <button class="btn" data-camp-link="${_campEsc(c.id)}" title="Copy the player link for this campaign. Anyone who opens it lands here, whichever campaign you have open.">Player link</button>
          <button class="btn" data-camp-rename="${_campEsc(c.id)}" title="Rename">✎</button>
          ${(list.length > 1 && !on)
            ? `<button class="btn" data-camp-del="${_campEsc(c.id)}" title="Delete this campaign and everything in it">🗑</button>` : ''}
        </div>`;
      }).join('')}
      <div class="modal-actions">
        <button class="btn" data-camp-new>+ New campaign</button>
        <button class="btn primary" data-camp-close>Done</button>
      </div>
    </div>`;

    backdrop.querySelector('[data-camp-close]').addEventListener('click', close);
    backdrop.querySelector('[data-camp-new]').addEventListener('click', () => {
      const name = prompt('Name the new campaign:', 'New Campaign');
      if (name == null) return;
      const id = sktCreateCampaign(name.trim() || 'New Campaign');
      // Straight into it — creating one and then having to switch is a step
      // with no decision in it.
      _switchTo(id);
    });
    backdrop.querySelectorAll('[data-camp-open]').forEach(b =>
      b.addEventListener('click', () => _switchTo(b.dataset.campOpen)));
    backdrop.querySelectorAll('[data-camp-rename]').forEach(b =>
      b.addEventListener('click', () => {
        const c = sktCampaigns().find(x => x.id === b.dataset.campRename);
        const name = prompt('Rename campaign:', c ? c.name : '');
        if (name == null) return;
        sktRenameCampaign(b.dataset.campRename, name.trim());
        sktRefreshCampaignChip();
        render();
      }));
    backdrop.querySelectorAll('[data-camp-link]').forEach(b =>
      b.addEventListener('click', () => {
        const url = sktPlayerLink(b.dataset.campLink);
        const done = () => showToast('Player link copied — send it to that group');
        try {
          navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url));
        } catch(e){ prompt('Copy this link:', url); }
      }));
    backdrop.querySelectorAll('[data-camp-del]').forEach(b =>
      b.addEventListener('click', () => {
        const c = sktCampaigns().find(x => x.id === b.dataset.campDel);
        if (!c) return;
        // Typing the name, not an OK button. This deletes a campaign's whole
        // history from this browser and there is no undo.
        const typed = prompt('This deletes "' + c.name + '" and everything in it on this '
          + 'device — party, notes, maps, the lot. It cannot be undone.\n\n'
          + 'Type the campaign name to confirm:');
        if (typed == null) return;
        if (typed.trim() !== c.name){ showToast('Name did not match — nothing deleted'); return; }
        if (sktDeleteCampaign(c.id)) { showToast('Deleted ' + c.name); render(); }
        else showToast('Could not delete that one');
      }));
  };

  // A switch swaps every app key and then reloads, because every panel holds
  // its own cached slice of state and rebuilding them by hand here would be a
  // second, drifting copy of what a page load already does correctly.
  const _switchTo = (id) => {
    const name = (sktCampaigns().find(c => c.id === id) || {}).name || 'campaign';
    // Flush first: a pending debounced push belongs to the campaign being
    // LEFT, and after the swap it would carry the wrong data to the wrong
    // tree. 300ms of unsaved combat is a real loss and a silent one.
    const go = () => {
      if (!sktSwitchCampaign(id)){ showToast('Could not switch campaign'); return; }
      location.reload();
    };
    if (typeof window.realtimeFlushAndWait === 'function'){
      showToast('Switching to ' + name + '…');
      window.realtimeFlushAndWait(2000).then(go, go);
    } else go();
  };

  document.body.appendChild(backdrop);
  render();
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

(function _wireCampaignChip(){
  const start = () => {
    // Player devices get their campaign from the link. Offering a switcher
    // there would let a player wander into another group's table.
    if (document.body.classList.contains('player-mode')) {
      const btn = document.getElementById('campaign-btn');
      if (btn) btn.remove();
      return;
    }
    sktRefreshCampaignChip();
    const btn = document.getElementById('campaign-btn');
    if (btn) btn.addEventListener('click', sktOpenCampaignManager);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
