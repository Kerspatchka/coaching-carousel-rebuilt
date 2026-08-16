/* Build and backtest a deterministic coach-price model from the forensic JSON report. */
'use strict';

const fs = require('fs');
const path = require('path');

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function round5(value) { return Math.max(0, Math.round(value / 5) * 5); }
function band(level) { return Math.floor((Number(level) || 0) / 5) * 5; }
function key(role, level) { return `${role}:${band(level)}`; }

function main() {
  const input = path.resolve(process.argv[2] || path.join(process.env.TEMP || '.', 'nil-coordinator-offers.json'));
  const output = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const report = JSON.parse(fs.readFileSync(input, 'utf8'));
  const coachByStage = new Map(report.stages.map((stage) => [stage.stage, new Map(stage.coachContracts.map((coach) => [coach.row, coach]))]));
  const observations = [];
  for (const stage of report.stages.filter((item) => ['CONFCHAMP', 'BW1', 'BW2'].includes(item.stage))) {
    const coaches = coachByStage.get(stage.stage);
    for (const offer of stage.allOffers) {
      const expected = Number(offer.expectedContractProgramPoints);
      const coach = coaches.get(offer.coach.row);
      if (!coach || !Number.isFinite(expected) || expected <= 0 || offer.position === 'Invalid_') continue;
      observations.push({ stage: stage.stage, coachRow: coach.row, coach: coach.name, offeredRole: offer.position, level: Number(coach.level) || 0, expected });
    }
  }
  const byKey = new Map();
  const byRole = new Map();
  for (const row of observations) {
    const bucket = key(row.offeredRole, row.level);
    if (!byKey.has(bucket)) byKey.set(bucket, []);
    byKey.get(bucket).push(row.expected);
    if (!byRole.has(row.offeredRole)) byRole.set(row.offeredRole, []);
    byRole.get(row.offeredRole).push(row.expected);
  }
  const cells = Object.fromEntries([...byKey].map(([bucket, values]) => [bucket, { samples: values.length, price: round5(median(values)), rawMedian: median(values) }]));
  const roleFallbacks = Object.fromEntries([...byRole].map(([role, values]) => [role, { samples: values.length, price: round5(median(values)) }]));
  function predict(role, level) {
    const cell = cells[key(role, level)];
    return cell && cell.samples >= 3 ? cell.price : (roleFallbacks[role] ? roleFallbacks[role].price : 0);
  }
  const errors = observations.map((row) => Math.abs(predict(row.offeredRole, row.level) - row.expected));
  const bw3 = report.stages.find((stage) => stage.stage === 'BW3');
  const bw3Coaches = new Map(bw3.coachContracts.map((coach) => [coach.row, coach]));
  const teamPricing = bw3.teamProgramPoints.map((team) => {
    const assignments = [
      ['HeadCoach', team.headCoachRow],
      ['OffensiveCoordinator', team.offensiveCoordinatorRow],
      ['DefensiveCoordinator', team.defensiveCoordinatorRow]
    ].map(([role, row]) => {
      const coach = bw3Coaches.get(row);
      return { role, coachRow: row, coach: coach ? coach.name : null, level: coach ? coach.level : null, price: coach ? predict(role, coach.level) : 0 };
    });
    const pool = Number(team.remainingProgramPoints) + Number(team.staffProgramPointsSpent);
    const modeledCost = assignments.reduce((sum, item) => sum + item.price, 0);
    return { teamRow: team.row, team: team.name, pool, modeledCost, residual: pool - modeledCost, affordable: modeledCost <= pool, assignments };
  });
  const result = {
    generatedAt: new Date().toISOString(),
    method: 'Median native ExpectedContractProgramPoints by offered role and five-level Coach.Level band; cells with fewer than three samples use the role median; prices rounded to five.',
    training: {
      observations: observations.length,
      roleFallbacks,
      meanAbsoluteError: errors.reduce((sum, value) => sum + value, 0) / errors.length,
      medianAbsoluteError: median(errors),
      maximumAbsoluteError: Math.max(...errors),
      cells
    },
    bw3Affordability: {
      teams: teamPricing.length,
      affordable: teamPricing.filter((team) => team.affordable).length,
      overBudget: teamPricing.filter((team) => !team.affordable).length,
      overBudgetTeams: teamPricing.filter((team) => !team.affordable),
      lowestResidualTeams: [...teamPricing].sort((a, b) => a.residual - b.residual).slice(0, 20)
    },
    teamPricing
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (output) fs.writeFileSync(output, json); else process.stdout.write(json);
}

main();
