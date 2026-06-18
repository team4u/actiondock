import { DeleteOutlined, DownOutlined, DownloadOutlined, ExportOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Key } from "react";
import type { Playbook } from "../../../shared/types";
import type { PlaybookFilters } from "../hooks/usePlaybookData";

export interface PlaybookListProps {
  items: Playbook[];
  loading: boolean;
  filters: PlaybookFilters;
  selectedPlaybookIds: Key[];
  tags: string[];
  repositoryOptions: { value: string; label: string }[];
  editablePlaybooks: Playbook[];
  onFiltersChange: (next: PlaybookFilters) => void;
  onSelectChange: (ids: Key[]) => void;
  onEdit: (item: Playbook) => void;
  onCreate: () => void;
  onPublish: (item: Playbook) => void;
  onDelete: (item: Playbook) => void;
  onExport: (items: Playbook[], successMessage: string) => void;
  onImportClick: () => void;
}

/**
 * 任务手册列表：筛选（意图/Repository/Tag/Managed）+ 批量导入导出 + 行操作（编辑/发布/删除/导出）。
 */
export function PlaybookList(props: PlaybookListProps) {
  const {
    items,
    loading,
    filters,
    selectedPlaybookIds,
    tags,
    repositoryOptions,
    editablePlaybooks,
    onFiltersChange,
    onSelectChange,
    onEdit,
    onCreate,
    onPublish,
    onDelete,
    onExport,
    onImportClick
  } = props;

  const handleExportSelected = () => {
    const selectedPlaybooks = editablePlaybooks.filter((item) => selectedPlaybookIds.includes(item.id));
    onExport(selectedPlaybooks, `已导出 ${selectedPlaybooks.length} 个选中任务手册`);
  };

  const handleExportVisible = () => {
    const targetPlaybooks = items.filter((item) => !item.managed);
    onExport(targetPlaybooks, `已导出 ${targetPlaybooks.length} 个可编辑任务手册`);
  };

  const bulkActionMenu = {
    items: [
      {
        key: "import",
        label: "导入任务手册",
        icon: <UploadOutlined />,
        onClick: onImportClick
      },
      {
        key: "exportEditable",
        label: "导出可编辑",
        icon: <DownloadOutlined />,
        disabled: editablePlaybooks.length === 0,
        onClick: handleExportVisible
      },
      {
        key: "exportSelected",
        label: "导出选中",
        icon: <ExportOutlined />,
        disabled: selectedPlaybookIds.length === 0,
        onClick: handleExportSelected
      }
    ]
  };

  const columns: ColumnsType<Playbook> = [
    {
      title: "ID",
      dataIndex: "id",
      width: 320,
      ellipsis: true,
      render: (value, item) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onEdit(item)}>
          {value}
        </Button>
      )
    },
    { title: "名称", dataIndex: "name" },
    {
      title: "状态",
      key: "status",
      width: 150,
      render: (_, item) => (
        <Space>
          {item.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
          {item.managed ? <Tag color="blue">托管</Tag> : null}
        </Space>
      )
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      fixed: "right",
      render: (_, item) => {
        const menuItems = [
          {
            key: "publish",
            label: "发布到仓库",
            disabled: item.managed,
            onClick: () => onPublish(item)
          },
          {
            key: "export",
            label: "导出",
            disabled: item.managed,
            onClick: () => onExport([item], `已导出 ${item.name || item.id}`)
          }
        ];

        return (
          <Space size="middle">
            <Dropdown menu={{ items: menuItems }}>
              <Button type="link" size="small" style={{ padding: 0 }}>
                更多 <DownOutlined />
              </Button>
            </Dropdown>
            <Popconfirm
              title="确认删除任务手册？"
              description={`你确定要删除任务手册 "${item.name || item.id}" 吗？`}
              okText="删除"
              okType="danger"
              cancelText="取消"
              disabled={item.managed}
              onConfirm={() => onDelete(item)}
            >
              <Button type="link" size="small" danger disabled={item.managed} style={{ padding: 0 }}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      }
    }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space wrap>
        <Input.Search
          allowClear
          placeholder="按意图搜索"
          style={{ width: 260 }}
          onSearch={(intent) => onFiltersChange({ ...filters, intent: intent.trim() || undefined })}
        />
        <Select
          allowClear
          placeholder="Repository"
          style={{ width: 220 }}
          options={repositoryOptions}
          onChange={(repositoryId) => onFiltersChange({ ...filters, repositoryId })}
        />
        <Select
          allowClear
          placeholder="Tag"
          style={{ width: 160 }}
          options={tags.map((item) => ({ value: item, label: item }))}
          onChange={(tag) => onFiltersChange({ ...filters, tag })}
        />
        <Select
          allowClear
          placeholder="Managed"
          style={{ width: 140 }}
          options={[{ value: true, label: "托管" }]}
          onChange={(managed) => onFiltersChange({ ...filters, managed })}
        />
      </Space>
      <Space wrap style={{ marginBottom: 8 }}>
        <Dropdown menu={bulkActionMenu}>
          <Button>
            批量操作 <DownOutlined />
          </Button>
        </Dropdown>
        <Button type="primary" onClick={onCreate}>
          新建任务手册
        </Button>
      </Space>
      <Table<Playbook>
        rowKey="id"
        loading={loading}
        dataSource={items}
        rowSelection={{
          selectedRowKeys: selectedPlaybookIds,
          onChange: onSelectChange,
          getCheckboxProps: (record) => ({ disabled: record.managed })
        }}
        scroll={{ x: 800 }}
        columns={columns}
      />
    </Space>
  );
}
