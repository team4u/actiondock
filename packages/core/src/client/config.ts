import type { ConfigItemDefinition } from "../project/types";
import { CONFIG_SOURCES, type ConfigSource, type ConfigValueView } from "../service/types";
import { ActionDockError, PROTOCOL_UNSUPPORTED } from "../errors";
import {
  assertConcreteConfigKey,
  assertValidConfigDeclarations,
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
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判定远端响应中的 source 是否为合法 ConfigSource（含 null）；合法值单一事实源为 CONFIG_SOURCES 元组。 */
function isValidConfigSource(source: unknown): source is ConfigSource | null {
  return source === null || (typeof source === "string" && (CONFIG_SOURCES as readonly string[]).includes(source));
}

/** 在核心边界校验配置安全视图契约：来源合法、状态与值自洽，不满足即拒绝；诊断不携带配置原文。 */
function assertValidConfigValueView(item: any): void {
  if (!isRecord(item) || typeof item.key !== "string" || typeof item.configured !== "boolean" || typeof item.secret !== "boolean" ||
      !isValidConfigSource(item.source) || !Array.isArray(item.redactedPaths) ||
      item.redactedPaths.some((path: unknown) => typeof path !== "string")) {
    throw new ActionDockError(PROTOCOL_UNSUPPORTED, "Remote configuration view violates the config view protocol: source must be one of override/package/global/env/default/null and metadata must be complete");
  }
  // source null 仅代表未命中：不得携带生效值或隐藏路径，也不得宣称已配置。
  if (item.source === null) {
    if (item.configured !== false || item.value !== undefined || item.redactedPaths.length > 0) {
      throw new ActionDockError(PROTOCOL_UNSUPPORTED, `Remote configuration view for '${item.key}' declares no effective source but carries configured state, a value, or redaction paths`);
    }
    return;
  }
  // default 与未命中同样不是显式配置；显式来源必须宣称已配置。
  if (item.source === "default") {
    if (item.configured !== false) {
      throw new ActionDockError(PROTOCOL_UNSUPPORTED, `Remote configuration view for '${item.key}' declares a default source but claims configured state`);
    }
  } else if (item.configured !== true) {
    throw new ActionDockError(PROTOCOL_UNSUPPORTED, `Remote configuration view for '${item.key}' declares an explicit source but claims unconfigured state`);
  }
  // 声明有来源就必须有实际生效值；整项隐藏可省略 value 但必须携带根隐藏路径。
  if (item.value === undefined && !item.redactedPaths.includes("")) {
    throw new ActionDockError(PROTOCOL_UNSUPPORTED, `Remote configuration view for '${item.key}' declares an effective source but omits both the value and the root redaction path`);
  }
}

/**
 * 在核心边界归一化配置安全视图；仅接受 configViewVersion:1 新协议。
 * 旧协议无法证明来源与元数据真实性，统一抛出协议不支持错误，不猜测来源。
 */
export function normalizeRemoteConfigResponse(
  rawResponse: any,
  options?: Pick<FetchRemoteConfigOptions, "localDeclarations" | "localPackageId"> & { packageId?: string }
): any {
  if (!rawResponse || typeof rawResponse !== "object") {
    throw new ActionDockError(PROTOCOL_UNSUPPORTED, "Remote configuration response violates the config view protocol: response must be an object");
  }
  // 新协议门槛提前到一切声明解析之前：缺失 configViewVersion:1 视为旧服务端，
  // 直接拒绝，避免旧协议因其他字段错误先报清单/参数错误。
  if (rawResponse.configViewVersion !== 1) {
    throw new ActionDockError(PROTOCOL_UNSUPPORTED, "Remote server did not declare configViewVersion: 1; legacy configuration responses without safe view metadata are no longer supported");
  }
  if (!Array.isArray(rawResponse.items)) {
    throw new ActionDockError(PROTOCOL_UNSUPPORTED, "Remote configuration response is missing safe views");
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

  const items: ConfigValueView[] = rawResponse.items.map((item: any): ConfigValueView => {
    assertValidConfigValueView(item);
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

  // 只返回已知安全字段，避免 spread 原响应把原始别名重新带出边界。
  return {
    ok: rawResponse.ok ?? true,
    configViewVersion: 1,
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

/** 单键查询可解析仅由环境变量提供的模板实例；服务端必须返回同键完整单项视图。 */
export async function fetchRemoteConfigItem(
  serverUrl: string,
  key: string,
  token?: string,
  packageId?: string,
  options?: FetchRemoteConfigOptions
): Promise<any> {
  assertConcreteConfigKey(key);
  const raw = await fetchRemoteJson(serverUrl,
    `/api/v2/config${buildQueryString({ package: packageId, key })}`,
    token, { ...options, errorPrefix: "Failed to fetch remote configuration item" });
  // 严格单项契约：新协议必须提供与请求键一致的完整 item；
  // 真正未命中由服务端返回同键 source null 视图，不接受列表或空 items 伪装单项。
  if (!raw || typeof raw !== "object" || raw.configViewVersion !== 1 ||
      !isRecord(raw.item) || raw.item.key !== key) {
    throw new ActionDockError(PROTOCOL_UNSUPPORTED, `Remote server did not return a complete single-item config view for key '${key}'; servers that ignore the key query parameter are no longer supported`);
  }
  return normalizeRemoteConfigResponse({ ...raw, items: [raw.item] }, { ...options, packageId });
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
