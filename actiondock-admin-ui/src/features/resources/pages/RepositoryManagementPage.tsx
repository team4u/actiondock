import {
  DeleteOutlined,
  EyeOutlined,
  PlusOutlined,
  ShareAltOutlined,
  ReloadOutlined,
  SyncOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import {
  createRepository,
  deleteRepository,
  listRepositories,
  previewRepositoryKnowledgePublish,
  publishRepositoryKnowledge,
  resolveProjectRepository,
  syncRepository,
  updateRepository
} from "../../resources/api";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import { TrustLevelTag } from "../../../components/domain/TrustLevelTag";
import { ConfirmDangerAction } from "../../../components/common/ConfirmDangerAction";
import { InfoHint } from "../../../components/common/InfoHint";
import { getRepositoryTypeLabel } from "../../../components/domain/typeLabels";
import { suggestRepositoryId } from "../../../services/repositoryId";
import { ApiError } from "../../../shared/api/httpClient";
import type { ProjectRepositoryResolution, RepositoryDefinition, RepositoryPurpose, RepositoryPublishConfigCandidate } from "../../../shared/types";
import { formatDateTime, getErrorMessage } from "../../../services/utils";

const { Text, Paragraph } = Typography;

type EditorMode = "create" | "edit";
type RepositoryTabKey = "CAPABILITY" | "PROJECT";

interface EditorState {
  mode: EditorMode;
  repositoryId?: string;
}

interface RepositoryFormValues {
  id: string;
  name: string;
  type: RepositoryDefinition["type"];
  purpose: RepositoryPurpose;
  url: string;
  branch?: string;
  enabled: boolean;
  trustLevel: RepositoryDefinition["trustLevel"];
  description?: string;
}

export function RepositoryManagementPage() {
  const [form] = Form.useForm<RepositoryFormValues>();
  const repositoryType = Form.useWatch("type", form) ?? "GIT";
  const repositoryPurpose = Form.useWatch("purpose", form) ?? "CAPABILITY";
  const repositoryUrl = Form.useWatch("url", form) ?? "";
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [activeTab, setActiveTab] = useState<RepositoryTabKey>("CAPABILITY");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [resolution, setResolution] = useState<ProjectRepositoryResolution | null>(null);
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const [publishingProject, setPublishingProject] = useState<RepositoryDefinition | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishConfigLoading, setPublishConfigLoading] = useState(false);
  const [publishConfigItems, setPublishConfigItems] = useState<RepositoryPublishConfigCandidate[]>([]);
  const [publishMissingKeys, setPublishMissingKeys] = useState<string[]>([]);
  const [publishConfigModes, setPublishConfigModes] = useState<Record<string, "INLINE" | "PLACEHOLDER">>({});
  const [publishForm] = Form.useForm();

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

  const capabilityRepositories = useMemo(
    () => repositories.filter((item) => (item.purpose ?? "CAPABILITY") === "CAPABILITY"),
    [repositories]
  );
  const projectRepositories = useMemo(
    () => repositories.filter((item) => (item.purpose ?? "CAPABILITY") === "PROJECT"),
    [repositories]
  );

  const openCreate = () => {
    form.setFieldsValue({
      id: "",
      name: "",
      type: "GIT",
      purpose: activeTab,
      url: "",
      branch: "",
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
      type: item.type === "HTTP" ? "GIT" : item.type,
      purpose: item.purpose ?? "CAPABILITY",
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

  useEffect(() => {
    if (editorState?.mode !== "create") {
      return;
    }
    form.setFieldValue("id", suggestRepositoryId(repositoryType, repositoryUrl));
  }, [editorState?.mode, form, repositoryType, repositoryUrl]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: RepositoryDefinition = {
        id: values.id.trim(),
        name: values.name.trim(),
        type: values.type,
        purpose: values.purpose,
        url: values.url.trim(),
        branch: values.type === "GIT" ? values.branch?.trim() || undefined : undefined,
        enabled: values.enabled,
        trustLevel: values.trustLevel,
        description: values.description?.trim() || undefined
      };
      const editingRepositoryId = editorState?.mode === "edit" ? editorState.repositoryId : undefined;
      const saved = editingRepositoryId
        ? await updateRepository(editingRepositoryId, payload)
        : await createRepository(payload);
      const effectiveRepository = editingRepositoryId ? saved : await syncRepository(saved.id);
      setRepositories((previous) => {
        const next = previous.some((item) => item.id === effectiveRepository.id)
          ? previous.map((item) => (item.id === effectiveRepository.id ? effectiveRepository : item))
          : [effectiveRepository, ...previous];
        return [...next].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
      });
      closeEditor();
      messageApi.success(editingRepositoryId ? "仓库已更新" : "仓库已创建并同步");
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

  const handleSyncAll = async () => {
    setLoading(true);
    try {
      const syncedRepositories: RepositoryDefinition[] = [];
      for (const repository of repositories) {
        const synced = await syncRepository(repository.id);
        syncedRepositories.push(synced);
      }
      setRepositories(
        syncedRepositories.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
      );
      messageApi.success("全部仓库同步完成");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "批量同步仓库失败"));
      await loadData();
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (repositoryId: string) => {
    setResolvingId(repositoryId);
    try {
      const resolved = await resolveProjectRepository(repositoryId);
      setResolution(resolved);
      setResolutionOpen(true);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "解析项目知识入口失败"));
    } finally {
      setResolvingId(null);
    }
  };

  const openPublishKnowledge = (projectRepo: RepositoryDefinition) => {
    publishForm.setFieldsValue({
      knowledgeId: projectRepo.id,
      displayName: projectRepo.name,
      description: projectRepo.description || ""
    });
    setPublishConfigItems([]);
    setPublishMissingKeys([]);
    setPublishConfigModes({});
    setPublishingProject(projectRepo);
    setPublishConfigLoading(true);
    void previewRepositoryKnowledgePublish({ projectRepositoryId: projectRepo.id })
      .then((preview) => {
        setPublishConfigItems(preview.items);
        setPublishMissingKeys(preview.missingKeys);
        setPublishConfigModes(Object.fromEntries(
          preview.items.map((item) => [item.key, item.secret ? "PLACEHOLDER" : "PLACEHOLDER"])
        ));
      })
      .catch((error) => {
        setPublishConfigItems([]);
        setPublishMissingKeys([]);
        messageApi.error(getErrorMessage(error, "加载配置依赖失败"));
      })
      .finally(() => setPublishConfigLoading(false));
  };

  const handlePublishKnowledge = async () => {
    if (!publishingProject) return;
    try {
      const values = await publishForm.validateFields();
      if (publishConfigLoading) {
        messageApi.warning("正在分析配置依赖，请稍后再试");
        return;
      }
      if (publishMissingKeys.length > 0) {
        messageApi.error(`缺少发布依赖的配置值: ${publishMissingKeys.join(", ")}`);
        return;
      }
      setPublishing(true);
      await publishRepositoryKnowledge({
        projectRepositoryId: publishingProject.id,
        targetRepositoryId: values.targetRepositoryId,
        knowledgeId: values.knowledgeId.trim(),
        displayName: values.displayName.trim(),
        description: values.description?.trim() || undefined,
        tags: values.tags || [],
        configItems: publishConfigItems.map((item) => ({
          key: item.key,
          publishMode: publishConfigModes[item.key] ?? "PLACEHOLDER"
        }))
      });
      messageApi.success("知识源已发布到目标仓库");
      setPublishingProject(null);
      setPublishConfigItems([]);
      setPublishMissingKeys([]);
      setPublishConfigModes({});
      publishForm.resetFields();
    } catch (error) {
      if (error instanceof ApiError) {
        messageApi.error(error.message);
      } else if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      } else {
        messageApi.error(getErrorMessage(error, "发布知识源失败"));
      }
    } finally {
      setPublishing(false);
    }
  };

  const commonRepositoryCell = (_value: unknown, record: RepositoryDefinition) => (
    <Space direction="vertical" size={2}>
      <Space wrap size={[8, 8]}>
        <TableLinkCell onClick={() => openEdit(record)}>{record.name}</TableLinkCell>
        {record.enabled ? <Tag color="blue">已启用</Tag> : <Tag>已禁用</Tag>}
      </Space>
      <Text type="secondary">{record.description || record.url}</Text>
    </Space>
  );

  const capabilityColumns: ColumnsType<RepositoryDefinition> = [
    {
      title: "仓库",
      key: "name",
      render: commonRepositoryCell
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 120,
      render: (value: RepositoryDefinition["type"]) => getRepositoryTypeLabel(value)
    },
    {
      title: "信任",
      dataIndex: "trustLevel",
      key: "trustLevel",
      width: 120,
      render: (value: RepositoryDefinition["trustLevel"]) => <TrustLevelTag level={value} />
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
          <ConfirmDangerAction
            title="确认删除这个仓库？"
            description="删除仓库不会卸载已从发现页安装的脚本、Webhook、配置、能力包、知识源、插件或 Skill；这些资源会保留为已安装资源，可在发现页的“已安装”中继续卸载。"
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
            loading={deletingId === record.id}
          >
            <Button danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </ConfirmDangerAction>
        </Space>
      )
    }
  ];

  const projectColumns: ColumnsType<RepositoryDefinition> = [
    {
      title: "项目",
      key: "name",
      render: commonRepositoryCell
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 120,
      render: (value: RepositoryDefinition["type"]) => getRepositoryTypeLabel(value)
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
      width: 340,
      render: (_value: unknown, record) => (
        <Space wrap size={[4, 4]}>
          <Button
            size="small"
            icon={<EyeOutlined />}
            loading={resolvingId === record.id}
            onClick={() => void handleResolve(record.id)}
          >
            解析
          </Button>
          <Button
            size="small"
            icon={<ShareAltOutlined />}
            onClick={() => openPublishKnowledge(record)}
          >
            发布
          </Button>
          <Button
            size="small"
            icon={<SyncOutlined />}
            loading={syncingId === record.id}
            onClick={() => void handleSync(record.id)}
          >
            同步
          </Button>
          <ConfirmDangerAction
            title="确认删除这个项目仓库？"
            description="删除项目仓库后将无法继续解析该项目知识入口；如果它来自发现页安装的知识源，可在发现页的“已安装”中继续卸载。"
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
            loading={deletingId === record.id}
          >
            <Button danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </ConfirmDangerAction>
        </Space>
      )
    }
  ];

  const typeOptions = [
    { value: "GIT", label: "Git 仓库" },
    { value: "LOCAL_DIR", label: "本地目录仓库" }
  ];

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="仓库"
          meta={(
            <Text type="secondary">
              能力仓库用于发现和发布脚本、Webhook、插件、能力包与 Skill；项目仓库只用于定位并读取项目知识入口 Markdown。
            </Text>
          )}
          actions={
            <>
              <Button icon={<ReloadOutlined />} onClick={() => void handleSyncAll()} loading={loading}>
                全部同步
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                添加仓库
              </Button>
            </>
          }
        />

        <Card>
          <Tabs
            activeKey={activeTab}
            onChange={(value) => setActiveTab(value as RepositoryTabKey)}
            items={[
              {
                key: "CAPABILITY",
                label: `能力仓库 (${capabilityRepositories.length})`,
                children: (
                  <Table<RepositoryDefinition>
                    rowKey="id"
                    loading={loading}
                    columns={capabilityColumns}
                    dataSource={capabilityRepositories}
                    scroll={{ x: 800 }}
                    locale={{
                      emptyText: (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="还没有配置能力仓库。先添加一个 Git 或本地目录仓库。"
                        />
                      )
                    }}
                    pagination={{ pageSize: 10, showSizeChanger: true }}
                  />
                )
              },
              {
                key: "PROJECT",
                label: `项目仓库 (${projectRepositories.length})`,
                children: (
                  <Table<RepositoryDefinition>
                    rowKey="id"
                    loading={loading}
                    columns={projectColumns}
                    dataSource={projectRepositories}
                    scroll={{ x: 960 }}
                    locale={{
                      emptyText: (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="还没有配置项目仓库。添加后可通过 Resolve 读取根目录 ACTIONDOCK.md。"
                        />
                      )
                    }}
                    pagination={{ pageSize: 10, showSizeChanger: true }}
                  />
                )
              }
            ]}
          />
        </Card>
      </Space>

      <Drawer
        title={editorState?.mode === "edit" ? "编辑仓库" : "添加仓库"}
        open={Boolean(editorState)}
        onClose={closeEditor}
        destroyOnClose
        width={520}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ enabled: true, trustLevel: "UNTRUSTED", type: "GIT", purpose: activeTab }}
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Form.Item
              label={<InfoHint label="仓库 ID" content="根据 Git 地址或目录名自动生成，无需手动输入。项目仓库的项目 ID 也直接使用这个值。" />}
              name="id"
              rules={[
                { required: true, message: "请输入仓库地址以自动生成 ID" },
                { pattern: /^[A-Za-z0-9._-]+$/, message: "仅支持字母、数字、点、中横线和下划线" }
              ]}
            >
              <Input
                disabled
                placeholder="根据地址自动生成"
              />
            </Form.Item>

            <Form.Item
              label="名称"
              name="name"
              rules={[{ required: true, message: "请输入仓库名称" }]}
            >
              <Input placeholder="例如 平台能力仓库 / Billing Service" />
            </Form.Item>

            <Space size={12} style={{ width: "100%" }} wrap>
              <Form.Item label="用途" name="purpose" style={{ flex: "1 1 180px", minWidth: 180 }}>
                <Select
                  options={[
                    { value: "CAPABILITY", label: "能力仓库" },
                    { value: "PROJECT", label: "项目仓库" }
                  ]}
                />
              </Form.Item>
              <Form.Item label="类型" name="type" style={{ flex: "1 1 180px", minWidth: 180 }}>
                <Select options={typeOptions} />
              </Form.Item>
            </Space>

            {repositoryPurpose === "CAPABILITY" ? (
              <Form.Item label="信任级别" name="trustLevel">
                <Select
                  options={[
                    { value: "TRUSTED", label: "可信" },
                    { value: "UNTRUSTED", label: "未信任" }
                  ]}
                />
              </Form.Item>
            ) : (
              <Form.Item label="信任级别" name="trustLevel" hidden>
                <Input />
              </Form.Item>
            )}

            <Form.Item
              label={repositoryType === "LOCAL_DIR" ? "本地路径" : "地址"}
              name="url"
              rules={[{ required: true, message: "请输入仓库地址或目录路径" }]}
            >
              <Input placeholder={repositoryType === "LOCAL_DIR" ? "/Users/me/projects/${config.project_dir}" : "https://${config.github_token}@github.com/company/repo.git"} />
            </Form.Item>

            {repositoryPurpose === "CAPABILITY" && repositoryType === "LOCAL_DIR" ? (
              <Text type="secondary">保存时会自动创建 scripts、webhooks、plugins、packages、skills 目录；资源列表会在启动和同步后扫描刷新。</Text>
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

            <Button type="primary" loading={saving} onClick={() => void handleSubmit()} block>
              {editorState?.mode === "edit" ? "保存" : "创建"}
            </Button>
          </Space>
        </Form>
      </Drawer>

      <Drawer
        title={resolution ? `项目知识入口：${resolution.repositoryId}` : "项目知识入口"}
        open={resolutionOpen}
        onClose={() => setResolutionOpen(false)}
        width={720}
      >
        {resolution ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Card size="small">
              <Space direction="vertical" size={4}>
                <Text><strong>仓库：</strong>{resolution.repositoryId}</Text>
                <Text><strong>根目录：</strong>{resolution.root}</Text>
                <Text><strong>Entry：</strong>{resolution.entryPath}</Text>
                <Text><strong>类型：</strong>{getRepositoryTypeLabel(resolution.type)}</Text>
              </Space>
            </Card>
            <Card size="small" title="ACTIONDOCK.md">
              <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                {resolution.content}
              </Paragraph>
            </Card>
          </Space>
        ) : null}
      </Drawer>

      <Drawer
        title={publishingProject ? `发布为知识源：${publishingProject.name}` : "发布为知识源"}
        open={publishingProject !== null}
        onClose={() => { setPublishingProject(null); publishForm.resetFields(); }}
        destroyOnClose
        width={520}
        extra={
          <Button type="primary" loading={publishing} onClick={() => void handlePublishKnowledge()}>
            发布
          </Button>
        }
      >
        {publishingProject ? (
          <Form form={publishForm} layout="vertical">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Text type="secondary">
                将项目仓库 <Text strong>{publishingProject.name}</Text>（{publishingProject.url}）发布为知识源指针到目标能力仓库，团队成员发现后可一键安装。
              </Text>

              <Form.Item
                label="目标能力仓库"
                name="targetRepositoryId"
                rules={[{ required: true, message: "请选择目标能力仓库" }]}
              >
                <Select
                  placeholder="选择目标能力仓库"
                  options={capabilityRepositories.map((repo) => ({
                    value: repo.id,
                    label: `${repo.name}（${repo.id}）`
                  }))}
                />
              </Form.Item>

              <Form.Item
                label="知识源 ID"
                name="knowledgeId"
                rules={[{ required: true, message: "请输入知识源 ID" }]}
              >
                <Input placeholder="安装后用于识别的知识源标识" />
              </Form.Item>

              <Form.Item
                label="显示名称"
                name="displayName"
                rules={[{ required: true, message: "请输入显示名称" }]}
              >
                <Input placeholder="知识源的显示名称" />
              </Form.Item>

              <Form.Item label="说明" name="description">
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="可选，知识源说明" />
              </Form.Item>

              <Form.Item label="标签" name="tags">
                <Select mode="tags" placeholder="输入后按回车添加标签" />
              </Form.Item>

              <Card type="inner" title={`配置模板 (${publishConfigItems.length})`}>
                {publishConfigLoading ? (
                  <div className="page-loading"><Spin size="large" /></div>
                ) : (
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    {publishMissingKeys.length > 0 ? (
                      <Alert
                        type="error"
                        showIcon
                        message="检测到缺失的配置依赖"
                        description={publishMissingKeys.join(", ")}
                      />
                    ) : null}
                    {publishConfigItems.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前项目仓库地址没有检测到配置引用" />
                    ) : (
                      publishConfigItems.map((item) => {
                        const forcedPlaceholder = Boolean(item.secret);
                        const selectedMode = forcedPlaceholder ? "PLACEHOLDER" : (publishConfigModes[item.key] ?? "PLACEHOLDER");
                        return (
                          <div key={item.key} className="repository-config-publish-row">
                            <Space direction="vertical" size={2}>
                              <Space wrap size={[8, 8]}>
                                <Text code>{item.key}</Text>
                                {item.secret ? <Tag color="gold">SECRET</Tag> : null}
                              </Space>
                              <Text type="secondary">{item.label || "未填写说明"}</Text>
                            </Space>
                            <Select
                              value={selectedMode}
                              disabled={forcedPlaceholder}
                              style={{ width: 160 }}
                              options={[
                                { value: "PLACEHOLDER", label: "PLACEHOLDER" },
                                ...(forcedPlaceholder ? [] : [{ value: "INLINE", label: "INLINE" }])
                              ]}
                              onChange={(value) => setPublishConfigModes((current) => ({ ...current, [item.key]: value }))}
                            />
                          </div>
                        );
                      })
                    )}
                  </Space>
                )}
              </Card>
            </Space>
          </Form>
        ) : null}
      </Drawer>
    </>
  );
}
