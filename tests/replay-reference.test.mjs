import assert from "node:assert/strict";
import test from "node:test";
import { findLicensedReplayReference, replayReferenceContentHash, replayReferenceGenerationPrompt } from "../worker/replay-reference.ts";

const reference = {
  label:"Tidal pool",description:"A close documentary study of a tidal pool.",source_strategy:"licensed-web",source_rationale:"A factual natural reference is useful here.",generation_prompt:"A close low-quality documentary reference of a rocky tidal pool.",internet_search_query:"rocky tidal pool anemone",mood:"Attentive",composition:"Top-down",materials:"Wet rock and water",lighting:"Cloudy daylight",spatial:"Anemone near center",palette:["#172526","#6f8f83","#c08e65","#d8c9ae"],
};

const jpeg = new Uint8Array([0xff,0xd8,0xff,0xdb,0,1,2,3]);

test("downloads and validates a licensed Commons reference before mock ingestion",async()=>{
  const calls=[];const fetcher=async(input)=>{const url=String(input);calls.push(url);if(url.startsWith("https://commons.wikimedia.org/w/api.php"))return Response.json({query:{pages:{"1":{title:"File:Tidal pool.jpg",imageinfo:[{thumburl:"https://upload.wikimedia.org/tidal-pool-1024.jpg",descriptionurl:"https://commons.wikimedia.org/wiki/File:Tidal_pool.jpg",mime:"image/jpeg",width:2048,height:1365,thumbwidth:1024,thumbheight:683,extmetadata:{LicenseShortName:{value:"CC BY-SA 4.0"},LicenseUrl:{value:"https://creativecommons.org/licenses/by-sa/4.0/"},Artist:{value:"<b>Example photographer</b>"},Attribution:{value:"Tidal pool by Example photographer"}}}]}}}});return new Response(jpeg,{headers:{"content-type":"image/jpeg","content-length":String(jpeg.length)}});};
  const result=await findLicensedReplayReference(reference,fetcher);
  assert.equal(calls.length,2);assert.match(calls[0],/gsrsearch=file%3Arocky\+tidal\+pool\+anemone/);assert.equal(calls[1],"https://upload.wikimedia.org/tidal-pool-1024.jpg");assert.deepEqual(result.bytes,jpeg);assert.equal(result.mimeType,"image/jpeg");assert.equal(result.width,1024);assert.equal(result.height,683);assert.equal(result.licenseName,"CC BY-SA 4.0");assert.equal(result.creator,"Example photographer");assert.equal(result.attribution,"Tidal pool by Example photographer");
});

test("rejects untrusted media URLs and non-image payloads",async()=>{
  const untrusted=async()=>Response.json({query:{pages:{"1":{title:"File:Wrong.jpg",imageinfo:[{thumburl:"https://example.com/wrong.jpg",mime:"image/jpeg",extmetadata:{LicenseShortName:{value:"CC0"}}}]}}}});
  await assert.rejects(()=>findLicensedReplayReference(reference,untrusted),/no_licensed_image/);
  const notImage=async(input)=>String(input).includes("w/api.php")?Response.json({query:{pages:{"1":{title:"File:Wrong.jpg",imageinfo:[{thumburl:"https://upload.wikimedia.org/wrong.jpg",mime:"image/jpeg",extmetadata:{LicenseShortName:{value:"CC0"}}}]}}}}):new Response(new TextEncoder().encode("not an image"),{headers:{"content-type":"image/jpeg"}});
  await assert.rejects(()=>findLicensedReplayReference(reference,notImage),/not_a_supported_image/);
});

test("keeps generated fallback prompts specific and hashes stored pixels",async()=>{
  assert.equal(replayReferenceGenerationPrompt(reference),reference.generation_prompt);
  assert.equal((await replayReferenceContentHash(jpeg)).length,64);
});
