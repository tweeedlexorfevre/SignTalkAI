import { describe, it, expect } from 'vitest';
import fixture from '../../../shared/fixtures/krsl-features.json';
import { krslFeatures } from './krsl-features';
import { putRgbFrame, topGuesses } from './local-model';
describe('native language model input contracts', () => {
  it('matches the KRSL training preprocessor on real upstream coordinates', () => {
    const result = krslFeatures(fixture.tokens);
    expect(result).not.toBeNull();
    expect(result?.length).toBe(168);
    if (!result) throw Error('Expected KRSL features');
    result.forEach((v, i) => {
      expect(Math.abs(v - (fixture.features[i] ?? NaN))).toBeLessThan(2e-5);
    });
  });
  it('rejects absent or degenerate hands rather than predicting from zero features', () => {
    expect(krslFeatures([])).toBeNull();
    expect(krslFeatures([Array.from({ length: 21 }, () => [0, 0])])).toBeNull();
  });
  it('keeps RGB channels and time positions in Easy Sign NCTHW order', () => {
    const data = new Float32Array(3 * 2 * 2);
    putRgbFrame(data, new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 64, 255]), 1, 2, 2);
    expect(Array.from(data.slice(0, 4))).toEqual([0, 0, 1, 0]);
    expect(Array.from(data.slice(4, 8))).toEqual([0, 0, 0, 1]);
    expect(data[10]).toBeCloseTo(128 / 255);
    expect(data[11]).toBeCloseTo(64 / 255);
  });
  it('normalizes logits stably and rejects nonfinite output', () => {
    const top = topGuesses(new Float32Array([1001, 1000, -900]));
    expect(top[0]?.index).toBe(0);
    expect(top[0]?.probability).toBeCloseTo(0.7310586);
    expect(() => topGuesses(new Float32Array([NaN]))).toThrow();
  });
});
