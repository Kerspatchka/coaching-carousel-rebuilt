/* CAP-2: saturate the game's existing coaching-carousel opening and Staff Moves structures. */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');

const EXPERIMENT_ID = process.env.CCR_CAP_EXPERIMENT_ID || 'CAP-2';
const SEED = 'CCR-CAP2-NATIVE-MAX-2026-08-18';
const SOURCE_FIXTURES = {
  'DYNASTY-TEST1NATCHAMP': 'FB090BE76CCE6D51E24CEC3FCB66F3AABF66B124FAADE8CD03565CFACE50E4A2',
  'DYNASTY-TEST2NATCHAMP': '2D0C17DA5F1240BE4C28342846AC2A84BF99955046D0CFD0E18F8F4F1D755636',
  'DYNASTY-TEST3NATCHAMP': '05C21801FD502657BC691597C8E4C3833B677D0EF21757A98FA131B4391E4365'
};
const OWNER_TABLE_UNIQUE_ID = 2358764614;
const OPENING_CAPACITY = 408;
const TRANSACTION_CAPACITY = 300;
const OPENING_TARGET = Number.parseInt(process.env.CCR_CAP_OPENINGS || String(OPENING_CAPACITY), 10);
const INDEXED_TRANSACTION_TARGET = Number.parseInt(process.env.CCR_CAP_INDEXED_TRANSACTIONS || '299', 10);
const MOVEMENT_COUNTS = {
  HeadCoach: INDEXED_TRANSACTION_TARGET - Math.min(100, INDEXED_TRANSACTION_TARGET) - Math.min(100, Math.max(0, INDEXED_TRANSACTION_TARGET - 100)),
  OffensiveCoordinator: Math.min(100, Math.max(0, INDEXED_TRANSACTION_TARGET - 100)),
  DefensiveCoordinator: Math.min(100, INDEXED_TRANSACTION_TARGET)
};
const RETENTION_COUNT = OPENING_TARGET - INDEXED_TRANSACTION_TARGET;
const ROLE_FIELDS = {
  HeadCoach: 'HeadCoach',
  OffensiveCoordinator: 'OffensiveCoordinator',
  DefensiveCoordinator: 'DefensiveCoordinator'
};
const ROLE_BUDGET_FIELDS = {
  HeadCoach: 'HeadCoachProgramPointBudget',
  OffensiveCoordinator: 'OffensiveCoordinatorPointBudget',
  DefensiveCoordinator: 'DefensiveCoordinatorPointBudget'
};

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'capacity-policy', 'cap0-sources', 'DYNASTY-TEST1NATCHAMP'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'capacity-policy', 'cap2-existing-schema-saturation'),
    outputName: 'DYNASTY-CCRCAP2M'
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--write') options.write = true;
    else if (argv[index] === '--source') options.source = argv[++index];
    else if (argv[index] === '--output-dir') options.outputDirectory = argv[++index];
    else if (argv[index] === '--output-name') options.outputName = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  options.source = path.resolve(options.source);
  options.outputDirectory = path.resolve(options.outputDirectory);
  return options;
}

function fields(record) {
  return (record && record.fieldsArray || []).map((field) => field.key);
}

function values(record) {
  return Object.fromEntries(fields(record).map((field) => [field, record[field]]));
}

function writeValues(record, next) {
  for (const field of fields(record)) record[field] = next[field];
}

function refRow(reference) {
  return typeof reference === 'string' && /^[01]{32}$/.test(reference) && reference !== EMPTY_REF
    ? Number.parseInt(reference.slice(15), 2) : null;
}

function teamReference(teams, row) {
  return teams.getBinaryReferenceToRecord(row);
}

function score(label) {
  return crypto.createHash('sha256').update(`${SEED}|${label}`).digest('hex');
}

function sortedBySeed(rows, label) {
  return [...rows].sort((a, b) => score(`${label}|${a.teamRow}|${a.role}|${a.coachRow}`)
    .localeCompare(score(`${label}|${b.teamRow}|${b.role}|${b.coachRow}`)));
}

function offerSlots(record) {
  return fields(record).filter((field) => /^StaffPersonContractOffer\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function transactionSlots(record) {
  return fields(record).filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function ownerSlots(record) {
  return fields(record).filter((field) => /^JobOpening\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

async function loadWithOwner(savePath, schema) {
  const state = await loadExperimentState(savePath, schema);
  const openingArrays = state.franchise.getTableByUniqueId(OWNER_TABLE_UNIQUE_ID);
  assert(openingArrays, `Missing JobOpening[] table ${OWNER_TABLE_UNIQUE_ID}.`);
  await openingArrays.readRecords();
  assert(openingArrays.name === 'JobOpening[]', `Unexpected owner table name: ${openingArrays.name}.`);
  return { ...state, openingArrays };
}

function activeTeamRoles(state) {
  const { teams, coaches } = state.tables;
  const roles = [];
  for (const team of teams.records.filter((record) => record && !record.isEmpty)) {
    for (const [role, field] of Object.entries(ROLE_FIELDS)) {
      const coachRow = refRow(team[field]);
      assert(coachRow !== null, `Team row ${team.index} has no ${role}.`);
      const coach = coaches.records[coachRow];
      assert(coach && !coach.isEmpty, `Team row ${team.index} ${role} references an invalid Coach.`);
      assert(coach.TeamIndex === team.TeamIndex && coach.Position === role, `Source employment is incoherent for Team row ${team.index} ${role}.`);
      roles.push({ teamRow: team.index, teamIndex: team.TeamIndex, role, coachRow });
    }
  }
  assert(roles.length === 429, `Expected 429 active Team roles, found ${roles.length}.`);
  assert(new Set(roles.map((role) => role.coachRow)).size === roles.length, 'Source Team roles contain duplicate Coaches.');
  return roles;
}

function createPlan(state) {
  const { teams, coaches, openings, coachTransactions, transactionArrays } = state.tables;
  const roles = activeTeamRoles(state);
  const userTeamIndexes = new Set(roles.filter((role) => coaches.records[role.coachRow].IsUserControlled).map((role) => role.teamIndex));
  const eligible = roles.filter((role) => !userTeamIndexes.has(role.teamIndex) &&
    !(role.teamIndex === 255 && role.role === 'HeadCoach'));
  // Placeholder/FCS incumbents all share TeamIndex 255. CAP-2T1 showed that moving
  // some of these Coaches to an indexed Team can leave the Team assignment intact
  // while EOS expires the Coach record to FreeAgent. They remain valid retention
  // targets, but maximum-volume movement tests use only indexed-Team incumbents.
  const movementEligible = eligible.filter((role) => role.teamIndex !== 255);
  assert(Number.isInteger(OPENING_TARGET) && OPENING_TARGET > 0 && OPENING_TARGET <= OPENING_CAPACITY, `Invalid opening target ${OPENING_TARGET}.`);
  assert(Number.isInteger(INDEXED_TRANSACTION_TARGET) && INDEXED_TRANSACTION_TARGET > 0 && INDEXED_TRANSACTION_TARGET < TRANSACTION_CAPACITY, `Invalid indexed transaction target ${INDEXED_TRANSACTION_TARGET}.`);
  assert(OPENING_TARGET >= INDEXED_TRANSACTION_TARGET, 'Opening target cannot be smaller than the movement target.');
  assert(Object.values(MOVEMENT_COUNTS).every((count) => count === 0 || count > 1), 'Each movement role cycle must contain zero or at least two Coaches.');
  assert(eligible.length >= OPENING_TARGET, `Only ${eligible.length} non-user-team roles are available for ${OPENING_TARGET} openings.`);

  const movements = [];
  const movementKeys = new Set();
  for (const [role, count] of Object.entries(MOVEMENT_COUNTS)) {
    const group = sortedBySeed(movementEligible.filter((item) => item.role === role), `movement-${role}`).slice(0, count);
    assert(group.length === count && group.length > 1, `Could not select ${count} ${role} movement roles.`);
    for (let index = 0; index < group.length; index += 1) {
      const destination = group[index];
      const source = group[(index + 1) % group.length];
      assert(destination.teamRow !== source.teamRow && destination.coachRow !== source.coachRow, `${role} cycle contains a self-move.`);
      movements.push({
        kind: 'movement', role,
        destinationTeamRow: destination.teamRow,
        previousCoachRow: destination.coachRow,
        selectedCoachRow: source.coachRow,
        sourceTeamRow: source.teamRow
      });
      movementKeys.add(`${destination.teamRow}|${role}`);
    }
  }
  assert(movements.length === INDEXED_TRANSACTION_TARGET, `Expected ${INDEXED_TRANSACTION_TARGET} movements.`);
  assert(new Set(movements.map((event) => event.selectedCoachRow)).size === movements.length, 'Movement plan selects a Coach more than once.');

  const retentionCandidates = sortedBySeed(eligible.filter((item) => !movementKeys.has(`${item.teamRow}|${item.role}`)), 'retention');
  const retentions = retentionCandidates.slice(0, RETENTION_COUNT).map((item) => ({
    kind: 'retention', role: item.role,
    destinationTeamRow: item.teamRow,
    previousCoachRow: item.coachRow,
    selectedCoachRow: item.coachRow,
    sourceTeamRow: item.teamRow
  }));
  assert(retentions.length === RETENTION_COUNT, `Expected ${RETENTION_COUNT} retentions.`);

  const events = [...movements, ...retentions].sort((a, b) => score(`opening|${a.destinationTeamRow}|${a.role}`)
    .localeCompare(score(`opening|${b.destinationTeamRow}|${b.role}`)));
  assert(events.length === OPENING_TARGET, `Expected ${OPENING_TARGET} total opening events.`);
  assert(new Set(events.map((event) => `${event.destinationTeamRow}|${event.role}`)).size === events.length, 'Duplicate destination Team/role opening exists.');
  assert(new Set(events.map((event) => event.selectedCoachRow)).size === events.length, 'Opening plan selects a Coach more than once.');

  const currentByKey = new Map(roles.map((item) => [`${item.teamRow}|${item.role}`, item.coachRow]));
  const expectedByKey = new Map(currentByKey);
  for (const event of events) expectedByKey.set(`${event.destinationTeamRow}|${event.role}`, event.selectedCoachRow);
  assert(new Set(expectedByKey.values()).size === 429, 'Projected EOS landscape duplicates or loses a Coach.');

  const indexedSlotCount = transactionSlots(transactionArrays.records[0]).length;
  assert(openings.header.recordCapacity === OPENING_CAPACITY, 'Unexpected JobOpening capacity.');
  assert(state.tables.offerArrays.header.recordCapacity === OPENING_CAPACITY, 'Unexpected offer-array capacity.');
  assert(coachTransactions.header.recordCapacity === TRANSACTION_CAPACITY, 'Unexpected transaction capacity.');
  assert(indexedSlotCount >= INDEXED_TRANSACTION_TARGET, `Only ${indexedSlotCount} Staff Moves slots are available.`);

  return {
    roles, events, movements, retentions, expectedByKey,
    userTeamIndexes: [...userTeamIndexes].sort((a, b) => a - b),
    userTeams: teams.records.filter((record) => record && !record.isEmpty && userTeamIndexes.has(record.TeamIndex))
      .map((record) => ({ teamRow: record.index, teamIndex: record.TeamIndex, team: displayName(record) })),
    transactionArrayPhysicalSlots: indexedSlotCount
  };
}

function findTemplates(state) {
  const { openings, coachTransactions, transactionArrays } = state.tables;
  const activeOpenings = openings.records.filter((record) => record && !record.isEmpty);
  const retention = activeOpenings.find((record) => record.SelectedCoach === record.PrevCoach && record.Reason === 'ContractEnding');
  const movement = activeOpenings.find((record) => record.SelectedCoach !== record.PrevCoach && record.Reason === 'NewJob');
  const indexed = new Set(transactionSlots(transactionArrays.records[0]).slice(0, transactionArrays.arraySizes[0])
    .map((slot) => transactionArrays.records[0][slot]));
  const transaction = coachTransactions.records.find((record) => record && !record.isEmpty && indexed.has(coachTransactions.getBinaryReferenceToRecord(record.index)) && record.NewTeam !== EMPTY_REF);
  assert(retention && movement && transaction, 'Required native retention, movement, or transaction template is missing.');
  return { retention: values(retention), movement: values(movement), transaction: values(transaction) };
}

function activateOfferArray(offerArrays, row) {
  const record = offerArrays.records[row];
  for (const slot of offerSlots(record)) record[slot] = EMPTY_REF;
  record.arraySize = 0;
  offerArrays.arraySizes[row] = 0;
}

function openingValues(state, event, row, templates) {
  const { teams, coaches, offerArrays } = state.tables;
  const team = teams.records[event.destinationTeamRow];
  const price = Number(getValue(team, [ROLE_BUDGET_FIELDS[event.role]], 0)) || 0;
  const template = event.kind === 'movement' ? templates.movement : templates.retention;
  return {
    ...template,
    Team: teamReference(teams, event.destinationTeamRow),
    SelectedCoach: coachReference(coaches, event.selectedCoachRow),
    PrevCoach: coachReference(coaches, event.previousCoachRow),
    InterestedUserTeamsList: EMPTY_REF,
    ContractOfferList: offerArrays.getBinaryReferenceToRecord(row),
    Filled: true,
    IsEmergentJobOpening: event.kind === 'movement',
    Position: event.role,
    FinalContractProgramPoints: price,
    HighestOfferedProgramPoints: price,
    Reason: event.kind === 'movement' ? 'NewJob' : 'ContractEnding'
  };
}

function transactionValues(state, movement, transactionId, template) {
  const { teams, coaches } = state.tables;
  return {
    ...template,
    Coach: coachReference(coaches, movement.selectedCoachRow),
    OldTeam: teamReference(teams, movement.sourceTeamRow),
    NewTeam: teamReference(teams, movement.destinationTeamRow),
    OldCoachPosition: movement.role,
    NewCoachPosition: movement.role,
    TransactionId: transactionId,
    SeasonStage: 'NFLSeason',
    SeasonYear: 0,
    SeasonWeek: 20,
    ContractSalary: 0,
    ContractLength: movement.role === 'HeadCoach' ? 3 : 2,
    ContractStatus: 'Last_Pending'
  };
}

function normalizeCoaches(state, plan) {
  const { coaches, openings } = state.tables;
  const eventByCoach = new Map(plan.events.map((event) => [event.selectedCoachRow, event]));
  const activeCoachRows = new Set(plan.roles.map((role) => role.coachRow));
  for (const coachRow of activeCoachRows) {
    const event = eventByCoach.get(coachRow);
    coaches.records[coachRow].ContractStatus = event ? (event.kind === 'movement' ? 'Last_Pending' : 'PendingRenewal') : 'First_Active';
  }
  const nativeSelected = new Set(openings.records.filter((record) => record && !record.isEmpty).map((record) => refRow(record.SelectedCoach)).filter((row) => row !== null));
  for (const coachRow of nativeSelected) {
    if (activeCoachRows.has(coachRow)) continue;
    const coach = coaches.records[coachRow];
    if (coach && !coach.isEmpty && coach.TeamIndex === 255 && !coach.IsUserControlled) coach.ContractStatus = 'FreeAgent';
  }
}

function applyTreatment(state, plan, templates) {
  const { openings, offerArrays, coachTransactions, transactionArrays } = state.tables;
  normalizeCoaches(state, plan);

  for (let row = 0; row < OPENING_TARGET; row += 1) {
    activateOfferArray(offerArrays, row);
    writeValues(openings.records[row], openingValues(state, plan.events[row], row, templates));
  }

  const owner = state.openingArrays.records[0];
  const slots = ownerSlots(owner);
  assert(slots.length === OPENING_CAPACITY, `Expected ${OPENING_CAPACITY} JobOpening[] slots.`);
  for (let row = 0; row < OPENING_CAPACITY; row += 1) owner[slots[row]] = row < OPENING_TARGET ? openings.getBinaryReferenceToRecord(row) : EMPTY_REF;
  owner.arraySize = OPENING_TARGET;
  state.openingArrays.arraySizes[0] = OPENING_TARGET;

  const movementOrder = [...plan.movements].sort((a, b) => score(`transaction|${a.selectedCoachRow}|${a.destinationTeamRow}`)
    .localeCompare(score(`transaction|${b.selectedCoachRow}|${b.destinationTeamRow}`)));
  for (let index = 0; index < movementOrder.length; index += 1) {
    const row = index + 1;
    writeValues(coachTransactions.records[row], transactionValues(state, movementOrder[index], index, templates.transaction));
    movementOrder[index].transactionId = index;
    movementOrder[index].transactionRow = row;
  }

  const array = transactionArrays.records[0];
  const transactionArraySlots = transactionSlots(array);
  for (let index = 0; index < transactionArraySlots.length; index += 1) {
    array[transactionArraySlots[index]] = index < INDEXED_TRANSACTION_TARGET
      ? coachTransactions.getBinaryReferenceToRecord(index + 1) : EMPTY_REF;
  }
  array.arraySize = INDEXED_TRANSACTION_TARGET;
  transactionArrays.arraySizes[0] = INDEXED_TRANSACTION_TARGET;
  return movementOrder;
}

function validateTreatment(state, plan, movementOrder, before) {
  const { openings, offerArrays, coachTransactions, transactionArrays, coaches, teams } = state.tables;
  const activeOpenings = openings.records.filter((record) => record && !record.isEmpty);
  const activeOfferArrays = offerArrays.records.filter((record) => record && !record.isEmpty);
  const activeTransactions = coachTransactions.records.filter((record) => record && !record.isEmpty);
  assert(activeOpenings.length === OPENING_TARGET && openings.header.nextRecordToUse === OPENING_TARGET, 'JobOpening table did not reach the configured target coherently.');
  assert(activeOfferArrays.length === OPENING_TARGET && offerArrays.header.nextRecordToUse === OPENING_TARGET, 'Offer-array table did not reach the configured target coherently.');
  assert(activeTransactions.length === INDEXED_TRANSACTION_TARGET + 1 && coachTransactions.header.nextRecordToUse === INDEXED_TRANSACTION_TARGET + 1, 'Transaction table did not reach the configured target coherently.');
  assert(transactionArrays.arraySizes[0] === INDEXED_TRANSACTION_TARGET, 'Staff Moves logical size did not reach the configured target.');
  assert(state.openingArrays.arraySizes[0] === OPENING_TARGET && state.openingArrays.records[0].arraySize === OPENING_TARGET, 'JobOpening[] logical size did not reach the configured target.');

  const owner = state.openingArrays.records[0];
  const ownerFields = ownerSlots(owner);
  for (let row = 0; row < OPENING_TARGET; row += 1) {
    assert(owner[ownerFields[row]] === openings.getBinaryReferenceToRecord(row), `Owner slot ${row} is incoherent.`);
    assert(openings.records[row].ContractOfferList === offerArrays.getBinaryReferenceToRecord(row), `Opening row ${row} does not own offer array ${row}.`);
    assert(offerArrays.arraySizes[row] === 0, `Offer array ${row} is not logically empty.`);
  }
  const openingKeys = activeOpenings.map((record) => `${refRow(record.Team)}|${record.Position}`);
  const selected = activeOpenings.map((record) => record.SelectedCoach);
  assert(new Set(openingKeys).size === OPENING_TARGET, 'Treatment openings duplicate a Team/role.');
  assert(new Set(selected).size === OPENING_TARGET && selected.every((reference) => reference !== EMPTY_REF), 'Treatment openings duplicate or omit a selected Coach.');
  if (OPENING_TARGET < OPENING_CAPACITY) {
    assert(openings.records[OPENING_TARGET].isEmpty && offerArrays.records[OPENING_TARGET].isEmpty, 'The first reserved opening/offer headroom row is not empty.');
    assert(owner[ownerFields[OPENING_TARGET]] === EMPTY_REF, 'The first reserved owner slot is not empty.');
  }

  const transactionArray = transactionArrays.records[0];
  const slots = transactionSlots(transactionArray);
  for (let index = 0; index < INDEXED_TRANSACTION_TARGET; index += 1) {
    const row = index + 1;
    const transaction = coachTransactions.records[row];
    assert(transactionArray[slots[index]] === coachTransactions.getBinaryReferenceToRecord(row), `Staff Moves slot ${index} does not reference row ${row}.`);
    assert(transaction.TransactionId === index, `Transaction row ${row} does not carry ID ${index}.`);
    const movement = movementOrder[index];
    assert(transaction.Coach === coachReference(coaches, movement.selectedCoachRow), `Transaction ${index} has the wrong Coach.`);
    assert(transaction.OldTeam === teamReference(teams, movement.sourceTeamRow) && transaction.NewTeam === teamReference(teams, movement.destinationTeamRow), `Transaction ${index} has the wrong Team path.`);
    assert(transaction.OldCoachPosition === movement.role && transaction.NewCoachPosition === movement.role, `Transaction ${index} has the wrong role.`);
  }
  if (INDEXED_TRANSACTION_TARGET + 1 < TRANSACTION_CAPACITY) {
    assert(coachTransactions.records[INDEXED_TRANSACTION_TARGET + 1].isEmpty, 'The first reserved transaction headroom row is not empty.');
  }

  const expectedRefs = new Map([...plan.expectedByKey].map(([key, coachRow]) => [key, coachReference(coaches, coachRow)]));
  const projected = new Set();
  for (const role of plan.roles) {
    const reference = expectedRefs.get(`${role.teamRow}|${role.role}`);
    assert(reference, `Missing projected assignment for ${role.teamRow}|${role.role}.`);
    projected.add(reference);
  }
  assert(projected.size === 429, 'Projected treatment landscape is not a complete unique 429-role assignment.');

  const after = focusedSnapshot(state.tables);
  const differences = collectDifferences(before, after);
  const unexpected = differences.filter((change) => {
    if (change.table === 'openings' || change.table === 'offerArrays' || change.table === 'coachTransactions' || change.table === 'transactionArrays') return false;
    if (change.table === 'coaches' && change.field === 'ContractStatus') return false;
    return true;
  });
  assert(unexpected.length === 0, `Unexpected pre-EOS mutations: ${unexpected.map((change) => `${change.table}:${change.row}:${change.field}`).join(', ')}`);
  return { differences, expectedRefs };
}

function manifestAssignments(state, plan) {
  const { teams, coaches } = state.tables;
  const eventByKey = new Map(plan.events.map((event) => [`${event.destinationTeamRow}|${event.role}`, event]));
  return plan.roles.map((source) => {
    const event = eventByKey.get(`${source.teamRow}|${source.role}`);
    const selectedCoachRow = event ? event.selectedCoachRow : source.coachRow;
    return {
      teamRow: source.teamRow,
      teamIndex: source.teamIndex,
      team: displayName(teams.records[source.teamRow]),
      role: source.role,
      sourceCoachRow: source.coachRow,
      sourceCoach: displayName(coaches.records[source.coachRow]),
      expectedCoachRow: selectedCoachRow,
      expectedCoach: displayName(coaches.records[selectedCoachRow]),
      event: event ? event.kind : 'unchanged'
    };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  const output = path.join(options.outputDirectory, options.outputName);
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  const sourceSha256 = SOURCE_FIXTURES[path.basename(options.source)];
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  assert(sourceSha256 && fs.existsSync(options.source) && sha256(options.source) === sourceSha256, 'CAP-2 source fixture hash mismatch or fixture is not approved.');

  const baseline = await loadWithOwner(options.source, schema);
  const plan = createPlan(baseline);
  const templates = findTemplates(baseline);
  const preview = {
    experimentId: EXPERIMENT_ID,
    mode: options.write ? 'write' : 'preview',
    seed: SEED,
    source: options.source,
    output,
    capacities: {
      physicalOpenings: OPENING_CAPACITY,
      registeredOpenings: OPENING_TARGET,
      openingHeadroom: OPENING_CAPACITY - OPENING_TARGET,
      openingOwnerSlots: ownerSlots(baseline.openingArrays.records[0]).length,
      physicalTransactions: TRANSACTION_CAPACITY,
      indexedStaffMoves: INDEXED_TRANSACTION_TARGET,
      transactionRowHeadroom: TRANSACTION_CAPACITY - (INDEXED_TRANSACTION_TARGET + 1),
      transactionArrayPhysicalSlots: plan.transactionArrayPhysicalSlots
    },
    plan: {
      totalRoles: plan.roles.length,
      openingEvents: plan.events.length,
      movements: plan.movements.length,
      movementRoleCounts: MOVEMENT_COUNTS,
      retentions: plan.retentions.length,
      unchangedRoles: plan.roles.length - plan.events.length,
      protectedUserTeams: plan.userTeams,
      retentionTemplateReason: templates.retention.Reason
    }
  };
  if (!options.write) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return;
  }

  fs.mkdirSync(options.outputDirectory, { recursive: true });
  for (const target of [output, `${output}.tmp`, manifestPath]) assert(!fs.existsSync(target), `Refusing to overwrite ${target}.`);
  const treatment = await loadWithOwner(options.source, schema);
  const treatmentPlan = createPlan(treatment);
  const treatmentTemplates = findTemplates(treatment);
  const before = focusedSnapshot(treatment.tables);
  const movementOrder = applyTreatment(treatment, treatmentPlan, treatmentTemplates);
  await saveToTemporary(treatment.franchise, `${output}.tmp`);
  const reopened = await loadWithOwner(`${output}.tmp`, schema);
  const validation = validateTreatment(reopened, treatmentPlan, movementOrder, before);
  fs.renameSync(`${output}.tmp`, output);

  const manifest = {
    ...preview,
    mode: 'prepared',
    preparedAt: new Date().toISOString(),
    sourceSha256,
    outputSha256: sha256(output),
    schema: reopened.declaredSchema,
    purpose: OPENING_TARGET === OPENING_CAPACITY && INDEXED_TRANSACTION_TARGET === TRANSACTION_CAPACITY - 1
      ? 'Saturate the game\'s existing 408-opening representation and the transaction table\'s 299 usable indexed Staff Moves rows without resizing either table.'
      : `Test the existing-schema boundary with ${OPENING_CAPACITY - OPENING_TARGET} empty opening/offer row(s) and ${TRANSACTION_CAPACITY - (INDEXED_TRANSACTION_TARGET + 1)} empty transaction row(s) reserved as advance-time allocator headroom.`,
    movementTransactions: movementOrder.map((movement) => ({
      transactionId: movement.transactionId,
      transactionRow: movement.transactionRow,
      role: movement.role,
      coachRow: movement.selectedCoachRow,
      coach: displayName(reopened.tables.coaches.records[movement.selectedCoachRow]),
      oldTeamRow: movement.sourceTeamRow,
      oldTeam: displayName(reopened.tables.teams.records[movement.sourceTeamRow]),
      newTeamRow: movement.destinationTeamRow,
      newTeam: displayName(reopened.tables.teams.records[movement.destinationTeamRow])
    })),
    expectedAssignments: manifestAssignments(reopened, treatmentPlan),
    preAdvanceValidation: {
      status: 'passed',
      sourceHashEnforced: true,
      schemaAndParserReopenPassed: true,
      openingRowsActive: reopened.tables.openings.records.filter((record) => record && !record.isEmpty).length,
      openingOwnerLogicalSize: reopened.openingArrays.arraySizes[0],
      offerArrayRowsActive: reopened.tables.offerArrays.records.filter((record) => record && !record.isEmpty).length,
      transactionRowsActive: reopened.tables.coachTransactions.records.filter((record) => record && !record.isEmpty).length,
      indexedStaffMoves: reopened.tables.transactionArrays.arraySizes[0],
      projectedUniqueAssignments: validation.expectedRefs.size,
      semanticDifferenceCount: validation.differences.length,
      changedTables: [...new Set(validation.differences.map((change) => change.table))]
    },
    expectedEos: `All ${OPENING_TARGET} registered opening events resolve: ${INDEXED_TRANSACTION_TARGET} same-role Coach movements in closed cycles, ${RETENTION_COUNT} retentions, ${treatmentPlan.roles.length - treatmentPlan.events.length} unchanged roles, ${INDEXED_TRANSACTION_TARGET} coherent Staff Moves entries, no fallback hire, and normal EOS cleanup${OPENING_TARGET === OPENING_CAPACITY && INDEXED_TRANSACTION_TARGET === TRANSACTION_CAPACITY - 1 ? ' at the literal physical maximum' : ' while the declared headroom remains available during advance'}.`,
    humanAction: `Load ${options.outputName} at CFP National Championship week, advance exactly once to End of Season, save as ${options.outputName}E, and leave the autosave in place.`
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...manifest, movementTransactions: `[${manifest.movementTransactions.length} movements]`, expectedAssignments: `[${manifest.expectedAssignments.length} assignments]` }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
