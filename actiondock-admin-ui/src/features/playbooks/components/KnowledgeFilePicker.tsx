import { FileMarkdownOutlined, FileOutlined, FolderOpenOutlined } from "@ant-design/icons";
import type { DataNode } from "antd/es/tree";
import { Alert, Empty, Grid, Image, Modal, Spin, Tree, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { MarkdownDescription } from "../../../components/common/MarkdownDescription";
import { CodeEditor } from "../../../components/common/CodeEditor";
import { getErrorMessage } from "../../../services/utils";
import type {
  RepositoryProjectFileNode,
  RepositoryProjectFilePreview
} from "../../../shared/types";
import {
  listProjectRepositoryFiles,
  previewProjectRepositoryFile
} from "../../resources/api";

const { Text } = Typography;
const { useBreakpoint } = Grid;

export interface KnowledgeFilePickerProps {
  open: boolean;
  repositoryId?: string;
  repositoryName?: string;
  /** 判断目标仓库是否已引用指定文件，用于确定确认按钮可用性与提示。 */
  hasFile: (repositoryId: string, path: string) => boolean;
  onConfirm: (repositoryId: string, path: string) => void;
  onCancel: () => void;
  editorTheme: "vs-light" | "vs-dark";
}

function attachChildren(
  nodes: RepositoryProjectFileNode[],
  childrenMap: Record<string, RepositoryProjectFileNode[]>,
  expandedKeys: Set<string>
): DataNode[] {
  return nodes.map((node) => ({
    key: node.path,
    title: node.name,
    icon: node.directory ? <FolderOpenOutlined /> : node.path.toLowerCase().endsWith(".md") ? <FileMarkdownOutlined /> : <FileOutlined />,
    isLeaf: !node.directory,
    children: node.directory ? attachChildren(childrenMap[node.path] ?? [], childrenMap, expandedKeys) : undefined
  }));
}

/**
 * 知识文件选择器 Modal：浏览项目仓库文件树并预览，确认后回填文件引用。
 */
export function KnowledgeFilePicker({
  open,
  repositoryId,
  repositoryName,
  hasFile,
  onConfirm,
  onCancel,
  editorTheme
}: KnowledgeFilePickerProps) {
  const screens = useBreakpoint();
  const isCompact = !screens.md;
  const [messageApi] = message.useMessage();
  const [fileTree, setFileTree] = useState<RepositoryProjectFileNode[]>([]);
  const [childrenMap, setChildrenMap] = useState<Record<string, RepositoryProjectFileNode[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<RepositoryProjectFilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);

  const loadRoot = useCallback(
    async (targetRepositoryId: string) => {
      setTreeLoading(true);
      try {
        const rootNodes = await listProjectRepositoryFiles(targetRepositoryId);
        setFileTree(rootNodes);
        setChildrenMap({});
      } catch (error) {
        messageApi.error(getErrorMessage(error, "加载项目仓库文件失败"));
      } finally {
        setTreeLoading(false);
      }
    },
    [messageApi]
  );

  const loadChildren = useCallback(
    async (targetRepositoryId: string, path: string) => {
      try {
        const children = await listProjectRepositoryFiles(targetRepositoryId, path);
        setChildrenMap((value) => ({ ...value, [path]: children }));
      } catch (error) {
        messageApi.error(getErrorMessage(error, "加载目录失败"));
      }
    },
    [messageApi]
  );

  // 打开时重置状态并加载根目录
  useEffect(() => {
    if (!open || !repositoryId) {
      return;
    }
    setPreview(null);
    setExpandedKeys([]);
    setSelectedPath(undefined);
    void loadRoot(repositoryId);
  }, [open, repositoryId, loadRoot]);

  const previewFile = useCallback(
    async (targetRepositoryId: string, path: string) => {
      setPreviewLoading(true);
      try {
        const result = await previewProjectRepositoryFile(targetRepositoryId, path);
        setPreview(result);
      } catch (error) {
        setPreview(null);
        messageApi.error(getErrorMessage(error, "预览项目文件失败"));
      } finally {
        setPreviewLoading(false);
      }
    },
    [messageApi]
  );

  const handleExpand = async (keys: React.Key[]) => {
    setExpandedKeys(keys);
    if (!repositoryId) {
      return;
    }
    for (const key of keys) {
      if (typeof key !== "string") {
        continue;
      }
      const targetNode = [...fileTree, ...Object.values(childrenMap).flat()].find((item) => item.path === key);
      if (targetNode?.directory && !childrenMap[key]) {
        await loadChildren(repositoryId, key);
      }
    }
  };

  const handleSelect = async (keys: React.Key[]) => {
    const key = keys[0];
    if (typeof key !== "string" || !repositoryId) {
      return;
    }
    setSelectedPath(key);
    await previewFile(repositoryId, key);
  };

  const treeData = useMemo(
    () => attachChildren(fileTree, childrenMap, new Set(expandedKeys.map(String))),
    [fileTree, childrenMap, expandedKeys]
  );

  const alreadyAdded = Boolean(repositoryId && selectedPath && hasFile(repositoryId, selectedPath));
  const confirmDisabled =
    !preview || preview.directory || selectedPath === "ACTIONDOCK.md" || alreadyAdded;

  const handleOk = () => {
    if (!repositoryId || !selectedPath || !preview || preview.directory || alreadyAdded) {
      return;
    }
    if (selectedPath === "ACTIONDOCK.md") {
      messageApi.warning("ACTIONDOCK.md 会默认读取，无需显式添加");
      return;
    }
    onConfirm(repositoryId, selectedPath);
  };

  const handleCancel = () => {
    setPreview(null);
    onCancel();
  };

  const renderPreview = (): ReactNode => {
    if (previewLoading) {
      return <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>;
    }
    if (!preview) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择文件预览" />;
    }
    if (preview.previewType === "MARKDOWN") {
      return (
        <div className="skill-preview-panel">
          {preview.truncated ? <Alert type="warning" showIcon message="文件内容过长，当前只展示前 200000 个字符。" /> : null}
          <MarkdownDescription value={preview.textContent} className="markdown-description--panel" emptyText="文件为空" />
        </div>
      );
    }
    if (preview.previewType === "TEXT") {
      return (
        <div className="skill-preview-panel">
          {preview.truncated ? <Alert type="warning" showIcon message="文件内容过长，当前只展示前 200000 个字符。" /> : null}
          <CodeEditor
            value={preview.textContent ?? ""}
            onChange={() => undefined}
            theme={editorTheme}
            language={preview.language || "plaintext"}
            readOnly
            height={isCompact ? "300px" : "420px"}
          />
        </div>
      );
    }
    if (preview.previewType === "IMAGE") {
      return <Image src={preview.dataUrl} alt={preview.name} />;
    }
    if (preview.previewType === "DIRECTORY") {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="目录没有直接预览内容" />;
    }
    return <Alert type="info" showIcon message="当前文件类型不支持在线预览" description={<Text code>{preview.contentType}</Text>} />;
  };

  return (
    <Modal
      title={repositoryId ? `选择知识文件 - ${repositoryName ?? repositoryId}` : "选择知识文件"}
      open={open}
      onCancel={handleCancel}
      onOk={handleOk}
      okButtonProps={{ disabled: confirmDisabled }}
      width={isCompact ? "calc(100vw - 24px)" : 960}
      destroyOnHidden
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isCompact ? "minmax(0, 1fr)" : "280px minmax(0, 1fr)",
          gridTemplateRows: isCompact ? "220px minmax(0, 1fr)" : undefined,
          gap: 16,
          minHeight: isCompact ? 560 : 480
        }}
      >
        <div
          style={{
            borderRight: isCompact ? "none" : "1px solid #f0f0f0",
            borderBottom: isCompact ? "1px solid #f0f0f0" : "none",
            paddingRight: isCompact ? 0 : 16,
            paddingBottom: isCompact ? 16 : 0,
            overflow: "auto",
            minHeight: 0
          }}
        >
          {treeLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>
          ) : treeData.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可浏览的文件" />
          ) : (
            <Tree
              showIcon
              blockNode
              expandedKeys={expandedKeys}
              selectedKeys={selectedPath ? [selectedPath] : []}
              treeData={treeData}
              onExpand={(keys) => void handleExpand(keys)}
              onSelect={(keys) => void handleSelect(keys)}
            />
          )}
        </div>
        <div
          style={{
            minWidth: 0,
            overflow: "auto",
            maxHeight: isCompact ? "calc(100vh - 360px)" : undefined
          }}
        >
          {selectedPath === "ACTIONDOCK.md" ? (
            <Alert type="info" showIcon message="ACTIONDOCK.md 会默认读取，无需显式添加到知识引用。" style={{ marginBottom: 12 }} />
          ) : null}
          {alreadyAdded ? <Alert type="warning" showIcon message="该文件已添加为知识引用。" style={{ marginBottom: 12 }} /> : null}
          {renderPreview()}
        </div>
      </div>
    </Modal>
  );
}
