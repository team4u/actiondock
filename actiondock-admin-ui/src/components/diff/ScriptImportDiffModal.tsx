import { Empty, List, Modal, Space, Typography } from "antd";
import { ScriptDiffPanel } from "./ScriptDiffPanel";
import { RiskLevelTag } from "../domain/RiskLevelTag";
import type { ScriptDiffResult } from "../../services/scriptDiff";
import type { ScriptDefinition } from "../../shared/types";

const { Text } = Typography;

export interface ScriptImportDiffItem {
  id: string;
  currentScript: ScriptDefinition;
  importedScript: ScriptDefinition;
  diff: ScriptDiffResult;
}

interface ScriptImportDiffModalProps {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  confirmLoading?: boolean;
  overwriteItems: ScriptImportDiffItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  createCount: number;
  totalCount: number;
  theme: "vs-light" | "vs-dark";
}

export function ScriptImportDiffModal({
  open,
  onCancel,
  onOk,
  confirmLoading = false,
  overwriteItems,
  selectedId,
  onSelect,
  createCount,
  totalCount,
  theme
}: ScriptImportDiffModalProps) {
  const selectedItem =
    overwriteItems.find((item) => item.id === selectedId) ?? overwriteItems[0] ?? null;

  return (
    <Modal
      title="确认导入脚本"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="继续导入"
      cancelText="取消"
      confirmLoading={confirmLoading}
      width={1280}
      destroyOnHidden
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Space direction="vertical" size={4}>
          <Text>共解析到 {totalCount} 个脚本。</Text>
          <Text>新增 {createCount} 个，覆盖 {overwriteItems.length} 个。</Text>
        </Space>

        {overwriteItems.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有覆盖项，将直接新增导入脚本。" />
        ) : (
          <div className="script-import-diff-layout">
            <div className="script-import-diff-sidebar">
              <List
                size="small"
                dataSource={overwriteItems}
                renderItem={(item) => (
                  <List.Item
                    className={`script-import-diff-item${selectedItem?.id === item.id ? " script-import-diff-item--active" : ""}`}
                    onClick={() => onSelect(item.id)}
                  >
                    <Space direction="vertical" size={2} style={{ width: "100%" }}>
                      <Space wrap size={[8, 8]}>
                        <Text strong>{item.id}</Text>
                        <RiskLevelTag level={item.diff.riskLevel} />
                      </Space>
                      <Text type="secondary">
                        {item.diff.highlights[0] ?? `${item.diff.tabs.length} 个差异分组`}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            </div>
            <div className="script-import-diff-main">
              {selectedItem ? (
                <ScriptDiffPanel
                  diff={selectedItem.diff}
                  targetType={selectedItem.importedScript.type}
                  theme={theme}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择要查看的覆盖项" />
              )}
            </div>
          </div>
        )}
      </Space>
    </Modal>
  );
}
