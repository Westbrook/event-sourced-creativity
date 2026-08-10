import { html, nothing } from "lit";
import { buildScoutEnvelope, buildScoutTrajectory, scoutPrecisionLedger } from "../model/scout";
import type { CreativeEvent } from "../model/events";
import { FormaElement, icon } from "./forma-element";

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const percent = (value: unknown) => `${Math.round(Number(value ?? 0) * 100)}%`;

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
    const envelope = buildScoutEnvelope(events, remaining, this.#maxObservations); const preview = buildScoutTrajectory(events); const ledger = scoutPrecisionLedger(events);
    const runs = events.filter((event) => event.type === "ScoutRunStarted").reverse(); const latestRunId = String(runs[0]?.payload.run_id ?? "");
    const observations = events.filter((event) => event.type === "ScoutObserved" && (!latestRunId || event.payload.run_id === latestRunId)).reverse();
    const judgments = new Map(events.filter((event) => event.type === "ObservationJudged").map((event) => [String(event.payload.observation_id), event]));
    const latestTerminal = [...events].reverse().find((event) => ["ScoutRunCompleted", "ScoutBudgetExhausted"].includes(event.type) && event.payload.run_id === latestRunId);
    return html`<section class="scout-page page-pad">
      <header class="page-hero"><div><span class="eyebrow">Phase 8 · bounded agent workspace</span><h1>Scout trajectories</h1><p>Inspect convergence, divergence, stalls, and adjacent families without letting an agent choose a direction or write into your document.</p></div><div class="hero-actions"><span class="session-state ${advanced ? "open" : "closed"}">${advanced ? "Phase 6 advanced · monitoring" : "Phase 6 review required"}</span><button class="button secondary" @click=${() => this.store.setRoute("/sessions")}>Review evidence</button></div></header>
      <div class="scout-layout"><main>
        <section class="scout-run-panel"><div><span class="eyebrow">Hard envelope</span><h2>Run a theoretical scout pass</h2><p>The pilot runner is deterministic and report-only. Budget exhaustion is a planned terminal state, not an exception.</p></div><label>Observation ceiling<select .value=${String(this.#maxObservations)} @change=${(event: Event) => { this.#maxObservations = Number((event.target as HTMLSelectElement).value); this.requestUpdate(); }}><option value="1">1 observation</option><option value="2">2 observations</option><option value="3">3 observations</option><option value="4">4 observations</option></select></label><button class="button primary" ?disabled=${!advanced || !envelope.fits || busy === "run-scout"} @click=${() => this.store.runScout(this.#maxObservations)}>${busy === "run-scout" ? "Building report…" : envelope.fits ? "Run bounded scout" : "Budget terminal"}</button></section>
        <section><div class="section-heading"><div><span class="eyebrow">Evidence ledger · ${latestRunId ? `run ${latestRunId.slice(-8)}` : "no run yet"}</span><h2>Falsifiable observations</h2></div><span>${observations.length} rendered</span></div>
          ${observations.length ? html`<div class="observation-list">${observations.map((observation) => {
            const judgment = judgments.get(String(observation.payload.observation_id)); const evidence = list(observation.payload.evidence_refs).map(String); const metrics = record(observation.payload.evidence_metrics); const candidate = record(observation.payload.candidate); const claimRef = `observation:${String(observation.payload.observation_id)}`; const promoted = projection.blocks.some((block) => block.properties.source_claim_ref === claimRef);
            return html`<article class="observation-card ${String(observation.payload.type)}"><header><span class="observation-type">${String(observation.payload.type)}</span><b>${percent(observation.payload.confidence)} confidence</b></header><h3>${String(observation.payload.label)}</h3><p>${String(observation.payload.summary)}</p><div class="observation-metrics">${Object.entries(metrics).map(([name, value]) => html`<span><b>${String(value)}</b>${name.replaceAll("_", " ")}</span>`)}</div><details><summary>${evidence.length} stable evidence reference${evidence.length === 1 ? "" : "s"}</summary>${evidence.map((ref) => html`<code>${ref}</code>`)}</details>
              ${Object.keys(candidate).length ? html`<div class="scout-candidate"><div><span class="eyebrow">Visual candidate · ${promoted ? "authored promotion recorded" : "report space"}</span><b>${String(candidate.label)}</b>${list(candidate.colors).length ? html`<div class="candidate-swatches">${list(candidate.colors).map((color) => html`<i style=${`--swatch:${String(color)}`}></i>`)}</div>` : nothing}</div><button class="button secondary compact" ?disabled=${promoted} @click=${() => this.#promote(observation)}>${promoted ? "Promoted" : "Promote to document"}</button></div>` : nothing}
              ${judgment ? html`<div class="judgment-receipt">${icon("check")} Judged ${String(judgment.payload.verdict)} at sequence ${judgment.sequence}</div>` : html`<div class="judgment-actions"><span>Does the cited evidence support this?</span><button @click=${() => this.#judge(observation, "confirmed")}>Confirm</button><button @click=${() => this.#judge(observation, "rejected")}>Reject</button><button @click=${() => this.#judge(observation, "unclear")}>Unclear</button></div>`}
            </article>`;
          })}</div>` : html`<div class="empty-workspace"><span>${icon("spark")}</span><h3>${latestTerminal?.type === "ScoutBudgetExhausted" ? "The hard budget ended this run" : latestRunId ? "The current stream produced no supportable observation" : "No scout report yet"}</h3><p>${latestRunId ? "This is a valid report outcome. Continue normal creative work and run again when the trajectory has changed." : "The preview below shows what the current event substrate can support before a run is committed."}</p></div>`}
        </section>
        <section><div class="section-heading"><div><span class="eyebrow">Preflight substrate</span><h2>Current trajectory slices</h2></div><span>${preview.length} available</span></div><div class="trajectory-preview">${preview.length ? preview.map((slice) => html`<article><span>${slice.type}</span><b>${slice.label}</b><small>${slice.evidenceRefs.length} event refs · ${percent(slice.confidence)}</small></article>`) : html`<p>At least two indexed outputs, three iteration attempts, or an unvisited inferred family are needed for a supportable slice.</p>`}</div></section>
      </main><aside>
        <section class="envelope-card"><span class="eyebrow">Planning envelope</span><h2>${envelope.fits ? "Within bounds" : "Planned stop"}</h2><dl><div><dt>Remaining</dt><dd>${envelope.remainingTokens.toLocaleString()} tokens</dd></div><div><dt>Ceiling</dt><dd>${envelope.requestedTokens.toLocaleString()} tokens</dd></div><div><dt>Variants</dt><dd>${envelope.plannedVariants}</dd></div><div><dt>Capabilities</dt><dd>${envelope.capabilities.length || "registry pending"}</dd></div></dl><p>Scout generations, when present, live only in this report space. They never enter the document output projection.</p></section>
        <section class="precision-card"><span class="eyebrow">Precision ledger</span><h2>${ledger.confirmed}/${ledger.judged}</h2><p>confirmed judgments / judged observations</p><div class="precision-grid"><span><b>${ledger.observations}</b>observed</span><span><b>${ledger.rejected}</b>rejected</span><span><b>${percent(ledger.meanConfidence)}</b>mean confidence</span><span><b>${ledger.costUsd ? `$${ledger.costUsd}` : "$0"}</b>scout cost</span></div><b class="precision-dollar">${ledger.confirmedPerDollar === Number.POSITIVE_INFINITY ? "Confirmed evidence at $0" : ledger.confirmedPerDollar === null ? "No confirmed / $ yet" : `${ledger.confirmedPerDollar} confirmed / $`}</b>${ledger.byType.map((row) => html`<div class="precision-row"><span>${row.type}</span><b>${row.confirmed}/${row.observations}</b></div>`)}</section>
        <section class="authority-note"><span>${icon("lock")}</span><div><b>No automatic promotion</b><p>Every candidate stays inferred and report-only until you deliberately create an authored block.</p></div></section>
      </aside></div>
    </section>`;
  }
}
customElements.define("forma-scout", FormaScout);
