import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import {
  fitPresentationPdfVisualContent,
  presentationPdfVisualContentFits,
  renderPresentationPdf,
} from "../src/components/presentation-pdf-export.ts";
import { createPresentationPdfFromRenderedSlides } from "../src/model/presentation-pdf.ts";

const compressedPixel = deflateSync(Uint8Array.from([24, 36, 48]));
const utf16 = (value) => `FEFF${Buffer.from(value, "utf16le").swap16().toString("hex").toUpperCase()}`;

class FixtureStyle {
  #values = new Map();

  setProperty(name, value) {
    this.#values.set(name, String(value));
  }

  getPropertyValue(name) {
    return this.#values.get(name) ?? "";
  }

  removeProperty(name) {
    const previous = this.getPropertyValue(name);
    this.#values.delete(name);
    return previous;
  }
}

class FixtureNode {
  constructor(name = "div") {
    this.localName = name;
    this.tagName = name.toUpperCase();
    this.nodeType = 1;
    this.style = new FixtureStyle();
    this.attributes = new Map();
    this.childNodes = [];
    this.children = [];
    this.className = "";
    this.classList = {
      add: (...tokens) => {
        const classes = new Set(this.className.split(/\s+/u).filter(Boolean));
        for (const token of tokens) classes.add(token);
        this.className = Array.from(classes).join(" ");
      },
      remove: (...tokens) => {
        const classes = new Set(this.className.split(/\s+/u).filter(Boolean));
        for (const token of tokens) classes.delete(token);
        this.className = Array.from(classes).join(" ");
      },
      contains: (token) => this.className.split(/\s+/u).includes(token),
    };
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.childNodes.push(child);
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.childNodes = [];
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  remove() {
    this.removed = true;
  }

  matches(selectors) {
    return selectors.split(",").some((entry) => {
      const selector = entry.trim();
      if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
      if (selector.startsWith("[")) return false;
      return selector === this.localName;
    });
  }

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }

  closest(selector) {
    let current = this.parentElement;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  cloneNode() {
    return new FixtureNode(this.localName);
  }
}

class FixtureSlide extends FixtureNode {
  constructor(surfaces) {
    super("forma-presentation-slide");
    this.artboard = new FixtureNode("article");
    this.artboard.classList.add("presentation-slide");
    Object.assign(this.artboard, {
      clientWidth: 960,
      clientHeight: 540,
      scrollWidth: 960,
      scrollHeight: 540,
    });
    this.surfaces = surfaces ?? [this.artboard];
    this.updateComplete = Promise.resolve();
  }

  get innerText() {
    return this.item?.title ?? "";
  }

  querySelectorAll(selector) {
    if (selector.includes(".presentation-slide-body")) return this.surfaces;
    return [];
  }

  querySelector(selector) {
    return selector === ".presentation-slide" ? this.artboard : null;
  }

  cloneNode() {
    return new FixtureSlide();
  }
}

const installBrowserFixture = () => {
  const keys = ["document", "getComputedStyle", "requestAnimationFrame", "XMLSerializer", "Image"];
  const previous = new Map(keys.map((key) => [key, {
    exists: Object.hasOwn(globalThis, key),
    value: globalThis[key],
  }]));
  const stages = [];
  const fonts = Object.assign([], { ready: Promise.resolve() });
  const documentElement = new FixtureNode("html");
  documentElement.lang = "en";
  documentElement.dir = "ltr";

  globalThis.document = {
    documentElement,
    fonts,
    styleSheets: [],
    body: {
      append(node) {
        stages.push(node);
      },
    },
    createElement(name) {
      if (name === "forma-presentation-slide") return new FixtureSlide();
      if (name === "canvas") {
        const canvas = new FixtureNode("canvas");
        const context = {
          drawImage() {},
          clearRect() {},
          getImageData: () => ({ data: Uint8ClampedArray.from([24, 36, 48, 255]) }),
        };
        canvas.getContext = () => context;
        return canvas;
      }
      return new FixtureNode(name);
    },
    createElementNS(_namespace, name) {
      return new FixtureNode(name);
    },
  };

  globalThis.getComputedStyle = (element) => ({
    display: "block",
    visibility: "visible",
    contentVisibility: "visible",
    direction: "ltr",
    font: "16px sans-serif",
    fontFamily: "sans-serif",
    fontSize: "16px",
    lineHeight: "20px",
    overflow: "hidden",
    length: 0,
    item: () => "",
    getPropertyValue: (name) => element.style?.getPropertyValue(name) ?? "",
  });
  globalThis.requestAnimationFrame = (callback) => {
    queueMicrotask(() => callback(performance.now()));
    return 1;
  };
  globalThis.XMLSerializer = class {
    serializeToString() {
      return "<svg xmlns=\"http://www.w3.org/2000/svg\" />";
    }
  };
  globalThis.Image = class {
    async decode() {}
  };

  return {
    stages,
    restore() {
      for (const [key, entry] of previous) {
        if (entry.exists) globalThis[key] = entry.value;
        else delete globalThis[key];
      }
    },
  };
};

const item = (index) => ({
  title: `Protected slide ${index}`,
  body: "",
  notes: "Private presenter notes must never be exported.",
  image_prompt: "",
  slide: null,
});

test("assembles 1,000 complete tagged PDF pages across segmented cross-reference boundaries", () => {
  const pages = Array.from({ length: 1_000 }, (_, index) => {
    const heading = `Protected slide ${index + 1} — 東京`;
    return {
      width: 1,
      height: 1,
      bytes: compressedPixel,
      heading,
      text: `${heading}\nComplete evidence ${index + 1}`,
      structure: [
        { role: "H1", text: heading },
        { role: "P", text: `Complete evidence ${index + 1}` },
      ],
    };
  });

  const result = createPresentationPdfFromRenderedSlides(pages, {
    title: "Complete enterprise presentation",
    language: "en",
  });
  const source = Buffer.from(result.bytes).toString("latin1");
  const marker = source.lastIndexOf("\nstartxref\n");
  const xrefOffset = Number(source.slice(marker).match(/\nstartxref\n(\d+)\n/u)?.[1]);
  const trailerOffset = source.indexOf("\ntrailer\n", xrefOffset);
  const xrefLines = source.slice(xrefOffset, trailerOffset).split("\n");
  const xrefSize = Number(xrefLines[1]?.match(/^0 (\d+)$/u)?.[1]);

  assert.equal(result.pageCount, 1_000);
  assert.equal(result.filename, "complete-enterprise-presentation.pdf");
  assert.match(source, /\/Count 1000\b/u);
  assert.match(source, /\/ParentTreeNextKey 1000\b/u);
  assert.equal((source.match(/\/Type \/Page \/Parent /gu) ?? []).length, 1_000);
  assert.equal((source.match(/\/S \/Sect /gu) ?? []).length, 1_000);
  assert.equal((source.match(/\/S \/H1 /gu) ?? []).length, 1_000);
  assert.ok(source.includes(utf16("Protected slide 1 — 東京\n")));
  assert.ok(source.includes(utf16("Protected slide 512 — 東京\n")));
  assert.ok(source.includes(utf16("Protected slide 1000 — 東京\n")));
  assert.ok(xrefSize > 512, "the document must cross multiple xref assembly chunks");
  assert.equal(xrefLines[0], "xref");
  assert.equal(xrefLines.length, xrefSize + 2, "every PDF object has an xref entry");
  assert.equal(xrefLines[2], "0000000000 65535 f ");
  assert.match(source.slice(trailerOffset), /\n%%EOF\n$/u);

  const inspection = spawnSync("pdfinfo", ["-"], {
    input: Buffer.from(result.bytes),
    encoding: "utf8",
  });
  if (inspection.error?.code === "ENOENT") return;
  assert.equal(inspection.status, 0, inspection.stderr);
  assert.match(inspection.stdout, /^Pages:\s+1000$/mu);
  assert.match(inspection.stdout, /^Tagged:\s+yes$/mu);
});

test("retains all 320 compressed image pages when a presentation exceeds five megabytes", () => {
  const pixels = new Uint8Array(96 * 80 * 3);
  let state = 0x12345678;
  for (let index = 0; index < pixels.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels[index] = state & 255;
  }
  const compressed = deflateSync(pixels);
  const pages = Array.from({ length: 320 }, (_, index) => ({
    width: 96,
    height: 80,
    bytes: compressed,
    heading: `Image ${index + 1}`,
  }));

  const result = createPresentationPdfFromRenderedSlides(pages, {
    title: "Large protected presentation",
  });
  const source = Buffer.from(result.bytes).toString("latin1");

  assert.equal(result.pageCount, 320);
  assert.ok(result.bytes.byteLength > 5 * 1024 * 1024);
  assert.equal((source.match(/\/Subtype \/Image /gu) ?? []).length, 320);
  assert.match(source, /\/Count 320\b/u);
  assert.match(source, /\/ParentTreeNextKey 320\b/u);
  assert.ok(source.includes(utf16("Image 320\n")));

  const inspection = spawnSync("pdfinfo", ["-"], {
    input: Buffer.from(result.bytes),
    encoding: "utf8",
  });
  if (inspection.error?.code === "ENOENT") return;
  assert.equal(inspection.status, 0, inspection.stderr);
  assert.match(inspection.stdout, /^Pages:\s+320$/mu);
});

test("reports truthful preparation, monotonically increasing slide progress, and finalization", async () => {
  const fixture = installBrowserFixture();
  const progress = [];
  try {
    const result = await renderPresentationPdf(
      [item(1), item(2), item(3)],
      {},
      { title: "Progress fixture", onProgress: (entry) => progress.push(entry) },
    );

    assert.equal(result.pageCount, 3);
    assert.deepEqual(progress, [
      { stage: "preparing", completed: 0, total: 3 },
      { stage: "rendering", completed: 1, total: 3 },
      { stage: "rendering", completed: 2, total: 3 },
      { stage: "rendering", completed: 3, total: 3 },
      { stage: "finalizing", completed: 3, total: 3 },
    ]);
    assert.equal(fixture.stages.length, 1);
    assert.equal(fixture.stages[0].removed, true);
  } finally {
    fixture.restore();
  }
});

test("honors AbortSignal between slides and removes the hidden capture stage", async () => {
  const fixture = installBrowserFixture();
  const controller = new AbortController();
  const progress = [];
  try {
    await assert.rejects(
      renderPresentationPdf([item(1), item(2), item(3)], {}, {
        signal: controller.signal,
        onProgress(entry) {
          progress.push(entry);
          if (entry.stage === "rendering" && entry.completed === 1) controller.abort();
        },
      }),
      (error) => error instanceof DOMException && error.name === "AbortError",
    );

    assert.deepEqual(progress, [
      { stage: "preparing", completed: 0, total: 3 },
      { stage: "rendering", completed: 1, total: 3 },
    ]);
    assert.equal(fixture.stages.length, 1);
    assert.equal(fixture.stages[0].removed, true);
  } finally {
    fixture.restore();
  }
});

test("adaptive recovery rejects protected evidence that remains clipped", async () => {
  const fixture = installBrowserFixture();
  const clipped = new FixtureNode("aside");
  clipped.classList.add("presentation-slide__data-list");
  Object.assign(clipped, {
    clientWidth: 240,
    clientHeight: 80,
    scrollWidth: 240,
    scrollHeight: 240,
  });
  const host = new FixtureSlide();
  host.surfaces.push(clipped);

  try {
    assert.equal(presentationPdfVisualContentFits(host), false);
    await assert.rejects(
      fitPresentationPdfVisualContent(host),
      /visible clipping/u,
    );
    assert.equal(presentationPdfVisualContentFits(host), false);
    assert.equal(host.artboard.clientWidth, 960);
    assert.equal(host.artboard.clientHeight, 540);
  } finally {
    fixture.restore();
  }
});

test("adaptive fitting preserves complete protected evidence while reflowing an overflowing surface", async () => {
  const fixture = installBrowserFixture();
  const evidence = new FixtureNode("aside");
  evidence.classList.add("presentation-slide__data-list");
  evidence.textContent = "Founder: investor deck; thoughtful follow-up; product teaser";
  evidence.clientWidth = 240;
  evidence.clientHeight = 80;
  evidence.scrollWidth = 240;
  Object.defineProperty(evidence, "scrollHeight", {
    configurable: true,
    get() {
      const zoom = Number.parseFloat(this.style.getPropertyValue("zoom")) || 1;
      return Math.ceil(100 * zoom);
    },
  });
  const host = new FixtureSlide();
  host.surfaces.push(evidence);

  try {
    assert.equal(presentationPdfVisualContentFits(host), false);
    await fitPresentationPdfVisualContent(host);
    assert.equal(presentationPdfVisualContentFits(host), true);
    assert.ok(host.artboard.classList.contains("presentation-slide--density-dense"));
    assert.ok(Number.parseFloat(evidence.style.getPropertyValue("zoom")) < 1);
    assert.equal(evidence.textContent, "Founder: investor deck; thoughtful follow-up; product teaser");
    assert.equal(host.artboard.clientWidth, 960);
    assert.equal(host.artboard.clientHeight, 540);
  } finally {
    fixture.restore();
  }
});

test("adaptive fitting honors cancellation before protected content can be released", async () => {
  const fixture = installBrowserFixture();
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      fitPresentationPdfVisualContent(new FixtureSlide(), controller.signal),
      (error) => error instanceof DOMException && error.name === "AbortError",
    );
  } finally {
    fixture.restore();
  }
});
