import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = process.argv[2] ? resolve(process.argv[2]) : "";
if (!sourceRoot || !sourceRoot.startsWith(join(root, "outputs", "marketing-persona-videos") + "/")) {
  throw new Error("Pass an existing approved three-audience video-generation output directory.");
}

const require = createRequire(import.meta.url);
const wrangler = require.resolve("wrangler");
const miniflare = require.resolve("miniflare/package.json", { paths: [dirname(wrangler)] });
const sharp = require(require.resolve("sharp", { paths: [dirname(miniflare)] }));
const destination = join(root, "public", "assets", "marketing");
await mkdir(destination, { recursive: true });

function execute(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr ?? "").slice(-1_500)}`);
  return result.stdout;
}

function inspect(path) {
  const metadata = JSON.parse(execute("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_name,codec_type,width,height:format=duration,size",
    "-of", "json", path,
  ]));
  if (metadata.streams?.length !== 1 || metadata.streams[0].codec_type !== "video") {
    throw new Error("Marketing scenes must have exactly one video stream and no audio stream.");
  }
  if (metadata.streams[0].width !== 1280 || metadata.streams[0].height !== 720) {
    throw new Error("Marketing scenes must retain their genuine 1280 × 720 resolution.");
  }
  if (Math.abs(Number(metadata.format.duration) - 8) > .15) {
    throw new Error("Marketing scenes must contain eight seconds of original generated footage.");
  }
  return metadata;
}

const profiles = process.argv[3] === "--original"
  ? { generic: "quiet-coast" }
  : {
      "hollywood-filmmakers": "glass-meridian",
      marketers: "brighter-hour",
      "indie-filmmakers": "mercer-midnight",
    };
const manifest = {};

for (const [profile, prefix] of Object.entries(profiles)) {
  const input = join(sourceRoot, prefix, "original.mp4");
  inspect(input);
  const working = join(sourceRoot, prefix, "optimized.mp4");
  let video;
  for (const quality of [27, 29, 31, 33, 35, 37]) {
    execute("ffmpeg", [
      "-y", "-v", "error", "-i", input, "-an", "-c:v", "libx264",
      "-preset", "slow", "-crf", String(quality), "-pix_fmt", "yuv420p", "-movflags", "+faststart", working,
    ]);
    video = await readFile(working);
    if (video.length <= 950_000) break;
  }
  if (!video || video.length > 950_000) throw new Error(`${prefix} exceeds the 950 KB eight-second video budget.`);
  inspect(working);

  const extracted = join(sourceRoot, prefix, "poster.png");
  execute("ffmpeg", ["-y", "-v", "error", "-ss", "0.12", "-i", input, "-frames:v", "1", "-update", "1", extracted]);
  let poster;
  for (const quality of [78, 68, 58, 48]) {
    poster = await sharp(extracted).resize({ width: 960, height: 540, fit: "cover" }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (poster.length < 45_000) break;
  }
  if (!poster || poster.length >= 45_000) throw new Error(`${prefix} exceeds the 45 KB authentic-frame poster budget.`);

  const videoHash = createHash("sha256").update(video).digest("hex").slice(0, 12);
  const posterHash = createHash("sha256").update(poster).digest("hex").slice(0, 12);
  const videoFile = `${prefix}-scene-8s.${videoHash}.mp4`;
  const posterFile = `${prefix}-scene-poster-960.${posterHash}.jpg`;
  await writeFile(join(destination, videoFile), video);
  await writeFile(join(destination, posterFile), poster);
  manifest[profile] = { video: videoFile, poster: posterFile, videoBytes: video.length, posterBytes: poster.length };
}

process.stdout.write(JSON.stringify(manifest));
