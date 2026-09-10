import type { ActionDockManifest, ProjectConfig } from "@actiondock/core";

/**
 * Action 依赖描述。
 */
export interface ActionDependency {
  /** Action 唯一标识符 */
  id: string;
  /** Action 入口文件相对路径 */
  entry: string;
  /** Action 源码文件绝对路径 */
  resolvedPath: string;
  /** 静态依赖的下游 Action ID 列表 */
  uses: string[];
  /** Action 功能描述 */
  description?: string;
  /** 入参校验模式 */
  inputSchema?: Record<string, unknown> | boolean;
  /** 出参校验模式 */
  outputSchema?: Record<string, unknown> | boolean;
  /** 标签列表 */
  tags?: string[];
  /** 扩展注解 */
  annotations?: Record<string, unknown>;
}

/**
 * 资产或模块依赖描述。
 */
export interface AssetDependency {
  /** 资产相对路径 */
  path: string;
  /** 资产绝对物理路径 */
  resolvedPath: string;
  /** 资产类型：静态资产、规程文档、配置文件或代码文件模块 */
  type: "asset" | "playbook" | "config" | "module" | "file";
}

/**
 * 外部依赖描述。
 */
export interface ExternalDependency {
  /** 外部依赖包名 */
  name: string;
  /** 版本约束范围 */
  versionRange?: string;
  /** 是否为开发期依赖 */
  isDev?: boolean;
}

/**
 * 锁文件元数据描述。
 */
export interface LockfileInfo {
  /** 锁文件名（如 package-lock.json） */
  name: string;
  /** 锁文件物理绝对路径 */
  path: string;
  /** 锁文件内容的 SHA-256 校验摘要 */
  sha256: string;
}

/**
 * 构建规划中的依赖集合分类。
 */
export interface BuildPlanDependencies {
  /** Action 依赖闭包 */
  actions: ActionDependency[];
  /** 模块与资产依赖 */
  modulesAndAssets: AssetDependency[];
  /** 外部 npm 依赖 */
  external: ExternalDependency[];
}

/**
 * Playbook 规划项。
 */
export interface PlaybookPlanEntry {
  id: string;
  filePath: string;
  actions?: string[];
  description?: string;
}

/**
 * 构建规划产物结构。
 */
export interface BuildPlan {
  /** 所属 Package ID */
  packageId: string;
  /** 项目展示名称 */
  packageName: string;
  /** 版本号 */
  version: string;
  /** 描述信息 */
  description?: string;
  /** 项目根目录绝对路径 */
  projectRoot: string;
  /** actions 目录相对路径 */
  actionsDir?: string;
  /** playbooks 目录相对路径 */
  playbooksDir?: string;
  /** 参与构建的 Action 列表 */
  actions: ActionDependency[];
  /** 参与构建的 Playbook 列表 */
  playbooks: PlaybookPlanEntry[];
  /** 分类依赖明细 */
  dependencies: BuildPlanDependencies;
  /** 资产路径列表 */
  assets: string[];
  /** 显式声明的代码文件列表 */
  files?: string[];
  /** 声明的配置定义字典 */
  configDefs?: Record<string, unknown>;
  /** 检测到的锁文件信息 */
  lockfile?: LockfileInfo;
  /** 规划元数据 */
  metadata: {
    plannedAt: string;
    schemaVersion: number;
    actionCount: number;
    playbookCount: number;
    lockfileDigest?: string;
  };
}

/**
 * 声明式选择规划产物类型别名。
 */
export type SelectionPlan = BuildPlan;

/**
 * 构建规划器配置选项。
 */
export interface BuildPlannerOptions {
  /** 项目根目录绝对路径 */
  projectRoot: string;
  /** 显式传入的项目配置（若未提供则从 actiondock.json 读取） */
  config?: ProjectConfig & { files?: string[]; assets?: string[]; uses?: string[]; actions?: Record<string, unknown> };
  /** 显式传入的声明式清单（若未提供则从 actiondock.json 读取） */
  manifest?: ActionDockManifest & { files?: string[] };
  /** 挑选的 Action ID 列表（用于依赖闭包裁剪） */
  actions?: string[];
  /** 挑选的 Playbook ID 列表（用于 Playbook 驱动的依赖闭包裁剪） */
  playbooks?: string[];
  /** 显式声明包含的代码文件或目录列表 */
  files?: string[];
  /** 显式声明包含的资产文件或目录列表 */
  assets?: string[];
  /** 指定的锁文件路径（可选） */
  lockfile?: string;
  /** 期望的锁文件 SHA-256 摘要（若指定且不一致将报错拒绝） */
  expectedLockfileDigest?: string;
}

/**
 * 声明式选择规划器配置选项别名。
 */
export type SelectionPlannerOptions = BuildPlannerOptions;

/**
 * 归档压缩格式。
 */
export type ArchiveFormat = "zip" | "tar.gz";

/**
 * 基于 Node.js 的目录型交付产物生成选项。
 */
export interface BuildOptions {
  /** 目标项目根目录绝对路径 */
  projectRoot: string;
  /** 产物输出目录路径（默认输出至 dist 目录） */
  outDir?: string;
  /** 输出路径别名 */
  outfile?: string;
  /** 挑选参与构建的 Action ID 清单 */
  actions?: string[];
  /** 挑选参与构建的 Playbook ID 清单 */
  playbooks?: string[];
  /** 是否生成标准 zip 压缩归档交付产物 */
  archive?: boolean;
  /** 是否在干净暂存目录中物化锁定的生产依赖 */
  vendorDeps?: boolean;
  /** 是否允许执行依赖安装生命周期脚本（默认 false） */
  allowInstallScripts?: boolean;
  /** 是否强制要求构建可复现（默认 false） */
  requireReproducible?: boolean;
  /** 显式传入的项目配置（可选） */
  config?: ProjectConfig;
  /** 显式传入的声明式清单（可选） */
  manifest?: ActionDockManifest;

  /**
   * 已移除的单文件二进制输出目标平台参数。
   * 若传入将抛出 UNSUPPORTED_BUILD_MODE 错误。
   */
  target?: string;

  /**
   * 已移除的字节码预编译参数。
   * 若传入将抛出 UNSUPPORTED_BUILD_MODE 错误。
   */
  bytecode?: boolean;

  /**
   * 代码混淆选项。
   */
  minify?: boolean;
}

/**
 * 目录型构建产物结果描述。
 */
export interface BuildResult {
  /** 所属 Package ID */
  packageId: string;
  /** 打包的项目版本号 */
  version: string;
  /** 构建产物输出目录路径 */
  outputDir: string;
  /** 生成的 zip 压缩归档文件路径（若指定 archive 选项） */
  archivePath?: string;
  /** 生成的 Node.js 启动入口绝对路径 */
  entrypointPath: string;
  /** 启动入口可执行文件绝对路径（entrypointPath 的等价别名） */
  executablePath: string;
  /** 生成的元数据文件路径 */
  metadataPath: string;
  /** 打包内置的 Action ID 列表 */
  actions: string[];
  /** 打包内置的 Playbook ID 列表 */
  playbooks: string[];
  /** 是否物化了依赖 */
  vendorDeps: boolean;
  /** 是否具备可复现性 */
  reproducible: boolean;
  /** 产物 SHA-256 校验摘要 */
  sha256: string;
}

/**
 * npm Action 包打包选项。
 */
export interface PackOptions {
  /** 目标项目根目录绝对路径 */
  projectRoot: string;
  /** 输出目录路径（默认当前工作目录或 dist 目录） */
  outDir?: string;
  /** 是否仅做预检与清单生成，不生成最终 tgz 压缩包 */
  dryRun?: boolean;
  /** 显式传入的清单（可选） */
  manifest?: ActionDockManifest;
  /** 显式传入的项目配置（可选） */
  config?: ProjectConfig;
}

/**
 * npm Action 包打包结果。
 */
export interface PackResult {
  /** 所属 Package ID */
  packageId: string;
  /** 项目展示名称 */
  packageName: string;
  /** 版本号 */
  version: string;
  /** 生成的 tgz 压缩包文件路径（dryRun 时未生成则为空） */
  tarballPath?: string;
  /** 生成的 tgz 压缩包文件名 */
  tarballName: string;
  /** 压缩包字节大小 */
  sizeBytes: number;
  /** 压缩包内容的 SHA-256 校验摘要 */
  sha256: string;
  /** 打包包含的文件相对路径清单 */
  files: string[];
  /** 清单摘要信息 */
  manifestSummary: {
    actionsCount: number;
    actions: string[];
    assetsCount: number;
    filesCount: number;
  };
}

/**
 * Skill 导出选项。
 */
export interface SkillExporterOptions {
  /** 源码项目根目录绝对路径 */
  projectRoot: string;
  /** 导出模式：source 源码型 Skill 或 node 目录型 Skill（默认 source） */
  mode?: "source" | "node";
  /** 导出产物目标目录（默认输出至 dist 目录） */
  outDir?: string;
  /** 是否执行归档压缩，亦可直接指定归档格式 */
  archive?: boolean | ArchiveFormat;
  /** 归档压缩格式（zip 或 tar.gz） */
  archiveFormat?: ArchiveFormat;
  /** 挑选的 Playbook 列表 */
  playbooks?: string[];
  /** 挑选的 Action 列表 */
  actions?: string[];
  /** 预置的项目配置（可选） */
  config?: ProjectConfig;
  /** 预置的声明式清单（可选） */
  manifest?: ActionDockManifest;
  /** 是否跳过生成 SKILL.md */
  skipSkillMd?: boolean;
  /** 显式指定的已有 SKILL.md 文件路径 */
  skillMdPath?: string;
  /** 是否物化锁定依赖（供 node 模式或 source 模式使用） */
  vendorDeps?: boolean;
  /** 是否允许生命周期脚本 */
  allowInstallScripts?: boolean;
  /** 是否要求可复现 */
  requireReproducible?: boolean;

  /**
   * 已废弃的独立单文件编译选项。
   * 若传入将抛出替代方案提示或错误。
   */
  standalone?: boolean;
  target?: string;
  bytecode?: boolean;
  minify?: boolean;
}

/**
 * Skill 导出完成结果。
 */
export interface SkillExportResult {
  /** 所属 Package ID */
  packageId: string;
  /** 项目版本号 */
  version: string;
  /** 导出模式：source 源码型或 node 目录型 */
  mode: "source" | "node";
  /** 生成的 Skill 目录绝对路径 */
  skillDir: string;
  /** 生成的归档文件绝对路径（若开启压缩） */
  archivePath?: string;
  /** 导出的 Action 数量 */
  actionsCount: number;
  /** 导出的 Playbook 数量 */
  playbooksCount: number;
  /** 导出的 Action ID 列表 */
  actions: string[];
  /** 导出的 Playbook ID 列表 */
  playbooks: string[];
  /** 导出的文件相对路径清单 */
  files: string[];
  /** 若复用了已有的 SKILL.md 文件，返回该文件的绝对路径 */
  usedExistingSkillMd?: string;
}

/**
 * 批量 Skill 导出选项。
 */
export interface BatchSkillExportOptions extends Omit<SkillExporterOptions, "projectRoot"> {
  /** 待导出的项目根目录绝对路径列表 */
  projectRoots: string[];
}

/**
 * 批量 Skill 导出结果。
 */
export interface BatchSkillExportResult {
  /** 各包独立导出结果列表 */
  results: SkillExportResult[];
  /** 批量导出根目录 */
  outDir: string;
  /** 导出的总 Action 数量 */
  totalActions: number;
  /** 导出的总 Playbook 数量 */
  totalPlaybooks: number;
}

/**
 * 复合 Skill 套件导出选项。
 */
export interface CompositeSkillExportOptions {
  /** 复合技能套件名称 */
  bundleName: string;
  /** 参与聚合的项目根目录绝对路径列表 */
  projectRoots: string[];
  /** 复合套件输出目标目录（默认输出至 dist 目录） */
  outDir?: string;
  /** 复合技能描述信息 */
  description?: string;
  /** 是否执行归档压缩，亦可直接指定归档格式 */
  archive?: boolean | ArchiveFormat;
  /** 归档压缩格式（zip 或 tar.gz） */
  archiveFormat?: ArchiveFormat;
  /** 工作区根目录 */
  workspaceRoot?: string;
  /** 显式指定的已有 SKILL.md 文件路径 */
  skillMdPath?: string;
  /** 显式指定的自定义说明书（SKILL.custom.md）路径；缺省时自动发现工作区/当前目录下的同名文件 */
  customMdPath?: string;
  /** 仅生成复合 SKILL.md（始终重新生成，忽略已有 SKILL.md，不拷贝子包产物） */
  skillMdOnly?: boolean;
}

/**
 * 复合 Skill 套件导出结果。
 */
export interface CompositeSkillExportResult {
  /** 复合技能套件名称 */
  bundleName: string;
  /** 生成的复合 Skill 目录绝对路径 */
  skillDir: string;
  /** 生成的归档文件绝对路径（若开启压缩） */
  archivePath?: string;
  /** 包含的 Package 数量 */
  packagesCount: number;
  /** 包含的总 Action 数量 */
  actionsCount: number;
  /** 包含的总 Playbook 数量 */
  playbooksCount: number;
  /** 各包的摘要明细 */
  packages: Array<{ packageId: string; actions: string[]; playbooks: string[] }>;
  /** 生成的文件清单 */
  files: string[];
  /** 若复用了已有的 SKILL.md 文件，返回该文件的绝对路径 */
  usedExistingSkillMd?: string;
  /** skillMdOnly 模式下实际写出的 SKILL.md 文件绝对路径 */
  skillMdFile?: string;
}
