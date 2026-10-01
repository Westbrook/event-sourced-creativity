import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readLocalMigrations, migrateLocalDatabase } from "../../scripts/lib/local-migrations.mjs";

const hash = text => "sha256:" + createHash("sha256").update(text).digest("hex");
const file = (path, content) => ({ path, bytes: Buffer.byteLength(content), sha256: hash(content) });
const clone = value => structuredClone(value);

// Reuse the existing synthetic, code-owned registration builders. Dependencies
// come from the caller's established actual-module loader; importing this helper
// does not install a resolver, load a Worker, capture sources, or register tests.
// These fixtures do not certify a build, production evaluation, or browser.
export function createExperienceMaintenanceBuilders({ compileExperience, digest, freeze, definitions, fixtureCatalog,
  captureMaintenanceObservation, readExperienceMaintenanceCaptureProfile, captureExperienceMaintenanceInventory }) {
async function material(revision = 1, changeCatalog = () => {}) {
  const catalog = clone(fixtureCatalog), definition = clone(definitions.find(item => item.id === "scene"));
  changeCatalog(catalog);
  definition.revision = revision;
  const compiled = await compileExperience(definition, catalog);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  const sourceManifest = {
    schemaVersion: 1, compiler: "forma-experience-compiler@1", catalog: "forma-experience-fixture@1",
    catalogHash: await digest(catalog),
    files: [file("src/experiences/compiler.ts", await readFile(new URL("../../src/experiences/compiler.ts", import.meta.url))),
      file("src/experiences/catalog.ts", await readFile(new URL("../../src/experiences/catalog.ts", import.meta.url)))],
  };
  const sourceHash = await digest(sourceManifest), releaseHash = compiled.release.releaseHash;
  const buildManifest = { schemaVersion: 1, releaseHash, sourceHash,
    files: [file("fixture/compiled-release.json", JSON.stringify(compiled.release))], entrypoints: ["fixture/compiled-release.json"] };
  const buildHash = await digest(buildManifest), reports = [file("fixture/case-evidence.json", JSON.stringify({ fixture: true, revision }))];
  const evaluationReport = { schemaVersion: 1, qualification: "fixture", channel: "managed-fixture", generationAvailable: false,
    releaseHash, sourceHash, buildHash, outcome: "passed", caseCount: 1, reports, reportHash: await digest(reports) };
  const registration = freeze({ schemaVersion: 1, channel: "managed-fixture", catalog, definition, sourceManifest, buildManifest, evaluationReport });
  const selection = freeze({ releaseHash, sourceHash, buildHash, evaluationHash: await digest(evaluationReport) });
  return { registration, selection, compiled: compiled.release };
}

let maintenanceObservation;
async function maintenanceFixture(revision = 1) {
  maintenanceObservation ??= captureMaintenanceObservation();
  const observed = await maintenanceObservation, source = await material(revision), registration = clone(source.registration);
  registration.definition = clone(definitions.find(item => item.id === "model3d"));
  registration.definition.revision = revision;
  const compiled = await compileExperience(registration.definition, registration.catalog);
  assert.equal(compiled.ok, true);
  const releaseHash = compiled.release.releaseHash, sourceHash = source.selection.sourceHash;
  registration.buildManifest = { schemaVersion: 1, releaseHash, sourceHash,
    files: [file("fixture/compiled-release.json", JSON.stringify(compiled.release))], entrypoints: ["fixture/compiled-release.json"] };
  const buildHash = await digest(registration.buildManifest);
  const reports = [file("fixture/maintenance-registration.json", JSON.stringify({ syntheticFixture: true, output: "model3d", revision }))];
  registration.evaluationReport = { schemaVersion: 1, qualification: "fixture", channel: "managed-fixture", generationAvailable: false,
    releaseHash, sourceHash, buildHash, outcome: "passed", caseCount: 1, reports, reportHash: await digest(reports) };
  const selection = { releaseHash, sourceHash, buildHash, evaluationHash: await digest(registration.evaluationReport) };
  const pair = { version: 1, base: clone(selection), baseline: clone(observed), current: clone(observed) };
  const request = { version: 1, base: clone(selection), baselineObservationHash: observed.observationHash, currentObservationHash: observed.observationHash,
    patch: { schemaVersion: 1, baseReleaseHash: releaseHash, operations: [{ kind: "set-layout", layout: "stacked-stage" }] } };
  return { registration, selection, pair, request, compiled: compiled.release };
}

async function adoptionMaterial({ baseline, current, expectedAdoption, history = [], scope = expectedAdoption ? "replacement" : "initial" } = {}) {
  const m = await maintenanceFixture();
  m.pair.baseline = clone(baseline ?? m.pair.baseline);
  m.pair.current = clone(current ?? m.pair.current);
  const existing = new Set(m.registration.sourceManifest.files.map(entry => entry.path));
  for (const source of m.pair.current.sources) if (!existing.has(source.path))
    m.registration.sourceManifest.files.push({ path: source.path, bytes: source.bytes, sha256: source.hash });
  const sourceHash = await digest(m.registration.sourceManifest);
  m.registration.buildManifest.sourceHash = sourceHash;
  const buildHash = await digest(m.registration.buildManifest);
  m.registration.evaluationReport.sourceHash = sourceHash;
  m.registration.evaluationReport.buildHash = buildHash;
  m.selection = { releaseHash: m.compiled.releaseHash, sourceHash, buildHash, evaluationHash: await digest(m.registration.evaluationReport) };
  m.pair.base = clone(m.selection);
  const profile = await readExperienceMaintenanceCaptureProfile("model3d.code-declarations@1");
  assert.ok(profile);
  const inventory = await captureExperienceMaintenanceInventory();
  const capture = (observation, side) => ({ observationHash: observation.observationHash, sources: clone(observation.sources),
    reports: [file(`fixture/maintenance-adoption-${side}.json`, JSON.stringify({ syntheticFixture: true, observation }))] });
  const body = { version: 1, scope, experienceId: "model3d", material: clone(m.selection),
    reviewed: { baselineObservationHash: m.pair.baseline.observationHash, currentObservationHash: m.pair.current.observationHash },
    profile: { ref: "model3d.code-declarations@1", hash: profile.profileHash }, inventoryHash: inventory.inventoryHash,
    captures: { baseline: capture(m.pair.baseline, "baseline"), current: capture(m.pair.current, "current") },
    compatibilityReports: m.pair.baseline.observationHash === m.pair.current.observationHash ? []
      : [file("fixture/maintenance-adoption-compatibility.json", JSON.stringify({ syntheticFixture: true,
        baseline: m.pair.baseline.observationHash, current: m.pair.current.observationHash }))] };
  const eligibility = { ...body, eligibilityHash: await digest(body) };
  m.adoptionRegistration = { version: 1, base: clone(m.selection), baseline: clone(m.pair.baseline), current: clone(m.pair.current), inventory, eligibility };
  m.adoptionBinding = { version: 1, operation: "adopt-baseline", channel: "managed-fixture", experienceId: "model3d", material: clone(m.selection),
    target: { observationHash: m.pair.current.observationHash, profileRef: profile.profile.id, profileHash: profile.profileHash, inventoryHash: inventory.inventoryHash },
    reviewed: clone(body.reviewed), eligibilityHash: eligibility.eligibilityHash,
    expectedAdoption: clone(expectedAdoption ?? { revision: 0, eventId: null, baselineObservationHash: null, profileRef: null, profileHash: null }) };
  m.adoptionRegistrations = [...history, m.adoptionRegistration];
  return m;
}
  return { material, maintenanceFixture, adoptionMaterial };
}

export function applyMaintenanceAdoptionMigration(h, { releaseMigration, migrationDirectory }) {
  const migration = readLocalMigrations(migrationDirectory).find(entry => entry.tag === "0030_experience_maintenance_adoption");
  assert.ok(migration, "the owner-generated maintenance-adoption migration must be present");
  const migrated = migrateLocalDatabase(h.sqlite, { migrations: [releaseMigration, migration] }).migrations;
  assert.deepEqual(migrated.map(({ tag, status }) => ({ tag, status })), [
    { tag: releaseMigration.tag, status: "already-applied" },
    { tag: migration.tag, status: "applied" },
  ]);
  return h;
}

// Opt-in domain-handler transport for the existing whole-Product native port.
// The scene fixture first loads the real Worker through its established loader.
// No outer-router, native-browser, layout, or provider qualification is implied.
export async function createMaintenanceOperatorWorkerFixture() {
  const { createSceneCostFixture } = await import("./scene-cost-fixture.mjs");
  const h = await createSceneCostFixture(1), financial = h.counts();
  try {
    const [{ compileExperience, digest, freeze }, { definitions, fixtureCatalog },
      { captureExperienceContractObservation: captureMaintenanceObservation },
      { readExperienceMaintenanceCaptureProfile }, { captureExperienceMaintenanceInventory },
      { handleExperienceReleases, handleExperienceMaintenanceDeliveryTransition }, { requireCapability }] = await Promise.all([
      import("../../src/experiences/compiler.ts"), import("../../src/experiences/catalog.ts"),
      import("../../scripts/capture-experience-contract-observation.mjs"),
      import("../../src/experiences/maintenance-inventory.ts"), import("../../scripts/capture-experience-maintenance-inventory.mjs"),
      import("../../worker/experience-release-api.ts"), import("../../worker/pilot-policy.ts"),
    ]);
    const migrationDirectory = process.env.FORMA_MIGRATION_TEST_DIRECTORY ?? new URL("../../drizzle/", import.meta.url);
    const releaseMigration = readLocalMigrations(migrationDirectory).find(entry => entry.tag === "0023_experience_release_heads");
    assert.ok(releaseMigration, "the managed-release migration must be present");
    assert.equal(migrateLocalDatabase(h.sqlite, { migrations: [releaseMigration] }).migrations[0].status, "applied");
    applyMaintenanceAdoptionMigration(h, { releaseMigration, migrationDirectory });
    const { adoptionMaterial } = createExperienceMaintenanceBuilders({ compileExperience, digest, freeze, definitions, fixtureCatalog,
      captureMaintenanceObservation, readExperienceMaintenanceCaptureProfile, captureExperienceMaintenanceInventory });
    const maintenanceMaterial = await adoptionMaterial();
    const reviewerId = "maintenance-native-reviewer-" + crypto.randomUUID();
    const reviewer = { "oai-authenticated-user-id": reviewerId, "oai-authenticated-user-email": reviewerId + "@example.test" };
    assert.equal((await h.request("/api/session?audience=product", { headers: reviewer })).status, 403);
    const now = new Date().toISOString();
    const insert = h.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at,revoked_at) VALUES(?,?,?,'platform',NULL,NULL,NULL,'active',?,?,?,NULL,NULL)");
    for (const capability of ["product.delivery.manage", "platform.release.approve"])
      insert.run(crypto.randomUUID(), reviewerId, capability, h.owner, now, now);
    const requestOriginal = h.request, base = "/api/portfolio/product/experiences", product = "/api/portfolio/product/delivery";
    h.request = async (route, init = {}) => {
      const url = new URL(route, "http://localhost"), method = init.method ?? "GET";
      if (url.pathname.startsWith(base + "/")) {
        const suffix = url.pathname.slice(base.length + 1), segments = suffix.split("/").map(decodeURIComponent);
        const admitted = method === "GET" && (["materials", "materials/detail", "materials/maintenance", "heads/model3d", "maintenance/adoption-nominations"].includes(suffix)
          || /^maintenance\/adoption-decisions\/experience-maintenance%3Av1%3A[0-9a-f-]+$/iu.test(suffix)
          || /^maintenance\/adoption-operations\/(maintenance-proposal|maintenance-transition|maintenance-adoption)\/[0-9a-f-]+$/u.test(suffix))
          || method === "POST" && ["preview", "maintenance/preview", "maintenance/adoption-proposals", "maintenance/adoptions"].includes(suffix);
        assert.ok(admitted, "only the exact opt-in maintenance operator service routes are transported");
        return handleExperienceReleases(new Request(url, init), h.env, segments,
          [maintenanceMaterial.registration], [maintenanceMaterial.pair], maintenanceMaterial.adoptionRegistrations);
      }
      if (url.pathname === product && method === "PATCH") {
        const body = JSON.parse(String(init.body));
        if (typeof body.decisionId === "string" && body.decisionId.startsWith("experience-maintenance:")) {
          const request = new Request(url, init), auth = await requireCapability(request, h.env, "product.delivery.manage");
          if (auth.response) return auth.response;
          assert.ok(auth.user);
          return handleExperienceMaintenanceDeliveryTransition(request, h.env, auth.user, body,
            [maintenanceMaterial.registration], maintenanceMaterial.adoptionRegistrations);
        }
      }
      return requestOriginal(route, init);
    };
    const close = h.close;
    h.close = () => { try { assert.deepEqual(h.counts(), financial, "operator governance performs no job or cost-budget action"); } finally { close(); } };
    return Object.assign(h, { maintenanceMaterial, reviewer });
  } catch (error) { h.close(); throw error; }
}
