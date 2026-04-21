import { MenuOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  ConfigProvider,
  Drawer,
  Grid,
  Input,
  Layout,
  Menu,
  Modal,
  Space,
  Spin,
  theme,
  Typography
} from "antd";
import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { getApiKey, onAuthRequired, setApiKey } from "./auth";

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

function AdminShell({
  colorMode,
  onOpenApiKeyModal
}: {
  colorMode: ColorMode;
  onOpenApiKeyModal: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const isDark = colorMode === "dark";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
        selectedKeys={[location.pathname.startsWith("/scripts") ? "scripts" : ""]}
        items={[
          {
            key: "scripts",
            label: "脚本管理",
            onClick: () => navigate("/scripts")
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
                脚本管理
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
              <Route path="/scripts" element={<ScriptListPage onOpenApiKeyModal={onOpenApiKeyModal} />} />
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
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [authModalOpen, setAuthModalOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = colorMode;
  }, [colorMode]);

  useEffect(
    () =>
      onAuthRequired(() => {
        setApiKeyState(getApiKey());
        setAuthModalOpen(true);
      }),
    []
  );

  const openAuthModal = () => {
    setApiKeyState(getApiKey());
    setAuthModalOpen(true);
  };

  const saveApiKey = () => {
    setApiKey(apiKey);
    setAuthModalOpen(false);
  };

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
            <Route
              path="/run/:id"
              element={<ScriptRunPage colorMode={colorMode} onOpenApiKeyModal={openAuthModal} />}
            />
            <Route
              path="/*"
              element={<AdminShell colorMode={colorMode} onOpenApiKeyModal={openAuthModal} />}
            />
          </Routes>
        </Suspense>
        <Modal
          title="设置 API Key"
          open={authModalOpen}
          onCancel={() => setAuthModalOpen(false)}
          onOk={saveApiKey}
          okText="保存"
        >
          <Space direction="vertical" style={{ width: "100%" }}>
            <Text type="secondary">如果服务端启用了 `app.auth.api-keys`，这里填入 Bearer Token。</Text>
            <Input.Password
              placeholder="输入 API Key"
              value={apiKey}
              onChange={(event) => setApiKeyState(event.target.value)}
            />
          </Space>
        </Modal>
      </AntdApp>
    </ConfigProvider>
  );
}
