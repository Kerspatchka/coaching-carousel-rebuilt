/* Evaluate Gate 6 synthetic full-plan employment, Staff Moves, and finances at EOS. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, displayName, getValue, loadExperimentState, sha256
} = require('./prepare-bw3-selected-coach-swap');
const { extractPlan, refRow } = require('./prepare-gate5-native-equivalent-plan');

const ROLE_FIELDS = {
  HeadCoach: 'HeadCoach',
  OffensiveCoordinator: 'OffensiveCoordinator',
  DefensiveCoordinator: 'DefensiveCoordinator'
};
const BUDGET_FIELDS = {
  HeadCoach: 'HeadCoachProgramPointBudget',
  OffensiveCoordinator: 'OffensiveCoordinatorPointBudget',
  DefensiveCoordinator: 'DefensiveCoordinatorPointBudget'
};

function parseArgs(argv) {
  const options = {
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    nativeEos: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1EOS'),
    manifest: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate6-synthetic-full-plan', 'experiment-manifest.json'),
    test: null,
    output: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') options.source = path.resolve(argv[++index]);
    else if (argv[index] === '--native-eos') options.nativeEos = path.resolve(argv[++index]);
    else if (argv[index] === '--manifest') options.manifest = path.resolve(argv[++index]);
    else if (argv[index] === '--test') options.test = path.resolve(argv[++index]);
    else if (argv[index] === '--output') options.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  for (const key of ['source', 'nativeEos', 'manifest', 'test']) assert(options[key] && fs.existsSync(options[key]), `Missing ${key}: ${options[key]}`);
  return options;
}

function fields(record) {
  return (record && record.fieldsArray || []).map((field) => field.key);
}

function transactionSlots(record) {
  return fields(record).filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function expectedLandscape(source, manifest) {
  const expected = new Map();
  for (const team of source.tables.teams.records.filter((record) => record && !record.isEmpty)) {
    for (const [role, field] of Object.entries(ROLE_FIELDS)) expected.set(`${team.index}|${role}`, team[field]);
  }
  const syntheticByDestination = new Map(manifest.assignments.map((assignment) => [`${assignment.destinationTeamRow}|${assignment.role}`, assignment]));
  for (const opening of extractPlan(source).openingEvents) {
    const teamRow = refRow(opening.values.Team);
    const key = `${teamRow}|${opening.values.Position}`;
    const synthetic = syntheticByDestination.get(key);
    expected.set(key, synthetic ? coachReference(source.tables.coaches, synthetic.coachRow) : opening.values.SelectedCoach);
  }
  return expected;
}

function compareLandscape(source, test, expected) {
  const differences = [];
  for (const team of source.tables.teams.records.filter((record) => record && !record.isEmpty)) {
    const testTeam = test.tables.teams.records[team.index];
    for (const [role, field] of Object.entries(ROLE_FIELDS)) {
      const expectedReference = expected.get(`${team.index}|${role}`);
      if (testTeam[field] !== expectedReference) differences.push({
        teamRow: team.index, team: displayName(team), role,
        expectedCoachRow: refRow(expectedReference), actualCoachRow: refRow(testTeam[field])
      });
    }
  }
  return differences;
}

function transactionIdentity(state) {
  const { coachTransactions, transactionArrays } = state.tables;
  const slots = transactionSlots(transactionArrays.records[0]).slice(0, transactionArrays.arraySizes[0]);
  const mismatches = [];
  for (let slot = 0; slot < slots.length; slot += 1) {
    const row = refRow(transactionArrays.records[0][slots[slot]]);
    const transactionId = row === null ? null : coachTransactions.records[row].TransactionId;
    if (row !== slot + 1 || transactionId !== slot) mismatches.push({ slot, row, transactionId });
  }
  return { indexedCount: slots.length, mismatchCount: mismatches.length, mismatches };
}

function compareAssignments(source, test, manifest) {
  const employmentFailures = [];
  const transactionFailures = [];
  for (const assignment of manifest.assignments) {
    const coach = test.tables.coaches.records[assignment.coachRow];
    const expectedCoachReference = coachReference(test.tables.coaches, assignment.coachRow);
    const expectedOldTeam = assignment.sourceTeamRow === null ? EMPTY_REF : test.tables.teams.getBinaryReferenceToRecord(assignment.sourceTeamRow);
    const expectedNewTeam = test.tables.teams.getBinaryReferenceToRecord(assignment.destinationTeamRow);
    const employment = {
      teamIndex: coach.TeamIndex, position: coach.Position, status: coach.ContractStatus,
      teamRoleReference: test.tables.teams.records[assignment.destinationTeamRow][ROLE_FIELDS[assignment.role]]
    };
    const expectedTeamIndex = test.tables.teams.records[assignment.destinationTeamRow].TeamIndex;
    if (employment.teamIndex !== expectedTeamIndex || employment.position !== assignment.role ||
      !String(employment.status).includes('Active') || employment.teamRoleReference !== expectedCoachReference) {
      employmentFailures.push({ assignment, actual: employment });
    }
    const transaction = test.tables.coachTransactions.records[assignment.transactionRow];
    const actual = {
      coach: transaction.Coach, oldTeam: transaction.OldTeam, newTeam: transaction.NewTeam,
      oldRole: transaction.OldCoachPosition, newRole: transaction.NewCoachPosition,
      transactionId: transaction.TransactionId
    };
    if (actual.coach !== expectedCoachReference || actual.oldTeam !== expectedOldTeam || actual.newTeam !== expectedNewTeam ||
      actual.oldRole !== assignment.sourceRole || actual.newRole !== assignment.role || actual.transactionId !== assignment.transactionId) {
      transactionFailures.push({ assignment, actual });
    }
  }
  const restoredFailures = manifest.restoredCoachRows.flatMap((row) => {
    const before = source.tables.coaches.records[row];
    const after = test.tables.coaches.records[row];
    const sourceTeam = source.tables.teams.records.find((record) => record && !record.isEmpty && record.TeamIndex === before.TeamIndex);
    const teamRow = sourceTeam && sourceTeam.index;
    const teamRole = test.tables.teams.records[teamRow][ROLE_FIELDS[before.Position]];
    return after.TeamIndex === before.TeamIndex && after.Position === before.Position && String(after.ContractStatus).includes('Active') &&
      teamRole === coachReference(test.tables.coaches, row) ? [] : [{ row, coach: displayName(before), expectedTeamIndex: before.TeamIndex, expectedRole: before.Position, actualTeamIndex: after.TeamIndex, actualRole: after.Position, actualStatus: after.ContractStatus }];
  });
  const changedUserCoaches = manifest.assignments.filter((assignment) => source.tables.coaches.records[assignment.coachRow].IsUserControlled && !assignment.protectedUserCoach);
  return { employmentFailures, transactionFailures, restoredFailures, changedUserCoaches };
}

function compareFinances(nativeEos, test, manifest) {
  const byTeam = new Map();
  for (const assignment of manifest.assignments) {
    if (!byTeam.has(assignment.destinationTeamRow)) byTeam.set(assignment.destinationTeamRow, []);
    byTeam.get(assignment.destinationTeamRow).push(assignment);
  }
  const priceSettlementFailures = [];
  const liquidityVariances = [];
  const negativeRemainingTeams = [];
  const results = [];
  for (const [teamRow, assignments] of byTeam) {
    const reference = nativeEos.tables.teams.records[teamRow];
    const actual = test.tables.teams.records[teamRow];
    const priceDelta = assignments.reduce((sum, assignment) => sum + assignment.finalPrice - assignment.nativeFinalPrice, 0);
    const expected = {
      remaining: reference.RemainingProgramPoints - priceDelta,
      staffSpent: reference.StaffProgramPointsSpent + priceDelta,
      rollover: reference.RolloverProgramPoints,
      programPointBudget: reference.ProgramPointBudget,
      nilSpent: reference.NILProgramPointsSpent,
      staffPool: reference.RemainingProgramPoints + reference.StaffProgramPointsSpent,
      roleBudgets: Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment.finalPrice]))
    };
    const observed = {
      remaining: actual.RemainingProgramPoints,
      staffSpent: actual.StaffProgramPointsSpent,
      rollover: actual.RolloverProgramPoints,
      programPointBudget: actual.ProgramPointBudget,
      nilSpent: actual.NILProgramPointsSpent,
      staffPool: actual.RemainingProgramPoints + actual.StaffProgramPointsSpent,
      roleBudgets: Object.fromEntries(assignments.map((assignment) => [assignment.role, actual[BUDGET_FIELDS[assignment.role]]]))
    };
    const priceOutputsPassed = expected.staffSpent === observed.staffSpent && JSON.stringify(expected.roleBudgets) === JSON.stringify(observed.roleBudgets);
    const liquidityMatched = expected.remaining === observed.remaining && expected.rollover === observed.rollover &&
      expected.programPointBudget === observed.programPointBudget && expected.nilSpent === observed.nilSpent && expected.staffPool === observed.staffPool;
    const nonNegativeRemaining = observed.remaining >= 0;
    results.push({ teamRow, team: displayName(actual), priceDelta, expected, observed, priceOutputsPassed, liquidityMatched, nonNegativeRemaining });
    if (!priceOutputsPassed) priceSettlementFailures.push(results[results.length - 1]);
    if (!liquidityMatched) liquidityVariances.push(results[results.length - 1]);
    if (!nonNegativeRemaining) negativeRemainingTeams.push(results[results.length - 1]);
  }
  return { teamsChecked: results.length, priceSettlementFailures, liquidityVariances, negativeRemainingTeams, results };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
  assert(['G6', 'G6B'].includes(manifest.experimentId) && manifest.assignments.length === 66, 'Gate 6/Gate 6B manifest is invalid.');
  const source = await loadExperimentState(options.source, schema);
  const nativeEos = await loadExperimentState(options.nativeEos, schema);
  const test = await loadExperimentState(options.test, schema);
  const landscapeDifferences = compareLandscape(source, test, expectedLandscape(source, manifest));
  const assignments = compareAssignments(source, test, manifest);
  const finances = compareFinances(nativeEos, test, manifest);
  const identity = transactionIdentity(test);
  const topology = {
    activeOpenings: test.tables.openings.records.filter((record) => record && !record.isEmpty).length,
    activeOfferArrays: test.tables.offerArrays.records.filter((record) => record && !record.isEmpty).length,
    activeTransactions: test.tables.coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    indexedTransactions: test.tables.transactionArrays.arraySizes[0]
  };
  const corePass = landscapeDifferences.length === 0 && assignments.employmentFailures.length === 0 &&
    assignments.transactionFailures.length === 0 && assignments.restoredFailures.length === 0 && assignments.changedUserCoaches.length === 0 &&
    finances.priceSettlementFailures.length === 0 && finances.negativeRemainingTeams.length === 0 &&
    identity.mismatchCount === 0 && topology.activeOpenings === 0 && topology.activeOfferArrays === 0 &&
    topology.activeTransactions === 125 && topology.indexedTransactions === 124;
  const status = corePass ? (finances.liquidityVariances.length === 0 ? 'passed' : 'partial') : 'failed';
  const report = {
    evaluatedAt: new Date().toISOString(), experimentId: manifest.experimentId, status,
    files: {
      source: { path: options.source, sha256: sha256(options.source) },
      nativeEos: { path: options.nativeEos, sha256: sha256(options.nativeEos) },
      manifest: { path: options.manifest, sha256: sha256(options.manifest) },
      test: { path: options.test, sha256: sha256(options.test) }
    },
    plan: manifest.plan,
    landscape: { rolesChecked: source.tables.teams.records.filter((record) => record && !record.isEmpty).length * 3, differenceCount: landscapeDifferences.length, differences: landscapeDifferences },
    assignments: {
      syntheticHiresChecked: manifest.assignments.length,
      employmentFailures: assignments.employmentFailures,
      transactionFailures: assignments.transactionFailures,
      restoredCoachFailures: assignments.restoredFailures,
      changedUserCoaches: assignments.changedUserCoaches
    },
    finances,
    transactionIdentity: identity,
    topology,
    conclusions: {
      completeLandscapeCommitted: landscapeDifferences.length === 0,
      syntheticEmploymentCommitted: assignments.employmentFailures.length === 0,
      staffMovesCoherent: assignments.transactionFailures.length === 0 && identity.mismatchCount === 0,
      uncoveredNativeMoversRestored: assignments.restoredFailures.length === 0,
      userCoachPreserved: assignments.changedUserCoaches.length === 0,
      pricesSettledIntoRoleBudgetsAndStaffExpense: finances.priceSettlementFailures.length === 0,
      noNegativeRemainingBalances: finances.negativeRemainingTeams.length === 0,
      remainingLiquidityMatchedNativeCounterfactual: finances.liquidityVariances.length === 0,
      topologyConsumedAndEquivalent: topology.activeOpenings === 0 && topology.activeOfferArrays === 0 && topology.activeTransactions === 125 && topology.indexedTransactions === 124
    }
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json); else process.stdout.write(json);
  if (!corePass) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
