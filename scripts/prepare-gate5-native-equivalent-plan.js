/* Gate 5: regenerate the complete native BW3 staged plan with canonical fixed-pool allocation. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, collectDifferences, focusedSnapshot, getValue,
  loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const ROLE_ORDER = { HeadCoach: 0, OffensiveCoordinator: 1, DefensiveCoordinator: 2 };

function parseArgs(argv) {
  const options = {
    write: false,
    preserveTransactionLayout: false,
    source: path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate5-native-equivalent-plan')
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--write') options.write = true;
    else if (argv[index] === '--preserve-transaction-layout') options.preserveTransactionLayout = true;
    else if (argv[index] === '--source') options.source = argv[++index];
    else if (argv[index] === '--output-dir') options.outputDirectory = argv[++index];
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

function transactionSlots(record) {
  return fields(record).filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function openingKey(event) {
  const record = event.values;
  return [
    String(refRow(record.Team)).padStart(4, '0'),
    String(ROLE_ORDER[record.Position] ?? 9),
    String(record.Reason),
    String(refRow(record.PrevCoach)).padStart(4, '0'),
    String(refRow(record.SelectedCoach)).padStart(4, '0')
  ].join('|');
}

function transactionKey(event) {
  const record = event.values;
  return [
    String(refRow(record.Coach)).padStart(4, '0'),
    String(refRow(record.OldTeam) ?? 999).padStart(4, '0'),
    String(refRow(record.NewTeam) ?? 999).padStart(4, '0'),
    String(record.SeasonYear).padStart(4, '0'),
    String(record.SeasonWeek).padStart(3, '0'),
    String(record.TransactionId).padStart(5, '0')
  ].join('|');
}

function stable(value) {
  return JSON.stringify(value);
}

function openingSemantic(event) {
  const record = { ...event.values };
  delete record.ContractOfferList;
  return record;
}

function sortedSemantic(events, projector) {
  return events.map(projector).map(stable).sort();
}

function extractPlan(state) {
  const { openings, coachTransactions, transactionArrays } = state.tables;
  const transactionArray = transactionArrays.records[0];
  const slots = transactionSlots(transactionArray);
  const size = transactionArrays.arraySizes[0];
  const indexed = new Set(slots.slice(0, size).map((field) => transactionArray[field]));
  const openingEvents = openings.records.filter((record) => record && !record.isEmpty)
    .map((record) => ({ originalRow: record.index, values: values(record) }));
  const transactionEvents = coachTransactions.records.filter((record) => record && !record.isEmpty)
    .map((record) => ({
      originalRow: record.index,
      indexed: indexed.has(coachTransactions.getBinaryReferenceToRecord(record.index)),
      values: values(record)
    }));
  return { openingEvents, transactionEvents };
}

function validateBaseline(state, plan) {
  const { openings, offerArrays, coachTransactions, transactionArrays } = state.tables;
  assert(plan.openingEvents.length === 192, `Expected 192 opening events, found ${plan.openingEvents.length}.`);
  assert(plan.transactionEvents.length === 125, `Expected 125 active transactions, found ${plan.transactionEvents.length}.`);
  assert(plan.transactionEvents.filter((event) => event.indexed).length === 124, 'Expected 124 indexed transactions.');
  assert(openings.header.nextRecordToUse === 192, 'Unexpected opening fixed-pool boundary.');
  assert(coachTransactions.header.nextRecordToUse === 125, 'Unexpected transaction allocation boundary.');
  assert(offerArrays.records.slice(0, 192).every((record) => record && !record.isEmpty), 'Expected 192 active offer-array rows.');
  assert(offerArrays.arraySizes.slice(0, 192).every((size) => size === 0), 'Expected cleared BW3 offer arrays.');
  assert(transactionArrays.arraySizes[0] === 124, 'Unexpected transaction-array size.');
  const teamRoles = plan.openingEvents.map((event) => `${refRow(event.values.Team)}|${event.values.Position}`);
  assert(new Set(teamRoles).size === teamRoles.length, 'Duplicate Team/role opening events exist.');
  const selected = plan.openingEvents.map((event) => event.values.SelectedCoach);
  assert(selected.every((reference) => reference !== EMPTY_REF) && new Set(selected).size === selected.length, 'Selected Coaches are empty or duplicated.');
  const indexedTransactionIds = plan.transactionEvents.filter((event) => event.indexed).map((event) => event.values.TransactionId);
  assert(new Set(indexedTransactionIds).size === indexedTransactionIds.length, 'Duplicate indexed transaction IDs exist.');
  const unindexed = plan.transactionEvents.filter((event) => !event.indexed);
  assert(unindexed.length === 1 && unindexed[0].values.TransactionId === 0, 'Unexpected native unindexed transaction sentinel.');
}

function applyCanonicalPlan(state, sourcePlan, preserveTransactionLayout) {
  const { openings, offerArrays, coachTransactions, transactionArrays } = state.tables;
  const openingEvents = [...sourcePlan.openingEvents].sort((a, b) => openingKey(a).localeCompare(openingKey(b)));
  for (let row = 0; row < openingEvents.length; row += 1) {
    const next = { ...openingEvents[row].values, ContractOfferList: offerArrays.getBinaryReferenceToRecord(row) };
    writeValues(openings.records[row], next);
  }

  const transactionEvents = preserveTransactionLayout
    ? [...sourcePlan.transactionEvents].sort((a, b) => {
      const rowA = a.indexed ? Number(a.values.TransactionId) + 1 : 0;
      const rowB = b.indexed ? Number(b.values.TransactionId) + 1 : 0;
      return rowA - rowB;
    })
    : [...sourcePlan.transactionEvents].sort((a, b) => transactionKey(a).localeCompare(transactionKey(b)));
  const transactionDestinations = transactionEvents.map((event, index) => preserveTransactionLayout
    ? (event.indexed ? Number(event.values.TransactionId) + 1 : 0) : index);
  for (let index = 0; index < transactionEvents.length; index += 1) writeValues(coachTransactions.records[transactionDestinations[index]], transactionEvents[index].values);
  const array = transactionArrays.records[0];
  const slots = transactionSlots(array);
  const indexedRows = transactionEvents.map((event, index) => ({ event, row: transactionDestinations[index] })).filter(({ event }) => event.indexed)
    .sort((a, b) => Number(a.event.values.TransactionId) - Number(b.event.values.TransactionId)).map(({ row }) => row);
  for (let index = 0; index < slots.length; index += 1) {
    array[slots[index]] = index < indexedRows.length ? coachTransactions.getBinaryReferenceToRecord(indexedRows[index]) : EMPTY_REF;
  }
  array.arraySize = indexedRows.length;
  transactionArrays.arraySizes[0] = indexedRows.length;
  return {
    openingRowsMoved: openingEvents.filter((event, row) => event.originalRow !== row).length,
    transactionRowsMoved: transactionEvents.filter((event, index) => event.originalRow !== transactionDestinations[index]).length,
    indexedTransactions: indexedRows.length,
    transactionLayout: preserveTransactionLayout ? 'transaction-id-derived' : 'row-independent-canonical'
  };
}

function validateCanonicalPlan(state, sourcePlan, sourceSnapshot, allocation) {
  const { openings, offerArrays, coachTransactions, transactionArrays } = state.tables;
  const rebuilt = extractPlan(state);
  validateBaseline(state, rebuilt);
  assert(stable(sortedSemantic(rebuilt.openingEvents, openingSemantic)) === stable(sortedSemantic(sourcePlan.openingEvents, openingSemantic)), 'Opening semantic ledger changed.');
  assert(stable(sortedSemantic(rebuilt.transactionEvents, (event) => ({ ...event.values, indexed: event.indexed }))) === stable(sortedSemantic(sourcePlan.transactionEvents, (event) => ({ ...event.values, indexed: event.indexed }))), 'Transaction semantic ledger changed.');
  for (let row = 0; row < 192; row += 1) {
    assert(openings.records[row].ContractOfferList === offerArrays.getBinaryReferenceToRecord(row), `Opening ${row} does not own offer array ${row}.`);
  }
  assert(allocation.openingRowsMoved >= 180, `Canonicalization moved only ${allocation.openingRowsMoved} opening rows.`);
  if (allocation.transactionLayout === 'row-independent-canonical') {
    assert(allocation.transactionRowsMoved >= 100, `Canonicalization moved only ${allocation.transactionRowsMoved} transaction rows.`);
  } else {
    assert(allocation.transactionRowsMoved === 0, 'ID-derived transaction reconstruction changed native transaction rows.');
    const array = transactionArrays.records[0];
    const slots = transactionSlots(array).slice(0, transactionArrays.arraySizes[0]);
    for (let slot = 0; slot < slots.length; slot += 1) {
      const row = refRow(array[slots[slot]]);
      assert(row === slot + 1 && coachTransactions.records[row].TransactionId === slot, `Transaction identity invariant failed at slot ${slot}.`);
    }
  }
  assert(transactionArrays.arraySizes[0] === 124 && coachTransactions.records.filter((record) => record && !record.isEmpty).length === 125, 'Transaction pool shape changed.');
  const differences = collectDifferences(sourceSnapshot, focusedSnapshot(state.tables));
  const unexpected = differences.filter((change) => !['openings', 'coachTransactions', 'transactionArrays'].includes(change.table));
  assert(unexpected.length === 0, `Unrelated tables changed: ${unexpected.map((change) => `${change.table}:${change.row}:${change.field}`).join(', ')}`);
  return differences;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  assert(fs.existsSync(options.source) && sha256(options.source) === SOURCE_HASH, 'Source BW3 fixture mismatch.');
  const source = await loadExperimentState(options.source, schema);
  const sourcePlan = extractPlan(source);
  validateBaseline(source, sourcePlan);
  const experimentId = options.preserveTransactionLayout ? 'G5B' : 'G5';
  const outputName = options.preserveTransactionLayout ? 'DYNASTY-CCRY1BW3-G5B-TXINVARIANT' : 'DYNASTY-CCRY1BW3-G5-NATIVEEQUIV';
  if (options.preserveTransactionLayout && !process.argv.includes('--output-dir')) {
    options.outputDirectory = path.join(__dirname, '..', 'assets', 'experiments', 'bw3-full-reset', 'gate5b-transaction-invariant');
  }
  const output = path.join(options.outputDirectory, outputName);
  const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
  const preview = {
    mode: options.write ? 'write' : 'preview', source: options.source, output,
    experimentId, transactionLayout: options.preserveTransactionLayout ? 'transaction-id-derived' : 'row-independent-canonical',
    plan: { openings: sourcePlan.openingEvents.length, activeTransactions: sourcePlan.transactionEvents.length, indexedTransactions: sourcePlan.transactionEvents.filter((event) => event.indexed).length }
  };
  if (!options.write) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return;
  }
  for (const target of [output, `${output}.tmp`, manifestPath]) assert(!fs.existsSync(target), `Refusing to overwrite ${target}`);
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const treatment = await loadExperimentState(options.source, schema);
  const sourceSnapshot = focusedSnapshot(treatment.tables);
  const allocation = applyCanonicalPlan(treatment, sourcePlan, options.preserveTransactionLayout);
  await saveToTemporary(treatment.franchise, `${output}.tmp`);
  const reopened = await loadExperimentState(`${output}.tmp`, schema);
  const differences = validateCanonicalPlan(reopened, sourcePlan, sourceSnapshot, allocation);
  fs.renameSync(`${output}.tmp`, output);
  const manifest = {
    preparedAt: new Date().toISOString(), experimentId, source: options.source, sourceSha256: SOURCE_HASH,
    output, outputSha256: sha256(output), schema: reopened.declaredSchema,
    purpose: options.preserveTransactionLayout
      ? 'Regenerate the complete native BW3 staged carousel with canonical opening allocation while preserving the Staff Moves slot i -> row i+1 -> TransactionId i invariant.'
      : 'Regenerate the complete native BW3 staged carousel into canonical fixed-pool opening and transaction allocations without changing its semantic event ledger.',
    planCounts: preview.plan, allocation, semanticDifferenceCount: differences.length,
    changedTables: [...new Set(differences.map((change) => change.table))],
    preAdvanceValidation: 'passed',
    expectedEos: options.preserveTransactionLayout
      ? 'Native-equivalent Team staff, Coach employment/contracts, and visually correct Staff Moves after canonical opening allocation and ID-derived transaction reconstruction.'
      : 'Native-equivalent Team staff, Coach employment/contracts, and semantic Staff Moves despite different BW3 physical opening and transaction row allocation.'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = {
  applyCanonicalPlan, extractPlan, openingSemantic, refRow, sortedSemantic,
  transactionKey, validateBaseline, validateCanonicalPlan
};
