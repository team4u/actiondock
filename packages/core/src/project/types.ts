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
  /** 是否为必填项 */
  required?: boolean;
  /** 是否允许单次调用覆盖 */
  allowInvocationOverride?: boolean;
}

/**
 * 单个 Action 在 actiondock.json 清单中的声明项。
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
 * 单个 Playbook 在 actiondock.json 清单中的声明项。
 */
export interface PlaybookManifestEntry {
  /** Playbook Markdown 入口文件相对路径（如 "playbooks/greet-user.md"） */
  entry: string;
  /** Playbook 任务描述 */
  description?: string;
  /** 该 Playbook 所依赖/调用的 Action ID 列表 */
  actions?: string[];
}

/**
 * ActionDock 声明式元数据清单契约（actiondock.json 为唯一事实源）。
 */
export interface ActionDockManifest {
  /** JSON Schema 声明 URL */
  $schema?: string;
  /** 清单规范版本号（默认 2） */
  schemaVersion?: number;
  /** 项目全局唯一逻辑 ID（例如 "team4u.github-tools"） */
  id: string;
  /** 项目展示名称（例如 "GitHub Tools"） */
  name?: string;
  /** 项目版本号（如 "1.0.0"） */
  version?: string;
  /** 项目描述信息 */
  description?: string;
  /** 声明的项目依赖配置项清单 */
  config?: Record<string, ConfigItemDefinition>;
  /** 声明的 Actions 集合（唯一事实源） */
  actions?: Record<string, ActionManifestEntry>;
  /** 声明的 Playbooks 集合（唯一事实源） */
  playbooks?: Record<string, PlaybookManifestEntry>;
  /** 跨包外部依赖映射（逻辑包 ID 到 npm 包名） */
  dependencies?: Record<string, string>;
  /** 框架导出与分发边界文件列表 */
  files?: string[];
  /** 静态资产列表 */
  assets?: string[];
  /** Action 源码存放目录（向后兼容过渡配置） */
  actionsDir?: string;
  /** Playbook 规程文档存放目录（向后兼容过渡配置） */
  playbooksDir?: string;
}

/**
 * ActionDock 项目根配置文件契约（等同于 ActionDockManifest，actiondock.json 为单一事实源）。
 */
export type ProjectConfig = ActionDockManifest;

/**
 * 解析后的完整 Playbook 定义对象。
 */
export interface PlaybookDefinition {
  /** Playbook 唯一标识符（例如 "review-pr"） */
  id: string;
  /** Playbook 任务描述 */
  description?: string;
  /** 该 Playbook 所依赖/调用的 Action ID 列表 */
  actions: string[];
  /** Markdown 正文内容（纯 Markdown 规程内容） */
  content: string;
  /** Playbook 源文件的绝对物理路径 */
  filePath: string;
}

/**
 * Playbook 声明元数据（向后兼容别名）。
 */
export type PlaybookFrontmatter = PlaybookManifestEntry;


