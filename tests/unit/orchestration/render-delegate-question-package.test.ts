import { expect, test } from "bun:test";

import { renderDelegateQuestionPackage } from "../../../src/orchestration/render-delegate-question-package";

test("renders a blocker package for delegate questions with review context and anti-forwarding instructions", () => {
  const text = renderDelegateQuestionPackage({
    coordinatorSession: "backend:main",
    blockedTasks: [
      {
        taskId: "task-1",
        workerSession: "backend:claude:backend:main",
        targetAgent: "claude",
        question: "Should I keep SQLite?",
        whyBlocked: "schema choice changes follow-up steps",
        whatIsNeeded: "database decision",
      },
    ],
    contestedReviews: [
      {
        taskId: "task-9",
        reviewId: "review-9",
        resultId: "result-9",
        resultText: "generated from a misrouted answer",
      },
    ],
  });

  expect(text).toContain("[delegate_question_package]");
  expect(text).toContain("mode: answer_blockers_first");
  expect(text).toContain("coordinator_session: backend:main");
  expect(text).toContain("task_id: task-1");
  expect(text).toContain("question: Should I keep SQLite?");
  expect(text).toContain("review_id: review-9");
  expect(text).toContain("不要直接把 human 原话转发给 worker");
  expect(text).toContain("[/delegate_question_package]");
});
