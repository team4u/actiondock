import { createPackageRuntime } from "../package/runtime";
import { createActionDockHost } from "../host/host";
import { LocalActionDockService } from "./local";
import { RemoteActionDockService } from "./remote";
import { ActionDockError, INVALID_ARGUMENT, NOT_FOUND } from "../errors";
import type {
  ActionDockService,
  ConnectActionDockOptions,
  CreateActionDockOptions,
  RemoteServiceOptions,
} from "./types";

/**
 * 工厂函数：创建本地 ActionDock 服务实例。
 * 遵循标准 Service Ports 体系，屏蔽底层多包协调或单包存储细节。
 */
export async function createActionDock(
  options: CreateActionDockOptions = {}
): Promise<ActionDockService> {
  if (options.host) {
    return new LocalActionDockService(options.host, { enableManagement: options.enableManagement });
  }
  const runtimeToUse = options.runtime || options.packageRuntime;
  if (runtimeToUse) {
    const host = await createActionDockHost({
      packages: [runtimeToUse],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });
    return new LocalActionDockService(host, { enableManagement: options.enableManagement });
  }
  if (options.runtimeOptions) {
    const runtime = await createPackageRuntime(options.runtimeOptions);
    const host = await createActionDockHost({
      packages: [runtime],
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });
    return new LocalActionDockService(host, { enableManagement: options.enableManagement });
  }

  const host = await createActionDockHost({
    scanLinkedPackages: options.scanLinkedPackages ?? true,
    ...options,
    recoverOrphans: options.recoverOrphans ?? true,
    ...(options.hostOptions || {}),
  });
  return new LocalActionDockService(host, { enableManagement: options.enableManagement });
}

/**
 * 工厂函数：连接远端 ActionDock 服务实例。
 * 支持传入目标 HTTP 根地址、Profile 别名或完整连接配置选项。
 */
export async function connectActionDock(
  urlOrProfile: string | RemoteServiceOptions,
  options?: ConnectActionDockOptions
): Promise<RemoteActionDockService> {
  let targetUrl: string;
  let token = options?.token;
  let insecure = options?.insecure;
  let allowInsecureHttp = options?.allowInsecureHttp;
  let dispatcher = options?.dispatcher;
  let timeoutMs = options?.timeoutMs;
  let baseTimeoutMs = options?.baseTimeoutMs;

  if (typeof urlOrProfile === "object" && urlOrProfile !== null) {
    targetUrl = urlOrProfile.serverUrl;
    token = urlOrProfile.token ?? token;
    insecure = urlOrProfile.insecure ?? insecure;
    allowInsecureHttp = urlOrProfile.allowInsecureHttp ?? allowInsecureHttp;
    dispatcher = urlOrProfile.dispatcher ?? dispatcher;
    timeoutMs = urlOrProfile.timeoutMs ?? timeoutMs;
    baseTimeoutMs = urlOrProfile.baseTimeoutMs ?? baseTimeoutMs;
  } else if (typeof urlOrProfile === "string") {
    if (urlOrProfile.startsWith("http://") || urlOrProfile.startsWith("https://")) {
      targetUrl = urlOrProfile;
    } else {
      const { resolveTarget } = await import("../profile/manager");
      const resolved = resolveTarget({ profile: urlOrProfile }, options?.customHome);
      if (resolved.type !== "remote" || !resolved.serverUrl) {
        throw new ActionDockError(NOT_FOUND, `Profile '${urlOrProfile}' not found or is not a remote profile`);
      }
      targetUrl = resolved.serverUrl;
      token = resolved.token ?? token;
      insecure = resolved.insecure ?? insecure;
      allowInsecureHttp = resolved.allowInsecureHttp ?? allowInsecureHttp;
    }
  } else {
    throw new ActionDockError(INVALID_ARGUMENT, "Invalid urlOrProfile argument for connectActionDock");
  }

  return new RemoteActionDockService({
    serverUrl: targetUrl,
    token,
    insecure,
    allowInsecureHttp,
    dispatcher,
    timeoutMs,
    baseTimeoutMs,
    enableManagement: options?.enableManagement,
  });
}
