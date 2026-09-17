import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const [contract, { canonicalJson, digest }, intake, { preflightOutputImageSlidesTarget }, { sponsorImageTransport }, canonical, { makeEvent }, { authoritativeCreativeContext }] = await Promise.all([
  import('../worker/experience-guest-sponsor-contract.ts'), import('../src/experiences/compiler.ts'), import('../src/experiences/intake.ts'),
  import('../worker/output-image-slides-preflight.ts'), import('../worker/experience-sponsor-image-evidence.ts'), import('../worker/experience-sponsor-policy.ts'), import('../worker/event-write-primitives.ts'), import('../worker/context-authority.ts'),
]);
const { readGuestSponsorPolicy, compileGuestSponsorApprovalProposal, compileGuestSponsorSessionBinding,
  compileGuestSponsorSourceBinding, deriveGuestSponsorDriver, compileGuestSponsorEnvelope } = contract;

// Actual pure native quote/template contracts, but synthetic guest metadata.
// This suite proves no guest possession, payer approval, issuance, native job,
// hold, generated output, custody, provider invoice or live acceptance.
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('Guest contract tests prohibit network'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); });
const h = digit => `sha256:${digit.repeat(64)}`;
const now = 1_800_000_000_000;
const env = { OPENAI_API_KEY: 'no-network-fixture', OPENAI_MODEL: 'gpt-5.6-terra', OPENAI_IMAGE_MODEL: 'gpt-image-2' };
const release = await intake.registeredExperience('image');
const sessionId = '11111111-1111-4111-a111-111111111111', guestSubject = 'guest:22222222-2222-4222-a222-222222222222';
const draftId = await intake.experienceDraftId(guestSubject, sessionId);
const [projectId, documentId] = await Promise.all([intake.experienceResourceId(draftId, 'project'), intake.experienceResourceId(draftId, 'document')]);
const values = intake.initialValues(release);
values.subject = { value: 'An orchard at dusk', provenance: 'authored' };
values.ratio = { value: { width: 1, height: 1 }, provenance: 'authored' };
const plan = await intake.buildExperiencePlan(guestSubject, { intentId: sessionId, experienceId: 'image', releaseHash: release.releaseHash, values }, release);
const sourceEvents = plan.events.map((event, index) => makeEvent(plan.streamId, index + 1, guestSubject, 'server:guest-source', draftId, event.type, event.payload));
// Real registered intake + native fold/context grammar, no persisted guest proof.
const snapshot = authoritativeCreativeContext(sourceEvents, { projectId, documentId }).snapshot;
const offered = await preflightOutputImageSlidesTarget({ env, target: { id: 'original-image-target', selected: true, blocking_issues: [], media_kind: 'image', source_scope: { kind: 'document' },
  aspect_ratio: { width: 1, height: 1 }, instruction_text: 'Show the orchard', label: 'Image', coverage: { kind: 'document_outline' } }, context: { snapshot } });
assert.equal(offered.available, true);
const transport = await sponsorImageTransport(env);
const settings = offered.settings, payload = settings.payload;
const template = { version: 2, appId: 'image', recipeVersion: `image@${release.definition.revision}`, releaseDigest: release.releaseHash, outputKind: 'image', inputMode: 'text-only',
  outputCount: 1, durationMs: 0, width: 1024, height: 1024, route: offered.route, maximumCalls: offered.maximumCalls, maximumTokens: offered.maximumTokens, maximumMicrousd: offered.maximumMicrousd,
  calls: structuredClone(settings.calls), settings: { kind: settings.kind, productionMode: payload.productionMode, budgetAcknowledged: payload.budgetAcknowledged,
    preflightAcknowledged: payload.preflightAcknowledged, imageRender: structuredClone(settings.imageRender), imageBudget: structuredClone(settings.imageBudget), executionPolicy: structuredClone(settings.executionPolicy) }, transport };
const resourceAllowance = { maximumOperations: 100, maximumTextBytes: 1000000, maximumOperationsPerWindow: 100, maximumTextBytesPerWindow: 1000000, maximumPendingGrants: 10, maximumInflightJobs: 1 };
const rawPolicy = { version: 3, mode: 'candidate', campaignId: 'guest-campaign', policyVersion: 'guest-policy@1', payerUserId: 'actual-payer-locator', audience: 'guest-session', approvalReceiptDigest: h('1'),
  startsAtMs: now - 60000, expiresAtMs: now + 600000, maximumGrantLifetimeMs: 60000, maximumAdmissions: 10, maximumMicrousd: template.maximumMicrousd * 10,
  maximumAdmissionsPerActor: 1, windowMs: 60000, maximumAdmissionsPerWindow: 10, maximumAdmissionsPerActorWindow: 1, templates: [template],
  resources: { version: 2, allowedOperations: ['text-intake', 'preflight', 'issuance', 'image-text-draft-storage'], startsAtMs: now - 60000, expiresAtMs: now + 600000,
    windowMs: 60000, maximumOperationTextBytes: 65536, campaign: structuredClone(resourceAllowance), actor: structuredClone(resourceAllowance) },
  guestAdmission: { protocol: 'guest-image-source@1', origin: 'https://forma.example', sessionPolicyId: 'guest-session-policy', sessionTermsDigest: h('2'), sourcePolicyId: 'guest-source-policy', sourcePolicyDigest: h('3'), releaseHash: release.releaseHash } };
const rawSession = { domain: 'forma-sponsor-guest-session@1', sessionId, guestSubject, projectId, documentId,
  sessionPolicyId: rawPolicy.guestAdmission.sessionPolicyId, sessionTermsDigest: rawPolicy.guestAdmission.sessionTermsDigest, expiresAtMs: now + 300000 };
const session = await compileGuestSponsorSessionBinding(rawSession);
const rawSource = { domain: 'forma-sponsor-guest-source@1', sessionDigest: session.sessionDigest, sourcePolicyId: rawPolicy.guestAdmission.sourcePolicyId,
  sourcePolicyDigest: rawPolicy.guestAdmission.sourcePolicyDigest, draftId, draftHash: plan.draftHash, requestDigest: await digest(plan.request), contentDigest: await digest(canonicalJson(plan)), releaseHash: release.releaseHash,
  sourceHead: sourceEvents.length, sourceEventIds: sourceEvents.map(event => event.eventId), expiresAtMs: now + 120000 };
const source = await compileGuestSponsorSourceBinding(rawSource);
const rawDriver = { version: 1, action: 'run-guest-sponsored-image', campaignId: rawPolicy.campaignId, sessionId, documentId, draftId, draftHash: rawSource.draftHash, guestSourceDigest: source.guestSourceDigest };
const driver = await deriveGuestSponsorDriver(rawDriver);
const recipe = { appId: 'image', recipeVersion: template.recipeVersion, releaseDigest: release.releaseHash, outputKind: 'image', provider: offered.provider, model: offered.model,
  routeDigest: await digest(offered), settingsDigest: await digest(settings), outputCount: 1, durationMs: 0, width: 1024, height: 1024,
  calls: { parsing: 0, planning: 1, render: 1, repair: 0 }, maximumTokens: offered.maximumTokens, maximumMicrousd: offered.maximumMicrousd };
const preflightWithoutDigest = { id: 'preflight-original', planRevisionId: 'plan-original', sourceDigest: '7'.repeat(64), requirementsDigest: '8'.repeat(64), targets: [offered],
  operationAttempts: { [offered.targetId]: { ordinal: 0, previousSlotId: null } }, maximumMicrousd: offered.maximumMicrousd, maximumCalls: 2,
  expiresAt: new Date(now + 90000).toISOString(), createdAt: new Date(now - 1000).toISOString() };
const preflight = { ...preflightWithoutDigest, termsDigest: (await digest(preflightWithoutDigest)).slice(7) };
const authorization = { version: 1, purpose: 'authorize-guest-sponsored-image', sessionDigest: session.sessionDigest, guestSourceDigest: source.guestSourceDigest,
  policyDigest: await digest(rawPolicy), termsDigest: preflight.termsDigest, maximumMicrousd: recipe.maximumMicrousd, preflightId: preflight.id, explicitAuthorization: true };
const native = { sourceRevision: sourceEvents.length + 3, preflight, contextSnapshot: snapshot, transport };
const rawEnvelope = { version: 3, campaignId: rawPolicy.campaignId, policyVersion: rawPolicy.policyVersion,
  consumptionId: `sponsor-consume-${(await digest({ campaignId: rawPolicy.campaignId, actorUserId: guestSubject, intentKey: driver.stageKeys.authorize })).slice(7)}`,
  intentKey: driver.stageKeys.authorize, actorKind: 'guest', actorUserId: guestSubject, sessionDigest: session.sessionDigest, payerUserId: rawPolicy.payerUserId,
  ownerUserId: guestSubject, projectId, documentId, sourceRevision: native.sourceRevision, sourceDigest: `sha256:${preflight.sourceDigest}`, orderedAssetDigests: [],
  rightsDigest: await digest({ domain: 'forma-sponsor-guest-source-rights@1', guestAdmission: rawPolicy.guestAdmission, guestSource: rawSource, sourceRevision: native.sourceRevision, sourceDigest: preflight.sourceDigest }),
  compiledInputDigest: await digest({ snapshot, settings }), transferEnvelopeDigest: await digest({ sourceDigest: preflight.sourceDigest, requirementsDigest: preflight.requirementsDigest, settings }),
  recipe, templateDigest: await digest(template), issuedAtMs: now, expiresAtMs: now + 50000, guestSource: rawSource, guestAuthorizationDigest: await digest(authorization) };
function fixture() { return structuredClone({ policy: rawPolicy, envelope: rawEnvelope, evidence: { sessionBinding: rawSession, authorization, native } }); }
function compile(value) { return compileGuestSponsorEnvelope(value.policy, value.envelope, value.evidence); }
const rejected = /guest_sponsor_/u;

test('strict v3 is frozen candidate material, and explicit approval proposal hashes do not approve a payer', async () => {
  const input = structuredClone(rawPolicy), policy = readGuestSponsorPolicy(input);
  input.templates[0].maximumMicrousd++;
  assert.equal(policy.templates[0].maximumMicrousd, template.maximumMicrousd);
  assert.ok(Object.isFrozen(policy.guestAdmission)); assert.ok(Object.isFrozen(policy.templates[0].transport.planning.format));
  const { approvalReceiptDigest: ignored, ...proposed } = structuredClone(rawPolicy); void ignored;
  const proposal = { version: 1, purpose: 'guest-sponsored-image', policy: proposed, issuerProtocol: 'guest-image-source@1' };
  const copy = structuredClone(proposal), pending = compileGuestSponsorApprovalProposal(proposal);
  proposal.policy.payerUserId = 'substituted-after-call'; proposal.policy.guestAdmission.origin = 'https://changed.example';
  const compiled = await pending;
  assert.equal(compiled.qualification, 'validation-only');
  assert.equal(compiled.termsDigest, await digest(copy));
  assert.equal(compiled.policy.approvalReceiptDigest, compiled.termsDigest);
  assert.equal(compiled.policyDigest, await digest(compiled.policy));
  assert.equal(compiled.policy.payerUserId, rawPolicy.payerUserId);
  assert.equal('authority' in compiled, false); assert.equal('approved' in compiled, false);
  await assert.rejects(compileGuestSponsorApprovalProposal({ ...copy, policy: rawPolicy }), rejected);
  await assert.rejects(compileGuestSponsorApprovalProposal({ ...copy, eligibleActorUserIds: [guestSubject] }), rejected);
});

test('all audience, origin, source policy, release and finite bounds are explicit', async t => {
  const changes = {
    'no default': () => undefined,
    'old version': p => { p.version = 2; }, 'canonical audience': p => { p.audience = 'canonical-principal'; },
    'guest payer': p => { p.payerUserId = guestSubject; }, 'origin path': p => { p.guestAdmission.origin += '/'; },
    'http origin': p => { p.guestAdmission.origin = 'http://forma.example'; }, 'credentials origin': p => { p.guestAdmission.origin = 'https://u:p@forma.example'; },
    'missing session terms': p => { delete p.guestAdmission.sessionTermsDigest; }, 'missing source policy': p => { delete p.guestAdmission.sourcePolicyId; },
    'changed release': p => { p.guestAdmission.releaseHash = h('a'); }, 'extra guest key': p => { p.guestAdmission.canonicalUserId = 'user'; },
    'unbounded admissions': p => { p.maximumAdmissions = Infinity; }, 'fractional money': p => { p.maximumMicrousd = 1.1; },
    'excess actor window': p => { p.maximumAdmissionsPerActorWindow = 2; }, 'zero grant lifetime': p => { p.maximumGrantLifetimeMs = 0; },
    'resource window outside policy': p => { p.resources.expiresAtMs++; }, 'two templates': p => { p.templates.push(structuredClone(p.templates[0])); },
    'no resources': p => { delete p.resources; }, 'render cap below template': p => { p.maximumMicrousd = 1; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, () => {
    const p = structuredClone(rawPolicy); change(p);
    assert.throws(() => readGuestSponsorPolicy(name === 'no default' ? undefined : p), rejected);
  });
});

test('guest policy identifiers retain the native session and source grammar', async () => {
  for (const invalid of ['nested/policy', 'p'.repeat(161)]) {
    for (const key of ['sessionPolicyId', 'sourcePolicyId']) {
      const p = structuredClone(rawPolicy); p.guestAdmission[key] = invalid;
      assert.throws(() => readGuestSponsorPolicy(p), /guest_sponsor_policy_invalid/u);
    }
    await assert.rejects(compileGuestSponsorSessionBinding({ ...rawSession, sessionPolicyId: invalid }), /guest_sponsor_session_binding_invalid/u);
    await assert.rejects(compileGuestSponsorSourceBinding({ ...rawSource, sourcePolicyId: invalid }), /guest_sponsor_source_binding_invalid/u);
  }
  const p = structuredClone(rawPolicy); p.guestAdmission.sessionPolicyId = 'p'.repeat(160); p.guestAdmission.sourcePolicyId = 'source.policy:version-1';
  assert.equal(readGuestSponsorPolicy(p).guestAdmission.sessionPolicyId.length, 160);
});

test('genuine identity formulas bind session and original source separately from native output revision', async () => {
  assert.equal(session.sessionDigest, await digest(rawSession)); assert.equal(source.guestSourceDigest, await digest(rawSource));
  assert.equal(session.bindingJson, canonicalJson(rawSession)); assert.equal(source.bindingJson, canonicalJson(rawSource));
  assert.ok(Object.isFrozen(source.binding.sourceEventIds));
  const compiled = await compile(fixture());
  assert.equal(compiled.qualification, 'validation-only');
  assert.equal(compiled.envelope.guestSource.sourceHead, sourceEvents.length); assert.equal(compiled.envelope.sourceRevision, sourceEvents.length + 3);
  assert.equal(compiled.envelope.actorUserId, guestSubject); assert.equal(compiled.envelope.ownerUserId, guestSubject);
  assert.equal(compiled.envelope.payerUserId, rawPolicy.payerUserId); assert.equal(compiled.envelopeDigest, await digest(rawEnvelope));
  assert.equal('statements' in compiled, false); assert.equal('authority' in compiled, false);
});

test('binding helpers reject bearer data, source substitutions and ambiguous prefix membership', async () => {
  await assert.rejects(compileGuestSponsorSessionBinding({ ...rawSession, sessionToken: 'forma-guest-session-v1.' + 'a'.repeat(64) }), rejected);
  await assert.rejects(compileGuestSponsorSessionBinding({ ...rawSession, claimToken: 'forma-guest-claim-v1.' + 'a'.repeat(64) }), rejected);
  await assert.rejects(compileGuestSponsorSessionBinding({ ...rawSession, projectId: rawSession.documentId }), rejected);
  await assert.rejects(compileGuestSponsorSessionBinding({ ...rawSession, sessionId: 'forma-guest-session-v1.' + 'a'.repeat(64) }), rejected);
  await assert.rejects(compileGuestSponsorSessionBinding({ ...rawSession, guestSubject: 'canonical-user' }), rejected);
  await assert.rejects(compileGuestSponsorSourceBinding({ ...rawSource, sourceEventIds: [rawSource.sourceEventIds[0], rawSource.sourceEventIds[0]] }), rejected);
  await assert.rejects(compileGuestSponsorSourceBinding({ ...rawSource, sourceHead: sourceEvents.length + 1 }), rejected);
  await assert.rejects(compileGuestSponsorSourceBinding({ ...rawSource, expiresAtMs: undefined }), rejected);
  await assert.rejects(compileGuestSponsorSourceBinding({ ...rawSource, session_hash: h('1') }), rejected);
});

test('driver keys fence changed payload at one immutable intent and separate campaigns/sessions/stages', async () => {
  const changed = await deriveGuestSponsorDriver({ ...rawDriver, draftHash: h('9'), guestSourceDigest: h('a') });
  assert.equal(changed.intentKey, driver.intentKey); assert.equal(changed.driverId, driver.driverId); assert.deepEqual(changed.stageKeys, driver.stageKeys);
  assert.notEqual(changed.commandDigest, driver.commandDigest);
  const second = await deriveGuestSponsorDriver({ ...rawDriver, campaignId: 'second-campaign' });
  assert.notEqual(second.intentKey, driver.intentKey);
  const otherSession = await deriveGuestSponsorDriver({ ...rawDriver, sessionId: '55555555-5555-4555-a555-555555555555' });
  assert.notEqual(otherSession.intentKey, driver.intentKey);
  assert.equal(new Set(Object.values(driver.stageKeys)).size, 3);
  await assert.rejects(deriveGuestSponsorDriver({ ...rawDriver, clientMutationId: 'purchase-again' }), rejected);
  await assert.rejects(deriveGuestSponsorDriver({ ...rawDriver, documentId: projectId }), rejected);
  assert.ok(Object.values(driver.stageKeys).every(key => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(key)));
  await assert.rejects(compileGuestSponsorSourceBinding({ ...rawSource, sourceHead: 2, sourceEventIds: rawSource.sourceEventIds.slice(0, 2) }), rejected);
});

test('guest metadata never becomes accepted v1/v2 canonical sponsorship', async () => {
  const p = rawPolicy;
  const common = { mode: 'candidate', campaignId: p.campaignId, policyVersion: p.policyVersion, payerUserId: p.payerUserId, audience: 'canonical-principal', approvalReceiptDigest: p.approvalReceiptDigest,
    startsAtMs: p.startsAtMs, expiresAtMs: p.expiresAtMs, maximumGrantLifetimeMs: p.maximumGrantLifetimeMs, maximumAdmissions: p.maximumAdmissions, maximumMicrousd: p.maximumMicrousd,
    maximumAdmissionsPerActor: p.maximumAdmissionsPerActor, windowMs: p.windowMs, maximumAdmissionsPerWindow: p.maximumAdmissionsPerWindow, maximumAdmissionsPerActorWindow: p.maximumAdmissionsPerActorWindow };
  for (const canonicalPolicy of [{ ...common, version: 1, recipes: [recipe] }, { ...common, version: 2, templates: [template], resources: p.resources }]) {
    assert.equal(canonical.readSponsorPolicy(canonicalPolicy).audience, 'canonical-principal');
    await assert.rejects(canonical.compileSponsorEnvelope(canonicalPolicy, rawEnvelope), /sponsor_guest_custody_not_integrated/u);
    assert.throws(() => readGuestSponsorPolicy(canonicalPolicy), rejected);
  }
  assert.throws(() => canonical.readSponsorPolicy(rawPolicy), /sponsor_policy_invalid/u);
  const f = fixture(); f.envelope.actorKind = 'canonical-principal'; await assert.rejects(compile(f), rejected);
});

test('envelope and original proof commitments reject every actor, payer and source cross-substitution', async t => {
  const changes = {
    'actor': f => { f.envelope.actorUserId = 'guest:99999999-9999-4999-a999-999999999999'; },
    'owner': f => { f.envelope.ownerUserId = rawPolicy.payerUserId; }, 'payer': f => { f.envelope.payerUserId = 'different-payer'; },
    'campaign': f => { f.envelope.campaignId = 'other'; }, 'policy': f => { f.envelope.policyVersion = 'other'; },
    'document': f => { f.envelope.documentId = rawSession.projectId; }, 'session': f => { f.envelope.sessionDigest = h('a'); },
    'source session': f => { f.envelope.guestSource.sessionDigest = h('a'); }, 'source policy': f => { f.envelope.guestSource.sourcePolicyDigest = h('a'); },
    'source release': f => { f.envelope.guestSource.releaseHash = h('a'); }, 'draft': f => { f.envelope.guestSource.draftId = 'experience-draft-' + 'a'.repeat(64); },
    'source hash': f => { f.envelope.guestSource.draftHash = h('a'); }, 'prefix': f => { f.envelope.guestSource.sourceEventIds.reverse(); },
    'source after session': f => { f.envelope.guestSource.expiresAtMs = rawSession.expiresAtMs + 1; },
    'current revision': f => { f.envelope.sourceRevision++; }, 'native head regression': f => { f.evidence.native.sourceRevision = rawSource.sourceHead - 1; f.envelope.sourceRevision = rawSource.sourceHead - 1; }, 'native source': f => { f.envelope.sourceDigest = h('a'); },
    'rights': f => { f.envelope.rightsDigest = h('a'); }, 'input': f => { f.envelope.compiledInputDigest = h('a'); },
    'transfer': f => { f.envelope.transferEnvelopeDigest = h('a'); }, 'consumption': f => { f.envelope.consumptionId = 'second-consumption'; },
    'authorize key': f => { f.envelope.intentKey = driver.stageKeys.preflight; }, 'asset': f => { f.envelope.orderedAssetDigests = [h('a')]; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => { const f = fixture(); change(f); await assert.rejects(compile(f), rejected); });
});

test('exact authorization and whole native preflight bind plan, target, original attempt and quote', async t => {
  const changes = {
    'authorization flag': f => { f.evidence.authorization.explicitAuthorization = false; }, 'authorization policy': f => { f.evidence.authorization.policyDigest = h('a'); },
    'authorization session': f => { f.evidence.authorization.sessionDigest = h('a'); }, 'authorization source': f => { f.evidence.authorization.guestSourceDigest = h('a'); },
    'authorization terms': f => { f.evidence.authorization.termsDigest = 'a'.repeat(64); }, 'authorization quote': f => { f.evidence.authorization.preflightId = 'different'; },
    'authorization maximum': f => { f.evidence.authorization.maximumMicrousd++; }, 'authorization digest': f => { f.envelope.guestAuthorizationDigest = h('a'); },
    'native plan': f => { f.evidence.native.preflight.planRevisionId = 'different'; }, 'native target': f => { f.evidence.native.preflight.targets[0].targetId = 'different'; },
    'attempt': f => { f.evidence.native.preflight.operationAttempts[offered.targetId].ordinal = 1; },
    'predecessor': f => { f.evidence.native.preflight.operationAttempts[offered.targetId].previousSlotId = 'prior'; },
    'extra target': f => { f.evidence.native.preflight.targets.push(f.evidence.native.preflight.targets[0]); },
    'requirements': f => { f.evidence.native.preflight.requirementsDigest = 'a'.repeat(64); }, 'quote timestamp': f => { f.evidence.native.preflight.createdAt = new Date(now - 2000).toISOString(); },
    'native terms': f => { f.evidence.native.preflight.termsDigest = 'a'.repeat(64); }, 'extra attempt': f => { f.evidence.native.preflight.operationAttempts.other = { ordinal: 0, previousSlotId: null }; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => { const f = fixture(); change(f); await assert.rejects(compile(f), rejected); });
});

test('text decision metadata rejects rehashed format and value smuggling', async t => {
  const changes = {
    'foreign media nested in image_format': fact => { fact.properties.image_format = { media_url: '/foreign.png' }; },
    'object decision value behind image_format': fact => {
      fact.properties.image_format = structuredClone(template.settings.imageRender.format);
      fact.properties.experience_value = { media_url: '/foreign.png' };
    },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    const f = fixture(), subject = f.evidence.native.contextSnapshot.facts.find(fact => fact.type === 'subject');
    assert.ok(subject); change(subject);
    f.envelope.compiledInputDigest = await digest({ snapshot: f.evidence.native.contextSnapshot, settings: f.evidence.native.preflight.targets[0].settings });
    await assert.rejects(compile(f), /guest_sponsor_binding_mismatch/u);
  });
});

test('internally rehashed snapshots and source-head regressions cannot pass closed first-image grammar', async t => {
  await t.test('head regression with matching rights digest', async () => {
    const f = fixture();
    f.evidence.native.sourceRevision = f.envelope.guestSource.sourceHead - 1;
    f.envelope.sourceRevision = f.evidence.native.sourceRevision;
    f.envelope.rightsDigest = await digest({ domain: 'forma-sponsor-guest-source-rights@1', guestAdmission: f.policy.guestAdmission,
      guestSource: f.envelope.guestSource, sourceRevision: f.evidence.native.sourceRevision, sourceDigest: f.evidence.native.preflight.sourceDigest });
    await assert.rejects(compile(f), /guest_sponsor_binding_mismatch/u);
  });
  const changes = {
    pins: snapshot => { snapshot.pins.push('original-sponsored-output'); },
    canvas: snapshot => { snapshot.canvas = { canvas_id: 'external-canvas' }; },
    groups: snapshot => { snapshot.context_groups.push({ id: 'outside-group' }); },
    tail: snapshot => { snapshot.tail.push('prior-prompt'); },
    relationship: snapshot => { snapshot.relationships.push({ from_block_id: snapshot.facts[0].block_id, to_block_id: 'foreign' }); },
    media: snapshot => { snapshot.facts[0].properties.media_url = '/media/foreign.png'; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    const f = fixture(); change(f.evidence.native.contextSnapshot);
    f.envelope.compiledInputDigest = await digest({ snapshot: f.evidence.native.contextSnapshot, settings: f.evidence.native.preflight.targets[0].settings });
    await assert.rejects(compile(f), /guest_sponsor_binding_mismatch/u);
  });
});

test('actual native transport and settings must match the selected template without provider fallbacks', async t => {
  const changes = {
    'transport': f => { f.evidence.native.transport.image.adapterVersion = 'v6'; }, 'API': f => { f.evidence.native.transport.image.api = 'https://other.invalid'; },
    'model': f => { f.evidence.native.preflight.targets[0].settings.calls[1].model = 'different'; },
    'planning calls': f => { f.envelope.recipe.calls.planning++; }, 'route hash': f => { f.envelope.recipe.routeDigest = h('a'); },
    'settings hash': f => { f.envelope.recipe.settingsDigest = h('a'); }, 'template hash': f => { f.envelope.templateDigest = h('a'); },
    'references': f => { f.evidence.native.preflight.targets[0].settings.payload.references = []; },
    'source image': f => { f.evidence.native.contextSnapshot.facts[0].type = 'reference'; }, 'empty source': f => { f.evidence.native.contextSnapshot.facts = []; },
    'inactive source': f => { f.evidence.native.contextSnapshot.facts[0].active = false; },
    'pins': f => { f.evidence.native.contextSnapshot.pins.push('output'); }, 'canvas': f => { f.evidence.native.contextSnapshot.canvas = {}; },
    'relationship': f => { f.evidence.native.contextSnapshot.relationships.push({}); }, 'media property': f => { f.evidence.native.contextSnapshot.facts[0].properties.media_url = '/private.png'; },
    'unknown snapshot': f => { f.evidence.native.contextSnapshot.extra = []; }, 'foreign document fact': f => { f.evidence.native.contextSnapshot.facts[0].document_id = projectId; },
    'changed text': f => { f.evidence.native.contextSnapshot.facts[0].properties.text = 'A changed source'; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => { const f = fixture(); change(f); await assert.rejects(compile(f), rejected); });
});

test('source retention, session, preflight, grant, campaign and resource deadlines independently cap issuance', async t => {
  for (const [name, change] of Object.entries({
    'original source': f => { f.envelope.guestSource.expiresAtMs = now + 100; },
    'session': f => { f.evidence.sessionBinding.expiresAtMs = now + 100; },
    'preflight': f => { f.evidence.native.preflight.expiresAt = new Date(now + 100).toISOString(); },
    'grant lifetime': f => { f.envelope.expiresAtMs = now + 60001; },
    'campaign': f => { f.envelope.issuedAtMs = rawPolicy.expiresAtMs; f.envelope.expiresAtMs = rawPolicy.expiresAtMs + 1; },
    'resources': f => { f.policy.resources.expiresAtMs = now + 100; },
    'before resources': f => { f.policy.resources.startsAtMs = now + 100; },
    'quote after issue': f => { f.evidence.native.preflight.createdAt = new Date(now + 1).toISOString(); },
    'zero duration': f => { f.envelope.expiresAtMs = f.envelope.issuedAtMs; },
  })) await t.test(name, async () => { const f = fixture(); change(f); await assert.rejects(compile(f), rejected); });
});

test('all asynchronous compilers capture before caller mutation and deeply freeze their results', async () => {
  const f = fixture(), expected = structuredClone(f), pending = compile(f);
  f.policy.payerUserId = 'changed'; f.envelope.guestSource.draftHash = h('a'); f.evidence.native.contextSnapshot.facts[0].properties.text = 'changed';
  const compiled = await pending;
  assert.equal(compiled.envelopeDigest, await digest(expected.envelope)); assert.equal(compiled.policyDigest, await digest(expected.policy));
  assert.deepEqual(compiled.evidence, expected.evidence);
  assert.ok(Object.isFrozen(compiled.evidence.native.preflight.targets[0].settings.calls));
  const sb = structuredClone(rawSession), sp = compileGuestSponsorSessionBinding(sb); sb.sessionTermsDigest = h('f');
  assert.equal((await sp).sessionDigest, session.sessionDigest);
  const sourceCopy = structuredClone(rawSource), sourcePending = compileGuestSponsorSourceBinding(sourceCopy); sourceCopy.sourceEventIds.reverse();
  assert.equal((await sourcePending).guestSourceDigest, source.guestSourceDigest);
  const dc = structuredClone(rawDriver), dp = deriveGuestSponsorDriver(dc); dc.campaignId = 'changed'; assert.equal((await dp).commandDigest, driver.commandDigest);
});

test('accessors, prototypes, sparse arrays, symbols and non-finite values fail without invocation', async () => {
  let reads = 0;
  const accessor = structuredClone(rawPolicy); Object.defineProperty(accessor, 'templates', { enumerable: true, get() { reads++; throw Error('getter invoked'); } });
  assert.throws(() => readGuestSponsorPolicy(accessor), rejected); assert.equal(reads, 0);
  const symbol = structuredClone(rawPolicy); symbol[Symbol('authority')] = true; assert.throws(() => readGuestSponsorPolicy(symbol), rejected);
  assert.throws(() => readGuestSponsorPolicy(Object.assign(Object.create({ approved: true }), rawPolicy)), rejected);
  const f = fixture(); delete f.evidence.native.preflight.targets[0]; await assert.rejects(compile(f), rejected);
  const nan = fixture(); nan.envelope.issuedAtMs = NaN; await assert.rejects(compile(nan), rejected);
  const wide = fixture(); wide.evidence.native.contextSnapshot.facts[0].properties.text = 'x'.repeat(8193); await assert.rejects(compile(wide), rejected);
});
