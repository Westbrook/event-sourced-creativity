import assert from "node:assert/strict";
import test from "node:test";
import { artifactFocusRoute, artifactFocusOptionsFromRoute, projectTaskDocumentIdFromRoute, documentContextBlockFromRoute, documentContextBlockRoute, documentEntryPath, documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, isDocumentViewRoute, libraryBaseRoute, libraryBlockEditorFromRoute, libraryBlockEditorRoute, libraryFocusFromRoute, libraryFocusRoute, libraryRootRoute, routePathname, withDocumentFocusInRoute, withDocumentInRoute } from "../src/model/routes.ts";
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


test("artifact deep links keep the byte-identical three-argument option contract", () => {
  for (const intent of ["inspect", "review", "export"]) for (const expectedRevision of [0, 3, Number.MAX_SAFE_INTEGER]) for (const expectedContentSha256 of [undefined, "a".repeat(64)]) {
    const options = { expectedRevision, intent, ...(expectedContentSha256 ? { expectedContentSha256 } : {}) };
    const href = artifactFocusRoute("artifact/one", "An output", options);
    assert.equal(href, "/library/artifact/artifact%2Fone/an-output?revision=" + expectedRevision + "&intent=" + intent + (expectedContentSha256 ? "&sha256=" + expectedContentSha256 : ""));
    assert.deepEqual(artifactFocusOptionsFromRoute(href), options);
    assert.equal(projectTaskDocumentIdFromRoute(href), null);
  }
});

test("artifact deep links merge exact options into an existing Document query", () => {
  const options = { expectedRevision: 3, intent: "review", expectedContentSha256: "b".repeat(64) };
  for (const current of ["/document/doc-a/name", "/?document=doc-a", "/deliver?document=doc-a", "/activity?document=doc-a", "/library?document=doc-a", "/canvas/library?document=doc-a"]) {
    const href = artifactFocusRoute("artifact/one", "An output", options, current), url = new URL(href, "https://fixture.invalid");
    assert.deepEqual(url.searchParams.getAll("document"), ["doc-a"]); assert.equal(projectTaskDocumentIdFromRoute(href), "doc-a");
    assert.deepEqual(artifactFocusOptionsFromRoute(href), options);
    assert.deepEqual(libraryFocusFromRoute(href), { kind: "artifact", id: "artifact/one" });
    assert.equal(libraryBaseRoute(href), current.startsWith("/canvas/") ? "/canvas/library" : "/library");
    assert.deepEqual([...url.searchParams.keys()], ["document", "revision", "intent", "sha256"]);
  }
});

test("artifact deep links retain literal and ambiguous task addresses without selecting a replacement", () => {
  const options = { expectedRevision: 0, intent: "inspect" };
  for (const values of [[""], ["missing original"], [" doc-a\u00a0"], ["doc-a\u200b"], ["文書/د"], ["doc-a", "", "doc-b"], ["doc-a", "doc-a"]]) {
    const current = new URL("/activity", "https://fixture.invalid"); for (const value of values) current.searchParams.append("document", value);
    const href = artifactFocusRoute("exact", "Exact output", options, current.pathname + current.search), url = new URL(href, "https://fixture.invalid");
    assert.deepEqual(url.searchParams.getAll("document"), values);
    assert.equal(projectTaskDocumentIdFromRoute(href), values.length === 1 ? values[0] : "");
    assert.deepEqual(artifactFocusOptionsFromRoute(href), options, "A valid artifact intent does not repair an unavailable Document identity");
  }
});

test("artifact deep links do not copy unrelated queries or superseded artifact options", () => {
  const current = "/canvas/library/artifact/old/old?document=doc-a&revision=1&revision=2&intent=inspect&sha256=old&scope=unrelated#old";
  const options = { expectedRevision: 8, intent: "export", expectedContentSha256: "c".repeat(64) };
  const href = artifactFocusRoute("new?/#%", "New output", options, current), url = new URL(href, "https://fixture.invalid");
  assert.equal(url.pathname, "/canvas/library/artifact/new%3F%2F%23%25/new-output");
  assert.equal(projectTaskDocumentIdFromRoute(href), "doc-a"); assert.deepEqual(artifactFocusOptionsFromRoute(href), options);
  assert.equal(url.hash, ""); assert.equal(url.searchParams.has("scope"), false);
  assert.equal(url.searchParams.getAll("revision").length, 1); assert.equal(url.searchParams.getAll("intent").length, 1);
  assert.deepEqual(libraryFocusFromRoute(href), { kind: "artifact", id: "new?/#%" });
});

test("artifact deep links retain the existing unrelated-route context boundary", () => {
  const options = { expectedRevision: 0, intent: "inspect" };
  for (const current of ["/library", "/canvas/library", "/settings?document=not-authority", "/projects?document=not-authority"]) {
    const href = artifactFocusRoute("exact", "", options, current);
    assert.equal(href, libraryBaseRoute(current) + "/artifact/exact?revision=0&intent=inspect");
    assert.equal(projectTaskDocumentIdFromRoute(href), null); assert.deepEqual(artifactFocusOptionsFromRoute(href), options);
  }
});

test("scoped artifact deep links still reject malformed or duplicate delivery options", () => {
  const options = { expectedRevision: 3, intent: "review", expectedContentSha256: "d".repeat(64) };
  const href = artifactFocusRoute("exact", "", options, "/deliver?document=doc-a");
  assert.deepEqual(artifactFocusOptionsFromRoute(href), options);
  for (const suffix of ["&revision=3", "&intent=export", "&sha256=" + "e".repeat(64)]) assert.equal(artifactFocusOptionsFromRoute(href + suffix), "invalid");
  for (const malformed of [{ ...options, expectedRevision: -1 }, { ...options, expectedRevision: 0.5 }, { ...options, intent: "publish" }, { ...options, expectedContentSha256: "not-a-hash" }]) {
    const invalid = artifactFocusRoute("exact", "", malformed, "/deliver?document=doc-a");
    assert.equal(projectTaskDocumentIdFromRoute(invalid), "doc-a"); assert.equal(artifactFocusOptionsFromRoute(invalid), "invalid");
  }
});


import { classifyExperienceRoute } from "../src/experiences/routes.ts";
import { experienceIds } from "../src/experiences/intake.ts";
import { parseRetainedStoryRoute } from "../src/model/retained-short-story.ts";
import { resolveServerRoute } from "../src/platform/applications.ts";
import { isProjectTaskRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";

test("setup routes select an explicit chooser, registered fresh release or one exact recovery identity", () => {
  const draft = "experience-draft-" + "0123456789abcdef".repeat(4);
  const intent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const origin of ["", "http://localhost", "https://forma.example"]) {
    for (const path of ["/make", "/make/"]) {
      assert.deepEqual(classifyExperienceRoute(origin + path), { kind: "chooser" }, "A chooser never implicitly selects image");
      assert.deepEqual(resolveServerRoute(origin + path), { application: "creative", entryPath: "/experiences.html", canonicalFamily: "/make" });
    }
    for (const experienceId of experienceIds) {
      const path = origin + "/make/" + experienceId;
      assert.deepEqual(classifyExperienceRoute(path), { kind: "fresh", experienceId });
      assert.deepEqual(resolveServerRoute(path), { application: "creative", entryPath: "/experiences.html", canonicalFamily: "/make/" + experienceId });
      for (const [key, id, byIntent] of [["draft", draft, false], ["intent", intent, true]]) {
        assert.deepEqual(classifyExperienceRoute(path + "?" + key + "=" + id), { kind: "recover", experienceId, id, byIntent });
        assert.deepEqual(resolveServerRoute(path + "?" + key + "=" + id), resolveServerRoute(path));
      }
    }
  }
  assert.deepEqual(classifyExperienceRoute("/make/image?%64raft=" + draft), { kind: "recover", experienceId: "image", id: draft, byIntent: false });
  assert.deepEqual(classifyExperienceRoute("/make/scene?%69ntent=" + intent), { kind: "recover", experienceId: "scene", id: intent, byIntent: true });
});

test("setup classification rejects ambiguous raw addresses without repairing delimiters or paths", () => {
  const draft = "experience-draft-" + "a".repeat(64), intent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  // Pass the original strings directly. Native Request/URL construction can erase
  // fragments or normalize dot segments before a Worker receives request.url.
  const invalid = [
    "/make?", "/make#", "/make?#", "/make/?", "/make/#",
    "/make?draft=" + draft, "/make?intent=" + intent,
    "/make/image?", "/make/image#", "/make/image?#",
    "/make/image?draft=" + draft + "#", "/make/image?draft=" + draft + "#kept",
    "/make/image?draft=" + draft + "&", "/make/image?&draft=" + draft,
    "/make/image?draft=" + draft + "&&", "/make/image?draft=" + draft + "&draft=" + draft,
    "/make/image?draft=" + draft + "&%64raft=" + draft,
    "/make/image?%64raft=" + draft + "&dr%61ft=" + draft,
    "/make/image?intent=" + intent + "&%69ntent=" + intent,
    "/make/image?draft=" + draft + "&intent=" + intent,
    "/make/image?draft=" + draft + "&document=doc-a",
    "/make/image?%2564raft=" + draft, "/make/image?intentId=" + intent,
    "/make/image?draft=", "/make/image?draft=experience-draft-" + "a".repeat(63),
    "/make/image?draft=experience-draft-" + "A".repeat(64),
    "/make/image?intent=" + intent.toUpperCase(), "/make/image?intent=not-an-intent",
    "/make/image?document=doc-a", "/make/image?unknown=value",
    "/make/unknown", "/make/image/", "/make/image/extra", "/make//image",
    "/make/%69mage", "/make/./image", "/make/%2e/image",
    "/make/image/../scene", "/make/%2e%2e/deliver", "/make/../deliver",
    "/make/image\\extra", "/make/image?draft=" + draft + "\n",
    "/make/image?unknown=" + "x".repeat(2048),
  ];
  for (const address of invalid) {
    assert.deepEqual(classifyExperienceRoute(address), { kind: "invalid" }, JSON.stringify(address));
    assert.equal(resolveServerRoute(address), null, JSON.stringify(address));
  }
  for (const address of ["/", "/deliver", "/activity?document=doc-a", "/make-other?draft=" + draft,
    "/api/experiences/drafts?unrelated=" + "x".repeat(5000),
    "https://forma.example/api/retained-story/doc-a/artifact-a?unrelated=" + "x".repeat(5000)]) {
    assert.equal(classifyExperienceRoute(address), null, "Unrelated addresses retain their existing router: " + address.slice(0, 100));
  }
});

test("the exact native retained four-tuple keeps its existing creative reader boundary", () => {
  const selection = { documentId: "doc-a", artifactId: "artifact-a", revision: 3, contentSha256: "a".repeat(64) };
  const query = "document=doc-a&artifact=artifact-a&revision=3&sha256=" + selection.contentSha256;
  const canonical = "/make/short-story?" + query;
  for (const relative of [canonical, "/make/short-story/?" + query,
    "/make/short-story?sha256=" + selection.contentSha256 + "&revision=3&artifact=artifact-a&document=doc-a"]) {
    assert.deepEqual(parseRetainedStoryRoute(relative), selection, "The native parser retains its established grammar");
    for (const address of [relative, "https://forma.example" + relative]) {
      assert.deepEqual(classifyExperienceRoute(address), { kind: "retained", selection });
      assert.deepEqual(resolveServerRoute(address), { application: "creative", entryPath: "/creative/", canonicalFamily: "/make/short-story" });
    }
  }
  for (const address of [
    "/make/image?" + query, "/make?" + query,
    "/make/short-story?artifact=artifact-a&revision=3&sha256=" + selection.contentSha256,
    canonical + "&document=doc-a", canonical + "&%64ocument=doc-a",
    canonical + "&draft=experience-draft-" + "b".repeat(64), canonical + "&unknown=1",
    canonical.replace("revision=3", "revision=03"), canonical.replace("revision=3", "revision=-1"),
    canonical.replace("revision=3", "revision=9007199254740992"),
    canonical.replace(selection.contentSha256, "A".repeat(64)),
  ]) {
    assert.deepEqual(classifyExperienceRoute(address), { kind: "invalid" }, address);
    assert.equal(resolveServerRoute(address), null, address);
  }
});

test("make addresses never inherit a Document while native project-task membership remains unchanged", () => {
  const draft = "experience-draft-" + "a".repeat(64), hash = "b".repeat(64);
  const addresses = [
    "/make", "/make/", "/make/image", "/make/short-story", "/make/unknown",
    "/make/image?draft=" + draft,
    "/make/short-story?document=original&artifact=a&revision=1&sha256=" + hash,
    "/make?document=one&document=two#kept", "/make?", "/make#", "/make//image",
    "/make/../deliver", "/make/%2e%2e/deliver", "/make/\\../deliver",
    "/other/../make/short-story?artifact=a&revision=1&sha256=" + hash,
    "https://forma.example/make/image?draft=" + draft,
    "https://forma.example/make/../deliver#kept",
  ];
  for (const address of addresses) {
    assert.equal(withProjectTaskDocumentInRoute(address, "replacement", "/deliver?document=current"), address);
    assert.equal(withProjectTaskDocumentInRoute(address, "", "/activity?document=current"), address);
    assert.equal(withProjectTaskDocumentInRoute(address, ""), address);
  }
  for (const address of ["/make/short-story", "/make/short-story/", "/make/short-story?draft=" + draft,
    "/deliver", "/activity", "/library", "/canvas/library", "/library/artifact/a"]) assert.equal(isProjectTaskRoute(address), true, address);
  for (const address of ["/make", "/make/", "/make/image", "/make/scene", "/make/unknown", "/make-other", "/make/short-story/extra"]) assert.equal(isProjectTaskRoute(address), false, address);
  assert.equal(withProjectTaskDocumentInRoute("/deliver?keep=1#kept", "replacement"), "/deliver?keep=1&document=replacement#kept");
  assert.equal(withProjectTaskDocumentInRoute("/library?document=old", ""), "/library");
  assert.equal(withProjectTaskDocumentInRoute("/make-other?document=old#kept", "replacement"), "/make-other?document=old#kept");
});
