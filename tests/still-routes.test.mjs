import test from 'node:test';
import assert from 'node:assert/strict';
import { foldEvents } from '../src/model/events.ts';
import { parseStillRoute, stillPath, stillURL, stillRouteProblem, STILL_MODES, STILL_FORMATS } from '../src/still/routes.ts';

export const stillPaths=[
  '/still','/still/page/2','/still/project/p','/still/project/p/page/2',
  '/still/project/p/document/d','/still/project/p/document/d/block/b',
  '/still/project/p/document/d/results','/still/project/p/document/d/results/page/2',
  '/still/project/p/document/d/result/r','/still/project/p/document/d/result/r/item/3',
  '/still/project/p/document/d/generation/job-1',
  '/still/project/p/document/d/create',
  ...STILL_FORMATS.map(format=>`/still/project/p/document/d/create/${format}`),
  ...STILL_MODES.map(mode=>`/still/project/p/document/d/block/b/action/${mode}`),
  '/still/action/new-project','/still/project/p/action/new-document','/still/action/workspaces',
  '/still/project/p/document/d/result/r/item/2/action/edit-artifact',
];

test('all durable Still views and form entry points round-trip as directory routes',()=>{
  for(const path of stillPaths){const route=parseStillRoute(path);assert.ok(route,path);assert.equal(stillPath(route),path);}
  assert.equal(parseStillRoute('/still/project/p/document/d/results').view,'results');
  assert.equal(parseStillRoute('/still/project/p/document/d/result/r/item/3').itemIndex,2);
  assert.equal(parseStillRoute('/still/project/p/document/d/block/b/action/edit-block').blockId,'b');
  assert.equal(parseStillRoute('/still/project/p/document/d/create/model3d').format,'model3d');
});

test('encoded IDs and display flags survive canonicalization without query-based identity',()=>{
  const route=parseStillRoute('/still/project/project%20one/document/%E9%A0%85%E7%9B%AE%23%3F%25');
  assert.equal(route.projectId,'project one');assert.equal(route.documentId,'項目#?%');
  assert.equal(stillURL(route,'/still?project=old&document=old&work=old&developer&progress-report#note'),'/still/project/project%20one/document/%E9%A0%85%E7%9B%AE%23%3F%25?developer=&progress-report=#note');
  assert.equal(stillPath(parseStillRoute('/still/project/p/document/d/')),'/still/project/p/document/d');
  assert.equal(stillPath(parseStillRoute('/still.html')),'/still');
});

test('legacy links resolve the same selection and canonicalize without another history entry',()=>{
  const route=parseStillRoute('/still?project=p&document=d&work=r&developer');
  assert.equal(route.legacy,true);assert.equal(route.view,'artifact');assert.equal(route.outputId,'r');
  assert.equal(stillURL(route,'/still?project=p&document=d&work=r&developer'),'/still/project/p/document/d/result/r?developer=');
  assert.equal(parseStillRoute('/still?document=d').documentId,'d'); // caller resolves the authorized owning project
  const pathWins=parseStillRoute('/still/project/p/document/d?project=other&document=other');
  assert.equal(pathWins.projectId,'p');assert.equal(pathWins.documentId,'d');
});

test('malformed paths and executing actions are never recognized as Still pages',()=>{
  for(const path of ['/stillish','/still/project','/still/project/p/document','/still/project//document/d','/still/project/%ZZ','/still/project/a%2Fb','/still/project/a%5Cb','/still/project/a%00b','/still/project/p/document/d/extra','/still/project/p/document/d/create/invented','/still/project/p/document/d/result/r/item/0','/still/project/p/document/d/result/r/item/1002','/still/project/p/document/d/block/b/page/2','/still/project/p/page/-1','/still/page/0','/still/action/generate','/still/action/lock','/still/action/export','/still/action/save','/still/unknown.js','/still?project=p&project=q','/still?work=r','/still?project='])assert.equal(parseStillRoute(path),null,path);
});

test('route ownership never accepts the fold fallback or another document’s blocks/results',()=>{
  const events=[['ProjectCreated',{project_id:'p',name:'P'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'D'}],['BlockCreated',{project_id:'p',document_id:'d',block_id:'b',scope:'document',type:'subject',properties:{text:'Idea'}}],['ProjectCreated',{project_id:'q',name:'Q'}],['DocumentCreated',{project_id:'q',document_id:'e',title:'E'}],['BlockCreated',{project_id:'q',document_id:'e',block_id:'foreign',scope:'document',type:'subject',properties:{text:'Other'}}]].map(([type,payload],i)=>({eventId:`e${i}`,sequence:i+1,type,payload}));
  const p=foldEvents(events,Infinity,'d','p');
  const doc=parseStillRoute('/still/project/p/document/d');
  assert.equal(stillRouteProblem(doc,p),'');
  assert.equal(stillRouteProblem({...doc,documentId:'missing'},p),'Document unavailable');
  const mismatched=foldEvents(events,Infinity,'e','p');assert.equal(stillRouteProblem({...doc,documentId:'e'},mismatched),'Document unavailable');
  assert.equal(stillRouteProblem({...doc,blockId:'foreign'},p),'Idea unavailable');
  assert.equal(stillRouteProblem({...doc,outputId:'missing'},p),'Result unavailable');
  p.artifacts=[{id:'deck',documentId:'d',kind:'slides',items:[{},{}]}];
  assert.equal(stillRouteProblem({...doc,view:'artifact',outputId:'deck',itemIndex:1},p),'');
  assert.equal(stillRouteProblem({...doc,view:'artifact',outputId:'deck',itemIndex:2},p),'Item unavailable');
  assert.equal(stillRouteProblem({...doc,view:'results',page:1},p),'Page unavailable');
  const removed=foldEvents([...events,{eventId:'removed',sequence:7,type:'DocumentRemoved',payload:{document_id:'d'}}],Infinity,'d','p');
  assert.notEqual(removed.documentId,'d');assert.equal(stillRouteProblem(doc,removed),'Document unavailable');
});
