import type { RouterResponse, ScheduledRouterOps } from "../router-types";
import type { ScheduledTaskRecord } from "../../scheduled/scheduled-types";
import { parseLaterTime } from "../../scheduled/parse-later-time";
import { isKnownWeacpxCommandText } from "../command-list";
import { renderLaterHelp, renderLaterList, renderTaskCreated } from "../../scheduled/scheduled-render";

export const laterHelpMetadata = {
  topic: "later",
  aliases: ["lt"],
  summary: "定时任务：延时发送消息到当前会话",
  commands: [
    { usage: "/lt <时间> <消息>", description: "创建定时任务" },
    { usage: "/lt list", description: "查看待执行定时任务" },
    { usage: "/lt cancel <id>", description: "取消定时任务" },
  ],
  examples: [
    "/lt in 2h 检查 CI",
    "/lt 30分钟后 总结进展",
    "/lt tomorrow 09:00 看 PR",
    "/lt 周五 09:00 继续处理",
  ],
};

export function handleLaterHelp(): RouterResponse {
  return { text: renderLaterHelp() };
}

export async function handleLaterCreate(
  tokens: string[],
  scheduled: ScheduledRouterOps,
  chatKey: string,
  currentSessionAlias: string | null,
  accountId?: string,
  replyContextToken?: string,
): Promise<RouterResponse> {
  if (!currentSessionAlias) {
    return {
      text: [
        "当前没有会话，无法创建定时任务。",
        "",
        "请先创建或切换到一个会话：",
        "- /ss codex --ws backend（新建并切换）",
        "- /use backend-codex（切换到已有会话）",
      ].join("\n"),
    };
  }

  const result = parseLaterTime(tokens);
  if (!result.ok) {
    return { text: renderTimeParseError(result.code, result.value) };
  }

  const message = tokens.slice(result.messageStartIndex).join(" ");
  if (isKnownWeacpxCommandText(message)) {
    return {
      text: [
        "不支持延迟执行 weacpx 命令。",
        "",
        "如果需要让 agent 解释命令，可以用自然语言描述：",
        "例如：/lt in 1h 请解释 /status 的作用",
      ].join("\n"),
    };
  }

  const task = await scheduled.createTask({
    chatKey,
    sessionAlias: currentSessionAlias,
    executeAt: result.executeAt,
    message,
    ...(accountId ? { accountId } : {}),
    ...(replyContextToken ? { replyContextToken } : {}),
  });
  return { text: renderTaskCreated(task, currentSessionAlias) };
}

export function handleLaterList(scheduled: ScheduledRouterOps): RouterResponse {
  const tasks = scheduled.listPending();
  return { text: renderLaterList(tasks, (alias) => alias) };
}

export async function handleLaterCancel(id: string, scheduled: ScheduledRouterOps): Promise<RouterResponse> {
  const ok = await scheduled.cancelPending(id);
  if (ok) {
    return { text: `已取消定时任务 #${id.replace(/^#/, "").toUpperCase()}` };
  }
  return { text: `未找到待执行的定时任务 ${id}` };
}

function renderTimeParseError(code: string, value?: string): string {
  switch (code) {
    case "missing_message":
      return "定时任务需要消息内容，请在时间后附上要发送的内容。";
    case "too_soon":
      return "定时任务执行时间必须在 10 秒之后。";
    case "out_of_range":
      return "定时任务执行时间不能超过 7 天。";
    case "past_today_time":
      return `今天 ${value} 已经过了，请指定一个未来的时间，或使用「明天」。`;
    case "unrecognized_time":
    case "missing_time":
    default:
      return [
        "无法识别时间格式。",
        "",
        "支持的格式：",
        "- /lt in 2h 消息（2小时后）",
        "- /lt 30分钟后 消息",
        "- /lt tomorrow 09:00 消息",
        "- /lt 周五 09:00 消息",
      ].join("\n");
  }
}
