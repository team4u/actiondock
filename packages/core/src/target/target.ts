import { createActionDockApp } from "../app/app";
import { createActionDockHost } from "../host/host";
import { LocalActionDockTarget } from "./local";
import { RemoteActionDockTarget } from "./remote";
import type {
  ActionDockTarget,
  LocalTargetOptions,
  RemoteTargetOptions,
  TargetOptions,
} from "./types";

/**
 * 工厂函数：统一创建 ActionDockTarget 实例。
 * 依据传入参数自动决策创建 LocalActionDockTarget 或 RemoteActionDockTarget。
 */
export async function createActionDockTarget(
  options: TargetOptions = {}
): Promise<ActionDockTarget> {
  if (options.type === "ipc") {
    const { IpcActionDockTarget } = await import("../ipc/target");
    return new IpcActionDockTarget(options as any);
  }

  if (
    options.type === "remote" ||
    ("serverUrl" in options && Boolean((options as RemoteTargetOptions).serverUrl))
  ) {
    return new RemoteActionDockTarget(options as RemoteTargetOptions);
  }

  const localOpts = options as LocalTargetOptions;
  if (localOpts.host) {
    return new LocalActionDockTarget(localOpts.host);
  }
  if (localOpts.app) {
    return new LocalActionDockTarget(localOpts.app);
  }
  if (localOpts.appOptions) {
    const app = await createActionDockApp(localOpts.appOptions);
    return new LocalActionDockTarget(app);
  }

  const host = await createActionDockHost({
    scanLinkedPackages: localOpts.scanLinkedPackages ?? true,
    ...localOpts,
    // CLI 查询命令缺省旁观打开；显式声明 recoverOrphans 的执行命令透传持有者语义
    recoverOrphans: localOpts.recoverOrphans === true,
    ...(localOpts.hostOptions || {}),
  });
  return new LocalActionDockTarget(host);
}
