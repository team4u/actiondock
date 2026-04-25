import { Form } from "antd";
import type { FormInstance } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useState } from "react";
import {
  listConfigValues,
  listPlugins,
  listRepositories,
  listSchedules,
  publishRepositoryTool
} from "../../api";
import type {
  ConfigValue,
  PluginDependency,
  RepositoryDefinition,
  ScriptDefinition,
  ScriptSchedule
} from "../../types";
import { getErrorMessage } from "../../utils";
import type { PublishToRepositoryFormValues } from "./types";
import { suggestNextRepositoryVersion, toTagOptions } from "./types";

export interface UseScriptPublishToRepoParams {
  currentScript: ScriptDefinition | null;
  isReadOnlyScript: boolean;
  ensureCurrentScriptPublished: (successMessage?: string) => Promise<ScriptDefinition>;
  detectedPluginDependencies: PluginDependency[];
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
  publishConfigModes: Record<string, "INLINE" | "PLACEHOLDER">;
  setPublishConfigModes: React.Dispatch<React.SetStateAction<Record<string, "INLINE" | "PLACEHOLDER">>>;
  openPublishToRepositoryModal: () => Promise<void>;
  handlePublishToRepository: () => Promise<void>;
}

export function useScriptPublishToRepo({
  currentScript,
  isReadOnlyScript,
  ensureCurrentScriptPublished,
  detectedPluginDependencies,
  messageApi
}: UseScriptPublishToRepoParams): ScriptPublishToRepoContext {
  const [publishForm] = Form.useForm<PublishToRepositoryFormValues>();
  const [publishToRepositoryOpen, setPublishToRepositoryOpen] = useState(false);
  const [publishingToRepository, setPublishingToRepository] = useState(false);
  const [publishRepositories, setPublishRepositories] = useState<RepositoryDefinition[]>([]);
  const [publishSchedules, setPublishSchedules] = useState<ScriptSchedule[]>([]);
  const [publishConfigValues, setPublishConfigValues] = useState<ConfigValue[]>([]);
  const [publishMetadataLoading, setPublishMetadataLoading] = useState(false);
  const [publishConfigModes, setPublishConfigModes] = useState<Record<string, "INLINE" | "PLACEHOLDER">>({});

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
      publishForm.setFieldsValue({
        repositoryId: publishableRepositories[0]?.id,
        toolId: script.repositoryToolId || script.id,
        displayName: script.name,
        version: suggestNextRepositoryVersion(script.repositoryVersion),
        owner: script.owner ?? "",
        description: script.description ?? "",
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
    try {
      const values = await publishForm.validateFields();
      setPublishingToRepository(true);
      const publishedScript = await ensureCurrentScriptPublished();
      const configItems = Object.entries(publishConfigModes).map(([key, publishMode]) => ({
        key,
        publishMode
      }));
      await publishRepositoryTool(values.repositoryId, {
        scriptId: publishedScript.id,
        toolId: values.toolId.trim(),
        displayName: values.displayName.trim(),
        version: values.version.trim(),
        owner: values.owner?.trim() || undefined,
        description: values.description?.trim() || undefined,
        tags: toTagOptions(values.tags),
        scheduleIds: values.scheduleIds ?? [],
        configItems
      });
      setPublishToRepositoryOpen(false);
      messageApi.success("已发布到目标仓库");
    } catch (error) {
      if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      }
      if (typeof error === "object" && error !== null && "handled" in error) {
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
    publishConfigModes,
    setPublishConfigModes,
    openPublishToRepositoryModal,
    handlePublishToRepository
  };
}
