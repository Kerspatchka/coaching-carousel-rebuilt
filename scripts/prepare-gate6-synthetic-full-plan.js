/* Gate 6: compile a deterministic synthetic full-scale carousel into one BW3 save. */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');
const { applyCanonicalPlan, extractPlan, refRow, validateBaseline } = require('./prepare-gate5-native-equivalent-plan');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const SEED = 'CCR-G6-2026-08-15';
const ROLES = ['HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator'];
const FORCED_CASCADE = [
  { destinationTeamRow: 12, coachRow: 118 }, // Dillingham: Arizona State -> Boise State
  { destinationTeamRow: 71, coachRow: 103 }, // Danielson: Boise State -> Mississippi State
  { destinationTeamRow: 5, coachRow: 235 } // Lebby: Mississippi State -> Arizona State
];

function parseArgs(argv) {
  const options = {
    write: false,
    pricingMode: 'capped-model',
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate6-synthetic-full-plan'),
    pricingModel: path.join(__dirname, '..', 'assets', 'analysis', 'coach-pricing-model.json'),
    gate6Manifest: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate6-synthetic-full-plan', 'experiment-manifest.json'),
    outputDirectoryExplicit: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--write') options.write = true;
    else if (argv[index] === '--source') options.source = argv[++index];
    else if (argv[index] === '--output-dir') {
      options.outputDirectory = argv[++index];
      options.outputDirectoryExplicit = true;
    }
    else if (argv[index] === '--pricing-model') options.pricingModel = argv[++index];
    else if (argv[index] === '--native-prices') options.pricingMode = 'native';
    else if (argv[index] === '--gate6-manifest') options.gate6Manifest = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (options.pricingMode === 'native' && !options.outputDirectoryExplicit) {
    options.outputDirectory = path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate6b-native-price-isolation');
  }
  options.source = path.resolve(options.source);
  options.outputDirectory = path.resolve(options.outputDirectory);
  options.pricingModel = path.resolve(options.pricingModel);
  options.gate6Manifest = path.resolve(options.gate6Manifest);
  return options;
}

function hashScore(value) {
  return crypto.createHash('sha256').update(`${SEED}|${value}`).digest('hex');
}

function teamReference(teams, row) {
  return teams.getBinaryReferenceToRecord(row);
}

function teamRowByLogicalIndex(teams, logicalIndex) {
  if (logicalIndex === 255) return null;
  const team = teams.records.find((record) => record && !record.isEmpty && record.TeamIndex === logicalIndex);
  assert(team, `No Team record has logical TeamIndex ${logicalIndex}.`);
  return team.index;
}

function transactionSlots(record) {
  return (record.fieldsArray || []).map((field) => field.key).filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function openingKey(event) {
  return `${refRow(event.values.Team)}|${event.values.Position}`;
}

function findHireEvents(state, plan) {
  const indexed = plan.transactionEvents.filter((event) => event.indexed);
  return plan.openingEvents.flatMap((opening) => {
    const matches = indexed.filter((transaction) => transaction.values.Coach === opening.values.SelectedCoach &&
      transaction.values.NewTeam === opening.values.Team && transaction.values.NewCoachPosition === opening.values.Position);
    if (matches.length !== 1) return [];
    const coachRow = refRow(opening.values.SelectedCoach);
    const coach = state.tables.coaches.records[coachRow];
    return [{
      role: opening.values.Position,
      openingRow: opening.originalRow,
      transactionRow: matches[0].originalRow,
      transactionId: matches[0].values.TransactionId,
      originalDestinationTeamRow: refRow(opening.values.Team),
      prevCoachReference: opening.values.PrevCoach,
      nativeFinalPoints: Number(opening.values.FinalContractProgramPoints) || 0,
      nativeHighestPoints: Number(opening.values.HighestOfferedProgramPoints) || 0,
      coachRow,
      sourceTeamRow: teamRowByLogicalIndex(state.tables.teams, coach.TeamIndex),
      sourceRole: coach.Position,
      replacementForCoachRow: null
    }];
  });
}

function chooseReplacementFreeAgents(state, sourcePlan, count) {
  const selected = new Set(sourcePlan.openingEvents.map((event) => refRow(event.values.SelectedCoach)));
  const transacted = new Set(sourcePlan.transactionEvents.map((event) => refRow(event.values.Coach)).filter((row) => row !== null));
  const candidates = state.tables.coaches.records.filter((record) => record && !record.isEmpty &&
    record.TeamIndex === 255 && record.ContractStatus === 'FreeAgent' && !record.IsUserControlled &&
    !selected.has(record.index) && !transacted.has(record.index))
    .sort((a, b) => hashScore(`free-agent|${a.index}`).localeCompare(hashScore(`free-agent|${b.index}`)));
  assert(candidates.length >= count, `Only ${candidates.length} unused free agents are available for ${count} replacements.`);
  return candidates.slice(0, count).map((record) => record.index);
}

function buildDonorPool(state, sourcePlan, hireEvents) {
  const openingKeys = new Set(sourcePlan.openingEvents.map(openingKey));
  const uncovered = hireEvents.filter((event) => event.sourceTeamRow !== null && !openingKeys.has(`${event.sourceTeamRow}|${event.sourceRole}`))
    .sort((a, b) => hashScore(`restore|${a.coachRow}`).localeCompare(hashScore(`restore|${b.coachRow}`)));
  const replacementRows = chooseReplacementFreeAgents(state, sourcePlan, uncovered.length);
  const replacementByTransaction = new Map(uncovered.map((event, index) => [event.transactionRow, replacementRows[index]]));
  const donors = hireEvents.map((event) => {
    const replacementCoachRow = replacementByTransaction.get(event.transactionRow);
    if (replacementCoachRow === undefined) return { ...event };
    const replacement = state.tables.coaches.records[replacementCoachRow];
    return {
      ...event,
      coachRow: replacementCoachRow,
      sourceTeamRow: null,
      sourceRole: replacement.Position,
      replacementForCoachRow: event.coachRow
    };
  });
  return {
    donors,
    restoredCoachRows: uncovered.map((event) => event.coachRow),
    replacementCoachRows: replacementRows
  };
}

function assignRole(state, role, destinations, donors) {
  assert(destinations.length === donors.length, `${role} destination/donor count mismatch.`);
  const destinationByTeam = new Map(destinations.map((event) => [event.originalDestinationTeamRow, event]));
  const donorByCoach = new Map(donors.map((event) => [event.coachRow, event]));
  const forced = role === 'HeadCoach' ? FORCED_CASCADE : [];
  const destinationToDonor = new Map();
  const reservedDonors = new Set();
  for (const donor of donors.filter((event) => state.tables.coaches.records[event.coachRow].IsUserControlled)) {
    const destination = destinationByTeam.get(donor.originalDestinationTeamRow);
    assert(destination, `Missing protected user-Coach destination for Coach row ${donor.coachRow}.`);
    destinationToDonor.set(destination.openingRow, donor);
    reservedDonors.add(donor.transactionRow);
  }
  for (const item of forced) {
    const destination = destinationByTeam.get(item.destinationTeamRow);
    const donor = donorByCoach.get(item.coachRow);
    assert(destination && donor, `Missing forced cascade member ${JSON.stringify(item)}.`);
    destinationToDonor.set(destination.openingRow, donor);
    reservedDonors.add(donor.transactionRow);
  }

  const openDestinations = destinations.filter((event) => !destinationToDonor.has(event.openingRow))
    .sort((a, b) => hashScore(`destination|${role}|${a.originalDestinationTeamRow}`).localeCompare(hashScore(`destination|${role}|${b.originalDestinationTeamRow}`)));
  const availableDonors = donors.filter((event) => !reservedDonors.has(event.transactionRow));
  const donorToDestination = new Map();
  function candidates(destination) {
    return availableDonors.filter((donor) => donor.originalDestinationTeamRow !== destination.originalDestinationTeamRow &&
      donor.sourceTeamRow !== destination.originalDestinationTeamRow &&
      coachReference(state.tables.coaches, donor.coachRow) !== destination.prevCoachReference)
      .sort((a, b) => hashScore(`match|${role}|${destination.originalDestinationTeamRow}|${a.coachRow}`).localeCompare(hashScore(`match|${role}|${destination.originalDestinationTeamRow}|${b.coachRow}`)));
  }
  function place(destination, visited) {
    for (const donor of candidates(destination)) {
      if (visited.has(donor.transactionRow)) continue;
      visited.add(donor.transactionRow);
      const occupied = donorToDestination.get(donor.transactionRow);
      if (!occupied || place(occupied, visited)) {
        donorToDestination.set(donor.transactionRow, destination);
        destinationToDonor.set(destination.openingRow, donor);
        return true;
      }
    }
    return false;
  }
  for (const destination of openDestinations) assert(place(destination, new Set()), `No deterministic ${role} matching exists for Team row ${destination.originalDestinationTeamRow}.`);
  assert(destinationToDonor.size === destinations.length, `${role} matching is incomplete.`);
  assert(new Set([...destinationToDonor.values()].map((event) => event.coachRow)).size === donors.length, `${role} matching duplicated a Coach.`);
  return destinations.map((destination) => ({ destination, donor: destinationToDonor.get(destination.openingRow) }));
}

function pricePredictor(model) {
  const cells = model.training.cells;
  const fallbacks = model.training.roleFallbacks;
  return (role, level) => {
    const band = Math.floor((Number(level) || 0) / 5) * 5;
    const cell = cells[`${role}:${band}`];
    return cell && cell.samples >= 3 ? cell.price : fallbacks[role].price;
  };
}

function applyPricingPolicy(state, assignments, model, pricingMode) {
  const predict = pricePredictor(model);
  for (const assignment of assignments) {
    const coach = state.tables.coaches.records[assignment.donor.coachRow];
    assignment.protectedUserCoach = Boolean(coach.IsUserControlled);
    assignment.modeledPrice = assignment.protectedUserCoach ? assignment.destination.nativeFinalPoints : predict(assignment.destination.role, coach.Level);
    assignment.finalPrice = pricingMode === 'native' ? assignment.destination.nativeFinalPoints : assignment.modeledPrice;
    assignment.highestPrice = pricingMode === 'native' || assignment.protectedUserCoach ? assignment.destination.nativeHighestPoints : assignment.finalPrice;
  }
  if (pricingMode === 'native') return [];
  const byTeam = new Map();
  for (const assignment of assignments) {
    const teamRow = assignment.destination.originalDestinationTeamRow;
    if (!byTeam.has(teamRow)) byTeam.set(teamRow, []);
    byTeam.get(teamRow).push(assignment);
  }
  const cappedTeams = [];
  for (const [teamRow, rows] of byTeam) {
    const team = state.tables.teams.records[teamRow];
    const nativeFinalTotal = rows.reduce((sum, row) => sum + row.destination.nativeFinalPoints, 0);
    const modeledTotal = rows.reduce((sum, row) => sum + row.modeledPrice, 0);
    // Gate 6 deliberately allows no new spend above the visible native staged prices. This is
    // computable from one BW3 save and guarantees the synthetic plan is neutral or refunding.
    const capacity = nativeFinalTotal;
    if (modeledTotal > capacity) {
      const fixedTotal = rows.filter((row) => row.protectedUserCoach).reduce((sum, row) => sum + row.finalPrice, 0);
      const mutableRows = rows.filter((row) => !row.protectedUserCoach);
      const mutableModeledTotal = mutableRows.reduce((sum, row) => sum + row.modeledPrice, 0);
      const mutableCapacity = Math.max(0, capacity - fixedTotal);
      for (const row of mutableRows) {
        row.finalPrice = Math.floor((row.modeledPrice * mutableCapacity / mutableModeledTotal) / 5) * 5;
        row.highestPrice = row.finalPrice;
      }
      cappedTeams.push({ teamRow, team: displayName(team), nativeFinalTotal, modeledTotal, capacity, cappedTotal: rows.reduce((sum, row) => sum + row.finalPrice, 0) });
    }
    assert(rows.reduce((sum, row) => sum + row.finalPrice, 0) <= capacity, `Generated prices overdraw Team row ${teamRow}.`);
  }
  return cappedTeams;
}

function applySyntheticPlan(state, sourcePlan, pricingModel, pricingMode = 'capped-model') {
  const { openings, coaches, coachTransactions, teams } = state.tables;
  const hireEvents = findHireEvents(state, sourcePlan);
  assert(hireEvents.length === 66, `Expected 66 native hiring events, found ${hireEvents.length}.`);
  const pool = buildDonorPool(state, sourcePlan, hireEvents);
  const assignments = ROLES.flatMap((role) => {
    const destinations = hireEvents.filter((event) => event.role === role);
    const donors = pool.donors.filter((event) => event.role === role);
    return assignRole(state, role, destinations, donors);
  });
  const cappedTeams = applyPricingPolicy(state, assignments, pricingModel, pricingMode);

  for (const row of pool.restoredCoachRows) coaches.records[row].ContractStatus = 'First_Active';
  for (const row of pool.replacementCoachRows) coaches.records[row].ContractStatus = 'Last_Pending';
  for (const assignment of assignments) {
    const { destination, donor } = assignment;
    const opening = openings.records[destination.openingRow];
    const transaction = coachTransactions.records[donor.transactionRow];
    opening.SelectedCoach = coachReference(coaches, donor.coachRow);
    opening.FinalContractProgramPoints = assignment.finalPrice;
    opening.HighestOfferedProgramPoints = assignment.highestPrice;
    transaction.Coach = coachReference(coaches, donor.coachRow);
    transaction.OldTeam = donor.sourceTeamRow === null ? EMPTY_REF : teamReference(teams, donor.sourceTeamRow);
    transaction.NewTeam = teamReference(teams, destination.originalDestinationTeamRow);
    transaction.OldCoachPosition = donor.sourceRole;
    transaction.NewCoachPosition = destination.role;
    transaction.ContractStatus = 'Last_Pending';
    if (donor.replacementForCoachRow !== null) transaction.ContractLength = 0;
  }
  return { hireEvents, assignments, ...pool, cappedTeams };
}

function assignmentIdentity(assignment) {
  return {
    role: assignment.role,
    openingOriginalRow: assignment.openingOriginalRow,
    transactionRow: assignment.transactionRow,
    transactionId: assignment.transactionId,
    destinationTeamRow: assignment.destinationTeamRow,
    coachRow: assignment.coachRow,
    sourceTeamRow: assignment.sourceTeamRow,
    sourceRole: assignment.sourceRole,
    protectedUserCoach: assignment.protectedUserCoach,
    nativeDestinationCoachRow: assignment.nativeDestinationCoachRow,
    replacementForCoachRow: assignment.replacementForCoachRow
  };
}

function validateGate6AssignmentIdentity(assignments, gate6ManifestPath) {
  assert(fs.existsSync(gate6ManifestPath), `Gate 6 manifest not found: ${gate6ManifestPath}`);
  const gate6 = JSON.parse(fs.readFileSync(gate6ManifestPath, 'utf8'));
  assert(gate6.experimentId === 'G6' && Array.isArray(gate6.assignments), 'Gate 6 comparison manifest is invalid.');
  assert(JSON.stringify(assignments.map(assignmentIdentity)) === JSON.stringify(gate6.assignments.map(assignmentIdentity)),
    'Native-price mode changed the Gate 6 assignment landscape.');
}

function assignmentManifest(state, result) {
  return result.assignments.map(({ destination, donor, modeledPrice, finalPrice, highestPrice, protectedUserCoach }) => ({
    role: destination.role,
    openingOriginalRow: destination.openingRow,
    transactionRow: donor.transactionRow,
    transactionId: donor.transactionId,
    destinationTeamRow: destination.originalDestinationTeamRow,
    destinationTeam: displayName(state.tables.teams.records[destination.originalDestinationTeamRow]),
    coachRow: donor.coachRow,
    coach: displayName(state.tables.coaches.records[donor.coachRow]),
    sourceTeamRow: donor.sourceTeamRow,
    sourceTeam: donor.sourceTeamRow === null ? 'Free Agent' : displayName(state.tables.teams.records[donor.sourceTeamRow]),
    sourceRole: donor.sourceRole,
    modeledPrice,
    finalPrice,
    highestPrice,
    protectedUserCoach,
    nativeDestinationCoachRow: destination.coachRow,
    nativeFinalPrice: destination.nativeFinalPoints,
    replacementForCoachRow: donor.replacementForCoachRow
  })).sort((a, b) => a.destinationTeamRow - b.destinationTeamRow || ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
}

function validatePrepared(state, baselineSnapshot, expectedAssignments, restoredCoachRows, replacementCoachRows, allocation) {
  const { openings, offerArrays, coaches, coachTransactions, transactionArrays, teams } = state.tables;
  const activeOpenings = openings.records.filter((record) => record && !record.isEmpty);
  assert(activeOpenings.length === 192 && openings.header.nextRecordToUse === 192, 'Opening pool shape changed.');
  assert(activeOpenings.every((record) => record.ContractOfferList === offerArrays.getBinaryReferenceToRecord(record.index)), 'Opening/offer-array ownership is incoherent.');
  assert(new Set(activeOpenings.map((record) => `${refRow(record.Team)}|${record.Position}`)).size === 192, 'Duplicate Team/role openings exist.');
  assert(new Set(activeOpenings.map((record) => record.SelectedCoach)).size === 192, 'Selected Coaches are not unique.');
  assert(allocation.openingRowsMoved >= 180 && allocation.transactionRowsMoved === 0, 'Allocator did not preserve the Gate 5B contract.');
  const slots = transactionSlots(transactionArrays.records[0]).slice(0, transactionArrays.arraySizes[0]);
  assert(slots.length === 124 && coachTransactions.records.filter((record) => record && !record.isEmpty).length === 125, 'Transaction topology changed.');
  for (let slot = 0; slot < slots.length; slot += 1) {
    const row = refRow(transactionArrays.records[0][slots[slot]]);
    assert(row === slot + 1 && coachTransactions.records[row].TransactionId === slot, `Transaction identity failed at slot ${slot}.`);
  }
  for (const assignment of expectedAssignments) {
    const opening = activeOpenings.find((record) => refRow(record.Team) === assignment.destinationTeamRow && record.Position === assignment.role);
    const transaction = coachTransactions.records[assignment.transactionRow];
    const expectedCoach = coachReference(coaches, assignment.coachRow);
    assert(opening && opening.SelectedCoach === expectedCoach, `Opening assignment failed for ${assignment.destinationTeam}/${assignment.role}.`);
    assert(opening.FinalContractProgramPoints === assignment.finalPrice && opening.HighestOfferedProgramPoints === assignment.highestPrice, `Price failed for ${assignment.destinationTeam}/${assignment.role}.`);
    assert(transaction.Coach === expectedCoach && refRow(transaction.NewTeam) === assignment.destinationTeamRow && transaction.NewCoachPosition === assignment.role, `Transaction failed for ${assignment.coach}.`);
    assert(refRow(transaction.OldTeam) === assignment.sourceTeamRow, `OldTeam failed for ${assignment.coach}.`);
    if (assignment.protectedUserCoach) assert(assignment.coachRow === assignment.nativeDestinationCoachRow, `User-controlled Coach ${assignment.coach} was reassigned.`);
  }
  for (const row of restoredCoachRows) assert(coaches.records[row].ContractStatus === 'First_Active', `Restored Coach ${row} is not active.`);
  for (const row of replacementCoachRows) assert(coaches.records[row].ContractStatus === 'Last_Pending', `Replacement Coach ${row} is not pending.`);
  const teamDifferences = collectDifferences(baselineSnapshot, focusedSnapshot(state.tables)).filter((change) => change.table === 'teams');
  assert(teamDifferences.length === 0, `Gate 6 wrote Team aggregates: ${JSON.stringify(teamDifferences)}`);
  const sourceOpeningKeys = new Set(activeOpenings.map((record) => `${refRow(record.Team)}|${record.Position}`));
  const uncoveredMovers = expectedAssignments.filter((assignment) => assignment.sourceTeamRow !== null && !sourceOpeningKeys.has(`${assignment.sourceTeamRow}|${assignment.sourceRole}`));
  assert(uncoveredMovers.length === 0, `Synthetic plan leaves uncovered source vacancies: ${JSON.stringify(uncoveredMovers)}`);
  const cascade = FORCED_CASCADE.map((item) => expectedAssignments.find((assignment) => assignment.destinationTeamRow === item.destinationTeamRow && assignment.coachRow === item.coachRow));
  assert(cascade.every(Boolean), 'Required three-school HC cascade is absent.');
  assert(expectedAssignments.filter((assignment) => !assignment.protectedUserCoach).every((assignment) => assignment.coachRow !== assignment.nativeDestinationCoachRow), 'One or more unprotected Gate 6 hires remained native-equivalent.');
  return collectDifferences(baselineSnapshot, focusedSnapshot(state.tables));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  assert(fs.existsSync(options.source) && sha256(options.source) === SOURCE_HASH, 'Source BW3 fixture mismatch.');
  assert(fs.existsSync(options.pricingModel), `Pricing model not found: ${options.pricingModel}`);
  const pricingModel = JSON.parse(fs.readFileSync(options.pricingModel, 'utf8'));
  const experimentId = options.pricingMode === 'native' ? 'G6B' : 'G6';
  const outputName = options.pricingMode === 'native' ? 'DYNASTY-CCRY1BW3-G6B-NATIVEPRICE' : 'DYNASTY-CCRY1BW3-G6-SYNTHETIC';
  const baseline = await loadExperimentState(options.source, schema);
  const baselinePlan = extractPlan(baseline);
  validateBaseline(baseline, baselinePlan);
  const previewPool = buildDonorPool(baseline, baselinePlan, findHireEvents(baseline, baselinePlan));
  const output = path.join(options.outputDirectory, outputName);
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  if (!options.write) {
    process.stdout.write(`${JSON.stringify({
      mode: 'preview', experimentId, seed: SEED, pricingMode: options.pricingMode, output,
      nativePlan: { openings: baselinePlan.openingEvents.length, activeTransactions: baselinePlan.transactionEvents.length, hiringEvents: findHireEvents(baseline, baselinePlan).length },
      replacedUncoveredMovers: previewPool.restoredCoachRows.length,
      replacementFreeAgents: previewPool.replacementCoachRows
    }, null, 2)}\n`);
    return;
  }
  for (const target of [output, `${output}.tmp`, manifestPath]) assert(!fs.existsSync(target), `Refusing to overwrite ${target}`);
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const treatment = await loadExperimentState(options.source, schema);
  const before = focusedSnapshot(treatment.tables);
  const synthetic = applySyntheticPlan(treatment, extractPlan(treatment), pricingModel, options.pricingMode);
  const syntheticPlan = extractPlan(treatment);
  validateBaseline(treatment, syntheticPlan);
  const allocation = applyCanonicalPlan(treatment, syntheticPlan, true);
  const expectedAssignments = assignmentManifest(treatment, synthetic);
  if (options.pricingMode === 'native') validateGate6AssignmentIdentity(expectedAssignments, options.gate6Manifest);
  await saveToTemporary(treatment.franchise, `${output}.tmp`);
  const reopened = await loadExperimentState(`${output}.tmp`, schema);
  const differences = validatePrepared(reopened, before, expectedAssignments, synthetic.restoredCoachRows, synthetic.replacementCoachRows, allocation);
  fs.renameSync(`${output}.tmp`, output);
  const roleCounts = Object.fromEntries(ROLES.map((role) => [role, expectedAssignments.filter((assignment) => assignment.role === role).length]));
  const manifest = {
    experimentId, preparedAt: new Date().toISOString(), seed: SEED, pricingMode: options.pricingMode,
    source: options.source, sourceSha256: SOURCE_HASH, schema: reopened.declaredSchema,
    output, outputSha256: sha256(output), pricingModel: options.pricingModel,
    purpose: options.pricingMode === 'native'
      ? 'Repeat the exact Gate 6 synthetic landscape while restoring every destination opening\'s native highest and final contract-program-point values, isolating EOS liquidity changes caused by coach identity, philosophy, and scheme from changes caused by staff pricing.'
      : 'Replace every non-user native BW3 hiring destination with a deterministic external assignment while preserving the native user-Coach move, a closed source-vacancy graph, canonical opening allocation, positional Staff Moves identity, and budget-feasible final prices.',
    plan: {
      openings: 192, externallyChosenRetentions: 126,
      syntheticHires: expectedAssignments.filter((assignment) => !assignment.protectedUserCoach).length,
      protectedNativeUserMoves: expectedAssignments.filter((assignment) => assignment.protectedUserCoach).length,
      roleCounts, restoredUncoveredNativeMovers: synthetic.restoredCoachRows.length,
      introducedFreeAgents: synthetic.replacementCoachRows.length,
      activeTeamMoves: expectedAssignments.filter((assignment) => assignment.sourceTeamRow !== null).length,
      freeAgentHires: expectedAssignments.filter((assignment) => assignment.sourceTeamRow === null).length,
      crossRoleHires: expectedAssignments.filter((assignment) => assignment.sourceRole !== assignment.role).length,
      openingRowsMoved: allocation.openingRowsMoved,
      transactionRowsMoved: allocation.transactionRowsMoved,
      indexedTransactions: allocation.indexedTransactions,
      pricingSafetyPolicy: options.pricingMode === 'native'
        ? 'Every hiring destination retains its native staged HighestOfferedProgramPoints and FinalContractProgramPoints; intended staff-price delta is zero for every Team.'
        : 'Per-Team synthetic final-price total cannot exceed the native staged final-price total replaced by Gate 6.',
      cappedTeams: synthetic.cappedTeams
    },
    forcedCascade: expectedAssignments.filter((assignment) => FORCED_CASCADE.some((item) => item.destinationTeamRow === assignment.destinationTeamRow && item.coachRow === assignment.coachRow)),
    restoredCoachRows: synthetic.restoredCoachRows,
    replacementCoachRows: synthetic.replacementCoachRows,
    assignments: expectedAssignments,
    semanticDifferenceCount: differences.length,
    changedTables: [...new Set(differences.map((change) => change.table))],
    gate6AssignmentIdentity: options.pricingMode === 'native' ? 'exact match' : 'not applicable',
    preAdvanceValidation: 'passed',
    expectedEos: options.pricingMode === 'native'
      ? 'The exact Gate 6 landscape commits with zero staff-price delta versus native EOS. Any remaining NIL, rollover, total-budget, or liquidity variance is attributable to the changed coaching landscape rather than opening pricing.'
      : 'All 65 synthetic hires plus the protected native user-Coach move commit exactly, all 126 externally chosen retentions remain, the three-school HC cascade closes, Staff Moves retains valid role/team identity, generated prices settle without a negative remaining balance, and no undeclared fallback hire occurs.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...manifest, assignments: `[${manifest.assignments.length} assignments]` }, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { FORCED_CASCADE, SEED, applySyntheticPlan, findHireEvents };
