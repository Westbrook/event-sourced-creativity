import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";
import { applicationIdFromRoute, resolveServerRoute } from "../src/platform/applications.ts";

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const supersededCampaignFingerprints = [
  "3635a9c01f8d", "826af30a5a0e", "8e40d9aa1cb4",
  "497a7b80f2c0", "4447050f2e7d", "fab0cc7be553",
  "3bbe35b4c352", "cccd841c5c30", "bfbb9db50049",
  "3073b94eb340", "b8caf5e92daf", "501051223d04",
];

test("marketing has an independent, truthful, fully readable public document", async () => {
  const [html, enhancement, styles] = await Promise.all([
    source("marketing.html"),
    source("src/marketing/main.ts"),
    source("src/marketing/marketing.css"),
  ]);

  assert.match(html, /<h1[^>]*>Give your ideas a world to live in\.<\/h1>/);
  assert.ok([...html.matchAll(/href="\/projects"/g)].length >= 3);
  assert.match(html, /Illustrative project/);
  assert.match(html, /Fictional project featuring original generated imagery\. Exploring this example does not start a new generation\./);
  for (const format of ["Image", "Story", "Scene", "Presentation", "Storyboard", "Video scenes"]) {
    assert.match(html, new RegExp(`>${format}<`), format);
  }
  for (const section of ["how-it-works", "for-teams", "main-content"]) {
    assert.match(html, new RegExp(`id="${section}"`), section);
  }
  assert.doesNotMatch(html, /<forma-shell|forma-static-session-prefetch|\/api\/session|fonts\.googleapis\.com/);
  assert.doesNotMatch(html, /SOC 2|ISO 27001|enterprise-ready|live cursors|SSO|SCIM|autonomous agents|free trial/i);
  assert.match(enhancement, /class FormaContextDemo/);
  assert.match(enhancement, /IntersectionObserver/);
  assert.match(enhancement, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(enhancement, /fetch\(|navigator\.sendBeacon|FormaStore|\/src\/main/);
  assert.match(styles, /--marketing-canvas: light-dark\(#f7f7f4, #10110f\)/);
  assert.match(styles, /min-block-size: 2\.75rem/);
  assert.match(styles, /\.context-choice\[aria-pressed="true"\]\s*>\s*span\s*\{\s*color:\s*var\(--marketing-ink\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(styles, /@import|overflow-x:\s*(?:hidden|clip)/);
  assert.match(html, /<html lang="en" dir="ltr">/);
  for (const locale of ["en", "fr", "ar", "ja"]) {
    assert.match(html, new RegExp(`hreflang="${locale}" href="/welcome/${locale}"`));
    assert.match(html, new RegExp(`href="/welcome/${locale}"`));
  }
  assert.match(html, /data-copy="languageLabel"/);
  assert.match(html, /dir="auto" data-copy="projectName"/);
  assert.match(enhancement, /forma:locale/);
  assert.match(enhancement, /navigator\.languages/);
  assert.match(enhancement, /languageChangeError/);
  assert.match(styles, /html:lang\(ar\)/);
  assert.match(styles, /html:lang\(ja\)/);
  assert.match(styles, /html\[dir="rtl"\]/);
});

test("original campaign imagery is public, fingerprinted, optimized, and never attributed to Forma generation", async () => {
  const html = await source("marketing.html");
  const assets = [...new Set([...html.matchAll(/\/assets\/marketing\/quiet-coast-[\w.-]+\.(?:avif|webp)/g)].map(([path]) => path))];
  const images = [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => tag);

  assert.ok(assets.length >= 24, "All four campaign studies need responsive AVIF and WebP derivatives.");
  for (const fingerprint of supersededCampaignFingerprints) {
    assert.ok(!html.includes(fingerprint), "An obsolete full-moon campaign image remains in the landing page.");
  }
  for (const variation of ["portrait", "landscape", "detail", "twilight"]) {
    assert.ok(assets.some((path) => path.includes(`quiet-coast-${variation}-`)), variation);
  }
  for (const path of assets) {
    const match = path.match(/^\/assets\/marketing\/quiet-coast-(?:portrait|landscape|detail|twilight)-\d+\.([a-f0-9]{12})\.(avif|webp)$/);
    assert.ok(match, `Campaign asset must have an immutable content fingerprint: ${path}`);
    const bytes = await readFile(new URL(`../public${path}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0, 12), match[1], path);
    assert.ok(bytes.length < 90_000, `${path} must remain below 90 KB.`);
    if (match[2] === "webp") {
      assert.equal(bytes.subarray(0, 4).toString(), "RIFF", path);
      assert.equal(bytes.subarray(8, 12).toString(), "WEBP", path);
    } else {
      assert.equal(bytes.subarray(4, 8).toString(), "ftyp", path);
    }
  }

  assert.ok(images.length >= 7, "Campaign art should appear throughout the hero, examples, and exhibit.");
  assert.equal(images.filter((tag) => /loading="eager"/.test(tag)).length, 1);
  assert.equal(images.filter((tag) => /fetchpriority="high"/.test(tag)).length, 1);
  for (const [index, tag] of images.entries()) {
    assert.match(tag, /width="\d+"/);
    assert.match(tag, /height="\d+"/);
    assert.match(tag, /alt=""/);
    assert.match(tag, /decoding="async"/);
    if (index) assert.match(tag, /loading="lazy"/);
  }

  assert.match(html, /featuring original generated imagery/);
  assert.doesNotMatch(html, /imagery (?:was )?(?:created|generated) (?:with|by) Forma/i);
  assert.doesNotMatch(html, /\/api\/media|\.r2\.dev|fal\.media|blob:|(?:signature|token)=/i);
});

test("the real campaign scene uses one lazy, fingerprinted video and an accessible hover-only toggle", async () => {
  const [html, enhancement, styles] = await Promise.all([
    source("marketing.html"),
    source("src/marketing/main.ts"),
    source("src/marketing/marketing.css"),
  ]);
  const videos = [...html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/g)];
  const toggles = [...html.matchAll(/<button\b([^>]*\bdata-marketing-video-toggle[^>]*)><\/button>/g)];

  assert.equal(videos.length, 1, "Exactly one genuine campaign video should be published.");
  assert.equal(toggles.length, 1, "The video should have exactly one custom playback control.");
  const [, video, contents] = videos[0];
  const [, toggle] = toggles[0];
  for (const attribute of ["controls", "muted", "loop", "playsinline", "data-marketing-video"]) {
    assert.match(video, new RegExp("(?:^|\\s)" + attribute + "(?:\\s|$)"), attribute);
  }
  assert.match(video, /\bpreload="none"/);
  assert.match(video, /\bwidth="960"\s+height="540"/);
  assert.match(video, /\baria-label="One individual video scene"/);
  assert.match(video, /\bdata-copy-aria="individualVideoScene"/);
  assert.doesNotMatch(video, /\bautoplay(?:\s|=|$)/);
  assert.match(toggle, /\btype="button"/);
  assert.match(toggle, /\baria-pressed="false"/);
  assert.match(toggle, /\baria-label="Play video"/);
  assert.match(toggle, /\bdata-copy-aria="videoPlayLabel"/);
  assert.match(toggle, /\bhidden(?:\s|$)/);

  const videoPath = contents.match(/\bsrc="(\/assets\/marketing\/quiet-coast-scene-4s\.([a-f0-9]{12})\.mp4)"\s+type="video\/mp4"/);
  const posterPath = video.match(/\bposter="(\/assets\/marketing\/quiet-coast-scene-poster-960\.([a-f0-9]{12})\.jpg)"/);
  assert.ok(videoPath, "The public MP4 must have an immutable content fingerprint.");
  assert.ok(posterPath, "The genuine first-frame poster must have an immutable content fingerprint.");
  for (const [match, budget] of [[videoPath, 350_000], [posterPath, 30_000]]) {
    const bytes = await readFile(new URL("../public" + match[1], import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0, 12), match[2]);
    assert.ok(bytes.length < budget, match[1] + " exceeds its transfer budget.");
    if (match === videoPath) assert.equal(bytes.subarray(4, 8).toString(), "ftyp");
    else assert.equal(bytes.subarray(0, 2).toString("hex"), "ffd8");
  }

  assert.match(html, /data-context-study="detail"[\s\S]*?<\/picture>\s*<video\b/);
  assert.match(enhancement, /motionVideo\.controls\s*=\s*false/);
  assert.match(enhancement, /motionToggle\.hidden\s*=\s*false/);
  assert.match(enhancement, /videoPauseLabel"\s*:\s*"videoPlayLabel/);
  assert.match(enhancement, /intersectionRatio\s*>=\s*\.35/);
  assert.match(enhancement, /threshold:\s*\[0\.08,\s*0\.35\]/);
  assert.match(enhancement, /document\.hidden/);
  assert.match(enhancement, /manuallyPaused\s*=\s*true/);
  assert.match(styles, /\.output-motion__toggle\s*\{[^}]*inline-size:\s*3\.25rem[^}]*block-size:\s*3\.25rem[^}]*opacity:\s*0[^}]*pointer-events:\s*none/s);
  assert.match(styles, /\.output-motion:hover \.output-motion__toggle,\s*\.output-motion:focus-within \.output-motion__toggle,\s*\.output-motion__toggle:focus-visible\s*\{\s*opacity:\s*1;\s*pointer-events:\s*auto/);
  assert.match(styles, /@media \(hover:\s*none\),\s*\(pointer:\s*coarse\)\s*\{[^}]*\.output-motion__toggle\s*\{\s*opacity:\s*1;\s*pointer-events:\s*auto/s);
  assert.match(styles, /\.output-motion__toggle\[hidden\]\s*\{\s*display:\s*none/);
});

test("viewport looping and the centered control honor visitor intent, visibility, and reduced motion", async () => {
  const enhancement = await source("src/marketing/main.ts");
  const marker = 'const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");';
  const index = enhancement.indexOf(marker);
  assert.notEqual(index, -1, "The isolated motion enhancement must remain inspectable.");
  const behavior = stripTypeScriptTypes(enhancement.slice(index));

  function harness({ reduced = false, supported = true, blocked = false } = {}) {
    function events(initial = {}) {
      const listeners = new Map();
      return Object.assign(initial, {
        addEventListener(type, listener) {
          const existing = listeners.get(type) ?? [];
          existing.push(listener);
          listeners.set(type, existing);
        },
        emit(type) {
          for (const listener of listeners.get(type) ?? []) listener();
        },
      });
    }

    const preference = events({ matches: reduced });
    preference.change = (next) => {
      preference.matches = next;
      preference.emit("change");
    };

    const target = {};
    const revealed = [];
    const section = { classList: { add(name) { revealed.push(name); } } };
    const video = events({
      controls: true,
      muted: false,
      loop: true,
      paused: true,
      ended: false,
      playCalls: 0,
      pauseCalls: 0,
      closest(selector) { return selector === ".output-piece--video" ? target : null; },
      play() {
        video.playCalls += 1;
        if (blocked) return Promise.reject(new Error("Playback was blocked."));
        video.paused = false;
        video.emit("play");
        return Promise.resolve();
      },
      pause() {
        if (video.paused) return;
        video.pauseCalls += 1;
        video.paused = true;
        video.emit("pause");
      },
    });
    const attributes = new Map([["aria-pressed", "false"], ["aria-label", "Play video"]]);
    const toggle = events({
      hidden: true,
      dataset: { copyAria: "videoPlayLabel" },
      setAttribute(name, value) { attributes.set(name, value); },
    });
    const document = events({
      hidden: false,
      querySelector(selector) {
        if (selector === "[data-marketing-video]") return video;
        if (selector === "[data-marketing-video-toggle]") return toggle;
        return null;
      },
      querySelectorAll(selector) { return selector === "[data-reveal]" ? [section] : []; },
    });
    const observers = [];
    class Observer {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.observed = [];
        this.unobserved = [];
        observers.push(this);
      }
      observe(element) { this.observed.push(element); }
      unobserve(element) { this.unobserved.push(element); }
      intersect(element, ratio) {
        this.callback([{ target: element, isIntersecting: ratio > 0, intersectionRatio: ratio }]);
      }
    }

    const window = { matchMedia() { return preference; } };
    if (supported) window.IntersectionObserver = Observer;
    runInNewContext(behavior, {
      document,
      window,
      IntersectionObserver: Observer,
      messages: { videoPlayLabel: "Play video", videoPauseLabel: "Pause video" },
    });
    return { preference, target, section, revealed, video, toggle, attributes, document, observer: observers[0] };
  }

  const normal = harness();
  assert.equal(normal.video.controls, false, "Native controls disappear only after enhancement.");
  assert.equal(normal.toggle.hidden, false, "The custom control becomes available after enhancement.");
  assert.ok(normal.observer.observed.includes(normal.target), "Observe the video card itself.");
  assert.ok(normal.observer.observed.includes(normal.section), "Keep the existing section reveal behavior.");

  normal.observer.intersect(normal.target, .2);
  assert.equal(normal.video.playCalls, 0, "A barely visible card must not start playback.");
  normal.observer.intersect(normal.target, .5);
  assert.equal(normal.video.playCalls, 1, "A meaningfully visible card starts playback.");
  assert.equal(normal.video.muted, true);
  assert.equal(normal.video.loop, true);
  assert.equal(normal.toggle.dataset.copyAria, "videoPauseLabel");
  assert.equal(normal.attributes.get("aria-label"), "Pause video");
  assert.equal(normal.attributes.get("aria-pressed"), "true");

  normal.observer.intersect(normal.section, .1);
  assert.deepEqual(normal.revealed, ["marketing-visible"]);
  assert.ok(normal.observer.unobserved.includes(normal.section));
  normal.observer.intersect(normal.target, .1);
  assert.equal(normal.video.pauseCalls, 1, "Offscreen playback pauses.");
  assert.equal(normal.toggle.dataset.copyAria, "videoPlayLabel");
  normal.observer.intersect(normal.target, .65);
  assert.equal(normal.video.playCalls, 2, "Automatically paused playback resumes when visible.");

  normal.toggle.emit("click");
  assert.equal(normal.video.pauseCalls, 2, "The centered button pauses a playing scene.");
  normal.observer.intersect(normal.target, 0);
  normal.observer.intersect(normal.target, .8);
  assert.equal(normal.video.playCalls, 2, "Explicit visitor pauses remain authoritative.");
  normal.toggle.emit("click");
  assert.equal(normal.video.playCalls, 3, "The centered button explicitly resumes playback.");

  normal.document.hidden = true;
  normal.document.emit("visibilitychange");
  assert.equal(normal.video.pauseCalls, 3, "A backgrounded tab pauses playback.");
  normal.document.hidden = false;
  normal.document.emit("visibilitychange");
  assert.equal(normal.video.playCalls, 4, "A visible foregrounded card resumes playback.");

  normal.preference.change(true);
  assert.equal(normal.video.loop, false, "Reduced motion disables looping.");
  assert.equal(normal.video.pauseCalls, 4, "Enabling reduced motion stops automatic playback.");
  normal.observer.intersect(normal.target, .8);
  assert.equal(normal.video.playCalls, 4, "Reduced motion never starts automatic playback.");
  normal.toggle.emit("click");
  assert.equal(normal.video.playCalls, 5, "Reduced-motion visitors may deliberately play once.");

  const reduced = harness({ reduced: true });
  assert.equal(reduced.video.loop, false);
  reduced.observer.intersect(reduced.target, .8);
  assert.equal(reduced.video.playCalls, 0);
  reduced.toggle.emit("click");
  assert.equal(reduced.video.playCalls, 1, "Manual playback remains available with reduced motion.");

  const unsupported = harness({ supported: false });
  assert.equal(unsupported.video.controls, false);
  assert.equal(unsupported.toggle.hidden, false);
  assert.equal(unsupported.observer, undefined);
  unsupported.toggle.emit("click");
  assert.equal(unsupported.video.playCalls, 1, "Custom manual controls work without IntersectionObserver.");

  const denied = harness({ blocked: true });
  denied.observer.intersect(denied.target, .8);
  await Promise.resolve();
  assert.equal(denied.video.playCalls, 1);
  assert.equal(denied.attributes.get("aria-label"), "Play video", "Blocked autoplay preserves the visible action.");
});

test("four creative decisions each inspect their own context-faithful image study", async () => {
  const [html, enhancement, styles] = await Promise.all([
    source("marketing.html"),
    source("src/marketing/main.ts"),
    source("src/marketing/marketing.css"),
  ]);
  const donors = [...html.matchAll(/<picture\b[^>]*\bdata-context-study="(portrait|landscape|detail|twilight)"[^>]*>([\s\S]*?)<\/picture>/g)];

  assert.equal(donors.length, 4, "Each creative decision must use its own actual campaign study.");
  assert.deepEqual(new Set(donors.map(([, family]) => family)), new Set(["portrait", "landscape", "detail", "twilight"]));
  for (const [picture, family] of donors) {
    assert.match(picture, new RegExp(`quiet-coast-${family}-`), `${family} must use its genuine campaign image.`);
    assert.match(picture, /<source\b[^>]*type="image\/avif"/);
    assert.match(picture, /<source\b[^>]*type="image\/webp"/);
    assert.match(picture, /<img\b[^>]*alt=""/);
  }

  assert.match(html, /data-context-decision="mood"[^>]*aria-hidden="true"/);
  assert.match(html, /data-context-study="landscape" data-context-study-target/);
  assert.match(html, /data-copy="demoStudyEyebrow">Existing studies · one direction<\/p>/);
  assert.match(html, /data-context-focus-label data-copy="moodLabel">Mood<\/strong>/);
  assert.match(html, /data-context-focus-value data-copy="moodValue">Quietly magnetic<\/span>/);
  assert.match(html, /Choose what to notice\. Every decision stays in the picture\./);
  assert.match(html, /Choose which creative decision to notice in the existing studies/);

  for (const [decision, family, label, value] of [
    ["mood", "landscape", "moodLabel", "moodValue"],
    ["audience", "portrait", "audienceLabel", "audienceValue"],
    ["boundary", "detail", "creativeBoundaryLabel", "creativeBoundaryValue"],
    ["source", "twilight", "referenceLabel", "referenceValue"],
  ]) {
    assert.match(enhancement, new RegExp(`${decision}:\\s*\\{\\s*family:\\s*"${family}",\\s*label:\\s*"${label}",\\s*value:\\s*"${value}"`));
  }

  assert.match(enhancement, /#studies\s*=\s*new Map/);
  assert.match(enhancement, /source\.setAttribute\("srcset",\s*study\.sources\.get/);
  assert.match(enhancement, /Object\.entries\(study\.image\)/);
  assert.match(enhancement, /picture\.dataset\.contextStudy\s*=\s*family/);
  assert.match(enhancement, /focusLabel\.dataset\.copy\s*=\s*focus\.label/);
  assert.match(enhancement, /focusValue\.dataset\.copy\s*=\s*focus\.value/);
  assert.match(enhancement, /stage\.dataset\.contextDecision\s*=\s*decision/);
  assert.doesNotMatch(enhancement, /fetch\(|navigator\.sendBeacon|\/api\/media|\/api\/session/);
  assert.match(styles, /\[data-context-decision="audience"\][^{]*\{[^}]*object-position:\s*50%\s+74%/);
  assert.match(styles, /\[data-context-decision="boundary"\][^{]*\{[^}]*object-position:\s*25%\s+50%/);
  assert.match(styles, /\[data-context-decision="source"\][^{]*\{[^}]*object-position:\s*50%\s+38%[^}]*transform:\s*none/);
  assert.match(styles, /\.coast-art__moon\s*\{[^}]*inline-size:\s*3%[^}]*background:\s*transparent[^}]*box-shadow:\s*inset/s);
  assert.doesNotMatch(styles, /\.coast-art__moon\s*\{[^}]*radial-gradient/);
  assert.match(html, /data-context-study="twilight"[\s\S]*?quiet-coast-twilight-480[\s\S]*?quiet-coast-twilight-768[\s\S]*?quiet-coast-twilight-1200/);
  assert.match(html, /output-frames__image--landscape" data-context-study="twilight"[\s\S]*?quiet-coast-twilight[\s\S]*?output-frames__image--portrait[\s\S]*?quiet-coast-portrait[\s\S]*?output-frames__image--detail[\s\S]*?quiet-coast-detail/);
  assert.match(styles, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.context-outcome__art \.coast-art__generated > img\s*\{\s*transition:/);
});

test("public marketing requests bypass accounts, databases, and application bootstrap", async () => {
  const worker = (await import("../dist/server/index.js")).default;
  const accesses = [];
  const environment = {
    get DB() { throw new Error("The public marketing route touched private database state."); },
    get MEDIA() { throw new Error("The public marketing route touched private media."); },
    ASSETS: {
      async fetch(request) {
        accesses.push({ method: request.method, pathname: new URL(request.url).pathname });
        return new Response(request.method === "HEAD" ? null : "<h1>Public Forma introduction</h1>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  };
  const context = { waitUntil() { throw new Error("The public marketing route scheduled account work."); } };

  for (const pathname of ["/", "/welcome", "/welcome/"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await worker.fetch(new Request(`https://forma.example${pathname}`, {
        method,
        headers: { cookie: "forma_project_context=private-project" },
      }), environment, context);
      assert.equal(response.status, 200, `${method} ${pathname}`);
      assert.equal(response.headers.get("x-forma-route-family"), "marketing");
      assert.match(response.headers.get("cache-control") || "", /^public/);
      assert.equal(response.headers.get("location"), null);
      if (method === "HEAD") assert.equal(await response.text(), "");
    }
  }

  assert.equal(accesses.length, 6);
  assert.deepEqual(new Set(accesses.map(({ pathname }) => pathname)), new Set(["/marketing"]));

  const unsupported = await worker.fetch(new Request("https://forma.example/", { method: "POST" }), environment, context);
  assert.equal(unsupported.status, 405);
});

test("Arabic and Japanese marketing typography preserves canonical script leading without Latin brand regression", async () => {
  const styles = await source("src/marketing/marketing.css");
  const script = (locale) => styles.match(new RegExp(`html:lang\\(${locale}\\)\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  assert.match(script("ar"), /--marketing-heading-letter-spacing:\s*0\s*;/);
  assert.match(script("ar"), /--marketing-heading-line-height:\s*1\.4\s*;/);
  assert.match(script("ar"), /--marketing-body-line-height:\s*1\.7\s*;/);
  assert.match(script("ja"), /--marketing-heading-letter-spacing:\s*0\s*;/);
  assert.match(script("ja"), /--marketing-heading-line-height:\s*1\.35\s*;/);
  assert.match(script("ja"), /--marketing-body-line-height:\s*1\.8\s*;/);
  assert.match(styles, /body\s*\{[^}]*line-height:\s*var\(--marketing-body-line-height,\s*1\.6\)/s);
  assert.match(styles, /\.marketing-brand\s*\{[^}]*letter-spacing:\s*-\.065em/s);
  assert.match(styles, /\.marketing-hero h1\s*\{[^}]*letter-spacing:\s*-\.04em[^}]*line-height:\s*\.98[^}]*text-wrap:\s*balance/s);
  assert.match(styles, /\.marketing-section__heading h2,\s*\.marketing-finale h2\s*\{[^}]*letter-spacing:\s*-\.04em[^}]*text-wrap:\s*balance/s);
  assert.doesNotMatch(styles, /html:lang\((?:en|fr)\)\s*\{[^}]*--marketing-(?:heading|body)/);

  for (const locale of ["ar", "ja"]) {
    for (const selector of [
      ".marketing-hero h1", ".marketing-section__heading h2", ".marketing-finale h2",
      ".context-demo__project h3", ".output-piece__caption h3", ".output-slide > strong",
      ".process-list h3", ".team-principles h3", ".output-paper > p", ".output-piece__caption p",
      ".context-demo__disclaimer", ".marketing-trust__disclosure", ".team-principles p",
    ]) {
      assert.ok(styles.includes(`html:lang(${locale}) ${selector}`), `${locale} must cover ${selector}`);
    }
  }

  const heading = styles.match(/html:lang\(ar\) \.marketing-hero h1,[\s\S]*?html:lang\(ja\) \.team-principles h3\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(heading, /letter-spacing:\s*var\(--marketing-heading-letter-spacing\)/);
  assert.match(heading, /line-height:\s*var\(--marketing-heading-line-height\)/);
  const authored = styles.match(/html:lang\(ar\) \.output-paper > p,[\s\S]*?html:lang\(ja\) \.team-principles p\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(authored, /letter-spacing:\s*0\s*;/);
  assert.match(authored, /line-height:\s*var\(--marketing-body-line-height\)/);
});

test("the public introduction preserves the existing private root and document route contracts", () => {
  assert.equal(applicationIdFromRoute("/"), "creative");
  assert.equal(resolveServerRoute("/")?.entryPath, "/");
  assert.equal(resolveServerRoute("/document/document-42/quiet-coast")?.entryPath, "/");
  assert.equal(resolveServerRoute("/projects")?.entryPath, "/projects/");
  assert.equal(resolveServerRoute("/canvas")?.entryPath, "/canvas/");
  assert.equal(resolveServerRoute("/share/approved-review")?.entryPath, "/share/");
  assert.equal(resolveServerRoute("/welcome"), null);
});

test("all four marketing catalogs completely translate markup, metadata, decisions, and live announcements", async () => {
  const html = await source("marketing.html");
  const expected = (await import("../src/marketing/locales/en.ts")).default;
  const keys = Object.keys(expected).sort();
  const markup = [...html.matchAll(/\bdata-copy(?:-aria)?="([^"]+)"/g)].map((match) => match[1]);
  const required = [
    ...markup,
    "pageTitle", "pageDescription", "socialTitle", "socialDescription",
    "languageLabel", "languageChangeError", "languageChanged", "videoPlayLabel", "videoPauseLabel",
    ...["Mood", "Audience", "Boundary", "Source"].flatMap((decision) => [
      `demoImage${decision}`, `demoStory${decision}`, `demoAnnouncement${decision}`,
    ]),
  ];

  for (const locale of ["en", "fr", "ar", "ja"]) {
    const catalog = (await import(`../src/marketing/locales/${locale}.ts`)).default;
    assert.deepEqual(Object.keys(catalog).sort(), keys, `${locale} catalog parity`);
    for (const key of new Set(required)) {
      assert.ok(Object.hasOwn(catalog, key), `${locale} catalog is missing ${key}`);
      assert.equal(typeof catalog[key], "string", `${locale}.${key} must be a string`);
      assert.ok(catalog[key].trim(), `${locale}.${key} must not be empty`);
    }
    assert.equal(catalog.projectName, "The Quiet Coast", `${locale} must preserve the authored project name`);
    assert.match(catalog.languageChanged, /\{language\}/, `${locale} must preserve the language announcement placeholder`);
    if (locale !== "en") {
      for (const key of ["heroTitle", "openForma", "demoDisclaimer", "trustDisclosure", "pageTitle", "pageDescription", "socialTitle", "socialDescription"]) {
        assert.notEqual(catalog[key], expected[key], `${locale}.${key} cannot fall back to English`);
      }
    }
  }
});

test("localized marketing routes are translated before JavaScript and never touch private state", async () => {
  const worker = (await import("../dist/server/index.js")).default;
  const original = await source("dist/client/marketing.html");
  const accessed = [];
  const environment = {
    get DB() { throw new Error("A public language route touched the private database."); },
    get MEDIA() { throw new Error("A public language route touched private media."); },
    ASSETS: {
      async fetch(request) {
        accessed.push(new URL(request.url).pathname);
        return new Response(request.method === "HEAD" ? null : original, {
          headers: { "content-type": "text/html; charset=utf-8", "content-length": String(Buffer.byteLength(original)), etag: "base-English-document" },
        });
      },
    },
  };
  const context = { waitUntil() { throw new Error("A public language route scheduled private work."); } };
  const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

  for (const locale of ["en", "fr", "ar", "ja"]) {
    const catalog = (await import(`../src/marketing/locales/${locale}.ts`)).default;
    const response = await worker.fetch(new Request(`https://forma.example/welcome/${locale}`, {
      headers: { "accept-language": "de-DE, en;q=0.9", cookie: "forma_project_context=private-project" },
    }), environment, context);
    const body = await response.text();
    assert.ok(body.includes('aria-label="' + escape(catalog.individualVideoScene) + '"'), locale + " localized video description");
    assert.ok(body.includes('aria-label="' + escape(catalog.videoPlayLabel) + '" data-copy-aria="videoPlayLabel"'), locale + " localized playback action");
    assert.equal(response.status, 200, locale);
    assert.equal(response.headers.get("x-forma-route-family"), "marketing", locale);
    assert.equal(response.headers.get("content-language"), locale, locale);
    assert.equal(response.headers.get("etag"), null, locale);
    assert.equal(response.headers.get("content-length"), null, locale);
    assert.match(body, new RegExp(`<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">`), locale);
    assert.ok(body.includes(`<title>${escape(catalog.pageTitle)}</title>`), `${locale} localized title`);
    assert.ok(body.includes(`name="description" content="${escape(catalog.pageDescription)}"`), `${locale} localized description`);
    assert.ok(body.includes(`property="og:title" content="${escape(catalog.socialTitle)}"`), `${locale} localized Open Graph title`);
    assert.ok(body.includes(`name="twitter:description" content="${escape(catalog.socialDescription)}"`), `${locale} localized X description`);
    assert.ok(body.includes(`rel="canonical" href="/welcome/${locale}"`), `${locale} canonical route`);
    for (const key of ["heroTitle", "openForma", "demoDisclaimer", "demoStudyEyebrow", "demoHelper", "trustDisclosure", "demoImageMood", "demoStoryMood"]) {
      assert.ok(body.includes(escape(catalog[key])), `${locale} server-rendered ${key}`);
    }
    assert.ok(body.includes(`aria-label="${escape(catalog.navigationLabel)}"`), `${locale} localized accessible navigation`);
    assert.ok(body.includes(`aria-label="${escape(catalog.contextChoicesLabel)}"`), `${locale} localized decision-group guidance`);
    if (locale !== "en") assert.doesNotMatch(body, /Give your ideas a world to live in\./, `${locale} must not leak the English headline`);

    const head = await worker.fetch(new Request(`https://forma.example/welcome/${locale}/`, { method: "HEAD" }), environment, context);
    assert.equal(head.status, 200, `${locale} HEAD`);
    assert.equal(head.headers.get("content-language"), locale, `${locale} HEAD language`);
    assert.equal(head.headers.get("etag"), null, `${locale} HEAD must not advertise the untranslated asset validator`);
    assert.equal(head.headers.get("content-length"), null, `${locale} HEAD must not advertise the untranslated asset length`);
    assert.equal(await head.text(), "", `${locale} HEAD body`);
  }

  const negotiated = await worker.fetch(new Request("https://forma.example/welcome", {
    headers: { "accept-language": "de-DE, fr-CA;q=0.8, en;q=0.2" },
  }), environment, context);
  assert.equal(negotiated.headers.get("content-language"), "fr");
  assert.match(negotiated.headers.get("vary") ?? "", /accept-language/i);
  assert.match(await negotiated.text(), /<html lang="fr" dir="ltr">/);

  const unsupported = await worker.fetch(new Request("https://forma.example/welcome/de"), environment, context);
  assert.equal(unsupported.status, 404);
  assert.equal(accessed.length, 9);
  assert.deepEqual(new Set(accessed), new Set(["/marketing"]));
});

test("production marketing assets stay isolated from authenticated application entries", async () => {
  const [publicHtml, originalRoot, manifestSource] = await Promise.all([
    source("dist/client/marketing.html"),
    source("dist/client/index.html"),
    source("dist/client/.vite/manifest.json"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const entry = manifest["marketing.html"] ?? Object.values(manifest).find((candidate) => candidate.src === "marketing.html");

  assert.ok(entry?.file, "A dedicated public marketing production entry must exist.");
  assert.match(publicHtml, /Give your ideas a world to live in/);
  assert.doesNotMatch(publicHtml, /forma-shell|forma-static-session-prefetch|\/api\/session|protected-assets/);
  assert.match(originalRoot, /<title>Create — Forma<\/title>/);
  assert.match(originalRoot, /<forma-shell><\/forma-shell>/);
  assert.match(originalRoot, /forma-static-session-prefetch/);

  const script = await source(`dist/client/${entry.file}`);
  const scriptGzip = gzipSync(script).length;
  assert.ok(scriptGzip < 35_000, `Marketing JavaScript is ${scriptGzip} bytes gzip.`);
  assert.doesNotMatch(script, /FormaStore|api\/session|protected-assets/);

  const styles = entry.css ?? [];
  assert.ok(styles.length, "The marketing route must own its production stylesheet.");
  for (const stylesheet of styles) {
    const css = await source(`dist/client/${stylesheet}`);
    const cssGzip = gzipSync(css).length;
    assert.ok(cssGzip < 20_000, `Marketing CSS is ${cssGzip} bytes gzip.`);
    assert.doesNotMatch(css, /fonts\.googleapis\.com/);
  }

  for (const locale of ["fr", "ar", "ja"]) {
    const item = manifest[`src/marketing/locales/${locale}.ts`];
    assert.ok(item?.file, `${locale} catalog must be a separately loaded public chunk`);
    assert.ok((entry.dynamicImports ?? []).includes(`src/marketing/locales/${locale}.ts`), `${locale} must load on demand`);
    const catalog = await source(`dist/client/${item.file}`);
    assert.ok(gzipSync(catalog).length < 15_000, `${locale} locale chunk exceeds 15 KB gzip.`);
    assert.doesNotMatch(catalog, /FormaStore|api\/session|protected-assets/);
  }

  const video = publicHtml.match(/\/assets\/marketing\/quiet-coast-scene-4s\.([a-f0-9]{12})\.mp4/);
  const poster = publicHtml.match(/\/assets\/marketing\/quiet-coast-scene-poster-960\.([a-f0-9]{12})\.jpg/);
  assert.ok(video, "Production marketing must include the genuine Forma-generated video.");
  assert.ok(poster, "Production marketing must include the genuine first-frame poster.");
  assert.match(publicHtml, /\bdata-marketing-video-toggle\b/);
  for (const [asset, budget] of [[video, 350_000], [poster, 30_000]]) {
    const bytes = await readFile(new URL("../dist/client" + asset[0], import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0, 12), asset[1]);
    assert.ok(bytes.length < budget, "Production video asset exceeds its transfer budget.");
  }

  const campaignAssets = [...new Set([...publicHtml.matchAll(/\/assets\/marketing\/quiet-coast-[\w.-]+\.(?:avif|webp)/g)].map(([path]) => path))];
  assert.ok(campaignAssets.length >= 24, "Built marketing document must retain all four corrected campaign studies.");
  for (const fingerprint of supersededCampaignFingerprints) {
    assert.ok(!publicHtml.includes(fingerprint), "An obsolete full-moon campaign image remains in production.");
  }
  for (const path of campaignAssets) {
    const bytes = await readFile(new URL(`../dist/client${path}`, import.meta.url));
    assert.ok(bytes.length < 90_000, `Built campaign asset exceeds the transfer budget: ${path}`);
  }
});
