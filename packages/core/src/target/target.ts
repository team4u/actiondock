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
    ...(localOpts.hostOptions || {}),
  });
  return new LocalActionDockTarget(host);
}
