/* Prepare E1: test whether EOS preserves a pool-conserving BW3 staff-point split. */
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
const TEAM_NAME = 'Air Force';
const AMOUNT = 25;

function options(argv) {
  const result = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-program-points-split')
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--write') result.write = true;
    else if (argv[index] === '--source') result.source = argv[++index];
    else if (argv[index] === '--output-dir') result.outputDirectory = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  result.source = path.resolve(result.source);
  result.outputDirectory = path.resolve(result.outputDirectory);
  return result;
}

function teamState(state) {
  const team = state.tables.teams.records[TEAM_ROW];
  assert(team && !team.isEmpty && displayName(team) === TEAM_NAME, `Expected ${TEAM_NAME} at Team row ${TEAM_ROW}.`);
  return {
    remaining: team.RemainingProgramPoints,
    staffSpent: team.StaffProgramPointsSpent,
    total: team.RemainingProgramPoints + team.StaffProgramPointsSpent,
    nilSpent: team.NILProgramPointsSpent
  };
}

function mutate(state) {
  const team = state.tables.teams.records[TEAM_ROW];
  assert(team.StaffProgramPointsSpent >= AMOUNT, 'Insufficient StaffProgramPointsSpent for treatment.');
  team.RemainingProgramPoints += AMOUNT;
  team.StaffProgramPointsSpent -= AMOUNT;
}

function ensureAbsent(paths) {
  for (const filePath of Object.values(paths)) assert(!fs.existsSync(filePath), `Refusing to overwrite ${filePath}`);
}

async function main() {
  const config = options(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  assert(fs.existsSync(config.source), `Source not found: ${config.source}`);
  assert(sha256(config.source) === SOURCE_HASH, 'Source BW3 fixture hash mismatch.');
  const baseline = await loadExperimentState(config.source, schema);
  const before = teamState(baseline);
  assert(before.remaining === 180 && before.staffSpent === 360 && before.total === 540, `Unexpected ${TEAM_NAME} BW3 point state.`);
  const snapshot = focusedSnapshot(baseline.tables);
  const files = {
    control: path.join(config.outputDirectory, 'DYNASTY-CCRY1BW3-E1-CONTROL'),
    sham: path.join(config.outputDirectory, 'DYNASTY-CCRY1BW3-E1-SHAM'),
    treatment: path.join(config.outputDirectory, 'DYNASTY-CCRY1BW3-E1-SPLIT25'),
    manifest: path.join(config.outputDirectory, 'experiment-manifest.json')
  };
  if (!config.write) {
    process.stdout.write(`${JSON.stringify({ mode: 'preview', source: config.source, before, mutation: { team: TEAM_NAME, amount: AMOUNT }, files }, null, 2)}\n`);
    return;
  }
  ensureAbsent({ ...files, shamTemp: `${files.sham}.tmp`, treatmentTemp: `${files.treatment}.tmp` });
  fs.mkdirSync(config.outputDirectory, { recursive: true });
  fs.copyFileSync(config.source, files.control);
  assert(sha256(files.control) === SOURCE_HASH, 'Control is not byte-identical to source.');

  const shamWrite = await loadExperimentState(config.source, schema);
  await saveToTemporary(shamWrite.franchise, `${files.sham}.tmp`);
  const sham = await loadExperimentState(`${files.sham}.tmp`, schema);
  const shamDifferences = collectDifferences(snapshot, focusedSnapshot(sham.tables));
  assert(shamDifferences.length === 0, `Sham introduced ${shamDifferences.length} focused semantic changes.`);
  fs.renameSync(`${files.sham}.tmp`, files.sham);

  const treatmentWrite = await loadExperimentState(config.source, schema);
  mutate(treatmentWrite);
  await saveToTemporary(treatmentWrite.franchise, `${files.treatment}.tmp`);
  const treatment = await loadExperimentState(`${files.treatment}.tmp`, schema);
  const after = teamState(treatment);
  assert(after.remaining === before.remaining + AMOUNT, 'RemainingProgramPoints treatment did not persist.');
  assert(after.staffSpent === before.staffSpent - AMOUNT, 'StaffProgramPointsSpent treatment did not persist.');
  assert(after.total === before.total, 'Treatment changed the Team staff-accessible pool.');
  assert(after.nilSpent === before.nilSpent, 'Treatment changed NILProgramPointsSpent.');
  const treatmentDifferences = collectDifferences(snapshot, focusedSnapshot(treatment.tables));
  const semantic = treatmentDifferences.filter((change) => !(change.table === 'teams' && change.row === TEAM_ROW && ['RemainingProgramPoints', 'StaffProgramPointsSpent'].includes(change.field)));
  assert(semantic.length === 0, `Treatment introduced unrelated changes: ${JSON.stringify(semantic)}`);
  assert(treatmentDifferences.length === 2, `Expected exactly two treatment differences, found ${treatmentDifferences.length}.`);
  fs.renameSync(`${files.treatment}.tmp`, files.treatment);

  const manifest = {
    createdAt: new Date().toISOString(),
    source: config.source,
    schema: baseline.declaredSchema,
    hashes: {
      source: sha256(config.source),
      control: sha256(files.control),
      sham: sha256(files.sham),
      treatment: sha256(files.treatment)
    },
    target: { teamRow: TEAM_ROW, team: TEAM_NAME, amount: AMOUNT },
    before,
    after,
    treatmentDifferences,
    validation: 'passed',
    nextAction: 'Human advances each arm exactly once from BW3 to EOS and returns three distinctly named EOS saves.'
  };
  fs.writeFileSync(files.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
