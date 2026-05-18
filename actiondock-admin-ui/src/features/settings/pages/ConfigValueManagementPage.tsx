import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SaveOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import type { ChangeEvent, Key } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  copyConfigValueAsLocalOverride,
  createConfigValue,
  deleteConfigValue,
  getConfigValue,
  listConfigValues,
  restoreConfigValueRepositoryDefault,
  updateConfigValue
} from "../../settings/api";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import { useCopyMessage } from "../../../shared/hooks/useCopyMessage";
import { buildImpactPreview, buildImpactSummary, shouldMaskConfigValue } from "../../../services/configValueInsights";
import { ApiError } from "../../../shared/api/httpClient";
import {
  analyzeConfigValueImport,
  buildConfigValueExportBundle,
  downloadJsonFile,
  formatConfigValueExportFileName,
  parseConfigValueImportBundle
} from "../../../services/scriptTransfer";
import type { ConfigValue, ConfigValueDetail, ConfigValueRequest } from "../../../shared/types";
import { formatDateTime, getErrorMessage } from "../../../services/utils";

const { Paragraph, Text } = Typography;

type DetailTabKey = "overview" | "impact" | "references";

interface ConfigValueFormValues extends ConfigValueRequest {
  preserveValue?: boolean;
}

interface ConfigValueManagementPageProps {
  embedded?: boolean;
}

interface DetailValueFieldState {
  showPreserveValue: boolean;
  valueInputDisabled: boolean;
}

function detailToSummary(detail: ConfigValueDetail): ConfigValue {
  return {
    key: detail.key,
    value: detail.value,
    valueMasked: detail.valueMasked,
    hasValue: detail.hasValue,
    description: detail.description,
    secret: detail.secret,
    repositoryId: detail.repositoryId,
    repositoryScriptId: detail.repositoryScriptId,
    repositoryVersion: detail.repositoryVersion,
    publishMode: detail.publishMode,
    managed: detail.managed,
    overridden: detail.overridden,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt
  };
}

export function buildDetailFormValues(detail: ConfigValueDetail): ConfigValueFormValues {
  return {
    key: detail.key,
    value: detail.secret ? "" : (detail.value ?? ""),
    description: detail.description ?? "",
    secret: detail.secret ?? false,
    preserveValue: Boolean(detail.secret && detail.hasValue)
  };
}

export function buildReferenceItems(key: string) {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return [];
  }
  return [
    { label: "JSON 配置值", value: `\${config.${normalizedKey}}` },
    { label: "Bearer / 前缀拼接", value: `Bearer \${config.${normalizedKey}}` },
    { label: "Groovy 脚本", value: `config["${normalizedKey}"]` },
    { label: "Python 脚本", value: `config.get("${normalizedKey}")` },
    { label: "插件调用参数", value: `plugins.invoke("plugin-id", "action", [token: "\${config.${normalizedKey}}"])` }
  ];
}

export function buildDetailValueFieldState(
  detail: Pick<ConfigValueDetail, "secret" | "hasValue">,
  options: { secret: boolean; preserveValue: boolean; editable: boolean }
): DetailValueFieldState {
  const showPreserveValue = Boolean(options.secret && detail.secret && detail.hasValue);
  return {
    showPreserveValue,
    valueInputDisabled: !options.editable || (showPreserveValue && options.preserveValue)
  };
}

function renderConfigValue(item: Pick<ConfigValue, "secret" | "publishMode" | "hasValue" | "value" | "valueMasked">) {
  if (!shouldMaskConfigValue(item)) {
    return (
      <Paragraph ellipsis={{ rows: 2, expandable: true, symbol: "展开" }} style={{ marginBottom: 0, maxWidth: 420 }}>
        {item.value ?? ""}
      </Paragraph>
    );
  }
  return (
    <Space size={8} wrap>
      {item.secret ? <Tag color="gold">SECRET</Tag> : <Tag color="purple">PLACEHOLDER</Tag>}
      <Text>{item.hasValue ? item.valueMasked ?? "********" : "未设置"}</Text>
    </Space>
  );
}

function renderTags(item: Pick<ConfigValue, "managed" | "overridden" | "publishMode">) {
  return (
    <Space size={[6, 6]} wrap>
      {item.managed ? <Tag color="blue">MANAGED</Tag> : <Tag>LOCAL</Tag>}
      {item.overridden ? <Tag color="orange">OVERRIDDEN</Tag> : null}
      {item.publishMode ? <Tag>{item.publishMode}</Tag> : null}
    </Space>
  );
}

function ConfigValueReferenceCard({
  items,
  onCopy
}: {
  items: Array<{ label: string; value: string }>;
  onCopy: (value: string) => void;
}) {
  return (
    <Card size="small" title="可复制引用">
      {items.length === 0 ? (
        <Text type="secondary">Key 已固定，可在这里复制不同场景的引用片段。</Text>
      ) : (
        <List
          dataSource={items}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button key={item.label} size="small" icon={<CopyOutlined />} onClick={() => onCopy(item.value)}>
                  复制
                </Button>
              ]}
            >
              <Space direction="vertical" size={2} style={{ width: "100%" }}>
                <Text strong>{item.label}</Text>
                <Text code>{item.value}</Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}

export function ConfigValueManagementPage({ embedded = false }: ConfigValueManagementPageProps) {
  const [createForm] = Form.useForm<ConfigValueFormValues>();
  const [detailForm] = Form.useForm<ConfigValueFormValues>();
  const watchedCreateKey = Form.useWatch("key", createForm);
  const watchedCreateSecret = Form.useWatch("secret", createForm) ?? false;
  const watchedDetailKey = Form.useWatch("key", detailForm);
  const watchedDetailSecret = Form.useWatch("secret", detailForm) ?? false;
  const watchedDetailPreserveValue = Form.useWatch("preserveValue", detailForm) ?? false;
  const [items, setItems] = useState<ConfigValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailActionKey, setDetailActionKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConfigValueDetail | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTabKey>("overview");
  const [detailDirty, setDetailDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const handleCopy = useCopyMessage(messageApi);

  const upsertItem = (nextItem: ConfigValue) => {
    setItems((previous) => {
      const hasExisting = previous.some((item) => item.key === nextItem.key);
      const next = hasExisting
        ? previous.map((item) => (item.key === nextItem.key ? nextItem : item))
        : [...previous, nextItem];
      return [...next].sort((left, right) => left.key.localeCompare(right.key));
    });
  };

  const applyDetailToForm = (source: ConfigValueDetail) => {
    detailForm.resetFields();
    detailForm.setFieldsValue(buildDetailFormValues(source));
    setDetailDirty(false);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await listConfigValues();
      setItems(data);
      setSelectedKeys((previous) => previous.filter((key) => data.some((item) => item.key === key)));
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载配置值失败"));
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (key: string): Promise<ConfigValueDetail> => {
    setDetailLoading(true);
    setDetailKey(key);
    try {
      const data = await getConfigValue(key);
      setDetail(data);
      applyDetailToForm(data);
      upsertItem(detailToSummary(data));
      return data;
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) {
      return items;
    }
    return items.filter((item) =>
      [
        item.key,
        item.description ?? "",
        item.value ?? "",
        item.valueMasked ?? "",
        item.repositoryId ?? "",
        item.repositoryScriptId ?? ""
      ].some((field) => field.toLowerCase().includes(keyword))
    );
  }, [items, searchText]);

  const createReferenceItems = useMemo(
    () => buildReferenceItems(typeof watchedCreateKey === "string" ? watchedCreateKey : ""),
    [watchedCreateKey]
  );
  const detailReferenceItems = useMemo(
    () => buildReferenceItems(typeof watchedDetailKey === "string" ? watchedDetailKey : ""),
    [watchedDetailKey]
  );
  const detailEditable = Boolean(detail && (!detail.managed || detail.overridden));
  const detailValueFieldState = useMemo(
    () => detail
      ? buildDetailValueFieldState(detail, {
        secret: watchedDetailSecret,
        preserveValue: watchedDetailPreserveValue,
        editable: detailEditable
      })
      : { showPreserveValue: false, valueInputDisabled: true },
    [detail, detailEditable, watchedDetailPreserveValue, watchedDetailSecret]
  );

  const confirmDiscardDetailChanges = async (title: string, content: string): Promise<boolean> => {
    if (!detailDirty) {
      return true;
    }
    let confirmed = false;
    await modal.confirm({
      title,
      okText: "放弃修改",
      cancelText: "继续编辑",
      content: <Text>{content}</Text>,
      onOk: () => {
        confirmed = true;
      }
    });
    return confirmed;
  };

  const openCreate = () => {
    createForm.setFieldsValue({
      key: "",
      value: "",
      description: "",
      secret: false,
      preserveValue: false
    });
    setCreateOpen(true);
  };

  const openDetail = async (key: string) => {
    if (detailKey && detailKey !== key) {
      const confirmed = await confirmDiscardDetailChanges(
        "切换配置值会放弃当前未保存修改",
        "当前详情中的表单修改不会保留。"
      );
      if (!confirmed) {
        return;
      }
    }

    try {
      setDetailTab("overview");
      await loadDetail(key);
    } catch (error) {
      setDetailKey(null);
      setDetail(null);
      detailForm.resetFields();
      setDetailDirty(false);
      messageApi.error(getErrorMessage(error, "加载配置值详情失败"));
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    createForm.resetFields();
  };

  const closeDetail = async () => {
    const confirmed = await confirmDiscardDetailChanges(
      "放弃当前未保存修改？",
      "关闭详情后，当前修改不会保留。"
    );
    if (!confirmed) {
      return;
    }
    setDetailKey(null);
    setDetail(null);
    setDetailTab("overview");
    detailForm.resetFields();
    setDetailDirty(false);
  };

  const confirmSaveImpact = async (targetDetail: ConfigValueDetail): Promise<boolean> => {
    const summary = buildImpactSummary(targetDetail);
    const preview = buildImpactPreview(targetDetail);
    let confirmed = false;
    await modal.confirm({
      title: "确认更新配置值",
      okText: "继续保存",
      cancelText: "取消",
      width: 700,
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>本次修改会影响以下运行链路：</Text>
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            {summary.map((line) => <Text key={line}>{line}</Text>)}
          </Space>
          {preview.length > 0 ? (
            <>
              <Text strong>受影响脚本预览</Text>
              <pre className="script-import-result__code">{preview.join("\n")}</pre>
            </>
          ) : null}
        </Space>
      ),
      onOk: () => {
        confirmed = true;
      }
    });
    return confirmed;
  };

  const handleCreateSubmit = async () => {
    try {
      const values = await createForm.validateFields();
      const payload: ConfigValueRequest = {
        key: values.key.trim(),
        value: values.value ?? "",
        description: values.description?.trim() || undefined,
        secret: Boolean(values.secret),
        preserveValue: Boolean(values.preserveValue)
      };

      setSaving(true);
      const saved = await createConfigValue(payload);
      upsertItem(saved);
      closeCreate();
      messageApi.success("配置值已创建");
    } catch (error) {
      if (error instanceof ApiError) {
        messageApi.error(error.message);
      } else if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      } else {
        messageApi.error(getErrorMessage(error, "保存配置值失败"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDetailSubmit = async () => {
    if (!detailKey || !detailEditable) {
      return;
    }

    try {
      const values = await detailForm.validateFields();
      const payload: ConfigValueRequest = {
        key: values.key?.trim() ?? detailKey,
        value: values.value ?? "",
        description: values.description?.trim() || undefined,
        secret: Boolean(values.secret),
        preserveValue: Boolean(detailForm.getFieldValue("preserveValue"))
      };

      const currentDetail = detail?.key === detailKey ? detail : await getConfigValue(detailKey);
      if (
        currentDetail.impactedScripts.length > 0 ||
        currentDetail.usage.scheduleReferences.length > 0 ||
        currentDetail.usage.pluginConfigReferences.length > 0 ||
        currentDetail.usage.configReferences.length > 0
      ) {
        const confirmed = await confirmSaveImpact(currentDetail);
        if (!confirmed) {
          return;
        }
      }

      setSaving(true);
      const saved = await updateConfigValue(detailKey, payload);
      upsertItem(saved);
      messageApi.success("配置值已更新");
      await loadDetail(saved.key);
    } catch (error) {
      if (error instanceof ApiError) {
        messageApi.error(error.message);
      } else if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      } else {
        messageApi.error(getErrorMessage(error, "保存配置值失败"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleResetDetailDraft = () => {
    if (!detail) {
      return;
    }
    applyDetailToForm(detail);
  };

  const confirmDelete = async (key: string) => {
    try {
      setDetailActionKey(key);
      const currentDetail = detail?.key === key ? detail : await getConfigValue(key);
      const summary = buildImpactSummary(currentDetail);
      const preview = buildImpactPreview(currentDetail);
      await modal.confirm({
        title: "确认删除这个配置值？",
        okText: "删除",
        okButtonProps: { danger: true },
        cancelText: "取消",
        width: 700,
        content: (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Text>删除后，引用该 key 的脚本、调度和插件配置可能在运行时失败。</Text>
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              {summary.map((line) => <Text key={line}>{line}</Text>)}
            </Space>
            {preview.length > 0 ? (
              <>
                <Text strong>受影响脚本预览</Text>
                <pre className="script-import-result__code">{preview.join("\n")}</pre>
              </>
            ) : null}
            {currentDetail.managed ? (
              <Text type="secondary">这是托管配置值。删除后，下次脚本安装或更新时可能被仓库模板重新同步。</Text>
            ) : null}
          </Space>
        ),
        onOk: async () => {
          await deleteConfigValue(key);
          setItems((previous) => previous.filter((item) => item.key !== key));
          if (detailKey === key) {
            setDetailKey(null);
            setDetail(null);
            setDetailTab("overview");
            detailForm.resetFields();
            setDetailDirty(false);
          }
          messageApi.success("配置值已删除");
        }
      });
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除配置值失败"));
    } finally {
      setDetailActionKey(null);
    }
  };

  const handleCopyLocalOverride = async () => {
    if (!detail) {
      return;
    }
    const confirmed = await confirmDiscardDetailChanges(
      "复制为本地覆盖值会刷新当前详情",
      "当前未保存修改不会保留。"
    );
    if (!confirmed) {
      return;
    }
    setDetailActionKey(detail.key);
    try {
      const nextDetail = await copyConfigValueAsLocalOverride(detail.key);
      setDetail(nextDetail);
      applyDetailToForm(nextDetail);
      upsertItem(detailToSummary(nextDetail));
      setDetailTab("overview");
      messageApi.success("已复制为本地覆盖值");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "复制为本地覆盖值失败"));
    } finally {
      setDetailActionKey(null);
    }
  };

  const handleRestoreRepositoryDefault = async () => {
    if (!detail) {
      return;
    }
    const confirmed = await confirmDiscardDetailChanges(
      "恢复仓库默认值会刷新当前详情",
      "当前未保存修改不会保留。"
    );
    if (!confirmed) {
      return;
    }
    setDetailActionKey(detail.key);
    try {
      const nextDetail = await restoreConfigValueRepositoryDefault(detail.key);
      setDetail(nextDetail);
      applyDetailToForm(nextDetail);
      upsertItem(detailToSummary(nextDetail));
      setDetailTab("overview");
      messageApi.success("已恢复仓库默认值");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "恢复仓库默认值失败"));
    } finally {
      setDetailActionKey(null);
    }
  };

  const exportConfigValues = (targetItems: ConfigValue[], successMessage: string, includeSecretValues: boolean) => {
    try {
      const bundle = buildConfigValueExportBundle(targetItems, { includeSecretValues });
      downloadJsonFile(formatConfigValueExportFileName(), bundle);
      messageApi.success(successMessage);
    } catch {
      messageApi.error("导出配置值失败");
    }
  };

  const confirmExport = async (targetItems: ConfigValue[], successMessage: string) => {
    const hasSecretItems = targetItems.some((item) => item.secret);
    if (!hasSecretItems) {
      exportConfigValues(targetItems, successMessage, true);
      return;
    }
    let includeSecretValues = true;
    await modal.confirm({
      title: "导出配置值",
      okText: "导出",
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>已选配置值中包含 Secret。默认会导出明文值，适合完整备份。</Text>
          <Checkbox defaultChecked={true} onChange={(event) => { includeSecretValues = event.target.checked; }}>
            包含 Secret 明文
          </Checkbox>
        </Space>
      ),
      onOk: () => exportConfigValues(targetItems, successMessage, includeSecretValues)
    });
  };

  const handleExportAll = () => {
    void confirmExport(items, `已导出 ${items.length} 个配置值`);
  };

  const handleExportSelected = () => {
    const selectedItems = items.filter((item) => selectedKeys.includes(item.key));
    void confirmExport(selectedItems, `已导出 ${selectedItems.length} 个选中配置值`);
  };

  const runImport = async (importedItems: ConfigValue[]) => {
    setImporting(true);
    const currentKeys = new Set(items.map((item) => item.key));
    const successes: string[] = [];
    const failures: Array<{ key: string; reason: string }> = [];

    try {
      for (const item of importedItems) {
        const payload: ConfigValueRequest = {
          key: item.key,
          value: item.value ?? "",
          description: item.description,
          secret: item.secret,
          preserveValue: Boolean(item.secret && item.value == null && currentKeys.has(item.key))
        };
        try {
          if (currentKeys.has(item.key)) {
            await updateConfigValue(item.key, payload);
          } else {
            await createConfigValue(payload);
            currentKeys.add(item.key);
          }
          successes.push(item.key);
        } catch (error) {
          failures.push({ key: item.key, reason: error instanceof ApiError ? error.message : "导入失败" });
        }
      }

      if (successes.length > 0) {
        await loadData();
      }

      if (failures.length === 0) {
        messageApi.success(`导入完成，成功处理 ${successes.length} 个配置值`);
        return;
      }

      modal.warning({
        title: "导入已完成，部分配置值处理失败",
        width: 640,
        content: (
          <div className="script-import-result">
            <Text>成功 {successes.length} 条，失败 {failures.length} 条。</Text>
            <pre className="script-import-result__code">
              {failures.slice(0, 10).map((item) => `${item.key}: ${item.reason}`).join("\n")}
            </pre>
            {failures.length > 10 ? <Text type="secondary">仅展示前 10 条失败明细。</Text> : null}
          </div>
        )
      });
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const importedItems = parseConfigValueImportBundle(await file.text());
      const analysis = analyzeConfigValueImport(importedItems, items);
      const overwritePreview = analysis.overwriteKeys.slice(0, 10);
      await modal.confirm({
        title: "确认导入配置值",
        okText: "开始导入",
        cancelText: "取消",
        width: 680,
        content: (
          <div className="script-import-summary">
            <Text>共解析到 {analysis.configValues.length} 个配置值。</Text>
            <Text>新增 {analysis.createKeys.length} 个，覆盖 {analysis.overwriteKeys.length} 个。</Text>
            {analysis.overwriteKeys.length > 0 ? (
              <>
                <Text strong>将被覆盖的配置值 key</Text>
                <pre className="script-import-result__code">{overwritePreview.join("\n")}</pre>
                {analysis.overwriteKeys.length > overwritePreview.length ? (
                  <Text type="secondary">
                    仅展示前 {overwritePreview.length} 个，剩余 {analysis.overwriteKeys.length - overwritePreview.length} 个将在导入时一并覆盖。
                  </Text>
                ) : null}
              </>
            ) : null}
          </div>
        ),
        onOk: () => runImport(analysis.configValues)
      });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "导入配置值失败");
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

  const rowSelection: TableRowSelection<ConfigValue> = {
    selectedRowKeys: selectedKeys,
    onChange: (nextSelectedRowKeys) => setSelectedKeys(nextSelectedRowKeys),
    preserveSelectedRowKeys: true
  };

  const columns: ColumnsType<ConfigValue> = [
    {
      title: "Key",
      dataIndex: "key",
      key: "key",
      width: 260,
      render: (value: string, record) => (
        <TableLinkCell onClick={() => void openDetail(record.key)}>
          {value}
        </TableLinkCell>
      )
    },
    {
      title: "值",
      dataIndex: "value",
      key: "value",
      render: (_value, record) => renderConfigValue(record)
    },
    {
      title: "状态",
      key: "state",
      width: 220,
      render: (_value, record) => renderTags(record)
    },
    {
      title: "说明",
      dataIndex: "description",
      key: "description",
      render: (value?: string) => value ? <Text>{value}</Text> : <Text type="secondary">未填写</Text>
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
      width: 120,
      render: (_value, record) => (
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          loading={detailActionKey === record.key}
          onClick={() => void confirmDelete(record.key)}
        >
          删除
        </Button>
      )
    }
  ];

  const actions = (
    <Space wrap>
      <Input.Search
        allowClear
        placeholder="按 key / 说明 / 值 / 来源搜索"
        style={{ width: 320 }}
        value={searchText}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
      />
      <Button icon={<UploadOutlined />} loading={importing} onClick={() => fileInputRef.current?.click()}>
        导入配置值
      </Button>
      <Button icon={<DownloadOutlined />} disabled={loading || importing || items.length === 0} onClick={handleExportAll}>
        导出全部
      </Button>
      <Button
        icon={<DownloadOutlined />}
        type="primary"
        ghost
        disabled={loading || importing || selectedKeys.length === 0}
        onClick={handleExportSelected}
      >
        导出选中
      </Button>
      <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
        刷新
      </Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
        新建配置值
      </Button>
    </Space>
  );

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
        {!embedded ? (
          <PageHeader
            title="配置值管理"
            meta="平台全局字符串配置值，可被脚本、插件、调度和调试参数复用。"
            actions={actions}
          />
        ) : null}
        <Card title={embedded ? "配置值" : undefined} extra={embedded ? actions : undefined}>
          {filteredItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={items.length === 0 ? "当前没有配置值" : "没有匹配结果"} />
          ) : (
            <Table
              rowKey="key"
              loading={loading || importing}
              rowSelection={rowSelection}
              columns={columns}
              dataSource={filteredItems}
              pagination={{ pageSize: 10, responsive: true }}
              scroll={{ x: 1280 }}
            />
          )}
        </Card>
      </Space>

      <Drawer
        title="新建配置值"
        width={560}
        open={createOpen}
        onClose={closeCreate}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={closeCreate}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleCreateSubmit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            label="Key"
            name="key"
            rules={[
              { required: true, message: "请输入 key" },
              { pattern: /^[A-Za-z][A-Za-z0-9_.-]*$/, message: "仅支持字母开头，后续可包含字母、数字、点、下划线和中划线" }
            ]}
            extra="创建后不支持修改，引用格式为 ${config.key}。"
          >
            <Input placeholder="openai.api_key" />
          </Form.Item>
          <Form.Item
            label="值"
            name="value"
            rules={[{
              validator: async (_, value) => {
                const secret = Boolean(createForm.getFieldValue("secret"));
                const preserveValue = Boolean(createForm.getFieldValue("preserveValue"));
                if (secret && preserveValue) {
                  return;
                }
                if (typeof value === "string" && value.length > 0) {
                  return;
                }
                throw new Error("请输入配置值");
              }
            }]}
            extra="支持在值内继续引用其他配置值，例如 https://host/${config.region}/v1。"
          >
            <Input.TextArea rows={6} placeholder="sk-..." />
          </Form.Item>
          <Form.Item label="高级选项" style={{ marginBottom: 12 }}>
            <Space direction="vertical" size={8}>
              <Form.Item name="secret" valuePropName="checked" noStyle>
                <Checkbox onChange={(event) => { if (!event.target.checked) createForm.setFieldValue("preserveValue", false); }}>
                  作为 Secret 管理
                </Checkbox>
              </Form.Item>
              <Text type="secondary">
                Secret 值不会在列表和详情页中明文回显，但运行时仍可通过 {"${config.key}"} 引用。
              </Text>
              {watchedCreateSecret ? (
                <Form.Item name="preserveValue" valuePropName="checked" noStyle>
                  <Checkbox disabled>新建时无需保留现值</Checkbox>
                </Form.Item>
              ) : null}
            </Space>
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={3} placeholder="这个值会被哪些脚本或插件复用" />
          </Form.Item>
        </Form>

        <Card size="small" title="可复制引用" style={{ marginTop: 16 }}>
          {createReferenceItems.length === 0 ? (
            <Text type="secondary">先填写 Key，这里会自动生成不同场景可直接复制的引用片段。</Text>
          ) : (
            <List
              dataSource={createReferenceItems}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button key={item.label} size="small" icon={<CopyOutlined />} onClick={() => void handleCopy(item.value)}>
                      复制
                    </Button>
                  ]}
                >
                  <Space direction="vertical" size={2} style={{ width: "100%" }}>
                    <Text strong>{item.label}</Text>
                    <Text code>{item.value}</Text>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Card>
      </Drawer>

      <Drawer
        title="配置值详情"
        width={860}
        open={Boolean(detailKey)}
        onClose={() => void closeDetail()}
        destroyOnClose
        extra={
          detail ? (
            <Space wrap>
              {detail.availableActions.canCopyAsLocalOverride ? (
                <Button
                  icon={<CopyOutlined />}
                  loading={detailActionKey === detail.key}
                  onClick={() => void handleCopyLocalOverride()}
                >
                  复制为本地覆盖值
                </Button>
              ) : null}
              {detail.availableActions.canRestoreRepositoryDefault ? (
                <Button
                  icon={<RollbackOutlined />}
                  loading={detailActionKey === detail.key}
                  onClick={() => void handleRestoreRepositoryDefault()}
                >
                  恢复仓库默认值
                </Button>
              ) : null}
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={detailActionKey === detail.key}
                onClick={() => void confirmDelete(detail.key)}
              >
                删除
              </Button>
            </Space>
          ) : null
        }
      >
        {detailLoading || !detail ? (
          <Card loading={true} />
        ) : (
          <Tabs
            activeKey={detailTab}
            onChange={(key) => setDetailTab(key as DetailTabKey)}
            items={[
              {
                key: "overview",
                label: "概览",
                children: (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Card
                      size="small"
                      title={<Space wrap><Text code>{detail.key}</Text>{renderTags(detail)}</Space>}
                      extra={detailEditable ? (
                        <Space wrap>
                          <Button onClick={handleResetDetailDraft} disabled={!detailDirty}>
                            重置修改
                          </Button>
                          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleDetailSubmit()}>
                            保存修改
                          </Button>
                        </Space>
                      ) : null}
                      >
                      <Descriptions column={1} size="small">
                        <Descriptions.Item label="来源">
                          {detail.origin ? (
                            <Space wrap>
                              <Text>{detail.origin.repositoryName || detail.origin.repositoryId || "-"}</Text>
                              <Text type="secondary">/</Text>
                              <Text>{detail.origin.scriptName || detail.origin.repositoryScriptId || "-"}</Text>
                              <Text type="secondary">/</Text>
                              <Text>{detail.origin.version || detail.repositoryVersion || "-"}</Text>
                            </Space>
                          ) : (
                            <Text type="secondary">本地配置值</Text>
                          )}
                        </Descriptions.Item>
                        <Descriptions.Item label="更新时间">{formatDateTime(detail.updatedAt)}</Descriptions.Item>
                      </Descriptions>
                    </Card>

                    {detail.managed && !detail.overridden ? (
                      <Alert
                        type="info"
                        showIcon
                        message="这是托管配置值"
                        description="若要修改值，请先执行“复制为本地覆盖值”。当前概览页仍可查看影响和引用，但表单保持只读。"
                      />
                    ) : null}

                    <Card size="small" title="编辑配置">
                      <Form
                        form={detailForm}
                        layout="vertical"
                        onValuesChange={() => {
                          if (!detailDirty) {
                            setDetailDirty(true);
                          }
                        }}
                      >
                        <Form.Item
                          label="Key"
                          name="key"
                          rules={[
                            { required: true, message: "请输入 key" },
                            { pattern: /^[A-Za-z][A-Za-z0-9_.-]*$/, message: "仅支持字母开头，后续可包含字母、数字、点、下划线和中划线" }
                          ]}
                          extra="已有配置值的 Key 不可修改。"
                        >
                          <Input disabled />
                        </Form.Item>
                        <Form.Item
                          label="值"
                          extra="支持在值内继续引用其他配置值，例如 https://host/${config.region}/v1。"
                        >
                          <Space direction="vertical" size={8} style={{ width: "100%" }}>
                            {detailValueFieldState.showPreserveValue ? (
                              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                <Form.Item name="preserveValue" valuePropName="checked" noStyle>
                                  <Checkbox
                                    disabled={!detailEditable}
                                    onChange={(event) => {
                                      if (event.target.checked) {
                                        detailForm.setFieldValue("value", "");
                                      }
                                    }}
                                  >
                                    保留现值
                                  </Checkbox>
                                </Form.Item>
                              </div>
                            ) : null}
                            <Form.Item
                              name="value"
                              noStyle
                              rules={[{
                                validator: async (_, value) => {
                                  const secret = Boolean(detailForm.getFieldValue("secret"));
                                  const preserveValue = Boolean(detailForm.getFieldValue("preserveValue"));
                                  if (secret && preserveValue) {
                                    return;
                                  }
                                  if (typeof value === "string" && value.length > 0) {
                                    return;
                                  }
                                  throw new Error("请输入配置值");
                                }
                              }]}
                            >
                              <Input.TextArea
                                rows={6}
                                placeholder="sk-..."
                                disabled={detailValueFieldState.valueInputDisabled}
                              />
                            </Form.Item>
                          </Space>
                        </Form.Item>
                        <Form.Item label="高级选项" style={{ marginBottom: 12 }}>
                          <Space direction="vertical" size={8}>
                            <Form.Item name="secret" valuePropName="checked" noStyle>
                              <Checkbox
                                disabled={!detailEditable}
                                onChange={(event) => { if (!event.target.checked) detailForm.setFieldValue("preserveValue", false); }}
                              >
                                作为 Secret 管理
                              </Checkbox>
                            </Form.Item>
                            <Text type="secondary">
                              Secret 值不会在列表和详情页中明文回显，但运行时仍可通过 {"${config.key}"} 引用。
                            </Text>
                          </Space>
                        </Form.Item>
                        <Form.Item label="说明" name="description">
                          <Input.TextArea rows={3} placeholder="这个值会被哪些脚本或插件复用" disabled={!detailEditable} />
                        </Form.Item>
                      </Form>
                    </Card>

                    <ConfigValueReferenceCard
                      items={detailReferenceItems}
                      onCopy={(value) => {
                        void handleCopy(value);
                      }}
                    />
                  </Space>
                )
              },
              {
                key: "impact",
                label: "影响范围",
                children: (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Card size="small" title="影响摘要">
                      <Space direction="vertical" size={6} style={{ width: "100%" }}>
                        {buildImpactSummary(detail).map((line) => <Text key={line}>{line}</Text>)}
                      </Space>
                    </Card>

                    <Card size="small" title={`受影响脚本 (${detail.impactedScripts.length})`}>
                      {detail.impactedScripts.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前未发现受影响脚本" />
                      ) : (
                        <List
                          size="small"
                          dataSource={detail.impactedScripts}
                          renderItem={(item) => (
                            <List.Item>
                              <Space direction="vertical" size={2} style={{ width: "100%" }}>
                                <Space wrap>
                                  <Text code>{item.scriptId}</Text>
                                  <Text>{item.scriptName}</Text>
                                  {item.scope ? <Tag>{item.scope}</Tag> : null}
                                </Space>
                                <Text type="secondary">{item.reasons.join("；")}</Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      )}
                    </Card>

                    <Card size="small" title={`直接脚本引用 (${detail.usage.scriptReferences.length})`}>
                      {detail.usage.scriptReferences.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有脚本直接引用这个 key" />
                      ) : (
                        <List
                          size="small"
                          dataSource={detail.usage.scriptReferences}
                          renderItem={(item) => (
                            <List.Item>
                              <Space direction="vertical" size={2} style={{ width: "100%" }}>
                                <Space wrap>
                                  <Text code>{item.scriptId}</Text>
                                  <Text>{item.scriptName}</Text>
                                  {item.scope ? <Tag>{item.scope}</Tag> : null}
                                </Space>
                              </Space>
                            </List.Item>
                          )}
                        />
                      )}
                    </Card>

                    <Card size="small" title={`定时任务引用 (${detail.usage.scheduleReferences.length})`}>
                      {detail.usage.scheduleReferences.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有定时任务引用这个 key" />
                      ) : (
                        <List
                          size="small"
                          dataSource={detail.usage.scheduleReferences}
                          renderItem={(item) => (
                            <List.Item>
                              <Text>{item.scheduleName} / {item.scriptName}</Text>
                            </List.Item>
                          )}
                        />
                      )}
                    </Card>
                  </Space>
                )
              },
              {
                key: "references",
                label: "引用明细",
                children: (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Card size="small" title={`仓库模板声明 (${detail.usage.templateDeclarations.length})`}>
                      {detail.usage.templateDeclarations.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有仓库脚本模板声明这个 key" />
                      ) : (
                        <List
                          size="small"
                          dataSource={detail.usage.templateDeclarations}
                          renderItem={(item) => (
                            <List.Item>
                              <Space direction="vertical" size={2} style={{ width: "100%" }}>
                                <Space wrap>
                                  <Text>{item.repositoryName || item.repositoryId}</Text>
                                  <Text type="secondary">/</Text>
                                  <Text>{item.scriptName}</Text>
                                  <Text type="secondary">{item.version || "-"}</Text>
                                </Space>
                                <Space wrap>
                                  {item.label ? <Text type="secondary">{item.label}</Text> : null}
                                  {item.secret ? <Tag color="gold">SECRET</Tag> : null}
                                  <Tag>{item.publishMode}</Tag>
                                </Space>
                              </Space>
                            </List.Item>
                          )}
                        />
                      )}
                    </Card>

                    <Card size="small" title={`插件配置引用 (${detail.usage.pluginConfigReferences.length})`}>
                      {detail.usage.pluginConfigReferences.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有插件配置引用这个 key" />
                      ) : (
                        <List
                          size="small"
                          dataSource={detail.usage.pluginConfigReferences}
                          renderItem={(item) => (
                            <List.Item>
                              <Space direction="vertical" size={2} style={{ width: "100%" }}>
                                <Text>{item.pluginName} ({item.pluginId})</Text>
                                <Text type="secondary">依赖脚本 {item.dependentScriptCount} 个</Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      )}
                    </Card>

                    <Card size="small" title={`配置值依赖 (${detail.usage.configReferences.length})`}>
                      {detail.usage.configReferences.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有其他配置值依赖这个 key" />
                      ) : (
                        <List
                          size="small"
                          dataSource={detail.usage.configReferences}
                          renderItem={(item) => (
                            <List.Item>
                              <Space direction="vertical" size={2}>
                                <Text code>{item.key}</Text>
                                {item.description ? <Text type="secondary">{item.description}</Text> : null}
                              </Space>
                            </List.Item>
                          )}
                        />
                      )}
                    </Card>

                    <Card size="small" title={`模型引用 (${detail.usage.modelReferences.length})`}>
                      {detail.usage.modelReferences.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有模型引用这个 key" />
                      ) : (
                        <List
                          size="small"
                          dataSource={detail.usage.modelReferences}
                          renderItem={(item) => (
                            <List.Item>
                              <Space>
                                <Text>{item.modelName}</Text>
                                {item.modelProvider ? <Tag>{item.modelProvider}</Tag> : null}
                                <Tag color="blue">{item.referenceType === "apiKeyConfigKey" ? "API Key" : "默认选项"}</Tag>
                              </Space>
                            </List.Item>
                          )}
                        />
                      )}
                    </Card>
                  </Space>
                )
              }
            ]}
          />
        )}
      </Drawer>
    </>
  );
}
