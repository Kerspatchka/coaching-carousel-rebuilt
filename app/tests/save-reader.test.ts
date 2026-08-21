import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeMarket } from '../src/core/market';
import { evaluatePartOne } from '../src/core/evaluation';
import { planPerformanceActions } from '../src/core/performance-actions';
import { planPartOneDepartures } from '../src/core/part-one-departures';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd()
  }
}));

let inspectSave: typeof import('../src/save-reader').inspectSave;

beforeAll(async () => {
  ({ inspectSave } = await import('../src/save-reader'));
});

const fixture = (name: string) => path.resolve(process.cwd(), '..', 'assets', 'ref_saves', name);

describe('read-only save preflight', () => {
  it('accepts the validated National Championship week fixture and identifies its user context', async () => {
    const result = await inspectSave(fixture('DYNASTY-CCRY1BW3'), false);

    expect(result.status, JSON.stringify({ issues: result.issues, integrity: result.snapshot?.integrity }, null, 2)).toBe('ready');
    expect(result.schema.detected).toBe('833.0');
    expect(result.checkpoint.weekType).toBe('NationalChampionship');
    expect(result.checkpoint.carouselActive).toBe(true);
    expect(result.inventory.teams).toBe(143);
    expect(result.inventory.coaches).toBe(497);
    expect(result.inventory.openings).toBe(192);
    expect(result.inventory.indexedStaffMoves).toBe(124);
    expect(result.users[0]).toMatchObject({
      name: 'Lance Taylor',
      role: 'HeadCoach',
      seasonRecord: '9-5',
      team: { longName: 'Western Michigan' }
    });

    const snapshot = result.snapshot;
    expect(snapshot).not.toBeNull();
    expect(snapshot?.sourceFingerprint).toMatch(/^[A-F0-9]{64}$/);
    expect(snapshot?.integrity).toMatchObject({ valid: true, errors: 0, warnings: 0 });
    expect(snapshot?.integrity.checks).toBeGreaterThan(2_000);
    expect(snapshot?.conferences).toHaveLength(12);
    expect(snapshot?.teams).toHaveLength(143);
    expect(snapshot?.coaches).toHaveLength(497);
    expect(snapshot?.openings).toHaveLength(192);
    expect(snapshot?.nativeOffers).toHaveLength(0);
    expect(snapshot?.staffMoves).toHaveLength(124);
    expect(snapshot?.nationalChampionship).toMatchObject({
      sourceRow: 401,
      seasonWeek: 20,
      weekType: 'NationalChampionship',
      homeScore: 31,
      awayScore: 27,
      status: 'HomeWon'
    });
    expect(snapshot?.nationalChampionship?.winnerTeamId).toBe(snapshot?.nationalChampionship?.homeTeamId);
    expect(snapshot?.teams.some((team) => team.id === snapshot?.nationalChampionship?.winnerTeamId)).toBe(true);

    const userCoach = snapshot?.coaches.find((coach) => coach.userControlled);
    const userTeam = snapshot?.teams.find((team) => team.id === userCoach?.employerTeamId);
    expect(userCoach).toMatchObject({
      name: 'Lance Taylor',
      role: 'HeadCoach',
      resume: { season: { wins: 9, losses: 5 }, career: { wins: 29, losses: 24 } }
    });
    expect(userTeam).toMatchObject({
      longName: 'Western Michigan',
      staff: { headCoachId: userCoach?.id }
    });
    expect(userTeam?.conferenceId).not.toBeNull();
    expect(userTeam?.ratings.overall).not.toBeNull();
    expect(userTeam?.performance.offensiveRank).not.toBeNull();
    expect(userTeam?.performance.defensiveRank).not.toBeNull();
    expect(userCoach?.contractPerformance.earnedPoints[0]).not.toBeNull();
    expect(userTeam?.resources.staffAccessiblePool).toBe(
      (userTeam?.resources.remainingProgramPoints ?? 0) + (userTeam?.resources.staffProgramPointsSpent ?? 0)
    );

    const coachIds = new Set(snapshot?.coaches.map((coach) => coach.id));
    for (const team of snapshot?.teams ?? []) {
      expect(coachIds.has(team.staff.headCoachId)).toBe(true);
      expect(coachIds.has(team.staff.offensiveCoordinatorId)).toBe(true);
      expect(coachIds.has(team.staff.defensiveCoordinatorId)).toBe(true);
    }

    const market = initializeMarket(snapshot!, 'CCR-M2-M3-BOUNDARY');
    expect(market.seats).toHaveLength(429);
    expect(market.invariants).toEqual({ valid: true, expectedSeatCount: 429, uniqueIncumbentCount: 429 });
    expect(market.nativeOutcomeEvidence).toHaveLength(192);
    const evaluation = evaluatePartOne(snapshot!, market);
    expect(evaluation.evaluations).toHaveLength(429);
    expect(evaluation.counts).toEqual({ Fire: 33, Vulnerable: 119, Secure: 277, catastrophic: 3, userProtected: 0 });
    expect(evaluation.evaluations.filter((item) => item.role === 'HC' && item.classification === 'Fire')).toHaveLength(12);
    expect(evaluation.evaluations.filter((item) => item.role === 'OC' && item.classification === 'Fire')).toHaveLength(11);
    expect(evaluation.evaluations.filter((item) => item.role === 'DC' && item.classification === 'Fire')).toHaveLength(10);

    const departures = planPartOneDepartures(snapshot!, market, evaluation);
    expect(departures.invariants.valid).toBe(true);
    expect(new Set(departures.departedCoachIds).size).toBe(departures.departedCoachIds.length);
    const performancePlan = planPerformanceActions(snapshot!, market, evaluation, {
      departedCoachIds: departures.departedCoachIds,
      internalSuccessionTeamIds: departures.internalSuccessionTeamIds
    });
    expect(performancePlan.invariants.valid).toBe(true);
    expect(performancePlan.actions.length).toBe(performancePlan.vacancies.length);
    expect(performancePlan.actions.length).toBeGreaterThanOrEqual(30);
    expect(performancePlan.requiresBuyoutPricing).toBe(true);
    expect(new Set(performancePlan.actions.map((item) => item.coachId)).size).toBe(performancePlan.actions.length);
  });

  it('blocks a valid dynasty save captured before the supported checkpoint', async () => {
    const result = await inspectSave(fixture('DYNASTY-CCRY1W15'), false);

    expect(result.status).toBe('blocked');
    expect(result.issues.some((item) => item.code === 'WRONG_CHECKPOINT')).toBe(true);
  });

  it.each([
    ['DYNASTY-TEST1NATCHAMP', 23, 26, 'AwayWon'],
    ['DYNASTY-TEST2NATCHAMP', 29, 31, 'AwayWon'],
    ['DYNASTY-TEST3NATCHAMP', 40, 20, 'HomeWon']
  ] as const)('normalizes the finalized championship result in %s', async (name, homeScore, awayScore, status) => {
    const result = await inspectSave(fixture(name), false);
    expect(result.status, JSON.stringify(result.issues, null, 2)).toBe('ready');
    expect(result.snapshot?.nationalChampionship).toMatchObject({ homeScore, awayScore, status });
    const game = result.snapshot?.nationalChampionship;
    expect(game?.winnerTeamId).toBe(status === 'HomeWon' ? game?.homeTeamId : game?.awayTeamId);
  });
});
