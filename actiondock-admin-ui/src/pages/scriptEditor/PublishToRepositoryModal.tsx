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
import type {
  PluginDependency,
  RepositoryDefinition,
  RepositoryPublishConfigPreview,
  ScriptSchedule
} from "../../types";
import type { PublishToRepositoryFormValues, RepositoryPublishVersionSuggestion } from "./types";

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

interface PublishToRepositoryModalProps {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  confirmLoading: boolean;
  metadataLoading: boolean;
  form: FormInstance<PublishToRepositoryFormValues>;
  versionSuggestion: RepositoryPublishVersionSuggestion;
  repositories: RepositoryDefinition[];
  schedules: ScriptSchedule[];
  configPreview: RepositoryPublishConfigPreview | null;
  configPreviewLoading: boolean;
  configModes: Record<string, "INLINE" | "PLACEHOLDER">;
  onConfigModesChange: React.Dispatch<React.SetStateAction<Record<string, "INLINE" | "PLACEHOLDER">>>;
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
    return <Text type="secondary">目标仓库暂无该工具版本。</Text>;
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
  schedules,
  configPreview,
  configPreviewLoading,
  configModes,
  onConfigModesChange,
  onValuesChange,
  pluginDependencies
}: PublishToRepositoryModalProps) {
  const hasMissingConfigKeys = Boolean(configPreview?.missingKeys.length);
  const detectedConfigItems = configPreview?.items ?? [];

  return (
    <Modal
      title="发布到仓库"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="发布"
      cancelText="取消"
      confirmLoading={confirmLoading}
      okButtonProps={{ disabled: metadataLoading || configPreviewLoading || hasMissingConfigKeys }}
      width={760}
      destroyOnHidden
    >
      {metadataLoading ? (
        <div className="page-loading"><Spin size="large" /></div>
      ) : (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="发布前会先执行本地保存、校验与发布"
            description="工具说明来自脚本自己的说明字段；这里填写的是本次版本发布日志。配置项只会按你选择的模式导出为模板。"
          />
          <Form form={form} layout="vertical" onValuesChange={onValuesChange}>
            <Form.Item
              label="目标仓库"
              name="repositoryId"
              rules={[{ required: true, message: "请选择目标仓库" }]}
            >
              <Select
                options={repositories.map((item) => ({
                  value: item.id,
                  label: item.name
                }))}
              />
            </Form.Item>
            <Space size={12} style={{ width: "100%" }} wrap>
              <Form.Item
                label="仓库工具 ID"
                name="toolId"
                rules={[{ required: true, message: "请输入 toolId" }]}
                style={{ flex: "1 1 220px", minWidth: 220 }}
              >
                <Input placeholder="例如 clear-cache" />
              </Form.Item>
              <Form.Item
                label="版本"
                name="version"
                rules={[{ required: true, message: "请输入版本号" }]}
                extra={renderVersionSuggestion(versionSuggestion)}
                style={{ flex: "1 1 160px", minWidth: 160 }}
              >
                <Input placeholder="例如 1.0.0" />
              </Form.Item>
            </Space>
            <Form.Item
              label="显示名称"
              name="displayName"
              rules={[{ required: true, message: "请输入显示名称" }]}
            >
              <Input placeholder="例如 清理缓存" />
            </Form.Item>
            <Space size={12} style={{ width: "100%" }} wrap>
              <Form.Item label="维护人" name="owner" style={{ flex: "1 1 220px", minWidth: 220 }}>
                <Input placeholder="例如 platform-team" />
              </Form.Item>
              <Form.Item label="标签" name="tags" style={{ flex: "1 1 320px", minWidth: 240 }}>
                <Select mode="tags" tokenSeparators={[","]} placeholder="输入后回车" />
              </Form.Item>
            </Space>
            <Form.Item label="发布日志" name="releaseNotes">
              <Input.TextArea
                autoSize={{ minRows: 5, maxRows: 12 }}
                placeholder="本次发布的变更说明，支持 Markdown 语法"
              />
            </Form.Item>
            <Form.Item label={`定时任务模板 (${schedules.length})`} name="scheduleIds">
              <Select
                mode="multiple"
                placeholder={schedules.length > 0 ? "选择要一起发布的定时任务模板" : "当前工具没有可发布的定时任务"}
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
                发布会把这些依赖写入仓库工具描述；安装工具时可选择同步安装或更新依赖插件。请先把对应插件发布到同一仓库。
              </Text>
            ) : null}
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
