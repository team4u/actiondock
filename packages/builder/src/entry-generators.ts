import { STANDALONE_ASYNC_UNSUPPORTED } from "@actiondock/core";
import { serializePlanManifest } from "./manifest";
import type { SelectionPlan } from "./types";

/**
 * 生成 Host 子进程入口脚本源码（负责运行 ActionDockHost，通过 Node IPC 暴露 Target）。
 *
 * 按需装配契约：
 * - 不再静态导入全部包内 Action（消除发现路径的业务模块顶层副作用）；
 * - 仅携带清单元数据，执行时由现有执行服务通过清单 entry 与 NodeModuleLoader
 *   按需加载业务实现；跨包外部 Action 不混入本包源码，依赖调用继续经 Host 路由；
 * - 入口路径以产物包根目录为基准（import.meta.dirname），不依赖调用者当前工作目录。
 */
export function generateNodeHostEntrySource(plan: SelectionPlan): string {
  // 复用 SelectionPlan 的清单序列化单一事实源（含包内动作筛选与 Schema 字段映射），
  // 不单独复制一份 Schema 字段映射
  const manifestActions = serializePlanManifest(plan).actions;

  return `#!/usr/bin/env node
// AUTO-GENERATED HOST ENTRYPOINT BY ACTIONDOCK BUILDER. DO NOT EDIT.
import {
  createActionDock,
  createNodePlatform,
} from "@actiondock/core";
import { serveParentIpc } from "@actiondock/core/server";

// 产物包根目录：以入口文件自身位置为基准，不依赖调用者当前工作目录
const packageRoot = import.meta.dirname;

let dataDir;
const configOverrides = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--data-dir" && i + 1 < args.length) {
    dataDir = args[++i];
  } else if (args[i].startsWith("--data-dir=")) {
    dataDir = args[i].slice(11);
  } else if (args[i] === "--config" && i + 1 < args.length) {
    const raw = args[++i];
    const [k, ...v] = raw.split("=");
    if (k) configOverrides[k] = v.join("=");
  } else if (args[i].startsWith("--config=")) {
    const raw = args[i].slice(9);
    const [k, ...v] = raw.split("=");
    if (k) configOverrides[k] = v.join("=");
  }
}

// 复用既有命令分发结果确定访问性质：发现命令（list/describe/show）为旁观初始化，
// 不创建数据库、不取目录锁、不收割遗留运行记录；执行与写入命令为持有者初始化
const command = args.find((a) => !a.startsWith("-")) || "";
const DISCOVERY_COMMANDS = new Set(["list", "describe", "show"]);
const recoverOrphans = DISCOVERY_COMMANDS.has(command) ? false : undefined;

const service = await createActionDock({
  dataDir,
  ...(recoverOrphans === false ? { recoverOrphans: false } : {}),
  packages: [
    {
      packageRoot,
      dataDir,
      configOverrides,
      projectConfig: {
        id: ${JSON.stringify(plan.packageId)},
        name: ${JSON.stringify(plan.packageName)},
        version: ${JSON.stringify(plan.version)},
        description: ${JSON.stringify(plan.description || "")},
        config: ${JSON.stringify(plan.configDefs || {})},
        actions: ${JSON.stringify(manifestActions)},
      },
    },
  ],
  platform: createNodePlatform({ dataDir }),
  autoLoadCurrentProject: false,
  scanLinkedPackages: false,
});
await serveParentIpc(service);
`;
}

/**
 * 生成轻量监督父进程脚本源码（负责参数解析、诊断日志限流、退出码管理与标准输出隔离）。
 */
export function generateNodeSupervisorEntrySource(plan: SelectionPlan): string {
  return `#!/usr/bin/env node
// AUTO-GENERATED SUPERVISOR ENTRYPOINT BY ACTIONDOCK BUILDER. DO NOT EDIT.
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  STANDALONE_ASYNC_UNSUPPORTED,
} from "@actiondock/core";

import {
  ExitCode,
  IpcActionDockService,
  StandaloneDispatcher,
} from "@actiondock/core/server";

const METADATA = {
  packageId: ${JSON.stringify(plan.packageId)},
  version: ${JSON.stringify(plan.version)},
  description: ${JSON.stringify(plan.description || "")},
};

const argv = process.argv.slice(2);

// 1. 监督进程接管参数校验，明确拒绝 --async
if (argv.includes("--async")) {
  const isJson = argv.includes("--json");
  if (isJson) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: {
            code: ${JSON.stringify(STANDALONE_ASYNC_UNSUPPORTED)},
            message:
              "Async execution is not supported in standalone single-execution binaries. Use 'ad serve' or remote target.",
          },
        },
        null,
        2
      )
    );
  } else {
    console.error(
      "Error [" + STANDALONE_ASYNC_UNSUPPORTED + "]: Async execution is not supported in standalone single-execution binaries."
    );
  }
  process.exit(ExitCode.FAILURE);
}

// 2. 静态元数据快速返回
if (argv.includes("-v") || argv.includes("-V") || argv.includes("--version") || argv[0] === "version") {
  console.log(\`\${METADATA.packageId} v\${METADATA.version}\`);
  process.exit(ExitCode.SUCCESS);
}

if (argv.includes("-h") || argv.includes("--help") || argv[0] === "help") {
  console.log(\`\${METADATA.packageId} (v\${METADATA.version})\`);
  if (METADATA.description) console.log(METADATA.description + "\\n");
  console.log("Usage:");
  console.log("  <cmd> list [--json]                         List available actions");
  console.log("  <cmd> describe <id> [--json]                Show action details and schemas");
  console.log("  <cmd> run <id> [--input '<json>']           Execute action with JSON input");
  console.log("  <cmd> run <id> [--stdin-field <field>] [-- <assignments...>]");
  console.log("                                             Bind raw stdin text to an input field");
  console.log("  <cmd> config list/get/set/delete            Manage package configuration");
  console.log("  <cmd> state list/get/set/delete             Manage shared state store");
  console.log("\\nGlobal options:");
  console.log("  --data-dir <path>                           Custom runtime database directory");
  console.log("  --config <KEY=val>                          Temporary config override");
  process.exit(ExitCode.SUCCESS);
}

// 3. 建立物理隔离监督边界，启动运行 ActionDockHost 的独立子进程
const hostScript = join(import.meta.dirname, "entry-host.js");
const child = spawn(process.execPath, [hostScript, ...argv], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["pipe", "pipe", "pipe", "ipc"],
});

// 4. 标准输出通道物理隔离与受控限流排空

const service = new IpcActionDockService({
  childProcess: child,
  diagnosticTarget: process.stderr,
});

let cleanedUp = false;
const cleanup = async () => {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    await service.close();
  } catch (err) {
    // 防御与透明：服务关闭失败时告警输出至标准错误流，不阻塞退出流程
    process.stderr.write(\`[Supervisor] Warning: Cleanup failed: \${err?.message || String(err)}\\n\`);
  }
};

process.once("SIGINT", async () => {
  await cleanup();
  process.exit(ExitCode.SIGINT);
});

process.once("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

const dispatcher = new StandaloneDispatcher({
  packageId: METADATA.packageId,
  version: METADATA.version,
  description: METADATA.description,
  service,
});

try {
  const exitCode = await dispatcher.dispatch(argv);
  await cleanup();
  process.exit(exitCode);
} catch (err) {
  if (err?.code === "HOST_PROCESS_EXITED") {
    console.error("[Supervisor] Host process exited unexpectedly:", err.message);
  } else {
    console.error("[Supervisor] Error:", err?.message || err);
  }
  await cleanup();
  process.exit(ExitCode.FAILURE);
}
`;
}
