import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { coverMediaFixture } from './helpers/video-cover-media.mjs';
import { inspectVideoCover, videoCoverUrl, VIDEO_COVER_MAX_BYTES } from '../src/model/video-cover.ts';
import { handleVideoCover, videoCoverKey, deleteVideoCovers } from '../worker/video-cover.ts';

const webp = new Uint8Array(await readFile(new URL('../public/assets/marketing/quiet-coast-landscape-480.fbd891fc07eb.webp', import.meta.url)));
function fixture() {
  const f = coverMediaFixture(), owner = 'owner', key = 'owner/generated/video.mp4', sha = 'a'.repeat(64);
  f.rows.set(key, { bytes: new Uint8Array([1,2,3]), contentType: 'video/mp4', customMetadata: { ownerId: owner, source: 'provider-generated-media', sha256: sha, artifactId: 'video' } });
  const url = 'https://example.com'+videoCoverUrl('/api/media/'+encodeURIComponent(key));
  return { ...f, owner, key, sha, url, async request(init = {}, writable = true) {
    return handleVideoCover(new Request(url, init), { MEDIA: f.MEDIA }, key, await f.MEDIA.head(key), owner, writable);
  }, post(bytes = webp, hash = sha) { return { method: 'POST', headers: { 'content-type': 'image/webp', 'x-video-source-sha256': hash }, body: bytes }; } };
}

test('cover URLs only derive from canonical private MP4 paths', () => {
  assert.equal(videoCoverUrl('/api/media/owner%2Fgenerated%2Fa.mp4'), '/api/media/owner%2Fgenerated%2Fa.mp4?video-cover=webp');
  for (const url of ['https://external/video.mp4', '/api/media/a.mp4?x=y', '/api/media/a.mp4#x', '/api/media/%zz', '/api/media/a/b.mp4', '/api/media/a.png']) assert.equal(videoCoverUrl(url), null);
});
test('WebP framing and dimensions are checked, rejecting mislabeled, truncated, animated and oversized files', () => {
  const size = inspectVideoCover(webp); assert.equal(size.width, 480); assert.ok(size.height > 0);
  for (const bytes of [new Uint8Array([137,80,78,71]), webp.slice(0,-1), new Uint8Array(VIDEO_COVER_MAX_BYTES+1)]) assert.throws(()=>inspectVideoCover(bytes));
  const animated = webp.slice(); animated.set(new TextEncoder().encode('ANIM'),12); assert.throws(()=>inspectVideoCover(animated));
});
test('stores a separate WebP once, reads exact retained bytes, and binds dimensions/source hash', async () => {
  const f = fixture(), missing = await f.request(); assert.equal(missing.status,404); assert.equal(missing.headers.get('x-video-source-sha256'),f.sha);
  assert.equal((await f.request(f.post())).status,200);
  assert.equal((await f.request(f.post())).status,200); assert.equal(f.writes.length,1);
  const key = videoCoverKey(f.key,f.sha), row = f.rows.get(key);
  assert.equal(row.contentType,'image/webp'); assert.equal(row.customMetadata.width,'480'); assert.equal(row.customMetadata.sourceKey,f.key);
  const result = await f.request(); assert.equal(result.headers.get('content-type'),'image/webp'); assert.equal(result.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()),webp);
  assert.deepEqual(f.rows.get(f.key).bytes,new Uint8Array([1,2,3]));
});
test('denies unauthorized writes, wrong MIME, stale source hashes and invalid bytes', async () => {
  const f = fixture();
  assert.equal((await f.request(f.post(),false)).status,403);
  assert.equal((await f.request({...f.post(),headers:{...f.post().headers,'content-type':'image/png'}})).status,415);
  assert.equal((await f.request(f.post(webp,'b'.repeat(64)))).status,409);
  assert.equal((await f.request(f.post(webp.slice(0,20)))).status,400);
  assert.equal(f.writes.length,0);
});
test('replacement selects a new cover, and disappearance during upload prevents saving', async () => {
  const f = fixture(); await f.request(f.post());
  f.rows.get(f.key).customMetadata.sha256 = 'b'.repeat(64);
  assert.equal((await f.request()).status,404);
  const source = await f.MEDIA.head(f.key); f.rows.delete(f.key);
  const response = await handleVideoCover(new Request(f.url,f.post(webp,'b'.repeat(64))),{MEDIA:f.MEDIA},f.key,source,f.owner,true);
  assert.equal(response.status,409); assert.equal(f.writes.length,1);
});
test('only generated MP4 sources can receive covers', async () => {
  for(const change of [{contentType:'image/png'},{source:'uploaded-file'},{ownerId:'another-user'}]) {
    const f=fixture(); Object.assign(change.contentType?f.rows.get(f.key):f.rows.get(f.key).customMetadata,change);
    assert.equal((await f.request()).status,404);
  }
});
test('erasure removes all cover revisions and refuses mismatched custody',async()=>{
  const f=fixture();await f.request(f.post());
  f.rows.get(f.key).customMetadata.sha256='b'.repeat(64);await f.request(f.post(webp,'b'.repeat(64)));
  assert.equal(f.rows.size,3);
  await deleteVideoCovers(f.MEDIA,f.key,f.owner);assert.equal(f.rows.size,1);assert.ok(f.rows.has(f.key));
  await f.request(f.post(webp,'b'.repeat(64)));
  await assert.rejects(()=>deleteVideoCovers(f.MEDIA,f.key,'another-owner'),/owner_mismatch/);
  assert.equal(f.rows.size,2);
});

test('legacy video checksum backfill preserves the source and avoids rereading MP4 bytes after saving', async () => {
  const f=fixture();delete f.rows.get(f.key).customMetadata.sha256;
  let sourceReads=0;const get=f.MEDIA.get;f.MEDIA.get=async key=>{if(key===f.key)sourceReads++;return get(key);};
  const missing=await f.request();assert.equal(missing.status,404);
  const digest=missing.headers.get('x-video-source-sha256');
  assert.equal(digest,'039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
  assert.equal((await f.request(f.post(webp,digest))).status,200);
  const before=sourceReads;
  assert.equal((await f.request({},false)).status,200);
  assert.equal((await f.request(f.post(webp,digest))).status,200);
  assert.equal(sourceReads,before);assert.equal(f.writes.length,1);
  assert.equal(f.rows.get(f.key).customMetadata.sha256,undefined);
  f.rows.get(f.key).bytes=new Uint8Array([4,5,6]);
  const replaced=await f.request();assert.equal(replaced.status,404);
  assert.notEqual(replaced.headers.get('x-video-source-sha256'),digest);
  assert.equal((await f.request(f.post(webp,digest))).status,409);
  await deleteVideoCovers(f.MEDIA,f.key,f.owner);assert.equal(f.rows.size,1);
});
test('legacy sources fail closed on unauthorized creation, oversized content and concurrent replacement', async () => {
  const f=fixture();delete f.rows.get(f.key).customMetadata.sha256;
  assert.equal((await f.request(f.post(),false)).status,403);
  const source=await f.MEDIA.head(f.key);
  assert.equal((await handleVideoCover(new Request(f.url),{MEDIA:f.MEDIA},f.key,{...source,size:32_000_001},f.owner,true)).status,413);
  f.rows.get(f.key).bytes=new Uint8Array([7,8,9]);
  assert.equal((await handleVideoCover(new Request(f.url),{MEDIA:f.MEDIA},f.key,source,f.owner,true)).status,409);
  assert.equal(f.writes.length,0);
});
