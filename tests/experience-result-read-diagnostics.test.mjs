import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8');
function methods(names,bindings){
 const ast=ts.createSourceFile('host.ts',source,ts.ScriptTarget.Latest,true),klass=ast.statements.find(s=>ts.isClassDeclaration(s)&&s.name?.text==='FormaExperienceHost');
 const body=names.map(name=>klass.members.find(m=>m.name?.getText(ast)==='#'+name).getText(ast).replace(/#/gu,'_').replace(/\bimport\(/gu,'mockImport(')).join('\n');
 const js=ts.transpileModule('class Actual {'+body+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 return Function(...Object.keys(bindings),js+';return Actual;')(...Object.values(bindings));
}
function setup(failure){
 const secret=Error('private-body/provider-id/secret?expired=1'),expiresAt='2099-01-01T00:00:00.000Z';
 const candidate={output:'audio',jobId:'job',artifactId:'artifact',contentRef:'content',inputRef:'input',plannerResponseId:'response',mediaUrl:'/api/media/owned.mp3',audio:{mediaSha256:'a'.repeat(64)},expiresAt};
 const audio={output:'audio',content:{inputRef:'input',media:{url:candidate.mediaUrl,mediaType:'audio/mpeg',sha256:'a'.repeat(64)},role:'score',lyrics:''},expiresAt};
 const state={original:{jobId:'job',jobStatus:'completed'},status:'succeeded',plan:{},grant:{usedCalls:2,usedMicrousd:100},audioCostPreview:{}};
 const operation={wait:async value=>value},binding={client:{identity:{output:'audio'}},audioSource:{}};
 const fail=stage=>{if(failure===stage)throw secret;};
 const Actual=methods(['check'],{bindingJson:JSON.stringify,experienceResultGrantCurrent:()=>true,verifyExperienceAudioInput:async()=>failure!=='input_validation',mockImport:async()=>({readNativeRetainedOutput:async()=>{fail('retained_read');return failure==='final_projection'?{...audio,output:'video'}:audio;},renderNativeRetainedAudio:()=>{}})});
 const host=new Actual();Object.assign(host,{_binding:binding,_busy:false,_readable:()=>true,_visible:()=>true,_beginOperation:()=>{host._resultReadFailure=undefined;return operation;},_clearResult(){this._result=undefined;},_resetDecision(){},requestUpdate(){},_refreshAndRead:async()=>{fail('source_state');},_state:()=>state,_operationCurrent:()=>failure!=='withdrawn',_snapshotMatches:()=>true,_baseCurrent:()=>true,_finishOperation:()=>true,_scheduleDeadline(){},_scheduleResultRead(){},_candidate:()=>failure==='candidate'?null:candidate,
 ownerDocument:{location:{origin:'https://forma.local'}},store:{outputRequirements:{ensure:async()=>{fail('requirements');}},inspectOutputNativeJob:async()=>{fail('native_job');return{status:'found',current:()=>true,job:{status:'completed'}};},ensurePrivateContent:async ref=>{fail(ref==='input'?'private_input':'private_content');if(failure==='withdrawn')throw secret;return '{}';}}});
 return host;
}
for(const stage of ['source_state','requirements','native_job','candidate','private_content','private_input','input_validation','retained_read','final_projection'])test('actual Audio host reports only fixed stage '+stage,async()=>{
 const host=setup(stage);await host._check();assert.deepEqual(host._resultReadFailure,{stage,kind:'unavailable'});assert.equal(host._status,'Result unavailable');assert.equal(host._result,undefined);assert.equal(JSON.stringify(host._resultReadFailure).includes('secret'),false);
});
test('successful retained Audio clears old diagnostic and remains playable',async()=>{const host=setup();host._resultReadFailure={stage:'private_input',kind:'deadline'};host.i18n={system:x=>x};await host._check();assert.equal(host._resultReadFailure,undefined);assert.equal(host._result.output,'audio');});
test('withdrawn operation cannot publish diagnostic',async()=>{const host=setup('withdrawn');await host._check();assert.equal(host._resultReadFailure,undefined);});
test('deadline provenance comes only from currently owned host timer',()=>{
 const callbacks=[];class FakeOperation{constructor(callback){callbacks.push(callback);}cancel(){}}
 const Actual=methods(['beginOperation'],{ExperienceHostOperation:FakeOperation}),host=new Actual();
 Object.assign(host,{_stopResultRead(){},_navigationEpoch:0,_clearResult(){},_resetDecision(){},requestUpdate(){},_binding:{client:{dispose(){}}}});
 host._beginOperation({action:'inspectResult',output:'audio'});host._resultReadStage='private_input';callbacks[0]();assert.deepEqual(host._resultReadFailure,{stage:'private_input',kind:'deadline'});
 host._beginOperation({action:'inspectResult',output:'audio'});host._resultReadStage='source_state';callbacks[0]();assert.equal(host._resultReadFailure,undefined);
 host._beginOperation({action:'authorize',output:'audio'});host._resultReadStage='requirements';callbacks[2]();assert.equal(host._resultReadFailure,undefined);
});
test('technical details expose fixed codes only; catches never read exception message',()=>{
 assert.match(source,/result_read:\$\{resultFailure.stage\}:\$\{resultFailure.kind\}/u);
 assert.match(source,/const resultFailure = available \? this.#resultReadFailure : undefined/u);
 const check=source.slice(source.indexOf('  async #check('),source.indexOf('  #stopResultRead()',source.indexOf('  async #check(')));
 assert.doesNotMatch(check,/catch\s*\([^)]*\)/u);
 assert.match(source,/#retire\(\) \{\s*this.#resultReadStage = undefined; this.#resultReadFailure = undefined/u);
});

