import { CopyOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, InputNumber, Segmented, Select, Space, Switch, Tooltip, Typography } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useEffect, useState } from "react";
import { useColorMode } from "../../shared/contexts/ColorModeContext";
import { resolveSchemaFields, type SchemaFieldDefinition } from "../../services/schema";
import { CodeEditor } from "../common/CodeEditor";
import { MarkdownDescription } from "../common/MarkdownDescription";
import { copyText, prettyJson } from "../../services/utils";

const { Text } = Typography;

type SchemaObjectResultMode = "SCHEMA" | "JSON";

function getDefaultResultMode(supportedFieldCount: number, unsupportedFieldCount: number): SchemaObjectResultMode {
  return supportedFieldCount > 0 && unsupportedFieldCount === 0 ? "SCHEMA" : "JSON";
}

function resolveCodePreviewHeight(rows?: number): string {
  const rowCount = rows && rows > 0 ? rows : 6;
  return `${Math.max(rowCount * 28 + 28, 180)}px`;
}

function formatTextValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function renderReadonlyField(field: SchemaFieldDefinition, value: unknown, editorTheme: "vs-light" | "vs-dark") {
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

  if (field.widget === "markdown") {
    return (
      <MarkdownDescription
        value={formatTextValue(value)}
        emptyText="暂无内容"
        className="markdown-description--panel"
      />
    );
  }

  if (field.widget === "json" || field.widget === "code") {
    return (
      <CodeEditor
        value={formatTextValue(value)}
        onChange={() => undefined}
        theme={editorTheme}
        language={field.widget === "json" ? "json" : field.language || "plaintext"}
        height={resolveCodePreviewHeight(field.rows)}
        readOnly
      />
    );
  }

  if (field.widget === "textarea") {
    return (
      <Input.TextArea
        value={formatTextValue(value)}
        readOnly
        autoSize={{
          minRows: field.rows ?? 6,
          maxRows: Math.max(field.rows ?? 6, 16)
        }}
      />
    );
  }

  return <Input value={formatTextValue(value)} readOnly />;
}

function FieldLabelWithCopy({
  label,
  value,
  messageApi
}: {
  label: string;
  value: unknown;
  messageApi?: MessageInstance;
}) {
  const textValue = formatTextValue(value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span>{label}</span>
      <Tooltip title="复制">
        <Button
          size="small"
          type="text"
          icon={<CopyOutlined />}
          style={{ marginInlineStart: "auto" }}
          onClick={() => {
            void copyText(textValue)
              .then(() => messageApi?.success("已复制"))
              .catch(() => messageApi?.error("复制失败"));
          }}
        />
      </Tooltip>
    </div>
  );
}

export function SchemaObjectResultView({
  schema,
  value,
  schemaName = "outputSchema",
  valueName = "输出",
  messageApi
}: {
  schema?: Record<string, unknown>;
  value?: Record<string, unknown>;
  schemaName?: string;
  valueName?: string;
  messageApi?: MessageInstance;
}) {
  const { supportedFields, unsupportedFields } = resolveSchemaFields(schema);
  const editorTheme = useColorMode() === "dark" ? "vs-dark" : "vs-light";
  const [mode, setMode] = useState<SchemaObjectResultMode>(
    getDefaultResultMode(supportedFields.length, unsupportedFields.length)
  );

  useEffect(() => {
    setMode(getDefaultResultMode(supportedFields.length, unsupportedFields.length));
  }, [supportedFields.length, unsupportedFields.length]);

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
          <Form layout="vertical">
            {supportedFields.map((field) => (
              <Form.Item
                key={field.name}
                label={
                  <FieldLabelWithCopy
                    label={field.label}
                    value={resultValue[field.name]}
                    messageApi={messageApi}
                  />
                }
                extra={field.description}
              >
                {renderReadonlyField(field, resultValue[field.name], editorTheme)}
              </Form.Item>
            ))}
          </Form>
        </>
      )}
    </Space>
  );
}
