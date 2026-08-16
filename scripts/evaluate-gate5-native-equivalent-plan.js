/* Evaluate Gate 5 native-equivalent full-plan regeneration at EOS. */
'use strict';

const fs = require('fs');
const path = require('path');
const { EMPTY_REF, assert, displayName, getValue, loadExperimentState, sha256 } = require('./prepare-bw3-selected-coach-swap');

function parseArgs(argv) {
  const options = { reference: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1EOS'), test: null, output: null, experimentId: 'G5' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--reference') options.reference = path.resolve(argv[++index]);
    else if (argv[index] === '--test') options.test = path.resolve(argv[++index]);
    else if (argv[index] === '--output') options.output = path.resolve(argv[++index]);
    else if (argv[index] === '--experiment-id') options.experimentId = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  assert(fs.existsSync(options.reference), `Reference not found: ${options.reference}`);
  assert(options.test && fs.existsSync(options.test), 'Missing --test EOS save.');
  return options;
}

function fields(record) {
  return (record && record.fieldsArray || []).map((field) => field.key);
}

function transactionSlots(record) {
  return fields(record).filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function staffLedger(state) {
  return state.tables.teams.records.filter((record) => record && !record.isEmpty).map((record) => ({
    row: record.index, name: displayName(record),
    hc: getValue(record, ['HeadCoach']), oc: getValue(record, ['OffensiveCoordinator']), dc: getValue(record, ['DefensiveCoordinator'])
  }));
}

function coachEmploymentLedger(state) {
  const selectedFields = ['TeamIndex', 'PrevTeamIndex', 'Position', 'PrevPosition', 'ContractStatus', 'ContractLength', 'ContractYearsRemaining'];
  return state.tables.coaches.records.filter((record) => record && !record.isEmpty).map((record) => ({
    row: record.index, name: displayName(record),
    values: Object.fromEntries(selectedFields.map((field) => [field, getValue(record, [field])]))
  }));
}

function transactionLedger(state) {
  const { coachTransactions, transactionArrays } = state.tables;
  const array = transactionArrays.records[0];
  const size = transactionArrays.arraySizes[0];
  const indexed = new Set(transactionSlots(array).slice(0, size).map((field) => array[field]));
  const ledger = coachTransactions.records.filter((record) => record && !record.isEmpty).map((record) => ({
    indexed: indexed.has(coachTransactions.getBinaryReferenceToRecord(record.index)),
    Coach: record.Coach, OldTeam: record.OldTeam, NewTeam: record.NewTeam,
    OldCoachPosition: record.OldCoachPosition, NewCoachPosition: record.NewCoachPosition,
    TransactionId: record.TransactionId, SeasonStage: record.SeasonStage, SeasonYear: record.SeasonYear,
    ContractSalary: record.ContractSalary, ContractLength: record.ContractLength,
    ContractStatus: record.ContractStatus, SeasonWeek: record.SeasonWeek
  }));
  return ledger.map((item) => JSON.stringify(item)).sort();
}

function transactionIdentityInvariant(state) {
  const { coachTransactions, transactionArrays } = state.tables;
  const array = transactionArrays.records[0];
  const slots = transactionSlots(array).slice(0, transactionArrays.arraySizes[0]);
  const mismatches = [];
  for (let slot = 0; slot < slots.length; slot += 1) {
    const reference = array[slots[slot]];
    const row = typeof reference === 'string' && /^[01]{32}$/.test(reference) && reference !== EMPTY_REF ? Number.parseInt(reference.slice(15), 2) : null;
    const transactionId = row === null ? null : coachTransactions.records[row].TransactionId;
    if (row !== slot + 1 || transactionId !== slot) mismatches.push({ slot, row, transactionId });
  }
  const sentinel = coachTransactions.records[0];
  return {
    mismatchCount: mismatches.length,
    mismatches,
    sentinelValid: Boolean(sentinel && !sentinel.isEmpty && sentinel.TransactionId === 0)
  };
}

function differences(before, after) {
  const length = Math.max(before.length, after.length);
  const result = [];
  for (let index = 0; index < length; index += 1) {
    if (JSON.stringify(before[index]) !== JSON.stringify(after[index])) result.push({ index, before: before[index], after: after[index] });
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const reference = await loadExperimentState(options.reference, schema);
  const test = await loadExperimentState(options.test, schema);
  const referenceStaff = staffLedger(reference); const testStaff = staffLedger(test);
  const referenceCoaches = coachEmploymentLedger(reference); const testCoaches = coachEmploymentLedger(test);
  const referenceTransactions = transactionLedger(reference); const testTransactions = transactionLedger(test);
  const referenceTransactionIdentity = transactionIdentityInvariant(reference);
  const testTransactionIdentity = transactionIdentityInvariant(test);
  const staffDifferences = differences(referenceStaff, testStaff);
  const coachDifferences = differences(referenceCoaches, testCoaches);
  const transactionDifferences = differences(referenceTransactions, testTransactions);
  const topology = {
    referenceOpenings: reference.tables.openings.records.filter((record) => record && !record.isEmpty).length,
    testOpenings: test.tables.openings.records.filter((record) => record && !record.isEmpty).length,
    referenceOfferArrays: reference.tables.offerArrays.records.filter((record) => record && !record.isEmpty).length,
    testOfferArrays: test.tables.offerArrays.records.filter((record) => record && !record.isEmpty).length,
    referenceActiveTransactions: reference.tables.coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    testActiveTransactions: test.tables.coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    referenceIndexedTransactions: reference.tables.transactionArrays.arraySizes[0],
    testIndexedTransactions: test.tables.transactionArrays.arraySizes[0]
  };
  const topologyPassed = topology.referenceOpenings === 0 && topology.testOpenings === 0 && topology.referenceOfferArrays === 0 && topology.testOfferArrays === 0 &&
    topology.referenceActiveTransactions === topology.testActiveTransactions && topology.referenceIndexedTransactions === topology.testIndexedTransactions;
  const transactionIdentityPassed = referenceTransactionIdentity.mismatchCount === 0 && referenceTransactionIdentity.sentinelValid &&
    testTransactionIdentity.mismatchCount === 0 && testTransactionIdentity.sentinelValid;
  const pass = staffDifferences.length === 0 && coachDifferences.length === 0 && transactionDifferences.length === 0 && topologyPassed && transactionIdentityPassed;
  const report = {
    evaluatedAt: new Date().toISOString(), experimentId: options.experimentId, status: pass ? 'passed' : 'failed',
    files: { reference: { path: options.reference, sha256: sha256(options.reference) }, test: { path: options.test, sha256: sha256(options.test) } },
    topology,
    transactionIdentity: { reference: referenceTransactionIdentity, test: testTransactionIdentity },
    comparisons: {
      teamStaffDifferenceCount: staffDifferences.length,
      coachEmploymentDifferenceCount: coachDifferences.length,
      semanticTransactionDifferenceCount: transactionDifferences.length,
      staffDifferences, coachDifferences, transactionDifferences
    },
    conclusions: {
      nativeEquivalentStaff: staffDifferences.length === 0,
      nativeEquivalentCoachEmployment: coachDifferences.length === 0,
      nativeEquivalentStaffMoves: transactionDifferences.length === 0,
      topologyConsumedAndEquivalent: topologyPassed,
      staffMovesIdentityInvariantPreserved: transactionIdentityPassed
    }
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json);
  else process.stdout.write(json);
  if (!pass) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
