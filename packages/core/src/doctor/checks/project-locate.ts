import { PACKAGE_ID_CONFLICT } from "../../errors";
import { findProjectRoot, loadProjectConfig } from "../../project/loader";
import {
  listLinkedPackages,
  loadRegistry,
} from "../../registry/registry";
import { getEffectiveLinkedPackages } from "../../registry/linked-packages";
import { resolvePackageRootWithCandidates } from "../../registry/resolve-package";
import type { DoctorCheck } from "../context";

/**
 * 定位诊断目标工程根目录（支持包 ID / 磁盘路径 / 当前目录向上查找），
 * 并按白名单预校验；结果写入 ctx.projectRoot，供后续工程级检查消费。
 * 遇到冲突转换为结构化诊断错误，在受限白名单模式下避免未授权冲突中断或泄漏。
 */
export const locateProject: DoctorCheck = {
  id: "project.locate",
  run: (ctx) => {
    let projectRoot: string | null = null;
    const hasAllowlist = Boolean(
      ctx.packageAllowlist &&
      Array.isArray(ctx.packageAllowlist) &&
      ctx.packageAllowlist.length > 0
    );

    try {
      const candidates = hasAllowlist
        ? getEffectiveLinkedPackages(loadRegistry(ctx.customHome), { allowlist: ctx.packageAllowlist })
        : listLinkedPackages(ctx.customHome);

      projectRoot =
        resolvePackageRootWithCandidates(ctx.packageIdOrPath, ctx.cwd, candidates) ||
        (ctx.packageIdOrPath ? findProjectRoot(ctx.packageIdOrPath) : null);
    } catch (err: any) {
      if (err?.code === PACKAGE_ID_CONFLICT) {
        ctx.checks.push({
          id: "project.locate",
          category: "project",
          name: "Project Locate",
          status: "error",
          message: err.message,
          fix: err.hint,
        });
        ctx.projectRoot = null;
        return;
      }
      ctx.checks.push({
        id: "project.locate",
        category: "project",
        name: "Project Locate",
        status: "error",
        message: `Failed to locate project: ${err?.message || String(err)}`,
        fix: err?.hint,
      });
      ctx.projectRoot = null;
      return;
    }

    if (projectRoot) {
      try {
        const config = loadProjectConfig(projectRoot);
        if (
          hasAllowlist &&
          !ctx.packageAllowlist!.includes(config.id)
        ) {
          projectRoot = null;
        }
      } catch (err: any) {
        // 预校验失败不改变根目录定位，交由后续详细诊断呈现具体错误；但绝不无声吞没，输出告警
        console.warn(
          `[Doctor] Failed to pre-validate project config at '${projectRoot}': ${err?.message || String(err)}`
        );
      }
    }

    ctx.projectRoot = projectRoot;
  },
};
