import assert from "node:assert/strict";
import test from "node:test";
import { storyboardAudienceHtml } from "../src/model/storyboard-audience.ts";

const draft = () => ({
  title: "Harbor storyboard — café 雨 🌱",
  markdown: "# Harbor decisions — revised\n\nKeep the full source, including **authored Markdown**.\n",
  frames: [
    { position: 1, title: "Harbor approval — café", description: "Mara records the safe channel.\nKeep the gate open for the 雨 inspection.", notes: "Ask about the green 🌱 marker.\nPreserve the full continuity instruction.", file: "frames/frame-001.png", mimeType: "image/png" },
    { position: 2, title: "قرار المساء", description: "فحص الضوء عند الغروب.\nThe harbor light remains visible.", notes: "Pause for the crew’s questions.\nKeep the exact café spelling.", file: "frames/frame-002.png", mimeType: "image/png" },
  ],
});

test("standalone audience retains complete ordered Unicode frame content and original text", () => {
  const input = draft(), before = structuredClone(input), html = storyboardAudienceHtml(input);
  assert.ok(html.startsWith("<!doctype html>"));
  for (const value of [input.title, input.markdown, ...input.frames.flatMap(frame => [frame.title, frame.description, frame.notes])]) assert.ok(html.includes(value), value);
  assert.ok(html.indexOf('id="frame-1"') < html.indexOf('id="frame-2"'));
  assert.match(html, /<img src="frames\/frame-001\.png" alt="Frame 1: Harbor approval — café">/u);
  assert.match(html, /<img src="frames\/frame-002\.png" alt="Frame 2: قرار المساء">/u);
  assert.match(html, /No soundtrack is included\./u);
  assert.deepEqual(input, before, "audience rendering cannot mutate original manifest/source data");
  assert.equal(storyboardAudienceHtml(input), html, "same saved inputs produce identical audience bytes");
});

test("authored HTML, attributes, entities and remote Markdown remain inert visible text", () => {
  const input = draft();
  const hostile = '</title></style><script src="https://invalid.example/a.js">alert(1)</script><img src=x onerror="alert(2)"> & &#60; \' "';
  input.title = hostile; input.markdown = "![remote](https://invalid.example/image.png)\n" + hostile;
  for (const frame of input.frames) frame.title = frame.description = frame.notes = hostile;
  const html = storyboardAudienceHtml(input);
  assert.doesNotMatch(html, /<script\b|<iframe\b|<object\b|<embed\b|<base\b/iu);
  const attributes = [...html.matchAll(/<[a-z][^>]*>/giu)].flatMap(([tag]) =>
    [...tag.matchAll(/\s+([\w:-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gu)].map(match => match[1]));
  assert.ok(attributes.every(name => !/^on/iu.test(name)), "no actual event-handler attribute; escaped text inside a quoted alt remains text");
  assert.doesNotMatch(html, /(?:src|href)="(?:https?:|javascript:|data:|\/\/)/iu);
  assert.ok(html.includes('&lt;script src=&quot;https://invalid.example/a.js&quot;&gt;'));
  assert.ok(html.includes('&amp; &amp;#60; &#39; &quot;'));
  assert.ok(html.includes("![remote](https://invalid.example/image.png)"), "source Markdown is preserved as text, not fetched");
  assert.equal((html.match(/<img\b/gu) ?? []).length, 2, "only the two original local images are emitted");
  assert.equal((html.match(/<\/style>/gu) ?? []).length, 1, "authored content cannot close the fixed stylesheet");
});

test("frame paths reject traversal, remote URLs, encoded separators and attribute injection", () => {
  for (const file of ["../frame.png", "frames/../frame-001.png", "/frames/frame-001.png", "https://invalid.example/frame.png", "//invalid.example/frame.png", "file:///tmp/frame.png", "data:image/png;base64,AA", "frames%2fframe-001.png", "frames/frame-001.png?x=1", "frames/frame-001.png#x", "frames\\frame-001.png", 'frames/frame-001.png" onerror="alert(1)', "frames/frame-002.png", "frames/frame-001.svg", "frames/frame-001.png\n"]) {
    const input = draft(); input.frames[0].file = file;
    assert.throws(() => storyboardAudienceHtml(input), /invalid_storyboard_audience_file/u, file);
  }
});

test("empty, reordered or incomplete manifest input cannot become an apparently complete audience document", () => {
  assert.throws(() => storyboardAudienceHtml({ ...draft(), frames: [] }), /incomplete_storyboard_audience/u);
  const reordered = draft(); reordered.frames.reverse();
  assert.throws(() => storyboardAudienceHtml(reordered), /invalid_storyboard_audience_order/u);
  for (const key of ["title", "description", "notes"]) {
    const input = draft(); delete input.frames[0][key];
    assert.throws(() => storyboardAudienceHtml(input), /invalid_storyboard_audience/u, key);
  }
});

test("saved soundtrack companions use only their exact local filenames and escaped labels", () => {
  const input = draft();
  input.soundtracks = [{ position: 1, label: 'Harbor "café" & 雨', file: "soundtracks/soundtrack-001.wav", mimeType: "audio/wav" }];
  const html = storyboardAudienceHtml(input);
  assert.ok(html.includes('href="soundtracks/soundtrack-001.wav"'));
  assert.ok(html.includes("Harbor &quot;café&quot; &amp; 雨"));
  assert.doesNotMatch(html, /No soundtrack is included|<audio\b|autoplay/iu);
  input.soundtracks[0].file = "../private.wav";
  assert.throws(() => storyboardAudienceHtml(input), /invalid_storyboard_audience_file/u);
});

test("audience resources are passive local files without scripts, remote fonts or dependencies", () => {
  const html = storyboardAudienceHtml(draft());
  const sources = [...html.matchAll(/\bsrc="([^"]+)"/gu)].map(match => match[1]);
  assert.deepEqual(sources, ["frames/frame-001.png", "frames/frame-002.png"]);
  const links = [...html.matchAll(/\bhref="([^"]+)"/gu)].map(match => match[1]);
  assert.deepEqual(links, ["README.md", "frames/frame-001.png", "frames/frame-002.png"]);
  assert.doesNotMatch(html, /<script\b|<link\b|@import|url\s*\(/iu);
  assert.match(html, /default-src 'none'/u);
});
