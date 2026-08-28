import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
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
  for (const format of ["Image", "Story", "Scene", "Presentation", "Storyboard", "Video scenes", "Audio"]) {
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

  const videoPath = contents.match(/\bsrc="(\/assets\/marketing\/quiet-coast-scene-8s\.([a-f0-9]{12})\.mp4)"\s+type="video\/mp4"/);
  const posterPath = video.match(/\bposter="(\/assets\/marketing\/quiet-coast-scene-poster-960\.([a-f0-9]{12})\.jpg)"/);
  assert.ok(videoPath, "The public MP4 must have an immutable content fingerprint.");
  assert.ok(posterPath, "The genuine cottage-frame video poster must have an immutable content fingerprint.");
  for (const [match, budget] of [[videoPath, 950_000], [posterPath, 45_000]]) {
    const bytes = await readFile(new URL("../public" + match[1], import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0, 12), match[2]);
    assert.ok(bytes.length < budget, match[1] + " exceeds its transfer budget.");
    if (match === videoPath) assert.equal(bytes.subarray(4, 8).toString(), "ftyp");
    else assert.equal(bytes.subarray(0, 2).toString("hex"), "ffd8");
  }

  const inspection = spawnSync("ffprobe", [
    "-v", "error", "-show_entries",
    "stream=codec_name,codec_type,width,height,r_frame_rate:format=duration",
    "-of", "json", fileURLToPath(new URL("../public" + videoPath[1], import.meta.url)),
  ], { encoding: "utf8" });
  assert.equal(inspection.status, 0, inspection.stderr);
  const generatedScene = JSON.parse(inspection.stdout);
  assert.equal(generatedScene.streams.length, 1, "The Quiet Coast scene must stay genuinely silent.");
  assert.equal(generatedScene.streams[0].codec_type, "video");
  assert.equal(generatedScene.streams[0].codec_name, "h264");
  assert.equal(generatedScene.streams[0].width, 1280);
  assert.equal(generatedScene.streams[0].height, 720);
  assert.equal(generatedScene.streams[0].r_frame_rate, "24/1");
  assert.ok(Math.abs(Number(generatedScene.format.duration) - 8) < .15,
    "The Quiet Coast scene must genuinely contain eight seconds.");

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

test("the coherent campaign stays discoverable, touch-safe, and truthful across device postures", async () => {
  const [html, enhancement, styles, pickerStyles] = await Promise.all([
    source("marketing.html"),
    source("src/marketing/main.ts"),
    source("src/marketing/marketing.css"),
    source("src/components/design-system/language-picker.css"),
  ]);

  assert.match(html, /class="marketing-text-link" href="#idea-takes-shape"/);
  assert.match(html, /class="marketing-section marketing-proof" id="idea-takes-shape"/);
  assert.match(html, /class="marketing-navigation__motion" href="#motion-study"/);
  assert.match(html, /class="marketing-button marketing-exhibit__action" href="\/projects" data-copy="openForma"/);

  const poster = html.match(/<video[^>]*poster="([^"]+)"/)?.[1];
  assert.equal(poster, "/assets/marketing/quiet-coast-scene-poster-960.af29b34d50f0.jpg");
  assert.match(html, new RegExp(`proof-artifact--motion"[^>]*>[\\s\\S]*?<img src="${poster.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));

  assert.match(enhancement, /from "\.\.\/components\/design-system\/language-options"/);
  assert.match(enhancement, /import "\.\.\/components\/design-system\/language-picker"/);
  assert.match(enhancement, /document\.createElement\("forma-ui-language-picker"\)/);
  assert.match(enhancement, /languagePicker\.label\s*=\s*messages\.languageLabel/);
  assert.match(html, /<button type="button" class="marketing-language__trigger" popovertarget="marketing-language-menu"/);
  assert.match(html, /<nav id="marketing-language-menu" popover="auto"[^>]*>[\s\S]*?href="\/welcome\/ar"/);
  assert.match(pickerStyles, /min-block-size:\s*var\(--forma-control-min-size,\s*2\.75rem\)/);

  assert.match(styles, /--marketing-line-strong:\s*light-dark\(#8a8a84,\s*#777873\)/);
  assert.match(styles, /--forma-color-border-strong:\s*var\(--marketing-line-strong\)/);
  assert.match(styles, /\.marketing-navigation a\s*\{[^}]*min-inline-size:\s*2\.75rem[^}]*min-block-size:\s*2\.75rem/s);
  assert.match(styles, /\.proof-artifact--image\s*>\s*figcaption\s*\{[^}]*inset-block-start:[^}]*inset-inline-start:[^}]*background:/s);
  assert.match(styles, /\.proof-artifact--motion\s*>\s*span\s*\{[^}]*font-size:\s*\.75rem/s);
  assert.match(styles, /env\(safe-area-inset-left,\s*0px\)/);
  assert.match(styles, /env\(safe-area-inset-right,\s*0px\)/);
  assert.match(styles, /env\(safe-area-inset-bottom,\s*0px\)/);
  assert.match(styles, /@media \(min-width:\s*761px\) and \(max-height:\s*820px\)/);
  assert.match(styles, /@media \(min-width:\s*761px\) and \(max-width:\s*960px\)/);
  assert.match(styles, /@media \(max-width:\s*600px\)/);
  assert.match(styles, /@media \(min-width:\s*560px\) and \(max-height:\s*480px\)/);
  assert.match(styles, /\.output-gallery\s*\{[^}]*grid-auto-flow:\s*dense/s);
  assert.match(styles, /\.marketing-formats\s*>\s*p\s*\{[^}]*min-inline-size:\s*0[^}]*max-inline-size:\s*100%[^}]*flex:\s*1\s+1\s+100%/s);
  assert.match(styles, /\.context-demo__choices\s*\{[^}]*grid-auto-flow:\s*column[^}]*scroll-snap-type:\s*inline mandatory/s);
  assert.match(styles, /\.proof-world__canvas\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
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

    const target = { classes: [], classList: { add(name) { target.classes.push(name); } } };
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
  assert.ok(normal.target.classes.includes("marketing-visible"), "The featured video itself receives its intended entrance choreography.");
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

  const preview = harness();
  preview.observer.intersect(preview.target, .8);
  assert.equal(preview.video.playCalls, 1);
  preview.document.emit("forma-marketing-preview-open");
  assert.equal(preview.video.pauseCalls, 1, "An open full-length preview pauses the underlying video.");
  preview.observer.intersect(preview.target, .9);
  assert.equal(preview.video.playCalls, 1, "Background playback stays paused while a preview is open.");
  preview.document.emit("forma-marketing-preview-close");
  assert.equal(preview.video.playCalls, 2, "A previously playing video resumes after its preview closes.");
  preview.toggle.emit("click");
  preview.document.emit("forma-marketing-preview-open");
  preview.document.emit("forma-marketing-preview-close");
  assert.equal(preview.video.playCalls, 2, "Closing a preview never overrides a visitor's explicit pause.");

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

test("continuous ambient page motion is optional, localized, and completely pausable", async () => {
  const enhancement = await source("src/marketing/main.ts");
  const beginning = enhancement.indexOf('const ambientPreference = window.matchMedia("(prefers-reduced-motion: reduce)");');
  const ending = enhancement.indexOf('const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");');
  assert.ok(beginning >= 0 && ending > beginning, "Ambient motion should remain isolated from video playback.");
  const behavior = stripTypeScriptTypes(enhancement.slice(beginning, ending));
  const listeners = new Map();
  const preference = { matches: false, addEventListener(type, listener) { listeners.set(`preference:${type}`, listener); } };
  const attributes = new Map();
  const toggle = { hidden: true, dataset: {}, setAttribute(name, value) { attributes.set(name, value); }, addEventListener(type, listener) { listeners.set(`toggle:${type}`, listener); } };
  const document = { documentElement: { dataset: {} }, querySelector(selector) { return selector === "[data-marketing-motion-toggle]" ? toggle : null; }, addEventListener(type, listener) { listeners.set(`document:${type}`, listener); } };
  const messages = { motionPauseLabel: "Pause page motion", motionResumeLabel: "Resume page motion" };
  runInNewContext(behavior, { document, window: { matchMedia() { return preference; } }, messages });
  assert.equal(document.documentElement.dataset.marketingMotion, "on");
  assert.equal(toggle.hidden, false);
  assert.equal(attributes.get("aria-label"), "Pause page motion");
  listeners.get("toggle:click")();
  assert.equal(document.documentElement.dataset.marketingMotion, "off");
  assert.equal(attributes.get("aria-pressed"), "true");
  assert.equal(attributes.get("aria-label"), "Resume page motion");
  messages.motionResumeLabel = "Reprendre les animations de la page";
  listeners.get("document:forma-locale-change")();
  assert.equal(attributes.get("aria-label"), messages.motionResumeLabel);
  preference.matches = true;
  listeners.get("preference:change")();
  assert.equal(toggle.hidden, true);
  assert.equal(document.documentElement.dataset.marketingMotion, "off");
});

test("one authored coastal world is visually carried through a kinetic, truthful seven-format premiere", async () => {
  const [html, enhancement, styles] = await Promise.all([
    source("marketing.html"),
    source("src/marketing/main.ts"),
    source("src/marketing/marketing.css"),
  ]);
  assert.ok([...html.matchAll(/<img\b/g)].length >= 24, "The landing should demonstrate its creative world with actual reusable image assets.");
  assert.match(html, /class="hero-artifact hero-artifact--landscape"/);
  assert.match(html, /class="hero-artifact hero-artifact--detail"/);
  assert.match(html, /class="hero-artifact hero-artifact--story"/);
  assert.match(html, /class="marketing-section marketing-proof"/);
  assert.equal([...html.matchAll(/class="proof-world__decision"/g)].length, 4, "Four concrete authored decisions must visibly govern the example.");
  for (const format of ["image", "story", "scene", "slide", "frames", "motion"]) assert.match(html, new RegExp(`proof-artifact--${format}`), format);
  assert.match(html, /href="#motion-study"/);
  assert.match(html, /class="output-piece output-piece--video" id="motion-study"/);
  assert.match(html, /<div class="output-gallery"[^>]*>\s*<article class="output-piece output-piece--video"/);
  assert.match(html, /data-copy="proofVideoBadge">Original generated video study/);
  assert.match(html, /data-copy="proofImageBadge">Original generated image study/);
  assert.equal([...html.matchAll(/class="output-frame"/g)].length, 3);
  for (const frame of ["01", "02", "03"]) assert.match(html, new RegExp(`<span dir="ltr">${frame}</span>`));
  assert.ok([...html.matchAll(/data-context-preview=/g)].length >= 4, "A chosen decision must affect multiple kinds of existing output.");
  assert.ok([...html.matchAll(/data-context-carried/g)].length >= 2);
  assert.match(enhancement, /carried\.dataset\.copy\s*=\s*focus\.value/);
  assert.match(enhancement, /carried\.textContent\s*=\s*messages\[focus\.value\]/);
  assert.match(html, /class="team-canvas__workflow"/);
  assert.doesNotMatch(html, /She arrived|She had come|last ferry/i);
  assert.match(styles, /\.output-gallery\s*\{[^}]*grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /\.output-piece--video\s*\{\s*grid-column:\s*span 7/);
  assert.match(styles, /@keyframes marketing-scene-enter/);
  assert.match(styles, /@keyframes marketing-piece-enter/);
  assert.match(styles, /@keyframes marketing-drift/);
  assert.match(styles, /html\[data-marketing-motion="on"\][^{]*\{[^}]*\binfinite\b/s);
  assert.match(html, /data-marketing-motion-toggle hidden/);
  assert.match(styles, /html\[dir="rtl"\]\s*\{\s*--marketing-flow:\s*-1/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?animation:\s*none\s*!important;\s*transition:\s*none\s*!important/);
});

test("original music is a truthful seventh private-by-default format without invented recording or playback", async () => {
  const [html, styles, english] = await Promise.all([
    source("marketing.html"),
    source("src/marketing/marketing.css"),
    import("../src/marketing/locales/en.ts").then((catalog) => catalog.default),
  ]);
  const formats = html.match(/<section class="marketing-formats"[\s\S]*?<\/section>/)?.[0] ?? "";
  const cards = [...html.matchAll(/<article class="output-piece output-piece--([a-z]+)"/g)].map(([, format]) => format);
  const audio = html.match(/<article class="output-piece output-piece--audio"[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? "";

  assert.equal([...formats.matchAll(/<li\b/g)].length, 7, "The public format rail must contain every supported output exactly once.");
  for (const key of ["formatImage", "formatStory", "formatScene", "formatPresentation", "formatStoryboard", "formatVideo", "formatAudio"]) {
    assert.match(formats, new RegExp(`data-copy="${key}"`), key);
  }
  assert.deepEqual(cards, ["video", "image", "storyboard", "story", "scene", "presentation", "audio"]);
  for (const key of ["formatAudio", "audioDirectionLabel", "outputAudioTitle", "outputAudioDirection", "outputAudioDetail", "outputAudioDisclaimer"]) {
    assert.match(audio, new RegExp(`data-copy="${key}"`), `The sound-direction example needs ${key}.`);
  }
  assert.match(audio, /Illustrative score direction · no audio is playing/);
  assert.doesNotMatch(audio, /<(?:audio|button|input|progress|svg)\b|aria-(?:pressed|valuenow)|\b(?:autoplay|controls|waveform)\b|\b\d{1,2}:\d{2}\b|made in Forma/i,
    "Without a real licensed recording, the example cannot invent audio, playback, progress, waveforms, or generation provenance.");
  assert.doesNotMatch(html, /<audio\b/i, "A public audio player requires an authentic authorized audio file.");
  assert.match(html, /<video\b[^>]*\bmuted\b[^>]*\bpreload="none"/);

  assert.match(english.pageDescription, /private recordings[\s\S]*original music/i);
  assert.match(english.heroIntroduction, /private recordings[\s\S]*original music/i);
  assert.match(english.contextIntroduction, /private recording/i);
  assert.match(english.processCollectBody, /upload owned or licensed recordings privately[\s\S]*listening notes/i);
  assert.match(english.processCreateBody, /original music[\s\S]*generated tracks[\s\S]*private[\s\S]*separate soundtrack/i);
  assert.match(english.previewSlideFiveBody, /direction for an original coastal score/i);
  assert.doesNotMatch([english.exhibitTitle, english.galleryLabel, english.proofContextState].join(" "), /\bsix\b/i,
    "Format headings and gallery labels cannot continue to describe six outputs.");
  assert.match(english.audioPermissionsIntroduction, /independent[\s\S]*off by default/i);
  assert.match(english.audioPermissionInformBody, /written listening notes[\s\S]*never receive the recording/i);
  assert.match(english.audioPermissionIncludeBody, /video, storyboard, or presentation[\s\S]*separately[\s\S]*not embedded/i);
  assert.match(english.audioPermissionTransferBody, /rights-cleared[\s\S]*independently authorize[\s\S]*explicitly select[\s\S]*interpret/i);
  assert.match(english.audioPermissionsReset, /private reference[\s\S]*permissions start off again/i);
  for (const key of ["audioPermissionInformTitle", "audioPermissionInformBody", "audioPermissionIncludeTitle", "audioPermissionIncludeBody", "audioPermissionTransferTitle", "audioPermissionTransferBody"]) {
    assert.match(html, new RegExp(`data-copy="${key}"`), `The separate recording permission ${key} must be visible.`);
  }

  assert.match(styles, /\.output-piece--audio\s*\{\s*grid-column:\s*1\s*\/\s*-1/);
  assert.match(styles, /\.output-audio\s*\{[^}]*min-block-size:[^}]*aspect-ratio:\s*auto/s);
  assert.match(styles, /@media \(min-width:\s*761px\) and \(max-width:\s*1100px\)[\s\S]*?\.output-piece--audio\s*\{\s*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(styles, /@media \(max-width:\s*760px\)[\s\S]*?\.output-piece--audio\s*\{\s*grid-column:\s*auto/s);
});

test("four complete creative outputs reuse one accessible, localized public preview foundation", async () => {
  const [html, enhancement, styles] = await Promise.all([
    source("marketing.html"),
    source("src/marketing/main.ts"),
    source("src/marketing/marketing.css"),
  ]);
  const english = (await import("../src/marketing/locales/en.ts")).default;
  const pages = { story: 3, scene: 2, presentation: 5, storyboard: 6 };

  for (const [kind, count] of Object.entries(pages)) {
    assert.match(html, new RegExp(`<details class="output-preview" data-output-preview="${kind}">`), `${kind} must work without JavaScript.`);
    assert.match(html, new RegExp(`<summary[^>]+data-copy-aria="preview${kind[0].toUpperCase() + kind.slice(1)}Action"`), `${kind} needs a translated, accessible launch action.`);
    assert.equal([...html.matchAll(new RegExp(`data-preview-page="${kind}"`, "g"))].length, count, `${kind} page count`);
  }

  const story = ["One", "Two", "Three", "Four", "Five", "Six"].map((ordinal) => english[`previewStoryParagraph${ordinal}`]).join(" ");
  assert.ok(story.trim().split(/\s+/).length >= 350, "The short story must be a genuinely complete reading experience.");
  for (const ordinal of ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"]) {
    assert.match(html, new RegExp(`data-copy="previewSceneBeat${ordinal}"`), `screenplay beat ${ordinal}`);
  }
  assert.deepEqual(new Set([...html.matchAll(/data-preview-family="([^"]+)"/g)].map(([, family]) => family)), new Set(["twilight", "landscape", "portrait", "detail"]));
  assert.match(html, /Six editorial frames assembled from four existing image studies\. No new images were generated\./);
  assert.equal([...html.matchAll(/<dialog class="marketing-preview-dialog"/g)].length, 1, "All four previews must share one native dialog.");
  assert.match(html, /aria-labelledby="marketing-preview-title" closedby="any"/);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true" data-preview-status/);

  assert.match(enhancement, /import \{ ensureNativeModalDialog \} from "\.\.\/components\/design-system\/native-dialog"/);
  assert.match(enhancement, /new Intl\.NumberFormat\(document\.documentElement\.lang, \{ useGrouping: false \}\)/);
  assert.match(enhancement, /document\.documentElement\.dir === "rtl"/);
  assert.match(enhancement, /\.replaceAll\("\{current\}", current\)\.replaceAll\("\{total\}", total\)/);
  assert.match(enhancement, /this\.#details\.append\(this\.#panel\)/);
  assert.match(enhancement, /for \(const page of this\.#pages\) page\.hidden = false/);
  assert.match(enhancement, /dialog\.addEventListener\("close", \(\) => this\.#restore\(\)\)/);
  assert.match(enhancement, /this\.#invoker\?\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(enhancement, /fetch\(|navigator\.sendBeacon|\/api\/media|\/api\/session/);

  assert.match(styles, /\.hero-artifact > picture\s*\{[^}]*overflow:\s*clip[^}]*border-radius:\s*\.25rem/s);
  assert.match(styles, /\.hero-artifact > picture > img\s*\{\s*border-radius:\s*inherit/);
  assert.match(styles, /\[data-preview-page\]\[hidden\],[\s\S]*?display:\s*none\s*!important/);
  assert.match(styles, /\.marketing-preview-dialog__close,[\s\S]*?min-inline-size:\s*2\.75rem;\s*min-block-size:\s*2\.75rem/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.marketing-preview-dialog\s*\{[^}]*block-size:\s*100dvh/);
  assert.match(styles, /\.marketing-preview-dialog__header,\s*\.marketing-preview-dialog__body,\s*\.marketing-preview-dialog__footer\s*\{[^}]*padding-left:\s*max\([^}]*env\(safe-area-inset-left,\s*0px\)[^}]*padding-right:\s*max\([^}]*env\(safe-area-inset-right,\s*0px\)/s);
});

test("full public previews preserve native modal paging, locale changes, focus, and readable fallbacks", async () => {
  const enhancement = await source("src/marketing/main.ts");
  const first = enhancement.indexOf("class FormaOutputPreview {");
  const last = enhancement.indexOf("\nvoid (async () =>", first);
  assert.ok(first >= 0 && last > first, "The public preview controller must remain independently testable.");
  const behavior = stripTypeScriptTypes(enhancement.slice(first, last)) + "\nglobalThis.Preview = FormaOutputPreview;";
  const english = (await import("../src/marketing/locales/en.ts")).default;

  class Element {
    constructor(properties = {}) {
      Object.assign(this, { dataset: {}, hidden: false, disabled: false, children: [], listeners: new Map(), attributes: new Map(), focused: 0, scrollTop: 72 }, properties);
    }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); if (name === "open") this.open = false; }
    querySelector(selector) { return this.lookup?.[selector] ?? null; }
    querySelectorAll(selector) { return selector === "[data-preview-page]" ? this.pages ?? [] : []; }
    replaceChildren(...children) {
      this.children = children;
      for (const child of children) {
        if (child.parent) child.parent.children = child.parent.children.filter((sibling) => sibling !== child);
        child.parent = this;
      }
    }
    append(child) { this.children.push(child); child.parent = this; }
    focus() { this.focused += 1; }
    emit(type, properties = {}) {
      const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
      for (const listener of this.listeners.get(type) ?? []) listener(event);
      return event;
    }
  }

  function harness({ fail = false, unsupported = false } = {}) {
    const announced = [];
    const rows = Object.entries({ story: 3, scene: 2, presentation: 5, storyboard: 6 }).map(([kind, count]) => {
      const summary = new Element();
      const panel = new Element({ dataset: { previewPanel: kind }, pages: Array.from({ length: count }, () => new Element()) });
      const details = new Element({ dataset: { outputPreview: kind }, open: false, children: [summary, panel] });
      summary.parent = details;
      panel.parent = details;
      details.querySelector = (selector) => selector === "summary" ? summary : selector === "[data-preview-panel]" && panel.parent === details ? panel : null;
      return { kind, summary, panel, details };
    });
    const host = new Element();
    const heading = new Element();
    const close = new Element();
    const previous = new Element();
    const next = new Element();
    const status = new Element();
    const navigation = new Element();
    const dialog = new Element({
      id: "marketing-preview",
      open: false,
      lookup: {
        "[data-preview-host]": host,
        "#marketing-preview-title": heading,
        "[data-preview-close]": close,
        "[data-preview-previous]": previous,
        "[data-preview-next]": next,
        "[data-preview-status]": status,
        "[data-preview-navigation]": navigation,
      },
    });
    if (!unsupported) dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; dialog.emit("close"); };
    const document = new Element({ documentElement: { lang: "en", dir: "ltr", dataset: {} } });
    document.querySelectorAll = (selector) => selector === "[data-output-preview]" ? rows.map((row) => row.details) : [];
    document.dispatchEvent = (event) => { announced.push(event.type); document.emit(event.type, { detail: event.detail }); };
    const messages = { ...english };
    const context = {
      document,
      messages,
      Intl,
      CustomEvent,
      ensureNativeModalDialog(element) {
        if (fail) { element.open = true; return false; }
        element.showModal();
        return true;
      },
    };
    runInNewContext(behavior, context);
    new context.Preview(dialog);
    return { rows, host, close, previous, next, status, dialog, document, messages, announced };
  }

  const active = harness();
  const storyboard = active.rows.find(({ kind }) => kind === "storyboard");
  assert.equal(storyboard.summary.attributes.get("aria-haspopup"), "dialog");
  assert.equal(storyboard.summary.emit("click").defaultPrevented, true);
  assert.equal(active.dialog.open, true);
  assert.equal(active.document.documentElement.dataset.marketingPreview, "open");
  assert.equal(storyboard.panel.parent, active.host);
  assert.equal(storyboard.panel.pages.filter((page) => !page.hidden).length, 1);
  assert.equal(active.previous.disabled, true);
  assert.match(active.status.textContent, /Frame \u20681\u2069 of \u20686\u2069/);
  assert.equal(active.close.focused, 1);

  active.next.emit("click");
  assert.match(active.status.textContent, /\u20682\u2069/);
  active.dialog.emit("keydown", { key: "End" });
  assert.equal(active.next.disabled, true);
  active.document.documentElement.dir = "rtl";
  active.dialog.emit("keydown", { key: "ArrowRight" });
  assert.match(active.status.textContent, /\u20685\u2069/, "Arabic directional navigation must reverse correctly.");
  active.messages.previewFrameStatus = "合計{total}、現在{current}";
  active.document.documentElement.lang = "ja";
  active.document.emit("forma-locale-change");
  assert.match(active.status.textContent, /合計\u20686\u2069、現在\u20685\u2069/, "Translated placeholder order must remain authoritative.");

  active.dialog.close();
  assert.equal(storyboard.panel.parent, storyboard.details);
  assert.ok(storyboard.panel.pages.every((page) => !page.hidden));
  assert.equal(storyboard.summary.focused, 1);
  assert.equal(active.document.documentElement.dataset.marketingPreview, undefined);
  assert.deepEqual(active.announced, ["forma-marketing-preview-open", "forma-marketing-preview-close"]);

  const broken = harness({ fail: true });
  const fallback = broken.rows[0];
  fallback.summary.emit("click");
  assert.equal(broken.dialog.open, false);
  assert.equal(fallback.details.open, true, "A failed top-layer transition must leave the native disclosure readable.");
  assert.equal(fallback.panel.parent, fallback.details);
  assert.ok(fallback.panel.pages.every((page) => !page.hidden));
  assert.equal(broken.announced.length, 0);

  const unsupported = harness({ unsupported: true });
  assert.equal(unsupported.rows[0].summary.attributes.has("aria-haspopup"), false, "Legacy browsers retain an honest native disclosure.");
});

test("campaign photographs share an accessible, localized, high-resolution section-scoped fullscreen viewer", async () => {
  const [html, enhancement, styles] = await Promise.all([
    source("marketing.html"),
    source("src/marketing/main.ts"),
    source("src/marketing/marketing.css"),
  ]);
  assert.equal([...html.matchAll(/<dialog class="marketing-image-dialog"/g)].length, 1, "All landing-page studies must share one native image viewer.");
  assert.match(html, /id="marketing-image" aria-labelledby="marketing-image-title" closedby="any" data-marketing-image-dialog/);
  assert.match(html, /data-copy="imageViewerTitle">Image preview/);
  assert.match(html, /data-copy-aria="imageViewerPrevious" data-image-viewer-previous/);
  assert.match(html, /data-copy-aria="imageViewerNext" data-image-viewer-next/);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true" data-image-viewer-status/);
  assert.match(html, /<div class="marketing-image-dialog__media" data-image-viewer-media><\/div>/);
  assert.doesNotMatch(html, /\{label\}|\{current\}|\{total\}/, "Public SSR must never expose unfilled localization placeholders.");

  assert.match(enhancement, /class FormaImageViewer/);
  assert.match(enhancement, /document\.querySelectorAll<HTMLPictureElement>\("main picture"\)/);
  assert.match(enhancement, /picture\.closest\("\.output-motion--playable, a"\)/);
  assert.match(enhancement, /picture\.setAttribute\("role", "button"\)/);
  assert.match(enhancement, /picture\.tabIndex = 0/);
  assert.match(enhancement, /ancestor\.getAttribute\("aria-hidden"\) === "true"\) ancestor\.removeAttribute\("aria-hidden"\)/);
  assert.match(enhancement, /picture\.closest<HTMLElement>\("\[data-preview-panel\]"\)/);
  assert.match(enhancement, /picture\.closest<HTMLElement>\("main > section"\)/);
  assert.match(enhancement, /candidate\.closest\("\[data-preview-panel\]"\) \|\| candidate\.closest\("details:not\(\[open\]\)"\)/);
  assert.match(enhancement, /new Map<CreativeStudyFamily, HTMLPictureElement>\(\)/);
  assert.match(enhancement, /candidate === picture\) unique\.set\(family, candidate\)/);
  assert.match(enhancement, /picture\.removeAttribute\("class"\)/);
  assert.match(enhancement, /source\.setAttribute\("sizes", "100vw"\)/);
  assert.match(enhancement, /image\.alt = `\$\{messages\.projectName\} — \$\{label\}`/);
  assert.match(enhancement, /this\.#ownsPlaybackPause = !document\.querySelector<HTMLDialogElement>\("\[data-marketing-preview-dialog\]"\)\?\.open/);
  assert.match(enhancement, /document\.documentElement\.dataset\.marketingLightbox = "open"/);
  assert.match(enhancement, /messages\.imageViewerOpen\.replaceAll\("\{label\}", label\)/);
  assert.match(enhancement, /messages\.imageViewerStatus\.replaceAll\("\{current\}", current\)\.replaceAll\("\{total\}", total\)/);
  assert.doesNotMatch(enhancement, /fetch\(|navigator\.sendBeacon|\/api\/media|\/api\/session/);

  assert.match(styles, /\.marketing-image-dialog\s*\{[^}]*inline-size:\s*100vw[^}]*block-size:\s*100dvh/s);
  assert.match(styles, /\.marketing-image-dialog__media > picture > img\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(styles, /\.marketing-image-dialog__media > picture\s*\{[^}]*display:\s*block[^}]*block-size:\s*100%/s);
  assert.match(styles, /\.marketing-image-dialog__close,\s*\.marketing-image-dialog__step\s*\{[^}]*min-inline-size:\s*2\.75rem[^}]*min-block-size:\s*2\.75rem/s);
  assert.match(styles, /\.marketing-image-dialog__header\s*\{[^}]*env\(safe-area-inset-top,[^}]*env\(safe-area-inset-left,[^}]*env\(safe-area-inset-right,/s);
  assert.match(styles, /\.marketing-image-dialog__footer\s*\{[^}]*env\(safe-area-inset-bottom,[^}]*env\(safe-area-inset-left,[^}]*env\(safe-area-inset-right,/s);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.proof-artifact--frames\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(styles, /@media \(max-height: 480px\)[\s\S]*?\.marketing-image-dialog__header\s*\{[^}]*min-block-size:\s*3\.25rem/s);

  const english = (await import("../src/marketing/locales/en.ts")).default;
  for (const locale of ["en", "fr", "ar", "ja"]) {
    const catalog = (await import(`../src/marketing/locales/${locale}.ts`)).default;
    for (const key of ["imageViewerOpen", "imageViewerTitle", "imageViewerPrevious", "imageViewerNext", "imageViewerStatus"]) {
      assert.ok(catalog[key]?.trim(), `${locale}.${key} must be fully localized.`);
      if (locale !== "en") assert.notEqual(catalog[key], english[key], `${locale}.${key} must not silently fall back to English.`);
    }
    assert.match(catalog.imageViewerOpen, /\{label\}/, `${locale} image action must describe its actual study.`);
    assert.match(catalog.imageViewerStatus, /\{current\}/, `${locale} image count needs the current position.`);
    assert.match(catalog.imageViewerStatus, /\{total\}/, `${locale} image count needs the section total.`);
  }
  const japanese = (await import("../src/marketing/locales/ja.ts")).default;
  assert.ok(japanese.imageViewerStatus.indexOf("{total}") < japanese.imageViewerStatus.indexOf("{current}"));
});

test("fullscreen campaign image galleries preserve section scope, high-resolution sources, nested dialogs, and visitor intent", async () => {
  const enhancement = await source("src/marketing/main.ts");
  const first = enhancement.indexOf("class FormaImageViewer {");
  const last = enhancement.indexOf("\nvoid (async () =>", first);
  assert.ok(first >= 0 && last > first);
  const behavior = stripTypeScriptTypes(enhancement.slice(first, last)) + "\nglobalThis.Viewer = FormaImageViewer;";
  const english = (await import("../src/marketing/locales/en.ts")).default;

  class Element {
    constructor(properties = {}) { Object.assign(this, { dataset: {}, attributes: new Map(), listeners: new Map(), children: [], hidden: false, disabled: false, focused: 0, textContent: "", parentElement: null }, properties); }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    emit(type, properties = {}) { const event = { type, target: this, key: "", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties }; for (const listener of this.listeners.get(type) ?? []) listener(event); return event; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); if (name === "open") this.open = false; }
    matches(selector) { return selector === "main > section, [data-preview-panel]" && (this.isSection || this.isPanel); }
    querySelector(selector) { return this.lookup?.[selector] ?? null; }
    querySelectorAll() { return []; }
    replaceChildren(...children) { this.children = children; for (const child of children) child.parentElement = this; }
    focus() { this.focused += 1; }
  }

  class Source extends Element {
    constructor(type, candidates) { super(); this.setAttribute("type", type); this.setAttribute("srcset", candidates); }
    cloneNode() { return new Source(this.getAttribute("type"), this.getAttribute("srcset")); }
  }

  class Picture extends Element {
    constructor({ family, width = 480, rich = false, section, panel, heading, excluded = false, hidden = false, visible = true }) {
      super({ family, section, panel, excluded, visible });
      this.setAttribute("class", "stale-absolute-layout");
      this.setAttribute("style", "position:absolute");
      this.image = new Element();
      this.image.setAttribute("src", `/assets/marketing/quiet-coast-${family}-480.hash.webp`);
      this.image.setAttribute("width", String(width));
      this.image.setAttribute("height", "800");
      const candidates = rich
        ? `/assets/marketing/quiet-coast-${family}-480.hash.FORMAT 480w, /assets/marketing/quiet-coast-${family}-${width}.hash.FORMAT ${width}w`
        : `/assets/marketing/quiet-coast-${family}-480.hash.FORMAT 480w`;
      this.sources = [new Source("image/avif", candidates.replaceAll("FORMAT", "avif")), new Source("image/webp", candidates.replaceAll("FORMAT", "webp"))];
      this.frame = heading ? new Element({ lookup: {
        "figcaption h3, .preview-slide__content h3": new Element({ textContent: heading }),
        "figcaption [data-copy], figcaption": new Element({ textContent: heading }),
      } }) : null;
      this.parentElement = hidden ? new Element({ parentElement: panel ?? section }) : panel ?? section;
      if (hidden) this.parentElement.setAttribute("aria-hidden", "true");
      section?.pictures.push(this);
      panel?.pictures.push(this);
    }
    querySelector(selector) {
      if (selector === "img") return this.image;
      if (selector.startsWith("source[")) return this.sources.find((source) => source.getAttribute("type") === "image/webp") ?? null;
      return null;
    }
    querySelectorAll(selector) { return selector === "source" ? this.sources : []; }
    closest(selector) {
      if (selector === ".output-motion--playable, a") return this.excluded ? new Element() : null;
      if (selector === "[data-preview-panel]") return this.panel ?? null;
      if (selector === "main > section") return this.section ?? null;
      if (selector === "details:not([open])") return this.panel && !this.panel.active ? new Element() : null;
      if (selector === ".preview-frame, .preview-slide" || selector === ".output-frame, .proof-artifact--twilight") return this.frame;
      if (selector === ".marketing-context") return this.section?.isContext ? this.section : null;
      return null;
    }
    getBoundingClientRect() { return this.visible ? { width: 80, height: 72 } : { width: 0, height: 0 }; }
    cloneNode() {
      const clone = new Picture({ family: this.family, width: Number(this.image.getAttribute("width")) });
      clone.attributes = new Map(this.attributes);
      clone.image = new Element();
      clone.image.attributes = new Map(this.image.attributes);
      clone.sources = this.sources.map((source) => source.cloneNode());
      clone.parentElement = null;
      return clone;
    }
  }

  function scope(name, { panel = false, context = false } = {}) {
    const element = new Element({
      isSection: !panel,
      isPanel: panel,
      isContext: context,
      pictures: [],
      dataset: panel ? { previewPanel: name } : {},
      heading: new Element({ textContent: name }),
      focus: new Element({ textContent: "Original mood" }),
    });
    element.querySelectorAll = (selector) => selector === "picture[data-marketing-image-trigger]" ? element.pictures.filter((picture) => picture.dataset.marketingImageTrigger === "true") : [];
    element.querySelector = (selector) => selector === "h1, h2" ? element.heading : selector === "[data-context-focus-value]" ? element.focus : null;
    return element;
  }

  function harness({ previewOpen = false, fail = false, unsupported = false } = {}) {
    const proof = scope("One direction");
    const context = scope("Whole idea", { context: true });
    const panel = scope("storyboard", { panel: true });
    const presentation = scope("presentation", { panel: true });
    const poor = new Picture({ family: "landscape", section: proof, hidden: true });
    const rich = new Picture({ family: "landscape", width: 1200, rich: true, section: proof, heading: "Better landscape" });
    const twilight = new Picture({ family: "twilight", width: 1200, rich: true, section: proof });
    const excluded = new Picture({ family: "detail", section: proof, excluded: true });
    const target = new Picture({ family: "landscape", section: context });
    target.setAttribute("data-context-study-target", "");
    const strip = new Picture({ family: "portrait", width: 1024, rich: true, section: context });
    const six = ["twilight", "landscape", "portrait", "detail", "portrait", "landscape"].map((family, index) => new Picture({ family, width: family === "detail" ? 768 : family === "portrait" ? 1024 : 1200, rich: true, section: proof, panel, heading: `Shot ${index + 1}` }));
    const five = ["landscape", "twilight", "portrait", "detail", "landscape"].map((family, index) => new Picture({ family, width: family === "detail" ? 768 : family === "portrait" ? 1024 : 1200, rich: true, section: proof, panel: presentation, heading: `Slide ${index + 1}` }));
    const media = new Element();
    const caption = new Element();
    const section = new Element();
    const close = new Element();
    const previous = new Element();
    const next = new Element();
    const status = new Element();
    const dialog = new Element({ id: "marketing-image", open: false, lookup: {
      "[data-image-viewer-media]": media,
      "[data-image-viewer-caption]": caption,
      "[data-image-viewer-section]": section,
      "[data-image-viewer-close]": close,
      "[data-image-viewer-previous]": previous,
      "[data-image-viewer-next]": next,
      "[data-image-viewer-status]": status,
    } });
    if (!unsupported) dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; dialog.emit("close"); };
    const choice = new Element();
    const announced = [];
    const preview = new Element({ open: previewOpen });
    const pictures = [poor, rich, twilight, excluded, target, strip, ...six, ...five];
    const document = new Element({ documentElement: { lang: "en", dir: "ltr", dataset: previewOpen ? { marketingPreview: "open" } : {} } });
    document.querySelectorAll = (selector) => selector === "main picture" ? pictures : selector === "[data-context]" ? [choice] : [];
    document.querySelector = (selector) => selector === "[data-marketing-preview-dialog]" ? preview : null;
    document.dispatchEvent = (event) => { announced.push(event.type); document.emit(event.type); };
    const messages = { ...english };
    const contextVm = { document, messages, Intl, CustomEvent, ensureNativeModalDialog(element) {
      if (fail) { element.open = true; return false; }
      element.showModal();
      return true;
    } };
    runInNewContext(behavior, contextVm);
    new contextVm.Viewer(dialog);
    return { proof, context, panel, presentation, poor, rich, twilight, excluded, target, strip, six, five, media, caption, section, close, previous, next, status, dialog, choice, announced, preview, document, messages };
  }

  const active = harness();
  assert.equal(active.poor.parentElement.getAttribute("aria-hidden"), null, "Focusable studies cannot remain inside an aria-hidden ancestor.");
  assert.equal(active.poor.getAttribute("role"), "button");
  assert.equal(active.excluded.dataset.marketingImageTrigger, undefined, "Existing video links and playback controls remain authoritative.");
  active.rich.emit("click");
  assert.equal(active.dialog.open, true);
  assert.equal(active.document.documentElement.dataset.marketingLightbox, "open");
  assert.match(active.status.textContent, /Image \u20681\u2069 of \u20682\u2069/, "Section families deduplicate while keeping the clicked representative.");
  assert.deepEqual(active.announced, ["forma-marketing-preview-open"]);
  assert.equal(active.media.children[0].getAttribute("class"), null, "Absolute campaign layout classes must not enter the viewer.");
  assert.equal(active.media.children[0].getAttribute("style"), null);
  assert.ok(active.media.children[0].sources.every((source) => source.getAttribute("sizes") === "100vw"));
  assert.match(active.media.children[0].image.src, /landscape-1200/, "A low-resolution thumbnail must resolve its highest authorized original.");
  assert.equal(active.media.children[0].image.loading, "eager");
  assert.equal(active.close.focused, 1);
  assert.equal(active.previous.disabled, false, "Multi-image galleries can always move backward.");
  assert.equal(active.next.disabled, false, "Multi-image galleries can always move forward.");
  active.previous.emit("click");
  assert.match(active.status.textContent, /Image \u20682\u2069 of \u20682\u2069/, "The previous control wraps from the first image to the last.");
  active.next.emit("click");
  assert.match(active.status.textContent, /Image \u20681\u2069 of \u20682\u2069/, "The next control wraps from the last image to the first.");
  active.dialog.emit("keydown", { key: "ArrowLeft" });
  assert.match(active.status.textContent, /Image \u20682\u2069 of \u20682\u2069/, "The left arrow wraps backward within its own section.");
  active.dialog.emit("keydown", { key: "ArrowRight" });
  assert.match(active.status.textContent, /Image \u20681\u2069 of \u20682\u2069/, "The right arrow wraps forward within its own section.");
  active.dialog.emit("keydown", { key: "End" });
  assert.match(active.status.textContent, /Image \u20682\u2069 of \u20682\u2069/, "End remains an absolute jump to the last image.");
  assert.equal(active.next.disabled, false, "The final image retains its forward control for wrapping.");
  active.dialog.emit("keydown", { key: "PageDown" });
  assert.match(active.status.textContent, /Image \u20681\u2069 of \u20682\u2069/, "PageDown also wraps forward.");
  active.dialog.emit("keydown", { key: "PageUp" });
  assert.match(active.status.textContent, /Image \u20682\u2069 of \u20682\u2069/, "PageUp also wraps backward.");
  active.dialog.emit("keydown", { key: "Home" });
  assert.match(active.status.textContent, /Image \u20681\u2069 of \u20682\u2069/, "Home remains an absolute jump to the first image.");
  active.document.documentElement.dir = "rtl";
  active.dialog.emit("keydown", { key: "ArrowRight" });
  assert.match(active.status.textContent, /Image \u20682\u2069 of \u20682\u2069/, "RTL right-arrow navigation wraps backward without reversing authored order.");
  active.dialog.emit("keydown", { key: "ArrowLeft" });
  assert.match(active.status.textContent, /Image \u20681\u2069 of \u20682\u2069/, "RTL left-arrow navigation wraps forward without reversing authored order.");
  assert.equal(active.previous.disabled, false);
  active.messages.imageViewerStatus = "合計{total}、現在{current}";
  active.document.documentElement.lang = "ja";
  active.document.emit("forma-locale-change");
  assert.match(active.status.textContent, /合計\u20682\u2069、現在\u20681\u2069/);
  active.dialog.close();
  assert.deepEqual(active.announced, ["forma-marketing-preview-open", "forma-marketing-preview-close"]);
  assert.equal(active.rich.focused, 1);
  assert.equal(active.document.documentElement.dataset.marketingLightbox, undefined);

  const nested = harness({ previewOpen: true });
  nested.panel.active = true;
  nested.six[3].emit("click");
  assert.match(nested.status.textContent, /Image \u20684\u2069 of \u20686\u2069/, "Six intentional editorial storyboard frames remain distinct.");
  assert.equal(nested.announced.length, 0, "A nested viewer cannot resume or re-pause video owned by its parent modal.");
  assert.equal(nested.section.textContent, "Storyboard");
  nested.dialog.emit("keydown", { key: "End" });
  nested.dialog.emit("keydown", { key: "ArrowRight" });
  assert.match(nested.status.textContent, /Image \u20681\u2069 of \u20686\u2069/, "Storyboard image galleries wrap without entering another section.");
  nested.dialog.emit("keydown", { key: "ArrowLeft" });
  assert.match(nested.status.textContent, /Image \u20686\u2069 of \u20686\u2069/, "Storyboard image galleries wrap backward without entering another section.");
  assert.equal(nested.section.textContent, "Storyboard");
  nested.dialog.close();
  assert.equal(nested.document.documentElement.dataset.marketingPreview, "open", "The original output reader remains open and scroll-locked.");
  assert.equal(nested.six[3].focused, 1);
  nested.presentation.active = true;
  nested.five[4].emit("click");
  assert.match(nested.status.textContent, /Image \u20685\u2069 of \u20685\u2069/, "All five presentation slides remain in their own group.");
  nested.next.emit("click");
  assert.match(nested.status.textContent, /Image \u20681\u2069 of \u20685\u2069/, "Presentation image galleries wrap forward without entering the storyboard.");
  nested.previous.emit("click");
  assert.match(nested.status.textContent, /Image \u20685\u2069 of \u20685\u2069/, "Presentation image galleries wrap backward without entering the storyboard.");
  assert.equal(nested.section.textContent, "Presentation");
  nested.dialog.close();

  const singleton = harness();
  singleton.proof.pictures = [singleton.rich];
  singleton.rich.emit("click");
  assert.equal(singleton.previous.hidden, true, "A single-image section never presents redundant gallery controls.");
  assert.equal(singleton.previous.disabled, true);
  assert.equal(singleton.next.hidden, true);
  assert.equal(singleton.next.disabled, true);
  singleton.dialog.emit("keydown", { key: "ArrowRight" });
  assert.match(singleton.status.textContent, /Image \u20681\u2069 of \u20681\u2069/, "Single-image keyboard navigation remains stable.");
  singleton.dialog.close();

  const changing = harness();
  changing.target.image.setAttribute("src", "/assets/marketing/quiet-coast-twilight-768.hash.webp");
  changing.context.focus.textContent = "After sunset";
  changing.choice.emit("click");
  assert.match(changing.target.getAttribute("aria-label"), /After sunset/, "Labels track the currently selected, translated creative context.");
  changing.target.emit("keydown", { key: "Enter" });
  assert.match(changing.media.children[0].image.src, /twilight-1200/, "Context changes resolve the newly selected study, not a stale startup thumbnail.");
  changing.dialog.close();

  const broken = harness({ fail: true });
  broken.poor.emit("click");
  assert.equal(broken.dialog.open, false);
  assert.equal(broken.media.children.length, 0);
  assert.equal(broken.announced.length, 0);
  const unsupported = harness({ unsupported: true });
  assert.equal(unsupported.poor.dataset.marketingImageTrigger, undefined, "Browsers without a modal top layer retain the unmodified inline artwork.");
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
      ".context-demo__project h3", ".output-piece__caption h3", ".output-slide > strong", ".output-audio > strong",
      ".process-list h3", ".team-principles h3", ".output-paper > p", ".output-piece__caption p",
      ".output-audio > p", ".context-demo__disclaimer", ".marketing-trust__disclosure", ".team-principles p",
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
    "languageLabel", "languageChangeError", "languageChanged", "videoPlayLabel", "videoPauseLabel", "motionPauseLabel", "motionResumeLabel",
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
    for (const key of ["heroTitle", "heroIntroduction", "contextIntroduction", "processCollectBody", "processCreateBody", "trustIntroduction", "formatAudio", "openForma", "demoDisclaimer", "demoStudyEyebrow", "demoHelper", "trustDisclosure", "demoImageMood", "demoStoryMood", "imageViewerTitle", "imageViewerPrevious", "imageViewerNext", ...Object.keys(catalog).filter((candidate) => candidate.startsWith("audio") || candidate.startsWith("outputAudio")), ...Object.keys(catalog).filter((candidate) => candidate.startsWith("proof")), ...Object.keys(catalog).filter((candidate) => candidate.startsWith("preview") && !candidate.endsWith("Status"))]) {
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

  const publicImports = new Set();
  const inspectImport = async (key) => {
    if (publicImports.has(key)) return;
    publicImports.add(key);
    const imported = manifest[key];
    assert.ok(imported?.file, `Marketing dependency ${key} must exist in the public build manifest.`);
    assert.match(imported.file, /^assets\//, `${key} must never enter a protected application route.`);
    const contents = await source(`dist/client/${imported.file}`);
    assert.doesNotMatch(contents, /FormaStore|api\/session|protected-assets/, `${key} must stay independent of private state.`);
    await Promise.all((imported.imports ?? []).map(inspectImport));
  };
  await Promise.all((entry.imports ?? []).map(inspectImport));
  assert.ok([...publicImports].some((key) => key.includes("language-picker")), "The same tiny design-system picker must power the public build.");

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

  const video = publicHtml.match(/\/assets\/marketing\/quiet-coast-scene-8s\.([a-f0-9]{12})\.mp4/);
  const poster = publicHtml.match(/\/assets\/marketing\/quiet-coast-scene-poster-960\.([a-f0-9]{12})\.jpg/);
  assert.ok(video, "Production marketing must include the genuine Forma-generated video.");
  assert.ok(poster, "Production marketing must include the genuine cottage-frame video poster.");
  assert.match(publicHtml, /\bdata-marketing-video-toggle\b/);
  for (const [asset, budget] of [[video, 950_000], [poster, 45_000]]) {
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
