import { Alert, Modal, Space, Tag, Typography } from "antd";
import type { PlaybookImportAnalysis } from "../../../services/playbookTransfer";

const { Text } = Typography;

export interface PlaybookImportModalProps {
  open: boolean;
  importing: boolean;
  analysis: PlaybookImportAnalysis | null;
  /** 被阻断（跳过）的 ID 集合，用于确定确认按钮可用性。 */
  blockedIds: Set<string>;
  onOk: () => void;
  onCancel: () => void;
}

/**
 * 导入预览 Modal：展示解析结果与冲突/缺失/循环引用告警。
 */
export function PlaybookImportModal({ open, importing, analysis, blockedIds, onOk, onCancel }: PlaybookImportModalProps) {
  return (
    <Modal
      title="确认导入任务手册"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="继续导入"
      cancelText="取消"
      confirmLoading={importing}
      okButtonProps={{
        disabled: !analysis || analysis.playbooks.length === blockedIds.size
      }}
      destroyOnHidden
    >
      {analysis ? (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>共解析到 {analysis.playbooks.length} 个任务手册。</Text>
          <Space wrap>
            <Tag color="green">新增 {analysis.createIds.length}</Tag>
            <Tag color="orange">覆盖 {analysis.overwriteIds.length}</Tag>
            <Tag color="red">托管冲突 {analysis.managedConflictIds.length}</Tag>
            <Tag color="red">缺失脚本 {analysis.missingScriptRefs.length}</Tag>
            <Tag color="red">缺失相关手册 {analysis.missingRelatedPlaybookRefs.length}</Tag>
            <Tag color="red">循环引用 {analysis.circularIds.length}</Tag>
          </Space>
          {analysis.managedConflictIds.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message="以下 ID 已存在为仓库托管任务手册，导入时会跳过"
              description={analysis.managedConflictIds.join(", ")}
            />
          ) : null}
          {analysis.missingScriptRefs.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message="以下任务手册引用了当前不存在的脚本，导入时会跳过"
              description={analysis.missingScriptRefs.map((item) => `${item.playbookId}: ${item.scriptIds.join(", ")}`).join("\n")}
            />
          ) : null}
          {analysis.missingRelatedPlaybookRefs.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message="以下任务手册引用了不存在的外部相关任务手册，导入时会跳过"
              description={analysis.missingRelatedPlaybookRefs.map((item) => `${item.playbookId}: ${item.missingPlaybookIds.join(", ")}`).join("\n")}
            />
          ) : null}
          {analysis.circularIds.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message="以下新建任务手册之间存在循环引用，导入时会跳过"
              description={analysis.circularIds.join(", ")}
            />
          ) : null}
        </Space>
      ) : null}
    </Modal>
  );
}
