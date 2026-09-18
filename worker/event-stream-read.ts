import type { WorkerEnv } from "./runtime.ts";
import type { EventRow } from "./event-write-primitives.ts";
import { serializeEvent } from "./event-read-primitives.ts";

export async function streamHead(env: WorkerEnv, streamId: string) {
  const row = await env.DB.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").bind(streamId).first<{ head: number }>();
  return Number(row?.head ?? 0);
}

export const EVENT_PAGE_SIZE = 5000;

export async function readEventPage(env: WorkerEnv, streamId: string, afterSequence = 0, limit = EVENT_PAGE_SIZE) {
  const pageSize=Math.max(1,Math.min(EVENT_PAGE_SIZE,Math.floor(limit)));
  const result=await env.DB.prepare("SELECT * FROM events LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id AND secret.redacted_at IS NULL WHERE stream_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?").bind(streamId,Math.max(0,Math.floor(afterSequence)),pageSize).all<Record<string,unknown>>();
  return result.results.map(serializeEvent);
}

/** Read a complete stream in bounded D1 pages. Callers that only need transport pages should use readEventPage. */
export async function readEvents(env: WorkerEnv, streamId: string, limit = Number.POSITIVE_INFINITY) {
  const requested=Number.isFinite(limit)?Math.max(0,Math.floor(limit)):Number.POSITIVE_INFINITY;
  const events:EventRow[]=[];let cursor=0;
  while(events.length<requested){const page=await readEventPage(env,streamId,cursor,Math.min(EVENT_PAGE_SIZE,requested-events.length));if(!page.length)break;events.push(...page);cursor=page.at(-1)!.sequence;if(page.length<EVENT_PAGE_SIZE)break;}
  return events;
}
