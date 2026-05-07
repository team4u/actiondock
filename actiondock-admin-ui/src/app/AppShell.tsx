import { MenuOutlined } from "@ant-design/icons";
import { Button, Drawer, Grid, Layout, Menu, Spin, Typography } from "antd";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { ColorMode } from "../shared/contexts/ColorModeContext";
import { appNavItems, resolveSelectedMenuKey, resolveSelectedNavKey, resolveTitle } from "./navRegistry";
import { createAppRouteEntries } from "./routeRegistry";

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

export function AppShell({ colorMode }: { colorMode: ColorMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  const isDark = colorMode === "dark";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>(
    () => appNavItems.filter((item) => item.children.length > 0).map((item) => item.key)
  );
  const selectedNavKey = resolveSelectedNavKey(location.pathname);
  const selectedMenuKey = resolveSelectedMenuKey(location.pathname);
  const title = resolveTitle(location.pathname, selectedNavKey);
  const routeEntries = useMemo(() => createAppRouteEntries(colorMode), [colorMode]);
  const navPathMap = useMemo(() => {
    const next = new Map<string, string>();
    for (const item of appNavItems) {
      next.set(item.key, item.getPath(colorMode));
      for (const child of item.children) {
        next.set(child.key, child.path);
      }
    }
    return next;
  }, [colorMode]);

  useEffect(() => setMobileNavOpen(false), [location.pathname]);
  useEffect(() => {
    setOpenKeys(appNavItems.filter((item) => item.children.length > 0).map((item) => item.key));
  }, []);

  const navigationMenu = (
    <div className="app-navigation">
      <div className="brand-block">
        <Title level={4}>ActionDock</Title>
        <Text type="secondary">脚本即能力，协议即接入</Text>
      </div>
      <Menu
        mode="inline"
        theme={isDark ? "dark" : "light"}
        selectedKeys={[selectedMenuKey]}
        openKeys={openKeys}
        onOpenChange={(keys) => setOpenKeys(keys.map((key) => String(key)))}
        onClick={({ key }) => {
          const path = navPathMap.get(String(key));
          if (path) {
            navigate(path);
          }
        }}
        items={appNavItems.map((item) => ({
          key: item.key,
          label: item.label,
          children: item.children.length > 0
            ? item.children.map((child) => ({
                key: child.key,
                label: child.label
              }))
            : undefined
        }))}
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
              <Button className="mobile-nav-trigger" icon={<MenuOutlined />} onClick={() => setMobileNavOpen(true)} />
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
              {routeEntries.map((route) => (
                <Route key={route.path} path={route.path} element={route.element} />
              ))}
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
