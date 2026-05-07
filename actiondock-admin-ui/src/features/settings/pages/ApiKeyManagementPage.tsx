import { LockOutlined, RollbackOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Row, Col, Space, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getApiKey, setApiKey } from "../../../shared/auth/auth";

const { Paragraph, Text, Title } = Typography;

interface AuthLocationState {
  from?: string;
}

function readReturnPath(state: unknown): string | null {
  if (!state || typeof state !== "object") {
    return null;
  }

  const locationState = state as AuthLocationState;
  return typeof locationState.from === "string" && locationState.from.trim() ? locationState.from : null;
}

export function ApiKeySettingsPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [messageApi, contextHolder] = message.useMessage();
  const returnPath = useMemo(() => readReturnPath(location.state), [location.state]);
  const hasApiKey = apiKey.trim().length > 0;

  useEffect(() => {
    setApiKeyState(getApiKey());
  }, [location.key]);

  const handleSave = () => {
    setApiKey(apiKey);
    const normalizedValue = getApiKey();
    setApiKeyState(normalizedValue);
    messageApi.success(normalizedValue ? "控制台凭证已保存到当前浏览器" : "控制台凭证已清除");

    if (returnPath && returnPath !== location.pathname) {
      navigate(returnPath, { replace: true });
    }
  };

  const handleClear = () => {
    setApiKey("");
    setApiKeyState("");
    messageApi.success("控制台凭证已清除");
  };

  return (
    <>
      {contextHolder}
      <Space className="script-editor-page" direction="vertical" size={16} style={{ width: "100%" }}>
        <Card>
          <Row className="page-card-header" justify="space-between" align="middle" gutter={[12, 12]}>
            <Col>
              <Space direction="vertical" size={2}>
                {returnPath ? (
                  <Button
                    type="link"
                    icon={<RollbackOutlined />}
                    style={{ paddingInline: 0 }}
                    onClick={() => navigate(returnPath)}
                  >
                    返回
                  </Button>
                ) : null}
                <Title level={4} style={{ margin: 0 }}>
                  控制台凭证
                </Title>
                <Space size={8} wrap>
                  <Tag color={hasApiKey ? "blue" : "default"}>{hasApiKey ? "已配置" : "未配置"}</Tag>
                  <Text type="secondary">当前浏览器访问管理台时会复用这里保存的 Bearer Token。</Text>
                </Space>
              </Space>
            </Col>
            <Col>
              <Space className="page-card-actions" wrap>
                <Button onClick={handleClear}>清除</Button>
                <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
                  保存
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        <Card title="凭证设置">
          <Form layout="vertical">
            <Form.Item
              label="Bearer Token"
              extra={
                <Space direction="vertical" size={4}>
                  <Paragraph style={{ marginBottom: 0 }}>
                    管理台请求会自动附带 <Text code>Authorization: Bearer ...</Text> 请求头。
                  </Paragraph>
                  <Text type="secondary">仅保存在当前浏览器的本地存储中，不会回传到服务端，也不会自动创建服务端访问令牌。</Text>
                </Space>
              }
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="输入 Bearer Token"
                value={apiKey}
                onChange={(event) => setApiKeyState(event.target.value)}
              />
            </Form.Item>
          </Form>
        </Card>
      </Space>
    </>
  );
}

export function ApiKeyManagementPage() {
  return <ApiKeySettingsPanel />;
}
