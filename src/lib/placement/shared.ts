import type { PlacementMode, PlacementSessionStatus, PlacementStateMachine } from "./types";

export const IRT_PLACEMENT_STATE_MACHINE: PlacementStateMachine = {
  started: ["started", "completed", "cancelled"],
  completed: ["completed"],
  cancelled: ["cancelled"],
};

export const EXTENDED_PLACEMENT_STATE_MACHINE: PlacementStateMachine = {
  started: ["started", "completed", "cancelled"],
  completed: ["completed"],
  cancelled: ["cancelled"],
};

export function getPlacementStateMachine(mode: PlacementMode): PlacementStateMachine {
  return mode === "placement_extended" ? EXTENDED_PLACEMENT_STATE_MACHINE : IRT_PLACEMENT_STATE_MACHINE;
}

export function canTransitionPlacementStatus(
  mode: PlacementMode,
  from: PlacementSessionStatus,
  to: PlacementSessionStatus
): boolean {
  const allowed = getPlacementStateMachine(mode)[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function isPlacementSessionActive(status: PlacementSessionStatus): boolean {
  return status === "started";
}
