/** Snapshot reuse limits only; neither a permission nor a promise against remote revocation. */
export const MEMORY_RECALL_LIFETIME = "memory-recall-lifetime-v1" as const;
export const MEMORY_RECALL_MAX_AGE_MS = 60_000;

export type MemoryRecallLifetime = Readonly<{
  version: typeof MEMORY_RECALL_LIFETIME; checkedAt: string; validUntil: string;
}>;
export type MemoryClockSample = Readonly<{ monotonic: number; wall: number }>;

/** Exact millisecond UTC form. Do not accept normalized dates, offsets or invalid calendar days. */
export function memoryTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

/** Capture own data fields once; even a rejected accessor is never evaluated. */
export function parseMemoryLifetime(value: unknown): MemoryRecallLifetime | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const captured = new Map<PropertyKey, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    captured.set(key, descriptor.value);
  }
  if (captured.size !== 3 || !captured.has("version") || !captured.has("checkedAt") || !captured.has("validUntil")) return null;
  const version = captured.get("version"), checkedAt = captured.get("checkedAt"), validUntil = captured.get("validUntil");
  const checked = memoryTimestamp(checkedAt), until = memoryTimestamp(validUntil);
  if (version !== MEMORY_RECALL_LIFETIME || typeof checkedAt !== "string" || typeof validUntil !== "string"
    || checked === null || until === null || until <= checked || until - checked > MEMORY_RECALL_MAX_AGE_MS) return null;
  return Object.freeze({ version, checkedAt, validUntil });
}

/** Explicit clock inputs keep this leaf independent of transport, timers and environment clocks. */
export function createMemoryElapsed(start: MemoryClockSample) {
  let lastMonotonic = start.monotonic, lastWall = start.wall, longest = 0;
  let retired = !Number.isFinite(lastMonotonic) || lastMonotonic < 0 || !Number.isFinite(lastWall);
  const initialMonotonic = lastMonotonic, initialWall = lastWall;
  const retire = () => { retired = true; };
  return Object.freeze({
    retire,
    elapsed(sample: MemoryClockSample): number {
      if (retired) return Infinity;
      const monotonic = sample.monotonic, wall = sample.wall;
      if (!Number.isFinite(monotonic) || !Number.isFinite(wall) || monotonic < lastMonotonic || wall < lastWall) {
        retire(); return Infinity;
      }
      lastMonotonic = monotonic; lastWall = wall;
      longest = Math.max(longest, monotonic - initialMonotonic, wall - initialWall);
      if (!Number.isFinite(longest)) { retire(); return Infinity; }
      return longest;
    },
  });
}
