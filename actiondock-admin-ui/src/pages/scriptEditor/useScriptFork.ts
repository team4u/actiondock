import { Form } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { forkRepositoryTool } from "../../api";
import { getErrorMessage } from "../../utils";
import type { ScriptDefinition } from "../../types";
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
  const [forkForm] = Form.useForm<ForkFormValues>();
  const navigate = useNavigate();
  const [forkModalOpen, setForkModalOpen] = useState(false);
  const [forkingRepositoryTool, setForkingRepositoryTool] = useState(false);

  const openForkModal = () => {
    if (!currentScript) return;
    forkForm.setFieldsValue({
      id: `${currentScript.repositoryToolId || currentScript.id}-fork`,
      name: `${currentScript.name} Fork`
    });
    setForkModalOpen(true);
  };

  const handleForkRepositoryScript = async () => {
    if (!currentScript) return;
    try {
      const values = await forkForm.validateFields();
      setForkingRepositoryTool(true);
      const created = await forkRepositoryTool(currentScript.id, {
        id: values.id.trim(),
        name: values.name.trim()
      });
      setForkModalOpen(false);
      messageApi.success("Fork 已创建");
      navigate(`/scripts/${created.id}`);
    } catch (error) {
      if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      }
      messageApi.error(getErrorMessage(error, "创建 Fork 失败"));
    } finally {
      setForkingRepositoryTool(false);
    }
  };

  return {
    forkForm,
    forkModalOpen,
    setForkModalOpen,
    forkingRepositoryTool,
    openForkModal,
    handleForkRepositoryScript
  };
}
