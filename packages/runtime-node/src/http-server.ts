import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Web 标准 Request 处理函数。
 */
export type WebRequestHandler = (request: Request) => Promise<Response> | Response;

/**
 * Node HTTP 服务端配置选项。
 */
export interface NodeHttpServerOptions {
  port?: number;
  host?: string;
  fetch: WebRequestHandler;
  baseOrigin?: string;
}

/**
 * 将 Node.js IncomingMessage 请求转化为标准的 Web Request 对象。
 */
export function createWebRequest(
  req: IncomingMessage,
  options?: { baseOrigin?: string }
): Request {
  const protocol = (req.socket as any)?.encrypted ? "https" : "http";
  const host = req.headers.host || "127.0.0.1";
  const baseOrigin = options?.baseOrigin || `${protocol}://${host}`;
  const url = new URL(req.url || "/", baseOrigin).href;

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      for (const item of val) {
        headers.append(key, item);
      }
    } else {
      headers.set(key, val);
    }
  }

  const method = (req.method || "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const ac = new AbortController();
  req.on("close", () => {
    if (!req.complete) {
      ac.abort(new Error("Request aborted by client"));
    }
  });

  const init: RequestInit = {
    method,
    headers,
    signal: ac.signal,
  };

  if (hasBody) {
    const webStream = Readable.toWeb(req);
    (init as any).body = webStream;
    (init as any).duplex = "half";
  }

  return new Request(url, init);
}

/**
 * 将标准的 Web Response 响应流式写回 Node.js ServerResponse 客户端输出。
 */
export async function sendWebResponse(
  webResponse: Response,
  res: ServerResponse
): Promise<void> {
  res.statusCode = webResponse.status;
  if (webResponse.statusText) {
    res.statusMessage = webResponse.statusText;
  }

  webResponse.headers.forEach((val, key) => {
    if (key.toLowerCase() === "set-cookie") {
      if (typeof (webResponse.headers as any).getSetCookie === "function") {
        res.setHeader("set-cookie", (webResponse.headers as any).getSetCookie());
      } else {
        res.appendHeader("set-cookie", val);
      }
    } else {
      res.setHeader(key, val);
    }
  });

  if (!webResponse.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(webResponse.body as any);
  try {
    await pipeline(nodeStream, res);
  } catch (err: any) {
    if (err?.code !== "ERR_STREAM_PREMATURE_CLOSE") {
      throw err;
    }
  }
}

/**
 * 创建适用于 Node.js 原生 http.createServer 的请求监听函数。
 */
export function createRequestListener(
  handler: WebRequestHandler,
  options?: { baseOrigin?: string }
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const webReq = createWebRequest(req, options);
    Promise.resolve()
      .then(() => handler(webReq))
      .then((webRes) => sendWebResponse(webRes, res))
      .catch((err) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: {
                code: "SERVER_ERROR",
                message: err?.message || String(err),
              },
            })
          );
        } else {
          res.destroy(err);
        }
      });
  };
}

/**
 * 基于 Node.js node:http 的轻量级 HTTP 服务端封装。
 * 接收 Node HTTP 请求并转化为标准 Web Request，支持 Web Response 流式输出。
 */
export class NodeHttpServer {
  private server: Server;
  private listening = false;
  private portNumber = 0;
  private hostAddress = "127.0.0.1";

  constructor(optionsOrHandler: WebRequestHandler | NodeHttpServerOptions) {
    const handler =
      typeof optionsOrHandler === "function"
        ? optionsOrHandler
        : optionsOrHandler.fetch;
    const baseOrigin =
      typeof optionsOrHandler === "object"
        ? optionsOrHandler.baseOrigin
        : undefined;

    const requestListener = createRequestListener(handler, { baseOrigin });
    this.server = createServer(requestListener);

    if (typeof optionsOrHandler === "object") {
      if (optionsOrHandler.port !== undefined) {
        this.portNumber = optionsOrHandler.port;
      }
      if (optionsOrHandler.host !== undefined) {
        this.hostAddress = optionsOrHandler.host;
      }
    }
  }

  /**
   * 底层原生 Node.js http.Server 实例。
   */
  get rawServer(): Server {
    return this.server;
  }

  /**
   * 绑定的监听端口号。
   */
  get port(): number {
    return this.portNumber;
  }

  /**
   * 绑定的主机地址。
   */
  get host(): string {
    return this.hostAddress;
  }

  /**
   * 完整的 HTTP 访问基础路径。
   */
  get url(): string {
    return `http://${this.hostAddress}:${this.portNumber}`;
  }

  /**
   * 服务端当前是否正在监听连接。
   */
  get isListening(): boolean {
    return this.listening;
  }

  /**
   * 启动监听。若未显式传入端口，则默认使用实例配置或随机可用端口（0）。
   */
  async listen(
    port?: number,
    host?: string
  ): Promise<{ port: number; host: string; url: string }> {
    const targetPort = port ?? this.portNumber ?? 0;
    const targetHost = host ?? this.hostAddress ?? "127.0.0.1";

    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(targetPort, targetHost, () => {
        this.server.removeListener("error", reject);
        const addr = this.server.address();
        if (addr && typeof addr === "object") {
          this.portNumber = addr.port;
          this.hostAddress = addr.address === "::" ? "127.0.0.1" : addr.address;
        }
        this.listening = true;
        resolve({
          port: this.portNumber,
          host: this.hostAddress,
          url: this.url,
        });
      });
    });
  }

  /**
   * 优雅关闭服务端并释放端口与活动连接。
   */
  async close(): Promise<void> {
    if (!this.listening) {
      return;
    }
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        this.listening = false;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 停止服务端监听（兼容 stop 契约）。
   */
  async stop(): Promise<void> {
    return this.close();
  }

  /**
   * 便捷工厂方法：创建并启动监听。
   */
  static async start(
    optionsOrHandler: WebRequestHandler | NodeHttpServerOptions,
    port?: number,
    host?: string
  ): Promise<NodeHttpServer> {
    const server = new NodeHttpServer(optionsOrHandler);
    await server.listen(port, host);
    return server;
  }
}
