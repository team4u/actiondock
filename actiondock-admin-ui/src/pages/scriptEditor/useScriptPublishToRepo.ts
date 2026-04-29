import { Form, Modal } from "antd";
import type { FormInstance } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useEffect, useRef, useState } from "react";
import {
  listRepositories,
  listRepositoryTools,
  listSchedules,
  listToolsByRepository,
  previewRepositoryPublishConfig,
  publishRepositoryTool,
  syncRepository
} from "../../api";
import type {
  RepositoryDefinition,
  RepositoryPublishConfigPreview,
  RepositoryToolDescriptor,
  ScriptDefinition,
  ScriptSchedule
} from "../../types";
import { getErrorMessage } from "../../utils";
import { autoMatchScriptDependency, extractScriptDependenciesFromSource, hasDynamicScriptDependencies, normalizeScriptDependencies } from "../../scriptDependencies";
import { getEnabledRepositories, getPublishableRepositories } from "../../repositoryPublish";
import type { PublishScriptDependencyDraft, PublishToRepositoryFormValues } from "./types";
import {
  resolveRepositoryPublishVersion,
  suggestNextRepositoryVersion,
  toTagOptions
} from "./types";
import type { RepositoryPublishVersionSuggestion } from "./types";
import { useDefaultOwner } from "../../hooks/useDefaultOwner";

export interface UseScriptPublishToRepoParams {
  currentScript: ScriptDefinition | null;
  availableScripts: ScriptDefinition[];
  sourceText: string;
  isReadOnlyScript: boolean;
  ensureCurrentScriptPublished: (successMessage?: string) => Promise<ScriptDefinition>;
  messageApi: MessageInstance;
}

export interface ScriptPublishToRepoContext {
  publishForm: FormInstance<PublishToRepositoryFormValues>;
  publishToRepositoryOpen: boolean;
  setPublishToRepositoryOpen: (open: boolean) => void;
  publishingToRepository: boolean;
  publishRepositories: RepositoryDefinition[];
  publishDependencyRepositories: RepositoryDefinition[];
  publishSchedules: ScriptSchedule[];
  publishMetadataLoading: boolean;
  publishConfigPreview: RepositoryPublishConfigPreview | null;
  publishConfigPreviewLoading: boolean;
  publishVersionSuggestion: RepositoryPublishVersionSuggestion;
  publishRepositoryTools: RepositoryToolDescriptor[];
  publishScriptDependencies: PublishScriptDependencyDraft[];
  publishHasDynamicScriptDependencies: boolean;
  publishConfigModes: Record<string, "INLINE" | "PLACEHOLDER">;
  setPublishConfigModes: React.Dispatch<React.SetStateAction<Record<string, "INLINE" | "PLACEHOLDER">>>;
  updatePublishScriptDependency: (scriptId: string, changedValues: Partial<PublishScriptDependencyDraft>) => void;
  handlePublishFormValuesChange: (changedValues: Partial<PublishToRepositoryFormValues>) => void;
  openPublishToRepositoryModal: (initialValues?: Partial<PublishToRepositoryFormValues>) => Promise<void>;
  handlePublishToRepository: () => Promise<void>;
}

export function useScriptPublishToRepo({
  currentScript,
  availableScripts,
  sourceText,
  isReadOnlyScript,
  ensureCurrentScriptPublished,
  messageApi
}: UseScriptPublishToRepoParams): ScriptPublishToRepoContext {
  const [publishForm] = Form.useForm<PublishToRepositoryFormValues>();
  const [publishToRepositoryOpen, setPublishToRepositoryOpen] = useState(false);
  const [publishingToRepository, setPublishingToRepository] = useState(false);
  const [publishRepositories, setPublishRepositories] = useState<RepositoryDefinition[]>([]);
  const [publishDependencyRepositories, setPublishDependencyRepositories] = useState<RepositoryDefinition[]>([]);
  const [publishSchedules, setPublishSchedules] = useState<ScriptSchedule[]>([]);
  const [publishMetadataLoading, setPublishMetadataLoading] = useState(false);
  const [publishConfigPreview, setPublishConfigPreview] = useState<RepositoryPublishConfigPreview | null>(null);
  const [publishConfigPreviewLoading, setPublishConfigPreviewLoading] = useState(false);
  const [publishVersionSuggestion, setPublishVersionSuggestion] = useState<RepositoryPublishVersionSuggestion>({ status: "IDLE" });
  const [publishRepositoryTools, setPublishRepositoryTools] = useState<RepositoryToolDescriptor[]>([]);
  const [publishScriptDependencies, setPublishScriptDependencies] = useState<PublishScriptDependencyDraft[]>([]);
  const [publishHasDynamicScriptDependencies, setPublishHasDynamicScriptDependencies] = useState(false);
  const [publishConfigModes, setPublishConfigModes] = useState<Record<string, "INLINE" | "PLACEHOLDER">>({});
  const syncedRepositoryIdsRef = useRef<Set<string>>(new Set());
  const versionSuggestionRequestRef = useRef(0);
  const configPreviewRequestRef = useRef(0);
  const versionManuallyEditedRef = useRef(false);
  const defaultOwner = useDefaultOwner();
  const selectedRepositoryId = Form.useWatch("repositoryId", publishForm);
  const selectedToolId = Form.useWatch("toolId", publishForm);
  const selectedScheduleIds = Form.useWatch("scheduleIds", publishForm);

  const resolveDependencyVersionRange = (
    repositoryId: string | undefined,
    toolId: string | undefined,
    currentValue?: string,
    repositoryTools: RepositoryToolDescriptor[] = publishRepositoryTools
  ): string | undefined => {
    if (currentValue?.trim()) {
      return currentValue.trim();
    }
    const descriptor = repositoryTools.find(
      (item) => item.repositoryId === repositoryId && item.toolId === toolId
    );
    return descriptor?.version ? `>= ${descriptor.version}` : undefined;
  };

  const buildScriptDependencyDrafts = (
    script: ScriptDefinition,
    repositories: RepositoryDefinition[],
    repositoryTools: RepositoryToolDescriptor[],
    preferredRepositoryId?: string,
    previousDrafts: PublishScriptDependencyDraft[] = []
  ): PublishScriptDependencyDraft[] => {
    const declaredDependencies = new Map(
      (script.scriptDependencies ?? script.publishedSnapshot?.scriptDependencies ?? []).map((item) => [item.scriptId, item])
    );
    const publishedScripts = new Map(
      availableScripts
        .filter((item) => item.id !== script.id)
        .filter((item) => Boolean(item.publishedSnapshot))
        .map((item) => [item.id, item])
    );
    const previousDraftsByScriptId = new Map(previousDrafts.map((item) => [item.scriptId, item]));

    const toDraft = (
      scriptId: string,
      repositoryId: string | undefined,
      toolId: string | undefined,
      versionRange: string | undefined,
      state: PublishScriptDependencyDraft["state"]
    ): PublishScriptDependencyDraft => ({
      scriptId,
      repositoryId,
      toolId,
      versionRange: resolveDependencyVersionRange(repositoryId, toolId, versionRange, repositoryTools),
      state
    });

    return extractScriptDependenciesFromSource(sourceText).map(({ scriptId }) => {
      const previous = previousDraftsByScriptId.get(scriptId);
      if (previous?.state === "MANUAL") {
        return toDraft(scriptId, previous.repositoryId, previous.toolId, previous.versionRange, "MANUAL");
      }

      const declared = declaredDependencies.get(scriptId);
      if (declared?.repositoryId?.trim() && declared.toolId?.trim()) {
        return toDraft(scriptId, declared.repositoryId, declared.toolId, declared.versionRange, "MANUAL");
      }

      const localScript = publishedScripts.get(scriptId);
      if (localScript?.repositoryId?.trim() && localScript.repositoryToolId?.trim()) {
        return toDraft(
          scriptId,
          localScript.repositoryId,
          localScript.repositoryToolId,
          localScript.repositoryVersion ? `>= ${localScript.repositoryVersion}` : undefined,
          "MANUAL"
        );
      }

      const matched = autoMatchScriptDependency(scriptId, repositories, repositoryTools, preferredRepositoryId);
      if (matched) {
        return toDraft(scriptId, matched.repositoryId, matched.toolId, matched.versionRange, "AUTO");
      }

      return toDraft(scriptId, undefined, undefined, undefined, "UNRESOLVED");
    });
  };

  const loadPublishMetadata = async (
    script: ScriptDefinition,
    initialValues?: Partial<PublishToRepositoryFormValues>
  ): Promise<RepositoryDefinition[]> => {
    setPublishMetadataLoading(true);
    try {
      const [repositories, schedules, repositoryTools] = await Promise.all([
        listRepositories(),
        listSchedules(),
        listRepositoryTools()
      ]);
      const enabledRepositories = getEnabledRepositories(repositories);
      const publishableRepositories = getPublishableRepositories(repositories);
      const relatedSchedules = schedules
        .filter((item) => item.scriptId === script.id)
        .sort((left, right) => left.name.localeCompare(right.name));
      const initialRepositoryId = initialValues?.repositoryId
        ?? (script.scope === "DEVELOPMENT" && script.repositoryId
          ? script.repositoryId
          : publishableRepositories[0]?.id);

      setPublishRepositories(publishableRepositories);
      setPublishDependencyRepositories(enabledRepositories);
      setPublishRepositoryTools(repositoryTools);
      setPublishSchedules(relatedSchedules);
      setPublishHasDynamicScriptDependencies(hasDynamicScriptDependencies(sourceText));
      setPublishScriptDependencies(buildScriptDependencyDrafts(
        script,
        enabledRepositories,
        repositoryTools,
        initialRepositoryId
      ));
      setPublishConfigPreview(null);
      setPublishConfigModes({});
      setPublishVersionSuggestion({ status: "IDLE" });
      syncedRepositoryIdsRef.current = new Set();
      configPreviewRequestRef.current += 1;
      versionManuallyEditedRef.current = false;
      publishForm.setFieldsValue({
        repositoryId: initialRepositoryId,
        toolId: script.repositoryToolId || script.id,
        displayName: script.name,
        version: suggestNextRepositoryVersion(script.repositoryVersion),
        owner: script.owner ?? defaultOwner,
        releaseNotes: "",
        tags: toTagOptions(script.tags),
        scheduleIds: []
      });
      if (initialValues) {
        publishForm.setFieldsValue(initialValues);
      }
      return publishableRepositories;
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载发布信息失败"));
      throw error;
    } finally {
      setPublishMetadataLoading(false);
    }
  };

  useEffect(() => {
    if (!publishToRepositoryOpen || !selectedRepositoryId || !selectedToolId?.trim()) {
      versionSuggestionRequestRef.current += 1;
      setPublishVersionSuggestion({ status: "IDLE" });
      return;
    }
    const requestId = versionSuggestionRequestRef.current + 1;
    versionSuggestionRequestRef.current = requestId;
    setPublishVersionSuggestion({ status: "LOADING" });

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (!syncedRepositoryIdsRef.current.has(selectedRepositoryId)) {
            await syncRepository(selectedRepositoryId);
            syncedRepositoryIdsRef.current.add(selectedRepositoryId);
          }
          const tools = await listToolsByRepository(selectedRepositoryId);
          if (versionSuggestionRequestRef.current !== requestId) {
            return;
          }
          const resolution = resolveRepositoryPublishVersion(tools, selectedToolId);
          if (resolution.status === "READY") {
            const autoFilled = !versionManuallyEditedRef.current;
            if (autoFilled) {
              publishForm.setFieldsValue({ version: resolution.suggestedVersion });
            }
            setPublishVersionSuggestion({
              status: "READY",
              currentVersion: resolution.currentVersion,
              suggestedVersion: resolution.suggestedVersion,
              autoFilled
            });
            return;
          }
          if (resolution.status === "MANUAL") {
            setPublishVersionSuggestion({
              status: "MANUAL",
              currentVersion: resolution.currentVersion
            });
            return;
          }
          setPublishVersionSuggestion({ status: "NOT_FOUND" });
        } catch (error) {
          if (versionSuggestionRequestRef.current !== requestId) {
            return;
          }
          setPublishVersionSuggestion({
            status: "ERROR",
            message: getErrorMessage(error, "拉取仓库版本失败")
          });
        }
      })();
    }, 400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [publishForm, publishToRepositoryOpen, selectedRepositoryId, selectedToolId]);

  useEffect(() => {
    if (!publishToRepositoryOpen || !currentScript?.id) {
      configPreviewRequestRef.current += 1;
      setPublishConfigPreview(null);
      setPublishConfigPreviewLoading(false);
      return;
    }
    const requestId = configPreviewRequestRef.current + 1;
    configPreviewRequestRef.current = requestId;
    setPublishConfigPreviewLoading(true);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const preview = await previewRepositoryPublishConfig({
            scriptId: currentScript.id,
            source: sourceText,
            scheduleIds: selectedScheduleIds ?? []
          });
          if (configPreviewRequestRef.current !== requestId) {
            return;
          }
          setPublishConfigPreview(preview);
          setPublishConfigModes((previous) => {
            const next: Record<string, "INLINE" | "PLACEHOLDER"> = {};
            for (const item of preview.items) {
              next[item.key] = item.secret ? "PLACEHOLDER" : (previous[item.key] ?? "PLACEHOLDER");
            }
            return next;
          });
        } catch (error) {
          if (configPreviewRequestRef.current !== requestId) {
            return;
          }
          setPublishConfigPreview(null);
          messageApi.error(getErrorMessage(error, "加载配置依赖失败"));
        } finally {
          if (configPreviewRequestRef.current === requestId) {
            setPublishConfigPreviewLoading(false);
          }
        }
      })();
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [currentScript?.id, messageApi, publishToRepositoryOpen, selectedScheduleIds, sourceText]);

  useEffect(() => {
    if (!publishToRepositoryOpen || !currentScript) {
      setPublishHasDynamicScriptDependencies(false);
      setPublishScriptDependencies([]);
      return;
    }
    setPublishHasDynamicScriptDependencies(hasDynamicScriptDependencies(sourceText));
    setPublishScriptDependencies((previous) => buildScriptDependencyDrafts(
      currentScript,
      publishDependencyRepositories,
      publishRepositoryTools,
      selectedRepositoryId,
      previous
    ));
  }, [
    availableScripts,
    currentScript,
    publishDependencyRepositories,
    publishRepositoryTools,
    publishToRepositoryOpen,
    selectedRepositoryId,
    sourceText
  ]);

  const handlePublishFormValuesChange = (changedValues: Partial<PublishToRepositoryFormValues>) => {
    if (Object.prototype.hasOwnProperty.call(changedValues, "version")) {
      versionManuallyEditedRef.current = true;
    }
  };

  const updatePublishScriptDependency = (scriptId: string, changedValues: Partial<PublishScriptDependencyDraft>) => {
    setPublishScriptDependencies((previous) => previous.map((item) => {
      if (item.scriptId !== scriptId) {
        return item;
      }
      const next = { ...item, ...changedValues };
      return {
        ...next,
        versionRange: resolveDependencyVersionRange(next.repositoryId, next.toolId, next.versionRange),
        state: "MANUAL"
      };
    }));
  };

  const openPublishToRepositoryModal = async (initialValues?: Partial<PublishToRepositoryFormValues>) => {
    if (isReadOnlyScript) {
      messageApi.warning("仓库脚本为只读版本，请先 Fork 再发布");
      return;
    }
    if (!currentScript?.id) {
      messageApi.warning("请先保存脚本");
      return;
    }

    try {
      const repositories = await loadPublishMetadata(currentScript, initialValues);
      if (repositories.length === 0) {
        messageApi.warning("当前没有可发布的仓库，请先添加一个 Git 或本地目录仓库");
        return;
      }
      setPublishToRepositoryOpen(true);
    } catch {
      return;
    }
  };

  const handlePublishToRepository = async () => {
    let retry: { repositoryId: string; payload: Parameters<typeof publishRepositoryTool>[1] } | null = null;
    try {
      const values = await publishForm.validateFields();
      if (publishConfigPreviewLoading) {
        messageApi.warning("正在分析配置依赖，请稍后再试");
        return;
      }
      if (publishConfigPreview?.missingKeys.length) {
        messageApi.error(`缺少发布依赖的配置值: ${publishConfigPreview.missingKeys.join(", ")}`);
        return;
      }
      if (publishHasDynamicScriptDependencies) {
        messageApi.error("仓库发布仅支持字面量 scripts.invoke(...) 依赖，请先移除动态脚本调用");
        return;
      }
      const incompleteScriptDependency = publishScriptDependencies.find(
        (item) => !item.repositoryId?.trim() || !item.toolId?.trim()
      );
      if (incompleteScriptDependency) {
        messageApi.error(`脚本依赖 ${incompleteScriptDependency.scriptId} 缺少仓库映射`);
        return;
      }
      const scriptDependencies = normalizeScriptDependencies(publishScriptDependencies.map((item) => ({
        scriptId: item.scriptId,
        repositoryId: item.repositoryId ?? "",
        toolId: item.toolId ?? "",
        versionRange: resolveDependencyVersionRange(item.repositoryId, item.toolId, item.versionRange)
      })));
      setPublishingToRepository(true);
      const publishedScript = await ensureCurrentScriptPublished();
      const configItems = (publishConfigPreview?.items ?? []).map((item) => ({
        key: item.key,
        publishMode: publishConfigModes[item.key] ?? "PLACEHOLDER"
      }));
      const payload = {
        scriptId: publishedScript.id,
        toolId: values.toolId.trim(),
        displayName: values.displayName.trim(),
        version: values.version.trim(),
        owner: values.owner?.trim() || undefined,
        releaseNotes: values.releaseNotes?.trim() || undefined,
        tags: toTagOptions(values.tags),
        scheduleIds: values.scheduleIds ?? [],
        configItems,
        scriptDependencies
      };
      retry = { repositoryId: values.repositoryId, payload };
      await publishRepositoryTool(values.repositoryId, payload);
      setPublishToRepositoryOpen(false);
      messageApi.success("已发布到目标仓库");
    } catch (error) {
      if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      }
      if (typeof error === "object" && error !== null && "handled" in error) {
        return;
      }
      const conflict = error instanceof Error
        && "data" in error
        && typeof (error as { data?: unknown }).data === "object"
        && (error as { data?: { code?: string } }).data?.code === "DEVELOPMENT_CONFLICT";
      if (conflict) {
        if (!retry) {
          messageApi.error("远端脚本已更新。请先拉取远端，或确认后再强制发布。");
          return;
        }
        void Modal.confirm({
          title: "远端脚本已更新",
          content: "强制发布会用当前脚本内容作为新版本写回仓库。版本号仍必须是仓库中不存在的新版本。",
          okText: "强制发布",
          cancelText: "取消",
          okButtonProps: { danger: true },
          onOk: async () => {
            await publishRepositoryTool(retry!.repositoryId, { ...retry!.payload, force: true });
            setPublishToRepositoryOpen(false);
            messageApi.success("已强制发布到目标仓库");
          }
        });
        return;
      }
      messageApi.error(getErrorMessage(error, "发布到仓库失败"));
    } finally {
      setPublishingToRepository(false);
    }
  };

  return {
    publishForm,
    publishToRepositoryOpen,
    setPublishToRepositoryOpen,
    publishingToRepository,
    publishRepositories,
    publishDependencyRepositories,
    publishSchedules,
    publishMetadataLoading,
    publishConfigPreview,
    publishConfigPreviewLoading,
    publishVersionSuggestion,
    publishRepositoryTools,
    publishScriptDependencies,
    publishHasDynamicScriptDependencies,
    publishConfigModes,
    setPublishConfigModes,
    updatePublishScriptDependency,
    handlePublishFormValuesChange,
    openPublishToRepositoryModal,
    handlePublishToRepository
  };
}
