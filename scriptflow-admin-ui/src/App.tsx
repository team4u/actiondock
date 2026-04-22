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

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;
const { useBreakpoint } = Grid;
const ScriptListPage = lazy(() =>
  import("./pages/ScriptListPage").then((module) => ({ default: module.ScriptListPage }))
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
const ApiKeyManagementPage = lazy(() =>
  import("./pages/ApiKeyManagementPage").then((module) => ({ default: module.ApiKeyManagementPage }))
);

type ColorMode = "light" | "dark";

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

function AdminShell({ colorMode }: { colorMode: ColorMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const isDark = colorMode === "dark";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const selectedNavKey = location.pathname.startsWith("/plugins")
    ? "plugins"
    : location.pathname.startsWith("/schedules")
      ? "schedules"
      : location.pathname.startsWith("/settings")
        ? "settings"
        : location.pathname.startsWith("/scripts")
          ? "scripts"
          : "";
  const title =
    selectedNavKey === "plugins"
      ? "插件管理"
      : selectedNavKey === "schedules"
        ? "定时任务"
        : selectedNavKey === "settings"
          ? "API Key 管理"
          : "脚本管理";

  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  const navigationMenu = (
    <div className="app-navigation">
      <div className="brand-block">
        <Text className="brand-kicker">Runtime Console</Text>
        <Title level={4}>Scriptflow</Title>
        <Text type="secondary">脚本管理控制台</Text>
      </div>
      <Menu
        mode="inline"
        theme={isDark ? "dark" : "light"}
        selectedKeys={[selectedNavKey]}
        items={[
          {
            key: "scripts",
            label: "脚本管理",
            onClick: () => navigate("/scripts")
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
            key: "settings",
            label: "API Key 管理",
            onClick: () => navigate("/settings/api-key")
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
              <Route path="/" element={<Navigate to="/scripts" replace />} />
              <Route path="/scripts" element={<ScriptListPage />} />
              <Route path="/schedules" element={<ScheduleManagementPage />} />
              <Route path="/schedules/new" element={<ScheduleEditorPage colorMode={colorMode} mode="create" />} />
              <Route path="/schedules/:id" element={<ScheduleEditorPage colorMode={colorMode} mode="edit" />} />
              <Route path="/plugins" element={<PluginManagementPage />} />
              <Route
                path="/plugins/:pluginId"
                element={<PluginDetailPage colorMode={colorMode} />}
              />
              <Route path="/settings/api-key" element={<ApiKeyManagementPage />} />
              <Route
                path="/scripts/new"
                element={<ScriptEditorPage colorMode={colorMode} mode="create" />}
              />
              <Route
                path="/scripts/:id"
                element={<ScriptEditorPage colorMode={colorMode} mode="edit" />}
              />
              <Route path="*" element={<Navigate to="/scripts" replace />} />
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

  useEffect(() => {
    document.documentElement.dataset.theme = colorMode;
  }, [colorMode]);

  useEffect(
    () =>
      onAuthRequired(() => {
        if (location.pathname === "/settings/api-key") {
          return;
        }

        navigate("/settings/api-key", {
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
        <Suspense
          fallback={
            <div className="page-loading">
              <Spin size="large" />
            </div>
          }
        >
          <Routes>
            <Route path="/run/:id" element={<ScriptRunPage colorMode={colorMode} />} />
            <Route path="/*" element={<AdminShell colorMode={colorMode} />} />
          </Routes>
        </Suspense>
      </AntdApp>
    </ConfigProvider>
  );
}
