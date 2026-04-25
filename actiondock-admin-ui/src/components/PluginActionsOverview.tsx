import { CopyOutlined } from "@ant-design/icons";
import { Button, Col, Collapse, Empty, Row, Space, Tabs, Typography } from "antd";
import { useEffect, useState } from "react";
import { MarkdownDescription } from "./MarkdownDescription";
import { SchemaFieldList } from "./SchemaFieldList";
import { buildPluginInvokeSnippet } from "../scriptInvocationSnippets";
import { copyText } from "../utils";
import type { PluginAction, ScriptType } from "../types";

const { Text } = Typography;

function getActionLabel(action: PluginAction): string {
  return action.title || action.action;
}

interface PluginActionsOverviewProps {
  description?: string;
  actions: PluginAction[];
  /** 默认 "tabs"：插件详情页用折叠面板模式；"collapse"：插件参考用折叠面板 */
  mode?: "tabs" | "collapse";
  /** 生成调用示例所需参数，collapse 模式下必传 */
  snippetContext?: {
    pluginId: string;
    scriptType: ScriptType;
  };
}

function ActionDetail({ action, snippet }: {
  action: PluginAction;
  snippet?: string;
}) {
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {action.description ? <MarkdownDescription value={action.description} /> : null}
      <Row gutter={[12, 12]}>
        <Col xs={24} md={12}>
          <SchemaFieldList
            schema={action.inputSchema}
            title="输入字段"
            emptyDescription="当前动作没有声明输入字段。"
          />
        </Col>
        <Col xs={24} md={12}>
          <SchemaFieldList
            schema={action.outputSchema}
            title="输出字段"
            emptyDescription="当前动作没有声明输出字段。"
          />
        </Col>
      </Row>
      {snippet ? (
        <>
          <Text strong>调用示例</Text>
          <pre className="json-preview">{snippet}</pre>
        </>
      ) : null}
    </Space>
  );
}

export function PluginActionsOverview({
  description,
  actions,
  mode = "collapse",
  snippetContext
}: PluginActionsOverviewProps) {
  const [selectedActionName, setSelectedActionName] = useState<string>("");

  useEffect(() => {
    if (!actions.length) {
      setSelectedActionName("");
      return;
    }
    if (!actions.some((item) => item.action === selectedActionName)) {
      setSelectedActionName(actions[0].action);
    }
  }, [actions, selectedActionName]);

  const currentAction = actions.find((item) => item.action === selectedActionName) ?? actions[0] ?? null;

  if (actions.length === 0) {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {description ? <MarkdownDescription value={description} className="markdown-description--panel" /> : null}
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前插件没有可用动作。" />
      </Space>
    );
  }

  if (mode === "tabs") {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {description ? <MarkdownDescription value={description} className="markdown-description--panel" /> : null}
        <Tabs
          activeKey={currentAction?.action}
          onChange={setSelectedActionName}
          items={actions.map((action) => ({
            key: action.action,
            label: getActionLabel(action),
            children: (
              <ActionDetail
                action={action}
                snippet={
                  snippetContext
                    ? buildPluginInvokeSnippet(snippetContext.scriptType, snippetContext.pluginId, action.action, action.exampleArgs)
                    : undefined
                }
              />
            )
          }))}
        />
      </Space>
    );
  }

  // collapse mode (default)
  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      {description ? <MarkdownDescription value={description} /> : null}
      <Collapse
        className="plugin-reference-collapse plugin-reference-collapse--nested"
        items={actions.map((action) => {
          const snippet = snippetContext
            ? buildPluginInvokeSnippet(snippetContext.scriptType, snippetContext.pluginId, action.action, action.exampleArgs)
            : undefined;
          return {
            key: `${snippetContext?.pluginId ?? ""}-${action.action}`,
            label: (
              <Space wrap size={[8, 8]}>
                <Text strong>{action.title || action.action}</Text>
                {action.title && action.title !== action.action ? (
                  <Text type="secondary">{action.action}</Text>
                ) : null}
              </Space>
            ),
            extra: snippet ? (
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
            ) : null,
            children: <ActionDetail action={action} snippet={snippet} />
          };
        })}
      />
    </Space>
  );
}
