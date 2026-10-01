import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {actionContextFixture,mountActionContextFixture,toolbarReady,choosePaletteAction,chooseDockAction} from './helpers/still-action-context.mjs';

// The native dialog is in shadow DOM; its authored controls are slotted from this host.
const dialog=page=>page.locator('en-dialog.user-settings[label="User settings"]');
const settings=page=>choosePaletteAction(page,'User settings');
const goal=page=>choosePaletteAction(page,'Your goal');
const dock=page=>page.locator('.toolbar-motion-live .action-dock');
const flush=page=>page.evaluate(()=>window.app.actionContext.flush());
const waitFor=async predicate=>{const deadline=Date.now()+8000;while(!predicate()){if(Date.now()>deadline)throw new Error('Fixture condition did not settle');await new Promise(resolve=>setTimeout(resolve,20));}};

test('Still goals and action feedback use scoped, explicit, final interaction evidence',async t=>{
  const fixture=await actionContextFixture(),browser=await chromium.launch({headless:true});
  const directory=resolve('outputs/still-actions-browser',new Date().toISOString().replaceAll(':','-'));await mkdir(directory,{recursive:true});
  const selection=process.env.STILL_ACTION_BROWSER_CASES,selected=selection?new RegExp(selection):undefined;
  const receipt={mode:'fictional-source-browser',browser:browser.version(),selection:selection??'all',tests:[],notRun:[]};
  async function scenario(name,options,run){
    if(selected&&!selected.test(name)){receipt.notRun.push(name);return;}
    await t.test(name,async()=>{
      const data=fixture.reset(options),context=await browser.newContext({viewport:{width:1100,height:800},reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
      const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(8000);
      try{
        await page.addInitScript(()=>performance.setResourceTimingBufferSize(4096));
        await mountActionContextFixture(page,fixture.origin,options);await run(page,data);
        await flush(page);assert.deepEqual(data.unexpected,[]);assert.deepEqual(errors,[]);
        receipt.tests.push({name,status:'passed',requests:data.requests.length,contextReads:data.requests.filter(request=>request.path==='/still/action-context'&&request.method==='GET').map(request=>request.scope),observations:data.observations.length,...(data.timing?{timing:data.timing}:{})});
      }catch(error){receipt.tests.push({name,status:'failed',message:error.message,contextReads:data.requests.filter(request=>request.path==='/still/action-context'&&request.method==='GET').map(request=>request.scope)});await page.screenshot({path:resolve(directory,name.replaceAll(/[^a-z0-9]+/gi,'-')+'-failure.png'),fullPage:true});throw error;}
      finally{await context.close();}
    });
  }
  try{
    await scenario('Your goal is a palette action with independent optional memory',{enabled:false},async(page,data)=>{
      await toolbarReady(page);
      assert.equal(await page.getByRole('button',{name:'Goal & suggestions',exact:true}).count(),0,'No additional masthead action button');
      await goal(page);await page.getByRole('heading',{name:'Your goal',exact:true}).waitFor();
      assert.match(new URL(page.url()).pathname,/\/action\/intent$/);
      await page.getByRole('textbox',{name:'Your next goal',exact:true}).fill('Clarify the fictional scene before making an image.');
      await page.getByRole('textbox',{name:'Success criteria · optional, one per line',exact:true}).fill('One clear subject\nKeep the quiet tone');
      const remember=page.getByRole('checkbox',{name:'Remember this goal for this document for up to 30 days'});
      assert.equal(await remember.isChecked(),false);
      await chooseDockAction(page,'Save goal');await toolbarReady(page);
      assert.equal(data.requests.filter(request=>request.path==='/still/goal').length,0);
      await goal(page);assert.equal(await page.getByRole('textbox',{name:'Your next goal',exact:true}).inputValue(),'Clarify the fictional scene before making an image.');
      await remember.check();await chooseDockAction(page,'Save goal');await toolbarReady(page);
      const saved=data.requests.find(request=>request.path==='/still/goal'&&request.method==='PUT');
      assert.deepEqual(saved.body.scope,{projectId:'p',documentId:'d'});assert.deepEqual(saved.body.criteria,['One clear subject','Keep the quiet tone']);assert.equal(saved.body.remember,true);
      await page.setViewportSize({width:320,height:800});await goal(page);await toolbarReady(page);
      const more=dock(page).getByRole('button',{name:'More actions',exact:true});await more.click();
      await page.getByRole('menuitem',{name:'Complete goal',exact:true}).waitFor();
      for(const label of ['Save goal','Complete goal','Abandon goal','Clear goal','Back']){
        assert.ok(await dock(page).getByRole('button',{name:label,exact:true}).isVisible()||await page.getByRole('menuitem',{name:label,exact:true}).isVisible(),`${label} stays accessible through the compact toolbar`);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Five goal controls do not overflow a 320px viewport');
      await page.screenshot({path:resolve(directory,'goal-actions-320.png'),fullPage:true});
      await page.keyboard.press('Escape');await chooseDockAction(page,'Complete goal');await toolbarReady(page);await page.setViewportSize({width:1100,height:800});
      assert.equal(data.requests.filter(request=>request.path==='/still/goal'&&request.method==='POST').at(-1).body.status,'completed');
      await goal(page);await page.getByRole('textbox',{name:'Your next goal',exact:true}).fill('A second fictional goal.');await remember.check();
      await chooseDockAction(page,'Save goal');await toolbarReady(page);
      await goal(page);await chooseDockAction(page,'Abandon goal');await toolbarReady(page);
      assert.equal(data.requests.filter(request=>request.path==='/still/goal'&&request.method==='POST').at(-1).body.status,'abandoned');
      await goal(page);await page.getByRole('textbox',{name:'Your next goal',exact:true}).fill('A third fictional goal.');await remember.check();
      await chooseDockAction(page,'Save goal');await toolbarReady(page);
      await goal(page);await chooseDockAction(page,'Clear goal');await toolbarReady(page);
      assert.equal(data.requests.filter(request=>request.path==='/still/goal'&&request.method==='DELETE').length,1);
      assert.equal(data.observations.length,0,'Remembering and finishing goals does not enable disabled suggestion history');
    });
    await scenario('Your goal waits for remembered context before allowing edits',{deferContext:true,goal:{id:'remembered-fictional-goal',scope:{projectId:'p',documentId:'d'},text:'Keep the fictional observatory quiet.',criteria:['One clear subject'],status:'active',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*86400000).toISOString()}},async(page,data)=>{
      await waitFor(()=>data.releaseContext);await toolbarReady(page);await goal(page);
      const input=page.getByRole('textbox',{name:'Your next goal',exact:true}),criteria=page.getByRole('textbox',{name:'Success criteria · optional, one per line',exact:true});
      const remember=page.getByRole('checkbox',{name:'Remember this goal for this document for up to 30 days'});
      assert.equal(await input.isDisabled(),true,'An unresolved remembered goal cannot be overwritten by early edits');
      assert.equal(await criteria.isDisabled(),true);assert.equal(await remember.isDisabled(),true);
      assert.equal(await dock(page).getByRole('button',{name:'Save goal',exact:true}).isDisabled(),true);
      assert.equal(data.requests.some(request=>request.path==='/still/goal'),false);
      data.releaseContext();
      await page.waitForFunction(()=>window.app.actionContext.loaded&&window.app.bodyDraft==='Keep the fictional observatory quiet.');
      assert.equal(await input.inputValue(),'Keep the fictional observatory quiet.');assert.equal(await criteria.inputValue(),'One clear subject');assert.equal(await remember.isChecked(),true);
      assert.equal(data.requests.some(request=>request.path==='/still/goal'),false,'Hydration does not write or clear the remembered goal');
      await input.fill('Keep the fictional observatory quiet and focused.');await chooseDockAction(page,'Save goal');await toolbarReady(page);
      const update=data.requests.filter(request=>request.path==='/still/goal'&&request.method==='PUT').at(-1);
      assert.equal(update.body.remember,true);assert.equal(update.body.text,'Keep the fictional observatory quiet and focused.');
      assert.equal(data.requests.some(request=>request.path==='/still/goal'&&request.method==='DELETE'),false);
    });
    await scenario('default suggestion history and scope erasure are accessible palette settings',{},async(page,data)=>{
      await toolbarReady(page);await waitFor(()=>data.observations.length>0);await flush(page);assert.ok(data.observations.length>0,'History is saved without an opt-in step');
      assert.equal(data.requests.some(request=>request.path==='/still/action-context'&&request.method==='PUT'),false);
      await settings(page);const panel=dialog(page),toggle=panel.getByRole('checkbox',{name:'Save suggestion history',exact:true});
      assert.match(new URL(page.url()).pathname,/\/action\/user-settings$/);
      assert.equal(await toggle.isChecked(),true);
      await panel.getByRole('button',{name:'Save feedback',exact:true}).click();await panel.getByText('Feedback saved for future suggestions.',{exact:true}).waitFor();
      const feedback=data.observations.find(row=>row.kind==='feedback');assert.ok(feedback);assert.equal(feedback.feedback,'not-useful-now');assert.equal(feedback.feedbackScope,'document');assert.deepEqual(feedback.scope,{projectId:'p',documentId:'d'});
      assert.ok(Date.parse(feedback.feedbackExpiresAt)>Date.now()&&Date.parse(feedback.feedbackExpiresAt)<=Date.now()+86401000);
      for(const width of [1100,320]){
        await page.setViewportSize({width,height:800});
        const geometry=await panel.locator('dialog').evaluate(element=>{const rect=element.getBoundingClientRect();return {left:rect.left,right:rect.right,width:innerWidth,overflow:element.scrollWidth>element.clientWidth+1};});
        assert.ok(geometry.left>=-1&&geometry.right<=geometry.width+1,JSON.stringify(geometry));assert.equal(geometry.overflow,false);
        const erase=panel.getByRole('button',{name:'Erase saved history and goal for this document',exact:true});await erase.focus();
        await page.screenshot({path:resolve(directory,`suggestion-settings-${width}.png`),fullPage:true});
      }
      await flush(page);const beforeErase=new Set(data.retained.map(row=>row.id));assert.ok(beforeErase.size>0);
      const erase=panel.getByRole('button',{name:'Erase saved history and goal for this document',exact:true});await erase.focus();await page.keyboard.press('Enter');
      await panel.getByText('Saved suggestion history and remembered goal erased for this scope. New history is still saved when Save suggestion history is on.',{exact:true}).waitFor();assert.equal(await toggle.isChecked(),true,'Scope erasure leaves the account recording preference enabled');
      assert.deepEqual(data.retained,[]);
      assert.equal(data.requests.filter(request=>request.path==='/still/action-context'&&request.method==='DELETE').length,1);
      await page.keyboard.press('Escape');await panel.locator('dialog').waitFor({state:'hidden'});await toolbarReady(page);
      assert.equal(new URL(page.url()).pathname,'/still/project/p/document/d','Dialog dismissal restores the original route');
      await page.setViewportSize({width:1100,height:800});
      await choosePaletteAction(page,'Rename document');await chooseDockAction(page,'Back');await toolbarReady(page);await flush(page);
      assert.ok(data.retained.length>0,'New interactions are saved after explicit scope erasure');
      assert.ok(data.retained.every(row=>!beforeErase.has(row.id)),'Erased observations never return when recording resumes');
      await settings(page);await toggle.uncheck();
      await panel.getByText('Suggestion history is off across your account and saved history was erased. Your remembered goals are unchanged.',{exact:true}).waitFor();
      assert.deepEqual(data.retained,[]);const disabledCount=data.observations.length;
      await panel.getByRole('button',{name:'Done',exact:true}).click();await toolbarReady(page);
      await choosePaletteAction(page,'Rename document');await chooseDockAction(page,'Back');await toolbarReady(page);await flush(page);
      assert.equal(data.observations.length,disabledCount,'Opt-out prevents subsequent observation writes');
    });
    await scenario('unavailable settings recover on reopen without changing the saved preference',{contextFailures:2},async(page,data)=>{
      await toolbarReady(page);await page.waitForFunction(()=>window.app.actionContext.loaded&&window.app.actionContext.error);
      await settings(page);const panel=dialog(page),toggle=panel.getByRole('checkbox',{name:'Save suggestion history',exact:true});
      await panel.getByText('Your saved setting is unavailable. It has not been changed.',{exact:true}).waitFor();
      assert.equal(await toggle.isDisabled(),true);assert.equal(await toggle.evaluate(element=>element.indeterminate),true);
      assert.equal(data.requests.some(request=>request.path==='/still/action-context'&&request.method==='PUT'),false);
      await panel.getByRole('button',{name:'Done',exact:true}).click();await toolbarReady(page);await settings(page);
      await page.waitForFunction(()=>window.app.actionContext.loaded&&!window.app.actionContext.error&&window.app.actionContext.value.enabled);
      assert.equal(await toggle.isChecked(),true);assert.equal(await toggle.isDisabled(),false);assert.equal(await toggle.evaluate(element=>element.indeterminate),false);
      assert.equal(data.requests.filter(request=>request.path==='/still/action-context'&&request.method==='GET'&&request.scope.documentId==='d').length,3,'Reopening performs one fresh read, without a retry loop');
      assert.equal(data.requests.some(request=>request.path==='/still/action-context'&&request.method==='PUT'),false,'Recovering a failed read never replaces the saved preference');
      await toggle.uncheck();await panel.getByText('Suggestion history is off across your account and saved history was erased. Your remembered goals are unchanged.',{exact:true}).waitFor();
      assert.equal(data.requests.filter(request=>request.path==='/still/action-context'&&request.method==='PUT').length,1);
      assert.equal(data.enabled,false);
    });
    await scenario('partial recommendations never become interactive or receive exposure',{enabled:true,stream:true},async(page,data)=>{
      await waitFor(()=>data.initialSent);await page.waitForFunction(()=>window.app.toolbarDecisionPending);
      assert.equal(await page.evaluate(()=>window.app.appliedDecisionId),undefined);
      assert.equal(data.observations.some(row=>row.kind==='exposure'),false);
      await page.waitForTimeout(180); // Retain a real provider wait in the interaction latency measurement.
      data.release();await toolbarReady(page);await waitFor(()=>data.observations.some(row=>row.kind==='exposure'));
      const exposures=data.observations.filter(row=>row.kind==='exposure');assert.ok(exposures.every(row=>row.decisionId==='decision-0'));
      assert.ok(exposures.every(row=>!row.displayedActionIds.includes('research-context')));
      assert.equal(exposures.filter(row=>row.interactiveLatencyMs!==undefined).length,1,'one interactive timing per delivered decision');
      const timing=exposures[0].interactiveLatencyMs;
      assert.ok(Number.isInteger(timing)&&timing>=180&&timing<=300000,'bounded timing includes the response wait');
      const requestTiming=await page.evaluate(()=>{
        const request=performance.getEntriesByName(location.origin+'/api/still/decision').at(-1);
        return {started:window.app.appliedDecisionStarted,requestStart:request?.startTime,duration:request?.duration};
      });
      assert.ok(Number.isFinite(requestTiming.requestStart),'real fetch resource timing is present');
      assert.ok(Math.abs(requestTiming.started-requestTiming.requestStart)<100,'timing starts with the current request, not an earlier decision');
      assert.ok(timing>=requestTiming.duration-20,'interactive time includes network completion');
      data.timing={interactiveLatencyMs:timing,requestDurationMs:requestTiming.duration,requestStartDifferenceMs:requestTiming.started-requestTiming.requestStart};
      await dock(page).getByRole('button',{name:'Rename document',exact:true}).click();
      await dock(page).getByRole('button',{name:'Back',exact:true}).click();await toolbarReady(page);await flush(page);
      const selection=data.observations.find(row=>row.kind==='selection'),invocation=data.observations.find(row=>row.kind==='invocation'),cancel=data.observations.find(row=>row.kind==='cancellation');
      assert.equal(selection.actionId,'rename');assert.equal(selection.decisionId,'decision-0');assert.equal(selection.source,'toolbar');
      assert.equal(invocation.parentId,selection.id);assert.equal(cancel.parentId,invocation.id);assert.equal(data.observations.some(row=>row.kind==='commit'),false,'opening and cancelling never claims an outcome');
    });
    await scenario('an interrupted stream leaves local controls without invented exposure',{enabled:true,stream:true},async(page,data)=>{
      await waitFor(()=>data.initialSent);data.interrupt();await toolbarReady(page);await flush(page);
      assert.equal(await page.evaluate(()=>window.app.appliedDecisionId),undefined);
      assert.equal(data.observations.some(row=>row.kind==='exposure'),false);
      assert.equal(await dock(page).getByRole('button',{name:'More actions',exact:true}).isEnabled(),true);
      await dock(page).getByRole('button',{name:'More actions',exact:true}).click();
      await dock(page).getByRole('button',{name:/^Find action/}).waitFor();
    });
    await scenario('session goals are scoped while suggestion history defaults across documents',{},async(page,data)=>{
      await toolbarReady(page);await goal(page);
      await page.getByRole('textbox',{name:'Your next goal',exact:true}).fill('Only for the night study.');await chooseDockAction(page,'Save goal');await toolbarReady(page);
      await page.getByRole('link',{name:'Still home',exact:true}).click();await toolbarReady(page);
      await page.getByRole('link',{name:/Fictional observatory/}).click();await toolbarReady(page);
      await page.getByRole('link',{name:/Morning study/}).click();await toolbarReady(page);await goal(page);
      assert.equal(await page.getByRole('textbox',{name:'Your next goal',exact:true}).inputValue(),'','A session goal does not follow navigation to another document');
      await chooseDockAction(page,'Back');await toolbarReady(page);await settings(page);
      assert.equal(await dialog(page).getByRole('checkbox',{name:'Save suggestion history',exact:true}).isChecked(),true);
      await flush(page);assert.ok(data.observations.some(row=>row.scope.documentId==='d2'),'Account defaults apply to another authorized document');
    });
    await scenario('read only users can discover personal actions without authoring suggestions',{role:'viewer'},async(page,data)=>{
      await toolbarReady(page);await page.getByText('Read only',{exact:true}).waitFor();
      assert.equal(await dock(page).getByRole('button',{name:'Rename document',exact:true}).count(),0);
      assert.equal(await dock(page).getByRole('button',{name:'Add idea',exact:true}).count(),0);
      await dock(page).getByRole('button',{name:'View documents',exact:true}).waitFor();
      await page.setViewportSize({width:320,height:800});await goal(page);
      await page.getByRole('textbox',{name:'Your next goal',exact:true}).fill('Review the fictional study.');
      await chooseDockAction(page,'Save goal');await toolbarReady(page);
      await settings(page);assert.equal(await dialog(page).getByRole('checkbox',{name:'Save suggestion history',exact:true}).isChecked(),true);
      await page.screenshot({path:resolve(directory,'read-only-settings-320.png'),fullPage:true});
      await flush(page);assert.equal(data.observations.some(row=>['rename','add-context'].includes(row.actionId)&&['selection','invocation'].includes(row.kind)),false);
    });
    await scenario('startup recovery offers retry and home without suggestion side effects',{failFirstLoad:true},async(page,data)=>{
      await page.getByRole('heading',{name:'Couldn’t load Still',exact:true}).waitFor();await toolbarReady(page);
      await dock(page).getByRole('button',{name:'View projects',exact:true}).waitFor();
      const retry=dock(page).getByRole('button',{name:'Retry loading Still',exact:true});await retry.waitFor();
      assert.equal(data.decisions.length,0);assert.equal(data.observations.length,0);
      await page.screenshot({path:resolve(directory,'startup-recovery.png'),fullPage:true});
      await retry.click();await page.getByRole('heading',{name:'Night study',exact:true}).waitFor();await toolbarReady(page);
      assert.equal(data.decisions.length,1);
    });
  }finally{
    await writeFile(resolve(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    await browser.close();await fixture.close();console.log(`Still action browser receipt: ${directory}`);
  }
});
