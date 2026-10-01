import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {foldEvents} from '../src/model/events.ts';
import {ACTIONS,eligibleActions,evaluateActions,questionsFor} from '../src/still/decisions.ts';
import {paletteActions,explicitAction} from '../src/still/finder.ts';
import {cleanExplicitGoal} from '../src/still/workflow-state.ts';
import {describeAction} from '../src/still/action-metadata.ts';
import {isPersonalAction,pageToolbarCandidates} from '../src/still/local-policy.ts';
import {stillPageTitle} from '../src/still/page-title.ts';
import {parseStillRoute,stillPath,stillURL} from '../src/still/routes.ts';

const events=[['ProjectCreated',{project_id:'p',name:'Test project'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'Test document'}],['BlockCreated',{project_id:'p',document_id:'d',block_id:'b',scope:'document',type:'subject',properties:{text:'A fictional observatory'}}]].map(([type,payload],index)=>({eventId:`event-${index}`,sequence:index+1,type,payload}));
const projection=foldEvents(events,Infinity,'d','p');
const position={projectId:'p',documentId:'d',blockId:'',outputId:'',view:'document',intent:'',recentActions:[]};
const viewer={author:false,generate:false,projectCreate:false,formats:[]};
const personal=['intent','user-settings'];

test('Your goal and User settings are canonical discoverable personal actions for viewers in every scope',()=>{
  for(const scope of [{view:'projects',projectId:'',documentId:''},{view:'documents',documentId:''},{view:'ideas',documentId:''},{view:'document'},{view:'document',blockId:'b'},{view:'results'},{view:'generation',outputId:'job'},{view:'artifact',outputId:'result'}]){
    const pos={...position,...scope},candidates=eligibleActions(projection,pos,viewer);
    assert.deepEqual(candidates.filter(action=>isPersonalAction(action.id)).map(action=>action.id),personal);
    assert.deepEqual(paletteActions('',candidates).filter(action=>isPersonalAction(action.id)).map(action=>action.id),personal);
    assert.equal(explicitAction('Your goal',candidates),'intent');
    assert.equal(explicitAction('Set next goal',candidates),'intent','The previous exact command keeps its meaning');
    assert.equal(explicitAction('User settings',candidates),'user-settings');
    for(const query of ['settings','suggestion history','preferences'])assert.equal(paletteActions(query,candidates)[0]?.id,'user-settings');
    assert.deepEqual(paletteActions('goal',candidates).map(action=>action.id),['intent']);
    for(const id of personal){
      const route=parseStillRoute(stillPath({...pos,mode:id,format:'',page:0,itemIndex:0}));
      assert.equal(route.mode,id);assert.match(stillPageTitle(stillPath(route),projection),id==='intent'?/^Your goal/:/^User settings/);
      const metadata=describeAction({id});assert.equal(metadata.launch,'configuration');assert.equal(metadata.cost,'free');assert.equal(metadata.risk,'preference');assert.ok(!metadata.outcome.includes('event-receipt'));
    }
  }
});

test('personal actions stay in discovery without appearing in scored or fallback creative toolbars',()=>{
  const candidates=eligibleActions(projection,position,{...viewer,author:true,projectCreate:true});
  const scores=Object.fromEntries(candidates.map(action=>[`use_${action.id}`,{type:'score',score:3,confidence:1}]));
  for(const evaluation of [evaluateActions(candidates,position,{},projection),evaluateActions(candidates,position,scores,projection)]){
    assert.ok(evaluation.selected.every(action=>!isPersonalAction(action.id)));
    assert.ok(evaluation.ranked.every(action=>!isPersonalAction(action.id)));
  }
  assert.ok(pageToolbarCandidates(candidates,position).every(action=>!isPersonalAction(action.id)));
  const questions=questionsFor(candidates,position);
  for(const id of personal){assert.equal(questions[`use_${id}`],undefined);assert.equal(questions.next_best_action.criteria[id],undefined);}
  const palettePosition={...position,palette:{entry:'direct',surface:'toolbar',toolbar:[],more:[]}};
  const palette=evaluateActions(candidates,palettePosition,scores,projection);
  for(const id of personal)assert.ok(palette.ranked.some(action=>action.id===id));
});

// Execute the production class methods through small ports; browser coverage
// additionally verifies native dialog focus, the palette, and real persistence.
const source=ts.createSourceFile('app.ts',fs.readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const app=source.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='StillApp');
function method(name,bindings={}){
  const member=app.members.find(node=>node.name?.getText(source)===name);
  const async=member.modifiers?.some(node=>node.kind===ts.SyntaxKind.AsyncKeyword)?'async ':'';
  const code=ts.transpileModule(`${async}function ${name}(${member.parameters.map(parameter=>parameter.getText(source)).join(',')}) ${member.body.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(bindings),`${code};return ${name};`)(...Object.values(bindings));
}

test('User settings opens over a dirty workflow without replacing its draft or target',()=>{
  const calls=[],host={loading:false,startupFailed:false,busy:false,composing:false,actionSettingsBusy:false,client:{session:{policy:{accepted:true}}},suggestionTargets:{'use-in':'fictional-target'},useInTarget:'fictional-target',preventsRouteChange:()=>true,closeFinder:()=>calls.push('close-palette'),runListAction:()=>false,choose:(...args)=>calls.push(args),changed(){}};
  const open=method('openFoundAction',{finderEntry:id=>id});
  open.call(host,'intent',false);assert.deepEqual(calls,[]);assert.match(host.finderMessage,/Finish or close/);
  open.call(host,'user-settings',false);assert.deepEqual(calls,['close-palette',['user-settings','palette']]);assert.deepEqual(host.suggestionTargets,{'use-in':'fictional-target'});assert.equal(host.useInTarget,'fictional-target');
  calls.length=0;host.actionSettingsBusy=true;open.call(host,'user-settings',false);assert.deepEqual(calls,[]);
  const draft={changed(){},mode:'new-document',bodyDraft:'A kept idea',titleDraft:'Kept title',generation:{format:'image'},openActionSettings:()=>calls.push('open-settings'),writeRoute:()=>calls.push('route')};
  method('begin').call(draft,'user-settings');
  assert.equal(draft.mode,'new-document');assert.equal(draft.bodyDraft,'A kept idea');assert.equal(draft.titleDraft,'Kept title');assert.deepEqual(draft.generation,{format:'image'});assert.equal(draft.routeMode,'user-settings');assert.deepEqual(calls,['open-settings','route']);
});

test('closing settings restores the underlying route and focus without finishing its invocation',async()=>{
  const calls=[],host={actionSettingsBusy:false,actionSettingsOpen:true,actionContext:{finish(){throw new Error('Do not finish the underlying operation');}},routeMode:'user-settings',mode:'new-document',activeAddress:'/still/action/user-settings',writeRoute(replace){assert.equal(replace,true);calls.push(this.routeMode);this.activeAddress='/still/action/new-document';},changed(){},updateComplete:Promise.resolve(),querySelector:()=>null,focusContent:()=>calls.push('focus'),actionContextNeedsRefresh:false};
  method('closeActionSettings').call(host);await host.updateComplete;await Promise.resolve();
  assert.equal(host.actionSettingsOpen,false);assert.equal(host.mode,'new-document');assert.deepEqual(calls,['new-document','focus']);
});

test('personal settings invocation requests preservation of the pending creative action',()=>{
  const calls=[],host={observeExposedActions(){},appliedPaletteDecisionId:'decision',mode:'new-document',client:{position:{view:'documents'}},actionContext:{select:(...args)=>calls.push(args)}};
  method('recordActionSelection',{ACTIONS}).call(host,'user-settings','palette');
  assert.deepEqual(calls,[['user-settings','decision','documents','palette',{preserveInvocation:true}]]);
});

test('goal lifecycle remains an explicit command and clears only personal goal state',async()=>{
  for(const status of ['completed','abandoned','clear']){
    const calls=[],host={goalStoredId:'displayed-goal',actionContext:{value:{goal:{id:'displayed-goal'}},finishGoal:async value=>calls.push(value),finish:()=>calls.push('finish')},client:{position:{intent:'Review the fictional observatory',goal:{text:'Review the fictional observatory'}},append:()=>assert.fail('Personal goals must not append creative events')},decisionMemory:{clear:()=>calls.push('invalidate')},closeMode:()=>calls.push('close')};
    await method('finishGoal').call(host,status);assert.deepEqual(calls,[status,'finish','invalidate','close']);assert.equal(host.client.position.intent,'');assert.equal(host.client.position.goal,undefined);assert.match(host.notice,/Goal (completed|abandoned|cleared)\./);
  }
});

test('goal lifecycle commands cannot discard unsaved goal edits',()=>{
  const render=method('renderWorkflowDock');
  const host={mode:'intent',client:{position:{intent:'Existing goal'}},actionContext:{loaded:true,value:{}},unifiedCreation:()=>false,draftBaseline:'saved',draftSignature:()=> 'saved',toolbarLimit:1,compactDock:actions=>actions,run:async work=>work(),save(){},finishGoal(){},closeMode(){}};
  const saved=render.call(host);assert.deepEqual(saved.map(action=>action.label),['Save goal','Complete goal','Abandon goal','Clear goal','Back']);assert.ok(saved.filter(action=>action.id.startsWith('workflow:goal-')).every(action=>!action.disabled));
  host.draftSignature=()=> 'edited';const edited=render.call(host);assert.ok(edited.filter(action=>action.id.startsWith('workflow:goal-')).every(action=>action.disabled));assert.equal(edited[0].disabled,false);
  host.draftSignature=()=> 'saved';host.actionContext.value.coverage={status:'unavailable'};host.rememberGoal=true;assert.equal(render.call(host)[0].disabled,true);host.rememberGoal=false;assert.equal(render.call(host)[0].disabled,false,'A session-only goal does not overwrite an unavailable remembered goal');
  host.actionContext.loaded=false;assert.ok(render.call(host).filter(action=>action.id.startsWith('workflow:')).every(action=>action.disabled));
});


test('browser Back closes settings over a dirty draft without navigating or resetting its state',()=>{
  const member=app.members.find(node=>node.name?.getText(source)==='popstate');
  const code=ts.transpileModule(`const handler=${member.initializer.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const calls=[],host={loading:false,actionSettingsOpen:true,actionSettingsBusy:false,mode:'new-document',historyIndex:4,activeAddress:'/still/project/p/action/user-settings',address:()=>'/still/project/p/action/new-document',currentRoute:()=>({...position,view:'documents',documentId:'',mode:'user-settings',itemIndex:0,page:0,format:''}),preventsRouteChange:()=>true,closeActionSettings:()=>calls.push('close-settings'),readRoute:()=>assert.fail('Never reset a dirty draft to follow overlay Back'),bodyDraft:'An unsaved fictional idea',useInTarget:'original-target'};
  const back=new Function('stillURL','history',`${code};return handler;`).call(host,stillURL,{go:()=>calls.push('blocked')});
  back({state:{stillIndex:3}});assert.deepEqual(calls,['close-settings']);assert.equal(host.historyIndex,3);assert.equal(host.bodyDraft,'An unsaved fictional idea');assert.equal(host.useInTarget,'original-target');
  host.activeAddress=host.address();back({state:{stillIndex:2}});assert.equal(host.historyIndex,2,'Duplicate underlying URLs still update the history ownership index');
});

test('goal inputs wait for initial stored-goal lookup while ordinary editing remains available',()=>{
  const html=(strings,...values)=>({strings,values}),field=method('field',{html,live:value=>value});
  const host={mode:'intent',busy:false,generation:null,actionContext:{loaded:false}};
  const disabled=render=>render.values[render.strings.findIndex(part=>part.endsWith('.disabled='))];
  for(const rows of [1,3,6])assert.equal(disabled(field.call(host,'Goal','',()=>{},rows)),true,'Pending stored goal cannot be overwritten by an early edit');
  host.actionContext.loaded=true;assert.equal(disabled(field.call(host,'Goal','Saved goal',()=>{},6)),false);
  host.actionContext.loaded=false;host.mode='add-context';assert.equal(disabled(field.call(host,'Idea','',()=>{},6)),false,'Unavailable personal history does not block creative work');
});


test('reopening unavailable settings rereads the saved preference once and ignores a closed dialog',async()=>{
  let resolve,reads=0,initializations=0;
  const context={loaded:true,value:{enabled:false,coverage:{status:'unavailable'}},refresh:()=>{reads++;return new Promise(done=>{resolve=()=>{context.value={enabled:true,coverage:{status:'complete'}};done();};});}};
  const host={actionSettingsOpen:false,actionSettingsBusy:false,actionSettingsRead:0,actionContext:context,interactionScope:()=> 'same-scope',initializeActionSettings:()=>initializations++,changed(){}};
  const open=method('openActionSettings');
  open.call(host);assert.equal(reads,1);assert.equal(initializations,1);assert.equal(host.actionSettingsOpen,true);
  open.call(host);assert.equal(reads,1,'An already open dialog does not loop retries');
  resolve();await Promise.resolve();assert.equal(initializations,2);assert.equal(context.value.enabled,true);
  host.actionSettingsOpen=false;open.call(host);assert.equal(reads,1,'A known preference does not require another recovery read');
  host.actionSettingsOpen=false;context.value={enabled:false,coverage:{status:'unavailable'}};open.call(host);assert.equal(reads,2);const beforeClose=initializations;host.actionSettingsOpen=false;resolve();await Promise.resolve();assert.equal(initializations,beforeClose,'A closed dialog cannot be repopulated by its delayed read');
});


test('saving or ending a displayed session goal never erases an unseen goal returned by recovery',async()=>{
  for(const goalStoredId of ['', 'earlier-goal', 'displayed-goal']){
    const create=()=>{const calls=[];return {calls,host:{mode:'intent',goalStoredId,rememberGoal:false,bodyDraft:'A session-only next step',goalCriteriaDraft:'Keep the fictional observatory',client:{projection:{},position:{intent:'A session-only next step'}},actionContext:{value:{goal:{id:'displayed-goal',text:'A separately remembered goal'}},finishGoal:async status=>calls.push(status),finish(){}},decisionMemory:{clear(){}},closeMode(){}}};};
    const saved=create();await method('save',{cleanExplicitGoal}).call(saved.host);
    assert.deepEqual(saved.calls,goalStoredId==='displayed-goal'?['clear']:[]);assert.equal(saved.host.client.position.intent,'A session-only next step');assert.equal(saved.host.client.position.goal.text,'A session-only next step');
    for(const status of ['completed','abandoned','clear']){
      const ended=create();await method('finishGoal').call(ended.host,status);assert.deepEqual(ended.calls,goalStoredId==='displayed-goal'?[status]:[]);assert.equal(ended.host.client.position.intent,'');
    }
  }
});
