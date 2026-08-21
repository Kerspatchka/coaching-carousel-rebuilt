/* Compare late-season game records across saves derived from the same BW3 fixture. */
'use strict';

const fs = require('fs');
const path = require('path');
const { FranchiseFile } = require('madden-franchise');

const SEASON_GAME_TABLE = 4049338978;

function assert(condition, message) { if (!condition) throw new Error(message); }
function fields(record) { return record && Array.isArray(record.fieldsArray) ? record.fieldsArray.map((field) => field.key) : []; }
function createFranchise(savePath, schemaPath) {
  return new Promise((resolve, reject) => {
    let franchise;
    try {
      franchise = new FranchiseFile(savePath, { autoParse: false, gameTypeOverride: 'college', gameYearOverride: 27 });
      const declared = franchise.expectedSchemaVersion;
      franchise.settings.schemaOverride = { major: declared.major, minor: declared.minor, gameYear: declared.gameYear, path: schemaPath };
    } catch (error) { reject(error); return; }
    franchise.on('ready', () => resolve(franchise));
    franchise.on('error', reject);
    franchise.parse();
  });
}
function selectedValues(record) {
  const pattern = /(week|season|game|team|score|status|playoff|champ|bowl|winner|home|away)/i;
  return Object.fromEntries(fields(record).filter((field) => pattern.test(field)).map((field) => [field, record[field]]));
}
function isChampionshipGame(values) {
  const weekType = String(values.SeasonWeekType ?? values.WeekType ?? '');
  const week = Number(values.SeasonWeek ?? values.Week ?? -1);
  return /nationalchampionship/i.test(weekType) || week === 20;
}
async function summarize(savePath, schemaPath) {
  const franchise = await createFranchise(savePath, schemaPath);
  const table = franchise.getTableByUniqueId(SEASON_GAME_TABLE);
  assert(table, 'SeasonGame table is missing.');
  await table.readRecords();
  const active = table.records.filter((record) => record && !record.isEmpty);
  const candidates = active
    .map((record) => ({ row: record.index, values: selectedValues(record) }))
    .filter(({ values }) => isChampionshipGame(values));
  return { save: savePath, activeGames: active.length, fields: active[0] ? fields(active[0]) : [], candidates };
}
async function main() {
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const saves = process.argv.slice(2).map((item) => path.resolve(item));
  assert(saves.length > 0 && saves.every((item) => fs.existsSync(item)), 'Provide one or more save files.');
  const output = [];
  for (const save of saves) output.push(await summarize(save, schema));
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
