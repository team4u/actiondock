import { runDoctorChecks } from "../../doctor/doctor";
import { type RouteContext, jsonResponse } from "./common";

/**
 * 处理环境与依赖诊断接口（GET /api/v1/doctor）。
 */
export async function handleDoctorRoute(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, projectRoot, customHome } = ctx;

  if (pathname !== "/api/v1/doctor" || req.method !== "GET") {
    return null;
  }

  try {
    const targetPkg = url.searchParams.get("package") || undefined;
    const report = await runDoctorChecks({
      cwd: projectRoot || process.cwd(),
      packageIdOrPath: targetPkg,
      customHome,
    });
    return jsonResponse({ ok: true, report }, 200, corsHeaders);
  } catch (err: any) {
    return jsonResponse(
      { ok: false, error: { code: "DOCTOR_ERROR", message: err.message } },
      500,
      corsHeaders
    );
  }
}
