import {
  CopyOutlined,
  DownloadOutlined,
  ExportOutlined,
  PlusOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Button, Card, Empty, Input, Modal, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import type { ChangeEvent, Key } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, createScript, listScripts, updateScript } from "../api";
import { PageHeader } from "../components/PageHeader";
import { TableLinkCell } from "../components/TableLinkCell";
import {
  analyzeScriptImport,
  buildScriptExportBundle,
  downloadJsonFile,
  formatScriptExportFileName,
  parseScriptImportBundle
} from "../scriptTransfer";
import type { ScriptDefinition } from "../types";
import { formatDateTime, getErrorMessage } from "../utils";

const { Text } = Typography;

function isMyTool(script: ScriptDefinition): boolean {
  return script.scope !== "REPOSITORY";
}

function getScopeTag(script: ScriptDefinition) {
  switch (script.scope) {
    case "FORK":
      return <Tag color="cyan">Fork</Tag>;
    case "SAMPLE":
      return <Tag color="purple">示例</Tag>;
    default:
      return <Tag color="blue">个人</Tag>;
  }
}

export function MyToolsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [selectedScriptIds, setSelectedScriptIds] = useState<Key[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();

  const loadScripts = async () => {
    setLoading(true);
    try {
      const data = await listScripts();
      const sortedScripts = data
        .filter(isMyTool)
        .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
      setScripts(sortedScripts);
      setSelectedScriptIds((previous) =>
        previous.filter((id) => sortedScripts.some((script) => script.id === id))
      );
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载我的工具失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadScripts();
  }, []);

  const filteredScripts = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) {
      return scripts;
    }
    return scripts.filter((script) =>
      [script.id, script.name, script.description ?? "", script.owner ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  }, [scripts, searchText]);

  const exportScripts = (targetScripts: ScriptDefinition[], successMessage: string) => {
    try {
      const bundle = buildScriptExportBundle(targetScripts);
      downloadJsonFile(formatScriptExportFileName(), bundle);
      messageApi.success(successMessage);
    } catch {
      messageApi.error("导出工具失败");
    }
  };

  const handleExportAll = () => {
    exportScripts(filteredScripts, `已导出 ${filteredScripts.length} 个工具`);
  };

  const handleExportSelected = () => {
    const selectedScripts = scripts.filter((script) => selectedScriptIds.includes(script.id));
    exportScripts(selectedScripts, `已导出 ${selectedScripts.length} 个选中工具`);
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
        messageApi.success(`导入完成，成功处理 ${successes.length} 个工具`);
        return;
      }

      modal.warning({
        title: "导入已完成，部分工具处理失败",
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
        title: "确认导入工具",
        okText: "开始导入",
        cancelText: "取消",
        width: 680,
        content: (
          <div className="script-import-summary">
            <Text>共解析到 {analysis.scripts.length} 个工具。</Text>
            <Text>新增 {analysis.createIds.length} 个，覆盖 {analysis.overwriteIds.length} 个。</Text>
            {analysis.overwriteIds.length > 0 ? (
              <>
                <Text strong>将被覆盖的工具 ID</Text>
                <pre className="script-import-result__code">{overwritePreview.join("\n")}</pre>
              </>
            ) : null}
          </div>
        ),
        onOk: () => runImport(analysis.scripts)
      });
    } catch (error) {
      messageApi.error(getErrorMessage(error, "导入工具失败"));
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
      title: "工具",
      dataIndex: "id",
      key: "id",
      render: (value: string, record) => (
        <Space direction="vertical" size={2}>
          <TableLinkCell to={`/scripts/${value}`}>{record.name || value}</TableLinkCell>
          <Text type="secondary" code>{value}</Text>
        </Space>
      )
    },
    {
      title: "来源",
      key: "scope",
      width: 120,
      render: (_value: unknown, record) => getScopeTag(record)
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
      width: 140,
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
      width: 220,
      render: (_: unknown, record) => (
        <Space size={4} wrap>
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
            disabled={record.status !== "PUBLISHED"}
            onClick={() => navigate(`/run/${record.id}`)}
          >
            运行页
          </Button>
        </Space>
      )
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
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="我的工具"
          meta={<Text type="secondary">这里包含你本机创建的工具和从仓库 Fork 出来的可编辑副本。</Text>}
          actions={
            <>
              <Button icon={<DownloadOutlined />} onClick={handleExportAll} disabled={filteredScripts.length === 0}>
                导出当前列表
              </Button>
              <Button icon={<UploadOutlined />} loading={importing} onClick={() => fileInputRef.current?.click()}>
                导入工具
              </Button>
              <Button icon={<PlusOutlined />} type="primary" onClick={() => navigate("/scripts/new")}>
                新建工具
              </Button>
            </>
          }
        />

        <Card>
          <Space wrap size={[12, 12]} style={{ width: "100%" }}>
            <Input.Search
              allowClear
              placeholder="搜索名称、ID、描述或维护人"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              style={{ minWidth: 220, flex: "1 1 280px" }}
            />
            <Button
              icon={<DownloadOutlined />}
              disabled={selectedScriptIds.length === 0}
              onClick={handleExportSelected}
            >
              导出选中
            </Button>
            <Text type="secondary">共 {filteredScripts.length} 个工具，已选 {selectedScriptIds.length} 个</Text>
          </Space>
        </Card>

        <Card>
          <Table<ScriptDefinition>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={filteredScripts}
            rowSelection={rowSelection}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="还没有个人工具。新建一个，或者从已安装工具中 Fork。"
                />
              )
            }}
          />
        </Card>
      </Space>
    </>
  );
}
