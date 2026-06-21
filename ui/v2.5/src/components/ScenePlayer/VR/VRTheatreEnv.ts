/**
 * VRTheatreEnv — a large cinematic room that wraps flat (2D) scene playback.
 *
 * When a non-VR scene is selected from the Home wall the flat screen
 * (`makeFlatScreen` in xrSession) appears at (0, 1.4, -3.2). This module
 * builds a matching cinema room around that screen position: dark walls,
 * floor, ceiling, and a soft blue-white glow frame just in front of the
 * screen. Everything is added to the caller's `videoGroup` so it co-rotates
 * with the video when the user recenters.
 *
 * No video texture is needed here — the screen itself is built by the
 * protected `makeFlatScreen()` method in xrSession. This file is purely
 * atmospheric.
 */
import * as THREE from "three";

// Matches xrSession makeFlatScreen: position (0, 1.4, -3.2), size (4z × 2.25z)
const SCREEN_X = 0;
const SCREEN_Y = 1.4;
const SCREEN_Z = -3.2;

export class VRTheatreEnv {
  readonly object: THREE.Group;
  private glowMesh: THREE.Mesh;
  private allMaterials: THREE.Material[] = [];
  private visible = false;

  constructor() {
    this.object = new THREE.Group();
    this.buildRoom();
    this.glowMesh = this.buildScreenGlow(1.0);
    this.object.add(this.glowMesh);
    this.object.visible = false;
  }

  /** Resize the frame glow to match `makeFlatScreen`'s size at this zoom. */
  setZoom(zoom: number) {
    const gw = 4 * zoom * 1.18;
    const gh = 2.25 * zoom * 1.18;
    this.glowMesh.geometry.dispose();
    this.glowMesh.geometry = new THREE.PlaneGeometry(gw, gh);
    // Sit behind the screen centre so the curved screen surface never clips
    // through the glow plane; only the border fringe (beyond screen dims) shows.
    this.glowMesh.position.set(SCREEN_X, SCREEN_Y, SCREEN_Z - 0.3);
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.object.visible = v;
  }

  dispose() {
    for (const mat of this.allMaterials) mat.dispose();
    this.object.traverse((o) => {
      const m = o as Partial<THREE.Mesh>;
      (m.geometry as THREE.BufferGeometry | undefined)?.dispose();
    });
  }

  // ── Room construction ──────────────────────────────────────────────────────

  private addMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    this.allMaterials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.object.add(mesh);
    return mesh;
  }

  private buildRoom() {
    // Back wall — dark with faint bounce-light from the screen centre.
    const backCanvas = document.createElement("canvas");
    backCanvas.width = 512;
    backCanvas.height = 384;
    const bc = backCanvas.getContext("2d")!;
    bc.fillStyle = "#07080d";
    bc.fillRect(0, 0, 512, 384);
    // Soft central glow: simulates ambient bounce from the screen.
    const bgrd = bc.createRadialGradient(256, 168, 10, 256, 168, 280);
    bgrd.addColorStop(0, "rgba(30,55,110,0.50)");
    bgrd.addColorStop(1, "rgba(0,0,0,0)");
    bc.fillStyle = bgrd;
    bc.fillRect(0, 0, 512, 384);
    const backTex = new THREE.CanvasTexture(backCanvas);
    backTex.colorSpace = THREE.SRGBColorSpace;
    this.addMesh(
      new THREE.PlaneGeometry(24, 15),
      new THREE.MeshBasicMaterial({ map: backTex })
    ).position.set(0, 2.0, -5.2);

    // Side walls.
    const sideMat = new THREE.MeshBasicMaterial({ color: 0x05060a });
    this.allMaterials.push(sideMat);
    const leftWall = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 15),
      sideMat
    );
    leftWall.position.set(-10, 2.0, -2.2);
    leftWall.rotation.y = -Math.PI / 2;
    leftWall.frustumCulled = false;
    this.object.add(leftWall);

    const rightWall = leftWall.clone();
    rightWall.position.set(10, 2.0, -2.2);
    rightWall.rotation.y = Math.PI / 2;
    this.object.add(rightWall);

    // Floor — very dark with subtle planks (small repeating canvas).
    const floorCanvas = document.createElement("canvas");
    floorCanvas.width = 64;
    floorCanvas.height = 64;
    const fc = floorCanvas.getContext("2d")!;
    fc.fillStyle = "#0b0d14";
    fc.fillRect(0, 0, 64, 64);
    fc.strokeStyle = "rgba(255,255,255,0.025)";
    fc.lineWidth = 1;
    fc.beginPath();
    fc.moveTo(0, 32);
    fc.lineTo(64, 32);
    fc.stroke();
    const floorTex = new THREE.CanvasTexture(floorCanvas);
    floorTex.colorSpace = THREE.SRGBColorSpace;
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(14, 7);
    const floorMesh = this.addMesh(
      new THREE.PlaneGeometry(24, 8),
      new THREE.MeshBasicMaterial({ map: floorTex })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, -0.6, -2.0);

    // Ceiling.
    this.addMesh(
      new THREE.PlaneGeometry(24, 8),
      new THREE.MeshBasicMaterial({ color: 0x030307 })
    ).rotation.x = Math.PI / 2;
    this.object.children[this.object.children.length - 1].position.set(
      0,
      5.8,
      -2.0
    );
    (
      this.object.children[this.object.children.length - 1] as THREE.Mesh
    ).frustumCulled = false;

    // Subtle seat-silhouette strip at the viewer's lower-left / right periphery.
    // Just a faint dark blob to reinforce the "you're in a cinema" feel.
    const seatCanvas = document.createElement("canvas");
    seatCanvas.width = 256;
    seatCanvas.height = 64;
    const sc = seatCanvas.getContext("2d")!;
    sc.clearRect(0, 0, 256, 64);
    // Dark silhouette row of headrests.
    sc.fillStyle = "rgba(8,9,14,0.88)";
    for (let i = 0; i < 7; i++) {
      const sx = 12 + i * 34;
      sc.beginPath();
      sc.ellipse(sx, 48, 12, 18, 0, 0, Math.PI * 2);
      sc.fill();
      sc.beginPath();
      sc.ellipse(sx, 30, 7, 10, 0, 0, Math.PI * 2);
      sc.fill();
    }
    const seatTex = new THREE.CanvasTexture(seatCanvas);
    seatTex.colorSpace = THREE.SRGBColorSpace;
    const seatMat = new THREE.MeshBasicMaterial({
      map: seatTex,
      transparent: true,
      depthWrite: false,
    });
    this.allMaterials.push(seatMat);
    const seats = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 1.4),
      seatMat
    );
    seats.position.set(-3.5, -0.1, -1.5);
    seats.rotation.x = -0.25;
    seats.frustumCulled = false;
    this.object.add(seats);
    const seats2 = seats.clone();
    seats2.position.set(3.5, -0.1, -1.5);
    this.object.add(seats2);
  }

  private buildScreenGlow(zoom: number): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 576;
    const ctx = canvas.getContext("2d")!;
    this.drawGlowCanvas(ctx);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    this.allMaterials.push(mat);

    const gw = 4 * zoom * 1.18;
    const gh = 2.25 * zoom * 1.18;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), mat);
    mesh.position.set(SCREEN_X, SCREEN_Y, SCREEN_Z - 0.3);
    mesh.frustumCulled = false;
    return mesh;
  }

  private drawGlowCanvas(ctx: CanvasRenderingContext2D) {
    const W = 1024;
    const H = 576;
    ctx.clearRect(0, 0, W, H);
    const BORDER = 72;

    // Top fade
    const topG = ctx.createLinearGradient(0, 0, 0, BORDER);
    topG.addColorStop(0, "rgba(160,200,255,0.60)");
    topG.addColorStop(1, "rgba(160,200,255,0)");
    ctx.fillStyle = topG;
    ctx.fillRect(0, 0, W, BORDER);

    // Bottom fade
    const botG = ctx.createLinearGradient(0, H - BORDER, 0, H);
    botG.addColorStop(0, "rgba(160,200,255,0)");
    botG.addColorStop(1, "rgba(160,200,255,0.60)");
    ctx.fillStyle = botG;
    ctx.fillRect(0, H - BORDER, W, BORDER);

    // Left fade
    const lG = ctx.createLinearGradient(0, 0, BORDER, 0);
    lG.addColorStop(0, "rgba(160,200,255,0.60)");
    lG.addColorStop(1, "rgba(160,200,255,0)");
    ctx.fillStyle = lG;
    ctx.fillRect(0, BORDER, BORDER, H - BORDER * 2);

    // Right fade
    const rG = ctx.createLinearGradient(W - BORDER, 0, W, 0);
    rG.addColorStop(0, "rgba(160,200,255,0)");
    rG.addColorStop(1, "rgba(160,200,255,0.60)");
    ctx.fillStyle = rG;
    ctx.fillRect(W - BORDER, BORDER, BORDER, H - BORDER * 2);

    // Corner radial glows
    const corners: [number, number][] = [
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
    ];
    for (const [cx, cy] of corners) {
      const r = ctx.createRadialGradient(cx, cy, 0, cx, cy, BORDER * 1.5);
      r.addColorStop(0, "rgba(160,200,255,0.60)");
      r.addColorStop(1, "rgba(160,200,255,0)");
      ctx.fillStyle = r;
      const bx = cx === 0 ? 0 : W - BORDER;
      const by = cy === 0 ? 0 : H - BORDER;
      ctx.fillRect(bx, by, BORDER, BORDER);
    }

    // Thin bright inner border line
    ctx.strokeStyle = "rgba(200,225,255,0.40)";
    ctx.lineWidth = 2.5;
    const m = 24;
    ctx.strokeRect(m, m, W - m * 2, H - m * 2);
  }
}
