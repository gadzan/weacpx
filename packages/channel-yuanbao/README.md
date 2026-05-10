# @ganglion/weacpx-channel-yuanbao

First-party Yuanbao message channel plugin for weacpx.

## Install

```bash
weacpx plugin add @ganglion/weacpx-channel-yuanbao
weacpx channel add yuanbao
weacpx restart
```

## Required options

- `appKey`
- `appSecret`

Existing weacpx configs with `channels[].type = "yuanbao"` remain valid after this plugin is installed.
