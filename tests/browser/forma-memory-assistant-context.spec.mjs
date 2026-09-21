import {ASSISTANT_MESSAGES} from '../../src/components/design-system/locales/assistant-messages.ts';
import {assistantSurfaceForRoute} from '../../src/model/assistant-route-policy.ts';
import {test,expect} from './fixtures.mjs';
import {syntheticNetworkEnabled} from './helpers/synthetic-network.mjs';
import {FORMA_PERSONAL_MEMORY_MESSAGES} from '../../src/components/design-system/locales/personal-memory-messages.ts';
const m=(locale,key)=>FORMA_PERSONAL_MEMORY_MESSAGES[locale]['memory.live.'+key];
for(const locale of ['en','ar'])test.describe('Saved assistant context '+locale,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 for(const uncertain of [false,true])test('reference review, dismissal, undo and privacy '+uncertain,async({page,context,baseURL})=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);let state='accepted',revision='12345678-1234-1234-1234-123456789abc';let finishDismiss;const writes=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));const jobId='a'.repeat(64),enrollmentId='b'.repeat(64),expiresAt=new Date(Date.now()+86400000).toISOString();
  await context.route('**/api/memory/settings',route=>route.fulfill({status:503,json:{error:'synthetic_memory_settings_unavailable'}}));
  await context.route('**/api/memory/assistant-context?*',async route=>{
   const request=route.request(),url=new URL(request.url());expect(url.origin).toBe(new URL(baseURL).origin);
   if(request.method()!=='GET'){
    writes.push({method:request.method(),body:request.postDataJSON()});expect(request.postDataJSON().revision).toBe(revision);
    if(request.method()==='PUT'&&uncertain)return route.fulfill({status:503,json:{version:'memory-assistant-context-v1',error:'assistant_context_commit_unconfirmed'}});
    if(request.method()==='DELETE')await new Promise(resolve=>{finishDismiss=resolve;});
    state=request.method()==='DELETE'?'dismissed':'accepted';revision=crypto.randomUUID();return route.fulfill({json:{version:'memory-assistant-context-v1',saved:true,refreshRequired:true}});
   }
   const validUntil=new Date(Date.now()+25000).toISOString(),metadata={version:'memory-assistant-context-v1',targetEnrollmentId:enrollmentId,targetRevision:1,validUntil};
   if(url.searchParams.get('controls')==='1'||state==='dismissed')return route.fulfill({json:{...metadata,context:{revision,state:state==='dismissed'?'dismissed':'unavailable',jobId},presentation:null}});
   return route.fulfill({json:{...metadata,context:{revision,state,jobId,purpose:'rolling-summary',expiresAt,source:{enrollmentId,projectId:'project-atmosphere',documentId:'doc-atmosphere',zoom:'document',distance:0,weight:1}},
    independentEvidence:false,completeHistory:false,presentation:{jobId,expiresAt,candidate:{version:'memory-derivation-candidates-v1',purpose:'rolling-summary',scopeKey:'synthetic-scope',manifestId:jobId,manifestRevision:1,validUntil,
     semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,items:[{operation:'assert',target:null,category:'proposal',text:'Private saved context <script>not code</script>',supports:[{sourceIndex:0,start:0,end:8,text:'Original'}],counterevidence:[],claimKey:'d'.repeat(64),lineageIds:['e'.repeat(64)],sourceBindings:[{sourceId:'original',revision:1,contentHash:'f'.repeat(64)}],validUntil,citationStatus:'support-cited'}]}}}});
  });
  await page.goto('/document/doc-atmosphere/atmosphere-studies');await expect(page.locator('forma-workspace')).toBeVisible();
  const assistant=page.locator('.application-creative > forma-creative-assistant');await assistant.locator('button.forma-assistant-launcher').click();
  await assistant.locator('[data-assistant-memory] > summary').click();
  const saved=assistant.locator('[data-memory-assistant-context]');await expect(saved).toContainText('Private saved context <script>not code</script>');await expect(saved.locator('script')).toHaveCount(0);expect(writes).toEqual([]);
  await saved.getByRole('button',{name:m(locale,'assistantContextDismiss'),exact:true}).click();await expect(saved).not.toContainText('Private saved context');await expect.poll(()=>typeof finishDismiss).toBe('function');finishDismiss();await expect(saved).toContainText(m(locale,'assistantContextDismissed'));await expect(saved).not.toContainText('Private saved context');
  await saved.getByRole('button',{name:m(locale,'assistantContextUndo'),exact:true}).click();
  if(uncertain){await expect(saved.getByRole('status')).toHaveText(m(locale,'assistantContextUncertain'));await expect(saved).not.toContainText('Private saved context');}
  else await expect(saved).toContainText('Private saved context');
  expect(writes).toHaveLength(2);expect(writes.map(w=>w.method)).toEqual(['DELETE','PUT']);
  await saved.scrollIntoViewIfNeeded();expect(await saved.evaluate(e=>e.scrollWidth>e.clientWidth+1)).toBe(false);await page.screenshot({path:'.wrangler/memory-assistant-context-'+locale+'-'+uncertain+'.png'});
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(saved).toHaveCount(0);expect(writes).toHaveLength(2);expect(errors).toEqual([]);
 });
});

// Actual whole-app modal and privacy lifecycle with synthetic transport only.
// Native authorization, finance and D1 are verified separately by runtime tests.
for(const creation of [false,true])for(const surface of ['document','chat'])for(const locale of ['en','ar'])for(const boundary of ['blur','expiry','apply'])test.describe('Semantic assistant '+(creation?'creation':'result')+' '+surface+' '+locale+' '+boundary,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 test('historical result retires its private modal without a new purchase',async({page,context,baseURL})=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);
  const {syntheticReadBody}=await import('./helpers/synthetic-network.mjs');
  const documentPath='/document/doc-atmosphere/atmosphere-studies',routePath=documentPath+(surface==='chat'?'/view/chat':''),query=new URLSearchParams({route:documentPath,projectId:'project-atmosphere'}),errors=[],calls=[];
  if(surface==='chat'||boundary==='apply')await context.route('**/api/session',request=>{const body=JSON.parse(syntheticReadBody('/api/session'));body.provider.plannerConfigured=true;if(boundary==='apply')body.assistant.phase='actions';return request.fulfill({json:body});});
  page.on('pageerror',error=>errors.push(error.message));
  const originalRequest={turnId:'synthetic-semantic-turn',route:routePath,projectId:'project-atmosphere',documentId:'doc-atmosphere',canvasId:null,selectedItemIds:[],locale,model:'gpt-5.6-luna',taskKind:'clarify',sourceHash:'a'.repeat(64),conversationTurnIds:['synthetic-semantic-turn']};
  const quote={executionId:'synthetic-semantic-execution',bindingHash:'synthetic-binding',operation:'assistant-specialist',status:'completed',actorLabel:'Synthetic principal',workspaceId:null,period:'2026-09',projectId:'project-atmosphere',documentId:'doc-atmosphere',canvasId:null,blockId:'',sourceHash:'a'.repeat(64),provider:'openai',models:['gpt-5.6-luna'],maximumMicrousd:15000,maximumTokens:1600,providerCalls:1,searchCalls:0,publicQuery:'',privateInput:{source:'Synthetic private approved Memory context'},expiresAt:new Date(Date.now()+600000).toISOString(),providerAvailable:false,canExecute:false};
  const result={reply:'Synthetic retained Memory guidance <script>not executable</script>',sourceStatus:'semantic-memory-assisted',
   editReview:{version:'memory-edit-review-v1',executionId:quote.executionId,turnId:originalRequest.turnId,projectId:originalRequest.projectId,
    documentId:originalRequest.documentId,sourceHash:originalRequest.sourceHash,locale,mode:'review-only',independentEvidence:false,
    edits:[{blockId:'synthetic-block',field:'text',revision:3,beforeExcerpt:'Synthetic approved field excerpt',suggestedText:'Synthetic edit suggestion <script>not executable</script> اقتراح 日本語'}]}};
  const privateText=creation?'Synthetic new creative block <script>not executable</script> اقتراح 日本語':result.editReview.edits[0].suggestedText;
  if(creation){result.creationReview={version:'memory-creation-review-v1',executionId:quote.executionId,turnId:originalRequest.turnId,
    projectId:originalRequest.projectId,documentId:originalRequest.documentId,sourceHash:originalRequest.sourceHash,locale,mode:'review-only',independentEvidence:false,
    creations:[{proposalId:'create-0',blockType:'direction',intent:'include',text:privateText}]};delete result.editReview;}
  const createdEvents=creation&&boundary==='apply'?JSON.parse(syntheticReadBody('/api/events?after=0&limit=5000&content=1')).events:null;
  if(createdEvents)await context.route('**/api/events?*',request=>{
    const after=Number(new URL(request.request().url()).searchParams.get('after')??0),head=createdEvents.at(-1).sequence;
    return request.fulfill({json:{events:createdEvents.filter(event=>event.sequence>after),head,nextAfter:head,hasMore:false,content:{}}});
  });
  let validUntil='';const presentation=()=>({version:'semantic-memory-answer-v1',validUntil,independentEvidence:false});
  const task=()=>({id:quote.executionId,executionId:quote.executionId,turnId:originalRequest.turnId,bindingHash:quote.bindingHash,kind:'clarify',model:'gpt-5.6-luna',status:'completed',submission:'settled',canExecute:false,certifiedCompleted:true,completedReview:{turnId:originalRequest.turnId,executionId:quote.executionId,quote,originalRequest,result,memory:presentation()}});
  await context.route('**/api/assistant?*',async request=>{
   expect(request.request().method()).toBe('GET');validUntil=new Date(Date.now()+10000).toISOString();
   const body=JSON.parse(syntheticReadBody('/api/assistant?'+query));body.context.surface=assistantSurfaceForRoute(routePath);body.tasks=[task()];await request.fulfill({json:body});
  });
  await context.route('**/api/assistant/specialist?*',async request=>{
   const body=request.request().postDataJSON();calls.push(body);
   if(boundary==='apply'&&body.action===(creation?'apply-creation':'apply-edit')){
    expect(Object.keys(body).sort()).toEqual(['action','turnId','executionId','approvedBindingHash',...(creation?['proposalId','approvedCreationHash']:['blockId','approvedEditHash']),'publishToDocument'].sort());
    expect(body.publishToDocument).toBe(true);expect(creation?body.proposalId:body.blockId).toBe(creation?'create-0':'synthetic-block');expect(creation?body.approvedCreationHash:body.approvedEditHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(body)).not.toMatch(/Synthetic edit suggestion|Synthetic new creative block|Unsent local draft|Retained creative draft/u);
    if(createdEvents)createdEvents.push({...createdEvents[0],eventId:'synthetic-authored-edit',sequence:createdEvents.at(-1).sequence+1,type:'BlockCreated',actor:'user',clientId:'web:assistant-memory',
      payload:{project_id:'project-atmosphere',document_id:'doc-atmosphere',block_id:'synthetic-block',type:'direction',handle:'direction/synthetic',position:'zsynthetic',memory_authored_version:1,request_id:quote.executionId,properties:{text:privateText,intent:'include',weight:.7,authority:'authored'}}});
    return request.fulfill({json:{status:'applied',executionId:quote.executionId,...(creation?{proposalId:'create-0'}:{}),blockId:'synthetic-block',eventId:'synthetic-authored-edit'}});
   }
   expect(['resume','retrieve']).toContain(body.action);
   await request.fulfill({json:{turnId:originalRequest.turnId,executionId:quote.executionId,quote,originalRequest,result,memory:presentation(),task:task(),noAutomaticRetry:true}});
  });
  await context.route('**/api/memory/settings',request=>request.fulfill({status:503,json:{error:'synthetic_memory_settings_unavailable'}}));
  await page.goto(documentPath);
  if(surface==='chat'){
   const menu=page.locator('forma-workspace forma-studio-mode-nav forma-ui-popover.studio-view-menu');
   await menu.locator('button.ui-popover-trigger').click();
   await menu.locator('a[data-studio-view="chat"]').click();
   await expect(page).toHaveURL(new URL(routePath,baseURL).href);
  }
  const owner=page.locator(surface==='chat'?'forma-chat-studio forma-creative-assistant':'.application-creative > forma-creative-assistant');
  if(surface==='chat'){
   await expect(page.locator('forma-chat-studio')).toBeVisible();
   await page.locator('#creative-chat-message').fill('Retained creative draft');
   await page.locator('[data-chat-guidance-mode]').click();
   await expect(page.locator('textarea:visible')).toHaveCount(1);
   await expect(page.locator('.forma-assistant-launcher:visible')).toHaveCount(0);
   await expect(owner.locator('forma-assistant-panel')).toHaveAttribute('data-embedded','true');
   await expect(owner.locator('.forma-assistant-input')).toBeVisible();
   expect(await owner.evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);
   await page.screenshot({path:'.wrangler/memory-chat-guidance-'+locale+'.png'});
  }else{await expect(page.locator('forma-workspace')).toBeVisible();await owner.locator('button.forma-assistant-launcher').click();}
  const draft=owner.locator('.forma-assistant-input');await draft.fill('Unsent local draft');
  if(surface==='chat'){
   await page.locator('[data-chat-guidance-mode]').click();
   await expect(draft).toHaveValue('Unsent local draft');
   await expect(page.locator('#creative-chat-message')).toHaveCount(0);
  }
  await owner.locator('[data-assistant-execution-id="synthetic-semantic-execution"]').click();
  const dialog=owner.locator('dialog.forma-assistant-specialist');await expect(dialog).toBeVisible();await expect(dialog).toContainText(result.reply);await expect(dialog.locator('script')).toHaveCount(0);
  const editReview=dialog.locator(creation?'.forma-assistant-memory-creation-review':'.forma-assistant-memory-edit-review');await expect(editReview).toContainText(privateText);
  await expect(editReview.locator('button,input,textarea,select,a')).toHaveCount(boundary==='apply'?1:0);await editReview.scrollIntoViewIfNeeded();
  await page.screenshot({path:'.wrangler/memory-'+(creation?'creation':'edit')+'-review-'+surface+'-'+locale+'-'+boundary+'.png'});
  await dialog.locator('.forma-assistant-specialist-result').scrollIntoViewIfNeeded();expect(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);
  await page.screenshot({path:'.wrangler/memory-semantic-'+(creation?'creation':'result')+'-'+surface+'-'+locale+'-'+boundary+'.png'});
  if(boundary==='apply'){await expect(editReview).toContainText(ASSISTANT_MESSAGES[locale]['assistant.specialist.'+(creation?'creationDetail':'editPublishDetail')]);await editReview.getByRole('button',{name:ASSISTANT_MESSAGES[locale]['assistant.specialist.'+(creation?'creationApply':'editApply')],exact:true}).click();}
  if(boundary==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(dialog).not.toContainText(result.reply,{timeout:15000});await expect(dialog).not.toContainText('Synthetic private approved Memory context');await expect(dialog).not.toContainText(privateText);if(!creation)await expect(dialog).not.toContainText(result.editReview.edits[0].beforeExcerpt);
  await page.keyboard.press('Escape');await expect(draft).toHaveValue('Unsent local draft');
  if(surface==='chat'){
   await draft.fill('');await page.locator('[data-chat-guidance-mode]').click();
   await expect(page.locator('#creative-chat-message')).toHaveValue('Retained creative draft');
  }
  expect(calls.every(call=>['resume','retrieve',...(boundary==='apply'?[creation?'apply-creation':'apply-edit']:[])].includes(call.action))).toBe(true);expect(calls.filter(call=>call.action===(creation?'apply-creation':'apply-edit'))).toHaveLength(boundary==='apply'?1:0);expect(errors).toEqual([]);
 });
});

for(const locale of ['en','ar'])for(const background of [false,true])test.describe('Inline saved Memory field '+locale+'/'+(background?'background':'specialist'),()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 test('explicit read, composition, dirty draft, dismissal and late blur',async({page,context,baseURL})=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);
  const {syntheticReadBody}=await import('./helpers/synthetic-network.mjs');
  const original='A quiet interior that feels held between dusk and night.',suggestion='Saved suggestion <script>not executable</script> اقتراح 日本語';
  const calls=[],errors=[];let delay=false,release,applyBackground;page.on('pageerror',error=>errors.push(error.message));
  const label=key=>ASSISTANT_MESSAGES[locale]['assistant.specialist.'+key];
  await context.route('**/api/events/hot',request=>{expect(JSON.stringify(request.request().postDataJSON())).not.toMatch(/UNSENT|Saved suggestion/);return request.fulfill({status:503,json:{error:'synthetic_observation_not_saved'}});});
  await context.route('**/api/memory/settings',request=>request.fulfill({status:503,json:{error:'synthetic_memory_settings_unavailable'}}));
  await context.route('**/api/session',request=>{const body=JSON.parse(syntheticReadBody('/api/session'));body.assistant.phase='actions';return request.fulfill({json:body});});
  await context.route('**/api/assistant/field-suggestion?*',async request=>{
   if(request.request().method()==='POST'){expect(background).toBe(true);return applyBackground(request);}
   const url=new URL(request.request().url());calls.push(url.search);expect(request.request().method()).toBe('GET');
   expect([...url.searchParams.keys()].sort()).toEqual(['blockId','locale','projectId','route']);expect(url.searchParams.get('blockId')).toBe('block-direction');
   expect(url.search).not.toContain('UNSENT');if(delay)await new Promise(resolve=>{release=resolve;});
   await request.fulfill({json:{version:'memory-field-completion-v1',suggestion:background?{version:'memory-background-field-v1',jobId:'c'.repeat(64),claimKey:'derived:'+'d'.repeat(64),outputHash:'e'.repeat(64),textHash:'f'.repeat(64),projectId:'project-atmosphere',documentId:'doc-atmosphere',blockId:'block-direction',revision:1,sequence:17,beforeExcerpt:original,suggestedText:suggestion,locale,validUntil:new Date(Date.now()+20000).toISOString(),independentEvidence:false}:{bindingHash:'b'.repeat(64),validUntil:new Date(Date.now()+20000).toISOString(),independentEvidence:false,
    review:{version:'memory-edit-review-v1',executionId:'inline-synthetic-execution',turnId:'inline-synthetic-turn',projectId:'project-atmosphere',documentId:'doc-atmosphere',sourceHash:'a'.repeat(64),locale,mode:'review-only',independentEvidence:false,
     edits:[{blockId:'block-direction',field:'text',revision:1,beforeExcerpt:original,suggestedText:suggestion}]}}}});
  });
  await page.goto('/document/doc-atmosphere/atmosphere-studies');await expect(page.locator('forma-workspace')).toBeVisible();
  const block=page.locator('forma-context-block:has([id="context-controls-document-block-direction"])');
  await block.getByRole('radio').check();await block.locator('.context-controls-toggle').click();
  const editor=block.locator('#block-copy-block-direction'),field=block.locator('forma-memory-field-completion'),check=field.getByRole('button',{name:label('fieldCheck'),exact:true});
  await expect(editor).toHaveValue(original);await expect(check).toBeEnabled();expect(calls).toHaveLength(0);
  await editor.dispatchEvent('compositionstart');await expect(check).toBeDisabled();await editor.dispatchEvent('compositionend');await expect(check).toBeEnabled();
  await check.click();await expect(field).toContainText(suggestion);await expect(field.locator('script')).toHaveCount(0);await expect(editor).toHaveValue(original);
  await field.scrollIntoViewIfNeeded();expect(await field.evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);await page.screenshot({path:'.wrangler/memory-inline-field-'+locale+'-'+background+'.png'});
  await field.getByRole('button',{name:label('fieldDismiss'),exact:true}).focus();await page.keyboard.press('Escape');await expect(field).not.toContainText(suggestion);await expect(editor).toHaveValue(original);
  await check.click();await expect(field).toContainText(suggestion);await editor.fill('UNSENT local revision');await expect(field).not.toContainText(suggestion);await expect(check).toBeDisabled();expect(calls).toHaveLength(2);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(editor).toHaveValue('UNSENT local revision');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await editor.fill(original);await expect(check).toBeEnabled();delay=true;await check.click();await expect.poll(()=>typeof release).toBe('function');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));release();await expect(field).not.toContainText(suggestion);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(check).toBeEnabled();await expect(field).not.toContainText(suggestion);expect(calls).toHaveLength(3);expect(errors).toEqual([]);
  // The actual canonical event refresh, not a browser-injected block, supplies
  // the authored replacement and registers the server edit in native Undo.
  let accepted=false;const writes=[];
  const initial=JSON.parse(syntheticReadBody('/api/events?after=0&limit=5000&content=1')),events=initial.events;
  await context.route('**/api/events?*',request=>{
   const after=Number(new URL(request.request().url()).searchParams.get('after')??0),head=events.at(-1).sequence;
   return request.fulfill({json:{events:events.filter(event=>event.sequence>after),head,nextAfter:head,hasMore:false,content:{}}});
  });
  const apply=request=>{
   const body=request.request().postDataJSON();if(background){expect(Object.keys(body).sort()).toEqual(['jobId','claimKey','approvedEditHash','validUntil','publishToDocument'].sort());expect(body.jobId).toBe('c'.repeat(64));}else expect(body.action).toBe('apply-edit');expect(body.publishToDocument).toBe(true);expect(body.approvedEditHash).toMatch(/^[a-f0-9]{64}$/u);
   expect(JSON.stringify(body)).not.toContain(suggestion);expect(accepted).toBe(false);accepted=true;
   const requestId=background?'memory-field:'+body.approvedEditHash:'inline-synthetic-execution';
   events.push({...events[0],eventId:'inline-memory-authored',sequence:events.at(-1).sequence+1,type:'BlockPropertyEdited',actor:'user',clientId:'web:assistant-memory',
    payload:{project_id:'project-atmosphere',document_id:'doc-atmosphere',block_id:'block-direction',property_path:'text',old_value:original,new_value:suggestion,memory_authored_version:1,request_id:requestId}});
   return request.fulfill({json:{status:'applied',...(background?{jobId:body.jobId,requestId}:{executionId:'inline-synthetic-execution'}),blockId:'block-direction',eventId:'inline-memory-authored'}});
  };applyBackground=apply;await context.route('**/api/assistant/specialist?*',apply);
  await context.route('**/api/events',request=>{
   const body=request.request().postDataJSON();writes.push(body);expect(body.events).toHaveLength(1);const input=body.events[0];expect(input.compensatesEventId).toBe('inline-memory-authored');expect(input.payload.new_value).toBe(original);
   const event={...events[0],...input,eventId:'inline-memory-undo',sequence:events.at(-1).sequence+1,actor:'user',clientId:'web:lit'};events.push(event);
   return request.fulfill({json:{appended:[event],head:event.sequence,rejected:[],content:{}}});
  });
  delay=false;await check.click();await expect(field).toContainText(suggestion);await field.getByRole('button',{name:label('editApply'),exact:true}).click();
  await expect(editor).toHaveCount(0);expect(accepted).toBe(true);await expect(block).toContainText(suggestion);await expect(field).toHaveCount(0);
  // The toolbar is localized by the existing runtime; the first action is Undo.
  await page.locator('forma-workspace .document-actions > button').first().click();await expect(block).toContainText(original);expect(writes).toHaveLength(1);expect(errors).toEqual([]);
 });
});

for(const locale of ['en','ar'])test.describe('Fresh Memory field generation '+locale,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 test('saved field opens explicit cost review without sending drafts or buying generation',async({page,context,baseURL})=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);const {syntheticReadBody}=await import('./helpers/synthetic-network.mjs');
  const calls=[],errors=[],original='A quiet interior that feels held between dusk and night.',label=key=>ASSISTANT_MESSAGES[locale]['assistant.specialist.'+key];let savedTurn;
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/session',request=>{const body=JSON.parse(syntheticReadBody('/api/session'));body.assistant.phase='actions';return request.fulfill({json:body});});
  await context.route('**/api/events/hot',request=>request.fulfill({status:503,json:{error:'synthetic_observation_not_saved'}}));
  await context.route('**/api/memory/settings',request=>request.fulfill({status:503,json:{error:'synthetic_memory_settings_unavailable'}}));
  await context.route('**/api/assistant?*',request=>{
   const body=JSON.parse(syntheticReadBody('/api/assistant?'+new URLSearchParams({route:'/document/doc-atmosphere/atmosphere-studies',projectId:'project-atmosphere'})));
   if(request.request().method()==='GET')return request.fulfill({json:{...body,turns:savedTurn?[savedTurn]:[],tasks:[]}});
   const input=request.request().postDataJSON();calls.push(input);expect(input.message).toBe(label('fieldGenerationPrompt'));
   expect(Object.keys(input).sort()).toEqual(['turnId','message','locale','fieldTarget'].sort());expect(input.fieldTarget).toMatchObject({blockId:'block-direction',field:'text',revision:1});expect(input.fieldTarget.textHash).toMatch(/^[a-f0-9]{64}$/u);
   expect(JSON.stringify(input)).not.toMatch(/UNSENT|quiet interior/);
   savedTurn={id:input.turnId,user:input.message,reply:{text:'Free request saved.'},proposal:null,originalRequest:{schema:1,turnId:input.turnId,route:'/document/doc-atmosphere/atmosphere-studies',projectId:'project-atmosphere',documentId:'doc-atmosphere',canvasId:null,selectedItemIds:[],locale,fieldTarget:input.fieldTarget}};
   return request.fulfill({status:201,json:{context:body.context,turn:savedTurn,retiredTurnIds:[]}});
  });
  await context.route('**/api/assistant/specialist?*',request=>{
   const input=request.request().postDataJSON();calls.push(input);expect(input).toEqual({action:'quote',turnId:savedTurn.id,memory:'saved'});
   const quote={executionId:'fresh-field-execution',bindingHash:'a'.repeat(64),operation:'assistant-specialist',status:'quoted',actorLabel:'Synthetic principal',workspaceId:null,period:'2026-09',projectId:'project-atmosphere',documentId:'doc-atmosphere',canvasId:null,blockId:'',sourceHash:'b'.repeat(64),provider:'openai',models:['gpt-5.6-luna'],maximumMicrousd:15000,maximumTokens:1600,providerCalls:1,searchCalls:0,publicQuery:'',privateInput:{source:'Synthetic approved Memory'},expiresAt:new Date(Date.now()+600000).toISOString(),providerAvailable:true,budgetAvailable:true,canExecute:true,availableMicrousd:100000,unavailableReasons:[]};
   return request.fulfill({json:{turnId:savedTurn.id,executionId:quote.executionId,quote,originalRequest:{...savedTurn.originalRequest,model:'gpt-5.6-luna',taskKind:'clarify',sourceHash:quote.sourceHash,conversationTurnIds:[savedTurn.id]},memory:{version:'semantic-memory-answer-v1',validUntil:new Date(Date.now()+30000).toISOString(),independentEvidence:false},noAutomaticRetry:true}});
  });
  await page.goto('/document/doc-atmosphere/atmosphere-studies');await expect(page.locator('forma-workspace')).toBeVisible();
  const block=page.locator('forma-context-block:has([id="context-controls-document-block-direction"])');await block.getByRole('radio').check();await block.locator('.context-controls-toggle').click();
  const editor=block.locator('#block-copy-block-direction'),field=block.locator('forma-memory-field-completion'),generate=field.getByRole('button',{name:label('fieldGenerate'),exact:true});
  await expect(generate).toBeEnabled();await editor.fill('UNSENT local revision');await expect(generate).toBeDisabled();expect(calls).toHaveLength(0);
  await editor.fill(original);await editor.dispatchEvent('compositionstart');await expect(generate).toBeDisabled();await editor.dispatchEvent('compositionend');
  await generate.click();const dialog=page.locator('.forma-assistant-specialist');await expect(dialog).toBeVisible();await expect(dialog.locator('button').filter({hasText:label('approve')})).toBeEnabled();
  expect(calls).toHaveLength(2);await expect(editor).toHaveValue(original);expect(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);
  await page.screenshot({path:'.wrangler/memory-field-generation-'+locale+'.png'});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);expect(calls).toHaveLength(2);expect(errors).toEqual([]);
 });
});

for(const locale of ['en','ar'])for(const uncertain of [false,true])test.describe('Aggregate profile context '+locale+'/'+uncertain,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 test('private source removal, uncertainty and blur do not republish notes',async({page,context,baseURL})=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);const errors=[],writes=[];let included=true,revision='12345678-1234-1234-1234-123456789abc',resolveWrite;
  const jobId='a'.repeat(64),profileJob='b'.repeat(64),enrollmentId='target',expiresAt=new Date(Date.now()+86400000).toISOString();
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/memory/settings',r=>r.fulfill({status:503,json:{error:'synthetic_unavailable'}}));
  await context.route('**/api/memory/assistant-context?*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){
    const body=request.postDataJSON();writes.push(body);expect(request.method()).toBe('PUT');expect(body.jobId).toBe(jobId);expect(body.revision).toBe(revision);expect(body.profileJobIds).toBeUndefined();expect(JSON.stringify(body)).not.toContain('Private supplemental');
    await new Promise(resolve=>{resolveWrite=resolve;});
    if(uncertain)return route.fulfill({status:503,json:{version:'memory-assistant-context-v1',error:'assistant_context_commit_unconfirmed',noAutomaticRetry:true}});
    included=false;revision=crypto.randomUUID();return route.fulfill({json:{version:'memory-assistant-context-v1',saved:true,refreshRequired:true}});
   }
   const validUntil=new Date(Date.now()+25000).toISOString(),metadata={version:'memory-assistant-context-v1',targetEnrollmentId:enrollmentId,targetRevision:1,validUntil},profileMetadata=included?{profileJobIds:[profileJob]}:{};
   if(url.searchParams.get('controls')==='1')return route.fulfill({json:{...metadata,context:{revision,state:'unavailable',jobId,...profileMetadata},presentation:null}});
   const presentation=(id,purpose,text)=>({jobId:id,expiresAt,candidate:{version:'memory-derivation-candidates-v1',purpose,scopeKey:'synthetic-scope',manifestId:id,manifestRevision:1,validUntil,semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,items:[{operation:'assert',target:null,category:purpose==='profile'?'preference-hypothesis':'goal',text,supports:[{sourceIndex:0,start:0,end:8,text:'Original'}],counterevidence:[],claimKey:'d'.repeat(64),lineageIds:['e'.repeat(64)],sourceBindings:[{sourceId:'original',revision:1,contentHash:'f'.repeat(64)}],validUntil,citationStatus:'support-cited'}]}});
   return route.fulfill({json:{...metadata,context:{revision,state:'accepted',jobId,purpose:'rolling-summary',expiresAt,...profileMetadata,source:{enrollmentId,projectId:'project-atmosphere',documentId:'doc-atmosphere',zoom:'document',distance:0,weight:1}},independentEvidence:false,completeHistory:false,presentation:presentation(jobId,'rolling-summary','Private primary note'),...(included?{profiles:[{source:{enrollmentId:'peer',projectId:'project-atmosphere',documentId:'independent-document',zoom:'project',distance:0,weight:.7},presentation:presentation(profileJob,'profile','Private supplemental profile <script>not code</script>')}]}:{})}});
  });
  await page.goto('/document/doc-atmosphere/atmosphere-studies');await expect(page.locator('forma-workspace')).toBeVisible();const assistant=page.locator('.application-creative > forma-creative-assistant');
  await assistant.locator('button.forma-assistant-launcher').click();await assistant.locator('[data-assistant-memory] > summary').click();
  const saved=assistant.locator('[data-memory-assistant-context]');await expect(saved).toContainText('Private supplemental profile');await expect(saved.locator('script')).toHaveCount(0);expect(writes).toHaveLength(0);
  await saved.scrollIntoViewIfNeeded();expect(await saved.evaluate(e=>e.scrollWidth>e.clientWidth+1)).toBe(false);await page.screenshot({path:'.wrangler/memory-profile-aggregate-'+locale+'-'+uncertain+'.png'});
  await saved.getByRole('button',{name:m(locale,'assistantProfileRemove'),exact:true}).click();await expect(saved).not.toContainText('Private supplemental profile');await expect.poll(()=>typeof resolveWrite).toBe('function');resolveWrite();
  if(uncertain)await expect(saved.getByRole('status')).toHaveText(m(locale,'assistantContextUncertain'));else await expect(saved).toContainText('Private primary note');
  await expect(saved).not.toContainText('Private supplemental profile');expect(writes).toHaveLength(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(saved).toHaveCount(0);expect(errors).toEqual([]);expect(writes).toHaveLength(1);
 });
});
