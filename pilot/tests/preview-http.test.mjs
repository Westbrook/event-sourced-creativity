import test from 'node:test';import assert from 'node:assert/strict';
test('running visual server discloses simulation, serves deep links and refuses unsupported/private/provider routes',{skip:!process.env.PILOT_PREVIEW_URL},async()=>{
 const base=process.env.PILOT_PREVIEW_URL;const get=p=>fetch(base+p);
 const meta=await (await get('/pilot.json')).json();assert.equal(meta.hosted,false);assert.match(meta.identity,/simulated/);assert.match(meta.persistence,/SQLite/);
 for(const route of ['/still','/still/action/new-project','/still/project/p/document/d','/still/project/p/document/d/page/2','/projects','/document/d/notes']){const r=await get(route);assert.equal(r.status,200,route);assert.match(await r.text(),/LOCAL PILOT/);}
 for(const route of ['/assets/missing.js','/api/admin','/api/maintenance','/private/test','/still/project/p/document/d/create/image'])assert.equal((await get(route)).status,404,route);
 assert.equal((await fetch(base+'/api/document-jobs',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,404);
 assert.equal((await fetch(base+'/api/still/creation/drafts',{method:'POST',headers:{origin:'https://hostile.invalid','content-type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/still/creation/drafts',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'})).status,415);
 assert.equal((await fetch(base+'/still',{method:'HEAD'})).status,200);
});
