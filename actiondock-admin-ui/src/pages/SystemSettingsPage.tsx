import { Space, Tabs } from "antd";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { ApiKeySettingsPanel } from "./ApiKeyManagementPage";
import {
  buildSystemSettingsSearch,
  resolveSystemSettingsTab,
  type SystemSettingsTab
} from "../settingsRouting";

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
        meta="控制台本地设置，仅保存在当前浏览器，不会写入服务端。"
      />
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={[
          {
            key: "api-key",
            label: "API Key",
            children: <ApiKeySettingsPanel />
          }
        ]}
      />
    </Space>
  );
}
