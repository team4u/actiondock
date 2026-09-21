import { findExecutable } from "../../utils";
import type { DoctorCheck } from "../context";

function compareSemver(v1: string, v2: string): number {
  const p1 = v1.replace(/^v/, "").split(".").map(Number);
  const p2 = v2.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * 检查 Node.js 运行时版本是否满足最低要求（>= 24.12.0）。
 */
export const checkNodeRuntime: DoctorCheck = {
  id: "runtime.node",
  run: (ctx) => {
    const nodeVersion = process.versions.node;
    if (nodeVersion) {
      const isGte24 = compareSemver(nodeVersion, "24.12.0") >= 0;
      ctx.checks.push({
        id: "runtime.node",
        category: "runtime",
        name: "Node.js Runtime",
        status: isGte24 ? "ok" : "warn",
        message: `v${nodeVersion} (${isGte24 ? ">= 24.12.0 supported" : ">= 24.12.0 recommended"})`,
        fix: isGte24 ? undefined : "Upgrade Node.js to v24.12.0 or higher",
      });
    }
  },
};

/**
 * 检查 Bun 运行时可用性（可选环境，用于跨运行时兼容性测试）。
 */
export const checkBunRuntime: DoctorCheck = {
  id: "runtime.bun",
  run: (ctx) => {
    const bunVersion =
      (typeof (globalThis as any).Bun !== "undefined" && (globalThis as any).Bun.version) ||
      (process.versions as any).bun;
    if (bunVersion) {
      ctx.checks.push({
        id: "runtime.bun",
        category: "runtime",
        name: "Bun Runtime",
        status: "ok",
        message: `v${bunVersion} (available for cross-environment testing)`,
      });
    } else {
      ctx.checks.push({
        id: "runtime.bun",
        category: "runtime",
        name: "Bun Runtime",
        status: "ok",
        message: "Bun runtime not detected (optional, used for cross-environment compatibility testing)",
      });
    }
  },
};

/**
 * 检查 CLI 可执行文件（ad）是否在 PATH 中。
 */
export const checkCliExecutable: DoctorCheck = {
  id: "runtime.cli",
  run: (ctx) => {
    const adPath = findExecutable("ad");

    if (adPath) {
      ctx.checks.push({
        id: "runtime.cli",
        category: "runtime",
        name: "CLI Executable",
        status: "ok",
        message: `Found 'ad' in PATH at ${adPath}`,
      });
    } else {
      ctx.checks.push({
        id: "runtime.cli",
        category: "runtime",
        name: "CLI Executable",
        status: "warn",
        message: "'ad' command not found in PATH",
        fix: "Run 'npm install -g @actiondock/cli' or in SDK workspace run 'cd packages/cli && npm link'",
      });
    }
  },
};
