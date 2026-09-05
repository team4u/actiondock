import type { ActionDefinition } from "@actiondock/sdk";
import type { ConfigItemDefinition } from "@actiondock/core";

/**
 * 统一退出码定义。
 * - SUCCESS: 执行成功（0）
 * - FAILURE: 业务或框架执行失败（1）
 * - INVALID_ARGUMENT: 命令行参数或选项错误（2）
 * - SIGINT: 进程接收中断信号退出（130）
 */
export const ExitCode = {
  SUCCESS: 0,
  FAILURE: 1,
  INVALID_ARGUMENT: 2,
  SIGINT: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * 标准执行与数据信封接口。
 */
export interface Envelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: Record<string, unknown>;
}

/**
 * 独立二进制运行模式声明。
 */
export interface StandaloneOptions {
  /** 所属 Package ID */
  packageId: string;
  /** 版本号 */
  version: string;
  /** 描述信息 */
  description?: string;
  /** 声明的配置依赖字典 */
  configDefs?: Record<string, ConfigItemDefinition>;
  /** 内置动作定义映射或数组 */
  actions: Map<string, ActionDefinition> | ActionDefinition[];
}

/**
 * 运行时 CLI 上下文环境。
 */
export interface RuntimeCliContext {
  /** 独立运行模式配置 */
  standalone?: StandaloneOptions;
  /** 自定义数据目录 */
  dataDir?: string;
  /** 默认信封包装输出模式 */
  defaultEnvelope?: boolean;
  /** 自定义标准输出写入函数 */
  stdout?: (msg: string) => void;
  /** 自定义标准错误写入函数 */
  stderr?: (msg: string) => void;
}

/**
 * CLI 程序创建选项。
 */
export interface RuntimeProgramOptions extends RuntimeCliContext {
  /** CLI 工具名称（如 ad 或独立程序名称） */
  name?: string;
  /** CLI 工具描述信息 */
  description?: string;
  /** CLI 工具版本号 */
  version?: string;
  /** 是否同步设置 process.exitCode */
  setExitCode?: boolean;
}

/**
 * 项目详情元数据结构。
 */
export interface ProjectDetailInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  projectRoot: string;
  actionsDir: string;
  playbooksDir: string;
  actionsCount: number;
  playbooksCount: number;
  actions: string[];
  playbooks: string[];
  configDeclared: string[];
  configDef?: Record<string, ConfigItemDefinition>;
  actionsMap?: Map<string, ActionDefinition>;
  playbooksMap?: Map<string, any>;
}

/**
 * 聚合 Package 信息结构。
 */
export interface AggregatedPackage {
  id: string;
  name: string;
  version: string;
  description?: string;
  path: string;
  actionsCount: number;
  playbooksCount: number;
  actions: string[];
  playbooks: string[];
  configDeclared: string[];
}

/**
 * 环境变量满足率检测项。
 */
export interface EnvCheckItem {
  key: string;
  required: boolean;
  satisfied: boolean;
  matchedEnv: string | null;
  hasDefault: boolean;
  secret: boolean;
}
