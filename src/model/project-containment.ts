/** Containment supplies relevance only. Each returned scope needs its own access proof. */
export const PROJECT_CONTAINMENT_LIMIT = 256;
export const PROJECT_CONTAINMENT_DEPTH = 16;
export type ProjectContainmentNode = { id: string; parentId: string | null; organizationId: string | null };
export type ProjectContainmentView = {
  version: "project-containment-v1"; projectId: string; revision: string;
  ancestors: string[]; ancestryComplete: boolean; parentId: string | null;
  candidates: string[]; canReparent: boolean; accessInherited: false;
};
export const projectContainmentId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && value.isWellFormed() && value.trim() === value && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

/** Validate the whole bounded forest, including descendant depth after a move. */
export function projectContainmentForest(input: readonly ProjectContainmentNode[]): ReadonlyMap<string, Readonly<ProjectContainmentNode>> | null {
  if (!Array.isArray(input) || input.length > PROJECT_CONTAINMENT_LIMIT) return null;
  const nodes = new Map<string, Readonly<ProjectContainmentNode>>();
  for (const item of input) {
    if (!item || !projectContainmentId(item.id) || item.parentId !== null && !projectContainmentId(item.parentId)
      || item.organizationId !== null && !projectContainmentId(item.organizationId) || nodes.has(item.id)) return null;
    nodes.set(item.id, Object.freeze({ ...item }));
  }
  for (const node of nodes.values()) {
    const visited = new Set<string>(); let current: Readonly<ProjectContainmentNode> | undefined = node;
    while (current) {
      if (visited.has(current.id) || visited.size >= PROJECT_CONTAINMENT_DEPTH || current.organizationId !== node.organizationId) return null;
      visited.add(current.id);
      if (current.parentId === null) break;
      current = nodes.get(current.parentId); if (!current) return null;
    }
  }
  return nodes;
}

export function reparentProjectForest(nodes: readonly ProjectContainmentNode[], projectId: string, parentId: string | null) {
  if (!projectContainmentForest(nodes) || !nodes.some(node => node.id === projectId)) return null;
  return projectContainmentForest(nodes.map(node => node.id === projectId ? { ...node, parentId } : node));
}

/** Stop before the first independently inaccessible parent; never disclose its ID. */
export function visibleProjectAncestors(nodes: ReadonlyMap<string, Readonly<ProjectContainmentNode>>, projectId: string,
  readable: ReadonlySet<string>): { ancestors: string[]; ancestryComplete: boolean } | null {
  if (!readable.has(projectId) || !nodes.has(projectId)) return null;
  const ancestors: string[] = []; let current = nodes.get(projectId)!;
  while (current.parentId !== null) {
    if (!readable.has(current.parentId)) return { ancestors, ancestryComplete: false };
    current = nodes.get(current.parentId)!; ancestors.push(current.id);
  }
  return { ancestors, ancestryComplete: true };
}
