import type { DynastyRecord, DynastySnapshot, NormalizedCoach } from './dynasty';
import type { PartOneEvaluation } from './evaluation';
import type { MarketBaseline, MarketRole } from './market';
import { auditedRoll } from './seeded-random';
import { isFcsProgram } from './team-classification';

export interface NflDepartureConfig {
  headCoachBaseProbability: number;
  coordinatorBaseProbability: number;
  minimumEvaluationScore: number;
  maximumIndividualProbability: number;
  maximumDepartures: number;
  weights: {
    performance: number;
    prestige: number;
    resume: number;
    careerWindow: number;
  };
}

export const INITIAL_NFL_DEPARTURE_CONFIG: Readonly<NflDepartureConfig> = {
  headCoachBaseProbability: 0.005,
  coordinatorBaseProbability: 0.0135,
  minimumEvaluationScore: 60,
  maximumIndividualProbability: 0.05,
  maximumDepartures: 5,
  weights: { performance: 0.45, prestige: 0.2, resume: 0.2, careerWindow: 0.15 }
};

export interface NflDepartureEvidence {
  coachId: string;
  teamId: string;
  role: MarketRole;
  eligible: boolean;
  exclusionReason: 'FcsProgram' | 'UserControlledDeferred' | 'BelowPerformanceFloor' | null;
  factors: { performance: number; prestige: number; resume: number; careerWindow: number; attractiveness: number };
  probability: number;
  roll: number;
  passedRoll: boolean;
  selected: boolean;
}

export interface NflDepartureEvent {
  id: string;
  coachId: string;
  teamId: string;
  role: MarketRole;
  destination: 'NFL';
  consequence: 'InternalSuccessionReview' | 'CoordinatorVacancy';
  probability: number;
  roll: number;
}

export interface NflDeparturePlan {
  status: 'nfl-departures-planned';
  sourceFingerprint: string;
  seed: string;
  config: NflDepartureConfig;
  events: NflDepartureEvent[];
  evidence: NflDepartureEvidence[];
  departedCoachIds: string[];
  internalSuccessionTeamIds: string[];
  coordinatorVacancies: Array<{ id: string; teamId: string; role: 'OC' | 'DC'; previousCoachId: string; reason: 'NFLDeparture' }>;
}

export class NflDeparturePlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NflDeparturePlanningError';
  }
}

const clamp = (value: number, minimum = 0, maximum = 1): number => Math.max(minimum, Math.min(maximum, value));
const winPercentage = (record: DynastyRecord): number => {
  const games = record.wins + record.losses + record.ties;
  return games ? clamp((record.wins + record.ties * 0.5) / games) : 0.5;
};
const percentile = (value: number | null, population: Array<number | null>): number => {
  if (value === null) return 0.5;
  const values = population.filter((item): item is number => item !== null).sort((left, right) => left - right);
  if (values.length < 2) return 0.5;
  return clamp(values.filter((item) => item < value).length / (values.length - 1));
};
const careerWindow = (coach: NormalizedCoach, role: MarketRole): number => {
  if (coach.age === null) return 0.5;
  const ideal = role === 'HC' ? 48 : 42;
  return clamp(1 - Math.abs(coach.age - ideal) / 24);
};

export function planNflDepartures(
  snapshot: DynastySnapshot,
  market: MarketBaseline,
  evaluation: PartOneEvaluation,
  config: NflDepartureConfig = INITIAL_NFL_DEPARTURE_CONFIG
): NflDeparturePlan {
  if (snapshot.sourceFingerprint !== market.sourceFingerprint || snapshot.sourceFingerprint !== evaluation.sourceFingerprint) {
    throw new NflDeparturePlanningError('Snapshot, market baseline, and evaluation do not describe the same source save.');
  }
  if (market.seed !== evaluation.seed) throw new NflDeparturePlanningError('Market baseline and evaluation do not use the same run seed.');
  const weightTotal = Object.values(config.weights).reduce((sum, value) => sum + Math.max(0, value), 0);
  if (weightTotal <= 0) throw new NflDeparturePlanningError('NFL departure factor weights must contain a positive value.');

  const coaches = new Map(snapshot.coaches.map((coach) => [coach.id, coach]));
  const evaluations = new Map(evaluation.evaluations.map((item) => [item.seatId, item]));
  const teams = new Map(snapshot.teams.map((team) => [team.id, team]));
  const prestigePopulation = market.seats.map((seat) => coaches.get(seat.incumbentCoachId)?.prestigeScore ?? null);
  const evidence: NflDepartureEvidence[] = market.seats.map((seat) => {
    const coach = coaches.get(seat.incumbentCoachId);
    const coachEvaluation = evaluations.get(seat.id);
    if (!coach || !coachEvaluation) throw new NflDeparturePlanningError(`Cannot evaluate NFL departure for ${seat.id}.`);
    const factors = {
      performance: clamp(coachEvaluation.score / 100),
      prestige: percentile(coach.prestigeScore, prestigePopulation),
      resume: winPercentage(coach.resume.career),
      careerWindow: careerWindow(coach, seat.role),
      attractiveness: 0
    };
    factors.attractiveness = (
      factors.performance * Math.max(0, config.weights.performance)
      + factors.prestige * Math.max(0, config.weights.prestige)
      + factors.resume * Math.max(0, config.weights.resume)
      + factors.careerWindow * Math.max(0, config.weights.careerWindow)
    ) / weightTotal;
    const team = teams.get(seat.teamId);
    const exclusionReason = team && isFcsProgram(team)
      ? 'FcsProgram'
      : coach.userControlled
      ? 'UserControlledDeferred'
      : coachEvaluation.score < config.minimumEvaluationScore ? 'BelowPerformanceFloor' : null;
    const eligible = exclusionReason === null;
    const base = seat.role === 'HC' ? config.headCoachBaseProbability : config.coordinatorBaseProbability;
    const probability = eligible ? clamp(base * (0.4 + factors.attractiveness * 1.2), 0, config.maximumIndividualProbability) : 0;
    const roll = auditedRoll(market.seed, `nfl-departure:${coach.id}`, probability);
    return {
      coachId: coach.id, teamId: seat.teamId, role: seat.role, eligible, exclusionReason, factors,
      probability: roll.probability, roll: roll.roll, passedRoll: roll.selected, selected: false
    };
  });

  const selectedIds = new Set(evidence
    .filter((candidate) => candidate.passedRoll)
    .sort((left, right) => (left.roll / left.probability) - (right.roll / right.probability) || left.coachId.localeCompare(right.coachId))
    .slice(0, Math.max(0, Math.floor(config.maximumDepartures)))
    .map((candidate) => candidate.coachId));
  for (const candidate of evidence) candidate.selected = selectedIds.has(candidate.coachId);

  const events = evidence.filter((candidate) => candidate.selected).map((candidate): NflDepartureEvent => ({
    id: `nfl-departure:${candidate.coachId}`,
    coachId: candidate.coachId,
    teamId: candidate.teamId,
    role: candidate.role,
    destination: 'NFL',
    consequence: candidate.role === 'HC' ? 'InternalSuccessionReview' : 'CoordinatorVacancy',
    probability: candidate.probability,
    roll: candidate.roll
  }));
  return {
    status: 'nfl-departures-planned', sourceFingerprint: snapshot.sourceFingerprint, seed: market.seed,
    config: { ...config, weights: { ...config.weights } }, events, evidence,
    departedCoachIds: events.map((event) => event.coachId),
    internalSuccessionTeamIds: events.filter((event) => event.role === 'HC').map((event) => event.teamId),
    coordinatorVacancies: events.filter((event): event is NflDepartureEvent & { role: 'OC' | 'DC' } => event.role !== 'HC').map((event) => ({
      id: `nfl-vacancy:${event.teamId}:${event.role}`, teamId: event.teamId, role: event.role,
      previousCoachId: event.coachId, reason: 'NFLDeparture'
    }))
  };
}
