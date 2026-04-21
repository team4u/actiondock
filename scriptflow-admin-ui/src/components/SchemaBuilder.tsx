import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined
} from "@ant-design/icons";
import { Alert, Button, Empty, Input, Select, Space, Switch, Typography } from "antd";
import type { SchemaEditorState, SchemaFieldDraft, SchemaFieldKind } from "../schema";
import {
  createSchemaFieldDraft,
  validateSchemaFields
} from "../schema";
import { prettyJson } from "../utils";

const { Text } = Typography;

const FIELD_TYPE_OPTIONS: Array<{ value: SchemaFieldKind; label: string }> = [
  { value: "string", label: "string" },
  { value: "number", label: "number" },
  { value: "integer", label: "integer" },
  { value: "boolean", label: "boolean" },
  { value: "enum", label: "enum" }
];

interface SchemaBuilderProps {
  label: string;
  value: SchemaEditorState;
  onChange: (nextValue: SchemaEditorState) => void;
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

export function SchemaBuilder({ label, value, onChange }: SchemaBuilderProps) {
  if (value.mode === "readonly") {
    return (
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          type="warning"
          showIcon
          message={`${label}暂时无法进入可视化编辑`}
          description={value.reason}
        />
        <div className="schema-builder-preview">
          <Text strong>原始 JSON</Text>
          <pre className="json-preview">{prettyJson(value.rawSchema)}</pre>
        </div>
      </Space>
    );
  }

  const errors = validateSchemaFields(value.fields);

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

  return (
    <div className="schema-builder">
      <div className="schema-builder-toolbar">
        <Space size={12}>
          <Text strong>{label}</Text>
          <Text type="secondary">{value.fields.length} 个字段</Text>
        </Space>
        <Button type="primary" ghost icon={<PlusOutlined />} onClick={addField}>
          添加字段
        </Button>
      </div>

      {value.fields.length === 0 ? (
        <div className="schema-builder-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={`当前${label}为空，可添加字段生成 schema`}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={addField}>
            新增第一个字段
          </Button>
        </div>
      ) : (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {value.fields.map((field, index) => {
            const fieldErrors = errors[field.id] ?? {};

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
                      disabled={index === 0}
                    />
                    <Button
                      icon={<ArrowDownOutlined />}
                      onClick={() => moveField(field.id, 1)}
                      disabled={index === value.fields.length - 1}
                    />
                    <Button danger icon={<DeleteOutlined />} onClick={() => removeField(field.id)} />
                  </Space>
                </div>

                <div className="schema-field-grid">
                  <div className="schema-field-grid__item">
                    <Text type="secondary">字段名</Text>
                    <Input
                      value={field.name}
                      status={fieldErrors.name ? "error" : ""}
                      placeholder="例如 message"
                      onChange={(event) => setField(field.id, { name: event.target.value })}
                    />
                    {fieldErrors.name && <Text type="danger">{fieldErrors.name}</Text>}
                  </div>

                  <div className="schema-field-grid__item">
                    <Text type="secondary">显示名</Text>
                    <Input
                      value={field.title}
                      placeholder="例如 Message"
                      onChange={(event) => setField(field.id, { title: event.target.value })}
                    />
                  </div>

                  <div className="schema-field-grid__item schema-field-grid__item--compact">
                    <Text type="secondary">类型</Text>
                    <Select
                      value={field.type}
                      options={FIELD_TYPE_OPTIONS}
                      onChange={(nextValue) => setField(field.id, { type: nextValue })}
                    />
                  </div>

                  <div className="schema-field-grid__item schema-field-grid__item--compact">
                    <Text type="secondary">必填</Text>
                    <div className="schema-field-switch">
                      <Switch
                        checked={field.required}
                        checkedChildren="是"
                        unCheckedChildren="否"
                        onChange={(checked) => setField(field.id, { required: checked })}
                      />
                    </div>
                  </div>

                  {field.type === "enum" && (
                    <div className="schema-field-grid__item schema-field-grid__item--full">
                      <Text type="secondary">枚举值</Text>
                      <Input
                        value={field.enumText}
                        status={fieldErrors.enumText ? "error" : ""}
                        placeholder="例如 success, failed, pending"
                        onChange={(event) => setField(field.id, { enumText: event.target.value })}
                      />
                      <Text type={fieldErrors.enumText ? "danger" : "secondary"}>
                        {fieldErrors.enumText ?? "使用逗号分隔，builder 会按字符串数组写入 enum。"}
                      </Text>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Space>
      )}
    </div>
  );
}
