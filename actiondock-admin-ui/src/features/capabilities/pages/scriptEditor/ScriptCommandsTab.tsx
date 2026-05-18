import { Alert, Collapse, Descriptions, Space, Typography } from "antd";
import { Grid } from "antd";
import { CommandPanel, type CommandPreset } from "../../../../components/execution/CommandPanel";
import { InfoHint } from "../../../../components/common/InfoHint";
import { JsonPreview } from "../../../../components/common/JsonPreview";
import { SkillExamplePanel } from "../../../../components/skill/SkillExamplePanel";
import { getCommandInputSourceLabel, type ResolvedCommandInput } from "../../../../services/commands";

const { Text } = Typography;
const { useBreakpoint } = Grid;

interface ScriptCommandsTabProps {
  currentScriptId: string;
  origin: string;
  apiKey?: string;
  executionMode: string;
  commandInput: ResolvedCommandInput;
  detailCommandPresets: CommandPreset[];
  executeCommandPresets: CommandPreset[];
  schemaCommandPresets: CommandPreset[];
  hasInputSchema: boolean;
  hasOutputSchema: boolean;
  skillExample: string;
  toolContractResponseExample: Record<string, unknown> | undefined;
  onCopy: (value: string, successText?: string, errorText?: string) => void | Promise<boolean>;
  onOpenSkillInstall?: (value: string) => void;
}

export function ScriptCommandsTab({
  origin,
  apiKey,
  executionMode,
  commandInput,
  detailCommandPresets,
  executeCommandPresets,
  schemaCommandPresets,
  hasInputSchema,
  hasOutputSchema,
  skillExample,
  toolContractResponseExample,
  onCopy,
  onOpenSkillInstall
}: ScriptCommandsTabProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <InfoHint
        label="可直接执行的 HTTP / CLI 调用命令"
        content={
          apiKey
            ? `命令已使用当前页面 origin ${origin}；HTTP 变体提供 curl / Invoke-WebRequest，CLI 变体提供 actiondock，并会自动附带当前 Bearer Token。`
            : `命令已使用当前页面 origin ${origin}；HTTP 变体提供 curl / Invoke-WebRequest，CLI 变体提供 actiondock；当前未设置 Bearer Token，因此不会附带 Authorization 头或 --token。`
        }
      />

      <Collapse
        accordion
        defaultActiveKey={["command-execute"]}
        items={[
          {
            key: "command-execute",
            label: "执行脚本",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Text type="secondary">跟随当前调试配置生成</Text>
                {commandInput.note ? (
                  <Alert
                    type={commandInput.source === "sample" || commandInput.source === "empty" ? "warning" : "info"}
                    showIcon
                    message={commandInput.note}
                  />
                ) : null}
                <Descriptions size="small" column={isMobile ? 1 : 2}>
                  <Descriptions.Item label="执行模式">{executionMode}</Descriptions.Item>
                  <Descriptions.Item label="入参来源">
                    {getCommandInputSourceLabel(commandInput.source)}
                  </Descriptions.Item>
                </Descriptions>
                <CommandPanel
                  title="执行脚本命令"
                  presets={executeCommandPresets}
                  onCopy={(command) => void onCopy(command)}
                />
              </Space>
            )
          },
          {
            key: "command-detail",
            label: "查看详情",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Text type="secondary">使用当前脚本 ID 生成，可用于查询脚本定义详情。</Text>
                <CommandPanel
                  title="详情查询命令"
                  presets={detailCommandPresets}
                  onCopy={(command) => void onCopy(command)}
                />
              </Space>
            )
          },
          ...(hasInputSchema || hasOutputSchema
            ? [
                {
                  key: "command-contract",
                  label: "Schema",
                  children: (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <Text type="secondary">供模型与调用方查看输入输出定义。</Text>
                      <CommandPanel
                        title="获取 Schema 命令"
                        presets={schemaCommandPresets}
                        onCopy={(command) => void onCopy(command)}
                      />
                      <JsonPreview
                        title="Schema 响应示例"
                        value={toolContractResponseExample}
                        emptyDescription="当前没有可展示的 Schema 示例"
                      />
                    </Space>
                  )
                }
              ]
            : []),
          {
            key: "command-skill",
            label: "Skill 示例",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <SkillExamplePanel
                  value={skillExample}
                  onCopy={(value) => void onCopy(value, "Skill 已复制", "复制 Skill 失败")}
                  onOpenInstall={onOpenSkillInstall}
                />
              </Space>
            )
          }
        ]}
      />
    </Space>
  );
}
