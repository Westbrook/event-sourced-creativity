import test from 'node:test';
import assert from 'node:assert/strict';
import {ListDisplay,listType,listControls} from '../src/still/list-display.ts';
import {paletteActions} from '../src/still/finder.ts';
import {parseStillRoute,stillPath,stillRouteProblem} from '../src/still/routes.ts';
import {validPanelCommand} from '../src/still/remote-protocol.ts';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
test('show all resets on leaving by default and never writes preferences',()=>{
 const store=storage(),display=new ListDisplay(store);assert.equal(display.remember,false);
 display.enter('p','projects');display.set(true);display.enter('p','projects');assert.equal(display.all,true);
 display.leave();display.enter('p','projects');assert.equal(display.all,false);display.set(true);display.enter('d','documents');display.enter('p','projects');assert.equal(display.all,false);assert.equal(store.getItem('still:list-display'),null);
});
test('documents show all context blocks by default and restore that default on return',()=>{
 const display=new ListDisplay(storage());
 display.enter('document-a',listType('document'));assert.equal(display.all,true);
 assert.deepEqual(listControls('ideas',display.all,0,40).map(a=>a.id),['ui:show-less']);
 display.set(false);display.enter('document-a','ideas');assert.equal(display.all,false);
 display.leave();display.enter('document-a','ideas');assert.equal(display.all,true);
 display.enter('document-b','ideas');assert.equal(display.all,true);
 for(const type of ['projects','documents','results']){display.enter(type,type);assert.equal(display.all,false);}
});
test('opt-in remembers each type independently across destinations and reloads, and off clears it',()=>{
 const store=storage(),display=new ListDisplay(store);display.enter('p','projects');display.setRemember(true);display.set(true);
 display.enter('docs-a','documents');assert.equal(display.all,false);display.set(true);
 display.enter('ideas-a','ideas');assert.equal(display.all,true);display.set(false);
 display.enter('docs-b','documents');assert.equal(display.all,true);
 const reloaded=new ListDisplay(store);reloaded.enter('projects','projects');assert.equal(reloaded.all,true);reloaded.enter('ideas-b','ideas');assert.equal(reloaded.all,false);
 reloaded.setRemember(false);reloaded.enter('docs-b','documents');assert.equal(reloaded.all,false);assert.equal(store.getItem('still:list-display'),null);
});
test('unavailable storage and malformed preferences do not block list use',()=>{
 const broken={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 const display=new ListDisplay(broken);display.enter('projects','projects');display.setRemember(true);display.set(true);assert.equal(display.all,true);
 const store=storage();store.setItem('still:flag:remember-lists','true');store.setItem('still:list-display','{"projects":"true","documents":true}');const d=new ListDisplay(store);d.enter('p','projects');assert.equal(d.all,false);d.enter('d','documents');assert.equal(d.all,true);
});
test('list controls are available in the palette with matching pagination exclusions',()=>{
 for(const type of ['projects','documents','ideas','results']){
  const paged=listControls(type,false,1,10),all=listControls(type,true,1,10);
  assert.deepEqual(paged.map(a=>a.id),['ui:previous-page','ui:next-page','ui:show-all']);
  assert.deepEqual(all.map(a=>a.id),['ui:show-less']);
  assert.deepEqual(paletteActions('Show',[],undefined,all).map(a=>a.id),['ui:show-less']);
  assert.deepEqual(paletteActions('page',[],undefined,paged).map(a=>a.id),['ui:previous-page','ui:next-page']);
 }
 for(const type of ['projects','documents','ideas','results'])for(const all of [false,true]){
  for(const count of [0,1,2,3])assert.deepEqual(listControls(type,all,0,count),[]);
  assert.ok(listControls(type,all,0,4).some(a=>a.id===(all?'ui:show-less':'ui:show-all')));
 }
 assert.deepEqual(listControls(undefined,false,0,100),[]);
 assert.equal(listType('document','','selected'),undefined);assert.equal(listType('document'),'ideas');assert.equal(listType('projects','new-project'),undefined);
});
test('idea pagination has addressable routes and validates against ideas, not outputs',()=>{
 const route=parseStillRoute('/still/project/p/document/d/page/2');assert.equal(stillPath(route),'/still/project/p/document/d/page/2');
 const p={projects:[{id:'p'}],documents:[{id:'d',projectId:'p'}],blocks:Array.from({length:4},(_,i)=>({id:String(i)})),outputs:[],artifacts:[]};
 assert.equal(stillRouteProblem(route,p,0),'');p.blocks=[];assert.equal(stillRouteProblem(route,p,10),'Page unavailable');
 assert.equal(parseStillRoute('/still/project/p/document/d/block/b/page/2'),null);
});

test('remote developer flag accepts only bounded boolean controls',()=>{
 assert.equal(validPanelCommand({type:'remember-lists',value:true,scope:'a'.repeat(64)}),true);
 assert.equal(validPanelCommand({type:'remember-lists',value:'true',scope:'a'.repeat(64)}),false);
});
