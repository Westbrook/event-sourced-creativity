import {test,expect} from './fixtures.mjs';
import {syntheticNetworkEnabled} from './helpers/synthetic-network.mjs';
import {FORMA_PERSONAL_MEMORY_MESSAGES} from '../../src/components/design-system/locales/personal-memory-messages.ts';
const m=(locale,key)=>FORMA_PERSONAL_MEMORY_MESSAGES[locale]['memory.live.'+key];
for(const locale of ['en','ar'])test.describe('Memory cross-scope '+locale,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 for(const uncertain of [false,true])test('Explicit scope consent and ephemeral preview '+locale+'/'+uncertain,async({page,context,baseURL})=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);let boundary='document',revision=null;const writes=[],reads=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  const enrollment={id:'a'.repeat(64),projectId:'project-atmosphere',documentId:'doc-atmosphere',organizationId:null,revision:1,learn:true,recall:true,background:true,
   retentionDays:30,timeZone:'UTC',expiresAt:new Date(Date.now()+86400000).toISOString(),policyVersion:'personal-memory-v2',lastAdmittedAt:null,throughSequence:24,cutoffSequence:null,backlog:false,nextDueAt:new Date().toISOString(),attempts:0,status:'ready'};
  const source={enrollmentId:'b'.repeat(64),projectId:'project-atmosphere',documentId:'synthetic-other-document',zoom:'project',distance:0,weight:.7};
  await context.route('**/api/memory/assistant-context?*',route=>route.fulfill({status:503,json:{error:'synthetic_assistant_context_unavailable'}}));
  await context.route('**/api/memory/**',async route=>{
   const request=route.request(),url=new URL(request.url());expect(url.origin).toBe(new URL(baseURL).origin);
   if(request.method()!=='GET'){writes.push({path:url.pathname,body:request.postDataJSON()});expect(url.pathname).toBe('/api/memory/recall-boundary');}
   else reads.push(url.pathname);
   if(url.pathname==='/api/memory/settings')return route.fulfill({json:{enabled:true,policyVersion:'personal-memory-v2',writeContractVersion:'memory-settings-custody-v1',reviewContract:{timing:'daily-with-daytime-catch-up',preferredLocalWindow:{startHour:1,endHour:5},freshDaytimeCatchUpAllowed:true,savedPagesMayContinueOutsideWindow:true,strictlyOvernight:false,deliverySlaVerified:false},enrollments:[enrollment],nextAfter:null}});
   if(url.pathname==='/api/memory/derivation/settings')return route.fulfill({json:{version:'memory-derivation-control-v1',enabled:false,available:false,reason:'disabled',policyVersion:'personal-memory-derivation-v1',scope:{projectId:enrollment.projectId,documentId:enrollment.documentId,custody:{kind:'personal'}},enrollmentId:enrollment.id,enrollmentRevision:1,grants:[],qualifications:[],capScope:'payer-utc-calendar-month-all-memory-purposes',sourceWindow:'future-originals',processingImplemented:false,financial:null}});
   if(url.pathname==='/api/memory/recall-boundary'){
    if(request.method()==='GET')return route.fulfill({json:{version:'memory-scope-recall-v1',enrollmentId:enrollment.id,enrollmentRevision:1,boundary,revision,validUntil:new Date(Date.now()+25000).toISOString()}});
    if(uncertain)return route.fulfill({status:503,json:{version:'memory-scope-recall-v1',error:'recall_commit_unconfirmed'}});
    boundary=request.method()==='DELETE'?'document':request.postDataJSON().boundary;revision='12345678-1234-1234-1234-123456789abc';return route.fulfill({json:{version:'memory-scope-recall-v1',saved:true,refreshRequired:true}});
   }
   if(url.pathname==='/api/memory/recall-scopes'){
    const validUntil=new Date(Date.now()+(uncertain?25000:3000)).toISOString();
    if(!url.searchParams.has('source'))return route.fulfill({json:{version:'memory-scope-recall-v1',sources:[source],validUntil,complete:true}});
    expect(url.searchParams.get('source')).toBe(source.enrollmentId);const purpose=url.searchParams.get('purpose'),jobId='c'.repeat(64);
    return route.fulfill({json:{version:'memory-scope-recall-v1',source,validUntil,independentEvidence:false,completeHistory:false,presentationOnly:true,
     presentation:{jobId,expiresAt:enrollment.expiresAt,candidate:{version:'memory-derivation-candidates-v1',purpose,scopeKey:'synthetic-source-scope',manifestId:jobId,manifestRevision:1,validUntil,semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,items:[{operation:'assert',target:null,category:'proposal',text:'Private cross-scope proposal <script>not code</script>',supports:[{sourceIndex:0,start:0,end:8,text:'Original'}],counterevidence:[],claimKey:'d'.repeat(64),lineageIds:['e'.repeat(64)],sourceBindings:[{sourceId:'synthetic-original',revision:1,contentHash:'f'.repeat(64)}],validUntil,citationStatus:'support-cited'}]}}}});
   }
   return route.fallback();
  });
  await page.goto('/document/doc-atmosphere/atmosphere-studies');await expect(page.locator('forma-workspace')).toBeVisible();
  const assistant=page.locator('.application-creative > forma-creative-assistant');await assistant.locator('button.forma-assistant-launcher').click();
  const memory=assistant.locator('[data-assistant-memory]');await memory.locator(':scope > summary').click();
  await memory.locator('select[name="memory-document"]').selectOption(enrollment.documentId);
  const control=memory.locator('forma-memory-recall-boundary');await expect(control).toBeVisible();
  expect(reads.filter(p=>p.includes('recall-boundary')||p.includes('recall-scopes'))).toEqual([]);expect(writes).toEqual([]);
  await control.getByRole('button',{name:m(locale,'recallBoundaryLoad'),exact:true}).click();
  const select=control.getByRole('combobox',{name:m(locale,'recallBoundaryRange'),exact:true});await expect(select).toHaveValue('document');
  await select.selectOption('project-tree');const save=control.getByRole('button',{name:m(locale,'recallBoundarySave'),exact:true});await expect(save).toBeDisabled();
  await control.getByRole('checkbox').check();await save.click();await expect(control.getByRole('status')).toHaveText(m(locale,uncertain?'recallBoundaryUncertain':'recallBoundarySaved'));expect(writes).toHaveLength(1);
  await expect(save).toHaveCount(0);await control.getByRole('button',{name:m(locale,'recallBoundaryLoad'),exact:true}).click();await expect(select).toHaveValue(uncertain?'document':'project-tree');expect(writes).toHaveLength(1);
  await control.getByRole('button',{name:m(locale,'recallBoundarySources'),exact:true}).click();await expect(control.getByRole('combobox',{name:m(locale,'recallBoundarySource'),exact:true})).toHaveValue(source.enrollmentId);
  await control.getByRole('button',{name:m(locale,'reviewInspect'),exact:true}).click();await expect(control).toContainText('Private cross-scope proposal <script>not code</script>');await expect(control.locator('script')).toHaveCount(0);
  await control.getByText('Private cross-scope proposal <script>not code</script>',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.wrangler/memory-recall-'+locale+'-'+uncertain+'.png'});
  expect(await control.evaluate(e=>e.scrollWidth>e.clientWidth+1)).toBe(false);
  if(uncertain)await page.evaluate(()=>window.dispatchEvent(new Event('blur')));else await control.locator('details > summary').click();
  await expect(control).not.toContainText('Private cross-scope proposal');
  if(!uncertain)await expect(control.getByRole('button',{name:m(locale,'recallBoundaryLoad'),exact:true})).toBeFocused();expect(writes).toHaveLength(1);expect(errors).toEqual([]);
 });
});
