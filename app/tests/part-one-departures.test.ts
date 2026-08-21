import { describe, expect, it } from 'vitest';
import type { DynastySnapshot, NormalizedCoach } from '../src/core/dynasty';
import type { CoachEvaluation, PartOneEvaluation } from '../src/core/evaluation';
import { initializeMarket } from '../src/core/market';
import { planPartOneDepartures } from '../src/core/part-one-departures';

function fixture(): DynastySnapshot {
  const coach = (id: string, role: NormalizedCoach['role'], age: number): NormalizedCoach => ({
    id, role, employerTeamId: 'team:1', userControlled: false, age, yearsCoaching: 35, prestigeScore: 300,
    contract: { yearsRemaining: 1 }, resume: { season: { wins: 8, losses: 4, ties: 0 }, career: { wins: 80, losses: 40, ties: 0 } }
  } as NormalizedCoach);
  return {
    sourceFingerprint: 'A'.repeat(64), seasonYear: 2026, conferences: [],
    teams: [{ id: 'team:1', staff: { headCoachId: 'coach:hc', offensiveCoordinatorId: 'coach:oc', defensiveCoordinatorId: 'coach:dc' } }],
    coaches: [coach('coach:hc', 'HeadCoach', 68), coach('coach:oc', 'OffensiveCoordinator', 66), coach('coach:dc', 'DefensiveCoordinator', 65)],
    openings: [], nativeOffers: [], staffMoves: [],
    nationalChampionship: {
      sourceRow: 401, seasonWeek: 20, weekType: 'NationalChampionship', homeTeamId: 'team:1', awayTeamId: 'team:2',
      homeScore: 31, awayScore: 27, winnerTeamId: 'team:1', loserTeamId: 'team:2', status: 'HomeWon', overtime: false, simulated: true
    },
    integrity: { valid: true, checks: 1, errors: 0, warnings: 0, findings: [] }
  } as unknown as DynastySnapshot;
}

describe('ordered Part 1 departures', () => {
  it('resolves NFL departures before retirement and exposes one collision-free ledger', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'PART-ONE-DEPARTURES');
    const evaluations = market.seats.map((seat) => ({
      seatId: seat.id, teamId: seat.teamId, coachId: seat.incumbentCoachId, role: seat.role,
      rawScore: 80, graceBonus: 0, score: 80, classification: 'Secure', components: [], failureSignals: [],
      catastrophicFailure: false, marketReviewProtected: false, userConfirmationRequired: false, unitOverachievement: null
    } satisfies CoachEvaluation));
    const evaluation: PartOneEvaluation = {
      status: 'evaluated', sourceFingerprint: snapshot.sourceFingerprint, seed: market.seed, evaluations,
      counts: { Fire: 0, Vulnerable: 0, Secure: 3, catastrophic: 0, userProtected: 0 }
    };
    const result = planPartOneDepartures(snapshot, market, evaluation, {
      nflConfig: {
        headCoachBaseProbability: 1, coordinatorBaseProbability: 0, minimumEvaluationScore: 0,
        maximumIndividualProbability: 1, maximumDepartures: 1,
        weights: { performance: 1, prestige: 0, resume: 0, careerWindow: 0 }
      },
      retirementConfig: {
        minimumAge: 61, baseProbabilityAtMinimumAge: 1, annualAgeIncrease: 0,
        losingSeasonBonus: 0, expiringContractBonus: 0, multiYearContractReduction: 0,
        longCareerThreshold: 30, longCareerBonusPerYear: 0, maximumLongCareerBonus: 0,
        retiringOnTopBonus: 0, maximumIndividualProbability: 1, maximumRetirements: 3,
        mandatoryRetirementAge: null
      },
      unexpectedScenarioConfig: {
        enabled: false, firstScenarioProbability: 0, secondScenarioProbability: 0, maximumScenarios: 0,
        headCoachTargetWeight: 1, coordinatorTargetWeight: 1,
        categoryWeights: { LookingForAChange: 1, AthleticDirectorConflict: 1, RecruitingComplianceViolation: 1, PersonalConductViolation: 1, ProgramWideScandal: 1 },
        recruitingCleansHouseProbability: 0, conductCleansHouseProbability: 0, userControlledHcProtection: true
      }
    });
    expect(result.nfl.events.map((event) => event.coachId)).toEqual(['coach:hc']);
    expect(result.retirements.evidence.find((item) => item.coachId === 'coach:hc')).toMatchObject({ exclusionReason: 'AlreadyDeparted' });
    expect(result.retirements.events.every((event) => event.reason === 'RetiringOnTop')).toBe(true);
    expect(result.departedCoachIds.sort()).toEqual(['coach:dc', 'coach:hc', 'coach:oc']);
    expect(result.invariants).toMatchObject({ valid: true, uniqueDepartedCoaches: 3 });
  });
});
