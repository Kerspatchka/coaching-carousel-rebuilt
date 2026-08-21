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
import '../shared/desktop-api';
import type { SavePreflightResult } from '../shared/desktop-api';
import { shellBackground } from './assets/assetCatalog';
import { CcrBadge, CcrButton, CoachHead, ConferenceMark, Eyebrow, TeamArt, TeamMark } from './components/CcrUi';

type View = 'hiring' | 'new' | 'filled';
type RevealPhase = 'idle' | 'deliberating' | 'selected' | 'cascade';
type AppMode = 'start' | 'inspecting' | 'preflight' | 'carousel';

const turns: Turn[] = ['school-offers', 'coach-decisions', 'results'];
const turnLabels: Record<Turn, string> = {
  'school-offers': 'Schools Make Offers',
  'coach-decisions': 'Coaches Consider Offers',
  results: 'Results & New Openings'
};

const roleLabel = (role: 'HC' | 'OC' | 'DC') => (
  role === 'HC' ? 'Head Coach' : role === 'OC' ? 'Offensive Coordinator' : 'Defensive Coordinator'
);

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
      setMode('preflight');
    } catch {
      setMode('start');
    }
  };

  if (mode !== 'carousel') {
    return <StartAndPreflight mode={mode} result={preflight} version={version} onSelect={selectSave} onBegin={() => setMode('carousel')} />;
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
  mode: Exclude<AppMode, 'carousel'>;
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
              {ready && <CcrButton tone="primary" onClick={onBegin}>BEGIN CAROUSEL PREVIEW <span aria-hidden="true">›</span></CcrButton>}
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
