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
});

test("the client refreshes and rebases one authored append after a stale head",async()=>{
  const store=await readFile(new URL("../src/state/store.ts",import.meta.url),"utf8");
  assert.match(store,/response\.status===409&&body\.error==="stale_sequence"/);
  assert.match(store,/await this\.#refreshEvents\(\);continue/);
});
