// Child-process fixture only. All fetches intercepted. Never a live entry point.
import {readFileSync,writeFileSync} from 'node:fs';
import {fixture,runtime} from './generation-p2-fixture.mjs';
import {outputTestDatabase} from './output-execution-test-helpers.mjs';
const {createNativeStudyHost}=await import('../evals/generation-reliability/native-host/host.mjs');
const [mode,root]=process.argv.slice(2);
if(mode==='crash'){
 const f=await fixture({after(){}},{filename:root+'/state.sqlite'});
 writeFileSync(root+'/descriptor.json',JSON.stringify({plan:f.plan,policies:f.policies,account:f.account,grantId:f.grantId}));
 const batch=f.DB.batch;
 f.DB.batch=async statements=>{
  const r=await batch(statements);
  if(statements.some(s=>s.sql.includes('INSERT INTO generation_study_stages')&&s.bindings[1]==='image')){
   writeFileSync(root+'/calls.json',JSON.stringify(f.calls));process.exit(73);
  }return r;
 };
 await f.host.execute(f.request(),f.args());throw Error('crash hook missed');
}else if(mode==='restart'){
 const d=JSON.parse(readFileSync(root+'/descriptor.json')),f=outputTestDatabase({filename:root+'/state.sqlite'});
 Date.now=()=>Date.parse('2026-09-24T12:00:00.000Z');f.sqlite.function('strftime',{varargs:true},format=>format==='%Y-%m'?'2026-09':'2026-09-24T12:00:00.000Z');
 const env={...f.env,FORMA_GENERATION_STUDY_ENABLED:'1',FORMA_GENERATION_STUDY_ORIGIN:'https://study.example.test'};
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('restart must not dispatch');};
 const request=()=>new Request('https://study.example.test/local-study',{method:'POST',headers:{origin:'https://study.example.test','oai-authenticated-user-id':'mock-owner','oai-authenticated-user-email':'owner@example.test'}});
 const h=createNativeStudyHost(env,{plan:d.plan,runtimeIdentity:runtime,financialPolicies:d.policies,financialAccount:d.account});
 const first=await h.execute(request(),{grantId:d.grantId,trialId:'baseline'});let second;
 try{second=await h.execute(request(),{grantId:d.grantId,trialId:'treatment'});}catch(e){second={error:e.message};}
 writeFileSync(root+'/restart.json',JSON.stringify({first,second,calls,stages:f.sqlite.prepare('SELECT stage,status FROM generation_study_stages').all(),operations:f.sqlite.prepare('SELECT COUNT(*) n FROM generation_study_operations').get().n}));f.sqlite.close();
}else throw Error('fixture mode required');
