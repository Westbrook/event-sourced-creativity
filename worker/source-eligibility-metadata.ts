import { eventProfilePredicate, type WorkerEnv, type EventReadProof } from './runtime.ts';
import { PROJECT_BOOTSTRAP_EVENT_TYPES } from '../src/model/event-profiles.ts';
import { PRIVATE_AUTHORED_EVENT_TYPES } from './event-privacy.ts';
import { canonicalConsent } from './consequential-consent.ts';

export const SOURCE_ELIGIBILITY_LIMITS={dependencies:128,snapshotUtf16Exclusive:28000,cellUtf8:65536,censusRowJsonUtf16:512000,metadataStreamRows:100000} as const;
// A display vocabulary, never an eligibility predicate. Unknown names cannot
// carry arbitrary event-type text out of SQL; every kind still enters the census.
export const SOURCE_METADATA_KINDS=[...new Set([...PROJECT_BOOTSTRAP_EVENT_TYPES,...PRIVATE_AUTHORED_EVENT_TYPES,
 'BlockWeightChanged','BlockLockChanged','BlockPropertyEdited','BlockRenamed','BlockMoved','GenerationRequested','GenerationFailed',
 'ModelRegistered','AdapterVersioned','CapabilityDeclared','BudgetReserved','BudgetReleased','UsageRecorded','ModelUsageRecorded','ProviderCostRecorded','GenerationCostRecorded'])].sort();
export const metadataKind=(value:string)=>SOURCE_METADATA_KINDS.includes(value)?value:'unknown';
const fail=():never=>{throw Error('metadata_incomplete');};

/** SQL projection only: no payload, private_json, identity or row ID crosses
 * this boundary. The finite stream scan includes excluded telemetry in its work
 * bound. If it saturates, totals are partial and never authorize hydration. */
export async function readSourceEligibilityMetadata(env:WorkerEnv,ownerId:string,documentId:string){
 const db=env.DB,predicate=eventProfilePredicate('workspace'),limit=SOURCE_ELIGIBILITY_LIMITS.metadataStreamRows;
 const statement=db.prepare(`WITH
 bounded AS MATERIALIZED (SELECT * FROM events WHERE stream_id=? ORDER BY sequence LIMIT ${limit+1}),
 profile AS MATERIALIZED (SELECT * FROM bounded WHERE ${predicate.sql}),
 sized AS MATERIALIZED (SELECT events.event_id,events.type,events.actor,events.schema_version,events.compensates_event_id,
  length(events.payload) AS public_units,length(COALESCE(secret.private_json,'')) AS private_units,
  length(CAST(events.payload AS BLOB)) AS public_bytes,length(CAST(COALESCE(secret.private_json,'') AS BLOB)) AS private_bytes,
  CASE WHEN length(CAST(events.payload AS BLOB))<=65536 AND json_valid(events.payload) THEN events.payload ELSE '{}' END AS public_header,
  secret.private_event_id AS custody_id,secret.owner_id AS custody_owner,secret.redacted_at AS redacted,
  secret.project_id AS custody_project,secret.document_id AS custody_document,
  EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=events.event_id) AS event_scoped
  FROM profile events LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id),
 classified AS MATERIALIZED (SELECT *,
  CASE WHEN type IN(SELECT value FROM json_each(?)) THEN type ELSE 'unknown' END AS kind,
  CASE WHEN actor='user' OR actor=? THEN 'personal-user' WHEN actor='worker:compiler' THEN 'compiler'
   WHEN actor='worker:generator' THEN 'generator' WHEN actor='worker:policy' THEN 'policy'
   WHEN actor='worker:registry' THEN 'registry' ELSE 'other' END AS actor_class,
  CASE WHEN custody_id IS NULL AND (type IN(SELECT value FROM json_each(?)) OR json_type(public_header,'$._private_ref') IS NOT NULL) THEN 1 ELSE 0 END AS missing,
  CASE WHEN custody_id IS NOT NULL AND custody_owner<>? THEN 1 ELSE 0 END AS foreign_custody,
  CASE WHEN custody_id IS NOT NULL AND (custody_document IS NOT json_extract(public_header,'$.document_id') OR custody_project IS NOT json_extract(public_header,'$.project_id')) THEN 1 ELSE 0 END AS custody_binding,
  EXISTS(SELECT 1 FROM organization_projects op WHERE op.owner_user_id=? AND op.project_id=COALESCE(custody_project,json_extract(public_header,'$.project_id'))) AS organization_scoped,
  EXISTS(SELECT 1 FROM project_resource_scopes rs WHERE rs.resource_id IN(event_id,custody_project,custody_document,
   json_extract(public_header,'$.project_id'),json_extract(public_header,'$.document_id'),json_extract(public_header,'$.block_id'),json_extract(public_header,'$.generation_id'),json_extract(public_header,'$.object_id'))) AS resource_scoped
  FROM sized),
 histogram AS (SELECT kind,actor_class,COUNT(*) AS n FROM classified GROUP BY kind,actor_class ORDER BY kind,actor_class)
 SELECT (SELECT COUNT(*) FROM bounded) AS scanned,
 COUNT(*) AS total,COALESCE(SUM(public_units+private_units),0) AS payload_units_lower_bound,COALESCE(SUM(public_bytes),0) AS public_bytes,COALESCE(SUM(private_bytes),0) AS private_bytes,
 COALESCE(MAX(MAX(public_bytes,private_bytes)),0) AS largest_cell,
 COALESCE(SUM(missing),0) AS missing_custody,COALESCE(SUM(foreign_custody),0) AS foreign_custody,
 COALESCE(SUM(redacted IS NOT NULL),0) AS redacted,COALESCE(SUM(custody_binding),0) AS custody_binding,
 COALESCE(SUM(event_scoped),0) AS event_scoped,COALESCE(SUM(organization_scoped),0) AS organization_scoped,
 COALESCE(SUM(resource_scoped),0) AS resource_scoped,
 COALESCE(SUM(schema_version<>1 OR compensates_event_id IS NOT NULL),0) AS identity_unsupported,
 COALESCE(SUM(type IN('DocumentCreated','DocumentForked') AND json_extract(public_header,'$.document_id')=?),0) AS selected_origins,
 (SELECT json_group_array(json_object('kind',kind,'actorClass',actor_class,'count',n)) FROM histogram) AS histogram
 FROM classified`).bind('creative:'+ownerId,...predicate.bindings,JSON.stringify(SOURCE_METADATA_KINDS),'user:'+ownerId,JSON.stringify([...PRIVATE_AUTHORED_EVENT_TYPES]),ownerId,ownerId,documentId);
 const result=await statement.all<Record<string,unknown>>();
 if(!result.success||result.results?.length!==1)fail();
 const row=result.results[0]!;
 const fields=['payload_units_lower_bound','scanned','total','public_bytes','private_bytes','largest_cell','missing_custody','foreign_custody','redacted','custody_binding','event_scoped','organization_scoped','resource_scoped','identity_unsupported','selected_origins'];
 if(Object.keys(row).sort().join()!==[...fields,'histogram'].sort().join()||fields.some(k=>!Number.isSafeInteger(row[k])||Number(row[k])<0)||Number(row.scanned)>limit+1||Number(row.total)>Number(row.scanned))fail();
 if(typeof row.histogram!=='string'||row.histogram.length>100000)fail();
 const histogram=JSON.parse(row.histogram as string) as Array<{kind:string;actorClass:string;count:number}>;
 if(!Array.isArray(histogram)||histogram.length>(SOURCE_METADATA_KINDS.length+1)*6||histogram.some(x=>Object.keys(x).sort().join()!=='actorClass,count,kind'
  ||!['personal-user','compiler','generator','policy','registry','other'].includes(x.actorClass)||!(x.kind==='unknown'||SOURCE_METADATA_KINDS.includes(x.kind))||!Number.isSafeInteger(x.count)||x.count<1)
  ||histogram.reduce((n,x)=>n+x.count,0)!==row.total)fail();
 const expected=canonicalConsent(result.results);
 const proof:EventReadProof={statements:[statement],verify(results){if(env.DB!==db||results.length!==1||results[0]?.success!==true||canonicalConsent(results[0].results)!==expected)throw Error('metadata_changed');}};
 const complete=Number(row.scanned)<=limit;
 return {proof,selectedOrigins:Number(row.selected_origins),metadata:{status:complete?'complete':'incomplete',complete,
  count:complete?Number(row.total):null,countLowerBound:Number(row.total),scannedStreamRows:Number(row.scanned),
  payloadCodepointLowerBound:Number(row.payload_units_lower_bound),publicPayloadBytes:Number(row.public_bytes),privatePayloadBytes:Number(row.private_bytes),largestCellBytes:Number(row.largest_cell),
  histogram,exclusions:Object.fromEntries(['missing_custody','foreign_custody','redacted','custody_binding','event_scoped','organization_scoped','resource_scoped','identity_unsupported'].map(k=>[k,Number(row[k])])),
  equality:'Aggregate observation only; counts, lengths and histogram do not prove event-body or semantic equality.'}};
}
