/* Read-only Gate 0 inventory for complete BW3 carousel replacement. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF,
  assert,
  coachReference,
  displayName,
  getValue,
  loadExperimentState,
  sha256
} = require('./prepare-bw3-selected-coach-swap');

const SOURCE_HASH = 'A3FF8B089762A4095A40D6EF6093413CE477A8047B201C4BB8176696A3E277B0';
const TARGET_COACH_ROWS = [128, 495, 415, 451];

function fields(record) {
  return record && Array.isArray(record.fieldsArray) ? record.fieldsArray.map((field) => field.key) : [];
}

function recordValues(record) {
  return Object.fromEntries(fields(record).map((field) => [field, record[field]]));
}

function descriptor(table) {
  const records = table.records || [];
  const activeRows = records.filter((record) => record && !record.isEmpty).map((record) => record.index);
  const emptyRows = records.filter((record) => record && record.isEmpty).map((record) => record.index);
  return {
    name: table.name,
    tableId: table.header.tableId,
    uniqueId: table.header.uniqueId,
    capacity: table.header.recordCapacity,
    activeCount: activeRows.length,
    emptyCount: emptyRows.length,
    firstActiveRows: activeRows.slice(0, 10),
    firstEmptyRows: emptyRows.slice(0, 20),
    fields: fields(records.find((record) => record && !record.isEmpty) || records[0])
  };
}

function allTables(franchise) {
  const found = new Map();
  function add(table, index) {
    if (!table) return;
    const key = `${index}:${table.header && table.header.tableId}:${table.header && table.header.uniqueId}`;
    if (!found.has(key)) found.set(key, { index, table });
  }
  if (Array.isArray(franchise.tables)) franchise.tables.forEach((table, index) => add(table, index));
  else if (franchise.tables && typeof franchise.tables === 'object') {
    for (const [key, item] of Object.entries(franchise.tables)) {
      if (Array.isArray(item)) item.forEach((table, offset) => add(table, Number(key) || offset));
      else add(item, Number(key));
    }
  }
  let misses = 0;
  for (let index = 0; index < 10000 && misses < 50; index += 1) {
    try {
      const table = franchise.getTableByIndex(index);
      if (table) { add(table, index); misses = 0; } else misses += 1;
    } catch { misses += 1; }
  }
  return [...found.values()].sort((a, b) => a.index - b.index);
}

async function findTransactionReferenceConsumers(state) {
  const transactionRefs = new Set(state.tables.coachTransactions.records
    .filter((record) => record)
    .map((record) => state.tables.coachTransactions.getBinaryReferenceToRecord(record.index)));
  const matches = [];
  const consumerTables = new Map();
  for (const { index, table } of allTables(state.franchise)) {
    try { await table.readRecords(); } catch { continue; }
    let tableMatched = false;
    for (const record of table.records || []) {
      if (!record || record.isEmpty) continue;
      for (const field of fields(record)) {
        if (transactionRefs.has(record[field])) {
          tableMatched = true;
          matches.push({ tableIndex: index, table: table.name, uniqueId: table.header.uniqueId, row: record.index, field, reference: record[field] });
        }
      }
    }
    if (tableMatched) {
      consumerTables.set(`${index}:${table.header.uniqueId}`, {
        tableIndex: index,
        descriptor: descriptor(table),
        arraySizes: Array.isArray(table.arraySizes) ? [...table.arraySizes] : null,
        activeRecords: (table.records || []).filter((record) => record && !record.isEmpty).map((record) => ({ row: record.index, values: recordValues(record) }))
      });
    }
  }
  return { matches, tables: [...consumerTables.values()] };
}

function openingSummary(state) {
  const { openings, coaches, teams } = state.tables;
  return openings.records.filter((record) => record && !record.isEmpty).map((record) => {
    const selected = getValue(record, ['SelectedCoach'], EMPTY_REF);
    const previous = getValue(record, ['PrevCoach'], EMPTY_REF);
    const team = getValue(record, ['Team'], EMPTY_REF);
    const selectedRow = selected === EMPTY_REF ? null : Number.parseInt(selected.slice(15), 2);
    const previousRow = previous === EMPTY_REF ? null : Number.parseInt(previous.slice(15), 2);
    const teamRow = team === EMPTY_REF ? null : Number.parseInt(team.slice(15), 2);
    return {
      row: record.index,
      teamRow,
      team: teamRow === null ? null : displayName(teams.records[teamRow]),
      position: getValue(record, ['Position']),
      reason: getValue(record, ['Reason']),
      filled: getValue(record, ['Filled']),
      emergent: getValue(record, ['IsEmergentJobOpening']),
      previousCoachRow: previousRow,
      previousCoach: previousRow === null ? null : displayName(coaches.records[previousRow]),
      selectedCoachRow: selectedRow,
      selectedCoach: selectedRow === null ? null : displayName(coaches.records[selectedRow]),
      isRetention: selected === previous,
      values: recordValues(record)
    };
  });
}

function transactionSummary(state) {
  const { coachTransactions, coaches, teams } = state.tables;
  const teamNames = new Map(teams.records.filter((record) => record && !record.isEmpty)
    .map((record) => [teams.getBinaryReferenceToRecord(record.index), displayName(record)]));
  const coachNames = new Map(coaches.records.filter((record) => record && !record.isEmpty)
    .map((record) => [coachReference(coaches, record.index), displayName(record)]));
  return coachTransactions.records.filter((record) => record && !record.isEmpty).map((record) => ({
    row: record.index,
    coach: coachNames.get(getValue(record, ['Coach'])) || null,
    coachReference: getValue(record, ['Coach']),
    oldTeam: teamNames.get(getValue(record, ['OldTeam'])) || null,
    oldTeamReference: getValue(record, ['OldTeam']),
    newTeam: teamNames.get(getValue(record, ['NewTeam'])) || null,
    newTeamReference: getValue(record, ['NewTeam']),
    values: recordValues(record)
  }));
}

function coachSnapshots(states) {
  return Object.fromEntries(Object.entries(states).map(([stage, state]) => [stage, TARGET_COACH_ROWS.map((row) => {
    const record = state.tables.coaches.records[row];
    return { row, name: displayName(record), values: recordValues(record) };
  })]));
}

async function main() {
  const source = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'));
  const output = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(fs.existsSync(source), `Missing source: ${source}`);
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  assert(sha256(source) === SOURCE_HASH, 'Unexpected BW3 source hash.');
  const bw3 = await loadExperimentState(source, schema);
  const fixtureDirectory = path.dirname(source);
  const comparative = {};
  for (const stage of ['W15', 'BW1', 'BW2', 'EOS']) {
    const fixture = path.join(fixtureDirectory, `DYNASTY-CCRY1${stage}`);
    if (fs.existsSync(fixture)) comparative[stage] = await loadExperimentState(fixture, schema);
  }

  const openings = openingSummary(bw3);
  const transactions = transactionSummary(bw3);
  const transactionIds = transactions.map((item) => item.values.TransactionId).filter((item) => item !== null && item !== undefined);
  const duplicateIds = [...new Set(transactionIds.filter((item, index) => transactionIds.indexOf(item) !== index))];
  const coachGroups = new Map();
  for (const transaction of transactions) {
    if (!coachGroups.has(transaction.coachReference)) coachGroups.set(transaction.coachReference, []);
    coachGroups.get(transaction.coachReference).push(transaction.row);
  }
  const transactionConsumers = await findTransactionReferenceConsumers(bw3);
  const report = {
    generatedAt: new Date().toISOString(),
    source,
    sourceSha256: sha256(source),
    schema: bw3.declaredSchema,
    tables: Object.fromEntries(Object.entries(bw3.tables).map(([name, table]) => [name, descriptor(table)])),
    openings: {
      activeCount: openings.length,
      retentionCount: openings.filter((item) => item.isRetention).length,
      movementCount: openings.filter((item) => !item.isRetention).length,
      byReason: Object.fromEntries([...new Set(openings.map((item) => item.reason))].sort().map((reason) => [reason, openings.filter((item) => item.reason === reason).length])),
      auburnDc: openings.find((item) => item.row === 22),
      representativeRetention: openings.find((item) => item.position === 'DefensiveCoordinator' && item.isRetention),
      representativeFiring: openings.find((item) => item.position === 'DefensiveCoordinator' && item.reason === 'Fired' && !item.isRetention)
    },
    transactions: {
      activeCount: transactions.length,
      duplicateTransactionIds: duplicateIds,
      coachesWithMultipleRows: [...coachGroups.entries()].filter(([, rows]) => rows.length > 1).map(([coach, rows]) => ({ coach, rows })),
      auburnRows: transactions.filter((item) => [22, 62].includes(item.row)),
      values: transactions
    },
    transactionReferenceConsumers: transactionConsumers.matches,
    transactionConsumerTables: transactionConsumers.tables,
    targetCoachSnapshots: coachSnapshots({ ...comparative, BW3: bw3 })
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, json);
  } else process.stdout.write(json);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
