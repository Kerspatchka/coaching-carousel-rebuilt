import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  coachById,
  createFixtureState,
  recordUserCoachDecision,
  revealResults,
  submitUserOffer,
  teamById,
  type CarouselState,
  type Coach,
  type Team,
  type Turn
} from '../core/carousel';
import { createMarketRunSeed, initializeMarket, type MarketBaseline } from '../core/market';
import { evaluatePartOne, type JobEvaluationClassification, type PartOneEvaluation } from '../core/evaluation';
import { planPartOneDepartures } from '../core/part-one-departures';
import { planPerformanceActions, type PerformanceDecisionChoice } from '../core/performance-actions';
import type { UnexpectedScenarioDecision } from '../core/unexpected-scenarios';
import type { DynastySnapshot } from '../core/dynasty';
import '../shared/desktop-api';
import type { SavePreflightResult } from '../shared/desktop-api';
import { shellBackground } from './assets/assetCatalog';
import { CcrBadge, CcrButton, CoachHead, CoachStanding, ConferenceMark, Eyebrow, NormalizedCoachHead, NormalizedTeamArt, NormalizedTeamMark, TeamArt, TeamMark } from './components/CcrUi';
import { createPreviewPreflight } from './previewFixture';

type View = 'hiring' | 'new' | 'filled';
type RevealPhase = 'idle' | 'deliberating' | 'selected' | 'cascade';
type AppMode = 'start' | 'inspecting' | 'preflight' | 'market-ready' | 'evaluation-ready' | 'departures-ready' | 'carousel';
type DeparturePlan = ReturnType<typeof planPartOneDepartures>;
type PerformancePlan = ReturnType<typeof planPerformanceActions>;
type PartOneEventKind = 'NFL' | 'RETIREMENT' | 'SCENARIO' | 'PERFORMANCE';

interface PartOneUiEvent {
  id: string;
  kind: PartOneEventKind;
  teamId: string;
  coachIds: string[];
  eyebrow: string;
  title: string;
  detail: string;
  result: string;
  fictional: boolean;
  tone: 'gold' | 'new' | 'success' | 'warning' | 'neutral';
}

const scenarioLabel = (value: string) => value === 'LookingForAChange'
  ? 'LOOKING FOR A CHANGE'
  : value.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();

function buildPartOneEvents(snapshot: DynastySnapshot, departures: DeparturePlan, performance: PerformancePlan): PartOneUiEvent[] {
  const events: PartOneUiEvent[] = departures.nfl.events.map((event) => ({
    id: event.id, kind: 'NFL', teamId: event.teamId, coachIds: [event.coachId], eyebrow: 'NFL DEPARTURE',
    title: 'THE NEXT LEVEL CALLS',
    detail: event.consequence === 'InternalSuccessionReview' ? 'The program will evaluate its coordinators for an internal Head Coach promotion.' : `A new ${roleLabel(event.role)} vacancy enters the carousel.`,
    result: 'DEPARTS FOR NFL', fictional: false, tone: 'new'
  }));
  events.push(...departures.retirements.events.map((event) => ({
    id: event.id, kind: 'RETIREMENT' as const, teamId: event.teamId, coachIds: [event.coachId], eyebrow: event.reason === 'RetiringOnTop' ? 'RETIRING ON TOP' : 'COACH RETIREMENT',
    title: event.reason === 'RetiringOnTop' ? 'A CHAMPION WALKS AWAY' : 'THE FINAL WHISTLE',
    detail: event.consequence === 'InternalSuccessionReview' ? 'The program moves into Internal Succession Review.' : `A new ${roleLabel(event.role)} vacancy enters the carousel.`,
    result: event.reason === 'RetiringOnTop' ? 'RETIRES AS CHAMPION' : 'RETIRES', fictional: false, tone: event.reason === 'RetiringOnTop' ? 'gold' as const : 'neutral' as const
  })));
  events.push(...departures.unexpectedScenarios.outcomes.filter((outcome) => outcome.decision !== 'nullify').map((outcome) => {
    const affected = [...outcome.affectedCoachIds].sort((left, right) => {
      const leftRole = snapshot.coaches.find((coach) => coach.id === left)?.role;
      const rightRole = snapshot.coaches.find((coach) => coach.id === right)?.role;
      return leftRole === 'HeadCoach' ? -1 : rightRole === 'HeadCoach' ? 1 : 0;
    });
    return {
      id: outcome.id, kind: 'SCENARIO' as const, teamId: outcome.teamId, coachIds: affected,
      eyebrow: 'UNEXPECTED SCENARIO · FICTIONAL SIMULATION', title: scenarioLabel(outcome.category),
      detail: outcome.decision === 'nullify' ? 'User protection was exercised. The selected event is consumed without rerolling.' : outcome.category === 'LookingForAChange' ? 'The Coach resigns voluntarily, creates a vacancy, and enters the available Coaches pool.' : outcome.consequence === 'CleansHouse' ? 'The scenario removes the complete coaching staff and creates three vacancies.' : 'The affected Coach leaves the program and creates a vacancy.',
      result: outcome.decision === 'nullify' ? 'NULLIFIED' : outcome.category === 'LookingForAChange' ? 'AVAILABLE COACH' : outcome.consequence === 'CleansHouse' ? 'CLEANS HOUSE' : 'COACH REMOVED', fictional: true,
      tone: outcome.decision === 'nullify' ? 'success' as const : 'warning' as const
    };
  }));
  const groupedPerformance = new Map<string, typeof performance.actions>();
  for (const action of performance.actions) {
    const key = action.trigger === 'CleansHouse' ? `cleans-house:${action.teamId}` : action.id;
    groupedPerformance.set(key, [...(groupedPerformance.get(key) ?? []), action]);
  }
  events.push(...[...groupedPerformance.entries()].map(([id, actions]) => {
    const primary = actions.find((action) => action.role === 'HC') ?? actions[0]!;
    const cleansHouse = actions.some((action) => action.trigger === 'CleansHouse');
    return {
      id, kind: 'PERFORMANCE' as const, teamId: primary.teamId, coachIds: actions.map((action) => action.coachId),
      eyebrow: cleansHouse ? 'PERFORMANCE DECISION · PROGRAM RESET' : 'PERFORMANCE DECISION',
      title: cleansHouse ? 'THE PROGRAM CLEANS HOUSE' : 'A STAFF CHANGE IS MADE',
      detail: cleansHouse ? 'The Head Coach is dismissed and both coordinators are not retained. Buyout pricing remains pending.' : `${roleLabel(primary.role)} performance falls below the evidence-gated standard. Buyout pricing remains pending.`,
      result: cleansHouse ? '3 SEATS OPEN' : `${roleLabel(primary.role).toUpperCase()} FIRED`, fictional: false, tone: 'warning' as const
    };
  }));
  return events;
}

const turns: Turn[] = ['school-offers', 'coach-decisions', 'results'];
const turnLabels: Record<Turn, string> = {
  'school-offers': 'Schools Make Offers',
  'coach-decisions': 'Coaches Consider Offers',
  results: 'Results & New Openings'
};

const roleLabel = (role: 'HC' | 'OC' | 'DC') => (
  role === 'HC' ? 'Head Coach' : role === 'OC' ? 'Offensive Coordinator' : 'Defensive Coordinator'
);
const normalizedRoleLabel = (role: string) => (
  role === 'HeadCoach' ? 'Head Coach' : role === 'OffensiveCoordinator' ? 'Offensive Coordinator' : role === 'DefensiveCoordinator' ? 'Defensive Coordinator' : role
);

const scrollEvaluationListOnKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
  const list = event.currentTarget;
  const page = Math.max(120, list.clientHeight * 0.85);
  if (event.key === 'ArrowDown') list.scrollBy({ top: 72 });
  else if (event.key === 'ArrowUp') list.scrollBy({ top: -72 });
  else if (event.key === 'PageDown') list.scrollBy({ top: page });
  else if (event.key === 'PageUp') list.scrollBy({ top: -page });
  else if (event.key === 'Home') list.scrollTo({ top: 0 });
  else if (event.key === 'End') list.scrollTo({ top: list.scrollHeight });
  else return;
  event.preventDefault();
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

export function App() {
  const [mode, setMode] = useState<AppMode>('start');
  const [preflight, setPreflight] = useState<SavePreflightResult | null>(null);
  const [market, setMarket] = useState<MarketBaseline | null>(null);
  const [evaluation, setEvaluation] = useState<PartOneEvaluation | null>(null);
  const [departures, setDepartures] = useState<DeparturePlan | null>(null);
  const [performance, setPerformance] = useState<PerformancePlan | null>(null);
  const [scenarioDecisions, setScenarioDecisions] = useState<Record<string, UnexpectedScenarioDecision>>({});
  const [performanceDecisions, setPerformanceDecisions] = useState<Record<string, PerformanceDecisionChoice>>({});
  const [partOneEventIndex, setPartOneEventIndex] = useState<number | null>(null);
  const [partOneReviewComplete, setPartOneReviewComplete] = useState(false);
  const [state, setState] = useState<CarouselState>(() => createFixtureState());
  const [view, setView] = useState<View>('hiring');
  const [years, setYears] = useState(3);
  const [points, setPoints] = useState(130);
  const [version, setVersion] = useState('fixture build');
  const [revealPhase, setRevealPhase] = useState<RevealPhase>('idle');
  const reducedMotion = useReducedMotion();
  const partOneEvents = useMemo(() => (
    preflight?.snapshot && departures && performance
      ? buildPartOneEvents(preflight.snapshot, departures, performance)
      : []
  ), [departures, performance, preflight?.snapshot]);

  const newOpenings = state.openings.filter((opening) => opening.status === 'new');
  const activeOpening = state.openings.find((opening) => opening.status === 'active') ?? state.openings[0]!;
  const activeTeam = teamById(state, activeOpening.teamId);
  const finalists = ['navarro', 'reed', 'grant'].map((id) => coachById(state, id));

  useEffect(() => {
    window.ccr?.getAppInfo().then((info) => setVersion(`v${info.version}`)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get('preview');
    if (preview !== 'evaluation' && preview !== 'departures') return;
    void fetch('/evaluation-preview.json')
      .then((response) => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return createPreviewPreflight();
        return response.json() as Promise<SavePreflightResult>;
      })
      .then((result) => {
        if (!result.snapshot) throw new Error('Preview fixture has no normalized dynasty snapshot');
        const previewMarket = initializeMarket(result.snapshot, createMarketRunSeed(result.snapshot));
        const previewEvaluation = evaluatePartOne(result.snapshot, previewMarket);
        setPreflight(result);
        setMarket(previewMarket);
        setEvaluation(previewEvaluation);
        if (preview === 'departures') {
          const previewDepartures = planPartOneDepartures(result.snapshot, previewMarket, previewEvaluation);
          setDepartures(previewDepartures);
          setPerformance(planPerformanceActions(result.snapshot, previewMarket, previewEvaluation, {
            departedCoachIds: previewDepartures.departedCoachIds,
            internalSuccessionTeamIds: previewDepartures.internalSuccessionTeamIds
          }));
          setMode('departures-ready');
        } else {
          setMode('evaluation-ready');
        }
      })
      .catch((error) => console.error('Unable to load evaluation preview', error));
  }, []);

  const statusCopy = useMemo(() => {
    if (state.revealed) return `${state.filled.length} positions filled · ${newOpenings.length} new openings created`;
    if (state.turn === 'school-offers') return 'Louisville must submit its final offer';
    if (state.turn === 'coach-decisions') return 'Your Coach has a career decision';
    return 'All decisions are locked and ready to reveal';
  }, [newOpenings.length, state]);

  const completeReveal = useCallback(() => {
    setState((current) => current.revealed ? current : revealResults(current));
    setRevealPhase('idle');
    setView('hiring');
  }, []);

  const advanceReveal = useCallback(() => {
    if (revealPhase === 'deliberating') setRevealPhase('selected');
    else if (revealPhase === 'selected') setRevealPhase('cascade');
    else if (revealPhase === 'cascade') completeReveal();
  }, [completeReveal, revealPhase]);

  useEffect(() => {
    if (revealPhase === 'idle') return undefined;
    const advanceOnSpace = (event: KeyboardEvent) => {
      if (event.key === ' ' && !event.repeat) {
        event.preventDefault();
        advanceReveal();
      }
    };
    window.addEventListener('keydown', advanceOnSpace);
    return () => window.removeEventListener('keydown', advanceOnSpace);
  }, [advanceReveal, revealPhase]);

  const advancePartOneEvent = useCallback(() => {
    setPartOneEventIndex((current) => {
      if (current === null) return null;
      if (current + 1 < partOneEvents.length) return current + 1;
      setPartOneReviewComplete(true);
      return null;
    });
  }, [partOneEvents.length]);

  useEffect(() => {
    if (partOneEventIndex === null) return undefined;
    const advanceOnSpace = (event: KeyboardEvent) => {
      if (event.key === ' ' && !event.repeat) {
        event.preventDefault();
        advancePartOneEvent();
      }
    };
    window.addEventListener('keydown', advanceOnSpace);
    return () => window.removeEventListener('keydown', advanceOnSpace);
  }, [advancePartOneEvent, partOneEventIndex]);

  const submitOffer = () => setState((current) => submitUserOffer(current, years, points));
  const decide = (decision: 'accept' | 'reject') => setState((current) => recordUserCoachDecision(current, decision));
  const reset = () => {
    setState(createFixtureState());
    setView('hiring');
    setRevealPhase('idle');
    setYears(3);
    setPoints(130);
  };

  const selectSave = async () => {
    if (!window.ccr?.selectAndInspectSave) return;
    setMode('inspecting');
    try {
      const result = await window.ccr.selectAndInspectSave();
      if (!result) {
        setMode(preflight ? 'preflight' : 'start');
        return;
      }
      setPreflight(result);
      setMarket(null);
      setEvaluation(null);
      setDepartures(null);
      setPerformance(null);
      setScenarioDecisions({});
      setPerformanceDecisions({});
      setPartOneEventIndex(null);
      setPartOneReviewComplete(false);
      setMode('preflight');
    } catch {
      setMode('start');
    }
  };

  const initializeSelectedMarket = () => {
    if (!preflight?.snapshot) return;
    setMarket(initializeMarket(preflight.snapshot, createMarketRunSeed(preflight.snapshot)));
    setMode('market-ready');
  };

  const evaluateSelectedMarket = () => {
    if (!preflight?.snapshot || !market) return;
    setEvaluation(evaluatePartOne(preflight.snapshot, market));
    setMode('evaluation-ready');
  };

  const calculatePartOne = (
    nextScenarioDecisions: Record<string, UnexpectedScenarioDecision>,
    nextPerformanceDecisions: Record<string, PerformanceDecisionChoice>
  ) => {
    if (!preflight?.snapshot || !market || !evaluation) return;
    const nextDepartures = planPartOneDepartures(preflight.snapshot, market, evaluation, { unexpectedScenarioDecisions: nextScenarioDecisions });
    const nextPerformance = planPerformanceActions(preflight.snapshot, market, evaluation, {
      departedCoachIds: nextDepartures.departedCoachIds,
      internalSuccessionTeamIds: nextDepartures.internalSuccessionTeamIds,
      userDecisions: nextPerformanceDecisions
    });
    setDepartures(nextDepartures);
    setPerformance(nextPerformance);
  };

  const runPartOne = () => {
    const nextScenarioDecisions = {};
    const nextPerformanceDecisions = {};
    setScenarioDecisions(nextScenarioDecisions);
    setPerformanceDecisions(nextPerformanceDecisions);
    setPartOneEventIndex(null);
    setPartOneReviewComplete(false);
    calculatePartOne(nextScenarioDecisions, nextPerformanceDecisions);
    setMode('departures-ready');
  };

  const decideScenario = (scenarioId: string, choice: UnexpectedScenarioDecision) => {
    const next = { ...scenarioDecisions, [scenarioId]: choice };
    setScenarioDecisions(next);
    calculatePartOne(next, performanceDecisions);
  };

  const decidePerformance = (decisionId: string, choice: PerformanceDecisionChoice) => {
    if (!preflight?.snapshot || !market || !evaluation || !departures) return;
    const next = { ...performanceDecisions, [decisionId]: choice };
    setPerformanceDecisions(next);
    setPerformance(planPerformanceActions(preflight.snapshot, market, evaluation, {
      departedCoachIds: departures.departedCoachIds,
      internalSuccessionTeamIds: departures.internalSuccessionTeamIds,
      userDecisions: next
    }));
  };

  if (mode === 'market-ready') {
    return preflight && market
      ? <MarketReady result={preflight} market={market} version={version} onBack={() => setMode('preflight')} onEvaluate={evaluateSelectedMarket} />
      : <StartAndPreflight mode="preflight" result={preflight} version={version} onSelect={selectSave} onBegin={initializeSelectedMarket} />;
  }

  if (mode === 'evaluation-ready') {
    return preflight?.snapshot && market && evaluation
      ? <EvaluationReady result={preflight} evaluation={evaluation} version={version} onBack={() => setMode('market-ready')} onPlan={runPartOne} />
      : <StartAndPreflight mode="preflight" result={preflight} version={version} onSelect={selectSave} onBegin={initializeSelectedMarket} />;
  }

  if (mode === 'departures-ready') {
    return preflight?.snapshot && departures && performance
      ? <>
          <PartOneDeparturesReady
            result={preflight}
            departures={departures}
            performance={performance}
            events={partOneEvents}
            version={version}
            reviewComplete={partOneReviewComplete}
            onBack={() => setMode('evaluation-ready')}
            onBegin={() => partOneEvents.length ? setPartOneEventIndex(0) : setPartOneReviewComplete(true)}
            onScenarioDecision={decideScenario}
            onPerformanceDecision={decidePerformance}
          />
          {partOneEventIndex !== null && partOneEvents[partOneEventIndex] && (
            <PartOneEventStage
              event={partOneEvents[partOneEventIndex]!}
              index={partOneEventIndex}
              total={partOneEvents.length}
              snapshot={preflight.snapshot}
              reducedMotion={reducedMotion}
              onAdvance={advancePartOneEvent}
              onSkip={() => { setPartOneEventIndex(null); setPartOneReviewComplete(true); }}
            />
          )}
        </>
      : <StartAndPreflight mode="preflight" result={preflight} version={version} onSelect={selectSave} onBegin={initializeSelectedMarket} />;
  }

  if (mode !== 'carousel') {
    return <StartAndPreflight mode={mode} result={preflight} version={version} onSelect={selectSave} onBegin={initializeSelectedMarket} />;
  }

  return (
    <main
      className="app-shell"
      data-theme="ccr"
      style={{
        '--team-primary': activeTeam.colors[0],
        '--team-secondary': activeTeam.colors[1],
        '--shell-background': `url(${shellBackground})`
      } as React.CSSProperties}
    >
      <header className="app-header">
        <div className="brand-lockup">
          <span className="ccr-shield">CCR</span>
          <div><Eyebrow>DYNASTY UTILITY</Eyebrow><strong>COACHING CAROUSEL REBUILT</strong></div>
        </div>
        <div className="header-context">
          <div><Eyebrow>{preflight ? `${preflight.checkpoint.seasonYear} DYNASTY` : 'PART 2'}</Eyebrow><strong>{preflight?.users[0]?.team?.name ?? 'COACHING MARKET'}</strong></div>
          <span className="header-divider" />
          <div><Eyebrow>HC CAROUSEL</Eyebrow><strong>ROUND {state.round}</strong></div>
        </div>
        <div className="header-live"><span className="status status-warning" /><div><Eyebrow>CAROUSEL PREVIEW</Eyebrow><strong>{turnLabels[state.turn]}</strong></div><button className="change-save" type="button" onClick={() => setMode('preflight')}>CHANGE SAVE</button></div>
      </header>

      <nav className="view-tabs tabs tabs-border" role="tablist" aria-label="Carousel views">
        <button role="tab" className={`tab ${view === 'hiring' ? 'tab-active' : ''}`} aria-selected={view === 'hiring'} onClick={() => setView('hiring')}>NOW HIRING</button>
        <button role="tab" className={`tab ${view === 'new' ? 'tab-active' : ''}`} aria-selected={view === 'new'} onClick={() => setView('new')}>NEW OPENINGS <CcrBadge tone={newOpenings.length ? 'new' : 'neutral'}>{newOpenings.length}</CcrBadge></button>
        <button role="tab" className={`tab ${view === 'filled' ? 'tab-active' : ''}`} aria-selected={view === 'filled'} onClick={() => setView('filled')}>FILLED POSITIONS <CcrBadge tone="gold">{state.filled.length}</CcrBadge></button>
      </nav>

      <section className="workspace">
        <aside className="queue-panel" aria-label="Offer queue">
          <header className="queue-header">
            <div><Eyebrow>MARKET ORDER</Eyebrow><h2>OFFER QUEUE</h2></div>
            <CcrBadge tone="gold">{state.openings.filter((opening) => opening.status !== 'resolved').length} OPEN</CcrBadge>
          </header>
          <div className="queue-list">
            {state.openings.map((opening, index) => {
              const team = teamById(state, opening.teamId);
              return (
                <button className={`queue-row ${opening.status}`} key={opening.id} type="button">
                  <span className="queue-rank">{String(index + 1).padStart(2, '0')}</span>
                  <TeamMark team={team} compact />
                  <span className="queue-copy"><strong>{team.name}</strong><small>{roleLabel(opening.role)}</small></span>
                  <CcrBadge tone={opening.status === 'new' ? 'new' : opening.status === 'active' ? 'gold' : opening.status === 'resolved' ? 'success' : 'neutral'}>{opening.status}</CcrBadge>
                </button>
              );
            })}
          </div>
          <footer className="queue-footer"><span>VACANCIES FIRST</span><span>SEEDED TIEBREAK</span></footer>
        </aside>

        <section className="detail-panel">
          {view === 'hiring' && <HiringView state={state} years={years} points={points} setYears={setYears} setPoints={setPoints} submitOffer={submitOffer} decide={decide} />}
          {view === 'new' && <OpeningList title="NEW OPENINGS" empty="No cascade openings have been revealed yet." state={state} openingIds={newOpenings.map((opening) => opening.id)} />}
          {view === 'filled' && <FilledView state={state} />}
        </section>
      </section>

      <footer className="action-bar">
        <div className="action-status"><span className="action-index">{turns.indexOf(state.turn) + 1}</span><div><Eyebrow>{turnLabels[state.turn]}</Eyebrow><strong aria-live="polite">{statusCopy}</strong></div></div>
        <div className="action-meta"><CcrBadge tone={reducedMotion ? 'warning' : 'neutral'}>{reducedMotion ? 'REDUCED MOTION' : 'EVENT MOTION ON'}</CcrBadge><span>{version}</span></div>
        <div className="action-buttons">
          {state.turn === 'school-offers' && <CcrButton tone="primary" onClick={submitOffer}>SUBMIT FINAL OFFER <span aria-hidden="true">›</span></CcrButton>}
          {state.turn === 'results' && !state.revealed && <CcrButton tone="primary" onClick={() => setRevealPhase('deliberating')}>REVEAL RESULTS <span aria-hidden="true">›</span></CcrButton>}
          {state.revealed && <CcrButton tone="primary" onClick={reset}>RESET FIXTURE <span aria-hidden="true">↻</span></CcrButton>}
        </div>
      </footer>

      {revealPhase !== 'idle' && <RevealStage phase={revealPhase} seasonYear={state.seasonYear} team={activeTeam} finalists={finalists} finalistTeams={finalists.map((coach) => teamById(state, coach.teamId))} selected={coachById(state, 'navarro')} priorTeam={teamById(state, 'louisiana-tech')} reducedMotion={reducedMotion} onAdvance={advanceReveal} />}
    </main>
  );
}

function StartAndPreflight({ mode, result, version, onSelect, onBegin }: {
  mode: 'start' | 'inspecting' | 'preflight';
  result: SavePreflightResult | null;
  version: string;
  onSelect: () => void;
  onBegin: () => void;
}) {
  const ready = result?.status === 'ready';
  const user = result?.users[0];
  const fileSize = result ? `${(result.file.sizeBytes / 1024 / 1024).toFixed(1)} MB` : '';
  return (
    <main className="launch-shell" data-theme="ccr" style={{ '--shell-background': `url(${shellBackground})` } as React.CSSProperties}>
      <header className="launch-header">
        <div className="brand-lockup"><span className="ccr-shield">CCR</span><div><Eyebrow>DYNASTY UTILITY</Eyebrow><strong>COACHING CAROUSEL REBUILT</strong></div></div>
        <div className="launch-version"><span className="status status-success" /><span>{version}</span></div>
      </header>

      <section className="launch-stage">
        <div className="launch-title">
          <Eyebrow>{result ? 'SAVE PREFLIGHT' : 'WELCOME TO THE CAROUSEL'}</Eyebrow>
          <h1>{result ? (ready ? 'DYNASTY READY' : 'ACTION REQUIRED') : 'BUILD YOUR COACHING MARKET'}</h1>
          <p>{result
            ? (ready ? 'Your National Championship week save passed the read-only compatibility gate.' : 'CCR found an issue that must be resolved before this carousel can begin.')
            : 'Select a College Football 27 dynasty save at CFP National Championship week. CCR will inspect it without changing the original file.'}</p>
        </div>

        {mode === 'inspecting' ? (
          <section className="inspection-card card" aria-live="polite">
            <span className="inspection-spinner loading loading-ring" />
            <div><Eyebrow>READ-ONLY INSPECTION</Eyebrow><h2>CHECKING YOUR DYNASTY</h2><p>Reading the checkpoint, coaching staff, user teams, and available carousel capacity…</p></div>
          </section>
        ) : result ? (
          <section className={`preflight-card card ${ready ? 'is-ready' : 'is-blocked'}`}>
            <header className="preflight-file">
              <div className={`preflight-emblem ${ready ? 'ready' : 'blocked'}`}>{ready ? '✓' : '!'}</div>
              <div><Eyebrow>SELECTED DYNASTY SAVE</Eyebrow><h2>{result.file.name}</h2><p>{result.file.path}</p></div>
              <div className="file-meta"><CcrBadge tone={ready ? 'success' : 'warning'}>{ready ? 'COMPATIBLE' : 'BLOCKED'}</CcrBadge><span>{fileSize}</span></div>
            </header>

            <div className="preflight-grid">
              <div className="preflight-stat"><span>CHECKPOINT</span><strong>{result.checkpoint.weekType === 'NationalChampionship' ? 'NATIONAL CHAMPIONSHIP' : (result.checkpoint.weekType ?? 'UNKNOWN')}</strong><small>Week {result.checkpoint.week ?? '—'} · {result.checkpoint.seasonYear ?? '—'}</small></div>
              <div className="preflight-stat"><span>SCHEMA</span><strong>{result.schema.detected ?? 'UNKNOWN'}</strong><small>Required {result.schema.expected}</small></div>
              <div className="preflight-stat"><span>OPENINGS</span><strong>{result.inventory.openings} / {result.inventory.openingCapacity}</strong><small>Active / available structure</small></div>
              <div className="preflight-stat"><span>COACH POOL</span><strong>{result.inventory.coaches}</strong><small>{result.inventory.userCoaches} user-controlled</small></div>
            </div>

            {user && (
              <section className="user-context" style={{ '--loaded-team-primary': user.team?.primaryColor ?? '#d7ad32', '--loaded-team-secondary': user.team?.secondaryColor ?? '#ffffff' } as React.CSSProperties}>
                <div className="user-team-mark">{user.team?.name.slice(0, 2).toUpperCase() ?? 'CC'}</div>
                <div><Eyebrow>PRIMARY USER CONTEXT</Eyebrow><h3>{user.team?.longName ?? 'Unassigned Team'}</h3><p>{user.name} · {user.role} · <CoachStanding prestige={user.prestige} level={user.level} age={user.age} /></p></div>
                <div className="user-records"><span><small>SEASON</small><strong>{user.seasonRecord}</strong></span><span><small>CAREER</small><strong>{user.careerRecord}</strong></span><span><small>CONTRACT</small><strong>{user.contractYearsRemaining ?? '—'} YRS</strong></span></div>
              </section>
            )}

            <div className="preflight-issues">
              {result.issues.map((item) => <div className={`preflight-issue ${item.severity}`} key={item.code}><span>{item.severity === 'blocking' ? '!' : item.severity === 'warning' ? '△' : '✓'}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></div>)}
            </div>

            <footer className="preflight-actions">
              <CcrButton tone="neutral" onClick={onSelect}>CHOOSE ANOTHER SAVE</CcrButton>
              {ready && <CcrButton tone="primary" onClick={onBegin}>INITIALIZE CAROUSEL ENGINE <span aria-hidden="true">›</span></CcrButton>}
            </footer>
          </section>
        ) : (
          <section className="select-save-card card">
            <div className="select-save-art"><span>27</span><i /></div>
            <div className="select-save-copy"><Eyebrow>STEP 1 OF 3</Eyebrow><h2>SELECT YOUR DYNASTY SAVE</h2><p>Use a save created during CFP National Championship week. Your original remains untouched throughout inspection.</p><div className="safety-points"><span>✓ READ ONLY</span><span>✓ SCHEMA CHECK</span><span>✓ CHECKPOINT CHECK</span><span>✓ USER TEAM DETECTION</span></div></div>
            <CcrButton tone="primary" onClick={onSelect}>SELECT DYNASTY SAVE <span aria-hidden="true">›</span></CcrButton>
          </section>
        )}
      </section>

      <footer className="launch-footer"><span>NO CHANGES ARE MADE DURING PREFLIGHT</span><span>CFB27 · WINDOWS x64</span></footer>
    </main>
  );
}

function MarketReady({ result, market, version, onBack, onEvaluate }: {
  result: SavePreflightResult;
  market: MarketBaseline;
  version: string;
  onBack: () => void;
  onEvaluate: () => void;
}) {
  return (
    <main className="launch-shell" data-theme="ccr" style={{ '--shell-background': `url(${shellBackground})` } as React.CSSProperties}>
      <header className="launch-header">
        <div className="brand-lockup"><span className="ccr-shield">CCR</span><div><Eyebrow>DYNASTY UTILITY</Eyebrow><strong>COACHING CAROUSEL REBUILT</strong></div></div>
        <div className="launch-version"><span className="status status-success" /><span>{version}</span></div>
      </header>
      <section className="launch-stage">
        <div className="launch-title"><Eyebrow>M3 · MARKET INITIALIZATION</Eyebrow><h1>ENGINE READY</h1><p>Your real dynasty landscape is loaded into deterministic engine state. Native staged results are retained only as reference evidence and have not been adopted as CCR decisions.</p></div>
        <section className="preflight-card card is-ready">
          <header className="preflight-file"><div className="preflight-emblem ready">✓</div><div><Eyebrow>INITIALIZED DYNASTY</Eyebrow><h2>{result.file.name}</h2><p>Seed {market.seed} · Source {market.sourceFingerprint.slice(0, 16)}</p></div><CcrBadge tone="success">429 SEATS VALID</CcrBadge></header>
          <div className="preflight-grid">
            <div className="preflight-stat"><span>PROGRAMS</span><strong>{market.teamCount}</strong><small>Three staff seats each</small></div>
            <div className="preflight-stat"><span>COACH POOL</span><strong>{market.coachCount}</strong><small>{market.userCoachIds.length} user-controlled</small></div>
            <div className="preflight-stat"><span>STAFF LANDSCAPE</span><strong>{market.seats.length}</strong><small>{market.invariants.uniqueIncumbentCount} unique incumbents</small></div>
            <div className="preflight-stat"><span>NATIVE EVIDENCE</span><strong>{market.nativeOutcomeEvidence.length}</strong><small>Staged openings retained for comparison</small></div>
          </div>
          <div className="preflight-issues"><div className="preflight-issue info"><span>✓</span><div><strong>DETERMINISTIC BASELINE LOCKED</strong><p>The same save and seed will recreate this exact baseline. No carousel outcomes have been generated and no save data was changed.</p></div></div></div>
          <footer className="preflight-actions"><CcrButton tone="neutral" onClick={onBack}>BACK TO PREFLIGHT</CcrButton><CcrButton tone="primary" onClick={onEvaluate}>RUN PART 1 EVALUATION <span aria-hidden="true">›</span></CcrButton></footer>
        </section>
      </section>
      <footer className="launch-footer"><span>REAL DYNASTY BASELINE · READ ONLY</span><span>PART 1 PERFORMANCE REVIEW NEXT</span></footer>
    </main>
  );
}

function EvaluationReady({ result, evaluation, version, onBack, onPlan }: {
  result: SavePreflightResult;
  evaluation: PartOneEvaluation;
  version: string;
  onBack: () => void;
  onPlan: () => void;
}) {
  const snapshot = result.snapshot!;
  const [filter, setFilter] = useState<JobEvaluationClassification | 'Grace'>('Fire');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'HC' | 'OC' | 'DC'>('ALL');
  const [conferenceFilter, setConferenceFilter] = useState('ALL');
  const classificationList = evaluation.evaluations.filter((item) => filter === 'Grace' ? item.graceBonus > 0 : item.classification === filter);
  const conferenceList = classificationList.filter((item) => {
    if (conferenceFilter === 'ALL') return true;
    const team = snapshot.teams.find((candidate) => candidate.id === item.teamId);
    return team?.conferenceId === conferenceFilter;
  });
  const actionList = conferenceList.filter((item) => roleFilter === 'ALL' || item.role === roleFilter);
  const roleCounts = {
    ALL: conferenceList.length,
    HC: conferenceList.filter((item) => item.role === 'HC').length,
    OC: conferenceList.filter((item) => item.role === 'OC').length,
    DC: conferenceList.filter((item) => item.role === 'DC').length
  };
  const conferenceOptions = snapshot.conferences.filter((conference) => conference.name.trim()).sort((left, right) => left.name.localeCompare(right.name));
  const secondaryFilterActive = roleFilter !== 'ALL' || conferenceFilter !== 'ALL';
  const graceProtected = evaluation.evaluations.filter((item) => item.graceBonus > 0).length;
  const listTitle = filter === 'Fire' ? 'STAFF ACTION LIST' : filter === 'Grace' ? 'NEW-HIRE GRACE LIST' : `${filter.toUpperCase()} COACHES`;
  const listEyebrow = filter === 'Fire' ? 'COMPLETE UNCONDITIONAL FIRING LIST' : filter === 'Grace' ? 'COACHES RECEIVING EVALUATION GRACE' : `COMPLETE ${filter.toUpperCase()} CLASSIFICATION`;
  return (
    <main className="launch-shell evaluation-shell" data-theme="ccr" style={{ '--shell-background': `url(${shellBackground})` } as React.CSSProperties}>
      <header className="launch-header">
        <div className="brand-lockup"><span className="ccr-shield">CCR</span><div><Eyebrow>DYNASTY UTILITY</Eyebrow><strong>COACHING CAROUSEL REBUILT</strong></div></div>
        <div className="launch-version"><span className="status status-success" /><span>{version}</span></div>
      </header>
      <section className="launch-stage evaluation-stage">
        <section className="preflight-card card is-ready evaluation-card">
          <header className="preflight-file evaluation-file-header">
            <div className="preflight-emblem ready">✓</div>
            <div className="evaluation-file-copy">
              <Eyebrow>M3 · PART 1 PERFORMANCE REVIEW</Eyebrow>
              <h1>STAFF EVALUATED</h1>
              <p>Every incumbent has an explainable 0–100 Job Evaluation Score. Low scores require independent failure signals before they become an unconditional firing recommendation.</p>
              <div className="evaluation-file-meta"><strong>{result.file.name}</strong><span>{evaluation.evaluations.length} staff seats · deterministic from the loaded save</span></div>
            </div>
            <CcrBadge tone="success">MODEL COMPLETE</CcrBadge>
          </header>
          <div className="preflight-grid evaluation-counts tabs" role="tablist" aria-label="Coach evaluation classifications">
            <button type="button" role="tab" aria-selected={filter === 'Fire'} className={`preflight-stat evaluation-filter-tab fire-stat ${filter === 'Fire' ? 'is-active' : ''}`} onClick={() => setFilter('Fire')}><span>FIRE</span><strong>{evaluation.counts.Fire}{filter === 'Fire' && <span className="evaluation-tab-arrow" aria-hidden="true">▼</span>}</strong><small>Two or more failure signals</small></button>
            <button type="button" role="tab" aria-selected={filter === 'Vulnerable'} className={`preflight-stat evaluation-filter-tab vulnerable-stat ${filter === 'Vulnerable' ? 'is-active' : ''}`} onClick={() => setFilter('Vulnerable')}><span>VULNERABLE</span><strong>{evaluation.counts.Vulnerable}{filter === 'Vulnerable' && <span className="evaluation-tab-arrow" aria-hidden="true">▼</span>}</strong><small>Eligible for Market Review</small></button>
            <button type="button" role="tab" aria-selected={filter === 'Secure'} className={`preflight-stat evaluation-filter-tab secure-stat ${filter === 'Secure' ? 'is-active' : ''}`} onClick={() => setFilter('Secure')}><span>SECURE</span><strong>{evaluation.counts.Secure}{filter === 'Secure' && <span className="evaluation-tab-arrow" aria-hidden="true">▼</span>}</strong><small>No school-led search</small></button>
            <button type="button" role="tab" aria-selected={filter === 'Grace'} className={`preflight-stat evaluation-filter-tab grace-stat ${filter === 'Grace' ? 'is-active' : ''}`} onClick={() => setFilter('Grace')}><span>NEW-HIRE GRACE</span><strong>{graceProtected}{filter === 'Grace' && <span className="evaluation-tab-arrow" aria-hidden="true">▼</span>}</strong><small>{evaluation.counts.catastrophic} catastrophic result(s)</small></button>
          </div>
          <section className="evaluation-watchlist">
            <header><div><Eyebrow>{listEyebrow}</Eyebrow><h3>{listTitle}</h3></div><span>{actionList.length}{secondaryFilterActive ? ` OF ${classificationList.length}` : ''} COACHES · INITIAL MODEL · CALIBRATION CONTINUES</span></header>
            <div className="evaluation-secondary-filters">
              <div className="evaluation-role-filters" role="group" aria-label="Filter Coaches by role">
                {(['ALL', 'HC', 'OC', 'DC'] as const).map((role) => <button type="button" className={roleFilter === role ? 'is-active' : ''} aria-pressed={roleFilter === role} onClick={() => setRoleFilter(role)} key={role}><span>{role}</span><strong>{roleCounts[role]}</strong></button>)}
              </div>
              <label className="evaluation-conference-filter"><span>CONFERENCE</span><select value={conferenceFilter} onChange={(event) => setConferenceFilter(event.target.value)}><option value="ALL">ALL CONFERENCES</option>{conferenceOptions.map((conference) => <option value={conference.id} key={conference.id}>{conference.name.toUpperCase()}</option>)}</select></label>
            </div>
            <div className="evaluation-list animate-list" key={`${filter}-${roleFilter}-${conferenceFilter}`} role="region" aria-label={`${listTitle} scrollable Coach list`} tabIndex={0} onKeyDown={scrollEvaluationListOnKeyDown}>
              {actionList.map((item, index) => {
                const coach = snapshot.coaches.find((candidate) => candidate.id === item.coachId)!;
                const team = snapshot.teams.find((candidate) => candidate.id === item.teamId)!;
                const isCoordinator = item.role !== 'HC';
                const unitName = item.role === 'OC' ? 'OFFENSE' : 'DEFENSE';
                const unitRank = item.role === 'OC' ? team.performance.offensiveRank : team.performance.defensiveRank;
                const unitRating = item.role === 'OC' ? team.ratings.offense : team.ratings.defense;
                const earned = coach.contractPerformance.earnedPoints[0];
                const expected = team.performance.expectedContractPoints[0];
                return <article className={`evaluation-row classification-${item.classification.toLowerCase()}`} key={item.seatId} style={{ '--evaluation-team-color': team.colors[0], '--evaluation-delay': `${Math.min(index, 18) * 55}ms` } as React.CSSProperties}>
                  <NormalizedCoachHead coach={coach} team={team} size="large" />
                  <div className="evaluation-person"><Eyebrow>{roleLabel(item.role)} · {team.longName}</Eyebrow><strong>{coach.name}</strong><span>{snapshot.seasonYear} {team.currentRecord.wins}-{team.currentRecord.losses} · Career {coach.resume.career.wins}-{coach.resume.career.losses} · <CoachStanding prestige={coach.prestige} level={coach.level} age={coach.age} /></span></div>
                  <div className="evaluation-evidence">
                    <div><small>{isCoordinator ? `${unitName} PERFORMANCE` : 'PROGRAM PERFORMANCE'}</small><strong>{isCoordinator ? (unitRank === null ? 'UNRANKED' : `#${unitRank + 1} · ${unitRating ?? '—'} OVR`) : `${team.currentRecord.wins}-${team.currentRecord.losses} · ${team.ratings.overall ?? '—'} OVR`}</strong><span>{isCoordinator ? item.components.find((component) => component.id === 'unit-performance')?.detail : item.components.find((component) => component.id === 'program-season')?.detail}</span></div>
                    <div><small>CONTRACT EXPECTATION</small><strong>{earned ?? '—'} / {expected ?? '—'} PTS</strong><span>{item.components.find((component) => component.id === (item.role === 'HC' ? 'contract-current' : 'team-contract'))?.detail}</span></div>
                    <div><small>JOB SECURITY</small><strong>{coach.jobSecurity.status || 'UNKNOWN'} · {coach.jobSecurity.percentage ?? '—'}%</strong><span>{coach.seasonsWithTeam ?? 0} seasons with Team{item.graceBonus ? ` · +${item.graceBonus} grace` : ''}</span></div>
                  </div>
                  <div className="evaluation-result">
                    <div className="evaluation-score"><small>JOB SCORE</small><strong>{item.score}</strong><span>OF 100</span></div>
                    <CcrBadge tone={item.classification === 'Fire' ? 'warning' : item.classification === 'Vulnerable' ? 'gold' : 'success'}>{item.classification}</CcrBadge>
                  </div>
                  <div className="evaluation-reasons"><small>PRIMARY FAILURE SIGNALS</small><span>{item.failureSignals.length ? item.failureSignals.map((signal) => signal.label).join(' · ') : 'No unconditional failure signal'}</span></div>
                </article>;
              })}
            </div>
          </section>
        </section>
        <footer className="evaluation-page-actions"><CcrButton tone="neutral" onClick={onBack}>BACK TO ENGINE BASELINE</CcrButton><CcrButton tone="primary" onClick={onPlan}>RUN PART 1 DEPARTURES <span aria-hidden="true">›</span></CcrButton></footer>
      </section>
      <footer className="launch-footer"><span>PART 1 PERFORMANCE MODEL · READ ONLY</span><span>NFL DEPARTURES + RETIREMENTS + EVENTS NEXT</span></footer>
    </main>
  );
}

function PartOneDeparturesReady({ result, departures, performance, events, version, reviewComplete, onBack, onBegin, onScenarioDecision, onPerformanceDecision }: {
  result: SavePreflightResult;
  departures: DeparturePlan;
  performance: PerformancePlan;
  events: PartOneUiEvent[];
  version: string;
  reviewComplete: boolean;
  onBack: () => void;
  onBegin: () => void;
  onScenarioDecision: (scenarioId: string, choice: UnexpectedScenarioDecision) => void;
  onPerformanceDecision: (decisionId: string, choice: PerformanceDecisionChoice) => void;
}) {
  const snapshot = result.snapshot!;
  const [activeKind, setActiveKind] = useState<PartOneEventKind>(() => (
    (['NFL', 'RETIREMENT', 'SCENARIO', 'PERFORMANCE'] as PartOneEventKind[]).find((kind) => events.some((event) => event.kind === kind)) ?? 'NFL'
  ));
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'HC' | 'OC' | 'DC'>('ALL');
  const [conferenceFilter, setConferenceFilter] = useState('ALL');
  const pendingCount = departures.unexpectedScenarios.pendingDecisions.length + performance.pendingDecisions.length;
  const teamsById = new Map(snapshot.teams.map((team) => [team.id, team]));
  const coachesById = new Map(snapshot.coaches.map((coach) => [coach.id, coach]));
  const eventTabs: Array<{ kind: PartOneEventKind; label: string; caption: string }> = [
    { kind: 'NFL', label: 'NFL', caption: 'Pro departures' },
    { kind: 'RETIREMENT', label: 'RETIREMENTS', caption: 'Coaches stepping away' },
    { kind: 'SCENARIO', label: 'UNEXPECTED', caption: 'Fictional simulated events' },
    { kind: 'PERFORMANCE', label: 'PERFORMANCE', caption: 'School staff actions' }
  ];
  const roleForEvent = (event: PartOneUiEvent) => {
    const role = coachesById.get(event.coachIds[0]!)?.role;
    return role === 'HeadCoach' ? 'HC' : role === 'OffensiveCoordinator' ? 'OC' : 'DC';
  };
  const tabEvents = events.filter((event) => event.kind === activeKind);
  const roleCounts = Object.fromEntries(['ALL', 'HC', 'OC', 'DC'].map((role) => [role, role === 'ALL' ? tabEvents.length : tabEvents.filter((event) => roleForEvent(event) === role).length])) as Record<'ALL' | 'HC' | 'OC' | 'DC', number>;
  const visibleEvents = tabEvents.filter((event) => {
    const team = teamsById.get(event.teamId)!;
    return (roleFilter === 'ALL' || roleForEvent(event) === roleFilter)
      && (conferenceFilter === 'ALL' || team.conferenceId === conferenceFilter);
  });
  const conferences = snapshot.conferences.filter((conference) => events.some((event) => teamsById.get(event.teamId)?.conferenceId === conference.id));
  const activeTab = eventTabs.find((tab) => tab.kind === activeKind)!;
  const chooseTab = (kind: PartOneEventKind) => { setActiveKind(kind); setRoleFilter('ALL'); setConferenceFilter('ALL'); };
  return (
    <main className="launch-shell part-one-shell" data-theme="ccr" style={{ '--shell-background': `url(${shellBackground})` } as React.CSSProperties}>
      <header className="launch-header">
        <div className="brand-lockup"><span className="ccr-shield">CCR</span><div><Eyebrow>DYNASTY UTILITY</Eyebrow><strong>COACHING CAROUSEL REBUILT</strong></div></div>
        <div className="launch-version"><span className="status status-success" /><span>{version}</span></div>
      </header>
      <section className="launch-stage part-one-stage">
        <section className="preflight-card card is-ready part-one-card">
          <header className="preflight-file part-one-file-header">
            <div className="preflight-emblem ready">✓</div>
            <div className="evaluation-file-copy"><Eyebrow>M3 · PART 1 MARKET FORMATION</Eyebrow><h1>DEPARTURES PLANNED</h1><p>Seeded NFL departures, retirements, Unexpected Scenarios, and evidence-gated performance actions are locked to this save and run seed.</p><div className="evaluation-file-meta"><strong>{result.file.name}</strong><span>Seed {departures.seed}</span></div></div>
            <CcrBadge tone={pendingCount ? 'warning' : reviewComplete ? 'success' : 'gold'}>{pendingCount ? `${pendingCount} DECISION${pendingCount === 1 ? '' : 'S'}` : reviewComplete ? 'REVIEWED' : `${events.length} EVENTS`}</CcrBadge>
          </header>
          <div className="preflight-grid evaluation-counts part-one-counts tabs" role="tablist" aria-label="Part 1 departure categories">
            {eventTabs.map((tab) => <button type="button" role="tab" aria-selected={activeKind === tab.kind} className={`preflight-stat evaluation-filter-tab departure-filter-tab departure-${tab.kind.toLowerCase()} ${activeKind === tab.kind ? 'is-active' : ''}`} key={tab.kind} onClick={() => chooseTab(tab.kind)}><span>{tab.label}</span><strong>{events.filter((event) => event.kind === tab.kind).length}{activeKind === tab.kind && <span className="evaluation-tab-arrow" aria-hidden="true">▼</span>}</strong><small>{tab.caption}</small></button>)}
          </div>
          <section className="part-one-manifest">
            {pendingCount > 0 && <div className="part-one-decisions">
              <header><Eyebrow>USER CONTROL</Eyebrow><h2>DECISIONS REQUIRED</h2></header>
              {departures.unexpectedScenarios.pendingDecisions.map((decision) => {
                const outcome = departures.unexpectedScenarios.outcomes.find((item) => item.id === decision.scenarioId)!;
                const team = teamsById.get(decision.teamId)!;
                const coach = coachesById.get(decision.userCoachId)!;
                return <article className="part-one-decision" key={decision.id}><NormalizedCoachHead coach={coach} team={team} size="medium" /><div><Eyebrow>FICTIONAL UNEXPECTED SCENARIO</Eyebrow><strong>{scenarioLabel(outcome.category)}</strong><p>{coach.name} and {team.longName} are affected. Accept the simulated event or use user-HC protection to consume it without rerolling.</p></div><div><CcrButton tone="neutral" onClick={() => onScenarioDecision(outcome.id, 'nullify')}>NULLIFY</CcrButton><CcrButton tone="danger" onClick={() => onScenarioDecision(outcome.id, 'accept')}>ACCEPT EVENT</CcrButton></div></article>;
              })}
              {performance.pendingDecisions.map((decision) => {
                const team = teamsById.get(decision.teamId)!;
                const coach = coachesById.get(decision.coachId)!;
                return <article className="part-one-decision" key={decision.id}><NormalizedCoachHead coach={coach} team={team} size="medium" /><div><Eyebrow>{decision.kind === 'ConfirmUserHcFiring' ? 'USER HEAD COACH PROTECTION' : 'USER STAFF DECISION'}</Eyebrow><strong>{coach.name} · {normalizedRoleLabel(coach.role)}</strong><p>The model recommends dismissal. Retaining the Coach records a visible override and does not reroll another firing.</p></div><div><CcrButton tone="neutral" onClick={() => onPerformanceDecision(decision.id, 'retain')}>RETAIN</CcrButton><CcrButton tone="danger" onClick={() => onPerformanceDecision(decision.id, 'dismiss')}>DISMISS</CcrButton></div></article>;
              })}
            </div>}
            <header className="part-one-manifest-header"><div><Eyebrow>{activeTab.caption}</Eyebrow><h2>{activeTab.label} DEPARTURE LIST</h2></div><span>{visibleEvents.length} SHOWN · {events.length} TOTAL PRESENTATION EVENTS</span></header>
            <div className="evaluation-secondary-filters departure-secondary-filters">
              <div className="evaluation-role-filters" aria-label="Filter departures by role">{(['ALL', 'HC', 'OC', 'DC'] as const).map((role) => <button type="button" className={roleFilter === role ? 'is-active' : ''} key={role} onClick={() => setRoleFilter(role)}><strong>{role}</strong><span>{roleCounts[role]}</span></button>)}</div>
              <label className="evaluation-conference-filter">CONFERENCE<select value={conferenceFilter} onChange={(event) => setConferenceFilter(event.target.value)}><option value="ALL">ALL CONFERENCES</option>{conferences.map((conference) => <option value={conference.id} key={conference.id}>{conference.name}</option>)}</select></label>
            </div>
            <div className="evaluation-list departure-card-list animate-list" key={`${activeKind}:${roleFilter}:${conferenceFilter}`} tabIndex={0} onKeyDown={scrollEvaluationListOnKeyDown}>
              {visibleEvents.map((event, index) => <DepartureCoachCard event={event} snapshot={snapshot} index={index} key={event.id} />)}
              {visibleEvents.length === 0 && <div className="empty-state departure-empty"><span>0</span><p>No {activeTab.label.toLowerCase()} events match these filters.</p></div>}
            </div>
          </section>
        </section>
        <footer className="evaluation-page-actions"><CcrButton tone="neutral" onClick={onBack}>BACK TO STAFF REVIEW</CcrButton><CcrButton tone="primary" disabled={pendingCount > 0} onClick={onBegin}>{reviewComplete ? 'REPLAY EVENT REVIEW' : 'BEGIN EVENT REVIEW'} <span aria-hidden="true">›</span></CcrButton></footer>
      </section>
      <footer className="launch-footer"><span>PART 1 DEPARTURE LEDGER · READ ONLY</span><span>{pendingCount ? 'USER DECISIONS REQUIRED' : reviewComplete ? 'CONTRACT DECISIONS NEXT' : 'SPACE OR ADVANCE · SKIP AVAILABLE'}</span></footer>
    </main>
  );
}

function DepartureCoachCard({ event, snapshot, index }: { event: PartOneUiEvent; snapshot: DynastySnapshot; index: number }) {
  const team = snapshot.teams.find((candidate) => candidate.id === event.teamId)!;
  const coach = snapshot.coaches.find((candidate) => candidate.id === event.coachIds[0]!)!;
  const role = coach.role === 'HeadCoach' ? 'HC' : coach.role === 'OffensiveCoordinator' ? 'OC' : 'DC';
  const contractYears = coach.contract.yearsRemaining;
  const contractValue = event.kind === 'PERFORMANCE' ? 'BUYOUT PENDING' : 'NO BUYOUT';
  const contractDetail = event.kind === 'PERFORMANCE'
    ? `${contractYears ?? 'Unknown'} contract year${contractYears === 1 ? '' : 's'} remaining`
    : event.kind === 'SCENARIO' && event.result === 'AVAILABLE COACH' ? 'Voluntary resignation' : 'Non-dismissal departure';
  const consequence = event.coachIds.length > 1 ? 'CLEANS HOUSE' : role === 'HC' ? 'SUCCESSION REVIEW' : `${role} VACANCY`;
  const consequenceDetail = event.coachIds.length > 1 ? `${event.coachIds.length} staff seats affected` : 'One position opens';
  const kindCode = event.kind === 'RETIREMENT' ? 'RET' : event.kind === 'PERFORMANCE' ? 'ACT' : event.kind === 'SCENARIO' ? 'EVT' : 'NFL';
  const departureType = event.kind === 'NFL' ? 'NFL DEPARTURE'
    : event.kind === 'RETIREMENT' ? event.eyebrow
    : event.kind === 'SCENARIO' ? event.title
    : 'PERFORMANCE ACTION';
  return <article className={`evaluation-row departure-coach-card departure-card-${event.kind.toLowerCase()}`} style={{ '--evaluation-team-color': team.colors[0], '--evaluation-delay': `${Math.min(index, 18) * 55}ms` } as React.CSSProperties}>
    <NormalizedCoachHead coach={coach} team={team} size="large" />
    <div className="evaluation-person"><Eyebrow>{normalizedRoleLabel(coach.role)} · {team.longName}</Eyebrow><strong>{coach.name}</strong><span>{snapshot.seasonYear} {team.currentRecord.wins}-{team.currentRecord.losses} · Career {coach.resume.career.wins}-{coach.resume.career.losses} · <CoachStanding prestige={coach.prestige} level={coach.level} age={coach.age} /></span></div>
    <div className="evaluation-evidence departure-evidence"><div><small>DEPARTURE TYPE</small><strong>{departureType}</strong><span>{event.fictional ? 'CCR fictional simulation' : 'Seeded Part 1 outcome'}</span></div><div><small>CONTRACT IMPACT</small><strong>{contractValue}</strong><span>{contractDetail}</span></div><div><small>STAFF CONSEQUENCE</small><strong>{consequence}</strong><span>{consequenceDetail}</span></div></div>
    <div className="evaluation-reasons departure-reason"><small>EVENT OUTCOME</small><span>{event.detail}</span></div>
    <div className="evaluation-result departure-card-result"><div className="evaluation-score"><small>EVENT</small><strong>{kindCode}</strong><span>{String(index + 1).padStart(2, '0')}</span></div><CcrBadge tone={event.tone}>{event.result}</CcrBadge></div>
  </article>;
}

function PartOneEventStage({ event, index, total, snapshot, reducedMotion, onAdvance, onSkip }: {
  event: PartOneUiEvent;
  index: number;
  total: number;
  snapshot: DynastySnapshot;
  reducedMotion: boolean;
  onAdvance: () => void;
  onSkip: () => void;
}) {
  const team = snapshot.teams.find((candidate) => candidate.id === event.teamId)!;
  const coaches = event.coachIds.map((id) => snapshot.coaches.find((candidate) => candidate.id === id)!).filter(Boolean);
  const primary = coaches[0]!;
  const isIndividualChange = coaches.length === 1;
  return (
    <section className={`event-stage part-one-event-stage event-${event.kind.toLowerCase()} ${reducedMotion ? 'event-reduced' : ''}`} role="dialog" aria-modal="true" aria-label={`Part 1 event ${index + 1} of ${total}`} style={{ '--team-primary': team.colors[0], '--team-secondary': team.colors[1] } as React.CSSProperties}>
      <div className="event-backdrop-art"><NormalizedTeamArt team={team} /></div>
      <header className="event-header"><div><Eyebrow>{event.eyebrow}</Eyebrow><strong>{event.title}</strong></div><div className="event-progress"><span>{index + 1}</span><i /><span>{total}</span></div></header>
      <div className="event-body part-one-event-body">
        <div className="event-team-lockup"><NormalizedTeamMark team={team} variant="threeDimensional" /><span><Eyebrow>{team.conferenceId ? snapshot.conferences.find((conference) => conference.id === team.conferenceId)?.name ?? 'PROGRAM' : 'PROGRAM'}</Eyebrow><strong>{team.longName}</strong></span></div>
        <article className="departure-reveal-card">
          <NormalizedCoachHead coach={primary} team={team} size="large" />
          <div className="departure-reveal-copy"><Eyebrow>{normalizedRoleLabel(primary.role)} · <CoachStanding prestige={primary.prestige} level={primary.level} age={primary.age} compact /></Eyebrow><h2>{primary.name}</h2><p>{snapshot.seasonYear} {team.currentRecord.wins}-{team.currentRecord.losses} · Career {primary.resume.career.wins}-{primary.resume.career.losses}</p>{!isIndividualChange && <div className="departure-result"><CcrBadge tone={event.tone}>{event.result}</CcrBadge><span>{event.detail}</span></div>}</div>
          <NormalizedTeamMark team={team} />
        </article>
        {isIndividualChange && <div className="departure-result departure-result-detached"><CcrBadge tone={event.tone}>{event.result}</CcrBadge><span>{event.detail}</span></div>}
        {coaches.length > 1 && <div className="departure-supporting"><Eyebrow>ADDITIONAL STAFF AFFECTED</Eyebrow>{coaches.slice(1).map((coach) => <span key={coach.id}><NormalizedCoachHead coach={coach} team={team} size="small" /><strong>{coach.name}</strong><small><em>{normalizedRoleLabel(coach.role)} · STAFF NOT RETAINED</em><CoachStanding prestige={coach.prestige} level={coach.level} age={coach.age} compact /></small></span>)}</div>}
        {event.fictional && <div className="departure-fiction-notice">FICTIONAL SIMULATION EVENT · NOT NATIVE DYNASTY HISTORY</div>}
      </div>
      <footer className="event-footer"><span>{reducedMotion ? 'REDUCED-MOTION REVEAL · PRESS SPACE TO ADVANCE' : 'PRESS SPACE TO ADVANCE'}</span><div><CcrButton tone="ghost" onClick={onSkip}>SKIP REMAINING</CcrButton><CcrButton tone="ghost" onClick={onAdvance}>{index + 1 === total ? 'ADVANCE · COMPLETE REVIEW' : 'ADVANCE · NEXT EVENT'} <span aria-hidden="true">›</span></CcrButton></div></footer>
    </section>
  );
}

function HiringView({ state, years, points, setYears, setPoints, submitOffer, decide }: {
  state: CarouselState;
  years: number;
  points: number;
  setYears: (value: number) => void;
  setPoints: (value: number) => void;
  submitOffer: () => void;
  decide: (decision: 'accept' | 'reject') => void;
}) {
  const opening = state.openings.find((item) => item.id === 'louisville-hc')!;
  const team = teamById(state, opening.teamId);
  const coach = coachById(state, 'navarro');
  const otherFinalists = [coachById(state, 'reed'), coachById(state, 'grant')];
  const currentTeam = teamById(state, coach.teamId);
  const userCoach = coachById(state, 'price');
  const userCoachTeam = teamById(state, userCoach.teamId);
  const offerTeam = teamById(state, 'air-force');

  return (
    <>
      <header className="team-hero">
        <div className="hero-art"><TeamArt team={team} /></div>
        <div className="hero-copy">
          <div className="hero-kicker"><CcrBadge tone="gold">NOW HIRING</CcrBadge><span>HEAD COACH</span></div>
          <h1>{team.name}</h1>
          <p>{opening.reason}</p>
        </div>
        <div className="hero-conference"><ConferenceMark conferenceKey={team.conferenceKey} label={team.conferenceName} /><span>{team.conferenceName}</span></div>
        <div className="hero-stats stats">
          <div className="stat"><span className="stat-title">{state.seasonYear}</span><strong className="stat-value">{team.lastSeasonRecord}</strong></div>
          <div className="stat"><span className="stat-title">NATIONAL</span><strong className="stat-value">{team.nationalRanking ? `#${team.nationalRanking}` : 'NR'}</strong></div>
          <div className="stat"><span className="stat-title">PRESTIGE</span><strong className="stat-value">{team.prestige}</strong></div>
        </div>
      </header>

      <ul className="turn-stepper steps" aria-label="Round progress">
        {turns.map((turn, index) => {
          const activeIndex = turns.indexOf(state.turn);
          return <li className={`step ${index <= activeIndex ? 'step-primary' : ''} ${state.turn === turn ? 'current' : ''}`} key={turn}>{turnLabels[turn]}</li>;
        })}
      </ul>

      {state.turn === 'school-offers' && (
        <section className="story-card card">
          <header className="story-header"><div><Eyebrow>USER SCHOOL DECISION</Eyebrow><h2>SUBMIT A FINAL OFFER</h2></div><CcrBadge tone="warning">FINAL OFFER</CcrBadge></header>
          <div className="candidate-feature">
            <CoachHead coach={coach} team={currentTeam} size="large" />
            <div className="candidate-identity"><Eyebrow>PRIMARY TARGET</Eyebrow><h3>{coach.name}</h3><p>{roleLabel(coach.role)} · {currentTeam.name}</p><p className="coach-records">{state.seasonYear} {coach.lastSeasonRecord} · CAREER {coach.careerRecord}</p><div className="candidate-tags"><CcrBadge tone="gold"><CoachStanding prestige={coach.prestige} level={coach.level} age={coach.age} compact /></CcrBadge><CcrBadge>FIRST HC OPPORTUNITY</CcrBadge></div></div>
            <div className="score-grid stats">
              <div className="stat"><span className="stat-title">SCHOOL INTEREST</span><strong className="stat-value">84</strong><span className="stat-desc">STRONG MATCH</span></div>
              <div className="stat"><span className="stat-title">COACH INTEREST</span><strong className="stat-value">77</strong><span className="stat-desc">INTERESTED</span></div>
            </div>
          </div>
          <div className="shortlist-row">
            <Eyebrow>FINAL SHORTLIST</Eyebrow>
            {otherFinalists.map((finalist) => <div className="shortlist-coach" key={finalist.id}><CoachHead coach={finalist} team={teamById(state, finalist.teamId)} size="small" /><span><strong>{finalist.name}</strong><small>{roleLabel(finalist.role)} · {teamById(state, finalist.teamId).name}</small><small className="shortlist-record">{state.seasonYear} {finalist.lastSeasonRecord} · CAREER {finalist.careerRecord}</small></span><CcrBadge><CoachStanding prestige={finalist.prestige} level={finalist.level} age={finalist.age} compact /></CcrBadge></div>)}
          </div>
          <div className="reason alert"><span className="reason-icon">FIT</span><p>Elite unit production, first-time head-coach readiness, and strong scheme fit make Navarro the leading realistic target.</p></div>
          <div className="offer-form">
            <label><span>CONTRACT YEARS</span><input className="input" type="number" min="1" max="5" value={years} onChange={(event) => setYears(Number(event.target.value))} /></label>
            <label><span>STAFF OFFER PROGRAM POINTS</span><input className="input" type="number" min="0" max="300" value={points} onChange={(event) => setPoints(Number(event.target.value))} /></label>
            <div className="offer-reserve"><Eyebrow>AVAILABLE AFTER OFFER</Eyebrow><strong>{420 - points} POINTS</strong></div>
            <CcrButton tone="primary" onClick={submitOffer}>SUBMIT FINAL OFFER <span aria-hidden="true">›</span></CcrButton>
          </div>
        </section>
      )}

      {state.turn === 'coach-decisions' && (
        <section className="story-card card">
          <header className="story-header"><div><Eyebrow>USER COACH DECISION</Eyebrow><h2>{userCoach.name.toUpperCase()} HAS AN OFFER</h2></div><CcrBadge tone="new">ACTION REQUIRED</CcrBadge></header>
          <div className="coach-decision-profile"><CoachHead coach={userCoach} team={userCoachTeam} size="large" /><div><Eyebrow>YOUR COACH</Eyebrow><h3>{userCoach.name}</h3><p>{state.seasonYear} {userCoach.lastSeasonRecord} · Career {userCoach.careerRecord} · <CoachStanding prestige={userCoach.prestige} level={userCoach.level} age={userCoach.age} /></p></div></div>
          <div className="decision-grid">
            <div className="decision-option"><TeamMark team={userCoachTeam} variant="secondary" /><span><Eyebrow>CURRENT POSITION</Eyebrow><strong>{userCoachTeam.name} HC</strong><p>Remain after a {userCoach.lastSeasonRecord} season</p></span></div>
            <div className="decision-option offer-highlight"><TeamMark team={offerTeam} variant="threeDimensional" /><span><Eyebrow>NEW OFFER</Eyebrow><strong>{offerTeam.name} HC</strong><p>4 years · 145 program points</p></span></div>
          </div>
          <div className="reason alert"><span className="reason-icon">WHY</span><p>Higher program ceiling and stronger contract value compete with current-school loyalty and stability.</p></div>
          <div className="decision-actions"><CcrButton tone="neutral" onClick={() => decide('reject')}>REJECT & REMAIN</CcrButton><CcrButton tone="primary" onClick={() => decide('accept')}>ACCEPT OFFER <span aria-hidden="true">›</span></CcrButton></div>
        </section>
      )}

      {state.turn === 'results' && (
        <section className="story-card results-card card">
          <header className="story-header"><div><Eyebrow>SIMULTANEOUS RESULTS</Eyebrow><h2>{state.revealed ? 'ROUND RESULTS REVEALED' : 'DECISIONS ARE LOCKED'}</h2></div><CcrBadge tone={state.revealed ? 'success' : 'gold'}>{state.revealed ? 'COMPLETE' : 'READY'}</CcrBadge></header>
          {state.revealed ? (
            <div className="result-list">
              <div className="result-row"><CoachHead coach={coach} team={team} size="medium" /><div><strong>{coach.name} accepts the {team.name} HC job.</strong><p>His departure creates a new Louisiana Tech OC vacancy.</p></div><CcrBadge tone="success">HIRED</CcrBadge></div>
              <div className="result-row"><CoachHead coach={userCoach} team={state.userCoachDecision === 'accept' ? offerTeam : userCoachTeam} size="medium" /><div><strong>{userCoach.name} {state.userCoachDecision === 'accept' ? `accepts the ${offerTeam.name} HC job.` : `remains at ${userCoachTeam.name}.`}</strong><p>{state.userCoachDecision === 'accept' ? 'Alabama now enters the next HC offer queue.' : 'Air Force remains open for the next round.'}</p></div><CcrBadge tone={state.userCoachDecision === 'accept' ? 'success' : 'neutral'}>{state.userCoachDecision === 'accept' ? 'HIRED' : 'RETAINED'}</CcrBadge></div>
            </div>
          ) : <div className="locked-results"><span className="lock-emblem">CCR</span><div><h3>THE MARKET HAS DECIDED</h3><p>Reveal the round to see accepted offers and the next wave of vacancies.</p></div></div>}
        </section>
      )}
    </>
  );
}

function OpeningList({ title, empty, state, openingIds }: { title: string; empty: string; state: CarouselState; openingIds: string[] }) {
  const openings = openingIds.map((id) => state.openings.find((opening) => opening.id === id)!).filter(Boolean);
  return (
    <section className="list-panel card">
      <header className="story-header"><div><Eyebrow>LATEST CASCADE</Eyebrow><h2>{title}</h2></div><CcrBadge tone="new">{openings.length} NEW</CcrBadge></header>
      {openings.length === 0 ? <div className="empty-state"><span>00</span><p>{empty}</p></div> : <div className="result-list">{openings.map((opening) => {
        const team = teamById(state, opening.teamId);
        return <div className="result-row" key={opening.id}><TeamMark team={team} /><div><strong>{team.name} {roleLabel(opening.role)}</strong><p>{opening.reason}</p></div><CcrBadge tone="new">NEW</CcrBadge></div>;
      })}</div>}
    </section>
  );
}

function FilledView({ state }: { state: CarouselState }) {
  return (
    <section className="list-panel card">
      <header className="story-header"><div><Eyebrow>ROUND {state.round}</Eyebrow><h2>FILLED POSITIONS</h2></div><CcrBadge tone="success">{state.filled.length} FILLED</CcrBadge></header>
      {state.filled.length === 0 ? <div className="empty-state"><span>00</span><p>No positions have been revealed as filled.</p></div> : <div className="result-list">{state.filled.map((filled) => {
        const opening = state.openings.find((item) => item.id === filled.openingId)!;
        const team = teamById(state, opening.teamId);
        const coach = coachById(state, filled.coachId);
        const prior = teamById(state, filled.priorTeamId);
        return <div className="result-row" key={filled.openingId}><CoachHead coach={coach} team={team} size="medium" /><div><strong>{team.name} {opening.role}: {coach.name}</strong><p>Hired from {prior.name} · Career {coach.careerRecord} · <CoachStanding prestige={coach.prestige} level={coach.level} age={coach.age} /></p></div><TeamMark team={team} compact /></div>;
      })}</div>}
    </section>
  );
}

function RevealStage({ phase, seasonYear, team, finalists, finalistTeams, selected, priorTeam, reducedMotion, onAdvance }: {
  phase: Exclude<RevealPhase, 'idle'>;
  seasonYear: number;
  team: Team;
  finalists: Coach[];
  finalistTeams: Team[];
  selected: Coach;
  priorTeam: Team;
  reducedMotion: boolean;
  onAdvance: () => void;
}) {
  const phaseNumber = phase === 'deliberating' ? 1 : phase === 'selected' ? 2 : 3;
  const advanceLabel = phase === 'deliberating' ? 'ADVANCE · REVEAL SELECTION' : phase === 'selected' ? 'ADVANCE · SHOW NEW OPENING' : 'ADVANCE · CONTINUE';
  return (
    <section className={`event-stage event-${phase} ${reducedMotion ? 'event-reduced' : ''}`} role="dialog" aria-modal="true" aria-label="Coaching carousel result reveal">
      <div className="event-backdrop-art"><TeamArt team={team} /></div>
      <header className="event-header"><div><Eyebrow>LOUISVILLE · HEAD COACH SEARCH</Eyebrow><strong>{phase === 'deliberating' ? 'THE SCHOOL IS REVIEWING ITS FINALISTS' : phase === 'selected' ? 'THE DECISION IS IN' : 'THE CAROUSEL CONTINUES'}</strong></div><div className="event-progress"><span>{phaseNumber}</span><i /><span>3</span></div></header>
      <div className="event-body">
        {phase !== 'cascade' ? (
          <>
            <div className="event-team-lockup"><TeamMark team={team} variant="threeDimensional" /><span><Eyebrow>OPEN POSITION</Eyebrow><strong>{team.name} Head Coach</strong></span></div>
            <div className="finalist-stage">
              {finalists.map((coach, index) => (
                <article className={`finalist-card ${coach.id === selected.id ? 'winner' : ''}`} style={{ '--candidate-index': index } as React.CSSProperties} key={coach.id}>
                  <CoachHead coach={coach} team={coach.id === selected.id && phase === 'selected' ? team : finalistTeams[index]!} size="large" />
                  <div><Eyebrow>{coach.role} FINALIST</Eyebrow><h3>{coach.name}</h3><p>{seasonYear} {coach.lastSeasonRecord} · Career {coach.careerRecord} · <CoachStanding prestige={coach.prestige} level={coach.level} age={coach.age} /></p></div>
                  {phase === 'selected' && <CcrBadge tone={coach.id === selected.id ? 'success' : 'neutral'}>{coach.id === selected.id ? 'SELECTED' : 'NOT SELECTED'}</CcrBadge>}
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="cascade-stage">
            <div className="cascade-role-chain">
              <div className="cascade-node new-role-node"><TeamMark team={team} /><span><Eyebrow>NEW ROLE</Eyebrow><strong>{team.name} HC</strong></span></div>
              <div className="cascade-vertical-arrow" aria-hidden="true" />
              <div className="cascade-node departure-node"><TeamMark team={priorTeam} /><span><Eyebrow>DEPARTURE</Eyebrow><strong>{priorTeam.name} OC</strong></span></div>
            </div>
            <div className="cascade-arrow"><CoachHead coach={selected} team={team} size="large" /><strong>{selected.name}</strong><span>ACCEPTS {team.name.toUpperCase()} HC</span></div>
            <div className="cascade-node new-node cascade-new-opening"><TeamMark team={priorTeam} /><span><Eyebrow>NEW OPENING</Eyebrow><strong>{priorTeam.name} OC</strong><small>ADDED TO OFFER QUEUE</small></span></div>
          </div>
        )}
      </div>
      <footer className="event-footer"><span>{reducedMotion ? 'REDUCED-MOTION REVEAL · PRESS SPACE TO ADVANCE' : 'PRESS SPACE TO ADVANCE'}</span><CcrButton tone="ghost" onClick={onAdvance}>{advanceLabel} <span aria-hidden="true">›</span></CcrButton></footer>
    </section>
  );
}
