import type { NextBestAnswer } from './next-best.ts';

/** A first-pass nomination cannot overrule later evidence or a final menu exclusion. */
export function finalNextBest(answer: NextBestAnswer | undefined, selectedIds: string[], evidenceChanged?: string): NextBestAnswer | undefined {
  if (!answer) return;
  const reason = evidenceChanged ?? (answer.choice && answer.choice !== 'none' && !selectedIds.includes(answer.choice) ? 'Nominee is outside the final selected menu' : undefined);
  return reason ? {...answer, status: 'Invalidated', reason} : answer;
}
