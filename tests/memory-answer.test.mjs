import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { parseMemoryAnswerPresentation } from "../src/model/memory-answer.ts";
import { nativeMemoryAnswerExclusion } from "../worker/memory-native-boundary.ts";

const now = Date.parse("2026-09-04T12:00:00.000Z");
const descriptor = () => ({ version: "native-memory-answer-v1", method: "extractive-not-semantic",
  checkedAt: "2026-09-04T12:00:00.000Z", validUntil: "2026-09-04T12:01:00.000Z" });
test("memory answer presentation: immutable bounded receipt expires without a refresh", () => {
  const value = descriptor(), parsed = parseMemoryAnswerPresentation(value, now);
  assert.deepEqual(parsed, value); assert.notEqual(parsed, value);
  value.validUntil = "2026-09-04T13:00:00.000Z";
  assert.equal(parsed.validUntil, "2026-09-04T12:01:00.000Z");
  assert.equal(parseMemoryAnswerPresentation(parsed, now + 60_000), null);
});
for (const [name, edit] of [
  ["unknown version", value => ({ ...value, version: "v2" })],
  ["semantic claim", value => ({ ...value, method: "semantic" })],
  ["private lineage", value => ({ ...value, originId: "private" })],
  ["SQL proof", value => ({ ...value, proof: { sql: "1" } })],
  ["missing lifetime", value => { delete value.validUntil; return value; }],
  ["noncanonical timestamp", value => ({ ...value, checkedAt: "2026-09-04T12:00:00Z" })],
  ["future check", value => ({ ...value, checkedAt: "2026-09-04T12:00:00.001Z" })],
  ["expired", value => ({ ...value, validUntil: value.checkedAt })],
  ["extended lifetime", value => ({ ...value, validUntil: "2026-09-04T12:01:00.001Z" })],
  ["invalid timestamp", value => ({ ...value, validUntil: "not-a-date" })],
  ["numeric timestamp", value => ({ ...value, validUntil: now + 1000 })],
]) test(`memory answer presentation: rejects ${name}`, () => assert.equal(parseMemoryAnswerPresentation(edit(descriptor()), now), null));

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE events(event_id TEXT,actor TEXT,type TEXT,payload TEXT);
    CREATE TABLE private_content(content_id TEXT,owner_id TEXT,kind TEXT);
    CREATE TABLE assistant_turns(actor_user_id TEXT,scope_key TEXT,turn_id TEXT,project_id TEXT,document_id TEXT,user_content_ref TEXT,assistant_content_ref TEXT,organization_id TEXT,project_access_id TEXT);
    INSERT INTO private_content VALUES ('answer','actor','chat-assistant'),('user','actor','chat-user');
    INSERT INTO assistant_turns VALUES ('actor','scope','turn','project','document','user','answer',NULL,NULL);`);
  const env = { DB: { prepare(sql) { return {
    async first() { return db.prepare(sql).get() ?? null; },
    async all() { return { success: true, results: db.prepare(sql).all() }; },
  }; } } };
  const marker = (value, content = "answer", scope = {}) => db.prepare("INSERT INTO events VALUES(?,?,?,?)").run("event", "user:actor", "AssistantReasoned",
    JSON.stringify({ content_ref: content, project_id: "project", document_id: "document", turn_id: "turn", memory_origin_version: value,
      organization_id: null, project_access_id: null, owner_user_id: "actor", ...scope }));
  const origins = () => db.exec(`CREATE TABLE memory_native_answer_origins(answer_content_id TEXT,actor_user_id TEXT,scope_key TEXT,turn_id TEXT,status TEXT);
    INSERT INTO memory_native_answer_origins VALUES('answer','actor','scope','turn','withdrawn');`);
  async function allowed({ answerAlias = "answer", turnAlias = "turn" } = {}) {
    const guard = await nativeMemoryAnswerExclusion(env, { answerAlias, turnAlias });
    const ref = answerAlias === "authored" ? "user_content_ref" : "assistant_content_ref";
    return db.prepare(`SELECT CASE WHEN ${guard.sql} THEN 1 ELSE 0 END AS ordinary FROM assistant_turns ${turnAlias}
      LEFT JOIN private_content ${answerAlias} ON ${answerAlias}.content_id=${turnAlias}.${ref}`).get(...guard.bindings).ordinary;
  }
  async function generic(contentId = "answer") {
    const guard = await nativeMemoryAnswerExclusion(env, { answerAlias: "content" });
    return db.prepare(`SELECT CASE WHEN ${guard.sql} THEN 1 ELSE 0 END AS ordinary FROM private_content content
      WHERE content.content_id=?`).get(...guard.bindings,contentId).ordinary;
  }
  return { db, env, marker, origins, allowed, generic };
}
test("memory answer boundary: ordinary answer remains ordinary without origin schema", async () => {
  const f = fixture(); try { assert.equal(await f.allowed(), 1); assert.equal(await f.allowed({ answerAlias: "authored" }), 1); } finally { f.db.close(); }
});
for (const value of [1, 0, "1", true, null, {}]) test(`memory answer boundary: any immutable marker presence denies ordinary downgrade (${JSON.stringify(value)})`, async () => {
  const f = fixture(); try { f.marker(value); assert.equal(await f.allowed(), 0); } finally { f.db.close(); }
});
test("memory answer boundary: marked private kind is denied without manifest or marker", async () => {
  const f = fixture(); try { f.db.exec("UPDATE private_content SET kind='chat-assistant-memory' WHERE content_id='answer'"); assert.equal(await f.allowed(), 0); } finally { f.db.close(); }
});
test("memory answer boundary: withdrawn origins cannot be retyped into ordinary chat", async () => {
  const f = fixture(); try { f.origins(); assert.equal(await f.allowed(), 0); } finally { f.db.close(); }
});
test("memory answer boundary: schema absence is not cached across migration", async () => {
  const f = fixture(); try { assert.equal(await f.allowed(), 1); f.origins(); assert.equal(await f.allowed(), 0); } finally { f.db.close(); }
});
test("memory answer boundary: origin tuple rejects replacing the marked answer reference", async () => {
  const f = fixture(); try { f.origins(); f.db.exec("INSERT INTO private_content VALUES('replacement','actor','chat-assistant'); UPDATE assistant_turns SET assistant_content_ref='replacement'"); assert.equal(await f.allowed(), 0); } finally { f.db.close(); }
});
test("memory answer boundary: immutable marker rejects replacing the answer even after origin deletion", async () => {
  const f = fixture(); try { f.marker(1); f.db.exec("INSERT INTO private_content VALUES('replacement','actor','chat-assistant'); UPDATE assistant_turns SET assistant_content_ref='replacement'"); assert.equal(await f.allowed(), 0); } finally { f.db.close(); }
});
test("memory answer boundary: origin answer cannot be renamed and repointed into the authored role", async () => {
  const f = fixture(); try { f.origins(); f.db.exec("UPDATE private_content SET kind='chat-user' WHERE content_id='answer'; UPDATE assistant_turns SET user_content_ref='answer'"); assert.equal(await f.allowed({ answerAlias: "authored" }), 0); } finally { f.db.close(); }
});
test("memory answer boundary: null joined content is not misclassified as memory authorization", async () => {
  const f = fixture(); try { f.db.exec("DELETE FROM private_content"); assert.equal(await f.allowed(), 1); } finally { f.db.close(); }
});
test("memory answer boundary: unrelated marked turn does not hide an ordinary turn", async () => {
  const f = fixture(); try { f.marker(1, "unrelated"); f.db.exec("UPDATE assistant_turns SET turn_id='other-turn'"); assert.equal(await f.allowed(), 1); } finally { f.db.close(); }
});
test("memory answer boundary: SQL aliases cannot be supplied by a client", async () => {
  const f = fixture(); try { await assert.rejects(nativeMemoryAnswerExclusion(f.env, { answerAlias: "answer); DROP TABLE events;--" }), /alias_invalid/); } finally { f.db.close(); }
});
for(const proof of ["marker","origin"])for(const role of ["user_content_ref","assistant_content_ref"]){
  test(`memory answer generic hydration: ${proof} blocks repointed ${role}`,async()=>{
    const f=fixture();try{
      assert.equal(await f.generic(),1);
      if(proof==="marker")f.marker(1);else f.origins();
      f.db.exec(`INSERT INTO private_content VALUES('replacement','actor','chat-user'); UPDATE assistant_turns SET ${role}='replacement'`);
      assert.equal(await f.generic("replacement"),0);
    }finally{f.db.close();}
  });
}
test("memory answer generic hydration: a fresh ordinary database need not contain assistant tables",async()=>{
  const f=fixture();try{f.db.exec("DROP TABLE assistant_turns");assert.equal(await f.generic(),1);f.marker(1);assert.equal(await f.generic(),0);}finally{f.db.close();}
});
for(const [name,scope] of [
  ["personal versus organization",{organization_id:"org",project_access_id:"access"}],
  ["different organization",{organization_id:"other-org",project_access_id:"access"}],
  ["different project access",{organization_id:"org",project_access_id:"other-access"}],
])test(`memory answer boundary: repeated resource and turn IDs remain isolated (${name})`,async()=>{
  const f=fixture();try{
    if(name!=="personal versus organization")f.db.exec("UPDATE assistant_turns SET organization_id='org',project_access_id='access'");
    f.marker(1,"unrelated-content",scope);
    assert.equal(await f.allowed(),1);
    assert.equal(await f.allowed({answerAlias:"authored"}),1);
    assert.equal(await f.generic(),1);
    assert.equal(await f.generic("user"),1);
  }finally{f.db.close();}
});
test("memory answer boundary: exact shared tuple rejects repointing both roles",async()=>{
  const f=fixture();try{
    f.db.exec("UPDATE assistant_turns SET organization_id='org',project_access_id='access'");
    f.marker(1,"former-content",{organization_id:"org",project_access_id:"access"});
    assert.equal(await f.allowed(),0);assert.equal(await f.allowed({answerAlias:"authored"}),0);
    assert.equal(await f.generic(),0);assert.equal(await f.generic("user"),0);
  }finally{f.db.close();}
});
test("memory answer boundary: absent tenancy metadata is not an explicit personal marker tuple",async()=>{
  const f=fixture();try{
    f.marker(1,"former-content",{organization_id:undefined,project_access_id:undefined});
    assert.equal(await f.allowed(),1);assert.equal(await f.generic(),1);
    // Direct content identity still blocks every malformed marker variant.
    f.marker(1,"answer",{organization_id:undefined,project_access_id:undefined});
    assert.equal(await f.allowed(),0);assert.equal(await f.generic(),0);
  }finally{f.db.close();}
});

const structuredDescriptor = () => ({ ...descriptor(), version: "native-memory-answer-v2", method: "structured-not-semantic" });
test("structured memory presentation: preserves four public fields and the original expiry without renewal", () => {
  const value = structuredDescriptor(), parsed = parseMemoryAnswerPresentation(value, now);
  assert.deepEqual(parsed, value); assert.notEqual(parsed, value);
  assert.deepEqual(Object.keys(parsed).sort(), ["checkedAt", "method", "validUntil", "version"]);
  value.version = "native-memory-answer-v1"; value.method = "extractive-not-semantic";
  value.validUntil = "2026-09-04T13:00:00.000Z";
  assert.deepEqual(parsed, structuredDescriptor());
  assert.deepEqual(parseMemoryAnswerPresentation(parsed, now + 59_999), structuredDescriptor());
  assert.equal(parseMemoryAnswerPresentation(parsed, now + 60_000), null);
});
for (const [name, edit] of [
  ["legacy method", value => ({ ...value, method: "extractive-not-semantic" })],
  ["legacy version", value => ({ ...value, version: "native-memory-answer-v1" })],
  ["unknown version", value => ({ ...value, version: "native-memory-answer-v3" })],
  ["semantic claim", value => ({ ...value, method: "semantic" })],
  ["private origin", value => ({ ...value, originId: "private" })],
  ["private manifest", value => ({ ...value, manifest: { contextJson: "private" } })],
  ["private dependencies", value => ({ ...value, dependencies: [] })],
  ["private proof", value => ({ ...value, proof: {} })],
  ["missing lifetime", value => { delete value.validUntil; return value; }],
  ["noncanonical check", value => ({ ...value, checkedAt: "2026-09-04T12:00:00Z" })],
  ["noncanonical expiry", value => ({ ...value, validUntil: "2026-09-04T12:01:00Z" })],
  ["future check", value => ({ ...value, checkedAt: "2026-09-04T12:00:00.001Z" })],
  ["empty lifetime", value => ({ ...value, validUntil: value.checkedAt })],
  ["reversed lifetime", value => ({ ...value, validUntil: "2026-09-04T11:59:59.999Z" })],
  ["extended lifetime", value => ({ ...value, validUntil: "2026-09-04T12:01:00.001Z" })],
  ["invalid check", value => ({ ...value, checkedAt: "not-a-date" })],
  ["invalid expiry", value => ({ ...value, validUntil: "not-a-date" })],
  ["numeric timestamp", value => ({ ...value, validUntil: now + 1000 })],
]) test(`structured memory presentation: rejects ${name}`, () => {
  assert.equal(parseMemoryAnswerPresentation(edit(structuredDescriptor()), now), null);
});
for (const make of [descriptor, structuredDescriptor]) {
  test(`memory presentation data boundary: ${make().version} rejects non-JSON provenance and accessors`, () => {
    const hidden = make(); Object.defineProperty(hidden, "originId", { value: "private" });
    assert.equal(parseMemoryAnswerPresentation(hidden, now), null);
    const symbol = make(); symbol[Symbol("origin")] = "private";
    assert.equal(parseMemoryAnswerPresentation(symbol, now), null);
    const concealed = make(); Object.defineProperty(concealed, "method", { enumerable: false });
    assert.equal(parseMemoryAnswerPresentation(concealed, now), null);
    const accessor = make(); let reads = 0;
    Object.defineProperty(accessor, "validUntil", { enumerable: true, get() { reads++; return descriptor().validUntil; } });
    assert.equal(parseMemoryAnswerPresentation(accessor, now), null);
    assert.equal(reads, 0);
    assert.deepEqual(parseMemoryAnswerPresentation(Object.freeze(make()), now), make());
    assert.deepEqual(parseMemoryAnswerPresentation(Object.assign(Object.create(null), make()), now), make());
  });
}
test("memory presentation data boundary: malformed values and clocks deny without throwing", () => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const throws = new Proxy({}, { ownKeys() { throw new Error("untrusted metadata"); } });
  for (const value of [undefined, null, false, 1, "memory", [], revoked.proxy, throws]) {
    assert.equal(parseMemoryAnswerPresentation(value, now), null);
  }
  for (const clock of [NaN, Infinity, -Infinity]) {
    assert.equal(parseMemoryAnswerPresentation(structuredDescriptor(), clock), null);
  }
});
