// Root-run RAM Worker baseline/candidate. No provider, browser, Store replacement,
// generated-media claim, or real database is involved. The shared fixture's
// artifact is explicitly synthetic; its event and private row use real helpers.
import test from "node:test";
import assert from "node:assert/strict";

const previousFetch = globalThis.fetch;
let externalAttempts = 0;
globalThis.fetch = async () => { externalAttempts++; throw Error("No external transport exists in this reference-read fixture"); };
test.after(() => {
  try { assert.equal(externalAttempts, 0); }
  finally { globalThis.fetch = previousFetch; }
});

const { createSceneCostFixture } = await import("./helpers/scene-cost-fixture.mjs");
const { appendAuditEvent } = await import("../worker/runtime.ts");
const { storePrivateContent } = await import("../worker/pilot-policy.ts");
const { foldEvents } = await import("../src/model/events.ts");
const fiscalTables = ["document_jobs", "budget_reservations", "budget_counters", "cost_budget_reservations", "cost_budget_counters",
  "output_provider_calls", "output_operation_slots", "consequential_executions", "consequential_steps"];
const privateTables = ["events", "event_private_payloads", "private_content", "project_event_scopes", "project_resource_scopes", "private_content_retention_scopes"];
function rows(w, table) {
  return w.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    ? w.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all().map(row => ({ ...row })) : null;
}
const preserved = w => Object.fromEntries([...fiscalTables, ...privateTables].map(table => [table, rows(w, table)]));
async function body(response, status = 200) {
  const text = await response.text(); assert.equal(response.status, status, text); return JSON.parse(text);
}
const artifactEvent = page => page.events.findLast(event => event.type === "DocumentRenderCompleted" && event.payload.artifact_id === "saved-scene-story");

async function fixture(t, actor = "viewer", conversation = false) {
  const w = await createSceneCostFixture(1, "visual", { shared: true, depth: true });
  t.after(async () => { await w.drainBackground(); w.close(); });
  const share = w.sharing, ownerHeaders = { ...share.headers }, now = new Date().toISOString();
  let chat = null;
  if (conversation) {
    const content = "EXACT_OWNER_PRIVATE_CONVERSATION_ONLY";
    const stored = await storePrivateContent(w.env, w.owner, "chat-user", content, {
      organizationId: share.organizationId, projectAccessId: share.projectAccessId,
      projectId: w.projectId, ownerUserId: w.owner, actorUserId: w.owner,
    });
    const event = await appendAuditEvent(w.env, w.streamId, "user:" + w.owner, "ChatMessageSent", {
      project_id: w.projectId, document_id: w.documentId, content_ref: stored.contentId,
    });
    chat = { ...stored, content, eventId: event.eventId };
  }
  // Complete the ordinary projection before the observed read-only interval.
  await body(await w.request("/api/events?after=0&limit=5000&content=1"));
  let selectedContextId = share.contextId;
  if (actor === "viewer") {
    const id = "metadata-reference-viewer", email = "metadata-reference-viewer@example.invalid";
    w.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
      .run(id, email, "Metadata reference viewer", now, now, now);
    w.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,'member','active',?,?,?,?)")
      .run("metadata-reference-org", share.organizationId, id, w.owner, now, now, now);
    w.sqlite.prepare("INSERT INTO project_memberships(membership_id,organization_id,project_access_id,project_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'viewer','active',?,?,?)")
      .run("metadata-reference-project", share.organizationId, share.projectAccessId, w.projectId, id, w.owner, now, now);
    const identity = { "oai-authenticated-user-id": id, "oai-authenticated-user-email": email };
    w.setScopedHeaders(identity);
    const selected = await w.request("/api/workspaces/" + share.organizationId + "/projects/" + share.projectAccessId + "/context", { method: "POST" });
    await body(selected.clone());
    w.setScopedHeaders({ ...identity, cookie: selected.headers.get("set-cookie").split(";")[0] });
    selectedContextId = w.sqlite.prepare("SELECT context_id FROM project_context_sessions WHERE principal_user_id=? AND revoked_at IS NULL").get(id).context_id;
  }
  await body(await w.request("/api/session"));
  await w.drainBackground();
  const statements = [], reads = [];
  w.controls.beforeBatch = batch => {
    for (const statement of batch) if (statement.sql.includes("CROSS JOIN private_content content")) statements.push(statement.sql);
  };
  const path = route => route === "workspace"
    ? "/api/workspaces/" + share.organizationId + "/projects/" + share.projectAccessId + "/events" : "/api/events";
  const read = async (includeContent, route = "events", status = 200) => {
    const url = path(route) + "?after=0&limit=5000&content=" + Number(includeContent);
    reads.push({ url, method: "GET" }); return body(await w.request(url), status);
  };
  return { w, share, ownerHeaders, selectedContextId, chat, statements, reads, read, path };
}

for (const actor of ["owner", "viewer"]) for (const route of ["events", "workspace"]) {
  test("shared metadata preserves an eligible artifact reference without selecting its body: " + actor + "/" + route, { timeout: 20_000 }, async t => {
    const f = await fixture(t, actor), before = preserved(f.w);
    const full = await f.read(true, route);
    assert.equal(artifactEvent(full)?.payload.content_ref, f.w.contentRef, "Healthy existing full-content read retains the exact reference.");
    assert.equal(full.content[f.w.contentRef], f.w.content, "Original synthetic private bytes, not a manufactured returned body.");
    const offset = f.statements.length, metadata = await f.read(false, route);
    assert.equal(Object.hasOwn(metadata, "content"), false);
    assert.equal(JSON.stringify(metadata).includes(f.w.content), false);
    assert.deepEqual(preserved(f.w), before, "Both reads preserve original events/private custody and all nine financial/job tables.");
    assert.equal(f.reads.length, 2); assert.ok(f.reads.every(row => row.method === "GET"));
    t.diagnostic(JSON.stringify({ actor, route, knownReference: f.w.contentRef,
      fullReference: artifactEvent(full)?.payload.content_ref ?? null,
      metadataReference: artifactEvent(metadata)?.payload.content_ref ?? null,
      metadataHasContent: Object.hasOwn(metadata, "content"), metadataEligibilityQueries: f.statements.length - offset,
      unchangedOriginalRows: true, newProviderCalls: 0 }));
    assert.equal(artifactEvent(metadata)?.payload.content_ref, f.w.contentRef,
      "A metadata-only page must retain this same eligible reference for later authorized hydration.");
    const projection = foldEvents(metadata.events, Infinity, f.w.documentId, f.w.projectId);
    assert.equal(projection.libraryArtifacts.find(row => row.id === "saved-scene-story")?.contentRef, f.w.contentRef);
    const selected = f.statements.slice(offset);
    assert.equal(selected.length, 1, "Metadata uses the same single indexed eligibility query.");
    assert.equal(selected[0].slice(0, selected[0].indexOf(" FROM ")).trim(), "SELECT content.content_id",
      "Metadata does not project private_content.content bytes, even internally.");
    assert.deepEqual(metadata.events, full.events, "Body selection alone must not erase eligible event references.");
  });
}

const ineligible = [
  ["redacted", w => w.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), w.contentRef)],
  ["expired", w => w.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(w.contentRef)],
  ["missing private row", w => w.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(w.contentRef)],
  ["wrong private owner", w => w.sqlite.prepare("UPDATE private_content SET owner_id='unrelated-owner' WHERE content_id=?").run(w.contentRef)],
  ["private planning kind", w => w.sqlite.prepare("UPDATE private_content SET kind='document-artifact-input' WHERE content_id=?").run(w.contentRef)],
  ["provider receipt kind", w => w.sqlite.prepare("UPDATE private_content SET kind='provider-response' WHERE content_id=?").run(w.contentRef)],
  ["actor-private visibility", w => w.sqlite.prepare("UPDATE project_resource_scopes SET visibility='actor_private' WHERE resource_kind='content' AND resource_id=?").run(w.contentRef)],
  ["internal visibility", w => w.sqlite.prepare("UPDATE project_resource_scopes SET visibility='internal' WHERE resource_kind='content' AND resource_id=?").run(w.contentRef)],
  ["missing resource", w => w.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").run(w.contentRef)],
  ["wrong resource organization", w => w.sqlite.prepare("UPDATE project_resource_scopes SET organization_id='unrelated-org' WHERE resource_kind='content' AND resource_id=?").run(w.contentRef)],
  ["wrong resource owner", w => w.sqlite.prepare("UPDATE project_resource_scopes SET owner_user_id='unrelated-owner' WHERE resource_kind='content' AND resource_id=?").run(w.contentRef)],
  ["wrong resource project", w => w.sqlite.prepare("UPDATE project_resource_scopes SET project_access_id='unrelated-project-access' WHERE resource_kind='content' AND resource_id=?").run(w.contentRef)],
];
for (const [name, withdraw] of ineligible) {
  test("metadata and hydrated pages both withhold ineligible artifact content: " + name, { timeout: 20_000 }, async t => {
    const f = await fixture(t);
    assert.equal(withdraw(f.w).changes, 1, "The isolated RAM fault changed exactly this original row.");
    const before = preserved(f.w);
    for (const includeContent of [false, true]) {
      const page = await f.read(includeContent);
      assert.ok(artifactEvent(page), "The event exists; this is a reference-eligibility test, not an empty-page pass.");
      assert.equal(Object.hasOwn(artifactEvent(page).payload, "content_ref"), false);
      assert.equal(page.content?.[f.w.contentRef], undefined);
      assert.equal(JSON.stringify(page).includes(f.w.content), false);
      if (!includeContent) assert.equal(Object.hasOwn(page, "content"), false);
    }
    assert.deepEqual(preserved(f.w), before, "Read eligibility never repairs custody, changes private rows, or touches financial/job state.");
  });
}

for (const denied of ["membership", "context", "foreign workspace path"]) {
  test("shared metadata does not bypass current request authorization: " + denied, { timeout: 20_000 }, async t => {
    const f = await fixture(t);
    if (denied === "membership") assert.equal(f.w.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE membership_id='metadata-reference-project'").run(new Date().toISOString()).changes, 1);
    if (denied === "context") assert.equal(f.w.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), f.selectedContextId).changes, 1);
    const before = preserved(f.w);
    for (const includeContent of [false, true]) {
      const page = denied === "foreign workspace path"
        ? await body(await f.w.request("/api/workspaces/unrelated-org/projects/unrelated-project/events?after=0&content=" + Number(includeContent)), 403)
        : await f.read(includeContent, "events", 403);
      assert.equal(page.events, undefined); assert.equal(page.content, undefined);
      assert.equal(JSON.stringify(page).includes(f.w.contentRef), false);
    }
    assert.deepEqual(preserved(f.w), before); assert.equal(f.statements.length, 0);
  });
}

for (const condition of ["own retained", "own missing retention", "own expired", "other actor retained"]) {
  test("metadata preserves existing actor-private conversation boundaries: " + condition, { timeout: 20_000 }, async t => {
    const other = condition === "other actor retained", f = await fixture(t, other ? "viewer" : "owner", true);
    assert.ok(f.w.sqlite.prepare("SELECT 1 FROM private_content_retention_scopes WHERE content_id=?").get(f.chat.contentId));
    if (condition === "own missing retention") assert.equal(f.w.sqlite.prepare("DELETE FROM private_content_retention_scopes WHERE content_id=?").run(f.chat.contentId).changes, 1);
    if (condition === "own expired") assert.equal(f.w.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(f.chat.contentId).changes, 1);
    const before = preserved(f.w);
    for (const includeContent of [false, true]) {
      const page = await f.read(includeContent), event = page.events.find(row => row.eventId === f.chat.eventId);
      assert.ok(event, "The exact conversation event remains in the dense project cursor.");
      if (other) {
        assert.equal(event.type, "ProjectResourceRestricted"); assert.equal(event.payload.content_ref, undefined);
      } else {
        assert.equal(event.type, "ChatMessageSent");
        assert.equal(event.payload.content_ref, f.chat.contentId,
          "The existing own-conversation historical reference exception is unchanged, not a retained-body certificate.");
      }
      assert.equal(page.content?.[f.chat.contentId], includeContent && condition === "own retained" ? f.chat.content : undefined);
      if (!includeContent) assert.equal(Object.hasOwn(page, "content"), false);
      if (other || condition !== "own retained" || !includeContent) assert.equal(JSON.stringify(page).includes(f.chat.content), false);
    }
    assert.deepEqual(preserved(f.w), before);
  });
}
