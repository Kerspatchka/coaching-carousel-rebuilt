/*
 * Read-only forensic report for the CCR reference-save series.
 *
 * Usage:
 *   node scripts/analyze-carousel-saves.js [save-directory] [output-json]
 *
 * madden-franchise may be supplied through NODE_PATH when it is installed
 * outside this repository. The script never calls franchise.save().
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { FranchiseFile } = require('madden-franchise');

const EMPTY_REF = '00000000000000000000000000000000';
const TABLES = {
  offers: 674348040,
  offerArrays: 4119397260,
  openings: 263453863,
  coaches: 1860529246,
  teams: 3359508968
};

const ORDER = ['PRE', 'W15', 'CONFCHAMP', 'BW1', 'BW2', 'BW3', 'EOS', 'LEAVING'];

function fields(record) {
  if (!record || !record.fieldsArray) return [];
  return record.fieldsArray.map((field) => field.key);
}

function value(record, aliases, fallback = null) {
  if (!record) return fallback;
  const fieldNames = fields(record);
  const exact = aliases.find((name) => fieldNames.includes(name));
  const lowerMap = new Map(fieldNames.map((name) => [name.toLowerCase(), name]));
  const insensitive = aliases.map((name) => lowerMap.get(name.toLowerCase())).find(Boolean);
  const key = exact || insensitive;
  const result = key ? record[key] : undefined;
  return result === undefined || result === null ? fallback : result;
}

function selected(record, names) {
  return Object.fromEntries(names.map((name) => [name, value(record, [name])]).filter(([, item]) => item !== null));
}

function refParts(reference) {
  if (typeof reference !== 'string' || !/^[01]{32}$/.test(reference) || reference === EMPTY_REF) return null;
  return {
    tableId: Number.parseInt(reference.slice(0, 15), 2),
    row: Number.parseInt(reference.slice(15), 2)
  };
}

function meaningful(record) {
  return record && !record.isEmpty;
}

function refFor(table, record) {
  return table.getBinaryReferenceToRecord(record.index);
}

function displayName(record) {
  const direct = value(record, ['DisplayName', 'LongName', 'Name']);
  if (direct && String(direct).trim()) return String(direct).trim();
  return [value(record, ['FirstName'], ''), value(record, ['LastName'], '')].join(' ').trim();
}

function sortObject(input) {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}

function changedFields(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter((key) => JSON.stringify(before && before[key]) !== JSON.stringify(after && after[key]));
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

async function snapshot(savePath, schemaPath) {
  const franchise = await createFranchise(savePath, schemaPath);
  const declared = franchise.expectedSchemaVersion;
  const table = Object.fromEntries(Object.entries(TABLES).map(([key, uniqueId]) => [key, franchise.getTableByUniqueId(uniqueId)]));
  for (const [key, found] of Object.entries(table)) {
    if (!found) throw new Error(`Missing ${key} table (${TABLES[key]}) in ${path.basename(savePath)}`);
  }
  await Promise.all(Object.values(table).map((item) => item.readRecords()));

  const teams = new Map();
  for (const record of table.teams.records.filter(meaningful)) {
    teams.set(refFor(table.teams, record), {
      row: record.index,
      name: displayName(record) || `Team row ${record.index}`,
      fields: selected(record, [
        'TeamIndex', 'HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator', 'SpecialTeamsCoach',
        'TeamPrestige', 'CurrentPopularity', 'OverallPopularity', 'HeadCoachStatus',
        'OffensiveCoordinatorStatus', 'DefensiveCoordinatorStatus', 'HeadCoachGoal',
        'OffensiveCoordinatorGoal', 'DefensiveCoordinatorGoal'
      ])
    });
  }

  const coaches = new Map();
  for (const record of table.coaches.records.filter(meaningful)) {
    coaches.set(refFor(table.coaches, record), {
      row: record.index,
      name: displayName(record) || `Coach row ${record.index}`,
      fields: selected(record, [
        'TeamIndex', 'PrevTeamIndex', 'Position', 'PrevPosition', 'ContractStatus',
        'ContractYearsRemaining', 'ContractLength', 'CurrentContractExpectation',
        'CurrentJobSecurityPercentage', 'CurrentJobSecurityStatus', 'JobSecurityRank',
        'SeasonStartJobSecurityStatus', 'COACH_FIREREPORTED', 'COACH_RESIGNREPORTED',
        'LastFiredTeam', 'LastResignedTeam', 'IsUserControlled', 'NumContractOffers',
        'YearsCoaching', 'SeasonsWithTeam', 'CoachPrestige', 'CoachPrestigeScore',
        'LegacyScore', 'AwardPoints', 'YearlyAwardCount', 'CareerWinSeasons',
        'CareerPlayoffsMade', 'CareerPointsFor', 'CareerPointsAgainst',
        'EarnedContractPoints_ThisYear', 'EarnedContractPoints_LastYear',
        'EarnedContractPoints_TwoYearsAgo', 'COACH_PERFORMANCELEVEL',
        'CurrentStatRankPosition', 'Level', 'Age'
      ])
    });
  }

  function resolve(reference, collection, label) {
    if (!reference || reference === EMPTY_REF) return null;
    const found = collection.get(reference);
    return found ? `${found.name} [${found.row}]` : `${label} ${JSON.stringify(refParts(reference))}`;
  }

  const openings = {};
  for (const record of table.openings.records.filter(meaningful)) {
    const raw = selected(record, [
      'Team', 'SelectedCoach', 'PrevCoach', 'InterestedUserTeamsList', 'ContractOfferList',
      'Filled', 'IsEmergentJobOpening', 'Position', 'FinalContractProgramPoints',
      'HighestOfferedProgramPoints', 'Reason'
    ]);
    openings[record.index] = {
      ...raw,
      TeamName: resolve(raw.Team, teams, 'team ref'),
      SelectedCoachName: resolve(raw.SelectedCoach, coaches, 'coach ref'),
      PrevCoachName: resolve(raw.PrevCoach, coaches, 'coach ref')
    };
  }

  const offers = {};
  for (const record of table.offers.records.filter(meaningful)) {
    const raw = {
      Team: value(record, ['Team']),
      StaffPerson: value(record, ['StaffPerson']),
      StaffPersonTeam: value(record, ['StaffPersonTeam']),
      ContractPosition: value(record, ['ContractPosition']),
      Status: value(record, ['Status']),
      OfferIndex: value(record, ['OfferIndex', 'Index']),
      BaseStaffPersonInterestInOffer: value(record, ['BaseStaffPersonInterestInOffer', 'BaseStaffPersonInterestinOffer']),
      AdjustedStaffPersonInterestInOffer: value(record, ['AdjustedStaffPersonInterestInOffer']),
      TeamInterestInStaffPerson: value(record, ['TeamInterestInStaffPerson', 'TeamInterestinStaffPerson']),
      Length: value(record, ['Length']),
      ContractExpectationsByYear: value(record, ['ContractExpectationsByYear']),
      ExpectedContractProgramPoints: value(record, ['ExpectedContractProgramPoints']),
      OfferedContractProgramPoints: value(record, ['OfferedContractProgramPoints']),
      ExperiencePoints: value(record, ['ExperiencePoints'])
    };
    offers[record.index] = {
      ...raw,
      TeamName: resolve(raw.Team, teams, 'team ref'),
      StaffPersonName: resolve(raw.StaffPerson, coaches, 'coach ref'),
      StaffPersonTeamName: resolve(raw.StaffPersonTeam, teams, 'team ref')
    };
  }

  const offerArrays = {};
  for (const record of table.offerArrays.records.filter(meaningful)) {
    const slots = fields(record)
      .filter((name) => /^StaffPersonContractOffer\d+$/i.test(name))
      .sort()
      .map((name) => record[name])
      .filter((reference) => reference && reference !== EMPTY_REF);
    if (slots.length) offerArrays[record.index] = { arraySize: record.arraySize, slots };
  }

  return {
    file: path.basename(savePath),
    schema: `${declared.major}.${declared.minor}`,
    tableDescriptors: Object.fromEntries(Object.entries(table).map(([key, item]) => [key, {
      name: item.name,
      tableId: item.header.tableId,
      uniqueId: item.header.uniqueId,
      capacity: item.header.recordCapacity,
      active: item.records.filter(meaningful).length,
      fields: fields(item.records.find(meaningful))
    }])),
    teams: sortObject(Object.fromEntries(teams)),
    coaches: sortObject(Object.fromEntries(coaches)),
    openings: sortObject(openings),
    offers: sortObject(offers),
    offerArrays: sortObject(offerArrays)
  };
}

function diffSnapshots(before, after) {
  const result = {};
  for (const section of ['teams', 'coaches', 'openings', 'offers', 'offerArrays']) {
    const prior = before[section] || {};
    const next = after[section] || {};
    const keys = new Set([...Object.keys(prior), ...Object.keys(next)]);
    result[section] = [...keys].sort().map((key) => {
      if (!(key in prior)) return { key, kind: 'added', after: next[key] };
      if (!(key in next)) return { key, kind: 'removed', before: prior[key] };
      const changes = changedFields(prior[key], next[key]).filter((field) => field !== 'fields');
      const fieldChanges = prior[key].fields && next[key].fields ? changedFields(prior[key].fields, next[key].fields) : [];
      const allChanges = [...changes, ...fieldChanges];
      return allChanges.length ? { key, kind: 'changed', fields: allChanges, before: prior[key], after: next[key] } : null;
    }).filter(Boolean);
  }
  return result;
}

async function main() {
  const saveDirectory = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'ref_saves'));
  const schemaPath = process.env.CCR_SCHEMA_PATH;
  if (!schemaPath || !fs.existsSync(schemaPath)) {
    throw new Error('Set CCR_SCHEMA_PATH to the compatible CFB27_833_0.gz schema.');
  }
  const files = fs.readdirSync(saveDirectory).filter((name) => /^DYNASTY-CCRY1/i.test(name));
  const byStage = new Map(files.map((name) => [name.replace(/^DYNASTY-CCRY1/i, '').toUpperCase(), path.join(saveDirectory, name)]));
  const snapshots = [];
  for (const stage of ORDER) {
    if (!byStage.has(stage)) continue;
    process.stderr.write(`Reading ${stage}...\n`);
    snapshots.push({ stage, data: await snapshot(byStage.get(stage), schemaPath) });
  }
  const transitions = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    transitions.push({
      from: snapshots[index - 1].stage,
      to: snapshots[index].stage,
      changes: diffSnapshots(snapshots[index - 1].data, snapshots[index].data)
    });
  }
  const report = JSON.stringify({ generatedAt: new Date().toISOString(), snapshots, transitions }, null, 2);
  const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (outputPath) {
    fs.writeFileSync(outputPath, report);
    process.stderr.write(`Wrote ${outputPath}\n`);
  } else {
    process.stdout.write(report);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
