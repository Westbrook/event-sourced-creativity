import test from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleWindowHost, ConsoleWindowReceiver, consoleEnvelope, validConsoleSession } from '../src/still/console-window.ts';

function harness(blocked=false){
  const listeners=new Map(),timers=new Map(),sent=[],states=[],connections=[];
  let latest={scope:'personal/project-a',context:{head:1},pending:false,controls:[{label:'Edit idea'}]},opens=0,focuses=0,returns=0;
  const popup={closed:false,postMessage:(data,origin)=>sent.push({data:structuredClone(data),origin}),focus:()=>focuses++,close(){this.closed=true;}};
  const owner={location:{origin:'https://still.test'},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),setInterval:fn=>{timers.set(1,fn);return 1;},clearInterval:id=>timers.delete(id),open(url,name,features){opens++;owner.url=url;owner.features=features;return blocked?null:popup;}};
  const host=new ConsoleWindowHost(owner,()=>latest,(open,connected)=>{states.push(open);connections.push(connected);},()=>returns++);
  const message=(type,overrides={})=>listeners.get('message')?.({source:popup,origin:owner.location.origin,data:consoleEnvelope(new URL(owner.url).searchParams.get('developer-console'),type),...overrides});
  return {host,owner,popup,sent,states,connections,listeners,timers,message,set:data=>latest=data,get latest(){return latest;},get opens(){return opens;},get focuses(){return focuses;},get returns(){return returns;}};
}

test('only the paired popup can request live data; invalid origins, nonces and commands are inert',()=>{
  const h=harness();assert.equal(h.host.open(),true);
  assert.equal(validConsoleSession(new URL(h.owner.url).searchParams.get('developer-console')),true);
  assert.match(h.owner.features,/popup/);assert.equal(h.sent.length,0);
  h.message('ready',{origin:'https://elsewhere.test'});h.message('ready',{source:{}});
  h.message('ready',{data:consoleEnvelope('old-session','ready')});h.message('ready',{data:null});h.message('generate');
  assert.equal(h.sent.length,0);h.message('ready');
  assert.equal(h.sent.length,1);assert.deepEqual(h.sent[0].data.snapshot,h.latest);assert.equal(h.sent[0].origin,'https://still.test');
  assert.equal(validConsoleSession(null),false);assert.equal(validConsoleSession('bad'),false);
});

test('publishes changed controls and decisions, deduplicates unchanged snapshots, and refresh replays the current state',()=>{
  const h=harness();h.host.open();h.message('ready');h.host.publish();assert.equal(h.sent.length,1);
  h.set({...h.latest,pending:true,controls:[{label:'Create'}]});h.host.publish();assert.equal(h.sent.length,2);
  h.message('ready');assert.equal(h.sent.length,3);assert.equal(h.sent[2].data.snapshot.pending,true);
  h.set({scope:'shared/project-b',context:{head:6},pending:false,controls:[]});h.host.publish();
  assert.equal(h.sent.at(-1).data.snapshot.scope,'shared/project-b');assert.equal(h.sent.at(-1).data.snapshot.applied,undefined);
});

test('reopening focuses one window, returning closes it and returns focus to the panel',()=>{
  const h=harness();h.host.open();h.message('ready');h.host.open();assert.equal(h.opens,1);assert.equal(h.focuses,1);
  h.message('return');assert.equal(h.popup.closed,true);assert.equal(h.returns,1);assert.deepEqual(h.states,[true,false]);
  assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);assert.equal(h.sent.at(-1).data.type,'ended');
});

test('blocked popup leaves no listeners or timers and native closure clears host state',()=>{
  const blocked=harness(true);assert.equal(blocked.host.open(),false);assert.equal(blocked.listeners.size,0);assert.equal(blocked.timers.size,0);
  const h=harness();h.host.open();h.popup.closed=true;h.timers.get(1)();assert.equal(h.host.isOpen,false);assert.deepEqual(h.states,[true,false]);assert.equal(h.listeners.size,0);
});

test('only actual pagehide disconnects, and disposed sessions cannot stream late data',()=>{
  const h=harness();h.host.open();h.message('ready');assert.equal(h.listeners.has('beforeunload'),false);
  h.listeners.get('pagehide')();assert.equal(h.popup.closed,true);const count=h.sent.length;
  h.host.publish(true);h.message('ready');assert.equal(h.sent.length,count);
});

test('viewer disconnection clears live status and invalidates late render acknowledgements',()=>{
  const h=harness();h.host.open();h.message('ready');h.message('rendered');assert.equal(h.connections.at(-1),true);
  h.message('disconnected');h.message('rendered');assert.equal(h.connections.at(-1),false);
  const count=h.sent.length;h.host.publish(true);assert.equal(h.sent.length,count);
  h.message('ready');h.message('rendered');assert.equal(h.connections.at(-1),true);
});

function viewer(){
  const listeners=new Map(),timers=new Map(),sent=[],cleared=[],applied=[];
  let now=1000;
  const source={closed:false,postMessage:(data,origin)=>sent.push({data,origin})},session='0bffbbd4-6f8b-41c9-baa1-b1c459c1ac53';
  const owner={location:{origin:'https://still.test'},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),setInterval:fn=>{timers.set(1,fn);return 1;},clearInterval:id=>timers.delete(id)};
  const receiver=new ConsoleWindowReceiver(owner,source,session,data=>{applied.push(data);},message=>cleared.push(message),()=>now);
  const message=(type,snapshot,overrides={})=>listeners.get('message')?.({source,origin:owner.location.origin,data:consoleEnvelope(session,type,snapshot),...overrides});
  return {receiver,source,listeners,timers,sent,cleared,applied,message,tick:ms=>{now+=ms;timers.get(1)?.();}};
}

test('viewer accepts only the opener, acknowledges rendered data and sends only lifecycle commands',async()=>{
  const v=viewer();v.receiver.start();assert.equal(v.sent[0].data.type,'ready');
  const snapshot={scope:'a',context:{head:9},controls:[],pending:true};
  v.message('snapshot',snapshot,{source:{}});v.message('snapshot',snapshot,{origin:'https://other.test'});v.message('snapshot',snapshot,{data:null});
  assert.equal(v.applied.length,0);v.message('snapshot',snapshot);await Promise.resolve();
  assert.deepEqual(v.applied,[snapshot]);assert.equal(v.sent.at(-1).data.type,'rendered');
  v.receiver.returnToPanel();assert.equal(v.sent.at(-1).data.type,'return');assert.ok(v.sent.every(x=>x.origin==='https://still.test'));
});

test('viewer clears stale data and asks for a fresh snapshot; source closure stops it',()=>{
  const v=viewer();v.receiver.start();v.message('snapshot',{scope:'a',context:{head:9},controls:[]});
  v.tick(16000);assert.equal(v.cleared.at(-1),'Waiting for app…');assert.equal(v.sent.at(-1).data.type,'ready');
  v.message('snapshot',{scope:'b',context:{head:1},controls:[]});assert.equal(v.applied.at(-1).scope,'b');
  v.source.closed=true;v.tick(1000);assert.match(v.cleared.at(-1),/disconnected/);assert.equal(v.listeners.size,0);assert.equal(v.timers.size,0);
});

test('pagehide clears viewer data before BFCache can preserve it and ignores late snapshots',async()=>{
  const v=viewer();v.receiver.start();v.message('snapshot',{scope:'a',context:{head:9},controls:[]});
  v.listeners.get('pagehide')();await Promise.resolve();assert.match(v.cleared.at(-1),/disconnected/);
  assert.equal(v.sent.some(x=>x.data.type==='rendered'),false);
  assert.equal(v.sent.at(-1).data.type,'disconnected');
  const count=v.applied.length;v.message('snapshot',{scope:'a',context:{head:10},controls:[]});v.receiver.returnToPanel();
  assert.equal(v.applied.length,count);assert.equal(v.listeners.size,0);assert.equal(v.timers.size,0);
});

test('developer commands and experiment results stay within the paired window session',()=>{
 const listeners=new Map(),sent=[],commands=[],popup={closed:false,postMessage:(m)=>sent.push(m),close(){this.closed=true;}};
 const owner={location:{origin:'https://still.test'},addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k),setInterval:()=>1,clearInterval(){},open(url){owner.url=url;return popup;}};
 const host=new ConsoleWindowHost(owner,()=>({scope:'scope',context:{head:1},controls:[]}),()=>{},()=>{},c=>commands.push(c));host.open();const session=new URL(owner.url).searchParams.get('developer-console');const send=(type,data={},origin=owner.location.origin)=>listeners.get('message')({source:popup,origin,data:{...consoleEnvelope(session,type),...data}});
 send('density',{value:8});assert.equal(commands.length,0);send('ready');send('density',{value:8},'https://wrong.test');assert.equal(commands.length,0);send('density',{value:8});send('experiment',{id:'one',scope:'scope',request:{state:{}}});assert.equal(commands.length,2);assert.equal(commands[0].value,8);send('generate');assert.equal(commands.length,2);send('next-best',{value:false});assert.equal(commands.length,3);assert.equal(commands[2].type,'next-best');assert.equal(commands[2].value,false);host.result('one',{isolated:true});assert.equal(sent.at(-1).type,'experiment-result');assert.equal(sent.at(-1).id,'one');host.dispose();
});
