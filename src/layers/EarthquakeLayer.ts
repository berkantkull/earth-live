import * as THREE from 'three';
import { latLonToVec3 } from '../lib/geo.ts';
import { DEPTH_STOPS, magnitudeRadius, stopColor } from '../lib/scales.ts';
import type { Earthquake } from '../lib/types.ts';
import type { Layer } from './Layer.ts';

const SURFACE = 1.0085;
const PULSE_WINDOW_MS = 3 * 3600_000;

const vertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aPulse;
  attribute float aSelected;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vPulse;
  varying float vSelected;
  void main() {
    vUv = uv;
    vColor = aColor;
    vPulse = aPulse;
    vSelected = aSelected;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vPulse;
  varying float vSelected;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    float core = 1.0 - smoothstep(0.34, 0.4, r);
    float rim = smoothstep(0.36, 0.4, r) * (1.0 - smoothstep(0.42, 0.46, r));
    float a = core * 0.62 + rim * 0.95;
    vec3 col = mix(vColor, vec3(1.0), rim * 0.35);
    if (vPulse > 0.0) {
      float p = fract(time * 0.45 + vPulse * 7.0);
      float pr = 0.4 + p * 0.6;
      float ring = (1.0 - smoothstep(0.0, 0.05, abs(r - pr))) * (1.0 - p) * vPulse;
      a = max(a, ring * 0.9);
    }
    if (vSelected > 0.5) {
      float sel = 1.0 - smoothstep(0.0, 0.04, abs(r - 0.92));
      a = max(a, sel);
      col = mix(col, vec3(1.0), sel);
    }
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export interface QuakeFilter {
  minMagnitude: number;
}

export class EarthquakeLayer implements Layer {
  readonly id = 'earthquakes' as const;
  readonly group = new THREE.Group();
  private all: Earthquake[] = [];
  private items: Earthquake[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private selected: number | null = null;
  private filter: QuakeFilter = { minMagnitude: 0 };
  private lastScale = -1;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { time: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.group.name = 'earthquakes';
  }

  get visibleCount() {
    return this.items.length;
  }

  get data(): readonly Earthquake[] {
    return this.items;
  }

  item(i: number): Earthquake | undefined {
    return this.items[i];
  }

  setVisible(on: boolean) {
    this.group.visible = on;
  }

  setFilter(f: Partial<QuakeFilter>) {
    this.filter = { ...this.filter, ...f };
    this.rebuild();
  }

  setData(quakes: Earthquake[]) {
    this.all = quakes;
    this.rebuild();
  }

  private rebuild() {
    const selKey = this.selected !== null ? this.keyOf(this.selected) : null;
    // büyükler sonda çizilsin (üstte görünsün)
    this.items = this.all
      .filter((q) => q.magnitude >= this.filter.minMagnitude)
      .sort((a, b) => a.magnitude - b.magnitude);

    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.dispose();
    }
    const n = this.items.length;
    const geo = this.geometry.clone();
    const colors = new Float32Array(n * 3);
    const pulse = new Float32Array(n);
    const selected = new Float32Array(n);
    const now = Date.now();
    const c = new THREE.Color();
    this.items.forEach((q, i) => {
      c.set(stopColor(DEPTH_STOPS, q.depthKm));
      colors.set([c.r, c.g, c.b], i * 3);
      const age = now - q.time;
      pulse[i] = age < PULSE_WINDOW_MS ? 1 - age / PULSE_WINDOW_MS : 0;
    });
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geo.setAttribute('aPulse', new THREE.InstancedBufferAttribute(pulse, 1));
    geo.setAttribute('aSelected', new THREE.InstancedBufferAttribute(selected, 1));
    this.mesh = new THREE.InstancedMesh(geo, this.material, Math.max(1, n));
    this.mesh.count = n;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.group.add(this.mesh);
    this.lastScale = -1;
    this.selected = selKey ? this.indexOfKey(selKey) : null;
    if (this.selected === -1) this.selected = null;
    this.applySelection();
  }

  update(zoomScale: number, time: number) {
    this.material.uniforms.time.value = time / 1000;
    const scale = Math.min(1.6, Math.max(0.25, zoomScale));
    if (!this.mesh || Math.abs(scale - this.lastScale) < 0.01) return;
    this.lastScale = scale;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const z = new THREE.Vector3(0, 0, 1);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    this.items.forEach((eq, i) => {
      latLonToVec3(eq.lat, eq.lon, SURFACE, p);
      q.setFromUnitVectors(z, p.clone().normalize());
      // geometri yarıçapı 1; dolu daire 0.4'te, dışı nabız halkasına ayrılmış
      const r = (magnitudeRadius(eq.magnitude) / 0.4) * scale;
      s.set(r, r, r);
      m.compose(p, q, s);
      this.mesh!.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  forEachPickable(cb: (index: number, pos: THREE.Vector3) => void) {
    if (!this.group.visible) return;
    const p = new THREE.Vector3();
    // büyükten küçüğe — üst üste binenlerde büyük olan öne geçsin
    for (let i = this.items.length - 1; i >= 0; i--) {
      latLonToVec3(this.items[i].lat, this.items[i].lon, SURFACE, p);
      cb(i, p);
    }
  }

  positionOf(index: number, out: THREE.Vector3) {
    const q = this.items[index];
    if (!q) return false;
    latLonToVec3(q.lat, q.lon, SURFACE, out);
    return true;
  }

  select(index: number | null) {
    this.selected = index;
    this.applySelection();
  }

  private applySelection() {
    if (!this.mesh) return;
    const attr = this.mesh.geometry.getAttribute('aSelected') as THREE.InstancedBufferAttribute;
    (attr.array as Float32Array).fill(0);
    if (this.selected !== null && this.selected < attr.count) attr.setX(this.selected, 1);
    attr.needsUpdate = true;
  }

  label(i: number) {
    const q = this.items[i];
    return q ? `M${q.magnitude.toFixed(1)} · ${q.place}` : '';
  }

  keyOf(i: number) {
    return this.items[i]?.id ?? '';
  }

  indexOfKey(key: string) {
    return this.items.findIndex((q) => q.id === key);
  }
}
