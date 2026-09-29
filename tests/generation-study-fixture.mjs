import { readFileSync,readdirSync } from 'node:fs';
import { registerOutputSourceImports,outputTestDatabase } from './output-execution-test-helpers.mjs';
import { png } from './output-asset-fixtures.mjs';
registerOutputSourceImports();
const { createNativeStudyHost }=await import('../evals/generation-reliability/native-host/host.mjs');
const { digest,HOST_LIMITS }=await import('../evals/generation-reliability/native-host/transport.mjs');
const { mockPlan,resealPlan,MOCK_RUNTIME }=await import('../evals/generation-reliability/bridge-fixtures/mock-host.mjs');
const { seal,hash }=await import('../evals/generation-reliability/core.mjs');
const { POLICY_VERSION }=await import('../worker/pilot-policy.ts');

export async function fixture(t,options={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())f.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  f.sqlite.exec(readFileSync(new URL('../db/generation-study.pending.sql',import.meta.url),'utf8'));
  const now=new Date().toISOString(),expiry=new Date(Date.now()+3600000).toISOString();
  f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES('mock-owner','owner@example.test','Offline fixture','admin',?,?,?,?)").run(POLICY_VERSION,now,now,now);
  const source='{"brief":"An adult botanist. No logos."}',direction='{"scene":"An adult botanist. No logos."}';
  for(const [id,kind,content] of [['source','document-artifact-input',source],['direction','provider-response',direction]])f.sqlite.prepare('INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)').run(id,'mock-owner',kind,content,now,expiry);
  let plan=mockPlan();
  const financial=seal('f2-financial',{version:'OFFLINE_TEST_ONLY_NOT_QUALIFIED_EVIDENCE',available:true,maximumCostMicrousd:1000000,pricingEvidence:{reviewExpiresAt:expiry},promptEvidence:[{sha256:plan.manifest.cells[0].promptHash,captureId:plan.candidate.id}]});
  plan=resealPlan(plan,{financial,candidate:{...plan.candidate,evidenceClass:'mock-host-fixture-never-real-source',retainedInputs:{sourceRef:'source',directionRef:'direction',sourceSha256:digest(source),directionSha256:digest(direction),authorityVersion:'OFFLINE-ONLY'}}});
  const grantId='offline-fixture';
  const grant=p=>f.sqlite.prepare("INSERT INTO generation_study_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)").run(grantId,'mock-owner',p.id,hash(p.runtimeIdentity),'source','direction',digest(source),digest(direction),'OFFLINE-ONLY',2000000,20000,expiry,'authorized');
  if(options.plan)plan=options.plan(plan);
  grant(plan);
  const env={...f.env,FORMA_GENERATION_STUDY_ENABLED:'1',FORMA_GENERATION_STUDY_ORIGIN:'https://study.example.test',OPENAI_API_KEY:'OFFLINE-SENTINEL'};
  const request=()=>new Request(env.FORMA_GENERATION_STUDY_ORIGIN+'/internal-study',{method:'POST',headers:{origin:env.FORMA_GENERATION_STUDY_ORIGIN,'oai-authenticated-user-id':'mock-owner','oai-authenticated-user-email':'owner@example.test'}});
  const financialPolicies=options.policies?options.policies(plan,expiry):[];
  const financialAccount={accountId:'offline-account',region:'offline-region'};
  const host=createNativeStudyHost(env,{plan,runtimeIdentity:MOCK_RUNTIME,financialPolicies,financialAccount}),args={grantId,trialId:plan.manifest.trials[0].id};
  const calls=[],original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    calls.push({url,body:init.body});
    if(options.fetch)return options.fetch(url,init,f);
    if(String(url).endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]},{headers:{'x-request-id':'mod-original'}});
    return Response.json({data:[{b64_json:Buffer.from(png({width:1536,height:1024})).toString('base64')}],...(options.missingUsage?{}:{usage:{input_tokens:10,output_tokens:20,total_tokens:30,input_tokens_details:{text_tokens:10,image_tokens:0}}})},{headers:{'x-request-id':'image-original'}});
  };
  t.after(()=>{globalThis.fetch=original;});
  const op=()=>f.sqlite.prepare('SELECT * FROM generation_study_operations').get();
  const run=()=>host.execute(request(),args);
  const charge=(overrides={})=>{const o=op(),c={requestId:o.provider_request_id,receiptHash:o.receipt_hash,cost:650,tokens:30,residual:0,...overrides};f.sqlite.prepare('INSERT INTO generation_study_charges VALUES(?,?,?,?,?,?,?,?,?,?)').run(o.operation_id,c.requestId,c.receiptHash,c.cost,c.tokens,'offline-charge-authority','offline-billing-receipt',now,hash({planId:plan.id,inventory:plan.inventory,limits:HOST_LIMITS}),c.residual);};
  return {...f,env,request,plan,host,args,calls,op,run,charge,expiry,financialPolicies,financialAccount};
}
