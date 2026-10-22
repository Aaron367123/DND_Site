// ============================================================
// HANDOUTS — the DM sends a picture or a note to the players' phones
// ============================================================
// A letter, a wanted poster, a map fragment, a riddle. One synced key,
// 'skt-handouts-v1' = { list:[{ id, title, text, img, to, ts, shownAt }] }:
//   img     a downscaled JPEG data URL (or null) — small enough to ride in a
//           synced key, so there is no separate upload or cleanup to manage;
//   to      'all', or a list of character ids;
//   shownAt bumped by "Show again", which pops it up on phones once more.
// The key is DM-authored (realtime.js refuses a player push of it), and the
// player app filters it to what each phone's character may see.
//
// The whole key is budgeted to stay well under the database's 2 MB limit for
// a single value, so a handout that would push it over is refused with a
// message rather than failing to sync.
const HO_KEY = 'skt-handouts-v1';
const HO_BUDGET = 1800000;   // characters of JSON

// ── Pictures ───────────────────────────────────────────────────────────────
// A handout's picture is stored on its own database node (the one map uploads
// use), and the handout carries only its id (imgBlob). It used to ride inside
// skt-handouts-v1, which syncs whole — so once a few pictures had been sent,
// every whisper and every "Show again" re-sent all of them, up to 1.8 MB, to
// every device. Offline (or ?nosync) there is nowhere else to put it, so it
// stays inline as before (img).
//
// The device that sent a picture keeps a copy (HO_IMG_LOCAL, not synced);
// other devices fetch it once and hold it for the session.
const HO_IMG_LOCAL = 'skt-ho-imgs-v1';
const _hoImgMem = {};
function _hoLocalImgs(){ try { return JSON.parse(localStorage.getItem(HO_IMG_LOCAL) || '{}') || {}; } catch(e){ return {}; } }
function _hoKeepLocal(id, url){
  _hoImgMem[id] = url;
  const m = _hoLocalImgs(); m[id] = url;
  try { localStorage.setItem(HO_IMG_LOCAL, JSON.stringify(m)); } catch(e){ /* full: memory only */ }
}
function _hoDropLocal(id){
  delete _hoImgMem[id];
  const m = _hoLocalImgs(); if (!(id in m)) return;
  delete m[id];
  try { localStorage.setItem(HO_IMG_LOCAL, JSON.stringify(m)); } catch(e){}
}
// The picture for a handout: inline, kept here, or fetched. A handout can
// reach a phone a moment before its picture lands, so a miss is retried.
function sktHandoutImg(h, tries){
  if (!h) return Promise.resolve(null);
  if (h.img) return Promise.resolve(h.img);
  const id = h.imgBlob; if (!id) return Promise.resolve(null);
  const have = _hoImgMem[id] || _hoLocalImgs()[id];
  if (have){ _hoImgMem[id] = have; return Promise.resolve(have); }
  if (typeof window.sktMapBlobGet !== 'function') return Promise.resolve(null);
  return window.sktMapBlobGet(id).catch(() => null).then(url => {
    if (url){ _hoImgMem[id] = url; return url; }
    const n = tries == null ? 4 : tries;
    return n > 0 ? new Promise(r => setTimeout(r, 1500)).then(() => sktHandoutImg(h, n - 1)) : null;
  });
}
// An <img> for it: filled now when the picture is at hand, otherwise marked
// for sktHoFillImgs to fill once it arrives.
function sktHoImgTag(h, cls){
  if (!h) return '';
  if (h.img) return '<img class="' + cls + '" src="' + h.img + '" alt="">';
  if (!h.imgBlob) return '';
  const u = _hoImgMem[h.imgBlob] || _hoLocalImgs()[h.imgBlob];
  return u ? '<img class="' + cls + '" src="' + u + '" alt="">'
           : '<img class="' + cls + ' ho-img-loading" data-ho-blob="' + esc(h.imgBlob) + '" alt="">';
}
function sktHoFillImgs(root){
  if (!root) return;
  root.querySelectorAll('img[data-ho-blob]').forEach(img => {
    sktHandoutImg({ imgBlob: img.dataset.hoBlob }).then(u => {
      if (u){ img.src = u; img.classList.remove('ho-img-loading'); img.removeAttribute('data-ho-blob'); }
    });
  });
}

function sktHandouts(){
  try { const d = JSON.parse(localStorage.getItem(HO_KEY) || 'null'); return d && Array.isArray(d.list) ? d : { list: [] }; }
  catch(e){ return { list: [] }; }
}

// Fit an image into a phone-sized JPEG: longest side 1600px, quality stepped
// down until it is under ~600 KB. White behind it, so a transparent PNG does
// not come out black.
function sktHandoutImage(file){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const max = 1600, w = img.naturalWidth, h = img.naturalHeight;
        const k = Math.min(1, max / Math.max(w, h));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        let q = 0.82, out = cv.toDataURL('image/jpeg', q);
        while (out.length > 600000 && q > 0.4){ q -= 0.12; out = cv.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// ── A word to one player ────────────────────────────────────────────────────
// "You notice the innkeeper's hands are shaking." One line, one phone, and
// no new plumbing: a whisper is a text handout addressed to a single
// character, so it syncs, pops up and lands in that player's handouts list
// through the code that already does all three. The flag only changes how
// the DM's own list labels it.
//
// Capped, unlike handouts: a picture is sent once an evening, whereas
// whispers are chatter, and the key has a size budget to keep.
const HO_WHISPER_KEEP = 20;

function sktSendWhisper(pcId, text){
  const pc = (state.party || []).find(p => p.id === pcId);
  const t = String(text || '').trim();
  if (!pc || !t) return false;
  const d = sktHandouts();
  d.list.unshift({ id: 'w_' + (typeof uid === 'function' ? uid() : Date.now().toString(36)),
                   title: 'A word from the DM', text: t, img: null,
                   to: [pcId], ts: Date.now(), shownAt: Date.now(), whisper: true });
  let seen = 0;
  d.list = d.list.filter(h => !h.whisper || ++seen <= HO_WHISPER_KEEP);
  saveJson(HO_KEY, d, 'handouts');
  if (typeof showToast === 'function') showToast('\ud83d\udcac Sent to ' + pc.name);
  if (typeof panelDefs !== 'undefined' && panelDefs.handouts && panelDefs.handouts._body) panelDefs.handouts._render();
  return true;
}

// A whisper is the same dialog, with one player ticked and a box to write in.
function sktWhisperTo(pcId){
  return sktSendToPlayers({ title: 'A word from the DM' }, { to: [pcId], compose: true });
}

// "Send to players…" — the one way to send anything to the phones.
//   draft: { title, text, img }
//   opts.to       preselect these character ids (default: everyone)
//   opts.compose  write the message here (a whisper; no draft text yet)
//   opts.note     a note from Notes: also offers "keep it in their Notes",
//                 a live, read-only copy that follows your edits
//                 ({ shared, setShared(toOrNull) })
// Everyone, some of them, or one. Resolves to the handout's id (true for a
// whisper, { live } for a note kept in their Notes), or null if cancelled.
//
// It replaced three: the Handouts composer's own Send to, a whisper's
// one-line box, and a note's "👁 Players" switch — which also needed the
// Notes window shared, and Notes had no way to be shared, so a note shown
// that way never reached anyone.
function sktSendToPlayers(draft, opts){
  draft = draft || {}; opts = opts || {};
  const pcs = (state.party || []).filter(p => !p.foe);
  const note = opts.note || null;
  const liveNow = note ? note.shared : null;
  const pre = Array.isArray(opts.to) ? opts.to
            : Array.isArray(liveNow) ? liveNow : null;
  document.getElementById('ho-send-back')?.remove();
  const back = document.createElement('div');
  back.className = 'modal-backdrop'; back.id = 'ho-send-back';
  const what = opts.compose
    ? '<textarea class="ho-send-msg" id="ho-send-msg" rows="3" placeholder="The innkeeper’s hands are shaking."></textarea>'
    : '<div class="ho-send-what"><b>' + esc(draft.title || 'Untitled') + '</b>'
      + (draft.img ? '<img class="ho-thumb" src="' + draft.img + '" alt="">' : '')
      + (draft.text ? '<div class="ho-send-text">' + esc(String(draft.text).slice(0, 240)) + (String(draft.text).length > 240 ? '…' : '') + '</div>' : '')
      + '</div>';
  const modes = !note ? '' : '<div class="ho-send-modes">'
    + '<label><input type="radio" name="ho-send-mode" value="copy"' + (liveNow ? '' : ' checked') + '> <b>Pop it up now</b> <span>a copy, kept under “From the DM”</span></label>'
    + '<label><input type="radio" name="ho-send-mode" value="live"' + (liveNow ? ' checked' : '') + '> <b>Keep it in their Notes</b> <span>read-only, and it follows your edits</span></label>'
    + '</div>';
  back.innerHTML = '<div class="modal ho-send" role="dialog" aria-modal="true" aria-label="Send to players">'
    + '<h3>' + (opts.compose ? '💬 A word to the players' : '📜 Send to players') + '</h3>'
    + what + modes
    + '<div class="ho-send-to">'
    +   '<label class="ho-send-all"><input type="checkbox" id="ho-send-all"' + (pre ? '' : ' checked') + '> Everyone</label>'
    +   pcs.map(p => '<label class="ho-pc"><input type="checkbox" class="ho-send-pc" value="' + esc(p.id) + '"'
          + (!pre || pre.includes(p.id) ? ' checked' : '') + '> ' + esc(p.name) + '</label>').join('')
    + '</div>'
    + '<div class="modal-actions">'
    +   (liveNow ? '<button class="btn danger" data-ho-send="unshare" title="Take it out of their Notes">Stop sharing</button>' : '')
    +   '<button class="btn" data-ho-send="cancel">Cancel</button>'
    +   '<button class="btn primary" data-ho-send="go">' + (opts.compose ? '💬 Send' : '📜 Send') + '</button></div></div>';
  document.body.appendChild(back);
  const all = back.querySelector('#ho-send-all');
  const boxes = () => [...back.querySelectorAll('.ho-send-pc')];
  all.addEventListener('change', () => boxes().forEach(b => { b.checked = all.checked; }));
  boxes().forEach(b => b.addEventListener('change', () => { all.checked = boxes().every(x => x.checked); }));
  setTimeout(() => back.querySelector('#ho-send-msg')?.focus(), 30);
  return new Promise(resolve => {
    const done = v => { back.remove(); resolve(v); };
    back.addEventListener('click', e => {
      if (e.target === back) return done(null);
      const btn = e.target.closest('[data-ho-send]'); if (!btn) return;
      const act = btn.dataset.hoSend;
      if (act === 'cancel') return done(null);
      if (act === 'unshare'){
        note.setShared(null);
        if (typeof showToast === 'function') showToast('“' + (draft.title || 'Note') + '” is out of their Notes');
        return done({ live: false });
      }
      const picked = boxes().filter(b => b.checked).map(b => b.value);
      if (!picked.length){ if (typeof showToast === 'function') showToast('Pick who should get it'); return; }
      const to = (all.checked || picked.length === pcs.length) ? 'all' : picked;
      const names = to === 'all' ? 'everyone' : picked.map(id => (pcs.find(p => p.id === id) || {}).name).join(', ');
      if (opts.compose){
        const text = (back.querySelector('#ho-send-msg').value || '').trim();
        if (!text){ if (typeof showToast === 'function') showToast('Write something to send'); return; }
        // To one player it is a whisper ("For you alone"); to more, a handout.
        if (to !== 'all' && picked.length === 1) return done(sktSendWhisper(picked[0], text) || null);
        return done(panelDefs.handouts.send({ title: draft.title || 'A word from the DM', text, img: null, to }) || null);
      }
      const mode = (back.querySelector('input[name="ho-send-mode"]:checked') || {}).value || 'copy';
      if (note && mode === 'live'){
        note.setShared(to === 'all' ? true : picked);
        if (typeof showToast === 'function') showToast('👁 “' + (draft.title || 'Note') + '” is in ' + (to === 'all' ? 'everyone’s' : names + '’s') + ' Notes');
        return done({ live: true });
      }
      done(panelDefs.handouts.send(Object.assign({}, draft, { to })) || null);
    });
  });
}

registerPanel('handouts', {
  title: 'Handouts', icon: '📜',
  _draft: null,

  mount(body){
    this._body = body;
    if (!this._draft) this._draft = { title: '', text: '', img: null, to: 'all' };
    this._render();
  },
  unmount(){ this._body = null; },

  _save(d){ return saveJson(HO_KEY, d, 'handouts'); },
  _ago(ts){
    const s = Math.max(0, (Date.now() - (ts || 0)) / 1000);
    return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(ts).toLocaleDateString();
  },
  _toText(to){
    if (to === 'all' || !Array.isArray(to)) return 'Everyone';
    const names = to.map(id => (state.party.find(p => p.id === id) || {}).name).filter(Boolean);
    return names.length ? names.join(', ') : 'No one';
  },

  _render(){
    const b = this._body; if (!b) return;
    const d = this._draft, data = sktHandouts();
    const used = JSON.stringify(data).length;
    b.innerHTML = `<div class="ho">
      <div class="ho-new">
        <input class="ho-title" id="ho-title" type="text" placeholder="Title (e.g. A letter sealed with black wax)" value="${esc(d.title)}">
        <textarea class="ho-text" id="ho-text" rows="4" placeholder="Text the players will read (optional)">${esc(d.text)}</textarea>
        <div class="ho-img-row">
          ${d.img ? `<img class="ho-thumb" src="${d.img}" alt=""><button class="btn small" data-ho="img-remove">Remove picture</button>`
                  : `<button class="btn small" data-ho="img-pick">${ICO('i-map')} Add a picture</button>`}
          <input type="file" id="ho-file" accept="image/*" hidden>
        </div>
        <button class="btn primary" data-ho="send"${(d.title || d.text || d.img) ? '' : ' disabled'}>📜 Send to players…</button>
      </div>
      <div class="ho-list">
        ${data.list.length ? data.list.map(h => `<div class="ho-item" data-id="${esc(h.id)}">
            ${(h.img || h.imgBlob) ? sktHoImgTag(h, 'ho-item-img') : '<div class="ho-item-img ho-noimg">📜</div>'}
            <div class="ho-item-body">
              <div class="ho-item-title">${esc(h.title || 'Untitled')}</div>
              <div class="ho-item-meta">${esc(this._toText(h.to))} · ${esc(this._ago(h.shownAt || h.ts))}</div>
            </div>
            <div class="ho-item-btns">
              <button class="btn small" data-ho="again" title="Pop it up on their phones again">Show again</button>
              <button class="btn small danger" data-ho="del" title="Delete — it disappears from every phone">✕</button>
            </div>
          </div>`).join('')
          : emptyState({ icon: 'i-note', title: 'No handouts yet', hint: 'Write a note or add a picture above, then send it — it pops up on the players’ phones.' })}
      </div>
      <div class="ho-budget">Using ${(used / 1048576).toFixed(2)} MB of ${(HO_BUDGET / 1048576).toFixed(1)} MB for handouts</div>
    </div>`;
    this._wire();
    sktHoFillImgs(b);
  },

  _wire(){
    const b = this._body;
    const sync = () => {
      this._draft.title = b.querySelector('#ho-title').value;
      this._draft.text = b.querySelector('#ho-text').value;
      const sendBtn = b.querySelector('[data-ho="send"]');
      if (sendBtn) sendBtn.disabled = !(this._draft.title || this._draft.text || this._draft.img);
    };
    b.querySelector('#ho-title').addEventListener('input', sync);
    b.querySelector('#ho-text').addEventListener('input', sync);
    const file = b.querySelector('#ho-file');
    file.addEventListener('change', () => {
      const f = file.files && file.files[0]; if (!f) return;
      sktHandoutImage(f).then(url => { this._draft.img = url; this._render(); })
        .catch(() => { if (typeof showToast === 'function') showToast('That picture could not be read'); });
    });
    b.addEventListener('click', this._onClick || (this._onClick = e => {
      const btn = e.target.closest('[data-ho]'); if (!btn || !this._body || !this._body.contains(btn)) return;
      const act = btn.dataset.ho;
      if (act === 'img-pick') this._body.querySelector('#ho-file').click();
      else if (act === 'img-remove'){ this._draft.img = null; this._render(); }
      else if (act === 'send') sktSendToPlayers({ title: this._draft.title, text: this._draft.text, img: this._draft.img });
      else if (act === 'again') this.showAgain(btn.closest('[data-id]').dataset.id);
      else if (act === 'del'){
        const id = btn.closest('[data-id]').dataset.id;
        showConfirm('Delete this handout? It disappears from every phone.', { title: 'Delete handout', confirmLabel: 'Delete', danger: true })
          .then(ok => { if (ok) this.remove(id); });
      }
    }));
  },

  // Public so the tests (and anything else) can send without a file picker.
  send(draft){
    const to = draft.to === 'all' ? 'all' : (Array.isArray(draft.to) ? draft.to.slice() : []);
    if (Array.isArray(to) && !to.length){
      if (typeof showToast === 'function') showToast('Pick who should get it, or choose Everyone');
      return false;
    }
    const now = Date.now();
    const id = 'ho_' + (typeof uid === 'function' ? uid() : now.toString(36));
    let img = draft.img || null, imgBlob = null;
    if (img && /^data:/.test(img) && typeof window.sktMapBlobReady === 'function' && window.sktMapBlobReady()){
      imgBlob = id;
      _hoKeepLocal(imgBlob, img);
      const pic = img;
      window.sktMapBlobPut(imgBlob, pic).then(ok => {
        if (ok) return;
        // Couldn't store it on its own: put it back inline so it still arrives.
        const d = sktHandouts(); const x = d.list.find(e => e.id === id);
        if (x && !x.img){ x.img = pic; delete x.imgBlob; this._save(d); this._render(); }
      });
      img = null;
    }
    const h = { id, title: String(draft.title || '').trim(), text: String(draft.text || ''),
                img, to, ts: now, shownAt: now };
    if (imgBlob) h.imgBlob = imgBlob;
    const data = sktHandouts();
    data.list.unshift(h);
    if (JSON.stringify(data).length > HO_BUDGET){
      if (typeof showToast === 'function') showToast('Too large to send — delete an older handout, or use a smaller picture');
      return false;
    }
    this._save(data);
    this._draft = { title: '', text: '', img: null, to: draft.to === 'all' ? 'all' : to };
    this._render();
    if (typeof showToast === 'function') showToast('📜 Sent to ' + this._toText(to).toLowerCase().replace('everyone', 'everyone'));
    return h.id;
  },
  showAgain(id){
    const data = sktHandouts();
    const h = data.list.find(x => x.id === id); if (!h) return;
    h.shownAt = Date.now();
    data.list = [h, ...data.list.filter(x => x.id !== id)];
    this._save(data); this._render();
    if (typeof showToast === 'function') showToast('📜 Showing “' + (h.title || 'handout') + '” again');
  },
  remove(id){
    const data = sktHandouts();
    const gone = data.list.find(x => x.id === id);
    if (gone && gone.imgBlob){
      if (typeof window.sktMapBlobDelete === 'function') window.sktMapBlobDelete(gone.imgBlob);
      _hoDropLocal(gone.imgBlob);
    }
    data.list = data.list.filter(x => x.id !== id);
    this._save(data); this._render();
  },
});
