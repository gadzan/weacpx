import { renderHelpText } from "../../formatting/render-text";
import type { RouterResponse } from "../router-types";

export function handleHelp(): RouterResponse {
  return { text: renderHelpText() };
}
