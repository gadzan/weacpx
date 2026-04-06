import { expect, test } from "bun:test";

import { runStreamingPrompt } from "../../../src/bridge/bridge-runtime";

test("flushes buffered prompt text after timeout when no paragraph boundary arrives", async () => {
  const segments: string[] = [];
  let currentTime = 0;
  let intervalCallback: (() => void) | undefined;
  let dataHandler: ((chunk: string | Buffer) => void) | undefined;
  let closeHandler: ((code: number | null) => void) | undefined;

  const resultPromise = runStreamingPrompt(
    "acpx",
    ["prompt"],
    async (event) => {
      if (event.type === "prompt.segment") {
        segments.push(event.text);
      }
    },
    {
      spawnPrompt: () =>
        ({
          stdout: {
            setEncoding: () => {},
            on: (event: "data", handler: (chunk: string | Buffer) => void) => {
              if (event === "data") {
                dataHandler = handler;
              }
            },
          },
          stderr: {
            on: () => {},
          },
          on: (event: "close" | "error", handler: (code: number | null) => void) => {
            if (event === "close") {
              closeHandler = handler;
            }
          },
        }) as unknown as {
          stdout: { setEncoding: (encoding: string) => void; on: (event: "data", handler: (chunk: string | Buffer) => void) => void };
          stderr: { on: (event: "data" | "error", handler: (chunk: string | Buffer) => void) => void };
          on: (event: "close" | "error", handler: (code: number | null) => void) => void;
        },
      setIntervalFn: (callback) => {
        intervalCallback = callback;
        return 1;
      },
      clearIntervalFn: () => {},
      maxSegmentWaitMs: 1_000,
      flushCheckIntervalMs: 100,
      now: () => currentTime,
    },
  );

  dataHandler?.(
    `${JSON.stringify({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "still thinking" },
        },
      },
    })}\n`,
  );

  currentTime = 1_500;
  intervalCallback?.();

  closeHandler?.(0);
  await expect(resultPromise).resolves.toEqual({
    code: 0,
    stdout: expect.stringContaining("still thinking"),
    stderr: "",
  });
  expect(segments).toEqual(["still thinking"]);
});
