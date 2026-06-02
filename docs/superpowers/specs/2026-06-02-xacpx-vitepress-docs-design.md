# xacpx VitePress Documentation Site Design

## Summary

Add a new private workspace package, `packages/docs`, that hosts an English-first VitePress documentation site for xacpx. The site will be deployed to GitHub Pages at `https://gadzan.github.io/xacpx/` and will use the repository Pages base path `/xacpx/`.

The project has recently been renamed from weacpx to xacpx. Public documentation should consistently use `xacpx` and current package names such as `@ganglion/xacpx` and `@ganglion/xacpx-channel-*`, while only preserving old names where they are necessary for compatibility or historical context.

## Goals

- Add a latest-version VitePress documentation package under `packages/docs`.
- Migrate formal user and developer documentation into the docs package.
- Rewrite migrated documentation in English rather than keeping Chinese body text.
- Organize the site around product usage journeys first, then reference and development material.
- Add root-level scripts for local docs development, build, and preview.
- Add a GitHub Pages workflow that builds and deploys the site automatically on `main` and manually through `workflow_dispatch`.
- Keep internal plans, date-stamped design docs, and superpowers materials out of the public docs sidebar.

## Non-goals

- Do not publish the docs package to npm.
- Do not redesign the main application or channel plugin behavior.
- Do not migrate date-stamped roadmap/design/checklist documents into the public docs navigation.
- Do not require the full application test suite for this docs-only change unless implementation touches runtime code.

## Decisions

### Deployment target

Use repository GitHub Pages:

- Public URL: `https://gadzan.github.io/xacpx/`
- VitePress `base`: `/xacpx/`

This matches the current repository identity after the rename and avoids custom-domain assumptions.

### Package shape

Create:

```text
packages/docs/
  package.json
  index.md
  guide/
  reference/
  plugins/
  development/
  .vitepress/
    config.ts
```

The package will be named `@ganglion/xacpx-docs` and marked `private: true` to prevent accidental npm publishing.

### Content architecture

Use a product-first information architecture:

1. **Home**
   - What xacpx is
   - Installation
   - Quick start
   - Key capabilities
   - Links into guide/reference/plugin docs

2. **Guide**
   - Getting Started
   - Channel Management
   - Native Sessions
   - Scheduled Tasks
   - Testing
   - Group usage if it remains useful as a standalone page

3. **Reference**
   - Command Reference
   - Configuration Reference
   - `/config` Command
   - External MCP Coordinator
   - CLI and daemon concepts where appropriate

4. **Plugins & Development**
   - Channel Plugin Development
   - Feishu Channel
   - Yuanbao Channel
   - Code Wiki
   - Commands module notes
   - Daemon module notes
   - Contributing/development guide

This is preferred over a repository mirror because the public site should help new users understand and use the product before exposing internal file structure.

## Migration scope

### Migrate and translate

The following formal docs should move into `packages/docs` and be rewritten in English:

| Source | Target |
| --- | --- |
| `README.md` | `index.md` plus `guide/getting-started.md` and overview sections |
| `docs/commands.md` | `reference/commands.md` |
| `docs/config-reference.md` | `reference/configuration.md` |
| `docs/config-command.md` | `reference/config-command.md` |
| `docs/channel-management.md` | `guide/channel-management.md` |
| `docs/later-command.md` | `guide/scheduled-tasks.md` |
| `docs/native-sessions.md` | `guide/native-sessions.md` |
| `docs/testing.md` | `guide/testing.md` |
| `docs/plugin-development.md` | `plugins/development.md` |
| `packages/channel-feishu/README.md` | `plugins/feishu.md` |
| `packages/channel-yuanbao/README.md` | `plugins/yuanbao.md` |
| `docs/external-mcp.md` | `reference/external-mcp.md` |
| `docs/code-wiki.md` | `development/code-wiki.md` |
| `docs/commands-module.md` | `development/commands-module.md` |
| `docs/daemon-module.md` | `development/daemon-module.md` |
| `docs/developments.md` | `development/contributing.md` |
| `docs/weacpx-group-usage-guide.md` | `guide/group-usage.md` or folded into related guide content |

### Keep internal

Do not put these in the public sidebar:

- `docs/2026-*.md`
- `docs/*roadmap*.md`
- `docs/*checklist*.md`
- `docs/superpowers/**`

These remain internal project materials. If root `docs/` is later cleaned up, it should keep internal plans and design records, while formal documentation lives in `packages/docs`.

## Translation and editing strategy

- Rewrite as English technical documentation, not as literal sentence-by-sentence translation.
- Preserve command behavior, configuration schema details, examples, and operational caveats.
- Replace public-facing `weacpx` references with `xacpx`.
- Use current package names and commands, for example `@ganglion/xacpx`, `@ganglion/xacpx-channel-feishu`, and `xacpx plugin add ...`.
- Keep compatibility names only when explaining migration or legacy packages.
- Repair Markdown links so they point to VitePress pages.
- Remove or paraphrase internal-only links that are not useful in public docs.
- Keep code blocks and JSON examples, but check them against current package metadata and rename state.

## VitePress configuration

Use VitePress latest as verified for this design session: `vitepress@1.6.4`.

Configure:

- `title: 'xacpx'`
- English description for the remote agent console use case
- `base: '/xacpx/'`
- Default theme
- Top navigation for Guide, Reference, Plugins, Development
- Sidebar sections matching the content architecture
- Local search
- GitHub social link to `https://github.com/gadzan/xacpx`
- Footer text with MIT license/project metadata
- Edit links if source path mapping is stable after migration

## Scripts

Add root scripts:

```json
{
  "docs:dev": "bun run --cwd packages/docs dev",
  "docs:build": "bun run --cwd packages/docs build",
  "docs:preview": "bun run --cwd packages/docs preview"
}
```

Add docs package scripts:

```json
{
  "dev": "vitepress dev .",
  "build": "vitepress build .",
  "preview": "vitepress preview ."
}
```

The exact Bun invocation can be adjusted during implementation if the workspace command shape is more reliable in this repository.

## GitHub Pages workflow

Create `.github/workflows/docs.yml` with:

- `push` on `main`
- `workflow_dispatch`
- `permissions` for Pages deployment
- Bun setup via `oven-sh/setup-bun`
- Dependency install with `bun install --frozen-lockfile`
- Build with `bun run docs:build`
- Upload path: `packages/docs/.vitepress/dist`
- Deploy with official Pages actions

Use Node 24 or a compatible runtime in the action environment. VitePress requires Node 20 or newer.

## Ignored generated files

Add generated docs artifacts to `.gitignore` during implementation:

```gitignore
packages/docs/.vitepress/cache
packages/docs/.vitepress/dist
.superpowers/
```

The `.superpowers/` ignore keeps local visual-brainstorm artifacts out of version control.

## Testing and verification

Minimum verification:

1. Install/update dependencies with Bun and confirm lockfile changes are intentional.
2. Run `bun run docs:build`.
3. Confirm `packages/docs/.vitepress/dist` is produced.
4. If docs scripts or dependencies are adjusted, rerun `bun run docs:build` as final verification.

Do not run the full application test suite by default for this docs-only work. Run it only if implementation touches runtime source code or shared build scripts that could affect the app.

## Risks and mitigations

### Large translation scope

The formal docs are substantial. Mitigate by migrating page by page, preserving factual details and prioritizing clear English technical writing over literal translation.

### Old brand residue

Search migrated docs for `weacpx` and update public-facing references to `xacpx`. Preserve old names only in compatibility notes.

### Broken links

VitePress build and manual navigation checks should catch many issues. Prefer internal site-relative links and remove links to internal-only docs that are not part of the public site.

### GitHub Pages base mismatch

Hard-code `/xacpx/` for repository Pages. If the project later moves to a custom domain, update the VitePress `base` setting.

### Workflow/package-manager mismatch

Use Bun consistently because the repository uses Bun for development scripts and has `bun.lock`.

## Acceptance criteria

- `packages/docs` exists as a private VitePress docs package.
- Root docs scripts can run the site locally, build it, and preview it.
- GitHub Pages workflow builds and deploys the docs site from `packages/docs/.vitepress/dist`.
- Formal documentation is migrated into the docs package and rewritten in English.
- Public docs use `xacpx` naming consistently.
- Internal design, roadmap, checklist, and superpowers docs are excluded from public navigation.
- `bun run docs:build` completes successfully.
