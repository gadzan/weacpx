// Process-level shutdown registry. The Feishu streaming card controller
// registers a handler after a card is seeded so that on SIGINT/SIGTERM/
// beforeExit, every in-flight card's terminal state is flushed to Feishu.
// Cards already in a terminal state ("completed", "error", etc.) are flushed
// as-is. Only non-terminal cards are transitioned to "aborted" — otherwise
// a killed daemon leaves cards stuck at "处理中..." in the user's Feishu chat.
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
// Once a real shutdown starts, `firing` stays true — subsequent fire
// requests (e.g. a redundant beforeExit after SIGTERM) short-circuit
// because the process is on its way out anyway.
let firing = false;

const DEFAULT_PER_HANDLER_TIMEOUT_MS = 1000;

/**
 * Register a shutdown handler. Returns a dispose function.
 *
 * Restriction: handlers MUST NOT call `registerShutdownHook` from inside
 * their own execution during shutdown. New registrations made while
 * `runAll` is in flight are silently dropped because `firing` blocks
 * subsequent fire requests.
 */
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
      // Only remove our own listener — preserves shutdown handlers
      // registered by other subsystems (e.g. the daemon controller).
      process.removeListener(signal, trigger);
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
