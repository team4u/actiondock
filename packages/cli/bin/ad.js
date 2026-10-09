#!/usr/bin/env node
import { enableCompileCache } from "node:module";
try {
  enableCompileCache?.();
} catch {}

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const isBun = typeof process.versions.bun !== "undefined";
const hasTsx =
  process.execArgv.some((arg, i) => arg === "--import" && process.execArgv[i + 1]?.includes("tsx")) ||
  process.execArgv.some((arg) => arg.includes("tsx"));

const nodeMajor = parseInt(process.versions.node?.split(".")[0] || "0", 10);
const hasNativeTypeStripping =
  nodeMajor >= 24 ||
  Boolean(process.features?.typescript) ||
  process.execArgv.includes("--experimental-strip-types") ||
  process.execArgv.includes("--experimental-transform-types") ||
  Boolean(process.env.NODE_OPTIONS?.includes("--experimental-strip-types")) ||
  Boolean(process.env.NODE_OPTIONS?.includes("--experimental-transform-types"));

const ROUTINE_COMMANDS = new Set([
  "list",
  "info",
  "describe",
  "validate",
  "config",
  "doctor",
  "state",
  "runs",
  "add",
  "remove",
  "init",
  "new",
  "link",
  "unlink",
  "pack",
  "generate",
  "profile",
  "help",
]);

function findNearestProjectRoot(startDir = process.cwd()) {
  let current;
  try {
    current = resolve(startDir);
  } catch {
    return startDir;
  }
  while (true) {
    if (existsSync(join(current, "actiondock.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return startDir;
}

/**
 * 决定是否需要派生 tsx 加载器：
 * - 纯 TypeScript 工程在 Node 24 原生环境下直接执行，绝不派生进程；
 * - 常规运维与元数据命令（ad -v、ad info、ad list、ad config 等）绝不派生；
 * - 仅当环境显式要求、或直接执行的 Action / 工程配置声明了 JSX/TSX 等非标准语法时，按需派生 tsx。
 */
function checkNeedsTsx(rawArgv) {
  if (isBun || hasTsx) {
    return { needsTsx: false, projectRoot: process.cwd() };
  }

  const explicitTsx =
    process.env.ACTIONDOCK_FORCE_TSX === "1" ||
    process.env.ACTIONDOCK_FORCE_TSX === "true" ||
    process.env.ACTIONDOCK_TSX === "1" ||
    process.env.ACTIONDOCK_TSX === "true" ||
    process.env.TSX === "1" ||
    rawArgv.includes("--tsx") ||
    rawArgv.includes("--force-tsx");

  if (explicitTsx) {
    return { needsTsx: true, projectRoot: process.cwd() };
  }

  if (!hasNativeTypeStripping) {
    return { needsTsx: true, projectRoot: process.cwd() };
  }

  if (
    rawArgv.length === 0 ||
    rawArgv.includes("-v") ||
    rawArgv.includes("--version") ||
    rawArgv.includes("-V") ||
    rawArgv.includes("-h") ||
    rawArgv.includes("--help")
  ) {
    return { needsTsx: false, projectRoot: process.cwd() };
  }

  let mainCommand = null;
  let actionTarget = null;
  let targetDir = process.cwd();

  for (let i = 0; i < rawArgv.length; i++) {
    const token = rawArgv[i];
    if (token === "--cwd" || token === "-C" || token === "--project" || token === "--dir") {
      const next = rawArgv[i + 1];
      if (next && !next.startsWith("-")) {
        try {
          targetDir = resolve(next);
        } catch {}
      }
      i++;
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    if (!mainCommand) {
      mainCommand = token;
      continue;
    }
    if (!actionTarget) {
      actionTarget = token;
      break;
    }
  }

  if (!mainCommand || ROUTINE_COMMANDS.has(mainCommand)) {
    return { needsTsx: false, projectRoot: targetDir };
  }

  if (mainCommand === "action") {
    if (!actionTarget || actionTarget === "create") {
      return { needsTsx: false, projectRoot: targetDir };
    }
  } else if (mainCommand === "playbook") {
    if (!actionTarget || actionTarget === "list" || actionTarget === "show" || actionTarget === "validate" || actionTarget === "create") {
      return { needsTsx: false, projectRoot: targetDir };
    }
  }

  if (actionTarget && (actionTarget.endsWith(".tsx") || actionTarget.endsWith(".jsx"))) {
    return { needsTsx: true, projectRoot: targetDir };
  }

  const projectRoot = findNearestProjectRoot(targetDir);

  const manifestPath = join(projectRoot, "actiondock.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      if (
        manifest.jsx === true ||
        manifest.tsx === true ||
        manifest.transpile === true ||
        manifest.runtime === "tsx" ||
        manifest.runtime?.transpiler === "tsx" ||
        Boolean(manifest.compilerOptions?.jsx)
      ) {
        return { needsTsx: true, projectRoot };
      }

      if (actionTarget && manifest.actions?.[actionTarget]?.entry) {
        const entry = String(manifest.actions[actionTarget].entry);
        if (entry.endsWith(".tsx") || entry.endsWith(".jsx")) {
          return { needsTsx: true, projectRoot };
        }
      }

      if (manifest.actions) {
        for (const entry of Object.values(manifest.actions)) {
          if (typeof entry?.entry === "string" && (entry.entry.endsWith(".tsx") || entry.entry.endsWith(".jsx"))) {
            return { needsTsx: true, projectRoot };
          }
        }
      }
    } catch {}
  }

  const tsconfigPath = join(projectRoot, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    try {
      const content = readFileSync(tsconfigPath, "utf-8");
      if (/"jsx"\s*:/i.test(content)) {
        return { needsTsx: true, projectRoot };
      }
    } catch {}
  }

  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.jsx) {
        return { needsTsx: true, projectRoot };
      }
    } catch {}
  }

  return { needsTsx: false, projectRoot };
}

const rawArgv = process.argv.slice(2);
const { needsTsx, projectRoot } = checkNeedsTsx(rawArgv);

if (needsTsx) {
  const require = createRequire(import.meta.url);
  let tsxSpecifier = null;
  const searchPaths = [import.meta.dirname, process.cwd(), projectRoot];
  try {
    tsxSpecifier = pathToFileURL(require.resolve("tsx", { paths: searchPaths })).href;
  } catch {
    try {
      tsxSpecifier = pathToFileURL(require.resolve("tsx")).href;
    } catch {
      // 未检测到 tsx 模块
    }
  }

  if (tsxSpecifier) {
    const extraFlags = [];
    if (nodeMajor >= 24) {
      extraFlags.push("--no-strip-types");
    }
    const child = spawn(
      process.execPath,
      [...extraFlags, "--import", tsxSpecifier, fileURLToPath(import.meta.url), ...rawArgv],
      {
        stdio: "inherit",
      }
    );

    const forwardSignal = (sig) => {
      if (child.pid && !child.killed) {
        try {
          child.kill(sig);
        } catch {}
      }
    };

    process.on("SIGTERM", () => forwardSignal("SIGTERM"));
    process.on("SIGINT", () => forwardSignal("SIGINT"));
    process.on("SIGHUP", () => forwardSignal("SIGHUP"));

    await new Promise((resolvePromise) => {
      child.on("exit", (code, signal) => {
        if (signal) {
          process.removeListener("SIGTERM", forwardSignal);
          process.removeListener("SIGINT", forwardSignal);
          process.removeListener("SIGHUP", forwardSignal);
          process.kill(process.pid, signal);
        } else {
          process.exit(code ?? 0);
        }
        resolvePromise();
      });
    });
  }
}

const distEntry = resolve(import.meta.dirname, "../dist/index.js");

if (existsSync(distEntry)) {
  const { runCliProcess } = await import(pathToFileURL(distEntry).href);
  await runCliProcess(process.argv);
} else {
  const { runCliProcess } = await import("../src/index.ts");
  await runCliProcess(process.argv);
}
