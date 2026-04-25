import { Modal, Space, Typography } from "antd";
import { PluginActionsOverview } from "../../components/PluginActionsOverview";
import type { PluginView, ScriptType } from "../../types";

const { Text } = Typography;

interface PluginReferenceModalProps {
  plugin: PluginView | null;
  onClose: () => void;
  selectedScriptType: ScriptType;
}

export function PluginReferenceModal({
  plugin,
  onClose,
  selectedScriptType
}: PluginReferenceModalProps) {
  if (!plugin) return null;

  return (
    <Modal
      title={plugin.name || plugin.pluginId}
      open={Boolean(plugin)}
      onCancel={onClose}
      footer={null}
      width={860}
      destroyOnHidden
    >
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Text type="secondary">
          {[plugin.pluginId, `${plugin.actions.length} 个方法`, plugin.version ? `v${plugin.version}` : ""]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <PluginActionsOverview
          description={plugin.description}
          actions={plugin.actions}
          mode="collapse"
          snippetContext={{ pluginId: plugin.pluginId, scriptType: selectedScriptType }}
        />
      </Space>
    </Modal>
  );
}
