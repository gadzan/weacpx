import { t } from "../i18n/index.js";

interface BlockedTaskInput {
  taskId: string;
  workerSession?: string;
  targetAgent: string;
  question: string;
  whyBlocked: string;
  whatIsNeeded: string;
}

interface ContestedReviewInput {
  taskId: string;
  reviewId: string;
  resultId: string;
  resultText: string;
}

export interface RenderDelegateQuestionPackageInput {
  coordinatorSession: string;
  blockedTasks: BlockedTaskInput[];
  contestedReviews?: ContestedReviewInput[];
}

function renderSectionTitle(title: string): string {
  return title;
}

function renderBlockedTask(task: BlockedTaskInput): string {
  return [
    `- task_id: ${task.taskId}`,
    `  worker_session: ${task.workerSession ?? "unassigned"}`,
    `  target_agent: ${task.targetAgent}`,
    `  question: ${task.question}`,
    `  why_blocked: ${task.whyBlocked}`,
    `  what_is_needed: ${task.whatIsNeeded}`,
  ].join("\n");
}

function renderContestedReview(review: ContestedReviewInput): string {
  return [
    `- task_id: ${review.taskId}`,
    `  review_id: ${review.reviewId}`,
    `  result_id: ${review.resultId}`,
    `  result_text: ${review.resultText}`,
  ].join("\n");
}

export function renderDelegateQuestionPackage(input: RenderDelegateQuestionPackageInput): string {
  const sections: string[] = [];

  sections.push("blocked_tasks:");
  if (input.blockedTasks.length > 0) {
    sections.push(...input.blockedTasks.map(renderBlockedTask));
  }

  if ((input.contestedReviews ?? []).length > 0) {
    sections.push("");
    sections.push(renderSectionTitle("contested_reviews:"));
    sections.push(...(input.contestedReviews ?? []).map(renderContestedReview));
  }

  sections.push("");
  sections.push("instructions:");
  sections.push(`- ${t().misc.delegateQPackageInstr1}`);
  sections.push(`- ${t().misc.delegateQPackageInstr2}`);
  sections.push(`- ${t().misc.delegateQPackageInstr3}`);

  return [
    "[delegate_question_package]",
    "mode: answer_blockers_first",
    `coordinator_session: ${input.coordinatorSession}`,
    "",
    ...sections,
    "[/delegate_question_package]",
  ].join("\n");
}
