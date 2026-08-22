import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checkOnly = process.argv.includes("--check");
const configurationPath = path.join(root, "tsconfig.json");
const configuration = ts.readConfigFile(configurationPath, ts.sys.readFile);
if (configuration.error) throw new Error(ts.flattenDiagnosticMessageText(configuration.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const checker = program.getTypeChecker();
const compareMachine = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sources = program.getSourceFiles()
  .filter((source) => !source.isDeclarationFile && source.fileName.startsWith(`${root}/src/`))
  .sort((left, right) => compareMachine(left.fileName, right.fileName));

const modulePath = (source) => path.relative(root, source.fileName).split(path.sep).join("/");
const propertyName = (node) => {
  if (!node) return "";
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText();
};
const commentText = (comment) => typeof comment === "string"
  ? comment
  : Array.isArray(comment)
    ? comment.map((item) => typeof item === "string" ? item : item.text ?? "").join("")
    : "";
const tagsOf = (node, name) => ts.getJSDocTags(node)
  .filter((tag) => tag.tagName.text === name)
  .map((tag) => commentText(tag.comment).trim());
const documentation = (node) => {
  const symbol = node.name ? checker.getSymbolAtLocation(node.name) : undefined;
  return symbol ? ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim() : "";
};
const typeText = (node) => {
  try {
    const type = checker.getTypeAtLocation(node);
    const literalUnion = type.isUnion() && type.types.every((item) => item.isStringLiteral() || item.isNumberLiteral() || (item.flags & ts.TypeFlags.BooleanLiteral) !== 0);
    const text = checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation | (literalUnion ? ts.TypeFormatFlags.InTypeAlias : 0));
    return text === "FormaOption[]"
      ? "{ label: string; value: string; disabled?: boolean; description?: string }[]"
      : text;
  } catch {
    return "unknown";
  }
};
const isPublic = (member) => !ts.isPrivateIdentifier(member.name)
  && !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword || modifier.kind === ts.SyntaxKind.StaticKeyword);
const arrayItems = (node) => ts.isArrayLiteralExpression(node)
  ? node.elements
  : ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)
    ? arrayItems(node.expression)
    : [];
const classByName = new Map();
const registrations = new Map();
const catalogedApplicationPatterns = new Set();

for (const source of sources) {
  const visit = (node) => {
    if (ts.isClassDeclaration(node) && node.name) classByName.set(node.name.text, node);
    if (modulePath(source) === "src/components/design-system/catalog.ts" && ts.isObjectLiteralExpression(node)) {
      const value = (name) => {
        const property = node.properties.find((entry) => ts.isPropertyAssignment(entry) && propertyName(entry.name) === name);
        return property && ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)
          ? property.initializer.text
          : "";
      };
      const tag = value("tag");
      if (tag && value("level") === "application") catalogedApplicationPatterns.add(tag);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function register(name, className, source) {
  if (!name.includes("-") || !classByName.has(className)) return;
  const existing = registrations.get(name);
  if (existing && existing.className !== className) throw new Error(`Conflicting custom element registration for ${name}`);
  registrations.set(name, { name, className, registrationModule: modulePath(source) });
}

for (const source of sources) {
  const visit = (node) => {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText() === "customElements"
      && node.expression.name.text === "define"
      && node.arguments.length >= 2
      && ts.isStringLiteralLike(node.arguments[0])
      && ts.isIdentifier(node.arguments[1])) {
      register(node.arguments[0].text, node.arguments[1].text, source);
    }

    if (ts.isArrayLiteralExpression(node) && node.elements.length >= 2
      && ts.isStringLiteralLike(node.elements[0]) && ts.isIdentifier(node.elements[1])) {
      register(node.elements[0].text, node.elements[1].text, source);
    }

    if (ts.isClassDeclaration(node) && node.name) {
      for (const tag of tagsOf(node, "tag")) register(tag.split(/\s+/)[0], node.name.text, source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function reactiveProperties(node) {
  const member = node.members.find((item) => ts.isPropertyDeclaration(item)
    && propertyName(item.name) === "properties"
    && item.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword));
  if (!member?.initializer || !ts.isObjectLiteralExpression(member.initializer)) return new Map();
  const results = new Map();
  for (const entry of member.initializer.properties) {
    if (!ts.isPropertyAssignment(entry) && !ts.isShorthandPropertyAssignment(entry)) continue;
    const name = propertyName(entry.name);
    const options = ts.isPropertyAssignment(entry) && ts.isObjectLiteralExpression(entry.initializer)
      ? entry.initializer.properties
      : [];
    const option = (key) => options.find((item) => ts.isPropertyAssignment(item) && propertyName(item.name) === key);
    const attribute = option("attribute");
    const reflect = option("reflect");
    const attributeName = attribute && ts.isPropertyAssignment(attribute)
      ? attribute.initializer.kind === ts.SyntaxKind.FalseKeyword
        ? false
        : ts.isStringLiteralLike(attribute.initializer)
          ? attribute.initializer.text
          : name.toLowerCase()
      : name.toLowerCase();
    results.set(name, { attribute: attributeName, reflects: Boolean(reflect && ts.isPropertyAssignment(reflect) && reflect.initializer.kind === ts.SyntaxKind.TrueKeyword) });
  }
  return results;
}

function observedAttributes(node) {
  const member = node.members.find((item) => ts.isPropertyDeclaration(item)
    && propertyName(item.name) === "observedAttributes"
    && item.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword));
  return member?.initializer ? arrayItems(member.initializer).filter(ts.isStringLiteralLike).map((entry) => entry.text) : [];
}

const attributeNameForProperty = (name) => name.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`);
const publicFieldDescriptions = {
  action: "Author-supplied, localized visible follow-up action.",
  actions: "Property-only actions with author-localized labels and descriptions and locale-invariant values.",
  active: "Whether this item represents the currently active state.",
  autocomplete: "Native browser autocomplete hint.",
  busy: "Whether an action is currently in progress.",
  busyLabel: "Author-supplied, localized announcement while an action is in progress.",
  checked: "Current native checked state.",
  compact: "Whether the compact presentation is requested.",
  controls: "ID of the element controlled by this action.",
  detail: "Author-supplied, localized supporting explanation.",
  disabled: "Whether user interaction is disabled.",
  error: "Author-supplied, localized validation or error message.",
  eyebrow: "Author-supplied, localized supporting heading.",
  expanded: "Whether the controlled content is expanded.",
  form: "ID of the associated native HTML form.",
  formatLocale: "Canonical BCP 47 locale used for human-readable dates and numbers.",
  heading: "Author-supplied, localized heading text.",
  help: "Author-supplied, localized supporting instructions.",
  iconName: "Stable, locale-invariant icon identifier.",
  label: "Author-supplied, localized visible label or accessible action name.",
  items: "Property-only navigation items with author-localized labels and descriptions and locale-invariant values.",
  max: "Native maximum permitted value.",
  maxLength: "Maximum permitted length of an authored input value.",
  messages: "Property-only author-supplied localized message overrides inherited by descendant components.",
  min: "Native minimum permitted value.",
  minLength: "Minimum required length of an authored input value.",
  name: "Stable native form field or technical identifier; never translate machine identifiers.",
  options: "Property-only options with author-localized labels and descriptions and locale-invariant values.",
  placeholder: "Author-supplied, localized input hint.",
  pressed: "Current toggle-button pressed state.",
  readOnly: "Whether the native control can be read but not edited.",
  required: "Whether a native form value is required.",
  rows: "Number of visible native textarea rows.",
  selected: "Whether this item is selected.",
  step: "Native numeric input step.",
  timeZone: "IANA time zone used for human-readable dates.",
  tone: "Stable semantic visual-tone identifier.",
  type: "Stable native control or form behavior identifier.",
  value: "Locale-invariant machine value or author-entered form value; never derive action identity from translated labels.",
  variant: "Stable visual-variant identifier.",
};

function documentedAttributes(node) {
  const results = new Map();
  for (const entry of tagsOf(node, "attr")) {
    const match = entry.match(/^\{([^}]+)\}\s+([^\s]+)(?:\s*-\s*([\s\S]+))?$/);
    if (match) results.set(match[2], { type: match[1], description: match[3]?.trim() || "" });
  }
  return results;
}

function fieldsOf(node, properties) {
  const results = new Map();
  const observed = new Set(observedAttributes(node));
  for (const member of node.members) {
    if (!member.name || !isPublic(member)) continue;
    const name = propertyName(member.name);
    if (!name || name.startsWith("#")) continue;
    if (ts.isPropertyDeclaration(member) || ts.isGetAccessorDeclaration(member)) {
      const field = { kind: "field", name, type: { text: typeText(member) } };
      if (ts.isPropertyDeclaration(member) && member.initializer) field.default = member.initializer.getText();
      if (ts.isGetAccessorDeclaration(member)) {
        const result = member.body?.statements.find(ts.isReturnStatement)?.expression;
        if (result && ts.isBinaryExpression(result) && result.operatorToken.kind === ts.SyntaxKind.BarBarToken && ts.isStringLiteralLike(result.right)) field.default = JSON.stringify(result.right.text);
      }
      const description = documentation(member);
      if (description) field.description = description;
      const property = properties.get(name);
      if (property && property.attribute !== false) {
        field.attribute = property.attribute;
        if (property.reflects) field.reflects = true;
      }
      const observedName = attributeNameForProperty(name);
      if (!property && observed.has(observedName)) {
        field.attribute = observedName;
        field.reflects = node.members.some((item) => ts.isSetAccessorDeclaration(item) && propertyName(item.name) === name);
      }
      field.description ||= name === "name" && node.name?.text === "FormaUiAvatar"
        ? "Author-supplied human name used for an accessible image label and localized initials."
        : publicFieldDescriptions[name];
      results.set(name, field);
    } else if (ts.isMethodDeclaration(member) && !["render", "connectedCallback", "disconnectedCallback", "attributeChangedCallback", "firstUpdated", "updated", "createRenderRoot"].includes(name)) {
      const method = { kind: "method", name };
      if (member.parameters.length) method.parameters = member.parameters.map((parameter) => ({ name: propertyName(parameter.name), type: { text: typeText(parameter) } }));
      const signature = checker.getSignatureFromDeclaration(member);
      if (signature) method.return = { type: { text: checker.typeToString(signature.getReturnType()) } };
      const description = documentation(member);
      if (description) method.description = description;
      results.set(name, method);
    }
  }

  for (const [name, options] of properties) {
    if (results.has(name)) continue;
    const field = { kind: "field", name, type: { text: "unknown" } };
    if (options.attribute !== false) field.attribute = options.attribute;
    if (options.reflects) field.reflects = true;
    results.set(name, field);
  }
  return [...results.values()].sort((left, right) => compareMachine(left.name, right.name));
}

function attributesOf(node, properties, members) {
  const byName = new Map();
  const documented = documentedAttributes(node);
  for (const [name, options] of properties) {
    if (options.attribute === false) continue;
    const member = members.find((item) => item.name === name);
    const attribute = { name: options.attribute, fieldName: name, type: member?.type ?? { text: "unknown" } };
    if (member?.default !== undefined) attribute.default = String(member.default);
    if (member?.description) attribute.description = member.description;
    byName.set(attribute.name, attribute);
  }
  for (const name of observedAttributes(node)) {
    if (!byName.has(name)) {
      const member = members.find((item) => item.attribute === name || attributeNameForProperty(item.name) === name);
      const attribute = { name, fieldName: member?.name ?? name, type: member?.type ?? { text: "string" } };
      if (member?.default !== undefined) attribute.default = String(member.default);
      if (member?.description) attribute.description = member.description;
      byName.set(name, attribute);
    }
  }
  for (const [name, metadata] of documented) {
    const attribute = byName.get(name);
    if (!attribute) continue;
    if (metadata.description) attribute.description = metadata.description;
    if (metadata.type && (!attribute.type?.text || attribute.type.text === "unknown")) attribute.type = { text: metadata.type };
  }
  return [...byName.values()].sort((left, right) => compareMachine(left.name, right.name));
}

function eventNames(expression) {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isConditionalExpression(expression)) return [...eventNames(expression.whenTrue), ...eventNames(expression.whenFalse)];
  return [];
}

function eventsOf(node) {
  const found = new Map();
  const documented = new Set();
  for (const entry of [...tagsOf(node, "fires"), ...tagsOf(node, "event")]) {
    const match = entry.match(/^\{([\s\S]+)\}\s+([\w-]+)(?:\s*-\s*([\s\S]+))?$/)
      ?? entry.match(/^([\w-]+)(?:\s*-\s*([\s\S]+))?$/);
    if (!match) continue;
    const typed = match[0].startsWith("{");
    const name = typed ? match[2] : match[1];
    const event = { name, type: { text: typed ? match[1] : "CustomEvent<unknown>" } };
    const description = typed ? match[3] : match[2];
    if (description) event.description = `${description.trim()} Bubbles and crosses component boundaries.`;
    found.set(name, event);
    documented.add(name);
  }

  const mergeEvent = (name, event) => {
    const previous = found.get(name);
    if (!previous) { found.set(name, event); return; }
    if (documented.has(name) || previous.type.text === event.type.text) return;
    const previousWidened = previous.type.text.replace(/\b(?:true|false)\b/g, "boolean");
    const nextWidened = event.type.text.replace(/\b(?:true|false)\b/g, "boolean");
    previous.type.text = previousWidened === nextWidened
      ? previousWidened
      : `CustomEvent<${[previous.type.text, event.type.text].map((text) => text.replace(/^CustomEvent</, "").replace(/>$/, "")).sort().join(" | ")}>`;
  };

  const visit = (child) => {
    if (ts.isNewExpression(child) && child.expression.getText() === "CustomEvent" && child.arguments?.length) {
      for (const name of eventNames(child.arguments[0])) {
        if (documented.has(name)) continue;
        const options = child.arguments[1];
        const detail = options && ts.isObjectLiteralExpression(options)
          ? options.properties.find((item) => ts.isPropertyAssignment(item) && propertyName(item.name) === "detail")
          : undefined;
        const detailType = detail && ts.isPropertyAssignment(detail)
          ? typeText(detail.initializer)
          : child.typeArguments?.[0]
            ? child.typeArguments[0].getText()
            : "null";
        mergeEvent(name, { name, type: { text: `CustomEvent<${detailType}>` }, description: "Bubbles and crosses component boundaries." });
      }
    }

    if (ts.isCallExpression(child) && child.expression.getText() === "emitFormaEvent" && child.arguments.length >= 3) {
      for (const name of eventNames(child.arguments[1])) {
        if (!documented.has(name)) mergeEvent(name, { name, type: { text: `CustomEvent<${typeText(child.arguments[2])}>` }, description: "Bubbles and crosses component boundaries." });
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...found.values()].sort((left, right) => compareMachine(left.name, right.name));
}

function cssPropertiesOf(node) {
  const entries = new Map();
  for (const entry of [...tagsOf(node, "cssprop"), ...tagsOf(node, "cssproperty")]) {
    const match = entry.match(/^\{([^}]+)\}\s+(--[\w-]+)(?:\s*-\s*([\s\S]+))?$/)
      ?? entry.match(/^(--[\w-]+)(?:\s*-\s*([\s\S]+))?$/);
    if (!match) continue;
    const typed = match[0].startsWith("{");
    const property = { name: typed ? match[2] : match[1] };
    if (typed) property.syntax = match[1];
    const description = typed ? match[3] : match[2];
    if (description) property.description = description.trim();
    entries.set(property.name, property);
  }
  return [...entries.values()].sort((left, right) => compareMachine(left.name, right.name));
}

function inheritsFrom(node, name) {
  const seen = new Set();
  let current = node;
  while (current && !seen.has(current)) {
    if (current.name?.text === name) return true;
    seen.add(current);
    const expression = current.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
    if (!expression) return false;
    let symbol = checker.getSymbolAtLocation(expression);
    if (symbol && (symbol.flags & ts.SymbolFlags.Alias)) symbol = checker.getAliasedSymbol(symbol);
    current = symbol?.declarations?.find(ts.isClassDeclaration) ?? classByName.get(expression.getText());
  }
  return false;
}

function slotsOf(node) {
  const entries = new Map();
  for (const entry of tagsOf(node, "slot")) {
    let name = "";
    let description = "";
    if (!entry || entry.startsWith("-")) {
      description = entry.replace(/^-\s*/, "").trim();
    } else {
      const match = entry.match(/^([^\s]+)(?:\s*-\s*([\s\S]*))?$/);
      if (!match) throw new Error(`Invalid @slot declaration on ${node.name?.text ?? "anonymous element"}: ${entry}`);
      name = match[1];
      description = match[2]?.trim() ?? "";
    }
    if (entries.has(name)) throw new Error(`Duplicate @slot "${name || "(default)"}" on ${node.name?.text ?? "anonymous element"}`);
    entries.set(name, { name, ...(description ? { description } : {}) });
  }

  const rendered = new Set([...node.getText().matchAll(/<slot(?:\s+name=(?:"([^"]*)"|'([^']*)'))?\s*>/g)]
    .map((match) => match[1] ?? match[2] ?? ""));
  for (const name of entries.keys()) {
    if (!rendered.has(name)) throw new Error(`${node.name?.text ?? "Element"} documents an unrendered @slot "${name || "(default)"}"`);
  }
  for (const name of rendered) {
    if (!entries.has(name)) throw new Error(`${node.name?.text ?? "Element"} renders an undocumented slot "${name || "(default)"}"`);
  }
  return [...entries.values()].sort((left, right) => compareMachine(left.name, right.name));
}

function categoryFor(name, file) {
  if (name === "forma-component-catalog") return "organism";
  if (name === "forma-ui-theme" || name === "forma-ui-locale") return "foundation";
  if (["forma-ui-empty-state", "forma-ui-dialog", "forma-ui-page-header", "forma-ui-popover", "forma-ui-card"].includes(name)) return "organism";
  if (["forma-ui-button", "forma-ui-badge", "forma-ui-link"].includes(name) || file.endsWith("/atoms.ts")) return "atom";
  if (name.startsWith("forma-ui-")) return "molecule";
  return "application";
}

const modules = new Map();
function moduleFor(name) {
  if (!modules.has(name)) modules.set(name, { kind: "javascript-module", path: name, declarations: [], exports: [] });
  return modules.get(name);
}

const authorTextAttributes = new Set(["label", "heading", "detail", "help", "error", "placeholder", "action", "busy-label", "summary", "trigger", "confirm", "cancel", "eyebrow"]);
const invariantValueElements = new Set(["forma-ui-button", "forma-ui-icon-button", "forma-ui-chip", "forma-ui-checkbox", "forma-ui-switch", "forma-ui-radio-group", "forma-ui-select", "forma-ui-segmented-control", "forma-ui-tabs", "forma-ui-list-item", "forma-ui-card", "forma-ui-page-header", "forma-ui-notice"]);
const internalMessagesByTag = {
  "forma-ui-button": ["action.default", "action.working", "action.busy"],
  "forma-ui-icon-button": ["action.more", "action.close", "field.search", "action.save", "action.open", "action.default"],
  "forma-ui-avatar": ["avatar.unnamed", "avatar.person"],
  "forma-ui-chip": ["filter.label", "filter.remove"],
  "forma-ui-spinner": ["status.loading"],
  "forma-ui-progress": ["status.progress"],
  "forma-ui-link": ["navigation.openLink", "navigation.opensInNewTab"],
  "forma-ui-field": ["field.text"],
  "forma-ui-search": ["field.search", "field.clearSearch"],
  "forma-ui-textarea": ["field.text"],
  "forma-ui-rich-text": ["field.text", "editor.formatting", "editor.bold", "editor.italic", "editor.heading", "editor.bullets", "editor.numbered", "editor.quote", "editor.link", "editor.help", "editor.applied"],
  "forma-ui-select": ["field.choose"],
  "forma-ui-checkbox": ["field.option"],
  "forma-ui-switch": ["field.setting"],
  "forma-ui-radio-group": ["field.choose"],
  "forma-ui-number-field": ["field.number"],
  "forma-ui-segmented-control": ["field.choose"],
  "forma-ui-tabs": ["navigation.sections"],
  "forma-ui-breadcrumbs": ["navigation.breadcrumbs"],
  "forma-ui-pagination": ["navigation.pagination", "navigation.previous", "navigation.next", "navigation.page"],
  "forma-ui-toolbar": ["navigation.actions"],
  "forma-ui-notice": ["notice.dismiss"],
  "forma-ui-disclosure": ["disclosure.more"],
  "forma-ui-copy-button": ["clipboard.copy", "clipboard.success", "clipboard.failure"],
  "forma-ui-popover": ["popover.open"],
  "forma-ui-dialog": ["dialog.heading", "dialog.open", "dialog.confirm", "dialog.cancel", "dialog.close"],
};

for (const registration of [...registrations.values()].sort((left, right) => compareMachine(left.name, right.name))) {
  const node = classByName.get(registration.className);
  const file = modulePath(node.getSourceFile());
  const module = moduleFor(file);
  const properties = reactiveProperties(node);
  const members = fieldsOf(node, properties);
  const attributes = attributesOf(node, properties, members);
  const events = eventsOf(node);
  const cssProperties = cssPropertiesOf(node);
  const shadow = inheritsFrom(node, "FormaSlottedElement");
  const storeIndependentPresentational = inheritsFrom(node, "FormaPresentationalElement") && !inheritsFrom(node, "FormaElement");
  const stateful = !registration.name.startsWith("forma-ui-") && registration.name !== "forma-component-catalog" && !storeIndependentPresentational;
  const applicationDemonstration = catalogedApplicationPatterns.has(registration.name);
  if (!shadow && tagsOf(node, "slot").length) throw new Error(`${registration.name} documents slots without a shadow root`);
  const slots = shadow ? slotsOf(node) : [];
  const summary = tagsOf(node, "summary")[0];
  const description = documentation(node);
  const declaration = { kind: "class", name: registration.className, tagName: registration.name, customElement: true };
  const readableName = registration.name.replace(/^forma-(?:ui-)?/, "").replace(/-/g, " ");
  declaration.summary = summary || `${readableName.charAt(0).toUpperCase()}${readableName.slice(1)} application interface.`;
  declaration.description = description || summary || `${stateful ? "Application-connected" : "Store-independent"} ${readableName} interface. Inspect its actual attributes, JavaScript properties, and events before composing it.`;

  const base = node.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
  if (base) {
    const baseName = base.expression.getText();
    declaration.superclass = classByName.has(baseName)
      ? { name: baseName, module: modulePath(classByName.get(baseName).getSourceFile()) }
      : baseName === "HTMLElement"
        ? { name: baseName, package: "global:" }
        : { name: baseName, package: "lit" };
  }

  if (members.length) declaration.members = members;
  if (attributes.length) declaration.attributes = attributes;
  if (events.length) declaration.events = events;
  if (cssProperties.length) declaration.cssProperties = cssProperties;
  if (slots.length) declaration.slots = slots;
  if (registration.name.startsWith("forma-ui-") || applicationDemonstration) declaration.demos = [{ url: `/laboratory/design-system#${registration.name}` }];
  else if (registration.name === "forma-component-catalog") declaration.demos = [{ url: "/laboratory/design-system" }];
  const optionCollections = ["options", "items", "actions"].filter((name) => members.some((member) => member.kind === "field" && member.name === name));
  const localizedAttributes = attributes.filter((attribute) => authorTextAttributes.has(attribute.name) || registration.name === "forma-ui-avatar" && attribute.name === "name").map((attribute) => attribute.name);
  const stableValues = [...optionCollections.map((name) => `${name}[].value`), ...(invariantValueElements.has(registration.name) && members.some((member) => member.name === "value") ? ["value"] : [])];
  const localization = registration.name.startsWith("forma-ui-") || applicationDemonstration || registration.name === "forma-component-catalog"
    ? {
      documentationIdPrefix: `component.${registration.name}`,
      authorTextAttributes: localizedAttributes,
      authorOwnedSlots: slots.map((slot) => slot.name),
      ...(optionCollections.length ? { optionTextPaths: optionCollections.flatMap((name) => [`${name}[].label`, `${name}[].description`]) } : {}),
      ...(stableValues.length ? { invariantValuePaths: stableValues } : {}),
      ...(registration.name === "forma-ui-locale" ? { authorCatalogProperties: ["messages"] } : {}),
      ...(internalMessagesByTag[registration.name]?.length ? { internalMessages: internalMessagesByTag[registration.name] } : {}),
    }
    : undefined;
  declaration["x-forma"] = {
    category: categoryFor(registration.name, file),
    renderRoot: shadow ? "shadow" : "light",
    stateful,
    ...(applicationDemonstration ? { demonstration: "isolated-composition" } : {}),
    ...(localization ? { i18n: localization } : {}),
  };
  module.declarations.push(declaration);
  module.exports.push({ kind: "js", name: registration.className, declaration: { name: registration.className, module: file } });

  const registrationModule = moduleFor(registration.registrationModule);
  registrationModule.exports.push({ kind: "custom-element-definition", name: registration.name, declaration: { name: registration.className, module: file } });
}

for (const name of ["FormaPresentationalElement", "FormaSlottedElement", "FormaElement"]) {
  const node = classByName.get(name);
  if (!node) continue;
  const file = modulePath(node.getSourceFile());
  const module = moduleFor(file);
  const declaration = { kind: "class", name, description: documentation(node) || `Shared ${name} base class.` };
  const base = node.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
  if (base) {
    const baseName = base.expression.getText();
    declaration.superclass = classByName.has(baseName)
      ? { name: baseName, module: modulePath(classByName.get(baseName).getSourceFile()) }
      : { name: baseName, package: "lit" };
  }
  module.declarations.push(declaration);
  module.exports.push({ kind: "js", name, declaration: { name, module: file } });
}

for (const module of modules.values()) {
  module.declarations.sort((left, right) => compareMachine(left.name, right.name));
  const exports = new Map(module.exports.map((entry) => [`${entry.kind}:${entry.name}`, entry]));
  module.exports = [...exports.values()].sort((left, right) => compareMachine(`${left.kind}:${left.name}`, `${right.kind}:${right.name}`));
}

const manifest = {
  schemaVersion: "2.1.0",
  readme: "README.md",
  "x-forma": {
    i18n: {
      schemaVersion: 1,
      sourceLocale: "en",
      defaultLocale: "en",
      supportedLocales: ["en", "fr", "ar"],
      fallback: "lookup",
      delivery: "bundled-runtime",
      scopeElement: "forma-ui-locale",
      messageIdVersion: 1,
      documentationIds: {
        title: "component.{tag}.title",
        summary: "component.{tag}.summary",
        usage: "component.{tag}.usage",
        namedSlotDescription: "component.{tag}.slot.named.{name}.description",
        defaultSlotDescription: "component.{tag}.slot.$default.description",
        attributeDescription: "component.{tag}.attribute.{name}.description",
        eventDescription: "component.{tag}.event.{name}.description",
        cssPropertyDescription: "component.{tag}.css.{name}.description",
      },
    },
  },
  modules: [...modules.values()].sort((left, right) => compareMachine(left.path, right.path)),
};
const contents = `${JSON.stringify(manifest, null, 2)}\n`;
const destinations = [path.join(root, "custom-elements.json"), path.join(root, "public", "custom-elements.json")];

if (checkOnly) {
  for (const destination of destinations) {
    let actual;
    try { actual = await readFile(destination, "utf8"); }
    catch { throw new Error(`Missing Custom Elements Manifest: ${path.relative(root, destination)}`); }
    if (actual !== contents) throw new Error(`Stale Custom Elements Manifest: ${path.relative(root, destination)}. Run pnpm cem.`);
  }
  process.stdout.write(`Custom Elements Manifest is current (${registrations.size} elements).\n`);
} else {
  await mkdir(path.dirname(destinations[1]), { recursive: true });
  await Promise.all(destinations.map((destination) => writeFile(destination, contents)));
  process.stdout.write(`Generated Custom Elements Manifest for ${registrations.size} elements.\n`);
}
