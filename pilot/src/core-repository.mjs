import {randomUUID} from 'node:crypto';
import {transaction,migrate} from './database.mjs';
import {contentCipher} from './cipher.mjs';
import {POLICY_VERSION} from '../../worker/policy-version.ts';
import {principalAccessFromRow,principalHasCapability} from '../../worker/access-policy.ts';
import {publicEventPayload} from '../../worker/event-privacy.ts';
import {foldEvents} from '../../src/model/events.ts';
import {authorityFromCreationProjection} from '../../worker/creation-authority.ts';
import {creationHash,compileCreationPlan,validateCreationPlan,creationReviewHashes,refreshCreationDependencyBindings,CreationValidationError} from '../../src/model/creation-validation.ts';
import {creationBindingIssues} from '../../src/model/creation-bindings.ts';
import {richDocumentText,decodeRichDocument} from '../../src/still/vendor/elements/rich-document.js';
import {validateIdeaBodyEvents} from '../../worker/idea-body-guards.ts';
import {validateIdeaMembershipEvents,projectOwnedIdeaInput} from '../../worker/idea-membership-guards.ts';
import {ideaDependencies} from '../../src/model/project-ideas.ts';
import {classifyCreationInput,creationMarkers} from '../../src/still/creation-input.ts';
import {rebindCreationCorrectionUndo} from '../../src/model/creation-corrections.ts';
import {ideaBodyReferences,decodeIdeaBody} from '../../src/model/idea-body.ts';
export class CoreError extends Error{constructor(code,status=409,extra={}){super(code);this.status=status;this.extra=extra;}}
const fail=(code,status=409,extra)=>{throw new CoreError(code,status,extra);};
const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9:_-]{1,180}$/.test(id);
const checkId=id=>{if(!safeId(id))fail('invalid_id',400);return id;};
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
export const CORE_MIGRATIONS=[new URL('../sql/001-platform.sql',import.meta.url),new URL('../sql/003-core.sql',import.meta.url)];
export const initializeCore=pool=>migrate(pool,CORE_MIGRATIONS);
export class CoreRepository{
 constructor(pool,{encryptionRoot,expiresAt}){this.pool=pool;this.cipher=contentCipher(encryptionRoot);if(!Number.isFinite(Date.parse(expiresAt)))throw Error('test_lifetime_required');this.expiresAt=expiresAt;}
 seal(value,id){return this.cipher.seal(value,'still-core-v1:'+id);}
 open(value,id){return this.cipher.open(value,'still-core-v1:'+id);}
 async principal(db,id,{consent=true}={}){
  if(Date.now()>=Date.parse(this.expiresAt))fail('test_release_expired',403);
  const {rows:[p]}=await db.query('SELECT * FROM pilot.principals WHERE principal_id=$1 AND disabled_at IS NULL FOR UPDATE',[id]);if(!p)fail('authentication_required',401);
  if(consent&&p.consent_version!==POLICY_VERSION)fail('pilot_terms_required',428,{policyVersion:POLICY_VERSION});return p;
 }
 enroll(identity){return transaction(this.pool,async db=>{
  if(!identity.email)fail('verified_email_required',403);
  const email=identity.email.toLowerCase(),{rows:[admission]}=await db.query('SELECT * FROM pilot.admissions WHERE email=$1 AND disabled_at IS NULL FOR UPDATE',[email]);if(!admission)fail('test_account_not_admitted',403);
  const {rows:[binding]}=await db.query('SELECT principal_id FROM pilot.identity_bindings WHERE issuer=$1 AND subject=$2',[identity.issuer,identity.subject]);
  if(binding){const p=await this.principal(db,binding.principal_id,{consent:false});if(p.email!==email)fail('identity_binding_changed',403);return p;}
  const {rowCount}=await db.query('SELECT 1 FROM pilot.principals WHERE lower(email)=$1',[email]);if(rowCount)fail('identity_binding_conflict',403);
  const id='test-'+randomUUID();await db.query('INSERT INTO pilot.principals(principal_id,account_id,email,display_name,role) VALUES($1,$1,$2,$3,$4)',[id,email,email.split('@')[0],admission.role]);await db.query('INSERT INTO pilot.identity_bindings VALUES($1,$2,$3)',[identity.issuer,identity.subject,id]);await db.query('INSERT INTO pilot.workspaces(workspace_id,owner_id) VALUES($1,$2)',['personal-'+id,id]);return this.principal(db,id,{consent:false});
 });}
 consent(actor,version){return transaction(this.pool,async db=>{await this.principal(db,actor,{consent:false});if(version!==POLICY_VERSION)fail('current_policy_required',400);await db.query('UPDATE pilot.principals SET consent_version=$2,consented_at=clock_timestamp() WHERE principal_id=$1',[actor,version]);return {accepted:true};});}
 async access(db,p){
  const {rows}=await db.query(`SELECT r.id AS project_id,r.workspace_id,w.owner_id,g.role FROM pilot.core_resources r JOIN pilot.workspaces w USING(workspace_id) LEFT JOIN pilot.core_grants g ON g.project_id=r.id AND g.principal_id=$1 AND g.revoked_at IS NULL WHERE r.kind='project' AND r.deleted_at IS NULL AND (w.owner_id=$1 OR g.principal_id=$1)`,[p.principal_id]);
  const projects=rows.map(r=>({organizationId:r.workspace_id,projectAccessId:r.project_id,projectId:r.project_id,projectName:'Test project',role:r.owner_id===p.principal_id?'owner':r.role}));
  const row={permission_epoch:p.permission_epoch,projects_json:JSON.stringify(projects),organizations_json:'[]',grants_json:'[]',identity_policies_json:'[]'};const access=await principalAccessFromRow(row,p.role);access.permissionEpoch=(await principalAccessFromRow({...row,projects_json:JSON.stringify(projects.filter(x=>x.role!=='owner'))},p.role)).permissionEpoch;return access;
 }
 async scope(db,p,resourceId,write=false){
  let resource;if(resourceId){const {rows:[r]}=await db.query('SELECT * FROM pilot.core_resources WHERE id=$1 AND deleted_at IS NULL',[checkId(resourceId)]);if(!r)fail('source_unavailable',404);resource=r;}
  const workspaceId=resource?.workspace_id??'personal-'+p.principal_id;
  const {rows:[w]}=await db.query('SELECT * FROM pilot.workspaces WHERE workspace_id=$1 FOR UPDATE',[workspaceId]);if(!w)fail('scope_denied',403);
  const access=await this.access(db,p),owner=w.owner_id===p.principal_id;
  if(resource){if(!principalHasCapability(access,write?'project.author':'project.read',{organizationId:workspaceId,projectAccessId:resource.project_id}))fail('scope_denied',403);}
  else if(write&&!['creator'].includes(p.role))fail('scope_denied',403);
  return {workspace:w,access,resource,projectId:resource?.project_id??null,owner,custodyKey:owner?'personal:'+p.principal_id:'project:'+workspaceId+':'+resource.project_id};
 }
 async events(db,scope){
  const {rows}=await db.query('SELECT * FROM pilot.core_events WHERE workspace_id=$1 AND ($2::text IS NULL OR project_id=$2) ORDER BY sequence',[scope.workspace.workspace_id,scope.owner?null:scope.projectId]);
  return rows.map(r=>({eventId:r.event_id,streamId:scope.owner?'creative:'+scope.workspace.owner_id:'project:'+scope.projectId,sequence:Number(r.sequence),type:r.type,payload:this.open(r.body,r.event_id),actor:scope.owner&&r.actor==='user:'+scope.workspace.owner_id?'user':r.actor,clientId:r.client_id,correlationId:r.operation_id,occurredAt:r.created_at.toISOString(),recordedAt:r.created_at.toISOString(),causationId:null,compensatesEventId:null,schemaVersion:1}));
 }
 async insert(db,scope,inputs,actor,operationId,clientId='still-creation'){
  let sequence=Number(scope.workspace.revision);const appended=[];
  for(const input of inputs){const p=input.payload,eventId=randomUUID(),projectId=p.project_id??scope.projectId;if(!projectId)fail('project_required',400);const payload=publicEventPayload(eventId,p,true).payload;
   await db.query('INSERT INTO pilot.core_events(event_id,workspace_id,project_id,sequence,type,public_payload,body,actor,client_id,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[eventId,scope.workspace.workspace_id,projectId,++sequence,input.type,payload,this.seal(p,eventId),'user:'+actor,clientId,operationId]);
   for(const [type,key,kind]of [['ProjectCreated','project_id','project'],['DocumentCreated','document_id','document'],['BlockCreated','block_id','idea']])if(input.type===type)await db.query('INSERT INTO pilot.core_resources(id,workspace_id,project_id,kind) VALUES($1,$2,$3,$4)',[p[key],scope.workspace.workspace_id,projectId,kind]);
   const now=new Date().toISOString();appended.push({eventId,streamId:scope.owner?'creative:'+scope.workspace.owner_id:'project:'+scope.projectId,sequence,type:input.type,payload:p,actor:scope.owner?'user':'user:'+actor,clientId,correlationId:operationId,occurredAt:now,recordedAt:now,causationId:null,compensatesEventId:null,schemaVersion:1});
  }
  await db.query('UPDATE pilot.workspaces SET revision=$2 WHERE workspace_id=$1',[scope.workspace.workspace_id,sequence]);scope.workspace.revision=sequence;return {appended,rejected:[],head:sequence};
 }
 read(actor,resourceId,after=0,limit=5000){return transaction(this.pool,async db=>{const p=await this.principal(db,actor),s=await this.scope(db,p,resourceId),all=await this.events(db,s),events=all.filter(e=>e.sequence>after).slice(0,limit);return {events,content:{},head:Number(s.workspace.revision),hasMore:all.filter(e=>e.sequence>after).length>events.length,nextAfter:events.at(-1)?.sequence??Number(s.workspace.revision)};});}
 async draftContext(db,p,draft,allocatedIds={}){
  const s=await this.scope(db,p,draft.entryKind==='project'?null:draft.scope.projectId,true);
  const scope={actorUserId:p.principal_id,projectId:draft.entryKind==='project'?null:s.projectId,documentId:draft.entryKind==='idea'?draft.scope.documentId:null,custodyKey:s.custodyKey,permissionEpoch:s.access.permissionEpoch};
  const events=await this.events(db,s),projection=foldEvents(events,Infinity,scope.documentId??'',scope.projectId??'');
  const authority=await authorityFromCreationProjection(scope,draft.entryKind,projection,{canCreateProject:s.owner&&p.role==='creator',canAuthorProject:true,allocatedIds,selectedSharedProjectId:s.owner?null:s.projectId,selectedRootIds:draft.referenceSelections.flatMap(x=>x.rootIds)});
  return {...s,scope,events,authority};
 }
 validateDraft(d){if(!d||d.schemaVersion!==1||!['project','document','idea'].includes(d.entryKind)||!d.scope||!Array.isArray(d.markers)||!Array.isArray(d.referenceSelections)||!Array.isArray(d.decisions)||JSON.stringify(d).length>800000)fail('creation_draft_invalid',400);decodeRichDocument(d.originalDocument);decodeRichDocument(d.workingDocument);}
 draft(actor,id,method,body={}){return transaction(this.pool,async db=>{
  const p=await this.principal(db,actor);let d,row;
  if(!id){d=structuredClone(body.draft);this.validateDraft(d);id=checkId(d.id);const current=await this.draftContext(db,p,d);d.scope=current.scope;d.revision=1;d.acknowledgedRevision=1;d.state='editing';d.expiresAt=this.expiresAt;
   await db.query('INSERT INTO pilot.core_drafts VALUES($1,$2,$3,$4,1,$5,\'active\')',[id,current.workspace.workspace_id,actor,current.projectId,this.seal(d,id)]);return {draft:d,scope:d.scope,revision:1,expiresAt:d.expiresAt};}
  ({rows:[row]}=await db.query("SELECT * FROM pilot.core_drafts WHERE draft_id=$1 AND actor_id=$2 AND state='active' FOR UPDATE",[checkId(id),actor]));if(!row)fail('creation_draft_unavailable',404);d=this.open(row.body,id);const current=await this.draftContext(db,p,d);
  if(method==='GET')return {draft:d,scope:current.scope,revision:row.revision,expiresAt:this.expiresAt};
  if(body.expectedRevision!==row.revision)fail('creation_revision_conflict',409,{revision:row.revision});
  if(method==='DELETE'){await db.query('DELETE FROM pilot.core_operations WHERE draft_id=$1',[id]);await db.query('DELETE FROM pilot.core_drafts WHERE draft_id=$1',[id]);return {discarded:true};}
  const next=structuredClone(body.draft);this.validateDraft(next);if(next.entryKind!==d.entryKind||!same(next.scope,d.scope)||!same(d.scope,current.scope))fail('creation_scope_denied',403);
  next.id=id;next.revision=row.revision+1;next.acknowledgedRevision=next.revision;next.expiresAt=this.expiresAt;next.state=next.plan?'review':'editing';if(next.plan){next.plan.scope=current.scope;next.plan.draftId=id;next.plan.draftRevision=next.revision;}if(next.review)next.review.lastAcknowledgedRevision=next.revision;
  await db.query('UPDATE pilot.core_drafts SET revision=$2,body=$3 WHERE draft_id=$1',[id,next.revision,this.seal(next,id)]);return {draft:next,scope:current.scope,revision:next.revision,expiresAt:this.expiresAt};
 });}
 creation(actor,id,action,body={}){return transaction(this.pool,async db=>{
  const p=await this.principal(db,actor),{rows:[row]}=await db.query('SELECT * FROM pilot.core_drafts WHERE draft_id=$1 AND actor_id=$2 FOR UPDATE',[checkId(id),actor]);if(!row)fail('creation_draft_unavailable',404);
  const d=this.open(row.body,id),current=await this.draftContext(db,p,d),common={scope:current.scope,revision:row.revision};
  if(action==='operations'||action==='apply'){
   const {rows:[o]}=await db.query('SELECT * FROM pilot.core_operations WHERE operation_id=$1 AND actor_id=$2 AND draft_id=$3',[checkId(body.operationId),actor,id]);if(!o)fail('creation_operation_unavailable',404);const v=this.open(o.body,o.operation_id);
   if(o.state==='applied')return {...common,receipt:v.receipt,status:'applied',operationId:o.operation_id};if(action==='operations')return {...common,status:o.state,operationId:o.operation_id};
   if(row.state!=='active'||body.approvalHash!==v.compiled.approvalHash||row.revision!==v.revision)fail('creation_preview_stale');
   if(Number(current.workspace.revision)!==v.head||!same(d.scope,current.scope))fail('creation_source_changed');
   const authority={...current.authority,allocatedIds:v.compiled.idMap};const compiled=await compileCreationPlan(d.plan,authority,d.review);if(await creationHash(compiled)!==await creationHash(v.compiled))fail('creation_source_changed');
   const result=await this.insert(db,current,compiled.events,actor,o.operation_id),receipt={schemaVersion:1,operationId:o.operation_id,previewId:o.operation_id,approvalHash:compiled.approvalHash,idMap:compiled.idMap,created:d.plan.nodes.filter(n=>n.disposition==='retained').map(n=>({id:compiled.idMap[n.id],kind:n.kind})),uses:compiled.changedUses,status:'committed',projectId:compiled.projectId,primaryDocumentId:compiled.primaryDocumentId,revision:result.head};
   await db.query("UPDATE pilot.core_operations SET state='applied',body=$2 WHERE operation_id=$1",[o.operation_id,this.seal({receipt},o.operation_id)]);const erased={id:d.id,entryKind:d.entryKind,scope:d.scope,referenceSelections:[]};await db.query("UPDATE pilot.core_drafts SET state='applied',body=$2 WHERE draft_id=$1",[id,this.seal(erased,id)]);return {...common,receipt};
  }
  if(row.state!=='active')fail('creation_draft_unavailable',404);if(body.expectedRevision!==row.revision)fail('creation_revision_conflict');if(!same(d.scope,current.scope))fail('creation_scope_denied',403);
  if(action==='interpret')fail('creation_interpretation_unavailable',503);
  if(action==='use-preview'||action==='use'){
   const roots=body.rootIds;if(!Array.isArray(roots)||!roots.length||roots.some(id=>!current.authority.existingBlocks.some(b=>b.id===id)))fail('creation_reference_denied',403);
   const sourceBodies=ideaDependencies(roots,current.authority.existingBlocks,current.authority.existingRelations),selection={id:randomUUID(),projectId:d.scope.projectId,rootIds:roots,sources:sourceBodies.map(b=>current.authority.existingVersions.find(v=>v.id===b.id))};if(body.expectedSources&&!same(body.expectedSources,selection.sources))fail('creation_source_changed');
   const dependencyManifests=Object.fromEntries(roots.map(root=>[root,ideaDependencies([root],current.authority.existingBlocks,current.authority.existingRelations).map(b=>current.authority.existingVersions.find(v=>v.id===b.id))]));if(action==='use'){d.referenceSelections.push(selection);d.revision++;d.acknowledgedRevision=d.revision;await db.query('UPDATE pilot.core_drafts SET revision=$2,body=$3 WHERE draft_id=$1',[id,d.revision,this.seal(d,id)]);return {draft:d,selection,sourceBodies,dependencyManifests,scope:d.scope,revision:d.revision};}return {...common,selection,sourceBodies,dependencyManifests};
  }
  if(!d.plan)fail('creation_plan_required');if(d.plan.sourceText!==richDocumentText(d.workingDocument))fail('creation_source_text_mismatch');if(d.plan.titleOnly&&classifyCreationInput(d.plan.sourceText,creationMarkers(d.plan.sourceText))!=='title'&&!d.decisions.some(x=>x.accepted&&x.kind==='correction'&&x.detail==='explicit-title-classification'))fail('creation_title_requires_review');const bindingIssues=creationBindingIssues(d,d.plan);
  if(action==='review'){const validation=await validateCreationPlan(d.plan,current.authority,undefined,{requireReview:false,requireAllocation:false});return {...validation,issues:[...validation.issues,...bindingIssues],...await creationReviewHashes(d.plan,current.authority),...common};}
  if(bindingIssues.length)throw new CreationValidationError(bindingIssues);
  if(action==='refresh'){
   const before=d.referenceSelections.flatMap(s=>s.sources),roots=d.referenceSelections.flatMap(s=>s.rootIds);
   for(const selection of d.referenceSelections){if(selection.rootIds.some(id=>!current.authority.existingBlocks.some(b=>b.id===id)))fail('creation_source_unavailable');selection.sources=ideaDependencies(selection.rootIds,current.authority.existingBlocks,current.authority.existingRelations).map(b=>current.authority.existingVersions.find(v=>v.id===b.id));}
   d.plan=rebindCreationCorrectionUndo(d.plan,refreshCreationDependencyBindings(d.plan,current.authority));const after=d.referenceSelections.flatMap(s=>s.sources),changedSources=[...new Set([...before,...after].map(s=>s.id))].filter(id=>!same(before.find(s=>s.id===id),after.find(s=>s.id===id)));
   const hashes=await creationReviewHashes(d.plan,current.authority),previous=d.review;
   const retain=(entries,current)=>Object.fromEntries(Object.entries(entries??{}).filter(([id,e])=>e.presentedHash===current[id]).map(([id,e])=>[id,{...e,approvedHash:e.approvedHash===current[id]?e.approvedHash:undefined}]));
   d.revision++;d.acknowledgedRevision=d.revision;d.plan.draftRevision=d.revision;
   d.review={schemaVersion:1,nodes:retain(previous?.nodes,hashes.nodeHashes),uses:retain(previous?.uses,hashes.useHashes),stage:previous?.stage??'ideas',currentId:previous?.currentId,lastAcknowledgedRevision:d.revision,finalApprovalHash:previous?.finalApprovalHash===hashes.approvalHash?previous.finalApprovalHash:undefined};
   await db.query('UPDATE pilot.core_drafts SET revision=$2,body=$3 WHERE draft_id=$1',[id,d.revision,this.seal(d,id)]);return {draft:d,scope:d.scope,revision:d.revision,changedSources,sourceBodies:ideaDependencies(roots,current.authority.existingBlocks,current.authority.existingRelations),before,after};
  }
  if(action==='preview'){
   const op=checkId(body.operationId),requestHash=await creationHash({draft:d,head:Number(current.workspace.revision)}),{rows:[old]}=await db.query('SELECT * FROM pilot.core_operations WHERE operation_id=$1',[op]);if(old){if(old.actor_id!==actor||old.request_hash!==requestHash)fail('creation_operation_conflict');const v=this.open(old.body,op);return {...common,operationId:op,previewId:op,...v.compiled};}
   const allocatedIds={};for(const n of [...d.plan.nodes.filter(n=>n.disposition==='retained'),...d.plan.references])allocatedIds[n.id]='creation-'+(await creationHash({actor,operationId:op,tempId:n.id})).replace(/^sha256:/,'').slice(0,40);
   const compiled=await compileCreationPlan(d.plan,{...current.authority,allocatedIds},d.review);if(compiled.status==='no-change')return {...compiled,...common,open:{projectId:compiled.projectId,documentId:compiled.primaryDocumentId}};
   await db.query('INSERT INTO pilot.core_operations VALUES($1,$2,$3,$4,$5,$6,\'review\',$7)',[op,id,current.workspace.workspace_id,actor,current.projectId,requestHash,this.seal({compiled,head:Number(current.workspace.revision),revision:row.revision},op)]);return {...common,operationId:op,previewId:op,...compiled};
  }
  fail('pilot_route_unavailable',404);
 });}
 session(actor,resourceId){return transaction(this.pool,async db=>{
  const p=await this.principal(db,actor,{consent:false}),s=await this.scope(db,p,resourceId),access=s.access,role=access.projects.find(x=>x.projectId===s.projectId)?.role,capabilities=['self.profile.read','self.profile.manage',...(p.role==='creator'?['project.author','project.read']:['project.read'])];
  const budget={used:0,reserved:0,limit:0},cost={usedMicrousd:0,reservedMicrousd:0,limitMicrousd:0,remainingMicrousd:0};
  return {user:{userId:actor,email:p.email,displayName:p.display_name,role:p.role,consentVersion:p.consent_version,consentedAt:p.consented_at?.toISOString()??null},impersonation:null,policy:{version:POLICY_VERSION,accepted:p.consent_version===POLICY_VERSION,passiveCapture:false,externalAssetsRequireAssertion:true,retentionDays:Math.max(0,Math.ceil((Date.parse(this.expiresAt)-Date.now())/86400000)),sharing:'Named test principals only',attentionCapture:{available:false,defaultOn:false,retentionDays:0,rawInputCapture:false}},provider:{name:'disabled',model:'none',configured:false,plannerConfigured:false,videoConfigured:false,audioConfigured:false,model3dConfigured:false,imageProviders:[]},creation:{enabled:true,manualOnly:true},capabilities,permissionEpoch:access.permissionEpoch,organizations:[],projects:access.projects.filter(x=>x.role!=='owner'),budgets:{period:'test',user:budget,workspace:budget},costBudgets:{period:'test',currency:'USD',user:cost,workspace:cost},canvas:{version:'r1-disabled',mode:'pilot',pilotAvailable:false,access:false,accessReason:'pilot-gate-incomplete',blockedBy:[],requirements:[]},...(s.owner?{}:{projectContext:{organizationId:s.workspace.workspace_id,projectAccessId:s.projectId,projectId:s.projectId,ownerUserId:s.workspace.owner_id,role,permissions:role==='editor'?['project.read','project.author']:['project.read'],expiresAt:this.expiresAt}}),pilot:{release:'R1',providers:false,uploads:false,memory:false,expiresAt:this.expiresAt}};
 });}
 share(actor,projectId,target,role){return transaction(this.pool,async db=>{
  const p=await this.principal(db,actor),s=await this.scope(db,p,projectId,true);if(!s.owner||s.resource.kind!=='project')fail('owner_required',403);if(!['editor','viewer','revoked'].includes(role))fail('invalid_role',400);
  const {rows:[member]}=await db.query('SELECT * FROM pilot.principals WHERE lower(email)=$1 AND disabled_at IS NULL',[String(target).toLowerCase()]);if(!member||member.principal_id===actor)fail('test_principal_required',400);
  await db.query(`INSERT INTO pilot.core_grants(project_id,principal_id,role,revoked_at) VALUES($1,$2,$3,CASE WHEN $4 THEN clock_timestamp() END) ON CONFLICT(project_id,principal_id) DO UPDATE SET role=EXCLUDED.role,revoked_at=EXCLUDED.revoked_at`,[projectId,member.principal_id,role==='revoked'?'viewer':role,role==='revoked']);await db.query('UPDATE pilot.principals SET permission_epoch=permission_epoch+1 WHERE principal_id=$1',[member.principal_id]);return {projectId,principalId:member.principal_id,role};
 });}
 selection(actor,id){return transaction(this.pool,async db=>{const p=await this.principal(db,actor),s=await this.scope(db,p,id);return {id:s.resource?.id,kind:s.resource?.kind,projectId:s.projectId,documentId:s.resource?.kind==='document'?s.resource.id:null,owner:s.owner};});}
 append(actor,resourceId,body){return transaction(this.pool,async db=>{
  const p=await this.principal(db,actor);if(!['append','batch'].includes(body.action))fail('pilot_action_unavailable',404);const raw=body.events??[body.event];if(!Array.isArray(raw)||raw.some(e=>!e||typeof e.type!=='string'||!e.payload||typeof e.payload!=='object'))fail('invalid_events',400);const inputs=raw.map(projectOwnedIdeaInput);if(!inputs.length||inputs.length>64)fail('event_bound',400);
  const allowed=new Set(['ProjectRenamed','DocumentRenamed','DocumentViewed','BlockPropertyEdited','BlockRenamed','BlockWeightSet','BlockLocked','BlockUnlocked','BlockDocumentAttached','BlockDocumentDetached','BlockRelationAdded','BlockRelationRemoved']);
  const first=inputs[0].payload??{},selected=first.project_id||first.document_id||first.block_id||resourceId,s=await this.scope(db,p,selected,true);if(!selected)fail('project_required',400);
  const all=await this.events(db,s),projectId=s.projectId,projection=foldEvents(all,Infinity,first.document_id??'',projectId??'');
  const operation='event-'+await creationHash({actor,expectedSequence:body.expectedSequence,events:inputs}),requestHash=await creationHash(inputs),{rows:[prior]}=await db.query('SELECT * FROM pilot.core_operations WHERE operation_id=$1',[operation]);if(prior)return this.open(prior.body,operation);
  if(!Number.isSafeInteger(body.expectedSequence)||body.expectedSequence!==Number(s.workspace.revision))fail('stale_sequence',409,{head:Number(s.workspace.revision)});
  const pending=[];
  for(const input of inputs){const payload=input.payload;if(!allowed.has(input.type)||!payload||(payload.client_event_id!==undefined&&!safeId(payload.client_event_id)))fail('event_not_permitted_for_user',400);if(payload.project_id&&payload.project_id!==projectId)fail('scope_denied',403);payload.project_id=projectId;
   if(payload.document_id&&!projection.documents.some(d=>d.id===payload.document_id&&d.projectId===projectId&&!d.removed))fail('document_not_found',404);
   const view=foldEvents([...all,...pending],Infinity,payload.document_id??'',projectId),block=view.libraryBlocks.find(b=>b.id===payload.block_id&&!b.removed);
   if(input.type.startsWith('Block')&&!input.type.startsWith('BlockRelation')&&!block)fail('block_not_found',404);
   if(block&&block.projectId!==projectId)fail('scope_denied',403);
   if(input.type==='BlockPropertyEdited'){
    const key=String(payload.property_path??'');if(!['text','rich_text_body','type','position','weight','intent','active'].includes(key))fail('property_unavailable',400);
    if(block.locked)fail('block_locked');if(key==='rich_text_body'){const body=decodeIdeaBody(payload.new_value);if(!body)fail('invalid_idea_body',400);if(ideaBodyReferences(body).some(ref=>ref.projectId!==projectId||!view.libraryBlocks.some(b=>b.id===ref.blockId&&b.projectId===projectId&&!b.removed)))fail('reference_scope_denied',403);}
    const actual=key==='type'?block.type:key==='position'?block.position:block.properties[key];if(!Object.hasOwn(payload,'old_value')||!same(actual,payload.old_value))fail('context_value_conflict');
   }
   if(input.type==='BlockRenamed'&&(!Object.hasOwn(payload,'old_handle')||payload.old_handle!==block.handle))fail('context_value_conflict');
   if(input.type==='BlockWeightSet'&&Object.hasOwn(payload,'previous_weight')&&!same(payload.previous_weight,block.properties.weight))fail('context_value_conflict');
   if(input.type==='ProjectRenamed'&&payload.old_name!==undefined&&!same(payload.old_name,view.projects.find(x=>x.id===projectId)?.name))fail('context_value_conflict');
   if(input.type==='DocumentRenamed'&&payload.old_title!==undefined&&!same(payload.old_title,view.documents.find(x=>x.id===payload.document_id)?.title))fail('context_value_conflict');
   if(input.type==='BlockRelationAdded'&&![payload.from_block_id,payload.to_block_id].every(id=>view.libraryBlocks.some(b=>b.id===id&&b.projectId===projectId&&!b.removed)))fail('reference_scope_denied',403);
   if(input.type==='BlockRelationRemoved'&&!view.libraryBlockRelations.some(r=>r.id===payload.relation_id&&r.projectId===projectId&&!r.removed))fail('reference_scope_denied',403);
   pending.push({eventId:'validate-'+pending.length,sequence:Number(s.workspace.revision)+pending.length+1,type:input.type,payload});
  }
  const issue=validateIdeaMembershipEvents(all,inputs)??validateIdeaBodyEvents(all,inputs);if(issue)fail(issue.error,409,issue);
  const result=await this.insert(db,s,inputs,actor,body.correlationId===undefined?operation:checkId(body.correlationId),String(body.clientId??'web').slice(0,100));await db.query("INSERT INTO pilot.core_operations VALUES($1,NULL,$2,$3,$4,$5,'applied',$6)",[operation,s.workspace.workspace_id,actor,projectId,requestHash,this.seal(result,operation)]);return result;
 });}
 remove(actor,id){return transaction(this.pool,async db=>{
  const p=await this.principal(db,actor),s=await this.scope(db,p,id,true);if(!s.owner)fail('owner_required',403);if(s.resource.kind==='document')fail('document_deletion_unavailable',404);
  const all=await this.events(db,s),projection=foldEvents(all,Infinity,'',s.projectId);const refs=projection.libraryBlocks.filter(b=>!b.removed&&b.id!==id&&(b.properties.rich_text_body?ideaBodyReferences(b.properties.rich_text_body):[]).some(r=>r.blockId===id));if(s.resource.kind==='idea'&&refs.length)fail('source_has_references');
  const ids=new Set([id]);if(s.resource.kind==='project'){const {rows}=await db.query('SELECT id FROM pilot.core_resources WHERE project_id=$1',[id]);rows.forEach(r=>ids.add(r.id));}
  const erase=all.filter(e=>Object.values(e.payload).some(v=>typeof v==='string'&&ids.has(v))).map(e=>e.eventId);
  await db.query('DELETE FROM pilot.core_events WHERE event_id=ANY($1::text[])',[erase]);await db.query('UPDATE pilot.core_resources SET deleted_at=clock_timestamp() WHERE id=ANY($1::text[])',[[...ids]]);
  const mentions=value=>{if(typeof value==='string')return ids.has(value);if(Array.isArray(value))return value.some(mentions);return value&&typeof value==='object'&&Object.values(value).some(mentions);};
  for(const [table,key]of [['core_operations','operation_id'],['core_drafts','draft_id']]){const {rows}=await db.query(`SELECT ${key},body FROM pilot.${table} WHERE workspace_id=$1`,[s.workspace.workspace_id]);for(const row of rows)if(mentions(this.open(row.body,row[key])))await db.query(`DELETE FROM pilot.${table} WHERE ${key}=$1`,[row[key]]);}
  // Clear actor-private drafts and cached operation bodies in the affected project; no retained prose residues.
  await db.query('DELETE FROM pilot.core_operations WHERE workspace_id=$1 AND (project_id=$2 OR draft_id IN(SELECT draft_id FROM pilot.core_drafts WHERE workspace_id=$1 AND project_id=$2))',[s.workspace.workspace_id,s.projectId]);await db.query('DELETE FROM pilot.core_drafts WHERE workspace_id=$1 AND project_id=$2',[s.workspace.workspace_id,s.projectId]);
  await db.query('UPDATE pilot.workspaces SET revision=revision+1 WHERE workspace_id=$1',[s.workspace.workspace_id]);return {deleted:[...ids],physicalEventBodiesErased:erase.length,uploadsEnabled:false};
 });}
}
