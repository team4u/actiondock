import { Input, InputNumber, Select, Switch } from "antd";
import type { Rule } from "antd/es/form";
import type { SchemaFieldDefinition } from "../services/schema";

export interface RenderSchemaFieldInputOptions {
  booleanLabels?: {
    checked: string;
    unchecked: string;
  };
}

export function buildSchemaFieldRules(field: SchemaFieldDefinition): Rule[] | undefined {
  if (!field.required) {
    return undefined;
  }

  if (field.kind === "boolean") {
    return [
      {
        validator: async (_: unknown, value: unknown) => {
          if (value === undefined) {
            throw new Error(`请选择${field.label}`);
          }
        }
      }
    ];
  }

  if (field.kind === "object" || field.kind === "array") {
    return [
      {
        required: true,
        message: `请输入${field.label}`
      }
    ];
  }

  return [
    {
      required: true,
      message: field.kind === "enum" ? `请选择${field.label}` : `请输入${field.label}`
    }
  ];
}

export function getSchemaFieldValuePropName(field: SchemaFieldDefinition): "checked" | "value" {
  return field.kind === "boolean" ? "checked" : "value";
}

export function renderSchemaFieldInput(
  field: SchemaFieldDefinition,
  options?: RenderSchemaFieldInputOptions
) {
  if (field.kind === "enum") {
    return (
      <Select
        allowClear={!field.required}
        placeholder={`请选择${field.label}`}
        options={(field.enumValues ?? []).map((value) => ({
          value,
          label: String(value)
        }))}
      />
    );
  }

  if (field.kind === "boolean") {
    return (
      <Switch
        checkedChildren={options?.booleanLabels?.checked ?? "true"}
        unCheckedChildren={options?.booleanLabels?.unchecked ?? "false"}
      />
    );
  }

  if (field.kind === "number" || field.kind === "integer") {
    return (
      <InputNumber
        style={{ width: "100%" }}
        placeholder={`请输入${field.label}`}
        precision={field.kind === "integer" ? 0 : undefined}
      />
    );
  }

  if (field.kind === "object" || field.kind === "array") {
    return (
      <Input.TextArea
        placeholder={field.kind === "object" ? `请输入 JSON 对象` : `请输入 JSON 数组`}
        autoSize={{ minRows: 2, maxRows: 12 }}
      />
    );
  }

  if (field.widget && field.widget !== "input") {
    const minRows = field.rows ?? 6;
    return (
      <Input.TextArea
        placeholder={`请输入${field.label}`}
        autoSize={{
          minRows,
          maxRows: Math.max(minRows, 16)
        }}
      />
    );
  }

  return <Input placeholder={`请输入${field.label}`} />;
}
