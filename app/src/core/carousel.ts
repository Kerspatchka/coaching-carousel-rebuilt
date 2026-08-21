export type Turn = 'school-offers' | 'coach-decisions' | 'results';
export type OpeningStatus = 'active' | 'waiting' | 'new' | 'resolved';

export interface Team {
  id: string;
  name: string;
  shortName: string;
  assetKey: string;
  conferenceKey: string;
  conferenceName: string;
  colors: [string, string];
  lastSeasonRecord: string;
  nationalRanking?: number;
  prestige: string;
}

export interface Coach {
  id: string;
  name: string;
  role: 'HC' | 'OC' | 'DC';
  teamId: string;
  prestige: string;
  lastSeasonRecord: string;
  careerRecord: string;
  portraitAssetId: number;
  userControlled?: boolean;
}

export interface Opening {
  id: string;
  teamId: string;
  role: 'HC' | 'OC' | 'DC';
  reason: string;
  status: OpeningStatus;
  userControlled?: boolean;
  parentOpeningId?: string;
}

export interface Offer {
  id: string;
  openingId: string;
  coachId: string;
  years: number;
  points: number;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface FilledPosition {
  openingId: string;
  coachId: string;
  priorTeamId: string;
}

export interface CarouselState {
  round: number;
  turn: Turn;
  teams: Team[];
  coaches: Coach[];
  openings: Opening[];
  offers: Offer[];
  filled: FilledPosition[];
  userCoachDecision: 'accept' | 'reject' | null;
  revealed: boolean;
}

const teams: Team[] = [
  { id: 'louisville', name: 'Louisville', shortName: 'LOU', assetKey: 'Louisville', conferenceKey: 'ACCWHITE', conferenceName: 'ACC', colors: ['#ad0000', '#ffffff'], lastSeasonRecord: '9-4', nationalRanking: 18, prestige: '4.5★' },
  { id: 'louisiana-tech', name: 'Louisiana Tech', shortName: 'LT', assetKey: 'LouisianaTech', conferenceKey: 'CUSAWHITE', conferenceName: 'Conference USA', colors: ['#002f8b', '#e31b23'], lastSeasonRecord: '11-3', nationalRanking: 24, prestige: '2.5★' },
  { id: 'air-force', name: 'Air Force', shortName: 'AF', assetKey: 'AirForce', conferenceKey: 'MWCWHITE', conferenceName: 'Mountain West', colors: ['#003087', '#8a8d8f'], lastSeasonRecord: '8-5', prestige: '3.5★' },
  { id: 'alabama', name: 'Alabama', shortName: 'ALA', assetKey: 'Alabama', conferenceKey: 'SECWHITE', conferenceName: 'SEC', colors: ['#9e1b32', '#ffffff'], lastSeasonRecord: '10-3', nationalRanking: 9, prestige: '5★' }
];

const coaches: Coach[] = [
  { id: 'navarro', name: 'Eli Navarro', role: 'OC', teamId: 'louisiana-tech', prestige: 'A-', lastSeasonRecord: '11-3', careerRecord: '43-18', portraitAssetId: 6 },
  { id: 'reed', name: 'Marcus Reed', role: 'DC', teamId: 'air-force', prestige: 'B+', lastSeasonRecord: '9-4', careerRecord: '35-21', portraitAssetId: 12 },
  { id: 'grant', name: 'Theo Grant', role: 'HC', teamId: 'alabama', prestige: 'A', lastSeasonRecord: '10-3', careerRecord: '96-39', portraitAssetId: 18 },
  { id: 'price', name: 'Jordan Price', role: 'HC', teamId: 'alabama', prestige: 'A', lastSeasonRecord: '10-4', careerRecord: '78-31', portraitAssetId: 24, userControlled: true }
];

export const createFixtureState = (): CarouselState => ({
  round: 1,
  turn: 'school-offers',
  teams,
  coaches,
  openings: [
    { id: 'louisville-hc', teamId: 'louisville', role: 'HC', reason: 'Previous HC fired after performance review', status: 'active', userControlled: true },
    { id: 'air-force-hc', teamId: 'air-force', role: 'HC', reason: 'Previous HC retired', status: 'waiting' }
  ],
  offers: [
    { id: 'air-force-price', openingId: 'air-force-hc', coachId: 'price', years: 4, points: 145, status: 'pending' }
  ],
  filled: [],
  userCoachDecision: null,
  revealed: false
});

export const submitUserOffer = (state: CarouselState, years: number, points: number): CarouselState => {
  if (state.turn !== 'school-offers') throw new Error('User offers can only be submitted during the Schools Make Offers turn.');
  if (!Number.isInteger(years) || years < 1 || years > 5) throw new Error('Contract length must be between 1 and 5 years.');
  if (!Number.isInteger(points) || points < 0 || points > 300) throw new Error('Program points must be between 0 and 300.');

  return {
    ...state,
    turn: 'coach-decisions',
    offers: [...state.offers, { id: 'louisville-navarro', openingId: 'louisville-hc', coachId: 'navarro', years, points, status: 'pending' }]
  };
};

export const recordUserCoachDecision = (state: CarouselState, decision: 'accept' | 'reject'): CarouselState => {
  if (state.turn !== 'coach-decisions') throw new Error('Coach decisions are not active.');
  return { ...state, turn: 'results', userCoachDecision: decision };
};

export const revealResults = (state: CarouselState): CarouselState => {
  if (state.turn !== 'results' || state.userCoachDecision === null) throw new Error('A user Coach decision is required before results can be revealed.');
  if (state.revealed) return state;

  const priceAccepted = state.userCoachDecision === 'accept';
  const resolvedIds = new Set(['louisville-hc', ...(priceAccepted ? ['air-force-hc'] : [])]);
  const newOpenings: Opening[] = [
    { id: 'louisiana-tech-oc', teamId: 'louisiana-tech', role: 'OC', reason: 'Eli Navarro accepted the Louisville HC job', status: 'new', parentOpeningId: 'louisville-hc' },
    ...(priceAccepted
      ? [{ id: 'alabama-hc', teamId: 'alabama', role: 'HC' as const, reason: 'Jordan Price accepted the Air Force HC job', status: 'new' as const, parentOpeningId: 'air-force-hc' }]
      : [])
  ];

  return {
    ...state,
    revealed: true,
    openings: [
      ...state.openings.map((opening) => resolvedIds.has(opening.id) ? { ...opening, status: 'resolved' as const } : opening),
      ...newOpenings
    ],
    offers: state.offers.map((offer) => ({
      ...offer,
      status: offer.id === 'louisville-navarro' || (offer.id === 'air-force-price' && priceAccepted) ? 'accepted' : 'rejected'
    })),
    filled: [
      { openingId: 'louisville-hc', coachId: 'navarro', priorTeamId: 'louisiana-tech' },
      ...(priceAccepted ? [{ openingId: 'air-force-hc', coachId: 'price', priorTeamId: 'alabama' }] : [])
    ]
  };
};

export const teamById = (state: CarouselState, id: string): Team => {
  const team = state.teams.find((candidate) => candidate.id === id);
  if (!team) throw new Error(`Unknown Team: ${id}`);
  return team;
};

export const coachById = (state: CarouselState, id: string): Coach => {
  const coach = state.coaches.find((candidate) => candidate.id === id);
  if (!coach) throw new Error(`Unknown Coach: ${id}`);
  return coach;
};
