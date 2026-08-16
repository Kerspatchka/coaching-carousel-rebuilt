/* Gate 3C: complete Auburn/Florida cascade with new opening and transaction rows. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, focusedSnapshot,
  getValue, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');
const {
  TARGET, applyTreatment: applyOpeningTreatment, teamReference, validateBaseline
} = require('./prepare-gate3-opening-topology-activation');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const NEW_TRANSACTION = 125;
const NEW_TRANSACTION_ID = 124;

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate3-combined-cascade')
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
function activatePayneTransaction(state, floridaTeam) {
  const { coachTransactions, transactionArrays, coaches, teams } = state.tables;
  assert(coachTransactions.header.nextRecordToUse === NEW_TRANSACTION && coachTransactions.records[NEW_TRANSACTION].isEmpty, 'Expected transaction row 125 to be next empty row.');
  const record = coachTransactions.records[NEW_TRANSACTION];
  record.Coach = coachReference(coaches, TARGET.payne);
  record.OldTeam = EMPTY_REF;
  record.NewTeam = teamReference(teams, floridaTeam);
  record.OldCoachPosition = 'DefensiveCoordinator';
  record.TransactionId = NEW_TRANSACTION_ID;
  record.SeasonStage = 'NFLSeason';
  record.SeasonYear = 0;
  record.NewCoachPosition = 'DefensiveCoordinator';
  record.ContractSalary = 0;
  record.ContractLength = 0;
  record.ContractStatus = 'Last_Pending';
  record.SeasonWeek = 20;
  const array = transactionArrays.records[0];
  const fields = transactionSlots(array);
  const size = transactionArrays.arraySizes[0];
  assert(size === 124 && array[fields[size]] === EMPTY_REF, 'Expected empty transaction slot 124.');
  array[fields[size]] = coachTransactions.getBinaryReferenceToRecord(NEW_TRANSACTION);
  array.arraySize = size + 1;
  transactionArrays.arraySizes[0] = size + 1;
}
function applyTreatment(state, floridaTeam) {
  applyOpeningTreatment(state, floridaTeam);
  activatePayneTransaction(state, floridaTeam);
}
function validateTreatment(state, before, floridaTeam) {
  const { openings, offerArrays, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  assert(openings.header.nextRecordToUse === 193 && offerArrays.header.nextRecordToUse === 193, 'Opening topology allocators did not advance.');
  assert(coachTransactions.header.nextRecordToUse === 126, 'Transaction allocator did not advance to row 126.');
  assert(openings.records.filter((record) => record && !record.isEmpty).length === 193, 'Expected 193 active openings.');
  assert(offerArrays.records.filter((record) => record && !record.isEmpty).length === 193, 'Expected 193 active offer arrays.');
  assert(coachTransactions.records.filter((record) => record && !record.isEmpty).length === 126, 'Expected 126 active transactions.');
  assert(transactionArrays.arraySizes[0] === 125, 'Expected transaction array size 125.');
  assert(getValue(openings.records[TARGET.auburnOpening], ['SelectedCoach']) === coachReference(coaches, TARGET.white), 'Auburn selection is incorrect.');
  assert(getValue(openings.records[TARGET.newOpening], ['SelectedCoach']) === coachReference(coaches, TARGET.payne) && getValue(openings.records[TARGET.newOpening], ['Team']) === teamReference(teams, floridaTeam), 'Florida opening is incorrect.');
  const whiteTransaction = coachTransactions.records[TARGET.transaction];
  assert(getValue(whiteTransaction, ['Coach']) === coachReference(coaches, TARGET.white) && getValue(whiteTransaction, ['OldTeam']) === teamReference(teams, floridaTeam) && getValue(whiteTransaction, ['NewTeam']) === teamReference(teams, TARGET.auburnTeam), 'B. White transaction is incorrect.');
  const payneTransaction = coachTransactions.records[NEW_TRANSACTION];
  assert(!payneTransaction.isEmpty && getValue(payneTransaction, ['Coach']) === coachReference(coaches, TARGET.payne) && getValue(payneTransaction, ['OldTeam']) === EMPTY_REF && getValue(payneTransaction, ['NewTeam']) === teamReference(teams, floridaTeam), 'M. Payne transaction is incorrect.');
  assert(getValue(payneTransaction, ['TransactionId']) === NEW_TRANSACTION_ID, 'M. Payne transaction ID is incorrect.');
  const indexed = transactionSlots(transactionArrays.records[0]).slice(0, 125).map((field) => transactionArrays.records[0][field]);
  assert(indexed.includes(coachTransactions.getBinaryReferenceToRecord(TARGET.transaction)) && indexed.includes(coachTransactions.getBinaryReferenceToRecord(NEW_TRANSACTION)), 'Both cascade transactions must be indexed.');
  const after = focusedSnapshot(state.tables);
  const differences = collectDifferences(before, after);
  const allowedRows = new Set(['openings:22', 'openings:192', 'offerArrays:192', 'coaches:415', 'coachTransactions:62', 'coachTransactions:125', 'transactionArrays:0', 'transactionArrays:undefined']);
  const unexpected = differences.filter((change) => {
    if (allowedRows.has(`${change.table}:${change.row}`)) return false;
    if (change.table === 'transactionArrays' && change.field === '$arraySizes') return false;
    if (change.row !== undefined && change.field !== '$record' && before[change.table].records[change.row].isEmpty && after[change.table].records[change.row].isEmpty) return false;
    return true;
  });
  assert(unexpected.length === 0, `Unexpected changes: ${unexpected.map((change) => `${change.table}:${change.row}:${change.field}`).join(', ')}`);
  return differences;
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(fs.existsSync(options.source) && sha256(options.source) === SOURCE_HASH, 'Source BW3 fixture mismatch.');
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const baseline = await loadExperimentState(options.source, schema);
  const floridaTeam = validateBaseline(baseline);
  const before = focusedSnapshot(baseline.tables);
  const output = path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G3C-CASCADE');
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  if (!options.write) { process.stdout.write(`${JSON.stringify({ mode: 'preview', floridaTeam, output }, null, 2)}\n`); return; }
  assert(!fs.existsSync(output) && !fs.existsSync(manifestPath), 'Refusing to overwrite Gate 3C output.');
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const temporary = `${output}.tmp`;
  const treatment = await loadExperimentState(options.source, schema);
  applyTreatment(treatment, floridaTeam);
  await saveToTemporary(treatment.franchise, temporary);
  const reopened = await loadExperimentState(temporary, schema);
  const differences = validateTreatment(reopened, before, floridaTeam);
  fs.renameSync(temporary, output);
  const manifest = {
    preparedAt: new Date().toISOString(), sourceSha256: SOURCE_HASH, schema: baseline.declaredSchema,
    output, outputSha256: sha256(output), floridaTeamRow: floridaTeam,
    purpose: 'Complete Gate 3 cascade using the proven new-opening and new-transaction allocators.',
    expectedEos: 'Auburn DC B. White; Florida DC M. Payne; D. Durkin free agent; indexed Staff Moves for Durkin, White Florida-to-Auburn, and Payne empty-to-Florida.',
    differences, preAdvanceValidation: 'passed'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
