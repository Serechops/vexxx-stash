/**
 * library3d.js – VR scene-wall media browser (Babylon.js GUI3D).
 *
 * Layout:
 *   • Filter panel (left side)  – studio, performer, tag selectors (2D GUI on 3D Plane)
 *   • CylinderPanel             – Curved wall of media cards
 *   • Nav bar (below grid)      – prev / page info / next (2D GUI on 3D Plane)
 */

import { apiUrl, thumbUrl } from './session.js';

const dbg = msg => {
    try { fetch('/vr/debug', { method: 'POST', body: typeof msg === 'string' ? msg : JSON.stringify(msg) }); } catch (_) { }
};

/* -- Grid constants ------------------------------------------------- */
const COLS = 4;
const ROWS = 3;
const PER_PAGE = COLS * ROWS;          // 12
const CARD_W = 1.40;
const CARD_H = 1.25;
const GRID_Z = 5.8; // Optimized distance for 4 columns
const GRID_Y = 1.4;                 // centre-height of grid (eye-level for standing user)
const GRID_X_OFF = 0.55;            // nudge grid right for side panel
const TEX_W = 600;
const TEX_H = 440;
const LAZY_DIST = 14;
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';

/* -- Filter-panel geometry ------------------------------------------ */
const FP_W = 1.10;                 // world width
const FP_GAP = 0.24;               // gap to grid edge

/* -- Colours (Deep navy-black palette) ------------------------------ */
const COL = {
    cardBg: 'rgba(5, 5, 14, 0.98)',
    cardBorder: 'rgba(255, 255, 255, 0.06)',
    hoverBorder: 'rgba(79, 142, 255, 0.55)',
    hoverBg: 'rgba(10, 18, 40, 0.99)',
    title: '#ffffff',
    studio: 'rgba(179, 186, 210, 0.80)',
    perf: 'rgba(154, 160, 180, 0.78)',
    dur: '#cccccc',
    durBg: 'rgba(0, 0, 0, 0.88)',
    owned: 'rgba(129, 201, 149, 0.85)',
    remote: 'rgba(253, 214, 99, 0.85)',
    scriptOn: 'rgba(129, 201, 149, 0.90)',
    scriptOff: 'rgba(95, 99, 104, 0.40)',
    filterBg: 'rgba(4, 4, 11, 0.98)',
    filterBord: 'rgba(255, 255, 255, 0.07)',
    accent: '#8ab4f8',
    accentBg: 'rgba(79, 142, 255, 0.18)',
    accentBord: 'rgba(79, 142, 255, 0.40)',
    textDim: 'rgba(255, 255, 255, 0.32)',
    tagBg: 'rgba(255, 255, 255, 0.05)',
    tagBord: 'rgba(255, 255, 255, 0.12)',
    tagText: 'rgba(200, 205, 220, 0.80)',
    typeBg: 'rgba(79, 142, 255, 0.08)',
    typeBord: 'rgba(79, 142, 255, 0.22)',
    typeText: '#8ab4f8',
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
   LibraryBrowser3D
   =================================================================== */
export class LibraryBrowser3D {
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

        // GUI3D Manager
        this._manager = new BABYLON.GUI.GUI3DManager(this._scene);

        // CylinderPanel for the cards
        this._panel = new BABYLON.GUI.CylinderPanel();
        this._panel.margin = 0.25; // Provide a distinct gap between cards
        this._panel.radius = GRID_Z;
        this._panel.columns = COLS;
        this._manager.addControl(this._panel);
        this._panel.position = new BABYLON.Vector3(GRID_X_OFF, GRID_Y, 0);

        // Track objects to dispose
        this._cardControls = [];
        this._navMeshes = [];
        this._filterMeshes = [];

        // Per-card preview video overlays
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

        dbg('[lib3d] init  cols=' + COLS + ' rows=' + ROWS + ' perPage=' + PER_PAGE);
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
            dbg('[lib3d] page ' + this._page + '/' + this._totalPages +
                '  (' + this._filtered.length + '/' + this._items.length + ')');
        } catch (e) {
            dbg('[lib3d] load error: ' + e.message);
        } finally {
            this._isLoading = false;
        }
    }

    async loadRaw() {
        this._items = await this._fetch();
        return this._items;
    }

    async refresh() { await this.load(this._page); }

    setVisible(v) {
        this._visible = v;

        // 1. Toggle the 3D GUI Manager's Utility Layer rendering and events
        if (this._manager && this._manager.utilityLayer) {
            this._manager.utilityLayer.shouldRender = v;
            this._manager.utilityLayer.processPointerEvents = v;
        }

        // 2. Toggle the main container panel
        if (this._panel) {
            this._panel.isVisible = v;
            this._panel.isPickable = v;
        }

        // 3. Toggle auxiliary meshes (NavBar and FilterPanel)
        for (const m of this._navMeshes) {
            if (m) {
                m.isVisible = v;
                m.isPickable = v;
            }
        }
        for (const m of this._filterMeshes) {
            if (m) {
                m.isVisible = v;
                m.isPickable = v;
            }
        }

        // 4. Toggle all MeshButton3D instances to prevent raycast interception
        for (const btn of this._cardControls) {
            if (btn) {
                btn.isVisible = v;
                // MeshButton3D wrappers usually hold standard Babylon meshes in btn.mesh
                if (btn.mesh) {
                    btn.mesh.isPickable = v;
                    btn.mesh.isVisible = v;
                }
            }
        }

        // 5. Toggle per-card preview planes
        for (const pv of this._previews.values()) {
            if (pv.plane) {
                pv.plane.isVisible = v;
                pv.plane.isPickable = v;
            }
            // Also pause/play preview videos to save resources
            if (!v && pv.video) {
                pv.video.pause();
            } else if (v && pv.video && pv.video.paused) {
                pv.video.play().catch(() => { });
            }
        }
    }

    dispose() {
        window.removeEventListener('online', this._onOnline);
        this._scene.unregisterBeforeRender(this._visCb);
        this._disposeAll();
        if (this._panel) this._panel.dispose();
        if (this._manager) this._manager.dispose();
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
        } catch (e) { dbg('[lib3d] filter fetch: ' + e.message); }
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
        this._disposeAll(); // Clear previous GUI elements, meshes, previews

        const slice = this._filtered.slice(
            (this._page - 1) * PER_PAGE,
            (this._page - 1) * PER_PAGE + PER_PAGE);

        // Using CylinderPanel for cards
        for (let i = 0; i < slice.length; i++) {
            const cardControl = this._buildCard(slice[i], i);
            this._panel.addControl(cardControl);
            this._cardControls.push(cardControl);
        }

        // Auto-activate previews
        setTimeout(() => {
            if (this._visible) {
                for (const media of slice) {
                    if (media.previewPath) {
                        const btn = this._cardControls.find(c => c.metadata?.media?.id === media.id);
                        if (btn && btn.node) this._activatePreview(media, btn);
                    }
                }
            }
        }, 500);

        const totalW = COLS * CARD_W + (COLS - 1) * 0.16;
        const totalH = ROWS * CARD_H + (ROWS - 1) * 0.14;

        // Filter panel on the left (kept as flat plane)
        const gridLeftX = GRID_X_OFF - totalW / 2;
        this._buildFilterPanel(gridLeftX, totalH);

        // Navigation below the grid
        this._buildNav();

        // Ensure state applies
        this.setVisible(this._visible);
    }

    _rebuildFilterPanel() {
        for (const m of this._filterMeshes) m.dispose();
        this._filterMeshes = [];
        const totalW = COLS * CARD_W + (COLS - 1) * 0.16;
        const totalH = ROWS * CARD_H + (ROWS - 1) * 0.14;
        const gridLeftX = GRID_X_OFF - totalW / 2;
        this._buildFilterPanel(gridLeftX, totalH);
    }

    /* ================================================================
       Card builder (GUI3D HolographicButton)
       ================================================================ */

    _buildCard(media, idx) {
        const uiScene = this._manager.utilityLayer ? this._manager.utilityLayer.utilityLayerScene : this._scene;

        // Use a clean 1x1 plane so the button scaling directly equates to world dimensions.
        const mesh = BABYLON.MeshBuilder.CreatePlane('card_mesh_' + media.id, { width: 1, height: 1 }, uiScene);
        mesh.rotation.x = 0;

        // MeshButton3D uses our own plane without any default 3D styling/bezel
        const button = new BABYLON.GUI.MeshButton3D(mesh, 'btn_' + media.id);
        button.scaling = new BABYLON.Vector3(CARD_W, CARD_H, 1);

        // Apply our 2D AdvancedDynamicTexture directly to the custom plane mesh
        const adt = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(mesh, TEX_W, TEX_H);

        const card = new BABYLON.GUI.Rectangle('card_' + media.id);
        card.width = '600px';
        card.height = '440px';
        card.cornerRadius = 16;
        card.color = COL.cardBorder;
        card.background = COL.cardBg;
        card.thickness = 1;
        card.clipChildren = true;

        // We can't attach dropshadows directly to HolographicButton content easily, so we skip it.

        /* -- Thumbnail area (top 76%) -- */
        const thumbArea = new BABYLON.GUI.Rectangle('ta_' + media.id);
        thumbArea.width = '100%'; thumbArea.height = '76%';
        thumbArea.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        thumbArea.color = 'transparent'; thumbArea.thickness = 0;
        thumbArea.background = 'rgba(18,18,18,0.6)';
        thumbArea.clipChildren = true;
        card.addControl(thumbArea);

        // Static thumbnail
        const img = new BABYLON.GUI.Image('img_' + media.id, '');
        img.width = '100%'; img.height = '100%';
        img.stretch = BABYLON.GUI.Image.STRETCH_UNIFORM;
        img.alpha = 0;
        thumbArea.addControl(img);

        /* -- Duration pill -- */
        if (media.duration) {
            const durPill = new BABYLON.GUI.Rectangle('dp_' + media.id);
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
            const dpTxt = new BABYLON.GUI.TextBlock('dpt_' + media.id,
                this._fmtDuration(media.duration));
            dpTxt.color = '#fff'; dpTxt.fontSize = 10; dpTxt.fontWeight = 'bold';
            dpTxt.fontFamily = FONT; dpTxt.resizeToFit = true;
            dpTxt.paddingLeftInPixels = 4; dpTxt.paddingRightInPixels = 4;
            durPill.addControl(dpTxt);
        }

        /* -- Info area (bottom 28%) -- */
        const infoArea = new BABYLON.GUI.Rectangle('info_' + media.id);
        infoArea.width = '100%'; infoArea.height = '28%';
        infoArea.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        infoArea.color = 'transparent'; infoArea.thickness = 0;
        infoArea.background = COL.cardBg;
        card.addControl(infoArea);

        /* gradient bleed into thumbnail */
        const gradBleed = new BABYLON.GUI.Rectangle('grad_' + media.id);
        gradBleed.width = '100%'; gradBleed.height = '24px';
        gradBleed.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        gradBleed.color = 'transparent'; gradBleed.thickness = 0;
        gradBleed.background = 'rgba(30,30,30,0.45)';
        gradBleed.top = '-12px';
        infoArea.addControl(gradBleed);

        const infoCol = new BABYLON.GUI.StackPanel('ic_' + media.id);
        infoCol.isVertical = true;
        infoCol.width = '92%';
        infoCol.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        infoCol.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        infoCol.top = '6px';
        infoArea.addControl(infoCol);

        /* Row 1: Studio label */
        const studioTxt = new BABYLON.GUI.TextBlock('st_' + media.id,
            (media.studio || 'Unknown').toUpperCase());
        studioTxt.color = COL.studio; studioTxt.fontSize = 10;
        studioTxt.fontWeight = 'bold'; studioTxt.fontFamily = FONT;
        studioTxt.height = '16px';
        studioTxt.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        infoCol.addControl(studioTxt);
        this._spacer(infoCol, 2);

        /* Row 2: Title */
        const titleTxt = new BABYLON.GUI.TextBlock('title_' + media.id,
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
            const perfTxt = new BABYLON.GUI.TextBlock('pf_' + media.id, perfStr);
            perfTxt.color = COL.perf; perfTxt.fontSize = 10;
            perfTxt.fontFamily = FONT; perfTxt.height = '16px';
            perfTxt.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
            infoCol.addControl(perfTxt);
        }

        /* Row 4: Tag chips */
        const tags = (media.tags || []).slice(0, 4);
        if (tags.length > 0) {
            this._spacer(infoCol, 2);
            const tagRow = new BABYLON.GUI.StackPanel('tr_' + media.id);
            tagRow.isVertical = false; tagRow.height = '18px'; tagRow.width = '100%';
            infoCol.addControl(tagRow);
            for (const tag of tags) {
                const tagName = typeof tag === 'string' ? tag : (tag.name || String(tag));
                const chip = new BABYLON.GUI.Rectangle('tc_' + tagName.substring(0, 8));
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
                const moreT = new BABYLON.GUI.TextBlock('tm_' + media.id, '+' + (media.tags.length - 4));
                moreT.color = COL.textDim; moreT.fontSize = 8;
                moreT.fontFamily = FONT; moreT.width = '24px';
                tagRow.addControl(moreT);
            }
        }

        this._spacer(infoCol, 2);

        /* Row 5: Badge row */
        const badgeRow = new BABYLON.GUI.StackPanel('br_' + media.id);
        badgeRow.isVertical = false; badgeRow.height = '18px'; badgeRow.width = '100%';
        infoCol.addControl(badgeRow);

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

        const typeChip = new BABYLON.GUI.Rectangle('tyc_' + media.id);
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

        const hasScript = !!media.scriptPath;
        const scChip = new BABYLON.GUI.Rectangle('sc_' + media.id);
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

        // Apply the full card GUI logic to the ADT
        adt.addControl(card);

        button.onPointerEnterObservable.add(() => {
            card.color = COL.hoverBorder;
            card.background = COL.hoverBg;
            card.shadowColor = 'rgba(79, 142, 255, 0.28)';
            card.shadowBlur = 18;
            if (window.triggerHaptic) window.triggerHaptic(0.2, 10);
            beep(600);
        });
        button.onPointerOutObservable.add(() => {
            card.color = COL.cardBorder;
            card.background = COL.cardBg;
            card.shadowBlur = 0;
        });
        button.onPointerClickObservable.add(() => {
            beep(800);
            if (window.triggerHaptic) window.triggerHaptic(0.7, 20);
            dbg('[lib3d] select: ' + media.title);
            this._onSelect(media);
        });

        button.metadata = { img, thumbSrc: this._thumbSrc(media), loaded: false, media };

        const src = this._thumbSrc(media);
        if (src) {
            this._loadThumb(src, img);
            button.metadata.loaded = true;
        }

        return button;
    }

    /* ================================================================
       Per-card preview video
       ================================================================ */

    _activatePreview(media, buttonCtrl) {
        if (this._previews.has(media.id)) return;
        if (!this._visible || !media.previewPath) return;

        if (!buttonCtrl.mesh) {
            // MeshButton3D mesh node may not exist instantly
            setTimeout(() => this._activatePreview(media, buttonCtrl), 100);
            return;
        }

        const scene = this._scene;
        // HolographicButton renders its content into a UtilityLayer. The preview mesh must exist there.
        const uiScene = this._manager.utilityLayer ? this._manager.utilityLayer.utilityLayerScene : scene;

        const src = apiUrl(media.previewPath);

        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true; video.loop = true; video.playsInline = true;
        video.preload = 'metadata'; video.style.display = 'none';
        document.body.appendChild(video);
        video.src = src;

        const isVR = this._isVRContent(media);

        // For MeshButton3D, the local scale is 1x1.
        // We want the preview to perfectly overlay the top 76% (the thumbnail region).
        const pw = 1.0;
        const ph = 0.76;
        const prevPlane = BABYLON.MeshBuilder.CreatePlane(
            'pv_' + media.id, { width: pw, height: ph }, uiScene);
        prevPlane.isPickable = false;

        prevPlane.parent = buttonCtrl.mesh;

        // Local transform offset within the 1x1 plane coordinate space.
        // Y=0 is center. Top edge is +0.5. Top 76% goes from +0.5 to -0.26 => Center is +0.12.
        // Z local pushes it out in front of the 2D UI plane.
        prevPlane.position = new BABYLON.Vector3(0, 0.12, -0.01);
        prevPlane.isVisible = false;

        // Pin above other GUI elements
        prevPlane.renderingGroupId = 1;

        // If we are using uiScene, the material and texture also must be bound to uiScene!
        const mat = new BABYLON.StandardMaterial('pvMat_' + media.id, uiScene);
        mat.emissiveColor = BABYLON.Color3.White();
        mat.disableLighting = true; mat.backFaceCulling = false;
        prevPlane.material = mat;

        const entry = { video, tex: null, plane: prevPlane, mat, mediaId: media.id, isVR };
        this._previews.set(media.id, entry);

        const onCanPlay = () => {
            video.removeEventListener('canplay', onCanPlay);
            if (!this._previews.has(media.id)) { video.pause(); return; }
            try {
                const tex = new BABYLON.VideoTexture('pvTex_' + media.id, video, uiScene, false, false);
                if (isVR) {
                    tex.uScale = 0.30;
                    tex.uOffset = 0.10;
                    tex.vScale = 0.60;
                    tex.vOffset = 0.20;
                }
                entry.tex = tex;
                mat.diffuseTexture = tex;
                mat.emissiveTexture = tex;
                prevPlane.isVisible = this._visible;
                video.play().catch(() => { });
            } catch (e) { dbg('[preview3d] tex error: ' + e.message); }
        };
        video.addEventListener('canplay', onCanPlay);
        video.load();
    }

    _isVRContent(media) {
        const haystack = [
            (media.title || ''), (media.filename || ''), (media.studio || ''), ...(media.tags || []),
        ].join(' ').toLowerCase();

        if (haystack.includes('2d') || haystack.includes('flat') || haystack.includes('pov 2d')) return false;
        if (haystack.includes('180') || haystack.includes('360') ||
            haystack.includes('vr') || haystack.includes('sbs') ||
            haystack.includes('side by side') || haystack.includes('tb') ||
            haystack.includes('top-bottom') || haystack.includes('over-under')) return true;
        return true;
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
       ================================================================ */

    _buildFilterPanel(gridLeftX, totalH) {
        const panelH = totalH + 0.6;
        const panelX = gridLeftX - FP_GAP - FP_W / 2 + 0.3; // tweak pos to fit cylinder
        const panelY = GRID_Y;

        // Filter panel remains a flat plane beside the CylinderPanel
        const panelPlane = BABYLON.MeshBuilder.CreatePlane('fpanel',
            { width: FP_W, height: panelH }, this._scene);
        panelPlane.position.set(panelX, panelY, GRID_Z - 1.5); // Bring it a bit forward naturally
        panelPlane.isPickable = true;
        panelPlane.isVisible = this._visible; // Immediate check
        panelPlane.lookAt(new BABYLON.Vector3(0, panelY, 0), Math.PI);

        const texW = 280, texH = 700;
        const pTex = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(panelPlane, texW, texH);
        pTex.useInvalidateRectOptimization = true;
        pTex.hasAlpha = true;

        const bg = new BABYLON.GUI.Rectangle('fpBg');
        bg.width = '100%'; bg.height = '100%';
        bg.cornerRadius = 16;
        bg.color = COL.accentBord;
        bg.background = COL.filterBg;
        bg.thickness = 1;
        bg.shadowColor = 'rgba(79, 142, 255, 0.12)';
        bg.shadowBlur = 12;
        bg.clipChildren = true;
        bg.isPointerBlocker = true;
        pTex.addControl(bg);

        const col = new BABYLON.GUI.StackPanel('fpCol');
        col.isVertical = true; col.width = '90%'; col.height = '96%';
        col.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        col.top = '10px';
        bg.addControl(col);

        const hdrRow = new BABYLON.GUI.StackPanel('fpHdr');
        hdrRow.isVertical = false; hdrRow.height = '22px'; hdrRow.width = '100%';
        col.addControl(hdrRow);

        const title = new BABYLON.GUI.TextBlock('fpTitle', 'FILTERS');
        title.color = COL.accent; title.fontSize = 13;
        title.fontWeight = 'bold'; title.fontFamily = FONT;
        title.letterSpacing = 3;
        title.widthInPixels = 140;
        title.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        hdrRow.addControl(title);

        const countTxt = new BABYLON.GUI.TextBlock('fpCount', this._filtered.length + ' scenes');
        countTxt.color = COL.accent; countTxt.fontSize = 10;
        countTxt.fontFamily = FONT; countTxt.widthInPixels = 110;
        countTxt.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        hdrRow.addControl(countTxt);

        this._spacer(col, 6);

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
                    beep(700); if (window.triggerHaptic) window.triggerHaptic(0.5, 10);
                    this._setFilter(p.key, '');
                });
            }

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
            clrT.resizeToFit = true; clrT.paddingLeftInPixels = 4; clrT.paddingRightInPixels = 4;
            clrChip.addControl(clrT);
            clrChip.onPointerClickObservable.add(() => {
                beep(800); if (window.triggerHaptic) window.triggerHaptic(0.7, 15);
                this._filterStudio = ''; this._filterPerformer = ''; this._filterTag = '';
                this._filterSearch = '';
                this._applyFilters(); this._page = 1; this._render();
            });
            this._spacer(col, 4);
        }

        this._hline(col); this._spacer(col, 4);

        const TABS = [
            { key: 'Studio', label: 'Studio', opts: Array.isArray(this._studios) ? this._studios : [] },
            { key: 'Performer', label: 'Perf.', opts: Array.isArray(this._performers) ? this._performers : [] },
            { key: 'Tag', label: 'Tag', opts: (Array.isArray(this._tags) ? this._tags : []).map(t => typeof t === 'string' ? t : (t.name || String(t))) },
        ];

        if (!this._activeTab) this._activeTab = 'Studio';
        const TAB_W = Math.floor((texW * 0.90 - 4) / TABS.length);

        const tabRow = new BABYLON.GUI.StackPanel('fpTabs');
        tabRow.isVertical = false; tabRow.height = '28px'; tabRow.width = '100%';
        col.addControl(tabRow);

        for (const tab of TABS) {
            const isActive = this._activeTab === tab.key;
            const tBtn = new BABYLON.GUI.Rectangle('fpt_' + tab.key);
            tBtn.widthInPixels = TAB_W; tBtn.height = '26px';
            tBtn.paddingRightInPixels = 2; tBtn.cornerRadius = 6;
            tBtn.background = isActive ? COL.accentBg : 'rgba(255,255,255,0.04)';
            tBtn.color = isActive ? COL.accentBord : 'transparent';
            tBtn.thickness = isActive ? 1 : 0; tBtn.isPointerBlocker = true;
            tabRow.addControl(tBtn);

            const tTxt = new BABYLON.GUI.TextBlock('', tab.label);
            tTxt.color = isActive ? COL.accent : COL.textDim;
            tTxt.fontSize = 11; tTxt.fontWeight = isActive ? 'bold' : 'normal';
            tTxt.fontFamily = FONT; tBtn.addControl(tTxt);

            tBtn.onPointerEnterObservable.add(() => {
                tBtn.background = COL.accentBg; tTxt.color = COL.accent;
                if (window.triggerHaptic) window.triggerHaptic(0.2, 5);
            });
            tBtn.onPointerOutObservable.add(() => {
                tBtn.background = isActive ? COL.accentBg : 'rgba(255,255,255,0.04)';
                tTxt.color = isActive ? COL.accent : COL.textDim;
            });
            tBtn.onPointerClickObservable.add(() => {
                beep(600); if (window.triggerHaptic) window.triggerHaptic(0.5, 10);
                this._activeTab = tab.key; this._filterPickerPage = 0; this._rebuildFilterPanel();
            });
        }

        this._spacer(col, 4); this._hline(col); this._spacer(col, 4);

        const activeTab = TABS.find(t => t.key === this._activeTab) || TABS[0];
        const allOpts = activeTab.opts.map(o => typeof o === 'string' ? o : (o.name || o.label || String(o))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const PAGE_SIZE = 18;
        const fpPage = this._filterPickerPage || 0;
        const totalFpPages = Math.max(1, Math.ceil(allOpts.length / PAGE_SIZE));
        const pageOpts = allOpts.slice(fpPage * PAGE_SIZE, (fpPage + 1) * PAGE_SIZE);
        const currentVal = this['_filter' + activeTab.key] || '';

        for (const optName of pageOpts) {
            const isSelected = optName === currentVal;
            const optBtn = new BABYLON.GUI.Rectangle('fpo_' + optName.substring(0, 16));
            optBtn.width = '100%'; optBtn.height = '26px'; optBtn.cornerRadius = 5;
            optBtn.background = isSelected ? COL.accentBg : 'rgba(255,255,255,0.03)';
            optBtn.color = isSelected ? COL.accentBord : 'transparent';
            optBtn.thickness = isSelected ? 1 : 0; optBtn.isPointerBlocker = true;
            col.addControl(optBtn);

            const oRow = new BABYLON.GUI.StackPanel('fpor_' + optName.substring(0, 12));
            oRow.isVertical = false; oRow.width = '94%'; oRow.height = '100%';
            optBtn.addControl(oRow);

            const oTxt = new BABYLON.GUI.TextBlock('', this._trunc(optName, 20));
            oTxt.color = isSelected ? COL.accent : COL.textDim;
            oTxt.fontSize = 11; oTxt.fontFamily = FONT;
            oTxt.fontWeight = isSelected ? 'bold' : 'normal';
            oTxt.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
            // resizeToFit avoids the default 100% width which would trigger a
            // BabylonJS layout warning every frame inside a horizontal StackPanel.
            oTxt.resizeToFit = true;
            oTxt.paddingLeft = '6px'; oRow.addControl(oTxt);

            if (isSelected) {
                const check = new BABYLON.GUI.TextBlock('', '✓');
                check.color = COL.accent; check.fontSize = 12; check.fontFamily = FONT;
                check.width = '20px'; oRow.addControl(check);
            }

            optBtn.onPointerEnterObservable.add(() => {
                optBtn.background = COL.accentBg; oTxt.color = COL.accent;
                if (window.triggerHaptic) window.triggerHaptic(0.2, 5);
            });
            optBtn.onPointerOutObservable.add(() => {
                optBtn.background = isSelected ? COL.accentBg : 'rgba(255,255,255,0.03)';
                oTxt.color = isSelected ? COL.accent : COL.textDim;
            });
            optBtn.onPointerClickObservable.add(() => {
                beep(800); if (window.triggerHaptic) window.triggerHaptic(0.7, 15);
                if (isSelected) this._setFilter(activeTab.key, '');
                else this._setFilter(activeTab.key, optName);
            });
            this._spacer(col, 2);
        }

        if (totalFpPages > 1) {
            this._spacer(col, 4); this._hline(col); this._spacer(col, 4);
            const pgRow = new BABYLON.GUI.StackPanel('fpPgRow');
            pgRow.isVertical = false; pgRow.height = '24px'; pgRow.width = '100%';
            col.addControl(pgRow);

            const PG_SIDE = 64, PG_MID = texW * 0.90 - PG_SIDE * 2;
            const prevBtn = new BABYLON.GUI.Rectangle('fpPrev');
            prevBtn.widthInPixels = PG_SIDE; prevBtn.height = '22px'; prevBtn.cornerRadius = 5;
            prevBtn.background = fpPage > 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
            prevBtn.color = 'transparent'; prevBtn.thickness = 0; prevBtn.isPointerBlocker = fpPage > 0;
            pgRow.addControl(prevBtn);
            const prevT = new BABYLON.GUI.TextBlock('', '◀');
            prevT.color = fpPage > 0 ? COL.textDim : 'rgba(255,255,255,0.1)';
            prevT.fontSize = 13; prevT.fontFamily = FONT; prevBtn.addControl(prevT);
            if (fpPage > 0) {
                prevBtn.onPointerEnterObservable.add(() => { prevBtn.background = 'rgba(255,255,255,0.15)'; prevT.color = '#ffffff'; if (window.triggerHaptic) window.triggerHaptic(0.2, 5); });
                prevBtn.onPointerOutObservable.add(() => { prevBtn.background = 'rgba(255,255,255,0.06)'; prevT.color = COL.textDim; });
                prevBtn.onPointerClickObservable.add(() => { beep(600); if (window.triggerHaptic) window.triggerHaptic(0.7, 15); this._filterPickerPage = fpPage - 1; this._rebuildFilterPanel(); });
            }

            const pgInfo = new BABYLON.GUI.TextBlock('fpPgInfo', (fpPage + 1) + ' / ' + totalFpPages);
            pgInfo.color = COL.textDim; pgInfo.fontSize = 11; pgInfo.fontFamily = FONT;
            pgInfo.widthInPixels = PG_MID; pgRow.addControl(pgInfo);

            const nextBtn = new BABYLON.GUI.Rectangle('fpNext');
            nextBtn.widthInPixels = PG_SIDE; nextBtn.height = '22px'; nextBtn.cornerRadius = 5;
            nextBtn.background = fpPage < totalFpPages - 1 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
            nextBtn.color = 'transparent'; nextBtn.thickness = 0; nextBtn.isPointerBlocker = fpPage < totalFpPages - 1;
            pgRow.addControl(nextBtn);
            const nextT = new BABYLON.GUI.TextBlock('', '▶');
            nextT.color = fpPage < totalFpPages - 1 ? COL.textDim : 'rgba(255,255,255,0.1)';
            nextT.fontSize = 13; nextT.fontFamily = FONT; nextBtn.addControl(nextT);
            if (fpPage < totalFpPages - 1) {
                nextBtn.onPointerEnterObservable.add(() => { nextBtn.background = 'rgba(255,255,255,0.15)'; nextT.color = '#ffffff'; if (window.triggerHaptic) window.triggerHaptic(0.2, 5); });
                nextBtn.onPointerOutObservable.add(() => { nextBtn.background = 'rgba(255,255,255,0.06)'; nextT.color = COL.textDim; });
                nextBtn.onPointerClickObservable.add(() => { beep(600); if (window.triggerHaptic) window.triggerHaptic(0.7, 15); this._filterPickerPage = fpPage + 1; this._rebuildFilterPanel(); });
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
        for (const ctrl of this._cardControls) {
            if (!ctrl.metadata || ctrl.metadata.loaded) continue;
            // Use controller node position
            if (ctrl.node && BABYLON.Vector3.Distance(ctrl.node.getAbsolutePosition(), cam) < LAZY_DIST) {
                ctrl.metadata.loaded = true;
                this._loadThumb(ctrl.metadata.thumbSrc, ctrl.metadata.img);
            }
        }
    }

    _loadThumb(src, imgCtrl) {
        if (!src) return;
        if (this._thumbCache.has(src)) { imgCtrl.source = src; imgCtrl.alpha = 1; return; }
        if (this._loadQueue.has(src)) {
            this._loadQueue.get(src).then(() => {
                if (this._thumbCache.has(src)) { imgCtrl.source = src; imgCtrl.alpha = 1; }
            });
            return;
        }
        const p = new Promise(ok => {
            const i = new Image(); i.crossOrigin = 'anonymous';
            i.onload = () => {
                this._thumbCache.add(src); this._loadQueue.delete(src);
                imgCtrl.source = src;
                try { // sometimes fails if GUI gets disposed
                    BABYLON.Animation.CreateAndStartAnimation(
                        'fi_' + Math.random(), imgCtrl, 'alpha', 30, 15, 0, 1, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
                } catch (_) { imgCtrl.alpha = 1; }
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

    _buildNav() {
        // Since we explicitly control CARD_H, we can calculate strictly: (ROWS * CARD_H) / 2
        const gridBottom = GRID_Y - ((ROWS * CARD_H) / 2);
        const navY = gridBottom - 0.35;

        const ip = BABYLON.MeshBuilder.CreatePlane('navInfo', { width: 2.6, height: 0.30 }, this._scene);
        ip.position.set(GRID_X_OFF, navY, GRID_Z - 1.2);
        ip.isVisible = this._visible; // Immediate check
        const it = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(ip, 700, 85);
        it.hasAlpha = true;
        const ib = new BABYLON.GUI.Rectangle('ib');
        ib.width = '100%'; ib.height = '100%'; ib.cornerRadius = 14;
        ib.color = COL.accentBord; ib.background = COL.filterBg; ib.thickness = 1;
        it.addControl(ib);

        const stack = new BABYLON.GUI.StackPanel('navStack');
        stack.isVertical = false;
        stack.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        ib.addControl(stack);

        const txt1 = new BABYLON.GUI.TextBlock('txt1', 'Page ');
        txt1.color = COL.accent; txt1.fontSize = 24; txt1.fontFamily = FONT;
        txt1.resizeToFit = true;
        txt1.paddingLeftInPixels = 10; txt1.paddingRightInPixels = 5;
        stack.addControl(txt1);

        const pageInput = new BABYLON.GUI.InputText('pageInput', String(this._page));
        pageInput.width = '60px'; pageInput.height = '46px';
        pageInput.color = '#ffffff'; pageInput.background = 'rgba(255,255,255,0.1)';
        pageInput.focusedBackground = 'rgba(255,255,255,0.2)';
        pageInput.thickness = 1; pageInput.cornerRadius = 6;
        pageInput.fontSize = 24; pageInput.fontFamily = FONT;
        pageInput.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;

        pageInput.onKeyboardEventProcessedObservable.add((e) => {
            if (e.key === 'Enter') {
                let val = parseInt(pageInput.text, 10);
                if (!isNaN(val)) {
                    val = Math.max(1, Math.min(val, this._totalPages));
                    if (this._page !== val) {
                        this._page = val;
                        this._render();
                        beep(600); if (window.triggerHaptic) window.triggerHaptic(0.5, 10);
                    }
                }
            }
        });
        pageInput.onBlurObservable.add(() => {
            // Apply if they click away
            let val = parseInt(pageInput.text, 10);
            if (!isNaN(val) && val !== this._page) {
                val = Math.max(1, Math.min(val, this._totalPages));
                this._page = val;
                this._render();
            } else {
                pageInput.text = String(this._page);
            }
        });
        stack.addControl(pageInput);

        const txt2 = new BABYLON.GUI.TextBlock('txt2', ' / ' + this._totalPages + '  ·  ' + this._filtered.length + ' scenes');
        txt2.color = COL.accent; txt2.fontSize = 24; txt2.fontFamily = FONT;
        txt2.resizeToFit = true;
        txt2.paddingLeftInPixels = 5; txt2.paddingRightInPixels = 10;
        stack.addControl(txt2);

        this._navMeshes.push(ip);

        // Adjust arrow position spread for larger UI
        if (this._page > 1) this._navMeshes.push(this._arrow('◀ Prev', GRID_X_OFF - 2.4, navY, () => { this._page--; this._render(); }));
        if (this._page < this._totalPages) this._navMeshes.push(this._arrow('Next ▶', GRID_X_OFF + 2.4, navY, () => { this._page++; this._render(); }));
    }

    _arrow(label, x, y, onClick) {
        const p = BABYLON.MeshBuilder.CreatePlane('nav_' + label, { width: 1.1, height: 0.30 }, this._scene);
        p.position.set(x, y, GRID_Z - 1.2); p.isPickable = true;
        p.isVisible = this._visible; // Immediate check
        const t = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(p, 300, 85);
        t.hasAlpha = true;
        const isNext = label.includes('Next');
        const b = new BABYLON.GUI.Rectangle('nb_' + label);
        b.width = '100%'; b.height = '100%'; b.cornerRadius = 14;
        b.color = isNext ? COL.accentBord : 'rgba(255,255,255,0.10)';
        b.background = isNext ? COL.accentBg : COL.filterBg;
        b.thickness = 1;
        t.addControl(b);
        const tx = new BABYLON.GUI.TextBlock('nt_' + label, label);
        tx.color = isNext ? COL.accent : COL.textDim;
        tx.fontSize = 24; tx.fontFamily = FONT; b.addControl(tx);
        b.onPointerEnterObservable.add(() => { b.background = isNext ? 'rgba(79,142,255,0.28)' : 'rgba(255,255,255,0.08)'; tx.color = isNext ? '#ffffff' : '#e8eaed'; beep(600); if (window.triggerHaptic) window.triggerHaptic(0.2, 5); });
        b.onPointerOutObservable.add(() => { b.background = isNext ? COL.accentBg : COL.filterBg; tx.color = isNext ? COL.accent : COL.textDim; });
        b.onPointerClickObservable.add(() => { beep(800); if (window.triggerHaptic) window.triggerHaptic(0.7, 15); onClick(); });
        return p;
    }

    /* ================================================================
       Disposal
       ================================================================ */

    _disposeAll() {
        this._disposePreviews();
        // Use clearControls to wipe cylinder panel children
        if (this._panel && this._panel.children) {
            // clearControls is available in some babylon GUI3D versions. We can also just remove them manually.
            while (this._panel.children.length > 0) {
                const child = this._panel.children[0];
                this._panel.removeControl(child);
                child.dispose();
            }
        }
        this._cardControls = [];

        for (const m of this._navMeshes) m.dispose();
        for (const m of this._filterMeshes) m.dispose();
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

    _trunc(s, n) { return !s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s; }

    _spacer(parent, h) {
        const s = new BABYLON.GUI.Rectangle('sp_' + Math.random());
        s.height = h + 'px'; s.width = '1px'; s.color = 'transparent'; s.thickness = 0;
        parent.addControl(s);
    }

    _hline(parent) {
        const sep = new BABYLON.GUI.Rectangle('hl_' + Math.random());
        sep.width = '100%'; sep.height = '1px'; sep.background = 'rgba(255,255,255,0.08)';
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
        return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
            : m + ':' + String(s).padStart(2, '0');
    }

    /* ================================================================
       Voice Search
       ================================================================ */

    startVoiceSearch() {
        if (!this._visible) return;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            dbg("[lib3d] SpeechRecognition not supported");
            return;
        }

        if (this._recognitionActive) {
            return;
        }

        this._recognitionActive = true;
        this._showVoiceIndicator("Listening... (Speak Now)");

        const rec = new SpeechRecognition();
        rec.lang = 'en-US';
        rec.interimResults = false;
        rec.maxAlternatives = 1;

        rec.onspeechstart = () => {
            this._showVoiceIndicator("Recording...");
        };

        rec.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            dbg(`[lib3d] Voice search result: ${transcript}`);
            this._showVoiceIndicator(`Searched: "${transcript}"`);

            // Apply the filter and reset pagination
            this._filterSearch = transcript;
            this._applyFilters();
            this._page = 1;
            this._render();

            setTimeout(() => this._hideVoiceIndicator(), 3500);
            this._recognitionActive = false;
        };

        rec.onerror = (event) => {
            dbg(`[lib3d] Voice search error: ${event.error}`);
            // Check specifically for no-speech
            if (event.error === 'no-speech') {
                this._showVoiceIndicator("Cleared search filter");
                this._filterSearch = "";
                this._applyFilters();
                this._page = 1;
                this._render();
            } else {
                this._showVoiceIndicator("Voice search failed");
            }
            setTimeout(() => this._hideVoiceIndicator(), 2500);
            this._recognitionActive = false;
        };

        rec.onend = () => {
            if (this._recognitionActive) {
                this._hideVoiceIndicator();
                this._recognitionActive = false;
            }
        };

        rec.start();
    }

    _showVoiceIndicator(text) {
        if (!this._voiceMesh) {
            this._voiceMesh = BABYLON.MeshBuilder.CreatePlane('voiceIndicator', { width: 1.8, height: 0.35 }, this._scene);
            // Position above the grid, facing the user
            this._voiceMesh.position.set(GRID_X_OFF, GRID_Y + (ROWS * CARD_H / 2) + 0.35, GRID_Z - 1.0);
            this._voiceMesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;

            this._voiceTex = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(this._voiceMesh, 512, 102);

            const bg = new BABYLON.GUI.Rectangle('vbg');
            bg.width = '100%'; bg.height = '100%';
            bg.cornerRadius = 20;
            bg.background = 'rgba(26, 115, 232, 0.85)';
            bg.color = 'rgba(255, 255, 255, 0.4)';
            bg.thickness = 2;
            this._voiceTex.addControl(bg);

            this._voiceTxt = new BABYLON.GUI.TextBlock('vtxt', text);
            this._voiceTxt.color = '#ffffff';
            this._voiceTxt.fontSize = 28;
            this._voiceTxt.fontWeight = 'bold';
            this._voiceTxt.fontFamily = FONT;
            bg.addControl(this._voiceTxt);

            this._navMeshes.push(this._voiceMesh);
        } else {
            this._voiceTxt.text = text;
            this._voiceMesh.isVisible = true;
        }
    }

    _hideVoiceIndicator() {
        if (this._voiceMesh) {
            this._voiceMesh.isVisible = false;
        }
    }
}
