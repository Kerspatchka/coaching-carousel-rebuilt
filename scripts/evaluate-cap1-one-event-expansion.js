/* Evaluate all three CAP-1 one-event expansion treatments after EOS. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, sha256
} = require('./prepare-bw3-selected-coach-swap');
const { isAmbient, isEmptyBookkeeping } = require('./evaluate-gate3-opening-topology-activation');
const { refRow } = require('./prepare-gate5-native-equivalent-plan');

const ROLE_FIELDS = {
  HeadCoach: 'HeadCoach',
  OffensiveCoordinator: 'OffensiveCoordinator',
  DefensiveCoordinator: 'DefensiveCoordinator'
};
const TRANSACTION_FIELDS = [
  'Coach', 'OldTeam', 'NewTeam', 'OldCoachPosition', 'NewCoachPosition',
  'TransactionId', 'SeasonStage', 'SeasonYear', 'SeasonWeek'
];

function parseArgs(argv) {
  const options = {
    directory: path.join(__dirname, '..', 'assets', 'experiments', 'capacity-policy', 'cap1-one-event-expansion'),
    output: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--directory') options.directory = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  options.directory = path.resolve(options.directory);
  options.output = options.output ? path.resolve(options.output) : path.join(options.directory, 'eos-evaluation.json');
  return options;
}

function fields(record) {
  return (record && record.fieldsArray || []).map((field) => field.key);
}

function transactionSlots(record) {
  return fields(record).filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function expectedLandscape(treatment) {
  const expected = new Map();
  for (const team of treatment.tables.teams.records.filter((record) => record && !record.isEmpty)) {
    for (const [role, field] of Object.entries(ROLE_FIELDS)) expected.set(`${team.index}|${role}`, team[field]);
  }
  for (const opening of treatment.tables.openings.records.filter((record) => record && !record.isEmpty)) {
    const teamRow = refRow(opening.Team);
    expected.set(`${teamRow}|${opening.Position}`, opening.SelectedCoach);
  }
  return expected;
}

function compareLandscape(treatment, eos, expected) {
  const differences = [];
  const employmentFailures = [];
  const seenCoaches = new Map();
  let rolesChecked = 0;
  for (const sourceTeam of treatment.tables.teams.records.filter((record) => record && !record.isEmpty)) {
    const eosTeam = eos.tables.teams.records[sourceTeam.index];
    for (const [role, field] of Object.entries(ROLE_FIELDS)) {
      rolesChecked += 1;
      const expectedReference = expected.get(`${sourceTeam.index}|${role}`);
      const actualReference = eosTeam[field];
      if (actualReference !== expectedReference) differences.push({
        teamRow: sourceTeam.index,
        team: displayName(sourceTeam),
        role,
        expectedCoachRow: refRow(expectedReference),
        expectedCoach: displayName(eos.tables.coaches.records[refRow(expectedReference)]),
        actualCoachRow: refRow(actualReference),
        actualCoach: displayName(eos.tables.coaches.records[refRow(actualReference)])
      });
      const coachRow = refRow(actualReference);
      if (coachRow !== null) {
        if (!seenCoaches.has(coachRow)) seenCoaches.set(coachRow, []);
        seenCoaches.get(coachRow).push({ teamRow: sourceTeam.index, role });
        const coach = eos.tables.coaches.records[coachRow];
        if (coach.TeamIndex !== eosTeam.TeamIndex || coach.Position !== role || !String(coach.ContractStatus).includes('Active')) {
          employmentFailures.push({
            teamRow: sourceTeam.index, team: displayName(eosTeam), role, coachRow, coach: displayName(coach),
            expectedTeamIndex: eosTeam.TeamIndex,
            actualTeamIndex: coach.TeamIndex,
            actualPosition: coach.Position,
            actualStatus: coach.ContractStatus
          });
        }
      }
    }
  }
  const duplicateAssignments = [...seenCoaches.entries()].filter(([, assignments]) => assignments.length > 1)
    .map(([coachRow, assignments]) => ({ coachRow, coach: displayName(eos.tables.coaches.records[coachRow]), assignments }));
  return { rolesChecked, differences, employmentFailures, duplicateAssignments };
}

function indexedTransactions(state) {
  const { coachTransactions, transactionArrays } = state.tables;
  const array = transactionArrays.records[0];
  const slots = transactionSlots(array).slice(0, transactionArrays.arraySizes[0]);
  return slots.map((field, slot) => {
    const row = refRow(array[field]);
    const record = row === null ? null : coachTransactions.records[row];
    return {
      slot,
      row,
      transactionId: record ? record.TransactionId : null,
      values: record ? Object.fromEntries(TRANSACTION_FIELDS.map((name) => [name, record[name]])) : null
    };
  });
}

function compareTransactions(treatment, eos) {
  const expected = indexedTransactions(treatment);
  const actual = indexedTransactions(eos);
  const mismatches = [];
  const length = Math.max(expected.length, actual.length);
  for (let slot = 0; slot < length; slot += 1) {
    const before = expected[slot] || null;
    const after = actual[slot] || null;
    if (JSON.stringify(before) !== JSON.stringify(after)) mismatches.push({ slot, expected: before, actual: after });
  }
  const positionalFailures = actual.filter((entry) => entry.row !== entry.slot + 1 || entry.transactionId !== entry.slot);
  return { indexedCount: actual.length, mismatches, positionalFailures };
}

function targetOutcome(eos, treatmentRecord) {
  const target = treatmentRecord.treatment;
  const { teams, coaches, coachTransactions, transactionArrays } = eos.tables;
  const donor = coaches.records[target.donorCoachRow];
  const nativeHire = coaches.records[target.nativeHireCoachRow];
  const destination = teams.records[target.destinationTeamRow];
  const source = teams.records[target.sourceTeamRow];
  const indexedReferences = new Set(transactionSlots(transactionArrays.records[0]).slice(0, transactionArrays.arraySizes[0])
    .map((field) => transactionArrays.records[0][field]));
  const existingTransaction = coachTransactions.records[target.existingTransactionRow];
  const newTransaction = coachTransactions.records[target.newTransactionRow];
  const donorHistory = {
    indexed: indexedReferences.has(coachTransactions.getBinaryReferenceToRecord(target.existingTransactionRow)),
    coachMatches: existingTransaction.Coach === coachReference(coaches, target.donorCoachRow),
    oldTeamMatches: existingTransaction.OldTeam === teams.getBinaryReferenceToRecord(target.sourceTeamRow),
    newTeamMatches: existingTransaction.NewTeam === teams.getBinaryReferenceToRecord(target.destinationTeamRow),
    actual: { coach: existingTransaction.Coach, oldTeam: existingTransaction.OldTeam, newTeam: existingTransaction.NewTeam }
  };
  const newHistory = {
    indexed: indexedReferences.has(coachTransactions.getBinaryReferenceToRecord(target.newTransactionRow)),
    coachMatches: newTransaction.Coach === coachReference(coaches, target.nativeHireCoachRow),
    oldTeamMatches: newTransaction.OldTeam === EMPTY_REF,
    newTeamMatches: newTransaction.NewTeam === teams.getBinaryReferenceToRecord(target.sourceTeamRow),
    transactionIdMatches: newTransaction.TransactionId === target.newTransactionId,
    actual: { coach: newTransaction.Coach, oldTeam: newTransaction.OldTeam, newTeam: newTransaction.NewTeam, transactionId: newTransaction.TransactionId }
  };
  const checks = {
    donorAssignedToDestination: destination[ROLE_FIELDS[target.role]] === coachReference(coaches, target.donorCoachRow),
    nativeFreeAgentAssignedToSource: source[ROLE_FIELDS[target.role]] === coachReference(coaches, target.nativeHireCoachRow),
    donorEmploymentCoherent: donor.TeamIndex === destination.TeamIndex && donor.PrevTeamIndex === source.TeamIndex && donor.Position === target.role && String(donor.ContractStatus).includes('Active'),
    nativeFreeAgentEmploymentCoherent: nativeHire.TeamIndex === source.TeamIndex && nativeHire.PrevTeamIndex === 255 && nativeHire.Position === target.role && String(nativeHire.ContractStatus).includes('Active'),
    donorHistoryVisible: donorHistory.indexed && donorHistory.coachMatches && donorHistory.oldTeamMatches && donorHistory.newTeamMatches,
    newHistoryVisible: newHistory.indexed && newHistory.coachMatches && newHistory.oldTeamMatches && newHistory.newTeamMatches && newHistory.transactionIdMatches
  };
  return {
    expected: treatmentRecord.expectedEos,
    donor: { row: target.donorCoachRow, name: displayName(donor), teamIndex: donor.TeamIndex, prevTeamIndex: donor.PrevTeamIndex, position: donor.Position, status: donor.ContractStatus },
    nativeFreeAgent: { row: target.nativeHireCoachRow, name: displayName(nativeHire), teamIndex: nativeHire.TeamIndex, prevTeamIndex: nativeHire.PrevTeamIndex, position: nativeHire.Position, status: nativeHire.ContractStatus },
    checks,
    donorHistory,
    newHistory
  };
}

function resolveTarget(treatment, treatmentRecord) {
  const recorded = treatmentRecord.treatment;
  const existingOpening = treatment.tables.openings.records[recorded.existingOpeningRow];
  const newOpening = treatment.tables.openings.records[recorded.newOpeningRow];
  return {
    ...treatmentRecord,
    treatment: {
      ...recorded,
      destinationTeamRow: refRow(existingOpening.Team),
      sourceTeamRow: refRow(newOpening.Team),
      donorCoachRow: refRow(existingOpening.SelectedCoach),
      nativeHireCoachRow: refRow(newOpening.SelectedCoach),
      existingTransactionRow: recorded.repurposedTransactionRow
    }
  };
}

function topology(state, target) {
  const { openings, offerArrays, coachTransactions, transactionArrays } = state.tables;
  return {
    activeOpenings: openings.records.filter((record) => record && !record.isEmpty).length,
    activeOfferArrays: offerArrays.records.filter((record) => record && !record.isEmpty).length,
    activeTransactions: coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    indexedTransactions: transactionArrays.arraySizes[0],
    addedOpeningIsEmpty: Boolean(openings.records[target.newOpeningRow].isEmpty),
    addedOfferArrayIsEmpty: Boolean(offerArrays.records[target.newOfferArrayRow].isEmpty),
    addedTransactionIsActive: !coachTransactions.records[target.newTransactionRow].isEmpty
  };
}

function compareNamedAndAutosave(named, autosave) {
  const before = focusedSnapshot(named.tables);
  const after = focusedSnapshot(autosave.tables);
  const changes = collectDifferences(before, after);
  const material = changes.filter((change) => !isAmbient(change) && !isEmptyBookkeeping(change, before, after));
  return { totalFocusedChanges: changes.length, materialFocusedChanges: material };
}

async function evaluateOne(directory, treatmentRecord, schema) {
  const number = treatmentRecord.fixture.slice(-1);
  const paths = {
    treatment: treatmentRecord.output,
    namedEos: path.join(directory, 'returned-eos', `DYNASTY-CCRCAP1E${number}`),
    autosaveEos: path.join(directory, 'returned-eos', `DYNASTY-CCRCAP1T${number}-AUTOSAVE`)
  };
  for (const [kind, file] of Object.entries(paths)) assert(fs.existsSync(file), `Missing ${kind}: ${file}`);
  const [treatment, named, autosave] = await Promise.all([
    loadExperimentState(paths.treatment, schema),
    loadExperimentState(paths.namedEos, schema),
    loadExperimentState(paths.autosaveEos, schema)
  ]);
  const resolvedTreatmentRecord = resolveTarget(treatment, treatmentRecord);
  const expected = expectedLandscape(treatment);
  const landscape = compareLandscape(treatment, named, expected);
  const transactions = compareTransactions(treatment, named);
  const outcome = targetOutcome(named, resolvedTreatmentRecord);
  const resultTopology = topology(named, resolvedTreatmentRecord.treatment);
  const namedAutosave = compareNamedAndAutosave(named, autosave);
  const expectedActiveTransactions = treatment.tables.coachTransactions.records.filter((record) => record && !record.isEmpty).length;
  const expectedIndexedTransactions = treatment.tables.transactionArrays.arraySizes[0];
  const checks = {
    completeLandscapeCommitted: landscape.differences.length === 0,
    employmentCrossReferencesCoherent: landscape.employmentFailures.length === 0,
    noDuplicateStaffAssignments: landscape.duplicateAssignments.length === 0,
    allIndexedHistoryPreserved: transactions.mismatches.length === 0,
    transactionIdentityPositional: transactions.positionalFailures.length === 0,
    targetCascadeCommitted: Object.values(outcome.checks).every(Boolean),
    addedTopologyConsumed: resultTopology.activeOpenings === 0 && resultTopology.activeOfferArrays === 0 && resultTopology.addedOpeningIsEmpty && resultTopology.addedOfferArrayIsEmpty,
    addedHistorySurvived: resultTopology.addedTransactionIsActive && resultTopology.activeTransactions === expectedActiveTransactions && resultTopology.indexedTransactions === expectedIndexedTransactions,
    namedAndAutosaveAgree: namedAutosave.materialFocusedChanges.length === 0
  };
  return {
    fixture: treatmentRecord.fixture,
    status: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
    files: Object.fromEntries(Object.entries(paths).map(([kind, file]) => [kind, { path: file, sha256: sha256(file) }])),
    checks,
    targetOutcome: outcome,
    landscape,
    transactions,
    topology: resultTopology,
    namedAutosaveComparison: namedAutosave
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const manifestPath = path.join(options.directory, 'experiment-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.experimentId === 'CAP-1' && manifest.treatments.length === 3, 'CAP-1 manifest is invalid.');
  const treatments = [];
  for (const treatment of manifest.treatments) treatments.push(await evaluateOne(options.directory, treatment, schema));
  const report = {
    experimentId: 'CAP-1',
    evaluatedAt: new Date().toISOString(),
    status: treatments.every((treatment) => treatment.status === 'passed') ? 'passed' : 'failed',
    sourceManifest: { path: manifestPath, sha256: sha256(manifestPath) },
    treatments,
    conclusion: treatments.every((treatment) => treatment.status === 'passed')
      ? 'All three save-specific allocator boundaries accepted one additional coherent opening and indexed Staff Moves event at EOS.'
      : 'At least one save-specific allocator expansion failed; inspect the per-treatment checks before drawing a capacity conclusion.'
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(options.output, json);
  process.stdout.write(json);
  if (report.status !== 'passed') process.exitCode = 1;
}

module.exports = {
  compareLandscape,
  compareNamedAndAutosave,
  compareTransactions,
  expectedLandscape,
  resolveTarget,
  targetOutcome,
  topology,
  transactionSlots
};

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}
