import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { registerOutputSourceImports, outputTestDatabase } from "./output-server-test-helpers.mjs";
import { png, readStoredZip } from "./output-asset-fixtures.mjs";

// Reuse the current source resolver. The runner installs the existing scrubbed
// no-provider preload before these imports; no execution bridge is supplied.
const hooks = registerOutputSourceImports();
const [{ ensureSchema, makeEvent, appendEvents }, { handleOutputRequirements },
  { handleWorkspaces }, { synchronizeProjectScope }, { handleEvents },
  { POLICY_VERSION }, { parseOutputRequirement }, { inspectOutputAsset }] = await Promise.all([
  import("../worker/runtime.ts"), import("../worker/output-requirements-api.ts"),
  import("../worker/workspaces-api.ts"), import("../worker/project-access.ts"), import("../worker/events-api.ts"),
  import("../worker/pilot-policy.ts"), import("../src/model/output-requirements.ts"), import("../src/model/output-asset-inspection.ts"),
]).finally(() => hooks.deregister());

const owner = "dev-local-creative", reviewer = "image-file-reviewer";
const project = "image-file-project", documentId = "image-file-document", sourceId = "image-file-direction";
const base = "/api/output-requirements", stream = `creative:${owner}`;
const originalText = "Declared color reference for the café and 雨 study. Preserve this source exactly. 🌱";
const name = "Café 雨 color reference.png";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const jsonBody = body => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const paidTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters", "output_execution_grants", "output_operation_slots", "output_provider_calls"];

async function responseJson(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

async function sharedImageFixture(t) {
  const f = outputTestDatabase();
  t.after(() => f.sqlite.close());
  await ensureSchema(f.env);
  const now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)")
    .run(owner, "creative@local.forma", "Local creative", POLICY_VERSION, now, now, now);
  await appendEvents(f.env, [
    makeEvent(stream, 0, `user:${owner}`, "image-file-fixture", "seed", "ProjectCreated", { project_id: project, name: "Image file custody" }),
    makeEvent(stream, 0, `user:${owner}`, "image-file-fixture", "seed", "DocumentCreated", { project_id: project, document_id: documentId, title: "Café 雨 color reference", handle: "image-file-document" }),
    makeEvent(stream, 0, `user:${owner}`, "image-file-fixture", "seed", "BlockCreated", { project_id: project, document_id: documentId, block_id: sourceId, scope: "document", type: "direction", position: "a0", handle: "direction/image-file", properties: { text: originalText, authority: "authored", weight: 1 } }),
  ]);
  // Existing shared Output fixture pattern: real workspace/context routes and
  // synthetic RAM memberships. No result, approval or delivery row is seeded.
  const workspace = (path, body, headers = {}) => handleWorkspaces(new Request(`http://localhost/api/workspaces${path.length ? "/" + path.join("/") : ""}`,
    { ...(body ? jsonBody(body) : { method: "POST" }), headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers } }), f.env, path);
  const created = await responseJson(await workspace([], { name: "Image exact file review" }), 201);
  const organizationId = created.organizationId;
  const attached = await responseJson(await workspace([organizationId, "projects"], { projectId: project }), 201);
  const projectAccessId = attached.projectAccessId, contextPath = [organizationId, "projects", projectAccessId, "context"];
  const ownerSelection = await workspace(contextPath);
  await responseJson(ownerSelection.clone());
  const ownerHeaders = { cookie: ownerSelection.headers.get("set-cookie")?.split(";")[0] };
  assert.ok(ownerHeaders.cookie);
  const reviewerEmail = "image-reviewer@local.forma";
  f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)")
    .run(reviewer, reviewerEmail, "Independent image reviewer", POLICY_VERSION, now, now, now);
  f.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,'member','active',?,?,?,?)")
    .run("image-reviewer-organization", organizationId, reviewer, owner, now, now, now);
  f.sqlite.prepare("INSERT INTO project_memberships(membership_id,organization_id,project_access_id,project_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'viewer','active',?,?,?)")
    .run("image-reviewer-project", organizationId, projectAccessId, project, reviewer, owner, now, now);
  f.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,'project.review.approve','project',?,?,?,'active',?,?,?)")
    .run("image-reviewer-capability", reviewer, organizationId, projectAccessId, project, owner, now, now);
  const reviewerIdentity = { "oai-authenticated-user-id": reviewer, "oai-authenticated-user-email": reviewerEmail };
  const reviewerSelection = await workspace(contextPath, undefined, reviewerIdentity);
  await responseJson(reviewerSelection.clone());
  const reviewerHeaders = { ...reviewerIdentity, cookie: reviewerSelection.headers.get("set-cookie")?.split(";")[0] };
  assert.ok(reviewerHeaders.cookie);
  await synchronizeProjectScope(f.env, { organizationId, projectAccessId, projectId: project, ownerUserId: owner });
  const execution = { waitUntil() { assert.fail("no background work in owned Image file review"); } };
  const send = (path = `${base}?documentId=${documentId}`, init = {}, actor = "owner") => handleOutputRequirements(new Request(`http://localhost${path}`,
    { ...init, headers: { ...Object.fromEntries(new Headers(init.headers ?? {})), ...(actor === "reviewer" ? reviewerHeaders : ownerHeaders) } }), f.env, path.split("?")[0], execution);
  const snapshot = (actor = "owner") => send(undefined, {}, actor).then(responseJson);
  let sequence = 0;
  const command = async (body, actor = "owner", status = 200) => {
    const current = await snapshot(actor);
    return responseJson(await send(base, jsonBody({ documentId, clientMutationId: `image-file-${++sequence}`, expectedRevision: current.revision, ...body }), actor), status);
  };
  const upload = async bytes => {
    const current = await snapshot();
    return responseJson(await send(`${base}/assets?documentId=${documentId}`, { method: "POST", headers: {
      "content-type": "image/png", "x-output-filename": encodeURIComponent(name), "x-output-rights-confirmed": "true",
      "x-output-expected-revision": current.revision, "x-output-client-mutation-id": `image-file-upload-${++sequence}`,
    }, body: bytes }));
  };
  const scopeKey = `project:${organizationId}:${projectAccessId}`;
  const history = () => f.sqlite.prepare("SELECT * FROM events WHERE stream_id=? ORDER BY sequence").all(stream);
  const acceptances = () => f.sqlite.prepare("SELECT * FROM output_target_acceptances WHERE scope_key=? ORDER BY acceptance_id").all(scopeKey);
  const deliveries = () => f.sqlite.prepare("SELECT * FROM output_delivery_manifests WHERE scope_key=? ORDER BY manifest_id").all(scopeKey);
  return { ...f, send, snapshot, command, upload, ownerHeaders, organizationId, projectAccessId, scopeKey, history, acceptances, deliveries };
}

test("Image exact result needs a distinct reviewer and survives real PNG/ZIP file readback before stale-source refusal", { timeout: 60_000 }, async t => {
  let externalAttempts = 0;
  t.mock.method(globalThis, "fetch", async () => { externalAttempts++; assert.fail("no external or provider transport in Image file review"); });
  const explicitDirectory = process.env.FORMA_IMAGE_REVIEW_OUTPUT;
  if (explicitDirectory) { assert.equal(isAbsolute(explicitDirectory), true); await mkdir(explicitDirectory); }
  const outputDirectory = explicitDirectory || await mkdtemp(join(tmpdir(), "forma-image-review-file-"));
  // Keep the first actual files even if a later assertion fails. A caller-supplied
  // directory must be new; wx writes cannot silently replace previous evidence.
  t.diagnostic("IMAGE_REVIEW_FILE_DIRECTORY " + outputDirectory);
  const preserve = async (filename, bytes) => {
    const file = join(outputDirectory, filename);
    await writeFile(file, bytes, { flag: "wx" });
    const reopened = new Uint8Array(await readFile(file));
    assert.deepEqual(reopened, new Uint8Array(bytes));
    return { file, reopened, byteLength: reopened.byteLength, sha256: sha256(reopened) };
  };
  const f = await sharedImageFixture(t);
  await f.snapshot();
  const counts = () => Object.fromEntries(paidTables.map(table => [table, f.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  const initialCounts = counts();
  assert.ok(Object.values(initialCounts).every(value => value === 0));
  try {
    const spec = parseOutputRequirement({ id: "image-file-output", type: "Output", subtype: "Social media image", content: 'Output one image at aspect ratio "1:1".' }).spec;
    assert.ok(spec); assert.equal(spec.deliverables.length, 1);
    const image = spec.deliverables[0];
    assert.equal(image.media_kind, "image"); assert.equal(image.format_variants.length, 1);
    image.quantity = { kind: "exact", unit: "image", value: 1 };
    image.format_variants[0].quantity = { kind: "exact", unit: "image", value: 1 };
    await f.command({ action: "save", blockId: spec.id, spec });
    const confirmed = await f.command({ action: "confirm" }), plan = confirmed.snapshot.confirmedPlan;
    assert.equal(plan.plan.targets.length, 1);
    const target = plan.plan.targets[0];
    assert.deepEqual(target.blocking_issues, []); assert.equal(target.required, true);
    assert.equal(confirmed.snapshot.permissions.independentReview, true);
    const width = 24, height = 24, stride = width * 4 + 1, raw = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(x < 12 ? [40, 90, 180, 255] : [30, 160, 100, 255], y * stride + 1 + x * 4);
    const bytes = png({ width, height, raw }), hash = sha256(bytes);
    const uploaded = await f.upload(bytes), assetId = uploaded.command.assetId;
    const asset = uploaded.snapshot.assets.find(value => value.id === assetId);
    assert.ok(asset); assert.equal(asset.name, name); assert.equal(asset.sha256, hash);
    assert.equal(asset.createdByUserId, owner); assert.equal(asset.mimeType, "image/png");
    assert.deepEqual(asset.inspection.facts, { width, height });
    const bound = await f.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId });
    const resultId = bound.command.resultId, candidate = bound.snapshot.results.find(value => value.id === resultId);
    assert.ok(candidate); assert.equal(candidate.review, "pending"); assert.equal(candidate.checksStatus, "passed");
    assert.equal(candidate.resultRevision, hash); assert.equal(candidate.sha256, hash);
    assert.equal(candidate.sourceDigest, plan.sourceDigest); assert.equal(candidate.targetContractDigest, plan.targetContractDigests[target.id]);
    assert.equal(candidate.createdByUserId, owner); assert.equal(candidate.reviewAllowed, false);
    assert.equal(bound.snapshot.summary.delivery_ready, false); assert.deepEqual(f.acceptances(), []);
    const approval = { action: "review", resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true,
      note: "Synthetic reviewer checks this declared color fixture against the retained source and exact file. No human or visual-quality acceptance is claimed." };
    const beforeSelfReview = f.history();
    const selfReview = await f.command(approval, "owner", 403);
    assert.equal(selfReview.errorCode, "independent_output_reviewer_required");
    assert.deepEqual(f.history(), beforeSelfReview); assert.deepEqual(f.acceptances(), []);
    const reviewerSnapshot = await f.snapshot("reviewer");
    assert.equal(reviewerSnapshot.results.find(value => value.id === resultId).reviewAllowed, true);
    // The reviewer obtains the exact file through the real inspection-download
    // route. These are the first HTTP bytes preserved, not the upload argument.
    const fileResponse = await f.send(asset.downloadUrl, {}, "reviewer");
    assert.equal(fileResponse.status, 200); assert.equal(fileResponse.headers.get("content-type"), "image/png");
    const file = await preserve(name, new Uint8Array(await fileResponse.arrayBuffer()));
    assert.equal(fileResponse.headers.get("x-output-sha256"), hash); assert.equal(file.sha256, hash);
    assert.deepEqual(file.reopened, bytes);
    const inspected = await inspectOutputAsset(file.reopened, name);
    assert.equal(inspected.status, "inspected"); assert.equal(inspected.sha256, hash); assert.deepEqual(inspected.facts, { width, height });
    assert.ok(inspected.checks.includes("png-chunks-and-crc")); assert.ok(inspected.checks.includes("png-inflated-scanline-layout"));
    assert.ok(inspected.limitationCodes.includes("output_png_visual_review_required"));
    const reviewed = await f.command(approval, "reviewer"), acceptanceId = reviewed.command.acceptanceId;
    assert.notEqual(owner, reviewer); assert.equal(reviewed.appended.length, 1);
    const accepted = reviewed.appended[0];
    assert.equal(accepted.type, "OutputTargetAccepted"); assert.equal(accepted.actor, `user:${reviewer}`);
    const exact = { result_id: resultId, target_id: target.id, plan_revision_id: plan.revisionId, acceptance_id: acceptanceId,
      content_sha256: hash, result_revision: hash, target_contract_digest: plan.targetContractDigests[target.id], source_digest: plan.sourceDigest,
      reviewer_user_id: reviewer, reviewed_coverage: true, reviewed_rights: true, project_id: project, document_id: documentId, actor_user_id: reviewer };
    for (const [key, value] of Object.entries(exact)) assert.equal(accepted.payload[key], value, key);
    const approvalRows = f.acceptances(); assert.equal(approvalRows.length, 1);
    assert.equal(approvalRows[0].approval_event_id, accepted.eventId); assert.equal(approvalRows[0].reviewer_user_id, reviewer);
    assert.equal(approvalRows[0].content_sha256, hash); assert.equal(approvalRows[0].result_revision, hash);
    assert.equal(reviewed.snapshot.summary.delivery_ready, true);
    const prepared = await f.command({ action: "export", planRevisionId: plan.revisionId }, "reviewer");
    assert.equal(prepared.command.partCount, 1); assert.equal(prepared.appended.length, 1);
    const delivered = prepared.appended[0];
    assert.equal(delivered.type, "OutputDeliveryPrepared"); assert.equal(delivered.actor, `user:${reviewer}`);
    assert.equal(delivered.payload.manifest.sourceDigest, plan.sourceDigest);
    assert.equal(delivered.payload.manifest.planRevisionId, plan.revisionId);
    assert.deepEqual(delivered.payload.manifest.entries, [{ targetId: target.id, assetId, acceptanceId, resultId, resultRevision: hash, sha256: hash, targetContractDigest: plan.targetContractDigests[target.id] }]);
    const zipResponse = await f.send(prepared.command.downloadUrl, {}, "reviewer");
    assert.equal(zipResponse.status, 200); assert.equal(zipResponse.headers.get("content-type"), "application/zip");
    const archive = await preserve("image-checked-delivery.zip", new Uint8Array(await zipResponse.arrayBuffer()));
    assert.equal(zipResponse.headers.get("x-output-sha256"), archive.sha256);
    assert.equal(zipResponse.headers.get("x-output-delivery-completion"), "complete");
    const members = readStoredZip(archive.reopened), manifest = JSON.parse(new TextDecoder().decode(members.get("manifest.json")));
    assert.equal(members.size, 3); assert.ok(members.has("manifest.csv"));
    assert.equal(manifest.deliveryId, prepared.command.manifestId); assert.equal(manifest.planRevision, plan.revisionId);
    assert.equal(manifest.deliveryStatus, "complete"); assert.equal(manifest.files.length, 1);
    assert.deepEqual(manifest.targets, [{ targetId: target.id, fileId: assetId, acceptanceId }]);
    const packed = manifest.files[0];
    assert.equal(packed.id, assetId); assert.equal(packed.name, name); assert.equal(packed.sha256, hash);
    assert.equal(packed.byteLength, bytes.length); assert.equal(packed.mimeType, "image/png");
    assert.deepEqual(members.get(packed.path), file.reopened);
    assert.equal(sha256(members.get(packed.path)), hash);
    // Exercise a real shared source edit; approval stays historical but cannot
    // qualify this different source. This is not a fabricated Image edit/revision.
    const edited = await responseJson(await handleEvents(new Request("http://localhost/api/events", {
      ...jsonBody({ events: [{ type: "BlockPropertyEdited", payload: { project_id: project, document_id: documentId, block_id: sourceId, property_path: "text", new_value: originalText + " Changed source: use the later green reference." } }] }),
      headers: { "content-type": "application/json", ...f.ownerHeaders },
    }), f.env));
    assert.equal(edited.appended.length, 1); assert.equal(edited.appended[0].type, "BlockPropertyEdited");
    const staleHistory = f.history(), originalDeliveries = f.deliveries();
    const stale = await f.snapshot("reviewer");
    assert.notEqual(stale.sourceRevision, plan.sourceDigest); assert.equal(stale.summary.delivery_ready, false);
    const refused = await f.command(approval, "reviewer", 409);
    assert.equal(refused.errorCode, "output_plan_needs_reconfirmation");
    const staleDownload = await f.send(prepared.command.downloadUrl, {}, "reviewer");
    const staleDelivery = await responseJson(staleDownload, 409);
    assert.equal(staleDelivery.errorCode, "output_plan_needs_reconfirmation");
    assert.deepEqual(f.acceptances(), approvalRows); assert.deepEqual(f.deliveries(), originalDeliveries); assert.deepEqual(f.history(), staleHistory);
    assert.equal(sha256(await readFile(file.file)), hash); assert.equal(sha256(await readFile(archive.file)), archive.sha256);
    const receipt = { schemaVersion: 1, scope: "governed-owned-image-file", documentId, projectId: project, sourceDigest: plan.sourceDigest,
      planRevisionId: plan.revisionId, targetId: target.id, targetContractDigest: plan.targetContractDigests[target.id], assetId, resultId,
      resultRevision: hash, sha256: hash, author: owner, syntheticReviewer: reviewer, acceptanceEvent: accepted, deliveryEvent: delivered,
      files: [file, archive].map(({ file: path, byteLength, sha256 }) => ({ path, byteLength, sha256 })),
      checks: { pngReopened: true, pngCrcAndInflatedScanlines: true, zipReopened: true, zipCrcAndExactImage: true, selfReviewStatus: 403, staleReviewStatus: 409, staleDeliveryStatus: 409 },
      limitations: ["Synthetic distinct principals; no human review.", "Synthetic owned PNG; no native Image Save/Create/Edit replay or provider generation.", "Reopened PNG structure/scanlines and ZIP bytes; no independent pixel rendering, browser download, or visual-quality acceptance."] };
    await writeFile(join(outputDirectory, "image-review-file-receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    t.diagnostic("IMAGE_REVIEW_FILE " + JSON.stringify({ outputDirectory, resultId, resultRevision: hash, acceptanceId, fileSha256: file.sha256, archiveSha256: archive.sha256 }));
  } finally {
    assert.equal(externalAttempts, 0); assert.deepEqual(counts(), initialCounts, "no job, provider or financial admission");
  }
});
