import { readJsonBody } from "../body";
import { type RouteContext, jsonResponse, resolveStorageForPackage } from "./common";
import { decodeStateKey } from "../../storage";

/**
 * 处理状态键名列表、读取、写入、删除及清空接口。
 */
export async function handleStateRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, projectRoot, customHome, runtimeRegistry, options } = ctx;

  // 1. State List: GET /api/v1/state
  if (pathname === "/api/v1/state" && req.method === "GET") {
    try {
      const pkgParam = url.searchParams.get("package") || undefined;
      const nsParam = url.searchParams.get("namespace") ?? undefined;
      const prefix = url.searchParams.get("prefix") || "";

      const { packageId, storage } = resolveStorageForPackage(
        pkgParam,
        runtimeRegistry,
        projectRoot,
        customHome
      );
      const keys = await storage.listStateKeys(nsParam !== undefined ? nsParam : null, prefix);
      return jsonResponse({ ok: true, packageId, keys }, 200, corsHeaders);
    } catch (err: any) {
      const isClient = err.message?.includes("Unknown or unregistered package") || err.message?.includes("Invalid packageId") || err.message?.includes("escapes boundary");
      return jsonResponse(
        { ok: false, error: { code: isClient ? "INVALID_ARGUMENT" : "STATE_LIST_ERROR", message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  // 2. State Clear: POST /api/v1/state/clear
  if (pathname === "/api/v1/state/clear" && req.method === "POST") {
    try {
      const body = await readJsonBody(req, { maxBytes: options.maxBodyBytes }).catch(() => ({}));
      const pkgParam = url.searchParams.get("package") || body.package || undefined;
      const { packageId, storage } = resolveStorageForPackage(
        pkgParam,
        runtimeRegistry,
        projectRoot,
        customHome
      );
      const clearedCount = await storage.clearState({
        namespace: body.namespace ?? (url.searchParams.get("namespace") || undefined),
        all: Boolean(body.all ?? url.searchParams.get("all") === "true"),
        prefix: body.prefix ?? (url.searchParams.get("prefix") || undefined),
      });
      return jsonResponse({ ok: true, packageId, clearedCount }, 200, corsHeaders);
    } catch (err: any) {
      const isClient = err.message?.includes("Unknown or unregistered package") || err.message?.includes("Invalid packageId") || err.message?.includes("escapes boundary");
      return jsonResponse(
        { ok: false, error: { code: isClient ? "INVALID_ARGUMENT" : "STATE_CLEAR_ERROR", message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  // 3. State Key CRUD: GET / PUT / POST / DELETE /api/v1/state/:key
  const stateKeyMatch = pathname.match(/^\/api\/v1\/state\/([^/]+)$/);
  if (stateKeyMatch) {
    try {
      const key = decodeURIComponent(stateKeyMatch[1]);
      const pkgParam = url.searchParams.get("package") || undefined;
      const nsParam = url.searchParams.get("namespace") || undefined;

      const { packageId, storage } = resolveStorageForPackage(
        pkgParam,
        runtimeRegistry,
        projectRoot,
        customHome
      );

      if (req.method === "GET") {
        const entry = await storage.findState(key, nsParam);
        if (!entry || entry.value === undefined) {
          return jsonResponse(
            { ok: false, error: { code: "STATE_KEY_NOT_FOUND", message: `State key '${key}' not found` } },
            404,
            corsHeaders
          );
        }
        return jsonResponse(
          {
            ok: true,
            packageId,
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
        const explicitNs = body.namespace || nsParam;

        let actualKey = key;
        let ns = explicitNs || "";
        if (!explicitNs) {
          const decoded = decodeStateKey(key);
          ns = decoded.namespace;
          actualKey = decoded.key;
        }

        await storage.setState(ns, actualKey, val, ttl);
        return jsonResponse(
          { ok: true, packageId, key: actualKey, namespace: ns, message: "updated" },
          200,
          corsHeaders
        );
      }

      if (req.method === "DELETE") {
        const deleted = await storage.deleteStateSmart(key, nsParam);
        if (!deleted) {
          return jsonResponse(
            { ok: false, error: { code: "STATE_KEY_NOT_FOUND", message: `State key '${key}' not found` } },
            404,
            corsHeaders
          );
        }
        return jsonResponse({ ok: true, packageId, key, deleted: true }, 200, corsHeaders);
      }
    } catch (err: any) {
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
