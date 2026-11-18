import { describe, expect, it } from 'vitest';
import { EMPTY_SPELL, editSpell, spellStep, type SpellState } from './fingerspell';
import { letterbox, putBukvaFrame, topGuesses } from './local-model';

const run = (labels: (string | null)[], confirm = 2) =>
  labels.reduce<SpellState>((s, l) => spellStep(s, l, confirm), EMPTY_SPELL).text;

describe('spellStep', () => {
  it('writes a letter after it is confirmed', () => {
    expect(run(['А'])).toBe('');
    expect(run(['А', 'А'])).toBe('А');
  });
  it('does not repeat a held letter', () => {
    expect(run(['А', 'А', 'А', 'А', 'А'])).toBe('А');
  });
  it('needs a pause to repeat a letter', () => {
    expect(run(['А', 'А', null, null, 'А', 'А'])).toBe('АА');
    expect(run(['А', 'А', null, 'А', 'А'])).toBe('А');
  });
  it('ignores single-window flicker', () => {
    expect(run(['М', 'М', 'Л', 'М', 'А', 'А'])).toBe('МА');
  });
  it('writes every window when confirm is 1', () => {
    expect(run(['К', 'О', 'Т'], 1)).toBe('КОТ');
  });
});

describe('editSpell', () => {
  it('edits text without resetting the detector', () => {
    let s = spellStep(spellStep(EMPTY_SPELL, 'Д'), 'Д');
    s = editSpell(s, 'space');
    s = editSpell(s, 'space');
    expect(s.text).toBe('Д ');
    s = editSpell(s, 'backspace');
    expect(s.text).toBe('Д');
    expect(spellStep(s, 'Д').text).toBe('Д');
    s = editSpell(s, { add: 'А' });
    expect(s.text).toBe('ДА');
    expect(editSpell(s, 'clear')).toEqual(EMPTY_SPELL);
  });
  it('does not start with a space', () => {
    expect(editSpell(EMPTY_SPELL, 'space').text).toBe('');
  });
});

describe('Bukva preprocessing', () => {
  it('normalises RGB with ImageNet mean/std into T,C,H,W', () => {
    const pixels = 2;
    const target = new Float32Array(3 * 2 * pixels);
    const rgba = new Uint8ClampedArray([123, 116, 103, 255, 255, 255, 255, 255]);
    putBukvaFrame(target, rgba, 1, pixels, 2);
    expect(Array.from(target.slice(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(target[6]).toBeCloseTo((123 - 123.675) / 58.395);
    expect(target[7]).toBeCloseTo((255 - 123.675) / 58.395);
    expect(target[8]).toBeCloseTo((116 - 116.28) / 57.12);
    expect(target[10]).toBeCloseTo((103 - 103.53) / 57.375);
  });
  it('letterboxes like the upstream demo', () => {
    expect(letterbox(640, 480)).toEqual({ x: 0, y: 28, w: 224, h: 168 });
    expect(letterbox(1080, 1920)).toEqual({ x: 49, y: 0, w: 126, h: 224 });
  });
  it('keeps probabilities as they are', () => {
    const probs = new Float32Array([0.1, 0.7, 0.2]);
    const top = topGuesses(probs, true);
    expect(top[0]?.index).toBe(1);
    expect(top[0]?.probability).toBeCloseTo(0.7);
  });
});
