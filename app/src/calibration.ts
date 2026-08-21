import crypto from 'node:crypto';
import path from 'node:path';
import { evaluatePartOne, ROLE_FIRE_SCORE_THRESHOLD, type CoachEvaluation, type JobEvaluationClassification } from './core/evaluation';
import { initializeMarket, type MarketRole } from './core/market';
import { planNflDepartures } from './core/nfl-departures';
import { planPartOneDepartures } from './core/part-one-departures';
import type { UnexpectedScenarioCategory } from './core/unexpected-scenarios';
import { planPerformanceActions } from './core/performance-actions';
import type { DynastySnapshot } from './core/dynasty';
import type { SavePreflightResult } from './shared/desktop-api';

type Cohort = 'natural' | 'experimental';
type RoleCounts = Record<MarketRole, Record<JobEvaluationClassification, number>>;

export interface CalibrationSaveSummary {
  file: { name: string; path: string; sizeBytes: number };
  status: 'ready' | 'blocked' | 'error';
  cohort: Cohort;
  checkpoint: SavePreflightResult['checkpoint'] | null;
  issueCodes: string[];
  fingerprint: string | null;
  evaluationFingerprint: string | null;
  seasonYear: number | null;
  nationalChampionship: { winnerTeamId: string; winnerTeam: string; loserTeamId: string; homeScore: number; awayScore: number; status: string } | null;
  seatCount: number;
  counts: (Record<JobEvaluationClassification, number> & { catastrophic: number; graceProtected: number; gracePreventedFire: number }) | null;
  byRole: RoleCounts | null;
  scoreDistribution: ScoreDistribution | null;
  scoreDistributionByRole: Record<MarketRole, ScoreDistribution> | null;
  failureSignals: Record<string, number> | null;
  failureSignalsByRole: Record<MarketRole, Record<string, number>> | null;
  componentAveragesByRole: Record<MarketRole, Record<string, number>> | null;
  tenureDistributionByRole: Record<MarketRole, Record<string, number>> | null;
  graceProtectedByRole: Record<MarketRole, number> | null;
  appliedFireThresholdByRole: Record<MarketRole, number> | null;
  nflDepartures: { total: number; byRole: Record<MarketRole, number>; eligible: number; passedRoll: number; events: Array<{ coachId: string; teamId: string; role: MarketRole; probability: number; roll: number }> } | null;
  nflMultiSeed: { seeds: number; meanTotal: number; minimum: number; maximum: number; zeroRate: number; cappedRate: number; meanByRole: Record<MarketRole, number> } | null;
  retirements: { total: number; retiringOnTop: number; byRole: Record<MarketRole, number>; eligible: number; passedRoll: number; excludedByNfl: number; events: Array<{ coachId: string; teamId: string; role: MarketRole; reason: string; probability: number; roll: number }> } | null;
  retirementMultiSeed: { seeds: number; meanTotal: number; meanRetiringOnTop: number; seasonsWithRetiringOnTopRate: number; minimum: number; maximum: number; zeroRate: number; cappedRate: number; meanByRole: Record<MarketRole, number> } | null;
  unexpectedScenarios: { allowance: number; selected: number; applied: number; pendingUserDecisions: number; cleansHouse: number; categories: Record<UnexpectedScenarioCategory, number> } | null;
  unexpectedScenarioMultiSeed: { seeds: number; meanSelected: number; zeroRate: number; oneRate: number; twoRate: number; meanCleansHouse: number; categories: Record<UnexpectedScenarioCategory, number> } | null;
  combinedDepartureMultiSeed: { seeds: number; meanDepartedCoaches: number; minimum: number; maximum: number; meanByRole: Record<MarketRole, number> } | null;
  combinedInitialTurnoverMultiSeed: { seeds: number; meanChangedSeats: number; minimum: number; maximum: number; meanByRole: Record<MarketRole, number> } | null;
  fireThresholdSensitivityByRole: Record<string, Record<MarketRole, number>> | null;
  secureThresholdSensitivityByRole: Record<string, Record<MarketRole, number>> | null;
  thresholdNeighborhoods: Record<string, number> | null;
  lowestEvaluations: EvaluationOutlier[];
  error?: string;
}

interface EvaluationOutlier {
  coach: string;
  team: string;
  role: MarketRole;
  score: number;
  rawScore: number;
  graceBonus: number;
  classification: JobEvaluationClassification;
  signals: string[];
}

interface ScoreDistribution {
  count: number;
  minimum: number;
  p10: number;
  p25: number;
  median: number;
  mean: number;
  p75: number;
  p90: number;
  maximum: number;
  histogram: Record<string, number>;
}

const roles: MarketRole[] = ['HC', 'OC', 'DC'];
const classifications: JobEvaluationClassification[] = ['Fire', 'Vulnerable', 'Secure'];
const experimentalName = /(?:CCRCAP|CCRE\d|CCRG\d|EXP|G[1-6](?:CONTROL|RCORE|RHIDE|RSHAM|BAUSBY|TXROW|OPEN|CASCADE|INRANGE|SUBGRAPH|NATIVE|SYNTH))/i;

const cohortFor = (name: string): Cohort => experimentalName.test(name) ? 'experimental' : 'natural';
const round = (value: number, places = 2): number => Number(value.toFixed(places));
const percentile = (sorted: number[], position: number): number => {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
};

function distribution(values: number[]): ScoreDistribution {
  const sorted = [...values].sort((left, right) => left - right);
  const histogram: Record<string, number> = {};
  for (const value of sorted) {
    const floor = Math.floor(value / 5) * 5;
    const label = `${floor}-${Math.min(100, floor + 4)}`;
    histogram[label] = (histogram[label] ?? 0) + 1;
  }
  return {
    count: sorted.length,
    minimum: sorted[0] ?? 0,
    p10: round(percentile(sorted, 0.1)),
    p25: round(percentile(sorted, 0.25)),
    median: round(percentile(sorted, 0.5)),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length)),
    p75: round(percentile(sorted, 0.75)),
    p90: round(percentile(sorted, 0.9)),
    maximum: sorted.at(-1) ?? 0,
    histogram
  };
}

function emptyRoleCounts(): RoleCounts {
  return Object.fromEntries(roles.map((role) => [role, { Fire: 0, Vulnerable: 0, Secure: 0 }])) as RoleCounts;
}

function outlier(snapshot: DynastySnapshot, item: CoachEvaluation): EvaluationOutlier {
  const coach = snapshot.coaches.find((candidate) => candidate.id === item.coachId);
  const team = snapshot.teams.find((candidate) => candidate.id === item.teamId);
  return {
    coach: coach?.name ?? item.coachId,
    team: team?.longName ?? team?.name ?? item.teamId,
    role: item.role,
    score: item.score,
    rawScore: item.rawScore,
    graceBonus: item.graceBonus,
    classification: item.classification,
    signals: item.failureSignals.map((signal) => signal.id)
  };
}

export function summarizeCalibrationSave(result: SavePreflightResult): CalibrationSaveSummary {
  const base = {
    file: { ...result.file, path: `${path.basename(path.dirname(result.file.path))}/${result.file.name}` },
    cohort: cohortFor(result.file.name),
    checkpoint: result.checkpoint,
    issueCodes: result.issues.map((issue) => issue.code),
    fingerprint: result.snapshot?.sourceFingerprint ?? null,
    evaluationFingerprint: null,
    seasonYear: result.snapshot?.seasonYear ?? result.checkpoint.seasonYear,
    nationalChampionship: null,
    seatCount: 0,
    counts: null,
    byRole: null,
    scoreDistribution: null,
    scoreDistributionByRole: null,
    failureSignals: null,
    failureSignalsByRole: null,
    componentAveragesByRole: null,
    tenureDistributionByRole: null,
    graceProtectedByRole: null,
    appliedFireThresholdByRole: null,
    nflDepartures: null,
    nflMultiSeed: null,
    retirements: null,
    retirementMultiSeed: null,
    unexpectedScenarios: null,
    unexpectedScenarioMultiSeed: null,
    combinedDepartureMultiSeed: null,
    combinedInitialTurnoverMultiSeed: null,
    fireThresholdSensitivityByRole: null,
    secureThresholdSensitivityByRole: null,
    thresholdNeighborhoods: null,
    lowestEvaluations: []
  };
  if (result.status !== 'ready' || !result.snapshot) return { ...base, status: 'blocked' };

  const market = initializeMarket(result.snapshot);
  const evaluation = evaluatePartOne(result.snapshot, market);
  const defaultDepartures = planPartOneDepartures(result.snapshot, market, evaluation);
  const nflDepartures = defaultDepartures.nfl;
  const retirements = defaultDepartures.retirements;
  const unexpectedScenarios = defaultDepartures.unexpectedScenarios;
  const nflSeedPlans = Array.from({ length: 100 }, (_, index) => {
    const seededMarket = initializeMarket(result.snapshot!, `${market.seed}|NFL-CAL-${String(index).padStart(3, '0')}`);
    return planNflDepartures(result.snapshot!, seededMarket, evaluatePartOne(result.snapshot!, seededMarket));
  });
  const partOneSeedRuns = Array.from({ length: 100 }, (_, index) => {
    const seededMarket = initializeMarket(result.snapshot!, `${market.seed}|PART1-CAL-${String(index).padStart(3, '0')}`);
    const seededEvaluation = evaluatePartOne(result.snapshot!, seededMarket);
    const departures = planPartOneDepartures(result.snapshot!, seededMarket, seededEvaluation);
    const performance = planPerformanceActions(result.snapshot!, seededMarket, seededEvaluation, {
      departedCoachIds: departures.departedCoachIds,
      internalSuccessionTeamIds: departures.internalSuccessionTeamIds
    });
    return { departures, performance };
  });
  const partOneSeedPlans = partOneSeedRuns.map((run) => run.departures);
  const retirementSeedPlans = partOneSeedPlans.map((plan) => plan.retirements);
  const byRole = emptyRoleCounts();
  const signals: Record<string, number> = {};
  const signalsByRole = Object.fromEntries(roles.map((role) => [role, {}])) as Record<MarketRole, Record<string, number>>;
  const componentTotals = Object.fromEntries(roles.map((role) => [role, {}])) as Record<MarketRole, Record<string, { total: number; count: number }>>;
  const tenureDistributionByRole = Object.fromEntries(roles.map((role) => [role, {}])) as Record<MarketRole, Record<string, number>>;
  const graceProtectedByRole = Object.fromEntries(roles.map((role) => [role, 0])) as Record<MarketRole, number>;
  const coachesById = new Map(result.snapshot.coaches.map((coach) => [coach.id, coach]));
  const teamsById = new Map(result.snapshot.teams.map((team) => [team.id, team]));
  for (const item of evaluation.evaluations) {
    const coach = coachesById.get(item.coachId);
    const seasons = coach?.seasonsWithTeam;
    const tenure = seasons === null || seasons === undefined ? 'unknown' : seasons >= 5 ? '5+' : String(seasons);
    tenureDistributionByRole[item.role][tenure] = (tenureDistributionByRole[item.role][tenure] ?? 0) + 1;
    if (item.graceBonus > 0) graceProtectedByRole[item.role] += 1;
    byRole[item.role][item.classification] += 1;
    for (const signal of item.failureSignals) {
      signals[signal.id] = (signals[signal.id] ?? 0) + 1;
      signalsByRole[item.role][signal.id] = (signalsByRole[item.role][signal.id] ?? 0) + 1;
    }
    for (const component of item.components) {
      const current = componentTotals[item.role][component.id] ?? { total: 0, count: 0 };
      current.total += component.score;
      current.count += 1;
      componentTotals[item.role][component.id] = current;
    }
  }
  const componentAveragesByRole = Object.fromEntries(roles.map((role) => [role, Object.fromEntries(
    Object.entries(componentTotals[role]).map(([id, value]) => [id, round(value.total / value.count)])
  )])) as Record<MarketRole, Record<string, number>>;
  const gracePreventedFire = evaluation.evaluations.filter((item) => item.classification !== 'Fire' && item.score <= ROLE_FIRE_SCORE_THRESHOLD[item.role] && item.failureSignals.length >= 2).length;
  const fireThresholdSensitivityByRole = Object.fromEntries([22, 24, 26, 28, 30, 32, 34].map((threshold) => [String(threshold), Object.fromEntries(roles.map((role) => [role,
    evaluation.evaluations.filter((item) => item.role === role && item.score <= threshold && item.failureSignals.length >= 2 && (item.graceBonus === 0 || item.catastrophicFailure)).length
  ]))])) as Record<string, Record<MarketRole, number>>;
  const secureThresholdSensitivityByRole = Object.fromEntries([42, 45, 48].map((threshold) => [String(threshold), Object.fromEntries(roles.map((role) => [role,
    evaluation.evaluations.filter((item) => item.role === role && item.classification !== 'Fire' && item.score >= threshold).length
  ]))])) as Record<string, Record<MarketRole, number>>;
  return {
    ...base,
    status: 'ready',
    nationalChampionship: result.snapshot.nationalChampionship ? {
      winnerTeamId: result.snapshot.nationalChampionship.winnerTeamId,
      winnerTeam: teamsById.get(result.snapshot.nationalChampionship.winnerTeamId)?.longName ?? result.snapshot.nationalChampionship.winnerTeamId,
      loserTeamId: result.snapshot.nationalChampionship.loserTeamId,
      homeScore: result.snapshot.nationalChampionship.homeScore,
      awayScore: result.snapshot.nationalChampionship.awayScore,
      status: result.snapshot.nationalChampionship.status
    } : null,
    evaluationFingerprint: crypto.createHash('sha256').update(JSON.stringify(evaluation.evaluations.map((item) => ({
      seatId: item.seatId,
      score: item.score,
      rawScore: item.rawScore,
      classification: item.classification,
      signals: item.failureSignals.map((signal) => signal.id),
      components: item.components.map((component) => [component.id, component.score])
    })))).digest('hex').toUpperCase(),
    seatCount: evaluation.evaluations.length,
    counts: {
      ...evaluation.counts,
      graceProtected: evaluation.evaluations.filter((item) => item.graceBonus > 0).length,
      gracePreventedFire
    },
    byRole,
    scoreDistribution: distribution(evaluation.evaluations.map((item) => item.score)),
    scoreDistributionByRole: Object.fromEntries(roles.map((role) => [role, distribution(evaluation.evaluations.filter((item) => item.role === role).map((item) => item.score))])) as Record<MarketRole, ScoreDistribution>,
    failureSignals: Object.fromEntries(Object.entries(signals).sort((left, right) => right[1] - left[1])),
    failureSignalsByRole: Object.fromEntries(roles.map((role) => [role, Object.fromEntries(Object.entries(signalsByRole[role]).sort((left, right) => right[1] - left[1]))])) as Record<MarketRole, Record<string, number>>,
    componentAveragesByRole,
    tenureDistributionByRole,
    graceProtectedByRole,
    appliedFireThresholdByRole: ROLE_FIRE_SCORE_THRESHOLD,
    nflDepartures: {
      total: nflDepartures.events.length,
      byRole: Object.fromEntries(roles.map((role) => [role, nflDepartures.events.filter((event) => event.role === role).length])) as Record<MarketRole, number>,
      eligible: nflDepartures.evidence.filter((item) => item.eligible).length,
      passedRoll: nflDepartures.evidence.filter((item) => item.passedRoll).length,
      events: nflDepartures.events.map((event) => ({ coachId: event.coachId, teamId: event.teamId, role: event.role, probability: round(event.probability, 6), roll: round(event.roll, 6) }))
    },
    nflMultiSeed: {
      seeds: nflSeedPlans.length,
      meanTotal: round(nflSeedPlans.reduce((sum, plan) => sum + plan.events.length, 0) / nflSeedPlans.length),
      minimum: Math.min(...nflSeedPlans.map((plan) => plan.events.length)),
      maximum: Math.max(...nflSeedPlans.map((plan) => plan.events.length)),
      zeroRate: round(nflSeedPlans.filter((plan) => plan.events.length === 0).length / nflSeedPlans.length * 100),
      cappedRate: round(nflSeedPlans.filter((plan) => plan.events.length === plan.config.maximumDepartures).length / nflSeedPlans.length * 100),
      meanByRole: Object.fromEntries(roles.map((role) => [role, round(nflSeedPlans.reduce((sum, plan) => sum + plan.events.filter((event) => event.role === role).length, 0) / nflSeedPlans.length)])) as Record<MarketRole, number>
    },
    retirements: {
      total: retirements.events.length,
      retiringOnTop: retirements.events.filter((event) => event.reason === 'RetiringOnTop').length,
      byRole: Object.fromEntries(roles.map((role) => [role, retirements.events.filter((event) => event.role === role).length])) as Record<MarketRole, number>,
      eligible: retirements.evidence.filter((item) => item.eligible).length,
      passedRoll: retirements.evidence.filter((item) => item.passedRoll).length,
      excludedByNfl: retirements.evidence.filter((item) => item.exclusionReason === 'AlreadyDeparted').length,
      events: retirements.events.map((event) => ({ coachId: event.coachId, teamId: event.teamId, role: event.role, reason: event.reason, probability: round(event.probability, 6), roll: round(event.roll, 6) }))
    },
    retirementMultiSeed: {
      seeds: retirementSeedPlans.length,
      meanTotal: round(retirementSeedPlans.reduce((sum, plan) => sum + plan.events.length, 0) / retirementSeedPlans.length),
      meanRetiringOnTop: round(retirementSeedPlans.reduce((sum, plan) => sum + plan.events.filter((event) => event.reason === 'RetiringOnTop').length, 0) / retirementSeedPlans.length),
      seasonsWithRetiringOnTopRate: round(retirementSeedPlans.filter((plan) => plan.events.some((event) => event.reason === 'RetiringOnTop')).length / retirementSeedPlans.length * 100),
      minimum: Math.min(...retirementSeedPlans.map((plan) => plan.events.length)),
      maximum: Math.max(...retirementSeedPlans.map((plan) => plan.events.length)),
      zeroRate: round(retirementSeedPlans.filter((plan) => plan.events.length === 0).length / retirementSeedPlans.length * 100),
      cappedRate: round(retirementSeedPlans.filter((plan) => plan.events.length === plan.config.maximumRetirements).length / retirementSeedPlans.length * 100),
      meanByRole: Object.fromEntries(roles.map((role) => [role, round(retirementSeedPlans.reduce((sum, plan) => sum + plan.events.filter((event) => event.role === role).length, 0) / retirementSeedPlans.length)])) as Record<MarketRole, number>
    },
    unexpectedScenarios: {
      allowance: unexpectedScenarios.allowance.count,
      selected: unexpectedScenarios.outcomes.length,
      applied: unexpectedScenarios.events.length,
      pendingUserDecisions: unexpectedScenarios.pendingDecisions.length,
      cleansHouse: unexpectedScenarios.outcomes.filter((outcome) => outcome.consequence === 'CleansHouse').length,
      categories: Object.fromEntries(['LookingForAChange', 'AthleticDirectorConflict', 'RecruitingComplianceViolation', 'PersonalConductViolation', 'ProgramWideScandal'].map((category) => [category,
        unexpectedScenarios.outcomes.filter((outcome) => outcome.category === category).length
      ])) as Record<UnexpectedScenarioCategory, number>
    },
    unexpectedScenarioMultiSeed: {
      seeds: partOneSeedPlans.length,
      meanSelected: round(partOneSeedPlans.reduce((sum, plan) => sum + plan.unexpectedScenarios.outcomes.length, 0) / partOneSeedPlans.length),
      zeroRate: round(partOneSeedPlans.filter((plan) => plan.unexpectedScenarios.outcomes.length === 0).length / partOneSeedPlans.length * 100),
      oneRate: round(partOneSeedPlans.filter((plan) => plan.unexpectedScenarios.outcomes.length === 1).length / partOneSeedPlans.length * 100),
      twoRate: round(partOneSeedPlans.filter((plan) => plan.unexpectedScenarios.outcomes.length === 2).length / partOneSeedPlans.length * 100),
      meanCleansHouse: round(partOneSeedPlans.reduce((sum, plan) => sum + plan.unexpectedScenarios.outcomes.filter((outcome) => outcome.consequence === 'CleansHouse').length, 0) / partOneSeedPlans.length),
      categories: Object.fromEntries(['LookingForAChange', 'AthleticDirectorConflict', 'RecruitingComplianceViolation', 'PersonalConductViolation', 'ProgramWideScandal'].map((category) => [category,
        partOneSeedPlans.reduce((sum, plan) => sum + plan.unexpectedScenarios.outcomes.filter((outcome) => outcome.category === category).length, 0)
      ])) as Record<UnexpectedScenarioCategory, number>
    },
    combinedDepartureMultiSeed: {
      seeds: partOneSeedPlans.length,
      meanDepartedCoaches: round(partOneSeedPlans.reduce((sum, plan) => sum + plan.departedCoachIds.length, 0) / partOneSeedPlans.length),
      minimum: Math.min(...partOneSeedPlans.map((plan) => plan.departedCoachIds.length)),
      maximum: Math.max(...partOneSeedPlans.map((plan) => plan.departedCoachIds.length)),
      meanByRole: Object.fromEntries(roles.map((role) => [role, round(partOneSeedPlans.reduce((sum, plan) => sum + plan.departedCoachIds.filter((coachId) => {
        const coachRole = result.snapshot!.coaches.find((coach) => coach.id === coachId)?.role;
        return role === 'HC' ? coachRole === 'HeadCoach' : role === 'OC' ? coachRole === 'OffensiveCoordinator' : coachRole === 'DefensiveCoordinator';
      }).length, 0) / partOneSeedPlans.length)])) as Record<MarketRole, number>
    },
    combinedInitialTurnoverMultiSeed: {
      seeds: partOneSeedRuns.length,
      meanChangedSeats: round(partOneSeedRuns.reduce((sum, run) => sum + run.departures.departedCoachIds.length + run.performance.actions.length, 0) / partOneSeedRuns.length),
      minimum: Math.min(...partOneSeedRuns.map((run) => run.departures.departedCoachIds.length + run.performance.actions.length)),
      maximum: Math.max(...partOneSeedRuns.map((run) => run.departures.departedCoachIds.length + run.performance.actions.length)),
      meanByRole: Object.fromEntries(roles.map((role) => [role, round(partOneSeedRuns.reduce((sum, run) => {
        const departureCount = run.departures.departedCoachIds.filter((coachId) => {
          const coachRole = result.snapshot!.coaches.find((coach) => coach.id === coachId)?.role;
          return role === 'HC' ? coachRole === 'HeadCoach' : role === 'OC' ? coachRole === 'OffensiveCoordinator' : coachRole === 'DefensiveCoordinator';
        }).length;
        return sum + departureCount + run.performance.actions.filter((action) => action.role === role).length;
      }, 0) / partOneSeedRuns.length)])) as Record<MarketRole, number>
    },
    fireThresholdSensitivityByRole,
    secureThresholdSensitivityByRole,
    thresholdNeighborhoods: {
      score20to24: evaluation.evaluations.filter((item) => item.score >= 20 && item.score <= 24).length,
      score25to29: evaluation.evaluations.filter((item) => item.score >= 25 && item.score <= 29).length,
      score40to44: evaluation.evaluations.filter((item) => item.score >= 40 && item.score <= 44).length,
      score45to49: evaluation.evaluations.filter((item) => item.score >= 45 && item.score <= 49).length,
      belowRoleFireThresholdInsufficientSignals: evaluation.evaluations.filter((item) => item.score <= ROLE_FIRE_SCORE_THRESHOLD[item.role] && item.failureSignals.length < 2).length,
      gracePreventedFire
    },
    lowestEvaluations: evaluation.evaluations.slice(0, 12).map((item) => outlier(result.snapshot!, item))
  };
}

function aggregateUnique(summaries: CalibrationSaveSummary[], cohort?: Cohort) {
  const seen = new Set<string>();
  const selected = summaries.filter((summary) => {
    const identity = summary.evaluationFingerprint ?? summary.fingerprint;
    if (summary.status !== 'ready' || !identity || (cohort && summary.cohort !== cohort) || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  const roleCounts = emptyRoleCounts();
  const classificationsTotal = { Fire: 0, Vulnerable: 0, Secure: 0 };
  const failureSignals: Record<string, number> = {};
  const scoreValues: number[] = [];
  for (const summary of selected) {
    for (const role of roles) for (const classification of classifications) roleCounts[role][classification] += summary.byRole?.[role][classification] ?? 0;
    for (const classification of classifications) classificationsTotal[classification] += summary.counts?.[classification] ?? 0;
    for (const [signal, count] of Object.entries(summary.failureSignals ?? {})) failureSignals[signal] = (failureSignals[signal] ?? 0) + count;
    for (const [range, count] of Object.entries(summary.scoreDistribution?.histogram ?? {})) {
      const midpoint = Math.min(100, Number(range.split('-')[0]) + 2);
      scoreValues.push(...Array(count).fill(midpoint));
    }
  }
  const seats = selected.reduce((sum, summary) => sum + summary.seatCount, 0);
  return {
    uniqueSaveCount: selected.length,
    seats,
    classificationCounts: classificationsTotal,
    classificationRates: Object.fromEntries(classifications.map((classification) => [classification, round(classificationsTotal[classification] / Math.max(1, seats) * 100)])),
    byRole: roleCounts,
    approximateScoreDistribution: distribution(scoreValues),
    failureSignals: Object.fromEntries(Object.entries(failureSignals).sort((left, right) => right[1] - left[1])),
    saves: selected.map((summary) => ({ name: summary.file.name, fingerprint: summary.fingerprint, evaluationFingerprint: summary.evaluationFingerprint, counts: summary.counts, byRole: summary.byRole, scores: summary.scoreDistribution, failureSignalsByRole: summary.failureSignalsByRole, componentAveragesByRole: summary.componentAveragesByRole, tenureDistributionByRole: summary.tenureDistributionByRole, graceProtectedByRole: summary.graceProtectedByRole, fireThresholdSensitivityByRole: summary.fireThresholdSensitivityByRole, secureThresholdSensitivityByRole: summary.secureThresholdSensitivityByRole, thresholdNeighborhoods: summary.thresholdNeighborhoods }))
  };
}

export function buildCalibrationReport(summaries: CalibrationSaveSummary[]) {
  const readyFingerprintCounts: Record<string, number> = {};
  const evaluationFingerprintCounts: Record<string, number> = {};
  for (const summary of summaries) {
    if (summary.status === 'ready' && summary.fingerprint) readyFingerprintCounts[summary.fingerprint] = (readyFingerprintCounts[summary.fingerprint] ?? 0) + 1;
    if (summary.status === 'ready' && summary.evaluationFingerprint) evaluationFingerprintCounts[summary.evaluationFingerprint] = (evaluationFingerprintCounts[summary.evaluationFingerprint] ?? 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    inventory: {
      files: summaries.length,
      ready: summaries.filter((summary) => summary.status === 'ready').length,
      blocked: summaries.filter((summary) => summary.status === 'blocked').length,
      errors: summaries.filter((summary) => summary.status === 'error').length,
      uniqueReadyFingerprints: Object.keys(readyFingerprintCounts).length,
      duplicateReadyFiles: Object.values(readyFingerprintCounts).reduce((sum, count) => sum + Math.max(0, count - 1), 0),
      uniqueEvaluationLandscapes: Object.keys(evaluationFingerprintCounts).length,
      duplicateEvaluationLandscapes: Object.values(evaluationFingerprintCounts).reduce((sum, count) => sum + Math.max(0, count - 1), 0),
      blockedReasons: summaries.filter((summary) => summary.status === 'blocked').flatMap((summary) => summary.issueCodes).reduce<Record<string, number>>((counts, code) => ({ ...counts, [code]: (counts[code] ?? 0) + 1 }), {})
    },
    aggregates: {
      allUniqueReady: aggregateUnique(summaries),
      naturalUniqueReady: aggregateUnique(summaries, 'natural'),
      experimentalUniqueReady: aggregateUnique(summaries, 'experimental')
    },
    saves: summaries.sort((left, right) => left.file.name.localeCompare(right.file.name) || left.file.path.localeCompare(right.file.path))
  };
}

export function calibrationError(filePath: string, error: unknown): CalibrationSaveSummary {
  return {
    file: { name: path.basename(filePath), path: filePath, sizeBytes: 0 },
    status: 'error', cohort: cohortFor(path.basename(filePath)), checkpoint: null, issueCodes: [], fingerprint: null, evaluationFingerprint: null,
    seasonYear: null, nationalChampionship: null, seatCount: 0, counts: null, byRole: null, scoreDistribution: null, scoreDistributionByRole: null,
    failureSignals: null, failureSignalsByRole: null, componentAveragesByRole: null, tenureDistributionByRole: null, graceProtectedByRole: null, appliedFireThresholdByRole: null, nflDepartures: null, nflMultiSeed: null, retirements: null, retirementMultiSeed: null, unexpectedScenarios: null, unexpectedScenarioMultiSeed: null, combinedDepartureMultiSeed: null, combinedInitialTurnoverMultiSeed: null,
    fireThresholdSensitivityByRole: null, secureThresholdSensitivityByRole: null, thresholdNeighborhoods: null, lowestEvaluations: [],
    error: error instanceof Error ? error.message : String(error)
  };
}
