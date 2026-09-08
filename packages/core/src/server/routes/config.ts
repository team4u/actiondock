import { loadProjectConfig } from "../../project/loader";
import { resolveEnvValue } from "../../runtime";
import { readJsonBody } from "../body";
import { type RouteContext, jsonResponse, resolveStorageForPackage } from "./common";

/**
 * 处理配置元数据与当前值读取、更新及删除接口。
 */
export async function handleConfigRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, projectRoot, customHome, runtimeRegistry, options } = ctx;

  // 1. Config Env Check: GET /api/v1/config/env
  if (pathname === "/api/v1/config/env" && req.method === "GET") {
    try {
      const pkgParam = url.searchParams.get("package") || undefined;
      const { packageId, projectRoot: root } = resolveStorageForPackage(
        pkgParam,
        runtimeRegistry,
        projectRoot,
        customHome
      );
      if (!root) {
        return jsonResponse({ ok: true, packageId, envChecks: [] }, 200, corsHeaders);
      }
      const cfg = loadProjectConfig(root);
      const declared = cfg.config || {};
      const envChecks: any[] = [];
      for (const [k, def] of Object.entries(declared)) {
        const resolved = resolveEnvValue(k, def, packageId);
        const matchedEnv = resolved?.envKey || null;
        envChecks.push({
          key: k,
          required: def.default === undefined,
          satisfied: Boolean(resolved !== undefined || def.default !== undefined),
          matchedEnv,
          hasDefault: def.default !== undefined,
          secret: Boolean(def.secret),
        });
      }
      return jsonResponse({ ok: true, packageId, envChecks }, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        { ok: false, error: { code: "CONFIG_ENV_ERROR", message: err.message } },
        500,
        corsHeaders
      );
    }
  }

  // 2. Config Query: GET /api/v1/config
  if (pathname === "/api/v1/config" && req.method === "GET") {
    try {
      const pkgParam = url.searchParams.get("package") || undefined;
      const { packageId, storage, projectRoot: root } = resolveStorageForPackage(
        pkgParam,
        runtimeRegistry,
        projectRoot,
        customHome
      );
      const stored = storage.listConfig();
      let declared: Record<string, any> = {};
      if (root) {
        try {
          const cfg = loadProjectConfig(root);
          declared = cfg.config || {};
        } catch {}
      }
      const maskedValues: Record<string, any> = {};
      for (const [k, v] of Object.entries(stored)) {
        if (declared[k]?.secret) {
          maskedValues[k] = "******";
        } else {
          maskedValues[k] = v;
        }
      }
      return jsonResponse(
        { ok: true, packageId, declared, values: maskedValues },
        200,
        corsHeaders
      );
    } catch (err: any) {
      return jsonResponse(
        { ok: false, error: { code: "CONFIG_LIST_ERROR", message: err.message } },
        500,
        corsHeaders
      );
    }
  }

  // 3. Config Update: PUT / POST /api/v1/config
  if (pathname === "/api/v1/config" && (req.method === "PUT" || req.method === "POST")) {
    try {
      const body = await readJsonBody(req, { maxBytes: options.maxBodyBytes });
      const pkgParam = url.searchParams.get("package") || body.package || undefined;
      const { packageId, storage } = resolveStorageForPackage(
        pkgParam,
        runtimeRegistry,
        projectRoot,
        customHome
      );
      const key = body.key;
      if (!key) {
        return jsonResponse(
          { ok: false, error: { code: "INVALID_ARGUMENT", message: "Config 'key' is required" } },
          400,
          corsHeaders
        );
      }
      storage.setConfig(key, body.value);
      return jsonResponse({ ok: true, packageId, key, message: "updated" }, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        { ok: false, error: { code: "CONFIG_SET_ERROR", message: err.message } },
        500,
        corsHeaders
      );
    }
  }

  // 4. Config Delete: DELETE /api/v1/config/:key
  const configKeyMatch = pathname.match(/^\/api\/v1\/config\/([^/]+)$/);
  if (configKeyMatch && req.method === "DELETE") {
    try {
      const key = decodeURIComponent(configKeyMatch[1]);
      const pkgParam = url.searchParams.get("package") || undefined;
      const { packageId, storage } = resolveStorageForPackage(
        pkgParam,
        runtimeRegistry,
        projectRoot,
        customHome
      );
      const deleted = storage.deleteConfig(key);
      return jsonResponse({ ok: true, packageId, key, deleted }, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        { ok: false, error: { code: "CONFIG_DELETE_ERROR", message: err.message } },
        500,
        corsHeaders
      );
    }
  }

  return null;
}
