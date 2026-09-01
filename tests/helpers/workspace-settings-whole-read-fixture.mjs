// Existing declaration-only fixture reuse. Actual Settings, Store, locale and
// native controls remain complete; only finite fixture declarations are exported.
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";

const base = new URL("../../", import.meta.url);
const tsModule = await import(new URL("node_modules/typescript/lib/typescript.js", base));
const ts = tsModule.default ?? tsModule;
const fixtureUrl = new URL("tests/workspace-settings-response-ownership.test.mjs", base);
const fixtureSource = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length, 0);
const prefix = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
  || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)).map(node => node.getFullText(tree)).join("\n")
  + "\nexport { settingsFixture, endpoint, tokenPath, method, memberReadLiveLocale };\n";
fixtureUrl.search = "workspace-whole-read-fixture-only";
const loader = registerHooks({ load(url, context, next) {
  return url === fixtureUrl.href ? { format: "module", source: prefix, shortCircuit: true } : next(url, context);
} });
let fixture;
try { fixture = await import(fixtureUrl.href); } finally { loader.deregister(); }
export const { settingsFixture, endpoint, tokenPath, method, memberReadLiveLocale } = fixture;
