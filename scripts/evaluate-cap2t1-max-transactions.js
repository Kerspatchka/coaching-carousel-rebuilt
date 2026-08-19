/* Evaluate CAP-2T1 after the human-operated CFP National Championship week to EOS advance. */
'use strict';

const fs = require('fs');
const path = require('path');
const { assert, loadExperimentState, sha256 } = require('./prepare-bw3-selected-coach-swap');
const {
  compareLandscape, compareNamedAndAutosave, compareTransactions, expectedLandscape
} = require('./evaluate-cap1-one-event-expansion');

const OWNER_TABLE_UNIQUE_ID = 2358764614;
const EMPTY_REF = '00000000000000000000000000000000';

function fields(record) {
  return (record && record.fieldsArray || []).map((field) => field.key);
}

async function ownerTopology(state) {
  const table = state.franchise.getTableByUniqueId(OWNER_TABLE_UNIQUE_ID);
  assert(table, `Missing JobOpening[] table ${OWNER_TABLE_UNIQUE_ID}.`);
  await table.readRecords();
  const record = table.records[0];
  const slots = fields(record).filter((field) => /^JobOpening\d+$/.test(field));
  return {
    logicalSize: table.arraySizes[0],
    recordArraySize: record.arraySize,
    populatedSlots: slots.filter((slot) => record[slot] !== EMPTY_REF).length
  };
}

function topology(state) {
  return {
    activeOpenings: state.tables.openings.records.filter((record) => record && !record.isEmpty).length,
    activeOfferArrays: state.tables.offerArrays.records.filter((record) => record && !record.isEmpty).length,
    activeTransactions: state.tables.coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    indexedTransactions: state.tables.transactionArrays.arraySizes[0]
  };
}

async function main() {
  const directory = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'experiments', 'capacity-policy', 'cap2t1-supported-max-transactions'));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const manifestPath = path.join(directory, 'experiment-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(/^CAP-2T\d+$/.test(manifest.experimentId) && manifest.plan.movements === 299, 'Maximum-transaction manifest is invalid.');
  const treatmentName = path.basename(manifest.output);
  const paths = {
    treatment: manifest.output,
    namedEos: path.join(directory, 'returned-eos', `${treatmentName}E`),
    autosaveEos: path.join(directory, 'returned-eos', `${treatmentName}-AUTOSAVE`)
  };
  for (const [kind, file] of Object.entries(paths)) assert(fs.existsSync(file), `Missing ${kind}: ${file}`);
  assert(sha256(paths.treatment) === manifest.outputSha256, 'Treatment hash does not match the manifest.');

  const [treatment, named, autosave] = await Promise.all([
    loadExperimentState(paths.treatment, schema),
    loadExperimentState(paths.namedEos, schema),
    loadExperimentState(paths.autosaveEos, schema)
  ]);
  const landscape = compareLandscape(treatment, named, expectedLandscape(treatment));
  const transactions = compareTransactions(treatment, named);
  const namedAutosave = compareNamedAndAutosave(named, autosave);
  const treatmentTopology = topology(treatment);
  const namedTopology = topology(named);
  const autosaveTopology = topology(autosave);
  const [treatmentOwner, namedOwner, autosaveOwner] = await Promise.all([
    ownerTopology(treatment), ownerTopology(named), ownerTopology(autosave)
  ]);
  const checks = {
    treatmentAtPhysicalMaximum: treatmentTopology.activeOpenings === 408 && treatmentTopology.activeOfferArrays === 408 &&
      treatmentTopology.activeTransactions === 300 && treatmentTopology.indexedTransactions === 299 &&
      treatmentOwner.logicalSize === 408 && treatmentOwner.populatedSlots === 408,
    completeLandscapeCommitted: landscape.differences.length === 0,
    employmentCrossReferencesCoherent: landscape.employmentFailures.length === 0,
    noDuplicateStaffAssignments: landscape.duplicateAssignments.length === 0,
    all299StaffMovesPreserved: transactions.indexedCount === 299 && transactions.mismatches.length === 0,
    transactionIdentityPositional: transactions.positionalFailures.length === 0,
    openingTopologyConsumed: namedTopology.activeOpenings === 0 && namedTopology.activeOfferArrays === 0,
    ownerTopologyConsumed: namedOwner.logicalSize === 0 && namedOwner.populatedSlots === 0,
    maximumTransactionCountsPreserved: namedTopology.activeTransactions === 300 && namedTopology.indexedTransactions === 299,
    namedAndAutosaveAgree: namedAutosave.materialFocusedChanges.length === 0 &&
      JSON.stringify(namedTopology) === JSON.stringify(autosaveTopology) && JSON.stringify(namedOwner) === JSON.stringify(autosaveOwner)
  };
  const employmentFailureContexts = landscape.employmentFailures.map((failure) => {
    const before = treatment.tables.coaches.records[failure.coachRow];
    const after = named.tables.coaches.records[failure.coachRow];
    return {
      coachRow: failure.coachRow,
      coach: failure.coach,
      destinationTeam: failure.team,
      role: failure.role,
      treatment: {
        teamIndex: before.TeamIndex,
        prevTeamIndex: before.PrevTeamIndex,
        contractYearsRemaining: before.ContractYearsRemaining,
        contractStatus: before.ContractStatus
      },
      eos: {
        teamIndex: after.TeamIndex,
        prevTeamIndex: after.PrevTeamIndex,
        contractYearsRemaining: after.ContractYearsRemaining,
        contractStatus: after.ContractStatus
      }
    };
  });
  const passed = Object.values(checks).every(Boolean);
  const report = {
    experimentId: manifest.experimentId,
    evaluatedAt: new Date().toISOString(),
    status: passed ? 'passed' : 'failed',
    sourceManifest: { path: manifestPath, sha256: sha256(manifestPath) },
    files: Object.fromEntries(Object.entries(paths).map(([kind, file]) => [kind, { path: file, sha256: sha256(file) }])),
    checks,
    landscape,
    employmentFailureContexts,
    transactions,
    topology: {
      treatment: { ...treatmentTopology, owner: treatmentOwner },
      namedEos: { ...namedTopology, owner: namedOwner },
      autosaveEos: { ...autosaveTopology, owner: autosaveOwner }
    },
    namedAutosaveComparison: namedAutosave,
    conclusion: passed
      ? 'The full existing representation resolved coherently: 408 opening events, 299 indexed movement transactions, 429 unique assignments, and normal EOS topology cleanup.'
      : 'The full physical representation advanced and preserved all 299 indexed Staff Moves, but three TeamIndex 255 coordinators with one contract year remaining became free agents instead of receiving coherent destination employment records. This treatment does not establish a pure volume failure; it exposes an unsupported candidate-state interaction that must be removed from the maximum-volume retest.'
  };
  fs.writeFileSync(path.join(directory, 'eos-evaluation.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
