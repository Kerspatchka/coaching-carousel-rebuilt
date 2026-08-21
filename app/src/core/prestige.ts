export function formatPrestigeGrade(value: string): string {
  const normalized = value.trim();
  const match = normalized.match(/^([A-F])(?:[\s_-]*(plus|minus|\+|-))?$/i);
  if (!match) return normalized;
  const modifier = match[2]?.toLowerCase();
  return `${match[1]!.toUpperCase()}${modifier === 'plus' || modifier === '+' ? '+' : modifier === 'minus' || modifier === '-' ? '-' : ''}`;
}
