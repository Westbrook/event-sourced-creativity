import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {actionContextFixture,mountActionContextFixture,toolbarReady} from './helpers/still-action-context.mjs';

// The native dialog is in shadow DOM; its authored controls are slotted from this host.
const dialog=page=>page.locator('en-dialog[label="Goal and suggestions"]');
const settings=page=>page.getByRole('button',{name:'Goal & suggestions',exact:true});
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
        receipt.tests.push({name,status:'passed',requests:data.requests.length,observations:data.observations.length,...(data.timing?{timing:data.timing}:{})});
      }catch(error){receipt.tests.push({name,status:'failed',message:error.message});await page.screenshot({path:resolve(directory,name.replaceAll(/[^a-z0-9]+/gi,'-')+'-failure.png'),fullPage:true});throw error;}
      finally{await context.close();}
    });
  }
  try{
    await scenario('optional goals remain local until remembered and clear independently',{enabled:false},async(page,data)=>{
      await toolbarReady(page);await settings(page).click();await dialog(page).getByRole('button',{name:'Set goal',exact:true}).click();
      await page.getByRole('textbox',{name:'Your next goal',exact:true}).fill('Clarify the fictional scene before making an image.');
      await page.getByRole('textbox',{name:'Success criteria · optional, one per line',exact:true}).fill('One clear subject\nKeep the quiet tone');
      const remember=page.getByRole('checkbox',{name:'Remember this goal for this document for up to 30 days'});
      assert.equal(await remember.isChecked(),false);
      await dock(page).getByRole('button',{name:'Suggest actions',exact:true}).click();await toolbarReady(page);
      await settings(page).click();assert.equal(await dialog(page).getByText('For this session.',{exact:true}).count(),1);
      assert.equal(data.requests.filter(request=>request.path==='/still/goal').length,0);
      await dialog(page).getByRole('button',{name:'Edit goal',exact:true}).click();await remember.check();
      await dock(page).getByRole('button',{name:'Suggest actions',exact:true}).click();await toolbarReady(page);
      const saved=data.requests.find(request=>request.path==='/still/goal'&&request.method==='PUT');
      assert.deepEqual(saved.body.scope,{projectId:'p',documentId:'d'});assert.deepEqual(saved.body.criteria,['One clear subject','Keep the quiet tone']);assert.equal(saved.body.remember,true);
      await settings(page).click();assert.match(await dialog(page).textContent(),/Remembered for this document until/);
      await dialog(page).getByRole('button',{name:'Clear goal',exact:true}).click();await dialog(page).getByText('Goal cleared.',{exact:true}).waitFor();
      assert.equal(data.requests.filter(request=>request.path==='/still/goal'&&request.method==='DELETE').length,1);
      assert.equal(data.observations.length,0,'saving a goal does not opt into action history');
      await dialog(page).getByRole('button',{name:'Done',exact:true}).click();
    });
    await scenario('opt in feedback and erase are explicit accessible scoped controls',{enabled:false},async(page,data)=>{
      await toolbarReady(page);assert.equal(data.observations.length,0);
      await settings(page).click();const panel=dialog(page),toggle=panel.getByRole('checkbox',{name:'Remember action outcomes for this document'});
      assert.equal(await toggle.isChecked(),false);await toggle.check();await panel.getByText('Suggestion history enabled for up to 30 days.',{exact:true}).waitFor();
      await panel.getByRole('button',{name:'Save feedback',exact:true}).click();await panel.getByText('Feedback saved for future suggestions.',{exact:true}).waitFor();
      const feedback=data.observations.find(row=>row.kind==='feedback');assert.ok(feedback);assert.equal(feedback.feedback,'not-useful-now');assert.equal(feedback.feedbackScope,'document');assert.deepEqual(feedback.scope,{projectId:'p',documentId:'d'});
      assert.ok(Date.parse(feedback.feedbackExpiresAt)>Date.now()&&Date.parse(feedback.feedbackExpiresAt)<=Date.now()+86401000);
      for(const width of [1100,320]){
        await page.setViewportSize({width,height:800});
        const geometry=await panel.locator('dialog').evaluate(element=>{const rect=element.getBoundingClientRect();return {left:rect.left,right:rect.right,width:innerWidth,overflow:element.scrollWidth>element.clientWidth+1};});
        assert.ok(geometry.left>=-1&&geometry.right<=geometry.width+1,JSON.stringify(geometry));assert.equal(geometry.overflow,false);
        const erase=panel.getByRole('button',{name:'Erase saved suggestion history and goal',exact:true});await erase.focus();
        await page.screenshot({path:resolve(directory,`suggestion-settings-${width}.png`),fullPage:true});
      }
      const erase=panel.getByRole('button',{name:'Erase saved suggestion history and goal',exact:true});await erase.focus();await page.keyboard.press('Enter');
      await panel.getByText('Saved suggestion history and remembered goal erased.',{exact:true}).waitFor();assert.equal(await toggle.isChecked(),false);
      assert.equal(data.requests.filter(request=>request.path==='/still/action-context'&&request.method==='DELETE').length,1);
      await page.keyboard.press('Escape');await panel.locator('dialog').waitFor({state:'hidden'});
      assert.equal(await settings(page).evaluate(element=>{let active=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;return active===element;}),true,'native dialog dismissal restores the opener');
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
    await scenario('navigation discards session goal and loads separate observation scope',{enabled:true},async(page,data)=>{
      await toolbarReady(page);await settings(page).click();await dialog(page).getByRole('button',{name:'Set goal',exact:true}).click();
      await page.getByRole('textbox',{name:'Your next goal',exact:true}).fill('Only for the night study.');await dock(page).getByRole('button',{name:'Suggest actions',exact:true}).click();await toolbarReady(page);
      await page.getByRole('link',{name:'Still home',exact:true}).click();await toolbarReady(page);
      await page.getByRole('link',{name:/Fictional observatory/}).click();await toolbarReady(page);
      await page.getByRole('link',{name:/Morning study/}).click();await toolbarReady(page);await settings(page).click();
      const panel=dialog(page);assert.equal(await panel.getByText('Only for the night study.',{exact:true}).count(),0);assert.equal(await panel.getByRole('checkbox',{name:'Remember action outcomes for this document'}).isChecked(),false);
      assert.ok(data.requests.some(request=>request.path==='/still/action-context'&&request.method==='GET'));
      assert.ok(data.observations.every(row=>row.scope.documentId==='d'),'opt-in is scoped to the original document');
    });
    await scenario('read only users retain viewing controls without authoring suggestions',{role:'viewer'},async(page,data)=>{
      await toolbarReady(page);await page.getByText('Read only',{exact:true}).waitFor();
      assert.equal(await dock(page).getByRole('button',{name:'Rename document',exact:true}).count(),0);
      assert.equal(await dock(page).getByRole('button',{name:'Add idea',exact:true}).count(),0);
      await dock(page).getByRole('button',{name:'View documents',exact:true}).waitFor();
      await page.setViewportSize({width:320,height:800});await settings(page).click();await dialog(page).getByRole('button',{name:'Set goal',exact:true}).waitFor();
      await page.screenshot({path:resolve(directory,'read-only-settings-320.png'),fullPage:true});
      assert.equal(data.observations.length,0);
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
