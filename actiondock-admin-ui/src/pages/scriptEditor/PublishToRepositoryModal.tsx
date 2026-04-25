import {
  Alert,
  Card,
  Checkbox,
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
import type { ConfigValue, PluginDependency, RepositoryDefinition, ScriptSchedule } from "../../types";

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
  form: FormInstance;
  repositories: RepositoryDefinition[];
  schedules: ScriptSchedule[];
  configValues: ConfigValue[];
  configModes: Record<string, "INLINE" | "PLACEHOLDER">;
  onConfigModesChange: React.Dispatch<React.SetStateAction<Record<string, "INLINE" | "PLACEHOLDER">>>;
  pluginDependencies: PluginDependency[];
}

import type { FormInstance } from "antd";

export function PublishToRepositoryModal({
  open,
  onCancel,
  onOk,
  confirmLoading,
  metadataLoading,
  form,
  repositories,
  schedules,
  configValues,
  configModes,
  onConfigModesChange,
  pluginDependencies
}: PublishToRepositoryModalProps) {
  return (
    <Modal
      title="发布到仓库"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="发布"
      cancelText="取消"
      confirmLoading={confirmLoading}
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
          <Form form={form} layout="vertical">
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

          <Card type="inner" title={`配置模板 (${configValues.length})`}>
            {configValues.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可选配置值" />
            ) : (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {configValues.map((item) => {
                  const selectedMode = configModes[item.key];
                  return (
                    <div key={item.key} className="repository-config-publish-row">
                      <Checkbox
                        checked={Boolean(selectedMode)}
                        onChange={(event) => {
                          if (!event.target.checked) {
                            onConfigModesChange((previous) => {
                              const next = { ...previous };
                              delete next[item.key];
                              return next;
                            });
                            return;
                          }
                          onConfigModesChange((previous) => ({
                            ...previous,
                            [item.key]: previous[item.key] ?? "PLACEHOLDER"
                          }));
                        }}
                      >
                        <Space direction="vertical" size={2}>
                          <Text code>{item.key}</Text>
                          <Text type="secondary">{item.description || "未填写说明"}</Text>
                        </Space>
                      </Checkbox>
                      <Select
                        value={selectedMode}
                        disabled={!selectedMode}
                        style={{ width: 160 }}
                        options={[
                          { value: "PLACEHOLDER", label: "PLACEHOLDER" },
                          { value: "INLINE", label: "INLINE" }
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
                })}
              </Space>
            )}
          </Card>
        </Space>
      )}
    </Modal>
  );
}
