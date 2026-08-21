import type { DynastySnapshot, NormalizedCoach } from './dynasty';
import type { MarketBaseline, MarketRole } from './market';
import { auditedRoll } from './seeded-random';

export interface RetirementConfig {
  minimumAge: number;
  baseProbabilityAtMinimumAge: number;
  annualAgeIncrease: number;
  losingSeasonBonus: number;
  expiringContractBonus: number;
  multiYearContractReduction: number;
  longCareerThreshold: number;
  longCareerBonusPerYear: number;
  maximumLongCareerBonus: number;
  retiringOnTopBonus: number;
  maximumIndividualProbability: number;
  maximumRetirements: number;
  mandatoryRetirementAge: number | null;
}

export const INITIAL_RETIREMENT_CONFIG: Readonly<RetirementConfig> = {
  minimumAge: 61,
  baseProbabilityAtMinimumAge: 0.015,
  annualAgeIncrease: 0.012,
  losingSeasonBonus: 0.02,
  expiringContractBonus: 0.012,
  multiYearContractReduction: 0.004,
  longCareerThreshold: 30,
  longCareerBonusPerYear: 0.001,
  maximumLongCareerBonus: 0.02,
  retiringOnTopBonus: 0.06,
  maximumIndividualProbability: 0.5,
  maximumRetirements: 10,
  mandatoryRetirementAge: null
};

export interface RetirementEvidence {
  coachId: string;
  teamId: string;
  role: MarketRole;
  age: number | null;
  eligible: boolean;
  exclusionReason: 'AlreadyDeparted' | 'MissingAge' | 'BelowMinimumAge' | null;
  factors: {
    ageProbability: number;
    losingSeasonBonus: number;
    contractModifier: number;
    longCareerBonus: number;
    retiringOnTopBonus: number;
  };
  probability: number;
  roll: number;
  passedRoll: boolean;
  selected: boolean;
  mandatory: boolean;
  retiringOnTop: boolean;
  userControlled: boolean;
}

export interface RetirementEvent {
  id: string;
  coachId: string;
  teamId: string;
  role: MarketRole;
  reason: 'Retirement' | 'RetiringOnTop';
  consequence: 'InternalSuccessionReview' | 'CoordinatorVacancy';
  probability: number;
  roll: number;
  userControlled: boolean;
}

export interface RetirementPlan {
  status: 'retirements-planned';
  sourceFingerprint: string;
  seed: string;
  config: RetirementConfig;
  events: RetirementEvent[];
  evidence: RetirementEvidence[];
  retiredCoachIds: string[];
  internalSuccessionTeamIds: string[];
  coordinatorVacancies: Array<{ id: string; teamId: string; role: 'OC' | 'DC'; previousCoachId: string; reason: 'Retirement' | 'RetiringOnTop' }>;
}

export interface RetirementOptions {
  departedCoachIds?: readonly string[];
  nationalChampionTeamId?: string | null;
}

export class RetirementPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetirementPlanningError';
  }
}

const clamp = (value: number, minimum = 0, maximum = 1): number => Math.max(minimum, Math.min(maximum, value));
const losingSeason = (coach: NormalizedCoach): boolean => coach.resume.season.losses > coach.resume.season.wins;

export function planRetirements(
  snapshot: DynastySnapshot,
  market: MarketBaseline,
  options: RetirementOptions = {},
  config: RetirementConfig = INITIAL_RETIREMENT_CONFIG
): RetirementPlan {
  if (snapshot.sourceFingerprint !== market.sourceFingerprint) {
    throw new RetirementPlanningError('Snapshot and market baseline do not describe the same source save.');
  }
  if (config.minimumAge < 0 || config.maximumRetirements < 0) throw new RetirementPlanningError('Retirement configuration is invalid.');

  const coaches = new Map(snapshot.coaches.map((coach) => [coach.id, coach]));
  const departed = new Set(options.departedCoachIds ?? []);
  const evidence = market.seats.map((seat): RetirementEvidence => {
    const coach = coaches.get(seat.incumbentCoachId);
    if (!coach) throw new RetirementPlanningError(`Cannot evaluate retirement for ${seat.id}.`);
    const age = coach.age;
    const exclusionReason = departed.has(coach.id)
      ? 'AlreadyDeparted'
      : age === null ? 'MissingAge'
      : age < config.minimumAge ? 'BelowMinimumAge' : null;
    const eligible = exclusionReason === null;
    const mandatory = eligible && config.mandatoryRetirementAge !== null && age! >= config.mandatoryRetirementAge;
    const retiringOnTop = eligible && options.nationalChampionTeamId === seat.teamId;
    const ageProbability = eligible
      ? Math.max(0, config.baseProbabilityAtMinimumAge + (age! - config.minimumAge) * config.annualAgeIncrease)
      : 0;
    const yearsRemaining = coach.contract.yearsRemaining;
    const contractModifier = !eligible ? 0
      : yearsRemaining === null ? 0
      : yearsRemaining <= 0 ? config.expiringContractBonus
      : yearsRemaining > 1 ? -config.multiYearContractReduction * (yearsRemaining - 1) : 0;
    const yearsCoaching = coach.yearsCoaching ?? Math.max(0, (age ?? config.minimumAge) - 30);
    const longCareerBonus = eligible
      ? Math.min(config.maximumLongCareerBonus, Math.max(0, yearsCoaching - config.longCareerThreshold) * config.longCareerBonusPerYear)
      : 0;
    const factors = {
      ageProbability,
      losingSeasonBonus: eligible && losingSeason(coach) ? config.losingSeasonBonus : 0,
      contractModifier,
      longCareerBonus,
      retiringOnTopBonus: retiringOnTop ? config.retiringOnTopBonus : 0
    };
    const probability = mandatory ? 1 : eligible ? clamp(
      factors.ageProbability + factors.losingSeasonBonus + factors.contractModifier + factors.longCareerBonus + factors.retiringOnTopBonus,
      0,
      config.maximumIndividualProbability
    ) : 0;
    const roll = auditedRoll(market.seed, `retirement:${coach.id}`, probability);
    return {
      coachId: coach.id, teamId: seat.teamId, role: seat.role, age, eligible, exclusionReason, factors,
      probability: roll.probability, roll: roll.roll, passedRoll: roll.selected, selected: false,
      mandatory, retiringOnTop, userControlled: coach.userControlled
    };
  });

  const selectedIds = new Set(evidence
    .filter((candidate) => candidate.passedRoll)
    .sort((left, right) => Number(right.mandatory) - Number(left.mandatory)
      || (left.roll / Math.max(left.probability, Number.EPSILON)) - (right.roll / Math.max(right.probability, Number.EPSILON))
      || left.coachId.localeCompare(right.coachId))
    .slice(0, Math.max(0, Math.floor(config.maximumRetirements)))
    .map((candidate) => candidate.coachId));
  for (const candidate of evidence) candidate.selected = selectedIds.has(candidate.coachId);

  const events = evidence.filter((candidate) => candidate.selected).map((candidate): RetirementEvent => ({
    id: `retirement:${candidate.coachId}`,
    coachId: candidate.coachId,
    teamId: candidate.teamId,
    role: candidate.role,
    reason: candidate.retiringOnTop ? 'RetiringOnTop' : 'Retirement',
    consequence: candidate.role === 'HC' ? 'InternalSuccessionReview' : 'CoordinatorVacancy',
    probability: candidate.probability,
    roll: candidate.roll,
    userControlled: candidate.userControlled
  }));
  return {
    status: 'retirements-planned', sourceFingerprint: snapshot.sourceFingerprint, seed: market.seed,
    config: { ...config }, events, evidence,
    retiredCoachIds: events.map((event) => event.coachId),
    internalSuccessionTeamIds: events.filter((event) => event.role === 'HC').map((event) => event.teamId),
    coordinatorVacancies: events.filter((event): event is RetirementEvent & { role: 'OC' | 'DC' } => event.role !== 'HC').map((event) => ({
      id: `retirement-vacancy:${event.teamId}:${event.role}`, teamId: event.teamId, role: event.role,
      previousCoachId: event.coachId, reason: event.reason
    }))
  };
}
