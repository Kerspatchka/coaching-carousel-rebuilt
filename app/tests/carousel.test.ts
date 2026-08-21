import { describe, expect, it } from 'vitest';
import { createFixtureState, recordUserCoachDecision, revealResults, submitUserOffer } from '../src/core/carousel';

describe('fixture-driven Part 2 vertical slice', () => {
  it('moves from a final user offer to Coach decisions', () => {
    const next = submitUserOffer(createFixtureState(), 3, 130);
    expect(next.turn).toBe('coach-decisions');
    expect(next.offers).toContainEqual(expect.objectContaining({ coachId: 'navarro', years: 3, points: 130 }));
  });

  it('requires a user Coach decision before revealing results', () => {
    const state = submitUserOffer(createFixtureState(), 3, 130);
    expect(() => revealResults(state)).toThrow(/decision is required/i);
  });

  it('creates cascading vacancies from both accepted hires', () => {
    let state = submitUserOffer(createFixtureState(), 3, 130);
    state = recordUserCoachDecision(state, 'accept');
    state = revealResults(state);

    expect(state.filled).toHaveLength(2);
    expect(state.openings.filter((opening) => opening.status === 'new').map((opening) => opening.id)).toEqual([
      'louisiana-tech-oc',
      'alabama-hc'
    ]);
  });

  it('keeps the CPU opening unresolved when the user Coach rejects it', () => {
    let state = submitUserOffer(createFixtureState(), 3, 130);
    state = recordUserCoachDecision(state, 'reject');
    state = revealResults(state);

    expect(state.filled).toHaveLength(1);
    expect(state.openings.find((opening) => opening.id === 'air-force-hc')?.status).toBe('waiting');
  });
});
