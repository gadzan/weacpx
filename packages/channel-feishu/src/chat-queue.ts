const queues = new Map<string, Promise<void>>();

export function buildFeishuQueueKey(accountId: string, chatId: string, threadId?: string): string {
  return threadId ? `${accountId}:${chatId}:thread:${threadId}` : `${accountId}:${chatId}`;
}

export function enqueueFeishuChatTask(input: {
  accountId: string;
  chatId: string;
  threadId?: string;
  task: () => Promise<void>;
}): { status: "queued" | "immediate"; promise: Promise<void> } {
  const key = buildFeishuQueueKey(input.accountId, input.chatId, input.threadId);
  const previous = queues.get(key) ?? Promise.resolve();
  const status = queues.has(key) ? "queued" : "immediate";
  const promise = previous.then(input.task, input.task);
  queues.set(key, promise);
  const cleanup = (): void => {
    if (queues.get(key) === promise) queues.delete(key);
  };
  promise.then(cleanup, cleanup);
  return { status, promise };
}

export function resetFeishuChatQueueForTests(): void {
  queues.clear();
}
