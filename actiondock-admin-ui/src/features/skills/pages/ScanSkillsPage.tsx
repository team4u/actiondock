import {
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  deleteScanDirectory,
  getScanItemDetail,
  getSkillDetail,
  listSkillTargets,
  previewScanItemFile,
  previewSkillFile,
  removeSkillFromTarget,
  scanSkillTarget
} from "../../skills/api";
import { ConfirmDangerAction } from "../../../components/common/ConfirmDangerAction";
import { PageHeader } from "../../../components/common/PageHeader";
import { SkillFileBrowser } from "../../../components/skill/SkillFileBrowser";
import { useColorMode } from "../../../shared/contexts/ColorModeContext";
import { buildSkillManagementSearch } from "../../../services/skillRouting";
import type { SkillFilePreview, SkillScanDetail, SkillScanItem, SkillTarget } from "../../../shared/types";
import { getErrorMessage } from "../../../services/utils";

const { Text } = Typography;

export function ScanSkillsPage() {
  const navigate = useNavigate();
  const { targetId } = useParams<{ targetId: string }>();
  const colorMode = useColorMode();
  const editorTheme = colorMode === "dark" ? "vs-dark" : "vs-light";
  const [messageApi, contextHolder] = message.useMessage();

  const [target, setTarget] = useState<SkillTarget | null>(null);
  const [scanItems, setScanItems] = useState<SkillScanItem[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [detailItem, setDetailItem] = useState<SkillScanItem | null>(null);
  const [detailData, setDetailData] = useState<SkillScanDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadScan = useCallback(async () => {
    if (!targetId) return;
    setScanLoading(true);
    try {
      const [targets, items] = await Promise.all([
        listSkillTargets(),
        scanSkillTarget(targetId)
      ]);
      setTarget(targets.find(t => t.id === targetId) ?? null);
      setScanItems(items);
    } catch (error) {
      messageApi.error(getErrorMessage(error, "扫描 Skill 目标失败"));
    } finally {
      setScanLoading(false);
    }
  }, [targetId, messageApi]);

  useEffect(() => {
    void loadScan();
  }, [loadScan]);

  const handleScanUninstall = async (item: SkillScanItem) => {
    if (!item.skillId || !targetId) return;
    setActionLoading(item.path);
    try {
      await removeSkillFromTarget(item.skillId, targetId);
      messageApi.success(`${item.name || item.id} 已从当前目标移除`);
      await loadScan();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "卸载失败"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleScanDelete = async (item: SkillScanItem) => {
    if (!targetId) return;
    setActionLoading(item.path);
    try {
      await deleteScanDirectory(targetId, item.id);
      messageApi.success(`${item.name || item.id} 已卸载`);
      await loadScan();
    } catch (error) {
      messageApi.error(getErrorMessage(error, "卸载失败"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenDetail = async (item: SkillScanItem) => {
    if (!targetId) return;
    setDetailItem(item);
    setDetailLoading(true);
    setDetailData(null);
    try {
      if (item.managed && item.skillId) {
        const detail = await getSkillDetail(item.skillId);
        setDetailData({
          id: item.id,
          path: item.path,
          name: detail.skill.displayName || item.name,
          description: detail.skill.description || item.description,
          managed: true,
          skillId: item.skillId,
          enabled: detail.skill.enabledTargetCount > 0,
          version: detail.skill.version,
          files: detail.files
        });
      } else {
        setDetailData(await getScanItemDetail(targetId, item.id));
      }
    } catch (error) {
      messageApi.error(getErrorMessage(error, "加载 Skill 详情失败"));
    } finally {
      setDetailLoading(false);
    }
  };

  const detailPreviewFile = useCallback(async (path: string): Promise<SkillFilePreview | null> => {
    if (!detailItem || !targetId) return null;
    if (detailItem.managed && detailItem.skillId) {
      return previewSkillFile(detailItem.skillId, path);
    }
    return previewScanItemFile(targetId, detailItem.id, path);
  }, [detailItem, targetId]);

  const managedCount = scanItems.filter(i => i.managed).length;
  const unmanagedCount = scanItems.length - managedCount;

  const scanColumns: ColumnsType<SkillScanItem> = [
    {
      title: "名称",
      key: "name",
      render: (_value, record) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void handleOpenDetail(record)}>
          {record.name || record.id}
        </Button>
      )
    },
    {
      title: "说明",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
      render: (value: string) => value || <Text type="secondary">-</Text>
    },
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
      width: 80,
      render: (v: string) => v ? <Text code>{v}</Text> : <Text type="secondary">-</Text>
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_value, record) => {
        if (!record.managed) {
          return <Tag>未受管</Tag>;
        }
        return (
          <Space wrap size={[4, 4]}>
            <Tag color="processing">受管</Tag>
            {record.enabled ? <Tag color="success">启用</Tag> : <Tag color="warning">停用</Tag>}
          </Space>
        );
      }
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_value, record) => {
        const isLoading = actionLoading === record.path;
        if (record.managed) {
          return (
            <Space wrap>
              <Button size="small" icon={<EyeOutlined />} onClick={() => void handleOpenDetail(record)}>
                详情
              </Button>
              <ConfirmDangerAction
                title={`卸载 ${record.name || record.id}？`}
                description="仅会把该 Skill 从当前目标移除。"
                okText="卸载"
                onConfirm={() => void handleScanUninstall(record)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} loading={isLoading}>
                  卸载
                </Button>
              </ConfirmDangerAction>
            </Space>
          );
        }
        return (
          <Space wrap>
            <Button size="small" icon={<EyeOutlined />} onClick={() => void handleOpenDetail(record)}>
              详情
            </Button>
            <ConfirmDangerAction
              title={`卸载 ${record.name || record.id}？`}
              description="此操作将永久删除该目录及其所有文件。"
              okText="卸载"
              onConfirm={() => void handleScanDelete(record)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} loading={isLoading}>
                卸载
              </Button>
            </ConfirmDangerAction>
          </Space>
        );
      }
    }
  ];

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageHeader
          title={target ? `扫描：${target.name}` : "目标目录扫描"}
          onBack={() => navigate(`/skills${buildSkillManagementSearch("targets")}`)}
          backLabel="返回目标目录"
          meta={target ? `目录 ${target.rootPath}` : "查看目标目录下发现的 Skill。"}
          actions={
            <Button icon={<ReloadOutlined />} loading={scanLoading} onClick={() => void loadScan()}>
              重新扫描
            </Button>
          }
        />

        <Card loading={scanLoading}>
          {scanItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前目标目录没有发现 SKILL.md" />
          ) : (
            <>
              <Alert
                showIcon
                type="info"
                style={{ marginBottom: 12 }}
                message={`共 ${scanItems.length} 个 Skill，${managedCount} 个受管，${unmanagedCount} 个未受管。`}
              />
              <Table<SkillScanItem>
                rowKey="path"
                dataSource={scanItems}
                pagination={false}
                columns={scanColumns}
                scroll={{ x: 780 }}
              />
            </>
          )}
        </Card>
      </Space>

      <Drawer
        title={detailItem ? `Skill 详情：${detailItem.name || detailItem.id}` : "Skill 详情"}
        open={detailItem !== null}
        onClose={() => { setDetailItem(null); setDetailData(null); }}
        width={860}
        destroyOnHidden
      >
        {detailLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
        ) : !detailData ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="加载失败" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions column={{ xs: 1, md: 2, xl: 3 }} size="small">
              <Descriptions.Item label="目录"><Text code>{detailData.id}</Text></Descriptions.Item>
              {detailData.version && (
                <Descriptions.Item label="版本"><Text code>{detailData.version}</Text></Descriptions.Item>
              )}
              <Descriptions.Item label="状态">
                <Space size={[4, 4]}>
                  {detailData.managed ? <Tag color="processing">受管</Tag> : <Tag>未受管</Tag>}
                  {detailData.managed && (detailData.enabled ? <Tag color="success">启用</Tag> : <Tag color="warning">停用</Tag>)}
                </Space>
              </Descriptions.Item>
              {detailData.description && (
                <Descriptions.Item label="说明" span={3}>{detailData.description}</Descriptions.Item>
              )}
            </Descriptions>

            {(() => {
              const managedSkillId = detailData.managed ? detailData.skillId : undefined;
              if (!managedSkillId) {
                return null;
              }
              return (
                <Button size="small" onClick={() => navigate(`/skills/${encodeURIComponent(managedSkillId)}`)}>
                查看完整安装详情
                </Button>
              );
            })()}

            <SkillFileBrowser
              files={detailData.files}
              onPreviewFile={detailPreviewFile}
              editorTheme={editorTheme}
              loading={detailLoading}
            />
          </Space>
        )}
      </Drawer>
    </>
  );
}
