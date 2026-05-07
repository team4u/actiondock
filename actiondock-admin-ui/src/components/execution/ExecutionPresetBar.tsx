import {
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  SaveOutlined
} from "@ant-design/icons";
import {
  Button,
  Collapse,
  Dropdown,
  Drawer,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  message
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useExecutionPresets } from "../../shared/hooks/useExecutionPresets";
import { SchemaObjectResultView } from "../schema/SchemaObjectResultView";
import type { ExecutionPreset } from "../../shared/types";
import { formatDateTime } from "../../services/utils";
const { Text } = Typography;

export interface ExecutionPresetBarProps {
  scriptId: string | undefined | null;
  inputSchema?: Record<string, unknown>;
  currentInput: Record<string, unknown> | null;
  onLoadPreset: (input: Record<string, unknown>) => void;
}

function stableSerialize(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(",")}}`;
}

function buildCopyName(preset: ExecutionPreset | null): string {
  if (!preset) {
    return "";
  }
  return `${preset.name}-副本`;
}

export function ExecutionPresetBar({
  scriptId,
  inputSchema,
  currentInput,
  onLoadPreset
}: ExecutionPresetBarProps) {
  const {
    presets,
    loading,
    savePreset,
    updatePresetInput,
    renamePreset,
    deletePreset
  } = useExecutionPresets({ scriptId });
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(undefined);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ExecutionPreset | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchText, setSearchText] = useState("");

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId]
  );
  const currentInputKey = useMemo(
    () => (currentInput ? stableSerialize(currentInput) : null),
    [currentInput]
  );
  const selectedPresetInputKey = useMemo(
    () => (selectedPreset ? stableSerialize(selectedPreset.input) : null),
    [selectedPreset]
  );
  const hasValidCurrentInput = Boolean(currentInput);
  const isDirty = Boolean(
    selectedPreset
    && currentInputKey
    && selectedPresetInputKey
    && currentInputKey !== selectedPresetInputKey
  );
  const filteredPresets = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    const visiblePresets = keyword
      ? presets.filter((preset) => preset.name.toLowerCase().includes(keyword))
      : presets;

    if (!selectedPresetId) {
      return visiblePresets;
    }

    return [...visiblePresets].sort((left, right) => {
      if (left.id === selectedPresetId) return -1;
      if (right.id === selectedPresetId) return 1;
      return 0;
    });
  }, [presets, searchText, selectedPresetId]);

  useEffect(() => {
    if (selectedPresetId && !presets.some((preset) => preset.id === selectedPresetId)) {
      setSelectedPresetId(undefined);
    }
  }, [presets, selectedPresetId]);

  useEffect(() => {
    setSelectedPresetId(undefined);
    setDrawerOpen(false);
    setSearchText("");
  }, [scriptId]);

  const applyPreset = useCallback((preset: ExecutionPreset) => {
    setSelectedPresetId(preset.id);
    onLoadPreset(preset.input);
  }, [onLoadPreset]);

  const confirmApplyPreset = useCallback((preset: ExecutionPreset) => {
    if (!selectedPreset || !isDirty) {
      applyPreset(preset);
      return;
    }

    Modal.confirm({
      title: preset.id === selectedPreset.id ? "放弃当前未保存修改并重新加载预设？" : "切换预设会覆盖当前未保存修改",
      content: preset.id === selectedPreset.id
        ? `将恢复到预设“${preset.name}”的已保存内容。`
        : `将从“${selectedPreset.name}”切换到“${preset.name}”，当前修改不会保留。`,
      okText: "确认切换",
      cancelText: "取消",
      onOk: () => applyPreset(preset)
    });
  }, [applyPreset, isDirty, selectedPreset]);

  const handleOpenSave = useCallback((defaultName: string) => {
    setSaveName(defaultName);
    setSaveModalOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    const name = saveName.trim();
    if (!name || !currentInput) {
      return;
    }

    setSaveLoading(true);
    try {
      const created = await savePreset(name, currentInput);
      if (!created) {
        throw new Error("save-failed");
      }
      setSelectedPresetId(created.id);
      setSaveModalOpen(false);
      messageApi.success("预设已保存");
    } catch {
      messageApi.error("保存预设失败");
    } finally {
      setSaveLoading(false);
    }
  }, [currentInput, messageApi, saveName, savePreset]);

  const handleUpdate = useCallback(async () => {
    if (!selectedPreset?.id || !currentInput) {
      return;
    }

    try {
      const updated = await updatePresetInput(selectedPreset.id, currentInput);
      if (!updated) {
        throw new Error("update-failed");
      }
      setSelectedPresetId(updated.id);
      messageApi.success("预设已更新");
    } catch {
      messageApi.error("更新预设失败");
    }
  }, [currentInput, messageApi, selectedPreset, updatePresetInput]);

  const handleOpenRename = useCallback((preset: ExecutionPreset) => {
    setRenameTarget(preset);
    setRenameName(preset.name);
    setRenameModalOpen(true);
  }, []);

  const handleRename = useCallback(async () => {
    if (!renameTarget) {
      return;
    }

    const name = renameName.trim();
    if (!name) {
      return;
    }

    setRenameLoading(true);
    try {
      await renamePreset(renameTarget.id, name);
      setRenameModalOpen(false);
      messageApi.success("预设已重命名");
    } catch {
      messageApi.error("重命名失败");
    } finally {
      setRenameLoading(false);
    }
  }, [messageApi, renameName, renamePreset, renameTarget]);

  const handleDelete = useCallback(async (preset: ExecutionPreset) => {
    try {
      await deletePreset(preset.id);
      if (selectedPresetId === preset.id) {
        setSelectedPresetId(undefined);
      }
      messageApi.success("预设已删除");
    } catch {
      messageApi.error("删除预设失败");
    }
  }, [deletePreset, messageApi, selectedPresetId]);

  const currentStatusTag = selectedPreset
    ? (
      hasValidCurrentInput
        ? (isDirty ? <Tag color="orange">已修改</Tag> : <Tag color="green">已保存</Tag>)
        : <Tag color="red">输入无效</Tag>
    )
    : <Tag>未选择</Tag>;

  const actionMenuItems = [
    ...(hasValidCurrentInput
      ? [{
          key: "save-as",
          label: selectedPreset ? "另存为新预设" : "保存为预设",
          onClick: () => handleOpenSave(selectedPreset ? buildCopyName(selectedPreset) : "")
        }]
      : []),
    ...(selectedPreset && isDirty && hasValidCurrentInput
      ? [{
          key: "update",
          label: "更新当前预设",
          onClick: () => void handleUpdate()
        }]
      : []),
    {
      key: "manage",
      label: "管理预设",
      onClick: () => setDrawerOpen(true)
    }
  ];

  return (
    <>
      {contextHolder}
      <div className="execution-preset-panel">
        <div className="execution-preset-panel__toolbar">
          <div className="execution-preset-panel__label">
            <Text type="secondary">参数预设</Text>
          </div>

          <Select
            className="execution-preset-panel__select"
            placeholder={scriptId ? "选择预设" : "保存脚本后可使用预设"}
            value={selectedPresetId}
            onChange={(presetId: string) => {
              const preset = presets.find((item) => item.id === presetId);
              if (preset) {
                confirmApplyPreset(preset);
              }
            }}
            loading={loading}
            allowClear
            options={presets.map((preset) => ({ label: preset.name, value: preset.id }))}
            onClear={() => setSelectedPresetId(undefined)}
            disabled={!scriptId}
            showSearch
            optionFilterProp="label"
          />

          <Space size={4} wrap className="execution-preset-panel__actions">
            {selectedPreset && isDirty ? (
              <Button
                type="text"
                size="small"
                icon={<SaveOutlined />}
                onClick={() => void handleUpdate()}
                disabled={!hasValidCurrentInput}
              >
                更新
              </Button>
            ) : null}

            <Dropdown
              menu={{ items: actionMenuItems }}
              trigger={["click"]}
              disabled={!scriptId}
            >
              <Button type="text" size="small" icon={<MoreOutlined />} />
            </Dropdown>
          </Space>
        </div>
      </div>

      <Drawer
        title="管理参数预设"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={520}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Input
            placeholder="搜索预设名称"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />

          {filteredPresets.length > 0 ? (
            <Collapse
              className="execution-preset-drawer"
              items={filteredPresets.map((preset) => {
                const isSelected = preset.id === selectedPresetId;
                const isCurrentDirty = isSelected && isDirty;

                return {
                  key: preset.id,
                  label: (
                    <div className="execution-preset-drawer__meta">
                      <Space size={[8, 8]} wrap>
                        <Text strong>{preset.name}</Text>
                        {isSelected ? (
                          <Tag color={isCurrentDirty ? "orange" : "blue"}>
                            {isCurrentDirty ? "当前已修改" : "当前使用中"}
                          </Tag>
                        ) : null}
                      </Space>
                      <Text type="secondary">
                        更新时间 {formatDateTime(preset.updatedAt ?? preset.createdAt)}
                      </Text>
                    </div>
                  ),
                  extra: (
                    <Space size={8} wrap onClick={(event) => event.stopPropagation()}>
                      <Button size="small" onClick={() => confirmApplyPreset(preset)}>
                        应用
                      </Button>
                      <Button size="small" icon={<EditOutlined />} onClick={() => handleOpenRename(preset)}>
                        重命名
                      </Button>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => {
                          Modal.confirm({
                            title: `确认删除预设“${preset.name}”？`,
                            okText: "删除",
                            okButtonProps: { danger: true },
                            cancelText: "取消",
                            onOk: () => handleDelete(preset)
                          });
                        }}
                      >
                        删除
                      </Button>
                    </Space>
                  ),
                  children: (
                    <SchemaObjectResultView
                      schema={inputSchema}
                      value={preset.input}
                      schemaName="inputSchema"
                      valueName="输入"
                    />
                  )
                };
              })}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配的预设" />
          )}
        </Space>
      </Drawer>

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
          onChange={(event) => setSaveName(event.target.value)}
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
          onChange={(event) => setRenameName(event.target.value)}
          onPressEnter={() => void handleRename()}
          autoFocus
        />
      </Modal>
    </>
  );
}
