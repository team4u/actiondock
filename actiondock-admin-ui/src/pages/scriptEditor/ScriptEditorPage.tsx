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
  Row,
  Col,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message
} from "antd";
import type { MenuProps } from "antd";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ScopeTag } from "../../components/ScopeTag";
import { buildStandardCommandPresets } from "../../commands";
import {
  buildExecuteCliCommand,
  buildExecuteCmdCliCommand,
  buildExecutePowerShellCliCommand,
  buildExecuteCurlCommand,
  buildExecutePowerShellCommand,
  buildScriptDetailCliCommand,
  buildScriptDetailCmdCliCommand,
  buildScriptDetailPowerShellCliCommand,
  buildScriptDetailCurlCommand,
  buildScriptDetailPowerShellCommand,
  buildToolDetailCliCommand,
  buildToolDetailCmdCliCommand,
  buildToolDetailPowerShellCliCommand,
  buildToolDetailCurlCommand,
  buildToolDetailPowerShellCommand,
  resolveExecutionCommandInput
} from "../../commands";
import { formatDateTime } from "../../utils";
import { useCopyMessage } from "../../hooks/useCopyMessage";
import { DevelopmentSyncTag } from "../../components/domain/DevelopmentSyncTag";
import { useScriptEditor } from "./useScriptEditor";
import { useScriptExecution } from "./useScriptExecution";
import { useScriptPublishToRepo } from "./useScriptPublishToRepo";
import { useScriptFork } from "./useScriptFork";
import { useScriptReferences } from "./useScriptReferences";
import { GeneratedScriptImportModal } from "./GeneratedScriptImportModal";
import { PublishToRepositoryModal } from "./PublishToRepositoryModal";
import { ForkScriptModal } from "../../components/ForkScriptModal";
import { ScriptReferenceModal } from "./ScriptReferenceModal";
import { PluginReferenceModal } from "./PluginReferenceModal";
import { ScriptDefinitionTab } from "./ScriptDefinitionTab";
import { ScriptCommandsTab } from "./ScriptCommandsTab";
import { ScriptExecutionTab } from "./ScriptExecutionTab";
import type { ScriptEditorFormValues } from "./types";
import type { ScriptEditorPageProps } from "./types";

const { Text } = Typography;

export function ScriptEditorPage({ colorMode, mode }: ScriptEditorPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [messageApi, contextHolder] = message.useMessage();

  const [scriptForm] = Form.useForm<ScriptEditorFormValues>();
  const [executionForm] = Form.useForm<Record<string, unknown>>();
  const [generatedScriptModalOpen, setGeneratedScriptModalOpen] = useState(false);
  const [generatedScriptText, setGeneratedScriptText] = useState("");

  // --- Core editor hook (also manages plugins) ---
  const editor = useScriptEditor({ mode, form: scriptForm, messageApi });

  // --- References hook (uses editor's availablePlugins and availableScripts) ---
  const references = useScriptReferences({
    currentScript: editor.currentScript,
    availableScripts: editor.availableScripts,
    availablePlugins: editor.availablePlugins
  });

  // --- Execution hook ---
  const execution = useScriptExecution({
    currentScript: editor.currentScript,
    executionForm,
    messageApi
  });

  // --- Publish to repository hook ---
  const publishToRepo = useScriptPublishToRepo({
    currentScript: editor.currentScript,
    isReadOnlyScript: editor.isReadOnlyScript,
    ensureCurrentScriptPublished: editor.ensureCurrentScriptPublished,
    messageApi
  });

  // --- Fork hook ---
  const fork = useScriptFork({
    currentScript: editor.currentScript,
    messageApi
  });

  // --- Execution command input ---
  const watchedExecutionValues = Form.useWatch([], executionForm) as Record<string, unknown> | undefined;
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

  const detailCommandPresets = useMemo(() => {
    if (!editor.currentScript) return [];
    return buildStandardCommandPresets({
      keyPrefix: "detail",
      httpBash: buildScriptDetailCurlCommand({ origin, scriptId: editor.currentScript.id }),
      httpPowerShell: buildScriptDetailPowerShellCommand({ origin, scriptId: editor.currentScript.id }),
      cliBash: buildScriptDetailCliCommand({ origin, scriptId: editor.currentScript.id }),
      cliPowerShell: buildScriptDetailPowerShellCliCommand({ origin, scriptId: editor.currentScript.id }),
      cliCmd: buildScriptDetailCmdCliCommand({ origin, scriptId: editor.currentScript.id })
    });
  }, [editor.currentScript, origin]);

  const executeCommandPresets = useMemo(() => {
    if (!editor.currentScript) return [];
    return buildStandardCommandPresets({
      keyPrefix: "execute",
      httpBash: buildExecuteCurlCommand({ input: commandInput.value, mode: execution.executionMode, origin, scriptId: editor.currentScript.id }),
      httpPowerShell: buildExecutePowerShellCommand({ input: commandInput.value, mode: execution.executionMode, origin, scriptId: editor.currentScript.id }),
      cliBash: buildExecuteCliCommand({ input: commandInput.value, mode: execution.executionMode, origin, scriptId: editor.currentScript.id }),
      cliPowerShell: buildExecutePowerShellCliCommand({ input: commandInput.value, mode: execution.executionMode, origin, scriptId: editor.currentScript.id }),
      cliPowerShellEnvironment: "PowerShell stdin",
      cliCmd: buildExecuteCmdCliCommand({ input: commandInput.value, mode: execution.executionMode, origin, scriptId: editor.currentScript.id })
    });
  }, [editor.currentScript, origin, commandInput, execution.executionMode]);

  const schemaCommandPresets = useMemo(() => {
    if (!editor.currentScript) return [];
    return buildStandardCommandPresets({
      keyPrefix: "schema",
      httpBash: buildToolDetailCurlCommand({ origin, scriptId: editor.currentScript.id }),
      httpPowerShell: buildToolDetailPowerShellCommand({ origin, scriptId: editor.currentScript.id }),
      cliBash: buildToolDetailCliCommand({ origin, scriptId: editor.currentScript.id }),
      cliPowerShell: buildToolDetailPowerShellCliCommand({ origin, scriptId: editor.currentScript.id }),
      cliCmd: buildToolDetailCmdCliCommand({ origin, scriptId: editor.currentScript.id })
    });
  }, [editor.currentScript, origin]);

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

  // --- Menu items ---
  const publishMenuItems: MenuProps["items"] = editor.headerActionModel.publishMenuKeys.map((key) => ({
    key,
    icon: <ExportOutlined />,
    label: "发布到仓库",
    onClick: () => void publishToRepo.openPublishToRepositoryModal()
  }));

  const dangerousMoreActionKeys = new Set(["discard-draft", "delete"]);
  const moreMenuItems: MenuProps["items"] = [
    ...(editor.currentScript?.scope === "DEVELOPMENT"
      ? [{
          key: "pull-development",
          icon: <SyncOutlined />,
          label: "拉取远端",
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
            label: "复制工具",
            onClick: () => navigate(`/scripts/new?copyFrom=${encodeURIComponent(editor.currentScript?.id ?? "")}`)
          };
        }
        return {
          key,
          icon: <ImportOutlined />,
          label: "粘贴结果",
          onClick: () => setGeneratedScriptModalOpen(true)
        };
      }),
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
        schedules={publishToRepo.publishSchedules}
        configValues={publishToRepo.publishConfigValues}
        configModes={publishToRepo.publishConfigModes}
        onConfigModesChange={publishToRepo.setPublishConfigModes}
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

      <Space className="script-editor-page" direction="vertical" size={16} style={{ width: "100%" }}>
        <Row className="page-card-header" justify="end" align="middle" gutter={[12, 12]}>
          <Col className="page-card-header__back">
            <Button
              type="link"
              icon={<ArrowLeftOutlined />}
              style={{ paddingInline: 0 }}
              onClick={() => navigate("/tools")}
            >
              返回工具列表
            </Button>
          </Col>
          <Col className="page-card-actions">
            <Space className="page-card-actions script-editor-page__header-actions" wrap>
              {editor.headerActionModel.showForkOnly && editor.currentScript?.scope === "REPOSITORY" ? (
                <Button icon={<ForkOutlined />} type="primary" onClick={fork.openForkModal} loading={fork.forkingRepositoryTool}>
                  创建 Fork
                </Button>
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
                        onClick={() => void editor.handlePublish()}
                        loading={editor.publishing || publishToRepo.publishingToRepository || publishToRepo.publishMetadataLoading}
                      >
                        发布
                      </Dropdown.Button>
                    ) : (
                      <Button
                        icon={<RocketOutlined />}
                        onClick={() => void editor.handlePublish()}
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

        {editor.currentScript && (
          <Card>
            <Typography.Title level={4} style={{ margin: "0 0 16px 0" }}>
              {editor.currentScript.name}
            </Typography.Title>
            <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label="状态 / 更新时间">
                <Space size={8} wrap>
                  <Tag color={editor.currentScript.status === "PUBLISHED" ? "green" : "gold"}>
                    {editor.currentScript.status === "PUBLISHED" ? "已发布" : "草稿"}
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
                    <Tooltip title="当前是仓库安装的只读工具。你可以直接运行和查看契约，但不能原地修改。需要调整实现时，请先创建 Fork，或重新发布到某个仓库。">
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
              {editor.currentScript.scope === "DEVELOPMENT" ? (
                <Descriptions.Item label="本地发布号">{editor.currentScript.version}</Descriptions.Item>
              ) : (
                <Descriptions.Item label="版本">{editor.currentScript.version}</Descriptions.Item>
              )}
              <Descriptions.Item label="来源仓库">{editor.currentScript.repositoryId || "-"}</Descriptions.Item>
              <Descriptions.Item label="来源工具">{editor.currentScript.repositoryToolId || "-"}</Descriptions.Item>
              <Descriptions.Item label={editor.currentScript.scope === "DEVELOPMENT" ? "上次同步仓库版本" : "仓库版本"}>
                {editor.currentScript.repositoryVersion || "-"}
              </Descriptions.Item>
              {editor.currentScript.scope === "DEVELOPMENT" ? (
                <>
                  <Descriptions.Item label="当前仓库版本">{editor.developmentStatus?.remoteVersion || "-"}</Descriptions.Item>
                  <Descriptions.Item label="开发路径">{editor.currentScript.sourcePath || "-"}</Descriptions.Item>
                  <Descriptions.Item label="同步状态">
                    <Space size={8} wrap>
                      <DevelopmentSyncTag state={editor.developmentStatus?.syncState} defaultLabel="未检查" defaultColor="default" divergedLabel="双方都有修改" />
                      {editor.currentScript.sourceSyncedAt ? <Text type="secondary">{formatDateTime(editor.currentScript.sourceSyncedAt)}</Text> : null}
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
                    availablePlugins={editor.availablePlugins}
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
                          executionMode={execution.executionMode}
                          commandInput={commandInput}
                          detailCommandPresets={detailCommandPresets}
                          executeCommandPresets={executeCommandPresets}
                          schemaCommandPresets={schemaCommandPresets}
                          hasInputSchema={execution.hasInputSchema}
                          hasOutputSchema={execution.hasOutputSchema}
                          toolContractResponseExample={toolContractResponseExample}
                          onCopy={handleCopyCommand}
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
                          activeExecutionId={execution.currentExecution?.id ?? null}
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
