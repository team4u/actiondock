import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import {
  ApiError,
  createRepository,
  deleteRepository,
  listRepositories,
  syncRepository,
  updateRepository
} from "../api";
import { PageHeader } from "../components/PageHeader";
import { TableLinkCell } from "../components/TableLinkCell";
import type { RepositoryDefinition } from "../types";
import { formatDateTime, getErrorMessage } from "../utils";

const { Text } = Typography;

type EditorMode = "create" | "edit";

interface EditorState {
  mode: EditorMode;
  repositoryId?: string;
}

interface RepositoryFormValues {
  id: string;
  name: string;
  type: RepositoryDefinition["type"];
  url: string;
  branch?: string;
  enabled: boolean;
  trustLevel: RepositoryDefinition["trustLevel"];
  description?: string;
}

function getTypeLabel(type: RepositoryDefinition["type"]): string {
  switch (type) {
    case "LOCAL_DIR":
      return "本地目录";
    case "HTTP":
      return "HTTP";
    default:
      return "Git";
  }
}

function getTrustTag(level: RepositoryDefinition["trustLevel"]) {
  return level === "TRUSTED" ? <Tag color="green">可信</Tag> : <Tag color="gold">未信任</Tag>;
}

export function RepositoryManagementPage() {
  const [form] = Form.useForm<RepositoryFormValues>();
  const repositoryType = Form.useWatch("type", form) ?? "GIT";
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await listRepositories();
      setRepositories(
        [...data].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
      );
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载仓库失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const openCreate = () => {
    form.setFieldsValue({
      id: "",
      name: "",
      type: "GIT",
      url: "",
      branch: "main",
      enabled: true,
      trustLevel: "UNTRUSTED",
      description: ""
    });
    setEditorState({ mode: "create" });
  };

  const openEdit = (item: RepositoryDefinition) => {
    form.setFieldsValue({
      id: item.id,
      name: item.name,
      type: item.type,
      url: item.url,
      branch: item.branch,
      enabled: item.enabled,
      trustLevel: item.trustLevel,
      description: item.description ?? ""
    });
    setEditorState({ mode: "edit", repositoryId: item.id });
  };

  const closeEditor = () => {
    setEditorState(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: RepositoryDefinition = {
        id: values.id.trim(),
        name: values.name.trim(),
        type: values.type,
        url: values.url.trim(),
        branch: values.type === "GIT" ? values.branch?.trim() || "main" : undefined,
        enabled: values.enabled,
        trustLevel: values.trustLevel,
        description: values.description?.trim() || undefined
      };
      const saved = editorState?.mode === "edit" && editorState.repositoryId
        ? await updateRepository(editorState.repositoryId, payload)
        : await createRepository(payload);
      setRepositories((previous) => {
        const next = previous.some((item) => item.id === saved.id)
          ? previous.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...previous];
        return [...next].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
      });
      closeEditor();
      messageApi.success(editorState?.mode === "edit" ? "仓库已更新" : "仓库已创建");
    } catch (error) {
      if (error instanceof ApiError) {
        messageApi.error(error.message);
      } else if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      } else {
        messageApi.error(getErrorMessage(error, "保存仓库失败"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (repositoryId: string) => {
    setSyncingId(repositoryId);
    try {
      const synced = await syncRepository(repositoryId);
      setRepositories((previous) =>
        previous.map((item) => (item.id === synced.id ? synced : item))
      );
      messageApi.success("仓库同步完成");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "同步仓库失败"));
    } finally {
      setSyncingId(null);
    }
  };

  const columns: ColumnsType<RepositoryDefinition> = [
    {
      title: "仓库",
      key: "name",
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Space wrap size={[8, 8]}>
            <TableLinkCell onClick={() => openEdit(record)}>{record.name}</TableLinkCell>
            {record.enabled ? <Tag color="blue">已启用</Tag> : <Tag>已禁用</Tag>}
          </Space>
          <Text type="secondary">{record.description || record.url}</Text>
        </Space>
      )
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 120,
      render: (value: RepositoryDefinition["type"]) => getTypeLabel(value)
    },
    {
      title: "信任",
      dataIndex: "trustLevel",
      key: "trustLevel",
      width: 120,
      render: (value: RepositoryDefinition["trustLevel"]) => getTrustTag(value)
    },
    {
      title: "最近同步",
      dataIndex: "lastSyncedAt",
      key: "lastSyncedAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "操作",
      key: "actions",
      width: 240,
      render: (_value: unknown, record) => (
        <Space wrap size={[4, 4]}>
          <Button
            size="small"
            icon={<SyncOutlined />}
            loading={syncingId === record.id}
            onClick={() => void handleSync(record.id)}
          >
            同步
          </Button>
          <Popconfirm
            title="确认删除这个仓库？"
            description="删除后不会卸载已安装工具，但将无法继续从该仓库同步或发布。"
            okText="删除"
            cancelText="取消"
            onConfirm={async () => {
              setDeletingId(record.id);
              try {
                await deleteRepository(record.id);
                setRepositories((previous) => previous.filter((item) => item.id !== record.id));
                messageApi.success("仓库已删除");
              } catch (error) {
                messageApi.error(getErrorMessage(error, "删除仓库失败"));
              } finally {
                setDeletingId(null);
              }
            }}
          >
            <Button danger size="small" icon={<DeleteOutlined />} loading={deletingId === record.id}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="工具仓库"
          meta={<Text type="secondary">支持 Git、HTTP 与本地目录仓库。本地目录仓库在创建时会自动初始化为空仓库，不需要手工创建 actiondock.repository.json，也不用先点同步。</Text>}
          actions={
            <>
              <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
                刷新
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                添加仓库
              </Button>
            </>
          }
        />

        <Card>
          <Table<RepositoryDefinition>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={repositories}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="还没有配置工具仓库。先添加一个 Git、HTTP 或本地目录仓库。"
                />
              )
            }}
            pagination={{ pageSize: 10, showSizeChanger: true }}
          />
        </Card>
      </Space>

      <Modal
        title={editorState?.mode === "edit" ? "编辑仓库" : "添加仓库"}
        open={Boolean(editorState)}
        onCancel={closeEditor}
        onOk={() => void handleSubmit()}
        okText={editorState?.mode === "edit" ? "保存" : "创建"}
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
        width={640}
      >
        <Form form={form} layout="vertical" initialValues={{ enabled: true, trustLevel: "UNTRUSTED", type: "GIT" }}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Form.Item
              label="仓库 ID"
              name="id"
              rules={[
                { required: true, message: "请输入仓库 ID" },
                { pattern: /^[A-Za-z0-9._-]+$/, message: "仅支持字母、数字、点、中横线和下划线" }
              ]}
            >
              <Input disabled={editorState?.mode === "edit"} placeholder="例如 repo-platform" />
            </Form.Item>

            <Form.Item
              label="名称"
              name="name"
              rules={[{ required: true, message: "请输入仓库名称" }]}
            >
              <Input placeholder="例如 平台组工具仓库" />
            </Form.Item>

            <Space size={12} style={{ width: "100%" }} wrap>
              <Form.Item label="类型" name="type" style={{ flex: "1 1 180px", minWidth: 180 }}>
                <Select
                  options={[
                    { value: "GIT", label: "Git 仓库" },
                    { value: "HTTP", label: "HTTP 静态仓库" },
                    { value: "LOCAL_DIR", label: "本地目录仓库" }
                  ]}
                />
              </Form.Item>
              <Form.Item label="信任级别" name="trustLevel" style={{ flex: "1 1 180px", minWidth: 180 }}>
                <Select
                  options={[
                    { value: "TRUSTED", label: "可信" },
                    { value: "UNTRUSTED", label: "未信任" }
                  ]}
                />
              </Form.Item>
            </Space>

            <Form.Item
              label={repositoryType === "LOCAL_DIR" ? "本地路径" : "地址"}
              name="url"
              rules={[{ required: true, message: "请输入仓库地址或目录路径" }]}
            >
              <Input placeholder={repositoryType === "LOCAL_DIR" ? "/Users/me/actiondock-repo" : "https://example.com/repo.git"} />
            </Form.Item>

            {repositoryType === "LOCAL_DIR" ? (
              <Text type="secondary">保存时会自动创建目录、tools/ 子目录和空的 actiondock.repository.json。</Text>
            ) : null}

            {repositoryType === "GIT" ? (
              <Form.Item label="分支" name="branch">
                <Input placeholder="main" />
              </Form.Item>
            ) : null}

            <Form.Item label="说明" name="description">
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="可选，用于说明仓库用途和来源" />
            </Form.Item>

            <Form.Item label="启用仓库" name="enabled" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
