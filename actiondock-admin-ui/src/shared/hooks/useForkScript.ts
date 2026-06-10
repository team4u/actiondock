import { Form } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { forkRepositoryTool } from "../../features/resources/api";
import { getErrorMessage } from "../../services/utils";
import type { ForkFormValues, ScriptDefinition } from "../../shared/types";

export interface ForkScriptContext {
  forkForm: ReturnType<typeof Form.useForm<ForkFormValues>>[0];
  forkModalOpen: boolean;
  setForkModalOpen: (open: boolean) => void;
  forkingId: string | null;
  openForkModal: (target: ScriptDefinition) => void;
  handleFork: () => Promise<void>;
}

export function useForkScript({ messageApi }: { messageApi: MessageInstance }): ForkScriptContext {
  const [forkForm] = Form.useForm<ForkFormValues>();
  const navigate = useNavigate();
  const [forkTarget, setForkTarget] = useState<ScriptDefinition | null>(null);
  const [forkingId, setForkingId] = useState<string | null>(null);

  const openForkModal = (target: ScriptDefinition) => {
    forkForm.setFieldsValue({
      id: `${target.repositoryScriptId || target.id}-fork`,
      name: `${target.name} Fork`
    });
    setForkTarget(target);
  };

  const handleFork = async () => {
    if (!forkTarget) return;
    try {
      const values = await forkForm.validateFields();
      setForkingId(forkTarget.id);
      const created = await forkRepositoryTool(forkTarget.id, {
        id: values.id.trim(),
        name: values.name.trim()
      });
      setForkTarget(null);
      forkForm.resetFields();
      messageApi.success("Fork 已创建");
      navigate(`/scripts/${created.id}`);
    } catch (error) {
      if (typeof error === "object" && error !== null && "errorFields" in error) return;
      messageApi.error(getErrorMessage(error, "创建 Fork 失败"));
    } finally {
      setForkingId(null);
    }
  };

  return {
    forkForm,
    forkModalOpen: Boolean(forkTarget),
    setForkModalOpen: (open: boolean) => {
      if (!open) {
        setForkTarget(null);
        forkForm.resetFields();
      }
    },
    forkingId,
    openForkModal,
    handleFork
  };
}
