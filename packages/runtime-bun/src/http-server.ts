import type { Server } from "bun";

export type BunHttpHandler = (
  req: Request,
  server: BunHttpServer
) => Promise<Response> | Response;

export interface BunHttpServerOptions {
  /** 监听端口号（默认 0，由操作系统动态分配可用端口） */
  port?: number;
  /** 绑定监听的主机地址（默认 "127.0.0.1"） */
  host?: string;
  /** 主机地址别名，同 host */
  hostname?: string;
  /** 请求处理函数 */
  fetch?: BunHttpHandler;
  /** 请求处理函数别名 */
  handler?: BunHttpHandler;
  /** 异常处理函数 */
  error?: (err: Error) => Response | Promise<Response> | undefined;
  /** 是否在实例化后立即启动服务 */
  autoStart?: boolean;
  /** 开发模式开关 */
  development?: boolean;
  /** 请求体最大字节限制 */
  maxRequestBodySize?: number;
}

/**
 * 基于 Bun.serve 实现的 Web HTTP 服务端。
 */
export class BunHttpServer {
  private server?: Server<unknown>;
  private options: BunHttpServerOptions;
  private _handler: BunHttpHandler;

  constructor(optionsOrHandler?: BunHttpServerOptions | BunHttpHandler) {
    if (typeof optionsOrHandler === "function") {
      this.options = { fetch: optionsOrHandler };
      this._handler = optionsOrHandler;
    } else {
      this.options = { ...(optionsOrHandler || {}) };
      this._handler =
        this.options.fetch ||
        this.options.handler ||
        ((_req: Request) => new Response("Not Found", { status: 404 }));
    }

    if (this.options.autoStart) {
      this.start();
    }
  }

  /**
   * 启动 HTTP 服务。
   */
  start(): void {
    if (this.server) {
      return;
    }
    const host = this.options.hostname || this.options.host || "127.0.0.1";
    const port = this.options.port ?? 0;

    this.server = Bun.serve({
      port,
      hostname: host,
      development: this.options.development,
      maxRequestBodySize: this.options.maxRequestBodySize,
      fetch: async (req: Request) => {
        return await this._handler(req, this);
      },
      error: this.options.error
        ? (err: Error) => this.options.error!(err)
        : (err: Error) => {
            return new Response(
              JSON.stringify({
                error: {
                  code: "INTERNAL_SERVER_ERROR",
                  message: err?.message || "Internal Server Error",
                },
              }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              }
            );
          },
    });
  }

  /**
   * 启动 HTTP 服务的别名方法。
   */
  listen(): void {
    this.start();
  }

  /**
   * 停止 HTTP 服务。
   */
  stop(closeActiveConnections = true): void {
    if (!this.server) {
      return;
    }
    this.server.stop(closeActiveConnections);
    this.server = undefined;
  }

  /**
   * 关闭 HTTP 服务的别名方法。
   */
  close(closeActiveConnections = true): void {
    this.stop(closeActiveConnections);
  }

  /**
   * 获取实际监听的端口号。
   */
  get port(): number {
    if (!this.server) {
      return this.options.port ?? 0;
    }
    return this.server.port ?? this.options.port ?? 0;
  }

  /**
   * 获取实际绑定的主机地址。
   */
  get host(): string {
    if (!this.server) {
      return this.options.hostname || this.options.host || "127.0.0.1";
    }
    return this.server.hostname ?? this.options.hostname ?? this.options.host ?? "127.0.0.1";
  }

  /**
   * 获取实际绑定的主机地址（别名）。
   */
  get hostname(): string {
    return this.host;
  }

  /**
   * 获取服务端完整根 URL。
   */
  get url(): string {
    if (this.server) {
      return this.server.url.toString().replace(/\/$/, "");
    }
    const host = this.host === "0.0.0.0" ? "127.0.0.1" : this.host;
    return `http://${host}:${this.port}`;
  }

  /**
   * 服务当前是否正在运行中。
   */
  get isRunning(): boolean {
    return !!this.server;
  }

  /**
   * 动态更新请求处理函数。
   */
  setHandler(handler: BunHttpHandler): void {
    this._handler = handler;
  }

  /**
   * 获取底层 Bun.serve 返回的原生 Server 实例。
   */
  get rawServer(): Server<unknown> | undefined {
    return this.server;
  }

  /**
   * 静态工厂方法：创建并立即启动 BunHttpServer。
   */
  static start(optionsOrHandler?: BunHttpServerOptions | BunHttpHandler): BunHttpServer {
    const server = new BunHttpServer(optionsOrHandler);
    if (!server.isRunning) {
      server.start();
    }
    return server;
  }
}

/**
 * 便捷工厂函数：创建并立即启动 BunHttpServer 实例。
 */
export function startBunHttpServer(
  optionsOrHandler?: BunHttpServerOptions | BunHttpHandler
): BunHttpServer {
  return BunHttpServer.start(optionsOrHandler);
}
