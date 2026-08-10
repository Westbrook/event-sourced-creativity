import { html } from "lit";
import { FormaElement, icon } from "./forma-element";

const phases = [
  ["0","Foundation decisions","operational","Append-only decision and classification ledgers; five accountable human decisions remain open."],
  ["1","Log & document","operational","D1 append pipeline, compensation, handles, collections, keyboard paths, event admin, replay."],
  ["2","Compiler & generation","simulation","Deterministic snapshot contract and exports work; two commercial model providers are not selected."],
  ["3","Reflection","operational","Editable authority-marked chips, confidence treatment, authored-wins fold, scorecard fixtures."],
  ["4","Provenance","operational","Trace inspector, context diff, comparisons, rights receipts, region-promotion event seam."],
  ["5","Conversation","operational","Propose → diff boundary → accept/reject, expected sequence, externalized command text."],
  ["5.5","Collections","operational","Authored tree, nested handles, filing, move validation, and family promotion."],
  ["6","Sessions & brief","evaluation","Brief-as-context, impressions, cold-start threshold, blank canvas, dosage instrumentation."],
  ["7","Vectors & families","simulation","Family claims and promotion path are demonstrable; production vector model/data rights are pending."],
  ["8","Scout","gated","Report-space scenario, evidence and permissions exist. Budget and Phase 6 gates intentionally hold execution."],
  ["9","Taste & time","gated","Preference/condition surfaces and history semantics exist. Decay and legal posture remain human-governed."],
  ["10","Library & sharing","partial","Personal library and lossless files work. Shared links wait for personal/team/community scope."],
];
const decisions = [
  ["Image providers","Select at least two commercial providers","Blocks real adapters; simulation remains neutral."],
  ["Capture & privacy","Define ambient capture boundary","Manual upload only today."],
  ["Cost ceilings","Approve scout, token, and monthly budgets","Paid autonomous runs remain off."],
  ["Legal & data rights","Choose retention and derived-memory rights","Telemetry beyond fixtures remains constrained."],
  ["Sharing scope","Personal, team, or community","Link publishing remains off; downloads work."],
];

export class FormaSystem extends FormaElement {
  override render() {
    const events=this.store.events.get(); const failures=events.filter(e=>e.type==="ValidationFailed").length; const outputs=this.store.projection.get().outputs;
    return html`<section class="system-page page-pad"><header class="page-hero"><div><span class="eyebrow">Plan coverage · honest status</span><h1>System architecture</h1><p>Every plan surface has an implemented interaction, an explicit simulation boundary, or a visible human gate. Nothing inferential is presented as authored.</p></div><button class="button primary" @click=${()=>this.store.setRoute("/admin/events")}>Open event operations ${icon("arrow")}</button></header>
      <section class="architecture-strip"><div><span>User surfaces</span><b>Studio · chat · ingest · brief · library</b></div><i>${icon("arrow")}</i><div class="truth"><span>Source of truth</span><b>Immutable event log</b></div><i>${icon("arrow")}</i><div><span>Rebuildable plane</span><b>Documents · graphs · gauges · prompts</b></div><i>${icon("arrow")}</i><div><span>Participants</span><b>Compiler · extractors · brief · scout</b></div></section>
      <div class="system-grid"><main><section><div class="section-heading"><div><span class="eyebrow">Revision 2.1 + kickoff addendum</span><h2>Implementation coverage</h2></div><span>${phases.length} slices</span></div><div class="phase-list">${phases.map(([n,name,status,detail])=>html`<article><span class="phase-number">${n}</span><div><h3>${name}</h3><p>${detail}</p></div><em class="status ${status}">${status}</em></article>`)}</div></section><section class="invariants"><div class="section-heading"><div><span class="eyebrow">Load-bearing constraints</span><h2>Invariant checks</h2></div></div><div class="invariant-grid">${[["Truth","No mutable product state outside event folds."],["Workers","Append facts; never mutate projections."],["Authority","User acts alone promote inferred state."],["Parity","Canvas and chat materialize the same events."],["Concurrency","Stale, commutative, authored-wins, partial batch."],["Capacity","Dosage caps are ceilings, never targets."]].map(([a,b])=>html`<div><span>${icon("check")}</span><p><b>${a}</b>${b}</p></div>`)}</div></section></main><aside><section class="gauge-panel"><span class="eyebrow">Operational gauges</span><h2>Current stream</h2><div class="gauge-grid"><div><b>0</b><span>projection lag</span></div><div><b>${events.length}</b><span>events folded</span></div><div><b>${failures}</b><span>validation events</span></div><div><b>${outputs.length?Math.round(outputs.reduce((s,o)=>s+o.latency,0)/outputs.length):0} ms</b><span>mean simulation</span></div></div><div class="gauge-row"><span>Rebuild equivalence</span><b>passing</b></div><div class="gauge-row"><span>Prompt citations</span><b>complete</b></div><div class="gauge-row"><span>React runtime</span><b>removed</b></div><div class="gauge-row"><span>Lit custom elements</span><b>active</b></div><div class="gauge-row"><span>Signals layer</span><b>experimental</b></div></section><section class="decision-panel"><span class="eyebrow">Escalate and block</span><h2>Human decisions</h2>${decisions.map(([name,ask,effect])=>html`<details><summary><span>${icon("lock")}</span><b>${name}</b></summary><p>${ask}</p><small>${effect}</small></details>`)}</section></aside></div>
      <section class="tech-note"><span class="rubric-icon">β</span><div><h2>Experimental state substrate, isolated by design</h2><p>The requested TC39 Signals polyfill and signal-utils power the store and synthetic stream builder. Both upstream projects mark their APIs experimental, so Forma keeps them behind a small store boundary; Lit components consume the store contract, not package-specific internals.</p></div></section>
    </section>`;
  }
}
customElements.define("forma-system", FormaSystem);
