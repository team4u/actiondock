import type { ActionDockManifest, ActionManifestEntry, PlaybookDefinition, ProjectConfig } from "@actiondock/core";

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
  /** 资产类型：静态资产、规程文档、配置文件或模块源码 */
  type: "asset" | "playbook" | "config" | "module";
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
  /** 参与构建的 Action 列表 */
  actions: ActionDependency[];
  /** 参与构建的 Playbook 列表 */
  playbooks: PlaybookPlanEntry[];
  /** 分类依赖明细 */
  dependencies: BuildPlanDependencies;
  /** 资产路径列表 */
  assets: string[];
  /** 声明的配置定义字典 */
  configDefs?: Record<string, unknown>;
  /** 规划元数据 */
  metadata: {
    plannedAt: string;
    schemaVersion: number;
    actionCount: number;
    playbookCount: number;
  };
}

/**
 * 构建规划器配置选项。
 */
export interface BuildPlannerOptions {
  /** 项目根目录绝对路径 */
  projectRoot: string;
  /** 显式传入的项目配置（若未提供则从 actiondock.json 读取） */
  config?: ProjectConfig;
  /** 显式传入的声明式清单（若未提供则从 actiondock.manifest.json 读取） */
  manifest?: ActionDockManifest;
  /** 挑选的 Action ID 列表（用于依赖闭包裁剪） */
  actions?: string[];
  /** 挑选的 Playbook ID 列表（用于 Playbook 驱动的依赖闭包裁剪） */
  playbooks?: string[];
}

/**
 * 支持的 Bun 独立编译目标平台。
 */
export type CompileTarget =
  | "bun"
  | "host"
  | "bun-linux-x64"
  | "linux-x64"
  | "bun-linux-arm64"
  | "linux-arm64"
  | "bun-darwin-x64"
  | "darwin-x64"
  | "bun-darwin-arm64"
  | "darwin-arm64"
  | "bun-windows-x64"
  | "windows-x64"
  | "bun-linux-x64-baseline"
  | "linux-x64-baseline"
  | "bun-linux-x64-modern"
  | "linux-x64-modern";

/**
 * Bun 独立编译器参数选项。
 */
export interface BunCompilerOptions {
  /** 编译入口文件绝对路径 */
  entrypoint: string;
  /** 目标二进制文件输出路径 */
  outfile: string;
  /** 编译目标平台架构（默认 host） */
  target?: CompileTarget | string;
  /** 是否开启代码压缩混淆（默认 true） */
  minify?: boolean;
  /** 是否启用字节码预编译（默认 true） */
  bytecode?: boolean;
  /** 构建工作目录（默认入口文件所在根目录） */
  cwd?: string;
  /** 自定义环境变量 */
  env?: Record<string, string>;
  /** 所属 Package ID（写入元数据用） */
  packageId?: string;
  /** 所属版本号（写入元数据用） */
  version?: string;
  /** 包含的 Action ID 列表（写入元数据用） */
  actions?: string[];
  /** 是否生成 artifact.json 元数据文件（默认 true） */
  emitMetadata?: boolean;
}

/**
 * Bun 独立编译器输出结果。
 */
export interface BunCompilerResult {
  /** 所属 Package ID */
  packageId?: string;
  /** 版本号 */
  version?: string;
  /** 编译目标架构 */
  target: string;
  /** 独立二进制文件绝对路径 */
  executablePath: string;
  /** 独立二进制文件字节大小 */
  sizeBytes: number;
  /** 独立二进制文件的 SHA-256 校验和 */
  sha256: string;
  /** 生成的元数据文件绝对路径（若生成） */
  metadataPath?: string;
  /** 编译是否开启混淆 */
  minify: boolean;
  /** 编译是否启用字节码 */
  bytecode: boolean;
  /** 编译耗时（毫秒） */
  durationMs: number;
  /** 编译完成时间戳 */
  compiledAt: string;
}

/**
 * 归档压缩格式。
 */
export type ArchiveFormat = "zip" | "tar.gz";

/**
 * Skill 导出选项。
 */
export interface SkillExporterOptions {
  /** 源码项目根目录绝对路径 */
  projectRoot: string;
  /** 导出模式：source 源码模式 或 standalone 独立二进制模式（默认 source） */
  mode?: "source" | "standalone";
  /** 是否开启独立二进制模式（简写选项） */
  standalone?: boolean;
  /** 二进制编译目标架构（仅在独立二进制模式生效，默认 host） */
  target?: CompileTarget | string;
  /** 导出产物目标目录（默认输出至 dist 目录） */
  outDir?: string;
  /** 是否执行归档压缩，亦可直接指定归档格式 */
  archive?: boolean | ArchiveFormat;
  /** 归档压缩格式（zip 或 tar.gz） */
  archiveFormat?: ArchiveFormat;
  /** 挑选的 Playbook 列表（用于 Playbook 驱动的依赖闭包裁剪） */
  playbooks?: string[];
  /** 挑选的 Action 列表（用于 Action 驱动的依赖闭包裁剪） */
  actions?: string[];
  /** 独立二进制模式下是否开启代码混淆（默认 true） */
  minify?: boolean;
  /** 独立二进制模式下是否编译为字节码（默认 true） */
  bytecode?: boolean;
  /** 预置的项目配置（可选） */
  config?: ProjectConfig;
  /** 预置的声明式清单（可选） */
  manifest?: ActionDockManifest;
}

/**
 * Skill 导出完成结果。
 */
export interface SkillExportResult {
  /** 所属 Package ID */
  packageId: string;
  /** 项目版本号 */
  version: string;
  /** 导出模式 */
  mode: "source" | "standalone";
  /** 目标平台架构 */
  target: string;
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
}
