// ============================================================
// WEATHER TOOL PANEL
// ============================================================
// Generates a believable weather snapshot for a chosen biome + season.
// Stored under skt-weather-v1 so the rolled state survives reloads.

// All units are metric: temperature °C, wind km/h, precipitation mm.
const WEATHER_BIOMES = {
  temperate: {label:'Temperate', tempBase:[ 2, 27], windBase:[ 3, 24], humidBase:[40,75]},
  arctic:    {label:'Arctic',    tempBase:[-34, -1],windBase:[ 8, 48], humidBase:[30,65]},
  desert:    {label:'Desert',    tempBase:[13, 46], windBase:[ 5, 29], humidBase:[ 5,30]},
  tropical:  {label:'Tropical',  tempBase:[20, 35], windBase:[ 3, 32], humidBase:[60,95]},
  coastal:   {label:'Coastal',   tempBase:[ 7, 27], windBase:[ 8, 40], humidBase:[55,90]},
  mountain:  {label:'Mountain',  tempBase:[-7, 16], windBase:[10, 48], humidBase:[35,70]},
  swamp:     {label:'Swamp',     tempBase:[13, 29], windBase:[ 2, 13], humidBase:[75,98]},
  underdark: {label:'Underdark', tempBase:[13, 20], windBase:[ 0,  3], humidBase:[65,90]},
};
const WEATHER_SEASONS = {
  spring: {label:'Spring', tempShift: -3,  precipBoost: 1.4},
  summer: {label:'Summer', tempShift: +6,  precipBoost: 0.8},
  autumn: {label:'Autumn', tempShift: -2,  precipBoost: 1.2},
  winter: {label:'Winter', tempShift:-12,  precipBoost: 1.0},
};
const WEATHER_CONDITIONS = [
  // [name, icon, cloudRange, precipChance]
  {name:'Clear',         icon:'☀',  clouds:[0,15],   precip:0.02},
  {name:'Sunny',         icon:'🌞', clouds:[5,25],   precip:0.04},
  {name:'Partly Cloudy', icon:'⛅', clouds:[25,55],  precip:0.10},
  {name:'Clouds',        icon:'☁',  clouds:[55,85],  precip:0.25},
  {name:'Overcast',      icon:'🌥', clouds:[85,100], precip:0.45},
  {name:'Rain',          icon:'🌧', clouds:[70,100], precip:0.95},
  {name:'Storm',         icon:'⛈', clouds:[80,100], precip:1.0},
  {name:'Snow',          icon:'❄',  clouds:[60,100], precip:0.9},
  {name:'Fog',           icon:'🌫', clouds:[50,90],  precip:0.15},
];

function _rand(min,max){ return Math.random()*(max-min)+min; }
function _randInt(min,max){ return Math.floor(_rand(min,max+1)); }

function _rollWeather(biomeId, seasonId) {
  const b = WEATHER_BIOMES[biomeId] || WEATHER_BIOMES.temperate;
  const s = WEATHER_SEASONS[seasonId] || WEATHER_SEASONS.summer;
  const temp = Math.round(_rand(b.tempBase[0], b.tempBase[1]) + s.tempShift);
  const wind = +_rand(b.windBase[0], b.windBase[1]).toFixed(1);
  const humid = Math.round(_rand(b.humidBase[0], b.humidBase[1]));
  // Pick a condition weighted by season's precip boost and biome humidity
  const wantWet = Math.random() < (humid/100) * s.precipBoost * 0.6;
  const pool = WEATHER_CONDITIONS.filter(c => {
    if (temp < 1 && c.name === 'Rain') return false;        // freezing → no rain
    if (temp > 1 && c.name === 'Snow') return false;        // above 1°C → no snow
    if (wantWet) return c.precip > 0.4;
    return c.precip < 0.5;
  });
  const cond = pool[_randInt(0, pool.length-1)] || WEATHER_CONDITIONS[0];
  const clouds = _randInt(cond.clouds[0], cond.clouds[1]);
  // Precipitation amount in mm — only meaningful on wet conditions
  let precipText = 'None';
  if (cond.precip > 0.5) {
    const mm = +_rand(1, cond.name==='Storm'?50:20).toFixed(1);
    precipText = mm + ' mm';
  } else if (cond.precip > 0.2 && Math.random() < 0.4) {
    precipText = 'Trace';
  }
  // "Feels like" — wind chill for cold (<10°C, wind >8 km/h),
  // heat index for hot+humid (>24°C, humidity >60%)
  let feelsLike = temp;
  if (temp < 10 && wind > 8)  feelsLike -= Math.round(wind * 0.18);
  if (temp > 24 && humid > 60) feelsLike += Math.round((humid - 60) * 0.08);
  // Wind direction — 8 compass points. Picked uniformly; pressure is rolled
  // separately and biased to match condition (storms = low pressure, clear =
  // high pressure) for flavour rather than meteorological accuracy.
  const WIND_DIRS = ['N','NE','E','SE','S','SW','W','NW'];
  const windDir = WIND_DIRS[Math.floor(Math.random() * WIND_DIRS.length)];
  // Pressure in hPa — sea-level baseline 1013, ±30 hPa range nudged by clouds.
  // Clear/sunny → 1015–1030 (high), Storm/Rain → 988–1005 (low), default mid.
  let pBase = 1013;
  if (cond.name === 'Clear' || cond.name === 'Sunny') pBase = 1020;
  else if (cond.name === 'Storm' || cond.name === 'Rain' || cond.name === 'Snow') pBase = 995;
  const pressure = Math.round(pBase + _rand(-8, 8));
  return {
    biome: biomeId, season: seasonId,
    condition: cond.name, icon: cond.icon,
    temp, feelsLike, wind, windDir, pressure, humid, clouds, precip: precipText,
  };
}

// Northern-hemisphere season mapping for the Forgotten Realms calendar used
// by the Time Tracker panel. Months are 0-indexed (Hammer = 0 = January).
function _seasonForTimeMonth(monthIdx){
  if (monthIdx <= 1)  return 'winter';   // Hammer, Alturiak (Jan–Feb)
  if (monthIdx <= 4)  return 'spring';   // Ches, Tarsakh, Mirtul (Mar–May)
  if (monthIdx <= 7)  return 'summer';   // Kythorn, Flamerule, Eleasis (Jun–Aug)
  if (monthIdx <= 10) return 'autumn';   // Eleint, Marpenoth, Uktar (Sep–Nov)
  return 'winter';                       // Frostwane (Dec)
}

function _weatherHydrate() {
  try {
    const raw = localStorage.getItem('skt-weather-v2');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return _rollWeather('temperate','summer');
}

registerPanel('weather', {
  title:'Weather Tool', icon:'☁',
  _data:null,

  mount(body){
    this._body = body;
    if (!this._data) this._data = _weatherHydrate();
    this._render();
  },
  unmount(){ this._body = null; },

  _save(){ try{ localStorage.setItem('skt-weather-v2', JSON.stringify(this._data)); }catch(e){} },

  _render(){
    const b = this._body; if(!b) return;
    const w = this._data;
    b.style.cssText = 'padding:14px;overflow-y:auto;height:100%';
    const biomeOpts = Object.entries(WEATHER_BIOMES).map(([k,v]) =>
      `<option value="${k}"${k===w.biome?' selected':''}>${esc(v.label)}</option>`).join('');
    const seasonOpts = Object.entries(WEATHER_SEASONS).map(([k,v]) =>
      `<option value="${k}"${k===w.season?' selected':''}>${esc(v.label)}</option>`).join('');
    b.innerHTML = `
      <div class="weather-hero">
        <div class="weather-icon">${w.icon}</div>
        <div class="weather-temp">${w.temp}°C</div>
      </div>
      <div class="weather-sub">
        <div class="weather-condition">${esc(w.condition)}</div>
        <div class="weather-feels">Feels like ${w.feelsLike}°C</div>
      </div>
      <div class="weather-stats">
        <div class="weather-stat"><div class="lab">💨 Wind</div><div class="val">${w.wind} km/h${w.windDir?' '+esc(w.windDir):''}</div></div>
        <div class="weather-stat"><div class="lab">💧 Precip.</div><div class="val">${esc(w.precip)}</div></div>
        <div class="weather-stat"><div class="lab">🌫 Humidity</div><div class="val">${w.humid}%</div></div>
        <div class="weather-stat"><div class="lab">☁ Cloud</div><div class="val">${w.clouds}%</div></div>
        <div class="weather-stat"><div class="lab">🌡 Pressure</div><div class="val">${w.pressure?w.pressure+' hPa':'—'}</div></div>
      </div>
      <div class="weather-controls">
        <label class="field-label">Biome
          <select id="weather-biome">${biomeOpts}</select>
        </label>
        <label class="field-label">Season
          <select id="weather-season">${seasonOpts}</select>
        </label>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn primary weather-reroll" id="weather-reroll" style="flex:1">🎲 Reroll Weather</button>
        <button class="btn" id="weather-sync-season" title="Read the current in-game month from the Time Tracker and match the season">🔗 Sync season</button>
      </div>
    `;
    this._wire();
  },

  _wire(){
    const b = this._body;
    b.querySelector('#weather-biome').addEventListener('change', e => {
      this._data = _rollWeather(e.target.value, this._data.season);
      this._save(); this._render();
    });
    b.querySelector('#weather-season').addEventListener('change', e => {
      this._data = _rollWeather(this._data.biome, e.target.value);
      this._save(); this._render();
    });
    b.querySelector('#weather-reroll').addEventListener('click', () => {
      this._data = _rollWeather(this._data.biome, this._data.season);
      this._save(); this._render();
    });
    b.querySelector('#weather-sync-season')?.addEventListener('click', () => {
      // Read the Time Tracker's current month from localStorage so we don't
      // require its panel to be mounted. Falls back to the current season if
      // the time tracker has never been used.
      let monthIdx = null;
      try {
        const t = JSON.parse(localStorage.getItem('skt-time-v1') || 'null');
        if (t && typeof t.month === 'number') monthIdx = t.month;
      } catch(e){}
      if (monthIdx == null){
        if (typeof showToast === 'function') showToast('No in-game date set — open the Time Tracker first');
        return;
      }
      const newSeason = _seasonForTimeMonth(monthIdx);
      this._data = _rollWeather(this._data.biome, newSeason);
      this._save(); this._render();
      const seasonLabel = WEATHER_SEASONS[newSeason]?.label || newSeason;
      if (typeof showToast === 'function') showToast('Season synced → ' + seasonLabel);
    });
  },
});
