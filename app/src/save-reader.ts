import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { FranchiseFile } from 'madden-franchise';
import type { LoadedUserCoach, PreflightIssue, SavePreflightResult } from './shared/desktop-api';

const EXPECTED_SCHEMA = '833.0';
const EMPTY_REF = '00000000000000000000000000000000';
const TABLES = {
  seasonInfo: 3123991521,
  coaches: 1860529246,
  teams: 3359508968,
  openings: 263453863,
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
};

type FranchiseLike = {
  expectedSchemaVersion: { major: number; minor: number; gameYear: number };
  settings: { schemaOverride: { major: number; minor: number; gameYear: number; path: string } };
  getTableByUniqueId(id: number): TableLike | null;
  on(event: 'ready' | 'error', callback: (...args: unknown[]) => void): void;
  parse(): void;
};

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

function displayName(record: RecordLike): string {
  const personalName = `${value(record, ['FirstName'], '')} ${value(record, ['LastName'], '')}`.trim();
  if (personalName) return personalName;
  const direct = String(value(record, ['LongName', 'DisplayName', 'Name'], '')).trim();
  return direct;
}

function active(table: TableLike): RecordLike[] {
  return table.records.filter((record) => record && !record.isEmpty);
}

function rowFromReference(reference: unknown): number | null {
  if (typeof reference !== 'string' || reference === EMPTY_REF || !/^[01]{32}$/.test(reference)) return null;
  return Number.parseInt(reference.slice(15), 2);
}

function color(record: RecordLike, suffix = ''): string {
  const channel = (name: string) => Math.max(0, Math.min(255, Number(value(record, [`TEAM_BACKGROUNDCOLOR${name}${suffix}`], 0))));
  return `rgb(${channel('R')}, ${channel('G')}, ${channel('B')})`;
}

function recordFromReference(table: TableLike, reference: unknown): RecordLike | undefined {
  const row = rowFromReference(reference);
  return row === null ? undefined : table.records[row];
}

function createFranchise(savePath: string, testedSchemaPath: string): Promise<FranchiseLike> {
  return new Promise((resolve, reject) => {
    try {
      const FranchiseConstructor = FranchiseFile as unknown as new (filePath: string, settings: Record<string, unknown>) => FranchiseLike;
      const franchise = new FranchiseConstructor(savePath, {
        autoParse: false,
        gameTypeOverride: 'college',
        gameYearOverride: 27
      }) as unknown as FranchiseLike;
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
    issues: [issue('UNREADABLE_SAVE', 'blocking', 'This file could not be read as a supported dynasty save', detail)]
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

    const tables = foundTables as Record<keyof typeof TABLES, TableLike>;
    await Promise.all(Object.values(tables).map((table) => table.readRecords()));
    const season = active(tables.seasonInfo)[0];
    const stage = value<string | null>(season, ['CurrentStage'], null);
    const weekType = value<string | null>(season, ['CurrentWeekType'], null);
    const week = value<number | null>(season, ['CurrentWeek'], null);
    const seasonYear = value<number | null>(season, ['CurrentSeasonYear'], null);
    const carouselActive = value<boolean>(season, ['IsCarouselPeriodActive'], false) === true;

    if (stage !== 'NFLSeason' || weekType !== 'NationalChampionship' || week !== 20 || !carouselActive) {
      issues.push(issue(
        'WRONG_CHECKPOINT',
        'blocking',
        'Advance to CFP National Championship week',
        `Detected ${weekType ?? 'unknown week'}, week ${week ?? 'unknown'}, with carousel ${carouselActive ? 'active' : 'inactive'}. CCR only starts at the validated National Championship checkpoint.`
      ));
    }

    const teamsByIndex = new Map(active(tables.teams).map((team) => [Number(value(team, ['TeamIndex'], -1)), team]));
    const users: LoadedUserCoach[] = active(tables.coaches)
      .filter((coach) => value<boolean>(coach, ['IsUserControlled'], false) === true)
      .map((coach) => {
        const team = teamsByIndex.get(Number(value(coach, ['TeamIndex'], -1)));
        const seasonStats = recordFromReference(tables.seasonCoachStats, value(coach, ['SeasonStats'], EMPTY_REF));
        const careerStats = recordFromReference(tables.careerCoachStats, value(coach, ['CareerStats'], EMPTY_REF));
        const ranking = team ? Number(value(team, ['TeamRank', 'CFPPoll_CurrentRank'], 0)) : 0;
        return {
          coachRow: coach.index,
          name: displayName(coach),
          role: String(value(coach, ['Position'], 'Unknown')),
          prestige: String(value(coach, ['CoachPrestige'], '—')),
          seasonRecord: `${value(seasonStats, ['Wins'], 0)}-${value(seasonStats, ['Losses'], 0)}`,
          careerRecord: `${value(careerStats, ['Wins'], 0)}-${value(careerStats, ['Losses'], 0)}`,
          contractYearsRemaining: value<number | null>(coach, ['ContractYearsRemaining'], null),
          team: team ? {
            teamRow: team.index,
            teamIndex: Number(value(team, ['TeamIndex'], -1)),
            name: String(value(team, ['DisplayName', 'LongName'], 'Unknown Team')),
            longName: String(value(team, ['LongName', 'DisplayName'], 'Unknown Team')),
            nickname: String(value(team, ['NickName'], '')),
            assetKey: String(value(team, ['AssetName', 'ShortName'], '')).toLowerCase(),
            prestige: value<number | null>(team, ['TeamPrestige'], null),
            nationalRanking: ranking > 0 && ranking <= 25 ? ranking : null,
            primaryColor: color(team),
            secondaryColor: color(team, '2')
          } : null
        };
      });

    if (users.length === 0) issues.push(issue('NO_USER_COACH', 'blocking', 'No user-controlled Coach was found', 'Load a dynasty save with at least one user-controlled coaching profile.'));
    else issues.push(issue('READ_ONLY_COMPLETE', 'info', 'Read-only inspection complete', 'The selected save was parsed in memory. No save data was changed or written.'));

    const transactionArray = active(tables.transactionArrays)[0];
    const indexedStaffMoves = transactionArray
      ? fields(transactionArray).filter((name) => /^CoachTransactionHistoryEntry\d+$/i.test(name) && value(transactionArray, [name], EMPTY_REF) !== EMPTY_REF).length
      : 0;
    const file = fs.statSync(resolved);
    return {
      status: issues.some((item) => item.severity === 'blocking') ? 'blocked' : 'ready',
      file: { name: path.basename(resolved), path: resolved, sizeBytes: file.size },
      schema: { expected: EXPECTED_SCHEMA, detected: detectedSchema },
      checkpoint: { seasonYear, stage, weekType, week, carouselActive },
      inventory: {
        teams: active(tables.teams).length,
        coaches: active(tables.coaches).length,
        userCoaches: users.length,
        openings: active(tables.openings).length,
        openingCapacity: tables.openings.header.recordCapacity,
        indexedStaffMoves
      },
      users,
      issues
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown parsing error.';
    return blockedShell(resolved, `${detail} No changes were made.`);
  }
}
