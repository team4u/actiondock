import { Alert, Card, Empty, Space, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type {
  RepositoryAiPackageDependency,
  RepositoryAiPackageDetail,
  RepositoryAiPackagePublishPreview,
  RepositoryConfigTemplateItem
  } from "../../types";
import type { ToolConfigMap } from "../../aiAgentTools";

const { Text } = Typography;

type ComparisonMode = "INITIAL" | "COMPARE";

interface StringListDiff {
  changed: boolean;
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
}

interface AssetDiffRow {
  key: string;
  label: string;
  before?: string;
  after: string;
  changed: boolean;
}

interface ConfigTemplateChange {
  key: string;
  before?: RepositoryConfigTemplateItem;
  after?: RepositoryConfigTemplateItem;
  changes: Array<{
    field: "label" | "type" | "required" | "secret" | "defaultValue";
    before: unknown;
    after: unknown;
  }>;
}

interface DependencyChange {
  key: string;
  before?: RepositoryAiPackageDependency;
  after?: RepositoryAiPackageDependency;
  changes: Array<{
    field: "version";
    before: unknown;
    after: unknown;
  }>;
}

interface ToolConfigChange {
  toolName: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

interface ListDiffRow {
  key: string;
  item: string;
  before: string;
  after: string;
  status: "ADDED" | "REMOVED";
}

interface ToolConfigDiffRow {
  key: string;
  toolName: string;
  before: string;
  after: string;
  status: "ADDED" | "REMOVED" | "MODIFIED";
}

interface AgentToolDiffResult {
  toolsetIds: StringListDiff;
  directToolNames: StringListDiff;
  directToolOptions: {
    added: ToolConfigChange[];
    removed: ToolConfigChange[];
    modified: ToolConfigChange[];
  };
}

interface RepositoryAiPackageDiffResult {
  comparisonMode: ComparisonMode;
  hasChanges: boolean;
  assetRows: AssetDiffRow[];
  agentTools: AgentToolDiffResult;
  configTemplate: {
    added: RepositoryConfigTemplateItem[];
    removed: RepositoryConfigTemplateItem[];
    modified: ConfigTemplateChange[];
  };
  externalDependencies: {
    added: RepositoryAiPackageDependency[];
    removed: RepositoryAiPackageDependency[];
    modified: DependencyChange[];
  };
}

interface RepositoryAiPackageDiffPanelProps {
  currentPackage: RepositoryAiPackageDetail | null;
  preview: RepositoryAiPackagePublishPreview;
  sourceToolsetIds: string[];
  sourceDirectToolNames: string[];
  sourceDirectToolOptions: ToolConfigMap;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

function normalizeText(value: string | undefined | null): string {
  return value?.trim() ?? "";
}

function joinList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function formatObjectValue(value?: Record<string, unknown>): string {
  if (!value || Object.keys(value).length === 0) {
    return "-";
  }
  return JSON.stringify(canonicalize(value), null, 2);
}

function listDiff(before: string[] | undefined, after: string[], comparisonMode: ComparisonMode): StringListDiff {
  const normalizedBefore = [...new Set((before ?? []).map((item) => item.trim()).filter(Boolean))];
  const normalizedAfter = [...new Set(after.map((item) => item.trim()).filter(Boolean))];

  if (comparisonMode === "INITIAL") {
    return {
      changed: normalizedAfter.length > 0,
      before: [],
      after: normalizedAfter,
      added: normalizedAfter,
      removed: []
    };
  }

  const added = normalizedAfter.filter((item) => !normalizedBefore.includes(item));
  const removed = normalizedBefore.filter((item) => !normalizedAfter.includes(item));

  return {
    changed: added.length > 0 || removed.length > 0,
    before: normalizedBefore,
    after: normalizedAfter,
    added,
    removed
  };
}

function keyOfTemplate(item: RepositoryConfigTemplateItem): string {
  return item.key;
}

function keyOfDependency(item: RepositoryAiPackageDependency): string {
  return `${item.assetType}:${item.repositoryId}:${item.assetId}`;
}

function renderTemplateSummary(item: RepositoryConfigTemplateItem): string {
  const parts = [
    item.label ? `说明: ${item.label}` : "说明: -",
    `类型: ${item.type}`,
    item.required ? "必填" : "可选",
    item.secret ? "SECRET" : "PLAIN",
    `默认值: ${item.defaultValue ?? "-"}`
  ];
  return parts.join(" · ");
}

function renderDependencySummary(item: RepositoryAiPackageDependency): string {
  return `${item.assetType} · ${item.repositoryId}/${item.assetId} @ ${item.version}`;
}

function buildListDiffRows(diff: StringListDiff): ListDiffRow[] {
  return [
    ...diff.added.map((item) => ({
      key: `added:${item}`,
      item,
      before: "-",
      after: item,
      status: "ADDED" as const
    })),
    ...diff.removed.map((item) => ({
      key: `removed:${item}`,
      item,
      before: item,
      after: "-",
      status: "REMOVED" as const
    }))
  ];
}

function buildToolConfigDiffRows(diff: AgentToolDiffResult["directToolOptions"]): ToolConfigDiffRow[] {
  return [
    ...diff.added.map((item) => ({
      key: `added:${item.toolName}`,
      toolName: item.toolName,
      before: "-",
      after: formatObjectValue(item.after),
      status: "ADDED" as const
    })),
    ...diff.removed.map((item) => ({
      key: `removed:${item.toolName}`,
      toolName: item.toolName,
      before: formatObjectValue(item.before),
      after: "-",
      status: "REMOVED" as const
    })),
    ...diff.modified.map((item) => ({
      key: `modified:${item.toolName}`,
      toolName: item.toolName,
      before: formatObjectValue(item.before),
      after: formatObjectValue(item.after),
      status: "MODIFIED" as const
    }))
  ];
}

function diffConfigTemplates(
  beforeItems: RepositoryConfigTemplateItem[],
  afterItems: RepositoryConfigTemplateItem[],
  comparisonMode: ComparisonMode
): RepositoryAiPackageDiffResult["configTemplate"] {
  const beforeMap = new Map(beforeItems.map((item) => [keyOfTemplate(item), item]));
  const afterMap = new Map(afterItems.map((item) => [keyOfTemplate(item), item]));
  const added: RepositoryConfigTemplateItem[] = [];
  const removed: RepositoryConfigTemplateItem[] = [];
  const modified: ConfigTemplateChange[] = [];

  if (comparisonMode === "INITIAL") {
    return {
      added: [...afterItems],
      removed: [],
      modified: []
    };
  }

  for (const [key, beforeItem] of beforeMap.entries()) {
    const afterItem = afterMap.get(key);
    if (!afterItem) {
      removed.push(beforeItem);
      continue;
    }
    const changes: ConfigTemplateChange["changes"] = [];
    if (!sameValue(beforeItem.label, afterItem.label)) {
      changes.push({ field: "label", before: beforeItem.label, after: afterItem.label });
    }
    if (!sameValue(beforeItem.type, afterItem.type)) {
      changes.push({ field: "type", before: beforeItem.type, after: afterItem.type });
    }
    if (!sameValue(beforeItem.required, afterItem.required)) {
      changes.push({ field: "required", before: beforeItem.required, after: afterItem.required });
    }
    if (!sameValue(beforeItem.secret, afterItem.secret)) {
      changes.push({ field: "secret", before: beforeItem.secret, after: afterItem.secret });
    }
    if (!sameValue(beforeItem.defaultValue, afterItem.defaultValue)) {
      changes.push({ field: "defaultValue", before: beforeItem.defaultValue, after: afterItem.defaultValue });
    }
    if (changes.length > 0) {
      modified.push({ key, before: beforeItem, after: afterItem, changes });
    }
  }

  for (const [key, afterItem] of afterMap.entries()) {
    if (!beforeMap.has(key)) {
      added.push(afterItem);
    }
  }

  return { added, removed, modified };
}

function diffDependencies(
  beforeItems: RepositoryAiPackageDependency[],
  afterItems: RepositoryAiPackageDependency[],
  comparisonMode: ComparisonMode
): RepositoryAiPackageDiffResult["externalDependencies"] {
  const beforeMap = new Map(beforeItems.map((item) => [keyOfDependency(item), item]));
  const afterMap = new Map(afterItems.map((item) => [keyOfDependency(item), item]));
  const added: RepositoryAiPackageDependency[] = [];
  const removed: RepositoryAiPackageDependency[] = [];
  const modified: DependencyChange[] = [];

  if (comparisonMode === "INITIAL") {
    return {
      added: [...afterItems],
      removed: [],
      modified: []
    };
  }

  for (const [key, beforeItem] of beforeMap.entries()) {
    const afterItem = afterMap.get(key);
    if (!afterItem) {
      removed.push(beforeItem);
      continue;
    }
    const changes: DependencyChange["changes"] = [];
    if (!sameValue(beforeItem.version, afterItem.version)) {
      changes.push({ field: "version", before: beforeItem.version, after: afterItem.version });
    }
    if (changes.length > 0) {
      modified.push({ key, before: beforeItem, after: afterItem, changes });
    }
  }

  for (const [key, afterItem] of afterMap.entries()) {
    if (!beforeMap.has(key)) {
      added.push(afterItem);
    }
  }

  return { added, removed, modified };
}

function diffAgentToolConfigs(
  before: ToolConfigMap,
  after: ToolConfigMap,
  comparisonMode: ComparisonMode
): AgentToolDiffResult["directToolOptions"] {
  const beforeKeys = new Set(Object.keys(before ?? {}));
  const afterKeys = new Set(Object.keys(after ?? {}));

  if (comparisonMode === "INITIAL") {
    return {
      added: [...afterKeys].sort().map((toolName) => ({
        toolName,
        after: after[toolName] ?? {}
      })),
      removed: [],
      modified: []
    };
  }

  const added: ToolConfigChange[] = [];
  const removed: ToolConfigChange[] = [];
  const modified: ToolConfigChange[] = [];

  [...afterKeys].sort().forEach((toolName) => {
    if (!beforeKeys.has(toolName)) {
      added.push({
        toolName,
        after: after[toolName] ?? {}
      });
      return;
    }
    const beforeValue = before[toolName] ?? {};
    const afterValue = after[toolName] ?? {};
    if (JSON.stringify(canonicalize(beforeValue)) !== JSON.stringify(canonicalize(afterValue))) {
      modified.push({
        toolName,
        before: beforeValue,
        after: afterValue
      });
    }
  });

  [...beforeKeys].sort().forEach((toolName) => {
    if (!afterKeys.has(toolName)) {
      removed.push({
        toolName,
        before: before[toolName] ?? {}
      });
    }
  });

  return {
    added,
    removed,
    modified
  };
}

export function buildRepositoryAiPackageDiff(
  currentPackage: RepositoryAiPackageDetail | null,
  preview: RepositoryAiPackagePublishPreview,
  sourceToolsetIds: string[],
  sourceDirectToolNames: string[],
  sourceDirectToolOptions: ToolConfigMap
): RepositoryAiPackageDiffResult {
  const comparisonMode: ComparisonMode = currentPackage ? "COMPARE" : "INITIAL";
  const currentFiles = currentPackage?.packageFile;
  const currentEntryAgent = currentFiles?.agents.find((item) => item.id === currentFiles.entryAgentId) ?? currentFiles?.agents[0];
  const assetRows: AssetDiffRow[] = [
    {
      key: "entryAgentId",
      label: "入口 Agent",
      before: currentFiles?.entryAgentId,
      after: preview.entryAgentId,
      changed: comparisonMode === "INITIAL" ? Boolean(preview.entryAgentId) : normalizeText(currentFiles?.entryAgentId) !== normalizeText(preview.entryAgentId)
    },
    {
      key: "models",
      label: "模型",
      before: joinList(currentFiles?.models.map((item) => item.id) ?? []),
      after: joinList(preview.modelIds),
      changed: listDiff(currentFiles?.models.map((item) => item.id), preview.modelIds, comparisonMode).changed
    },
    {
      key: "toolsets",
      label: "工具集",
      before: joinList(currentFiles?.toolsets.map((item) => item.id) ?? []),
      after: joinList(preview.toolsetIds),
      changed: listDiff(currentFiles?.toolsets.map((item) => item.id), preview.toolsetIds, comparisonMode).changed
    },
    {
      key: "agents",
      label: "Agent",
      before: joinList(currentFiles?.agents.map((item) => item.id) ?? []),
      after: joinList(preview.agentIds),
      changed: listDiff(currentFiles?.agents.map((item) => item.id), preview.agentIds, comparisonMode).changed
    },
    {
      key: "scripts",
      label: "脚本",
      before: joinList(currentFiles?.scripts.map((item) => item.id) ?? []),
      after: joinList(preview.scriptIds),
      changed: listDiff(currentFiles?.scripts.map((item) => item.id), preview.scriptIds, comparisonMode).changed
    }
  ].filter((item) => item.changed || comparisonMode === "INITIAL");

  const agentTools: AgentToolDiffResult = {
    toolsetIds: listDiff(currentEntryAgent?.toolsetIds, sourceToolsetIds, comparisonMode),
    directToolNames: listDiff(currentEntryAgent?.directToolNames, sourceDirectToolNames, comparisonMode),
    directToolOptions: diffAgentToolConfigs(currentEntryAgent?.directToolOptions ?? {}, sourceDirectToolOptions, comparisonMode)
  };

  const configTemplate = diffConfigTemplates(currentPackage?.configTemplate ?? [], preview.configTemplate, comparisonMode);
  const externalDependencies = diffDependencies(currentFiles?.externalDependencies ?? [], preview.externalDependencies, comparisonMode);
  const hasChanges =
    assetRows.some((item) => item.changed) ||
    agentTools.toolsetIds.changed ||
    agentTools.directToolNames.changed ||
    agentTools.directToolOptions.added.length > 0 ||
    agentTools.directToolOptions.removed.length > 0 ||
    agentTools.directToolOptions.modified.length > 0 ||
    configTemplate.added.length > 0 ||
    configTemplate.removed.length > 0 ||
    configTemplate.modified.length > 0 ||
    externalDependencies.added.length > 0 ||
    externalDependencies.removed.length > 0 ||
    externalDependencies.modified.length > 0;

  return {
    comparisonMode,
    hasChanges,
    assetRows,
    agentTools,
    configTemplate,
    externalDependencies
  };
}

function renderText(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function renderChangeSummary(changes: Array<{ field: string; before: unknown; after: unknown }>): string {
  return changes
    .map((item) => `${item.field}: ${renderText(item.before)} → ${renderText(item.after)}`)
    .join("；");
}

function renderDependencyTable(
  title: string,
  items: RepositoryAiPackageDependency[],
  emptyText: string
) {
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  const columns: ColumnsType<RepositoryAiPackageDependency> = [
    { title: "类型", dataIndex: "assetType", key: "assetType", width: 120 },
    { title: "仓库", dataIndex: "repositoryId", key: "repositoryId" },
    { title: "资产", dataIndex: "assetId", key: "assetId" },
    { title: "版本", dataIndex: "version", key: "version" }
  ];

  return (
    <Card type="inner" title={title}>
      <Table
        rowKey={(record) => keyOfDependency(record)}
        size="small"
        pagination={false}
        dataSource={items}
        columns={columns}
      />
    </Card>
  );
}

function renderTemplateTable(
  title: string,
  items: RepositoryConfigTemplateItem[],
  emptyText: string
) {
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  const columns: ColumnsType<RepositoryConfigTemplateItem> = [
    { title: "配置键", dataIndex: "key", key: "key", render: (value: string) => <Text code>{value}</Text> },
    { title: "说明", dataIndex: "label", key: "label", render: (value?: string) => value || "-" },
    { title: "类型", dataIndex: "type", key: "type" },
    { title: "必填", dataIndex: "required", key: "required", render: (value: boolean) => <Tag>{value ? "是" : "否"}</Tag> },
    { title: "密钥", dataIndex: "secret", key: "secret", render: (value: boolean) => <Tag color={value ? "gold" : undefined}>{value ? "SECRET" : "PLAIN"}</Tag> },
    { title: "默认值", dataIndex: "defaultValue", key: "defaultValue", render: (value?: string) => value || "-" }
  ];

  return (
    <Card type="inner" title={title}>
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={items}
        columns={columns}
      />
    </Card>
  );
}

function renderListDiffCard(title: string, diff: StringListDiff, emptyText: string) {
  const rows = buildListDiffRows(diff);
  if (rows.length === 0) {
    return null;
  }

  return (
    <Card type="inner" title={`${title} (${rows.length})`}>
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: "项目", dataIndex: "item", key: "item", render: (value: string) => <Text code>{value}</Text> },
          { title: "旧值", dataIndex: "before", key: "before", render: renderText },
          { title: "新值", dataIndex: "after", key: "after", render: renderText },
          {
            title: "状态",
            dataIndex: "status",
            key: "status",
            width: 100,
            render: (value: ListDiffRow["status"]) => (
              <Tag color={value === "ADDED" ? "blue" : "red"}>{value === "ADDED" ? "新增" : "删除"}</Tag>
            )
          }
        ]}
      />
    </Card>
  );
}

function renderToolConfigDiffCard(diff: AgentToolDiffResult["directToolOptions"]) {
  const rows = buildToolConfigDiffRows(diff);
  if (rows.length === 0) {
    return null;
  }

  return (
    <Card type="inner" title={`直接工具配置 (${rows.length})`}>
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: "工具", dataIndex: "toolName", key: "toolName", render: (value: string) => <Text code>{value}</Text> },
          { title: "旧值", dataIndex: "before", key: "before", render: (value: string) => <Typography.Text style={{ whiteSpace: "pre-wrap" }}>{value}</Typography.Text> },
          { title: "新值", dataIndex: "after", key: "after", render: (value: string) => <Typography.Text style={{ whiteSpace: "pre-wrap" }}>{value}</Typography.Text> },
          {
            title: "状态",
            dataIndex: "status",
            key: "status",
            width: 110,
            render: (value: ToolConfigDiffRow["status"]) => {
              if (value === "MODIFIED") {
                return <Tag color="processing">变更</Tag>;
              }
              return <Tag color={value === "ADDED" ? "blue" : "red"}>{value === "ADDED" ? "新增" : "删除"}</Tag>;
            }
          }
        ]}
      />
    </Card>
  );
}

export function RepositoryAiPackageDiffPanel({
  currentPackage,
  preview,
  sourceToolsetIds,
  sourceDirectToolNames,
  sourceDirectToolOptions
}: RepositoryAiPackageDiffPanelProps) {
  const diff = buildRepositoryAiPackageDiff(
    currentPackage,
    preview,
    sourceToolsetIds,
    sourceDirectToolNames,
    sourceDirectToolOptions
  );
  const hasAgentToolChanges =
    diff.agentTools.toolsetIds.changed ||
    diff.agentTools.directToolNames.changed ||
    diff.agentTools.directToolOptions.added.length > 0 ||
    diff.agentTools.directToolOptions.removed.length > 0 ||
    diff.agentTools.directToolOptions.modified.length > 0;
  const assetChangeCount = diff.assetRows.filter((item) => item.changed).length;
  const agentToolChangeCount = [
    diff.agentTools.toolsetIds.changed,
    diff.agentTools.directToolNames.changed,
    diff.agentTools.directToolOptions.added.length > 0,
    diff.agentTools.directToolOptions.removed.length > 0,
    diff.agentTools.directToolOptions.modified.length > 0
  ].filter(Boolean).length;
  const configTemplateChangeCount =
    diff.configTemplate.added.length + diff.configTemplate.removed.length + diff.configTemplate.modified.length;
  const dependencyChangeCount =
    diff.externalDependencies.added.length + diff.externalDependencies.removed.length + diff.externalDependencies.modified.length;

  if (!diff.hasChanges) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前预览与仓库版本没有差异" />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {diff.comparisonMode === "INITIAL" ? (
        <Alert
          type="info"
          showIcon
          message="当前仓库没有同 packageId 的 AI 能力包"
          description="以下内容将作为首次发布写入仓库。"
        />
      ) : (
        <Alert
          type="info"
          showIcon
          message="已加载当前仓库 AI 包，并与本次发布预览对比"
          description="只展示发生变化的部分。"
        />
      )}

      <Tabs
        destroyOnHidden
        items={[
          {
            key: "assets",
            label: `资产${assetChangeCount > 0 ? ` (${assetChangeCount})` : ""}`,
            children: (
              <Card size="small" title="资产变更">
                {diff.assetRows.filter((item) => item.changed).length > 0 ? (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="key"
                    dataSource={diff.assetRows.filter((item) => item.changed)}
                    columns={[
                      { title: "项目", dataIndex: "label", key: "label", width: 140 },
                      { title: "旧值", dataIndex: "before", key: "before", render: renderText },
                      { title: "新值", dataIndex: "after", key: "after", render: renderText },
                      {
                        title: "状态",
                        dataIndex: "changed",
                        key: "changed",
                        width: 110,
                        render: () => <Tag color={diff.comparisonMode === "INITIAL" ? "blue" : "processing"}>{diff.comparisonMode === "INITIAL" ? "新增" : "变更"}</Tag>
                      }
                    ]}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="资产没有变化" />
                )}
              </Card>
            )
          },
          {
            key: "tools",
            label: `Agent 工具${agentToolChangeCount > 0 ? ` (${agentToolChangeCount})` : ""}`,
            children: hasAgentToolChanges ? (
              <Card size="small" title="Agent 工具">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {renderListDiffCard("工具集", diff.agentTools.toolsetIds, "工具集没有变化")}
                  {renderListDiffCard("直接工具", diff.agentTools.directToolNames, "直接工具没有变化")}
                  {renderToolConfigDiffCard(diff.agentTools.directToolOptions)}
                </Space>
              </Card>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Agent 工具没有变化" />
            )
          },
          {
            key: "config",
            label: `配置模板${configTemplateChangeCount > 0 ? ` (${configTemplateChangeCount})` : ""}`,
            children: (
              <Card size="small" title="配置模板">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {diff.configTemplate.added.length > 0 ? renderTemplateTable("新增配置模板", diff.configTemplate.added, "没有新增配置模板") : null}
                  {diff.configTemplate.removed.length > 0 ? renderTemplateTable("删除配置模板", diff.configTemplate.removed, "没有删除配置模板") : null}
                  {diff.configTemplate.modified.length > 0 ? (
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="key"
                      dataSource={diff.configTemplate.modified}
                      columns={[
                        { title: "配置键", dataIndex: "key", key: "key", render: (value: string) => <Text code>{value}</Text> },
                        { title: "变化", dataIndex: "changes", key: "changes", render: (value: ConfigTemplateChange["changes"]) => renderChangeSummary(value) },
                        { title: "旧值", dataIndex: "before", key: "before", render: (_value, record: ConfigTemplateChange) => renderTemplateSummary(record.before as RepositoryConfigTemplateItem) },
                        { title: "新值", dataIndex: "after", key: "after", render: (_value, record: ConfigTemplateChange) => renderTemplateSummary(record.after as RepositoryConfigTemplateItem) }
                      ]}
                    />
                  ) : null}
                  {diff.configTemplate.added.length === 0 && diff.configTemplate.removed.length === 0 && diff.configTemplate.modified.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="配置模板没有变化" />
                  ) : null}
                </Space>
              </Card>
            )
          },
          {
            key: "deps",
            label: `外部依赖${dependencyChangeCount > 0 ? ` (${dependencyChangeCount})` : ""}`,
            children: (
              <Card size="small" title="外部依赖">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {diff.externalDependencies.added.length > 0 ? renderDependencyTable("新增外部依赖", diff.externalDependencies.added, "没有新增外部依赖") : null}
                  {diff.externalDependencies.removed.length > 0 ? renderDependencyTable("删除外部依赖", diff.externalDependencies.removed, "没有删除外部依赖") : null}
                  {diff.externalDependencies.modified.length > 0 ? (
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="key"
                      dataSource={diff.externalDependencies.modified}
                      columns={[
                        { title: "依赖", dataIndex: "key", key: "key", render: (_value, record: DependencyChange) => <Text code>{renderDependencySummary(record.after ?? record.before!)}</Text> },
                        { title: "变化", dataIndex: "changes", key: "changes", render: (value: DependencyChange["changes"]) => renderChangeSummary(value) },
                        { title: "旧值", dataIndex: "before", key: "before", render: (_value, record: DependencyChange) => renderText(record.before?.version) },
                        { title: "新值", dataIndex: "after", key: "after", render: (_value, record: DependencyChange) => renderText(record.after?.version) }
                      ]}
                    />
                  ) : null}
                  {diff.externalDependencies.added.length === 0 && diff.externalDependencies.removed.length === 0 && diff.externalDependencies.modified.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="外部依赖没有变化" />
                  ) : null}
                </Space>
              </Card>
            )
          }
        ]}
      />
    </Space>
  );
}
