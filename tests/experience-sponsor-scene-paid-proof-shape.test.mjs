import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {registerOutputSourceImports} from './output-server-test-helpers.mjs';

// Pure returned-receipt and deadline predicates only. This test creates no
// native, sponsor execution, financial or paid-claim capability. Plain objects
// below are untrusted receipt data, not substitutes for genuine branded proof.
const hooks=registerOutputSourceImports();
const fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');let egress=0;
globalThis.fetch=()=>{egress++;throw Error('No network in Scene paid proof-shape qualification');};
after(()=>{Object.defineProperty(globalThis,'fetch',fetchDescriptor);hooks.deregister();assert.equal(egress,0);});
const {ScenePaidPolicyStopError}=await import('../worker/scene-paid-dispatch.ts');
const source=readFileSync(new URL('../worker/experience-sponsor-scene-paid-claim.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('experience-sponsor-scene-paid-claim.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const names=['stop','own','dataRecord','assertDenseProof','deadline'];
const selected=names.map(name=>{
  const matches=ast.statements.filter(node=>ts.isFunctionDeclaration(node)?node.name?.text===name:
    ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>ts.isIdentifier(declaration.name)&&declaration.name.text===name));
  assert.equal(matches.length,1,`extract the one exact named declaration ${name}`);
  if(ts.isVariableStatement(matches[0]))assert.equal(matches[0].declarationList.declarations.length,1,'no unreviewed sibling declaration');
  return matches[0].getText(ast);
}).join('\n');
const javascript=ts.transpileModule(selected,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const {assertDenseProof,deadline}=new Function('ScenePaidPolicyStopError',`${javascript}\nreturn {assertDenseProof,deadline};`)(ScenePaidPolicyStopError);
const stop=error=>error instanceof ScenePaidPolicyStopError&&error.code==='scene_paid_authority_changed'&&error.status===403;
const proof=()=>Array.from({length:3},()=>({success:true,results:[{current:1}],meta:{changes:0}}));

test('Scene paid receipt predicate accepts dense own numeric rows without issuing any capability',()=>{
  assert.equal(assertDenseProof(proof(),3),undefined);
  const rows=proof();rows[1]=Object.assign(Object.create(null),{success:true,results:[Object.assign(Object.create(null),{current:1})]});
  assert.equal(assertDenseProof(rows,3),undefined);
});

const malformed=[
  ['null batch',()=>null],['object batch',()=>({length:3})],['string batch',()=> '111'],
  ['missing batch result',rows=>rows.slice(1)],['extra batch result',rows=>[...rows,rows[0]]],
  ['sparse first result',rows=>{delete rows[0];return rows;}],['sparse final result',rows=>{delete rows[2];return rows;}],
  ['inherited batch result',rows=>{const parent=Object.create(Array.prototype);parent[1]=rows[1];delete rows[1];Object.setPrototypeOf(rows,parent);return rows;}],
  ['null batch prototype',rows=>Object.setPrototypeOf(rows,null)],
  ['undefined result',rows=>{rows[1]=undefined;return rows;}],['null result',rows=>{rows[1]=null;return rows;}],
  ['array result',rows=>{rows[1]=[];return rows;}],['string result',rows=>{rows[1]='1';return rows;}],
  ['inherited success',rows=>{rows[1]=Object.assign(Object.create({success:true}),{results:[{current:1}]});return rows;}],
  ['missing success',rows=>{delete rows[1].success;return rows;}],['false success',rows=>{rows[1].success=false;return rows;}],
  ['numeric success',rows=>{rows[1].success=1;return rows;}],['string success',rows=>{rows[1].success='true';return rows;}],
  ['explicit error',rows=>{rows[1].error='transport';return rows;}],['null error',rows=>{rows[1].error=null;return rows;}],
  ['undefined own error',rows=>{rows[1].error=undefined;return rows;}],
  ['missing result rows',rows=>{delete rows[1].results;return rows;}],['null result rows',rows=>{rows[1].results=null;return rows;}],
  ['object result rows',rows=>{rows[1].results={0:{current:1},length:1};return rows;}],
  ['no result row',rows=>{rows[1].results=[];return rows;}],['extra result row',rows=>{rows[1].results.push({current:1});return rows;}],
  ['sparse result row',rows=>{delete rows[1].results[0];return rows;}],
  ['inherited result row',rows=>{const parent=Object.create(Array.prototype);parent[0]={current:1};delete rows[1].results[0];Object.setPrototypeOf(rows[1].results,parent);return rows;}],
  ['null rows prototype',rows=>{Object.setPrototypeOf(rows[1].results,null);return rows;}],
  ['null row',rows=>{rows[1].results[0]=null;return rows;}],['array row',rows=>{rows[1].results[0]=[];return rows;}],
  ['inherited current',rows=>{rows[1].results[0]=Object.create({current:1});return rows;}],
  ['missing current',rows=>{delete rows[1].results[0].current;return rows;}],
  ['zero current',rows=>{rows[1].results[0].current=0;return rows;}],['string current',rows=>{rows[1].results[0].current='1';return rows;}],
  ['boolean current',rows=>{rows[1].results[0].current=true;return rows;}],['boxed current',rows=>{rows[1].results[0].current=Object(1);return rows;}],
  ['NaN current',rows=>{rows[1].results[0].current=NaN;return rows;}],['infinite current',rows=>{rows[1].results[0].current=Infinity;return rows;}],
];
for(const [name,transform] of malformed)test(`Scene paid receipt predicate rejects ${name}`,()=>{
  const value=transform(proof());assert.throws(()=>assertDenseProof(value,3),stop);
});

for(const location of ['batch index','success','results','result row','current','error'])test(`Scene paid receipt predicate rejects ${location} accessor without invoking it`,()=>{
  const rows=proof();let getterCalls=0;
  const getter=()=>{getterCalls++;throw Error('Untrusted getter must not run');};
  const [object,key]=location==='batch index'?[rows,'1']:location==='result row'?[rows[1].results,'0']:
    location==='current'?[rows[1].results[0],'current']:[rows[1],location];
  Object.defineProperty(object,key,{get:getter,enumerable:true,configurable:true});
  assert.throws(()=>assertDenseProof(rows,3),stop);assert.equal(getterCalls,0);
});

test('Scene paid receipt predicate ignores irrelevant metadata without invoking its accessor',()=>{
  const rows=proof();let getterCalls=0;Object.defineProperty(rows[1],'meta',{get(){getterCalls++;throw Error('not a proof field');}});
  assert.equal(assertDenseProof(rows,3),undefined);assert.equal(getterCalls,0);
});

const now=Date.parse('2026-09-17T12:00:00.000Z');
const input=()=>({prepared:{validUntil:new Date(now+90_000).toISOString()},execution:now+80_000,native:now+70_000,
  assertions:[{sql:'synthetic unused predicate',deadlineMs:now+60_000},{sql:'synthetic no-deadline predicate'},{sql:'synthetic last predicate',deadlineMs:now+50_000}]});
const invoke=value=>deadline(value.prepared,value.execution,value.native,value.assertions);
const set=(value,location,number)=>{
  if(location==='prepared')value.prepared.validUntil=Number.isFinite(number)?new Date(number).toISOString():String(number);
  else if(location==='first assertion')value.assertions[0].deadlineMs=number;
  else if(location==='last assertion')value.assertions[2].deadlineMs=number;
  else value[location]=number;
};
const locations=['prepared','execution','native','first assertion','last assertion'];
for(const location of locations)test(`Scene paid deadline predicate preserves the minimum ${location} deadline`,t=>{
  t.mock.method(Date,'now',()=>now);const value=input();set(value,location,now+1);assert.equal(invoke(value),now+1);
});
for(const location of locations)for(const [label,offset] of [['zero',-now],['expired',-1],['exactly current',0]])
  test(`Scene paid deadline predicate rejects ${label} ${location} deadline`,t=>{
    t.mock.method(Date,'now',()=>now);const value=input();set(value,location,now+offset);assert.throws(()=>invoke(value),stop);
  });
for(const location of locations)for(const value of [NaN,Infinity,-Infinity])test(`Scene paid deadline predicate rejects ${String(value)} ${location} deadline`,t=>{
  t.mock.method(Date,'now',()=>now);const candidate=input();set(candidate,location,value);assert.throws(()=>invoke(candidate),stop);
});
for(const [name,value] of [['missing',undefined],['empty',''],['invalid','not a date']])test(`Scene paid deadline predicate rejects ${name} prepared date`,t=>{
  t.mock.method(Date,'now',()=>now);const candidate=input();candidate.prepared.validUntil=value;assert.throws(()=>invoke(candidate),stop);
});
for(const value of [null,'2026-09-17T12:01:00.000Z','1790000000000',true])test(`Scene paid deadline predicate refuses coercible assertion deadline ${JSON.stringify(value)}`,t=>{
  t.mock.method(Date,'now',()=>now);const candidate=input();candidate.assertions[2].deadlineMs=value;assert.throws(()=>invoke(candidate),stop);
});
test('Scene paid deadline predicate checks the complete assertion list and an omitted optional deadline',t=>{
  t.mock.method(Date,'now',()=>now);const candidate=input();candidate.assertions[1].deadlineMs=undefined;
  candidate.assertions.push({sql:'synthetic final original assertion',deadlineMs:now+17});assert.equal(invoke(candidate),now+17);
  candidate.assertions.at(-1).deadlineMs=now;assert.throws(()=>invoke(candidate),stop);
});
test('Scene paid deadline predicate rechecks the clock after an earlier successful observation',t=>{
  let clock=now;t.mock.method(Date,'now',()=>clock);const candidate=input(),minimum=now+50_000;
  assert.equal(invoke(candidate),minimum);clock=minimum;assert.throws(()=>invoke(candidate),stop);
});
