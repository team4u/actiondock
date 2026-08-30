import type { ExecutionManager, RuntimeStorage, ServerRuntimeRegistry } from "@actiondock/core";
import type { ActionDefinition, ExecutionResult, RunRecord, RunStatus } from "@actiondock/sdk";

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
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "working";
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
 */
export interface ActionDockMcpOptions {
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
  /** 预加载的 Action 映射表 */
  actions?: Map<string, ActionDefinition>;
  /** 底层存储实例 */
  storage?: RuntimeStorage;
  /** 服务端运行时注册表 */
  runtimeRegistry?: ServerRuntimeRegistry;
  /** 活跃执行任务管理器 */
  executionManager?: ExecutionManager;
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

export interface ActionDockMcpHttpOptions extends ActionDockMcpOptions, HttpSecurityOptions {}

export interface ActionDockMcpHttpServerInstance {
  port: number;
  host: string;
  url: string;
  stop: () => void;
}

