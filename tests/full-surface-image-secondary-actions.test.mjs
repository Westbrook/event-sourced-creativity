import assert from "node:assert/strict";
import test from "node:test";
import { createCalmFullPage, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { installImageFormatNativeLifetime } from "./helpers/image-format-native-lifetime.mjs";

// Complete current Shell, OutputCard, native Popover/OutputVisual and Store.
// These are deterministic native/template ports, not browser layout or AT.
// Synthetic retained image history is explicitly not a provider result proof.
const locales = ["en", "fr", "ar", "ja"];
const hasClass = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const within = (node, predicate) => {
  for (let parent = node?.parent; parent; parent = parent.parent) if (predicate(parent)) return true;
  return false;
};
const finance = f => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"]
  .map(table => [table, f.storeHost.worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
const actionRows = (f, card) => f.tree().visible("button").filter(node => within(node, parent =>
  parent.owner === card && hasClass(parent, "output-actions")));
const menuFor = (f, card) => {
  const matches = f.components().filter(component => component.parentElement === card && hasClass(component, "output-actions-popover"));
  assert.equal(matches.length, 1, "one menu owner belongs to this exact image card");
  return matches[0];
};
async function openMenu(f, card) {
  const menu = menuFor(f, card);
  const trigger = f.find("button", node => node.owner === menu && node.attributes.popovertarget);
  assert.equal(trigger.text, menu.label.replace(/\s+/gu, " ").trim());
  assert.ok(trigger.text.startsWith(f.i18n.t("action.more")));
  assert.equal(trigger.text, f.i18n.t("action.more"));
  assert.equal(trigger.attributes["aria-label"], f.i18n.t("artifact.delivery.namedAction", "{action} — {name}",
    { action: f.i18n.t("action.more"), name: menu.heading }));
  assert.equal(trigger.attributes["aria-label"], menu.triggerAccessibleName);
  assert.ok(trigger.attributes["aria-label"].includes(card.output.title));
  const panel = menu.querySelector(".ui-popover-panel");
  assert.equal(trigger.attributes.popovertarget, panel.attributes.id);
  assert.equal(panel.attributes.popover, "auto");
  trigger.port.click(); // Existing native popovertarget default, not a replacement opener.
  await f.settle();
  assert.equal(menu.querySelector(".ui-popover-panel").matches(":popover-open"), true);
  return menu;
}
async function choose(f, menu, predicate) {
  const action = f.find("button", node => node.owner === menu && !node.attributes.popovertarget && predicate(node));
  const body = f.tree().visible("div").find(node => node.owner === menu && hasClass(node, "output-secondary-actions"));
  assert.ok(body && action.port.isConnected);
  let prevented = false, stopped = false;
  const event = { target: action.port, currentTarget: action.port,
    preventDefault() { prevented = true; }, stopPropagation() {}, stopImmediatePropagation() { stopped = true; } };
  // Native capture then the same current event's target phase, without an
  // asynchronous gap or a retained/removed callback. Production handlers stay exact.
  assert.equal(body.handlers.click.capture, true);
  body.handlers.click.handleEvent(event);
  assert.equal(prevented || stopped, false);
  assert.equal(menu.querySelector(".ui-popover-panel").matches(":popover-open"), false, "close precedes the destination");
  await action.handlers.click.call(action.owner, event);
  await f.settle();
}
async function imagePage(t, locale, draft, reader = false) {
  const f = await createCalmFullPage(t, { locale, reader });
  const id = "secondary-image-" + locale;
  f.appendEvent(draft ? "IdeationPreviewCompleted" : "GenerationCompleted", {
    object_id: id, object_ids: [id], generation_id: "secondary-generation-" + locale,
    title: "Exact retained café العربية 日本語", provider: "fixture",
    media_url: "data:image/png;base64,AA==", media_type: "image/png", image_width: 1, image_height: 1,
  });
  f.store.patchUi({ selectedOutputId: id });
  await f.settle();
  const workspace = f.components().find(component => component.tag === "forma-workspace");
  await f.act(f.find("button", node => node.owner === workspace && node.attributes["data-workbench-pane"] === "result"));
  const cards = f.components().filter(component => component.tag === "forma-output-card" && component.output?.id === id);
  assert.equal(cards.length, 1, "real current Document mounts the exact retained image");
  const card = cards[0];
  const native = installOutputNavigationFocusNative(t, f, ports);
  if (!reader) {
    // Reuse the existing tree's literal-host -> real CEM component binding.
    // This forwards one native class query, never the viewer operation itself.
    const query = card.querySelector.bind(card);
    const priorQuery = Object.getOwnPropertyDescriptor(card, "querySelector");
    card.querySelector = selector => {
      const selected = query(selector);
      if (selector !== ".output-card-image-viewer") return selected;
      const matches = f.tree().nodes.filter(node => node.owner === card
        && node.tag === "forma-output-visual" && hasClass(node, "output-card-image-viewer"));
      assert.equal(matches.length, 1, "one current viewer host belongs to this exact image card");
      const row = matches[0], viewer = row.component;
      assert.equal(selected, row.port, "the original native query selected this emitted host");
      assert.ok(row.port?.isConnected && viewer?.isConnected);
      assert.ok(viewer instanceof f.renderer.registry["forma-output-visual"], "reuse the actual registered OutputVisual");
      assert.equal(viewer.parentElement, card);
      assert.equal(viewer.store, card.store);
      assert.equal(viewer.output, card.output);
      assert.equal(viewer.viewerOnly, true);
      return viewer;
    };
    t.after(() => {
      if (priorQuery) Object.defineProperty(card, "querySelector", priorQuery);
      else delete card.querySelector;
    });
  }
  return { f, card, native, original: structuredClone(card.output),
    beforeEvents: structuredClone(f.store.events.get()), beforeFinance: finance(f), beforeRequests: f.storeHost.requests.length };
}
function unchanged(x) {
  assert.deepEqual(x.f.store.events.get(), x.beforeEvents, "view and evidence controls author no event");
  assert.deepEqual(x.card.output, x.original, "no image replacement or new take");
  assert.deepEqual(finance(x.f), x.beforeFinance, "no job, token or USD change");
  assert.equal(x.f.storeHost.requests.length, x.beforeRequests, "menu/view/evidence opens issue no HTTP");
}
for (const locale of locales) for (const draft of [false, true]) {
  test("image secondary actions keep direct viewing and current draft promotion " + locale + "/" + draft, async t => {
    const x = await imagePage(t, locale, draft), { f, card } = x;
    assert.equal(actionRows(f, card).length, draft ? 3 : 2, "Open, optional Generate full, one More; Select is not counted as Open");
    const open = f.find("button", node => node.owner === card && hasClass(node, "output-open"));
    assert.equal(open.text, f.i18n.t("output.open"));
    assert.equal(actionRows(f, card).filter(node => hasClass(node, "promote")).length, draft ? 1 : 0);
    if (draft) {
      f.store.busy.set("existing-work"); await f.settle();
      assert.ok(Object.hasOwn(f.find("button", node => node.owner === card && hasClass(node, "promote")).attributes, "disabled"));
      f.store.busy.set(null); await f.settle();
    }
    await f.act(f.find("button", node => node.owner === card && hasClass(node, "output-open")));
    const viewer = f.components().find(component => component.parentElement === card && hasClass(component, "output-card-image-viewer"));
    assert.ok(viewer);
    assert.ok(f.tree().visible("h2").some(node => node.owner === viewer && node.attributes.id === "generated-image-title-" + card.output.id));
    await f.act(f.find("button", node => node.owner === viewer && hasClass(node, "modal-close")));
    assert.equal(f.tree().visible("dialog").filter(node => node.owner === viewer).length, 0);

    let menu = await openMenu(f, card);
    const choices = f.tree().visible("button").filter(node => node.owner === menu && !node.attributes.popovertarget);
    assert.equal(choices.length, 7, "Rename/Pin/Save/Taste/inputs/reuse/export survive without another menu");
    assert.ok(choices.some(node => node.handlers.click?.toString().includes("#renameOutput")));
    assert.ok(choices.some(node => node.handlers.click?.toString().includes("ObjectPinned")));
    assert.ok(choices.some(node => node.handlers.click?.toString().includes("ObjectSaved")));
    assert.ok(choices.some(node => node.handlers.click?.toString().includes("#useAsInput")));
    assert.ok(choices.some(node => node.handlers.click?.toString().includes("#exportOutput")));
    await choose(f, menu, node => node.handlers.click?.toString().includes("#critiqueOpen"));
    const draftText = "  Preserve my exact taste note café العربية 日本語.  ";
    const input = f.find("input", node => node.owner === card && node.attributes.maxlength === "120");
    input.port.value = draftText; await f.act(input, "input");
    menu = await openMenu(f, card);
    await choose(f, menu, node => node.handlers.click?.toString().includes("#inputsOpen"));
    const inspection = f.components().find(component => component.tag === "forma-generation-input-dialog" && component.parentElement === card);
    assert.ok(inspection?.open);
    assert.equal(inspection.inspection.receipt.output.object_id, card.output.id);
    assert.equal(inspection.inspection.receipt.output.document_id, card.output.documentId);
    const close = f.find("button", node => node.owner === inspection && node.attributes["aria-label"] === f.i18n.system("Close generation inputs"));
    await f.act(close);
    assert.equal(f.find("input", node => node.owner === card && node.attributes.maxlength === "120").properties.value, draftText);
    unchanged(x);
  });
}
for (const locale of locales) test("image reader keeps current viewing/download without author or private-input alternatives " + locale, async t => {
  const x = await imagePage(t, locale, true, true), { f, card } = x;
  assert.equal(actionRows(f, card).length, 2);
  assert.equal(actionRows(f, card).filter(node => hasClass(node, "promote")).length, 0);
  assert.equal(f.components().filter(component => component.parentElement === card && hasClass(component, "output-actions-popover")).length, 0,
    "one Download alternative remains direct, not a one-option More");
  const choices = actionRows(f, card);
  const download = choices.find(node => !hasClass(node, "output-open"));
  assert.ok(download?.port?.isConnected);
  assert.equal(download.text, f.i18n.t("projects.downloadMedia"));
  assert.ok(download.handlers.click.toString().includes("#exportOutput"), "same current guarded media executor");
  assert.equal(choices.filter(node => hasClass(node, "output-open")).length, 1);
  unchanged(x);
});


// Real current Library mounts different documents' cards at the same time.
// Synthetic retained history is presentation setup, not generated/approved work.
for (const locale of locales) for (const duplicateNames of [false, true]) {
  test("image More identifies current cross-document work without IDs " + locale + "/" + duplicateNames, async t => {
    const f = await createCalmFullPage(t, { locale });
    // Reuse the accepted View/Alternative native ports before departure,
    // not after the Library destination has already been asserted.
    const native = installOutputNavigationFocusNative(t, f, ports);
    installImageFormatNativeLifetime({ f, h: f.storeHost, after: callback => t.after(callback) });
    const priorHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
    Object.defineProperty(globalThis, "history", { configurable: true, writable: true, value: {
      pushState(_state, _title, path) {
        const url = new URL(path, f.storeHost.location.origin);
        Object.assign(f.storeHost.location, { pathname: url.pathname, search: url.search, hash: url.hash });
      },
      replaceState(...args) { this.pushState(...args); },
    } });
    t.after(() => {
      if (priorHistory) Object.defineProperty(globalThis, "history", priorHistory);
      else delete globalThis.history;
    });
    const destination = f.tree().visible("a").find(node => node.owner.tag === "forma-ui-audience-navigation"
      && new URL(String(node.attributes.href), "http://localhost").pathname === "/library");
    assert.ok(destination, "the ordinary current Library navigation exists");
    native.emit("pointerdown", destination.port);
    native.focus(destination.port);
    await f.act(destination, "click", { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
    assert.equal(f.store.route.get().split(/[?#]/u)[0], "/library");
    assert.ok(f.components().some(component => component.tag === "forma-library" && component.isConnected));
    const docs = ["secondary-private-doc-a", "secondary-private-doc-b"];
    const ids = ["secondary-private-image-a", "secondary-private-image-b"];
    const docTitles = duplicateNames ? ["Repeated context café العربية 日本語", "Repeated context café العربية 日本語"]
      : ["North context café", "South context 日本語"];
    const titles = duplicateNames ? ["Repeated image café العربية 日本語", "Repeated image café العربية 日本語"]
      : ["North image café", "South image 日本語"];
    for (let index = 0; index < docs.length; index++) {
      f.appendEvent("DocumentCreated", { document_id: docs[index], title: docTitles[index] });
      f.appendEvent("GenerationCompleted", { document_id: docs[index], object_id: ids[index], object_ids: [ids[index]],
        generation_id: "secondary-private-generation-" + index, title: titles[index], provider: "fixture",
        media_url: "data:image/png;base64,AA==", media_type: "image/png", image_width: 1, image_height: 1 });
    }
    await f.settle();
    const cards = () => ids.map(id => {
      const values = f.components().filter(component => component.tag === "forma-output-card" && component.output?.id === id);
      assert.equal(values.length, 1, "each exact retained image has one current card");
      return values[0];
    });
    const names = () => {
      const visibleNames = [];
      const nativeNames = cards().map(card => {
        const menu = menuFor(f, card), tree = f.tree();
        const trigger = tree.visible("button").find(node => node.owner === menu && node.attributes.popovertarget);
        assert.ok(trigger?.port?.isConnected);
        assert.equal(trigger.text, menu.label.replace(/\s+/gu, " ").trim());
        assert.ok(trigger.text.startsWith(f.i18n.t("action.more")));
        assert.equal(trigger.text, f.i18n.t("action.more"), "visible action stays concise");
        const name = trigger.attributes["aria-label"];
        assert.equal(name, f.i18n.t("artifact.delivery.namedAction", "{action} — {name}",
          { action: f.i18n.t("action.more"), name: menu.heading }));
        assert.equal(name, menu.triggerAccessibleName, "the exact name belongs to the native invoker");
        assert.ok(name.includes("\u2068") && name.includes("\u2069"), "authored context is bidi isolated");
        assert.ok(name.includes(card.output.title));
        assert.ok(name.includes(docTitles[docs.indexOf(card.output.documentId)]));
        const titles = tree.visible("b").filter(node => node.owner === card && within(node, parent => hasClass(parent, "output-info")));
        assert.equal(titles.length, 1);
        assert.equal(titles[0].text, card.output.title);
        const metadata = tree.visible("small").filter(node => node.owner === card && within(node, parent => hasClass(parent, "output-info")));
        const context = metadata.filter(node => hasClass(node, "output-context"));
        assert.equal(context.length, duplicateNames ? 1 : 0,
          "existing showDocument resolves collisions without adding context to unique ordinary titles");
        if (duplicateNames) {
          assert.ok(context[0].text.includes(docTitles[docs.indexOf(card.output.documentId)]));
          assert.ok(tree.visible("bdi").some(node => node.owner === card && within(node, parent => parent === context[0])),
            "visible authored Document context has its own bidi isolation");
          if (docTitles[0] === docTitles[1]) assert.ok(context[0].text.includes(f.i18n.t("artifact.delivery.documentQualifier",
            "Document {number}", { number: f.i18n.number(docs.indexOf(card.output.documentId) + 1) })));
        }
        const visibleName = [titles[0].text, ...metadata.map(node => node.text)].join(" · ");
        visibleNames.push(visibleName);
        for (const privateId of [...docs, ...ids]) {
          assert.equal(name.includes(privateId), false);
          assert.equal(visibleName.includes(privateId), false);
        }
        assert.equal(menu.heading.includes(f.i18n.t("action.more")), false, "panel heading is the current context, not another action");
        return name;
      });
      assert.equal(new Set(visibleNames.map(value => value.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/gu, " ").trim())).size, 2,
        "closed cards are visibly distinct before any menu or accessible-name inspection");
      return nativeNames;
    };
    const initialNames = names();
    assert.equal(new Set(initialNames.map(value => value.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/gu, " ").trim())).size, 2,
      "same image and document titles have distinct exact native accessible names");
    if (duplicateNames) for (const [index, name] of initialNames.entries()) {
      assert.ok(name.includes(f.i18n.t("artifact.delivery.documentQualifier", "Document {number}", { number: f.i18n.number(index + 1) })));
    }
    const beforeEvents = structuredClone(f.store.events.get()), beforeFinance = finance(f), beforeRequests = f.storeHost.requests.length;
    for (const card of cards()) {
      const menu = await openMenu(f, card);
      await choose(f, menu, node => node.handlers.click?.toString().includes("#inputsOpen"));
      const inspection = f.components().find(component => component.parentElement === card && component.tag === "forma-generation-input-dialog");
      assert.ok(inspection?.open);
      assert.equal(inspection.inspection.receipt.output.object_id, card.output.id);
      assert.equal(inspection.inspection.receipt.output.document_id, card.output.documentId);
      await f.act(f.find("button", node => node.owner === inspection
        && node.attributes["aria-label"] === f.i18n.system("Close generation inputs")));
    }
    assert.deepEqual(f.store.events.get(), beforeEvents);
    assert.deepEqual(finance(f), beforeFinance);
    assert.equal(f.storeHost.requests.length, beforeRequests);
    docTitles[1] = "Current renamed context العربية 日本語";
    f.appendEvent("DocumentRenamed", { document_id: docs[1], new_title: docTitles[1] });
    await f.settle();
    const renamed = names();
    assert.ok(renamed[1].includes(docTitles[1]), "current context is re-derived, not cached in the menu");
    assert.equal(renamed[1].includes(duplicateNames ? "Repeated context" : "South context"), false);
    assert.equal(new Set(renamed).size, 2);
    assert.deepEqual(finance(f), beforeFinance);
    assert.equal(f.storeHost.requests.length, beforeRequests, "name derivation adds no read, write or provider request");
  });
}

// Delimiter-shaped authored titles exercise the existing final Result qualifier.
// The old cross-Document cases above remain unchanged in the baseline.
for (const locale of locales) test("image concise More keeps final qualified context visible before opening / " + locale, async t => {
  const f = await createCalmFullPage(t, { locale });
  // Reuse the accepted View/Alternative native ports before departure,
  // not after the Library destination has already been asserted.
  const native = installOutputNavigationFocusNative(t, f, ports);
  installImageFormatNativeLifetime({ f, h: f.storeHost, after: callback => t.after(callback) });
  const priorHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  Object.defineProperty(globalThis, "history", { configurable: true, writable: true, value: {
    pushState(_state, _title, path) {
      const url = new URL(path, f.storeHost.location.origin);
      Object.assign(f.storeHost.location, { pathname: url.pathname, search: url.search, hash: url.hash });
    },
    replaceState(...args) { this.pushState(...args); },
  } });
  t.after(() => {
    if (priorHistory) Object.defineProperty(globalThis, "history", priorHistory);
    else delete globalThis.history;
  });
  const destination = f.tree().visible("a").find(node => node.owner.tag === "forma-ui-audience-navigation"
    && new URL(String(node.attributes.href), "http://localhost").pathname === "/library");
  assert.ok(destination);
  native.emit("pointerdown", destination.port);
  native.focus(destination.port);
  await f.act(destination, "click", { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
  assert.equal(f.store.route.get().split(/[?#]/u)[0], "/library");
  const docs = ["e2-qualified-doc-a", "e2-qualified-doc-b"], ids = ["e2-qualified-image-a", "e2-qualified-image-b"];
  const titles = ["Exact café العربية 日本語", "Exact café العربية 日本語 · North"];
  const documentTitles = ["North · Shared context", "Shared context"];
  for (let index = 0; index < docs.length; index++) {
    f.appendEvent("DocumentCreated", { document_id: docs[index], title: documentTitles[index] });
    f.appendEvent("GenerationCompleted", { document_id: docs[index], object_id: ids[index], object_ids: [ids[index]],
      generation_id: "e2-qualified-generation-" + index, title: titles[index], provider: "fixture",
      media_url: "data:image/png;base64,AA==", media_type: "image/png", image_width: 1, image_height: 1 });
  }
  await f.settle();
  const beforeEvents = structuredClone(f.store.events.get()), beforeFinance = finance(f), beforeRequests = f.storeHost.requests.length;
  const names = [];
  for (const [index, id] of ids.entries()) {
    const cards = f.components().filter(component => component.tag === "forma-output-card" && component.output?.id === id);
    assert.equal(cards.length, 1);
    const card = cards[0], menu = menuFor(f, card), tree = f.tree();
    const metadata = tree.visible("small").filter(node => node.owner === card && hasClass(node, "output-context"));
    assert.equal(metadata.length, 1, "qualified current context is visible before the menu opens");
    const result = f.i18n.t("artifact.delivery.resultQualifier", "Result {number}", { number: f.i18n.number(index + 1) });
    assert.equal(metadata[0].text, documentTitles[index] + " · " + result);
    const isolated = tree.visible("bdi").filter(node => node.owner === card && within(node, parent => parent === metadata[0]));
    assert.deepEqual(isolated.map(node => node.text), [documentTitles[index], result]);
    const trigger = tree.visible("button").find(node => node.owner === menu && node.attributes.popovertarget);
    assert.ok(trigger?.port?.isConnected);
    assert.equal(trigger.text, f.i18n.t("action.more"));
    const context = "\u2068" + titles[index] + "\u2069 · \u2068" + documentTitles[index] + "\u2069 · \u2068" + result + "\u2069";
    const name = f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", { action: f.i18n.t("action.more"), name: context });
    assert.equal(trigger.attributes["aria-label"], name);
    assert.equal(menu.heading, context);
    assert.equal(menu.querySelector(".ui-popover-panel").attributes["aria-label"], context);
    for (const privateId of [...docs, ...ids]) {
      assert.equal(name.includes(privateId), false);
      assert.equal(metadata[0].text.includes(privateId), false);
    }
    names.push(name);
    await openMenu(f, card);
    menu.close(); await f.settle();
    assert.equal(menu.querySelector(".ui-popover-panel").matches(":popover-open"), false);
  }
  assert.equal(new Set(names).size, 2);
  assert.deepEqual(f.store.events.get(), beforeEvents);
  assert.deepEqual(finance(f), beforeFinance);
  assert.equal(f.storeHost.requests.length, beforeRequests);
});

// Append after the original E2 image20. Reuse its complete current imagePage.
// Added synthetic metadata is not a newly generated image or provider receipt.
for (const [locale, latencyMs, seconds, label] of [
  ["en", 1150, 1.1, "Latency"], ["fr", 1000, 1, "Latence"],
  ["ar", 13456, 13.5, "زمن الاستجابة"], ["ja", 1150, 1.1, "レイテンシー"],
]) test("image comparison explicitly labels retained generation latency " + locale, async t => {
  const x = await imagePage(t, locale, false), { f } = x, initialCounts = f.storeHost.worker.counts();
  const id = "comparison-timing-image-" + locale;
  f.appendEvent("GenerationCompleted", {
    generation_id: "comparison-timing-generation-" + locale, object_ids: [id],
    title: "Retained comparison timing " + locale, model_id: "fixture-image-model", provider: "fixture",
    media_url: x.original.mediaUrl, media_type: x.original.mediaType, image_width: 1536, image_height: 1024,
    latency_ms: latencyMs, quality: "high", purpose: "final",
  });
  f.store.patchUi({ selectedOutputId: id }); await f.settle();
  const cards = f.components().filter(component => component.tag === "forma-output-card" && component.output?.id === id);
  assert.equal(cards.length, 1); x.card = cards[0];
  x.original = structuredClone(x.card.output); x.beforeEvents = structuredClone(f.store.events.get());
  x.beforeFinance = finance(f); x.beforeRequests = f.storeHost.requests.length;
  const beforeContent = structuredClone(f.store.content.get()), { card } = x, out = card.output;
  assert.equal(out.latency, latencyMs); assert.equal(out.width, 1536); assert.equal(out.height, 1024);
  assert.equal(out.modelId, "fixture-image-model"); assert.equal(out.quality, "high"); assert.equal(out.discarded, false);
  assert.equal(f.store.ui.selectedOutputId, id); assert.equal(f.i18n.system("Latency"), label);
  assert.equal(actionRows(f, card).length, 2, "the ordinary full image keeps direct Open and its one existing More owner");
  assert.equal(f.find("button", node => node.owner === card && hasClass(node, "output-open")).text, f.i18n.t("output.open"));
  assert.equal(menuFor(f, card).querySelector(".ui-popover-panel").matches(":popover-open"), false);
  const quality = f.find("span", node => node.owner === card && hasClass(node, "output-quality"));
  assert.equal(quality.text, f.i18n.system("Full quality"));
  const metadata = f.find("small", node => node.owner === card && within(node, parent => hasClass(parent, "output-info")));
  assert.ok(metadata.text.includes("1536 × 1024"), "dimensions remain visible text before the desired label assertion");
  unchanged(x); assert.deepEqual(f.store.content.get(), beforeContent); assert.deepEqual(f.storeHost.worker.counts(), initialCounts);
  const expected = label + " " + f.i18n.number(seconds, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "s";
  assert.ok(metadata.text.endsWith(" · " + expected), "latency is explicit and retains the original toFixed(1) rounding and fixed precision");
});
