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
import { ColorModeContext, type ColorMode, useColorMode } from "./contexts/ColorModeContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;
const { useBreakpoint } = Grid;
const RepositoryDiscoveryPage = lazy(() =>
  import("./pages/RepositoryDiscoveryPage").then((module) => ({ default: module.RepositoryDiscoveryPage }))
);
const InstalledToolsPage = lazy(() =>
  import("./pages/InstalledToolsPage").then((module) => ({ default: module.InstalledToolsPage }))
);
const MyToolsPage = lazy(() =>
  import("./pages/MyToolsPage").then((module) => ({ default: module.MyToolsPage }))
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
const ConfigValueManagementPage = lazy(() =>
  import("./pages/ConfigValueManagementPage").then((module) => ({ default: module.ConfigValueManagementPage }))
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

function AdminShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const colorMode = useColorMode();
  const isDark = colorMode === "dark";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const selectedNavKey = location.pathname.startsWith("/plugins")
    ? "plugins"
    : location.pathname.startsWith("/schedules")
      ? "schedules"
      : location.pathname.startsWith("/config-values")
        ? "config-values"
        : location.pathname.startsWith("/repositories")
          ? "repositories"
          : location.pathname.startsWith("/installed")
            ? "installed"
            : location.pathname.startsWith("/discover")
              ? "discover"
              : location.pathname.startsWith("/my-tools") || location.pathname.startsWith("/scripts")
                ? "my-tools"
                : "";
  const title =
    selectedNavKey === "discover"
      ? "发现工具"
      : selectedNavKey === "installed"
        ? "已安装工具"
        : selectedNavKey === "repositories"
          ? "工具仓库"
          : selectedNavKey === "plugins"
            ? "插件管理"
      : selectedNavKey === "schedules"
        ? "定时任务"
        : selectedNavKey === "config-values"
          ? "本机配置"
          : "我的工具";

  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  const navigationMenu = (
    <div className="app-navigation">
      <div className="brand-block">
        <Text className="brand-kicker">Local Runner</Text>
        <Title level={4}>ActionDock</Title>
        <Text type="secondary">工具仓库浏览、安装与本机运行</Text>
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
            key: "installed",
            label: "已安装",
            onClick: () => navigate("/installed")
          },
          {
            key: "my-tools",
            label: "我的工具",
            onClick: () => navigate("/my-tools")
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
            key: "config-values",
            label: "本机配置",
            onClick: () => navigate("/config-values")
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
              <Title level={3} style={{ margin: 0 }}>
                {title}
              </Title>
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
              <Route path="/installed" element={<InstalledToolsPage />} />
              <Route path="/my-tools" element={<MyToolsPage />} />
              <Route path="/repositories" element={<RepositoryManagementPage />} />
              <Route path="/scripts" element={<Navigate to="/my-tools" replace />} />
              <Route path="/schedules" element={<ScheduleManagementPage />} />
              <Route path="/schedules/new" element={<ScheduleEditorPage mode="create" colorMode={colorMode} />} />
              <Route path="/schedules/:id" element={<ScheduleEditorPage mode="edit" colorMode={colorMode} />} />
              <Route path="/plugins" element={<PluginManagementPage />} />
              <Route path="/config-values" element={<ConfigValueManagementPage />} />
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

  useEffect(() => {
    document.documentElement.dataset.theme = colorMode;
  }, [colorMode]);

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          borderRadius: 12,
          colorPrimary: "#2357d5",
          colorBgLayout: isDark ? "#0b1220" : "#f3f5f8",
          colorBgContainer: isDark ? "#101a2b" : "#ffffff",
          colorBorderSecondary: isDark ? "rgba(148, 163, 184, 0.18)" : "rgba(5, 5, 5, 0.06)",
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
        },
        components: {
          Layout: {
            bodyBg: "transparent",
            headerBg: "transparent",
            siderBg: isDark ? "#0f1727" : "#ffffff"
          },
          Menu: {
            itemBg: "transparent",
            itemSelectedBg: isDark ? "rgba(35, 87, 213, 0.24)" : "rgba(35, 87, 213, 0.12)",
            itemSelectedColor: isDark ? "#dbe7ff" : "#2357d5"
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
