import type { DynastySnapshot } from './dynasty';
import type { PartOneEvaluation } from './evaluation';
import type { MarketBaseline, MarketRole, MarketSeat } from './market';

export type PerformanceDisposition = 'Fired' | 'StaffNotRetained';
export type PerformanceDecisionChoice = 'dismiss' | 'retain';

export interface PerformanceStaffAction {
  id: string;
  seatId: string;
  teamId: string;
  coachId: string;
  role: MarketRole;
  disposition: PerformanceDisposition;
  trigger: 'PerformanceFire' | 'CleansHouse';
  buyoutRequired: boolean;
}

export interface PerformanceVacancy {
  id: string;
  seatId: string;
  teamId: string;
  role: MarketRole;
  previousCoachId: string;
  reason: PerformanceDisposition;
}

export interface PendingPerformanceDecision {
  id: string;
  teamId: string;
  coachId: string;
  role: MarketRole;
  kind: 'ConfirmUserHcFiring' | 'OverrideCoordinatorFire';
  recommendation: 'dismiss';
}

export interface PerformanceOverride {
  decisionId: string;
  teamId: string;
  coachId: string;
  role: MarketRole;
  choice: 'retain';
}

export interface PerformanceActionPlan {
  status: 'performance-actions-planned';
  sourceFingerprint: string;
  seed: string;
  actions: PerformanceStaffAction[];
  vacancies: PerformanceVacancy[];
  pendingDecisions: PendingPerformanceDecision[];
  overrides: PerformanceOverride[];
  requiresBuyoutPricing: boolean;
  invariants: {
    valid: true;
    uniqueReleasedCoaches: number;
    uniqueVacancies: number;
  };
}

export interface PerformanceActionOptions {
  userHcProtectionEnabled?: boolean;
  userDecisions?: Readonly<Record<string, PerformanceDecisionChoice>>;
  departedCoachIds?: readonly string[];
  internalSuccessionTeamIds?: readonly string[];
}

export class PerformanceActionPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerformanceActionPlanningError';
  }
}

const roleOrder: Record<MarketRole, number> = { HC: 0, OC: 1, DC: 2 };

export const performanceDecisionId = (seatId: string): string => `performance-decision:${seatId}`;

function underContract(snapshot: DynastySnapshot, coachId: string): boolean {
  const coach = snapshot.coaches.find((candidate) => candidate.id === coachId);
  if (!coach) throw new PerformanceActionPlanningError(`Cannot price unknown Coach ${coachId}.`);
  return (coach.contract.yearsRemaining ?? 0) > 0;
}

function actionFor(snapshot: DynastySnapshot, seat: MarketSeat, disposition: PerformanceDisposition, trigger: PerformanceStaffAction['trigger']): PerformanceStaffAction {
  return {
    id: `performance-action:${seat.id}`,
    seatId: seat.id,
    teamId: seat.teamId,
    coachId: seat.incumbentCoachId,
    role: seat.role,
    disposition,
    trigger,
    buyoutRequired: underContract(snapshot, seat.incumbentCoachId)
  };
}

function vacancyFor(seat: MarketSeat, reason: PerformanceDisposition): PerformanceVacancy {
  return {
    id: `performance-vacancy:${seat.id}`,
    seatId: seat.id,
    teamId: seat.teamId,
    role: seat.role,
    previousCoachId: seat.incumbentCoachId,
    reason
  };
}

export function planPerformanceActions(
  snapshot: DynastySnapshot,
  market: MarketBaseline,
  evaluation: PartOneEvaluation,
  options: PerformanceActionOptions = {}
): PerformanceActionPlan {
  if (snapshot.sourceFingerprint !== market.sourceFingerprint || snapshot.sourceFingerprint !== evaluation.sourceFingerprint) {
    throw new PerformanceActionPlanningError('Snapshot, market baseline, and evaluation do not describe the same source save.');
  }
  if (market.seed !== evaluation.seed) throw new PerformanceActionPlanningError('Market baseline and evaluation do not use the same run seed.');

  const userHcProtectionEnabled = options.userHcProtectionEnabled ?? true;
  const userDecisions = options.userDecisions ?? {};
  const departedCoachIds = new Set(options.departedCoachIds ?? []);
  const internalSuccessionTeamIds = new Set(options.internalSuccessionTeamIds ?? []);
  const evaluationsBySeat = new Map(evaluation.evaluations.map((item) => [item.seatId, item]));
  const userHcTeamIds = new Set(snapshot.coaches
    .filter((coach) => coach.userControlled && coach.role === 'HeadCoach' && coach.employerTeamId)
    .map((coach) => coach.employerTeamId!));
  const seatsByTeam = new Map<string, MarketSeat[]>();
  for (const seat of market.seats) {
    if (!evaluationsBySeat.has(seat.id)) throw new PerformanceActionPlanningError(`Evaluation is missing ${seat.id}.`);
    const seats = seatsByTeam.get(seat.teamId) ?? [];
    seats.push(seat);
    seatsByTeam.set(seat.teamId, seats);
  }

  const actions: PerformanceStaffAction[] = [];
  const vacancies: PerformanceVacancy[] = [];
  const pendingDecisions: PendingPerformanceDecision[] = [];
  const overrides: PerformanceOverride[] = [];

  const decisionFor = (seat: MarketSeat, kind: PendingPerformanceDecision['kind']): PerformanceDecisionChoice | null => {
    const id = performanceDecisionId(seat.id);
    const choice = userDecisions[id];
    if (choice) return choice;
    pendingDecisions.push({ id, teamId: seat.teamId, coachId: seat.incumbentCoachId, role: seat.role, kind, recommendation: 'dismiss' });
    return null;
  };
  const recordOverride = (seat: MarketSeat): void => {
    overrides.push({ decisionId: performanceDecisionId(seat.id), teamId: seat.teamId, coachId: seat.incumbentCoachId, role: seat.role, choice: 'retain' });
  };
  const release = (seat: MarketSeat, disposition: PerformanceDisposition, trigger: PerformanceStaffAction['trigger']): void => {
    actions.push(actionFor(snapshot, seat, disposition, trigger));
    vacancies.push(vacancyFor(seat, disposition));
  };

  for (const [teamId, unsortedSeats] of [...seatsByTeam.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const seats = [...unsortedSeats].sort((left, right) => roleOrder[left.role] - roleOrder[right.role]);
    const hcSeat = seats.find((seat) => seat.role === 'HC');
    if (!hcSeat || seats.length !== 3) throw new PerformanceActionPlanningError(`${teamId} does not have one complete HC/OC/DC staff.`);
    const hcEvaluation = evaluationsBySeat.get(hcSeat.id)!;
    if (internalSuccessionTeamIds.has(teamId) || seats.some((seat) => departedCoachIds.has(seat.incumbentCoachId))) continue;

    if (hcEvaluation.classification === 'Fire') {
      if (userHcProtectionEnabled && userHcTeamIds.has(teamId)) {
        const choice = decisionFor(hcSeat, 'ConfirmUserHcFiring');
        if (choice === null) continue;
        if (choice === 'retain') {
          recordOverride(hcSeat);
          continue;
        }
      }
      for (const seat of seats) release(seat, seat.role === 'HC' ? 'Fired' : 'StaffNotRetained', 'CleansHouse');
      continue;
    }

    for (const seat of seats.filter((candidate) => candidate.role !== 'HC')) {
      if (departedCoachIds.has(seat.incumbentCoachId)) continue;
      if (evaluationsBySeat.get(seat.id)!.classification !== 'Fire') continue;
      if (userHcTeamIds.has(teamId)) {
        const choice = decisionFor(seat, 'OverrideCoordinatorFire');
        if (choice === null) continue;
        if (choice === 'retain') {
          recordOverride(seat);
          continue;
        }
      }
      release(seat, 'Fired', 'PerformanceFire');
    }
  }

  const releasedCoachIds = new Set(actions.map((action) => action.coachId));
  const vacancySeatIds = new Set(vacancies.map((vacancy) => vacancy.seatId));
  if (releasedCoachIds.size !== actions.length) throw new PerformanceActionPlanningError('A Coach was released more than once.');
  if (vacancySeatIds.size !== vacancies.length || vacancies.length !== actions.length) throw new PerformanceActionPlanningError('Performance vacancies are incomplete or duplicated.');

  return {
    status: 'performance-actions-planned',
    sourceFingerprint: snapshot.sourceFingerprint,
    seed: market.seed,
    actions,
    vacancies,
    pendingDecisions,
    overrides,
    requiresBuyoutPricing: actions.some((action) => action.buyoutRequired),
    invariants: { valid: true, uniqueReleasedCoaches: releasedCoachIds.size, uniqueVacancies: vacancySeatIds.size }
  };
}
