import {generationReadiness,type StorageReadinessDiagnostic} from './generation-storage-readiness.ts';
import {holdAdministratorAuthority} from './budget-hold-dispositions.ts';
import {configuredPilotAdmissionGuard,requireExistingHoldAdministrator} from './pilot-policy.ts';
import {canReadOutputSchemaPreflight} from './output-schema-preflight.ts';
import type {WorkerEnv} from './runtime.ts';
import {applyEventSaveRepair,inspectEventSaveRepair,inspectEventSaveCompilation} from './event-save-repair.ts';
import {applyMemorySchemaRepair,inspectMemorySchemaRepair,MEMORY_SCHEMA_REPAIR_MANIFEST} from './memory-schema-repair.ts';
export const MEMORY_SCHEMA_REPAIR_PATH='/api/portfolio/engineering/memory-schema-repair';
export const EVENT_SAVE_REPAIR_PATH='/api/portfolio/engineering/event-save-repair';
const headers={'cache-control':'private, no-store','content-security-policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email, cf-access-authenticated-user-email'};
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export async function handleMemorySchemaRepair(request:Request,env:WorkerEnv):Promise<Response>{
 const saveRepair=new URL(request.url).pathname===EVENT_SAVE_REPAIR_PATH;
 const path=saveRepair?EVENT_SAVE_REPAIR_PATH:MEMORY_SCHEMA_REPAIR_PATH;
 const title=saveRepair?'Event save repair':'Memory schema repair';
 const deny=(error:string,status:number)=>Response.json({error},{status,headers});
 if(!['GET','POST'].includes(request.method))return deny('method_not_allowed',405);
 if(new URL(request.url).search)return deny('parameters_not_supported',400);
 if(/(?:^|;\s*)(?:forma_impersonation|forma_project_context)=/.test(request.headers.get('cookie')??''))return deny('return_to_principal_before_internal_access',409);
 if(request.method==='POST'&&(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('content-type')!=='application/x-www-form-urlencoded'))return deny('same_origin_form_required',403);
 const authorization=await requireExistingHoldAdministrator(request,env);
 if(authorization.response||!authorization.user){const r=authorization.response!;return new Response(r.body,{status:r.status,headers:{...Object.fromEntries(r.headers),...headers}});}
 if(!canReadOutputSchemaPreflight(authorization.user.access))return deny('access_denied',403);
 // The original installation requires its deployment opt-in. Save recovery is
 // an explicit principal-admin operation, exact-schema and empty-only, and
 // installs write barriers before disconnecting inactive Memory triggers.
 const enabled=(saveRepair||env.FORMA_MEMORY_SCHEMA_REPAIR_MANIFEST===MEMORY_SCHEMA_REPAIR_MANIFEST)
  && Object.entries(env).every(([key,value])=>!/^FORMA_MEMORY_.*ENABLED$/.test(key)||value===undefined||value===''||value==='false'||value==='0');
 try{
  if(request.method==='POST'){
   if(!enabled)return deny('repair_not_enabled',403);
   const reader=request.body?.getReader();if(!reader)return deny('invalid_form',400);
   let data='';const decoder=new TextDecoder('utf-8',{fatal:true});
   try{for(;;){const {value,done}=await reader.read();if(done)break;if(value.length+data.length>128){await reader.cancel();return deny('invalid_form',400);}data+=decoder.decode(value,{stream:true});}data+=decoder.decode();}finally{reader.releaseLock();}
   const form=new URLSearchParams(data);if([...form.keys()].join(',')!=='proof'||!/^[a-f0-9]{64}$/.test(form.get('proof')??''))return deny('invalid_form',400);
   const admin=holdAdministratorAuthority(authorization.user),pilot=configuredPilotAdmissionGuard(env,authorization.user);
   const result=await (saveRepair?applyEventSaveRepair:applyMemorySchemaRepair)(env.DB,form.get('proof')!,{sql:`(${admin.sql}) AND (${pilot.sql})`,bindings:[...(admin.bindings??[]),...(pilot.bindings??[])]});
   return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>'+title+'</title><h1>'+title+' completed</h1><pre>'+escape(JSON.stringify(result,null,2))+'</pre><p>Memory is still disabled. No enrollment, provider call or schedule was enabled.</p></html>',{headers:{...headers,'content-type':'text/html; charset=utf-8'}});
  }
  const plan=await (saveRepair?inspectEventSaveRepair:inspectMemorySchemaRepair)(env.DB);
  const compilation=saveRepair?await inspectEventSaveCompilation(env.DB):undefined;
  let storageDiagnostic:StorageReadinessDiagnostic|undefined;
  const storageReadiness=saveRepair?await generationReadiness(env,value=>{storageDiagnostic=value;}):undefined;
  const form=enabled&&(plan.summary.status==='ready'||saveRepair&&plan.summary.status==='complete')?`<form method="post" action="${path}"><input type="hidden" name="proof" value="${plan.proof}"><button type="submit">${saveRepair?(plan.summary.status==='complete'?'Verify saves with rolled-back probes':'Repair saves and block inactive Memory writes'):'Apply pinned Memory schema repair'}</button></form>`:'';
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>'+title+'</title><h1>'+title+' inspection</h1><pre>'+escape(JSON.stringify({...plan.summary,repairEnabled:enabled,...(compilation?{saveCompilation:compilation,storageReadiness,storageDiagnostic}:{})},null,2))+'</pre><p>Administrator-only, fixed schema operation. No arbitrary SQL, row export, enrollment, provider calls or schedules. Unknown schemas and populated new Memory tables block repair.</p>'+form+'</html>',{headers:{...headers,'content-type':'text/html; charset=utf-8'}});
 }catch(error){
  const code=saveRepair&&error instanceof Error&&/^event_save_repair_[a-z_]+$/.test(error.message)?error.message:'memory_schema_repair_unavailable';
  // The authenticated maintenance form must visibly report a failed operation.
  // JSON navigation failures otherwise leave the previous inspection on screen.
  // These fixed operations accept no record content or caller-provided SQL.
  if(saveRepair){
   const detail=error instanceof Error?error.message.slice(0,500):code;
   console.error('event_save_repair_failed',detail);
   if(request.headers.get('accept')?.includes('text/html'))return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>'+title+'</title><h1>'+title+' failed</h1><pre>'+escape(detail)+'</pre><p>Inspect the current schema before retrying.</p><a href="'+path+'">Inspect repair state</a></html>',{status:503,headers:{...headers,'content-type':'text/html; charset=utf-8'}});
  }
  return deny(code,503);
 }
}
