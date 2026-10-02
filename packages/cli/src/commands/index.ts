import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import type { CliContext } from "../types";

/**
 * 读取 CLI 自身 package.json 的版本号（单一事实源）。
 * 兼容源码运行（src/commands）与构建产物运行（dist/commands）两种目录层级。
 */
function readCliVersion(): string {
  try {
    const pkgJson = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf-8"));
    return (pkgJson && pkgJson.version) || "0.0.0";
  } catch {
    // package.json 缺失或损坏时回退占位版本，避免阻断启动
    return "0.0.0";
  }
}

/**
 * CLI 版本号（来自 package.json 单一事实源）。
 */
export const CLI_VERSION = readCliVersion();

/**
 * 递归注入全局通用选项。
 *
 * 输出纪律契约：--json 对所有命令统一注入；已实现 renderResult
 * 数据输出的命令会消费它，未实现机器输出的命令（init、link、test、new、
 * serve、mcp 等）将其作为无操作标志忽略，不影响人类输出行为。
 * 错误信封由顶层 main 的 renderError 统一兜底，与命令实现解耦。
 */
function applyCommonOptions(cmd: Command): void {
  const hasOpt = (flagName: string) =>
    cmd.options.some((o) => o.name() === flagName || o.long === `--${flagName}`);

  if (!hasOpt("json")) {
    cmd.option("--json", "Output as JSON");
  }
  if (!hasOpt("dataDir") && !hasOpt("data-dir")) {
    cmd.option("--data-dir <path>", "Custom database storage directory");
  }

  for (const sub of cmd.commands) {
    applyCommonOptions(sub);
  }
}

/**
 * 动态加载子命令实现模块（兼容构建产物 .js 与开发环境 .ts）。
 */
function importCommandModule(relativePath: string): Promise<any> {
  const ext = existsSync(join(import.meta.dirname, "run.js")) ? ".js" : ".ts";
  return import(`${relativePath}${ext}`);
}

interface CommandDeclaration {
  name: string;
  spec: string;
  description: string;
  alias?: string;
  loader: string;
  registerFn: string;
  linkedNames?: string[];
}

const COMMAND_DECLARATIONS: CommandDeclaration[] = [
  {
    name: "init",
    spec: "init [directory]",
    description: "Initialize a new ActionDock project",
    loader: "./init",
    registerFn: "registerInitCommand",
  },
  {
    name: "add",
    spec: "add <package>",
    description: "Install and lock an Action package dependency into current project",
    loader: "./add",
    registerFn: "registerAddCommand",
  },
  {
    name: "remove",
    spec: "remove <package>",
    description: "Remove an Action package dependency and update actiondock.lock.json",
    loader: "./remove",
    registerFn: "registerRemoveCommand",
  },
  {
    name: "action",
    spec: "action",
    description: "Manage Action definitions and lifecycle (create, list, describe, run, validate)",
    loader: "./action/create",
    registerFn: "registerActionCommands",
  },
  {
    name: "info",
    spec: "info [patterns...]",
    description: "Display information about current project, linked package, or remote target",
    loader: "./info",
    registerFn: "registerInfoCommand",
  },
  {
    name: "doctor",
    spec: "doctor",
    description: "Check ActionDock environment, registry health, and project diagnostics",
    loader: "./doctor",
    registerFn: "registerDoctorCommand",
  },
  {
    name: "list",
    spec: "list [patterns...]",
    description: "List actions in current project, linked packages, or remote profile",
    loader: "./list",
    registerFn: "registerListCommand",
  },
  {
    name: "describe",
    spec: "describe <id>",
    alias: "show",
    description: "Show action definition, schema, and description",
    loader: "./describe",
    registerFn: "registerDescribeCommand",
  },
  {
    name: "run",
    spec: "run <id> [params...]",
    description: "Execute an action (from current project, linked packages, or remote profile)",
    loader: "./run",
    registerFn: "registerRunCommand",
  },
  {
    name: "validate",
    spec: "validate [id]",
    description: "Validate action schemas and definitions",
    loader: "./validate",
    registerFn: "registerValidateCommand",
  },
  {
    name: "generate",
    spec: "generate",
    description: "Generate project artifacts such as TypeScript declarations",
    loader: "./generate",
    registerFn: "registerGenerateCommands",
  },
  {
    name: "playbook",
    spec: "playbook",
    description: "Manage task Playbooks (Task SOPs for AI Agents)",
    loader: "./playbook",
    registerFn: "registerPlaybookCommands",
  },
  {
    name: "config",
    spec: "config",
    description: "Manage runtime configuration store (Global & Project-level)",
    loader: "./config/index",
    registerFn: "registerConfigCommands",
  },
  {
    name: "state",
    spec: "state",
    description: "Inspect and manage Shared State store",
    loader: "./state",
    registerFn: "registerStateCommands",
  },
  {
    name: "runs",
    spec: "runs",
    description: "Inspect action execution history",
    loader: "./runs",
    registerFn: "registerRunsCommands",
  },
  {
    name: "test",
    spec: "test [pattern]",
    description: "Run project tests using configured test runner (node:test or bun test)",
    loader: "./test",
    registerFn: "registerTestCommand",
  },
  {
    name: "build",
    spec: "build",
    description: "Build project actions into a runnable Node.js delivery directory",
    loader: "./build",
    registerFn: "registerBuildCommand",
  },
  {
    name: "pack",
    spec: "pack",
    description: "Pack Action package into a standard npm tarball (.tgz) for distribution",
    loader: "./pack",
    registerFn: "registerPackCommand",
  },
  {
    name: "export",
    spec: "export",
    description: "Export project artifacts",
    loader: "./export",
    registerFn: "registerExportCommand",
  },
  {
    name: "link",
    spec: "link [path]",
    description: "Link local Action package(s) or workspace directory into global registry for instant cross-directory execution",
    loader: "./link",
    registerFn: "registerLinkCommands",
    linkedNames: ["link", "unlink"],
  },
  {
    name: "unlink",
    spec: "unlink [identifier]",
    description: "Unlink a package, workspace, or prune stale entries from global developer registry",
    loader: "./link",
    registerFn: "registerLinkCommands",
    linkedNames: ["link", "unlink"],
  },
  {
    name: "profile",
    spec: "profile",
    description: "Manage multi-cloud and remote execution profiles",
    loader: "./profile",
    registerFn: "registerProfileCommands",
  },
  {
    name: "serve",
    spec: "serve",
    description: "Start the ActionDock lightweight HTTP Runner server for remote execution",
    loader: "./serve",
    registerFn: "registerServeCommand",
  },
  {
    name: "mcp",
    spec: "mcp",
    description: "Model Context Protocol (MCP) server for ActionDock Actions (STDIO default)",
    loader: "./mcp",
    registerFn: "registerMcpCommands",
  },
];

const RUNTIME_EXECUTABLES = new Set(["node", "bun", "tsx", "deno"]);

/**
 * 判断命令行参数数组是否以宿主运行环境（node、bun、tsx 等）及入口脚本为前置元素。
 */
export function isNodeArgv(argv: readonly string[]): boolean {
  if (!Array.isArray(argv) || argv.length < 2) return false;
  const first = argv[0];
  if (!first || first.startsWith("-")) return false;

  const base = first.split(/[/\\]/).pop()?.toLowerCase().replace(/\.exe$/i, "") ?? "";
  if (RUNTIME_EXECUTABLES.has(base)) {
    return true;
  }

  // 严格排除已知子命令与内置 help 命令，杜绝将纯用户子命令参数错误识别为运行时
  if (
    COMMAND_DECLARATIONS.some((d) => d.name === first || d.alias === first) ||
    first === "help"
  ) {
    return false;
  }

  return false;
}

/**
 * 从命令行参数数组中解析出目标子命令名称（跳过全局选项与启动包装参数）。
 *
 * @param argv 命令行原始参数数组
 * @param parseOptions Commander 解析选项（如 { from: 'user' }）
 * @returns 目标子命令名称或 null
 */
export function resolveTargetSubcommand(
  argv: readonly string[],
  parseOptions?: { from?: string }
): string | null {
  let startIndex = 0;
  if (parseOptions?.from === "user") {
    startIndex = 0;
  } else if (parseOptions?.from === "eval") {
    startIndex = 1;
  } else if (parseOptions?.from === "node") {
    startIndex = 2;
  } else if (isNodeArgv(argv)) {
    startIndex = 2;
  } else {
    startIndex = 0;
  }

  let i = startIndex;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--data-dir") {
      i += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      i++;
      continue;
    }
    // 特殊处理 Commander 内置 help 命令（如 ad help run）
    if (arg === "help" && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
      return argv[i + 1];
    }
    return arg;
  }
  return null;
}

/**
 * 按需加载并挂载目标子命令模块。
 * 基于 Promise 缓存机制消除并发调用时的竞态条件。
 */
async function loadAndAttachCommand(
  targetSubcommand: string,
  program: Command,
  placeholders: Map<string, Command>,
  loadingPromises: Map<string, Promise<void>>,
  context?: CliContext
): Promise<void> {
  const decl = COMMAND_DECLARATIONS.find(
    (d) => d.name === targetSubcommand || d.alias === targetSubcommand
  );
  if (!decl) return;

  const existing = loadingPromises.get(decl.loader);
  if (existing) {
    return existing;
  }

  const loadPromise = (async () => {
    // 移除对应的占位命令节点
    const toRemove = decl.linkedNames || [decl.name];
    for (const name of toRemove) {
      const p = placeholders.get(name);
      if (p) {
        const idx = program.commands.indexOf(p);
        if (idx !== -1) {
          (program.commands as Command[]).splice(idx, 1);
        }
        placeholders.delete(name);
      }
    }

    // 动态导入实际命令模块并挂载真实命令
    const mod = await importCommandModule(decl.loader);
    const fn = mod[decl.registerFn];
    if (typeof fn === "function") {
      fn(program, context);
      applyCommonOptions(program);
    }
  })();

  loadingPromises.set(decl.loader, loadPromise);
  loadPromise.catch(() => {
    loadingPromises.delete(decl.loader);
  });
  return loadPromise;
}

export function createCliProgram(context?: CliContext): Command {
  const program = new Command();

  program
    .name("ad")
    .description("ActionDock (ad) 2.0 - Toolchain for building and shipping standalone AI Agent Actions & Skills")
    .version(CLI_VERSION, "-v, --version");

  program.option("-V", "output the version number");
  program.on("option:V", () => {
    (program as any)._outputConfiguration.writeOut(`${program.version()}\n`);
    (program as any)._exit(0, "commander.version", program.version()!);
  });

  // 禁用 Commander 内部直接 process.exit，统一由顶层调度器管控退出码
  program.exitOverride((err) => {
    throw err;
  });

  if (context?.stdout || context?.stderr) {
    program.configureOutput({
      writeOut: (str) => {
        if (context.stdout) context.stdout(str);
        else process.stdout.write(str);
      },
      writeErr: (str) => {
        if (context.stderr) context.stderr(str);
        else process.stderr.write(str);
      },
    });
  }

  program.addHelpText(
    "after",
    `
Workflow Guidance:
  For multi-step workflows, run 'ad playbook list' before invoking atomic actions.
  Run 'ad info [intent]' to discover packages and playbooks by keyword.`
  );

  // 注册轻量级占位命令声明（零重型模块导入开销）
  const placeholders = new Map<string, Command>();
  for (const decl of COMMAND_DECLARATIONS) {
    const cmd = program.command(decl.spec).description(decl.description);
    if (decl.alias) {
      cmd.alias(decl.alias);
    }
    placeholders.set(decl.name, cmd);
  }

  applyCommonOptions(program);

  // 拦截 parseAsync 以在实际执行或具体帮助展示时按需动态加载真实子命令
  const originalParseAsync = program.parseAsync.bind(program);
  const loadingPromises = new Map<string, Promise<void>>();

  program.parseAsync = async function (
    argv?: readonly string[],
    parseOptions?: any
  ): Promise<Command> {
    const targetArgv = argv || process.argv;
    const targetSubcommand = resolveTargetSubcommand(targetArgv, parseOptions);
    if (targetSubcommand) {
      await loadAndAttachCommand(targetSubcommand, program, placeholders, loadingPromises, context);
    }
    return originalParseAsync(argv, parseOptions);
  };

  return program;
}

export const registerActionCommands = (program: Command, context?: CliContext) =>
  importCommandModule("./action/create").then((m) => m.registerActionCommands(program, context));
export const registerAddCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./add").then((m) => m.registerAddCommand(program, context));
export const registerBuildCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./build").then((m) => m.registerBuildCommand(program, context));
export const registerConfigCommands = (program: Command, context?: CliContext) =>
  importCommandModule("./config/index").then((m) => m.registerConfigCommands(program, context));
export const registerDescribeCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./describe").then((m) => m.registerDescribeCommand(program, context));
export const registerDoctorCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./doctor").then((m) => m.registerDoctorCommand(program, context));
export const registerExportCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./export").then((m) => m.registerExportCommand(program, context));
export const registerGenerateCommands = (program: Command, context?: CliContext) =>
  importCommandModule("./generate").then((m) => m.registerGenerateCommands(program, context));
export const registerInfoCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./info").then((m) => m.registerInfoCommand(program, context));
export const registerInitCommand = (program: Command) =>
  importCommandModule("./init").then((m) => m.registerInitCommand(program));
export const registerLinkCommands = (program: Command) =>
  importCommandModule("./link").then((m) => m.registerLinkCommands(program));
export const registerListCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./list").then((m) => m.registerListCommand(program, context));
export const registerMcpCommands = (program: Command, context?: CliContext) =>
  importCommandModule("./mcp").then((m) => m.registerMcpCommands(program, context));
export const registerPackCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./pack").then((m) => m.registerPackCommand(program, context));
export const registerPlaybookCommands = (program: Command, context?: CliContext) =>
  importCommandModule("./playbook").then((m) => m.registerPlaybookCommands(program, context));
export const registerProfileCommands = (program: Command) =>
  importCommandModule("./profile").then((m) => m.registerProfileCommands(program));
export const registerRemoveCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./remove").then((m) => m.registerRemoveCommand(program, context));
export const registerRunCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./run").then((m) => m.registerRunCommand(program, context));
export const registerRunsCommands = (program: Command, context?: CliContext) =>
  importCommandModule("./runs").then((m) => m.registerRunsCommands(program, context));
export const registerServeCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./serve").then((m) => m.registerServeCommand(program, context));
export const registerStateCommands = (program: Command, context?: CliContext) =>
  importCommandModule("./state").then((m) => m.registerStateCommands(program, context));
export const registerTestCommand = (program: Command) =>
  importCommandModule("./test").then((m) => m.registerTestCommand(program));
export const registerValidateCommand = (program: Command, context?: CliContext) =>
  importCommandModule("./validate").then((m) => m.registerValidateCommand(program, context));
