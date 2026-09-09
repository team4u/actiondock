#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const isBun = typeof process.versions.bun !== "undefined";

// 本进程是否已挂载 tsx 引导器。execArgv 不会被子进程继承，必须逐进程检测；
// 严禁改用环境变量判断：Action 内嵌套调度的 ad 子进程会继承父进程环境变量，
// 却不继承 --import，误判为已引导后会直接 import node_modules 下的 TS 源码，
// 触发 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING。
// 注意也不能依赖 Node 原生类型剥离：它拒绝 node_modules 下的文件，且不支持源码中的目录导入。
const hasTsx =
  process.execArgv.some((arg, i) => arg === "--import" && process.execArgv[i + 1]?.includes("tsx")) ||
  process.execArgv.some((arg) => arg.includes("tsx"));

if (!isBun && !hasTsx) {
  const require = createRequire(import.meta.url);
  let tsxSpecifier = "tsx";
  try {
    tsxSpecifier = pathToFileURL(require.resolve("tsx")).href;
  } catch {
    try {
      const runtimeNodePkg = require.resolve("@actiondock/runtime-node/package.json");
      const runtimeReq = createRequire(runtimeNodePkg);
      tsxSpecifier = pathToFileURL(runtimeReq.resolve("tsx")).href;
    } catch {
      // 回退为裸模块名
    }
  }

  const res = spawnSync(
    process.execPath,
    ["--import", tsxSpecifier, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      stdio: "inherit",
    }
  );
  process.exit(res.status ?? (res.signal ? 1 : 0));
}

let main;
try {
  ({ main } = await import("../dist/index.js"));
} catch {
  ({ main } = await import("../src/index.ts"));
}
await main(process.argv);

