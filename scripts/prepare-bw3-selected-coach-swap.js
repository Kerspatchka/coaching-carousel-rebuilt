/*
 * Prepare the three-arm Bowl Week 3 SelectedCoach authority experiment.
 *
 * Preview (default):
 *   node scripts/prepare-bw3-selected-coach-swap.js
 *
 * Create the arms:
 *   node scripts/prepare-bw3-selected-coach-swap.js --write
 *
 * Requirements:
 *   CCR_SCHEMA_PATH -> tested CFB27_833_0.gz
 *   madden-franchise available normally or through NODE_PATH
 *
 * The source fixture is never passed to franchise.save().
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { FranchiseFile } = require('madden-franchise');

const EXPECTED_SOURCE_SHA256 = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const EXPECTED_SCHEMA = '833.0';
const EMPTY_REF = '00000000000000000000000000000000';

const TABLES = {
  coachTransactions: 2701814500,
  transactionArrays: 1261824345,
  offers: 674348040,
  offerArrays: 4119397260,
  openings: 263453863,
  coaches: 1860529246,
  teams: 3359508968
};

const TARGETS = [
  {
    openingRow: 22,
    team: 'Auburn',
    teamRow: 9,
    position: 'DefensiveCoordinator',
    reason: 'Fired',
    selectedCoach: 'M. Payne',
    selectedCoachRow: 495,
    previousCoach: 'D. Durkin',
    previousCoachRow: 128
  },
  {
    openingRow: 36,
    team: 'C. Carolina',
    teamRow: 22,
    position: 'DefensiveCoordinator',
    reason: 'Fired',
    selectedCoach: 'L. Toure',
    selectedCoachRow: 470,
    previousCoach: 'L. Scott',
    previousCoachRow: 440
  }
];

function parseArgs(argv) {
  const options = {
    write: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-selected-coach-swap')
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--write') options.write = true;
    else if (item === '--source') options.source = argv[++index];
    else if (item === '--output-dir') options.outputDirectory = argv[++index];
    else throw new Error(`Unknown argument: ${item}`);
  }

  options.source = path.resolve(options.source);
  options.outputDirectory = path.resolve(options.outputDirectory);
  return options;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function getFields(record) {
  return record && Array.isArray(record.fieldsArray) ? record.fieldsArray.map((field) => field.key) : [];
}

function getValue(record, aliases, fallback = null) {
  const names = getFields(record);
  const lowerToActual = new Map(names.map((name) => [name.toLowerCase(), name]));
  const key = aliases.find((name) => names.includes(name)) || aliases.map((name) => lowerToActual.get(name.toLowerCase())).find(Boolean);
  if (!key) return fallback;
  const result = record[key];
  return result === undefined || result === null ? fallback : result;
}

function displayName(record) {
  const direct = getValue(record, ['DisplayName', 'LongName', 'Name'], '');
  if (String(direct).trim()) return String(direct).trim();
  return [getValue(record, ['FirstName'], ''), getValue(record, ['LastName'], '')].join(' ').trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createFranchise(savePath, schemaPath) {
  return new Promise((resolve, reject) => {
    let franchise;
    try {
      franchise = new FranchiseFile(savePath, {
        autoParse: false,
        gameTypeOverride: 'college',
        gameYearOverride: 27
      });
      const declared = franchise.expectedSchemaVersion;
      franchise.settings.schemaOverride = {
        major: declared.major,
        minor: declared.minor,
        gameYear: declared.gameYear,
        path: schemaPath
      };
    } catch (error) {
      reject(error);
      return;
    }
    franchise.on('ready', () => resolve(franchise));
    franchise.on('error', reject);
    franchise.parse();
  });
}

async function loadExperimentState(savePath, schemaPath) {
  const franchise = await createFranchise(savePath, schemaPath);
  const declaredSchema = `${franchise.expectedSchemaVersion.major}.${franchise.expectedSchemaVersion.minor}`;
  assert(declaredSchema === EXPECTED_SCHEMA, `Expected schema ${EXPECTED_SCHEMA}, found ${declaredSchema}.`);

  const tables = Object.fromEntries(Object.entries(TABLES).map(([name, uniqueId]) => [name, franchise.getTableByUniqueId(uniqueId)]));
  for (const [name, table] of Object.entries(tables)) {
    assert(table, `Required ${name} table ${TABLES[name]} is missing.`);
  }
  await Promise.all(Object.values(tables).map((table) => table.readRecords()));

  return { franchise, tables, declaredSchema };
}

function tableSnapshot(table) {
  return {
    name: table.name,
    tableId: table.header.tableId,
    uniqueId: table.header.uniqueId,
    arraySizes: Array.isArray(table.arraySizes) ? [...table.arraySizes] : null,
    records: table.records.map((record) => {
      if (!record) return null;
      return {
        isEmpty: Boolean(record.isEmpty),
        values: Object.fromEntries(getFields(record).map((key) => [key, record[key]]))
      };
    })
  };
}

function focusedSnapshot(tables) {
  return Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, tableSnapshot(table)]));
}

function stableJson(value) {
  return JSON.stringify(value);
}

function collectDifferences(before, after) {
  const differences = [];
  for (const tableName of Object.keys(TABLES)) {
    const priorTable = before[tableName];
    const nextTable = after[tableName];
    if (stableJson(priorTable.arraySizes) !== stableJson(nextTable.arraySizes)) {
      differences.push({ table: tableName, field: '$arraySizes' });
    }
    const length = Math.max(priorTable.records.length, nextTable.records.length);
    for (let row = 0; row < length; row += 1) {
      const prior = priorTable.records[row];
      const next = nextTable.records[row];
      if (!prior || !next || prior.isEmpty !== next.isEmpty) {
        differences.push({ table: tableName, row, field: '$record' });
        continue;
      }
      const keys = new Set([...Object.keys(prior.values), ...Object.keys(next.values)]);
      for (const key of keys) {
        if (stableJson(prior.values[key]) !== stableJson(next.values[key])) {
          differences.push({ table: tableName, row, field: key, before: prior.values[key], after: next.values[key] });
        }
      }
    }
  }
  return differences;
}

function coachReference(coachTable, row) {
  return coachTable.getBinaryReferenceToRecord(row);
}

function validateSource(state) {
  const { openings, coaches, teams, offers, offerArrays } = state.tables;
  const activeOpenings = openings.records.filter((record) => record && !record.isEmpty);
  assert(activeOpenings.length === 192, `Expected 192 active openings, found ${activeOpenings.length}.`);

  const realOffers = offers.records.filter((record) => record && !record.isEmpty && getValue(record, ['ContractPosition']) !== 'Invalid_');
  const populatedArrays = offerArrays.records.filter((record) => record && !record.isEmpty && getFields(record)
    .filter((name) => /^StaffPersonContractOffer\d+$/i.test(name))
    .some((name) => record[name] && record[name] !== EMPTY_REF));
  assert(realOffers.length === 0, `Expected no real BW3 offers, found ${realOffers.length}.`);
  assert(populatedArrays.length === 0, `Expected no populated BW3 offer arrays, found ${populatedArrays.length}.`);

  const selectedRefs = new Map();
  for (const opening of activeOpenings) {
    assert(getValue(opening, ['Filled']) === true, `Opening row ${opening.index} is not filled.`);
    const selectedRef = getValue(opening, ['SelectedCoach'], EMPTY_REF);
    assert(selectedRef !== EMPTY_REF, `Opening row ${opening.index} has no selected coach.`);
    assert(!selectedRefs.has(selectedRef), `Coach reference ${selectedRef} is selected by multiple openings.`);
    selectedRefs.set(selectedRef, opening.index);
  }

  const details = [];
  for (const target of TARGETS) {
    const opening = openings.records[target.openingRow];
    const team = teams.records[target.teamRow];
    const selectedCoach = coaches.records[target.selectedCoachRow];
    const previousCoach = coaches.records[target.previousCoachRow];

    assert(opening && !opening.isEmpty, `Opening row ${target.openingRow} is missing.`);
    assert(team && !team.isEmpty, `Team row ${target.teamRow} is missing.`);
    assert(selectedCoach && !selectedCoach.isEmpty, `Selected Coach row ${target.selectedCoachRow} is missing.`);
    assert(previousCoach && !previousCoach.isEmpty, `Previous Coach row ${target.previousCoachRow} is missing.`);
    assert(displayName(team) === target.team, `Opening ${target.openingRow}: expected ${target.team}, found ${displayName(team)}.`);
    assert(displayName(selectedCoach) === target.selectedCoach, `Opening ${target.openingRow}: expected ${target.selectedCoach}.`);
    assert(displayName(previousCoach) === target.previousCoach, `Opening ${target.openingRow}: expected prior coach ${target.previousCoach}.`);
    assert(getValue(opening, ['Team']) === teams.getBinaryReferenceToRecord(target.teamRow), `Opening ${target.openingRow}: Team reference mismatch.`);
    assert(getValue(opening, ['Position']) === target.position, `Opening ${target.openingRow}: position mismatch.`);
    assert(getValue(opening, ['Reason']) === target.reason, `Opening ${target.openingRow}: reason mismatch.`);
    assert(getValue(opening, ['IsEmergentJobOpening']) === false, `Opening ${target.openingRow}: opening is emergent.`);
    assert(getValue(opening, ['SelectedCoach']) === coachReference(coaches, target.selectedCoachRow), `Opening ${target.openingRow}: selected coach mismatch.`);
    assert(getValue(opening, ['PrevCoach']) === coachReference(coaches, target.previousCoachRow), `Opening ${target.openingRow}: previous coach mismatch.`);
    assert(getValue(selectedCoach, ['Position']) === target.position, `${target.selectedCoach}: prior role mismatch.`);
    assert(getValue(selectedCoach, ['ContractStatus']) === 'Last_Pending', `${target.selectedCoach}: expected Last_Pending.`);
    assert(getValue(selectedCoach, ['IsUserControlled']) === false, `${target.selectedCoach}: coach is user-controlled.`);
    assert(getValue(selectedCoach, ['TeamIndex']) === 255, `${target.selectedCoach}: expected FCS/free-agent TeamIndex 255.`);

    const teamOpenings = activeOpenings.filter((record) => getValue(record, ['Team']) === getValue(opening, ['Team']));
    assert(teamOpenings.length === 1, `${target.team}: expected one opening, found ${teamOpenings.length}.`);

    details.push({
      openingRow: target.openingRow,
      team: target.team,
      position: target.position,
      reason: target.reason,
      selectedCoach: target.selectedCoach,
      selectedCoachRow: target.selectedCoachRow,
      selectedCoachReference: coachReference(coaches, target.selectedCoachRow),
      previousCoach: target.previousCoach,
      previousCoachRow: target.previousCoachRow,
      currentTeamRoleReference: getValue(team, [target.position])
    });
  }

  return { activeOpeningCount: activeOpenings.length, details };
}

function validateTestState(state, sourceSnapshot) {
  validateSourceStructureAfterSwap(state);
  const differences = collectDifferences(sourceSnapshot, focusedSnapshot(state.tables));
  const allowed = new Set(TARGETS.map((target) => `openings:${target.openingRow}:SelectedCoach`));
  const actual = new Set(differences.map((change) => `${change.table}:${change.row}:${change.field}`));
  assert(differences.length === 2, `Expected two focused semantic changes, found ${differences.length}.`);
  assert([...actual].every((item) => allowed.has(item)), `Unexpected focused semantic change: ${[...actual].filter((item) => !allowed.has(item)).join(', ')}`);
  assert([...allowed].every((item) => actual.has(item)), 'One or more planned SelectedCoach changes were not persisted.');
  return differences;
}

function validateSourceStructureAfterSwap(state) {
  const { openings, coaches } = state.tables;
  const first = TARGETS[0];
  const second = TARGETS[1];
  assert(getValue(openings.records[first.openingRow], ['SelectedCoach']) === coachReference(coaches, second.selectedCoachRow), 'Auburn did not receive L. Toure.');
  assert(getValue(openings.records[second.openingRow], ['SelectedCoach']) === coachReference(coaches, first.selectedCoachRow), 'Coastal Carolina did not receive M. Payne.');

  const selectedRefs = new Map();
  for (const opening of openings.records.filter((record) => record && !record.isEmpty)) {
    const reference = getValue(opening, ['SelectedCoach'], EMPTY_REF);
    assert(reference !== EMPTY_REF, `Opening row ${opening.index} has no selected coach after swap.`);
    assert(!selectedRefs.has(reference), `Coach reference ${reference} is selected more than once after swap.`);
    selectedRefs.set(reference, opening.index);
  }
}

async function saveToTemporary(franchise, temporaryPath) {
  await franchise.save(temporaryPath);
  assert(fs.existsSync(temporaryPath), `Save output was not created: ${temporaryPath}`);
}

function ensureCleanTargets(paths) {
  for (const filePath of Object.values(paths)) {
    assert(!fs.existsSync(filePath), `Refusing to overwrite existing experiment artifact: ${filePath}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schemaPath = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(fs.existsSync(options.source), `Source save not found: ${options.source}`);
  assert(schemaPath && fs.existsSync(schemaPath), 'Set CCR_SCHEMA_PATH to the tested CFB27_833_0.gz schema.');
  assert(sha256(options.source) === EXPECTED_SOURCE_SHA256, 'Source BW3 fixture hash does not match the tested fixture.');

  const sourceState = await loadExperimentState(options.source, schemaPath);
  const sourceValidation = validateSource(sourceState);
  const sourceSnapshot = focusedSnapshot(sourceState.tables);

  const arms = {
    control: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-EXP-CONTROL'),
    sham: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-EXP-SHAM'),
    test: path.join(options.outputDirectory, 'DYNASTY-CCRY1BW3-EXP-TEST-SWAP')
  };
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');

  const plan = {
    mode: options.write ? 'write' : 'preview',
    source: options.source,
    sourceSha256: EXPECTED_SOURCE_SHA256,
    schema: sourceState.declaredSchema,
    outputDirectory: options.outputDirectory,
    arms,
    targets: sourceValidation.details,
    mutation: [
      { openingRow: TARGETS[0].openingRow, field: 'SelectedCoach', from: TARGETS[0].selectedCoach, to: TARGETS[1].selectedCoach },
      { openingRow: TARGETS[1].openingRow, field: 'SelectedCoach', from: TARGETS[1].selectedCoach, to: TARGETS[0].selectedCoach }
    ]
  };

  if (!options.write) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.stderr.write('Preview only. Re-run with --write to create the experiment arms.\n');
    return;
  }

  ensureCleanTargets({ ...arms, manifestPath });
  fs.mkdirSync(options.outputDirectory, { recursive: true });

  fs.copyFileSync(options.source, arms.control);
  assert(sha256(arms.control) === EXPECTED_SOURCE_SHA256, 'Control copy is not byte-identical to source.');

  const shamTemporary = `${arms.sham}.tmp`;
  const shamStateForWrite = await loadExperimentState(options.source, schemaPath);
  await saveToTemporary(shamStateForWrite.franchise, shamTemporary);
  const shamReopened = await loadExperimentState(shamTemporary, schemaPath);
  validateSource(shamReopened);
  const shamDifferences = collectDifferences(sourceSnapshot, focusedSnapshot(shamReopened.tables));
  assert(shamDifferences.length === 0, `Sham save introduced ${shamDifferences.length} focused semantic changes.`);
  fs.renameSync(shamTemporary, arms.sham);

  const testTemporary = `${arms.test}.tmp`;
  const testStateForWrite = await loadExperimentState(options.source, schemaPath);
  const firstTarget = TARGETS[0];
  const secondTarget = TARGETS[1];
  testStateForWrite.tables.openings.records[firstTarget.openingRow].SelectedCoach = coachReference(testStateForWrite.tables.coaches, secondTarget.selectedCoachRow);
  testStateForWrite.tables.openings.records[secondTarget.openingRow].SelectedCoach = coachReference(testStateForWrite.tables.coaches, firstTarget.selectedCoachRow);
  await saveToTemporary(testStateForWrite.franchise, testTemporary);
  const testReopened = await loadExperimentState(testTemporary, schemaPath);
  const testDifferences = validateTestState(testReopened, sourceSnapshot);
  fs.renameSync(testTemporary, arms.test);

  const manifest = {
    ...plan,
    mode: 'write',
    createdAt: new Date().toISOString(),
    hashes: {
      source: sha256(options.source),
      control: sha256(arms.control),
      sham: sha256(arms.sham),
      test: sha256(arms.test)
    },
    preAdvanceValidation: {
      controlByteIdenticalToSource: sha256(arms.control) === EXPECTED_SOURCE_SHA256,
      shamFocusedSemanticDifferences: shamDifferences,
      testFocusedSemanticDifferences: testDifferences,
      status: 'passed'
    },
    nextAction: 'Copy each DYNASTY-* arm into the game save directory, advance exactly once from Bowl Week 3 to End of Season, and save each result under a distinct EOS name.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EMPTY_REF,
  assert,
  coachReference,
  collectDifferences,
  displayName,
  focusedSnapshot,
  getValue,
  loadExperimentState,
  saveToTemporary,
  sha256
};
