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
for(const surface of ['document','chat'])for(const locale of ['en','ar'])for(const boundary of ['blur','expiry'])test.describe('Semantic assistant result '+surface+' '+locale+' '+boundary,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 test('historical result retires its private modal without a new purchase',async({page,context,baseURL})=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);
  const {syntheticReadBody}=await import('./helpers/synthetic-network.mjs');
  const documentPath='/document/doc-atmosphere/atmosphere-studies',routePath=documentPath+(surface==='chat'?'/view/chat':''),query=new URLSearchParams({route:documentPath,projectId:'project-atmosphere'}),errors=[],calls=[];
  if(surface==='chat')await context.route('**/api/session',request=>{const body=JSON.parse(syntheticReadBody('/api/session'));body.provider.plannerConfigured=true;return request.fulfill({json:body});});
  page.on('pageerror',error=>errors.push(error.message));
  const originalRequest={turnId:'synthetic-semantic-turn',route:routePath,projectId:'project-atmosphere',documentId:'doc-atmosphere',canvasId:null,selectedItemIds:[],locale,model:'gpt-5.6-luna',taskKind:'clarify',sourceHash:'a'.repeat(64),conversationTurnIds:['synthetic-semantic-turn']};
  const quote={executionId:'synthetic-semantic-execution',bindingHash:'synthetic-binding',operation:'assistant-specialist',status:'completed',actorLabel:'Synthetic principal',workspaceId:null,period:'2026-09',projectId:'project-atmosphere',documentId:'doc-atmosphere',canvasId:null,blockId:'',sourceHash:'a'.repeat(64),provider:'openai',models:['gpt-5.6-luna'],maximumMicrousd:15000,maximumTokens:1600,providerCalls:1,searchCalls:0,publicQuery:'',privateInput:{source:'Synthetic private approved Memory context'},expiresAt:new Date(Date.now()+600000).toISOString(),providerAvailable:false,canExecute:false};
  const result={reply:'Synthetic retained Memory guidance <script>not executable</script>',sourceStatus:'semantic-memory-assisted',
   editReview:{version:'memory-edit-review-v1',executionId:quote.executionId,turnId:originalRequest.turnId,projectId:originalRequest.projectId,
    documentId:originalRequest.documentId,sourceHash:originalRequest.sourceHash,locale,mode:'review-only',independentEvidence:false,
    edits:[{blockId:'synthetic-block',field:'text',revision:3,beforeExcerpt:'Synthetic approved field excerpt',suggestedText:'Synthetic edit suggestion <script>not executable</script> اقتراح 日本語'}]}};
  let validUntil='';const presentation=()=>({version:'semantic-memory-answer-v1',validUntil,independentEvidence:false});
  const task=()=>({id:quote.executionId,executionId:quote.executionId,turnId:originalRequest.turnId,bindingHash:quote.bindingHash,kind:'clarify',model:'gpt-5.6-luna',status:'completed',submission:'settled',canExecute:false,certifiedCompleted:true,completedReview:{turnId:originalRequest.turnId,executionId:quote.executionId,quote,originalRequest,result,memory:presentation()}});
  await context.route('**/api/assistant?*',async request=>{
   expect(request.request().method()).toBe('GET');validUntil=new Date(Date.now()+10000).toISOString();
   const body=JSON.parse(syntheticReadBody('/api/assistant?'+query));body.context.surface=assistantSurfaceForRoute(routePath);body.tasks=[task()];await request.fulfill({json:body});
  });
  await context.route('**/api/assistant/specialist?*',async request=>{
   const body=request.request().postDataJSON();calls.push(body);expect(['resume','retrieve']).toContain(body.action);
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
  const editReview=dialog.locator('.forma-assistant-memory-edit-review');await expect(editReview).toContainText(result.editReview.edits[0].suggestedText);
  await expect(editReview.locator('button,input,textarea,select,a')).toHaveCount(0);await editReview.scrollIntoViewIfNeeded();
  await page.screenshot({path:'.wrangler/memory-edit-review-'+surface+'-'+locale+'-'+boundary+'.png'});
  await dialog.locator('.forma-assistant-specialist-result').scrollIntoViewIfNeeded();expect(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);
  await page.screenshot({path:'.wrangler/memory-semantic-result-'+surface+'-'+locale+'-'+boundary+'.png'});
  if(boundary==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(dialog).not.toContainText(result.reply,{timeout:15000});await expect(dialog).not.toContainText('Synthetic private approved Memory context');await expect(dialog).not.toContainText(result.editReview.edits[0].suggestedText);await expect(dialog).not.toContainText(result.editReview.edits[0].beforeExcerpt);
  await page.keyboard.press('Escape');await expect(draft).toHaveValue('Unsent local draft');
  if(surface==='chat'){
   await draft.fill('');await page.locator('[data-chat-guidance-mode]').click();
   await expect(page.locator('#creative-chat-message')).toHaveValue('Retained creative draft');
  }
  expect(calls.every(call=>['resume','retrieve'].includes(call.action))).toBe(true);expect(errors).toEqual([]);
 });
});
