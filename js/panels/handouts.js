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
    const pcs = (state.party || []).filter(p => !p.foe);
    const toAll = d.to === 'all';
    b.innerHTML = `<div class="ho">
      <div class="ho-new">
        <input class="ho-title" id="ho-title" type="text" placeholder="Title (e.g. A letter sealed with black wax)" value="${esc(d.title)}">
        <textarea class="ho-text" id="ho-text" rows="4" placeholder="Text the players will read (optional)">${esc(d.text)}</textarea>
        <div class="ho-img-row">
          ${d.img ? `<img class="ho-thumb" src="${d.img}" alt=""><button class="btn small" data-ho="img-remove">Remove picture</button>`
                  : `<button class="btn small" data-ho="img-pick">${ICO('i-map')} Add a picture</button>`}
          <input type="file" id="ho-file" accept="image/*" hidden>
        </div>
        <div class="ho-to">
          <span class="ho-to-l">Send to</span>
          <label><input type="radio" name="ho-to" value="all"${toAll ? ' checked' : ''}> Everyone</label>
          <label><input type="radio" name="ho-to" value="some"${toAll ? '' : ' checked'}> Only…</label>
          ${toAll ? '' : `<span class="ho-pcs">${pcs.map(p => `<label class="ho-pc"><input type="checkbox" value="${esc(p.id)}"${(d.to || []).includes(p.id) ? ' checked' : ''}> ${esc(p.name)}</label>`).join('')}</span>`}
        </div>
        <button class="btn primary" data-ho="send"${(d.title || d.text || d.img) ? '' : ' disabled'}>📜 Send to phones</button>
      </div>
      <div class="ho-list">
        ${data.list.length ? data.list.map(h => `<div class="ho-item" data-id="${esc(h.id)}">
            ${h.img ? `<img class="ho-item-img" src="${h.img}" alt="">` : '<div class="ho-item-img ho-noimg">📜</div>'}
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
    b.querySelectorAll('input[name="ho-to"]').forEach(r => r.addEventListener('change', () => {
      this._draft.to = r.value === 'all' ? 'all' : [];
      this._render();
    }));
    b.querySelectorAll('.ho-pc input').forEach(cb => cb.addEventListener('change', () => {
      this._draft.to = [...b.querySelectorAll('.ho-pc input:checked')].map(i => i.value);
    }));
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
      else if (act === 'send') this.send(this._draft);
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
    const h = { id: 'ho_' + (typeof uid === 'function' ? uid() : now.toString(36)),
                title: String(draft.title || '').trim(), text: String(draft.text || ''),
                img: draft.img || null, to, ts: now, shownAt: now };
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
    data.list = data.list.filter(x => x.id !== id);
    this._save(data); this._render();
  },
});
