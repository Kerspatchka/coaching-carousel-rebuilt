/* Inspect native emergent opening templates and their selected-coach transactions. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, displayName, getValue, loadExperimentState
} = require('./prepare-bw3-selected-coach-swap');

function refRow(reference) {
  return typeof reference === 'string' && reference.length === 32 && reference !== EMPTY_REF ? Number.parseInt(reference.slice(-12), 2) : null;
}
async function main() {
  const source = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'ref_saves', 'DYNASTY-CCRY1BW3'));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(fs.existsSync(source) && schema && fs.existsSync(schema), 'Missing source or CCR_SCHEMA_PATH.');
  const state = await loadExperimentState(source, schema);
  const { openings, offerArrays, offers, coachTransactions, teams, coaches } = state.tables;
  const output = [];
  for (const opening of openings.records.filter((record) => record && !record.isEmpty && (getValue(record, ['IsEmergentJobOpening']) || getValue(record, ['Reason']) === 'NewJob'))) {
    const selected = getValue(opening, ['SelectedCoach']);
    const previous = getValue(opening, ['PrevCoach']);
    const team = getValue(opening, ['Team']);
    const offerArrayRow = refRow(getValue(opening, ['ContractOfferList']));
    const offerArray = offerArrayRow === null ? null : offerArrays.records[offerArrayRow];
    const offerRefs = offerArray && !offerArray.isEmpty ? (offerArray.fieldsArray || []).map((field) => field.key).filter((key) => /^StaffPersonContractOffer\d+$/.test(key)).map((key) => offerArray[key]).filter((reference) => reference !== EMPTY_REF) : [];
    output.push({
      openingRow: opening.index,
      values: Object.fromEntries(opening.fieldsArray.map((field) => [field.key, opening[field.key]])),
      teamRow: refRow(team), team: refRow(team) === null ? null : displayName(teams.records[refRow(team)]),
      previousCoachRow: refRow(previous), previousCoach: refRow(previous) === null ? null : displayName(coaches.records[refRow(previous)]),
      selectedCoachRow: refRow(selected), selectedCoach: refRow(selected) === null ? null : displayName(coaches.records[refRow(selected)]),
      offerArrayRow, offerArrayActive: Boolean(offerArray && !offerArray.isEmpty), offerArraySize: offerArrayRow === null ? null : offerArrays.arraySizes[offerArrayRow],
      offerRows: offerRefs.map(refRow),
      matchingTransactions: coachTransactions.records.filter((record) => record && !record.isEmpty && getValue(record, ['Coach']) === selected).map((record) => ({
        row: record.index, oldTeam: getValue(record, ['OldTeam']), newTeam: getValue(record, ['NewTeam']),
        oldPosition: getValue(record, ['OldCoachPosition']), newPosition: getValue(record, ['NewCoachPosition']),
        transactionId: getValue(record, ['TransactionId']), contractLength: getValue(record, ['ContractLength']),
        contractStatus: getValue(record, ['ContractStatus']), seasonWeek: getValue(record, ['SeasonWeek'])
      }))
    });
  }
  process.stdout.write(`${JSON.stringify({ activeOfferCount: offers.records.filter((record) => record && !record.isEmpty).length, templates: output }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
