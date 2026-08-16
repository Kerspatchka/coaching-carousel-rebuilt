/* Summarize coach-prestige behavior from analyze-carousel-saves.js output. */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GRADES = [
  'F', 'Dminus', 'D', 'Dplus', 'Cminus', 'C', 'Cplus',
  'Bminus', 'B', 'Bplus', 'Aminus', 'A', 'Aplus'
];

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function correlation(rows, left, right) {
  if (rows.length < 2) return null;
  const xs = rows.map(left);
  const ys = rows.map(right);
  const xMean = mean(xs);
  const yMean = mean(ys);
  let numerator = 0;
  let xSquare = 0;
  let ySquare = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const x = xs[index] - xMean;
    const y = ys[index] - yMean;
    numerator += x * y;
    xSquare += x * x;
    ySquare += y * y;
  }
  const denominator = Math.sqrt(xSquare * ySquare);
  return denominator ? numerator / denominator : null;
}

function rounded(value, digits = 4) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function coaches(snapshot) {
  return Object.entries(snapshot.data.coaches).map(([reference, coach]) => ({
    reference,
    row: coach.row,
    name: coach.name,
    ...coach.fields
  }));
}

function gradeDistribution(snapshot) {
  const rows = coaches(snapshot);
  return Object.fromEntries(GRADES.map((grade) => {
    const matching = rows.filter((coach) => coach.CoachPrestige === grade);
    const scores = matching.map((coach) => Number(coach.CoachPrestigeScore));
    return [grade, {
      coaches: matching.length,
      minimumScore: scores.length ? Math.min(...scores) : null,
      maximumScore: scores.length ? Math.max(...scores) : null,
      distinctScores: new Set(scores).size
    }];
  }));
}

function transitionSummary(from, to) {
  const prior = new Map(coaches(from).map((coach) => [coach.row, coach]));
  const current = coaches(to);
  const scoreDeltas = new Map();
  const gradeMoves = new Map();
  let scoreChanges = 0;
  let gradeChanges = 0;
  let bothChanges = 0;
  for (const coach of current) {
    const old = prior.get(coach.row);
    if (!old) continue;
    const scoreDelta = Number(coach.CoachPrestigeScore) - Number(old.CoachPrestigeScore);
    const oldGrade = GRADES.indexOf(old.CoachPrestige);
    const newGrade = GRADES.indexOf(coach.CoachPrestige);
    const gradeMove = oldGrade >= 0 && newGrade >= 0 ? newGrade - oldGrade : 0;
    if (scoreDelta !== 0) {
      scoreChanges += 1;
      scoreDeltas.set(scoreDelta, (scoreDeltas.get(scoreDelta) || 0) + 1);
    }
    if (old.CoachPrestige !== coach.CoachPrestige) gradeChanges += 1;
    if (scoreDelta !== 0 && old.CoachPrestige !== coach.CoachPrestige) bothChanges += 1;
    if (gradeMove !== 0) gradeMoves.set(gradeMove, (gradeMoves.get(gradeMove) || 0) + 1);
  }

  const byTeam = new Map();
  for (const coach of current.filter((item) => Number(item.TeamIndex) !== 255)) {
    const old = prior.get(coach.row);
    if (!old) continue;
    const delta = Number(coach.CoachPrestigeScore) - Number(old.CoachPrestigeScore);
    if (!byTeam.has(coach.TeamIndex)) byTeam.set(coach.TeamIndex, []);
    byTeam.get(coach.TeamIndex).push(delta);
  }
  const teamGroups = [...byTeam.values()];
  const uniformTeams = teamGroups.filter((deltas) => new Set(deltas).size === 1).length;

  return {
    from: from.stage,
    to: to.stage,
    scoreChanges,
    gradeChanges,
    bothChanges,
    scoreOnlyChanges: scoreChanges - bothChanges,
    gradeOnlyChanges: gradeChanges - bothChanges,
    scoreDeltas: Object.fromEntries([...scoreDeltas].sort((a, b) => a[0] - b[0])),
    gradeMoves: Object.fromEntries([...gradeMoves].sort((a, b) => a[0] - b[0])),
    activeTeamDeltaConsistency: {
      teams: teamGroups.length,
      uniformAcrossCurrentStaff: uniformTeams,
      divergentAcrossCurrentStaff: teamGroups.length - uniformTeams
    }
  };
}

function marketEvidence(snapshots) {
  const bw1 = snapshots.find((snapshot) => snapshot.stage === 'BW1');
  const bw2 = snapshots.find((snapshot) => snapshot.stage === 'BW2');
  if (!bw1 || !bw2) return null;
  const coachByReference = new Map(coaches(bw1).map((coach) => [coach.reference, coach]));
  const winners = new Map(Object.values(bw2.data.openings)
    .filter((opening) => opening.Filled)
    .map((opening) => [`${opening.Team}|${opening.Position}`, opening.SelectedCoach]));
  const offers = Object.values(bw1.data.offers)
    .filter((offer) => offer.ContractPosition !== 'Invalid_')
    .map((offer) => {
      const coach = coachByReference.get(offer.StaffPerson);
      return {
        ...offer,
        coach,
        gradeIndex: coach ? GRADES.indexOf(coach.CoachPrestige) : -1,
        isNextCheckpointWinner: winners.get(`${offer.Team}|${offer.ContractPosition}`) === offer.StaffPerson
      };
    })
    .filter((offer) => offer.coach);

  return Object.fromEntries(['HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator'].map((role) => {
    const rows = offers.filter((offer) => offer.ContractPosition === role);
    const winnersForRole = rows.filter((offer) => offer.isNextCheckpointWinner);
    const others = rows.filter((offer) => !offer.isNextCheckpointWinner);
    const metric = (source, target) => rounded(correlation(rows, source, target));
    return [role, {
      offers: rows.length,
      uniqueCandidates: new Set(rows.map((offer) => offer.StaffPerson)).size,
      nextCheckpointWinners: winnersForRole.length,
      correlations: {
        gradeToTeamInterest: metric((offer) => offer.gradeIndex, (offer) => Number(offer.TeamInterestInStaffPerson)),
        scoreToTeamInterest: metric((offer) => Number(offer.coach.CoachPrestigeScore), (offer) => Number(offer.TeamInterestInStaffPerson)),
        levelToTeamInterest: metric((offer) => Number(offer.coach.Level), (offer) => Number(offer.TeamInterestInStaffPerson)),
        gradeToExpectedProgramPoints: metric((offer) => offer.gradeIndex, (offer) => Number(offer.ExpectedContractProgramPoints)),
        scoreToExpectedProgramPoints: metric((offer) => Number(offer.coach.CoachPrestigeScore), (offer) => Number(offer.ExpectedContractProgramPoints)),
        levelToExpectedProgramPoints: metric((offer) => Number(offer.coach.Level), (offer) => Number(offer.ExpectedContractProgramPoints))
      },
      winnerComparison: {
        averageWinnerGradeIndex: rounded(mean(winnersForRole.map((offer) => offer.gradeIndex))),
        averageOtherGradeIndex: rounded(mean(others.map((offer) => offer.gradeIndex))),
        averageWinnerScore: rounded(mean(winnersForRole.map((offer) => Number(offer.coach.CoachPrestigeScore)))),
        averageOtherScore: rounded(mean(others.map((offer) => Number(offer.coach.CoachPrestigeScore)))),
        averageWinnerTeamInterest: rounded(mean(winnersForRole.map((offer) => Number(offer.TeamInterestInStaffPerson)))),
        averageOtherTeamInterest: rounded(mean(others.map((offer) => Number(offer.TeamInterestInStaffPerson))))
      }
    }];
  }));
}

function schemaEvidence(schemaPath) {
  if (!schemaPath || !fs.existsSync(schemaPath)) return null;
  const schema = JSON.parse(zlib.gunzipSync(fs.readFileSync(schemaPath)));
  const tuning = schema.schemas.find((entry) => entry.name === 'StaffHiringTuning');
  const mySchool = schema.schemas.find((entry) => entry.name === 'MySchoolCoachPrestigeTuning');
  const relevant = /Prestige|CoachLevel|JobSecurity|Interest|ProgramPoints|Coordinator/i;
  return {
    declaredSchema: schema.meta,
    staffHiringTuningFields: tuning.attributes.map((attribute) => attribute.name).filter((name) => relevant.test(name)),
    mySchoolCoachPrestigeTuningFields: mySchool.attributes.map((attribute) => attribute.name)
  };
}

function main() {
  const input = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(process.env.TEMP || '.', 'ccr-weekly-prestige-analysis.json');
  const output = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (!fs.existsSync(input)) throw new Error(`Missing weekly analysis report: ${input}`);
  const report = JSON.parse(fs.readFileSync(input, 'utf8'));
  const snapshots = report.snapshots;
  const result = {
    generatedAt: new Date().toISOString(),
    sourceReport: input,
    method: 'Read-only summary of CoachPrestige, CoachPrestigeScore, weekly transitions, and BW1 offer-market relationships.',
    gradeDistributions: Object.fromEntries(snapshots.map((snapshot) => [snapshot.stage, gradeDistribution(snapshot)])),
    transitions: snapshots.slice(1).map((snapshot, index) => transitionSummary(snapshots[index], snapshot)),
    bw1MarketEvidence: marketEvidence(snapshots),
    schemaEvidence: schemaEvidence(process.env.CCR_SCHEMA_PATH)
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (output) fs.writeFileSync(output, json);
  else process.stdout.write(json);
}

main();
