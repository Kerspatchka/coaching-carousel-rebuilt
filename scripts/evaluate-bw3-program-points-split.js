/* Evaluate the one-off E1 save against the existing native EOS reference fixture. */
'use strict';

const fs = require('fs');
const path = require('path');
const { assert, collectDifferences, displayName, focusedSnapshot, loadExperimentState } = require('./prepare-bw3-selected-coach-swap');

const TEAM_ROW = 0;
const AMOUNT = 25;

function parse(argv) {
  const result = {
    reference: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1EOS'),
    test: null,
    output: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--reference') result.reference = path.resolve(argv[++index]);
    else if (name === '--test' || name === '--treatment') result.test = path.resolve(argv[++index]);
    else if (name === '--output') result.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${name}`);
  }
  assert(fs.existsSync(result.reference), `Reference EOS save not found: ${result.reference}`);
  assert(result.test && fs.existsSync(result.test), 'Missing --test EOS save.');
  return result;
}
function values(state) {
  const team = state.tables.teams.records[TEAM_ROW];
  assert(team && !team.isEmpty && displayName(team) === 'Air Force', 'Air Force Team row mismatch.');
  return { remaining: team.RemainingProgramPoints, staffSpent: team.StaffProgramPointsSpent, total: team.RemainingProgramPoints + team.StaffProgramPointsSpent, nilSpent: team.NILProgramPointsSpent };
}
async function main() {
  const args = parse(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const states = {
    reference: await loadExperimentState(args.reference, schema),
    test: await loadExperimentState(args.test, schema)
  };
  const result = Object.fromEntries(Object.entries(states).map(([name, state]) => [name, values(state)]));
  const targetDifferences = collectDifferences(focusedSnapshot(states.reference.tables), focusedSnapshot(states.test.tables))
    .filter((change) => change.table === 'teams' && change.row === TEAM_ROW);
  const pass = result.test.staffSpent === result.reference.staffSpent - AMOUNT &&
    result.test.remaining === result.reference.remaining + AMOUNT &&
    result.test.total === result.reference.total &&
    result.test.nilSpent === result.reference.nilSpent;
  const report = {
    evaluatedAt: new Date().toISOString(),
    files: args,
    comparisonBasis: 'Existing native EOS fixture from the identical BW3 source; no new control or sham advance required.',
    airForce: result,
    testVsReferenceTargetDifferences: targetDifferences,
    expectedPersistentDelta: { remainingProgramPoints: AMOUNT, staffProgramPointsSpent: -AMOUNT },
    status: pass ? 'passed' : 'failed'
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) fs.writeFileSync(args.output, json); else process.stdout.write(json);
  if (!pass) process.exitCode = 1;
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
