export type CoachRole = 'HeadCoach' | 'OffensiveCoordinator' | 'DefensiveCoordinator' | string;

export interface DynastyRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface NormalizedConference {
  id: string;
  sourceRow: number;
  name: string;
  assetKey: string;
  presentationId: number | null;
  teamIds: string[];
}

export interface NormalizedTeam {
  id: string;
  sourceRow: number;
  sourceReference: string;
  teamIndex: number;
  name: string;
  longName: string;
  shortName: string;
  nickname: string;
  assetKey: string;
  conferenceId: string | null;
  prestige: number | null;
  prestigeDisplay: string;
  nationalRanking: number | null;
  currentRecord: DynastyRecord;
  previousSeasonRecord: DynastyRecord;
  ratings: {
    overall: number | null;
    offense: number | null;
    defense: number | null;
  };
  performance: {
    offensiveRank: number | null;
    defensiveRank: number | null;
    pointsFor: number;
    pointsAgainst: number;
    expectedContractPoints: [number | null, number | null, number | null];
  };
  colors: [string, string];
  staff: {
    headCoachId: string;
    offensiveCoordinatorId: string;
    defensiveCoordinatorId: string;
  };
  resources: {
    remainingProgramPoints: number;
    staffProgramPointsSpent: number;
    staffAccessiblePool: number;
    programPointBudget: number;
    rolloverProgramPoints: number;
    nilProgramPointsSpent: number;
    roleBudgets: {
      headCoach: number;
      offensiveCoordinator: number;
      defensiveCoordinator: number;
    };
  };
  schemes: {
    offense: string;
    defense: string;
  };
}

export interface NormalizedCoach {
  id: string;
  sourceRow: number;
  sourceReference: string;
  name: string;
  firstName: string;
  lastName: string;
  assetName: string;
  portrait: string | number | null;
  presentationId: number | null;
  age: number | null;
  yearsCoaching: number | null;
  seasonsWithTeam: number | null;
  role: CoachRole;
  previousRole: CoachRole | null;
  employerTeamId: string | null;
  previousTeamId: string | null;
  userControlled: boolean;
  created: boolean;
  legend: boolean;
  prestige: string;
  prestigeScore: number | null;
  level: number | null;
  contract: {
    status: string;
    length: number | null;
    yearsRemaining: number | null;
    expectation: number | null;
  };
  contractPerformance: {
    earnedPoints: [number | null, number | null, number | null];
  };
  resume: {
    season: DynastyRecord;
    career: DynastyRecord & {
      winsAtCurrentSchool: number;
      lossesAtCurrentSchool: number;
      playoffWins: number;
      playoffLosses: number;
      bowlWins: number;
      bowlLosses: number;
      conferenceChampionships: number;
      nationalChampionships: number;
      timesFired: number;
    };
    legacyScore: number;
    awardPoints: number;
  };
  schemes: {
    offense: string;
    defense: string;
    offensivePlaybook: string;
    defensivePlaybook: string;
  };
  jobSecurity: {
    status: string;
    percentage: number | null;
    seasonStartStatus: string;
    performanceLevel: string;
  };
}

export interface NormalizedOpening {
  id: string;
  sourceRow: number;
  sourceReference: string;
  teamId: string;
  role: CoachRole;
  reason: string;
  filled: boolean;
  emergent: boolean;
  previousCoachId: string | null;
  selectedCoachId: string | null;
  finalContractProgramPoints: number;
  highestOfferedProgramPoints: number;
  offerArrayRow: number | null;
}

export interface NormalizedNativeOffer {
  id: string;
  sourceRow: number;
  sourceReference: string;
  teamId: string;
  coachId: string;
  coachTeamId: string | null;
  role: CoachRole;
  status: string;
  offerIndex: number | null;
  length: number | null;
  expectedProgramPoints: number;
  offeredProgramPoints: number;
  schoolInterest: number | null;
  baseCoachInterest: number | null;
  adjustedCoachInterest: number | null;
}

export interface NormalizedStaffMove {
  id: string;
  sourceRow: number;
  transactionId: number | null;
  coachId: string;
  oldTeamId: string | null;
  newTeamId: string | null;
  oldRole: CoachRole | null;
  newRole: CoachRole | null;
  contractLength: number | null;
  contractStatus: string;
  seasonYear: number | null;
  seasonWeek: number | null;
  seasonStage: string;
}

export interface IntegrityFinding {
  code: string;
  severity: 'error' | 'warning';
  entityId: string;
  detail: string;
}

export interface DynastySnapshot {
  sourceFingerprint: string;
  seasonYear: number;
  conferences: NormalizedConference[];
  teams: NormalizedTeam[];
  coaches: NormalizedCoach[];
  openings: NormalizedOpening[];
  nativeOffers: NormalizedNativeOffer[];
  staffMoves: NormalizedStaffMove[];
  integrity: {
    valid: boolean;
    checks: number;
    errors: number;
    warnings: number;
    findings: IntegrityFinding[];
  };
}
