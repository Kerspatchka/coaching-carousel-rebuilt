/* CAP-1B: register CAP-1's added physical opening in the JobOpening[] owner array. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');

const OWNER_TABLE_UNIQUE_ID = 2358764614;
const EXPECTED_PARENT_SHA256 = '6DD1C2D24464DAE48923DD5A4B271A08D39130EB4443391BD7C6427E0DAA3188';
const EXPECTED_SOURCE_SHA256 = 'FB090BE76CCE6D51E24CEC3FCB66F3AABF66B124FAADE8CD03565CFACE50E4A2';
const EXPECTED_NATIVE_SIZE = 186;
const ADDED_OPENING_ROW = 186;

function parseArgs(argv) {
  const options = {
    write: false,
    parent: path.join(__dirname, '..', 'assets', 'experiments', 'capacity-policy', 'cap1-one-event-expansion', 'DYNASTY-CCRCAP1T1'),
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'capacity-policy', 'cap0-sources', 'DYNASTY-TEST1NATCHAMP'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'capacity-policy', 'cap1b-owner-array-expansion'),
    outputName: 'DYNASTY-CCRCAP1B'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--write') options.write = true;
    else if (item === '--parent') options.parent = argv[++index];
    else if (item === '--source') options.source = argv[++index];
    else if (item === '--output-dir') options.outputDirectory = argv[++index];
    else if (item === '--output-name') options.outputName = argv[++index];
    else throw new Error(`Unknown argument: ${item}`);
  }
  options.parent = path.resolve(options.parent);
  options.source = path.resolve(options.source);
  options.outputDirectory = path.resolve(options.outputDirectory);
  return options;
}

function ownerSlots(record) {
  return (record.fieldsArray || []).map((field) => field.key)
    .filter((field) => /^JobOpening\d+$/.test(field))
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

function validateOwnerBaseline(state) {
  const { openings } = state.tables;
  const { openingArrays } = state;
  const owner = openingArrays.records[0];
  const slots = ownerSlots(owner);
  assert(owner && !owner.isEmpty, 'JobOpening[] row 0 is not active.');
  assert(openingArrays.header.recordCapacity === 1, 'Unexpected JobOpening[] record capacity.');
  assert(slots.length === openings.header.recordCapacity, 'JobOpening[] slot count does not match JobOpening capacity.');
  assert(slots.length === 408, `Expected 408 owner slots, found ${slots.length}.`);
  assert(openingArrays.arraySizes[0] === EXPECTED_NATIVE_SIZE, `Expected JobOpening[] size ${EXPECTED_NATIVE_SIZE}, found ${openingArrays.arraySizes[0]}.`);
  assert(owner.arraySize === EXPECTED_NATIVE_SIZE, `Expected JobOpening[] record size ${EXPECTED_NATIVE_SIZE}, found ${owner.arraySize}.`);
  assert(!openings.records[ADDED_OPENING_ROW].isEmpty, `Opening row ${ADDED_OPENING_ROW} is not active in the CAP-1 parent.`);
  for (let row = 0; row < EXPECTED_NATIVE_SIZE; row += 1) {
    assert(owner[slots[row]] === openings.getBinaryReferenceToRecord(row), `Owner slot ${row} does not reference opening row ${row}.`);
  }
  assert(owner[slots[ADDED_OPENING_ROW]] === EMPTY_REF, `Owner slot ${ADDED_OPENING_ROW} is already populated.`);
  return { owner, slots };
}

function applyTreatment(state) {
  const { openings } = state.tables;
  const { openingArrays } = state;
  const { owner, slots } = validateOwnerBaseline(state);
  owner[slots[ADDED_OPENING_ROW]] = openings.getBinaryReferenceToRecord(ADDED_OPENING_ROW);
  owner.arraySize = EXPECTED_NATIVE_SIZE + 1;
  openingArrays.arraySizes[0] = EXPECTED_NATIVE_SIZE + 1;
}

function validateTreatment(state) {
  const { openings } = state.tables;
  const { openingArrays } = state;
  const owner = openingArrays.records[0];
  const slots = ownerSlots(owner);
  const expectedReference = openings.getBinaryReferenceToRecord(ADDED_OPENING_ROW);
  assert(openingArrays.arraySizes[0] === EXPECTED_NATIVE_SIZE + 1, 'JobOpening[] table size did not grow exactly one slot.');
  assert(owner.arraySize === EXPECTED_NATIVE_SIZE + 1, 'JobOpening[] record size did not grow exactly one slot.');
  assert(owner[slots[ADDED_OPENING_ROW]] === expectedReference, 'The new owner slot does not reference the added opening.');
  assert(owner[slots[ADDED_OPENING_ROW + 1]] === EMPTY_REF, 'The owner slot after the treatment boundary is not empty.');
  assert(!openings.records[ADDED_OPENING_ROW].isEmpty, 'The registered opening is not active after reopen.');
  return {
    tableName: openingArrays.name,
    uniqueId: openingArrays.header.uniqueId,
    tableId: openingArrays.header.tableId,
    physicalSlots: slots.length,
    beforeLogicalSize: EXPECTED_NATIVE_SIZE,
    afterLogicalSize: openingArrays.arraySizes[0],
    addedSlot: slots[ADDED_OPENING_ROW],
    addedOpeningRow: ADDED_OPENING_ROW,
    addedReference: expectedReference
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  const output = path.join(options.outputDirectory, options.outputName);
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  assert(fs.existsSync(options.parent) && sha256(options.parent) === EXPECTED_PARENT_SHA256, 'CAP-1 parent treatment hash mismatch.');
  assert(fs.existsSync(options.source) && sha256(options.source) === EXPECTED_SOURCE_SHA256, 'CAP-0 source fixture hash mismatch.');

  const preview = await loadWithOwner(options.parent, schema);
  const baseline = validateOwnerBaseline(preview);
  const plan = {
    parent: options.parent,
    parentSha256: EXPECTED_PARENT_SHA256,
    source: options.source,
    sourceSha256: EXPECTED_SOURCE_SHA256,
    output,
    treatment: {
      ownerTable: preview.openingArrays.name,
      ownerTableUniqueId: OWNER_TABLE_UNIQUE_ID,
      ownerSlot: baseline.slots[ADDED_OPENING_ROW],
      openingRow: ADDED_OPENING_ROW,
      logicalSizeBefore: EXPECTED_NATIVE_SIZE,
      logicalSizeAfter: EXPECTED_NATIVE_SIZE + 1
    }
  };
  if (!options.write) {
    process.stdout.write(`${JSON.stringify({ experimentId: 'CAP-1B', mode: 'preview', ...plan }, null, 2)}\n`);
    return;
  }

  fs.mkdirSync(options.outputDirectory, { recursive: true });
  assert(!fs.existsSync(output), `Refusing to overwrite ${output}.`);
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  assert(!fs.existsSync(manifestPath), `Refusing to overwrite ${manifestPath}.`);

  const treatment = await loadWithOwner(options.parent, schema);
  applyTreatment(treatment);
  const temporary = `${output}.tmp`;
  assert(!fs.existsSync(temporary), `Refusing to overwrite ${temporary}.`);
  await saveToTemporary(treatment.franchise, temporary);
  const reopened = await loadWithOwner(temporary, schema);
  const validation = validateTreatment(reopened);
  fs.renameSync(temporary, output);

  const manifest = {
    experimentId: 'CAP-1B',
    preparedAt: new Date().toISOString(),
    purpose: 'Test whether JobOpening[] ownership is the missing authority for expansion beyond a save\'s native opening count.',
    ...plan,
    outputSha256: sha256(output),
    preAdvanceValidation: {
      status: 'passed',
      schema: reopened.declaredSchema,
      parentHashEnforced: true,
      sourceHashEnforced: true,
      parserReopenPassed: true,
      ownerArray: validation
    },
    expectedEos: 'S. Russ moves from Air Force DC to App St. DC; J. Bars fills the resulting Air Force DC opening; both Staff Moves entries remain visible.',
    humanAction: 'Load DYNASTY-CCRCAP1B at CFP National Championship week, advance exactly once to End of Season, save as DYNASTY-CCRCAP1BE, and leave the autosave in place.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
