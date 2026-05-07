import { Alert, Form, Tabs } from "antd";
import type { FormInstance } from "antd/es/form";
import type { SchemaFieldDefinition } from "../../services/schema";
import { formatSchemaFieldDescription } from "../../services/schemaExecution";
import { CodeEditor } from "../common/CodeEditor";
import {
  buildSchemaFieldRules,
  getSchemaFieldValuePropName,
  renderSchemaFieldInput
} from "../../services/schemaForm";
import type { RenderSchemaFieldInputOptions } from "../../services/schemaForm";

export type SchemaObjectEditorMode = "SCHEMA" | "JSON";

export function SchemaObjectEditor({
  form,
  supportedFields,
  unsupportedFields = [],
  inputMode,
  onInputModeChange,
  jsonText,
  onJsonTextChange,
  jsonLabel,
  jsonExtra,
  noSchemaExtra,
  editorTheme,
  editorHeight = "320px",
  fieldInputOptions
}: {
  form: FormInstance<Record<string, unknown>>;
  supportedFields: SchemaFieldDefinition[];
  unsupportedFields?: string[];
  inputMode: SchemaObjectEditorMode;
  onInputModeChange: (nextMode: string) => void;
  jsonText: string;
  onJsonTextChange: (value: string) => void;
  jsonLabel: string;
  jsonExtra: string;
  noSchemaExtra: string;
  editorTheme: "vs-light" | "vs-dark";
  editorHeight?: string;
  fieldInputOptions?: RenderSchemaFieldInputOptions;
}) {
  const hasSchemaForm = supportedFields.length > 0;

  return (
    <>
      {unsupportedFields.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="部分字段无法在表单模式中编辑"
          description={`以下字段仍需通过 JSON 模式维护：${unsupportedFields.join(", ")}`}
        />
      ) : null}
      {hasSchemaForm ? (
        <Tabs
          activeKey={inputMode}
          onChange={onInputModeChange}
          items={[
            {
              key: "SCHEMA",
              label: "表单输入",
              children: (
                <Form form={form} layout="vertical">
                  {supportedFields.map((field) => (
                    <Form.Item
                      key={field.name}
                      label={field.label}
                      name={field.name}
                      rules={buildSchemaFieldRules(field)}
                      valuePropName={getSchemaFieldValuePropName(field)}
                      extra={formatSchemaFieldDescription(field) ?? undefined}
                    >
                      {renderSchemaFieldInput(field, fieldInputOptions)}
                    </Form.Item>
                  ))}
                </Form>
              )
            },
            {
              key: "JSON",
              label: "JSON 输入",
              children: (
                <Form form={form} layout="vertical">
                  <Form.Item label={jsonLabel} extra={jsonExtra}>
                    <CodeEditor
                      height={editorHeight}
                      language="json"
                      value={jsonText}
                      onChange={onJsonTextChange}
                      theme={editorTheme}
                    />
                  </Form.Item>
                </Form>
              )
            }
          ]}
        />
      ) : (
        <Form form={form} layout="vertical">
          <Form.Item label={jsonLabel} extra={noSchemaExtra}>
            <CodeEditor
              height={editorHeight}
              language="json"
              value={jsonText}
              onChange={onJsonTextChange}
              theme={editorTheme}
            />
          </Form.Item>
        </Form>
      )}
    </>
  );
}
