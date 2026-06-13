import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Drawer, Empty, Form, Input, Modal, Select, Space, Switch, Tabs, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { CodeEditor } from "../../../components/common/CodeEditor";
import {
  addKnowledgeFile,
  addKnowledgeNote,
  buildPlaybookSavePayload,
  hasKnowledgeFile,
  removeKnowledgeFile,
  removeKnowledgeNote,
  toKnowledgeEditorState,
  updateKnowledgeNote,
  upsertKnowledgeGroups,
  type KnowledgeEditorState,
  type PlaybookFormValues
} from "../../../services/playbookEditor";
import type { Playbook, ScriptDefinition } from "../../../shared/types";
import { KnowledgeFilePicker } from "./KnowledgeFilePicker";

const { Text } = Typography;

export interface PlaybookFormDrawerProps {
  open: boolean;
  /** 正在编辑的任务手册；为 null 且非 readOnly 表示新建。 */
  editing: Playbook | null;
  readOnly: boolean;
  /** 仓库选项（id -> label）。 */
  repositoryOptions: { value: string; label: string }[];
  repositoryNameMap: Map<string, string>;
  /** 所有可选脚本。 */
  scripts: ScriptDefinition[];
  scriptOptions: { value: string; label: string }[];
  /** 当前列表（用于关联任务手册下拉）。 */
  items: Playbook[];
  editorTheme: "vs-light" | "vs-dark";
  /** 关闭回调（含取消与保存成功后）。 */
  onClose: () => void;
  /** 保存回调，返回 Promise；失败由调用方处理提示。 */
  onSave: (payload: Playbook) => Promise<void>;
  /** 打开文件选择器入口，由调用方持有 Modal 状态。 */
  filePickerOpen: boolean;
  onOpenFilePicker: (repositoryId: string) => void;
  onCloseFilePicker: () => void;
  onConfirmFile: (repositoryId: string, path: string) => void;
  pendingFilePickerRepositoryId?: string;
}

/**
 * 创建/编辑任务手册 Drawer（920px，5 Tab）。
 * <p>
 * 所有 Tab 保持 forceRender，避免未挂载 Tab 值丢失。
 * managed=true 时整体只读。托管状态由调用方通过 readOnly 传入。
 */
export function PlaybookFormDrawer(props: PlaybookFormDrawerProps) {
  const {
    open,
    editing,
    readOnly,
    repositoryOptions,
    repositoryNameMap,
    scripts,
    scriptOptions,
    items,
    editorTheme,
    onClose,
    onSave,
    filePickerOpen,
    onOpenFilePicker,
    onCloseFilePicker,
    onConfirmFile,
    pendingFilePickerRepositoryId
  } = props;

  const [form] = Form.useForm<PlaybookFormValues>();
  const [knowledgeEditor, setKnowledgeEditor] = useState<KnowledgeEditorState[]>([]);
  const [saving, setSaving] = useState(false);

  const selectedRepositoryIds = Form.useWatch("repositoryIds", form) ?? [];

  // 打开或切换编辑对象时重置表单与知识编辑器
  useEffect(() => {
    if (!open) {
      return;
    }
    const repositoryIds = editing?.repositoryIds ?? [];
    setKnowledgeEditor(toKnowledgeEditorState(repositoryIds, editing?.knowledgeRefs ?? []));
    form.resetFields();
    form.setFieldsValue({
      id: editing?.id ?? "",
      name: editing?.name ?? "",
      description: editing?.description,
      tagsText: editing?.tags?.join(", "),
      riskLevel: editing?.riskLevel,
      repositoryIds,
      scriptRefs: editing?.scriptRefs ?? [],
      agentSkillRefs: editing?.agentSkillRefs ?? [],
      relatedPlaybookRefs: editing?.relatedPlaybookRefs ?? [],
      guideMarkdown: editing?.guideMarkdown ?? "",
      stopConditionsText: editing?.stopConditions?.join("\n"),
      enabled: editing?.enabled ?? true
    });
  }, [open, editing, form]);

  const handleRepositoryIdsChange = (nextIds: string[]) => {
    const currentGroups = knowledgeEditor.filter((item) => !nextIds.includes(item.repositoryId));
    if (currentGroups.some((item) => item.notes.length > 0 || item.files.length > 0)) {
      // 即将移除的仓库已有知识说明或文件引用，需二次确认避免误删
      Modal.confirm({
        title: "移除适用仓库",
        content: "移除仓库后，会同时删除该仓库下的知识说明和文件引用。",
        onOk: () => {
          form.setFieldValue("repositoryIds", nextIds);
          setKnowledgeEditor((value) => upsertKnowledgeGroups(value, nextIds));
        }
      });
      return;
    }
    form.setFieldValue("repositoryIds", nextIds);
    setKnowledgeEditor((value) => upsertKnowledgeGroups(value, nextIds));
  };

  const save = async () => {
    await form.validateFields();
    const values = form.getFieldsValue(true);
    const payload = buildPlaybookSavePayload({ values, knowledgeEditor, scripts, editing });
    setSaving(true);
    try {
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmFile = (repositoryId: string, path: string) => {
    setKnowledgeEditor((value) => addKnowledgeFile(value, repositoryId, path));
    onConfirmFile(repositoryId, path);
  };

  const filePickerRepositoryName = pendingFilePickerRepositoryId
    ? repositoryNameMap.get(pendingFilePickerRepositoryId)
    : undefined;

  const relatedOptions = useMemo(
    () =>
      items
        .filter((item) => item.id !== editing?.id)
        .map((item) => ({ value: item.id, label: `${item.name} (${item.id})` })),
    [items, editing?.id]
  );

  const drawerTitle = readOnly ? "查看任务手册" : editing ? "编辑任务手册" : "新建任务手册";

  return (
    <>
      <Drawer
        title={drawerTitle}
        open={open}
        width={920}
        onClose={onClose}
        extra={
          readOnly ? (
            <Button onClick={onClose}>关闭</Button>
          ) : (
            <Button type="primary" loading={saving} onClick={() => void save()}>
              保存
            </Button>
          )
        }
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ enabled: true }} disabled={readOnly}>
          <Tabs
            items={[
              {
                key: "basic",
                label: "基本信息",
                forceRender: true,
                children: (
                  <>
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
                    <Form.Item name="riskLevel" label="风险等级">
                      <Select allowClear options={["LOW", "MEDIUM", "HIGH"].map((value) => ({ value, label: value }))} />
                    </Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </>
                )
              },
              {
                key: "rules",
                label: "运行规则",
                forceRender: true,
                children: (
                  <>
                    <Form.Item name="guideMarkdown" label="导览 Markdown" rules={[{ required: true, message: "请输入导览文本" }]}>
                      <CodeEditor theme={editorTheme} language="markdown" height="360px" readOnly={readOnly} />
                    </Form.Item>
                    <Form.Item name="stopConditionsText" label="停止条件" style={{ marginTop: 16 }}>
                      <Input.TextArea rows={5} placeholder="每行一个停止条件" />
                    </Form.Item>
                  </>
                )
              },
              {
                key: "knowledge",
                label: "关联知识",
                forceRender: true,
                children: (
                  <>
                    <Form.Item name="repositoryIds" label="适用仓库">
                      <Select mode="multiple" options={repositoryOptions} onChange={handleRepositoryIdsChange} />
                    </Form.Item>
                    {selectedRepositoryIds.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先选择适用仓库，再添加知识说明 and 知识文件。" />
                    ) : (
                      <Space direction="vertical" size={16} style={{ width: "100%" }}>
                        {knowledgeEditor.map((group) => (
                          <div key={group.repositoryId} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 16 }}>
                            <Space direction="vertical" size={12} style={{ width: "100%" }}>
                              <Space style={{ justifyContent: "space-between", width: "100%" }}>
                                <Text strong>
                                  {repositoryNameMap.get(group.repositoryId) ?? group.repositoryId} ({group.repositoryId})
                                </Text>
                                <Space>
                                  <Button size="small" onClick={() => setKnowledgeEditor((value) => addKnowledgeNote(value, group.repositoryId))} disabled={readOnly}>
                                    添加说明
                                  </Button>
                                  <Button size="small" onClick={() => onOpenFilePicker(group.repositoryId)} disabled={readOnly}>
                                    添加文件
                                  </Button>
                                </Space>
                              </Space>
                              {group.notes.length === 0 && group.files.length === 0 ? (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有添加知识说明或文件引用" />
                              ) : null}
                              {group.notes.map((note, index) => (
                                <div key={`${group.repositoryId}:note:${index}`} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12 }}>
                                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                    <Space style={{ justifyContent: "space-between", width: "100%" }}>
                                      <Tag color="gold">NOTE</Tag>
                                      <Button size="small" danger onClick={() => setKnowledgeEditor((value) => removeKnowledgeNote(value, group.repositoryId, index))} disabled={readOnly}>
                                        删除说明
                                      </Button>
                                    </Space>
                                    <Input.TextArea
                                      rows={6}
                                      value={note}
                                      onChange={(event) => setKnowledgeEditor((value) => updateKnowledgeNote(value, group.repositoryId, index, event.target.value))}
                                      placeholder="输入针对该知识库的额外阅读指引（Markdown）"
                                    />
                                  </Space>
                                </div>
                              ))}
                              {group.files.map((path) => (
                                <div key={`${group.repositoryId}:${path}`} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12 }}>
                                  <Space style={{ justifyContent: "space-between", width: "100%" }}>
                                    <Space>
                                      <Tag color="blue">FILE</Tag>
                                      <Text code>{path}</Text>
                                    </Space>
                                    <Button size="small" danger onClick={() => setKnowledgeEditor((value) => removeKnowledgeFile(value, group.repositoryId, path))} disabled={readOnly}>
                                      删除文件
                                    </Button>
                                  </Space>
                                </div>
                              ))}
                            </Space>
                          </div>
                        ))}
                      </Space>
                    )}
                  </>
                )
              },
              {
                key: "scripts",
                label: "关联脚本",
                forceRender: true,
                children: (
                  <Form.List name="scriptRefs">
                    {(fields, { add, remove }) => (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {fields.map(({ key, name, ...restField }) => (
                          <Space key={key} style={{ display: "flex", width: "100%" }} align="baseline">
                            <Form.Item
                              {...restField}
                              name={[name, "scriptId"]}
                              rules={[{ required: true, message: "请选择脚本" }]}
                              style={{ width: 260, marginBottom: 0 }}
                            >
                              <Select showSearch placeholder="选择关联脚本" optionFilterProp="label" options={scriptOptions} />
                            </Form.Item>
                            <Form.Item noStyle shouldUpdate>
                              {() => {
                                const scriptId = form.getFieldValue(["scriptRefs", name, "scriptId"]);
                                const script = scripts.find((s) => s.id === scriptId);
                                return (
                                  <Form.Item {...restField} name={[name, "purpose"]} style={{ width: 340, marginBottom: 0 }}>
                                    <Input placeholder={script ? `默认：${script.name}` : "脚本用途说明（可空，默认使用脚本名称）"} />
                                  </Form.Item>
                                );
                              }}
                            </Form.Item>
                            <Button type="text" danger onClick={() => remove(name)} icon={<DeleteOutlined />} title="删除关联" disabled={readOnly} />
                          </Space>
                        ))}
                        <Form.Item style={{ marginBottom: 0 }}>
                          <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />} disabled={readOnly}>
                            添加关联脚本
                          </Button>
                        </Form.Item>
                      </div>
                    )}
                  </Form.List>
                )
              },
              {
                key: "agentSkills",
                label: "关联Skill",
                forceRender: true,
                children: (
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Form.List name="agentSkillRefs">
                      {(fields, { add, remove }) => (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {fields.map(({ key, name, ...restField }) => (
                            <Space key={key} style={{ display: "flex", width: "100%" }} align="baseline">
                              <Form.Item
                                {...restField}
                                name={[name, "skillId"]}
                                rules={[{ required: true, message: "请输入 Skill ID" }]}
                                style={{ width: 240, marginBottom: 0 }}
                              >
                                <Input placeholder="Agent 外部 Skill ID" />
                              </Form.Item>
                              <Form.Item {...restField} name={[name, "purpose"]} style={{ flex: 1, minWidth: 260, marginBottom: 0 }}>
                                <Input placeholder="使用场景说明（可空）" />
                              </Form.Item>
                              <Form.Item {...restField} name={[name, "required"]} valuePropName="checked" style={{ marginBottom: 0 }}>
                                <Switch checkedChildren="必需" unCheckedChildren="可选" />
                              </Form.Item>
                              <Button type="text" danger onClick={() => remove(name)} icon={<DeleteOutlined />} title="删除引用" disabled={readOnly} />
                            </Space>
                          ))}
                          <Form.Item style={{ marginBottom: 0 }}>
                            <Button type="dashed" onClick={() => add({ required: false })} block icon={<PlusOutlined />} disabled={readOnly}>
                              添加关联Skill
                            </Button>
                          </Form.Item>
                        </div>
                      )}
                    </Form.List>
                  </Space>
                )
              },
              {
                key: "relatedPlaybooks",
                label: "关联任务手册",
                forceRender: true,
                children: (
                  <Form.List name="relatedPlaybookRefs">
                    {(fields, { add, remove }) => (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {fields.map(({ key, name, ...restField }) => (
                          <Space key={key} style={{ display: "flex", width: "100%" }} align="baseline">
                            <Form.Item
                              {...restField}
                              name={[name, "playbookId"]}
                              rules={[{ required: true, message: "请选择或输入任务手册 ID" }]}
                              style={{ width: 260, marginBottom: 0 }}
                            >
                              <Select showSearch placeholder="相关任务手册" optionFilterProp="label" options={relatedOptions} />
                            </Form.Item>
                            <Form.Item {...restField} name={[name, "relation"]} rules={[{ required: true, message: "请选择关系" }]} style={{ width: 160, marginBottom: 0 }}>
                              <Select
                                options={[
                                  { value: "RELATED", label: "相关" },
                                  { value: "FOLLOW_UP", label: "后续" },
                                  { value: "FALLBACK", label: "兜底" }
                                ]}
                              />
                            </Form.Item>
                            <Form.Item {...restField} name={[name, "purpose"]} style={{ flex: 1, minWidth: 260, marginBottom: 0 }}>
                              <Input placeholder="跳转或参考说明（可空）" />
                            </Form.Item>
                            <Button type="text" danger onClick={() => remove(name)} icon={<DeleteOutlined />} title="删除引用" disabled={readOnly} />
                          </Space>
                        ))}
                        <Form.Item style={{ marginBottom: 0 }}>
                          <Button type="dashed" onClick={() => add({ relation: "RELATED" })} block icon={<PlusOutlined />} disabled={readOnly}>
                            添加关联任务手册
                          </Button>
                        </Form.Item>
                      </div>
                    )}
                  </Form.List>
                )
              }
            ]}
          />
        </Form>
      </Drawer>
      <KnowledgeFilePicker
        open={filePickerOpen}
        repositoryId={pendingFilePickerRepositoryId}
        repositoryName={filePickerRepositoryName}
        hasFile={(repositoryId, path) =>
          Boolean(knowledgeEditor.find((item) => item.repositoryId === repositoryId)) &&
          hasKnowledgeFile(knowledgeEditor, repositoryId, path)
        }
        onConfirm={handleConfirmFile}
        onCancel={onCloseFilePicker}
        editorTheme={editorTheme}
      />
    </>
  );
}
