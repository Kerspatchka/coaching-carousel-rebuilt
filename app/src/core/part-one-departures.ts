import type { DynastySnapshot } from './dynasty';
import type { PartOneEvaluation } from './evaluation';
import type { MarketBaseline } from './market';
import { planNflDepartures, type NflDepartureConfig } from './nfl-departures';
import { planRetirements, type RetirementConfig } from './retirements';
import { planUnexpectedScenarios, type UnexpectedScenarioConfig, type UnexpectedScenarioDecision } from './unexpected-scenarios';

export interface PartOneDepartureOptions {
  nflConfig?: NflDepartureConfig;
  retirementConfig?: RetirementConfig;
  nationalChampionTeamId?: string | null;
  unexpectedScenarioConfig?: UnexpectedScenarioConfig;
  unexpectedScenarioDecisions?: Readonly<Record<string, UnexpectedScenarioDecision>>;
}

export function planPartOneDepartures(
  snapshot: DynastySnapshot,
  market: MarketBaseline,
  evaluation: PartOneEvaluation,
  options: PartOneDepartureOptions = {}
) {
  const nfl = planNflDepartures(snapshot, market, evaluation, options.nflConfig);
  const retirements = planRetirements(snapshot, market, {
    departedCoachIds: nfl.departedCoachIds,
    nationalChampionTeamId: options.nationalChampionTeamId ?? snapshot.nationalChampionship?.winnerTeamId ?? null
  }, options.retirementConfig);
  const priorDepartedCoachIds = [...nfl.departedCoachIds, ...retirements.retiredCoachIds];
  const priorAffectedTeamIds = [...new Set([...nfl.events.map((event) => event.teamId), ...retirements.events.map((event) => event.teamId)])];
  const unexpectedScenarios = planUnexpectedScenarios(snapshot, market, {
    departedCoachIds: priorDepartedCoachIds,
    affectedTeamIds: priorAffectedTeamIds,
    userDecisions: options.unexpectedScenarioDecisions
  }, options.unexpectedScenarioConfig);
  const departedCoachIds = [...priorDepartedCoachIds, ...unexpectedScenarios.departedCoachIds];
  const internalSuccessionTeamIds = [...new Set([...nfl.internalSuccessionTeamIds, ...retirements.internalSuccessionTeamIds, ...unexpectedScenarios.internalSuccessionTeamIds])];
  const vacancies = [...nfl.coordinatorVacancies, ...retirements.coordinatorVacancies, ...unexpectedScenarios.vacancies];
  if (new Set(departedCoachIds).size !== departedCoachIds.length) throw new Error('A Coach was assigned more than one Part 1 departure.');
  if (new Set(vacancies.map((vacancy) => `${vacancy.teamId}:${vacancy.role}`)).size !== vacancies.length) {
    throw new Error('A staff seat received more than one Part 1 departure vacancy.');
  }
  return {
    status: 'part-one-departures-planned' as const,
    sourceFingerprint: snapshot.sourceFingerprint,
    seed: market.seed,
    nfl,
    retirements,
    unexpectedScenarios,
    departedCoachIds,
    availableCoachIds: unexpectedScenarios.availableCoachIds,
    internalSuccessionTeamIds,
    vacancies,
    invariants: { valid: true as const, uniqueDepartedCoaches: departedCoachIds.length, uniqueVacancies: vacancies.length }
  };
}
