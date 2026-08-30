// Actual full Projects/Shell/Store plus routed Worker/RAM SQLite; finite native
// event ports only. No browser or synthetic-response success certificate.
import assert from "node:assert/strict";
import { createSceneCostFixture } from "./scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./scene-cost-store-host.mjs";
import { createCalmFullPage } from "./calm-full-page-fixture.mjs";
import { financial } from "./event-source-retirement-fixture.mjs";
import { readWorkspaceEvents } from "../../worker/runtime.ts";
export {sceneDeferred,untilScene,readWorkspaceEvents};

export const AUTHORED = Object.freeze({ name: "Retained intake baseline", documentTitle: "Authored intake document", objective: "Explain the retained original intent." });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const isIntake = request => request.url === "/api/events" && request.init.method === "POST"
  && request.body?.action === "project_intake" && request.body?.events?.some(event => event.type === "ProjectCreated" && event.payload?.name === AUTHORED.name);
export const identity = event => ({ eventId: event.eventId ?? null, type: event.type, sequence: event.sequence ?? null,
  projectId: event.payload?.project_id ?? null, documentId: event.payload?.document_id ?? null,
  blockId: event.payload?.block_id ?? null, clientEventId: event.payload?.client_event_id ?? null });
export function intendedIds(events) {
  const project = events.find(event => event.type === "ProjectCreated"), document = events.find(event => event.type === "DocumentCreated");
  assert.ok(project && document, "Actual complete builder includes both original resources");
  assert.match(project.payload.project_id, UUID); assert.match(document.payload.document_id, UUID);
  assert.equal(document.payload.project_id, project.payload.project_id);
  return { projectId: project.payload.project_id, documentId: document.payload.document_id };
}
export async function createProjectIntakeFixture(t, {locale="en"}={}) {
  let externalAttempts=0;
  t.mock.method(globalThis,"fetch",async()=>{externalAttempts++;assert.fail("No external/provider request in intake fixtures");});
  // Default depth=false: no SQL compiler child. Existing D1 binding limits remain.
  const worker = await createSceneCostFixture(1, "visual", { shared: false });
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  assert.equal(h.transport, null); assert.equal(h.intercept, null);
  assert.equal(typeof h.store.sceneGateForTest, "undefined", "No added private Store accessor");
  assert.equal(h.store.session.get().projectContext, undefined, "Projects creation is the actual personal-owner surface");
  const originalAppend = h.store.appendBatch, originalReceiptAppend = h.store.appendBatchWithReceipt;
  const oldHistory = globalThis.history, money = financial(worker);
  globalThis.history = {
    pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href }); },
    replaceState(...args) { this.pushState(...args); },
  };
  h.store.loading.set(false);
  // This is the existing navigationPage reuse pattern: the renderer's 14-block
  // presentation sample is never submitted or claimed as canonical evidence.
  const actual = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(), session: h.store.session.get() };
  t.after(async () => {
    try {
      assert.deepEqual(financial(worker), money, "All original jobs/reservations/counters/provider/authoring-execution rows stay unchanged");
      assert.equal(h.requests.filter(request => request.url.startsWith("/api/document-jobs") && request.init.method === "POST").length, 0,
        "The fixture's document-job transport substitute is never reached");
      assert.equal(h.store.appendBatchWithReceipt, originalReceiptAppend, "Actual receipt/append semantics are untouched");
      assert.equal(externalAttempts, 0);
    } finally { globalThis.history = oldHistory; await h.close(); }
  });
  const f = await createCalmFullPage(t, { locale, storeHost: h });
  h.store.events.set(actual.events); h.store.head.set(actual.head); h.store.content.set(actual.content); h.store.session.set(actual.session);
  h.store.setRoute("/projects"); await f.settle();
  assert.equal(h.store.route.get(), "/projects");
  assert.equal(h.store.events.get().some(event => event.eventId.startsWith("synthetic-study-")), false);
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), true, "Actual current personal Source ownership");
  const owners = f.components().filter(component => component.tag === "forma-projects");
  assert.equal(owners.length, 1, "One complete actual routed Projects owner");
  const owner = owners[0], Projects = f.modules.get("src/components/forma-projects.ts")?.FormaProjects;
  assert.equal(typeof Projects, "function"); assert.equal(owner instanceof Projects, true);
  const beforeEvents = await readWorkspaceEvents(worker.env, worker.streamId), beforeIds = new Set(beforeEvents.map(event => event.eventId));
  const baseline = { events: beforeEvents.length, projects: beforeEvents.filter(event => event.type === "ProjectCreated").length,
    documents: beforeEvents.filter(event => event.type === "DocumentCreated").length };
  const notifications = [], dispatches = [];
  const unsubscribe = h.store.subscribe(() => {
    const value = { route: h.store.route.get(), toast: h.store.ui.toast, appendFailure: h.store.appendFailure.get(), busy: h.store.busy.get() };
    if (JSON.stringify(value) !== JSON.stringify(notifications.at(-1))) notifications.push(value);
  });
  t.after(unsubscribe);
  let behavior = async () => {};
  h.intercept = async request => {
    if (!isIntake(request)) return;
    const row = { ordinal: dispatches.length + 1, body: structuredClone(request.body), request, status: null, reply: null, dropped: false };
    dispatches.push(row);
    await behavior("before-worker", row);
    const response = await worker.request(request.url, request.init);
    row.status = response.status; row.reply = await response.clone().json();
    // Observe the genuine response via a clone; forward the SAME response.
    // This adds observation latency but does not replace transport success.
    await behavior("after-worker", row);
    return response;
  };
  const form = () => f.find("form", node => node.owner === owner && node.attributes.class === "modal-card wide");
  const submitButton = () => f.find("button", node => { if(node.owner!==owner||node.attributes.class!=="button primary"||node.attributes.type==="button")return false; for(let parent=node.parent;parent;parent=parent.parent)if(parent.tag==="form"&&parent.attributes.class==="modal-card wide")return true; return false; });
  const field = label => f.find("input", node => node.owner.tag === "forma-ui-field" && node.owner.parentElement === owner && node.owner.label === label);
  const objective = () => f.find("textarea", node => node.owner === owner && node.attributes.maxlength === "1200");
  async function submit() {
    const button = submitButton(); assert.equal(Object.hasOwn(button.attributes, "disabled"), false, "Ordinary visible Submit is enabled");
    // Native-form event port, not a private-method call or a replacement builder.
    await f.act(form(), "submit", { submitter: button.port });
  }
  function visible() {
    const tree = f.tree(), modal = tree.visible("dialog").find(node => node.owner === owner && String(node.attributes.class).includes("project-create-dialog"));
    const present = Boolean(modal), currentForm = present ? form() : null, button = present ? submitButton() : null;
    return { route: h.store.route.get(), sameOwnerMounted: f.components().includes(owner), modal: present,
      submitting: currentForm?.attributes["aria-busy"] ?? null, submitEnabled: button ? !Object.hasOwn(button.attributes, "disabled") : false,
      editable: present ? !Object.hasOwn(field(f.i18n.t("projects.projectName","Project name")).attributes,"disabled") : false,
      draft: present ? { name: field(f.i18n.t("projects.projectName","Project name")).port.value, documentTitle: field(f.i18n.system("Document name")).port.value, objective: objective().port.value } : null,
      toast: h.store.ui.toast, appendFailure: h.store.appendFailure.get(), localHead: h.store.head.get() };
  }
  async function canonical() {
    const all = await readWorkspaceEvents(worker.env, worker.streamId), delta = all.filter(event => !beforeIds.has(event.eventId));
    const projects = delta.filter(event => event.type === "ProjectCreated"), documents = delta.filter(event => event.type === "DocumentCreated");
    return { baseline, totalEvents: all.length, totalProjects: all.filter(event => event.type === "ProjectCreated").length,
      totalDocuments: all.filter(event => event.type === "DocumentCreated").length, projects: projects.map(identity), documents: documents.map(identity),
      delta: delta.map(identity), objectiveBlocks: delta.filter(event => event.type === "BlockCreated" && event.payload?.properties?.text === AUTHORED.objective).map(identity),
      eventClientReceipts: worker.sqlite.prepare("SELECT COUNT(*) AS count FROM event_client_receipts WHERE stream_id=?").get(worker.streamId).count };
  }
  function requests() {
    return dispatches.map(row => ({ ordinal: row.ordinal, action: row.body.action, expectedSequence: row.body.expectedSequence,
      clientId: row.body.clientId, original: intendedIds(row.body.events), inputs: row.body.events.map(identity), status: row.status,
      error: row.reply?.error ?? null, head: row.reply?.head ?? null, appended: row.reply?.appended?.map(identity) ?? [],
      rejected: row.reply?.rejected ?? [], dropped: row.dropped }));
  }
  const open = f.find("button", node => node.owner.tag === "forma-ui-button" && node.owner.parentElement === owner && node.owner.label === f.i18n.t("projects.new","New project"));
  await f.act(open);
  for (const [label, value] of [[f.i18n.t("projects.projectName","Project name"), AUTHORED.name], [f.i18n.system("Document name"), AUTHORED.documentTitle]]) {
    const node = field(label); node.port.value = value; await f.act(node, "input");
  }
  const node = objective(); node.port.value = AUTHORED.objective; await f.act(node, "input");
  assert.deepEqual(visible().draft, AUTHORED); assert.equal(visible().submitEnabled, true);
  assert.equal(dispatches.length, 0, "Typing does not submit creation");
  return { h, f, owner, worker, originalAppend, beforeEvents, notifications, dispatches, form, submitButton, submit, visible, canonical, requests, field, objective,
    async check(){await f.act(f.find("button",node=>node.owner===owner&&node.text===f.i18n.t("projects.checkOriginal","Check original")));},
    async raw(events,mode="commit"){const response=await worker.request("/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"project_intake",intakeAction:mode,events})});return{response,body:await response.json()};},
    setBehavior(value) { behavior = value; } };
}

/** Test setup only: actual form/Store dispatch reaches a held transport; no
 * Worker request is made. The client remains honestly unconfirmed, never unused. */
export async function captureUnsentIntake(x){
  x.setBehavior(async stage=>{if(stage==="before-worker")throw Error("Synthetic transport rejection before RAM Worker");});
  await x.submit();
  assert.equal(x.dispatches.length,1);assert.equal(x.dispatches[0].status,null);
  assert.equal((await x.canonical()).projects.length,0);assert.equal(x.visible().modal,true);
  const events=structuredClone(x.dispatches[0].body.events);
  x.setBehavior(async()=>{});
  return events;
}

export function assertComplete(row){
  assert.equal(row.status,200);
  assert.equal(row.reply.status,"complete");
  assert.deepEqual(row.reply.rejected,[]);
  assert.deepEqual(row.body.events.map(event=>event.type),["ProjectCreated","DocumentCreated","EmptyCanvasChosen","BlockCreated"]);
  assert.equal(row.reply.appended.length,4);
  const original=intendedIds(row.body.events);
  assert.equal(row.reply.projectId,original.projectId);assert.equal(row.reply.documentId,original.documentId);
  assert.equal(row.reply.appended.every((event,index)=>event.actor==="user"&&event.payload.client_event_id===row.body.events[index].payload.client_event_id),true);
  return original;
}
