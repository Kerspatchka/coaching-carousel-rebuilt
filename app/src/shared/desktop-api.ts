import type { DynastySnapshot } from '../core/dynasty';

export type PreflightSeverity = 'blocking' | 'warning' | 'info';

export interface PreflightIssue {
  code: string;
  severity: PreflightSeverity;
  title: string;
  detail: string;
}

export interface LoadedUserCoach {
  coachRow: number;
  name: string;
  role: string;
  prestige: string;
  level: number | null;
  age: number | null;
  careerRecord: string;
  seasonRecord: string;
  contractYearsRemaining: number | null;
  team: {
    teamRow: number;
    teamIndex: number;
    name: string;
    longName: string;
    nickname: string;
    assetKey: string;
    prestige: number | null;
    nationalRanking: number | null;
    primaryColor: string;
    secondaryColor: string;
  } | null;
}

export interface SavePreflightResult {
  status: 'ready' | 'blocked';
  file: {
    name: string;
    path: string;
    sizeBytes: number;
  };
  schema: {
    expected: string;
    detected: string | null;
  };
  checkpoint: {
    seasonYear: number | null;
    stage: string | null;
    weekType: string | null;
    week: number | null;
    carouselActive: boolean;
  };
  inventory: {
    teams: number;
    coaches: number;
    userCoaches: number;
    openings: number;
    openingCapacity: number;
    indexedStaffMoves: number;
  };
  users: LoadedUserCoach[];
  snapshot: DynastySnapshot | null;
  issues: PreflightIssue[];
}

export interface DesktopApi {
  getAppInfo(): Promise<{ name: string; version: string }>;
  selectAndInspectSave(): Promise<SavePreflightResult | null>;
}

declare global {
  interface Window {
    ccr: DesktopApi;
  }
}
