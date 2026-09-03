import { basename } from "node:path";
import type { ActionDefinition } from "@actiondock/sdk";
import type { PlaybookDefinition, ProjectConfig } from "../project/types";

function getCleanSkillMetadata(config: ProjectConfig) {
  const cleanName = config.id.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
  const desc = config.description || `AI Agent skill for ${config.name} (${config.id})`;
  return { cleanName, desc };
}

function renderActionListMarkdown(
  actions: ActionDefinition[],
  options: { packageId?: string } = {}
): string {
  return actions
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
      const idLabel = options.packageId
        ? `\`${options.packageId}/${a.id}\` (或 \`${a.id}\`)`
        : `\`${a.id}\``;
      return `- ${idLabel}${aDesc}${params}`;
    })
    .join("\n");
}

function renderPlaybookSectionMarkdown(playbooks: PlaybookDefinition[]): string {
  if (playbooks.length === 0) return "";
  const list = playbooks
    .map((p) => {
      const rel = `./playbooks/${basename(p.filePath)}`;
      return `- **${p.id}** (\`${rel}\`): ${p.description || "任务指南"}`;
    })
    .join("\n");
  return `
## 任务指南 (Playbook SOPs)

Playbook 为复杂任务提供逐步操作规程。详细 SOP 请阅读对应 Markdown 文档：

${list}
`;
}

export function generateSourceSkillMd(
  config: ProjectConfig,
  actions: ActionDefinition[],
  playbooks: PlaybookDefinition[]
): string {
  const { cleanName, desc } = getCleanSkillMetadata(config);
  const pkgId = config.id;
  const firstAction = actions[0]?.id || "sample.greet";

  const actionListMd = renderActionListMarkdown(actions, { packageId: pkgId });
  const playbookSection = renderPlaybookSectionMarkdown(playbooks);

  return `---
name: ${cleanName}
description: ${desc}
---

# ${config.name} (${config.id})

${desc}

## ActionDock 运行时

本技能为 **ActionDock 源码型技能包**。AI Agent 可直接通过已安装的 ActionDock 命令行工具 (\`ad\`) 执行其中的 Action。

### 注册与链接

在初次调用或初始化时，将包含本 \`SKILL.md\` 的目录解析为 \`<skill_root>\` 并完成注册：

\`\`\`bash
ad link "<skill_root>"
\`\`\`

> \`ad link\` 天然具备幂等性，同一 Package 多次执行会直接更新路径，可安全重复调用。

### 执行 Action

为避免多技能之间的 Action ID 命名冲突，建议统一使用带有 Package 前缀的完全限定 ID：

\`\`\`bash
# 格式：ad run <package-id>/<action-id> --input '<json>'
ad run ${pkgId}/${firstAction} --input '{"param": "value"}'
\`\`\`

> **免注册本地执行**：
> 若 Agent 工作目录已位于本 Skill 根目录，亦可直接免 link 执行：
> \`\`\`bash
> cd <skill_root>
> ad run <action-id> --input '<json>'
> \`\`\`

所有 Action 执行结果均在 \`stdout\` 输出标准格式的 JSON Envelope：
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

如需检查或配置该 Package 的运行时参数与持久化数据：

\`\`\`bash
# 查看与设置配置项
ad config list --package ${pkgId}
ad config set KEY VALUE --package ${pkgId}

# 查看与检索状态数据
ad state list --package ${pkgId}
ad state get KEY --package ${pkgId}
\`\`\`

---

## 故障排查与环境安装指引（按需查阅）

> [!NOTE]
> **按需排查原则**：默认宿主环境中已预置 \`ad\` 命令行工具。正常执行流程直接调用上述 Action 即可，**严禁在任务启动前盲目进行前置环境检查或体检**；仅在终端明确报错提示命令不存在（如 \`ad: command not found\`）时，方可按本节指引安装初始化。

### 命令行工具未找到时的安装指引

若宿主环境未安装 \`ad\` 命令行工具，请依次按如下步骤完成安装：

- **安装 Bun 运行时**（若系统未安装）：
  \`\`\`bash
  npm install -g bun
  \`\`\`

- **全局安装 ActionDock 命令行工具**：
  \`\`\`bash
  npm install -g @actiondock/cli
  \`\`\`

- **验证工具就绪**：
  \`\`\`bash
  ad --version
  \`\`\`

- **源码本地开发模式**（若在本地源码仓库中贡献或开发）：
  \`\`\`bash
  cd packages/cli && bun link
  cd ../sdk && bun link
  \`\`\`

- **环境诊断与体检**：
  安装完成后若仍遇到异常，执行体检命令排查：
  \`\`\`bash
  ad doctor
  \`\`\`

- **完成安装后重新链接本技能**：
  \`\`\`bash
  ad link "<skill_root>"
  \`\`\`
`;
}

export function generateStandaloneSkillMd(
  config: ProjectConfig,
  actions: ActionDefinition[],
  playbooks: PlaybookDefinition[],
  binaryRelPath = "./bin/action-bin"
): string {
  const { cleanName, desc } = getCleanSkillMetadata(config);
  const firstAction = actions[0]?.id || "sample.greet";

  const actionListMd = renderActionListMarkdown(actions);
  const playbookSection = renderPlaybookSectionMarkdown(playbooks);

  return `---
name: ${cleanName}
description: ${desc}
---

# ${config.name} (${config.id})

${desc}

## 如何调用 Action

使用 Skill 目录中自带的独立可执行文件 \`${binaryRelPath}\` 即可完成工具发现与调用。
**该工具无需在系统预先安装任何依赖**（无需安装 Node.js、Bun、Python 或 Java）。

### 发现可用 Action 清单
\`\`\`bash
${binaryRelPath} list --json
\`\`\`

### 查看 Action 结构与入参 Schema
\`\`\`bash
${binaryRelPath} describe <action-id> --json
\`\`\`

### 执行 Action
\`\`\`bash
${binaryRelPath} run <action-id> --input '{"param": "value"}'

# 示例：
${binaryRelPath} run ${firstAction} --input '{"param": "value"}'
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

export function generateSkillMd(
  config: ProjectConfig,
  actions: ActionDefinition[],
  playbooks: PlaybookDefinition[],
  optionsOrBinaryPath: string | { mode?: "source" | "standalone"; binaryRelPath?: string } = "./bin/action-bin"
): string {
  if (typeof optionsOrBinaryPath === "string") {
    return generateStandaloneSkillMd(config, actions, playbooks, optionsOrBinaryPath);
  }
  if (optionsOrBinaryPath.mode === "source") {
    return generateSourceSkillMd(config, actions, playbooks);
  }
  return generateStandaloneSkillMd(config, actions, playbooks, optionsOrBinaryPath.binaryRelPath || "./bin/action-bin");
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

