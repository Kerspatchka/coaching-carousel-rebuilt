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
import { initializeMarket, type MarketBaseline } from '../core/market';
import { evaluatePartOne, type JobEvaluationClassification, type PartOneEvaluation } from '../core/evaluation';
import '../shared/desktop-api';
import type { SavePreflightResult } from '../shared/desktop-api';
import { shellBackground } from './assets/assetCatalog';
import { CcrBadge, CcrButton, CoachHead, ConferenceMark, Eyebrow, NormalizedCoachHead, TeamArt, TeamMark } from './components/CcrUi';

type View = 'hiring' | 'new' | 'filled';
type RevealPhase = 'idle' | 'deliberating' | 'selected' | 'cascade';
type AppMode = 'start' | 'inspecting' | 'preflight' | 'market-ready' | 'evaluation-ready' | 'carousel';

const turns: Turn[] = ['school-offers', 'coach-decisions', 'results'];
const turnLabels: Record<Turn, string> = {
  'school-offers': 'Schools Make Offers',
  'coach-decisions': 'Coaches Consider Offers',
  results: 'Results & New Openings'
};

const roleLabel = (role: 'HC' | 'OC' | 'DC') => (
  role === 'HC' ? 'Head Coach' : role === 'OC' ? 'Offensive Coordinator' : 'Defensive Coordinator'
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
  const [state, setState] = useState<CarouselState>(() => createFixtureState());
  const [view, setView] = useState<View>('hiring');
  const [years, setYears] = useState(3);
  const [points, setPoints] = useState(130);
  const [version, setVersion] = useState('fixture build');
  const [revealPhase, setRevealPhase] = useState<RevealPhase>('idle');
  const reducedMotion = useReducedMotion();

  const newOpenings = state.openings.filter((opening) => opening.status === 'new');
  const activeOpening = state.openings.find((opening) => opening.status === 'active') ?? state.openings[0]!;
  const activeTeam = teamById(state, activeOpening.teamId);
  const finalists = ['navarro', 'reed', 'grant'].map((id) => coachById(state, id));

  useEffect(() => {
    window.ccr?.getAppInfo().then((info) => setVersion(`v${info.version}`)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('preview') !== 'evaluation') return;
    void fetch('/evaluation-preview.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Preview fixture unavailable (${response.status})`);
        return response.json() as Promise<SavePreflightResult>;
      })
      .then((result) => {
        if (!result.snapshot) throw new Error('Preview fixture has no normalized dynasty snapshot');
        const previewMarket = initializeMarket(result.snapshot);
        setPreflight(result);
        setMarket(previewMarket);
        setEvaluation(evaluatePartOne(result.snapshot, previewMarket));
        setMode('evaluation-ready');
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
      setMode('preflight');
    } catch {
      setMode('start');
    }
  };

  const initializeSelectedMarket = () => {
    if (!preflight?.snapshot) return;
    setMarket(initializeMarket(preflight.snapshot));
    setMode('market-ready');
  };

  const evaluateSelectedMarket = () => {
    if (!preflight?.snapshot || !market) return;
    setEvaluation(evaluatePartOne(preflight.snapshot, market));
    setMode('evaluation-ready');
  };

  if (mode === 'market-ready') {
    return preflight && market
      ? <MarketReady result={preflight} market={market} version={version} onBack={() => setMode('preflight')} onEvaluate={evaluateSelectedMarket} />
      : <StartAndPreflight mode="preflight" result={preflight} version={version} onSelect={selectSave} onBegin={initializeSelectedMarket} />;
  }

  if (mode === 'evaluation-ready') {
    return preflight?.snapshot && market && evaluation
      ? <EvaluationReady result={preflight} evaluation={evaluation} version={version} onBack={() => setMode('market-ready')} onPreview={() => setMode('carousel')} />
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

      {revealPhase !== 'idle' && <RevealStage phase={revealPhase} team={activeTeam} finalists={finalists} finalistTeams={finalists.map((coach) => teamById(state, coach.teamId))} selected={coachById(state, 'navarro')} priorTeam={teamById(state, 'louisiana-tech')} reducedMotion={reducedMotion} onAdvance={advanceReveal} />}
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
                <div><Eyebrow>PRIMARY USER CONTEXT</Eyebrow><h3>{user.team?.longName ?? 'Unassigned Team'}</h3><p>{user.name} · {user.role} · {user.prestige} prestige</p></div>
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

function EvaluationReady({ result, evaluation, version, onBack, onPreview }: {
  result: SavePreflightResult;
  evaluation: PartOneEvaluation;
  version: string;
  onBack: () => void;
  onPreview: () => void;
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
                  <div className="evaluation-person"><Eyebrow>{roleLabel(item.role)} · {team.longName}</Eyebrow><strong>{coach.name}</strong><span>Team {team.currentRecord.wins}-{team.currentRecord.losses} · Career {coach.resume.career.wins}-{coach.resume.career.losses} · {coach.prestige} prestige</span></div>
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
        <footer className="evaluation-page-actions"><CcrButton tone="neutral" onClick={onBack}>BACK TO ENGINE BASELINE</CcrButton><CcrButton tone="primary" onClick={onPreview}>OPEN INTERACTION PREVIEW <span aria-hidden="true">›</span></CcrButton></footer>
      </section>
      <footer className="launch-footer"><span>PART 1 PERFORMANCE MODEL · READ ONLY</span><span>DEPARTURES + CONTRACT DECISIONS NEXT</span></footer>
    </main>
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
          <div className="stat"><span className="stat-title">LAST SEASON</span><strong className="stat-value">{team.lastSeasonRecord}</strong></div>
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
            <div className="candidate-identity"><Eyebrow>PRIMARY TARGET</Eyebrow><h3>{coach.name}</h3><p>{roleLabel(coach.role)} · {currentTeam.name}</p><p className="coach-records">LAST SEASON {coach.lastSeasonRecord} · CAREER {coach.careerRecord}</p><div className="candidate-tags"><CcrBadge tone="gold">{coach.prestige} PRESTIGE</CcrBadge><CcrBadge>FIRST HC OPPORTUNITY</CcrBadge></div></div>
            <div className="score-grid stats">
              <div className="stat"><span className="stat-title">SCHOOL INTEREST</span><strong className="stat-value">84</strong><span className="stat-desc">STRONG MATCH</span></div>
              <div className="stat"><span className="stat-title">COACH INTEREST</span><strong className="stat-value">77</strong><span className="stat-desc">INTERESTED</span></div>
            </div>
          </div>
          <div className="shortlist-row">
            <Eyebrow>FINAL SHORTLIST</Eyebrow>
            {otherFinalists.map((finalist) => <div className="shortlist-coach" key={finalist.id}><CoachHead coach={finalist} team={teamById(state, finalist.teamId)} size="small" /><span><strong>{finalist.name}</strong><small>{roleLabel(finalist.role)} · {teamById(state, finalist.teamId).name}</small><small className="shortlist-record">LAST {finalist.lastSeasonRecord} · CAREER {finalist.careerRecord}</small></span><CcrBadge>{finalist.prestige}</CcrBadge></div>)}
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
          <div className="coach-decision-profile"><CoachHead coach={userCoach} team={userCoachTeam} size="large" /><div><Eyebrow>YOUR COACH</Eyebrow><h3>{userCoach.name}</h3><p>Last season {userCoach.lastSeasonRecord} · Career {userCoach.careerRecord} · {userCoach.prestige} prestige</p></div></div>
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
        return <div className="result-row" key={filled.openingId}><CoachHead coach={coach} team={team} size="medium" /><div><strong>{team.name} {opening.role}: {coach.name}</strong><p>Hired from {prior.name} · Career {coach.careerRecord} · {coach.prestige} prestige</p></div><TeamMark team={team} compact /></div>;
      })}</div>}
    </section>
  );
}

function RevealStage({ phase, team, finalists, finalistTeams, selected, priorTeam, reducedMotion, onAdvance }: {
  phase: Exclude<RevealPhase, 'idle'>;
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
                  <div><Eyebrow>{coach.role} FINALIST</Eyebrow><h3>{coach.name}</h3><p>Last season {coach.lastSeasonRecord} · Career {coach.careerRecord} · {coach.prestige} prestige</p></div>
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
