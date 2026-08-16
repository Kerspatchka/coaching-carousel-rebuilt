/*
 * Evaluate the EOS outputs from the three-arm BW3 SelectedCoach experiment.
 *
 * Usage:
 *   node scripts/evaluate-bw3-selected-coach-swap.js \
 *     --control <control-eos-save> --sham <sham-eos-save> --test <test-eos-save> \
 *     [--output <result.json>]
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { FranchiseFile } = require('madden-franchise');

const EXPECTED_SCHEMA = '833.0';
const TABLES = {
  coachTransactions: 2701814500,
  offers: 674348040,
  offerArrays: 4119397260,
  openings: 263453863,
  coaches: 1860529246,
  teams: 3359508968
};
const TARGETS = {
  auburn: { team: 'Auburn', teamRow: 9, teamIndex: 8, coach: 'L. Toure', coachRow: 470 },
  coastal: { team: 'C. Carolina', teamRow: 22, teamIndex: 127, coach: 'M. Payne', coachRow: 495 }
};

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--control', '--sham', '--test', '--output'].includes(key)) throw new Error(`Unknown argument: ${key}`);
    result[key.slice(2)] = path.resolve(argv[++index]);
  }
  for (const required of ['control', 'sham', 'test']) {
    if (!result[required] || !fs.existsSync(result[required])) throw new Error(`Missing ${required} EOS save.`);
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function snapshotTable(table) {
  return table.records.map((record) => record ? {
    isEmpty: Boolean(record.isEmpty),
    values: Object.fromEntries(fields(record).map((key) => [key, record[key]]))
  } : null);
}

function snapshot(state) {
  return Object.fromEntries(Object.entries(state.tables).map(([name, table]) => [name, snapshotTable(table)]));
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
      const keys = new Set([...Object.keys(a.values), ...Object.keys(b.values)]);
      for (const field of keys) {
        if (JSON.stringify(a.values[field]) !== JSON.stringify(b.values[field])) {
          output.push({ table, row, field, before: a.values[field], after: b.values[field] });
        }
      }
    }
  }
  return output;
}

function validateEosShape(state, label) {
  const activeOpenings = state.tables.openings.records.filter((record) => record && !record.isEmpty).length;
  assert(activeOpenings === 0, `${label}: expected EOS with zero active openings; found ${activeOpenings}.`);
}

function targetSummary(state) {
  const result = {};
  for (const [key, target] of Object.entries(TARGETS)) {
    const team = state.tables.teams.records[target.teamRow];
    const coach = state.tables.coaches.records[target.coachRow];
    result[key] = {
      team: displayName(team),
      teamRow: target.teamRow,
      defensiveCoordinatorReference: value(team, ['DefensiveCoordinator']),
      expectedCoach: target.coach,
      coach: displayName(coach),
      coachRow: target.coachRow,
      coachReference: state.tables.coaches.getBinaryReferenceToRecord(target.coachRow),
      coachTeamIndex: value(coach, ['TeamIndex']),
      coachPrevTeamIndex: value(coach, ['PrevTeamIndex']),
      coachPosition: value(coach, ['Position']),
      coachPrevPosition: value(coach, ['PrevPosition']),
      coachContractStatus: value(coach, ['ContractStatus']),
      coachContractLength: value(coach, ['ContractLength']),
      coachContractYearsRemaining: value(coach, ['ContractYearsRemaining']),
      coachSeasonsWithTeam: value(coach, ['SeasonsWithTeam'])
    };
  }
  return result;
}

function validateTestTargets(summary) {
  for (const [key, target] of Object.entries(TARGETS)) {
    const actual = summary[key];
    assert(actual.team === target.team, `${key}: team row mismatch.`);
    assert(actual.coach === target.coach, `${key}: coach row mismatch.`);
    assert(actual.defensiveCoordinatorReference === actual.coachReference, `${target.team}: swapped coach was not committed.`);
    assert(actual.coachTeamIndex === target.teamIndex, `${target.coach}: TeamIndex was not updated to ${target.teamIndex}.`);
    assert(actual.coachPosition === 'DefensiveCoordinator', `${target.coach}: final position is not DefensiveCoordinator.`);
  }
}

function transactionSummary(state) {
  const coachByReference = new Map(Object.values(TARGETS).map((target) => [
    state.tables.coaches.getBinaryReferenceToRecord(target.coachRow),
    target.coach
  ]));
  const teamByReference = new Map(state.tables.teams.records
    .filter((record) => record && !record.isEmpty)
    .map((record) => [state.tables.teams.getBinaryReferenceToRecord(record.index), displayName(record)]));
  return state.tables.coachTransactions.records
    .filter((record) => record && !record.isEmpty && coachByReference.has(value(record, ['Coach'])))
    .map((record) => ({
      row: record.index,
      coach: coachByReference.get(value(record, ['Coach'])),
      oldTeam: teamByReference.get(value(record, ['OldTeam'])) || null,
      newTeam: teamByReference.get(value(record, ['NewTeam'])) || null,
      oldPosition: value(record, ['OldCoachPosition']),
      newPosition: value(record, ['NewCoachPosition']),
      transactionId: value(record, ['TransactionId']),
      seasonWeek: value(record, ['SeasonWeek'])
    }));
}

function isAmbientAdvanceDifference(change) {
  return (change.table === 'coaches' && change.field === 'CoachPoints') ||
    (change.table === 'teams' && ['CoachesPoll_NumVoters', 'MediaPoll_NumVoters'].includes(change.field));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schemaPath = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schemaPath && fs.existsSync(schemaPath), 'Set CCR_SCHEMA_PATH to the tested CFB27_833_0.gz schema.');

  const [control, sham, test] = await Promise.all([
    load(options.control, schemaPath),
    load(options.sham, schemaPath),
    load(options.test, schemaPath)
  ]);
  validateEosShape(control, 'control');
  validateEosShape(sham, 'sham');
  validateEosShape(test, 'test');

  const controlSnapshot = snapshot(control);
  const shamSnapshot = snapshot(sham);
  const testSnapshot = snapshot(test);
  const shamVsControl = differences(controlSnapshot, shamSnapshot);
  const testVsSham = differences(shamSnapshot, testSnapshot);
  const allowedEntities = new Set(['teams:9', 'teams:22', 'coaches:470', 'coaches:495']);
  const collateral = testVsSham.filter((change) => !allowedEntities.has(`${change.table}:${change.row}`));
  const unexplainedShamDifferences = shamVsControl.filter((change) => !isAmbientAdvanceDifference(change));
  const unexplainedCollateral = collateral.filter((change) => !isAmbientAdvanceDifference(change));
  const testTargets = targetSummary(test);
  validateTestTargets(testTargets);
  const controlTransactions = transactionSummary(control);
  const shamTransactions = transactionSummary(sham);
  const testTransactions = transactionSummary(test);
  const transactionLedgerChangedForSwap = JSON.stringify(shamTransactions) !== JSON.stringify(testTransactions);

  const result = {
    evaluatedAt: new Date().toISOString(),
    status: unexplainedShamDifferences.length === 0 && unexplainedCollateral.length === 0
      ? (transactionLedgerChangedForSwap ? 'passed' : 'passed-core-stale-presentation-ledger')
      : 'needs-review',
    files: {
      control: { path: options.control, sha256: sha256(options.control) },
      sham: { path: options.sham, sha256: sha256(options.sham) },
      test: { path: options.test, sha256: sha256(options.test) }
    },
    targetAssignments: testTargets,
    transactionHistory: {
      control: controlTransactions,
      sham: shamTransactions,
      test: testTransactions,
      changedForSwap: transactionLedgerChangedForSwap
    },
    comparisons: {
      shamVsControlFocusedDifferences: shamVsControl,
      unexplainedShamDifferences,
      testVsShamFocusedDifferences: testVsSham,
      collateralFocusedDifferences: collateral,
      unexplainedCollateralDifferences: unexplainedCollateral
    },
    interpretation: unexplainedShamDifferences.length
      ? 'The zero-change sham introduced differences beyond known run-to-run advance variation.'
      : unexplainedCollateral.length
        ? 'The swap committed, but unexplained unrelated focused carousel records also changed.'
        : transactionLedgerChangedForSwap
          ? 'The swap committed, including the coach transaction presentation ledger.'
          : 'The actual Team/Coach swap committed, but CoachTransactionHistoryEntry retained the native pairings used by Staff Moves presentation.'
  };

  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json);
  process.stdout.write(json);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
