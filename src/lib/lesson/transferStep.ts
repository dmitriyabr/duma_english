const TRANSFER_MAP: Record<string, string[]> = {
  qa_prompt: ["role_play", "misunderstanding_repair"],
  role_play: ["qa_prompt", "topic_talk"],
  misunderstanding_repair: ["qa_prompt", "role_play"],
  topic_talk: ["role_play", "qa_prompt"],
  speech_builder: ["role_play", "qa_prompt"],
  writing_prompt: ["qa_prompt", "role_play"],
};

export function pickTransferTaskType(primaryTaskType: string, stage: string) {
  const fallbacks = TRANSFER_MAP[primaryTaskType] || ["role_play", "qa_prompt"];
  const filtered =
    stage === "C1" || stage === "C2"
      ? fallbacks
      : fallbacks.filter((taskType) => taskType !== "misunderstanding_repair");

  return filtered[0] || "role_play";
}

export function buildTransferMeta(params: {
  fromTaskType: string;
  toTaskType: string;
  reason: string;
}) {
  return {
    transferFromTaskType: params.fromTaskType,
    transferToTaskType: params.toTaskType,
    transferReason: params.reason,
    contextShiftRequired: true,
    cardTitle: "Now in a new context",
  };
}
