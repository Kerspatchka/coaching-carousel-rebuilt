/* Gate 4: rebuild the Auburn/Florida/Coastal Carolina carousel subgraph from an external event ledger. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');
const { teamReference } = require('./prepare-gate3-opening-topology-activation');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const TARGET = {
  teams: { auburn: 9, coastal: 22, florida: 36 },
  coaches: { durkin: 128, white: 415, scott: 440, toure: 470, payne: 495 },
  openings: { florida: 22, coastal: 36 },
  transactions: { canceledDurkin: 22, firedScott: 44, hiredPayne: 62, hiredWhite: 93 }
};

const EVENT_LEDGER = [
  { type: 'retain', coach: 128, team: 9, position: 'DefensiveCoordinator' },
  { type: 'fire', coach: 440, oldTeam: 22, position: 'DefensiveCoordinator' },
  { type: 'hire', coach: 415, oldTeam: 36, newTeam: 22, position: 'DefensiveCoordinator' },
  { type: 'hire', coach: 495, oldTeam: null, newTeam: 36, position: 'DefensiveCoordinator' }
];

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate4-subgraph-rebuild')
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

function indexedTransactionReferences(state) {
  const { transactionArrays } = state.tables;
  const record = transactionArrays.records[0];
  return transactionSlots(record).slice(0, transactionArrays.arraySizes[0]).map((field) => record[field]);
}

function removeIndexedTransaction(state, row) {
  const { coachTransactions, transactionArrays } = state.tables;
  const array = transactionArrays.records[0];
  const fields = transactionSlots(array);
  const size = transactionArrays.arraySizes[0];
  const target = coachTransactions.getBinaryReferenceToRecord(row);
  const references = fields.slice(0, size).map((field) => array[field]);
  const filtered = references.filter((reference) => reference !== target);
  assert(filtered.length === size - 1, `Expected exactly one indexed reference to transaction ${row}.`);
  for (let index = 0; index < fields.length; index += 1) array[fields[index]] = index < filtered.length ? filtered[index] : EMPTY_REF;
  array.arraySize = filtered.length;
  transactionArrays.arraySizes[0] = filtered.length;
}

function validateBaseline(state) {
  const { openings, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  assert(openings.records.filter((record) => record && !record.isEmpty).length === 192, 'Expected the fixed 192-row opening pool.');
  assert(transactionArrays.arraySizes[0] === 124, 'Unexpected native transaction-array size.');
  const expectedNames = [[9, 'Auburn'], [22, 'C. Carolina'], [36, 'Florida']];
  for (const [row, name] of expectedNames) assert(displayName(teams.records[row]) === name, `Team row ${row} is not ${name}.`);
  const coachNames = [[128, 'D. Durkin'], [415, 'B. White'], [440, 'L. Scott'], [470, 'L. Toure'], [495, 'M. Payne']];
  for (const [row, name] of coachNames) assert(displayName(coaches.records[row]) === name, `Coach row ${row} is not ${name}.`);
  assert(getValue(openings.records[22], ['Team']) === teamReference(teams, 9) && getValue(openings.records[22], ['SelectedCoach']) === coachReference(coaches, 495), 'Unexpected native Auburn opening.');
  assert(getValue(openings.records[36], ['Team']) === teamReference(teams, 22) && getValue(openings.records[36], ['SelectedCoach']) === coachReference(coaches, 470), 'Unexpected native Coastal opening.');
  assert(getValue(teams.records[9], ['DefensiveCoordinator']) === coachReference(coaches, 128), 'Auburn baseline DC mismatch.');
  assert(getValue(teams.records[22], ['DefensiveCoordinator']) === coachReference(coaches, 440), 'Coastal baseline DC mismatch.');
  assert(getValue(teams.records[36], ['DefensiveCoordinator']) === coachReference(coaches, 415), 'Florida baseline DC mismatch.');
  const indexed = indexedTransactionReferences(state);
  for (const row of [22, 44, 62, 93]) assert(indexed.includes(coachTransactions.getBinaryReferenceToRecord(row)), `Transaction ${row} is not indexed.`);
  return { activeOpenings: 192, indexedTransactions: 124 };
}

function writeOpening(record, values) {
  for (const [key, value] of Object.entries(values)) record[key] = value;
}

function writeTransaction(record, values) {
  for (const [key, value] of Object.entries(values)) record[key] = value;
}

function applyTreatment(state) {
  const { openings, coaches, coachTransactions, teams } = state.tables;
  const team = (row) => teamReference(teams, row);
  const coach = (row) => coachReference(coaches, row);

  // Fixed-pool opening allocation: preserve Coastal's native slot and recycle Auburn's canceled slot for Florida.
  writeOpening(openings.records[TARGET.openings.coastal], {
    Team: team(TARGET.teams.coastal), SelectedCoach: coach(TARGET.coaches.white), PrevCoach: coach(TARGET.coaches.scott),
    Filled: true, IsEmergentJobOpening: false, Position: 'DefensiveCoordinator', Reason: 'Fired'
  });
  writeOpening(openings.records[TARGET.openings.florida], {
    Team: team(TARGET.teams.florida), SelectedCoach: coach(TARGET.coaches.payne), PrevCoach: coach(TARGET.coaches.white),
    InterestedUserTeamsList: EMPTY_REF, Filled: true, IsEmergentJobOpening: true, Position: 'DefensiveCoordinator',
    FinalContractProgramPoints: 0, HighestOfferedProgramPoints: 185, Reason: 'NewJob'
  });

  // Normalize Coach state from the external event ledger.
  coaches.records[TARGET.coaches.durkin].ContractStatus = 'First_Active';
  coaches.records[TARGET.coaches.white].ContractStatus = 'Last_Pending';
  coaches.records[TARGET.coaches.toure].ContractStatus = 'FreeAgent';

  // Keep Scott's coach-owned firing row. Recycle the two hire rows for the rebuilt destinations.
  writeTransaction(coachTransactions.records[TARGET.transactions.hiredPayne], {
    Coach: coach(TARGET.coaches.payne), OldTeam: EMPTY_REF, NewTeam: team(TARGET.teams.florida),
    OldCoachPosition: 'DefensiveCoordinator', NewCoachPosition: 'DefensiveCoordinator',
    ContractLength: 0, ContractStatus: 'Last_Pending'
  });
  writeTransaction(coachTransactions.records[TARGET.transactions.hiredWhite], {
    Coach: coach(TARGET.coaches.white), OldTeam: team(TARGET.teams.florida), NewTeam: team(TARGET.teams.coastal),
    OldCoachPosition: 'DefensiveCoordinator', NewCoachPosition: 'DefensiveCoordinator',
    ContractLength: getValue(coaches.records[TARGET.coaches.white], ['ContractYearsRemaining'], 2), ContractStatus: 'Last_Pending'
  });

  // Cancel Durkin's native firing through the proven de-index-and-let-EOS-clean pattern.
  removeIndexedTransaction(state, TARGET.transactions.canceledDurkin);
}

function validateTreatment(state, before) {
  const { openings, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  const team = (row) => teamReference(teams, row);
  const coach = (row) => coachReference(coaches, row);
  assert(openings.records.filter((record) => record && !record.isEmpty).length === 192 && openings.header.nextRecordToUse === 192, 'Opening pool shape changed.');
  const selected = openings.records.filter((record) => record && !record.isEmpty).map((record) => getValue(record, ['SelectedCoach']));
  assert(selected.every((reference) => reference !== EMPTY_REF) && new Set(selected).size === selected.length, 'Opening selections are empty or duplicated.');
  const coastal = openings.records[TARGET.openings.coastal];
  const florida = openings.records[TARGET.openings.florida];
  assert(getValue(coastal, ['Team']) === team(22) && getValue(coastal, ['SelectedCoach']) === coach(415) && getValue(coastal, ['PrevCoach']) === coach(440), 'Coastal opening is incoherent.');
  assert(getValue(florida, ['Team']) === team(36) && getValue(florida, ['SelectedCoach']) === coach(495) && getValue(florida, ['PrevCoach']) === coach(415), 'Florida opening is incoherent.');
  assert(getValue(coaches.records[128], ['ContractStatus']) === 'First_Active', 'Durkin was not retained.');
  assert(getValue(coaches.records[415], ['ContractStatus']) === 'Last_Pending', 'White is not pending.');
  assert(getValue(coaches.records[470], ['ContractStatus']) === 'FreeAgent', 'Toure was not released.');
  const tx62 = coachTransactions.records[62]; const tx93 = coachTransactions.records[93];
  assert(getValue(tx62, ['Coach']) === coach(495) && getValue(tx62, ['NewTeam']) === team(36), 'Payne transaction is incoherent.');
  assert(getValue(tx93, ['Coach']) === coach(415) && getValue(tx93, ['OldTeam']) === team(36) && getValue(tx93, ['NewTeam']) === team(22), 'White transaction is incoherent.');
  assert(transactionArrays.arraySizes[0] === 123, 'Expected one canceled transaction reference.');
  const indexed = indexedTransactionReferences(state);
  assert(!indexed.includes(coachTransactions.getBinaryReferenceToRecord(22)), 'Canceled Durkin firing remains indexed.');
  for (const row of [44, 62, 93]) assert(indexed.includes(coachTransactions.getBinaryReferenceToRecord(row)), `Required transaction ${row} is not indexed.`);

  const after = focusedSnapshot(state.tables);
  const differences = collectDifferences(before, after);
  const allowedRows = new Set(['openings:22', 'openings:36', 'coaches:128', 'coaches:415', 'coaches:470', 'coachTransactions:62', 'coachTransactions:93', 'transactionArrays:0', 'transactionArrays:undefined']);
  const unexpected = differences.filter((change) => {
    if (allowedRows.has(`${change.table}:${change.row}`)) return false;
    if (change.table === 'transactionArrays' && change.field === '$arraySizes') return false;
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
  const baselineInventory = validateBaseline(baseline);
  const before = focusedSnapshot(baseline.tables);
  const output = path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G4-SUBGRAPH');
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  if (!options.write) { process.stdout.write(`${JSON.stringify({ mode: 'preview', eventLedger: EVENT_LEDGER, baselineInventory, output }, null, 2)}\n`); return; }
  assert(!fs.existsSync(output) && !fs.existsSync(manifestPath), 'Refusing to overwrite Gate 4 output.');
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const temporary = `${output}.tmp`;
  const treatment = await loadExperimentState(options.source, schema);
  applyTreatment(treatment);
  await saveToTemporary(treatment.franchise, temporary);
  const reopened = await loadExperimentState(temporary, schema);
  const differences = validateTreatment(reopened, before);
  fs.renameSync(temporary, output);
  const manifest = {
    preparedAt: new Date().toISOString(), sourceSha256: SOURCE_HASH, schema: baseline.declaredSchema,
    output, outputSha256: sha256(output), purpose: 'Rebuild the complete Auburn/Florida/Coastal Carolina movement subgraph from an external event ledger using only fixed-pool opening rows.',
    eventLedger: EVENT_LEDGER,
    allocation: {
      openings: { 'Florida DC hire': 22, 'Coastal Carolina DC hire': 36 },
      transactions: { 'canceled Durkin firing': 22, 'L. Scott firing': 44, 'Payne to Florida': 62, 'White Florida to Coastal Carolina': 93 },
      deindexedTransactions: [22], activeOpeningCount: 192, indexedTransactionCount: 123
    },
    expectedEos: 'D. Durkin retained at Auburn; L. Scott fired by Coastal Carolina; B. White moves Florida to Coastal Carolina; M. Payne moves from the free-agent pool to Florida; L. Toure remains a free agent.',
    differences, preAdvanceValidation: 'passed'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { EVENT_LEDGER, TARGET, applyTreatment, validateBaseline, validateTreatment };
