/// <reference lib="webworker" />
import type { SatRec } from '../lib/sgp4.ts';
import { makeSatrec, orbitalElements, ORBIT_CLASS_INDEX, propagateAll } from '../lib/orbits.ts';
import type { SatelliteTle } from '../lib/types.ts';

export type SatWorkerIn =
  | { type: 'load'; tles: SatelliteTle[] }
  | { type: 'propagate'; id: number; t0: number; t1: number };

export type SatWorkerOut =
  | { type: 'loaded'; count: number; valid: number; classes: Uint8Array }
  | { type: 'positions'; id: number; t0: number; t1: number; p0: Float32Array; p1: Float32Array; ok: number };

let recs: (SatRec | null)[] = [];

self.onmessage = (ev: MessageEvent<SatWorkerIn>) => {
  const msg = ev.data;
  if (msg.type === 'load') {
    recs = msg.tles.map(makeSatrec);
    const classes = new Uint8Array(recs.length);
    let valid = 0;
    recs.forEach((r, i) => {
      if (!r) return;
      valid++;
      classes[i] = ORBIT_CLASS_INDEX[orbitalElements(r).orbitClass];
    });
    const out: SatWorkerOut = { type: 'loaded', count: recs.length, valid, classes };
    self.postMessage(out, { transfer: [classes.buffer] });
    return;
  }
  if (msg.type === 'propagate') {
    const p0 = new Float32Array(recs.length * 3);
    const p1 = new Float32Array(recs.length * 3);
    const ok = propagateAll(recs, new Date(msg.t0), p0);
    propagateAll(recs, new Date(msg.t1), p1);
    const out: SatWorkerOut = { type: 'positions', id: msg.id, t0: msg.t0, t1: msg.t1, p0, p1, ok };
    self.postMessage(out, { transfer: [p0.buffer, p1.buffer] });
  }
};
