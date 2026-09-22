import { serializeEvent } from './event-read-primitives.ts';
import type { WorkerEnv } from './runtime.ts';
// Keep structural records and legacy events without explicit ownership. Only
// drop events explicitly belonging to another document; never infer ownership
// from the requested URL. The full workspace catches up independently.
export const stillDocumentPredicate=(alias:string)=>`(json_extract(${alias}.payload,'$.document_id') IS NULL OR json_extract(${alias}.payload,'$.document_id')=? OR ${alias}.type IN('ProjectCreated','ProjectOpened','ProjectRenamed','ProjectStateChanged','DocumentCreated','DocumentForked','DocumentOpened','DocumentRenamed','DocumentRemoved','DocumentRestored','BlockDocumentAttached','BlockDocumentDetached','BlockCreated','BlockPropertyEdited','BlockRenamed','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRemoved','BlockRestored','ChipEdited','ExtractionRequested','ExtractionCompleted','ExtractionFailed','BlockRehomed','BlockRelationAdded','BlockRelationRemoved'))`;
export async function readStillRoutePage(env:WorkerEnv,stream:string,documentId:string,after:number,limit:number){
 const size=Math.max(1,Math.min(5000,Math.floor(limit)||5000));
 const [page,current]=await env.DB.batch<Record<string,unknown>>([
  env.DB.prepare(`SELECT event.*,secret.private_json FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL WHERE event.stream_id=? AND event.sequence>? AND ${documentId?stillDocumentPredicate('event'):"event.type IN('ProjectCreated','ProjectOpened','ProjectRenamed','ProjectStateChanged','DocumentCreated','DocumentForked','DocumentOpened','DocumentRenamed','DocumentRemoved','DocumentRestored')"} ORDER BY event.sequence LIMIT ?`).bind(stream,after,...(documentId?[documentId]:[]),size),
  env.DB.prepare('SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?').bind(stream),
 ]);
 const events=page.results.map(serializeEvent),head=Number(current.results[0]?.head??0),hasMore=events.length===size&&Number(events.at(-1)?.sequence??0)<head;
 return {events,head,hasMore,nextAfter:hasMore?events.at(-1)!.sequence:head};
}
