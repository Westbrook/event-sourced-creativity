import assert from"node:assert/strict";
import test from"node:test";
import{mediaFixture,settle,untilScene,invoke}from"./helpers/media-private-retirement-fixture.mjs";

for(const deny of[false,true])test("actual open artifact private edit "+(deny?"retirement-restoration":"healthy"),async t=>{
 const x=await mediaFixture(t),{f}=x,secret="PRIVATE retained unsaved output revision";
 assert.equal(await f.host.openArtifactById("saved-scene-story"),true);await settle(f);
 await f.click(f.i18n.system("Edit finished output"));await settle(f);
 const field=f.renderer.ownNodes(f.host,"textarea").find(n=>n.attributes.class==="artifact-markdown-editor"||String(n.value??"").includes("The keeper checks harbor position 1."));
 assert.ok(field,"the actual current artifact editor");field.value=secret;
 await field.handlers.input.call(f.host,{target:field,currentTarget:field});await settle(f);
 assert.ok(f.renderer.ownNodes(f.host,"textarea").some(n=>n.value===secret));
 if(deny){await x.retire();await x.recovered();assert.equal(await f.host.openArtifactById("saved-scene-story"),true);await settle(f);}
 x.noMutation();
 assert.equal(f.renderer.ownNodes(f.host,"textarea").some(n=>n.value===secret),!deny,"old unsaved private bytes cannot become a fresh viewer's draft");
});
for(const deny of[false,true])test("actual late artifact content opening "+(deny?"retirement-restoration":"healthy"),async t=>{
 const x=await mediaFixture(t),{h,f,worker}=x,entered=Promise.withResolvers(),gate=Promise.withResolvers(),prior=h.intercept;
 const without={...h.store.content.get()};delete without[worker.contentRef];h.store.content.set(without);
 let held=false;h.intercept=async request=>{
  if(held||!request.url.startsWith("/api/events?")||!request.url.includes("content=1"))return prior?.(request);
  held=true;const response=await worker.request(request.url,request.init);assert.equal(response.status,200);const body=await response.clone().json();
  response.json=()=>{entered.resolve(body);return gate.promise;};return response;
 };
 const opening=f.host.openArtifactById("saved-scene-story"),body=await entered.promise;
 if(deny){await x.retire();await x.recovered();}gate.resolve(body);
 const result=await opening;await settle(f);x.noMutation();
 assert.equal(result,!deny,"pre-retirement viewer opening never revives after the source returns");
});

for(const boundary of["list","detail"])for(const deny of[false,true])test("actual late artifact revision "+boundary+" "+(deny?"retirement-restoration":"healthy"),async t=>{
 const x=await mediaFixture(t),{h,f,worker}=x,entered=Promise.withResolvers(),gate=Promise.withResolvers(),prior=h.intercept;
 assert.equal(await f.host.openArtifactById("saved-scene-story"),true);await settle(f);
 const path="/api/artifacts/saved-scene-story/revisions";
 if(boundary==="detail"){await f.click(f.i18n.system("Output history"));await untilScene(()=>{f.draw();return f.buttons().some(b=>b.attributes["aria-label"]===f.i18n.system("Inspect revision {revision}",{revision:f.i18n.number(0)}));});}
 let held=false;h.intercept=async request=>{
  if(held||request.url!==(boundary==="list"?path:path+"/0"))return prior?.(request);
  held=true;const response=await worker.request(request.url,request.init);assert.equal(response.status,200,await response.clone().text());
  const body=await response.clone().json();response.json=()=>{entered.resolve(body);return gate.promise;};return response;
 };
 if(boundary==="list")await f.click(f.i18n.system("Output history"));
 else await invoke(f,f.buttons().find(b=>b.attributes["aria-label"]===f.i18n.system("Inspect revision {revision}",{revision:f.i18n.number(0)})));
 const body=await entered.promise;if(deny){await x.retire();await x.recovered();}gate.resolve(body);await settle(f);x.noMutation();
 assert.equal(f.host.markup.includes('class="artifact-revision-history"'),!deny,"retired revision view stays closed after a fresh source read");
 if(!deny&&boundary==="detail")assert.ok(f.visible().includes("Revision 0 content"));
});

for(const deny of[false,true])test("actual late artifact reviewer listing "+(deny?"retirement-restoration":"healthy"),async t=>{
 const x=await mediaFixture(t),{h,f,worker}=x,entered=Promise.withResolvers(),gate=Promise.withResolvers(),prior=h.intercept;
 let held=false;h.intercept=async request=>{
  if(held||!request.url.endsWith("/members"))return prior?.(request);held=true;
  const response=await worker.request(request.url,request.init);assert.equal(response.status,200);
  const body=await response.clone().json();assert.ok(Array.isArray(body.members));response.json=()=>{entered.resolve(body);return gate.promise;};return response;
 };
 const opening=f.host.openArtifactById("saved-scene-story"),body=await entered.promise;
 if(deny){await x.retire();await x.recovered();}
 gate.resolve(body);const opened=await opening;await settle(f);x.noMutation();
 assert.equal(opened,!deny,"a late reviewer list cannot revive the old artifact opener");
});
