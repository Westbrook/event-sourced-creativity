import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture as nativeFixture} from './sponsor-story-native-fixture.mjs';
const [{describeSponsorStoryAdmission,readSponsorStoryTemplateEvidence},{loadOutputTrustedContext},{PRINCIPAL_WITH_ACCESS_SQL}]=await Promise.all([
  import('../worker/experience-sponsor-story-evidence.ts'),import('../worker/output-requirements-api.ts'),import('../worker/access-policy.ts'),
]);

const snapshot=f=>({
  tables:Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all()])),
  changes:f.sqlite.prepare('SELECT total_changes() AS n').get().n,
  schema:f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),
});
async function fixture(t){
  let network=0,media=0,assets=0;
  t.mock.method(globalThis,'fetch',()=>{network++;throw Error('No egress in Story evidence lifetime regression');});
  const f=await nativeFixture(t,{sponsor:false,strict:true}),controller=new AbortController();
  for(const operation of ['get','head','put','delete','list'])f.env.MEDIA[operation]=()=>{media++;throw Error('No media access');};
  f.env.ASSETS.fetch=()=>{assets++;throw Error('No asset fetch');};
  const request=new Request(f.request,{signal:controller.signal}),trusted=await loadOutputTrustedContext(request,f.env,f.documentId,'request');
  assert.ok(!(trusted instanceof Response));
  const description=await describeSponsorStoryAdmission(trusted,f.command),before=snapshot(f);
  Object.assign(f,{controller,request,trusted,description});
  f.read=kind=>kind==='description'?describeSponsorStoryAdmission(trusted,f.command):readSponsorStoryTemplateEvidence(trusted,f.command,description.recipe);
  f.noEffects=()=>{assert.deepEqual(snapshot(f),before);assert.equal(network,0);assert.equal(media,0);assert.equal(assets,0);f.limits.assertVerified();};
  return f;
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('genuine Story description and template evidence remain read-only under strict SQL limits',async t=>{
  const f=await fixture(t),description=await f.read('description'),template=await f.read('template');
  assert.deepEqual(description,f.description);assert.deepEqual(template.recipe,description.recipe);
  assert.equal(template.offered.settings.payload.artifactKind,'short_story');assert.ok(Object.isFrozen(template.offered));
  f.noEffects();t.diagnostic(JSON.stringify({strictStatements:f.limits.records.length,maximumBindings:Math.max(...f.limits.boundCounts),actualProviderRequests:0}));
});

for(const kind of ['description','template'])test(`Story ${kind} refuses cancellation while its actual final proof read is awaiting acknowledgment`,async t=>{
  const f=await fixture(t),batch=f.DB.batch.bind(f.DB),reached=deferred(),release=deferred();let count=0;
  f.DB.batch=async statements=>{const result=await batch(statements);count++;reached.resolve();await release.promise;return result;};
  const pending=f.read(kind);await reached.promise;f.controller.abort();release.resolve();
  try{await assert.rejects(pending,/sponsor_authority_changed/);assert.equal(count,1);}finally{f.noEffects();}
});

for(const kind of ['description','template'])test(`Story ${kind} refuses a sparse acknowledgment of its actual final proof read`,async t=>{
  const f=await fixture(t),batch=f.DB.batch.bind(f.DB);let dropped=false;
  f.DB.batch=async statements=>{const result=await batch(statements);assert.ok(result.length>2);delete result[1];dropped=true;return result;};
  try{await assert.rejects(f.read(kind),/sponsor_authority_changed/);assert.equal(dropped,true);}finally{f.noEffects();}
});

for(const kind of ['description','template'])test(`Story ${kind} rejects an already canceled call before any new database read`,async t=>{
  const f=await fixture(t),prepare=f.DB.prepare;let reads=0;
  f.DB.prepare=function(...args){reads++;return prepare.apply(this,args);};f.controller.abort();
  try{await assert.rejects(f.read(kind),/sponsor_authority_changed/);assert.equal(reads,0);}finally{f.noEffects();}
});

for(const kind of ['description','template'])for(const phase of ['principal','quote'])test(`Story ${kind} stops after cancellation during its actual ${phase} read`,async t=>{
  const f=await fixture(t),prepare=f.DB.prepare;let reached=false,readsAfterAbort=0;
  f.DB.prepare=function(sql){
    if(f.controller.signal.aborted)readsAfterAbort++;
    const matches=phase==='principal'?sql===PRINCIPAL_WITH_ACCESS_SQL:sql.startsWith('SELECT preflight.terms_digest');
    const wrap=statement=>{
      const bind=statement.bind;statement.bind=function(...values){return wrap(bind.apply(this,values));};
      const first=statement.first;statement.first=async function(...args){const value=await first.apply(this,args);if(matches){reached=true;f.controller.abort();}return value;};
      return statement;
    };
    return wrap(prepare.call(this,sql));
  };
  try{await assert.rejects(f.read(kind),/sponsor_authority_changed/);assert.equal(reached,true);assert.equal(readsAfterAbort,0);}finally{f.noEffects();}
});

test('captured Story context cannot be detached and mutated behind an equal replacement',async t=>{
  for(const kind of ['description','template']){
    const f=await fixture(t),prepare=f.DB.prepare,context=f.trusted.context;let reached=false;
    f.DB.prepare=function(sql){
      const wrap=statement=>{const bind=statement.bind;statement.bind=function(...values){return wrap(bind.apply(this,values));};
        const first=statement.first;statement.first=async function(...args){const value=await first.apply(this,args);
          if(sql===PRINCIPAL_WITH_ACCESS_SQL){reached=true;f.trusted.context=structuredClone(context);context.snapshot.detached_lifetime_probe=true;}return value;};return statement;};
      return wrap(prepare.call(this,sql));
    };
    try{await assert.rejects(f.read(kind),/sponsor_authority_changed/);assert.equal(reached,true);}finally{f.noEffects();}
  }
});

const malformed={
  'missing receipt':result=>result.slice(1),
  'extra receipt':result=>[...result,result[0]],
  'non-array batch':result=>({...result,length:result.length}),
  'absent success':result=>{delete result[0].success;return result;},
  'false success':result=>{result[0].success=false;return result;},
  'numeric success':result=>{result[0].success=1;return result;},
  'missing row':result=>{result[0].results=[];return result;},
  'sparse row':result=>{delete result[0].results[0];return result;},
  'extra row':result=>{result[0].results.push({current:1});return result;},
  'string proof':result=>{result[0].results[0].current='1';return result;},
  'boolean proof':result=>{result[0].results[0].current=true;return result;},
  'null proof':result=>{result[0].results[0].current=null;return result;},
  'inherited proof':result=>{result[0].results[0]=Object.create({current:1});return result;},
  'inherited receipt':result=>{const inherited=Object.create(Array.prototype);inherited[1]=result[1];delete result[1];Object.setPrototypeOf(result,inherited);return result;},
};
for(const kind of ['description','template'])test(`Story ${kind} requires dense explicit single-row numeric proof acknowledgments`,async t=>{
  for(const [name,mutate] of Object.entries(malformed)){
    const f=await fixture(t),batch=f.DB.batch.bind(f.DB);let reached=false;
    f.DB.batch=async statements=>{const result=await batch(statements);reached=true;return mutate(result);};
    try{await assert.rejects(f.read(kind),/sponsor_authority_changed/,name);assert.equal(reached,true,name);}finally{f.noEffects();}
  }
});

for(const kind of ['description','template'])for(const phase of ['construction','export resume'])test(`Story ${kind} refuses expiry at final ${phase}`,async t=>{
  const f=await fixture(t),batch=f.DB.batch.bind(f.DB),now=Date.now(),deadline=Date.parse(f.terms.expiresAt);let samples=0,reached=false;
  f.DB.batch=async statements=>{const result=await batch(statements);reached=true;
    t.mock.method(Date,'now',()=>++samples<=(phase==='construction'?1:2)?now:deadline);return result;};
  try{await assert.rejects(f.read(kind),/sponsor_authority_changed/);assert.equal(reached,true);}finally{f.noEffects();}
});
