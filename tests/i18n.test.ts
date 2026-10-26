import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dictionaries, t, type Key } from '../src/i18n.ts';

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n sözlükleri', () => {
  const trKeys = Object.keys(dictionaries.tr) as Key[];

  it('her anahtarın iki dilde de boş olmayan karşılığı var', () => {
    expect(Object.keys(dictionaries.en).sort()).toEqual([...trKeys].sort());
    for (const k of trKeys) {
      expect(dictionaries.tr[k].trim(), k).not.toBe('');
      expect(dictionaries.en[k].trim(), k).not.toBe('');
    }
  });

  it('yer tutucular ({ad}) iki dilde birebir aynı', () => {
    for (const k of trKeys) expect(vars(dictionaries.en[k]), k).toEqual(vars(dictionaries.tr[k]));
  });

  it('İngilizce metinlerde Türkçe karakter kalmamış', () => {
    const allowed = new Set(['app.language']); // "click for Türkçe"
    for (const k of trKeys) {
      if (!allowed.has(k)) expect(dictionaries.en[k], k).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
    }
  });

  it('HTML’deki her data-i18n anahtarı sözlükte tanımlı', () => {
    const html = readFileSync('index.html', 'utf8');
    const keys = [
      ...[...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap((m) => m[1].split(';').map((p) => p.split(':')[1])),
    ];
    expect(keys.length).toBeGreaterThan(50);
    for (const k of keys) expect(trKeys, k).toContain(k);
  });

  it('t() yer tutucuları doldurur (Node ortamında varsayılan dil Türkçe)', () => {
    expect(t('tl.count', { n: 42 })).toBe('42 deprem');
    expect(t('status.line', { state: 'Güncel', ago: 'şimdi' })).toBe('Güncel · veri şimdi');
  });
});
