import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCreativeVideo } from "../worker/openai-adapter.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";

const approval = process.argv[2];
const originalOnly = approval === "--approve-original-eight-second-video";
if (!originalOnly && approval !== "--approve-three-silent-persona-videos") {
  throw new Error("Explicit approval is required before submitting the original video or three evenly budgeted audience videos.");
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const seconds = 8;
const resolution = "720p";
const model = VIDEO_ADAPTER_CONTRACT.model;
const costPerProject = seconds * VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[resolution];

const projects = originalOnly ? [{
  profile: "generic",
  prefix: "quiet-coast",
  title: "The Quiet Coast",
  image: "quiet-coast-landscape-1200.5b0da5971e72.webp",
  continuity: "One empty slate-blue coastline just after sunset; one weathered slate-stone cottage; exactly one restrained amber-lit window; one empty curving coastal path; a faint pale crescent and distant silver tide.",
  camera: "An exceptionally slow, steady cinematic forward drift down the original empty coastal path.",
  action: "The distant silver tide moves gently, the single amber window glows steadily, and quiet grasses shift in the coastal air.",
  prompt: "Use @Image1 as the exact opening frame and sole visual continuity authority. Create one continuous restrained cinematic coastal shot just after sunset in the same indigo blue hour. Preserve the same single weathered slate-stone cottage with exactly one soft amber-lit window, the same empty curved footpath, the same distant slate-blue water, the subtle pale crescent high in the sky, and the single gentle silver line of tide. The camera drifts almost imperceptibly forward while the water moves quietly and a few coastal grasses stir. Maintain the exact original geography, quiet color palette, restrained amber window, empty shoreline, and single-cottage composition throughout. Keep the coastline naturally unoccupied and unlettered, without people, crowds, boats, extra buildings, luxury decoration, a bright full moon, or daylight.",
}] : [
  {
    profile: "hollywood-filmmakers",
    prefix: "glass-meridian",
    title: "The Glass Meridian",
    image: "glass-meridian-landscape-1200.c0f86b61d07d.webp",
    continuity: "Observatory east and high screen-right; one red cable car west and high screen-left; one adult climber with silver foil on her anatomical left forearm and a scarlet case in her anatomical right hand.",
    camera: "An almost imperceptible stable forward camera drift.",
    action: "Fine snow drifts, the single red cable car sways slightly, and the adult climber’s coat edge moves naturally.",
    prompt: "Use @Image1 as the exact opening frame and sole visual continuity authority. Create one continuous cinematic shot at violet predawn in Calder Basin. Keep the circular concrete observatory high on screen-right to the east, exactly one signal-red cable car on screen-left to the west, and glacier-cyan ice below. The solitary fictional adult Rhea keeps her charcoal parka and cobalt harness, with silver foil around her anatomical LEFT forearm and the red instrument case in her anatomical RIGHT hand. Preserve the identical geography, composition, character, clothing, and hand assignment throughout. Use an almost imperceptible slow camera push while fine snow drifts, the cable car sways slightly, and her coat edge moves. Maintain one adult person, one gondola, correct hands, violet predawn, and an unlettered frame throughout.",
  },
  {
    profile: "marketers",
    prefix: "brighter-hour",
    title: "The Brighter Hour",
    image: "brighter-hour-landscape-1200.0e12ab79f12e.webp",
    continuity: "Exactly one clear amber-filled unlabelled bottle with an aubergine cap and vermilion neck band; one faceted glass; one blood-orange crescent; cobalt plinth; warm diagonal late-afternoon light.",
    camera: "A slow, stable, elegant editorial push toward the original bottle.",
    action: "A delicate natural highlight travels through the amber glass while the original long diagonal shadow drifts subtly.",
    prompt: "Use @Image1 as the exact first frame and immutable zero-proof product reference. Create one continuous premium editorial product-campaign shot in the same warm city loft. Preserve exactly one tall clear amber-filled bottle with the identical unlabelled silhouette, aubergine cap, and narrow vermilion neck band; one faceted clear tumbler; one blood-orange crescent; the cobalt plinth; and the warm apricot wall. Late-afternoon diagonal light moves gently across the original composition while a restrained highlight passes through the amber glass. The camera makes an extremely slow, stable push without changing the camera axis. Maintain the original bottle count, product geometry, cap, ring, orange placement, warm shadow, clean unlettered glass, and people-free scene throughout.",
  },
  {
    profile: "indie-filmmakers",
    prefix: "mercer-midnight",
    title: "The Last Light on Mercer",
    image: "mercer-midnight-landscape-1200.e8e494c3d28c.webp",
    continuity: "One fictional adult woman named June; oxblood work jacket; brass key on a faded red cord; clear unlabeled cassette; one rainy neighborhood laundromat; third chrome dryer; cyan fluorescents and restrained amber practical light.",
    camera: "A slow, stable, almost imperceptible push inside the original laundromat.",
    action: "June gently turns the same clear unlabeled cassette once while rain moves down the original front window.",
    prompt: "Create one continuous restrained cinematic shot from @Image1, remaining entirely inside the same compact neighborhood laundromat at midnight. June remains the sole fictional adult person on screen with the same shoulder-length dark hair, oxblood work jacket, charcoal shirt, and brass key on a faded red cord. She gently turns the same clear unlabeled cassette in her hands beside the third chrome dryer. Rain beads move down the same front window while restrained amber practical light shimmers against the cold cyan fluorescent overheads. Make a slow, stable, almost imperceptible forward camera drift while preserving the identical architecture, dryer order, single adult performer, jacket, key, red cord, cassette, color palette, and single-room composition throughout.",
  },
];

const expectedProjects = originalOnly ? 1 : 3;
if (projects.length !== expectedProjects || new Set(projects.map(({ profile }) => profile)).size !== expectedProjects) {
  throw new Error("Only the explicitly approved original scene or three equally priced audience scenes may be generated.");
}

const sessionResponse = await fetch("http://localhost:5173/api/session");
if (!sessionResponse.ok) throw new Error("The current user/workspace generation budget could not be verified.");
const session = await sessionResponse.json();
const remaining = Math.min(
  Number(session.costBudgets?.user?.remainingMicrousd ?? NaN),
  Number(session.costBudgets?.workspace?.remainingMicrousd ?? NaN),
);
const maximum = projects.length * costPerProject;
if (!session.provider?.videoConfigured || !Number.isFinite(remaining) || remaining < maximum) {
  throw new Error("The configured account cannot safely support three equal, approved video generations.");
}

const rawEnvironment = await readFile(join(root, ".env.local"), "utf8");
const credentialLine = rawEnvironment.split(/\r?\n/).find((line) => line.trim().startsWith("FAL_KEY="));
if (!credentialLine) throw new Error("The configured video-provider credential is missing.");
let credential = credentialLine.slice(credentialLine.indexOf("=") + 1).trim();
if ((credential.startsWith('"') && credential.endsWith('"')) || (credential.startsWith("'") && credential.endsWith("'"))) {
  credential = credential.slice(1, -1);
}
if (!credential) throw new Error("The configured video-provider credential is empty.");

const run = new Date().toISOString().replaceAll(/[:.]/g, "-");
const outputRoot = join(root, "outputs", "marketing-persona-videos", run);
await mkdir(outputRoot, { recursive: true });
process.stdout.write(`BUDGET ${JSON.stringify({ projects: projects.length, resolution, seconds, eachMicrousd: costPerProject, totalMicrousd: maximum, accountRemainingMicrousd: remaining })}\n`);

async function generate(project) {
  const projectDirectory = join(outputRoot, project.prefix);
  await mkdir(projectDirectory, { recursive: true });
  const bytes = new Uint8Array(await readFile(join(root, "public/assets/marketing", project.image)));
  const report = {
    schemaVersion: 1,
    profile: project.profile,
    project: project.title,
    status: "running",
    authorization: { requestCount: 1, seconds, resolution, maximumCostMicrousd: costPerProject, silent: true },
    input: { filename: project.image, mimeType: "image/webp", sha256: createHash("sha256").update(bytes).digest("hex") },
    stages: [],
  };
  const save = () => writeFile(join(projectDirectory, "report.json"), JSON.stringify(report, null, 2));
  await save();

  try {
    const result = await generateCreativeVideo(
      { FAL_KEY: credential, FORMA_VIDEO_PROVIDER: "fal", FAL_REFERENCE_VIDEO_MODEL: model },
      project.prompt,
      {
        seconds,
        size: "1280x720",
        resolution,
        audioMode: "silent",
        generateAudio: false,
        referencePromptProfile: "positive-only",
        providerModel: model,
        endUserId: `forma-marketing-${project.profile}`,
        plan: { title: project.title, summary: project.continuity },
        references: [{
          bytes,
          mimeType: "image/webp",
          blockId: `marketing-${project.prefix}-landscape`,
          referenceId: `${project.prefix}-original-owned-landscape`,
          label: `Original generated ${project.title} landscape study`,
          mode: "preserve_composition",
          sequence: null,
          shotDirection: project.action,
          cameraDirection: project.camera,
          framePrompt: project.continuity,
          sourceArtifactId: null,
          sourceArtifactItemId: null,
          sourceArtifactKind: null,
          storyboardTitle: "",
          provider: "generated",
          providerModel: null,
          providerRequestId: null,
          providerMediaUrl: null,
        }],
        onStage: async (stage, message) => {
          report.stages.push({ at: new Date().toISOString(), stage, message });
          process.stdout.write(`PROGRESS ${project.prefix} ${stage}\n`);
          await save();
        },
        onPrepared: async (prepared) => {
          report.prepared = prepared;
          await save();
        },
        onReceipt: async (receipt) => {
          report.receipt = receipt;
          await save();
          process.stdout.write(`ACCEPTED ${project.prefix}\n`);
        },
      },
    );
    if (result.costMicrousd > costPerProject || result.providerParameters.generate_audio !== false) {
      throw new Error("The provider returned a scene outside its approved per-audience cost or audio policy.");
    }
    await writeFile(join(projectDirectory, "original.mp4"), result.bytes);
    Object.assign(report, {
      status: "completed",
      result: {
        model: result.model,
        mimeType: result.mimeType,
        seconds: result.seconds,
        size: result.size,
        byteLength: result.bytes.length,
        costMicrousd: result.costMicrousd,
        latencyMs: result.latencyMs,
      },
    });
    await save();
    process.stdout.write(`COMPLETED ${project.prefix} ${result.costMicrousd}\n`);
    return { profile: project.profile, prefix: project.prefix, file: join(projectDirectory, "original.mp4"), costMicrousd: result.costMicrousd };
  } catch (error) {
    report.status = "failed";
    report.failure = {
      message: String(error?.message ?? error),
      code: error?.detail?.code ?? null,
      providerJobId: error?.detail?.requestId ?? report.receipt?.providerJobId ?? null,
    };
    await save();
    process.stdout.write(`FAILED ${project.prefix} ${report.failure.code ?? "unknown"}\n`);
    throw error;
  }
}

const outcomes = await Promise.allSettled(projects.map(generate));
const summary = {
  outputRoot,
  outcomes: outcomes.map((outcome, index) => outcome.status === "fulfilled"
    ? { status: "completed", ...outcome.value }
    : { status: "failed", profile: projects[index].profile, error: String(outcome.reason?.message ?? outcome.reason) }),
};
process.stdout.write(`RESULT ${JSON.stringify(summary)}\n`);
if (outcomes.some((outcome) => outcome.status === "rejected")) process.exitCode = 1;
