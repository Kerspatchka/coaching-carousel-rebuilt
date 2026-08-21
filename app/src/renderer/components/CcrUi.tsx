import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import type { Coach, Team } from '../../core/carousel';
import type { NormalizedCoach, NormalizedTeam } from '../../core/dynasty';
import { formatPrestigeGrade } from '../../core/prestige';
import { coachPortraitByAssetId, conferenceLogoByKey, teamVisualsByKey, teamVisualsForIdentity } from '../assets/assetCatalog';

const join = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

export function CcrButton({
  tone = 'neutral',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'primary' | 'neutral' | 'ghost' | 'danger';
}) {
  return (
    <button className={join('btn ccr-btn', `ccr-btn-${tone}`, className)} {...props}>
      {children}
    </button>
  );
}

export function CcrBadge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'gold' | 'new' | 'success' | 'warning';
}) {
  return (
    <span className={join('badge ccr-badge', `ccr-badge-${tone}`, className)} {...props}>
      {children}
    </span>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={join('eyebrow', className)}>{children}</div>;
}

export function PrestigeGrade({ value }: { value: string }) {
  return <span className="prestige-grade">{formatPrestigeGrade(value)}</span>;
}

function levelColor(level: number | null): string {
  if (level === null) return '#aeb4b4';
  const clamped = Math.max(10, Math.min(50, level));
  const hue = ((clamped - 10) / 40) * 120;
  return `hsl(${hue} 78% 64%)`;
}

export function CoachStanding({ prestige, level, age, compact = false }: {
  prestige: string;
  level: number | null;
  age: number | null;
  compact?: boolean;
}) {
  return <span className={`coach-standing ${compact ? 'is-compact' : ''}`}>
    <PrestigeGrade value={prestige} />{!compact && ' prestige'}
    <i aria-hidden="true">·</i><span>lvl.</span><b style={{ '--coach-level-color': levelColor(level) } as React.CSSProperties}>{level ?? '—'}</b>
    <i aria-hidden="true">·</i><span>age</span><b>{age ?? '—'}</b>
  </span>;
}

export function TeamMark({ team, compact = false, variant = 'primary' }: {
  team: Team;
  compact?: boolean;
  variant?: 'primary' | 'secondary' | 'threeDimensional';
}) {
  const art = teamVisualsByKey[team.assetKey];
  const logo = variant === 'secondary'
    ? art?.secondaryLogo ?? art?.primaryLogo
    : variant === 'threeDimensional'
      ? art?.threeDimensionalLogo ?? art?.primaryLogo
      : art?.primaryLogo;

  return (
    <span
      className={join('team-mark', compact && 'team-mark-compact')}
      style={{ '--mark-primary': team.colors[0], '--mark-secondary': team.colors[1] } as React.CSSProperties}
      aria-label={team.name}
    >
      {logo ? <img src={logo} alt="" /> : <strong>{team.shortName}</strong>}
    </span>
  );
}

export function TeamArt({ team }: { team: Team }) {
  const art = teamVisualsByKey[team.assetKey];
  if (!art?.stickerPack) return <div className="team-art-fallback">{team.shortName}</div>;
  return <img className="team-art" src={art.stickerPack} alt={`${team.name} identity artwork`} />;
}

export function NormalizedTeamMark({ team, compact = false, variant = 'primary' }: {
  team: NormalizedTeam;
  compact?: boolean;
  variant?: 'primary' | 'secondary' | 'threeDimensional';
}) {
  const art = teamVisualsForIdentity(team.assetKey, team.longName, team.name, team.shortName);
  const logo = variant === 'secondary'
    ? art?.secondaryLogo ?? art?.primaryLogo
    : variant === 'threeDimensional'
      ? art?.threeDimensionalLogo ?? art?.primaryLogo
      : art?.primaryLogo;
  return (
    <span
      className={join('team-mark', compact && 'team-mark-compact')}
      style={{ '--mark-primary': team.colors[0], '--mark-secondary': team.colors[1] } as React.CSSProperties}
      aria-label={team.longName}
    >
      {logo ? <img src={logo} alt="" /> : <strong>{team.shortName || team.name.slice(0, 3).toUpperCase()}</strong>}
    </span>
  );
}

export function NormalizedTeamArt({ team }: { team: NormalizedTeam }) {
  const art = teamVisualsForIdentity(team.assetKey, team.longName, team.name, team.shortName);
  if (!art?.stickerPack) return <div className="team-art-fallback">{team.shortName || team.name}</div>;
  return <img className="team-art" src={art.stickerPack} alt={`${team.longName} identity artwork`} />;
}

export function CoachHead({ coach, team, size = 'medium' }: { coach: Coach; team: Team; size?: 'small' | 'medium' | 'large' }) {
  const portrait = coachPortraitByAssetId[coach.portraitAssetId];
  const teamVisuals = teamVisualsByKey[team.assetKey];
  const backgroundMark = teamVisuals?.flatHelmet ?? teamVisuals?.primaryLogo;
  return (
    <span className={join('coach-head', `coach-head-${size}`)} style={{ '--portrait-team-color': team.colors[0] } as React.CSSProperties}>
      {backgroundMark && <img className="coach-head-team-logo" src={backgroundMark} alt="" />}
      {portrait ? <img className="coach-head-portrait" src={portrait} alt={`${coach.name} portrait`} /> : <strong>{coach.name.split(' ').map((part) => part[0]).join('')}</strong>}
    </span>
  );
}

export function NormalizedCoachHead({ coach, team, size = 'medium' }: { coach: NormalizedCoach; team: NormalizedTeam; size?: 'small' | 'medium' | 'large' }) {
  const portraitId = typeof coach.portrait === 'number' ? coach.portrait : coach.presentationId;
  const portrait = portraitId === null ? undefined : coachPortraitByAssetId[portraitId];
  const teamVisuals = teamVisualsForIdentity(team.assetKey, team.longName, team.name, team.shortName);
  const backgroundMark = teamVisuals?.flatHelmet ?? teamVisuals?.primaryLogo;
  return (
    <span className={join('coach-head', `coach-head-${size}`)} style={{ '--portrait-team-color': team.colors[0] } as React.CSSProperties}>
      {backgroundMark && <img className="coach-head-team-logo" src={backgroundMark} alt="" />}
      {portrait ? <img className="coach-head-portrait" src={portrait} alt={`${coach.name} portrait`} /> : <strong>{coach.name.split(' ').map((part) => part[0]).join('')}</strong>}
    </span>
  );
}

export function ConferenceMark({ conferenceKey, label }: { conferenceKey: string; label: string }) {
  const mark = conferenceLogoByKey[conferenceKey];
  return mark ? <img className="conference-mark" src={mark} alt={`${label} conference`} /> : null;
}
