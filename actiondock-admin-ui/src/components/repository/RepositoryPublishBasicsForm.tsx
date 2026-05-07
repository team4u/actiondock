import { Form, Input, Select, Space } from "antd";
import type { ReactNode } from "react";
import type { RepositoryDefinition } from "../../shared/types";

interface OptionItem {
  value: string;
  label: string;
}

interface RepositoryPublishBasicsFormProps {
  repositories: RepositoryDefinition[];
  afterRepository?: ReactNode;
  repositoryFieldName?: string;
  repositoryLabel?: string;
  repositoryRequiredMessage?: string;
  repositoryShowSearch?: boolean;
  repositoryOptionFilterProp?: string;
  repositoryPlaceholder?: string;
  displayNameFieldName?: string;
  displayNameLabel?: string;
  displayNamePlaceholder?: string;
  versionFieldName?: string;
  versionLabel?: string;
  versionPlaceholder?: string;
  versionExtra?: ReactNode;
  descriptionFieldName?: string;
  descriptionLabel?: string;
  descriptionPlaceholder?: string;
  showDescription?: boolean;
  ownerFieldName?: string;
  ownerLabel?: string;
  ownerPlaceholder?: string;
  showOwner?: boolean;
  tagsFieldName?: string;
  tagsLabel?: string;
  tagsPlaceholder?: string;
  tagsMode?: "select" | "text";
  showTags?: boolean;
  releaseNotesFieldName?: string;
  releaseNotesLabel?: string;
  releaseNotesPlaceholder?: string;
  showReleaseNotes?: boolean;
  riskLevelFieldName?: string;
  showRiskLevel?: boolean;
  riskLevelAllowClear?: boolean;
  riskLevelOptions?: OptionItem[];
}

const defaultRiskLevelOptions: OptionItem[] = [
  { value: "LOW", label: "LOW" },
  { value: "MEDIUM", label: "MEDIUM" },
  { value: "HIGH", label: "HIGH" }
];

export function RepositoryPublishBasicsForm({
  repositories,
  afterRepository,
  repositoryFieldName = "repositoryId",
  repositoryLabel = "目标仓库",
  repositoryRequiredMessage = "请选择目标仓库",
  repositoryShowSearch = true,
  repositoryOptionFilterProp = "label",
  repositoryPlaceholder,
  displayNameFieldName = "displayName",
  displayNameLabel = "显示名称",
  displayNamePlaceholder,
  versionFieldName = "version",
  versionLabel = "版本",
  versionPlaceholder,
  versionExtra,
  descriptionFieldName = "description",
  descriptionLabel = "说明",
  descriptionPlaceholder,
  showDescription = true,
  ownerFieldName = "owner",
  ownerLabel = "维护人",
  ownerPlaceholder,
  showOwner = true,
  tagsFieldName = "tags",
  tagsLabel = "标签",
  tagsPlaceholder,
  tagsMode = "select",
  showTags = true,
  releaseNotesFieldName = "releaseNotes",
  releaseNotesLabel = "发布日志",
  releaseNotesPlaceholder,
  showReleaseNotes = true,
  riskLevelFieldName = "riskLevel",
  showRiskLevel = false,
  riskLevelAllowClear = true,
  riskLevelOptions = defaultRiskLevelOptions
}: RepositoryPublishBasicsFormProps) {
  return (
    <>
      <Form.Item
        label={repositoryLabel}
        name={repositoryFieldName}
        rules={[{ required: true, message: repositoryRequiredMessage }]}
      >
        <Select
          showSearch={repositoryShowSearch}
          optionFilterProp={repositoryOptionFilterProp}
          placeholder={repositoryPlaceholder}
          options={repositories.map((item) => ({
            value: item.id,
            label: item.name
          }))}
        />
      </Form.Item>
      {afterRepository}
      <Form.Item
        label={displayNameLabel}
        name={displayNameFieldName}
        rules={[{ required: true, message: `请输入${displayNameLabel}` }]}
      >
        <Input placeholder={displayNamePlaceholder} />
      </Form.Item>
      <Space size={12} style={{ width: "100%" }} align="start">
        <Form.Item
          label={versionLabel}
          name={versionFieldName}
          rules={[{ required: true, message: `请输入${versionLabel}` }]}
          extra={versionExtra}
          style={{ flex: 1 }}
        >
          <Input placeholder={versionPlaceholder} />
        </Form.Item>
        {showOwner ? (
          <Form.Item label={ownerLabel} name={ownerFieldName} style={{ flex: 1 }}>
            <Input placeholder={ownerPlaceholder} />
          </Form.Item>
        ) : null}
        {showRiskLevel ? (
          <Form.Item label="风险等级" name={riskLevelFieldName} style={{ flex: 1 }}>
            <Select
              allowClear={riskLevelAllowClear}
              options={riskLevelOptions}
            />
          </Form.Item>
        ) : null}
      </Space>
      {showTags ? (
        <Form.Item label={tagsLabel} name={tagsFieldName}>
          {tagsMode === "text" ? (
            <Input placeholder={tagsPlaceholder} />
          ) : (
            <Select mode="tags" tokenSeparators={[","]} placeholder={tagsPlaceholder} />
          )}
        </Form.Item>
      ) : null}
      {showDescription ? (
        <Form.Item label={descriptionLabel} name={descriptionFieldName}>
          <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder={descriptionPlaceholder} />
        </Form.Item>
      ) : null}
      {showReleaseNotes ? (
        <Form.Item label={releaseNotesLabel} name={releaseNotesFieldName}>
          <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} placeholder={releaseNotesPlaceholder} />
        </Form.Item>
      ) : null}
    </>
  );
}
