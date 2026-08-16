/* Inventory coach-history depth available from one BW3 save. Read-only. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF,
  assert,
  displayName,
  loadExperimentState,
  sha256
} = require('./prepare-bw3-selected-coach-swap');

const TABLES = {
  seasonCoachStats: 564984853,
  careerCoachStats: 1758861850,
  coachAwards: 3027881868,
  coachTransactions: 2701814500,
  contractYearSummary: 1405944643,
  contractYearSummaryArrays: 2801595384
};

function fields(record) {
  return record && Array.isArray(record.fieldsArray) ? record.fieldsArray.map((field) => field.key) : [];
}

function values(record) {
  return Object.fromEntries(fields(record).map((field) => [field, record[field]]));
}

function rowFromReference(reference) {
  return reference && reference !== EMPTY_REF ? Number.parseInt(reference.slice(15), 2) : null;
}

function distribution(items) {
  return Object.fromEntries([...items.reduce((map, item) => map.set(String(item), (map.get(String(item)) || 0) + 1), new Map())]);
}

function teamResolver(teamTable) {
  const byReference = new Map(teamTable.records.filter((record) => record && !record.isEmpty)
    .map((record) => [teamTable.getBinaryReferenceToRecord(record.index), displayName(record)]));
  const byIndex = new Map(teamTable.records.filter((record) => record && !record.isEmpty)
    .map((record) => [Number(record.TeamIndex), displayName(record)]));
  return {
    reference: (reference) => reference === EMPTY_REF ? null : (byReference.get(reference) || null),
    index: (index) => Number(index) === 255 ? null : (byIndex.get(Number(index)) || null)
  };
}

async function main() {
  const source = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'));
  const output = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(fs.existsSync(source), `Missing source: ${source}`);
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const state = await loadExperimentState(source, schema);
  const tables = Object.fromEntries(Object.entries(TABLES).map(([name, uniqueId]) => [name, state.franchise.getTableByUniqueId(uniqueId)]));
  for (const [name, table] of Object.entries(tables)) assert(table, `Missing ${name} table.`);
  await Promise.all(Object.values(tables).map((table) => table.readRecords()));

  const coaches = state.tables.coaches.records.filter((record) => record && !record.isEmpty);
  const teams = teamResolver(state.tables.teams);
  const coachByReference = new Map(coaches.map((coach) => [state.tables.coaches.getBinaryReferenceToRecord(coach.index), coach]));
  const transactionsByCoach = new Map();
  for (const record of tables.coachTransactions.records.filter((item) => item && !item.isEmpty && item.Coach !== EMPTY_REF)) {
    if (!transactionsByCoach.has(record.Coach)) transactionsByCoach.set(record.Coach, []);
    transactionsByCoach.get(record.Coach).push({
      row: record.index,
      oldTeam: teams.reference(record.OldTeam),
      newTeam: teams.reference(record.NewTeam),
      oldRole: record.OldCoachPosition,
      newRole: record.NewCoachPosition,
      contractStatus: record.ContractStatus,
      contractLength: record.ContractLength,
      seasonStage: record.SeasonStage,
      seasonYear: record.SeasonYear,
      seasonWeek: record.SeasonWeek,
      transactionId: record.TransactionId
    });
  }
  const awardsByCoach = new Map();
  for (const record of tables.coachAwards.records.filter((item) => item && !item.isEmpty && item.Coach !== EMPTY_REF)) {
    if (!awardsByCoach.has(record.Coach)) awardsByCoach.set(record.Coach, []);
    awardsByCoach.get(record.Coach).push({
      row: record.index,
      team: teams.reference(record.Team),
      period: record.Period,
      periodIndex: record.PeriodIndex,
      awardType: record.AwardType
    });
  }

  const inlineHistoryPattern = /^(Career|Seas|EarnedContractPoints_|YearsCoaching$|SeasonsWithTeam$|.*WinStreak$|WinSeasStreak$|YearlyAwardCount$|AwardPoints$|LegacyScore$|COACH_LAST)/;
  const coachRows = coaches.map((coach) => {
    const reference = state.tables.coaches.getBinaryReferenceToRecord(coach.index);
    const careerRow = rowFromReference(coach.CareerStats);
    const seasonRow = rowFromReference(coach.SeasonStats);
    const inline = Object.fromEntries(fields(coach).filter((field) => inlineHistoryPattern.test(field)).map((field) => [field, coach[field]]));
    return {
      row: coach.index,
      reference,
      name: displayName(coach),
      role: coach.Position,
      currentTeamIndex: coach.TeamIndex,
      currentTeam: teams.index(coach.TeamIndex),
      previousTeamIndex: coach.PrevTeamIndex,
      previousTeam: teams.index(coach.PrevTeamIndex),
      previousRole: coach.PrevPosition,
      contractStatus: coach.ContractStatus,
      isNIL: coach.IsNIL,
      isCreated: coach.IsCreated,
      inlineHistory: inline,
      currentSeasonStats: seasonRow === null ? null : values(tables.seasonCoachStats.records[seasonRow]),
      aggregateCareerStats: careerRow === null ? null : values(tables.careerCoachStats.records[careerRow]),
      transactions: transactionsByCoach.get(reference) || [],
      awards: awardsByCoach.get(reference) || [],
      contractYearSummariesReference: coach.ContractYearSummaries === EMPTY_REF ? null : coach.ContractYearSummaries,
      weeklyGoalsReference: coach.WeeklyGoals === EMPTY_REF ? null : coach.WeeklyGoals,
      seasonalGoalReference: coach.SeasonalGoal === EMPTY_REF ? null : coach.SeasonalGoal
    };
  });

  const withCareer = coachRows.filter((coach) => coach.aggregateCareerStats);
  const withoutCareer = coachRows.filter((coach) => !coach.aggregateCareerStats);
  const transactionRecords = tables.coachTransactions.records.filter((record) => record && !record.isEmpty && record.Coach !== EMPTY_REF);
  const result = {
    generatedAt: new Date().toISOString(),
    source,
    sourceSha256: sha256(source),
    schema: state.declaredSchema,
    interpretation: {
      seasonCoachStats: 'One linked Wins/Losses record for the current season; no season/year key.',
      careerCoachStats: 'One linked aggregate career resume record; no season-by-season rows or school-by-school sequence.',
      inlineContractPoints: 'Three rolling scalar buckets: this year, last year, and two years ago.',
      transactions: 'Dated staff-move ledger. In this Year 1 fixture, every coach transaction belongs to SeasonYear 0.',
      awards: 'Current persisted CoachAward records; the fixture contains only two Season/PeriodIndex 0 awards.',
      contractYearSummaries: 'Schema and empty tables exist, but no Coach references them at BW3 and both tables have zero active records.'
    },
    coverage: {
      coaches: coachRows.length,
      withCurrentSeasonStats: coachRows.filter((coach) => coach.currentSeasonStats).length,
      withAggregateCareerStats: withCareer.length,
      withoutAggregateCareerStats: withoutCareer.length,
      withAtLeastOneTransaction: coachRows.filter((coach) => coach.transactions.length).length,
      withAtLeastOneAward: coachRows.filter((coach) => coach.awards.length).length,
      withContractYearSummaryReference: coachRows.filter((coach) => coach.contractYearSummariesReference).length,
      withWeeklyGoalsReference: coachRows.filter((coach) => coach.weeklyGoalsReference).length,
      withSeasonalGoalReference: coachRows.filter((coach) => coach.seasonalGoalReference).length,
      withoutCareerStatsProfile: {
        teamIndex255: withoutCareer.filter((coach) => Number(coach.currentTeamIndex) === 255).length,
        nilCoaches: withoutCareer.filter((coach) => coach.isNIL).length,
        byContractStatus: distribution(withoutCareer.map((coach) => coach.contractStatus)),
        byRole: distribution(withoutCareer.map((coach) => coach.role))
      }
    },
    linkedTableShapes: {
      currentSeason: { uniqueId: TABLES.seasonCoachStats, activeRecords: tables.seasonCoachStats.records.filter((record) => record && !record.isEmpty).length, fields: fields(tables.seasonCoachStats.records.find((record) => record && !record.isEmpty)) },
      aggregateCareer: { uniqueId: TABLES.careerCoachStats, activeRecords: tables.careerCoachStats.records.filter((record) => record && !record.isEmpty).length, fields: fields(tables.careerCoachStats.records.find((record) => record && !record.isEmpty)) },
      transactions: { uniqueId: TABLES.coachTransactions, activeRecords: transactionRecords.length, fields: fields(tables.coachTransactions.records.find((record) => record && !record.isEmpty)) },
      awards: { uniqueId: TABLES.coachAwards, activeRecords: tables.coachAwards.records.filter((record) => record && !record.isEmpty).length, fields: fields(tables.coachAwards.records.find((record) => record && !record.isEmpty)) },
      contractYearSummary: { uniqueId: TABLES.contractYearSummary, activeRecords: tables.contractYearSummary.records.filter((record) => record && !record.isEmpty).length, fields: fields(tables.contractYearSummary.records[0]) },
      contractYearSummaryArrays: { uniqueId: TABLES.contractYearSummaryArrays, activeRecords: tables.contractYearSummaryArrays.records.filter((record) => record && !record.isEmpty).length, fields: fields(tables.contractYearSummaryArrays.records[0]) }
    },
    transactionLedger: {
      records: transactionRecords.length,
      distinctCoaches: new Set(transactionRecords.map((record) => record.Coach)).size,
      seasonYears: distribution(transactionRecords.map((record) => record.SeasonYear)),
      seasonStages: distribution(transactionRecords.map((record) => record.SeasonStage)),
      seasonWeeks: distribution(transactionRecords.map((record) => record.SeasonWeek)),
      maximumRowsForOneCoach: Math.max(0, ...coachRows.map((coach) => coach.transactions.length))
    },
    coachAwards: coachRows.flatMap((coach) => coach.awards.map((award) => ({ coachRow: coach.row, coach: coach.name, ...award }))),
    coaches: coachRows
  };

  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (output) fs.writeFileSync(output, json);
  else process.stdout.write(json);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
