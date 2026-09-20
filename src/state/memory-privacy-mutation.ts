/** A UI invalidation barrier, never authorization. Native reads still prove
 * source access. No identifiers, source text, or drafts are broadcast. */
let pending = 0;
export function memoryPrivacyMutationActive(): boolean { return pending > 0; }
function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('forma-memory-privacy-mutation'));
}
export function beginMemoryPrivacyMutation(): () => void {
  pending++;
  notify();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pending--;
    if (!pending) notify();
  };
}
