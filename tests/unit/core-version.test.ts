import { expect, test } from "bun:test";

import { XACPX_CORE_VERSION } from "../../src/version";
import pkg from "../../package.json";

test("XACPX_CORE_VERSION matches package.json", () => {
  expect(XACPX_CORE_VERSION).toBe((pkg as { version: string }).version);
});
