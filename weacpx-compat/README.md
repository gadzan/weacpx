# weacpx (deprecated)

**`weacpx` has been renamed to [`xacpx`](https://www.npmjs.com/package/xacpx).**

Install the new package instead:

```bash
npm install -g xacpx
```

If you are upgrading from `weacpx` 0.7.x, running `weacpx update` migrates you to
`xacpx` automatically.

This package is a compatibility shim only. It ships **no CLI** — it merely
forwards `weacpx/plugin-api` to `xacpx/plugin-api` so already-installed channel
plugins keep resolving. New plugins should depend on `xacpx` and import
`xacpx/plugin-api`.
