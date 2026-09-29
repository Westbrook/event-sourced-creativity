import { test, expect, captureViewport } from "./fixtures.mjs";
import { tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";
import { classifyTestRequest, localTestOrigin } from "./helpers/read-only-network.mjs";
import { syntheticNetworkEnabled } from "./helpers/synthetic-network.mjs";
import { createHash } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
const baseSession = {
  user: { userId: "e6-network-synthetic-principal", email: "e6-network@example.invalid", displayName: "Synthetic E6 principal", role: "creator",
    consentVersion: "synthetic-fixture", consentedAt: "2026-09-03T12:00:00.000Z" },
  impersonation: null, audience: "creative", permissionEpoch: "retained-activity-reviews-recovery-r1", capabilities: ["self.profile.read", "project.read"],
  organizations: [], projects: [],
  policy: { version: "synthetic-fixture", accepted: true, passiveCapture: false,
    attentionCapture: { available: false, defaultOn: false, retentionDays: 14, rawInputCapture: false },
    externalAssetsRequireAssertion: true, retentionDays: 30, sharing: "synthetic-fixture-only" },
  canvas: { version: "synthetic-fixture", mode: "off", pilotAvailable: false, access: false, accessReason: "not-granted", blockedBy: [], requirements: [] },
  provider: { name: "No provider", model: "synthetic-fixture", configured: false, plannerConfigured: false, videoConfigured: false, audioConfigured: false, model3dConfigured: false },
  budgets: { period: "synthetic-fixture", user: { used: 0, reserved: 0, limit: 0 }, workspace: { used: 0, reserved: 0, limit: 0 } },
  costBudgets: { period: "synthetic-fixture", currency: "USD", user: { usedMicrousd: 0, reservedMicrousd: 0, limitMicrousd: 0, remainingMicrousd: 0 },
    workspace: { usedMicrousd: 0, reservedMicrousd: 0, limitMicrousd: 0, remainingMicrousd: 0 } },
  assistant: { enabled: false, phase: "read-only", capabilities: [], models: [] },
};


// This is separately DECLARED synthetic approved UI state, not a captured
// snapshot of the preceding RAM run and not an independent human review.
const markdown = "# The Signal Garden\n\nMara saved the last signal before dawn.\n\n“Keep the gate open,” she wrote — café, 雨, and 🌱 intact.\n\nThe garden answered.\n";
const hash = value => createHash("sha256").update(value).digest("hex");
const projectId = "story-browser-project", documentId = "story-browser-document", artifactId = "story-browser-artifact";
const ownerId = "story-browser-author", organizationId = "story-browser-org", accessId = "story-browser-access";
const reviewerId = baseSession.user.userId, contentRef = "story-browser-current-content", title = "Synthetic saved Story";
const raw = JSON.stringify({ title, summary: "Declared saved revision one", content_markdown: markdown, presentation: null,
  items: [{ id: "story-browser-part", title: "The Signal Garden", body: markdown, notes: "" }] });
const contentSha256 = hash(raw), now = "2026-09-03T12:00:00.000Z";
const session = { ...baseSession, permissionEpoch: "story-browser-revision-one",
  organizations: [{ organizationId, name: "Synthetic Story Organization", role: "member" }],
  projects: [{ organizationId, projectAccessId: accessId, projectId, projectName: "Synthetic Story Project", role: "viewer" }],
  projectContext: { organizationId, projectAccessId: accessId, projectId, ownerUserId: ownerId, role: "viewer",
    permissions: ["project.read", "project.review.approve"], expiresAt: "2099-09-03T12:00:00.000Z" } };
const scope = { project_id: projectId, document_id: documentId, artifact_id: artifactId, artifact_kind: "short_story",
  source_block_versions: [{ block_id: "story-browser-direction", version: 1 }] };
const binding = { ...scope, artifact_revision: 1, content_sha256: contentSha256 };
const row = (type, payload, index, actor = ownerId) => ({ eventId: `story-browser-declared-${index}`, streamId: `project:${accessId}`,
  sequence: index, occurredAt: now, recordedAt: now, actor: `user:${actor}`, clientId: "story-browser-fixture", correlationId: "story-browser-fixture",
  causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload });
const events = [
  row("ProjectCreated", { project_id: projectId, name: "Synthetic Story Project" }, 1),
  row("DocumentCreated", { project_id: projectId, document_id: documentId, title: "Synthetic Story Document" }, 2),
  row("BlockCreated", { project_id: projectId, document_id: documentId, block_id: "story-browser-direction", type: "direction",
    handle: "direction/story-browser", position: "a", properties: { text: "Keep the signal garden ending and exact Unicode prose.", weight: 1 } }, 3),
  row("DocumentRenderRequested", scope, 4),
  row("DocumentRenderCompleted", { ...scope, title, summary: "Declared saved Story", content_ref: contentRef, item_count: 1,
    requested_by_user_id: ownerId, provider: "synthetic-fixture", model_id: "synthetic-fixture" }, 5),
  row("DocumentArtifactEdited", { ...scope, revision: 1, content_ref: contentRef, edited_by_user_id: ownerId, changed_fields: ["content_markdown"] }, 6),
  row("ArtifactReviewRequested", { ...binding, assigned_reviewer_user_id: reviewerId }, 7),
  row("ArtifactApproved", binding, 8, reviewerId),
];
const exportInput = { type: "DocumentArtifactExported", payload: { artifact_id: artifactId, artifact_kind: "short_story", document_id: documentId,
  format: "markdown", artifact_revision: 1, content_sha256: contentSha256, source_surface: "library-artifact-viewer" } };
const exportEvent = row(exportInput.type, { ...exportInput.payload, project_id: projectId }, 9, reviewerId);
const exportRequest = { action: "append", event: exportInput, events: [exportInput], expectedSequence: 8, clientId: "web:lit" };
const entryPath = `/library/artifact/${artifactId}/synthetic-saved-story?revision=1&intent=inspect&sha256=${contentSha256}&document=${documentId}`;
const provenance = { mode: "declared-synthetic-approved-story-revision-one", source: "Eight new explicitly synthetic source/review events; own full-content hash. Embedded Markdown text matches the accepted 153-byte Story artifact.",
  limits: "Browser download and text-file proof only. Not the prior RAM session snapshot, human independent review, live authorization, recipient delivery or provider generation.",
  expected: { projectId, documentId, artifactId, revision: 1, contentSha256, reviewerId, editorId: ownerId, markdownSha256: hash(markdown) } };
const attach = (info, name, value) => info.attach(name, { body: JSON.stringify({ provenance, value }, null, 2), contentType: "application/json" });
test.use({ geometry: { viewport: { width: 1280, height: 900 }, zoom: 1, locale: "en-US" }, acceptDownloads: true });
async function custody(page, info, stage) {
  const value = await page.locator("forma-shell").evaluate(element => {
    const s = element.store, source = s.captureSourceOwnership();
    return { session: s.session.get(), events: s.events.get(), content: s.content.get(), source, sourceActive: s.sourceOwnershipActive(source),
      route: location.pathname + location.search, title: document.title, active: { tag: document.activeElement?.tagName, id: document.activeElement?.id } };
  });
  expect(value.session).toEqual(session); expect(value.sourceActive).toBe(true); expect(value.content[contentRef]).toBe(raw);
  expect(value.route).toBe(entryPath); await attach(info, stage, value); return value;
}
test("Story revision one: approved synthetic source downloads the exact Markdown file", async ({ page, context, baseURL }, info) => {
  expect(info.project.name).toBe("story-revision-download"); expect(syntheticNetworkEnabled(baseURL)).toBe(true);
  expect(Buffer.byteLength(markdown)).toBe(153); expect(hash(markdown)).toBe("33e0cda6f9ee579ee130bd446e1382c47a8793b3611b1160067644254a85b4b0");
  const origin = localTestOrigin(baseURL), pending = new Set(), counts = new Map(), downloads = [];
  const log = { provenance, documents: [], reads: [], exports: [], denied: [], handlerErrors: [], pageErrors: [] };
  let committed = false;
  const replies = new Map([
    ["/api/session", { min: 1, max: 4, body: session }], ["/api/workspaces/reviews", { min: 1, max: 6, body: { tasks: [] } }],
    ["/api/project-notifications", { min: 1, max: 5, body: { notifications: [] } }],
    [`/api/workspaces/${organizationId}/context-packages`, { min: 1, max: 5, body: { packages: [] } }],
    ["/api/document-jobs", { min: 0, max: 4, body: { jobs: [] } }], ["/api/document-jobs?scope=active", { min: 0, max: 4, body: { jobs: [] } }],
  ]);
  for (const after of [0, 8, 9]) for (const profile of ["full", "workspace", "projects"]) for (const content of [0, 1]) {
    const path = `/api/events?after=${after}&limit=${profile === "full" ? 5000 : 6500}&content=${content}${profile === "full" ? "" : "&profile=" + profile}`;
    replies.set(path, { min: 0, max: 4, body: () => { const rows = committed ? [...events, exportEvent] : events; return {
      events: rows.filter(event => event.sequence > after), head: rows.length, nextAfter: rows.length, hasMore: false, ...(content ? { content: { [contentRef]: raw } } : {}) }; } });
  }
  for (const after of [8, 9]) replies.set(`/api/events?after=${after}&limit=1&content=1`, { min: 0, max: 2, body: () => ({ events: [],
    head: committed ? 9 : 8, nextAfter: committed ? 9 : 8, hasMore: false, content: { [contentRef]: raw } }) });
  const serve = async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname + url.search;
    const input = { method: request.method(), url: url.href, resourceType: request.resourceType(), postData: request.postData() };
    const classification = classifyTestRequest(input, origin); if (classification === "suppressed-telemetry") return route.fallback();
    let decoded; try { decoded = decodeURIComponent(url.pathname); } catch { log.denied.push({ reason: "encoding" }); return route.abort("blockedbyclient"); }
    const isDocument = request.resourceType() === "document";
    if (!isDocument && !/^\/api(?:\/|$)/i.test(decoded)) return route.fallback();
    const identity = url.origin === origin && !url.username && !url.password && !url.hash && request.frame() === page.mainFrame();
    if (identity && path === "/api/events" && request.method() === "POST" && !request.isNavigationRequest() && !committed) {
      expect(request.postDataJSON()).toEqual(exportRequest); committed = true;
      log.exports.push({ ...input, body: request.postDataJSON(), response: { appended: [exportEvent], head: 9 } });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ appended: [exportEvent], head: 9 }) });
    }
    const reply = replies.get(path);
    if (!identity || request.postData() !== null || request.method() !== "GET" || classification !== "read"
      || (isDocument ? path !== entryPath || !request.isNavigationRequest() || log.documents.length > 0 : request.isNavigationRequest() || !reply)) {
      log.denied.push(input); return route.abort("blockedbyclient");
    }
    if (isDocument) { log.documents.push(input); return route.continue(); }
    const count = (counts.get(path) ?? 0) + 1; expect(count, path).toBeLessThanOrEqual(reply.max); counts.set(path, count);
    const body = JSON.stringify(typeof reply.body === "function" ? reply.body() : reply.body);
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "private, no-store" }, body });
    log.reads.push({ path, count, status: 200, bytes: Buffer.byteLength(body), sha256: hash(body) });
  };
  const handler = route => { const result = serve(route); pending.add(result); void result.then(() => pending.delete(result), error => { pending.delete(result); log.handlerErrors.push(String(error)); }); return result; };
  const onError = error => log.pageErrors.push(String(error)), onDownload = download => downloads.push(download);
  let complete = false;
  const verify = () => {
    expect(pending.size).toBe(0); expect(downloads).toHaveLength(1); expect(log.exports).toHaveLength(1); expect(log.documents).toHaveLength(1);
    for (const [path, reply] of replies) { expect(counts.get(path) ?? 0, path).toBeGreaterThanOrEqual(reply.min); expect(counts.get(path) ?? 0, path).toBeLessThanOrEqual(reply.max); }
    expect(log.denied).toEqual([]); expect(log.handlerErrors).toEqual([]); expect(log.pageErrors).toEqual([]);
  };
  await context.route("**/*", handler); page.on("pageerror", onError); page.on("download", onDownload);
  try {
    const response = await page.goto(entryPath, { waitUntil: "domcontentloaded" }); expect(response.status()).toBe(200);
    expect(await response.text()).not.toMatch(/id=["']forma-session-bootstrap["']/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US"); await page.evaluate(() => document.fonts.ready);
    const dialog = page.getByRole("dialog", { name: title, exact: true }); await expect(dialog).toBeVisible();
    await expect(dialog.locator(".artifact-review-status")).toHaveText("Approved"); await expect(dialog).toContainText("Mara saved the last signal before dawn.");
    const before = await custody(page, info, "before-download"); expect(before.events).toEqual(events); expect(downloads).toHaveLength(0);
    const menu = dialog.locator(".artifact-viewer-actions-popover section:popover-open");
    if (!await menu.isVisible()) { const more = dialog.getByRole("button", { name: "More actions", exact: true }); await tabTo(page, more, 100); await page.keyboard.press("Enter"); }
    await expect(menu).toBeVisible(); const button = menu.getByRole("button", { name: "Download Markdown", exact: true });
    await expect(button).toBeEnabled(); await tabTo(page, button, 100); await verifyFocus(page, button, info, "story-markdown-download-focus");
    await captureViewport(page, info, "story-ready-to-download");
    const waiting = page.waitForEvent("download"); await page.keyboard.press("Enter"); const download = await waiting;
    expect(download.page()).toBe(page); expect(await download.failure()).toBeNull(); expect(download.suggestedFilename()).toBe("synthetic-saved-story.md");
    const stream = await download.createReadStream(); expect(stream).not.toBeNull(); const chunks = []; let size = 0;
    for await (const chunk of stream) { size += chunk.length; if (size > 4096) throw new Error("Story download exceeded the finite 4 KiB cap"); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks); expect(bytes.length).toBe(153); expect(hash(bytes)).toBe(hash(markdown));
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(markdown);
    const path = info.outputPath("synthetic-saved-story.md"); await writeFile(path, bytes, { flag: "wx" }); expect(await readFile(path)).toEqual(bytes);
    await info.attach("actual-browser-story.md", { path, contentType: "text/markdown" });
    await attach(info, "story-download-opened", { path, filename: download.suggestedFilename(), bytes: bytes.length, sha256: hash(bytes), fatalUtf8: true });
    await expect.poll(() => pending.size).toBe(0); const after = await custody(page, info, "after-download");
    expect(after.events).toEqual([...events, exportEvent]); expect(after.content).toEqual(before.content); expect(after.source).toEqual(before.source);
    verify(); await captureViewport(page, info, "story-after-download"); complete = true;
  } finally {
    await context.unroute("**/*", handler); await Promise.allSettled([...pending]);
    await attach(info, "story-download-transport", { ...log, counts: Object.fromEntries(counts), pending: pending.size, downloads: downloads.length });
    page.off("pageerror", onError); page.off("download", onDownload); if (complete) verify();
  }
});
