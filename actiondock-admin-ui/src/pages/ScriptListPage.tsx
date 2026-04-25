import { CopyOutlined, DownloadOutlined, ExportOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Card, Modal, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import type { ChangeEvent, Key } from "react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, createScript, listScripts, updateScript } from "../api";
import { TableLinkCell } from "../components/TableLinkCell";
import {
  analyzeScriptImport,
  buildScriptExportBundle,
  downloadJsonFile,
  formatScriptExportFileName,
  parseScriptImportBundle
} from "../scriptTransfer";
import { formatDateTime } from "../utils";
import type { ScriptDefinition } from "../types";

const { Text } = Typography;

export function ScriptListPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [selectedScriptIds, setSelectedScriptIds] = useState<Key[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();

  const loadScripts = async () => {
    setLoading(true);
    try {
      const data = await listScripts();
      const sortedScripts = [...data].sort((left, right) =>
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")
      );
      setScripts(sortedScripts);
      setSelectedScriptIds((previous) =>
        previous.filter((id) => sortedScripts.some((script) => script.id === id))
      );
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : "加载脚本失败";
      messageApi.error(detail);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadScripts();
  }, []);

  const exportScripts = (targetScripts: ScriptDefinition[], successMessage: string) => {
    try {
      const bundle = buildScriptExportBundle(targetScripts);
      downloadJsonFile(formatScriptExportFileName(), bundle);
      messageApi.success(successMessage);
    } catch {
      messageApi.error("导出脚本失败");
    }
  };

  const handleExportAll = () => {
    exportScripts(scripts, `已导出 ${scripts.length} 个脚本`);
  };

  const handleExportSelected = () => {
    const selectedScripts = scripts.filter((script) => selectedScriptIds.includes(script.id));
    exportScripts(selectedScripts, `已导出 ${selectedScripts.length} 个选中脚本`);
  };

  const runImport = async (importedScripts: ScriptDefinition[]) => {
    setImporting(true);
    const currentIds = new Set(scripts.map((script) => script.id));
    const successes: string[] = [];
    const failures: Array<{ id: string; reason: string }> = [];

    try {
      for (const script of importedScripts) {
        try {
          if (currentIds.has(script.id)) {
            await updateScript(script.id, script);
          } else {
            await createScript(script);
            currentIds.add(script.id);
          }
          successes.push(script.id);
        } catch (error) {
          const detail = error instanceof ApiError ? error.message : "导入失败";
          failures.push({ id: script.id, reason: detail });
        }
      }

      if (successes.length > 0) {
        await loadScripts();
      }

      if (failures.length === 0) {
        messageApi.success(`导入完成，成功处理 ${successes.length} 个脚本`);
        return;
      }

      modal.warning({
        title: "导入已完成，部分脚本处理失败",
        width: 640,
        content: (
          <div className="script-import-result">
            <Text>成功 {successes.length} 条，失败 {failures.length} 条。</Text>
            <pre className="script-import-result__code">
              {failures
                .slice(0, 10)
                .map((item) => `${item.id}: ${item.reason}`)
                .join("\n")}
            </pre>
            {failures.length > 10 ? (
              <Text type="secondary">仅展示前 10 条失败明细。</Text>
            ) : null}
          </div>
        )
      });
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const importedScripts = parseScriptImportBundle(await file.text());
      const analysis = analyzeScriptImport(importedScripts, scripts);
      const overwritePreview = analysis.overwriteIds.slice(0, 10);

      await modal.confirm({
        title: "确认导入脚本",
        okText: "开始导入",
        cancelText: "取消",
        width: 680,
        content: (
          <div className="script-import-summary">
            <Text>共解析到 {analysis.scripts.length} 个脚本。</Text>
            <Text>新增 {analysis.createIds.length} 个，覆盖 {analysis.overwriteIds.length} 个。</Text>
            {analysis.overwriteIds.length > 0 ? (
              <>
                <Text strong>将被覆盖的脚本 ID</Text>
                <pre className="script-import-result__code">{overwritePreview.join("\n")}</pre>
                {analysis.overwriteIds.length > overwritePreview.length ? (
                  <Text type="secondary">
                    仅展示前 {overwritePreview.length} 个，剩余 {analysis.overwriteIds.length - overwritePreview.length} 个将在导入时一并覆盖。
                  </Text>
                ) : null}
              </>
            ) : null}
          </div>
        ),
        onOk: () => runImport(analysis.scripts)
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "导入脚本失败";
      messageApi.error(detail);
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

  const columns: ColumnsType<ScriptDefinition> = [
    {
      title: "脚本 ID",
      dataIndex: "id",
      key: "id",
      render: (value: string) => (
        <TableLinkCell to={`/scripts/${value}`}>{value}</TableLinkCell>
      )
    },
    {
      title: "名称",
      dataIndex: "name",
      key: "name"
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 120
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status: ScriptDefinition["status"]) => (
        <Tag color={status === "PUBLISHED" ? "green" : "gold"}>{status === "PUBLISHED" ? "已发布" : "草稿"}</Tag>
      )
    },
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
      width: 100
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_: unknown, record) => {
        const isPublished = record.status === "PUBLISHED";

        return (
          <Space size={4}>
            <Button
              type="link"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => navigate(`/scripts/new?copyFrom=${encodeURIComponent(record.id)}`)}
            >
              复制
            </Button>
            <Button
              type="link"
              size="small"
              icon={<ExportOutlined />}
              disabled={!isPublished}
              onClick={() => navigate(`/run/${record.id}`)}
            >
              运行
            </Button>
          </Space>
        );
      }
    }
  ];

  const rowSelection: TableRowSelection<ScriptDefinition> = {
    selectedRowKeys: selectedScriptIds,
    onChange: (nextSelectedRowKeys) => setSelectedScriptIds(nextSelectedRowKeys),
    preserveSelectedRowKeys: true
  };

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void handleImportChange(event)}
      />
      <Card title="脚本列表">
        <div className="script-list-toolbar">
          <Space direction="vertical" size={2} className="script-list-toolbar__meta">
            <Text type="secondary">共 {scripts.length} 个脚本</Text>
            <Text type="secondary">已选 {selectedScriptIds.length} 个脚本</Text>
          </Space>
          <Space wrap className="script-list-toolbar__actions">
            <Button icon={<PlusOutlined />} type="primary" onClick={() => navigate("/scripts/new")}>
              新建脚本
            </Button>
            <Button
              icon={<UploadOutlined />}
              loading={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              导入脚本
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={loading || scripts.length === 0 || importing}
              onClick={handleExportAll}
            >
              导出全部
            </Button>
            <Button
              icon={<DownloadOutlined />}
              type="primary"
              ghost
              disabled={loading || importing || selectedScriptIds.length === 0}
              onClick={handleExportSelected}
            >
              导出选中
            </Button>
          </Space>
        </div>
        <Table
          className="script-list-table"
          rowKey="id"
          loading={loading || importing}
          rowSelection={rowSelection}
          columns={columns}
          dataSource={scripts}
          pagination={{ pageSize: 10, responsive: true }}
          scroll={{ x: 760 }}
        />
      </Card>
    </>
  );
}
