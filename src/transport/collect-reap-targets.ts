import { resolveAgentCommand } from "../config/resolve-agent-command";
import type { AppConfig } from "../config/types";
import type { OrchestrationState } from "../orchestration/orchestration-types";
import type { ReapTarget } from "./queue-owner-reaper";

/**
 * Reap targets for orchestration worker sessions. These are acpx sessions xacpx
 * prompts (with the orchestration MCP), so they spawn queue owners that honor the
 * configured `--ttl` and would otherwise linger after daemon stop just like normal
 * prompt owners. Logical (user) sessions are covered separately via
 * SessionService.listAllResolvedSessions; coordinator sessions that are logical are
 * already in that set, and external coordinators have no xacpx-spawned owner.
 *
 * Resolution mirrors resolveWorkerRuntimeSession: agent command from config (or the
 * agent name for built-ins), cwd from the binding or its workspace. Bindings whose
 * agent/workspace are no longer registered are skipped (their owner, if any, just
 * expires on its own TTL).
 */
export function workerBindingReapTargets(
  orchestration: OrchestrationState,
  config: AppConfig,
): ReapTarget[] {
  const targets: ReapTarget[] = [];
  for (const [workerSession, binding] of Object.entries(orchestration.workerBindings)) {
    const agentConfig = config.agents[binding.targetAgent];
    if (!agentConfig) {
      continue;
    }
    const cwd = binding.cwd ?? config.workspaces[binding.workspace]?.cwd;
    if (!cwd) {
      continue;
    }
    const agentCommand = resolveAgentCommand(agentConfig.driver, agentConfig.command);
    targets.push({
      agent: binding.targetAgent,
      ...(agentCommand ? { agentCommand } : {}),
      cwd,
      transportSession: workerSession,
    });
  }
  return targets;
}
