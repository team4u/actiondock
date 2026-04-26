import { DeleteOutlined, EditOutlined, MoreOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, Modal, Select, Space, message } from "antd";
import { useCallback, useState } from "react";
import { useExecutionPresets } from "../hooks/useExecutionPresets";
import type { ExecutionPreset } from "../types";

export interface ExecutionPresetBarProps {
  scriptId: string | undefined | null;
  currentInput: Record<string, unknown> | null;
  onLoadPreset: (input: Record<string, unknown>) => void;
}

export function ExecutionPresetBar({ scriptId, currentInput, onLoadPreset }: ExecutionPresetBarProps) {
  const { presets, loading, savePreset, renamePreset, deletePreset } = useExecutionPresets({ scriptId });
  const [messageApi, contextHolder] = message.useMessage();
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ExecutionPreset | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(undefined);

  const handleOpenSave = useCallback(() => {
    setSaveName("");
    setSaveModalOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    const name = saveName.trim();
    if (!name || !currentInput) return;
    setSaveLoading(true);
    try {
      await savePreset(name, currentInput);
      messageApi.success("预设已保存");
      setSaveModalOpen(false);
    } catch {
      messageApi.error("保存预设失败");
    } finally {
      setSaveLoading(false);
    }
  }, [saveName, currentInput, savePreset, messageApi]);

  const handleSelect = useCallback((presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (preset) {
      setSelectedPresetId(presetId);
      onLoadPreset(preset.input);
      messageApi.success("已加载预设");
    }
  }, [presets, onLoadPreset, messageApi]);

  const handleOpenRename = useCallback((preset: ExecutionPreset) => {
    setRenameTarget(preset);
    setRenameName(preset.name);
    setRenameModalOpen(true);
  }, []);

  const handleRename = useCallback(async () => {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) return;
    setRenameLoading(true);
    try {
      await renamePreset(renameTarget.id, name);
      messageApi.success("预设已重命名");
      setRenameModalOpen(false);
    } catch {
      messageApi.error("重命名失败");
    } finally {
      setRenameLoading(false);
    }
  }, [renameTarget, renameName, renamePreset, messageApi]);

  const handleDelete = useCallback(async (preset: ExecutionPreset) => {
    try {
      await deletePreset(preset.id);
      messageApi.success("预设已删除");
      if (selectedPresetId === preset.id) {
        setSelectedPresetId(undefined);
      }
    } catch {
      messageApi.error("删除预设失败");
    }
  }, [deletePreset, selectedPresetId, messageApi]);

  const manageMenuItems = presets.map((preset) => ({
    key: preset.id,
    label: preset.name,
    children: [
      {
        key: `${preset.id}-rename`,
        icon: <EditOutlined />,
        label: "重命名",
        onClick: () => handleOpenRename(preset)
      },
      {
        key: `${preset.id}-delete`,
        icon: <DeleteOutlined />,
        label: "删除",
        danger: true,
        onClick: () => {
          Modal.confirm({
            title: `确认删除预设 "${preset.name}"？`,
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => handleDelete(preset)
          });
        }
      }
    ]
  }));

  return (
    <>
      {contextHolder}
      <div className="execution-preset-bar">
        <Select
          className="execution-preset-bar__select"
          placeholder="选择参数预设"
          value={selectedPresetId}
          onChange={handleSelect}
          loading={loading}
          allowClear
          options={presets.map((p) => ({ label: p.name, value: p.id }))}
          onClear={() => setSelectedPresetId(undefined)}
        />
        <Button
          icon={<SaveOutlined />}
          onClick={handleOpenSave}
          disabled={!currentInput || !scriptId}
        >
          保存预设
        </Button>
        {presets.length > 0 && (
          <Dropdown menu={{ items: manageMenuItems }} trigger={["click"]}>
            <Button icon={<MoreOutlined />} />
          </Dropdown>
        )}
      </div>

      <Modal
        title="保存参数预设"
        open={saveModalOpen}
        onCancel={() => setSaveModalOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saveLoading}
        okText="保存"
        cancelText="取消"
      >
        <Input
          placeholder="例如：测试环境查询"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          onPressEnter={() => void handleSave()}
          autoFocus
        />
      </Modal>

      <Modal
        title="重命名预设"
        open={renameModalOpen}
        onCancel={() => setRenameModalOpen(false)}
        onOk={() => void handleRename()}
        confirmLoading={renameLoading}
        okText="保存"
        cancelText="取消"
      >
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onPressEnter={() => void handleRename()}
          autoFocus
        />
      </Modal>
    </>
  );
}
