/**
 * 监督进程向宿主子进程发送的跨进程取消通知。
 * id 与对应 IpcCallMessage 的调用 id 一致，宿主侧据此中止同调用的 AbortController。
 */
export interface IpcAbortMessage {
  id: string;
  type: "abort";
  reason?: string;
}

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
  | IpcAbortMessage
  | IpcEventMessage
  | IpcReadyMessage;

/**
 * 监督进程 IPC 服务初始化选项。
 */
export interface IpcServiceOptions {
  type?: "ipc";
  /** 已启动的子进程实例（需具备 IPC 通道） */
  childProcess?: any;
  /** 待启动的脚本物理路径 */
  scriptPath?: string;
  /** 启动参数 */
  scriptArgs?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: NodeJS.ProcessEnv;
  /** 诊断流最大缓冲字节数 */
  maxDiagnosticBytes?: number;
  /** 诊断流每秒最大字节速率 */
  maxDiagnosticRate?: number;
  /** 诊断流目标输出 */
  diagnosticTarget?: any;
  /** 是否启用管理端口（默认 true） */
  enableManagement?: boolean;
}

