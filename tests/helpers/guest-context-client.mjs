import { buildExperiencePlan, experienceDocumentRoute, initialValues, registeredExperience } from "../../src/experiences/intake.ts";

/** Exact context-only server response shape. The plan is produced by the real
 * compiler; this transport fixture does not prove server custody or auth. */
export async function guestContextResponse({ destinationUserId = "canonical-owner", sessionId = "11111111-1111-4111-8111-111111111111" } = {}) {
  const release = await registeredExperience("image"), values = initialValues(release);
  values.subject = { value: "A copper lamp beside a window", provenance: "authored" };
  values.ratio = { value: { width: 1, height: 1 }, provenance: "authored" };
  const plan = await buildExperiencePlan("guest:22222222-2222-4222-8222-222222222222", {
    intentId: sessionId, experienceId: "image", releaseHash: release.releaseHash, values,
  }, release);
  const appended = plan.events.map((event, index) => ({
    eventId: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
    streamId: `creative:${destinationUserId}`, sequence: 17 + index,
    occurredAt: "2026-09-17T12:00:00.000Z", recordedAt: "2026-09-17T12:00:00.000Z",
    actor: "user", clientId: "server:guest-context-adoption", correlationId: `guest-context-adoption:${sessionId}`,
    causationId: null, compensatesEventId: null, schemaVersion: 1, type: event.type,
    payload: { ...structuredClone(event.payload), client_event_id: `guest-context-adoption:v1:${sessionId}:${index}` },
  }));
  return structuredClone({
    version: 1, status: "context-only", plan, expiresAt: "2035-09-17T12:00:00.000Z",
    custody: {
      version: 1, kind: "guest-context", sessionId, destinationUserId,
      manifestDigest: `sha256:${"a".repeat(64)}`, lineageDigest: `sha256:${"b".repeat(64)}`,
      draftId: plan.draftId, draftHash: plan.draftHash, projectId: plan.projectId, documentId: plan.documentId,
      targetStreamId: `creative:${destinationUserId}`, eventIds: appended.map(event => event.eventId),
      head: appended.at(-1).sequence, documentRoute: experienceDocumentRoute(plan), appended,
    },
    generationAvailable: false, miniAppClaimComplete: false, replayed: true,
  });
}

/** Explicit DOM port for complete ExperienceView behavior. These tests qualify
 * controls, links and lifetime, not browser layout, mobile or assistive tech. */
class Element extends EventTarget {
  constructor(tag, ownerDocument) {
    super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument;
    this.children = []; this.parentElement = null; this.hidden = false; this.className = "";
    this.attributes = new Map(); this.text = ""; this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
  }
  get classList() { return {
    add: name => { this.className = [...new Set([...this.className.split(" "), name])].join(" "); },
    remove: name => { this.className = this.className.split(" ").filter(value => value !== name).join(" "); },
  }; }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  append(...children) {
    for (const child of children) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(value => value !== child);
      child.parentElement = this; this.children.push(child);
    }
  }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.text = ""; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector) {
    const selectors = selector.split(",").map(value => value.trim());
    return this.all().filter(child => selectors.some(value => value === "*" || (value.startsWith(".") ? child.className.split(" ").includes(value.slice(1)) : child.tagName === value.toUpperCase())));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
}
export function installGuestContextDom(t, { href = "https://forma.example/experiences/image", globalHref } = {}) {
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document"), savedLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const createdTags = [], document = { activeElement: null,
    ...(href === null ? {} : { location: { href } }),
    createElement(tag) { createdTags.push(tag.toUpperCase()); return new Element(tag, this); },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  if (globalHref === undefined) delete globalThis.location;
  else Object.defineProperty(globalThis, "location", { configurable: true, value: { href: globalHref } });
  t.after(() => {
    if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument); else delete globalThis.document;
    if (savedLocation) Object.defineProperty(globalThis, "location", savedLocation); else delete globalThis.location;
  });
  return { root: document.createElement("main"), document, createdTags };
}
export const settle = () => new Promise(resolve => setImmediate(resolve));
export const findLink = (root, label) => root.all().find(element => element.tagName === "A" && element.textContent === label);
export function visible(element) { for (let node = element; node; node = node.parentElement) if (node.hidden) return false; return true; }
