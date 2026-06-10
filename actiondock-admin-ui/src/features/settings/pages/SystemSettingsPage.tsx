import { Space, Tabs } from "antd";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../../components/common/PageHeader";
import { AccessTokenManagementPage } from "./AccessTokenManagementPage";
import { ApiKeySettingsPanel } from "./ApiKeyManagementPage";
import { ConfigValueManagementPage } from "./ConfigValueManagementPage";
import { DataBackupPanel } from "./DataBackupPanel";
import { SharedStateManagementPage } from "./SharedStateManagementPage";
import {
  buildSystemSettingsSearch,
  resolveSystemSettingsTab,
  type SystemSettingsTab
} from "../../../services/settingsRouting";

export function SystemSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = useMemo(() => resolveSystemSettingsTab(searchParams), [searchParams]);

  const handleTabChange = (key: string) => {
    const nextTab = key as SystemSettingsTab;
    setSearchParams(buildSystemSettingsSearch(nextTab), { replace: true });
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <PageHeader
        title="系统配置"
        meta="统一管理控制台凭证、服务端访问令牌、全局配置值和脚本共享状态。"
      />
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={[
          {
            key: "config-values",
            label: "配置值",
            children: <ConfigValueManagementPage embedded />
          },
          {
            key: "shared-state",
            label: "共享状态",
            children: <SharedStateManagementPage embedded />
          },
          {
            key: "access-tokens",
            label: "访问令牌",
            children: <AccessTokenManagementPage embedded />
          },
          {
            key: "console-token",
            label: "控制台凭证",
            children: <ApiKeySettingsPanel />
          },
          {
            key: "data-backup",
            label: "数据备份",
            children: <DataBackupPanel />
          }
        ]}
      />
    </Space>
  );
}
