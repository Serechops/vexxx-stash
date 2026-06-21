/**
 * VRLobbyBackdrop — the immersive Home environment: a calm, relaxing ambience
 * rather than active content. A deep twilight gradient sky wraps the whole
 * background, a slow-drifting starfield gives gentle living motion, and a faint
 * floor grid grounds the space. Intentionally quiet so it sits comfortably
 * behind the Home wall without competing for attention.
 *
 * Additive: it never touches the main dome or the protected projection methods —
 * it's its own self-contained group added to the scene.
 */
import * as THREE from "three";

const SKY_RADIUS = 470;
const STAR_COUNT = 700;

export class VRLobbyBackdrop {
  readonly object: THREE.Group;

  private sky: THREE.Mesh;
  private skyTexture: THREE.CanvasTexture;
  private stars: THREE.Points;
  private starGeo: THREE.BufferGeometry;
  private starMat: THREE.PointsMaterial;
  private visible = false;

  constructor() {
    this.object = new THREE.Group();

    // Calm gradient sky shell.
    this.skyTexture = this.makeGradientTexture();
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS, 32, 24),
      new THREE.MeshBasicMaterial({
        map: this.skyTexture,
        side: THREE.BackSide,
      })
    );
    this.sky.frustumCulled = false;
    this.object.add(this.sky);

    // Slow-drifting starfield for serene, living ambience.
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const u = Math.random() * 2 - 1; // uniform direction on a sphere
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const dist = 120 + Math.random() * 260;
      positions[i * 3] = Math.cos(theta) * r * dist;
      positions[i * 3 + 1] = u * dist;
      positions[i * 3 + 2] = Math.sin(theta) * r * dist;
      const tint = 0.7 + Math.random() * 0.3; // soft, slightly cool whites
      colors[i * 3] = tint * 0.82;
      colors[i * 3 + 1] = tint * 0.9;
      colors[i * 3 + 2] = tint;
    }
    this.starGeo = new THREE.BufferGeometry();
    this.starGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    this.starGeo.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colors, 3)
    );
    this.starMat = new THREE.PointsMaterial({
      size: 2.4,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    this.stars = new THREE.Points(this.starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.object.add(this.stars);

    // Faint floor grid for grounding.
    const grid = new THREE.GridHelper(24, 48, 0x3a5a86, 0x1f2c40);
    const setGridMat = (m: THREE.Material) => {
      m.transparent = true;
      m.opacity = 0.1;
      m.depthWrite = false;
    };
    if (Array.isArray(grid.material)) grid.material.forEach(setGridMat);
    else setGridMat(grid.material);
    grid.position.y = 0.02;
    this.object.add(grid);

    this.object.visible = false;
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.object.visible = v;
  }

  /** Per-frame: gentle rotation + breathing so the field feels alive, not busy. */
  update() {
    if (!this.visible) return;
    const t = performance.now() * 0.001;
    this.stars.rotation.y = t * 0.012;
    this.starMat.opacity = 0.62 + Math.sin(t * 0.4) * 0.13;
  }

  private makeGradientTexture(): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 256;
    const cx = c.getContext("2d");
    if (cx) {
      const grad = cx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "#172a44"); // deep twilight blue at the zenith
      grad.addColorStop(0.5, "#121d2c");
      grad.addColorStop(0.8, "#0d1622");
      grad.addColorStop(1, "#070a10"); // near-black underfoot
      cx.fillStyle = grad;
      cx.fillRect(0, 0, 8, 256);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  }

  dispose() {
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.skyTexture.dispose();
    this.starGeo.dispose();
    this.starMat.dispose();
    this.object.traverse((o) => {
      const m = o as Partial<THREE.Mesh>;
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const mm of mats) mm.dispose();
    });
  }
}
