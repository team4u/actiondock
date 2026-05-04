import {
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  ScanOutlined,
  StopOutlined,
  UndoOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createSkillTarget,
  deleteSkill,
  deleteSkillTarget,
  disableSkill,
  listSkillTargets,
  listSkills,
  restoreSkill,
  updateSkillTarget
} from "../api";
import { PageHeader } from "../components/PageHeader";
import { TableLinkCell } from "../components/TableLinkCell";
import type { SkillInstallation, SkillTarget } from "../types";
import { getErrorMessage } from "../utils";

const { Text } = Typography;

function buildSkillTargetPathTemplate(type?: string): string {
  const normalizedType = (type || "").trim().toUpperCase();
  if (!normalizedType || normalizedType === "CUSTOM") {
    return "";
  }
  return `~/.${normalizedType.toLowerCase()}/skills`;
}

function buildSkillTargetName(type?: string): string {
  return (type || "").trim().toLowerCase();
}

interface TargetFormValues {
  id?: string;
  name: string;
  type: string;
  rootPath: string;
  enabled: boolean;
}

export function SkillManagementPage() {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<SkillInstallation[]>([]);
  const [targets, setTargets] = useState<SkillTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTarget, setSavingTarget] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const [form] = Form.useForm<TargetFormValues>();
  const [editingTarget, setEditingTarget] = useState<SkillTarget | null>(null);
  const [targetDrawerOpen, setTargetDrawerOpen] = useState(false);

  const applyTypeTemplate = (nextType: string) => {
    const nextTemplate = buildSkillTargetPathTemplate(nextType);
    form.setFieldsValue({
      type: nextType,
      name: buildSkillTargetName(nextType),
      rootPath: nextTemplate
    });
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [installationData, targetData] = await Promise.all([listSkills(), listSkillTargets()]);
      setSkills(installationData);
      setTargets(targetData);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载 Skill 管理数据失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const targetColumns: ColumnsType<SkillTarget> = [
    { title: "名称", dataIndex: "name", key: "name" },
    { title: "类型", dataIndex: "type", key: "type", width: 140 },
    {
      title: "目录",
      dataIndex: "rootPath",
      key: "rootPath",
      render: (value: string) => <Text code>{value}</Text>
    },
    {
      title: "状态",
      key: "state",
      render: (_value, record) => (
        <Space wrap size={[4, 4]}>
          {record.enabled ? <Tag color="processing">启用</Tag> : <Tag>停用</Tag>}
          {record.writable ? <Tag color="success">可写</Tag> : <Tag color="warning">不可写</Tag>}
        </Space>
      )
    },
    {
      title: "操作",
      key: "actions",
      render: (_value, record) => (
        <Space wrap>
          <Button size="small" onClick={() => openEditTarget(record)}>编辑</Button>
          <Button size="small" icon={<ScanOutlined />} onClick={() => navigate(`/skills/scan/${encodeURIComponent(record.id)}`)}>
            扫描
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => void handleDeleteTarget(record)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const skillColumns: ColumnsType<SkillInstallation> = [
    {
      title: "Skill",
      key: "skill",
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <TableLinkCell to={`/skills/${encodeURIComponent(record.installationId)}`}>
            <Text strong>{record.displayName || record.skillId}</Text>
          </TableLinkCell>
          <Text type="secondary" code>{record.skillId}</Text>
        </Space>
      )
    },
    { title: "版本", dataIndex: "version", key: "version", width: 120 },
    {
      title: "目标",
      key: "target",
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.targetId}</Text>
          <Text type="secondary" code>{record.targetPath}</Text>
        </Space>
      )
    },
    {
      title: "安装路径",
      dataIndex: "installedPath",
      key: "installedPath",
      render: (value: string) => <Text code>{value}</Text>
    },
    {
      title: "状态",
      key: "status",
      render: (_value, record) => (
        <Space wrap size={[4, 4]}>
          {record.enabled ? <Tag color="processing">启用</Tag> : <Tag color="default">停用</Tag>}
          {record.repositoryId ? <Tag>{record.repositoryId}</Tag> : <Tag>本地导入</Tag>}
        </Space>
      )
    },
    {
      title: "操作",
      key: "actions",
      render: (_value, record) => (
        <Space wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/skills/${encodeURIComponent(record.installationId)}`)}>
            详情
          </Button>
          <Button
            size="small"
            icon={record.enabled ? <StopOutlined /> : <UndoOutlined />}
            onClick={() => void (record.enabled ? handleDisableSkill(record) : handleRestoreSkill(record))}
          >
            {record.enabled ? "停用" : "恢复"}
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => void handleDeleteSkill(record)}
          >
            卸载
          </Button>
        </Space>
      )
    }
  ];

  const openCreateTarget = () => {
    setEditingTarget(null);
    form.setFieldsValue({
      name: buildSkillTargetName("CLAUDE"),
      type: "CLAUDE",
      rootPath: buildSkillTargetPathTemplate("CLAUDE"),
      enabled: true
    });
    setTargetDrawerOpen(true);
  };

  const openEditTarget = (target: SkillTarget) => {
    setEditingTarget(target);
    form.setFieldsValue({
      id: target.id,
      name: target.name,
      type: target.type,
      rootPath: target.rootPath,
      enabled: target.enabled
    });
    setTargetDrawerOpen(true);
  };

  const handleSaveTarget = async () => {
    const values = await form.validateFields();
    setSavingTarget(true);
    try {
      if (editingTarget) {
        await updateSkillTarget(editingTarget.id, {
          ...editingTarget,
          ...values,
          writable: editingTarget.writable
        });
      } else {
        await createSkillTarget({
          id: "",
          writable: true,
          createdAt: undefined,
          updatedAt: undefined,
          ...values
        });
      }
      setTargetDrawerOpen(false);
      await loadData();
      messageApi.success("SkillTarget 已保存");
    } catch (error) {
      messageApi.error(getErrorMessage(error, "保存 SkillTarget 失败"));
    } finally {
      setSavingTarget(false);
    }
  };

  const handleDeleteTarget = async (target: SkillTarget) => {
    await modal.confirm({
      title: `删除目标 ${target.name}？`,
      content: "仅当目标目录下没有受管 Skill 时才允许删除。",
      onOk: async () => {
        await deleteSkillTarget(target.id);
        await loadData();
      }
    });
  };

  const handleDeleteSkill = async (skill: SkillInstallation) => {
    await modal.confirm({
      title: `卸载 ${skill.displayName || skill.skillId}？`,
      content: "仅会删除 ActionDock 受管安装目录。",
      onOk: async () => {
        await deleteSkill(skill.installationId);
        await loadData();
      }
    });
  };

  const handleDisableSkill = async (skill: SkillInstallation) => {
    await modal.confirm({
      title: `停用 ${skill.displayName || skill.skillId}？`,
      content: "会删除目标目录中的已安装文件，保留受管副本和安装记录。",
      onOk: async () => {
        await disableSkill(skill.installationId);
        await loadData();
      }
    });
  };

  const handleRestoreSkill = async (skill: SkillInstallation) => {
    await modal.confirm({
      title: `恢复 ${skill.displayName || skill.skillId}？`,
      content: "会把受管副本重新写回目标目录，并恢复为启用状态。",
      onOk: async () => {
        await restoreSkill(skill.installationId);
        await loadData();
      }
    });
  };

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="Skill 管理"
          meta="管理本地 Agent Skill 目标目录、受管安装与目录扫描。安装动作已拆分到独立页面。"
          actions={
            <>
              <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
                刷新
              </Button>
              <Button type="primary" loading={installing} onClick={() => navigate("/skills/install")}>
                安装 Skill
              </Button>
              <Button onClick={openCreateTarget}>新增目标</Button>
            </>
          }
        />

        <Card>
          <Tabs
            defaultActiveKey="installations"
            items={[
              {
                key: "installations",
                label: `已安装 (${skills.length})`,
                children: (
                  <Table<SkillInstallation>
                    rowKey="installationId"
                    loading={loading}
                    columns={skillColumns}
                    dataSource={skills}
                    pagination={{ pageSize: 8, responsive: true }}
                    locale={{
                      emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有已安装 Skill" />
                    }}
                    scroll={{ x: 980 }}
                  />
                )
              },
              {
                key: "targets",
                label: `目标目录 (${targets.length})`,
                children: (
                  <Table<SkillTarget>
                    rowKey="id"
                    loading={loading}
                    columns={targetColumns}
                    dataSource={targets}
                    pagination={{ pageSize: 8, responsive: true }}
                    locale={{
                      emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先创建 SkillTarget" />
                    }}
                    scroll={{ x: 980 }}
                  />
                )
              }
            ]}
          />
        </Card>
      </Space>

      <Drawer
        title={editingTarget ? `编辑目标：${editingTarget.name}` : "新增 SkillTarget"}
        open={targetDrawerOpen}
        onClose={() => setTargetDrawerOpen(false)}
        width={560}
        destroyOnHidden
        extra={
          <Button type="primary" loading={savingTarget} onClick={() => void handleSaveTarget()}>
            保存
          </Button>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="例如 Codex CLI" />
          </Form.Item>
          <Form.Item label="类型" name="type" rules={[{ required: true, message: "请选择类型" }]}>
            <Select
              onChange={applyTypeTemplate}
              options={[
                { value: "CODEX", label: "CODEX" },
                { value: "CLAUDE", label: "CLAUDE" },
                { value: "GEMINI", label: "GEMINI" },
                { value: "CODEBUDDY", label: "CODEBUDDY" },
                { value: "CUSTOM", label: "CUSTOM" },
                { value: "ACTIONDOCK_AGENT", label: "ACTIONDOCK_AGENT" }
              ]}
            />
          </Form.Item>
          <Form.Item label="根目录" name="rootPath" rules={[{ required: true, message: "请输入目录路径" }]}>
            <Input placeholder="~/.codex/skills 或 /abs/path/to/skills" />
          </Form.Item>
          <Alert
            showIcon
            type="info"
            message="统一只支持 ~ 表示用户目录。选择内置类型时会自动填入推荐路径模板，仍可手工修改。"
          />
        </Form>
      </Drawer>
    </>
  );
}
