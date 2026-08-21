import { describe, expect, it } from 'vitest';
import { auditedRoll, seededUnit, weightedSelection } from '../src/core/seeded-random';

describe('keyed seeded randomness', () => {
  it('reproduces keyed rolls and changes them with the seed', () => {
    expect(seededUnit('SAME', 'coach:1')).toBe(seededUnit('SAME', 'coach:1'));
    expect(seededUnit('OTHER', 'coach:1')).not.toBe(seededUnit('SAME', 'coach:1'));
  });

  it('retains exact probability and roll evidence', () => {
    expect(auditedRoll('SEED', 'event', 0)).toMatchObject({ probability: 0, selected: false });
    expect(auditedRoll('SEED', 'event', 1)).toMatchObject({ probability: 1, selected: true });
  });

  it('selects a fixed weighted allowance without choosing zero-weight candidates', () => {
    const candidates = [{ id: 'a', weight: 4 }, { id: 'b', weight: 2 }, { id: 'c', weight: 0 }, { id: 'd', weight: 1 }];
    const first = weightedSelection('SEASON', 'unexpected-scenarios', candidates, 2);
    const second = weightedSelection('SEASON', 'unexpected-scenarios', candidates, 2);

    expect(second).toEqual(first);
    expect(first.filter((candidate) => candidate.selected)).toHaveLength(2);
    expect(first.find((candidate) => candidate.id === 'c')).toMatchObject({ priority: null, selected: false });
  });
});
