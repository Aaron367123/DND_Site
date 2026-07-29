// ============================================================
// SHARED CONTENT-PANEL BEHAVIOUR  (Adventures + Books)
// ============================================================
// The Adventures and Books panels render the same 5etools content structure
// and had grown as near-copies: 24 members with matching names, 19 of them
// >90% identical and 13 byte-for-byte. Everything that genuinely differed was
// a user-facing noun.
//
// The duplication had already cost real bugs. A cross-tab sync fix had to be
// hand-mirrored between the files; one shipped a copy-paste message reading
// "No adventures match." while showing books; and the comments drifted, so the
// same function documented "3000+ items" in one copy and nothing in the other
// because a fix was explained in only one place.
//
// Each panel supplies:  _kindLabel — 'Adventure' | 'Book', for print titles.
//
// NOT shared, deliberately:
//   * every MUTABLE state property (_bookmarks, _advCache, _currentAdvId, …).
//     Merging is by assignment, so a shared object literal would hand BOTH
//     panels the same object and they would scribble over each other.
//   * _renderList and mount — genuinely different (86 of ~150 lines), because
//     adventures and books surface different metadata.
//   * each panel's hidden-source handling and bookmark storage key.
'use strict';

const CONTENT_PANEL_SHARED = {

  // Tag → _5eData.cat lookup map. Covers every category the loader knows
  // about. Tags whose intended target is a specialised file (e.g. status
  // = condition) fold into the right cat here.
  _ADV_TAG_CAT: {
    creature:'monster', spell:'spell',
    item:'item', itemProperty:'item', itemMastery:'item',
    condition:'condition', status:'condition', disease:'condition',
    background:'background', race:'race', feat:'feat',
    optfeature:'optionalfeature',
    class:'class', classFeature:'classFeature', subclassFeature:'classFeature',
    deity:'deity', object:'object', vehicle:'vehicle', reward:'reward',
    psionic:'psionic', trap:'trap', hazard:'hazard',
    variantrule:'variantrule', table:'table', language:'language',
    cult:'cult', boon:'boon',
    action:'action', skill:'skill', sense:'sense',
    charoption:'charoption', facility:'facility',
    deck:'deck', encounter:'encounter', recipe:'recipe',
  },

  _render(){
    const b = this._body; if (!b) return;
    if (this._currentAdvId) this._renderAdv();
    else this._renderList();
  },

  // Inline string → HTML. The default pipeline strips 5etools tags to plain
  // text. For the adventure panel we want creature/spell/item/condition refs
  // to render as hoverable spans and area refs as click-to-jump links. We
  // capture those tags BEFORE _stripTags sees them, swap in safe placeholder
  // sentinels (`\x10N\x10`), run the original strip/escape/render pipeline,
  // then substitute the sentinels with the real HTML.
  _inline(str){
    if (typeof _stripTags !== 'function' || typeof _renderInline !== 'function'){
      return esc(String(str ?? ''));
    }
    const s = String(str ?? '');
    const placeholders = [];
    // Hoverable reference tags + the few link-style ones (area, adventure,
    // book). Everything else continues to flow through _stripTags as-is.
    const TAGS_RE = /\{@(creature|spell|item|itemProperty|itemMastery|condition|status|disease|background|race|feat|optfeature|class|classFeature|subclassFeature|deity|object|vehicle|reward|psionic|trap|hazard|variantrule|table|language|cult|boon|action|skill|sense|charoption|facility|deck|encounter|recipe|area|adventure|book)\s+([^}]+)\}/gi;
    const marked = s.replace(TAGS_RE, (_full, tag, body) => {
      const idx = placeholders.length;
      placeholders.push({ tag: tag.toLowerCase(), body });
      return '\x10' + idx + '\x10';
    });
    let html = _renderInline(esc(_stripTags(marked)));
    html = html.replace(/\x10(\d+)\x10/g, (_m, idxStr) => {
      const ph = placeholders[+idxStr];
      return ph ? this._renderAdvTag(ph.tag, ph.body) : '';
    });
    return html;
  },

  // Find a 5etools entry by category + name (+ optional source). Returns
  // null if data isn't loaded yet or no match found. Uses the _ADV_TAG_CAT
  // map to translate the tag name into the actual `cat` value the loader
  // stores entries under (so e.g. {@status} hits cat='condition').
  _lookup(tag, name, source){
    if (typeof _5eData === 'undefined' || !_5eData) return null;
    if (typeof _5eLoaded !== 'undefined' && !_5eLoaded) return null;
    const cat = this._ADV_TAG_CAT[tag];
    if (!cat || !name) return null;
    const nlow = name.toLowerCase();
    const slow = (source||'').toLowerCase();
    let best = null;
    for (const d of _5eData){
      if (d.cat !== cat) continue;
      if ((d.name||'').toLowerCase() !== nlow) continue;
      if (slow && (d._source||'').toLowerCase() === slow) return d;
      if (!best) best = d;
    }
    return best;
  },

  // Wrap a captured {@…} reference as either a hover span (creature/spell/
  // item/condition) or a click-to-jump link (area). `body` is the raw text
  // between the tag name and the closing brace, pipe-delimited:
  //   {@creature Goblin Warrior|MM|goblin}
  //   {@area area 1|001|x}
  _renderAdvTag(tag, body){
    const parts = body.split('|').map(p => p.trim());
    if (tag === 'area'){
      const display = parts[0] || 'area';
      const chapter = parts[1] || '';
      return '<a class="adv-link adv-area" href="javascript:void(0)" data-chapter="'
        + esc(chapter) + '">' + esc(display) + '</a>';
    }
    if (tag === 'adventure' || tag === 'book'){
      // Meta refs to source books/adventures — no popover. Show as a subtle
      // styled span so the user can tell it's a reference, not body text.
      const display = parts[2] || parts[0] || '';
      const titleAttr = parts[0] ? ' title="' + esc(parts[0]) + '"' : '';
      return '<span class="adv-link-source"' + titleAttr + '>' + esc(display) + '</span>';
    }
    const name    = parts[0] || '';
    const source  = parts[1] || '';
    const display = parts[2] || name;
    return '<span class="adv-tag" data-tag="' + esc(tag)
      + '" data-name="' + esc(name) + '" data-source="' + esc(source)
      + '">' + esc(display) + '</span>';
  },

  // Build the HTML body for a tooltip pop given the span's dataset.
  // Creature / spell / item get specialised renderers from search.js since
  // their data shape is non-trivial (items have `desc` as a parsed control-
  // char string rather than an `entries` array, and the rich card needs the
  // weapon/armor stats too). Everything else uses the generic entries path.
  _renderAdvPop(tag, name, source){
    const d = this._lookup(tag, name, source);
    if (!d) return '<div class="adv-pop-empty"><strong>' + esc(name) + '</strong><br><span style="color:var(--text-dim);font-size:11px">Reference unavailable (no local data)</span></div>';
    // Pre-render the name header so every card has the title up top —
    // the search-panel renderers (creature/spell/item) don't include one
    // because the search UI shows the name separately above the card.
    const sub = d.meta ? '<div class="adv-pop-sub">' + esc(d.meta) + '</div>' : '';
    const head = '<div class="adv-pop-head"><strong>' + esc(d.name) + '</strong>' + sub + '</div>';
    if (tag === 'creature' && typeof renderMonsterFull === 'function') return head + renderMonsterFull(d, {});
    if (tag === 'spell'    && typeof renderSpellFull   === 'function') return head + renderSpellFull(d);
    if (d.cat === 'item'   && typeof renderItemFull    === 'function') return head + renderItemFull(d);
    // _renderGenericCard already emits its own head — don't double up.
    return this._renderGenericCard(d);
  },

  // Event-delegate hover behaviour. One popover element exists at document
  // level; we just point it at the currently-hovered .adv-tag span.
  _wireAdvHover(){
    const b = this._body; if (!b) return;
    if (!this._advHover){
      this._advHover = { enterTimer: null, leaveTimer: null, currentEl: null, pop: null };
    }
    const H = this._advHover;
    // Tear down any previous listeners on this panel body (we re-wire every
    // render).
    if (H._handlers){
      b.removeEventListener('mouseover', H._handlers.over, true);
      b.removeEventListener('mouseout',  H._handlers.out,  true);
      b.removeEventListener('scroll',    H._handlers.scroll, true);
    }
    const ensurePop = () => {
      if (H.pop && document.body.contains(H.pop)) return H.pop;
      const p = document.createElement('div');
      p.id = 'adv-hover-pop';
      p.style.display = 'none';
      p.addEventListener('mouseenter', () => { clearTimeout(H.leaveTimer); H.leaveTimer = null; });
      p.addEventListener('mouseleave', scheduleHide);
      document.body.appendChild(p);
      H.pop = p;
      return p;
    };
    const hide = () => {
      const p = H.pop; if (p) p.style.display = 'none';
      H.currentEl = null;
    };
    const scheduleHide = () => {
      clearTimeout(H.leaveTimer);
      H.leaveTimer = setTimeout(hide, 150);
    };
    const positionPop = (anchorRect) => {
      const p = H.pop;
      // Render off-screen first to measure.
      p.style.left = '-9999px'; p.style.top = '-9999px';
      p.style.display = 'block';
      const pw = p.offsetWidth || 360;
      const ph = p.offsetHeight || 220;
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = anchorRect.right + 8;
      let top  = anchorRect.top;
      if (left + pw > vw - 8) left = Math.max(8, anchorRect.left - pw - 8); // flip to the left
      if (top + ph > vh - 8)  top  = Math.max(8, vh - ph - 8);
      if (top < 8) top = 8;
      p.style.left = left + 'px';
      p.style.top  = top + 'px';
    };
    const show = (el) => {
      const pop = ensurePop();
      H.currentEl = el;
      pop.innerHTML = this._renderAdvPop(el.dataset.tag, el.dataset.name, el.dataset.source);
      positionPop(el.getBoundingClientRect());
    };
    const onOver = e => {
      const el = e.target.closest && e.target.closest('.adv-tag');
      if (!el || !b.contains(el)) return;
      clearTimeout(H.leaveTimer); H.leaveTimer = null;
      if (H.currentEl === el) return;
      clearTimeout(H.enterTimer);
      H.enterTimer = setTimeout(() => show(el), 250);
    };
    const onOut = e => {
      const el = e.target.closest && e.target.closest('.adv-tag');
      if (!el) return;
      clearTimeout(H.enterTimer); H.enterTimer = null;
      scheduleHide();
    };
    const onScroll = () => { clearTimeout(H.enterTimer); hide(); };
    b.addEventListener('mouseover', onOver, true);
    b.addEventListener('mouseout',  onOut,  true);
    // The chapter content scroller emits scroll on its own element, not the
    // body. Capture-phase listener on the body sees it bubble.
    b.addEventListener('scroll', onScroll, true);
    H._handlers = { over:onOver, out:onOut, scroll:onScroll };
    // Esc to dismiss.
    if (!H._escWired){
      document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
      H._escWired = true;
    }
  },

  // Generic card renderer. Works for any category whose loader stores the
  // raw 5etools JSON under d._raw (every category does). Renders the name,
  // an optional meta line, and the entries array. Because _renderNode
  // recurses through _inline → _renderAdvTag, tags inside the popover are
  // themselves hoverable.
  _renderGenericCard(d){
    const r = d && d._raw; if (!r) return '<div class="adv-pop-empty">No data.</div>';
    const sub = d.meta ? '<div class="adv-pop-sub">' + esc(d.meta) + '</div>' : '';
    let head = '<div class="adv-pop-head"><strong>' + esc(d.name) + '</strong>' + sub + '</div>';
    // Item-specific extras: rarity / attunement aren't in `entries`.
    if (d.cat === 'item'){
      const rarity = r.rarity && r.rarity !== 'none' ? r.rarity : '';
      const attune = r.reqAttune
        ? ' (requires attunement' + (typeof r.reqAttune === 'string' && r.reqAttune !== true ? ' ' + r.reqAttune : '') + ')'
        : '';
      if (rarity || attune){
        head = '<div class="adv-pop-head"><strong>' + esc(d.name) + '</strong>'
          + '<div class="adv-pop-sub">' + esc(rarity) + esc(attune) + '</div></div>';
      }
    }
    const entries = Array.isArray(r.entries) ? r.entries : [];
    const body = entries.length
      ? entries.map(e => typeof e === 'string'
          ? '<p>' + this._inline(e) + '</p>'
          : this._renderNode(e)).join('')
      : (d.desc ? '<p>' + esc(d.desc) + '</p>' : '<div class="adv-pop-empty">No description.</div>');
    return head + '<div class="adv-pop-body">' + body + '</div>';
  },

  _renderChapterEntries(ch){
    if (!ch || !Array.isArray(ch.entries) || !ch.entries.length){
      return '<div class="empty-state" style="padding:20px;color:var(--text-muted)">No content.</div>';
    }
    return ch.entries.map(e => this._renderNode(e)).join('');
  },

  // Recursively render any 5etools entry node to HTML. Adventures use the
  // fullest variety of entry types in the dataset: 'image', 'gallery',
  // 'statblock', 'flowchart', 'flowBlock', 'inset', 'insetReadaloud',
  // 'table', 'tableGroup', 'list', 'quote', 'item', 'section', 'entries',
  // 'spellcasting', 'none'. The earlier _parseEntries silently dropped
  // most of these — this dedicated renderer keeps the page complete.
  _renderNode(node){
    if (node == null) return '';
    if (typeof node === 'string') return `<p>${this._inline(node)}</p>`;
    if (Array.isArray(node)) return node.map(n => this._renderNode(n)).join('');
    if (typeof node !== 'object') return '';
    const t = node.type;
    const renderChildren = arr => (Array.isArray(arr) ? arr : []).map(n => this._renderNode(n)).join('');

    switch (t){
      case 'entries':
      case 'section':
      case 'none':
      case 'inlineBlock':
      case 'internal': {
        const head = node.name ? `<h3 class="adv-section-head">${this._inline(node.name)}</h3>` : '';
        const idAttr = node.id ? ` id="adv-section-${esc(String(node.id))}"` : '';
        return `<section class="adv-section"${idAttr}>${head}${renderChildren(node.entries)}</section>`;
      }
      case 'item': {
        // 5etools "item" inside a list → bold name + inline body. The shape
        // varies — 3000+ items in the book corpus use `entry` (singular
        // string) instead of `entries` (array). Honor both so single-line
        // definitions don't render as just a bold name with no body.
        const name = node.name ? `<strong>${this._inline(node.name)}${node.nameDot===false?'':'.'}</strong> ` : '';
        let body = '';
        if (typeof node.entry === 'string'){
          body = this._inline(node.entry);
        } else if (Array.isArray(node.entries)){
          body = node.entries.map(e => typeof e==='string' ? this._inline(e) : this._renderNode(e)).join(' ');
        }
        return `<p class="adv-item">${name}${body}</p>`;
      }
      case 'abilityGeneric': {
        // Tiny "10 + modifiers" style rule lines. The whole entry lives in
        // node.text — there's no entries array — so we render it inline with
        // an optional bold name prefix.
        const name = node.name ? `<strong>${this._inline(node.name)}.</strong> ` : '';
        return `<p class="adv-item">${name}${this._inline(node.text||'')}</p>`;
      }
      case 'hr':
        return '<hr class="adv-hr">';
      case 'variantInner':
      case 'variant': {
        // Inline variant rule callout. variantInner has the name + nested
        // entries; without the name fallback users lose the heading.
        const head = node.name ? `<h4 class="adv-variant-head">${this._inline(node.name)}</h4>` : '';
        return `<aside class="adv-variant">${head}${renderChildren(node.entries)}</aside>`;
      }
      case 'list': {
        const items = (node.items||[]).map(it => {
          if (typeof it === 'string') return `<li>${this._inline(it)}</li>`;
          return `<li>${this._renderNode(it)}</li>`;
        }).join('');
        const tag = node.style && node.style.includes('list-decimal') ? 'ol' : 'ul';
        return `<${tag} class="adv-content-list">${items}</${tag}>`;
      }
      case 'table':
      case 'tableGroup': {
        if (t === 'tableGroup'){
          return (node.tables||[]).map(tb => this._renderNode(tb)).join('');
        }
        const caption = node.caption ? `<caption>${this._inline(node.caption)}</caption>` : '';
        const head = (node.colLabels||[]).length
          ? `<thead><tr>${node.colLabels.map(c => `<th>${this._inline(c)}</th>`).join('')}</tr></thead>`
          : '';
        const rows = (node.rows||[]).map(r => {
          const cells = (Array.isArray(r) ? r : [r]).map(c => {
            if (typeof c === 'string') return `<td>${this._inline(c)}</td>`;
            if (c && c.roll && c.roll.exact != null) return `<td>${c.roll.exact}</td>`;
            if (c && c.roll && c.roll.min != null) return `<td>${c.roll.min}–${c.roll.max}</td>`;
            // Cell objects carry their text in `entry` (singular). Without
            // this, ~145 tables in the book corpus rendered empty cells.
            if (c && c.type === 'cell' && typeof c.entry === 'string') return `<td>${this._inline(c.entry)}</td>`;
            if (c && c.type) return `<td>${this._renderNode(c)}</td>`;
            return '<td></td>';
          }).join('');
          return `<tr>${cells}</tr>`;
        }).join('');
        return `<div class="adv-table-wrap"><table class="adv-table">${caption}${head}<tbody>${rows}</tbody></table></div>`;
      }
      case 'inset':
      case 'insetReadaloud': {
        const head = node.name ? `<div class="adv-inset-head">${this._inline(node.name)}</div>` : '';
        const cls = t === 'insetReadaloud' ? 'adv-inset adv-inset-readaloud' : 'adv-inset';
        return `<aside class="${cls}">${head}${renderChildren(node.entries)}</aside>`;
      }
      case 'quote': {
        const by = node.by ? `<footer class="adv-quote-by">— ${this._inline(node.by)}${node.from?', '+this._inline(node.from):''}</footer>` : '';
        return `<blockquote class="adv-quote">${renderChildren(node.entries)}${by}</blockquote>`;
      }
      case 'image': {
        const path = node.href && node.href.path ? assetUrl(node.href.path) : '';
        if (!path) return '';
        const cap = node.title || node.caption || '';
        const credit = node.credit ? `<span class="adv-img-credit">${this._inline(node.credit)}</span>` : '';
        return `<figure class="adv-figure"><img crossorigin="anonymous" src="${esc(path)}" alt="${esc(cap)}" loading="lazy" onerror="this.style.display='none'">${(cap||credit)?`<figcaption>${cap?this._inline(cap):''}${credit}</figcaption>`:''}</figure>`;
      }
      case 'gallery': {
        return `<div class="adv-gallery">${(node.images||[]).map(im => this._renderNode(im)).join('')}</div>`;
      }
      case 'statblock': {
        const tag = node.tag || 'creature';
        const label = tag === 'creature' ? 'Creature' : tag.charAt(0).toUpperCase()+tag.slice(1);
        return `<div class="adv-statblock-ref"><strong>${esc(label)}:</strong> ${esc(node.name||'')}${node.source?` <span class="adv-statblock-src">(${esc(node.source)})</span>`:''}</div>`;
      }
      case 'spellcasting': {
        // Render headerEntries + lists of spells per level.
        let html = '<div class="adv-spellcasting">';
        if (node.name) html += `<h3 class="adv-section-head">${this._inline(node.name)}</h3>`;
        (node.headerEntries||[]).forEach(e => html += this._renderNode(e));
        const slots = node.spells || {};
        Object.keys(slots).sort().forEach(lvl => {
          const lvlData = slots[lvl];
          const spells = (lvlData.spells||[]).map(s => this._inline(s)).join(', ');
          html += `<p><strong>Level ${lvl}:</strong> ${spells}</p>`;
        });
        if (Array.isArray(node.daily)){
          // simpler: render any extra nested entries
        }
        (node.footerEntries||[]).forEach(e => html += this._renderNode(e));
        html += '</div>';
        return html;
      }
      case 'flowchart': {
        // Sequence of flowBlocks, render as connected boxes.
        return `<div class="adv-flowchart">${(node.blocks||[]).map(b => this._renderNode(b)).join('')}</div>`;
      }
      case 'flowBlock': {
        const head = node.name ? `<div class="adv-flowblock-head">${this._inline(node.name)}</div>` : '';
        return `<div class="adv-flowblock">${head}${renderChildren(node.entries)}</div>`;
      }
      case 'abilityDc':
        return `<p><strong>Spell save DC</strong> = 8 + proficiency bonus + ${esc((node.attributes||['ability'])[0])} modifier</p>`;
      case 'abilityAttackMod':
        return `<p><strong>Spell attack modifier</strong> = proficiency bonus + ${esc((node.attributes||['ability'])[0])} modifier</p>`;
      case 'square':
      case 'cell':
      case 'hexColsOdd':
      case 'hexColsEven':
        // Layout primitives we don't try to recreate visually — drop silently.
        return '';
      default:
        // Unknown / future type — best effort: render any nested entries.
        if (Array.isArray(node.entries)) return renderChildren(node.entries);
        return '';
    }
  },

  _wireCards(){
    const b = this._body; if (!b) return;
    b.querySelectorAll('.adv-card').forEach(c => {
      const open = async () => {
        this._currentAdvId = c.dataset.aid;
        // Restore last-visited chapter for this adventure if we have one.
        const bm = this._bookmarks && this._bookmarks[this._currentAdvId];
        this._currentChapterIdx = (bm && Number.isInteger(bm.chapterIdx)) ? bm.chapterIdx : 0;
        this._loading = true;
        this._render();
        await this._loadAdventure(this._currentAdvId);
        this._loading = false;
        this._render();
      };
      c.addEventListener('click', open);
      c.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); }
      });
    });
  },

  // ── Adventure view: chapter sidebar + content ──────────────────────────────
  async _renderAdv(){
    const b = this._body; if (!b) return;
    const adv = (this._adventures||[]).find(a => a.id === this._currentAdvId) || { name: this._currentAdvId };
    const file = this._advCache[(this._currentAdvId||'').toLowerCase()];

    if (!file){
      b.innerHTML = `
        <div class="adv-panel">
          <div class="adv-head">
            <button class="btn small" data-act="back">← All adventures</button>
            <span class="adv-head-title">${esc(adv.name)}</span>
          </div>
          <div class="empty-state" style="padding:40px;text-align:center">Loading…</div>
        </div>`;
      b.querySelector('[data-act="back"]').addEventListener('click', () => {
        this._currentAdvId = null;
        this._render();
      });
      return;
    }

    const chapters = (file && file.data) || [];
    if (this._currentChapterIdx >= chapters.length){
      // Stale bookmark past the end — clamp AND persist so the next open
      // doesn't restore the same out-of-range index and re-clamp.
      this._currentChapterIdx = 0;
      this._bumpBookmark();
    }
    const ch = chapters[this._currentChapterIdx];

    const tocHtml = chapters.map((c, i) => `
      <button class="adv-chapter${i===this._currentChapterIdx?' active':''}" data-ci="${i}" title="${esc(c.name||'')}">
        <span class="adv-chapter-num">${i+1}</span>
        <span class="adv-chapter-name">${esc(c.name||'Untitled')}</span>
      </button>`).join('');

    const contentHtml = ch
      ? `<h2 class="adv-content-title">${esc(ch.name||'')}</h2>${this._renderChapterEntries(ch)}`
      : '<div class="empty-state" style="padding:30px">Empty chapter.</div>';

    b.innerHTML = `
      <div class="adv-panel adv-panel-detail">
        <div class="adv-head">
          <button class="btn small" data-act="back">← All adventures</button>
          <span class="adv-head-title">${esc(adv.name)}</span>
          <span class="adv-head-meta">${esc((adv.source||'')+(adv.published?(' · '+adv.published):''))}</span>
          <span style="flex:1"></span>
          <button class="btn small" data-act="print" title="Open a print-friendly view (chapter picker + browser Print → save as PDF)">🖨 Print / Export</button>
        </div>
        <div class="adv-body">
          <div class="adv-toc">
            <div class="adv-toc-head">Chapters · ${chapters.length}</div>
            <div class="adv-toc-list">${tocHtml || '<div class="empty-state" style="padding:20px;font-size:11px">No chapters in this file.</div>'}</div>
          </div>
          <div class="adv-content" id="adv-content">${contentHtml}</div>
        </div>
      </div>`;

    b.querySelector('[data-act="back"]').addEventListener('click', () => {
      this._currentAdvId = null;
      this._render();
    });
    b.querySelector('[data-act="print"]')?.addEventListener('click', () => this._openPrintPicker(adv, file));
    b.querySelectorAll('.adv-chapter').forEach(btn => btn.addEventListener('click', () => {
      this._currentChapterIdx = +btn.dataset.ci;
      this._bumpBookmark();
      this._render();
      // Scroll the new chapter content to the top.
      const c = this._body?.querySelector('#adv-content');
      if (c) c.scrollTop = 0;
    }));

    // Hover popovers for {@creature}, {@spell}, {@item}, {@condition}.
    this._wireAdvHover();

    // Area links: click to scroll to the matching section.
    b.querySelectorAll('.adv-link.adv-area').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const id = a.dataset.chapter;
      if (!id) return;
      const target = b.querySelector('#adv-section-' + CSS.escape(id));
      const scroller = b.querySelector('#adv-content');
      if (target && scroller){
        // Use offsetTop relative to the scroller, not scrollIntoView (which
        // scrolls the wrong ancestor when nested in the workspace).
        scroller.scrollTo({ top: target.offsetTop - 8, behavior: 'smooth' });
      }
    }));
  },

  // Open a chapter-picker modal for print/export. User checks which
  // chapters to include and clicks "Open print view" — we open a new
  // tab/window containing self-contained HTML (TOC + each chapter as a
  // print-page). The user then File → Print → Save as PDF from the new
  // window. Avoids embedding any PDF dependency.
  _openPrintPicker(adv, file){
    const chapters = (file && file.data) || [];
    if (!chapters.length){
      if (typeof showToast === 'function') showToast('No chapters to print');
      return;
    }
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:520px;max-width:92vw;max-height:90vh;display:flex;flex-direction:column">
      <h3 style="margin:0 0 4px">Print "${esc(adv.name|| this._kindLabel)}"</h3>
      <p style="margin:0 0 12px;font-size:11px;color:var(--text-muted)">Pick chapters → opens a print-friendly view. Use your browser's File → Print to save as PDF.</p>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button class="btn small" id="adv-print-all">Select all</button>
        <button class="btn small" id="adv-print-none">Select none</button>
        <span style="flex:1"></span>
        <label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:5px;cursor:pointer">
          <input type="checkbox" id="adv-print-images" checked> Include images
        </label>
      </div>
      <div style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:5px;padding:6px;background:var(--panel-2)">
        ${chapters.map((c, i) => `
          <label class="adv-print-row" style="display:flex;align-items:center;gap:8px;padding:4px 6px;font-size:12px;cursor:pointer;border-radius:3px">
            <input type="checkbox" class="adv-print-chk" data-ci="${i}" checked>
            <span style="color:var(--text-dim);min-width:24px">${i+1}.</span>
            <span style="flex:1;color:var(--text)">${esc(c.name || 'Untitled')}</span>
          </label>
        `).join('')}
      </div>
      <div class="modal-actions" style="margin-top:10px">
        <span id="adv-print-count" style="font-size:11px;color:var(--text-muted);align-self:center">${chapters.length} chapters selected</span>
        <span style="flex:1"></span>
        <button class="btn" id="adv-print-close">Cancel</button>
        <button class="btn primary" id="adv-print-go">Open print view</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector('#adv-print-close').addEventListener('click', close);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
    backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    const checks = backdrop.querySelectorAll('.adv-print-chk');
    const countEl = backdrop.querySelector('#adv-print-count');
    const refresh = () => {
      const n = [...checks].filter(c => c.checked).length;
      countEl.textContent = n + ' chapter' + (n===1?'':'s') + ' selected';
      backdrop.querySelector('#adv-print-go').disabled = n === 0;
    };
    checks.forEach(c => c.addEventListener('change', refresh));
    backdrop.querySelector('#adv-print-all').addEventListener('click', () => {
      checks.forEach(c => c.checked = true); refresh();
    });
    backdrop.querySelector('#adv-print-none').addEventListener('click', () => {
      checks.forEach(c => c.checked = false); refresh();
    });
    backdrop.querySelector('#adv-print-go').addEventListener('click', () => {
      const picks = [...checks].filter(c => c.checked).map(c => +c.dataset.ci);
      if (!picks.length) return;
      const includeImages = backdrop.querySelector('#adv-print-images').checked;
      this._openPrintWindow(adv, file, picks, { includeImages });
      close();
    });
  },

  // Build a self-contained HTML document for the chosen chapters and open
  // it in a new tab. Reuses the same `_renderChapterEntries` HTML so
  // tables / read-aloud boxes / lists look identical to the live panel.
  // Adds a print stylesheet that swaps to black-on-white and ensures
  // chapter breaks land on new pages.
  _openPrintWindow(adv, file, chapterIndices, opts){
    const includeImages = opts?.includeImages !== false;
    const chapters = (file && file.data) || [];
    const tocItems = chapterIndices.map((i, n) => `
      <li><a href="#chap-${i}"><span class="num">${n+1}.</span> ${esc(chapters[i]?.name || 'Untitled')}</a></li>
    `).join('');
    const chaptersHtml = chapterIndices.map(i => {
      const ch = chapters[i]; if (!ch) return '';
      let body = this._renderChapterEntries(ch);
      // Strip <img> tags if the user opted out of images. Cheap regex —
      // accepted because our output is generated by us and never contains
      // image-look-alikes in plain text.
      if (!includeImages) body = body.replace(/<img\b[^>]*>/g, '');
      return `<section class="chap" id="chap-${i}">
        <h1 class="chap-title">${esc(ch.name || 'Untitled')}</h1>
        ${body}
      </section>`;
    }).join('');

    // Pull a few theme colors so the on-screen preview matches the app,
    // but the @print rules override to high-contrast paper styling.
    const css = `
      *,*::before,*::after{box-sizing:border-box}
      html,body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
      body{background:#1a1a1a;color:#e8e8e8;font-size:13px;line-height:1.55;padding:30px 50px;max-width:900px;margin:0 auto}
      h1.title{font-size:34px;margin:0 0 4px;color:#d4a574}
      h1.title + .meta{color:#999;font-size:13px;margin-bottom:30px}
      h2.toc-title{margin:30px 0 8px;font-size:18px;border-bottom:1px solid #3a3a3a;padding-bottom:5px}
      ol.toc{list-style:none;padding:0;margin:0 0 30px}
      ol.toc li{padding:3px 0;font-size:13px}
      ol.toc a{color:#d4a574;text-decoration:none}
      ol.toc a:hover{text-decoration:underline}
      ol.toc .num{display:inline-block;width:30px;color:#999;font-variant-numeric:tabular-nums}
      .chap{page-break-before:always;break-before:page;padding-top:20px}
      .chap-title{font-size:26px;border-bottom:2px solid #d4a574;padding-bottom:6px;margin:0 0 14px}
      .chap p{margin:0 0 10px}
      .chap h3,.chap h4,.chap h5{color:#d4a574;margin:18px 0 6px}
      .chap ul,.chap ol{margin:0 0 10px;padding-left:24px}
      .chap li{margin:2px 0}
      .chap table{border-collapse:collapse;margin:10px 0;width:100%;font-size:12px}
      .chap th,.chap td{border:1px solid #3a3a3a;padding:5px 9px;text-align:left}
      .chap th{background:#2a2a2a;color:#d4a574}
      .chap img{max-width:100%;height:auto;display:block;margin:10px 0;border-radius:4px}
      .chap blockquote,.chap .inset{background:rgba(212,165,116,0.08);border-left:3px solid #d4a574;margin:10px 0;padding:8px 14px}
      .chap .read-aloud,.chap .inset-readaloud{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:4px;padding:10px 14px;font-style:italic;margin:10px 0}
      .adv-tag{color:#d4a574}
      .toolbar{position:sticky;top:0;background:#1a1a1a;border-bottom:1px solid #3a3a3a;padding:10px 0;margin:-30px 0 20px;display:flex;gap:8px;align-items:center;z-index:10}
      .toolbar button{background:#333;border:1px solid #3a3a3a;color:#e8e8e8;padding:6px 14px;font-size:13px;border-radius:4px;cursor:pointer;font-family:inherit}
      .toolbar button:hover{background:#444}
      .toolbar .primary{background:#d4a574;color:#1a1a1a;border-color:#d4a574;font-weight:600}
      .toolbar .meta{color:#999;font-size:12px;flex:1;text-align:right}
      @media print{
        body{background:#fff;color:#000;padding:0;font-size:11pt;max-width:none}
        .toolbar{display:none}
        h1.title{color:#5a3a14}
        h1.title + .meta{color:#444}
        h2.toc-title{border-color:#000}
        ol.toc a{color:#000;text-decoration:none}
        ol.toc .num{color:#666}
        .chap-title{color:#5a3a14;border-color:#5a3a14}
        .chap h3,.chap h4,.chap h5{color:#5a3a14}
        .chap th{background:#f0e8d8;color:#5a3a14}
        .chap th,.chap td{border-color:#aaa}
        .chap blockquote,.chap .inset{background:#f7f0e0;border-color:#5a3a14}
        .chap .read-aloud,.chap .inset-readaloud{background:#f0f0f0;border-color:#aaa}
        .adv-tag{color:#000}
        @page{margin:1.5cm}
      }
    `;
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(adv.name|| this._kindLabel)} — Print</title>
  <base href="${esc(location.origin + location.pathname.replace(/[^/]+$/, ''))}">
  <style>${css}</style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">🖨 Print / Save as PDF</button>
    <button onclick="window.close()">Close</button>
    <span class="meta">${esc(adv.name|| this._kindLabel)} · ${chapterIndices.length} chapter${chapterIndices.length===1?'':'s'}</span>
  </div>
  <h1 class="title">${esc(adv.name || this._kindLabel)}</h1>
  <div class="meta">${esc((adv.source||'') + (adv.published?(' · '+adv.published):''))}</div>
  <h2 class="toc-title">Contents</h2>
  <ol class="toc">${tocItems}</ol>
  ${chaptersHtml}
</body>
</html>`;

    // Open the new tab and write the document. Some popup blockers reject
    // this — show a toast in that case so the user knows to allow popups.
    const win = window.open('', '_blank');
    if (!win){
      if (typeof showToast === 'function') showToast('Pop-up blocked — allow pop-ups for this site to use print export.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    if (typeof showToast === 'function') showToast('Print view opened — use File → Print in the new tab');
  },

  unmount(){
    if (this._onStorage){ window.removeEventListener('storage', this._onStorage); this._onStorage = null; }
    this._body = null;
  },
};

// Merge shared behaviour into a registered panel WITHOUT clobbering anything
// the panel defines itself, so a panel can still specialise any of these by
// simply declaring its own. Call after registerPanel().
function applyContentPanelShared(id){
  const def = (typeof panelDefs !== 'undefined') && panelDefs[id];
  if (!def) return;
  Object.keys(CONTENT_PANEL_SHARED).forEach(k => {
    if (!Object.prototype.hasOwnProperty.call(def, k)) def[k] = CONTENT_PANEL_SHARED[k];
  });
}
