import assert from "node:assert/strict";
import test from "node:test";
import { SITE_ROUTE_ENTRIES } from "../src/platform/applications.ts";
import { ASSISTANT_PAGE_PLAYBOOKS, ASSISTANT_PLATFORM_ROUTE_PLAYBOOKS, assistantInteractionForSurface, assistantPlaybookForSurface, assistantSurfaceForRoute } from "../src/model/assistant-route-policy.ts";

test("every registered route has a bounded page-specific assistant playbook", () => {
  assert.equal(SITE_ROUTE_ENTRIES.length, 62);
  for (const entry of SITE_ROUTE_ENTRIES) {
    const surface = assistantSurfaceForRoute(entry.path);
    assert.equal(surface.application, entry.application, entry.path);
    assert.ok(Array.isArray(ASSISTANT_PAGE_PLAYBOOKS[surface.page]), entry.path);
    assert.equal(surface.available, entry.path !== "/share", entry.path);
    assert.equal(surface.host, entry.path === "/share" ? "public" : ["creative", "canvas"].includes(entry.application) ? "creator" : "platform", entry.path);
  }
});

test("all 38 privileged routes have explicit task-specific playbooks, including protected aliases", () => {
  const privileged = SITE_ROUTE_ENTRIES.filter((entry) => !["creative", "canvas"].includes(entry.application));
  assert.equal(privileged.length, 38);
  assert.equal(Object.keys(ASSISTANT_PLATFORM_ROUTE_PLAYBOOKS).length, privileged.length);
  for (const entry of privileged) {
    const surface = assistantSurfaceForRoute(entry.path);
    assert.deepEqual(assistantPlaybookForSurface(surface), ASSISTANT_PLATFORM_ROUTE_PLAYBOOKS[entry.path], entry.path);
    assert.ok(assistantPlaybookForSurface(surface).length >= 3, entry.path);
  }
  assert.notDeepEqual(assistantPlaybookForSurface(assistantSurfaceForRoute("/operations/providers")),
    assistantPlaybookForSurface(assistantSurfaceForRoute("/operations/access")));
  assert.notDeepEqual(assistantPlaybookForSurface(assistantSurfaceForRoute("/engineering/events")),
    assistantPlaybookForSurface(assistantSurfaceForRoute("/engineering/sync")));
});

test("public share links never inherit the authenticated Creator assistant", () => {
  for (const route of ["/share", "/share/secret-token"]) {
    const surface = assistantSurfaceForRoute(route);
    assert.equal(surface.host, "public");
    assert.equal(surface.page, "public-share");
    assert.equal(surface.available, false);
  }
});

test("dynamic document, focused block, canvas, and library routes retain exact identities", () => {
  const document = assistantSurfaceForRoute("/document/document-a/launch/view/editor#context=block-a");
  assert.equal(document.page, "editor");
  assert.equal(document.documentId, "document-a");
  assert.equal(document.focusedBlockId, "block-a");
  const canvas = assistantSurfaceForRoute("/canvas/canvas-a/launch/view/compare");
  assert.equal(canvas.page, "canvas");
  assert.equal(canvas.canvasId, "canvas-a");
  assert.deepEqual(canvas.requiredCapabilities, ["project.canvas.use"]);
  const library = assistantSurfaceForRoute("/library/block/block-a");
  assert.equal(library.page, "library");
  assert.equal(library.focusedBlockId, "block-a");
});

test("every registered route resolves to exactly one authorized conversation owner", () => {
  const entitled = { enabled: true, canAuthor: true, canGenerate: true, canEditCanvas: true, providerConfigured: true, personal: true };
  for (const entry of SITE_ROUTE_ENTRIES) {
    const surface = assistantSurfaceForRoute(entry.path);
    const interaction = assistantInteractionForSurface(surface, entitled);
    if (surface.host === "public") assert.deepEqual(interaction, { presentation: "none", owner: "none", scope: "page", modes: [] }, entry.path);
    else if (surface.host === "platform") assert.equal(interaction.owner, "platform-assistant", entry.path);
    else if (surface.page === "chat") assert.equal(interaction.owner, "creative-chat", entry.path);
    else assert.equal(interaction.owner, "assistant", entry.path);
    assert.equal(new Set(interaction.modes).size, interaction.modes.length, entry.path);
  }
});

test("specialized document, adaptive, board, and chat modes require their exact capability and provider", () => {
  const entitled = { enabled: true, canAuthor: true, canGenerate: true, canEditCanvas: true, providerConfigured: true, personal: true };
  const document = assistantSurfaceForRoute("/document/document-a/launch");
  const adaptive = assistantSurfaceForRoute("/document/document-a/launch/view/adaptive");
  const chat = assistantSurfaceForRoute("/document/document-a/launch/view/chat");
  const board = assistantSurfaceForRoute("/canvas/canvas-a/launch");
  assert.deepEqual(assistantInteractionForSurface(document, entitled).modes, ["guidance", "creative-chat", "quick-edit"]);
  assert.deepEqual(assistantInteractionForSurface(adaptive, entitled).modes, ["guidance", "plan-document"]);
  assert.deepEqual(assistantInteractionForSurface(board, entitled).modes, ["guidance", "plan-board"]);
  assert.deepEqual(assistantInteractionForSurface(adaptive, {...entitled,providerConfigured:false}).modes,["guidance","plan-document"],"free planning preview does not require a provider key");
  assert.deepEqual(assistantInteractionForSurface(board, {...entitled,providerConfigured:false}).modes,["guidance","plan-board"]);
  assert.deepEqual(assistantInteractionForSurface(chat, entitled), { presentation: "embedded", owner: "creative-chat", scope: "document", modes: ["creative-chat"] });
  assert.deepEqual(assistantInteractionForSurface(chat, { ...entitled, providerConfigured: false }).modes, ["guidance"]);
  assert.equal(assistantInteractionForSurface(chat, { ...entitled, providerConfigured: false }).owner, "assistant");
  assert.deepEqual(assistantInteractionForSurface(adaptive, { ...entitled, canGenerate: false }).modes, ["guidance"]);
  assert.deepEqual(assistantInteractionForSurface(board, { ...entitled, canEditCanvas: false }).modes, ["guidance"]);
  assert.deepEqual(assistantInteractionForSurface(document, { ...entitled, personal: false }).modes, ["guidance", "creative-chat"]);
  assert.deepEqual(assistantInteractionForSurface(document, { ...entitled, providerConfigured: false }).modes, ["guidance", "quick-edit"]);
  assert.equal(assistantInteractionForSurface(document, { ...entitled, enabled: false }).presentation, "none");
});
