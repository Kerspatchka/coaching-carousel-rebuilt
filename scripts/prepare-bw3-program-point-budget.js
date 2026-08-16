/* Prepare E1D: one-off Air Force role-budget reduction plus top-level budget compensation. */
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
const TEAM_ROW = 0;
const AMOUNT = 25;

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-program-point-budget')
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

function pointState(state) {
  const team = state.tables.teams.records[TEAM_ROW];
  assert(team && !team.isEmpty && displayName(team) === 'Air Force', 'Air Force Team row mismatch.');
  return {
    remaining: team.RemainingProgramPoints,
    staffSpent: team.StaffProgramPointsSpent,
    headCoachBudget: team.HeadCoachProgramPointBudget,
    offensiveCoordinatorBudget: team.OffensiveCoordinatorPointBudget,
    defensiveCoordinatorBudget: team.DefensiveCoordinatorPointBudget,
    rollover: team.RolloverProgramPoints,
    programPointBudget: team.ProgramPointBudget,
    staffPool: team.RemainingProgramPoints + team.StaffProgramPointsSpent,
    nilSpent: team.NILProgramPointsSpent
  };
}

function applyTreatment(state) {
  const team = state.tables.teams.records[TEAM_ROW];
  team.HeadCoachProgramPointBudget -= AMOUNT;
  team.StaffProgramPointsSpent -= AMOUNT;
  team.RemainingProgramPoints += AMOUNT;
  team.ProgramPointBudget += AMOUNT;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  assert(fs.existsSync(options.source), `Source not found: ${options.source}`);
  assert(sha256(options.source) === SOURCE_HASH, 'Source BW3 fixture hash mismatch.');
  const baseline = await loadExperimentState(options.source, schema);
  const before = pointState(baseline);
  assert(before.remaining === 180 && before.staffSpent === 360, 'Unexpected Air Force aggregate baseline.');
  assert(before.headCoachBudget === 330 && before.programPointBudget === 1250, 'Unexpected Air Force budget baseline.');
  assert(before.rollover === 0 && before.staffPool === 540, 'Unexpected Air Force rollover/pool baseline.');
  const sourceSnapshot = focusedSnapshot(baseline.tables);
  const output = path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-E1D-BUDGET25');
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  const preview = { mode: options.write ? 'write' : 'preview', source: options.source, output, before, mutationAmount: AMOUNT };
  if (!options.write) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return;
  }
  for (const filePath of [output, `${output}.tmp`, manifestPath]) assert(!fs.existsSync(filePath), `Refusing to overwrite ${filePath}`);
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const treatment = await loadExperimentState(options.source, schema);
  applyTreatment(treatment);
  await saveToTemporary(treatment.franchise, `${output}.tmp`);
  const reopened = await loadExperimentState(`${output}.tmp`, schema);
  const after = pointState(reopened);
  assert(after.remaining === before.remaining + AMOUNT, 'RemainingProgramPoints treatment did not persist.');
  assert(after.staffSpent === before.staffSpent - AMOUNT, 'StaffProgramPointsSpent treatment did not persist.');
  assert(after.headCoachBudget === before.headCoachBudget - AMOUNT, 'HeadCoachProgramPointBudget treatment did not persist.');
  assert(after.programPointBudget === before.programPointBudget + AMOUNT, 'ProgramPointBudget treatment did not persist.');
  assert(after.rollover === before.rollover, 'RolloverProgramPoints changed unexpectedly.');
  assert(after.staffPool === before.staffPool, 'Treatment changed the staff pool.');
  assert(after.nilSpent === before.nilSpent, 'Treatment changed NILProgramPointsSpent.');
  const differences = collectDifferences(sourceSnapshot, focusedSnapshot(reopened.tables));
  const expected = new Set(['HeadCoachProgramPointBudget', 'StaffProgramPointsSpent', 'RemainingProgramPoints', 'ProgramPointBudget']);
  assert(differences.length === expected.size, `Expected four semantic differences, found ${differences.length}.`);
  for (const change of differences) {
    assert(change.table === 'teams' && change.row === TEAM_ROW && expected.has(change.field), `Unexpected semantic change: ${JSON.stringify(change)}`);
  }
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
