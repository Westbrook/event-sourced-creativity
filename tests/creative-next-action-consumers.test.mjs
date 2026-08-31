import assert from "node:assert/strict";
import test,{after} from "node:test";
import { lifecyclePage, lifecycleButton, activateLifecycle } from "./helpers/creative-next-action-navigation-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { withProjectTaskDocumentInRoute } from "../src/model/routes.ts";
const originalFetch=globalThis.fetch;let external=0;
globalThis.fetch=async()=>{external++;throw Error("No external/provider transport in lifecycle opening controls");};
after(()=>{assert.equal(external,0);globalThis.fetch=originalFetch;});
const classed=(node,value)=>String(node.attributes?.class??"").split(/\s/u).includes(value);
const action=(f,kind)=>{const found=f.actions().find(value=>value.target.kind===kind);assert.ok(found,"actual resolver offers "+kind);return found;};
const dialogs=f=>f.tree().visible("dialog").filter(value=>value.port?.open);

for(const route of["/projects","/library","/activity"])test("actual "+route+" scoped card opens the existing exact Document chooser without authoring",async t=>{
  const f=await lifecyclePage(t,{route}),document=f.store.projection.get().documents.find(value=>value.id===f.documentId);
  const names=f.tree().visible("bdi").map(value=>value.text);assert.ok(names.includes(document.title));
  const chosen=action(f,"configure"),button=lifecycleButton(f,chosen.id);
  const source=JSON.stringify(f.store.events.get()),selected=f.store.ui.selectedOutputId;
  activateLifecycle(f,button);for(let attempt=0;attempt<8;attempt++)await f.settle();
  assert.equal(f.store.projection.get().documentId,f.documentId);
  const chooser=dialogs(f).filter(value=>classed(value,"next-format-dialog"));assert.equal(chooser.length,1);
  assert.equal(chooser[0].owner.tag,"forma-workspace");assert.equal(f.store.ui.selectedOutputId,selected);
  assert.equal(JSON.stringify(f.store.events.get()),source);
});

test("Activity preserves the actual owned private note instead of unmounting it for a recommendation",async t=>{
  const f=await lifecyclePage(t,{route:"/activity",mode:"job"}),panel=f.components().find(value=>value.tag==="forma-activity-issue-panel"&&value.job?.jobId===f.jobId);
  assert.ok(panel);assert.equal(panel.navigationBlocked,false);
  const editor=f.renderer.ownNodes(panel,"textarea").find(value=>value.handlers.input?.toString().includes("#noteDraft"));assert.ok(editor);
  const details=f.renderer.ownNodes(panel,"details").find(value=>value.classList.contains("forma-activity-issue-notes"));assert.ok(details);
  details.open=true;
  editor.value="Original unsent issue note";editor.handlers.input.call(panel,{target:editor,currentTarget:editor});
  assert.equal(panel.navigationBlocked,true);
  const route=f.store.route.get(),chosen=action(f,"job");activateLifecycle(f,lifecycleButton(f,chosen.id));await f.settle();
  assert.equal(f.store.route.get(),route);assert.ok(panel.isConnected);
  assert.equal(f.renderer.ownNodes(panel,"textarea").find(value=>value.handlers.input)?.value,"Original unsent issue note");
  assert.equal(panel.navigationBlocked,true);f.sourceUnchanged();
});

test("Activity busy note read blocks departure, then a clean exact original-job inspection remains reachable",async t=>{
  const f=await lifecyclePage(t,{route:"/activity",mode:"job"}),panel=f.components().find(value=>value.tag==="forma-activity-issue-panel"&&value.job?.jobId===f.jobId);
  assert.ok(panel);const details=f.renderer.ownNodes(panel,"details").find(value=>value.classList.contains("forma-activity-issue-notes"));assert.ok(details);
  const previous=Object.getOwnPropertyDescriptor(globalThis,"HTMLDetailsElement"),NativeElement=details.constructor;
  Object.defineProperty(globalThis,"HTMLDetailsElement",{configurable:true,value:class{static[Symbol.hasInstance](value){return value instanceof NativeElement&&value.tag==="details";}}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,"HTMLDetailsElement",previous);else delete globalThis.HTMLDetailsElement;});
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),entry=new Promise(resolve=>{entered=resolve;});t.after(()=>release());
  f.storeHost.intercept=async request=>{
    if(request.url!=="/api/document-jobs/"+f.jobId+"/notes"||(request.init.method??"GET")!=="GET")return;
    const response=await f.storeHost.worker.request(request.url,request.init);assert.equal(response.status,200);
    entered();await gate;return response;
  };
  details.open=true;details.handlers.toggle.call(panel,{currentTarget:details});await entry;
  assert.equal(panel.navigationBlocked,true);const route=f.store.route.get(),chosen=action(f,"job");
  activateLifecycle(f,lifecycleButton(f,chosen.id));await f.settle();assert.equal(f.store.route.get(),route);
  release();await f.settle();assert.equal(panel.navigationBlocked,false);
  activateLifecycle(f,lifecycleButton(f,chosen.id));for(let attempt=0;attempt<8;attempt++)await f.settle();
  assert.ok(dialogs(f).some(value=>classed(value,"generation-input-dialog")),"same original job inspector, not a replacement request");
  f.sourceUnchanged();
});

test("Library keeps its real typed block editor through recommendation-fact updates",async t=>{
  const f=await lifecyclePage(t,{route:"/library",mode:"library"});
  const link=f.tree().visible("button").find(value=>value.attributes["data-context-controls-id"]==="lifecycle-library");
  assert.ok(link,"existing exact editable Library block entry");await f.act(link);
  const editor=f.components().find(value=>value.tag==="forma-library-block-editor");assert.ok(editor);
  const input=f.tree().visible("textarea").find(value=>value.owner.tag==="forma-ui-rich-text"&&value.owner.closest("forma-library-block-editor")===editor);assert.ok(input);
  input.port.value="Unsent exact Library text";await f.act(input,"input");
  f.store.notify();await f.settle();
  assert.strictEqual(f.components().find(value=>value.tag==="forma-library-block-editor"),editor);
  assert.ok(f.tree().visible("textarea").some(value=>value.port?.value==="Unsent exact Library text"));
  assert.equal(f.tree().visible("section").filter(value=>classed(value,"lifecycle-next-actions")).length,0,"no competing primary group is inserted inside an owned editor");
  f.sourceUnchanged();
});

// F reach additions: actual mounted origin and second native choice, not a
// helper-only bridge invocation. EN representative media, not a locale/format
// Cartesian matrix or physical/AT reach certificate.
const twoChoicePaths = [
  { route: "/projects", tag: "forma-projects", medium: "image", withdrawal: "source" },
  { route: "/library", tag: "forma-library", medium: "short_story", withdrawal: "reader" },
  { route: "/activity", tag: "forma-activity", medium: "video", withdrawal: "route" },
];
const withinTwoChoice = (node, ancestor) => { for (let at = node; at; at = at.parent) if (at === ancestor || ancestor.port && at.port === ancestor.port) return true; return false; };
const onlyTwoChoice = (rows, message) => { assert.equal(rows.length, 1, message); return rows[0]; };
async function settleTwoChoice(f, resume) {
  // Reuse the existing finite component and Store RAF ports. Deliver only the
  // real 16ms RAF callbacks, not cost/provider/warm-up timeout callbacks.
  for (let attempt = 0; attempt < 8; attempt++) {
    await f.settle();
    for (const [id, timer] of [...f.storeHost.timers]) if (timer.delay === 16) {
      f.storeHost.timers.delete(id); timer.callback(0);
    }
    await resume.settleOriginalRequests();
    await new Promise(setImmediate);
  }
  assert.equal(resume.pendingOriginalCount(), 0, "already-started original transports settled, without replay");
}
async function twoChoicePage(t, route) {
  const storeHost = await createSceneStoreHost({ exposeSceneTestAccessors: false });
  const resume = observeActualSceneResumeReads(storeHost);
  // Register before lifecyclePage's existing Worker close hook. This observer
  // forwards the original transport once and never substitutes a response.
  t.after(async () => { await resume.settleOriginalRequests(); resume.restore(); });
  const f = await lifecyclePage(t, { route, storeHost });
  await settleTwoChoice(f, resume);
  assert.equal(f.store.route.get(), withProjectTaskDocumentInRoute(route, f.documentId), "navigation count begins at the loaded ordinary surface");
  assert.equal(f.storeHost.intercept, null, "no synthetic successful HTTP interception");
  return { f, resume };
}
function certifiedTwoChoiceReads(f, resume) {
  const writes = f.storeHost.requests.filter(row => (row.init.method ?? "GET") !== "GET");
  assert.ok(writes.length > 0, "mounted Workspace performed its genuine existing Resume read");
  assert.ok(writes.every(row => resume.isReadOnlyResume(row)), "every non-GET is the exact original certified read, not a URL exemption");
  const observations = resume.observations();
  assert.ok(observations.length > 0);
  for (const row of observations) {
    assert.deepEqual(row.scope, { projectId: f.projectId, documentId: f.documentId });
    assert.equal(row.responseStatus, 200); assert.equal(row.responseStatusValue, "none");
    assert.equal(row.exactNone && row.sqliteUnchanged && row.inputUnchanged && row.dispatchOwned && row.classified, true);
    assert.equal(row.sqliteChangesAfter, row.sqliteChangesBefore);
    assert.equal(row.clonedOuterRowClassified, false, "a copied request is not the observed original");
  }
}
async function openTwoChoiceChooser(f, resume, path, choices) {
  const origin = onlyTwoChoice(f.components().filter(host => host.tag === path.tag), "one current origin component");
  const chosen = action(f, "configure"), button = lifecycleButton(f, chosen.id);
  assert.equal(chosen.target.medium, null, "ordinary generic preparation, not an authored explicit-medium shortcut");
  assert.equal(chosen.target.projectId, f.projectId); assert.equal(chosen.target.documentId, f.documentId);
  assert.equal(chosen.target.canvasId, null); assert.equal(button.owner.tag, "forma-ui-choice-card");
  let belongs = false; for (let at = button.parent; at; at = at.parent) if (at.component === origin) belongs = true;
  assert.equal(belongs, true, "the first visible native choice belongs to the stated ordinary origin");
  assert.ok(button.port?.isConnected && button.owner.isConnected);
  const target = JSON.stringify(chosen.target);
  choices.push({ origin: path.route, value: button.attributes["data-choice-value"] });
  f.native.emit("pointerdown", button.port); f.native.focus(button.port); activateLifecycle(f, button);
  await settleTwoChoice(f, resume);
  const chooser = onlyTwoChoice(dialogs(f).filter(node => classed(node, "next-format-dialog")), "one actual current format chooser after the first choice");
  assert.equal(dialogs(f).length, 1); assert.equal(chooser.owner.tag, "forma-workspace");
  assert.equal(chooser.owner.store, f.store); assert.ok(chooser.owner.isConnected);
  const formats = f.tree().visible("button").filter(node => withinTwoChoice(node, chooser) && node.owner.tag === "forma-ui-choice-card");
  assert.deepEqual(formats.map(node => node.attributes["data-choice-value"]), ["image", "short_story", "scene", "slides", "storyboard", "video", "audio"]);
  const second = onlyTwoChoice(formats.filter(node => node.attributes["data-choice-value"] === path.medium), "one exact visible second format choice");
  assert.equal(JSON.stringify(chosen.target), target, "opening did not rewrite the original descriptor");
  return { chosen, target, chooser, second };
}

for (const path of twoChoicePaths) test("F ordinary " + path.route + " reaches exact " + path.medium + " settings in two native choices", { concurrency: false, timeout: 45_000 }, async t => {
  const { f, resume } = await twoChoicePage(t, path.route), choices = [];
  const source = f.store.captureSourceOwnership(), authority = f.store.captureAuthorizationScope();
  assert.ok(source && authority && f.store.routeDataReady());
  const original = JSON.stringify(f.store.events.get()), selected = f.store.ui.selectedOutputId, actor = f.store.session.get().user.userId;
  const opened = await openTwoChoiceChooser(f, resume, path, choices);
  choices.push({ origin: "current Document chooser", value: opened.second.attributes["data-choice-value"] });
  f.native.emit("pointerdown", opened.second.port); f.native.focus(opened.second.port); activateLifecycle(f, opened.second);
  await settleTwoChoice(f, resume);
  assert.deepEqual(choices.map(row => row.value), [opened.chosen.id, path.medium], "count both native choices from the original loaded surface");
  assert.equal(choices.length, 2);
  const expectedClass = path.medium === "image" ? "generation-details-dialog" : "document-artifact-create";
  const settings = onlyTwoChoice(dialogs(f).filter(node => classed(node, expectedClass)), "second choice opens the existing exact settings");
  assert.equal(dialogs(f).length, 1, "no extra chooser, confirmation or alternate configuration");
  assert.equal(settings.owner.tag, path.medium === "image" ? "forma-generation-actions" : "forma-document-artifacts");
  assert.equal(settings.owner.store, f.store); assert.equal(settings.owner.source, "document"); assert.ok(settings.owner.isConnected);
  const tree = f.tree(), workspace = onlyTwoChoice(f.components().filter(host => host.tag === "forma-workspace"), "one actual Workspace receiver");
  assert.strictEqual(settings.owner.closest("forma-workspace"), workspace);
  assert.ok(f.native.nativeFocus.some(row => row.node?.owner === workspace && row.node.getAttribute?.("data-workbench-pane") === "result"), "same exact Workspace Result pane was reached");
  if (path.medium === "image") {
    assert.equal(tree.nodes.filter(node => node.tag === "forma-image-format-editor" && withinTwoChoice(node, settings) && node.component?.isConnected).length, 1);
    assert.ok(tree.visible("button").some(node => withinTwoChoice(node, settings) && /^Generate full/u.test(node.text)), "generation remains a separate unactivated action");
    const mode = onlyTwoChoice(tree.visible("input").filter(node => withinTwoChoice(node, settings) && node.attributes.type === "checkbox" && classed(node.parent, "generation-production-mode")), "existing local image configuration");
    const next = !mode.port.checked; mode.port.checked = next; await f.act(mode, "change");
    f.store.notify(); await settleTwoChoice(f, resume);
    const current = onlyTwoChoice(dialogs(f).filter(node => classed(node, expectedClass)), "current image settings remain open after a local edit");
    assert.strictEqual(current.owner, settings.owner);
    assert.equal(onlyTwoChoice(f.tree().visible("input").filter(node => withinTwoChoice(node, current) && node.attributes.type === "checkbox" && classed(node.parent, "generation-production-mode")), "same local mode control").port.checked, next);
  } else {
    assert.equal(settings.owner.documentId, f.documentId);
    const kinds = tree.visible("input").filter(node => withinTwoChoice(node, settings) && node.attributes.name === "artifact-kind");
    assert.equal(kinds.length, 6); assert.deepEqual(kinds.filter(node => node.port.checked).map(node => node.port.value), [path.medium]);
    assert.ok(tree.visible("button").some(node => withinTwoChoice(node, settings) && (node.attributes.type ?? "submit") === "submit"), "submission remains a separate unactivated action");
    const audience = onlyTwoChoice(tree.visible("input").filter(node => withinTwoChoice(node, settings) && node.attributes.list === "document-artifact-audiences-" + f.documentId.replace(/[^a-z0-9_-]/gi, "-")), "existing raw audience field");
    const raw = "  Unsent " + path.route + " audience  "; audience.port.value = raw; await f.act(audience, "input");
    f.store.notify(); await settleTwoChoice(f, resume);
    const current = onlyTwoChoice(dialogs(f).filter(node => classed(node, expectedClass)), "settings remain open after a raw local edit");
    assert.strictEqual(current.owner, settings.owner);
    assert.equal(onlyTwoChoice(f.tree().visible("input").filter(node => withinTwoChoice(node, current) && node.attributes.list === audience.attributes.list), "same raw audience field").port.value, raw);
  }
  assert.equal(f.store.projection.get().projectId, f.projectId); assert.equal(f.store.projection.get().documentId, f.documentId);
  assert.equal(f.store.session.get().user.userId, actor); assert.equal(f.store.ui.selectedOutputId, selected);
  assert.equal(f.store.sourceOwnershipActive(source), true); assert.equal(f.store.authorizationScopeActive(authority), true);
  assert.equal(JSON.stringify(opened.chosen.target), opened.target); assert.equal(JSON.stringify(f.store.events.get()), original);
  certifiedTwoChoiceReads(f, resume); f.sourceUnchanged();
  t.diagnostic("F_TWO_CHOICE " + JSON.stringify({ route: path.route, medium: path.medium, navigationChoices: choices, reachedSettings: expectedClass, localDraftRetained: true, generated: false, originalResumeReads: resume.observations().length }));
});

for (const path of twoChoicePaths) test("F ordinary " + path.route + " retired " + path.withdrawal + " chooser cannot open old " + path.medium + " settings", { concurrency: false, timeout: 45_000 }, async t => {
  const { f, resume } = await twoChoicePage(t, path.route), choices = [];
  const opened = await openTwoChoiceChooser(f, resume, path, choices);
  if (path.withdrawal === "source") f.appendEvent("BlockPropertyEdited", { block_id: "lifecycle-direction", property_path: "text", old_value: "Exact authored direction for this Document", new_value: "Newer authored direction stays current" });
  else if (path.withdrawal === "reader") {
    const session = f.store.session.get();
    f.store.session.set({ ...session, projectContext: { organizationId: "synthetic-org", projectAccessId: "synthetic-access", projectId: f.projectId, ownerUserId: session.user.userId, role: "viewer", permissions: ["project.read"], expiresAt: new Date(Date.now() + 3600_000).toISOString() } });
  } else f.store.setRoute("/library");
  await settleTwoChoice(f, resume);
  const currentSource = JSON.stringify(f.store.events.get()), currentSession = JSON.stringify(f.store.session.get()), currentRoute = f.store.route.get(), traceStart = f.trace.length;
  // This was a genuine visible native second choice. After retirement only its
  // retained callback is exercised; this is not a trusted physical click claim.
  await f.act(opened.second); await settleTwoChoice(f, resume);
  assert.equal(dialogs(f).filter(node => classed(node, "generation-details-dialog") || classed(node, "document-artifact-create")).length, 0);
  assert.equal(f.trace.slice(traceStart).filter(value => value.startsWith("open:") && (value.includes("generation-details-dialog") || value.includes("document-artifact-create"))).length, 0, "no transient obsolete settings promotion");
  assert.equal(JSON.stringify(f.store.events.get()), currentSource); assert.equal(JSON.stringify(f.store.session.get()), currentSession);
  assert.equal(f.store.route.get(), currentRoute); assert.equal(JSON.stringify(opened.chosen.target), opened.target);
  if (path.withdrawal === "reader") assert.deepEqual(f.store.session.get().projectContext.permissions, ["project.read"]);
  certifiedTwoChoiceReads(f, resume);
  t.diagnostic("F_TWO_CHOICE_RETIRED " + JSON.stringify({ route: path.route, medium: path.medium, withdrawal: path.withdrawal, firstVisibleChoice: choices[0], currentRoute, oldSettingsOpened: false, generated: false }));
});
