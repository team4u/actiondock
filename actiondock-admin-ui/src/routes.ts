export const ROUTES = {
  DISCOVER: "/discover",
  INSTALLED: "/installed",
  MY_TOOLS: "/my-tools",
  REPOSITORIES: "/repositories",
  SCRIPTS: "/scripts",
  SCRIPT_NEW: "/scripts/new",
  SCRIPT_DETAIL: "/scripts/:id",
  SCRIPT_RUN: "/run/:id",
  SCHEDULES: "/schedules",
  SCHEDULE_NEW: "/schedules/new",
  SCHEDULE_DETAIL: "/schedules/:id",
  PLUGINS: "/plugins",
  PLUGIN_DETAIL: "/plugins/:pluginId",
  CONFIG_VALUES: "/config-values"
} as const;
