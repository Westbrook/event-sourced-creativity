import { readVideoReferenceIntent } from "./video-reference.ts";
import { readModel3dReferenceIntent } from "./model3d-reference.ts";
import { sceneCharacterLabel, sceneKnowledgeLabel } from "./scene-context.ts";
import { readExperienceImageRatio } from "./image-ratio.ts";
import type { DecisionValue, ExperienceValue, Interaction } from "./contracts.ts";
import type { ExperienceIntakeRuntime } from "./intake-runtime.ts";
import { experienceOutputSettings, type ExperienceNativeHostAdapter, type ExperienceNativeHostSession } from "./native-host.ts";
import { Model3dReferencePicker, VideoReferencePicker, VideoReferencePreview } from "./model3d-reference-picker.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item;
}
export const issueText = (code: string) => ({ project_intake_unconfirmed: "Save not confirmed; check the original request", project_intake_original_unavailable: "Original save receipt is incomplete or unavailable", video_reference_not_ready: "Image check required", video_reference_source_unavailable: "Image unavailable", video_reference_source_changed: "Image changed", video_reference_commit_proof_too_large: "Image context limit", required: "Required", model3d_reference_not_ready: "Check the selected reference or choose Text only", model3d_reference_source_unavailable: "Reference unavailable", model3d_reference_source_changed: "Reference changed; original Save was not confirmed", model3d_reference_commit_proof_too_large: "Reference context exceeds safe Save limits", text_limit: "Text limit", experience_release_changed: "Definition changed", experience_auth_required: "Sign in required", authentication_required: "Sign in required", consent_required: "Consent required", personal_author_required: "Personal author access required", insufficient_role: "Access unavailable", project_intake_authority_changed: "Access changed", experience_save_unconfirmed: "Save status unavailable", experience_review_stale: "Review changed", experience_draft_unavailable: "Draft unavailable", experience_resume_invalid: "Draft unavailable", experience_intent_conflict: "Request conflict", creator_required: "Creator access required", forbidden: "Access unavailable", experience_draft_expired: "Draft expired", experience_result_mismatch: "Receipt mismatch" }[code] ?? "Unavailable");
const phaseText = (phase: string) => ({ setup: "Draft", preparing: "Checking", review: "Review", submitting: "Saving", complete: "Document saved", uncertain: "Status unavailable" }[phase] ?? "Unavailable");
const button = (label: string, action: () => void, primary = false) => { const item = el("button", label, primary ? "experience-button primary" : "experience-button"); item.type = "button"; item.addEventListener("click", action); return item; };

/** Native controls preserve IME composition, text selection, OS zoom and keyboard semantics. */
export class ExperienceView {
  readonly runtime: ExperienceIntakeRuntime;
  #root: HTMLElement;
  #stage = el("section", undefined, "experience-stage");
  #controls = el("section", undefined, "experience-controls");
  #status = el("span");
  #actions = el("div", undefined, "experience-actions");
  #previousPhase = "";
  #fields = new Map<string, HTMLTextAreaElement>();
  #errors = new Map<string, HTMLElement>();
  #choices = new Map<string, Map<string, HTMLButtonElement>>();
  #composing = false;
  #sceneKnowledgeContext?: HTMLElement;
  #referencePicker?: Model3dReferencePicker | VideoReferencePicker;
  #retainedPreview?: VideoReferencePreview;
  #unsubscribe: () => void;
  #abort = new AbortController();
  #adapter?: ExperienceNativeHostAdapter;
  #session?: ExperienceNativeHostSession;
  #mounted = false;
  #disposed = false;
  constructor(root: HTMLElement, runtime: ExperienceIntakeRuntime, adapter?: ExperienceNativeHostAdapter) {
    this.#root = root; this.runtime = runtime; this.#adapter = adapter;
    const header = el("header", undefined, "experience-heading");
    const heading = el("div"); heading.append(el("span", "Forma", "experience-brand"), el("h1", runtime.release.output.label), el("p", runtime.release.output.output === "storyboard" ? `Planned output: ${runtime.release.output.result}` : runtime.release.output.output === "audio" ? `Planned output: ${runtime.release.output.result}` : runtime.release.output.result));
    header.append(heading);
    this.#stage.setAttribute("aria-label", "Direction preview"); this.#controls.setAttribute("aria-label", "Decisions");
    const workspace = el("div", undefined, "experience-workspace");
    if (runtime.release.output.output === "scene") {
      // Authoring comes first in both the visual and assistive reading order.
      workspace.classList.add("experience-scene-workspace"); workspace.append(this.#controls, this.#stage);
    } else if (["audio", "video"].includes(runtime.release.output.output)) workspace.append(this.#controls, this.#stage);
    else workspace.append(this.#stage, this.#controls);
    this.#status.setAttribute("role", "status"); this.#status.setAttribute("aria-live", "polite"); this.#status.setAttribute("aria-atomic", "true");
    const footer = el("footer", undefined, "experience-footer"); footer.append(this.#status, this.#actions);
    this.#root.replaceChildren(header, workspace, footer);
    this.#unsubscribe = runtime.subscribe(() => this.#update()); this.#update();
  }
  #value(id: string): ExperienceValue { return this.runtime.state.draft.values[id].value; }
  #describe(entry: DecisionValue, interaction: Interaction) {
    const value = entry.value;
    if (interaction.kind === "ratio") { const ratio = readExperienceImageRatio(value); return ratio ? `${ratio.width}:${ratio.height}` : "Required"; }
    return typeof value === "string" ? interaction.options?.find(option => option.value === value)?.label ?? value : Array.isArray(value) ? value.map(item => item.text).join(" → ") : "";
  }
  #textField(path: string, label: string, value: string, maxLength: number, changed: (text: string) => void) {
    const wrap = el("div", undefined, "experience-field"), id = `experience-${path}`;
    const caption = el("label", label); caption.htmlFor = id;
    const input = el("textarea"); input.id = id; input.name = path; input.value = value; input.maxLength = maxLength; input.rows = 3; input.dir = "auto";
    const error = el("small", "", "experience-error"); error.id = `${id}-error`; input.setAttribute("aria-describedby", error.id);
    this.#fields.set(path, input); this.#errors.set(path, error);
    input.addEventListener("compositionstart", () => { this.#composing = true; });
    input.addEventListener("compositionend", () => { this.#composing = false; changed(input.value); });
    input.addEventListener("input", event => { if (!(event as InputEvent).isComposing && !this.#composing) changed(input.value); });
    wrap.append(caption, input, error); return wrap;
  }
  #setup() {
    this.#retainedPreview?.dispose(); this.#retainedPreview = undefined;
    this.#stage.hidden = false; this.#stage.parentElement?.classList.remove("experience-video-retained");
    this.#referencePicker?.dispose(); this.#referencePicker = undefined;
    this.#controls.replaceChildren(); this.#sceneKnowledgeContext = undefined;
    if (this.runtime.release.output.output === "image") this.#controls.append(el("p", "Reference image unavailable", "experience-reference-status"));
    if (this.runtime.release.output.output === "model3d") {
      this.#referencePicker = new Model3dReferencePicker((selection, ready) => this.runtime.changeReference(selection, ready), readModel3dReferenceIntent(this.runtime.state.draft.reference) ?? undefined);
      this.#controls.append(this.#referencePicker.element);
    }
    if (this.runtime.release.output.output === "video") {
      this.#referencePicker = new VideoReferencePicker((selection, ready) => this.runtime.changeReference(selection, ready), readVideoReferenceIntent(this.runtime.state.draft.reference) ?? undefined);
      this.#controls.append(this.#referencePicker.element);
    }
    if (this.runtime.release.output.output === "storyboard") this.#controls.append(el("p", "Describe the key moments in order and the framing and composition to carry across four frames. Text-only intake; reference files are unavailable here.", "experience-reference-status"));
    if (this.runtime.release.output.output === "audio") this.#controls.append(el("p", "Describe the music you want and how it develops. Instrumental only, with no lyrics or spoken voice. Target duration: about 20 seconds.", "experience-reference-status"));
    this.#fields.clear(); this.#errors.clear(); this.#choices.clear();
    let sceneCharacter: HTMLFieldSetElement | undefined;
    for (const decision of this.runtime.release.definition.decisions) {
      const interaction = this.runtime.release.interactions[decision.id], label = this.runtime.release.copy[decision.labelKey];
      if (interaction.kind === "source") {
        const sceneParticipant = this.runtime.release.output.output === "scene" && ["characterA", "goalA", "characterB", "goalB"].includes(decision.id);
        const sceneName = sceneParticipant && decision.id.startsWith("character");
        const field = this.#textField(decision.id, sceneParticipant ? sceneName ? "Name" : "Goal" : label, this.#value(decision.id) as string, interaction.maxLength, value => this.runtime.change(decision.id, value));
        if (sceneParticipant) {
          const input = this.#fields.get(decision.id)!;
          input.setAttribute("aria-label", sceneName ? `${label} name` : label);
          // Keep native composition and retained multiline values; names need less initial space.
          if (sceneName) { input.rows = 1; input.classList.add("experience-short-text"); }
          if (decision.id.startsWith("character")) {
            sceneCharacter = el("fieldset", undefined, "experience-scene-character"); sceneCharacter.append(el("legend", label)); this.#controls.append(sceneCharacter);
          }
          sceneCharacter!.append(field);
        } else this.#controls.append(field);
      } else if (interaction.kind === "ratio" && interaction.ratios) {
        const fieldset = el("fieldset"), choices = el("div", undefined, "experience-choices experience-ratios"), registered = new Map<string, HTMLButtonElement>();
        fieldset.append(el("legend", label));
        for (const ratio of interaction.ratios) {
          const item = button(ratio.label, () => this.runtime.change(decision.id, { width: ratio.width, height: ratio.height }));
          item.setAttribute("aria-label", ratio.label); registered.set(`${ratio.width}:${ratio.height}`, item); choices.append(item);
        }
        const error = el("small", "", "experience-error"); error.id = `experience-${decision.id}-error`; fieldset.setAttribute("aria-describedby", error.id); this.#errors.set(decision.id, error);
        this.#choices.set(decision.id, registered); fieldset.append(choices, error); this.#controls.append(fieldset);
      } else if (interaction.options) {
        const fieldset = el("fieldset"), choices = el("div", undefined, "experience-choices"), registered = new Map<string, HTMLButtonElement>();
        fieldset.append(el("legend", label));
        for (const option of interaction.options) {
          const item = button(option.label, () => this.runtime.change(decision.id, option.value)); registered.set(option.value, item); choices.append(item);
        }
        if (this.runtime.release.output.output === "scene" && decision.id === "knowledge") {
          this.#sceneKnowledgeContext = el("dl", undefined, "experience-summary"); fieldset.append(this.#sceneKnowledgeContext);
        }
        this.#choices.set(decision.id, registered); fieldset.append(choices); this.#controls.append(fieldset);
      } else if (interaction.kind === "order") {
        const fieldset = el("fieldset"), list = el("ol", undefined, "experience-evidence"); fieldset.append(el("legend", label));
        const values = this.#value(decision.id) as Array<{ id: string; text: string }>;
        const reorder = (id: string, delta: -1 | 1, active: HTMLButtonElement) => {
          if (this.#composing) return;
          const next = structuredClone(this.#value(decision.id)) as Array<{ id: string; text: string }>, index = next.findIndex(item => item.id === id), target = index + delta;
          if (index < 0 || target < 0 || target >= next.length) return;
          [next[index], next[target]] = [next[target], next[index]];
          if (!this.runtime.change(decision.id, next)) return;
          for (const item of next) { const node = Array.from(list.children).find(node => (node as HTMLElement).dataset.evidenceId === item.id); if (node) list.append(node); }
          updateOrder(); active.focus(); this.#status.textContent = `Evidence ${target + 1}`;
        };
        const updateOrder = () => Array.from(list.children).forEach((child, index) => {
          const node = child as HTMLElement, label = node.querySelector("label")!, up = node.querySelector<HTMLButtonElement>('[data-move="up"]')!, down = node.querySelector<HTMLButtonElement>('[data-move="down"]')!;
          label.textContent = `Evidence ${index + 1}`;
          // Keep focused controls available; aria-disabled avoids focus loss at boundaries.
          up.setAttribute("aria-disabled", String(index === 0)); down.setAttribute("aria-disabled", String(index === list.children.length - 1));
          up.setAttribute("aria-label", `Move evidence ${index + 1} up`); down.setAttribute("aria-label", `Move evidence ${index + 1} down`);
        });
        for (const [index, value] of values.entries()) {
          const item = el("li"); item.dataset.evidenceId = value.id;
          item.append(this.#textField(`${decision.id}.${value.id}.text`, `Evidence ${index + 1}`, value.text, interaction.maxLength, text => {
            const next = (this.#value(decision.id) as Array<{ id: string; text: string }>).map(entry => entry.id === value.id ? { ...entry, text } : entry); this.runtime.change(decision.id, next);
          }));
          const actions = el("div", undefined, "experience-actions"), up = button("Up", () => reorder(value.id, -1, up)), down = button("Down", () => reorder(value.id, 1, down));
          up.dataset.move = "up"; down.dataset.move = "down"; actions.append(up, down); item.append(actions); list.append(item);
        }
        updateOrder(); fieldset.append(list); this.#controls.append(fieldset);
      }
    }
  }
  #preview() {
    const heading = el("div", undefined, "experience-stage-heading"); heading.append(el("span", ["audio", "video"].includes(this.runtime.release.output.output) ? "Planned intent" : "Direction preview"), el("span", this.runtime.release.output.output === "video" ? "No video generated" : this.runtime.release.output.output === "audio" ? "No audio generated" : "Illustrative"));
    this.#stage.replaceChildren(heading);
    if (this.runtime.release.output.output === "image") {
      const spatial = el("div", undefined, "experience-spatial"); spatial.dataset.anchor = this.#value("composition") as string; spatial.dataset.lighting = this.#value("lighting") as string;
      const ratio = readExperienceImageRatio(this.#value("ratio"));
      spatial.dataset.ratio = ratio ? "selected" : "unselected";
      if (ratio) { spatial.style.aspectRatio = `${ratio.width}/${ratio.height}`; spatial.style.setProperty("--experience-ratio", String(ratio.width / ratio.height)); }
      else this.#stage.append(el("span", "Ratio required", "experience-ratio-status"));
      spatial.append(el("span", this.#value("subject") as string || "Subject", "experience-subject")); this.#stage.append(spatial);
    } else if (this.runtime.release.output.output === "video") {
      this.#stage.append(el("h2", "4 seconds · 480p · Silent"), this.#summary(), el("p", "Generation unavailable", "experience-reference-status"));
    } else if (this.runtime.release.output.output === "audio") {
      this.#stage.append(el("h2", "Instrumental track · about 20 seconds"), this.#summary(), el("p", "Saving creates musical direction in a Document. Continue to review cost and source transfer before creating audio. The 20-second target is a request, not a measured recording.", "experience-reference-status"));
    } else if (this.runtime.release.output.output === "storyboard") {
      this.#stage.append(el("h2", "Four-frame storyboard"), this.#summary(), el("p", "These are authored directions, not generated frames. Saving creates Document context for a four-frame storyboard; it does not authorize generation. After saving, Continue to review cost and source transfer. Creation requires separate approval.", "experience-reference-status"));
    } else if (this.runtime.release.output.output === "model3d") {
      this.#stage.append(el("h2", "One static GLB object"), this.#summary(), el("p", "Saving creates Document context, not a 3D file. A selected reference is rechecked before Save; it does not authorize generation. After saving, Continue to review cost and source transfer. Creation requires separate approval.", "experience-reference-status"));
    } else if (this.runtime.release.output.output === "short_story") {
      const structure = el("ol", undefined, "experience-story-structure");
      structure.setAttribute("aria-label", "Story structure");
      const ending = this.runtime.release.interactions.ending.options?.find(option => option.value === this.#value("ending"))?.label ?? "";
      const panels = [
        { label: "Character / Goal", rows: [["Character", this.#value("character")], ["Goal", this.#value("goal")]] },
        { label: "Obstacle", rows: [["Obstacle", this.#value("obstacle")]] },
        { label: "Decision / Ending", rows: [["Decision", this.#value("decision")], ["Ending", ending]] },
      ];
      for (const [index, panel] of panels.entries()) {
        const item = el("li"), facts = el("dl"); item.append(el("h2", `${index + 1}. ${panel.label}`));
        for (const [label, value] of panel.rows) { const row = el("div"); row.append(el("dt", String(label)), el("dd", String(value) || "—")); facts.append(row); }
        item.append(facts); structure.append(item);
      }
      this.#stage.append(structure);
    } else if (this.runtime.release.output.output === "scene") {
      const relation = el("div", undefined, "experience-scene-relation"), characters = el("div", undefined, "experience-scene-characters");
      for (const participant of ["A", "B"] as const) {
        const card = el("section", undefined, "experience-scene-character"), knows = this.#value("knowledge") === "both" || this.#value("knowledge") === participant.toLowerCase();
        card.append(el("h2", sceneCharacterLabel(this.runtime.state.draft.values, participant)), el("p", this.#value(`goal${participant}`) as string || "Goal"), el("span", knows ? "Secret known" : "Secret unknown")); characters.append(card);
      }
      const details = el("dl", undefined, "experience-summary");
      for (const id of ["secret", "location", "tension"]) {
        const decision = this.runtime.release.definition.decisions.find(item => item.id === id)!, row = el("div");
        row.append(el("dt", this.runtime.release.copy[decision.labelKey]), el("dd", this.#describe(this.runtime.state.draft.values[id], this.runtime.release.interactions[id]) || "—")); details.append(row);
      }
      relation.append(characters, details); this.#stage.append(relation);
    } else {
      const strip = el("ol", undefined, "experience-slide-strip"), claim = this.#value("claim") as string;
      strip.tabIndex = 0; strip.setAttribute("aria-label", "Direction preview · 5 slides");
      const rows = [{ label: "Claim", text: claim }, ...(this.#value("evidence") as Array<{ id: string; text: string }>).map(item => ({ label: "Evidence", text: item.text })), { label: "Conclusion", text: claim }];
      for (const [index, row] of rows.entries()) { const slide = el("li"); slide.append(el("span", `${String(index + 1).padStart(2, "0")} · ${row.label}`), el("p", row.text || "—")); strip.append(slide); }
      this.#stage.append(strip);
    }
  }
  #summary() {
    const list = el("dl", undefined, "experience-summary");
    for (const decision of this.runtime.release.definition.decisions) { const row = el("div"); row.append(el("dt", this.runtime.release.copy[decision.labelKey]), el("dd", this.runtime.release.output.output === "scene" && decision.id === "knowledge" ? sceneKnowledgeLabel(this.runtime.state.draft.values, this.#value("knowledge")) : this.#describe(this.runtime.state.draft.values[decision.id], this.runtime.release.interactions[decision.id]))); list.append(row); }
    if (this.runtime.release.output.output === "model3d") {
      const reference = this.runtime.state.draft.reference, row = el("div");
      row.append(el("dt", "Reference"), el("dd", !this.runtime.referenceReady ? "Selected reference is not ready" : reference ? `${"kind" in reference && reference.kind === "saved-model-view" ? "Saved 3D view" : "Image"} · SHA-256 ${reference.sha256}` : "Text only"));
      list.append(row);
    }
    if (this.runtime.release.output.output === "video" && !this.#retainedPreview) {
      const reference = this.runtime.state.draft.reference, row = el("div");
      row.append(el("dt", "Image"), el("dd", !reference ? "Required" : !this.runtime.referenceReady ? "Check required" : "Selected image"));
      list.append(row);
    }
    return list;
  }
  #review = async () => { if (this.#composing) return; await this.runtime.prepare(); const first = this.runtime.state.issues[0]; if (first) { if (first.path === "$reference") this.#referencePicker?.focus(); else { const target = this.#fields.get(first.path) ?? this.#choices.get(first.path)?.values().next().value; target?.focus(); } } };
  #update() {
    if (this.#disposed) return;
    const phase = this.runtime.state.phase, changed = phase !== this.#previousPhase;
    this.#status.textContent = this.runtime.state.issues.length ? issueText(this.runtime.state.issues[0].code) : phaseText(phase);
    if (changed) {
      if (phase === "setup") {
        const returning = this.#previousPhase === "review"; this.#setup();
        if (returning) queueMicrotask(() => { if (!this.#disposed && this.runtime.state.phase === "setup") this.#controls.querySelector<HTMLElement>("textarea,button")?.focus(); });
      }
      else { this.#referencePicker?.dispose(); this.#referencePicker = undefined;
        if (this.runtime.release.output.output === "video" && this.runtime.preparedPlan?.reference) {
          this.#retainedPreview ??= new VideoReferencePreview(this.runtime.preparedPlan.reference);
          this.#stage.hidden = true; this.#stage.parentElement?.classList.add("experience-video-retained");
        }
        const heading = el("h2", phaseText(phase)); heading.tabIndex = -1;
        this.#controls.replaceChildren(heading, ...(this.#retainedPreview ? [this.#retainedPreview.element] : []), this.#summary()); if (["review", "complete", "uncertain"].includes(phase)) queueMicrotask(() => { if (!this.#disposed && this.runtime.state.phase === phase) heading.focus(); }); }
      this.#actions.replaceChildren();
      if (phase === "setup") this.#actions.append(button("Review", () => void this.#review(), true));
      else if (phase === "review") this.#actions.append(button("Back", () => this.runtime.back()), button("Save to Forma", () => void this.runtime.submit(), true));
      else if (phase === "uncertain") { this.#actions.append(button("Check status", () => void this.runtime.recover())); if (this.runtime.canRetry) this.#actions.append(button("Retry original", () => void this.runtime.submit())); }
      this.#previousPhase = phase;
    }
    if (phase === "setup") {
      if (this.#sceneKnowledgeContext) {
        this.#sceneKnowledgeContext.replaceChildren();
        for (const participant of ["A", "B"] as const) {
          const row = el("div"); row.append(el("dt", sceneCharacterLabel(this.runtime.state.draft.values, participant)), el("dd", this.#value(`goal${participant}`) as string || "Goal")); this.#sceneKnowledgeContext.append(row);
        }
        for (const [value, control] of this.#choices.get("knowledge") ?? []) control.textContent = value === "both" ? "Both" : sceneKnowledgeLabel(this.runtime.state.draft.values, value);
      }
      for (const [path, error] of this.#errors) { const issue = this.runtime.state.issues.find(item => item.path === path); error.textContent = issue ? issueText(issue.code) : ""; this.#fields.get(path)?.setAttribute("aria-invalid", String(Boolean(issue))); }
      for (const [id, choices] of this.#choices) for (const [value, control] of choices) { const selected = this.#value(id), ratio = readExperienceImageRatio(selected); control.setAttribute("aria-pressed", String((ratio ? `${ratio.width}:${ratio.height}` : selected) === value)); control.setAttribute("aria-invalid", String(this.runtime.state.issues.some(issue => issue.path === id))); }
    }
    if (phase !== "complete") this.#preview();
    else if (!this.#mounted) { this.#mounted = true; void this.#native(); }
  }
  async #native() {
    const plan = this.runtime.committedPlan, receipt = this.runtime.receipt;
    if (!plan || !receipt) return;
    const video = this.runtime.release.output.output === "video";
    const link = el("a", video ? "Edit in Forma" : "Open in Forma", video && this.#adapter ? "experience-button" : "experience-button primary"); link.href = receipt.documentRoute;
    if (this.runtime.release.output.output === "video") {
      const heading = this.#controls.querySelector("h2")!, details = el("details", undefined, "experience-saved-details");
      details.append(el("summary", "Saved settings"), this.#summary());
      this.#controls.replaceChildren(heading, ...(this.#retainedPreview ? [this.#retainedPreview.element] : []), details, el("p", "No video generated"));
      this.#stage.replaceChildren(); this.#stage.hidden = true; this.#stage.parentElement?.classList.add("experience-video-retained");
      this.#status.textContent = ""; this.#actions.append(link);
      if (!this.#adapter) return;
    }
    if (this.runtime.release.output.output === "scene" && !this.#adapter) {
      const heading = this.#controls.querySelector("h2")!, choices = this.#controls.querySelector(".experience-summary")!;
      const details = el("details", undefined, "experience-saved-details");
      details.append(el("summary", "Saved scene details"), choices);
      this.#controls.replaceChildren(heading, el("p", "Generation unavailable"), link, details);
      this.#stage.hidden = true; this.#stage.parentElement!.classList.add("experience-scene-saved");
      return;
    }
    if (this.runtime.release.output.output !== "video") { this.#stage.replaceChildren(el("h2", "Document saved")); this.#actions.append(link); }
    if (!this.#adapter || !["image", "slides", "short_story", "scene", "storyboard", "audio", "video", "model3d"].includes(this.runtime.release.output.output)) { this.#stage.append(el("p", "Generation unavailable")); return; }
    // Video retains its saved reference panel and hidden direction stage. Mount
    // navigation in the visible action area, without starting generation.
    const target = el("div", undefined, "experience-native-host");
    (this.runtime.release.output.output === "video" ? this.#actions : this.#stage).append(target);
    try {
      const session = await this.#adapter.mount(target, Object.freeze({ plan, receipt, settings: experienceOutputSettings(plan) }), this.#abort.signal);
      if (this.#disposed) session.dispose(); else this.#session = session;
    } catch { if (!this.#disposed) target.replaceChildren(el("p", "Generation unavailable")); }
  }
  dispose() { if (this.#disposed) return; this.#disposed = true; this.#unsubscribe(); this.#abort.abort(); this.#referencePicker?.dispose(); this.#retainedPreview?.dispose(); this.#session?.dispose(); this.#root.replaceChildren(); }
}
