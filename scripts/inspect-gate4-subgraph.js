/* Read-only inventory of the Auburn/Florida/Coastal Carolina Gate 4 subgraph. */
'use strict';

const fs = require('fs');
const path = require('path');
const { EMPTY_REF, assert, displayName, getValue, loadExperimentState } = require('./prepare-bw3-selected-coach-swap');

const TEAM_ROWS = [9, 22, 36];

function rowFromReference(reference) {
  if (typeof reference !== 'string' || reference === EMPTY_REF) return null;
  return Number.parseInt(reference.slice(15), 2);
}

function coach(state, row) {
  if (row === null) return null;
  const record = state.tables.coaches.records[row];
  return {
    row, name: displayName(record), teamIndex: getValue(record, ['TeamIndex']),
    prevTeamIndex: getValue(record, ['PrevTeamIndex']), position: getValue(record, ['Position']),
    contractStatus: getValue(record, ['ContractStatus']), contractLength: getValue(record, ['ContractLength']),
    contractYearsRemaining: getValue(record, ['ContractYearsRemaining'])
  };
}

async function main() {
  const save = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(fs.existsSync(save), 'Save does not exist.');
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  const state = await loadExperimentState(save, schema);
  const { teams, coaches, openings, coachTransactions, transactionArrays } = state.tables;
  const teamRefs = new Map(TEAM_ROWS.map((row) => [teams.getBinaryReferenceToRecord(row), row]));
  const coachRows = new Set();
  const teamState = TEAM_ROWS.map((row) => {
    const record = teams.records[row];
    const staff = {};
    for (const role of ['HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator']) {
      const coachRow = rowFromReference(getValue(record, [role]));
      coachRows.add(coachRow);
      staff[role] = coach(state, coachRow);
    }
    return { row, name: displayName(record), teamIndex: getValue(record, ['TeamIndex']), staff };
  });
  const openingState = openings.records.filter((record) => record && !record.isEmpty && teamRefs.has(getValue(record, ['Team']))).map((record) => {
    const selectedRow = rowFromReference(getValue(record, ['SelectedCoach']));
    const previousRow = rowFromReference(getValue(record, ['PrevCoach']));
    coachRows.add(selectedRow); coachRows.add(previousRow);
    return {
      row: record.index, teamRow: teamRefs.get(getValue(record, ['Team'])), position: getValue(record, ['Position']),
      selected: coach(state, selectedRow), previous: coach(state, previousRow), reason: getValue(record, ['Reason']),
      emergent: getValue(record, ['IsEmergentJobOpening']), filled: getValue(record, ['Filled']),
      offerArrayRow: rowFromReference(getValue(record, ['ContractOfferList'])),
      finalPoints: getValue(record, ['FinalContractProgramPoints']), highestPoints: getValue(record, ['HighestOfferedProgramPoints'])
    };
  });
  const indexedSize = transactionArrays.arraySizes[0];
  const fields = (transactionArrays.records[0].fieldsArray || []).map((field) => field.key).filter((key) => /^TransactionHistoryEntry\d+$/.test(key))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
  const indexed = new Set(fields.slice(0, indexedSize).map((field) => transactionArrays.records[0][field]));
  const transactionState = coachTransactions.records.filter((record) => record && !record.isEmpty).filter((record) => {
    const coachRow = rowFromReference(getValue(record, ['Coach']));
    return coachRows.has(coachRow) || teamRefs.has(getValue(record, ['OldTeam'])) || teamRefs.has(getValue(record, ['NewTeam']));
  }).map((record) => ({
    row: record.index, indexed: indexed.has(coachTransactions.getBinaryReferenceToRecord(record.index)),
    coach: coach(state, rowFromReference(getValue(record, ['Coach']))),
    oldTeamRow: teamRefs.has(getValue(record, ['OldTeam'])) ? teamRefs.get(getValue(record, ['OldTeam'])) : rowFromReference(getValue(record, ['OldTeam'])),
    newTeamRow: teamRefs.has(getValue(record, ['NewTeam'])) ? teamRefs.get(getValue(record, ['NewTeam'])) : rowFromReference(getValue(record, ['NewTeam'])),
    oldPosition: getValue(record, ['OldCoachPosition']), newPosition: getValue(record, ['NewCoachPosition']),
    transactionId: getValue(record, ['TransactionId']), status: getValue(record, ['ContractStatus']), week: getValue(record, ['SeasonWeek'])
  }));
  process.stdout.write(`${JSON.stringify({ teamState, openingState, transactionState, indexedSize }, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
