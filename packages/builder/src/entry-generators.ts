import { STANDALONE_ASYNC_UNSUPPORTED } from "@actiondock/core";
import { isOwnAction } from "./types";
import type { SelectionPlan } from "./types";

/**
 * 生成 Host 子进程入口脚本源码（负责运行 ActionDockHost，通过 Node IPC 暴露 Target）。
 * 与 serializePlanManifest / stageSources 的过滤条件保持一致：跨包外部 Action 不进入 import 与运行时注册，
 * 避免入口 import 清单没有的源文件产生孤儿模块（外部源码未物化进本包目录，运行时必然加载失败）。
 */
export function generateNodeHostEntrySource(plan: SelectionPlan): string {
  // 仅包自有 Action 参与 import 与注册，与产物清单保持同一事实源
  const ownActions = plan.actions.filter((a) => isOwnAction(a));
  const imports = ownActions
    .map((act, idx) => `import action_${idx} from ${JSON.stringify(`./${act.entry.replace(/\\/g, "/")}`)};`)
    .join("\n");

  const actionsDict: Record<string, unknown> = {};
  for (const a of ownActions) {
    actionsDict[a.id] = {
      entry: a.entry,
      description: a.description || "",
      inputSchema: a.inputSchema ?? null,
      outputSchema: a.outputSchema ?? null,
      uses: a.uses || [],
      tags: a.tags || [],
      annotations: a.annotations || {},
    };
  }

  const actionItems = ownActions
    .map((a, idx) => {
      const entryObj = `{
      ...(typeof action_${idx} === "function" ? { run: action_${idx} } : action_${idx}),
      id: action_${idx}?.id || ${JSON.stringify(a.id)},
      description: action_${idx}?.description || ${JSON.stringify(a.description || "")},
      inputSchema: action_${idx}?.inputSchema ?? ${JSON.stringify(a.inputSchema ?? null)},
      outputSchema: action_${idx}?.outputSchema ?? ${JSON.stringify(a.outputSchema ?? null)},
      uses: action_${idx}?.uses || ${JSON.stringify(a.uses || [])},
      tags: action_${idx}?.tags || ${JSON.stringify(a.tags || [])},
      annotations: action_${idx}?.annotations || ${JSON.stringify(a.annotations || {})},
    }`;
      return entryObj;
    })
    .join(",\n    ");

  return `#!/usr/bin/env node
// AUTO-GENERATED HOST ENTRYPOINT BY ACTIONDOCK BUILDER. DO NOT EDIT.
import "@actiondock/core/warning";
import {
  createActionDock,
  createNodePlatform,
} from "@actiondock/core";
import { serveParentIpc } from "@actiondock/core/server";

${imports}

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

const service = await createActionDock({
  dataDir,
  packages: [
    {
      dataDir,
      configOverrides,
      projectConfig: {
        id: ${JSON.stringify(plan.packageId)},
        name: ${JSON.stringify(plan.packageName)},
        version: ${JSON.stringify(plan.version)},
        description: ${JSON.stringify(plan.description || "")},
        config: ${JSON.stringify(plan.configDefs || {})},
        actions: ${JSON.stringify(actionsDict)},
      },
      actions: [
        ${actionItems}
      ],
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
import "@actiondock/core/warning";
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
  console.log("  <cmd> config list/get/set/delete            Manage package configuration");
  console.log("  <cmd> state list/get/set/delete             Manage shared state store");
  console.log("\\nGlobal options:");
  console.log("  --data-dir <path>                           Custom runtime database directory");
  console.log("  --config <KEY=val>                          Temporary config override");
  process.exit(ExitCode.SUCCESS);
}

// 3. 建立物理隔离监督边界，启动运行 ActionDockHost 的独立子进程
const hostScript = join(import.meta.dirname, "entry-host.js");
const warningFlags = process.env.ACTIONDOCK_SILENCE_WARNINGS !== "0" ? ["--no-warnings=ExperimentalWarning"] : [];
const child = spawn(process.execPath, [...warningFlags, hostScript, ...argv], {
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
