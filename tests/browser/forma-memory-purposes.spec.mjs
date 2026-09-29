import {createHash} from 'node:crypto';
import {DERIVATION_EVIDENCE,derivationCanonical} from '../../src/model/memory-derivation-policy.ts';
/** Whole-app rendering with declared synthetic GET responses only. No production,
 * authentication, enrollment, provider, background or hosted qualification claim. */
import {test,expect,captureViewport} from './fixtures.mjs';
import {syntheticNetworkEnabled,syntheticReadBody} from './helpers/synthetic-network.mjs';
import {FORMA_PERSONAL_MEMORY_MESSAGES} from '../../src/components/design-system/locales/personal-memory-messages.ts';
const path='/document/doc-atmosphere/atmosphere-studies';
const message=(locale,key)=>FORMA_PERSONAL_MEMORY_MESSAGES[locale]['memory.live.'+key];
for(const locale of ['en','ar'])test.describe('Memory purpose locale '+locale,()=>{
  test.use({acceptDownloads:true,geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
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
    items:[{operation:'assert',target:null,category:'proposal',text:'Synthetic private proposal <script>not code</script>.',supports:[{sourceIndex:0,start:0,end:8,text:'Original'}],counterevidence:[],claimKey,lineageIds:[lineage],sourceBindings:[{sourceId:'synthetic-original',revision:1,contentHash:'4'.repeat(64)}],validUntil,citationStatus:'support-cited'}]}};
  const calls=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/api/memory/**',async route=>{const request=route.request(),url=new URL(request.url());calls.push({method:request.method(),path:url.pathname,query:url.search,automatic:request.headers()['x-forma-memory-consumer']==='document-brief-v1'});
    expect(url.origin).toBe(origin);expect(request.method()).toBe('GET');
    if(url.pathname==='/api/memory/assistant-context')return route.fulfill({status:503,json:{error:'synthetic_assistant_context_unavailable'}});
    if(url.pathname==='/api/memory/recall-scopes')return route.fulfill({json:{version:'memory-scope-recall-v1',sources:[],validUntil:new Date(Date.now()+25000).toISOString(),complete:true}});
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
        expect(url.searchParams.get('consumptionEpisodes')).toBe('memory-consumption-episodes-v6');
        body.consumptionEpisodes={version:'memory-consumption-episodes-v6',treatment:'descriptive-consumption',validUntil:until,
          sources:[{eventId:'synthetic-old-view',type:'DocumentArtifactViewed',recordedAt,validUntil:until,target:{kind:'artifact',documentId:item.documentId,artifactId:'synthetic-artifact',artifactKind:'slides',revision:0,contentSha256:'a'.repeat(64)}}],
          episodes:[{episodeId:null,observations:[{sourceIndex:0,kind:'viewer-open'}],firstRecordedAt:recordedAt,lastRecordedAt:recordedAt,validUntil:until,independentEvidence:false}],
          coverage:{eligibleSourceCount:1,observationCount:1,unavailableArtifactSourceCount:0,unavailableBlockSourceCount:0,completeHistory:false,bounded:true,truncated:false},attention:'not-measured',comprehension:'not-measured',inferredPreferences:false};
      }
      if(body.consumptionEpisodes){const p=body.consumptionEpisodes;p.sources.push({eventId:'synthetic-page-visit',type:'DocumentViewVisited',recordedAt,validUntil:until,target:{kind:'page',documentId:item.documentId,view:'editor'}});p.episodes.push({episodeId:null,observations:[{sourceIndex:1,kind:'visit'}],firstRecordedAt:recordedAt,lastRecordedAt:recordedAt,validUntil:until,independentEvidence:false});p.sources.push({eventId:'synthetic-block-inspection',type:'BlockInspected',recordedAt,validUntil:until,target:{kind:'block',documentId:item.documentId,blockId:'private-block',revision:3,stateSha256:'b'.repeat(64)}});
        p.episodes.push({episodeId:null,observations:[{sourceIndex:2,kind:'inspector-open'}],firstRecordedAt:recordedAt,lastRecordedAt:recordedAt,validUntil:until,independentEvidence:false});p.coverage.eligibleSourceCount=3;p.coverage.observationCount=3;}
      return route.fulfill({json:body});
    }

    if(url.pathname==='/api/memory/derivation/settings'&&url.search==='?projectId=project-atmosphere&documentId=doc-atmosphere')return route.fulfill({json:purposes});
    if(url.pathname==='/api/memory/derivation/results'){
      const checkedAt=new Date().toISOString(),diagnostics=url.searchParams.get('diagnostics')==='1';
      return route.fulfill({json:{...reviewList,checkedAt,...(diagnostics?{diagnostics:'memory-derivation-health-v1',progress:[{
        purpose:'rolling-summary',pending:4,completed:2,retained:1,uncertain:1,registeredThrough:20,completedThrough:10,
        health:{version:'memory-derivation-health-v1',ready:1,deferred:1,leased:1,recovery:0,expired:1,oldestPendingAt:new Date(Date.parse(checkedAt)-600000).toISOString(),
          lastCompletedAt:checkedAt,lastRetainedAt:checkedAt,completionLatencySeconds:{samples:2,total:9,maximum:7}}
      }]}:{}),...(url.searchParams.has('latest')?{latest:true}:{}),...(url.searchParams.has('purpose')?{purpose:url.searchParams.get('purpose')}:{})}});
    }
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
  await expect(section.getByText(message(locale,'purposeNotLoaded'),{exact:true})).toBeVisible();expect(calls.filter(c=>!c.automatic&&c.path.includes('/derivation/'))).toHaveLength(0);
  await section.getByRole('button',{name:message(locale,'purposeLoad'),exact:true}).click();
  await expect(section.getByText(message(locale,'purposeInactive'),{exact:true})).toBeVisible();
  await expect(section.locator('[data-memory-financial]')).toBeVisible();
  await expect(section.getByText(message(locale,'purposeFinanceRetention'),{exact:true})).toBeVisible();
  await expect(section.getByRole('button',{name:message(locale,'purposeEnable'),exact:true})).toBeDisabled();
  await section.getByRole('button',{name:message(locale,'reviewLatest.rolling-summary'),exact:true}).click();
  await expect(section.locator('[data-memory-derived-content]')).toContainText('Synthetic private proposal');
  expect(calls.some(call=>new URLSearchParams(call.query).get('purpose')==='rolling-summary'&&new URLSearchParams(call.query).get('latest')==='1')).toBe(true);
  const health=section.locator('[data-memory-processing-health]');await expect(health).toBeVisible();
  await health.locator(':scope > summary').click();await expect(health.getByText(message(locale,'reviewHealthScope'),{exact:true})).toBeVisible();
  await health.scrollIntoViewIfNeeded();await captureViewport(page,info,'memory-processing-health-'+locale,{assertStable:false});
  expect(await health.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await health.locator('time').scrollIntoViewIfNeeded();await expect(health.locator('time')).toBeInViewport();
  await captureViewport(page,info,'memory-processing-health-end-'+locale,{assertStable:false});
  await health.locator(':scope > summary').click();
  for(const field of ['charge','background','consent'])await expect(section.locator('[name="memory-purpose-'+field+'"]')).not.toBeChecked();
  expect(calls.filter(c=>!c.automatic&&c.path.includes('/derivation/'))).toHaveLength(3);expect(errors).toEqual([]);
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
  reviewResult.candidate.version='memory-derivation-candidates-v2';Object.assign(reviewResult.candidate.items[0],{supports:[],observationSupports:[0],observationCounterevidence:[],observationCitations:[{observationIndex:0,action:'inspect',recordedAt:new Date(Date.now()-1000).toISOString(),role:'support'}]});
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
  expect(calls.filter(c=>!c.automatic&&c.path.includes('/derivation/'))).toHaveLength(5);expect(calls.every(c=>c.method==='GET')).toBe(true);
  await expect(review.getByText(message(locale,'reviewExportHelp'),{exact:true})).toBeVisible();
  const exported=page.waitForEvent('download');
  await review.getByRole('button',{name:message(locale,'reviewExport'),exact:true}).click();
  const download=await exported;expect(download.suggestedFilename()).toBe('forma-memory-result.json');
  const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
  const snapshot=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(snapshot.result.items[0].observedActions[0].action).toBe('inspect');
  expect(snapshot.result.items[0].originalQuotes.supports).toEqual([]);
  expect(snapshot.downloadedCopyRevocable).toBe(false);expect(snapshot.accessAuthority).toBe(false);
  expect(snapshot.completeHistory).toBe(false);expect(snapshot.result.items[0].text).toContain('<script>not code</script>');
  expect(calls.filter(c=>!c.automatic&&c.path.includes('/derivation/'))).toHaveLength(6);
  await expect(section.getByText(message(locale,'reviewExportRequested'),{exact:true})).toBeVisible();
  await review.locator('[data-memory-derived-export]').scrollIntoViewIfNeeded();
  await captureViewport(page,info,'memory-result-export-'+locale,{assertStable:false});
  const actionEvidence=review.locator('[data-memory-observation-evidence]');await actionEvidence.locator('summary').click();
  await expect(actionEvidence).toContainText(message(locale,'behavioralDisclosure'));await expect(actionEvidence).toContainText(message(locale,'behavioralAction.inspect'));
  await expect(actionEvidence.locator('blockquote')).toHaveCount(0);await actionEvidence.scrollIntoViewIfNeeded();
  await captureViewport(page,info,'memory-behavioral-review-'+locale,{assertStable:false});
  const observedAction=actionEvidence.locator('li').first();await observedAction.scrollIntoViewIfNeeded();await expect(observedAction).toBeInViewport();
  await captureViewport(page,info,'memory-behavioral-action-'+locale,{assertStable:false});
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
  await expect(visits.getByText(message(locale,'visitsBlockOpened'),{exact:true})).toBeVisible();
  expect(calls.filter(call=>call.query.includes('consumptionEpisodes=memory-consumption-episodes-v6'))).toHaveLength(1);
  expect(calls.every(call=>call.method==='GET')).toBe(true);expect(errors).toEqual([]);
  await captureViewport(page,info,'memory-historical-views-'+locale,{assertStable:false});
  const blockOpened=visits.getByText(message(locale,'visitsBlockOpened'),{exact:true});await blockOpened.scrollIntoViewIfNeeded();await expect(blockOpened).toBeInViewport();
  await captureViewport(page,info,'memory-block-views-'+locale,{assertStable:false});
  const windows=visits.locator('[data-memory-consumption-windows]');await windows.locator(':scope > summary').click();
  await expect(windows.locator('[data-memory-consumption-window]')).toHaveCount(4);const counts=windows.locator('[data-memory-consumption-window="7"]');await counts.scrollIntoViewIfNeeded();await expect(counts).toBeInViewport();
  const pageCounts=counts.locator('[data-memory-page-counts]');await expect(pageCounts).toContainText(message(locale,'visitsPage.editor'));await pageCounts.scrollIntoViewIfNeeded();await expect(pageCounts).toBeInViewport();
  await captureViewport(page,info,'memory-consumption-windows-'+locale,{assertStable:false});
  // A real inspector control clears private content BEFORE its response settles.
  let settleWithdrawal;
  await context.route('**/api/memory/derivation/result?*',async route=>{
    if(route.request().method()!=='DELETE')return route.fallback();
    calls.push({method:'DELETE',path:'/api/memory/derivation/result',query:new URL(route.request().url()).search,automatic:false});
    expect(route.request().postDataJSON()).toEqual({version:purposes.version,confirmation:'WITHDRAW_DERIVED_RESULT'});
    await new Promise(resolve=>{settleWithdrawal=resolve;});
    return route.fulfill(locale==='ar'?{status:503,json:{error:'synthetic_unknown'}}:{json:{version:purposes.version,jobId:entry.jobId,state:'withdrawn'}});
  });
  await section.getByRole('button',{name:message(locale,'purposeLoad'),exact:true}).click();
  await section.getByRole('button',{name:message(locale,'reviewLatest.rolling-summary'),exact:true}).click();
  await expect(section.locator('[data-memory-derived-content]')).toContainText('Synthetic private proposal');
  await section.getByRole('button',{name:message(locale,'reviewWithdraw'),exact:true}).click();
  await expect.poll(()=>typeof settleWithdrawal).toBe('function');
  await expect(section.locator('[data-memory-derived-content]')).toHaveCount(0);
  settleWithdrawal();
  await expect(section.getByText(message(locale,locale==='ar'?'purposeUnknown':'reviewChanged'),{exact:true})).toBeVisible();
  await expect(section.locator('[data-memory-derived-content]')).toHaveCount(0);
  expect(calls.filter(call=>call.method!=='GET')).toHaveLength(1);expect(errors).toEqual([]);
  if(locale==='en'){
    // Separate same-origin browser tab, identifier-free native BroadcastChannel.
    await section.getByRole('button',{name:message(locale,'purposeLoad'),exact:true}).click();
    await section.getByRole('button',{name:message(locale,'reviewLatest.rolling-summary'),exact:true}).click();
    await expect(section.locator('[data-memory-derived-content]')).toContainText('Synthetic private proposal');
    await context.route(origin+'/memory-privacy-peer-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated privacy peer</title>'}));
    const peer=await context.newPage();await peer.goto(origin+'/memory-privacy-peer-fixture');await page.bringToFront();
    await peer.evaluate(()=>{window.memoryPeer=new BroadcastChannel('forma-memory-privacy-v1');window.memoryPeer.postMessage({version:1,operation:'12345678-1234-1234-1234-123456789abc',phase:'begin'});});
    await expect(panel).not.toContainText('Synthetic private proposal');await expect(panel.locator(':scope > p[role="status"]')).toBeVisible();await expect(panel.locator('.personal-memory-card')).toBeHidden();
    await peer.evaluate(()=>window.memoryPeer.postMessage({version:1,operation:'12345678-1234-1234-1234-123456789abc',phase:'end'}));
    await expect(panel.locator(':scope > p[role="status"]')).toBeHidden();await expect(panel.locator('.personal-memory-card')).toBeVisible();
    await expect(panel).not.toContainText('Synthetic private proposal');await peer.close();
    expect(calls.filter(call=>call.method!=='GET')).toHaveLength(1);expect(errors).toEqual([]);
  }
  await info.attach('declared-memory-transport',{body:JSON.stringify({syntheticOnly:true,production:false,providerCalls:0,mutations:1,calls,session:JSON.parse(syntheticReadBody('/api/session')).user.userId},null,2),contentType:'application/json'});
});

});

for(const purpose of ['rolling-summary','profile'])for(const behavioral of [false,true])for(const locale of ['en','ar'])test.describe('Automatic document memory '+purpose+' '+locale+(behavioral?' behavioral':'' ),()=>{
  test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
  test('current read-only brief, evidence and visibility withdrawal',async({page,context,baseURL},info)=>{
    expect(syntheticNetworkEnabled(baseURL)).toBe(true);
    const version='memory-derivation-control-v1',parent='a'.repeat(64),lineage='b'.repeat(64),jobId='c'.repeat(64);
    const expiresAt=new Date(Date.now()+86400000).toISOString(),scope={projectId:'project-atmosphere',documentId:'doc-atmosphere',custody:{kind:'personal'}};
    const enrollment={id:parent,projectId:scope.projectId,documentId:scope.documentId,organizationId:null,revision:1,learn:true,recall:true,background:true,
      retentionDays:30,timeZone:'UTC',expiresAt,policyVersion:'personal-memory-v2',lastAdmittedAt:null,throughSequence:24,cutoffSequence:null,backlog:false,nextDueAt:new Date().toISOString(),attempts:0,status:'ready'};
    const base={enabled:true,policyVersion:'personal-memory-v2',writeContractVersion:'memory-settings-custody-v1',reviewContract:{timing:'daily-with-daytime-catch-up',preferredLocalWindow:{startHour:1,endHour:5},freshDaytimeCatchUpAllowed:true,savedPagesMayContinueOutsideWindow:true,strictlyOvernight:false,deliverySlaVerified:false},enrollments:[enrollment],nextAfter:null};
    const grant={scope,grantId:'d'.repeat(64),revision:1,consentId:'11111111-1111-4111-8111-111111111111',purpose,enrollmentId:parent,enrollmentRevision:1,
      qualificationId:'synthetic-qualified',termsSha256:'e'.repeat(64),monthlyCapMicroUsd:100000,sourceAfterSequence:1,background:true,retentionDays:30,
      consentedAt:new Date(Date.now()-1000).toISOString(),expiresAt,revokedAt:null};
    const terms={version:'memory-derivation-terms-v1',purpose,recipeVersion:purpose==='profile'&&!behavioral?'memory-profile-consolidation-v1':behavioral?'memory-derivation-candidates-v2':'memory-derivation-candidates-v1',provider:'openai',model:'isolated-test-model',pricing:{inputMicroUsdPerMillion:1000000,cachedInputMicroUsdPerMillion:0,outputMicroUsdPerMillion:2000000},maximumInputTokens:1000,maximumOutputTokens:100,monthlyCapMicroUsd:100000,payer:'self-ai-allowance',providerStore:false,providerRetentionDisclosure:'Synthetic browser fixture only.',retentionPolicyId:'fixture-policy',evidence:Object.fromEntries(DERIVATION_EVIDENCE.map(key=>[key,'f'.repeat(64)]))};
    grant.termsSha256=createHash('sha256').update(derivationCanonical(terms)).digest('hex');
    const offer={qualificationId:grant.qualificationId,termsSha256:grant.termsSha256,expiresAt,terms};
    const settings={version,enabled:true,available:true,reason:null,policyVersion:'personal-memory-derivation-v1',scope,enrollmentId:parent,enrollmentRevision:1,
      grants:[grant],qualifications:[offer],capScope:'payer-utc-calendar-month-all-memory-purposes',sourceWindow:behavioral?'qualified-recipe':'future-originals',processingImplemented:false};
    const calls=[],errors=[],contextWrites=[];page.on('pageerror',error=>errors.push(error.message));let denied=false;
    const extendedProfile=purpose==='profile'&&!behavioral;
    const historyJobs=[jobId,...Array.from({length:extendedProfile?19:1},(_,index)=>createHash('sha256').update('older-profile-'+index).digest('hex'))];
    await context.route('**/api/memory/**',async route=>{
      const request=route.request(),url=new URL(request.url());calls.push({path:url.pathname,method:request.method()});
      expect(url.origin).toBe(new URL(baseURL).origin);
      if(url.pathname==='/api/memory/assistant-context'){
        if(request.method()==='GET'){expect(url.searchParams.get('controls')).toBe('1');return route.fulfill({json:{version:'memory-assistant-context-v1',targetEnrollmentId:parent,targetRevision:1,validUntil:new Date(Date.now()+25000).toISOString(),context:null,presentation:null}});}
        expect(request.method()).toBe('PUT');const body=request.postDataJSON();contextWrites.push(body);
        expect(body).toEqual({jobId,revision:null,targetEnrollmentId:parent,targetRevision:1,confirmation:'ACCEPT_ASSISTANT_CONTEXT'});
        return route.fulfill({json:{version:'memory-assistant-context-v1',saved:true,refreshRequired:true}});
      }
      expect(request.method()).toBe('GET');
      expect(request.headers()['x-forma-memory-consumer']).toBe('document-brief-v1');
      const validUntil=new Date(Date.now()+45000).toISOString();
      if(url.pathname==='/api/memory/recall-boundary')return route.fulfill({json:{version:'memory-scope-recall-v1',enrollmentId:parent,enrollmentRevision:1,boundary:'partition',revision:'11111111-1111-4111-8111-111111111111',validUntil:new Date(Date.now()+25000).toISOString()}});
      if(url.pathname==='/api/memory/settings')return route.fulfill({json:base});
      if(url.pathname.endsWith('/derivation/settings'))return route.fulfill({json:settings});
      if(url.pathname.endsWith('/results')){
        const latest=url.searchParams.has('latest'),after=url.searchParams.get('after'),offset=after?historyJobs.indexOf(after)+1:0;
        const selected=latest?[jobId]:historyJobs.slice(offset,offset+8);
        return route.fulfill({json:{version,scope,enrollmentId:parent,enrollmentRevision:1,purpose,...(latest?{latest:true}:{}),
          checkedAt:new Date().toISOString(),progress:[],results:selected.map(jobId=>({jobId,purpose,scopeKey:'synthetic-scope',expiresAt})),next:!latest&&offset+8<historyJobs.length?selected.at(-1):null}});
      }
      if(url.pathname.endsWith('/result')){
        const selectedJob=url.searchParams.get('jobId'),historical=selectedJob!==jobId,consolidating=extendedProfile&&!historical,claimJob=consolidating?createHash('sha256').update('new-profile-claim').digest('hex'):purpose==='profile'?jobId:selectedJob;
        if(denied)return route.fulfill({status:404,json:{error:'memory_result_unavailable'}});
        expect(url.searchParams.get('resources')).toBe('1');
        return route.fulfill({json:{version,jobId:selectedJob,expiresAt,resourceEvidence:{version:'memory-evidence-resources-v1',complete:false,claims:[{claimKey:'derived:'+claimJob,citations:[...[0,1].map(index=>({source:'original',index,resource:{zoom:'document',scopeKey:'synthetic-scope'}})),...(behavioral?[{source:'observation',index:0,resource:{zoom:'page',scopeKey:'synthetic-page',view:'document'}}]:[])]}]},controlRevisions:{[lineage]:0},history:{windowCount:3,originalPairs:6,boundary:'bounded',afterSequence:1,throughSequence:24},
          candidate:{version:consolidating?'memory-profile-consolidation-v1':behavioral?'memory-derivation-candidates-v2':'memory-derivation-candidates-v1',purpose,scopeKey:'synthetic-scope',manifestId:selectedJob,manifestRevision:1,validUntil,
            semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,items:[{operation:'assert',target:null,category:purpose==='profile'?'workflow-hypothesis':'proposal',
              text:historical?'Historical private profile hypothesis.'+(extendedProfile?' '+historyJobs.indexOf(selectedJob):''):'Synthetic private brief <script>not code</script>.',...(behavioral?{observationSupports:[0],observationCounterevidence:[],observationCitations:[{observationIndex:0,action:'inspect',recordedAt:new Date(Date.now()-1000).toISOString(),role:'support'}]}:{}),supports:[{sourceIndex:0,start:0,end:8,text:'Original'}],counterevidence:[{sourceIndex:1,start:0,end:7,text:'Opposed'}],
              ...(consolidating?{reconciles:[{relationship:'revises',claimKey:'derived:'+jobId,category:'workflow-hypothesis',supports:[{sourceIndex:1,start:0,end:7,text:'Opposed'}]}]}:{}),claimKey:'derived:'+claimJob,lineageIds:[lineage],sourceBindings:[{sourceId:'synthetic-original',revision:1,contentHash:'f'.repeat(64)}],validUntil,citationStatus:'conflicting-citations'}]}}});
      }
      if(url.pathname.endsWith('/controls'))return route.fulfill({json:{version,available:true,scope,enrollmentId:parent,enrollmentRevision:1,validUntil,controls:[],next:null}});
      if(url.pathname==='/api/memory/recall-scopes'){
        const sources=purpose==='profile'&&!behavioral?[
          {enrollmentId:'1'.repeat(64),projectId:scope.projectId,documentId:'project-context',zoom:'project',distance:0,weight:.7},
          {enrollmentId:'2'.repeat(64),projectId:'related-project',documentId:'tree-context',zoom:'project-tree',distance:2,weight:.5/3},
          {enrollmentId:'3'.repeat(64),projectId:'distant-project',documentId:'broader-context',zoom:'partition',distance:0,weight:.01}]:[];
        const until=new Date(Date.now()+25000).toISOString(),id=url.searchParams.get('source');
        if(!id)return route.fulfill({json:{version:'memory-scope-recall-v1',sources,complete:true,validUntil:until}});
        if(url.searchParams.get('purpose')!=='profile')return route.fulfill({status:404,json:{error:'no_result'}});
        const source=sources.find(row=>row.enrollmentId===id);expect(source).toBeTruthy();
        return route.fulfill({json:{version:'memory-scope-recall-v1',source,validUntil:until,independentEvidence:false,completeHistory:false,presentationOnly:true,
          presentation:{jobId:id,expiresAt,candidate:{version:'memory-derivation-candidates-v1',purpose:'profile',scopeKey:source.zoom+'-scope',manifestId:id,manifestRevision:1,validUntil,
            semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,items:[{operation:'assert',target:null,category:'preference-hypothesis',text:'Private '+source.zoom+' profile context',
              supports:[{sourceIndex:0,start:0,end:8,text:'Original'}],counterevidence:[],claimKey:'derived:'+id,lineageIds:[lineage],sourceBindings:[{sourceId:'original-'+source.zoom,revision:1,contentHash:'f'.repeat(64)}],validUntil,citationStatus:'support-cited'}]}}}});
      }
      throw Error('Undeclared automatic Memory route '+url.pathname+url.search);
    });
    await page.goto(path);const brief=page.locator('[data-memory-document-brief]');
    await expect(brief).toBeVisible();await expect(brief).toContainText('Synthetic private brief <script>not code</script>.');
    await expect(brief.locator('script')).toHaveCount(0);await expect(brief).toContainText(message(locale,'briefConflict'));
    await brief.getByText(message(locale,behavioral?'behavioralEvidence':'briefEvidence'),{exact:true}).first().click();await expect(brief.getByText('Original',{exact:true}).first()).toBeVisible();
    await expect(brief.locator('details[open]').getByText('Opposed',{exact:true}).first()).toBeVisible();
    await expect(brief).not.toContainText('memory.live.');
    await expect(brief.locator('[data-memory-evidence-resources]').first()).toContainText(message(locale,'resourceEvidenceDocument'));
    if(behavioral)await expect(brief.locator('[data-memory-evidence-resources]').first()).toContainText(message(locale,'resourceEvidencePage').replace('{view}',message(locale,'visitsPage.document')));
    if(behavioral){await expect(brief).toContainText(message(locale,'behavioralDisclosure'));await expect(brief).toContainText(message(locale,'behavioralAction.inspect'));}
    expect(await brief.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await captureViewport(page,info,'automatic-document-memory-'+purpose+'-'+locale+(behavioral?'-behavioral':''),{assertStable:false});
    if(purpose==='profile'&&!behavioral){
      for(const zoom of ['project','project-tree','partition'])await expect(brief).toContainText('Private '+zoom+' profile context');
      const broad=brief.getByText('Private partition profile context',{exact:true});await broad.scrollIntoViewIfNeeded();await expect(broad).toBeInViewport();
      await expect(brief).toContainText(message(locale,'briefSourceWeight').replace('{weight}','0.01'));
      await captureViewport(page,info,'automatic-document-memory-scopes-'+locale,{assertStable:false});
    }
    if(purpose==='profile'){await expect(brief).toContainText('Historical private profile hypothesis.');await expect(brief).toContainText(message(locale,'profileHistorical'));await expect(brief).toContainText(message(locale,'profileSharedEvidence'));await expect(brief).toContainText(message(locale,'profileCitedConflict'));await expect(brief).toContainText(message(locale,'profileRevised'));}
    if(extendedProfile){
      const relation=brief.locator('details').filter({has:page.getByText(message(locale,'profileRelationHeading'),{exact:true})});
      await relation.locator('summary').click();await expect(relation).toContainText(message(locale,'profileRelationDetail'));await expect(relation).toContainText('Opposed');
      await expect(brief).toContainText(message(locale,'profileRelationLinked'));await relation.scrollIntoViewIfNeeded();
      expect(await relation.evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);await page.screenshot({path:'.wrangler/memory-profile-consolidation-'+locale+'.png'});
      const older=brief.getByRole('button',{name:message(locale,'profileOlder'),exact:true});await older.scrollIntoViewIfNeeded();await older.focus();await page.keyboard.press('Enter');
      await expect(brief).toContainText(message(locale,'profileHistoryPage'));
      await expect(brief).toContainText('Historical private profile hypothesis. 19');
      await expect(brief).not.toContainText('Historical private profile hypothesis. 15');
      await expect(brief.getByRole('button',{name:message(locale,'profileOlder'),exact:true})).toHaveCount(0);
      await expect(brief.getByRole('button',{name:message(locale,'briefRefresh'),exact:true})).toBeFocused();
      const pageDisclosure=brief.locator('.memory-brief-disclosure').filter({hasText:message(locale,'profileHistoryPage')});
      await pageDisclosure.scrollIntoViewIfNeeded();await expect(pageDisclosure).toBeInViewport();
      await captureViewport(page,info,'older-profile-page-'+locale,{assertStable:false});
      await brief.getByText('Historical private profile hypothesis. 19',{exact:true}).scrollIntoViewIfNeeded();
      await captureViewport(page,info,'older-profile-page-end-'+locale,{assertStable:false});
    }
    if(behavioral){await brief.getByRole('button',{name:message(locale,'assistantContextAccept'),exact:true}).first().click();await expect(brief.getByRole('status')).toHaveText(message(locale,'assistantContextSaved'));expect(contextWrites).toHaveLength(1);}
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(brief).toHaveCount(0);
    denied=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect.poll(()=>calls.filter(call=>call.path.endsWith('/result')).length).toBe(extendedProfile?22:purpose==='profile'?3:2);
    await expect(brief).toHaveCount(0);expect(calls.filter(call=>call.method!=='GET')).toHaveLength(behavioral?1:0);expect(errors).toEqual([]);
  });
});

for(const locale of ['en','ar'])test.describe('Native block inspection '+locale,()=>{
  test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
  test('Document controls publish only an exact synthetic opening receipt',async({page,context,baseURL},info)=>{
    expect(syntheticNetworkEnabled(baseURL)).toBe(true);const seen=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/api/memory/settings',async route=>{expect(route.request().method()).toBe('GET');return route.fulfill({json:{enabled:false,enrollments:[],nextAfter:null}});});
    await context.route('**/api/events/hot',async route=>{
      const request=route.request(),body=request.postDataJSON();if(body?.event?.type!=='BlockInspected')return route.fallback();
      expect(new URL(request.url()).origin).toBe(new URL(baseURL).origin);expect(request.method()).toBe('POST');
      seen.push(body);return route.fulfill({json:{appended:[],rejected:[],head:0,noAutomaticRetry:true}});
    });
    await page.goto(path);const owner=page.locator('forma-workspace');await expect(owner).toBeVisible();
    await expect.poll(()=>owner.evaluate(host=>typeof host.store?.patchUi)).toBe('function');
    await owner.evaluate(host=>{host.store.patchUi({instrumentation:true});});
    const block=owner.locator('forma-context-block:has(article[data-block-id="block-direction"])');await expect(block).toHaveCount(1);
    expect(seen).toHaveLength(0);await block.locator('.context-decision-select > input[type="radio"]').check();expect(seen).toHaveLength(0);
    await block.locator('.context-controls-toggle').click();await expect(block.locator('.context-controls-panel')).toBeVisible();
    await expect.poll(()=>seen.length).toBe(1);expect(seen[0].event.payload).toMatchObject({block_id:'block-direction',document_id:'doc-atmosphere',project_id:'project-atmosphere',source_surface:'document-context-controls'});
    expect(seen[0].event.payload.source_event_ids.length).toBeGreaterThan(0);expect(JSON.stringify(seen)).not.toContain('quiet interior');
    await captureViewport(page,info,'native-block-inspection-'+locale,{assertStable:false});
    await block.locator('.context-controls-toggle').click();await expect(block.locator('.context-controls-toggle')).toHaveAttribute('aria-expanded','false');expect(seen).toHaveLength(1);expect(errors).toEqual([]);
  });
});

for(const zoom of ['project','project-tree','partition'])for(const locale of ['en','ar'])test.describe('Scope profile facet '+zoom+' '+locale,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 test('separate originals, explicit range, private expiry and correction',async({page,context,baseURL})=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);const version='memory-derivation-control-v1',parent='a'.repeat(64),jobId='c'.repeat(64),peer='d'.repeat(64),lineage='b'.repeat(64),expiresAt=new Date(Date.now()+86400000).toISOString();let corrected=false;const errors=[],writes=[];page.on('pageerror',error=>errors.push(error.message));
  const scope={projectId:'project-atmosphere',documentId:'doc-atmosphere',custody:{kind:'personal'}},source={enrollmentId:peer,projectId:zoom==='project'?scope.projectId:'other-profile-project',documentId:'other-profile-document',zoom,distance:zoom==='project-tree'?1:0,weight:zoom==='project'?.7:zoom==='project-tree'?.25:.01};
  const enrollment={id:parent,projectId:scope.projectId,documentId:scope.documentId,organizationId:null,revision:1,learn:true,recall:true,background:true,retentionDays:30,timeZone:'UTC',expiresAt,policyVersion:'personal-memory-v2',lastAdmittedAt:null,throughSequence:24,cutoffSequence:null,backlog:false,nextDueAt:new Date().toISOString(),attempts:0,status:'ready'};
  const terms={version:'memory-derivation-terms-v1',purpose:'profile',recipeVersion:'memory-derivation-candidates-v1',provider:'openai',model:'isolated-test-model',pricing:{inputMicroUsdPerMillion:1000000,cachedInputMicroUsdPerMillion:0,outputMicroUsdPerMillion:2000000},maximumInputTokens:1000,maximumOutputTokens:100,monthlyCapMicroUsd:100000,payer:'self-ai-allowance',providerStore:false,providerRetentionDisclosure:'Synthetic browser fixture only.',retentionPolicyId:'fixture-policy',evidence:Object.fromEntries(DERIVATION_EVIDENCE.map(key=>[key,'f'.repeat(64)]))};
  const termsSha256=createHash('sha256').update(derivationCanonical(terms)).digest('hex'),grant={scope,grantId:'e'.repeat(64),revision:1,consentId:'11111111-1111-4111-8111-111111111111',purpose:'profile',enrollmentId:parent,enrollmentRevision:1,qualificationId:'fixture',termsSha256,monthlyCapMicroUsd:100000,background:true,sourceAfterSequence:0,retentionDays:1,consentedAt:new Date().toISOString(),expiresAt,revokedAt:null};
  const result=(remote,validUntil)=>{const id=remote?peer:jobId,ids=remote?['peer-original']:['local-original-a','local-original-b'],supports=ids.map((_id,index)=>({sourceIndex:index,start:0,end:8,text:'Original'}));return {jobId:id,expiresAt,candidate:{version:'memory-derivation-candidates-v1',purpose:'profile',scopeKey:remote?'peer-scope':'local-scope',manifestId:id,manifestRevision:1,validUntil,semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,items:[{operation:'assert',target:null,category:'workflow-hypothesis',text:'Tentative project habit <script>not code</script>',supports,counterevidence:[],claimKey:'derived:'+id,lineageIds:[remote?peer:lineage],sourceBindings:ids.map(sourceId=>({sourceId,revision:1,contentHash:'f'.repeat(64)})),validUntil,citationStatus:'support-cited'}]}};};
  await context.route('**/api/memory/**',async route=>{const request=route.request(),url=new URL(request.url()),validUntil=new Date(Date.now()+20000).toISOString();expect(url.origin).toBe(new URL(baseURL).origin);if(request.method()!=='GET')writes.push(url.pathname);expect(request.method()).toBe('GET');
   if(url.pathname==='/api/memory/assistant-context')return route.fulfill({status:503,json:{error:'not-selected'}});
   if(url.pathname==='/api/memory/settings')return route.fulfill({json:{enabled:true,policyVersion:'personal-memory-v2',writeContractVersion:'memory-settings-custody-v1',reviewContract:{timing:'daily-with-daytime-catch-up',preferredLocalWindow:{startHour:1,endHour:5},freshDaytimeCatchUpAllowed:true,savedPagesMayContinueOutsideWindow:true,strictlyOvernight:false,deliverySlaVerified:false},enrollments:[enrollment],nextAfter:null}});
   if(url.pathname.endsWith('/derivation/settings'))return route.fulfill({json:{version,enabled:true,available:true,reason:null,policyVersion:'personal-memory-derivation-v1',scope,enrollmentId:parent,enrollmentRevision:1,grants:[grant],qualifications:[{qualificationId:'fixture',termsSha256,expiresAt,terms}],capScope:'payer-utc-calendar-month-all-memory-purposes',sourceWindow:'future-originals',processingImplemented:false}});
   if(url.pathname.endsWith('/results'))return route.fulfill({json:{version,scope,enrollmentId:parent,enrollmentRevision:1,purpose:'profile',...(url.searchParams.has('latest')?{latest:true}:{}),checkedAt:new Date().toISOString(),progress:[],results:corrected?[]:[{jobId,purpose:'profile',scopeKey:'local-scope',expiresAt}],next:null}});
   if(url.pathname.endsWith('/result')){const value=result(false,validUntil);return route.fulfill({json:{version,...value,controlRevisions:{[lineage]:0},resourceEvidence:{version:'memory-evidence-resources-v1',complete:false,claims:[{claimKey:'derived:'+jobId,citations:[0,1].map(index=>({source:'original',index,resource:{zoom:'document',scopeKey:'local-scope'}}))}]}}});}
   if(url.pathname.endsWith('/controls'))return route.fulfill({json:{version,available:true,scope,enrollmentId:parent,enrollmentRevision:1,validUntil,next:null,controls:corrected?[{controlId:'f'.repeat(64),claimKey:'derived:'+jobId,lineageId:lineage,revision:1,action:'corrected',correctionText:'Only for this document.',expiresAt,purpose:'profile',textAvailable:true}]:[]}});
   if(url.pathname==='/api/memory/recall-boundary')return route.fulfill({json:{version:'memory-scope-recall-v1',enrollmentId:parent,enrollmentRevision:1,boundary:zoom,revision:'11111111-1111-4111-8111-111111111111',validUntil}});
   if(url.pathname==='/api/memory/recall-scopes'){
    if(!url.searchParams.has('source'))return route.fulfill({json:{version:'memory-scope-recall-v1',sources:[source],complete:true,validUntil}});
    if(url.searchParams.get('purpose')!=='profile')return route.fulfill({status:404,json:{error:'not-qualified'}});
    return route.fulfill({json:{version:'memory-scope-recall-v1',source,validUntil,independentEvidence:false,completeHistory:false,presentationOnly:true,presentation:result(true,validUntil)}});
   }throw Error('Undeclared profile facet route');
  });
  await page.goto(path);const brief=page.locator('[data-memory-document-brief]'),facets=brief.locator('[data-memory-scope-profile-facets]');await expect(facets).toBeVisible();
  await facets.locator(':scope > summary').click();await expect(facets).toContainText(message(locale,'profileFacetHelp'));await expect(facets).toContainText(message(locale,'recallBoundary.'+zoom));await expect(facets).toContainText(message(locale,'profileFacetSupport').replace('{originals}','3').replace('{documents}','2'));
  await facets.getByText(message(locale,'briefEvidence'),{exact:true}).click();await expect(facets.getByText('Original',{exact:true})).toHaveCount(3);await expect(facets.locator('script')).toHaveCount(0);
  await facets.scrollIntoViewIfNeeded();expect(await brief.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);await page.screenshot({path:'.wrangler/memory-scope-profile-'+zoom+'-'+locale+'.png'});
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(brief).toHaveCount(0);corrected=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(brief).toContainText('Only for this document.');await expect(facets).toHaveCount(0);expect(writes).toEqual([]);expect(errors).toEqual([]);
 });
});

for(const locale of ['en','ar'])test.describe('Unified current profile '+locale,()=>{
 test.use({geometry:{viewport:{width:locale==='ar'?320:1280,height:900},zoom:1,locale}});
 test('actor-private current head, literal evidence and privacy reset',async({page,context,baseURL},info)=>{
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);const {memoryProfileMessages}=await import('../../src/components/design-system/locales/memory-profile-messages.ts'),c=memoryProfileMessages[locale],calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));let retired=false;
  const now=new Date().toISOString(),expiresAt=new Date(Date.now()+60000).toISOString(),jobId='1'.repeat(64),lineage='2'.repeat(64),scopeKey='synthetic-profile-scope';
  const metadata={enrollment_id:'a'.repeat(64),enrollment_revision:1,owner_user_id:'e6-network-synthetic-principal',organization_id:null,project_access_id:null,project_id:'project-atmosphere',document_id:'doc-atmosphere',job_id:jobId,through_sequence:24,state:'active',published_at:now,expires_at:expiresAt};
  await context.route('**/api/memory/**',async route=>{
   const request=route.request(),url=new URL(request.url());calls.push(url.pathname);expect(request.method()).toBe('GET');const validUntil=new Date(Date.now()+25000).toISOString();
   if(url.pathname==='/api/memory/profile-catalog'){const row={...metadata,state:retired?'withdrawn':'active'};return route.fulfill({json:{version:'memory-profile-catalog-v1',controlMetadataOnly:true,sourceContentRead:false,automaticallyDerived:true,completeProfile:false,pageRevision:createHash('sha256').update(derivationCanonical([row])).digest('hex'),validUntil,entries:[{...row,scope_key:scopeKey}],nextAfter:null}});}
   if(url.pathname==='/api/memory/scope-profile')return route.fulfill({json:{version:'memory-scope-profile-v1',publication:null,targetEnrollmentId:metadata.enrollment_id,targetRevision:1,validUntil,sourceJobs:[jobId,'e'.repeat(64)],complete:false,independentEvidence:false,automaticProjection:true,facets:[{scope:'project',projectId:metadata.project_id,text:'PRIVATE_SCOPE_PATTERN <script>literal</script>',category:'workflow-hypothesis',authority:'tentative',independentEvidence:false,completeHistory:false,originalCount:3,documentCount:2,projectCount:1,support:[{projectId:metadata.project_id,documentId:metadata.document_id,jobId,claimKey:'derived:'+'a'.repeat(64),quotes:[{sourceIndex:0,start:0,end:8,text:'Original'}]},{projectId:metadata.project_id,documentId:'peer-document',jobId:'e'.repeat(64),claimKey:'derived:'+'b'.repeat(64),quotes:[{sourceIndex:0,start:0,end:8,text:'Distinct'}]}]}]}});
   if(url.pathname==='/api/memory/derivation/controls')return route.fulfill({json:{version:'memory-derivation-control-v1',available:true,controls:[],next:null,scope:{projectId:metadata.project_id,documentId:metadata.document_id,custody:{kind:'personal'}},enrollmentId:metadata.enrollment_id,enrollmentRevision:1,validUntil}});
   if(url.pathname==='/api/memory/derivation/result'){
    expect(url.searchParams.get('profileCurrent')).toBe('1');expect(url.searchParams.get('jobId')).toBe(jobId);
    return route.fulfill({json:{version:'memory-derivation-control-v1',profileCurrent:true,jobId,expiresAt,controlRevisions:{[lineage]:0},candidate:{version:'memory-derivation-candidates-v1',purpose:'profile',scopeKey,manifestId:jobId,manifestRevision:1,validUntil,semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,items:[{operation:'assert',target:null,category:'preference-hypothesis',text:'PRIVATE_PROFILE <script>literal</script>',supports:[{sourceIndex:0,start:0,end:8,text:'Original'}],counterevidence:[],claimKey:'claim',lineageIds:[lineage],sourceBindings:[{sourceId:'original',revision:1,contentHash:'4'.repeat(64)}],validUntil,citationStatus:'support-cited'}]}}});
   }
   return route.fulfill({status:503,json:{error:'synthetic_unavailable'}});
  });
  await page.goto(path);await expect(page.locator('forma-workspace')).toBeVisible();const owner=page.locator('.application-creative > forma-creative-assistant');await owner.locator('button.forma-assistant-launcher').click();const memory=owner.locator('[data-assistant-memory]');await memory.locator(':scope > summary').click();const profile=memory.locator('forma-memory-profile-review');await expect(profile).toBeVisible();expect(calls).not.toContain('/api/memory/profile-catalog');
  await profile.getByRole('button',{name:c.refresh,exact:true}).click();await expect(profile.getByRole('button',{name:c.inspect,exact:true})).toBeEnabled();expect(calls).not.toContain('/api/memory/derivation/result');
  await profile.getByRole('button',{name:c.inspect,exact:true}).click();await expect(profile).toContainText('PRIVATE_PROFILE <script>literal</script>');await expect(profile.locator('script')).toHaveCount(0);await profile.locator('details > summary').click();await expect(profile.locator('blockquote')).toHaveText('Original');await profile.scrollIntoViewIfNeeded();expect(await profile.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await captureViewport(page,info,'unified-profile-'+locale,{assertStable:false});
  const profileCalls=()=>calls.filter(path=>['/api/memory/profile-catalog','/api/memory/derivation/controls','/api/memory/derivation/result'].includes(path)).length;const before=profileCalls();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(profile).not.toContainText('PRIVATE_PROFILE');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect(profileCalls()).toBe(before);await expect(profile).not.toContainText('PRIVATE_PROFILE');
  await profile.getByRole('button',{name:c.refresh,exact:true}).click();await profile.getByRole('button',{name:c.broader,exact:true}).click();await expect(profile.locator('[data-memory-unified-scope-profile]')).toContainText('PRIVATE_SCOPE_PATTERN <script>literal</script>');await expect(profile.locator('script')).toHaveCount(0);await profile.locator('details > summary').click();await expect(profile.locator('blockquote')).toHaveCount(2);await profile.scrollIntoViewIfNeeded();expect(await profile.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await captureViewport(page,info,'unified-scope-profile-'+locale,{assertStable:false});
  const scopeCalls=calls.filter(p=>p==='/api/memory/scope-profile').length;await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(profile).not.toContainText('PRIVATE_SCOPE_PATTERN');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect(calls.filter(p=>p==='/api/memory/scope-profile').length).toBe(scopeCalls);await expect(profile).not.toContainText('PRIVATE_SCOPE_PATTERN');
  retired=true;await profile.getByRole('button',{name:c.refresh,exact:true}).click();await expect(profile.getByRole('button',{name:c.inspect,exact:true})).toBeDisabled();await expect(profile).toContainText(c.retired);expect(errors).toEqual([]);
 });
});
