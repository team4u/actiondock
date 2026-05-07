import { Drawer, Space, Typography } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { getApiKey } from "../../../../shared/auth/auth";
import { PluginActionsOverview } from "../../../../components/plugin/PluginActionsOverview";
import type { PluginReferenceView, ScriptType } from "../../../../shared/types";

const { Text } = Typography;

function getPluginReferenceSourceLabel(sourceType: PluginReferenceView["sourceType"]): string {
  return sourceType === "SYSTEM" ? "系统" : "插件";
}

interface PluginReferenceModalProps {
  plugin: PluginReferenceView | null;
  onClose: () => void;
  selectedScriptType: ScriptType;
  messageApi: MessageInstance;
}

export function PluginReferenceModal({
  plugin,
  onClose,
  selectedScriptType,
  messageApi
}: PluginReferenceModalProps) {
  if (!plugin) return null;
  const apiKey = getApiKey() || undefined;
  const origin = window.location.origin;

  return (
    <Drawer
      title={plugin.name || plugin.pluginId}
      open={Boolean(plugin)}
      onClose={onClose}
      width={640}
      destroyOnHidden
    >
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Text type="secondary">
          {[
            getPluginReferenceSourceLabel(plugin.sourceType),
            plugin.pluginId,
            `${plugin.actions.length} 个方法`,
            plugin.version ? `v${plugin.version}` : ""
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <PluginActionsOverview
          messageApi={messageApi}
          description={plugin.description}
          actions={plugin.actions}
          mode="collapse"
          snippetContext={{ pluginId: plugin.pluginId, scriptType: selectedScriptType }}
          commandContext={{ apiKey, origin, pluginId: plugin.pluginId }}
        />
      </Space>
    </Drawer>
  );
}
