import { timingSafeEqual } from "node:crypto";

/**
 * 恒定时间字符串比较（Constant-time comparison）。
 * 使用底层的 `crypto.timingSafeEqual` 防范时序攻击（Timing Attack）。
 * 
 * @param a 字符串 A
 * @param b 字符串 B
 * @returns 两个字符串内容是否完全一致
 */
export function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);

  if (aa.length !== bb.length) {
    return false;
  }

  return timingSafeEqual(aa, bb);
}

/**
 * 检查指定的主机地址是否为本地回环接口（Loopback Host）。
 * 支持 127.0.0.1, localhost, ::1 等形式。
 * 
 * @param host 主机名或 IP 字符串
 */
export function isLoopbackHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase();
  return (
    trimmed === "127.0.0.1" ||
    trimmed === "::1" ||
    trimmed === "localhost" ||
    trimmed === "0:0:0:0:0:0:0:1"
  );
}

/**
 * 校验 HTTP 请求中的鉴权令牌是否有效。
 * 
 * 支持两种凭证携带模式（均通过恒定时间对比）：
 * 1. HTTP 请求头: `Authorization: Bearer <token>`
 * 2. URL 查询参数: `?token=<token>`（便于浏览器/Web 调试）
 * 
 * @param req 传入的 HTTP Request 对象
 * @param expectedToken 服务端预期的正确 Token（若未配置 Token 则默认放行）
 * @returns 是否鉴权成功
 */
export function verifyBearerToken(req: Request, expectedToken?: string): boolean {
  if (!expectedToken || !expectedToken.trim()) {
    return true;
  }

  const trimmedExpected = expectedToken.trim();

  // 1. 请求头 Authorization: Bearer <token>
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (safeEqual(token, trimmedExpected)) {
      return true;
    }
  }

  // 2. URL 查询参数: ?token=<token>
  try {
    const url = new URL(req.url);
    const tokenParam = url.searchParams.get("token");
    if (tokenParam && safeEqual(tokenParam.trim(), trimmedExpected)) {
      return true;
    }
  } catch {
    // 畸形 URL 视作鉴权失败
  }

  return false;
}

/**
 * 根据配置的 CORS 白名单解析并返回跨域响应头。
 * 默认情况下若未配置 corsOrigins，返回空对象（即默认关闭跨域访问，防范 CSRF）。
 * 
 * @param origin 请求头中的 Origin 字段
 * @param allowedOrigins 允许跨域的白名单来源数组
 * @returns 包含 Access-Control-* 的响应头对象
 */
export function resolveCorsHeaders(
  origin: string | null,
  allowedOrigins?: string[]
): Record<string, string> {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return {};
  }

  const hasWildcard = allowedOrigins.includes("*");
  if (hasWildcard) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Vary: "Origin",
    };
  }

  if (origin && allowedOrigins.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Vary: "Origin",
    };
  }

  return {};
}
