// ============================================================
// CAMPAIGN SWITCHER
// ============================================================
// The chip in the top bar and the dialog behind it. The model lives in
// js/core/campaign.js; this file is only the surface.

function _campEsc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// A styled replacement for prompt(). The native one is an operating-system
// dialog dropped into the middle of a themed app — wrong font, wrong
// colours, wrong position, and on some browsers a "prevent this page from
// creating more dialogs" checkbox that can disable it for the rest of the
// session.
//
// Resolves to the typed string, or null if cancelled — the same contract
// prompt() had, so the callers read the same way.
function sktAskText(opts){
  const o = opts || {};
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    let done = false;
    const finish = v => { if (done) return; done = true; backdrop.remove(); resolve(v); };
    backdrop.innerHTML = `<div class="modal camp-ask" role="dialog" aria-modal="true">
      <h3>${_campEsc(o.title || "Name")}</h3>
      ${o.help ? `<p class="camp-ask-help">${_campEsc(o.help)}</p>` : ""}
      <div class="modal-field">
        <label for="camp-ask-input">${_campEsc(o.label || "Name")}</label>
        <input id="camp-ask-input" type="text" autocomplete="off" spellcheck="false"
               value="${_campEsc(o.value || "")}" placeholder="${_campEsc(o.placeholder || "")}">
      </div>
      <div class="modal-actions">
        <button class="btn" data-ask-cancel>Cancel</button>
        <button class="btn ${o.danger ? "danger" : "primary"}" data-ask-ok>${_campEsc(o.confirm || "Save")}</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector("#camp-ask-input");
    const ok = () => finish(input.value);
    backdrop.querySelector("[data-ask-ok]").addEventListener("click", ok);
    backdrop.querySelector("[data-ask-cancel]").addEventListener("click", () => finish(null));
    backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) finish(null); });
    // Enter to accept, Escape to cancel. Keyed on the dialog rather than the
    // document so it cannot swallow a shortcut belonging to the panel behind.
    backdrop.addEventListener("keydown", e => {
      if (e.key === "Enter"){ e.preventDefault(); ok(); }
      else if (e.key === "Escape"){ e.preventDefault(); finish(null); }
    });
    // Focus and select, so typing replaces the old name rather than
    // appending to it — which is what a rename almost always wants.
    input.focus();
    input.select();
  });
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
    backdrop.querySelector('[data-camp-new]').addEventListener('click', async () => {
      const name = await sktAskText({
        title: 'New campaign',
        label: 'Campaign name',
        placeholder: 'Curse of Strahd',
        confirm: 'Create',
        help: 'It starts empty — a fresh party, notes, maps and clock — with its own '
            + 'live sync and its own player link.',
      });
      if (name == null) return;
      const id = sktCreateCampaign(name.trim() || 'New Campaign');
      // Straight into it — creating one and then having to switch is a step
      // with no decision in it.
      _switchTo(id);
    });
    backdrop.querySelectorAll('[data-camp-open]').forEach(b =>
      b.addEventListener('click', () => _switchTo(b.dataset.campOpen)));
    backdrop.querySelectorAll('[data-camp-rename]').forEach(b =>
      b.addEventListener('click', async () => {
        const c = sktCampaigns().find(x => x.id === b.dataset.campRename);
        const name = await sktAskText({
          title: 'Rename campaign',
          label: 'Campaign name',
          value: c ? c.name : '',
          confirm: 'Rename',
        });
        if (name == null) return;
        sktRenameCampaign(b.dataset.campRename, name.trim());
        sktRefreshCampaignChip();
        render();
      }));
    backdrop.querySelectorAll('[data-camp-link]').forEach(b =>
      b.addEventListener('click', () => {
        const url = sktPlayerLink(b.dataset.campLink);
        const c = sktCampaigns().find(x => x.id === b.dataset.campLink);
        const done = () => showToast('Player link copied — send it to that group');
        // Clipboard access is refused often enough to matter: no permission,
        // an insecure origin, an older browser. Falling back to a box the
        // link is already selected in beats failing silently.
        const manual = () => sktAskText({
          title: 'Player link' + (c ? ' — ' + c.name : ''),
          label: 'Copy this and send it to that group',
          value: url,
          confirm: 'Done',
          help: 'Anyone who opens it lands in this campaign, whichever one you have open.',
        });
        try { navigator.clipboard.writeText(url).then(done, manual); }
        catch(e){ manual(); }
      }));
    backdrop.querySelectorAll('[data-camp-del]').forEach(b =>
      b.addEventListener('click', async () => {
        const c = sktCampaigns().find(x => x.id === b.dataset.campDel);
        if (!c) return;
        // Typing the name rather than clicking OK. This erases a campaign’s
        // whole history from this browser and there is no undo, so the
        // friction is the point.
        const typed = await sktAskText({
          title: 'Delete ' + c.name + '?',
          label: 'Type the campaign name to confirm',
          placeholder: c.name,
          confirm: 'Delete for ever',
          danger: true,
          help: 'This removes the party, notes, maps and everything else in '
              + c.name + ' from this device. It cannot be undone.',
        });
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
