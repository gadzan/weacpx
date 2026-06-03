import type { WorkerPromptMessages } from "../../types";

export const workerPrompt: WorkerPromptMessages = {
  // worker-prompts.ts — buildWorkerTaskPrompt
  taskHeader: "This is a delegated task from xacpx.",
  taskIdLabel: (taskId) => `Task ID: ${taskId}`,
  taskWorkerSessionLabel: (workerSession) => `Current worker session: ${workerSession}`,
  taskRoleLabel: (role) => `Role: ${role}`,
  taskInstruction: "Please complete the task below directly; xacpx will record your final reply.",
  taskBlockerInstruction: "If you are unable to continue due to missing critical context, permission boundaries, or business decisions, do not guess; call worker_raise_question to submit a question / whyBlocked / whatIsNeeded and let the coordinator decide the next step.",
  taskProgressInstruction: "When you complete an important step, output a single line [PROGRESS] followed by a brief progress note, for example: [PROGRESS] Code review complete.",
  taskProgressNote: "You do not need to report every action — only output at key milestones.",
  taskContentLabel: (task) => `Task content: ${task}`,

  // worker-prompts.ts — buildWorkerAnswerPrompt
  answerHeader: "The following is the coordinator's organized reply to your blocker. Please continue the current task based on these explicit instructions.",
  answerInstruction: "Do not treat the original human conversation as a context source; only execute the answer below.",
  answerLabel: "Answer:",
};
