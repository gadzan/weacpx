// Deprecated forwarding shim. weacpx was renamed to xacpx at 0.8.0.
// Re-export the public plugin API from xacpx so already-installed plugins that
// `import "weacpx/plugin-api"` keep working. New plugins should depend on
// `xacpx` and import `xacpx/plugin-api` directly.
export * from "xacpx/plugin-api";
