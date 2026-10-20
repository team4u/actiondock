import {
  CAPABILITY_UNAVAILABLE,
  CONFIG_DELETE_ERROR,
  CONFIG_ENV_ERROR,
  CONFIG_LIST_ERROR,
  CONFIG_SET_ERROR,
  CONFIG_VALUE_INVALID,
  INVALID_ARGUMENT,
  INVALID_PACKAGE_ID,
  PACKAGE_NOT_ALLOWED,
  PACKAGE_NOT_FOUND,
  PATH_TRAVERSAL,
} from "../../errors";
import { resolveEnvValue } from "../../runtime";
import { isSecretConfigKey, sanitizeConfigDefinitions } from "../../storage";
import { assertConcreteConfigKey, isConfigTemplate } from "../../project/config-declarations";
import { readJsonBody } from "../body";
import {
  getSubPath,
  isManagementAllowedByPolicy,
  jsonResponse,
  resolveTargetPackageId,
  type RouteContext,
} from "./common";

function isClientConfigError(err: any): boolean {
  return (
    err?.code === PACKAGE_NOT_FOUND ||
    err?.code === INVALID_PACKAGE_ID ||
    err?.code === PATH_TRAVERSAL ||
    err?.code === INVALID_ARGUMENT ||
    err?.code === CONFIG_VALUE_INVALID ||
    err?.status === 400 ||
    err?.status === 404
  );
}

/**
 * 处理配置元数据与当前值读取、更新及删除接口。
 * 在未显式开启管理功能时返回 403 拒绝。
 */
export async function handleConfigRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, options, service, activePolicy: policy } = ctx;
  const subpath = getSubPath(pathname);

  const isConfigRoute =
    subpath === "/config" ||
    subpath.startsWith("/config/") ||
    subpath.startsWith("/management/config");

  if (!isConfigRoute) {
    return null;
  }

  // 校验管理能力开关
  if (!isManagementAllowedByPolicy(policy) || !service.management?.config) {
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
      const pkgs = await service.discovery.listPackages();
      const pkgParam = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      const targetPackageId = resolveTargetPackageId(pkgs, pkgParam, policy);
      const pkg = pkgs.find((p) => p.id === targetPackageId);
      const declared = pkg?.config || {};
      const envChecks: any[] = [];
      for (const [k, def] of Object.entries(declared as Record<string, any>)) {
        if (isConfigTemplate(k)) {
          continue;
        }
        const resolved = resolveEnvValue(k, def, targetPackageId);
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
      return jsonResponse({ ok: true, packageId: targetPackageId, envChecks }, 200, corsHeaders);
    } catch (err: any) {
      if (err.code === PACKAGE_NOT_ALLOWED || err.status === 403) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: PACKAGE_NOT_ALLOWED,
              message: err.message || "Package is not in the allowed package list",
            },
          },
          403,
          corsHeaders
        );
      }
      const isClient = isClientConfigError(err);
      return jsonResponse(
        { ok: false, error: { code: isClient ? INVALID_ARGUMENT : CONFIG_ENV_ERROR, message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  // 2. Config Query: GET /config
  if (subpath === "/config" && req.method === "GET") {
    try {
      const pkgs = await service.discovery.listPackages();
      const pkgParam = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      const targetPackageId = resolveTargetPackageId(pkgs, pkgParam, policy);
      const pkg = pkgs.find((p) => p.id === targetPackageId);
      const rawDeclared = pkg?.config || {};
      const declared = sanitizeConfigDefinitions(rawDeclared) || {};
      const queryKey = url.searchParams.get("key");
      if (queryKey !== null) {
        assertConcreteConfigKey(queryKey);
        const item = await service.management.config.get(targetPackageId, queryKey);
        return jsonResponse({ ok: true, configViewVersion: 1, packageId: targetPackageId, declared, item }, 200, corsHeaders);
      }
      const views = await service.management.config.list(targetPackageId);
      const maskedValues: Record<string, any> = Object.create(null);
      const maskedPaths: Record<string, string[]> = Object.create(null);
      for (const v of views) {
        maskedPaths[v.key] = v.redactedPaths || [];
        if (v.secret && v.value === undefined) {
          if (v.redactedPaths && v.redactedPaths.length > 0) {
            maskedValues[v.key] = "********";
          } else {
            maskedValues[v.key] = undefined;
          }
        } else {
          maskedValues[v.key] = v.value;
        }
      }
      return jsonResponse(
        {
          ok: true,
          configViewVersion: 1,
          packageId: targetPackageId,
          declared,
          values: maskedValues,
          items: views,
          masked: maskedPaths,
        },
        200,
        corsHeaders
      );
    } catch (err: any) {
      if (err.code === PACKAGE_NOT_ALLOWED || err.status === 403) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: PACKAGE_NOT_ALLOWED,
              message: err.message || "Package is not in the allowed package list",
            },
          },
          403,
          corsHeaders
        );
      }
      const isClient = isClientConfigError(err);
      return jsonResponse(
        { ok: false, error: { code: isClient ? INVALID_ARGUMENT : CONFIG_LIST_ERROR, message: err.message } },
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
      const pkgs = await service.discovery.listPackages();
      const targetPackageId = resolveTargetPackageId(pkgs, pkgParam, policy);
      const key = body.key;
      if (!key) {
        return jsonResponse(
          { ok: false, error: { code: INVALID_ARGUMENT, message: "Config 'key' is required" } },
          400,
          corsHeaders
        );
      }
      assertConcreteConfigKey(key);
      await service.management.config.set(targetPackageId, key, body.value);
      return jsonResponse({ ok: true, packageId: targetPackageId, key, message: "updated" }, 200, corsHeaders);
    } catch (err: any) {
      if (err.code === PACKAGE_NOT_ALLOWED || err.status === 403) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: PACKAGE_NOT_ALLOWED,
              message: err.message || "Package is not in the allowed package list",
            },
          },
          403,
          corsHeaders
        );
      }
      const isClient = isClientConfigError(err);
      const errCode =
        err?.code === CONFIG_VALUE_INVALID
          ? CONFIG_VALUE_INVALID
          : isClient
          ? INVALID_ARGUMENT
          : CONFIG_SET_ERROR;
      return jsonResponse(
        { ok: false, error: { code: errCode, message: err.message, details: err.details } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  // 4. Config Item Route: GET /config/:key or DELETE /config/:key
  const configKeyMatch = subpath.match(/^\/config\/([^/]+)$/);
  if (configKeyMatch && req.method === "GET") {
    try {
      const key = decodeURIComponent(configKeyMatch[1]);
      assertConcreteConfigKey(key);
      const pkgParam = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      const pkgs = await service.discovery.listPackages();
      const targetPackageId = resolveTargetPackageId(pkgs, pkgParam, policy);
      const item = await service.management.config.get(targetPackageId, key);
      const declared = sanitizeConfigDefinitions(pkgs.find((pkg) => pkg.id === targetPackageId)?.config) || {};
      return jsonResponse({ ok: true, configViewVersion: 1, packageId: targetPackageId, declared, item }, 200, corsHeaders);
    } catch (err: any) {
      if (err.code === PACKAGE_NOT_ALLOWED || err.status === 403) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: PACKAGE_NOT_ALLOWED,
              message: err.message || "Package is not in the allowed package list",
            },
          },
          403,
          corsHeaders
        );
      }
      const isClient = isClientConfigError(err);
      return jsonResponse(
        { ok: false, error: { code: isClient ? INVALID_ARGUMENT : CONFIG_LIST_ERROR, message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  if (configKeyMatch && req.method === "DELETE") {
    try {
      const key = decodeURIComponent(configKeyMatch[1]);
      assertConcreteConfigKey(key);
      const pkgParam = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      const pkgs = await service.discovery.listPackages();
      const targetPackageId = resolveTargetPackageId(pkgs, pkgParam, policy);
      const deleted = await service.management.config.delete(targetPackageId, key);
      return jsonResponse({ ok: true, packageId: targetPackageId, key, deleted }, 200, corsHeaders);
    } catch (err: any) {
      if (err.code === PACKAGE_NOT_ALLOWED || err.status === 403) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: PACKAGE_NOT_ALLOWED,
              message: err.message || "Package is not in the allowed package list",
            },
          },
          403,
          corsHeaders
        );
      }
      const isClient = isClientConfigError(err);
      return jsonResponse(
        { ok: false, error: { code: isClient ? INVALID_ARGUMENT : CONFIG_DELETE_ERROR, message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  return null;
}
