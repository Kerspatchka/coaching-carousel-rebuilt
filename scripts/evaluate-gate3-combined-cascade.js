/* Evaluate Gate 3C EOS complete Auburn/Florida cascade. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, collectDifferences, focusedSnapshot, getValue, loadExperimentState, sha256
} = require('./prepare-bw3-selected-coach-swap');
const {
  TARGET, isAmbient, isEmptyBookkeeping, summary, transactionSlots
} = require('./evaluate-gate3-opening-topology-activation');

const NEW_TRANSACTION = 125;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    assert(['--sham', '--test', '--output'].includes(argv[index]), `Unknown argument: ${argv[index]}`);
    options[argv[index].slice(2)] = path.resolve(argv[index + 1]);
  }
  for (const key of ['sham', 'test']) assert(options[key] && fs.existsSync(options[key]), `Missing ${key} EOS save.`);
  return options;
}
function newTransactionSummary(state) {
  const { coachTransactions, transactionArrays } = state.tables;
  const record = coachTransactions.records[NEW_TRANSACTION];
  const size = transactionArrays.arraySizes[0];
  const indexed = transactionSlots(transactionArrays.records[0]).slice(0, size).map((field) => transactionArrays.records[0][field]);
  return {
    row: NEW_TRANSACTION, isEmpty: Boolean(record.isEmpty), indexed: indexed.includes(coachTransactions.getBinaryReferenceToRecord(NEW_TRANSACTION)),
    coach: getValue(record, ['Coach']), oldTeam: getValue(record, ['OldTeam']), newTeam: getValue(record, ['NewTeam']),
    oldCoachPosition: getValue(record, ['OldCoachPosition']), newCoachPosition: getValue(record, ['NewCoachPosition']),
    transactionId: getValue(record, ['TransactionId']), contractStatus: getValue(record, ['ContractStatus']), seasonWeek: getValue(record, ['SeasonWeek'])
  };
}
function checks(result, transaction, teams) {
  return {
    topologyConsumed: result.activeOpenings === 0 && result.newOpeningIsEmpty && result.newOfferArrayIsEmpty,
    auburnHiredWhite: result.auburn.dc === result.white.reference,
    floridaHiredPayne: result.florida.dc === result.payne.reference,
    whiteEmploymentCoherent: result.white.teamIndex === 8 && result.white.prevTeamIndex === 26 && String(result.white.contractStatus).includes('Active'),
    payneEmploymentCoherent: result.payne.teamIndex === 26 && result.payne.prevTeamIndex === 255 && String(result.payne.contractStatus).includes('Active'),
    durkinDepartureCoherent: result.durkin.teamIndex === 255 && result.durkin.prevTeamIndex === 8 && result.durkin.contractStatus === 'FreeAgent',
    whiteTransactionCoherent: !result.transaction62.isEmpty && result.transaction62.indexed && result.transaction62.coach === result.white.reference &&
      result.transaction62.oldTeam === teams.getBinaryReferenceToRecord(TARGET.floridaTeam) && result.transaction62.newTeam === teams.getBinaryReferenceToRecord(TARGET.auburnTeam),
    payneTransactionCoherent: !transaction.isEmpty && transaction.indexed && transaction.coach === result.payne.reference && transaction.oldTeam === EMPTY_REF &&
      transaction.newTeam === teams.getBinaryReferenceToRecord(TARGET.floridaTeam) && transaction.newCoachPosition === 'DefensiveCoordinator' && transaction.transactionId === 124,
    finalCountsCoherent: result.activeTransactions === 126 && result.transactionArraySize === 125
  };
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const [sham, test] = await Promise.all([loadExperimentState(options.sham, schema), loadExperimentState(options.test, schema)]);
  const shamSummary = summary(sham); const testSummary = summary(test); const transaction125 = newTransactionSummary(test);
  const outcomeChecks = checks(testSummary, transaction125, test.tables.teams);
  const before = focusedSnapshot(sham.tables); const after = focusedSnapshot(test.tables);
  const changes = collectDifferences(before, after);
  const allowed = new Set([
    'teams:9', 'teams:36', 'coaches:415', 'coaches:495', 'coachTransactions:62', 'coachTransactions:125',
    'transactionArrays:0', 'transactionArrays:undefined', 'openings:192', 'offerArrays:192'
  ]);
  const unexpected = changes.filter((change) => {
    if (allowed.has(`${change.table}:${change.row}`)) return false;
    if (change.table === 'transactionArrays' && change.field === '$arraySizes') return false;
    return !isAmbient(change) && !isEmptyBookkeeping(change, before, after);
  });
  const passed = Object.values(outcomeChecks).every(Boolean) && unexpected.length === 0;
  const result = {
    evaluatedAt: new Date().toISOString(), status: passed ? 'passed' : 'failed',
    files: { sham: { path: options.sham, sha256: sha256(options.sham) }, test: { path: options.test, sha256: sha256(options.test) } },
    sham: shamSummary, test: testSummary, transaction125, outcomeChecks,
    comparison: { totalChanges: changes.length, unexpectedChanges: unexpected },
    conclusions: {
      completeCascadeCommitted: outcomeChecks.auburnHiredWhite && outcomeChecks.floridaHiredPayne,
      allGeneratedHistoryCommitted: outcomeChecks.whiteTransactionCoherent && outcomeChecks.payneTransactionCoherent,
      newTopologyAndRowsSurvived: outcomeChecks.topologyConsumed && outcomeChecks.finalCountsCoherent,
      noUnexpectedCollateral: unexpected.length === 0
    }
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json);
  process.stdout.write(json);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
