/*
 * Prepare the second three-arm BW3 experiment: synchronize final selections
 * and CoachTransactionHistoryEntry.NewTeam, including an active-FBS pair.
 */
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

const EXPECTED_SOURCE_SHA256 = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';

const OPENING_EDITS = [
  { row: 22, teamRow: 9, team: 'Auburn', position: 'DefensiveCoordinator', fromCoachRow: 495, fromCoach: 'M. Payne', toCoachRow: 470, toCoach: 'L. Toure' },
  { row: 36, teamRow: 22, team: 'C. Carolina', position: 'DefensiveCoordinator', fromCoachRow: 470, fromCoach: 'L. Toure', toCoachRow: 495, toCoach: 'M. Payne' },
  { row: 8, teamRow: 98, team: 'Rutgers', position: 'OffensiveCoordinator', fromCoachRow: 304, fromCoach: 'J. Pappalardo', toCoachRow: 411, toCoach: 'M. Warner' },
  { row: 27, teamRow: 83, team: 'NIU', position: 'OffensiveCoordinator', fromCoachRow: 411, fromCoach: 'M. Warner', toCoachRow: 304, toCoach: 'J. Pappalardo' }
];

const TRANSACTION_EDITS = [
  { row: 62, coachRow: 495, coach: 'M. Payne', oldTeamRow: null, oldTeam: null, fromTeamRow: 9, fromTeam: 'Auburn', toTeamRow: 22, toTeam: 'C. Carolina' },
  { row: 93, coachRow: 470, coach: 'L. Toure', oldTeamRow: null, oldTeam: null, fromTeamRow: 22, fromTeam: 'C. Carolina', toTeamRow: 9, toTeam: 'Auburn' },
  { row: 119, coachRow: 304, coach: 'J. Pappalardo', oldTeamRow: 130, oldTeam: 'UTEP', fromTeamRow: 98, fromTeam: 'Rutgers', toTeamRow: 83, toTeam: 'NIU' },
  { row: 100, coachRow: 411, coach: 'M. Warner', oldTeamRow: 124, oldTeam: 'UMass', fromTeamRow: 83, fromTeam: 'NIU', toTeamRow: 98, toTeam: 'Rutgers' }
];

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-synchronized-history-oldteam')
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

function teamReference(teamTable, row) {
  return teamTable.getBinaryReferenceToRecord(row);
}

function validateBaseline(state) {
  const { openings, coachTransactions, coaches, teams, offers, offerArrays } = state.tables;
  const activeOpenings = openings.records.filter((record) => record && !record.isEmpty);
  assert(activeOpenings.length === 192, `Expected 192 BW3 openings, found ${activeOpenings.length}.`);
  assert(activeOpenings.every((record) => getValue(record, ['Filled']) === true), 'Every BW3 opening must be filled.');
  const selected = new Set();
  for (const record of activeOpenings) {
    const reference = getValue(record, ['SelectedCoach'], EMPTY_REF);
    assert(reference !== EMPTY_REF, `Opening ${record.index} has no selection.`);
    assert(!selected.has(reference), `Duplicate selected coach at opening ${record.index}.`);
    selected.add(reference);
  }
  const realOffers = offers.records.filter((record) => record && !record.isEmpty && getValue(record, ['ContractPosition']) !== 'Invalid_');
  assert(realOffers.length === 0, 'Expected no real offers at BW3.');
  const populatedArrays = offerArrays.records.filter((record) => record && !record.isEmpty && (record.fieldsArray || [])
    .filter((field) => /^StaffPersonContractOffer\d+$/i.test(field.key))
    .some((field) => record[field.key] && record[field.key] !== EMPTY_REF));
  assert(populatedArrays.length === 0, 'Expected no populated offer arrays at BW3.');

  for (const edit of OPENING_EDITS) {
    const opening = openings.records[edit.row];
    const team = teams.records[edit.teamRow];
    const fromCoach = coaches.records[edit.fromCoachRow];
    const toCoach = coaches.records[edit.toCoachRow];
    assert(opening && !opening.isEmpty, `Opening row ${edit.row} is missing.`);
    assert(displayName(team) === edit.team, `Expected ${edit.team} at Team row ${edit.teamRow}.`);
    assert(displayName(fromCoach) === edit.fromCoach, `Expected ${edit.fromCoach} at Coach row ${edit.fromCoachRow}.`);
    assert(displayName(toCoach) === edit.toCoach, `Expected ${edit.toCoach} at Coach row ${edit.toCoachRow}.`);
    assert(getValue(opening, ['Team']) === teamReference(teams, edit.teamRow), `Opening ${edit.row}: Team mismatch.`);
    assert(getValue(opening, ['SelectedCoach']) === coachReference(coaches, edit.fromCoachRow), `Opening ${edit.row}: native selection mismatch.`);
    assert(getValue(opening, ['Position']) === edit.position, `Opening ${edit.row}: position mismatch.`);
    assert(getValue(opening, ['Reason']) === 'Fired', `Opening ${edit.row}: expected Fired.`);
    assert(getValue(opening, ['IsEmergentJobOpening']) === false, `Opening ${edit.row}: expected non-emergent.`);
    assert(getValue(toCoach, ['Position']) === edit.position, `${edit.toCoach}: role mismatch.`);
    assert(getValue(toCoach, ['ContractStatus']) === 'Last_Pending', `${edit.toCoach}: expected Last_Pending.`);
    assert(getValue(toCoach, ['IsUserControlled']) === false, `${edit.toCoach}: user-controlled coach is not allowed.`);
  }

  for (const edit of TRANSACTION_EDITS) {
    const record = coachTransactions.records[edit.row];
    assert(record && !record.isEmpty, `Transaction row ${edit.row} is missing.`);
    assert(getValue(record, ['Coach']) === coachReference(coaches, edit.coachRow), `Transaction ${edit.row}: Coach mismatch.`);
    assert(getValue(record, ['NewTeam']) === teamReference(teams, edit.fromTeamRow), `Transaction ${edit.row}: native NewTeam mismatch.`);
    const expectedOld = edit.oldTeamRow === null ? EMPTY_REF : teamReference(teams, edit.oldTeamRow);
    assert(getValue(record, ['OldTeam']) === expectedOld, `Transaction ${edit.row}: OldTeam mismatch.`);
    if (edit.oldTeamRow !== null) assert(displayName(teams.records[edit.oldTeamRow]) === edit.oldTeam, `Transaction ${edit.row}: old Team name mismatch.`);
    assert(getValue(record, ['NewCoachPosition']) === OPENING_EDITS.find((item) => item.fromCoachRow === edit.coachRow).position, `Transaction ${edit.row}: role mismatch.`);
    assert(getValue(record, ['ContractStatus']) === 'Last_Pending', `Transaction ${edit.row}: expected Last_Pending.`);
  }

  return {
    openingCount: activeOpenings.length,
    openings: OPENING_EDITS,
    transactions: TRANSACTION_EDITS.map((edit) => ({ ...edit, oldTeamReference: edit.oldTeamRow === null ? EMPTY_REF : teamReference(teams, edit.oldTeamRow) }))
  };
}

function applyEdits(state) {
  for (const edit of OPENING_EDITS) {
    state.tables.openings.records[edit.row].SelectedCoach = coachReference(state.tables.coaches, edit.toCoachRow);
  }
  for (const edit of TRANSACTION_EDITS) {
    state.tables.coachTransactions.records[edit.row].NewTeam = teamReference(state.tables.teams, edit.toTeamRow);
  }
}

function validateEditedState(state, baselineSnapshot) {
  const { openings, coachTransactions, coaches, teams } = state.tables;
  const selected = new Set();
  for (const opening of openings.records.filter((record) => record && !record.isEmpty)) {
    const reference = getValue(opening, ['SelectedCoach'], EMPTY_REF);
    assert(reference !== EMPTY_REF, `Opening ${opening.index} lost its selection.`);
    assert(!selected.has(reference), `Coach selected more than once after edits at opening ${opening.index}.`);
    selected.add(reference);
  }
  for (const edit of OPENING_EDITS) {
    assert(getValue(openings.records[edit.row], ['SelectedCoach']) === coachReference(coaches, edit.toCoachRow), `Opening ${edit.row}: edited selection did not persist.`);
  }
  for (const edit of TRANSACTION_EDITS) {
    const record = coachTransactions.records[edit.row];
    assert(getValue(record, ['Coach']) === coachReference(coaches, edit.coachRow), `Transaction ${edit.row}: Coach changed unexpectedly.`);
    assert(getValue(record, ['NewTeam']) === teamReference(teams, edit.toTeamRow), `Transaction ${edit.row}: edited NewTeam did not persist.`);
    const expectedOld = edit.oldTeamRow === null ? EMPTY_REF : teamReference(teams, edit.oldTeamRow);
    assert(getValue(record, ['OldTeam']) === expectedOld, `Transaction ${edit.row}: OldTeam changed unexpectedly.`);
  }

  const differences = collectDifferences(baselineSnapshot, focusedSnapshot(state.tables));
  const allowed = new Set([
    ...OPENING_EDITS.map((edit) => `openings:${edit.row}:SelectedCoach`),
    ...TRANSACTION_EDITS.map((edit) => `coachTransactions:${edit.row}:NewTeam`)
  ]);
  const actual = new Set(differences.map((change) => `${change.table}:${change.row}:${change.field}`));
  assert(differences.length === 8, `Expected eight semantic changes, found ${differences.length}.`);
  assert([...actual].every((item) => allowed.has(item)), `Unexpected semantic changes: ${[...actual].filter((item) => !allowed.has(item)).join(', ')}`);
  assert([...allowed].every((item) => actual.has(item)), 'One or more allowlisted edits did not persist.');
  return differences;
}

function ensureAbsent(paths) {
  for (const filePath of Object.values(paths)) assert(!fs.existsSync(filePath), `Refusing to overwrite ${filePath}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schemaPath = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(fs.existsSync(options.source), `Source not found: ${options.source}`);
  assert(schemaPath && fs.existsSync(schemaPath), 'Set CCR_SCHEMA_PATH to CFB27_833_0.gz.');
  assert(sha256(options.source) === EXPECTED_SOURCE_SHA256, 'Source fixture hash mismatch.');

  const baseline = await loadExperimentState(options.source, schemaPath);
  const baselineValidation = validateBaseline(baseline);
  const baselineSnapshot = focusedSnapshot(baseline.tables);
  const arms = {
    control: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-EXP2-CONTROL'),
    sham: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-EXP2-SHAM'),
    test: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-EXP2-TEST-SYNC')
  };
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  const plan = {
    mode: options.write ? 'write' : 'preview',
    source: options.source,
    sourceSha256: EXPECTED_SOURCE_SHA256,
    schema: baseline.declaredSchema,
    outputDirectory: options.outputDirectory,
    arms,
    baselineValidation,
    mutation: {
      openings: OPENING_EDITS,
      transactions: TRANSACTION_EDITS
    }
  };
  if (!options.write) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.stderr.write('Preview only. Re-run with --write to create arms.\n');
    return;
  }

  ensureAbsent({ ...arms, manifestPath, shamTemporary: `${arms.sham}.tmp`, testTemporary: `${arms.test}.tmp` });
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  fs.copyFileSync(options.source, arms.control);
  assert(sha256(arms.control) === EXPECTED_SOURCE_SHA256, 'Control is not byte-identical to source.');

  const shamTemporary = `${arms.sham}.tmp`;
  const shamWrite = await loadExperimentState(options.source, schemaPath);
  await saveToTemporary(shamWrite.franchise, shamTemporary);
  const shamReopened = await loadExperimentState(shamTemporary, schemaPath);
  validateBaseline(shamReopened);
  const shamDifferences = collectDifferences(baselineSnapshot, focusedSnapshot(shamReopened.tables));
  assert(shamDifferences.length === 0, `Sham introduced ${shamDifferences.length} focused changes.`);
  fs.renameSync(shamTemporary, arms.sham);

  const testTemporary = `${arms.test}.tmp`;
  const testWrite = await loadExperimentState(options.source, schemaPath);
  applyEdits(testWrite);
  await saveToTemporary(testWrite.franchise, testTemporary);
  const testReopened = await loadExperimentState(testTemporary, schemaPath);
  const testDifferences = validateEditedState(testReopened, baselineSnapshot);
  fs.renameSync(testTemporary, arms.test);

  const manifest = {
    ...plan,
    mode: 'write',
    createdAt: new Date().toISOString(),
    hashes: {
      source: sha256(options.source),
      control: sha256(arms.control),
      sham: sha256(arms.sham),
      test: sha256(arms.test)
    },
    preAdvanceValidation: {
      controlByteIdenticalToSource: sha256(arms.control) === EXPECTED_SOURCE_SHA256,
      shamFocusedSemanticDifferences: shamDifferences,
      testFocusedSemanticDifferences: testDifferences,
      status: 'passed'
    },
    nextAction: 'Human operator advances each arm exactly once from BW3 to EOS, captures Staff Moves for all four target coaches, and saves three distinct EOS results.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
