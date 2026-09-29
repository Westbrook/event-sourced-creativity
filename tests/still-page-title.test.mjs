import test from 'node:test';
import assert from 'node:assert/strict';
import {foldEvents} from '../src/model/events.ts';
import {stillPageTitle} from '../src/still/page-title.ts';
import {STILL_MODES} from '../src/still/routes.ts';
const root='/still/project/p/document/d';
const events=[['ProjectCreated',{project_id:'p',name:'Fiction'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'Mockingbird'}],['BlockCreated',{project_id:'p',document_id:'d',scope:'document',block_id:'b',type:'subject',handle:'subject/subject',properties:{label:'Subject',text:'Atticus Finch and his family'}}]].map(([type,payload],i)=>({type,payload,eventId:'e'+i,sequence:i+1}));
const projection=()=>foldEvents(events,Infinity,'d','p');
test('titles distinguish lists, page numbers, ideas and actions using loaded context',()=>{
 const p=projection();
 for(const [path,title]of [['/still','Projects · Still'],['/still/page/2','Projects · Page 2 · Still'],['/still/project/p','Documents · Fiction · Still'],[root,'Mockingbird · Still'],[root+'/block/b','Atticus Finch and his family · Mockingbird · Still'],[root+'/results/page/2','Results · Mockingbird · Page 2 · Still'],[root+'/create','Choose output · Mockingbird · Still'],[root+'/action/find-references','Find reference · Mockingbird · Still'],['/still/action/new-project','New project · Still']])assert.equal(stillPageTitle(path,p),title,path);
 for(const mode of STILL_MODES)assert.ok(!stillPageTitle(root+'/action/'+mode,p).startsWith('Action ·'),mode);
});
test('direct links have useful fallbacks then hydrate, rename, and reject unrelated context',()=>{
 assert.equal(stillPageTitle(root+'/action/find-references'),'Find reference · Still');
 const p=projection();assert.equal(stillPageTitle(root,p),'Mockingbird · Still');
 p.documents[0].title='Updated title';assert.equal(stillPageTitle(root,p),'Updated title · Still');
 assert.equal(stillPageTitle('/still/project/other/document/d/block/b',p),'Idea · Still');
 assert.equal(stillPageTitle(root,p,[],'Document unavailable'),'Document unavailable · Still');
 assert.equal(stillPageTitle('/still/no-such-page',p),'Page not found · Still');
 assert.equal(stillPageTitle(root+'?developer&onboarding',p),stillPageTitle(root,p));
});
test('result, slide and generation titles distinguish their routes',()=>{
 const p=projection();p.artifacts=[{id:'a',documentId:'d',title:'Portrait study',kind:'image',items:[]},{id:'deck',documentId:'d',title:'Story',kind:'slides',items:[{title:'Introduction'},{title:'Maycomb'}]}];
 assert.equal(stillPageTitle(root+'/result/a',p),'Image · Portrait study · Still');
 assert.equal(stillPageTitle(root+'/result/deck/item/2',p),'Slide 2 · Maycomb · Mockingbird · Still');
 assert.equal(stillPageTitle(root+'/generation/j',p,[{jobId:'j',documentId:'d',kind:'generate'}]),'Image request · Mockingbird · Still');
});
