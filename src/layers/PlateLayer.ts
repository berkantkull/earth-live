import * as THREE from 'three';
import { latLonToVec3 } from '../lib/geo.ts';
import { densify, type PlateData } from '../lib/plates.ts';
import { PLATE_COLORS } from '../lib/scales.ts';
import type { Layer } from './Layer.ts';

/** Bulutların (1.006) hemen üstünde, deprem işaretlerinin (1.0085) altında */
const RADIUS = 1.0068;

export class PlateLayer implements Layer {
  readonly id = 'plates' as const;
  readonly group = new THREE.Group();
  private data: PlateData | null = null;
  /** her sınır için sıklaştırılmış parçalar */
  private parts: number[][][] = [];
  /** seçim için sahne konumları: [sınır dizini, x, y, z] */
  private pickPoints = new Float32Array(0);
  private highlight: THREE.LineSegments | null = null;
  private readonly highlightMat = new THREE.LineBasicMaterial({ color: PLATE_COLORS.selected, transparent: true, opacity: 0.95, depthWrite: false });

  constructor() {
    this.group.name = 'plates';
  }

  get visibleCount() {
    return this.data?.lines.length ?? 0;
  }

  get plateData() {
    return this.data;
  }

  partsOf(i: number) {
    return this.parts[i] ?? [];
  }

  setVisible(on: boolean) {
    this.group.visible = on;
  }

  setData(data: PlateData) {
    this.data = data;
    this.parts = data.lines.map((l) => densify(l.c, 1));
    this.group.clear();

    // iki renk grubu: dalma-batma zonları ve diğer sınırlar
    for (const sub of [0, 1] as const) {
      const pos: number[] = [];
      data.lines.forEach((l, i) => {
        if (l.sub !== sub) return;
        for (const p of this.parts[i]) this.appendSegments(p, pos);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({
        color: sub ? PLATE_COLORS.subduction : PLATE_COLORS.boundary,
        transparent: true,
        opacity: sub ? 0.75 : 0.55,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(geo, mat);
      lines.renderOrder = 2;
      this.group.add(lines);
    }

    // seçim noktaları çizimden daha sık (0.25°): yakınlaşınca da çizginin üstüne gelmek yeterli olsun
    const pick: number[] = [];
    const v = new THREE.Vector3();
    data.lines.forEach((l, i) => {
      for (const p of densify(l.c, 0.25)) {
        for (let k = 0; k < p.length; k += 2) {
          latLonToVec3(p[k], p[k + 1], RADIUS, v);
          pick.push(i, v.x, v.y, v.z);
        }
      }
    });
    this.pickPoints = new Float32Array(pick);
  }

  private appendSegments(p: number[], out: number[]) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let k = 2; k < p.length; k += 2) {
      latLonToVec3(p[k - 2], p[k - 1], RADIUS, a);
      latLonToVec3(p[k], p[k + 1], RADIUS, b);
      out.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  forEachPickable(cb: (index: number, pos: THREE.Vector3) => void) {
    if (!this.group.visible) return;
    const v = new THREE.Vector3();
    const pp = this.pickPoints;
    for (let k = 0; k < pp.length; k += 4) {
      v.set(pp[k + 1], pp[k + 2], pp[k + 3]);
      cb(pp[k], v);
    }
  }

  /** Sınırın orta noktası */
  positionOf(index: number, out: THREE.Vector3) {
    const ps = this.parts[index];
    if (!ps?.length) return false;
    const longest = ps.reduce((a, b) => (b.length > a.length ? b : a));
    const mid = Math.floor(longest.length / 4) * 2;
    latLonToVec3(longest[mid], longest[mid + 1], RADIUS, out);
    return true;
  }

  select(index: number | null) {
    if (this.highlight) {
      this.group.remove(this.highlight);
      this.highlight.geometry.dispose();
      this.highlight = null;
    }
    if (index === null || !this.parts[index]) return;
    const pos: number[] = [];
    for (const p of this.parts[index]) this.appendSegments(p, pos);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.highlight = new THREE.LineSegments(geo, this.highlightMat);
    this.highlight.renderOrder = 3;
    this.group.add(this.highlight);
  }

  /** "Anadolu – Avrasya" */
  title(i: number) {
    const l = this.data?.lines[i];
    if (!l || !this.data) return '';
    return `${this.data.names[l.a] ?? l.a} – ${this.data.names[l.b] ?? l.b}`;
  }

  label(i: number) {
    const l = this.data?.lines[i];
    return l ? `${this.title(i)} plaka sınırı${l.sub ? ' · dalma-batma' : ''}` : '';
  }

  keyOf(i: number) {
    return this.data?.lines[i] ? String(i) : '';
  }

  indexOfKey(key: string) {
    const i = Number(key);
    return Number.isInteger(i) && this.data?.lines[i] ? i : -1;
  }
}
