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

function _readThemePref(){
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return { id:'default', custom:null };
    const j = JSON.parse(raw);
    return { id: j.id || 'default', custom: j.custom || null };
  } catch(e){ return { id:'default', custom:null }; }
}

function _writeThemePref(pref){
  try { localStorage.setItem(THEME_KEY, JSON.stringify(pref)); } catch(e){}
}

function applyTheme(id, custom){
  const root = document.documentElement;
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
  applyTheme(pref.id, pref.custom);
})();

// Wires up the theme controls in the Settings drawer. Called from initSettings.
function initThemeControls(){
  const sel = document.getElementById('theme-select');
  const customRow = document.getElementById('theme-custom-row');
  const accentInp = document.getElementById('theme-accent');
  const bgInp     = document.getElementById('theme-bg');
  const panelInp  = document.getElementById('theme-panel');
  if (!sel) return;

  // Populate select
  sel.innerHTML = Object.entries(THEME_PRESETS).map(([id, p]) =>
    `<option value="${id}">${p.label}</option>`
  ).join('') + '<option value="custom">Custom…</option>';

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

  sel.addEventListener('change', () => {
    const id = sel.value;
    customRow.style.display = id === 'custom' ? '' : 'none';
    if (id === 'custom'){
      const c = _gatherCustom();
      _writeThemePref({ id, custom: c });
      applyTheme(id, c);
    } else {
      _writeThemePref({ id, custom: null });
      applyTheme(id, null);
    }
  });

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
      const c = _gatherCustom();
      _writeThemePref({ id:'custom', custom: c });
      applyTheme('custom', c);
    });
  });
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
