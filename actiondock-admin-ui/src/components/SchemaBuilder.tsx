import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined
} from "@ant-design/icons";
import { Alert, Button, Empty, Input, InputNumber, Select, Space, Switch, Tabs, Typography } from "antd";
import { useEffect, useState } from "react";
import { CodeEditor } from "./CodeEditor";
import { InfoHint } from "./InfoHint";
import type { SchemaEditorState, SchemaFieldDraft, SchemaFieldKind } from "../schema";
import {
  createSchemaFieldDraft,
  deserializeSchemaJsonText,
  formatSchemaEditorState,
  validateSchemaFields
} from "../schema";

const { Text } = Typography;

const FIELD_TYPE_OPTIONS: Array<{ value: SchemaFieldKind; label: string }> = [
  { value: "string", label: "string" },
  { value: "number", label: "number" },
  { value: "integer", label: "integer" },
  { value: "boolean", label: "boolean" },
  { value: "enum", label: "enum" }
];

const STRING_WIDGET_OPTIONS = [
  { value: "input", label: "单行输入" },
  { value: "textarea", label: "多行输入" }
] as const;

const BOOLEAN_DEFAULT_OPTIONS = [
  { value: true, label: "true" },
  { value: false, label: "false" }
];

interface SchemaBuilderProps {
  label: string;
  value: SchemaEditorState;
  onChange: (nextValue: SchemaEditorState) => void;
  theme: "vs-light" | "vs-dark";
  disabled?: boolean;
}

function updateBuilderFields(
  value: SchemaEditorState,
  onChange: (nextValue: SchemaEditorState) => void,
  updater: (fields: SchemaFieldDraft[]) => SchemaFieldDraft[]
) {
  if (value.mode !== "builder") {
    return;
  }
  onChange({
    mode: "builder",
    fields: updater(value.fields)
  });
}

function BuilderUnavailable({
  label,
  reason
}: {
  label: string;
  reason: string;
}) {
  return (
    <Alert
      type="warning"
      showIcon
      message={`${label}暂不支持可视化编辑`}
      description="请使用 JSON 模式编辑。"
    />
  );
}

export function SchemaBuilder({ label, value, onChange, theme, disabled = false }: SchemaBuilderProps) {
  const [activeTab, setActiveTab] = useState<"builder" | "json">(value.mode === "json" ? "json" : "builder");

  useEffect(() => {
    if (value.mode === "json") {
      setActiveTab("json");
    }
  }, [value.mode]);

  const builderErrors = value.mode === "builder" ? validateSchemaFields(value.fields) : {};
  const jsonText = formatSchemaEditorState(value);

  const buildTypePatch = (field: SchemaFieldDraft, nextType: SchemaFieldKind): Partial<SchemaFieldDraft> => ({
    type: nextType,
    widget: nextType === "string" ? field.widget : "input",
    defaultValue: undefined
  });

  const setField = (fieldId: string, patch: Partial<SchemaFieldDraft>) => {
    updateBuilderFields(value, onChange, (fields) =>
      fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field))
    );
  };

  const moveField = (fieldId: string, direction: -1 | 1) => {
    updateBuilderFields(value, onChange, (fields) => {
      const currentIndex = fields.findIndex((field) => field.id === fieldId);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= fields.length) {
        return fields;
      }
      const nextFields = [...fields];
      [nextFields[currentIndex], nextFields[nextIndex]] = [nextFields[nextIndex], nextFields[currentIndex]];
      return nextFields;
    });
  };

  const removeField = (fieldId: string) => {
    updateBuilderFields(value, onChange, (fields) =>
      fields.filter((field) => field.id !== fieldId)
    );
  };

  const addField = () => {
    updateBuilderFields(value, onChange, (fields) => [...fields, createSchemaFieldDraft()]);
  };

  const handleJsonChange = (nextValue: string) => {
    onChange({
      mode: "json",
      jsonText: nextValue,
      reason: "当前正在直接编辑 JSON"
    });
  };

  const switchToBuilder = () => {
    if (value.mode !== "json") {
      setActiveTab("builder");
      return;
    }

    try {
      const nextState = deserializeSchemaJsonText(value.jsonText, label);
      if (nextState.mode === "builder") {
        onChange(nextState);
      }
      setActiveTab("builder");
    } catch {
      setActiveTab("builder");
    }
  };

  let jsonModeReason: string | null = null;
  if (value.mode === "json") {
    try {
      const parsedState = deserializeSchemaJsonText(value.jsonText, label);
      if (parsedState.mode === "json") {
        jsonModeReason = parsedState.reason;
      }
    } catch (error) {
      jsonModeReason = error instanceof Error ? error.message : `${label} 不是合法 JSON`;
    }
  }

  return (
    <div className="schema-builder">
      <Tabs
        activeKey={activeTab}
        onChange={(nextKey) => {
          if (disabled) {
            return;
          }
          if (nextKey === "builder") {
            switchToBuilder();
            return;
          }
          setActiveTab("json");
        }}
        items={[
          {
            key: "builder",
            label: "Builder",
            children:
              value.mode === "json" ? (
                <BuilderUnavailable label={label} reason={jsonModeReason ?? value.reason} />
              ) : (
                <>
                  <div className="schema-builder-toolbar">
                    <Space size={12}>
                      <Text strong>{label}</Text>
                      <Text type="secondary">{value.fields.length} 个字段</Text>
                    </Space>
                    <Button type="primary" ghost icon={<PlusOutlined />} onClick={addField} disabled={disabled}>
                      添加字段
                    </Button>
                  </div>

                  {value.fields.length === 0 ? (
                    <div className="schema-builder-empty">
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={`当前${label}为空，可添加字段生成 schema`}
                      />
                      <Button type="primary" icon={<PlusOutlined />} onClick={addField} disabled={disabled}>
                        添加字段
                      </Button>
                    </div>
                  ) : (
                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                      {value.fields.map((field, index) => {
                        const fieldErrors = builderErrors[field.id] ?? {};

                        return (
                          <div className="schema-field-card" key={field.id}>
                            <div className="schema-field-card__header">
                              <Space size={12}>
                                <span className="schema-field-card__index">{index + 1}</span>
                                <div>
                                  <Text strong>{field.name.trim() || `字段 ${index + 1}`}</Text>
                                  <div>
                                    <Text type="secondary">
                                      {field.title.trim() || "未设置标题"} / {field.type}
                                    </Text>
                                  </div>
                                </div>
                              </Space>
                              <Space size={8}>
                                <Button
                                  icon={<ArrowUpOutlined />}
                                  onClick={() => moveField(field.id, -1)}
                                  disabled={disabled || index === 0}
                                />
                                <Button
                                  icon={<ArrowDownOutlined />}
                                  onClick={() => moveField(field.id, 1)}
                                  disabled={disabled || index === value.fields.length - 1}
                                />
                                <Button danger icon={<DeleteOutlined />} onClick={() => removeField(field.id)} disabled={disabled} />
                              </Space>
                            </div>

                            <div className="schema-field-grid">
                              <div className="schema-field-grid__item">
                                <Text type="secondary">字段名</Text>
                                <Input
                                  value={field.name}
                                  status={fieldErrors.name ? "error" : ""}
                                  placeholder="例如 message"
                                  disabled={disabled}
                                  onChange={(event) => setField(field.id, { name: event.target.value })}
                                />
                                {fieldErrors.name && <Text type="danger">{fieldErrors.name}</Text>}
                              </div>

                              <div className="schema-field-grid__item">
                                <Text type="secondary">显示名</Text>
                                <Input
                                  value={field.title}
                                  placeholder="例如 Message"
                                  disabled={disabled}
                                  onChange={(event) => setField(field.id, { title: event.target.value })}
                                />
                              </div>

                              <div className="schema-field-grid__item schema-field-grid__item--compact">
                                <Text type="secondary">类型</Text>
                                <Select
                                  value={field.type}
                                  disabled={disabled}
                                  options={FIELD_TYPE_OPTIONS}
                                  onChange={(nextValue) =>
                                    setField(field.id, {
                                      ...buildTypePatch(field, nextValue)
                                    })
                                  }
                                />
                              </div>

                              <div className="schema-field-grid__item schema-field-grid__item--compact">
                                <Text type="secondary">必填</Text>
                                <Switch
                                  checked={field.required}
                                  checkedChildren="是"
                                  unCheckedChildren="否"
                                  disabled={disabled}
                                  onChange={(checked) => setField(field.id, { required: checked })}
                                />
                              </div>

                              {field.type === "string" && (
                                <div className="schema-field-grid__item schema-field-grid__item--compact">
                                  <Text type="secondary">输入控件</Text>
                                  <Select
                                    value={field.widget}
                                    disabled={disabled}
                                    options={[...STRING_WIDGET_OPTIONS]}
                                    onChange={(nextValue) =>
                                      setField(field.id, {
                                        widget: nextValue,
                                        rows: nextValue === "textarea" ? field.rows || 6 : field.rows
                                      })
                                    }
                                  />
                                </div>
                              )}

                              {field.type === "string" && field.widget === "textarea" && (
                                <div className="schema-field-grid__item schema-field-grid__item--compact">
                                  <Text type="secondary">行数</Text>
                                  <InputNumber
                                    min={1}
                                    precision={0}
                                    value={field.rows}
                                    status={fieldErrors.rows ? "error" : ""}
                                    style={{ width: "100%" }}
                                    placeholder="6"
                                    disabled={disabled}
                                    onChange={(nextValue) =>
                                      setField(field.id, {
                                        rows: typeof nextValue === "number" ? nextValue : 0
                                      })
                                    }
                                  />
                                </div>
                              )}

                              <div className="schema-field-grid__item schema-field-grid__item--description">
                                <Text type="secondary">描述</Text>
                                <Input.TextArea
                                  value={field.description}
                                  autoSize={{ minRows: 1, maxRows: 2 }}
                                  placeholder="字段说明"
                                  disabled={disabled}
                                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setField(field.id, { description: event.target.value })}
                                />
                              </div>

                              <div className="schema-field-grid__item schema-field-grid__item--default-value">
                                <Text type="secondary">默认值</Text>
                                {field.type === "boolean" ? (
                                  <Select
                                    value={typeof field.defaultValue === "boolean" ? field.defaultValue : undefined}
                                    status={fieldErrors.defaultValue ? "error" : ""}
                                    placeholder="选择"
                                    allowClear
                                    disabled={disabled}
                                    options={BOOLEAN_DEFAULT_OPTIONS}
                                    onChange={(nextValue) => setField(field.id, { defaultValue: nextValue })}
                                  />
                                ) : field.type === "number" || field.type === "integer" ? (
                                  <InputNumber
                                    value={typeof field.defaultValue === "number" ? field.defaultValue : null}
                                    status={fieldErrors.defaultValue ? "error" : ""}
                                    style={{ width: "100%" }}
                                    precision={field.type === "integer" ? 0 : undefined}
                                    placeholder={field.type === "integer" ? "例如 1" : "例如 1.5"}
                                    disabled={disabled}
                                    onChange={(nextValue) =>
                                      setField(field.id, {
                                        defaultValue: typeof nextValue === "number" ? nextValue : undefined
                                      })
                                    }
                                  />
                                ) : field.type === "enum" ? (
                                  <Select
                                    value={typeof field.defaultValue === "string" ? field.defaultValue : undefined}
                                    status={fieldErrors.defaultValue ? "error" : ""}
                                    placeholder="选择"
                                    allowClear
                                    disabled={disabled}
                                    options={field.enumText
                                      .split(",")
                                      .map((item) => item.trim())
                                      .filter(Boolean)
                                      .map((item) => ({
                                        value: item,
                                        label: item
                                      }))}
                                    onChange={(nextValue) => setField(field.id, { defaultValue: nextValue })}
                                  />
                                ) : field.widget === "textarea" ? (
                                  <Input.TextArea
                                    value={typeof field.defaultValue === "string" ? field.defaultValue : ""}
                                    status={fieldErrors.defaultValue ? "error" : ""}
                                    autoSize={{ minRows: 1, maxRows: 3 }}
                                    placeholder="默认值"
                                    disabled={disabled}
                                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setField(field.id, { defaultValue: event.target.value })}
                                  />
                                ) : (
                                  <Input
                                    value={typeof field.defaultValue === "string" ? field.defaultValue : ""}
                                    status={fieldErrors.defaultValue ? "error" : ""}
                                    placeholder="默认值"
                                    disabled={disabled}
                                    onChange={(event) => setField(field.id, { defaultValue: event.target.value })}
                                  />
                                )}
                              </div>

                              {field.type === "enum" && (
                                <div className="schema-field-grid__item schema-field-grid__item--full">
                                  <Text type="secondary">枚举值</Text>
                                  <Input
                                    value={field.enumText}
                                    status={fieldErrors.enumText ? "error" : ""}
                                    placeholder="success, failed, pending"
                                    disabled={disabled}
                                    onChange={(event) => setField(field.id, { enumText: event.target.value })}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </Space>
                  )}
                </>
              )
          },
          {
            key: "json",
            label: "JSON",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <InfoHint
                  label={`${label}支持直接输入 JSON Schema`}
                  content="保存时校验 JSON 合法性。"
                />
                <CodeEditor value={jsonText} onChange={handleJsonChange} theme={theme} height="360px" readOnly={disabled} />
                {value.mode === "json" && jsonModeReason ? (
                  <Alert type="warning" showIcon message="当前 JSON 无法映射为 Builder" description={jsonModeReason} />
                ) : null}
              </Space>
            )
          }
        ]}
      />
    </div>
  );
}
