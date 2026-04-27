import { MenuOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  ConfigProvider,
  Drawer,
  Grid,
  Layout,
  Menu,
  Spin,
  theme,
  Typography
} from "antd";
import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { onAuthRequired } from "./auth";
import { ColorModeContext, type ColorMode, useColorMode } from "./contexts/ColorModeContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  buildSystemSettingsSearch,
  isSystemSettingsRoute
} from "./settingsRouting";

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;
const { useBreakpoint } = Grid;
const RepositoryDiscoveryPage = lazy(() =>
  import("./pages/RepositoryDiscoveryPage").then((module) => ({ default: module.RepositoryDiscoveryPage }))
);
const ToolLibraryPage = lazy(() =>
  import("./pages/ToolLibraryPage").then((module) => ({ default: module.ToolLibraryPage }))
);
const RepositoryManagementPage = lazy(() =>
  import("./pages/RepositoryManagementPage").then((module) => ({ default: module.RepositoryManagementPage }))
);
const ScriptEditorPage = lazy(() =>
  import("./pages/ScriptEditorPage").then((module) => ({ default: module.ScriptEditorPage }))
);
const ScriptRunPage = lazy(() =>
  import("./pages/ScriptRunPage").then((module) => ({ default: module.ScriptRunPage }))
);
const PluginManagementPage = lazy(() =>
  import("./pages/PluginManagementPage").then((module) => ({ default: module.PluginManagementPage }))
);
const PluginDetailPage = lazy(() =>
  import("./pages/PluginDetailPage").then((module) => ({ default: module.PluginDetailPage }))
);
const ScheduleManagementPage = lazy(() =>
  import("./pages/ScheduleManagementPage").then((module) => ({ default: module.ScheduleManagementPage }))
);
const ScheduleEditorPage = lazy(() =>
  import("./pages/ScheduleEditorPage").then((module) => ({ default: module.ScheduleEditorPage }))
);
const SystemSettingsPage = lazy(() =>
  import("./pages/SystemSettingsPage").then((module) => ({ default: module.SystemSettingsPage }))
);
const AiOverviewPage = lazy(() =>
  import("./pages/ai/AiOverviewPage").then((module) => ({ default: module.AiOverviewPage }))
);
const AiModelProfileListPage = lazy(() =>
  import("./pages/ai/AiModelProfileListPage").then((module) => ({ default: module.AiModelProfileListPage }))
);
const AiAgentProfileListPage = lazy(() =>
  import("./pages/ai/AiAgentProfileListPage").then((module) => ({ default: module.AiAgentProfileListPage }))
);
const AiToolsetListPage = lazy(() =>
  import("./pages/ai/AiToolsetListPage").then((module) => ({ default: module.AiToolsetListPage }))
);
const AiToolsetDetailPage = lazy(() =>
  import("./pages/ai/AiToolsetDetailPage").then((module) => ({ default: module.AiToolsetDetailPage }))
);
const AiRunListPage = lazy(() =>
  import("./pages/ai/AiRunListPage").then((module) => ({ default: module.AiRunListPage }))
);
const AiRunDetailPage = lazy(() =>
  import("./pages/ai/AiRunDetailPage").then((module) => ({ default: module.AiRunDetailPage }))
);
const AiModelProfileDetailPage = lazy(() =>
  import("./pages/ai/AiProfileDetailPage").then((module) => ({ default: module.AiModelProfileDetailPage }))
);
const AiAgentProfileDetailPage = lazy(() =>
  import("./pages/ai/AiProfileDetailPage").then((module) => ({ default: module.AiAgentProfileDetailPage }))
);

function getSystemColorMode(): ColorMode {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useSystemColorMode(): ColorMode {
  const [colorMode, setColorMode] = useState<ColorMode>(getSystemColorMode);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setColorMode(event.matches ? "dark" : "light");
    };

    setColorMode(mediaQuery.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return colorMode;
}

function resolveSelectedNavKey(pathname: string): string {
  if (pathname.startsWith("/plugins")) {
    return "plugins";
  }
  if (pathname.startsWith("/schedules")) {
    return "schedules";
  }
  if (pathname.startsWith("/settings")) {
    return "settings";
  }
  if (pathname.startsWith("/ai")) {
    return "ai";
  }
  if (pathname.startsWith("/repositories")) {
    return "repositories";
  }
  if (pathname.startsWith("/discover")) {
    return "discover";
  }
  if (pathname.startsWith("/tools") || pathname.startsWith("/scripts")) {
    return "tools";
  }
  return "";
}

function resolveTitle(selectedNavKey: string): string {
  switch (selectedNavKey) {
    case "discover":
      return "发现工具";
    case "tools":
      return "工具库";
    case "repositories":
      return "工具仓库";
    case "plugins":
      return "插件管理";
    case "settings":
      return "系统配置";
    case "ai":
      return "AI 能力";
    case "schedules":
      return "定时任务";
    default:
      return "工具库";
  }
}

function AdminShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const colorMode = useColorMode();
  const isDark = colorMode === "dark";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const selectedNavKey = resolveSelectedNavKey(location.pathname);
  const title = resolveTitle(selectedNavKey);

  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  const navigationMenu = (
    <div className="app-navigation">
      <div className="brand-block">
        <Title level={4}>ActionDock</Title>
        <Text type="secondary">脚本即工具，协议即接入</Text>
      </div>
      <Menu
        mode="inline"
        theme={isDark ? "dark" : "light"}
        selectedKeys={[selectedNavKey]}
        items={[
          {
            key: "discover",
            label: "发现工具",
            onClick: () => navigate("/discover")
          },
          {
            key: "tools",
            label: "工具库",
            onClick: () => navigate("/tools")
          },
          {
            key: "repositories",
            label: "仓库管理",
            onClick: () => navigate("/repositories")
          },
          {
            key: "plugins",
            label: "插件管理",
            onClick: () => navigate("/plugins")
          },
          {
            key: "schedules",
            label: "定时任务",
            onClick: () => navigate("/schedules")
          },
          {
            key: "ai",
            label: "AI 能力",
            onClick: () => navigate("/ai")
          },
          {
            key: "settings",
            label: "系统配置",
            onClick: () => navigate(`/settings${buildSystemSettingsSearch("config-values")}`)
          }
        ]}
      />
    </div>
  );

  return (
    <Layout className="app-shell">
      {!isMobile ? (
        <Sider width={220} theme={isDark ? "dark" : "light"} className="app-sider">
          {navigationMenu}
        </Sider>
      ) : null}
      <Layout>
        <Header className="app-header">
          <div className="app-header__main">
            {isMobile ? (
              <Button
                className="mobile-nav-trigger"
                icon={<MenuOutlined />}
                onClick={() => setMobileNavOpen(true)}
              />
            ) : null}
            <div className="app-header__title">
              <Title level={5} style={{ margin: 0 }}>{title}</Title>
            </div>
          </div>
        </Header>
        <Content className="app-content">
          <Suspense
            fallback={
              <div className="page-loading">
                <Spin size="large" />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Navigate to="/discover" replace />} />
              <Route path="/discover" element={<RepositoryDiscoveryPage />} />
              <Route path="/tools" element={<ToolLibraryPage />} />
              <Route path="/repositories" element={<RepositoryManagementPage />} />
              <Route path="/scripts" element={<Navigate to="/tools" replace />} />
              <Route path="/schedules" element={<ScheduleManagementPage />} />
              <Route path="/schedules/new" element={<ScheduleEditorPage mode="create" colorMode={colorMode} />} />
              <Route path="/schedules/:id" element={<ScheduleEditorPage mode="edit" colorMode={colorMode} />} />
              <Route path="/plugins" element={<PluginManagementPage />} />
              <Route path="/ai" element={<AiOverviewPage />} />
              <Route path="/ai/models" element={<AiModelProfileListPage />} />
              <Route path="/ai/models/new" element={<AiModelProfileDetailPage />} />
              <Route path="/ai/models/:id" element={<AiModelProfileDetailPage />} />
              <Route path="/ai/agents" element={<AiAgentProfileListPage />} />
              <Route path="/ai/agents/new" element={<AiAgentProfileDetailPage />} />
              <Route path="/ai/agents/:id" element={<AiAgentProfileDetailPage />} />
              <Route path="/ai/toolsets" element={<AiToolsetListPage />} />
              <Route path="/ai/toolsets/new" element={<AiToolsetDetailPage />} />
              <Route path="/ai/toolsets/:id" element={<AiToolsetDetailPage />} />
              <Route path="/ai/runs" element={<AiRunListPage />} />
              <Route path="/ai/runs/:runId" element={<AiRunDetailPage />} />
              <Route path="/settings" element={<SystemSettingsPage />} />
              <Route
                path="/plugins/:pluginId"
                element={<PluginDetailPage />}
              />
              <Route
                path="/scripts/new"
                element={<ScriptEditorPage mode="create" colorMode={colorMode} />}
              />
              <Route
                path="/scripts/:id"
                element={<ScriptEditorPage mode="edit" colorMode={colorMode} />}
              />
              <Route path="*" element={<Navigate to="/discover" replace />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
      <Drawer
        className="app-nav-drawer"
        placement="left"
        width={280}
        open={isMobile && mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      >
        {navigationMenu}
      </Drawer>
    </Layout>
  );
}

export function App() {
  const colorMode = useSystemColorMode();
  const isDark = colorMode === "dark";
  const navigate = useNavigate();
  const location = useLocation();
  const accentColor = isDark ? "#8ab4ff" : "#2357d5";
  const primaryColor = isDark ? "#2f6fd6" : "#2357d5";

  useEffect(() => {
    document.documentElement.dataset.theme = colorMode;
  }, [colorMode]);

  useEffect(
    () =>
      onAuthRequired(() => {
        if (isSystemSettingsRoute(location.pathname)) {
          return;
        }

        navigate(`/settings${buildSystemSettingsSearch("console-token")}`, {
          state: {
            from: `${location.pathname}${location.search}${location.hash}`
          }
        });
      }),
    [location.hash, location.pathname, location.search, navigate]
  );

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          borderRadius: 12,
          colorPrimary: primaryColor,
          colorPrimaryHover: isDark ? "#3d7ee6" : "#3a6ee0",
          colorPrimaryActive: isDark ? "#255db5" : "#1f4dbd",
          colorLink: accentColor,
          colorLinkHover: isDark ? "#a8c6ff" : "#3a6ee0",
          colorLinkActive: isDark ? "#7fa9f0" : "#1f4dbd",
          colorBgLayout: isDark ? "#212121" : "#f3f5f8",
          colorBgContainer: isDark ? "#292929" : "#ffffff",
          colorBgElevated: isDark ? "#292929" : "#ffffff",
          colorBorder: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(5, 5, 5, 0.14)",
          colorBorderSecondary: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(5, 5, 5, 0.06)",
          colorFillSecondary: isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)",
          colorFillTertiary: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.04)",
          colorText: isDark ? "#ececec" : "rgba(0, 0, 0, 0.88)",
          colorTextSecondary: isDark ? "#b4b4b4" : "rgba(0, 0, 0, 0.65)",
          colorTextTertiary: isDark ? "#9b9b9b" : "rgba(0, 0, 0, 0.45)",
          fontFamily: "'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', sans-serif",
          fontSize: 13,
          controlHeight: 34,
          controlHeightSM: 28,
          controlHeightLG: 38,
          padding: 12,
          paddingSM: 8,
          paddingLG: 16,
          margin: 12,
          marginSM: 8,
          marginLG: 16
        } as Record<string, unknown>,
        components: {
          Layout: {
            bodyBg: "transparent",
            headerBg: "transparent",
            siderBg: isDark ? "#171717" : "#ffffff"
          },
          Menu: {
            itemBg: "transparent",
            darkItemBg: "#171717",
            darkSubMenuItemBg: "#171717",
            itemHoverBg: isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(35, 87, 213, 0.08)",
            itemSelectedBg: isDark ? "rgba(255, 255, 255, 0.10)" : "rgba(35, 87, 213, 0.12)",
            itemSelectedColor: accentColor,
            darkItemSelectedBg: "rgba(255, 255, 255, 0.10)",
            darkItemSelectedColor: accentColor
          },
          Button: {
            primaryShadow: "none"
          },
          Tabs: {
            inkBarColor: accentColor,
            itemActiveColor: accentColor,
            itemHoverColor: isDark ? "#a8c6ff" : "#3a6ee0",
            itemSelectedColor: accentColor
          }
        }
      }}
    >
      <AntdApp>
        <ErrorBoundary>
          <ColorModeContext.Provider value={colorMode}>
          <Suspense
            fallback={
              <div className="page-loading">
                <Spin size="large" />
              </div>
            }
          >
            <Routes>
              <Route path="/run/:id" element={<ScriptRunPage />} />
              <Route path="/*" element={<AdminShell />} />
            </Routes>
          </Suspense>
        </ColorModeContext.Provider>
        </ErrorBoundary>
      </AntdApp>
    </ConfigProvider>
  );
}
