import { afterEach, expect, test } from "bun:test";

import { sendMessage } from "../../../src/weixin/api/api";
import { isWeixinSendError } from "../../../src/weixin/messaging/send-errors";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(response: { status: number; body: string }) {
  // @ts-expect-error overriding global fetch for the test
  globalThis.fetch = async () =>
    new Response(response.body, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
}

test("sendMessage throws WeixinSendError on non-zero errcode in 200 response", async () => {
  // This is the case that used to be silently swallowed: HTTP 200 OK but
  // the API logically rejects the send (e.g. quota exhausted).
  stubFetch({
    status: 200,
    body: JSON.stringify({ errcode: -14, errmsg: "quota exceeded for user" }),
  });

  let caught: unknown;
  try {
    await sendMessage({
      baseUrl: "https://example.test",
      token: "test-token",
      body: { msg: { from_user_id: "", to_user_id: "u", client_id: "c" } },
    });
  } catch (err) {
    caught = err;
  }

  expect(isWeixinSendError(caught)).toBe(true);
  if (isWeixinSendError(caught)) {
    expect(caught.errcode).toBe(-14);
    expect(caught.errmsg).toBe("quota exceeded for user");
    expect(caught.httpStatus).toBe(200);
    expect(caught.endpoint).toBe("sendMessage");
  }
});

test("sendMessage throws WeixinSendError on non-2xx response", async () => {
  stubFetch({
    status: 500,
    body: '{"errcode":99,"errmsg":"internal"}',
  });

  let caught: unknown;
  try {
    await sendMessage({
      baseUrl: "https://example.test",
      token: "t",
      body: { msg: { from_user_id: "", to_user_id: "u", client_id: "c" } },
    });
  } catch (err) {
    caught = err;
  }

  expect(isWeixinSendError(caught)).toBe(true);
  if (isWeixinSendError(caught)) {
    expect(caught.httpStatus).toBe(500);
    expect(caught.errcode).toBe(99);
  }
});

test("sendMessage succeeds when 200 response has errcode 0 or no errcode", async () => {
  stubFetch({ status: 200, body: '{"errcode":0}' });
  await expect(
    sendMessage({
      baseUrl: "https://example.test",
      token: "t",
      body: { msg: { from_user_id: "", to_user_id: "u", client_id: "c" } },
    }),
  ).resolves.toBeUndefined();

  stubFetch({ status: 200, body: "{}" });
  await expect(
    sendMessage({
      baseUrl: "https://example.test",
      token: "t",
      body: { msg: { from_user_id: "", to_user_id: "u", client_id: "c" } },
    }),
  ).resolves.toBeUndefined();
});
