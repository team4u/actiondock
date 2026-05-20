import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tooltip,
  Typography,
  message
} from "antd";
import JSZip from "jszip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getApiKey } from "../../../shared/auth/auth";
import { useColorMode } from "../../../shared/contexts/ColorModeContext";
import {
  getPlugin,
  getPluginConfig,
  deletePluginConfig,
  getNamedPluginConfig,
  invokePluginAction,
  listPluginConfigs,
  startPlugin,
  stopPlugin,
  uninstallPlugin,
  updatePluginConfig,
  upgradePlugin
} from "../../plugins/api";
import {
  listRepositories,
  publishRepositoryPlugin
} from "../../resources/api";
import { ConfirmDangerAction } from "../../../components/common/ConfirmDangerAction";
import { Col } from "../../../components/common/SafeCol";
import { CodeEditor } from "../../../components/common/CodeEditor";
import { RepositoryPublishBasicsForm } from "../../../components/repository/RepositoryPublishBasicsForm";
import { buildCliCommandPresets, buildCommandPresets, buildHttpCommandPresets } from "../../../services/commands";
import { CommandPanel } from "../../../components/execution/CommandPanel";
import { ErrorDetailPanel } from "../../../components/common/ErrorDetailPanel";
import { InfoHint } from "../../../components/common/InfoHint";
import { PluginActionsOverview } from "../../../components/plugin/PluginActionsOverview";
import { SkillExamplePanel } from "../../../components/skill/SkillExamplePanel";
import { SchemaObjectEditor, type SchemaObjectEditorMode } from "../../../components/schema/SchemaObjectEditor";
import { SchemaObjectResultView } from "../../../components/schema/SchemaObjectResultView";
import {
  buildExecutionInputFromValues,
  buildPluginInvokeCliCommand,
  buildPluginInvokeCurlCommand,
  buildPluginInvokePowerShellCommand,
  getCommandInputSourceLabel,
  resolveCommandObjectInput
} from "../../../services/commands";
import {
  buildSchemaObjectEditorJsonText,
  parseSchemaObjectEditorJsonText
} from "../../../services/schemaObjectEditorSupport";
import { useDefaultOwner } from "../../../shared/hooks/useDefaultOwner";
import { getPublishableRepositories } from "../../../services/repositoryPublish";
import { resolveSchemaFields } from "../../../services/schema";
import { ApiError } from "../../../shared/api/httpClient";
import type { ErrorDetail, PluginAction, PluginConfigView, PluginInvokeResponse, PluginView, RepositoryDefinition } from "../../../shared/types";
import { isErrorDetail } from "../../../shared/types";
import { buildPluginSkillExample } from "../../../services/skillExamples";
import { writeInlineSkillInstallSession } from "../../../services/skillInstallSession";
import { getErrorMessage, parseJsonText, prettyJson } from "../../../services/utils";
import { useCopyMessage } from "../../../shared/hooks/useCopyMessage";

const { Text, Title } = Typography;

type PluginDetailTab = "overview" | "config" | "debug" | "commands";

interface PluginDebugErrorState {
  message: string;
  detail?: ErrorDetail;
}

interface PublishPluginFormValues {
  repositoryId: string;
  displayName: string;
  version: string;
  owner?: string;
  description?: string;
  releaseNotes?: string;
  tags?: string[];
  riskLevel?: string;
  artifactUri: string;
  artifactSha256: string;
  artifactFileName?: string;
  artifactSize?: number | string;
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
  const [configForm] = Form.useForm<Record<string, unknown>>();
  const [argsForm] = Form.useForm<Record<string, unknown>>();
  const [publishForm] = Form.useForm<PublishPluginFormValues>();
  const watchedArgsValues = Form.useWatch([], argsForm) as Record<string, unknown> | undefined;
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const defaultOwner = useDefaultOwner();
  const [plugin, setPlugin] = useState<PluginView | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<PluginConfigView | null>(null);
  const [pluginConfigs, setPluginConfigs] = useState<PluginConfigView[]>([]);
  const [selectedConfigName, setSelectedConfigName] = useState("default");
  const [configText, setConfigText] = useState("{}");
  const [configInputMode, setConfigInputMode] = useState<SchemaObjectEditorMode>("JSON");
  const [selectedActionName, setSelectedActionName] = useState<string>("");
  const [actionArgsText, setActionArgsText] = useState("{}");
  const [actionArgsInputMode, setActionArgsInputMode] = useState<SchemaObjectEditorMode>("JSON");
  const [scriptInputText, setScriptInputText] = useState("{}");
  const [debugExecuting, setDebugExecuting] = useState(false);
  const [debugResult, setDebugResult] = useState<PluginInvokeResponse | null>(null);
  const [debugError, setDebugError] = useState<PluginDebugErrorState | null>(null);
  const [publishRepositories, setPublishRepositories] = useState<RepositoryDefinition[]>([]);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishingPlugin, setPublishingPlugin] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const publishAutoOpenRef = useRef(false);

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
  const apiKey = getApiKey() || undefined;
  const origin = window.location.origin;
  const isSystemPlugin = plugin?.sourceType === "SYSTEM";
  const activeConfigName = currentConfig?.configName ?? selectedConfigName;
  const invokeConfigName = activeConfigName === "default" ? undefined : activeConfigName;

  const loadAll = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setConfigLoading(true);
    try {
      const [pluginResult, configResults] = await Promise.all([
        getPlugin(pluginId),
        listPluginConfigs(pluginId),
      ]);
      if (signal?.aborted) return;
      setPlugin(pluginResult);
      setPluginConfigs(configResults);
      const nextConfig = configResults.find((item) => item.configName === "default") ?? configResults[0] ?? await getPluginConfig(pluginId);
      setSelectedConfigName(nextConfig.configName);
      setCurrentConfig(nextConfig);
    } catch (error) {
      if (signal?.aborted) return;
      const detail = error instanceof ApiError ? error.message : "加载插件详情失败";
      messageApi.error(detail);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setConfigLoading(false);
      }
    }
  }, [pluginId, messageApi]);

  const loadPlugin = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

  const loadConfig = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

  const loadNamedConfig = useCallback(async (configName: string) => {
    setConfigLoading(true);
    try {
      const config = configName === "default"
        ? await getPluginConfig(pluginId)
        : await getNamedPluginConfig(pluginId, configName);
      setSelectedConfigName(config.configName);
      setCurrentConfig(config);
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "加载插件配置失败";
      messageApi.error(detail);
    } finally {
      setConfigLoading(false);
    }
  }, [pluginId, messageApi]);

  useEffect(() => {
    const controller = new AbortController();
    void loadAll(controller.signal);
    return () => { controller.abort(); };
  }, [loadAll]);

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
    configForm.setFieldsValue(currentConfig.config as Parameters<typeof configForm.setFieldsValue>[0]);
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
    argsForm.setFieldsValue(currentAction.exampleArgs as Parameters<typeof argsForm.setFieldsValue>[0]);
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

  const handleCopyCommand = useCopyMessage(messageApi, "命令已复制", "复制命令失败");
  const openSkillInstall = useCallback(async (value: string) => {
    if (!plugin || !currentAction) {
      return;
    }
    const skillId = `actiondock-plugin-${plugin.pluginId}-${currentAction.action}`.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
    const zip = new JSZip();
    zip.file(`${skillId}/SKILL.md`, value);
    zip.file(`${skillId}/skill.json`, JSON.stringify({
      schemaVersion: 1,
      skillId,
      displayName: `${plugin.name || plugin.pluginId} ${currentAction.action}`,
      version: "1.0.0",
      description: `复用 ${plugin.pluginId}.${currentAction.action} 的 Skill`,
      entrypointPath: "SKILL.md"
    }, null, 2));
    const archive = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    await writeInlineSkillInstallSession(`${skillId}.zip`, archive);
    navigate("/skills/install");
  }, [currentAction, navigate, plugin]);

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
      configForm.setFieldsValue(parsed as Parameters<typeof configForm.setFieldsValue>[0]);
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
      argsForm.setFieldsValue(parsed as Parameters<typeof argsForm.setFieldsValue>[0]);
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
      const saved = await updatePluginConfig(currentConfig.pluginId, nextConfig, invokeConfigName);
      setCurrentConfig(saved);
      setSelectedConfigName(saved.configName);
      setPluginConfigs((items) => {
        const others = items.filter((item) => item.configName !== saved.configName);
        return [...others, saved].sort((a, b) => a.configName.localeCompare(b.configName));
      });
      configForm.setFieldsValue(saved.config as Parameters<typeof configForm.setFieldsValue>[0]);
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

  const handleCreateConfig = async () => {
    if (!currentConfig) {
      return;
    }
    const name = window.prompt("配置名");
    const configName = name?.trim();
    if (!configName) {
      return;
    }
    try {
      const saved = await updatePluginConfig(currentConfig.pluginId, {}, configName);
      setPluginConfigs((items) => [...items.filter((item) => item.configName !== saved.configName), saved]
        .sort((a, b) => a.configName.localeCompare(b.configName)));
      setSelectedConfigName(saved.configName);
      setCurrentConfig(saved);
      messageApi.success("插件配置已创建");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "创建插件配置失败"));
    }
  };

  const handleDeleteConfig = async () => {
    if (!currentConfig || currentConfig.configName === "default") {
      return;
    }
    setConfigSaving(true);
    try {
      await deletePluginConfig(currentConfig.pluginId, currentConfig.configName);
      messageApi.success("插件配置已删除");
      const configs = await listPluginConfigs(pluginId);
      setPluginConfigs(configs);
      const nextConfig = configs.find((item) => item.configName === "default") ?? configs[0] ?? await getPluginConfig(pluginId);
      setSelectedConfigName(nextConfig.configName);
      setCurrentConfig(nextConfig);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除插件配置失败"));
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

  const openPublishPluginModal = async () => {
    if (!plugin) {
      return;
    }
    setPublishingPlugin(true);
    try {
      if (plugin.sourceType === "SYSTEM") {
        messageApi.warning("系统插件不能发布到仓库");
        return;
      }
      const repositories = getPublishableRepositories(await listRepositories());
      if (repositories.length === 0) {
        messageApi.warning("当前没有可发布的仓库，请先添加一个 Git 或本地目录仓库");
        return;
      }
      setPublishRepositories(repositories);
      publishForm.setFieldsValue({
        repositoryId: repositories[0]?.id,
        displayName: plugin.name || plugin.pluginId,
        version: plugin.version,
        owner: defaultOwner,
        description: plugin.description || "",
        releaseNotes: "",
        tags: [],
        riskLevel: "LOW",
        artifactUri: `local://plugins/${plugin.pluginId}/${plugin.pluginId}-${plugin.version}.jar`,
        artifactSha256: "",
        artifactFileName: `${plugin.pluginId}-${plugin.version}.jar`,
        artifactSize: undefined
      });
      setPublishModalOpen(true);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载发布仓库失败"));
    } finally {
      setPublishingPlugin(false);
    }
  };

  useEffect(() => {
    const publishRequested = searchParams.get("publish") === "1";
    if (!publishRequested) {
      publishAutoOpenRef.current = false;
      return;
    }
    if (loading || !plugin || publishAutoOpenRef.current) {
      return;
    }

    publishAutoOpenRef.current = true;
    void openPublishPluginModal();

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("publish");
    setSearchParams(nextParams, { replace: true });
  }, [loading, plugin, searchParams, setSearchParams]);

  const handlePublishPlugin = async () => {
    if (!plugin) {
      return;
    }
    try {
      const values = await publishForm.validateFields();
      setPublishingPlugin(true);
      await publishRepositoryPlugin(values.repositoryId, {
        pluginId: plugin.pluginId,
        displayName: values.displayName.trim(),
        version: values.version.trim(),
        owner: values.owner?.trim() || undefined,
        description: values.description?.trim() || undefined,
        releaseNotes: values.releaseNotes?.trim() || undefined,
        tags: values.tags ?? [],
        riskLevel: values.riskLevel || undefined,
        artifact: {
          uri: values.artifactUri.trim(),
          sha256: values.artifactSha256?.trim() || undefined,
          fileName: values.artifactFileName?.trim() || undefined,
          size: values.artifactSize === undefined || values.artifactSize === null || values.artifactSize === ""
            ? undefined
            : Number(values.artifactSize)
        }
      });
      setPublishModalOpen(false);
      messageApi.success("插件已发布到仓库");
      await loadPlugin();
    } catch (error) {
      if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      }
      messageApi.error(getErrorMessage(error, "发布插件失败"));
    } finally {
      setPublishingPlugin(false);
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
        responseView: "RESULT",
        configName: invokeConfigName
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
    return buildCommandPresets([
      ...buildHttpCommandPresets({
        keyPrefix: "invoke",
        httpBash: buildPluginInvokeCurlCommand({ apiKey, origin, pluginId: plugin.pluginId, action: currentAction.action, args: commandArgsInput.value, scriptInput: commandScriptInput.value, responseView: "RESULT", configName: invokeConfigName }),
        httpPowerShell: buildPluginInvokePowerShellCommand({ apiKey, origin, pluginId: plugin.pluginId, action: currentAction.action, args: commandArgsInput.value, scriptInput: commandScriptInput.value, responseView: "RESULT", configName: invokeConfigName })
      }),
      ...buildCliCommandPresets({
        keyPrefix: "invoke",
        cliBash: buildPluginInvokeCliCommand({
          apiKey,
          args: commandArgsInput.value,
          environment: "bash/zsh",
          origin,
          pluginId: plugin.pluginId,
          action: currentAction.action,
          configName: invokeConfigName,
          responseView: "RESULT",
          scriptInput: commandScriptInput.value
        }),
        cliPowerShell: buildPluginInvokeCliCommand({
          apiKey,
          args: commandArgsInput.value,
          environment: "PowerShell",
          origin,
          pluginId: plugin.pluginId,
          action: currentAction.action,
          configName: invokeConfigName,
          responseView: "RESULT",
          scriptInput: commandScriptInput.value
        })
      })
    ]);
  }, [plugin, currentAction, apiKey, origin, commandArgsInput, commandScriptInput, invokeConfigName]);

  const skillExample = useMemo(() => {
    if (!plugin || !currentAction) {
      return "";
    }
    return buildPluginSkillExample({
      pluginId: plugin.pluginId,
      action: currentAction.action,
      configName: invokeConfigName,
      args: commandArgsInput.value,
      argsSource: commandArgsInput.source,
      scriptInput: commandScriptInput.value,
      scriptInputSource: commandScriptInput.source,
      inputSchema: currentAction.inputSchema,
      outputSchema: currentAction.outputSchema,
      invokeCommandPresets
    });
  }, [plugin, currentAction, commandArgsInput, commandScriptInput, invokeCommandPresets]);

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
                  onClick={() => void loadAll()}
                >
                  刷新
                </Button>
                <Button
                  type="primary"
                  loading={publishingPlugin}
                  disabled={!plugin || isSystemPlugin}
                  onClick={() => void openPublishPluginModal()}
                >
                  发布到仓库
                </Button>
                {!isSystemPlugin ? (
                  <Button
                    icon={<UploadOutlined />}
                    loading={actionLoading === "upgrade"}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    升级
                  </Button>
                ) : null}
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
                {!isSystemPlugin ? (
                  <ConfirmDangerAction
                    title="确认卸载这个插件？"
                    description="会删除数据库记录、插件文件与保存的配置。"
                    okText="卸载"
                    onConfirm={() =>
                      withPluginAction("delete", async () => {
                        await uninstallPlugin(pluginId);
                        messageApi.success("插件已卸载");
                        navigate("/plugins");
                      })
                    }
                    loading={actionLoading === "delete"}
                  >
                    <Button danger icon={<DeleteOutlined />}>
                      卸载
                    </Button>
                  </ConfirmDangerAction>
                ) : null}
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
                  <PluginActionsOverview
                    messageApi={messageApi}
                    description={plugin.description}
                    actions={plugin.actions}
                    snippetContext={{ pluginId: plugin.pluginId, scriptType: "GROOVY" }}
                    commandContext={{ apiKey, origin, pluginId: plugin.pluginId }}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="插件详情不存在或加载失败。" />
                )
              },
              {
                key: "config",
                label: <Space>配置 <Tooltip title="字符串字段支持使用 ${config.xxx} 引用全局配置值；插件真正执行时会按最新值解析。"><QuestionCircleOutlined style={{ color: "#1677ff", fontSize: 14 }} /></Tooltip></Space>,
                children: configLoading ? (
                  <Alert type="info" showIcon message="正在加载插件配置" />
                ) : !currentConfig ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="插件配置不存在或加载失败。" />
                ) : !plugin?.configurable ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前插件没有独立插件配置。" />
                ) : (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Space wrap>
                      {!isSystemPlugin ? (
                        <>
                          <Select
                            value={activeConfigName}
                            options={pluginConfigs.map((item) => ({
                              value: item.configName,
                              label: item.configName === "default" ? "default（默认）" : item.configName
                            }))}
                            onChange={(value) => void loadNamedConfig(value)}
                            style={{ minWidth: 220 }}
                          />
                          <Button onClick={() => void handleCreateConfig()}>
                            新建配置
                          </Button>
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            disabled={activeConfigName === "default"}
                            loading={configSaving}
                            onClick={() => void handleDeleteConfig()}
                          >
                            删除配置
                          </Button>
                        </>
                      ) : null}
                    </Space>
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
                          <Card type="inner" title={<Space>动作参数 <Tooltip title="调试参数和脚本输入模拟里的字符串也支持 ${config.xxx}。"><QuestionCircleOutlined style={{ color: "#1677ff", fontSize: 14 }} /></Tooltip></Space>} className="equal-height-card">
                            <Space direction="vertical" size={16} style={{ width: "100%" }}>
                              <Form layout="vertical">
                                <Form.Item label="动作名称">
                                  <Select value={currentAction?.action} options={actionOptions} onChange={setSelectedActionName} />
                                </Form.Item>
                                {!isSystemPlugin && pluginConfigs.length > 0 ? (
                                  <Form.Item label="插件配置">
                                    <Select
                                      value={activeConfigName}
                                      options={pluginConfigs.map((item) => ({
                                        value: item.configName,
                                        label: item.configName === "default" ? "default（默认）" : item.configName
                                      }))}
                                      onChange={(value) => void loadNamedConfig(value)}
                                    />
                                  </Form.Item>
                                ) : null}
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
                                调试
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
	                          ? `命令已使用当前页面 origin ${origin}；HTTP 变体提供 curl / Invoke-WebRequest，CLI 变体提供 actiondock，并会自动附带当前 Bearer Token。`
	                          : `命令已使用当前页面 origin ${origin}；HTTP 变体提供 curl / Invoke-WebRequest，CLI 变体提供 actiondock；当前未设置 Bearer Token，因此不会附带 Authorization 头或 --token。`
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
                      {!isSystemPlugin ? (
                        <Text type="secondary">插件配置：{activeConfigName}</Text>
                      ) : null}
	                    </Space>
	                    <CommandPanel
	                      title="调用动作命令"
	                      presets={invokeCommandPresets}
	                      onCopy={(command) => void handleCopyCommand(command)}
	                    />
                      <SkillExamplePanel
                        value={skillExample}
                        onCopy={(value) => void handleCopyCommand(value, "Skill 已复制", "复制 Skill 失败")}
                        onOpenInstall={openSkillInstall}
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
      <Drawer
        title={plugin ? `发布插件：${plugin.pluginId}` : "发布插件"}
        open={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        width={600}
        destroyOnHidden
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setPublishModalOpen(false)}>取消</Button>
            <Button type="primary" loading={publishingPlugin} onClick={() => void handlePublishPlugin()}>
              发布
            </Button>
          </div>
        }
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Text type="secondary">
            发布会写入插件元数据和制品引用，并更新仓库索引。local:// 指向仓库内 JAR；目标文件不存在时会从当前已安装插件复制。SHA-256 留空时会自动计算。
          </Text>
          <Form form={publishForm} layout="vertical">
            <RepositoryPublishBasicsForm
              repositories={publishRepositories}
              displayNameLabel="显示名称"
              displayNamePlaceholder="例如 清理缓存"
              versionPlaceholder="例如 1.0.0"
              ownerPlaceholder="例如 platform-team"
              tagsPlaceholder="输入后回车"
              releaseNotesLabel="发布日志"
              releaseNotesPlaceholder="本次发布的变更说明，支持 Markdown 语法"
              showRiskLevel
            />
            <Form.Item
              label="插件包 URI"
              name="artifactUri"
              extra="用于定位插件 JAR。local:// 表示当前仓库内的 JAR 文件；http/https 表示安装时远程下载。"
              rules={[
                { required: true, message: "请输入插件包 URI" },
                {
                  validator: (_, value: string) => {
                    const text = value?.trim() ?? "";
                    return /^(local|https?):\/\/.+/.test(text)
                      ? Promise.resolve()
                      : Promise.reject(new Error("仅支持 local://、http://、https://"));
                  }
                }
              ]}
            >
              <Input placeholder="local://plugins/demo-plugin/demo-plugin-1.0.0.jar" />
            </Form.Item>
            <Form.Item
              label="SHA-256"
              name="artifactSha256"
              extra="可留空，发布时会根据插件包 URI 自动计算。填写后会按该值校验插件包。"
              rules={[
                {
                  validator: (_, value: string) => {
                    const text = value?.trim() ?? "";
                    return text === "" || /^[a-fA-F0-9]{64}$/.test(text)
                      ? Promise.resolve()
                      : Promise.reject(new Error("SHA-256 必须是 64 位十六进制字符串"));
                  }
                }
              ]}
            >
              <Input placeholder="留空自动计算" />
            </Form.Item>
            <Space size={12} style={{ width: "100%" }} wrap>
              <Form.Item label="文件名" name="artifactFileName" style={{ flex: "1 1 260px", minWidth: 220 }}>
                <Input placeholder="demo-plugin-1.0.0.jar" />
              </Form.Item>
              <Form.Item label="大小（字节）" name="artifactSize" style={{ flex: "1 1 180px", minWidth: 180 }}>
                <InputNumber min={0} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Space>
          </Form>
        </Space>
      </Drawer>
    </>
  );
}
