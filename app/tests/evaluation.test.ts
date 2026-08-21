import { describe, expect, it } from 'vitest';
import type { DynastySnapshot, NormalizedCoach, NormalizedTeam } from '../src/core/dynasty';
import { evaluatePartOne, ROLE_FIRE_SCORE_THRESHOLD } from '../src/core/evaluation';
import { initializeMarket } from '../src/core/market';

function fixture(): DynastySnapshot {
  const team = {
    id: 'team:1', sourceRow: 1, sourceReference: 'team-ref', teamIndex: 1,
    name: 'Test State', longName: 'Test State', shortName: 'TS', nickname: 'Tests', assetKey: 'test', conferenceId: null,
    prestige: 5, prestigeDisplay: 'B', nationalRanking: null,
    currentRecord: { wins: 8, losses: 4, ties: 0 }, previousSeasonRecord: { wins: 7, losses: 5, ties: 0 },
    ratings: { overall: 75, offense: 75, defense: 75 },
    performance: { offensiveRank: 40, defensiveRank: 40, pointsFor: 350, pointsAgainst: 300, expectedContractPoints: [160, 160, 160] },
    colors: ['#000', '#fff'], staff: { headCoachId: 'coach:1', offensiveCoordinatorId: 'coach:2', defensiveCoordinatorId: 'coach:3' },
    resources: { remainingProgramPoints: 100, staffProgramPointsSpent: 100, staffAccessiblePool: 200, programPointBudget: 500, rolloverProgramPoints: 0, nilProgramPointsSpent: 0, roleBudgets: { headCoach: 50, offensiveCoordinator: 25, defensiveCoordinator: 25 } },
    schemes: { offense: '', defense: '' }
  } satisfies NormalizedTeam;
  const makeCoach = (id: string, role: NormalizedCoach['role']): NormalizedCoach => ({
    id, sourceRow: Number(id.at(-1)), sourceReference: `${id}-ref`, name: id, firstName: id, lastName: '', assetName: '', portrait: null, presentationId: null,
    age: 45, yearsCoaching: 12, seasonsWithTeam: 3, role, previousRole: null, employerTeamId: 'team:1', previousTeamId: null,
    userControlled: false, created: false, legend: false, prestige: 'B', prestigeScore: 300, level: 25,
    contract: { status: 'First_Active', length: 3, yearsRemaining: 2, expectation: null },
    contractPerformance: { earnedPoints: [170, 160, 150] },
    resume: { season: { wins: 8, losses: 4, ties: 0 }, career: { wins: 70, losses: 45, ties: 0, winsAtCurrentSchool: 24, lossesAtCurrentSchool: 12, playoffWins: 0, playoffLosses: 0, bowlWins: 3, bowlLosses: 1, conferenceChampionships: 1, nationalChampionships: 0, timesFired: 0 }, legacyScore: 100, awardPoints: 0 },
    schemes: { offense: '', defense: '', offensivePlaybook: '', defensivePlaybook: '' },
    jobSecurity: { status: 'Safe', percentage: 80, seasonStartStatus: 'Safe', performanceLevel: '0' }
  });
  return {
    sourceFingerprint: 'A'.repeat(64), seasonYear: 2026, conferences: [], teams: [team],
    coaches: [makeCoach('coach:1', 'HeadCoach'), makeCoach('coach:2', 'OffensiveCoordinator'), makeCoach('coach:3', 'DefensiveCoordinator')],
    openings: [], nativeOffers: [], staffMoves: [], integrity: { valid: true, checks: 10, errors: 0, warnings: 0, findings: [] }
  };
}

describe('Part 1 job evaluation', () => {
  it('uses calibrated role-specific fire cutoffs without a count quota', () => {
    expect(ROLE_FIRE_SCORE_THRESHOLD).toEqual({ HC: 32, OC: 24, DC: 32 });
  });

  it('uses the approved role weights and produces explainable classifications for every seat', () => {
    const snapshot = fixture();
    const result = evaluatePartOne(snapshot, initializeMarket(snapshot, 'EVALUATION'));
    const hc = result.evaluations.find((item) => item.role === 'HC')!;
    const oc = result.evaluations.find((item) => item.role === 'OC')!;

    expect(result.evaluations).toHaveLength(3);
    expect(hc.components.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    expect(oc.components.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    expect(hc.classification).toBe('Secure');
    expect(oc.unitOverachievement).not.toBeNull();
  });

  it('fires only when a low score is supported by at least two independent failure signals', () => {
    const snapshot = fixture();
    const coach = snapshot.coaches[0]!;
    const team = snapshot.teams[0]!;
    coach.contractPerformance.earnedPoints = [10, 100, 180];
    coach.jobSecurity = { status: 'HotSeat', percentage: 8, seasonStartStatus: 'Low', performanceLevel: '0' };
    coach.prestigeScore = 0;
    coach.resume.career = { ...coach.resume.career, wins: 1, losses: 20 };
    team.currentRecord = { wins: 1, losses: 11, ties: 0 };
    team.ratings.overall = 90;
    team.prestige = 9;

    const evaluation = evaluatePartOne(snapshot, initializeMarket(snapshot, 'FIRE')).evaluations.find((item) => item.role === 'HC')!;
    expect(evaluation.score).toBeLessThanOrEqual(24);
    expect(evaluation.failureSignals.length).toBeGreaterThanOrEqual(2);
    expect(evaluation.classification).toBe('Fire');
  });

  it('does not convert a low score into an unconditional firing from one primary signal', () => {
    const snapshot = fixture();
    const coach = snapshot.coaches[0]!;
    const team = snapshot.teams[0]!;
    coach.contractPerformance.earnedPoints = [0, null, null];
    coach.jobSecurity = { status: 'SafeForNow', percentage: 21, seasonStartStatus: 'SafeForNow', performanceLevel: '0' };
    coach.prestigeScore = 0;
    coach.resume.career = { ...coach.resume.career, wins: 0, losses: 20 };
    team.currentRecord = { wins: 5, losses: 7, ties: 0 };
    team.ratings.overall = 51;
    team.prestige = 0;

    const evaluation = evaluatePartOne(snapshot, initializeMarket(snapshot, 'ONE-SIGNAL')).evaluations.find((item) => item.role === 'HC')!;
    expect(evaluation.score).toBeLessThanOrEqual(24);
    expect(evaluation.failureSignals).toHaveLength(1);
    expect(evaluation.classification).toBe('Vulnerable');
  });

  it('applies first-year grace and protects ordinary Market Review', () => {
    const snapshot = fixture();
    const coach = snapshot.coaches[0]!;
    coach.seasonsWithTeam = 0;
    coach.contractPerformance.earnedPoints = [40, null, null];
    coach.jobSecurity = { status: 'Low', percentage: 30, seasonStartStatus: 'SafeForNow', performanceLevel: '0' };
    snapshot.teams[0]!.currentRecord = { wins: 3, losses: 9, ties: 0 };

    const evaluation = evaluatePartOne(snapshot, initializeMarket(snapshot, 'GRACE')).evaluations.find((item) => item.role === 'HC')!;
    expect(evaluation.graceBonus).toBe(20);
    expect(evaluation.marketReviewProtected).toBe(true);
    expect(evaluation.classification).not.toBe('Fire');
  });
});
