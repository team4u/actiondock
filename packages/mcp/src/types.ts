import type {
  ActionDockApp,
  ActionDockHost,
  ActionDockTarget,
  RuntimeStorage,
} from "@actiondock/core";
import type { ActionDefinition, RunRecord, RunStatus } from "@actiondock/sdk";

/**
 * MCP 任务状态枚举（兼容 Model Context Protocol Task 规范）。
 */
export type McpTaskStatus = "working" | "completed" | "failed" | "cancelled";

/**
 * MCP 任务状态数据载荷结构体。
 */
export interface McpTaskPayload {
  taskId: string;
  status: McpTaskStatus;
  createdAt: string;
  finishedAt?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
}

/**
 * 将 ActionDock 内部的 RunStatus 转换为 MCP 标准的 TaskStatus。
 */
export function toMcpTaskStatus(status: RunStatus): McpTaskStatus {
  switch (status) {
    case "running":
      return "working";
    case "success":
      return "completed";
    case "failed":
    case "timed_out":
    case "interrupted":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

/**
 * 将内部 RunRecord 实体转换为向 MCP 客户端暴露的 McpTaskPayload。
 */
export function toMcpTaskPayload(run: RunRecord): McpTaskPayload {
  return {
    taskId: run.id,
    status: toMcpTaskStatus(run.status),
    createdAt: run.startedAt,
    finishedAt: run.finishedAt,
    input: run.input,
    output: run.output,
    error: run.error,
  };
}

/**
 * ActionDock MCP 适配层初始化选项。
 * 统一以 target（及可选 host, app）为核心。
 */
export interface ActionDockMcpOptions {
  /** 目标 ActionDockTarget 门面实例（最高优先级） */
  target?: ActionDockTarget;
  /** 目标 ActionDockHost 宿主实例 */
  host?: ActionDockHost;
  /** 目标 ActionDockApp 应用实例 */
  app?: ActionDockApp;
  /** 单个目标项目根目录 */
  projectRoot?: string;
  /** 多个项目根目录（用于多包聚合提供） */
  projectRoots?: string[];
  /** 目标 Package ID */
  packageId?: string;
  /** 多个 Package ID 列表 */
  packageIds?: string[];
  /** 是否聚合暴露全局 Registry 中的所有 Package */
  all?: boolean;
  /** 自定义家目录路径 */
  customHome?: string;
  /** 配置动态覆盖项 */
  configOverrides?: Record<string, unknown>;
  /** 单个 Tool 执行超时时间（毫秒） */
  timeoutMs?: number;
  /** 预加载的 Action 集合（单元测试或内存模式使用） */
  actions?:
    | Map<string, ActionDefinition>
    | Array<{ id: string; action: ActionDefinition } | (ActionDefinition & { id: string })>
    | Record<string, ActionDefinition>;
  /** 底层存储实例（单元测试或特定场景注入） */
  storage?: RuntimeStorage;
}

/**
 * HTTP 传输协议安全配置项。
 */
export interface HttpSecurityOptions {
  host?: string;
  port?: number;
  token?: string;
  allowInsecureNoAuth?: boolean;
  corsOrigins?: string[];
  maxBodyBytes?: number;
}

export interface ActionDockMcpHttpOptions
  extends Omit<ActionDockMcpOptions, "host">,
    Omit<HttpSecurityOptions, "host"> {
  host?: string | ActionDockHost;
}

export interface ActionDockMcpHttpServerInstance {
  port: number;
  host: string;
  url: string;
  target?: ActionDockTarget;
  stop: () => Promise<void>;
}

