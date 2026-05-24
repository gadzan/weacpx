import type { RouterResponse, ScheduledRouterOps } from "../router-types";
import type { ScheduledTaskRecord, ScheduledSessionMode } from "../../scheduled/scheduled-types";
import { parseLaterTime } from "../../scheduled/parse-later-time";
import { renderLaterHelp, renderLaterList, renderTaskCreated } from "../../scheduled/scheduled-render";
import { toDisplaySessionAlias } from "../../channels/channel-scope";

export const laterHelpMetadata = {
  topic: "later",
  aliases: ["lt"],
  summary: "定时任务：到点在临时会话执行（或 --bind 发到当前会话）",
  commands: [
    { usage: "/lt <时间> <消息>", description: "创建定时任务" },
    { usage: "/lt --bind <时间> <消息>", description: "改为发送到当前会话" },
    { usage: "/lt --temp <时间> <消息>", description: "强制使用临时会话" },
    { usage: "/lt list", description: "查看待执行定时任务" },
    { usage: "/lt cancel <id>", description: "取消定时任务" },
  ],
  examples: [
    "/lt in 2h 检查 CI",
    "/lt 30分钟后 总结进展",
    "/lt tomorrow 09:00 看 PR",
    "/lt 今天 21:30 继续处理",
    "/lt 周五 09:00 继续处理",
  ],
  notes: [
    "只支持一次性任务，不支持重复执行",
    "时间必须在 10 秒之后、7 天之内",
    "默认在为本次任务新建的临时会话里执行，跑完即销毁",
    "加 --bind 改为发送到创建时绑定的当前会话（默认模式可用 later.defaultMode 配置）",
    "/lt list 显示全局待执行任务；群聊中只有群主可取消",
    "不支持延迟执行 / 开头的 weacpx 命令",
    "完整时间格式与说明见 docs/later-command.md",
  ],
};

export function handleLaterHelp(): RouterResponse {
  return { text: renderLaterHelp() };
}

export async function handleLaterCreate(
  tokens: string[],
  scheduled: ScheduledRouterOps,
  chatKey: string,
  currentSession: { alias: string; agent: string; workspace: string } | null,
  defaultMode: ScheduledSessionMode,
  accountId?: string,
  replyContextToken?: string,
): Promise<RouterResponse> {
  // Consume any leading --bind / --temp flags (mutually exclusive).
  let rest = tokens;
  const seenFlags = new Set<string>();
  let flagMode: ScheduledSessionMode | undefined;
  while (rest.length > 0 && (rest[0] === "--bind" || rest[0] === "--temp")) {
    seenFlags.add(rest[0]);
    flagMode = rest[0] === "--bind" ? "bound" : "temp";
    rest = rest.slice(1);
  }
  if (seenFlags.size > 1) {
    return { text: "定时任务的 --bind 与 --temp 不能同时使用。" };
  }
  const mode: ScheduledSessionMode = flagMode ?? defaultMode;

  if (!currentSession) {
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

  const result = parseLaterTime(rest);
  if (!result.ok) {
    return { text: renderTimeParseError(result.code, result.value) };
  }

  const message = rest.slice(result.messageStartIndex).join(" ").trim();
  if (message.startsWith("/")) {
    return {
      text: [
        "不支持延迟执行 / 开头的命令。",
        "",
        "如果需要让 agent 解释命令，可以用自然语言描述：",
        "例如：/lt in 1h 请解释 /status 的作用",
      ].join("\n"),
    };
  }

  const task = await scheduled.createTask({
    chatKey,
    sessionAlias: currentSession.alias,
    executeAt: result.executeAt,
    message,
    sessionMode: mode,
    ...(mode === "temp" ? { agent: currentSession.agent, workspace: currentSession.workspace } : {}),
    ...(accountId ? { accountId } : {}),
    ...(replyContextToken ? { replyContextToken } : {}),
  });
  return { text: renderTaskCreated(task, toDisplaySessionAlias(currentSession.alias)) };
}

export function handleLaterList(scheduled: ScheduledRouterOps): RouterResponse {
  const tasks = scheduled.listPending();
  return { text: renderLaterList(tasks, (alias) => toDisplaySessionAlias(alias)) };
}

export async function handleLaterCancel(id: string, scheduled: ScheduledRouterOps): Promise<RouterResponse> {
  const ok = await scheduled.cancelPending(id);
  if (ok) {
    return { text: `已取消定时任务 #${id.replace(/^#/, "").toLowerCase()}` };
  }
  const displayId = id.replace(/^#/, "").toLowerCase();
  return { text: [`未找到待执行的定时任务 #${displayId}。`, "可以用 /lt list 查看当前待执行任务。"].join("\n") };
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
