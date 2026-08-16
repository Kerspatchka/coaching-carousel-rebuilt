/* Find every parsed record that directly references selected Coach rows. */
'use strict';

const fs = require('fs');
const path = require('path');
const { FranchiseFile } = require('madden-franchise');

const COACH_TABLE_UNIQUE_ID = 1860529246;
const TARGET_ROWS = String(process.env.CCR_COACH_ROWS || '470,495')
  .split(',')
  .map((item) => Number.parseInt(item.trim(), 10))
  .filter(Number.isInteger);

function createFranchise(savePath, schemaPath) {
  return new Promise((resolve, reject) => {
    let franchise;
    try {
      franchise = new FranchiseFile(savePath, { autoParse: false, gameTypeOverride: 'college', gameYearOverride: 27 });
      const declared = franchise.expectedSchemaVersion;
      franchise.settings.schemaOverride = { major: declared.major, minor: declared.minor, gameYear: declared.gameYear, path: schemaPath };
    } catch (error) {
      reject(error);
      return;
    }
    franchise.on('ready', () => resolve(franchise));
    franchise.on('error', reject);
    franchise.parse();
  });
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

function recordValues(record) {
  const keys = record && Array.isArray(record.fieldsArray) ? record.fieldsArray.map((field) => field.key) : [];
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}

async function trace(savePath, schemaPath) {
  const franchise = await createFranchise(savePath, schemaPath);
  const coachTable = franchise.getTableByUniqueId(COACH_TABLE_UNIQUE_ID);
  if (!coachTable) throw new Error('Coach table is missing.');
  const targetReferences = Object.fromEntries(TARGET_ROWS.map((row) => [row, coachTable.getBinaryReferenceToRecord(row)]));
  const references = new Set(Object.values(targetReferences));
  const matches = [];
  const tables = allTables(franchise);
  for (const { index, table } of tables) {
    try { await table.readRecords(); } catch { continue; }
    for (const record of table.records || []) {
      if (!record || record.isEmpty) continue;
      const values = recordValues(record);
      const matchedFields = Object.entries(values).filter(([, value]) => references.has(value)).map(([key, value]) => ({ key, value }));
      if (!matchedFields.length) continue;
      matches.push({
        tableIndex: index,
        tableName: table.name,
        tableId: table.header && table.header.tableId,
        uniqueId: table.header && table.header.uniqueId,
        row: record.index,
        matchedFields,
        values: table.name === 'CoachTransactionHistoryEntry'
          ? values
          : Object.fromEntries(matchedFields.map((field) => [field.key, field.value]))
      });
    }
  }
  return { savePath, targetReferences, matches };
}

async function main() {
  const savePaths = process.argv.slice(2).map((item) => path.resolve(item));
  if (!savePaths.length || savePaths.some((item) => !fs.existsSync(item))) throw new Error('Pass one or more existing save paths.');
  const schemaPath = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  if (!schemaPath || !fs.existsSync(schemaPath)) throw new Error('Set CCR_SCHEMA_PATH.');
  const reports = [];
  for (const savePath of savePaths) reports.push(await trace(savePath, schemaPath));
  process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
