import { expect, test } from "bun:test";
import { coreEnv, coreEnvName, legacyCoreEnvName } from "../../../src/runtime/core-env";

test("coreEnv prefers the XACPX_ prefix over the legacy WEACPX_ one", () => {
  const env = { XACPX_CONFIG: "/new/path", WEACPX_CONFIG: "/old/path" } as NodeJS.ProcessEnv;
  expect(coreEnv("CONFIG", env)).toBe("/new/path");
});

test("coreEnv falls back to the legacy WEACPX_ prefix when XACPX_ is unset", () => {
  const env = { WEACPX_CONFIG: "/old/path" } as NodeJS.ProcessEnv;
  expect(coreEnv("CONFIG", env)).toBe("/old/path");
});

test("coreEnv returns undefined when neither prefix is set", () => {
  expect(coreEnv("CONFIG", {} as NodeJS.ProcessEnv)).toBeUndefined();
});

test("coreEnv reads process.env by default", () => {
  const previous = process.env.XACPX_TEST_CORE_ENV;
  process.env.XACPX_TEST_CORE_ENV = "value";
  try {
    expect(coreEnv("TEST_CORE_ENV")).toBe("value");
  } finally {
    if (previous === undefined) delete process.env.XACPX_TEST_CORE_ENV;
    else process.env.XACPX_TEST_CORE_ENV = previous;
  }
});

test("coreEnvName / legacyCoreEnvName build prefixed names", () => {
  expect(coreEnvName("DAEMON_RUN")).toBe("XACPX_DAEMON_RUN");
  expect(legacyCoreEnvName("DAEMON_RUN")).toBe("WEACPX_DAEMON_RUN");
});
