import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function appendOperationWrapper(appendEvents, execution) {
  const text = await readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8");
  const source = ts.createSourceFile("events-api.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let declaration;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "appendOperationEvents") declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(declaration?.initializer, "exercise the actual append wrapper, not a reimplemented test helper");
  const compiled = ts.transpileModule(`const appendOperationEvents = ${declaration.initializer.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function("appendEvents", "execution", `${compiled}\nreturn appendOperationEvents;`)(appendEvents, execution);
}

function storeMemberSource(text, name) {
  const source = ts.createSourceFile("store.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const store = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaStore");
  const member = store?.members.find(node => node.name?.getText(source) === name);
  assert.ok(member, "inspect the actual Store member: " + name);
  // Structural comparisons only: this whitespace-normalized source is never executed.
  return member.getText(source).replace(/\s+/gu, "");
}

test("hot-path appends and generation receipts use the atomic head allocator",async()=>{
  const runtime=await readFile(new URL("../worker/runtime.ts",import.meta.url),"utf8");
  const eventsApi=await readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8");
  assert.match(runtime,/WHERE \(SELECT COALESCE\(MAX\(sequence\),0\) FROM events WHERE stream_id=\?\)=\?/);
  assert.match(eventsApi,/appendOperationEvents\(env,appended,\{\.\.\.\(commutative\?\{\}:\{expectedHead:current\}\)\}\)/);
  assert.match(eventsApi,/appendOperationEvents\(env,\[\.\.\.registryEvents,requestedAt,compiled,budgeted\]\)/);
  assert.match(eventsApi,/appendOperationEvents\(env,\[complete,usage\]\)/);
  assert.match(eventsApi,/if\(!execution\?\.output\)return appendEvents\(environment,events,options\)/);
  assert.match(runtime,/event_client_receipts/);
  assert.match(runtime,/appendEventsWithClientReceipts/);
  assert.match(eventsApi,/body\.action==="canvas_sync"/);
  assert.match(eventsApi,/readEventsByClientEventIds/);
});

test("the real append wrapper preserves legacy head allocation and adds Output custody without dropping the expected head", async () => {
  const environment = {}, events = [{ eventId: "exact-event", sequence: 12 }], options = { expectedHead: 11, retries: 7 };
  const calls = [], committed = [{ eventId: "exact-event", sequence: 12 }];
  const append = async (...args) => { calls.push(args); return committed; };
  const legacy = await appendOperationWrapper(append, undefined);
  assert.equal(await legacy(environment, events, options), committed);
  assert.equal(calls[0][0], environment);
  assert.equal(calls[0][1], events);
  assert.equal(calls[0][2], options, "legacy optimistic head checks and retry policy are passed unchanged");

  const output = { eventWriteSidecars() {}, eventWriteCommitted() {}, eventAppendCommitted() { throw new Error("unexpected recovery"); } };
  const native = await appendOperationWrapper(append, { output });
  assert.equal(await native(environment, events, options), committed);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], environment);
  assert.equal(calls[1][1], events);
  assert.deepEqual(calls[1][2], { ...options, retries: 1, initialHead: 11,
    prepareSidecars: output.eventWriteSidecars, onSidecarsCommitted: output.eventWriteCommitted });
});

test("the real Output append wrapper recovers an exact lost acknowledgment without appending again", async () => {
  const environment = {}, events = [{ eventId: "exact-event", sequence: 12 }];
  let writes = 0, checks = 0;
  const native = await appendOperationWrapper(async () => { writes++; throw new Error("write_acknowledgment_lost"); }, {
    output: { async eventAppendCommitted(actual) { checks++; assert.equal(actual, events); return true; } },
  });
  assert.equal(await native(environment, events, { expectedHead: 11 }), events);
  assert.equal(writes, 1);
  assert.equal(checks, 1);
});

test("the real Output append wrapper cannot reinterpret a failed guard or unproven write as committed", async () => {
  for (const [message, expectedChecks] of [["CHECK constraint failed", 0], ["write_acknowledgment_lost", 1]]) {
    let writes = 0, checks = 0;
    const failure = new Error(message);
    const native = await appendOperationWrapper(async () => { writes++; throw failure; }, {
      output: { async eventAppendCommitted() { checks++; return false; } },
    });
    await assert.rejects(native({}, [{ eventId: "exact-event", sequence: 12 }], { expectedHead: 11 }), (error) => error === failure);
    assert.equal(writes, 1, "no implicit second append is permitted");
    assert.equal(checks, expectedChecks);
  }
});

test("the client refreshes and rebases authored appends after stale heads",async()=>{
  const [store,runtime,eventsApi]=await Promise.all([
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/runtime.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
  ]);
  const append = storeMemberSource(store,"#appendBatchNow"), pipeline = storeMemberSource(store,"appendBatchWithReceipt"), opening = storeMemberSource(store,"openDocument");
  assert.match(append,/consterror=body&&typeofbody==="object"&&!Array\.isArray\(body\)\?String\(\(bodyasRecord<string,unknown>\)\.error\?\?""\):""/);
  assert.match(append,/response\.status===409&&error==="stale_sequence"&&options\.expected===undefined&&attempt<attempts-1/);
  assert.match(append,/constsource=observation\.source,active=\(\)=>this\.sourceOwnershipActive\(source\)&&!observation\.paused/);
  assert.match(append,/awaitthis\.#refreshEvents\(\);if\(!active\(\)\)returnthis\.#finishEventWrite\(observation,\{outcome:"unconfirmed",privateUnavailable:true\},\[\],"withheld",options\);continue/, "a stale-head retry cannot cross source retirement");
  assert.match(store,/rebaseAttempts\?\?2/);
  assert.match(store,/action:"canvas_sync"/);
  assert.match(store,/stageOptimisticCanvasEvents/);
  assert.match(store,/#appendPipeline/);
  assert.match(pipeline,/retained=JSON\.parse\(JSON\.stringify\(events\)\)asEventInput\[\]/, "the admitted append owns a copy rather than later caller mutations");
  assert.match(pipeline,/constadmission=awaitthis\.#admitEventWrite\(retained,retained\.length>1\?"batch":"append",options\.expected\),observation=admission\.observation/);
  assert.match(pipeline,/constpending=this\.#appendPipeline\.then\(\(\)=>this\.#appendBatchNow\(retained,options,observation\)\)/);
  assert.match(append,/if\(!active\(\)\)returnthis\.#finishEventWrite\(observation,\{outcome:"not-attempted",privateUnavailable:true\},\[\],"withheld",options\)/);
  assert.match(opening,/constpersisted=this\.appendWithReceipt\(\{type:"DocumentOpened"/);
  assert.match(opening,/background:true\}\);constcommitted=persisted\.then\(result=>result\.acknowledgment\.outcome==="observed"&&result\.acknowledgment\.committed\.some\(event=>event\.type==="DocumentOpened"\),\(\)=>false\);this\.#navigationCommit=committed;constopened=navigate\(\)/, "only the exact observed navigation acknowledgment resolves the commit fence");
  assert.match(opening,/constownsHandoff=Boolean\(options\.onOriginHandoff\);if\(options\.onOriginHandoff&&\(!workspaceNavigationCurrent\(options\)\|\|!options\.onOriginHandoff\(\)\)\)returnfalse;if\(options\.onOriginHandoff\)options=\{\.\.\.options,onOriginHandoff:undefined\}/, "the optional origin handoff is current and consumed before navigation");
  assert.match(opening,/if\(ownsHandoff&&applicationIdFromRoute\(this\.route\.get\(\)\)!==applicationIdFromRoute\(routedDestination\)\)returnthis\.transitionWorkspace\(routedDestination,options\);this\.setRoute\(routedDestination,options\);returnnull;\};/, "navigation delegates with the same lease and retains the original direct-route fallback");
  assert.match(opening,/constresult=awaitpersisted;if\(this\.#navigationCommit===committed\)this\.#navigationCommit=null;/, "only the settled original can clear its own commit fence");
  assert.match(opening,/returnopened\?awaitopened:true;\}$/, "the guarded cross-audience transition is awaited independently of the original acknowledgment");
  assert.match(runtime,/sequence>\? ORDER BY sequence ASC LIMIT \?/);
  assert.match(runtime,/while\(events\.length<requested\)/);
  assert.match(eventsApi,/readEventPageWithHead\(env,streamId,after,limit\)/);
  assert.match(runtime,/export async function readEventPageWithHead/);
  assert.match(eventsApi,/streamHead\(env,streamId\)/);
  assert.match(storeMemberSource(store,"#readEventPages"),/#readEventPages\(after=0,read\?:EventSourceRead\)\{returnthis\.#readEventStream\(after,"full",after===0,read\);\}/);
  assert.match(store,/hasMore&&next<=cursor/);
});

test("project navigation remains interactive and commits before competing telemetry or paid work",async()=>{
  const store=await readFile(new URL("../src/state/store.ts",import.meta.url),"utf8");

  const opening=storeMemberSource(store,"openProject"),append=storeMemberSource(store,"#appendBatchNow");
  assert.match(opening,/constpersisted=this\.appendWithReceipt\(input,\{rebaseAttempts:6,silent:true,background:true\}\);constcommitted=persisted\.then/);
  assert.match(opening,/result\.acknowledgment\.outcome==="observed"&&result\.acknowledgment\.committed\.some\(event=>event\.type==="ProjectOpened"&&event\.clientEventId===clientEventId\)/);
  assert.match(opening,/this\.optimisticEvents\.set\(\[\.\.\.this\.optimisticEvents\.get\(\),optimistic\]\)/);
  assert.match(store,/if\(!options\.background\)this\.busy\.set\(events\[0\]\?\.type/);
  assert.match(append,/finally\{if\(this\.sourceOwnershipScopeActive\(source\)\)\{if\(!options\.background\)this\.busy\.set\(""\)/, "only the original scope owns foreground busy cleanup");
  assert.match(store,/if\(!options\.keepalive\)await this\.#appendPipeline;/);
  assert.match(store,/this\.#jobStarts\.add\(requestKey\);this\.notify\(\);\}try\{const navigation=this\.#navigationCommit;await this\.#appendPipeline;/);
  assert.match(store,/if\(navigation&&!await navigation\)throw new Error/);
  assert.match(opening,/if\(!result\.appended\.length\)\{if\(current\(\)\)\{this\.setRoute\(previousRoute,\{replace:true\}\)/, "a late failure cannot roll back newer navigation");
  assert.match(opening,/constcurrent=\(\)=>this\.sourceOwnershipActive\(sourceOwner\)&&this\.authorizationScopeActive\(authorization\)&&this\.#workspaceTransition===revision&&this\.route\.get\(\)===route&&workspaceNavigationCurrent\(options\)/);
});

test("document dialogs preserve their target document across background event refreshes",async()=>{
  const [store,workspace]=await Promise.all([
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-workspace.ts",import.meta.url),"utf8"),
  ]);
  const projection=storeMemberSource(store,"projection");
  assert.match(projection,/constcanvasId=canvasIdFromRoute\(route\)\?\?"",events=this\.eventView\.get\(\)/, "the projection still includes optimistic events");
  assert.match(projection,/taskDocumentId=projectTaskDocumentIdFromRoute\(route\)/);
  assert.match(projection,/foldEvents\(events,this\.asOf\.get\(\),isDocumentViewRoute\(route\)\?documentIdFromRoute\(route\)\?\?"":taskDocumentId\?\?"",canvasId\?canvasProjectId\(events,canvasId\):""\)/);
  assert.match(projection,/if\(!readable\|\|taskDocumentId!==null&&\(!taskDocumentId\|\|projection\.documentId!==taskDocumentId\)\)/, "a claimed task Document cannot silently become another history Document");
  assert.match(workspace,/documentId:projection\.documentId/);
  assert.match(workspace,/document_id:draft\.documentId/);
  assert.match(workspace,/document_id:documentId/);
  assert.match(workspace,/rebaseAttempts:6/);
});
