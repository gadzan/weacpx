const queues = new Map<string, Promise<void>>();

export function enqueueYuanbaoChatTask(input: {
  chatKey: string;
  task: () => Promise<void>;
}): { status: "queued" | "immediate"; promise: Promise<void> } {
  const previous = queues.get(input.chatKey) ?? Promise.resolve();
  const status = queues.has(input.chatKey) ? "queued" : "immediate";
  const promise = previous.then(input.task, input.task);
  queues.set(input.chatKey, promise);
  const cleanup = (): void => {
    if (queues.get(input.chatKey) === promise) queues.delete(input.chatKey);
  };
  promise.then(cleanup, cleanup);
  return { status, promise };
}

export function resetYuanbaoChatQueueForTests(): void {
  queues.clear();
}
