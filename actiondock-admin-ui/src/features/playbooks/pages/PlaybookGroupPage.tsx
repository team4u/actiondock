import { Button, Drawer, Form, Input, Popconfirm, Space, Switch, Table, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../../components/common/PageHeader";
import { createPlaybookGroup, deletePlaybookGroup, listPlaybookGroups, updatePlaybookGroup } from "../api";
import type { PlaybookGroup } from "../../../shared/types";
import { getErrorMessage } from "../../../services/utils";

interface GroupFormValues {
  id: string;
  name: string;
  description?: string;
  tagsText?: string;
  repositoryIdsText?: string;
  enabled: boolean;
}

function splitText(value?: string): string[] {
  return value?.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean) ?? [];
}

export function PlaybookGroupPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [items, setItems] = useState<PlaybookGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [tag, setTag] = useState<string | undefined>();
  const [editing, setEditing] = useState<PlaybookGroup | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm<GroupFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      setItems(await listPlaybookGroups());
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载任务分组失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const tags = useMemo(() => Array.from(new Set(items.flatMap((item) => item.tags ?? []))).sort(), [items]);
  const filtered = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return items.filter((item) => {
      const matchesKeyword = !normalizedKeyword
        || item.id.toLowerCase().includes(normalizedKeyword)
        || item.name.toLowerCase().includes(normalizedKeyword)
        || (item.description ?? "").toLowerCase().includes(normalizedKeyword);
      const matchesTag = !tag || item.tags?.includes(tag);
      return matchesKeyword && matchesTag;
    });
  }, [items, keyword, tag]);

  const openEditor = (item?: PlaybookGroup) => {
    setEditing(item ?? null);
    form.setFieldsValue({
      id: item?.id ?? "",
      name: item?.name ?? "",
      description: item?.description,
      tagsText: item?.tags?.join(", "),
      repositoryIdsText: item?.defaultRepositoryIds?.join(", "),
      enabled: item?.enabled ?? true
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    const payload: PlaybookGroup = {
      id: values.id.trim(),
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      tags: splitText(values.tagsText),
      defaultRepositoryIds: splitText(values.repositoryIdsText),
      enabled: values.enabled,
      managed: editing?.managed ?? false
    };
    try {
      if (editing) {
        await updatePlaybookGroup(editing.id, payload);
      } else {
        await createPlaybookGroup(payload);
      }
      setDrawerOpen(false);
      messageApi.success("任务分组已保存");
      await load();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "保存任务分组失败"));
    }
  };

  const remove = async (item: PlaybookGroup) => {
    try {
      await deletePlaybookGroup(item.id);
      messageApi.success("任务分组已删除");
      await load();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "删除任务分组失败"));
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="任务分组"
        meta="一级任务域归类，用于筛选任务手册并提示默认项目范围。"
        actions={<Button type="primary" onClick={() => openEditor()}>新建分组</Button>}
      />
      <Space wrap>
        <Input.Search allowClear placeholder="搜索分组" style={{ width: 260 }} onSearch={setKeyword} onChange={(event) => setKeyword(event.target.value)} />
        <select value={tag ?? ""} onChange={(event) => setTag(event.target.value || undefined)}>
          <option value="">全部 tag</option>
          {tags.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </Space>
      <Table<PlaybookGroup>
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        columns={[
          { title: "ID", dataIndex: "id", width: 220 },
          { title: "名称", dataIndex: "name" },
          { title: "任务手册", dataIndex: "playbookCount", width: 100, render: (value?: number) => value ?? 0 },
          { title: "Tag", dataIndex: "tags", render: (value: string[]) => <Space wrap>{value?.map((item) => <Tag key={item}>{item}</Tag>)}</Space> },
          { title: "状态", key: "status", width: 150, render: (_, item) => <Space>{item.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}{item.managed ? <Tag color="blue">托管</Tag> : null}</Space> },
          {
            title: "操作",
            key: "actions",
            width: 160,
            render: (_, item) => (
              <Space>
                <Button size="small" disabled={item.managed} onClick={() => openEditor(item)}>编辑</Button>
                <Popconfirm title="删除任务分组？" disabled={item.managed} onConfirm={() => void remove(item)}>
                  <Button size="small" danger disabled={item.managed}>删除</Button>
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />
      <Drawer title={editing ? "编辑任务分组" : "新建任务分组"} open={drawerOpen} width={520} onClose={() => setDrawerOpen(false)} extra={<Button type="primary" onClick={() => void save()}>保存</Button>}>
        <Form form={form} layout="vertical" initialValues={{ enabled: true }}>
          <Form.Item name="id" label="ID" rules={[{ required: true, message: "请输入 ID" }]}>
            <Input disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="tagsText" label="Tags">
            <Input placeholder="逗号分隔" />
          </Form.Item>
          <Form.Item name="repositoryIdsText" label="默认项目仓库">
            <Input placeholder="逗号分隔 repositoryId" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </Space>
  );
}
