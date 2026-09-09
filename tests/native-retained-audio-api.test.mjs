import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let handleRetainedStoryRead, ensureSchema, appendAuditEvent, retainedStoryRequestPath;
let handleNativeRetainedOutputRead, nativeRetainedOutputRequestPath;
try {
  ({ handleRetainedStoryRead } = await import("../worker/retained-story-api.ts"));
  ({ handleNativeRetainedOutputRead } = await import("../worker/retained-story-api.ts"));
  ({ nativeRetainedOutputRequestPath } = await import("../src/model/native-retained-output.ts"));
  ({ ensureSchema, appendAuditEvent } = await import("../worker/runtime.ts"));
  ({ retainedStoryRequestPath } = await import("../src/model/retained-short-story.ts"));
} finally { imports.deregister(); }

const OWNER = "retained-audio-owner";
const EMAIL = "retained-audio-owner@example.test";
const DOCUMENT = "retained-story-document";
const PROJECT = "retained-story-personal-project";
const ARTIFACT = "retained-story-artifact";
const CONTENT = "retained-story-content";
const EXPIRY = "2099-01-01T00:00:00.000Z";
const POLICY = "pilot-2026-08-10";
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const initialBody = () => ({ title: "Literal <title>", summary: "Not transported", content_markdown: "# A retained story\n\nLiteral <script>text</script>.", presentation: null,
  items: [{ title: "Part one", body: "The original item body.", notes: "Private notes, not transported", image_prompt: "", slide: null }] });

async function fixture(t, options = {}) {
  const state = outputTestDatabase();
  t.after(() => state.sqlite.close());
  await ensureSchema(state.env);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Retained owner", "creator", POLICY, now, now, now);
  const stream = `creative:${OWNER}`;
  await appendAuditEvent(state.env, stream, "user", "DocumentCreated", { document_id: DOCUMENT, project_id: PROJECT, title: "Document name is not the result title" });
  const completion = await (options.completionWriter ?? appendAuditEvent)(state.env, stream, "worker:renderer", "DocumentRenderCompleted", {
    document_id: DOCUMENT, project_id: PROJECT, artifact_id: ARTIFACT, artifact_kind: options.kind ?? "short_story",
    requested_by_user_id: OWNER, title: "Completion name is not the retained title", content_ref: CONTENT, item_count: 1,
    ...options.completionPayload,
  });
  let raw = JSON.stringify(initialBody());
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  const calls = [];
  const rawReads = [];
  let beforeRead = null;
  const guardedDB = {
    prepare(sql) {
      assert.match(sql, /^\s*(?:WITH|SELECT)\b/iu, "the read endpoint may not prepare any writer statement");
      const prepared = state.DB.prepare(sql);
      function statement(values) {
        return {
          bind(...bindings) { return statement(bindings); },
          async first() {
            calls.push(sql);
            if (beforeRead) await beforeRead(sql);
            const result = await prepared.bind(...values).first();
            if (sql.startsWith("SELECT content,expires_at")) rawReads.push(result);
            return result;
          },
          async all() {
            calls.push(sql);
            if (beforeRead) await beforeRead(sql);
            return prepared.bind(...values).all();
          },
        };
      }
      return statement([]);
    },
    batch() { throw new Error("No batch or mutation is expected from the retained reader"); },
  };
  const env = { ...state.env, DB: guardedDB,
    MEDIA: new Proxy({}, { get() { throw new Error("Retained read entered MEDIA"); } }),
    ASSETS: { fetch() { throw new Error("Retained read entered ASSETS"); } },
  };
  const select = (revision = 0, sha256 = digest(raw)) => ({ documentId: DOCUMENT, artifactId: ARTIFACT, revision, contentSha256: sha256 });
  const request = (selection = select(), headers = {}, method = "GET") => new Request(`https://forma.test${retainedStoryRequestPath(selection)}`, {
    method, headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers },
  });
  const read = (selection = select(), headers = {}) => handleRetainedStoryRead(request(selection, headers), env);
  const requestNative = (output, selection = select(), headers = {}, method = "GET") => new Request(
    `https://forma.test${nativeRetainedOutputRequestPath({ output, selection })}`, {
      method, headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers },
    });
  const readNative = (output, selection = select(), headers = {}) => handleNativeRetainedOutputRead(requestNative(output, selection, headers), env);
  const changes = () => state.sqlite.prepare("SELECT total_changes() AS count").get().count;
  const replace = value => {
    raw = typeof value === "string" ? value : JSON.stringify(value);
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT);
  };
  const append = (type, payload) => appendAuditEvent(state.env, stream, "user", type, { project_id: PROJECT, document_id: DOCUMENT, ...payload });
  // Deliberately malformed/oversized public-history fixtures, never production admission.
  let rawSequence = 0;
  const rawEvent = (type, payload) => {
    const sequence = state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS next FROM events WHERE stream_id=?").get(stream).next;
    state.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(`retained-raw-${++rawSequence}`, stream, sequence, now, now, "user", "test", "retained-test", 1, type, JSON.stringify(payload));
  };
  return { ...state, env, calls, rawReads, request, read, requestNative, readNative, select, changes, replace, append, rawEvent, completion,
    raw: () => raw, setBeforeRead(value) { beforeRead = value; } };
}

const {ownerMediaNamespace}=await import("../src/model/media-ownership.ts");
const audioUrl=()=>`/api/media/${ownerMediaNamespace(OWNER)}%2Fgenerated%2Faudio.wav`;
const audioSettings=()=>({audio_role:"voice",lyrics:"  Lyrics <literal>‏\n",audio_synthid_watermarked:true,
 source_media_sha256:"b".repeat(64),duration_seconds:2.75,estimated_duration_seconds:null,duration_basis:"media-container",
 duration_media_url:audioUrl(),duration_media_sha256:"b".repeat(64)});
async function audioFixture(t) {
 return fixture(t,{kind:"audio",completionPayload:{input_ref:"original-audio-input",media_url:audioUrl(),media_type:"audio/wav",settings:audioSettings()}});
}
const editEnvelope=(f,change)=>{
 const row=f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.completion.eventId);
 const payload=JSON.parse(row.private_json);change(payload);
 f.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(payload),f.completion.eventId);
};
// This seeds synthetic completion metadata only. No provider, byte playback,
// live authorization, job admission or waveform editing is certified here.
test("native Audio reads exact raw revision, selected media hash and original input identity using SELECT only",async t=>{
 const f=await audioFixture(t),before=f.changes(),response=await f.readNative("audio");assert.equal(response.status,200);
 const dto=await response.json();assert.deepEqual(dto.selection,f.select());assert.equal(dto.title,initialBody().title);
 assert.deepEqual(dto.content,{content_markdown:initialBody().content_markdown,lyrics:audioSettings().lyrics,role:"voice",
  media:{url:audioUrl(),mediaType:"audio/wav",sha256:"b".repeat(64)},timing:{seconds:2.75,basis:"measured"},synthIdWatermarked:true,inputRef:"original-audio-input"});
 assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal(f.changes(),before);assert.equal(f.calls.length,5);
 assert.equal(f.calls.filter(sql=>sql.startsWith("SELECT private_json")).length,1);
 assert.ok(f.calls.at(-1).includes("CAST(private_json AS BLOB)=CAST(? AS BLOB)"));
});
test("native Audio preserves missing-file and mismatched-timing truth without inferring playable source text",async t=>{
 for(const missing of [false,true])await t.test(missing?"no media":"changed timing",async child=>{
  const f=await audioFixture(child);editEnvelope(f,p=>{if(missing){p.media_url=null;p.media_type=null;p.settings.source_media_sha256=null;}else p.settings.duration_media_sha256="c".repeat(64);});
  const response=await f.readNative("audio");assert.equal(response.status,200);const dto=await response.json();assert.equal(dto.content.timing,null);
  assert.equal(dto.content.media===null,missing);assert.equal(dto.content.content_markdown,initialBody().content_markdown);
 });
});
test("native Audio binds current raw revision and rejects the previous exact selection",async t=>{
 const f=await audioFixture(t),old=f.select(),body=initialBody();body.content_markdown="Current textual notes; waveform unchanged.";f.replace(body);
 await f.append("DocumentArtifactEdited",{artifact_id:ARTIFACT,content_ref:CONTENT,revision:1,content_sha256:digest(f.raw()),edited_by_user_id:OWNER});
 assert.equal((await f.readNative("audio",f.select(1))).status,200);assert.equal((await f.readNative("audio",old)).status,404);
});
test("native Audio refuses altered private identity and media before any result is returned",async t=>{
 for(const fault of ["document","artifact","owner","content","input","kind","foreign-media","unsafe-url","hash","mime","missing","redacted"])
 await t.test(fault,async child=>{
  const f=await audioFixture(child);const field={document:"document_id",artifact:"artifact_id",owner:"requested_by_user_id",content:"content_ref",input:"input_ref",kind:"artifact_kind"}[fault];
  if(field)editEnvelope(f,p=>p[field]="other");
  if(fault==="foreign-media")editEnvelope(f,p=>p.media_url=`/api/media/${ownerMediaNamespace("other")}%2Fgenerated%2Faudio.wav`);
  if(fault==="unsafe-url")editEnvelope(f,p=>p.media_url=audioUrl()+"?other=1");
  if(fault==="hash")editEnvelope(f,p=>p.settings.source_media_sha256="no-hash");
  if(fault==="mime")editEnvelope(f,p=>p.media_type="image/png");
  if(fault==="missing")f.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(f.completion.eventId);
  if(fault==="redacted")f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run("2030-01-01T00:00:00.000Z",f.completion.eventId);
  const before=f.changes(),response=await f.readNative("audio");assert.equal(response.status,404);assert.equal(f.changes(),before);
  assert.equal(f.calls.some(sql=>sql.includes("expected_events AS")),false);
 });
});
test("native Audio final witness rejects selected media/input replacement and private source retirement",async t=>{
 for(const fault of ["hash","media","input","redaction","owner","raw","role","revision"])
 await t.test(fault,async child=>{
  const f=await audioFixture(child);let entered=0,afterMutation;
  f.setBeforeRead(async sql=>{
   if(!sql.includes("expected_events AS"))return;entered++;
   if(fault==="hash")editEnvelope(f,p=>p.settings.source_media_sha256="c".repeat(64));
   if(fault==="media")editEnvelope(f,p=>p.media_url=audioUrl().replace("audio.wav","replacement.wav"));
   if(fault==="input")editEnvelope(f,p=>p.input_ref="different-input");
   if(fault==="redaction")f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run("2030-01-01T00:00:00.000Z",f.completion.eventId);
   if(fault==="owner")f.sqlite.prepare("UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?").run("other",f.completion.eventId);
   if(fault==="raw")f.replace({...initialBody(),title:"Changed"});
   if(fault==="role")f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
   if(fault==="revision")await f.append("DocumentArtifactEdited",{artifact_id:ARTIFACT,content_ref:CONTENT,revision:1,content_sha256:digest(f.raw()),edited_by_user_id:OWNER});
   afterMutation=f.changes();
  });
  assert.equal((await f.readNative("audio")).status,404);assert.equal(entered,1);assert.equal(f.changes(),afterMutation);
 });
});
