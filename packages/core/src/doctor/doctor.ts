import type { DoctorCheckContext, DoctorCheck } from "./context";
import { createDoctorCheckContext } from "./context";
import {
  checkBunRuntime,
  checkCliExecutable,
  checkGlobalRegistry,
  checkGlobalStorage,
  checkLinkedPackageDependencies,
  checkNodeRuntime,
  checkProject,
  checkUsesClosure,
  locateProject,
} from "./checks";
import type { DoctorReport } from "./types";

/**
 * 检查注册表：按诊断执行顺序排列的检查阶段。
 * 运行时 → 存储 → 注册表 → 工程定位 → 工程级详情，与报告展示顺序一一对应。
 */
const doctorCheckRegistry: DoctorCheck[] = [
  checkNodeRuntime,
  checkBunRuntime,
  checkCliExecutable,
  checkGlobalStorage,
  checkGlobalRegistry,
  checkLinkedPackageDependencies,
  checkUsesClosure,
  locateProject,
  checkProject,
];

/**
 * 执行环境与依赖体检诊断。
 * 按注册表顺序执行各检查阶段（各阶段自行兜底异常，转为对应检查项呈现），
 * 最终汇总各状态计数并输出结构化诊断报告。
 */
export async function runDoctorChecks(options?: {
  cwd?: string;
  packageIdOrPath?: string;
  customHome?: string;
  packageAllowlist?: string[];
}): Promise<DoctorReport> {
  const ctx: DoctorCheckContext = createDoctorCheckContext(options);

  for (const check of doctorCheckRegistry) {
    await check.run(ctx);
  }

  const okCount = ctx.checks.filter((c) => c.status === "ok").length;
  const warnCount = ctx.checks.filter((c) => c.status === "warn").length;
  const errorCount = ctx.checks.filter((c) => c.status === "error").length;

  return {
    ok: errorCount === 0,
    hasProject: !!ctx.projectRoot,
    projectRoot: ctx.projectRoot || undefined,
    packageId: ctx.packageId,
    summary: {
      total: ctx.checks.length,
      ok: okCount,
      warn: warnCount,
      error: errorCount,
    },
    checks: ctx.checks,
  };
}
