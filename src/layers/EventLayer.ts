import * as THREE from 'three';
import { latLonToVec3 } from '../lib/geo.ts';
import { densify } from '../lib/plates.ts';
import { eventColor } from '../lib/scales.ts';
import type { NaturalEvent } from '../lib/types.ts';
import type { Layer } from './Layer.ts';

const RADIUS = 1.009;

const vertex = /* glsl */ `
  attribute vec3 aColor;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uSelected;
  varying vec3 vColor;
  varying float vSel;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vSel = abs(float(gl_VertexID) - uSelected) < 0.5 ? 1.0 : 0.0;
    vColor = aColor;
    gl_PointSize = uSize * (vSel > 0.5 ? 1.5 : 1.0) * uPixelRatio;
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vSel;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    // koyu zeminli halka + merkez nokta: dikkat çekici ama haritayı örtmeyen işaret
    float dot = 1.0 - smoothstep(0.22, 0.3, r);
    float ring = 1.0 - smoothstep(0.0, 0.1, abs(r - 0.68));
    float pulse = 0.75 + 0.25 * sin(uTime * 2.5);
    float a = max(dot, ring * pulse);
    vec3 col = vColor;
    if (vSel > 0.5) {
      float outer = 1.0 - smoothstep(0.0, 0.06, abs(r - 0.93));
      a = max(a, outer);
      col = mix(col, vec3(1.0), outer);
    }
    a = max(a, 0.35 * (1.0 - smoothstep(0.6, 0.75, r)) * (1.0 - dot));
    col = mix(vec3(0.02, 0.04, 0.08), col, max(dot, ring));
    if (a < 0.02) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export class EventLayer implements Layer {
  readonly id = 'events' as const;
  readonly group = new THREE.Group();
  private items: NaturalEvent[] = [];
  private positions = new Float32Array(0);
  private points: THREE.Points | null = null;
  private track: THREE.Group | null = null;
  private selectedKey: string | null = null;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.group.name = 'events';
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uSize: { value: 18 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uSelected: { value: -1 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });
  }

  get visibleCount() {
    return this.items.length;
  }

  get data(): readonly NaturalEvent[] {
    return this.items;
  }

  item(i: number) {
    return this.items[i];
  }

  setVisible(on: boolean) {
    this.group.visible = on;
  }

  setData(events: NaturalEvent[]) {
    const selKey = this.selectedKey;
    this.items = events;
    const n = events.length;
    this.positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    events.forEach((e, i) => {
      latLonToVec3(e.lat, e.lon, RADIUS, v);
      this.positions.set([v.x, v.y, v.z], i * 3);
      c.set(eventColor(e.category));
      colors.set([c.r, c.g, c.b], i * 3);
    });
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.group.add(this.points);
    this.select(selKey ? this.indexOfKey(selKey) : null);
  }

  update(zoomScale: number, now: number) {
    this.material.uniforms.uTime.value = now / 1000;
    this.material.uniforms.uSize.value = Math.min(26, Math.max(14, 24 - zoomScale * 6));
  }

  forEachPickable(cb: (index: number, pos: THREE.Vector3) => void) {
    if (!this.group.visible) return;
    const v = new THREE.Vector3();
    for (let i = 0; i < this.items.length; i++) {
      v.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
      cb(i, v);
    }
  }

  positionOf(index: number, out: THREE.Vector3) {
    if (!this.items[index]) return false;
    out.set(this.positions[index * 3], this.positions[index * 3 + 1], this.positions[index * 3 + 2]);
    return true;
  }

  select(index: number | null) {
    const i = index !== null && index >= 0 ? index : null;
    this.selectedKey = i !== null ? this.items[i].id : null;
    this.material.uniforms.uSelected.value = i ?? -1;
    if (this.track) {
      this.group.remove(this.track);
      this.track.traverse((o) => {
        if (o instanceof THREE.Line || o instanceof THREE.Points) o.geometry.dispose();
      });
      this.track = null;
    }
    const e = i !== null ? this.items[i] : null;
    if (e && e.track.length > 1) this.buildTrack(e);
  }

  /** Fırtına gibi hareket eden olayların izi: çizgi + her gözlem noktası */
  private buildTrack(e: NaturalEvent) {
    const flat = e.track.flatMap(([lat, lon]) => [lat, lon]);
    const g = new THREE.Group();
    const color = new THREE.Color(eventColor(e.category));
    const v = new THREE.Vector3();
    for (const part of densify(flat, 0.5)) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < part.length; k += 2) pts.push(latLonToVec3(part[k], part[k + 1], RADIUS, new THREE.Vector3()) as THREE.Vector3);
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })));
    }
    const dots = e.track.map(([lat, lon]) => latLonToVec3(lat, lon, RADIUS, v.clone()) as THREE.Vector3);
    g.add(
      new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(dots),
        new THREE.PointsMaterial({ color, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.9 }),
      ),
    );
    this.track = g;
    this.group.add(g);
  }

  label(i: number) {
    return this.items[i]?.title ?? '';
  }

  keyOf(i: number) {
    return this.items[i]?.id ?? '';
  }

  indexOfKey(key: string) {
    return this.items.findIndex((e) => e.id === key);
  }
}
