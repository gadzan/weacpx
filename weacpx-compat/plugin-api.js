// Deprecated forwarding shim. weacpx was renamed to xacpx at 0.8.0 (npm package
// `@ganglion/xacpx`, command `xacpx`). Re-export the public plugin API so
// already-installed plugins that `import "weacpx/plugin-api"` keep working. New
// plugins should depend on `@ganglion/xacpx` and import `xacpx/plugin-api`.
export * from "@ganglion/xacpx/plugin-api";
