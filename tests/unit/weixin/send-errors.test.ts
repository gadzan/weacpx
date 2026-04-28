import { describe, expect, test } from "bun:test";

import {
  WeixinSendError,
  describeWeixinSendError,
  isWeixinSendError,
} from "../../../src/weixin/messaging/send-errors";

describe("WeixinSendError", () => {
  test("formats message with endpoint, httpStatus, errcode, errmsg", () => {
    const err = new WeixinSendError({
      endpoint: "sendMessage",
      httpStatus: 200,
      errcode: -14,
      errmsg: "quota exceeded",
      textPreview: '{"errcode":-14,"errmsg":"quota exceeded"}',
    });
    expect(err.message).toBe(
      "sendMessage httpStatus=200 errcode=-14 errmsg=quota exceeded",
    );
    expect(err.errcode).toBe(-14);
    expect(err.errmsg).toBe("quota exceeded");
    expect(err.httpStatus).toBe(200);
    expect(err.endpoint).toBe("sendMessage");
  });

  test("falls back to raw body preview when errmsg is absent", () => {
    const err = new WeixinSendError({
      endpoint: "sendMessage",
      httpStatus: 405,
      textPreview: "<!doctype html><title>Example Domain</title>",
    });
    expect(err.message).toContain("httpStatus=405");
    expect(err.message).toContain("body=<!doctype html>");
    expect(err.errcode).toBeUndefined();
    expect(err.errmsg).toBeUndefined();
  });

  test("truncates very long errmsg", () => {
    const long = "x".repeat(500);
    const err = new WeixinSendError({
      endpoint: "sendMessage",
      httpStatus: 200,
      errcode: 1,
      errmsg: long,
      textPreview: long,
    });
    expect(err.message.length).toBeLessThan(300);
    expect(err.message).toContain("…");
  });

  test("isWeixinSendError narrows correctly", () => {
    const err = new WeixinSendError({
      endpoint: "sendMessage",
      httpStatus: 500,
      textPreview: "",
    });
    expect(isWeixinSendError(err)).toBe(true);
    expect(isWeixinSendError(new Error("plain"))).toBe(false);
    expect(isWeixinSendError("string")).toBe(false);
  });

  test("describeWeixinSendError returns sparse fields for structured errors", () => {
    const err = new WeixinSendError({
      endpoint: "sendMessage",
      httpStatus: 200,
      errcode: -14,
      errmsg: "quota",
      textPreview: "{}",
    });
    const desc = describeWeixinSendError(err);
    expect(desc.errcode).toBe(-14);
    expect(desc.errmsg).toBe("quota");
    expect(desc.httpStatus).toBe(200);
    expect(desc.endpoint).toBe("sendMessage");
  });

  test("describeWeixinSendError handles plain errors and unknown values", () => {
    expect(describeWeixinSendError(new Error("boom"))).toEqual({ message: "boom" });
    expect(describeWeixinSendError("oops")).toEqual({ message: "oops" });
  });
});
