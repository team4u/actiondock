import { verifyBearerToken } from "../security";
import { type RouteContext, jsonResponse } from "./common";

/**
 * 处理健康检查与就绪状态接口（支持 /api/v1/health 与 /health）。
 */
export async function handleHealthRoute(ctx: RouteContext): Promise<Response | null> {
  const { req, pathname, corsHeaders, options, projectRoot } = ctx;

  if (pathname !== "/api/v1/health" && pathname !== "/health") {
    return null;
  }

  if (!verifyBearerToken(req, options.token)) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or missing Bearer token",
        },
      },
      401,
      corsHeaders
    );
  }

  const healthData: Record<string, unknown> = {
    status: "ok",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  if (options.exposeDebugInfo && projectRoot) {
    healthData.projectRoot = projectRoot;
  }

  return jsonResponse(healthData, 200, corsHeaders);
}
