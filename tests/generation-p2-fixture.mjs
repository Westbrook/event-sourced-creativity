import {readFileSync,readdirSync} from 'node:fs';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {png} from './output-asset-fixtures.mjs';
registerOutputSourceImports();
const {createNativeStudyHost}=await import('../evals/generation-reliability/native-host/host.mjs');
const {makeSuppliedPlan,PROTOCOL}=await import('../evals/generation-reliability/p2/contract.mjs');
const {reviewBinding,principalFingerprint,retainSuppliedStudyInputs}=await import('../evals/generation-reliability/native-host/supplied-authority.mjs');
const {sealFinancialPolicy,imageFinancialScope,FINANCIAL_POLICY_VERSION}=await import('../evals/generation-reliability/native-host/financial-policy.mjs');
const {hash,canonical}=await import('../evals/generation-reliability/core.mjs');
const {safetyIdentifier,operationKey}=await import('../evals/generation-reliability/execution-plan.mjs');
const {HOST_LIMITS}=await import('../evals/generation-reliability/native-host/transport.mjs');
const {POLICY_VERSION}=await import('../worker/pilot-policy.ts');
export const packet=JSON.parse(readFileSync(new URL('../docs/evidence/generation-p2/pilot-packet.json',import.meta.url)));
export const runtime={adapterSha256:hash('OFFLINE-P2-runtime-not-deployed'),schema:'supplied-v2'};
export async function fixture(t,options={}){
 const f=outputTestDatabase(options.filename?{filename:options.filename}:undefined);t.after(()=>f.sqlite.close());
 const now='2026-09-24T12:00:00.000Z',expiry=packet.input.expiresAt,originalNow=Date.now;Date.now=()=>Date.parse(now);t.after(()=>{Date.now=originalNow;});
 f.sqlite.function('strftime',{varargs:true},format=>format==='%Y-%m'?now.slice(0,7):now);
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())f.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 for(const file of options.pairSchema?['generation-study-pair-v3.pending.sql']:['generation-study.pending.sql','generation-study-supplied-v2.pending.sql'])f.sqlite.exec(readFileSync(new URL('../db/'+file,import.meta.url),'utf8'));
 f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES('mock-owner','owner@example.test','OFFLINE P2 synthetic principal','admin',?,?,?,?)").run(POLICY_VERSION,now,now,now);
 const binding={reviewId:'OFFLINE-review',authorityVersion:'OFFLINE-v2',sourceRef:'p2-source',directionRef:'p2-direction',declaredAuthor:'agent-proposed-study-draft',approvedUse:PROTOCOL,expiresAt:expiry};
 const plan=makeSuppliedPlan({packet,user:safetyIdentifier('mock-owner'),runtimeIdentity:runtime,binding}),grantId='OFFLINE-grant';
 if(!options.noAuthority)f.sqlite.prepare('INSERT INTO generation_study_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)').run(grantId,'mock-owner',plan.id,hash(runtime),binding.sourceRef,binding.directionRef,packet.input.bytesSha256,packet.direction.sha256,binding.authorityVersion,3000000,20000,expiry,'authorized');
 const env={...f.env,FORMA_GENERATION_STUDY_ENABLED:'1',FORMA_GENERATION_STUDY_ORIGIN:'https://study.example.test',OPENAI_API_KEY:'OFFLINE-NON-CREDENTIAL'};
 const request=()=>new Request(env.FORMA_GENERATION_STUDY_ORIGIN+'/local-study',{method:'POST',headers:{origin:env.FORMA_GENERATION_STUDY_ORIGIN,'oai-authenticated-user-id':'mock-owner','oai-authenticated-user-email':'owner@example.test'}});
 const account={accountId:'OFFLINE-account',region:'OFFLINE-region'};
 const policies=plan.manifest.trials.map(trial=>sealFinancialPolicy({version:FINANCIAL_POLICY_VERSION,scope:imageFinancialScope(plan,trial,'mock-owner',account),mode:'accepted-estimate',reservationMicrousd:1000000,lifecycleReserveMicrousd:1000,estimate:{microusd:1000,assumptions:['OFFLINE synthetic arithmetic only'],costBasis:'OFFLINE',evidenceRef:'OFFLINE-estimate',reviewExpiresAt:expiry},bound:null,residualDecision:{accepted:true,unknownMaximumAccepted:true,decisionRef:'OFFLINE-NOT-REAL-ACCEPTANCE',liabilityOwner:'mock-owner'},maximumLossMicrousd:null,providerEnforcedChargeCap:false,expiresAt:expiry,inFlightLimit:1,stopBehavior:'stop-before-next-stage-no-retry',overrunPolicy:'retain-and-hold',nextPurchase:'after-settlement-and-funded-lifecycle',lifecycle:{scope:'all exact stages, artifact, private evidence, finance, deletion and reconciliation',liabilityOwner:'mock-owner',evidenceRef:'OFFLINE-lifecycle',through:'2026-10-02T00:00:00.000Z',maximumMicrousd:1000}}));
 for(const p of policies.filter(()=>!options.noAuthority&&!options.noFinancial))f.sqlite.prepare('INSERT INTO generation_study_financial_grants VALUES(?,?,?,?,?,?,?)').run(grantId,p.scope.operationId,'mock-owner',p.id,canonical(p),expiry,'authorized');
 if(!options.noAuthority&&!options.noReview)f.sqlite.prepare('INSERT INTO generation_study_supplied_reviews VALUES(?,?,?,?,?,?,?,NULL)').run(binding.reviewId,grantId,'mock-owner',await principalFingerprint(f.DB,'mock-owner'),options.reviewBinding??reviewBinding(plan),expiry,'authorized');
 const intake=()=>retainSuppliedStudyInputs(request(),env,{grantId,plan,source:JSON.stringify(packet.suppliedSnapshot),direction:JSON.stringify(packet.direction.value),financialPolicies:policies,financialAccount:account});
 if(!options.noIntake)await intake();
 const fresh=()=>createNativeStudyHost(env,{plan,runtimeIdentity:runtime,financialPolicies:policies,financialAccount:account}),host=fresh(),args=(arm='baseline')=>({grantId,trialId:arm});
 const op=(arm='baseline')=>f.sqlite.prepare('SELECT * FROM generation_study_operations WHERE trial_id=?').get(arm);
 const calls=[],original=globalThis.fetch;globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body),stage=url.endsWith('/moderations')?(typeof body.input[0]==='string'?'advisory':'moderation'):'image';calls.push({url,body:init.body,stage});
  if(options.fetch){const value=await options.fetch({url,init,body,stage,f,calls});if(value)return value;}
  return stage!=='image'?Response.json({results:body.input.map(()=>({flagged:false,categories:{}}))},{headers:{'x-request-id':'OFFLINE-'+calls.length}}):Response.json({data:[{b64_json:Buffer.from(png({width:1536,height:1024})).toString('base64')}],usage:{input_tokens:10,output_tokens:20,total_tokens:30,input_tokens_details:{text_tokens:10,image_tokens:0}}},{headers:{'x-request-id':'OFFLINE-'+calls.length}});
 };t.after(()=>{globalThis.fetch=original;});
 const charge=(arm='baseline')=>{const o=op(arm);f.sqlite.prepare('INSERT INTO generation_study_charges VALUES(?,?,?,?,?,?,?,?,?,?)').run(o.operation_id,o.provider_request_id,o.receipt_hash,650,30,'OFFLINE-authority','OFFLINE-receipt',now,hash({planId:plan.id,inventory:plan.inventory,limits:HOST_LIMITS}),null);};
 const event=(arm='baseline',patch={})=>{
  const o=op(arm),p=policies.find(p=>p.scope.operationId===o.operation_id),c=f.sqlite.prepare('SELECT * FROM generation_study_charges WHERE operation_id=?').get(o.operation_id),prior=f.sqlite.prepare('SELECT * FROM generation_study_reconciliations WHERE operation_id=? ORDER BY sequence DESC LIMIT 1').get(o.operation_id);
  const r={evidence_id:arm+'-'+((prior?.sequence??0)+1),operation_id:o.operation_id,sequence:(prior?.sequence??0)+1,previous_id:prior?.evidence_id??null,original_charge_hash:hash(c),policy_id:p.id,evidence_kind:'verified-incurred-charge',authority_version:'OFFLINE-verifier',evidence_ref:'OFFLINE-billing',recorded_at:now,provider_settled:1,incurred_microusd:650,incurred_tokens:30,remaining_uncertainty_microusd:0,lifecycle_microusd:800,lifecycle_scope:p.lifecycle.scope,liability_owner:'mock-owner',lifecycle_through:p.lifecycle.through,lifecycle_evidence_ref:'OFFLINE-lifecycle',lifecycle_closed:0,lifecycle_incurred_microusd:null,...patch};
  f.sqlite.prepare(`INSERT INTO generation_study_reconciliations (${Object.keys(r).join(',')}) VALUES(${Object.keys(r).map(()=>'?').join(',')})`).run(...Object.values(r));
 };
 const settle=async(arm='baseline')=>{charge(arm);event(arm);return fresh().reconcile(request(),args(arm));};
 const observe=(patch={})=>fresh().observe(request(),{...args(),safety:'clear',fidelity:'expected-failure',finding:'baseline tether',evidenceRef:'OFFLINE-human-observation-simulation',resume:true,...patch});
 return {...f,env,plan,grantId,request,args,host,fresh,calls,op,intake,charge,event,settle,observe,policies,account,operationKey};
}
