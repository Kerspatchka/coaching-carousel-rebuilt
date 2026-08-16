/* Evaluate E1F against the existing native EOS reference fixture. */
'use strict';

const fs = require('fs');
const path = require('path');
const { assert, collectDifferences, displayName, focusedSnapshot, loadExperimentState } = require('./prepare-bw3-selected-coach-swap');

const TEAM_ROW = 55;
const AMOUNT = 25;

function parseArgs(argv) {
  const options = {
    reference: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1EOS'),
    test: null,
    output: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--reference') options.reference = path.resolve(argv[++index]);
    else if (item === '--test') options.test = path.resolve(argv[++index]);
    else if (item === '--output') options.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${item}`);
  }
  assert(fs.existsSync(options.reference), `Reference not found: ${options.reference}`);
  assert(options.test && fs.existsSync(options.test), 'Missing --test EOS save.');
  return options;
}

function values(state) {
  const team = state.tables.teams.records[TEAM_ROW];
  assert(team && !team.isEmpty && displayName(team) === 'Kent State', 'Kent State Team row mismatch.');
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const reference = await loadExperimentState(options.reference, schema);
  const test = await loadExperimentState(options.test, schema);
  const result = { reference: values(reference), test: values(test) };
  const targetDifferences = collectDifferences(focusedSnapshot(reference.tables), focusedSnapshot(test.tables))
    .filter((change) => change.table === 'teams' && change.row === TEAM_ROW);
  const pass = result.test.remaining === result.reference.remaining + AMOUNT &&
    result.test.staffSpent === result.reference.staffSpent - AMOUNT &&
    result.test.headCoachBudget === result.reference.headCoachBudget - AMOUNT &&
    result.test.rollover === result.reference.rollover &&
    result.test.programPointBudget === result.reference.programPointBudget &&
    result.test.offensiveCoordinatorBudget === result.reference.offensiveCoordinatorBudget &&
    result.test.defensiveCoordinatorBudget === result.reference.defensiveCoordinatorBudget &&
    result.test.staffPool === result.reference.staffPool &&
    result.test.nilSpent === result.reference.nilSpent;
  const report = {
    evaluatedAt: new Date().toISOString(),
    files: options,
    kentState: result,
    testVsReferenceTargetDifferences: targetDifferences,
    expectedTrueRefundDelta: {
      remainingProgramPoints: AMOUNT,
      staffProgramPointsSpent: -AMOUNT,
      headCoachProgramPointBudget: -AMOUNT,
      rolloverProgramPoints: 0,
      programPointBudget: 0
    },
    status: pass ? 'passed' : 'failed'
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json); else process.stdout.write(json);
  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
