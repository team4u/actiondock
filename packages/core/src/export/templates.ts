import { basename } from "node:path";
import type { ActionDefinition } from "@actiondock/sdk";
import type { PlaybookDefinition, ProjectConfig } from "../project/types";

export function generateSkillMd(
  config: ProjectConfig,
  actions: ActionDefinition[],
  playbooks: PlaybookDefinition[],
  binaryRelPath = "./bin/action-bin"
): string {
  const cleanName = config.id.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
  const desc = config.description || `AI Agent skill for ${config.name} (${config.id})`;

  const actionListMd = actions
    .map((a) => {
      const aDesc = a.description ? ` - ${a.description}` : "";
      let params = "";
      if (
        a.inputSchema &&
        typeof a.inputSchema === "object" &&
        (a.inputSchema as any).properties
      ) {
        const props = Object.keys((a.inputSchema as any).properties);
        const req = (a.inputSchema as any).required || [];
        params = `\n  - 参数列表: ${props
          .map((p) => (req.includes(p) ? `\`${p}\` (必填)` : `\`${p}\``))
          .join(", ")}`;
      }
      return `* \`${a.id}\`${aDesc}${params}`;
    })
    .join("\n");

  let playbookSection = "";
  if (playbooks.length > 0) {
    const list = playbooks
      .map((p) => {
        const rel = `./playbooks/${basename(p.filePath)}`;
        return `* **${p.id}** (\`${rel}\`): ${p.description || "任务指南"}`;
      })
      .join("\n");
    playbookSection = `
## 任务指南 (Playbook SOPs)

Playbook 为复杂任务提供逐步操作规程。详细 SOP 请阅读对应 Markdown 文档：

${list}
`;
  }

  return `---
name: ${cleanName}
description: ${desc}
---

# ${config.name} (${config.id})

${desc}

## 如何调用 Action

使用 Skill 目录中自带的独立可执行文件 \`${binaryRelPath}\` 即可完成工具发现与调用。
**该工具无需在系统预先安装任何依赖**（无需安装 Node.js、Bun、Python 或 Java）。

### 1. 发现可用 Action 清单
\`\`\`bash
${binaryRelPath} list --json
\`\`\`

### 2. 查看 Action 结构与入参 Schema
\`\`\`bash
${binaryRelPath} describe <action-id> --json
\`\`\`

### 3. 执行 Action
\`\`\`bash
${binaryRelPath} run <action-id> --input '{"param": "value"}'
\`\`\`

所有 Action 执行结果均在 \`stdout\` 输出标准格式的 JSON 结果：
\`\`\`json
{
  "ok": true,
  "runId": "01J...",
  "data": { ... }
}
\`\`\`
日志与诊断信息输出至 \`stderr\`。

---

## Action 目录

${actionListMd}
${playbookSection}
---

## 运行时配置与持久化状态

独立二进制会自动管理其本地 SQLite 数据库。如需检查或配置：

\`\`\`bash
# 查看与设置配置项
${binaryRelPath} config list
${binaryRelPath} config set KEY VALUE

# 查看与检索状态数据
${binaryRelPath} state list
${binaryRelPath} state get KEY
\`\`\`
`;
}

export function generateSkillJson(
  config: ProjectConfig,
  actions: ActionDefinition[],
  binaryName: string,
  target: string
): string {
  const manifest = {
    schemaVersion: "2.0.0",
    packageId: config.id,
    name: config.name,
    version: config.version,
    description: config.description,
    target,
    executable: `./bin/${binaryName}`,
    actions: actions.map((a) => ({
      id: a.id,
      description: a.description,
      inputSchema: a.inputSchema,
      outputSchema: a.outputSchema,
    })),
    exportedAt: new Date().toISOString(),
  };

  return JSON.stringify(manifest, null, 2) + "\n";
}
