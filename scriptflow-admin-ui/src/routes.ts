export const ROUTES = {
  SCRIPTS: "/scripts",
  SCRIPT_NEW: "/scripts/new",
  SCRIPT_DETAIL: "/scripts/:id",
  SCRIPT_RUN: "/run/:id",
  SCHEDULES: "/schedules",
  SCHEDULE_NEW: "/schedules/new",
  SCHEDULE_DETAIL: "/schedules/:id",
  PLUGINS: "/plugins",
  PLUGIN_DETAIL: "/plugins/:pluginId",
  API_KEY: "/settings/api-key"
} as const;
