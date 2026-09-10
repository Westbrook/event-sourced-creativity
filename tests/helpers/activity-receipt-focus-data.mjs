// Finite synthetic identity only. No app imports or transport.
export const failedJob = () => ({
  jobId:"job-1", documentId:"doc-1", kind:"render_document", status:"failed",
  sourceSurface:"document", requestedSequence:0, documentRevision:"fixture-revision",
  requestKey:"fixture-request", sourcePreviewId:null, productionMode:"managed",
  promptTechnique:"prose", promptFanId:null, parentJobId:null, fanKind:null, members:[],
  result:{artifactKind:"video"}, error:"Synthetic retained video failure", errorDetail:null,
  moderationPromptRef:null, dismissedAt:null, attemptCount:1,
  requestedAt:"2026-09-10T12:00:00.000Z", startedAt:"2026-09-10T12:00:01.000Z",
  completedAt:"2026-09-10T12:00:02.000Z", notifiedAt:null, leaseExpiresAt:null,
  updatedAt:"2026-09-10T12:00:02.000Z", stage:"failed", progressMessage:""
});
