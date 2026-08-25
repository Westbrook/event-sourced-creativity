import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { APPLICATIONS, CREATE_ROUTE_PREFIX, SITE_ROUTE_ENTRIES, applicationEntryPath, applicationIdFromRoute, navigationItemActive, resolveServerRoute } from "../src/platform/applications.ts";

const sourceFiles=async(directory)=>{
  const entries=await readdir(directory,{withFileTypes:true});
  const nested=await Promise.all(entries.map((entry)=>entry.isDirectory()?sourceFiles(new URL(`${entry.name}/`,directory)):entry.name.endsWith(".ts")?[new URL(entry.name,directory)]:[]));
  return nested.flat();
};

test("declares six audience-owned applications over one shared platform",()=>{
  assert.deepEqual(APPLICATIONS.map(({id})=>id),["creative","canvas","operations","product","knowledge","engineering"]);
  assert.equal(new Set(APPLICATIONS.map(({entry})=>entry)).size,6);
  assert.equal(new Set(SITE_ROUTE_ENTRIES.map(({path})=>path)).size,SITE_ROUTE_ENTRIES.length);
  for(const entry of SITE_ROUTE_ENTRIES){
    assert.equal(entry.application,applicationIdFromRoute(entry.path),`route owner for ${entry.path}`);
    assert.equal(entry.module,APPLICATIONS.find(({id})=>id===entry.application)?.entry);
  }
  assert.equal(CREATE_ROUTE_PREFIX,"/creative/create");
  assert.equal(applicationIdFromRoute("/creative/create/conversational"),"creative");
  assert.equal(applicationEntryPath("/operations/events"),"/engineering/");
  assert.equal(applicationEntryPath("/laboratory/replay"),"/product/");
  assert.equal(applicationEntryPath("/laboratory/design-system"),"/knowledge/");
  assert.equal(applicationEntryPath("/canvas/canvas-42/study"),"/canvas/");
});

test("the server resolves every shareable deep-link family before SPA hydration",()=>{
  const cases=[
    ["/projects","/projects/","creative"],
    ["/projects/project-42","/projects/","creative"],
    ["/settings","/settings/","creative"],
    ["/document/doc-42/study","/","creative"],
    ["/document/doc-42/study/focus","/","creative"],
    ["/document/doc-42/study/view/chat/focus","/studio/chat/","creative"],
    ["/document/doc-42/view/board","/studio/board/","creative"],
    ["/studio/editor/focus","/studio/editor/","creative"],
    ["/library/output/object-1/final","/library/","creative"],
    ["/library/blocks/editor/block-1","/library/","creative"],
    ["/share/private-token","/share/","creative"],
    ["/canvas/canvas-42/study","/canvas/","canvas"],
    ["/canvas/canvas-42/study/view/list","/canvas/","canvas"],
    ["/canvas/canvas-42/study/focus","/canvas/","canvas"],
    ["/canvas/canvas-42/study/view/list/focus","/canvas/","canvas"],
    ["/canvas/proposals/proposal-1","/canvas/proposals/","canvas"],
    ["/canvas/projects","/canvas/projects/","canvas"],
    ["/canvas/projects/project-42","/canvas/projects/","canvas"],
    ["/canvas/library","/canvas/library/","canvas"],
    ["/canvas/library/block/block-1/direction","/canvas/library/","canvas"],
    ["/canvas/library/output/output-1/final","/canvas/library/","canvas"],
    ["/canvas/library/artifact/artifact-1/story","/canvas/library/","canvas"],
    ["/canvas/library/family/family-1/study","/canvas/library/","canvas"],
    ["/canvas/library/blocks/editor/new","/canvas/library/","canvas"],
    ["/canvas/library/blocks/editor/block-1","/canvas/library/","canvas"],
    ["/operations/events/permissions","/operations/events/permissions/","engineering"],
    ["/operations/analytics","/operations/analytics/","product"],
    ["/admin/events/sync","/admin/events/sync/","engineering"],
    ["/laboratory/replay","/laboratory/replay/","product"],
    ["/laboratory/design-system","/laboratory/design-system/","knowledge"],
    ["/product/insights","/product/insights/","product"],
    ["/knowledge/patterns","/knowledge/patterns/","knowledge"],
    ["/knowledge/landing-pages","/knowledge/landing-pages/","knowledge"],
    ["/knowledge/landing-pages/","/knowledge/landing-pages/","knowledge"],
    ["/engineering/jobs","/engineering/jobs/","engineering"],
    ["/creative/create/conversational","/creative/create/","creative"],
  ];
  for(const [path,entryPath,application] of cases){
    assert.deepEqual(resolveServerRoute(path),{application,entryPath,canonicalFamily:resolveServerRoute(path)?.canonicalFamily},path);
  }
  assert.equal(resolveServerRoute("/not-a-real-surface"),null);
});

test("Canvas project and Library tasks keep one current destination inside Canvas",()=>{
  const canvas=APPLICATIONS.find(({id})=>id==="canvas");
  assert.equal(canvas.navigation.find(({id})=>id==="projects")?.href,"/canvas/projects");
  assert.equal(canvas.navigation.find(({id})=>id==="library")?.href,"/canvas/library");
  for(const [path,active] of [["/canvas","canvases"],["/canvas/board-1/study","canvases"],["/canvas/projects","projects"],["/canvas/projects/project-1","projects"],["/canvas/library","library"],["/canvas/library/output/output-1","library"],["/canvas/library/blocks/editor/new","library"],["/canvas/proposals","proposals"]]){
    assert.equal(applicationIdFromRoute(path),"canvas");
    assert.deepEqual(canvas.navigation.filter(({id})=>navigationItemActive("canvas",id,path)).map(({id})=>id),[active],path);
  }
});

test("server-first routing preserves the development module runtime",async()=>{
  const worker=await readFile(new URL("../worker/index.ts",import.meta.url),"utf8");
  assert.match(worker,/@vite\\\//);
  assert.match(worker,/developmentAssetRequest\|\|/);
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
  assert.match(guide,/six independently loaded,[\s\S]*?audience-authorized applications/);
  for(const audience of ["Creator Workspace","Canvas","Platform Operations","Product & Quality","Design & Knowledge","Engineering Diagnostics"])assert.match(guide,new RegExp(audience.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(guide,/src\/apps\/creative\/create\//);
  assert.match(guide,/same document stream and projections/);
  assert.match(guide,/must not import a sibling application/);
});
