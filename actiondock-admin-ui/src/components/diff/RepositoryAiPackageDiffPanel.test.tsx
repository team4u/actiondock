import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RepositoryAiPackageDiffPanel, buildRepositoryAiPackageDiff } from "./RepositoryAiPackageDiffPanel";
import type { RepositoryAiPackageDetail, RepositoryAiPackagePublishPreview } from "../../types";

const currentPackage: RepositoryAiPackageDetail = {
  descriptor: {
    repositoryId: "repo-a",
    packageId: "pkg-a",
    installationId: "install-a",
    displayName: "Package A",
    version: "1.0.0",
    owner: "Alice",
    tags: ["ops"],
    packageEntryAgentId: "agent-old",
    installedEntryAgentId: "agent-old",
    packagePath: "packages/pkg-a",
    installed: true,
    updateAvailable: false,
    trusted: true
  },
  packageFile: {
    packageFileVersion: 1,
    id: "pkg-a",
    name: "Package A",
    version: "1.0.0",
    owner: "Alice",
    tags: ["ops"],
    entryAgentId: "agent-old",
    models: [{ id: "model-a", name: "Model A", provider: "AGENTSCOPE", modelProvider: "OPENAI", modelName: "gpt-4o", defaultOptions: {}, limits: {}, capabilities: ["CHAT"], enabled: true }],
    toolsets: [{ id: "toolset-a", name: "Toolset A", description: "A", toolNames: [], toolOptions: {}, maxPermission: "READ_ONLY", enabled: true }],
    agents: [{
      id: "agent-old",
      name: "Agent A",
      description: "A",
      provider: "AGENTSCOPE",
      modelProfileId: "model-a",
      systemPrompt: "hi",
      toolsetIds: ["toolset-a", "toolset-shared"],
      directToolNames: ["agentscope.list_directory", "agentscope.read_file"],
      directToolOptions: {
        "agentscope.list_directory": { path: "/var/app" },
        "agentscope.read_file": { encoding: "utf-8" }
      },
      options: {},
      enabled: true
    }],
    scripts: [{ id: "script-a", name: "Script A", type: "GROOVY", packaging: "TOOL", description: "A", tags: [], source: "return [:]", inputSchema: {}, outputSchema: {}, pluginDependencies: [], aiDependencies: [] }],
    externalDependencies: [{ assetType: "TOOL", repositoryId: "repo-a", assetId: "tool-x", version: "1.0.0" }]
  },
  configTemplate: [
    { key: "config.openai.api_key", label: "API Key", type: "string", required: true, secret: true },
    { key: "config.region", label: "Region", type: "string", required: false, secret: false, defaultValue: "us-east-1" }
  ]
};

const preview: RepositoryAiPackagePublishPreview = {
  entryAgentId: "agent-new",
  modelIds: ["model-a", "model-b"],
  toolsetIds: ["toolset-a"],
  agentIds: ["agent-old", "agent-new"],
  scriptIds: ["script-a", "script-b"],
  configTemplate: [
    { key: "config.openai.api_key", label: "API Key", type: "string", required: true, secret: true },
    { key: "config.region", label: "Region", type: "string", required: false, secret: false, defaultValue: "ap-southeast-1" },
    { key: "config.new_flag", label: "New Flag", type: "string", required: false, secret: false, defaultValue: "on" }
  ],
  externalDependencies: [
    { assetType: "TOOL", repositoryId: "repo-a", assetId: "tool-x", version: "1.1.0" },
    { assetType: "MODEL", repositoryId: "repo-b", assetId: "model-y", version: "2.0.0" }
  ]
};

const sourceToolsetIds = ["toolset-a", "toolset-new"];
const sourceDirectToolNames = ["agentscope.list_directory", "agentscope.exec_shell"];
const sourceDirectToolOptions = {
  "agentscope.list_directory": { path: "/srv/app" },
  "agentscope.exec_shell": { timeoutSeconds: 30 }
};

describe("RepositoryAiPackageDiffPanel", () => {
  it("builds a diff against the current package", () => {
    const diff = buildRepositoryAiPackageDiff(currentPackage, preview, sourceToolsetIds, sourceDirectToolNames, sourceDirectToolOptions);

    expect(diff.comparisonMode).toBe("COMPARE");
    expect(diff.hasChanges).toBe(true);
    expect(diff.assetRows.map((item) => item.label)).toEqual(["入口 Agent", "模型", "Agent", "脚本"]);
    expect(diff.agentTools.toolsetIds.added).toEqual(["toolset-new"]);
    expect(diff.agentTools.toolsetIds.removed).toEqual(["toolset-shared"]);
    expect(diff.agentTools.directToolNames.added).toEqual(["agentscope.exec_shell"]);
    expect(diff.agentTools.directToolNames.removed).toEqual(["agentscope.read_file"]);
    expect(diff.agentTools.directToolOptions.added.map((item) => item.toolName)).toEqual(["agentscope.exec_shell"]);
    expect(diff.agentTools.directToolOptions.removed.map((item) => item.toolName)).toEqual(["agentscope.read_file"]);
    expect(diff.agentTools.directToolOptions.modified).toHaveLength(1);
    expect(diff.configTemplate.added.map((item) => item.key)).toEqual(["config.new_flag"]);
    expect(diff.configTemplate.modified).toHaveLength(1);
    expect(diff.externalDependencies.added).toHaveLength(1);
    expect(diff.externalDependencies.modified).toHaveLength(1);
  });

  it("renders the first-publish fallback when no current package exists", () => {
    const html = renderToStaticMarkup(
      <RepositoryAiPackageDiffPanel
        currentPackage={null}
        preview={preview}
        sourceToolsetIds={sourceToolsetIds}
        sourceDirectToolNames={sourceDirectToolNames}
        sourceDirectToolOptions={sourceDirectToolOptions}
      />
    );

    expect(html).toContain("当前仓库没有同 packageId 的 AI 能力包");
    expect(html).toContain("首次发布");
    expect(html).toContain("配置模板");
    expect(html).toContain("Agent 工具");
  });
});
