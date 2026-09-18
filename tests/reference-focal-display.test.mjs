import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createSceneStoreHost,sceneDeferred} from './helpers/scene-cost-store-host.mjs';
const {positionImageAtFocalPoint,resolveImageFocalPoint}=await import('../src/model/image-focus.ts');
const {focalPointCss}=await import('../src/model/focal-point.ts');

const known={x:.7,y:.3,confidence:.8,method:'attention-region-v2',sampleWidth:2,sampleHeight:2};
const image=src=>({src,currentSrc:src,isConnected:true,style:{values:{},setProperty(key,value){this.values[key]=value;}}});

test('actual reference image load positions locally without invoking the persistent Store calculator',async()=>{
  // Complete production component with Lit/base-element ports; invoke the real
  // rendered image load callback, not an extracted/reimplemented callback.
  const source=await readFile(new URL('../src/components/reference-image.ts',import.meta.url),'utf8');
  const html=(strings,...values)=>({strings,values});
  class Base{store={calculateImageFocalPoint(){assert.fail('Reference image load must not persist display hints');}};}
  const modules={lit:{html},'../model/focal-point':{focalPointCss},'../model/image-focus':{positionImageAtFocalPoint},'./forma-element':{FormaElement:Base,icon:()=>''},'./modal-dialog':{ensureModalDialog(){}}};
  const exports={};
  new Function('require','exports','customElements',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(key=>modules[key],exports,{get:()=>true});
  const component=new exports.ReferenceImage();component.src='/fixture-reference.png';component.focalPoint=known;component.targetId='original-reference';
  const visit=template=>{if(!template?.strings)return null;if(template.strings.some(text=>text.includes('<img src=')))return template;for(const value of template.values){const found=visit(value);if(found)return found;}return null;};
  const template=visit(component.render());assert.ok(template);
  const index=template.strings.findIndex(text=>text.endsWith('@load='));assert.ok(index>=0);
  const node=image(component.src);template.values[index]({currentTarget:node});
  assert.deepEqual(node.style.values,{'--focal-x':'70%','--focal-y':'30%'});
});

test('local positioning caches image sampling and rejects stale URLs, removed nodes and superseded hints',async t=>{
  const requests=[],pending=new Map();
  t.mock.method(globalThis,'fetch',url=>{requests.push(url);const deferred=sceneDeferred();pending.set(url,deferred);return deferred.promise;});
  const priorBitmap=globalThis.createImageBitmap,priorDocument=globalThis.document;
  globalThis.createImageBitmap=async()=>({width:2,height:2,close(){}});
  globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(24*24*4).fill(128)})})})};
  t.after(()=>{globalThis.createImageBitmap=priorBitmap;globalThis.document=priorDocument;});
  for(const mutation of ['none','url','removed','known']){
    const url='/focal-fixture-'+mutation,node=image(url),peer=image(url);
    positionImageAtFocalPoint(node);positionImageAtFocalPoint(peer);
    if(mutation==='url')node.currentSrc='/different-image';
    if(mutation==='removed')node.isConnected=false;
    if(mutation==='known')positionImageAtFocalPoint(node,known);
    pending.get(url).resolve(new Response(new Uint8Array([1])));
    await resolveImageFocalPoint(url);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(requests.filter(value=>value===url).length,1);
    assert.ok(peer.style.values['--focal-x']);
    if(mutation==='none')assert.deepEqual(node.style.values,peer.style.values);
    else if(mutation==='known')assert.deepEqual(node.style.values,{'--focal-x':'70%','--focal-y':'30%'});
    else assert.deepEqual(node.style.values,{});
  }
});

test('complete Store blocks reference persistence and delayed maintenance skips reference blocks',async t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('No external transport'));
  const owner='focal-store',projectId='focal-project',documentId='focal-document';
  let events=[['ProjectCreated',{project_id:projectId,name:'Fixture'}],['DocumentCreated',{project_id:projectId,document_id:documentId,title:'Fixture'}]].map(([type,payload],index)=>({type,payload,eventId:'fixture-'+index,sequence:index+1,streamId:'creative:'+owner,actor:'user',occurredAt:'2026-09-14T00:00:00Z',recordedAt:'2026-09-14T00:00:00Z',clientId:'test',correlationId:'test',causationId:null,compensatesEventId:null,schemaVersion:1}));
  const worker={owner,projectId,documentId,payload:{},events,close(){},request:async(url,init={})=>{
    if(url==='/api/session')return Response.json({user:{userId:owner,email:'focal@example.test',role:'creator'},impersonation:null,policy:{accepted:true},permissionEpoch:'fixture',capabilities:['project.read','project.author']});
    if(url.startsWith('/api/events?'))return Response.json({events,head:events.length,content:{}});
    if(url==='/api/events'&&init.method==='POST'){
      const body=JSON.parse(init.body);assert.equal(body.action,'append');
      const event={...events[0],...body.event,eventId:'new-reference',sequence:events.length+1};events=[...events,event];return Response.json({appended:[event],rejected:[],head:events.length});
    }
    assert.fail('Unexpected fixture request '+url);
  }};
  const h=await createSceneStoreHost({workerFixture:worker});t.after(()=>h.close());
  assert.equal(await h.store.calculateImageFocalPoint({targetKind:'reference',targetId:'original',mediaUrl:'/original.png'}),null);
  await h.store.append({type:'BlockCreated',payload:{project_id:projectId,document_id:documentId,block_id:'original',type:'reference',properties:{media_url:'/original.png',media_type:'image/png'}}});
  assert.ok(h.store.events.get().some(event=>event.eventId==='new-reference'));
  const timers=[...h.timers.values()].filter(timer=>timer.delay===3000);assert.ok(timers.length);
  for(const timer of timers)timer.callback();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.requests.some(request=>request.body?.action==='calculate_focal_point'),false);
});
