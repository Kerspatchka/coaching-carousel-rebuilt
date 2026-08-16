/*
 * Evaluate EOS outputs from the synchronized SelectedCoach/history experiment.
 *
 * Usage:
 *   node scripts/evaluate-bw3-synchronized-history-oldteam.js \
 *     --control <control-eos> --sham <sham-eos> --test <test-eos> \
 *     [--output <result.json>]
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { FranchiseFile } = require('madden-franchise');

const EXPECTED_SCHEMA = '833.0';
const EMPTY_REF = '00000000000000000000000000000000';
const TABLES = {
  coachTransactions: 2701814500,
  openings: 263453863,
  coaches: 1860529246,
  teams: 3359508968
};
const TARGETS = [
  { key: 'auburnDc', teamRow: 9, staffField: 'DefensiveCoordinator', coachRow: 470, coach: 'L. Toure', position: 'DefensiveCoordinator' },
  { key: 'coastalDc', teamRow: 22, staffField: 'DefensiveCoordinator', coachRow: 495, coach: 'M. Payne', position: 'DefensiveCoordinator' },
  { key: 'rutgersOc', teamRow: 98, staffField: 'OffensiveCoordinator', coachRow: 411, coach: 'M. Warner', position: 'OffensiveCoordinator' },
  { key: 'niuOc', teamRow: 83, staffField: 'OffensiveCoordinator', coachRow: 304, coach: 'J. Pappalardo', position: 'OffensiveCoordinator' }
];
const TRANSACTIONS = [
  { row: 62, coachRow: 495, oldTeamRow: null, newTeamRow: 22 },
  { row: 93, coachRow: 470, oldTeamRow: null, newTeamRow: 9 },
  { row: 100, coachRow: 411, oldTeamRow: 124, newTeamRow: 98 },
  { row: 119, coachRow: 304, oldTeamRow: 130, newTeamRow: 83 }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    assert(['--control', '--sham', '--test', '--output'].includes(key), `Unknown argument: ${key}`);
    assert(index + 1 < argv.length, `Missing value for ${key}.`);
    result[key.slice(2)] = path.resolve(argv[++index]);
  }
  for (const required of ['control', 'sham', 'test']) {
    assert(result[required] && fs.existsSync(result[required]), `Missing ${required} EOS save.`);
  }
  return result;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function fields(record) {
  return record && Array.isArray(record.fieldsArray) ? record.fieldsArray.map((field) => field.key) : [];
}

function value(record, aliases, fallback = null) {
  const names = fields(record);
  const lower = new Map(names.map((name) => [name.toLowerCase(), name]));
  const key = aliases.find((name) => names.includes(name)) || aliases.map((name) => lower.get(name.toLowerCase())).find(Boolean);
  if (!key) return fallback;
  const result = record[key];
  return result === undefined || result === null ? fallback : result;
}

function displayName(record) {
  const direct = value(record, ['DisplayName', 'LongName', 'Name'], '');
  return String(direct).trim() || [value(record, ['FirstName'], ''), value(record, ['LastName'], '')].join(' ').trim();
}

function createFranchise(savePath, schemaPath) {
  return new Promise((resolve, reject) => {
    let franchise;
    try {
      franchise = new FranchiseFile(savePath, { autoParse: false, gameTypeOverride: 'college', gameYearOverride: 27 });
      const declared = franchise.expectedSchemaVersion;
      franchise.settings.schemaOverride = { major: declared.major, minor: declared.minor, gameYear: declared.gameYear, path: schemaPath };
    } catch (error) {
      reject(error);
      return;
    }
    franchise.on('ready', () => resolve(franchise));
    franchise.on('error', reject);
    franchise.parse();
  });
}

async function load(savePath, schemaPath) {
  const franchise = await createFranchise(savePath, schemaPath);
  const schema = `${franchise.expectedSchemaVersion.major}.${franchise.expectedSchemaVersion.minor}`;
  assert(schema === EXPECTED_SCHEMA, `Expected schema ${EXPECTED_SCHEMA}, found ${schema}.`);
  const tables = Object.fromEntries(Object.entries(TABLES).map(([name, id]) => [name, franchise.getTableByUniqueId(id)]));
  for (const [name, table] of Object.entries(tables)) assert(table, `Missing ${name} table.`);
  await Promise.all(Object.values(tables).map((table) => table.readRecords()));
  return { savePath, schema, tables };
}

function snapshot(state) {
  return Object.fromEntries(Object.entries(state.tables).map(([name, table]) => [name, table.records.map((record) => record ? {
    isEmpty: Boolean(record.isEmpty),
    values: Object.fromEntries(fields(record).map((field) => [field, record[field]]))
  } : null)]));
}

function differences(before, after) {
  const output = [];
  for (const table of Object.keys(TABLES)) {
    const length = Math.max(before[table].length, after[table].length);
    for (let row = 0; row < length; row += 1) {
      const a = before[table][row];
      const b = after[table][row];
      if (!a || !b || a.isEmpty !== b.isEmpty) {
        output.push({ table, row, field: '$record', before: a && a.isEmpty, after: b && b.isEmpty });
        continue;
      }
      for (const field of new Set([...Object.keys(a.values), ...Object.keys(b.values)])) {
        if (JSON.stringify(a.values[field]) !== JSON.stringify(b.values[field])) {
          output.push({ table, row, field, before: a.values[field], after: b.values[field] });
        }
      }
    }
  }
  return output;
}

function teamRef(state, row) {
  return row === null ? EMPTY_REF : state.tables.teams.getBinaryReferenceToRecord(row);
}

function coachRef(state, row) {
  return state.tables.coaches.getBinaryReferenceToRecord(row);
}

function assignmentSummary(state) {
  return TARGETS.map((target) => {
    const team = state.tables.teams.records[target.teamRow];
    const coach = state.tables.coaches.records[target.coachRow];
    return {
      ...target,
      team: displayName(team),
      teamIndex: value(team, ['TeamIndex']),
      staffReference: value(team, [target.staffField]),
      coachReference: coachRef(state, target.coachRow),
      actualCoach: displayName(coach),
      coachTeamIndex: value(coach, ['TeamIndex']),
      coachPosition: value(coach, ['Position']),
      contractStatus: value(coach, ['ContractStatus']),
      contractLength: value(coach, ['ContractLength']),
      contractYearsRemaining: value(coach, ['ContractYearsRemaining']),
      seasonsWithTeam: value(coach, ['SeasonsWithTeam'])
    };
  });
}

function transactionSummary(state) {
  return TRANSACTIONS.map((expected) => {
    const record = state.tables.coachTransactions.records[expected.row];
    return {
      ...expected,
      coach: displayName(state.tables.coaches.records[expected.coachRow]),
      coachReference: value(record, ['Coach']),
      expectedCoachReference: coachRef(state, expected.coachRow),
      oldTeamReference: value(record, ['OldTeam']),
      expectedOldTeamReference: teamRef(state, expected.oldTeamRow),
      oldTeam: expected.oldTeamRow === null ? null : displayName(state.tables.teams.records[expected.oldTeamRow]),
      newTeamReference: value(record, ['NewTeam']),
      expectedNewTeamReference: teamRef(state, expected.newTeamRow),
      newTeam: displayName(state.tables.teams.records[expected.newTeamRow]),
      oldPosition: value(record, ['OldCoachPosition']),
      newPosition: value(record, ['NewCoachPosition']),
      seasonWeek: value(record, ['SeasonWeek'])
    };
  });
}

function validateTest(state, assignments, transactions) {
  const activeOpenings = state.tables.openings.records.filter((record) => record && !record.isEmpty).length;
  assert(activeOpenings === 0, `Test is not EOS: found ${activeOpenings} active openings.`);
  for (const item of assignments) {
    assert(item.actualCoach === item.coach, `${item.key}: unexpected coach row identity.`);
    assert(item.staffReference === item.coachReference, `${item.key}: target coach was not committed to the Team staff field.`);
    assert(item.coachTeamIndex === item.teamIndex, `${item.key}: Coach TeamIndex does not match destination TeamIndex.`);
    assert(item.coachPosition === item.position, `${item.key}: final coach position is ${item.coachPosition}.`);
  }
  for (const item of transactions) {
    assert(item.coachReference === item.expectedCoachReference, `Transaction ${item.row}: Coach reference changed.`);
    assert(item.oldTeamReference === item.expectedOldTeamReference, `Transaction ${item.row}: OldTeam is not preserved.`);
    assert(item.newTeamReference === item.expectedNewTeamReference, `Transaction ${item.row}: NewTeam is not the synchronized destination.`);
  }
}

function isAmbient(change) {
  return (change.table === 'coaches' && change.field === 'CoachPoints') ||
    (change.table === 'coaches' && change.field === 'CurrentJobSecurityPercentageRank') ||
    (change.table === 'teams' && ['CoachesPoll_NumVoters', 'MediaPoll_NumVoters'].includes(change.field));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schemaPath = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schemaPath && fs.existsSync(schemaPath), 'Set CCR_SCHEMA_PATH to the tested CFB27_833_0.gz schema.');
  const [control, sham, test] = await Promise.all([
    load(options.control, schemaPath), load(options.sham, schemaPath), load(options.test, schemaPath)
  ]);
  for (const [label, state] of Object.entries({ control, sham, test })) {
    const count = state.tables.openings.records.filter((record) => record && !record.isEmpty).length;
    assert(count === 0, `${label}: expected EOS with zero active openings; found ${count}.`);
  }

  const assignments = assignmentSummary(test);
  const transactions = transactionSummary(test);
  validateTest(test, assignments, transactions);
  const shamVsControl = differences(snapshot(control), snapshot(sham));
  const testVsSham = differences(snapshot(sham), snapshot(test));
  const allowed = new Set([
    ...TARGETS.flatMap((target) => [`teams:${target.teamRow}`, `coaches:${target.coachRow}`]),
    ...TRANSACTIONS.map((item) => `coachTransactions:${item.row}`)
  ]);
  const unexplainedSham = shamVsControl.filter((change) => !isAmbient(change));
  const collateral = testVsSham.filter((change) => !allowed.has(`${change.table}:${change.row}`));
  const unexplainedCollateral = collateral.filter((change) => !isAmbient(change));
  const status = unexplainedSham.length === 0 && unexplainedCollateral.length === 0 ? 'passed' : 'needs-review';
  const result = {
    evaluatedAt: new Date().toISOString(),
    status,
    files: Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'output').map(([key, filePath]) => [key, { path: filePath, sha256: sha256(filePath) }])),
    targetAssignments: assignments,
    targetTransactions: transactions,
    comparisons: { shamVsControl, unexplainedSham, testVsSham, collateral, unexplainedCollateral },
    interpretation: status === 'passed'
      ? 'All four assignments and all four coach-owned transaction histories committed. Remaining non-target differences are known independent Coach Point/poll variation or the derived global job-security rank reorder caused by changed target-coach destination context.'
      : 'Target writes committed, but at least one comparison contains differences requiring review.'
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json);
  process.stdout.write(json);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
