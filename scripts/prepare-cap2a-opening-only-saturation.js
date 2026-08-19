/* CAP-2A: saturate only JobOpening/JobOpening[]/offer arrays while preserving native Staff Moves. */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');

const EXPERIMENT_ID = process.env.CCR_CAP_EXPERIMENT_ID || 'CAP-2A';
const SEED = 'CCR-CAP2A-OPENING-ONLY-2026-08-18';
const SOURCE_SHA256 = 'FB090BE76CCE6D51E24CEC3FCB66F3AABF66B124FAADE8CD03565CFACE50E4A2';
const OWNER_TABLE_UNIQUE_ID = 2358764614;
const OPENING_CAPACITY = 408;
const OPENING_TARGET = Number.parseInt(process.env.CCR_CAP_OPENINGS || String(OPENING_CAPACITY), 10);
const NATIVE_OPENINGS = 186;
const ADDED_RETENTIONS = OPENING_TARGET - NATIVE_OPENINGS;
const RETENTION_COACH_ROWS = (process.env.CCR_CAP_RETENTION_COACH_ROWS || '').split(',')
  .map((value) => value.trim()).filter(Boolean).map((value) => Number.parseInt(value, 10));
const NATIVE_ACTIVE_TRANSACTIONS = 112;
const NATIVE_INDEXED_TRANSACTIONS = 111;
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
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'capacity-policy', 'cap2a-opening-only-saturation'),
    outputName: 'DYNASTY-CCRCAP2A'
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

function offerSlots(record) {
  return fields(record).filter((field) => /^StaffPersonContractOffer\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function ownerSlots(record) {
  return fields(record).filter((field) => /^JobOpening\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function hashScore(label) {
  return crypto.createHash('sha256').update(`${SEED}|${label}`).digest('hex');
}

async function loadWithOwner(savePath, schema) {
  const state = await loadExperimentState(savePath, schema);
  const openingArrays = state.franchise.getTableByUniqueId(OWNER_TABLE_UNIQUE_ID);
  assert(openingArrays, `Missing JobOpening[] table ${OWNER_TABLE_UNIQUE_ID}.`);
  await openingArrays.readRecords();
  assert(openingArrays.name === 'JobOpening[]', `Unexpected owner table name: ${openingArrays.name}.`);
  return { ...state, openingArrays };
}

function currentRoles(state) {
  const { teams, coaches } = state.tables;
  const result = [];
  for (const team of teams.records.filter((record) => record && !record.isEmpty)) {
    for (const [role, field] of Object.entries(ROLE_FIELDS)) {
      const coachRow = refRow(team[field]);
      assert(coachRow !== null, `Team row ${team.index} has no ${role}.`);
      const coach = coaches.records[coachRow];
      assert(coach && !coach.isEmpty && coach.TeamIndex === team.TeamIndex && coach.Position === role,
        `Source employment is incoherent at Team row ${team.index} ${role}.`);
      result.push({ teamRow: team.index, teamIndex: team.TeamIndex, role, coachRow });
    }
  }
  assert(result.length === 429 && new Set(result.map((item) => item.coachRow)).size === 429, 'Source does not contain 429 unique current role assignments.');
  return result;
}

function createPlan(state) {
  const { openings, coaches, teams, coachTransactions, transactionArrays, offerArrays } = state.tables;
  const activeOpenings = openings.records.filter((record) => record && !record.isEmpty);
  assert(activeOpenings.length === NATIVE_OPENINGS && openings.header.nextRecordToUse === NATIVE_OPENINGS, 'Unexpected native opening topology.');
  assert(offerArrays.records.filter((record) => record && !record.isEmpty).length === NATIVE_OPENINGS && offerArrays.header.nextRecordToUse === NATIVE_OPENINGS,
    'Unexpected native offer-array topology.');
  assert(coachTransactions.records.filter((record) => record && !record.isEmpty).length === NATIVE_ACTIVE_TRANSACTIONS,
    'Unexpected native transaction-row count.');
  assert(transactionArrays.arraySizes[0] === NATIVE_INDEXED_TRANSACTIONS, 'Unexpected native indexed Staff Moves count.');
  assert(state.openingArrays.arraySizes[0] === NATIVE_OPENINGS && state.openingArrays.records[0].arraySize === NATIVE_OPENINGS,
    'Unexpected native JobOpening[] size.');
  assert(Number.isInteger(OPENING_TARGET) && OPENING_TARGET >= NATIVE_OPENINGS && OPENING_TARGET <= OPENING_CAPACITY,
    `Invalid opening target ${OPENING_TARGET}.`);

  const roles = currentRoles(state);
  const nativeKeys = new Set(activeOpenings.map((opening) => `${refRow(opening.Team)}|${opening.Position}`));
  const nativeSelected = new Set(activeOpenings.map((opening) => opening.SelectedCoach));
  assert(nativeKeys.size === NATIVE_OPENINGS && nativeSelected.size === NATIVE_OPENINGS, 'Native openings duplicate destinations or selected Coaches.');
  const userTeamIndexes = new Set(roles.filter((item) => coaches.records[item.coachRow].IsUserControlled).map((item) => item.teamIndex));
  const candidates = roles.filter((item) => !nativeKeys.has(`${item.teamRow}|${item.role}`) &&
      !nativeSelected.has(coachReference(coaches, item.coachRow)) && !userTeamIndexes.has(item.teamIndex) &&
      !(item.teamIndex === 255 && item.role === 'HeadCoach'))
    .sort((a, b) => hashScore(`${a.teamRow}|${a.role}|${a.coachRow}`).localeCompare(hashScore(`${b.teamRow}|${b.role}|${b.coachRow}`)));
  assert(candidates.length >= ADDED_RETENTIONS, `Only ${candidates.length} safe added-retention roles are available; need ${ADDED_RETENTIONS}.`);
  let selectedCandidates = candidates.slice(0, ADDED_RETENTIONS);
  if (RETENTION_COACH_ROWS.length > 0) {
    assert(RETENTION_COACH_ROWS.length === ADDED_RETENTIONS,
      `CCR_CAP_RETENTION_COACH_ROWS must contain exactly ${ADDED_RETENTIONS} Coach rows.`);
    assert(new Set(RETENTION_COACH_ROWS).size === RETENTION_COACH_ROWS.length, 'Explicit retention Coach rows contain duplicates.');
    selectedCandidates = RETENTION_COACH_ROWS.map((coachRow) => {
      const candidate = candidates.find((item) => item.coachRow === coachRow);
      assert(candidate, `Coach row ${coachRow} is not an eligible added-retention candidate.`);
      return candidate;
    });
  }
  const addedRetentions = selectedCandidates.map((item, index) => ({ ...item, openingRow: NATIVE_OPENINGS + index }));

  const expectedByKey = new Map(roles.map((item) => [`${item.teamRow}|${item.role}`, item.coachRow]));
  for (const opening of activeOpenings) expectedByKey.set(`${refRow(opening.Team)}|${opening.Position}`, refRow(opening.SelectedCoach));
  for (const retention of addedRetentions) expectedByKey.set(`${retention.teamRow}|${retention.role}`, retention.coachRow);
  assert(expectedByKey.size === 429 && new Set(expectedByKey.values()).size === 429, 'Projected native-plus-retention landscape is not a unique 429-role assignment.');

  const userTeams = teams.records.filter((record) => record && !record.isEmpty && userTeamIndexes.has(record.TeamIndex))
    .map((record) => ({ teamRow: record.index, teamIndex: record.TeamIndex, team: displayName(record) }));
  return { roles, activeOpenings, addedRetentions, expectedByKey, userTeams };
}

function retentionTemplate(state) {
  const record = state.tables.openings.records.find((opening) => opening && !opening.isEmpty &&
    opening.SelectedCoach === opening.PrevCoach && opening.Reason === 'ContractEnding');
  assert(record, 'No native ContractEnding retention template exists.');
  return values(record);
}

function activateOfferArray(offerArrays, row) {
  const record = offerArrays.records[row];
  for (const field of offerSlots(record)) record[field] = EMPTY_REF;
  record.arraySize = 0;
  offerArrays.arraySizes[row] = 0;
}

function applyTreatment(state, plan, template) {
  const { openings, offerArrays, teams, coaches } = state.tables;
  for (const retention of plan.addedRetentions) {
    const { openingRow: row, teamRow, role, coachRow } = retention;
    const team = teams.records[teamRow];
    const coachRef = coachReference(coaches, coachRow);
    const price = Number(getValue(team, [ROLE_BUDGET_FIELDS[role]], 0)) || 0;
    activateOfferArray(offerArrays, row);
    writeValues(openings.records[row], {
      ...template,
      Team: teams.getBinaryReferenceToRecord(teamRow),
      SelectedCoach: coachRef,
      PrevCoach: coachRef,
      InterestedUserTeamsList: EMPTY_REF,
      ContractOfferList: offerArrays.getBinaryReferenceToRecord(row),
      Filled: true,
      IsEmergentJobOpening: false,
      Position: role,
      FinalContractProgramPoints: price,
      HighestOfferedProgramPoints: price,
      Reason: 'ContractEnding'
    });
    coaches.records[coachRow].ContractStatus = 'PendingRenewal';
  }

  const owner = state.openingArrays.records[0];
  const slots = ownerSlots(owner);
  assert(slots.length === OPENING_CAPACITY, `Expected ${OPENING_CAPACITY} JobOpening[] slots.`);
  for (let row = NATIVE_OPENINGS; row < OPENING_CAPACITY; row += 1) {
    owner[slots[row]] = row < OPENING_TARGET ? openings.getBinaryReferenceToRecord(row) : EMPTY_REF;
  }
  owner.arraySize = OPENING_TARGET;
  state.openingArrays.arraySizes[0] = OPENING_TARGET;
}

function validateTreatment(state, plan, before) {
  const { openings, offerArrays, coaches, coachTransactions, transactionArrays } = state.tables;
  assert(openings.records.filter((record) => record && !record.isEmpty).length === OPENING_TARGET && openings.header.nextRecordToUse === OPENING_TARGET,
    'Opening table did not reach the configured target coherently.');
  assert(offerArrays.records.filter((record) => record && !record.isEmpty).length === OPENING_TARGET && offerArrays.header.nextRecordToUse === OPENING_TARGET,
    'Offer-array table did not reach the configured target coherently.');
  assert(state.openingArrays.arraySizes[0] === OPENING_TARGET && state.openingArrays.records[0].arraySize === OPENING_TARGET,
    'JobOpening[] did not reach the configured logical size.');
  assert(coachTransactions.records.filter((record) => record && !record.isEmpty).length === NATIVE_ACTIVE_TRANSACTIONS &&
    transactionArrays.arraySizes[0] === NATIVE_INDEXED_TRANSACTIONS, 'Treatment changed native transaction topology.');

  const owner = state.openingArrays.records[0];
  const slots = ownerSlots(owner);
  for (let row = 0; row < OPENING_TARGET; row += 1) {
    assert(owner[slots[row]] === openings.getBinaryReferenceToRecord(row), `Owner slot ${row} is incoherent.`);
    assert(openings.records[row].ContractOfferList === offerArrays.getBinaryReferenceToRecord(row), `Opening ${row} does not own offer array ${row}.`);
  }
  for (const retention of plan.addedRetentions) {
    const opening = openings.records[retention.openingRow];
    const coachRef = coachReference(coaches, retention.coachRow);
    assert(opening.Team === state.tables.teams.getBinaryReferenceToRecord(retention.teamRow) && opening.Position === retention.role,
      `Added retention ${retention.openingRow} has the wrong destination.`);
    assert(opening.SelectedCoach === coachRef && opening.PrevCoach === coachRef && opening.Reason === 'ContractEnding',
      `Added retention ${retention.openingRow} is not a same-Coach contract event.`);
    assert(coaches.records[retention.coachRow].ContractStatus === 'PendingRenewal', `Added retention Coach ${retention.coachRow} is not pending renewal.`);
  }
  const activeOpenings = openings.records.filter((record) => record && !record.isEmpty);
  assert(new Set(activeOpenings.map((opening) => `${refRow(opening.Team)}|${opening.Position}`)).size === OPENING_TARGET,
    'Treatment openings duplicate a Team/role.');
  assert(new Set(activeOpenings.map((opening) => opening.SelectedCoach)).size === OPENING_TARGET,
    'Treatment openings duplicate a selected Coach.');
  if (OPENING_TARGET < OPENING_CAPACITY) {
    assert(openings.records[OPENING_TARGET].isEmpty && offerArrays.records[OPENING_TARGET].isEmpty,
      'The first reserved opening/offer headroom row is not empty.');
    assert(owner[slots[OPENING_TARGET]] === EMPTY_REF, 'The first reserved owner slot is not empty.');
  }

  const after = focusedSnapshot(state.tables);
  const differences = collectDifferences(before, after);
  const unexpected = differences.filter((change) => {
    if (change.table === 'openings' && change.row >= NATIVE_OPENINGS) return false;
    if (change.table === 'offerArrays' && (change.row >= NATIVE_OPENINGS || change.field === '$arraySizes')) return false;
    if (change.table === 'coaches' && change.field === 'ContractStatus') return false;
    return true;
  });
  assert(unexpected.length === 0, `Unexpected opening-only mutations: ${unexpected.map((change) => `${change.table}:${change.row}:${change.field}`).join(', ')}`);
  return differences;
}

function retentionManifest(state, plan) {
  const { teams, coaches } = state.tables;
  return plan.addedRetentions.map((item) => ({
    openingRow: item.openingRow,
    teamRow: item.teamRow,
    team: displayName(teams.records[item.teamRow]),
    role: item.role,
    coachRow: item.coachRow,
    coach: displayName(coaches.records[item.coachRow])
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  const output = path.join(options.outputDirectory, options.outputName);
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  assert(fs.existsSync(options.source) && sha256(options.source) === SOURCE_SHA256, 'CAP-2A source fixture hash mismatch.');

  const baseline = await loadWithOwner(options.source, schema);
  const plan = createPlan(baseline);
  const preview = {
    experimentId: EXPERIMENT_ID,
    mode: options.write ? 'write' : 'preview',
    seed: SEED,
    source: options.source,
    output,
    plan: {
      nativeOpeningsPreserved: NATIVE_OPENINGS,
      addedRetentionOpenings: plan.addedRetentions.length,
      totalRegisteredOpenings: NATIVE_OPENINGS + plan.addedRetentions.length,
      nativeActiveTransactionRowsPreserved: NATIVE_ACTIVE_TRANSACTIONS,
      nativeIndexedStaffMovesPreserved: NATIVE_INDEXED_TRANSACTIONS,
      projectedUniqueAssignments: plan.expectedByKey.size,
      protectedUserTeams: plan.userTeams
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
  const before = focusedSnapshot(treatment.tables);
  applyTreatment(treatment, treatmentPlan, retentionTemplate(treatment));
  await saveToTemporary(treatment.franchise, `${output}.tmp`);
  const reopened = await loadWithOwner(`${output}.tmp`, schema);
  const differences = validateTreatment(reopened, treatmentPlan, before);
  fs.renameSync(`${output}.tmp`, output);

  const manifest = {
    ...preview,
    mode: 'prepared',
    preparedAt: new Date().toISOString(),
    sourceSha256: SOURCE_SHA256,
    outputSha256: sha256(output),
    schema: reopened.declaredSchema,
    purpose: OPENING_TARGET === OPENING_CAPACITY
      ? 'Isolate opening/offer/owner physical saturation by filling all 408 positions with retention-only additions while preserving the source fixture\'s complete native carousel and Staff Moves ledger.'
      : `Test opening-only boundary behavior at ${OPENING_TARGET} registered events while preserving ${OPENING_CAPACITY - OPENING_TARGET} empty physical opening/offer/owner position(s) and the source fixture's complete native Staff Moves ledger.`,
    addedRetentions: retentionManifest(reopened, treatmentPlan),
    preAdvanceValidation: {
      status: 'passed',
      sourceHashEnforced: true,
      schemaAndParserReopenPassed: true,
      openingRowsActive: reopened.tables.openings.records.filter((record) => record && !record.isEmpty).length,
      openingOwnerLogicalSize: reopened.openingArrays.arraySizes[0],
      offerArrayRowsActive: reopened.tables.offerArrays.records.filter((record) => record && !record.isEmpty).length,
      activeTransactionRowsUnchanged: reopened.tables.coachTransactions.records.filter((record) => record && !record.isEmpty).length,
      indexedStaffMovesUnchanged: reopened.tables.transactionArrays.arraySizes[0],
      semanticDifferenceCount: differences.length,
      changedTables: [...new Set(differences.map((change) => change.table))]
    },
    expectedEos: `The complete native 186-event carousel commits unchanged, all ${ADDED_RETENTIONS} added same-Coach retention events commit, every one of the 429 final role assignments remains unique and coherent, Staff Moves stays at the native 111 indexed entries, and the opening/offer/owner structures are consumed normally.`,
    humanAction: `Load ${options.outputName} at CFP National Championship week, advance exactly once to End of Season, save as ${options.outputName}E, and leave the autosave in place.`
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...manifest, addedRetentions: `[${manifest.addedRetentions.length} retentions]` }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
