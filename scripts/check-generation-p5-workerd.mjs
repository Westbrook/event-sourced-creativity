import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.resolve('wrangler/package.json'));
const {Miniflare}=require('miniflare');
const config=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
const checks=[];
for(const enabled of [false,true]){
const mf=new Miniflare({modules:true,scriptPath:resolve('dist/server/index.js'),modulesRoot:resolve('dist/server'),modulesRules:[{type:'ESModule',include:['**/*.js']},{type:'CompiledWasm',include:['**/*.wasm']}],compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindings:enabled?{FORMA_GENERATION_STUDY_APPROVAL_ENABLED:'1',FORMA_GENERATION_STUDY_ENABLED:'1'}:{},outboundService:()=>{throw Error('unexpected outbound');}});
try{
 for(const route of ['approval','execute','observe','recover','reconcile','stop','cleanup','cleanup-proposal']){
  const r=await mf.dispatchFetch('https://study.example.test/api/internal/generation-study/'+route,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  const body=await r.json();assert.equal(body.status,!enabled&&['approval','execute'].includes(route)?'disabled':'unconfigured');assert.equal(r.headers.get('cache-control'),'private, no-store');checks.push({enabled,route,status:r.status,result:body.status});
 }

}finally{await mf.dispose();}

}
 console.log(JSON.stringify({check:'built Worker local workerd empty configuration with both flags off and on',checks,dbBindingAbsent:true,storageBindingAbsent:true,providerCalls:0,managedSitesQualified:false,requestedCompatibilityDate:config.compatibility_date}));
