import {test,expect} from './fixtures.mjs';
import {syntheticNetworkEnabled,syntheticReadBody} from './helpers/synthetic-network.mjs';
import {memoryResourceIdentity} from '../../src/model/memory-resource-scope.ts';
const labels={en:{open:'Resource Memory',refresh:'Check settings',enable:'Enable resource Memory',review:'Review new activity',read:'Show retained activity',forget:'Forget this resource’s Memory',saved:'Saved.',forgotten:'Memory forgotten.',unavailable:'The request could not be confirmed.',counts:'Edits'},ar:{open:'ذاكرة المورد',refresh:'تحقق من الإعدادات',enable:'تفعيل ذاكرة المورد',review:'مراجعة النشاط الجديد',read:'عرض النشاط المحتفظ به',forget:'نسيان ذاكرة هذا المورد',saved:'تم الحفظ.',forgotten:'تم نسيان الذاكرة.',unavailable:'تعذر تأكيد الطلب.',counts:'تعديلات'}};
for(const locale of ['en','ar'])for(const kind of ['library','canvas'])test.describe('Independent resource Memory '+locale+'/'+kind,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 for(const uncertain of [false,true])test('explicit consent, bounded activity and privacy '+uncertain,async({page,context,baseURL})=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);const c=labels[locale],writes=[],reads=[],openings=[],errors=[];page.on('pageerror',e=>errors.push(e.message));let enrolled=null,captured=false,pendingRead=null,holdRead=false;
  const selector={kind,projectId:'project-atmosphere',resourceId:kind==='canvas'?'resource-test-board':'project-atmosphere'},scope=memoryResourceIdentity(selector,{actorUserId:'e6-network-synthetic-principal',ownerUserId:'e6-network-synthetic-principal',organizationId:null,projectAccessId:null});
  if(kind==='canvas'){
   await context.route('**/api/session?audience=canvas',route=>route.fulfill({json:{...JSON.parse(syntheticReadBody('/api/session')),audience:'canvas'}}));
   const original=JSON.parse(syntheticReadBody('/api/events?after=0&limit=5000&content=1')),event={...original.events[0],eventId:'resource-board-created',sequence:original.head+1,type:'CanvasCreated',payload:{canvas_id:selector.resourceId,project_id:selector.projectId,name:'Resource test board',slug:'resource-test-board'}};const events=[...original.events,event];
   await context.route('**/api/events?*',route=>{const u=new URL(route.request().url());if(route.request().method()!=='GET')return route.fallback();const after=Number(u.searchParams.get('after')??0);return route.fulfill({json:{events:events.filter(e=>e.sequence>after),head:event.sequence,nextAfter:event.sequence,hasMore:false,content:{}}});});
  }
  await context.route('**/api/memory/resource-*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/api/memory/resource-opening'){
    expect(req.method()).toBe('POST');expect(Object.keys(req.postDataJSON())).toEqual(['openingId']);expect(req.postDataJSON().openingId).toMatch(/^[a-f0-9-]{36}$/);
    const actual=Object.fromEntries(url.searchParams);openings.push({scope:actual,id:req.postDataJSON().openingId,recorded:!!enrolled&&JSON.stringify(actual)===JSON.stringify(selector)});
    return route.fulfill({json:{version:'memory-resource-opening-v1',recorded:openings.at(-1).recorded,noAutomaticRetry:true}});
   }
   const selected=Object.fromEntries(url.searchParams);
   if(url.pathname.endsWith('resource-settings')&&req.method()==='GET'&&JSON.stringify(selected)!==JSON.stringify(selector)){
    expect(selected).toEqual({kind:'library',projectId:'project-atmosphere',resourceId:'project-atmosphere'});
    return route.fulfill({json:{version:'memory-resource-settings-v1',scope:memoryResourceIdentity(selected,{actorUserId:scope.actorUserId,ownerUserId:scope.ownerUserId,organizationId:null,projectAccessId:null}),validUntil:new Date(Date.now()+25000).toISOString(),policyVersion:'personal-resource-memory-v1',enrollment:null}});
   }
   expect(selected).toEqual(selector);
   if(req.method()==='GET')reads.push(url.pathname);else writes.push({path:url.pathname,body:req.postDataJSON()});
   if(url.pathname.endsWith('resource-settings')){
    if(req.method()==='GET')return route.fulfill({json:{version:'memory-resource-settings-v1',scope,validUntil:new Date(Date.now()+25000).toISOString(),policyVersion:'personal-resource-memory-v1',enrollment:enrolled}});
    if(req.method()==='DELETE'){enrolled=null;captured=false;return route.fulfill({json:{version:'memory-resource-settings-v1',forgotten:true,authoredResourcesPreserved:true}});}
    if(uncertain)return route.fulfill({status:503,json:{version:'memory-resource-settings-v1',noAutomaticRetry:true}});
    const b=req.postDataJSON();enrolled={id:'12345678-1234-1234-1234-123456789abc',revision:1,...selector,learn:true,recall:true,background:b.background,retentionDays:b.retentionDays,timeZone:b.timeZone,enrolledAt:new Date().toISOString(),expiresAt:b.expiresAt,throughSequence:25,nextDueAt:new Date(Date.now()+60000).toISOString(),policyVersion:b.policyVersion};return route.fulfill({json:{version:'memory-resource-settings-v1',saved:true,refreshRequired:true}});
   }
   if(req.method()==='POST'){captured=true;return route.fulfill({json:{version:'memory-resource-history-v1',captured:1,throughSequence:26,more:false}});}
   if(holdRead)await new Promise(resolve=>{pendingRead=resolve;});
   return route.fulfill({json:{version:'memory-resource-history-v1',scope,validUntil:new Date(Date.now()+25000).toISOString(),method:'action-counts-not-semantic',independentPreferenceEvidence:false,linkedContentRead:false,coverage:{since:new Date().toISOString(),throughSequence:26,currentHead:26,completeFromStart:false,sourceLimit:256,sourceLimitReached:false},openings:{method:'resource-surface-open-not-content-consumption',limit:256,limitReached:false,available:true},windows:[7,30].map(days=>({days,resourceOpenings:openings.filter(r=>r.recorded).length,counts:captured?{edit:1}:{}})),sources:captured?[{eventId:'resource-private-event',type:'BlockCreated',recordedAt:new Date().toISOString()}]:[]}});
  });
  await page.goto('/library?document=doc-atmosphere');await expect(page.locator('forma-library')).toBeVisible();
  if(kind==='canvas'){await page.locator('a[href="/canvas"]').first().click();await page.locator('a[href="/canvas/resource-test-board/resource-test-board"]').first().click();await expect(page.locator('forma-canvas-surface .canvas-workspace')).toBeVisible();}
  const control=page.locator('forma-memory-resource-controls:visible');await expect(control).toBeVisible();expect(writes).toEqual([]);await expect.poll(()=>reads.length).toBe(1);expect(reads).toEqual(['/api/memory/resource-settings']);expect(openings).toEqual([]);
  await control.getByRole('button',{name:c.open,exact:true}).click();expect(reads).toEqual(['/api/memory/resource-settings']);await control.getByRole('button',{name:c.refresh,exact:true}).click();await expect(control.getByRole('button',{name:c.enable,exact:true})).toBeDisabled();
  await control.getByRole('checkbox').last().check();await control.getByRole('button',{name:c.enable,exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0].body.background).toBe(false);expect(writes[0].body.expectedCustody).toEqual({kind:'personal'});await expect(control.getByRole('status')).toContainText(uncertain?c.unavailable:c.saved);
  await control.getByRole('button',{name:c.refresh,exact:true}).click();if(uncertain){await expect(control.getByRole('button',{name:c.enable,exact:true})).toBeDisabled();expect(writes).toHaveLength(1);return;}
  const beforeReturn=openings.length;if(kind==='canvas'){await page.locator('a[href="/canvas"]').first().click();await page.locator('a[href="/canvas/resource-test-board/resource-test-board"]').first().click();}else await page.reload();await expect(control).toBeVisible();await expect.poll(()=>openings.length).toBe(beforeReturn+1);expect(openings.at(-1).scope).toEqual(selector);expect(openings.at(-1).recorded).toBe(true);expect(new Set(openings.map(r=>r.id)).size).toBe(openings.length);
  await control.getByRole('button',{name:c.open,exact:true}).click();await control.getByRole('button',{name:c.refresh,exact:true}).click();
  await control.getByRole('button',{name:c.read,exact:true}).click();await expect(control.locator('.resource-memory-windows')).not.toContainText(locale==='ar'?'لا يوجد نشاط محتفظ به':'No retained activity');await control.getByRole('button',{name:c.refresh,exact:true}).click();await control.getByRole('button',{name:c.review,exact:true}).click();await expect.poll(()=>writes.length).toBe(2);await control.getByRole('button',{name:c.refresh,exact:true}).click();await control.getByRole('button',{name:c.read,exact:true}).click();await expect(control.locator('.resource-memory-windows')).toContainText(c.counts);
  await control.locator('.resource-memory-windows').scrollIntoViewIfNeeded();await page.screenshot({path:'.wrangler/resource-memory-'+kind+'-'+locale+'.png'});expect(await control.evaluate(e=>e.scrollWidth>e.clientWidth+1)).toBe(false);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(control.locator('.resource-memory-windows')).toHaveCount(0);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(control.locator('.resource-memory-windows')).toHaveCount(0);
  await control.getByRole('button',{name:c.refresh,exact:true}).click();holdRead=true;await control.getByRole('button',{name:c.read,exact:true}).click();await expect.poll(()=>typeof pendingRead).toBe('function');await page.evaluate(()=>window.dispatchEvent(new Event('forma-memory-privacy-mutation')));pendingRead();await expect(control.locator('.resource-memory-windows')).toHaveCount(0);holdRead=false;
  await control.getByRole('button',{name:c.refresh,exact:true}).click();await control.getByRole('button',{name:c.forget,exact:true}).click();await expect(control.getByRole('status')).toContainText(c.forgotten);expect(writes).toHaveLength(3);expect(openings).toHaveLength(beforeReturn+1);expect(errors).toEqual([]);
 });
});

for(const locale of ['en','ar'])test.describe('Resource control inventory '+locale,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 test('forgetting remains available with Memory disabled and no source content',async({page,context})=>{
  const c=labels[locale],writes=[],reads=[];let exists=true;
  await context.route('**/api/memory/**',route=>{
   const req=route.request(),url=new URL(req.url());if(req.method()==='GET')reads.push(url.pathname);else writes.push({path:url.pathname,body:req.postDataJSON()});
   if(url.pathname==='/api/memory/settings')return route.fulfill({json:{enabled:false,policyVersion:'personal-memory-v2',writeContractVersion:'memory-settings-custody-v1',reviewContract:{timing:'daily-with-daytime-catch-up',preferredLocalWindow:{startHour:1,endHour:5},freshDaytimeCatchUpAllowed:true,savedPagesMayContinueOutsideWindow:true,strictlyOvernight:false,deliverySlaVerified:false},enrollments:[],nextAfter:null}});
   if(url.pathname==='/api/memory/resource-enrollments')return route.fulfill({json:{version:'memory-resource-settings-v1',controlMetadataOnly:true,validUntil:new Date(Date.now()+25000).toISOString(),nextAfter:null,enrollments:exists?[{id:'12345678-1234-1234-1234-123456789abc',revision:1,kind:'canvas',projectId:'former-project',resourceId:'former-board',ownerUserId:'former-owner<script>',organizationId:'former-organization',projectAccessId:'former-access',expiresAt:new Date(Date.now()+86400000).toISOString()}]:[]}});
   if(url.pathname==='/api/memory/resource-settings'&&req.method()==='DELETE'){exists=false;return route.fulfill({json:{version:'memory-resource-settings-v1',forgotten:true,authoredResourcesPreserved:true}});}
   return route.fulfill({status:503,json:{error:'synthetic_disabled'}});
  });
  await page.goto('/document/doc-atmosphere/atmosphere-studies');await expect(page.locator('forma-workspace')).toBeVisible();const assistant=page.locator('.application-creative > forma-creative-assistant');await assistant.locator('button.forma-assistant-launcher').click();const memory=assistant.locator('[data-assistant-memory]');await memory.locator(':scope > summary').click();
  const inventory=memory.locator('forma-memory-resource-inventory');await expect(inventory).toBeVisible();expect(reads.filter(p=>p.includes('resource'))).toEqual([]);await inventory.getByRole('button',{name:c.refresh,exact:true}).click();await expect(inventory).toContainText('former-owner<script>');await expect(inventory.locator('script')).toHaveCount(0);
  await inventory.getByRole('button',{name:c.forget,exact:true}).click();await expect(inventory.getByRole('status')).toContainText(c.forgotten);expect(writes).toEqual([{path:'/api/memory/resource-settings',body:{id:'12345678-1234-1234-1234-123456789abc',revision:1,confirmation:'FORGET_RESOURCE_MEMORY'}}]);await expect(inventory).not.toContainText('former-owner');expect(reads).not.toContain('/api/memory/resource-history');
 });
});
