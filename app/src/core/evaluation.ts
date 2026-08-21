import type { DynastyRecord, DynastySnapshot, NormalizedCoach, NormalizedTeam } from './dynasty';
import type { MarketBaseline, MarketRole } from './market';

export type JobEvaluationClassification = 'Fire' | 'Vulnerable' | 'Secure';

export interface EvaluationComponent {
  id: string;
  label: string;
  weight: number;
  score: number;
  detail: string;
}

export interface FailureSignal {
  id: string;
  label: string;
  severe: boolean;
}

export interface CoachEvaluation {
  seatId: string;
  teamId: string;
  coachId: string;
  role: MarketRole;
  rawScore: number;
  graceBonus: number;
  score: number;
  classification: JobEvaluationClassification;
  components: EvaluationComponent[];
  failureSignals: FailureSignal[];
  catastrophicFailure: boolean;
  marketReviewProtected: boolean;
  userConfirmationRequired: boolean;
  unitOverachievement: number | null;
}

export interface PartOneEvaluation {
  status: 'evaluated';
  sourceFingerprint: string;
  seed: string;
  evaluations: CoachEvaluation[];
  counts: Record<JobEvaluationClassification, number> & { catastrophic: number; userProtected: number };
}

export const ROLE_FIRE_SCORE_THRESHOLD: Readonly<Record<MarketRole, number>> = {
  HC: 32,
  OC: 24,
  DC: 32
};

const clamp = (value: number, minimum = 0, maximum = 1): number => Math.max(minimum, Math.min(maximum, value));
const round = (value: number): number => Math.round(value);
const winPercentage = (record: DynastyRecord): number => {
  const games = record.wins + record.losses + record.ties;
  return games ? (record.wins + record.ties * 0.5) / games : 0.5;
};
const weighted = (id: string, label: string, weight: number, retention: number, detail: string): EvaluationComponent => ({
  id, label, weight, score: round(weight * clamp(retention)), detail
});
const ordinalPercentile = (value: number | null, population: Array<number | null>): number => {
  if (value === null) return 0.5;
  const values = population.filter((item): item is number => item !== null).sort((left, right) => left - right);
  if (values.length < 2) return 0.5;
  const below = values.filter((item) => item < value).length;
  const equal = values.filter((item) => item === value).length;
  return clamp((below + Math.max(0, equal - 1) / 2) / (values.length - 1));
};
const rankPercentile = (rank: number | null, teamCount: number): number =>
  rank === null || rank < 0 || rank >= teamCount ? 0.5 : clamp(1 - rank / Math.max(1, teamCount - 1));

function contractRatios(coach: NormalizedCoach, team: NormalizedTeam): Array<number | null> {
  return coach.contractPerformance.earnedPoints.map((earned, index) => {
    const expected = team.performance.expectedContractPoints[index] ?? null;
    // Prior-year zero is ambiguous for a new Coach, so it is treated as
    // unavailable. Current-year zero remains a real result when an expectation exists.
    if (expected === null || expected <= 0 || earned === null || (index > 0 && earned === 0)) return null;
    return earned / expected;
  });
}

function contractRetention(ratio: number | null): number {
  return ratio === null ? 0.55 : clamp((ratio - 0.45) / 0.8);
}

function trendRetention(ratios: Array<number | null>): number {
  const available = ratios.filter((ratio): ratio is number => ratio !== null);
  if (available.length < 2) return available.length ? contractRetention(available[0]!) : 0.55;
  const current = ratios[0] ?? available[0]!;
  const oldest = [...ratios].reverse().find((ratio): ratio is number => ratio !== null) ?? current;
  return clamp(contractRetention(current) * 0.7 + clamp(0.5 + (current - oldest) * 0.5) * 0.3);
}

function securityRetention(coach: NormalizedCoach): number {
  const percentage = coach.jobSecurity.percentage === null ? 0.55 : coach.jobSecurity.percentage / 100;
  if (coach.jobSecurity.status === 'HotSeat') return Math.min(percentage, 0.2);
  if (coach.jobSecurity.status === 'Low') return Math.min(percentage, 0.4);
  return clamp(percentage);
}

function expectedWinPercentage(team: NormalizedTeam, snapshot: DynastySnapshot): number {
  const talent = ordinalPercentile(team.ratings.overall, snapshot.teams.map((candidate) => candidate.ratings.overall));
  const prestige = team.prestige === null ? 0.5 : clamp(team.prestige / 10);
  return clamp(0.22 + talent * 0.42 + prestige * 0.22, 0.2, 0.82);
}

function credibilityRetention(coach: NormalizedCoach, snapshot: DynastySnapshot): number {
  const career = winPercentage(coach.resume.career);
  const prestige = ordinalPercentile(coach.prestigeScore, snapshot.coaches.map((candidate) => candidate.prestigeScore));
  return clamp(career * 0.6 + prestige * 0.4);
}

function tenureRetention(coach: NormalizedCoach): number {
  const seasons = coach.seasonsWithTeam ?? 0;
  return clamp(0.5 + Math.min(seasons, 5) * 0.1);
}

function grace(coach: NormalizedCoach, role: MarketRole): { bonus: number; marketReviewProtected: boolean; performanceProtected: boolean } {
  const seasons = coach.seasonsWithTeam ?? 0;
  if (role === 'HC' && seasons === 0) return { bonus: 20, marketReviewProtected: true, performanceProtected: true };
  if (role === 'HC' && seasons === 1) return { bonus: 10, marketReviewProtected: false, performanceProtected: true };
  if (role !== 'HC' && seasons === 0) return { bonus: 10, marketReviewProtected: true, performanceProtected: true };
  return { bonus: 0, marketReviewProtected: false, performanceProtected: false };
}

function failureSignals(role: MarketRole, coach: NormalizedCoach, team: NormalizedTeam, ratios: Array<number | null>, expectedWins: number, unit: { rank: number; overachievement: number } | null): FailureSignal[] {
  const signals: FailureSignal[] = [];
  const security = coach.jobSecurity.percentage;
  if (coach.jobSecurity.status === 'HotSeat' || (security !== null && security <= 20)) signals.push({ id: 'job-security', label: 'Hot seat or extremely low security', severe: security !== null && security <= 12 });
  const [current, last, twoYearsAgo] = ratios;
  if (current !== null && current !== undefined && current < 0.55) signals.push({ id: 'contract-expectation', label: 'Major failure against contract expectation', severe: current < 0.35 });
  const actualWins = winPercentage(team.currentRecord);
  if (actualWins - expectedWins <= -0.28 || (team.currentRecord.wins <= 3 && expectedWins >= 0.45)) signals.push({ id: 'program-record', label: 'Catastrophic program-adjusted record', severe: actualWins - expectedWins <= -0.38 || team.currentRecord.wins <= 2 });
  if (unit && unit.rank <= 0.12) signals.push({ id: 'unit-rank', label: `Bottom-tier ${role === 'OC' ? 'offensive' : 'defensive'} performance`, severe: unit.rank <= 0.06 });
  if (unit && unit.overachievement <= -0.3) signals.push({ id: 'unit-underachievement', label: 'Severe unit underachievement versus talent', severe: unit.overachievement <= -0.42 });
  if (current !== null && current !== undefined && last !== null && last !== undefined && twoYearsAgo !== null && twoYearsAgo !== undefined && current < last && last < twoYearsAgo && current < 0.75) signals.push({ id: 'negative-trend', label: 'Sustained negative contract-performance trend', severe: current < 0.45 });
  return signals;
}

function evaluateSeat(snapshot: DynastySnapshot, seat: MarketBaseline['seats'][number]): CoachEvaluation {
  const coach = snapshot.coaches.find((candidate) => candidate.id === seat.incumbentCoachId);
  const team = snapshot.teams.find((candidate) => candidate.id === seat.teamId);
  if (!coach || !team) throw new Error(`Cannot evaluate unresolved seat ${seat.id}.`);
  const ratios = contractRatios(coach, team);
  const currentRatio = ratios[0] ?? null;
  const expectedWins = expectedWinPercentage(team, snapshot);
  const actualWinRate = winPercentage(team.currentRecord);
  const recordRetention = clamp(0.5 + (actualWinRate - expectedWins) * 1.4);
  const teamRecordRetention = clamp((actualWinRate - 0.2) / 0.6);
  const currentContractRetention = contractRetention(currentRatio);
  const components: EvaluationComponent[] = [];
  let unit: { rank: number; overachievement: number } | null = null;

  if (seat.role === 'HC') {
    components.push(
      weighted('contract-current', 'Current results vs. contract expectation', 35, currentContractRetention, currentRatio === null ? 'Current contract evidence unavailable; neutral confidence applied.' : `${round(currentRatio * 100)}% of expected contract points`),
      weighted('contract-trend', 'Three-year contract-performance trend', 20, trendRetention(ratios), `${ratios.filter((ratio) => ratio !== null).length} usable season(s)`),
      weighted('job-security', 'Native job-security state', 15, securityRetention(coach), `${coach.jobSecurity.status || 'Unknown'} · ${coach.jobSecurity.percentage ?? '—'}%`),
      weighted('program-season', 'Program-adjusted season performance', 10, recordRetention, `${team.currentRecord.wins}-${team.currentRecord.losses} vs. ${round(expectedWins * 100)}% expected win rate`),
      weighted('tenure', 'Tenure', 10, tenureRetention(coach), `${coach.seasonsWithTeam ?? 0} completed season(s) with Team`),
      weighted('credibility', 'Career and current-school credibility', 10, credibilityRetention(coach, snapshot), `${coach.resume.career.wins}-${coach.resume.career.losses} career · ${coach.prestige} prestige`)
    );
  } else {
    const isOffense = seat.role === 'OC';
    const rank = rankPercentile(isOffense ? team.performance.offensiveRank : team.performance.defensiveRank, snapshot.teams.length);
    const talent = ordinalPercentile(isOffense ? team.ratings.offense : team.ratings.defense, snapshot.teams.map((candidate) => isOffense ? candidate.ratings.offense : candidate.ratings.defense));
    const overachievement = rank - talent;
    unit = { rank, overachievement };
    const relativeUnitRetention = clamp(rank * 0.55 + clamp(0.5 + overachievement * 1.25) * 0.45);
    components.push(
      weighted('unit-performance', 'Unit performance relative to unit talent', 35, relativeUnitRetention, `${isOffense ? 'Offense' : 'Defense'} percentile ${round(rank * 100)} · talent percentile ${round(talent * 100)} · differential ${overachievement >= 0 ? '+' : ''}${round(overachievement * 100)}`),
      weighted('team-contract', 'Current Team and contract performance', 20, currentContractRetention * 0.65 + recordRetention * 0.35, currentRatio === null ? 'Team result with neutral contract confidence.' : `${round(currentRatio * 100)}% of expected contract points`),
      weighted('contract-trend', 'Three-year contract-performance trend', 15, trendRetention(ratios), `${ratios.filter((ratio) => ratio !== null).length} usable season(s)`),
      weighted('job-security', 'Native job-security state', 10, securityRetention(coach), `${coach.jobSecurity.status || 'Unknown'} · ${coach.jobSecurity.percentage ?? '—'}%`),
      weighted('team-record', 'Team record', 10, teamRecordRetention, `${team.currentRecord.wins}-${team.currentRecord.losses}`),
      weighted('tenure', 'Tenure', 5, tenureRetention(coach), `${coach.seasonsWithTeam ?? 0} completed season(s) with Team`),
      weighted('credibility', 'Career and prestige credibility', 5, credibilityRetention(coach, snapshot), `${coach.resume.career.wins}-${coach.resume.career.losses} career · ${coach.prestige} prestige`)
    );
  }

  const rawScore = components.reduce((sum, component) => sum + component.score, 0);
  const graceState = grace(coach, seat.role);
  const score = Math.min(100, rawScore + graceState.bonus);
  const signals = failureSignals(seat.role, coach, team, ratios, expectedWins, unit);
  const catastrophicFailure = score <= 14 && signals.length >= 3 && signals.some((signal) => signal.severe);
  let classification: JobEvaluationClassification = score >= 45 ? 'Secure' : 'Vulnerable';
  if (score <= ROLE_FIRE_SCORE_THRESHOLD[seat.role] && signals.length >= 2) classification = 'Fire';
  if (classification === 'Fire' && graceState.performanceProtected && !catastrophicFailure) classification = 'Vulnerable';

  return {
    seatId: seat.id, teamId: team.id, coachId: coach.id, role: seat.role,
    rawScore, graceBonus: graceState.bonus, score, classification, components,
    failureSignals: signals, catastrophicFailure,
    marketReviewProtected: graceState.marketReviewProtected,
    userConfirmationRequired: classification === 'Fire' && coach.userControlled,
    unitOverachievement: unit?.overachievement ?? null
  };
}

export function evaluatePartOne(snapshot: DynastySnapshot, market: MarketBaseline): PartOneEvaluation {
  if (snapshot.sourceFingerprint !== market.sourceFingerprint) throw new Error('Market baseline does not match the normalized dynasty snapshot.');
  const evaluations = market.seats.map((seat) => evaluateSeat(snapshot, seat)).sort((left, right) => left.score - right.score || left.seatId.localeCompare(right.seatId));
  return {
    status: 'evaluated', sourceFingerprint: snapshot.sourceFingerprint, seed: market.seed, evaluations,
    counts: {
      Fire: evaluations.filter((item) => item.classification === 'Fire').length,
      Vulnerable: evaluations.filter((item) => item.classification === 'Vulnerable').length,
      Secure: evaluations.filter((item) => item.classification === 'Secure').length,
      catastrophic: evaluations.filter((item) => item.catastrophicFailure).length,
      userProtected: evaluations.filter((item) => item.userConfirmationRequired).length
    }
  };
}
