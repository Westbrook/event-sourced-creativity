import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  activityJobDisposition,
  activityJobEvidence,
  activityJobIssueReport,
} from "../src/model/activity-issues.ts";
import { FORMA_RESPONSIVE_MESSAGES } from "../src/components/design-system/locales/responsive-messages.ts";

const [activity, panel, worker, policy] = await Promise.all([
  readFile(new URL("../src/components/forma-activity.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/forma-activity-issue-panel.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/document-jobs-api.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/pilot-policy.ts", import.meta.url), "utf8"),
]);

function issue(overrides = {}) {
  return {
    code: "missing_title",
    path: "items.0.title",
    message: "PRIVATE provider message and PROMPT should never be reused",
    category: "structure",
    blocking: true,
    overridable: false,
    pageIndex: 0,
    pageCount: 1,
    globalSlideIndex: 1,
    providerAttempt: 1,
    stage: "initial",
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    jobId: "job-attention-1",
    documentId: "document-attention-1",
    kind: "render_document",
    status: "failed",
    requestedAt: "2026-08-25T15:00:00.000Z",
    updatedAt: "2026-08-25T15:03:00.000Z",
    completedAt: null,
    sourceSurface: "document",
    members: [],
    stage: "rendering",
    progressMessage: "",
    error: "PRIVATE provider diagnostics req_secret must remain hidden",
    result: { artifactKind: "slides" },
    errorDetail: {
      code: "source_fidelity_validation_failed",
      category: "provider",
      scope: "request",
      action: "edit_request",
      message: "PRIVATE provider response and AUTHORED PROMPT",
      retryable: false,
      retryAfterMs: null,
      requestId: "req_secret",
      httpStatus: 422,
      validationIssues: [issue()],
    },
    ...overrides,
  };
}

test("Activity reconstitutes safe field-level issues without reusing provider-authored diagnostics", () => {
  const evidence = activityJobEvidence(job());
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].code, "missing_title");
  assert.equal(evidence[0].path, "items.0.title");
  assert.equal(evidence[0].globalSlideIndex, 1);
  assert.equal(evidence[0].message, "A slide is missing its required title.");
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE|PROMPT|req_secret/u);
});

test("Activity retains matching local field paths on separate generated slide pages", () => {
  const first = issue({ pageCount: 2, pageIndex: 0, globalSlideIndex: 1 });
  const second = issue({ pageCount: 2, pageIndex: 1, globalSlideIndex: 9 });
  const evidence = activityJobEvidence(job({
    errorDetail: { ...job().errorDetail, validationIssues: [second, first] },
  }));
  assert.deepEqual(evidence.map((entry) => entry.globalSlideIndex), [1, 9]);
});

test("Activity deduplicates repeated field diagnostics using the newest provider attempt", () => {
  const evidence = activityJobEvidence(job({
    errorDetail: {
      ...job().errorDetail,
      validationIssues: [issue(), issue({ providerAttempt: 3, stage: "repair" })],
    },
  }));
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].providerAttempt, 3);
  assert.equal(evidence[0].stage, "repair");
});

test("Activity shows remaining repair failures while retaining the initial diagnostics in the job receipt", () => {
  const retained = [
    issue({ code: "incorrect_citation_source", path: "items.0.slide.citations.0.sourceId" }),
    issue({ code: "missing_title", path: "items.1.title", globalSlideIndex: 2 }),
    issue({ code: "ungrounded_citation_excerpt", path: "items.0.slide.citations.0.excerpt", providerAttempt: 2, stage: "repair" }),
  ];
  const failed = job({ errorDetail: { ...job().errorDetail, validationIssues: retained } });
  const before = structuredClone(failed);
  const evidence = activityJobEvidence(failed);
  assert.deepEqual(evidence.map((entry) => entry.code), ["ungrounded_citation_excerpt"]);
  assert.equal(evidence[0].providerAttempt, 2);
  assert.match(evidence[0].message, /resolved source passage/u);
  assert.match(evidence[0].message, /does not establish invented wording/u);
  assert.deepEqual(failed, before, "projecting current actions must not rewrite historical evidence");
  assert.doesNotMatch(activityJobIssueReport(failed), /incorrect_citation_source|missing_title|PRIVATE|PROMPT/u);
});

test("Activity selects the newest attempt independently for every presentation page", () => {
  const evidence = activityJobEvidence(job({ errorDetail: { ...job().errorDetail, validationIssues: [
    issue({ code: "missing_title", pageCount: 2, providerAttempt: 1 }),
    issue({ code: "ungrounded_citation_excerpt", path: "items.0.slide.citations.0.excerpt", pageCount: 2, providerAttempt: 2, stage: "repair" }),
    issue({ code: "incorrect_slide_source", pageIndex: 1, pageCount: 2, globalSlideIndex: 9, providerAttempt: 3 }),
  ] } }));
  assert.deepEqual(evidence.map((entry) => [entry.pageIndex, entry.providerAttempt, entry.code]), [
    [0, 2, "ungrounded_citation_excerpt"],
    [1, 3, "incorrect_slide_source"],
  ]);
});

test("Citation assignment and excerpt failures have distinct public-safe guidance", () => {
  const evidence = activityJobEvidence(job({ errorDetail: { ...job().errorDetail, validationIssues: [
    issue({ code: "incorrect_citation_source", path: "items.0.slide.citations.0.sourceId" }),
    issue({ code: "ungrounded_citation_excerpt", path: "items.0.slide.citations.0.excerpt" }),
  ] } }));
  const assignment = evidence.find((entry) => entry.code === "incorrect_citation_source");
  const excerpt = evidence.find((entry) => entry.code === "ungrounded_citation_excerpt");
  assert.equal(assignment.category, "authorization");
  assert.equal(assignment.path, "items.0.slide.citations.0.sourceId");
  assert.match(assignment.message, /evidence permitted for this slide/u);
  assert.equal(excerpt.category, "source-integrity");
  assert.match(excerpt.message, /contiguous quotation/u);
  assert.ok(evidence.every((entry) => entry.blocking && !entry.overridable));
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE|PROMPT|req_secret/u);
});

test("Activity rejects invalid pagination and sanitizes hostile field names and failure codes", () => {
  const evidence = activityJobEvidence(job({
    errorDetail: {
      ...job().errorDetail,
      validationIssues: [
        issue({ pageIndex: 4, pageCount: 2 }),
        issue({ providerAttempt: 0 }),
        issue({ path: "PRIVATE_SOURCE_REFERENCE", code: "evil <script>" }),
      ],
    },
  }));
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].path, "$" );
  assert.equal(evidence[0].code, "presentation_validation_failed");
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE|script/u);
});

test("Activity separates mandatory correction, preference review, administration, and safe saved-render recovery", () => {
  assert.equal(activityJobDisposition(job()), "correct-mandatory-requirement");

  const preference = job({
    errorDetail: {
      ...job().errorDetail,
      validationIssues: [issue({ code: "presentation_style_mismatch", category: "presentation-preference", overridable: true })],
    },
  });
  assert.equal(activityJobDisposition(preference), "review-request");

  const blocked = job({
    errorDetail: { ...job().errorDetail, category: "quota", validationIssues: [] },
  });
  assert.equal(activityJobDisposition(blocked), "contact-administrator");

  const recovered = job({
    result: { artifactKind: "slides", recoverablePresentationCandidate: true },
    errorDetail: { ...job().errorDetail, validationIssues: [] },
  });
  assert.equal(activityJobDisposition(recovered), "recover-saved-render");
});

test("Activity issue reports contain actionable safe fields without exposing receipts, prompts, provider messages, or request IDs", () => {
  const report = activityJobIssueReport(job(), "Quarterly executive deck");
  assert.match(report, /Document: Quarterly executive deck/u);
  assert.match(report, /Job: job-attention-1/u);
  assert.match(report, /Slide 1 · missing_title/u);
  assert.match(report, /Field: items\.0\.title/u);
  assert.match(report, /mandatory validation/u);
  assert.doesNotMatch(report, /PRIVATE|PROMPT|req_secret|provider response/u);
});

test("Activity wires scoped inline issues into failed jobs, assigned reviews, and project notifications", () => {
  assert.match(activity, /<forma-activity-issue-panel \.job=\$\{job\} \.documentName=\$\{documentName\}/u);
  assert.match(activity, /<forma-activity-issue-panel \.review=\$\{task\}/u);
  assert.match(activity, /<forma-activity-issue-panel \.notification=\$\{notification\}/u);
  assert.match(activity, /syncOrganizationContextPackages\(\)/u);
  assert.match(panel, /loadActorDocumentGenerationReceipt\(job\.jobId\)/u);
  assert.match(panel, /loadPresentationCandidates\(job\.jobId, job\.documentId\)/u);
  assert.match(panel, /saveActivityIssueNote\(job\.jobId, note\)/u);
  assert.match(panel, /acceptOrganizationContextPackageUpdate\(binding\.packageId, binding\.id, binding\.pendingVersionId!/u);
  assert.match(panel, /reviseDocumentArtifact\(artifact\.id/u);
  assert.match(panel, /content_sha256: sha256/u);
  assert.match(panel, /artifact_revision: task\.revision/u);
  assert.match(panel, /window\.addEventListener\("forma-authorization-changed", this\.#clearPrivateState\)/u);
});

test("Activity issue notes remain actor-private and outside general content hydration", () => {
  assert.match(worker, /content\.owner_id=\? AND content\.kind='activity-issue-note'/u);
  assert.match(worker, /selection\.revoked_at IS NULL AND selection\.expires_at>\?/u);
  assert.match(worker, /anchor\.type='ProjectDocumentJobQueued'/u);
  assert.match(policy, /kind NOT IN\('provider-response','activity-issue-note','execution-consent','context-proposal','authoring-preview'\)/u);
  assert.doesNotMatch(worker, /ActivityIssueNoted",\{[^}]*\bbody\s*:/u);
});

test("Inline activity resolution and context updates are translated in every supported locale", () => {
  for (const locale of ["en", "fr", "ar", "ja"]) {
    const messages = FORMA_RESPONSIVE_MESSAGES[locale];
    for (const key of [
      "activity.issue.heading", "activity.issue.inspectInputs", "activity.issue.copyReport",
      "activity.issue.notes", "activity.issue.approve", "activity.issue.requestChanges",
      "activity.issue.saveCorrection", "activity.issue.acceptVersion",
      "notifications.context_update_available.detail",
    ]) assert.ok(messages[key]?.trim(), `${locale} translates ${key}`);
  }
});
