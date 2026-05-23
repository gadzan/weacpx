import { expect, test } from "bun:test";

import { renderLaterHelp, renderLaterList, renderTaskCreated } from "../../../src/scheduled/scheduled-render";
import type { ScheduledTaskRecord } from "../../../src/scheduled/scheduled-types";

const task: ScheduledTaskRecord = {
  id: "k8f2",
  chat_key: "weixin:user-1",
  session_alias: "internal",
  execute_at: "2026-05-23T13:30:00.000Z",
  message: "检查 CI 是否恢复",
  status: "pending",
  created_at: "2026-05-23T10:00:00.000Z",
};

test("renders help", () => {
  expect(renderLaterHelp()).toContain("/lt in 2h 检查 CI");
});

test("renders created task and list with display session", () => {
  expect(renderTaskCreated(task, "backend-codex")).toContain("#k8f2");
  expect(renderTaskCreated(task, "backend-codex")).toContain("会话：backend-codex");
  expect(renderLaterList([task], (alias) => alias === "internal" ? "backend-codex" : alias)).toContain("检查 CI 是否恢复");
});
