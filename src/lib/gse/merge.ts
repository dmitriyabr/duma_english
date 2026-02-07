import { GseRawNode } from "./types";
import { dedupeKey, toGseCenter } from "./utils";

function priorityForSource(source: GseRawNode["source"]) {
  if (source === "official") return 3;
  if (source === "github_derived") return 2;
  return 1;
}

export function mergeAndDedupeNodes(nodes: GseRawNode[]) {
  const byKey = new Map<string, GseRawNode>();
  for (const candidate of nodes) {
    const key = dedupeKey(candidate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    const existingPriority = priorityForSource(existing.source);
    const nextPriority = priorityForSource(candidate.source);
    if (nextPriority >= existingPriority) {
      byKey.set(key, {
        ...candidate,
        metadata: {
          ...(existing.metadata || {}),
          ...(candidate.metadata || {}),
        },
      });
    }
  }

  return Array.from(byKey.values()).map((node) => ({
    ...node,
    gseCenter: toGseCenter(node.gseMin ?? null, node.gseMax ?? null),
  }));
}

