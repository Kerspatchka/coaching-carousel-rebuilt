import { describe, expect, it } from 'vitest';
import type { DynastySnapshot, NormalizedCoach } from '../src/core/dynasty';
import { initializeMarket } from '../src/core/market';
import { planRetirements, RetirementPlanningError, type RetirementConfig } from '../src/core/retirements';

const certainConfig: RetirementConfig = {
  minimumAge: 61, baseProbabilityAtMinimumAge: 1, annualAgeIncrease: 0,
  losingSeasonBonus: 0, expiringContractBonus: 0, multiYearContractReduction: 0,
  longCareerThreshold: 30, longCareerBonusPerYear: 0, maximumLongCareerBonus: 0,
  retiringOnTopBonus: 0, maximumIndividualProbability: 1, maximumRetirements: 3,
  mandatoryRetirementAge: null
};

function fixture(): DynastySnapshot {
  const coach = (id: string, role: NormalizedCoach['role'], age: number): NormalizedCoach => ({
    id, role, employerTeamId: 'team:1', userControlled: false, age, yearsCoaching: 35,
    contract: { yearsRemaining: 1 }, resume: { season: { wins: 6, losses: 6, ties: 0 } }
  } as NormalizedCoach);
  return {
    sourceFingerprint: 'A'.repeat(64), seasonYear: 2026, conferences: [],
    teams: [{ id: 'team:1', staff: { headCoachId: 'coach:hc', offensiveCoordinatorId: 'coach:oc', defensiveCoordinatorId: 'coach:dc' } }],
    coaches: [coach('coach:hc', 'HeadCoach', 68), coach('coach:oc', 'OffensiveCoordinator', 64), coach('coach:dc', 'DefensiveCoordinator', 58)],
    openings: [], nativeOffers: [], staffMoves: [], integrity: { valid: true, checks: 1, errors: 0, warnings: 0, findings: [] }
  } as unknown as DynastySnapshot;
}

describe('seeded retirement planning', () => {
  it('retires age-eligible Coaches and creates role-appropriate consequences', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'RETIREMENT-SEED');
    const plan = planRetirements(snapshot, market, {}, certainConfig);
    expect(plan.events.map((event) => event.coachId).sort()).toEqual(['coach:hc', 'coach:oc']);
    expect(plan.internalSuccessionTeamIds).toEqual(['team:1']);
    expect(plan.coordinatorVacancies).toHaveLength(1);
    expect(plan.evidence.find((item) => item.coachId === 'coach:dc')).toMatchObject({ eligible: false, exclusionReason: 'BelowMinimumAge', probability: 0 });
  });

  it('evaluates NFL departures first and never selects the same Coach twice', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'RETIREMENT-SEED');
    const plan = planRetirements(snapshot, market, { departedCoachIds: ['coach:oc'] }, certainConfig);
    expect(plan.events.some((event) => event.coachId === 'coach:oc')).toBe(false);
    expect(plan.evidence.find((item) => item.coachId === 'coach:oc')).toMatchObject({ exclusionReason: 'AlreadyDeparted' });
  });

  it('uses Retiring on Top only when an authoritative champion Team is supplied', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'RETIREMENT-SEED');
    const ordinary = planRetirements(snapshot, market, {}, certainConfig);
    const champion = planRetirements(snapshot, market, { nationalChampionTeamId: 'team:1' }, certainConfig);
    expect(ordinary.events.every((event) => event.reason === 'Retirement')).toBe(true);
    expect(champion.events.filter((event) => event.coachId !== 'coach:dc').every((event) => event.reason === 'RetiringOnTop')).toBe(true);
  });

  it('is exactly reproducible and fails closed across mismatched saves', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'RETIREMENT-SEED');
    expect(planRetirements(snapshot, market, {}, certainConfig)).toEqual(planRetirements(snapshot, market, {}, certainConfig));
    market.sourceFingerprint = 'B'.repeat(64);
    expect(() => planRetirements(snapshot, market, {}, certainConfig)).toThrow(RetirementPlanningError);
  });
});
