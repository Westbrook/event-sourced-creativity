import assert from "node:assert/strict";
import test from "node:test";
import { nothing } from "lit";
import { renderNativeRetainedStory } from "../src/components/native-retained-story.ts";

test("shared prose leaf retains literal title, complete body and accessible label as text bindings", () => {
  const title = '  A <script>alert("title")</script> title  ';
  const contentMarkdown = '\r\n# Not a heading\n<img src=x onerror=alert(1)>\n\nWords & entities stay literal.\r\n';
  const content = Object.freeze({ title, contentMarkdown });
  const result = renderNativeRetainedStory(content, 'Story "><button>not a control</button>');
  assert.equal(result.values[0], 'Story "><button>not a control</button>');
  assert.equal(result.values[1].values[0], title);
  assert.equal(result.values[2], contentMarkdown);
  assert.match(result.strings.join(""), /<article class="retained-story-reader" aria-label=/u);
  assert.match(result.strings.join(""), /<pre class="retained-story-content" dir="auto" translate="no">/u);
  assert.match(result.values[1].strings.join(""), /<h2 class="retained-story-title" dir="auto" translate="no">/u);
  assert.equal(result.strings.join("").includes("<script>"), false);
  assert.equal(content.contentMarkdown, contentMarkdown);
});

test("blank title omits only the heading and never changes prose", () => {
  for (const title of ["", "  ", "\n\t"]) {
    const contentMarkdown = "  paragraph one\n\nparagraph two  ";
    const result = renderNativeRetainedStory({ title, contentMarkdown }, "Scene");
    assert.equal(result.values[1], nothing);
    assert.equal(result.values[2], contentMarkdown);
  }
});

test("long, multilingual and screenplay content shares the same literal leaf", () => {
  for (const contentMarkdown of [
    "word ".repeat(800),
    "مرحبا بالعالم\n\n東京の物語。\nZoë’s café — a new day.",
    "INT. HARBOR OFFICE — DUSK\n\nADA\n    The light is gone.\n\nBEA\n    Not yet.",
  ]) {
    const result = renderNativeRetainedStory({ title: "Story", contentMarkdown }, "Read output");
    assert.equal(result.values[2], contentMarkdown);
    assert.equal(result.values.length, 3);
    assert.doesNotMatch(result.strings.join(""), /<(?:button|a|iframe|img|video|audio)\b|tabindex|contenteditable/iu);
  }
});
