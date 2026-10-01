#!/usr/bin/env node
/** Fixed registry syntax capture only; no source-module execution or profile dispatch. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createExperienceMaintenanceInventory, EXPERIENCE_MAINTENANCE_REGISTRY_PATH,
  EXPERIENCE_MAINTENANCE_SOURCE_LIMIT } from "../src/experiences/maintenance-inventory.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = EXPERIENCE_MAINTENANCE_REGISTRY_PATH;
const limit = EXPERIENCE_MAINTENANCE_SOURCE_LIMIT;
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = code => { throw new Error(code); };
const sameFile = (left, right) => ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"].every(key => left[key] === right[key]);

async function source(path) {
  let current = sep;
  // The checkout itself and every selected path component must be real, not a symlink.
  for (const part of root.split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) fail("source_symlink");
  }
  current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) fail("source_symlink");
    if (current !== join(root, path) && !stat.isDirectory()) fail("source_directory");
  }
  const before = await lstat(current, { bigint: true });
  if (!before.isFile() || before.size < 1n || before.size > BigInt(limit)) fail("source_limit");
  const handle = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(opened, before)) fail("source_changed");
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const named = await lstat(current, { bigint: true });
    if (length > limit || BigInt(length) !== opened.size || !sameFile(after, opened) || !named.isFile() || !sameFile(named, opened)) fail("source_changed");
    const captured = bytes.subarray(0, length);
    return { descriptor: { path, bytes: length, hash: hash(captured) }, identity: opened, text: new TextDecoder("utf-8", { fatal: true }).decode(captured) };
  } finally { await handle.close(); }
}

/** Syntax only: never evaluate JavaScript, call a getter, resolve an identifier, or follow imports. */
function declarations(text, path) {
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (tree.parseDiagnostics.length) fail("source_syntax");
  const exported = new Map();
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const item of statement.declarationList.declarations) {
      if (!ts.isIdentifier(item.name)) continue;
      if (exported.has(item.name.text)) fail("source_duplicate_export");
      exported.set(item.name.text, { node: item.initializer, constant: Boolean(statement.declarationList.flags & ts.NodeFlags.Const) });
    }
  }
  return name => {
    const declaration = exported.get(name);
    if (!declaration?.node || !declaration.constant) fail("source_export");
    let nodes = 0;
    const literal = (node, depth = 0) => {
      if (++nodes > 2048 || depth > 12) fail("literal_limit");
      if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression, depth + 1);
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { if (node.text.length > 4096) fail("literal_limit"); return node.text; }
      if (ts.isNumericLiteral(node)) { const number = Number(node.text); if (!Number.isFinite(number)) fail("literal_number"); return number; }
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (node.kind === ts.SyntaxKind.NullKeyword) return null;
      if (ts.isArrayLiteralExpression(node)) { if (node.elements.length > 64) fail("literal_limit"); return node.elements.map(item => literal(item, depth + 1)); }
      if (ts.isObjectLiteralExpression(node)) {
        if (node.properties.length > 64) fail("literal_limit");
        const object = Object.create(null);
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) fail("literal_property");
          const key = property.name.text;
          if (["__proto__", "prototype", "constructor"].includes(key) || Object.hasOwn(object, key)) fail("literal_key");
          object[key] = literal(property.initializer, depth + 1);
        }
        return object;
      }
      // Object.freeze is recognized as a wrapper, not called (even if shadowed in the source).
      if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Object" && node.expression.name.text === "freeze") return literal(node.arguments[0], depth + 1);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
        const left = literal(node.left, depth + 1), right = literal(node.right, depth + 1);
        if (typeof left !== "number" || typeof right !== "number" || !Number.isSafeInteger(left * right)) fail("literal_number");
        return left * right;
      }
      fail("literal_expression");
    };
    return literal(declaration.node);
  };
}


export async function captureExperienceMaintenanceInventory() {
  if (arguments.length !== 0) fail("arguments_unavailable");
  const captured = await source(registryPath);
  const registry = declarations(captured.text, registryPath)("experienceResultViewers");
  const inventory = await createExperienceMaintenanceInventory(registry, captured.descriptor);
  if (!inventory) fail("inventory_invalid");
  // Exact whole-file bookend after extraction and hashing. This is not a lock,
  // a signature, a retained baseline, or post-return custody of these bytes.
  const final = await source(registryPath);
  if (!sameFile(captured.identity, final.identity) || captured.descriptor.hash !== final.descriptor.hash) fail("source_changed");
  return inventory;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) fail("arguments_unavailable");
    process.stdout.write(`${JSON.stringify(await captureExperienceMaintenanceInventory())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error instanceof Error && /^[a-z_]+(?![\s\S])/.test(error.message) ? error.message : "capture_failed" })}\n`);
    process.exitCode = 1;
  }
}
