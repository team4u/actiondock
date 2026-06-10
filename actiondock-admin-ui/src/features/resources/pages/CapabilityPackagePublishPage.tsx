import {
  CheckCircleOutlined,
  EyeOutlined,
  RocketOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { listAiAgents, listAiModels, listAiToolsets } from "../../ai/api";
import { listPlaybooks } from "../../playbooks/api";
import { getCapabilityPackage, listRepositories, previewCapabilityPackagePublish, publishCapabilityPackage } from "../../resources/api";
import { listScripts } from "../../scripts/api";
import { MarkdownDescription } from "../../../components/common/MarkdownDescription";
import { PageHeader } from "../../../components/common/PageHeader";
import { RepositoryPublishBasicsForm } from "../../../components/repository/RepositoryPublishBasicsForm";
import { useDefaultOwner } from "../../../shared/hooks/useDefaultOwner";
import { getPublishableRepositories, pickDefaultPublishRepository } from "../../../services/repositoryPublish";
import { ApiError } from "../../../shared/api/httpClient";
import type {
  AiAgentProfile,
  AiModelProfile,
  AiToolset,
  CapabilityPackageCheck,
  CapabilityPackageDetail,
  CapabilityPackageEntrySelection,
  CapabilityPackageEntryType,
  CapabilityPackagePublishPreview,
  CapabilityPackagePublishRequest,
  CapabilityPackageSource,
  Playbook,
  RepositoryAiPackageDependency,
  RepositoryDefinition,
  ScriptDefinition
} from "../../../shared/types";
import { getErrorMessage } from "../../../services/utils";

const { Text, Title } = Typography;

interface PublishFormValues {
  repositoryId: string;
  packageId: string;
  displayName?: string;
  version: string;
  owner?: string;
  description?: string;
  releaseNotes?: string;
  tagsText?: string;
  riskLevel?: string;
  source: CapabilityPackageSource;
  primaryEntryType: CapabilityPackageEntryType;
  primaryEntryId: string;
  scriptIds: string[];
  agentIds: string[];
  modelIds: string[];
  toolsetIds: string[];
  playbookIds: string[];
}

interface BuiltPublishRequest {
  repositoryId: string;
  payload: CapabilityPackagePublishRequest;
}

function sanitizePackageId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function splitTags(tagsText?: string): string[] | undefined {
  const tags = tagsText
    ?.split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return tags && tags.length > 0 ? dedupe(tags) : undefined;
}

function bumpPatchVersion(version?: string): string {
  if (!version) {
    return "1.0.0";
  }
  const parts = version.split(".");
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(Number(part)))) {
    return version;
  }
  return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
}

function getCheckColor(severity: CapabilityPackageCheck["severity"]): "red" | "orange" | "blue" {
  switch (severity) {
    case "BLOCKER":
      return "red";
    case "WARNING":
      return "orange";
    default:
      return "blue";
  }
}

function renderDependencyTable(dependencies: RepositoryAiPackageDependency[]) {
  if (dependencies.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所有依赖均已闭包打包" />;
  }

  return (
    <Table<RepositoryAiPackageDependency>
      rowKey={(item) => `${item.assetType}:${item.repositoryId}:${item.assetId}`}
      size="small"
      pagination={false}
      dataSource={dependencies}
      columns={[
        { title: "类型", dataIndex: "assetType", key: "assetType", width: 140 },
        { title: "仓库", dataIndex: "repositoryId", key: "repositoryId", render: (value?: string) => value || "-" },
        { title: "资产", dataIndex: "assetId", key: "assetId" },
        { title: "版本", dataIndex: "version", key: "version", render: (value?: string) => value || "-" }
      ]}
    />
  );
}

export function CapabilityPackagePublishPage() {
  const navigate = useNavigate();
  const defaultOwner = useDefaultOwner();
  const { packageId: routePackageId, version: routeVersion } = useParams<{ packageId?: string; version?: string }>();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm<PublishFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [existingLoading, setExistingLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [agents, setAgents] = useState<AiAgentProfile[]>([]);
  const [models, setModels] = useState<AiModelProfile[]>([]);
  const [toolsets, setToolsets] = useState<AiToolset[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [existingPackage, setExistingPackage] = useState<CapabilityPackageDetail | null>(null);
  const [preview, setPreview] = useState<CapabilityPackagePublishPreview | null>(null);
  const initializedRef = useRef(false);

  const sourceFromQuery = (searchParams.get("source") ?? "").toUpperCase() as CapabilityPackageSource;
  const sourceIdFromQuery = searchParams.get("sourceId") ?? "";
  const repositoryIdFromQuery = searchParams.get("repositoryId") ?? "";

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [repositoryData, scriptData, agentData, modelData, toolsetData, playbookData] = await Promise.all([
          listRepositories(),
          listScripts(),
          listAiAgents(),
          listAiModels(),
          listAiToolsets(),
          listPlaybooks()
        ]);
        setRepositories(getPublishableRepositories(repositoryData));
        setScripts(scriptData);
        setAgents(agentData);
        setModels(modelData);
        setToolsets(toolsetData);
        setPlaybooks(playbookData);
      } catch (error) {
        messageApi.error(getErrorMessage(error, "加载发布元数据失败"));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [messageApi]);

  useEffect(() => {
    if (loading || initializedRef.current) {
      return;
    }

    const selectedSource: CapabilityPackageSource = sourceFromQuery === "AGENT" || sourceFromQuery === "SCRIPT" || sourceFromQuery === "MANUAL"
      ? sourceFromQuery
      : "AGENT";
    const defaultRepository = repositoryIdFromQuery
      ? repositories.find((item) => item.id === repositoryIdFromQuery)
      : pickDefaultPublishRepository(repositories);
    const sourceScript = scripts.find((item) => item.id === sourceIdFromQuery);
    const sourceAgent = agents.find((item) => item.id === sourceIdFromQuery);
    const fallbackPackageId = routePackageId
      ? sanitizePackageId(routePackageId)
      : sanitizePackageId(sourceIdFromQuery || sourceAgent?.name || sourceScript?.name || "capability-package");
    const displayName = existingPackage?.descriptor.displayName
      || (selectedSource === "AGENT" ? sourceAgent?.name : selectedSource === "SCRIPT" ? sourceScript?.name : undefined)
      || "";

    form.setFieldsValue({
      repositoryId: defaultRepository?.id,
      packageId: fallbackPackageId,
      displayName,
      version: routeVersion || "1.0.0",
      owner: defaultOwner,
      description: existingPackage?.descriptor.description,
      releaseNotes: existingPackage?.descriptor.releaseNotes,
      tagsText: existingPackage?.descriptor.tags.join(", "),
      riskLevel: existingPackage?.descriptor.riskLevel,
      source: selectedSource,
      primaryEntryType: selectedSource === "SCRIPT" ? "SCRIPT" : "AGENT",
      primaryEntryId: sourceIdFromQuery,
      scriptIds: selectedSource === "SCRIPT" && sourceIdFromQuery ? [sourceIdFromQuery] : [],
      agentIds: selectedSource === "AGENT" && sourceIdFromQuery ? [sourceIdFromQuery] : [],
      modelIds: [],
      toolsetIds: [],
      playbookIds: []
    });
    initializedRef.current = true;
  }, [
    agents,
    defaultOwner,
    existingPackage,
    form,
    loading,
    repositories,
    repositoryIdFromQuery,
    routePackageId,
    routeVersion,
    scripts,
    sourceFromQuery,
    sourceIdFromQuery
  ]);

  useEffect(() => {
    if (!routePackageId || !repositoryIdFromQuery) {
      return;
    }

    const loadExisting = async () => {
      setExistingLoading(true);
      try {
        const detail = await getCapabilityPackage(repositoryIdFromQuery, routePackageId);
        setExistingPackage(detail);
        const nextVersion = routeVersion || bumpPatchVersion(detail.descriptor.version);
        form.setFieldsValue({
          repositoryId: repositoryIdFromQuery,
          packageId: detail.descriptor.packageId,
          displayName: detail.descriptor.displayName,
          version: nextVersion,
          owner: detail.descriptor.owner,
          description: detail.descriptor.description,
          releaseNotes: detail.descriptor.releaseNotes,
          tagsText: detail.descriptor.tags.join(", "),
          riskLevel: detail.descriptor.riskLevel,
          source: detail.releaseFile.sourceType,
          primaryEntryType: detail.releaseFile.entries[0]?.type ?? "AGENT",
          primaryEntryId: detail.releaseFile.entries[0]?.target.replace(/^agent:|^script:/, "") ?? "",
          scriptIds: detail.releaseFile.scripts.map((item) => item.id),
          agentIds: detail.releaseFile.agents.map((item) => item.id),
          modelIds: detail.releaseFile.models.map((item) => item.id),
          toolsetIds: detail.releaseFile.toolsets.map((item) => item.id),
          playbookIds: detail.releaseFile.playbooks?.map((item) => item.id) ?? []
        });
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          messageApi.error(getErrorMessage(error, "加载当前能力包失败"));
        }
      } finally {
        setExistingLoading(false);
      }
    };

    void loadExisting();
  }, [form, messageApi, repositoryIdFromQuery, routePackageId, routeVersion]);

  const watchedSource = Form.useWatch("source", form) ?? "AGENT";
  const watchedPrimaryEntryType = Form.useWatch("primaryEntryType", form) ?? "AGENT";

  const scriptOptions = useMemo(
    () => scripts.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })),
    [scripts]
  );
  const agentOptions = useMemo(
    () => agents.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })),
    [agents]
  );
  const modelOptions = useMemo(
    () => models.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })),
    [models]
  );
  const toolsetOptions = useMemo(
    () => toolsets.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })),
    [toolsets]
  );
  const playbookOptions = useMemo(
    () => playbooks.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })),
    [playbooks]
  );
  const entryOptions = watchedSource === "SCRIPT" || watchedPrimaryEntryType === "SCRIPT" ? scriptOptions : agentOptions;

  const buildPayload = async (): Promise<BuiltPublishRequest> => {
    const values = await form.validateFields();
    const normalizedPackageId = sanitizePackageId(values.packageId);
    const normalizedSource: CapabilityPackageSource = values.source;
    const primaryEntryType: CapabilityPackageEntryType = normalizedSource === "SCRIPT"
      ? "SCRIPT"
      : normalizedSource === "AGENT"
        ? "AGENT"
        : values.primaryEntryType;
    const primaryEntryId = values.primaryEntryId.trim();

    const scriptIds = dedupe([
      ...(values.scriptIds ?? []),
      ...(primaryEntryType === "SCRIPT" ? [primaryEntryId] : [])
    ]);
    const agentIds = dedupe([
      ...(values.agentIds ?? []),
      ...(primaryEntryType === "AGENT" ? [primaryEntryId] : [])
    ]);
    const entryDisplayName = primaryEntryType === "SCRIPT"
      ? scripts.find((item) => item.id === primaryEntryId)?.name
      : agents.find((item) => item.id === primaryEntryId)?.name;

    const primaryEntry: CapabilityPackageEntrySelection = {
      type: primaryEntryType,
      targetId: primaryEntryId,
      displayName: entryDisplayName
    };

    const payload: CapabilityPackagePublishRequest = {
      packageId: normalizedPackageId,
      displayName: values.displayName?.trim() || undefined,
      version: values.version.trim(),
      owner: values.owner?.trim() || undefined,
      description: values.description?.trim() || undefined,
      releaseNotes: values.releaseNotes?.trim() || undefined,
      tags: splitTags(values.tagsText),
      riskLevel: values.riskLevel || undefined,
      source: normalizedSource,
      primaryEntry,
      scriptIds,
      agentIds,
      modelIds: dedupe(values.modelIds ?? []),
      toolsetIds: dedupe(values.toolsetIds ?? []),
      playbookIds: dedupe(values.playbookIds ?? [])
    };

    return {
      repositoryId: values.repositoryId,
      payload
    };
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const request = await buildPayload();
      form.setFieldValue("packageId", request.payload.packageId);
      const result = await previewCapabilityPackagePublish(request.repositoryId, request.payload);
      setPreview(result);
      messageApi.success("发布计划已生成");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成发布计划失败");
    } finally {
      setPreviewing(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const request = await buildPayload();
      form.setFieldValue("packageId", request.payload.packageId);
      const result = await publishCapabilityPackage(request.repositoryId, request.payload);
      messageApi.success("能力包已发布");
      navigate(`/discover?repositoryId=${encodeURIComponent(result.repositoryId)}`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "发布能力包失败");
    } finally {
      setPublishing(false);
    }
  };

  const checks = preview?.checks ?? [];
  const blockerCount = checks.filter((item) => item.severity === "BLOCKER").length;
  const warningCount = checks.filter((item) => item.severity === "WARNING").length;
  const infoCount = checks.filter((item) => item.severity === "INFO").length;
  const publishBlocked = blockerCount > 0 || !preview;

  if (loading) {
    return (
      <div className="page-loading">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="发布能力包"
        meta="以能力包为发布主语，统一生成入口、资产闭包、配置模板、定时任务和执行预设的 Release。"
        onBack={() => navigate(-1)}
        actions={(
          <Space>
            <Button icon={<EyeOutlined />} loading={previewing} onClick={() => void handlePreview()}>
              生成发布计划
            </Button>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              loading={publishing}
              disabled={publishBlocked}
              onClick={() => void handlePublish()}
            >
              确认发布
            </Button>
          </Space>
        )}
      />

      <Steps
        current={preview ? 4 : 2}
        items={[
          { title: "选择来源" },
          { title: "编辑包信息" },
          { title: "选择入口与资产" },
          { title: "生成发布计划" },
          { title: "确认发布" }
        ]}
      />

      {sourceIdFromQuery ? (
        <Alert
          type="info"
          showIcon
          message={`正在从 ${sourceFromQuery || "AGENT"} 资产创建能力包`}
          description={<Text code>{sourceIdFromQuery}</Text>}
        />
      ) : null}

      {routePackageId && repositoryIdFromQuery ? (
        <Card loading={existingLoading}>
          {existingPackage ? (
            <Descriptions bordered size="small" column={4}>
              <Descriptions.Item label="当前能力包">{existingPackage.descriptor.displayName}</Descriptions.Item>
              <Descriptions.Item label="仓库">{existingPackage.descriptor.repositoryId}</Descriptions.Item>
              <Descriptions.Item label="当前版本">{existingPackage.descriptor.version}</Descriptions.Item>
              <Descriptions.Item label="建议新版本">{form.getFieldValue("version")}</Descriptions.Item>
            </Descriptions>
          ) : (
            <Alert type="warning" showIcon message="未找到当前能力包，将按新包发布处理。" />
          )}
        </Card>
      ) : null}

      <Form form={form} layout="vertical">
        <Card title="Step 1 · 发布来源">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Form.Item name="source" label="发布来源" rules={[{ required: true, message: "请选择发布来源" }]}>
              <Select
                options={[
                  { value: "AGENT", label: "从 Agent 创建能力包" },
                  { value: "SCRIPT", label: "从脚本创建能力包" },
                  { value: "MANUAL", label: "手动组装能力包" }
                ]}
              />
            </Form.Item>
            <Alert
              type="info"
              showIcon
              message="底层脚本工具、插件和 AI 资产仍然作为内部 asset writer 存在，用户面向的是整包 Release。"
            />
            <Alert
              type="warning"
              showIcon
              message="Playbook 内引用的脚本和知识源不会自动随能力包发布"
              description="生成发布计划时会检查目标仓库是否已经存在这些脚本和知识源；缺失时会产生阻断项，需先分别发布。"
            />
          </Space>
        </Card>

        <Card title="Step 2 · 包信息">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Form.Item
              name="packageId"
              label="Package ID"
              rules={[{ required: true, message: "请输入 packageId" }]}
              extra="仅允许小写字母、数字、点、下划线和中划线。"
            >
              <Input onBlur={(event) => form.setFieldValue("packageId", sanitizePackageId(event.target.value))} />
            </Form.Item>
            <RepositoryPublishBasicsForm
              repositories={repositories}
              displayNameLabel="显示名称"
              displayNamePlaceholder="例如 智能问答包"
              versionPlaceholder="例如 1.0.0"
              ownerPlaceholder="例如 platform-team"
              tagsFieldName="tagsText"
              tagsPlaceholder="使用逗号分隔，例如 github, ai, triage"
              tagsMode="text"
              descriptionPlaceholder="说明能力包用途和边界"
              releaseNotesLabel="Release Notes"
              releaseNotesPlaceholder="本次发布的变更说明"
              showRiskLevel
            />
          </Space>
        </Card>

        <Card title="Step 3 · 入口与资产">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space size={12} style={{ width: "100%" }} align="start">
              <Form.Item
                name="primaryEntryType"
                label="入口类型"
                rules={[{ required: true, message: "请选择入口类型" }]}
                style={{ flex: 1 }}
              >
                <Select
                  disabled={watchedSource !== "MANUAL"}
                  options={[
                    { value: "AGENT", label: "AGENT" },
                    { value: "SCRIPT", label: "SCRIPT" }
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="primaryEntryId"
                label="主入口"
                rules={[{ required: true, message: "请选择主入口" }]}
                style={{ flex: 2 }}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={entryOptions}
                />
              </Form.Item>
            </Space>
            <Form.Item name="scriptIds" label="包含脚本">
              <Select mode="multiple" showSearch optionFilterProp="label" options={scriptOptions} />
            </Form.Item>
            <Form.Item name="agentIds" label="包含 Agent">
              <Select mode="multiple" showSearch optionFilterProp="label" options={agentOptions} />
            </Form.Item>
            <Form.Item name="toolsetIds" label="包含 Toolset">
              <Select mode="multiple" showSearch optionFilterProp="label" options={toolsetOptions} />
            </Form.Item>
            <Form.Item name="modelIds" label="包含模型 Profile">
              <Select mode="multiple" showSearch optionFilterProp="label" options={modelOptions} />
            </Form.Item>
            <Form.Item name="playbookIds" label="包含任务手册">
              <Select mode="multiple" showSearch optionFilterProp="label" options={playbookOptions} />
            </Form.Item>
          </Space>
        </Card>
      </Form>

      <Card
        title="Step 4 · 发布计划"
        extra={preview ? <Tag color={publishBlocked ? "error" : "processing"}>{publishBlocked ? "存在阻断项" : "可发布"}</Tag> : null}
      >
        {!preview ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先生成发布计划，再确认发布。" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={{ xs: 1, md: 4 }}>
              <Descriptions.Item label="Package">{preview.packageId}</Descriptions.Item>
              <Descriptions.Item label="版本">{preview.version}</Descriptions.Item>
              <Descriptions.Item label="入口">{preview.entries.map((item) => item.displayName).join(", ") || "-"}</Descriptions.Item>
              <Descriptions.Item label="检查结果">
                <Space wrap size={[6, 6]}>
                  <Tag color="red">{blockerCount} 阻断</Tag>
                  <Tag color="orange">{warningCount} 警告</Tag>
                  <Tag color="blue">{infoCount} 提示</Tag>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="脚本">{preview.scriptIds.length}</Descriptions.Item>
              <Descriptions.Item label="Agent">{preview.agentIds.length}</Descriptions.Item>
              <Descriptions.Item label="Toolset">{preview.toolsetIds.length}</Descriptions.Item>
              <Descriptions.Item label="模型">{preview.modelIds.length}</Descriptions.Item>
              <Descriptions.Item label="任务手册">{preview.playbookIds.length}</Descriptions.Item>
              <Descriptions.Item label="配置模板">{preview.configTemplate.length}</Descriptions.Item>
              <Descriptions.Item label="定时任务">{preview.scheduleTemplate.length}</Descriptions.Item>
              <Descriptions.Item label="执行预设">{preview.presetTemplate.length}</Descriptions.Item>
              <Descriptions.Item label="外部依赖">{preview.externalDependencies.length}</Descriptions.Item>
            </Descriptions>

            <Space wrap size={[8, 8]}>
              <Tag color="blue">Diff 模式: {preview.diff.comparisonMode}</Tag>
              {preview.diff.addedEntries.map((item) => <Tag color="green" key={`added:${item}`}>新增入口 {item}</Tag>)}
              {preview.diff.removedEntries.map((item) => <Tag color="red" key={`removed:${item}`}>移除入口 {item}</Tag>)}
              {preview.diff.changedAssets.map((item) => <Tag color="gold" key={`changed:${item}`}>变更资产 {item}</Tag>)}
            </Space>

            {checks.length > 0 ? (
              <Card type="inner" title="检查结果">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {checks.map((item) => (
                    <Alert
                      key={`${item.severity}:${item.code}`}
                      type={item.severity === "BLOCKER" ? "error" : item.severity === "WARNING" ? "warning" : "info"}
                      showIcon
                      message={
                        <Space wrap size={[8, 8]}>
                          <Tag color={getCheckColor(item.severity)}>{item.severity}</Tag>
                          <Text strong>{item.code}</Text>
                        </Space>
                      }
                      description={item.message}
                    />
                  ))}
                </Space>
              </Card>
            ) : (
              <Alert type="success" showIcon message="当前没有检查项返回。" />
            )}

            <Card type="inner" title="发布说明预览">
              <MarkdownDescription
                value={form.getFieldValue("releaseNotes")}
                emptyText="当前未填写 Release Notes。"
                className="markdown-description--panel"
              />
            </Card>

            <Card type="inner" title="配置模板">
              {preview.configTemplate.length > 0 ? (
                <Table
                  rowKey="key"
                  size="small"
                  pagination={false}
                  dataSource={preview.configTemplate}
                  columns={[
                    { title: "Key", dataIndex: "key", key: "key", render: (value: string) => <Text code>{value}</Text> },
                    { title: "说明", dataIndex: "label", key: "label", render: (value?: string) => value || "-" },
                    {
                      title: "策略",
                      key: "policy",
                      render: (_value: unknown, record) => (
                        <Space wrap size={[6, 6]}>
                          {record.required ? <Tag color="blue">必填</Tag> : <Tag>可选</Tag>}
                          {record.secret ? <Tag color="gold">SECRET_PLACEHOLDER</Tag> : <Tag>{record.type}</Tag>}
                        </Space>
                      )
                    }
                  ]}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无配置模板" />
              )}
            </Card>

            <Card type="inner" title="入口与执行资源">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Table
                  rowKey={(item) => `${item.type}:${item.id}`}
                  size="small"
                  pagination={false}
                  dataSource={preview.entries}
                  columns={[
                    { title: "入口类型", dataIndex: "type", key: "type", width: 120 },
                    { title: "名称", dataIndex: "displayName", key: "displayName" },
                    { title: "目标", dataIndex: "target", key: "target", render: (value: string) => <Text code>{value}</Text> }
                  ]}
                />
                <Descriptions bordered size="small" column={2}>
                  <Descriptions.Item label="脚本闭包">{preview.scriptIds.join(", ") || "-"}</Descriptions.Item>
                  <Descriptions.Item label="Agent 闭包">{preview.agentIds.join(", ") || "-"}</Descriptions.Item>
                  <Descriptions.Item label="Toolset 闭包">{preview.toolsetIds.join(", ") || "-"}</Descriptions.Item>
                  <Descriptions.Item label="模型闭包">{preview.modelIds.join(", ") || "-"}</Descriptions.Item>
                  <Descriptions.Item label="任务手册">{preview.playbookIds.join(", ") || "-"}</Descriptions.Item>
                </Descriptions>
              </Space>
            </Card>

            <Card type="inner" title="定时任务与执行预设">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {preview.scheduleTemplate.length > 0 ? (
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={preview.scheduleTemplate}
                    columns={[
                      { title: "名称", dataIndex: "name", key: "name" },
                      { title: "脚本", dataIndex: "scriptId", key: "scriptId", render: (value: string) => <Text code>{value}</Text> },
                      { title: "Cron", dataIndex: "cronExpression", key: "cronExpression" },
                      {
                        title: "默认状态",
                        dataIndex: "enabledByDefault",
                        key: "enabledByDefault",
                        render: (value: boolean) => value ? <Tag color="processing">默认启用</Tag> : <Tag>默认停用</Tag>
                      }
                    ]}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无定时任务模板" />
                )}
                {preview.presetTemplate.length > 0 ? (
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={preview.presetTemplate}
                    columns={[
                      { title: "预设 ID", dataIndex: "id", key: "id", render: (value: string) => <Text code>{value}</Text> },
                      { title: "名称", dataIndex: "name", key: "name" },
                      { title: "脚本", dataIndex: "scriptId", key: "scriptId", render: (value: string) => <Text code>{value}</Text> }
                    ]}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无执行预设模板" />
                )}
              </Space>
            </Card>

            <Card type="inner" title="外部依赖">
              {renderDependencyTable(preview.externalDependencies)}
            </Card>
          </Space>
        )}
      </Card>

      <Card title="Step 5 · 最终确认">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Title level={5} style={{ margin: 0 }}>Commit Release</Title>
          <Text>
            发布会写入 <Text code>packages/&lt;packageId&gt;/package.json</Text> 和版本级 <Text code>release.json</Text>，
            同时更新仓库索引。相同 <Text code>packageId@version</Text> 不可覆盖。
          </Text>
          <Space wrap size={[8, 8]}>
            <Button icon={<EyeOutlined />} loading={previewing} onClick={() => void handlePreview()}>
              重新生成发布计划
            </Button>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={publishing}
              disabled={publishBlocked}
              onClick={() => void handlePublish()}
            >
              确认发布
            </Button>
          </Space>
          {publishBlocked ? (
            <Alert
              type={preview ? "error" : "info"}
              showIcon
              message={preview ? "当前存在阻断项，无法发布。" : "当前还没有发布计划，请先生成。"}
            />
          ) : (
            <Alert type="success" showIcon message="发布计划通过当前门禁，可以提交 Release。" />
          )}
        </Space>
      </Card>
    </Space>
  );
}
