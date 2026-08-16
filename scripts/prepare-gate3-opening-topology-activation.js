/* Gate 3B: activate a new Florida opening and paired offer-list row. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const TARGET = { auburnOpening: 22, newOpening: 192, newOfferArray: 192, transaction: 62, auburnTeam: 9, durkin: 128, white: 415, payne: 495 };

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate3-opening-topology-activation')
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
function findTeamRow(teams, name) {
  return teams.records.findIndex((record) => record && !record.isEmpty && displayName(record) === name);
}
function teamReference(teams, row) { return teams.getBinaryReferenceToRecord(row); }
function arrayFields(record) {
  return (record.fieldsArray || []).map((field) => field.key).filter((field) => /^StaffPersonContractOffer\d+$/.test(field));
}
function validateBaseline(state) {
  const { openings, offerArrays, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  const floridaTeam = findTeamRow(teams, 'Florida');
  assert(floridaTeam >= 0, 'Florida Team was not found.');
  assert(getValue(coaches.records[TARGET.white], ['TeamIndex']) === 26, 'B. White is not on Florida TeamIndex 26.');
  assert(getValue(teams.records[floridaTeam], ['DefensiveCoordinator']) === coachReference(coaches, TARGET.white), 'Florida committed DC is not B. White.');
  assert(getValue(coaches.records[TARGET.white], ['ContractStatus']) === 'First_Active', 'B. White is not active.');
  assert(getValue(coaches.records[TARGET.payne], ['ContractStatus']) === 'Last_Pending', 'M. Payne is not native pending.');
  assert(getValue(openings.records[TARGET.auburnOpening], ['SelectedCoach']) === coachReference(coaches, TARGET.payne), 'Auburn native selection is not M. Payne.');
  assert(!openings.records.filter((record) => record && !record.isEmpty).some((record) => getValue(record, ['SelectedCoach']) === coachReference(coaches, TARGET.white)), 'B. White is already selected.');
  assert(openings.header.nextRecordToUse === TARGET.newOpening && openings.records[TARGET.newOpening].isEmpty, 'Expected opening row 192 to be next empty row.');
  assert(offerArrays.header.nextRecordToUse === TARGET.newOfferArray && offerArrays.records[TARGET.newOfferArray].isEmpty, 'Expected offer-array row 192 to be next empty row.');
  assert(coachTransactions.records.filter((record) => record && !record.isEmpty).length === 125, 'Unexpected active transaction count.');
  assert(transactionArrays.arraySizes[0] === 124, 'Unexpected transaction array size.');
  return floridaTeam;
}
function activateOfferArray(offerArrays) {
  const record = offerArrays.records[TARGET.newOfferArray];
  for (const field of arrayFields(record)) record[field] = EMPTY_REF;
  record.arraySize = 0;
  offerArrays.arraySizes[TARGET.newOfferArray] = 0;
}
function applyTreatment(state, floridaTeam) {
  const { openings, offerArrays, coaches, coachTransactions, teams } = state.tables;
  activateOfferArray(offerArrays);
  openings.records[TARGET.auburnOpening].SelectedCoach = coachReference(coaches, TARGET.white);
  const opening = openings.records[TARGET.newOpening];
  opening.Team = teamReference(teams, floridaTeam);
  opening.SelectedCoach = coachReference(coaches, TARGET.payne);
  opening.PrevCoach = coachReference(coaches, TARGET.white);
  opening.InterestedUserTeamsList = EMPTY_REF;
  opening.ContractOfferList = offerArrays.getBinaryReferenceToRecord(TARGET.newOfferArray);
  opening.Filled = true;
  opening.IsEmergentJobOpening = true;
  opening.Position = 'DefensiveCoordinator';
  opening.FinalContractProgramPoints = 0;
  opening.HighestOfferedProgramPoints = 185;
  opening.Reason = 'NewJob';
  coaches.records[TARGET.white].ContractStatus = 'Last_Pending';
  const transaction = coachTransactions.records[TARGET.transaction];
  transaction.Coach = coachReference(coaches, TARGET.white);
  transaction.OldTeam = teamReference(teams, floridaTeam);
  transaction.NewTeam = teamReference(teams, TARGET.auburnTeam);
  transaction.OldCoachPosition = 'DefensiveCoordinator';
  transaction.NewCoachPosition = 'DefensiveCoordinator';
  transaction.ContractLength = getValue(coaches.records[TARGET.white], ['ContractYearsRemaining'], 2);
  transaction.ContractStatus = 'Last_Pending';
}
function validateTreatment(state, before, floridaTeam) {
  const { openings, offerArrays, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  assert(openings.header.nextRecordToUse === 193 && offerArrays.header.nextRecordToUse === 193, 'New-record allocator did not advance to row 193.');
  assert(!openings.records[TARGET.newOpening].isEmpty && !offerArrays.records[TARGET.newOfferArray].isEmpty, 'New opening topology did not remain active.');
  assert(openings.records.filter((record) => record && !record.isEmpty).length === 193, 'Expected 193 active openings.');
  assert(offerArrays.records.filter((record) => record && !record.isEmpty).length === 193, 'Expected 193 active offer arrays.');
  assert(getValue(openings.records[TARGET.auburnOpening], ['SelectedCoach']) === coachReference(coaches, TARGET.white), 'Auburn did not select B. White.');
  const opening = openings.records[TARGET.newOpening];
  assert(getValue(opening, ['Team']) === teamReference(teams, floridaTeam) && getValue(opening, ['SelectedCoach']) === coachReference(coaches, TARGET.payne), 'Florida opening destination/selection is incorrect.');
  assert(getValue(opening, ['PrevCoach']) === coachReference(coaches, TARGET.white) && getValue(opening, ['Position']) === 'DefensiveCoordinator', 'Florida opening prior coach/role is incorrect.');
  assert(getValue(opening, ['ContractOfferList']) === offerArrays.getBinaryReferenceToRecord(TARGET.newOfferArray), 'Florida offer-list reference is incorrect.');
  assert(getValue(opening, ['Filled']) === true && getValue(opening, ['IsEmergentJobOpening']) === true && getValue(opening, ['Reason']) === 'NewJob', 'Florida opening flags are incorrect.');
  const selections = openings.records.filter((record) => record && !record.isEmpty).map((record) => getValue(record, ['SelectedCoach']));
  assert(new Set(selections).size === selections.length, 'Treatment contains duplicate selected coaches.');
  assert(getValue(coaches.records[TARGET.white], ['ContractStatus']) === 'Last_Pending', 'B. White pending state is incorrect.');
  const transaction = coachTransactions.records[TARGET.transaction];
  assert(getValue(transaction, ['Coach']) === coachReference(coaches, TARGET.white) && getValue(transaction, ['OldTeam']) === teamReference(teams, floridaTeam) && getValue(transaction, ['NewTeam']) === teamReference(teams, TARGET.auburnTeam), 'B. White transaction is incorrect.');
  assert(coachTransactions.records.filter((record) => record && !record.isEmpty).length === 125 && transactionArrays.arraySizes[0] === 124, 'Treatment must not allocate a transaction.');
  const after = focusedSnapshot(state.tables);
  const differences = collectDifferences(before, after);
  const allowedRows = new Set(['openings:22', 'openings:192', 'offerArrays:192', 'coaches:415', 'coachTransactions:62']);
  const unexpected = differences.filter((change) => {
    if (allowedRows.has(`${change.table}:${change.row}`)) return false;
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
  const output = path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G3B-OPENING');
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  if (!options.write) { process.stdout.write(`${JSON.stringify({ mode: 'preview', floridaTeam, output }, null, 2)}\n`); return; }
  assert(!fs.existsSync(output) && !fs.existsSync(manifestPath), 'Refusing to overwrite Gate 3B output.');
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
    purpose: 'Prove activation and EOS consumption of a new Florida JobOpening plus paired offer-array row without allocating a new transaction.',
    differences, preAdvanceValidation: 'passed',
    expectedEos: 'Auburn DC B. White; Florida DC M. Payne; D. Durkin free agent. Staff Moves contains Durkin and White but intentionally lacks Payne-to-Florida.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}

module.exports = { TARGET, applyTreatment, findTeamRow, teamReference, validateBaseline, validateTreatment };
