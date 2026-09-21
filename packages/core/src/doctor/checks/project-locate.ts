import { findProjectRoot, loadProjectConfig } from "../../project/loader";
import { resolvePackageRoot } from "../../registry/registry";
import type { DoctorCheck } from "../context";

/**
 * 定位诊断目标工程根目录（支持包 ID / 磁盘路径 / 当前目录向上查找），
 * 并按白名单预校验；结果写入 ctx.projectRoot，供后续工程级检查消费。
 */
export const locateProject: DoctorCheck = {
  id: "project.locate",
  run: (ctx) => {
    let projectRoot: string | null = null;
    if (ctx.packageIdOrPath) {
      projectRoot =
        resolvePackageRoot(ctx.packageIdOrPath, ctx.cwd, ctx.customHome) ||
        findProjectRoot(ctx.packageIdOrPath);
    } else {
      projectRoot = findProjectRoot(ctx.cwd);
    }

    if (projectRoot) {
      try {
        const config = loadProjectConfig(projectRoot);
        if (
          ctx.packageAllowlist &&
          Array.isArray(ctx.packageAllowlist) &&
          ctx.packageAllowlist.length > 0 &&
          !ctx.packageAllowlist.includes(config.id)
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
