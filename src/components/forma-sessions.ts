import { html, nothing } from "lit";
import { briefEligibility, phase6GateMetrics, sessionContinuityDelta, type BriefDestination, type BriefItem } from "../model/brief";
import { FormaElement, icon } from "./forma-element";

const duration = (milliseconds: number | null) => milliseconds === null ? "pending" : milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;

export class FormaSessions extends FormaElement {
  #intent = "";
  #blankName: string | null = null;

  #destination(item: BriefItem): BriefDestination {
    if (item.destination?.view && item.destination?.ref_id) return item.destination;
    const projection = this.store.projection.get();
    if (item.item_type === "thread") {
      const block = projection.libraryBlocks.find((value) => value.id === item.ref_id || value.handle === item.ref_id);
      return { route: "/", view: "context-block", ref_id: block?.id ?? item.ref_id };
    }
    if (item.item_type === "collection") {
      const collection = projection.collections.find((value) => value.id === item.ref_id || value.handle === item.ref_id);
      return { route: "/library", view: "collection", ref_id: collection?.id ?? item.ref_id };
    }
    const sourceId = item.rationale_ref.startsWith("event:") ? item.rationale_ref.slice(6) : "";
    const source = this.store.events.get().find((event) => event.eventId === sourceId);
    const objectIds = Array.isArray(source?.payload.object_ids) ? source.payload.object_ids.map(String) : [item.ref_id];
    return { route: "/", view: "comparison", ref_id: objectIds[0] ?? item.ref_id, object_ids: objectIds };
  }

  #openDestination(destination: BriefDestination) {
    if (destination.view === "comparison") this.store.patchUi({ selectedOutputId: destination.ref_id, comparisonOutputIds: (destination.object_ids ?? [destination.ref_id]).join("|"), compareOpen: true, focusBlockId: "", focusCollectionId: "" });
    else if (destination.view === "collection") this.store.patchUi({ focusCollectionId: destination.ref_id, focusBlockId: "", compareOpen: false });
    else this.store.patchUi({ focusBlockId: destination.ref_id, focusCollectionId: "", compareOpen: false });
    this.store.setRoute(destination.route);
    window.setTimeout(() => {
      const selector = destination.view === "collection" ? `[data-collection-id="${CSS.escape(destination.ref_id)}"]` : destination.view === "context-block" ? `[data-block-id="${CSS.escape(destination.ref_id)}"]` : ".comparison-modal";
      const target = document.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    }, 0);
  }

  async #respond(type: "BriefItemAccepted" | "BriefItemIgnored", item: BriefItem, briefId: string) {
    const destination = this.#destination(item);
    const appended = await this.store.append({ type, payload: { brief_id: briefId, item_id: item.item_id, rank: item.rank, brief_size: this.#items().length, destination } });
    if (type === "BriefItemAccepted" && appended.length) this.#openDestination(destination);
  }

  #prepareBlank() {
    this.#blankName = "Untitled study"; this.requestUpdate();
    void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".blank-document-form input")?.select());
  }

  async #startBlank(event: SubmitEvent, briefId: string, sessionId: string | null) {
    event.preventDefault(); const title = this.#blankName?.trim(); if (!title) return;
    const documentId = crypto.randomUUID();
    const appended = await this.store.appendBatch([
      { type: "EmptyCanvasChosen", payload: { session_id: sessionId, brief_id: briefId, new_document_id: documentId } },
      { type: "DocumentCreated", payload: { document_id: documentId, handle: `document-${documentId.slice(0,8)}`, title, entry_surface: "blank-canvas" } },
    ]);
    if (appended.length === 2) {
      this.#blankName = null;
      this.store.patchUi({ focusBlockId: "", focusCollectionId: "", compareOpen: false });
      this.store.setRoute("/");
    }
  }

  #brief() {
    const brief = this.store.projection.get().brief;
    return brief && brief.input_receipt && brief.composition ? brief : null;
  }

  #items() { const items = this.#brief()?.items; return Array.isArray(items) ? items as BriefItem[] : []; }

  async #reviewPhase6(decision: "advance" | "continue" | "stop") {
    const events = this.store.events.get(); const metrics = phase6GateMetrics(events);
    if (!metrics.evidenceReady) return;
    await this.store.append({ type: "PhaseGateReviewed", payload: {
      phase: 6,
      decision,
      review_mode: decision === "advance" ? "advance-with-monitoring" : decision,
      continue_evidence_collection: decision === "advance" || decision === "continue",
      evidence_sequence: this.store.head.get(),
      evidence_snapshot: {
        impressions: metrics.impressions,
        acceptances: metrics.acceptances,
        acceptance_rate: metrics.acceptanceRate,
        cost_per_acceptance_usd: metrics.costPerAcceptance,
        blank_choices: metrics.blankChoices,
        dosage_curve: metrics.dosageCurve,
      },
    } });
  }

  override render() {
    const p = this.store.projection.get(); const events = this.store.events.get(); const eligibility = briefEligibility(events); const metrics = phase6GateMetrics(events); const delta = sessionContinuityDelta(events); const brief = this.#brief(); const items = this.#items(); const briefId = String(brief?.brief_id ?? ""); const busy = this.store.busy.get();
    const phase6Review = events.findLast((event) => event.type === "PhaseGateReviewed" && Number(event.payload.phase) === 6); const phase6Decision = String(phase6Review?.payload.decision ?? ""); const terminalPhase6Decision = phase6Decision === "advance" || phase6Decision === "stop";
    return html`<section class="sessions-page page-pad"><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">Continuity without dependency</span><h1>Sessions & re-entry</h1><p>Return to a small context document composed from witnessed state—not a summary fixture and never a required detour.</p></div><div class="page-header-actions"><span class="session-state ${p.sessionOpen?"open":"closed"}">${p.sessionOpen?"Session open":"Session closed"}</span>${p.sessionOpen?html`<button class="button secondary" ?disabled=${busy==="close-session"} @click=${()=>this.store.closeSession()}>${busy==="close-session"?"Capturing state…":"Close current session"}</button>`:html`<button class="button primary" ?disabled=${busy==="open-session"} @click=${()=>this.store.openSession()}>${busy==="open-session"?"Opening…":"Open new session"}</button>`}</div></header>
      <div class="session-grid"><main><section class="brief-card"><header><div><span class="eyebrow">Re-entry brief · ${items.length} items</span><h2>${items.length?"Pick up the thread":"Brief waits for valid history"}</h2></div><span class="health-pill ${items.length?"":"waiting"}"><i></i> ${items.length?"event-derived":eligibility.eligible?"ready to compose":"cold start"}</span></header><p class="brief-lead">The brief uses the same portable references as the studio. Composition, presentation, and response are separate immutable facts, so the pilot can distinguish usefulness from mere visibility.</p>
        ${items.length?html`<div class="brief-blocks">${items.map((item,index)=>{const destination=this.#destination(item);const label=item.item_type==="comparison"?"Open comparison":item.item_type==="collection"?"Open collection":"Open thread";return html`<article class="brief-block" tabindex="0"><div class="brief-index">${String(index+1).padStart(2,"0")}</div><div><span class="block-type">${item.item_type} · inferred</span><h3>${item.title}</h3><p>${item.summary}</p><small>Why: ${item.rationale_ref} · ${item.source_event_refs.length} cited event${item.source_event_refs.length===1?"":"s"} · impression witnessed</small></div><div class="brief-actions"><button class="button primary" data-destination-view=${destination.view} data-target-ref=${destination.ref_id} title=${`Open ${destination.view.replace("-"," ")}: ${destination.ref_id}`} @click=${()=>this.#respond("BriefItemAccepted",item,briefId)}>${label}</button><button class="button ghost" @click=${()=>this.#respond("BriefItemIgnored",item,briefId)}>Ignore</button></div></article>`;})}</div><footer><button class="button ghost" @click=${()=>this.store.append({type:"BriefDismissed",payload:{brief_id:briefId,brief_size:items.length}})}>Dismiss brief</button>${this.#blankName===null?html`<button class="blank-choice" @click=${this.#prepareBlank}>Start with a blank canvas ${icon("arrow")}</button>`:nothing}</footer>${this.#blankName!==null?html`<form class="blank-document-form" @submit=${(event:SubmitEvent)=>this.#startBlank(event,briefId,p.currentSessionId)}><label for="blank-document-name"><span class="eyebrow">Blank document</span><b>Name it before it enters the stream</b></label><input id="blank-document-name" maxlength="80" .value=${this.#blankName} @input=${(event:InputEvent)=>{this.#blankName=(event.target as HTMLInputElement).value;this.requestUpdate();}}><div><button type="button" class="button ghost" @click=${()=>{this.#blankName=null;this.requestUpdate();}}>Cancel</button><button type="submit" class="button primary" ?disabled=${!this.#blankName.trim()}>Create blank document</button></div></form>`:nothing}`:html`<div class="brief-empty"><span>${icon(eligibility.eligible?"spark":"clock")}</span><div><h3>${eligibility.eligible?"The event stream is eligible":"Cold-start protection is active"}</h3><p>${eligibility.eligible?"Compose a brief now; its items and impressions will be appended atomically before they render.":`Forma still needs ${eligibility.reasons.join(" and ")}. A brief composed sooner would test cold start, not re-entry value.`}</p></div><button class="button primary" ?disabled=${!eligibility.eligible||!p.sessionOpen||busy==="compose-brief"} @click=${()=>this.store.composeBrief()}>${busy==="compose-brief"?"Composing…":"Compose eligible brief"}</button></div>`}
        <div class="continuity-receipt"><span>${icon("replay")}</span><div><b>Continuity delta</b><small>State at close: sequence ${delta.snapshotHead || "not captured"} · ${delta.eventCount} meaningful event${delta.eventCount===1?"":"s"} since · ${delta.eventTypes.length?delta.eventTypes.join(", "):"no changes"}</small></div></div>
      </section>
        <section class="time-section"><div class="section-heading"><div><span class="eyebrow">Authored future memory</span><h2>Conditions & resurfacing</h2></div><button class="button secondary compact" @click=${()=>this.store.setRoute("/memory")}>Manage time policies</button></div><div class="condition-row"><div><span>${icon("clock")}</span><div><b>${p.conditions.filter((condition)=>!condition.fired).length} active time polic${p.conditions.filter((condition)=>!condition.fired).length===1?"y":"ies"}</b><small>Triggers are evaluated by the scheduler and witnessed as ConditionFired + Resurfaced.</small></div></div><button @click=${()=>this.store.checkConditions()}>Check due</button></div></section>
      </main><aside><section class="gate-card"><span class="gate-label">Phase 6 gate · ${terminalPhase6Decision?phase6Decision:metrics.evidenceReady?"human review":"collecting"}</span><h2>Re-entry hypothesis</h2><div class="gate-metrics"><div><b>${Math.round(metrics.acceptanceRate*100)}%</b><span>accepted / impression</span></div><div><b>${metrics.costPerAcceptance===null?"—":metrics.costPerAcceptance===0?"$0":`$${metrics.costPerAcceptance.toFixed(3)}`}</b><span>cost / accepted</span></div><div><b>${metrics.impressions}/${metrics.requiredImpressions}</b><span>pilot impressions</span></div></div><p>Scout and taste automation stay gated until the pilot has impression-denominated acceptance, cost-adjusted acceptance, and at least one observed dosage cohort.</p><div class="threshold ${eligibility.eligible?"ready":""}"><span>${icon(eligibility.eligible?"check":"lock")}</span><div><b>${eligibility.closedSessions}/${eligibility.requiredClosedSessions} closed sessions · ${eligibility.unresolvedThreads+eligibility.dormantProjects} eligible thread${eligibility.unresolvedThreads+eligibility.dormantProjects===1?"":"s"}</b><small>${eligibility.eligible?"Cold-start threshold satisfied.":eligibility.reasons.join(" · ")}</small></div></div><dl class="gate-details"><div><dt>Blank canvas choices</dt><dd>${metrics.blankChoices}</dd></div><div><dt>Avg. first accept</dt><dd>${duration(metrics.averageTimeToFirstAcceptMs)}</dd></div><div><dt>Composer cost</dt><dd>${metrics.totalCost===0?"$0 deterministic":`$${metrics.totalCost.toFixed(3)}`}</dd></div></dl>${metrics.dosageCurve.length?html`<div class="dosage-curve"><span class="eyebrow">Dosage curve</span>${metrics.dosageCurve.map(point=>html`<div><b>${point.size} item${point.size===1?"":"s"}</b><span>${point.impressions} impressions</span><em>${Math.round(point.acceptanceRate*100)}% accepted</em></div>`)}</div>`:nothing}
        ${metrics.evidenceReady ? terminalPhase6Decision ? html`<div class="gate-review recorded"><b>Decision recorded: ${phase6Decision === "advance" ? "advance Phases 8 & 9 with monitoring" : "stop downstream work"}</b><small>${phase6Decision === "advance" ? "Brief impressions, acceptance, cost, and dosage evidence keep accruing after the gate." : "Downstream work remains stopped."} Receipt sequence ${String(phase6Review?.payload.evidence_sequence ?? "—")} is available in Event admin.</small>${phase6Decision === "advance" ? html`<div><button class="button gate-advance compact" @click=${()=>this.store.setRoute("/scout")}>Open Scout</button><button class="button gate-continue compact" @click=${()=>this.store.setRoute("/memory")}>Open Memory</button></div>` : nothing}</div>` : html`<div class="gate-review"><b>${phase6Decision === "continue" ? "More evidence was requested" : "The evidence floor is complete"}</b><small>Review all three views together. This is a human go/no-go decision, not an automatic score threshold.</small><div><button class="button gate-advance compact" @click=${()=>this.#reviewPhase6("advance")}>Advance + monitor</button><button class="button gate-continue compact" @click=${()=>this.#reviewPhase6("continue")}>Collect more</button><button class="button gate-stop compact" @click=${()=>this.#reviewPhase6("stop")}>Stop downstream</button></div></div>` : nothing}
      </section>
        <section class="intent-card"><span class="eyebrow">Optional, never gating</span><h3>Declare an intent</h3><textarea maxlength="500" placeholder="What are you trying to move toward?" .value=${this.#intent} @input=${(event:InputEvent)=>{this.#intent=(event.target as HTMLTextAreaElement).value;}}></textarea><button class="button secondary" ?disabled=${!this.#intent.trim()||busy==="declare-intent"} @click=${async()=>{const statement=this.#intent.trim();if(statement){await this.store.declareIntent(statement);this.#intent="";this.requestUpdate();}}}>${busy==="declare-intent"?"Recording privately…":"Record intent"}</button><small>Statement content expires under the 30-day policy; the event retains only its reference.</small></section>
        <section class="scout-gate"><div><span>${icon("spark")}</span><b>Scout report space</b></div><p>${phase6Decision === "advance" ? "Bounded reports are available while Phase 6 evidence continues to accrue." : "Runs stay off until the Phase 6 evidence sample is reviewed."}</p><button ?disabled=${phase6Decision!=="advance"} title=${phase6Decision==="advance"?"Open the report-only Scout workspace":"Phase 6 evidence review required"} @click=${()=>this.store.setRoute("/scout")}>${phase6Decision==="advance"?"Open Scout":"Run scout · Phase 6 gated"}</button></section></aside></div>
    </section>`;
  }
}
customElements.define("forma-sessions", FormaSessions);
