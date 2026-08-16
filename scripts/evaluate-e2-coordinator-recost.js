/* Evaluate E2 coordinator movement and final-price settlement against Gate 2 EOS. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, sha256
} = require('./prepare-bw3-selected-coach-swap');

const TARGET = { teamRow: 9, bausbyRow: 451, payneRow: 495, durkinRow: 128, transactionRow: 62, amount: 25 };

function parseArgs(argv) {
  const options = {
    reference: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1EOSG2BAUSBY'),
    test: null,
    output: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--reference') options.reference = path.resolve(argv[++index]);
    else if (argv[index] === '--test') options.test = path.resolve(argv[++index]);
    else if (argv[index] === '--output') options.output = path.resolve(argv[++index]);
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

function isAmbient(change) {
  return (change.table === 'coaches' && change.field === 'CoachPoints') ||
    (change.table === 'teams' && ['CoachesPoll_NumVoters', 'MediaPoll_NumVoters'].includes(change.field));
}

function finances(state) {
  const team = state.tables.teams.records[TARGET.teamRow];
  assert(displayName(team) === 'Auburn', 'Auburn Team row mismatch.');
  return {
    remaining: team.RemainingProgramPoints,
    staffSpent: team.StaffProgramPointsSpent,
    headCoachBudget: team.HeadCoachProgramPointBudget,
    offensiveCoordinatorBudget: team.OffensiveCoordinatorPointBudget,
    defensiveCoordinatorBudget: team.DefensiveCoordinatorPointBudget,
    rollover: team.RolloverProgramPoints,
    programPointBudget: team.ProgramPointBudget,
    nilSpent: team.NILProgramPointsSpent,
    staffPool: team.RemainingProgramPoints + team.StaffProgramPointsSpent
  };
}

function outcome(state) {
  const { teams, coaches, coachTransactions, transactionArrays, openings, offerArrays } = state.tables;
  const team = teams.records[TARGET.teamRow];
  const bausby = coaches.records[TARGET.bausbyRow];
  const payne = coaches.records[TARGET.payneRow];
  const durkin = coaches.records[TARGET.durkinRow];
  const transaction = coachTransactions.records[TARGET.transactionRow];
  const slots = transactionSlots(transactionArrays.records[0]).slice(0, transactionArrays.arraySizes[0]);
  const identityMismatches = slots.map((field, slot) => {
    const reference = transactionArrays.records[0][field];
    const row = Number.parseInt(reference.slice(15), 2);
    return { slot, row, transactionId: coachTransactions.records[row].TransactionId };
  }).filter((item) => item.row !== item.slot + 1 || item.transactionId !== item.slot);
  return {
    activeOpenings: openings.records.filter((record) => record && !record.isEmpty).length,
    activeOfferArrays: offerArrays.records.filter((record) => record && !record.isEmpty).length,
    activeTransactions: coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    indexedTransactions: transactionArrays.arraySizes[0],
    transactionIdentityMismatchCount: identityMismatches.length,
    auburnDc: getValue(team, ['DefensiveCoordinator']),
    bausby: { reference: coachReference(coaches, TARGET.bausbyRow), teamIndex: bausby.TeamIndex, prevTeamIndex: bausby.PrevTeamIndex, position: bausby.Position, status: bausby.ContractStatus },
    payne: { teamIndex: payne.TeamIndex, status: payne.ContractStatus },
    durkin: { teamIndex: durkin.TeamIndex, prevTeamIndex: durkin.PrevTeamIndex, status: durkin.ContractStatus },
    transaction: {
      coach: transaction.Coach, oldTeam: transaction.OldTeam, newTeam: transaction.NewTeam,
      newPosition: transaction.NewCoachPosition, transactionId: transaction.TransactionId,
      indexedAtSlot: slots.findIndex((field) => transactionArrays.records[0][field] === coachTransactions.getBinaryReferenceToRecord(TARGET.transactionRow))
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const reference = await loadExperimentState(options.reference, schema);
  const test = await loadExperimentState(options.test, schema);
  const referenceFinances = finances(reference);
  const testFinances = finances(test);
  const testOutcome = outcome(test);
  const differences = collectDifferences(focusedSnapshot(reference.tables), focusedSnapshot(test.tables));
  const allowed = new Set([
    'openings:22:FinalContractProgramPoints',
    'teams:9:RemainingProgramPoints',
    'teams:9:StaffProgramPointsSpent',
    'teams:9:DefensiveCoordinatorPointBudget'
  ]);
  const unexpectedDifferences = differences.filter((change) => !allowed.has(`${change.table}:${change.row}:${change.field}`) && !isAmbient(change));
  const teamReference = test.tables.teams.getBinaryReferenceToRecord(TARGET.teamRow);
  const employmentPassed = testOutcome.auburnDc === testOutcome.bausby.reference &&
    testOutcome.bausby.teamIndex === 8 && testOutcome.bausby.prevTeamIndex === 255 &&
    testOutcome.bausby.position === 'DefensiveCoordinator' && String(testOutcome.bausby.status).includes('Active') &&
    testOutcome.payne.teamIndex === 255 && testOutcome.payne.status === 'FreeAgent' &&
    testOutcome.durkin.teamIndex === 255 && testOutcome.durkin.prevTeamIndex === 8;
  const staffMovesPassed = testOutcome.transaction.coach === testOutcome.bausby.reference &&
    testOutcome.transaction.oldTeam === EMPTY_REF && testOutcome.transaction.newTeam === teamReference &&
    testOutcome.transaction.newPosition === 'DefensiveCoordinator' && testOutcome.transaction.indexedAtSlot === 61 &&
    testOutcome.transaction.transactionId === 61 && testOutcome.transactionIdentityMismatchCount === 0;
  const financialPassed = testFinances.remaining === referenceFinances.remaining - TARGET.amount &&
    testFinances.staffSpent === referenceFinances.staffSpent + TARGET.amount &&
    testFinances.defensiveCoordinatorBudget === referenceFinances.defensiveCoordinatorBudget + TARGET.amount &&
    testFinances.headCoachBudget === referenceFinances.headCoachBudget &&
    testFinances.offensiveCoordinatorBudget === referenceFinances.offensiveCoordinatorBudget &&
    testFinances.rollover === referenceFinances.rollover &&
    testFinances.programPointBudget === referenceFinances.programPointBudget &&
    testFinances.nilSpent === referenceFinances.nilSpent &&
    testFinances.staffPool === referenceFinances.staffPool;
  const topologyPassed = testOutcome.activeOpenings === 0 && testOutcome.activeOfferArrays === 0 &&
    testOutcome.activeTransactions === 125 && testOutcome.indexedTransactions === 124;
  const pass = employmentPassed && staffMovesPassed && financialPassed && topologyPassed && unexpectedDifferences.length === 0;
  const report = {
    evaluatedAt: new Date().toISOString(), experimentId: 'E2', status: pass ? 'passed' : 'failed',
    files: {
      reference: { path: options.reference, sha256: sha256(options.reference) },
      test: { path: options.test, sha256: sha256(options.test) }
    },
    comparisonBasis: 'Gate 2 EOS uses the identical Bausby-for-Payne movement with FinalContractProgramPoints left at 0.',
    finances: { reference: referenceFinances, test: testFinances },
    expectedDelta: { remaining: -25, staffSpent: 25, defensiveCoordinatorBudget: 25, staffPool: 0 },
    comparison: {
      totalFocusedDifferences: differences.length,
      expectedTreatmentDifferences: differences.filter((change) => allowed.has(`${change.table}:${change.row}:${change.field}`)),
      ambientDifferenceCount: differences.filter(isAmbient).length,
      unexpectedDifferences
    },
    outcome: testOutcome,
    conclusions: {
      coordinatorEmploymentCommitted: employmentPassed,
      staffMovesCoherent: staffMovesPassed,
      coordinatorFinalPriceSettled: financialPassed,
      topologyConsumedAndEquivalent: topologyPassed,
      noUnexpectedCollateral: unexpectedDifferences.length === 0
    }
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json); else process.stdout.write(json);
  if (!pass) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
