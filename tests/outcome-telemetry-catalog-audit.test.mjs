import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import typescript from "typescript";

const auditUrl = new URL("../scripts/check-system-localization.mjs", import.meta.url);
const auditSource = readFileSync(auditUrl, "utf8");
const syntax = typescript.createSourceFile(auditUrl.pathname, auditSource, typescript.ScriptTarget.Latest, true);
const imports = {};
for (const statement of syntax.statements) {
  if (!typescript.isImportDeclaration(statement)) continue;
  const specifier = statement.moduleSpecifier.text;
  const module = await import(specifier.startsWith(".") ? new URL(specifier, auditUrl).href : specifier);
  const clause = statement.importClause;
  if (clause?.name) imports[clause.name.text] = module.default;
  if (clause?.namedBindings && typescript.isNamedImports(clause.namedBindings)) {
    for (const binding of clause.namedBindings.elements) imports[binding.name.text] = module[binding.propertyName?.text ?? binding.name.text];
  } else if (clause?.namedBindings && typescript.isNamespaceImport(clause.namedBindings)) {
    imports[clause.namedBindings.name.text] = module;
  }
}
assert.ok(imports.FORMA_OUTCOME_MESSAGES, "the actual auditor imports the runtime outcome catalog");
const catalogBefore = JSON.stringify(imports.FORMA_OUTCOME_MESSAGES);
const aggregateBefore = JSON.stringify([imports.frenchMessages, imports.arabicMessages, imports.japaneseMessages]);
const originalFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls += 1; throw new Error("Catalog auditing cannot request external data"); };
test.after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(externalCalls, 0);
  assert.equal(JSON.stringify(imports.FORMA_OUTCOME_MESSAGES), catalogBefore);
  assert.equal(JSON.stringify([imports.frenchMessages, imports.arabicMessages, imports.japaneseMessages]), aggregateBefore);
});

// Execute the actual complete audit, including the real source/manifest traversal.
// Only module bindings, import.meta.url, diagnostics and exit status are ports.
// The validation loops are neither copied nor replaced; every negative uses
// detached catalog copies, never edits to a runtime catalog or a source file.
function runAudit({ source = auditSource, bindings = {} } = {}) {
  const tree = typescript.createSourceFile(auditUrl.pathname, source, typescript.ScriptTarget.Latest, true);
  let body = source;
  for (const statement of [...tree.statements].reverse()) {
    if (!typescript.isImportDeclaration(statement)) continue;
    const start = statement.getStart(tree), end = statement.end;
    body = body.slice(0, start) + body.slice(start, end).replace(/[^\n]/gu, " ") + body.slice(end);
  }
  body = body.replaceAll("import.meta.url", "auditUrl");
  const messages = [], errors = [], status = { exitCode: 0 };
  const ports = { ...imports, ...bindings, auditUrl, process: status,
    console: { log: (...values) => messages.push(values.join(" ")), error: (...values) => errors.push(values.join(" ")) } };
  Function(...Object.keys(ports), body)(...Object.values(ports));
  return { status: status.exitCode, messages: messages.join("\n"), errors: errors.join("\n") };
}

const outcomeIds = ["outcome.currentPeriodOnly", "outcome.personalUnavailable", "outcome.accessUnavailable", "outcome.loadUnavailable"];
test("the actual localization audit includes the unchanged runtime outcome catalog", () => {
  for (const id of outcomeIds) for (const locale of ["en", "fr", "ar", "ja"]) assert.ok(imports.FORMA_OUTCOME_MESSAGES[locale][id]);
  const result = runAudit();
  assert.equal(result.status, 0, result.errors);
  assert.equal(result.errors, "");
  assert.match(result.messages, /Localization audit passed:/u);
});

test("removing outcome registration fails the actual audit instead of hiding direct references", () => {
  const registration = "sharedCatalogs.push(FORMA_OUTCOME_MESSAGES);\n";
  assert.equal(auditSource.split(registration).length, 2);
  const result = runAudit({ source: auditSource.replace(registration, "") });
  assert.equal(result.status, 1);
  for (const id of outcomeIds) assert.ok(result.errors.includes("references " + id + " without an authoritative English message"), result.errors);
  assert.match(result.errors, /Localization audit failed with \d+ uncovered system messages\./u);
  assert.doesNotMatch(result.messages, /Localization audit passed:/u);
});

test("a missing outcome English catalog entry fails the actual reference audit", () => {
  const catalog = structuredClone(imports.FORMA_OUTCOME_MESSAGES);
  delete catalog.en["outcome.accessUnavailable"];
  const result = runAudit({ bindings: { FORMA_OUTCOME_MESSAGES: catalog } });
  assert.equal(result.status, 1);
  assert.ok(result.errors.includes("references outcome.accessUnavailable without an authoritative English message"), result.errors);
});

for (const [locale, aggregate] of [["fr", "frenchMessages"], ["ar", "arabicMessages"], ["ja", "japaneseMessages"]]) {
  test("a missing " + locale + " outcome translation fails the actual audit", () => {
    const catalog = structuredClone(imports.FORMA_OUTCOME_MESSAGES), messages = { ...imports[aggregate] };
    delete catalog[locale]["outcome.currentPeriodOnly"]; delete messages["outcome.currentPeriodOnly"];
    const result = runAudit({ bindings: { FORMA_OUTCOME_MESSAGES: catalog, [aggregate]: messages } });
    assert.equal(result.status, 1);
    assert.ok(result.errors.includes(locale + " is missing the responsive message outcome.currentPeriodOnly"), result.errors);
  });
  test("a changed " + locale + " outcome interpolation placeholder fails the actual audit", () => {
    const catalog = structuredClone(imports.FORMA_OUTCOME_MESSAGES);
    assert.ok(catalog[locale]["outcome.currentPeriodOnly"].includes("{period}"));
    catalog[locale]["outcome.currentPeriodOnly"] = catalog[locale]["outcome.currentPeriodOnly"].replace("{period}", "{wrongPeriod}");
    const messages = { ...imports[aggregate], "outcome.currentPeriodOnly": catalog[locale]["outcome.currentPeriodOnly"] };
    const result = runAudit({ bindings: { FORMA_OUTCOME_MESSAGES: catalog, [aggregate]: messages } });
    assert.equal(result.status, 1);
    assert.ok(result.errors.includes(locale + " changes interpolation placeholders for responsive message outcome.currentPeriodOnly"), result.errors);
  });
}
