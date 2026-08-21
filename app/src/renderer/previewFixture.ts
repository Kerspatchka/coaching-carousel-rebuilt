import type { DynastySnapshot, NormalizedCoach, NormalizedTeam } from '../core/dynasty';
import type { SavePreflightResult } from '../shared/desktop-api';

const programs = [
  { id: 'maryland', name: 'Maryland', short: 'TER', nickname: 'Terrapins', colors: ['#E21833', '#FFD200'] as [string, string] },
  { id: 'north-carolina', name: 'North Carolina', short: 'UNC', nickname: 'Tar Heels', colors: ['#7BAFD4', '#FFFFFF'] as [string, string] },
  { id: 'kansas', name: 'Kansas', short: 'KU', nickname: 'Jayhawks', colors: ['#0051BA', '#E8000D'] as [string, string] },
  { id: 'louisville', name: 'Louisville', short: 'LOU', nickname: 'Cardinals', colors: ['#AD0000', '#FFFFFF'] as [string, string] }
];

const roles = ['HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator'] as const;
const names = [
  ['Jayson Perry', 'Alex Monroe', 'Darius Cole'],
  ['Stephen Belichick', 'Marcus Long', 'Trevor Hale'],
  ['Lance Leipold', 'Jim Zebrowski', 'Brian Borland'],
  ['Jeff Brohm', 'Brian Brohm', 'Ron English']
];

function coach(teamIndex: number, roleIndex: number): NormalizedCoach {
  const program = programs[teamIndex]!;
  const role = roles[roleIndex]!;
  const name = names[teamIndex]![roleIndex]!;
  const [firstName, ...last] = name.split(' ');
  return {
    id: `coach:${program.id}:${role}`, sourceRow: teamIndex * 3 + roleIndex, sourceReference: `preview-coach-${teamIndex}-${roleIndex}`,
    name, firstName: firstName!, lastName: last.join(' '), assetName: name, portrait: teamIndex * 3 + roleIndex, presentationId: null,
    age: roleIndex === 0 ? 64 + teamIndex : 47 + roleIndex, yearsCoaching: 20, seasonsWithTeam: 3, role, previousRole: null,
    employerTeamId: `team:${program.id}`, previousTeamId: null, userControlled: false, created: false, legend: false,
    prestige: roleIndex === 0 ? 'A' : 'C', prestigeScore: roleIndex === 0 ? 470 : 180, level: 32,
    contract: { status: 'First_Active', length: 4, yearsRemaining: 2, expectation: 180 },
    contractPerformance: { earnedPoints: [38, 72, 120] },
    resume: {
      season: { wins: 3, losses: 9, ties: 0 },
      career: { wins: 78 + teamIndex * 17, losses: 59, ties: 0, winsAtCurrentSchool: 12, lossesAtCurrentSchool: 24, playoffWins: 0, playoffLosses: 0, bowlWins: 2, bowlLosses: 3, conferenceChampionships: 0, nationalChampionships: teamIndex === 3 ? 1 : 0, timesFired: 0 },
      legacyScore: 140, awardPoints: 0
    },
    schemes: { offense: 'Multiple', defense: '4-2-5', offensivePlaybook: '', defensivePlaybook: '' },
    jobSecurity: { status: 'HotSeat', percentage: 12 + teamIndex, seasonStartStatus: 'Low', performanceLevel: '0' }
  };
}

function team(index: number): NormalizedTeam {
  const program = programs[index]!;
  const teamCoaches = roles.map((_, roleIndex) => coach(index, roleIndex));
  return {
    id: `team:${program.id}`, sourceRow: index, sourceReference: `preview-team-${index}`, teamIndex: index,
    name: program.name, longName: program.name, shortName: program.short, nickname: program.nickname, assetKey: program.id,
    conferenceId: index < 2 ? 'conference:acc' : 'conference:big12', prestige: 7 - index, prestigeDisplay: index < 2 ? 'B+' : 'B',
    nationalRanking: null, currentRecord: { wins: 3, losses: 9, ties: 0 }, previousSeasonRecord: { wins: 5, losses: 7, ties: 0 },
    ratings: { overall: 84, offense: 83, defense: 85 },
    performance: { offensiveRank: 112 - index, defensiveRank: 104 - index, pointsFor: 238, pointsAgainst: 390, expectedContractPoints: [180, 160, 160] },
    colors: program.colors,
    staff: { headCoachId: teamCoaches[0]!.id, offensiveCoordinatorId: teamCoaches[1]!.id, defensiveCoordinatorId: teamCoaches[2]!.id },
    resources: { remainingProgramPoints: 125, staffProgramPointsSpent: 110, staffAccessiblePool: 235, programPointBudget: 500, rolloverProgramPoints: 0, nilProgramPointsSpent: 0, roleBudgets: { headCoach: 60, offensiveCoordinator: 25, defensiveCoordinator: 25 } },
    schemes: { offense: 'Multiple', defense: '4-2-5' }
  };
}

export function createPreviewPreflight(): SavePreflightResult {
  const teams = programs.map((_, index) => team(index));
  const coaches = programs.flatMap((_, teamIndex) => roles.map((__, roleIndex) => coach(teamIndex, roleIndex)));
  const snapshot: DynastySnapshot = {
    sourceFingerprint: 'PREVIEW'.padEnd(64, '0'), seasonYear: 2026,
    conferences: [
      { id: 'conference:acc', sourceRow: 0, name: 'ACC', assetKey: 'acc', presentationId: null, teamIds: teams.slice(0, 2).map((item) => item.id) },
      { id: 'conference:big12', sourceRow: 1, name: 'Big 12', assetKey: 'big12', presentationId: null, teamIds: teams.slice(2).map((item) => item.id) }
    ],
    teams, coaches, openings: [], nativeOffers: [], staffMoves: [],
    nationalChampionship: { sourceRow: 0, seasonWeek: 20, weekType: 'NationalChampionship', homeTeamId: teams[3]!.id, awayTeamId: teams[0]!.id, homeScore: 31, awayScore: 24, winnerTeamId: teams[3]!.id, loserTeamId: teams[0]!.id, status: 'HomeWon', overtime: false, simulated: true },
    integrity: { valid: true, checks: 12, errors: 0, warnings: 0, findings: [] }
  };
  return {
    status: 'ready', file: { name: 'DYNASTY-PREVIEW', path: 'Local development fixture', sizeBytes: 0 },
    schema: { expected: '833.0', detected: '833.0' }, checkpoint: { seasonYear: 2026, stage: 'Offseason', weekType: 'NationalChampionship', week: 20, carouselActive: false },
    inventory: { teams: teams.length, coaches: coaches.length, userCoaches: 0, openings: 0, openingCapacity: teams.length * 3, indexedStaffMoves: 0 },
    users: [], snapshot, issues: []
  };
}
