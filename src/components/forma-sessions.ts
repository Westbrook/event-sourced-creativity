import { html, nothing } from "lit";
import { briefEligibility, phase6GateMetrics, sessionContinuityDelta, type BriefDestination, type BriefItem } from "../model/brief";
import { FormaElement, icon } from "./forma-element";
import { DOCUMENT_VIEW_LABELS } from "../model/document-view-signals";
import "./area-navigation";

const duration = (milliseconds: number | null) => milliseconds === null ? "pending" : milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;

export class FormaSessions extends FormaElement {
  #intent = "";
  #blankName: string | null = null;

  #destination(item: BriefItem): BriefDestination {
    if (item.destination?.view && item.destination?.ref_id) return item.destination;
    const projection = this.store.projection.get();
    if (item.item_type === "thread") {
      const block = projection.libraryBlocks.find((value) => value.id === item.ref_id || value.handle === item.ref_id);
      return { route: "/", view: "context-block", ref_id: block?.id ?? item.ref_id, document_id: block?.documentId ?? projection.documentId, document_view: "document" };
    }
    if (item.item_type === "collection") {
      const collection = projection.collections.find((value) => value.id === item.ref_id || value.handle === item.ref_id);
      return { route: "/library", view: "collection", ref_id: collection?.id ?? item.ref_id };
    }
    const sourceId = item.rationale_ref.startsWith("event:") ? item.rationale_ref.slice(6) : "";
    const source = this.store.events.get().find((event) => event.eventId === sourceId);
    const objectIds = Array.isArray(source?.payload.object_ids) ? source.payload.object_ids.map(String) : [item.ref_id];
    return { route: "/", view: "comparison", ref_id: objectIds[0] ?? item.ref_id, object_ids: objectIds, document_id: projection.documentId, document_view: "document" };
  }

  #openDestination(destination: BriefDestination) {
    if (destination.view === "comparison") this.store.patchUi({ selectedOutputId: destination.ref_id, comparisonOutputIds: (destination.object_ids ?? [destination.ref_id]).join("|"), compareOpen: true, focusBlockId: "", focusCollectionId: "" });
    else if (destination.view === "collection") this.store.patchUi({ focusCollectionId: destination.ref_id, focusBlockId: "", compareOpen: false });
    else if (destination.view === "document") this.store.patchUi({ focusBlockId: "", focusCollectionId: "", compareOpen: false });
    else this.store.patchUi({ focusBlockId: destination.ref_id, focusCollectionId: "", compareOpen: false });
    this.store.setRoute(destination.route);
    if (destination.view === "document") return;
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
        document_view_coverage: metrics.viewCoverage,
        document_view_breakdown: metrics.viewBreakdown,
        top_accepted_document_view: metrics.topAcceptedView,
      },
    } });
  }

  override render() {
    const p = this.store.projection.get(); const events = this.store.events.get(); const eligibility = briefEligibility(events); const metrics = phase6GateMetrics(events); const delta = sessionContinuityDelta(events); const brief = this.#brief(); const items = this.#items(); const briefId = String(brief?.brief_id ?? ""); const busy = this.store.busy.get();
    const phase6Review = events.findLast((event) => event.type === "PhaseGateReviewed" && Number(event.payload.phase) === 6); const phase6Decision = String(phase6Review?.payload.decision ?? ""); const terminalPhase6Decision = phase6Decision === "advance" || phase6Decision === "stop";
    return html`<section class="sessions-page page-pad"><forma-area-navigation area="intelligence" active="sessions"></forma-area-navigation><header class="page-header page-header--hero"><div class="page-header-copy"><span class="eyebrow">Creative intelligence / Re-entry</span><h1>Sessions & re-entry</h1><p>Return to the ideas, comparisons, and decisions that matter most without reconstructing where you left off.</p></div><div class="page-header-actions"><span class="session-state ${p.sessionOpen?"open":"closed"}">${p.sessionOpen?"Session open":"Session closed"}</span>${p.sessionOpen?html`<button class="button secondary" ?disabled=${busy==="close-session"} @click=${()=>this.store.closeSession()}>${busy==="close-session"?"Saving your place…":"Finish this session"}</button>`:html`<button class="button primary" ?disabled=${busy==="open-session"} @click=${()=>this.store.openSession()}>${busy==="open-session"?"Opening…":"Start a new session"}</button>`}</div></header>
      <div class="session-grid"><main><section class="brief-card"><header><div><span class="eyebrow">Ready to resume · ${items.length} idea${items.length===1?"":"s"}</span><h2>${items.length?"Pick up where you left off":"Find the right place to restart"}</h2></div><span class="health-pill ${items.length?"":"waiting"}"><i></i> ${items.length?"ready to resume":eligibility.eligible?"ready to prepare":"gathering context"}</span></header><p class="brief-lead">Forma revisits actual decisions, unfinished comparisons, and nearby work. You decide what to reopen; nothing is changed automatically.</p>
        ${items.length?html`<div class="brief-blocks">${items.map((item,index)=>{const destination=this.#destination(item);const label=item.item_type==="intent"?item.title.startsWith("Review your ready")?"Review result":"Continue work":item.item_type==="comparison"?"Open comparison":item.item_type==="collection"?"Open collection":"Open thread";const documentView=destination.document_view?DOCUMENT_VIEW_LABELS[destination.document_view]:null;return html`<article class="brief-block" tabindex="0"><div class="brief-index">${String(index+1).padStart(2,"0")}</div><div><span class="block-type">${item.item_type==="intent"?"Your unfinished work":`${item.item_type} · suggested`}</span><h3>${item.title}</h3><p>${item.summary}</p>${documentView?html`<span class="brief-view-path">Resume in ${documentView}</span>`:nothing}<small>${item.item_type==="intent"?"Based on":"Suggested from"} ${item.source_event_refs.length} recent creative action${item.source_event_refs.length===1?"":"s"}</small></div><div class="brief-actions"><button class="button primary" data-destination-view=${destination.view} data-target-ref=${destination.ref_id} title=${`Resume ${item.title}`} @click=${()=>this.#respond("BriefItemAccepted",item,briefId)}>${label}</button><button class="button ghost" @click=${()=>this.#respond("BriefItemIgnored",item,briefId)}>Not now</button></div></article>`;})}</div><footer><button class="button ghost" @click=${()=>this.store.append({type:"BriefDismissed",payload:{brief_id:briefId,brief_size:items.length}})}>Dismiss suggestions</button>${this.#blankName===null?html`<button class="blank-choice" @click=${this.#prepareBlank}>Start with a blank document ${icon("arrow")}</button>`:nothing}</footer>${this.#blankName!==null?html`<form class="blank-document-form" @submit=${(event:SubmitEvent)=>this.#startBlank(event,briefId,p.currentSessionId)}><label for="blank-document-name"><span class="eyebrow">Blank document</span><b>Give your new document a name</b></label><input id="blank-document-name" maxlength="80" .value=${this.#blankName} @input=${(event:InputEvent)=>{this.#blankName=(event.target as HTMLInputElement).value;this.requestUpdate();}}><div><button type="button" class="button ghost" @click=${()=>{this.#blankName=null;this.requestUpdate();}}>Cancel</button><button type="submit" class="button primary" ?disabled=${!this.#blankName.trim()}>Create blank document</button></div></form>`:nothing}`:html`<div class="brief-empty"><span>${icon(eligibility.eligible?"spark":"clock")}</span><div><h3>${eligibility.eligible?"Your recent work is ready to revisit":"A little more history will help"}</h3><p>${eligibility.eligible?"Review a small set of promising places to continue without changing your document.":`Keep creating until Forma has enough completed sessions and unfinished work to make useful suggestions.`}</p></div><button class="button primary" ?disabled=${!eligibility.eligible||!p.sessionOpen||busy==="compose-brief"} @click=${()=>this.store.composeBrief()}>${busy==="compose-brief"?"Finding your place…":"Find where to continue"}</button></div>`}
        <div class="continuity-receipt"><span>${icon("replay")}</span><div><b>Since your last session</b><small>${delta.eventCount} meaningful creative action${delta.eventCount===1?"":"s"} ${delta.eventCount===1?"has":"have"} been saved${delta.snapshotHead?" since you last stopped":""}.</small>${delta.lastDocumentView?html`<small>You last worked in ${DOCUMENT_VIEW_LABELS[delta.lastDocumentView]}${delta.viewTransitions?` and switched working modes ${delta.viewTransitions===1?"once":`${delta.viewTransitions} times`}`:""}.</small>`:nothing}${delta.eventTypes.length?html`<details class="creative-diagnostics"><summary>See the kinds of work included</summary><p>${delta.eventTypes.slice(0,8).map((type)=>type.replace(/([a-z])([A-Z])/g,"$1 $2").toLocaleLowerCase()).join(" · ")}${delta.eventTypes.length>8?` · ${delta.eventTypes.length-8} more`:""}</p></details>`:nothing}</div></div>
        ${metrics.viewBreakdown.length?html`<div class="reentry-view-evidence"><span class="eyebrow">Working-mode acceptance</span>${metrics.viewBreakdown.map((row)=>html`<div><b>${row.label}</b><span>${row.impressions} impression${row.impressions===1?"":"s"}</span><em>${Math.round(row.acceptanceRate*100)}% accepted</em></div>`)}</div>`:nothing}
      </section>
        <section class="time-section"><div class="section-heading"><div><span class="eyebrow">Return at the right moment</span><h2>Reminders & resurfacing</h2></div><button class="button secondary compact" @click=${()=>this.store.setRoute("/memory")}>Manage reminders</button></div><div class="condition-row"><div><span>${icon("clock")}</span><div><b>${p.conditions.filter((condition)=>!condition.fired).length} active reminder${p.conditions.filter((condition)=>!condition.fired).length===1?"":"s"}</b><small>Relevant work reappears when the timing or creative activity you chose is reached.</small></div></div><button @click=${()=>this.store.checkConditions()}>Check now</button></div></section>
      </main><aside><details class="creative-diagnostics creative-diagnostics--panel"><summary>Review suggestion quality and safeguards</summary><section class="gate-card"><span class="gate-label">Phase 6 gate · ${terminalPhase6Decision?phase6Decision:metrics.evidenceReady?"human review":"collecting"}</span><h2>Are these suggestions helping?</h2><div class="gate-metrics"><div><b>${Math.round(metrics.acceptanceRate*100)}%</b><span>accepted / shown</span></div><div><b>${metrics.costPerAcceptance===null?"—":metrics.costPerAcceptance===0?"$0":`$${metrics.costPerAcceptance.toFixed(3)}`}</b><span>cost / accepted</span></div><div><b>${metrics.impressions}/${metrics.requiredImpressions}</b><span>reviewed suggestions</span></div></div><p>Additional automated suggestions stay unavailable until there is enough evidence that re-entry is useful, understandable, and appropriately bounded.</p><div class="threshold ${eligibility.eligible?"ready":""}"><span>${icon(eligibility.eligible?"check":"lock")}</span><div><b>${eligibility.closedSessions}/${eligibility.requiredClosedSessions} previous sessions · ${eligibility.unresolvedThreads+eligibility.dormantProjects} unfinished creative thread${eligibility.unresolvedThreads+eligibility.dormantProjects===1?"":"s"}</b><small>${eligibility.eligible?"Enough context is available.":eligibility.reasons.join(" · ")}</small></div></div><dl class="gate-details"><div><dt>Blank document choices</dt><dd>${metrics.blankChoices}</dd></div><div><dt>Average time to continue</dt><dd>${duration(metrics.averageTimeToFirstAcceptMs)}</dd></div><div><dt>Suggestion cost</dt><dd>${metrics.totalCost===0?"$0":`$${metrics.totalCost.toFixed(3)}`}</dd></div></dl>${metrics.dosageCurve.length?html`<div class="dosage-curve"><span class="eyebrow">Dosage curve</span>${metrics.dosageCurve.map(point=>html`<div><b>${point.size} item${point.size===1?"":"s"}</b><span>${point.impressions} impressions</span><em>${Math.round(point.acceptanceRate*100)}% accepted</em></div>`)}</div>`:nothing}
        ${metrics.evidenceReady ? terminalPhase6Decision ? html`<div class="gate-review recorded"><b>Decision recorded: ${phase6Decision === "advance" ? "advance Phases 8 & 9 with monitoring" : "stop downstream work"}</b><small>${phase6Decision === "advance" ? "Brief impressions, acceptance, cost, and dosage evidence keep accruing after the gate." : "Downstream work remains stopped."} Receipt sequence ${String(phase6Review?.payload.evidence_sequence ?? "—")} is available in Event admin.</small>${phase6Decision === "advance" ? html`<div><button class="button gate-advance compact" @click=${()=>this.store.setRoute("/scout")}>Open Scout</button><button class="button gate-continue compact" @click=${()=>this.store.setRoute("/memory")}>Open Memory</button></div>` : nothing}</div>` : html`<div class="gate-review"><b>${phase6Decision === "continue" ? "More evidence was requested" : "The evidence floor is complete"}</b><small>Review all three views together. This is a human go/no-go decision, not an automatic score threshold.</small><div><button class="button gate-advance compact" @click=${()=>this.#reviewPhase6("advance")}>Advance + monitor</button><button class="button gate-continue compact" @click=${()=>this.#reviewPhase6("continue")}>Collect more</button><button class="button gate-stop compact" @click=${()=>this.#reviewPhase6("stop")}>Stop downstream</button></div></div>` : nothing}
      </section></details>
        <section class="intent-card"><span class="eyebrow">Optional, never gating</span><h3>Declare an intent</h3><textarea maxlength="500" placeholder="What are you trying to move toward?" .value=${this.#intent} @input=${(event:InputEvent)=>{this.#intent=(event.target as HTMLTextAreaElement).value;}}></textarea><button class="button secondary" ?disabled=${!this.#intent.trim()||busy==="declare-intent"} @click=${async()=>{const statement=this.#intent.trim();if(statement){await this.store.declareIntent(statement);this.#intent="";this.requestUpdate();}}}>${busy==="declare-intent"?"Recording privately…":"Record intent"}</button><small>Statement content expires under the 30-day policy; the event retains only its reference.</small></section>
        <section class="scout-gate"><div><span>${icon("spark")}</span><b>Discover a useful next move</b></div><p>${phase6Decision === "advance" ? "Scout can review your progress and suggest directions without changing your work." : "Scout becomes available after a reviewer confirms that suggestions are useful and safe."}</p><button ?disabled=${phase6Decision!=="advance"} title=${phase6Decision==="advance"?"Explore creative suggestions":"Suggestions are awaiting approval"} @click=${()=>this.store.setRoute("/scout")}>${phase6Decision==="advance"?"Explore suggestions":"Awaiting approval"}</button></section></aside></div>
    </section>`;
  }
}
customElements.define("forma-sessions", FormaSessions);
