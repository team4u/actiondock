import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Playbook } from "../../../shared/types";
import { createPlaybook, deletePlaybook, updatePlaybook } from "../api";

/**
 * 任务手册增删改 mutation 集合。
 * <p>
 * 成功后统一 invalidate ['playbooks'] 触发列表自动刷新，
 * 替代原来手动调用 load() 重拉。调用方通过 messageApi 处理成功/失败提示。
 */
export function usePlaybookMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["playbooks"] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: Playbook) => createPlaybook(payload),
    onSuccess: invalidate
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Playbook }) => updatePlaybook(id, payload),
    onSuccess: invalidate
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePlaybook(id),
    onSuccess: invalidate
  });

  return {
    createPlaybook: createMutation.mutateAsync,
    updatePlaybook: updateMutation.mutateAsync,
    deletePlaybook: deleteMutation.mutateAsync,
    createPending: createMutation.isPending,
    updatePending: updateMutation.isPending,
    deletePending: deleteMutation.isPending
  };
}
