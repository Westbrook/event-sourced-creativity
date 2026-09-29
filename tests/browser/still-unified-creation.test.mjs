import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {createSceneCostFixture} from '../helpers/scene-cost-fixture.mjs';

// Real Still UI/controller + Worker + disposable SQLite. Providers are deliberately unconfigured.
test('unified creation keyboard, current-version review, long content and mobile report return',async t=>{
 const fixture=await createSceneCostFixture(0);fixture.env.STILL_UNIFIED_CREATION_ENABLED='true';fixture.env.OPENAI_API_KEY='';fixture.env.JEV_API_KEY='';
 const markup=await readFile(new URL('../../still.html',import.meta.url),'utf8');
 const requests=[];
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-unified-creation-browser',optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port:0},plugins:[{name:'creation-browser-worker',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(req.url?.startsWith('/api/')){try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);requests.push({url:req.url,method:req.method});const headers={...req.headers};if(headers.origin===`http://${req.headers.host}`)headers.origin='http://localhost';const response=await fixture.request(req.url,{method:req.method,headers,...(body.length?{body}:{})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(error)}));}return;}
  if(req.url?.startsWith('/still')){res.setHeader('content-type','text/html');res.end(await vite.transformIndexHtml('/still.html',markup));return;}next();
 });}}]});
 let browser;
 try{
  await server.listen();const engines=await import(process.env.CREATION_PLAYWRIGHT_MODULE??'@playwright/test');browser=await engines[process.env.CREATION_TEST_BROWSER??'chromium'].launch({headless:true});
  const base=`http://127.0.0.1:${server.httpServer.address().port}`;
  const route=`${base}/still/project/${fixture.projectId}/document/${fixture.documentId}/action/add-context?creation=1&progress-report`;
  const open=async viewport=>{const context=await browser.newContext({viewport});const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(route);await page.getByRole('textbox',{name:'Describe a detail worth keeping.',exact:true}).waitFor();return {context,page,errors};};
  const waitSaved=async page=>{try{await page.waitForFunction(()=>document.querySelector('.action-dock .toolbar-status')?.textContent?.trim()==='Draft saved');}catch(error){throw new Error('Draft did not acknowledge: '+await page.locator('.action-dock .toolbar-status').innerText()+'; '+(await page.getByRole('alert').allTextContents()).join(' / '),{cause:error});}};
  const typeInput=async(input,text)=>{await input.click();await input.press('ControlOrMeta+a');await input.press('Backspace');await input.pressSequentially(text);};
  const pastePayload=async(input,payload)=>{await input.click();await input.evaluate((el,payload)=>{const event=new ClipboardEvent('paste',{bubbles:true,composed:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:type=>payload[type]??'',types:Object.keys(payload)}});el.dispatchEvent(event);},payload);};
  const dockButton=(page,name)=>page.locator('.action-dock').getByRole('button',{name,exact:true});
  const showWholeContent=async page=>{const region=page.getByRole('region',{name:'Full content and included relationships'});await region.focus();await region.press('End');await page.waitForFunction(()=>{const box=document.querySelector('.creation-full-content');return box&&box.scrollTop+box.clientHeight>=box.scrollHeight-4;});await page.waitForFunction(()=>!document.querySelector('.creation-continue')?.disabled);};
  for(const entry of ['project','document','idea'])await t.test(`${entry}: @ teaches naming and reuses retained draft Ideas through undo and recovery`,async()=>{
   const context=await browser.newContext({viewport:{width:1100,height:820}});const page=await context.newPage();page.setDefaultTimeout(12000);
   const editor=page.locator('#creation-input');
   const tokens=()=>editor.evaluate(editor=>{const runs=[];const visit=node=>{if(node.type==='token')runs.push(node.attrs.run);node.content?.forEach(visit);};visit(editor.document.doc);return runs;});
   try{
    await page.goto(entry==='project'?`${base}/still/action/new-project?creation=1`:entry==='document'?`${base}/still/project/${fixture.projectId}/action/new-document?creation=1`:route);
    const input=page.getByRole('textbox',{name:entry==='idea'?'Describe a detail worth keeping.':'A name is enough. Details welcome.',exact:true});await input.waitFor();await input.click();
    await input.pressSequentially('@');await editor.getByRole('listbox',{name:'Use or name an Idea',exact:true}).waitFor();
    if(entry==='project'){await editor.getByRole('listbox').getByText('Type a name to introduce an Idea. You’ll complete and review it before creation.',{exact:true}).waitFor();assert.equal(await editor.getByRole('option').count(),0,'Empty guidance is informational, not a selectable placeholder');}
    await input.pressSequentially('dan');await editor.getByRole('option',{name:'New Idea: dan',exact:true}).click();
    await input.pressSequentially(' wears a leather jacket and rides a @motorcycle');await editor.getByRole('option',{name:'New Idea: motorcycle',exact:true}).click();
    const original=await tokens();assert.equal(original.length,2);
    await input.pressSequentially(' down the highway. @');
    await editor.getByRole('option',{name:'dan',exact:true}).waitFor();await editor.getByRole('option',{name:'motorcycle',exact:true}).waitFor();
    if(entry==='project')assert.equal(await editor.getByRole('option').count(),2,'New Project lists only retained draft declarations');
    assert.match(await editor.getByRole('option',{name:'dan',exact:true}).innerText(),/In this draft/);
    await input.press('Enter');
    const reused=await tokens();assert.equal(reused.length,3);assert.equal(reused[2].data.targetId,original[0].data.targetId);assert.notEqual(reused[2].id,original[0].id);
    await input.press('ControlOrMeta+z');assert.equal((await tokens()).length,2);await input.press('ControlOrMeta+Shift+z');assert.equal((await tokens()).length,3);
    await waitSaved(page);await page.reload();await input.waitFor();await waitSaved(page);
    assert.deepEqual(await tokens(),reused,'Recovered draft keeps shared identity and occurrence IDs');
    await input.press('ControlOrMeta+End');await input.pressSequentially(' @mo');await editor.getByRole('option',{name:'motorcycle',exact:true}).waitFor();
    assert.equal(await editor.getByRole('option',{name:'dan',exact:true}).count(),0,'Existing draft choices filter by typed name');
    await input.press('Escape');await input.press('ControlOrMeta+a');await input.press('Backspace');await input.pressSequentially('@');
    if(entry==='project')await editor.getByRole('listbox').getByText('Type a name to introduce an Idea. You’ll complete and review it before creation.',{exact:true}).waitFor();
    assert.equal(await editor.getByRole('option',{name:'dan',exact:true}).count(),0,'Deleted declarations do not linger in a separate registry');
    await input.press('Escape');await typeInput(input,'/');await editor.getByRole('option',{name:'/idea',exact:true}).waitFor();
    assert.doesNotMatch(await editor.getByRole('listbox').innerText(),/Type a name/,'Reference guidance does not leak into the slash picker');
    assert.equal(requests.filter(request=>/\/(interpret|apply)$/.test(request.url)).length,0,'Naming and reuse in the picker never create approved content or run interpretation');
   }finally{await context.close();}
  });
  await t.test('empty error is singular, plain Enter/IME do not submit, explicit save shortcut enters title-only Idea review',async()=>{
   const {context,page,errors}=await open({width:1100,height:820});
   try{
    await dockButton(page,'Save').click();assert.equal(await page.getByRole('alert').count(),1);assert.match(await page.getByRole('alert').innerText(),/Describe what you have in mind/);assert.equal(await page.getByRole('textbox',{name:'Describe a detail worth keeping.'}).evaluate(el=>el.getRootNode().activeElement===el),true);
    const input=page.getByRole('textbox',{name:'Describe a detail worth keeping.'});await typeInput(input,'Paul');await page.waitForFunction(()=>document.querySelector('#creation-input')?.value==='Paul');await input.press('ControlOrMeta+End');const before=requests.filter(request=>/\/(interpret|preview|apply)$/.test(request.url)).length;
    await input.press('Enter');await input.pressSequentially('without a biography');assert.match(await page.locator('#creation-input').evaluate(el=>el.value),/Paul\nwithout a biography/);
    await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,composed:true,data:''}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true,composed:true}));});
    assert.equal(await dockButton(page,'Save').isDisabled(),true);
    await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,composed:true,data:'語'})));await waitSaved(page);
    assert.equal(requests.filter(request=>/\/(interpret|preview|apply)$/.test(request.url)).length,before);
    await typeInput(input,'Paul');await page.waitForFunction(()=>document.querySelector('#creation-input')?.value==='Paul');await input.press('ControlOrMeta+Enter');await page.getByRole('heading',{name:'Review Idea',exact:true}).waitFor();assert.equal(await dockButton(page,'Approve').isDisabled(),true);assert.match(await page.locator('.creation-full-content').innerText(),/semantic body is required/);assert.equal(requests.filter(request=>/\/apply$/.test(request.url)).length,0);assert.deepEqual(errors,[]);
   }finally{await context.close();}
  });
  await t.test('paste remaps foreign-draft declarations and refuses cross-Project canonical identity in one undo step',async()=>{
   const {context,page,errors}=await open({width:1100,height:820});
   try{
    const run=(id,type,text,data)=>({kind:'token',id,type,text,label:text.slice(1),data});
    const tokens=[run('same-occurrence','still-idea-reference','@Keeper',{schemaVersion:1,kind:'idea-reference',projectId:fixture.projectId,blockId:'scene-reuse-direction'}),run('foreign-occurrence','still-idea-reference','@Foreign',{schemaVersion:1,kind:'idea-reference',projectId:'foreign-project',blockId:'foreign-idea'}),run('old-declaration-a','still-creation-declaration','@New',{schemaVersion:1,kind:'declaration',draftId:'foreign-draft',targetId:'temporary:foreign-identity'}),run('old-declaration-b','still-creation-declaration','@New',{schemaVersion:1,kind:'declaration',draftId:'foreign-draft',targetId:'temporary:foreign-identity'})];
    const runs=tokens.flatMap((token,index)=>[...(index?[{kind:'text',text:' '}]:[]),token]);const text=runs.map(run=>run.text).join('');
    const input=page.getByRole('textbox',{name:'Describe a detail worth keeping.'});await pastePayload(input,{'text/plain':text,'application/x-en-editor+json':JSON.stringify({type:'en-editor-clipboard',version:1,runs})});
    const pasted=await page.locator('#creation-input').evaluate(editor=>{const tokens=[];const visit=node=>{if(node.type==='token')tokens.push(node.attrs.run);node.content?.forEach(visit);};visit(editor.document.doc);return {value:editor.value,tokens,draftId:document.querySelector('still-creation-flow').flow.draft.id};});
    assert.equal(pasted.value,text);assert.equal(pasted.tokens.length,3);assert.ok(pasted.tokens.every(token=>!tokens.some(original=>original.id===token.id)));assert.equal(pasted.tokens[0].data.blockId,'scene-reuse-direction');assert.equal(pasted.tokens.filter(token=>token.type==='still-idea-reference').length,1);
    const declarations=pasted.tokens.filter(token=>token.type==='still-creation-declaration');assert.equal(declarations[0].data.draftId,pasted.draftId);assert.notEqual(declarations[0].data.targetId,'temporary:foreign-identity');assert.equal(declarations[0].data.targetId,declarations[1].data.targetId);assert.notEqual(declarations[0].id,declarations[1].id);
    await input.press('ControlOrMeta+z');await page.waitForFunction(()=>document.querySelector('#creation-input').value==='');await input.press('ControlOrMeta+Shift+z');await page.waitForFunction(text=>document.querySelector('#creation-input').value===text,text);
    const before=requests.filter(request=>request.url.endsWith('/use')).length;await dockButton(page,'Save').click();await page.getByRole('button',{name:'Complete one Idea manually',exact:true}).waitFor();assert.ok(requests.filter(request=>request.url.endsWith('/use')).length>before,'Same-Project pasted identity is freshly authorized at Save');assert.deepEqual(errors,[]);
   }finally{await context.close();}
  });
  await t.test('normal navigation supports @Document constituent selection without a query flag',async()=>{
   const {context,page,errors}=await open({width:1100,height:820});try{
    await page.goto(route.replace('creation=1&',''));const input=page.getByRole('textbox',{name:'Describe a detail worth keeping.',exact:true});await input.waitFor();await input.click();await input.pressSequentially('@One');await page.locator('#creation-input').getByRole('option',{name:'One current authored direction',exact:true}).click();
    await page.getByRole('heading',{name:'Choose Ideas from One current authored direction'}).waitFor();await page.locator('.creation-reuse-preview input[type=checkbox]').first().check();await page.getByRole('button',{name:'Preview selected Ideas'}).click();await page.getByRole('heading',{name:'Included source content and dependencies'}).waitFor();await page.getByRole('button',{name:'Apply reviewed references'}).click();await waitSaved(page);
    const state=await page.locator('still-creation-flow').evaluate(el=>({text:el.flow.text,roots:el.flow.draft.referenceSelections.flatMap(s=>s.rootIds)}));assert.deepEqual(state.roots,['scene-reuse-direction']);assert.match(state.text,/@direction/);await page.reload();await input.waitFor();assert.equal(await page.locator('still-creation-flow').evaluate(el=>el.flow.text),state.text);assert.deepEqual(errors,[]);
   }finally{await context.close();}
  });
  await t.test('reviewed Idea editor supports declarations and nonexclusive Format commands through reload',async()=>{
   const {context,page,errors}=await open({width:1100,height:820});try{
    const input=page.getByRole('textbox',{name:'Describe a detail worth keeping.',exact:true});await typeInput(input,'Dan');await dockButton(page,'Save').click();await page.getByRole('heading',{name:'Review Idea',exact:true}).waitFor();await page.getByText('Edit body',{exact:true}).click();const body=page.getByRole('textbox',{name:'Idea body',exact:true});await body.pressSequentially('@Lee');await page.locator('#creation-body-editor').getByRole('option',{name:'New Idea: Lee',exact:true}).click();await body.pressSequentially(' sings. /image');await page.locator('#creation-body-editor').getByRole('option',{name:'/image',exact:true}).click();await waitSaved(page);
    const nodes=await page.locator('still-creation-flow').evaluate(el=>el.flow.plan.nodes);assert.equal(nodes.length,3);assert.equal(nodes.find(n=>n.title==='Lee').text,'');assert.deepEqual(nodes.find(n=>n.type==='format').preferredOutputKinds,['image']);await page.reload();await page.getByRole('heading',{name:'Review Idea',exact:true}).waitFor();assert.equal(await page.locator('still-creation-flow').evaluate(el=>el.flow.plan.nodes.length),3);assert.deepEqual(errors,[]);
   }finally{await context.close();}
  });
  await t.test('initial partial reuse is independent and undoable, with exact passage review',async()=>{
   const {context,page,errors}=await open({width:1100,height:820});try{
    const input=page.getByRole('textbox',{name:'Describe a detail worth keeping.',exact:true});await typeInput(input,'keeper harbo');await waitSaved(page);await fixture.drainBackground();await input.pressSequentially('r');const article=page.locator('.creation-search article').filter({has:page.getByRole('heading',{name:'direction/scene-reuse',exact:true})});await article.getByRole('button',{name:'Use in this draft',exact:true}).click();await page.getByRole('checkbox',{name:'Use only this part as an independent Idea'}).check();await page.getByRole('textbox',{name:'Independent Idea title'}).fill('Harbor check');await page.getByRole('textbox',{name:'Exact source excerpt',exact:true}).fill('checks the harbor');await page.getByRole('textbox',{name:'Exact draft passage to replace (optional)'}).fill('keeper harbor');await page.getByRole('button',{name:'Preview selected Ideas'}).click();await page.getByRole('heading',{name:'Review this passage',exact:true}).waitFor();await page.getByRole('button',{name:'Apply reviewed references'}).click();await waitSaved(page);
    const active=()=>page.locator('still-creation-flow').evaluate(el=>(el.flow.draft.partialIdeas??[]).filter(n=>n.disposition==='retained').length);assert.equal(await active(),1);await input.focus();await input.press('ControlOrMeta+z');assert.equal(await active(),0);await input.press('ControlOrMeta+Shift+z');assert.equal(await active(),1);await waitSaved(page);await page.reload();await input.waitFor();assert.equal(await active(),1);assert.deepEqual(errors,[]);
   }finally{await context.close();}
  });
  await t.test('long content must be available before Continue, edits invalidate approval, mobile controls remain reachable',async()=>{
   const {context,page,errors}=await open({width:1100,height:820});
   try{
    const text=Array.from({length:36},(_,index)=>`Supplied observation ${index+1}: fog remains over the harbor; no biography or explanation is supplied.`).join('\n');
    await pastePayload(page.getByRole('textbox',{name:'Describe a detail worth keeping.'}),{'text/plain':text});await page.waitForFunction(text=>document.querySelector('#creation-input')?.value===text,text);await dockButton(page,'Save').click();await page.getByRole('button',{name:'Complete one Idea manually',exact:true}).click();await page.getByRole('heading',{name:'Review Idea',exact:true}).waitFor();
    await page.getByRole('textbox',{name:'Title',exact:true}).fill('Supplied harbor observations');await page.getByRole('combobox',{name:'Idea type'}).selectOption('direction');await waitSaved(page);
    assert.equal(await page.getByRole('button',{name:'Continue review',exact:true}).isDisabled(),true);assert.equal(await dockButton(page,'Approve').isDisabled(),true);
    await showWholeContent(page);await page.getByRole('button',{name:'Continue review',exact:true}).click();await page.getByRole('button',{name:'Current version reviewed',exact:true}).waitFor();await dockButton(page,'Approve').click();
    await dockButton(page,'Review Documents').click();await page.getByRole('heading',{name:'Review attachment',exact:true}).waitFor();assert.equal(await dockButton(page,'Approve').isDisabled(),true);
    await showWholeContent(page);await page.getByRole('button',{name:'Continue review',exact:true}).click();await page.getByRole('button',{name:'Current version reviewed',exact:true}).waitFor();await dockButton(page,'Approve').click();await dockButton(page,'Final review').click();
    await page.getByRole('heading',{name:'Ready to save',exact:true}).waitFor();assert.equal(await dockButton(page,'Approve selected (1)').isDisabled(),false);
    await dockButton(page,'Back to Ideas').click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Revised harbor observations');await waitSaved(page);assert.equal(await dockButton(page,'Approve').isDisabled(),true);assert.equal(await dockButton(page,'Final review').count(),0);
    await page.setViewportSize({width:390,height:844});
    const report=page.getByRole('link',{name:'Progress Report',exact:true});await report.waitFor();assert.equal(new URL(await report.getAttribute('href')).port,'4187');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await showWholeContent(page);const continueButton=page.getByRole('button',{name:'Continue review',exact:true});await continueButton.scrollIntoViewIfNeeded();
    const hitCheck=await continueButton.evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {clear:hit===el||el.contains(hit),hit:hit?.outerHTML.slice(0,250),rect:{x:r.x,y:r.y,width:r.width,height:r.height}};});assert.equal(hitCheck.clear,true,'Progress Report return and dock must not cover Continue: '+JSON.stringify(hitCheck));
    const geometry=await page.evaluate(()=>{const report=document.querySelector('.progress-return').getBoundingClientRect(),dock=document.querySelector('.action-dock').getBoundingClientRect();return {reportTop:report.top,reportBottom:report.bottom,dockTop:dock.top,dockBottom:dock.bottom,height:innerHeight};});assert.ok(geometry.reportBottom<=geometry.dockTop+1||geometry.reportTop>=geometry.dockBottom-1,'Report return uses a separate lane from workflow actions');assert.ok(geometry.height-geometry.reportBottom<=20,'Report return remains in the bottom corner');
    await continueButton.click();await page.getByRole('button',{name:'Current version reviewed',exact:true}).waitFor();
    // No canonical graph is saved merely by showing all content or navigating review.
    assert.equal(requests.filter(request=>/\/apply$/.test(request.url)).length,0);assert.deepEqual(errors,[]);
   }finally{await context.close();}
  });
 }finally{await browser?.close();await server.close();await fixture.drainBackground();fixture.close();}
});
