import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ActionDockError,
  DEPENDENCIES_NOT_READY,
  DEPENDENCY_INSTALL_FAILED,
} from "../src/errors.ts";
import { resolvePackageManagerPlan } from "../src/project/dependencies.ts";

const NO_INSTALLER_ENV: Record<string, string | undefined> = {};

interface PlannerRow {
  title: string;
  packageManager?: string;
  locks?: string[];
  env?: Record<string, string | undefined>;
  expected?: { manager: "npm" | "bun"; hasLock: boolean; args: string[] };
  expectError?: { code: string; messageIncludes: string };
}

const PLAN_ROWS: PlannerRow[] = [
  {
    title: "无锁无声明默认npm且执行install",
    expected: {
      manager: "npm",
      hasLock: false,
      args: ["install", "--omit=dev", "--ignore-scripts"],
    },
  },
  {
    title: "package-lock.json单锁走npm ci",
    locks: ["package-lock.json"],
    expected: {
      manager: "npm",
      hasLock: true,
      args: ["ci", "--omit=dev", "--ignore-scripts"],
    },
  },
  {
    title: "npm-shrinkwrap.json同样视为npm锁",
    locks: ["npm-shrinkwrap.json"],
    expected: {
      manager: "npm",
      hasLock: true,
      args: ["ci", "--omit=dev", "--ignore-scripts"],
    },
  },
  {
    title: "bun.lock单锁走生产冻结安装",
    locks: ["bun.lock"],
    expected: {
      manager: "bun",
      hasLock: true,
      args: ["install", "--production", "--frozen-lockfile", "--ignore-scripts"],
    },
  },
  {
    title: "bun.lockb同bun.lock处理",
    locks: ["bun.lockb"],
    expected: {
      manager: "bun",
      hasLock: true,
      args: ["install", "--production", "--frozen-lockfile", "--ignore-scripts"],
    },
  },
  {
    title: "声明packageManager npm@10.2.3解析为npm并保留锁感知",
    packageManager: "npm@10.2.3",
    locks: ["package-lock.json"],
    expected: {
      manager: "npm",
      hasLock: true,
      args: ["ci", "--omit=dev", "--ignore-scripts"],
    },
  },
  {
    title: "声明packageManager bun无锁走非冻结生产安装",
    packageManager: "bun@1.1.0",
    expected: {
      manager: "bun",
      hasLock: false,
      args: ["install", "--production", "--ignore-scripts"],
    },
  },
  {
    title: "ACTIONDOCK_INSTALLER显式指定bun优先于默认",
    env: { ACTIONDOCK_INSTALLER: "bun" },
    expected: {
      manager: "bun",
      hasLock: false,
      args: ["install", "--production", "--ignore-scripts"],
    },
  },
  {
    title: "ACTIONDOCK_INSTALLER与packageManager声明一致时不视为冲突",
    packageManager: "npm@10.0.0",
    env: { ACTIONDOCK_INSTALLER: "npm" },
    locks: ["package-lock.json"],
    expected: {
      manager: "npm",
      hasLock: true,
      args: ["ci", "--omit=dev", "--ignore-scripts"],
    },
  },
  {
    title: "多锁冲突一律拒绝安装",
    locks: ["package-lock.json", "bun.lock"],
    env: { ACTIONDOCK_INSTALLER: "npm" },
    expectError: { code: DEPENDENCY_INSTALL_FAILED, messageIncludes: "Conflicting lockfiles" },
  },
  {
    title: "pnpm单锁引导手动准备",
    locks: ["pnpm-lock.yaml"],
    expectError: { code: DEPENDENCIES_NOT_READY, messageIncludes: "pnpm" },
  },
  {
    title: "yarn单锁引导手动准备",
    locks: ["yarn.lock"],
    expectError: { code: DEPENDENCIES_NOT_READY, messageIncludes: "yarn" },
  },
  {
    title: "声明pnpm即使无锁也不启动npm",
    packageManager: "pnpm@9.5.0",
    expectError: { code: DEPENDENCIES_NOT_READY, messageIncludes: "pnpm" },
  },
  {
    title: "声明yarn即使无锁也不启动npm",
    packageManager: "yarn@4.1.0",
    expectError: { code: DEPENDENCIES_NOT_READY, messageIncludes: "yarn" },
  },
  {
    title: "声明npm与bun单锁冲突拒绝安装",
    packageManager: "npm@10.0.0",
    locks: ["bun.lock"],
    expectError: {
      code: DEPENDENCY_INSTALL_FAILED,
      messageIncludes: "conflicts with existing bun lockfile",
    },
  },
  {
    title: "ACTIONDOCK_INSTALLER与bun单锁冲突拒绝安装",
    env: { ACTIONDOCK_INSTALLER: "npm" },
    locks: ["bun.lock"],
    expectError: {
      code: DEPENDENCY_INSTALL_FAILED,
      messageIncludes: "conflicts with existing bun lockfile",
    },
  },
  {
    title: "ACTIONDOCK_INSTALLER与packageManager声明冲突拒绝安装",
    packageManager: "bun@1.1.0",
    env: { ACTIONDOCK_INSTALLER: "npm" },
    expectError: {
      code: DEPENDENCY_INSTALL_FAILED,
      messageIncludes: "conflicts with declared packageManager",
    },
  },
  {
    title: "ACTIONDOCK_INSTALLER无效取值拒绝安装",
    env: { ACTIONDOCK_INSTALLER: "deno" },
    expectError: { code: DEPENDENCY_INSTALL_FAILED, messageIncludes: "Unsupported ACTIONDOCK_INSTALLER" },
  },
  {
    title: "packageManager声明无效工具拒绝安装",
    packageManager: "deno@2.0.0",
    expectError: { code: DEPENDENCY_INSTALL_FAILED, messageIncludes: "Unsupported packageManager" },
  },
];

function createPlannerProject(row: PlannerRow): string {
  const dir = mkdtempSync(join(tmpdir(), "ad-planner-test-"));
  mkdirSync(dir, { recursive: true });
  const pkgJson: Record<string, unknown> = { name: "planner-project", version: "1.0.0" };
  if (row.packageManager !== undefined) {
    pkgJson.packageManager = row.packageManager;
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkgJson, null, 2));
  for (const lock of row.locks ?? []) {
    writeFileSync(join(dir, lock), "");
  }
  return dir;
}

describe("依赖准备包管理器决策表", () => {
  for (const row of PLAN_ROWS) {
    it(row.title, () => {
      const dir = createPlannerProject(row);
      try {
        if (row.expectError) {
          assert.throws(
            () => resolvePackageManagerPlan(dir, row.env ?? NO_INSTALLER_ENV),
            (err: unknown) => {
              assert.ok(err instanceof ActionDockError);
              assert.strictEqual(err.code, row.expectError!.code);
              assert.ok(
                err.message.includes(row.expectError!.messageIncludes),
                `message should include '${row.expectError!.messageIncludes}': ${err.message}`
              );
              return true;
            }
          );
          return;
        }
        const plan = resolvePackageManagerPlan(dir, row.env ?? NO_INSTALLER_ENV);
        assert.deepStrictEqual(plan, row.expected);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
