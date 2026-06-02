# xacpx VitePress Documentation Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private VitePress workspace package under `packages/docs`, migrate formal xacpx documentation into an English product-first site, and deploy it with GitHub Pages.

**Architecture:** The docs site is isolated in `packages/docs` as a private workspace package. VitePress owns all public docs content and navigation, while root `docs/` keeps internal plans and design artifacts. The root package exposes convenience scripts and GitHub Actions deploys the built static output from `packages/docs/.vitepress/dist`.

**Tech Stack:** Bun workspaces, VitePress 1.6.4, TypeScript VitePress config, GitHub Pages Actions, Markdown.

---

## File structure

### Create

- `packages/docs/package.json` — private docs workspace package and local VitePress scripts.
- `packages/docs/index.md` — public home page.
- `packages/docs/guide/getting-started.md` — installation and first-run guide derived from root `README.md`.
- `packages/docs/guide/channel-management.md` — English rewrite of `docs/channel-management.md`.
- `packages/docs/guide/scheduled-tasks.md` — English rewrite of `docs/later-command.md`.
- `packages/docs/guide/native-sessions.md` — English rewrite of `docs/native-sessions.md`.
- `packages/docs/guide/testing.md` — English rewrite of `docs/testing.md`.
- `packages/docs/guide/group-usage.md` — English rewrite of `docs/weacpx-group-usage-guide.md` with xacpx naming.
- `packages/docs/reference/commands.md` — English rewrite of `docs/commands.md`.
- `packages/docs/reference/configuration.md` — English rewrite of `docs/config-reference.md`.
- `packages/docs/reference/config-command.md` — English rewrite of `docs/config-command.md`.
- `packages/docs/reference/external-mcp.md` — English rewrite of `docs/external-mcp.md`.
- `packages/docs/plugins/development.md` — English rewrite of `docs/plugin-development.md`.
- `packages/docs/plugins/feishu.md` — English rewrite/update of `packages/channel-feishu/README.md`.
- `packages/docs/plugins/yuanbao.md` — English rewrite/update of `packages/channel-yuanbao/README.md`.
- `packages/docs/development/code-wiki.md` — English rewrite/update of `docs/code-wiki.md`.
- `packages/docs/development/commands-module.md` — English rewrite/update of `docs/commands-module.md`.
- `packages/docs/development/daemon-module.md` — English rewrite/update of `docs/daemon-module.md`.
- `packages/docs/development/contributing.md` — English rewrite/update of `docs/developments.md`.
- `packages/docs/.vitepress/config.ts` — VitePress site config, nav, sidebar, search, base path.
- `.github/workflows/docs.yml` — GitHub Pages build/deploy workflow.

### Modify

- `package.json` — add root `docs:dev`, `docs:build`, and `docs:preview` scripts; add `vitepress` as a workspace dev dependency through the docs package install.
- `bun.lock` — update through `bun install` after adding the docs package dependency.
- `.gitignore` — ignore VitePress generated output/cache and `.superpowers/`.

---

## Task 1: Scaffold the private docs workspace

**Files:**
- Create: `packages/docs/package.json`
- Create: `packages/docs/.vitepress/config.ts`
- Create: `packages/docs/index.md`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `bun.lock`

- [ ] **Step 1: Create the docs package directory**

Run:

```bash
mkdir -p packages/docs/.vitepress packages/docs/guide packages/docs/reference packages/docs/plugins packages/docs/development
```

Expected: command exits with status 0 and the directories exist.

- [ ] **Step 2: Write `packages/docs/package.json`**

Create `packages/docs/package.json` with exactly this content:

```json
{
  "name": "@ganglion/xacpx-docs",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vitepress dev .",
    "build": "vitepress build .",
    "preview": "vitepress preview ."
  },
  "devDependencies": {
    "vitepress": "1.6.4"
  }
}
```

- [ ] **Step 3: Add root docs scripts**

Modify the root `package.json` `scripts` object by adding these entries near the other development scripts:

```json
"docs:dev": "bun run --cwd packages/docs dev",
"docs:build": "bun run --cwd packages/docs build",
"docs:preview": "bun run --cwd packages/docs preview"
```

Keep existing scripts unchanged.

- [ ] **Step 4: Add generated docs artifacts to `.gitignore`**

Append these lines to `.gitignore` if they are not already present:

```gitignore
packages/docs/.vitepress/cache
packages/docs/.vitepress/dist
.superpowers/
```

- [ ] **Step 5: Write initial VitePress config**

Create `packages/docs/.vitepress/config.ts` with this content:

```ts
import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'en-US',
  title: 'xacpx',
  description:
    'Control acpx agent sessions remotely from WeChat, Feishu, Yuanbao, and other chat channels.',
  base: '/xacpx/',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/commands' },
      { text: 'Plugins', link: '/plugins/development' },
      { text: 'Development', link: '/development/code-wiki' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Channel Management', link: '/guide/channel-management' },
            { text: 'Scheduled Tasks', link: '/guide/scheduled-tasks' },
            { text: 'Native Sessions', link: '/guide/native-sessions' },
            { text: 'Group Usage', link: '/guide/group-usage' },
            { text: 'Testing', link: '/guide/testing' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Commands', link: '/reference/commands' },
            { text: 'Configuration', link: '/reference/configuration' },
            { text: '/config Command', link: '/reference/config-command' },
            { text: 'External MCP Coordinator', link: '/reference/external-mcp' }
          ]
        }
      ],
      '/plugins/': [
        {
          text: 'Plugins',
          items: [
            { text: 'Channel Plugin Development', link: '/plugins/development' },
            { text: 'Feishu Channel', link: '/plugins/feishu' },
            { text: 'Yuanbao Channel', link: '/plugins/yuanbao' }
          ]
        }
      ],
      '/development/': [
        {
          text: 'Development',
          items: [
            { text: 'Code Wiki', link: '/development/code-wiki' },
            { text: 'Commands Module', link: '/development/commands-module' },
            { text: 'Daemon Module', link: '/development/daemon-module' },
            { text: 'Contributing', link: '/development/contributing' }
          ]
        }
      ]
    },
    search: {
      provider: 'local'
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/gadzan/xacpx' }
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 xacpx contributors'
    },
    editLink: {
      pattern: 'https://github.com/gadzan/xacpx/edit/main/packages/docs/:path',
      text: 'Edit this page on GitHub'
    }
  }
});
```

- [ ] **Step 6: Write a minimal home page so the first build can run**

Create `packages/docs/index.md` with this content:

```md
---
layout: home

hero:
  name: xacpx
  text: Remote agent control from chat
  tagline: Control acpx sessions from WeChat, Feishu, Yuanbao, and other message channels.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Command Reference
      link: /reference/commands

features:
  - title: Chat-native control
    details: Start sessions, switch context, send prompts, and cancel work from supported chat channels.
  - title: acpx transport bridge
    details: Use the direct acpx CLI transport or the JSON bridge subprocess transport.
  - title: Extensible channels
    details: Add first-party or external channel plugins without changing the core console.
---
```

- [ ] **Step 7: Install dependencies**

Run:

```bash
bun install
```

Expected: command exits with status 0 and `bun.lock` includes VitePress dependencies.

- [ ] **Step 8: Verify the scaffold build fails only for missing pages or passes**

Run:

```bash
bun run docs:build
```

Expected: either PASS, or FAIL with VitePress errors naming missing sidebar target pages. If it fails for missing pages, continue to Task 2 and build again after all pages exist.

- [ ] **Step 9: Commit scaffold**

Run:

```bash
git add package.json bun.lock .gitignore packages/docs/package.json packages/docs/.vitepress/config.ts packages/docs/index.md
git commit -m "docs: scaffold VitePress documentation site"
```

Expected: commit succeeds.

---

## Task 2: Migrate home page and getting-started content

**Files:**
- Modify: `packages/docs/index.md`
- Create: `packages/docs/guide/getting-started.md`
- Source: `README.md`

- [ ] **Step 1: Read the current product README**

Run:

```bash
sed -n '1,240p' README.md
sed -n '241,520p' README.md
sed -n '521,760p' README.md
```

Expected: output shows the current xacpx README sections, install commands, usage examples, config examples, and channel/plugin notes.

- [ ] **Step 2: Expand `packages/docs/index.md` into a polished English landing page**

Replace `packages/docs/index.md` with a VitePress home page that keeps the frontmatter from Task 1 and adds Markdown sections after the frontmatter with these headings in this order:

```md
## What is xacpx?

## When to use it

## Core workflow

## Supported channels

## Next steps
```

Content requirements:

- Explain that xacpx is a chat-channel console for controlling `acpx` agent sessions.
- Mention WeChat, Feishu, Yuanbao, and plugin channels.
- Mention logical sessions versus transport sessions in one short paragraph.
- Link to `/guide/getting-started`, `/reference/commands`, `/reference/configuration`, and `/plugins/development`.
- Use `xacpx` in public prose. Use `weacpx` only if explaining old compatibility behavior.

- [ ] **Step 3: Create `packages/docs/guide/getting-started.md`**

Create the page with these headings and content derived from `README.md`:

```md
# Getting Started

## Requirements

## Install xacpx

## Run the console

## Log in to WeChat

## Create your first session

## Attach to an existing acpx session

## Configure channels and workspaces

## Local dry run

## Troubleshooting pointers
```

Content requirements:

- Include Node.js 22+ because the root package declares `"node": ">=22"`.
- Use the package name `@ganglion/xacpx` when showing npm installation.
- Use the CLI binary `xacpx`, not `weacpx`, in new commands.
- Include the repository local development commands from `AGENTS.md`: `bun run dev`, `bun run login`, `node ./dist/cli.js start`, `node ./dist/cli.js status`, `node ./dist/cli.js stop`, and `bun run dry-run --chat-key wx:test -- ...`.
- Link to `/reference/commands` and `/reference/configuration`.

- [ ] **Step 4: Build docs after home/getting-started pages**

Run:

```bash
bun run docs:build
```

Expected: build may still fail for missing sidebar pages from later tasks; it must not fail because of syntax errors in `index.md` or `guide/getting-started.md`.

- [ ] **Step 5: Commit home and getting started docs**

Run:

```bash
git add packages/docs/index.md packages/docs/guide/getting-started.md
git commit -m "docs: add xacpx home and getting started guide"
```

Expected: commit succeeds.

---

## Task 3: Migrate guide pages

**Files:**
- Create: `packages/docs/guide/channel-management.md` from `docs/channel-management.md`
- Create: `packages/docs/guide/scheduled-tasks.md` from `docs/later-command.md`
- Create: `packages/docs/guide/native-sessions.md` from `docs/native-sessions.md`
- Create: `packages/docs/guide/testing.md` from `docs/testing.md`
- Create: `packages/docs/guide/group-usage.md` from `docs/weacpx-group-usage-guide.md`

- [ ] **Step 1: Read source guide docs**

Run:

```bash
sed -n '1,220p' docs/channel-management.md
sed -n '221,520p' docs/channel-management.md
sed -n '521,760p' docs/channel-management.md
sed -n '1,340p' docs/later-command.md
sed -n '1,220p' docs/native-sessions.md
sed -n '1,180p' docs/testing.md
sed -n '1,180p' docs/weacpx-group-usage-guide.md
```

Expected: output contains all source material needed for the guide pages.

- [ ] **Step 2: Write `packages/docs/guide/channel-management.md`**

Create an English page with these headings:

```md
# Channel Management

## Overview

## Built-in and plugin channels

## Channel identities

## Add a channel

## List channels

## Update channel settings

## Remove a channel

## Restart after changes

## Common patterns
```

Content requirements:

- Preserve all command forms and config keys from `docs/channel-management.md`.
- Use `xacpx` in examples.
- Link plugin-channel details to `/plugins/feishu` and `/plugins/yuanbao` when those channels are mentioned.

- [ ] **Step 3: Write `packages/docs/guide/scheduled-tasks.md`**

Create an English page with these headings:

```md
# Scheduled Tasks

## Overview

## Create a scheduled task

## List scheduled tasks

## Show task details

## Cancel a scheduled task

## Temporary sessions

## Channel capability requirements

## Examples
```

Content requirements:

- Preserve `/later` command syntax and examples from `docs/later-command.md`.
- Explain how temporary sessions behave if the source doc describes it.
- Link to `/reference/commands` for the full command reference.

- [ ] **Step 4: Write `packages/docs/guide/native-sessions.md`**

Create an English page with these headings:

```md
# Native Agent Sessions

## Overview

## Session concepts

## Use `/ssn`

## Attach and switch behavior

## Limitations

## Troubleshooting
```

Content requirements:

- Preserve `/ssn` command behavior from `docs/native-sessions.md`.
- Clearly distinguish xacpx logical sessions from native agent sessions.

- [ ] **Step 5: Write `packages/docs/guide/testing.md`**

Create an English page with these headings:

```md
# Testing

## Test commands

## Unit tests

## Smoke tests

## Local dry runs

## Test layout
```

Content requirements:

- Include commands: `npm test`, `npm run test:unit`, `npm run test:smoke`, `bun run dry-run --chat-key wx:test -- ...`.
- Preserve the distinction between unit tests and smoke tests.

- [ ] **Step 6: Write `packages/docs/guide/group-usage.md`**

Create an English page with these headings:

```md
# Group Usage

## Overview

## Setup

## Mention and command behavior

## Session management in groups

## Best practices
```

Content requirements:

- Rewrite `docs/weacpx-group-usage-guide.md` using `xacpx` naming.
- Keep historical `Weacpx` spelling out of headings and commands unless the page explicitly says it is a legacy name.

- [ ] **Step 7: Build docs after guide migration**

Run:

```bash
bun run docs:build
```

Expected: build may still fail for missing reference/plugin/development pages; it must not fail because of Markdown syntax or links among guide pages.

- [ ] **Step 8: Commit guide migration**

Run:

```bash
git add packages/docs/guide
git commit -m "docs: migrate guide pages to English"
```

Expected: commit succeeds.

---

## Task 4: Migrate reference pages

**Files:**
- Create: `packages/docs/reference/commands.md` from `docs/commands.md`
- Create: `packages/docs/reference/configuration.md` from `docs/config-reference.md`
- Create: `packages/docs/reference/config-command.md` from `docs/config-command.md`
- Create: `packages/docs/reference/external-mcp.md` from `docs/external-mcp.md`

- [ ] **Step 1: Read source reference docs**

Run:

```bash
sed -n '1,260p' docs/commands.md
sed -n '261,560p' docs/commands.md
sed -n '1,260p' docs/config-reference.md
sed -n '261,620p' docs/config-reference.md
sed -n '1,220p' docs/config-command.md
sed -n '1,260p' docs/external-mcp.md
sed -n '261,520p' docs/external-mcp.md
```

Expected: output contains all command, configuration, and MCP reference details.

- [ ] **Step 2: Write `packages/docs/reference/commands.md`**

Create an English page with these headings:

```md
# Command Reference

## Command syntax

## Session commands

## Agent commands

## Workspace commands

## Channel commands

## Configuration commands

## Permission and mode commands

## Scheduled task commands

## Cancellation commands

## Help commands
```

Content requirements:

- Preserve command aliases and arguments from `docs/commands.md`.
- Use `xacpx` and current command names.
- Link `/config` details to `/reference/config-command` and scheduled task details to `/guide/scheduled-tasks`.

- [ ] **Step 3: Write `packages/docs/reference/configuration.md`**

Create an English page with these headings:

```md
# Configuration Reference

## File locations

## Top-level schema

## Transport configuration

## Agents

## Workspaces

## Channels

## Permissions

## Defaults

## Examples
```

Content requirements:

- Preserve JSON examples and schema details from `docs/config-reference.md`.
- Mention that `transport.permissionMode` defaults to `approve-all` when omitted.
- Use `~/.xacpx/config.json` and `~/.xacpx/state.json` for current paths.

- [ ] **Step 4: Write `packages/docs/reference/config-command.md`**

Create an English page with these headings:

```md
# `/config` Command

## Overview

## Show configuration

## Get a value

## Set a value

## Delete a value

## Safety rules

## Examples
```

Content requirements:

- Preserve `/config` command behavior from `docs/config-command.md`.
- Link to `/reference/configuration`.

- [ ] **Step 5: Write `packages/docs/reference/external-mcp.md`**

Create an English page with these headings:

```md
# External MCP Coordinator

## Overview

## Tool surface

## Delegation lifecycle

## Task state model

## Blocking questions

## Group fan-in

## Cancellation

## Integration notes
```

Content requirements:

- Preserve tool names, task states, and behavior from `docs/external-mcp.md`.
- Keep the page as a reference for external coordinators, not a tutorial.

- [ ] **Step 6: Build docs after reference migration**

Run:

```bash
bun run docs:build
```

Expected: build may still fail for missing plugin/development pages; it must not fail because of reference page Markdown syntax or links.

- [ ] **Step 7: Commit reference migration**

Run:

```bash
git add packages/docs/reference
git commit -m "docs: migrate reference pages to English"
```

Expected: commit succeeds.

---

## Task 5: Migrate plugin and development pages

**Files:**
- Create: `packages/docs/plugins/development.md` from `docs/plugin-development.md`
- Create: `packages/docs/plugins/feishu.md` from `packages/channel-feishu/README.md`
- Create: `packages/docs/plugins/yuanbao.md` from `packages/channel-yuanbao/README.md`
- Create: `packages/docs/development/code-wiki.md` from `docs/code-wiki.md`
- Create: `packages/docs/development/commands-module.md` from `docs/commands-module.md`
- Create: `packages/docs/development/daemon-module.md` from `docs/daemon-module.md`
- Create: `packages/docs/development/contributing.md` from `docs/developments.md`

- [ ] **Step 1: Read plugin and development source docs**

Run:

```bash
sed -n '1,280p' docs/plugin-development.md
sed -n '281,620p' docs/plugin-development.md
sed -n '621,920p' docs/plugin-development.md
sed -n '1,180p' packages/channel-feishu/README.md
sed -n '1,120p' packages/channel-yuanbao/README.md
sed -n '1,240p' docs/code-wiki.md
sed -n '241,460p' docs/code-wiki.md
sed -n '1,180p' docs/commands-module.md
sed -n '1,220p' docs/daemon-module.md
sed -n '1,260p' docs/developments.md
sed -n '261,560p' docs/developments.md
```

Expected: output contains plugin API, package README, code wiki, module, and contributing content.

- [ ] **Step 2: Write `packages/docs/plugins/development.md`**

Create an English page with these headings:

```md
# Channel Plugin Development

## Overview

## Package shape

## Plugin manifest and exports

## Channel lifecycle

## Inbound messages

## Replies and media

## Configuration

## Testing a plugin

## Publishing a plugin
```

Content requirements:

- Preserve plugin API contracts and examples from `docs/plugin-development.md`.
- Use current package naming: `xacpx/plugin-api` and `@ganglion/xacpx-channel-*`.

- [ ] **Step 3: Write `packages/docs/plugins/feishu.md`**

Create an English page with these headings:

```md
# Feishu Channel

## Overview

## Install

## Required app credentials

## Reply rendering modes

## Streaming cards

## Tool call rendering

## Cancellation

## Background execution semantics

## Permissions and fallback behavior

## Configuration examples
```

Content requirements:

- Update old `weacpx` package names from the source README to `@ganglion/xacpx-channel-feishu` and `xacpx` CLI commands.
- Preserve reply mode, streaming card, cancellation, and background execution semantics.

- [ ] **Step 4: Write `packages/docs/plugins/yuanbao.md`**

Create an English page with these headings:

```md
# Yuanbao Channel

## Overview

## Install

## Required options

## Compatibility with existing configs

## Real-time session switching

## Background execution semantics
```

Content requirements:

- Update old `weacpx` package names from the source README to `@ganglion/xacpx-channel-yuanbao` and `xacpx` CLI commands.
- Preserve Yuanbao A-semantics for background execution.

- [ ] **Step 5: Write `packages/docs/development/code-wiki.md`**

Create an English page with these headings:

```md
# Code Wiki

## Mental model

## Entry points

## Command routing

## Session model

## Transport layer

## Channels

## Daemon subsystem

## Bridge subsystem

## Configuration and state
```

Content requirements:

- Preserve architecture navigation from `docs/code-wiki.md`.
- Use repository-relative links only when the target remains useful from GitHub. Use VitePress internal links for pages in this docs site.

- [ ] **Step 6: Write `packages/docs/development/commands-module.md`**

Create an English page with these headings:

```md
# Commands Module

## Module goal

## Responsibilities

## Parser boundary

## Router boundary

## Handler conventions

## Testing notes
```

Content requirements:

- Preserve module guidance from `docs/commands-module.md`.

- [ ] **Step 7: Write `packages/docs/development/daemon-module.md`**

Create an English page with these headings:

```md
# Daemon Module

## Module goal

## Runtime files

## Start lifecycle

## Status lifecycle

## Stop lifecycle

## Testing notes
```

Content requirements:

- Preserve daemon subsystem guidance from `docs/daemon-module.md`.

- [ ] **Step 8: Write `packages/docs/development/contributing.md`**

Create an English page with these headings:

```md
# Contributing and Development

## Development setup

## Build commands

## Test commands

## Repository layout

## Package management

## Release and publishing notes

## Documentation conventions
```

Content requirements:

- Preserve relevant development commands from `docs/developments.md` and `AGENTS.md`.
- Use Bun as the primary development package manager.

- [ ] **Step 9: Build docs after plugin/development migration**

Run:

```bash
bun run docs:build
```

Expected: PASS. All sidebar target pages now exist.

- [ ] **Step 10: Commit plugin and development migration**

Run:

```bash
git add packages/docs/plugins packages/docs/development
git commit -m "docs: migrate plugin and development pages"
```

Expected: commit succeeds.

---

## Task 6: Add GitHub Pages deployment workflow

**Files:**
- Create: `.github/workflows/docs.yml`

- [ ] **Step 1: Inspect existing workflows**

Run:

```bash
find .github/workflows -maxdepth 1 -type f -print -exec sed -n '1,220p' {} \;
```

Expected: output shows existing workflow naming and package-manager patterns, or reports no existing workflows.

- [ ] **Step 2: Create `.github/workflows/docs.yml`**

Create `.github/workflows/docs.yml` with this content:

```yaml
name: Deploy VitePress docs to Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build docs
        run: bun run docs:build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: packages/docs/.vitepress/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Build docs locally before committing workflow**

Run:

```bash
bun run docs:build
```

Expected: PASS and `packages/docs/.vitepress/dist/index.html` exists.

- [ ] **Step 4: Commit workflow**

Run:

```bash
git add .github/workflows/docs.yml
git commit -m "ci: deploy docs to GitHub Pages"
```

Expected: commit succeeds.

---

## Task 7: Brand, link, and public-doc quality pass

**Files:**
- Modify: `packages/docs/**/*.md`
- Modify: `packages/docs/.vitepress/config.ts` if navigation labels or links need final adjustment

- [ ] **Step 1: Search for old public brand residue**

Run:

```bash
grep -RIn "weacpx\|Weacpx\|WEACPX" packages/docs || true
```

Expected: no matches, or matches only in explicit legacy compatibility notes.

- [ ] **Step 2: Fix unintended old brand matches**

For each unintended match from Step 1, edit the file so public prose and commands use `xacpx`. Keep old names only in compatibility notes that explain legacy behavior.

- [ ] **Step 3: Search for Chinese characters in public docs**

Run:

```bash
python3 - <<'INNERPY'
from pathlib import Path
for p in Path('packages/docs').rglob('*.md'):
    text = p.read_text(encoding='utf-8')
    hits = [(i + 1, line) for i, line in enumerate(text.splitlines()) if any('\u4e00' <= ch <= '\u9fff' for ch in line)]
    if hits:
        print(p)
        for line_no, line in hits[:20]:
            print(f'  {line_no}: {line[:160]}')
INNERPY
```

Expected: no output. If output appears, translate those lines to English unless the Chinese text is an intentional literal example.

- [ ] **Step 4: Search for unresolved relative links to moved docs**

Run:

```bash
grep -RIn "docs/\|README.md\|\.\.\/" packages/docs || true
```

Expected: no broken source-repository doc links in public content. Links to source files in GitHub are acceptable when they use full GitHub URLs or VitePress-safe paths.

- [ ] **Step 5: Build docs with final content**

Run:

```bash
bun run docs:build
```

Expected: PASS.

- [ ] **Step 6: Preview smoke check**

Run:

```bash
bun run docs:preview -- --host 127.0.0.1
```

Expected: command starts a local preview server and prints a local URL. Stop it with Ctrl-C after confirming startup.

- [ ] **Step 7: Commit quality pass**

Run:

```bash
git add packages/docs
git commit -m "docs: polish public documentation site"
```

Expected: commit succeeds if there were changes. If there were no changes after the quality pass, skip this commit and record that no cleanup was needed.

---

## Task 8: Final verification and handoff

**Files:**
- Read: `git status`
- Read: `packages/docs/.vitepress/dist/index.html`

- [ ] **Step 1: Run final docs build**

Run:

```bash
bun run docs:build
```

Expected: PASS.

- [ ] **Step 2: Confirm generated output exists**

Run:

```bash
test -f packages/docs/.vitepress/dist/index.html && echo "docs output exists"
```

Expected output:

```text
docs output exists
```

- [ ] **Step 3: Check working tree status**

Run:

```bash
git status --short
```

Expected: no uncommitted files from this docs implementation, except pre-existing unrelated untracked internal docs that were present before this plan.

- [ ] **Step 4: Summarize verification**

Prepare a final handoff that includes:

```text
Implemented:
- VitePress docs package at packages/docs
- English product-first docs migration
- GitHub Pages workflow at .github/workflows/docs.yml

Verified:
- bun run docs:build
- packages/docs/.vitepress/dist/index.html exists

Notes:
- GitHub Pages settings must use GitHub Actions as the Pages source.
- Site base is /xacpx/ for https://gadzan.github.io/xacpx/.
```

- [ ] **Step 5: Final commit if needed**

If Task 8 found any missed tracked changes, commit them with:

```bash
git add packages/docs package.json bun.lock .gitignore .github/workflows/docs.yml
git commit -m "docs: finalize VitePress documentation site"
```

Expected: commit succeeds only if there are tracked changes from this implementation.

---

## Self-review

### Spec coverage

- Private `packages/docs` workspace: Task 1.
- VitePress 1.6.4 and `/xacpx/` base: Task 1.
- Product-first information architecture: Tasks 1 through 5.
- English migration of formal docs: Tasks 2 through 5 and Task 7.
- Root docs scripts: Task 1.
- GitHub Pages workflow: Task 6.
- Generated artifact ignores: Task 1.
- Build verification: Tasks 1 through 8.

### Red-flag scan

The plan contains no unresolved-marker strings and no intentionally blank implementation sections. Translation tasks specify exact source files, target files, headings, naming rules, and verification commands.

### Type and command consistency

The docs scripts consistently use `bun run --cwd packages/docs`. The VitePress sidebar links match the target Markdown files listed in the file structure. GitHub Pages upload path matches VitePress default output under the docs package root.
