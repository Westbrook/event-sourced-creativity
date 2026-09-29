import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import typescript from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFile(resolve(root, path), "utf8");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  }));
  return nested.flat();
}

function registrationGuard(node) {
  let child = node;
  while (child.parent) {
    const parent = child.parent;
    if (typescript.isIfStatement(parent) && parent.thenStatement === child) {
      const condition = parent.expression;
      if (typescript.isPrefixUnaryExpression(condition) && condition.operator === typescript.SyntaxKind.ExclamationToken) {
        const lookup = condition.operand;
        if (typescript.isCallExpression(lookup)
          && typescript.isPropertyAccessExpression(lookup.expression)
          && lookup.expression.expression.getText() === "customElements"
          && lookup.expression.name.text === "get"
          && lookup.arguments[0]?.getText() === node.arguments[0]?.getText()) return parent;
      }
    }
    child = parent;
  }
  return undefined;
}

function strictCustomElementRegistry() {
  const names = new Map();
  const constructors = new WeakMap();
  return {
    get(name) {
      return names.get(name);
    },
    define(name, constructor) {
      if (names.has(name)) throw new DOMException(`The name ${name} has already been used`, "NotSupportedError");
      if (constructors.has(constructor)) throw new DOMException("This constructor has already been used", "NotSupportedError");
      names.set(name, constructor);
      constructors.set(constructor, name);
    },
  };
}

function customElementDeclarations(manifest) {
  return manifest.modules.flatMap((module) => (module.declarations ?? [])
    .filter((declaration) => declaration.customElement)
    .map((declaration) => ({ ...declaration, modulePath: module.path })));
}

function constructorDeclaration(identifier, checker) {
  const symbol = checker.getSymbolAtLocation(identifier);
  const resolvedSymbol = symbol && (symbol.flags & typescript.SymbolFlags.Alias)
    ? checker.getAliasedSymbol(symbol)
    : symbol;
  return resolvedSymbol?.declarations?.find(typescript.isClassDeclaration);
}

function constructorIdentity(declaration) {
  return `${relative(root, declaration.getSourceFile().fileName).replaceAll("\\", "/")}#${declaration.name.text}`;
}

test("manifest generation rejects duplicate names and constructor aliases without confusing equally named classes", async () => {
  const generator = typescript.createSourceFile(
    "scripts/generate-custom-elements-manifest.mjs",
    await read("scripts/generate-custom-elements-manifest.mjs"),
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.JS,
  );
  const implementation = generator.statements.find((statement) => typescript.isFunctionDeclaration(statement) && statement.name?.text === "register");
  assert.ok(implementation, "the manifest generator exposes its constructor registration invariant");

  const firstSource = typescript.createSourceFile("src/first-card.ts", "class Card {}", typescript.ScriptTarget.Latest, true);
  const secondSource = typescript.createSourceFile("src/second-card.ts", "class Card {}", typescript.ScriptTarget.Latest, true);
  const aliasSource = typescript.createSourceFile("src/card-alias.ts", "ImportedCard;", typescript.ScriptTarget.Latest, true);
  const firstClass = firstSource.statements[0];
  const secondClass = secondSource.statements[0];
  const alias = aliasSource.statements[0].expression;
  const firstSymbol = { flags: 0, declarations: [firstClass] };
  const secondSymbol = { flags: 0, declarations: [secondClass] };
  const aliasSymbol = { flags: typescript.SymbolFlags.Alias };
  const symbols = new Map([[firstClass.name, firstSymbol], [secondClass.name, secondSymbol], [alias, aliasSymbol]]);
  const register = runInNewContext(`(${implementation.getText()})`, {
    ts: typescript,
    checker: {
      getSymbolAtLocation(identifier) { return symbols.get(identifier); },
      getAliasedSymbol(symbol) { return symbol === aliasSymbol ? firstSymbol : symbol; },
    },
    classByName: new Map([["Card", firstClass]]),
    registrations: new Map(),
    registrationByConstructor: new Map(),
    explicitRegistrationLocations: new Map(),
    modulePath: (source) => source.fileName,
  });

  register("forma-first-card", "Card", firstSource, firstClass, firstClass.name);
  assert.doesNotThrow(() => register("forma-first-card", "Card", firstSource, undefined, firstClass.name), "documentation may describe the existing registration");
  assert.throws(() => register("forma-first-card", "Card", firstSource, firstClass, firstClass.name), /Duplicate custom element registration/);
  assert.doesNotThrow(() => register("forma-second-card", "Card", secondSource, secondClass, secondClass.name), "distinct modules may legitimately declare classes with the same name");
  assert.throws(() => register("forma-first-card", "Card", secondSource, secondClass, secondClass.name), /Conflicting custom element registration/);
  assert.throws(() => register("forma-third-card", "ImportedCard", aliasSource, alias, alias), /cannot be registered as both/);
});

test("every custom element owns one name and constructor and survives repeated module evaluation", async () => {
  const manifest = JSON.parse(await read("custom-elements.json"));
  const declarations = customElementDeclarations(manifest);
  const declaredNames = new Map(declarations.map((declaration) => [declaration.tagName, declaration]));
  const declaredConstructors = new Map(declarations.map((declaration) => [`${declaration.modulePath}#${declaration.name}`, declaration.tagName]));
  const configuration = typescript.readConfigFile(resolve(root, "tsconfig.json"), typescript.sys.readFile);
  const parsed = typescript.parseJsonConfigFileContent(configuration.config, typescript.sys, root);
  const program = typescript.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();

  assert.equal(declaredNames.size, declarations.length, "custom element names must be globally unique");
  assert.equal(declaredConstructors.size, declarations.length, "a constructor cannot own multiple custom element names");

  const ownersByName = new Map();
  const ownersByConstructor = new Map();
  const remember = (name, constructor, path) => {
    const declaration = constructorDeclaration(constructor, checker);
    assert.ok(declaration?.name, `${constructor.text} resolves to a custom-element class in ${path}`);
    const identity = constructorIdentity(declaration);
    assert.ok(!ownersByName.has(name), `${name} is registered in both ${ownersByName.get(name)} and ${path}`);
    assert.ok(!ownersByConstructor.has(identity), `${identity} is registered in both ${ownersByConstructor.get(identity)} and ${path}`);
    assert.equal(declaredConstructors.get(identity), name, `${name} uses its documented constructor in ${path}`);
    ownersByName.set(name, path);
    ownersByConstructor.set(identity, path);
  };

  for (const path of await sourceFiles(resolve(root, "src"))) {
    const source = program.getSourceFile(path);
    assert.ok(source, `${path} is included in the application TypeScript program`);
    const visit = (node) => {
      if (typescript.isCallExpression(node)
        && typescript.isPropertyAccessExpression(node.expression)
        && node.expression.expression.getText() === "customElements"
        && node.expression.name.text === "define") {
        const guard = registrationGuard(node);
        assert.ok(guard, `customElements.define must first check the same name in ${path}`);

        if (typescript.isStringLiteralLike(node.arguments[0]) && typescript.isIdentifier(node.arguments[1])) {
          const name = node.arguments[0].text;
          const constructorName = node.arguments[1].text;
          remember(name, node.arguments[1], path);

          const registry = strictCustomElementRegistry();
          const original = class OriginalCustomElement {};
          const replacement = class ReloadedCustomElement {};
          runInNewContext(guard.getText(), { customElements: registry, [constructorName]: original });
          runInNewContext(guard.getText(), { customElements: registry, [constructorName]: replacement });
          assert.equal(registry.get(name), original, `${name} must reuse its original constructor after module reevaluation`);
          assert.throws(() => registry.define(`${name}-alias`, original), { name: "NotSupportedError" });
        }
      }

      if (typescript.isArrayLiteralExpression(node)
        && node.elements.length >= 2
        && typescript.isStringLiteralLike(node.elements[0])
        && typescript.isIdentifier(node.elements[1])
        && declaredNames.has(node.elements[0].text)
        && constructorDeclaration(node.elements[1], checker)) {
        remember(node.elements[0].text, node.elements[1], path);
      }

      typescript.forEachChild(node, visit);
    };
    visit(source);
  }

  assert.deepEqual(new Set(ownersByName.keys()), new Set(declaredNames.keys()), "every documented element has exactly one executable registration");
});

test("production routes reuse shared custom-element chunks without duplicating registrations", async () => {
  const [customElementsManifest, manifest] = await Promise.all([
    read("custom-elements.json").then(JSON.parse),
    read("dist/client/.vite/manifest.json").then(JSON.parse),
  ]);
  const declaredNames = new Set(customElementDeclarations(customElementsManifest).map((declaration) => declaration.tagName));
  const chunks = new Map(Object.entries(manifest)
    .filter(([, entry]) => entry.file?.endsWith(".js"))
    .map(([id, entry]) => [entry.file, id]));
  const owners = new Map();

  for (const [file] of chunks) {
    const source = typescript.createSourceFile(file, await read(`dist/client/${file}`), typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
    const remember = (name) => {
      assert.ok(!owners.has(name), `${name} is delivered by both ${owners.get(name)} and ${file}`);
      owners.set(name, file);
    };
    const visit = (node) => {
      if (typescript.isCallExpression(node)
        && typescript.isPropertyAccessExpression(node.expression)
        && node.expression.expression.getText() === "customElements"
        && node.expression.name.text === "define"
        && node.arguments[0] && typescript.isStringLiteralLike(node.arguments[0])) {
        remember(node.arguments[0].text);
      }

      if (typescript.isArrayLiteralExpression(node)
        && node.elements.length >= 2
        && typescript.isStringLiteralLike(node.elements[0])
        && declaredNames.has(node.elements[0].text)
        && (typescript.isIdentifier(node.elements[1]) || typescript.isClassExpression(node.elements[1]))) {
        remember(node.elements[0].text);
      }

      typescript.forEachChild(node, visit);
    };
    visit(source);
  }

  const referenceImageChunk = owners.get("forma-reference-image");
  assert.ok(referenceImageChunk, "production includes one reference-image registration");

  const dependenciesOf = (rootId) => {
    const visited = new Set();
    const visit = (id) => {
      if (visited.has(id)) return;
      const entry = manifest[id];
      assert.ok(entry, `${id} is present in the production manifest`);
      visited.add(id);
      for (const dependency of entry.imports ?? []) visit(dependency);
    };
    visit(rootId);
    return new Set([...visited].map((id) => manifest[id].file));
  };

  for (const route of [
    "src/components/forma-workspace.ts",
    "src/components/forma-library.ts",
    "src/components/forma-creative-editor.ts",
    "src/canvas/canvas-application.ts",
  ]) {
    assert.ok(dependenciesOf(route).has(referenceImageChunk), `${route} must import the same reference-image chunk`);
  }

  for (const entry of ["src/apps/creative/entry.ts", "src/apps/canvas/entry.ts"]) {
    assert.ok(!dependenciesOf(entry).has(referenceImageChunk), `${entry} must leave reference images lazily loaded`);
  }
});
