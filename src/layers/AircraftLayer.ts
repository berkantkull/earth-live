import * as THREE from 'three';
import { destinationPoint, latLonToVec3 } from '../lib/geo.ts';
import { ALTITUDE_STOPS, stopColor } from '../lib/scales.ts';
import type { Aircraft } from '../lib/types.ts';
import type { Layer } from './Layer.ts';

const BASE_RADIUS = 1.009;
/** İrtifa abartma katsayısı: 11 km → +0.005 birim */
const ALT_EXAGGERATION = 0.005 / 11000;
/** Bu süreden eski konumlar ileri tahmin edilmez */
const MAX_EXTRAPOLATION_S = 20 * 60;
const UPDATE_INTERVAL_MS = 120;

function planeGeometry(): THREE.BufferGeometry {
  // burun +Y yönünde, birim boyutlu uçak silueti
  const s = new THREE.Shape();
  s.moveTo(0, 1);
  s.lineTo(0.12, 0.62);
  s.lineTo(0.12, 0.22);
  s.lineTo(0.95, -0.18);
  s.lineTo(0.95, -0.36);
  s.lineTo(0.12, -0.16);
  s.lineTo(0.1, -0.68);
  s.lineTo(0.38, -0.88);
  s.lineTo(0.38, -1);
  s.lineTo(0, -0.9);
  s.lineTo(-0.38, -1);
  s.lineTo(-0.38, -0.88);
  s.lineTo(-0.1, -0.68);
  s.lineTo(-0.12, -0.16);
  s.lineTo(-0.95, -0.36);
  s.lineTo(-0.95, -0.18);
  s.lineTo(-0.12, 0.22);
  s.lineTo(-0.12, 0.62);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

export interface AircraftFilter {
  showOnGround: boolean;
}

export class AircraftLayer implements Layer {
  readonly id = 'aircraft' as const;
  readonly group = new THREE.Group();
  private all: Aircraft[] = [];
  private items: Aircraft[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private readonly geometry = planeGeometry();
  private readonly material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
  /** sunucunun ölçüm zamanı ile yerel saat arasındaki fark */
  private clockOffsetMs = 0;
  private positions = new Float32Array(0);
  private lastUpdate = 0;
  private selected: number | null = null;
  private filter: AircraftFilter = { showOnGround: false };
  private readonly selectedColor = new THREE.Color('#ff3df5');

  constructor() {
    this.group.name = 'aircraft';
  }

  get visibleCount() {
    return this.items.length;
  }

  get data(): readonly Aircraft[] {
    return this.items;
  }

  item(i: number) {
    return this.items[i];
  }

  setVisible(on: boolean) {
    this.group.visible = on;
  }

  setFilter(f: Partial<AircraftFilter>) {
    this.filter = { ...this.filter, ...f };
    this.rebuild();
  }

  /** observedAt: OpenSky'ın veri zaman damgası (ms) */
  setData(aircraft: Aircraft[], observedAt: number) {
    this.all = aircraft;
    this.clockOffsetMs = Date.now() - observedAt;
    this.rebuild();
  }

  private rebuild() {
    const selKey = this.selected !== null ? this.keyOf(this.selected) : null;
    this.items = this.filter.showOnGround ? this.all : this.all.filter((a) => !a.onGround);
    const n = this.items.length;
    if (!this.mesh || this.mesh.instanceMatrix.count < n) {
      if (this.mesh) {
        this.group.remove(this.mesh);
        this.mesh.dispose();
      }
      this.mesh = new THREE.InstancedMesh(this.geometry, this.material, Math.max(1, Math.ceil(n * 1.25)));
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 4;
      this.group.add(this.mesh);
    }
    this.mesh.count = n;
    this.positions = new Float32Array(n * 3);
    this.selected = selKey ? this.indexOfKey(selKey) : null;
    if (this.selected === -1) this.selected = null;
    this.applyColors();
    this.lastUpdate = 0;
  }

  private applyColors() {
    if (!this.mesh) return;
    const c = new THREE.Color();
    this.items.forEach((a, i) => {
      c.set(a.onGround ? ALTITUDE_STOPS[0].color : stopColor(ALTITUDE_STOPS, Math.max(1, a.altitudeM ?? 1)));
      if (i === this.selected) c.copy(this.selectedColor);
      this.mesh!.setColorAt(i, c);
    });
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Dead-reckoning: son bilinen konum + hız × geçen süre, rota boyunca */
  estimate(a: Aircraft, now: number): { lat: number; lon: number } {
    if (a.onGround || !a.velocity || a.heading === null) return { lat: a.lat, lon: a.lon };
    const elapsed = (now - this.clockOffsetMs) / 1000 - a.positionTime;
    const t = Math.min(MAX_EXTRAPOLATION_S, Math.max(0, elapsed));
    if (t === 0) return { lat: a.lat, lon: a.lon };
    return destinationPoint(a.lat, a.lon, a.heading, (a.velocity * t) / 1000);
  }

  update(zoomScale: number, now: number) {
    if (!this.mesh || !this.group.visible) return;
    if (now - this.lastUpdate < UPDATE_INTERVAL_MS) return;
    this.lastUpdate = now;

    // kamera uzaklığıyla orantılı → ekranda yaklaşık sabit ~7 px
    const size = 0.011 * Math.min(1.6, Math.max(0.03, zoomScale));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3();
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < this.items.length; i++) {
      const a = this.items[i];
      const pos = this.estimate(a, now);
      const r = BASE_RADIUS + Math.max(0, a.altitudeM ?? 0) * ALT_EXAGGERATION;
      latLonToVec3(pos.lat, pos.lon, r, p);
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;

      up.copy(p).normalize();
      east.crossVectors(Y, up);
      if (east.lengthSq() < 1e-9) east.set(1, 0, 0);
      east.normalize();
      north.crossVectors(up, east);
      const h = ((a.heading ?? 0) * Math.PI) / 180;
      fwd.copy(north).multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
      right.crossVectors(fwd, up);
      const s = i === this.selected ? size * 1.8 : size;
      m.makeBasis(right.multiplyScalar(s), fwd.multiplyScalar(s), up.multiplyScalar(s));
      m.setPosition(p);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  forEachPickable(cb: (index: number, pos: THREE.Vector3) => void) {
    if (!this.group.visible) return;
    const p = new THREE.Vector3();
    for (let i = 0; i < this.items.length; i++) {
      p.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
      cb(i, p);
    }
  }

  positionOf(index: number, out: THREE.Vector3) {
    if (index < 0 || index >= this.items.length) return false;
    out.set(this.positions[index * 3], this.positions[index * 3 + 1], this.positions[index * 3 + 2]);
    return out.lengthSq() > 0;
  }

  select(index: number | null) {
    this.selected = index;
    this.applyColors();
    this.lastUpdate = 0;
  }

  label(i: number) {
    const a = this.items[i];
    return a ? `${a.callsign ?? a.icao24.toUpperCase()} · ${a.country}` : '';
  }

  keyOf(i: number) {
    return this.items[i]?.icao24 ?? '';
  }

  indexOfKey(key: string) {
    return this.items.findIndex((a) => a.icao24 === key);
  }
}
