import {randomUUID,createHash} from 'node:crypto';
import {transaction} from './database.mjs';
import {foldEvents} from '../../src/model/events.ts';
import {authorityFromCreationProjection} from '../../worker/creation-authority.ts';
import {compileCreationPlan,creationHash} from '../../src/model/creation-validation.ts';
export const CONSENT='pilot-2026-08-10';
export class PilotError extends Error{constructor(code,status=409,revision){super(code);this.status=status;this.revision=revision;}}
/** Lock authority and workspace before any content access. Revocation uses the same order. */
export async function authority(db,actor,workspace,write=false){
 const {rows:[principal]}=await db.query('SELECT * FROM pilot.principals WHERE principal_id=$1 FOR SHARE',[actor]);
 if(!principal||principal.disabled_at)throw new PilotError('authentication_required',401);
 if(principal.consent_version!==CONSENT)throw new PilotError('consent_required',403);
 const {rows:[w]}=await db.query('SELECT * FROM pilot.workspaces WHERE workspace_id=$1 FOR UPDATE',[workspace]);
 if(!w)throw new PilotError('scope_denied',403);
 if(w.owner_id!==actor){const {rows:[m]}=await db.query('SELECT * FROM pilot.members WHERE workspace_id=$1 AND principal_id=$2 AND revoked_at IS NULL',[workspace,actor]);if(!m||(write&&!m.can_author))throw new PilotError('scope_denied',403);}
 return {principal,workspace:w};
}
export async function canonicalEvents(db,workspace){
 const {rows}=await db.query(`SELECT e.* FROM pilot.events e WHERE workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM pilot.sources s WHERE s.workspace_id=e.workspace_id AND s.withdrawn_at IS NOT NULL AND s.source_id IN(e.payload->>'project_id',e.payload->>'document_id',e.payload->>'block_id',e.payload->>'from_block_id',e.payload->>'to_block_id')) ORDER BY sequence`,[workspace]);
 return rows.map(e=>({eventId:e.event_id,streamId:'creative:'+workspace,sequence:Number(e.sequence),type:e.type,payload:e.payload,actor:e.actor,occurredAt:e.occurred_at.toISOString(),correlationId:e.operation_id}));
}
const bounded=value=>{const text=JSON.stringify(value);if(Buffer.byteLength(text)>1_000_000)throw new PilotError('creation_payload_too_large',413);return text;};
export class PlatformRepository{
 constructor(pool){this.pool=pool;}
 read(actor,workspace){return transaction(this.pool,async db=>{const a=await authority(db,actor,workspace);return {events:await canonicalEvents(db,workspace),head:Number(a.workspace.revision)};});}
 saveDraft(actor,workspace,draft,expectedRevision){return transaction(this.pool,async db=>{
  await authority(db,actor,workspace,true);bounded(draft);
  const {rows:[prior]}=await db.query('SELECT * FROM pilot.drafts WHERE draft_id=$1 FOR UPDATE',[draft.id]);
  if(prior&&(prior.actor_id!==actor||prior.workspace_id!==workspace))throw new PilotError('creation_draft_unavailable',404);
  if(prior&&(prior.state!=='active'||prior.expires_at<=new Date()))throw new PilotError('creation_draft_unavailable',404);
  if((prior?.revision??0)!==expectedRevision)throw new PilotError('creation_revision_conflict',409,prior?.revision);
  const revision=expectedRevision+1,payload={...draft,revision,acknowledgedRevision:revision};
  const {rows:[r]}=await db.query(`INSERT INTO pilot.drafts(draft_id,workspace_id,actor_id,revision,payload,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 day') ON CONFLICT(draft_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload RETURNING *`,[draft.id,workspace,actor,revision,payload]);return r;
 });}
 async commitPlan(actor,workspace,{draftId,expectedRevision,expectedHead,operationId,plan,review}){
  const requestHash=await creationHash({draftId,expectedRevision,expectedHead,plan,review});
  return transaction(this.pool,async db=>{
   const a=await authority(db,actor,workspace,true);
   const {rows:[prior]}=await db.query('SELECT * FROM pilot.operations WHERE operation_id=$1',[operationId]);
   if(prior){if(prior.actor_id!==actor||prior.workspace_id!==workspace||prior.request_hash!==requestHash)throw new PilotError('creation_operation_conflict');return prior.receipt;}
   const {rows:[draft]}=await db.query(`SELECT * FROM pilot.drafts WHERE draft_id=$1 AND actor_id=$2 AND workspace_id=$3 AND state='active' AND expires_at>clock_timestamp() FOR UPDATE`,[draftId,actor,workspace]);
   if(!draft||draft.revision!==expectedRevision)throw new PilotError('creation_revision_conflict',409,draft?.revision);
   if(Number(a.workspace.revision)!==expectedHead)throw new PilotError('creation_source_changed',409,Number(a.workspace.revision));
   if(await creationHash(draft.payload.plan)!==await creationHash(plan)||await creationHash(draft.payload.review)!==await creationHash(review))throw new PilotError('creation_preview_stale');
   const scope={actorUserId:actor,projectId:plan.scope.projectId,documentId:plan.scope.documentId,custodyKey:plan.scope.custodyKey,permissionEpoch:a.principal.permission_epoch};
   const custody='personal:'+a.workspace.owner_id;
   if(scope.custodyKey!==custody||plan.scope.actorUserId!==actor||plan.scope.permissionEpoch!==scope.permissionEpoch||plan.draftId!==draftId||plan.draftRevision!==expectedRevision)throw new PilotError('creation_scope_denied',403);
   const projection=foldEvents(await canonicalEvents(db,workspace),Infinity,scope.documentId??undefined,scope.projectId??undefined);
   const allocatedIds=Object.fromEntries([...plan.nodes.filter(n=>n.disposition==='retained'),...plan.references].map(n=>[n.id,'creation-'+createHash('sha256').update(actor+'\0'+operationId+'\0'+n.id).digest('hex').slice(0,40)]));
   const auth=await authorityFromCreationProjection(scope,plan.entryKind,projection,{canCreateProject:a.workspace.owner_id===actor,canAuthorProject:true,allocatedIds,selectedRootIds:draft.payload.referenceSelections?.flatMap(s=>s.rootIds)??[]});
   const compiled=await compileCreationPlan(plan,auth,review);
   let sequence=expectedHead;
   for(const e of compiled.events){await db.query('INSERT INTO pilot.events(event_id,workspace_id,sequence,type,payload,actor,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),workspace,++sequence,e.type,e.payload,actor,operationId]);for(const key of ['project_id','document_id','block_id'])if(e.payload[key])await db.query('INSERT INTO pilot.sources(source_id,workspace_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[e.payload[key],workspace]);}
   const receipt={schemaVersion:1,operationId,previewId:operationId,approvalHash:compiled.approvalHash,idMap:compiled.idMap,created:plan.nodes.filter(n=>n.disposition==='retained').map(n=>({id:compiled.idMap[n.id],kind:n.kind})),uses:compiled.changedUses,status:'committed',projectId:compiled.projectId,primaryDocumentId:compiled.primaryDocumentId,revision:sequence};
   await db.query('UPDATE pilot.workspaces SET revision=$2 WHERE workspace_id=$1',[workspace,sequence]);
   await db.query("UPDATE pilot.drafts SET state='applied',payload='{}' WHERE draft_id=$1",[draftId]);
   await db.query('INSERT INTO pilot.operations VALUES($1,$2,$3,$4,$5)',[operationId,workspace,actor,requestHash,receipt]);return receipt;
  });
 }
 revoke(actor,workspace,member){return transaction(this.pool,async db=>{const a=await authority(db,actor,workspace,true);if(a.workspace.owner_id!==actor||member===actor)throw new PilotError('scope_denied',403);await db.query('UPDATE pilot.members SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND principal_id=$2',[workspace,member]);});}
 withdraw(actor,workspace,source){return transaction(this.pool,async db=>{const a=await authority(db,actor,workspace,true);if(a.workspace.owner_id!==actor)throw new PilotError('scope_denied',403);const {rowCount}=await db.query(`UPDATE pilot.sources SET withdrawn_at=clock_timestamp(),erase_by=clock_timestamp()+interval '15 minutes',generation=generation+1 WHERE source_id=$1 AND workspace_id=$2 AND withdrawn_at IS NULL`,[source,workspace]);if(!rowCount)throw new PilotError('source_unavailable',404);await db.query("UPDATE pilot.objects SET state='erase' WHERE source_id=$1 AND state<>'erased'",[source]);await db.query("UPDATE pilot.jobs SET state='cancelled',fence=fence+1 WHERE source_id=$1 AND kind='index'",[source]);await db.query(`INSERT INTO pilot.jobs(job_id,workspace_id,source_id,kind,operation_id) VALUES($1,$2,$3,'cleanup',$1)`,[randomUUID(),workspace,source]);});}
}
