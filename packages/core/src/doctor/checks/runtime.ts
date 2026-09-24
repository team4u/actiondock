import { findExecutable, parseSemVer } from "../../utils";
import type { DoctorCheck } from "../context";

/**
 * 比较两个版本字符串（基于 utils.parseSemVer 单一事实源）。
 *
 * 行为契约（与历史手写实现逐字节对齐）：
 * - 双方均为严格三段式语义化版本且无预发布后缀时，按 major/minor/patch 逐段数值比较；
 * - 其余形态（两段式、带 v 前缀的四段式、携带预发布后缀等）回退到历史宽松语义：
 *   去 v 前缀后按点分段数值比较，缺段补零、非数值段作零。
 *   宽松回退保留历史行为的尾段数值比较（预发布后缀的数字段参与比较），
 *   与 parseSemVer 的严格语义存在刻意差异，不得合并。
 */
function compareSemver(v1: string, v2: string): number {
  // 预检：parseSemVer 会剥离 = 前缀而历史宽松语义不会（NaN 段作零），
  // 携带 = 前缀的输入必须回退宽松分支以保持历史行为完全一致。
  if (v1[0] === "=" || v2[0] === "=") {
    return compareLooseVersion(v1, v2);
  }
  const s1 = parseSemVer(v1);
  const s2 = parseSemVer(v2);
  if (s1 && s2 && !s1.prerelease && !s2.prerelease) {
    if (s1.major !== s2.major) return s1.major > s2.major ? 1 : -1;
    if (s1.minor !== s2.minor) return s1.minor > s2.minor ? 1 : -1;
    if (s1.patch !== s2.patch) return s1.patch > s2.patch ? 1 : -1;
    return 0;
  }
  return compareLooseVersion(v1, v2);
}

/**
 * 历史宽松版本比较（去 v 前缀后按点分段数值比较，缺段补零、非数值段作零）。
 * 仅供 compareSemver 的非严格形态回退分支使用，禁止断开对外直接引用。
 */
function compareLooseVersion(v1: string, v2: string): number {
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
