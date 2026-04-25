import {
  DeleteOutlined,
  ForkOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SyncOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  forkRepositoryTool,
  getRepositoryTool,
  listRepositoryTools,
  listScripts,
  uninstallInstalledTool,
  updateRepositoryTool
} from "../api";
import { PageHeader } from "../components/PageHeader";
import { TableLinkCell } from "../components/TableLinkCell";
import type { RepositoryToolDescriptor, ScriptDefinition } from "../types";
import { formatDateTime, getErrorMessage } from "../utils";

const { Text } = Typography;

interface ForkFormValues {
  id: string;
  name: string;
}

export function InstalledToolsPage() {
  const navigate = useNavigate();
  const [forkForm] = Form.useForm<ForkFormValues>();
  const [tools, setTools] = useState<ScriptDefinition[]>([]);
  const [toolDescriptors, setToolDescriptors] = useState<RepositoryToolDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [forkTarget, setForkTarget] = useState<ScriptDefinition | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();

  const loadData = async () => {
    setLoading(true);
    try {
      const [scriptData, descriptorData] = await Promise.all([listScripts(), listRepositoryTools()]);
      setTools(
        scriptData
          .filter((item) => item.scope === "REPOSITORY")
          .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
      );
      setToolDescriptors(descriptorData);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载已安装工具失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const descriptorMap = useMemo(
    () => new Map(toolDescriptors.map((item) => [item.installedScriptId, item])),
    [toolDescriptors]
  );

  const filteredTools = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) {
      return tools;
    }
    return tools.filter((item) => {
      const descriptor = descriptorMap.get(item.id);
      const haystack = [
        item.id,
        item.name,
        item.description ?? "",
        item.owner ?? "",
        descriptor?.repositoryAlias ?? "",
        descriptor?.toolId ?? ""
      ]
        .join(" ")
        .toLowerCase();
      return keyword.split(/\s+/).every((part) => haystack.includes(part));
    });
  }, [descriptorMap, searchText, tools]);

  const openForkModal = (tool: ScriptDefinition) => {
    forkForm.setFieldsValue({
      id: `${tool.repositoryToolId ?? tool.id}-fork`,
      name: `${tool.name} Fork`
    });
    setForkTarget(tool);
  };

  const handleFork = async () => {
    if (!forkTarget) {
      return;
    }
    try {
      const values = await forkForm.validateFields();
      setActionKey(`fork:${forkTarget.id}`);
      const created = await forkRepositoryTool(forkTarget.id, {
        id: values.id.trim(),
        name: values.name.trim()
      });
      setForkTarget(null);
      forkForm.resetFields();
      messageApi.success("Fork 已创建");
      navigate(`/scripts/${created.id}`);
    } catch (error) {
      if (typeof error === "object" && error !== null && "errorFields" in error) {
        return;
      }
      messageApi.error(getErrorMessage(error, "创建 Fork 失败"));
    } finally {
      setActionKey(null);
    }
  };

  const handleUpdate = async (tool: ScriptDefinition) => {
    const descriptor = descriptorMap.get(tool.id);
    if (!descriptor || !tool.repositoryId || !tool.repositoryToolId) {
      messageApi.warning("缺少仓库来源信息，无法更新");
      return;
    }

    let installSchedules = false;
    let scheduleCount = 0;

    try {
      const detail = await getRepositoryTool(tool.repositoryId, tool.repositoryToolId);
      scheduleCount = detail.scheduleTemplate.length;
    } catch {
      scheduleCount = 0;
    }

    await modal.confirm({
      title: "更新已安装工具",
      okText: "更新",
      cancelText: "取消",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>
            将从仓库 <Text code>{descriptor.repositoryAlias}</Text> 更新 <Text code>{tool.id}</Text>。
          </Text>
          {scheduleCount > 0 ? (
            <Checkbox
              onChange={(event) => {
                installSchedules = event.target.checked;
              }}
            >
              同步更新定时任务模板（仍保持默认停用）
            </Checkbox>
          ) : (
            <Text type="secondary">该工具没有额外定时模板可同步。</Text>
          )}
        </Space>
      )
    });

    setActionKey(`update:${tool.id}`);
    try {
      await updateRepositoryTool(tool.repositoryId, tool.repositoryToolId, { installSchedules });
      messageApi.success("工具已更新");
      await loadData();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "更新工具失败"));
    } finally {
      setActionKey(null);
    }
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
      key: "repository",
      width: 180,
      render: (_value: unknown, record) => {
        const descriptor = descriptorMap.get(record.id);
        return (
          <Space direction="vertical" size={2}>
            <Text>{descriptor?.repositoryAlias || record.repositoryId || "-"}</Text>
            <Text type="secondary">{record.repositoryToolId || "-"}</Text>
          </Space>
        );
      }
    },
    {
      title: "版本",
      key: "version",
      width: 180,
      render: (_value: unknown, record) => {
        const descriptor = descriptorMap.get(record.id);
        return (
          <Space direction="vertical" size={2}>
            <Text>本机 {record.repositoryVersion || "-"}</Text>
            {descriptor?.version ? <Text type="secondary">远端 {descriptor.version}</Text> : null}
          </Space>
        );
      }
    },
    {
      title: "状态",
      key: "status",
      width: 140,
      render: (_value: unknown, record) => {
        const descriptor = descriptorMap.get(record.id);
        return (
          <Space direction="vertical" size={2}>
            <Tag color="blue">已安装</Tag>
            {descriptor?.updateAvailable ? <Tag color="processing">可更新</Tag> : null}
          </Space>
        );
      }
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
      width: 300,
      render: (_value: unknown, record) => {
        const descriptor = descriptorMap.get(record.id);
        return (
          <Space wrap size={[4, 4]}>
            <Button size="small" icon={<PlayCircleOutlined />} onClick={() => navigate(`/run/${record.id}`)}>
              运行
            </Button>
            <Button
              size="small"
              icon={<SyncOutlined />}
              disabled={!descriptor?.updateAvailable}
              loading={actionKey === `update:${record.id}`}
              onClick={() => void handleUpdate(record)}
            >
              更新
            </Button>
            <Button
              size="small"
              icon={<ForkOutlined />}
              loading={actionKey === `fork:${record.id}`}
              onClick={() => openForkModal(record)}
            >
              Fork
            </Button>
            <Popconfirm
              title="确认卸载这个工具？"
              description="会删除本机安装记录和仓库只读脚本；不会影响你的 Fork。"
              okText="卸载"
              cancelText="取消"
              onConfirm={async () => {
                setActionKey(`delete:${record.id}`);
                try {
                  await uninstallInstalledTool(record.id);
                  messageApi.success("工具已卸载");
                  await loadData();
                } catch (error) {
                  messageApi.error(getErrorMessage(error, "卸载工具失败"));
                } finally {
                  setActionKey(null);
                }
              }}
            >
              <Button danger size="small" icon={<DeleteOutlined />} loading={actionKey === `delete:${record.id}`}>
                卸载
              </Button>
            </Popconfirm>
          </Space>
        );
      }
    }
  ];

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="已安装工具"
          meta={<Text type="secondary">这里展示已经同步到本机、可直接运行的仓库工具。仓库工具默认只读，修改请 Fork 到“我的工具”。</Text>}
          actions={
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
              刷新
            </Button>
          }
        />

        <Card>
          <Input.Search
            allowClear
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="搜索工具名称、ID、来源仓库或维护人"
          />
        </Card>

        <Card>
          <Table<ScriptDefinition>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={filteredTools}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="还没有已安装工具。先到“发现工具”里安装一个。"
                />
              )
            }}
          />
        </Card>
      </Space>

      <Modal
        title={forkTarget ? `Fork ${forkTarget.name}` : "创建 Fork"}
        open={Boolean(forkTarget)}
        onCancel={() => {
          setForkTarget(null);
          forkForm.resetFields();
        }}
        onOk={() => void handleFork()}
        okText="创建 Fork"
        cancelText="取消"
        confirmLoading={Boolean(forkTarget && actionKey === `fork:${forkTarget.id}`)}
        destroyOnHidden
      >
        <Form form={forkForm} layout="vertical">
          <Form.Item
            label="新工具 ID"
            name="id"
            rules={[
              { required: true, message: "请输入新的工具 ID" },
              { pattern: /^[A-Za-z0-9._-]+$/, message: "仅支持字母、数字、点、中横线和下划线" }
            ]}
          >
            <Input placeholder="例如 clear-cache-fork" />
          </Form.Item>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="例如 清理缓存 Fork" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
