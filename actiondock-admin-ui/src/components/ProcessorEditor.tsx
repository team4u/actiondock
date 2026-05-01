import { Alert, Button, Card, Empty, Form, Input, Radio, Select, Space, Tooltip, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProcessorDefinition, ProcessorMode, ScriptDefinition } from "../types";
import { parseJsonText, prettyJson } from "../utils";
import type { ProcessorPurpose } from "./processorScriptPresets";
import { writePreset } from "./processorScriptPresets";

const { Text } = Typography;

interface ProcessorEditorProps {
  title: string;
  value?: ProcessorDefinition;
  onChange: (value?: ProcessorDefinition) => void;
  scripts: ScriptDefinition[];
  description?: string;
  required?: boolean;
  disabled?: boolean;
  purpose?: ProcessorPurpose;
}

function toMode(value?: ProcessorDefinition): ProcessorMode {
  return value?.mode ?? "JSON_PATH";
}

export function ProcessorEditor({
  title,
  value,
  onChange,
  scripts,
  description,
  required = false,
  disabled = false,
  purpose
}: ProcessorEditorProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ProcessorMode>(toMode(value));
  const [jsonPathText, setJsonPathText] = useState(prettyJson(value?.jsonPath?.fields));
  const [templateText, setTemplateText] = useState(prettyJson(value?.template?.template));
  const [scriptId, setScriptId] = useState(value?.scriptRef?.scriptId ?? "");
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    setMode(toMode(value));
    setJsonPathText(prettyJson(value?.jsonPath?.fields));
    setTemplateText(prettyJson(value?.template?.template));
    setScriptId(value?.scriptRef?.scriptId ?? "");
    setErrorText(null);
  }, [value]);

  const publishedScriptOptions = useMemo(
    () =>
      scripts
        .filter((script) => Boolean(script.publishedSnapshot) || script.status === "PUBLISHED")
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((script) => ({
          label: `${script.name} (${script.id})`,
          value: script.id
        })),
    [scripts]
  );

  const emitJsonPath = (nextText: string) => {
    setJsonPathText(nextText);
    try {
      const fields = parseJsonText(nextText, `${title} JSONPath 字段`);
      setErrorText(null);
      onChange({
        mode: "JSON_PATH",
        jsonPath: {
          fields: Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, String(item ?? "")]))
        }
      });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "JSONPath 配置格式错误");
    }
  };

  const emitTemplate = (nextText: string) => {
    setTemplateText(nextText);
    try {
      const template = parseJsonText(nextText, `${title} 模板`);
      setErrorText(null);
      onChange({
        mode: "TEMPLATE",
        template: {
          engine: "MUSTACHE",
          template
        }
      });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "模板格式错误");
    }
  };

  const emitScriptRef = (nextScriptId: string) => {
    setScriptId(nextScriptId);
    setErrorText(null);
    onChange(nextScriptId
      ? {
          mode: "SCRIPT_REF",
          scriptRef: {
            scriptId: nextScriptId,
            versionMode: "PUBLISHED"
          }
        }
      : undefined);
  };

  const handleModeChange = (nextMode: ProcessorMode) => {
    setMode(nextMode);
    setErrorText(null);
    if (nextMode === "JSON_PATH") {
      emitJsonPath(jsonPathText || "{}");
      return;
    }
    if (nextMode === "TEMPLATE") {
      emitTemplate(templateText || "{}");
      return;
    }
    emitScriptRef(scriptId);
  };

  const modeDescription: Record<ProcessorMode, string> = {
    JSON_PATH: "适合直接提取字段，输出一个对象。",
    TEMPLATE: "适合拼装固定结构、组合字符串和常量值。",
    SCRIPT_REF: "适合复杂逻辑，直接复用已发布脚本。",
    INLINE_CODE: "后续可扩展为内联代码，当前第一版暂不开放。",
    PLUGIN_REF: "后续可扩展为插件调用，当前第一版暂不开放。"
  };

  return (
    <Card size="small" title={title}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message={description ?? modeDescription[mode]}
        />

        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          value={mode}
          disabled={disabled}
          onChange={(event) => handleModeChange(event.target.value)}
          options={[
            { label: "JSONPath 映射", value: "JSON_PATH" },
            { label: "模板生成", value: "TEMPLATE" },
            { label: "引用脚本", value: "SCRIPT_REF" }
          ]}
        />

        {mode === "JSON_PATH" ? (
          <Form.Item
            label="字段映射 JSON"
            required={required}
            validateStatus={errorText ? "error" : undefined}
            help={errorText ?? '格式示例: {"title":"$.body.issue.title"}'}
            style={{ marginBottom: 0 }}
          >
            <Input.TextArea
              rows={8}
              value={jsonPathText}
              disabled={disabled}
              onChange={(event) => emitJsonPath(event.target.value)}
            />
          </Form.Item>
        ) : null}

        {mode === "TEMPLATE" ? (
          <Form.Item
            label="模板 JSON"
            required={required}
            validateStatus={errorText ? "error" : undefined}
            help={errorText ?? '格式示例: {"summary":"[{{body.action}}] {{body.issue.title}}"}'}
            style={{ marginBottom: 0 }}
          >
            <Input.TextArea
              rows={8}
              value={templateText}
              disabled={disabled}
              onChange={(event) => emitTemplate(event.target.value)}
            />
          </Form.Item>
        ) : null}

        {mode === "SCRIPT_REF" ? (
          publishedScriptOptions.length === 0 ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可引用的已发布脚本" />
              <Tooltip title="创建并发布脚本后，请返回此页面选择该脚本">
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  disabled={disabled}
                  onClick={() => { writePreset(purpose); navigate("/scripts/new"); }}
                >
                  新增脚本
                </Button>
              </Tooltip>
            </Space>
          ) : (
            <Form.Item
              label="处理器脚本"
              required={required}
              validateStatus={required && !scriptId ? "error" : undefined}
              help={required && !scriptId ? "请选择一个已发布脚本" : "脚本会以已发布版本同步执行"}
              style={{ marginBottom: 0 }}
            >
              <Space.Compact style={{ width: "100%" }}>
                <Select
                  showSearch
                  style={{ flex: 1 }}
                  value={scriptId || undefined}
                  disabled={disabled}
                  options={publishedScriptOptions}
                  optionFilterProp="label"
                  placeholder="选择已发布脚本"
                  onChange={emitScriptRef}
                />
                <Tooltip title="创建并发布脚本后，请返回此页面选择该脚本">
                  <Button
                    icon={<PlusOutlined />}
                    disabled={disabled}
                    onClick={() => { writePreset(purpose); navigate("/scripts/new"); }}
                  >
                    新增脚本
                  </Button>
                </Tooltip>
              </Space.Compact>
            </Form.Item>
          )
        ) : null}

        {value ? (
          <Text type="secondary">
            当前模式：<Text code>{value.mode}</Text>
          </Text>
        ) : (
          <Alert type="info" showIcon message="当前未配置处理器" />
        )}
      </Space>
    </Card>
  );
}
