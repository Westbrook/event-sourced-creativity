/** Actor-private queue metadata, not source content or a scheduling guarantee.
 * Counts describe retained jobs only; deletion and expiry can reduce them. */
export const MEMORY_DERIVATION_HEALTH = 'memory-derivation-health-v1' as const;
export type MemoryDerivationHealth = Readonly<{
  version: typeof MEMORY_DERIVATION_HEALTH;
  ready: number; deferred: number; leased: number; recovery: number; expired: number;
  oldestPendingAt: string | null; lastCompletedAt: string | null; lastRetainedAt: string | null;
  completionLatencySeconds: Readonly<{ samples: number; total: number; maximum: number }>;
}>;
type Counts = { pending: number; completed: number; retained: number };
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key) || !('value' in Object.getOwnPropertyDescriptor(value, key)!))) throw Error('memory-health-invalid');
  return value as Record<string, unknown>;
}
export function parseMemoryDerivationHealth(value: unknown, counts: Counts, checkedAt: string): MemoryDerivationHealth {
  const row = record(value, ['version','ready','deferred','leased','recovery','expired','oldestPendingAt','lastCompletedAt','lastRetainedAt','completionLatencySeconds']);
  const stamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (!stamp(checkedAt) || ![counts.pending,counts.completed,counts.retained].every(integer)
    || row.version !== MEMORY_DERIVATION_HEALTH || ![row.ready,row.deferred,row.leased,row.recovery,row.expired].every(integer)
    || Number(row.ready) + Number(row.deferred) + Number(row.leased) + Number(row.recovery) + Number(row.expired) !== counts.pending) throw Error('memory-health-invalid');
  for (const [key, count] of [['oldestPendingAt',counts.pending],['lastCompletedAt',counts.completed],['lastRetainedAt',counts.retained]] as const) {
    const at = row[key];
    if (count === 0 ? at !== null : !stamp(at) || at > checkedAt) throw Error('memory-health-invalid');
  }
  const latency = record(row.completionLatencySeconds, ['samples','total','maximum']);
  if (![latency.samples,latency.total,latency.maximum].every(integer) || latency.samples !== counts.completed
    || Number(latency.maximum) > Number(latency.total)
    || (latency.samples === 0 ? latency.total !== 0 || latency.maximum !== 0
      : Number(latency.total) / Number(latency.samples) > Number(latency.maximum))) throw Error('memory-health-invalid');
  return Object.freeze({ ...row, completionLatencySeconds: Object.freeze({...latency}) }) as MemoryDerivationHealth;
}
