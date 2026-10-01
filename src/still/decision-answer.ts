import type { Answer, Question } from './decisions.ts';

export type DecisionAnswerQuality = 'valid' | 'degraded' | 'unusable';
export type InspectedDecisionAnswer = {
  status: 'Answered' | 'Missing answer' | 'Invalid answer';
  quality: DecisionAnswerQuality;
  score?: number;
  confidence?: number;
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  warnings: string[];
};

// Accommodate rounded provider probabilities without repairing malformed answers.
export const ANSWER_TOLERANCE = { distributionSum: .02, expectedScore: .03, equality: 1e-9 };
const bounded = (value: unknown, maximum: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum ? value : undefined;

/** Shared policy for ranking, inspection, finder resolution and primary emphasis.
 * Missing distributions permit ordinary scalar ranking with an explicit degraded
 * label. Contradictory or malformed supplied evidence is never usable. Sanitized
 * scalars remain visible for diagnostics; consumers must check quality before use.
 */
export function inspectDecisionAnswer(question: Question, answer?: Answer): InspectedDecisionAnswer {
  const warnings: string[] = [];
  if (!answer) return { status: 'Missing answer', quality: 'unusable', warnings: ['Missing answer'] };
  const score = question.type === 'score' ? bounded(answer.score, question.criteria.length - 1) : undefined;
  const confidence = question.type !== 'noul' ? bounded(answer.confidence, 1) : undefined;
  const noul = question.type === 'noul' ? bounded(answer.noul, 1) : undefined;
  const choice = question.type === 'choice' && typeof answer.choice === 'string' && Object.hasOwn(question.criteria, answer.choice) ? answer.choice : undefined;
  if (answer.type !== question.type) warnings.push('Answer type does not match question');
  if (question.type === 'score' && score === undefined) warnings.push('Invalid score');
  if (question.type !== 'noul' && confidence === undefined) warnings.push('Invalid confidence');
  if (question.type === 'noul' && noul === undefined) warnings.push('Invalid probability');
  if (question.type === 'choice' && choice === undefined) warnings.push('Choice is not an offered criterion');
  const result: InspectedDecisionAnswer = { status: 'Answered', quality: warnings.length ? 'unusable' : 'valid', score, confidence, noul, choice, warnings };
  const keys = question.type === 'score' ? question.criteria.map((_, index) => String(index)) : question.type === 'choice' ? Object.keys(question.criteria) : [];
  if (question.type !== 'noul') {
    const raw = answer.probabilities;
    if (raw === undefined) {
      warnings.push('Distribution unavailable; ordinary ranking only');
      if (result.quality !== 'unusable') result.quality = 'degraded';
    } else if (!keys.length || !raw || typeof raw !== 'object' || Array.isArray(raw) || keys.some(key => !Object.hasOwn(raw, key) || bounded(raw[key], 1) === undefined) || Object.keys(raw).some(key => !keys.includes(key))) {
      warnings.push('Invalid distribution');
      result.quality = 'unusable';
    } else {
      const sum = keys.reduce((total, key) => total + raw[key], 0);
      if (Math.abs(sum - 1) > ANSWER_TOLERANCE.distributionSum + ANSWER_TOLERANCE.equality) {
        warnings.push('Distribution does not sum to 1');
        result.quality = 'unusable';
      } else if (question.type === 'score' && score !== undefined && Math.abs(keys.reduce((total, key, index) => total + index * raw[key], 0) / sum - score) > ANSWER_TOLERANCE.expectedScore + ANSWER_TOLERANCE.equality) {
        warnings.push('Score does not match distribution expected value');
        result.quality = 'unusable';
      } else if (question.type === 'choice' && choice !== undefined && raw[choice] + ANSWER_TOLERANCE.equality < Math.max(...keys.map(key => raw[key]))) {
        warnings.push('Choice is not a most probable criterion');
        result.quality = 'unusable';
      } else if (result.quality === 'valid') {
        // Preserve actual probabilities. Normalization is only used for checking
        // the expected score, never for inventing stronger presentation evidence.
        result.probabilities = Object.fromEntries(keys.map(key => [key, raw[key]]));
      }
    }
  }
  if (result.quality === 'unusable') result.status = 'Invalid answer';
  return result;
}

/** Most Still usefulness and fit questions share the four-point rubric. */
export function inspectScoreAnswer(answer?: Answer, maximum = 3): InspectedDecisionAnswer {
  return inspectDecisionAnswer({ type: 'score', instructions: '', criteria: Array.from({ length: maximum + 1 }, (_, index) => String(index)) }, answer);
}
