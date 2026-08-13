import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { APPLICATIONS, CREATE_ROUTE_PREFIX, SITE_ROUTE_ENTRIES, applicationEntryPath, applicationIdFromRoute, resolveServerRoute } from "../src/platform/applications.ts";

const sourceFiles=async(directory)=>{
  const entries=await readdir(directory,{withFileTypes:true});
  const nested=await Promise.all(entries.map((entry)=>entry.isDirectory()?sourceFiles(new URL(`${entry.name}/`,directory)):entry.name.endsWith(".ts")?[new URL(entry.name,directory)]:[]));
  return nested.flat();
};

test("declares three route-owning applications over one shared platform",()=>{
  assert.deepEqual(APPLICATIONS.map(({id})=>id),["creative","operations","laboratory"]);
  assert.equal(new Set(APPLICATIONS.map(({entry})=>entry)).size,3);
  assert.equal(new Set(SITE_ROUTE_ENTRIES.map(({path})=>path)).size,SITE_ROUTE_ENTRIES.length);
  for(const entry of SITE_ROUTE_ENTRIES){
    assert.equal(entry.application,applicationIdFromRoute(entry.path),`route owner for ${entry.path}`);
    assert.equal(entry.module,APPLICATIONS.find(({id})=>id===entry.application)?.entry);
  }
  assert.equal(CREATE_ROUTE_PREFIX,"/creative/create");
  assert.equal(applicationIdFromRoute("/creative/create/conversational"),"creative");
  assert.equal(applicationEntryPath("/operations/events"),"/operations/");
  assert.equal(applicationEntryPath("/laboratory/replay"),"/laboratory/");
});

test("the server resolves every shareable deep-link family before SPA hydration",()=>{
  const cases=[
    ["/projects","/projects/","creative"],
    ["/projects/project-42","/projects/","creative"],
    ["/document/doc-42/study","/","creative"],
    ["/document/doc-42/study/focus","/","creative"],
    ["/document/doc-42/study/view/chat/focus","/studio/chat/","creative"],
    ["/document/doc-42/view/board","/studio/board/","creative"],
    ["/studio/editor/focus","/studio/editor/","creative"],
    ["/library/output/object-1/final","/library/","creative"],
    ["/library/blocks/editor/block-1","/library/","creative"],
    ["/share/private-token","/share/","creative"],
    ["/operations/events/permissions","/operations/events/permissions/","operations"],
    ["/laboratory/replay","/laboratory/replay/","laboratory"],
    ["/creative/create/conversational","/creative/create/","creative"],
  ];
  for(const [path,entryPath,application] of cases){
    assert.deepEqual(resolveServerRoute(path),{application,entryPath,canonicalFamily:resolveServerRoute(path)?.canonicalFamily},path);
  }
  assert.equal(resolveServerRoute("/not-a-real-surface"),null);
});

test("application entries do not import sibling applications",async()=>{
  for(const application of APPLICATIONS){
    const source=await readFile(new URL(`../${application.entry}`,import.meta.url),"utf8");
    for(const sibling of APPLICATIONS.filter(({id})=>id!==application.id)){
      assert.doesNotMatch(source,new RegExp(`apps/${sibling.id}|\\.\\./${sibling.id}`),`${application.id} imports ${sibling.id}`);
    }
  }
});

test("shared domain and server layers do not depend on application implementations",async()=>{
  const roots=["../src/model/","../src/state/","../src/components/","../worker/","../db/"].map((path)=>new URL(path,import.meta.url));
  const files=(await Promise.all(roots.map(sourceFiles))).flat();
  for(const file of files){
    const source=await readFile(file,"utf8");
    assert.doesNotMatch(source,/src\/apps|\.\.\/apps\/|\/apps\/(?:creative|operations|laboratory)\//,file.pathname);
  }
});

test("production manifest contains an independently loadable entry for every application",async()=>{
  const manifest=JSON.parse(await readFile(new URL("../dist/client/.vite/manifest.json",import.meta.url),"utf8"));
  for(const application of APPLICATIONS){
    const entry=manifest[application.entry]??Object.values(manifest).find((candidate)=>candidate.src===application.entry);
    assert.ok(entry?.file,`${application.id} build entry`);
  }
});

test("architecture guide reserves future Create approaches inside Creative",async()=>{
  const guide=await readFile(new URL("../ARCHITECTURE.md",import.meta.url),"utf8");
  assert.match(guide,/three independently loaded applications/);
  assert.match(guide,/src\/apps\/creative\/create\//);
  assert.match(guide,/same document stream and projections/);
  assert.match(guide,/must not import a sibling application/);
});
