import assert from "node:assert/strict";
import ts from "typescript";

// Keep extracted methods verbatim, including their transitive private members
// and calls to other public methods on the same class. Only the caller's named
// I/O ports may replace a member; source/binding decisions remain actual code.
export function actualClassDependencies(parsed, code, declared = [], expression = "") {
  const retained = new Set(declared), dependencies = [];
  const pending = [code + (expression ? "\n__templateExpression = (" + expression + ");" : "")];
  while (pending.length) {
    const tree = ts.createSourceFile("fixture-dependencies.ts", "class Fixture {" + pending.shift() + "}", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    assert.equal(tree.parseDiagnostics.length, 0, "actual extracted members must parse before selecting dependencies");
    const visit = node => {
      const privateName = ts.isPrivateIdentifier(node) ? node.getText(tree) : null;
      const publicName = ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword
        && ts.isIdentifier(node.name) ? node.name.text : null;
      const name = privateName ?? publicName;
      if (name && !retained.has(name)) {
        const value = parsed.host.members.find(member => member.name?.getText(parsed.tree) === name);
        if (privateName) assert.ok(value, "actual private dependency " + name);
        if (value && (privateName || ts.isMethodDeclaration(value))) {
          retained.add(name);
          const source = value.getText(parsed.tree);
          dependencies.push(source); pending.push(source);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return dependencies.join("\n");
}
