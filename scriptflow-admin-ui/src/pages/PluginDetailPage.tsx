import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Typography,
  message
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useColorMode } from "../contexts/ColorModeContext";
import {
  ApiError,
  getPlugin,
  getPluginConfig,
  invokePluginAction,
  startPlugin,
  stopPlugin,
  uninstallPlugin,
  updatePluginConfig,
  upgradePlugin
} from "../api";
import { getApiKey } from "../auth";
import { CodeEditor } from "../components/CodeEditor";
import { buildStandardCommandPresets, CommandTabsPanel } from "../components/CommandTabsPanel";
import { ErrorDetailPanel } from "../components/ErrorDetailPanel";
import { InfoHint } from "../components/InfoHint";
import { SchemaFieldList } from "../components/SchemaFieldList";
import { SchemaObjectEditor, type SchemaObjectEditorMode } from "../components/SchemaObjectEditor";
import { SchemaObjectResultView } from "../components/SchemaObjectResultView";
import {
  buildExecutionInputFromValues,
  buildPluginInvokeCliCommand,
  buildPluginInvokeCmdCliCommand,
  buildPluginInvokePowerShellCliCommand,
  buildPluginInvokeCurlCommand,
  buildPluginInvokePowerShellCommand,
  getCommandInputSourceLabel,
  resolveCommandObjectInput
} from "../commands";
import {
  buildSchemaObjectEditorJsonText,
  parseSchemaObjectEditorJsonText
} from "../schemaObjectEditorSupport";
import { resolveSchemaFields } from "../schema";
import type { ErrorDetail, PluginAction, PluginConfigView, PluginInvokeResponse, PluginView } from "../types";
import { isErrorDetail } from "../types";
import { copyText, parseJsonText, prettyJson } from "../utils";

const { Text, Title } = Typography;

type PluginDetailTab = "overview" | "config" | "debug" | "commands";

interface PluginDebugErrorState {
  message: string;
  detail?: ErrorDetail;
}

function getActionLabel(action: PluginAction): string {
  return action.title || action.action;
}

function resolvePluginScriptInputCommandInput(jsonText: string): {
  note?: string;
  source: "current-json" | "empty";
  value: Record<string, unknown>;
} {
  const trimmed = jsonText.trim();
  if (!trimmed || trimmed === "{}") {
    return {
      source: "empty",
      value: {}
    };
  }

  try {
    return {
      source: "current-json",
      value: parseJsonText(trimmed, "脚本输入")
    };
  } catch {
    return {
      note: "当前脚本输入 JSON 非法，已回退到空对象。",
      source: "empty",
      value: {}
    };
  }
}

export function PluginDetailPage() {
  const { pluginId = "" } = useParams<{ pluginId: string }>();
  const navigate = useNavigate();
  const colorMode = useColorMode();
  const [searchParams, setSearchParams] = useSearchParams();
  const [configForm] = Form.useForm<Record<string, any>>();
  const [argsForm] = Form.useForm<Record<string, any>>();
  const watchedArgsValues = Form.useWatch([], argsForm) as Record<string, unknown> | undefined;
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [plugin, setPlugin] = useState<PluginView | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<PluginConfigView | null>(null);
  const [configText, setConfigText] = useState("{}");
  const [configInputMode, setConfigInputMode] = useState<SchemaObjectEditorMode>("JSON");
  const [selectedActionName, setSelectedActionName] = useState<string>("");
  const [actionArgsText, setActionArgsText] = useState("{}");
  const [actionArgsInputMode, setActionArgsInputMode] = useState<SchemaObjectEditorMode>("JSON");
  const [scriptInputText, setScriptInputText] = useState("{}");
  const [debugExecuting, setDebugExecuting] = useState(false);
  const [debugResult, setDebugResult] = useState<PluginInvokeResponse | null>(null);
  const [debugError, setDebugError] = useState<PluginDebugErrorState | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const requestedTab = searchParams.get("tab");
  const activeTab: PluginDetailTab =
    requestedTab === "config" || requestedTab === "debug" || requestedTab === "commands"
      ? requestedTab
      : "overview";

  const currentAction = useMemo(
    () => plugin?.actions.find((item) => item.action === selectedActionName) ?? plugin?.actions[0] ?? null,
    [plugin?.actions, selectedActionName]
  );

  const {
    supportedFields: configSupportedFields,
    unsupportedFields: configUnsupportedFields
  } = useMemo(() => resolveSchemaFields(currentConfig?.configSchema), [currentConfig?.configSchema]);
  const {
    supportedFields: actionSupportedFields,
    unsupportedFields: actionUnsupportedFields
  } = useMemo(() => resolveSchemaFields(currentAction?.inputSchema), [currentAction?.inputSchema]);
  const commandArgsInput = useMemo(
    () => currentAction
      ? resolveCommandObjectInput({
          fields: actionSupportedFields,
          formValues: watchedArgsValues,
          inputMode: actionArgsInputMode,
          jsonInput: actionArgsText,
          fallbackValue: currentAction.exampleArgs,
          emptyFallbackNote: "未填写参数，已使用示例参数。",
          emptyNoFallbackNote: "无示例参数，已使用空对象。",
          invalidFallbackNote: "参数 JSON 非法，已使用示例参数。",
          invalidNoFallbackNote: "参数 JSON 非法且无示例参数，已使用空对象。"
        })
      : { source: "empty" as const, value: {} },
    [currentAction, actionSupportedFields, watchedArgsValues, actionArgsInputMode, actionArgsText]
  );
  const commandScriptInput = useMemo(
    () => resolvePluginScriptInputCommandInput(scriptInputText),
    [scriptInputText]
  );
  const apiKey = getApiKey() ?? undefined;
  const origin = window.location.origin;

  const loadPlugin = async () => {
    setLoading(true);
    try {
      setPlugin(await getPlugin(pluginId));
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "加载插件详情失败";
      messageApi.error(detail);
    } finally {
      setLoading(false);
    }
  };

  const loadConfig = async () => {
    setConfigLoading(true);
    try {
      setCurrentConfig(await getPluginConfig(pluginId));
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "加载插件配置失败";
      messageApi.error(detail);
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setConfigLoading(true);
      try {
        const [pluginResult, configResult] = await Promise.all([
          getPlugin(pluginId),
          getPluginConfig(pluginId),
        ]);
        if (cancelled) return;
        setPlugin(pluginResult);
        setCurrentConfig(configResult);
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof ApiError ? error.message : "加载插件详情失败";
        messageApi.error(detail);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setConfigLoading(false);
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [pluginId]);

  useEffect(() => {
    if (!plugin?.actions.length) {
      setSelectedActionName("");
      return;
    }
    if (!plugin.actions.some((item) => item.action === selectedActionName)) {
      setSelectedActionName(plugin.actions[0].action);
    }
  }, [plugin?.actions, selectedActionName]);

  useEffect(() => {
    if (!currentConfig) {
      configForm.resetFields();
      setConfigText("{}");
      setConfigInputMode("JSON");
      return;
    }
    configForm.setFieldsValue(currentConfig.config);
    setConfigText(prettyJson(currentConfig.config));
    setConfigInputMode(configSupportedFields.length > 0 ? "SCHEMA" : "JSON");
  }, [configForm, configSupportedFields.length, currentConfig]);

  useEffect(() => {
    if (!currentAction) {
      argsForm.resetFields();
      setActionArgsText("{}");
      setActionArgsInputMode("JSON");
      return;
    }
    argsForm.setFieldsValue(currentAction.exampleArgs);
    setActionArgsText(prettyJson(currentAction.exampleArgs));
    setActionArgsInputMode(actionSupportedFields.length > 0 ? "SCHEMA" : "JSON");
    setDebugResult(null);
    setDebugError(null);
  }, [actionSupportedFields.length, argsForm, currentAction]);

  const handleTabChange = (key: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (key === "config" || key === "debug" || key === "commands") {
      nextParams.set("tab", key);
    } else {
      nextParams.delete("tab");
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleCopyCommand = async (command: string) => {
    try {
      await copyText(command);
      messageApi.success("命令已复制");
    } catch {
      messageApi.error("复制命令失败");
    }
  };

  const handleConfigModeChange = (nextMode: string) => {
    if (!currentConfig) {
      return;
    }
    if (nextMode === "JSON") {
      try {
        setConfigText(
          buildSchemaObjectEditorJsonText(
            configText,
            "插件配置",
            configForm.getFieldsValue(true) as Record<string, unknown>
          )
        );
        setConfigInputMode("JSON");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "切换到 JSON 模式失败";
        messageApi.error(detail);
      }
      return;
    }

    try {
      const parsed = parseSchemaObjectEditorJsonText(configText, "插件配置");
      configForm.setFieldsValue(parsed);
      setConfigInputMode("SCHEMA");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "当前 JSON 不是合法配置";
      messageApi.error(detail);
    }
  };

  const handleActionArgsModeChange = (nextMode: string) => {
    if (!currentAction) {
      return;
    }
    if (nextMode === "JSON") {
      try {
        const nextArgs = buildExecutionInputFromValues(actionSupportedFields, argsForm.getFieldsValue(true));
        setActionArgsText(buildSchemaObjectEditorJsonText(actionArgsText, "动作参数", nextArgs));
        setActionArgsInputMode("JSON");
      } catch (error) {
        const detail = error instanceof Error ? error.message : "切换到 JSON 模式失败";
        messageApi.error(detail);
      }
      return;
    }

    try {
      const parsed = parseSchemaObjectEditorJsonText(actionArgsText, "动作参数");
      argsForm.setFieldsValue(parsed);
      setActionArgsInputMode("SCHEMA");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "当前 JSON 不是合法动作参数";
      messageApi.error(detail);
    }
  };

  const resolveActionArgsPayload = async (): Promise<Record<string, unknown>> => {
    if (actionArgsInputMode === "SCHEMA" && actionSupportedFields.length > 0) {
      const values = await argsForm.validateFields();
      return buildExecutionInputFromValues(actionSupportedFields, values);
    }
    return parseJsonText(actionArgsText, "动作参数");
  };

  const handleSaveConfig = async () => {
    if (!currentConfig) {
      return;
    }
    setConfigSaving(true);
    try {
      const nextConfig =
        configInputMode === "SCHEMA"
          ? { ...parseJsonText(configText, "插件配置"), ...(await configForm.validateFields()) }
          : parseJsonText(configText, "插件配置");
      const saved = await updatePluginConfig(currentConfig.pluginId, nextConfig);
      setCurrentConfig(saved);
      configForm.setFieldsValue(saved.config);
      setConfigText(prettyJson(saved.config));
      messageApi.success("插件配置已保存");
      await loadPlugin();
    } catch (error) {
      const detail = error instanceof ApiError || error instanceof Error ? error.message : "保存插件配置失败";
      messageApi.error(detail);
    } finally {
      setConfigSaving(false);
    }
  };

  const withPluginAction = async (label: string, action: () => Promise<void>) => {
    setActionLoading(label);
    try {
      await action();
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : `${label}操作失败`;
      messageApi.error(detail);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDebugExecute = async () => {
    if (!plugin || !currentAction) {
      return;
    }
    setDebugExecuting(true);
    try {
      const args = await resolveActionArgsPayload();
      const scriptInput = parseJsonText(scriptInputText, "脚本输入");
      const response = await invokePluginAction(plugin.pluginId, currentAction.action, {
        args,
        scriptInput,
        responseView: "RESULT"
      });
      setDebugResult(response);
      setDebugError(null);
      messageApi.success("插件调用成功");
    } catch (error) {
      const detail = error instanceof ApiError || error instanceof Error ? error.message : "插件调用失败";
      setDebugResult(null);
      setDebugError({
        message: detail,
        detail: error instanceof ApiError && isErrorDetail(error.data) ? error.data : undefined
      });
      messageApi.error(detail);
    } finally {
      setDebugExecuting(false);
    }
  };

  const actionOptions = (plugin?.actions ?? []).map((action) => ({
    value: action.action,
    label: getActionLabel(action)
  }));

  const invokeCommandPresets = useMemo(() => {
    if (!plugin || !currentAction) return [];
    return buildStandardCommandPresets({
      keyPrefix: "invoke",
      httpBash: buildPluginInvokeCurlCommand({ apiKey, origin, pluginId: plugin.pluginId, action: currentAction.action, args: commandArgsInput.value, scriptInput: commandScriptInput.value, responseView: "RESULT" }),
      httpPowerShell: buildPluginInvokePowerShellCommand({ apiKey, origin, pluginId: plugin.pluginId, action: currentAction.action, args: commandArgsInput.value, scriptInput: commandScriptInput.value, responseView: "RESULT" }),
      cliBash: buildPluginInvokeCliCommand({ apiKey, origin, pluginId: plugin.pluginId, action: currentAction.action, args: commandArgsInput.value, scriptInput: commandScriptInput.value, responseView: "RESULT" }),
      cliPowerShell: buildPluginInvokePowerShellCliCommand({ apiKey, origin, pluginId: plugin.pluginId, action: currentAction.action, args: commandArgsInput.value, scriptInput: commandScriptInput.value, responseView: "RESULT" }),
      cliCmd: buildPluginInvokeCmdCliCommand({ apiKey, origin, pluginId: plugin.pluginId, action: currentAction.action, args: commandArgsInput.value, scriptInput: commandScriptInput.value, responseView: "RESULT" })
    });
  }, [plugin, currentAction, apiKey, origin, commandArgsInput, commandScriptInput]);
  if (loading && !plugin) {
    return (
      <div className="page-loading">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <>
      {contextHolder}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jar,application/java-archive"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!plugin || !file) {
            return;
          }
          void withPluginAction("upgrade", async () => {
            await upgradePlugin(plugin.pluginId, file);
            await Promise.all([loadPlugin(), loadConfig()]);
            messageApi.success("插件已升级");
          });
        }}
      />
      <Space className="script-editor-page" direction="vertical" size={16} style={{ width: "100%" }}>
        <Card>
          <Row className="page-card-header" justify="space-between" align="middle" gutter={[12, 12]}>
            <Col>
              <Space direction="vertical" size={2}>
                <Button
                  type="link"
                  icon={<ArrowLeftOutlined />}
                  style={{ paddingInline: 0 }}
                  onClick={() => navigate("/plugins")}
                >
                  返回列表
                </Button>
                <Title level={4} style={{ margin: 0 }}>
                  {plugin?.name || plugin?.pluginId || "插件详情"}
                </Title>
                {plugin ? <Text type="secondary">{plugin.pluginId}</Text> : null}
              </Space>
            </Col>
            <Col>
              <Space className="page-card-actions" wrap>
                <Button
                  icon={<ReloadOutlined />}
                  loading={loading || configLoading}
                  onClick={() => void Promise.all([loadPlugin(), loadConfig()])}
                >
                  刷新
                </Button>
                <Button
                  icon={<UploadOutlined />}
                  loading={actionLoading === "upgrade"}
                  onClick={() => fileInputRef.current?.click()}
                >
                  升级
                </Button>
                {plugin?.started ? (
                  <Button
                    icon={<PauseCircleOutlined />}
                    loading={actionLoading === "stop"}
                    onClick={() =>
                      void withPluginAction("stop", async () => {
                        setPlugin(await stopPlugin(plugin.pluginId));
                        messageApi.success("插件已停止");
                      })
                    }
                  >
                    停止
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    ghost
                    icon={<PlayCircleOutlined />}
                    loading={actionLoading === "start"}
                    onClick={() =>
                      void withPluginAction("start", async () => {
                        setPlugin(await startPlugin(pluginId));
                        messageApi.success("插件已启动");
                      })
                    }
                  >
                    启动
                  </Button>
                )}
                <Popconfirm
                  title="确认卸载这个插件？"
                  description="会删除数据库记录、插件文件与保存的配置。"
                  okText="卸载"
                  cancelText="取消"
                  onConfirm={() =>
                    withPluginAction("delete", async () => {
                      await uninstallPlugin(pluginId);
                      messageApi.success("插件已卸载");
                      navigate("/plugins");
                    })
                  }
                >
                  <Button danger icon={<DeleteOutlined />} loading={actionLoading === "delete"}>
                    卸载
                  </Button>
                </Popconfirm>
              </Space>
            </Col>
          </Row>

          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            items={[
              {
                key: "overview",
                label: "概览",
                children: plugin ? (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    {plugin.description ? <Alert type="info" showIcon message={plugin.description} /> : null}
                    {plugin.actions.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前插件没有可用动作。" />
                    ) : (
                      <Tabs
                        activeKey={currentAction?.action}
                        onChange={setSelectedActionName}
                        items={plugin.actions.map((action) => ({
                          key: action.action,
                          label: getActionLabel(action),
                          children: (
                            <Space direction="vertical" size={16} style={{ width: "100%" }}>
                              {action.description ? <Text type="secondary">{action.description}</Text> : null}
                              <Row gutter={[16, 16]}>
                                <Col xs={24} xl={12}>
                                  <SchemaFieldList
                                    schema={action.inputSchema}
                                    title="输入字段"
                                    emptyDescription="当前动作没有声明输入字段。"
                                  />
                                </Col>
                                <Col xs={24} xl={12}>
                                  <SchemaFieldList
                                    schema={action.outputSchema}
                                    title="输出字段"
                                    emptyDescription="当前动作没有声明输出字段。"
                                  />
                                </Col>
                              </Row>
                            </Space>
                          )
                        }))}
                      />
                    )}
                  </Space>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="插件详情不存在或加载失败。" />
                )
              },
              {
                key: "config",
                label: "配置",
                children: configLoading ? (
                  <Alert type="info" showIcon message="正在加载插件配置" />
                ) : !currentConfig ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="插件配置不存在或加载失败。" />
                ) : (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Alert
                      type="info"
                      showIcon
                      message="字符串字段支持使用 ${config.xxx} 引用全局配置值；插件真正执行时会按最新值解析。"
                    />
                    <SchemaObjectEditor
                      form={configForm}
                      supportedFields={configSupportedFields}
                      unsupportedFields={configUnsupportedFields}
                      inputMode={configInputMode}
                      onInputModeChange={handleConfigModeChange}
                      jsonText={configText}
                      onJsonTextChange={setConfigText}
                      jsonLabel="插件配置 JSON"
                      jsonExtra="直接输入完整配置对象保存。"
                      noSchemaExtra="当前配置 schema 无法渲染为表单，请直接输入完整配置对象。"
                      editorTheme={editorTheme}
                      fieldInputOptions={{
                        booleanLabels: {
                          checked: "启用",
                          unchecked: "关闭"
                        }
                      }}
                    />
                    <Space>
                      <Button type="primary" onClick={() => void handleSaveConfig()} loading={configSaving}>
                        保存配置
                      </Button>
                    </Space>
                  </Space>
                )
              },
              {
                key: "debug",
                label: "调试",
                children: (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    {!plugin?.started ? (
                      <Alert type="warning" showIcon message="插件未启动，当前不能执行调试。" />
                    ) : null}
                    {plugin?.actions.length ? (
                      <Row gutter={[16, 16]} align="stretch" className="equal-height-row">
                        <Col xs={24} xl={10} className="equal-height-col">
                          <Card type="inner" title="动作参数" className="equal-height-card">
                            <Space direction="vertical" size={16} style={{ width: "100%" }}>
                              <Alert
                                type="info"
                                showIcon
                                message="调试参数和脚本输入模拟里的字符串也支持 ${config.xxx}。"
                              />
                              <Form layout="vertical">
                                <Form.Item label="动作名称">
                                  <Select value={currentAction?.action} options={actionOptions} onChange={setSelectedActionName} />
                                </Form.Item>
                              </Form>
                              <SchemaObjectEditor
                                form={argsForm}
                                supportedFields={actionSupportedFields}
                                unsupportedFields={actionUnsupportedFields}
                                inputMode={actionArgsInputMode}
                                onInputModeChange={handleActionArgsModeChange}
                                jsonText={actionArgsText}
                                onJsonTextChange={setActionArgsText}
                                jsonLabel="动作参数 JSON"
                                jsonExtra="直接输入动作参数对象；命令生成也会跟随这里的内容。"
                                noSchemaExtra="当前动作没有可渲染的输入 schema，请直接输入动作参数对象。"
                                editorTheme={editorTheme}
                              />
                              <Form layout="vertical">
                                <Form.Item
                                  label="脚本输入模拟"
                                  extra="模拟插件上下文中的脚本输入（scriptInput），默认空对象；字符串支持 ${config.xxx}。"
                                >
                                  <CodeEditor
                                    height="220px"
                                    language="json"
                                    value={scriptInputText}
                                    onChange={setScriptInputText}
                                    theme={editorTheme}
                                  />
                                </Form.Item>
                              </Form>
                              <Button
                                type="primary"
                                icon={<PlayCircleOutlined />}
                                onClick={() => void handleDebugExecute()}
                                loading={debugExecuting}
                                disabled={!plugin?.started || !currentAction}
                                block
                              >
                                调试动作
                              </Button>
                            </Space>
                          </Card>
                        </Col>
                        <Col xs={24} xl={14} className="equal-height-col">
                          <Card type="inner" title="调试结果" className="equal-height-card">
                            {debugError ? (
                              <ErrorDetailPanel
                                title="插件调用失败"
                                message={debugError.message}
                                detail={debugError.detail}
                              />
                            ) : !debugResult ? (
                              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="执行后将在这里查看动作返回结果" />
                            ) : (
                              <SchemaObjectResultView
                                schema={currentAction?.outputSchema}
                                value={debugResult.result}
                              />
                            )}
                          </Card>
                        </Col>
                      </Row>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前插件没有可调试的动作。" />
                    )}
                  </Space>
                )
              },
              {
                key: "commands",
                label: "调用命令",
	                children: currentAction ? (
	                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
	                    <InfoHint
	                      label="调用命令会跟随当前动作和调试入参变化"
	                      content={
	                        apiKey
	                          ? `命令已使用当前页面 origin ${origin}；HTTP 的 bash/zsh 变体使用 curl，PowerShell 变体使用 Invoke-WebRequest，并会附带 Authorization 头；CLI 会附带 --token。`
	                          : `命令已使用当前页面 origin ${origin}；HTTP 的 bash/zsh 变体使用 curl，PowerShell 变体使用 Invoke-WebRequest；当前未设置 API Key，因此不会附带 Authorization 头或 --token。`
	                      }
	                    />
	                    {commandArgsInput.note ? <Alert type="info" showIcon message={commandArgsInput.note} /> : null}
	                    {commandScriptInput.note ? <Alert type="warning" showIcon message={commandScriptInput.note} /> : null}
	                    <Space direction="vertical" size={8}>
	                      <Text strong>当前动作</Text>
	                      <Select
	                        value={currentAction.action}
	                        options={actionOptions}
	                        onChange={setSelectedActionName}
	                        style={{ width: "100%" }}
	                      />
	                      <Text type="secondary">动作参数来源：{getCommandInputSourceLabel(commandArgsInput.source)}</Text>
	                      <Text type="secondary">
	                        脚本输入来源：{commandScriptInput.source === "current-json" ? "当前 JSON 输入" : "空对象"}
	                      </Text>
	                    </Space>
	                    <CommandTabsPanel
	                      title="调用动作命令"
	                      presets={invokeCommandPresets}
	                      onCopy={(command) => void handleCopyCommand(command)}
	                    />
	                  </Space>
	                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前插件没有可生成命令的动作。" />
                )
              }
            ]}
          />
        </Card>
      </Space>
    </>
  );
}
