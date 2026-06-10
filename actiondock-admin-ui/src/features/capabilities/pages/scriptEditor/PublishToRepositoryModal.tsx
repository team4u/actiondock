import {
  Alert,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography
} from "antd";
import type { FormInstance } from "antd";
import { ScriptDiffPanel } from "../../../../components/diff/ScriptDiffPanel";
import { RepositoryPublishBasicsForm } from "../../../../components/repository/RepositoryPublishBasicsForm";
import type {
  PluginDependency,
  RepositoryDefinition,
  RepositoryPublishConfigPreview,
  RepositoryScriptDescriptor,
  ScriptSchedule,
  ScriptType
} from "../../../../shared/types";
import type { PublishScriptDependencyDraft, PublishToRepositoryFormValues, RepositoryPublishVersionSuggestion } from "./types";

const { Text } = Typography;

function renderPluginDependencyList(dependencies: PluginDependency[]) {
  if (dependencies.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前源码没有检测到插件调用" />;
  }

  return (
    <Space direction="vertical" size={10} style={{ width: "100%" }}>
      {dependencies.map((dependency) => (
        <div key={dependency.pluginId} className="plugin-dependency-row">
          <Space direction="vertical" size={4}>
            <Space wrap size={[8, 8]}>
              <Text code>{dependency.pluginId}</Text>
              {dependency.versionRange ? <Tag color="blue">{dependency.versionRange}</Tag> : <Tag>未锁定版本</Tag>}
            </Space>
            <Space wrap size={[6, 6]}>
              {dependency.requiredActions.length > 0 ? (
                dependency.requiredActions.map((action) => <Tag key={action}>{action}</Tag>)
              ) : (
                <Text type="secondary">未声明动作</Text>
              )}
            </Space>
          </Space>
        </div>
      ))}
    </Space>
  );
}

function renderScriptDependencyList(
  dependencies: PublishScriptDependencyDraft[],
  repositories: RepositoryDefinition[],
  repositoryTools: RepositoryScriptDescriptor[],
  onChange: (scriptId: string, changedValues: Partial<PublishScriptDependencyDraft>) => void
) {
  if (dependencies.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前源码没有检测到 scripts.invoke(...) 调用" />;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {dependencies.map((dependency) => {
        const toolOptions = repositoryTools
          .filter((item) => item.repositoryId === dependency.repositoryId)
          .map((item) => ({
            value: item.scriptId,
            label: `${item.displayName} (${item.scriptId})`
          }));
        return (
          <div key={dependency.scriptId} className="plugin-dependency-row">
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Space wrap size={[8, 8]}>
                <Text code>{dependency.scriptId}</Text>
                {dependency.state === "AUTO" ? <Tag color="green">已自动匹配</Tag> : null}
                {dependency.state === "UNRESOLVED" ? <Tag color="orange">未匹配</Tag> : null}
                {dependency.versionRange ? <Tag color="blue">{dependency.versionRange}</Tag> : <Tag>待补全版本</Tag>}
              </Space>
              {dependency.state === "AUTO" && dependency.repositoryId && dependency.repositoryScriptId ? (
                <Text type="secondary">已自动匹配到 {dependency.repositoryId} / {dependency.repositoryScriptId}</Text>
              ) : null}
              <Space size={12} style={{ width: "100%" }} wrap>
                <Select
                  value={dependency.repositoryId}
                  placeholder="选择仓库"
                  style={{ flex: "1 1 180px", minWidth: 180 }}
                  options={repositories.map((item) => ({
                    value: item.id,
                    label: item.name
                  }))}
                  onChange={(value) => onChange(dependency.scriptId, {
                    repositoryId: value,
                    repositoryScriptId: undefined,
                    versionRange: undefined
                  })}
                />
                <Select
                  value={dependency.repositoryScriptId}
                  placeholder="选择依赖脚本"
                  style={{ flex: "2 1 260px", minWidth: 260 }}
                  options={toolOptions}
                  disabled={!dependency.repositoryId}
                  onChange={(value) => onChange(dependency.scriptId, { repositoryScriptId: value, versionRange: undefined })}
                />
                <Input
                  value={dependency.versionRange}
                  placeholder="例如 >= 1.0.0"
                  style={{ flex: "1 1 180px", minWidth: 180 }}
                  onChange={(event) => onChange(dependency.scriptId, { versionRange: event.target.value })}
                />
              </Space>
            </Space>
          </div>
        );
      })}
    </Space>
  );
}

interface PublishToRepositoryModalProps {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  confirmLoading: boolean;
  metadataLoading: boolean;
  form: FormInstance<PublishToRepositoryFormValues>;
  versionSuggestion: RepositoryPublishVersionSuggestion;
  repositories: RepositoryDefinition[];
  dependencyRepositories: RepositoryDefinition[];
  schedules: ScriptSchedule[];
  configPreview: RepositoryPublishConfigPreview | null;
  configPreviewLoading: boolean;
  repositoryDiff: import("../../../../services/scriptDiff").ScriptDiffResult | null;
  repositoryDiffLoading: boolean;
  repositoryContentUnchanged: boolean;
  theme: "vs-light" | "vs-dark";
  targetType?: ScriptType;
  repositoryTools: RepositoryScriptDescriptor[];
  scriptDependencies: PublishScriptDependencyDraft[];
  hasDynamicScriptDependencies: boolean;
  configModes: Record<string, "INLINE" | "PLACEHOLDER">;
  onConfigModesChange: React.Dispatch<React.SetStateAction<Record<string, "INLINE" | "PLACEHOLDER">>>;
  onScriptDependencyChange: (scriptId: string, changedValues: Partial<PublishScriptDependencyDraft>) => void;
  onValuesChange: (changedValues: Partial<PublishToRepositoryFormValues>) => void;
  pluginDependencies: PluginDependency[];
}

function renderVersionSuggestion(suggestion: RepositoryPublishVersionSuggestion) {
  if (suggestion.status === "LOADING") {
    return (
      <Space size={6}>
        <Spin size="small" />
        <Text type="secondary">正在同步目标仓库并拉取当前版本</Text>
      </Space>
    );
  }
  if (suggestion.status === "READY") {
    return (
      <Text type="secondary">
        仓库当前版本 {suggestion.currentVersion}，建议发布 {suggestion.suggestedVersion}
        {suggestion.autoFilled ? "，已自动填入。" : "；你已手动修改，未覆盖。"}
      </Text>
    );
  }
  if (suggestion.status === "MANUAL") {
    return <Text type="warning">仓库当前版本 {suggestion.currentVersion} 无法自动递增，请手动填写新版本。</Text>;
  }
  if (suggestion.status === "NOT_FOUND") {
    return <Text type="secondary">目标仓库暂无该脚本版本。</Text>;
  }
  if (suggestion.status === "ERROR") {
    return <Text type="danger">{suggestion.message}</Text>;
  }
  return null;
}

export function PublishToRepositoryModal({
  open,
  onCancel,
  onOk,
  confirmLoading,
  metadataLoading,
  form,
  versionSuggestion,
  repositories,
  dependencyRepositories,
  schedules,
  configPreview,
  configPreviewLoading,
  repositoryDiff,
  repositoryDiffLoading,
  repositoryContentUnchanged,
  theme,
  targetType,
  repositoryTools,
  scriptDependencies,
  hasDynamicScriptDependencies,
  configModes,
  onConfigModesChange,
  onScriptDependencyChange,
  onValuesChange,
  pluginDependencies
}: PublishToRepositoryModalProps) {
  const hasMissingConfigKeys = Boolean(configPreview?.missingKeys.length);
  const detectedConfigItems = configPreview?.items ?? [];
  const hasIncompleteScriptDependencies = scriptDependencies.some((item) => !item.repositoryId || !item.repositoryScriptId);
  const hasNoRepositoryChanges = repositoryDiff?.hasChanges === false;

  return (
    <Modal
      title="发布到仓库"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="发布"
      cancelText="取消"
      confirmLoading={confirmLoading}
      okButtonProps={{
        disabled: metadataLoading
          || configPreviewLoading
          || repositoryDiffLoading
          || hasNoRepositoryChanges
          || repositoryContentUnchanged
          || hasMissingConfigKeys
          || hasDynamicScriptDependencies
          || hasIncompleteScriptDependencies
      }}
      width={1120}
      destroyOnHidden
    >
      {metadataLoading ? (
        <div className="page-loading"><Spin size="large" /></div>
      ) : (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {repositoryDiff ? (
            <Card type="inner" title="变更明细">
              <ScriptDiffPanel diff={repositoryDiff} theme={theme} targetType={targetType} />
            </Card>
          ) : null}
          <Form form={form} layout="vertical" onValuesChange={onValuesChange}>
            <RepositoryPublishBasicsForm
              repositories={repositories}
              afterRepository={(
                <Form.Item
                  label="仓库脚本 ID"
                  name="repositoryScriptId"
                  rules={[{ required: true, message: "请输入仓库脚本 ID" }]}
                >
                  <Input placeholder="例如 clear-cache" />
                </Form.Item>
              )}
              displayNamePlaceholder="例如 清理缓存"
              versionExtra={renderVersionSuggestion(versionSuggestion)}
              versionPlaceholder="例如 1.0.0"
              ownerPlaceholder="例如 platform-team"
              tagsPlaceholder="输入后回车"
              releaseNotesPlaceholder="本次发布的变更说明，支持 Markdown 语法"
              showDescription={false}
              showRiskLevel={false}
            />
            <Form.Item label={`定时任务模板 (${schedules.length})`} name="scheduleIds">
              <Select
                mode="multiple"
                placeholder={schedules.length > 0 ? "选择要一起发布的定时任务模板" : "当前脚本没有可发布的定时任务"}
                options={schedules.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.cronExpression}`
                }))}
                disabled={schedules.length === 0}
              />
            </Form.Item>
          </Form>

          <Card type="inner" title={`插件依赖 (${pluginDependencies.length})`}>
            {renderPluginDependencyList(pluginDependencies)}
            {pluginDependencies.length > 0 ? (
            <Text type="secondary">
                发布会把这些依赖写入仓库脚本描述；安装脚本时可选择同步安装或更新依赖插件。请先把对应插件发布到同一仓库。
              </Text>
            ) : null}
          </Card>

          <Card type="inner" title={`脚本依赖 (${scriptDependencies.length})`}>
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {hasDynamicScriptDependencies ? (
                <Alert
                  type="error"
                  showIcon
                  message="检测到动态脚本调用"
                  description="仓库发布仅支持字面量 scripts.invoke(...) 依赖，请先把动态脚本 ID 改成固定字符串。"
                />
              ) : null}
              {renderScriptDependencyList(scriptDependencies, dependencyRepositories, repositoryTools, onScriptDependencyChange)}
              {scriptDependencies.length > 0 ? (
                <Text type="secondary">
                  会优先在当前目标仓库内按同名脚本 ID 自动匹配，未命中时再扫描其他已启用仓库；你仍然可以手动改写。
                </Text>
              ) : null}
            </Space>
          </Card>

          <Card type="inner" title={`配置模板 (${detectedConfigItems.length})`}>
            {configPreviewLoading ? (
              <div className="page-loading"><Spin size="large" /></div>
            ) : (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {hasMissingConfigKeys ? (
                  <Alert
                    type="error"
                    showIcon
                    message="检测到缺失的配置依赖"
                    description={configPreview?.missingKeys.join(", ")}
                  />
                ) : null}
                {detectedConfigItems.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前源码和已选定时任务没有检测到配置引用" />
                ) : (
                  detectedConfigItems.map((item) => {
                    const forcedPlaceholder = Boolean(item.secret);
                    const selectedMode = forcedPlaceholder ? "PLACEHOLDER" : (configModes[item.key] ?? "PLACEHOLDER");
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
                          onChange={(nextValue) =>
                            onConfigModesChange((previous) => ({
                              ...previous,
                              [item.key]: nextValue
                            }))
                          }
                        />
                      </div>
                    );
                  })
                )}
              </Space>
            )}
          </Card>
        </Space>
      )}
    </Modal>
  );
}
