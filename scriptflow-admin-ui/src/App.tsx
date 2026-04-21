import { KeyOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  ConfigProvider,
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
const ScriptListPage = lazy(() =>
  import("./pages/ScriptListPage").then((module) => ({ default: module.ScriptListPage }))
);
const ScriptEditorPage = lazy(() =>
  import("./pages/ScriptEditorPage").then((module) => ({ default: module.ScriptEditorPage }))
);

function AdminShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => onAuthRequired(() => setModalOpen(true)), []);

  const saveApiKey = () => {
    setApiKey(apiKey);
    setModalOpen(false);
  };

  return (
    <Layout className="app-shell">
      <Sider width={220} theme="light" className="app-sider">
        <div className="brand-block">
          <Text className="brand-kicker">Runtime Console</Text>
          <Title level={4}>Scriptflow</Title>
          <Text type="secondary">脚本管理控制台</Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname.startsWith("/scripts") ? "scripts" : ""]}
          items={[
            {
              key: "scripts",
              label: "脚本管理",
              onClick: () => navigate("/scripts")
            }
          ]}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <div>
            <Title level={3} style={{ margin: 0 }}>
              脚本管理
            </Title>
            <Text type="secondary">维护 Groovy 脚本定义、结构和发布状态</Text>
          </div>
          <Space>
            <Button icon={<PlusOutlined />} type="primary" onClick={() => navigate("/scripts/new")}>
              新建脚本
            </Button>
            <Button icon={<KeyOutlined />} onClick={() => setModalOpen(true)}>
              API Key
            </Button>
          </Space>
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
              <Route path="/scripts/new" element={<ScriptEditorPage mode="create" />} />
              <Route path="/scripts/:id" element={<ScriptEditorPage mode="edit" />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
      <Modal
        title="设置 API Key"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
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
    </Layout>
  );
}

export function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          borderRadius: 14,
          colorPrimary: "#2357d5",
          colorBgLayout: "#f3f5f8",
          fontFamily: "'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', sans-serif"
        }
      }}
    >
      <AntdApp>
        <AdminShell />
      </AntdApp>
    </ConfigProvider>
  );
}
