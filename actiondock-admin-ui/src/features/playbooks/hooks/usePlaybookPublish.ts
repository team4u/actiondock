import { useMutation } from "@tanstack/react-query";
import type { MessageInstance } from "antd/es/message/interface";
import { Form } from "antd";
import { useEffect, useRef, useState } from "react";
import type {
  Playbook,
  RepositoryDefinition,
  RepositoryPlaybookPublishRequest
} from "../../../shared/types";
import { getErrorMessage } from "../../../services/utils";
import { pickDefaultPublishRepository } from "../../../services/repositoryPublish";
import {
  getRepositoryPlaybook,
  listRepositoryPlaybooks,
  publishRepositoryPlaybook,
  syncRepository
} from "../../resources/api";
import {
  buildPlaybookDiff,
  buildPlaybookDiffTarget,
  toRepositoryPlaybookDiffTarget,
  type PlaybookDiffResult
} from "../../../services/playbookDiff";

export interface PublishFormValues {
  repositoryId: string;
  playbookId: string;
  version: string;
  owner?: string;
  releaseNotes?: string;
}

/** 发布流程所需的上下文（发布弹窗外部注入）。 */
export interface UsePlaybookPublishOptions {
  messageApi: MessageInstance;
  publishableRepositories: RepositoryDefinition[];
  defaultOwner?: string;
  /** 同步仓库与目标读取时使用的 sanitize 函数（与表单侧一致）。 */
  sanitizePlaybookId: (value: string) => string;
  bumpPatchVersion: (version?: string) => string | null;
}

/**
 * 发布流程：弹窗开关、表单、Diff 计算（保留 diffRequestRef 防竞态模式）、发布提交。
 * <p>
 * diffRequestRef 防竞态逻辑移植自原 PlaybookPage：以 useEffect 声明式驱动 diff 计算，
 * 自动响应 form 字段变化；每次进入计算递增 requestId，仅当响应的 requestId 仍为最新时
 * 才写入 state，防止旧请求覆盖新 state。
 */
export function usePlaybookPublish(options: UsePlaybookPublishOptions) {
  const { messageApi, publishableRepositories, defaultOwner, sanitizePlaybookId, bumpPatchVersion } = options;
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishingPlaybook, setPublishingPlaybook] = useState<Playbook | null>(null);
  const [versionHint, setVersionHint] = useState<string | null>(null);
  const [playbookDiff, setPlaybookDiff] = useState<PlaybookDiffResult | null>(null);
  const [playbookDiffLoading, setPlaybookDiffLoading] = useState(false);
  const [publishForm] = Form.useForm<PublishFormValues>();

  const selectedRepositoryId = Form.useWatch("repositoryId", publishForm);
  const selectedPublishPlaybookId = Form.useWatch("playbookId", publishForm);
  const diffRequestRef = useRef(0);
  const syncedRepositoryIdsRef = useRef<Set<string>>(new Set());

  // 与脚本发布一致：以 useEffect 声明式驱动 diff 计算，自动响应 form 字段变化，
  // 并通过 diffRequestRef 防止旧请求的响应覆盖新请求的 state。
  useEffect(() => {
    if (!publishModalOpen || !selectedRepositoryId || !selectedPublishPlaybookId?.trim() || !publishingPlaybook) {
      setVersionHint(null);
      setPlaybookDiff(null);
      setPlaybookDiffLoading(false);
      return;
    }
    const requestId = diffRequestRef.current + 1;
    diffRequestRef.current = requestId;
    setPlaybookDiffLoading(true);
    setVersionHint(null);

    const repositoryId = selectedRepositoryId;
    const playbookId = selectedPublishPlaybookId.trim();

    void (async () => {
      let syncFailed = false;
      if (!syncedRepositoryIdsRef.current.has(repositoryId)) {
        try {
          await syncRepository(repositoryId);
          syncedRepositoryIdsRef.current.add(repositoryId);
        } catch (syncError) {
          syncFailed = true;
          if (diffRequestRef.current === requestId) {
            messageApi.warning(getErrorMessage(syncError, "同步目标仓库失败，将基于已缓存的远端版本信息继续生成 Diff"));
          }
        }
      }
      if (diffRequestRef.current !== requestId) {
        return;
      }

      let descriptors: Awaited<ReturnType<typeof listRepositoryPlaybooks>> = [];
      try {
        descriptors = await listRepositoryPlaybooks();
      } catch (listError) {
        if (diffRequestRef.current === requestId) {
          setVersionHint(getErrorMessage(listError, "读取仓库任务手册列表失败"));
          setPlaybookDiff(null);
          setPlaybookDiffLoading(false);
        }
        return;
      }
      if (diffRequestRef.current !== requestId) {
        return;
      }

      // 双向 sanitize，兼容大小写/特殊字符差异
      const normalizedPlaybookId = sanitizePlaybookId(playbookId);
      const current = descriptors.find(
        (descriptor) =>
          descriptor.repositoryId === repositoryId &&
          sanitizePlaybookId(descriptor.playbookId) === normalizedPlaybookId
      );
      const nextVersion = bumpPatchVersion(current?.version);
      if (nextVersion) {
        publishForm.setFieldValue("version", nextVersion);
      }
      if (diffRequestRef.current === requestId) {
        setVersionHint(
          current
            ? `目标仓库当前版本 ${current.version}，已建议 ${nextVersion ?? current.version}`
            : syncFailed
              ? "同步失败且目标仓库未找到同 ID 任务手册，请手动确认版本"
              : "目标仓库未找到同 ID 任务手册，建议 0.1.0"
        );
      }

      // useEffect 闭包自动拿到最新的 publishingPlaybook，不再有陈旧值问题
      const localTarget = buildPlaybookDiffTarget(publishingPlaybook);
      if (current) {
        try {
          const detail = await getRepositoryPlaybook(repositoryId, playbookId);
          if (diffRequestRef.current === requestId) {
            const remoteTarget = toRepositoryPlaybookDiffTarget(detail);
            setPlaybookDiff(buildPlaybookDiff(remoteTarget, localTarget));
          }
        } catch (detailError) {
          if (diffRequestRef.current === requestId) {
            setPlaybookDiff(null);
            messageApi.warning(getErrorMessage(detailError, "读取远端任务手册详情失败，无法生成 Diff"));
          }
        }
      } else if (diffRequestRef.current === requestId) {
        setPlaybookDiff(buildPlaybookDiff(undefined, localTarget));
      }
      if (diffRequestRef.current === requestId) {
        setPlaybookDiffLoading(false);
      }
    })();
  }, [messageApi, publishForm, publishModalOpen, publishingPlaybook, selectedPublishPlaybookId, selectedRepositoryId, sanitizePlaybookId, bumpPatchVersion]);

  const openPublishModal = (item: Playbook) => {
    const defaultRepository = pickDefaultPublishRepository(publishableRepositories);
    const playbookId = sanitizePlaybookId(item.id || item.name);
    setPublishingPlaybook(item);
    setPublishModalOpen(true);
    setVersionHint(null);
    setPlaybookDiff(null);
    setPlaybookDiffLoading(false);
    diffRequestRef.current += 1;
    syncedRepositoryIdsRef.current = new Set();
    publishForm.setFieldsValue({
      repositoryId: defaultRepository?.id,
      playbookId,
      version: "0.1.0",
      owner: defaultOwner,
      releaseNotes: ""
    });
  };

  const closePublishModal = () => setPublishModalOpen(false);

  const publishMutation = useMutation({
    mutationFn: (params: { playbook: Playbook; values: PublishFormValues }) => {
      const { playbook, values } = params;
      const payload: RepositoryPlaybookPublishRequest = {
        sourceId: playbook.id,
        playbookId: values.playbookId.trim(),
        displayName: playbook.name,
        version: values.version.trim(),
        owner: values.owner?.trim() || undefined,
        releaseNotes: values.releaseNotes?.trim() || undefined,
        tags: playbook.tags ?? []
      };
      return publishRepositoryPlaybook(values.repositoryId, payload);
    }
  });

  const publish = async () => {
    if (!publishingPlaybook) {
      return;
    }
    const values = await publishForm.validateFields();
    try {
      await publishMutation.mutateAsync({ playbook: publishingPlaybook, values });
      messageApi.success("任务手册已发布");
      setPublishModalOpen(false);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "发布任务手册失败"));
    }
  };

  return {
    publishModalOpen,
    publishingPlaybook,
    versionHint,
    playbookDiff,
    playbookDiffLoading,
    publishForm,
    publishing: publishMutation.isPending,
    openPublishModal,
    closePublishModal,
    publish
  };
}
