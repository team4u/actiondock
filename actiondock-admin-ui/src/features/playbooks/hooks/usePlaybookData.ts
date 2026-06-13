import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Key } from "react";
import type { Playbook, RepositoryDefinition, ScriptDefinition } from "../../../shared/types";
import { getPublishableRepositories } from "../../../services/repositoryPublish";
import { listRepositories } from "../../resources/api";
import { listScripts } from "../../scripts/api";
import { listPlaybooks } from "../api";

export interface PlaybookFilters {
  repositoryId?: string;
  tag?: string;
  managed?: boolean;
  intent?: string;
}

/**
 * 任务手册数据加载与筛选状态。
 * <p>
 * 使用 TanStack React Query 管理列表与依赖资源（仓库、脚本）的加载，
 * queryKey 随筛选条件变化自动重新拉取，替代原来的 useEffect + Promise.all 手动加载。
 */
export function usePlaybookData() {
  const [filters, setFilters] = useState<PlaybookFilters>({});
  const [selectedPlaybookIds, setSelectedPlaybookIds] = useState<Key[]>([]);

  const playbooksQuery = useQuery({
    queryKey: ["playbooks", "list", filters],
    queryFn: () => listPlaybooks(filters)
  });

  const repositoriesQuery = useQuery({
    queryKey: ["repositories", "PROJECT"],
    queryFn: () => listRepositories("PROJECT")
  });

  const publishRepositoriesQuery = useQuery({
    queryKey: ["repositories", "all"],
    queryFn: () => listRepositories()
  });

  const scriptsQuery = useQuery({
    queryKey: ["scripts", "list"],
    queryFn: () => listScripts()
  });

  const items: Playbook[] = playbooksQuery.data ?? [];
  const repositories: RepositoryDefinition[] = repositoriesQuery.data ?? [];
  const publishRepositories: RepositoryDefinition[] = publishRepositoriesQuery.data ?? [];
  const scripts: ScriptDefinition[] = scriptsQuery.data ?? [];

  const loading = playbooksQuery.isLoading;

  const repositoryOptions = useMemo(
    () => repositories.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })),
    [repositories]
  );
  const repositoryNameMap = useMemo(() => new Map(repositories.map((item) => [item.id, item.name])), [repositories]);
  const publishableRepositories = useMemo(() => getPublishableRepositories(publishRepositories), [publishRepositories]);
  const publishRepositoryOptions = useMemo(
    () => publishableRepositories.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })),
    [publishableRepositories]
  );
  const scriptOptions = useMemo(
    () => scripts.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })),
    [scripts]
  );
  const tags = useMemo(
    () => Array.from(new Set(items.flatMap((item) => item.tags ?? []))).sort(),
    [items]
  );
  const editablePlaybooks = useMemo(() => items.filter((item) => !item.managed), [items]);

  return {
    filters,
    setFilters,
    selectedPlaybookIds,
    setSelectedPlaybookIds,
    items,
    repositories,
    publishRepositories,
    publishableRepositories,
    publishRepositoryOptions,
    repositoryOptions,
    repositoryNameMap,
    scripts,
    scriptOptions,
    tags,
    editablePlaybooks,
    loading
  };
}
