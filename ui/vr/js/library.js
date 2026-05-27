/**
 * library.js – VR scene-wall media browser (Babylon.js GUI-on-mesh).
 *
 * Layout:
 *   • Filter panel (left side)  – studio, performer, tag selectors
 *   • 4 columns × 2 rows = 8 cards per page (Google TV style)
 *   • Nav bar (below grid)      – prev / page info / next
 *
 * Cards feature:
 *   Always-playing preview videos in the thumbnail area,
 *   type & script badges, gradient info overlay with studio,
 *   title, performer chips, tag chips, duration, file size.
 */

import { apiUrl, thumbUrl } from './session.js';

const dbg = msg => {
  try { fetch('/vr/debug', { method: 'POST', body: typeof msg === 'string' ? msg : JSON.stringify(msg) }); } catch (_) { }
};

/* -- Grid constants ------------------------------------------------- */
const COLS = 4;
const ROWS = 2;
const PER_PAGE = COLS * ROWS;          // 8
const CARD_W = 1.50;
const CARD_H = 1.30;
const GAP_X = 0.16;
const GAP_Y = 0.14;
const GRID_Z = 5.0;
const GRID_Y = 2.0;                  // centre-height of grid
const GRID_X_OFF = 0.55;                 // nudge grid right for side panel
const TEX_W = 600;
const TEX_H = 440;
const LAZY_DIST = 14;
const ANIM_MS = 260;
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';

/* -- Filter-panel geometry ------------------------------------------ */
const FP_W = 1.10;                 // world width
const FP_GAP = 0.24;                 // gap to grid edge

/* -- Colours (Dark grey-black palette) ------------------------------ */
const COL = {
  cardBg: 'rgba(15, 15, 15, 0.94)',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  hoverBorder: 'rgba(255, 255, 255, 0.5)',
  title: '#ffffff',
  studio: '#b3b3b3',
  perf: '#9aa0a6',
  dur: '#cccccc',
  durBg: 'rgba(0, 0, 0, 0.85)',
  owned: 'rgba(129, 201, 149, 0.85)',
  remote: 'rgba(253, 214, 99, 0.85)',
  scriptOn: 'rgba(129, 201, 149, 0.88)',
  scriptOff: 'rgba(95, 99, 104, 0.45)',
  filterBg: 'rgba(15, 15, 15, 0.95)',
  filterBord: 'rgba(255, 255, 255, 0.08)',
  accent: '#e0e0e0',
  textDim: '#7a7a7a',
  tagBg: 'rgba(255, 255, 255, 0.10)',
  tagBord: 'rgba(255, 255, 255, 0.20)',
  tagText: '#cccccc',
  typeBg: 'rgba(255, 255, 255, 0.08)',
  typeBord: 'rgba(255, 255, 255, 0.2)',
  typeText: '#cccccc',
};

/* -- Audio helper --------------------------------------------------- */
let audioCtx = null;
function beep(freq = 700, dur = 0.04) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = freq; g.gain.value = 0.04;
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (_) { }
}

/* ===================================================================
   LibraryBrowser
   =================================================================== */
export class LibraryBrowser {
  /**
   * @param {BABYLON.Scene} scene
   * @param {(media:object)=>void} onSelect
   */
  constructor(scene, onSelect) {
    this._scene = scene;
    this._onSelect = onSelect;
    this._items = [];
    this._filtered = [];
    this._page = 1;
    this._totalPages = 1;
    this._visible = true;
    this._isLoading = false;

    /** @type {BABYLON.Mesh[]} */
    this._cardMeshes = [];
    this._navMeshes = [];
    this._filterMeshes = [];

    /* Per-card preview video overlays */
    this._previews = new Map();  // mediaId -> {video, tex, plane, mat}

    /* Filter state */
    this._studios = [];
    this._performers = [];
    this._tags = [];
    this._filterStudio = '';
    this._filterPerformer = '';
    this._filterTag = '';
    this._filterSearch = '';

    /* thumbnail lazy-load */
    this._thumbCache = new Set();
    this._loadQueue = new Map();

    /* visibility checker */
    this._visCb = this._checkLazy.bind(this);
    this._scene.registerBeforeRender(this._visCb);

    /* network recovery */
    this._onOnline = () => { if (this._visible) this.refresh(); };
    window.addEventListener('online', this._onOnline);

    dbg('[lib] wall init  cols=' + COLS + ' rows=' + ROWS + ' perPage=' + PER_PAGE);
  }

  /* ================================================================
     Public API
     ================================================================ */

  async load(page = 1) {
    if (this._isLoading) return;
    this._isLoading = true;
    try {
      this._items = await this._fetch();
      this._applyFilters();
      this._page = Math.min(Math.max(1, page), this._totalPages);
      await this._fetchFilterLists();
      await this._render();
      dbg('[lib] page ' + this._page + '/' + this._totalPages +
        '  (' + this._filtered.length + '/' + this._items.length + ')');
    } catch (e) {
      dbg('[lib] load error: ' + e.message);
    } finally {
      this._isLoading = false;
    }
  }

  async loadRaw() {
    this._items = await this._fetch();
    return this._items;
  }

  async refresh() { await this.load(this._page); }

  setVisible(v, animate = true) {
    this._visible = v;
    const s = v ? 1 : 0;
    for (const m of this._cardMeshes) {
      if (animate) this._scaleTo(m, s, ANIM_MS);
      else { m.scaling.setAll(s); m.isVisible = v; }
    }
    for (const m of this._navMeshes) m.isVisible = v;
    for (const m of this._filterMeshes) m.isVisible = v;

    // Keep previews playing on tab switch if we only set visibility
    // Or we could hide them to conserve render power:
    if (v) {
      for (const pv of this._previews.values()) if (pv.plane) pv.plane.isVisible = true;
    } else {
      for (const pv of this._previews.values()) if (pv.plane) pv.plane.isVisible = false;
    }
  }

  dispose() {
    window.removeEventListener('online', this._onOnline);
    this._scene.unregisterBeforeRender(this._visCb);
    this._disposeAll();
    this._thumbCache.clear();
    this._loadQueue.clear();
  }

  /* ================================================================
     Fetch
     ================================================================ */

  async _fetch(attempt = 1) {
    try {
      const url = apiUrl('/api/library?limit=2000&owned=1');
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const files = d.files || d.items || [];
      files.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      return files;
    } catch (e) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        return this._fetch(attempt + 1);
      }
      throw e;
    }
  }

  async _fetchFilterLists() {
    try {
      const [sRes, pRes, tRes] = await Promise.all([
        fetch(apiUrl('/api/library/studios')).catch(() => null),
        fetch(apiUrl('/api/library/performers')).catch(() => null),
        fetch(apiUrl('/api/library/tags')).catch(() => null),
      ]);
      if (sRes?.ok) this._studios = await sRes.json();
      if (pRes?.ok) this._performers = await pRes.json();
      if (tRes?.ok) this._tags = await tRes.json();
    } catch (e) { dbg('[lib] filter fetch: ' + e.message); }
  }

  /* ================================================================
     Client-side filters
     ================================================================ */

  _applyFilters() {
    let list = this._items;
    const q = this._filterSearch.toLowerCase();
    if (q) {
      list = list.filter(m => {
        const hay = ((m.title || '') + ' ' + (m.studio || '') + ' ' +
          (m.performers || []).join(' ')).toLowerCase();
        return hay.includes(q);
      });
    }
    if (this._filterStudio) {
      list = list.filter(m =>
        (m.studio || '') === this._filterStudio ||
        (this._filterStudio === 'Unknown' && !m.studio));
    }
    if (this._filterPerformer) {
      const pf = this._filterPerformer.toLowerCase();
      list = list.filter(m =>
        (m.performers || []).some(p => p.toLowerCase().includes(pf)));
    }
    if (this._filterTag) {
      list = list.filter(m => (m.tags || []).includes(this._filterTag));
    }
    this._filtered = list;
    this._totalPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (this._page > this._totalPages) this._page = 1;
  }

  _setFilter(key, value) {
    this['_filter' + key] = value;
    this._applyFilters();
    this._page = 1;
    this._render();
  }

  /* ================================================================
     Render
     ================================================================ */

  async _render() {
    this._disposeAll();

    const slice = this._filtered.slice(
      (this._page - 1) * PER_PAGE,
      (this._page - 1) * PER_PAGE + PER_PAGE);

    const totalW = COLS * CARD_W + (COLS - 1) * GAP_X;
    const totalH = ROWS * CARD_H + (ROWS - 1) * GAP_Y;

    // Grid is shifted right to make room for the filter panel
    const ox = GRID_X_OFF - totalW / 2 + CARD_W / 2;
    const oy = GRID_Y + totalH / 2 - CARD_H / 2;

    for (let i = 0; i < slice.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = ox + col * (CARD_W + GAP_X);
      const y = oy - row * (CARD_H + GAP_Y);
      const card = this._buildCard(slice[i], x, y, GRID_Z, i);
      card.scaling.setAll(0);
      setTimeout(() => this._scaleTo(card, 1, ANIM_MS), i * 40);
    }

    // Auto-activate previews for all cards on the page.
    setTimeout(() => {
      if (this._visible) {
        for (const media of slice) {
          if (media.previewPath) {
            const mesh = this._cardMeshes.find(m => m.metadata?.media?.id === media.id);
            if (mesh) this._activatePreview(media, mesh);
          }
        }
      }
    }, 500);

    // Filter panel on the left
    const gridLeftX = GRID_X_OFF - totalW / 2;
    this._buildFilterPanel(gridLeftX, totalH);

    // Navigation below the grid
    this._buildNav(oy, totalH);

    this.setVisible(this._visible, false);
  }

  /** Rebuild only the filter panel without touching scene cards or previews. */
  _rebuildFilterPanel() {
    // Dispose only filter-panel meshes
    for (const m of this._filterMeshes) m.dispose();
    this._filterMeshes = [];

    const totalW = COLS * CARD_W + (COLS - 1) * GAP_X;
    const totalH = ROWS * CARD_H + (ROWS - 1) * GAP_Y;
    const gridLeftX = GRID_X_OFF - totalW / 2;
    this._buildFilterPanel(gridLeftX, totalH);
  }

  /* ================================================================
     Card builder (Google TV style, always-on previews)
     ================================================================ */

  _buildCard(media, x, y, z, idx) {
    const scene = this._scene;
    const uid = 'c' + idx + '_' + media.id;

    const plane = BABYLON.MeshBuilder.CreatePlane(uid,
      { width: CARD_W, height: CARD_H }, scene);
    plane.position.set(x, y, z);
    plane.isPickable = true;

    const tex = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(plane, TEX_W, TEX_H);
    tex.useInvalidateRectOptimization = true;
    tex.hasAlpha = true;  // Transparent mesh background — only GUI content renders

    /* -- Card container -- */
    const card = new BABYLON.GUI.Rectangle(uid + '_card');
    card.width = '100%'; card.height = '100%';
    card.cornerRadius = 16;
    card.color = COL.cardBorder;
    card.background = COL.cardBg;
    card.thickness = 1;
    card.clipChildren = true;
    card.shadowColor = 'rgba(0,0,0,0.4)';
    card.shadowBlur = 12;
    card.useBitmapCache = true;
    tex.addControl(card);

    /* -- Thumbnail area (top 76%) -- */
    const thumbArea = new BABYLON.GUI.Rectangle(uid + '_ta');
    thumbArea.width = '100%'; thumbArea.height = '76%';
    thumbArea.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    thumbArea.color = 'transparent'; thumbArea.thickness = 0;
    thumbArea.background = 'rgba(18,18,18,0.6)';
    thumbArea.clipChildren = true;
    card.addControl(thumbArea);

    // Static thumbnail (visible until preview video starts)
    const img = new BABYLON.GUI.Image(uid + '_img', '');
    img.width = '100%'; img.height = '100%';
    img.stretch = BABYLON.GUI.Image.STRETCH_UNIFORM;
    img.alpha = 0;
    thumbArea.addControl(img);

    /* -- Duration pill (bottom-right of thumbnail) -- */
    if (media.duration) {
      const durPill = new BABYLON.GUI.Rectangle(uid + '_dp');
      durPill.heightInPixels = 20;
      durPill.adaptWidthToChildren = true;
      durPill.paddingLeftInPixels = 6;
      durPill.paddingRightInPixels = 6;
      durPill.cornerRadius = 4;
      durPill.background = COL.durBg;
      durPill.color = 'transparent'; durPill.thickness = 0;
      durPill.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
      durPill.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
      durPill.left = '-6px'; durPill.top = '-6px';
      thumbArea.addControl(durPill);
      const dpTxt = new BABYLON.GUI.TextBlock(uid + '_dpt',
        this._fmtDuration(media.duration));
      dpTxt.color = '#fff'; dpTxt.fontSize = 10; dpTxt.fontWeight = 'bold';
      dpTxt.fontFamily = FONT; dpTxt.resizeToFit = true;
      dpTxt.paddingLeftInPixels = 4; dpTxt.paddingRightInPixels = 4;
      durPill.useBitmapCache = true;
      durPill.addControl(dpTxt);
    }

    /* -- Info area (bottom 28%) -- */
    const infoArea = new BABYLON.GUI.Rectangle(uid + '_info');
    infoArea.width = '100%'; infoArea.height = '28%';
    infoArea.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
    infoArea.color = 'transparent'; infoArea.thickness = 0;
    infoArea.background = COL.cardBg;
    infoArea.useBitmapCache = true;
    card.addControl(infoArea);

    /* gradient bleed into thumbnail */
    const gradBleed = new BABYLON.GUI.Rectangle(uid + '_grad');
    gradBleed.width = '100%'; gradBleed.height = '24px';
    gradBleed.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    gradBleed.color = 'transparent'; gradBleed.thickness = 0;
    gradBleed.background = 'rgba(30,30,30,0.45)';
    gradBleed.top = '-12px';
    infoArea.addControl(gradBleed);

    const infoCol = new BABYLON.GUI.StackPanel(uid + '_ic');
    infoCol.isVertical = true;
    infoCol.width = '92%';
    infoCol.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    infoCol.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    infoCol.top = '6px';
    infoArea.addControl(infoCol);

    /* Row 1: Studio label */
    const studioTxt = new BABYLON.GUI.TextBlock(uid + '_st',
      (media.studio || 'Unknown').toUpperCase());
    studioTxt.color = COL.studio; studioTxt.fontSize = 10;
    studioTxt.fontWeight = 'bold'; studioTxt.fontFamily = FONT;
    studioTxt.height = '16px';
    studioTxt.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    infoCol.addControl(studioTxt);

    this._spacer(infoCol, 2);

    /* Row 2: Title (wrapped, 2 lines max) */
    const titleTxt = new BABYLON.GUI.TextBlock(uid + '_title',
      this._trunc(media.title || 'Untitled', 52));
    titleTxt.color = COL.title; titleTxt.fontSize = 14;
    titleTxt.fontWeight = 'bold'; titleTxt.fontFamily = FONT;
    titleTxt.textWrapping = true; titleTxt.height = '36px';
    titleTxt.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    titleTxt.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    infoCol.addControl(titleTxt);

    /* Row 3: Performers */
    const perfs = (media.performers || []).slice(0, 3);
    const perfStr = perfs.length
      ? perfs.join(' · ') + (media.performers.length > 3 ? ' …' : '') : '';
    if (perfStr) {
      const perfTxt = new BABYLON.GUI.TextBlock(uid + '_pf', perfStr);
      perfTxt.color = COL.perf; perfTxt.fontSize = 10;
      perfTxt.fontFamily = FONT; perfTxt.height = '16px';
      perfTxt.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
      infoCol.addControl(perfTxt);
    }

    /* Row 4: Tag chips */
    const tags = (media.tags || []).slice(0, 4);
    if (tags.length > 0) {
      this._spacer(infoCol, 2);
      const tagRow = new BABYLON.GUI.StackPanel(uid + '_tr');
      tagRow.isVertical = false; tagRow.height = '18px'; tagRow.width = '100%';
      infoCol.addControl(tagRow);
      for (const tag of tags) {
        const tagName = typeof tag === 'string' ? tag : (tag.name || String(tag));
        const chip = new BABYLON.GUI.Rectangle(uid + '_tc_' + tagName.substring(0, 8));
        chip.heightInPixels = 16; chip.cornerRadius = 4;
        chip.adaptWidthToChildren = true;
        chip.paddingLeftInPixels = 2; chip.paddingRightInPixels = 2;
        chip.background = COL.tagBg;
        chip.color = COL.tagBord; chip.thickness = 0.5;
        tagRow.addControl(chip);
        const ct = new BABYLON.GUI.TextBlock('', this._trunc(tagName, 12));
        ct.color = COL.tagText; ct.fontSize = 8; ct.fontFamily = FONT;
        ct.resizeToFit = true;
        ct.paddingLeftInPixels = 4; ct.paddingRightInPixels = 4;
        chip.addControl(ct);
      }
      if (media.tags.length > 4) {
        const moreT = new BABYLON.GUI.TextBlock(uid + '_tm',
          '+' + (media.tags.length - 4));
        moreT.color = COL.textDim; moreT.fontSize = 8;
        moreT.fontFamily = FONT; moreT.width = '24px';
        tagRow.addControl(moreT);
      }
    }

    this._spacer(infoCol, 2);

    /* Row 5: Badge row (type · script · size) */
    const badgeRow = new BABYLON.GUI.StackPanel(uid + '_br');
    badgeRow.isVertical = false; badgeRow.height = '18px'; badgeRow.width = '100%';
    infoCol.addControl(badgeRow);

    // VR type + resolution chip
    const resStr = media.videoRes || '';
    let resLabel = '';
    if (resStr.includes('4320')) resLabel = '8K';
    else if (resStr.includes('2160')) resLabel = '4K';
    else if (resStr.includes('1440')) resLabel = '1440p';
    else if (resStr.includes('1080')) resLabel = '1080p';
    else if (resStr.includes('720')) resLabel = '720p';
    let vrType = '180°';
    const titleL = (media.title || '').toLowerCase();
    if (titleL.includes('360')) vrType = '360°';
    else if (titleL.includes('2d')) vrType = '2D';
    const typeTxt = [resLabel, vrType].filter(Boolean).join(' · ');

    const typeChip = new BABYLON.GUI.Rectangle(uid + '_tyc');
    typeChip.heightInPixels = 16; typeChip.cornerRadius = 3;
    typeChip.adaptWidthToChildren = true;
    typeChip.background = COL.typeBg;
    typeChip.color = COL.typeBord; typeChip.thickness = 0.5;
    badgeRow.addControl(typeChip);
    const typT = new BABYLON.GUI.TextBlock('', typeTxt);
    typT.color = COL.typeText; typT.fontSize = 9; typT.fontWeight = 'bold';
    typT.fontFamily = FONT; typT.resizeToFit = true;
    typT.paddingLeftInPixels = 5; typT.paddingRightInPixels = 5;
    typeChip.addControl(typT);

    // Script status chip
    const hasScript = !!media.scriptPath;
    const scChip = new BABYLON.GUI.Rectangle(uid + '_sc');
    scChip.heightInPixels = 16; scChip.cornerRadius = 3;
    scChip.adaptWidthToChildren = true;
    scChip.paddingLeftInPixels = 4;
    scChip.background = hasScript ? 'rgba(129,201,149,0.15)' : 'rgba(95,99,104,0.12)';
    scChip.color = 'transparent'; scChip.thickness = 0;
    badgeRow.addControl(scChip);
    const scT = new BABYLON.GUI.TextBlock('', hasScript ? '📜' : '');
    scT.color = hasScript ? COL.scriptOn : COL.scriptOff;
    scT.fontSize = 9; scT.fontFamily = FONT; scT.resizeToFit = true;
    scT.paddingLeftInPixels = 3; scT.paddingRightInPixels = 3;
    scChip.addControl(scT);

    // Positions chip
    const posList = [];
    if (media.positions) {
      if (media.positions.laying) posList.push('🛌');
      if (media.positions.sitting) posList.push('🪑');
      if (media.positions.leaning) posList.push('🧘'); // using yoga for leaning/crouching or similar
      if (media.positions.standing) posList.push('🧍');
    }
    if (posList.length > 0) {
      const posChip = new BABYLON.GUI.Rectangle(uid + '_posc');
      posChip.heightInPixels = 16; posChip.cornerRadius = 3;
      posChip.adaptWidthToChildren = true;
      posChip.paddingLeftInPixels = 6;
      posChip.background = 'rgba(255,255,255,0.15)';
      posChip.color = 'transparent'; posChip.thickness = 0;
      badgeRow.addControl(posChip);
      const posT = new BABYLON.GUI.TextBlock('', posList.join(' '));
      posT.color = '#fff'; posT.fontSize = 10;
      posT.fontFamily = FONT; posT.resizeToFit = true;
      posT.paddingLeftInPixels = 4; posT.paddingRightInPixels = 4;
      posChip.addControl(posT);
    }

    // File size
    if (media.fileSize && media.fileSize !== '??') {
      const szTxt = new BABYLON.GUI.TextBlock(uid + '_sz', media.fileSize);
      szTxt.color = 'rgba(255,255,255,0.35)'; szTxt.fontSize = 9;
      szTxt.fontFamily = FONT; szTxt.resizeToFit = true;
      szTxt.paddingLeftInPixels = 6;
      badgeRow.addControl(szTxt);
    }

    /* -- Hover / click -- */
    card.onPointerEnterObservable.add(() => {
      card.color = COL.hoverBorder;
      card.background = 'rgba(35, 35, 35, 0.98)';
      if (window.triggerHaptic) window.triggerHaptic(0.2, 10);
      beep(600);
    });
    card.onPointerOutObservable.add(() => {
      card.color = COL.cardBorder;
      card.background = COL.cardBg;
    });
    card.onPointerClickObservable.add(() => {
      beep(800);
      if (window.triggerHaptic) window.triggerHaptic(0.7, 20);
      this._scaleTo(plane, 0.94, 80, () => this._scaleTo(plane, 1, 80));
      dbg('[lib] select: ' + media.title);
      this._onSelect(media);
    });

    this._cardMeshes.push(plane);
    plane.metadata = { img, thumbSrc: this._thumbSrc(media), loaded: false, media };

    // Eagerly load thumbnail — only 8 cards per page, no need for lazy distance check
    const src = this._thumbSrc(media);
    if (src) {
      this._loadThumb(src, img);
      plane.metadata.loaded = true;
    }

    return plane;
  }

  /* ================================================================
     Per-card preview video (auto-playing loops)
     ================================================================ */

  _activatePreview(media, cardMesh) {
    if (this._previews.has(media.id)) return; // Already setup
    if (!this._visible || !media.previewPath) return;

    const scene = this._scene;
    const src = apiUrl(media.previewPath);

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true; video.loop = true; video.playsInline = true;
    video.preload = 'metadata'; video.style.display = 'none';
    document.body.appendChild(video);
    video.src = src;

    // Detect if this is VR content for UV cropping
    const isVR = this._isVRContent(media);

    // Overlay plane covers the thumbnail area (top 76%)
    const pw = CARD_W * 0.985;
    const ph = CARD_H * 0.74;
    const prevPlane = BABYLON.MeshBuilder.CreatePlane(
      'pv_' + media.id, { width: pw, height: ph }, scene);
    prevPlane.isPickable = false;

    const pos = cardMesh.position.clone();
    pos.y += CARD_H * 0.14;
    pos.z -= 0.008;
    prevPlane.position = pos;
    prevPlane.isVisible = false;

    const mat = new BABYLON.StandardMaterial('pvMat_' + media.id, scene);
    mat.emissiveColor = BABYLON.Color3.White();
    mat.disableLighting = true; mat.backFaceCulling = false;
    prevPlane.material = mat;

    const entry = { video, tex: null, plane: prevPlane, mat, mediaId: media.id, isVR };
    this._previews.set(media.id, entry);

    const onCanPlay = () => {
      video.removeEventListener('canplay', onCanPlay);
      // Verify entry hasn't been destroyed in the meantime
      if (!this._previews.has(media.id)) { video.pause(); return; }
      try {
        const tex = new BABYLON.VideoTexture('pvTex_' + media.id, video, scene, false, false);

        if (isVR) {
          // For SBS stereo VR: crop to the centre of the left-eye half.
          // Left eye occupies u=[0, 0.5]. We show the middle 60% of that:
          tex.uScale = 0.30;        // 30% of full width  = 60% of left eye
          tex.uOffset = 0.10;        // start at 10% (centres within left half)
          // Vertically: crop the middle 60%
          tex.vScale = 0.60;
          tex.vOffset = 0.20;
        }

        entry.tex = tex;
        mat.diffuseTexture = tex;
        mat.emissiveTexture = tex;
        prevPlane.isVisible = this._visible; // only show if gallery is currently visible

        // Auto play!
        video.play().catch(() => { });
      } catch (e) { dbg('[preview] tex error: ' + e.message); }
    };
    video.addEventListener('canplay', onCanPlay);
    video.load();
  }

  /** Lightweight VR content detection from media metadata (mirrors guessMode in app.js). */
  _isVRContent(media) {
    const haystack = [
      (media.title || ''),
      (media.filename || ''),
      (media.studio || ''),
      ...(media.tags || []),
    ].join(' ').toLowerCase();

    // Explicit 2D markers → not VR
    if (haystack.includes('2d') || haystack.includes('flat') || haystack.includes('pov 2d')) {
      return false;
    }
    // 180° or 360° markers → VR
    if (haystack.includes('180') || haystack.includes('360') ||
      haystack.includes('vr') || haystack.includes('sbs') ||
      haystack.includes('side by side') || haystack.includes('tb') ||
      haystack.includes('top-bottom') || haystack.includes('over-under')) {
      return true;
    }
    // Default: assume VR if no 2D indicators (most content in this app is VR)
    return true;
  }

  _deactivatePreview(mediaId) {
    const pv = this._previews.get(mediaId);
    if (!pv) return;
    this._previews.delete(mediaId);
    pv.video.pause();
    pv.video.removeAttribute('src');
    pv.video.load();
    if (pv.video.parentNode) pv.video.parentNode.removeChild(pv.video);
    if (pv.tex) try { pv.tex.dispose(); } catch (_) { }
    if (pv.mat) try { pv.mat.dispose(); } catch (_) { }
    if (pv.plane) try { pv.plane.dispose(); } catch (_) { }
  }

  _disposePreviews() {
    for (const pv of this._previews.values()) {
      pv.video.pause();
      pv.video.removeAttribute('src');
      pv.video.load();
      if (pv.video.parentNode) pv.video.parentNode.removeChild(pv.video);
      if (pv.tex) try { pv.tex.dispose(); } catch (_) { }
      if (pv.mat) try { pv.mat.dispose(); } catch (_) { }
      if (pv.plane) try { pv.plane.dispose(); } catch (_) { }
    }
    this._previews.clear();
  }

  /* ================================================================
     Filter panel — TABBED DESIGN (left side, vertical)
     Studio / Performer / Tag tabs at top, paginated option list below.
     ================================================================ */

  _buildFilterPanel(gridLeftX, totalH) {
    const panelH = totalH + 0.6;
    const panelX = gridLeftX - FP_GAP - FP_W / 2;
    const panelY = GRID_Y;

    const panelPlane = BABYLON.MeshBuilder.CreatePlane('fpanel',
      { width: FP_W, height: panelH }, this._scene);
    panelPlane.position.set(panelX, panelY, GRID_Z);
    panelPlane.isPickable = true;

    // Face the panel toward the camera at origin.
    // lookAt with Math.PI yaw correction matches the convention used by
    // the control panel (CreatePlane front face requires the flip).
    panelPlane.lookAt(new BABYLON.Vector3(0, panelY, 0), Math.PI);

    const texW = 280, texH = 700;
    const pTex = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(panelPlane, texW, texH);
    pTex.useInvalidateRectOptimization = true;
    pTex.hasAlpha = true;  // Transparent mesh background

    const bg = new BABYLON.GUI.Rectangle('fpBg');
    bg.width = '100%'; bg.height = '100%';
    bg.cornerRadius = 16;
    bg.color = COL.filterBord;
    bg.background = COL.filterBg;
    bg.thickness = 1;
    bg.shadowColor = 'rgba(0,0,0,0.3)';
    bg.shadowBlur = 8;
    bg.clipChildren = true;
    bg.isPointerBlocker = true;   // prevent ray-cast click-through to cards behind panel
    pTex.addControl(bg);

    const col = new BABYLON.GUI.StackPanel('fpCol');
    col.isVertical = true;
    col.width = '90%'; col.height = '96%';
    col.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    col.top = '10px';
    bg.addControl(col);

    /* ── Header: title + scene count ── */
    const hdrRow = new BABYLON.GUI.StackPanel('fpHdr');
    hdrRow.isVertical = false; hdrRow.height = '22px'; hdrRow.width = '100%';
    col.addControl(hdrRow);

    const title = new BABYLON.GUI.TextBlock('fpTitle', '🔍 FILTERS');
    title.color = COL.accent; title.fontSize = 14;
    title.fontWeight = 'bold'; title.fontFamily = FONT;
    title.widthInPixels = 150;
    title.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    hdrRow.addControl(title);

    const countTxt = new BABYLON.GUI.TextBlock('fpCount',
      this._filtered.length + ' scenes');
    countTxt.color = COL.textDim; countTxt.fontSize = 10;
    countTxt.fontFamily = FONT; countTxt.widthInPixels = 100;
    countTxt.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
    hdrRow.addControl(countTxt);

    this._spacer(col, 6);

    /* ── Active filter chips (compact row) ── */
    const parts = [];
    if (this._filterStudio) parts.push({ key: 'Studio', val: this._filterStudio });
    if (this._filterPerformer) parts.push({ key: 'Performer', val: this._filterPerformer });
    if (this._filterTag) parts.push({ key: 'Tag', val: this._filterTag });

    if (parts.length) {
      const chipRow = new BABYLON.GUI.StackPanel('fpChips');
      chipRow.isVertical = false; chipRow.height = '22px'; chipRow.width = '100%';
      col.addControl(chipRow);

      for (const p of parts) {
        const chip = new BABYLON.GUI.Rectangle('fpAc_' + p.key);
        chip.heightInPixels = 20; chip.cornerRadius = 5;
        chip.adaptWidthToChildren = true;
        chip.paddingLeftInPixels = 2; chip.paddingRightInPixels = 2;
        chip.background = 'rgba(255,255,255,0.1)';
        chip.color = 'rgba(255,255,255,0.2)'; chip.thickness = 1;
        chip.isPointerBlocker = true;
        chipRow.addControl(chip);

        const ct = new BABYLON.GUI.TextBlock('', '✕ ' + this._trunc(p.val, 10));
        ct.color = COL.accent; ct.fontSize = 9; ct.fontFamily = FONT;
        ct.resizeToFit = true;
        ct.paddingLeftInPixels = 4; ct.paddingRightInPixels = 4;
        chip.addControl(ct);

        chip.onPointerClickObservable.add(() => {
          beep(700);
          if (window.triggerHaptic) window.triggerHaptic(0.5, 10);
          this._setFilter(p.key, '');
        });
      }

      // Clear-all mini button
      const clrChip = new BABYLON.GUI.Rectangle('fpClrChip');
      clrChip.heightInPixels = 20; clrChip.cornerRadius = 5;
      clrChip.adaptWidthToChildren = true;
      clrChip.paddingLeftInPixels = 2;
      clrChip.background = 'rgba(255,80,80,0.12)';
      clrChip.color = 'rgba(255,100,100,0.25)'; clrChip.thickness = 1;
      clrChip.isPointerBlocker = true;
      chipRow.addControl(clrChip);
      const clrT = new BABYLON.GUI.TextBlock('', '✕ All');
      clrT.color = '#ff6666'; clrT.fontSize = 9; clrT.fontFamily = FONT;
      clrT.resizeToFit = true;
      clrT.paddingLeftInPixels = 4; clrT.paddingRightInPixels = 4;
      clrChip.addControl(clrT);
      clrChip.onPointerClickObservable.add(() => {
        beep(800);
        if (window.triggerHaptic) window.triggerHaptic(0.7, 15);
        this._filterStudio = ''; this._filterPerformer = ''; this._filterTag = '';
        this._filterSearch = '';
        this._applyFilters(); this._page = 1; this._render();
      });

      this._spacer(col, 4);
    }

    this._hline(col);
    this._spacer(col, 4);

    /* ── Tab bar (Studio / Performer / Tag) ── */
    const TABS = [
      { key: 'Studio', label: 'Studio', opts: Array.isArray(this._studios) ? this._studios : [] },
      { key: 'Performer', label: 'Perf.', opts: Array.isArray(this._performers) ? this._performers : [] },
      { key: 'Tag', label: 'Tag', opts: (Array.isArray(this._tags) ? this._tags : []).map(t => typeof t === 'string' ? t : (t.name || String(t))) },
    ];

    // Default to first tab
    if (!this._activeTab) this._activeTab = 'Studio';

    // texW=280, col=90% → 252px usable; each of 3 tabs = 82px (2px gap between via paddingRight)
    const TAB_W = Math.floor((texW * 0.90 - 4) / TABS.length); // ≈82px

    const tabRow = new BABYLON.GUI.StackPanel('fpTabs');
    tabRow.isVertical = false; tabRow.height = '28px'; tabRow.width = '100%';
    col.addControl(tabRow);

    for (const tab of TABS) {
      const isActive = this._activeTab === tab.key;
      const tBtn = new BABYLON.GUI.Rectangle('fpt_' + tab.key);
      tBtn.widthInPixels = TAB_W; tBtn.height = '26px';
      tBtn.paddingRightInPixels = 2;
      tBtn.cornerRadius = 6;
      tBtn.background = isActive ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)';
      tBtn.color = isActive ? 'rgba(255,255,255,0.3)' : 'transparent';
      tBtn.thickness = isActive ? 1 : 0;
      tBtn.isPointerBlocker = true;
      tabRow.addControl(tBtn);

      const tTxt = new BABYLON.GUI.TextBlock('', tab.label);
      tTxt.color = isActive ? '#ffffff' : COL.textDim;
      tTxt.fontSize = 11; tTxt.fontWeight = isActive ? 'bold' : 'normal';
      tTxt.fontFamily = FONT;
      tBtn.addControl(tTxt);

      tBtn.onPointerEnterObservable.add(() => {
        tBtn.background = 'rgba(255,255,255,0.25)'; tTxt.color = '#ffffff';
        if (window.triggerHaptic) window.triggerHaptic(0.2, 5);
      });
      tBtn.onPointerOutObservable.add(() => {
        tBtn.background = isActive ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)';
        tTxt.color = isActive ? '#ffffff' : COL.textDim;
      });
      tBtn.onPointerClickObservable.add(() => {
        beep(600);
        if (window.triggerHaptic) window.triggerHaptic(0.5, 10);
        this._activeTab = tab.key;
        this._filterPickerPage = 0;
        this._rebuildFilterPanel();
      });
    }

    this._spacer(col, 4);
    this._hline(col);
    this._spacer(col, 4);

    /* ── Paginated options list for active tab ── */
    const activeTab = TABS.find(t => t.key === this._activeTab) || TABS[0];
    const allOpts = activeTab.opts.map(o => typeof o === 'string' ? o : (o.name || o.label || String(o)));
    const PAGE_SIZE = 18;
    const fpPage = this._filterPickerPage || 0;
    const totalFpPages = Math.max(1, Math.ceil(allOpts.length / PAGE_SIZE));
    const pageOpts = allOpts.slice(fpPage * PAGE_SIZE, (fpPage + 1) * PAGE_SIZE);

    // Currently-selected value for this filter key
    const currentVal = this['_filter' + activeTab.key] || '';

    for (const optName of pageOpts) {
      const isSelected = optName === currentVal;
      const optBtn = new BABYLON.GUI.Rectangle('fpo_' + optName.substring(0, 16));
      optBtn.width = '100%'; optBtn.height = '26px';
      optBtn.cornerRadius = 5;
      optBtn.background = isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.03)';
      optBtn.color = isSelected ? 'rgba(255,255,255,0.3)' : 'transparent';
      optBtn.thickness = isSelected ? 1 : 0;
      optBtn.isPointerBlocker = true;
      col.addControl(optBtn);

      const oRow = new BABYLON.GUI.StackPanel('fpor_' + optName.substring(0, 12));
      oRow.isVertical = false; oRow.width = '94%'; oRow.height = '100%';
      optBtn.addControl(oRow);

      const oTxt = new BABYLON.GUI.TextBlock('', this._trunc(optName, 20));
      oTxt.color = isSelected ? '#e8eaed' : '#9aa0a6';
      oTxt.fontSize = 11; oTxt.fontFamily = FONT;
      oTxt.fontWeight = isSelected ? 'bold' : 'normal';
      oTxt.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
      oTxt.paddingLeft = '6px';
      oRow.addControl(oTxt);

      if (isSelected) {
        const check = new BABYLON.GUI.TextBlock('', '✓');
        check.color = COL.accent; check.fontSize = 12; check.fontFamily = FONT;
        check.width = '20px';
        oRow.addControl(check);
      }

      optBtn.onPointerEnterObservable.add(() => {
        optBtn.background = 'rgba(255,255,255,0.25)'; oTxt.color = '#ffffff';
        if (window.triggerHaptic) window.triggerHaptic(0.2, 5);
      });
      optBtn.onPointerOutObservable.add(() => {
        optBtn.background = isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.03)';
        oTxt.color = isSelected ? '#ffffff' : '#9aa0a6';
      });
      optBtn.onPointerClickObservable.add(() => {
        beep(800);
        if (window.triggerHaptic) window.triggerHaptic(0.7, 15);
        // Toggle: click same option to clear, else set
        if (isSelected) {
          this._setFilter(activeTab.key, '');
        } else {
          this._setFilter(activeTab.key, optName);
        }
      });

      this._spacer(col, 2);
    }

    /* ── Pagination controls at bottom ── */
    if (totalFpPages > 1) {
      this._spacer(col, 4);
      this._hline(col);
      this._spacer(col, 4);

      const pgRow = new BABYLON.GUI.StackPanel('fpPgRow');
      pgRow.isVertical = false; pgRow.height = '24px'; pgRow.width = '100%';
      col.addControl(pgRow);

      // Pagination: 252px usable → ◀ 64px | page N/M 124px | ▶ 64px
      const PG_SIDE = 64, PG_MID = texW * 0.90 - PG_SIDE * 2; // ~124px

      // Prev
      const prevBtn = new BABYLON.GUI.Rectangle('fpPrev');
      prevBtn.widthInPixels = PG_SIDE; prevBtn.height = '22px'; prevBtn.cornerRadius = 5;
      prevBtn.background = fpPage > 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
      prevBtn.color = 'transparent'; prevBtn.thickness = 0;
      prevBtn.isPointerBlocker = fpPage > 0;
      pgRow.addControl(prevBtn);
      const prevT = new BABYLON.GUI.TextBlock('', '◀');
      prevT.color = fpPage > 0 ? COL.textDim : 'rgba(255,255,255,0.1)';
      prevT.fontSize = 13; prevT.fontFamily = FONT;
      prevBtn.addControl(prevT);
      if (fpPage > 0) {
        prevBtn.onPointerEnterObservable.add(() => { prevBtn.background = 'rgba(255,255,255,0.15)'; prevT.color = '#ffffff'; if (window.triggerHaptic) window.triggerHaptic(0.2, 5); });
        prevBtn.onPointerOutObservable.add(() => { prevBtn.background = 'rgba(255,255,255,0.06)'; prevT.color = COL.textDim; });
        prevBtn.onPointerClickObservable.add(() => {
          beep(600); if (window.triggerHaptic) window.triggerHaptic(0.7, 15); this._filterPickerPage = fpPage - 1; this._rebuildFilterPanel();
        });
      }

      // Page info
      const pgInfo = new BABYLON.GUI.TextBlock('fpPgInfo',
        (fpPage + 1) + ' / ' + totalFpPages);
      pgInfo.color = COL.textDim; pgInfo.fontSize = 11; pgInfo.fontFamily = FONT;
      pgInfo.widthInPixels = PG_MID;
      pgRow.addControl(pgInfo);

      // Next
      const nextBtn = new BABYLON.GUI.Rectangle('fpNext');
      nextBtn.widthInPixels = PG_SIDE; nextBtn.height = '22px'; nextBtn.cornerRadius = 5;
      nextBtn.background = fpPage < totalFpPages - 1 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
      nextBtn.color = 'transparent'; nextBtn.thickness = 0;
      nextBtn.isPointerBlocker = fpPage < totalFpPages - 1;
      pgRow.addControl(nextBtn);
      const nextT = new BABYLON.GUI.TextBlock('', '▶');
      nextT.color = fpPage < totalFpPages - 1 ? COL.textDim : 'rgba(255,255,255,0.1)';
      nextT.fontSize = 13; nextT.fontFamily = FONT;
      nextBtn.addControl(nextT);
      if (fpPage < totalFpPages - 1) {
        nextBtn.onPointerEnterObservable.add(() => { nextBtn.background = 'rgba(255,255,255,0.15)'; nextT.color = '#ffffff'; if (window.triggerHaptic) window.triggerHaptic(0.2, 5); });
        nextBtn.onPointerOutObservable.add(() => { nextBtn.background = 'rgba(255,255,255,0.06)'; nextT.color = COL.textDim; });
        nextBtn.onPointerClickObservable.add(() => {
          beep(600); if (window.triggerHaptic) window.triggerHaptic(0.7, 15); this._filterPickerPage = fpPage + 1; this._rebuildFilterPanel();
        });
      }
    }

    this._filterMeshes.push(panelPlane);
  }

  /* ================================================================
     Thumbnail lazy loader
     ================================================================ */

  _checkLazy() {
    if (!this._visible) return;
    const cam = this._scene.activeCamera?.position;
    if (!cam) return;
    for (const m of this._cardMeshes) {
      if (!m.metadata || m.metadata.loaded) continue;
      if (BABYLON.Vector3.Distance(m.position, cam) < LAZY_DIST) {
        m.metadata.loaded = true;
        this._loadThumb(m.metadata.thumbSrc, m.metadata.img);
      }
    }
  }

  _loadThumb(src, imgCtrl) {
    if (!src) return;
    if (this._thumbCache.has(src)) {
      imgCtrl.source = src; imgCtrl.alpha = 1; return;
    }
    // Already in-flight: chain onto the existing promise so this imgCtrl
    // also gets updated when the image resolves (fixes thumbnail blank on
    // re-renders / pagination when the same src is still loading).
    if (this._loadQueue.has(src)) {
      this._loadQueue.get(src).then(() => {
        if (this._thumbCache.has(src)) { imgCtrl.source = src; imgCtrl.alpha = 1; }
      });
      return;
    }

    const p = new Promise((ok) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => {
        this._thumbCache.add(src);
        this._loadQueue.delete(src);
        imgCtrl.source = src;
        BABYLON.Animation.CreateAndStartAnimation(
          'fi_' + Math.random(), imgCtrl, 'alpha', 30, 15, 0, 1,
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
        ok();
      };
      i.onerror = () => { this._loadQueue.delete(src); ok(); };
      i.src = src;
    });
    this._loadQueue.set(src, p);
  }

  /* ================================================================
     Navigation
     ================================================================ */

  _buildNav(oy, totalH) {
    const navY = GRID_Y - totalH / 2 - 0.32;

    const ip = BABYLON.MeshBuilder.CreatePlane('navInfo',
      { width: 2.2, height: 0.25 }, this._scene);
    ip.position.set(GRID_X_OFF, navY, GRID_Z);
    const it = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(ip, 600, 70);
    it.useInvalidateRectOptimization = true;
    it.hasAlpha = true;
    const ib = new BABYLON.GUI.Rectangle('ib');
    ib.width = '100%'; ib.height = '100%'; ib.cornerRadius = 12;
    ib.color = COL.filterBord; ib.background = COL.filterBg;
    ib.thickness = 1;
    it.addControl(ib);
    const itx = new BABYLON.GUI.TextBlock('itx',
      'Page ' + this._page + ' / ' + this._totalPages +
      '  ·  ' + this._filtered.length + ' scenes');
    itx.color = COL.textDim; itx.fontSize = 24; itx.fontFamily = FONT;
    ib.addControl(itx);
    this._navMeshes.push(ip);

    if (this._page > 1)
      this._navMeshes.push(
        this._arrow('◀ Prev', GRID_X_OFF - 2.4, navY,
          () => { this._page--; this._render(); }));
    if (this._page < this._totalPages)
      this._navMeshes.push(
        this._arrow('Next ▶', GRID_X_OFF + 2.4, navY,
          () => { this._page++; this._render(); }));
  }

  _arrow(label, x, y, onClick) {
    const p = BABYLON.MeshBuilder.CreatePlane('nav_' + label,
      { width: 1.0, height: 0.28 }, this._scene);
    p.position.set(x, y, GRID_Z); p.isPickable = true;
    const t = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(p, 300, 80);
    t.useInvalidateRectOptimization = true;
    t.hasAlpha = true;
    const b = new BABYLON.GUI.Rectangle('nb_' + label);
    b.width = '100%'; b.height = '100%'; b.cornerRadius = 12;
    b.color = 'rgba(255,255,255,0.2)';
    b.background = 'rgba(30,30,30,0.85)'; b.thickness = 1;
    t.addControl(b);
    const tx = new BABYLON.GUI.TextBlock('nt_' + label, label);
    tx.color = '#9aa0a6'; tx.fontSize = 24; tx.fontFamily = FONT;
    b.addControl(tx);
    b.onPointerEnterObservable.add(() => {
      b.background = 'rgba(42,42,42,0.95)'; tx.color = '#e8eaed'; beep(600);
      if (window.triggerHaptic) window.triggerHaptic(0.2, 5);
    });
    b.onPointerOutObservable.add(() => {
      b.background = 'rgba(30,30,30,0.85)'; tx.color = '#9aa0a6';
    });
    b.onPointerClickObservable.add(() => {
      beep(800);
      if (window.triggerHaptic) window.triggerHaptic(0.7, 15);
      onClick();
    });
    return p;
  }

  /* ================================================================
     Disposal
     ================================================================ */

  _disposeAll() {
    this._disposePreviews();
    for (const m of this._cardMeshes) m.dispose();
    for (const m of this._navMeshes) m.dispose();
    for (const m of this._filterMeshes) m.dispose();
    this._cardMeshes = [];
    this._navMeshes = [];
    this._filterMeshes = [];
  }

  /* ================================================================
     Helpers
     ================================================================ */

  _thumbSrc(media) {
    if (media.thumbnailPath) return thumbUrl(media.thumbnailPath);
    if (media.remoteThumbnail) return media.remoteThumbnail;
    return null;
  }

  _trunc(s, n) {
    return !s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  _spacer(parent, h) {
    const s = new BABYLON.GUI.Rectangle('sp_' + Math.random());
    s.height = h + 'px'; s.width = '1px';
    s.color = 'transparent'; s.thickness = 0;
    parent.addControl(s);
  }

  _hline(parent) {
    const sep = new BABYLON.GUI.Rectangle('hl_' + Math.random());
    sep.width = '100%'; sep.height = '1px';
    sep.background = 'rgba(255,255,255,0.08)';
    sep.color = 'transparent'; sep.thickness = 0;
    parent.addControl(sep);
  }

  _fmtDuration(d) {
    if (!d && d !== 0) return '';
    if (typeof d === 'string' && d.includes(':')) return d;
    const sec = parseFloat(d);
    if (isNaN(sec) || sec === 0) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0
      ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
      : m + ':' + String(s).padStart(2, '0');
  }

  _scaleTo(mesh, s, ms, onEnd) {
    const from = mesh.scaling.clone();
    const to = new BABYLON.Vector3(s, s, s);
    BABYLON.Animation.CreateAndStartAnimation(
      'sc_' + Math.random(), mesh, 'scaling',
      60, Math.max(1, ms / 16.67), from, to,
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, null, onEnd);
  }
}
