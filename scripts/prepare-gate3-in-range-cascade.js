/* Gate 3D: complete Auburn/Florida cascade by reusing in-range opening/transaction rows. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');
const { findTeamRow, teamReference } = require('./prepare-gate3-opening-topology-activation');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const TARGET = {
  auburnOpening: 22, floridaOpening: 67, auburnTeam: 9,
  whiteTransaction: 62, payneTransaction: 120,
  durkin: 128, white: 415, displacedCoach: 210, payne: 495
};

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate3-in-range-cascade')
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
  return (record.fieldsArray || []).map((field) => field.key)
    .filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function validateBaseline(state) {
  const { openings, offerArrays, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  const floridaTeam = findTeamRow(teams, 'Florida');
  assert(floridaTeam >= 0, 'Florida team was not found.');
  assert(openings.records.filter((record) => record && !record.isEmpty).length === 192, 'Expected exactly 192 active BW3 openings.');
  assert(openings.header.nextRecordToUse === 192, 'Expected opening allocator boundary at row 192.');
  assert(offerArrays.records.filter((record) => record && !record.isEmpty).length === 192, 'Expected exactly 192 active offer arrays.');
  assert(getValue(openings.records[TARGET.auburnOpening], ['SelectedCoach']) === coachReference(coaches, TARGET.payne), 'Auburn native selection is not M. Payne.');
  const displaced = openings.records[TARGET.floridaOpening];
  assert(getValue(displaced, ['SelectedCoach']) === coachReference(coaches, TARGET.displacedCoach), 'Opening 67 is not the expected J. McGraw selection.');
  assert(displayName(coaches.records[TARGET.displacedCoach]) === 'J. McGraw', 'Displaced coach row mismatch.');
  assert(getValue(coachTransactions.records[TARGET.payneTransaction], ['Coach']) === coachReference(coaches, TARGET.displacedCoach), 'Transaction 120 is not J. McGraw\'s native hire.');
  const indexed = transactionSlots(transactionArrays.records[0]).slice(0, transactionArrays.arraySizes[0]).map((field) => transactionArrays.records[0][field]);
  assert(indexed.includes(coachTransactions.getBinaryReferenceToRecord(TARGET.payneTransaction)), 'Transaction 120 is not indexed.');
  return floridaTeam;
}

function applyTreatment(state, floridaTeam) {
  const { openings, coaches, coachTransactions, teams } = state.tables;
  openings.records[TARGET.auburnOpening].SelectedCoach = coachReference(coaches, TARGET.white);
  const opening = openings.records[TARGET.floridaOpening];
  opening.Team = teamReference(teams, floridaTeam);
  opening.SelectedCoach = coachReference(coaches, TARGET.payne);
  opening.PrevCoach = coachReference(coaches, TARGET.white);
  opening.InterestedUserTeamsList = EMPTY_REF;
  opening.Filled = true;
  opening.IsEmergentJobOpening = true;
  opening.Position = 'DefensiveCoordinator';
  opening.FinalContractProgramPoints = 0;
  opening.HighestOfferedProgramPoints = 185;
  opening.Reason = 'NewJob';

  coaches.records[TARGET.white].ContractStatus = 'Last_Pending';
  coaches.records[TARGET.displacedCoach].ContractStatus = 'FreeAgent';

  const whiteTx = coachTransactions.records[TARGET.whiteTransaction];
  whiteTx.Coach = coachReference(coaches, TARGET.white);
  whiteTx.OldTeam = teamReference(teams, floridaTeam);
  whiteTx.NewTeam = teamReference(teams, TARGET.auburnTeam);
  whiteTx.OldCoachPosition = 'DefensiveCoordinator';
  whiteTx.NewCoachPosition = 'DefensiveCoordinator';
  whiteTx.ContractLength = getValue(coaches.records[TARGET.white], ['ContractYearsRemaining'], 2);
  whiteTx.ContractStatus = 'Last_Pending';

  const payneTx = coachTransactions.records[TARGET.payneTransaction];
  payneTx.Coach = coachReference(coaches, TARGET.payne);
  payneTx.OldTeam = EMPTY_REF;
  payneTx.NewTeam = teamReference(teams, floridaTeam);
  payneTx.OldCoachPosition = 'DefensiveCoordinator';
  payneTx.NewCoachPosition = 'DefensiveCoordinator';
  payneTx.ContractLength = 0;
  payneTx.ContractStatus = 'Last_Pending';
  payneTx.SeasonWeek = 20;
}

function validateTreatment(state, before, floridaTeam) {
  const { openings, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  assert(openings.header.nextRecordToUse === 192, 'Opening allocator changed.');
  assert(openings.records.filter((record) => record && !record.isEmpty).length === 192, 'Active opening count changed.');
  assert(getValue(openings.records[TARGET.auburnOpening], ['SelectedCoach']) === coachReference(coaches, TARGET.white), 'Auburn selection is incorrect.');
  const florida = openings.records[TARGET.floridaOpening];
  assert(getValue(florida, ['Team']) === teamReference(teams, floridaTeam), 'In-range opening is not Florida.');
  assert(getValue(florida, ['SelectedCoach']) === coachReference(coaches, TARGET.payne), 'Florida selection is not M. Payne.');
  assert(getValue(florida, ['PrevCoach']) === coachReference(coaches, TARGET.white), 'Florida previous coach is not B. White.');
  assert(getValue(coaches.records[TARGET.displacedCoach], ['ContractStatus']) === 'FreeAgent', 'J. McGraw was not released from pending state.');
  const whiteTx = coachTransactions.records[TARGET.whiteTransaction];
  const payneTx = coachTransactions.records[TARGET.payneTransaction];
  assert(getValue(whiteTx, ['Coach']) === coachReference(coaches, TARGET.white) && getValue(whiteTx, ['NewTeam']) === teamReference(teams, TARGET.auburnTeam), 'B. White transaction is incorrect.');
  assert(getValue(payneTx, ['Coach']) === coachReference(coaches, TARGET.payne) && getValue(payneTx, ['NewTeam']) === teamReference(teams, floridaTeam), 'M. Payne transaction is incorrect.');
  assert(transactionArrays.arraySizes[0] === 124, 'Transaction array size changed.');
  const indexed = transactionSlots(transactionArrays.records[0]).slice(0, 124).map((field) => transactionArrays.records[0][field]);
  assert(indexed.includes(coachTransactions.getBinaryReferenceToRecord(TARGET.whiteTransaction)) && indexed.includes(coachTransactions.getBinaryReferenceToRecord(TARGET.payneTransaction)), 'Cascade transactions are not indexed.');

  const after = focusedSnapshot(state.tables);
  const differences = collectDifferences(before, after);
  const allowedRows = new Set(['openings:22', 'openings:67', 'coaches:210', 'coaches:415', 'coachTransactions:62', 'coachTransactions:120']);
  const unexpected = differences.filter((change) => !allowedRows.has(`${change.table}:${change.row}`));
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
  const output = path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-G3D-INRANGE');
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  if (!options.write) { process.stdout.write(`${JSON.stringify({ mode: 'preview', floridaTeam, output }, null, 2)}\n`); return; }
  assert(!fs.existsSync(output) && !fs.existsSync(manifestPath), 'Refusing to overwrite Gate 3D output.');
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
    purpose: 'Test whether the engine resolves only the 192 native in-range opening rows by reusing opening 67 and its indexed transaction.',
    controlledCollateral: 'Rutgers DC opening 67 and J. McGraw transaction 120 are repurposed; J. McGraw is reset to FreeAgent and Rutgers may use EOS fallback behavior.',
    expectedEos: 'Auburn DC B. White and Florida DC M. Payne if the 192-row processing boundary caused Gate 3C to fail.',
    differences, preAdvanceValidation: 'passed'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
