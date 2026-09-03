import assert from "node:assert/strict";
import test from "node:test";
import { model3dArtifactFiles, model3dPreviewFile } from "../src/components/model3d-output.ts";

const artifact=(files=[],extra={})=>({kind:"model3d",title:"Teapot",mediaUrl:"/api/media/teapot",mediaType:"model/obj",settings:{model3d_files:files},...extra});
const file=(url,format,mimeType,extra={})=>({url,format,mimeType,role:"mesh",fileName:`teapot.${format}`,fileSize:2048,sha256:"a".repeat(64),...extra});

test("3D output keeps every returned mesh, texture, preview and sidecar in provider order",()=>{
  const result=model3dArtifactFiles(artifact([
    file("/api/media/model-obj","obj","model/obj"),
    file("/api/media/model-glb","glb","model/gltf-binary"),
    file("/api/media/texture",null,"image/png",{role:"texture",fileName:"color.png"}),
    file("/api/media/material",null,"text/plain",{role:"texture",fileName:"material.mtl"}),
    file("/api/media/highpack",null,"application/zip",{role:"texture",fileName:"textures.zip"}),
    file("/api/media/preview",null,"image/webp",{role:"preview",fileName:"preview.webp"}),
  ]));
  assert.deepEqual(result.map(item=>item.fileName),["teapot.obj","teapot.glb","color.png","material.mtl","textures.zip","preview.webp"]);
  assert.deepEqual(result.map(item=>item.mimeType),["model/obj","model/gltf-binary","image/png","text/plain","application/zip","image/webp"]);
  assert.equal(result[0].fileSize,2048);
});

test("3D preview selects a genuine GLB while preserving the chosen export format",()=>{
  const value=artifact([file("/api/media/obj","obj","model/obj"),file("/api/media/glb","glb","model/gltf-binary")]);
  assert.equal(model3dPreviewFile(value)?.url,"/api/media/glb");
  assert.equal(model3dArtifactFiles(value)[0].format,"obj");
  assert.equal(model3dPreviewFile(artifact([file("/api/media/spoofed","glb","image/png")])),null);
  assert.equal(model3dPreviewFile(artifact([file("/api/media/obj","obj","model/obj")])),null);
});

test("unsupported GLB features keep the original download without attempting a viewer or hiding companion files",()=>{
  const value=artifact([file("/api/media/unsupported","glb","model/gltf-binary",{previewSupported:false}),file("/api/media/texture",null,"application/zip",{role:"texture",fileName:"textures.zip"})]);
  assert.equal(model3dPreviewFile(value),null);
  assert.equal(model3dArtifactFiles(value)[0].previewSupported,false);
  assert.equal(model3dArtifactFiles(value).length,2);
  value.settings.model3d_files.push(file("/api/media/compatible","glb","model/gltf-binary",{previewSupported:true}));
  assert.equal(model3dPreviewFile(value)?.url,"/api/media/compatible");
});

test("3D downloads never expose temporary provider URLs or duplicate the same retained file",()=>{
  const result=model3dArtifactFiles(artifact([
    file("https://fal.media/transient-model.glb","glb","model/gltf-binary"),
    file("//provider.example/model.glb","glb","model/gltf-binary"),
    file("/api/media/valid?redirect=elsewhere","glb","model/gltf-binary"),
    file("/api/media/valid","glb","model/gltf-binary",{fileName:"../../model.glb"}),
    file("/api/media/valid","glb","model/gltf-binary"),
  ]));
  assert.equal(result.length,1);
  assert.equal(result[0].url,"/api/media/valid");
  assert.equal(result[0].fileName.includes("/"),false);
});

test("legacy 3D primary downloads retain their actual known format without guessing octet-stream",()=>{
  assert.equal(model3dArtifactFiles(artifact())[0].fileName,"Teapot.obj");
  assert.equal(model3dArtifactFiles(artifact([],{mediaType:"model/gltf-binary"}))[0].fileName,"Teapot.glb");
  assert.deepEqual(model3dArtifactFiles(artifact([],{mediaType:"application/octet-stream"})),[]);
  assert.deepEqual(model3dArtifactFiles(artifact([],{kind:"video"})),[]);
});
