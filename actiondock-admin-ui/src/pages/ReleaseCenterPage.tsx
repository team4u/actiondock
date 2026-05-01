import {
  ArrowRightOutlined,
  PlusOutlined,
  RocketOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listCapabilityPackages,
  listPlugins,
  listRepositories,
  listScripts
} from "../api";
import { PageHeader } from "../components/PageHeader";
import { getPublishableRepositories } from "../repositoryPublish";
import type {
  CapabilityPackageDescriptor,
  PluginView,
  RepositoryDefinition,
  ScriptDefinition
} from "../types";
import { formatDateTime, getErrorMessage } from "../utils";

const { Text } = Typography;

function sortByRecent(left?: string, right?: string): number {
  return (right ?? "").localeCompare(left ?? "");
}

export function ReleaseCenterPage() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [repositories, setRepositories] = useState<RepositoryDefinition[]>([]);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [packages, setPackages] = useState<CapabilityPackageDescriptor[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [repositoryData, scriptData, pluginData, packageData] = await Promise.all([
          listRepositories(),
          listScripts(),
          listPlugins(),
          listCapabilityPackages()
        ]);
        setRepositories(repositoryData);
        setScripts([...scriptData].sort((left, right) => sortByRecent(left.updatedAt ?? left.createdAt, right.updatedAt ?? right.createdAt)));
        setPlugins([...pluginData].sort((left, right) => left.pluginId.localeCompare(right.pluginId)));
        setPackages([...packageData].sort((left, right) => right.version.localeCompare(left.version)));
      } catch (error) {
        messageApi.error(getErrorMessage(error, "加载发布中心失败"));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [messageApi]);

  const publishableRepositories = useMemo(() => getPublishableRepositories(repositories), [repositories]);
  const editableScripts = useMemo(() => scripts.filter((item) => item.editable !== false), [scripts]);
  const scriptColumns: ColumnsType<ScriptDefinition> = [
    {
      title: "脚本",
      key: "script",
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Space wrap size={[8, 8]}>
            <Text strong>{record.name}</Text>
            <Text code>{record.id}</Text>
          </Space>
          <Space wrap size={[6, 6]}>
            <Tag>{record.type}</Tag>
            <Tag>{record.scope ?? "PERSONAL"}</Tag>
            {record.hasUnpublishedChanges ? <Tag color="gold">有未发布变更</Tag> : null}
          </Space>
        </Space>
      )
    },
    {
      title: "更新时间",
      key: "updatedAt",
      width: 180,
      render: (_value: unknown, record) => formatDateTime(record.updatedAt ?? record.createdAt)
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_value: unknown, record) => (
        <Space wrap>
          <Button
            type="primary"
            size="small"
            icon={<RocketOutlined />}
            disabled={record.editable === false}
            onClick={() => navigate(`/scripts/${encodeURIComponent(record.id)}?publish=1`)}
          >
            {record.editable === false ? "只读" : "发布"}
          </Button>
          <Button size="small" icon={<ArrowRightOutlined />} onClick={() => navigate(`/scripts/${encodeURIComponent(record.id)}`)}>
            打开
          </Button>
        </Space>
      )
    }
  ];
  const pluginColumns: ColumnsType<PluginView> = [
    {
      title: "插件",
      key: "plugin",
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Space wrap size={[8, 8]}>
            <Text strong>{record.name}</Text>
            <Text code>{record.pluginId}</Text>
          </Space>
          <Space wrap size={[6, 6]}>
            <Tag>{record.version}</Tag>
            {record.repositoryId ? <Tag color="blue">{record.repositoryId}</Tag> : <Tag>本地插件</Tag>}
          </Space>
        </Space>
      )
    },
    {
      title: "状态",
      key: "state",
      width: 140,
      render: (_value: unknown, record) => (
        <Space wrap size={[6, 6]}>
          {record.started ? <Tag color="green">已启动</Tag> : <Tag>已停止</Tag>}
          {record.configurable ? <Tag color="processing">可配置</Tag> : <Tag>只读</Tag>}
        </Space>
      )
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_value: unknown, record) => (
        <Space wrap>
          <Button
            type="primary"
            size="small"
            icon={<UploadOutlined />}
            onClick={() => navigate(`/plugins/${encodeURIComponent(record.pluginId)}?publish=1`)}
          >
            发布
          </Button>
          <Button size="small" icon={<ArrowRightOutlined />} onClick={() => navigate(`/plugins/${encodeURIComponent(record.pluginId)}`)}>
            打开
          </Button>
        </Space>
      )
    }
  ];
  const packageColumns: ColumnsType<CapabilityPackageDescriptor> = [
    {
      title: "能力包",
      key: "package",
      render: (_value: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Space wrap size={[8, 8]}>
            <Text strong>{record.displayName}</Text>
            <Text code>{record.packageId}</Text>
          </Space>
          <Space wrap size={[6, 6]}>
            <Tag>{record.version}</Tag>
            {record.repositoryId ? <Tag color="blue">{record.repositoryId}</Tag> : null}
            {record.updateAvailable ? <Tag color="gold">可更新</Tag> : <Tag color="green">已是最新</Tag>}
          </Space>
        </Space>
      )
    },
    {
      title: "入口",
      key: "entries",
      render: (_value: unknown, record) => (
        <Text code>{record.entries.map((item) => `${item.type}:${item.id}`).join(", ") || "-"}</Text>
      )
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_value: unknown, record) => (
        <Space wrap>
          <Button
            type="primary"
            size="small"
            icon={<RocketOutlined />}
            onClick={() => navigate(`/packages/${encodeURIComponent(record.packageId)}/releases/new?repositoryId=${encodeURIComponent(record.repositoryId)}`)}
          >
            继续发布
          </Button>
          <Button size="small" icon={<ArrowRightOutlined />} onClick={() => navigate(`/packages/${encodeURIComponent(record.packageId)}/releases/new?repositoryId=${encodeURIComponent(record.repositoryId)}`)}>
            打开
          </Button>
        </Space>
      )
    }
  ];

  const summaryCards = (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={8}>
        <Card>
          <Space direction="vertical" size={6}>
            <Text type="secondary">可发布脚本</Text>
            <Text style={{ fontSize: 28, fontWeight: 700 }}>{editableScripts.length}</Text>
            <Text type="secondary">可直接打开脚本编辑器并进入仓库发布</Text>
          </Space>
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card>
          <Space direction="vertical" size={6}>
            <Text type="secondary">插件</Text>
            <Text style={{ fontSize: 28, fontWeight: 700 }}>{plugins.length}</Text>
            <Text type="secondary">JAR artifact 发布到仓库</Text>
          </Space>
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card>
          <Space direction="vertical" size={6}>
            <Text type="secondary">能力包</Text>
            <Text style={{ fontSize: 28, fontWeight: 700 }}>{packages.length}</Text>
            <Text type="secondary">脚本、Agent、模型和 Toolset 的 release</Text>
          </Space>
        </Card>
      </Col>
    </Row>
  );

  const scriptTab = (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title="脚本发布"
        extra={(
          <Space wrap>
            <Button onClick={() => navigate("/scripts")}>脚本库</Button>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              disabled={publishableRepositories.length === 0}
              onClick={() => navigate("/scripts")}
            >
              去脚本发布
            </Button>
          </Space>
        )}
      >
        <Alert
          type="info"
          showIcon
          message="脚本发布先生成发布快照，再写入仓库工具目录。仓库脚本本身是只读的，需要先 Fork。"
        />
      </Card>
      {editableScripts.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可发布脚本" />
      ) : (
        <Table<ScriptDefinition>
          rowKey="id"
          size="small"
          pagination={{ pageSize: 5, hideOnSinglePage: true }}
          dataSource={editableScripts.slice(0, 10)}
          columns={scriptColumns}
        />
      )}
    </Space>
  );

  const pluginTab = (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title="插件发布"
        extra={(
          <Space wrap>
            <Button onClick={() => navigate("/plugins")}>插件管理</Button>
            <Button type="primary" icon={<UploadOutlined />} onClick={() => navigate("/plugins")}>
              去插件发布
            </Button>
          </Space>
        )}
      >
        <Alert
          type="info"
          showIcon
          message="插件发布直接打包并校验 artifact。与脚本发布不同，这里不产出脚本快照。"
        />
      </Card>
      {plugins.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有已安装插件" />
      ) : (
        <Table<PluginView>
          rowKey="pluginId"
          size="small"
          pagination={{ pageSize: 5, hideOnSinglePage: true }}
          dataSource={plugins.slice(0, 10)}
          columns={pluginColumns}
        />
      )}
    </Space>
  );

  const packageTab = (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title="AI 能力包发布"
        extra={(
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => navigate("/packages/publish?source=AGENT")}>从 Agent</Button>
            <Button icon={<PlusOutlined />} onClick={() => navigate("/packages/publish?source=SCRIPT")}>从脚本</Button>
            <Button type="primary" icon={<RocketOutlined />} onClick={() => navigate("/packages/publish?source=MANUAL")}>手动组装</Button>
          </Space>
        )}
      >
        <Alert
          type="info"
          showIcon
          message="能力包是闭包发布：入口、脚本、Agent、模型、Toolset、配置模板、定时任务和预设一起生成 release。"
        />
      </Card>
      {packages.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有能力包" />
      ) : (
        <Table<CapabilityPackageDescriptor>
          rowKey={(item) => `${item.repositoryId}:${item.packageId}:${item.version}`}
          size="small"
          pagination={{ pageSize: 5, hideOnSinglePage: true }}
          dataSource={packages.slice(0, 10)}
          columns={packageColumns}
        />
      )}
    </Space>
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <PageHeader
        title="发布中心"
        meta="统一入口，分别处理脚本、插件和 AI 能力包的发布动作。"
      />

      <Alert
        type="info"
        showIcon
        message="脚本、插件、能力包共用发布入口，但各自仍保留独立的校验、预览和落盘逻辑。"
        description="从这里进入后，脚本会打开脚本编辑器的发布面板，插件会打开插件详情页的发布弹窗，能力包会进入能力包发布页。"
      />

      {summaryCards}

      {loading ? (
        <Card>
          <div style={{ padding: "32px 0", textAlign: "center" }}>
            <Spin size="large" />
          </div>
        </Card>
      ) : (
        <Tabs
          defaultActiveKey="script"
          items={[
            { key: "script", label: "脚本", children: scriptTab },
            { key: "plugin", label: "插件", children: pluginTab },
            { key: "package", label: "AI 能力包", children: packageTab }
          ]}
        />
      )}
    </Space>
  );
}
