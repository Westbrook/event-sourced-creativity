/** Whole-app rendering with declared synthetic GET responses only. No production,
 * authentication, enrollment, provider, background or hosted qualification claim. */
import {test,expect,captureViewport} from './fixtures.mjs';
import {syntheticNetworkEnabled,syntheticReadBody} from './helpers/synthetic-network.mjs';
import {FORMA_PERSONAL_MEMORY_MESSAGES} from '../../src/components/design-system/locales/personal-memory-messages.ts';
const path='/document/doc-atmosphere/atmosphere-studies';
const message=(locale,key)=>FORMA_PERSONAL_MEMORY_MESSAGES[locale]['memory.live.'+key];
for(const locale of ['en','ar'])test.describe('Memory purpose locale '+locale,()=>{
  test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
  test('Memory purposes: explicit inactive controls in '+locale,async({page,context,baseURL},info)=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);const origin=new URL(baseURL).origin;
  const item={id:'a'.repeat(64),projectId:'project-atmosphere',documentId:'doc-atmosphere',organizationId:null,revision:1,learn:true,recall:true,background:true,
    retentionDays:30,timeZone:'UTC',expiresAt:new Date(Date.now()+86400000).toISOString(),policyVersion:'personal-memory-v2',lastAdmittedAt:null,throughSequence:24,cutoffSequence:null,
    backlog:false,nextDueAt:new Date().toISOString(),attempts:0,status:'ready'};
  const settings={enabled:true,policyVersion:'personal-memory-v2',writeContractVersion:'memory-settings-custody-v1',reviewContract:{timing:'daily-with-daytime-catch-up',
    preferredLocalWindow:{startHour:1,endHour:5},freshDaytimeCatchUpAllowed:true,savedPagesMayContinueOutsideWindow:true,strictlyOvernight:false,deliverySlaVerified:false},enrollments:[item],nextAfter:null};
  const purposes={version:'memory-derivation-control-v1',enabled:false,available:false,reason:'disabled',policyVersion:'personal-memory-derivation-v1',
    scope:{projectId:item.projectId,documentId:item.documentId,custody:{kind:'personal'}},enrollmentId:item.id,enrollmentRevision:1,grants:[],qualifications:[],
    capScope:'payer-utc-calendar-month-all-memory-purposes',sourceWindow:'future-originals',processingImplemented:false,financial:{period:new Date().toISOString().slice(0,7),checkedAt:new Date().toISOString(),capMicroUsd:100000,usedMicroUsd:580,reservedMicroUsd:1200,remainingMicroUsd:98220,retention:'independent-of-memory-erasure'}};
  const calls=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/memory/**',async route=>{const request=route.request(),url=new URL(request.url());calls.push({method:request.method(),path:url.pathname,query:url.search});
    expect(url.origin).toBe(origin);expect(request.method()).toBe('GET');
    if(url.pathname==='/api/memory/settings'&&!url.search)return route.fulfill({json:settings});
    if(url.pathname==='/api/memory/derivation/settings'&&url.search==='?projectId=project-atmosphere&documentId=doc-atmosphere')return route.fulfill({json:purposes});
    throw new Error('Undeclared Memory read');
  });
  await page.setViewportSize({width:locale==='ar'?320:1280,height:900});
  await page.goto(path);await expect(page.locator('forma-workspace')).toBeVisible();
  const owner=page.locator('.application-creative > forma-creative-assistant'),launcher=owner.locator('button.forma-assistant-launcher');
  await launcher.click();const memory=owner.locator('[data-assistant-memory]');await memory.locator(':scope > summary').click();
  const panel=memory.locator('forma-personal-memory');await expect(panel.locator('select[name="memory-document"]')).toBeVisible();
  await panel.locator('select[name="memory-document"]').selectOption(item.documentId);
  const section=panel.locator('[data-memory-purposes]');await section.locator(':scope > summary').click();
  await expect(section.getByText(message(locale,'purposeNotLoaded'),{exact:true})).toBeVisible();expect(calls.filter(c=>c.path.includes('/derivation/'))).toHaveLength(0);
  await section.getByRole('button',{name:message(locale,'purposeLoad'),exact:true}).click();
  await expect(section.getByText(message(locale,'purposeInactive'),{exact:true})).toBeVisible();
  await expect(section.locator('[data-memory-financial]')).toBeVisible();
  await expect(section.getByText(message(locale,'purposeFinanceRetention'),{exact:true})).toBeVisible();
  await expect(section.getByRole('button',{name:message(locale,'purposeEnable'),exact:true})).toBeDisabled();
  for(const field of ['charge','background','consent'])await expect(section.locator('[name="memory-purpose-'+field+'"]')).not.toBeChecked();
  expect(calls.filter(c=>c.path.includes('/derivation/'))).toHaveLength(1);expect(errors).toEqual([]);
  await captureViewport(page,info,'memory-purposes-'+locale,{assertStable:false});
  // Ordinary wheel scrolling targets the action, not a fixed distance that
  // overshoots it into the conversation following these variable-length terms.
  const transcript=owner.locator('.forma-assistant-transcript'),box=await transcript.boundingBox();expect(box).not.toBeNull();
  await page.mouse.move(box.x+4,box.y+box.height/2);
  const scrollEvidence=[],enable=section.getByRole('button',{name:message(locale,'purposeEnable'),exact:true});
  for(let step=0;step<8;step++){
    const target=await enable.boundingBox();expect(target).not.toBeNull();
    if(target.y>=box.y+4&&target.y+target.height<=box.y+box.height-4)break;
    const delta=target.y<box.y+4?target.y-box.y-8:target.y+target.height-box.y-box.height+8;
    await page.mouse.wheel(0,Math.max(-600,Math.min(600,delta)));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    scrollEvidence.push(await transcript.evaluate(el=>({top:el.scrollTop,height:el.clientHeight,extent:el.scrollHeight})));}
  await info.attach('financial-disclosure-scroll',{body:JSON.stringify(scrollEvidence),contentType:'application/json'});
  await expect(section.getByRole('button',{name:message(locale,'purposeEnable'),exact:true})).toBeInViewport();
  await captureViewport(page,info,'memory-purposes-bounds-'+locale,{assertStable:false});
  await info.attach('declared-memory-transport',{body:JSON.stringify({syntheticOnly:true,production:false,providerCalls:0,mutations:0,calls,session:JSON.parse(syntheticReadBody('/api/session')).user.userId},null,2),contentType:'application/json'});
});

});
