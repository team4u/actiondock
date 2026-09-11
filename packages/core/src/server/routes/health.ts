import { ACTIONDOCK_VERSION } from "../../version";
import { UNAUTHORIZED } from "../../errors";
import { verifyBearerToken } from "../security";
import { type RouteContext, jsonResponse } from "./common";

/**
 * 处理健康检查与就绪状态接口（支持 /api/v2/health、/health 与兼容别名 /api/v1/health）。
 */
export async function handleHealthRoute(ctx: RouteContext): Promise<Response | null> {
  const { req, pathname, corsHeaders, options, projectRoot } = ctx;

  if (
    pathname !== "/api/v2/health" &&
    pathname !== "/health" &&
    pathname !== "/api/v1/health"
  ) {
    return null;
  }

  if (!verifyBearerToken(req, options.token, options)) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: UNAUTHORIZED,
          message: "Invalid or missing Bearer token",
        },
      },
      401,
      corsHeaders
    );
  }

  const healthData: Record<string, unknown> = {
    ok: true,
    status: "healthy",
    version: ACTIONDOCK_VERSION,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  if (options.exposeDebugInfo && projectRoot) {
    healthData.projectRoot = projectRoot;
  }

  return jsonResponse(healthData, 200, corsHeaders);
}
