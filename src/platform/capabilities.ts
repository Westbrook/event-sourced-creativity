/** Server-issued authorities. A role label or visible link never grants a capability. */
export const FORMA_CAPABILITIES = [
  "self.profile.read", "self.privacy.manage", "self.usage.read", "self.share.manage",
  "project.read", "project.author", "project.library.manage", "project.canvas.use", "project.output.request",
  "workspace.member.read", "workspace.member.manage", "workspace.project.read", "workspace.project.manage",
  "workspace.policy.manage", "workspace.budget.manage", "workspace.usage.read", "workspace.audit.read",
  "platform.identity.manage", "platform.policy.manage", "platform.provider.configure", "platform.provider.activate",
  "platform.release.approve", "platform.audit.read", "platform.incident.manage",
  "product.analytics.read", "product.delivery.read", "product.delivery.manage", "product.release.read",
  "evaluation.synthetic.read", "evaluation.synthetic.run", "evaluation.qualification.read", "evaluation.qualification.run",
  "evaluation.actual.request", "evaluation.actual.approve", "evaluation.actual.run",
  "design.catalog.read", "design.docs.read",
  "engineering.diagnostics.read", "engineering.events.read", "engineering.sync.read", "engineering.provider.debug",
] as const;

export type FormaCapability = typeof FORMA_CAPABILITIES[number];
export type CapabilityScope = "self" | "project" | "workspace" | "platform" | "synthetic";

export type ScopedCapability = {
  capability: FormaCapability;
  scope: CapabilityScope;
  organizationId: string | null;
  projectAccessId: string | null;
  expiresAt: string | null;
};

export const SELF_CAPABILITIES = [
  "self.profile.read", "self.privacy.manage", "self.usage.read", "self.share.manage",
] as const satisfies readonly FormaCapability[];

export const CREATOR_CAPABILITIES = [
  ...SELF_CAPABILITIES, "project.read", "project.author", "project.library.manage", "project.output.request",
] as const satisfies readonly FormaCapability[];

export const PLATFORM_ADMIN_CAPABILITIES = [
  "platform.identity.manage", "platform.policy.manage", "platform.provider.configure", "platform.provider.activate",
  "platform.release.approve", "platform.audit.read", "platform.incident.manage",
  "product.analytics.read", "product.delivery.read", "product.delivery.manage", "product.release.read",
  "evaluation.synthetic.read", "evaluation.synthetic.run", "evaluation.qualification.read", "evaluation.qualification.run",
  "evaluation.actual.request", "evaluation.actual.approve", "evaluation.actual.run",
  "design.catalog.read", "design.docs.read",
  "engineering.diagnostics.read", "engineering.events.read", "engineering.sync.read", "engineering.provider.debug",
] as const satisfies readonly FormaCapability[];

export const WORKSPACE_OWNER_CAPABILITIES = [
  "workspace.member.read", "workspace.member.manage", "workspace.project.read", "workspace.project.manage",
  "workspace.policy.manage", "workspace.budget.manage", "workspace.usage.read", "workspace.audit.read",
] as const satisfies readonly FormaCapability[];

const allowedCapabilities = new Set<string>(FORMA_CAPABILITIES);
export function isFormaCapability(value: unknown): value is FormaCapability {
  return typeof value === "string" && allowedCapabilities.has(value);
}

export function capabilityScopeFor(capability: FormaCapability): CapabilityScope {
  if (capability.startsWith("self.")) return "self";
  if (capability.startsWith("project.")) return "project";
  if (capability.startsWith("workspace.")) return "workspace";
  if (capability.startsWith("evaluation.synthetic.") || capability.startsWith("design.")) return "synthetic";
  return "platform";
}
