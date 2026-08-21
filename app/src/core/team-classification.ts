import type { NormalizedTeam } from './dynasty';

export function isFcsProgram(team: Pick<NormalizedTeam, 'name' | 'longName' | 'shortName' | 'nickname' | 'assetKey'>): boolean {
  return [team.name, team.longName, team.shortName, team.nickname, team.assetKey]
    .some((value) => /(^|\s|[-_])FCS($|\s|[-_])/i.test(value ?? ''));
}
