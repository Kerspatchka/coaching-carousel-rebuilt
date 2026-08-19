/* Evaluate CAP-1B after the human-operated CFP National Championship week to EOS advance. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  assert, loadExperimentState, sha256
} = require('./prepare-bw3-selected-coach-swap');
const {
  compareLandscape, compareNamedAndAutosave, compareTransactions, expectedLandscape,
  resolveTarget, targetOutcome, topology
} = require('./evaluate-cap1-one-event-expansion');

const OWNER_TABLE_UNIQUE_ID = 2358764614;

function parseArgs(argv) {
  const options = {
    directory: path.join(__dirname, '..', 'assets', 'experiments', 'capacity-policy', 'cap1b-owner-array-expansion'),
    cap1Directory: path.join(__dirname, '..', 'assets', 'experiments', 'capacity-policy', 'cap1-one-event-expansion'),
    output: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--directory') options.directory = argv[++index];
    else if (argv[index] === '--cap1-directory') options.cap1Directory = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  options.directory = path.resolve(options.directory);
  options.cap1Directory = path.resolve(options.cap1Directory);
  options.output = options.output ? path.resolve(options.output) : path.join(options.directory, 'eos-evaluation.json');
  return options;
}

function ownerSlots(record) {
  return (record.fieldsArray || []).map((field) => field.key)
    .filter((field) => /^JobOpening\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

async function ownerTopology(state) {
  const table = state.franchise.getTableByUniqueId(OWNER_TABLE_UNIQUE_ID);
  assert(table, `Missing JobOpening[] table ${OWNER_TABLE_UNIQUE_ID}.`);
  await table.readRecords();
  const record = table.records[0];
  const slots = ownerSlots(record);
  return {
    tableName: table.name,
    uniqueId: table.header.uniqueId,
    tableId: table.header.tableId,
    physicalSlots: slots.length,
    logicalSize: table.arraySizes[0],
    recordArraySize: record.arraySize,
    populatedSlots: slots.filter((slot) => record[slot] !== '00000000000000000000000000000000').length,
    treatmentSlotValue: record.JobOpening186
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const manifestPath = path.join(options.directory, 'experiment-manifest.json');
  const cap1ManifestPath = path.join(options.cap1Directory, 'experiment-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const cap1Manifest = JSON.parse(fs.readFileSync(cap1ManifestPath, 'utf8'));
  assert(manifest.experimentId === 'CAP-1B', 'CAP-1B manifest is invalid.');
  assert(cap1Manifest.experimentId === 'CAP-1' && cap1Manifest.treatments.length === 3, 'CAP-1 parent manifest is invalid.');

  const paths = {
    treatment: manifest.output,
    namedEos: path.join(options.directory, 'returned-eos', 'DYNASTY-CCRCAP1BE'),
    autosaveEos: path.join(options.directory, 'returned-eos', 'DYNASTY-CCRCAP1B-AUTOSAVE')
  };
  for (const [kind, file] of Object.entries(paths)) assert(fs.existsSync(file), `Missing ${kind}: ${file}`);
  assert(sha256(paths.treatment) === manifest.outputSha256, 'CAP-1B treatment hash does not match its manifest.');

  const [treatment, named, autosave] = await Promise.all([
    loadExperimentState(paths.treatment, schema),
    loadExperimentState(paths.namedEos, schema),
    loadExperimentState(paths.autosaveEos, schema)
  ]);
  const parentRecord = { ...cap1Manifest.treatments[0], output: paths.treatment };
  const resolvedTreatmentRecord = resolveTarget(treatment, parentRecord);
  const expected = expectedLandscape(treatment);
  const landscape = compareLandscape(treatment, named, expected);
  const transactions = compareTransactions(treatment, named);
  const outcome = targetOutcome(named, resolvedTreatmentRecord);
  const resultTopology = topology(named, resolvedTreatmentRecord.treatment);
  const namedAutosave = compareNamedAndAutosave(named, autosave);
  const [treatmentOwner, namedOwner, autosaveOwner] = await Promise.all([
    ownerTopology(treatment), ownerTopology(named), ownerTopology(autosave)
  ]);
  const expectedActiveTransactions = treatment.tables.coachTransactions.records.filter((record) => record && !record.isEmpty).length;
  const expectedIndexedTransactions = treatment.tables.transactionArrays.arraySizes[0];
  const checks = {
    treatmentOwnerRegistered: treatmentOwner.logicalSize === 187 && treatmentOwner.populatedSlots === 187,
    completeLandscapeCommitted: landscape.differences.length === 0,
    employmentCrossReferencesCoherent: landscape.employmentFailures.length === 0,
    noDuplicateStaffAssignments: landscape.duplicateAssignments.length === 0,
    allIndexedHistoryPreserved: transactions.mismatches.length === 0,
    transactionIdentityPositional: transactions.positionalFailures.length === 0,
    targetCascadeCommitted: Object.values(outcome.checks).every(Boolean),
    addedTopologyConsumed: resultTopology.activeOpenings === 0 && resultTopology.activeOfferArrays === 0 && resultTopology.addedOpeningIsEmpty && resultTopology.addedOfferArrayIsEmpty,
    ownerArrayConsumed: namedOwner.logicalSize === 0 && namedOwner.populatedSlots === 0,
    addedHistorySurvived: resultTopology.addedTransactionIsActive && resultTopology.activeTransactions === expectedActiveTransactions && resultTopology.indexedTransactions === expectedIndexedTransactions,
    namedAndAutosaveAgree: namedAutosave.materialFocusedChanges.length === 0 && JSON.stringify(namedOwner) === JSON.stringify(autosaveOwner)
  };
  const report = {
    experimentId: 'CAP-1B',
    evaluatedAt: new Date().toISOString(),
    status: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
    sourceManifest: { path: manifestPath, sha256: sha256(manifestPath) },
    files: Object.fromEntries(Object.entries(paths).map(([kind, file]) => [kind, { path: file, sha256: sha256(file) }])),
    checks,
    targetOutcome: outcome,
    landscape,
    transactions,
    topology: resultTopology,
    ownerTopology: { treatment: treatmentOwner, namedEos: namedOwner, autosaveEos: autosaveOwner },
    namedAutosaveComparison: namedAutosave,
    conclusion: Object.values(checks).every(Boolean)
      ? 'Registering the new physical opening in JobOpening[] expanded the resolver from 186 to 187 events and committed the complete declared cascade coherently.'
      : 'CAP-1B did not satisfy every assignment, history, topology, owner-array, and named/autosave validation check.'
  };
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
