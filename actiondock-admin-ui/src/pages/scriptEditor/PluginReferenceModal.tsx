import { Button, Col, Collapse, Modal, Row, Space, Tag, Typography } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { SchemaFieldList } from "../../components/SchemaFieldList";
import { buildPluginInvokeSnippet } from "../../scriptInvocationSnippets";
import { copyText } from "../../utils";
import type { PluginView, ScriptType } from "../../types";

const { Text } = Typography;

interface PluginReferenceModalProps {
  plugin: PluginView | null;
  onClose: () => void;
  selectedScriptType: ScriptType;
}

export function PluginReferenceModal({
  plugin,
  onClose,
  selectedScriptType
}: PluginReferenceModalProps) {
  if (!plugin) return null;

  return (
    <Modal
      title={plugin.name || plugin.pluginId}
      open={Boolean(plugin)}
      onCancel={onClose}
      footer={null}
      width={860}
      destroyOnHidden
    >
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Text type="secondary">
          {[plugin.pluginId, `${plugin.actions.length} 个方法`, plugin.version ? `v${plugin.version}` : ""]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {plugin.description ? <Text type="secondary">{plugin.description}</Text> : null}
        <Collapse
          className="plugin-reference-collapse plugin-reference-collapse--nested"
          items={plugin.actions.map((action) => {
            const snippet = buildPluginInvokeSnippet(
              selectedScriptType,
              plugin.pluginId,
              action.action,
              action.exampleArgs
            );
            return {
              key: `${plugin.pluginId}-${action.action}`,
              label: (
                <Space wrap size={[8, 8]}>
                  <Text strong>{action.title || action.action}</Text>
                  {action.title && action.title !== action.action ? (
                    <Text type="secondary">{action.action}</Text>
                  ) : null}
                </Space>
              ),
              extra: (
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    void copyText(snippet);
                  }}
                >
                  复制调用
                </Button>
              ),
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {action.description ? <Text type="secondary">{action.description}</Text> : null}
                  <Row gutter={[12, 12]}>
                    <Col xs={24} md={12}>
                      <SchemaFieldList
                        schema={action.inputSchema}
                        title="输入字段"
                        emptyDescription="无输入字段"
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <SchemaFieldList
                        schema={action.outputSchema}
                        title="输出字段"
                        emptyDescription="无输出字段"
                      />
                    </Col>
                  </Row>
                  <Text strong>调用示例</Text>
                  <pre className="json-preview">{snippet}</pre>
                </Space>
              )
            };
          })}
        />
      </Space>
    </Modal>
  );
}
