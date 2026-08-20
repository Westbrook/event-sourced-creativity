import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applicationDefinition, navigationItemActive, resolveServerRoute } from "../src/platform/applications.ts";

test("the image-adapter laboratory is a refreshable Laboratory route",()=>{
  assert.deepEqual(resolveServerRoute("/laboratory/image-adapters"),{application:"laboratory",entryPath:"/laboratory/image-adapters/",canonicalFamily:"/laboratory/image-adapters"});
  assert.equal(navigationItemActive("laboratory","image-adapters","/laboratory/image-adapters"),true);
  assert.ok(applicationDefinition("laboratory").navigation.some((item)=>item.id==="image-adapters"));
});

test("the image-adapter laboratory previews routing without initiating paid generation",async()=>{
  const [component,api,entry,index]=await Promise.all([
    readFile(new URL("../src/components/forma-image-adapter-lab.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/image-adapters-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/apps/laboratory/entry.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/index.ts",import.meta.url),"utf8"),
  ]);
  assert.match(entry,/forma-image-adapter-lab/);
  assert.match(index,/\/api\/image-adapters/);
  assert.match(component,/No provider call, image generation, or billable operation occurred/);
  assert.match(component,/Known capability edges/);
  assert.match(component,/Review qualification/);
  assert.match(api,/selectImageAdapter/);
  assert.match(api,/Multi-reference edit/);
  assert.match(api,/published output-pixel rate/);
  assert.doesNotMatch(api,/generateCreativeImage\(/);
});
