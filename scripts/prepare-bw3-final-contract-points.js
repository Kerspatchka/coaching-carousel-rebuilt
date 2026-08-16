/* Prepare E1F: isolate a resolved opening's final contract-program-point value. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  assert,
  collectDifferences,
  displayName,
  focusedSnapshot,
  loadExperimentState,
  saveToTemporary,
  sha256
} = require('./prepare-bw3-selected-coach-swap');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const TEAM_ROW = 55;
const OPENING_ROW = 108;
const BEFORE_FINAL_POINTS = 30;
const AFTER_FINAL_POINTS = 5;

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-final-contract-points')
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

function stateSummary(state) {
  const team = state.tables.teams.records[TEAM_ROW];
  const opening = state.tables.openings.records[OPENING_ROW];
  assert(team && !team.isEmpty && displayName(team) === 'Kent State', 'Kent State Team row mismatch.');
  assert(opening && !opening.isEmpty, 'Kent State opening row is empty.');
  return {
    team: displayName(team),
    openingRow: OPENING_ROW,
    position: opening.Position,
    filled: opening.Filled,
    highestOfferedProgramPoints: opening.HighestOfferedProgramPoints,
    finalContractProgramPoints: opening.FinalContractProgramPoints,
    remaining: team.RemainingProgramPoints,
    staffSpent: team.StaffProgramPointsSpent,
    headCoachBudget: team.HeadCoachProgramPointBudget,
    offensiveCoordinatorBudget: team.OffensiveCoordinatorPointBudget,
    defensiveCoordinatorBudget: team.DefensiveCoordinatorPointBudget,
    rollover: team.RolloverProgramPoints,
    programPointBudget: team.ProgramPointBudget,
    nilSpent: team.NILProgramPointsSpent
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  assert(fs.existsSync(options.source), `Source not found: ${options.source}`);
  assert(sha256(options.source) === SOURCE_HASH, 'Source BW3 fixture hash mismatch.');
  const baseline = await loadExperimentState(options.source, schema);
  const before = stateSummary(baseline);
  assert(before.position === 'HeadCoach' && before.filled === true, 'Unexpected Kent State opening state.');
  assert(before.highestOfferedProgramPoints === 55 && before.finalContractProgramPoints === BEFORE_FINAL_POINTS, 'Unexpected Kent State contract-point baseline.');
  assert(before.remaining === 185 && before.staffSpent === 30 && before.headCoachBudget === 120, 'Unexpected Kent State Team baseline.');
  const sourceSnapshot = focusedSnapshot(baseline.tables);
  const output = path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-E1F-FINAL5');
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  const preview = { mode: options.write ? 'write' : 'preview', source: options.source, output, before, mutation: { table: 'openings', row: OPENING_ROW, field: 'FinalContractProgramPoints', from: BEFORE_FINAL_POINTS, to: AFTER_FINAL_POINTS } };
  if (!options.write) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return;
  }
  for (const filePath of [output, `${output}.tmp`, manifestPath]) assert(!fs.existsSync(filePath), `Refusing to overwrite ${filePath}`);
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const treatment = await loadExperimentState(options.source, schema);
  treatment.tables.openings.records[OPENING_ROW].FinalContractProgramPoints = AFTER_FINAL_POINTS;
  await saveToTemporary(treatment.franchise, `${output}.tmp`);
  const reopened = await loadExperimentState(`${output}.tmp`, schema);
  const after = stateSummary(reopened);
  assert(after.finalContractProgramPoints === AFTER_FINAL_POINTS, 'FinalContractProgramPoints treatment did not persist.');
  assert(after.highestOfferedProgramPoints === before.highestOfferedProgramPoints, 'HighestOfferedProgramPoints changed unexpectedly.');
  for (const field of ['remaining', 'staffSpent', 'headCoachBudget', 'offensiveCoordinatorBudget', 'defensiveCoordinatorBudget', 'rollover', 'programPointBudget', 'nilSpent']) {
    assert(after[field] === before[field], `${field} changed unexpectedly.`);
  }
  const differences = collectDifferences(sourceSnapshot, focusedSnapshot(reopened.tables));
  assert(differences.length === 1, `Expected one semantic difference, found ${differences.length}.`);
  const [change] = differences;
  assert(change.table === 'openings' && change.row === OPENING_ROW && change.field === 'FinalContractProgramPoints', `Unexpected semantic change: ${JSON.stringify(change)}`);
  fs.renameSync(`${output}.tmp`, output);
  const manifest = {
    ...preview,
    mode: 'write',
    createdAt: new Date().toISOString(),
    schema: reopened.declaredSchema,
    after,
    differences,
    hashes: { source: sha256(options.source), treatment: sha256(output) },
    validation: 'passed',
    nextAction: 'Human loads the one-off treatment at BW3, advances exactly once to EOS, and returns one distinctly named EOS save.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
