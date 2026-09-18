/** Request-local serialization, not new authority. Every operation still uses
 * its guarded DB transaction. A failed transition permanently closes this gate. */
export type OutputSourceTransition = <T>(work: () => Promise<T>) => Promise<T>;

export function outputSourceTransition(): OutputSourceTransition {
 let tail: Promise<void> = Promise.resolve();
 let stopped = false;
 let failure: unknown;
 return <T>(work: () => Promise<T>): Promise<T> => {
  const result = tail.then(async () => {
   if (stopped) throw failure;
   try { return await work(); }
   catch (error) { stopped = true; failure = error; throw error; }
  });
  // Release queued waiters on failure; they reject with the original failure.
  tail = result.then(() => undefined, () => undefined);
  return result;
 };
}
