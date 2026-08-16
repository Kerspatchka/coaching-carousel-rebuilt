/* E2: combine the proven Auburn DC replacement with an authoritative final price. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const TARGET = {
  openingRow: 22, transactionRow: 62, teamRow: 9,
  durkinRow: 128, payneRow: 495, bausbyRow: 451,
  nativeFinalPoints: 0, ccrFinalPoints: 25
};

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-e2-coordinator-recost')
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
  return (record.fieldsArray || []).map((field) => field.key).filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function validateBaseline(state) {
  const { openings, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  const opening = openings.records[TARGET.openingRow];
  const transaction = coachTransactions.records[TARGET.transactionRow];
  assert(displayName(teams.records[TARGET.teamRow]) === 'Auburn', 'Auburn Team row mismatch.');
  assert(displayName(coaches.records[TARGET.durkinRow]) === 'D. Durkin', 'D. Durkin row mismatch.');
  assert(displayName(coaches.records[TARGET.payneRow]) === 'M. Payne', 'M. Payne row mismatch.');
  assert(displayName(coaches.records[TARGET.bausbyRow]) === 'B. Bausby', 'B. Bausby row mismatch.');
  assert(getValue(opening, ['Team']) === teams.getBinaryReferenceToRecord(TARGET.teamRow), 'Auburn opening Team mismatch.');
  assert(getValue(opening, ['Position']) === 'DefensiveCoordinator', 'Auburn opening role mismatch.');
  assert(getValue(opening, ['SelectedCoach']) === coachReference(coaches, TARGET.payneRow), 'Native Auburn selection is not M. Payne.');
  assert(getValue(opening, ['PrevCoach']) === coachReference(coaches, TARGET.durkinRow), 'Auburn prior coach is not D. Durkin.');
  assert(getValue(opening, ['FinalContractProgramPoints']) === TARGET.nativeFinalPoints, 'Unexpected native final price.');
  assert(getValue(coaches.records[TARGET.payneRow], ['ContractStatus']) === 'Last_Pending', 'M. Payne is not pending.');
  assert(getValue(coaches.records[TARGET.bausbyRow], ['ContractStatus']) === 'FreeAgent', 'B. Bausby is not a free agent.');
  assert(getValue(transaction, ['Coach']) === coachReference(coaches, TARGET.payneRow), 'Native transaction is not owned by M. Payne.');
  assert(getValue(transaction, ['OldTeam']) === EMPTY_REF, 'Native transaction OldTeam is not empty.');
  assert(getValue(transaction, ['NewTeam']) === teams.getBinaryReferenceToRecord(TARGET.teamRow), 'Native transaction destination is not Auburn.');
  assert(getValue(transaction, ['NewCoachPosition']) === 'DefensiveCoordinator', 'Native transaction role mismatch.');
  assert(transactionArrays.arraySizes[0] === 124, 'Unexpected transaction-array size.');
  const slots = transactionSlots(transactionArrays.records[0]).slice(0, 124);
  const slot = slots.findIndex((field) => transactionArrays.records[0][field] === coachTransactions.getBinaryReferenceToRecord(TARGET.transactionRow));
  assert(slot === TARGET.transactionRow - 1, 'Transaction 62 does not occupy its required positional identity.');
  assert(transaction.TransactionId === slot, 'TransactionId does not match its array slot.');
}

function applyTreatment(state) {
  const { openings, coaches, coachTransactions } = state.tables;
  openings.records[TARGET.openingRow].SelectedCoach = coachReference(coaches, TARGET.bausbyRow);
  openings.records[TARGET.openingRow].FinalContractProgramPoints = TARGET.ccrFinalPoints;
  coaches.records[TARGET.bausbyRow].ContractStatus = 'Last_Pending';
  coaches.records[TARGET.payneRow].ContractStatus = 'FreeAgent';
  coachTransactions.records[TARGET.transactionRow].Coach = coachReference(coaches, TARGET.bausbyRow);
}

function validateTreatment(state, baselineSnapshot) {
  const { openings, coaches, coachTransactions, transactionArrays } = state.tables;
  assert(getValue(openings.records[TARGET.openingRow], ['SelectedCoach']) === coachReference(coaches, TARGET.bausbyRow), 'B. Bausby selection did not persist.');
  assert(getValue(openings.records[TARGET.openingRow], ['FinalContractProgramPoints']) === TARGET.ccrFinalPoints, 'CCR final price did not persist.');
  assert(getValue(coaches.records[TARGET.bausbyRow], ['ContractStatus']) === 'Last_Pending', 'B. Bausby pending state did not persist.');
  assert(getValue(coaches.records[TARGET.payneRow], ['ContractStatus']) === 'FreeAgent', 'M. Payne free-agent state did not persist.');
  assert(getValue(coachTransactions.records[TARGET.transactionRow], ['Coach']) === coachReference(coaches, TARGET.bausbyRow), 'Transaction ownership did not persist.');
  assert(transactionArrays.arraySizes[0] === 124, 'Treatment changed transaction-array size.');
  const slots = transactionSlots(transactionArrays.records[0]).slice(0, 124);
  assert(transactionArrays.records[0][slots[61]] === coachTransactions.getBinaryReferenceToRecord(62), 'Treatment broke transaction positional identity.');
  assert(coachTransactions.records[62].TransactionId === 61, 'Treatment changed TransactionId 61.');

  const differences = collectDifferences(baselineSnapshot, focusedSnapshot(state.tables));
  const allowed = new Set([
    'openings:22:SelectedCoach', 'openings:22:FinalContractProgramPoints',
    'coaches:451:ContractStatus', 'coaches:495:ContractStatus', 'coachTransactions:62:Coach'
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
  const before = focusedSnapshot(baseline.tables);
  const output = path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-E2-DC25');
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  if (!options.write) {
    process.stdout.write(`${JSON.stringify({ mode: 'preview', source: options.source, output, treatment: TARGET }, null, 2)}\n`);
    return;
  }
  assert(!fs.existsSync(output) && !fs.existsSync(manifestPath), 'Refusing to overwrite E2 output.');
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const temporary = `${output}.tmp`;
  const treatment = await loadExperimentState(options.source, schema);
  applyTreatment(treatment);
  await saveToTemporary(treatment.franchise, temporary);
  const reopened = await loadExperimentState(temporary, schema);
  const differences = validateTreatment(reopened, before);
  fs.renameSync(temporary, output);
  const manifest = {
    experimentId: 'E2', preparedAt: new Date().toISOString(), source: options.source,
    sourceSha256: SOURCE_HASH, schema: baseline.declaredSchema, output, outputSha256: sha256(output),
    treatment: 'Replace Auburn native DC hire M. Payne with free agent B. Bausby and price the resolved DC opening at 25 program points.',
    financialMutation: { openingRow: 22, field: 'FinalContractProgramPoints', from: 0, to: 25, teamAggregatesWritten: false },
    expectedEos: {
      employment: 'Auburn hires B. Bausby at DC; M. Payne remains a free agent; D. Durkin remains fired.',
      staffMoves: 'Transaction row 62 records B. Bausby from the free-agent pool to Auburn as DC.',
      financesVsGate2: 'Auburn DC budget and staff spending increase by 25, remaining points decrease by 25, and the staff pool plus unrelated budget fields remain unchanged.'
    },
    differences, preAdvanceValidation: 'passed',
    humanSteps: 'Load the live E2 save at BW3, advance once to EOS, visually confirm the Auburn DC move in Staff Moves, then create a named save.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { TARGET, applyTreatment, validateBaseline, validateTreatment };
