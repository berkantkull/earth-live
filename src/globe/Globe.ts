import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { latLonToVec3, vec3ToLatLon } from '../lib/geo.ts';
import { subsolarPoint } from '../lib/sun.ts';
import {
  atmosphereFragment,
  atmosphereVertex,
  cloudFragment,
  cloudVertex,
  earthFragment,
  earthVertex,
  starFragment,
  starVertex,
} from './shaders.ts';
import { loadTexture, solidTexture, whenIdle } from './textures.ts';

const TEX = `${import.meta.env.BASE_URL}textures/`;
const ATMOSPHERE_RADIUS = 1.12;
const MIN_DISTANCE = 1.08;
const MAX_DISTANCE = 14;

export interface GlobeOptions {
  onProgress?: (loaded: number, total: number) => void;
}

interface FlyAnimation {
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromDist: number;
  toDist: number;
  start: number;
  duration: number;
}

export class Globe {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** Katmanların eklendiği, Dünya'ya sabit grup */
  readonly world = new THREE.Group();
  readonly sunDir = new THREE.Vector3(1, 0, 0);

  private readonly earthMat: THREE.ShaderMaterial;
  private readonly cloudMat: THREE.ShaderMaterial;
  private readonly atmoMat: THREE.ShaderMaterial;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly clouds: THREE.Mesh;
  private readonly atmosphere: THREE.Mesh;
  private fly: FlyAnimation | null = null;
  private readonly frameCallbacks: ((dt: number, now: number) => void)[] = [];
  private lastFrame = performance.now();
  private sunUpdatedAt = 0;
  private autoRotateResumeAt = 0;
  private maxAniso = 1;
  private hiResReady = false;
  private ultraRequested = false;
  autoRotate = true;

  constructor(container: HTMLElement, opts: GlobeOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.001, 200);
    // İlk açılışta gündüz tarafından akşam sınırına (terminatöre) doğru bak:
    // hem aydınlık kıtalar hem şehir ışıkları görünür
    const sun = subsolarPoint(new Date());
    const start = latLonToVec3(28, sun.lon + 55, 3.4);
    this.camera.position.set(start.x, start.y, start.z);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = MIN_DISTANCE;
    this.controls.maxDistance = MAX_DISTANCE;
    this.controls.rotateSpeed = 0.45;
    this.controls.zoomSpeed = 0.8;
    this.controls.autoRotateSpeed = 0.35; // ≈ 3 dakikada bir tur: fark edilir ama sakin
    this.controls.addEventListener('start', () => {
      this.fly = null;
      this.pauseAutoRotate(12000);
    });

    // Asıl dokular gelene kadar yer tutucular: sahne hemen çizilebilir
    const day = solidTexture(18, 44, 82, true);
    const night = solidTexture(0, 0, 0, true);
    const spec = solidTexture(0, 0, 0);
    const normal = solidTexture(128, 128, 255);
    const cloud = solidTexture(0, 0, 0);
    this.maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
      uniforms: {
        dayMap: { value: day },
        nightMap: { value: night },
        specMap: { value: spec },
        normalMap: { value: normal },
        cloudMap: { value: cloud },
        sunDir: { value: this.sunDir },
        cloudOffset: { value: 0 },
        realLighting: { value: 1 },
        nightIntensity: { value: 1.6 },
      },
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), this.earthMat);
    earth.name = 'earth';
    this.scene.add(earth);

    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: cloudVertex,
      fragmentShader: cloudFragment,
      uniforms: {
        cloudMap: { value: cloud },
        sunDir: { value: this.sunDir },
        cloudOffset: { value: 0 },
        realLighting: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.006, 128, 64), this.cloudMat);
    this.scene.add(this.clouds);

    this.atmoMat = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      uniforms: {
        sunDir: { value: this.sunDir },
        realLighting: { value: 1 },
        limbDot: { value: Math.sqrt(1 - 1 / (ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS)) },
      },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 96, 48), this.atmoMat);
    this.scene.add(this.atmosphere);

    this.starMat = this.createStars();
    this.scene.add(this.world);

    this.updateSun(Date.now());
    window.addEventListener('resize', () => this.resize(container));
    this.renderer.setAnimationLoop(() => this.frame());
    void this.loadTextures(opts);
  }

  /**
   * Kademeli doku yükleme:
   *  1) 2K gündüz + gece (~200 KB) → yükleme ekranı kapanır
   *  2) bulut, normal, speküler, yıldızlar
   *  3) tarayıcı boştayken 4K gündüz + gece
   *  4) 8K gündüz yalnızca kullanıcı yakınlaşınca (bkz. frame)
   */
  private async loadTextures(opts: GlobeOptions) {
    const u = this.earthMat.uniforms;
    let done = 0;
    const essential = (name: string, uniform: 'dayMap' | 'nightMap') =>
      this.texture(name, true).then((t) => {
        this.swap(u[uniform], t);
        opts.onProgress?.(++done, 2);
      });
    try {
      await Promise.all([essential('earth_day_2k.webp', 'dayMap'), essential('earth_night_2k.webp', 'nightMap')]);
    } catch (err) {
      console.error('Dünya dokuları yüklenemedi', err);
      opts.onProgress?.(2, 2);
    }

    await Promise.allSettled([
      this.texture('earth_clouds_2k.webp', false, true).then((t) => {
        this.swap(this.cloudMat.uniforms.cloudMap, t);
        if (this.clouds.visible) u.cloudMap.value = t;
      }),
      this.texture('earth_normal_2k.webp', false).then((t) => this.swap(u.normalMap, t)),
      this.texture('earth_specular_1k.webp', false).then((t) => this.swap(u.specMap, t)),
      this.texture('stars_milky_way_2k.webp', true).then((t) => this.addSky(t)),
    ]);

    if (this.renderer.capabilities.maxTextureSize < 4096) return;
    await whenIdle();
    await Promise.allSettled([
      this.texture('earth_day_4k.webp', true).then((t) => this.swap(u.dayMap, t)),
      this.texture('earth_night_4k.webp', true).then((t) => this.swap(u.nightMap, t)),
    ]);
    this.hiResReady = true;
  }

  /** repeatX: yatayda tekrarlı sarma (kayan bulutlar için); GPU'ya yüklemeden önce ayarlanmalı */
  private async texture(name: string, srgb: boolean, repeatX = false): Promise<THREE.Texture> {
    const t = await loadTexture(TEX + name, srgb);
    t.anisotropy = this.maxAniso;
    if (repeatX) t.wrapS = THREE.RepeatWrapping;
    // GPU'ya yüklemeyi şimdi yap: ilk kullanıldığı karede takılma olmasın
    this.renderer.initTexture(t);
    return t;
  }

  /** Uniform'daki dokuyu değiştirir, eskisini serbest bırakır */
  private swap(uniform: THREE.IUniform, next: THREE.Texture) {
    const prev = uniform.value as THREE.Texture | null;
    uniform.value = next;
    if (prev && prev !== next && prev !== this.cloudMat.uniforms.cloudMap.value) prev.dispose();
  }

  private maybeLoadUltraRes() {
    if (this.ultraRequested || !this.hiResReady) return;
    if (this.camera.position.length() > 1.75) return;
    if (this.renderer.capabilities.maxTextureSize < 8192) return;
    // dokunmatik/küçük cihazlarda 8K bellek ve bant genişliği israfı
    if (window.matchMedia('(pointer: coarse)').matches) return;
    this.ultraRequested = true;
    this.texture('earth_day_8k.webp', true)
      .then((t) => this.swap(this.earthMat.uniforms.dayMap, t))
      .catch(() => {});
  }

  private createStars(): THREE.ShaderMaterial {
    const count = 6000;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const twinkle = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // küre üzerinde düzgün dağılım
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = 80;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = r * s * Math.cos(t);
      pos[i * 3 + 1] = r * u;
      pos[i * 3 + 2] = r * s * Math.sin(t);
      size[i] = Math.pow(Math.random(), 6) * 2.6 + 0.6;
      twinkle[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('twinkle', new THREE.BufferAttribute(twinkle, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: starFragment,
      uniforms: { time: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(geo, mat);
    stars.renderOrder = -1;
    this.scene.add(stars);

    return mat;
  }

  /** Samanyolu arka planı */
  private addSky(t: THREE.Texture) {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(90, 64, 32),
      new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, color: 0x3a4250, depthWrite: false }),
    );
    sky.renderOrder = -2;
    this.scene.add(sky);
  }

  onFrame(cb: (dt: number, now: number) => void) {
    this.frameCallbacks.push(cb);
  }

  setRealLighting(on: boolean) {
    for (const m of [this.earthMat, this.cloudMat, this.atmoMat]) m.uniforms.realLighting.value = on ? 1 : 0;
  }

  setCloudsVisible(on: boolean) {
    this.clouds.visible = on;
    this.earthMat.uniforms.cloudMap.value = on ? this.cloudMat.uniforms.cloudMap.value : null;
  }

  setAtmosphereVisible(on: boolean) {
    this.atmosphere.visible = on;
  }

  pauseAutoRotate(ms: number) {
    this.autoRotateResumeAt = performance.now() + ms;
  }

  /** Kamerayı verilen koordinatın üzerine yumuşakça götürür */
  flyTo(lat: number, lon: number, distance?: number, duration = 1800) {
    const toDir = new THREE.Vector3().copy(latLonToVec3(lat, lon, 1) as THREE.Vector3).normalize();
    const fromDist = this.camera.position.length();
    const toDist = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE + 0.02, distance ?? Math.min(fromDist, 1.9)));
    this.fly = {
      from: this.camera.position.clone().normalize(),
      to: toDir,
      fromDist,
      toDist,
      start: performance.now(),
      duration,
    };
    this.pauseAutoRotate(duration + 15000);
  }

  /** Ekrandaki imleç altında Dünya yüzeyindeki coğrafi konum */
  pickSurface(ndcX: number, ndcY: number): { lat: number; lon: number } | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const sphere = new THREE.Sphere(new THREE.Vector3(), 1);
    const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3());
    return hit ? vec3ToLatLon(hit) : null;
  }

  /** Kamera uzaklığına bağlı ölçek; işaretçilerin ekranda sabite yakın boyda kalması için */
  get zoomScale(): number {
    return Math.max(0.12, this.camera.position.length() - 1) / 2.4;
  }

  private updateSun(now: number) {
    const s = subsolarPoint(new Date(now));
    const v = latLonToVec3(s.lat, s.lon, 1);
    this.sunDir.set(v.x, v.y, v.z).normalize();
    this.sunUpdatedAt = now;
  }

  get subsolar() {
    return vec3ToLatLon(this.sunDir);
  }

  private resize(container: HTMLElement) {
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const wall = Date.now();

    if (wall - this.sunUpdatedAt > 10_000) this.updateSun(wall);

    if (this.fly) {
      const t = Math.min(1, (now - this.fly.start) / this.fly.duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const dir = slerp(this.fly.from, this.fly.to, e);
      // yolun ortasında hafifçe uzaklaşarak "uçuş" hissi
      const lift = Math.sin(Math.PI * e) * Math.min(1.2, this.fly.from.angleTo(this.fly.to) * 0.6);
      const dist = this.fly.fromDist + (this.fly.toDist - this.fly.fromDist) * e + lift;
      this.camera.position.copy(dir.multiplyScalar(dist));
      if (t >= 1) this.fly = null;
    }

    this.controls.autoRotate = this.autoRotate && !this.fly && now > this.autoRotateResumeAt;
    // yakınlaştıkça döndürme hassasiyetini düşür
    const d = this.camera.position.length();
    this.controls.rotateSpeed = Math.min(0.6, 0.12 + (d - 1) * 0.22);
    this.controls.update(dt);
    this.maybeLoadUltraRes();

    const cloudShift = (wall / 1000 / 86400) * 0.6; // bulutlar çok yavaş kayar
    this.cloudMat.uniforms.cloudOffset.value = cloudShift % 1;
    this.earthMat.uniforms.cloudOffset.value = cloudShift % 1;
    this.starMat.uniforms.time.value = now / 1000;

    for (const cb of this.frameCallbacks) cb(dt, wall);
    this.renderer.render(this.scene, this.camera);
  }
}

function slerp(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const dot = Math.min(1, Math.max(-1, a.dot(b)));
  const theta = Math.acos(dot) * t;
  if (dot > 0.99999) return b.clone();
  let rel = b.clone().sub(a.clone().multiplyScalar(dot));
  if (rel.lengthSq() < 1e-10) {
    // tam karşıt noktalar: kutup ekseni etrafından dolaş
    rel = new THREE.Vector3(0, 1, 0).cross(a);
    if (rel.lengthSq() < 1e-10) rel.set(1, 0, 0);
  }
  rel.normalize();
  return a.clone().multiplyScalar(Math.cos(theta)).add(rel.multiplyScalar(Math.sin(theta)));
}
