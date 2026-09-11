import { decodeStateKey } from "../../storage";
import { CAPABILITY_UNAVAILABLE, STATE_KEY_NOT_FOUND } from "../../errors";
import { readJsonBody } from "../body";
import { assertPackageAllowed, getSubPath, jsonResponse, resolveAppForPackage, type RouteContext } from "./common";

/**
 * 处理状态键名列表、读取、写入、删除及清空接口。
 * 在未显式开启管理功能 (options.enableManagement !== true) 时返回 403 拒绝。
 */
export async function handleStateRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, options, host, target } = ctx;
  const subpath = getSubPath(pathname);

  const isStateRoute =
    subpath === "/state" ||
    subpath.startsWith("/state/") ||
    subpath.startsWith("/management/state");

  if (!isStateRoute) {
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

  // 1. State List: GET /state
  if (subpath === "/state" && req.method === "GET") {
    try {
      const pkgParam = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      const actionParam = url.searchParams.get("action") || url.searchParams.get("actionId") || "";
      const nsParam = url.searchParams.get("namespace") ?? undefined;
      const prefix = url.searchParams.get("prefix") || "";

      if (pkgParam) {
        assertPackageAllowed(pkgParam, options);
      }
      const app = resolveAppForPackage(pkgParam, host, target, options);
      assertPackageAllowed(app.packageId, options);
      const effectiveNs = actionParam
        ? (nsParam !== undefined ? `${actionParam}:${nsParam}` : actionParam)
        : (nsParam !== undefined ? nsParam : null);
      const keys = await app.storage.listStateKeys(effectiveNs, prefix);
      return jsonResponse({ ok: true, packageId: app.packageId, keys }, 200, corsHeaders);
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
      const isClient =
        err.message?.includes("Unknown or unregistered package") ||
        err.message?.includes("Invalid packageId") ||
        err.message?.includes("escapes boundary");
      return jsonResponse(
        { ok: false, error: { code: isClient ? "INVALID_ARGUMENT" : "STATE_LIST_ERROR", message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  // 2. State Clear: POST /state/clear
  if (subpath === "/state/clear" && req.method === "POST") {
    try {
      const body = await readJsonBody(req, { maxBytes: options.maxBodyBytes }).catch(() => ({}));
      const pkgParam = url.searchParams.get("package") || url.searchParams.get("packageId") || body.package || undefined;
      const actionParam = url.searchParams.get("action") || url.searchParams.get("actionId") || body.action || body.actionId || "";
      const baseNs = body.namespace ?? (url.searchParams.get("namespace") || undefined);
      const effectiveNs = actionParam ? (baseNs ? `${actionParam}:${baseNs}` : actionParam) : baseNs;

      if (pkgParam) {
        assertPackageAllowed(pkgParam, options);
      }
      const app = resolveAppForPackage(pkgParam, host, target, options);
      assertPackageAllowed(app.packageId, options);
      const clearedCount = await app.storage.clearState({
        namespace: effectiveNs,
        all: Boolean(body.all ?? url.searchParams.get("all") === "true"),
        prefix: body.prefix ?? (url.searchParams.get("prefix") || undefined),
      });
      return jsonResponse({ ok: true, packageId: app.packageId, clearedCount }, 200, corsHeaders);
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
      const isClient =
        err.message?.includes("Unknown or unregistered package") ||
        err.message?.includes("Invalid packageId") ||
        err.message?.includes("escapes boundary");
      return jsonResponse(
        { ok: false, error: { code: isClient ? "INVALID_ARGUMENT" : "STATE_CLEAR_ERROR", message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  // 3. State Key CRUD: GET / PUT / POST / DELETE /state/:key
  const stateKeyMatch = subpath.match(/^\/state\/([^/]+)$/);
  if (stateKeyMatch) {
    try {
      const key = decodeURIComponent(stateKeyMatch[1]);
      const pkgParam = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      const actionParam = url.searchParams.get("action") || url.searchParams.get("actionId") || "";
      const nsParam = url.searchParams.get("namespace") || undefined;
      const effectiveNs = actionParam ? (nsParam ? `${actionParam}:${nsParam}` : actionParam) : nsParam;
      if (pkgParam) {
        assertPackageAllowed(pkgParam, options);
      }
      const app = resolveAppForPackage(pkgParam, host, target, options);
      assertPackageAllowed(app.packageId, options);

      if (req.method === "GET") {
        const entry = await app.storage.findState(key, effectiveNs);
        if (!entry || entry.value === undefined) {
          return jsonResponse(
            { ok: false, error: { code: STATE_KEY_NOT_FOUND, message: `State key '${key}' not found` } },
            404,
            corsHeaders
          );
        }
        return jsonResponse(
          {
            ok: true,
            packageId: app.packageId,
            key: entry.key,
            namespace: entry.namespace,
            value: entry.value,
            expiresAt: entry.expiresAt,
          },
          200,
          corsHeaders
        );
      }

      if (req.method === "PUT" || req.method === "POST") {
        const body = await readJsonBody(req, { maxBytes: options.maxBodyBytes });
        const val = body.value !== undefined ? body.value : body;
        const ttl = typeof body.ttl === "number" ? body.ttl : undefined;
        const bodyAction = body.action || body.actionId || actionParam;
        const explicitNs = body.namespace || nsParam;
        const combinedNs = bodyAction ? (explicitNs ? `${bodyAction}:${explicitNs}` : bodyAction) : explicitNs;

        let actualKey = key;
        let ns = combinedNs || "";
        if (!combinedNs) {
          const decoded = decodeStateKey(key);
          ns = decoded.namespace;
          actualKey = decoded.key;
        }

        await app.storage.setState(ns, actualKey, val, ttl);
        return jsonResponse(
          { ok: true, packageId: app.packageId, key: actualKey, namespace: ns, message: "updated" },
          200,
          corsHeaders
        );
      }

      if (req.method === "DELETE") {
        const deleted = await app.storage.deleteStateSmart(key, effectiveNs);
        if (!deleted) {
          return jsonResponse(
            { ok: false, error: { code: STATE_KEY_NOT_FOUND, message: `State key '${key}' not found` } },
            404,
            corsHeaders
          );
        }
        return jsonResponse({ ok: true, packageId: app.packageId, key, deleted: true }, 200, corsHeaders);
      }
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
      const isClient =
        err.message?.includes("Unknown or unregistered package") ||
        err.message?.includes("Invalid packageId") ||
        err.message?.includes("escapes boundary") ||
        err.message?.includes("Ambiguous state key");
      return jsonResponse(
        { ok: false, error: { code: isClient ? "INVALID_ARGUMENT" : "STATE_KEY_ERROR", message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  return null;
}
