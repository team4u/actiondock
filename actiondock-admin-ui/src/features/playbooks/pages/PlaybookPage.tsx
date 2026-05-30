import { Button, Drawer, Form, Input, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { MarkdownDescription } from "../../../components/common/MarkdownDescription";
import { PageHeader } from "../../../components/common/PageHeader";
import { listRepositories } from "../../resources/api";
import { listScripts } from "../../scripts/api";
import { createPlaybook, deletePlaybook, getPlaybookGuide, listPlaybookGroups, listPlaybooks, updatePlaybook } from "../api";
import type { Playbook, PlaybookGroup, PlaybookGuideView, RepositoryDefinition, ScriptDefinition } from "../../../shared/types";
import { getErrorMessage } from "../../../services/utils";

interface PlaybookFormValues {
  id: string;
  groupId: string;
  name: string;
  description?: string;
  intentAliasesText?: string;
  tagsText?: string;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
  repositoryIds: string[];
  knowledgeRefsText?: string;
  scriptIds: string[];
  guideMarkdown: string;
  stopConditionsText?: string;
  enabled: boolean;
}

function splitText(value?: string): string[] {
  return value?.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean) ?? [];
}

function parseKnowledgeRefs(value?: string) {
  return splitText(value).map((item) => {
    const [typeValue, repositoryId, ...pathParts] = item.split(":");
    return { type: typeValue === "ENTRY" ? "ENTRY" as const : "FILE" as const, repositoryId, path: pathParts.join(":") };
  }).filter((item) => item.repositoryId && item.path);
}

export function PlaybookPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [items, setItems] = useState<Playbook[]>([]);
  const [groups, setGroups] = useState<PlaybookGroup[]>([]);
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<{ groupId?: string; repositoryId?: string; tag?: string; managed?: boolean; keyword?: string }>({});
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [guide, setGuide] = useState<PlaybookGuideView | null>(null);
  const [form] = Form.useForm<PlaybookFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const [playbookData, groupData, repositoryData, scriptData] = await Promise.all([
        listPlaybooks(filters),
        listPlaybookGroups(),
        listRepositories("PROJECT"),
        listScripts()
      ]);
      setItems(playbookData);
      setGroups(groupData);
      setRepositories(repositoryData);
      setScripts(scriptData);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载任务手册失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [filters.groupId, filters.repositoryId, filters.tag, filters.managed, filters.keyword]);

  const groupOptions = useMemo(() => groups.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })), [groups]);
  const repositoryOptions = useMemo(() => repositories.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })), [repositories]);
  const scriptOptions = useMemo(() => scripts.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })), [scripts]);
  const tags = useMemo(() => Array.from(new Set(items.flatMap((item) => item.tags ?? []))).sort(), [items]);

  const openEditor = (item?: Playbook) => {
    setEditing(item ?? null);
    setGuide(null);
    form.setFieldsValue({
      id: item?.id ?? "",
      groupId: item?.groupId ?? groups[0]?.id,
      name: item?.name ?? "",
      description: item?.description,
      intentAliasesText: item?.intentAliases?.join(", "),
      tagsText: item?.tags?.join(", "),
      riskLevel: item?.riskLevel,
      repositoryIds: item?.repositoryIds ?? [],
      knowledgeRefsText: item?.knowledgeRefs?.map((ref) => `${ref.type}:${ref.repositoryId}:${ref.path}`).join("\n"),
      scriptIds: item?.scriptRefs?.map((ref) => ref.scriptId) ?? [],
      guideMarkdown: item?.guideMarkdown ?? "",
      stopConditionsText: item?.stopConditions?.join("\n"),
      enabled: item?.enabled ?? true
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    const payload: Playbook = {
      id: values.id.trim(),
      groupId: values.groupId,
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      intentAliases: splitText(values.intentAliasesText),
      tags: splitText(values.tagsText),
      riskLevel: values.riskLevel,
      repositoryIds: values.repositoryIds ?? [],
      knowledgeRefs: parseKnowledgeRefs(values.knowledgeRefsText),
      scriptRefs: (values.scriptIds ?? []).map((scriptId) => ({ scriptId })),
      guideMarkdown: values.guideMarkdown,
      stopConditions: splitText(values.stopConditionsText),
      enabled: values.enabled,
      managed: editing?.managed ?? false
    };
    try {
      if (editing) {
        await updatePlaybook(editing.id, payload);
      } else {
        await createPlaybook(payload);
      }
      setDrawerOpen(false);
      messageApi.success("任务手册已保存");
      await load();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "保存任务手册失败"));
    }
  };

  const previewGuide = async (item: Playbook) => {
    try {
      setGuide(await getPlaybookGuide(item.id));
      setEditing(item);
      setDrawerOpen(true);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载 Guide 失败"));
    }
  };

  const remove = async (item: Playbook) => {
    try {
      await deletePlaybook(item.id);
      messageApi.success("任务手册已删除");
      await load();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除任务手册失败"));
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="任务手册"
        meta="以关联知识、关联脚本、导览 Markdown 和停止条件描述任务路线。"
        actions={<Button type="primary" onClick={() => openEditor()}>新建任务手册</Button>}
      />
      <Space wrap>
        <Input.Search allowClear placeholder="搜索任务手册" style={{ width: 260 }} onSearch={(keyword) => setFilters((value) => ({ ...value, keyword }))} onChange={(event) => setFilters((value) => ({ ...value, keyword: event.target.value }))} />
        <Select allowClear placeholder="Group" style={{ width: 220 }} options={groupOptions} onChange={(groupId) => setFilters((value) => ({ ...value, groupId }))} />
        <Select allowClear placeholder="Repository" style={{ width: 220 }} options={repositoryOptions} onChange={(repositoryId) => setFilters((value) => ({ ...value, repositoryId }))} />
        <Select allowClear placeholder="Tag" style={{ width: 160 }} options={tags.map((item) => ({ value: item, label: item }))} onChange={(tag) => setFilters((value) => ({ ...value, tag }))} />
        <Select allowClear placeholder="Managed" style={{ width: 140 }} options={[{ value: true, label: "托管" }]} onChange={(managed) => setFilters((value) => ({ ...value, managed }))} />
      </Space>
      <Table<Playbook>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={[
          { title: "ID", dataIndex: "id", width: 220 },
          { title: "名称", dataIndex: "name" },
          { title: "Group", dataIndex: "groupId", width: 180 },
          { title: "风险", dataIndex: "riskLevel", width: 100, render: (value?: string) => value ? <Tag color={value === "HIGH" ? "red" : value === "MEDIUM" ? "orange" : "green"}>{value}</Tag> : "-" },
          { title: "Tag", dataIndex: "tags", render: (value: string[]) => <Space wrap>{value?.map((item) => <Tag key={item}>{item}</Tag>)}</Space> },
          { title: "状态", key: "status", width: 150, render: (_, item) => <Space>{item.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}{item.managed ? <Tag color="blue">托管</Tag> : null}</Space> },
          {
            title: "操作",
            key: "actions",
            width: 220,
            render: (_, item) => (
              <Space>
                <Button size="small" onClick={() => void previewGuide(item)}>预览</Button>
                <Button size="small" disabled={item.managed} onClick={() => openEditor(item)}>编辑</Button>
                <Popconfirm title="删除任务手册？" disabled={item.managed} onConfirm={() => void remove(item)}>
                  <Button size="small" danger disabled={item.managed}>删除</Button>
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />
      <Drawer title={guide ? "Guide 预览" : editing ? "编辑任务手册" : "新建任务手册"} open={drawerOpen} width={760} onClose={() => setDrawerOpen(false)} extra={!guide ? <Button type="primary" onClick={() => void save()}>保存</Button> : null}>
        {guide ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Space wrap>{guide.knowledgeRefs.map((ref) => <Tag key={`${ref.repositoryId}:${ref.path}`}>{ref.type} {ref.repositoryId}:{ref.path}</Tag>)}</Space>
            <Space wrap>{guide.scriptRefs.map((ref) => <Tag color="blue" key={ref.scriptId}>{ref.scriptId}</Tag>)}</Space>
            <MarkdownDescription value={guide.guideMarkdown} className="markdown-description--panel" />
            <Space wrap>{guide.stopConditions.map((item) => <Tag color="red" key={item}>{item}</Tag>)}</Space>
          </Space>
        ) : (
          <Tabs
            items={[
              {
                key: "basic",
                label: "基本信息",
                children: (
                  <Form form={form} layout="vertical" initialValues={{ enabled: true }}>
                    <Form.Item name="id" label="ID" rules={[{ required: true, message: "请输入 ID" }]}><Input disabled={Boolean(editing)} /></Form.Item>
                    <Form.Item name="groupId" label="任务分组" rules={[{ required: true, message: "请选择任务分组" }]}><Select options={groupOptions} /></Form.Item>
                    <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}><Input /></Form.Item>
                    <Form.Item name="description" label="描述"><Input.TextArea rows={3} /></Form.Item>
                    <Form.Item name="intentAliasesText" label="意图别名"><Input placeholder="逗号分隔" /></Form.Item>
                    <Form.Item name="tagsText" label="Tags"><Input placeholder="逗号分隔" /></Form.Item>
                    <Form.Item name="riskLevel" label="风险等级"><Select allowClear options={["LOW", "MEDIUM", "HIGH"].map((value) => ({ value, label: value }))} /></Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                  </Form>
                )
              },
              {
                key: "knowledge",
                label: "关联知识",
                children: (
                  <Form form={form} layout="vertical">
                    <Form.Item name="repositoryIds" label="适用仓库"><Select mode="multiple" options={repositoryOptions} /></Form.Item>
                    <Form.Item name="knowledgeRefsText" label="知识引用"><Input.TextArea rows={8} placeholder="ENTRY:billing-service:ACTIONDOCK.md&#10;FILE:billing-service:docs/runbooks/refund.md" /></Form.Item>
                  </Form>
                )
              },
              {
                key: "scripts",
                label: "关联脚本",
                children: <Form form={form} layout="vertical"><Form.Item name="scriptIds" label="脚本"><Select mode="multiple" showSearch optionFilterProp="label" options={scriptOptions} /></Form.Item></Form>
              },
              {
                key: "guide",
                label: "导览文本与停止条件",
                children: (
                  <Form form={form} layout="vertical">
                    <Form.Item name="guideMarkdown" label="Guide Markdown" rules={[{ required: true, message: "请输入导览文本" }]}><Input.TextArea rows={12} /></Form.Item>
                    <Form.Item name="stopConditionsText" label="停止条件"><Input.TextArea rows={5} placeholder="每行一个停止条件" /></Form.Item>
                  </Form>
                )
              }
            ]}
          />
        )}
      </Drawer>
    </Space>
  );
}
