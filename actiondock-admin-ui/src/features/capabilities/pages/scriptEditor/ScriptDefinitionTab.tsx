import { CodeOutlined } from "@ant-design/icons";
import { Card, Empty, Form, Input, InputNumber, Row, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { Col } from "../../../../components/common/SafeCol";
import { CodeEditor } from "../../../../components/common/CodeEditor";
import { SchemaBuilder } from "../../../../components/schema/SchemaBuilder";
import type { FormInstance } from "antd";
import type { PluginReferenceView, ScriptDefinition, ScriptType } from "../../../../shared/types";
import type { SchemaEditorState } from "../../../../services/schema";
import { getPublishedScriptContent, hasScriptDraftChanges } from "../../../../services/scriptPublication";
import {
  getSourceFileName,
  getSourceLanguage,
  getScriptContentHint,
  getEditorFooterHint,
  type ScriptEditorFormValues
} from "./types";

const { Text } = Typography;

function getPluginReferenceSourceLabel(sourceType: PluginReferenceView["sourceType"]): string {
  return sourceType === "SYSTEM" ? "系统" : "插件";
}

interface ScriptDefinitionTabProps {
  form: FormInstance<ScriptEditorFormValues>;
  mode: "create" | "edit";
  selectedScriptType: ScriptType;
  sourceText: string;
  onSourceTextChange: (text: string) => void;
  inputSchemaState: SchemaEditorState;
  onInputSchemaStateChange: (state: SchemaEditorState) => void;
  outputSchemaState: SchemaEditorState;
  onOutputSchemaStateChange: (state: SchemaEditorState) => void;
  isReadOnlyScript: boolean;
  editorTheme: "vs-light" | "vs-dark";
  onScriptTypeChange: (type: ScriptType) => void;
  availableScripts: ScriptDefinition[];
  filteredScriptReferences: ScriptDefinition[];
  scriptReferenceQuery: string;
  onScriptReferenceQueryChange: (query: string) => void;
  scriptReferencePage: number;
  onScriptReferencePageChange: (page: number) => void;
  scriptReferencePageSize: number;
  onScriptReferencePageSizeChange: (size: number) => void;
  onScriptReferenceClick: (id: string) => void;
  scriptsLoading: boolean;
  filteredPluginReferences: PluginReferenceView[];
  pluginReferenceQuery: string;
  onPluginReferenceQueryChange: (query: string) => void;
  pluginReferencePage: number;
  onPluginReferencePageChange: (page: number) => void;
  pluginReferencePageSize: number;
  onPluginReferencePageSizeChange: (size: number) => void;
  onPluginReferenceClick: (id: string) => void;
  pluginsLoading: boolean;
  selectedScriptTypeForReferences: ScriptType;
}

export function ScriptDefinitionTab({
  form,
  mode,
  selectedScriptType,
  sourceText,
  onSourceTextChange,
  inputSchemaState,
  onInputSchemaStateChange,
  outputSchemaState,
  onOutputSchemaStateChange,
  isReadOnlyScript,
  editorTheme,
  onScriptTypeChange,
  availableScripts,
  filteredScriptReferences,
  scriptReferenceQuery,
  onScriptReferenceQueryChange,
  scriptReferencePage,
  onScriptReferencePageChange,
  scriptReferencePageSize,
  onScriptReferencePageSizeChange,
  onScriptReferenceClick,
  scriptsLoading,
  filteredPluginReferences,
  pluginReferenceQuery,
  onPluginReferenceQueryChange,
  pluginReferencePage,
  onPluginReferencePageChange,
  pluginReferencePageSize,
  onPluginReferencePageSizeChange,
  onPluginReferenceClick,
  pluginsLoading,
  selectedScriptTypeForReferences
}: ScriptDefinitionTabProps) {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={8}>
        <Card title="基础信息">
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              id: "",
              name: "",
              type: "GROOVY",
              packaging: "TOOL"
            }}
          >
            <Row gutter={12}>
              <Col xs={24} md={12} xl={24}>
                <Form.Item
                  label="脚本 ID"
                  name="id"
                  rules={[
                    { required: true, message: "请输入脚本 ID" },
                    {
                      pattern: /^[A-Za-z0-9_-]+$/,
                      message: "仅支持字母、数字、下划线和中横线"
                    },
                    {
                      validator: async (_, value: string | undefined) => {
                        if (mode !== "create" || !value?.trim()) return;
                        if (availableScripts.some((script) => script.id === value.trim())) {
                          throw new Error("脚本 ID 已存在");
                        }
                      }
                    }
                  ]}
                >
                  <Input disabled={mode === "edit" || isReadOnlyScript} placeholder="例如 hello-groovy" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12} xl={12}>
                <Form.Item
                  label="名称"
                  name="name"
                  rules={[{ required: true, message: "请输入脚本名称" }]}
                >
                  <Input placeholder="例如 Hello Groovy" disabled={isReadOnlyScript} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12} xl={6}>
                <Form.Item label="类型" name="type">
                  <Select
                    disabled={isReadOnlyScript}
                    onChange={onScriptTypeChange}
                    options={[
                      { value: "GROOVY", label: "GROOVY" },
                      { value: "PYTHON", label: "PYTHON" }
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12} xl={6}>
                <Form.Item label="打包属性" name="packaging">
                  <Select
                    disabled={isReadOnlyScript}
                    options={[
                      { value: "TOOL", label: "TOOL" },
                      { value: "FLOW", label: "FLOW" }
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item
                  label="历史记录保留上限"
                  name="maxExecutionRecords"
                  tooltip="限制每个脚本最多保留的执行历史记录数量，默认 1000 条，超出限制将自动清理旧的历史记录。"
                  rules={[
                    {
                      required: true,
                      message: "请输入保留记录上限"
                    }
                  ]}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    min={1}
                    max={100000}
                    placeholder="默认 1000"
                    disabled={isReadOnlyScript}
                  />
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item label="说明" name="description">
                  <Input.TextArea
                    autoSize={{ minRows: 5, maxRows: 12 }}
                    disabled={isReadOnlyScript}
                    placeholder="脚本自己的说明，支持 Markdown 语法；发布到仓库时会作为脚本说明"
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={16}>
        <Card
          title="脚本内容"
          extra={<Text type="secondary">{getScriptContentHint(selectedScriptType)}</Text>}
        >
          <Tabs
            items={[
              {
                key: "source",
                label: getSourceFileName(selectedScriptType),
                children: (
                  <CodeEditor
                    height="clamp(320px, 60vh, 420px)"
                    language={getSourceLanguage(selectedScriptType)}
                    value={sourceText}
                    onChange={onSourceTextChange}
                    theme={editorTheme}
                    readOnly={isReadOnlyScript}
                  />
                )
              },
              ...(selectedScriptType === "PYTHON"
                ? [
                    {
                      key: "requirements",
                      label: "requirements.txt",
                      children: (
                        <Form.Item name="pythonRequirements" style={{ marginBottom: 0 }}>
                          <Input.TextArea
                            autoSize={{ minRows: 16, maxRows: 24 }}
                            disabled={isReadOnlyScript}
                            placeholder={"例如:\nrequests==2.32.3\npydantic>=2.7,<3\n--index-url https://pypi.org/simple"}
                          />
                        </Form.Item>
                      )
                    }
                  ]
                : []),
              {
                key: "input",
                label: "inputSchema.json",
                children: (
                  <SchemaBuilder
                    label="输入结构"
                    value={inputSchemaState}
                    onChange={onInputSchemaStateChange}
                    theme={editorTheme}
                    disabled={isReadOnlyScript}
                  />
                )
              },
              {
                key: "output",
                label: "outputSchema.json",
                children: (
                  <SchemaBuilder
                    label="输出结构"
                    value={outputSchemaState}
                    onChange={onOutputSchemaStateChange}
                    theme={editorTheme}
                    disabled={isReadOnlyScript}
                    allowRichTextWidgets
                  />
                )
              }
            ]}
          />
          <Space className="editor-footer">
            <CodeOutlined />
            <Text type="secondary">{getEditorFooterHint(selectedScriptType)}</Text>
          </Space>

          <Card
            type="inner"
            title="脚本参考"
            style={{ marginTop: 16 }}
            extra={<Text type="secondary">仅展示已发布脚本，支持名称 / ID 查询</Text>}
            loading={scriptsLoading}
          >
            {filteredScriptReferences.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="当前没有可调用的已发布脚本。"
              />
            ) : (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Input.Search
                  allowClear
                  value={scriptReferenceQuery}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => onScriptReferenceQueryChange(event.target.value)}
                  placeholder="搜索脚本名称或 scriptId"
                />
                <Table<ScriptDefinition>
                  size="small"
                  rowKey="id"
                  showHeader={false}
                  columns={[
                    {
                      key: "name",
                      dataIndex: "name",
                      render: (_value: string, script: ScriptDefinition) => {
                        const published = getPublishedScriptContent(script);
                        return (
                          <Space wrap size={[8, 8]}>
                            <Text>{script.name || script.id}</Text>
                            {published ? <Tag>{published.type}</Tag> : null}
                            {hasScriptDraftChanges(script) ? <Tag color="gold">有草稿</Tag> : null}
                          </Space>
                        );
                      }
                    }
                  ]}
                  dataSource={filteredScriptReferences}
                  pagination={{
                    current: scriptReferencePage,
                    pageSize: scriptReferencePageSize,
                    showSizeChanger: true,
                    pageSizeOptions: [10, 20, 50],
                    showTotal: (total: number) => `共 ${total} 个脚本`,
                    onChange: (page: number, pageSize: number) => {
                      onScriptReferencePageChange(page);
                      onScriptReferencePageSizeChange(pageSize);
                    }
                  }}
                  locale={{ emptyText: "没有匹配的脚本" }}
                  onRow={(script: ScriptDefinition) => ({
                    onClick: () => onScriptReferenceClick(script.id)
                  })}
                />
              </Space>
            )}
          </Card>

          {selectedScriptTypeForReferences === "GROOVY" ? (
            <Card
              type="inner"
              title="插件参考"
              style={{ marginTop: 16 }}
              extra={<Text type="secondary">支持名称 / ID 查询</Text>}
              loading={pluginsLoading}
            >
              {filteredPluginReferences.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="当前没有可用插件参考。"
                />
              ) : (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Input.Search
                    allowClear
                    value={pluginReferenceQuery}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => onPluginReferenceQueryChange(event.target.value)}
                    placeholder="搜索插件名称或 pluginId"
                  />
                  <Table<PluginReferenceView>
                    size="small"
                    rowKey="pluginId"
                    showHeader={false}
                    columns={[
                      {
                        key: "name",
                        dataIndex: "name",
                        render: (_value: string, plugin: PluginReferenceView) => (
                          <Space wrap size={[8, 8]}>
                            <Text>{plugin.name || plugin.pluginId}</Text>
                            <Tag color={plugin.sourceType === "SYSTEM" ? "processing" : "default"}>
                              {getPluginReferenceSourceLabel(plugin.sourceType)}
                            </Tag>
                          </Space>
                        )
                      }
                    ]}
                    dataSource={filteredPluginReferences}
                    pagination={{
                      current: pluginReferencePage,
                      pageSize: pluginReferencePageSize,
                      showSizeChanger: true,
                      pageSizeOptions: [10, 20, 50],
                      showTotal: (total: number) => `共 ${total} 个插件参考`,
                      onChange: (page: number, pageSize: number) => {
                        onPluginReferencePageChange(page);
                        onPluginReferencePageSizeChange(pageSize);
                      }
                    }}
                    locale={{ emptyText: "没有匹配的插件参考" }}
                    onRow={(plugin: PluginReferenceView) => ({
                      onClick: () => onPluginReferenceClick(plugin.pluginId)
                    })}
                  />
                </Space>
              )}
            </Card>
          ) : null}
        </Card>
      </Col>
    </Row>
  );
}
