import { decodeStateKey } from "../../storage";
import {
  AMBIGUOUS_STATE_KEY,
  CAPABILITY_UNAVAILABLE,
  INVALID_ARGUMENT,
  INVALID_PACKAGE_ID,
  PACKAGE_NOT_ALLOWED,
  PACKAGE_NOT_FOUND,
  PATH_TRAVERSAL,
  STATE_CLEAR_ERROR,
  STATE_KEY_ERROR,
  STATE_KEY_NOT_FOUND,
  STATE_LIST_ERROR,
} from "../../errors";
import { readJsonBody } from "../body";
import {
  assertPackageAllowed,
  getSubPath,
  isManagementAllowedByPolicy,
  jsonResponse,
  resolveTargetPackageId,
  type RouteContext,
} from "./common";

function isClientStateError(err: any): boolean {
  return (
    err?.code === PACKAGE_NOT_FOUND ||
    err?.code === INVALID_PACKAGE_ID ||
    err?.code === PATH_TRAVERSAL ||
    err?.code === AMBIGUOUS_STATE_KEY ||
    err?.code === INVALID_ARGUMENT ||
    err?.status === 400 ||
    err?.status === 404
  );
}

/**
 * 处理状态键名列表、读取、写入、删除及清空接口。
 * 在未显式开启管理功能时返回 403 拒绝。
 */
export async function handleStateRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, options, service, activePolicy: policy } = ctx;
  const subpath = getSubPath(pathname);

  const isStateRoute =
    subpath === "/state" ||
    subpath.startsWith("/state/") ||
    subpath.startsWith("/management/state");

  if (!isStateRoute) {
    return null;
  }

  // 校验管理能力开关
  if (!isManagementAllowedByPolicy(policy) || !service.management?.state) {
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

      const pkgs = await service.discovery.listPackages();
      const targetPackageId = resolveTargetPackageId(pkgs, pkgParam, policy);

      const keys = await service.management.state.list(targetPackageId, actionParam, {
        namespace: nsParam,
        prefix,
      });
      return jsonResponse({ ok: true, packageId: targetPackageId, keys }, 200, corsHeaders);
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
      const isClient = isClientStateError(err);
      return jsonResponse(
        { ok: false, error: { code: isClient ? INVALID_ARGUMENT : STATE_LIST_ERROR, message: err.message } },
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

      const pkgs = await service.discovery.listPackages();
      const targetPackageId = resolveTargetPackageId(pkgs, pkgParam, policy);

      const clearedCount = await service.management.state.clear(targetPackageId, actionParam, {
        namespace: baseNs,
        all: Boolean(body.all ?? url.searchParams.get("all") === "true"),
        prefix: body.prefix ?? (url.searchParams.get("prefix") || undefined),
      });
      return jsonResponse({ ok: true, packageId: targetPackageId, clearedCount }, 200, corsHeaders);
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
      const isClient = isClientStateError(err);
      return jsonResponse(
        { ok: false, error: { code: isClient ? INVALID_ARGUMENT : STATE_CLEAR_ERROR, message: err.message } },
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

      const pkgs = await service.discovery.listPackages();
      const targetPackageId = resolveTargetPackageId(pkgs, pkgParam, policy);

      if (req.method === "GET") {
        const entry = await service.management.state.get(targetPackageId, actionParam, key, {
          namespace: nsParam,
          detail: true,
        });
        if (!entry || (typeof entry === "object" && (entry as any).value === undefined)) {
          return jsonResponse(
            { ok: false, error: { code: STATE_KEY_NOT_FOUND, message: `State key '${key}' not found` } },
            404,
            corsHeaders
          );
        }
        const data = typeof entry === "object" && "value" in entry
          ? entry
          : { key, namespace: nsParam || "", value: entry, expiresAt: undefined };
        return jsonResponse(
          {
            ok: true,
            packageId: targetPackageId,
            key: (data as any).key || key,
            namespace: (data as any).namespace ?? nsParam ?? "",
            value: (data as any).value,
            expiresAt: (data as any).expiresAt,
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

        let actualKey = key;
        let ns = explicitNs;
        if (!bodyAction && !explicitNs) {
          const decoded = decodeStateKey(key);
          ns = decoded.namespace;
          actualKey = decoded.key;
        }

        await service.management.state.set(targetPackageId, bodyAction, actualKey, val, {
          namespace: ns,
          ttl,
        });
        return jsonResponse(
          { ok: true, packageId: targetPackageId, key: actualKey, namespace: ns || bodyAction || "", message: "updated" },
          200,
          corsHeaders
        );
      }

      if (req.method === "DELETE") {
        const deleted = await service.management.state.delete(targetPackageId, actionParam, key, {
          namespace: nsParam,
        });
        if (!deleted) {
          return jsonResponse(
            { ok: false, error: { code: STATE_KEY_NOT_FOUND, message: `State key '${key}' not found` } },
            404,
            corsHeaders
          );
        }
        return jsonResponse({ ok: true, packageId: targetPackageId, key, deleted: true }, 200, corsHeaders);
      }
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
      const isClient = isClientStateError(err);
      return jsonResponse(
        { ok: false, error: { code: isClient ? INVALID_ARGUMENT : STATE_KEY_ERROR, message: err.message } },
        isClient ? 400 : 500,
        corsHeaders
      );
    }
  }

  return null;
}
