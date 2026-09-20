import {test,expect} from './fixtures.mjs';
import {syntheticNetworkEnabled} from './helpers/synthetic-network.mjs';
import {FORMA_PERSONAL_MEMORY_MESSAGES} from '../../src/components/design-system/locales/personal-memory-messages.ts';
const m=(locale,key)=>FORMA_PERSONAL_MEMORY_MESSAGES[locale]['memory.live.'+key];
for(const locale of ['en','ar'])test.describe('Saved assistant context '+locale,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 for(const uncertain of [false,true])test('reference review, dismissal, undo and privacy '+uncertain,async({page,context,baseURL})=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);let state='accepted',revision='12345678-1234-1234-1234-123456789abc';const writes=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));const jobId='a'.repeat(64),enrollmentId='b'.repeat(64),expiresAt=new Date(Date.now()+86400000).toISOString();
  await context.route('**/api/memory/settings',route=>route.fulfill({status:503,json:{error:'synthetic_memory_settings_unavailable'}}));
  await context.route('**/api/memory/assistant-context?*',async route=>{
   const request=route.request(),url=new URL(request.url());expect(url.origin).toBe(new URL(baseURL).origin);
   if(request.method()!=='GET'){
    writes.push({method:request.method(),body:request.postDataJSON()});expect(request.postDataJSON().revision).toBe(revision);
    if(request.method()==='PUT'&&uncertain)return route.fulfill({status:503,json:{version:'memory-assistant-context-v1',error:'assistant_context_commit_unconfirmed'}});
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
  await saved.getByRole('button',{name:m(locale,'assistantContextDismiss'),exact:true}).click();await expect(saved).toContainText(m(locale,'assistantContextDismissed'));await expect(saved).not.toContainText('Private saved context');
  await saved.getByRole('button',{name:m(locale,'assistantContextUndo'),exact:true}).click();
  if(uncertain){await expect(saved.getByRole('status')).toHaveText(m(locale,'assistantContextUncertain'));await expect(saved).not.toContainText('Private saved context');}
  else await expect(saved).toContainText('Private saved context');
  expect(writes).toHaveLength(2);expect(writes.map(w=>w.method)).toEqual(['DELETE','PUT']);
  await saved.scrollIntoViewIfNeeded();expect(await saved.evaluate(e=>e.scrollWidth>e.clientWidth+1)).toBe(false);await page.screenshot({path:'.wrangler/memory-assistant-context-'+locale+'-'+uncertain+'.png'});
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(saved).toHaveCount(0);expect(writes).toHaveLength(2);expect(errors).toEqual([]);
 });
});
