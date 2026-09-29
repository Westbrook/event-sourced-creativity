import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let handleRetainedStoryRead, ensureSchema, appendAuditEvent, retainedStoryRequestPath;
let handleNativeRetainedOutputRead, nativeRetainedOutputRequestPath, projectNativeRetainedOutput;
try {
  ({ handleRetainedStoryRead } = await import("../worker/retained-story-api.ts"));
  ({ handleNativeRetainedOutputRead } = await import("../worker/retained-story-api.ts"));
  ({ nativeRetainedOutputRequestPath, projectNativeRetainedOutput } = await import("../src/model/native-retained-output.ts"));
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

const trimmedRevision = (sourceContentSha256) => ({
 schemaVersion:1,operation:"trim",
 media:{url:audioUrl().replace("audio.wav","trim-1.wav"),mediaType:"audio/wav",sha256:"d".repeat(64),byteLength:24044},
 source:{url:audioUrl(),sha256:"b".repeat(64),revision:0,contentSha256:sourceContentSha256,frameCount:22000},
 startFrame:4000,endFrame:16000,sampleRate:8000,channels:1,bitsPerSample:16,frameCount:12000,durationSeconds:1.5,
});
const privatePayload = (f,eventId) => f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(eventId)?.private_json;
const changePrivatePayload = (f,eventId,change) => {
 const payload=JSON.parse(privatePayload(f,eventId));change(payload);
 f.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(payload),eventId);
};
async function retainTrim(f,revision=trimmedRevision(digest(f.raw())),number=1,body) {
 f.replace(body??{...JSON.parse(f.raw()),audio_revision:revision});
 const event=await f.append("DocumentArtifactEdited",{artifact_id:ARTIFACT,artifact_kind:"audio",content_ref:CONTENT,
  revision:number,content_sha256:digest(f.raw()),edited_by_user_id:OWNER,audio_revision:revision,source_surface:"document-artifact-editor"});
 return {revision,event};
}

// Synthetic retained edit envelopes qualify read custody and projection only.
// The persistence suite separately exercises actual PCM edits and retained bytes.
test("native Audio selects exact authored trim media and measured duration while preserving immutable completion identity",async t=>{
 const f=await audioFixture(t),original=privatePayload(f,f.completion.eventId),{revision}=await retainTrim(f),before=f.changes();
 const response=await f.readNative("audio",f.select(1));assert.equal(response.status,200);
 const dto=await response.json();assert.deepEqual(dto.selection,f.select(1));
 assert.deepEqual(dto.content.media,{url:revision.media.url,mediaType:"audio/wav",sha256:revision.media.sha256});
 assert.deepEqual(dto.content.timing,{seconds:1.5,basis:"measured"});
 assert.equal(dto.content.inputRef,"original-audio-input");assert.equal(dto.content.lyrics,audioSettings().lyrics);
 assert.equal(dto.content.role,"voice");assert.equal(dto.content.synthIdWatermarked,true);
 assert.equal(privatePayload(f,f.completion.eventId),original);assert.equal(f.changes(),before);
 assert.equal(f.calls.length,6);assert.equal(f.calls.filter(sql=>sql.startsWith("SELECT private_json")).length,2);
 assert.equal((f.calls.at(-1).match(/CAST\(private_json AS BLOB\)=CAST\(\? AS BLOB\)/gu)??[]).length,2);
 assert.equal((await f.readNative("audio",f.select(0))).status,404);
});

test("native Audio refuses unbound, malformed, foreign or incoherent authored media without original-media fallback",async t=>{
 for(const fault of ["revision-zero","missing-event-field","missing-body-field","null-body","malformed","different-record","foreign-media",
  "foreign-source","future-source-revision","original-source-hash","original-source-url","private-identity","private-digest","missing-receipt","redacted-receipt"])
 await t.test(fault,async child=>{
  const f=await audioFixture(child);let revision=1;
  if(fault==="revision-zero"){f.replace({...initialBody(),audio_revision:trimmedRevision(digest(f.raw()))});revision=0;}
  else {
   const mediaRevision=trimmedRevision(digest(f.raw()));
   if(fault==="foreign-media")mediaRevision.media.url=`/api/media/${ownerMediaNamespace("other")}%2Fgenerated%2Ftrim.wav`;
   if(fault==="foreign-source")mediaRevision.source.url=`/api/media/${ownerMediaNamespace("other")}%2Fgenerated%2Faudio.wav`;
   if(fault==="future-source-revision")mediaRevision.source.revision=1;
   if(fault==="original-source-hash")mediaRevision.source.sha256="e".repeat(64);
   if(fault==="original-source-url")mediaRevision.source.url=audioUrl().replace("audio.wav","other-original.wav");
   const retained=await retainTrim(f,mediaRevision,1,fault==="missing-body-field"?initialBody():fault==="null-body"?{...initialBody(),audio_revision:null}:undefined),id=retained.event.eventId;
   if(fault==="missing-event-field")changePrivatePayload(f,id,p=>{delete p.audio_revision;});
   if(fault==="malformed")changePrivatePayload(f,id,p=>p.audio_revision.media.sha256="invalid");
   if(fault==="different-record")changePrivatePayload(f,id,p=>p.audio_revision.media.sha256="e".repeat(64));
   if(fault==="private-identity")changePrivatePayload(f,id,p=>p.artifact_id="other");
   if(fault==="private-digest")changePrivatePayload(f,id,p=>p.content_sha256="e".repeat(64));
   if(fault==="missing-receipt")f.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(id);
   if(fault==="redacted-receipt")f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run("2030-01-01T00:00:00.000Z",id);
  }
  const before=f.changes(),response=await f.readNative("audio",f.select(revision));assert.equal(response.status,404);
  assert.equal(f.changes(),before);assert.equal(f.calls.some(sql=>sql.includes("expected_events AS")),false);
 });
});

test("native Audio binds later trim source content to its earlier public revision including legacy text-only sources",async t=>{
 for(const source of ["trim","legacy-text"])
 await t.test(source,async child=>{
  const f=await audioFixture(child);
  if(source==="trim")await retainTrim(f);
  else {
   f.replace({...initialBody(),content_markdown:"Revised text, original file."});
   await f.append("DocumentArtifactEdited",{artifact_id:ARTIFACT,content_ref:CONTENT,revision:1,content_sha256:digest(f.raw()),edited_by_user_id:OWNER});
  }
  const first=JSON.parse(f.raw()).audio_revision,revision=trimmedRevision(digest(f.raw()));
  revision.media.url=audioUrl().replace("audio.wav","trim-2.wav");revision.media.sha256="e".repeat(64);
  revision.source={url:first?.media.url??audioUrl(),sha256:first?.media.sha256??"b".repeat(64),revision:1,contentSha256:digest(f.raw()),frameCount:first?.frameCount??22000};
  revision.startFrame=2000;revision.endFrame=6000;revision.frameCount=4000;revision.durationSeconds=.5;revision.media.byteLength=8044;
  await retainTrim(f,revision,2);assert.equal((await f.readNative("audio",f.select(2))).status,200);
  const invalidRevision=structuredClone(revision);invalidRevision.source.contentSha256="f".repeat(64);
  await retainTrim(f,invalidRevision,3);assert.equal((await f.readNative("audio",f.select(3))).status,404);
 });
});

test("native Audio restores original and retained edited media through new revisions without rewriting completion",async t=>{
 const f=await audioFixture(t),original=privatePayload(f,f.completion.eventId),{revision}=await retainTrim(f);
 f.replace(initialBody());
 await f.append("DocumentArtifactEdited",{artifact_id:ARTIFACT,artifact_kind:"audio",content_ref:CONTENT,revision:2,content_sha256:digest(f.raw()),edited_by_user_id:OWNER,
  audio_revision:null,revision_action:"restore",restored_from_revision:0,source_surface:"document-artifact-history"});
 const restored=await f.readNative("audio",f.select(2));assert.equal(restored.status,200);assert.equal((await restored.json()).content.media.url,audioUrl());
 f.replace({...initialBody(),audio_revision:revision});
 await f.append("DocumentArtifactEdited",{artifact_id:ARTIFACT,artifact_kind:"audio",content_ref:CONTENT,revision:3,content_sha256:digest(f.raw()),edited_by_user_id:OWNER,
  audio_revision:revision,revision_action:"restore",restored_from_revision:1,source_surface:"document-artifact-history"});
 const edited=await f.readNative("audio",f.select(3));assert.equal(edited.status,200);assert.equal((await edited.json()).content.media.url,revision.media.url);
 assert.equal(privatePayload(f,f.completion.eventId),original);
});

test("native Audio accepts null media override only as a bound original-history restore marker",async t=>{
 for(const fault of ["ordinary-edit","missing-history-surface","missing-source-revision","future-source-revision"])
 await t.test(fault,async child=>{
  const f=await audioFixture(child);await retainTrim(f);f.replace(initialBody());
  const payload={artifact_id:ARTIFACT,artifact_kind:"audio",content_ref:CONTENT,revision:2,content_sha256:digest(f.raw()),edited_by_user_id:OWNER,
   audio_revision:null,revision_action:"restore",restored_from_revision:0,source_surface:"document-artifact-history"};
  if(fault==="ordinary-edit")delete payload.revision_action;
  if(fault==="missing-history-surface")delete payload.source_surface;
  if(fault==="missing-source-revision")delete payload.restored_from_revision;
  if(fault==="future-source-revision")payload.restored_from_revision=2;
  await f.append("DocumentArtifactEdited",payload);assert.equal((await f.readNative("audio",f.select(2))).status,404);
 });
});

test("native Audio final witness binds complete current edit bytes and receipt custody",async t=>{
 for(const fault of ["media","source","private-extra","private-byte-order","owner","redaction","deletion"])
 await t.test(fault,async child=>{
  const f=await audioFixture(child),{event}=await retainTrim(f);let entered=0,afterMutation;
  f.setBeforeRead(sql=>{
   if(!sql.includes("expected_events AS"))return;entered++;
   if(fault==="media")changePrivatePayload(f,event.eventId,p=>p.audio_revision.media.sha256="f".repeat(64));
   if(fault==="source")changePrivatePayload(f,event.eventId,p=>p.audio_revision.source.contentSha256="f".repeat(64));
   if(fault==="private-extra")changePrivatePayload(f,event.eventId,p=>p.extra="replacement");
   if(fault==="private-byte-order")f.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(` ${privatePayload(f,event.eventId)}`,event.eventId);
   if(fault==="owner")f.sqlite.prepare("UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?").run("other",event.eventId);
   if(fault==="redaction")f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run("2030-01-01T00:00:00.000Z",event.eventId);
   if(fault==="deletion")f.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(event.eventId);
   afterMutation=f.changes();
  });
  assert.equal((await f.readNative("audio",f.select(1))).status,404);assert.equal(entered,1);assert.equal(f.changes(),afterMutation);
 });
});

test("native Audio projector requires an exact independently supplied edit witness",async t=>{
 const f=await audioFixture(t),{revision}=await retainTrim(f),body=JSON.parse(f.raw()),audioReceipt=JSON.parse(privatePayload(f,f.completion.eventId));
 const target={output:"audio",selection:f.select(1)};
 assert.equal(projectNativeRetainedOutput(target,body,EXPIRY,null,{audioReceipt}),null);
 assert.equal(projectNativeRetainedOutput(target,body,EXPIRY,null,{audioReceipt,audioRevision:null}),null);
 assert.equal(projectNativeRetainedOutput(target,{...body,audio_revision:null},EXPIRY,null,{audioReceipt,audioRevision:revision}),null);
 assert.equal(projectNativeRetainedOutput({...target,selection:f.select(0)},body,EXPIRY,null,{audioReceipt,audioRevision:revision}),null);
 assert.equal(projectNativeRetainedOutput(target,initialBody(),EXPIRY,null,{audioReceipt,audioRevision:revision}),null);
 const dto=projectNativeRetainedOutput(target,body,EXPIRY,null,{audioReceipt,audioRevision:revision});
 assert.equal(dto.content.media.sha256,revision.media.sha256);assert.equal(dto.content.timing.seconds,revision.durationSeconds);
});
