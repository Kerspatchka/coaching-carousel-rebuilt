/* Evaluate revised Gate 1 EOS sham, core-retain, and hide-history arms. */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { FranchiseFile } = require('madden-franchise');

const TABLES = {
  coachTransactions: 2701814500,
  transactionArrays: 1261824345,
  openings: 263453863,
  coaches: 1860529246,
  teams: 3359508968
};
const TARGET = { teamRow: 9, durkinRow: 128, payneRow: 495, transactionRows: [22, 62] };

function assert(condition, message) { if (!condition) throw new Error(message); }
function sha256(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase(); }
function fieldNames(record) { return record && Array.isArray(record.fieldsArray) ? record.fieldsArray.map((field) => field.key) : []; }
function value(record, aliases, fallback = null) {
  const names = fieldNames(record);
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
    assert(['--sham', '--core', '--hidden', '--output'].includes(key), `Unknown argument: ${key}`);
    assert(argv[index + 1], `Missing value for ${key}`);
    options[key.slice(2)] = path.resolve(argv[index + 1]);
  }
  for (const key of ['sham', 'core', 'hidden']) assert(options[key] && fs.existsSync(options[key]), `Missing ${key} EOS save.`);
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
    records: table.records.map((record) => record ? {
      isEmpty: Boolean(record.isEmpty),
      values: Object.fromEntries(fieldNames(record).map((field) => [field, record[field]]))
    } : null)
  }]));
}
function differences(before, after) {
  const output = [];
  for (const table of Object.keys(TABLES)) {
    if (JSON.stringify(before[table].arraySizes) !== JSON.stringify(after[table].arraySizes)) {
      output.push({ table, field: '$arraySizes', before: before[table].arraySizes, after: after[table].arraySizes });
    }
    const length = Math.max(before[table].records.length, after[table].records.length);
    for (let row = 0; row < length; row += 1) {
      const a = before[table].records[row];
      const b = after[table].records[row];
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
function isAmbient(change) {
  return (change.table === 'coaches' && ['CoachPoints', 'CurrentJobSecurityPercentageRank'].includes(change.field)) ||
    (change.table === 'teams' && ['CoachesPoll_NumVoters', 'MediaPoll_NumVoters'].includes(change.field));
}
function isEmptyBookkeeping(change, before, after) {
  return change.row !== undefined && change.field !== '$record' && before[change.table].records[change.row] &&
    after[change.table].records[change.row] && before[change.table].records[change.row].isEmpty && after[change.table].records[change.row].isEmpty;
}
function comparison(beforeState, afterState, allowedRows) {
  const before = snapshot(beforeState);
  const after = snapshot(afterState);
  const changes = differences(before, after);
  const unexpected = changes.filter((change) => !allowedRows.has(`${change.table}:${change.row}`) &&
    !(change.table === 'transactionArrays' && change.field === '$arraySizes' && allowedRows.has('transactionArrays:undefined')) &&
    !isAmbient(change) && !isEmptyBookkeeping(change, before, after));
  return { totalChanges: changes.length, unexpectedChanges: unexpected };
}
function transactionSlots(record) {
  return fieldNames(record).filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}
function coachSummary(table, row) {
  const coach = table.records[row];
  return {
    row,
    name: displayName(coach),
    reference: table.getBinaryReferenceToRecord(row),
    teamIndex: value(coach, ['TeamIndex']),
    prevTeamIndex: value(coach, ['PrevTeamIndex']),
    position: value(coach, ['Position']),
    prevPosition: value(coach, ['PrevPosition']),
    contractStatus: value(coach, ['ContractStatus']),
    contractLength: value(coach, ['ContractLength']),
    contractYearsRemaining: value(coach, ['ContractYearsRemaining'])
  };
}
function armSummary(state) {
  const { coachTransactions, transactionArrays, openings, coaches, teams } = state.tables;
  const arrayRecord = transactionArrays.records[0];
  const arraySize = transactionArrays.arraySizes[0];
  const indexed = transactionSlots(arrayRecord).slice(0, arraySize).map((field) => arrayRecord[field]);
  const durkin = coachSummary(coaches, TARGET.durkinRow);
  const payne = coachSummary(coaches, TARGET.payneRow);
  return {
    activeOpenings: openings.records.filter((record) => record && !record.isEmpty).length,
    activeTransactions: coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    transactionArraySize: arraySize,
    auburn: {
      name: displayName(teams.records[TARGET.teamRow]),
      defensiveCoordinatorReference: value(teams.records[TARGET.teamRow], ['DefensiveCoordinator']),
      retainedDurkin: value(teams.records[TARGET.teamRow], ['DefensiveCoordinator']) === durkin.reference
    },
    durkin,
    payne,
    transactions: Object.fromEntries(TARGET.transactionRows.map((row) => {
      const record = coachTransactions.records[row];
      return [row, {
        isEmpty: Boolean(record.isEmpty),
        indexed: indexed.includes(coachTransactions.getBinaryReferenceToRecord(row)),
        coach: value(record, ['Coach']),
        oldTeam: value(record, ['OldTeam']),
        newTeam: value(record, ['NewTeam']),
        oldPosition: value(record, ['OldPosition']),
        newPosition: value(record, ['NewPosition']),
        contractStatus: value(record, ['ContractStatus']),
        reason: value(record, ['Reason'])
      }];
    }))
  };
}
function verdict(summary) {
  return {
    eosCheckpoint: summary.activeOpenings === 0,
    auburnRetainedDurkin: summary.auburn.retainedDurkin && summary.durkin.teamIndex === 8 && summary.durkin.position === 'DefensiveCoordinator',
    durkinActive: String(summary.durkin.contractStatus).includes('Active'),
    payneFreeAgent: summary.payne.teamIndex === 255 && summary.payne.contractStatus === 'FreeAgent',
    targetTransactionsIndexed: Object.fromEntries(TARGET.transactionRows.map((row) => [row, summary.transactions[row].indexed]))
  };
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const states = Object.fromEntries(await Promise.all(['sham', 'core', 'hidden'].map(async (key) => [key, await load(options[key], schema)])));
  const arms = Object.fromEntries(Object.entries(states).map(([key, state]) => {
    const summary = armSummary(state);
    return [key, { file: options[key], sha256: sha256(options[key]), summary, verdict: verdict(summary) }];
  }));
  const coreVsSham = comparison(states.sham, states.core, new Set(['teams:9', 'coaches:128', 'coaches:495']));
  const hiddenVsCore = comparison(states.core, states.hidden, new Set([
    'coachTransactions:22', 'coachTransactions:62', 'transactionArrays:0', 'transactionArrays:undefined'
  ]));
  const result = {
    evaluatedAt: new Date().toISOString(),
    status: Object.values(arms).every((arm) => arm.verdict.eosCheckpoint) ? 'evaluated' : 'invalid-checkpoint',
    arms,
    comparisons: { coreVsSham, hiddenVsCore },
    conclusions: {
      coreRetentionCommitted: arms.core.verdict.auburnRetainedDurkin && arms.core.verdict.durkinActive && arms.core.verdict.payneFreeAgent,
      hiddenRetentionCommitted: arms.hidden.verdict.auburnRetainedDurkin && arms.hidden.verdict.durkinActive && arms.hidden.verdict.payneFreeAgent,
      hiddenRowsRemainUnindexed: TARGET.transactionRows.every((row) => !arms.hidden.summary.transactions[row].indexed),
      noUnexpectedCoreCollateral: coreVsSham.unexpectedChanges.length === 0,
      noUnexpectedHiddenCollateral: hiddenVsCore.unexpectedChanges.length === 0
    }
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json);
  process.stdout.write(json);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
