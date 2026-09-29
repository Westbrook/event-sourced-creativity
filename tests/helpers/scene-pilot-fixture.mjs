import assert from "node:assert/strict";
import { createSceneCostFixture } from "./scene-cost-fixture.mjs";

/** Real workspace, named enrollment, project membership and context routes; no permission stubs. */
export async function createPilotSceneFixture({count=9,medium="visual",mode="managed",pilot=true,member=false,cookieFree=false,shared=pilot||member||cookieFree,depth=true}={}) {
  const f=await createSceneCostFixture(count,medium,{shared,depth});
  const ownerHeaders={},actorUserId=member?"scene-pilot-member":f.owner;
  const actorHeaders=member?{"oai-authenticated-user-id":actorUserId,"oai-authenticated-user-email":actorUserId+"@example.test"}:{};
  let selectedHeaders=f.sharing?.headers??{},currentHeaders={...selectedHeaders},cohort=null,participantId=null;
  const select=headers=>{currentHeaders={...headers};f.setScopedHeaders(headers);};
  const asOwner=async(path,options={})=>{const previous=currentHeaders;select(ownerHeaders);try{return await f.request(path,options);}finally{select(previous);}};
  if(member) {
    select(actorHeaders);
    assert.equal((await f.request("/api/session")).status,200);
    const terms=await f.request("/api/session",f.json({action:"accept_terms",ownershipConfirmed:true,providerProcessingConfirmed:true}));
    assert.equal(terms.status,200,await terms.clone().text());
    const invite=await asOwner("/api/workspaces/"+f.sharing.organizationId+"/members",f.json({email:actorUserId+"@example.test",role:"member"}));
    assert.equal(invite.status,201,await invite.clone().text());const invitation=await invite.json();
    const accepted=await f.request("/api/workspaces/"+f.sharing.organizationId+"/invitations/"+invitation.invitationId+"/accept",
      f.json({token:new URL(invitation.invitationUrl).searchParams.get("token")}));
    assert.equal(accepted.status,200,await accepted.clone().text());
    const membership=await asOwner("/api/workspaces/"+f.sharing.organizationId+"/projects/"+f.sharing.projectAccessId+"/members",
      f.json({userId:actorUserId,role:"editor"}));
    assert.equal(membership.status,201,await membership.clone().text());
  }
  if(pilot) {
    const configured=await asOwner("/api/workspaces/"+f.sharing.organizationId+"/pilot",
      f.json({maxParticipants:3,participantCapMicrousd:15_000_000,organizationCapMicrousd:45_000_000}));
    assert.equal(configured.status,201,await configured.clone().text());cohort=await configured.json();
    if(member) {
      const enrolled=await asOwner("/api/workspaces/"+f.sharing.organizationId+"/pilot/participants",f.json({email:actorUserId+"@example.test",role:"member"}));
      assert.equal(enrolled.status,201,await enrolled.clone().text());participantId=(await enrolled.json()).participantId;
    } else participantId=f.sqlite.prepare("SELECT participant_id FROM pilot_participants WHERE cohort_id=? AND user_id=?").get(cohort.cohortId,actorUserId).participant_id;
  }
  if(shared) {
    select(actorHeaders);
    const context=await f.request("/api/workspaces/"+f.sharing.organizationId+"/projects/"+f.sharing.projectAccessId+"/context",{method:"POST"});
    assert.equal(context.status,200,await context.clone().text());
    selectedHeaders={...actorHeaders,cookie:context.headers.get("set-cookie").split(";")[0]};select(selectedHeaders);
    assert.equal((await f.request("/api/events?after=0&limit=2000&content=0")).status,200);
  }
  const contextId=shared?f.sqlite.prepare("SELECT context_id FROM project_context_sessions WHERE principal_user_id=? AND project_access_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").get(actorUserId,f.sharing.projectAccessId).context_id:null;
  if(cookieFree)select(actorHeaders);
  const originalRun=f.run.bind(f);f.payload.productionMode=mode;
  return {...f,actorUserId,actorHeaders,selectedHeaders,contextId,cohort,participantId,asOwner,
    async admit(){const inspected=await f.preview();assert.equal(inspected.response.status,200,JSON.stringify(inspected.body));const preview=inspected.body.sceneCostPreview;const admitted=await f.approve(preview);assert.equal(admitted.response.status,202,JSON.stringify(admitted.body));assert.equal(admitted.body.job.jobId,f.requestId);return preview;},
    async run(){const previous=currentHeaders;if(cookieFree)select(selectedHeaders);try{return await originalRun();}finally{select(previous);}},
    checkpoint(){return JSON.parse(f.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(f.requestId).result_json);},
    cost(){return f.sqlite.prepare("SELECT * FROM cost_budget_reservations WHERE owner_id=? AND operation='document-render:scene' ORDER BY created_at").all(actorUserId);},
    tokens(){return f.sqlite.prepare("SELECT * FROM budget_reservations WHERE owner_id=? AND operation='document-render:scene' ORDER BY created_at").all(actorUserId);},
    fixed(){return f.sqlite.prepare("SELECT * FROM pilot_cost_reservation_scopes WHERE actor_user_id=? ORDER BY created_at").all(actorUserId);},
  };
}

/** The same actual OpenAI route is intercepted; request input/call identity remains observable. */
export function scenePilotProvider(t,{badFirst=false,missingFirstItem=false,badAll=false,duplicateNarrative=false,duplicateAcrossPages=false,beforeReply,uncertainAt=0}={}) {
  const calls=[];
  t.mock.method(globalThis,"fetch",async(url,init)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    const request=JSON.parse(init.body),input=JSON.parse(request.input),index=calls.length+1;
    calls.push({request,input,clientRequestId:new Headers(init.headers).get("X-Client-Request-Id"),at:Date.now()});
    await beforeReply?.(index,input);
    if(index===uncertainAt)throw new TypeError("In-memory lost response after the provider POST may have arrived");
    const assigned=input.production?.assigned_scenes??[{title:"The harbor keeper",action:"The keeper checks harbor position 1."}];
    const groups=(input.combined_context_plan??[]).map(group=>group.context_key);
    const items=missingFirstItem&&index===1?[]:assigned.map(scene=>({title:scene.title,body:duplicateNarrative?"The keeper follows the wet trail to the lighthouse.":duplicateAcrossPages&&input.production?.page?.page_index>0&&!input.production.page.repair_issues?.length?calls[0].input.production.assigned_scenes[0].action:scene.action,
      notes:"Preserve this authored moment.",image_prompt:"",context_group_ids:badAll||badFirst&&index===1?[]:groups,slide:null}));
    return Response.json({id:"scene-pilot-response-"+index,model:"gpt-5.6-terra",
      output_text:JSON.stringify({title:"The complete harbor",summary:"Saved story continuity",content_markdown:items.map(item=>item.body).join("\n\n"),presentation:null,items}),
      usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
  });
  return calls;
}

export function pendingCheckpoint(statement) {
  if(!statement.sql.startsWith("UPDATE document_jobs SET result_json="))return null;
  for(const value of statement.values)if(typeof value==="string"&&value.startsWith("{")) {
    try {const result=JSON.parse(value),entries=Object.values(result.providerSubmissions??{});if(entries.some(entry=>entry.status==="pending"))return{result,entries};}catch{/* Not a checkpoint JSON binding. */}
  }
  return null;
}
