import { expect, test } from "bun:test";

import { main } from "../../src/main";

test("app bootstrap exports a runnable entry module", () => {
  expect(typeof main).toBe("function");
});
