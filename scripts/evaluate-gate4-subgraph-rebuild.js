/* Evaluate Gate 4 EOS bounded subgraph rebuild. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, sha256
} = require('./prepare-bw3-selected-coach-swap');
const { coachSummary, isAmbient, isEmptyBookkeeping, transactionSlots } = require('./evaluate-gate3-opening-topology-activation');
const { TARGET } = require('./prepare-gate4-subgraph-rebuild');

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
    transactionId: getValue(record, ['TransactionId']), status: getValue(record, ['ContractStatus']), week: getValue(record, ['SeasonWeek'])
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
    auburn: teamSummary(state, TARGET.teams.auburn), coastal: teamSummary(state, TARGET.teams.coastal), florida: teamSummary(state, TARGET.teams.florida),
    durkin: coachSummary(coaches, TARGET.coaches.durkin), white: coachSummary(coaches, TARGET.coaches.white),
    scott: coachSummary(coaches, TARGET.coaches.scott), toure: coachSummary(coaches, TARGET.coaches.toure), payne: coachSummary(coaches, TARGET.coaches.payne),
    transactions: Object.fromEntries(Object.entries(TARGET.transactions).map(([name, row]) => [name, transactionSummary(state, row)]))
  };
}

function outcomeChecks(result, state) {
  const { teams, coaches } = state.tables;
  const team = (row) => teams.getBinaryReferenceToRecord(row);
  const coach = (row) => coaches.getBinaryReferenceToRecord(row);
  const tx = result.transactions;
  return {
    topologyConsumed: result.activeOpenings === 0 && result.activeOfferArrays === 0,
    auburnRetainedDurkin: result.auburn.dc === coach(TARGET.coaches.durkin) && result.durkin.teamIndex === 8 && String(result.durkin.contractStatus).includes('Active'),
    coastalHiredWhite: result.coastal.dc === coach(TARGET.coaches.white) && result.white.teamIndex === 127 && result.white.prevTeamIndex === 26 && String(result.white.contractStatus).includes('Active'),
    floridaHiredPayne: result.florida.dc === coach(TARGET.coaches.payne) && result.payne.teamIndex === 26 && result.payne.prevTeamIndex === 255 && String(result.payne.contractStatus).includes('Active'),
    scottFired: result.scott.teamIndex === 255 && result.scott.prevTeamIndex === 127 && result.scott.contractStatus === 'FreeAgent',
    toureReleased: result.toure.teamIndex === 255 && result.toure.contractStatus === 'FreeAgent',
    canceledDurkinHistoryCleaned: tx.canceledDurkin.isEmpty && !tx.canceledDurkin.indexed,
    scottHistoryCoherent: !tx.firedScott.isEmpty && tx.firedScott.indexed && tx.firedScott.coach === coach(TARGET.coaches.scott) && tx.firedScott.oldTeam === team(TARGET.teams.coastal) && tx.firedScott.newTeam === EMPTY_REF,
    payneHistoryCoherent: !tx.hiredPayne.isEmpty && tx.hiredPayne.indexed && tx.hiredPayne.coach === coach(TARGET.coaches.payne) && tx.hiredPayne.oldTeam === EMPTY_REF && tx.hiredPayne.newTeam === team(TARGET.teams.florida),
    whiteHistoryCoherent: !tx.hiredWhite.isEmpty && tx.hiredWhite.indexed && tx.hiredWhite.coach === coach(TARGET.coaches.white) && tx.hiredWhite.oldTeam === team(TARGET.teams.florida) && tx.hiredWhite.newTeam === team(TARGET.teams.coastal),
    finalLedgerShape: result.activeTransactions === 124 && result.transactionArraySize === 123
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const [sham, test] = await Promise.all([loadExperimentState(options.sham, schema), loadExperimentState(options.test, schema)]);
  const shamSummary = summary(sham); const testSummary = summary(test);
  const checks = outcomeChecks(testSummary, test);
  const before = focusedSnapshot(sham.tables); const after = focusedSnapshot(test.tables);
  const changes = collectDifferences(before, after);
  const expected = new Set([
    'teams:9', 'teams:22', 'teams:36', 'coaches:128', 'coaches:415', 'coaches:440', 'coaches:470', 'coaches:495',
    'coachTransactions:22', 'coachTransactions:44', 'coachTransactions:62', 'coachTransactions:93',
    'transactionArrays:0', 'transactionArrays:undefined', 'openings:22', 'openings:36', 'offerArrays:22', 'offerArrays:36'
  ]);
  const derivedStatReferenceChanges = changes.filter((change) => change.table === 'coaches' && ['CareerStats', 'SeasonStats'].includes(change.field) && !expected.has(`${change.table}:${change.row}`));
  const unexpectedChanges = changes.filter((change) => {
    if (expected.has(`${change.table}:${change.row}`)) return false;
    if (change.table === 'transactionArrays' && change.field === '$arraySizes') return false;
    if (change.table === 'coaches' && ['CareerStats', 'SeasonStats'].includes(change.field)) return false;
    return !isAmbient(change) && !isEmptyBookkeeping(change, before, after);
  });
  const corePassed = Object.values(checks).every(Boolean);
  const result = {
    evaluatedAt: new Date().toISOString(), status: corePassed ? 'passed' : 'failed',
    files: { sham: { path: options.sham, sha256: sha256(options.sham) }, test: { path: options.test, sha256: sha256(options.test) } },
    sham: shamSummary, test: testSummary, outcomeChecks: checks,
    comparison: { totalChanges: changes.length, derivedStatReferenceChanges, unexpectedChanges },
    conclusions: {
      completeSubgraphCommitted: checks.auburnRetainedDurkin && checks.coastalHiredWhite && checks.floridaHiredPayne && checks.scottFired && checks.toureReleased,
      rebuiltStaffMovesCommitted: checks.canceledDurkinHistoryCleaned && checks.scottHistoryCoherent && checks.payneHistoryCoherent && checks.whiteHistoryCoherent,
      fixedPoolIntegrationPassed: corePassed,
      noUnexplainedCollateral: unexpectedChanges.length === 0,
      noUnexplainedEmploymentFallback: !unexpectedChanges.some((change) => change.table === 'teams' && ['HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator'].includes(change.field))
    }
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json);
  process.stdout.write(json);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
