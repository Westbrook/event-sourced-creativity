import assert from "node:assert/strict";
import test from "node:test";
import { appEntryPath, documentEntryPath, documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, libraryFocusFromRoute, libraryFocusRoute, libraryRootRoute, routePathname, withDocumentFocusInRoute, withDocumentInRoute } from "../src/model/routes.ts";

test("document views use a readable path for the selected durable document", () => {
  const paths = [["/", "document"], ["/studio/board", "board"], ["/studio/guided", "guided"], ["/studio/layers", "layers"], ["/studio/adaptive", "adaptive"], ["/studio/editor", "editor"]];
  for (const [path, view] of paths) {
    const routed = withDocumentInRoute(path, "document-42", "Evening Atmosphere");
    assert.equal(documentIdFromRoute(routed), "document-42");
    assert.equal(documentViewFromRoute(routed), view);
    assert.match(routePathname(routed), /^\/document\/document-42\/evening-atmosphere/);
    assert.equal(isDocumentViewRoute(routed), true);
  }
  assert.equal(withDocumentInRoute("/", "document-42"), "/document/document-42");
});

test("document routing preserves unrelated query state and fragments", () => {
  assert.equal(withDocumentInRoute("/studio/board?focus=palette#decision", "document 42", "Mood Study"), "/document/document%2042/mood-study/view/board?focus=palette#decision");
  assert.equal(withDocumentInRoute("/document/old/old-name/view/board?focus=palette", "new", "New Name"), "/document/new/new-name/view/board?focus=palette");
  assert.equal(withDocumentInRoute("/admin/events/replay", "document-42"), "/admin/events/replay");
  assert.equal(documentIdFromRoute("/library?document=document-42"), null);
});

test("focus mode is a durable document path state", () => {
  const editor = withDocumentInRoute("/studio/editor", "document-42", "Evening Atmosphere");
  const focused = withDocumentFocusInRoute(editor, true);
  assert.equal(focused, "/document/document-42/evening-atmosphere/view/editor/focus");
  assert.equal(documentFocusFromRoute(focused), true);
  assert.equal(documentViewFromRoute(focused), "editor");
  assert.equal(documentIdFromRoute(focused), "document-42");
  assert.equal(withDocumentInRoute(focused, "document-84", "New Study"), "/document/document-84/new-study/view/editor/focus");
  assert.equal(withDocumentFocusInRoute(`${focused}?panel=tools#selected`, false), "/document/document-42/evening-atmosphere/view/editor?panel=tools#selected");
  assert.equal(withDocumentFocusInRoute("/studio/layers", true), "/studio/layers/focus");
  assert.equal(documentViewFromRoute("/studio/layers/focus"), "layers");
  assert.equal(withDocumentInRoute("/document/old/focus/view/document", "new", "Focus"), "/document/new/focus/view/document");
});

test("dynamic document paths select the smallest matching page entry", () => {
  assert.equal(documentEntryPath("/document/doc-a/name"), "/index.html");
  assert.equal(documentEntryPath("/document/doc-a/name/view/board"), "/studio/board/index.html");
  assert.equal(documentEntryPath("/document/doc-a/view/adaptive"), "/studio/adaptive/index.html");
  assert.equal(documentEntryPath("/document/doc-a/name/view/editor"), "/studio/editor/index.html");
  assert.equal(documentEntryPath("/document/doc-a/name/view/editor/focus"), "/studio/editor/index.html");
  assert.equal(documentEntryPath("/document/doc-a/name/focus"), "/index.html");
});

test("Library focus dialogs have refresh-safe content paths", () => {
  assert.equal(libraryFocusRoute("block", "block/42", "Direction / Quiet confidence"), "/library/block/block%2F42/direction-quiet-confidence");
  assert.deepEqual(libraryFocusFromRoute("/library/block/block%2F42/direction-quiet-confidence"), { kind: "block", id: "block/42" });
  assert.deepEqual(libraryFocusFromRoute("/library/output/output-7"), { kind: "output", id: "output-7" });
  assert.deepEqual(libraryFocusFromRoute("/library/family/family-9/warm-nocturnes"), { kind: "family", id: "family-9" });
  assert.equal(libraryFocusFromRoute("/library"), null);
  assert.equal(libraryRootRoute("/library/output/output-7?scope=kept#preview"), "/library?scope=kept#preview");
  assert.equal(appEntryPath("/library/output/output-7"), "/library/index.html");
});
