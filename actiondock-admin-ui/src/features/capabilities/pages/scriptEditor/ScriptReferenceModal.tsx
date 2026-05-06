import { Button, Descriptions, Drawer, Row, Space, Tag, Typography } from "antd";
import { Col } from "../../../../components/SafeCol";
import type { MessageInstance } from "antd/es/message/interface";
import { CopyOutlined } from "@ant-design/icons";
import { getApiKey } from "../../../../auth";
import { CommandPanel } from "../../../../components/CommandPanel";
import { SchemaFieldList } from "../../../../components/SchemaFieldList";
import { buildCliCommandPresets, buildExecuteCliCommand } from "../../../../commands";
import { buildSchemaFieldExampleValues } from "../../../../schemaExecution";
import { resolveSchemaFields } from "../../../../schema";
import { buildScriptInvokeSnippet } from "../../../../scriptInvocationSnippets";
import { useCopyMessage } from "../../../../hooks/useCopyMessage";
import type { ScriptDefinition, ScriptType } from "../../../../types";

const { Text } = Typography;

interface ScriptReferenceModalProps {
  script: ScriptDefinition | null;
  onClose: () => void;
  selectedScriptType: ScriptType;
  messageApi: MessageInstance;
}

export function ScriptReferenceModal({
  script,
  onClose,
  selectedScriptType,
  messageApi
}: ScriptReferenceModalProps) {
  const handleCopy = useCopyMessage(messageApi, "调用已复制", "复制失败");

  if (!script?.publishedSnapshot) return null;
  const apiKey = getApiKey() || undefined;
  const origin = window.location.origin;

  const args = buildSchemaFieldExampleValues(
    resolveSchemaFields(script.publishedSnapshot.inputSchema).supportedFields
  );
  const snippet = buildScriptInvokeSnippet(selectedScriptType, script.id, args);
  const cliPresets = buildCliCommandPresets({
    keyPrefix: `script-reference-${script.id}`,
    cliBash: buildExecuteCliCommand({
      apiKey,
      environment: "bash/zsh",
      input: args,
      mode: "SYNC",
      origin,
      scriptId: script.id
    }),
    cliPowerShell: buildExecuteCliCommand({
      apiKey,
      environment: "PowerShell",
      input: args,
      mode: "SYNC",
      origin,
      scriptId: script.id
    })
  });

  return (
    <Drawer
      title={script.name || script.id}
      open={Boolean(script)}
      onClose={onClose}
      width={640}
      destroyOnHidden
    >
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Space wrap size={[8, 8]}>
          <Text type="secondary">{script.id}</Text>
          <Tag>{script.publishedSnapshot.type}</Tag>
          <Tag color="green">已发布</Tag>
          <Text type="secondary">v{script.version}</Text>
          {script.hasUnpublishedChanges ? (
            <Text type="warning">存在未发布改动，以下为已发布契约</Text>
          ) : null}
        </Space>
        <Descriptions
          size="small"
          column={1}
          bordered
          items={[
            {
              key: "published-name",
              label: "已发布名称",
              children: script.publishedSnapshot.name || script.name || script.id
            },
            {
              key: "published-type",
              label: "调用方式",
              children: <Text code>{`scripts.invoke("${script.id}", ...)`}</Text>
            }
          ]}
        />
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}>
            <SchemaFieldList
              schema={script.publishedSnapshot.inputSchema}
              title="输入字段"
              emptyDescription="无输入字段"
            />
          </Col>
          <Col xs={24} md={12}>
            <SchemaFieldList
              schema={script.publishedSnapshot.outputSchema}
              title="输出字段"
              emptyDescription="无输出字段"
            />
          </Col>
        </Row>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Space align="center" style={{ justifyContent: "space-between", width: "100%" }}>
            <Text strong>调用示例</Text>
            <Button size="small" icon={<CopyOutlined />} onClick={() => void handleCopy(snippet)}>
              复制调用
            </Button>
          </Space>
          <pre className="json-preview">{snippet}</pre>
        </Space>
        <CommandPanel
          title="CLI 调用"
          presets={cliPresets}
          onCopy={(command) => void handleCopy(command)}
        />
      </Space>
    </Drawer>
  );
}
