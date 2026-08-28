import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { enforceD1ExpressionDepth } from "./d1-expression-depth.mjs";
const base=new URL("../../",import.meta.url).href;
const resolution=registerHooks({resolve(specifier,context,nextResolve){const local=context.parentURL?.startsWith(base)&&!context.parentURL.includes("/node_modules/");return nextResolve(local&&specifier.startsWith(".")&&!/\.[a-z0-9]+$/i.test(specifier)?specifier+".ts":specifier,context);}});
const [{default:worker},{appendAuditEvent,readWorkspaceEvents},{storePrivateContent},{authoritativeCreativeContext},{foldEvents},{recommendProductionWorkflow,DOCUMENT_PRODUCTION_WORKFLOW_EVENT,productionWorkflowSourcesForStage,productionWorkflowStageStates}]=await Promise.all([import("../../worker/index.ts"),import("../../worker/runtime.ts"),import("../../worker/pilot-policy.ts"),import("../../worker/context-authority.ts"),import("../../src/model/events.ts"),import("../../src/model/production-workflow.ts")]).finally(()=>resolution.deregister());
export const sceneCostFixtureProof={fixtures:0,nativeQueries:new Set(),maximumBindings:0};
function sceneDatabase(){
  const sqlite=new DatabaseSync(":memory:");
  const controls={beforeRead:null,afterRead:null,beforeRun:null,beforeBatch:null,writes:[],bindings:[]};
  class Statement{
    constructor(sql,values=[]){this.sql=sql;this.values=values;}
    bind(...values){assert.ok(values.length<=100,"D1 accepts at most 100 bound parameters");controls.bindings.push(values.length);return new Statement(this.sql,values);}
    execute(kind){const statement=sqlite.prepare(this.sql);if(kind==="first")return statement.get(...this.values)??null;if(kind==="all")return{results:statement.all(...this.values),success:true,meta:{changes:0}};controls.writes.push(this.sql);const result=statement.run(...this.values);return{results:[],success:true,meta:{changes:Number(result.changes??0)}};}
    async first(){await controls.beforeRead?.(this);const value=this.execute("first");await controls.afterRead?.(this,value);return value;}
    async all(){await controls.beforeRead?.(this);const value=this.execute("all");await controls.afterRead?.(this,value);return value;}
    async run(){await controls.beforeRun?.(this);return this.execute("run");}
  }
  const DB={prepare:sql=>new Statement(sql),async batch(statements){await controls.beforeBatch?.(statements);sqlite.exec("BEGIN");try{const result=statements.map(statement=>statement.execute(/^\s*(SELECT|WITH)\b/iu.test(statement.sql)?"all":"run"));sqlite.exec("COMMIT");return result;}catch(error){sqlite.exec("ROLLBACK");throw error;}},async exec(sql){sqlite.exec(sql);return{count:1,duration:0};}};
  return{sqlite,DB,controls};
}
export async function createSceneCostFixture(count=9,medium="visual",{depth=false,shared=false,rightsDeadline=null}={}){
  const database=sceneDatabase(),background=[];
  const env={DB:database.DB,OPENAI_API_KEY:"in-memory-scene-test",OPENAI_MODEL:"gpt-5.6-terra",ASSETS:{fetch:async()=>new Response(null,{status:404})},MEDIA:{put:async()=>undefined,get:async()=>null}};
  let scopedHeaders={};
  const request=(route,init={})=>worker.fetch(new Request("http://localhost"+route,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),...scopedHeaders}}),env,{waitUntil(promise){background.push(promise);}});
  assert.equal((await request("/api/session")).status,200);
  database.sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
  assert.equal((await request("/api/events?after=0&limit=2000&content=0")).status,200);
  while(background.length)await Promise.all(background.splice(0));
  const owner="dev-local-creative",streamId="creative:"+owner,projectId="project-atmosphere",documentId="scene-reuse-document",requestId="scene-reuse-"+crypto.randomUUID();
  await appendAuditEvent(env,streamId,"user","DocumentCreated",{project_id:projectId,document_id:documentId,title:"One current authored direction"});
  await appendAuditEvent(env,streamId,"user","BlockCreated",{project_id:projectId,document_id:documentId,block_id:"scene-reuse-direction",type:"direction",handle:"direction/scene-reuse",position:"a",properties:{text:"The keeper checks the harbor.",weight:1,...(rightsDeadline?{license_expires_at:rightsDeadline}:{})}});
  const beats=["The keeper checks harbor position 1.","Mara unfolds a salt-stained chart beneath the brass lantern.","A fishing boat enters the channel with its engine silent.","The lookout raises a yellow flag over the northern pier.","An old radio crackles with a warning about the incoming storm.","Workers secure the abandoned ferry before the tide turns.","Mara notices a fresh footprint beside the locked warehouse.","The keeper follows the wet trail toward the lighthouse stairs.","A child returns a missing compass wrapped in a blue scarf.","Clouds conceal the moon while waves strike the outer breakwater.","The emergency bell rings three times across the sleeping town.","Mara discovers a handwritten message inside the supply cabinet.","A stranded sailor signals from the rocks with a broken torch.","The rescue crew lowers their smallest launch into dark water.","The keeper marks a safe route between the submerged pilings.","Mara welcomes the exhausted sailor onto the sheltered dock.","At sunrise the harbor reopens and the lighthouse lamp fades."];
  const items=Array.from({length:count},(_,i)=>({title:"Beat "+(i+1),body:beats[i%beats.length],notes:"Preserve this beat.",image_prompt:"",context_group_ids:[],slide:null}));
  const content=JSON.stringify({title:"Saved complete story",summary:"Ordered narrative",content_markdown:items.map(item=>item.body).join("\n\n"),presentation:null,items});
  const stored=await storePrivateContent(env,owner,"document-artifact",content);
  const completed=await appendAuditEvent(env,streamId,"worker:renderer","DocumentRenderCompleted",{project_id:projectId,document_id:documentId,artifact_id:"saved-scene-story",artifact_kind:"short_story",title:"Saved complete story",summary:"Ordered narrative",content_ref:stored.contentId,source_block_versions:[{block_id:"scene-reuse-direction",version:1}],item_count:count,items:items.map((item,index)=>({id:"story-part-"+index,title:item.title}))});
  const workflow=recommendProductionWorkflow({id:"scene-reuse-workflow",documentId,projectId,target:"scene",approvalRequired:false});
  workflow.stages.find(stage=>stage.id==="scene-final").sceneMedium=medium;
  workflow.stages[0].enabled=true;
  workflow.stages[0].source={outputKind:"artifact",outputId:"saved-scene-story",format:"short_story",documentId,sourceEventId:completed.eventId,revision:0,contentSha256:createHash("sha256").update(content).digest("hex"),approvalRequired:false,allowTextGuidance:false};
  await appendAuditEvent(env,streamId,"user",DOCUMENT_PRODUCTION_WORKFLOW_EVENT,{workflow_id:workflow.id,document_id:documentId,project_id:projectId,target_kind:"scene",workflow});
  const events=await readWorkspaceEvents(env,streamId),projection=foldEvents(events,Infinity,documentId,projectId);
  const trusted=authoritativeCreativeContext(events,{documentId,projectId});
  const sources=productionWorkflowSourcesForStage(workflow,"scene-final",productionWorkflowStageStates(workflow,projection,events));
  const payload={artifactKind:"scene",sceneRequestId:requestId,sceneMedium:medium,productionMode:"managed",locale:"en",snapshot:trusted.snapshot,sourceBlockVersions:trusted.sourceBlockVersions,documentRevision:trusted.documentRevision,workflowId:workflow.id,workflowStageId:"scene-final",workflowSources:sources};
  const json=input=>({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
  const submit=(body=payload)=>request("/api/document-jobs",json({kind:"render_document",documentId,sourceSurface:"document",payload:body}));
  let sharing=null;
  if(shared){
    await appendAuditEvent(env,streamId,"user","ArtifactApproved",{artifact_id:"saved-scene-story",document_id:documentId,project_id:projectId});
    const organization=await request("/api/workspaces",json({name:"Scene reuse test workspace"}));assert.equal(organization.status,201,await organization.clone().text());
    const organizationId=(await organization.json()).organizationId;
    const project=await request("/api/workspaces/"+organizationId+"/projects",json({projectId}));assert.equal(project.status,201,await project.clone().text());
    const projectAccessId=(await project.json()).projectAccessId;
    const context=await request("/api/workspaces/"+organizationId+"/projects/"+projectAccessId+"/context",{method:"POST"});assert.equal(context.status,200,await context.clone().text());
    scopedHeaders={cookie:context.headers.get("set-cookie").split(";")[0]};
    const contextId=database.sqlite.prepare("SELECT context_id FROM project_context_sessions WHERE project_access_id=? AND principal_user_id=? AND revoked_at IS NULL").get(projectAccessId,owner).context_id;
    sharing={organizationId,projectAccessId,contextId,headers:scopedHeaders};
  }
  const depthProof=depth?enforceD1ExpressionDepth({env,sqlite:database.sqlite}):null;
  return{...database,env,request,json,owner,streamId,projectId,documentId,requestId,events,projection,workflow,contentRef:stored.contentId,content,payload,submit,depthProof,sharing,
    async preview(overrides={}){const response=await submit({...payload,...overrides,sceneCostPreview:true});return{response,body:await response.json()};},
    async approve(preview,overrides={}){const response=await submit({...payload,...overrides,sceneCostConsent:{...preview,confirmed:true}});return{response,body:await response.json()};},
    async run(jobId=requestId){const response=await request("/api/document-jobs/"+encodeURIComponent(jobId)+"/run",json({}));return{response,body:await response.json()};},
    setScopedHeaders(headers){scopedHeaders={...headers};},
    counts(){return Object.fromEntries(["document_jobs","budget_reservations","cost_budget_reservations","cost_budget_counters"].map(table=>[table,database.sqlite.prepare("SELECT COUNT(*) AS count FROM "+table).get().count]));},
    close(){depthProof?.assertVerified();sceneCostFixtureProof.fixtures++;for(const proof of depthProof?.records??[])sceneCostFixtureProof.nativeQueries.add(proof.sql);sceneCostFixtureProof.maximumBindings=Math.max(sceneCostFixtureProof.maximumBindings,...database.controls.bindings);depthProof?.restore();database.sqlite.close();}
  };
}
