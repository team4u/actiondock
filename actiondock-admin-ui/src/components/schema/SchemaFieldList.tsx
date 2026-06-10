import { Alert, Segmented, Space, Typography } from "antd";
import { useState } from "react";
import type { SchemaFieldDefinition } from "../../services/schema";
import { resolveSchemaFields } from "../../services/schema";
import { formatSchemaFieldSupplement } from "../../services/schemaExecution";
import { prettyJson } from "../../services/utils";

const { Text } = Typography;

type SchemaFieldListMode = "VISUAL" | "JSON";

interface SchemaFieldListProps {
  schema?: Record<string, unknown>;
  title: string;
  emptyDescription: string;
}

function SchemaFieldListItem({ field, depth }: { field: SchemaFieldDefinition; depth: number }) {
  const supplement = formatSchemaFieldSupplement(field);
  const indent = depth > 0 ? { marginLeft: depth * 20 } : {};

  let typeLabel: string = field.kind;
  if (field.kind === "array" && field.items) {
    typeLabel = `array<${field.items.kind}${field.items.kind === "object" && field.items.children ? ` (${field.items.children.length} 字段)` : ""}>`;
  } else if (field.kind === "object" && field.children) {
    typeLabel = `object (${field.children.length} 字段)`;
  }

  return (
    <div className="schema-field-list__item" style={indent}>
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        <Space wrap size={[8, 6]}>
          <Text strong>{field.label}</Text>
          <Text type="secondary">{field.name}</Text>
        </Space>

        <Text type="secondary">
          {[
            typeLabel,
            field.required ? "required" : "optional",
            field.widget && field.widget !== "input"
              ? field.widget === "code" || field.widget === "json"
                ? `code${field.language ? `(${field.language})` : ""}`
                : field.widget
              : ""
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>

        {supplement ? <Text type="secondary">{supplement}</Text> : null}

        {field.enumValues && field.enumValues.length > 0 ? (
          <Text type="secondary">可选值：{field.enumValues.join(" / ")}</Text>
        ) : null}

        {field.kind === "object" && field.children && field.children.length > 0 && (
          <div style={{ marginLeft: 16, marginTop: 4 }}>
            {field.children.map((child) => (
              <SchemaFieldListItem key={child.name} field={child} depth={depth + 1} />
            ))}
          </div>
        )}

        {field.kind === "array" && field.items?.kind === "object" && field.items.children && field.items.children.length > 0 && (
          <div style={{ marginLeft: 16, marginTop: 4 }}>
            {field.items.children.map((child) => (
              <SchemaFieldListItem key={child.name} field={child} depth={depth + 1} />
            ))}
          </div>
        )}

        {field.kind === "array" && field.items?.kind === "enum" && field.items.enumValues && field.items.enumValues.length > 0 && (
          <Text type="secondary" style={{ marginLeft: 16 }}>元素可选值：{field.items.enumValues.join(" / ")}</Text>
        )}
      </Space>
    </div>
  );
}

export function SchemaFieldList({ schema, title, emptyDescription }: SchemaFieldListProps) {
  const [mode, setMode] = useState<SchemaFieldListMode>("VISUAL");
  const { supportedFields, unsupportedFields } = resolveSchemaFields(schema);

  return (
    <Space direction="vertical" size={10} style={{ width: "100%" }}>
      <div className="schema-field-list__header">
        <Space align="center" size={8}>
          <Text strong>{title}</Text>
          <Text type="secondary">{supportedFields.length} 个字段</Text>
        </Space>
        <Segmented<SchemaFieldListMode>
          size="small"
          value={mode}
          onChange={(value) => setMode(value)}
          options={[
            { label: "字段列表", value: "VISUAL" },
            { label: "JSON", value: "JSON" }
          ]}
        />
      </div>

      {mode === "JSON" ? (
        <pre className="json-preview">{prettyJson(schema)}</pre>
      ) : (
        <>
          {unsupportedFields.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message="部分字段暂时无法可视化展示"
              description={`未支持字段：${unsupportedFields.join(", ")}`}
            />
          ) : null}

          {supportedFields.length === 0 ? (
            <div className="schema-field-list__empty">
              <Text type="secondary">{emptyDescription}</Text>
            </div>
          ) : (
            <div className="schema-field-list">
              {supportedFields.map((field) => (
                <SchemaFieldListItem key={field.name} field={field} depth={0} />
              ))}
            </div>
          )}
        </>
      )}
    </Space>
  );
}
