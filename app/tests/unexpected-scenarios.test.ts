import { describe, expect, it } from 'vitest';
import type { DynastySnapshot, NormalizedCoach } from '../src/core/dynasty';
import { initializeMarket } from '../src/core/market';
import { INITIAL_UNEXPECTED_SCENARIO_CONFIG, planUnexpectedScenarios, type UnexpectedScenarioConfig } from '../src/core/unexpected-scenarios';

const certainConfig: UnexpectedScenarioConfig = {
  enabled: true, firstScenarioProbability: 1, secondScenarioProbability: 1, maximumScenarios: 2,
  headCoachTargetWeight: 1, coordinatorTargetWeight: 1,
  categoryWeights: { LookingForAChange: 1, AthleticDirectorConflict: 0, RecruitingComplianceViolation: 0, PersonalConductViolation: 0, ProgramWideScandal: 0 },
  recruitingCleansHouseProbability: 0, conductCleansHouseProbability: 0, userControlledHcProtection: true
};

function fixture(userHc = false, fcsTeam = false): DynastySnapshot {
  const coaches: NormalizedCoach[] = [];
  const teams = ['1', '2'].map((number) => {
    const coach = (role: 'HeadCoach' | 'OffensiveCoordinator' | 'DefensiveCoordinator', suffix: string, userControlled = false): NormalizedCoach => ({
      id: `coach:${number}:${suffix}`, role, employerTeamId: `team:${number}`, userControlled
    } as NormalizedCoach);
    const hc = coach('HeadCoach', 'hc', userHc && number === '1');
    const oc = coach('OffensiveCoordinator', 'oc');
    const dc = coach('DefensiveCoordinator', 'dc');
    coaches.push(hc, oc, dc);
    const name = fcsTeam && number === '2' ? 'FCS West' : `Test State ${number}`;
    return { id: `team:${number}`, name, longName: name, shortName: name, nickname: name, assetKey: name, staff: { headCoachId: hc.id, offensiveCoordinatorId: oc.id, defensiveCoordinatorId: dc.id } };
  });
  return {
    sourceFingerprint: 'A'.repeat(64), seasonYear: 2026, conferences: [], teams, coaches,
    openings: [], nativeOffers: [], staffMoves: [], integrity: { valid: true, checks: 1, errors: 0, warnings: 0, findings: [] }
  } as unknown as DynastySnapshot;
}

describe('Unexpected Scenarios', () => {
  it('starts from an allowance averaging approximately one scenario every two seasons', () => {
    const expectedMean = INITIAL_UNEXPECTED_SCENARIO_CONFIG.firstScenarioProbability
      * (1 + INITIAL_UNEXPECTED_SCENARIO_CONFIG.secondScenarioProbability);
    expect(expectedMean).toBeCloseTo(0.5, 2);
    expect(INITIAL_UNEXPECTED_SCENARIO_CONFIG.maximumScenarios).toBe(2);
  });

  it('draws a small seasonal allowance and selects no more than one Coach per Team', () => {
    const snapshot = fixture();
    const plan = planUnexpectedScenarios(snapshot, initializeMarket(snapshot, 'SCENARIOS'), {}, certainConfig);
    expect(plan.allowance.count).toBe(2);
    expect(plan.events).toHaveLength(2);
    expect(new Set(plan.events.map((event) => event.teamId)).size).toBe(2);
    expect(plan.events.every((event) => event.fictionalSimulation)).toBe(true);
    expect(plan.events.every((event) => event.category === 'LookingForAChange')).toBe(true);
    expect(plan.availableCoachIds.sort()).toEqual(plan.events.map((event) => event.targetCoachId).sort());
    expect(plan.events.every((event) => event.candidatePoolDisposition === 'Available')).toBe(true);
  });

  it('excludes Coaches and Teams already affected by earlier departures', () => {
    const snapshot = fixture();
    const plan = planUnexpectedScenarios(snapshot, initializeMarket(snapshot, 'SCENARIOS'), {
      departedCoachIds: ['coach:1:hc'], affectedTeamIds: ['team:1']
    }, certainConfig);
    expect(plan.events.every((event) => event.teamId === 'team:2')).toBe(true);
    expect(plan.events).toHaveLength(1);
  });

  it('excludes FCS programs from all fictional scenario targeting', () => {
    const snapshot = fixture(false, true);
    const plan = planUnexpectedScenarios(snapshot, initializeMarket(snapshot, 'NO-FCS-SCENARIOS'), {}, certainConfig);
    expect(plan.events.every((event) => event.teamId === 'team:1')).toBe(true);
    expect(plan.events).toHaveLength(1);
    expect(plan.targetEvidence.filter((target) => target.teamId === 'team:2').every((target) => (
      !target.eligible && target.exclusionReason === 'FcsProgram' && target.weight === 0 && !target.selected
    ))).toBe(true);
  });

  it('pauses for a protected user HC and consumes a nullified scenario without rerolling', () => {
    const snapshot = fixture(true);
    const hcOnly = { ...certainConfig, maximumScenarios: 1, headCoachTargetWeight: 1, coordinatorTargetWeight: 0 };
    const market = initializeMarket(snapshot, 'USER-SCENARIO');
    const pending = planUnexpectedScenarios(snapshot, market, { affectedTeamIds: ['team:2'] }, hcOnly);
    expect(pending.pendingDecisions).toHaveLength(1);
    expect(pending.events).toHaveLength(0);
    const scenarioId = pending.outcomes[0]!.id;
    const nullified = planUnexpectedScenarios(snapshot, market, { affectedTeamIds: ['team:2'], userDecisions: { [scenarioId]: 'nullify' } }, hcOnly);
    expect(nullified.nullifiedScenarioIds).toEqual([scenarioId]);
    expect(nullified.events).toHaveLength(0);
    expect(nullified.outcomes[0]!.targetCoachId).toBe(pending.outcomes[0]!.targetCoachId);
  });

  it('is exactly reproducible for the same seed', () => {
    const snapshot = fixture();
    const market = initializeMarket(snapshot, 'SCENARIOS');
    expect(planUnexpectedScenarios(snapshot, market, {}, certainConfig)).toEqual(planUnexpectedScenarios(snapshot, market, {}, certainConfig));
  });
});
