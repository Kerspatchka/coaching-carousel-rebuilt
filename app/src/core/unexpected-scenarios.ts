import type { DynastySnapshot, NormalizedCoach } from './dynasty';
import type { MarketBaseline, MarketRole } from './market';
import { auditedRoll, weightedSelection } from './seeded-random';
import { isFcsProgram } from './team-classification';

export type UnexpectedScenarioCategory =
  | 'LookingForAChange'
  | 'AthleticDirectorConflict'
  | 'RecruitingComplianceViolation'
  | 'PersonalConductViolation'
  | 'ProgramWideScandal';
export type UnexpectedScenarioDecision = 'accept' | 'nullify';

export interface UnexpectedScenarioConfig {
  enabled: boolean;
  firstScenarioProbability: number;
  secondScenarioProbability: number;
  maximumScenarios: number;
  headCoachTargetWeight: number;
  coordinatorTargetWeight: number;
  categoryWeights: Record<UnexpectedScenarioCategory, number>;
  recruitingCleansHouseProbability: number;
  conductCleansHouseProbability: number;
  userControlledHcProtection: boolean;
}

export const INITIAL_UNEXPECTED_SCENARIO_CONFIG: Readonly<UnexpectedScenarioConfig> = {
  enabled: true,
  firstScenarioProbability: 0.45,
  secondScenarioProbability: 0.11,
  maximumScenarios: 2,
  headCoachTargetWeight: 1.35,
  coordinatorTargetWeight: 1,
  categoryWeights: {
    LookingForAChange: 40,
    AthleticDirectorConflict: 18,
    RecruitingComplianceViolation: 20,
    PersonalConductViolation: 18,
    ProgramWideScandal: 4
  },
  recruitingCleansHouseProbability: 0.2,
  conductCleansHouseProbability: 0.08,
  userControlledHcProtection: true
};

export interface UnexpectedScenarioTargetEvidence {
  coachId: string;
  teamId: string;
  role: MarketRole;
  eligible: boolean;
  exclusionReason: 'AlreadyDeparted' | 'TeamAlreadyAffected' | 'FcsProgram' | null;
  weight: number;
  roll: number;
  priority: number | null;
  selected: boolean;
}

export interface UnexpectedScenarioOutcome {
  id: string;
  targetCoachId: string;
  teamId: string;
  role: MarketRole;
  category: UnexpectedScenarioCategory;
  consequence: 'CoachRemoved' | 'CleansHouse';
  candidatePoolDisposition: 'Available' | 'Unavailable';
  affectedCoachIds: string[];
  requiresUserDecision: boolean;
  decision: UnexpectedScenarioDecision | null;
  applied: boolean;
  fictionalSimulation: true;
  severityRoll: number | null;
}

export interface UnexpectedScenarioPlan {
  status: 'unexpected-scenarios-planned';
  sourceFingerprint: string;
  seed: string;
  config: UnexpectedScenarioConfig;
  allowance: { firstRoll: number; secondRoll: number | null; count: number };
  targetEvidence: UnexpectedScenarioTargetEvidence[];
  outcomes: UnexpectedScenarioOutcome[];
  events: UnexpectedScenarioOutcome[];
  pendingDecisions: Array<{ id: string; scenarioId: string; teamId: string; userCoachId: string; choices: ['accept', 'nullify'] }>;
  nullifiedScenarioIds: string[];
  departedCoachIds: string[];
  availableCoachIds: string[];
  internalSuccessionTeamIds: string[];
  vacancies: Array<{ id: string; teamId: string; role: MarketRole; previousCoachId: string; reason: 'UnexpectedScenario' }>;
}

export interface UnexpectedScenarioOptions {
  departedCoachIds?: readonly string[];
  affectedTeamIds?: readonly string[];
  userDecisions?: Readonly<Record<string, UnexpectedScenarioDecision>>;
}

export class UnexpectedScenarioPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnexpectedScenarioPlanningError';
  }
}

const categories: UnexpectedScenarioCategory[] = [
  'LookingForAChange', 'AthleticDirectorConflict', 'RecruitingComplianceViolation',
  'PersonalConductViolation', 'ProgramWideScandal'
];

function categoryFor(seed: string, coachId: string, role: MarketRole, config: UnexpectedScenarioConfig): UnexpectedScenarioCategory {
  const evidence = weightedSelection(seed, `unexpected-category:${coachId}`, categories.map((category) => ({
    id: category,
    weight: (category === 'AthleticDirectorConflict' || category === 'ProgramWideScandal') && role !== 'HC'
      ? 0
      : Math.max(0, config.categoryWeights[category])
  })), 1);
  const selected = evidence.find((item) => item.selected)?.id as UnexpectedScenarioCategory | undefined;
  if (!selected) throw new UnexpectedScenarioPlanningError(`No Unexpected Scenario category is available for ${coachId}.`);
  return selected;
}

export function planUnexpectedScenarios(
  snapshot: DynastySnapshot,
  market: MarketBaseline,
  options: UnexpectedScenarioOptions = {},
  config: UnexpectedScenarioConfig = INITIAL_UNEXPECTED_SCENARIO_CONFIG
): UnexpectedScenarioPlan {
  if (snapshot.sourceFingerprint !== market.sourceFingerprint) {
    throw new UnexpectedScenarioPlanningError('Snapshot and market baseline do not describe the same source save.');
  }
  const first = auditedRoll(market.seed, 'unexpected-allowance:first', config.enabled ? config.firstScenarioProbability : 0);
  const second = first.selected && config.maximumScenarios > 1
    ? auditedRoll(market.seed, 'unexpected-allowance:second', config.secondScenarioProbability)
    : null;
  const allowanceCount = Math.min(Math.max(0, Math.floor(config.maximumScenarios)), first.selected ? 1 + Number(second?.selected ?? false) : 0);
  const departed = new Set(options.departedCoachIds ?? []);
  const affectedTeams = new Set(options.affectedTeamIds ?? []);
  const fcsTeamIds = new Set(snapshot.teams.filter(isFcsProgram).map((team) => team.id));
  const coaches = new Map(snapshot.coaches.map((coach) => [coach.id, coach]));
  const seatsByTeam = new Map<string, MarketBaseline['seats']>();
  for (const seat of market.seats) seatsByTeam.set(seat.teamId, [...(seatsByTeam.get(seat.teamId) ?? []), seat]);

  const ranked = weightedSelection(market.seed, 'unexpected-targets', market.seats.map((seat) => ({
    id: seat.incumbentCoachId,
    weight: departed.has(seat.incumbentCoachId) || affectedTeams.has(seat.teamId) || fcsTeamIds.has(seat.teamId)
      ? 0
      : seat.role === 'HC' ? config.headCoachTargetWeight : config.coordinatorTargetWeight
  })), market.seats.length).sort((left, right) => (left.priority ?? Infinity) - (right.priority ?? Infinity) || left.id.localeCompare(right.id));
  const selectedCoachIds = new Set<string>();
  const selectedTeamIds = new Set<string>();
  for (const candidate of ranked) {
    if (selectedCoachIds.size >= allowanceCount) break;
    const seat = market.seats.find((item) => item.incumbentCoachId === candidate.id)!;
    if (candidate.weight <= 0 || selectedTeamIds.has(seat.teamId)) continue;
    selectedCoachIds.add(candidate.id);
    selectedTeamIds.add(seat.teamId);
  }
  const targetEvidence = market.seats.map((seat): UnexpectedScenarioTargetEvidence => {
    const selection = ranked.find((item) => item.id === seat.incumbentCoachId)!;
    const exclusionReason = departed.has(seat.incumbentCoachId)
      ? 'AlreadyDeparted'
      : affectedTeams.has(seat.teamId) ? 'TeamAlreadyAffected'
      : fcsTeamIds.has(seat.teamId) ? 'FcsProgram' : null;
    return {
      coachId: seat.incumbentCoachId, teamId: seat.teamId, role: seat.role,
      eligible: exclusionReason === null, exclusionReason, weight: selection.weight,
      roll: selection.roll, priority: selection.priority, selected: selectedCoachIds.has(seat.incumbentCoachId)
    };
  });

  const outcomes = targetEvidence.filter((target) => target.selected).map((target, index): UnexpectedScenarioOutcome => {
    const category = categoryFor(market.seed, target.coachId, target.role, config);
    const severityProbability = category === 'ProgramWideScandal' ? 1
      : category === 'RecruitingComplianceViolation' ? config.recruitingCleansHouseProbability
      : category === 'PersonalConductViolation' ? config.conductCleansHouseProbability : 0;
    const severity = severityProbability > 0
      ? auditedRoll(market.seed, `unexpected-severity:${target.coachId}:${category}`, severityProbability)
      : null;
    const consequence = severity?.selected ? 'CleansHouse' : 'CoachRemoved';
    const affectedCoachIds = consequence === 'CleansHouse'
      ? (seatsByTeam.get(target.teamId) ?? []).map((seat) => seat.incumbentCoachId)
      : [target.coachId];
    const userHc = affectedCoachIds.map((id) => coaches.get(id)).find((coach): coach is NormalizedCoach => Boolean(coach?.userControlled && coach.role === 'HeadCoach'));
    const id = `unexpected:${index + 1}:${target.coachId}`;
    const requiresUserDecision = config.userControlledHcProtection && Boolean(userHc);
    const decision = requiresUserDecision ? options.userDecisions?.[id] ?? null : 'accept';
    return {
      id, targetCoachId: target.coachId, teamId: target.teamId, role: target.role, category, consequence,
      candidatePoolDisposition: category === 'LookingForAChange' ? 'Available' : 'Unavailable',
      affectedCoachIds, requiresUserDecision, decision, applied: decision === 'accept', fictionalSimulation: true,
      severityRoll: severity?.roll ?? null
    };
  });
  const events = outcomes.filter((outcome) => outcome.applied);
  const pendingDecisions = outcomes.filter((outcome) => outcome.requiresUserDecision && outcome.decision === null).map((outcome) => {
    const userCoachId = outcome.affectedCoachIds.find((id) => coaches.get(id)?.userControlled && coaches.get(id)?.role === 'HeadCoach')!;
    return { id: `unexpected-decision:${outcome.id}`, scenarioId: outcome.id, teamId: outcome.teamId, userCoachId, choices: ['accept', 'nullify'] as ['accept', 'nullify'] };
  });
  const departedCoachIds = events.flatMap((event) => event.affectedCoachIds);
  const availableCoachIds = events
    .filter((event) => event.candidatePoolDisposition === 'Available')
    .map((event) => event.targetCoachId);
  const vacancies = events.flatMap((event) => event.affectedCoachIds.map((coachId) => {
    const seat = market.seats.find((candidate) => candidate.incumbentCoachId === coachId)!;
    return { id: `unexpected-vacancy:${event.id}:${seat.role}`, teamId: seat.teamId, role: seat.role, previousCoachId: coachId, reason: 'UnexpectedScenario' as const };
  }));
  return {
    status: 'unexpected-scenarios-planned', sourceFingerprint: snapshot.sourceFingerprint, seed: market.seed,
    config: { ...config, categoryWeights: { ...config.categoryWeights } },
    allowance: { firstRoll: first.roll, secondRoll: second?.roll ?? null, count: allowanceCount },
    targetEvidence, outcomes, events, pendingDecisions,
    nullifiedScenarioIds: outcomes.filter((outcome) => outcome.decision === 'nullify').map((outcome) => outcome.id),
    departedCoachIds,
    availableCoachIds,
    internalSuccessionTeamIds: events.filter((event) => event.consequence === 'CoachRemoved' && event.role === 'HC').map((event) => event.teamId),
    vacancies
  };
}
