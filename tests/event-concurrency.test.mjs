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
  assert.match(store,/response\.status===409&&body\.error==="stale_sequence"/);
  assert.match(store,/await this\.#refreshEvents\(\);this\.#assertAuthorizationScope\(authorization\);continue/);
  assert.match(store,/rebaseAttempts\?\?2/);
  assert.match(store,/action:"canvas_sync"/);
  assert.match(store,/stageOptimisticCanvasEvents/);
  assert.match(store,/#appendPipeline/);
  assert.match(store,/this\.#appendPipeline\.then\(\(\)=>this\.#scopeStillActive\(authorization\)\?this\.#appendBatchNow\(events,options,authorization\):\[\]\)/);
  assert.match(store,/const persisted=this\.append\(\{type:"DocumentOpened"/);
  assert.match(store,/background:true\}\);const committed=persisted\.then\(\(events\)=>events\.length>0,\(\)=>false\);this\.#navigationCommit=committed;this\.setRoute\(routedDestination\)/);
  assert.match(runtime,/sequence>\? ORDER BY sequence ASC LIMIT \?/);
  assert.match(runtime,/while\(events\.length<requested\)/);
  assert.match(eventsApi,/readEventPageWithHead\(env,streamId,after,limit\)/);
  assert.match(runtime,/export async function readEventPageWithHead/);
  assert.match(eventsApi,/streamHead\(env,streamId\)/);
  assert.match(store,/#readEventPages\(after=0\)/);
  assert.match(store,/hasMore&&next<=cursor/);
});

test("project navigation remains interactive and commits before competing telemetry or paid work",async()=>{
  const store=await readFile(new URL("../src/state/store.ts",import.meta.url),"utf8");

  assert.match(store,/const persisted=this\.append\(input,\{rebaseAttempts:6,silent:true,background:true\}\);const committed=persisted\.then/);
  assert.match(store,/if\(!options\.background\)this\.busy\.set\(events\[0\]\?\.type/);
  assert.match(store,/finally \{if\(this\.#scopeStillActive\(authorization\)\)\{if\(!options\.background\)this\.busy\.set\(""\)/);
  assert.match(store,/if\(!options\.keepalive\)await this\.#appendPipeline;/);
  assert.match(store,/this\.#jobStarts\.add\(requestKey\);this\.notify\(\);\}try\{const navigation=this\.#navigationCommit;await this\.#appendPipeline;/);
  assert.match(store,/if\(navigation&&!await navigation\)throw new Error/);
  assert.match(store,/if\(!appended\.length\)\{this\.setRoute\(previousRoute,\{replace:true\}\)/);
});

test("document dialogs preserve their target document across background event refreshes",async()=>{
  const [store,workspace]=await Promise.all([
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-workspace.ts",import.meta.url),"utf8"),
  ]);
  assert.match(store,/const events=this\.eventView\.get\(\)/);
  assert.match(store,/foldEvents\(events, this\.asOf\.get\(\), isDocumentViewRoute\(route\) \? documentIdFromRoute\(route\)/);
  assert.match(workspace,/documentId:projection\.documentId/);
  assert.match(workspace,/document_id:draft\.documentId/);
  assert.match(workspace,/document_id:documentId/);
  assert.match(workspace,/rebaseAttempts:6/);
});
