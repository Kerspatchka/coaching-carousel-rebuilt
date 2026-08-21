import { describe, expect, it } from 'vitest';
import type { DynastySnapshot } from '../src/core/dynasty';
import { initializeMarket, MarketInitializationError } from '../src/core/market';

const snapshot = (): DynastySnapshot => ({
  sourceFingerprint: 'A'.repeat(64),
  seasonYear: 2026,
  conferences: [],
  teams: [{
    id: 'team:1',
    staff: { headCoachId: 'coach:1', offensiveCoordinatorId: 'coach:2', defensiveCoordinatorId: 'coach:3' }
  }],
  coaches: [
    { id: 'coach:1', role: 'HeadCoach', employerTeamId: 'team:1', userControlled: true },
    { id: 'coach:2', role: 'OffensiveCoordinator', employerTeamId: 'team:1', userControlled: false },
    { id: 'coach:3', role: 'DefensiveCoordinator', employerTeamId: 'team:1', userControlled: false }
  ],
  openings: [{
    id: 'opening:1', teamId: 'team:1', role: 'HeadCoach', previousCoachId: 'coach:1', selectedCoachId: 'coach:1', reason: 'ContractExtension', finalContractProgramPoints: 120
  }],
  nativeOffers: [],
  staffMoves: [],
  integrity: { valid: true, checks: 10, errors: 0, warnings: 0, findings: [] }
} as unknown as DynastySnapshot);

describe('deterministic market initialization', () => {
  it('creates one unique seat per Team role and retains native outcomes only as evidence', () => {
    const result = initializeMarket(snapshot(), 'CCR-TEST-SEED');

    expect(result.status).toBe('initialized');
    expect(result.seats).toHaveLength(3);
    expect(result.invariants).toEqual({ valid: true, expectedSeatCount: 3, uniqueIncumbentCount: 3 });
    expect(result.userCoachIds).toEqual(['coach:1']);
    expect(result.userTeamIds).toEqual(['team:1']);
    expect(result.nativeOutcomeEvidence[0]).toMatchObject({ selectedCoachId: 'coach:1', finalContractProgramPoints: 120 });
  });

  it('is reproducible for the same seed and changes deterministic ranks for a different seed', () => {
    const first = initializeMarket(snapshot(), 'SAME');
    const second = initializeMarket(snapshot(), 'SAME');
    const different = initializeMarket(snapshot(), 'DIFFERENT');

    expect(second).toEqual(first);
    expect(different.seats.map((seat) => seat.seededTiebreaker)).not.toEqual(first.seats.map((seat) => seat.seededTiebreaker));
  });

  it('fails closed when one Coach occupies multiple staff seats', () => {
    const invalid = snapshot();
    invalid.teams[0]!.staff.defensiveCoordinatorId = 'coach:2';

    expect(() => initializeMarket(invalid, 'CCR-TEST-SEED')).toThrow(MarketInitializationError);
  });
});
