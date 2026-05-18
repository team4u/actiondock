import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  ForkOutlined,
  ImportOutlined,
  MoreOutlined,
  RollbackOutlined,
  RocketOutlined,
  SaveOutlined,
  SyncOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Dropdown,
  Form,
  Modal,
  Row,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message
} from "antd";
import type { MenuProps } from "antd";
import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { executeScript, getExecution } from "../../../executions/api";
import { getApiKey } from "../../../../shared/auth/auth";
import { ScopeTag } from "../../../../components/common/ScopeTag";
import { Col } from "../../../../components/common/SafeCol";
import { ExecutionPresetBar } from "../../../../components/execution/ExecutionPresetBar";
import {
  buildCliCommandPresets,
  buildCommandPresets,
  buildHttpCommandPresets,
  buildExecutionInputFromValues
} from "../../../../services/commands";
import {
  buildExecuteCliCommand,
  buildExecuteCurlCommand,
  buildExecutePowerShellCommand,
  buildScriptDetailCliCommand,
  buildScriptDetailCurlCommand,
  buildScriptDetailPowerShellCommand,
  buildToolDetailCurlCommand,
  buildToolDetailPowerShellCommand,
  buildToolSchemaCliCommand,
  resolveExecutionCommandInput
} from "../../../../services/commands";
import { formatDateTime, parseJsonText } from "../../../../services/utils";
import { useCopyMessage } from "../../../../shared/hooks/useCopyMessage";
import { buildScriptSkillExample } from "../../../../services/skillExamples";
import { writeInlineSkillInstallSession } from "../../../../services/skillInstallSession";
import { UpstreamSyncTag } from "../../../../components/domain/UpstreamSyncTag";
import { ScriptDiffDrawer } from "../../../../components/diff/ScriptDiffDrawer";
import { ScriptDiffSummary } from "../../../../components/diff/ScriptDiffSummary";
import { formatSchemaEditorState } from "../../../../services/schema";
import { buildPublishDiffTarget, buildPublishScriptDiff } from "../../../../services/scriptDiff";
import { isScriptPublished } from "../../../../services/scriptPublication";
import { useScriptEditor } from "./useScriptEditor";
import { useScriptExecution } from "./useScriptExecution";
import { useScriptPublishToRepo } from "./useScriptPublishToRepo";
import { useScriptFork } from "./useScriptFork";
import { useScriptReferences } from "./useScriptReferences";
import { GeneratedScriptImportModal } from "./GeneratedScriptImportModal";
import { PublishToRepositoryModal } from "./PublishToRepositoryModal";
import { ForkScriptModal } from "../../../../components/common/ForkScriptModal";
import { ScriptReferenceModal } from "./ScriptReferenceModal";
import { PluginReferenceModal } from "./PluginReferenceModal";
import { ScriptDefinitionTab } from "./ScriptDefinitionTab";
import { ScriptCommandsTab } from "./ScriptCommandsTab";
import { ScriptExecutionTab } from "./ScriptExecutionTab";
import type { ScriptEditorFormValues } from "./types";
import type { ScriptEditorPageProps } from "./types";
import type { ScriptType } from "../../../../shared/types";

const { Text } = Typography;

function resolvePreviewSchema(rawText: string): Record<string, unknown> {
  try {
    return parseJsonText(rawText, "Schema");
  } catch {
    return {};
  }
}

export function ScriptEditorPage({ colorMode, mode }: ScriptEditorPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [messageApi, contextHolder] = message.useMessage();
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [scriptDiffDrawerOpen, setScriptDiffDrawerOpen] = useState(false);
  const publishAutoOpenRef = useRef(false);

  const [scriptForm] = Form.useForm<ScriptEditorFormValues>();
  const [executionForm] = Form.useForm<Record<string, unknown>>();
  const [generatedScriptModalOpen, setGeneratedScriptModalOpen] = useState(false);
  const [generatedScriptText, setGeneratedScriptText] = useState("");
  const watchedScriptValues = Form.useWatch([], scriptForm) as Partial<ScriptEditorFormValues> | undefined;

  // --- Core editor hook (also manages plugins) ---
  const editor = useScriptEditor({ mode, form: scriptForm, messageApi });

  // --- References hook (uses editor's plugin references and available scripts) ---
  const references = useScriptReferences({
    currentScript: editor.currentScript,
    availableScripts: editor.availableScripts,
    availablePlugins: editor.availablePluginReferences
  });

  // --- Execution hook ---
  const execution = useScriptExecution({
    currentScript: editor.currentScript,
    executionForm,
    messageApi
  });

  // --- Fork hook ---
  const fork = useScriptFork({
    currentScript: editor.currentScript,
    messageApi
  });

  // --- Execution command input ---
  const watchedExecutionValues = Form.useWatch([], executionForm) as Record<string, unknown> | undefined;
  const currentExecutionInput = useMemo(() => {
    if (!editor.currentScript) return null;
    try {
      if (execution.executionInputMode === "SCHEMA" && execution.supportsSchemaForm) {
        return buildExecutionInputFromValues(
          execution.supportedFields,
          executionForm.getFieldsValue(true) as Record<string, unknown>
        );
      }
      return parseJsonText(execution.executionJsonInput, "执行入参");
    } catch {
      return null;
    }
  }, [editor.currentScript, execution.executionInputMode, execution.supportsSchemaForm,
      execution.supportedFields, execution.executionJsonInput, watchedExecutionValues]);

  const executionPresetBar = (
    <ExecutionPresetBar
      scriptId={editor.currentScript?.id}
      inputSchema={editor.currentScript?.inputSchema}
      currentInput={currentExecutionInput}
      onLoadPreset={execution.handleLoadPreset}
    />
  );

  const commandInput = useMemo(
    () => resolveExecutionCommandInput({
      fields: execution.supportedFields,
      formValues: watchedExecutionValues,
      inputMode: execution.executionInputMode,
      jsonInput: execution.executionJsonInput
    }),
    [execution.supportedFields, watchedExecutionValues, execution.executionInputMode, execution.executionJsonInput]
  );

  // --- Command presets ---
  const origin = window.location.origin;
  const apiKey = getApiKey() || undefined;

  const detailCommandPresets = useMemo(() => {
    if (!editor.currentScript) return [];
    return buildCommandPresets([
      ...buildHttpCommandPresets({
        keyPrefix: "detail",
        httpBash: buildScriptDetailCurlCommand({ apiKey, origin, scriptId: editor.currentScript.id }),
        httpPowerShell: buildScriptDetailPowerShellCommand({ apiKey, origin, scriptId: editor.currentScript.id })
      }),
      ...buildCliCommandPresets({
        keyPrefix: "detail",
        cliBash: buildScriptDetailCliCommand({ apiKey, environment: "bash/zsh", origin, scriptId: editor.currentScript.id }),
        cliPowerShell: buildScriptDetailCliCommand({ apiKey, environment: "PowerShell", origin, scriptId: editor.currentScript.id })
      })
    ]);
  }, [editor.currentScript, apiKey, origin]);

  const executeCommandPresets = useMemo(() => {
    if (!editor.currentScript) return [];
    return buildCommandPresets([
      ...buildHttpCommandPresets({
        keyPrefix: "execute",
        httpBash: buildExecuteCurlCommand({ apiKey, input: commandInput.value, mode: execution.executionMode, origin, scriptId: editor.currentScript.id }),
        httpPowerShell: buildExecutePowerShellCommand({ apiKey, input: commandInput.value, mode: execution.executionMode, origin, scriptId: editor.currentScript.id })
      }),
      ...buildCliCommandPresets({
        keyPrefix: "execute",
        cliBash: buildExecuteCliCommand({
          apiKey,
          environment: "bash/zsh",
          input: commandInput.value,
          mode: execution.executionMode,
          origin,
          scriptId: editor.currentScript.id
        }),
        cliPowerShell: buildExecuteCliCommand({
          apiKey,
          environment: "PowerShell",
          input: commandInput.value,
          mode: execution.executionMode,
          origin,
          scriptId: editor.currentScript.id
        })
      })
    ]);
  }, [editor.currentScript, apiKey, origin, commandInput, execution.executionMode]);

  const schemaCommandPresets = useMemo(() => {
    if (!editor.currentScript) return [];
    return buildCommandPresets([
      ...buildHttpCommandPresets({
        keyPrefix: "schema",
        httpBash: buildToolDetailCurlCommand({ apiKey, origin, scriptId: editor.currentScript.id }),
        httpPowerShell: buildToolDetailPowerShellCommand({ apiKey, origin, scriptId: editor.currentScript.id })
      }),
      ...buildCliCommandPresets({
        keyPrefix: "schema",
        cliBash: buildToolSchemaCliCommand({ apiKey, environment: "bash/zsh", origin, scriptId: editor.currentScript.id }),
        cliPowerShell: buildToolSchemaCliCommand({ apiKey, environment: "PowerShell", origin, scriptId: editor.currentScript.id })
      })
    ]);
  }, [editor.currentScript, apiKey, origin]);

  const toolContractResponseExample = editor.currentScript
    ? {
        status: 0,
        msg: "处理成功",
        data: {
          ...(execution.hasInputSchema ? { input: execution.supportedFields } : {}),
          ...(execution.hasOutputSchema ? { output: execution.supportedOutputFields } : {})
        }
      }
    : undefined;

  const skillExample = useMemo(() => {
    if (!editor.currentScript) {
      return "";
    }
    return buildScriptSkillExample({
      scriptId: editor.currentScript.id,
      description: editor.currentScript.description,
      executionMode: execution.executionMode,
      input: commandInput.value,
      inputSource: commandInput.source,
      inputSchema: execution.hasInputSchema ? execution.supportedFields : undefined,
      outputSchema: execution.hasOutputSchema ? execution.supportedOutputFields : undefined,
      executeCommandPresets
    });
  }, [
    editor.currentScript,
    execution.executionMode,
    execution.hasInputSchema,
    execution.hasOutputSchema,
    execution.supportedFields,
    execution.supportedOutputFields,
    commandInput,
    executeCommandPresets
  ]);

  const openSkillInstall = async (value: string) => {
    if (!editor.currentScript) {
      return;
    }
    const skillId = `actiondock-script-${editor.currentScript.id}`.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
    const zip = new JSZip();
    zip.file(`${skillId}/SKILL.md`, value);
    zip.file(`${skillId}/skill.json`, JSON.stringify({
      schemaVersion: 1,
      skillId,
      displayName: editor.currentScript.name || editor.currentScript.id,
      version: "1.0.0",
      description: editor.currentScript.description || `执行 ${editor.currentScript.id}`,
      entrypointPath: "SKILL.md"
    }, null, 2));
    const archive = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    await writeInlineSkillInstallSession(`${skillId}.zip`, archive);
    navigate("/skills/install");
  };

  const previewInputSchemaText = formatSchemaEditorState(editor.inputSchemaState);
  const previewOutputSchemaText = formatSchemaEditorState(editor.outputSchemaState);
  const previewScriptType =
    (watchedScriptValues?.type as ScriptType | undefined) ?? editor.selectedScriptType;
  const publishTarget = useMemo(
    () =>
      buildPublishDiffTarget({
        name: watchedScriptValues?.name?.trim() || editor.currentScript?.name || "",
        type: previewScriptType,
        packaging: (watchedScriptValues?.packaging as "TOOL" | "FLOW" | undefined) ?? editor.currentScript?.packaging ?? "TOOL",
        source: editor.sourceText,
        pythonRequirements: watchedScriptValues?.pythonRequirements ?? editor.currentScript?.pythonRequirements,
        inputSchema: resolvePreviewSchema(previewInputSchemaText),
        outputSchema: resolvePreviewSchema(previewOutputSchemaText),
        rawInputSchemaText: previewInputSchemaText,
        rawOutputSchemaText: previewOutputSchemaText,
        description: watchedScriptValues?.description?.trim() || editor.currentScript?.description,
        owner: editor.currentScript?.owner,
        tags: editor.currentScript?.tags ?? [],
        scriptDependencies: editor.currentScript?.scriptDependencies,
        pluginDependencies: previewScriptType === "GROOVY" ? editor.detectedPluginDependencies : [],
        aiDependencies: editor.detectedAiDependencies.map((item) =>
          [item.capability, item.profile ?? "", item.agentProfile ?? "", item.required ? "required" : "optional"].join(":")
        )
      }),
    [
      editor.currentScript?.description,
      editor.currentScript?.name,
      editor.currentScript?.owner,
      editor.currentScript?.packaging,
      editor.currentScript?.scriptDependencies,
      editor.detectedPluginDependencies,
      editor.sourceText,
      previewInputSchemaText,
      previewOutputSchemaText,
      previewScriptType,
      watchedScriptValues?.description,
      watchedScriptValues?.name,
      watchedScriptValues?.packaging,
      watchedScriptValues?.pythonRequirements
    ]
  );
  const publishToRepo = useScriptPublishToRepo({
    currentScript: editor.currentScript,
    availableScripts: editor.availableScripts,
    sourceText: editor.sourceText,
    isReadOnlyScript: editor.isReadOnlyScript,
    publishTarget,
    ensureCurrentScriptPublished: editor.ensureCurrentScriptPublished,
    messageApi
  });

  const publishRequested = searchParams.get("publish") === "1";
  useEffect(() => {
    if (!publishRequested) {
      publishAutoOpenRef.current = false;
      return;
    }
    if (mode === "create" || editor.loading || !editor.currentScript || publishAutoOpenRef.current) {
      return;
    }

    publishAutoOpenRef.current = true;
    void publishToRepo.openPublishToRepositoryModal({
      repositoryId: searchParams.get("repositoryId") ?? undefined
    });

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("publish");
    setSearchParams(nextParams, { replace: true });
  }, [
    editor.currentScript,
    editor.loading,
    mode,
    publishRequested,
    publishToRepo,
    searchParams,
    setSearchParams
  ]);

  const publishDiff = useMemo(() => {
    return buildPublishScriptDiff(
      editor.currentScript ?? {
        id: "",
        name: publishTarget.name ?? "",
        type: previewScriptType,
        packaging: publishTarget.packaging ?? "TOOL",
        source: editor.sourceText,
        inputSchema: publishTarget.inputSchema ?? {},
        outputSchema: publishTarget.outputSchema ?? {},
        publication: {
          published: false,
          dirty: false
        },
        version: 1
      },
      publishTarget
    );
  }, [
    editor.currentScript,
    editor.selectedScriptType,
    editor.sourceText,
    previewInputSchemaText,
    previewOutputSchemaText,
    previewScriptType,
    publishTarget
  ]);
  const showDiffNotice = editor.hasUnpublishedChanges;
  const openPublishConfirm = () => {
    if (!publishDiff.hasChanges && publishDiff.comparisonMode !== "INITIAL") {
      void editor.handlePublish();
      return;
    }
    setPublishConfirmOpen(true);
  };

  const handleConfirmPublish = async () => {
    setPublishConfirmOpen(false);
    await editor.handlePublish();
  };

  // --- Menu items ---
  const publishMenuItems: MenuProps["items"] = editor.headerActionModel.publishMenuKeys.map((key) => ({
    key,
    icon: <ExportOutlined />,
    label: "发布到仓库",
    onClick: () => void publishToRepo.openPublishToRepositoryModal()
  }));

  const dangerousMoreActionKeys = new Set(["discard-draft", "delete"]);
  const moreMenuItems: MenuProps["items"] = [
    ...(editor.developmentStatus
      ? [{
          key: "pull-upstream",
          icon: <SyncOutlined />,
          label: "拉取上游",
          disabled: editor.developmentPulling,
          onClick: () => void editor.handlePullDevelopment()
        }]
      : []),
    ...editor.headerActionModel.moreActionKeys
      .filter((key) => !dangerousMoreActionKeys.has(key))
      .map((key) => {
        if (key === "copy") {
          return {
            key,
            icon: <CopyOutlined />,
            label: "复制脚本",
            onClick: () => navigate(`/scripts/new?copyFrom=${encodeURIComponent(editor.currentScript?.id ?? "")}`)
          };
        }
        if (key === "import-generated") {
          return {
            key,
            icon: <ImportOutlined />,
            label: "粘贴结果",
            onClick: () => setGeneratedScriptModalOpen(true)
          };
        }
        if (key === "validate") {
          return {
            key,
            icon: <CheckCircleOutlined />,
            label: "校验",
            onClick: () => void editor.handleValidate()
          };
        }
        return null;
      })
      .filter(Boolean),
    ...(editor.headerActionModel.moreActionKeys.some((key) => dangerousMoreActionKeys.has(key))
      ? [{ type: "divider" as const }]
      : []),
    ...editor.headerActionModel.moreActionKeys
      .filter((key) => dangerousMoreActionKeys.has(key))
      .map((key) => {
        if (key === "discard-draft") {
          return { key, icon: <RollbackOutlined />, label: "丢弃草稿", danger: true as const, onClick: editor.openDiscardDraftConfirm };
        }
        return { key, icon: <DeleteOutlined />, label: "删除", danger: true as const, onClick: editor.openDeleteScriptConfirm };
      })
  ];

  // --- Tab management ---
  const handleTabChange = (key: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (key === "execution" || key === "commands") {
      nextParams.set("tab", key);
    } else {
      nextParams.delete("tab");
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleCopyCommand = useCopyMessage(messageApi, "命令已复制", "复制命令失败");

  const requestedTab = searchParams.get("tab");
  const activeTab =
    mode === "create"
      ? "definition"
      : requestedTab === "execution"
        ? "execution"
        : requestedTab === "commands"
          ? "commands"
          : "definition";

  if (editor.loading) {
    return (
      <>
        {contextHolder}
        {editor.modalContextHolder}
        <div className="page-loading">
          <Spin size="large" />
        </div>
      </>
    );
  }

  return (
    <>
      {contextHolder}
      {editor.modalContextHolder}

      <GeneratedScriptImportModal
        open={generatedScriptModalOpen}
        value={generatedScriptText}
        onChange={setGeneratedScriptText}
        onImport={() => {
          editor.handleImportGeneratedScript(generatedScriptText);
          setGeneratedScriptModalOpen(false);
          setGeneratedScriptText("");
        }}
        onCancel={() => setGeneratedScriptModalOpen(false)}
      />

      <PublishToRepositoryModal
        open={publishToRepo.publishToRepositoryOpen}
        onCancel={() => publishToRepo.setPublishToRepositoryOpen(false)}
        onOk={() => void publishToRepo.handlePublishToRepository()}
        confirmLoading={publishToRepo.publishingToRepository}
        metadataLoading={publishToRepo.publishMetadataLoading}
        form={publishToRepo.publishForm}
        versionSuggestion={publishToRepo.publishVersionSuggestion}
        repositories={publishToRepo.publishRepositories}
        dependencyRepositories={publishToRepo.publishDependencyRepositories}
        schedules={publishToRepo.publishSchedules}
        configPreview={publishToRepo.publishConfigPreview}
        configPreviewLoading={publishToRepo.publishConfigPreviewLoading}
        repositoryDiff={publishToRepo.publishRepositoryDiff}
        repositoryDiffLoading={publishToRepo.publishRepositoryDiffLoading}
        repositoryContentUnchanged={publishToRepo.publishRepositoryContentUnchanged}
        theme={editorTheme}
        targetType={previewScriptType}
        configModes={publishToRepo.publishConfigModes}
        onConfigModesChange={publishToRepo.setPublishConfigModes}
        repositoryTools={publishToRepo.publishRepositoryTools}
        scriptDependencies={publishToRepo.publishScriptDependencies}
        hasDynamicScriptDependencies={publishToRepo.publishHasDynamicScriptDependencies}
        onScriptDependencyChange={publishToRepo.updatePublishScriptDependency}
        onValuesChange={publishToRepo.handlePublishFormValuesChange}
        pluginDependencies={editor.detectedPluginDependencies}
      />

      <ForkScriptModal
        open={fork.forkModalOpen}
        onCancel={() => fork.setForkModalOpen(false)}
        onOk={() => void fork.handleForkRepositoryScript()}
        confirmLoading={fork.forkingRepositoryTool}
        form={fork.forkForm}
      />

      <ScriptReferenceModal
        script={references.referenceScript}
        onClose={() => references.setReferenceScriptId(null)}
        selectedScriptType={editor.selectedScriptType}
        messageApi={messageApi}
      />

      <PluginReferenceModal
        plugin={references.referencePlugin}
        onClose={() => references.setReferencePluginId(null)}
        selectedScriptType={editor.selectedScriptType}
        messageApi={messageApi}
      />

      <Modal
        title="发布确认"
        open={publishConfirmOpen}
        onCancel={() => setPublishConfirmOpen(false)}
        onOk={() => void handleConfirmPublish()}
        okText="确认发布"
        cancelText="取消"
        confirmLoading={editor.publishing}
        width={760}
        destroyOnHidden
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <ScriptDiffSummary diff={publishDiff} />
          <Button onClick={() => setScriptDiffDrawerOpen(true)}>查看完整 Diff</Button>
        </Space>
      </Modal>

      <ScriptDiffDrawer
        open={scriptDiffDrawerOpen}
        onClose={() => setScriptDiffDrawerOpen(false)}
        diff={publishDiff}
        scriptId={editor.currentScript?.id || watchedScriptValues?.id}
        theme={editorTheme}
        targetType={previewScriptType}
      />

      <Space className="script-editor-page" direction="vertical" size={16} style={{ width: "100%" }}>
        <Row className="page-card-header" justify="space-between" align="middle" gutter={[12, 12]}>
          <Col className="page-card-header__back">
            <Button
              type="link"
              icon={<ArrowLeftOutlined />}
              style={{ paddingInline: 0 }}
              onClick={() => navigate("/scripts")}
            >
              返回脚本列表
            </Button>
          </Col>
          <Col className="page-card-actions">
            <Space className="page-card-actions script-editor-page__header-actions" wrap>
              {editor.headerActionModel.showForkOnly && editor.currentScript?.scope === "REPOSITORY" ? (
                <>
                  <Button icon={<ForkOutlined />} type="primary" onClick={fork.openForkModal} loading={fork.forkingRepositoryTool}>
                    创建 Fork
                  </Button>
                </>
              ) : (
                <>
                  {editor.headerActionModel.showSave ? (
                    <Button
                      icon={<SaveOutlined />}
                      type="primary"
                      onClick={() => void editor.handleSave()}
                      loading={editor.saving}
                    >
                      保存
                    </Button>
                  ) : null}
                  {editor.headerActionModel.showPublish ? (
                    editor.headerActionModel.publishMenuKeys.length > 0 ? (
                      <Dropdown.Button
                        menu={{ items: publishMenuItems }}
                        onClick={openPublishConfirm}
                        loading={editor.publishing || publishToRepo.publishingToRepository || publishToRepo.publishMetadataLoading}
                      >
                        发布
                      </Dropdown.Button>
                    ) : (
                      <Button
                        icon={<RocketOutlined />}
                        onClick={openPublishConfirm}
                        loading={editor.publishing}
                      >
                        发布
                      </Button>
                    )
                  ) : null}
                  {editor.headerActionModel.showMore ? (
                    <Dropdown trigger={["click"]} menu={{ items: moreMenuItems }}>
                      <Button icon={<MoreOutlined />}>更多</Button>
                    </Dropdown>
                  ) : null}
                </>
              )}
            </Space>
          </Col>
        </Row>

        {mode === "create" && editor.copiedFromScript ? (
          <Alert
            type="info"
            showIcon
            message={`已从 ${editor.copiedFromScript.name || editor.copiedFromScript.id} 复制当前内容`}
            description="已自动生成新的脚本 ID，并预填源码、类型和输入输出结构。保存前请确认脚本 ID 未与现有脚本冲突。"
          />
        ) : null}

        {showDiffNotice ? (
          <Alert
            type="warning"
            showIcon
            message="有未发布变更"
            description="当前本地内容与已发布版本存在差异，发布前建议先核对完整 Diff。"
            action={
              <Button size="small" onClick={() => setScriptDiffDrawerOpen(true)}>
                查看变更
              </Button>
            }
          />
        ) : null}

        {editor.currentScript && (
          <Card>
            <Typography.Title level={4} style={{ margin: "0 0 16px 0" }}>
              {editor.currentScript.name}
            </Typography.Title>
            <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label="状态 / 更新时间">
                <Space size={8} wrap>
                  <Tag color={isScriptPublished(editor.currentScript) ? "green" : "gold"}>
                    {isScriptPublished(editor.currentScript) ? "已发布" : "草稿"}
                  </Tag>
                  {editor.hasUnpublishedChanges ? (
                    <Tooltip title="保存为草稿，需点击「发布」生效。如需回退可「丢弃草稿」。">
                      <Tag color="orange">未发布修改</Tag>
                    </Tooltip>
                  ) : null}
                  <Text type="secondary">{formatDateTime(editor.currentScript.updatedAt)}</Text>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="来源">
                <Space size={8} wrap>
                  <ScopeTag scope={editor.currentScript.scope} />
                  {editor.isReadOnlyScript ? (
                    <Tooltip title="当前是仓库安装的只读脚本。你可以直接运行和查看契约，但不能原地修改。需要调整实现时，请先创建 Fork，或重新发布到某个仓库。">
                      <Tag color="gold">只读</Tag>
                    </Tooltip>
                  ) : (
                    <Tag color="green">可编辑</Tag>
                  )}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="类型">{editor.currentScript.type}</Descriptions.Item>
              {editor.detectedPluginDependencies.length > 0 ? (
                <Descriptions.Item label="插件依赖">
                  <Space size={[4, 4]} wrap>
                    {editor.detectedPluginDependencies.map((dep) => (
                      <Tooltip key={dep.pluginId} title={`版本范围: ${dep.versionRange || "任意"}`}>
                        <Tag color="geekblue">{dep.pluginId}</Tag>
                      </Tooltip>
                    ))}
                  </Space>
                </Descriptions.Item>
              ) : null}
              {editor.detectedAiDependencies.length > 0 ? (
                <Descriptions.Item label="AI 依赖">
                  <Space size={[4, 4]} wrap>
                    {editor.detectedAiDependencies.map((dep) => (
                      <Tooltip
                        key={`${dep.capability}:${dep.profile ?? dep.agentProfile ?? ""}`}
                        title={dep.profile || dep.agentProfile || "未指定 Profile"}
                      >
                        <Tag color="cyan">{dep.capability}</Tag>
                      </Tooltip>
                    ))}
                  </Space>
                </Descriptions.Item>
              ) : null}
              {editor.developmentStatus ? (
                <Descriptions.Item label="本地发布号">{editor.currentScript.version}</Descriptions.Item>
              ) : (
                <Descriptions.Item label="版本">{editor.currentScript.version}</Descriptions.Item>
              )}
              <Descriptions.Item label="来源仓库">{editor.currentScript.repositoryId || "-"}</Descriptions.Item>
              <Descriptions.Item label="来源脚本">{editor.currentScript.repositoryScriptId || "-"}</Descriptions.Item>
              <Descriptions.Item label={editor.developmentStatus ? "上次同步仓库版本" : "仓库版本"}>
                {editor.currentScript.repositoryVersion || "-"}
              </Descriptions.Item>
              {editor.developmentStatus ? (
                <>
                  <Descriptions.Item label="当前仓库版本">{editor.developmentStatus?.remoteVersion || "-"}</Descriptions.Item>
                  <Descriptions.Item label="同步状态">
                    <Space size={8} wrap>
                      <UpstreamSyncTag state={editor.developmentStatus?.syncState} defaultLabel="未检查" defaultColor="default" divergedLabel="双方都有修改" />
                      {editor.developmentStatus?.lastSyncedAt ? <Text type="secondary">{formatDateTime(editor.developmentStatus.lastSyncedAt)}</Text> : null}
                    </Space>
                  </Descriptions.Item>
                </>
              ) : null}
              <Descriptions.Item label="创建时间">{formatDateTime(editor.currentScript.createdAt)}</Descriptions.Item>
            </Descriptions>
          </Card>
        )}

        <Card bodyStyle={{ paddingTop: 8 }}>
          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            items={[
              {
                key: "definition",
                label: "脚本定义",
                children: (
                  <ScriptDefinitionTab
                    form={editor.form}
                    mode={mode}
                    selectedScriptType={editor.selectedScriptType}
                    sourceText={editor.sourceText}
                    onSourceTextChange={editor.setSourceText}
                    inputSchemaState={editor.inputSchemaState}
                    onInputSchemaStateChange={editor.setInputSchemaState}
                    outputSchemaState={editor.outputSchemaState}
                    onOutputSchemaStateChange={editor.setOutputSchemaState}
                    isReadOnlyScript={editor.isReadOnlyScript}
                    editorTheme={editorTheme}
                    onScriptTypeChange={editor.handleScriptTypeChange}
                    availableScripts={editor.availableScripts}
                    filteredScriptReferences={references.filteredScriptReferences}
                    scriptReferenceQuery={references.scriptReferenceQuery}
                    onScriptReferenceQueryChange={references.setScriptReferenceQuery}
                    scriptReferencePage={references.scriptReferencePage}
                    onScriptReferencePageChange={references.setScriptReferencePage}
                    scriptReferencePageSize={references.scriptReferencePageSize}
                    onScriptReferencePageSizeChange={references.setScriptReferencePageSize}
                    onScriptReferenceClick={references.setReferenceScriptId}
                    scriptsLoading={editor.scriptsLoading}
                    filteredPluginReferences={references.filteredPluginReferences}
                    pluginReferenceQuery={references.pluginReferenceQuery}
                    onPluginReferenceQueryChange={references.setPluginReferenceQuery}
                    pluginReferencePage={references.pluginReferencePage}
                    onPluginReferencePageChange={references.setPluginReferencePage}
                    pluginReferencePageSize={references.pluginReferencePageSize}
                    onPluginReferencePageSizeChange={references.setPluginReferencePageSize}
                    onPluginReferenceClick={references.setReferencePluginId}
                    pluginsLoading={editor.pluginsLoading}
                    selectedScriptTypeForReferences={editor.selectedScriptType}
                  />
                )
              },
              ...(editor.currentScript
                ? [
                    {
                      key: "commands" as const,
                      label: "调用命令",
                      children: (
                        <ScriptCommandsTab
                          currentScriptId={editor.currentScript.id}
                          origin={origin}
                          apiKey={apiKey}
                          executionMode={execution.executionMode}
                          commandInput={commandInput}
                          detailCommandPresets={detailCommandPresets}
                          executeCommandPresets={executeCommandPresets}
                          schemaCommandPresets={schemaCommandPresets}
                          hasInputSchema={execution.hasInputSchema}
                          hasOutputSchema={execution.hasOutputSchema}
                          skillExample={skillExample}
                          toolContractResponseExample={toolContractResponseExample}
                          onCopy={handleCopyCommand}
                          onOpenSkillInstall={openSkillInstall}
                        />
                      )
                    },
                    {
                      key: "execution" as const,
                      label: "执行调试",
                      children: (
                        <ScriptExecutionTab
                          currentScript={editor.currentScript}
                          executionForm={executionForm}
                          executionMode={execution.executionMode}
                          onExecutionModeChange={execution.setExecutionMode}
                          executionInputMode={execution.executionInputMode}
                          executionJsonInput={execution.executionJsonInput}
                          onExecutionJsonInputChange={execution.setExecutionJsonInput}
                          onExecutionInputModeChange={execution.handleExecutionInputModeChange}
                          executionValidationError={execution.executionValidationError}
                          supportedFields={execution.supportedFields}
                          unsupportedFields={execution.unsupportedFields}
                          supportedOutputFields={execution.supportedOutputFields}
                          executing={execution.executing}
                          currentExecution={execution.currentExecution}
                          executionHistory={execution.executionHistory}
                          historyLoading={execution.historyLoading}
                          deletingExecutionId={execution.deletingExecutionId}
                          clearingExecutionHistory={execution.clearingExecutionHistory}
                          pollingExecutionId={execution.pollingExecutionId}
                          hasActiveExecutionHistory={execution.hasActiveExecutionHistory}
                          editorTheme={editorTheme}
                          onExecute={execution.handleExecute}
                          onResetExecutionInput={execution.handleResetExecutionInput}
                          onDeleteExecution={execution.handleDeleteExecution}
                          onClearExecutionHistory={execution.handleClearExecutionHistory}
                          onRefreshHistory={() => void execution.loadExecutionHistory(editor.currentScript!.id)}
                          onExecutionHistoryRowClick={(record) => execution.setCurrentExecution(record)}
                          onRefillCurrentExecutionInput={execution.handleRefillExecutionInput}
                          executionDetailOpen={execution.executionDetailOpen}
                          onOpenExecutionDetail={execution.openExecutionDetail}
                          onCloseExecutionDetail={execution.closeExecutionDetail}
                          activeExecutionId={execution.currentExecution?.id ?? null}
                          messageApi={messageApi}
                          submitBatchExecution={(input, mode) =>
                            executeScript({
                              scriptId: editor.currentScript!.id,
                              input,
                              mode,
                              responseView: "RESULT"
                            })
                          }
                          fetchBatchExecution={getExecution}
                          onBatchSessionFinished={() => execution.loadExecutionHistory(editor.currentScript!.id)}
                          presetBar={executionPresetBar}
                        />
                      )
                    }
                  ]
                : [])
            ]}
          />
        </Card>
      </Space>
    </>
  );
}
