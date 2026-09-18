import assert from "node:assert/strict";
import test from "node:test";
import { resolveServerRoute } from "../src/platform/applications.ts";
import { isRetainedOutputReaderRoute, routeCapabilities } from "../src/state/route-capabilities.ts";
import { projectTaskDocumentIdFromRoute, artifactFocusRoute, artifactFocusOptionsFromRoute, libraryFocusFromRoute } from "../src/model/routes.ts";
import { parseNativeRetainedOutputRoute } from "../src/model/native-retained-output.ts";

test("native Audio resolves the retained app and exact Document without private hydration or job feed",()=>{
 const route=`/make/audio?document=doc-a&artifact=audio-a&revision=2&sha256=${"a".repeat(64)}`;
 assert.deepEqual(resolveServerRoute(route),{application:"creative",entryPath:"/creative/",canonicalFamily:"/make/audio"});
 assert.equal(isRetainedOutputReaderRoute(route),true);assert.deepEqual(routeCapabilities(route),{profile:"workspace",privateContent:false,jobHistory:false});
 assert.equal(projectTaskDocumentIdFromRoute(route),"doc-a");const target=parseNativeRetainedOutputRoute(route);assert.equal(target.output,"audio");
 const href=artifactFocusRoute(target.selection.artifactId,"",{expectedRevision:target.selection.revision,expectedContentSha256:target.selection.contentSha256,intent:"inspect"},"/library?document=doc-a");
 assert.deepEqual(libraryFocusFromRoute(href),{kind:"artifact",id:"audio-a"});assert.equal(projectTaskDocumentIdFromRoute(href),"doc-a");
 assert.deepEqual(artifactFocusOptionsFromRoute(href),{expectedRevision:2,expectedContentSha256:"a".repeat(64),intent:"inspect"});
 assert.equal(projectTaskDocumentIdFromRoute(route+"&document=other"),"");assert.equal(parseNativeRetainedOutputRoute(route+"&document=other"),null);
 assert.equal(parseNativeRetainedOutputRoute("/make/audio"),null,"bare route never picks the latest output");
});
