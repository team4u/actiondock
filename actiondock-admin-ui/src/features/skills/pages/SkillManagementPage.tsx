import {
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  ScanOutlined,
  StopOutlined,
  SyncOutlined,
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
import type { TableRowSelection } from "antd/es/table/interface";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createSkillTarget,
  deleteSkill,
  deleteSkillTarget,
  disableSkill,
  listSkillTargets,
  listSkills,
  restoreSkill,
  syncSkillInstallationsToTarget,
  updateSkillTarget
} from "../../skills/api";
import { listRepositories, listSkillsByRepository } from "../../resources/api";
import { PageHeader } from "../../../components/common/PageHeader";
import { TableLinkCell } from "../../../components/common/TableLinkCell";
import { RepositorySkillInstallDrawer } from "../../../components/repository/RepositorySkillInstallDrawer";
import {
  buildSkillManagementSearch,
  resolveSkillManagementTab,
  type SkillManagementTab
} from "../../../services/skillRouting";
import type { RepositorySkillDescriptor, Skill, SkillSyncResult, SkillTarget } from "../../../shared/types";
import { formatDateTime, getErrorMessage } from "../../../services/utils";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = useMemo(() => resolveSkillManagementTab(searchParams), [searchParams]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [targets, setTargets] = useState<SkillTarget[]>([]);
  const [repositorySkillMap, setRepositorySkillMap] = useState<Map<string, RepositorySkillDescriptor>>(new Map());
  const [loading, setLoading] = useState(true);
  const [savingTarget, setSavingTarget] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const [form] = Form.useForm<TargetFormValues>();
  const [editingTarget, setEditingTarget] = useState<SkillTarget | null>(null);
  const [targetDrawerOpen, setTargetDrawerOpen] = useState(false);
  const [syncTarget, setSyncTarget] = useState<SkillTarget | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selectedSyncSkillIds, setSelectedSyncSkillIds] = useState<React.Key[]>([]);
  const [repositoryUpdateSkill, setRepositoryUpdateSkill] = useState<Skill | null>(null);

  const applyTypeTemplate = (nextType: string) => {
    form.setFieldsValue({
      type: nextType,
      name: buildSkillTargetName(nextType),
      rootPath: buildSkillTargetPathTemplate(nextType)
    });
  };

  const loadData = async (): Promise<{ skillData: Skill[]; targetData: SkillTarget[] } | null> => {
    setLoading(true);
    try {
      const [skillData, targetData, repositories] = await Promise.all([listSkills(), listSkillTargets(), listRepositories()]);
      setSkills(skillData);
      setTargets(targetData);
      const nextRepositorySkillMap = new Map<string, RepositorySkillDescriptor>();
      const results = await Promise.allSettled(
        repositories.filter((item) => item.enabled).map((repository) => listSkillsByRepository(repository.id))
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          for (const descriptor of result.value) {
            nextRepositorySkillMap.set(`${descriptor.repositoryId}:${descriptor.skillId}`, descriptor);
          }
        }
      }
      setRepositorySkillMap(nextRepositorySkillMap);
      return { skillData, targetData };
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载 Skill 管理数据失败"));
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const openRepositorySkillUpdate = (skill: Skill) => {
    if (!skill.repositoryId) {
      return;
    }
    setRepositoryUpdateSkill(skill);
  };

  const syncCandidateList = skills
    .filter((skill) => !skill.targets.some((target) => target.targetId === syncTarget?.id))
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));

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
          <Button size="small" icon={<SyncOutlined />} onClick={() => void openSyncTarget(record)}>
            添加 Skill
          </Button>
          <Button size="small" icon={<ScanOutlined />} onClick={() => navigate(`/skills/scan/${encodeURIComponent(record.id)}`)}>
            扫描
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void handleDeleteTarget(record)}>
            删除
          </Button>
        </Space>
      )
    }
  ];

  const skillColumns: ColumnsType<Skill> = [
    {
      title: "Skill",
      key: "skill",
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <TableLinkCell to={`/skills/${encodeURIComponent(record.skillId)}`}>
            <Text strong>{record.displayName || record.skillId}</Text>
          </TableLinkCell>
          <Text type="secondary" code>{record.skillId}</Text>
        </Space>
      )
    },
    { title: "版本", dataIndex: "version", key: "version", width: 120 },
    {
      title: "状态",
      key: "status",
      render: (_value, record) => (
        <Space wrap size={[4, 4]}>
          <Tag color={record.enabledTargetCount > 0 ? "processing" : "default"}>
            启用 {record.enabledTargetCount}
          </Tag>
          {record.disabledTargetCount > 0 ? <Tag>停用 {record.disabledTargetCount}</Tag> : null}
          {record.repositoryId ? <Tag>{record.repositoryId}</Tag> : <Tag>本地导入</Tag>}
          {record.repositoryId && repositorySkillMap.get(`${record.repositoryId}:${record.skillId}`)?.updateAvailable ? <Tag color="processing">可更新</Tag> : null}
        </Space>
      )
    },
    {
      title: "更新时间",
      key: "updatedAt",
      width: 180,
      render: (_value, record) => formatDateTime(record.updatedAt)
    },
    {
      title: "操作",
      key: "actions",
      render: (_value, record) => (
        <Space wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/skills/${encodeURIComponent(record.skillId)}`)}>
            详情
          </Button>
          {record.repositoryId ? (
            <Button
              size="small"
              icon={<SyncOutlined />}
              type={repositorySkillMap.get(`${record.repositoryId}:${record.skillId}`)?.updateAvailable ? "primary" : "default"}
              ghost={Boolean(repositorySkillMap.get(`${record.repositoryId}:${record.skillId}`)?.updateAvailable)}
              disabled={!repositorySkillMap.get(`${record.repositoryId}:${record.skillId}`)?.updateAvailable}
              onClick={() => openRepositorySkillUpdate(record)}
            >
              {repositorySkillMap.get(`${record.repositoryId}:${record.skillId}`)?.updateAvailable ? "更新" : "已安装"}
            </Button>
          ) : null}
          <Button
            size="small"
            icon={record.enabledTargetCount > 0 ? <StopOutlined /> : <UndoOutlined />}
            onClick={() => void (record.enabledTargetCount > 0 ? handleDisableSkill(record) : handleRestoreSkill(record))}
          >
            {record.enabledTargetCount > 0 ? "停用" : "恢复"}
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void handleDeleteSkill(record)}>
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

  const openSyncTarget = async (target: SkillTarget) => {
    setSelectedSyncSkillIds([]);
    const data = await loadData();
    if (!data) {
      return;
    }
    setSyncTarget(data.targetData.find((item) => item.id === target.id) ?? target);
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

  const handleDeleteSkill = async (skill: Skill) => {
    await modal.confirm({
      title: `卸载 ${skill.displayName || skill.skillId}？`,
      content: "会批量删除该 Skill 在所有目标中的受管安装目录，并删除唯一受管副本。",
      onOk: async () => {
        await deleteSkill(skill.skillId);
        await loadData();
      }
    });
  };

  const handleDisableSkill = async (skill: Skill) => {
    await modal.confirm({
      title: `停用 ${skill.displayName || skill.skillId}？`,
      content: "会批量删除所有目标目录中的已安装文件，保留唯一受管副本和目标关联。",
      onOk: async () => {
        await disableSkill(skill.skillId);
        await loadData();
      }
    });
  };

  const handleRestoreSkill = async (skill: Skill) => {
    await modal.confirm({
      title: `恢复 ${skill.displayName || skill.skillId}？`,
      content: "会把唯一受管副本重新写回所有目标目录，并恢复为启用状态。",
      onOk: async () => {
        await restoreSkill(skill.skillId);
        await loadData();
      }
    });
  };

  const handleSyncSkills = async () => {
    if (!syncTarget || selectedSyncSkillIds.length === 0) {
      return;
    }
    setSyncing(true);
    try {
      const response = await syncSkillInstallationsToTarget(
        syncTarget.id,
        selectedSyncSkillIds.map((id) => String(id))
      );
      const successCount = response.results.filter((item) => item.status === "SUCCESS").length;
      const skippedCount = response.results.filter((item) => item.status === "SKIPPED").length;
      const failedCount = response.results.filter((item) => item.status === "FAILED").length;
      await loadData();
      setSyncTarget(null);
      setSelectedSyncSkillIds([]);
      if (skippedCount > 0 || failedCount > 0) {
        await modal.info({
          title: `同步完成：${successCount} 个成功，${skippedCount} 个跳过，${failedCount} 个失败`,
          width: 720,
          content: (
            <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 12 }}>
              {response.results.map((item: SkillSyncResult) => (
                <Alert
                  key={`${item.skillId}:${item.targetId}`}
                  type={item.status === "SUCCESS" ? "success" : item.status === "SKIPPED" ? "warning" : "error"}
                  showIcon
                  message={`${item.skillId} · ${item.status}`}
                  description={item.message}
                />
              ))}
            </Space>
          )
        });
      } else {
        messageApi.success(`Skill 同步完成，成功 ${successCount} 个`);
      }
    } catch (error) {
      messageApi.error(getErrorMessage(error, "同步 Skill 失败"));
    } finally {
      setSyncing(false);
    }
  };

  const syncRowSelection: TableRowSelection<Skill> = {
    selectedRowKeys: selectedSyncSkillIds,
    onChange: (nextSelectedRowKeys) => setSelectedSyncSkillIds(nextSelectedRowKeys),
    preserveSelectedRowKeys: true
  };

  const handleTabChange = (key: string) => {
    const nextTab = key as SkillManagementTab;
    setSearchParams(buildSkillManagementSearch(nextTab), { replace: true });
  };

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="Skill 管理"
          meta="管理本地 Agent Skill 目标目录、唯一受管副本与多目标部署关系。"
          actions={
            <>
              <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
                刷新
              </Button>
              <Button type="primary" onClick={() => navigate("/skills/install")}>
                安装 Skill
              </Button>
              <Button onClick={openCreateTarget}>新增目标</Button>
            </>
          }
        />

        <Card>
          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            items={[
              {
                key: "skills",
                label: `已安装 (${skills.length})`,
                children: (
                  <Table<Skill>
                    rowKey="skillId"
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

      <Drawer
        title={syncTarget ? `添加到目标：${syncTarget.name}` : "添加 Skill"}
        open={syncTarget !== null}
        onClose={() => {
          setSyncTarget(null);
          setSelectedSyncSkillIds([]);
        }}
        width={860}
        destroyOnHidden
        extra={
          <Button
            type="primary"
            icon={<SyncOutlined />}
            loading={syncing}
            disabled={selectedSyncSkillIds.length === 0}
            onClick={() => void handleSyncSkills()}
          >
            同步所选
          </Button>
        }
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {syncTarget && (
            <Alert
              showIcon
              type="info"
              message={`将已安装 Skill 添加到 ${syncTarget.name}`}
              description={`目标目录：${syncTarget.rootPath}。同 skillId 的受管 Skill 会默认覆盖，未受管同名目录会跳过。`}
            />
          )}
          <Table<Skill>
            rowKey="skillId"
            dataSource={syncCandidateList}
            rowSelection={syncRowSelection}
            pagination={{ pageSize: 8, responsive: true }}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可同步的 Skill" />
            }}
            columns={[
              {
                title: "Skill",
                key: "skill",
                render: (_value, record) => (
                  <Space direction="vertical" size={0}>
                    <Text strong>{record.displayName || record.skillId}</Text>
                    <Text type="secondary" code>{record.skillId}</Text>
                  </Space>
                )
              },
              {
                title: "版本",
                dataIndex: "version",
                key: "version",
                width: 120
              },
              {
                title: "已安装目标",
                key: "installedTargets",
                render: (_value, record) => (
                  <Space wrap size={[4, 4]}>
                    {record.targets.map((target) => (
                      <Tag key={`${record.skillId}:${target.targetId}`}>{target.targetId}</Tag>
                    ))}
                  </Space>
                )
              },
              {
                title: "更新时间",
                key: "updatedAt",
                width: 180,
                render: (_value, record) => formatDateTime(record.updatedAt)
              }
            ]}
            scroll={{ x: 760 }}
          />
        </Space>
      </Drawer>

      <RepositorySkillInstallDrawer
        open={repositoryUpdateSkill !== null}
        descriptor={repositoryUpdateSkill ? {
          repositoryId: repositoryUpdateSkill.repositoryId!,
          skillId: repositoryUpdateSkill.skillId,
          displayName: repositoryUpdateSkill.displayName || repositoryUpdateSkill.skillId,
          installed: true,
          updateAvailable: true,
          version: repositoryUpdateSkill.version,
          description: null,
          owner: null,
          trusted: false,
          riskLevel: "UNKNOWN"
        } : null}
        onClose={() => setRepositoryUpdateSkill(null)}
        onSuccess={() => {
          setRepositoryUpdateSkill(null);
          void loadData();
        }}
      />
    </>
  );
}
