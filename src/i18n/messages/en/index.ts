import type { Messages } from "../../types";
import { common } from "./common";
import { session } from "./session";
import { nativeSession } from "./native-session";
import { recovery } from "./recovery";
import { shortcut } from "./shortcut";

export const en: Messages = { common, session, nativeSession, recovery, shortcut };
