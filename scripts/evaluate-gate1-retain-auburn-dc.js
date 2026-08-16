/* Evaluate Gate 1 EOS outputs: cancel Auburn DC move and retain D. Durkin. */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { FranchiseFile } = require('madden-franchise');

const EMPTY_REF = '00000000000000000000000000000000';
const TABLES = {
  coachTransactions: 2701814500,
  transactionArrays: 1261824345,
  openings: 263453863,
  coaches: 1860529246,
  teams: 3359508968
};
const TARGET = { teamRow: 9, incumbentRow: 128, canceledHireRow: 495, transactionRows: [22, 62] };

function assert(condition, message) { if (!condition) throw new Error(message); }
function sha256(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase(); }
function fields(record) { return record && Array.isArray(record.fieldsArray) ? record.fieldsArray.map((field) => field.key) : []; }
function value(record, aliases, fallback = null) {
  const names = fields(record);
  const lower = new Map(names.map((name) => [name.toLowerCase(), name]));
  const key = aliases.find((name) => names.includes(name)) || aliases.map((name) => lower.get(name.toLowerCase())).find(Boolean);
  if (!key) return fallback;
  return record[key] === undefined || record[key] === null ? fallback : record[key];
}
function displayName(record) {
  const direct = value(record, ['DisplayName', 'LongName', 'Name'], '');
  return String(direct).trim() || [value(record, ['FirstName'], ''), value(record, ['LastName'], '')].join(' ').trim();
}
function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    assert(['--control', '--sham', '--test', '--output'].includes(key), `Unknown argument: ${key}`);
    options[key.slice(2)] = path.resolve(argv[++index]);
  }
  for (const required of ['control', 'sham', 'test']) assert(options[required] && fs.existsSync(options[required]), `Missing ${required} EOS save.`);
  return options;
}
function createFranchise(savePath, schemaPath) {
  return new Promise((resolve, reject) => {
    let franchise;
    try {
      franchise = new FranchiseFile(savePath, { autoParse: false, gameTypeOverride: 'college', gameYearOverride: 27 });
      const declared = franchise.expectedSchemaVersion;
      franchise.settings.schemaOverride = { major: declared.major, minor: declared.minor, gameYear: declared.gameYear, path: schemaPath };
    } catch (error) { reject(error); return; }
    franchise.on('ready', () => resolve(franchise));
    franchise.on('error', reject);
    franchise.parse();
  });
}
async function load(savePath, schemaPath) {
  const franchise = await createFranchise(savePath, schemaPath);
  const tables = Object.fromEntries(Object.entries(TABLES).map(([name, id]) => [name, franchise.getTableByUniqueId(id)]));
  for (const [name, table] of Object.entries(tables)) assert(table, `Missing ${name} table.`);
  await Promise.all(Object.values(tables).map((table) => table.readRecords()));
  return { franchise, tables };
}
function snapshot(state) {
  return Object.fromEntries(Object.entries(state.tables).map(([name, table]) => [name, {
    arraySizes: Array.isArray(table.arraySizes) ? [...table.arraySizes] : null,
    records: table.records.map((record) => record ? { isEmpty: Boolean(record.isEmpty), values: Object.fromEntries(fields(record).map((field) => [field, record[field]])) } : null)
  }]));
}
function differences(before, after) {
  const output = [];
  for (const table of Object.keys(TABLES)) {
    if (JSON.stringify(before[table].arraySizes) !== JSON.stringify(after[table].arraySizes)) output.push({ table, field: '$arraySizes', before: before[table].arraySizes, after: after[table].arraySizes });
    const length = Math.max(before[table].records.length, after[table].records.length);
    for (let row = 0; row < length; row += 1) {
      const a = before[table].records[row];
      const b = after[table].records[row];
      if (!a || !b || a.isEmpty !== b.isEmpty) { output.push({ table, row, field: '$record', before: a && a.isEmpty, after: b && b.isEmpty }); continue; }
      for (const field of new Set([...Object.keys(a.values), ...Object.keys(b.values)])) {
        if (JSON.stringify(a.values[field]) !== JSON.stringify(b.values[field])) output.push({ table, row, field, before: a.values[field], after: b.values[field] });
      }
    }
  }
  return output;
}
function transactionSlots(record) {
  return fields(record).filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}
function targetSummary(state) {
  const { teams, coaches, coachTransactions, transactionArrays } = state.tables;
  const team = teams.records[TARGET.teamRow];
  const durkin = coaches.records[TARGET.incumbentRow];
  const payne = coaches.records[TARGET.canceledHireRow];
  const arrayRecord = transactionArrays.records[0];
  const size = transactionArrays.arraySizes[0];
  const indexed = transactionSlots(arrayRecord).slice(0, size).map((field) => arrayRecord[field]);
  return {
    team: displayName(team),
    defensiveCoordinatorReference: value(team, ['DefensiveCoordinator']),
    durkin: {
      name: displayName(durkin), reference: coaches.getBinaryReferenceToRecord(TARGET.incumbentRow), teamIndex: value(durkin, ['TeamIndex']),
      prevTeamIndex: value(durkin, ['PrevTeamIndex']), position: value(durkin, ['Position']), contractStatus: value(durkin, ['ContractStatus']),
      contractLength: value(durkin, ['ContractLength']), contractYearsRemaining: value(durkin, ['ContractYearsRemaining'])
    },
    payne: {
      name: displayName(payne), reference: coaches.getBinaryReferenceToRecord(TARGET.canceledHireRow), teamIndex: value(payne, ['TeamIndex']),
      prevTeamIndex: value(payne, ['PrevTeamIndex']), position: value(payne, ['Position']), contractStatus: value(payne, ['ContractStatus']),
      contractLength: value(payne, ['ContractLength']), contractYearsRemaining: value(payne, ['ContractYearsRemaining'])
    },
    transactionRows: Object.fromEntries(TARGET.transactionRows.map((row) => [row, { isEmpty: Boolean(coachTransactions.records[row].isEmpty), indexed: indexed.includes(coachTransactions.getBinaryReferenceToRecord(row)) }])),
    transactionArraySize: size
  };
}
function validateEos(state, label) {
  const count = state.tables.openings.records.filter((record) => record && !record.isEmpty).length;
  assert(count === 0, `${label}: expected EOS with zero active openings, found ${count}.`);
}
function validateTest(summary) {
  assert(summary.team === 'Auburn', 'Unexpected Auburn Team row.');
  assert(summary.durkin.name === 'D. Durkin' && summary.payne.name === 'M. Payne', 'Target Coach identity mismatch.');
  assert(summary.defensiveCoordinatorReference === summary.durkin.reference, 'Auburn did not retain D. Durkin.');
  assert(summary.durkin.teamIndex === 8 && summary.durkin.position === 'DefensiveCoordinator', 'D. Durkin employment is incoherent.');
  assert(String(summary.durkin.contractStatus).includes('Active'), 'D. Durkin is not active after EOS.');
  assert(summary.payne.teamIndex === 255 && summary.payne.contractStatus === 'FreeAgent', 'M. Payne did not remain a free agent.');
  for (const row of TARGET.transactionRows) {
    assert(summary.transactionRows[row].isEmpty, `Canceled transaction ${row} is active.`);
    assert(!summary.transactionRows[row].indexed, `Canceled transaction ${row} remains indexed.`);
  }
  assert(summary.transactionArraySize === 122, `Expected transaction array size 122, found ${summary.transactionArraySize}.`);
}
function isAmbient(change) {
  return (change.table === 'coaches' && ['CoachPoints', 'CurrentJobSecurityPercentageRank'].includes(change.field)) ||
    (change.table === 'teams' && ['CoachesPoll_NumVoters', 'MediaPoll_NumVoters'].includes(change.field));
}
function isEmptyListBookkeeping(change, before, after) {
  return change.row !== undefined && change.field !== '$record' && before[change.table].records[change.row].isEmpty && after[change.table].records[change.row].isEmpty;
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const [control, sham, test] = await Promise.all([load(options.control, schema), load(options.sham, schema), load(options.test, schema)]);
  validateEos(control, 'control'); validateEos(sham, 'sham'); validateEos(test, 'test');
  const controlSnapshot = snapshot(control); const shamSnapshot = snapshot(sham); const testSnapshot = snapshot(test);
  const shamVsControl = differences(controlSnapshot, shamSnapshot);
  const testVsSham = differences(shamSnapshot, testSnapshot);
  const summary = targetSummary(test);
  validateTest(summary);
  const allowed = new Set(['teams:9', 'coaches:128', 'coaches:495', 'coachTransactions:22', 'coachTransactions:62', 'transactionArrays:0', 'transactionArrays:undefined']);
  const unexplainedSham = shamVsControl.filter((change) => !isAmbient(change));
  const collateral = testVsSham.filter((change) => !allowed.has(`${change.table}:${change.row}`));
  const unexplainedCollateral = collateral.filter((change) => !isAmbient(change) && !isEmptyListBookkeeping(change, shamSnapshot, testSnapshot));
  const status = unexplainedSham.length === 0 && unexplainedCollateral.length === 0 ? 'passed' : 'needs-review';
  const result = {
    evaluatedAt: new Date().toISOString(), status,
    files: Object.fromEntries(['control', 'sham', 'test'].map((key) => [key, { path: options[key], sha256: sha256(options[key]) }])),
    target: summary,
    comparisons: { shamVsControl, unexplainedSham, testVsSham, collateral, unexplainedCollateral },
    interpretation: status === 'passed' ? 'The native Auburn DC firing/hire was canceled; D. Durkin remained employed, M. Payne remained a free agent, and both stale Staff Moves transactions stayed removed.' : 'Core retention committed, but unrelated differences require review.'
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json);
  process.stdout.write(json);
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
