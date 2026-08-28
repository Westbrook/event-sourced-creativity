import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
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

  #group(block: CreativeBlock): BlockGroup {
    return blockTypeDefinition(block.type)?.group ?? "constraint";
  }

  #prepare(type: BlockKind) {
    this.#type = type;
    this.#subtype = suggestedSubtype(type);
    this.#userSelectedType = true;
    this.requestUpdate();
    void this.updateComplete.then(() => this.querySelector<HTMLInputElement>("#board-decision")?.focus());
  }

  async #add(event: SubmitEvent) {
    event.preventDefault();
    const text = this.#text.trim();
    if (!text) return;
    const projection = this.store.projection.get();
    const id = crypto.randomUUID();
    const appended = await this.store.append({
      type: "BlockCreated",
      payload: {
        block_id: id,
        document_id: projection.documentId,
        type: this.#type,
        handle: `${this.#type}/${slug(text, id)}`,
        position: `z${String(this.store.head.get() + 1).padStart(5, "0")}`,
        properties: { text, subtype: this.#subtype, weight: .65, authority: "authored", created_from: "context-board" },
      },
    });
    if (appended.length) {
      this.#text = "";
      this.#userSelectedType = false;
      this.store.patchUi({ focusBlockId: id });
      this.requestUpdate();
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
          ${nextLane ? html`<button class="button secondary compact" @click=${() => this.#prepare(nextLane.starter)}>Prepare this decision ${icon("arrow")}</button>` : html`<button class="button secondary compact" @click=${() => this.store.setRoute("/studio/layers")}>Shape influence ${icon("arrow")}</button>`}
        </aside>
      </section>`;
    const capture = html`
      <section class="board-capture" aria-labelledby="board-capture-title">
        <div>
          <h2 id="board-capture-title">Add context</h2>
          <p>Choose the kind of creative decision you want to shape. You can edit or remove it later.</p>
        </div>
        <form class="board-quick-add" @submit=${this.#add}>
          <label>Block type
            <select .value=${this.#type} @change=${(event: Event) => { this.#type = (event.target as HTMLSelectElement).value as BlockKind; this.#subtype = suggestedSubtype(this.#type); this.#userSelectedType = true; this.requestUpdate(); }}>
              ${BLOCK_TYPES.map((item) => html`<option value=${item.type}>${this.i18n.system(item.label)}</option>`)}
            </select>
          </label>
          <label>Starting point
            <select .value=${this.#subtype} @change=${(event: Event) => { this.#subtype = (event.target as HTMLSelectElement).value; }}>
              ${definition.subtypes.map((subtype) => html`<option value=${subtype}>${this.i18n.system(subtype)}</option>`)}
            </select>
          </label>
          <label>Your decision
            <input id="board-decision" required placeholder=${this.i18n.system(definition.prompt)} .value=${this.#text} @input=${(event: InputEvent) => { this.#text = (event.target as HTMLInputElement).value; this.requestUpdate(); }}>
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

  #seed() {
    const projection = this.store.projection.get();
    if (this.#seededDocument === projection.documentId) return;
    this.#drafts = {};
    this.#subtypes = {};
    for (const field of ALL_BRIEF_FIELDS) {
      const block = projection.blocks.find((item) => item.type === field.type);
      this.#drafts[field.type] = block ? String(block.properties.artifact_markdown ?? block.properties.text ?? block.properties.label ?? "") : "";
      this.#subtypes[field.type] = String(block?.properties.subtype ?? suggestedSubtype(field.type));
    }
    this.#step = 0;
    this.#seededDocument = projection.documentId;
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
    const section = BRIEF_SECTIONS[this.#step];
    const events = this.#eventsFor(section.fields);
    if (events.length) {
      const appended = await this.store.appendBatch(events);
      if (!appended.length) return;
      this.store.toast(this.i18n.system("{section} saved to the document.",{section:this.i18n.system(section.label)}));
    } else {
      this.store.toast(this.i18n.system("{section} already matches the document.",{section:this.i18n.system(section.label)}));
    }
    if (this.#step < BRIEF_SECTIONS.length - 1) this.#goToStep(this.#step + 1);
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
                <select form=${guidedFormId} .value=${this.#subtypes[field.type]} @change=${(event: Event) => { this.#subtypes[field.type] = (event.target as HTMLSelectElement).value; this.requestUpdate(); }}>
                  ${definition.subtypes.map((subtype) => html`<option value=${subtype}>${this.i18n.system(subtype)}</option>`)}
                </select>
              </label>
              <label class="sr-only" for=${`brief-${field.type}`}>${this.i18n.system(field.question)}</label>
              <textarea id=${`brief-${field.type}`} form=${guidedFormId} rows="4" placeholder=${this.i18n.system(definition.prompt)} .value=${this.#drafts[field.type] ?? ""} @input=${(event: InputEvent) => { this.#drafts[field.type] = (event.target as HTMLTextAreaElement).value; this.requestUpdate(); }}></textarea>
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
                  <button @click=${() => fieldSection >= 0 ? this.#goToStep(fieldSection) : this.store.setRoute("/")}>
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
