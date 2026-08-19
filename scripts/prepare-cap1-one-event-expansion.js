/* CAP-1: add one coherent cascade event at each save's immediate allocator boundary. */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  EMPTY_REF, assert, coachReference, collectDifferences, displayName, focusedSnapshot,
  getValue, loadExperimentState, saveToTemporary, sha256
} = require('./prepare-bw3-selected-coach-swap');

const ROLES = ['HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator'];
const FIXTURES = [
  { id: 'TEST1', file: 'DYNASTY-TEST1NATCHAMP', hash: 'FB090BE76CCE6D51E24CEC3FCB66F3AABF66B124FAADE8CD03565CFACE50E4A2', output: 'DYNASTY-CCRCAP1T1' },
  { id: 'TEST2', file: 'DYNASTY-TEST2NATCHAMP', hash: '2D0C17DA5F1240BE4C28342846AC2A84BF99955046D0CFD0E18F8F4F1D755636', output: 'DYNASTY-CCRCAP1T2' },
  { id: 'TEST3', file: 'DYNASTY-TEST3NATCHAMP', hash: '05C21801FD502657BC691597C8E4C3833B677D0EF21757A98FA131B4391E4365', output: 'DYNASTY-CCRCAP1T3' }
];

function parseArgs(argv) {
  const options = {
    write: false,
    sourceDirectory: path.join(__dirname, '..', 'assets', 'ref_saves', 'capacity-policy', 'cap0-sources'),
    outputDirectory: path.join(__dirname, '..', 'assets', 'experiments', 'capacity-policy', 'cap1-one-event-expansion')
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--write') options.write = true;
    else if (argv[index] === '--source-dir') options.sourceDirectory = argv[++index];
    else if (argv[index] === '--output-dir') options.outputDirectory = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  options.sourceDirectory = path.resolve(options.sourceDirectory);
  options.outputDirectory = path.resolve(options.outputDirectory);
  return options;
}

function refRow(reference) {
  if (!reference || reference === EMPTY_REF) return null;
  return Number.parseInt(reference.slice(15), 2);
}

function teamReference(teams, row) {
  return teams.getBinaryReferenceToRecord(row);
}

function transactionSlots(record) {
  return (record.fieldsArray || []).map((field) => field.key)
    .filter((field) => /^TransactionHistoryEntry\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function offerSlots(record) {
  return (record.fieldsArray || []).map((field) => field.key)
    .filter((field) => /^StaffPersonContractOffer\d+$/.test(field))
    .sort((a, b) => Number.parseInt(a.match(/\d+$/)[0], 10) - Number.parseInt(b.match(/\d+$/)[0], 10));
}

function activeRecords(table) {
  return table.records.filter((record) => record && !record.isEmpty);
}

function teamAssignments(state) {
  const { teams } = state.tables;
  const assignments = [];
  for (const team of activeRecords(teams)) {
    for (const role of ROLES) {
      const coachRow = refRow(getValue(team, [role], EMPTY_REF));
      if (coachRow !== null) assignments.push({ teamRow: team.index, role, coachRow });
    }
  }
  return assignments;
}

function discoverCascade(state) {
  const { openings, coaches, teams, coachTransactions, transactionArrays } = state.tables;
  const selectedRows = new Set(activeRecords(openings).map((opening) => refRow(getValue(opening, ['SelectedCoach'], EMPTY_REF))).filter((row) => row !== null));
  const openingKeys = new Set(activeRecords(openings).map((opening) => `${refRow(getValue(opening, ['Team'], EMPTY_REF))}|${getValue(opening, ['Position'])}`));
  const assignments = teamAssignments(state);
  const userTeamRows = new Set(assignments.filter((assignment) => coaches.records[assignment.coachRow].IsUserControlled).map((assignment) => assignment.teamRow));
  const array = transactionArrays.records[0];
  const arraySize = transactionArrays.arraySizes[0];
  const indexedReferences = new Set(transactionSlots(array).slice(0, arraySize).map((field) => array[field]));

  const candidates = [];
  for (const opening of activeRecords(openings).sort((a, b) => a.index - b.index)) {
    const role = getValue(opening, ['Position']);
    if (!ROLES.includes(role)) continue;
    const destinationTeamRow = refRow(getValue(opening, ['Team'], EMPTY_REF));
    const nativeHireRow = refRow(getValue(opening, ['SelectedCoach'], EMPTY_REF));
    if (destinationTeamRow === null || nativeHireRow === null) continue;
    if (userTeamRows.has(destinationTeamRow)) continue;
    const nativeHire = coaches.records[nativeHireRow];
    if (!nativeHire || nativeHire.isEmpty || nativeHire.IsUserControlled || getValue(nativeHire, ['TeamIndex']) !== 255) continue;
    const matchingTransactions = activeRecords(coachTransactions).filter((transaction) =>
      getValue(transaction, ['Coach']) === coachReference(coaches, nativeHireRow) &&
      getValue(transaction, ['OldTeam'], EMPTY_REF) === EMPTY_REF &&
      getValue(transaction, ['NewTeam'], EMPTY_REF) === teamReference(teams, destinationTeamRow) &&
      getValue(transaction, ['NewCoachPosition']) === role &&
      indexedReferences.has(coachTransactions.getBinaryReferenceToRecord(transaction.index)));
    if (matchingTransactions.length !== 1) continue;

    for (const assignment of assignments) {
      if (assignment.role !== role || assignment.teamRow === destinationTeamRow) continue;
      if (userTeamRows.has(assignment.teamRow)) continue;
      if (openingKeys.has(`${assignment.teamRow}|${role}`) || selectedRows.has(assignment.coachRow)) continue;
      const donor = coaches.records[assignment.coachRow];
      if (!donor || donor.isEmpty || donor.IsUserControlled || getValue(donor, ['ContractStatus']) !== 'First_Active') continue;
      candidates.push({
        existingOpeningRow: opening.index,
        existingTransactionRow: matchingTransactions[0].index,
        destinationTeamRow,
        sourceTeamRow: assignment.teamRow,
        role,
        donorCoachRow: assignment.coachRow,
        nativeHireCoachRow: nativeHireRow
      });
    }
  }
  assert(candidates.length > 0, 'No safe free-agent-to-active-coach cascade template was found.');
  candidates.sort((a, b) => a.existingOpeningRow - b.existingOpeningRow || a.sourceTeamRow - b.sourceTeamRow || a.donorCoachRow - b.donorCoachRow);
  return candidates[0];
}

function validateBaseline(state, target) {
  const { openings, offerArrays, coachTransactions, transactionArrays } = state.tables;
  const newOpeningRow = openings.header.nextRecordToUse;
  const newOfferArrayRow = offerArrays.header.nextRecordToUse;
  const newTransactionRow = coachTransactions.header.nextRecordToUse;
  const transactionArraySize = transactionArrays.arraySizes[0];
  assert(newOpeningRow === newOfferArrayRow, 'Opening and offer-array allocators are not aligned.');
  assert(openings.records[newOpeningRow].isEmpty && offerArrays.records[newOfferArrayRow].isEmpty, 'The next opening topology row is not empty.');
  assert(newTransactionRow === transactionArraySize + 1, 'The next transaction row does not preserve positional identity.');
  assert(coachTransactions.records[newTransactionRow].isEmpty, 'The next transaction row is not empty.');
  assert(target.existingOpeningRow < newOpeningRow && target.existingTransactionRow < newTransactionRow, 'Cascade template is outside the native active range.');
  return { newOpeningRow, newOfferArrayRow, newTransactionRow, transactionArraySize };
}

function activateOfferArray(offerArrays, row) {
  const record = offerArrays.records[row];
  for (const field of offerSlots(record)) record[field] = EMPTY_REF;
  record.arraySize = 0;
  offerArrays.arraySizes[row] = 0;
}

function applyTreatment(state, target, allocation) {
  const { openings, offerArrays, coaches, teams, coachTransactions, transactionArrays } = state.tables;
  const donorReference = coachReference(coaches, target.donorCoachRow);
  const nativeHireReference = coachReference(coaches, target.nativeHireCoachRow);
  const sourceTeamReference = teamReference(teams, target.sourceTeamRow);
  const destinationTeamReference = teamReference(teams, target.destinationTeamRow);

  activateOfferArray(offerArrays, allocation.newOfferArrayRow);

  const existingOpening = openings.records[target.existingOpeningRow];
  existingOpening.SelectedCoach = donorReference;

  const newOpening = openings.records[allocation.newOpeningRow];
  newOpening.Team = sourceTeamReference;
  newOpening.SelectedCoach = nativeHireReference;
  newOpening.PrevCoach = donorReference;
  newOpening.InterestedUserTeamsList = EMPTY_REF;
  newOpening.ContractOfferList = offerArrays.getBinaryReferenceToRecord(allocation.newOfferArrayRow);
  newOpening.Filled = true;
  newOpening.IsEmergentJobOpening = true;
  newOpening.Position = target.role;
  newOpening.FinalContractProgramPoints = 0;
  newOpening.HighestOfferedProgramPoints = getValue(existingOpening, ['HighestOfferedProgramPoints'], 0);
  newOpening.Reason = 'NewJob';

  coaches.records[target.donorCoachRow].ContractStatus = 'Last_Pending';

  const existingTransaction = coachTransactions.records[target.existingTransactionRow];
  existingTransaction.Coach = donorReference;
  existingTransaction.OldTeam = sourceTeamReference;
  existingTransaction.NewTeam = destinationTeamReference;
  existingTransaction.OldCoachPosition = target.role;
  existingTransaction.NewCoachPosition = target.role;
  existingTransaction.ContractLength = getValue(coaches.records[target.donorCoachRow], ['ContractYearsRemaining'], 0);
  existingTransaction.ContractStatus = 'Last_Pending';

  const newTransaction = coachTransactions.records[allocation.newTransactionRow];
  newTransaction.Coach = nativeHireReference;
  newTransaction.OldTeam = EMPTY_REF;
  newTransaction.NewTeam = sourceTeamReference;
  newTransaction.OldCoachPosition = target.role;
  newTransaction.TransactionId = allocation.transactionArraySize;
  newTransaction.SeasonStage = 'NFLSeason';
  newTransaction.SeasonYear = 0;
  newTransaction.NewCoachPosition = target.role;
  newTransaction.ContractSalary = 0;
  newTransaction.ContractLength = 0;
  newTransaction.ContractStatus = 'Last_Pending';
  newTransaction.SeasonWeek = 20;

  const array = transactionArrays.records[0];
  const fields = transactionSlots(array);
  assert(array[fields[allocation.transactionArraySize]] === EMPTY_REF, 'The next Staff Moves slot is not empty.');
  array[fields[allocation.transactionArraySize]] = coachTransactions.getBinaryReferenceToRecord(allocation.newTransactionRow);
  array.arraySize = allocation.transactionArraySize + 1;
  transactionArrays.arraySizes[0] = allocation.transactionArraySize + 1;
}

function summarizeTarget(state, target, allocation) {
  const { coaches, teams } = state.tables;
  return {
    role: target.role,
    originalDestination: displayName(teams.records[target.destinationTeamRow]),
    sourceSchool: displayName(teams.records[target.sourceTeamRow]),
    donorCoach: displayName(coaches.records[target.donorCoachRow]),
    nativeFreeAgent: displayName(coaches.records[target.nativeHireCoachRow]),
    existingOpeningRow: target.existingOpeningRow,
    newOpeningRow: allocation.newOpeningRow,
    newOfferArrayRow: allocation.newOfferArrayRow,
    repurposedTransactionRow: target.existingTransactionRow,
    newTransactionRow: allocation.newTransactionRow,
    newTransactionId: allocation.transactionArraySize,
    newStaffMovesSlot: allocation.transactionArraySize
  };
}

function validateTreatment(state, before, target, allocation) {
  const { openings, offerArrays, coaches, teams, coachTransactions, transactionArrays } = state.tables;
  assert(openings.header.nextRecordToUse === allocation.newOpeningRow + 1, 'Opening allocator did not advance exactly one row.');
  assert(offerArrays.header.nextRecordToUse === allocation.newOfferArrayRow + 1, 'Offer-array allocator did not advance exactly one row.');
  assert(coachTransactions.header.nextRecordToUse === allocation.newTransactionRow + 1, 'Transaction allocator did not advance exactly one row.');
  assert(transactionArrays.arraySizes[0] === allocation.transactionArraySize + 1, 'Staff Moves array did not grow exactly one slot.');
  assert(activeRecords(openings).length === allocation.newOpeningRow + 1, 'Opening active range is not contiguous after expansion.');
  assert(activeRecords(offerArrays).length === allocation.newOfferArrayRow + 1, 'Offer-array active range is not contiguous after expansion.');
  const newOpening = openings.records[allocation.newOpeningRow];
  assert(getValue(newOpening, ['Team']) === teamReference(teams, target.sourceTeamRow), 'New opening has the wrong Team.');
  assert(getValue(newOpening, ['SelectedCoach']) === coachReference(coaches, target.nativeHireCoachRow), 'New opening has the wrong selected Coach.');
  assert(getValue(newOpening, ['PrevCoach']) === coachReference(coaches, target.donorCoachRow), 'New opening has the wrong previous Coach.');
  assert(getValue(newOpening, ['ContractOfferList']) === offerArrays.getBinaryReferenceToRecord(allocation.newOfferArrayRow), 'New opening has the wrong offer-array owner.');
  const selections = activeRecords(openings).map((opening) => getValue(opening, ['SelectedCoach']));
  assert(selections.length === new Set(selections).size, 'Selected Coach references are not unique.');
  const array = transactionArrays.records[0];
  const slot = transactionSlots(array)[allocation.transactionArraySize];
  assert(array[slot] === coachTransactions.getBinaryReferenceToRecord(allocation.newTransactionRow), 'New Staff Moves slot does not reference the positional row.');
  assert(getValue(coachTransactions.records[allocation.newTransactionRow], ['TransactionId']) === allocation.transactionArraySize, 'New transaction ID is not positional.');

  const after = focusedSnapshot(state.tables);
  const differences = collectDifferences(before, after);
  const allowedRows = new Set([
    `openings:${target.existingOpeningRow}`, `openings:${allocation.newOpeningRow}`,
    `offerArrays:${allocation.newOfferArrayRow}`, `coaches:${target.donorCoachRow}`,
    `coachTransactions:${target.existingTransactionRow}`, `coachTransactions:${allocation.newTransactionRow}`,
    'transactionArrays:0', 'transactionArrays:undefined'
  ]);
  const unexpected = differences.filter((change) => {
    if (allowedRows.has(`${change.table}:${change.row}`)) return false;
    if (change.table === 'transactionArrays' && change.field === '$arraySizes') return false;
    if (change.row !== undefined && change.field !== '$record' && before[change.table].records[change.row].isEmpty && after[change.table].records[change.row].isEmpty) return false;
    return true;
  });
  assert(unexpected.length === 0, `Unexpected changes: ${unexpected.map((change) => `${change.table}:${change.row}:${change.field}`).join(', ')}`);
  return differences;
}

async function prepareFixture(fixture, options, schema) {
  const source = path.join(options.sourceDirectory, fixture.file);
  const output = path.join(options.outputDirectory, fixture.output);
  assert(fs.existsSync(source) && sha256(source) === fixture.hash, `${fixture.id} source fixture mismatch.`);
  assert(!fs.existsSync(output), `Refusing to overwrite ${output}.`);
  const baseline = await loadExperimentState(source, schema);
  const target = discoverCascade(baseline);
  const allocation = validateBaseline(baseline, target);
  const before = focusedSnapshot(baseline.tables);
  const plan = summarizeTarget(baseline, target, allocation);
  if (!options.write) return { fixture: fixture.id, mode: 'preview', source, output, plan };

  const treatment = await loadExperimentState(source, schema);
  applyTreatment(treatment, target, allocation);
  const temporary = `${output}.tmp`;
  await saveToTemporary(treatment.franchise, temporary);
  const reopened = await loadExperimentState(temporary, schema);
  const differences = validateTreatment(reopened, before, target, allocation);
  fs.renameSync(temporary, output);
  return {
    fixture: fixture.id,
    source,
    sourceSha256: fixture.hash,
    output,
    outputSha256: sha256(output),
    schema: baseline.declaredSchema,
    treatment: plan,
    semanticDifferences: differences,
    preAdvanceValidation: 'passed',
    expectedEos: `${plan.donorCoach} moves from ${plan.sourceSchool} to ${plan.originalDestination}; ${plan.nativeFreeAgent} fills the resulting ${plan.sourceSchool} ${plan.role} opening; both Staff Moves entries remain visible.`
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const schema = process.env.CCR_SCHEMA_PATH ? path.resolve(process.env.CCR_SCHEMA_PATH) : '';
  assert(schema && fs.existsSync(schema), 'Set CCR_SCHEMA_PATH.');
  if (options.write) fs.mkdirSync(options.outputDirectory, { recursive: true });
  const results = [];
  for (const fixture of FIXTURES) results.push(await prepareFixture(fixture, options, schema));
  if (options.write) {
    const manifestPath = path.join(options.outputDirectory, 'experiment-manifest.json');
    assert(!fs.existsSync(manifestPath), 'Refusing to overwrite the CAP-1 manifest.');
    const manifest = {
      experimentId: 'CAP-1',
      preparedAt: new Date().toISOString(),
      purpose: 'Test one-event expansion at each save-specific National Championship-week allocator boundary.',
      treatments: results,
      validationStatus: 'Three treatments passed source-hash, schema, allocator, semantic allowlist, and parser-reopen validation.',
      humanAction: 'Load each short-named save at CFP National Championship week, advance exactly once to End of Season, save under a distinct short EOS name, and capture the two affected schools plus Staff Moves.'
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
