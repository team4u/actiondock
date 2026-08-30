import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison to prevent timing attacks.
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
 * Checks if a host address is a local loopback interface.
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
 * Verifies request authentication token against expected token using constant-time comparison.
 * Supports both standard Authorization header (Bearer <token>) and query parameter (?token=<token>).
 */
export function verifyBearerToken(req: Request, expectedToken?: string): boolean {
  if (!expectedToken || !expectedToken.trim()) {
    return true;
  }

  const trimmedExpected = expectedToken.trim();

  // 1. Authorization: Bearer <token>
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (safeEqual(token, trimmedExpected)) {
      return true;
    }
  }

  // 2. URL Query Token: ?token=<token>
  try {
    const url = new URL(req.url);
    const tokenParam = url.searchParams.get("token");
    if (tokenParam && safeEqual(tokenParam.trim(), trimmedExpected)) {
      return true;
    }
  } catch {
    // Malformed URL
  }

  return false;
}

/**
 * Resolves CORS headers based on configured origins whitelist.
 * Returns empty object when CORS is disabled (default).
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
