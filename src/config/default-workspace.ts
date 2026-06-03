// The single workspace seeded into a brand-new config so first-use users have
// something usable immediately. `~` is expanded to the real home directory at
// config-load time by normalizeWorkspacePath, so it works on any machine and is
// safe to ship verbatim in config.example.json.
//
// isFirstUse treats a config whose only workspace is this default as still
// "first use", so the interactive onboarding prompt (add current dir + initial
// session) keeps firing even though the seed is present.
//
// The description is intentionally a static English string here (it seeds
// config.json at first boot, before the locale is set). The localized form is
// in the misc catalog (t().misc.defaultHomeWorkspaceDescription) for display.
export const DEFAULT_HOME_WORKSPACE_NAME = "home";

export const DEFAULT_HOME_WORKSPACE = {
  cwd: "~",
  description: "home directory",
} as const;
