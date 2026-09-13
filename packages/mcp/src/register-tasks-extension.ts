import type { ActionDockTarget } from "@actiondock/core";
import type { RunRecord } from "@actiondock/sdk";
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { toMcpTaskPayload, toMcpTaskStatus } from "./types";

/**
 * MCP Tasks 规范扩展注册隔离点。
 *
 * 版本锁定说明（@modelcontextprotocol/server 2.0.0）：
 * - 2025-11-25 引入的 tasks/get、tasks/list、tasks/cancel 在该版本 SDK 中被标记为
 *   「wire vocabulary with no SDK runtime」，高层 McpServer 门面未提供对应注册入口；
 * - 低层 Server 实例（McpServer.server）公开暴露 registerCapabilities 与
 *   setRequestHandler（均为公开 API 签名），tasks 方法不在 RequestMethod 类型内，
 *   因此必须走「自定义方法 + 显式 schema」的三参数重载形式完成注册；
 * - 本模块是全仓唯一触达 server.server 内层实例的位置，其余代码严禁直接操作内层。
 *
 * 升级 SDK 迁移指引：
 * - 若后续版本将 tasks 方法纳入 RequestMethod（高层门面开放 registerTasks 类入口），
 *   应改用官方门面 API 并删除本模块中的显式 schema 声明；
 * - 注册后若官方为 tasks 结果提供运行时校验，可移除本模块对出参的手动约束。
 */

/** tasks/get 与 tasks/cancel 共享的请求参数结构。 */
interface TaskIdParams {
  taskId: string;
  reason?: string;
}

/** tasks/list 请求参数结构。 */
interface TaskListParams {
  limit?: number;
  actionId?: string;
}

/** JSON-RPC 保留码段：协议保留区为 -32000 至 -32099，服务端自定义错误码必须落在该区段内。 */
const TASK_NOT_FOUND_CODE = -32001;

/** 无效的 limit 参数错误码，同样落在服务端自定义码段。 */
const INVALID_LIMIT_CODE = -32002;

/** tasks/list 允许的最大单页数量上限。 */
const MAX_TASK_LIST_LIMIT = 500;

/**
 * 构造携带 JSON-RPC 语义码的任务不存在异常。
 *
 * MCP SDK 对处理器抛出的异常会读取数字型 code 字段并原样透传到错误响应，
 * 裸 Error 缺少 code 会被映射为内部错误（-32603），丢失调用方可分辨的语义。
 *
 * @param taskId 未找到的任务标识
 */
function taskNotFoundError(taskId: string): Error & { code: number } {
  return Object.assign(new Error(`Task '${taskId}' not found`), { code: TASK_NOT_FOUND_CODE });
}

/**
 * 构造携带 JSON-RPC 语义码的非法 limit 参数异常。
 *
 * @param limit 非法的 limit 入参
 */
function invalidLimitError(limit: unknown): Error & { code: number } {
  return Object.assign(
    new Error(
      `Invalid tasks/list limit: expected an integer between 1 and ${MAX_TASK_LIST_LIMIT}, got ${JSON.stringify(limit)}`
    ),
    { code: INVALID_LIMIT_CODE }
  );
}

const TASK_ID_PARAMS = fromJsonSchema<TaskIdParams>({
  type: "object",
  properties: {
    taskId: { type: "string" },
    reason: { type: "string" },
  },
  required: ["taskId"],
});

const TASK_LIST_PARAMS = fromJsonSchema<TaskListParams>({
  type: "object",
  properties: {
    limit: { type: "number" },
    actionId: { type: "string" },
  },
});

/**
 * 将内部 RunRecord 的 ISO 时间字符串转为毫秒时间戳，用于任务排序比较。
 *
 * @param value 待解析的时间字符串
 */
function toTimeMillis(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * 在低层 Server 实例上注册 tasks 能力声明与三个请求处理器。
 *
 * @param server MCP 高层服务实例
 * @param target ActionDockTarget 公共契约门面
 */
export function registerTasksExtension(server: McpServer, target: ActionDockTarget): void {
  server.server.registerCapabilities({
    tasks: {
      list: {},
      cancel: {},
    },
  });

  server.server.setRequestHandler("tasks/get", { params: TASK_ID_PARAMS }, async (params) => {
    const run = await target.getRun(params.taskId);
    if (!run) {
      // 携带语义码透传，避免被 SDK 映射为内部错误
      throw taskNotFoundError(params.taskId);
    }
    return { task: toMcpTaskPayload(run) };
  });

  server.server.setRequestHandler("tasks/cancel", { params: TASK_ID_PARAMS }, async (params) => {
    const reason = params.reason || "Cancelled via MCP tasks/cancel";
    const cancelRes = await target.cancelRun(params.taskId, reason);
    if (cancelRes.outcome === "requested") {
      return { taskId: params.taskId, status: "cancelled" };
    }
    if (cancelRes.outcome === "already_terminal") {
      return { taskId: params.taskId, status: toMcpTaskStatus(cancelRes.status) };
    }
    const run = await target.getRun(params.taskId);
    if (!run) {
      // 携带语义码透传，避免被 SDK 映射为内部错误
      throw taskNotFoundError(params.taskId);
    }
    return { taskId: params.taskId, status: toMcpTaskStatus(run.status) };
  });

  server.server.setRequestHandler("tasks/list", { params: TASK_LIST_PARAMS }, async (params) => {
    // 边界防御：limit 必须为整数，缺省取 50；超限钳制到 [1, 500]，非法值抛带语义码的参数错误
    let limit = 50;
    if (params.limit !== undefined) {
      if (typeof params.limit !== "number" || !Number.isInteger(params.limit)) {
        throw invalidLimitError(params.limit);
      }
      limit = Math.min(Math.max(params.limit, 1), MAX_TASK_LIST_LIMIT);
    }
    const actionId = params.actionId;

    const runs = await target.listRuns({ limit, actionId });
    const ordered = [...runs].sort(
      (a: RunRecord, b: RunRecord) => toTimeMillis(b.startedAt) - toTimeMillis(a.startedAt)
    );
    return { tasks: ordered.slice(0, limit).map(toMcpTaskPayload) };
  });
}
