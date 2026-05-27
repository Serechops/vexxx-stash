/**
 * video-features.js – Advanced video features like bookmarks, chapters, subtitles
 */

import { CONFIG } from './config.js';

export class VideoFeatures {
  constructor(videoController, session, scene = null) {
    this.vc = videoController;
    this.session = session;
    this.scene = scene;

    this.bookmarks = [];
    this.chapters = [];
    this.subtitles = [];
    this.activeSubtitle = null;
    this.playbackHistory = [];
    this.qualityPreferences = new Map();

    this.init();
  }

  init() {
    this.loadBookmarks();
    this.loadHistory();
    this.setupKeyboardShortcuts();
  }

  /* ── Bookmarks ─────────────────────────────────────────────────── */

  addBookmark(time, name) {
    const bookmark = {
      id: Date.now(),
      time: time || this.vc.currentTime,
      name: name || `Bookmark ${this.bookmarks.length + 1}`,
      timestamp: new Date().toISOString(),
      mediaId: this.session.id
    };

    this.bookmarks.push(bookmark);
    this.saveBookmarks();
    return bookmark;
  }

  removeBookmark(id) {
    this.bookmarks = this.bookmarks.filter(b => b.id !== id);
    this.saveBookmarks();
  }

  jumpToBookmark(id) {
    const bookmark = this.bookmarks.find(b => b.id === id);
    if (bookmark) {
      this.vc.seek(bookmark.time);
    }
  }

  saveBookmarks() {
    try {
      localStorage.setItem('vr_bookmarks', JSON.stringify(this.bookmarks));
    } catch (e) {
      console.warn('Failed to save bookmarks:', e);
    }
  }

  loadBookmarks() {
    try {
      const saved = localStorage.getItem('vr_bookmarks');
      if (saved) {
        this.bookmarks = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load bookmarks:', e);
    }
  }

  /* ── Playback History ──────────────────────────────────────────── */

  recordPlayback() {
    const entry = {
      mediaId: this.session.id,
      title: this.session.title,
      time: this.vc.currentTime,
      duration: this.vc.duration,
      timestamp: Date.now(),
      completed: this.vc.currentTime / this.vc.duration > 0.95
    };

    this.playbackHistory.unshift(entry);

    // Keep only last 100 entries
    if (this.playbackHistory.length > 100) {
      this.playbackHistory.pop();
    }

    this.saveHistory();
  }

  getContinueWatching() {
    return this.playbackHistory
      .filter(entry => !entry.completed && entry.time > 30)
      .slice(0, 10);
  }

  getRecentlyWatched() {
    return this.playbackHistory.slice(0, 20);
  }

  saveHistory() {
    try {
      localStorage.setItem('vr_history', JSON.stringify(this.playbackHistory));
    } catch (e) {
      console.warn('Failed to save history:', e);
    }
  }

  loadHistory() {
    try {
      const saved = localStorage.getItem('vr_history');
      if (saved) {
        this.playbackHistory = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load history:', e);
    }
  }

  /* ── Chapters ──────────────────────────────────────────────────── */

  loadChapters(chapters) {
    this.chapters = chapters.sort((a, b) => a.time - b.time);
  }

  getCurrentChapter() {
    const currentTime = this.vc.currentTime;
    return this.chapters
      .filter(ch => ch.time <= currentTime)
      .sort((a, b) => b.time - a.time)[0];
  }

  getNextChapter() {
    const currentTime = this.vc.currentTime;
    return this.chapters
      .filter(ch => ch.time > currentTime)
      .sort((a, b) => a.time - b.time)[0];
  }

  jumpToChapter(index) {
    if (this.chapters[index]) {
      this.vc.seek(this.chapters[index].time);
    }
  }

  /* ── Subtitles ─────────────────────────────────────────────────── */

  async loadSubtitles(url, language) {
    try {
      const response = await fetch(url);
      const content = await response.text();

      // Parse based on format (SRT, VTT, etc.)
      this.subtitles = this.parseSubtitles(content);
      this.activeSubtitle = language;

      this.setupSubtitleRendering();
    } catch (e) {
      console.warn('Failed to load subtitles:', e);
    }
  }

  parseSubtitles(content) {
    // Simple SRT parser
    const subtitles = [];
    const blocks = content.trim().split('\n\n');

    blocks.forEach(block => {
      const lines = block.split('\n');
      if (lines.length >= 3) {
        const timeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/);
        if (timeMatch) {
          const start = this.parseTimecode(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
          const end = this.parseTimecode(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
          const text = lines.slice(2).join('\n');

          subtitles.push({ start, end, text });
        }
      }
    });

    return subtitles;
  }

  parseTimecode(hours, minutes, seconds, ms) {
    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(ms) / 1000;
  }

  setupSubtitleRendering() {
    // Create subtitle plane
    const subtitlePlane = new BABYLON.MeshBuilder.CreatePlane('subtitles', { width: 4, height: 0.5 }, this.scene);
    subtitlePlane.position = new BABYLON.Vector3(0, 1.2, 3);
    subtitlePlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    const texture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(subtitlePlane, 512, 64);
    const textBlock = new BABYLON.GUI.TextBlock('subtitleText', '');
    textBlock.color = 'white';
    textBlock.fontSize = 32;
    textBlock.shadowColor = 'black';
    textBlock.shadowBlur = 10;
    textBlock.shadowOffsetX = 2;
    textBlock.shadowOffsetY = 2;
    texture.addControl(textBlock);

    // Update subtitles based on current time
    this.vc.onTimeUpdate(() => {
      const currentTime = this.vc.currentTime;
      const active = this.subtitles.find(s => currentTime >= s.start && currentTime <= s.end);
      textBlock.text = active ? active.text : '';
    });
  }

  /* ── Quality Adaptation ────────────────────────────────────────── */

  setQualityPreference(mediaId, quality) {
    this.qualityPreferences.set(mediaId, quality);
    this.savePreferences();
  }

  getOptimalQuality(bandwidth) {
    if (bandwidth > CONFIG.NETWORK.MIN_BANDWIDTH_4K) {
      return CONFIG.VIDEO.QUALITY_LEVELS.ULTRA;
    } else if (bandwidth > CONFIG.NETWORK.MIN_BANDWIDTH_1080p) {
      return CONFIG.VIDEO.QUALITY_LEVELS.HIGH;
    } else if (bandwidth > CONFIG.NETWORK.MIN_BANDWIDTH_720p) {
      return CONFIG.VIDEO.QUALITY_LEVELS.MEDIUM;
    } else {
      return CONFIG.VIDEO.QUALITY_LEVELS.LOW;
    }
  }

  savePreferences() {
    try {
      const prefs = {};
      this.qualityPreferences.forEach((value, key) => {
        prefs[key] = value;
      });
      localStorage.setItem('quality_prefs', JSON.stringify(prefs));
    } catch (e) {
      console.warn('Failed to save preferences:', e);
    }
  }

  /* ── Keyboard Shortcuts (Desktop) ─────────────────────────────── */

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.vc.toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.vc.seekDelta(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.vc.seekDelta(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.vc.setVolume(this.vc.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.vc.setVolume(this.vc.volume - 0.1);
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          this.vc.toggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          this.toggleFullscreen();
          break;
        case 'b':
        case 'B':
          e.preventDefault();
          this.addBookmark();
          break;
      }
    });
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  /* ── Favorites ─────────────────────────────────────────────────── */

  addToFavorites(media) {
    const favorites = this.getFavorites();
    if (!favorites.some(f => f.id === media.id)) {
      favorites.push({
        id: media.id,
        title: media.title,
        thumbnail: media.thumbnailPath,
        added: Date.now()
      });
      localStorage.setItem('vr_favorites', JSON.stringify(favorites));
    }
  }

  removeFromFavorites(mediaId) {
    const favorites = this.getFavorites();
    const filtered = favorites.filter(f => f.id !== mediaId);
    localStorage.setItem('vr_favorites', JSON.stringify(filtered));
  }

  getFavorites() {
    try {
      return JSON.parse(localStorage.getItem('vr_favorites')) || [];
    } catch {
      return [];
    }
  }

  /* ── Playlists ─────────────────────────────────────────────────── */

  createPlaylist(name) {
    const playlists = this.getPlaylists();
    playlists.push({
      id: Date.now(),
      name,
      items: [],
      created: Date.now()
    });
    localStorage.setItem('vr_playlists', JSON.stringify(playlists));
  }

  addToPlaylist(playlistId, media) {
    const playlists = this.getPlaylists();
    const playlist = playlists.find(p => p.id === playlistId);
    if (playlist && !playlist.items.some(i => i.id === media.id)) {
      playlist.items.push({
        id: media.id,
        title: media.title,
        thumbnail: media.thumbnailPath
      });
      localStorage.setItem('vr_playlists', JSON.stringify(playlists));
    }
  }

  getPlaylists() {
    try {
      return JSON.parse(localStorage.getItem('vr_playlists')) || [];
    } catch {
      return [];
    }
  }

  /* ── Up Next Smart Auto-Play ───────────────────────────────────── */

  setupUpNext(libraryItems, currentMediaId, onPlayNext) {
    this.allMedia = libraryItems || [];
    this.currentMediaId = currentMediaId;
    this.onPlayNext = onPlayNext;

    // Determine next media
    const currentIndex = this.allMedia.findIndex(m => String(m.id) === String(currentMediaId));
    if (currentIndex >= 0 && currentIndex < this.allMedia.length - 1) {
      this.nextMedia = this.allMedia[currentIndex + 1];
    } else {
      this.nextMedia = null;
    }

    this.upNextVisible = false;

    // Listen to time updates
    this.vc.onTimeUpdate(() => {
      if (!this.nextMedia || !this.vc.duration) return;
      const timeLeft = this.vc.duration - this.vc.currentTime;
      if (timeLeft <= 15 && timeLeft > 0) {
        this.showUpNextCard(timeLeft);
      } else {
        this.hideUpNextCard();
      }
    });

    // Listen to ended event for auto-play
    // Try to safely attach event via whatever mechanism video controller uses
    if (typeof this.vc.onEnded === 'function') {
      this.vc.onEnded(() => {
        if (this.nextMedia && this.upNextVisible) {
          this.onPlayNext(this.nextMedia);
        }
      });
    } else if (this.vc._el) {
      this.vc._el.addEventListener('ended', () => {
        if (this.nextMedia && this.upNextVisible) {
          this.onPlayNext(this.nextMedia);
        }
      });
    }
  }

  showUpNextCard(timeLeft) {
    if (!this.scene || !this.nextMedia) return;

    this.upNextVisible = true;

    if (!this.upNextMesh) {
      // Build 3D card
      this.upNextMesh = BABYLON.MeshBuilder.CreatePlane('upNext', { width: 2.0, height: 1.5 }, this.scene);
      this.upNextMesh.position = new BABYLON.Vector3(3.0, 1.5, 4.0); // Position to the right
      this.upNextMesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;

      const tex = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(this.upNextMesh, 800, 600);

      const bg = new BABYLON.GUI.Rectangle('unBg');
      bg.width = '100%'; bg.height = '100%';
      bg.cornerRadius = 20;
      bg.background = 'rgba(15, 15, 15, 0.95)';
      bg.color = 'rgba(255, 255, 255, 0.2)';
      bg.thickness = 2;
      tex.addControl(bg);

      const titleLbl = new BABYLON.GUI.TextBlock('unLbl', 'UP NEXT');
      titleLbl.color = '#8ab4f8'; titleLbl.fontSize = 40; titleLbl.fontWeight = 'bold';
      titleLbl.fontFamily = 'Inter, -apple-system, sans-serif';
      titleLbl.top = '30px'; titleLbl.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
      bg.addControl(titleLbl);

      this.upNextImage = new BABYLON.GUI.Image('unImg', '');
      this.upNextImage.width = '700px'; this.upNextImage.height = '400px';
      this.upNextImage.top = '90px'; this.upNextImage.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
      this.upNextImage.stretch = BABYLON.GUI.Image.STRETCH_UNIFORM;
      bg.addControl(this.upNextImage);

      this.upNextTitle = new BABYLON.GUI.TextBlock('unTitle', '');
      this.upNextTitle.color = 'white'; this.upNextTitle.fontSize = 32;
      this.upNextTitle.top = '500px'; this.upNextTitle.height = '40px';
      this.upNextTitle.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
      this.upNextTitle.fontFamily = 'Inter, -apple-system, sans-serif';
      bg.addControl(this.upNextTitle);

      this.upNextTimer = new BABYLON.GUI.TextBlock('unTimer', '');
      this.upNextTimer.color = '#aaaaaa'; this.upNextTimer.fontSize = 24;
      this.upNextTimer.top = '550px'; this.upNextTimer.height = '30px';
      this.upNextTimer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
      this.upNextTimer.fontFamily = 'Inter, -apple-system, sans-serif';
      bg.addControl(this.upNextTimer);

      // Allow clicking to play immediately
      this.upNextMesh.actionManager = new BABYLON.ActionManager(this.scene);
      this.upNextMesh.actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickTrigger, () => {
          if (this.onPlayNext && this.nextMedia) {
            this.hideUpNextCard(); // Hide early
            this.onPlayNext(this.nextMedia);
          }
        })
      );
    }

    // Update content
    this.upNextMesh.isVisible = true;
    this.upNextTitle.text = this.nextMedia.title || "Next Video";

    // Resolving thumbnailURL:
    let thumbPath = this.nextMedia.thumbnailPath || '';
    if (thumbPath && !thumbPath.startsWith('http')) {
      // Assume session.js apiUrl logic 
      // e.g., if relative, prepend host or /api depending on app proxy config
      // In local scope, we might not have `apiUrl` available, so best effort prefix
      if (thumbPath.startsWith('/api')) {
        // do nothing, let it relative resolve
      } else if (thumbPath.startsWith('/')) {
        thumbPath = '/api' + thumbPath;
      } else {
        thumbPath = '/api/' + thumbPath;
      }
    }
    this.upNextImage.source = thumbPath;

    this.upNextTimer.text = `Playing in ${Math.ceil(timeLeft)}s... (Click to play now)`;
  }

  hideUpNextCard() {
    this.upNextVisible = false;
    if (this.upNextMesh) {
      this.upNextMesh.isVisible = false;
    }
  }

  /* ── Cleanup ───────────────────────────────────────────────────── */

  destroy() {
    this.recordPlayback(); // Final recording
    this.saveBookmarks();
    this.saveHistory();
    this.savePreferences();
    if (this.upNextMesh) {
      this.upNextMesh.dispose();
      this.upNextMesh = null;
    }
  }
}