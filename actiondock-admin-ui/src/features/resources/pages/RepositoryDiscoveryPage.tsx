import { App, Button, Card, Space, Typography, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
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
  const { modal } = App.useApp();
  const discovery = useRepositoryDiscovery({ messageApi, modal, navigate });

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title="发现"
          meta={<Text type="secondary">发现脚本、Webhook、能力包、插件和 Skill，支持安装、升级与同步。</Text>}
          actions={(
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/packages/publish")}>
                发布能力包
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
            knowledgeActionKey={discovery.knowledgeActionKey}
            installedResourceActionKey={discovery.installedResourceActionKey}
            filteredTools={discovery.filteredTools}
            filteredWebhooks={discovery.filteredWebhooks}
            filteredPlaybooks={discovery.filteredPlaybooks}
            filteredPackages={discovery.filteredPackages}
            filteredSkills={discovery.filteredSkills}
            filteredPlugins={discovery.filteredPlugins}
            filteredKnowledge={discovery.filteredKnowledge}
            filteredInstalledResources={discovery.filteredInstalledResources}
            onOpenToolDetail={discovery.openDetail}
            onOpenWebhookDetail={discovery.openWebhookDetail}
            onOpenPlaybookDetail={discovery.openPlaybookDetail}
            onOpenPackageDetail={discovery.openPackageDetail}
            onOpenSkillDetail={discovery.openSkillDetail}
            onOpenSkillInstall={discovery.openSkillInstall}
            onOpenKnowledgeDetail={discovery.openKnowledgeDetail}
            onToolLocalAssetAction={discovery.confirmToolLocalAssetAction}
            onAddToolToLocal={discovery.confirmAddToolToLocal}
            onWebhookLocalAssetAction={discovery.confirmWebhookLocalAssetAction}
            onAddWebhookToLocal={discovery.confirmAddWebhookToLocal}
            onPlaybookLocalAssetAction={discovery.handlePlaybookLocalAssetAction}
            onPlaybookInstall={discovery.confirmAddPlaybookToLocal}
            onPlaybookUninstall={discovery.handlePlaybookUninstall}
            onPackageInstall={discovery.handlePackageInstall}
            onPackageUninstall={discovery.handlePackageUninstall}
            onPluginAction={discovery.handleRepositoryPluginAction}
            onKnowledgeInstall={discovery.handleKnowledgeInstall}
            onKnowledgeUninstall={discovery.handleKnowledgeUninstall}
            onInstalledResourceUninstall={discovery.handleInstalledResourceUninstall}
            onNavigate={(path) => navigate(path)}
          />
        </Card>
      </Space>

      <DiscoveryDetailDrawers
        editorTheme={editorTheme}
        actionKey={discovery.actionKey}
        packageActionKey={discovery.packageActionKey}
        knowledgeActionKey={discovery.knowledgeActionKey}
        detailOpen={discovery.detailOpen}
        detailLoading={discovery.detailLoading}
        detail={discovery.detail}
        availableTools={discovery.tools}
        availablePlugins={discovery.plugins}
        webhookDetailOpen={discovery.webhookDetailOpen}
        webhookDetailLoading={discovery.webhookDetailLoading}
        webhookDetail={discovery.webhookDetail}
        playbookDetailOpen={discovery.playbookDetailOpen}
        playbookDetailLoading={discovery.playbookDetailLoading}
        playbookDetail={discovery.playbookDetail}
        packageDetailOpen={discovery.packageDetailOpen}
        packageDetailLoading={discovery.packageDetailLoading}
        packageDetail={discovery.packageDetail}
        skillDetailOpen={discovery.skillDetailOpen}
        skillDetailLoading={discovery.skillDetailLoading}
        skillDetail={discovery.skillDetail}
        knowledgeDetailOpen={discovery.knowledgeDetailOpen}
        knowledgeDetailLoading={discovery.knowledgeDetailLoading}
        knowledgeDetail={discovery.knowledgeDetail}
        onCloseToolDetail={discovery.closeDetail}
        onCloseWebhookDetail={discovery.closeWebhookDetail}
        onClosePlaybookDetail={discovery.closePlaybookDetail}
        onClosePackageDetail={discovery.closePackageDetail}
        onCloseSkillDetail={discovery.closeSkillDetail}
        onCloseKnowledgeDetail={discovery.closeKnowledgeDetail}
        onOpenSkillInstall={discovery.openSkillInstall}
        onToolLocalAssetAction={discovery.confirmToolLocalAssetAction}
        onAddToolToLocal={discovery.confirmAddToolToLocal}
        onWebhookLocalAssetAction={discovery.confirmWebhookLocalAssetAction}
        onAddWebhookToLocal={discovery.confirmAddWebhookToLocal}
        onPlaybookLocalAssetAction={discovery.handlePlaybookLocalAssetAction}
        onPlaybookInstall={discovery.confirmAddPlaybookToLocal}
        onPlaybookUninstall={discovery.handlePlaybookUninstall}
        onPackageInstall={discovery.handlePackageInstall}
        onPackageUninstall={discovery.handlePackageUninstall}
        onKnowledgeInstall={discovery.handleKnowledgeInstall}
        onKnowledgeUninstall={discovery.handleKnowledgeUninstall}
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
