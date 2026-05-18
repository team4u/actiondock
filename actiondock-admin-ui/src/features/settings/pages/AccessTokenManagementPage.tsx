import {
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import {
  createAccessToken,
  deleteAccessToken,
  disableAccessToken,
  enableAccessToken,
  listAccessTokens,
  updateAccessToken
} from "../../settings/api";
import { setApiKey } from "../../../shared/auth/auth";
import { ConfirmDangerAction } from "../../../components/common/ConfirmDangerAction";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import { useCopyMessage } from "../../../shared/hooks/useCopyMessage";
import { ApiError } from "../../../shared/api/httpClient";
import type { AccessToken, AccessTokenRequest } from "../../../shared/types";
import { formatDateTime, getErrorMessage } from "../../../services/utils";

const { Paragraph, Text } = Typography;

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; id: string };

interface AccessTokenManagementPageProps {
  embedded?: boolean;
}

export function AccessTokenManagementPage({ embedded = false }: AccessTokenManagementPageProps) {
  const [form] = Form.useForm<AccessTokenRequest>();
  const [items, setItems] = useState<AccessToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [operatingId, setOperatingId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const handleCopy = useCopyMessage(messageApi);

  const loadData = async () => {
    setLoading(true);
    try {
      setItems(await listAccessTokens());
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载访问令牌失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const upsertItem = (nextItem: AccessToken) => {
    setItems((previous) => {
      const hasExisting = previous.some((item) => item.id === nextItem.id);
      const next = hasExisting
        ? previous.map((item) => (item.id === nextItem.id ? nextItem : item))
        : [...previous, nextItem];
      return [...next].sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));
    });
  };

  const openCreate = () => {
    form.setFieldsValue({ name: "" });
    setEditorState({ mode: "create" });
  };

  const openEdit = (item: AccessToken) => {
    form.setFieldsValue({ name: item.name });
    setEditorState({ mode: "edit", id: item.id });
  };

  const closeEditor = () => {
    setEditorState(null);
    form.resetFields();
  };

  const showCreatedToken = (item: AccessToken) => {
    if (!item.tokenValue) {
      return;
    }
    modal.info({
      title: "访问令牌已创建",
      width: 680,
      okText: "关闭",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>完整令牌只会展示这一次。</Text>
          <Paragraph style={{ marginBottom: 0 }}>
            <Text code>{item.tokenValue}</Text>
          </Paragraph>
          <Space wrap>
            <Button size="small" icon={<CopyOutlined />} onClick={() => void handleCopy(item.tokenValue!)}>
              复制
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                setApiKey(item.tokenValue!);
                messageApi.success("已设为当前浏览器 Bearer Token");
              }}
            >
              设为当前浏览器 Bearer Token
            </Button>
          </Space>
        </Space>
      )
    });
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: AccessTokenRequest = { name: values.name.trim() };
      const saved = editorState?.mode === "edit" && editorState.id
        ? await updateAccessToken(editorState.id, payload)
        : await createAccessToken(payload);
      upsertItem(saved);
      closeEditor();
      if (editorState?.mode === "create") {
        showCreatedToken(saved);
      }
      messageApi.success(editorState?.mode === "edit" ? "访问令牌已更新" : "访问令牌已创建");
    } catch (error) {
      if (error instanceof ApiError) {
        messageApi.error(error.message);
      } else if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      } else {
        messageApi.error(getErrorMessage(error, "保存访问令牌失败"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (item: AccessToken) => {
    setOperatingId(item.id);
    try {
      const saved = item.enabled
        ? await disableAccessToken(item.id)
        : await enableAccessToken(item.id);
      upsertItem(saved);
      messageApi.success(item.enabled ? "访问令牌已停用" : "访问令牌已启用");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "切换访问令牌状态失败"));
    } finally {
      setOperatingId(null);
    }
  };

  const columns: ColumnsType<AccessToken> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      render: (value: string, record) => <TableLinkCell onClick={() => openEdit(record)}>{value}</TableLinkCell>
    },
    {
      title: "令牌预览",
      dataIndex: "tokenPreview",
      key: "tokenPreview",
      render: (value: string) => <Text code>{value}</Text>
    },
    {
      title: "状态",
      dataIndex: "enabled",
      key: "enabled",
      width: 120,
      render: (value: boolean) => <Tag color={value ? "blue" : "default"}>{value ? "启用中" : "已停用"}</Tag>
    },
    {
      title: "最近使用",
      dataIndex: "lastUsedAt",
      key: "lastUsedAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_: unknown, record) => (
        <Space wrap>
          <Button size="small" loading={operatingId === record.id} onClick={() => void handleToggleEnabled(record)}>
            {record.enabled ? "停用" : "启用"}
          </Button>
          <ConfirmDangerAction
            title="确认删除这个访问令牌？"
            description="删除后，持有该令牌的客户端会立即认证失败。"
            onConfirm={async () => {
              setOperatingId(record.id);
              try {
                await deleteAccessToken(record.id);
                setItems((previous) => previous.filter((item) => item.id !== record.id));
                messageApi.success("访问令牌已删除");
              } catch (error) {
                messageApi.error(getErrorMessage(error, "删除访问令牌失败"));
              } finally {
                setOperatingId(null);
              }
            }}
            loading={operatingId === record.id}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </ConfirmDangerAction>
        </Space>
      )
    }
  ];

  const cardExtra = (
    <Space wrap>
      <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
        刷新
      </Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
        新建访问令牌
      </Button>
    </Space>
  );

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {!embedded ? (
          <PageHeader
            title="访问令牌"
            meta="管理服务端 Bearer Token。新建后完整令牌只会展示一次。"
            actions={cardExtra}
          />
        ) : null}
        <Card title={embedded ? "访问令牌" : undefined} extra={embedded ? cardExtra : undefined}>
          {items.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有访问令牌" />
          ) : (
            <Table
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={items}
              pagination={{ pageSize: 10, responsive: true }}
              scroll={{ x: 960 }}
            />
          )}
        </Card>
      </Space>

      <Drawer
        title={editorState?.mode === "edit" ? "编辑访问令牌" : "新建访问令牌"}
        width={420}
        open={Boolean(editorState)}
        onClose={closeEditor}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={closeEditor}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSubmit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: "请输入访问令牌名称" }]}
            extra="用于区分不同客户端或环境，例如“本地测试客户端”或“测试环境管理台”。"
          >
            <Input placeholder="本地测试客户端" />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
