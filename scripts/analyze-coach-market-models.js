/* Compare grouped out-of-sample coach market models using native offer observations. */
'use strict';

const fs = require('fs');
const path = require('path');

const GRADES = [
  'F', 'Dminus', 'D', 'Dplus', 'Cminus', 'C', 'Cplus',
  'Bminus', 'B', 'Bplus', 'Aminus', 'A', 'Aplus'
];
const ROLES = ['HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator'];

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function solve(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 1e-10) return null;
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  return augmented.map((row) => row[size]);
}

function fit(train, featureNames, target) {
  const numeric = featureNames.filter((name) => name !== 'intercept' && !name.startsWith('role_'));
  const stats = Object.fromEntries(numeric.map((name) => {
    const values = train.map((row) => row.features[name]);
    const average = mean(values);
    const deviation = Math.sqrt(mean(values.map((value) => (value - average) ** 2))) || 1;
    return [name, { mean: average, deviation }];
  }));
  const vector = (row) => featureNames.map((name) => {
    if (name === 'intercept') return 1;
    const value = row.features[name];
    return stats[name] ? (value - stats[name].mean) / stats[name].deviation : value;
  });
  const width = featureNames.length;
  const xtx = Array.from({ length: width }, () => Array(width).fill(0));
  const xty = Array(width).fill(0);
  for (const row of train) {
    const x = vector(row);
    const y = row[target];
    for (let left = 0; left < width; left += 1) {
      xty[left] += x[left] * y;
      for (let right = 0; right < width; right += 1) xtx[left][right] += x[left] * x[right];
    }
  }
  for (let index = 1; index < width; index += 1) xtx[index][index] += 1e-6;
  const coefficients = solve(xtx, xty);
  if (!coefficients) throw new Error(`Singular model: ${featureNames.join(', ')}`);
  return { predict: (row) => vector(row).reduce((sum, value, index) => sum + value * coefficients[index], 0) };
}

function metrics(actual, predicted) {
  const errors = actual.map((value, index) => predicted[index] - value);
  const absolute = errors.map(Math.abs);
  const targetMean = mean(actual);
  const residualSquare = errors.reduce((sum, value) => sum + value ** 2, 0);
  const totalSquare = actual.reduce((sum, value) => sum + (value - targetMean) ** 2, 0);
  return {
    samples: actual.length,
    meanAbsoluteError: Number(mean(absolute).toFixed(3)),
    medianAbsoluteError: Number(median(absolute).toFixed(3)),
    rootMeanSquaredError: Number(Math.sqrt(mean(errors.map((value) => value ** 2))).toFixed(3)),
    rSquared: Number((1 - residualSquare / totalSquare).toFixed(4))
  };
}

function modelFeatures(parts) {
  const names = ['intercept', 'role_OffensiveCoordinator', 'role_DefensiveCoordinator'];
  for (const part of parts) {
    for (const role of ROLES) names.push(`${part}_${role}`);
  }
  return names;
}

const MODELS = {
  roleOnly: modelFeatures([]),
  roleLevel: modelFeatures(['level']),
  roleGrade: modelFeatures(['grade']),
  roleScore: modelFeatures(['score']),
  roleLevelGrade: modelFeatures(['level', 'grade']),
  roleLevelScore: modelFeatures(['level', 'score']),
  roleLevelGradeScore: modelFeatures(['level', 'grade', 'score'])
};

function featureValues(role, coach) {
  const features = {
    role_OffensiveCoordinator: role === 'OffensiveCoordinator' ? 1 : 0,
    role_DefensiveCoordinator: role === 'DefensiveCoordinator' ? 1 : 0
  };
  for (const currentRole of ROLES) {
    const active = currentRole === role ? 1 : 0;
    features[`level_${currentRole}`] = active * Number(coach.Level || 0);
    features[`grade_${currentRole}`] = active * Math.max(0, GRADES.indexOf(coach.CoachPrestige));
    features[`score_${currentRole}`] = active * Number(coach.CoachPrestigeScore || 0);
  }
  return features;
}

function observations(report) {
  const result = [];
  for (const snapshot of report.snapshots) {
    const coachByReference = new Map(Object.entries(snapshot.data.coaches).map(([reference, coach]) => [reference, coach]));
    for (const offer of Object.values(snapshot.data.offers)) {
      const coach = coachByReference.get(offer.StaffPerson);
      if (!coach || !ROLES.includes(offer.ContractPosition)) continue;
      result.push({
        stage: snapshot.stage,
        coachRow: coach.row,
        coach: coach.name,
        opening: `${snapshot.stage}|${offer.Team}|${offer.ContractPosition}`,
        role: offer.ContractPosition,
        expectedProgramPoints: Number(offer.ExpectedContractProgramPoints),
        teamInterest: Number(offer.TeamInterestInStaffPerson),
        features: featureValues(offer.ContractPosition, coach.fields)
      });
    }
  }
  return result;
}

function crossValidate(rows, target, groupField, featureNames, folds = 5) {
  const predictions = [];
  const actual = [];
  for (let fold = 0; fold < folds; fold += 1) {
    const test = rows.filter((row) => hash(row[groupField]) % folds === fold);
    const train = rows.filter((row) => hash(row[groupField]) % folds !== fold);
    if (!test.length || !train.length) continue;
    const model = fit(train, featureNames, target);
    for (const row of test) {
      actual.push(row[target]);
      predictions.push(model.predict(row));
    }
  }
  return metrics(actual, predictions);
}

function evaluateDataset(rows, target) {
  const overall = Object.fromEntries(Object.entries(MODELS).map(([name, features]) => [name, {
    groupedByCoach: crossValidate(rows, target, 'coachRow', features),
    groupedByOpening: crossValidate(rows, target, 'opening', features)
  }]));
  const byRole = Object.fromEntries(ROLES.map((role) => {
    const roleRows = rows.filter((row) => row.role === role);
    return [role, {
      observations: roleRows.length,
      results: Object.fromEntries(Object.entries(MODELS).map(([name, features]) => [name, {
        groupedByCoach: crossValidate(roleRows, target, 'coachRow', features),
        groupedByOpening: crossValidate(roleRows, target, 'opening', features)
      }]))
    }];
  }));
  return { overall, byRole };
}

function main() {
  const input = path.resolve(process.argv[2] || path.join(process.env.TEMP || '.', 'ccr-weekly-prestige-analysis.json'));
  const output = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const report = JSON.parse(fs.readFileSync(input, 'utf8'));
  const all = observations(report);
  const pricing = all.filter((row) => ['CONFCHAMP', 'BW1', 'BW2'].includes(row.stage) && row.expectedProgramPoints > 0);
  const openMarket = all.filter((row) => row.stage === 'BW1');
  const result = {
    generatedAt: new Date().toISOString(),
    sourceReport: input,
    method: 'Five-fold linear ridge models with role-specific slopes. Validation groups keep all observations for the same coach or opening in one fold.',
    modelDefinitions: Object.fromEntries(Object.entries(MODELS).map(([name, features]) => [name, features])),
    expectedProgramPoints: {
      observations: pricing.length,
      uniqueCoaches: new Set(pricing.map((row) => row.coachRow)).size,
      uniqueOpenings: new Set(pricing.map((row) => row.opening)).size,
      stages: Object.fromEntries([...pricing.reduce((map, row) => map.set(row.stage, (map.get(row.stage) || 0) + 1), new Map())]),
      results: evaluateDataset(pricing, 'expectedProgramPoints')
    },
    bw1TeamInterest: {
      observations: openMarket.length,
      uniqueCoaches: new Set(openMarket.map((row) => row.coachRow)).size,
      uniqueOpenings: new Set(openMarket.map((row) => row.opening)).size,
      results: evaluateDataset(openMarket, 'teamInterest')
    }
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (output) fs.writeFileSync(output, json);
  else process.stdout.write(json);
}

main();
