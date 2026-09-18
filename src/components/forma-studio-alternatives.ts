import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { navigateInApp, type CommandDeparture } from "./command-departure";
import type { ContextBlock } from "./context-block";
import type { OutputInputEditor } from "./output-input-editor";
import type { FormaOutputRequirements } from "./forma-output-requirements";
import { FormaElement, icon } from "./forma-element";
import { captureOutputNavigationFocus } from "./output-navigation-focus";
import { blockIconName } from "./icon-semantics";
import type { CreativeBlock, EventInput } from "../model/events";
import { BLOCK_GROUPS, BLOCK_TYPES, blockTypeDefinition, suggestedSubtype, type BlockGroup, type BlockKind } from "../model/block-types";
import { documentFocusFromRoute, withDocumentFocusInRoute, withDocumentInRoute } from "../model/routes";
import "./context-block";
import "./context-intelligence";
import "./project-rail";
import "./studio-navigation";
import "./event-inspector";
import "./spatial-scope-editor";
import "./document-generations";
import "./design-system/choice-card";

const slug = (value: string, id = "") => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 42) || (id ? `decision-${id.slice(0, 8)}` : "untitled");

export type AlternativeMode = "board" | "guided" | "layers" | "adaptive" | "editor";

type AlternativeShellOptions = {
  continuity?: boolean;
  inspector?: boolean;
  quietRail?: boolean;
};

export abstract class AlternativeStudio extends FormaElement {
  protected openModel3dUpload() {
    const { documentId, documentTitle } = this.store.projection.get();
    return navigateInApp(this, navigation => navigation.route(withDocumentInRoute("/studio/editor", documentId, documentTitle)));
  }

  /** Child-local work only; Shell retains Source, authority, route and gesture ownership. */
  protected captureAlternativeCommandChildren(): CommandDeparture {
    const { projectId, documentId } = this.store.projection.get();
    const owned = <T extends FormaElement>(selector: string) => [...this.querySelectorAll<T>(selector)]
      .filter(element => element.isConnected && FormaElement.hasStoreIdentity(element, this.store));
    const contexts = owned<ContextBlock>("forma-context-block").map(element => element.captureCommandDeparture());
    const independentInputs = () => owned<OutputInputEditor>("forma-output-input-editor")
      .filter(element => !element.closest("forma-context-block"));
    const inputIdentity = (element: OutputInputEditor) => JSON.stringify([element.block?.projectId, element.block?.documentId,
      element.block?.id, element.block?.type, element.source, element.standalone,
      element.block?.properties.source_artifact_id ?? null, element.block?.properties.source_artifact_kind ?? null,
      element.block?.properties.source_artifact_item_id ?? null, element.block?.properties.source_output_id ?? null]);
    const inputs = independentInputs().map(element => ({ element, identity: inputIdentity(element) }));
    const outputs = owned<FormaOutputRequirements>("forma-output-requirements").map(element => ({ element,
      documentId: element.documentId, blockId: element.blockId, surface: element.surface }));
    return { element: this, current: () => {
      const projection = this.store.projection.get();
      if (!this.isConnected || projection.projectId !== projectId || projection.documentId !== documentId) return false;
      const currentContexts = owned<ContextBlock>("forma-context-block"), currentInputs = independentInputs();
      const currentOutputs = owned<FormaOutputRequirements>("forma-output-requirements");
      return currentContexts.length === contexts.length && contexts.every(capture => currentContexts.includes(capture.element as ContextBlock) && capture.current())
        && currentInputs.length === inputs.length && inputs.every(({ element, identity }) => currentInputs.includes(element) && inputIdentity(element) === identity)
        && currentOutputs.length === outputs.length && outputs.every(({ element, documentId, blockId, surface }) => currentOutputs.includes(element)
          && element.documentId === documentId && element.blockId === blockId && element.surface === surface);
    }, blocked: () => contexts.some(capture => capture.blocked()) || inputs.some(({ element }) => element.localWorkBlocked)
      || outputs.some(({ element }) => element.commandDepartureBlocked), reason: () => "next.lifecycle.currentWorkOpen" };
  }

  protected shell(active: AlternativeMode, title: string, description: string, body: unknown, options: AlternativeShellOptions = {}) {
    const projection = this.store.projection.get();
    const destination = withDocumentFocusInRoute(withDocumentInRoute(`/studio/${active}`, projection.documentId, projection.documentTitle), documentFocusFromRoute(this.store.route.get()));
    return html`<section class="workspace-page studio-subpage studio-alternative">
      <forma-project-rail surface="studio" destination=${destination} ?quiet=${options.quietRail ?? false}></forma-project-rail>
      <div class="studio-main">
        <div class="studio-header-stack">
          <header class="page-header page-header--document">
            <div class="page-header-copy">
              <span class="eyebrow">${projection.projectName} / ${projection.documentTitle} / Document view</span>
              <h1>${this.i18n.system(title)}</h1>
              <p>${this.i18n.system(description)}</p>
            </div>
          </header>
          <forma-studio-mode-nav active=${active}></forma-studio-mode-nav>
        </div>
        <div class="studio-subpage-body">
          ${body}
          <forma-output-requirements .documentId=${projection.documentId}></forma-output-requirements>
          <forma-studio-navigator destination=${destination}></forma-studio-navigator>
          ${options.continuity === false ? nothing : html`<forma-document-continuity view=${active}></forma-document-continuity>`}
          ${active === "board" ? html`<forma-document-generations view=${active}></forma-document-generations>` : nothing}
        </div>
      </div>
      ${options.inspector === false ? nothing : html`<forma-event-inspector></forma-event-inspector>`}
    </section>`;
  }
}

type BoardLane = {
  id: BlockGroup;
  label: string;
  description: string;
  success: string;
  starter: BlockKind;
};

const BOARD_LANES: readonly BoardLane[] = [
  { id: "intent", label: "Purpose", description: "Outcome, audience, message, and emotion", success: "Everyone can tell what success means.", starter: "direction" },
  { id: "scene", label: "World", description: "Subject, environment, motion, and scale", success: "The idea has something concrete to depict.", starter: "subject" },
  { id: "craft", label: "Expression", description: "Composition, camera, light, style, and material", success: "The work has a recognizable visual point of view.", starter: "composition" },
  { id: "constraint", label: "Delivery", description: "Format, brand, accessibility, and exclusions", success: "The result can survive its real destination.", starter: "format" },
  { id: "evidence", label: "Grounding", description: "References that make intent concrete", success: "Important decisions have something visible to point back to.", starter: "reference" },
] as const;

export class FormaContextBoard extends AlternativeStudio {
  #type: BlockKind = "direction";
  #subtype = suggestedSubtype("direction");
  #text = "";
  #userSelectedType = false;
  #cleanType: BlockKind = "direction";
  #cleanSubtype = suggestedSubtype("direction");
  #addRevision = 0;
  #pendingAdds: { current: () => boolean; count: number } | null = null;

  override disconnectedCallback() {
    this.#addRevision++; this.#pendingAdds = null; super.disconnectedCallback();
  }

  captureCommandDeparture(): CommandDeparture {
    const children = this.captureAlternativeCommandChildren();
    return { element: this, current: () => children.current(),
      blocked: () => Boolean(this.#pendingAdds && this.#pendingAdds.count > 0 && this.#pendingAdds.current())
        || this.#text !== "" || this.#type !== this.#cleanType || this.#subtype !== this.#cleanSubtype || children.blocked(),
      reason: () => "next.lifecycle.currentWorkOpen" };
  }

  #group(block: CreativeBlock): BlockGroup {
    return blockTypeDefinition(block.type)?.group ?? "constraint";
  }

  #prepare(type: BlockKind) {
    if (type === "model3d") return;
    const store = this.store, { projectId, documentId } = store.projection.get(), route = store.route.get();
    const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope();
    const focus = captureOutputNavigationFocus(this.ownerDocument), revision = ++this.#addRevision, raw = this.#text;
    this.#type = type;
    this.#subtype = suggestedSubtype(type);
    this.#userSelectedType = true;
    const subtype = this.#subtype;
    let retired = false;
    const current = () => !retired && this.isConnected && this.store === store && store.route.get() === route
      && store.projection.get().projectId === projectId && store.projection.get().documentId === documentId
      && store.sourceOwnershipActive(source) && Boolean(authorization && store.authorizationScopeActive(authorization))
      && this.#addRevision === revision && this.#text === raw && this.#type === type && this.#subtype === subtype;
    const unsubscribe = store.subscribe(() => { if (!current()) retired = true; });
    this.requestUpdate();
    void this.updateComplete.then(() => {
      if (!current()) return;
      const field = this.querySelector<HTMLInputElement>("#board-decision");
      if (field) focus.run(field, () => { field.focus(); return true; });
    }, () => undefined).finally(() => { unsubscribe(); focus.dispose(); });
  }

  async #add(event: SubmitEvent) {
    event.preventDefault();
    const raw = this.#text, text = raw.trim(), type = this.#type, subtype = this.#subtype, revision = this.#addRevision;
    if (!text || type === "model3d") return;
    const store = this.store, projection = store.projection.get(), route = store.route.get();
    const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope();
    const scopeCurrent = () => this.isConnected && this.store === store && store.route.get() === route
      && store.projection.get().projectId === projection.projectId && store.projection.get().documentId === projection.documentId
      && store.sourceOwnershipActive(source) && Boolean(authorization && store.authorizationScopeActive(authorization));
    if (!scopeCurrent()) return;
    let pending = this.#pendingAdds;
    if (!pending || !pending.current()) {
      let retired = false;
      pending = { count: 0, current: () => {
        if (retired || this.#pendingAdds !== pending || !scopeCurrent()) { retired = true; return false; }
        return true;
      } };
      this.#pendingAdds = pending;
    }
    // The same content-free current/count pattern as Guided/Editor. Observe
    // scope changes synchronously so route/authority ABA cannot revive A.
    const operation = pending, unsubscribe = store.subscribe(() => { operation.current(); });
    operation.count++; this.requestUpdate();
    const id = crypto.randomUUID();
    try {
      const appended = await store.append({
        type: "BlockCreated",
        payload: {
          block_id: id,
          document_id: projection.documentId,
          type,
          handle: `${type}/${slug(text, id)}`,
          position: `z${String(store.head.get() + 1).padStart(5, "0")}`,
          properties: { text, subtype, weight: .65, authority: "authored", created_from: "context-board" },
        },
      });
      if (!operation.current() || !appended.some(row => row.type === "BlockCreated" && row.payload.block_id === id
        && row.payload.document_id === projection.documentId)
        || this.#addRevision !== revision || this.#text !== raw || this.#type !== type || this.#subtype !== subtype) return;
      this.#text = "";
      this.#userSelectedType = false;
      this.#addRevision++;
      store.patchUi({ focusBlockId: id });
    } finally {
      unsubscribe(); const current = operation.current(); operation.count--;
      if (this.#pendingAdds === operation) {
        if (operation.count === 0) this.#pendingAdds = null;
        if (current) this.requestUpdate();
      }
    }
  }

  override render() {
    const blocks = this.store.projection.get().blocks;
    const resolvedGroups = new Set(blocks.map((block) => this.#group(block)));
    const coreLanes = BOARD_LANES.filter((lane) => lane.id !== "evidence");
    const resolvedCore = coreLanes.filter((lane) => resolvedGroups.has(lane.id)).length;
    const nextLane = coreLanes.find((lane) => !resolvedGroups.has(lane.id)) ?? BOARD_LANES.find((lane) => !resolvedGroups.has(lane.id));
    if (nextLane && !this.#userSelectedType && !this.#text && this.#type !== nextLane.starter) {
      this.#type = nextLane.starter;
      this.#subtype = suggestedSubtype(nextLane.starter);
    }
    if (!this.#userSelectedType && !this.#text) {
      this.#cleanType = this.#type;
      this.#cleanSubtype = this.#subtype;
    }
    const definition = blockTypeDefinition(this.#type)!;
    const ready = resolvedCore === coreLanes.length;
    const readiness = html`
      <section class="view-success-hero board-success">
        <div class="view-success-copy">
          <span class="eyebrow">Plan at a glance</span>
          <h2>See what the document knows—and what still needs a decision</h2>
          <p>Use the board to find gaps before they become vague generations or late production surprises.</p>
        </div>
        <div class="view-readiness" aria-label="Document readiness">
          <span>Foundations</span>
          <b>${resolvedCore} of ${coreLanes.length} clear</b>
          <i style=${`--progress:${resolvedCore / coreLanes.length}`}></i>
          <small>${ready ? this.i18n.system("Ready to refine with evidence and nuance.") : this.i18n.system("{label} is the clearest next gap.", { label: this.i18n.system(String(nextLane?.label)) })}</small>
        </div>
        <aside class="next-best-action">
          <span>Next useful move</span>
          <b>${nextLane ? this.i18n.system("Clarify {value}", { value: this.i18n.system(nextLane.label).toLocaleLowerCase(this.i18n.locale) }) : this.i18n.system("Test the plan as a whole")}</b>
          <p>${(nextLane?this.i18n.system(nextLane.success):undefined) ?? this.i18n.system("All five areas are represented. Look for contradictions, weak influence, or a missing reference.")}</p>
          ${nextLane ? html`<button class="button secondary compact" @click=${() => this.#prepare(nextLane.starter)}>Prepare this decision ${icon("arrow")}</button>` : html`<button class="button secondary compact" @click=${() => void navigateInApp(this, navigation => navigation.route("/studio/layers"))}>Shape influence ${icon("arrow")}</button>`}
        </aside>
      </section>`;
    const capture = html`
      <section class="board-capture" aria-labelledby="board-capture-title">
        <div>
          <h2 id="board-capture-title">Add context</h2>
          <p>Choose the kind of creative decision you want to shape. You can edit or remove it later.</p>
          <button type="button" class="button secondary compact" @click=${() => this.openModel3dUpload()}>${this.i18n.t("model3d.upload.label", "Upload an owned or licensed 3D model")}</button>
          <p class="section-note">${this.i18n.t("model3d.upload.detail", "Upload a self-contained GLB up to 64 MB, then save the view that should guide generation.")}</p>
        </div>
        <form class="board-quick-add" @submit=${this.#add}>
          <label>Block type
            <select .value=${this.#type} @change=${(event: Event) => { const type = (event.target as HTMLSelectElement).value as BlockKind; if (type === "model3d") return; this.#addRevision++; this.#type = type; this.#subtype = suggestedSubtype(this.#type); this.#userSelectedType = true; this.requestUpdate(); }}>
              ${BLOCK_TYPES.filter((item) => item.type !== "model3d").map((item) => html`<option value=${item.type}>${this.i18n.system(item.label)}</option>`)}
            </select>
          </label>
          <label>Starting point
            <select .value=${this.#subtype} @change=${(event: Event) => { this.#addRevision++; this.#subtype = (event.target as HTMLSelectElement).value; this.#userSelectedType = true; }}>
              ${definition.subtypes.map((subtype) => html`<option value=${subtype}>${this.i18n.system(subtype)}</option>`)}
            </select>
          </label>
          <label>Your decision
            <input id="board-decision" required placeholder=${this.i18n.system(definition.prompt)} .value=${this.#text} @input=${(event: InputEvent) => { this.#addRevision++; this.#text = (event.target as HTMLInputElement).value; this.requestUpdate(); }}>
          </label>
          <button class="button primary" ?disabled=${!this.#text.trim()}>${icon("plus")} Add context</button>
        </form>
      </section>`;
    const body = html`
      <div class="context-board" data-forma-content="primary">
        ${BOARD_LANES.map((lane) => {
          const items = blocks.filter((block) => this.#group(block) === lane.id);
          return html`<section class=${`board-lane board-lane--${lane.id}`}>
            <header>
              <span>${items.length}</span>
              <h3>${this.i18n.system(lane.label)}</h3>
              <p>${this.i18n.system(lane.description)}</p>
              <small>${items.length ? this.i18n.system(lane.success) : this.i18n.system("This is still open.")}</small>
            </header>
            <div class="board-lane-blocks">
              ${items.map((block) => html`<forma-context-block .block=${block} surface="board"></forma-context-block>`)}
              ${!items.length ? html`<forma-ui-choice-card class="board-context-choice" compact .label=${this.i18n.system(blockTypeDefinition(lane.starter)?.label??lane.starter)} .detail=${this.i18n.system(lane.description)} .iconName=${blockIconName(lane.starter)} .value=${lane.starter} @forma-action=${() => this.#prepare(lane.starter)}></forma-ui-choice-card>` : nothing}
            </div>
          </section>`;
        })}
      </div>
      ${capture}
      ${readiness}`;
    return this.shell("board", "Context board", "See what is clear, what is missing, and what deserves attention next.", body);
  }
}

type BriefField = { type: BlockKind; label: string; question: string; help: string };
type BriefSection = { id: string; label: string; title: string; outcome: string; fields: readonly BriefField[] };

const BRIEF_SECTIONS: readonly BriefSection[] = [
  { id: "purpose", label: "Purpose", title: "Give the work a reason to exist", outcome: "A collaborator can explain the goal, audience, and takeaway in one pass.", fields: [
    { type: "direction", label: "Outcome", question: "What should this work accomplish?", help: "Name the change or result worth protecting." },
    { type: "audience", label: "Audience", question: "Who must this work reach?", help: "Include where or how they will encounter it." },
    { type: "message", label: "Takeaway", question: "What should remain with them?", help: "A single idea is stronger than a list of claims." },
  ] },
  { id: "world", label: "World", title: "Make the idea concrete", outcome: "The scene has a subject and a believable place to happen.", fields: [
    { type: "subject", label: "Subject", question: "What must be present or depicted?", help: "Name the people, objects, or ideas that carry the work." },
    { type: "environment", label: "Environment", question: "Where does this reality take place?", help: "Describe the physical, social, or abstract setting." },
  ] },
  { id: "expression", label: "Expression", title: "Choose how the work should feel", outcome: "Mood, visual language, and reading order reinforce one another.", fields: [
    { type: "emotion", label: "Feeling", question: "What should someone feel first?", help: "Name the energy, tension, or emotional contrast." },
    { type: "style", label: "Visual language", question: "What treatment should unify the work?", help: "Describe era, medium, texture, or finish without relying on empty style labels." },
    { type: "composition", label: "Reading order", question: "What should the eye understand first?", help: "Describe the focal hierarchy, crop, or use of space." },
  ] },
  { id: "delivery", label: "Delivery", title: "Prepare the work for the real world", outcome: "The direction can survive its channel, audience needs, and known failure modes.", fields: [
    { type: "format", label: "Destination", question: "Where and at what dimensions will this live?", help: "Include channel, ratio, resolution, or protected areas." },
    { type: "accessibility", label: "Access", question: "What must remain perceivable or understandable?", help: "Protect contrast, legibility, motion comfort, or cultural clarity." },
    { type: "exclusion", label: "Guardrail", question: "What would break the direction?", help: "Name a specific failure mode, unwanted motif, or safety boundary." },
  ] },
] as const;

const ALL_BRIEF_FIELDS = BRIEF_SECTIONS.flatMap((section) => section.fields);

export class FormaGuidedBrief extends AlternativeStudio {
  #drafts: Record<string, string> = {};
  #subtypes: Record<string, string> = {};
  #seededDocument = "";
  #step = 0;
  // Content-free edit identity; raw answers remain only in the existing fields.
  #fieldEdits = new Map<BlockKind, { dirty: boolean }>();
  #pendingSaves: { current: () => boolean; count: number } | null = null;

  override disconnectedCallback() {
    this.#fieldEdits = new Map();
    this.#seededDocument = "";
    super.disconnectedCallback();
  }

  #markFieldEdit(type: BlockKind) {
    const seed = this.#fieldSeed(type);
    this.#fieldEdits.set(type, { dirty: (this.#drafts[type] ?? "") !== seed.text
      || (this.#subtypes[type] ?? suggestedSubtype(type)) !== seed.subtype });
  }

  #fieldSeed(type: BlockKind) {
    const block = this.store.projection.get().blocks.find(item => item.type === type);
    return {
      text: block ? String(block.properties.artifact_markdown ?? block.properties.text ?? block.properties.label ?? "") : "",
      subtype: String(block?.properties.subtype ?? suggestedSubtype(type)),
    };
  }

  captureCommandDeparture(): CommandDeparture {
    const children = this.captureAlternativeCommandChildren(), seededDocument = this.#seededDocument;
    return { element: this, current: () => children.current() && this.#seededDocument === seededDocument,
      blocked: () => Boolean(this.#pendingSaves && this.#pendingSaves.count > 0 && this.#pendingSaves.current())
        || ALL_BRIEF_FIELDS.some(({ type }) => {
        const seed = this.#fieldSeed(type);
        return (this.#drafts[type] ?? "") !== seed.text || (this.#subtypes[type] ?? suggestedSubtype(type)) !== seed.subtype;
      }) || children.blocked(), reason: () => "next.lifecycle.currentWorkOpen" };
  }

  #seed() {
    const projection = this.store.projection.get();
    if (this.#seededDocument !== projection.documentId) {
      this.#drafts = {};
      this.#subtypes = {};
      this.#fieldEdits = new Map();
      this.#step = 0;
      this.#seededDocument = projection.documentId;
    }
    for (const field of ALL_BRIEF_FIELDS) {
      if (this.#fieldEdits.get(field.type)?.dirty) continue;
      const seed = this.#fieldSeed(field.type);
      this.#drafts[field.type] = seed.text;
      this.#subtypes[field.type] = seed.subtype;
    }
  }

  #eventsFor(fields: readonly BriefField[]) {
    const projection = this.store.projection.get();
    const events: EventInput[] = [];
    for (const field of fields) {
      const current = projection.blocks.find((block) => block.type === field.type);
      const adopted = Boolean(current?.properties.source_artifact_id || current?.properties.source_output_id);
      const value = adopted ? this.#drafts[field.type] ?? "" : (this.#drafts[field.type] ?? "").trim();
      if (!value && !adopted) continue;
      const subtype = this.#subtypes[field.type] ?? suggestedSubtype(field.type);
      if (current) {
        const oldValue = String(current.properties.artifact_markdown ?? current.properties.text ?? current.properties.label ?? "");
        if (oldValue !== value) events.push(...this.store.outputBlockTextEvents(current.id, value, "guided-brief"));
        const oldSubtype = String(current.properties.subtype ?? suggestedSubtype(field.type));
        if (oldSubtype !== subtype) events.push({ type: "BlockPropertyEdited", payload: { block_id: current.id, property_path: "subtype", old_value: oldSubtype, new_value: subtype, source_surface: "guided-brief" } });
      } else {
        const id = crypto.randomUUID();
        events.push({ type: "BlockCreated", payload: { block_id: id, document_id: projection.documentId, type: field.type, handle: `${field.type}/${slug(value, id)}`, position: `z${String(this.store.head.get() + events.length + 1).padStart(5, "0")}`, properties: { text: value, subtype, weight: .68, authority: "authored", created_from: "guided-brief" } } });
      }
    }
    return events;
  }

  #goToStep(step: number) {
    this.#step = Math.max(0, Math.min(BRIEF_SECTIONS.length - 1, step));
    this.requestUpdate();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async #saveSection(event: SubmitEvent) {
    event.preventDefault();
    const step = this.#step, section = BRIEF_SECTIONS[step], projection = this.store.projection.get();
    const source = this.store.captureSourceOwnership(), authorization = this.store.captureAuthorizationScope(), edits = this.#fieldEdits;
    const current = () => {
      const now = this.store.projection.get();
      return this.isConnected && this.#fieldEdits === edits && this.#seededDocument === projection.documentId
        && now.projectId === projection.projectId && now.documentId === projection.documentId
        && this.store.sourceOwnershipActive(source) && authorization && this.store.authorizationScopeActive(authorization);
    };
    if (!current()) return;
    const submitted = section.fields.map(({ type }) => {
      const raw = this.#drafts[type] ?? "", subtype = this.#subtypes[type] ?? suggestedSubtype(type);
      const block = projection.blocks.find(value => value.type === type);
      const adopted = Boolean(block?.properties.source_artifact_id || block?.properties.source_output_id);
      return { type, raw, subtype, value: adopted ? raw : raw.trim(), edit: edits.get(type) };
    });
    const events = this.#eventsFor(section.fields);
    if (events.length) {
      // Same content-free scoped count as CreativeEditor; the field lifetime
      // also prevents disconnect/Document ABA from reviving this continuation.
      let pending = this.#pendingSaves;
      if (!pending || !pending.current()) this.#pendingSaves = pending = { count: 0, current: () => Boolean(current()) };
      pending.count += 1;
      this.requestUpdate();
      try {
        const result = await this.store.appendBatchWithReceipt(events), acknowledgment = result.acknowledgment;
        if (!current() || result.publication !== "published" || acknowledgment.outcome !== "observed"
          || acknowledgment.privateUnavailable || acknowledgment.rejectedIndices.length
          || acknowledgment.action !== (events.length > 1 ? "batch" : "append") || acknowledgment.committed.length !== events.length) return;
        const newerFields = submitted.some(field => edits.get(field.type) !== field.edit && edits.get(field.type)?.dirty);
        this.store.toast(newerFields
          ? this.i18n.t("guided.save.newerEditsKept", "The earlier submission was saved. Your newer edits are still here.")
          : this.i18n.system("{section} saved to the document.",{section:this.i18n.system(section.label)}));
      } finally {
        pending.count -= 1;
        if (this.#pendingSaves === pending) {
          if (pending.count === 0) this.#pendingSaves = null;
          if (pending.current()) this.requestUpdate();
        }
      }
    } else {
      this.store.toast(this.i18n.system("{section} already matches the document.",{section:this.i18n.system(section.label)}));
    }
    // Deliberate already-matches Save uses the same exact-value check. An empty
    // builder result alone (for example a locked/skipped field) cannot consume it.
    const unchanged = (field: (typeof submitted)[number]) => edits.get(field.type) === field.edit
      && (this.#drafts[field.type] ?? "") === field.raw
      && (this.#subtypes[field.type] ?? suggestedSubtype(field.type)) === field.subtype;
    const sectionUnchanged = submitted.every(unchanged);
    for (const field of submitted) {
      const seed = this.#fieldSeed(field.type);
      if (!current() || !unchanged(field) || seed.text !== field.value || seed.subtype !== field.subtype) continue;
      this.#drafts[field.type] = seed.text;
      this.#subtypes[field.type] = seed.subtype;
      edits.set(field.type, { dirty: false });
    }
    if (!current()) return;
    if (sectionUnchanged && this.#step === step && step < BRIEF_SECTIONS.length - 1) this.#goToStep(step + 1);
    else this.requestUpdate();
  }

  override render() {
    this.#seed();
    const projection = this.store.projection.get();
    const section = BRIEF_SECTIONS[this.#step];
    const guidedFormId = `guided-brief-${projection.documentId}`;
    const answered = ALL_BRIEF_FIELDS.filter((field) => (this.#drafts[field.type] ?? "").trim()).length;
    const activeAnswered = section.fields.filter((field) => (this.#drafts[field.type] ?? "").trim()).length;
    const readiness = html`
      <section class="view-success-hero guided-success">
        <div class="view-success-copy">
          <span class="eyebrow">A brief that earns confidence</span>
          <h2>Build the document one useful conversation at a time</h2>
          <p>Each section prepares a different kind of success: a clear purpose, a concrete world, a coherent expression, and a deliverable result.</p>
        </div>
        <div class="view-readiness" aria-label="Brief progress">
          <span>Brief coverage</span>
          <b>${answered} of ${ALL_BRIEF_FIELDS.length} answered</b>
          <i style=${`--progress:${answered / ALL_BRIEF_FIELDS.length}`}></i>
          <small>${answered === ALL_BRIEF_FIELDS.length ? this.i18n.system("Ready for a final consistency check.") : this.i18n.system("{label} is open now.", { label: this.i18n.system(section.label) })}</small>
        </div>
        <aside class="next-best-action">
          <span>This section prepares</span>
          <b>${this.i18n.system(section.outcome)}</b>
          <p>${activeAnswered}/${section.fields.length} answers are ready to save.</p>
        </aside>
      </section>`;
    const steps = html`
      <nav class="guided-step-nav" aria-label="Brief sections">
        ${BRIEF_SECTIONS.map((item, index) => {
          const complete = item.fields.every((field) => (this.#drafts[field.type] ?? "").trim());
          return html`<button class=${`${index === this.#step ? "active" : ""} ${complete ? "complete" : ""}`} aria-current=${index === this.#step ? "step" : nothing} @click=${() => this.#goToStep(index)}>
            <i>${complete ? icon("check") : index + 1}</i><span><b>${this.i18n.system(item.label)}</b><small>${complete ? this.i18n.system("Ready") : this.i18n.system(item.title)}</small></span>
          </button>`;
        })}
      </nav>`;
    const body = html`
      <form id=${guidedFormId} @submit=${this.#saveSection}></form>
      <section class="guided-brief guided-brief--focused">
        <header class="guided-section-header">
          <span class="eyebrow">Step ${this.#step + 1} of ${BRIEF_SECTIONS.length}</span>
          <h2>${this.i18n.system(section.title)}</h2>
          <p>${this.i18n.system(section.outcome)}</p>
        </header>
        <div class="guided-question-grid">
          ${section.fields.map((field) => {
            const existing = projection.blocks.find((block) => block.type === field.type);
            const definition = blockTypeDefinition(field.type)!;
            return html`<section class="guided-question">
              <header>
                <span aria-hidden="true">${icon(blockIconName(field.type))}</span>
                <div><small>${this.i18n.system(field.label)}</small><h3>${this.i18n.system(field.question)}</h3></div>
                ${existing ? html`<b class="resolved-chip">In document</b>` : html`<b class="unresolved-chip">Open</b>`}
              </header>
              <p>${this.i18n.system(field.help)}</p>
              <label class="guided-subtype">Starting point
                <select form=${guidedFormId} .value=${this.#subtypes[field.type]} @change=${(event: Event) => { this.#subtypes[field.type] = (event.target as HTMLSelectElement).value; this.#markFieldEdit(field.type); this.requestUpdate(); }}>
                  ${repeat([...new Set([this.#subtypes[field.type] ?? suggestedSubtype(field.type), ...definition.subtypes])], (subtype) => subtype, (subtype) => html`<option value=${subtype} ?selected=${subtype === (this.#subtypes[field.type] ?? suggestedSubtype(field.type))}>${this.i18n.system(subtype)}</option>`)}
                </select>
              </label>
              <label class="sr-only" for=${`brief-${field.type}`}>${this.i18n.system(field.question)}</label>
              <textarea id=${`brief-${field.type}`} form=${guidedFormId} rows="4" placeholder=${this.i18n.system(definition.prompt)} .value=${this.#drafts[field.type] ?? ""} @input=${(event: InputEvent) => { this.#drafts[field.type] = (event.target as HTMLTextAreaElement).value; this.#markFieldEdit(field.type); this.requestUpdate(); }}></textarea>
              <small class="guided-source">${existing ? this.i18n.system("Saving will update this answer everywhere it appears.") : this.i18n.system("Saving will add this decision to the document.")}</small>
              ${existing ? html`<forma-spatial-scope-editor .block=${existing} surface="guided"></forma-spatial-scope-editor><forma-context-intelligence .block=${existing} surface="guided" compact></forma-context-intelligence>` : html`<small class="guided-scope-pending">Save this answer, then choose whether it affects everything or one area.</small>`}
            </section>`;
          })}
        </div>
        <footer class="guided-actions">
          <div><b>${activeAnswered === section.fields.length ? this.i18n.system("{label} is ready.", { label: this.i18n.system(section.label) }) : this.i18n.system("You can leave uncertainty visible.")}</b><small>${activeAnswered === section.fields.length ? this.i18n.system("Save and move to the next part of the brief.") : this.i18n.system("Blank answers remain open; Forma will not invent them.")}</small></div>
          <span class="guided-action-buttons">
            ${this.#step > 0 ? html`<button type="button" class="button ghost" @click=${() => this.#goToStep(this.#step - 1)}>Back</button>` : nothing}
            ${this.#step < BRIEF_SECTIONS.length - 1 && activeAnswered < section.fields.length ? html`<button type="button" class="button ghost" @click=${() => this.#goToStep(this.#step + 1)}>Skip for now</button>` : nothing}
            <button type="submit" form=${guidedFormId} class="button primary">${this.#step < BRIEF_SECTIONS.length - 1 ? this.i18n.system("Save & continue") : this.i18n.system("Save brief")} ${icon("arrow")}</button>
          </span>
        </footer>
      </section>

      ${steps}
      ${readiness}
      <forma-document-generations view="guided" presentation="compact"></forma-document-generations>

      <section class="whole-document-map" aria-labelledby="guided-whole-document-title">
        <header>
          <div><span class="eyebrow">Whole-document check</span><h2 id="guided-whole-document-title">Everything already shaping ${projection.documentTitle}</h2><p>The interview focuses a few questions at a time; this map keeps every other saved decision visible.</p></div>
          <strong>${projection.blocks.length} decisions</strong>
        </header>
        <div class="whole-document-groups">
          ${BLOCK_GROUPS.map((group) => {
            const items = projection.blocks.filter((block) => blockTypeDefinition(block.type)?.group === group.id);
            return html`<section>
              <header><h3>${this.i18n.system(group.label)}</h3><span>${items.length}</span></header>
              ${items.length ? html`<ul>${items.map((block) => {
                const fieldSection = BRIEF_SECTIONS.findIndex((candidate) => candidate.fields.some((field) => field.type === block.type));
                return html`<li>
                  <button @click=${() => fieldSection >= 0 ? this.#goToStep(fieldSection) : void navigateInApp(this, navigation => navigation.route("/"))}>
                    <span><b>${this.i18n.system(blockTypeDefinition(block.type)?.label??block.type)}</b><small>${(typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype ?? block.handle))}</small></span>
                    <em>${String(block.properties.artifact_markdown ?? block.properties.text ?? block.properties.label ?? block.handle)}</em>
                    <i>${fieldSection >= 0 ? this.i18n.system("Review answer") : this.i18n.system("Open baseline")} ${icon("arrow")}</i>
                  </button>
                  <forma-context-intelligence .block=${block} surface="guided" compact></forma-context-intelligence>
                </li>`;
              })}</ul>` : html`<p>${this.i18n.system("No saved {group} yet.",{group:this.i18n.system(group.label).toLocaleLowerCase(this.i18n.locale)})}</p>`}
            </section>`;
          })}
        </div>
      </section>`;
    return this.shell("guided", "Guided brief", "Prepare a complete, usable brief without facing every decision at once.", body);
  }
}

if (!customElements.get("forma-context-board")) customElements.define("forma-context-board", FormaContextBoard);
if (!customElements.get("forma-guided-brief")) customElements.define("forma-guided-brief", FormaGuidedBrief);
