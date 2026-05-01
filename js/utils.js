// ============================================================
// UTILITIES
// ============================================================
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function uid(){return Math.random().toString(36).slice(2,9)}
function d20(){return Math.floor(Math.random()*20)+1}
function mod(s){return Math.floor((s-10)/2)}
function showToast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),1800)}

// Themed modal — replaces browser prompt/confirm
// fields: [{id, label, type='text', value='', placeholder='', min, max}]
// returns Promise<object|null> — null if cancelled
function showModal(title, fields, confirmLabel) {
  if(!confirmLabel) confirmLabel = 'OK';
  return new Promise(function(resolve) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    var fieldHtml = '';
    fields.forEach(function(f) {
      var minAttr = f.min !== undefined ? ' min="' + f.min + '"' : '';
      var maxAttr = f.max !== undefined ? ' max="' + f.max + '"' : '';
      fieldHtml += '<div class="modal-field">'
        + '<label>' + (f.label||'') + '</label>'
        + '<input id="mf-' + f.id + '" type="' + (f.type||'text') + '"'
        + ' value="' + (f.value !== undefined ? f.value : '') + '"'
        + ' placeholder="' + (f.placeholder||'') + '"'
        + minAttr + maxAttr + ' autocomplete="off">'
        + '</div>';
    });

    var bodyHtml = fields.length
      ? '<div class="modal-fields">' + fieldHtml + '</div>'
      : '<p style="color:var(--text-muted);font-size:12px;margin:0 0 20px;line-height:1.5">'
        + 'Click confirm to proceed, or Cancel to go back.</p>';

    backdrop.innerHTML = '<div class="modal" role="dialog" aria-modal="true">'
      + '<h3>' + title + '</h3>'
      + bodyHtml
      + '<div class="modal-actions">'
      + '<button class="btn" id="modal-cancel">Cancel</button>'
      + '<button class="btn primary" id="modal-confirm">' + confirmLabel + '</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(backdrop);
    setTimeout(function(){ var inp = backdrop.querySelector('input'); if(inp) inp.focus(); }, 30);

    var close = function(result) { backdrop.remove(); resolve(result); };

    backdrop.querySelector('#modal-cancel').addEventListener('click', function(){ close(null); });
    backdrop.querySelector('#modal-confirm').addEventListener('click', function() {
      var result = {};
      fields.forEach(function(f) {
        var el = backdrop.querySelector('#mf-' + f.id);
        if(!el) return;
        result[f.id] = (f.type === 'number') ? (parseInt(el.value) || f.value || 0) : el.value.trim();
      });
      close(result);
    });
    backdrop.addEventListener('keydown', function(e) {
      if(e.key === 'Enter')  { e.preventDefault(); backdrop.querySelector('#modal-confirm').click(); }
      if(e.key === 'Escape') { close(null); }
    });
    backdrop.addEventListener('mousedown', function(e) { if(e.target === backdrop) close(null); });
  });
}
