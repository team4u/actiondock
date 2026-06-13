import type { MessageInstance } from "antd/es/message/interface";
import { Modal, Space, Typography } from "antd";
import { useState } from "react";
import type { ChangeEvent } from "react";
import type { Playbook, ScriptDefinition } from "../../../shared/types";
import { ApiError } from "../../../shared/api/httpClient";
import { getErrorMessage } from "../../../services/utils";
import {
  analyzePlaybookImport,
  buildPlaybookExportBundle,
  formatPlaybookExportFileName,
  parsePlaybookImportBundle,
  type PlaybookImportAnalysis
} from "../../../services/playbookTransfer";
import { downloadJsonFile } from "../../../services/scriptTransfer";
import { createPlaybook, updatePlaybook } from "../api";

const { Text } = Typography;

export interface UsePlaybookImportOptions {
  messageApi: MessageInstance;
  items: Playbook[];
  scripts: ScriptDefinition[];
}

/**
 * 任务手册导入导出流程。
 * <p>
 * 导入时直接调用 createPlaybook / updatePlaybook（由 usePlaybookMutations 的 invalidate
 * 自动刷新列表），导出为本地 JSON 文件。
 */
export function usePlaybookImport(options: UsePlaybookImportOptions) {
  const { messageApi, items, scripts } = options;
  const [importing, setImporting] = useState(false);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [pendingImportAnalysis, setPendingImportAnalysis] = useState<PlaybookImportAnalysis | null>(null);

  const exportPlaybooks = (targetPlaybooks: Playbook[], successMessage: string) => {
    if (targetPlaybooks.length === 0) {
      messageApi.warning("没有可导出的任务手册");
      return;
    }
    try {
      const bundle = buildPlaybookExportBundle(targetPlaybooks);
      downloadJsonFile(formatPlaybookExportFileName(), bundle);
      messageApi.success(successMessage);
    } catch {
      messageApi.error("导出任务手册失败");
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const importedPlaybooks = parsePlaybookImportBundle(await file.text());
      const analysis = analyzePlaybookImport(importedPlaybooks, items, scripts);
      setPendingImportAnalysis(analysis);
      setImportPreviewOpen(true);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "导入任务手册失败"));
    }
  };

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json")) {
      messageApi.error("仅支持导入 .json 文件");
      return;
    }
    await handleImportFile(file);
  };

  const pendingImportBlockedIds = pendingImportAnalysis
    ? new Set([
        ...pendingImportAnalysis.managedConflictIds,
        ...pendingImportAnalysis.missingScriptRefs.map((item) => item.playbookId),
        ...pendingImportAnalysis.missingRelatedPlaybookRefs.map((item) => item.playbookId),
        ...pendingImportAnalysis.circularIds
      ])
    : new Set<string>();

  const runImport = async () => {
    if (!pendingImportAnalysis) {
      return;
    }
    setImporting(true);
    const blockedIds = pendingImportBlockedIds;
    const currentIds = new Set(items.map((item) => item.id));
    const successes: string[] = [];
    const failures: Array<{ id: string; reason: string }> = [];

    try {
      for (const playbook of pendingImportAnalysis.playbooks) {
        if (blockedIds.has(playbook.id)) {
          continue;
        }
        try {
          if (currentIds.has(playbook.id)) {
            await updatePlaybook(playbook.id, playbook);
          } else {
            await createPlaybook(playbook);
            currentIds.add(playbook.id);
          }
          successes.push(playbook.id);
        } catch (error) {
          const detail = error instanceof ApiError ? error.message : getErrorMessage(error, "导入失败");
          failures.push({ id: playbook.id, reason: detail });
        }
      }

      setImportPreviewOpen(false);
      setPendingImportAnalysis(null);
      if (failures.length === 0) {
        messageApi.success(`导入完成，成功处理 ${successes.length} 个任务手册`);
        return;
      }
      Modal.warning({
        title: "导入已完成，部分任务手册处理失败",
        width: 640,
        content: (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text>成功 {successes.length} 条，失败 {failures.length} 条。</Text>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {failures.slice(0, 10).map((item) => `${item.id}: ${item.reason}`).join("\n")}
            </pre>
          </Space>
        )
      });
    } finally {
      setImporting(false);
    }
  };

  const cancelImport = () => {
    setImportPreviewOpen(false);
    setPendingImportAnalysis(null);
  };

  return {
    importing,
    importPreviewOpen,
    pendingImportAnalysis,
    pendingImportBlockedIds,
    exportPlaybooks,
    handleImportChange,
    runImport,
    cancelImport
  };
}
