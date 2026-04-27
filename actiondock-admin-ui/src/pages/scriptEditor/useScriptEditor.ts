import { Modal } from "antd";
import type { FormInstance } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ApiError,
  createScript,
  discardDraft,
  deleteScript,
  getScript,
  getDevelopmentStatus,
  listPlugins,
  listScripts,
  pullDevelopmentScript,
  publishScript,
  updateScript,
  validateScript
} from "../../api";
import { buildDuplicatedScriptDefinition } from "../../scriptDuplication";
import { createEmptySchemaEditorState, deserializeSchema, deserializeSchemaJsonText, serializeSchemaEditorState } from "../../schema";
import { extractPluginDependenciesFromSource } from "../../pluginDependencies";
import { extractAiDependenciesFromSource } from "../../aiDependencies";
import { parseGeneratedScriptText } from "../../generatedScript";
import { buildScriptEditorHeaderActionModel } from "../scriptEditorHeaderActions";
import type { DevelopmentStatus, PluginView, ScriptDefinition, ScriptType } from "../../types";
import type { SchemaEditorState } from "../../schema";
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
  const [availablePlugins, setAvailablePlugins] = useState<PluginView[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [developmentStatus, setDevelopmentStatus] = useState<DevelopmentStatus | null>(null);
  const [developmentPulling, setDevelopmentPulling] = useState(false);

  const selectedScriptType = (form.getFieldValue("type") as ScriptType | undefined) ?? "GROOVY";
  const copyFromScriptId = mode === "create" ? searchParams.get("copyFrom")?.trim() || null : null;
  const canImportGeneratedScript = selectedScriptType === "GROOVY";
  const isReadOnlyScript = Boolean(mode === "edit" && currentScript && currentScript.editable === false);
  const hasUnpublishedChanges = Boolean(
    currentScript?.status === "PUBLISHED" && currentScript.hasUnpublishedChanges
  );
  const canPublishToRepository = Boolean(currentScript && currentScript.scope !== "REPOSITORY");

  const detectedPluginDependencies = useMemo(
    () => selectedScriptType === "GROOVY" ? extractPluginDependenciesFromSource(sourceText, availablePlugins) : [],
    [availablePlugins, selectedScriptType, sourceText]
  );
  const detectedAiDependencies = useMemo(
    () => selectedScriptType === "GROOVY" ? extractAiDependenciesFromSource(sourceText) : [],
    [selectedScriptType, sourceText]
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
      description: script.description ?? ""
    });
    setSourceText(script.source);
    setInputSchemaState(deserializeSchema(script.inputSchema));
    setOutputSchemaState(deserializeSchema(script.outputSchema));
  };

  const loadDevelopmentStatus = async (script: ScriptDefinition | null = currentScript) => {
    if (!script || script.scope !== "DEVELOPMENT") {
      setDevelopmentStatus(null);
      return;
    }
    try {
      setDevelopmentStatus(await getDevelopmentStatus(script.id));
    } catch {
      setDevelopmentStatus(null);
    }
  };

  const applyCreateDraftToEditor = (draft: ScriptDefinition) => {
    setCurrentScript(null);
    form.setFieldsValue({
      id: draft.id,
      name: draft.name,
      type: draft.type,
      description: draft.description ?? ""
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
      source: getDefaultSource("GROOVY"),
      inputSchema: {},
      outputSchema: {},
      status: "DRAFT",
      version: 1
    });
  };

  const loadScriptReferences = async () => {
    setScriptsLoading(true);
    try {
      setAvailableScripts(await listScripts());
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
        const result = await listScripts();
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
    if (selectedScriptType !== "GROOVY") {
      setAvailablePlugins([]);
      return;
    }
    let cancelled = false;
    setPluginsLoading(true);
    void listPlugins()
      .then((plugins) => { if (!cancelled) setAvailablePlugins(plugins); })
      .catch((error) => {
        if (!cancelled) {
          const detail = error instanceof ApiError ? error.message : "加载插件信息失败";
          messageApi.error(detail);
        }
      })
      .finally(() => { if (!cancelled) setPluginsLoading(false); });
    return () => { cancelled = true; };
  }, [messageApi, selectedScriptType]);

  useEffect(() => {
    if (mode === "create") {
      if (!copyFromScriptId) {
        initializedCopySourceRef.current = null;
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

      void Promise.all([getScript(copyFromScriptId), listScripts()])
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
    void getScript(id)
      .then((script) => {
        applyScriptToEditor(script);
        void loadDevelopmentStatus(script);
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
      source: sourceText,
      inputSchema,
      outputSchema,
      status: currentScript?.status ?? "DRAFT",
      version: currentScript?.version ?? 1,
      description: values.description?.trim() || undefined,
      pluginDependencies: selectedScriptType === "GROOVY" ? detectedPluginDependencies : [],
      aiDependencies: selectedScriptType === "GROOVY" ? detectedAiDependencies : [],
      publishedSnapshot: currentScript?.publishedSnapshot,
      createdAt: currentScript?.createdAt,
      updatedAt: currentScript?.updatedAt
    };
  };

  const ensureCreateScriptIdAvailable = async (scriptId: string) => {
    if (mode !== "create") return;
    const scripts = await listScripts();
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
    const saved = mode === "create" ? await createScript(payload) : await updateScript(payload.id, payload);
    applyScriptToEditor(saved);
    return saved;
  };

  const ensureCurrentScriptPublished = async (successMessage?: string): Promise<ScriptDefinition> => {
    let stage: "save" | "validate" | "publish" = "save";
    let savedScript: ScriptDefinition | null = null;

    try {
      savedScript = await persistCurrentScript();
      stage = "validate";
      await validateScript(savedScript.id);
      stage = "publish";
      const published = await publishScript(savedScript.id);
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
      await loadDevelopmentStatus(saved);
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
      await validateScript(currentScript.id);
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
      await deleteScript(currentScript.id);
      messageApi.success("删除成功");
      navigate("/tools", { replace: true });
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
    if (!currentScript?.id || currentScript.scope !== "DEVELOPMENT") {
      return;
    }
    setDevelopmentPulling(true);
    try {
      const pulled = await pullDevelopmentScript(currentScript.id);
      applyScriptToEditor(pulled);
      await loadScriptReferences();
      await loadDevelopmentStatus(pulled);
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
        && (error.data as { code?: string }).code === "DEVELOPMENT_CONFLICT";
      if (conflict) {
        void modal.confirm({
          title: "远端已更新，本地也有修改",
          content: "确认后将放弃本地未发布修改，并使用远端版本覆盖当前开发脚本。",
          okText: "放弃本地并拉取",
          cancelText: "取消",
          okButtonProps: { danger: true },
          onOk: async () => {
            const pulled = await pullDevelopmentScript(currentScript.id, true);
            applyScriptToEditor(pulled);
            await loadDevelopmentStatus(pulled);
            messageApi.success("已使用远端版本覆盖本地开发脚本");
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
      const discarded = await discardDraft(currentScript.id);
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
      title: "确认删除这个工具？",
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
      const nextFields: Partial<ScriptEditorFormValues> = { type: "GROOVY" };
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
            label: "复制工具",
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
