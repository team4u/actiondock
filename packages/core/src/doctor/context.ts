import type { DoctorCheckItem } from "./types";

/**
 * 体检诊断共享上下文：承载诊断输入选项、工程定位结果与累积检查项。
 * 各检查函数按注册表顺序执行，并将检查项追加到 checks 列表。
 */
export interface DoctorCheckContext {
  /** 工作目录（默认 process.cwd()） */
  cwd: string;
  /** 目标包 ID 或磁盘路径（可选） */
  packageIdOrPath?: string;
  /** 自定义 ActionDock Home 目录（用于测试隔离） */
  customHome?: string;
  /** 允许纳入诊断的包 ID 白名单（可选） */
  packageAllowlist?: string[];
  /** 累积的检查项列表（保持注册顺序，直接决定报告展示顺序） */
  checks: DoctorCheckItem[];
  /** 诊断目标工程根目录（工程定位阶段写入；null 表示无工程上下文或被白名单排除） */
  projectRoot: string | null;
  /** 诊断目标工程的包 ID（工程配置加载成功后写入） */
  packageId?: string;
}

/** 单项体检检查：从共享上下文读取输入，并将检查项追加到 ctx.checks。 */
export interface DoctorCheck {
  /** 检查阶段唯一标识（用于注册表定位与排查） */
  id: string;
  /** 执行检查逻辑（可同步或异步） */
  run: (ctx: DoctorCheckContext) => void | Promise<void>;
}

/** 基于诊断选项构建共享上下文（checks 从空列表开始累积）。 */
export function createDoctorCheckContext(options?: {
  cwd?: string;
  packageIdOrPath?: string;
  customHome?: string;
  packageAllowlist?: string[];
}): DoctorCheckContext {
  return {
    cwd: options?.cwd || process.cwd(),
    packageIdOrPath: options?.packageIdOrPath,
    customHome: options?.customHome,
    packageAllowlist: options?.packageAllowlist,
    checks: [],
    projectRoot: null,
  };
}
