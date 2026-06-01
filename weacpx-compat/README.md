# weacpx (deprecated)

**`weacpx` has been renamed to `xacpx`** — published on npm as
[`@ganglion/xacpx`](https://www.npmjs.com/package/@ganglion/xacpx). The CLI
command is still `xacpx`.

Install the new package instead:

```bash
npm install -g @ganglion/xacpx
```

This package is a compatibility shim only. It ships **no CLI** — it merely
forwards `weacpx/plugin-api` to `@ganglion/xacpx/plugin-api` so already-installed
channel plugins keep resolving. New plugins should depend on `@ganglion/xacpx`
and import `xacpx/plugin-api`.
