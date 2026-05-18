import {
  FileMarkdownOutlined,
  FileOutlined,
  FolderOpenOutlined
} from "@ant-design/icons";
import { Alert, Empty, Image, Space, Spin, Tree, Typography } from "antd";
import type { DataNode } from "antd/es/tree";
import { useEffect, useMemo, useState } from "react";
import { CodeEditor } from "../common/CodeEditor";
import { MarkdownDescription } from "../common/MarkdownDescription";
import type { SkillFileNode, SkillFilePreview } from "../../shared/types";

const { Text } = Typography;

export interface SkillFileBrowserProps {
  files: SkillFileNode[];
  onPreviewFile: (path: string) => Promise<SkillFilePreview | null>;
  editorTheme: "vs-dark" | "vs-light";
  loading?: boolean;
  emptyText?: string;
}

function findFileByName(nodes: SkillFileNode[], name: string): string | null {
  for (const node of nodes) {
    if (!node.directory && node.name.toLowerCase() === name) {
      return node.path;
    }
    if (node.directory) {
      const nested = findFileByName(node.children, name);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export function findDefaultFile(nodes: SkillFileNode[]): string | null {
  return findFileByName(nodes, "readme.md") || findFileByName(nodes, "skill.md");
}

function toTreeData(nodes: SkillFileNode[]): DataNode[] {
  return nodes.map((node) => ({
    key: node.path,
    title: node.name,
    icon: node.directory ? <FolderOpenOutlined /> : node.name.toLowerCase().endsWith(".md") ? <FileMarkdownOutlined /> : <FileOutlined />,
    isLeaf: !node.directory,
    children: toTreeData(node.children)
  }));
}

function collectExpandedKeys(nodes: SkillFileNode[]): string[] {
  const keys: string[] = [];
  for (const node of nodes) {
    if (node.directory) {
      keys.push(node.path);
      keys.push(...collectExpandedKeys(node.children));
    }
  }
  return keys;
}

export function SkillFileBrowser({
  files,
  onPreviewFile,
  editorTheme,
  loading = false,
  emptyText = "请选择文件查看预览"
}: SkillFileBrowserProps) {
  const [preview, setPreview] = useState<SkillFilePreview | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

  const treeData = useMemo(() => toTreeData(files), [files]);

  useEffect(() => {
    if (files.length === 0) {
      setPreview(null);
      setSelectedPath(undefined);
      setExpandedKeys([]);
      return;
    }
    setExpandedKeys(collectExpandedKeys(files));
    const defaultPath = findDefaultFile(files);
    if (defaultPath) {
      setSelectedPath(defaultPath);
      setPreviewLoading(true);
      onPreviewFile(defaultPath)
        .then(setPreview)
        .finally(() => setPreviewLoading(false));
    } else {
      setPreview(null);
      setSelectedPath(undefined);
    }
  }, [files, onPreviewFile]);

  const handleSelect = async (keys: React.Key[]) => {
    const key = keys[0];
    if (typeof key !== "string") {
      return;
    }
    setSelectedPath(key);
    setPreviewLoading(true);
    try {
      setPreview(await onPreviewFile(key));
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="skill-detail-layout">
        <div className="skill-detail-preview__loading"><Spin /></div>
      </div>
    );
  }

  return (
    <div className="skill-detail-layout">
      <aside className="skill-detail-sidebar">
        <Text strong>文件</Text>
        {treeData.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有文件" />
        ) : (
          <Tree
            showIcon
            blockNode
            expandedKeys={expandedKeys}
            selectedKeys={selectedPath ? [selectedPath] : []}
            treeData={treeData}
            onExpand={(keys) => setExpandedKeys(keys)}
            onSelect={(keys) => void handleSelect(keys)}
          />
        )}
      </aside>
      <section className="skill-detail-preview">
        {previewLoading ? (
          <div className="skill-detail-preview__loading"><Spin /></div>
        ) : !preview ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
        ) : preview.previewType === "MARKDOWN" ? (
          <div className="skill-preview-panel">
            {preview.truncated ? <Alert type="warning" showIcon message="文件内容过长，当前只展示前 200000 个字符。" /> : null}
            <MarkdownDescription value={preview.textContent} className="markdown-description--panel" emptyText="文件为空" />
          </div>
        ) : preview.previewType === "TEXT" ? (
          <div className="skill-preview-panel">
            {preview.truncated ? <Alert type="warning" showIcon message="文件内容过长，当前只展示前 200000 个字符。" /> : null}
            <CodeEditor
              value={preview.textContent ?? ""}
              onChange={() => undefined}
              theme={editorTheme}
              language={preview.language || "plaintext"}
              readOnly
              height="560px"
            />
          </div>
        ) : preview.previewType === "IMAGE" ? (
          <div className="skill-preview-panel skill-preview-panel--image">
            <Image src={preview.dataUrl} alt={preview.name} />
          </div>
        ) : preview.previewType === "DIRECTORY" ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="目录没有直接预览内容" />
        ) : (
          <Alert
            type="info"
            showIcon
            message="当前文件类型不支持在线预览"
            description={<Text code>{preview.contentType}</Text>}
          />
        )}
      </section>
    </div>
  );
}
