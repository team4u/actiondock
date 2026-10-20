import type { ConfigItemDefinition } from "../project/types";
import type { ConfigValueView } from "../service/types";
import { ActionDockError, INVALID_ARGUMENT } from "../errors";
import {
  assertConcreteConfigKey,
  assertValidConfigDeclarations,
  isConfigTemplate,
  resolveConfigDeclaration,
} from "../project/config-declarations";
import {
  redactConfigValueAtPaths,
  redactConfigValueForDeclarations,
  sanitizeConfigDefinitions,
} from "../storage/mask";
import type { RemoteClientRequestOptions } from "./transport";
import { buildQueryString, fetchRemoteJson } from "./transport";

export interface FetchRemoteConfigOptions extends RemoteClientRequestOptions {
  /** 本地声明只可加强远端保护，不能撤销服务端标记。 */
  localDeclarations?: Record<string, ConfigItemDefinition>;
  /** 提供当前目录声明时，仅在响应包标识匹配后启用。 */
  localPackageId?: string;
  onWarning?: (message: string) => void;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 在核心边界归一化配置视图；旧响应无法证明安全的值保守隐藏。 */
export function normalizeRemoteConfigResponse(
  rawResponse: any,
  options?: Pick<FetchRemoteConfigOptions, "localDeclarations" | "localPackageId" | "onWarning"> & { packageId?: string }
): any {
  if (!rawResponse || typeof rawResponse !== "object") {
    throw new ActionDockError(INVALID_ARGUMENT, "Invalid remote configuration response");
  }
  const remoteDeclared: Record<string, ConfigItemDefinition> = isRecord(rawResponse.declared) ? rawResponse.declared : {};
  const matchesLocalPackage = !options?.localPackageId ||
    rawResponse.packageId === options.localPackageId || options.packageId === options.localPackageId;
  const localDeclared = matchesLocalPackage ? options?.localDeclarations ?? {} : {};
  assertValidConfigDeclarations(remoteDeclared);
  assertValidConfigDeclarations(localDeclared);
  const declarationsFor = (key: string): ConfigItemDefinition[] => [
    resolveConfigDeclaration(remoteDeclared, key)?.item,
    resolveConfigDeclaration(localDeclared, key)?.item,
  ].filter((item): item is ConfigItemDefinition => item !== undefined);
  const isNewProtocol = rawResponse.configViewVersion === 1;
  let items: ConfigValueView[];

  if (isNewProtocol) {
    if (!Array.isArray(rawResponse.items)) {
      throw new ActionDockError(INVALID_ARGUMENT, "Remote configuration response is missing safe views");
    }
    items = rawResponse.items.map((item: any): ConfigValueView => {
      if (!isRecord(item) || typeof item.configured !== "boolean" || typeof item.secret !== "boolean" ||
          typeof item.source !== "string" || !Array.isArray(item.redactedPaths) ||
          item.redactedPaths.some((path: unknown) => typeof path !== "string")) {
        throw new ActionDockError(INVALID_ARGUMENT, "Invalid remote configuration view metadata");
      }
      assertConcreteConfigKey(item.key);
      // 路径只是保护策略，不是原值已经被替换的证据；先实际应用服务端路径。
      const remoteSafe = redactConfigValueAtPaths(item.value, item.redactedPaths);
      const declaredSafe = redactConfigValueForDeclarations(remoteSafe.value, declarationsFor(item.key));
      const safe = redactConfigValueAtPaths(declaredSafe.value, [
        ...remoteSafe.redactedPaths, ...declaredSafe.redactedPaths,
      ]);
      return {
        key: item.key,
        configured: item.configured,
        secret: item.secret || remoteSafe.secret || declaredSafe.secret,
        source: item.source,
        value: safe.value,
        redactedPaths: safe.redactedPaths,
      };
    });
  } else {
    // 兼容历史数组视图，但绝不把未知别名中的原文透传给调用者。
    const legacyItems: any[] = Array.isArray(rawResponse) ? rawResponse
      : Array.isArray(rawResponse.items) ? rawResponse.items
      : Array.isArray(rawResponse.config) ? rawResponse.config : [];
    const legacyByKey = new Map(legacyItems.filter((item) => isRecord(item) && typeof item.key === "string").map((item) => [item.key, item]));
    const rawValues = isRecord(rawResponse.values) ? rawResponse.values
      : Object.fromEntries([...legacyByKey].map(([key, item]) => [key, item.value]));
    const keys = [...new Set([
      ...Object.keys(rawValues), ...Object.keys(remoteDeclared), ...Object.keys(localDeclared),
    ])].filter((key) => !isConfigTemplate(key));
    items = keys.map((key): ConfigValueView => {
      assertConcreteConfigKey(key);
      const value = Object.hasOwn(rawValues, key) ? rawValues[key] : undefined;
      const matching = declarationsFor(key);
      const legacyItem = legacyByKey.get(key);
      let safe = redactConfigValueForDeclarations(value, matching);
      if (matching.length === 0 || legacyItem?.secret === true) {
        safe = { value: undefined, secret: true, redactedPaths: value !== undefined ? [""] : [] };
      }
      if (value !== undefined && safe.secret) {
        const message = `Remote configuration '${key}' uses a legacy view; sensitive or undeclared data is conservatively hidden.`;
        (options?.onWarning ?? console.warn)(message);
      }
      return { key, configured: value !== undefined, source: "remote", ...safe };
    });
  }

  // 只返回已知安全字段，避免 spread 原响应把原始别名重新带出边界。
  return {
    ok: rawResponse.ok ?? true,
    configViewVersion: isNewProtocol ? 1 : 0,
    packageId: rawResponse.packageId ?? options?.packageId,
    declared: sanitizeConfigDefinitions({ ...localDeclared, ...remoteDeclared }) ?? {},
    items,
    values: Object.fromEntries(items.map((item) => [item.key,
      item.value === undefined && item.redactedPaths.includes("") ? "********" : item.value,
    ])),
    masked: Object.fromEntries(items.map((item) => [item.key, item.redactedPaths])),
  };
}

/** 拉取远端配置；返回值与元数据均已完成安全归一化。 */
export async function fetchRemoteConfig(
  serverUrl: string,
  token?: string,
  packageId?: string,
  options?: FetchRemoteConfigOptions
): Promise<any> {
  const raw = await fetchRemoteJson(
    serverUrl,
    `/api/v2/config${buildQueryString({ package: packageId })}`,
    token,
    {
      errorPrefix: "Failed to fetch remote config",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
  return normalizeRemoteConfigResponse(raw, { ...options, packageId });
}

/** 单键查询可解析仅由环境变量提供的模板实例；旧服务端回退到列表协议。 */
export async function fetchRemoteConfigItem(
  serverUrl: string,
  key: string,
  token?: string,
  packageId?: string,
  options?: FetchRemoteConfigOptions
): Promise<any> {
  assertConcreteConfigKey(key);
  try {
    const raw = await fetchRemoteJson(serverUrl,
      `/api/v2/config${buildQueryString({ package: packageId, key })}`,
      token, { ...options, errorPrefix: "Failed to fetch remote configuration item" });
    // 旧端忽略 key 查询参数并返回列表，仍可走同一安全归一化边界。
    return normalizeRemoteConfigResponse(raw.item ? { ...raw, items: [raw.item] } : raw, { ...options, packageId });
  } catch (error) {
    if (!(error instanceof ActionDockError) || error.status !== 404) throw error;
    return fetchRemoteConfig(serverUrl, token, packageId, options);
  }
}

/** 写入仍为整键替换；服务端在持久化之前校验。 */
export async function setRemoteConfig(
  serverUrl: string,
  key: string,
  value: unknown,
  token?: string,
  packageId?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  assertConcreteConfigKey(key);
  return fetchRemoteJson(serverUrl, "/api/v2/config", token, {
    method: "PUT",
    body: { key, value, package: packageId },
    errorPrefix: `Failed to set remote config '${key}'`,
    allowInsecureHttp: options?.allowInsecureHttp,
    insecure: options?.insecure,
    dispatcher: options?.dispatcher,
  });
}

export async function deleteRemoteConfig(
  serverUrl: string,
  key: string,
  token?: string,
  packageId?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  assertConcreteConfigKey(key);
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/config/${encodeURIComponent(key)}${buildQueryString({ package: packageId })}`,
    token,
    {
      method: "DELETE",
      errorPrefix: `Failed to delete remote config '${key}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function fetchRemoteConfigEnv(
  serverUrl: string,
  token?: string,
  packageId?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/config/env${buildQueryString({ package: packageId })}`,
    token,
    {
      errorPrefix: "Failed to fetch remote config env checks",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}
