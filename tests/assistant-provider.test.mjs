import assert from "node:assert/strict";
import test from "node:test";
import { providerFacingAssistantViews } from "../worker/assistant-provider.ts";

test("provider views use current page and recent actor-owned work without source transcripts or disabled audio", () => {
  const safe = providerFacingAssistantViews({
    surface: { page: "canvas", canonicalFamily: "/canvas/:canvas" },
    scope: { actorUserId: "SECRET-ACTOR", organizationId: "SECRET-ORG", projectAccessId: "SECRET-ACCESS", projectId: "SECRET-PROJECT", documentId: "SECRET-DOCUMENT" },
    playbook: ["inspect-selected-items", "explain-board"],
    documentTitle: "Visible campaign direction",
    selectedItems: [{ id: "SECRET-CANVAS-ITEM", kind: "document", title: "Chosen campaign", sourceId: "SECRET-SOURCE", documentId: "SECRET-DOCUMENT" }],
    recentActions: [{ id: "SECRET-EVENT", type: "BlockCreated", sequence: 88 }],
    recentTurns: Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `Recent ${index}` })),
    decisionAtoms: [
      { id: "allowed-direction", type: "direction", text: "A warm inclusive product launch", intent: "include", locked: false, immutable: false, providerEligible: true },
      { id: "private-source", type: "reference", text: "SECRET LICENSED SOURCE TRANSCRIPT", intent: "include", locked: true, immutable: true, providerEligible: true },
      { id: "private-audio", type: "audio", text: "SECRET PRIVATE AUDIO RECORDING", intent: "include", locked: false, immutable: false, providerEligible: false },
    ],
    relationships: [{ id: "SECRET-EDGE", from: "allowed-direction", to: "private-source", kind: "context_contains" }],
    unfinishedIntents: [{ id: "SECRET-INTENT", kind: "audio", status: "pending", nextAction: "Review the existing audio", route: "/private" }],
    availableOutputKinds: ["image", "slides", "audio"],
    availableOutputs: [{ id: "SECRET-OUTPUT", kind: "audio", title: "Approved music", status: "ready", documentId: "SECRET-DOCUMENT" }],
  }, "What audio already exists?");

  assert.equal(safe.page, "canvas");
  assert.deepEqual(safe.page_playbook, ["inspect-selected-items", "explain-board"]);
  assert.equal(safe.available_formats.includes("audio"), true);
  assert.equal(safe.blocks.length, 1);
  assert.equal(safe.blocks[0].text, "A warm inclusive product launch");
  assert.equal(safe.relationships.length, 0);
  assert.equal(safe.recent_conversation.length, 6);
  assert.doesNotMatch(JSON.stringify(safe), /SECRET-|source transcript|PRIVATE AUDIO/iu);
});
