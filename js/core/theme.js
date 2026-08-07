// ============================================================
// THEME — color scheme presets + per-user custom palette
// ============================================================
// Applied by writing CSS custom properties onto :root. Choice is
// persisted per-browser in localStorage (not synced via Firebase
// — players each get their own preference).

const THEME_PRESETS = {
  default: {
    label: 'Tan & Charcoal (default)',
    vars: {
      '--bg':'#1a1a1a','--panel':'#232323','--panel-2':'#2a2a2a','--panel-3':'#333',
      '--border':'#3a3a3a','--text':'#e8e8e8','--text-muted':'#999','--text-dim':'#666',
      '--accent':'#d4a574','--accent-dark':'#a87f53',
    },
  },
  forest: {
    label: 'Forest (green & moss)',
    vars: {
      '--bg':'#161c17','--panel':'#1f2920','--panel-2':'#26302a','--panel-3':'#2f3a33',
      '--border':'#3a4a3e','--text':'#e6ebe6','--text-muted':'#94a896','--text-dim':'#627066',
      '--accent':'#8fbf85','--accent-dark':'#5e8a57',
    },
  },
  royal: {
    label: 'Royal (purple & indigo)',
    vars: {
      '--bg':'#1a172a','--panel':'#221f36','--panel-2':'#2a2740','--panel-3':'#36314f',
      '--border':'#3f3a5a','--text':'#ebe6ff','--text-muted':'#9d96b8','--text-dim':'#69648a',
      '--accent':'#b691f0','--accent-dark':'#8463c0',
    },
  },
  sanguine: {
    label: 'Sanguine (crimson & ash)',
    vars: {
      '--bg':'#1a1414','--panel':'#221b1b','--panel-2':'#2c2222','--panel-3':'#3a2a2a',
      '--border':'#4a3232','--text':'#eee0e0','--text-muted':'#a89090','--text-dim':'#6e5858',
      '--accent':'#d05a5a','--accent-dark':'#9c3e3e',
    },
  },
  arcane: {
    label: 'Arcane (cyan & midnight)',
    vars: {
      '--bg':'#10172a','--panel':'#1a2238','--panel-2':'#202b46','--panel-3':'#283556',
      '--border':'#34416a','--text':'#dee9ff','--text-muted':'#94a3c4','--text-dim':'#5e6c8c',
      '--accent':'#5fc8e0','--accent-dark':'#3990a8',
    },
  },
  parchment: {
    label: 'Parchment (warm light)',
    vars: {
      '--bg':'#e8dfc8','--panel':'#dfd4b8','--panel-2':'#d6c9aa','--panel-3':'#cab999',
      '--border':'#a89770','--text':'#2e2618','--text-muted':'#5a4f3a','--text-dim':'#857658',
      '--accent':'#8b3a1f','--accent-dark':'#5a2410',
    },
  },
  midnight: {
    label: 'Midnight (true black)',
    vars: {
      '--bg':'#0a0a0a','--panel':'#141414','--panel-2':'#1a1a1a','--panel-3':'#222',
      '--border':'#2a2a2a','--text':'#e0e0e0','--text-muted':'#888','--text-dim':'#555',
      '--accent':'#7aa6ff','--accent-dark':'#4d7cd6',
    },
  },
};

const THEME_KEY = 'skt-theme-v1';

// Auto-mode defaults — which concrete preset to use when prefers-color-
// scheme is dark vs light. User can override either side via the settings
// drawer; persisted alongside the main `id` in localStorage.
const THEME_AUTO_DARK_DEFAULT  = 'default';
const THEME_AUTO_LIGHT_DEFAULT = 'parchment';

function _readThemePref(){
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return { id:'default', custom:null, autoDark:THEME_AUTO_DARK_DEFAULT, autoLight:THEME_AUTO_LIGHT_DEFAULT };
    const j = JSON.parse(raw);
    return {
      id: j.id || 'default',
      custom: j.custom || null,
      autoDark:  j.autoDark  || THEME_AUTO_DARK_DEFAULT,
      autoLight: j.autoLight || THEME_AUTO_LIGHT_DEFAULT,
    };
  } catch(e){ return { id:'default', custom:null, autoDark:THEME_AUTO_DARK_DEFAULT, autoLight:THEME_AUTO_LIGHT_DEFAULT }; }
}

function _writeThemePref(pref){
  try { localStorage.setItem(THEME_KEY, JSON.stringify(pref)); } catch(e){}
}

// Auto-mode: when id === 'auto', resolve which concrete preset to apply
// from the OS prefers-color-scheme media query. Lets the workspace flip
// dark/light automatically when the user changes system settings.
function _resolveAutoTarget(pref){
  const wantsDark = !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (wantsDark) return (pref && pref.autoDark)  || THEME_AUTO_DARK_DEFAULT;
  return            (pref && pref.autoLight) || THEME_AUTO_LIGHT_DEFAULT;
}

function applyTheme(id, custom, pref){
  const root = document.documentElement;
  // Auto mode → recurse with the resolved concrete preset id.
  if (id === 'auto'){
    const target = _resolveAutoTarget(pref || _readThemePref());
    applyTheme(target, null, null);
    return;
  }
  let vars;
  if (id === 'custom' && custom){
    vars = { ...THEME_PRESETS.default.vars, ...custom };
  } else {
    vars = (THEME_PRESETS[id] || THEME_PRESETS.default).vars;
  }
  Object.entries(vars).forEach(([k,v]) => root.style.setProperty(k, v));
}

// Apply on script load so the page paints with the right colors.
(function(){
  const pref = _readThemePref();
  applyTheme(pref.id, pref.custom, pref);
  // When the user has chosen 'auto', listen for OS theme changes so the
  // workspace flips live (e.g. macOS auto-dark at sunset). The listener
  // is registered once and only re-applies if the current pref still says
  // 'auto' — switching to a concrete preset stops responding.
  if (window.matchMedia){
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const cur = _readThemePref();
      if (cur.id === 'auto') applyTheme('auto', null, cur);
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange); // Safari fallback
  }
})();

// Wires up the theme controls in the Settings drawer. Called from initSettings.
function initThemeControls(){
  const sel = document.getElementById('theme-select');
  const customRow = document.getElementById('theme-custom-row');
  const accentInp = document.getElementById('theme-accent');
  const bgInp     = document.getElementById('theme-bg');
  const panelInp  = document.getElementById('theme-panel');
  if (!sel) return;

  // Populate select — Auto at the top, then every concrete preset, then
  // Custom at the bottom. The auto option keeps its own sub-row visible
  // for picking which dark/light presets it should snap to.
  const presetOptions = Object.entries(THEME_PRESETS).map(([id, p]) =>
    `<option value="${id}">${p.label}</option>`).join('');
  sel.innerHTML = '<option value="auto">Auto (follow OS dark/light)</option>'
                + presetOptions
                + '<option value="custom">Custom…</option>';

  const pref = _readThemePref();
  sel.value = pref.id;
  const custom = pref.custom || {
    '--accent':'#d4a574',
    '--bg':'#1a1a1a',
    '--panel':'#232323',
  };
  accentInp.value = custom['--accent'] || '#d4a574';
  bgInp.value     = custom['--bg']     || '#1a1a1a';
  panelInp.value  = custom['--panel']  || '#232323';
  customRow.style.display = pref.id === 'custom' ? '' : 'none';

  // Auto-mode sub-row — two selects letting the user choose which preset
  // gets used for dark / light system preference. Created dynamically (so
  // we don't have to touch the HTML), inserted right after the main theme
  // select. Visible only when the user's chosen 'auto'.
  let autoRow = document.getElementById('theme-auto-row');
  if (!autoRow){
    autoRow = document.createElement('div');
    autoRow.id = 'theme-auto-row';
    autoRow.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap';
    autoRow.innerHTML = `
      <label style="flex:1;min-width:120px;font-size:var(--fs-sm);color:var(--text-muted);display:flex;flex-direction:column;gap:3px">
        🌙 When OS is dark
        <select id="theme-auto-dark">${presetOptions}</select>
      </label>
      <label style="flex:1;min-width:120px;font-size:var(--fs-sm);color:var(--text-muted);display:flex;flex-direction:column;gap:3px">
        ☀ When OS is light
        <select id="theme-auto-light">${presetOptions}</select>
      </label>`;
    sel.parentNode.insertBefore(autoRow, sel.nextSibling);
  }
  const autoDarkSel  = document.getElementById('theme-auto-dark');
  const autoLightSel = document.getElementById('theme-auto-light');
  autoDarkSel.value  = pref.autoDark  || THEME_AUTO_DARK_DEFAULT;
  autoLightSel.value = pref.autoLight || THEME_AUTO_LIGHT_DEFAULT;
  autoRow.style.display = pref.id === 'auto' ? '' : 'none';

  const persist = () => {
    const id = sel.value;
    const next = {
      id,
      custom: id === 'custom' ? _gatherCustom() : null,
      autoDark:  autoDarkSel.value,
      autoLight: autoLightSel.value,
    };
    _writeThemePref(next);
    applyTheme(id, next.custom, next);
  };

  sel.addEventListener('change', () => {
    const id = sel.value;
    customRow.style.display = id === 'custom' ? '' : 'none';
    autoRow.style.display   = id === 'auto'   ? '' : 'none';
    persist();
  });
  autoDarkSel.addEventListener('change', () => { if (sel.value === 'auto') persist(); else persist(); });
  autoLightSel.addEventListener('change', () => { if (sel.value === 'auto') persist(); else persist(); });

  function _gatherCustom(){
    // Build a derived palette: accent shades follow accent; panel shades follow panel.
    const accent = accentInp.value;
    const bg     = bgInp.value;
    const panel  = panelInp.value;
    return {
      '--bg': bg,
      '--panel': panel,
      '--panel-2': _shade(panel, 8),
      '--panel-3': _shade(panel, 18),
      '--border': _shade(panel, 28),
      '--accent': accent,
      '--accent-dark': _shade(accent, -25),
    };
  }
  [accentInp, bgInp, panelInp].forEach(inp => {
    inp.addEventListener('input', () => {
      if (sel.value !== 'custom') return;
      persist();
      _renderContrastChips();
    });
  });

  // Build (once) the contrast-chip strip under the custom-theme row. Hidden
  // by default; shown when the user is on the custom preset. Repaints
  // whenever a custom color changes or the preset switches.
  let chipStrip = document.getElementById('theme-contrast-chips');
  if (!chipStrip){
    chipStrip = document.createElement('div');
    chipStrip.id = 'theme-contrast-chips';
    chipStrip.className = 'theme-contrast-strip';
    customRow.appendChild(chipStrip);
  }
  const updateChipsVisibility = () => {
    chipStrip.style.display = sel.value === 'custom' ? '' : 'none';
  };
  updateChipsVisibility();
  sel.addEventListener('change', updateChipsVisibility);
  // Paint chips now in case the user re-opens settings while already on custom.
  _renderContrastChips();
}

// ─── WCAG contrast helpers ─────────────────────────────────────────────────
// Per WCAG 2.1 § 1.4.3: AA requires ≥ 4.5:1 for normal text, ≥ 3:1 for UI.
// We surface both thresholds in the chip color (green ≥ 4.5, amber 3–4.5,
// red < 3) so the DM gets a quick at-a-glance read on the custom palette.
function _wcagRatio(hex1, hex2){
  const L1 = _relLuminance(hex1);
  const L2 = _relLuminance(hex2);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}
function _relLuminance(hex){
  const m = String(hex).replace('#','').match(/^([a-f\d]{6})$/i);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = ch((n>>16) & 0xff);
  const g = ch((n>>8)  & 0xff);
  const b = ch( n      & 0xff);
  return 0.2126*r + 0.7152*g + 0.0722*b;
}
function _renderContrastChips(){
  const strip = document.getElementById('theme-contrast-chips');
  if (!strip) return;
  // Read the *resolved* CSS variables off :root — captures whatever was just
  // applied (handles both the live color inputs and any preset switch).
  const cs = getComputedStyle(document.documentElement);
  const norm = v => {
    const s = String(v||'').trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    // Accept rgb()/rgba() too.
    const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m){
      const hex = (n) => parseInt(n).toString(16).padStart(2,'0');
      return '#' + hex(m[1]) + hex(m[2]) + hex(m[3]);
    }
    return '#000000';
  };
  const text   = norm(cs.getPropertyValue('--text')   || '#e8e8e8');
  const panel  = norm(cs.getPropertyValue('--panel'));
  const panel2 = norm(cs.getPropertyValue('--panel-2'));
  const accent = norm(cs.getPropertyValue('--accent'));
  const pairs = [
    { label: 'Text / Panel',    ratio: _wcagRatio(text,   panel),  target: 4.5 },
    { label: 'Text / Panel-2',  ratio: _wcagRatio(text,   panel2), target: 4.5 },
    { label: 'Accent / Panel',  ratio: _wcagRatio(accent, panel),  target: 3.0 },
  ];
  strip.innerHTML = pairs.map(p => {
    const ok   = p.ratio >= 4.5;
    const warn = p.ratio >= 3.0 && p.ratio < 4.5;
    const cls  = ok ? 'ok' : warn ? 'warn' : 'fail';
    const icon = ok ? '✓' : warn ? '⚠' : '✕';
    const note = ok ? 'AA' : warn ? 'AA large only' : 'below AA';
    return `<span class="theme-contrast-chip ${cls}" title="${esc(p.label)}: ${p.ratio.toFixed(2)}:1 — ${note}">${icon} ${esc(p.label)} ${p.ratio.toFixed(1)}:1</span>`;
  }).join('');
}

// Lighten (+) or darken (-) a hex color by `amt` (0-100).
function _shade(hex, amt){
  const m = String(hex).replace('#','').match(/^([a-f\d]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n>>16) & 0xff, g = (n>>8) & 0xff, b = n & 0xff;
  const f = amt / 100;
  if (f >= 0){ r = Math.min(255, Math.round(r + (255-r)*f)); g = Math.min(255, Math.round(g + (255-g)*f)); b = Math.min(255, Math.round(b + (255-b)*f)); }
  else      { r = Math.max(0, Math.round(r * (1+f))); g = Math.max(0, Math.round(g * (1+f))); b = Math.max(0, Math.round(b * (1+f))); }
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}
