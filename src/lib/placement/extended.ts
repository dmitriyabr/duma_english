import { prisma } from "@/lib/db";

export {
  applyPlacementDownwardCredit,
  startPlacementExtended,
  submitPlacementExtendedAnswer,
} from "../placement";

export async function resetPlacementExtendedSessions(studentId: string) {
  const result = await prisma.placementSession.updateMany({
    where: {
      studentId,
      placementMode: "placement_extended",
      status: "started",
    },
    data: { status: "cancelled" },
  });

  return { cancelledCount: result.count };
}
