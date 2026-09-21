import type { WorkerEnv } from './runtime.ts';
import type { LiveMemoryEnrollment } from './memory-live-authority.ts';
import type { NativeMemoryContextObserver } from './memory-live-context.ts';
import type { MemorySqlGuard } from './memory-sql.ts';
import { derivationAssertion,derivationResults,derivationVerified } from './memory-derivation-store.ts';
import { creativeContextRightsValidity } from '../src/model/context-health.ts';
import { mediaKeyMatchesOwnerNamespace } from '../src/model/media-ownership.ts';

const fields=['type','reference_id','media_url','rights_revoked','source_rights_revoked','rights_class','rights_status','source_expires_at','license_expires_at','rights_expires_at'];
type Scope={owner:string;project:string;document:string;organization:string;access:string;block:string};
const scope=(e:LiveMemoryEnrollment,block:string):Scope=>({owner:e.owner_user_id,project:e.project_id,document:e.document_id,organization:e.organization_id!,access:e.project_access_id!,block});
const allowedCustody=`(SELECT COUNT(*) FROM project_event_scopes c WHERE c.event_id=event.event_id)=1 AND EXISTS(
  SELECT 1 FROM project_event_scopes c WHERE c.event_id=event.event_id AND(c.owner_user_id,c.project_id,c.organization_id,c.project_access_id,c.source_stream_id,c.source_sequence)
  =(i.owner,i.project,i.organization,i.access,event.stream_id,event.sequence))`;
const body='COALESCE(secret.private_json,event.payload)';
const valid=`event.schema_version=1 AND event.recorded_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND event.event_id NOT LIKE 'optimistic:%' AND event.client_id NOT LIKE '%optimistic%'
  AND NOT COALESCE(json_extract(${body},'$.origin.synthetic'),0) AND json_extract(${body},'$.mock_data_source') IS NULL
  AND json_extract(${body},'$.replay_session_id') IS NULL AND json_extract(${body},'$.fictional_user_id') IS NULL
  AND secret.redacted_at IS NULL AND (json_extract(event.payload,'$._private_ref') IS NULL AND secret.private_json IS NULL
  OR json_extract(event.payload,'$._private_ref')=event.event_id AND secret.private_json IS NOT NULL)
  AND json_extract(${body},'$.project_id')=i.project AND json_extract(${body},'$.document_id')=i.document
  AND NOT COALESCE(json_extract(${body},'$.synthetic'),0) AND NOT COALESCE(json_extract(${body},'$.simulation'),0)
  AND NOT EXISTS(SELECT 1 FROM events compensation WHERE compensation.stream_id=event.stream_id AND compensation.compensates_event_id=event.event_id)
  AND event.compensates_event_id IS NULL AND ${allowedCustody}`;
const inputs=`SELECT json_extract(value,'$.owner') owner,json_extract(value,'$.project') project,json_extract(value,'$.document') document,
  json_extract(value,'$.organization') organization,json_extract(value,'$.access') access,json_extract(value,'$.block') block,
  json_extract(value,'$.reference') reference,json_extract(value,'$.media') media,json_extract(value,'$.key') media_key FROM json_each(?)`;

/** Metadata-only current package rights and native reference ancestry. Never reads R2 or uploads a file to
 * a provider. Authored adoption is retained; only private original discovery is
 * suppressed when current rights, exact ingestion or resource custody changes.
 * The enclosing caller replays these exact reads with both access/consent proofs. */
export async function observeNativePackageRights(env:WorkerEnv,source:LiveMemoryEnrollment,target:LiveMemoryEnrollment,
  sourceBlock:string,targetBlock:string,createdEventId:string,block:{type:string;source?:{contentSha256?:unknown}},created:Record<string,unknown>,
  observer:NativeMemoryContextObserver,access:readonly MemorySqlGuard[]){
  const referenceBlock=block.type==='reference';
  if(referenceBlock?(!block.source||typeof block.source.contentSha256!=='string'||!/^[a-f0-9]{64}$/u.test(block.source.contentSha256)):Boolean(block.source))throw Error('package_reference_source');
  const deadlines:string[]=[];
  const db=env.DB,scopes=[scope(source,sourceBlock),scope(target,targetBlock)];
  const query={sql:`WITH i AS (${inputs}), history AS(
    SELECT i.owner,i.block,event.event_id,event.sequence,event.type,${body} AS body,COALESCE(${valid},0) AS valid
    FROM i JOIN events event ON event.stream_id='creative:'||i.owner AND json_extract(event.payload,'$.block_id')=i.block
      AND event.type IN('BlockCreated','BlockPropertyEdited','ChipEdited')
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=i.owner AND secret.project_id=i.project AND secret.document_id=i.document
  ), selected AS(SELECT i.owner,i.block,key.value AS field,(SELECT h.event_id FROM history h WHERE h.owner=i.owner AND h.block=i.block
    AND(h.type='BlockCreated' OR h.type='BlockPropertyEdited' AND json_extract(h.body,'$.property_path')=key.value
      OR h.type='ChipEdited' AND json_extract(h.body,'$.property')=key.value) ORDER BY h.sequence DESC LIMIT 1) event_id
    FROM i,json_each(?) key)
  SELECT s.owner,s.block,s.field,h.event_id,
    CASE WHEN h.type='BlockCreated' THEN json_type(h.body,CASE WHEN s.field='type' THEN '$.type' ELSE '$.properties.'||s.field END) ELSE json_type(h.body,'$.new_value') END AS kind,
    CASE WHEN length(CAST(CASE WHEN h.type='BlockCreated' THEN json_extract(h.body,CASE WHEN s.field='type' THEN '$.type' ELSE '$.properties.'||s.field END) ELSE json_extract(h.body,'$.new_value') END AS BLOB))<=2048
      THEN CASE WHEN h.type='BlockCreated' THEN json_extract(h.body,CASE WHEN s.field='type' THEN '$.type' ELSE '$.properties.'||s.field END) ELSE json_extract(h.body,'$.new_value') END ELSE NULL END AS value,
    COALESCE(h.valid,0) AND NOT EXISTS(SELECT 1 FROM history bad WHERE bad.owner=s.owner AND bad.block=s.block AND bad.valid=0)
      AND (SELECT COUNT(*) FROM history creation WHERE creation.owner=s.owner AND creation.block=s.block AND creation.type='BlockCreated')=1
      AND (SELECT COUNT(*) FROM history bounded WHERE bounded.owner=s.owner AND bounded.block=s.block)<=256 AS valid
    FROM selected s LEFT JOIN history h ON h.owner=s.owner AND h.block=s.block AND h.event_id=s.event_id ORDER BY s.owner,s.block,s.field LIMIT ${fields.length*2+1}`,
    bindings:[JSON.stringify(scopes),JSON.stringify(fields)]};
  const read=db.prepare(query.sql).bind(...query.bindings),result=structuredClone(await db.batch<Record<string,unknown>>([...access.map(guard=>derivationAssertion(env,guard)),read]));
  if(env.DB!==db||!derivationResults(result,access.length+1)||!result.slice(0,access.length).every(derivationVerified))throw Error('package_reference_access');
  const rows=result[access.length]!;observer.observe([read],[rows],[query]);
  if(rows.results.length!==scopes.length*fields.length||rows.results.some(row=>Object.keys(row).sort().join(',')!=='block,event_id,field,kind,owner,valid,value'
    ||row.valid!==1||typeof row.event_id!=='string'||!fields.includes(String(row.field))))throw Error('package_reference_fields');
  const references=scopes.map(i=>{
    const properties:Record<string,unknown>={};
    for(const field of fields){const matches=rows.results.filter(row=>row.owner===i.owner&&row.block===i.block&&row.field===field);if(matches.length!==1)throw Error('package_reference_fields');
      const row=matches[0]!;if(row.kind===null||row.kind==='null'){if(row.value!==null)throw Error('package_reference_value');continue;}
      if(row.kind==='true'&&row.value===1)properties[field]=true;
      else if(row.kind==='false'&&row.value===0)properties[field]=false;
      else if(row.kind==='text'&&typeof row.value==='string'&&row.value.length<=2048)properties[field]=row.value;
      else throw Error('package_reference_value');
    }
    if(properties.type!==block.type)throw Error('package_reference_type');
    const rights=creativeContextRightsValidity(properties);if(rights.issue)throw Error('package_reference_rights');if(rights.validUntil){observer.before(rights.validUntil);deadlines.push(rights.validUntil);}
    if(!referenceBlock){if(properties.reference_id!=null||properties.media_url!=null)throw Error('package_reference_identity');return {...i,reference:'',media:'',key:''};}
    const reference=properties.reference_id,media=properties.media_url;
    if(typeof reference!=='string'||!reference||reference.length>240||typeof media!=='string'||!media.startsWith('/api/media/'))throw Error('package_reference_identity');
    const key=decodeURIComponent(media.slice('/api/media/'.length));if(!mediaKeyMatchesOwnerNamespace(key,i.owner))throw Error('package_reference_owner');
    if(i===scopes[1]&&(reference!==created.reference_id||media!==created.media_url))throw Error('package_reference_adoption');
    return {...i,reference,media,key};
  });
  if(!referenceBlock)return deadlines.sort()[0];
  const evidence={sql:`WITH i AS (${inputs}) SELECT i.owner,i.block,event.event_id,event.sequence,event.type,event.actor,event.client_id,event.correlation_id,
    CASE WHEN length(CAST(json_extract(${body},'$.rights_class') AS BLOB))<=2048 THEN json_extract(${body},'$.rights_class') ELSE NULL END AS rights,CASE WHEN length(CAST(json_extract(${body},'$.source_type') AS BLOB))<=2048 THEN json_extract(${body},'$.source_type') ELSE NULL END AS source_type,
    CASE WHEN length(CAST(json_extract(${body},'$.source_ref') AS BLOB))<=2048 THEN json_extract(${body},'$.source_ref') ELSE NULL END AS source_ref,CASE WHEN length(CAST(json_extract(${body},'$.content_hash') AS BLOB))<=2048 THEN json_extract(${body},'$.content_hash') ELSE NULL END AS content_hash,
    COALESCE(${valid},0) AND json_extract(${body},'$.reference_id')=i.reference
      AND (SELECT COUNT(*) FROM project_resource_scopes r WHERE r.owner_user_id=i.owner AND r.resource_kind='reference' AND r.resource_id=i.reference)=1
      AND (SELECT COUNT(*) FROM project_resource_scopes r WHERE r.owner_user_id=i.owner AND r.resource_kind='media' AND r.resource_id=i.media_key)=1 AS valid,
    (SELECT COUNT(*) FROM project_resource_scopes r WHERE r.owner_user_id=i.owner AND r.resource_kind='reference' AND r.resource_id=i.reference
      AND(r.organization_id,r.project_access_id,r.project_id,r.visibility)=(i.organization,i.access,i.project,'collaborative_output')) AS reference_custody,
    (SELECT COUNT(*) FROM project_resource_scopes r WHERE r.owner_user_id=i.owner AND r.resource_kind='media' AND r.resource_id=i.media_key
      AND(r.organization_id,r.project_access_id,r.project_id,r.visibility)=(i.organization,i.access,i.project,'collaborative_output')) AS media_custody
    FROM i JOIN events event ON event.stream_id='creative:'||i.owner AND json_extract(event.payload,'$.reference_id')=i.reference AND event.type IN('ReferenceIngested','RightsAsserted')
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=i.owner AND secret.project_id=i.project AND secret.document_id=i.document
    ORDER BY i.owner,i.block,event.sequence LIMIT 65`,bindings:[JSON.stringify(references)]};
  const creation={sql:`SELECT event.sequence,event.actor,event.client_id,event.correlation_id FROM events event WHERE event.event_id=? AND event.stream_id=? AND event.type='BlockCreated'`,bindings:[createdEventId,'creative:'+target.owner_user_id]};
  const qs=[evidence,creation],statements=qs.map(q=>db.prepare(q.sql).bind(...q.bindings)),frames=structuredClone(await db.batch<Record<string,unknown>>([...access.map(guard=>derivationAssertion(env,guard)),...statements]));
  if(env.DB!==db||!derivationResults(frames,access.length+2)||!frames.slice(0,access.length).every(derivationVerified))throw Error('package_reference_access');
  const proved=frames.slice(access.length);
  if(env.DB!==db||!derivationResults(proved,2)||proved[0]!.results.length>64||proved[1]!.results.length!==1)throw Error('package_reference_evidence');
  observer.observe(statements,proved,qs);const adopted=proved[1]!.results[0]!;
  if(Object.keys(adopted).sort().join(',')!=='actor,client_id,correlation_id,sequence')throw Error('package_reference_receipt');
  const keys='actor,block,client_id,content_hash,correlation_id,event_id,media_custody,owner,reference_custody,rights,sequence,source_ref,source_type,type,valid';
  if(proved[0]!.results.some(row=>Object.keys(row).sort().join(',')!==keys||row.valid!==1||row.reference_custody!==1||row.media_custody!==1))throw Error('package_reference_custody');
  for(const i of references){
    const history=proved[0]!.results.filter(row=>row.owner===i.owner&&row.block===i.block),ingested=history.filter(row=>row.type==='ReferenceIngested'),latest=history.at(-1);
    if(ingested.length!==1||!latest||!['owned','owned_or_licensed'].includes(String(latest.rights))||ingested[0]!.source_ref!==i.media||ingested[0]!.content_hash!==block.source!.contentSha256)throw Error('package_reference_license');
    if(i===references[1]){
      const original=ingested[0]!,assertions=history.filter(row=>row.type==='RightsAsserted'&&row.sequence===Number(original.sequence)+1);
      if(original.source_type!=='organization-context'||assertions.length!==1||Number(adopted.sequence)!==Number(original.sequence)+2
        ||![original,assertions[0]!].every(row=>row.actor===adopted.actor&&row.client_id===adopted.client_id)
        ||assertions[0]!.rights!=='owned_or_licensed')throw Error('package_reference_adoption');
    }
  }
  return deadlines.sort()[0];
}
