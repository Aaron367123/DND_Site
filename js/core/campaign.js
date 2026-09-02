// ============================================================
// CAMPAIGNS
// ============================================================
// One browser profile, several campaigns. Each has its own party, combat,
// notes, maps, loot, clock — and its own live sync, so two campaigns can be
// running with two different groups and never see each other.
//
// ── How the isolation actually works ────────────────────────────────────────
//
// Every panel in this app reads localStorage['skt-…'] directly, by name, in
// dozens of places. Namespacing those keys would mean touching every one of
// them and would leave a permanent trap for the next feature that forgets.
// So the live keys keep their names and the SWITCH does the work: the outgoing
// campaign's keys are copied into a store of their own, then the incoming
// campaign's are copied back over them. Nothing else in the codebase has to
// know campaigns exist.
//
// Firebase is the opposite case — one shared tree, and getting it wrong means
// pushing one campaign's state over another group's table. There the id is in
// the path: skt/c/<id>/… . realtime.js asks for the root rather than spelling
// it, so a campaign switch redirects every read and write at once.
//
// ── What is NOT per-campaign ────────────────────────────────────────────────
//
// The registry itself, the active id, and anything the backup layer already
// classes as per-device (which character you are, view preferences, zoom).
// Those describe this browser, not a campaign, and copying them between
// campaigns would be wrong rather than merely redundant.

const SKT_CAMPAIGNS_KEY = 'skt-campaigns-v1';   // [{id, name, created}]
const SKT_CAMPAIGN_ACTIVE = 'skt-campaign-active-v1';
const SKT_CAMPAIGN_DATA = 'skt-campaign-data-';  // + id → that campaign's keys

// The id the very first campaign gets. Named rather than random so the
// migration is recognisable in the database and in a backup file.
const SKT_CAMPAIGN_MAIN = 'main';

// Keys that belong to the BROWSER rather than to a campaign, and so are left
// alone by a switch. Deliberately reuses the backup layer's own list — it has
// already had this argument, and two lists would drift.
function _sktDeviceKeys(){
  const extra = ['skt-me-v1', 'skt-zoom-v1', 'skt-view-prefs-v1', 'skt-nosync',
                 'skt-tv-acts-v1', 'skt-bm-view-v1', 'skt-bm-view-player-v1'];
  const set = new Set(extra);
  set.add(SKT_CAMPAIGNS_KEY);
  set.add(SKT_CAMPAIGN_ACTIVE);
  return set;
}

function sktCampaigns(){
  try {
    const raw = localStorage.getItem(SKT_CAMPAIGNS_KEY);
    const a = raw ? JSON.parse(raw) : null;
    if (Array.isArray(a) && a.length) return a;
  } catch(e){}
  return [{ id: SKT_CAMPAIGN_MAIN, name: 'My Campaign', created: null }];
}

function _sktSaveCampaigns(list){
  try { localStorage.setItem(SKT_CAMPAIGNS_KEY, JSON.stringify(list)); } catch(e){}
}

// The active campaign id. A ?c= in the URL wins, which is what makes a
// per-campaign player link work: the link decides, not whatever this browser
// had open last.
function sktActiveCampaign(){
  try {
    const q = new URLSearchParams(location.search).get('c');
    if (q && sktCampaigns().some(c => c.id === q)) return q;
  } catch(e){}
  try {
    const id = localStorage.getItem(SKT_CAMPAIGN_ACTIVE);
    if (id && sktCampaigns().some(c => c.id === id)) return id;
  } catch(e){}
  return sktCampaigns()[0].id;
}

function sktActiveCampaignName(){
  const id = sktActiveCampaign();
  const c = sktCampaigns().find(x => x.id === id);
  return (c && c.name) || 'Campaign';
}

// Where this campaign lives in Firebase. Everything in realtime.js hangs off
// this, so one function decides what an entire client is looking at.
function sktFbRoot(){ return 'skt/c/' + sktActiveCampaign(); }

// ── Switching ───────────────────────────────────────────────────────────────

function _sktLiveKeys(){
  const dev = _sktDeviceKeys();
  const out = {};
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if (!k || k.indexOf('skt-') !== 0) continue;
    if (dev.has(k) || k.indexOf(SKT_CAMPAIGN_DATA) === 0) continue;
    const v = localStorage.getItem(k);
    if (v != null) out[k] = v;
  }
  return out;
}

function _sktStash(id){
  try { localStorage.setItem(SKT_CAMPAIGN_DATA + id, JSON.stringify(_sktLiveKeys())); }
  catch(e){
    // Quota. Say so loudly — the alternative is switching away and finding the
    // campaign gone, which is the worst outcome this file can produce.
    if (typeof warnStorageFailure === 'function') warnStorageFailure('campaign save', e);
    return false;
  }
  return true;
}

function _sktUnstash(id){
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SKT_CAMPAIGN_DATA + id) || 'null'); } catch(e){}
  // Clear the outgoing campaign's keys before laying the new one down, or a
  // key the incoming campaign has never written keeps the old value and the
  // two campaigns quietly share a notes tree.
  Object.keys(_sktLiveKeys()).forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
  if (!data){
    // A campaign with nothing stored is BRAND NEW, and "no key" is not the
    // same as "empty" — state.js falls back to DEFAULT_PARTY when the party
    // key is missing, so a new campaign came up holding the app's five demo
    // characters. Those demo names are the ones the app ships with, so a new
    // campaign looked like a half-copy of an existing one.
    //
    // Written explicitly rather than left absent. Only the domains whose
    // default is sample content need it; everything else is already empty
    // when its key is missing.
    try { localStorage.setItem('skt-party-v1', '[]'); } catch(e){}
    return false;
  }
  Object.keys(data).forEach(k => { try { localStorage.setItem(k, data[k]); } catch(e){} });
  return true;
}

// Returns true when the switch happened. Reloads the page on success: every
// panel caches its own slice of state in a module variable, and rebuilding
// them all correctly from here would be a second, drifting copy of what a
// page load already does properly.
function sktSwitchCampaign(id){
  const cur = sktActiveCampaign();
  if (id === cur) return false;
  if (!sktCampaigns().some(c => c.id === id)) return false;
  // Stash BEFORE anything is cleared. If this fails there is nothing to undo.
  if (!_sktStash(cur)) return false;
  _sktUnstash(id);
  try { localStorage.setItem(SKT_CAMPAIGN_ACTIVE, id); } catch(e){}
  return true;
}

function sktCreateCampaign(name){
  const list = sktCampaigns();
  const id = 'c' + Date.now().toString(36);
  list.push({ id, name: String(name || 'New Campaign').slice(0, 60), created: new Date().toISOString() });
  _sktSaveCampaigns(list);
  return id;
}

function sktRenameCampaign(id, name){
  const list = sktCampaigns();
  const c = list.find(x => x.id === id);
  if (!c) return false;
  c.name = String(name || '').slice(0, 60) || c.name;
  _sktSaveCampaigns(list);
  return true;
}

// Deletes the stored copy too. Refuses the last one — a browser with no
// campaign has nowhere to put the keys that are already live.
function sktDeleteCampaign(id){
  const list = sktCampaigns();
  if (list.length < 2) return false;
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return false;
  if (id === sktActiveCampaign()) return false;   // switch away first
  list.splice(i, 1);
  _sktSaveCampaigns(list);
  try { localStorage.removeItem(SKT_CAMPAIGN_DATA + id); } catch(e){}
  return true;
}

// The link a player uses. Carries the campaign so a group always lands in
// theirs, whichever one the DM happens to have open.
function sktPlayerLink(id){
  const u = new URL(location.href);
  u.searchParams.set('player', '1');
  u.searchParams.set('c', id || sktActiveCampaign());
  u.searchParams.delete('nosync');
  return u.toString();
}

// ── First run after this feature shipped ────────────────────────────────────
// A browser that already has a campaign in the live keys gets it adopted as
// "main" rather than being handed an empty table. Nothing is copied or moved:
// the keys are already where a campaign's keys live, so all that is needed is
// a registry entry saying so.
(function _sktAdoptExistingCampaign(){
  try {
    if (localStorage.getItem(SKT_CAMPAIGNS_KEY)) return;      // already set up
    const hasData = Object.keys(_sktLiveKeys()).length > 0;
    _sktSaveCampaigns([{ id: SKT_CAMPAIGN_MAIN,
                         name: hasData ? 'My Campaign' : 'New Campaign',
                         created: new Date().toISOString() }]);
    localStorage.setItem(SKT_CAMPAIGN_ACTIVE, SKT_CAMPAIGN_MAIN);
  } catch(e){}
})();
