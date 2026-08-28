import assert from "node:assert/strict";
import test from "node:test";
import { describeOutputs } from "../src/model/output-naming.ts";
import { ARTIFACT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/artifact-delivery-messages.ts";

const normalize = value => String(value).replace(/[\u2066-\u2069]/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();
const copies = { en: ["Document ", "Result "], fr: ["Document ", "Résultat "], ar: ["المستند ", "النتيجة "], ja: ["文書 ", "結果 "] };
const number = (locale, value) => new Intl.NumberFormat(locale).format(value);
function options(locale, documents, peers) {
  const messages = ARTIFACT_DELIVERY_MESSAGES[locale];
  return { locale, peers, scopedLabels: { documents,
    formatDocument: value => messages["artifact.delivery.documentQualifier"].replace("{number}", number(locale, value)),
    formatResult: value => messages["artifact.delivery.resultQualifier"].replace("{number}", number(locale, value)) } };
}
function scopes(values) {
  for (const value of values) assert.ok(value.displayScope);
  return new Map(values.map(value => [value.displayScope.key, value.displayScope]));
}
function assertUnique(values) {
  const names = values.map(value => { assert.ok(value.displayScope); return normalize(value.displayScope.context); });
  assert.equal(new Set(names).size, names.length);
}
const sample = [
  {
    "id": "newer",
    "documentId": "A",
    "sequence": 20,
    "kind": "short_story",
    "title": "Authored name",
    "summary": "Exact authored summary."
  },
  {
    "id": "older",
    "documentId": "A",
    "sequence": 10,
    "kind": "short_story",
    "title": "Authored name",
    "customTitle": "Exact owner title",
    "summary": "Keep this summary."
  },
  {
    "id": "slides",
    "documentId": "B",
    "sequence": 30,
    "kind": "slides",
    "title": "Other document",
    "summary": "Two key findings.",
    "itemCount": 2
  }
];
const expectedDefault = [
  {
    "id": "newer",
    "title": "Authored name",
    "label": "Take 2 — Authored name · Exact authored summary.",
    "secondaryLabel": "Exact authored summary.",
    "kindLabel": "Short story",
    "description": "Short story · Exact authored summary.",
    "intent": "Exact authored summary.",
    "version": 2,
    "variantCount": 1,
    "ordinal": 2,
    "total": 2,
    "createdAt": null,
    "sourceLabel": "",
    "isCustomTitle": false,
    "disambiguator": "Take 2"
  },
  {
    "id": "older",
    "title": "Exact owner title",
    "label": "Take 1 — Exact owner title · Keep this summary.",
    "secondaryLabel": "Keep this summary.",
    "kindLabel": "Short story",
    "description": "Short story · Keep this summary.",
    "intent": "Keep this summary.",
    "version": 1,
    "variantCount": 1,
    "ordinal": 1,
    "total": 2,
    "createdAt": null,
    "sourceLabel": "",
    "isCustomTitle": true,
    "disambiguator": "Take 1"
  },
  {
    "id": "slides",
    "title": "Other document",
    "label": "Other document · 2 slides · Two key findings.",
    "secondaryLabel": "2 slides · Two key findings.",
    "kindLabel": "Slides",
    "description": "Slides · Two key findings.",
    "intent": "Two key findings.",
    "version": 1,
    "variantCount": 1,
    "ordinal": 1,
    "total": 1,
    "createdAt": null,
    "sourceLabel": "",
    "isCustomTitle": false,
    "disambiguator": ""
  }
];

test("default output descriptions preserve every existing field and input order without scoped formatting", () => {
  const original = structuredClone(sample);
  assert.deepEqual(describeOutputs(sample, { locale: "en" }), expectedDefault);
  assert.deepEqual(describeOutputs(sample, { locale: "en", scopedLabels: undefined }), expectedDefault);
  assert.ok(describeOutputs(sample).every(value => !Object.hasOwn(value, "displayScope")));
  assert.deepEqual(sample, original);
});

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("scoped output descriptions add presentation only and keep authored data exact in " + locale, () => {
    const documents = [{ id: "A", title: "Same authored Document مستند" }, { id: "B", title: "Same authored Document مستند" }];
    const input = structuredClone(sample), before = structuredClone({ input, documents });
    const base = describeOutputs(input, { locale });
    const described = describeOutputs(input, options(locale, documents));
    assert.deepEqual(described.map(({ displayScope: _display, ...rest }) => rest), base);
    assert.deepEqual({ input, documents }, before);
    assertUnique(described);
    assert.ok(described.every(value => value.displayScope.context.includes("\u2068") && value.displayScope.context.includes("\u2069")));
    for (const value of described) {
      assert.ok(value.displayScope.documentTitle.startsWith("Same authored Document مستند"));
      assert.ok(value.displayScope.documentTitle.includes(copies[locale][0]));
    }
  });

  test("Document qualifier aliases reach a unique finite fixed point in " + locale, () => {
    const qualifier = copies[locale][0] + number(locale, 1), authored = "Exact e\u0301 title {customer}";
    const documents = [{ id: "A", title: authored }, { id: "B", title: authored },
      { id: "C", title: authored + " · " + qualifier },
      { id: "D", title: authored + " · " + qualifier + " · " + qualifier }];
    const input = documents.map((doc, index) => ({ id: "output-" + doc.id, documentId: doc.id, sequence: index + 1, kind: "short_story", title: "Same result" }));
    const before = structuredClone({ input, documents });
    const described = describeOutputs(input, options(locale, documents));
    assertUnique(described);
    assert.equal(new Set(described.map(value => normalize(value.displayScope.documentTitle))).size, 4);
    for (let index = 0; index < described.length; index++)
      assert.ok(described[index].displayScope.documentTitle.startsWith(documents[index].title), "authored Document code points remain unchanged before the qualifier");
    assert.deepEqual({ input, documents }, before);
  });

  test("final composed result aliases cannot reuse another exact object's label in " + locale, () => {
    const qualifier = copies[locale][1] + number(locale, 1);
    const documents = [{ id: "A", title: "End" }, { id: "B", title: "Mid · End" },
      { id: "C", title: "Mid · End · " + qualifier },
      { id: "D", title: "Mid · End · " + qualifier + " · " + qualifier }];
    const input = documents.map((doc, index) => ({ id: "result-" + doc.id, documentId: doc.id, sequence: index + 1,
      kind: "short_story", title: index === 0 ? "Start · Mid" : "Start" }));
    const described = describeOutputs(input, options(locale, documents));
    assertUnique(described);
    assert.ok(described.every(value => value.displayScope.qualifier.startsWith(copies[locale][1])));
    const reordered = describeOutputs([...input].reverse(), options(locale, [...documents].reverse(), input));
    assert.deepEqual(scopes(reordered), scopes(described));
  });

  test("unrelated Documents and peer filtering cannot renumber existing collision labels in " + locale, () => {
    const documents = [{ id: "B", title: "Repeated title" }, { id: "A", title: "Repeated title" }];
    const input = [{ id: "a", documentId: "A", sequence: 10, kind: "short_story", title: "Repeated output" },
      { id: "b", documentId: "B", sequence: 20, kind: "short_story", title: "Repeated output" }];
    const original = scopes(describeOutputs(input, options(locale, documents)));
    const addition = { id: "0-unrelated", documentId: "0-unrelated", sequence: 30, kind: "short_story", title: "A distinct output" };
    const currentDocuments = [{ id: addition.documentId, title: "A distinct Document" }, ...documents].reverse();
    const current = [...input].reverse().concat(addition);
    const all = scopes(describeOutputs(current, options(locale, currentDocuments, current)));
    for (const [key, value] of original) assert.deepEqual(all.get(key), value);
    const filtered = scopes(describeOutputs([input[0]], options(locale, currentDocuments, current)));
    assert.deepEqual([...filtered.values()][0], original.get(JSON.stringify(["A", "short_story", "a"])));
    const foreign = { id: "a", documentId: "private-foreign", sequence: 1, kind: "short_story", title: "PRIVATE FOREIGN TITLE" };
    assert.deepEqual(scopes(describeOutputs(input, options(locale, documents, [...input, foreign]))), original);
  });

  test("equal opaque IDs in different exact media retain separate scoped presentation in " + locale, () => {
    const documents = [{ id: "A", title: "Same Document" }];
    const input = [{ id: "same-id", documentId: "A", sequence: 1, kind: "short_story", title: "Same result" },
      { id: "same-id", documentId: "A", sequence: 2, kind: "image", title: "Same result" }];
    const before = structuredClone(input), described = describeOutputs(input, options(locale, documents));
    assertUnique(described); assert.equal(scopes(described).size, 2);
    assert.deepEqual(described.map(value => value.id), ["same-id", "same-id"]);
    assert.deepEqual(input, before);
    assert.deepEqual(describeOutputs(input, options(locale, documents)), described, "formatting remains deterministic without retained state");
  });
}
