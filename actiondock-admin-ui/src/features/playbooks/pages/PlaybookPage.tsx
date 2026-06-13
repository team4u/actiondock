import { message, Space, Tabs } from "antd";
import { useRef, useState } from "react";
import { PageHeader } from "../../../components/common/PageHeader";
import { useColorMode } from "../../../shared/contexts/ColorModeContext";
import { getErrorMessage } from "../../../services/utils";
import type { Playbook } from "../../../shared/types";
import { PlaybookList } from "../components/PlaybookList";
import { PlaybookFormDrawer } from "../components/PlaybookFormDrawer";
import { PlaybookPublishDrawer } from "../components/PlaybookPublishDrawer";
import { PlaybookImportModal } from "../components/PlaybookImportModal";
import { bumpPatchVersion, sanitizePlaybookId } from "../components/playbookFormSupport";
import { usePlaybookData } from "../hooks/usePlaybookData";
import { usePlaybookMutations } from "../hooks/usePlaybookMutations";
import { usePlaybookImport } from "../hooks/usePlaybookImport";

/**
 * 任务手册页面（路由壳）。
 * <p>
 * 组合 PlaybookList、PlaybookFormDrawer、PlaybookPublishDrawer、PlaybookImportModal，
 * 数据加载与变更通过 usePlaybookData / usePlaybookMutations / usePlaybookImport（TanStack Query）管理。
 */
export function PlaybookPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const colorMode = useColorMode();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const data = usePlaybookData();
  const mutations = usePlaybookMutations();
  const importFlow = usePlaybookImport({ messageApi, items: data.items, scripts: data.scripts });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  // 文件选择器状态由页面持有（KnowledgeFilePicker 通过 PlaybookFormDrawer 复用）
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [pendingFilePickerRepositoryId, setPendingFilePickerRepositoryId] = useState<string | undefined>(undefined);

  // 发布目标；非 null 且 publishOpen 时打开 PlaybookPublishDrawer
  const [publishingPlaybook, setPublishingPlaybook] = useState<Playbook | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const openEditor = (item?: Playbook) => {
    setEditing(item ?? null);
    setReadOnly(Boolean(item?.managed));
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setReadOnly(false);
    setFilePickerOpen(false);
  };

  const handleSave = async (payload: Playbook) => {
    try {
      if (editing) {
        await mutations.updatePlaybook({ id: editing.id, payload });
      } else {
        await mutations.createPlaybook(payload);
      }
      setDrawerOpen(false);
      messageApi.success("任务手册已保存");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "保存任务手册失败"));
    }
  };

  const handleDelete = async (item: Playbook) => {
    try {
      await mutations.deletePlaybook(item.id);
      messageApi.success("任务手册已删除");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除任务手册失败"));
    }
  };

  const handlePublish = (item: Playbook) => {
    setPublishingPlaybook(item);
    setPublishOpen(true);
  };

  const closePublish = () => {
    setPublishOpen(false);
    setPublishingPlaybook(null);
  };

  const openFilePicker = (repositoryId: string) => {
    setPendingFilePickerRepositoryId(repositoryId);
    setFilePickerOpen(true);
  };

  const closeFilePicker = () => {
    setFilePickerOpen(false);
    setPendingFilePickerRepositoryId(undefined);
  };

  // 文件选择确认后无需额外处理：PlaybookFormDrawer 内部已更新知识编辑器状态
  const confirmFileSelection = (_repositoryId: string, _path: string) => {
    setFilePickerOpen(false);
    setPendingFilePickerRepositoryId(undefined);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={(event) => void importFlow.handleImportChange(event)}
      />
      <PageHeader
        title="任务手册"
        meta="以关联知识、关联脚本、导览 Markdown 和停止条件描述任务路线。"
      />
      <Tabs
        items={[
          {
            key: "playbooks",
            label: "任务手册",
            children: (
              <PlaybookList
                items={data.items}
                loading={data.loading}
                filters={data.filters}
                selectedPlaybookIds={data.selectedPlaybookIds}
                tags={data.tags}
                repositoryOptions={data.repositoryOptions}
                editablePlaybooks={data.editablePlaybooks}
                onFiltersChange={(next) => data.setFilters(next)}
                onSelectChange={data.setSelectedPlaybookIds}
                onEdit={openEditor}
                onCreate={() => openEditor()}
                onPublish={handlePublish}
                onDelete={(item) => void handleDelete(item)}
                onExport={importFlow.exportPlaybooks}
                onImportClick={() => fileInputRef.current?.click()}
              />
            )
          }
        ]}
      />
      <PlaybookFormDrawer
        open={drawerOpen}
        editing={editing}
        readOnly={readOnly}
        repositoryOptions={data.repositoryOptions}
        repositoryNameMap={data.repositoryNameMap}
        scripts={data.scripts}
        scriptOptions={data.scriptOptions}
        items={data.items}
        editorTheme={editorTheme}
        onClose={closeDrawer}
        onSave={handleSave}
        filePickerOpen={filePickerOpen}
        onOpenFilePicker={openFilePicker}
        onCloseFilePicker={closeFilePicker}
        onConfirmFile={confirmFileSelection}
        pendingFilePickerRepositoryId={pendingFilePickerRepositoryId}
      />
      <PlaybookPublishDrawer
        open={publishOpen}
        playbook={publishingPlaybook}
        publishableRepositories={data.publishableRepositories}
        publishRepositoryOptions={data.publishRepositoryOptions}
        messageApi={messageApi}
        editorTheme={editorTheme}
        sanitizePlaybookId={sanitizePlaybookId}
        bumpPatchVersion={bumpPatchVersion}
        onClose={closePublish}
      />
      <PlaybookImportModal
        open={importFlow.importPreviewOpen}
        importing={importFlow.importing}
        analysis={importFlow.pendingImportAnalysis}
        blockedIds={importFlow.pendingImportBlockedIds}
        onOk={() => void importFlow.runImport()}
        onCancel={importFlow.cancelImport}
      />
    </Space>
  );
}
