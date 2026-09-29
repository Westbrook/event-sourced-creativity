import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {instrumentD1Contract} from './output-d1-test-contract.mjs';
const root=new URL('../',import.meta.url).href;
const {outputTestDatabase,registerOutputSourceImports}=await import(root+'tests/output-execution-test-helpers.mjs');
const resolution=registerOutputSourceImports();
const [{ensureSchema,appendEvents,makeEvent},{POLICY_VERSION},{handleWorkspaces},{handleOutputRequirements},{handleEvents},{outputDocumentExecutionBridge},{extractSourceDocument,sourceDocumentEvidence,sourceDocumentEvidenceDigest},{ownerMediaNamespace},{snapshot}]=await Promise.all([
 import(root+'worker/runtime.ts'),import(root+'worker/pilot-policy.ts'),import(root+'worker/workspaces-api.ts'),import(root+'worker/output-requirements-api.ts'),import(root+'worker/events-api.ts'),import(root+'worker/output-document-execution.ts'),import(root+'src/model/source-documents.ts'),import(root+'src/model/media-ownership.ts'),import(root+'tests/output-presentation-fixtures.mjs'),
]).finally(()=>resolution.deregister());

/** Fresh test-only data plus actual workspace/package publication and adoption.
 * Regression for ordinary use of a published package owned by the same person.
 * There is no source-project history read or manual synchronization after the
 * package has been published. Initial target history is ordinary client usage.
 */
export async function sameOwnerPublishedFixture({sameProject=false}={}){
 const f=outputTestDatabase();f.d1Contract=instrumentD1Contract(f);
 const owner='dev-local-creative',stream=`creative:${owner}`,sourceProject='published-source-project',targetProject=sameProject?sourceProject:'published-target-project';
 const sourceDocument='published-source-document',documentId='published-target-document',sourceBlock='published-source-reference',referenceId='published-original-reference';
 const steps=[],init=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const responseBody=async(name,response,status)=>{const body=await response.json();steps.push({name,status:response.status,...(body.error?{error:body.error}:{})});assert.equal(response.status,status,`${name}: ${JSON.stringify(body)}`);return body;};
 const workspace=(path,body)=>handleWorkspaces(new Request(`http://localhost/api/workspaces${path.length?'/'+path.join('/'):''}`,body===undefined?{method:'POST'}:init(body)),f.env,path);
 await ensureSchema(f.env);const now=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)").run(owner,'creative@local.forma','Local creative',POLICY_VERSION,now,now,now);
 const mimeType='text/plain',bytes=new TextEncoder().encode('Retain the established community stewardship source.');
 const hash=createHash('sha256').update(bytes).digest('hex'),extracted=await extractSourceDocument(new File([bytes],'licensed-original.txt',{type:mimeType}));
 const evidenceHash=await sourceDocumentEvidenceDigest(sourceDocumentEvidence(extracted,hash,mimeType));
 const key=`${ownerMediaNamespace(owner)}/licensed-original.txt`,mediaUrl=`/api/media/${encodeURIComponent(key)}`;
 await f.env.MEDIA.put(key,bytes,{httpMetadata:{contentType:mimeType},customMetadata:{ownerId:owner,sha256:hash,mimeType,sourceEvidenceSha256:evidenceHash,rights:'asserted',originalName:'licensed-original.txt',sourceClassification:'non-sensitive-licensed'}});
 const original={reference_id:referenceId,media_url:mediaUrl,source_evidence_hash:evidenceHash,source_content_hash:hash,source_mime_type:mimeType,source_kind:extracted.sourceKind,extraction_status:extracted.status,text:extracted.text,source_citations:extracted.segments.map(segment=>({anchor:segment.anchor,excerpt:segment.text})),source_segment_count:extracted.segments.length,source_excerpt_truncated:extracted.truncated,authority:'authored',weight:1};
 const authored=[
  ['ProjectCreated',{project_id:sourceProject,name:'Original licensed corpus'}],
  ['DocumentCreated',{project_id:sourceProject,document_id:sourceDocument,title:'Licensed source document'}],
  ...(!sameProject?[['ProjectCreated',{project_id:targetProject,name:'Delivery project'}]]:[]),
  ['DocumentCreated',{project_id:targetProject,document_id:documentId,title:'Community stewardship'}],
  ...snapshot().facts.filter(fact=>String(fact.type).toLowerCase()!=='output').map((fact,index)=>['BlockCreated',{project_id:targetProject,document_id:documentId,block_id:fact.block_id,type:fact.type,scope:'document',position:String(index).padStart(3,'0'),handle:fact.block_id,properties:{...fact.properties,weight:1,...(fact.intent?{intent:fact.intent}:{})}}]),
  ['ReferenceIngested',{project_id:sourceProject,document_id:sourceDocument,reference_id:referenceId,source_ref:mediaUrl,source_type:'document',content_hash:hash,source_evidence_hash:evidenceHash,rights_class:'owned_or_licensed'}],
  ['BlockCreated',{project_id:sourceProject,document_id:sourceDocument,block_id:sourceBlock,type:'reference',scope:'document',position:'a0',handle:'source/licensed',properties:original}],
  ['RightsAsserted',{project_id:sourceProject,document_id:sourceDocument,reference_id:referenceId,rights_class:'owned_or_licensed'}],
 ];
 await appendEvents(f.env,authored.map(([type,payload])=>makeEvent(stream,0,`user:${owner}`,'systems-review-fixture','published-source-setup',type,payload)));
 const organization=await responseBody('create workspace',await workspace([],{name:'Uninterrupted same-owner delivery'}),201),organizationId=organization.organizationId;
 const sourceAccess=await responseBody('attach source project',await workspace([organizationId,'projects'],{projectId:sourceProject}),201),sourceAccessId=sourceAccess.projectAccessId;
 const targetAccess=sameProject?sourceAccess:await responseBody('attach target project',await workspace([organizationId,'projects'],{projectId:targetProject}),201),projectAccessId=targetAccess.projectAccessId;
 const selected=await workspace([organizationId,'projects',projectAccessId,'context']),cookie=selected.headers.get('set-cookie')?.split(';')[0];await responseBody('select target project',selected,200);assert.ok(cookie);
 const originalSourceRows=()=>f.sqlite.prepare(`SELECT event.event_id,event.type,event.payload,body.private_json FROM events event LEFT JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.stream_id=? AND COALESCE(json_extract(body.private_json,'$.document_id'),json_extract(event.payload,'$.document_id'))=? ORDER BY event.sequence`).all(stream,sourceDocument);
 const sourceBefore=originalSourceRows(),sourceCursor=()=>f.sqlite.prepare('SELECT status,last_owner_sequence FROM project_migration_states WHERE project_access_id=?').get(sourceAccessId);
 const packagePath=[organizationId,'context-packages'];
 const draft=await responseBody('create package HTTP',await workspace(packagePath,{name:'Verified licensed stewardship',sourceProjectAccessId:sourceAccessId,documentId:sourceDocument,blockIds:[sourceBlock],sourceRightsConfirmed:true,sourceNonSensitiveConfirmed:true}),201);
 await responseBody('publish package HTTP',await workspace([...packagePath,draft.packageId,'versions',draft.versionId,'publish']),200);
 const cursorAfterPublish=sourceCursor();
 const adopted=await responseBody('adopt package HTTP',await workspace([...packagePath,draft.packageId,'adopt'],{projectAccessId,documentId,versionId:draft.versionId,updateMode:'pinned'}),201);assert.ok(adopted.bindingId);
 assert.deepEqual(originalSourceRows(),sourceBefore);
 if(!sameProject)assert.deepEqual(sourceCursor(),cursorAfterPublish,'adoption does not refresh the licensed source project');
 const headers={cookie};
 await responseBody('ordinary initial target history',await handleEvents(new Request('http://localhost/api/events',{headers}),f.env),200);
 if(!sameProject)assert.deepEqual(sourceCursor(),cursorAfterPublish,'ordinary target history does not refresh the origin');
 const initialSourceCursor=sourceCursor();
 const reviewer='published-independent-reviewer',reviewerEmail='published-reviewer@local.forma';
 // Synthetic principal and explicit memberships/capability are fixture data;
 // context selection and every approval still use the real authorization path.
 f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)").run(reviewer,reviewerEmail,'Independent reviewer',POLICY_VERSION,now,now,now);
 f.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,'member','active',?,?,?,?)").run('published-reviewer-org',organizationId,reviewer,owner,now,now,now);
 f.sqlite.prepare("INSERT INTO project_memberships(membership_id,organization_id,project_access_id,project_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'viewer','active',?,?,?)").run('published-reviewer-project',organizationId,projectAccessId,targetProject,reviewer,owner,now,now);
 f.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,'project.review.approve','project',?,?,?,'active',?,?,?)").run('published-reviewer-capability',reviewer,organizationId,projectAccessId,targetProject,owner,now,now);
 const reviewerIdentity={'oai-authenticated-user-id':reviewer,'oai-authenticated-user-email':reviewerEmail};
 const reviewPath=[organizationId,'projects',projectAccessId,'context'];
 const reviewerContext=await handleWorkspaces(new Request(`http://localhost/api/workspaces/${reviewPath.join('/')}`,{method:'POST',headers:reviewerIdentity}),f.env,reviewPath);
 const reviewerCookie=reviewerContext.headers.get('set-cookie')?.split(';')[0];await responseBody('independent reviewer selects target context',reviewerContext,200);assert.ok(reviewerCookie);
 const reviewerHeaders={...reviewerIdentity,cookie:reviewerCookie};
 Object.assign(f.env,{OPENAI_API_KEY:'transport-test-only',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
 const execute={waitUntil(){throw new Error('No detached provider execution');}};
 const request=(path='/api/output-requirements',body)=>handleOutputRequirements(new Request(`http://localhost${path}${body?'':`${path.includes('?')?'&':'?'}documentId=${documentId}`}`,{...(body?init(body):{}),headers:{...(body?{'content-type':'application/json'}:{}),...headers}}),f.env,path.split('?')[0],execute,outputDocumentExecutionBridge);
 let sequence=0;const send=body=>request('/api/output-requirements',{documentId,expectedRevision:`output:${f.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?').get(stream).n}`,clientMutationId:`uninterrupted-${++sequence}`,...body});
 const reviewRequest=(path='/api/output-requirements',body)=>handleOutputRequirements(new Request(`http://localhost${path}${body?'':`${path.includes('?')?'&':'?'}documentId=${documentId}`}`,{...(body?init(body):{}),headers:{...(body?{'content-type':'application/json'}:{}),...reviewerHeaders}}),f.env,path.split('?')[0],execute,outputDocumentExecutionBridge);
 const reviewSend=body=>reviewRequest('/api/output-requirements',{documentId,expectedRevision:`output:${f.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?').get(stream).n}`,clientMutationId:`reviewer-${++sequence}`,...body});
 const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
 const close=()=>{try{assert.deepEqual(f.d1Contract.violations,[], 'no handled application error may hide a D1 contract violation');}finally{f.sqlite.close();}};
 const checkSource=()=>{assert.deepEqual(f.d1Contract.violations,[]);assert.deepEqual(originalSourceRows(),sourceBefore);if(!sameProject)assert.deepEqual(sourceCursor(),initialSourceCursor,'the journey must not refresh or reactivate its original source projection');};
 return{...f,request,send,reviewRequest,reviewSend,reviewerHeaders,reviewer,ok,headers,documentId,organizationId,projectAccessId,sourceAccessId,sourceProject,targetProject,sourceDocument,sourceBlock,referenceId,sourceCursor,initialSourceCursor,checkSource,close,steps,sameProject,packageId:draft.packageId,bindingId:adopted.bindingId};
}
