import { createHash } from "node:crypto";
import { GseRawNode } from "./types";

export function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export function stableHash(input: string) {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

export function buildStableNodeId(node: Pick<GseRawNode, "catalog" | "type" | "sourceKey" | "descriptor">) {
  const source = normalizeToken(node.sourceKey || node.descriptor) || stableHash(node.descriptor);
  return `gse:${normalizeToken(node.catalog)}:${normalizeToken(node.type)}:${source}`;
}

export function dedupeKey(node: GseRawNode) {
  const descriptorKey = normalizeToken(node.descriptor).slice(0, 80);
  const sourceKey = normalizeToken(node.sourceKey || node.descriptor);
  const min = typeof node.gseMin === "number" ? String(node.gseMin) : "";
  const max = typeof node.gseMax === "number" ? String(node.gseMax) : "";
  return [node.type, sourceKey, descriptorKey, min, max].join("|");
}

export function toGseCenter(min: number | null | undefined, max: number | null | undefined) {
  if (typeof min === "number" && typeof max === "number") {
    return Number(((min + max) / 2).toFixed(2));
  }
  if (typeof min === "number") return min;
  if (typeof max === "number") return max;
  return null;
}

export function mapStageToGseRange(stage: string) {
  if (stage === "A0") return { min: 10, max: 21 };
  if (stage === "A1") return { min: 22, max: 29 };
  if (stage === "A2") return { min: 30, max: 42 };
  if (stage === "B1") return { min: 43, max: 58 };
  if (stage === "B2") return { min: 59, max: 75 };
  if (stage === "C1") return { min: 76, max: 84 };
  return { min: 85, max: 90 };
}

export function confidenceFromReliability(reliability: string | undefined) {
  if (reliability === "high") return 0.9;
  if (reliability === "medium") return 0.7;
  return 0.5;
}

