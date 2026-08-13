import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { diverseFocalPointCandidates } from "../src/model/focal-point-lab.ts";

const point = (x, y) => ({ x, y, confidence: .8, method: "saliency-grid-v1", sampleWidth: 12, sampleHeight: 12 });

test("selects a focal-point review set with spatial diversity", () => {
  const candidates = [
    ["center-a", .5, .5], ["center-b", .51, .49], ["north-west", .1, .1],
    ["north-east", .9, .1], ["south-west", .1, .9], ["south-east", .9, .9],
  ].map(([item, x, y]) => ({ item, focalPoint: point(x, y) }));
  const selected = diverseFocalPointCandidates(candidates, 4).map(({ item }) => item);
  assert.equal(selected.length, 4);
  assert.equal(selected.filter((item) => String(item).includes("center")).length, 0);
  assert.equal(new Set(selected).size, 4);
  assert.equal(diverseFocalPointCandidates(candidates, candidates.length).length, candidates.length);
});

test("focal-point lab compares calculation output, runtime, and provider cost", async () => {
  const [component, css, loader, shell, entries, imageFocus, laboratoryEntry, applications] = await Promise.all([
    readFile(new URL("../src/components/forma-focal-point-lab.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/focal-point-lab.css", import.meta.url), "utf8"),
    readFile(new URL("../src/route-loader.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8"),
    readFile(new URL("../build/sites-vite-plugin.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/image-focus.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/apps/laboratory/entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/platform/applications.ts", import.meta.url), "utf8"),
  ]);
  assert.match(component, /Attention regions/);
  assert.match(component, /Saliency centroid/);
  assert.match(component, /attention-region-v2/);
  assert.match(component, /This browser run/);
  assert.match(component, /Provider cost/);
  assert.match(component, /Two calculations, one crop contract/);
  assert.match(component, /aria-label="Image set"/);
  assert.match(component, /this\.#density === "expanded" \? 16/);
  assert.match(component, /complete available corpus/);
  assert.doesNotMatch(component, /Inverted coordinates/);
  assert.match(component, /children-in-park-01\.png/);
  assert.match(component, /children-in-park-02\.png/);
  assert.match(component, /children-in-park-03\.png/);
  assert.match(css, /object-position:\s*var\(--focal-x, 50%\) var\(--focal-y, 50%\)/);
  assert.doesNotMatch(css, /calc\(100% - var\(--focal-x/);
  assert.match(loader, /apps\/laboratory\/entry/);
  assert.match(shell, /forma-laboratory-application/);
  assert.match(laboratoryEntry, /forma-focal-point-lab/);
  assert.match(applications, /\/laboratory\/focal-points/);
  assert.match(entries, /SITE_ROUTE_ENTRIES/);
  assert.match(imageFocus, /sampleImageUrlLegacySquare/);
  assert.match(imageFocus, /totalDurationMs/);
  assert.match(imageFocus, /providerCostUsd/);
});

test("ships every provided focal-point diagnostic image", async () => {
  const files = await Promise.all([1, 2, 3].map((index) => stat(new URL(`../public/focal-point-lab/children-in-park-0${index}.png`, import.meta.url))));
  assert.ok(files.every((file) => file.isFile() && file.size > 100_000));
});
