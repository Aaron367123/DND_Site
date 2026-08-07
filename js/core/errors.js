// ============================================================
// ERRORS — global capture, throttled user-facing notice, diagnostics log
// ============================================================
// WHY THIS EXISTS
// ---------------
// Two failures this codebase actually hit were invisible until someone
// happened to open DevTools:
//   • every Firebase sync listener dying with permission_denied while the UI
//     still showed "Live" and localStorage still had yesterday's data;
//   • 262 monster portraits silently rendering as empty rings.
// Nothing in the app was watching. This is the thing that watches.
//
// WHAT IT CAN AND CANNOT SEE — worth being precise, because the gap is big:
//   ✓ Uncaught exceptions and unhandled promise rejections. These should
//     never happen, so they always warrant telling the user.
//   ✓ Anything routed through console.error / console.warn — which is where
//     the deliberate-but-quiet reports live (realtime push failures, cache
//     misses, parse fallbacks). Recorded, never toasted: Firebase logs to
//     console on ordinary network blips, and a toast per blip would be worse
//     than silence.
//   ✗ The ~125 `catch(e){}` blocks scattered through the codebase. A swallowed
//     error is invisible to every mechanism here, by definition. Converting
//     the ones that matter to sktErrors.report() is follow-up work, not
//     something this file can do from the outside.
//
// Loaded FIRST, before every other script, so an exception while another
// module is still parsing is caught rather than lost.
'use strict';

(function(){

const MAX_ENTRIES  = 120;
const STORE_KEY    = 'skt-errlog-v1';   // sessionStorage: survives reloads, not quota-critical
const MAX_STORE_KB = 64;
// Toast budget. A render loop throwing every frame must not paper the screen
// over — one notice, then silence until the window passes.
const TOAST_WINDOW_MS = 30000;

let _log = [];
let _lastToastAt = 0;
let _seenSinceToast = 0;
// Reentrancy guard. Everything below can run INSIDE console.error, so a throw
// in here would recurse until the stack blows.
let _busy = false;

function _now(){ return new Date().toISOString(); }

function _trim(s, n){
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function _persist(){
  try {
    let text = JSON.stringify(_log);
    // Oldest-first drop until it fits. Diagnostics are not worth an exception.
    while (text.length > MAX_STORE_KB * 1024 && _log.length > 1){
      _log = _log.slice(Math.ceil(_log.length / 4));
      text = JSON.stringify(_log);
    }
    sessionStorage.setItem(STORE_KEY, text);
  } catch(e){ /* private mode, quota — diagnostics are best-effort */ }
}

function _restore(){
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) _log = JSON.parse(raw) || [];
    if (!Array.isArray(_log)) _log = [];
  } catch(e){ _log = []; }
}

// Add an entry. `toast` decides whether the user is told; the caller owns that
// judgement, because "worth recording" and "worth interrupting for" differ.
function record(kind, msg, detail, toast){
  if (_busy) return null;
  _busy = true;
  try {
    const entry = {
      t: _now(),
      kind: kind,                       // 'error' | 'rejection' | 'console' | 'report'
      msg: _trim(msg, 400),
      detail: _trim(detail, 2000),
      url: location.pathname + location.search,
    };
    // Collapse a repeat of the immediately-preceding entry into a count
    // instead of 40 identical rows — the log stays readable and the ring
    // doesn't evict real history.
    const prev = _log[_log.length - 1];
    if (prev && prev.kind === entry.kind && prev.msg === entry.msg){
      prev.n = (prev.n || 1) + 1;
      prev.t = entry.t;
    } else {
      _log.push(entry);
      if (_log.length > MAX_ENTRIES) _log = _log.slice(-MAX_ENTRIES);
    }
    _persist();
    if (toast) _maybeToast(entry);
    return entry;
  } catch(e){
    return null;
  } finally {
    _busy = false;
  }
}

function _maybeToast(entry){
  _seenSinceToast++;
  const now = Date.now();
  if (now - _lastToastAt < TOAST_WINDOW_MS) return;
  const extra = _seenSinceToast > 1 ? ' (+' + (_seenSinceToast - 1) + ' more)' : '';
  _lastToastAt = now;
  _seenSinceToast = 0;
  if (typeof showToast !== 'function') return;
  try {
    showToast('Something went wrong — ' + _trim(entry.msg, 90) + extra, {
      action: {
        label: 'Details',
        run(){ show(); },
      },
    });
  } catch(e){ /* toast host not ready during boot */ }
}

// ─── Global capture ──────────────────────────────────────────────────────────
function install(){
  _restore();

  // Uncaught exceptions. Capture phase so we see them before anything that
  // might stopPropagation.
  window.addEventListener('error', ev => {
    // Resource load failures (an <img> 404) also fire 'error' here, but with
    // the element as target and no ErrorEvent payload. Those are routine —
    // renderIcon's token fallback deliberately relies on one — so they must
    // never reach the user as an app error.
    if (!(ev instanceof ErrorEvent) || !ev.message){
      const el = ev.target;
      if (el && el.tagName){
        record('console', 'Failed to load ' + el.tagName.toLowerCase() + ': '
               + _trim(el.currentSrc || el.src || el.href || '?', 200), '', false);
      }
      return;
    }
    const where = ev.filename ? ev.filename.replace(location.origin, '') + ':' + ev.lineno + ':' + ev.colno : '';
    record('error', ev.message, ((ev.error && ev.error.stack) || '') + (where ? '\n@ ' + where : ''), true);
  }, true);

  // Rejected promises nobody caught. This is the one that would have surfaced
  // a broken Firebase call that got .then()'d without a .catch().
  window.addEventListener('unhandledrejection', ev => {
    const r = ev.reason;
    const msg = (r && (r.message || r.code)) || String(r);
    record('rejection', msg, (r && r.stack) || '', true);
  });

  // Passive console capture. Wrapping is what makes the 47 existing
  // console.warn/error sites show up in the log without editing any of them.
  //
  // KNOWN COST: DevTools attributes a console message to wherever
  // console.error was *called*, which after wrapping is this file — so the
  // clickable source link in the console now reads errors.js instead of the
  // real caller. Unavoidable while wrapping. Mitigated by resolving the true
  // call site ourselves and storing it on the entry, so the diagnostics view
  // has attribution even when the console no longer does.
  ['error','warn'].forEach(level => {
    const orig = console[level];
    if (typeof orig !== 'function') return;
    console[level] = function(){
      try {
        const parts = Array.prototype.map.call(arguments, a => {
          if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch(e){ return String(a); }
        });
        const site = _callSite();
        record('console', level.toUpperCase() + ' ' + _trim(parts[0], 200),
               parts.slice(1).join(' ') + (site ? '\n@ ' + site : ''), false);
      } catch(e){ /* never let logging break logging */ }
      return orig.apply(console, arguments);
    };
  });
}

// First stack frame outside this file — i.e. whoever actually called
// console.error. Format varies by engine, so this is best-effort and returns
// '' rather than guessing wrong.
function _callSite(){
  try {
    const lines = String(new Error().stack || '').split('\n');
    for (let i = 1; i < lines.length; i++){
      const s = lines[i];
      if (!s || s.indexOf('errors.js') !== -1) continue;
      const m = /((?:https?:\/\/|\/)[^\s)]+:\d+:\d+)/.exec(s);
      if (m) return m[1].replace(location.origin, '').replace(/\?v=[a-f0-9]+/i, '');
    }
  } catch(e){}
  return '';
}

// ─── Public reporting ────────────────────────────────────────────────────────
// For code that catches an error and handles it, but wants it on the record.
// `opts.toast` opts into telling the user.
function report(source, err, opts){
  opts = opts || {};
  const msg = (err && (err.message || err.code)) || String(err);
  return record('report', '[' + source + '] ' + msg, (err && err.stack) || '', !!opts.toast);
}

function list(){ return _log.slice(); }
function count(){ return _log.reduce((n, e) => n + (e.n || 1), 0); }
function clear(){ _log = []; _persist(); }

function asText(){
  const head = 'SKT diagnostics · ' + _now()
    + '\nbuild ' + ((window.sktBackup && window.sktBackup.snapshot && (function(){
        try { return sktBackup.snapshot().build; } catch(e){ return '?'; } })()) || '?')
    + '\n' + navigator.userAgent + '\n' + '-'.repeat(60) + '\n';
  return head + _log.map(e =>
    e.t + '  ' + e.kind.toUpperCase() + (e.n > 1 ? ' ×' + e.n : '') + '  ' + e.msg
    + (e.detail ? '\n    ' + e.detail.replace(/\n/g, '\n    ') : '')
  ).join('\n');
}

// ─── Diagnostics viewer ──────────────────────────────────────────────────────
// Deliberately built from scratch rather than reusing the panel system: this
// has to work when the app is broken, so it depends on nothing but the DOM.
function show(){
  document.getElementById('skt-errlog-modal')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'skt-errlog-modal';
  wrap.className = 'modal-backdrop';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows = _log.slice().reverse().map(e =>
    '<div class="errlog-row errlog-' + esc(e.kind) + '">'
    + '<div class="errlog-head"><span class="errlog-kind">' + esc(e.kind)
    + (e.n > 1 ? ' ×' + e.n : '') + '</span>'
    + '<span class="errlog-time">' + esc(new Date(e.t).toLocaleTimeString()) + '</span></div>'
    + '<div class="errlog-msg">' + esc(e.msg) + '</div>'
    + (e.detail ? '<pre class="errlog-detail">' + esc(e.detail) + '</pre>' : '')
    + '</div>').join('');
  wrap.innerHTML =
    '<div class="modal errlog-modal">'
    + '<div class="modal-head"><h3>Diagnostics</h3>'
    + '<button class="btn icon-btn" data-erract="close">'+ICO('i-close')+'</button></div>'
    + '<div class="errlog-body">' + (rows || '<p class="drawer-note">Nothing logged this session.</p>') + '</div>'
    + '<div class="modal-actions">'
    + '<button class="btn small" data-erract="copy">Copy all</button>'
    + '<button class="btn small danger" data-erract="clear">Clear</button>'
    + '<button class="btn small" data-erract="close">Close</button>'
    + '</div></div>';
  wrap.addEventListener('click', ev => {
    const act = ev.target.closest('[data-erract]')?.dataset.erract;
    if (!act && ev.target !== wrap) return;
    if (act === 'copy'){
      const text = asText();
      // Clipboard API needs a secure context; fall back so this still works
      // over plain http on a LAN, which is exactly when you're debugging.
      (navigator.clipboard?.writeText(text) ?? Promise.reject())
        .then(() => typeof showToast === 'function' && showToast('Diagnostics copied'))
        .catch(() => {
          const ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); if (typeof showToast === 'function') showToast('Diagnostics copied'); }
          catch(e){ if (typeof showToast === 'function') showToast('Copy failed — select the text manually'); }
          ta.remove();
        });
      return;
    }
    if (act === 'clear'){ clear(); wrap.remove(); show(); return; }
    wrap.remove();
  });
  document.body.appendChild(wrap);
}

window.sktErrors = { install, record, report, list, count, clear, asText, show };

// Install immediately — this file is loaded before everything else precisely
// so the handlers exist while the rest of the app is still parsing.
install();

})();
