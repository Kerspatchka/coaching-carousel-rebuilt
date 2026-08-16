/* Evaluate Gate 3B EOS opening-topology activation. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, sha256
} = require('./prepare-bw3-selected-coach-swap');

const TARGET = { auburnTeam: 9, floridaTeam: 36, durkin: 128, white: 415, payne: 495, transaction: 62, newOpening: 192, newOfferArray: 192 };

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    assert(['--sham', '--test', '--output'].includes(argv[index]), `Unknown argument: ${argv[index]}`);
    options[argv[index].slice(2)] = path.resolve(argv[index + 1]);
  }
  for (const key of ['sham', 'test']) assert(options[key] && fs.existsSync(options[key]), `Missing ${key} EOS save.`);
  return options;
}
function coachSummary(coaches, row) {
  const record = coaches.records[row];
  return {
    row, name: displayName(record), reference: coaches.getBinaryReferenceToRecord(row),
    teamIndex: getValue(record, ['TeamIndex']), prevTeamIndex: getValue(record, ['PrevTeamIndex']),
    position: getValue(record, ['Position']), prevPosition: getValue(record, ['PrevPosition']),
    contractStatus: getValue(record, ['ContractStatus']), contractLength: getValue(record, ['ContractLength']),
    contractYearsRemaining: getValue(record, ['ContractYearsRemaining'])
  };
}
function transactionSlots(record) {
  return (record.fieldsArray || []).map((field) => field.key).filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}
function summary(state) {
  const { openings, offerArrays, coachTransactions, transactionArrays, teams, coaches } = state.tables;
  const size = transactionArrays.arraySizes[0];
  const indexed = transactionSlots(transactionArrays.records[0]).slice(0, size).map((field) => transactionArrays.records[0][field]);
  const durkin = coachSummary(coaches, TARGET.durkin);
  const white = coachSummary(coaches, TARGET.white);
  const payne = coachSummary(coaches, TARGET.payne);
  const floridaDcReference = getValue(teams.records[TARGET.floridaTeam], ['DefensiveCoordinator']);
  const floridaDcRow = coaches.records.findIndex((record, row) => record && coaches.getBinaryReferenceToRecord(row) === floridaDcReference);
  const floridaAssignedCoach = floridaDcRow >= 0 ? coachSummary(coaches, floridaDcRow) : null;
  const transaction = coachTransactions.records[TARGET.transaction];
  const floridaReference = teams.getBinaryReferenceToRecord(TARGET.floridaTeam);
  const payneFloridaRows = coachTransactions.records.filter((record) => record && !record.isEmpty &&
    getValue(record, ['Coach']) === payne.reference && getValue(record, ['NewTeam']) === floridaReference).map((record) => record.index);
  return {
    activeOpenings: openings.records.filter((record) => record && !record.isEmpty).length,
    activeOfferArrays: offerArrays.records.filter((record) => record && !record.isEmpty).length,
    activeTransactions: coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    transactionArraySize: size,
    newOpeningIsEmpty: Boolean(openings.records[TARGET.newOpening].isEmpty),
    newOfferArrayIsEmpty: Boolean(offerArrays.records[TARGET.newOfferArray].isEmpty),
    auburn: { name: displayName(teams.records[TARGET.auburnTeam]), dc: getValue(teams.records[TARGET.auburnTeam], ['DefensiveCoordinator']) },
    florida: { name: displayName(teams.records[TARGET.floridaTeam]), dc: floridaDcReference, assignedCoach: floridaAssignedCoach },
    durkin, white, payne,
    transaction62: {
      isEmpty: Boolean(transaction.isEmpty), indexed: indexed.includes(coachTransactions.getBinaryReferenceToRecord(TARGET.transaction)),
      coach: getValue(transaction, ['Coach']), oldTeam: getValue(transaction, ['OldTeam']), newTeam: getValue(transaction, ['NewTeam']),
      oldCoachPosition: getValue(transaction, ['OldCoachPosition']), newCoachPosition: getValue(transaction, ['NewCoachPosition']),
      contractStatus: getValue(transaction, ['ContractStatus']), contractLength: getValue(transaction, ['ContractLength'])
    },
    payneFloridaTransactionRows: payneFloridaRows
  };
}
function checks(result, teams) {
  return {
    newOpeningConsumed: result.activeOpenings === 0 && result.newOpeningIsEmpty,
    newOfferArrayCleaned: result.newOfferArrayIsEmpty,
    auburnHiredWhite: result.auburn.dc === result.white.reference,
    floridaHiredPayne: result.florida.dc === result.payne.reference,
    whiteEmploymentCoherent: result.white.teamIndex === 8 && result.white.prevTeamIndex === 26 && String(result.white.contractStatus).includes('Active'),
    payneEmploymentCoherent: result.payne.teamIndex === 26 && result.payne.prevTeamIndex === 255 && String(result.payne.contractStatus).includes('Active'),
    durkinDepartureCoherent: result.durkin.teamIndex === 255 && result.durkin.prevTeamIndex === 8 && result.durkin.contractStatus === 'FreeAgent',
    whiteTransactionCoherent: !result.transaction62.isEmpty && result.transaction62.indexed && result.transaction62.coach === result.white.reference &&
      result.transaction62.oldTeam === teams.getBinaryReferenceToRecord(TARGET.floridaTeam) && result.transaction62.newTeam === teams.getBinaryReferenceToRecord(TARGET.auburnTeam),
    intentionalPayneHistoryGap: result.payneFloridaTransactionRows.length === 0
  };
}
function isAmbient(change) {
  return (change.table === 'coaches' && ['CoachPoints', 'CurrentJobSecurityPercentageRank'].includes(change.field)) ||
    (change.table === 'teams' && ['CoachesPoll_NumVoters', 'MediaPoll_NumVoters'].includes(change.field));
}
function isEmptyBookkeeping(change, before, after) {
  return change.row !== undefined && change.field !== '$record' && before[change.table].records[change.row] && after[change.table].records[change.row] &&
    before[change.table].records[change.row].isEmpty && after[change.table].records[change.row].isEmpty;
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const [sham, test] = await Promise.all([loadExperimentState(options.sham, schema), loadExperimentState(options.test, schema)]);
  const shamSummary = summary(sham); const testSummary = summary(test);
  const outcomeChecks = checks(testSummary, test.tables.teams);
  const before = focusedSnapshot(sham.tables); const after = focusedSnapshot(test.tables);
  const changes = collectDifferences(before, after);
  const allowed = new Set(['teams:9', 'teams:36', 'coaches:415', 'coaches:495', 'coachTransactions:62', 'openings:192', 'offerArrays:192']);
  const unexpected = changes.filter((change) => !allowed.has(`${change.table}:${change.row}`) && !isAmbient(change) && !isEmptyBookkeeping(change, before, after));
  const result = {
    evaluatedAt: new Date().toISOString(), status: unexpected.length === 0 && Object.values(outcomeChecks).every(Boolean) ? 'passed' : 'failed',
    files: { sham: { path: options.sham, sha256: sha256(options.sham) }, test: { path: options.test, sha256: sha256(options.test) } },
    sham: shamSummary, test: testSummary,
    outcomeChecks,
    comparison: { totalChanges: changes.length, unexpectedChanges: unexpected },
    conclusions: {
      newOpeningActivatedAndConsumed: outcomeChecks.newOpeningConsumed,
      pairedOfferArrayActivatedAndCleaned: outcomeChecks.newOfferArrayCleaned,
      twoStepAssignmentsCommitted: outcomeChecks.auburnHiredWhite && outcomeChecks.floridaHiredPayne,
      intentionalPayneHistoryGapConfirmed: outcomeChecks.intentionalPayneHistoryGap,
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

module.exports = { TARGET, coachSummary, isAmbient, isEmptyBookkeeping, summary, transactionSlots };
