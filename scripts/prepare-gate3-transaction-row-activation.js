/* Gate 3A: relocate one native transaction into a newly activated empty row. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  assert, collectDifferences, focusedSnapshot, getValue,
  loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const SOURCE_ROW = 62;
const NEW_ROW = 125;
const NEW_TRANSACTION_ID = 124;

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate3-transaction-row-activation')
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
function slots(record) {
  return (record.fieldsArray || []).map((field) => field.key)
    .filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}
function validateBaseline(state) {
  const { coachTransactions, transactionArrays } = state.tables;
  assert(coachTransactions.header.nextRecordToUse === NEW_ROW, `Expected next transaction row ${NEW_ROW}, found ${coachTransactions.header.nextRecordToUse}.`);
  assert(!coachTransactions.records[SOURCE_ROW].isEmpty, 'Source transaction is empty.');
  assert(coachTransactions.records[NEW_ROW].isEmpty, 'Target transaction row is not empty.');
  assert(getValue(coachTransactions.records[SOURCE_ROW], ['TransactionId']) === 61, 'Unexpected source transaction ID.');
  assert(transactionArrays.arraySizes[0] === 124, 'Expected transaction array size 124.');
  const used = slots(transactionArrays.records[0]).slice(0, 124);
  const sourceReference = coachTransactions.getBinaryReferenceToRecord(SOURCE_ROW);
  assert(used.filter((field) => transactionArrays.records[0][field] === sourceReference).length === 1, 'Source transaction must be indexed exactly once.');
  assert(!used.some((field) => transactionArrays.records[0][field] === coachTransactions.getBinaryReferenceToRecord(NEW_ROW)), 'Target transaction is already indexed.');
  const activeIds = coachTransactions.records.filter((record) => record && !record.isEmpty).map((record) => getValue(record, ['TransactionId']));
  assert(!activeIds.includes(NEW_TRANSACTION_ID), `Transaction ID ${NEW_TRANSACTION_ID} is already active.`);
}
function applyTreatment(state) {
  const { coachTransactions, transactionArrays } = state.tables;
  const source = coachTransactions.records[SOURCE_ROW];
  const target = coachTransactions.records[NEW_ROW];
  for (const field of source.fieldsArray) target[field.key] = source[field.key];
  target.TransactionId = NEW_TRANSACTION_ID;
  const array = transactionArrays.records[0];
  const sourceReference = coachTransactions.getBinaryReferenceToRecord(SOURCE_ROW);
  const targetReference = coachTransactions.getBinaryReferenceToRecord(NEW_ROW);
  const field = slots(array).slice(0, transactionArrays.arraySizes[0]).find((key) => array[key] === sourceReference);
  assert(field, 'Source transaction array slot was not found.');
  array[field] = targetReference;
}
function validateTreatment(state, before) {
  const { coachTransactions, transactionArrays } = state.tables;
  const source = coachTransactions.records[SOURCE_ROW];
  const target = coachTransactions.records[NEW_ROW];
  assert(!source.isEmpty && !target.isEmpty, 'Both source and relocated transactions must remain active before EOS.');
  assert(coachTransactions.header.nextRecordToUse === NEW_ROW + 1, `Expected next transaction row ${NEW_ROW + 1}, found ${coachTransactions.header.nextRecordToUse}.`);
  for (const field of source.fieldsArray) {
    if (field.key === 'TransactionId') continue;
    assert(JSON.stringify(target[field.key]) === JSON.stringify(source[field.key]), `Relocated transaction field mismatch: ${field.key}`);
  }
  assert(target.TransactionId === NEW_TRANSACTION_ID, 'Relocated transaction ID mismatch.');
  assert(coachTransactions.records.filter((record) => record && !record.isEmpty).length === 126, 'Expected 126 active transaction records.');
  assert(transactionArrays.arraySizes[0] === 124, 'Transaction array size must remain 124.');
  const indexed = slots(transactionArrays.records[0]).slice(0, 124).map((field) => transactionArrays.records[0][field]);
  assert(!indexed.includes(coachTransactions.getBinaryReferenceToRecord(SOURCE_ROW)), 'Source row remains indexed.');
  assert(indexed.includes(coachTransactions.getBinaryReferenceToRecord(NEW_ROW)), 'Relocated row is not indexed.');
  const after = focusedSnapshot(state.tables);
  const differences = collectDifferences(before, after);
  const unexpected = differences.filter((change) => {
    if (change.table === 'coachTransactions' && change.row === NEW_ROW) return false;
    if (change.table === 'transactionArrays' && change.row === 0) return false;
    if (change.row !== undefined && change.field !== '$record' && before[change.table].records[change.row].isEmpty && after[change.table].records[change.row].isEmpty) return false;
    return true;
  });
  assert(unexpected.length === 0, `Unexpected semantic changes: ${unexpected.map((change) => `${change.table}:${change.row}:${change.field}`).join(', ')}`);
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
  const output = path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G3A-TXROW');
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  if (!options.write) {
    process.stdout.write(`${JSON.stringify({ mode: 'preview', source: options.source, output }, null, 2)}\n`);
    return;
  }
  assert(!fs.existsSync(output) && !fs.existsSync(manifestPath), 'Refusing to overwrite Gate 3A output.');
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const temporary = `${output}.tmp`;
  const treatment = await loadExperimentState(options.source, schema);
  applyTreatment(treatment);
  await saveToTemporary(treatment.franchise, temporary);
  const reopened = await loadExperimentState(temporary, schema);
  const differences = validateTreatment(reopened, before);
  fs.renameSync(temporary, output);
  const manifest = {
    preparedAt: new Date().toISOString(), source: options.source, sourceSha256: SOURCE_HASH,
    output, outputSha256: sha256(output), schema: baseline.declaredSchema,
    purpose: 'Prove that a previously empty CoachTransactionHistoryEntry row can be activated, indexed, loaded, and consumed at EOS.',
    treatment: { sourceRow: SOURCE_ROW, newRow: NEW_ROW, transactionId: NEW_TRANSACTION_ID, arraySize: 124 },
    differences, preAdvanceValidation: 'passed',
    expectedEos: 'Native Auburn outcome remains M. Payne; row 62 becomes empty because it is unindexed; row 125 remains active and indexed as the equivalent Payne hire.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
