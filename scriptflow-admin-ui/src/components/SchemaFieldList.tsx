import { Alert, Segmented, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { resolveSchemaFields } from "../schema";
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
                  <Space direction="vertical" size={6} style={{ width: "100%" }}>
                    <Space wrap size={[8, 8]}>
                      <Text strong>{field.label}</Text>
                      <Text code>{field.name}</Text>
                      <Tag>{field.kind}</Tag>
                      {field.required ? <Tag color="red">required</Tag> : <Tag>optional</Tag>}
                      {field.widget === "textarea" ? <Tag color="blue">textarea</Tag> : null}
                    </Space>

                    {field.description ? <Text type="secondary">{field.description}</Text> : null}

                    {field.enumValues && field.enumValues.length > 0 ? (
                      <Space wrap size={[8, 8]}>
                        <Text type="secondary">可选值</Text>
                        {field.enumValues.map((value) => (
                          <Tag key={`${field.name}-${value}`}>{value}</Tag>
                        ))}
                      </Space>
                    ) : null}
                  </Space>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Space>
  );
}
