import test from 'node:test';
import assert from 'node:assert/strict';
import { StillClient } from '../src/still/client.ts';
import { operationJournal } from '../src/still/operation-journal.ts';

const session = {user:{userId:'economy',role:'creator',displayName:'Creator'},permissionEpoch:'1',policy:{accepted:true},provider:{configured:true,plannerConfigured:true}};
const event = (sequence,type,payload) => ({eventId:`e${sequence}`,sequence,type,payload,actor:'user',streamId:'creative:economy',clientId:'test',correlationId:'test',occurredAt:'2026-09-17T12:00:00Z',recordedAt:'2026-09-17T12:00:00Z',schemaVersion:1});
const initial = [event(1,'ProjectCreated',{project_id:'p',name:'Project'}),event(2,'DocumentCreated',{project_id:'p',document_id:'d',title:'Document'})];
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const page = (events=[],head=2,content) => json({events,head,nextAfter:head,hasMore:false,...(content?{content}:{})});
function client() { operationJournal.clearWrite('economy:personal');operationJournal.clearGeneration('economy:personal','d');const c=new StillClient();c.session=structuredClone(session);c.events=structuredClone(initial);c.head=2;c.position={...c.position,projectId:'p',documentId:'d',view:'document'};return c; }
async function network(handler,run) { const saved=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,init});return handler(url,init);};try {await run(calls);}finally{globalThis.fetch=saved;} }
const deferred = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('bootstrap uses one session and the compact workspace history',async()=>{
  const c=new StillClient();
  await network(url=>url==='/api/session?profile=still'?json(session):page(initial,2,{body:'Saved content'}),async calls=>{
    await c.load();assert.deepEqual(calls.map(c=>c.url),['/api/session?profile=still','/api/events?after=0&limit=6500&profile=workspace&content=0']);assert.equal(c.content.body,'Saved content');
  });
});
test('a normal save completes from its receipt with no history reload',async()=>{
  const c=client();
  await network((url,init)=>{if(url==='/api/session?profile=still')return json(session);assert.equal(url,'/api/events');const body=JSON.parse(init.body);assert.equal(body.expectedSequence,2);return json({appended:[{...event(3,body.event.type,body.event.payload),correlationId:body.correlationId}],head:3});},async calls=>{
    await c.append([c.blockEvent('Small idea','Idea')]);assert.equal(calls.length,2);assert.equal(c.head,3);assert.equal(c.projection.blocks[0].properties.text,'Small idea');assert.equal(c.hasUnconfirmedWrite,false);
  });
});
test('an unchanged refresh fetches deltas only and retains private content without rerendering',async()=>{
  const c=client();c.content={body:'Saved content'};let changes=0;c.onChange=()=>changes++;
  await network(url=>url==='/api/session?profile=still'?json(session):page(),async calls=>{await c.refresh();assert.equal(calls.length,2);assert.match(calls[1].url,/content=0/);assert.equal(c.content.body,'Saved content');assert.equal(changes,0);});
});
test('new private references cause one hydration; subsequent idle refreshes do not',async()=>{
  const c=client();const rendered=event(3,'DocumentRenderCompleted',{document_id:'d',artifact_id:'a',content_ref:'new-body'});
  await network(url=>url==='/api/session?profile=still'?json(session):url.includes('content=1')?page([],3,{'new-body':'New story'}):url.includes('after=2')?page([rendered],3):page([],3),async calls=>{
    await c.refresh();assert.equal(calls.length,3);assert.equal(c.content['new-body'],'New story');await c.refresh();assert.equal(calls.length,5);
  });
});
test('stable terminal jobs do not reload events, overlapping polls share a request',async()=>{
  const c=client();c.jobs=[{jobId:'j',documentId:'d',status:'completed'}];
  await network(url=>url==='/api/session?profile=still'?json(session):json({jobs:c.jobs}),async calls=>{await Promise.all([c.pollJobs(),c.pollJobs()]);assert.equal(calls.length,2);assert.ok(calls.every(c=>!c.url.startsWith('/api/events')));await c.pollJobs();assert.equal(calls.length,4);});
});
test('a newly completed job refreshes results once using the current scope check',async()=>{
  const c=client();c.jobs=[{jobId:'j',documentId:'d',status:'running'}];
  await network(url=>url==='/api/session?profile=still'?json(session):url.startsWith('/api/document-jobs')?json({jobs:[{jobId:'j',documentId:'d',status:'completed'}]}):page(),async calls=>{
    await c.pollJobs();assert.equal(calls.length,3);await c.pollJobs();assert.equal(calls.length,5);
  });
});
test('artifact edits apply acknowledged content without rereading history',async()=>{
  const c=client();c.content={body:'Old story'};
  await network(url=>url==='/api/session?profile=still'?json(session):json({appended:[event(3,'DocumentArtifactEdited',{artifact_id:'a',content_ref:'body'})],head:3,content:{body:'New story'},revision:1}),async calls=>{
    await c.editArtifact('a','New story',0);assert.equal(calls.length,2);assert.equal(c.content.body,'New story');assert.equal(c.head,3);
  });
});
test('unchanged artifact edits accept the canonical no-op receipt',async()=>{
  const c=client();
  await network(url=>url==='/api/session?profile=still'?json(session):json({appended:[],content:{body:'Same story'},revision:0}),async calls=>{await c.editArtifact('a','Same story',0);assert.equal(calls.length,2);assert.equal(c.head,2);assert.equal(c.content.body,'Same story');});
});
test('generation submits the reviewed source revision without a redundant history read',async()=>{
  const c=client(),draft=c.prepareGeneration('image');
  await network((url,init)=>{if(url==='/api/session?profile=still')return json(session);if(url.endsWith('/run'))return json({});assert.equal(url,'/api/document-jobs');const body=JSON.parse(init.body);assert.equal(body.payload.expectedDocumentRevision,draft.sourceRevision);assert.deepEqual(body.payload.snapshot,draft.sourceSnapshot);return json({job:{jobId:'j',documentId:'d',status:'queued'}});},async calls=>{
    await c.generate(draft);assert.equal(calls.length,2);assert.ok(calls.every(c=>!c.url.startsWith('/api/events')));
  });
});
test('server revision conflicts retain the reviewed draft and never retry admission',async()=>{
  const c=client(),draft=c.prepareGeneration('image');
  await network(url=>url==='/api/session?profile=still'?json(session):json({error:'context_source_version_mismatch',message:'Document changed'},409),async calls=>{
    await assert.rejects(c.generate(draft),/Document changed/);assert.equal(calls.length,2);assert.equal(draft.attempted,false);assert.equal(c.pendingGeneration,null);
  });
});
test('a late history read cannot regress an acknowledged edit or the event cursor',async()=>{
  const c=client();c.content={body:'Latest story',expired:'Expired body'};
  const reading=deferred(),release=deferred();const external=event(3,'DocumentArtifactEdited',{artifact_id:'other',content_ref:'body'});
  await network(async(url,init)=>{
    if(url==='/api/session?profile=still')return json(session);
    if(init?.method==='PATCH')return json({appended:[event(4,'DocumentArtifactEdited',{artifact_id:'a',content_ref:'body'})],head:4,content:{body:'Latest story'},revision:1});
    if(url.includes('content=1')){reading.resolve();await release.promise;return page([],3,{body:'Earlier story'});}
    return page([external],3);
  },async()=>{
    const refresh=c.refresh();await reading.promise;await c.editArtifact('a','Latest story',0);release.resolve();await refresh;
    assert.deepEqual(c.content,{body:'Latest story'});assert.deepEqual(c.events.map(e=>e.sequence),[1,2,3,4]);assert.equal(c.head,4);
  });
});
test('scope changes fence in-flight reads and old denials cannot clear the new workspace',async()=>{
  const c=client(),reading=deferred(),release=deferred();
  await network(async url=>{if(url==='/api/session?profile=still')return json(session);reading.resolve();await release.promise;return json({error:'forbidden'},403);},async()=>{
    const refresh=c.refresh();await reading.promise;c.epoch++;c.session={...session,user:{...session.user,userId:'new'}};c.content={new:'New workspace'};release.resolve();await assert.rejects(refresh,/Workspace changed/);assert.equal(c.content.new,'New workspace');assert.equal(c.session.user.userId,'new');
  });
});
test('concurrent history and jobs reads share their session verification',async()=>{
  const c=client();await network(url=>url==='/api/session?profile=still'?json(session):url.startsWith('/api/events')?page():json({jobs:[]}),async calls=>{await Promise.all([c.refresh(),c.pollJobs()]);assert.equal(calls.filter(c=>c.url==='/api/session?profile=still').length,1);assert.equal(calls.length,3);});
});
test('receipt gaps fetch missing collaborator events rather than skipping to the receipt head',async()=>{
  const c=client();const incoming=[event(3,'DocumentRenamed',{document_id:'d',new_title:'Collaborator title'}),event(4,'DocumentCreated',{project_id:'p',document_id:'other',title:'Other'}),event(5,'DocumentArtifactEdited',{artifact_id:'a',content_ref:'body'})];
  await network((url,init)=>url==='/api/session?profile=still'?json(session):init?.method==='PATCH'?json({appended:[incoming[2]],head:5,content:{body:'New story'},revision:1}):page(incoming,5,{body:'New story'}),async calls=>{
    await c.editArtifact('a','New story',0);await c.refresh();assert.equal(c.head,5);assert.deepEqual(c.events.map(e=>e.sequence),[1,2,3,4,5]);assert.ok(calls.some(c=>c.url.startsWith('/api/events?after=2')));assert.equal(c.projection.documents.find(d=>d.id==='d').title,'Collaborator title');
  });
});
test('paginated deltas stop at the first page head despite concurrent server appends',async()=>{
  const c=client();
  await network(url=>url==='/api/session?profile=still'?json(session):url.includes('after=2')?json({events:[event(3,'DocumentRenamed',{document_id:'d',new_title:'A'})],head:4,nextAfter:3,hasMore:true}):json({events:[event(4,'DocumentRenamed',{document_id:'d',new_title:'B'}),event(5,'DocumentRenamed',{document_id:'d',new_title:'Later'})],head:5,nextAfter:5,hasMore:false}),async calls=>{
    await c.refresh();assert.equal(calls.length,3);assert.equal(c.head,4);assert.equal(c.projection.documents[0].title,'B');assert.ok(calls.slice(1).every(c=>c.url.endsWith('content=0')));
  });
});
test('denied reads clear private data and denied admissions do not leave an uncertain purchase',async()=>{
  const c=client(),draft=c.prepareGeneration('image');c.content={private:'Private'};
  await network(url=>url==='/api/session?profile=still'?json(session):json({error:'forbidden'},403),async()=>{
    await assert.rejects(c.generate(draft));assert.equal(c.session,null);assert.deepEqual(c.content,{});assert.equal(draft.attempted,false);assert.equal(operationJournal.generation('economy:personal','d'),null);
  });
});
test('returning to a document fences its earlier poll and clears another document’s jobs',async()=>{
  const c=client(),reading=deferred(),release=deferred();let documentReads=0;
  await network(async url=>{
    if(url==='/api/session?profile=still')return json(session);
    if(url.includes('document=other'))return json({jobs:[]});
    if(++documentReads===1){reading.resolve();await release.promise;return json({jobs:[{jobId:'old',documentId:'d',status:'running'}]});}
    return json({jobs:[]});
  },async()=>{
    const old=c.pollJobs();await reading.promise;c.position.documentId='other';c.jobs=[{jobId:'original',documentId:'d',status:'running'}];await c.pollJobs();assert.deepEqual(c.jobs,[]);c.position.documentId='d';await c.pollJobs();release.resolve();await old;assert.deepEqual(c.jobs,[]);
  });
});
test('native mixed-document job lists retain selected results without rejecting authorized siblings',async()=>{
  const c=client();c.jobs=[{jobId:'selected',documentId:'d',status:'running'}];
  const selected={jobId:'selected',documentId:'d',status:'completed'};
  await network(url=>url==='/api/session?profile=still'?json(session):url.startsWith('/api/document-jobs')?json({jobs:[{jobId:'active-elsewhere',documentId:'other',status:'running'},selected,{jobId:'unnotified-elsewhere',documentId:'other',status:'completed'}]}):page(),async calls=>{
    await c.pollJobs();assert.deepEqual(c.jobs,[selected]);assert.equal(calls.length,3);await c.pollJobs();assert.equal(calls.length,5);
  });
});
test('authoritative hydration removes omitted expired or redacted cached bodies',async()=>{
  const c=client();c.content={expired:'Expired story',redacted:'Removed context',current:'Current body'};
  const rendered=event(3,'DocumentRenderCompleted',{document_id:'d',artifact_id:'a',content_ref:'new-body'});
  await network(url=>url==='/api/session?profile=still'?json(session):url.includes('content=1')?page([],3,{current:'Current body','new-body':'New story'}):page([rendered],3),async()=>{
    await c.refresh();assert.deepEqual(c.content,{current:'Current body','new-body':'New story'});
  });
});

test('media startup never waits for unrelated writing and bodies load only when requested',async()=>{
  const c=new StillClient(),rendered=event(3,'DocumentRenderCompleted',{document_id:'d',artifact_id:'a',content_ref:'body'});
  await network(url=>url==='/api/session?profile=still'?json(session):url.includes('content=1')?page([],3,{body:'Full retained writing'}):page([...initial,rendered],3),async calls=>{
    await c.load({hydrateContent:false});assert.equal(calls.length,2);assert.deepEqual(c.content,{});assert.equal(c.head,3);
    await Promise.all([c.ensureContent('body'),c.ensureContent('body')]);assert.equal(calls.length,3);assert.equal(c.content.body,'Full retained writing');
    await c.ensureContent('body');assert.equal(calls.length,3);
  });
});
test('on-demand hydration cannot overwrite an edit acknowledged while it was loading',async()=>{
  const c=client(),reading=deferred(),release=deferred();
  await network(async(url,init)=>{
    if(url==='/api/session?profile=still')return json(session);
    if(init?.method==='PATCH')return json({appended:[event(3,'DocumentArtifactEdited',{artifact_id:'a',content_ref:'body'})],head:3,content:{body:'New writing'},revision:1});
    reading.resolve();await release.promise;return page([],2,{body:'Old writing'});
  },async()=>{const pending=c.ensureContent('body');await reading.promise;await c.editArtifact('a','New writing',0);release.resolve();await pending;assert.equal(c.content.body,'New writing');});
});
test('on-demand writing failures can retry and stale denials cannot clear a new workspace',async()=>{
  const c=client();let attempt=0;
  await network(()=>++attempt===1?json({error:'temporary'},503):page([],2,{body:'Writing'}),async()=>{await assert.rejects(c.ensureContent('body'));await c.ensureContent('body');assert.equal(c.content.body,'Writing');});
  const reading=deferred(),release=deferred();
  await network(async()=>{reading.resolve();await release.promise;return json({error:'forbidden'},403);},async()=>{
    const pending=c.ensureContent('other');await reading.promise;c.epoch++;c.session={...session,user:{...session.user,userId:'next'}};c.content={next:'Private'};release.resolve();await assert.rejects(pending,/Workspace changed/);assert.deepEqual(c.content,{next:'Private'});
  });
});
test('missing retained writing is an error rather than an empty editable body',async()=>{
  const c=client();await network(()=>page(),async()=>{await assert.rejects(c.ensureContent('missing'),/unavailable/);});
});
test('an older lazy read cannot replace a newer authoritative refresh',async()=>{
  const c=client(),reading=deferred(),release=deferred();let bodies=0;
  await network(async url=>{
    if(url==='/api/session?profile=still')return json(session);
    if(url.includes('content=1')){if(++bodies===1){reading.resolve();await release.promise;return page([],2,{body:'Earlier'});}return page([],3,{body:'Current'});}
    return page([event(3,'DocumentArtifactEdited',{artifact_id:'a',content_ref:'body'})],3);
  },async()=>{const lazy=c.ensureContent('body');await reading.promise;await c.refresh();release.resolve();await lazy;assert.equal(c.content.body,'Current');});
});
