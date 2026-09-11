import { runDoctorChecks } from "../../doctor/doctor";
import { assertPackageAllowed, getSubPath, jsonResponse, type RouteContext } from "./common";

/**
 * 处理环境与依赖诊断接口（GET /api/v2/doctor、/doctor 与兼容别名 /api/v1/doctor）。
 */
export async function handleDoctorRoute(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, projectRoot, customHome, options } = ctx;
  const subpath = getSubPath(pathname);

  if (subpath !== "/doctor" || req.method !== "GET") {
    return null;
  }

  try {
    const targetPkg = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
    if (targetPkg) {
      assertPackageAllowed(targetPkg, options);
    }
    const report = await runDoctorChecks({
      cwd: projectRoot || process.cwd(),
      packageIdOrPath: targetPkg,
      customHome,
    });
    return jsonResponse({ ok: true, report }, 200, corsHeaders);
  } catch (err: any) {
    if (err.code === "PACKAGE_NOT_ALLOWED" || err.status === 403) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "PACKAGE_NOT_ALLOWED",
            message: err.message || "Package is not in the allowed package list",
          },
        },
        403,
        corsHeaders
      );
    }
    return jsonResponse(
      { ok: false, error: { code: "DOCTOR_ERROR", message: err.message } },
      500,
      corsHeaders
    );
  }
}
