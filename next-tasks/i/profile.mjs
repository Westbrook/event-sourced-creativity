/** Offline experiment only. No runtime imports, feature flag, transport or activation. */
export const PROFILE = Object.freeze({
  id: 'i-renderer-authored-precedence-v2',
  enabled: false,
  factor: 'renderer authority framing',
  baseline: 'Create one polished landscape image that realizes the supplied creative direction.',
  treatment: 'Create one polished landscape image that realizes the supplied creative direction subject to authored requirements. Creative direction is planner interpretation, not additional authorship: when it conflicts with an authored requirement, the authored requirement takes precedence within its stated subject, region, relationship and combined-context scope. Retain compatible planner suggestions.',
});
// Exact one-span replacement of compiler-owned text, never semantic source editing.
export function applyProfile(prompt, { enabled = false } = {}) {
  if (!enabled) return prompt;
  if (!prompt.startsWith(PROFILE.baseline + '\n\n')) throw new Error('profile_baseline_mismatch');
  return PROFILE.treatment + prompt.slice(PROFILE.baseline.length);
}
export function promptSections(prompt) {
  const [head, rest] = prompt.split('\n\nCreative direction:\n');
  if (!rest) throw new Error('missing_direction');
  const [direction, context] = rest.split('\n\nActive creative context:\n');
  return {head, direction: JSON.parse(direction), context: JSON.parse(context)};
}
