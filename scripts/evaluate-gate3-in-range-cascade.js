/* Evaluate Gate 3D EOS in-range opening reuse. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, sha256
} = require('./prepare-bw3-selected-coach-swap');
const { coachSummary, isAmbient, isEmptyBookkeeping, transactionSlots } = require('./evaluate-gate3-opening-topology-activation');

const TARGET = {
  auburnTeam: 9, floridaTeam: 36, rutgersTeam: 98,
  opening: 67, offerArray: 67, whiteTransaction: 62, payneTransaction: 120,
  durkin: 128, displacedCoach: 210, white: 415, payne: 495
};

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
    coach: getValue(record, ['Coach']), oldTeam: getValue(record, ['OldTeam']), newTeam: getValue(record, ['NewTeam']),
    oldPosition: getValue(record, ['OldCoachPosition']), newPosition: getValue(record, ['NewCoachPosition']),
    transactionId: getValue(record, ['TransactionId']), contractStatus: getValue(record, ['ContractStatus']), seasonWeek: getValue(record, ['SeasonWeek'])
  };
}

function teamSummary(state, row) {
  const { teams } = state.tables;
  return { row, name: displayName(teams.records[row]), dc: getValue(teams.records[row], ['DefensiveCoordinator']) };
}

function summary(state) {
  const { openings, offerArrays, coachTransactions, transactionArrays, coaches } = state.tables;
  return {
    activeOpenings: openings.records.filter((record) => record && !record.isEmpty).length,
    activeOfferArrays: offerArrays.records.filter((record) => record && !record.isEmpty).length,
    activeTransactions: coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    transactionArraySize: transactionArrays.arraySizes[0],
    opening67IsEmpty: Boolean(openings.records[TARGET.opening].isEmpty),
    offerArray67IsEmpty: Boolean(offerArrays.records[TARGET.offerArray].isEmpty),
    auburn: teamSummary(state, TARGET.auburnTeam), florida: teamSummary(state, TARGET.floridaTeam), rutgers: teamSummary(state, TARGET.rutgersTeam),
    durkin: coachSummary(coaches, TARGET.durkin), displacedCoach: coachSummary(coaches, TARGET.displacedCoach),
    white: coachSummary(coaches, TARGET.white), payne: coachSummary(coaches, TARGET.payne),
    transaction62: transactionSummary(state, TARGET.whiteTransaction),
    transaction120: transactionSummary(state, TARGET.payneTransaction)
  };
}

function checks(result, teams) {
  const auburn = teams.getBinaryReferenceToRecord(TARGET.auburnTeam);
  const florida = teams.getBinaryReferenceToRecord(TARGET.floridaTeam);
  return {
    topologyConsumed: result.activeOpenings === 0 && result.opening67IsEmpty && result.offerArray67IsEmpty,
    auburnHiredWhite: result.auburn.dc === result.white.reference,
    floridaHiredPayne: result.florida.dc === result.payne.reference,
    whiteEmploymentCoherent: result.white.teamIndex === 8 && result.white.prevTeamIndex === 26 && String(result.white.contractStatus).includes('Active'),
    payneEmploymentCoherent: result.payne.teamIndex === 26 && result.payne.prevTeamIndex === 255 && String(result.payne.contractStatus).includes('Active'),
    durkinDepartureCoherent: result.durkin.teamIndex === 255 && result.durkin.prevTeamIndex === 8 && result.durkin.contractStatus === 'FreeAgent',
    whiteTransactionCoherent: !result.transaction62.isEmpty && result.transaction62.indexed && result.transaction62.coach === result.white.reference &&
      result.transaction62.oldTeam === florida && result.transaction62.newTeam === auburn,
    payneTransactionCoherent: !result.transaction120.isEmpty && result.transaction120.indexed && result.transaction120.coach === result.payne.reference &&
      result.transaction120.oldTeam === EMPTY_REF && result.transaction120.newTeam === florida,
    finalCountsCoherent: result.activeTransactions === 125 && result.transactionArraySize === 124,
    displacedCoachReleased: result.displacedCoach.teamIndex === 255 && result.displacedCoach.contractStatus === 'FreeAgent'
  };
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
  const expected = new Set(['teams:9', 'teams:36', 'teams:98', 'coaches:128', 'coaches:210', 'coaches:415', 'coaches:495', 'coachTransactions:62', 'coachTransactions:120', 'openings:67', 'offerArrays:67']);
  const otherChanges = changes.filter((change) => !expected.has(`${change.table}:${change.row}`) && !isAmbient(change) && !isEmptyBookkeeping(change, before, after));
  const corePassed = ['topologyConsumed', 'auburnHiredWhite', 'floridaHiredPayne', 'whiteEmploymentCoherent', 'payneEmploymentCoherent',
    'durkinDepartureCoherent', 'whiteTransactionCoherent', 'payneTransactionCoherent', 'finalCountsCoherent', 'displacedCoachReleased']
    .every((key) => outcomeChecks[key]);
  const result = {
    evaluatedAt: new Date().toISOString(), status: corePassed ? 'passed' : 'failed',
    files: { sham: { path: options.sham, sha256: sha256(options.sham) }, test: { path: options.test, sha256: sha256(options.test) } },
    sham: shamSummary, test: testSummary, outcomeChecks,
    comparison: { totalChanges: changes.length, otherChanges },
    conclusions: {
      inRangeCascadeCommitted: outcomeChecks.auburnHiredWhite && outcomeChecks.floridaHiredPayne,
      openingCapacityBoundarySupported: corePassed,
      declaredRutgersCollateral: { team: testSummary.rutgers, displacedCoach: testSummary.displacedCoach }
    }
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json);
  process.stdout.write(json);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
