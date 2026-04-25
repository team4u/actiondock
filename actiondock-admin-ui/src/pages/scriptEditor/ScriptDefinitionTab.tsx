import { CodeOutlined } from "@ant-design/icons";
import { Card, Col, Empty, Form, Input, Row, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { CodeEditor } from "../../components/CodeEditor";
import { SchemaBuilder } from "../../components/SchemaBuilder";
import type { FormInstance } from "antd";
import type { PluginView, ScriptDefinition, ScriptType } from "../../types";
import type { SchemaEditorState } from "../../schema";
import {
  getSourceFileName,
  getSourceLanguage,
  getScriptContentHint,
  getEditorFooterHint,
  type ScriptEditorFormValues
} from "./types";

const { Text } = Typography;

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
  availablePlugins: PluginView[];
  filteredPluginReferences: PluginView[];
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
              type: "GROOVY"
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
              <Col xs={24} md={12} xl={16}>
                <Form.Item
                  label="名称"
                  name="name"
                  rules={[{ required: true, message: "请输入脚本名称" }]}
                >
                  <Input placeholder="例如 Hello Groovy" disabled={isReadOnlyScript} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12} xl={8}>
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
                  onChange={(event) => onScriptReferenceQueryChange(event.target.value)}
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
                      render: (_value: string, script) => (
                        <Space wrap size={[8, 8]}>
                          <Text>{script.name || script.id}</Text>
                          {script.publishedSnapshot ? <Tag>{script.publishedSnapshot.type}</Tag> : null}
                          {script.hasUnpublishedChanges ? <Tag color="gold">有草稿</Tag> : null}
                        </Space>
                      )
                    }
                  ]}
                  dataSource={filteredScriptReferences}
                  pagination={{
                    current: scriptReferencePage,
                    pageSize: scriptReferencePageSize,
                    showSizeChanger: true,
                    pageSizeOptions: [10, 20, 50],
                    showTotal: (total) => `共 ${total} 个脚本`,
                    onChange: (page, pageSize) => {
                      onScriptReferencePageChange(page);
                      onScriptReferencePageSizeChange(pageSize);
                    }
                  }}
                  locale={{ emptyText: "没有匹配的脚本" }}
                  onRow={(script) => ({
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
                  description="当前没有已启动插件，可前往插件管理页安装并启动。"
                />
              ) : (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Input.Search
                    allowClear
                    value={pluginReferenceQuery}
                    onChange={(event) => onPluginReferenceQueryChange(event.target.value)}
                    placeholder="搜索插件名称或 pluginId"
                  />
                  <Table<PluginView>
                    size="small"
                    rowKey="pluginId"
                    showHeader={false}
                    columns={[
                      {
                        key: "name",
                        dataIndex: "name",
                        render: (_value: string, plugin) => plugin.name || plugin.pluginId
                      }
                    ]}
                    dataSource={filteredPluginReferences}
                    pagination={{
                      current: pluginReferencePage,
                      pageSize: pluginReferencePageSize,
                      showSizeChanger: true,
                      pageSizeOptions: [10, 20, 50],
                      showTotal: (total) => `共 ${total} 个插件`,
                      onChange: (page, pageSize) => {
                        onPluginReferencePageChange(page);
                        onPluginReferencePageSizeChange(pageSize);
                      }
                    }}
                    locale={{ emptyText: "没有匹配的插件" }}
                    onRow={(plugin) => ({
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
