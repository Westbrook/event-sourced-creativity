import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import ts from "typescript";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";

// Execute the complete, actual DocumentArtifacts module using the existing
// finite native fixture ports. Only this suite runs: accepted fixture tests are
// excluded at their first top-level test declaration, never production methods.
const fixtureUrl = new URL("./inactive-generation-dialog-host.test.mjs", import.meta.url);
const text = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstTest = tree.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression)
  && node.expression.expression.text === "test");
assert.ok(firstTest);
const fixtureTree = ts.createSourceFile(fixtureUrl.pathname, text.slice(0, firstTest.getFullStart()), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const transformed = ts.transform(fixtureTree, [context => {
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      const name = node.moduleSpecifier.text;
      return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
        ts.factory.createStringLiteral(name.startsWith(".") ? new URL(name, fixtureUrl).href : import.meta.resolve(name)), node.attributes);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === "url")
      return ts.factory.createStringLiteral(fixtureUrl.href);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1 && ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === "specifier")
      return ts.factory.updateCallExpression(node, node.expression, node.typeArguments,
        [ts.factory.createCallExpression(ts.factory.createIdentifier("resolveFixtureModule"), undefined, [node.arguments[0]])]);
    return ts.visitEachChild(node, visit, context);
  };
  return value => ts.visitNode(value, visit);
}]);
const fixtureCode = 'import { createRequire } from "node:module"; import { pathToFileURL } from "node:url";\n'
  + `const fixtureRequire=createRequire(${JSON.stringify(fixtureUrl.href)}); const resolveFixtureModule=name=>pathToFileURL(fixtureRequire.resolve(name)).href;\n`
  + ts.createPrinter().printFile(transformed.transformed[0])
  + "\nexport { documentPort, windowPort, ElementPort };\n";
transformed.dispose();
const { fixture, documentPort, ElementPort } = await import("data:text/javascript;base64," + Buffer.from(fixtureCode).toString("base64"));
const hash = value => createHash("sha256").update(value).digest("hex");

function host(t, kind = "short_story", options = {}) {
  const f = fixture("create", { artifact: true, ...options });
  const listeners = new Set();
  f.disposals = 0;
  f.store.subscribe = listener => { listeners.add(listener); return () => { if (listeners.delete(listener)) f.disposals++; }; };
  f.notify = () => { for (const listener of [...listeners]) listener(); };
  f.listenerCount = () => listeners.size;
  installOutputNavigationFocusNative(t, f, { documentPort, ElementPort, artifactDialogOwner: f.host });
  const completion = f.state.events.find(event => event.type === "DocumentRenderCompleted");
  completion.streamId = "creative:owner"; completion.payload.artifact_kind = kind;
  f.completion = completion;
  // Pure native visibility ports; no browser/device or rendered-a11y claim.
  documentPort.visibilityState = "visible";
  t.mock.method(globalThis, "fetch", () => assert.fail("Document share wiring must not fetch or publish"));
  t.after(() => { f.host.isConnected = false; f.host.disconnectedCallback(); documentPort.visibilityState = "visible"; });
  f.share = () => {
    const match = f.renderer.markup.match(/<forma-selected-output-share-review\s+([^>]*)>/u);
    return match ? f.renderer.attrs(match[1]).properties : null;
  };
  f.openArtifact = async () => {
    assert.equal(await f.host.openArtifactById("artifact-A", kind === "slides" ? { intent: "inspect" } : {}), true);
    await f.flush();
    return f.share()?.source;
  };
  return f;
}

for (const kind of ["short_story", "scene", "slides"]) {
  test(`${kind} supplies only the exact current retained JSON selection and a fresh viewer lease`, async t => {
    const f = host(t, kind), source = await f.openArtifact();
    assert.ok(source); assert.equal(source.isCurrent(), true); assert.equal(source.signal.aborted, false);
    assert.deepEqual(source.selection, { output: kind, documentId: "A", artifactId: "artifact-A", revision: 0,
      contentSha256: hash(f.state.content["content-A"]) });
    assert.deepEqual(Object.keys(source).sort(), ["isCurrent", "selection", "signal"]);
    assert.deepEqual(Object.keys(f.share()).sort(), ["enabled", "source"]); assert.equal(f.share().enabled, true);
    assert.ok(Object.isFrozen(source)); assert.ok(Object.isFrozen(source.selection));
    const subscriptions = f.listenerCount(); assert.ok(subscriptions >= 1);
    f.draw(); assert.strictEqual(f.share().source, source, "ordinary parent render preserves input lifetime");
    assert.equal(f.listenerCount(), subscriptions, "rerender does not accumulate subscriptions");
    assert.match(f.renderer.markup, /Edit finished output/u);
    if (kind !== "slides") assert.match(f.renderer.markup, /Download Markdown/u);
    assert.equal(f.state.requests.length, 0);
  });
}

test("unsupported media, project, impersonation and noncanonical completions do not expose the action", async t => {
  for (const scenario of ["audio", "video", "storyboard", "model3d", "project", "impersonation", "owner", "stream", "sponsor"]) {
    await t.test(scenario, async child => {
      const f = host(child, ["audio", "video", "storyboard", "model3d"].includes(scenario) ? scenario : "short_story");
      const originalSession = f.store.session.get;
      if (scenario === "project") f.store.session.get = () => ({ ...originalSession(), projectContext: { permissions: ["project.read"], organizationId: "org", projectAccessId: "project" } });
      if (scenario === "impersonation") f.store.session.get = () => ({ ...originalSession(), impersonation: { userId: "other" } });
      if (scenario === "owner") f.completion.payload.requested_by_user_id = "other";
      if (scenario === "stream") f.completion.streamId = "creative:other";
      if (scenario === "sponsor") f.completion.payload.sponsor_consumption_id = "sponsor-id";
      await f.openArtifact(); assert.equal(f.share(), null);
    });
  }
});

for (const mutation of ["route", "content", "revision", "authorization", "source", "actor", "owner", "kind", "sponsor"]) {
  test(`${mutation} A → B → A notifications abort immediately and cannot revive a source`, async t => {
    const f = host(t), source = await f.openArtifact();
    assert.ok(source); let restore; const disposals = f.disposals;
    if (mutation === "route") { const original = f.store.route.get; f.store.route.get = () => "/other"; restore = () => { f.store.route.get = original; }; }
    if (mutation === "content") { const original = f.state.content["content-A"]; f.state.content["content-A"] = original + " "; restore = () => { f.state.content["content-A"] = original; }; }
    if (mutation === "revision") { f.state.events.push({ ...f.completion, eventId: "revision-1", sequence: 90, type: "DocumentArtifactEdited", payload: { artifact_id: "artifact-A", document_id: "A", revision: 1 } }); restore = () => { f.state.events.pop(); }; }
    if (mutation === "authorization") { const original = f.state.authorization; f.state.authorization = "other"; restore = () => { f.state.authorization = original; }; }
    if (mutation === "source") { const original = f.store.sourceOwnershipActive; f.store.sourceOwnershipActive = () => false; restore = () => { f.store.sourceOwnershipActive = original; }; }
    if (mutation === "actor") { const original = f.store.session.get; f.store.session.get = () => ({ ...original(), user: { userId: "other", role: "user" } }); restore = () => { f.store.session.get = original; }; }
    if (mutation === "owner") { f.completion.payload.requested_by_user_id = "other"; restore = () => { f.completion.payload.requested_by_user_id = "owner"; }; }
    if (mutation === "kind") { f.completion.payload.artifact_kind = "scene"; restore = () => { f.completion.payload.artifact_kind = "short_story"; }; }
    if (mutation === "sponsor") { f.completion.payload.sponsor_consumption_id = "new-sponsor"; restore = () => { delete f.completion.payload.sponsor_consumption_id; }; }
    f.notify(); assert.equal(source.signal.aborted, true, "notification retires before any render or promise");
    assert.ok(f.disposals > disposals, "retirement releases its Store subscription"); restore(); f.notify(); assert.equal(source.isCurrent(), false);
    const next = await f.openArtifact(); assert.ok(next); assert.notStrictEqual(next, source);
    assert.equal(next.isCurrent(), true); assert.equal(source.signal.aborted, true);
  });
}

test("visibility, pagehide, authorization events, native close, edit and disconnect synchronously retire", async t => {
  for (const action of ["visibilitychange", "pagehide", "forma-authorization-changed", "forma-event-source-retired", "close", "edit", "disconnect"]) {
    await t.test(action, async child => {
      const f = host(child), source = await f.openArtifact(); assert.ok(source); const disposals = f.disposals;
      if (action === "visibilitychange") documentPort.visibilityState = "hidden";
      if (["visibilitychange", "pagehide", "forma-authorization-changed"].includes(action))
        for (const listener of [...(f.listeners.get(action) ?? [])]) listener();
      if (action === "forma-event-source-retired")
        for (const listener of [...(f.listeners.get(action) ?? [])]) listener({ detail: { source: f.store.captureSourceOwnership() } });
      if (action === "close") f.renderer.ownNodes(f.host, "dialog").find(node => node.classList.contains("document-artifact-view")).close();
      if (action === "edit") await f.renderer.handler(f.host, "button", node => node.handlers.click?.toString().includes("#startArtifactEdit"))();
      if (action === "disconnect") { f.host.isConnected = false; f.host.disconnectedCallback(); }
      assert.equal(source.signal.aborted, true); assert.equal(source.isCurrent(), false); assert.ok(f.disposals > disposals);
    });
  }
});

test("a source read detects hidden ancestors and retires rather than restoring after visibility returns", async t => {
  const f = host(t), source = await f.openArtifact(), originalClosest = f.host.closest;
  f.host.closest = selector => selector === "[hidden],[inert]" ? {} : originalClosest.call(f.host, selector);
  assert.equal(source.isCurrent(), false); assert.equal(source.signal.aborted, true);
  f.host.closest = originalClosest; assert.equal(source.isCurrent(), false);
});

test("missing retained bytes do not trigger a new share fetch or substitute selection", async t => {
  const f = host(t), source = await f.openArtifact(); delete f.state.content["content-A"]; f.notify();
  assert.equal(source.signal.aborted, true); f.draw(); assert.equal(f.share(), null);
});
