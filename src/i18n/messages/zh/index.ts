import type { Messages } from "../../types";
import { common } from "./common";
import { session } from "./session";
import { nativeSession } from "./native-session";
import { recovery } from "./recovery";
import { shortcut } from "./shortcut";
import { workspace } from "./workspace";
import { agent } from "./agent";

export const zh: Messages = { common, session, nativeSession, recovery, shortcut, workspace, agent };
