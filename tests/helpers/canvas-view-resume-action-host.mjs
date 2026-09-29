import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire, registerHooks } from "node:module";

// Reuse every declaration of the existing actual Lit EventPart/Popover fixture.
// Only its test registrations are omitted; no production method is extracted
// or replaced. Native DOM, Store and scheduling remain the same finite ports.
const receiverUrl = new URL("../canvas-view-resume-popover-receiver.test.mjs", import.meta.url);
const source = fs.readFileSync(receiverUrl, "utf8");
const ts = createRequire(receiverUrl)("typescript");
const tree = ts.createSourceFile(receiverUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const boundary = tree.statements.find(node => ts.isForOfStatement(node));
assert.ok(boundary, "the current first registration follows the complete fixture");
assert.match(boundary.getText(tree), /^for \(const locale of \["en", "ja"\]\)/u);
const prefix = source.slice(0, boundary.getFullStart());
const virtual = new URL(receiverUrl); virtual.search = "?receipt-resume-action-fixture";
const hooks = registerHooks({
  load(url, context, next) {
    return url === virtual.href ? { format: "module", source: prefix
      + "\nexport {view,openView,action,activateViewAction,dialog,dispatchLit,event};\n", shortCircuit: true } : next(url, context);
  },
});
const actual = await import(virtual.href).finally(() => hooks.deregister());
export const { view, openView, action, activateViewAction, dialog, dispatchLit, event } = actual;
