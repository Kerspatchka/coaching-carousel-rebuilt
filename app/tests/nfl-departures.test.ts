import { describe, expect, it } from 'vitest';
import type { DynastySnapshot, NormalizedCoach } from '../src/core/dynasty';
import type { CoachEvaluation, PartOneEvaluation } from '../src/core/evaluation';
import { initializeMarket } from '../src/core/market';
import { planNflDepartures, type NflDepartureConfig, NflDeparturePlanningError } from '../src/core/nfl-departures';

const certainConfig: NflDepartureConfig = {
  headCoachBaseProbability: 1, coordinatorBaseProbability: 1, minimumEvaluationScore: 0,
  maximumIndividualProbability: 1, maximumDepartures: 3,
  weights: { performance: 1, prestige: 1, resume: 1, careerWindow: 1 }
};

function fixture(userHc = false, fcsTeam = false): DynastySnapshot {
  const coach = (id: string, role: NormalizedCoach['role'], userControlled = false): NormalizedCoach => ({
    id, role, employerTeamId: 'team:1', userControlled, age: 42, prestigeScore: 300,
    resume: { career: { wins: 80, losses: 40, ties: 0 } }
  } as NormalizedCoach);
  return {
    sourceFingerprint: 'A'.repeat(64), seasonYear: 2026, conferences: [],
    teams: [{ id: 'team:1', name: fcsTeam ? 'FCS Southeast' : 'Test State', longName: fcsTeam ? 'FCS Southeast' : 'Test State', shortName: fcsTeam ? 'FCS SE' : 'TS', nickname: fcsTeam ? 'FCS Southeast' : 'Tests', assetKey: fcsTeam ? 'FCS_Southeast' : 'TestState', staff: { headCoachId: 'coach:hc', offensiveCoordinatorId: 'coach:oc', defensiveCoordinatorId: 'coach:dc' } }],
    coaches: [coach('coach:hc', 'HeadCoach', userHc), coach('coach:oc', 'OffensiveCoordinator'), coach('coach:dc', 'DefensiveCoordinator')],
    openings: [], nativeOffers: [], staffMoves: [], integrity: { valid: true, checks: 1, errors: 0, warnings: 0, findings: [] }
  } as unknown as DynastySnapshot;
}

function evaluation(snapshot: DynastySnapshot): PartOneEvaluation {
  const market = initializeMarket(snapshot, 'NFL-SEED');
  const evaluations = market.seats.map((seat) => ({
    seatId: seat.id, teamId: seat.teamId, coachId: seat.incumbentCoachId, role: seat.role, rawScore: 80, graceBonus: 0,
    score: 80, classification: 'Secure', components: [], failureSignals: [], catastrophicFailure: false,
    marketReviewProtected: false, userConfirmationRequired: false, unitOverachievement: null
  } satisfies CoachEvaluation));
  return { status: 'evaluated', sourceFingerprint: snapshot.sourceFingerprint, seed: market.seed, evaluations, counts: { Fire: 0, Vulnerable: 0, Secure: 3, catastrophic: 0, userProtected: 0 } };
}

describe('seeded NFL departure planning', () => {
  it('creates role-appropriate consequences and vacancies', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'NFL-SEED');
    const plan = planNflDepartures(snapshot, market, evaluation(snapshot), certainConfig);

    expect(plan.events).toHaveLength(3);
    expect(plan.internalSuccessionTeamIds).toEqual(['team:1']);
    expect(plan.coordinatorVacancies.map((item) => item.role).sort()).toEqual(['DC', 'OC']);
    expect(plan.events.every((event) => event.destination === 'NFL')).toBe(true);
  });

  it('excludes user-controlled Coaches until their NFL interaction rule is approved', () => {
    const snapshot = fixture(true);
    const market = initializeMarket(snapshot, 'NFL-SEED');
    const plan = planNflDepartures(snapshot, market, evaluation(snapshot), certainConfig);

    expect(plan.events.some((event) => event.coachId === 'coach:hc')).toBe(false);
    expect(plan.evidence.find((item) => item.coachId === 'coach:hc')).toMatchObject({ eligible: false, exclusionReason: 'UserControlledDeferred', probability: 0 });
  });

  it('excludes every Coach employed by an FCS program', () => {
    const snapshot = fixture(false, true);
    const market = initializeMarket(snapshot, 'NFL-SEED');
    const plan = planNflDepartures(snapshot, market, evaluation(snapshot), certainConfig);

    expect(plan.events).toHaveLength(0);
    expect(plan.evidence.every((item) => !item.eligible && item.exclusionReason === 'FcsProgram' && item.probability === 0 && !item.selected)).toBe(true);
  });

  it('is exactly reproducible from the same save, seed, and configuration', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'NFL-SEED');
    expect(planNflDepartures(snapshot, market, evaluation(snapshot), certainConfig)).toEqual(planNflDepartures(snapshot, market, evaluation(snapshot), certainConfig));
  });

  it('fails closed when its inputs describe different saves', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'NFL-SEED');
    const result = evaluation(snapshot);
    result.sourceFingerprint = 'B'.repeat(64);
    expect(() => planNflDepartures(snapshot, market, result, certainConfig)).toThrow(NflDeparturePlanningError);
  });
});
