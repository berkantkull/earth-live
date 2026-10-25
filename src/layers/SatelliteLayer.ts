import * as THREE from 'three';
import type { SatRec } from '../lib/sgp4.ts';
import { makeSatrec, orbitPath } from '../lib/orbits.ts';
import { ORBIT_COLORS } from '../lib/scales.ts';
import type { SatelliteTle } from '../lib/types.ts';
import type { SatWorkerIn, SatWorkerOut } from '../workers/satWorker.ts';
import type { Layer } from './Layer.ts';

/** Worker her istekte [t, t+STEP] konumlarını hesaplar; arada GPU doğrusal enterpolasyon yapar. */
const STEP_MS = 2000;

const vertex = /* glsl */ `
  attribute vec3 p1;
  attribute float aClass;
  attribute float aValid;
  uniform float uMix;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uSelected;
  uniform vec3 uColors[4];
  varying vec3 vColor;
  varying float vSel;
  void main() {
    vec3 p = mix(position, p1, uMix);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    int c = int(aClass + 0.5);
    vColor = c == 0 ? uColors[0] : c == 1 ? uColors[1] : c == 2 ? uColors[2] : uColors[3];
    vSel = abs(float(gl_VertexID) - uSelected) < 0.5 ? 1.0 : 0.0;
    float size = uSize * (vSel > 0.5 ? 2.6 : 1.0);
    gl_PointSize = aValid > 0.5 ? size * uPixelRatio : 0.0;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vSel;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float core = 1.0 - smoothstep(0.35, 0.75, r);
    float halo = (1.0 - r) * 0.5;
    vec3 col = vSel > 0.5 ? vec3(1.0) : vColor;
    gl_FragColor = vec4(col, max(core, halo));
    #include <colorspace_fragment>
  }
`;

export class SatelliteLayer implements Layer {
  readonly id = 'satellites' as const;
  readonly group = new THREE.Group();
  private tles: SatelliteTle[] = [];
  /** SGP4 kayıtları yalnızca seçilen uydular için ana iş parçacığında, ihtiyaç anında oluşturulur */
  private recs = new Map<number, SatRec | null>();
  private classes: Uint8Array = new Uint8Array(0);
  private worker: Worker;
  private points: THREE.Points | null = null;
  private readonly material: THREE.ShaderMaterial;
  private t0 = 0;
  private t1 = 0;
  private p0: Float32Array = new Float32Array(0);
  private p1: Float32Array = new Float32Array(0);
  private valid = new Float32Array(0);
  private requestId = 0;
  private pending = false;
  private selected: number | null = null;
  private orbitLine: THREE.Line | null = null;
  private orbitComputedAt = 0;
  private validCount = 0;
  onLoaded?: (count: number) => void;

  constructor() {
    this.group.name = 'satellites';
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uMix: { value: 0 },
        uSize: { value: 3 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uSelected: { value: -1 },
        uColors: {
          value: [ORBIT_COLORS.LEO, ORBIT_COLORS.MEO, ORBIT_COLORS.GEO, ORBIT_COLORS.HEO].map((c) => new THREE.Color(c)),
        },
      },
      transparent: true,
      depthWrite: false,
    });
    this.worker = new Worker(new URL('../workers/satWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<SatWorkerOut>) => this.onWorker(ev.data);
  }

  get visibleCount() {
    return this.validCount;
  }

  get data(): readonly SatelliteTle[] {
    return this.tles;
  }

  item(i: number) {
    return this.tles[i];
  }

  satrec(i: number) {
    if (!this.tles[i]) return null;
    let rec = this.recs.get(i);
    if (rec === undefined) {
      rec = makeSatrec(this.tles[i]);
      this.recs.set(i, rec);
    }
    return rec;
  }

  orbitClassOf(i: number): keyof typeof ORBIT_COLORS {
    return (['LEO', 'MEO', 'GEO', 'HEO'] as const)[this.classes[i] ?? 0];
  }

  setVisible(on: boolean) {
    this.group.visible = on;
  }

  setData(tles: SatelliteTle[]) {
    const selKey = this.selected !== null ? this.keyOf(this.selected) : null;
    this.tles = tles;
    this.recs.clear();
    this.validCount = 0;
    this.pending = false;
    this.requestId++;
    this.t0 = this.t1 = 0;
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      this.points = null;
    }
    this.select(null);
    const msg: SatWorkerIn = { type: 'load', tles };
    this.worker.postMessage(msg);
    if (selKey) this.pendingSelectKey = selKey;
  }

  private pendingSelectKey: string | null = null;
  onSelectionRestored?: (index: number) => void;

  private onWorker(msg: SatWorkerOut) {
    if (msg.type === 'loaded') {
      this.classes = msg.classes;
      this.requestPositions(Date.now());
      return;
    }
    if (msg.id !== this.requestId) return;
    this.pending = false;
    const n = this.tles.length;
    const valid = new Float32Array(n);
    let ok = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const good = Number.isFinite(msg.p0[o]) && Number.isFinite(msg.p1[o]) && msg.p0[o] * msg.p0[o] < 1e4;
      if (!good) {
        msg.p0[o] = msg.p0[o + 1] = msg.p0[o + 2] = 0;
        msg.p1[o] = msg.p1[o + 1] = msg.p1[o + 2] = 0;
      } else ok++;
      valid[i] = good ? 1 : 0;
    }
    this.p0 = msg.p0;
    this.p1 = msg.p1;
    this.valid = valid;
    this.t0 = msg.t0;
    this.t1 = msg.t1;
    const first = !this.points;
    this.validCount = ok;
    this.ensurePoints();
    if (first) {
      this.onLoaded?.(ok);
      if (this.pendingSelectKey) {
        const idx = this.indexOfKey(this.pendingSelectKey);
        this.pendingSelectKey = null;
        if (idx >= 0) this.onSelectionRestored?.(idx);
      }
    }
  }

  private ensurePoints() {
    const n = this.tles.length;
    if (!this.points) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.p0, 3));
      geo.setAttribute('p1', new THREE.BufferAttribute(this.p1, 3));
      geo.setAttribute('aValid', new THREE.BufferAttribute(this.valid, 1));
      const cls = new Float32Array(n);
      for (let i = 0; i < n; i++) cls[i] = this.classes[i] ?? 0;
      geo.setAttribute('aClass', new THREE.BufferAttribute(cls, 1));
      this.points = new THREE.Points(geo, this.material);
      this.points.frustumCulled = false;
      this.points.renderOrder = 5;
      this.group.add(this.points);
    } else {
      const geo = this.points.geometry;
      (geo.getAttribute('position') as THREE.BufferAttribute).array = this.p0;
      (geo.getAttribute('p1') as THREE.BufferAttribute).array = this.p1;
      (geo.getAttribute('aValid') as THREE.BufferAttribute).array = this.valid;
      geo.getAttribute('position').needsUpdate = true;
      geo.getAttribute('p1').needsUpdate = true;
      geo.getAttribute('aValid').needsUpdate = true;
    }
  }

  private requestPositions(t: number) {
    if (this.pending || this.tles.length === 0) return;
    this.pending = true;
    const msg: SatWorkerIn = { type: 'propagate', id: this.requestId, t0: t, t1: t + STEP_MS };
    this.worker.postMessage(msg);
  }

  private mixAt(now: number) {
    if (this.t1 <= this.t0) return 0;
    return Math.min(1, Math.max(0, (now - this.t0) / (this.t1 - this.t0)));
  }

  update(zoomScale: number, now: number) {
    if (!this.points) {
      return;
    }
    const mix = this.mixAt(now);
    this.material.uniforms.uMix.value = mix;
    this.material.uniforms.uSize.value = Math.min(4.2, Math.max(2.2, 4.4 - zoomScale * 1.2));
    // bir sonraki aralığı erkenden iste
    if (now > this.t0 + STEP_MS * 0.6) this.requestPositions(Math.max(now, this.t1));
    if (this.selected !== null && this.orbitLine && now - this.orbitComputedAt > 60_000) this.buildOrbit(this.selected);
  }

  forEachPickable(cb: (index: number, pos: THREE.Vector3) => void) {
    if (!this.group.visible || !this.points) return;
    const p = new THREE.Vector3();
    const mix = this.mixAt(Date.now());
    for (let i = 0; i < this.tles.length; i++) {
      if (!this.valid[i]) continue;
      this.lerpInto(i, mix, p);
      cb(i, p);
    }
  }

  private lerpInto(i: number, mix: number, out: THREE.Vector3) {
    const o = i * 3;
    out.set(
      this.p0[o] + (this.p1[o] - this.p0[o]) * mix,
      this.p0[o + 1] + (this.p1[o + 1] - this.p0[o + 1]) * mix,
      this.p0[o + 2] + (this.p1[o + 2] - this.p0[o + 2]) * mix,
    );
  }

  positionOf(index: number, out: THREE.Vector3) {
    if (!this.valid[index]) return false;
    this.lerpInto(index, this.mixAt(Date.now()), out);
    return true;
  }

  select(index: number | null) {
    this.selected = index;
    this.material.uniforms.uSelected.value = index ?? -1;
    if (this.orbitLine) {
      this.group.remove(this.orbitLine);
      this.orbitLine.geometry.dispose();
      this.orbitLine = null;
    }
    if (index !== null) this.buildOrbit(index);
  }

  private buildOrbit(index: number) {
    const rec = this.satrec(index);
    if (!rec) return;
    const path = orbitPath(rec, new Date(), 360);
    const cls = this.orbitClassOf(index);
    if (this.orbitLine) {
      this.group.remove(this.orbitLine);
      this.orbitLine.geometry.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(path, 3));
    // geçmiş yarı soluk, gelecek yarı parlak
    const alpha = new Float32Array(path.length / 3);
    for (let i = 0; i < alpha.length; i++) alpha[i] = i < alpha.length / 2 ? 0.25 : 0.9;
    geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA); }`,
      uniforms: { color: { value: new THREE.Color(ORBIT_COLORS[cls]) } },
      transparent: true,
      depthWrite: false,
    });
    this.orbitLine = new THREE.Line(geo, mat);
    this.orbitLine.frustumCulled = false;
    this.group.add(this.orbitLine);
    this.orbitComputedAt = Date.now();
  }

  label(i: number) {
    const s = this.tles[i];
    return s ? `${s.name} · NORAD ${s.norad}` : '';
  }

  keyOf(i: number) {
    return String(this.tles[i]?.norad ?? '');
  }

  indexOfKey(key: string) {
    return this.tles.findIndex((s) => String(s.norad) === key);
  }
}
