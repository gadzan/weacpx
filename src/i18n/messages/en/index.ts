import type { Messages } from "../../types";
import { common } from "./common";
import { session } from "./session";
import { nativeSession } from "./native-session";
import { recovery } from "./recovery";
import { shortcut } from "./shortcut";
import { workspace } from "./workspace";
import { agent } from "./agent";
import { later } from "./later";
import { scheduledRender } from "./scheduled-render";
import { orchestration } from "./orchestration";

export const en: Messages = { common, session, nativeSession, recovery, shortcut, workspace, agent, later, scheduledRender, orchestration };
