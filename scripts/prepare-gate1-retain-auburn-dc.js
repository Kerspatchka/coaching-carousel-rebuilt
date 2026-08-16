/* Prepare Gate 1: cancel Auburn's native DC firing/hire and retain D. Durkin. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF,
  assert,
  coachReference,
  collectDifferences,
  displayName,
  focusedSnapshot,
  getValue,
  loadExperimentState,
  saveToTemporary,
  sha256
} = require('./prepare-bw3-selected-coach-swap');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const OPENING_ROW = 22;
const AUBURN_TEAM_ROW = 9;
const DURKIN_ROW = 128;
const PAYNE_ROW = 495;
const TRANSACTION_ROWS = [22, 62];

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate1-retain-auburn-dc')
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

function transactionSlotFields(record) {
  return (record.fieldsArray || []).map((field) => field.key)
    .filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function baselineDetails(state) {
  const { openings, coachTransactions, transactionArrays, coaches, teams } = state.tables;
  const opening = openings.records[OPENING_ROW];
  const auburn = teams.records[AUBURN_TEAM_ROW];
  const durkin = coaches.records[DURKIN_ROW];
  const payne = coaches.records[PAYNE_ROW];
  const arrayRecord = transactionArrays.records[0];
  const slots = transactionSlotFields(arrayRecord);
  const used = transactionArrays.arraySizes[0];
  assert(openings.records.filter((record) => record && !record.isEmpty).length === 192, 'Expected 192 active BW3 openings.');
  assert(opening && !opening.isEmpty, 'Auburn DC opening is missing.');
  assert(displayName(auburn) === 'Auburn', 'Unexpected Team row 9.');
  assert(displayName(durkin) === 'D. Durkin', 'Unexpected Coach row 128.');
  assert(displayName(payne) === 'M. Payne', 'Unexpected Coach row 495.');
  assert(getValue(auburn, ['DefensiveCoordinator']) === coachReference(coaches, DURKIN_ROW), 'Auburn committed DC baseline is not D. Durkin.');
  assert(getValue(opening, ['Team']) === teams.getBinaryReferenceToRecord(AUBURN_TEAM_ROW), 'Auburn opening Team mismatch.');
  assert(getValue(opening, ['PrevCoach']) === coachReference(coaches, DURKIN_ROW), 'Auburn opening previous coach mismatch.');
  assert(getValue(opening, ['SelectedCoach']) === coachReference(coaches, PAYNE_ROW), 'Auburn native selected coach mismatch.');
  assert(getValue(opening, ['Position']) === 'DefensiveCoordinator', 'Auburn opening role mismatch.');
  assert(getValue(opening, ['Reason']) === 'Fired', 'Auburn opening reason mismatch.');
  assert(getValue(durkin, ['ContractStatus']) === 'First_Pending', 'D. Durkin is not First_Pending at BW3.');
  assert(getValue(payne, ['ContractStatus']) === 'Last_Pending', 'M. Payne is not Last_Pending at BW3.');
  assert(arrayRecord && !arrayRecord.isEmpty, 'Transaction history array is missing.');
  assert(used === 124, `Expected transaction array size 124, found ${used}.`);
  assert(slots.length >= used, 'Transaction array has fewer fields than its array size.');
  const usedRefs = slots.slice(0, used).map((field) => arrayRecord[field]);
  for (const row of TRANSACTION_ROWS) {
    const record = coachTransactions.records[row];
    assert(record && !record.isEmpty, `Transaction row ${row} is missing.`);
    const reference = coachTransactions.getBinaryReferenceToRecord(row);
    assert(usedRefs.includes(reference), `Transaction row ${row} is not in the Staff Moves array.`);
  }
  assert(getValue(coachTransactions.records[22], ['Coach']) === coachReference(coaches, DURKIN_ROW), 'D. Durkin firing transaction mismatch.');
  assert(getValue(coachTransactions.records[62], ['Coach']) === coachReference(coaches, PAYNE_ROW), 'M. Payne hiring transaction mismatch.');
  return {
    activeOpenings: 192,
    activeTransactions: coachTransactions.records.filter((record) => record && !record.isEmpty).length,
    transactionArraySize: used,
    opening: { row: OPENING_ROW, team: 'Auburn', role: 'DefensiveCoordinator', previousCoach: 'D. Durkin', selectedCoach: 'M. Payne', reason: 'Fired' },
    removedTransactions: [
      { row: 22, coach: 'D. Durkin', oldTeam: 'Auburn', newTeam: null },
      { row: 62, coach: 'M. Payne', oldTeam: null, newTeam: 'Auburn' }
    ],
    coachStatusReset: [
      { row: DURKIN_ROW, coach: 'D. Durkin', from: 'First_Pending', to: 'First_Active' },
      { row: PAYNE_ROW, coach: 'M. Payne', from: 'Last_Pending', to: 'FreeAgent' }
    ]
  };
}

function applyTreatment(state) {
  const { openings, coachTransactions, transactionArrays, coaches } = state.tables;
  openings.records[OPENING_ROW].empty();
  coaches.records[DURKIN_ROW].ContractStatus = 'First_Active';
  coaches.records[PAYNE_ROW].ContractStatus = 'FreeAgent';

  const arrayRecord = transactionArrays.records[0];
  const slots = transactionSlotFields(arrayRecord);
  const used = transactionArrays.arraySizes[0];
  const removedRefs = new Set(TRANSACTION_ROWS.map((row) => coachTransactions.getBinaryReferenceToRecord(row)));
  const retainedRefs = slots.slice(0, used).map((field) => arrayRecord[field]).filter((reference) => !removedRefs.has(reference));
  assert(retainedRefs.length === used - TRANSACTION_ROWS.length, 'Unexpected transaction-array removal count.');
  for (let index = 0; index < slots.length; index += 1) arrayRecord[slots[index]] = index < retainedRefs.length ? retainedRefs[index] : EMPTY_REF;
  arrayRecord.arraySize = retainedRefs.length;
  transactionArrays.arraySizes[0] = retainedRefs.length;
  for (const row of TRANSACTION_ROWS) coachTransactions.records[row].empty();
}

function validateTreatment(state, sourceSnapshot) {
  const { openings, coachTransactions, transactionArrays, coaches, teams } = state.tables;
  assert(openings.records[OPENING_ROW].isEmpty, 'Auburn opening was not removed.');
  assert(openings.records.filter((record) => record && !record.isEmpty).length === 191, 'Expected 191 active openings after cancellation.');
  assert(getValue(teams.records[AUBURN_TEAM_ROW], ['DefensiveCoordinator']) === coachReference(coaches, DURKIN_ROW), 'Auburn Team staff changed before EOS.');
  assert(getValue(coaches.records[DURKIN_ROW], ['ContractStatus']) === 'First_Active', 'D. Durkin status reset did not persist.');
  assert(getValue(coaches.records[PAYNE_ROW], ['ContractStatus']) === 'FreeAgent', 'M. Payne status reset did not persist.');
  for (const row of TRANSACTION_ROWS) assert(coachTransactions.records[row].isEmpty, `Transaction row ${row} was not emptied.`);
  const selected = new Set();
  for (const opening of openings.records.filter((record) => record && !record.isEmpty)) {
    const reference = getValue(opening, ['SelectedCoach'], EMPTY_REF);
    assert(reference !== EMPTY_REF, `Opening ${opening.index} has no selected coach.`);
    assert(!selected.has(reference), `Coach selected twice at opening ${opening.index}.`);
    selected.add(reference);
  }
  assert(!selected.has(coachReference(coaches, PAYNE_ROW)), 'M. Payne remains selected by another opening.');
  const arrayRecord = transactionArrays.records[0];
  const slots = transactionSlotFields(arrayRecord);
  const used = transactionArrays.arraySizes[0];
  assert(used === 122, `Expected transaction array size 122, found ${used}.`);
  const usedRefs = slots.slice(0, used).map((field) => arrayRecord[field]);
  for (const row of TRANSACTION_ROWS) assert(!usedRefs.includes(coachTransactions.getBinaryReferenceToRecord(row)), `Removed transaction ${row} remains indexed.`);
  assert(slots.slice(used).every((field) => arrayRecord[field] === EMPTY_REF), 'Transaction array has populated values beyond array size.');

  const currentSnapshot = focusedSnapshot(state.tables);
  const rawDifferences = collectDifferences(sourceSnapshot, currentSnapshot);
  const emptyListBookkeeping = rawDifferences.filter((change) => change.row !== undefined &&
    sourceSnapshot[change.table].records[change.row].isEmpty && currentSnapshot[change.table].records[change.row].isEmpty && change.field !== '$record');
  const differences = rawDifferences.filter((change) => !emptyListBookkeeping.includes(change));
  const required = new Set([
    `openings:${OPENING_ROW}:$record`,
    `coaches:${DURKIN_ROW}:ContractStatus`,
    `coaches:${PAYNE_ROW}:ContractStatus`,
    ...TRANSACTION_ROWS.map((row) => `coachTransactions:${row}:$record`),
    'transactionArrays:undefined:$arraySizes'
  ]);
  const keys = new Set(differences.map((change) => `${change.table}:${change.row}:${change.field}`));
  for (const key of required) assert(keys.has(key), `Required semantic change missing: ${key}`);
  const allowedTables = new Set(['openings', 'coaches', 'coachTransactions', 'transactionArrays']);
  assert(differences.every((change) => allowedTables.has(change.table)), 'Treatment changed an unrelated focused table.');
  const unexpectedOpenings = differences.filter((change) => change.table === 'openings' && change.row !== OPENING_ROW);
  assert(unexpectedOpenings.length === 0, `Unexpected opening changes: ${JSON.stringify(unexpectedOpenings)}`);
  assert(differences.filter((change) => change.table === 'coaches').every((change) => [DURKIN_ROW, PAYNE_ROW].includes(change.row)), 'Unexpected Coach changed.');
  assert(differences.filter((change) => change.table === 'coachTransactions').every((change) => TRANSACTION_ROWS.includes(change.row)), 'Unexpected transaction record changed.');
  assert(differences.filter((change) => change.table === 'transactionArrays').every((change) => change.field === '$arraySizes' || change.row === 0), 'Unexpected transaction array record changed.');
  return { semanticDifferences: differences, emptyListBookkeeping };
}

function ensureAbsent(paths) {
  for (const filePath of Object.values(paths)) assert(!fs.existsSync(filePath), `Refusing to overwrite ${filePath}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(fs.existsSync(options.source), `Source not found: ${options.source}`);
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  assert(sha256(options.source) === SOURCE_HASH, 'Source BW3 fixture hash mismatch.');
  const baseline = await loadExperimentState(options.source, schema);
  const validation = baselineDetails(baseline);
  const sourceSnapshot = focusedSnapshot(baseline.tables);
  const arms = {
    control: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G1-CONTROL'),
    sham: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G1-SHAM'),
    test: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G1-RETAIN-DURKIN')
  };
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  const plan = { mode: options.write ? 'write' : 'preview', source: options.source, sourceSha256: SOURCE_HASH, schema: baseline.declaredSchema, outputDirectory: options.outputDirectory, arms, baselineValidation: validation };
  if (!options.write) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  ensureAbsent({ ...arms, manifestPath, shamTemporary: `${arms.sham}.tmp`, testTemporary: `${arms.test}.tmp` });
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  fs.copyFileSync(options.source, arms.control);
  assert(sha256(arms.control) === SOURCE_HASH, 'Control copy hash mismatch.');

  const shamTemporary = `${arms.sham}.tmp`;
  const shamWrite = await loadExperimentState(options.source, schema);
  await saveToTemporary(shamWrite.franchise, shamTemporary);
  const sham = await loadExperimentState(shamTemporary, schema);
  baselineDetails(sham);
  const shamDifferences = collectDifferences(sourceSnapshot, focusedSnapshot(sham.tables));
  assert(shamDifferences.length === 0, `Sham introduced ${shamDifferences.length} focused changes.`);
  fs.renameSync(shamTemporary, arms.sham);

  const testTemporary = `${arms.test}.tmp`;
  const testWrite = await loadExperimentState(options.source, schema);
  applyTreatment(testWrite);
  await saveToTemporary(testWrite.franchise, testTemporary);
  const test = await loadExperimentState(testTemporary, schema);
  const testValidation = validateTreatment(test, sourceSnapshot);
  fs.renameSync(testTemporary, arms.test);

  const manifest = {
    ...plan,
    mode: 'write',
    createdAt: new Date().toISOString(),
    hashes: { source: sha256(options.source), control: sha256(arms.control), sham: sha256(arms.sham), test: sha256(arms.test) },
    mutation: {
      removedOpeningRow: OPENING_ROW,
      removedTransactionRows: TRANSACTION_ROWS,
      compactedTransactionArrayFrom: 124,
      compactedTransactionArrayTo: 122,
      coachStatusResets: validation.coachStatusReset
    },
    preAdvanceValidation: {
      controlByteIdenticalToSource: true,
      shamFocusedSemanticDifferences: shamDifferences,
      testFocusedSemanticDifferences: testValidation.semanticDifferences,
      emptyRecordLinkedListBookkeeping: testValidation.emptyListBookkeeping,
      status: 'passed'
    },
    nextAction: 'Human operator advances each arm exactly once from BW3 to EOS, saves three distinct EOS outputs, and captures Auburn Staff Moves evidence.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
