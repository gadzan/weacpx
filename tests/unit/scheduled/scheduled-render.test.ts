import { expect, test } from "bun:test";

import { renderLaterHelp, renderLaterList, renderTaskCreated } from "../../../src/scheduled/scheduled-render";
import type { ScheduledTaskRecord } from "../../../src/scheduled/scheduled-types";

const boundTask: ScheduledTaskRecord = {
  id: "k8f2",
  chat_key: "weixin:user-1",
  session_alias: "internal",
  session_mode: "bound",
  execute_at: "2026-05-24T13:30:00.000Z",
  message: "检查 CI 是否恢复",
  status: "pending",
  created_at: "2026-05-24T10:00:00.000Z",
};

const tempTask: ScheduledTaskRecord = {
  id: "p91a",
  chat_key: "weixin:user-1",
  session_alias: "internal",
  session_mode: "temp",
  agent: "codex",
  workspace: "backend",
  execute_at: "2026-05-25T01:00:00.000Z",
  message: "继续整理",
  status: "pending",
  created_at: "2026-05-24T10:00:00.000Z",
};

const legacyTask: ScheduledTaskRecord = {
  id: "old1",
  chat_key: "weixin:user-1",
  session_alias: "internal",
  execute_at: "2026-05-24T13:30:00.000Z",
  message: "旧任务",
  status: "pending",
  created_at: "2026-05-24T10:00:00.000Z",
};

test("renders help", () => {
  expect(renderLaterHelp()).toContain("/lt in 2h 检查 CI");
});

test("renders bound + legacy task as 会话：<alias>", () => {
  expect(renderTaskCreated(boundTask, "backend-codex")).toContain("会话：backend-codex");
  expect(renderTaskCreated(legacyTask, "backend-codex")).toContain("会话：backend-codex");
});

test("renders temp task as 临时会话（workspace · agent）", () => {
  const text = renderTaskCreated(tempTask, "backend-codex");
  expect(text).toContain("临时会话（backend · codex）");
  expect(text).not.toContain("会话：backend-codex");
});

test("list renders each task by its mode", () => {
  const text = renderLaterList([boundTask, tempTask], (alias) => (alias === "internal" ? "backend-codex" : alias));
  expect(text).toContain("会话：backend-codex");
  expect(text).toContain("临时会话（backend · codex）");
});
