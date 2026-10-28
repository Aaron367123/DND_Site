// ============================================================
// MESSAGES — a player and the DM, privately
// ============================================================
// The DM could already whisper to a player (a handout to one character); a
// player had no way back. "I pocket the gem while nobody's looking" had to be
// said out loud or passed on a scrap of paper.
//
// One synced key, a list of messages with ids, so a player and the DM writing
// at the same moment both land (whole keys merge by record id). Each message
// is between the DM and one character: `from` and `to` are 'dm' or a
// character id. Every screen shows only its own conversations — like the
// whispers, the data reaches every device in the campaign, so it is private
// at the table, not secret from someone reading their browser's storage.
// What's been read is kept per device.

const SKT_MSG_KEY = 'skt-messages-v1';
const SKT_MSG_READ_KEY = 'skt-messages-read-v1';   // this device: thread → last read time
const SKT_MSG_MAX = 300;

function sktMsgs(){ try { const a = JSON.parse(localStorage.getItem(SKT_MSG_KEY) || '[]'); return Array.isArray(a) ? a.filter(m => m && m.id && m.text) : []; } catch(e){ return []; } }
function _sktMsgMe(){
  if (document.body.classList.contains('player-mode')){
    const pc = typeof paPc === 'function' ? paPc() : null;
    return pc ? { id: pc.id, name: pc.name } : null;
  }
  return { id: 'dm', name: 'DM' };
}
// The conversation between the DM and one character, oldest first.
function sktMsgThread(pcId){
  return sktMsgs().filter(m => (m.from === pcId && m.to === 'dm') || (m.from === 'dm' && m.to === pcId)).sort((a, b) => (a.at || 0) - (b.at || 0));
}
function sktMsgSend(to, text){
  const me = _sktMsgMe(), t = String(text || '').trim();
  if (!me || !t || !to || to === me.id) return null;
  const m = { id: 'm' + (typeof uid === 'function' ? uid() : Date.now().toString(36)), at: Date.now(), from: me.id, name: me.name, to, text: t.slice(0, 2000) };
  const list = sktMsgs().concat([m]).sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-SKT_MSG_MAX);
  try { localStorage.setItem(SKT_MSG_KEY, JSON.stringify(list)); } catch(e){ if (typeof warnStorageFailure === 'function') warnStorageFailure('messages', e); }
  sktMsgMarkRead(me.id === 'dm' ? to : me.id);
  sktMsgChanged(true);
  return m;
}
// Read state, per device.
function _sktMsgRead(){ try { return JSON.parse(localStorage.getItem(SKT_MSG_READ_KEY) || '{}') || {}; } catch(e){ return {}; } }
function sktMsgMarkRead(threadId){
  const r = _sktMsgRead(); r[threadId] = Date.now();
  try { localStorage.setItem(SKT_MSG_READ_KEY, JSON.stringify(r)); } catch(e){}
}
// Unread messages for this screen: to the DM from a character (DM), or to
// this character from the DM (player). Optionally in one thread.
function sktMsgUnread(threadId){
  const me = _sktMsgMe(); if (!me) return [];
  const read = _sktMsgRead();
  return sktMsgs().filter(m => m.to === me.id && (!threadId || (me.id === 'dm' ? m.from === threadId : true))
    && (m.at || 0) > (read[me.id === 'dm' ? m.from : me.id] || 0));
}
// A change, from here or another device: redraw, and announce what's new.
let _sktMsgSeen = null;
function sktMsgChanged(local){
  const all = sktMsgs();
  if (!_sktMsgSeen){ _sktMsgSeen = new Set(all.map(m => m.id)); }
  const me = _sktMsgMe();
  const fresh = local ? [] : all.filter(m => !_sktMsgSeen.has(m.id) && me && m.to === me.id);
  all.forEach(m => _sktMsgSeen.add(m.id));
  try { const P = panelDefs.messages; if (P && P._body) P._render(); if (P) P._badge(); } catch(e){}
  try { if (typeof paOnMessages === 'function') paOnMessages(fresh); } catch(e){}
  if (fresh.length && !document.body.classList.contains('player-mode')){
    // The DM: a pop-up per message unless that conversation is open.
    const P = panelDefs.messages, open = P && P._body && P._thread;
    fresh.filter(m => m.from !== open).forEach(m => {
      if (typeof showToast === 'function') showToast('✉ ' + (m.name || 'A player') + ': ' + m.text.slice(0, 80) + (m.text.length > 80 ? '…' : ''));
    });
  }
}

function _sktMsgTime(at){
  const d = new Date(at || 0), today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
// A conversation, drawn: mine on the right, theirs on the left.
function sktMsgThreadHtml(pcId, meId){
  const msgs = sktMsgThread(pcId);
  if (!msgs.length) return '<div class="msg-empty">' + (meId === 'dm' ? 'No messages yet.' : 'Nothing yet. Write to the DM — only the DM sees it.') + '</div>';
  return msgs.map(m => '<div class="msg-b' + (m.from === meId ? ' mine' : '') + '"><div class="msg-t">' + esc(m.text).replace(/\n/g, '<br>') + '</div>'
    + '<div class="msg-at">' + (m.from === meId ? '' : esc(m.name || '') + ' · ') + _sktMsgTime(m.at) + '</div></div>').join('');
}
function sktMsgComposeHtml(ph){
  return '<form class="msg-form" data-msg-form><textarea class="msg-input" data-msg-input rows="2" placeholder="' + esc(ph || 'Write a message…') + '" aria-label="Message"></textarea>'
    + '<button class="btn primary" type="submit">Send</button></form>';
}
// Wire a compose box: Enter sends (Shift+Enter for a new line).
function sktMsgWire(root, to, after){
  const f = root.querySelector('[data-msg-form]'), i = root.querySelector('[data-msg-input]'); if (!f || !i) return;
  const send = () => { const v = i.value.trim(); if (!v) return; if (sktMsgSend(typeof to === 'function' ? to() : to, v)){ i.value = ''; if (after) after(); } };
  f.addEventListener('submit', e => { e.preventDefault(); send(); });
  i.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); } });
}

// ── The DM's window ──────────────────────────────────────────────────────────
registerPanel('messages', {
  title: 'Messages', icon: '✉',
  _thread: null,
  mount(body){ this._body = body; this._render(); },
  unmount(){ this._body = null; },
  _people(){ return (typeof sktPlayerParty === 'function' ? sktPlayerParty() : (state.party || []).filter(p => !p.foe)); },
  _render(){
    const b = this._body; if (!b) return;
    const people = this._people();
    if (this._thread && !people.some(p => p.id === this._thread)) this._thread = null;
    if (!this._thread){
      // The conversation with the latest message, else the first character.
      const last = sktMsgs().filter(m => m.from !== 'dm' || m.to).sort((a, c) => (c.at || 0) - (a.at || 0))[0];
      this._thread = last ? (last.from === 'dm' ? last.to : last.from) : (people[0] && people[0].id);
    }
    const typed = b.querySelector('[data-msg-input]'), keep = typed ? typed.value : '', focused = typed && document.activeElement === typed;
    if (this._thread) sktMsgMarkRead(this._thread);   // it's on screen: read
    const list = people.map(p => {
      const n = sktMsgUnread(p.id).length, last = sktMsgThread(p.id).slice(-1)[0];
      return '<button class="msg-who' + (p.id === this._thread ? ' on' : '') + '" data-msg-who="' + esc(p.id) + '"><span class="msg-who-n">' + esc(p.name) + (n ? '<i class="msg-dot">' + n + '</i>' : '') + '</span>'
        + '<span class="msg-who-l">' + (last ? esc((last.from === 'dm' ? 'You: ' : '') + last.text.slice(0, 48)) : '<span class="cb-dim">No messages</span>') + '</span></button>';
    }).join('');
    const who = people.find(p => p.id === this._thread);
    b.innerHTML = '<div class="msg">' + (people.length ? '<div class="msg-list">' + list + '</div>'
      + '<div class="msg-pane">' + (who ? '<div class="msg-h">' + esc(who.name) + '</div><div class="msg-thread">' + sktMsgThreadHtml(who.id, 'dm') + '</div>' + sktMsgComposeHtml('Reply to ' + who.name + '… (only they see it)') : '') + '</div>'
      : '<div class="msg-empty">No characters in the party yet.</div>') + '</div>';
    b.querySelectorAll('[data-msg-who]').forEach(x => x.addEventListener('click', () => { this._thread = x.dataset.msgWho; this._render(); }));
    sktMsgWire(b, () => this._thread);
    const th = b.querySelector('.msg-thread'); if (th) th.scrollTop = th.scrollHeight;
    const i2 = b.querySelector('[data-msg-input]'); if (i2){ if (keep) i2.value = keep; if (focused) i2.focus(); }
    this._badge();
  },
  // Unread messages from players, on the dock button.
  _badge(){
    const btn = document.querySelector('.dock-btn[data-panel="messages"]'); if (!btn) return;
    const n = document.body.classList.contains('player-mode') ? 0 : sktMsgUnread().length;
    let badge = btn.querySelector('.dock-badge');
    if (!n){ if (badge) badge.remove(); return; }
    if (!badge){ badge = document.createElement('span'); badge.className = 'dock-badge'; btn.appendChild(badge); }
    badge.textContent = n > 9 ? '9+' : String(n);
  },
});
// Count what's already waiting once the page is up (and seed what's been seen,
// so old messages don't pop up again on every load).
setTimeout(() => { try { sktMsgChanged(true); } catch(e){} }, 1500);
