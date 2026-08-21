import type { DynastySnapshot } from './dynasty';

export type MarketRole = 'HC' | 'OC' | 'DC';

export interface MarketSeat {
  id: string;
  teamId: string;
  role: MarketRole;
  incumbentCoachId: string;
  seededTiebreaker: number;
}

export interface NativeOutcomeEvidence {
  openingId: string;
  teamId: string;
  role: MarketRole;
  previousCoachId: string | null;
  selectedCoachId: string | null;
  reason: string;
  finalContractProgramPoints: number;
}

export interface MarketBaseline {
  status: 'initialized';
  seed: string;
  sourceFingerprint: string;
  seasonYear: number;
  teamCount: number;
  coachCount: number;
  seats: MarketSeat[];
  userCoachIds: string[];
  userTeamIds: string[];
  nativeOutcomeEvidence: NativeOutcomeEvidence[];
  invariants: {
    valid: true;
    expectedSeatCount: number;
    uniqueIncumbentCount: number;
  };
}

export class MarketInitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketInitializationError';
  }
}

const role = (value: string): MarketRole | null => {
  if (value === 'HeadCoach') return 'HC';
  if (value === 'OffensiveCoordinator') return 'OC';
  if (value === 'DefensiveCoordinator') return 'DC';
  return null;
};

// FNV-1a provides a small, framework-independent stable rank. It is used only
// for deterministic ordering; market probability rolls will use the dedicated
// seeded RNG introduced with scoring and offer resolution.
const stableRank = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const defaultMarketSeed = (snapshot: DynastySnapshot): string =>
  `CCR-${snapshot.seasonYear}-${snapshot.sourceFingerprint.slice(0, 16)}`;

export function initializeMarket(snapshot: DynastySnapshot, requestedSeed = defaultMarketSeed(snapshot)): MarketBaseline {
  const seed = requestedSeed.trim();
  if (!seed) throw new MarketInitializationError('A non-empty market seed is required.');
  if (!snapshot.integrity.valid) throw new MarketInitializationError('The normalized dynasty snapshot failed integrity validation.');

  const coachIds = new Set(snapshot.coaches.map((coach) => coach.id));
  const teamIds = new Set(snapshot.teams.map((team) => team.id));
  const seats: MarketSeat[] = [];
  const incumbents = new Set<string>();

  for (const team of snapshot.teams) {
    const assignments: Array<[MarketRole, string]> = [
      ['HC', team.staff.headCoachId],
      ['OC', team.staff.offensiveCoordinatorId],
      ['DC', team.staff.defensiveCoordinatorId]
    ];
    for (const [seatRole, coachId] of assignments) {
      const seatId = `${team.id}:${seatRole}`;
      if (!coachIds.has(coachId)) throw new MarketInitializationError(`${seatId} references an unknown incumbent Coach.`);
      if (incumbents.has(coachId)) throw new MarketInitializationError(`${coachId} occupies more than one staff seat.`);
      const coach = snapshot.coaches.find((candidate) => candidate.id === coachId)!;
      if (role(coach.role) !== seatRole) throw new MarketInitializationError(`${coachId} has role ${coach.role} but occupies ${seatId}.`);
      incumbents.add(coachId);
      seats.push({ id: seatId, teamId: team.id, role: seatRole, incumbentCoachId: coachId, seededTiebreaker: stableRank(`${seed}|${seatId}`) });
    }
  }

  const expectedSeatCount = snapshot.teams.length * 3;
  if (seats.length !== expectedSeatCount) throw new MarketInitializationError(`Expected ${expectedSeatCount} staff seats but initialized ${seats.length}.`);

  const nativeOutcomeEvidence = snapshot.openings.map((opening) => {
    const openingRole = role(opening.role);
    if (!openingRole) throw new MarketInitializationError(`${opening.id} has unsupported role ${opening.role}.`);
    if (!teamIds.has(opening.teamId)) throw new MarketInitializationError(`${opening.id} references an unknown Team.`);
    return {
      openingId: opening.id,
      teamId: opening.teamId,
      role: openingRole,
      previousCoachId: opening.previousCoachId,
      selectedCoachId: opening.selectedCoachId,
      reason: opening.reason,
      finalContractProgramPoints: opening.finalContractProgramPoints
    };
  });

  const userCoaches = snapshot.coaches.filter((coach) => coach.userControlled);
  return {
    status: 'initialized',
    seed,
    sourceFingerprint: snapshot.sourceFingerprint,
    seasonYear: snapshot.seasonYear,
    teamCount: snapshot.teams.length,
    coachCount: snapshot.coaches.length,
    seats: seats.sort((left, right) => left.seededTiebreaker - right.seededTiebreaker || left.id.localeCompare(right.id)),
    userCoachIds: userCoaches.map((coach) => coach.id),
    userTeamIds: [...new Set(userCoaches.map((coach) => coach.employerTeamId).filter((teamId): teamId is string => Boolean(teamId)))],
    nativeOutcomeEvidence,
    invariants: { valid: true, expectedSeatCount, uniqueIncumbentCount: incumbents.size }
  };
}
