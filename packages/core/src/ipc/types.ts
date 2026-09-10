/**
 * 监督进程与宿主子进程间调用的 IPC 请求消息。
 */
export interface IpcCallMessage {
  id: string;
  type: "call";
  method: string;
  args: unknown[];
}

/**
 * 宿主子进程回复给监督进程的 IPC 响应消息。
 */
export interface IpcResponseMessage {
  id: string;
  type: "response";
  ok: boolean;
  data?: unknown;
  error?: {
    code?: string;
    message: string;
    stack?: string;
    details?: unknown;
  };
}

/**
 * 宿主子进程向监督进程流式推送的执行事件。
 */
export interface IpcEventMessage {
  type: "event";
  runId: string;
  event: unknown;
}

/**
 * 宿主子进程初始化就绪通知。
 */
export interface IpcReadyMessage {
  type: "ready";
}

/**
 * 联合 IPC 消息类型。
 */
export type IpcMessage =
  | IpcCallMessage
  | IpcResponseMessage
  | IpcEventMessage
  | IpcReadyMessage;
