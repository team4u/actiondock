import { Modal } from "antd";
import type { FormInstance } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCapability,
  deleteCapability,
  discardCapabilityDraft,
  getCapability,
  listCapabilities,
  publishCapability,
  updateCapability,
  validateCapability
} from "../../api";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getUpstreamStatus,
  pullUpstreamScript,
} from "../../../resources/api";
import { listPluginReferences, listPlugins } from "../../../plugins/api";
import { ApiError } from "../../../../shared/api/httpClient";
import { readAndClearScriptCreatePreset } from "../../../../services/scriptCreatePreset";
import { buildDuplicatedScriptDefinition } from "../../../../services/scriptDuplication";
import { createEmptySchemaEditorState, deserializeSchema, deserializeSchemaJsonText, serializeSchemaEditorState } from "../../../../services/schema";
import { extractPluginDependenciesFromSource } from "../../../../services/pluginDependencies";
import { extractAiDependenciesFromSource } from "../../../../services/aiDependencies";
import { parseGeneratedScriptText } from "../../../../services/generatedScript";
import { buildScriptEditorHeaderActionModel } from "./scriptEditorHeaderActions";
import type { UpstreamStatus, PluginReferenceView, PluginSummaryView, ScriptDefinition, ScriptType } from "../../../../shared/types";
import type { SchemaEditorState } from "../../../../services/schema";
import { hasScriptDraftChanges } from "../../../../services/scriptPublication";
import {
  type ScriptEditorFormValues,
  getDefaultSource,
  type ScriptEditorContext
} from "./types";

export interface UseScriptEditorParams {
  mode: "create" | "edit";
  form: FormInstance<ScriptEditorFormValues>;
  messageApi: MessageInstance;
}

export function useScriptEditor({
  mode,
  form,
  messageApi
}: UseScriptEditorParams): ScriptEditorContext {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [modal, modalContextHolder] = Modal.useModal();
  const initializedCopySourceRef = useRef<string | null>(null);
  const initializedPresetRef = useRef(false);

  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deletingScript, setDeletingScript] = useState(false);
  const [discardingDraft, setDiscardingDraft] = useState(false);
  const [sourceText, setSourceText] = useState(getDefaultSource("GROOVY"));
  const [inputSchemaState, setInputSchemaState] = useState<SchemaEditorState>(
    createEmptySchemaEditorState()
  );
  const [outputSchemaState, setOutputSchemaState] = useState<SchemaEditorState>(
    createEmptySchemaEditorState()
  );
  const [currentScript, setCurrentScript] = useState<ScriptDefinition | null>(null);
  const [copiedFromScript, setCopiedFromScript] = useState<{ id: string; name: string } | null>(null);
  const [availableScripts, setAvailableScripts] = useState<ScriptDefinition[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [availablePlugins, setAvailablePlugins] = useState<PluginSummaryView[]>([]);
  const [availablePluginReferences, setAvailablePluginReferences] = useState<PluginReferenceView[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [developmentStatus, setUpstreamStatus] = useState<UpstreamStatus | null>(null);
  const [developmentPulling, setDevelopmentPulling] = useState(false);

  const selectedScriptType = (form.getFieldValue("type") as ScriptType | undefined) ?? "GROOVY";
  const copyFromScriptId = mode === "create" ? searchParams.get("copyFrom")?.trim() || null : null;
  const canImportGeneratedScript = true;
  const isReadOnlyScript = Boolean(mode === "edit" && currentScript && currentScript.editable === false);
  const hasUnpublishedChanges = hasScriptDraftChanges(currentScript);
  const canPublishToRepository = Boolean(currentScript && currentScript.scope !== "REPOSITORY");

  const detectedPluginDependencies = useMemo(
    () => extractPluginDependenciesFromSource(sourceText, availablePlugins),
    [availablePlugins, sourceText]
  );
  const detectedAiDependencies = useMemo(
    () => extractAiDependenciesFromSource(sourceText),
    [sourceText]
  );

  const headerActionModel = useMemo(
    () =>
      buildScriptEditorHeaderActionModel({
        mode,
        canImportGeneratedScript,
        isReadOnlyScript,
        hasUnpublishedChanges,
        canPublishToRepository,
        hasCurrentScript: Boolean(currentScript)
      }),
    [mode, canImportGeneratedScript, isReadOnlyScript, hasUnpublishedChanges, canPublishToRepository, currentScript]
  );

  const applyScriptToEditor = (script: ScriptDefinition) => {
    setCurrentScript(script);
    form.setFieldsValue({
      id: script.id,
      name: script.name,
      type: script.type,
      packaging: script.packaging,
      description: script.description ?? "",
      pythonRequirements: script.pythonRequirements ?? "",
      maxExecutionRecords: script.maxExecutionRecords ?? 1000
    });
    setSourceText(script.source);
    setInputSchemaState(deserializeSchema(script.inputSchema));
    setOutputSchemaState(deserializeSchema(script.outputSchema));
  };

  const loadUpstreamStatus = async (script: ScriptDefinition | null = currentScript) => {
    if (!script?.id) {
      setUpstreamStatus(null);
      return;
    }
    try {
      setUpstreamStatus(await getUpstreamStatus(script.id));
    } catch {
      setUpstreamStatus(null);
    }
  };

  const applyCreateDraftToEditor = (draft: ScriptDefinition) => {
    setCurrentScript(null);
    form.setFieldsValue({
      id: draft.id,
      name: draft.name,
      type: draft.type,
      packaging: draft.packaging,
      description: draft.description ?? "",
      pythonRequirements: draft.pythonRequirements ?? "",
      maxExecutionRecords: draft.maxExecutionRecords ?? 1000
    });
    form.setFields([{ name: "id", errors: [] }]);
    setSourceText(draft.source);
    setInputSchemaState(deserializeSchema(draft.inputSchema));
    setOutputSchemaState(deserializeSchema(draft.outputSchema));
  };

  const resetCreateEditor = () => {
    setCopiedFromScript(null);
    applyCreateDraftToEditor({
      id: "",
      name: "",
      type: "GROOVY",
      packaging: "TOOL",
      source: getDefaultSource("GROOVY"),
      pythonRequirements: "",
      inputSchema: {},
      outputSchema: {},
      publication: {
        published: false,
        dirty: false
      },
      maxExecutionRecords: 1000,
      version: 1
    });
  };

  const loadScriptReferences = async () => {
    setScriptsLoading(true);
    try {
      setAvailableScripts(await listCapabilities());
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "加载脚本参考失败";
      messageApi.error(detail);
    } finally {
      setScriptsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setScriptsLoading(true);
      try {
        const result = await listCapabilities();
        if (cancelled) return;
        setAvailableScripts(result);
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof ApiError ? error.message : "加载脚本参考失败";
        messageApi.error(detail);
      } finally {
        if (!cancelled) setScriptsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [messageApi]);

  useEffect(() => {
    let cancelled = false;
    setPluginsLoading(true);
    void Promise.all([listPlugins(), listPluginReferences()])
      .then(([plugins, references]) => {
        if (cancelled) return;
        setAvailablePlugins(plugins);
        setAvailablePluginReferences(references);
      })
      .catch((error) => {
        if (!cancelled) {
          const detail = error instanceof ApiError ? error.message : "加载插件信息失败";
          messageApi.error(detail);
        }
      })
      .finally(() => { if (!cancelled) setPluginsLoading(false); });
    return () => { cancelled = true; };
  }, [messageApi]);

  useEffect(() => {
    if (mode === "create") {
      if (!copyFromScriptId) {
        initializedCopySourceRef.current = null;
        if (initializedPresetRef.current) return;
        const preset = readAndClearScriptCreatePreset();
        if (preset) {
          initializedPresetRef.current = true;
          applyCreateDraftToEditor({
            id: preset.idHint ?? "",
            name: preset.nameHint,
            type: preset.type ?? "GROOVY",
            packaging: preset.packaging ?? "TOOL",
            source: preset.source,
            pythonRequirements: preset.pythonRequirements ?? "",
            inputSchema: preset.inputSchema,
            outputSchema: preset.outputSchema,
            publication: {
              published: false,
              dirty: false
            },
            version: 1,
            description: preset.description
          });
          setLoading(false);
          return;
        }
        resetCreateEditor();
        setLoading(false);
        return;
      }
      if (initializedCopySourceRef.current === copyFromScriptId) {
        return;
      }

      let cancelled = false;
      initializedCopySourceRef.current = copyFromScriptId;
      setLoading(true);

      void Promise.all([getCapability(copyFromScriptId), listCapabilities()])
        .then(([script, scripts]) => {
          if (cancelled) return;
          setAvailableScripts(scripts);
          setCopiedFromScript({ id: script.id, name: script.name });
          applyCreateDraftToEditor(
            buildDuplicatedScriptDefinition(
              script,
              scripts.map((item) => item.id)
            )
          );
        })
        .catch((error) => {
          if (cancelled) return;
          initializedCopySourceRef.current = null;
          resetCreateEditor();
          const detail = error instanceof ApiError ? error.message : "复制脚本失败";
          messageApi.error(detail);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => { cancelled = true; };
    }

    setCopiedFromScript(null);
    initializedCopySourceRef.current = null;
  }, [copyFromScriptId, form, id, messageApi, mode]);

  useEffect(() => {
    if (mode === "create" || !id) return;
    setLoading(true);
    void getCapability(id)
      .then((script) => {
        applyScriptToEditor(script);
        void loadUpstreamStatus(script);
      })
      .catch((error) => {
        const detail = error instanceof ApiError ? error.message : "加载脚本失败";
        messageApi.error(detail);
      })
      .finally(() => setLoading(false));
  }, [id, mode]);

  const buildPayload = async (): Promise<ScriptDefinition> => {
    const values = await form.validateFields();
    const inputSchema = serializeSchemaEditorState(inputSchemaState, "输入结构");
    const outputSchema = serializeSchemaEditorState(outputSchemaState, "输出结构");

    return {
      id: values.id.trim(),
      name: values.name.trim(),
      type: values.type,
      packaging: values.packaging,
      source: sourceText,
      pythonRequirements: values.pythonRequirements?.trim() ? values.pythonRequirements : undefined,
      inputSchema,
      outputSchema,
      published: currentScript?.published,
      publication: currentScript?.publication ?? {
        published: false,
        dirty: false
      },
      version: currentScript?.version ?? 1,
      description: values.description?.trim() || undefined,
      scriptDependencies: currentScript?.scriptDependencies,
      pluginDependencies: selectedScriptType === "GROOVY" ? detectedPluginDependencies : [],
      aiDependencies: selectedScriptType === "GROOVY" ? detectedAiDependencies : [],
      createdAt: currentScript?.createdAt,
      updatedAt: currentScript?.updatedAt,
      maxExecutionRecords: values.maxExecutionRecords
    };
  };

  const ensureCreateScriptIdAvailable = async (scriptId: string) => {
    if (mode !== "create") return;
    const scripts = await listCapabilities();
    setAvailableScripts(scripts);
    if (scripts.some((script) => script.id === scriptId)) {
      const errorMessage = "脚本 ID 已存在，请更换后再保存";
      form.setFields([{ name: "id", errors: [errorMessage] }]);
      throw new Error(errorMessage);
    }
  };

  const persistCurrentScript = async (): Promise<ScriptDefinition> => {
    const payload = await buildPayload();
    await ensureCreateScriptIdAvailable(payload.id);
    const saved = mode === "create" ? await createCapability(payload) : await updateCapability(payload.id, payload);
    applyScriptToEditor(saved);
    return saved;
  };

  const ensureCurrentScriptPublished = async (successMessage?: string): Promise<ScriptDefinition> => {
    let stage: "save" | "validate" | "publish" = "save";
    let savedScript: ScriptDefinition | null = null;

    try {
      savedScript = await persistCurrentScript();
      stage = "validate";
      await validateCapability(savedScript.id);
      stage = "publish";
      const published = await publishCapability(savedScript.id);
      applyScriptToEditor(published);
      await loadScriptReferences();
      if (successMessage) messageApi.success(successMessage);
      if (mode === "create") navigate(`/scripts/${published.id}`, { replace: true });
      return published;
    } catch (error) {
      const detail =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : stage === "save" ? "保存失败" : stage === "validate" ? "校验失败" : "发布失败";

      if (stage === "validate") {
        messageApi.error(`校验失败，当前修改已保存但未发布：${detail}`);
      } else if (stage === "publish") {
        messageApi.error(`发布失败，当前修改已保存且已校验：${detail}`);
      } else {
        messageApi.error(detail);
      }

      if (mode === "create" && savedScript?.id) {
        navigate(`/scripts/${savedScript.id}`, { replace: true });
      }
      const handledError = error instanceof Error ? error : new Error(detail);
      Object.assign(handledError, { handled: true });
      throw handledError;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await persistCurrentScript();
      await loadUpstreamStatus(saved);
      await loadScriptReferences();
      messageApi.success("保存成功");
      if (mode === "create") {
        navigate(`/scripts/${saved.id}`, { replace: true });
      }
    } catch (error) {
      const detail = error instanceof ApiError || error instanceof Error ? error.message : "保存失败";
      messageApi.error(detail);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    if (!currentScript?.id) {
      messageApi.warning("请先保存脚本");
      return;
    }
    setValidating(true);
    try {
      await validateCapability(currentScript.id);
      messageApi.success("校验通过");
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "校验失败";
      messageApi.error(detail);
    } finally {
      setValidating(false);
    }
  };

  const handleDeleteScript = async () => {
    if (!currentScript?.id) {
      messageApi.warning("请先保存脚本");
      return;
    }
    setDeletingScript(true);
    try {
      await deleteCapability(currentScript.id);
      messageApi.success("删除成功");
      navigate("/scripts", { replace: true });
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "删除脚本失败";
      messageApi.error(detail);
    } finally {
      setDeletingScript(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await ensureCurrentScriptPublished("保存、校验并发布成功");
    } finally {
      setPublishing(false);
    }
  };

  const handlePullDevelopment = async () => {
    if (!currentScript?.id || !developmentStatus) {
      return;
    }
    setDevelopmentPulling(true);
    try {
      const pulled = await pullUpstreamScript(currentScript.id);
      applyScriptToEditor(pulled);
      await loadScriptReferences();
      await loadUpstreamStatus(pulled);
      if (developmentStatus?.syncState === "REMOTE_CHANGES") {
        messageApi.success("已拉取远端更新");
      } else if (developmentStatus?.syncState === "LOCAL_CHANGES") {
        messageApi.info("远端没有新更新，已保留你的本地修改");
      } else {
        messageApi.info("远端没有新更新");
      }
    } catch (error) {
      const conflict = error instanceof ApiError
        && typeof error.data === "object"
        && error.data !== null
        && (error.data as { code?: string }).code === "UPSTREAM_CONFLICT";
      if (conflict) {
        void modal.confirm({
          title: "远端已更新，本地也有修改",
          content: "确认后将放弃本地未发布修改，并使用上游版本覆盖当前工作副本。",
          okText: "放弃本地并拉取",
          cancelText: "取消",
          okButtonProps: { danger: true },
          onOk: async () => {
            const pulled = await pullUpstreamScript(currentScript.id, true);
            applyScriptToEditor(pulled);
            await loadUpstreamStatus(pulled);
            messageApi.success("已使用上游版本覆盖本地工作副本");
          }
        });
        return;
      }
      const detail = error instanceof ApiError ? error.message : "拉取远端失败";
      messageApi.error(detail);
    } finally {
      setDevelopmentPulling(false);
    }
  };

  const handleDiscardDraft = async () => {
    if (!currentScript?.id || !hasUnpublishedChanges) return;
    setDiscardingDraft(true);
    try {
      const discarded = await discardCapabilityDraft(currentScript.id);
      applyScriptToEditor(discarded);
      await loadScriptReferences();
      messageApi.success("草稿已丢弃");
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "丢弃草稿失败";
      messageApi.error(detail);
    } finally {
      setDiscardingDraft(false);
    }
  };

  const openDiscardDraftConfirm = () => {
    if (!currentScript?.id || !hasUnpublishedChanges) return;
    void modal.confirm({
      title: "确认丢弃当前草稿？",
      content: "会恢复到最近一次发布的版本，未发布修改将被移除。",
      okText: "丢弃",
      cancelText: "取消",
      onOk: () => handleDiscardDraft()
    });
  };

  const openDeleteScriptConfirm = () => {
    if (!currentScript?.id) {
      messageApi.warning("请先保存脚本");
      return;
    }
    void modal.confirm({
      title: "确认删除这个脚本？",
      content: "删除后不可恢复。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => handleDeleteScript()
    });
  };

  const handleImportGeneratedScript = (text: string) => {
    try {
      const parsed = parseGeneratedScriptText(text);
      const nextInputSchemaState = deserializeSchemaJsonText(parsed.inputSchemaText, "输入结构");
      const nextOutputSchemaState = deserializeSchemaJsonText(parsed.outputSchemaText, "输出结构");
      const nextFields: Partial<ScriptEditorFormValues> = { type: parsed.type };
      if (parsed.id?.trim()) nextFields.id = parsed.id.trim();
      if (parsed.name?.trim()) nextFields.name = parsed.name.trim();

      form.setFieldsValue(nextFields);
      setSourceText(parsed.source);
      setInputSchemaState(nextInputSchemaState);
      setOutputSchemaState(nextOutputSchemaState);
      void form.validateFields(["id", "name"]).catch(() => undefined);
      messageApi.success("已回填源码并提取输入输出结构");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "解析导入内容失败";
      messageApi.error(detail);
    }
  };

  const handleScriptTypeChange = (nextType: ScriptType) => {
    const currentType = selectedScriptType;
    if (
      mode === "create" &&
      (sourceText.trim() === "" ||
        sourceText === getDefaultSource(currentType) ||
        sourceText === getDefaultSource(nextType))
    ) {
      setSourceText(getDefaultSource(nextType));
    }
    if (nextType !== "PYTHON") {
      form.setFieldValue("pythonRequirements", "");
    }
  };

  const publishMenuItems = headerActionModel.publishMenuKeys.map((key) => ({
    key,
    label: "发布到仓库",
    onClick: () => {} // wired by parent
  }));

  const dangerousMoreActionKeys = new Set(["discard-draft", "delete"]);
  const moreMenuItems = [
    ...headerActionModel.moreActionKeys
      .filter((key) => !dangerousMoreActionKeys.has(key))
      .map((key) => {
        if (key === "validate") {
          return { key, label: "校验", onClick: () => void handleValidate() };
        }
        if (key === "copy") {
          return {
            key,
            label: "复制脚本",
            onClick: () => navigate(`/scripts/new?copyFrom=${encodeURIComponent(currentScript?.id ?? "")}`)
          };
        }
        return { key, label: "粘贴结果", onClick: () => {} };
      }),
    ...(headerActionModel.moreActionKeys.some((key) => dangerousMoreActionKeys.has(key))
      ? [{ type: "divider" as const }]
      : []),
    ...headerActionModel.moreActionKeys
      .filter((key) => dangerousMoreActionKeys.has(key))
      .map((key) => {
        if (key === "discard-draft") {
          return { key, label: "丢弃草稿", danger: true as const, onClick: openDiscardDraftConfirm };
        }
        return { key, label: "删除", danger: true as const, onClick: openDeleteScriptConfirm };
      })
  ];

  return {
    form,
    currentScript,
    sourceText,
    setSourceText,
    inputSchemaState,
    setInputSchemaState,
    outputSchemaState,
    setOutputSchemaState,
    selectedScriptType,
    isReadOnlyScript,
    hasUnpublishedChanges,
    canPublishToRepository,
    canImportGeneratedScript,
    copiedFromScript,
    availableScripts,
    scriptsLoading,
    availablePlugins,
    availablePluginReferences,
    pluginsLoading,
    headerActionModel,
    loading,
    saving,
    publishing,
    deletingScript,
    discardingDraft,
    validating,
    detectedPluginDependencies,
    detectedAiDependencies,
    developmentStatus,
    developmentPulling,
    handleSave,
    handlePublish,
    handleValidate,
    handlePullDevelopment,
    handleScriptTypeChange,
    handleImportGeneratedScript,
    ensureCurrentScriptPublished,
    loadScriptReferences,
    publishMenuItems,
    moreMenuItems,
    openDeleteScriptConfirm,
    openDiscardDraftConfirm,
    modalContextHolder
  };
}
