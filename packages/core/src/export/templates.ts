import { basename } from "node:path";
import type { ActionSpec } from "../app/types";
import type { PlaybookDefinition, ProjectConfig } from "../project/types";

export type SkillActionItem =
  | ActionSpec
  | { id: string; description?: string; inputSchema?: any; outputSchema?: any; annotations?: any };

function getCleanSkillMetadata(config: ProjectConfig) {
  const cleanName = config.id.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
  const desc = config.description || `AI Agent skill for ${config.name} (${config.id})`;
  return { cleanName, desc };
}

function renderActionListMarkdown(
  actions: SkillActionItem[],
  options: { packageId?: string } = {}
): string {
  return actions
    .map((a) => {
      const aDesc = a.description ? ` - ${a.description}` : "";
      const idLabel = options.packageId
        ? `\`${options.packageId}/${a.id}\` (或 \`${a.id}\`)`
        : `\`${a.id}\``;

      const lines: string[] = [`- ${idLabel}${aDesc}`];

      // 标注元数据解析
      if (a.annotations && typeof a.annotations === "object") {
        const annoList: string[] = [];
        if ((a.annotations as any).readOnly === true) {
          annoList.push("只读操作");
        }
        if ((a.annotations as any).destructive === true) {
          annoList.push("破坏性操作（执行前须向用户确认）");
        }
        if (annoList.length > 0) {
          lines.push(`  - 属性标注: ${annoList.join(", ")}`);
        }
      }

      // 输入参数模式解析
      if (
        a.inputSchema &&
        typeof a.inputSchema === "object" &&
        (a.inputSchema as any).properties
      ) {
        const props = (a.inputSchema as any).properties as Record<string, any>;
        const req = ((a.inputSchema as any).required || []) as string[];
        const propKeys = Object.keys(props);

        if (propKeys.length > 0) {
          lines.push("  - 输入参数:");
          for (const k of propKeys) {
            const p = props[k] || {};
            const typeStr = p.type ? `\`${p.type}\`` : "`any`";
            const reqStr = req.includes(k) ? ", 必填" : "";
            const descStr = p.description ? `: ${p.description}` : "";
            const defStr =
              p.default !== undefined
                ? ` (默认值: \`${JSON.stringify(p.default)}\`)`
                : "";
            lines.push(`    - \`${k}\` (${typeStr}${reqStr})${descStr}${defStr}`);
          }
        } else {
          lines.push("  - 输入参数: 无");
        }
      } else {
        lines.push("  - 输入参数: 无");
      }

      // 输出字段模式解析
      if (
        a.outputSchema &&
        typeof a.outputSchema === "object" &&
        (a.outputSchema as any).properties
      ) {
        const outProps = (a.outputSchema as any).properties as Record<string, any>;
        const outKeys = Object.keys(outProps);
        if (outKeys.length > 0) {
          lines.push("  - 输出字段:");
          for (const k of outKeys) {
            const p = outProps[k] || {};
            const typeStr = p.type ? `\`${p.type}\`` : "`any`";
            const descStr = p.description ? `: ${p.description}` : "";
            lines.push(`    - \`${k}\` (${typeStr})${descStr}`);
          }
        }
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function renderPlaybookSectionMarkdown(
  playbooks: PlaybookDefinition[],
  playbooksDir = "playbooks"
): string {
  if (playbooks.length === 0) return "";
  const normalizedDir = playbooksDir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const list = playbooks
    .map((p) => {
      const rel = `./${normalizedDir}/${basename(p.filePath)}`;
      return `- **${p.id}** (\`${rel}\`): ${p.description || "业务操作指南"}`;
    })
    .join("\n");
  return `
## 业务操作规程

> [!IMPORTANT]
> **规程优先准则**：当处理复合业务任务时，智能体必须优先检查是否存在匹配场景的 Playbook。若存在规程，必须优先查阅并严格遵循规程界定的步骤时序与校验逻辑推进，严禁无序拼凑调用底层 Action。

Playbook SOPs 为复杂业务任务提供逐步指导规程。详细规程请查阅对应文档：

${list}
`;
}

export function generateSourceSkillMd(
  config: ProjectConfig,
  actions: SkillActionItem[],
  playbooks: PlaybookDefinition[]
): string {
  const { cleanName, desc } = getCleanSkillMetadata(config);
  const pkgId = config.id;
  const firstAction = actions[0]?.id || "sample.greet";

  const playbookSection = renderPlaybookSectionMarkdown(playbooks, config.playbooksDir || "playbooks");
  const actionListMd = renderActionListMarkdown(actions, { packageId: pkgId });

  return `---
name: ${cleanName}
description: ${desc}
---

# ${config.name} (${config.id})

${desc}

## ActionDock 运行时

本技能为 **ActionDock 源码型技能包**。智能体可直接通过宿主环境中已安装的 ActionDock 命令行工具 \`ad\` 执行其中的 Action。

### 注册与链接

在初次调用或初始化时，将包含本 \`SKILL.md\` 的目录解析为 \`<skill_root>\` 并完成注册：

\`\`\`bash
ad link "<skill_root>"
\`\`\`

> \`ad link\` 天然具备幂等性，同一 Package 多次执行会直接更新路径，可安全重复调用。若初次运行提示依赖缺失，可在 \`<skill_root>\` 目录下执行 \`npm install --omit=dev\` 安装生产依赖。

### 动作参数契约按需调阅

在调用未知参数的 Action 前，可在终端执行命令按需查阅该 Action 的输入输出模式与详细说明：

\`\`\`bash
ad describe ${pkgId}/${firstAction}
\`\`\`

### 执行 Action

为避免多技能之间的 Action ID 命名冲突，建议统一使用带有 Package 前缀的完全限定 ID。

推荐最佳实践：使用文件传递参数，杜绝终端引号转义问题：

\`\`\`bash
# 写入参数到临时文件并通过 --input-file 传递
cat << 'EOF' > /tmp/input.json
{
  "param": "value"
}
EOF
ad run ${pkgId}/${firstAction} --input-file /tmp/input.json
\`\`\`

亦可通过内联参数进行简易命令调用：

\`\`\`bash
ad run ${pkgId}/${firstAction} --input '{"param": "value"}'
\`\`\`

> **免注册本地执行**：
> 若工作目录已位于本技能根目录，亦可直接免 link 执行：
> \`\`\`bash
> cd <skill_root>
> ad run <action-id> --input-file /tmp/input.json
> \`\`\`

### 结构化响应解析

所有 Action 执行结果均在 \`stdout\` 输出标准格式的 JSON 信封：

\`\`\`json
// 执行成功响应 (ok 为 true)
{
  "ok": true,
  "runId": "01J...",
  "data": { ... }
}

// 执行失败响应 (ok 为 false)
{
  "ok": false,
  "runId": "01J...",
  "error": {
    "code": "ACTION_EXECUTION_FAILED",
    "message": "错误详细描述信息"
  }
}
\`\`\`

- \`stdout\`：标准 JSON 信封结果。当 \`ok\` 为 \`true\` 时，从 \`data\` 提取业务返回值推进后续步骤；当 \`ok\` 为 \`false\` 时，从 \`error\` 提取错误码与信息以判定自愈策略或上报。
- \`stderr\`：执行日志与诊断跟踪信息。
${playbookSection}
---

## Action 目录

${actionListMd}

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
> **按需排查原则**：默认宿主环境中已预置 \`ad\` 命令行工具与 Node.js 运行环境。正常执行流程直接调用上述 Action 即可，**严禁在任务启动前盲目进行前置环境检查或体检**；仅在终端明确报错提示命令不存在（如 \`ad: command not found\`）或提示依赖缺失时，方可按本节指引安装初始化。

### 命令行工具与环境依赖未就绪时的安装指引

若宿主环境未安装 \`ad\` 命令行工具或依赖缺失，请依次按如下步骤完成安装：

- **环境要求**：Node.js 版本大于等于 22.13.0（执行 \`node -v\` 确认）。
- **全局安装 ActionDock 命令行工具**：
  \`\`\`bash
  npm install -g @actiondock/cli
  \`\`\`
- **安装技能源码依赖**：
  若在技能目录内调用时提示模块缺失，在 \`<skill_root>\` 目录下安装生产依赖：
  \`\`\`bash
  cd "<skill_root>" && npm install --omit=dev
  \`\`\`
- **验证工具就绪**：
  \`\`\`bash
  ad --version
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
  actions: SkillActionItem[],
  playbooks: PlaybookDefinition[],
  binaryRelPath = "./bin/action-bin"
): string {
  const { cleanName, desc } = getCleanSkillMetadata(config);
  const firstAction = actions[0]?.id || "sample.greet";

  const playbookSection = renderPlaybookSectionMarkdown(playbooks, config.playbooksDir || "playbooks");
  const actionListMd = renderActionListMarkdown(actions);

  return `---
name: ${cleanName}
description: ${desc}
---

# ${config.name} (${config.id})

${desc}


### 执行 Action

推荐最佳实践：使用文件传递参数，杜绝终端引号转义问题：

\`\`\`bash
# 写入参数到临时文件并通过 --input-file 传递
cat << 'EOF' > /tmp/input.json
{
  "param": "value"
}
EOF
${binaryRelPath} run <action-id> --input-file /tmp/input.json
\`\`\`

亦可通过内联参数进行简易命令调用：

\`\`\`bash
${binaryRelPath} run ${firstAction} --input '{"param": "value"}'
\`\`\`

### 结构化响应解析

所有 Action 执行结果均在 \`stdout\` 输出标准格式的 JSON 结果：

\`\`\`json
// 执行成功响应 (ok 为 true)
{
  "ok": true,
  "runId": "01J...",
  "data": { ... }
}

// 执行失败响应 (ok 为 false)
{
  "ok": false,
  "runId": "01J...",
  "error": {
    "code": "ACTION_EXECUTION_FAILED",
    "message": "错误详细描述信息"
  }
}
\`\`\`

- \`stdout\`：标准 JSON 结果信封。当 \`ok\` 为 \`true\` 时，从 \`data\` 提取业务数据；当 \`ok\` 为 \`false\` 时，从 \`error\` 读取错误原因以处理异常。
- \`stderr\`：执行日志与诊断信息。
${playbookSection}
---

## Action 目录

${actionListMd}

---

## 运行时配置与持久化状态

独立二进制程序会自动管理其本地 SQLite 数据库。如需检查或配置：

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
  actions: SkillActionItem[],
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

export interface CompositeSkillPackageInfo {
  config: ProjectConfig;
  actions: Array<{ id: string; description?: string }>;
  playbooks: Array<{ id: string; name?: string; description?: string; filePath: string }>;
  packageDir: string;
}

/**
 * 复合技能自定义说明书（SKILL.custom.md）的槽位，
 * 决定自定义段落插入到官方模板生成结果中的位置。
 */
export type CompositeCustomSlot =
  | "intro"
  | "after-init"
  | "after-describe"
  | "after-actions"
  | "after-playbooks"
  | "after-invoke"
  | "append";

export const COMPOSITE_CUSTOM_SLOTS: readonly CompositeCustomSlot[] = [
  "intro",
  "after-init",
  "after-describe",
  "after-actions",
  "after-playbooks",
  "after-invoke",
  "append",
];

/** 工作区内约定俗成的复合技能自定义说明书文件名。 */
export const COMPOSITE_CUSTOM_DECLARATION_FILE = "SKILL.custom.md";

export interface CompositeCustomSection {
  slot: CompositeCustomSlot;
  content: string;
}

export interface CompositeCustomDeclaration {
  /** 自定义说明书 frontmatter 中声明的 description 覆盖值 */
  description?: string;
  sections: CompositeCustomSection[];
}

const CUSTOM_SLOT_MARKER_PATTERN = /^\s*<!--\s*actiondock:slot\s+([a-zA-Z][a-zA-Z0-9-]*)\s*-->\s*$/;

/**
 * 解析自定义说明书正文：以 `<!-- actiondock:slot <name> -->` 标记行分段。
 * 首个标记之前的内容归入 `append` 槽位；未知槽位名直接抛错，避免拼写错误被静默吞掉。
 */
export function parseCustomSections(source: string): CompositeCustomSection[] {
  const sections: CompositeCustomSection[] = [];
  let currentSlot: CompositeCustomSlot = "append";
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    buffer = [];
    if (content) {
      sections.push({ slot: currentSlot, content });
    }
  };

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(CUSTOM_SLOT_MARKER_PATTERN);
    if (match) {
      flush();
      const slot = match[1] as CompositeCustomSlot;
      if (!COMPOSITE_CUSTOM_SLOTS.includes(slot)) {
        throw new Error(
          `Unknown ActionDock custom slot '${match[1]}'. Valid slots: ${COMPOSITE_CUSTOM_SLOTS.join(", ")}`
        );
      }
      currentSlot = slot;
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections;
}

/**
 * 解析复合技能自定义说明书文件：支持 YAML frontmatter 中的 `description` 覆盖，
 * 正文按槽位标记解析为自定义段落。
 */
export function parseCustomSkillDeclaration(source: string): CompositeCustomDeclaration {
  let body = source;
  let description: string | undefined;

  const frontmatter = source.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (frontmatter) {
    body = source.slice(frontmatter[0].length);
    const descLine = frontmatter[1].match(/^description:[ \t]*(.+?)[ \t]*$/m);
    if (descLine) {
      description = descLine[1].replace(/^["']|["']$/g, "");
    }
  }

  return { description, sections: parseCustomSections(body) };
}

/**
 * 生成多包聚合的复合模式 SKILL.md 文档。
 */
export function generateCompositeSkillMd(
  bundleName: string,
  description: string,
  packages: CompositeSkillPackageInfo[],
  options?: {
    customSections?: CompositeCustomSection[];
    /** 规程链接的子包目录前缀：导出布局为 "packages"（默认）；就地生成时传 "." 使用工作区实际目录 */
    packagesBaseDir?: string;
  }
): string {
  const cleanName = bundleName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
  const samplePkg = packages.find((p) => p.actions && p.actions.length > 0);
  const sampleActionId = samplePkg
    ? `${samplePkg.config.id}/${samplePkg.actions[0].id}`
    : "sample.greet";

  const actionSections = packages
    .map((pkg) => {
      const actList = pkg.actions
        .map((a) => {
          const desc = a.description ? `: ${a.description}` : "";
          return `- \`${pkg.config.id}/${a.id}\`${desc}`;
        })
        .join("\n");
      return `### ${pkg.config.name} (${pkg.config.id})\n${actList || "- 无可用 Action"}`;
    })
    .join("\n\n");

  const playbookEntries: string[] = [];
  const packagesBaseDir = options?.packagesBaseDir ?? "packages";
  for (const pkg of packages) {
    for (const pb of pkg.playbooks) {
      const relPath =
        packagesBaseDir === "."
          ? `./${pkg.packageDir}/playbooks/${basename(pb.filePath)}`
          : `packages/${pkg.packageDir}/playbooks/${basename(pb.filePath)}`;
      playbookEntries.push(`- [${pb.name || pb.id}](${relPath}): ${pb.description || "标准操作规程"}`);
    }
  }

  const sIntro = `---
name: ${cleanName}
description: ${description}
---

# ${bundleName} 复合技能套件

${description}`;

  const sInit = `## ActionDock 运行时初始化

本技能为 **ActionDock 复合工作区技能包**，聚合了多个功能包。智能体在初次调用或初始化时，在当前技能根目录执行注册命令：

\`\`\`bash
ad link "<skill_root>"
\`\`\`

> \`ad link\` 会自动识别并注册工作区下的所有子包，使其中的 Action 随时可以通过完全限定标识调用。若初次运行提示依赖缺失，可在 \`<skill_root>\` 目录下执行 \`npm install --omit=dev\` 安装聚合依赖。`;

  const sDescribe = `## 动作参数契约按需调阅

为节省上下文开销，各 Action 的详细参数结构不静态内嵌在说明书中。在调用未知参数的 Action 前，可在终端执行命令查阅输入输出约束：

\`\`\`bash
ad describe ${sampleActionId}
\`\`\``;

  const sActions = `## 可用 Action 工具清单

${actionSections}

---`;

  const sPlaybooks =
    playbookEntries.length > 0
      ? `## 推荐操作规程

涉及多步骤或业务流程时，优先遵循以下原位规程：

${playbookEntries.join("\n")}

---`
      : "";

  const sInvoke = `## 标准调用命令

推荐使用参数文件传递内容，杜绝终端引号转义问题：

\`\`\`bash
cat << 'EOF' > /tmp/input.json
{
  "param": "value"
}
EOF
ad run ${sampleActionId} --input-file /tmp/input.json
\`\`\`

### 结构化响应解析

所有 Action 执行结果均在 \`stdout\` 输出标准格式的 JSON 信封：

\`\`\`json
// 执行成功响应 (ok 为 true)
{
  "ok": true,
  "runId": "01J...",
  "data": { ... }
}

// 执行失败响应 (ok 为 false)
{
  "ok": false,
  "runId": "01J...",
  "error": {
    "code": "ACTION_EXECUTION_FAILED",
    "message": "错误详细描述信息"
  }
}
\`\`\``;

  const sTroubleshooting = `---

## 故障排查与环境安装指引（按需查阅）

> [!NOTE]
> **按需排查原则**：默认宿主环境中已预置 \`ad\` 命令行工具与 Node.js 运行环境。正常执行流程直接调用上述 Action 即可，**严禁在任务启动前盲目进行前置环境检查或体检**；仅在终端明确报错提示命令不存在（如 \`ad: command not found\`）或提示依赖缺失时，方可按本节指引安装初始化。

### 命令行工具与环境依赖未就绪时的安装指引

若宿主环境未安装 \`ad\` 命令行工具或依赖缺失，请依次按如下步骤完成安装：

- **环境要求**：Node.js 版本大于等于 24.12.0（执行 \`node -v\` 确认）。
- **全局安装 ActionDock 命令行工具**：
  \`\`\`bash
  npm install -g @actiondock/cli
  \`\`\`
- **安装复合技能聚合依赖**：
  若在技能目录内调用时提示模块缺失，在 \`<skill_root>\` 目录下安装生产依赖：
  \`\`\`bash
  cd "<skill_root>" && npm install --omit=dev
  \`\`\`
- **验证工具就绪**：
  \`\`\`bash
  ad --version
  \`\`\`
- **环境诊断与体检**：
  安装完成后若仍遇到异常，执行体检命令排查：
  \`\`\`bash
  ad doctor
  \`\`\`
- **完成安装后重新链接复合技能**：
  \`\`\`bash
  ad link "<skill_root>"
  \`\`\``;

  const parts: Array<{ slot: CompositeCustomSlot; text: string }> = [
    { slot: "intro", text: sIntro },
    { slot: "after-init", text: sInit },
    { slot: "after-describe", text: sDescribe },
    { slot: "after-actions", text: sActions },
    { slot: "after-playbooks", text: sPlaybooks },
    { slot: "after-invoke", text: sInvoke },
    { slot: "append", text: sTroubleshooting },
  ];

  // 自定义段落按文件顺序插入到对应槽位（倒序插入保证同槽位多段保持先后）
  const customSections = options?.customSections ?? [];
  for (const section of [...customSections].reverse()) {
    const anchorIndex = parts.findIndex((p) => p.slot === section.slot);
    parts.splice(anchorIndex + 1, 0, { slot: section.slot, text: section.content });
  }

  return (
    parts
      .filter((p) => p.text.trim().length > 0)
      .map((p) => p.text.trim())
      .join("\n\n") + "\n"
  );
}


export interface GenerateSkillJsonOptions {
  mode?: "source" | "standalone";
  executable?: string;
  target?: string;
  playbooks?: PlaybookDefinition[];
}

export function generateSkillJson(
  config: ProjectConfig,
  actions: SkillActionItem[],
  binaryNameOrOptions?: string | GenerateSkillJsonOptions,
  target = "host",
  playbooksList: PlaybookDefinition[] = []
): string {
  let mode: "source" | "standalone" = "source";
  let executable: string | undefined;
  let targetPlatform = target;
  let playbooks = playbooksList;

  if (typeof binaryNameOrOptions === "string") {
    mode = "standalone";
    executable = `./bin/${binaryNameOrOptions}`;
  } else if (binaryNameOrOptions && typeof binaryNameOrOptions === "object") {
    mode = binaryNameOrOptions.mode || (binaryNameOrOptions.executable ? "standalone" : "source");
    executable = binaryNameOrOptions.executable;
    targetPlatform = binaryNameOrOptions.target || target;
    if (binaryNameOrOptions.playbooks) {
      playbooks = binaryNameOrOptions.playbooks;
    }
  }

  const manifest: Record<string, unknown> = {
    schemaVersion: "2.0.0",
    packageId: config.id,
    name: config.name,
    version: config.version,
    description: config.description,
    mode,
  };

  if (mode === "standalone" && executable) {
    manifest.target = targetPlatform;
    manifest.executable = executable;
  }

  manifest.actions = actions.map((a: any) => {
    const item: Record<string, unknown> = {
      id: a.id,
    };
    if (a.entry) {
      item.entry = a.entry;
    }
    if (a.description) {
      item.description = a.description;
    }
    if (a.inputSchema !== undefined) {
      item.inputSchema = a.inputSchema;
    }
    if (a.outputSchema !== undefined) {
      item.outputSchema = a.outputSchema;
    }
    if (a.uses) {
      item.uses = a.uses;
    }
    if (a.tags) {
      item.tags = a.tags;
    }
    if (a.annotations) {
      item.annotations = a.annotations;
    }
    return item;
  });

  if (playbooks && playbooks.length > 0) {
    manifest.playbooks = playbooks.map((p) => ({
      id: p.id,
      description: p.description,
      entry: `playbooks/${basename(p.filePath)}`,
    }));
  }

  manifest.exportedAt = new Date().toISOString();

  return JSON.stringify(manifest, null, 2) + "\n";
}

