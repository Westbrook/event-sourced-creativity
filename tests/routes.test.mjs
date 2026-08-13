import assert from "node:assert/strict";
import test from "node:test";
import { documentEntryPath, documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, libraryBlockEditorFromRoute, libraryBlockEditorRoute, libraryFocusFromRoute, libraryFocusRoute, libraryRootRoute, routePathname, withDocumentFocusInRoute, withDocumentInRoute } from "../src/model/routes.ts";
import { applicationEntryPath, applicationIdFromRoute } from "../src/platform/applications.ts";

test("document views use a readable path for the selected durable document", () => {
  const paths = [["/", "document"], ["/studio/board", "board"], ["/studio/guided", "guided"], ["/studio/layers", "layers"], ["/studio/adaptive", "adaptive"], ["/studio/editor", "editor"], ["/studio/chat", "chat"]];
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
  assert.equal(documentEntryPath("/document/doc-a/name"), "/");
  assert.equal(documentEntryPath("/document/doc-a/name/view/board"), "/studio/board/");
  assert.equal(documentEntryPath("/document/doc-a/view/adaptive"), "/studio/adaptive/");
  assert.equal(documentEntryPath("/document/doc-a/name/view/editor"), "/studio/editor/");
  assert.equal(documentEntryPath("/document/doc-a/name/view/editor/focus"), "/studio/editor/");
  assert.equal(documentEntryPath("/document/doc-a/name/view/chat/focus"), "/studio/chat/");
  assert.equal(documentEntryPath("/document/doc-a/name/focus"), "/");
  assert.equal(documentViewFromRoute("/document/doc-a/name/view/board/"), "board");
  assert.equal(documentViewFromRoute("/studio/board/"), "board");
  assert.equal(withDocumentInRoute("/studio/board/", "doc-a", "Name"), "/document/doc-a/name/view/board");
});

test("Library focus dialogs have refresh-safe content paths", () => {
  assert.equal(libraryFocusRoute("block", "block/42", "Direction / Quiet confidence"), "/library/block/block%2F42/direction-quiet-confidence");
  assert.deepEqual(libraryFocusFromRoute("/library/block/block%2F42/direction-quiet-confidence"), { kind: "block", id: "block/42" });
  assert.deepEqual(libraryFocusFromRoute("/library/output/output-7"), { kind: "output", id: "output-7" });
  assert.deepEqual(libraryFocusFromRoute("/library/family/family-9/warm-nocturnes"), { kind: "family", id: "family-9" });
  assert.equal(libraryFocusFromRoute("/library"), null);
  assert.equal(libraryRootRoute("/library/output/output-7?scope=kept#preview"), "/library?scope=kept#preview");
  assert.equal(applicationEntryPath("/library/output/output-7"), "/creative/");
});

test("Library Block editor targets are durable refresh-safe paths",()=>{
  assert.equal(libraryBlockEditorRoute(),"/library/blocks/editor/new");
  assert.equal(libraryBlockEditorRoute("block/42"),"/library/blocks/editor/block%2F42");
  assert.deepEqual(libraryBlockEditorFromRoute("/library/blocks/editor/new"),{blockId:null});
  assert.deepEqual(libraryBlockEditorFromRoute("/library/blocks/editor/block%2F42"),{blockId:"block/42"});
  assert.equal(libraryBlockEditorFromRoute("/library/block/block-42"),null);
  assert.equal(applicationEntryPath("/library/blocks/editor/block-42"),"/creative/");
});

test("application routes select one canonical runtime boundary",()=>{
  assert.equal(applicationIdFromRoute("/document/doc-a/study/view/chat/focus"),"creative");
  assert.equal(applicationIdFromRoute("/creative/create/conversational"),"creative");
  assert.equal(applicationIdFromRoute("/operations/events/permissions"),"operations");
  assert.equal(applicationIdFromRoute("/admin/events/stream"),"operations");
  assert.equal(applicationIdFromRoute("/laboratory/replay"),"laboratory");
  assert.equal(applicationIdFromRoute("/admin/events/replay"),"laboratory");
  assert.equal(applicationEntryPath("/system/focal-points"),"/laboratory/");
});
