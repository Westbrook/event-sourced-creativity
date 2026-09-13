import { EVENT_WRITE_COLUMNS, eventWriteBindings, type EventRow } from "./event-write-primitives.ts";
import { streamHead } from "./event-stream-read.ts";
import type { WorkerEnv } from "./runtime.ts";

const insertEventAtHead = (env: WorkerEnv, event: EventRow, expectedHead: number) => env.DB.prepare(`INSERT INTO event_write_stage (${EVENT_WRITE_COLUMNS})
  SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
  WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`).bind(...eventWriteBindings(event),event.streamId,expectedHead);

export class StaleSequenceError extends Error {
  readonly expected: number;
  readonly head: number;
  constructor(expected: number, head: number) { super("stale_sequence"); this.expected=expected;this.head=head;this.name = "StaleSequenceError"; }
}

/** Reserve and append one contiguous event range in a single D1 batch. */
export async function appendEvents(env: WorkerEnv, events: EventRow[], options: { expectedHead?: number; initialHead?:number; retries?: number; prepareSidecars?:(events:EventRow[])=>D1PreparedStatement[];onSidecarsCommitted?:(results:D1Result[])=>void } = {}) {
  if (!events.length) return events;
  const streamId = events[0].streamId; if (!events.every((event) => event.streamId === streamId)) throw new Error("mixed_event_stream_batch");
  const retries = options.expectedHead === undefined ? Math.max(1, options.retries ?? 4) : 1;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const head = options.expectedHead ?? (attempt===0?options.initialHead:undefined) ?? await streamHead(env, streamId);
    events.forEach((event, index) => { event.sequence = head + index + 1; });
    const sidecars=options.prepareSidecars?.(events)??[];
    const results = await env.DB.batch([...events.map((event, index) => insertEventAtHead(env, event, head + index)),...sidecars]);
    if (results.slice(0,events.length).every((result) => Number(result.meta.changes ?? 0) > 0)){options.onSidecarsCommitted?.(results.slice(events.length));return events;}
    if (options.expectedHead !== undefined) throw new StaleSequenceError(options.expectedHead, await streamHead(env,streamId));
  }
  throw new Error("event_append_contention");
}

export { insertEventAtHead };
