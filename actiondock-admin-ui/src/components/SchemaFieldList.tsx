import { Alert, Segmented, Space, Typography } from "antd";
import { useState } from "react";
import { resolveSchemaFields } from "../schema";
import { formatSchemaFieldSupplement } from "../schemaExecution";
import { prettyJson } from "../utils";

const { Text } = Typography;

type SchemaFieldListMode = "VISUAL" | "JSON";

interface SchemaFieldListProps {
  schema?: Record<string, unknown>;
  title: string;
  emptyDescription: string;
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
                <div key={field.name} className="schema-field-list__item">
                  {(() => {
                    const supplement = formatSchemaFieldSupplement(field);

                    return (
                      <Space direction="vertical" size={6} style={{ width: "100%" }}>
                        <Space wrap size={[8, 6]}>
                          <Text strong>{field.label}</Text>
                          <Text type="secondary">{field.name}</Text>
                        </Space>

                        <Text type="secondary">
                          {[field.kind, field.required ? "required" : "optional", field.widget === "textarea" ? "textarea" : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>

                        {supplement ? <Text type="secondary">{supplement}</Text> : null}

                        {field.enumValues && field.enumValues.length > 0 ? (
                          <Text type="secondary">可选值：{field.enumValues.join(" / ")}</Text>
                        ) : null}
                      </Space>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Space>
  );
}
