import assert from "node:assert/strict";
import test from "node:test";
import { documentContextBlockFromRoute, documentContextBlockRoute, documentEntryPath, documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, libraryBaseRoute, libraryBlockEditorFromRoute, libraryBlockEditorRoute, libraryFocusFromRoute, libraryFocusRoute, libraryRootRoute, routePathname, withDocumentFocusInRoute, withDocumentInRoute } from "../src/model/routes.ts";
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

test("document context reports link to a refresh-safe block target",()=>{
  const route=documentContextBlockRoute("document 42","Evening Atmosphere","block/with spaces");
  assert.equal(route,"/document/document%2042/evening-atmosphere#context=block%2Fwith%20spaces");
  assert.equal(documentIdFromRoute(route),"document 42");
  assert.equal(documentViewFromRoute(route),"document");
  assert.equal(documentContextBlockFromRoute(route),"block/with spaces");
  assert.equal(documentContextBlockFromRoute("/document/document-42/evening-atmosphere"),null);
  assert.equal(documentContextBlockFromRoute("/library#context=block-42"),null);
  assert.equal(withDocumentInRoute(route,"document-84","New Study"),"/document/document-84/new-study#context=block%2Fwith%20spaces");
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

test("Canvas reuses the same project Library without escaping its application",()=>{
  const canvas="/canvas/library?scope=kept#preview";
  const focus=libraryFocusRoute("block","block/42","Direction / Quiet confidence",canvas);
  assert.equal(libraryBaseRoute(canvas),"/canvas/library");
  assert.equal(focus,"/canvas/library/block/block%2F42/direction-quiet-confidence");
  assert.deepEqual(libraryFocusFromRoute(focus),{kind:"block",id:"block/42"});
  assert.deepEqual(libraryFocusFromRoute("/canvas/library/output/output-7"),{kind:"output",id:"output-7"});
  assert.deepEqual(libraryFocusFromRoute("/canvas/library/artifact/artifact-9/study"),{kind:"artifact",id:"artifact-9"});
  assert.deepEqual(libraryFocusFromRoute("/canvas/library/family/family-3"),{kind:"family",id:"family-3"});
  assert.equal(libraryRootRoute(`${focus}?scope=kept#preview`),"/canvas/library?scope=kept#preview");
  assert.equal(libraryBlockEditorRoute("block/42",canvas),"/canvas/library/blocks/editor/block%2F42");
  assert.equal(libraryBlockEditorRoute("",canvas),"/canvas/library/blocks/editor/new");
  assert.deepEqual(libraryBlockEditorFromRoute("/canvas/library/blocks/editor/block%2F42"),{blockId:"block/42"});
  assert.deepEqual(libraryBlockEditorFromRoute("/canvas/library/blocks/editor/new"),{blockId:null});
  assert.equal(applicationEntryPath(focus),"/canvas/");
  assert.equal(applicationEntryPath("/canvas/library/blocks/editor/new"),"/canvas/");
  assert.equal(libraryBaseRoute("/library/output/output-7"),"/library","Creator Workspace keeps its existing routes");
});

test("application routes select one canonical runtime boundary",()=>{
  assert.equal(applicationIdFromRoute("/document/doc-a/study/view/chat/focus"),"creative");
  assert.equal(applicationIdFromRoute("/creative/create/conversational"),"creative");
  assert.equal(applicationIdFromRoute("/operations/events/permissions"),"engineering");
  assert.equal(applicationIdFromRoute("/admin/events/stream"),"engineering");
  assert.equal(applicationIdFromRoute("/laboratory/replay"),"product");
  assert.equal(applicationIdFromRoute("/admin/events/replay"),"product");
  assert.equal(applicationEntryPath("/system/focal-points"),"/knowledge/");
});
