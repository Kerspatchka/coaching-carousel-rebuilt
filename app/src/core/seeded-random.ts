export interface AuditedRoll {
  key: string;
  probability: number;
  roll: number;
  selected: boolean;
}

export interface WeightedCandidate {
  id: string;
  weight: number;
}

export interface WeightedSelectionEvidence extends WeightedCandidate {
  roll: number;
  priority: number | null;
  selected: boolean;
}

const clampProbability = (value: number): number => Math.max(0, Math.min(1, value));

// A keyed roll is independent of iteration order. Adding a new candidate does
// not reroll existing candidates, which keeps audit comparisons meaningful.
export function seededUnit(seed: string, key: string): number {
  const input = `${seed}|${key}`;
  let hash = 0x6a09e667 ^ input.length;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 0x85ebca6b);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}

export function auditedRoll(seed: string, key: string, probability: number): AuditedRoll {
  const normalized = clampProbability(probability);
  const roll = seededUnit(seed, key);
  return { key, probability: normalized, roll, selected: roll < normalized };
}

export function weightedSelection(seed: string, key: string, candidates: readonly WeightedCandidate[], count: number): WeightedSelectionEvidence[] {
  const limit = Math.max(0, Math.floor(count));
  const evidence = candidates.map((candidate) => {
    const weight = Math.max(0, candidate.weight);
    const roll = seededUnit(seed, `${key}|${candidate.id}`);
    // Exponential-race sampling selects without replacement and gives larger
    // weights proportionally better odds while retaining full roll evidence.
    const priority = weight > 0 ? -Math.log(Math.max(Number.EPSILON, 1 - roll)) / weight : null;
    return { id: candidate.id, weight, roll, priority, selected: false };
  });
  const selectedIds = new Set(evidence
    .filter((candidate) => candidate.priority !== null)
    .sort((left, right) => left.priority! - right.priority! || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map((candidate) => candidate.id));
  return evidence.map((candidate) => ({ ...candidate, selected: selectedIds.has(candidate.id) }));
}
