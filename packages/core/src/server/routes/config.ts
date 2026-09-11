import { CAPABILITY_UNAVAILABLE } from "../../errors";
import { resolveEnvValue } from "../../runtime";
import { isSecretConfigKey, maskSecretValue } from "../../storage";
import { readJsonBody } from "../body";
import { getSubPath, jsonResponse, resolveAppForPackage, type RouteContext } from "./common";

/**
 * 处理配置元数据与当前值读取、更新及删除接口。
 * 在未显式开启管理功能 (options.enableManagement !== true) 时返回 403 拒绝。
 */
export async function handleConfigRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, options, host, target } = ctx;
  const subpath = getSubPath(pathname);

  const isConfigRoute =
    subpath === "/config" ||
    subpath.startsWith("/config/") ||
    subpath.startsWith("/management/config");

  if (!isConfigRoute) {
    return null;
  }

  // 校验管理能力开关
  if (options.enableManagement !== true) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: CAPABILITY_UNAVAILABLE,
          message: "Management APIs are not enabled on this server. Set enableManagement: true to enable.",
        },
      },
      403,
      corsHeaders
    );
  }

  // 1. Config Env Check: GET /config/env
  if (subpath === "/config/env" && req.method === "GET") {
    try {
      const pkgParam = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      const app = resolveAppForPackage(pkgParam, host, target);
      const declared = (app as any).projectConfig?.config || {};
      const envChecks: any[] = [];
      for (const [k, def] of Object.entries(declared as Record<string, any>)) {
        const resolved = resolveEnvValue(k, def, app.packageId);
        const matchedEnv = resolved?.envKey || null;
        envChecks.push({
          key: k,
          required: def.default === undefined,
          satisfied: Boolean(resolved !== undefined || def.default !== undefined),
          matchedEnv,
          hasDefault: def.default !== undefined,
          secret: isSecretConfigKey(k, def),
        });
      }
      return jsonResponse({ ok: true, packageId: app.packageId, envChecks }, 200, corsHeaders);
    } catch (err: any) {
      const isClient =
        err.message?.includes("Unknown or unregistered package") ||
        err.message?.includes("Invalid packageId") ||
        err.message?.includes("escapes boundary");
      return jsonResponse(
        { ok: false, error: { code: isClient ? "INVALID_ARGUMENT" : "CONFIG_ENV_ERROR", message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  // 2. Config Query: GET /config
  if (subpath === "/config" && req.method === "GET") {
    try {
      const pkgParam = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      const app = resolveAppForPackage(pkgParam, host, target);
      const stored = app.storage.listConfig();
      const declared = (app as any).projectConfig?.config || {};
      const maskedValues: Record<string, any> = {};
      for (const [k, v] of Object.entries(stored)) {
        if (isSecretConfigKey(k, declared[k])) {
          maskedValues[k] = maskSecretValue(v);
        } else {
          maskedValues[k] = v;
        }
      }
      return jsonResponse(
        { ok: true, packageId: app.packageId, declared, values: maskedValues },
        200,
        corsHeaders
      );
    } catch (err: any) {
      const isClient =
        err.message?.includes("Unknown or unregistered package") ||
        err.message?.includes("Invalid packageId") ||
        err.message?.includes("escapes boundary");
      return jsonResponse(
        { ok: false, error: { code: isClient ? "INVALID_ARGUMENT" : "CONFIG_LIST_ERROR", message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  // 3. Config Update: PUT / POST /config
  if (subpath === "/config" && (req.method === "PUT" || req.method === "POST")) {
    try {
      const body = await readJsonBody(req, { maxBytes: options.maxBodyBytes });
      const pkgParam = url.searchParams.get("package") || url.searchParams.get("packageId") || body.package || undefined;
      const app = resolveAppForPackage(pkgParam, host, target);
      const key = body.key;
      if (!key) {
        return jsonResponse(
          { ok: false, error: { code: "INVALID_ARGUMENT", message: "Config 'key' is required" } },
          400,
          corsHeaders
        );
      }
      await app.setConfig(key, body.value);
      return jsonResponse({ ok: true, packageId: app.packageId, key, message: "updated" }, 200, corsHeaders);
    } catch (err: any) {
      const isClient =
        err.message?.includes("Unknown or unregistered package") ||
        err.message?.includes("Invalid packageId") ||
        err.message?.includes("escapes boundary");
      return jsonResponse(
        { ok: false, error: { code: isClient ? "INVALID_ARGUMENT" : "CONFIG_SET_ERROR", message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  // 4. Config Delete: DELETE /config/:key
  const configKeyMatch = subpath.match(/^\/config\/([^/]+)$/);
  if (configKeyMatch && req.method === "DELETE") {
    try {
      const key = decodeURIComponent(configKeyMatch[1]);
      const pkgParam = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      const app = resolveAppForPackage(pkgParam, host, target);
      const deleted = app.storage.deleteConfig(key);
      return jsonResponse({ ok: true, packageId: app.packageId, key, deleted }, 200, corsHeaders);
    } catch (err: any) {
      const isClient =
        err.message?.includes("Unknown or unregistered package") ||
        err.message?.includes("Invalid packageId") ||
        err.message?.includes("escapes boundary");
      return jsonResponse(
        { ok: false, error: { code: isClient ? "INVALID_ARGUMENT" : "CONFIG_DELETE_ERROR", message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  return null;
}
