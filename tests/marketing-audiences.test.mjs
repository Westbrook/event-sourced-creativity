import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { marketingPath, parseMarketingRoute } from "../src/marketing/profiles.ts";

const audiences = {
  "hollywood-filmmakers": { project: "The Glass Meridian", prefix: "glass-meridian", count: 165 },
  marketers: { project: "The Brighter Hour", prefix: "brighter-hour", count: 167 },
  "indie-filmmakers": { project: "The Last Light on Mercer", prefix: "mercer-midnight", count: 167 },
};
const locales = ["en", "fr", "ar", "ja"];
const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const escaped = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const placeholders = (value) => [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();

test("marketing audiences use strictly allowlisted persona-first public routes", () => {
  assert.deepEqual(parseMarketingRoute("/"), { profile: "generic" });
  assert.deepEqual(parseMarketingRoute("/welcome"), { profile: "generic" });
  assert.deepEqual(parseMarketingRoute("/welcome/fr/"), { profile: "generic", locale: "fr" });

  for (const profile of Object.keys(audiences)) {
    assert.deepEqual(parseMarketingRoute(`/welcome/${profile}`), { profile });
    for (const locale of locales) {
      assert.deepEqual(parseMarketingRoute(`/welcome/${profile}/${locale}/`), { profile, locale });
      assert.equal(marketingPath(profile, locale), `/welcome/${profile}/${locale}`);
    }
  }

  for (const invalid of [
    "/welcome/hollywood/en", "/welcome/indie/en", "/welcome/film-studios/en",
    "/welcome/en/marketers", "/welcome/marketers/de", "/welcome/marketers/en/extra",
    "/welcome//en", "/welcome/MARKETERS/en", "/welcome/marketers/%2Fen",
  ]) assert.equal(parseMarketingRoute(invalid), undefined, invalid);
});

test("each audience has four complete, specialist-authored localized campaign catalogs", async () => {
  const base = (await import("../src/marketing/locales/en.ts")).default;
  for (const [profile, { project, count }] of Object.entries(audiences)) {
    const english = (await import(`../src/marketing/profiles/${profile}/en.ts`)).default;
    const keys = Object.keys(english);
    assert.equal(keys.length, count, profile);
    assert.match(english.processCollectBody, /upload owned or licensed recordings privately/i, `${profile} must disclose private recording upload and source rights`);

    for (const locale of locales) {
      const translated = (await import(`../src/marketing/profiles/${profile}/${locale}.ts`)).default;
      assert.deepEqual(Object.keys(translated), keys, `${profile}/${locale} exact catalog parity`);
      assert.equal(translated.projectName, project, `${profile}/${locale} authored world name`);
      for (const key of keys) {
        assert.ok(Object.hasOwn(base, key), `${profile}.${key} is an unknown public message`);
        assert.equal(typeof translated[key], "string", `${profile}/${locale}.${key}`);
        assert.ok(translated[key].trim(), `${profile}/${locale}.${key}`);
        assert.deepEqual(placeholders(translated[key]), placeholders(english[key]), `${profile}/${locale}.${key} placeholders`);
        assert.doesNotMatch(translated[key], /&(amp|lt|gt|quot);|&#\d+;/, `${profile}/${locale}.${key} must not be pre-escaped`);
      }
      if (locale !== "en") {
        for (const key of ["pageTitle", "heroTitle", "heroIntroduction", "proofTitle", "previewStoryParagraphOne", "previewSceneBeatOne", "outputVideoDetail"]) {
          assert.notEqual(translated[key], english[key], `${profile}/${locale}.${key} cannot fall back to English`);
        }
      }
    }
  }
});

test("every creative world owns four optimized, fingerprinted responsive study families", async () => {
  const { MARKETING_PROFILE_ASSET_HASHES, MARKETING_STUDY_WIDTHS } = await import("../src/marketing/profile-assets.ts");
  const allHashes = new Set();

  for (const [profile, { prefix }] of Object.entries(audiences)) {
    let count = 0;
    for (const [family, formats] of Object.entries(MARKETING_PROFILE_ASSET_HASHES[profile])) {
      for (const [format, hashes] of Object.entries(formats)) {
        assert.equal(hashes.length, 3, `${profile}/${family}/${format} responsive widths`);
        for (const [index, hash] of hashes.entries()) {
          const width = MARKETING_STUDY_WIDTHS[family][index];
          const path = `/assets/marketing/${prefix}-${family}-${width}.${hash}.${format}`;
          const bytes = await readFile(new URL(`../public${path}`, import.meta.url));
          assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0, 12), hash, path);
          assert.ok(bytes.length < 90_000, `${path} exceeds the 90 KB image budget`);
          assert.ok(!allHashes.has(hash), `${path} unexpectedly reuses another project study`);
          allHashes.add(hash);
          if (format === "webp") assert.equal(bytes.subarray(8, 12).toString(), "WEBP", path);
          else assert.equal(bytes.subarray(4, 8).toString(), "ftyp", path);
          count += 1;
        }
      }
    }
    assert.equal(count, 24, `${profile} must expose all 24 AVIF/WebP responsive derivatives`);
  }
});

test("every creative world owns a genuine silent eight-second scene and an authentic extracted poster", async () => {
  const { MARKETING_PROFILE_VIDEO_ASSETS } = await import("../src/marketing/profile-assets.ts");

  for (const [profile, { prefix }] of Object.entries(audiences)) {
    const media = MARKETING_PROFILE_VIDEO_ASSETS[profile];
    const video = media.video.match(new RegExp(`^/assets/marketing/${prefix}-scene-8s\\.([a-f0-9]{12})\\.mp4$`));
    const poster = media.poster.match(new RegExp(`^/assets/marketing/${prefix}-scene-poster-960\\.([a-f0-9]{12})\\.jpg$`));
    assert.ok(video, `${profile} requires an immutable eight-second MP4`);
    assert.ok(poster, `${profile} requires an immutable poster from its own video`);

    const videoPath = new URL(`../public${media.video}`, import.meta.url);
    const posterPath = new URL(`../public${media.poster}`, import.meta.url);
    const [videoBytes, posterBytes] = await Promise.all([readFile(videoPath), readFile(posterPath)]);
    assert.equal(createHash("sha256").update(videoBytes).digest("hex").slice(0, 12), video[1], profile);
    assert.equal(createHash("sha256").update(posterBytes).digest("hex").slice(0, 12), poster[1], profile);
    assert.equal(videoBytes.subarray(4, 8).toString(), "ftyp", profile);
    assert.equal(posterBytes.subarray(0, 2).toString("hex"), "ffd8", profile);
    assert.ok(videoBytes.length < 950_000, `${profile} eight-second video must remain below 950 KB`);
    assert.ok(posterBytes.length < 45_000, `${profile} authentic poster must remain below 45 KB`);

    const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height,r_frame_rate:format=duration", "-of", "json", videoPath], { encoding: "utf8" });
    assert.equal(result.status, 0, `${profile} media inspection failed: ${result.stderr}`);
    const inspected = JSON.parse(result.stdout);
    assert.equal(inspected.streams.length, 1, `${profile} must have one video stream and no audio stream`);
    assert.equal(inspected.streams[0].codec_type, "video", profile);
    assert.equal(inspected.streams[0].codec_name, "h264", profile);
    assert.equal(inspected.streams[0].width, 1280, profile);
    assert.equal(inspected.streams[0].height, 720, profile);
    assert.equal(inspected.streams[0].r_frame_rate, "24/1", profile);
    assert.ok(Math.abs(Number(inspected.format.duration) - 8) < .15, `${profile} must genuinely contain eight seconds`);
  }
});

test("all localized audience pages render their own truthful world and genuine silent scene without private state", async () => {
  const worker = (await import("../dist/server/index.js")).default;
  const original = await source("dist/client/marketing.html");
  let accesses = 0;
  const environment = {
    get DB() { throw new Error("An audience landing page touched private database state."); },
    get MEDIA() { throw new Error("An audience landing page touched private media."); },
    ASSETS: {
      async fetch(request) {
        accesses += 1;
        assert.equal(new URL(request.url).pathname, "/marketing");
        return new Response(request.method === "HEAD" ? null : original, {
          headers: { "content-type": "text/html; charset=utf-8", "content-length": String(Buffer.byteLength(original)), etag: "generic-marketing" },
        });
      },
    },
  };
  const context = { waitUntil() { throw new Error("An audience landing page scheduled account work."); } };

  for (const [profile, { project, prefix }] of Object.entries(audiences)) {
    for (const locale of locales) {
      const catalog = (await import(`../src/marketing/locales/${locale}.ts`)).default;
      const overlay = (await import(`../src/marketing/profiles/${profile}/${locale}.ts`)).default;
      const messages = { ...catalog, ...overlay };
      const route = `/welcome/${profile}/${locale}`;
      const response = await worker.fetch(new Request(`https://forma.example${route}`, {
        headers: { "accept-language": "de, en;q=0.5", cookie: "forma_project_context=confidential-project" },
      }), environment, context);
      const body = await response.text();

      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get("x-forma-route-family"), "marketing", route);
      assert.equal(response.headers.get("content-language"), locale, route);
      assert.equal(response.headers.get("etag"), null, route);
      assert.equal(response.headers.get("content-length"), null, route);
      assert.ok(!/accept-language/i.test(response.headers.get("vary") ?? ""), `${route} must not vary by negotiated language`);
      assert.match(body, new RegExp(`<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">`));
      assert.ok(body.includes(`<body data-marketing-profile="${profile}">`), route);
      assert.ok(body.includes(`<title>${escaped(messages.pageTitle)}</title>`), `${route} localized title`);
      assert.ok(body.includes(`name="description" content="${escaped(messages.pageDescription)}"`), `${route} localized description`);
      assert.ok(body.includes(`property="og:title" content="${escaped(messages.socialTitle)}"`), `${route} localized social title`);
      assert.ok(body.includes(`name="twitter:description" content="${escaped(messages.socialDescription)}"`), `${route} localized social description`);
      assert.ok(body.includes(`rel="canonical" href="${route}"`), `${route} canonical`);
      assert.ok(body.includes(`hreflang="x-default" href="/welcome/${profile}"`), `${route} default alternate`);
      for (const alternate of locales) {
        assert.ok(body.includes(`hreflang="${alternate}" href="/welcome/${profile}/${alternate}"`), `${route} alternate ${alternate}`);
        assert.match(body, new RegExp(`<a href="/welcome/${profile}/${alternate}" lang="${alternate}" hreflang="${alternate}"`), `${route} no-JS fallback ${alternate}`);
      }
      for (const key of [
        "heroTitle", "heroIntroduction", "proofTitle", "proofSubjectValue", "proofSettingValue", "proofLightingValue", "proofBoundaryValue",
        "moodValue", "audienceValue", "creativeBoundaryValue", "referenceValue", "exhibitIntroduction", "outputVideoDetail", "proofVideoBadge",
        "previewStoryParagraphOne", "previewStoryParagraphSix", "previewSceneBeatOne", "previewSceneBeatEight", "previewSlideFiveBody",
        "previewFrameCaptionOne", "previewFrameCaptionSix", "outputAudioDirection", "outputAudioDisclaimer", "processCollectBody",
        "audioPermissionsIntroduction", "audioPermissionInformBody", "audioPermissionIncludeBody", "audioPermissionTransferBody", "audioPermissionsReset",
      ]) assert.ok(body.includes(escaped(messages[key])), `${route} localized ${key}`);
      assert.ok(body.includes(`>${escaped(project)}<`), `${route} authored project`);
      assert.ok(body.includes(`data-profile-link="${profile}" aria-current="page"`), `${route} current audience`);
      assert.match(body, new RegExp(`/assets/marketing/${prefix}-(?:landscape|portrait|detail|twilight)-`), `${route} original creative studies`);
      assert.doesNotMatch(body, /\/assets\/marketing\/quiet-coast-/, `${route} must not inherit The Quiet Coast imagery`);
      const videos = [...body.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/g)];
      assert.equal(videos.length, 1, `${route} must present exactly one genuine eight-second video`);
      const [, attributes, contents] = videos[0];
      for (const attribute of ["controls", "muted", "loop", "playsinline", "data-marketing-video"]) {
        assert.match(attributes, new RegExp(`(?:^|\\s)${attribute}(?:\\s|$)`), `${route} ${attribute}`);
      }
      assert.match(attributes, /\bpreload="none"/, `${route} video must not load before requested`);
      assert.match(attributes, new RegExp(`/assets/marketing/${prefix}-scene-poster-960\\.[a-f0-9]{12}\\.jpg`), `${route} real poster`);
      assert.match(contents, new RegExp(`/assets/marketing/${prefix}-scene-8s\\.[a-f0-9]{12}\\.mp4`), `${route} real eight-second scene`);
      assert.ok(body.includes(`aria-label="${escaped(messages.individualVideoScene)}"`), `${route} localized scene description`);
      assert.ok(body.includes(`data-copy="proofVideoBadge">${escaped(messages.proofVideoBadge)}`), `${route} truthful video provenance`);
      assert.equal([...body.matchAll(/\bdata-marketing-video-toggle\b/g)].length, 1, `${route} keeps its accessible play/pause action`);
      assert.doesNotMatch(body, /<audio\b/, `${route} must not invent audio playback`);
      assert.equal([...body.matchAll(/<li\s+data-copy="format(?:Image|Story|Scene|Presentation|Storyboard|Video|Audio)"/g)].length, 7, `${route} exact supported format count`);
      for (const other of Object.values(audiences).filter((candidate) => candidate.prefix !== prefix)) {
        assert.doesNotMatch(body, new RegExp(`/assets/marketing/${other.prefix}-`), `${route} must not mix project worlds`);
      }

      const head = await worker.fetch(new Request(`https://forma.example${route}/`, { method: "HEAD" }), environment, context);
      assert.equal(head.status, 200, `${route} HEAD`);
      assert.equal(head.headers.get("content-language"), locale, `${route} HEAD language`);
      assert.equal(await head.text(), "", `${route} HEAD body`);
    }

    const negotiated = await worker.fetch(new Request(`https://forma.example/welcome/${profile}`, {
      headers: { "accept-language": "de-DE, fr-CA;q=0.9, en;q=0.2" },
    }), environment, context);
    assert.equal(negotiated.headers.get("content-language"), "fr", `${profile} negotiated language`);
    assert.match(negotiated.headers.get("vary") ?? "", /accept-language/i, `${profile} negotiated cache variation`);
    assert.ok((await negotiated.text()).includes(`rel="canonical" href="/welcome/${profile}/fr"`), `${profile} negotiated canonical`);
  }

  const previous = accesses;
  for (const invalid of ["/welcome/en/marketers", "/welcome/hollywood/en", "/welcome/marketers/de", "/welcome/indie-filmmakers/en/extra"]) {
    assert.equal((await worker.fetch(new Request(`https://forma.example${invalid}`), environment, context)).status, 404, invalid);
  }
  assert.equal(accesses, previous, "Invalid audience routes must fail before public assets or private bindings are accessed.");
});

test("audience catalogs remain public-only, lazy, bounded, and preserve existing accessible image viewing", async () => {
  const manifest = JSON.parse(await source("dist/client/.vite/manifest.json"));
  const entry = manifest["marketing.html"];
  const enhancement = await source("src/marketing/main.ts");
  const styles = await source("src/marketing/marketing.css");

  for (const profile of Object.keys(audiences)) {
    for (const locale of locales) {
      const key = `src/marketing/profiles/${profile}/${locale}.ts`;
      const item = manifest[key];
      assert.ok(item?.file, `${key} must have an independent audience/language chunk`);
      assert.ok(entry.dynamicImports.includes(key), `${key} must remain demand-loaded`);
      const content = await source(`dist/client/${item.file}`);
      assert.ok(gzipSync(content).length < 18_000, `${key} exceeds its public transfer budget`);
      assert.doesNotMatch(content, /FormaStore|api\/session|protected-assets/, `${key} must not import the private application`);
    }
  }
  assert.match(enhancement, /marketingPath\(activeProfile, target\.locale\)/);
  assert.match(enhancement, /quiet-coast\|glass-meridian\|brighter-hour\|mercer-midnight/);
  assert.match(enhancement, /audienceNavigation\.scrollLeft\s*\+=\s*direction\s*===\s*"rtl"/);
  assert.doesNotMatch(enhancement, /currentAudience\.scrollIntoView\(/, "Revealing the active audience must not jump the full page.");
  assert.match(styles, /\.marketing-audiences\s*\{[^}]*overflow-x:\s*auto[^}]*overscroll-behavior-inline:\s*contain/s);
  assert.match(styles, /\.marketing-audiences\s*>\s*a\s*\{[^}]*min-block-size:\s*2\.75rem[^}]*min-inline-size:\s*2\.75rem/s);
});
