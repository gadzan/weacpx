import { expect, test } from "bun:test";

import { WEACPX_CORE_VERSION } from "../../src/version";
import pkg from "../../package.json";

test("WEACPX_CORE_VERSION matches package.json", () => {
  expect(WEACPX_CORE_VERSION).toBe((pkg as { version: string }).version);
});
