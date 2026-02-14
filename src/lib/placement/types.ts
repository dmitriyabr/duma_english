export type PlacementMode = "irt" | "placement_extended";

export type PlacementSessionStatus = "started" | "completed" | "cancelled";

export type PlacementStateMachine = Record<PlacementSessionStatus, PlacementSessionStatus[]>;

export type { PlacementAnswerInput, PlacementItemView } from "../placement";
