import ts from "typescript";

/** Keep compiler-emitted local type imports independent of the build checkout. */
export function portableManifestType(text, projectRoot) {
  const root = projectRoot.replaceAll("\\", "/").replace(/\/$/u, "");
  if (!text.includes("import(")) return text;
  const prefix = "type ManifestType = ";
  const source = ts.createSourceFile("manifest-type.ts", prefix + text + ";", ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) return text;
  const edits = [];
  const visit = node => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      const literal = node.argument.literal;
      const specifier = literal.text.replaceAll("\\", "/");
      if (specifier.startsWith(root + "/")) edits.push({
        start: literal.getStart(source) - prefix.length,
        end: literal.end - prefix.length,
        replacement: JSON.stringify("./" + specifier.slice(root.length + 1)),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }
  return text;
}
