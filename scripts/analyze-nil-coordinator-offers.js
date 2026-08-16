/* Read-only forensic analysis of NIL-related fields and coordinator offers. */
'use strict';

const fs = require('fs');
const path = require('path');
const { FranchiseFile } = require('madden-franchise');

const EMPTY_REF = '00000000000000000000000000000000';
const STAGES = ['PRE', 'W15', 'CONFCHAMP', 'BW1', 'BW2', 'BW3', 'EOS', 'LEAVING'];
const TABLES = {
  offers: 674348040,
  offerArrays: 4119397260,
  openings: 263453863,
  coaches: 1860529246,
  teams: 3359508968,
  transactions: 2701814500,
  leagueSettings: 87558994,
  userTeamLists: 2009592636,
  staffHiringEval: 1794614061,
  financesFlow: 2349502377
};

function fields(record) {
  return record && Array.isArray(record.fieldsArray) ? record.fieldsArray.map((field) => field.key) : [];
}
function value(record, aliases, fallback = null) {
  const names = fields(record);
  const lower = new Map(names.map((name) => [name.toLowerCase(), name]));
  const key = aliases.find((name) => names.includes(name)) || aliases.map((name) => lower.get(name.toLowerCase())).find(Boolean);
  if (!key) return fallback;
  const result = record[key];
  return result === undefined || result === null ? fallback : result;
}
function displayName(record) {
  const direct = value(record, ['DisplayName', 'LongName', 'Name'], '');
  return String(direct).trim() || [value(record, ['FirstName'], ''), value(record, ['LastName'], '')].join(' ').trim();
}
function meaningful(record) { return record && !record.isEmpty; }
function refRow(reference) {
  if (typeof reference !== 'string' || !/^[01]{32}$/.test(reference) || reference === EMPTY_REF) return null;
  return Number.parseInt(reference.slice(15), 2);
}
function refTableId(reference) {
  if (typeof reference !== 'string' || !/^[01]{32}$/.test(reference) || reference === EMPTY_REF) return null;
  return Number.parseInt(reference.slice(0, 15), 2);
}
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
function allTables(franchise) {
  const found = new Map();
  function add(table, index) {
    if (!table) return;
    const key = `${index}:${table.header && table.header.uniqueId}`;
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
async function load(savePath, schemaPath, scanCatalog = false) {
  const franchise = await createFranchise(savePath, schemaPath);
  const tables = Object.fromEntries(Object.entries(TABLES).map(([name, id]) => [name, franchise.getTableByUniqueId(id)]));
  await Promise.all(Object.values(tables).map((table) => table.readRecords()));
  let catalog = [];
  if (scanCatalog) {
    const pattern = /nil|offer|coordinator|staff|usercontrol|interested|programpoints|contractpoints/i;
    for (const { index, table } of allTables(franchise)) {
      try { await table.readRecords(); } catch { continue; }
      const representative = table.records.find((record) => record);
      const matchingFields = fields(representative).filter((field) => pattern.test(field));
      if (pattern.test(table.name) || matchingFields.length) {
        catalog.push({
          tableIndex: index,
          name: table.name,
          tableId: table.header.tableId,
          uniqueId: table.header.uniqueId,
          capacity: table.header.recordCapacity,
          active: table.records.filter(meaningful).length,
          matchingFields
        });
      }
    }
  }
  return { franchise, tables, catalog };
}
function teamMaps(tables) {
  const byRef = new Map();
  for (const team of tables.teams.records.filter(meaningful)) {
    byRef.set(tables.teams.getBinaryReferenceToRecord(team.index), { row: team.index, name: displayName(team), teamIndex: value(team, ['TeamIndex']) });
  }
  return byRef;
}
function coachMaps(tables) {
  const byRef = new Map();
  for (const coach of tables.coaches.records.filter(meaningful)) {
    byRef.set(tables.coaches.getBinaryReferenceToRecord(coach.index), { row: coach.index, name: displayName(coach) });
  }
  return byRef;
}
function summarizeCoach(record) {
  const selectedFields = fields(record).filter((field) => /nil|offer|user|position|teamindex|contractstatus|created|legend/i.test(field));
  return {
    row: record.index,
    name: displayName(record),
    values: Object.fromEntries(selectedFields.map((field) => [field, record[field]]))
  };
}
function summarizeStage(stage, state) {
  const { offers, offerArrays, openings, coaches, teams, transactions, leagueSettings, staffHiringEval, financesFlow } = state.tables;
  const teamByRef = teamMaps(state.tables);
  const coachByRef = coachMaps(state.tables);
  const realOffers = offers.records.filter((record) => meaningful(record) && value(record, ['ContractPosition']) !== 'Invalid_');
  const offerDetails = realOffers.map((record) => {
    const coachRef = value(record, ['StaffPerson', 'Coach']);
    const teamRef = value(record, ['Team']);
    const currentTeamRef = value(record, ['StaffPersonTeam', 'CurrentTeam']);
    const coachRow = refRow(coachRef);
    const coachRecord = coachRow === null ? null : coaches.records[coachRow];
    return {
      row: record.index,
      coach: coachByRef.get(coachRef) || { reference: coachRef },
      hiringTeam: teamByRef.get(teamRef) || { reference: teamRef },
      currentTeam: teamByRef.get(currentTeamRef) || (currentTeamRef === EMPTY_REF ? null : { reference: currentTeamRef }),
      candidateCurrentPosition: coachRecord ? value(coachRecord, ['Position']) : null,
      candidateContractStatus: coachRecord ? value(coachRecord, ['ContractStatus']) : null,
      candidateNumContractOffers: coachRecord ? value(coachRecord, ['NumContractOffers']) : null,
      candidateIsNIL: coachRecord ? value(coachRecord, ['IsNIL']) : null,
      candidateIsUserControlled: coachRecord ? value(coachRecord, ['IsUserControlled']) : null,
      position: value(record, ['ContractPosition']),
      status: value(record, ['Status', 'ContractStatus']),
      offerIndex: value(record, ['OfferIndex']),
      teamInterest: value(record, ['TeamInterestInStaffPerson', 'TeamInterest']),
      coachInterest: value(record, ['BaseStaffPersonInterestInOffer', 'CoachInterest']),
      adjustedCoachInterest: value(record, ['AdjustedStaffPersonInterestInOffer', 'AdjustedCoachInterest']),
      expectedContractProgramPoints: value(record, ['ExpectedContractProgramPoints']),
      offeredContractProgramPoints: value(record, ['OfferedContractProgramPoints']),
      fields: Object.fromEntries(fields(record).map((field) => [field, record[field]]))
    };
  });
  const openingDetails = openings.records.filter(meaningful).map((record) => {
    const teamRef = value(record, ['Team']);
    const selectedRef = value(record, ['SelectedCoach']);
    const previousRef = value(record, ['PrevCoach']);
    const selectedRow = refRow(selectedRef);
    const selectedRecord = selectedRow === null ? null : coaches.records[selectedRow];
    const previousRow = refRow(previousRef);
    const previousRecord = previousRow === null ? null : coaches.records[previousRow];
    return {
      row: record.index,
      team: teamByRef.get(teamRef) || { reference: teamRef },
      position: value(record, ['Position']),
      reason: value(record, ['Reason']),
      filled: value(record, ['Filled']),
      emergent: value(record, ['IsEmergentJobOpening']),
      selectedCoach: coachByRef.get(selectedRef) || (selectedRef === EMPTY_REF ? null : { reference: selectedRef }),
      previousCoach: coachByRef.get(previousRef) || (previousRef === EMPTY_REF ? null : { reference: previousRef }),
      selectedCoachIsNIL: selectedRecord ? value(selectedRecord, ['IsNIL']) : null,
      selectedCoachCurrentPosition: selectedRecord ? value(selectedRecord, ['Position']) : null,
      previousCoachIsNIL: previousRecord ? value(previousRecord, ['IsNIL']) : null,
      isRetention: selectedRef !== EMPTY_REF && selectedRef === previousRef,
      interestedUserTeamsList: value(record, ['InterestedUserTeamsList']),
      contractOfferList: value(record, ['ContractOfferList']),
      highestOfferedProgramPoints: value(record, ['HighestOfferedProgramPoints']),
      finalContractProgramPoints: value(record, ['FinalContractProgramPoints'])
    };
  });
  const userControlledRecords = coaches.records.filter((record) => meaningful(record) && value(record, ['IsUserControlled']) === true);
  const userControlled = userControlledRecords.map(summarizeCoach);
  const nilFields = fields(coaches.records.find(meaningful)).filter((field) => /nil/i.test(field));
  const nilDistribution = Object.fromEntries(nilFields.map((field) => {
    const counts = new Map();
    for (const coach of coaches.records.filter(meaningful)) counts.set(JSON.stringify(coach[field]), (counts.get(JSON.stringify(coach[field])) || 0) + 1);
    return [field, Object.fromEntries(counts)];
  }));
  const nilBreakdown = coaches.records.filter(meaningful).reduce((output, coach) => {
    const key = value(coach, ['IsNIL']) ? 'nil' : 'nonNil';
    const position = String(value(coach, ['Position'], 'Unknown'));
    const status = String(value(coach, ['ContractStatus'], 'Unknown'));
    output[key].total += 1;
    output[key].byPosition[position] = (output[key].byPosition[position] || 0) + 1;
    output[key].byContractStatus[status] = (output[key].byContractStatus[status] || 0) + 1;
    return output;
  }, { nil: { total: 0, byPosition: {}, byContractStatus: {} }, nonNil: { total: 0, byPosition: {}, byContractStatus: {} } });
  const coordinatorOffers = offerDetails.filter((offer) => ['OffensiveCoordinator', 'DefensiveCoordinator'].includes(offer.position));
  const coordinatorOpenings = openingDetails.filter((opening) => ['OffensiveCoordinator', 'DefensiveCoordinator'].includes(opening.position));
  const populatedUserLists = openingDetails.filter((opening) => opening.interestedUserTeamsList && opening.interestedUserTeamsList !== EMPTY_REF);
  const userCoachRefs = new Set(userControlledRecords.map((record) => coaches.getBinaryReferenceToRecord(record.index)));
  const userOffers = offerDetails.filter((offer) => offer.fields && userCoachRefs.has(offer.fields.StaffPerson));
  const userListRecords = populatedUserLists.map((opening) => {
    const reference = opening.interestedUserTeamsList;
    const table = state.franchise.getTableById(refTableId(reference));
    const record = table && table.records[refRow(reference)];
    return {
      openingRow: opening.row,
      openingTeam: opening.team,
      openingPosition: opening.position,
      reference,
      table: table ? { name: table.name, tableId: table.header.tableId, uniqueId: table.header.uniqueId } : null,
      row: record ? record.index : null,
      arraySize: record ? record.arraySize : null,
      values: record ? Object.fromEntries(fields(record).map((field) => [field, record[field]])) : null
    };
  });
  const transactionDetails = transactions.records.filter(meaningful).map((record) => ({
    row: record.index,
    coach: coachByRef.get(value(record, ['Coach'])) || null,
    oldTeam: teamByRef.get(value(record, ['OldTeam'])) || null,
    newTeam: teamByRef.get(value(record, ['NewTeam'])) || null,
    oldPosition: value(record, ['OldCoachPosition']),
    newPosition: value(record, ['NewCoachPosition']),
    status: value(record, ['ContractStatus']),
    week: value(record, ['SeasonWeek'])
  }));
  const teamProgramPoints = teams.records.filter(meaningful).map((record) => ({
    row: record.index,
    name: displayName(record),
    teamIndex: value(record, ['TeamIndex']),
    remainingProgramPoints: value(record, ['RemainingProgramPoints']),
    staffProgramPointsSpent: value(record, ['StaffProgramPointsSpent']),
    nilProgramPointsSpent: value(record, ['NILProgramPointsSpent']),
    coachContractGoalsProgramPoints: value(record, ['CoachContractGoalsProgramPoints']),
    expectedContractPointsThisYear: value(record, ['ExpectedContractPoints_ThisYear']),
    expectedContractPointsLastYear: value(record, ['ExpectedContractPoints_LastYear']),
    expectedContractPointsTwoYearsAgo: value(record, ['ExpectedContractPoints_TwoYearsAgo']),
    staffPoints: value(record, ['StaffPoints']),
    headCoachPointBudget: value(record, ['HeadCoachProgramPointBudget', 'HeadCoachPointBudget']),
    offensiveCoordinatorPointBudget: value(record, ['OffensiveCoordinatorPointBudget']),
    defensiveCoordinatorPointBudget: value(record, ['DefensiveCoordinatorPointBudget']),
    headCoachRow: refRow(value(record, ['HeadCoach'])),
    offensiveCoordinatorRow: refRow(value(record, ['OffensiveCoordinator'])),
    defensiveCoordinatorRow: refRow(value(record, ['DefensiveCoordinator']))
  }));
  const coachContracts = coaches.records.filter(meaningful).map((record) => ({
    row: record.index,
    name: displayName(record),
    position: value(record, ['Position']),
    teamIndex: value(record, ['TeamIndex']),
    level: value(record, ['Level']),
    legacyScore: value(record, ['LegacyScore']),
    contractSalary: value(record, ['ContractSalary']),
    contractLength: value(record, ['ContractLength']),
    contractYearsRemaining: value(record, ['ContractYearsRemaining']),
    contractStatus: value(record, ['ContractStatus'])
  }));
  return {
    stage,
    counts: {
      realOffers: realOffers.length,
      offerArraysActive: offerArrays.records.filter(meaningful).length,
      openings: openingDetails.length,
      coordinatorOffers: coordinatorOffers.length,
      coordinatorOpenings: coordinatorOpenings.length,
      populatedInterestedUserTeamsLists: populatedUserLists.length,
      userControlledCoaches: userControlled.length,
      transactions: transactionDetails.length
    },
    coachNilFields: nilFields,
    coachContractFields: fields(coaches.records.find(meaningful)).filter((field) => /contract|salary|programpoint|staffpoint/i.test(field)),
    coachNilDistribution: nilDistribution,
    coachNilBreakdown: nilBreakdown,
    coachNilSamples: {
      nil: coaches.records.filter((record) => meaningful(record) && value(record, ['IsNIL']) === true).slice(0, 12).map(summarizeCoach),
      nonNilActive: coaches.records.filter((record) => meaningful(record) && value(record, ['IsNIL']) === false && String(value(record, ['ContractStatus'])).includes('Active')).slice(0, 20).map(summarizeCoach),
      nonNilFreeAgent: coaches.records.filter((record) => meaningful(record) && value(record, ['IsNIL']) === false && value(record, ['ContractStatus']) === 'FreeAgent').slice(0, 20).map(summarizeCoach)
    },
    userControlledCoaches: userControlled,
    userOffers,
    allOffers: offerDetails,
    coordinatorOffers,
    coordinatorOpenings,
    allOpenings: openingDetails,
    populatedInterestedUserTeamsLists: populatedUserLists,
    interestedUserTeamListRecords: userListRecords,
    teamProgramPoints,
    coachContracts,
    staffHiringEval: staffHiringEval.records.filter(meaningful).map((record) => ({
      row: record.index,
      values: Object.fromEntries(fields(record).filter((field) => /offer|programPoints|staffHiring/i.test(field)).map((field) => [field, record[field]]))
    })),
    financesFlow: financesFlow.records.filter(meaningful).map((record) => ({
      row: record.index,
      values: Object.fromEntries(fields(record).filter((field) => /programPoints|budget|staffHiring|finance/i.test(field)).map((field) => [field, record[field]]))
    })),
    leagueSettings: leagueSettings.records.filter(meaningful).map((record) => ({ row: record.index, values: Object.fromEntries(fields(record).filter((field) => /coordinator|offer|carousel|staff/i.test(field)).map((field) => [field, record[field]])) })),
    transactions: transactionDetails
  };
}
function changedCoachFields(before, after) {
  const result = [];
  const beforeByRow = new Map(before.tables.coaches.records.filter(meaningful).map((record) => [record.index, record]));
  for (const next of after.tables.coaches.records.filter(meaningful)) {
    const prior = beforeByRow.get(next.index);
    if (!prior) continue;
    const changes = fields(next).filter((field) => JSON.stringify(prior[field]) !== JSON.stringify(next[field]));
    const relevant = changes.filter((field) => /nil|offer|user|position|teamindex|contractstatus/i.test(field));
    if (relevant.length) result.push({ row: next.index, name: displayName(next), fields: Object.fromEntries(relevant.map((field) => [field, { before: prior[field], after: next[field] }])) });
  }
  return result;
}
async function main() {
  const directory = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'ref_saves'));
  const output = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  if (!schema || !fs.existsSync(schema)) throw new Error('Set CCR_SCHEMA_PATH.');
  const states = [];
  for (const stage of STAGES) {
    const savePath = path.join(directory, `DYNASTY-CCRY1${stage}`);
    if (!fs.existsSync(savePath)) continue;
    process.stderr.write(`Reading ${stage}...\n`);
    states.push({ stage, state: await load(savePath, schema, stage === STAGES[0]) });
  }
  const stages = states.map(({ stage, state }) => summarizeStage(stage, state));
  const coachTransitions = [];
  for (let index = 1; index < states.length; index += 1) {
    coachTransitions.push({ from: states[index - 1].stage, to: states[index].stage, changes: changedCoachFields(states[index - 1].state, states[index].state) });
  }
  const report = { generatedAt: new Date().toISOString(), directory, schemaCatalog: states[0] ? states[0].state.catalog : [], stages, coachTransitions };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output) fs.writeFileSync(output, json); else process.stdout.write(json);
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
