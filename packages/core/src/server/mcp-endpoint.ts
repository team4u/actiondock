import { UNAUTHORIZED, REQUEST_TOO_LARGE } from "../errors";
import { jsonResponse } from "./routes/common";
import { DEFAULT_MAX_BODY_BYTES, readBodyWithLimit, RequestTooLargeError } from "./body";
import { resolveCorsHeaders, verifyBearerToken } from "./security";

/**
 * 共享 MCP 端点处理器工厂配置选项。
 *
 * 覆盖 core 网关与 mcp 独立 HTTP 服务双方共同消费的配置面：
 * - token 与 allowQueryToken 决定 Bearer 鉴权（含查询参数放行开关）；
 * - corsOrigins 决定跨域响应头解析；
 * - maxBodyBytes 决定请求体有界读取上限（防 DoS）；
 * - corsApplyMode 决定 MCP 响应的 CORS 头部应用方式。
 */
export interface McpEndpointHandlerOptions {
  /** 服务端预期的 Bearer Token（未配置时默认放行） */
  token?: string;
  /** 是否允许通过 URL 查询参数携带 Token（默认 false） */
  allowQueryToken?: boolean;
  /** 允许跨域请求的 CORS Origin 白名单列表 */
  corsOrigins?: string[];
  /** 最大允许的请求体字节限制（默认 1 MiB，防 DoS） */
  maxBodyBytes?: number;
  /** MCP 响应的 CORS 头部应用模式（默认 inherit 透传响应原头部） */
  corsApplyMode?: McpCorsApplyMode;
}

/**
 * MCP 委托处理器契约。
 * 接收经限流重建后的标准 Request，返回 MCP 协议响应；
 * 返回 null / undefined 表示委托方未处理，交回调用方继续后续路由。
 */
export type McpDelegateHandler = (
  req: Request
) => Promise<Response | null | undefined> | Response | null | undefined;

/**
 * 构造 MCP 响应的 CORS 头部回写规则。
 * - inherit：透传 MCP 响应自身头部（core 网关行为）；
 * - merge：将解析出的 CORS 头部合并覆盖到 MCP 响应（mcp 独立服务行为）。
 */
export type McpCorsApplyMode = "inherit" | "merge";

/**
 * 构造 413 Payload Too Large JSON 响应。
 */
function requestTooLargeResponse(corsHeaders: Record<string, string>): Response {
  return jsonResponse(
    {
      ok: false,
      error: {
        code: REQUEST_TOO_LARGE,
        message: "Request body exceeds maximum allowed size",
      },
    },
    413,
    corsHeaders
  );
}

/**
 * 有界读取请求体并重建 Request。
 *
 * 读取与超限判定统一复用 body 域的 readBodyWithLimit 单一事实源；
 * 超限时返回 null 表示应回退 413 响应，由调用方构造错误响应。
 * 空请求体保持 body 为 undefined，与 core 网关历史行为逐字节一致。
 *
 * @param req 原始请求
 * @param maxBytes 单次请求体允许的最大字节数
 * @returns 重建后的请求；体积超限时返回 null
 */
async function rebuildRequestWithLimit(
  req: Request,
  maxBytes: number
): Promise<Request | null> {
  let merged: Uint8Array;
  try {
    merged = await readBodyWithLimit(req, { maxBytes });
  } catch (err) {
    if (err instanceof RequestTooLargeError) {
      return null;
    }
    throw err;
  }

  const bodyInit =
    merged.byteLength > 0 ? new Blob([merged as unknown as BlobPart]) : undefined;
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: bodyInit,
    signal: req.signal,
  });
}

/**
 * 按指定模式为 MCP 响应附加 CORS 头部。
 *
 * @param response MCP 委托处理器返回的原始响应
 * @param corsHeaders 本次请求解析出的 CORS 响应头
 * @param mode CORS 头部应用模式（默认 inherit 透传）
 */
function applyCorsToResponse(
  response: Response,
  corsHeaders: Record<string, string>,
  mode: McpCorsApplyMode
): Response {
  if (mode !== "merge" || Object.keys(corsHeaders).length === 0) {
    return response;
  }
  const newHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders)) {
    newHeaders.set(k, String(v));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * 共享 MCP 端点处理器契约。
 *
 * 返回 Response 表示已完整处理；返回 null / undefined 表示委托方未处理，
 * 交回调用方继续后续路由分发。
 */
export type McpEndpointHandler = (req: Request) => Promise<Response | null | undefined>;

/**
 * 构造可复用的 MCP 端点处理器。
 *
 * 统一承载 core 网关端点与 mcp 独立 HTTP 服务共同遵循的请求处理子序列：
 * verifyBearerToken 鉴权（401 标准 JSON）→ readBodyWithLimit 有界读取
 * （413 处理）→ 委托 MCP 处理器 → 按 corsApplyMode 应用 CORS 头部。
 *
 * CORS 头部解析与 OPTIONS 预检由外层路由分发统一承担（两端点在健康检查、
 * 全局鉴权等前置路由上存在形态差异，不宜在此收敛）；本处理器聚焦 MCP
 * 端点自身的鉴权与请求体防护序列。
 *
 * 鉴权失败响应默认产出 core 网关标准错误形态；需要 JSON-RPC 错误形态的
 * 调用方（如 mcp 独立服务）可通过 unauthorizedResponse 定制。
 *
 * @param delegate MCP 委托处理器（接收限流重建后的 Request）
 * @param options 端点配置选项
 */
export function createMcpEndpointHandler(
  delegate: McpDelegateHandler,
  options: McpEndpointHandlerOptions & {
    /** 鉴权失败响应构造（默认产出 core 网关标准 401 JSON） */
    unauthorizedResponse?: (corsHeaders: Record<string, string>) => Response;
  } = {}
): McpEndpointHandler {
  const {
    token,
    allowQueryToken,
    corsOrigins,
    maxBodyBytes,
    unauthorizedResponse,
  } = options;
  const maxBytes = maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const verifyOptions = { allowQueryToken };

  return async (req: Request): Promise<Response | null | undefined> => {
    const origin = req.headers.get("origin");
    const corsHeaders = resolveCorsHeaders(origin, corsOrigins);

    // Bearer Token 鉴权拦截
    if (!verifyBearerToken(req, token, verifyOptions)) {
      return (
        unauthorizedResponse?.(corsHeaders) ??
        jsonResponse(
          {
            ok: false,
            error: {
              code: UNAUTHORIZED,
              message: "Invalid or missing Bearer token",
            },
          },
          401,
          corsHeaders
        )
      );
    }

    // 请求体体积限制保护（复用 body 域有界读取单一事实源）
    let mcpReq = req;
    if (req.body && req.method !== "GET" && req.method !== "HEAD") {
      const rebuilt = await rebuildRequestWithLimit(req, maxBytes);
      if (!rebuilt) {
        return requestTooLargeResponse(corsHeaders);
      }
      mcpReq = rebuilt;
    }

    const mcpRes = await delegate(mcpReq);
    if (mcpRes) {
      return applyCorsToResponse(mcpRes, corsHeaders, options.corsApplyMode ?? "inherit");
    }
    return mcpRes;
  };
}
