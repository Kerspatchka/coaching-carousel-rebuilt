/*
 * Gate 1 revision: retain D. Durkin without emptying records.
 * CORE leaves native history indexed; HIDE removes its two array references
 * while leaving the transaction records active to isolate game loadability.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, focusedSnapshot,
  getValue, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const OPENING_ROW = 22;
const DURKIN_ROW = 128;
const PAYNE_ROW = 495;
const TRANSACTION_ROWS = [22, 62];

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate1-retain-auburn-dc-v2')
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--write') options.write = true;
    else if (item === '--source') options.source = argv[++index];
    else if (item === '--output-dir') options.outputDirectory = argv[++index];
    else throw new Error(`Unknown argument: ${item}`);
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
  const { openings, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  assert(openings.records.filter((record) => record && !record.isEmpty).length === 192, 'Expected BW3 with 192 openings.');
  assert(getValue(openings.records[OPENING_ROW], ['SelectedCoach']) === coachReference(coaches, PAYNE_ROW), 'Auburn native selection is not M. Payne.');
  assert(getValue(openings.records[OPENING_ROW], ['PrevCoach']) === coachReference(coaches, DURKIN_ROW), 'Auburn prior DC is not D. Durkin.');
  assert(getValue(teams.records[9], ['DefensiveCoordinator']) === coachReference(coaches, DURKIN_ROW), 'Auburn committed staff baseline is not D. Durkin.');
  assert(getValue(coaches.records[DURKIN_ROW], ['ContractStatus']) === 'First_Pending', 'Unexpected D. Durkin BW3 status.');
  assert(getValue(coaches.records[PAYNE_ROW], ['ContractStatus']) === 'Last_Pending', 'Unexpected M. Payne BW3 status.');
  assert(coachTransactions.records.filter((record) => record && !record.isEmpty).length === 125, 'Expected 125 active transactions.');
  assert(transactionArrays.arraySizes[0] === 124, 'Expected transaction array size 124.');
  const indexed = slots(transactionArrays.records[0]).slice(0, 124).map((field) => transactionArrays.records[0][field]);
  for (const row of TRANSACTION_ROWS) assert(indexed.includes(coachTransactions.getBinaryReferenceToRecord(row)), `Transaction ${row} is not indexed.`);
}

function applyCore(state) {
  state.tables.openings.records[OPENING_ROW].SelectedCoach = coachReference(state.tables.coaches, DURKIN_ROW);
  state.tables.coaches.records[DURKIN_ROW].ContractStatus = 'First_Active';
  state.tables.coaches.records[PAYNE_ROW].ContractStatus = 'FreeAgent';
}

function hideCanceledHistory(state) {
  const { coachTransactions, transactionArrays } = state.tables;
  const record = transactionArrays.records[0];
  const fields = slots(record);
  const used = transactionArrays.arraySizes[0];
  const removed = new Set(TRANSACTION_ROWS.map((row) => coachTransactions.getBinaryReferenceToRecord(row)));
  const retained = fields.slice(0, used).map((field) => record[field]).filter((reference) => !removed.has(reference));
  assert(retained.length === 122, 'Expected 122 retained transaction references.');
  for (let index = 0; index < fields.length; index += 1) record[fields[index]] = index < retained.length ? retained[index] : EMPTY_REF;
  record.arraySize = retained.length;
  transactionArrays.arraySizes[0] = retained.length;
}

function validateTreatment(state, sourceSnapshot, hideHistory) {
  const { openings, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  assert(openings.records.filter((record) => record && !record.isEmpty).length === 192, 'Treatment must retain all 192 opening records.');
  assert(getValue(openings.records[OPENING_ROW], ['SelectedCoach']) === coachReference(coaches, DURKIN_ROW), 'D. Durkin was not selected for retention.');
  assert(getValue(teams.records[9], ['DefensiveCoordinator']) === coachReference(coaches, DURKIN_ROW), 'Auburn Team staff changed before EOS.');
  assert(getValue(coaches.records[DURKIN_ROW], ['ContractStatus']) === 'First_Active', 'D. Durkin status reset failed.');
  assert(getValue(coaches.records[PAYNE_ROW], ['ContractStatus']) === 'FreeAgent', 'M. Payne status reset failed.');
  assert(coachTransactions.records.filter((record) => record && !record.isEmpty).length === 125, 'Treatment must not empty transaction records.');
  for (const row of TRANSACTION_ROWS) assert(!coachTransactions.records[row].isEmpty, `Transaction ${row} was emptied.`);
  const selected = new Set();
  for (const opening of openings.records.filter((record) => record && !record.isEmpty)) {
    const reference = getValue(opening, ['SelectedCoach'], EMPTY_REF);
    assert(reference !== EMPTY_REF && !selected.has(reference), `Invalid or duplicate selection at opening ${opening.index}.`);
    selected.add(reference);
  }
  assert(!selected.has(coachReference(coaches, PAYNE_ROW)), 'M. Payne remains selected.');
  const size = transactionArrays.arraySizes[0];
  assert(size === (hideHistory ? 122 : 124), `Unexpected transaction array size ${size}.`);
  const indexed = slots(transactionArrays.records[0]).slice(0, size).map((field) => transactionArrays.records[0][field]);
  for (const row of TRANSACTION_ROWS) assert(indexed.includes(coachTransactions.getBinaryReferenceToRecord(row)) !== hideHistory, `Transaction ${row} index state is incorrect.`);
  const differences = collectDifferences(sourceSnapshot, focusedSnapshot(state.tables));
  const allowed = new Set(['openings:22:SelectedCoach', 'coaches:128:ContractStatus', 'coaches:495:ContractStatus']);
  for (const change of differences) {
    const key = `${change.table}:${change.row}:${change.field}`;
    if (hideHistory && change.table === 'transactionArrays' && (change.row === 0 || change.field === '$arraySizes')) continue;
    assert(allowed.has(key), `Unexpected treatment change: ${key}`);
  }
  for (const key of allowed) assert(differences.some((change) => `${change.table}:${change.row}:${change.field}` === key), `Missing change: ${key}`);
  return differences;
}

function ensureAbsent(paths) { for (const filePath of Object.values(paths)) assert(!fs.existsSync(filePath), `Refusing to overwrite ${filePath}`); }

async function writeRoundTrip(source, destination, schema, mutate, validate) {
  const temporary = `${destination}.tmp`;
  const state = await loadExperimentState(source, schema);
  if (mutate) mutate(state);
  await saveToTemporary(state.franchise, temporary);
  const reopened = await loadExperimentState(temporary, schema);
  const result = validate(reopened);
  fs.renameSync(temporary, destination);
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(fs.existsSync(options.source) && sha256(options.source) === SOURCE_HASH, 'Source BW3 fixture mismatch.');
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const baseline = await loadExperimentState(options.source, schema);
  validateBaseline(baseline);
  const sourceSnapshot = focusedSnapshot(baseline.tables);
  const arms = {
    control: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G1R-CONTROL'),
    sham: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G1R-SHAM'),
    core: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G1R-CORE-RETAIN'),
    hidden: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G1R-HIDE-HISTORY')
  };
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  const plan = { mode: options.write ? 'write' : 'preview', source: options.source, sourceSha256: SOURCE_HASH, schema: baseline.declaredSchema, arms };
  if (!options.write) { process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`); return; }
  ensureAbsent({ ...arms, manifestPath, ...Object.fromEntries(Object.entries(arms).filter(([key]) => key !== 'control').map(([key, value]) => [`${key}Temporary`, `${value}.tmp`])) });
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  fs.copyFileSync(options.source, arms.control);
  const shamDifferences = await writeRoundTrip(options.source, arms.sham, schema, null, (state) => {
    validateBaseline(state);
    const differences = collectDifferences(sourceSnapshot, focusedSnapshot(state.tables));
    assert(differences.length === 0, 'Sham introduced semantic changes.');
    return differences;
  });
  const coreDifferences = await writeRoundTrip(options.source, arms.core, schema, applyCore, (state) => validateTreatment(state, sourceSnapshot, false));
  const hiddenDifferences = await writeRoundTrip(options.source, arms.hidden, schema, (state) => { applyCore(state); hideCanceledHistory(state); }, (state) => validateTreatment(state, sourceSnapshot, true));
  const manifest = {
    ...plan, mode: 'write', createdAt: new Date().toISOString(),
    hashes: Object.fromEntries(Object.entries(arms).map(([key, filePath]) => [key, sha256(filePath)])),
    treatments: {
      core: 'Select D. Durkin, restore Durkin active and Payne free-agent status; leave both native transaction rows and index entries intact.',
      hidden: 'Apply core treatment, then remove the two native movement references from the transaction array without emptying their records.'
    },
    preAdvanceValidation: { shamDifferences, coreDifferences, hiddenDifferences, status: 'passed' },
    nextAction: 'Human first confirms each arm loads at BW3. Advance loadable arms once to EOS under distinct names.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
