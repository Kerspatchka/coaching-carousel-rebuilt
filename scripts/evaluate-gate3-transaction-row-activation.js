/* Evaluate Gate 3A EOS transaction-row activation. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  assert, differences, isAmbient, load, sha256, snapshot, transactionSlots, value
} = require('./evaluate-gate2-hire-bausby');

const EMPTY_REF = '00000000000000000000000000000000';
const OLD_ROW = 62;
const NEW_ROW = 125;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    assert(['--sham', '--test', '--output'].includes(argv[index]), `Unknown argument: ${argv[index]}`);
    options[argv[index].slice(2)] = path.resolve(argv[index + 1]);
  }
  for (const key of ['sham', 'test']) assert(options[key] && fs.existsSync(options[key]), `Missing ${key} EOS save.`);
  return options;
}
function transactionSummary(state, row) {
  const { coachTransactions, transactionArrays } = state.tables;
  const record = coachTransactions.records[row];
  const size = transactionArrays.arraySizes[0];
  const indexed = transactionSlots(transactionArrays.records[0]).slice(0, size).map((field) => transactionArrays.records[0][field]);
  return {
    row, isEmpty: Boolean(record.isEmpty), indexed: indexed.includes(coachTransactions.getBinaryReferenceToRecord(row)),
    coach: value(record, ['Coach']), oldTeam: value(record, ['OldTeam']), newTeam: value(record, ['NewTeam']),
    oldCoachPosition: value(record, ['OldCoachPosition']), newCoachPosition: value(record, ['NewCoachPosition']),
    transactionId: value(record, ['TransactionId']), contractStatus: value(record, ['ContractStatus']),
    contractLength: value(record, ['ContractLength']), seasonWeek: value(record, ['SeasonWeek'])
  };
}
function stateSummary(state) {
  const { openings, coachTransactions, transactionArrays, teams, coaches } = state.tables;
  const payneReference = coaches.getBinaryReferenceToRecord(495);
  const auburnDc = value(teams.records[9], ['DefensiveCoordinator']);
  return {
    activeOpenings: openings.records.filter((record) => record && !record.isEmpty).length,
    activeTransactions: coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    transactionArraySize: transactionArrays.arraySizes[0],
    auburnDc, payneReference, auburnHasPayne: auburnDc === payneReference,
    oldRow: transactionSummary(state, OLD_ROW), newRow: transactionSummary(state, NEW_ROW)
  };
}
function isEmptyBookkeeping(change, before, after) {
  return change.row !== undefined && change.field !== '$record' && before[change.table].records[change.row] &&
    after[change.table].records[change.row] && before[change.table].records[change.row].isEmpty && after[change.table].records[change.row].isEmpty;
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const [sham, test] = await Promise.all([load(options.sham, schema), load(options.test, schema)]);
  const shamSummary = stateSummary(sham); const testSummary = stateSummary(test);
  assert(testSummary.activeOpenings === 0, 'Test is not at EOS.');
  assert(testSummary.auburnHasPayne, 'Auburn native Payne assignment changed.');
  assert(testSummary.activeTransactions === 125 && testSummary.transactionArraySize === 124, 'Final transaction counts are incorrect.');
  assert(testSummary.oldRow.isEmpty && !testSummary.oldRow.indexed, 'Old row 62 was not cleaned up.');
  assert(!testSummary.newRow.isEmpty && testSummary.newRow.indexed, 'New row 125 did not survive indexed.');
  assert(testSummary.newRow.coach === shamSummary.oldRow.coach && testSummary.newRow.oldTeam === EMPTY_REF &&
    testSummary.newRow.newTeam === shamSummary.oldRow.newTeam && testSummary.newRow.newCoachPosition === 'DefensiveCoordinator', 'Relocated Payne transaction is incoherent.');
  assert(testSummary.newRow.transactionId === 124, 'New transaction ID did not persist.');
  const before = snapshot(sham); const after = snapshot(test); const changes = differences(before, after);
  const allowed = new Set(['coachTransactions:62', 'coachTransactions:125', 'transactionArrays:0']);
  const unexpected = changes.filter((change) => !allowed.has(`${change.table}:${change.row}`) && !isAmbient(change) && !isEmptyBookkeeping(change, before, after));
  const result = {
    evaluatedAt: new Date().toISOString(), status: unexpected.length === 0 ? 'passed' : 'needs-review',
    files: { sham: { path: options.sham, sha256: sha256(options.sham) }, test: { path: options.test, sha256: sha256(options.test) } },
    sham: shamSummary, test: testSummary,
    comparison: { totalChanges: changes.length, unexpectedChanges: unexpected },
    conclusions: {
      newTransactionRowActivatedAndConsumed: true,
      oldUnindexedRowCleanedUp: true,
      nativeOutcomePreserved: true,
      noUnexpectedCollateral: unexpected.length === 0
    }
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json);
  process.stdout.write(json);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
