import { expect, test } from "bun:test";

import {
  renderHumanQuestionPackageMessage,
  renderHumanQuestionPackageReceipt,
} from "../../../src/orchestration/render-human-question-package";

test("appends a queue hint to human question package messages", () => {
  const text = renderHumanQuestionPackageMessage({
    promptText: ["我这边有 2 个子任务继续推进前需要你确认：", "1. 数据库方案：继续 SQLite 还是切 Postgres？", "2. 权限边界：是否允许写文件？"].join("\n"),
    queuedCount: 1,
  });

  expect(text).toContain("继续 SQLite 还是切 Postgres");
  expect(text).toContain("另外还有 1 个新问题已排队");
});

test("renders a receipt that distinguishes resumed and unresolved tasks", () => {
  const text = renderHumanQuestionPackageReceipt({
    resumed: [
      { taskId: "task-1", summary: "数据库方案已明确" },
      { taskId: "task-3", summary: "权限边界已明确" },
    ],
    unresolved: [{ taskId: "task-2", summary: "还缺是否允许跳过迁移的决定" }],
    queuedCount: 2,
  });

  expect(text).toContain("task-1：已恢复（数据库方案已明确）");
  expect(text).toContain("task-2：仍待补充（还缺是否允许跳过迁移的决定）");
  expect(text).toContain("还有 2 个新问题");
});
