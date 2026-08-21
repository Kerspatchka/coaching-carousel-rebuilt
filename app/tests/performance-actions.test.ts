import { describe, expect, it } from 'vitest';
import type { DynastySnapshot, NormalizedCoach } from '../src/core/dynasty';
import type { CoachEvaluation, PartOneEvaluation } from '../src/core/evaluation';
import { initializeMarket } from '../src/core/market';
import { performanceDecisionId, planPerformanceActions, PerformanceActionPlanningError } from '../src/core/performance-actions';

function fixture(userHc = false): DynastySnapshot {
  const coach = (id: string, role: NormalizedCoach['role'], userControlled = false): NormalizedCoach => ({
    id, role, employerTeamId: 'team:1', userControlled, contract: { yearsRemaining: 2 }
  } as NormalizedCoach);
  return {
    sourceFingerprint: 'A'.repeat(64), seasonYear: 2026, conferences: [],
    teams: [{ id: 'team:1', staff: { headCoachId: 'coach:hc', offensiveCoordinatorId: 'coach:oc', defensiveCoordinatorId: 'coach:dc' } }],
    coaches: [coach('coach:hc', 'HeadCoach', userHc), coach('coach:oc', 'OffensiveCoordinator'), coach('coach:dc', 'DefensiveCoordinator')],
    openings: [], nativeOffers: [], staffMoves: [], integrity: { valid: true, checks: 1, errors: 0, warnings: 0, findings: [] }
  } as unknown as DynastySnapshot;
}

function evaluation(snapshot: DynastySnapshot, classifications: Partial<Record<'HC' | 'OC' | 'DC', CoachEvaluation['classification']>>): PartOneEvaluation {
  const market = initializeMarket(snapshot, 'PERFORMANCE-ACTIONS');
  const evaluations = market.seats.map((seat) => ({
    seatId: seat.id, teamId: seat.teamId, coachId: seat.incumbentCoachId, role: seat.role,
    rawScore: 50, graceBonus: 0, score: 50, classification: classifications[seat.role] ?? 'Secure', components: [], failureSignals: [],
    catastrophicFailure: false, marketReviewProtected: false, userConfirmationRequired: false, unitOverachievement: null
  } satisfies CoachEvaluation));
  return {
    status: 'evaluated', sourceFingerprint: snapshot.sourceFingerprint, seed: market.seed, evaluations,
    counts: {
      Fire: evaluations.filter((item) => item.classification === 'Fire').length,
      Vulnerable: evaluations.filter((item) => item.classification === 'Vulnerable').length,
      Secure: evaluations.filter((item) => item.classification === 'Secure').length,
      catastrophic: 0, userProtected: 0
    }
  };
}

describe('Part 1 performance action planning', () => {
  it('turns a CPU HC Fire result into a complete Cleans House plan', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'PERFORMANCE-ACTIONS');
    const plan = planPerformanceActions(snapshot, market, evaluation(snapshot, { HC: 'Fire' }));

    expect(plan.actions).toHaveLength(3);
    expect(plan.vacancies).toHaveLength(3);
    expect(plan.actions.find((item) => item.role === 'HC')).toMatchObject({ disposition: 'Fired', trigger: 'CleansHouse' });
    expect(plan.actions.filter((item) => item.role !== 'HC').every((item) => item.disposition === 'StaffNotRetained')).toBe(true);
    expect(plan.requiresBuyoutPricing).toBe(true);
    expect(plan.invariants).toEqual({ valid: true, uniqueReleasedCoaches: 3, uniqueVacancies: 3 });
  });

  it('dismisses independently fired CPU coordinators without opening the HC seat', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'PERFORMANCE-ACTIONS');
    const plan = planPerformanceActions(snapshot, market, evaluation(snapshot, { OC: 'Fire', DC: 'Fire' }));

    expect(plan.actions.map((item) => item.role).sort()).toEqual(['DC', 'OC']);
    expect(plan.actions.every((item) => item.trigger === 'PerformanceFire' && item.disposition === 'Fired')).toBe(true);
    expect(plan.vacancies.some((item) => item.role === 'HC')).toBe(false);
  });

  it('does not stack a performance action onto a program already affected by an earlier departure', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'PERFORMANCE-ACTIONS');
    const plan = planPerformanceActions(snapshot, market, evaluation(snapshot, { HC: 'Fire', OC: 'Fire', DC: 'Fire' }), {
      departedCoachIds: ['coach:dc']
    });

    expect(plan.actions).toHaveLength(0);
    expect(plan.vacancies).toHaveLength(0);
  });

  it('pauses a protected user HC firing before creating the Cleans House cascade', () => {
    const snapshot = fixture(true);
    const market = initializeMarket(snapshot, 'PERFORMANCE-ACTIONS');
    const result = evaluation(snapshot, { HC: 'Fire' });
    const pending = planPerformanceActions(snapshot, market, result);

    expect(pending.actions).toHaveLength(0);
    expect(pending.pendingDecisions).toContainEqual(expect.objectContaining({ kind: 'ConfirmUserHcFiring', role: 'HC' }));

    const hcSeat = market.seats.find((seat) => seat.role === 'HC')!;
    const confirmed = planPerformanceActions(snapshot, market, result, { userDecisions: { [performanceDecisionId(hcSeat.id)]: 'dismiss' } });
    expect(confirmed.actions).toHaveLength(3);
  });

  it('lets a user HC retain or dismiss a coordinator after a Fire recommendation', () => {
    const snapshot = fixture(true);
    const market = initializeMarket(snapshot, 'PERFORMANCE-ACTIONS');
    const result = evaluation(snapshot, { OC: 'Fire' });
    const ocSeat = market.seats.find((seat) => seat.role === 'OC')!;
    const decisionId = performanceDecisionId(ocSeat.id);

    const pending = planPerformanceActions(snapshot, market, result);
    expect(pending.pendingDecisions).toContainEqual(expect.objectContaining({ id: decisionId, kind: 'OverrideCoordinatorFire' }));

    const retained = planPerformanceActions(snapshot, market, result, { userDecisions: { [decisionId]: 'retain' } });
    expect(retained.actions).toHaveLength(0);
    expect(retained.overrides).toContainEqual(expect.objectContaining({ decisionId, choice: 'retain' }));

    const dismissed = planPerformanceActions(snapshot, market, result, { userDecisions: { [decisionId]: 'dismiss' } });
    expect(dismissed.actions).toContainEqual(expect.objectContaining({ role: 'OC', disposition: 'Fired' }));
  });

  it('fails closed when inputs come from different source saves', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'PERFORMANCE-ACTIONS');
    const result = evaluation(snapshot, { HC: 'Fire' });
    result.sourceFingerprint = 'B'.repeat(64);

    expect(() => planPerformanceActions(snapshot, market, result)).toThrow(PerformanceActionPlanningError);
  });
});
