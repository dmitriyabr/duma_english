import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import {
  placementAnswerResponseSchema,
  placementExtendedResetResponseSchema,
  placementExtendedStartResponseSchema,
  placementExtendedSubmitResponseSchema,
  placementFinishResponseSchema,
  placementStartResponseSchema,
} from "./contracts/apiResponseSchemas";
import { resetPlacementExtendedSessions, startPlacementExtended, submitPlacementExtendedAnswer } from "./placement/extended";
import { finishPlacement, getPlacementSession, startPlacement, submitPlacementAnswer } from "./placement/irt";

type TestFixture = {
  teacherId: string;
  classId: string;
  studentId: string;
};

function uniqueId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function createFixture(): Promise<TestFixture> {
  const teacher = await prisma.teacher.create({
    data: {
      name: uniqueId("teacher"),
      email: `${uniqueId("teacher")}@example.com`,
      passwordHash: "hash",
    },
  });

  const cls = await prisma.class.create({
    data: {
      name: uniqueId("class"),
      teacherId: teacher.id,
    },
  });

  const student = await prisma.student.create({
    data: {
      classId: cls.id,
      displayName: uniqueId("student"),
      loginCode: uniqueId("code").slice(0, 12).toUpperCase(),
    },
  });

  await prisma.learnerProfile.create({
    data: {
      studentId: student.id,
      ageBand: "9-11",
      stage: "A1",
    },
  });

  return {
    teacherId: teacher.id,
    classId: cls.id,
    studentId: student.id,
  };
}

async function cleanupFixture(fixture: TestFixture) {
  const sessionIds = (
    await prisma.placementSession.findMany({
      where: { studentId: fixture.studentId },
      select: { id: true },
    })
  ).map((s) => s.id);

  const attempts = await prisma.attempt.findMany({
    where: { studentId: fixture.studentId },
    select: { id: true, taskId: true },
  });

  const attemptIds = attempts.map((a) => a.id);
  const attemptTaskIds = Array.from(new Set(attempts.map((a) => a.taskId)));

  if (attemptIds.length > 0) {
    await prisma.attemptGseEvidence.deleteMany({
      where: { attemptId: { in: attemptIds } },
    });
    await prisma.attemptMetric.deleteMany({
      where: { attemptId: { in: attemptIds } },
    });
    await prisma.placementResponse.deleteMany({
      where: { attemptId: { in: attemptIds } },
    });
  }

  await prisma.attempt.deleteMany({
    where: { studentId: fixture.studentId },
  });

  await prisma.taskInstance.deleteMany({
    where: { studentId: fixture.studentId },
  });

  if (attemptTaskIds.length > 0) {
    await prisma.taskGseTarget.deleteMany({
      where: { taskId: { in: attemptTaskIds } },
    });
    await prisma.task.deleteMany({
      where: { id: { in: attemptTaskIds } },
    });
  }

  if (sessionIds.length > 0) {
    for (const sessionId of sessionIds) {
      const taskIds = (
        await prisma.task.findMany({
          where: {
            metaJson: {
              path: ["placementSessionId"],
              equals: sessionId,
            },
          },
          select: { id: true },
        })
      ).map((t) => t.id);

      if (taskIds.length > 0) {
        await prisma.taskGseTarget.deleteMany({
          where: { taskId: { in: taskIds } },
        });
        await prisma.task.deleteMany({
          where: { id: { in: taskIds } },
        });
      }
    }
  }

  await prisma.placementSession.deleteMany({
    where: { studentId: fixture.studentId },
  });

  await prisma.promotionAudit.deleteMany({
    where: { studentId: fixture.studentId },
  });
  await prisma.progressDaily.deleteMany({
    where: { studentId: fixture.studentId },
  });
  await prisma.gseStageProjection.deleteMany({
    where: { studentId: fixture.studentId },
  });
  await prisma.studentVocabulary.deleteMany({
    where: { studentId: fixture.studentId },
  });
  await prisma.studentGseMastery.deleteMany({
    where: { studentId: fixture.studentId },
  });
  await prisma.learnerProfile.deleteMany({
    where: { studentId: fixture.studentId },
  });

  await prisma.student.deleteMany({
    where: { id: fixture.studentId },
  });
  await prisma.class.deleteMany({
    where: { id: fixture.classId },
  });
  await prisma.teacher.deleteMany({
    where: { id: fixture.teacherId },
  });
}

test("placement IRT flow: start -> answer -> finish", async (t) => {
  const fixture = await createFixture();
  t.after(async () => {
    await cleanupFixture(fixture);
  });

  const session = await startPlacement(fixture.studentId);
  const state = await getPlacementSession(fixture.studentId, session.id);
  assert.ok(state?.question);

  const startResponse = placementStartResponseSchema.parse({
    placementId: session.id,
    status: session.status,
    theta: session.theta,
    sigma: session.sigma,
    currentIndex: session.currentIndex,
    totalQuestions: state?.totalQuestions || 14,
    currentQuestion: state?.question || null,
    nextItem: state?.question || null,
  });
  assert.equal(startResponse.placementId, session.id);

  const answer = await submitPlacementAnswer(session.id, {
    itemId: state?.question?.id,
    transcript: "I like reading books and playing football with my friends after school.",
    selfRating: 4,
    observedMetrics: {
      speechScore: 72,
      taskScore: 74,
      languageScore: 71,
      overallScore: 73,
      reliability: "medium",
      speechRate: 110,
      pronunciation: 68,
      fluency: 70,
      vocabularyUsage: 72,
      taskCompletion: 74,
      grammarAccuracy: 70,
    },
  });

  const answerResponse = placementAnswerResponseSchema.parse({
    placementId: session.id,
    status: answer.status,
    theta: answer.theta,
    sigma: answer.sigma,
    currentIndex: answer.currentIndex,
    questionCount: answer.questionCount,
    totalQuestions: 14,
    nextItem: answer.nextItem,
    whyThisItem: answer.whyThisItem,
    done: answer.done,
  });
  assert.equal(answerResponse.placementId, session.id);
  assert.equal(answerResponse.questionCount, 1);

  const result = await finishPlacement(session.id);
  const finishResponse = placementFinishResponseSchema.parse({
    placementId: session.id,
    status: "completed",
    result,
    provisionalStage: result.provisionalStage,
    promotionStage: result.promotionStage,
    confidence: result.confidence,
    uncertainty: result.uncertainty,
    coverage: result.coverage,
    reliability: result.reliability,
    blockedBundles: result.blockedBundles,
  });
  assert.equal(finishResponse.status, "completed");

  const stored = await prisma.placementSession.findUnique({
    where: { id: session.id },
    select: { status: true },
  });
  assert.equal(stored?.status, "completed");
});

test("placement extended flow covers finished=false, finished=true, and reset", async (t) => {
  const fixture = await createFixture();
  t.after(async () => {
    await cleanupFixture(fixture);
  });

  const started = await startPlacementExtended(fixture.studentId);
  const startResponse = placementExtendedStartResponseSchema.parse({
    sessionId: started.session.id,
    task: {
      taskId: started.task.id,
      type: started.task.type,
      prompt: started.task.prompt,
      metaJson: started.task.metaJson,
    },
  });
  assert.equal(startResponse.sessionId, started.session.id);

  const firstAttempt = await prisma.attempt.create({
    data: {
      studentId: fixture.studentId,
      taskId: started.task.id,
      status: "completed",
      transcript: "I can describe my daily routine and talk about school activities.",
      scoresJson: { overallScore: 70 } as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });

  const notFinished = await submitPlacementExtendedAnswer(started.session.id, firstAttempt.id, "just_right");
  const notFinishedResponse = placementExtendedSubmitResponseSchema.parse(
    notFinished.finished
      ? {
          finished: true,
          reason: notFinished.reason,
          result: notFinished.result,
        }
      : {
          finished: false,
          nextTask: {
            taskId: notFinished.nextTask!.id,
            type: notFinished.nextTask!.type,
            prompt: notFinished.nextTask!.prompt,
            metaJson: notFinished.nextTask!.metaJson,
          },
        }
  );
  assert.equal(notFinishedResponse.finished, false);

  const regularTask = await prisma.task.create({
    data: {
      type: "topic_talk",
      prompt: "Regular non-placement task",
      level: 1,
      metaJson: { isPlacement: false } as Prisma.InputJsonValue,
    },
  });
  await prisma.attempt.create({
    data: {
      studentId: fixture.studentId,
      taskId: regularTask.id,
      status: "completed",
      transcript: "This is a normal attempt and should not alter placement sessions.",
      completedAt: new Date(),
    },
  });
  const activeAfterRegular = await prisma.placementSession.findUnique({
    where: { id: started.session.id },
    select: { status: true },
  });
  assert.equal(activeAfterRegular?.status, "started");

  await prisma.placementSession.update({
    where: { id: started.session.id },
    data: { questionCount: 5 },
  });

  const finishingTask = await prisma.task.create({
    data: {
      type: "topic_talk",
      prompt: "Final placement extended attempt",
      level: 1,
      metaJson: {
        isPlacement: true,
        placementMode: "placement_extended",
        placementSessionId: started.session.id,
        stage: "A2",
      } as Prisma.InputJsonValue,
    },
  });
  const secondAttempt = await prisma.attempt.create({
    data: {
      studentId: fixture.studentId,
      taskId: finishingTask.id,
      status: "completed",
      transcript: "I can explain my opinion in detail and give examples.",
      completedAt: new Date(),
    },
  });

  const finished = await submitPlacementExtendedAnswer(started.session.id, secondAttempt.id, "too_easy");
  const finishedResponse = placementExtendedSubmitResponseSchema.parse(
    finished.finished
      ? {
          finished: true,
          reason: finished.reason,
          result: finished.result,
        }
      : {
          finished: false,
          nextTask: {
            taskId: finished.nextTask!.id,
            type: finished.nextTask!.type,
            prompt: finished.nextTask!.prompt,
            metaJson: finished.nextTask!.metaJson,
          },
        }
  );
  assert.equal(finishedResponse.finished, true);

  const storedFinished = await prisma.placementSession.findUnique({
    where: { id: started.session.id },
    select: { status: true },
  });
  assert.equal(storedFinished?.status, "completed");

  const secondSession = await startPlacementExtended(fixture.studentId);
  const resetResult = await resetPlacementExtendedSessions(fixture.studentId);
  const resetResponse = placementExtendedResetResponseSchema.parse({ ok: true });
  assert.equal(resetResponse.ok, true);
  assert.ok(resetResult.cancelledCount >= 1);

  const cancelled = await prisma.placementSession.findUnique({
    where: { id: secondSession.session.id },
    select: { status: true },
  });
  assert.equal(cancelled?.status, "cancelled");
});
