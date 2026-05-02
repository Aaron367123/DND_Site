// ============================================================
// TIME TRACKER PANEL
// ============================================================
// In-game clock + calendar with a 24-hour dial. Default uses a fantasy
// calendar (12 months × 30 days). Hour 0 is midnight; hour 6 = sunrise,
// hour 12 = noon, hour 18 = sunset.

const TIME_MONTHS = [
  'Hammer', 'Alturiak', 'Ches', 'Tarsakh', 'Mirtul', 'Kythorn',
  'Flamerule', 'Eleasis', 'Eleint', 'Marpenoth', 'Uktar', 'Frostwane',
];
// Real-world month each Forgotten Realms month corresponds to.
const TIME_MONTHS_REAL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const TIME_DAYS_PER_MONTH = 30;

function _timeHydrate() {
  try {
    const raw = localStorage.getItem('skt-time-v1');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { day: 9, month: 11 /* Frostwane */, year: 1492, hour: 15 };
}

function _timeAdvance(t, deltaHours) {
  let total = (t.year * TIME_MONTHS.length * TIME_DAYS_PER_MONTH * 24)
            + (t.month * TIME_DAYS_PER_MONTH * 24)
            + ((t.day - 1) * 24)
            + t.hour
            + deltaHours;
  if (total < 0) total = 0;
  const hour  = ((total % 24) + 24) % 24;
  const days  = Math.floor(total / 24);
  const day   = (days % TIME_DAYS_PER_MONTH) + 1;
  const months = Math.floor(days / TIME_DAYS_PER_MONTH);
  const month = months % TIME_MONTHS.length;
  const year  = Math.floor(months / TIME_MONTHS.length);
  return { hour, day, month, year };
}

// Build a 24-segment SVG ring colored by time-of-day. Segment for the current
// hour is highlighted (full opacity); others are dimmed.
function _timeRingSvg(curHour) {
  const cx=110, cy=110, r=85, inner=62;
  // Per-hour color (HSL eased through dawn → noon → dusk → midnight)
  const hourColor = (h) => {
    // 0–5 night, 6–8 dawn, 9–14 day, 15–18 dusk, 19–23 night
    if (h<5)  return '#2c2a55';      // deep night
    if (h<7)  return '#5d4a7a';      // pre-dawn
    if (h<9)  return '#d49b5e';      // sunrise orange
    if (h<14) return '#e8c66f';      // bright day
    if (h<17) return '#dfa867';      // afternoon gold
    if (h<19) return '#b46a4a';      // sunset
    if (h<21) return '#5e3a6a';      // dusk
    return '#2a2858';                 // late night
  };
  // Convert hour i (0-23) to a slice from angle-15° → angle+15° (center at hour position)
  // 0 = top (midnight), advance clockwise. So angle = i * 15° - 90° (top = -90°).
  const slices = [];
  for (let i=0;i<24;i++){
    const a0 = (i*15 - 90 - 7.5) * Math.PI/180;
    const a1 = (i*15 - 90 + 7.5) * Math.PI/180;
    const x0 = cx + r*Math.cos(a0),  y0 = cy + r*Math.sin(a0);
    const x1 = cx + r*Math.cos(a1),  y1 = cy + r*Math.sin(a1);
    const xi0 = cx + inner*Math.cos(a0), yi0 = cy + inner*Math.sin(a0);
    const xi1 = cx + inner*Math.cos(a1), yi1 = cy + inner*Math.sin(a1);
    const path = `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L${xi1.toFixed(2)} ${yi1.toFixed(2)} A${inner} ${inner} 0 0 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z`;
    const isCur = i === curHour;
    slices.push(`<path d="${path}" fill="${hourColor(i)}" opacity="${isCur?1:0.55}" stroke="${isCur?'#f0d090':'transparent'}" stroke-width="${isCur?1.5:0}"/>`);
  }
  // Hour-hand pointer at current hour
  const ang = (curHour*15 - 90) * Math.PI/180;
  const px = cx + (r+4)*Math.cos(ang), py = cy + (r+4)*Math.sin(ang);
  const pix = cx + (inner-3)*Math.cos(ang), piy = cy + (inner-3)*Math.sin(ang);
  return `<svg viewBox="0 0 220 220" class="time-ring">
    ${slices.join('')}
    <line x1="${pix.toFixed(2)}" y1="${piy.toFixed(2)}" x2="${px.toFixed(2)}" y2="${py.toFixed(2)}" stroke="#f0d090" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}

registerPanel('time', {
  title:'Time Tracker', icon:'⏱',
  _data:null,

  mount(body){
    this._body = body;
    if (!this._data) this._data = _timeHydrate();
    this._render();
  },
  unmount(){ this._body = null; },

  _save(){ try{ localStorage.setItem('skt-time-v1', JSON.stringify(this._data)); }catch(e){} },

  _advance(deltaHours){
    this._data = _timeAdvance(this._data, deltaHours);
    this._save();
    this._render();
  },

  _render(){
    const b = this._body; if(!b) return;
    const t = this._data;
    const monthName = TIME_MONTHS[t.month] || 'Unknown';
    const realMonth = TIME_MONTHS_REAL[t.month] || '';
    b.style.cssText = 'padding:14px;overflow-y:auto;height:100%;display:flex;flex-direction:column;align-items:center';
    const monthOpts = TIME_MONTHS.map((m,i) =>
      `<option value="${i}"${i===t.month?' selected':''}>${esc(m)}</option>`).join('');
    b.innerHTML = `
      <div class="time-dial">
        ${_timeRingSvg(t.hour)}
        <div class="time-center">
          <div class="time-hour" data-edit="hour" title="Click to edit">Hr ${t.hour}</div>
          <div class="time-date" data-edit="date" title="Click to edit">${esc(monthName)} ${realMonth?`<span class="time-date-real">(${esc(realMonth)})</span> `:''}${t.day}</div>
          <div class="time-year" data-edit="year" title="Click to edit">${t.year||0} DR</div>
        </div>
      </div>
      <div class="time-edit-row" id="time-edit-row" style="display:none">
        <select id="time-month" title="Month">${monthOpts}</select>
        <input type="number" id="time-day" min="1" max="${TIME_DAYS_PER_MONTH}" value="${t.day}" title="Day">
        <input type="number" id="time-year" value="${t.year||0}" title="Year">
        <input type="number" id="time-hour" min="0" max="23" value="${t.hour}" title="Hour">
        <button class="btn small primary" id="time-edit-done">✓</button>
      </div>
      <div class="time-advance-label">ADVANCE</div>
      <div class="time-buttons">
        <button class="btn time-btn" data-delta="-24">−1d</button>
        <button class="btn time-btn" data-delta="-1">−1h</button>
        <button class="btn time-btn" data-delta="1">+1h</button>
        <button class="btn time-btn" data-delta="24">+1d</button>
      </div>
    `;

    // Click any of the center labels → reveal the edit row, focus the matching field
    const editRow = b.querySelector('#time-edit-row');
    const focusMap = { hour:'#time-hour', date:'#time-month', year:'#time-year' };
    b.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      editRow.style.display = 'flex';
      const sel = b.querySelector(focusMap[el.dataset.edit] || '#time-month');
      if (sel) { sel.focus(); if (sel.select) sel.select(); }
    }));

    // Commit on ✓ click, Enter, or any field blur (with a short delay so
    // tabbing between fields doesn't immediately close the row)
    const commit = () => {
      const m = parseInt(b.querySelector('#time-month').value);
      const d = parseInt(b.querySelector('#time-day').value);
      const y = parseInt(b.querySelector('#time-year').value);
      const h = parseInt(b.querySelector('#time-hour').value);
      this._data = {
        month: isNaN(m) ? this._data.month : Math.max(0, Math.min(TIME_MONTHS.length-1, m)),
        day:   isNaN(d) ? this._data.day   : Math.max(1, Math.min(TIME_DAYS_PER_MONTH, d)),
        year:  isNaN(y) ? this._data.year  : Math.max(0, y),
        hour:  isNaN(h) ? this._data.hour  : Math.max(0, Math.min(23, h)),
      };
      this._save();
      this._render();
    };
    b.querySelector('#time-edit-done').addEventListener('click', commit);
    editRow.querySelectorAll('input,select').forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    });

    b.querySelectorAll('.time-btn').forEach(btn => btn.addEventListener('click', () => {
      this._advance(+btn.dataset.delta);
    }));
  },
});
