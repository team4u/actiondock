import { Alert, Button, Card, Drawer, Form, Input, Select, Space, Spin } from "antd";
import { useEffect } from "react";
import { PlaybookDiffPanel } from "../../../components/diff/PlaybookDiffPanel";
import type { MessageInstance } from "antd/es/message/interface";
import type { Playbook, RepositoryDefinition } from "../../../shared/types";
import { useDefaultOwner } from "../../../shared/hooks/useDefaultOwner";
import { usePlaybookPublish } from "../hooks/usePlaybookPublish";

export interface PlaybookPublishDrawerProps {
  /** 发布目标任务手册；为 null 时关闭。 */
  playbook: Playbook | null;
  open: boolean;
  publishableRepositories: RepositoryDefinition[];
  publishRepositoryOptions: { value: string; label: string }[];
  messageApi: MessageInstance;
  editorTheme: "vs-light" | "vs-dark";
  sanitizePlaybookId: (value: string) => string;
  bumpPatchVersion: (version?: string) => string | null;
  onClose: () => void;
}

/**
 * 发布任务手册 Drawer（960px）+ Diff 面板。
 * <p>
 * 内部使用 usePlaybookPublish 管理 Diff 计算（保留 diffRequestRef 防竞态）。
 * open 切换时通过 key 重置内部状态，避免 Drawer 复用导致的表单残留。
 */
export function PlaybookPublishDrawer(props: PlaybookPublishDrawerProps) {
  const { playbook, open, publishableRepositories, publishRepositoryOptions, messageApi, editorTheme, sanitizePlaybookId, bumpPatchVersion, onClose } = props;
  const defaultOwner = useDefaultOwner();

  const publish = usePlaybookPublish({
    messageApi,
    publishableRepositories,
    defaultOwner,
    sanitizePlaybookId,
    bumpPatchVersion
  });

  // 以 useEffect 驱动开关，避免渲染期间触发状态更新。
  // 仅当外部 open 且 playbook 与当前发布目标不一致时才切换，防止重复打开导致 diff 闪烁。
  useEffect(() => {
    if (open && playbook && publish.publishingPlaybook?.id !== playbook.id) {
      publish.openPublishModal(playbook);
    } else if (!open && publish.publishModalOpen) {
      publish.closePublishModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, playbook?.id]);

  const handleClose = () => {
    publish.closePublishModal();
    onClose();
  };

  return (
    <Drawer
      title="发布任务手册到仓库"
      open={publish.publishModalOpen}
      onClose={handleClose}
      width={960}
      extra={
        <Button
          type="primary"
          loading={publish.publishing}
          onClick={() => void publish.publish()}
          disabled={publish.playbookDiff !== null && !publish.playbookDiff.hasChanges && publish.playbookDiff.comparisonMode !== "INITIAL"}
        >
          发布
        </Button>
      }
      destroyOnClose
    >
      {publish.playbookDiffLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : publish.playbookDiff ? (
        <Card type="inner" title="变更明细" style={{ marginBottom: 16 }}>
          <PlaybookDiffPanel diff={publish.playbookDiff} theme={editorTheme} />
        </Card>
      ) : null}
      <Form form={publish.publishForm} layout="vertical">
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="关联脚本和知识源不会自动随任务手册一起发布"
          description="发布时会检查目标仓库里是否已经存在 scriptRefs 对应脚本，以及 knowledgeRefs 对应知识源；缺失时会直接阻断，请先分别发布。"
        />
        <Form.Item name="repositoryId" label="目标仓库" rules={[{ required: true, message: "请选择目标仓库" }]}>
          <Select showSearch optionFilterProp="label" options={publishRepositoryOptions} />
        </Form.Item>
        <Form.Item name="playbookId" label="仓库任务手册 ID" rules={[{ required: true, message: "请输入仓库任务手册 ID" }]}>
          <Input />
        </Form.Item>
        {publish.versionHint ? <Alert type="info" showIcon message={publish.versionHint} style={{ marginBottom: 16 }} /> : null}
        <Space size={12} style={{ width: "100%" }} align="start">
          <Form.Item name="version" label="版本" rules={[{ required: true, message: "请输入版本" }]} style={{ flex: 1 }}>
            <Input />
          </Form.Item>
          <Form.Item name="owner" label="维护人" style={{ flex: 1 }}>
            <Input />
          </Form.Item>
        </Space>
        <Form.Item name="releaseNotes" label="发布说明">
          <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
