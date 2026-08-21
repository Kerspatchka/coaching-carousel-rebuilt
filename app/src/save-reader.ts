import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FranchiseFile } from 'madden-franchise';
import type {
  CoachRole, DynastyRecord, DynastySnapshot, IntegrityFinding, NormalizedCoach,
  NormalizedConference, NormalizedNativeOffer, NormalizedOpening, NormalizedStaffMove, NormalizedTeam
} from './core/dynasty';
import type { LoadedUserCoach, PreflightIssue, SavePreflightResult } from './shared/desktop-api';

const EXPECTED_SCHEMA = '833.0';
const EMPTY_REF = '00000000000000000000000000000000';
const TABLES = {
  seasonInfo: 3123991521,
  coaches: 1860529246,
  teams: 3359508968,
  conferences: 3820706130,
  teamSlots: 2477738738,
  openings: 263453863,
  openingArrays: 2358764614,
  offers: 674348040,
  offerArrays: 4119397260,
  transactions: 2701814500,
  transactionArrays: 1261824345,
  seasonCoachStats: 564984853,
  careerCoachStats: 1758861850
} as const;

type RecordLike = Record<string, unknown> & {
  index: number;
  isEmpty?: boolean;
  fieldsArray?: Array<{ key: string }>;
};

type TableLike = {
  name: string;
  header: { recordCapacity: number };
  records: RecordLike[];
  readRecords(): Promise<void>;
  getBinaryReferenceToRecord(index: number): string;
};

type FranchiseLike = {
  expectedSchemaVersion: { major: number; minor: number; gameYear: number };
  settings: { schemaOverride: { major: number; minor: number; gameYear: number; path: string } };
  getTableByUniqueId(id: number): TableLike | null;
  on(event: 'ready' | 'error', callback: (...args: unknown[]) => void): void;
  parse(): void;
};

type Tables = Record<keyof typeof TABLES, TableLike>;

function schemaPath(packaged: boolean): string {
  return packaged
    ? path.join(process.resourcesPath, 'CFB27_833_0.gz')
    : path.resolve(app.getAppPath(), '..', 'assets', 'experiments', 'capacity-policy', 'CFB27_833_0.gz');
}

function fields(record: RecordLike | undefined): string[] {
  return record?.fieldsArray?.map((field) => field.key) ?? [];
}

function value<T>(record: RecordLike | undefined, aliases: string[], fallback: T): T {
  if (!record) return fallback;
  const names = fields(record);
  const lower = new Map(names.map((name) => [name.toLowerCase(), name]));
  const key = aliases.find((name) => names.includes(name)) ?? aliases.map((name) => lower.get(name.toLowerCase())).find(Boolean);
  const found = key ? record[key] : undefined;
  return (found === undefined || found === null ? fallback : found) as T;
}

function numeric(record: RecordLike | undefined, aliases: string[], fallback = 0): number {
  const found = Number(value<unknown>(record, aliases, fallback));
  return Number.isFinite(found) ? found : fallback;
}

function nullableNumber(record: RecordLike | undefined, aliases: string[]): number | null {
  const found = value<unknown>(record, aliases, null);
  if (found === null || found === '') return null;
  const parsed = Number(found);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(record: RecordLike | undefined, aliases: string[], fallback = ''): string {
  return String(value<unknown>(record, aliases, fallback)).trim();
}

function displayName(record: RecordLike): string {
  const personalName = `${text(record, ['FirstName'])} ${text(record, ['LastName'])}`.trim();
  return personalName || text(record, ['LongName', 'DisplayName', 'Name']);
}

function active(table: TableLike): RecordLike[] {
  return table.records.filter((record) => record && !record.isEmpty);
}

function referenceRow(reference: unknown): number | null {
  if (typeof reference !== 'string' || reference === EMPTY_REF || !/^[01]{32}$/.test(reference)) return null;
  return Number.parseInt(reference.slice(15), 2);
}

function recordFromReference(table: TableLike, reference: unknown): RecordLike | undefined {
  const row = referenceRow(reference);
  return row === null ? undefined : table.records[row];
}

function referenceMap(table: TableLike, prefix: string): Map<string, string> {
  return new Map(active(table).map((record) => [table.getBinaryReferenceToRecord(record.index), `${prefix}:${record.index}`]));
}

function color(record: RecordLike, suffix = ''): string {
  const channel = (name: string) => Math.max(0, Math.min(255, numeric(record, [`TEAM_BACKGROUNDCOLOR${name}${suffix}`])));
  return `rgb(${channel('R')}, ${channel('G')}, ${channel('B')})`;
}

function record(wins: number, losses: number, ties = 0): DynastyRecord {
  return { wins, losses, ties };
}

function createFranchise(savePath: string, testedSchemaPath: string): Promise<FranchiseLike> {
  return new Promise((resolve, reject) => {
    try {
      const Constructor = FranchiseFile as unknown as new (filePath: string, settings: Record<string, unknown>) => FranchiseLike;
      const franchise = new Constructor(savePath, { autoParse: false, gameTypeOverride: 'college', gameYearOverride: 27 });
      const declared = franchise.expectedSchemaVersion;
      franchise.settings.schemaOverride = { ...declared, path: testedSchemaPath };
      franchise.on('ready', () => resolve(franchise));
      franchise.on('error', (error) => reject(error));
      franchise.parse();
    } catch (error) {
      reject(error);
    }
  });
}

function issue(code: string, severity: PreflightIssue['severity'], title: string, detail: string): PreflightIssue {
  return { code, severity, title, detail };
}

function blockedShell(savePath: string, detail: string): SavePreflightResult {
  const sizeBytes = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0;
  return {
    status: 'blocked',
    file: { name: path.basename(savePath), path: savePath, sizeBytes },
    schema: { expected: EXPECTED_SCHEMA, detected: null },
    checkpoint: { seasonYear: null, stage: null, weekType: null, week: null, carouselActive: false },
    inventory: { teams: 0, coaches: 0, userCoaches: 0, openings: 0, openingCapacity: 0, indexedStaffMoves: 0 },
    users: [],
    snapshot: null,
    issues: [issue('UNREADABLE_SAVE', 'blocking', 'This file could not be read as a supported dynasty save', detail)]
  };
}

function normalizeSnapshot(savePath: string, tables: Tables, seasonYear: number): DynastySnapshot {
  const teamIds = referenceMap(tables.teams, 'team');
  const coachIds = referenceMap(tables.coaches, 'coach');
  const openingIds = referenceMap(tables.openings, 'opening');
  const offerIds = referenceMap(tables.offers, 'native-offer');
  const offerArrayIds = referenceMap(tables.offerArrays, 'offer-array');
  const transactionIds = referenceMap(tables.transactions, 'staff-move');
  const teamsByIndex = new Map<number, string>();
  const findings: IntegrityFinding[] = [];
  let checks = 0;

  const finding = (code: string, severity: IntegrityFinding['severity'], entityId: string, detail: string): void => {
    findings.push({ code, severity, entityId, detail });
  };
  const checkReference = (reference: unknown, ids: Map<string, string>, code: string, entityId: string, label: string, optional = false): string | null => {
    checks += 1;
    if (reference === EMPTY_REF || reference === null || reference === undefined) {
      if (!optional) finding(code, 'error', entityId, `${label} is empty.`);
      return null;
    }
    if (typeof reference !== 'string' || !ids.has(reference)) {
      finding(code, 'error', entityId, `${label} does not resolve to an active record.`);
      return null;
    }
    return ids.get(reference) ?? null;
  };

  for (const team of active(tables.teams)) {
    const teamId = `team:${team.index}`;
    const teamIndex = numeric(team, ['TeamIndex'], -1);
    checks += 1;
    // Several placeholder/FCS Team records deliberately share the sentinel
    // logical index 255. They remain distinct by source row and reference.
    if (teamIndex === 255) continue;
    if (teamsByIndex.has(teamIndex)) finding('DUPLICATE_TEAM_INDEX', 'error', teamId, `TeamIndex ${teamIndex} is also used by ${teamsByIndex.get(teamIndex)}.`);
    else teamsByIndex.set(teamIndex, teamId);
  }

  const conferenceByTeamReference = new Map<string, string>();
  const claimedConferenceSlots = new Set<number>();
  const conferences: NormalizedConference[] = active(tables.conferences).map((conference) => {
    const conferenceId = `conference:${conference.index}`;
    const slotReference = value(conference, ['TeamSlots'], EMPTY_REF);
    const slotRow = referenceRow(slotReference);
    // An empty Independent conference can retain another conference's Team[]
    // reference. The first conference is authoritative; the repeated owner is
    // preserved as an empty normalized conference rather than double-assigning.
    const slotRecord = slotRow !== null && claimedConferenceSlots.has(slotRow) ? undefined : recordFromReference(tables.teamSlots, slotReference);
    if (slotRow !== null) claimedConferenceSlots.add(slotRow);
    const memberIds: string[] = [];
    for (const field of fields(slotRecord).filter((name) => /^Team\d+$/i.test(name))) {
      const reference = value(slotRecord, [field], EMPTY_REF);
      if (reference === EMPTY_REF) continue;
      const teamId = checkReference(reference, teamIds, 'INVALID_CONFERENCE_TEAM', conferenceId, field);
      if (!teamId) continue;
      if (conferenceByTeamReference.has(reference)) {
        finding('DUPLICATE_CONFERENCE_MEMBERSHIP', 'error', teamId, `Team is assigned to both ${conferenceByTeamReference.get(reference)} and ${conferenceId}.`);
      } else {
        conferenceByTeamReference.set(reference, conferenceId);
        memberIds.push(teamId);
      }
    }
    return {
      id: conferenceId,
      sourceRow: conference.index,
      name: text(conference, ['Name'], `Conference ${conference.index}`),
      assetKey: text(conference, ['AssetName', 'StyleName']),
      presentationId: nullableNumber(conference, ['PresentationId']),
      teamIds: memberIds
    };
  });

  const assignedCoachIds = new Map<string, string>();
  const teams: NormalizedTeam[] = active(tables.teams).map((team) => {
    const teamId = `team:${team.index}`;
    const sourceReference = tables.teams.getBinaryReferenceToRecord(team.index);
    const staffReference = (field: string): string => {
      const coachReference = value(team, [field], EMPTY_REF);
      const coachId = checkReference(coachReference, coachIds, 'INVALID_STAFF_REFERENCE', teamId, field);
      if (!coachId) return `coach:unresolved:${field}:${team.index}`;
      checks += 1;
      if (assignedCoachIds.has(coachId)) finding('DUPLICATE_STAFF_ASSIGNMENT', 'error', coachId, `Assigned to ${assignedCoachIds.get(coachId)} and ${teamId}:${field}.`);
      else assignedCoachIds.set(coachId, `${teamId}:${field}`);
      const coachRow = referenceRow(coachReference);
      const coach = coachRow === null ? undefined : tables.coaches.records[coachRow];
      if (numeric(coach, ['TeamIndex'], -1) !== numeric(team, ['TeamIndex'], -2) || text(coach, ['Position']) !== field) {
        finding('INCOHERENT_STAFF_EMPLOYMENT', 'error', coachId, `Coach employment does not match ${teamId}:${field}.`);
      }
      return coachId;
    };
    const remaining = numeric(team, ['RemainingProgramPoints']);
    const staffSpent = numeric(team, ['StaffProgramPointsSpent']);
    const ranking = numeric(team, ['TeamRank', 'CFPPoll_CurrentRank']);
    return {
      id: teamId,
      sourceRow: team.index,
      sourceReference,
      teamIndex: numeric(team, ['TeamIndex'], -1),
      name: text(team, ['DisplayName', 'LongName'], `Team ${team.index}`),
      longName: text(team, ['LongName', 'DisplayName'], `Team ${team.index}`),
      shortName: text(team, ['ShortName']),
      nickname: text(team, ['NickName']),
      assetKey: text(team, ['AssetName', 'ShortName']),
      conferenceId: conferenceByTeamReference.get(sourceReference) ?? null,
      prestige: nullableNumber(team, ['TeamPrestige']),
      prestigeDisplay: text(team, ['PrestigeDisplay']),
      nationalRanking: ranking > 0 && ranking <= 25 ? ranking : null,
      currentRecord: record(
        numeric(team, ['ConfWin']) + numeric(team, ['NonConfWin']),
        numeric(team, ['ConfLoss']) + numeric(team, ['NonConfLoss']),
        numeric(team, ['ConfTie']) + numeric(team, ['NonConfTie'])
      ),
      previousSeasonRecord: record(numeric(team, ['TEAM_PREVSEASWINS']), numeric(team, ['TEAM_PREVSEASLOSSES']), numeric(team, ['TEAM_PREVSEASTIES'])),
      ratings: {
        overall: nullableNumber(team, ['TEAM_RATINGOVR']),
        offense: nullableNumber(team, ['TEAM_RATINGOFF']),
        defense: nullableNumber(team, ['TEAM_RATINGDEF'])
      },
      performance: {
        offensiveRank: nullableNumber(team, ['OffensiveRank']),
        defensiveRank: nullableNumber(team, ['DefensiveRank']),
        pointsFor: numeric(team, ['SeasonLeagPointsFor']),
        pointsAgainst: numeric(team, ['SeasonLeagPointsAgainst']),
        expectedContractPoints: [
          nullableNumber(team, ['ExpectedContractPoints_ThisYear']),
          nullableNumber(team, ['ExpectedContractPoints_LastYear']),
          nullableNumber(team, ['ExpectedContractPoints_TwoYearsAgo'])
        ]
      },
      colors: [color(team), color(team, '2')],
      staff: {
        headCoachId: staffReference('HeadCoach'),
        offensiveCoordinatorId: staffReference('OffensiveCoordinator'),
        defensiveCoordinatorId: staffReference('DefensiveCoordinator')
      },
      resources: {
        remainingProgramPoints: remaining,
        staffProgramPointsSpent: staffSpent,
        staffAccessiblePool: remaining + staffSpent,
        programPointBudget: numeric(team, ['ProgramPointBudget']),
        rolloverProgramPoints: numeric(team, ['RolloverProgramPoints']),
        nilProgramPointsSpent: numeric(team, ['NILProgramPointsSpent']),
        roleBudgets: {
          headCoach: numeric(team, ['HeadCoachProgramPointBudget']),
          offensiveCoordinator: numeric(team, ['OffensiveCoordinatorPointBudget']),
          defensiveCoordinator: numeric(team, ['DefensiveCoordinatorPointBudget'])
        }
      },
      schemes: {
        offense: text(team, ['CurrentOffensiveScheme', 'DefaultOffensiveScheme']),
        defense: text(team, ['CurrentDefensiveScheme', 'DefaultDefensiveScheme'])
      }
    };
  });

  const coaches: NormalizedCoach[] = active(tables.coaches).map((coach) => {
    const seasonStats = recordFromReference(tables.seasonCoachStats, value(coach, ['SeasonStats'], EMPTY_REF));
    const careerStats = recordFromReference(tables.careerCoachStats, value(coach, ['CareerStats'], EMPTY_REF));
    return {
      id: `coach:${coach.index}`,
      sourceRow: coach.index,
      sourceReference: tables.coaches.getBinaryReferenceToRecord(coach.index),
      name: displayName(coach) || `Coach ${coach.index}`,
      firstName: text(coach, ['FirstName']),
      lastName: text(coach, ['LastName']),
      assetName: text(coach, ['AssetName', 'GenericHeadAssetName']),
      portrait: value<string | number | null>(coach, ['Portrait', 'PresentationId'], null),
      presentationId: nullableNumber(coach, ['PresentationId']),
      age: nullableNumber(coach, ['Age']),
      yearsCoaching: nullableNumber(coach, ['YearsCoaching']),
      seasonsWithTeam: nullableNumber(coach, ['SeasonsWithTeam']),
      role: text(coach, ['Position'], 'Unknown'),
      previousRole: (text(coach, ['PrevPosition']) || null) as CoachRole | null,
      employerTeamId: teamsByIndex.get(numeric(coach, ['TeamIndex'], -1)) ?? null,
      previousTeamId: teamsByIndex.get(numeric(coach, ['PrevTeamIndex'], -1)) ?? null,
      userControlled: value<boolean>(coach, ['IsUserControlled'], false) === true,
      created: value<boolean>(coach, ['IsCreated'], false) === true,
      legend: value<boolean>(coach, ['IsLegend'], false) === true,
      prestige: text(coach, ['CoachPrestige'], '—'),
      prestigeScore: nullableNumber(coach, ['CoachPrestigeScore']),
      level: nullableNumber(coach, ['Level']),
      contract: {
        status: text(coach, ['ContractStatus']),
        length: nullableNumber(coach, ['ContractLength']),
        yearsRemaining: nullableNumber(coach, ['ContractYearsRemaining']),
        expectation: nullableNumber(coach, ['CurrentContractExpectation'])
      },
      contractPerformance: {
        earnedPoints: [
          nullableNumber(coach, ['EarnedContractPoints_ThisYear']),
          nullableNumber(coach, ['EarnedContractPoints_LastYear']),
          nullableNumber(coach, ['EarnedContractPoints_TwoYearsAgo'])
        ]
      },
      resume: {
        season: record(numeric(seasonStats, ['Wins']), numeric(seasonStats, ['Losses'])),
        career: {
          ...record(numeric(careerStats, ['Wins']), numeric(careerStats, ['Losses']), numeric(coach, ['CareerTies'])),
          winsAtCurrentSchool: numeric(careerStats, ['WinsAtCurrentSchool']),
          lossesAtCurrentSchool: numeric(careerStats, ['LossesAtCurrentSchool']),
          playoffWins: numeric(careerStats, ['PlayoffWins']),
          playoffLosses: numeric(careerStats, ['PlayoffLosses']),
          bowlWins: numeric(careerStats, ['BowlWins']),
          bowlLosses: numeric(careerStats, ['BowlLosses']),
          conferenceChampionships: numeric(careerStats, ['ConfChampWins']),
          nationalChampionships: numeric(careerStats, ['NCWins']),
          timesFired: numeric(careerStats, ['TimesFired'])
        },
        legacyScore: numeric(coach, ['LegacyScore']),
        awardPoints: numeric(coach, ['AwardPoints'])
      },
      schemes: {
        offense: text(coach, ['OffensiveScheme']),
        defense: text(coach, ['DefensiveScheme']),
        offensivePlaybook: text(coach, ['OffensivePlaybook']),
        defensivePlaybook: text(coach, ['DefensivePlaybook'])
      },
      jobSecurity: {
        status: text(coach, ['CurrentJobSecurityStatus']),
        percentage: nullableNumber(coach, ['CurrentJobSecurityPercentage']),
        seasonStartStatus: text(coach, ['SeasonStartJobSecurityStatus']),
        performanceLevel: text(coach, ['COACH_PERFORMANCELEVEL'])
      }
    };
  });

  const openings: NormalizedOpening[] = active(tables.openings).map((opening) => {
    const openingId = `opening:${opening.index}`;
    return {
      id: openingId,
      sourceRow: opening.index,
      sourceReference: tables.openings.getBinaryReferenceToRecord(opening.index),
      teamId: checkReference(value(opening, ['Team'], EMPTY_REF), teamIds, 'INVALID_OPENING_TEAM', openingId, 'Team') ?? 'team:unresolved',
      role: text(opening, ['Position'], 'Unknown'),
      reason: text(opening, ['Reason']),
      filled: value<boolean>(opening, ['Filled'], false) === true,
      emergent: value<boolean>(opening, ['IsEmergentJobOpening'], false) === true,
      previousCoachId: checkReference(value(opening, ['PrevCoach'], EMPTY_REF), coachIds, 'INVALID_OPENING_PREVIOUS_COACH', openingId, 'PrevCoach', true),
      selectedCoachId: checkReference(value(opening, ['SelectedCoach'], EMPTY_REF), coachIds, 'INVALID_OPENING_SELECTED_COACH', openingId, 'SelectedCoach', true),
      finalContractProgramPoints: numeric(opening, ['FinalContractProgramPoints']),
      highestOfferedProgramPoints: numeric(opening, ['HighestOfferedProgramPoints']),
      offerArrayRow: referenceRow(value(opening, ['ContractOfferList'], EMPTY_REF))
    };
  });

  const nativeOffers: NormalizedNativeOffer[] = active(tables.offers)
    .filter((offer) => text(offer, ['ContractPosition']) !== 'Invalid_')
    .map((offer) => {
      const offerId = `native-offer:${offer.index}`;
      return {
        id: offerId,
        sourceRow: offer.index,
        sourceReference: tables.offers.getBinaryReferenceToRecord(offer.index),
        teamId: checkReference(value(offer, ['Team'], EMPTY_REF), teamIds, 'INVALID_OFFER_TEAM', offerId, 'Team') ?? 'team:unresolved',
        coachId: checkReference(value(offer, ['StaffPerson'], EMPTY_REF), coachIds, 'INVALID_OFFER_COACH', offerId, 'StaffPerson') ?? 'coach:unresolved',
        coachTeamId: checkReference(value(offer, ['StaffPersonTeam'], EMPTY_REF), teamIds, 'INVALID_OFFER_COACH_TEAM', offerId, 'StaffPersonTeam', true),
        role: text(offer, ['ContractPosition'], 'Unknown'),
        status: text(offer, ['Status']),
        offerIndex: nullableNumber(offer, ['OfferIndex']),
        length: nullableNumber(offer, ['Length']),
        expectedProgramPoints: numeric(offer, ['ExpectedContractProgramPoints']),
        offeredProgramPoints: numeric(offer, ['OfferedContractProgramPoints']),
        schoolInterest: nullableNumber(offer, ['TeamInterestInStaffPerson']),
        baseCoachInterest: nullableNumber(offer, ['BaseStaffPersonInterestInOffer']),
        adjustedCoachInterest: nullableNumber(offer, ['AdjustedStaffPersonInterestInOffer'])
      };
    });

  for (const opening of active(tables.openings)) {
    checkReference(value(opening, ['ContractOfferList'], EMPTY_REF), offerArrayIds, 'INVALID_OPENING_OFFER_ARRAY', `opening:${opening.index}`, 'ContractOfferList');
  }
  for (const array of active(tables.offerArrays)) {
    for (const field of fields(array).filter((name) => /^StaffPersonContractOffer\d+$/i.test(name))) {
      const reference = value(array, [field], EMPTY_REF);
      if (reference !== EMPTY_REF) checkReference(reference, offerIds, 'INVALID_OFFER_ARRAY_ENTRY', `offer-array:${array.index}`, field);
    }
  }

  const owner = active(tables.openingArrays)[0];
  const ownedOpenings = new Set<string>();
  for (const field of fields(owner).filter((name) => /^JobOpening\d+$/i.test(name))) {
    const reference = value(owner, [field], EMPTY_REF);
    if (reference === EMPTY_REF) continue;
    const openingId = checkReference(reference, openingIds, 'INVALID_OPENING_OWNER_ENTRY', 'opening-owner:0', field);
    if (openingId) ownedOpenings.add(openingId);
  }
  for (const opening of openings) {
    checks += 1;
    if (!ownedOpenings.has(opening.id)) finding('UNOWNED_OPENING', 'error', opening.id, 'Active opening is not registered in JobOpening[].');
  }

  const staffMoves: NormalizedStaffMove[] = [];
  const transactionArray = active(tables.transactionArrays)[0];
  for (const field of fields(transactionArray).filter((name) => /^(?:Coach)?TransactionHistoryEntry\d+$/i.test(name))) {
    const reference = value(transactionArray, [field], EMPTY_REF);
    if (reference === EMPTY_REF) continue;
    const moveId = checkReference(reference, transactionIds, 'INVALID_TRANSACTION_ARRAY_ENTRY', 'transaction-array:0', field);
    if (!moveId) continue;
    const transactionRow = referenceRow(reference);
    const transaction = transactionRow === null ? undefined : tables.transactions.records[transactionRow];
    if (!transaction) continue;
    staffMoves.push({
      id: moveId,
      sourceRow: transaction.index,
      transactionId: nullableNumber(transaction, ['TransactionId']),
      coachId: checkReference(value(transaction, ['Coach'], EMPTY_REF), coachIds, 'INVALID_TRANSACTION_COACH', moveId, 'Coach') ?? 'coach:unresolved',
      oldTeamId: checkReference(value(transaction, ['OldTeam'], EMPTY_REF), teamIds, 'INVALID_TRANSACTION_OLD_TEAM', moveId, 'OldTeam', true),
      newTeamId: checkReference(value(transaction, ['NewTeam'], EMPTY_REF), teamIds, 'INVALID_TRANSACTION_NEW_TEAM', moveId, 'NewTeam', true),
      oldRole: (text(transaction, ['OldCoachPosition']) || null) as CoachRole | null,
      newRole: (text(transaction, ['NewCoachPosition']) || null) as CoachRole | null,
      contractLength: nullableNumber(transaction, ['ContractLength']),
      contractStatus: text(transaction, ['ContractStatus']),
      seasonYear: nullableNumber(transaction, ['SeasonYear']),
      seasonWeek: nullableNumber(transaction, ['SeasonWeek']),
      seasonStage: text(transaction, ['SeasonStage'])
    });
  }

  const errors = findings.filter((item) => item.severity === 'error').length;
  const warnings = findings.length - errors;
  return {
    sourceFingerprint: crypto.createHash('sha256').update(fs.readFileSync(savePath)).digest('hex').toUpperCase(),
    seasonYear,
    conferences,
    teams,
    coaches,
    openings,
    nativeOffers,
    staffMoves,
    integrity: { valid: errors === 0, checks, errors, warnings, findings }
  };
}

export async function inspectSave(savePath: string, packaged = app.isPackaged): Promise<SavePreflightResult> {
  const resolved = path.resolve(savePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return blockedShell(resolved, 'The selected file no longer exists.');

  try {
    const testedSchemaPath = schemaPath(packaged);
    if (!fs.existsSync(testedSchemaPath)) return blockedShell(resolved, 'The bundled College Football 27 schema is missing. Reinstall the app.');
    const franchise = await createFranchise(resolved, testedSchemaPath);
    const declared = franchise.expectedSchemaVersion;
    const detectedSchema = `${declared.major}.${declared.minor}`;
    const foundTables = Object.fromEntries(Object.entries(TABLES).map(([name, id]) => [name, franchise.getTableByUniqueId(id)])) as Record<keyof typeof TABLES, TableLike | null>;
    const issues: PreflightIssue[] = [];

    if (detectedSchema !== EXPECTED_SCHEMA) {
      issues.push(issue('UNSUPPORTED_SCHEMA', 'blocking', `Schema ${detectedSchema} is not supported`, `CCR currently requires College Football 27 schema ${EXPECTED_SCHEMA}. No changes were made.`));
    }
    const missing = Object.entries(foundTables).filter(([, table]) => !table).map(([name]) => name);
    if (missing.length) issues.push(issue('MISSING_TABLES', 'blocking', 'Required dynasty data is missing', `Missing: ${missing.join(', ')}.`));
    if (missing.length) {
      const file = fs.statSync(resolved);
      return {
        ...blockedShell(resolved, 'The selected file does not contain the required coaching-carousel tables.'),
        file: { name: path.basename(resolved), path: resolved, sizeBytes: file.size },
        schema: { expected: EXPECTED_SCHEMA, detected: detectedSchema },
        issues
      };
    }

    const tables = foundTables as Tables;
    await Promise.all(Object.values(tables).map((table) => table.readRecords()));
    const season = active(tables.seasonInfo)[0];
    const stage = value<string | null>(season, ['CurrentStage'], null);
    const weekType = value<string | null>(season, ['CurrentWeekType'], null);
    const week = value<number | null>(season, ['CurrentWeek'], null);
    const seasonYear = value<number | null>(season, ['CurrentSeasonYear'], null);
    const carouselActive = value<boolean>(season, ['IsCarouselPeriodActive'], false) === true;

    if (stage !== 'NFLSeason' || weekType !== 'NationalChampionship' || week !== 20 || !carouselActive) {
      issues.push(issue('WRONG_CHECKPOINT', 'blocking', 'Advance to CFP National Championship week', `Detected ${weekType ?? 'unknown week'}, week ${week ?? 'unknown'}, with carousel ${carouselActive ? 'active' : 'inactive'}. CCR only starts at the validated National Championship checkpoint.`));
    }

    const snapshot = normalizeSnapshot(resolved, tables, seasonYear ?? 0);
    if (!snapshot.integrity.valid) {
      issues.push(issue('REFERENCE_INTEGRITY_FAILED', 'blocking', 'The dynasty coaching structure is inconsistent', `${snapshot.integrity.errors} reference or ownership checks failed. No changes were made.`));
    } else if (snapshot.integrity.warnings) {
      issues.push(issue('REFERENCE_INTEGRITY_WARNINGS', 'warning', 'The normalized snapshot has nonblocking warnings', `${snapshot.integrity.warnings} low-risk records require conservative market handling.`));
    }

    const teamsById = new Map(snapshot.teams.map((team) => [team.id, team]));
    const users: LoadedUserCoach[] = snapshot.coaches.filter((coach) => coach.userControlled).map((coach) => {
      const team = coach.employerTeamId ? teamsById.get(coach.employerTeamId) : undefined;
      return {
        coachRow: coach.sourceRow,
        name: coach.name,
        role: coach.role,
        prestige: coach.prestige,
        seasonRecord: `${coach.resume.season.wins}-${coach.resume.season.losses}`,
        careerRecord: `${coach.resume.career.wins}-${coach.resume.career.losses}`,
        contractYearsRemaining: coach.contract.yearsRemaining,
        team: team ? {
          teamRow: team.sourceRow,
          teamIndex: team.teamIndex,
          name: team.name,
          longName: team.longName,
          nickname: team.nickname,
          assetKey: team.assetKey.toLowerCase(),
          prestige: team.prestige,
          nationalRanking: team.nationalRanking,
          primaryColor: team.colors[0],
          secondaryColor: team.colors[1]
        } : null
      };
    });

    if (users.length === 0) issues.push(issue('NO_USER_COACH', 'blocking', 'No user-controlled Coach was found', 'Load a dynasty save with at least one user-controlled coaching profile.'));
    else if (snapshot.integrity.valid) issues.push(issue('READ_ONLY_COMPLETE', 'info', 'Normalized dynasty snapshot ready', `Loaded ${snapshot.teams.length} Teams, ${snapshot.coaches.length} Coaches, ${snapshot.openings.length} staged openings, and ${snapshot.staffMoves.length} indexed Staff Moves in memory. No save data was changed or written.`));

    const file = fs.statSync(resolved);
    return {
      status: issues.some((item) => item.severity === 'blocking') ? 'blocked' : 'ready',
      file: { name: path.basename(resolved), path: resolved, sizeBytes: file.size },
      schema: { expected: EXPECTED_SCHEMA, detected: detectedSchema },
      checkpoint: { seasonYear, stage, weekType, week, carouselActive },
      inventory: {
        teams: snapshot.teams.length,
        coaches: snapshot.coaches.length,
        userCoaches: users.length,
        openings: snapshot.openings.length,
        openingCapacity: tables.openings.header.recordCapacity,
        indexedStaffMoves: snapshot.staffMoves.length
      },
      users,
      snapshot,
      issues
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown parsing error.';
    return blockedShell(resolved, `${detail} No changes were made.`);
  }
}
