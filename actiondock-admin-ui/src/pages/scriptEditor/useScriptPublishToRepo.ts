import { Form, Modal } from "antd";
import type { FormInstance } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useEffect, useRef, useState } from "react";
import {
  listConfigValues,
  listRepositories,
  listSchedules,
  listToolsByRepository,
  publishRepositoryTool,
  syncRepository
} from "../../api";
import type {
  ConfigValue,
  RepositoryDefinition,
  ScriptDefinition,
  ScriptSchedule
} from "../../types";
import { getErrorMessage } from "../../utils";
import type { PublishToRepositoryFormValues } from "./types";
import {
  resolveRepositoryPublishVersion,
  suggestNextRepositoryVersion,
  toTagOptions
} from "./types";
import type { RepositoryPublishVersionSuggestion } from "./types";

export interface UseScriptPublishToRepoParams {
  currentScript: ScriptDefinition | null;
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
  publishSchedules: ScriptSchedule[];
  publishConfigValues: ConfigValue[];
  publishMetadataLoading: boolean;
  publishVersionSuggestion: RepositoryPublishVersionSuggestion;
  publishConfigModes: Record<string, "INLINE" | "PLACEHOLDER">;
  setPublishConfigModes: React.Dispatch<React.SetStateAction<Record<string, "INLINE" | "PLACEHOLDER">>>;
  handlePublishFormValuesChange: (changedValues: Partial<PublishToRepositoryFormValues>) => void;
  openPublishToRepositoryModal: () => Promise<void>;
  handlePublishToRepository: () => Promise<void>;
}

export function useScriptPublishToRepo({
  currentScript,
  isReadOnlyScript,
  ensureCurrentScriptPublished,
  messageApi
}: UseScriptPublishToRepoParams): ScriptPublishToRepoContext {
  const [publishForm] = Form.useForm<PublishToRepositoryFormValues>();
  const [publishToRepositoryOpen, setPublishToRepositoryOpen] = useState(false);
  const [publishingToRepository, setPublishingToRepository] = useState(false);
  const [publishRepositories, setPublishRepositories] = useState<RepositoryDefinition[]>([]);
  const [publishSchedules, setPublishSchedules] = useState<ScriptSchedule[]>([]);
  const [publishConfigValues, setPublishConfigValues] = useState<ConfigValue[]>([]);
  const [publishMetadataLoading, setPublishMetadataLoading] = useState(false);
  const [publishVersionSuggestion, setPublishVersionSuggestion] = useState<RepositoryPublishVersionSuggestion>({ status: "IDLE" });
  const [publishConfigModes, setPublishConfigModes] = useState<Record<string, "INLINE" | "PLACEHOLDER">>({});
  const syncedRepositoryIdsRef = useRef<Set<string>>(new Set());
  const versionSuggestionRequestRef = useRef(0);
  const versionManuallyEditedRef = useRef(false);
  const selectedRepositoryId = Form.useWatch("repositoryId", publishForm);
  const selectedToolId = Form.useWatch("toolId", publishForm);

  const loadPublishMetadata = async (script: ScriptDefinition): Promise<RepositoryDefinition[]> => {
    setPublishMetadataLoading(true);
    try {
      const [repositories, schedules, configValues] = await Promise.all([
        listRepositories(),
        listSchedules(),
        listConfigValues()
      ]);
      const publishableRepositories = repositories
        .filter((item) => item.enabled && item.type !== "HTTP")
        .sort((left, right) => left.id.localeCompare(right.id));
      const relatedSchedules = schedules
        .filter((item) => item.scriptId === script.id)
        .sort((left, right) => left.name.localeCompare(right.name));
      const sortedConfigValues = [...configValues].sort((left, right) => left.key.localeCompare(right.key));

      setPublishRepositories(publishableRepositories);
      setPublishSchedules(relatedSchedules);
      setPublishConfigValues(sortedConfigValues);
      setPublishConfigModes({});
      setPublishVersionSuggestion({ status: "IDLE" });
      syncedRepositoryIdsRef.current = new Set();
      versionManuallyEditedRef.current = false;
      publishForm.setFieldsValue({
        repositoryId: script.scope === "DEVELOPMENT" && script.repositoryId
          ? script.repositoryId
          : publishableRepositories[0]?.id,
        toolId: script.repositoryToolId || script.id,
        displayName: script.name,
        version: suggestNextRepositoryVersion(script.repositoryVersion),
        owner: script.owner ?? "",
        releaseNotes: "",
        tags: toTagOptions(script.tags),
        scheduleIds: []
      });
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

  const handlePublishFormValuesChange = (changedValues: Partial<PublishToRepositoryFormValues>) => {
    if (Object.prototype.hasOwnProperty.call(changedValues, "version")) {
      versionManuallyEditedRef.current = true;
    }
  };

  const openPublishToRepositoryModal = async () => {
    if (isReadOnlyScript) {
      messageApi.warning("仓库工具为只读版本，请先 Fork 再发布");
      return;
    }
    if (!currentScript?.id) {
      messageApi.warning("请先保存工具");
      return;
    }

    try {
      const repositories = await loadPublishMetadata(currentScript);
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
      setPublishingToRepository(true);
      const publishedScript = await ensureCurrentScriptPublished();
      const configItems = Object.entries(publishConfigModes).map(([key, publishMode]) => ({
        key,
        publishMode
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
        configItems
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
          messageApi.error("远端工具已更新，但本地也有未发布修改。请先拉取远端或确认后再强制发布。");
          return;
        }
        void Modal.confirm({
          title: "远端已更新，本地也有修改",
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
    publishSchedules,
    publishConfigValues,
    publishMetadataLoading,
    publishVersionSuggestion,
    publishConfigModes,
    setPublishConfigModes,
    handlePublishFormValuesChange,
    openPublishToRepositoryModal,
    handlePublishToRepository
  };
}
