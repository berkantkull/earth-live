import type * as THREE from 'three';

export type LayerId = 'earthquakes' | 'aircraft' | 'satellites' | 'plates' | 'fires' | 'events';

/** Ekran-uzayı seçim (picking) ve detay paneli için ortak katman arayüzü. */
export interface Layer {
  readonly id: LayerId;
  readonly group: THREE.Object3D;
  /** Görünür (filtrelerden geçmiş) nesne sayısı */
  readonly visibleCount: number;
  setVisible(on: boolean): void;
  /** Seçilebilir her nesne için sahne konumu ile cb çağırır */
  forEachPickable(cb: (index: number, pos: THREE.Vector3) => void): void;
  /** index'li nesnenin şimdiki sahne konumu; yoksa false */
  positionOf(index: number, out: THREE.Vector3): boolean;
  /** Seçili nesneyi işaretle (veya null ile temizle) */
  select(index: number | null): void;
  /** Kısa etiket (hover tooltip) */
  label(index: number): string;
  /** Kalıcı kimlik — veri yenilenince seçimi korumak için */
  keyOf(index: number): string;
  indexOfKey(key: string): number;
}
