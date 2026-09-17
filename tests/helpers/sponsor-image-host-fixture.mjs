import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// This module has no node:test import and registers no tests. Its dependency
// registers the repository's actual TypeScript source loader before native
// modules are imported, so a separate local-D1 reviewer can reuse the fixture.
import {
  confirmationFixture,confirmationTerms,commitFromEmpty,count,attempts,nativeState,base,
} from '../sponsor-image-confirmation-fixture.mjs';

export {confirmationTerms,commitFromEmpty,count,attempts,nativeState,base};
export const modePath='/api/experiences/image/entry-mode';
export const entryConfig=campaignId=>({version:2,enabled:true,audience:'canonical-principal',output:'image',freshCampaignId:campaignId,generation:'disabled'});
export const freshSelector=()=>({kind:'fresh'});
export const draftSelector=draftId=>({draftId});
export const intentSelector=intentId=>({intentId});

export function modeRequest(f,selected=freshSelector(),{actorUserId=f.actor,headers={},signal,method='GET'}={}){
  const url=new URL(modePath,'http://localhost');
  if('draftId' in selected)url.searchParams.set('draftId',selected.draftId);
  if('intentId' in selected)url.searchParams.set('intentId',selected.intentId);
  return new Request(url,{method,headers:{...f.headersFor(actorUserId),...headers},...(signal?{signal}:{})});
}

/** Real native schema, canonical accounts, reviewed campaign and immutable V2
 * read-policy approval. No source, grant, hold or provider work is fabricated. */
export async function hostFixture(t,options={}){
  const f=await confirmationFixture(t,options);
  f.config=entryConfig(f.campaignId);
  f.modeRequest=(selected,options)=>modeRequest(f,selected,options);
  f.bootstrapAttempts=()=>attempts(f).filter(row=>row.operation==='image-intake-bootstrap');
  return f;
}

/** Populate the precise regression surface: an actual unrelated native
 * Document, plus actor-visible project-name metadata backed by a real private
 * ProjectRenamed event. Access rows are fixture data, never copied authority SQL. */
export async function seedCreativeSentinels(f){
  const [{appendAuditEvent},{PRINCIPAL_WITH_ACCESS_SQL}]=await Promise.all([
    import('../../worker/runtime.ts'),import('../../worker/access-policy.ts'),
  ]);
  const documentText='ENTRY_MODE_UNRELATED_DOCUMENT_c0b5eb6e_private_source';
  const projectName='ENTRY_MODE_ACTOR_PROJECT_07509826_private_name';
  const request=structuredClone(f.nativeRequest);request.intentId=randomUUID();
  request.values.subject={value:documentText,provenance:'authored'};
  const saved=await f.nativeCall('drafts','POST',request);assert.equal(saved.status,200);
  const {plan}=await saved.json();
  const committed=await f.nativeCall(`drafts/${plan.draftId}/commit`,'POST',{draftHash:plan.draftHash});assert.equal(committed.status,200);
  const renamed=await appendAuditEvent(f.env,f.stream,'user','ProjectRenamed',{project_id:plan.projectId,old_name:'Fixture project',new_name:projectName});
  const event=f.sqlite.prepare('SELECT sequence,recorded_at FROM events WHERE event_id=?').get(renamed.eventId);assert.ok(event);
  f.sqlite.prepare("INSERT INTO organizations(organization_id,name,owner_user_id,status,created_at,updated_at) VALUES('mode-sentinel-org','Synthetic fixture workspace',?,'active',?,?)")
    .run(f.actor,event.recorded_at,event.recorded_at);
  f.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES('mode-sentinel-member','mode-sentinel-org',?,'owner','active',?,?,?,?)")
    .run(f.actor,f.actor,event.recorded_at,event.recorded_at,event.recorded_at);
  f.sqlite.prepare("INSERT INTO organization_projects(project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at) VALUES('mode-sentinel-access',?,'mode-sentinel-org',?,'active',?,?)")
    .run(plan.projectId,f.actor,event.recorded_at,event.recorded_at);
  f.sqlite.prepare("INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) VALUES(?,'mode-sentinel-access','mode-sentinel-org',?,?,?,?,1,?,?)")
    .run(renamed.eventId,plan.projectId,f.actor,f.stream,event.sequence,f.actor,event.recorded_at);
  const nativePrincipal=f.sqlite.prepare(PRINCIPAL_WITH_ACCESS_SQL).get(f.actor);
  assert.ok(JSON.parse(nativePrincipal.projects_json).some(project=>project.projectName===projectName),'real creator principal projection must encounter the private name');
  const privateBodies=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE owner_id=?').all(f.actor).map(row=>row.private_json);
  assert.ok(privateBodies.some(body=>body.includes(documentText)));assert.ok(privateBodies.some(body=>body.includes(projectName)));
  return {documentText,projectName,plan};
}

/** Imports the actual Worker only when requested. Reviewers can instead attach
 * an actual local workerd/D1 fetch function to the same transport. */
export async function useActualWorker(f){
  const {default:worker}=await import('../../worker/index.ts');
  f.env.FORMA_SPONSOR_IMAGE_ENTRY=f.config;
  let detached=0;
  const context={waitUntil(){detached++;throw Error('Image host fixture prohibits detached work');}};
  f.route=(request,env=f.env)=>worker.fetch(request,env,context);
  f.assertNoDetachedWork=()=>assert.equal(detached,0);
  return f;
}

/** The native statement and every binding execute unchanged. Hooks permit a
 * competing SQLite mutation or a delayed DB response at a real await boundary;
 * neither hook creates an authority or substitutes a successful query result. */
export function observeHostDatabase(f,{beforeExecute,afterExecute,beforeCall}={}){
  const prepare=f.DB.prepare.bind(f.DB),wrapped=new WeakSet(),records=[];
  let stage='entry-mode';
  const wrap=statement=>{
    if(wrapped.has(statement))return statement;
    wrapped.add(statement);
    const bind=statement.bind.bind(statement),execute=statement.execute.bind(statement);
    statement.bind=(...bindings)=>wrap(bind(...bindings));
    statement.execute=kind=>{
      const record={stage,kind,sql:statement.sql,bindings:[...statement.bindings],sqlBytes:Buffer.byteLength(statement.sql)};
      records.push(record);
      beforeExecute?.(record);
      try{
        const result=execute(kind);
        record.result=structuredClone(result);
        record.returnedBytes=Buffer.byteLength(JSON.stringify(result));
        afterExecute?.(record);
        return result;
      }catch(error){record.error=error.message;throw error;}
    };
    if(beforeCall)for(const method of ['first','all','run']){
      const actual=statement[method].bind(statement);
      statement[method]=async(...args)=>{
        await beforeCall({stage,method,sql:statement.sql,bindings:[...statement.bindings]});
        return actual(...args);
      };
    }
    return statement;
  };
  f.DB.prepare=sql=>wrap(prepare(sql));
  return {records,setStage(value){stage=value;},restore(){f.DB.prepare=prepare;}};
}

export function assertModeDescriptor(response,body,{mode,selector,actorUserId}){
  assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.ok(Buffer.byteLength(JSON.stringify(body))<=1024);
  assert.deepEqual(body,{version:1,mode,...(mode==='sponsor-image'?{actorUserId}:{}),selector});
}

export async function assertModeUnavailable(response){
  assert.ok(response instanceof Response);
  const body=await response.json();
  assert.notEqual(response.status,200,JSON.stringify(body));
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.notEqual(body.mode,'ordinary');
  assert.deepEqual(Object.keys(body),['error']);
  assert.ok(['sponsor_image_entry_mode_unavailable','sponsor_intake_post_read_cancelled',
    'sponsor_intake_read_deadline','sponsor_intake_read_limit_reached'].includes(body.error),body.error);
  assert.equal(response.status,body.error==='sponsor_intake_read_limit_reached'?429:409);
  assert.ok(Buffer.byteLength(JSON.stringify(body))<=1024);
  return body;
}

export function assertFullBootstrapCharge(f,row,{resourceKey=`bootstrap:${f.campaignId}`}={}){
  const operation=f.readTerms.operations['image-intake-bootstrap'];
  assert.equal(row.operation,'image-intake-bootstrap');
  assert.equal(row.campaign_id,f.campaignId);
  assert.equal(row.sponsor_policy_digest,f.compiled.policyDigest);
  assert.equal(row.actor_user_id,f.actor);
  assert.equal(row.resource_key,resourceKey);
  assert.equal(row.maximum_bytes,operation.maximumBytes);
  assert.equal(row.deadline_at_ms-row.admitted_at_ms,operation.deadlineMs);
  assert.equal(row.charged_through_ms-row.deadline_at_ms,f.readTerms.windowMs);
}

/** A returned name inside the established immutable approval metadata is an
 * explicitly accepted exception. Actual draft/event bodies remain forbidden. */
export function assertNoCreativeTransfer(records,privateTexts=[]){
  for(const record of records){
    const output=JSON.stringify(record.result??null);
    for(const text of privateTexts)if(text)assert.equal(output.includes(text),false,`private body transferred by ${record.sql.slice(0,100)}`);
    assert.doesNotMatch(record.sql,/^\s*SELECT\s+(?:content\s*,|(?:\w+\.)?private_json\b)/iu);
    assert.doesNotMatch(record.sql,/^\s*SELECT\s+principal\.\*/iu);
  }
}
