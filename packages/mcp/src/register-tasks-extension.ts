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
      throw new Error(`Task '${params.taskId}' not found`);
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
      throw new Error(`Task '${params.taskId}' not found`);
    }
    return { taskId: params.taskId, status: toMcpTaskStatus(run.status) };
  });

  server.server.setRequestHandler("tasks/list", { params: TASK_LIST_PARAMS }, async (params) => {
    const limit = typeof params.limit === "number" ? params.limit : 50;
    const actionId = params.actionId;

    const runs = await target.listRuns({ limit, actionId });
    const ordered = [...runs].sort(
      (a: RunRecord, b: RunRecord) => toTimeMillis(b.startedAt) - toTimeMillis(a.startedAt)
    );
    return { tasks: ordered.slice(0, limit).map(toMcpTaskPayload) };
  });
}
