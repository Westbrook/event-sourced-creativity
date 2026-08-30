import { html, nothing } from "lit";
import type { CreativeEvent } from "../model/events.ts";
import { buildOutcomeTelemetry, type OutcomeTelemetry } from "../model/outcome-telemetry.ts";
import type { FormaLocaleController } from "./design-system/localization.ts";

type OutcomeLocale = Pick<FormaLocaleController, "t" | "number" | "date">;
const safeCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const dateLabel = (value: string | null | undefined, i18n: OutcomeLocale) =>
  value && Number.isFinite(Date.parse(value)) ? i18n.date(new Date(value), { dateStyle: "medium", timeStyle: "short" }) : i18n.t("outcome.unknown");

// An explicit zero is zero. Missing, malformed or overflowing amounts are not.
export function outcomeMoney(value: unknown, i18n: OutcomeLocale) {
  return safeCount(value) ? i18n.number(value / 1_000_000, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 })
    : i18n.t("outcome.unknown");
}

// Read-only display of the existing report; never aggregates event and ledger money.
export function outcomeTelemetryDisclosure(outcomes: OutcomeTelemetry | null | undefined, i18n: OutcomeLocale, fresh: boolean) {
  if (!outcomes || outcomes.version !== 1 || outcomes.basis !== "historical-canonical-receipts") {
    return html`<details class="analytics-evidence outcome-telemetry"><summary>${i18n.t("outcome.title")}</summary><p>${i18n.t("outcome.missing")}</p></details>`;
  }
  const { approvals, exports: exports_, usage, live } = outcomes;
  const outputHistory = outcomes.outputHistory?.basis === "historical-output-command-receipts" ? outcomes.outputHistory : null;
  const outputCount = (value: unknown) => safeCount(value) ? i18n.number(value) : i18n.t("outcome.unknown");
  const knownUsage = usage.recordedCostReceiptCount > 0 ? outcomeMoney(usage.recordedMicrousd, i18n) : i18n.t("outcome.noExplicitUsage");
  const finance = live?.finance?.scope === "actor-account" && live.finance.window === "all-reservation-periods"
    && live.finance.currency === "USD" && live.finance.source === "cost_budget_reservations" ? live.finance : null;
  const jobs = live?.jobs?.scope === "actor-owned-currently-readable-jobs" && live.jobs.window === "active-or-unexpired" && live.jobs.source === "document_jobs" ? live.jobs : null;
  return html`<details class="analytics-evidence outcome-telemetry">
    <summary>${i18n.t("outcome.summary", "", { approvals: i18n.number(approvals.receiptCount), exports: i18n.number(exports_.artifactReceiptCount) })}</summary>
    ${!fresh ? html`<p role="status">${i18n.t("outcome.snapshot")}</p>` : nothing}
    <p>${i18n.t("outcome.historyScope")}</p>
    <p>${i18n.t("outcome.range", "", { from: outcomes.window.from ? dateLabel(outcomes.window.from, i18n) : i18n.t("outcome.allTime"), through: dateLabel(outcomes.window.through, i18n) })}</p>
    ${outcomes.coverage.truncated || finance?.truncated ? html`<p>${i18n.t("outcome.truncated")}</p>` : nothing}
    <dl class="workspace-settings-facts">
      <dt>${i18n.t("outcome.approvals")}</dt><dd>${i18n.number(approvals.receiptCount)}</dd>
      <dt>${i18n.t("outcome.exactApprovals")}</dt><dd>${i18n.number(approvals.distinctExactRevisionCount)}</dd>
      <dt>${i18n.t("outcome.unboundApprovals")}</dt><dd>${i18n.number(approvals.unboundReceiptCount)}</dd>
      <dt>${i18n.t("outcome.exports")}</dt><dd>${i18n.number(exports_.artifactReceiptCount)}</dd>
      <dt>${i18n.t("outcome.exactExports")}</dt><dd>${i18n.number(exports_.distinctExactRevisionCount)}</dd>
      <dt>${i18n.t("outcome.otherExports")}</dt><dd>${i18n.number(exports_.otherResourceReceiptCount)}</dd>
      <dt>${i18n.t("outcome.recordedUsage")}</dt><dd><bdi>${knownUsage}</bdi></dd>
    </dl>
    <p>${i18n.t("outcome.notDelivery")}</p>
    <p>${i18n.t("outcome.usageCoverage", "", { known: i18n.number(usage.recordedCostReceiptCount), unknown: i18n.number(usage.unpricedReceiptCount) })}</p>
    <p>${i18n.t("outcome.noInvoice")}</p>
    <p>${i18n.t("outcome.coverage", "", { receipts: i18n.number(outcomes.coverage.countedReceipts), duplicates: i18n.number(outcomes.coverage.ignoredDuplicateReceipts), invalid: i18n.number(outcomes.coverage.invalidIdentityOrTimeReceipts) })}</p>

    <h3>${i18n.t("outcome.outputHistory")}</h3>
    ${outputHistory ? html`<dl class="workspace-settings-facts">
      <dt>${i18n.t("outcome.outputPlans")}</dt><dd>${outputCount(outputHistory.planConfirmationReceiptCount)}</dd>
      <dt>${i18n.t("outcome.outputAcceptances")}</dt><dd>${outputCount(outputHistory.targetAcceptanceReceiptCount)}</dd>
      <dt>${i18n.t("outcome.outputReusedSelections")}</dt><dd>${outputCount(outputHistory.reusedAcceptanceSelectionReceiptCount)}</dd>
      <dt>${i18n.t("outcome.outputChangesRequested")}</dt><dd>${outputCount(outputHistory.changesRequestedReceiptCount)}</dd>
      <dt>${i18n.t("outcome.outputPreparations")}</dt><dd>${outputCount(outputHistory.deliveryPreparationReceiptCount)}</dd>
    </dl><p>${i18n.t("outcome.outputCoverage", "", { duplicates: outputCount(outputHistory.ignoredDuplicateReceiptCount), unknown: outputCount(outputHistory.unclassifiedReceiptCount) })}</p>` : html`<p>${i18n.t("outcome.outputUnavailable")}</p>`}
    <p>${i18n.t("outcome.outputHistoricalOnly")}</p>
    <p>${i18n.t("outcome.outputCurrentUnmeasured")}</p>

    <h3>${i18n.t("outcome.finance")}</h3>
    <p>${i18n.t("outcome.financeScope")}</p>
    ${live ? html`<p>${i18n.t("outcome.asOf", "", { date: dateLabel(live.asOf, i18n) })}</p>` : nothing}
    ${finance ? html`
      <dl class="workspace-settings-facts"><dt>${i18n.t("outcome.held")}</dt><dd><bdi>${outcomeMoney(finance.heldMicrousd, i18n)}</bdi></dd>
        <dt>${i18n.t("outcome.settled")}</dt><dd><bdi>${outcomeMoney(finance.settledMicrousd, i18n)}</bdi></dd></dl>
      ${finance.heldMicrousd === null || finance.settledMicrousd === null ? html`<p>${i18n.t("outcome.unknownAmount")}</p>` : nothing}
      ${finance.periods.length ? html`<div class="analytics-table-wrap" role="region" tabindex="0" aria-label=${i18n.t("outcome.table")}>
        <table><caption>${i18n.t("outcome.table")}</caption><thead><tr><th scope="col">${i18n.t("outcome.period")}</th><th scope="col">${i18n.t("outcome.held")}</th><th scope="col">${i18n.t("outcome.settled")}</th><th scope="col">${i18n.t("outcome.reservationStates")}</th></tr></thead>
        <tbody>${finance.periods.map((period) => html`<tr><th scope="row"><bdi>${period.period}</bdi></th>
          <td><bdi>${outcomeMoney(period.heldMicrousd, i18n)}</bdi></td><td><bdi>${outcomeMoney(period.settledMicrousd, i18n)}</bdi></td>
          <td>${i18n.t("outcome.states", "", { held: i18n.number(period.activeCount + period.executingCount), settled: i18n.number(period.settledCount), released: i18n.number(period.releasedCount) })}
            ${period.unclassifiedCount || period.invalidAmountCount ? html`<p>${i18n.t("outcome.unresolved", "", { unknown: i18n.number(period.unclassifiedCount), invalid: i18n.number(period.invalidAmountCount) })}</p>` : nothing}</td>
        </tr>`)}</tbody></table></div>` : html`<p>${i18n.t("outcome.noReservations")}</p>`}
      <p>${i18n.t("outcome.ledgerDetail")}</p>
    ` : html`<p>${i18n.t("outcome.financeUnavailable")}</p>`}

    ${jobs ? html`<h3>${i18n.t("outcome.jobs")}</h3><dl class="workspace-settings-facts">
      <dt>${i18n.t("outcome.checkpoints")}</dt><dd>${i18n.number(jobs.retainedCheckpointCount)}</dd>
      <dt>${i18n.t("outcome.unavailableResults")}</dt><dd>${i18n.number(jobs.completedExplicitlyUnavailable)}</dd>
      <dt>${i18n.t("outcome.unknownResults")}</dt><dd>${i18n.number(jobs.completedAvailabilityUnknown)}</dd>
    </dl><p>${i18n.t("outcome.checkpointNotUsable")}</p>` : nothing}
  </details>`;
}

// Reuse the canonical model's identity, time and synthetic filtering per receipt.
export function personalUsageReceiptDisclosure(events: readonly CreativeEvent[], userId: string, i18n: OutcomeLocale, now = Date.now()) {
  const streamId = "creative:" + userId;
  const seen = new Set<string>();
  const receipts = events.filter((event) => {
    if (event.type !== "GenerationUsageRecorded" || event.streamId !== streamId || seen.has(event.eventId)) return false;
    if (buildOutcomeTelemetry([{ streamId, fictional: false, events: [event] }], { now }).usage.receiptCount !== 1) return false;
    seen.add(event.eventId); return true;
  }).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 6);
  return html`<details class="analytics-evidence outcome-telemetry">
    <summary>${i18n.t("outcome.loadedUsage")}</summary><p>${i18n.t("outcome.loadedUsageScope")}</p>
    ${receipts.length ? html`<ol class="creator-settings-charges">${receipts.map((event) => html`<li>
      <span>${i18n.t("outcome.usageAt", "", { date: dateLabel(event.occurredAt, i18n) })}</span>
      <b><bdi>${outcomeMoney(event.payload.cost_microusd, i18n)}</bdi></b>
    </li>`)}</ol>` : html`<p>${i18n.t("outcome.noLoadedUsage")}</p>`}
    <p>${i18n.t("outcome.noInvoice")}</p>
  </details>`;
}

// Existing assurance evidence only; a successful local run cannot verify hosting.
export function outcomeSchedulerEvidence(scheduler: { state: string; hostingScheduleVerified?: boolean; lastScheduledAt?: string | null }, i18n: OutcomeLocale) {
  const states = ["unobserved", "failed", "stalled", "running", "overdue", "backlogged", "healthy"];
  const observed = states.includes(scheduler.state) ? i18n.t("outcome.scheduler." + scheduler.state) : i18n.t("outcome.unknown");
  return html`<dt>${i18n.t("outcome.hostedSchedule")}</dt><dd>${i18n.t(scheduler.hostingScheduleVerified === true ? "outcome.scheduleVerified" : "outcome.scheduleUnverified")}<p>${i18n.t("outcome.scheduleNote")}</p></dd>
    <dt>${i18n.t("outcome.scheduleObservation")}</dt><dd>${observed}${scheduler.lastScheduledAt ? html`<br>${dateLabel(scheduler.lastScheduledAt, i18n)}` : nothing}</dd>`;
}
