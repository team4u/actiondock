/**
 * 配置项的值类型枚举。用于自动类型推断与环境变量自动转换。
 */
export type ConfigValueType = "string" | "number" | "boolean" | "object" | "array";

/**
 * 在 actiondock.json 中声明的单项配置定义。
 */
export interface ConfigItemDefinition {
  /** 配置项的功能描述，展示在 CLI 配置提示与帮助文档中 */
  description?: string;
  /** 默认回退值。若未配置任何自定义值或环境变量，将使用此默认值 */
  default?: unknown;
  /** 是否为敏感信息（如 API Key, Password）。若为 true，在日志与 CLI 输出中默认脱敏 */
  secret?: boolean;
  /** 期望的目标数据类型，从 process.env 读取字符串时将自动尝试强转为此类型 */
  type?: ConfigValueType;
  /** 显式绑定的外部环境变量名（支持单个或优先级数组） */
  env?: string | string[];
}

/**
 * ActionDock 项目根配置文件契约（对应 actiondock.json）。
 */
export interface ProjectConfig {
  /** 项目全局唯一 ID（例如 "team4u.github-tools"） */
  id: string;
  /** 项目展示名称（例如 "GitHub Tools"） */
  name: string;
  /** 项目版本号（遵循语义化版本 Semantic Versioning，如 "1.0.0"） */
  version: string;
  /** 项目描述信息 */
  description?: string;
  /** Action 脚本文件存放目录（相对于项目根目录，默认为 "actions"） */
  actionsDir?: string;
  /** Playbook SOP 文档存放目录（相对于项目根目录，默认为 "playbooks"） */
  playbooksDir?: string;
  /** 声明的项目依赖配置项清单 */
  config?: Record<string, ConfigItemDefinition>;
}

/**
 * Playbook Markdown 文档头部 YAML Frontmatter 元数据。
 */
export interface PlaybookFrontmatter {
  /** Playbook 唯一标识符（例如 "review-pr"） */
  id: string;
  /** Playbook 任务描述 */
  description?: string;
  /** 该 Playbook SOP 所依赖/调用的 Action ID 列表（用于最小化构建与 Tree-shaking 导出） */
  actions?: string[];
}

/**
 * 解析后的完整 Playbook 定义对象。
 */
export interface PlaybookDefinition extends PlaybookFrontmatter {
  /** Markdown 正文内容（去除了头部 YAML Frontmatter 后的 SOP 指南内容） */
  content: string;
  /** Playbook 源文件的绝对物理路径 */
  filePath: string;
}

/**
 * 单个 Action 在清单中的声明项。
 */
export interface ActionManifestEntry {
  /** Action 入口文件相对路径（如 "actions/greet.ts"） */
  entry: string;
  /** Action 功能描述 */
  description?: string;
  /** 输入参数模式规范 */
  inputSchema?: Record<string, unknown> | boolean;
  /** 输出结果模式规范 */
  outputSchema?: Record<string, unknown> | boolean;
  /** 静态依赖的 Action 列表 */
  uses?: string[];
  /** 标签列表 */
  tags?: string[];
  /** 协议注解元数据 */
  annotations?: Record<string, unknown>;
}

/**
 * ActionDock 声明式清单（actiondock.manifest.json）规范。
 * 作为元数据的单一事实源，实现无副作用的模块发现与构建规划。
 */
export interface ActionDockManifest {
  schemaVersion: number;
  actions: Record<string, ActionManifestEntry>;
  assets?: string[];
}
