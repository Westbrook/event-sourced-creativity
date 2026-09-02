import { test, expect, attachJSON } from "./fixtures.mjs";
import { classifyTestRequest, localTestOrigin } from "./helpers/read-only-network.mjs";
import { measureFormaFocusVisibility } from "../helpers/forma-dom-focus-visibility.mjs";

test("read-only guard rejects remote targets and consequential mutations", async () => {
  const origin = "http://127.0.0.1:4178";
  const classify = (method, path, body) => classifyTestRequest({ method, url: new URL(path, origin).href, postData: JSON.stringify(body) }, origin);
  expect(localTestOrigin(origin)).toBe(origin);
  for (const url of ["https://forma.example", "http://127.0.0.1:4178/document/x", "http://user:pass@localhost:4178"]) {
    expect(() => localTestOrigin(url)).toThrow();
  }
  expect(classify("GET", "/api/session")).toBe("read");
  expect(classify("GET", "https://example.com/provider")).toBe("forbidden");
  expect(classifyTestRequest({ method: "GET", resourceType: "stylesheet",
    url: "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap" }, origin)).toBe("public-font");
  expect(classifyTestRequest({ method: "GET", resourceType: "font", url: "https://fonts.gstatic.com/s/manrope/v1/example.woff2" }, origin)).toBe("public-font");
  expect(classifyTestRequest({ method: "GET", resourceType: "fetch", url: "https://fonts.gstatic.com/s/manrope/v1/example.woff2" }, origin)).toBe("forbidden");
  for (const path of ["/api/events", "/api/document-jobs", "/api/document-jobs/job/run", "/api/session", "/api/output-requirements"]) {
    expect(classify("POST", path, {})).toBe("forbidden");
  }
  expect(classify("POST", "/api/performance", {})).toBe("suppressed-telemetry");
  const recovery = { action: "resume", projectId: "project-atmosphere", documentId: "doc-atmosphere" };
  expect(classify("POST", "/api/workspace/quick-edit", recovery)).toBe("recovery-read");
  for (const action of ["preview", "apply", "dismiss", "retrieve"]) {
    expect(classify("POST", "/api/workspace/quick-edit", { ...recovery, action })).toBe("forbidden");
  }
  expect(classify("POST", "/api/workspace/quick-edit", { ...recovery, prompt: "New content" })).toBe("forbidden");
  expect(classify("POST", "/api/events/hot", { action: "hot", events: [{ type: "DocumentViewVisited" }] })).toBe("suppressed-telemetry");
  for (const type of ["ProjectCreated", "BlockPropertyEdited", "ObjectPinned", "AnnotationAdded"]) {
    expect(classify("POST", "/api/events/hot", { action: "hot", events: [{ type }] })).toBe("forbidden");
  }
});

const fixtureStyles = `<style>
  body { margin: 32px; }
  button { width: 150px; height: 44px; margin: 12px; border: 1px solid; box-shadow: none; }
  button:focus-visible { outline: 3px solid rgb(0, 0, 0); outline-offset: 3px; }
  #pane { width: 230px; height: 110px; overflow: hidden; }
</style>`;

test("observer distinguishes real focus, clipped rings, body obstruction and unassessed paint", async ({ page }, testInfo) => {
  const cases = [
    { name: "clear", css: "", failure: null, extent: 6 },
    { name: "clipped", css: "#pane {height:24px}", failure: "focus-envelope-clipped" },
    { name: "ring-only-clipped", css: "#pane{height:44px} #target{margin-block:0}", failure: "focus-envelope-clipped", bodyFits: true },
    { name: "negative-offset", css: "button:focus-visible {outline-offset:-4px}", failure: null, extent: 0 },
    { name: "body-overlay", css: "#overlay{position:fixed;left:60px;top:124px;width:120px;height:12px;background:black}", failure: "focus-overlay-collision" },
    { name: "pointer-transparent-overlay", css: "#overlay{position:fixed;left:60px;top:124px;width:120px;height:12px;background:black;pointer-events:none}", unknown: "focus-overlay-collision-paint-order" },
    { name: "transformed", css: "#pane{transform:translateX(2px)}", unknown: "focus-complex-geometry" },
    { name: "shadow", css: "#target{box-shadow:0 0 0 5px blue}", unknown: "focus-shadow-paint" },
  ];
  for (const item of cases) {
    await page.setContent(`${fixtureStyles}<style>${item.css}</style><button id="before">Start</button><div id="pane"><button id="target">Expected focus</button></div><div id="overlay"></div>`);
    await page.locator("#before").click();
    await page.keyboard.press("Tab");
    const target = page.locator("#target");
    await expect(target).toBeFocused();
    const measured = await target.evaluate(measureFormaFocusVisibility, { requireFocusVisible: true, overlaySelectors: ["#overlay"] });
    await attachJSON(testInfo, `calibration-${item.name}`, measured);
    if (item.extent !== undefined) expect(measured.focus.outlineExtent).toBe(item.extent);
    if (item.bodyFits) {
      const { raw, intersection } = measured.focus;
      expect(raw.top).toBeGreaterThanOrEqual(intersection.top);
      expect(raw.bottom).toBeLessThanOrEqual(intersection.bottom);
      expect(raw.left).toBeGreaterThanOrEqual(intersection.left);
      expect(raw.right).toBeLessThanOrEqual(intersection.right);
    }
    if (item.failure) expect(measured.failures.map(entry => entry.code)).toContain(item.failure);
    else if (item.unknown) expect(measured.unassessed.map(entry => entry.code)).toContain(item.unknown);
    else expect(measured.pass).toBe(true);
    if (item.failure || item.unknown) expect(measured.pass).toBe(false);
    const wrong = await page.locator("#before").evaluate(measureFormaFocusVisibility);
    expect(wrong.failures.map(entry => entry.code)).toContain("wrong-active-element");
  }
});

test("observer respects native top-layer escape and open shadow/slot focus", async ({ page }, testInfo) => {
  await page.setContent(`${fixtureStyles}
    <button popovertarget="overlay">Open native popover</button>
    <div style="overflow:hidden;transform:translateX(20px);width:10px;height:10px">
      <div id="overlay" popover="auto" style="position:fixed;inset:140px auto auto 120px;width:220px;height:100px">
        <button id="target">Popover control</button>
      </div>
    </div>`);
  await page.getByRole("button", { name: "Open native popover" }).click();
  await page.keyboard.press("Tab");
  await expect(page.locator("#target")).toBeFocused();
  const native = await page.locator("#target").evaluate(measureFormaFocusVisibility, { requireFocusVisible: true });
  await attachJSON(testInfo, "calibration-native-popover", native);
  expect(native.pass).toBe(true);

  await page.setContent(`${fixtureStyles}<button id="before">Start</button><div id="host"><button id="slotted" slot="control">Slotted control</button></div>`);
  await page.locator("#host").evaluate(host => {
    host.attachShadow({ mode: "open" }).innerHTML = '<div style="padding:12px;overflow:hidden;width:220px;height:100px"><slot name="control"></slot></div>';
  });
  await page.locator("#before").click();
  await page.keyboard.press("Tab");
  const slotted = await page.locator("#slotted").evaluate(measureFormaFocusVisibility, { requireFocusVisible: true });
  await attachJSON(testInfo, "calibration-slotted-control", slotted);
  expect(slotted.pass).toBe(true);
  expect(slotted.coverage.openShadowRoots).toBe(1);
});

test("observer protects visible critical copy and does not credit wholly clipped old copy", async ({ page }, testInfo) => {
  for (const clipped of [false, true]) {
    await page.setContent(`${fixtureStyles}
      <button id="before">Start</button><div id="pane"><button id="target">Expected focus</button></div>
      <div style="position:fixed;left:350px;top:100px;width:160px;height:${clipped ? 0 : 40}px;overflow:hidden">
        <p id="copy" style="margin:0;height:40px">Review does not save or generate.</p>
      </div>
      <div id="overlay" style="position:fixed;left:350px;top:100px;width:160px;height:40px;background:black"></div>`);
    await page.locator("#before").click();
    await page.keyboard.press("Tab");
    const measured = await page.locator("#target").evaluate(measureFormaFocusVisibility, {
      requireFocusVisible: true, overlaySelectors: ["#overlay"], regionSelectors: ["#copy"],
    });
    await attachJSON(testInfo, `calibration-critical-copy-${clipped ? "wholly-clipped" : "visible"}`, measured);
    expect(measured.focus.hitSamples.every(hit => hit.targetFirst)).toBe(true);
    expect(measured.regions[0].paintedBox).toBe(!clipped);
    if (clipped) expect(measured.pass).toBe(true);
    else {
      expect(measured.pass).toBe(false);
      expect(measured.failures.map(entry => entry.code)).toContain("visible-task-region-overlay-collision");
    }
  }
});

test("other-control rounded clipping is bounded without excusing uncertain overlay paint", async ({ page }, testInfo) => {
  const cases = [
    { name: "distant-rounded-control", overlay: "left:700px", pass: true },
    { name: "overlapped-rounded-control", overlay: "left:350px", failure: "visible-native-control-overlay-collision" },
    { name: "transparent-overlap", overlay: "left:350px;pointer-events:none", unknown: "visible-native-control-overlay-collision-paint-order" },
    { name: "unknown-filter-extent", overlay: "left:700px", extra: "filter:blur(1px)", unknown: "control-complex-geometry" },
    { name: "unknown-overlay-extent", overlay: "left:700px;filter:blur(1px)", unknown: "control-complex-geometry" },
  ];
  for (const item of cases) {
    await page.setContent(`${fixtureStyles}
      <button id="before">Start</button><div id="pane"><button id="target">Expected focus</button></div>
      <div id="round-clip" style="position:fixed;left:350px;top:100px;width:160px;height:44px;overflow:hidden;border-radius:22px;${item.extra ?? ""}">
        <button id="other" style="margin:0;width:160px;height:44px">Other control</button>
      </div>
      <div id="overlay" style="position:fixed;top:100px;width:160px;height:44px;background:black;${item.overlay}"></div>`);
    await page.locator("#before").click();
    await page.keyboard.press("Tab");
    const measured = await page.locator("#target").evaluate(measureFormaFocusVisibility, {
      requireFocusVisible: true, overlaySelectors: ["#overlay"], checkVisibleControls: true,
    });
    await attachJSON(testInfo, `calibration-${item.name}`, measured);
    const other = measured.controls.find(control => control.element.id === "other");
    expect(other.unknown.flatMap(entry => entry.reasons)).toContain("rounded clipping near envelope");
    expect(measured.pass).toBe(item.pass ?? false);
    if (item.pass) {
      expect(other.overlayAssessment).toBe("no-foreign-overlay-overlap-with-conservative-box");
      // The allowance is solely for a different control's overlay collision.
      // Native focus on that rounded edge still requires separate paint proof.
      await page.keyboard.press("Tab");
      await expect(page.locator("#other")).toBeFocused();
      const focused = await page.locator("#other").evaluate(measureFormaFocusVisibility, {
        requireFocusVisible: true, overlaySelectors: ["#overlay"], checkVisibleControls: true,
      });
      await attachJSON(testInfo, "calibration-focused-rounded-control", focused);
      expect(focused.pass).toBe(false);
      expect(focused.unassessed.map(entry => entry.code)).toContain("focus-complex-geometry");
    }
    if (item.failure) expect(measured.failures.map(entry => entry.code)).toContain(item.failure);
    if (item.unknown) expect(measured.unassessed.map(entry => entry.code)).toContain(item.unknown);
  }
});

// R14's borderless 158.390625px toolbar reports integer clientWidth=158.
// These are real browser layout fixtures, not Forma or native-scroll repairs.
// Native Tab establishes focus; the observer cannot adjust any box or scroll.
for (const outside of [false, true]) test(
  `observer ${outside ? "rejects real fractional clipping" : "retains exact fractional client edges"} without an epsilon`,
  async ({ page }, testInfo) => {
    for (const axis of ["inline", "block"]) {
      const width = axis === "inline" ? (outside ? 158.625 : 158.234375) : 100;
      const height = axis === "block" ? (outside ? 70.625 : 70.234375) : 44;
      await page.setContent(`${fixtureStyles}<style>
        #pane { position:fixed;left:145.609375px;top:150.609375px;width:158.390625px;height:70.390625px;
          padding:0;border:0;border-radius:0;overflow:auto;scrollbar-gutter:auto;scrollbar-width:none; }
        #target { display:block;box-sizing:border-box;min-width:0;min-height:0;width:${width}px;height:${height}px;
          padding:0;margin:0;border:0;border-radius:0;font:14px sans-serif;white-space:nowrap; }
        #target:focus-visible { outline:3px solid black;outline-offset:-3px; }
      </style><button id="before">Start</button><div id="pane"><button id="target">Target</button></div>`);
      await page.locator("#before").click();
      await page.keyboard.press("Tab");
      const target = page.locator("#target");
      await expect(target).toBeFocused();
      const metrics = await target.evaluate(element => {
        const pane = element.parentElement, r = pane.getBoundingClientRect(), style = getComputedStyle(pane);
        return { raw: { left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height },
          clientWidth:pane.clientWidth,clientHeight:pane.clientHeight,clientLeft:pane.clientLeft,clientTop:pane.clientTop,
          offsetWidth:pane.offsetWidth,offsetHeight:pane.offsetHeight,scrollLeft:pane.scrollLeft,scrollTop:pane.scrollTop,
          borders:[style.borderLeftWidth,style.borderRightWidth,style.borderTopWidth,style.borderBottomWidth],
          scrollbarWidth:style.scrollbarWidth,scrollbarGutter:style.scrollbarGutter };
      });
      expect(metrics.borders).toEqual(["0px", "0px", "0px", "0px"]);
      expect([metrics.clientLeft, metrics.clientTop]).toEqual([0, 0]);
      expect([metrics.offsetWidth, metrics.offsetHeight]).toEqual([metrics.clientWidth, metrics.clientHeight]);
      expect(metrics.scrollbarWidth).toBe("none");
      expect(metrics.scrollbarGutter).toBe("auto");
      expect(metrics.raw.width).toBe(158.390625);
      expect(metrics.raw.height).toBe(70.390625);
      const measured = await target.evaluate(measureFormaFocusVisibility, { requireFocusVisible:true, overlaySelectors:[] });
      const after = await target.evaluate(element => ({ active:document.activeElement===element,
        scrollLeft:element.parentElement.scrollLeft,scrollTop:element.parentElement.scrollTop }));
      expect(after).toEqual({ active:true,scrollLeft:metrics.scrollLeft,scrollTop:metrics.scrollTop });
      expect(measured.focus.outlineExtent).toBe(0);
      const dimension = axis === "inline" ? "width" : "height";
      if (outside) {
        expect(measured.focus.raw[dimension] - metrics.raw[dimension]).toBe(0.234375);
      } else {
        const end = axis === "inline" ? "right" : "bottom";
        const integerEnd = axis === "inline" ? metrics.raw.left + metrics.clientWidth : metrics.raw.top + metrics.clientHeight;
        expect(measured.focus.raw[end]).toBeGreaterThan(integerEnd);
        expect(measured.focus.raw[end]).toBeLessThanOrEqual(metrics.raw[end]);
        expect(measured.focus.hitSamples.every(hit => hit.targetFirst)).toBe(true);
      }
      await attachJSON(testInfo, `calibration-fractional-${axis}-${outside ? "outside" : "inside"}`, { metrics, measured });
      const pane = measured.focus.ancestors.find(item => item.element.id === "pane");
      if (!outside) expect(pane.client).toEqual(metrics.raw);
      expect(measured.unassessed).toEqual([]);
      if (outside) {
        expect(measured.failures.map(item => item.code)).toContain("focus-envelope-clipped");
        expect(measured.pass).toBe(false);
      } else {
        expect(measured.failures).toEqual([]);
        expect(measured.pass).toBe(true);
      }
    }
  },
);

test("fractional customized scrollbar geometry cannot borrow the native gutter-free branch", async ({ page }, testInfo) => {
  await page.setContent(`${fixtureStyles}<style>
    #pane { position:fixed;left:145.609375px;top:150.609375px;width:158.390625px;height:70.390625px;
      padding:0;border:0;border-radius:0;overflow:auto;scrollbar-gutter:auto;scrollbar-width:auto; }
    #pane::-webkit-scrollbar { width:.25px;height:.25px; }
    #target { display:block;box-sizing:border-box;width:100px;height:44px;padding:0;margin:0;border:0;border-radius:0; }
    #target:focus-visible { outline:3px solid black;outline-offset:-3px; }
    #excess { width:300px;height:100px; }
  </style><button id="before">Start</button><div id="pane"><button id="target">Target</button><div id="excess"></div></div>`);
  await page.locator("#before").click();
  await page.keyboard.press("Tab");
  const target = page.locator("#target");
  await expect(target).toBeFocused();
  const metrics = await target.evaluate(element => {
    const pane=element.parentElement,bar=getComputedStyle(pane,"::-webkit-scrollbar");
    return { clientWidth:pane.clientWidth,clientHeight:pane.clientHeight,offsetWidth:pane.offsetWidth,offsetHeight:pane.offsetHeight,
      scrollbar:{width:bar.width,height:bar.height},scrollLeft:pane.scrollLeft,scrollTop:pane.scrollTop };
  });
  expect(metrics.scrollbar).toEqual({ width:"0.25px",height:"0.25px" });
  expect([metrics.offsetWidth,metrics.offsetHeight]).toEqual([metrics.clientWidth,metrics.clientHeight]);
  const measured = await target.evaluate(measureFormaFocusVisibility, { requireFocusVisible:true,overlaySelectors:[] });
  await attachJSON(testInfo,"calibration-fractional-custom-scrollbar",{metrics,measured});
  const pane=measured.focus.ancestors.find(item=>item.element.id==="pane");
  expect(measured.unassessed.map(item=>item.code)).toContain("focus-complex-geometry");
  expect(pane.clientBasis).toBe("integer-client");
  expect(measured.pass).toBe(false);
});

// R22 reaches real Close focus whose six-pixel envelope is inside the rounded
// card. These declared fixtures calibrate geometry, not Forma or its data.
// Native Tab establishes focus; neither the observer nor this test repairs it.
const roundedClientMetrics = element => {
  const pane = element.parentElement, r = pane.getBoundingClientRect(), style = getComputedStyle(pane);
  const bar = getComputedStyle(pane, "::-webkit-scrollbar");
  return {
    active: document.activeElement === element, focusVisible: element.matches(":focus-visible"),
    raw: { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height },
    clientLeft:pane.clientLeft, clientTop:pane.clientTop, clientWidth:pane.clientWidth, clientHeight:pane.clientHeight,
    offsetWidth:pane.offsetWidth, offsetHeight:pane.offsetHeight, rectCount:pane.getClientRects().length,
    scrollLeft:pane.scrollLeft, scrollTop:pane.scrollTop, direction:style.direction,
    overflowX:style.overflowX, overflowY:style.overflowY,
    borders:[style.borderLeftWidth,style.borderRightWidth,style.borderTopWidth,style.borderBottomWidth],
    radii:[style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomLeftRadius,style.borderBottomRightRadius],
    cornerShapes:["corner-top-left-shape","corner-top-right-shape","corner-bottom-left-shape","corner-bottom-right-shape"]
      .map(name => style.getPropertyValue(name)),
    scrollbarWidth:style.scrollbarWidth, scrollbarGutter:style.scrollbarGutter,
    scrollbar:{ width:bar.width, height:bar.height },
  };
};

test("rounded client proof retains a fully contained native Close envelope in LTR and RTL", async ({ page }, testInfo) => {
  for (const direction of ["ltr", "rtl"]) {
    await page.setContent(`${fixtureStyles}<style>
      #pane { position:fixed;left:350px;top:150px;width:220px;height:160px;padding:0;border:1px solid;
        border-radius:14px;corner-shape:round;overflow:auto;scrollbar-gutter:stable;direction:${direction}; }
      #target { position:absolute;top:16px;inset-inline-end:16px;box-sizing:border-box;
        width:44px;height:44px;min-width:0;min-height:0;margin:0;padding:0;border:0;border-radius:0; }
    </style><button id="before">Start</button><div id="pane"><button id="target" aria-label="Close">×</button></div>`);
    await page.locator("#before").click();
    await page.keyboard.press("Tab");
    const target = page.locator("#target");
    await expect(target).toBeFocused();
    const metrics = await target.evaluate(roundedClientMetrics);
    expect(metrics.active && metrics.focusVisible).toBe(true);
    expect(metrics.direction).toBe(direction);
    expect(metrics.rectCount).toBe(1);
    expect(metrics.borders).toEqual(["1px","1px","1px","1px"]);
    expect(metrics.radii).toEqual(["14px","14px","14px","14px"]);
    expect(metrics.cornerShapes).toEqual(["round","round","round","round"]);
    expect([metrics.overflowX, metrics.overflowY]).toEqual(["auto","auto"]);
    expect(metrics.scrollbarGutter).toBe("stable");
    expect(metrics.scrollbar).toEqual({ width:"auto", height:"auto" });
    const measured = await target.evaluate(measureFormaFocusVisibility, { requireFocusVisible:true, overlaySelectors:[] });
    expect(await target.evaluate(roundedClientMetrics)).toEqual(metrics);
    const pane = measured.focus.ancestors.find(item => item.element.id === "pane");
    const { raw, envelope, hitSamples } = measured.focus;
    expect([raw.width, raw.height, measured.focus.outlineExtent]).toEqual([44,44,6]);
    expect(hitSamples.every(hit => hit.targetFirst)).toBe(true);
    expect(envelope.left).toBeGreaterThanOrEqual(pane.client.left);
    expect(envelope.right).toBeLessThanOrEqual(pane.client.right);
    expect(envelope.top).toBeGreaterThanOrEqual(pane.client.top);
    expect(envelope.bottom).toBeLessThanOrEqual(pane.client.bottom);
    expect((envelope.left < pane.client.left + 14 || envelope.right > pane.client.right - 14)
      && (envelope.top < pane.client.top + 14 || envelope.bottom > pane.client.bottom - 14)).toBe(true);
    expect(measured.failures).toEqual([]);
    await attachJSON(testInfo, `calibration-rounded-close-${direction}`, { metrics, measured });
    // All healthy native/rectangular prerequisites precede the intended old
    // corner-square uncertainty. A missing proof field cannot be that failure.
    expect(measured.pass).toBe(true);
    expect(measured.unassessed).toEqual([]);
    expect(pane.roundedProof).toMatchObject({
      radii:metrics.radii, cornerShapes:metrics.cornerShapes, radius:14, integerInset:1, inside:true,
    });
    expect(pane.roundedProof.client.left).toBeGreaterThanOrEqual(pane.client.left + 1);
    expect(pane.roundedProof.client.top).toBeGreaterThanOrEqual(pane.client.top + 1);
    expect(pane.roundedProof.client.right).toBeLessThanOrEqual(pane.client.right - 1);
    expect(pane.roundedProof.client.bottom).toBeLessThanOrEqual(pane.client.bottom - 1);
  }
});

test("rounded client proof cannot excuse a clipped ring or unsupported corner and scrollbar geometry", async ({ page }, testInfo) => {
  const cases = [
    { name:"ring-outside-arc", css:"#pane{scrollbar-gutter:auto;scrollbar-width:none} #target{top:7px;right:7px}" },
    { name:"percentage-radius", css:"#pane{border-radius:14%}" },
    { name:"one-clipping-axis", css:"#pane{overflow-x:clip;overflow-y:visible;scrollbar-gutter:auto;scrollbar-width:none}" },
    { name:"nonround-corner", css:"#pane{corner-shape:bevel}" },
    { name:"bordered-custom-scrollbar", css:"#pane::-webkit-scrollbar{width:.25px;height:.25px} #excess{height:300px}" },
    { name:"fractional-padding-overshoot", css:"#pane{width:220.25px;height:160.75px;scrollbar-gutter:auto;scrollbar-width:none} #target{top:auto;bottom:5.875px}" },
  ];
  for (const item of cases) {
    await page.setContent(`${fixtureStyles}<style>
      #pane { position:fixed;left:350px;top:150px;width:220px;height:160px;padding:0;border:1px solid;
        border-radius:14px;corner-shape:round;overflow:auto;scrollbar-gutter:stable;scrollbar-width:auto; }
      #target { position:absolute;top:16px;right:16px;box-sizing:border-box;
        width:44px;height:44px;min-width:0;min-height:0;margin:0;padding:0;border:0;border-radius:0; }
      ${item.css}
    </style><button id="before">Start</button><div id="pane"><button id="target" aria-label="Close">×</button><div id="excess"></div></div>`);
    await page.locator("#before").click();
    await page.keyboard.press("Tab");
    const target = page.locator("#target");
    await expect(target).toBeFocused();
    const metrics = await target.evaluate(roundedClientMetrics);
    expect(metrics.active && metrics.focusVisible).toBe(true);
    expect(metrics.rectCount).toBe(1);
    expect(metrics.borders).toEqual(["1px","1px","1px","1px"]);
    if (item.name === "percentage-radius") expect(metrics.radii.every(value => value.includes("%"))).toBe(true);
    else expect(metrics.radii).toEqual(["14px","14px","14px","14px"]);
    if (item.name === "nonround-corner") expect(metrics.cornerShapes).toEqual(["bevel","bevel","bevel","bevel"]);
    else expect(metrics.cornerShapes).toEqual(["round","round","round","round"]);
    if (item.name === "one-clipping-axis") expect([metrics.overflowX,metrics.overflowY]).toEqual(["clip","visible"]);
    else expect([metrics.overflowX,metrics.overflowY]).toEqual(["auto","auto"]);
    if (item.name === "bordered-custom-scrollbar") expect(metrics.scrollbar).toEqual({ width:"0.25px",height:"0.25px" });
    const measured = await target.evaluate(measureFormaFocusVisibility, { requireFocusVisible:true, overlaySelectors:[] });
    expect(await target.evaluate(roundedClientMetrics)).toEqual(metrics);
    const pane = measured.focus.ancestors.find(entry => entry.element.id === "pane");
    const { raw, envelope, hitSamples } = measured.focus;
    expect([raw.width,raw.height,measured.focus.outlineExtent]).toEqual([44,44,6]);
    expect(hitSamples.every(hit => hit.targetFirst)).toBe(true);
    // Even the rounded-ring negative fits the old rectangular client box.
    // The fractional negative deliberately crosses the *actual* padding edge,
    // while remaining inside that rounded integer measurement.
    expect(envelope.left).toBeGreaterThanOrEqual(pane.client.left);
    expect(envelope.right).toBeLessThanOrEqual(pane.client.right);
    expect(envelope.top).toBeGreaterThanOrEqual(pane.client.top);
    expect(envelope.bottom).toBeLessThanOrEqual(pane.client.bottom);
    if (item.name === "ring-outside-arc") {
      const paddingTop = metrics.raw.top + Number.parseFloat(metrics.borders[2]);
      const paddingRight = metrics.raw.right - Number.parseFloat(metrics.borders[1]);
      const dx = envelope.right - (paddingRight - 14), dy = paddingTop + 14 - envelope.top;
      expect(dx * dx + dy * dy).toBeGreaterThan(14 * 14);
    }
    if (item.name === "fractional-padding-overshoot") {
      const paddingBottom = metrics.raw.bottom - Number.parseFloat(metrics.borders[3]);
      expect(envelope.bottom - paddingBottom).toBe(0.125);
      expect(raw.bottom).toBeLessThan(paddingBottom);
      expect(pane.client.bottom).toBeGreaterThan(paddingBottom);
    }
    expect(measured.failures).toEqual([]);
    await attachJSON(testInfo, `calibration-rounded-${item.name}`, { metrics, measured });
    expect(measured.pass).toBe(false);
    expect(measured.unassessed.map(entry => entry.code)).toContain("focus-complex-geometry");
    expect(pane.roundedProof?.inside ?? false).toBe(false);
  }
});

// R25's native file input is the focus owner; its direct .file-button label
// paints the focus ring. These are real native controls, not Forma state.
test("file-label paint proxy keeps native input focus and rejects wrong owners or clipped rings", async ({ page }, testInfo) => {
  for (const item of [{ name:"clear" }, { name:"wrong-owner", wrong:true }, { name:"clipped-ring", clipped:true }]) {
    await page.setContent(`${fixtureStyles}<style>
      #clip { position:fixed;left:350px;top:150px;width:160px;height:${item.clipped ? 54 : 80}px;overflow:hidden; }
      label.file-button { position:absolute;left:10px;top:10px;box-sizing:border-box;display:flex;align-items:center;
        width:120px;height:44px;padding:0 8px;border:1px solid;border-radius:0;box-shadow:none; }
      label.file-button > input[type=file] { position:absolute;left:0;top:0;width:1px;height:1px;padding:0;border:0;opacity:0;outline:none; }
      label.file-button:has(> input[type=file]:focus-visible) { outline:3px solid black;outline-offset:3px; }
    </style><button id="before">Start</button>
      <input id="foreign" type="file" hidden>
      <div id="clip"><label class="file-button" id="paint" ${item.wrong ? 'for="foreign"' : ""}>
        Choose file<input id="target" type="file"></label></div><button id="after">Next control</button>`);
    await page.locator("#before").click();
    await page.keyboard.press("Tab");
    const target = page.locator("#target");
    await expect(target).toBeFocused();
    const read = input => {
      const label=input.parentElement, rect=label.getBoundingClientRect(), style=getComputedStyle(label);
      return { active:document.activeElement===input, focusVisible:input.matches(":focus-visible"),
        connected:input.isConnected, enabled:!input.matches(":disabled"), type:input.type,
        inputOpacity:getComputedStyle(input).opacity, inputValue:input.value,
        labelControlIsInput:label.control===input, labelCount:input.labels.length, labelFocused:label.matches(":focus"),
        raw:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height},
        outline:{style:style.outlineStyle,width:style.outlineWidth,offset:style.outlineOffset} };
    };
    const before = await target.evaluate(read);
    expect(before).toMatchObject({ active:true,focusVisible:true,connected:true,enabled:true,type:"file",
      inputOpacity:"0",inputValue:"",labelFocused:false,labelControlIsInput:!item.wrong,
      labelCount:item.wrong ? 0 : 1,outline:{style:"solid",width:"3px",offset:"3px"} });
    expect([before.raw.width,before.raw.height]).toEqual([120,44]);
    const measured = await target.evaluate(measureFormaFocusVisibility, {
      requireFocusVisible:true,nativeFileLabel:true,overlaySelectors:[],
    });
    expect(await target.evaluate(read)).toEqual(before);
    await attachJSON(testInfo, `calibration-file-label-${item.name}`, { before,measured });
    if (item.wrong) {
      expect(measured.failures.map(entry=>entry.code)).toContain("invalid-native-file-label-proxy");
      expect(measured.pass).toBe(false);
    } else if (item.clipped) {
      expect(measured.focus.raw).toEqual(before.raw);
      expect(measured.focus.raw.bottom).toBeLessThanOrEqual(measured.focus.intersection.bottom);
      expect(measured.focus.envelope.bottom).toBeGreaterThan(measured.focus.intersection.bottom);
      expect(measured.failures.map(entry=>entry.code)).toContain("focus-envelope-clipped");
      expect(measured.pass).toBe(false);
    } else {
      // The old observer first fails here on the invisible INPUT. All actual
      // native ownership and label-paint prerequisites precede that assertion.
      expect(measured.pass).toBe(true);
      expect(measured.focus.raw).toEqual(before.raw);
      expect(measured.focus.outlineExtent).toBe(6);
      expect(measured.focus.paintProxy).toMatchObject({ kind:"native-file-direct-label",valid:true,
        nativeOwner:{tag:"INPUT",id:"target"},paintTarget:{tag:"LABEL",id:"paint"},paintTargetFocused:false });
      await page.keyboard.press("Tab");
      await expect(page.locator("#after")).toBeFocused();
      const inactive = await target.evaluate(measureFormaFocusVisibility, {
        requireFocusVisible:true,nativeFileLabel:true,overlaySelectors:[],
      });
      await attachJSON(testInfo, "calibration-file-label-inactive-owner", inactive);
      expect(inactive.failures.map(entry=>entry.code)).toContain("wrong-active-element");
      expect(inactive.pass).toBe(false);
    }
  }
});
