import * as THREE from 'three';

const supportsBitmap = typeof createImageBitmap === 'function';

/**
 * Dokuyu yükler. Mümkünse görseli createImageBitmap ile ana iş parçacığı dışında çözer;
 * böylece büyük dokular ilk karede tarayıcıyı dondurmaz.
 */
export async function loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
  let tex: THREE.Texture;
  if (supportsBitmap) {
    try {
      const loader = new THREE.ImageBitmapLoader();
      loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
      const bitmap = await loader.loadAsync(url);
      tex = new THREE.Texture(bitmap as ImageBitmap);
      tex.flipY = false;
    } catch {
      tex = await new THREE.TextureLoader().loadAsync(url);
    }
  } else {
    tex = await new THREE.TextureLoader().loadAsync(url);
  }
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Asıl doku gelene kadar kullanılan 1×1 tek renk doku */
export function solidTexture(r: number, g: number, b: number, srgb = false): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Tarayıcı boştayken çalıştır (yoksa kısa gecikmeyle) */
export function whenIdle(timeout = 1500): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 200);
  });
}
