import type {WorkerEnv} from './runtime.ts';
import {ownerMediaNamespace} from '../src/model/media-ownership.ts';
const KIND='authored-memory-image';

/** Reserved authored-image keys require a surviving native acceptance, even if
 * an object outlives an interrupted projection or account-content erasure. */
export async function memoryAuthoredImageMediaAllowed(env:WorkerEnv,owner:string,key:string):Promise<boolean>{
 if(!key.startsWith(ownerMediaNamespace(owner)+'/generated/memory-image-'))return true;
 const row=await env.DB.prepare(`SELECT 1 AS valid FROM memory_authored_image_receipts accepted JOIN private_content c ON c.content_id=accepted.content_id AND c.owner_id=accepted.owner_id JOIN events e ON e.event_id=accepted.event_id AND e.stream_id='creative:'||c.owner_id AND e.type='GenerationCompleted' AND json_extract(e.payload,'$.memory_image_acceptance_version')=1
 JOIN event_private_payloads secret ON secret.private_event_id=e.event_id AND secret.owner_id=c.owner_id AND secret.redacted_at IS NULL AND json_extract(secret.private_json,'$.output_ref')=c.content_id
 JOIN event_client_receipts r ON r.event_id=e.event_id AND r.stream_id=e.stream_id AND r.client_event_id='memory-image-adopt:'||json_extract(e.payload,'$.request_id')
 WHERE accepted.media_key=? AND accepted.state='active' AND accepted.owner_id=? AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND c.kind=? AND c.redacted_at IS NULL AND json_extract(c.content,'$.key')=?
 AND json_extract(c.content,'$.image.sha256')=json_extract(e.payload,'$.content_sha256') AND json_extract(c.content,'$.approvalHash')=json_extract(e.payload,'$.approval_id') LIMIT 1`).bind(key,owner,KIND,key).first();return !!row;
}
