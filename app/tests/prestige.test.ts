import { describe, expect, it } from 'vitest';
import { formatPrestigeGrade } from '../src/core/prestige';

describe('prestige grade display', () => {
  it('converts native word modifiers into compact grade symbols', () => {
    expect(formatPrestigeGrade('Aplus')).toBe('A+');
    expect(formatPrestigeGrade('Cminus')).toBe('C-');
    expect(formatPrestigeGrade('b_plus')).toBe('B+');
    expect(formatPrestigeGrade('D')).toBe('D');
  });

  it('preserves non-grade labels', () => {
    expect(formatPrestigeGrade('—')).toBe('—');
  });
});
