import { Button, Card, Modal, Space, Typography, message } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../../components/common/PageHeader";
import { RepositorySkillInstallDrawer } from "../../../components/repository/RepositorySkillInstallDrawer";
import { useColorMode } from "../../../shared/contexts/ColorModeContext";
import { DiscoveryCatalogTabs } from "./discovery/DiscoveryCatalogTabs";
import { DiscoveryDetailDrawers } from "./discovery/DiscoveryDetailDrawers";
import { DiscoveryFiltersBar } from "./discovery/DiscoveryFiltersBar";
import { useRepositoryDiscovery } from "./discovery/useRepositoryDiscovery";

const { Text } = Typography;

export function RepositoryDiscoveryPage() {
  const navigate = useNavigate();
  const colorMode = useColorMode();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const discovery = useRepositoryDiscovery({ messageApi, modal, navigate });

  return (
    <>
      {contextHolder}
      {modalContextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="发现"
          meta={<Text type="secondary">发现脚本、事件源、能力包、插件和 Skill，支持安装、升级与同步。</Text>}
          actions={(
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/packages/publish")}>
                发布能力包
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void discovery.loadData()} loading={discovery.loading}>
                刷新目录
              </Button>
            </Space>
          )}
        />

        <Card>
          <DiscoveryFiltersBar
            repositories={discovery.repositories}
            searchText={discovery.searchText}
            repositoryFilter={discovery.repositoryFilter}
            typeFilter={discovery.typeFilter}
            installFilter={discovery.installFilter}
            trustFilter={discovery.trustFilter}
            onSearchTextChange={discovery.setSearchText}
            onRepositoryFilterChange={discovery.setRepositoryFilter}
            onTypeFilterChange={discovery.setTypeFilter}
            onInstallFilterChange={discovery.setInstallFilter}
            onTrustFilterChange={discovery.setTrustFilter}
          />
        </Card>

        <Card>
          <DiscoveryCatalogTabs
            loading={discovery.loading}
            actionKey={discovery.actionKey}
            packageActionKey={discovery.packageActionKey}
            filteredTools={discovery.filteredTools}
            filteredEventSources={discovery.filteredEventSources}
            filteredPackages={discovery.filteredPackages}
            filteredSkills={discovery.filteredSkills}
            filteredPlugins={discovery.filteredPlugins}
            onOpenToolDetail={discovery.openDetail}
            onOpenEventSourceDetail={discovery.openEventSourceDetail}
            onOpenPackageDetail={discovery.openPackageDetail}
            onOpenSkillDetail={discovery.openSkillDetail}
            onOpenSkillInstall={discovery.openSkillInstall}
            onToolLocalAssetAction={discovery.confirmToolLocalAssetAction}
            onAddToolToLocal={discovery.confirmAddToolToLocal}
            onEventSourceLocalAssetAction={discovery.confirmEventSourceLocalAssetAction}
            onAddEventSourceToLocal={discovery.confirmAddEventSourceToLocal}
            onPackageInstall={discovery.handlePackageInstall}
            onPackageUninstall={discovery.handlePackageUninstall}
            onPluginAction={discovery.handleRepositoryPluginAction}
            onNavigate={(path) => navigate(path)}
          />
        </Card>
      </Space>

      <DiscoveryDetailDrawers
        editorTheme={editorTheme}
        actionKey={discovery.actionKey}
        packageActionKey={discovery.packageActionKey}
        detailOpen={discovery.detailOpen}
        detailLoading={discovery.detailLoading}
        detail={discovery.detail}
        availableTools={discovery.tools}
        availablePlugins={discovery.plugins}
        eventSourceDetailOpen={discovery.eventSourceDetailOpen}
        eventSourceDetailLoading={discovery.eventSourceDetailLoading}
        eventSourceDetail={discovery.eventSourceDetail}
        packageDetailOpen={discovery.packageDetailOpen}
        packageDetailLoading={discovery.packageDetailLoading}
        packageDetail={discovery.packageDetail}
        skillDetailOpen={discovery.skillDetailOpen}
        skillDetailLoading={discovery.skillDetailLoading}
        skillDetail={discovery.skillDetail}
        onCloseToolDetail={discovery.closeDetail}
        onCloseEventSourceDetail={discovery.closeEventSourceDetail}
        onClosePackageDetail={discovery.closePackageDetail}
        onCloseSkillDetail={discovery.closeSkillDetail}
        onOpenSkillInstall={discovery.openSkillInstall}
        onToolLocalAssetAction={discovery.confirmToolLocalAssetAction}
        onAddToolToLocal={discovery.confirmAddToolToLocal}
        onEventSourceLocalAssetAction={discovery.confirmEventSourceLocalAssetAction}
        onAddEventSourceToLocal={discovery.confirmAddEventSourceToLocal}
        onPackageInstall={discovery.handlePackageInstall}
        onPackageUninstall={discovery.handlePackageUninstall}
        onNavigate={(path) => navigate(path)}
      />

      <RepositorySkillInstallDrawer
        open={discovery.skillInstallDescriptor !== null}
        descriptor={discovery.skillInstallDescriptor}
        onClose={discovery.closeSkillInstall}
        onSuccess={() => {
          discovery.closeSkillInstall();
          void discovery.loadData();
        }}
      />
    </>
  );
}
