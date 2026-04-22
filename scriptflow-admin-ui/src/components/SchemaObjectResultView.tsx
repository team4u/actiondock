import { Alert, Form, Input, InputNumber, Segmented, Select, Space, Switch, Typography } from "antd";
import { useEffect, useState } from "react";
import { resolveSchemaFields, type SchemaFieldDefinition } from "../schema";
import { prettyJson } from "../utils";

const { Text } = Typography;

type SchemaObjectResultMode = "SCHEMA" | "JSON";

function renderReadonlyField(field: SchemaFieldDefinition, value: unknown) {
  if (field.kind === "enum") {
    return (
      <Select
        value={value}
        disabled
        options={(field.enumValues ?? []).map((item) => ({
          value: item,
          label: String(item)
        }))}
      />
    );
  }

  if (field.kind === "boolean") {
    return <Switch checked={value === true} disabled checkedChildren="true" unCheckedChildren="false" />;
  }

  if (field.kind === "number" || field.kind === "integer") {
    return <InputNumber style={{ width: "100%" }} value={typeof value === "number" ? value : null} disabled />;
  }

  if (field.widget === "textarea") {
    return (
      <Input.TextArea
        value={typeof value === "string" ? value : value == null ? "" : String(value)}
        readOnly
        autoSize={{
          minRows: field.rows ?? 6,
          maxRows: Math.max(field.rows ?? 6, 16)
        }}
      />
    );
  }

  return <Input value={typeof value === "string" ? value : value == null ? "" : String(value)} readOnly />;
}

export function SchemaObjectResultView({
  schema,
  value,
  schemaName = "outputSchema",
  valueName = "输出"
}: {
  schema?: Record<string, unknown>;
  value?: Record<string, unknown>;
  schemaName?: string;
  valueName?: string;
}) {
  const { supportedFields, unsupportedFields } = resolveSchemaFields(schema);
  const [mode, setMode] = useState<SchemaObjectResultMode>(supportedFields.length > 0 ? "SCHEMA" : "JSON");

  useEffect(() => {
    setMode(supportedFields.length > 0 ? "SCHEMA" : "JSON");
  }, [supportedFields.length]);

  const resultValue = value ?? {};

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {supportedFields.length > 0 ? (
        <div className="schema-object-result__header">
          <Text type="secondary">按 {schemaName} 展示</Text>
          <Segmented<SchemaObjectResultMode>
            size="small"
            value={mode}
            onChange={(nextMode) => setMode(nextMode)}
            options={[
              { label: "可视化", value: "SCHEMA" },
              { label: "JSON", value: "JSON" }
            ]}
          />
        </div>
      ) : null}

      {mode === "JSON" || supportedFields.length === 0 ? (
        <pre className="json-preview">{prettyJson(resultValue)}</pre>
      ) : (
        <>
          {unsupportedFields.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message={`部分${valueName}字段暂时无法可视化展示`}
              description={`以下字段请切换到 JSON 查看：${unsupportedFields.join(", ")}`}
            />
          ) : null}
          <Form layout="vertical" disabled>
            {supportedFields.map((field) => (
              <Form.Item key={field.name} label={field.label} extra={field.description}>
                {renderReadonlyField(field, resultValue[field.name])}
              </Form.Item>
            ))}
          </Form>
        </>
      )}
    </Space>
  );
}
