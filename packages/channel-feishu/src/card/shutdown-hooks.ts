// Process-level shutdown registry. The Feishu streaming card controller
// registers a handler after a card is seeded so that on SIGINT/SIGTERM/
// beforeExit, every in-flight card is driven to its terminal "aborted"
// state — otherwise a killed daemon leaves cards stuck at "处理中..." in
// the user's Feishu chat forever.
//
// Each handler runs with a per-handler timeout (default 1000ms) so a wedged
// network call cannot block process exit. Errors thrown by handlers are
// swallowed: we are already shutting down, and a partial recovery still
// beats no recovery.

type ShutdownHandler = () => Promise<void> | void;

interface RegisteredHook {
  name: string;
  handler: ShutdownHandler;
}

const hooks = new Set<RegisteredHook>();
let installed = false;
let firing = false;

const DEFAULT_PER_HANDLER_TIMEOUT_MS = 1000;

export function registerShutdownHook(name: string, handler: ShutdownHandler): () => void {
  installSignalHandlersOnce();
  const entry: RegisteredHook = { name, handler };
  hooks.add(entry);
  return () => {
    hooks.delete(entry);
  };
}

export async function fireShutdownHooksForTests(opts: { perHandlerTimeoutMs?: number } = {}): Promise<void> {
  await runAll(opts.perHandlerTimeoutMs ?? DEFAULT_PER_HANDLER_TIMEOUT_MS);
}

export function __resetShutdownHooksForTests(): void {
  hooks.clear();
  firing = false;
}

function installSignalHandlersOnce(): void {
  if (installed) return;
  installed = true;
  const trigger = (signal: NodeJS.Signals): void => {
    void runAll(DEFAULT_PER_HANDLER_TIMEOUT_MS).then(() => {
      // Re-emit the signal with handlers removed so default behavior runs.
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  };
  process.once("SIGINT", trigger);
  process.once("SIGTERM", trigger);
  process.once("beforeExit", () => { void runAll(DEFAULT_PER_HANDLER_TIMEOUT_MS); });
}

async function runAll(perHandlerTimeoutMs: number): Promise<void> {
  if (firing) return;
  firing = true;
  const snapshot = Array.from(hooks);
  hooks.clear();
  await Promise.all(snapshot.map((entry) => runOne(entry, perHandlerTimeoutMs)));
}

async function runOne(entry: RegisteredHook, timeoutMs: number): Promise<void> {
  try {
    await withTimeout(Promise.resolve().then(() => entry.handler()), timeoutMs);
  } catch {
    // swallow — we're shutting down anyway
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    p.then((v) => {
      clearTimeout(timer);
      resolve(v);
    }).catch(() => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}
