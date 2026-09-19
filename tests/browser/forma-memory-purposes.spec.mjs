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
  const entry={jobId:'1'.repeat(64),purpose:'rolling-summary',scopeKey:'synthetic-private-scope',expiresAt:item.expiresAt},lineage='2'.repeat(64),claimKey='3'.repeat(64),validUntil=new Date(Date.now()+60000).toISOString();
  const reviewList={version:purposes.version,scope:purposes.scope,enrollmentId:item.id,enrollmentRevision:1,results:[entry],next:null,checkedAt:new Date().toISOString(),progress:[]};
  const reviewResult={version:purposes.version,jobId:entry.jobId,expiresAt:entry.expiresAt,controlRevisions:{[lineage]:0},history:{windowCount:3,originalPairs:6,boundary:'bounded',afterSequence:1,throughSequence:24},candidate:{version:'memory-derivation-candidates-v1',purpose:entry.purpose,scopeKey:entry.scopeKey,manifestId:entry.jobId,manifestRevision:1,validUntil,semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,
    items:[{operation:'assert',target:null,category:'proposal',text:'Synthetic private proposal <script>not code</script>.',supports:[],counterevidence:[],claimKey,lineageIds:[lineage],sourceBindings:[],validUntil,citationStatus:'support-cited'}]}};
  const calls=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/memory/**',async route=>{const request=route.request(),url=new URL(request.url());calls.push({method:request.method(),path:url.pathname,query:url.search});
    expect(url.origin).toBe(origin);expect(request.method()).toBe('GET');
    if(url.pathname==='/api/memory/settings'&&!url.search)return route.fulfill({json:settings});
    if(url.pathname==='/api/memory/recall'){
      expect(url.searchParams.get('id')).toBe(item.id);
      const checkedAt=new Date().toISOString(),until=new Date(Date.now()+60000).toISOString(),recordedAt=new Date(Date.now()-3600000).toISOString();
      const body={mode:'live-reference-memory',scope:{organizationId:null,projectId:item.projectId,documentId:item.documentId},
        lifetime:{version:'memory-recall-lifetime-v1',checkedAt,validUntil:until},treatment:'untrusted-historical-evidence',method:'extractive-not-semantic',consumption:{conversation:1},
        rollingConversation:{summary:[],recent:[{sourceEventId:'synthetic-original',recordedAt:checkedAt,user:'Synthetic reference for browser verification',assistant:'Synthetic historical response'}],completeFromStart:false},
        coverage:{since:new Date(Date.now()-86400000).toISOString(),throughSequence:24,remainingThroughSequence:null,bounded:true,sourceCount:1},
        sources:[{eventId:'synthetic-original',type:'AssistantReasoned',blockId:null,recordedAt:checkedAt,validUntil:until}],
        note:'Observed actions are not inferred preferences; excerpts are truncated and access-filtered.'};
      if(url.searchParams.has('consumptionEpisodes')){
        expect(url.searchParams.get('consumptionEpisodes')).toBe('memory-consumption-episodes-v4');
        body.consumptionEpisodes={version:'memory-consumption-episodes-v4',treatment:'descriptive-consumption',validUntil:until,
          sources:[{eventId:'synthetic-old-view',type:'DocumentArtifactViewed',recordedAt,validUntil:until,target:{kind:'artifact',documentId:item.documentId,artifactId:'synthetic-artifact',artifactKind:'slides',revision:0,contentSha256:'a'.repeat(64)}}],
          episodes:[{episodeId:null,observations:[{sourceIndex:0,kind:'viewer-open'}],firstRecordedAt:recordedAt,lastRecordedAt:recordedAt,validUntil:until,independentEvidence:false}],
          coverage:{eligibleSourceCount:1,observationCount:1,unavailableArtifactSourceCount:0,completeHistory:false,bounded:true,truncated:false},attention:'not-measured',comprehension:'not-measured',inferredPreferences:false};
      }
      return route.fulfill({json:body});
    }

    if(url.pathname==='/api/memory/derivation/settings'&&url.search==='?projectId=project-atmosphere&documentId=doc-atmosphere')return route.fulfill({json:purposes});
    if(url.pathname==='/api/memory/derivation/results')return route.fulfill({json:{...reviewList,...(url.searchParams.has('purpose')?{purpose:url.searchParams.get('purpose')}:{})}});
    if(url.pathname==='/api/memory/derivation/result'&&url.search==='?jobId='+entry.jobId)return route.fulfill({json:reviewResult});
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
  await section.getByRole('button',{name:message(locale,'reviewLatest.rolling-summary'),exact:true}).click();
  await expect(section.locator('[data-memory-derived-content]')).toContainText('Synthetic private proposal');
  expect(calls.some(call=>call.query.endsWith('&purpose=rolling-summary'))).toBe(true);
  for(const field of ['charge','background','consent'])await expect(section.locator('[name="memory-purpose-'+field+'"]')).not.toBeChecked();
  expect(calls.filter(c=>c.path.includes('/derivation/'))).toHaveLength(3);expect(errors).toEqual([]);
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
  const review=section.locator('[data-memory-derived-review]');
  await review.getByRole('button',{name:message(locale,'reviewLoad'),exact:true}).click();
  await review.getByRole('button',{name:message(locale,'reviewInspect'),exact:true}).click();
  await expect(review.locator('[data-memory-derived-content]')).toContainText('Synthetic private proposal <script>not code</script>.');
  await expect(review.locator('script')).toHaveCount(0);
  await expect(review.locator('[data-memory-history-boundary]')).toContainText(message(locale,'reviewHistory.bounded'));
  await expect(review.locator('[data-memory-history-boundary]')).not.toContainText('memory.live.');
  await expect(review.getByRole('button',{name:message(locale,'reviewCorrect'),exact:true})).toBeDisabled();
  const correction=review.getByRole('textbox',{name:message(locale,'reviewCorrection'),exact:true});await correction.fill('A synthetic user correction.');
  await expect(review.getByRole('button',{name:message(locale,'reviewCorrect'),exact:true})).toBeEnabled();
  expect(calls.filter(c=>c.path.includes('/derivation/'))).toHaveLength(5);expect(calls.every(c=>c.method==='GET')).toBe(true);
  await captureViewport(page,info,'memory-derived-review-'+locale,{assertStable:false});
  await section.locator(':scope > summary').click();await expect(section.locator('[data-memory-derived-content]')).toHaveCount(0);
  await section.locator(':scope > summary').click();await expect(section.locator('textarea')).toHaveCount(0);expect(errors).toEqual([]);
  await panel.locator('[data-memory-action="inspect"]').click();
  await expect(panel.getByRole('button',{name:message(locale,'visitsInclude'),exact:true})).toBeVisible();
  expect(calls.some(call=>call.query.includes('consumptionEpisodes='))).toBe(false);
  await panel.getByRole('button',{name:message(locale,'visitsInclude'),exact:true}).click();
  const visits=panel.locator('[data-memory-visits]');await expect(visits).toBeVisible();
  await expect(visits.getByText(message(locale,'visitsLimits'),{exact:true})).toBeVisible();
  await visits.locator('[data-memory-visit-references] > summary').click();
  const opened=visits.getByText(message(locale,'visitsArtifactOpened'),{exact:true});
  await opened.scrollIntoViewIfNeeded();await expect(opened).toBeInViewport();
  expect(calls.filter(call=>call.query.includes('consumptionEpisodes=memory-consumption-episodes-v4'))).toHaveLength(1);
  expect(calls.every(call=>call.method==='GET')).toBe(true);expect(errors).toEqual([]);
  await captureViewport(page,info,'memory-historical-views-'+locale,{assertStable:false});
  await info.attach('declared-memory-transport',{body:JSON.stringify({syntheticOnly:true,production:false,providerCalls:0,mutations:0,calls,session:JSON.parse(syntheticReadBody('/api/session')).user.userId},null,2),contentType:'application/json'});
});

});
