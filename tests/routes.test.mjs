import assert from "node:assert/strict";
import test from "node:test";
import { documentEntryPath, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, routePathname, withDocumentInRoute } from "../src/model/routes.ts";

test("document views use a readable path for the selected durable document", () => {
  const paths = [["/", "document"], ["/studio/board", "board"], ["/studio/guided", "guided"], ["/studio/layers", "layers"], ["/studio/adaptive", "adaptive"]];
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

test("dynamic document paths select the smallest matching page entry", () => {
  assert.equal(documentEntryPath("/document/doc-a/name"), "/index.html");
  assert.equal(documentEntryPath("/document/doc-a/name/view/board"), "/studio/board/index.html");
  assert.equal(documentEntryPath("/document/doc-a/view/adaptive"), "/studio/adaptive/index.html");
});
