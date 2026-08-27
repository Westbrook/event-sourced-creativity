import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import typescript from "typescript";
import { BLOCK_GROUPS, BLOCK_INTENTS, BLOCK_TYPES, REFERENCE_PIXEL_MODES } from "../src/model/block-types.ts";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";
import englishMessages from "../src/components/design-system/locales/system-en.ts";
import frenchMessages from "../src/components/design-system/locales/fr.ts";
import arabicMessages from "../src/components/design-system/locales/ar.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";
import { FORMA_RESPONSIVE_MESSAGES } from "../src/components/design-system/locales/responsive-messages.ts";
import { FORMA_NEXT_ACTION_MESSAGES } from "../src/components/design-system/locales/next-action-messages.ts";
import marketingEnglish from "../src/marketing/locales/en.ts";
import marketingFrench from "../src/marketing/locales/fr.ts";
import marketingArabic from "../src/marketing/locales/ar.ts";
import marketingJapanese from "../src/marketing/locales/ja.ts";
import hollywoodEnglish from "../src/marketing/profiles/hollywood-filmmakers/en.ts";
import hollywoodFrench from "../src/marketing/profiles/hollywood-filmmakers/fr.ts";
import hollywoodArabic from "../src/marketing/profiles/hollywood-filmmakers/ar.ts";
import hollywoodJapanese from "../src/marketing/profiles/hollywood-filmmakers/ja.ts";
import marketersEnglish from "../src/marketing/profiles/marketers/en.ts";
import marketersFrench from "../src/marketing/profiles/marketers/fr.ts";
import marketersArabic from "../src/marketing/profiles/marketers/ar.ts";
import marketersJapanese from "../src/marketing/profiles/marketers/ja.ts";
import indieEnglish from "../src/marketing/profiles/indie-filmmakers/en.ts";
import indieFrench from "../src/marketing/profiles/indie-filmmakers/fr.ts";
import indieArabic from "../src/marketing/profiles/indie-filmmakers/ar.ts";
import indieJapanese from "../src/marketing/profiles/indie-filmmakers/ja.ts";
import { auditStaticHtmlTemplate } from "./audit-static-html-localization.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogs = new Map([["fr", frenchMessages], ["ar", arabicMessages], ["ja", japaneseMessages]]);
const errors = [];
const normalize = (value) => String(value).replace(/\s+/gu, " ").trim();
const placeholders = (value) => [...String(value).matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]).sort().join("|");
const sharedCatalogs=[FORMA_RESPONSIVE_MESSAGES,FORMA_NEXT_ACTION_MESSAGES];
const defaults = new Map(sharedCatalogs.flatMap((catalog)=>Object.entries(catalog.en)));
const defaultSource = typescript.createSourceFile("localization.ts", readFileSync(resolve(root, "src/components/design-system/localization.ts"), "utf8"), typescript.ScriptTarget.Latest, true);

for (const statement of defaultSource.statements) {
  if (!typescript.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (!typescript.isIdentifier(declaration.name) || declaration.name.text !== "FORMA_DEFAULT_MESSAGES" || !declaration.initializer || !typescript.isObjectLiteralExpression(declaration.initializer)) continue;
    for (const property of declaration.initializer.properties) {
      if (typescript.isPropertyAssignment(property) && typescript.isStringLiteralLike(property.name) && typescript.isStringLiteralLike(property.initializer)) {
        defaults.set(property.name.text, property.initializer.text);
      }
    }
  }
}

const knownEnglish = new Set([...Object.values(englishMessages), ...defaults.values()].map(normalize));

for (const [id, source] of Object.entries(englishMessages)) {
  if (id !== formaSystemMessageId(source)) errors.push(`Invalid stable message identifier: ${id}`);
  for (const [locale, messages] of catalogs) {
    if (!messages[id]?.trim()) errors.push(`${locale} is missing the system copy ${JSON.stringify(source)}`);
    else if (placeholders(messages[id]) !== placeholders(source)) errors.push(`${locale} changes interpolation placeholders for ${id}`);
  }
}

for (const catalog of sharedCatalogs) for (const [id, source] of Object.entries(catalog.en)) {
  for (const [locale, messages] of catalogs) {
    const translation = catalog[locale]?.[id];
    if (!translation?.trim()) errors.push(`${locale} is missing the responsive message ${id}`);
    else if (placeholders(translation) !== placeholders(source)) errors.push(`${locale} changes interpolation placeholders for responsive message ${id}`);
    else if (messages[id] !== translation) errors.push(`${locale} overrides the authoritative responsive message ${id}`);
  }
}

const marketingCatalogs = { en: marketingEnglish, fr: marketingFrench, ar: marketingArabic, ja: marketingJapanese };
const marketingProfiles = {
  "hollywood-filmmakers": { name: "The Glass Meridian", catalogs: { en: hollywoodEnglish, fr: hollywoodFrench, ar: hollywoodArabic, ja: hollywoodJapanese } },
  marketers: { name: "The Brighter Hour", catalogs: { en: marketersEnglish, fr: marketersFrench, ar: marketersArabic, ja: marketersJapanese } },
  "indie-filmmakers": { name: "The Last Light on Mercer", catalogs: { en: indieEnglish, fr: indieFrench, ar: indieArabic, ja: indieJapanese } },
};
const marketingKeys = Object.keys(marketingEnglish).sort();
for (const [locale, messages] of Object.entries(marketingCatalogs)) {
  if (Object.keys(messages).sort().join("|") !== marketingKeys.join("|")) errors.push(`${locale} changes the shared public marketing catalog keys`);
  for (const [id, source] of Object.entries(marketingEnglish)) {
    if (!messages[id]?.trim()) errors.push(`${locale} is missing public marketing copy ${id}`);
    else if (placeholders(messages[id]) !== placeholders(source)) errors.push(`${locale} changes public marketing interpolation placeholders for ${id}`);
  }
}

for (const [profile, { name, catalogs: translations }] of Object.entries(marketingProfiles)) {
  const source = translations.en;
  const keys = Object.keys(source);
  for (const [locale, messages] of Object.entries(translations)) {
    if (Object.keys(messages).join("|") !== keys.join("|")) errors.push(`${profile}/${locale} changes the approved audience-catalog key order or coverage`);
    if (messages.projectName !== name) errors.push(`${profile}/${locale} changes the authored project name`);
    const upload = ({ en: /\bupload\b/iu, fr: /\b(?:téléversez|importez)\b/iu, ar: /(?:ارفع|رفع|تحميل)/u, ja: /アップロード/u })[locale];
    if (!upload.test(messages.processCollectBody ?? "")) errors.push(`${profile}/${locale} hides the private, owned-or-licensed recording upload workflow`);
    for (const [id, value] of Object.entries(source)) {
      if (!Object.hasOwn(marketingEnglish, id)) errors.push(`${profile}/${locale} introduces an unknown public marketing message ${id}`);
      else if (typeof messages[id] !== "string" || !messages[id].trim()) errors.push(`${profile}/${locale} is missing translated audience copy ${id}`);
      else if (placeholders(messages[id]) !== placeholders(value)) errors.push(`${profile}/${locale} changes audience interpolation placeholders for ${id}`);
      else if (/&(amp|lt|gt|quot);|&#\d+;/u.test(messages[id])) errors.push(`${profile}/${locale}.${id} contains pre-escaped HTML`);
    }
    if (locale !== "en") {
      for (const id of ["pageTitle", "heroTitle", "heroIntroduction", "proofTitle", "previewStoryParagraphOne", "outputVideoDetail"]) {
        if (messages[id] === source[id]) errors.push(`${profile}/${locale}.${id} falls back to untranslated English`);
      }
    }
  }
}

for (const definition of [...BLOCK_GROUPS, ...BLOCK_INTENTS, ...BLOCK_TYPES, ...REFERENCE_PIXEL_MODES]) {
  for (const property of ["label", "description", "prompt"]) {
    const value = definition[property];
    if (value && !knownEnglish.has(normalize(value))) errors.push(`Untranslated block vocabulary ${property}: ${value}`);
  }
}
for (const definition of BLOCK_TYPES) {
  for (const subtype of definition.subtypes) {
    if (!knownEnglish.has(normalize(subtype))) errors.push(`Untranslated ${definition.type} subtype: ${subtype}`);
  }
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = resolve(directory, entry);
    if (statSync(absolute).isDirectory()) files.push(...sourceFiles(absolute));
    else if (absolute.endsWith(".ts")) files.push(absolute);
  }
  return files;
}

const clientFiles = ["src/components", "src/apps", "src/canvas", "src/state"].flatMap((directory) => sourceFiles(resolve(root, directory)))
  .filter((file) => !file.includes("/design-system/locales/"));
const referencedIds = new Set();

for (const file of clientFiles) {
  const source = typescript.createSourceFile(file, readFileSync(file, "utf8"), typescript.ScriptTarget.Latest, true);
  const relative = file.slice(root.length + 1);
  function visit(node) {
    if (typescript.isTaggedTemplateExpression(node) && node.tag.getText(source) === "html") {
      auditStaticHtmlTemplate({ typescript, knownEnglish, errors, node, source, relative });
    }
    if (typescript.isCallExpression(node) && typescript.isPropertyAccessExpression(node.expression) && node.expression.name.text === "t") {
      const id = node.arguments[0];
      if (id && typescript.isStringLiteralLike(id)) {
        referencedIds.add(id.text);
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (!defaults.has(id.text)) errors.push(`${relative}:${line} references ${id.text} without an authoritative English message`);
        for (const [locale, messages] of catalogs) {
          if (!messages[id.text]?.trim()) errors.push(`${relative}:${line} references ${id.text} without a ${locale} translation`);
        }
      }
    }
    if (typescript.isCallExpression(node) && typescript.isPropertyAccessExpression(node.expression) && node.expression.name.text === "system") {
      const copy = node.arguments[0];
      if (copy && typescript.isStringLiteralLike(copy) && !knownEnglish.has(normalize(copy.text))) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        errors.push(`${relative}:${line} sends uncatalogued system copy to localization: ${JSON.stringify(copy.text)}`);
      }
    }
    if (typescript.isCallExpression(node) && typescript.isPropertyAccessExpression(node.expression) && node.expression.name.text === "confirm") {
      const copy = node.arguments[0];
      if (copy && typescript.isStringLiteralLike(copy)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        errors.push(`${relative}:${line} displays an untranslated native confirmation`);
      }
    }
    if (typescript.isCallExpression(node) && typescript.isPropertyAccessExpression(node.expression) && node.expression.name.text === "toast") {
      const inspectNotice = (value) => {
        if (!value) return;
        if (typescript.isStringLiteralLike(value)) {
          if (value.text && !knownEnglish.has(normalize(value.text))) {
            const line = source.getLineAndCharacterOfPosition(value.getStart(source)).line + 1;
            errors.push(`${relative}:${line} displays an uncatalogued system notification: ${JSON.stringify(value.text)}`);
          }
        } else if (typescript.isTemplateExpression(value)) {
          const fragments = [value.head.text, ...value.templateSpans.map((span) => span.literal.text)];
          if (fragments.some((fragment) => /[A-Za-z]{3,}/u.test(fragment))) {
            const line = source.getLineAndCharacterOfPosition(value.getStart(source)).line + 1;
            errors.push(`${relative}:${line} displays an unlocalized interpolated system notification`);
          }
        } else if (typescript.isConditionalExpression(value)) {
          inspectNotice(value.whenTrue);
          inspectNotice(value.whenFalse);
        } else if (typescript.isParenthesizedExpression(value) || typescript.isAsExpression(value) || typescript.isTypeAssertionExpression(value) || typescript.isNonNullExpression(value)) {
          inspectNotice(value.expression);
        } else if (typescript.isBinaryExpression(value) && [typescript.SyntaxKind.BarBarToken, typescript.SyntaxKind.QuestionQuestionToken].includes(value.operatorToken.kind)) {
          inspectNotice(value.left);
          inspectNotice(value.right);
        }
      };
      inspectNotice(node.arguments[0]);
    }
    if (typescript.isNewExpression(node) && typescript.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(source) === "Intl"
      && ["NumberFormat", "DateTimeFormat", "RelativeTimeFormat", "PluralRules", "Collator", "Segmenter"].includes(node.expression.name.text)) {
      const first = node.arguments?.[0];
      if (!first || typescript.isIdentifier(first) && first.text === "undefined" || typescript.isArrayLiteralExpression(first) && first.elements.length === 0) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        errors.push(`${relative}:${line} formats with the browser locale instead of the selected application locale`);
      }
    }
    if (typescript.isCallExpression(node) && typescript.isPropertyAccessExpression(node.expression)
      && ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].includes(node.expression.name.text)
      && (!node.arguments.length
        || typescript.isIdentifier(node.arguments[0]) && node.arguments[0].text === "undefined"
        || typescript.isArrayLiteralExpression(node.arguments[0]) && node.arguments[0].elements.length === 0)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      errors.push(`${relative}:${line} formats with the browser locale instead of the selected application locale`);
    }
    typescript.forEachChild(node, visit);
  }
  visit(source);
}

function auditManifest(value, pointer = "") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => auditManifest(child, `${pointer}/${index}`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [name, child] of Object.entries(value)) {
    if (typeof child === "string" && /^(?:summary|description|label|heading|detail|help|tooltip|caption)$/iu.test(name)) {
      const copy = normalize(child);
      if (/[A-Za-z]{2,}/u.test(copy) && !knownEnglish.has(copy)) errors.push(`Untranslated component documentation ${pointer}/${name}: ${copy}`);
    } else auditManifest(child, `${pointer}/${name}`);
  }
}

auditManifest(JSON.parse(readFileSync(resolve(root, "custom-elements.json"), "utf8")));

for (const family of ["missing-direction", "missing-audience", "missing-deliverable", "missing-boundary", "missing-evidence", "source-rights", "source-expired", "source-excerpt", "contradiction"]) {
  for (const part of ["label", "detail"]) {
    const id = `context.health.issue.${family}.${part}`;
    if (!defaults.has(id)) errors.push(`Missing authoritative context-health message ${id}`);
    for (const [locale, messages] of catalogs) if (!messages[id]) errors.push(`${locale} is missing ${id}`);
  }
}

if (errors.length) {
  for (const error of [...new Set(errors)].slice(0, 100)) console.error(error);
  console.error(`Localization audit failed with ${new Set(errors).size} uncovered system messages.`);
  process.exitCode = 1;
} else {
  console.log(`Localization audit passed: ${Object.keys(englishMessages).length} system phrases, ${defaults.size} English messages, ${referencedIds.size} referenced message IDs, ${BLOCK_TYPES.length} block types, ${catalogs.size} translated locales, and ${Object.keys(marketingProfiles).length} fully localized marketing audiences.`);
}
