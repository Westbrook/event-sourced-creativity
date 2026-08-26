import { html, nothing } from "lit";
import { buildScoutEnvelope, buildScoutTrajectory, scoutPrecisionLedger } from "../model/scout";
import type { CreativeEvent } from "../model/events";
import { FormaElement, icon } from "./forma-element";
import { documentViewWorkflow } from "../model/document-view-signals";
import "./area-navigation";
import "./design-primitives";

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const percent = (value: unknown) => `${Math.round(Number(value ?? 0) * 100)}%`;
const metricLabels:Record<string,string>={recent_generations:"Recent images",mean_similarity:"Visual similarity",accepted_recent:"Retained images",comparisons:"Comparisons",spread:"Creative spread",intent_weight:"Intent strength",success_weight:"Delivery success",elapsed_to_intent_seconds:"Time to advance",intervening_events:"Intervening actions",document_changes:"Document changes",conversation_turns:"Chat turns",context_changed:"Context changed",source_surface:"Working mode",attempts:"Generation attempts",progression_events:"Retained outcomes",progression_ratio:"Outcome rate",attention_support:"Attention support",attention_weight_cap:"Attention authority cap",episodes:"Episodes",mean_friction:"Mean friction",family_members:"Family images",witnessed_visits:"Witnessed visits",preferred_view:"Strongest mode",used_views:"Modes used",view_transitions:"Mode switches",visits:"Visits",edits:"Edits",generation_requests:"Generation requests",retained_outcomes:"Retained outcomes",active_minutes:"Active minutes",friction_episodes:"Friction flags"};
const metricValue=(name:string,value:unknown)=>name.endsWith("ratio")||name.includes("similarity")||name==="spread"||name.includes("weight")?percent(value):name.endsWith("seconds")?`${String(value)} s`:name==="context_changed"?String(value)==="true"?"Yes":"No":String(value);

export class FormaScout extends FormaElement {
  #maxObservations = 3;

  async #judge(observation: CreativeEvent, verdict: "confirmed" | "rejected" | "unclear") {
    await this.store.append({ type: "ObservationJudged", payload: {
      observation_id: observation.payload.observation_id,
      observation_signature: observation.payload.signature,
      verdict,
      note_ref: null,
      evidence_sequence: observation.sequence,
    } });
  }

  async #promote(observation: CreativeEvent) {
    const candidate = record(observation.payload.candidate); const kind = String(candidate.kind ?? "");
    if (!kind) return;
    const blockId = crypto.randomUUID(); const label = String(candidate.label ?? "Scout candidate");
    const type = kind === "palette-anchor" ? "palette" : "style";
    const properties = type === "palette"
      ? { label, colors: list(candidate.colors).map(String), weight: .65, authority: "authored", source_claim_ref: `observation:${String(observation.payload.observation_id)}` }
      : { text: label, weight: .65, authority: "authored", source_claim_ref: `observation:${String(observation.payload.observation_id)}` };
    const appended = await this.store.append({ type: "BlockCreated", payload: {
      block_id: blockId,
      document_id: this.store.projection.get().documentId,
      type,
      handle: `${type}/scout-${blockId.slice(0, 8)}`,
      position: `z${String(this.store.head.get()).padStart(8, "0")}`,
      properties,
    } });
    if (appended.length) this.store.toast("Scout candidate promoted as an authored document block.");
  }

  override render() {
    const events = this.store.events.get(); const session = this.store.session.get(); const busy = this.store.busy.get(); const projection = this.store.projection.get();
    const phase6 = events.findLast((event) => event.type === "PhaseGateReviewed" && Number(event.payload.phase) === 6);
    const advanced = phase6?.payload.decision === "advance";
    const remaining = session ? Math.max(0, Math.min(session.budgets.user.limit - session.budgets.user.used - session.budgets.user.reserved, session.budgets.workspace.limit - session.budgets.workspace.used - session.budgets.workspace.reserved)) : 0;
    const envelope = buildScoutEnvelope(events, remaining, this.#maxObservations); const preview = buildScoutTrajectory(events); const ledger = scoutPrecisionLedger(events); const workflow=documentViewWorkflow(events); const workflowRows=workflow.rows.filter((row)=>row.visits||row.edits||row.generationRequests||row.outcomes||row.activeMinutes);
    const runs = events.filter((event) => event.type === "ScoutRunStarted").reverse(); const latestRunId = String(runs[0]?.payload.run_id ?? "");
    const observations = events.filter((event) => event.type === "ScoutObserved" && (!latestRunId || event.payload.run_id === latestRunId)).reverse();
    const judgments = new Map(events.filter((event) => event.type === "ObservationJudged").map((event) => [String(event.payload.observation_id), event]));
    const latestTerminal = [...events].reverse().find((event) => ["ScoutRunCompleted", "ScoutBudgetExhausted"].includes(event.type) && event.payload.run_id === latestRunId);
    return html`<section class="scout-page page-pad">
      <forma-area-navigation area="intelligence" active="scout"></forma-area-navigation>
      <header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">Creative intelligence / Scout</span><h1>Find your next direction</h1><p>Discover patterns, promising alternatives, and places where your creative work may be getting stuck. Every decision remains yours.</p></div><div class="page-header-actions"><span class="session-state ${advanced ? "open" : "closed"}">${advanced ? this.i18n.system("Suggestions available") : this.i18n.system("Awaiting approval")}</span><button class="button secondary" @click=${() => this.store.setRoute("/sessions")}>Return to recent work</button></div></header>
      <div class="scout-layout"><main>
        <form class="scout-run-panel" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(advanced&&envelope.fits&&busy!=="run-scout")void this.store.runScout(this.#maxObservations);}}><div><span class="eyebrow">You stay in control</span><h2>Find useful next steps</h2><p>Forma looks for meaningful patterns without changing your document or exceeding the limits shown here.</p></div><label>Maximum suggestions<select .value=${String(this.#maxObservations)} @change=${(event: Event) => { this.#maxObservations = Number((event.target as HTMLSelectElement).value); this.requestUpdate(); }}><option value="1">1 suggestion</option><option value="2">2 suggestions</option><option value="3">3 suggestions</option><option value="4">4 suggestions</option></select></label><button type="submit" class="button primary" ?disabled=${!advanced || !envelope.fits || busy === "run-scout"}>${busy === "run-scout" ? this.i18n.system("Finding suggestions…") : envelope.fits ? this.i18n.system("Find suggestions") : this.i18n.system("Not enough budget")}</button></form>
        <section class="view-workflow-report"><div class="section-heading"><div><span class="eyebrow">How you prefer to work</span><h2>Where progress is happening</h2></div><span>${workflow.usedViews} mode${workflow.usedViews===1?"":"s"} used</span></div><p>Your direct edits, requests, and retained results identify useful ways to work. Optional attention signals can suggest a sticking point, but never become taste or generation instructions.</p>${workflowRows.length?html`<div class="view-workflow-list">${workflowRows.map((row)=>html`<article class=${row.view===workflow.preferredView?.view?"preferred":""}><header><b>${row.label}</b>${row.view===workflow.preferredView?.view?html`<span>Strongest progress</span>`:nothing}</header><div><span><b>${row.visits}</b> visits</span><span><b>${row.edits}</b> edits</span><span><b>${row.generationRequests}</b> requests</span><span><b>${row.outcomes}</b> retained</span></div>${row.frictionEpisodes?html`<small>${row.frictionEpisodes} possible sticking point${row.frictionEpisodes===1?"":"s"}</small>`:nothing}</article>`)}</div>`:html`<div class="empty-inline">Try a document view to begin learning which working mode helps you most.</div>`}</section>
        <section><div class="section-heading"><div><span class="eyebrow">Based on your actual creative work</span><h2>Suggestions you can evaluate</h2></div><span>${observations.length} suggestion${observations.length===1?"":"s"}</span></div>
          ${observations.length ? html`<div class="observation-list">${observations.map((observation) => {
            const judgment = judgments.get(String(observation.payload.observation_id)); const evidence = list(observation.payload.evidence_refs).map(String); const metrics = record(observation.payload.evidence_metrics); const candidate = record(observation.payload.candidate); const claimRef = `observation:${String(observation.payload.observation_id)}`; const promoted = projection.blocks.some((block) => block.properties.source_claim_ref === claimRef);
            return html`<article class="observation-card ${String(observation.payload.type)}"><header><span class="observation-type">${String(observation.payload.type)==="workflow"?this.i18n.system("working mode"):String(observation.payload.type)}</span><b>${percent(observation.payload.confidence)} confidence</b></header><h3>${String(observation.payload.label)}</h3><p>${String(observation.payload.summary)}</p><div class="observation-metrics">${Object.entries(metrics).map(([name, value]) => html`<span><b>${metricValue(name,value)}</b>${metricLabels[name]?this.i18n.system(metricLabels[name]):name.replaceAll("_", " ")}</span>`)}</div><details><summary>${evidence.length} stable evidence reference${evidence.length === 1 ? "" : "s"}</summary>${evidence.map((ref) => html`<code>${ref}</code>`)}</details>
              ${Object.keys(candidate).length ? html`<div class="scout-candidate"><div><span class="eyebrow">Visual candidate · ${promoted ? this.i18n.system("authored promotion recorded") : this.i18n.system("report space")}</span><b>${String(candidate.label)}</b>${list(candidate.colors).length ? html`<div class="candidate-swatches">${list(candidate.colors).map((color) => html`<i style=${`--swatch:${String(color)}`}></i>`)}</div>` : nothing}</div><button class="button secondary compact" ?disabled=${promoted} @click=${() => this.#promote(observation)}>${promoted ? this.i18n.system("Promoted") : this.i18n.system("Promote to document")}</button></div>` : nothing}
              ${judgment ? html`<div class="judgment-receipt">${icon("check")} You marked this suggestion ${String(judgment.payload.verdict)}</div>` : html`<div class="judgment-actions"><span>Does this match what you see in your work?</span><button @click=${() => this.#judge(observation, "confirmed")}>Yes</button><button @click=${() => this.#judge(observation, "rejected")}>No</button><button @click=${() => this.#judge(observation, "unclear")}>Not sure</button></div>`}
            </article>`;
          })}</div>` : html`<forma-ui-empty-state .heading=${latestTerminal?.type === "ScoutBudgetExhausted" ? this.i18n.system("This review reached its spending limit") : latestRunId ? this.i18n.system("Nothing useful stood out yet") : this.i18n.system("No suggestions yet")} .detail=${latestRunId ? this.i18n.system("Keep shaping your work, then check again once there are new decisions or results to compare.") : this.i18n.system("Forma can suggest a next move once there is enough real work to learn from.")} icon-name="spark"></forma-ui-empty-state>`}
        </section>
        <section><div class="section-heading"><div><span class="eyebrow">Already visible in your work</span><h2>Patterns worth exploring</h2></div><span>${preview.length} available</span></div><div class="trajectory-preview">${preview.length ? preview.map((slice) => html`<article><span>${slice.type}</span><b>${slice.label}</b><small>${slice.evidenceRefs.length} supporting action${slice.evidenceRefs.length===1?"":"s"} · ${percent(slice.confidence)} confidence</small></article>`) : html`<p>Create a few results, refine an idea, or explore a new visual family to reveal useful patterns.</p>`}</div></section>
      </main><aside>
        <section class="envelope-card"><span class="eyebrow">Your limits</span><h2>${envelope.fits ? this.i18n.system("Ready to explore") : this.i18n.system("Budget limit reached")}</h2><dl><div><dt>Available</dt><dd>${envelope.remainingTokens.toLocaleString(this.i18n.locale)} tokens</dd></div><div><dt>This review</dt><dd>${envelope.requestedTokens.toLocaleString(this.i18n.locale)} tokens</dd></div><div><dt>Directions</dt><dd>${envelope.plannedVariants}</dd></div><div><dt>Available tools</dt><dd>${envelope.capabilities.length || this.i18n.system("Preparing")}</dd></div></dl><p>Suggestions stay separate from your document until you explicitly decide to use them.</p></section>
        <section class="precision-card"><span class="eyebrow">How useful has this been?</span><h2>${ledger.confirmed}/${ledger.judged}</h2><p>suggestions you confirmed as useful</p><div class="precision-grid"><span><b>${ledger.observations}</b>suggested</span><span><b>${ledger.rejected}</b>dismissed</span><span><b>${percent(ledger.meanConfidence)}</b>average confidence</span><span><b>${ledger.costUsd ? `$${ledger.costUsd}` : "$0"}</b>total cost</span></div><b class="precision-dollar">${ledger.confirmedPerDollar === Number.POSITIVE_INFINITY ? this.i18n.system("Useful suggestions at no cost") : ledger.confirmedPerDollar === null ? this.i18n.system("No confirmed suggestions yet") : this.i18n.system("{confirmedPerDollar} useful suggestions / $", { confirmedPerDollar: this.i18n.number(ledger.confirmedPerDollar) })}</b>${ledger.byType.map((row) => html`<div class="precision-row"><span>${row.type}</span><b>${row.confirmed}/${row.observations}</b></div>`)}</section>
        <section class="authority-note"><span>${icon("lock")}</span><div><b>You decide what becomes part of the work</b><p>No suggestion changes a document until you deliberately choose to add it.</p></div></section>
      </aside></div>
    </section>`;
  }
}
if (!customElements.get("forma-scout")) customElements.define("forma-scout", FormaScout);
