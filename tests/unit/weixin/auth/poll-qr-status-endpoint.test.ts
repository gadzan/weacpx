import { describe, it, expect } from "bun:test";
import { buildPollQRStatusEndpoint } from "../../../../src/weixin/auth/login-qr.js";

describe("buildPollQRStatusEndpoint", () => {
  it("omits verify_code when not supplied", () => {
    expect(buildPollQRStatusEndpoint("abc")).toBe("ilink/bot/get_qrcode_status?qrcode=abc");
  });

  it("appends verify_code when supplied", () => {
    expect(buildPollQRStatusEndpoint("abc", "123456")).toBe(
      "ilink/bot/get_qrcode_status?qrcode=abc&verify_code=123456",
    );
  });

  it("URL-encodes the qrcode token", () => {
    expect(buildPollQRStatusEndpoint("a/b+c d", "111111")).toBe(
      "ilink/bot/get_qrcode_status?qrcode=a%2Fb%2Bc%20d&verify_code=111111",
    );
  });

  it("URL-encodes the verify_code value", () => {
    expect(buildPollQRStatusEndpoint("abc", "1 2&3")).toBe(
      "ilink/bot/get_qrcode_status?qrcode=abc&verify_code=1%202%263",
    );
  });

  it("treats empty verifyCode as absent (does not append the query param)", () => {
    expect(buildPollQRStatusEndpoint("abc", "")).toBe("ilink/bot/get_qrcode_status?qrcode=abc");
  });
});
