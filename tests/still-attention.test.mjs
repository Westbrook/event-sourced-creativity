import test from 'node:test';
import assert from 'node:assert/strict';
import { AttentionSummary } from '../src/still/attention.ts';
import { captureDecision, exportCapture } from '../src/still/decision-lab.ts';
const fixture=()=>{let now=0;const summary=new AttentionSummary(()=>now);summary.enter('account-a','projects');summary.setForeground(true);return {summary,advance(ms){now+=ms;},tick(ms){while(ms>0){const step=Math.min(2000,ms);now+=step;summary.snapshot();ms-=step;}}};};
test('foreground, exposure, hover and keyboard focus pause when the window loses attention',()=>{
 const {summary:s,advance}=fixture();s.exposure('project:one',true);s.hovered('project:one');s.keyboardFocused('project:one');advance(1500);
 s.setForeground(false);advance(3000);let p=s.snapshot().current;
 assert.equal(p.elapsedMs,4500);assert.equal(p.foregroundMs,1500);assert.deepEqual(p.targets[0],{id:'project:one',visibleMs:1500,hoverMs:1500,keyboardFocusMs:1500,activations:0});
 s.setForeground(true);advance(500);p=s.snapshot().current;assert.equal(p.targets[0].visibleMs,2000);assert.equal(p.targets[0].hoverMs,1500);assert.equal(p.targets[0].keyboardFocusMs,1500);
 s.exposure('project:one',false);advance(500);assert.equal(s.snapshot().current.targets[0].visibleMs,2000);
});
test('idle is a separate measure and input resets it without changing foreground time',()=>{
 const {summary:s,tick}=fixture();tick(35_000);let p=s.snapshot().current;assert.equal(p.foregroundMs,35000);assert.equal(p.idleForegroundMs,5000);
 s.interact();tick(5000);p=s.snapshot().current;assert.equal(p.foregroundMs,40000);assert.equal(p.idleForegroundMs,5000);
});
test('revisits aggregate by page while scope changes erase retained observations',()=>{
 const {summary:s,advance}=fixture();s.activate('project:one');s.explore('more');s.explore('palette');advance(1000);s.enter('account-a','document');advance(1000);s.enter('account-a','projects');advance(1000);
 let snap=s.snapshot();assert.equal(snap.current.visits,2);assert.equal(snap.current.foregroundMs,2000);assert.equal(snap.current.moreOpened,1);assert.equal(snap.current.paletteOpened,1);assert.equal(snap.recent[0].page,'document');
 snap.current.visits=99;assert.equal(s.snapshot().current.visits,2);
 s.enter('account-b','projects');snap=s.snapshot();assert.equal(snap.current.visits,1);assert.equal(snap.recent.length,0);assert.deepEqual(snap.current.targets,[]);
});
test('history and targets are bounded and suspended timers cannot inflate foreground time',()=>{
 const {summary:s,advance}=fixture();for(let i=0;i<130;i++)s.exposure(`block:${i}`,true);assert.equal(s.snapshot().current.targets.length,100);
 advance(3_600_000);assert.equal(s.snapshot().current.foregroundMs,5000);
 for(let i=0;i<30;i++)s.enter('account-a',`page:${i}`);assert.equal(s.snapshot().recent.length,19);
});
test('full developer captures retain local attention; metadata-only exports omit content identities',()=>{
 const {summary:s}=fixture();s.activate('block:PRIVATE');const trace={head:1,policy:'test',passes:[],actions:[],questions:[]};
 const c=captureDecision({context:{attention:s.snapshot(),current:trace},controls:[],pending:false});s.explore('more');
 assert.equal(c.snapshot.context.attention.current.moreOpened,0);assert.equal(exportCapture(c).snapshot.context.attention.sentToJev,false);
 assert.doesNotMatch(JSON.stringify(exportCapture(c,true)),/PRIVATE|attention/);
});

test('DOM aggregation distinguishes deliberate focus, removes stale targets and cleans up without requests',async()=>{
 const { StillAttentionObserver }=await import('../src/still/attention-observer.ts');
 const names=['window','document','HTMLElement','IntersectionObserver','fetch','clearInterval'];
 const saved=Object.fromEntries(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 class Surface{listeners=new Map();addEventListener(name,fn){this.listeners.set(name,fn);}removeEventListener(name){this.listeners.delete(name);}}
 class Element extends Surface{dataset={};visibleFocus=false;matches(selector){return selector===':focus-visible'&&this.visibleFocus;}}
 const root=new Element(),one=new Element(),two=new Element();one.dataset.actionId='create';two.dataset.attentionId='block:one';root.querySelectorAll=()=>[one,two];
 let callback,timer,requests=0,snapshot;const watched=new Set();const owner=new Surface(),doc=new Surface();doc.hidden=false;doc.hasFocus=()=>true;
 owner.setInterval=fn=>{timer=fn;return 7;};
 try{
  Object.assign(globalThis,{window:owner,document:doc,HTMLElement:Element,fetch:()=>{requests++;throw new Error('Unexpected request');},clearInterval:id=>{assert.equal(id,7);timer=undefined;},IntersectionObserver:class{constructor(fn){callback=fn;}observe(el){watched.add(el);}unobserve(el){watched.delete(el);}disconnect(){watched.clear();}}});
  const observer=new StillAttentionObserver(root,s=>snapshot=s);let now=0;observer.summary=new AttentionSummary(()=>now);
  observer.refresh('scope','page',true,false);callback([...watched].map(target=>({target,isIntersecting:true,intersectionRatio:1})));
  const emit=(type,extra={})=>root.listeners.get(type)({type,isTrusted:true,composedPath:()=>[one,root],...extra});
  one.visibleFocus=true;emit('focusin');now+=100;timer();assert.equal(snapshot.current.targets[0].keyboardFocusMs,0);
  emit('keydown',{key:'Tab'});emit('focusin');now+=100;timer();assert.equal(snapshot.current.targets[0].keyboardFocusMs,100);
  emit('pointerover',{pointerType:'mouse'});now+=100;emit('click');timer();assert.equal(snapshot.current.targets[0].hoverMs,100);assert.equal(snapshot.current.targets[0].activations,1);
  observer.refresh('scope','page',true,true);now+=100;timer();assert.equal(snapshot.current.targets[0].visibleMs,300);assert.equal(watched.size,0);
  doc.hidden=true;doc.listeners.get('visibilitychange')();now+=100;timer();assert.equal(snapshot.current.foregroundMs,400);
  observer.dispose();assert.equal(root.listeners.size,0);assert.equal(owner.listeners.size,0);assert.equal(doc.listeners.size,0);assert.equal(timer,undefined);assert.equal(requests,0);
 }finally{for(const name of names){if(saved[name])Object.defineProperty(globalThis,name,saved[name]);else delete globalThis[name];}}
});
