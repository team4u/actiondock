import { Form } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useForkScript } from "../../../../shared/hooks/useForkScript";
import type { ScriptDefinition } from "../../../../shared/types";
import type { ForkFormValues } from "./types";

export interface UseScriptForkParams {
  currentScript: ScriptDefinition | null;
  messageApi: MessageInstance;
}

export interface ScriptForkContext {
  forkForm: ReturnType<typeof Form.useForm<ForkFormValues>>[0];
  forkModalOpen: boolean;
  setForkModalOpen: (open: boolean) => void;
  forkingRepositoryTool: boolean;
  openForkModal: () => void;
  handleForkRepositoryScript: () => Promise<void>;
}

export function useScriptFork({
  currentScript,
  messageApi
}: UseScriptForkParams): ScriptForkContext {
  const fork = useForkScript({ messageApi });

  return {
    forkForm: fork.forkForm,
    forkModalOpen: fork.forkModalOpen,
    setForkModalOpen: fork.setForkModalOpen,
    forkingRepositoryTool: fork.forkingId === currentScript?.id,
    openForkModal: () => {
      if (currentScript) fork.openForkModal(currentScript);
    },
    handleForkRepositoryScript: fork.handleFork
  };
}
