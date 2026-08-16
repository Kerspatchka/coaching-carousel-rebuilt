/* Gate 2: replace Auburn's native M. Payne hire with free agent B. Bausby. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const TARGET = { openingRow: 22, transactionRow: 62, teamRow: 9, durkinRow: 128, payneRow: 495, bausbyRow: 451 };

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate2-hire-bausby')
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--write') options.write = true;
    else if (argv[index] === '--source') options.source = argv[++index];
    else if (argv[index] === '--output-dir') options.outputDirectory = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  options.source = path.resolve(options.source);
  options.outputDirectory = path.resolve(options.outputDirectory);
  return options;
}
function transactionSlots(record) {
  return (record.fieldsArray || []).map((field) => field.key).filter((field) => /^TransactionHistoryEntry\d+$/.test(field));
}
function validateBaseline(state) {
  const { openings, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  const opening = openings.records[TARGET.openingRow];
  const transaction = coachTransactions.records[TARGET.transactionRow];
  assert(openings.records.filter((record) => record && !record.isEmpty).length === 192, 'Expected BW3 with 192 openings.');
  assert(displayName(teams.records[TARGET.teamRow]) === 'Auburn', 'Auburn Team row mismatch.');
  assert(displayName(coaches.records[TARGET.durkinRow]) === 'D. Durkin', 'D. Durkin row mismatch.');
  assert(displayName(coaches.records[TARGET.payneRow]) === 'M. Payne', 'M. Payne row mismatch.');
  assert(displayName(coaches.records[TARGET.bausbyRow]) === 'B. Bausby', 'B. Bausby row mismatch.');
  assert(getValue(opening, ['SelectedCoach']) === coachReference(coaches, TARGET.payneRow), 'Native Auburn selection is not M. Payne.');
  assert(getValue(opening, ['PrevCoach']) === coachReference(coaches, TARGET.durkinRow), 'Auburn prior coach is not D. Durkin.');
  assert(getValue(opening, ['Position']) === 'DefensiveCoordinator', 'Auburn opening role mismatch.');
  assert(getValue(coaches.records[TARGET.payneRow], ['ContractStatus']) === 'Last_Pending', 'M. Payne is not selected/pending.');
  assert(getValue(coaches.records[TARGET.bausbyRow], ['ContractStatus']) === 'FreeAgent', 'B. Bausby is not a free agent.');
  assert(getValue(coaches.records[TARGET.bausbyRow], ['TeamIndex']) === 255, 'B. Bausby is not in the free-agent pool.');
  assert(!openings.records.filter((record) => record && !record.isEmpty).some((record) => getValue(record, ['SelectedCoach']) === coachReference(coaches, TARGET.bausbyRow)), 'B. Bausby is already selected.');
  assert(getValue(transaction, ['Coach']) === coachReference(coaches, TARGET.payneRow), 'Native hire transaction is not owned by M. Payne.');
  assert(getValue(transaction, ['OldTeam']) === EMPTY_REF, 'Native hire transaction OldTeam is not empty.');
  assert(getValue(transaction, ['NewTeam']) === teams.getBinaryReferenceToRecord(TARGET.teamRow), 'Native hire transaction destination is not Auburn.');
  assert(getValue(transaction, ['NewCoachPosition']) === 'DefensiveCoordinator', 'Native hire transaction role mismatch.');
  assert(getValue(transaction, ['ContractStatus']) === 'Last_Pending', 'Native hire transaction status mismatch.');
  assert(transactionArrays.arraySizes[0] === 124, 'Expected transaction array size 124.');
  const indexed = transactionSlots(transactionArrays.records[0]).slice(0, 124).map((field) => transactionArrays.records[0][field]);
  assert(indexed.includes(coachTransactions.getBinaryReferenceToRecord(TARGET.transactionRow)), 'Hire transaction is not indexed.');
}
function applyTreatment(state) {
  const { openings, coaches, coachTransactions } = state.tables;
  openings.records[TARGET.openingRow].SelectedCoach = coachReference(coaches, TARGET.bausbyRow);
  coaches.records[TARGET.bausbyRow].ContractStatus = 'Last_Pending';
  coaches.records[TARGET.payneRow].ContractStatus = 'FreeAgent';
  coachTransactions.records[TARGET.transactionRow].Coach = coachReference(coaches, TARGET.bausbyRow);
}
function validateTreatment(state, baselineSnapshot) {
  const { openings, coaches, coachTransactions, transactionArrays } = state.tables;
  assert(getValue(openings.records[TARGET.openingRow], ['SelectedCoach']) === coachReference(coaches, TARGET.bausbyRow), 'B. Bausby selection did not persist.');
  assert(getValue(coaches.records[TARGET.bausbyRow], ['ContractStatus']) === 'Last_Pending', 'B. Bausby pending state did not persist.');
  assert(getValue(coaches.records[TARGET.payneRow], ['ContractStatus']) === 'FreeAgent', 'M. Payne free-agent state did not persist.');
  assert(getValue(coachTransactions.records[TARGET.transactionRow], ['Coach']) === coachReference(coaches, TARGET.bausbyRow), 'B. Bausby transaction ownership did not persist.');
  assert(coachTransactions.records.filter((record) => record && !record.isEmpty).length === 125, 'Treatment changed active transaction count.');
  assert(transactionArrays.arraySizes[0] === 124, 'Treatment changed transaction array size.');
  const differences = collectDifferences(baselineSnapshot, focusedSnapshot(state.tables));
  const allowed = new Set([
    'openings:22:SelectedCoach', 'coaches:451:ContractStatus',
    'coaches:495:ContractStatus', 'coachTransactions:62:Coach'
  ]);
  const actual = new Set(differences.map((change) => `${change.table}:${change.row}:${change.field}`));
  assert(differences.length === allowed.size, `Expected ${allowed.size} semantic changes, found ${differences.length}.`);
  assert([...actual].every((key) => allowed.has(key)), `Unexpected changes: ${[...actual].filter((key) => !allowed.has(key)).join(', ')}`);
  assert([...allowed].every((key) => actual.has(key)), 'One or more required changes are missing.');
  return differences;
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(fs.existsSync(options.source) && sha256(options.source) === SOURCE_HASH, 'Source BW3 fixture mismatch.');
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const baseline = await loadExperimentState(options.source, schema);
  validateBaseline(baseline);
  const baselineSnapshot = focusedSnapshot(baseline.tables);
  const output = path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G2-BAUSBY');
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  if (!options.write) {
    process.stdout.write(`${JSON.stringify({ mode: 'preview', source: options.source, output }, null, 2)}\n`);
    return;
  }
  assert(!fs.existsSync(output) && !fs.existsSync(manifestPath), 'Refusing to overwrite Gate 2 output.');
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const temporary = `${output}.tmp`;
  const treatment = await loadExperimentState(options.source, schema);
  applyTreatment(treatment);
  await saveToTemporary(treatment.franchise, temporary);
  const reopened = await loadExperimentState(temporary, schema);
  const differences = validateTreatment(reopened, baselineSnapshot);
  fs.renameSync(temporary, output);
  const manifest = {
    preparedAt: new Date().toISOString(), source: options.source, sourceSha256: SOURCE_HASH,
    output, outputSha256: sha256(output), schema: baseline.declaredSchema,
    treatment: 'Replace native Auburn DC hire M. Payne with previously unselected free agent B. Bausby.',
    differences, preAdvanceValidation: 'passed',
    nextAction: 'Confirm the save loads at BW3, advance once to EOS, and inspect Auburn staff plus Durkin/Bausby/Payne Staff Moves.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
