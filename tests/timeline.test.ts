import { describe, expect, it } from 'vitest';
import { Timeline } from '../src/lib/timeline.ts';

describe('Timeline', () => {
  const make = () => {
    const t = new Timeline();
    t.setRange(1000, 21000);
    t.sweepSeconds = 10;
    return t;
  };

  it('oynatınca aralığı sweepSeconds sürede tarar ve sonda durur', () => {
    const t = make();
    t.seek(0);
    t.play();
    t.step(5);
    expect(t.fraction).toBeCloseTo(0.5);
    t.step(10);
    expect(t.cursor).toBe(21000);
    expect(t.playing).toBe(false);
  });

  it('sondayken oynat baştan başlatır', () => {
    const t = make();
    t.seek(1);
    t.play();
    expect(t.cursor).toBe(1000);
    expect(t.playing).toBe(true);
  });

  it('duraklatılmışken ilerlemez', () => {
    const t = make();
    t.seek(0.25);
    t.step(3);
    expect(t.fraction).toBeCloseTo(0.25);
  });

  it('seek sınırları korur, setRange imleci aralıkta tutar', () => {
    const t = make();
    t.seek(2);
    expect(t.cursor).toBe(21000);
    t.setRange(0, 5000);
    expect(t.cursor).toBe(5000);
    t.setRange(8000, 9000);
    expect(t.cursor).toBe(8000);
  });

  it('boş aralıkta güvenli davranır', () => {
    const t = new Timeline();
    t.play();
    t.step(1);
    expect(t.fraction).toBe(1);
  });
});
