import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Exercise the actual component handlers against small focus/action ports, without
// loading the application's network client or substituting a copy of the handlers.
const source=ts.createSourceFile('app.ts',fs.readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const app=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StillApp');
function fixture(){
  const calls=[],host={paletteOpen:false,paletteQuery:'未確定',paletteIndex:0,desktop:{matches:true},candidates:()=>[],paletteOptions:()=>[{id:"one"},{id:"two"}],updateComplete:Promise.resolve(),querySelector:()=>null,changed:()=>calls.push('changed'),closeFinder:()=>calls.push('close'),openFinder:()=>calls.push('open'),openFoundAction:id=>calls.push(id),findAction:()=>calls.push('find')};
  for(const name of ['paletteKeys','paletteShortcut']){
    const member=app.members.find(n=>n.name?.getText(source)===name);
    const js=ts.transpileModule(`const handler=${member.initializer.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    host[name]=new Function('paletteActions',`${js};return handler;`).call(host,()=>[{id:'one'},{id:'two'}]);
  }
  return {host,calls};
}
const event=(key,extra={})=>({key,isComposing:false,keyCode:0,metaKey:false,ctrlKey:false,altKey:false,repeat:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra});
test('IME candidates keep navigation, confirmation and dismissal keys without app actions',()=>{
  for(const composition of [{isComposing:true},{keyCode:229}])for(const key of ['ArrowDown','ArrowUp','Home','End','Enter','Escape']){
    const {host,calls}=fixture(),e=event(key,composition);host.paletteKeys(e);
    assert.deepEqual(calls,[]);assert.equal(host.paletteIndex,0);assert.equal(host.paletteQuery,'未確定');assert.equal(e.prevented,undefined);
  }
  for(const composition of [{isComposing:true},{keyCode:229}]){
    const {host,calls}=fixture(),e=event('k',{metaKey:true,...composition});host.paletteShortcut(e);assert.deepEqual(calls,[]);assert.equal(e.prevented,undefined);
  }
});
test('settled keyboard input still selects actions, closes and toggles the palette',()=>{
  const {host,calls}=fixture();host.paletteKeys(event('ArrowDown'));assert.equal(host.paletteIndex,1);
  host.paletteKeys(event('Enter'));assert.ok(calls.includes('two'));
  host.paletteKeys(event('Escape'));assert.ok(calls.includes('close'));
  calls.length=0;host.paletteShortcut(event('k',{ctrlKey:true}));assert.deepEqual(calls,['open']);
  host.paletteOpen=true;host.paletteShortcut(event('K',{metaKey:true}));assert.deepEqual(calls,['open','close']);
  host.paletteShortcut(event('k',{metaKey:true,repeat:true}));assert.deepEqual(calls,['open','close']);
});
