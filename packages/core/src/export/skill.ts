import { resolve } from "node:path";
import { exportSkill as builderExportSkill } from "@actiondock/builder";

/**
 * 导出 Agent Skill 产物时的配置选项。
 */
export interface ExportSkillOptions {
  /** 源码项目根目录 */
  projectRoot: string;
  /** 导出模式：source (源码模式) 或 standalone (独立二进制模式) */
  mode?: "source" | "standalone";
  /** 是否强制独立二进制模式 */
  standalone?: boolean;
  /** 二进制编译目标架构（默认 host） */
  target?: string;
  /** 导出目录路径（默认 dist/skills/） */
  outDir?: string;
  /** 是否自动压缩打包为 .skill.tar.gz 归档包 */
  archive?: boolean;
  /** 按需挑选的 Playbook 列表（触发 Playbook-driven 最小化依赖 Tree-shaking 导出） */
  playbooks?: string[];
  /** 显式挑选导出的 Action ID 清单 */
  actions?: string[];
  /** 独立模式下是否开启代码混淆压缩 */
  minify?: boolean;
  /** 独立模式下是否编译为字节码 */
  bytecode?: boolean;
}

/**
 * Skill 导出完成后的产物描述结果。
 */
export interface ExportSkillResult {
  /** 所属 Package ID */
  packageId: string;
  /** 版本号 */
  version: string;
  /** 导出模式 */
  mode: "source" | "standalone";
  /** 目标架构 */
  target: string;
  /** 生成的 Skill 目录绝对路径 */
  skillDir: string;
  /** 若开启了 archive，生成的 tar.gz 归档文件绝对路径 */
  archivePath?: string;
  /** 导出的 Action 数量 */
  actionsCount: number;
  /** 导出的 Playbook 数量 */
  playbooksCount: number;
}

/**
 * 将 ActionDock 项目导出为兼容各大 AI Agent 平台的通用 Agent Skill 规范包。
 * 
 * 底层复用 @actiondock/builder SkillExporter 现代化统一实现。
 * 
 * @param options 导出配置选项
 * @returns 导出产物详细结果
 */
export async function exportSkill(
  options: ExportSkillOptions
): Promise<ExportSkillResult> {
  const root = resolve(options.projectRoot);
  const res = await builderExportSkill({
    projectRoot: root,
    mode: options.mode,
    standalone: options.standalone,
    target: options.target,
    outDir: options.outDir,
    archive: options.archive,
    playbooks: options.playbooks,
    actions: options.actions,
    minify: options.minify,
    bytecode: options.bytecode,
  });

  return {
    packageId: res.packageId,
    version: res.version,
    mode: res.mode,
    target: res.target,
    skillDir: res.skillDir,
    archivePath: res.archivePath,
    actionsCount: res.actionsCount,
    playbooksCount: res.playbooksCount,
  };
}


