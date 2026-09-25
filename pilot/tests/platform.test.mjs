import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {poolFromEnvironment,migrate,transaction,assertSchema} from '../src/database.mjs';
import {PlatformRepository,CONSENT} from '../src/repository.mjs';
import {claim,finishMechanics} from '../src/jobs.mjs';
import {creationReviewHashes} from '../../src/model/creation-validation.ts';
import {plainTextIdeaBody} from '../../src/model/idea-body.ts';
import {foldEvents} from '../../src/model/events.ts';
import {withDocumentInRoute} from '../../src/model/routes.ts';
import {resolvePrincipal} from '../src/identity.mjs';
const enabled=!!process.env.PILOT_DATABASE_URL;
test('real PostgreSQL shared native graph, atomic save, conflict, revocation, withdrawal and fencing',{skip:!enabled},async()=>{
 const pool=poolFromEnvironment();try{
 await migrate(pool);await assertSchema(pool);const repo=new PlatformRepository(pool),suffix=randomUUID(),owner='owner-'+suffix,reader='reader-'+suffix,w='workspace-'+suffix;
 await transaction(pool,async db=>{for(const p of [owner,reader]){await db.query('INSERT INTO pilot.principals(principal_id,account_id,consent_version) VALUES($1,$2,$3)',[p,'account-'+suffix,CONSENT]);await db.query('INSERT INTO pilot.identity_bindings VALUES($1,$2,$3)',['test-issuer',p,p]);}await db.query('INSERT INTO pilot.workspaces(workspace_id,owner_id) VALUES($1,$2)',[w,owner]);await db.query('INSERT INTO pilot.members VALUES($1,$2,true,NULL)',[w,reader]);});
 assert.equal((await resolvePrincipal(pool,{issuer:'test-issuer',subject:owner})).principal_id,owner);
 const scope={actorUserId:owner,projectId:null,documentId:null,custodyKey:'personal:'+owner,permissionEpoch:1};
 const source='Harbor Notes. A keeper observes a quiet harbor.';
 const node=(id,kind,title)=>({id,kind,title,projectId:'new-project',revision:1,disposition:'retained',sourceEvidence:[{kind:'span',start:0,end:source.length,quote:source}]});
 const plan={schemaVersion:1,draftId:'draft-'+suffix,draftRevision:1,entryKind:'project',scope,sourceText:source,nodes:[node('new-project','project','Harbor'),node('new-document','document','Notes'),{...node('new-idea','idea','Keeper'),type:'direction',text:source,body:plainTextIdeaBody(source)}],uses:[{id:'use-keeper',documentId:'new-document',ideaId:'new-idea',order:0,revision:1,disposition:'retained',dependencyManifest:[]}],references:[],issues:[],coverage:[{start:0,end:source.length,nodeIds:['new-project','new-document','new-idea']}],decisions:[],modelVersion:'development-synthetic-no-provider',compiledEventBound:512};
 const hashes=await creationReviewHashes(plan),entry=h=>({presentedHash:h,approvedHash:h,complete:true});const review={schemaVersion:1,nodes:Object.fromEntries(Object.entries(hashes.nodeHashes).map(([k,h])=>[k,entry(h)])),uses:Object.fromEntries(Object.entries(hashes.useHashes).map(([k,h])=>[k,entry(h)])),stage:'final',lastAcknowledgedRevision:1,finalApprovalHash:hashes.approvalHash};
 const draft={id:plan.draftId,plan,review,referenceSelections:[]};await repo.saveDraft(owner,w,draft,0);
 await assert.rejects(()=>repo.saveDraft(reader,w,draft,1),/unavailable/);
 await assert.rejects(()=>repo.saveDraft(owner,w,draft,0),/revision_conflict/);
 const input={draftId:draft.id,expectedRevision:1,expectedHead:0,operationId:'operation-'+suffix,plan,review};
 const [a,b]=await Promise.all([repo.commitPlan(owner,w,input),repo.commitPlan(owner,w,input)]);assert.deepEqual(a,b);
 const shared=await repo.read(reader,w),projection=foldEvents(shared.events,Infinity,a.primaryDocumentId,a.projectId);assert.equal(projection.blocks.length,1);assert.equal(projection.blocks[0].id,a.idMap['new-idea']);
 assert.match(withDocumentInRoute('/',a.primaryDocumentId,'Notes'),/^\/document\/creation-.*\/notes$/);
 await assert.rejects(()=>repo.commitPlan(owner,w,{...input,operationId:'changed-'+suffix}),/revision_conflict/);
 await repo.revoke(owner,w,reader);await assert.rejects(()=>repo.read(reader,w),/scope_denied/);await assert.rejects(()=>repo.saveDraft(reader,w,{id:'denied-'+suffix},0),/scope_denied/);
 const job='job-'+suffix;await pool.query("INSERT INTO pilot.jobs(job_id,workspace_id,source_id,source_generation,kind,operation_id) VALUES($1,$2,$3,1,'index',$1)",[job,w,a.idMap['new-idea']]);
 const first=(await claim(pool,'worker-one',{cleanupOnly:false,limit:100})).find(j=>j.job_id===job);assert.ok(first);await pool.query("UPDATE pilot.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=$1",[job]);
 const second=(await claim(pool,'worker-two',{cleanupOnly:false,limit:100})).find(j=>j.job_id===job);assert.ok(second);assert.equal(await finishMechanics(pool,first),false);assert.equal(await finishMechanics(pool,second),true);assert.equal(await finishMechanics(pool,second),false);
 await repo.withdraw(owner,w,a.idMap['new-idea']);assert.equal(foldEvents((await repo.read(owner,w)).events,Infinity,a.primaryDocumentId,a.projectId).blocks.length,0);
 console.log(JSON.stringify({test:'pg-native-graph',workspace:w,project:a.projectId,document:a.primaryDocumentId,idea:a.idMap['new-idea'],revision:a.revision,formaRoute:withDocumentInRoute('/',a.primaryDocumentId,'Notes'),hosted:false,uiJourney:false}));
 }finally{await pool.end();}
});
