import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { CONFIG_VALUE_INVALID } from "@actiondock/core";
import { ExecutionError, SigintError } from "../errors";
import { writeStderr } from "../renderer";
import type { CliContext } from "../types";
import { renderBrowserSecretPage } from "./browser-secret-page";

export interface PromptBrowserSecretOptions {
  targetLabel: string;
  key: string;
  signal?: AbortSignal;
  context?: CliContext;
  onSubmit: (secretValue: string) => Promise<void>;
  openBrowser?: (url: string) => Promise<boolean> | boolean;
  timeoutMs?: number;
}

/**
 * 跨平台启动系统默认浏览器。
 * 依据子进程错误与退出状态判断是否唤起成功；短时门限内未退出或未确认则判定为未确认成功（返回 false），
 * 促使终端展示手动打开链接，避免伪称成功。
 */
export function launchSystemBrowser(
  url: string,
  spawnFn: typeof spawn = spawn,
  confirmationTimeoutMs = 1500
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      let command: string;
      let args: string[];

      if (process.platform === "darwin") {
        command = "open";
        args = [url];
      } else if (process.platform === "win32") {
        command = "cmd.exe";
        args = ["/c", "start", '""', url];
      } else {
        command = "xdg-open";
        args = [url];
      }

      const proc = spawnFn(command, args, {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      });

      let settled = false;
      const finish = (ok: boolean) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(ok);
        }
      };

      proc.on("error", () => finish(false));
      proc.on("exit", (code) => finish(code === 0));

      // 若在确认门限时间内未退出（未收到 exit 0），保守判定为无法确认成功（返回 false）
      const timer = setTimeout(() => finish(false), confirmationTimeoutMs);
      timer.unref();

      if (typeof proc.unref === "function") {
        proc.unref();
      }
    } catch {
      resolve(false);
    }
  });
}

/**
 * 会话结算响应写出规格。
 */
interface FinalizeResponseSpec {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * 统一响应收尾：写出响应并在其真正关闭（或兜底超时）后结算会话。
 * 连接已销毁时跳过写出直接结算；close、finish、end 回调与兜底定时器
 * 任一触发即结算且幂等，不会重复执行结算逻辑。
 */
function finalizeResponse(
  res: http.ServerResponse,
  settle: () => void,
  spec: FinalizeResponseSpec
): void {
  let settled = false;
  const settleOnce = () => {
    if (settled) return;
    settled = true;
    settle();
  };

  if (res.destroyed || !res.socket || res.socket.destroyed) {
    settleOnce();
    return;
  }

  res.on("close", settleOnce);
  res.on("finish", settleOnce);
  try {
    res.writeHead(spec.status, spec.headers);
    res.end(spec.body, settleOnce);
  } catch {
    settleOnce();
  }
  setTimeout(settleOnce, 100).unref();
}

/**
 * 启动临时本地 HTTP 服务，通过浏览器交互页面安全录入敏感配置。
 */
export async function promptBrowserSecret(options: PromptBrowserSecretOptions): Promise<void> {
  const { targetLabel, key, signal, context, onSubmit } = options;

  if (signal?.aborted) {
    throw new SigintError("Operation cancelled by user");
  }

  const ticket = crypto.randomBytes(32).toString("hex");
  const nonce = crypto.randomBytes(16).toString("base64");
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  type State = "WAITING" | "SAVING" | "DONE" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  let state: State = "WAITING";

  return new Promise<void>((resolve, reject) => {
    const sockets = new Set<Socket>();
    let timer: NodeJS.Timeout | undefined;
    let signalListener: (() => void) | undefined;
    let cleanedUp = false;

    function cleanup(): void {
      if (cleanedUp) return;
      cleanedUp = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (signal && signalListener) {
        signal.removeEventListener("abort", signalListener);
      }
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close();
    }

    function startTimer(): void {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        if (state === "WAITING") {
          state = "TIMED_OUT";
          cleanup();
          reject(new ExecutionError("Browser secret input timed out after 5 minutes.", undefined, "TIMEOUT"));
        }
        return;
      }
      timer = setTimeout(() => {
        if (state === "WAITING") {
          state = "TIMED_OUT";
          cleanup();
          reject(new ExecutionError("Browser secret input timed out after 5 minutes.", undefined, "TIMEOUT"));
        }
      }, remainingMs);
      timer.unref();
    }

    function setupSignal(): void {
      if (!signal) return;
      if (signal.aborted) {
        if (state === "WAITING") {
          state = "CANCELLED";
          cleanup();
          reject(new SigintError("Operation cancelled by user"));
        }
        return;
      }
      signalListener = () => {
        if (state === "WAITING") {
          state = "CANCELLED";
          cleanup();
          reject(new SigintError("Operation cancelled by user"));
        }
      };
      signal.addEventListener("abort", signalListener, { once: true });
    }

    function readRequestBody(
      req: http.IncomingMessage,
      res: http.ServerResponse,
      securityHeaders: Record<string, string>
    ): Promise<{ value: unknown } | undefined> {
      return new Promise((resolveBody) => {
        const MAX_BODY_SIZE = 64 * 1024;
        let bodyBytes = 0;
        const chunks: Buffer[] = [];
        let done = false;

        const onClientError = (_err?: unknown) => {
          if (done) return;
          done = true;
          req.removeAllListeners("data");
          req.removeAllListeners("end");
          chunks.length = 0;
          try {
            if (!res.headersSent) {
              res.writeHead(400, { "Content-Type": "text/plain", Connection: "close", ...securityHeaders });
            }
            res.end("Bad Request: Client aborted or stream error");
          } catch {
            // Socket already closed
          }
          resolveBody(undefined);
        };

        req.on("error", onClientError);
        req.on("aborted", onClientError);

        req.on("data", (chunk: Buffer) => {
          if (done) return;
          bodyBytes += chunk.length;
          if (bodyBytes > MAX_BODY_SIZE) {
            done = true;
            req.pause();
            req.removeAllListeners("data");
            req.removeAllListeners("end");
            chunks.length = 0;
            try {
              res.writeHead(413, {
                "Content-Type": "text/plain",
                Connection: "close",
                ...securityHeaders,
              });
              res.end("Payload Too Large", () => {
                req.destroy();
              });
            } catch {
              // Socket already destroyed
            }
            resolveBody(undefined);
            return;
          }
          chunks.push(chunk);
        });

        req.on("end", () => {
          if (done) return;
          done = true;
          try {
            const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            resolveBody({ value });
          } catch {
            try {
              res.writeHead(400, { "Content-Type": "application/json", ...securityHeaders });
              res.end(JSON.stringify({ error: "Invalid JSON format" }));
            } catch {}
            resolveBody(undefined);
          }
        });
      });
    }

    async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        res.writeHead(500, { "Content-Type": "text/plain", Connection: "close" });
        res.end("Internal Server Error");
        return;
      }

      const port = address.port;
      const exactHost = `127.0.0.1:${port}`;
      const exactOrigin = `http://127.0.0.1:${port}`;

      const securityHeaders: Record<string, string> = {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        "Content-Security-Policy":
          `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      };

      // 仅允许回环地址 127.0.0.1 该端口的精确 Host
      if (req.headers.host !== exactHost) {
        res.writeHead(400, { "Content-Type": "text/plain", ...securityHeaders });
        res.end("Bad Request: Invalid Host header");
        return;
      }

      const urlPath = req.url?.split("?")[0] || "";

      if (req.method === "GET" && (urlPath === "/" || urlPath === "")) {
        const html = renderBrowserSecretPage({ targetLabel, key, nonce });
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          ...securityHeaders,
        });
        res.end(html);
        return;
      }

      if (req.method === "POST" && (urlPath === "/submit" || urlPath === "/cancel")) {
        // 仅允许回环地址 127.0.0.1 该端口的精确 Origin
        if (req.headers.origin !== exactOrigin) {
          res.writeHead(403, { "Content-Type": "text/plain", ...securityHeaders });
          res.end("Forbidden: Invalid Origin header");
          return;
        }

        // 精确匹配 media type application/json（允许合法参数如 charset）
        const rawContentType = (req.headers["content-type"] || "").trim().toLowerCase();
        const mediaType = rawContentType.split(";")[0].trim();
        if (mediaType !== "application/json") {
          res.writeHead(415, { "Content-Type": "text/plain", ...securityHeaders });
          res.end("Unsupported Media Type: application/json required");
          return;
        }

        const payload = await readRequestBody(req, res, securityHeaders);
        if (!payload) return;

        if (payload.value === null || typeof payload.value !== "object" || Array.isArray(payload.value)) {
          res.writeHead(400, { "Content-Type": "application/json", ...securityHeaders });
          res.end(JSON.stringify({ error: "Invalid payload structure" }));
          return;
        }

        const body = payload.value as Record<string, unknown>;
        const bodyKeys = Object.keys(body);

        // cancel 仅允许包含 ticket 唯一字段
        if (urlPath === "/cancel") {
          if (bodyKeys.length !== 1 || typeof body.ticket !== "string") {
            res.writeHead(400, { "Content-Type": "application/json", ...securityHeaders });
            res.end(JSON.stringify({ error: "Invalid payload shape for cancel" }));
            return;
          }
          if (body.ticket !== ticket) {
            res.writeHead(403, { "Content-Type": "application/json", ...securityHeaders });
            res.end(JSON.stringify({ error: "Invalid security ticket" }));
            return;
          }
          if (state !== "WAITING") {
            res.writeHead(409, { "Content-Type": "application/json", ...securityHeaders });
            res.end(JSON.stringify({ error: "Cannot cancel in current state" }));
            return;
          }
          state = "CANCELLED";
          finalizeResponse(
            res,
            () => {
              cleanup();
              reject(new SigintError("User cancelled input in browser"));
            },
            {
              status: 200,
              headers: { "Content-Type": "application/json", ...securityHeaders },
              body: JSON.stringify({ ok: true }),
            }
          );
          return;
        }

        // submit 仅允许包含 ticket 与 value 两个字段
        if (
          bodyKeys.length !== 2 ||
          typeof body.ticket !== "string" ||
          typeof body.value !== "string" ||
          !("ticket" in body) ||
          !("value" in body)
        ) {
          res.writeHead(400, { "Content-Type": "application/json", ...securityHeaders });
          res.end(JSON.stringify({ error: "Invalid payload shape for submit" }));
          return;
        }

        if (body.ticket !== ticket) {
          res.writeHead(403, { "Content-Type": "application/json", ...securityHeaders });
          res.end(JSON.stringify({ error: "Invalid security ticket" }));
          return;
        }

        // 提交点规则：非 WAITING 状态一律按并发冲突或失效拒绝
        if (state !== "WAITING") {
          if (state === "SAVING" || state === "DONE") {
            res.writeHead(409, { "Content-Type": "application/json", ...securityHeaders });
            res.end(JSON.stringify({ error: "A submission is already being processed or completed" }));
          } else {
            res.writeHead(410, { "Content-Type": "application/json", ...securityHeaders });
            res.end(JSON.stringify({ error: "Input session is no longer active" }));
          }
          return;
        }

        // 进入 SAVING 提交点阶段：停止等待计时器并移除取消监听，确保已提交任务不被提前打断
        state = "SAVING";
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (signal && signalListener) {
          signal.removeEventListener("abort", signalListener);
        }

        try {
          await onSubmit(body.value);

          state = "DONE";
          finalizeResponse(
            res,
            () => {
              cleanup();
              resolve();
            },
            {
              status: 200,
              headers: { "Content-Type": "application/json", ...securityHeaders },
              body: JSON.stringify({ ok: true }),
            }
          );
        } catch (err: unknown) {
          // 已知校验失败返回 400
          const errorCode = (err as { code?: string })?.code;
          if (errorCode === CONFIG_VALUE_INVALID) {
            try {
              res.writeHead(400, { "Content-Type": "application/json", ...securityHeaders });
              res.end(JSON.stringify({ error: "配置值不符合模式要求，请修正后重试。" }));
            } catch {
              // Ignore response error
            }

            // 检查保存阶段是否收到外部取消信号，若已取消则立即按中断结算与收尾
            if (signal?.aborted) {
              state = "CANCELLED";
              cleanup();
              reject(new SigintError("Operation cancelled by user"));
              return;
            }

            // 检查是否已达到最初固定的 deadline
            if (Date.now() >= deadline) {
              state = "TIMED_OUT";
              cleanup();
              reject(new ExecutionError("Browser secret input timed out after 5 minutes.", undefined, "TIMEOUT"));
              return;
            }

            // 未取消且未过期，恢复 WAITING 状态并继续在原 deadline 内等待输入
            state = "WAITING";
            startTimer();
            setupSignal();
            return;
          }

          // 其他内部或持久化严重异常返回 500，终止会话并使 CLI 以安全 ExecutionError 退出
          state = "FAILED";
          finalizeResponse(
            res,
            () => {
              cleanup();
              reject(
                new ExecutionError(
                  "Failed to save configuration due to an internal error.",
                  undefined,
                  "EXECUTION_FAILURE"
                )
              );
            },
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                Connection: "close",
                ...securityHeaders,
              },
              body: JSON.stringify({ error: "存储服务异常，未能保存配置。" }),
            }
          );
        }
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain", ...securityHeaders });
      res.end("Not Found");
    }

    const server = http.createServer((req, res) => {
      handleRequest(req, res).catch((_err) => {
        try {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "text/plain", Connection: "close" });
          }
          res.end("Internal Server Error");
        } catch {
          // Socket already closed
        }
      });
    });

    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });

    server.on("error", (err) => {
      cleanup();
      reject(err);
    });

    startTimer();
    setupSignal();
    if (cleanedUp) return;

    server.listen(0, "127.0.0.1", async () => {
      const address = server.address() as AddressInfo;
      const port = address.port;
      const url = `http://127.0.0.1:${port}/#ticket=${ticket}`;

      writeStderr(`Open the following URL in your browser to configure '${key}':`, context);
      writeStderr(`  ${url}`, context);
      writeStderr("Waiting for browser input (press Ctrl+C to cancel)...", context);

      const opener = options.openBrowser ?? launchSystemBrowser;

      try {
        const opened = await opener(url);
        if (!opened) {
          writeStderr("Failed to launch browser automatically. Please open the URL above manually.", context);
        }
      } catch {
        writeStderr("Failed to launch browser automatically. Please open the URL above manually.", context);
      }
    });
  });
}
