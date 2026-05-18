import { Form, Modal } from "antd";
import type { FormInstance } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getRepositoryScript,
  listRepositories,
  listRepositoryScripts,
  listToolsByRepository,
  previewRepositoryPublishConfig,
  publishRepositoryTool,
  syncRepository
} from "../../../resources/api";
import {
  listSchedules
} from "../../../triggers/api";
import type {
  RepositoryDefinition,
  RepositoryPublishConfigPreview,
  RepositoryScriptDescriptor,
  ScriptDefinition,
  ScriptSchedule
} from "../../../../shared/types";
import { getErrorMessage } from "../../../../services/utils";
import { extractScriptDependenciesFromSource, hasDynamicScriptDependencies, normalizeScriptDependencies, resolveAutoScriptDependency } from "../../../../services/scriptDependencies";
import { getEnabledRepositories, getPublishableRepositories } from "../../../../services/repositoryPublish";
import {
  buildRepositoryPublishDiffTarget,
  buildScriptDiff,
  toRepositoryScriptDiffTarget
} from "../../../../services/scriptDiff";
import type { PublishScriptDependencyDraft, PublishToRepositoryFormValues } from "./types";
import {
  suggestNextRepositoryVersion,
  toTagOptions
} from "./types";
import type { RepositoryPublishVersionSuggestion } from "./types";
import type { ScriptDiffResult, ScriptDiffTarget } from "../../../../services/scriptDiff";
import { useDefaultOwner } from "../../../../shared/hooks/useDefaultOwner";
import { getPublishedScriptContent, isScriptPublished } from "../../../../services/scriptPublication";

function normalizeTagValues(tags: string[] | undefined): string[] {
  return (tags ?? []).filter((item) => item.trim().length > 0);
}

function buildRepositoryToolDigestPayload(params: {
  repositoryScriptId: string;
  displayName: string;
  version: string;
  source?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  type?: string;
  packaging?: string;
  description?: string;
  owner?: string;
  tags?: string[];
  scriptDependencies?: Array<Record<string, unknown>>;
  pluginDependencies?: Array<Record<string, unknown>>;
}) {
  return {
    repositoryScriptId: params.repositoryScriptId,
    displayName: params.displayName,
    version: params.version,
    type: params.type ?? null,
    packaging: params.packaging ?? null,
    description: params.description ?? null,
    owner: params.owner ?? null,
    tags: params.tags ?? [],
    scriptDependencies: params.scriptDependencies ?? [],
    pluginDependencies: params.pluginDependencies ?? [],
    source: params.source ?? "",
    inputSchema: params.inputSchema ?? {},
    outputSchema: params.outputSchema ?? {}
  };
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export interface UseScriptPublishToRepoParams {
  currentScript: ScriptDefinition | null;
  availableScripts: ScriptDefinition[];
  sourceText: string;
  isReadOnlyScript: boolean;
  publishTarget: ScriptDiffTarget;
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
  publishRepositoryDiff: ScriptDiffResult | null;
  publishRepositoryDiffLoading: boolean;
  publishRepositoryContentUnchanged: boolean;
  publishVersionSuggestion: RepositoryPublishVersionSuggestion;
  publishRepositoryTools: RepositoryScriptDescriptor[];
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
  publishTarget,
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
  const [publishRepositoryDiff, setPublishRepositoryDiff] = useState<ScriptDiffResult | null>(null);
  const [publishRepositoryDiffLoading, setPublishRepositoryDiffLoading] = useState(false);
  const [publishRepositoryContentUnchanged, setPublishRepositoryContentUnchanged] = useState(false);
  const [publishVersionSuggestion, setPublishVersionSuggestion] = useState<RepositoryPublishVersionSuggestion>({ status: "IDLE" });
  const [publishRepositoryTools, setPublishRepositoryTools] = useState<RepositoryScriptDescriptor[]>([]);
  const [publishScriptDependencies, setPublishScriptDependencies] = useState<PublishScriptDependencyDraft[]>([]);
  const [publishHasDynamicScriptDependencies, setPublishHasDynamicScriptDependencies] = useState(false);
  const [publishConfigModes, setPublishConfigModes] = useState<Record<string, "INLINE" | "PLACEHOLDER">>({});
  const syncedRepositoryIdsRef = useRef<Set<string>>(new Set());
  const versionSuggestionRequestRef = useRef(0);
  const configPreviewRequestRef = useRef(0);
  const versionManuallyEditedRef = useRef(false);
  const defaultOwner = useDefaultOwner();
  const selectedRepositoryId = Form.useWatch("repositoryId", publishForm);
  const selectedToolId = Form.useWatch("repositoryScriptId", publishForm);
  const selectedVersion = Form.useWatch("version", publishForm);
  const selectedDisplayName = Form.useWatch("displayName", publishForm);
  const selectedOwner = Form.useWatch("owner", publishForm);
  const selectedTags = Form.useWatch("tags", publishForm);
  const selectedScheduleIds = Form.useWatch("scheduleIds", publishForm);
  const publishRepositoryTarget = useMemo(() => {
    const selectedName = selectedDisplayName?.trim();
    const selectedOwnerValue = selectedOwner === undefined ? publishTarget.owner : selectedOwner.trim() || undefined;
    return buildRepositoryPublishDiffTarget({
      ...publishTarget,
      name: selectedName || publishTarget.name || "",
      owner: selectedOwnerValue,
      tags: normalizeTagValues(selectedTags as string[] | undefined)
    });
  }, [publishTarget, selectedDisplayName, selectedOwner, selectedTags]);

  const resolveDependencyVersionRange = (
    repositoryId: string | undefined,
    repositoryScriptId: string | undefined,
    currentValue?: string,
    repositoryTools: RepositoryScriptDescriptor[] = publishRepositoryTools
  ): string | undefined => {
    if (currentValue?.trim()) {
      return currentValue.trim();
    }
    const descriptor = repositoryTools.find(
      (item) => item.repositoryId === repositoryId && item.scriptId === repositoryScriptId
    );
    return descriptor?.version ? `>= ${descriptor.version}` : undefined;
  };

  const buildScriptDependencyDrafts = (
    script: ScriptDefinition,
    repositories: RepositoryDefinition[],
    repositoryTools: RepositoryScriptDescriptor[],
    preferredRepositoryId?: string,
    previousDrafts: PublishScriptDependencyDraft[] = []
  ): PublishScriptDependencyDraft[] => {
    const declaredDependencies = new Map(
      (script.scriptDependencies ?? getPublishedScriptContent(script)?.scriptDependencies ?? []).map((item) => [item.scriptId, item])
    );
    const publishedScripts = new Map(
      availableScripts
        .filter((item) => item.id !== script.id)
        .filter((item) => isScriptPublished(item))
        .map((item) => [item.id, item])
    );
    const previousDraftsByScriptId = new Map(previousDrafts.map((item) => [item.scriptId, item]));

    const toDraft = (
      scriptId: string,
      repositoryId: string | undefined,
      repositoryScriptId: string | undefined,
      versionRange: string | undefined,
      state: PublishScriptDependencyDraft["state"]
    ): PublishScriptDependencyDraft => ({
      scriptId,
      repositoryId,
      repositoryScriptId,
      versionRange: resolveDependencyVersionRange(repositoryId, repositoryScriptId, versionRange, repositoryTools),
      state
    });

    return extractScriptDependenciesFromSource(sourceText).map(({ scriptId }) => {
      const previous = previousDraftsByScriptId.get(scriptId);
      if (previous?.state === "MANUAL") {
        return toDraft(scriptId, previous.repositoryId, previous.repositoryScriptId, previous.versionRange, "MANUAL");
      }

      const declared = declaredDependencies.get(scriptId);
      const localScript = publishedScripts.get(scriptId);
      const matched = resolveAutoScriptDependency({
        scriptId,
        repositories,
        repositoryTools,
        preferredRepositoryId,
        declaredDependency: declared,
        localScriptSource: localScript
          ? {
              repositoryId: localScript.repositoryId,
              repositoryScriptId: localScript.repositoryScriptId,
              repositoryVersion: localScript.repositoryVersion
            }
          : undefined
      });
      if (matched) {
        return toDraft(scriptId, matched.repositoryId, matched.repositoryScriptId, matched.versionRange, "AUTO");
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
        listRepositoryScripts()
      ]);
      const enabledRepositories = getEnabledRepositories(repositories);
      const publishableRepositories = getPublishableRepositories(repositories);
      const relatedSchedules = schedules
        .filter((item) => item.scriptId === script.id)
        .sort((left, right) => left.name.localeCompare(right.name));
      const initialRepositoryId = initialValues?.repositoryId
        ?? (script.repositoryId
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
      setPublishRepositoryDiff(null);
      setPublishRepositoryDiffLoading(false);
      setPublishRepositoryContentUnchanged(false);
      setPublishVersionSuggestion({ status: "IDLE" });
      syncedRepositoryIdsRef.current = new Set();
      configPreviewRequestRef.current += 1;
      versionManuallyEditedRef.current = false;
      publishForm.setFieldsValue({
        repositoryId: initialRepositoryId,
        repositoryScriptId: script.repositoryScriptId || script.id,
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
      setPublishRepositoryDiff(null);
      setPublishRepositoryDiffLoading(false);
      setPublishRepositoryContentUnchanged(false);
      return;
    }
    const requestId = versionSuggestionRequestRef.current + 1;
    versionSuggestionRequestRef.current = requestId;
    setPublishVersionSuggestion({ status: "LOADING" });
    setPublishRepositoryDiffLoading(true);

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
          const descriptor = tools.find(
            (item) => item.repositoryId === selectedRepositoryId && item.scriptId === selectedToolId
          );
          if (!descriptor) {
            setPublishVersionSuggestion({ status: "NOT_FOUND" });
            setPublishRepositoryDiff(buildScriptDiff(
              undefined,
              buildRepositoryPublishDiffTarget(publishTarget),
              { context: "publish" }
            ));
            setPublishRepositoryContentUnchanged(false);
            return;
          }

          const detail = await getRepositoryScript(selectedRepositoryId, selectedToolId);
          if (versionSuggestionRequestRef.current !== requestId) {
            return;
          }
          const nextVersion = suggestNextRepositoryVersion(descriptor.version);
          if (nextVersion === descriptor.version) {
            setPublishVersionSuggestion({
              status: "MANUAL",
              currentVersion: descriptor.version
            });
          } else {
            const autoFilled = !versionManuallyEditedRef.current;
            if (autoFilled) {
              publishForm.setFieldsValue({ version: nextVersion });
            }
            setPublishVersionSuggestion({
              status: "READY",
              currentVersion: descriptor.version,
              suggestedVersion: nextVersion,
              autoFilled
            });
          }
          const diffTarget = publishRepositoryTarget;
          setPublishRepositoryDiff(buildScriptDiff(
            toRepositoryScriptDiffTarget(detail),
            diffTarget,
            { context: "publish" }
          ));
          const digestPayload = buildRepositoryToolDigestPayload({
            repositoryScriptId: selectedToolId,
            displayName: diffTarget.name || "",
            version: selectedVersion === undefined ? "" : selectedVersion.trim(),
            source: diffTarget.source,
            inputSchema: diffTarget.inputSchema,
            outputSchema: diffTarget.outputSchema,
            type: diffTarget.type,
            packaging: diffTarget.packaging,
            description: diffTarget.description,
            owner: diffTarget.owner,
            tags: diffTarget.tags,
            scriptDependencies: (diffTarget.scriptDependencies ?? []).map((item) => ({ ...item })),
            pluginDependencies: (diffTarget.pluginDependencies ?? []).map((item) => ({ ...item }))
          });
          setPublishRepositoryContentUnchanged(
            Boolean(detail.descriptor.digest) && detail.descriptor.digest === await sha256Hex(JSON.stringify(digestPayload))
          );
        } catch (error) {
          if (versionSuggestionRequestRef.current !== requestId) {
            return;
          }
          setPublishVersionSuggestion({
            status: "ERROR",
            message: getErrorMessage(error, "拉取仓库版本失败")
          });
          setPublishRepositoryDiff(null);
          setPublishRepositoryContentUnchanged(false);
        } finally {
          if (versionSuggestionRequestRef.current === requestId) {
            setPublishRepositoryDiffLoading(false);
          }
        }
      })();
    }, 400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    publishForm,
    publishTarget,
    publishToRepositoryOpen,
    selectedDisplayName,
    selectedOwner,
    selectedRepositoryId,
    selectedTags,
    selectedToolId,
    selectedVersion
  ]);

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
        versionRange: resolveDependencyVersionRange(next.repositoryId, next.repositoryScriptId, next.versionRange),
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
      if (publishRepositoryDiff && !publishRepositoryDiff.hasChanges) {
        messageApi.warning("当前没有变更明细，不允许发布");
        return;
      }
      if (publishRepositoryContentUnchanged) {
        messageApi.warning("仓库当前内容与本次发布一致，无需重复发布");
        return;
      }
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
        (item) => !item.repositoryId?.trim() || !item.repositoryScriptId?.trim()
      );
      if (incompleteScriptDependency) {
        messageApi.error(`脚本依赖 ${incompleteScriptDependency.scriptId} 缺少仓库映射`);
        return;
      }
      const scriptDependencies = normalizeScriptDependencies(publishScriptDependencies.map((item) => ({
        scriptId: item.scriptId,
        repositoryId: item.repositoryId ?? "",
        repositoryScriptId: item.repositoryScriptId ?? "",
        versionRange: resolveDependencyVersionRange(item.repositoryId, item.repositoryScriptId, item.versionRange)
      })));
      setPublishingToRepository(true);
      const publishedScript = await ensureCurrentScriptPublished();
      const configItems = (publishConfigPreview?.items ?? []).map((item) => ({
        key: item.key,
        publishMode: publishConfigModes[item.key] ?? "PLACEHOLDER"
      }));
      const payload = {
        scriptId: publishedScript.id,
        repositoryScriptId: values.repositoryScriptId.trim(),
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
        && (error as { data?: { code?: string } }).data?.code === "UPSTREAM_CONFLICT";
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
    publishRepositoryDiff,
    publishRepositoryDiffLoading,
    publishRepositoryContentUnchanged,
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
