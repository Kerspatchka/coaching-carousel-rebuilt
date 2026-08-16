/* Evaluate Gate 2 EOS: introduce previously unselected free agent B. Bausby. */
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
const TARGET = { teamRow: 9, durkinRow: 128, bausbyRow: 451, payneRow: 495, transactionRows: [22, 62] };

function assert(condition, message) { if (!condition) throw new Error(message); }
function sha256(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase(); }
function fields(record) { return record && Array.isArray(record.fieldsArray) ? record.fieldsArray.map((field) => field.key) : []; }
function value(record, aliases, fallback = null) {
  const names = fields(record);
  const lower = new Map(names.map((name) => [name.toLowerCase(), name]));
  const key = aliases.find((name) => names.includes(name)) || aliases.map((name) => lower.get(name.toLowerCase())).find(Boolean);
  return key && record[key] !== undefined && record[key] !== null ? record[key] : fallback;
}
function displayName(record) {
  return String(value(record, ['DisplayName', 'LongName', 'Name'], '')).trim() ||
    [value(record, ['FirstName'], ''), value(record, ['LastName'], '')].join(' ').trim();
}
function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    assert(['--sham', '--test', '--output'].includes(key), `Unknown argument: ${key}`);
    options[key.slice(2)] = path.resolve(argv[index + 1]);
  }
  for (const key of ['sham', 'test']) assert(options[key] && fs.existsSync(options[key]), `Missing ${key} EOS save.`);
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
  return { tables };
}
function snapshot(state) {
  return Object.fromEntries(Object.entries(state.tables).map(([name, table]) => [name, {
    arraySizes: Array.isArray(table.arraySizes) ? [...table.arraySizes] : null,
    records: table.records.map((record) => record ? {
      isEmpty: Boolean(record.isEmpty), values: Object.fromEntries(fields(record).map((field) => [field, record[field]]))
    } : null)
  }]));
}
function differences(before, after) {
  const output = [];
  for (const table of Object.keys(TABLES)) {
    if (JSON.stringify(before[table].arraySizes) !== JSON.stringify(after[table].arraySizes)) output.push({ table, field: '$arraySizes', before: before[table].arraySizes, after: after[table].arraySizes });
    for (let row = 0; row < Math.max(before[table].records.length, after[table].records.length); row += 1) {
      const a = before[table].records[row]; const b = after[table].records[row];
      if (!a || !b || a.isEmpty !== b.isEmpty) { output.push({ table, row, field: '$record', before: a && a.isEmpty, after: b && b.isEmpty }); continue; }
      for (const field of new Set([...Object.keys(a.values), ...Object.keys(b.values)])) {
        if (JSON.stringify(a.values[field]) !== JSON.stringify(b.values[field])) output.push({ table, row, field, before: a.values[field], after: b.values[field] });
      }
    }
  }
  return output;
}
function isAmbient(change) {
  return (change.table === 'coaches' && ['CoachPoints', 'CurrentJobSecurityPercentageRank'].includes(change.field)) ||
    (change.table === 'teams' && ['CoachesPoll_NumVoters', 'MediaPoll_NumVoters'].includes(change.field));
}
function transactionSlots(record) {
  return fields(record).filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}
function coachSummary(table, row) {
  const coach = table.records[row];
  return {
    row, name: displayName(coach), reference: table.getBinaryReferenceToRecord(row),
    teamIndex: value(coach, ['TeamIndex']), prevTeamIndex: value(coach, ['PrevTeamIndex']),
    position: value(coach, ['Position']), prevPosition: value(coach, ['PrevPosition']),
    contractStatus: value(coach, ['ContractStatus']), contractLength: value(coach, ['ContractLength']),
    contractYearsRemaining: value(coach, ['ContractYearsRemaining'])
  };
}
function summary(state) {
  const { coachTransactions, transactionArrays, openings, coaches, teams } = state.tables;
  const size = transactionArrays.arraySizes[0];
  const indexed = transactionSlots(transactionArrays.records[0]).slice(0, size).map((field) => transactionArrays.records[0][field]);
  const result = {
    activeOpenings: openings.records.filter((record) => record && !record.isEmpty).length,
    activeTransactions: coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    transactionArraySize: size,
    auburnDcReference: value(teams.records[TARGET.teamRow], ['DefensiveCoordinator']),
    durkin: coachSummary(coaches, TARGET.durkinRow),
    bausby: coachSummary(coaches, TARGET.bausbyRow),
    payne: coachSummary(coaches, TARGET.payneRow),
    transactions: {}
  };
  for (const row of TARGET.transactionRows) {
    const record = coachTransactions.records[row];
    result.transactions[row] = {
      isEmpty: Boolean(record.isEmpty), indexed: indexed.includes(coachTransactions.getBinaryReferenceToRecord(row)),
      coach: value(record, ['Coach']), oldTeam: value(record, ['OldTeam']), newTeam: value(record, ['NewTeam']),
      newCoachPosition: value(record, ['NewCoachPosition']), contractStatus: value(record, ['ContractStatus'])
    };
  }
  return result;
}
function validate(result) {
  assert(result.activeOpenings === 0, 'Treatment is not at EOS.');
  assert(result.auburnDcReference === result.bausby.reference, 'Auburn did not hire B. Bausby.');
  assert(result.bausby.teamIndex === 8 && result.bausby.prevTeamIndex === 255 && result.bausby.position === 'DefensiveCoordinator', 'B. Bausby employment is incoherent.');
  assert(String(result.bausby.contractStatus).includes('Active'), 'B. Bausby is not active.');
  assert(result.payne.teamIndex === 255 && result.payne.contractStatus === 'FreeAgent', 'M. Payne did not remain a free agent.');
  assert(result.durkin.teamIndex === 255 && result.durkin.prevTeamIndex === 8 && result.durkin.contractStatus === 'FreeAgent', 'D. Durkin firing is incoherent.');
  assert(result.transactions[22].coach === result.durkin.reference && result.transactions[22].indexed, 'D. Durkin departure transaction is incorrect.');
  assert(result.transactions[62].coach === result.bausby.reference && result.transactions[62].oldTeam === EMPTY_REF && result.transactions[62].indexed, 'B. Bausby hire transaction is incorrect.');
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const [sham, test] = await Promise.all([load(options.sham, schema), load(options.test, schema)]);
  const shamSummary = summary(sham); const testSummary = summary(test);
  assert(shamSummary.activeOpenings === 0, 'Sham baseline is not at EOS.');
  validate(testSummary);
  const changes = differences(snapshot(sham), snapshot(test));
  const allowedRows = new Set(['teams:9', 'coaches:451', 'coaches:495', 'coachTransactions:62']);
  const unexpected = changes.filter((change) => !allowedRows.has(`${change.table}:${change.row}`) && !isAmbient(change));
  const result = {
    evaluatedAt: new Date().toISOString(), status: unexpected.length === 0 ? 'passed' : 'needs-review',
    files: { sham: { path: options.sham, sha256: sha256(options.sham) }, test: { path: options.test, sha256: sha256(options.test) } },
    sham: shamSummary, test: testSummary,
    comparison: { totalChanges: changes.length, unexpectedChanges: unexpected },
    conclusions: {
      nonNativeFreeAgentHireCommitted: true,
      payneStayedFreeAgent: true,
      durkinDeparturePreserved: true,
      bausbyTransactionReplacedPayne: true,
      noUnexpectedCollateral: unexpected.length === 0
    }
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json);
  process.stdout.write(json);
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}

module.exports = { assert, differences, displayName, fields, isAmbient, load, sha256, snapshot, transactionSlots, value };
