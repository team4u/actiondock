import { Input, Select, Space } from "antd";
import type { ChangeEvent } from "react";
import type { RepositoryDefinition } from "../../../../shared/types";
import type { InstallFilter, TrustFilter, TypeFilter } from "./types";

interface DiscoveryFiltersBarProps {
  repositories: RepositoryDefinition[];
  searchText: string;
  repositoryFilter: string;
  typeFilter: TypeFilter;
  installFilter: InstallFilter;
  trustFilter: TrustFilter;
  onSearchTextChange: (value: string) => void;
  onRepositoryFilterChange: (value: string) => void;
  onTypeFilterChange: (value: TypeFilter) => void;
  onInstallFilterChange: (value: InstallFilter) => void;
  onTrustFilterChange: (value: TrustFilter) => void;
}

export function DiscoveryFiltersBar({
  repositories,
  searchText,
  repositoryFilter,
  typeFilter,
  installFilter,
  trustFilter,
  onSearchTextChange,
  onRepositoryFilterChange,
  onTypeFilterChange,
  onInstallFilterChange,
  onTrustFilterChange
}: DiscoveryFiltersBarProps) {
  return (
    <Space wrap size={[12, 12]} style={{ width: "100%" }}>
      <Input.Search
        allowClear
        value={searchText}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchTextChange(event.target.value)}
        placeholder="搜索能力包、脚本、来源仓库或维护人"
        style={{ minWidth: 220, flex: "1 1 280px" }}
      />
      <Select
        value={repositoryFilter}
        onChange={onRepositoryFilterChange}
        style={{ minWidth: 180 }}
        options={[
          { value: "ALL", label: "全部仓库" },
          ...repositories.map((item) => ({ value: item.id, label: item.name }))
        ]}
      />
      <Select
        value={installFilter}
        onChange={onInstallFilterChange}
        style={{ minWidth: 130 }}
        options={[
          { value: "ALL", label: "全部状态" },
          { value: "INSTALLED", label: "已安装" },
          { value: "NOT_INSTALLED", label: "未安装" }
        ]}
      />
      <Select
        value={trustFilter}
        onChange={onTrustFilterChange}
        style={{ minWidth: 130 }}
        options={[
          { value: "ALL", label: "全部信任级别" },
          { value: "TRUSTED", label: "可信仓库" },
          { value: "UNTRUSTED", label: "未信任仓库" }
        ]}
      />
      <Select
        value={typeFilter}
        onChange={onTypeFilterChange}
        style={{ minWidth: 130 }}
        options={[
          { value: "ALL", label: "全部脚本类型" },
          { value: "PYTHON", label: "Python" },
          { value: "GROOVY", label: "Groovy" }
        ]}
      />
    </Space>
  );
}
