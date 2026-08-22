import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("hot-path appends and generation receipts use the atomic head allocator",async()=>{
  const runtime=await readFile(new URL("../worker/runtime.ts",import.meta.url),"utf8");
  const eventsApi=await readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8");
  assert.match(runtime,/WHERE \(SELECT COALESCE\(MAX\(sequence\),0\) FROM events WHERE stream_id=\?\)=\?/);
  assert.match(eventsApi,/appendEvents\(env,appended,\{\.\.\.\(commutative\?\{\}:\{expectedHead:current\}\)\}\)/);
  assert.match(eventsApi,/appendEvents\(env,\[\.\.\.registryEvents,requestedAt,compiled,budgeted\]\)/);
  assert.match(eventsApi,/appendEvents\(env,\[complete,usage\]\)/);
  assert.match(runtime,/event_client_receipts/);
  assert.match(runtime,/appendEventsWithClientReceipts/);
  assert.match(eventsApi,/body\.action==="canvas_sync"/);
  assert.match(eventsApi,/readEventsByClientEventIds/);
});

test("the client refreshes and rebases authored appends after stale heads",async()=>{
  const [store,runtime,eventsApi]=await Promise.all([
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/runtime.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
  ]);
  assert.match(store,/response\.status===409&&body\.error==="stale_sequence"/);
  assert.match(store,/await this\.#refreshEvents\(\);continue/);
  assert.match(store,/rebaseAttempts\?\?2/);
  assert.match(store,/action:"canvas_sync"/);
  assert.match(store,/stageOptimisticCanvasEvents/);
  assert.match(store,/#appendPipeline/);
  assert.match(store,/this\.#appendPipeline\.then\(\(\)=>this\.#appendBatchNow/);
  assert.match(store,/this\.setRoute\(routedDestination\);\s*const appended=await this\.append/);
  assert.match(runtime,/sequence>\? ORDER BY sequence ASC LIMIT \?/);
  assert.match(runtime,/while\(events\.length<requested\)/);
  assert.match(eventsApi,/readEventPageWithHead\(env,streamId,after,limit\)/);
  assert.match(runtime,/export async function readEventPageWithHead/);
  assert.match(eventsApi,/streamHead\(env,streamId\)/);
  assert.match(store,/#readEventPages\(after=0\)/);
  assert.match(store,/hasMore&&next<=cursor/);
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
