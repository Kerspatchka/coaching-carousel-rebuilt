/* Decompose Gate 6 EOS finance changes into landscape and staff-pricing effects. */
'use strict';

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    gate6: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate6-synthetic-full-plan', 'eos-evaluation.json'),
    gate6b: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate6b-native-price-isolation', 'eos-evaluation.json'),
    output: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate6b-native-price-isolation', 'liquidity-decomposition.json')
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--gate6') options.gate6 = argv[++index];
    else if (argv[index] === '--gate6b') options.gate6b = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  for (const key of Object.keys(options)) options[key] = path.resolve(options[key]);
  return options;
}

function readReport(file, experimentId) {
  assert(fs.existsSync(file), `Missing ${experimentId} report: ${file}`);
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(report.experimentId === experimentId, `${file} is not a ${experimentId} report.`);
  assert(['passed', 'partial'].includes(report.status), `${experimentId} core validation did not pass.`);
  return report;
}

function fieldDelta(after, before) {
  return {
    remaining: after.remaining - before.remaining,
    staffSpent: after.staffSpent - before.staffSpent,
    nilSpent: after.nilSpent - before.nilSpent,
    rollover: after.rollover - before.rollover,
    programPointBudget: after.programPointBudget - before.programPointBudget,
    staffPool: after.staffPool - before.staffPool
  };
}

function classifyPricingRoute(priceDelta, effect) {
  if (priceDelta === 0 && Object.values(effect).every((value) => value === 0)) return 'no-price-change';
  if (effect.staffSpent === priceDelta && effect.remaining === -priceDelta && effect.nilSpent === 0 &&
    effect.rollover === 0 && effect.programPointBudget === 0 && effect.staffPool === 0) return 'remaining';
  if (effect.staffSpent === priceDelta && effect.remaining === 0 && effect.nilSpent === 0 &&
    effect.rollover === priceDelta && effect.programPointBudget === priceDelta && effect.staffPool === priceDelta) return 'rollover-budget';
  return 'mixed';
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const gate6 = readReport(options.gate6, 'G6');
  const gate6b = readReport(options.gate6b, 'G6B');
  const gate6ByTeam = new Map(gate6.finances.results.map((result) => [result.teamRow, result]));
  assert(gate6ByTeam.size === gate6b.finances.results.length, 'Gate 6 and Gate 6B finance Team sets differ.');

  const teams = gate6b.finances.results.map((nativePrice) => {
    const priced = gate6ByTeam.get(nativePrice.teamRow);
    assert(priced, `Gate 6 is missing Team row ${nativePrice.teamRow}.`);
    const landscapeEffect = fieldDelta(nativePrice.observed, nativePrice.expected);
    const pricingEffect = fieldDelta(priced.observed, nativePrice.observed);
    const pricingRoute = classifyPricingRoute(priced.priceDelta, pricingEffect);
    return {
      teamRow: nativePrice.teamRow,
      team: nativePrice.team,
      gate6PriceDelta: priced.priceDelta,
      nativeCounterfactual: nativePrice.expected,
      gate6bNativePriceObserved: nativePrice.observed,
      gate6PricedObserved: priced.observed,
      landscapeEffect,
      pricingEffect,
      landscapeLiquidityVariance: !nativePrice.liquidityMatched,
      pricingRoute
    };
  });
  const routeCounts = Object.fromEntries([...new Set(teams.map((team) => team.pricingRoute))]
    .sort().map((route) => [route, teams.filter((team) => team.pricingRoute === route).length]));
  const mixed = teams.filter((team) => team.pricingRoute === 'mixed');
  assert(mixed.length === 0, `Unclassified pricing effects: ${JSON.stringify(mixed)}`);
  const landscapeVarianceTeams = teams.filter((team) => team.landscapeLiquidityVariance);

  const report = {
    analyzedAt: new Date().toISOString(),
    experimentId: 'G6B',
    status: 'passed',
    inputs: { gate6: options.gate6, gate6b: options.gate6b },
    summary: {
      teamsCompared: teams.length,
      teamsWithNonzeroGate6PriceDelta: teams.filter((team) => team.gate6PriceDelta !== 0).length,
      landscapeLiquidityVarianceCount: landscapeVarianceTeams.length,
      landscapeLiquidityVarianceTeams: landscapeVarianceTeams.map((team) => team.team),
      pricingRouteCounts: routeCounts,
      mixedPricingEffects: mixed.length
    },
    conclusions: {
      landscapeCanChangeEosLiquidityAtZeroStaffPriceDelta: landscapeVarianceTeams.length > 0,
      staffPriceEffectIsAdditiveToLandscapeEffect: mixed.length === 0,
      normalPriceSettlementRoute: 'Final-price delta changes staff expense and remaining points by equal and opposite amounts.',
      rolloverLimitedPriceSettlementRoute: 'For Houston and Liberty, a staff-price reduction changed rollover and total ProgramPointBudget instead of remaining points.',
      exactRemainingLiquidityUniversallyPredictableFromPriceDeltaAlone: false
    },
    teams
  };
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...report, teams: `[${teams.length} teams]` }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

