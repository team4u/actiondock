import { runDoctorChecks } from "../../doctor/doctor";
import { assertPackageAllowed, getSubPath, jsonResponse, type RouteContext } from "./common";

/**
 * 处理环境与依赖诊断接口（GET /api/v2/doctor、/doctor 与兼容别名 /api/v1/doctor）。
 */
export async function handleDoctorRoute(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, projectRoot, customHome, host, target, options } = ctx;
  const subpath = getSubPath(pathname);

  if (subpath !== "/doctor" || req.method !== "GET") {
    return null;
  }

  try {
    const targetPkg = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
    if (options.packageAllowlist && options.packageAllowlist.length > 0) {
      if (!targetPkg) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "PACKAGE_NOT_ALLOWED",
              message: "Global doctor check is forbidden when package allowlist is active. Please specify an allowed package.",
            },
          },
          403,
          corsHeaders
        );
      }
    }
    if (targetPkg) {
      assertPackageAllowed(targetPkg, options);
    }

    let packageRoot: string | undefined;
    if (targetPkg) {
      if (host) {
        packageRoot = host.getApp(targetPkg)?.packageRoot;
      }
      if (!packageRoot && target?.unwrap) {
        const inner = target.unwrap();
        if (inner && "getApp" in inner && typeof (inner as any).getApp === "function") {
          packageRoot = (inner as any).getApp(targetPkg)?.packageRoot;
        } else if (inner && "packageId" in inner && (inner as any).packageId === targetPkg) {
          packageRoot = (inner as any).packageRoot;
        }
      }
    }

    const report = await runDoctorChecks({
      cwd: packageRoot || projectRoot || process.cwd(),
      packageIdOrPath: packageRoot || targetPkg,
      customHome,
      packageAllowlist: options.packageAllowlist,
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
