import type { CommandPreset } from "../components/execution/CommandPanel";
import { getCommandInputSourceLabel } from "../services/commands";
import type { ResolvedCommandInput } from "../services/commands";
import type { SubmitMode } from "../shared/types";

const CLI_FAMILY = "CLI";
const HTTP_FAMILY = "HTTP";
const DEFAULT_ENVIRONMENT = "bash/zsh";

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "example";
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolvePresetCommand(
  presets: CommandPreset[],
  family: string,
  environment = DEFAULT_ENVIRONMENT
): string | undefined {
  return presets.find((item) => item.family === family && item.environment === environment)?.command;
}

function sanitizeCommandForSkill(command: string): string {
  return command
    .replace(/Authorization: Bearer [^'\n]+/g, "Authorization: Bearer <token>")
    .replace(/Authorization = 'Bearer [^'\n]+'/g, "Authorization = 'Bearer <token>'")
    .replace(/--token\s+'(?:[^']|'\"'\"')*'/g, "--token '<token>'");
}

function renderCodeBlock(language: string, value: string): string {
  return [`\`\`\`${language}`, value, "```"].join("\n");
}

function renderJsonBlock(value: unknown): string {
  return renderCodeBlock("json", JSON.stringify(value ?? {}, null, 2));
}

function renderCommandSection(title: string, command?: string): string[] {
  if (!command) {
    return [];
  }
  return [title, renderCodeBlock("bash", sanitizeCommandForSkill(command))];
}

function extractQuotedUrl(command?: string): string | undefined {
  if (!command) {
    return undefined;
  }
  const sanitized = sanitizeCommandForSkill(command);
  const matches = sanitized.match(/'([^']+)'/g);
  if (!matches || matches.length === 0) {
    return undefined;
  }
  return matches[matches.length - 1]?.slice(1, -1);
}

function extractCliFlag(command: string | undefined, flag: string): string | undefined {
  if (!command) {
    return undefined;
  }
  const sanitized = sanitizeCommandForSkill(command);
  const valueMatch = sanitized.match(new RegExp(`(${flag}\\s+'(?:[^']|'\"'\"')*')`));
  if (valueMatch) {
    return valueMatch[1];
  }
  return sanitized.includes(flag) ? flag : undefined;
}

function buildScriptFileCliExample(context: ScriptSkillExampleContext, command?: string): string {
  const inputPath = `/tmp/${slugify(context.scriptId)}-input.json`;
  const flags = [
    extractCliFlag(command, "--draft"),
    extractCliFlag(command, "--token"),
    extractCliFlag(command, "--mode"),
    extractCliFlag(command, "--response-view"),
    extractCliFlag(command, "--server"),
    extractCliFlag(command, "--json"),
    `--input-file '${inputPath}'`
  ].filter(Boolean).join(" ");

  return [
    `cat > ${inputPath} <<'JSON'`,
    JSON.stringify(context.input, null, 2),
    "JSON",
    "",
    `# 复杂对象/数组放进文件；简单顶层字段继续用普通 flag`,
    `# --input-file 提供基础对象；后面的 flag 会合并并覆盖同名字段`,
    `actiondock script run '${context.scriptId}'${flags ? ` ${flags}` : ""}`
  ].join("\n");
}

function buildScriptFileHttpExample(context: ScriptSkillExampleContext, command?: string): string {
  const requestPath = `/tmp/${slugify(context.scriptId)}-request.json`;
  const url = extractQuotedUrl(command) ?? `/api/scripts/${context.scriptId}/execute`;
  const sanitized = sanitizeCommandForSkill(command ?? "");
  const hasAuth = sanitized.includes("Authorization: Bearer <token>");
  const body = {
    input: context.input,
    ...(context.executionMode === "SYNC" ? {} : { mode: context.executionMode })
  };

  return [
    `cat > ${requestPath} <<'JSON'`,
    JSON.stringify(body, null, 2),
    "JSON",
    "",
    "# curl 同样优先把请求体写到文件，再用 --data @file，避免 shell 转义问题",
    [
      "curl -X POST \\",
      "  -H 'Content-Type: application/json' \\",
      ...(hasAuth ? ["  -H 'Authorization: Bearer <token>' \\"] : []),
      `  --data '@${requestPath}' \\`,
      `  '${url}'`
    ].join("\n")
  ].join("\n");
}

function buildPluginFileCliExample(context: PluginSkillExampleContext, command?: string): string {
  const slug = `${slugify(context.pluginId)}-${slugify(context.action)}`;
  const argsPath = `/tmp/${slug}-args.json`;
  const scriptInputPath = `/tmp/${slug}-script-input.json`;
  const flags = [
    extractCliFlag(command, "--token"),
    extractCliFlag(command, "--response-view"),
    extractCliFlag(command, "--server"),
    extractCliFlag(command, "--json"),
    `--args-file '${argsPath}'`,
    `--script-input-file '${scriptInputPath}'`
  ].filter(Boolean).join(" ");

  return [
    `cat > ${argsPath} <<'JSON'`,
    JSON.stringify(context.args, null, 2),
    "JSON",
    "",
    `cat > ${scriptInputPath} <<'JSON'`,
    JSON.stringify(context.scriptInput, null, 2),
    "JSON",
    "",
    "# args 和 scriptInput 都是 JSON 对象，优先各自写文件",
    "# 简单顶层字段也可以继续直接写成 --name value 这类普通 flag",
    `actiondock plugin invoke '${context.pluginId}' '${context.action}'${flags ? ` ${flags}` : ""}`
  ].join("\n");
}

function buildPluginFileHttpExample(context: PluginSkillExampleContext, command?: string): string {
  const requestPath = `/tmp/${slugify(context.pluginId)}-${slugify(context.action)}-request.json`;
  const url = extractQuotedUrl(command) ?? `/api/plugins/${context.pluginId}/actions/${context.action}/invoke`;
  const sanitized = sanitizeCommandForSkill(command ?? "");
  const hasAuth = sanitized.includes("Authorization: Bearer <token>");
  const body = {
    args: context.args,
    scriptInput: context.scriptInput,
    responseView: "RESULT"
  };

  return [
    `cat > ${requestPath} <<'JSON'`,
    JSON.stringify(body, null, 2),
    "JSON",
    "",
    "# curl 同样优先把请求体写到文件，再用 --data @file，避免 shell 转义问题",
    [
      "curl -X POST \\",
      "  -H 'Content-Type: application/json' \\",
      ...(hasAuth ? ["  -H 'Authorization: Bearer <token>' \\"] : []),
      `  --data '@${requestPath}' \\`,
      `  '${url}'`
    ].join("\n")
  ].join("\n");
}

function renderFrontmatter(name: string, description: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: "${escapeYaml(description)}"`,
    "---"
  ].join("\n");
}

function renderScriptInputSourceLabel(source: ResolvedCommandInput["source"]): string {
  return getCommandInputSourceLabel(source);
}

function renderPluginScriptInputSourceLabel(source: "current-json" | "empty"): string {
  return source === "current-json" ? "当前 JSON 输入" : "空对象";
}

function joinSections(sections: string[]): string {
  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}

export interface ScriptSkillExampleContext {
  scriptId: string;
  description?: string;
  executionMode: SubmitMode;
  input: Record<string, unknown>;
  inputSource: ResolvedCommandInput["source"];
  inputSchema?: unknown;
  outputSchema?: unknown;
  executeCommandPresets: CommandPreset[];
}

export interface PluginSkillExampleContext {
  pluginId: string;
  action: string;
  args: Record<string, unknown>;
  argsSource: ResolvedCommandInput["source"];
  scriptInput: Record<string, unknown>;
  scriptInputSource: "current-json" | "empty";
  inputSchema?: unknown;
  outputSchema?: unknown;
  invokeCommandPresets: CommandPreset[];
}

export function buildScriptSkillExample(context: ScriptSkillExampleContext): string {
  const executeCli = resolvePresetCommand(context.executeCommandPresets, CLI_FAMILY);
  const executeHttp = resolvePresetCommand(context.executeCommandPresets, HTTP_FAMILY);
  const skillName = `actiondock-script-${slugify(context.scriptId)}`;
  const skillDescription = context.description?.trim() || `执行 ${context.scriptId}`;

  return joinSections([
    renderFrontmatter(skillName, skillDescription),
    `# ActionDock Script ${context.scriptId}`,
    "- 默认优先复用当前页面的 CLI 调用命令。",
    [
      "## 当前上下文",
      `- \`scriptId\`: \`${context.scriptId}\``,
      `- \`mode\`: \`${context.executionMode}\``,
      `- \`inputSource\`: ${renderScriptInputSourceLabel(context.inputSource)}`,
      "",
      "输入 Schema：",
      renderJsonBlock(context.inputSchema),
      "",
      "输出 Schema：",
      renderJsonBlock(context.outputSchema),
      "",
      "当前输入示例：",
      renderJsonBlock(context.input)
    ].join("\n"),
    joinSections([
      "## CLI 调用",
      ...renderCommandSection("### 执行脚本", executeCli)
    ]),
    joinSections([
      "## HTTP 回退",
      ...renderCommandSection("### 执行脚本", executeHttp)
    ]),
    joinSections([
      "## 调用注意事项",
      [
        "优先使用 CLI 扁平 flag 模式传参：`--name value`。简单类型（`string` / `number` / `integer` / `boolean` / `enum`）的顶层字段直接展开成 flag 即可。",
        "- 布尔字段可以直接写成无值 flag，例如 `--enabled`。",
        "- 遇到对象或数组字段时，再退回 `--input-file` 或 `--input-json`。",
        "- `--input-json` 和 `--input-file` 不能同时使用；传入内容顶层必须是 JSON 对象。",
        "- `--input-file` 提供基础对象，后面的简单 flag 会继续合并进去，并覆盖同名字段。",
        "",
        "如果命令行输出的内容较多，应将输出重定向到临时文件以避免截断，使用完毕后删除临时文件。",
        "例如：`actiondock script run ... > /tmp/result.json && cat /tmp/result.json`。"
      ].join("\n"),
      renderCodeBlock("bash", buildScriptFileCliExample(context, executeCli)),
      renderCodeBlock("bash", buildScriptFileHttpExample(context, executeHttp))
    ])
  ]);
}

export function buildPluginSkillExample(context: PluginSkillExampleContext): string {
  const invokeCli = resolvePresetCommand(context.invokeCommandPresets, CLI_FAMILY);
  const invokeHttp = resolvePresetCommand(context.invokeCommandPresets, HTTP_FAMILY);
  const skillName = `actiondock-plugin-${slugify(context.pluginId)}-${slugify(context.action)}`;

  return joinSections([
    renderFrontmatter(skillName, `复用 ActionDock 调用命令来触发插件 ${context.pluginId} 的 ${context.action} 动作`),
    `# ActionDock Plugin ${context.pluginId}.${context.action}`,
    [
      `当用户要求调用插件 \`${context.pluginId}\` 的动作 \`${context.action}\`，或确认当前页面对应的动作命令时，使用这个 skill。`,
      "",
      "- 默认优先复用当前页面的 CLI 调用命令。"
    ].join("\n"),
    [
      "## 当前上下文",
      `- \`pluginId\`: \`${context.pluginId}\``,
      `- \`action\`: \`${context.action}\``,
      `- \`argsSource\`: ${renderScriptInputSourceLabel(context.argsSource)}`,
      `- \`scriptInputSource\`: ${renderPluginScriptInputSourceLabel(context.scriptInputSource)}`,
      "",
      "输入 Schema：",
      renderJsonBlock(context.inputSchema),
      "",
      "输出 Schema：",
      renderJsonBlock(context.outputSchema),
      "",
      "当前动作参数：",
      renderJsonBlock(context.args),
      "",
      "当前 scriptInput：",
      renderJsonBlock(context.scriptInput)
    ].join("\n"),
    joinSections([
      "## CLI 调用",
      ...renderCommandSection("### 调用动作", invokeCli)
    ]),
    joinSections([
      "## HTTP 回退",
      ...renderCommandSection("### 调用动作", invokeHttp)
    ]),
    joinSections([
      "## 调用注意事项",
      [
        "优先使用 CLI 扁平 flag 模式传参：`--name value`。简单类型（`string` / `number` / `integer` / `boolean` / `enum`）的顶层字段直接展开成 flag 即可。",
        "- 布尔字段可以直接写成无值 flag，例如 `--enabled`。",
        "- 遇到对象或数组字段时，再退回 `--args-file` / `--args-json`。",
        "- `scriptInput` 也是 JSON 对象；优先用 `--script-input-file`，简单场景再用 `--script-input-json`。",
        "- `--args-json` 和 `--args-file` 不能同时使用；`--script-input-json` 和 `--script-input-file` 也不能同时使用。",
        "- 这些 JSON 输入的顶层都必须是对象。",
        "",
        "如果命令行输出的内容较多，应将输出重定向到临时文件以避免截断，使用完毕后删除临时文件。",
        "例如：`actiondock plugin invoke ... > /tmp/result.json && cat /tmp/result.json`。"
      ].join("\n"),
      renderCodeBlock("bash", buildPluginFileCliExample(context, invokeCli)),
      renderCodeBlock("bash", buildPluginFileHttpExample(context, invokeHttp))
    ])
  ]);
}

export { sanitizeCommandForSkill };
