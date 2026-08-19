/* Evaluate CAP-2R1 after the human-operated CFP National Championship week to EOS advance. */
'use strict';

const fs = require('fs');
const path = require('path');
const { assert, displayName, loadExperimentState, sha256 } = require('./prepare-bw3-selected-coach-swap');
const {
  compareLandscape, compareNamedAndAutosave, compareTransactions, expectedLandscape
} = require('./evaluate-cap1-one-event-expansion');
const { refRow } = require('./prepare-gate5-native-equivalent-plan');

const OWNER_TABLE_UNIQUE_ID = 2358764614;
const ROLE_FIELDS = {
  HeadCoach: 'HeadCoach',
  OffensiveCoordinator: 'OffensiveCoordinator',
  DefensiveCoordinator: 'DefensiveCoordinator'
};

function parseArgs(argv) {
  const options = {
    directory: path.join(__dirname, '..', 'assets', 'experiments', 'capacity-policy', 'cap2r1-single-retention'),
    output: null,
    experimentId: 'CAP-2R1',
    outputName: 'DYNASTY-CCRCAP2R1'
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--directory') options.directory = path.resolve(argv[++index]);
    else if (argv[index] === '--output') options.output = path.resolve(argv[++index]);
    else if (argv[index] === '--experiment-id') options.experimentId = argv[++index];
    else if (argv[index] === '--output-name') options.outputName = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  options.directory = path.resolve(options.directory);
  options.output = options.output || path.join(options.directory, 'eos-evaluation.json');
  return options;
}

function ownerSlots(record) {
  return (record.fieldsArray || []).map((field) => field.key)
    .filter((field) => /^JobOpening\d+$/.test(field));
}

async function ownerTopology(state) {
  const table = state.franchise.getTableByUniqueId(OWNER_TABLE_UNIQUE_ID);
  assert(table, `Missing JobOpening[] table ${OWNER_TABLE_UNIQUE_ID}.`);
  await table.readRecords();
  const record = table.records[0];
  const slots = ownerSlots(record);
  return {
    logicalSize: table.arraySizes[0],
    recordArraySize: record.arraySize,
    populatedSlots: slots.filter((slot) => record[slot] !== '00000000000000000000000000000000').length
  };
}

function eosTopology(state) {
  return {
    activeOpenings: state.tables.openings.records.filter((record) => record && !record.isEmpty).length,
    activeOfferArrays: state.tables.offerArrays.records.filter((record) => record && !record.isEmpty).length,
    activeTransactions: state.tables.coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    indexedTransactions: state.tables.transactionArrays.arraySizes[0]
  };
}

function retentionOutcome(state, retention) {
  const team = state.tables.teams.records[retention.teamRow];
  const coach = state.tables.coaches.records[retention.coachRow];
  const assignedRow = refRow(team[ROLE_FIELDS[retention.role]]);
  const checks = {
    incumbentRemainsAssigned: assignedRow === retention.coachRow,
    coachTeamMatches: coach.TeamIndex === team.TeamIndex,
    coachRoleMatches: coach.Position === retention.role,
    coachContractActive: String(coach.ContractStatus).includes('Active')
  };
  return {
    teamRow: retention.teamRow,
    team: displayName(team),
    role: retention.role,
    expectedCoachRow: retention.coachRow,
    expectedCoach: displayName(coach),
    assignedCoachRow: assignedRow,
    coachEmployment: {
      teamIndex: coach.TeamIndex,
      prevTeamIndex: coach.PrevTeamIndex,
      position: coach.Position,
      contractStatus: coach.ContractStatus,
      contractLength: coach.ContractLength,
      contractYearsRemaining: coach.ContractYearsRemaining
    },
    checks
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const manifestPath = path.join(options.directory, 'experiment-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.experimentId === options.experimentId && manifest.addedRetentions.length >= 1, `${options.experimentId} manifest is invalid.`);
  const paths = {
    treatment: manifest.output,
    namedEos: path.join(options.directory, 'returned-eos', `${options.outputName}E`),
    autosaveEos: path.join(options.directory, 'returned-eos', `${options.outputName}-AUTOSAVE`)
  };
  for (const [kind, file] of Object.entries(paths)) assert(fs.existsSync(file), `Missing ${kind}: ${file}`);
  assert(sha256(paths.treatment) === manifest.outputSha256, 'Treatment hash does not match the manifest.');

  const [treatment, named, autosave] = await Promise.all([
    loadExperimentState(paths.treatment, schema),
    loadExperimentState(paths.namedEos, schema),
    loadExperimentState(paths.autosaveEos, schema)
  ]);
  const expected = expectedLandscape(treatment);
  const landscape = compareLandscape(treatment, named, expected);
  const transactions = compareTransactions(treatment, named);
  const retentions = manifest.addedRetentions.map((retention) => retentionOutcome(named, retention));
  const namedAutosave = compareNamedAndAutosave(named, autosave);
  const namedTopology = eosTopology(named);
  const autosaveTopology = eosTopology(autosave);
  const [treatmentOwner, namedOwner, autosaveOwner] = await Promise.all([
    ownerTopology(treatment), ownerTopology(named), ownerTopology(autosave)
  ]);
  const checks = {
    treatmentRegisteredExpectedEvents: treatmentOwner.logicalSize === manifest.plan.totalRegisteredOpenings &&
      treatmentOwner.populatedSlots === manifest.plan.totalRegisteredOpenings,
    completeLandscapeCommitted: landscape.differences.length === 0,
    employmentCrossReferencesCoherent: landscape.employmentFailures.length === 0,
    noDuplicateStaffAssignments: landscape.duplicateAssignments.length === 0,
    allRetentionsCommitted: retentions.every((retention) => Object.values(retention.checks).every(Boolean)),
    nativeStaffMovesPreserved: transactions.indexedCount === 111 && transactions.mismatches.length === 0,
    transactionIdentityPositional: transactions.positionalFailures.length === 0,
    openingTopologyConsumed: namedTopology.activeOpenings === 0 && namedTopology.activeOfferArrays === 0,
    ownerTopologyConsumed: namedOwner.logicalSize === 0 && namedOwner.populatedSlots === 0,
    nativeTransactionCountsPreserved: namedTopology.activeTransactions === 112 && namedTopology.indexedTransactions === 111,
    namedAndAutosaveAgree: namedAutosave.materialFocusedChanges.length === 0 &&
      JSON.stringify(namedTopology) === JSON.stringify(autosaveTopology) && JSON.stringify(namedOwner) === JSON.stringify(autosaveOwner)
  };
  const passed = Object.values(checks).every(Boolean);
  const report = {
    experimentId: options.experimentId,
    evaluatedAt: new Date().toISOString(),
    status: passed ? 'passed' : 'failed',
    sourceManifest: { path: manifestPath, sha256: sha256(manifestPath) },
    files: Object.fromEntries(Object.entries(paths).map(([kind, file]) => [kind, { path: file, sha256: sha256(file) }])),
    checks,
    retentionOutcomes: retentions,
    landscape,
    transactions,
    topology: {
      treatmentOwner,
      namedEos: { ...namedTopology, owner: namedOwner },
      autosaveEos: { ...autosaveTopology, owner: autosaveOwner }
    },
    namedAutosaveComparison: namedAutosave,
    conclusion: passed
      ? `All ${retentions.length} added same-Coach ContractEnding retentions resolved coherently at ${manifest.plan.totalRegisteredOpenings} registered openings.`
      : 'The game advanced, but at least one declared retention, landscape, Staff Moves, topology, or named/autosave invariant failed.'
  };
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
