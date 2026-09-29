import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { projectRailDocumentCount, projectRailDocumentDestination, projectRailDocuments } from "../src/model/project-rail.ts";
import { documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute, withDocumentInRoute } from "../src/model/routes.ts";

const document = (id, overrides = {}) => ({
  id,
  projectId: "project-1",
  title: `Document ${id}`,
  handle: `document-${id}`,
  removed: false,
  createdSequence: Number(id.replace(/\D/gu, "")) || 1,
  sourceEvents: [],
  ...overrides,
});

test("the project compass puts the current document first without exposing removed or foreign work", () => {
  const documents = [
    document("newest"),
    document("foreign", { projectId: "another-project" }),
    document("removed", { removed: true }),
    document("middle"),
    document("current"),
    document("older"),
    document("oldest"),
  ];
  const projection = { projectId: "project-1", documentId: "current", documents };

  assert.deepEqual(projectRailDocuments(projection).map((item) => item.id), [
    "current", "newest", "middle", "older",
  ]);
  assert.deepEqual(documents.map((item) => item.id), [
    "newest", "foreign", "removed", "middle", "current", "older", "oldest",
  ], "the shared projection remains untouched");
  assert.deepEqual(projectRailDocuments(projection, 2).map((item) => item.id), ["current", "newest"]);
  assert.deepEqual(projectRailDocuments(projection, 0), []);
  assert.equal(projectRailDocumentCount(projection), 5, "removed and foreign documents never inflate project totals");
});

test("document shortcuts preserve the active lens, focus mode, and canonical document identity", () => {
  const current = "/document/current/current-plan/view/chat/focus?source=project";
  const requested = "/document/current/current-plan/view/board/focus";

  assert.equal(projectRailDocumentDestination(current, requested), requested);
  assert.equal(projectRailDocumentDestination(current, "/activity"), current);
  assert.equal(projectRailDocumentDestination("/library", "/activity"), "/");
  assert.equal(projectRailDocumentDestination("/canvas/library", null), "/");

  const destination = withDocumentInRoute(projectRailDocumentDestination(current, requested), "other", "Another plan");
  assert.equal(documentIdFromRoute(destination), "other");
  assert.equal(documentViewFromRoute(destination), "board");
  assert.equal(documentFocusFromRoute(destination), true);
});

test("the project compass prioritizes scoped documents over duplicated navigation and permanent reassurance", async () => {
  const [rail, styles] = await Promise.all([
    readFile(new URL("../src/components/project-rail.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
  ]);

  assert.match(rail, /projectRailDocuments\(projection\)/);
  assert.match(rail, /projectRailDocumentCount\(projection\)/);
  assert.match(rail, /projectRailDocumentDestination\(route,\s*this\.getAttribute\("destination"\)\)/);
  assert.match(rail, /this\.store\.openDocument\(documentId,\s*destination,\s*"project-rail",\s*navigation\)/);
  assert.match(rail, /import \{ navigateInApp \} from "\.\/command-departure";/);
  assert.match(rail, /void navigateInApp\(this,\s*async navigation\s*=>\s*\{\s*this\.#closeNative\(\);\s*const opened\s*=\s*await this\.store\.openDocument\(documentId,\s*destination,\s*"project-rail",\s*navigation\);\s*if\(opened&&navigation\.current\(\)\)window\.scrollTo\(\{top:0\}\);/);
  assert.match(rail, /this\.i18n\.firstGrapheme\(projection\.projectName\)/);
  assert.match(rail, /projectIdentityRoute=projection\.projectId\?overviewRoute:projectsRoute/);
  assert.match(rail, /class="rail-project-switch" href=\$\{projectIdentityRoute\}/);
  assert.match(rail, /surface\s*!==\s*"library"\s*&&\s*libraryLinks\.length/);
  assert.match(rail, /canAuthor\s*&&\s*surface\s*===\s*"studio"\s*&&\s*!quiet\s*&&\s*!projectActive/);
  assert.match(rail, /projection\.collections\.length\s*\|\|\s*canAuthor/);
  assert.match(rail, /offline\s*\|\|\s*synchronizing/);
  assert.doesNotMatch(rail, /No auto-filing|Your work is saved|Library overview|Aesthetic families/);
  assert.match(styles, /:root\[dir="rtl"\]:not\(\[data-document-focus\]\)[\s\S]*?\.project-rail\.expanded\)[\s\S]*?inset-inline-start:\s*15rem;[\s\S]*?inset-inline-end:\s*0;/);
  assert.match(styles, /\.project-rail\.expanded \.rail-links\s*\{[^}]*display:\s*grid/s);
});
