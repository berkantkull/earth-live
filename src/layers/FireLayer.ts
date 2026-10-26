import * as THREE from 'three';
import { t } from '../i18n.ts';
import { num } from '../lib/format.ts';
import { latLonToVec3 } from '../lib/geo.ts';
import { FRP_STOPS, stopColor } from '../lib/scales.ts';
import type { Fire } from '../lib/types.ts';
import type { Layer } from './Layer.ts';

/** Bulutların üstünde, deprem işaretlerinin hemen altında */
const RADIUS = 1.0075;

const vertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  uniform float uPixelRatio;
  uniform float uSelected;
  varying vec3 vColor;
  varying float vSel;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vSel = abs(float(gl_VertexID) - uSelected) < 0.5 ? 1.0 : 0.0;
    vColor = aColor;
    gl_PointSize = (aSize * uScale + vSel * 8.0) * uPixelRatio;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vSel;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    // sıcak çekirdek + yumuşak parıltı
    float core = 1.0 - smoothstep(0.0, 0.45, r);
    float glow = pow(1.0 - r, 2.0) * 0.6;
    vec3 col = mix(vColor, vec3(1.0, 0.85, 0.6), core * 0.45);
    if (vSel > 0.5) {
      float ring = 1.0 - smoothstep(0.0, 0.08, abs(r - 0.85));
      col = mix(col, vec3(1.0), ring);
      glow = max(glow, ring);
    }
    gl_FragColor = vec4(col, max(core, glow));
    #include <colorspace_fragment>
  }
`;

/** FRP (MW) → piksel boyutu; logaritmik, çünkü FRP 1 ile 4000 MW arasında değişir */
export function fireSize(frp: number): number {
  return 2.2 + Math.log10(1 + Math.max(0, frp)) * 2.4;
}

export class FireLayer implements Layer {
  readonly id = 'fires' as const;
  readonly group = new THREE.Group();
  private items: Fire[] = [];
  private positions = new Float32Array(0);
  private points: THREE.Points | null = null;
  private selectedKey: string | null = null;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.group.name = 'fires';
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uScale: { value: 1 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uSelected: { value: -1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  get visibleCount() {
    return this.items.length;
  }

  get data(): readonly Fire[] {
    return this.items;
  }

  item(i: number) {
    return this.items[i];
  }

  setVisible(on: boolean) {
    this.group.visible = on;
  }

  setData(fires: Fire[]) {
    const selKey = this.selectedKey;
    // küçükler önce, büyükler üstte çizilsin
    this.items = [...fires].sort((a, b) => a.frp - b.frp);
    const n = this.items.length;
    this.positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    this.items.forEach((f, i) => {
      latLonToVec3(f.lat, f.lon, RADIUS, v);
      this.positions.set([v.x, v.y, v.z], i * 3);
      c.set(stopColor(FRP_STOPS, f.frp));
      colors.set([c.r, c.g, c.b], i * 3);
      sizes[i] = fireSize(f.frp);
    });
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.group.add(this.points);
    this.select(selKey ? this.indexOfKey(selKey) : null);
  }

  update(zoomScale: number) {
    // yakınlaştıkça noktalar biraz büyüsün
    this.material.uniforms.uScale.value = Math.min(2.2, Math.max(0.8, 1.6 - zoomScale * 0.5));
  }

  forEachPickable(cb: (index: number, pos: THREE.Vector3) => void) {
    if (!this.group.visible) return;
    const v = new THREE.Vector3();
    // büyükten küçüğe: üst üste binenlerde güçlü olan seçilsin
    for (let i = this.items.length - 1; i >= 0; i--) {
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
    this.selectedKey = i !== null ? this.keyOf(i) : null;
    this.material.uniforms.uSelected.value = i ?? -1;
  }

  label(i: number) {
    const f = this.items[i];
    return f ? t('fire.label', { frp: num(f.frp, 1) }) : '';
  }

  keyOf(i: number) {
    const f = this.items[i];
    return f ? `${f.lat.toFixed(3)},${f.lon.toFixed(3)},${f.time}` : '';
  }

  indexOfKey(key: string) {
    return this.items.findIndex((_, i) => this.keyOf(i) === key);
  }
}
